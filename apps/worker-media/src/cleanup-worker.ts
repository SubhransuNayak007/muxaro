/**
 * MUXARO Media Processing Platform - Delayed Artifact Cleanup Worker
 * 
 * Enforces strict artifact retention policies:
 * - Exact 60-minute delayed eviction for guest artifacts (outputs/60m/*)
 * - Exact 24-hour delayed eviction for signed-in user artifacts (outputs/24h/*)
 * - BullMQ delayed queue processing with S3 DeleteObjectCommand
 * - Periodic sweeping fallback to guarantee zero orphaned storage leaks
 */

import { Worker, Queue, type Job } from 'bullmq';
import fs from 'node:fs';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { eq, and, lte, ne } from 'drizzle-orm';
import { RETENTION_SECONDS, type RetentionTier } from '@muxaro/shared';
import { getDb, getMuxaroRedis, mediaJobs } from '@muxaro/db';
import { getS3Client, getR2BucketName } from './s3-client.js';
import { getStorageArtifactPath } from './stream-pipeline.js';
import type { CleanupJobPayload } from './types.js';

export const CLEANUP_QUEUE_NAME = 'cleanup';

export class CleanupWorkerManager {
  private worker: Worker<CleanupJobPayload> | null = null;
  private queue: Queue<CleanupJobPayload> | null = null;
  private sweeperInterval: NodeJS.Timeout | null = null;

  constructor(private readonly redisUrl: string = process.env.REDIS_URL || 'redis://127.0.0.1:6380') {}

  /**
   * Initializes the BullMQ cleanup queue producer
   */
  public getQueue(): Queue<CleanupJobPayload> {
    if (!this.queue) {
      this.queue = new Queue<CleanupJobPayload>(CLEANUP_QUEUE_NAME, {
        connection: { url: this.redisUrl },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      });
    }
    return this.queue;
  }

  /**
   * Schedules a delayed cleanup job for an output artifact
   */
  public async scheduleCleanup(payload: CleanupJobPayload): Promise<void> {
    try {
      const queue = this.getQueue();
      const retentionSeconds = RETENTION_SECONDS[payload.retentionTier] || 3600;
      const delayMs = retentionSeconds * 1000;
      const sanitizedJobId = `cleanup_${payload.jobId.replace(/[:]/g, '_')}`;

      await queue.add('cleanup-artifact', payload, {
        delay: delayMs,
        jobId: sanitizedJobId,
      });
    } catch (err: any) {
      console.warn(`[CleanupWorker] Warning: Failed to schedule delayed cleanup for job ${payload.jobId}:`, err.message);
    }
  }

  /**
   * Starts the BullMQ worker processing delayed artifact evictions
   */
  public startWorker(concurrency: number = 5): Worker<CleanupJobPayload> {
    if (this.worker) return this.worker;

    this.worker = new Worker<CleanupJobPayload>(
      CLEANUP_QUEUE_NAME,
      async (job: Job<CleanupJobPayload>) => {
        await this.processEviction(job.data);
      },
      {
        connection: { url: this.redisUrl },
        concurrency,
      }
    );

    this.worker.on('failed', (job: Job<CleanupJobPayload> | undefined, err: Error) => {
      console.error(`[CleanupWorker] Job ${job?.id} failed eviction:`, err.message);
    });

    return this.worker;
  }

  /**
   * Evicts an artifact from S3 / R2 and updates its lifecycle status in PostgreSQL
   */
  public async processEviction(payload: CleanupJobPayload): Promise<void> {
    const s3Client = getS3Client();
    const bucket = getR2BucketName();

    // 1. Delete object from R2 / S3
    if (payload.storageKey) {
      try {
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: payload.storageKey,
          })
        );
      } catch (err: any) {
        // If object is already gone (404 / NoSuchKey), proceed gracefully
        if (err.name !== 'NoSuchKey' && err.$metadata?.httpStatusCode !== 404) {
          throw err;
        }
      }

      // 1b. Delete local disk artifacts if present
      try {
        const { artifactPath, directPath } = getStorageArtifactPath(payload.storageKey);
        if (fs.existsSync(artifactPath)) {
          fs.unlinkSync(artifactPath);
        }
        if (fs.existsSync(directPath)) {
          fs.unlinkSync(directPath);
        }
      } catch (err: any) {
        console.warn(`[CleanupWorker] Failed deleting local disk artifact for job ${payload.jobId}:`, err.message);
      }
    }

    // 2. Mark media_jobs record as 'expired' in database
    try {
      const db = getDb();
      await db
        .update(mediaJobs)
        .set({
          stage: 'expired',
          stageMessage: `Artifact expired after ${payload.retentionTier} retention window and purged from storage.`,
          updatedAt: new Date(),
        })
        .where(eq(mediaJobs.id, payload.jobId));
    } catch {
      // Non-fatal if DB record is already pruned or unavailable
    }

    // 3. Mark Redis job state expired
    try {
      const redis = getMuxaroRedis();
      await redis.updateJobState(payload.jobId, {
        stage: 'expired',
        stageMessage: `Artifact expired after ${payload.retentionTier} retention window and purged from storage.`,
        downloadUrl: '',
      });
    } catch {
      // Non-fatal
    }
  }

  /**
   * Immediately deletes an artifact upon user request (e.g. DELETE /v1/downloads/:id)
   */
  public async deleteImmediately(jobId: string, storageKey: string): Promise<void> {
    // 1. Remove scheduled BullMQ delayed job if still waiting
    const queue = this.getQueue();
    const sanitizedJobId = `cleanup_${jobId.replace(/[:]/g, '_')}`;
    const delayedJob = await queue.getJob(sanitizedJobId);
    if (delayedJob) {
      await delayedJob.remove().catch(() => {});
    }

    // 2. Evict immediately from R2 / S3 / local disk and mark expired
    await this.processEviction({
      jobId,
      storageKey,
      retentionTier: '60m',
    });
  }

  /**
   * Starts periodic background sweeper to catch any expired artifacts directly
   * from PostgreSQL whose timer elapsed during worker downtime.
   */
  public startPeriodicSweeper(intervalMs: number = 15 * 60 * 1000): void {
    if (this.sweeperInterval) return;

    this.sweeperInterval = setInterval(async () => {
      try {
        const db = getDb();
        const now = new Date();

        // Query up to 100 expired un-purged media jobs
        const expiredRecords = await db
          .select({
            id: mediaJobs.id,
            storageKey: mediaJobs.outputStorageKey,
            retentionTier: mediaJobs.retentionTier,
          })
          .from(mediaJobs)
          .where(
            and(
              lte(mediaJobs.expiresAt, now),
              ne(mediaJobs.stage, 'expired')
            )
          )
          .limit(100);

        for (const record of expiredRecords) {
          if (record.storageKey) {
            await this.processEviction({
              jobId: record.id,
              storageKey: record.storageKey,
              retentionTier: record.retentionTier as RetentionTier,
            });
          }
        }
      } catch (err: any) {
        console.error('[CleanupSweeper] Error sweeping expired artifacts:', err.message);
      }
    }, intervalMs);
  }

  /**
   * Graceful shutdown of worker, queue, and sweeper
   */
  public async close(): Promise<void> {
    if (this.sweeperInterval) {
      clearInterval(this.sweeperInterval);
      this.sweeperInterval = null;
    }
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }
}

let globalCleanupManager: CleanupWorkerManager | null = null;

export function getCleanupManager(): CleanupWorkerManager {
  if (!globalCleanupManager) {
    globalCleanupManager = new CleanupWorkerManager();
  }
  return globalCleanupManager;
}
