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
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';
import { MuxaroError, type JobProgressEvent } from '@muxaro/shared';
import { getMuxaroRedis, type MuxaroRedisClient } from '@muxaro/db';
import { getS3Client, getR2BucketName } from './s3-client.js';
import type { BatchJobPayload, BatchItemInput, BatchPackagingResult } from './types.js';

export interface BatchZipperOptions {
  readonly job: BatchJobPayload;
  readonly s3Client?: S3Client;
  readonly bucketName?: string;
  readonly redisClient?: MuxaroRedisClient;
  readonly signal?: AbortSignal;
  readonly concurrency?: number;
}

export class BatchZipper {
  /**
   * Packages a playlist or item list into a streaming STORE-mode ZIP archive
   * piped directly to Cloudflare R2 / S3.
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

    // 1. Initialize STORE-mode archiver (Level 0 compression)
    const archive = archiver('zip', {
      zlib: { level: 0 },
      store: true, // No CPU wasted re-compressing media
      highWaterMark: 16 * 1024 * 1024,
    });

    const passThrough = new PassThrough({ highWaterMark: 16 * 1024 * 1024 });
    archive.pipe(passThrough);

    // 2. Setup S3 Multipart Upload directly from archiver stream
    const upload = new Upload({
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

    if (signal) {
      if (signal.aborted) {
        archive.abort();
        throw new MuxaroError('Batch job cancelled by client', 'CANCELLED', 499);
      }
      signal.addEventListener('abort', () => {
        archive.abort();
        upload.abort().catch(() => {});
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

    archive.on('error', (err: Error) => {
      upload.abort().catch(() => {});
      throw new MuxaroError(`Archiver error: ${err.message}`, 'INTERNAL_ERROR', 500);
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
        if (signal?.aborted) {
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

    // 5. Await both upload completion and archiver finalization
    try {
      const [uploadResult] = await Promise.all([upload.done(), processItemsPromise]);

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
        sizeBytes: 0,
        totalEntries,
        processingTimeMs,
      };
    } catch (err) {
      archive.abort();
      try {
        await upload.abort();
      } catch {
        // ignore
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
      const response = await fetch(sourceUrl, {
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

    // Local file fallback
    const fs = await import('node:fs');
    return fs.createReadStream(sourceUrl);
  }
}

function sanitizeZipName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-\. ]/g, '_').trim().slice(0, 100);
}
