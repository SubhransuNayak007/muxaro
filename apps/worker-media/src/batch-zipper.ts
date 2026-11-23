/**
 * MUXARO Media Processing Platform - Batch & Playlist ZIP Packager
 * 
 * Implements high-throughput streaming ZIP archive generation matching Part 5.3:
 * - STORE-mode (level 0 compression) for already-compressed media (MP4, MP3, WebM, AAC)
 * - Zero intermediate disk storage: pipes streaming archiver directly to Cloudflare R2 / S3
 * - Concurrent playlist item fan-out with progress reporting to Redis Pub/Sub
 * - Manifest indexing with metadata and track details
 */

import archiver from 'archiver';
import { PassThrough, type Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';
import { MuxaroError, assertSafeMediaUrl, type JobProgressEvent } from '@muxaro/shared';
import { getMuxaroRedis, type MuxaroRedisClient } from '@muxaro/db';
import { getS3Client, getR2BucketName } from './s3-client.js';
import { StreamPipeline, getStorageArtifactPath } from './stream-pipeline.js';
import { validateSandboxPath } from './security/hardened-ffprobe.js';
import type { BatchJobPayload, BatchItemInput, BatchPackagingResult } from './types.js';

export interface BatchZipperOptions {
  readonly job: BatchJobPayload;
  readonly s3Client?: S3Client;
  readonly bucketName?: string;
  readonly redisClient?: MuxaroRedisClient;
  readonly signal?: AbortSignal;
  readonly concurrency?: number;
  readonly timeoutMs?: number;
}

export class BatchZipper {
  /**
   * Packages a playlist or item list into a streaming STORE-mode ZIP archive
   * piped directly to Cloudflare R2 / S3 or resilient local disk fallback.
   */
  public static async execute(options: BatchZipperOptions): Promise<BatchPackagingResult> {
    const startTime = Date.now();
    const { job, signal } = options;
    const s3Client = options.s3Client || getS3Client();
    const bucketName = options.bucketName || getR2BucketName();
    const redis = options.redisClient || getMuxaroRedis();

    const items = job.items || [];
    if (items.length === 0) {
      throw new MuxaroError('Batch job contains no items to package', 'BAD_REQUEST', 400);
    }

    const storageKey = `outputs/${job.retentionTier}/${job.jobId}.zip`;
    const outputFilename = `${job.title ? sanitizeZipName(job.title) : job.jobId}.zip`;
    const { artifactPath, directPath } = getStorageArtifactPath(storageKey);

    // 1. Initialize STORE-mode archiver (Level 0 compression)
    const archive = archiver('zip', {
      zlib: { level: 0 },
      store: true, // No CPU wasted re-compressing media
      highWaterMark: 16 * 1024 * 1024,
    });

    const passThrough = new PassThrough({ highWaterMark: 16 * 1024 * 1024 });
    passThrough.on('error', () => {
      // Suppress unhandled stream error
    });
    archive.pipe(passThrough);

    // 2. Setup storage sink: check if S3 / MinIO is offline
    const isS3Offline = await StreamPipeline.checkIfS3Offline(s3Client, bucketName);
    let upload: Upload | null = null;
    let localFilePromise: Promise<number> | null = null;
    let fileWriter: fs.WriteStream | null = null;

    if (isS3Offline) {
      fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
      fs.mkdirSync(path.dirname(directPath), { recursive: true });

      fileWriter = fs.createWriteStream(artifactPath);
      passThrough.pipe(fileWriter);

      localFilePromise = new Promise<number>((resolve, reject) => {
        fileWriter!.on('finish', () => {
          try {
            const stats = fs.statSync(artifactPath);
            try {
              if (artifactPath !== directPath) {
                if (fs.existsSync(directPath)) {
                  fs.unlinkSync(directPath);
                }
                fs.linkSync(artifactPath, directPath);
              }
            } catch {
              try {
                fs.copyFileSync(artifactPath, directPath);
              } catch {}
            }
            resolve(stats.size);
          } catch {
            resolve(0);
          }
        });
        fileWriter!.on('error', (err) => {
          reject(new MuxaroError(`Failed writing zip artifact to disk: ${err.message}`, 'INTERNAL_ERROR', 500));
        });
      });
    } else {
      upload = new Upload({
        client: s3Client,
        params: {
          Bucket: bucketName,
          Key: storageKey,
          Body: passThrough,
          ContentType: 'application/zip',
        },
        partSize: 8 * 1024 * 1024,
        queueSize: 4,
        leavePartsOnError: false,
      });
    }

    let isTerminated = false;
    let timedOut = false;

    const terminateArchiver = (reason: string) => {
      if (isTerminated) return;
      isTerminated = true;

      try {
        archive.abort();
      } catch {}

      if (upload) {
        upload.abort().catch(() => {});
      }
      if (fileWriter) {
        try {
          fileWriter.destroy();
        } catch {}
      }
      try {
        passThrough.destroy();
      } catch {}
    };

    const timeoutMs = options.timeoutMs ?? (30 * 60 * 1000); // 30 minutes ceiling
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminateArchiver('Batch archiver timed out');
    }, timeoutMs);
    timeoutTimer.unref?.();

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timeoutTimer);
        terminateArchiver('Batch job initially cancelled');
        throw new MuxaroError('Batch job cancelled by client', 'CANCELLED', 499);
      }
      signal.addEventListener('abort', () => {
        terminateArchiver('Batch job abort signal received');
      });
    }

    // 3. Track progress and publish to Redis
    let processedEntries = 0;
    const totalEntries = items.length;

    archive.on('progress', (progress: { fs: { processedBytes: number; totalBytes: number } }) => {
      const processedBytes = progress.fs.processedBytes;
      const percent = Math.min(
        99.0,
        Math.round((processedEntries / Math.max(1, totalEntries)) * 100)
      );

      const event: JobProgressEvent = {
        jobId: job.jobId,
        status: 'processing',
        stage: 'packaging',
        progressPercent: percent,
        processedBytes,
        message: `Archiving items: ${processedEntries}/${totalEntries} completed`,
        timestamp: new Date().toISOString(),
      };
      redis.publishJobEvent(job.jobId, event).catch(() => {});
    });

    const archivePromise = new Promise<void>((resolve, reject) => {
      archive.on('error', (err: Error) => {
        terminateArchiver('Archiver error emitted');
        reject(new MuxaroError(`Archiver error: ${err.message}`, 'INTERNAL_ERROR', 500));
      });
      archive.on('end', () => resolve());
      archive.on('finish', () => resolve());
    });

    // 4. Concurrently fetch and append items into ZIP
    const manifestItems: Array<{
      index: number;
      id: string;
      title: string;
      filename: string;
      durationSeconds?: number;
    }> = [];

    const itemConcurrency = options.concurrency || 2;

    const processItemsPromise = (async () => {
      for (let i = 0; i < items.length; i += itemConcurrency) {
        if (signal?.aborted || isTerminated) {
          throw new MuxaroError('Batch packaging aborted', 'CANCELLED', 499);
        }

        const slice = items.slice(i, i + itemConcurrency);
        await Promise.all(
          slice.map(async (item, sliceIdx) => {
            const index = i + sliceIdx + 1;
            const ext = item.targetFormat || 'mp4';
            const safeTitle = sanitizeZipName(item.title || `item_${index}`);
            const entryFilename = `${String(index).padStart(3, '0')}_${safeTitle}.${ext}`;

            // Fetch media stream
            const stream = await BatchZipper.fetchMediaStream(item.url, signal);

            archive.append(stream, { name: entryFilename });

            manifestItems.push({
              index,
              id: item.id,
              title: item.title,
              filename: entryFilename,
              durationSeconds: item.durationSeconds,
            });

            processedEntries++;
          })
        );
      }

      // Append index manifest.json to ZIP root
      const manifest = {
        jobId: job.jobId,
        title: job.title || 'MUXARO Batch Archive',
        playlistUrl: job.playlistUrl,
        totalItems: totalEntries,
        createdAt: new Date().toISOString(),
        items: manifestItems.sort((a, b) => a.index - b.index),
      };

      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

      // Finalize the archive stream
      await archive.finalize();
    })();

    // 5. Await upload completion, items processing, and archiver finalization
    try {
      const storagePromise = isS3Offline ? localFilePromise! : upload!.done();

      // Attach catch handlers immediately to prevent UnhandledPromiseRejection in cross-failure races
      storagePromise.catch(() => {});
      processItemsPromise.catch(() => {});
      archivePromise.catch(() => {});

      const [storageResult] = await Promise.all([storagePromise, processItemsPromise, archivePromise]);
      clearTimeout(timeoutTimer);

      let sizeBytes = 0;
      if (isS3Offline && typeof storageResult === 'number') {
        sizeBytes = storageResult;
      } else {
        try {
          if (fs.existsSync(artifactPath)) {
            sizeBytes = fs.statSync(artifactPath).size;
          }
        } catch {}
      }

      const processingTimeMs = Date.now() - startTime;

      // Emit 100% completion event
      const completionEvent: JobProgressEvent = {
        jobId: job.jobId,
        status: 'completed',
        stage: 'ready',
        progressPercent: 100.0,
        message: `Batch packaging completed (${totalEntries} items)`,
        timestamp: new Date().toISOString(),
      };
      await redis.publishJobEvent(job.jobId, completionEvent);

      return {
        success: true,
        jobId: job.jobId,
        storageKey,
        filename: outputFilename,
        sizeBytes,
        totalEntries,
        processingTimeMs,
      };
    } catch (err: any) {
      clearTimeout(timeoutTimer);
      terminateArchiver('Error during batch execution');

      if (isS3Offline) {
        try { if (fs.existsSync(artifactPath)) fs.unlinkSync(artifactPath); } catch {}
        try { if (fs.existsSync(directPath)) fs.unlinkSync(directPath); } catch {}
      }

      if (timedOut) {
        throw new MuxaroError('Batch packaging timed out', 'GATEWAY_TIMEOUT', 504);
      }
      throw err;
    }
  }

  /**
   * Fetches media content from URL or local path as a Readable stream
   */
  private static async fetchMediaStream(
    sourceUrl: string,
    signal?: AbortSignal
  ): Promise<Readable> {
    if (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://')) {
      const safeInfo = await assertSafeMediaUrl(sourceUrl);
      const targetUrl = safeInfo.canonicalUrl || sourceUrl;

      const response = await fetch(targetUrl, {
        signal,
        headers: {
          'User-Agent': 'MuxaroMediaWorker/1.0',
        },
      });

      if (!response.ok || !response.body) {
        throw new MuxaroError(
          `Failed to fetch stream item: HTTP ${response.status} (${sourceUrl})`,
          'EXTRACTION_FAILED',
          502
        );
      }

      // Convert web ReadableStream to Node.js Readable
      const { Readable: NodeReadable } = await import('node:stream');
      return NodeReadable.fromWeb(response.body as any);
    }

    // Local file fallback with strict sandbox path validation
    const validatedPath = validateSandboxPath(sourceUrl);
    const fs = await import('node:fs');
    return fs.createReadStream(validatedPath);
  }
}

function sanitizeZipName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-\. ]/g, '_').trim().slice(0, 100);
}
