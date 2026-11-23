/**
 * MUXARO Media Processing Platform - Multi-Lane Media Worker Service
 * 
 * Orchestrates distributed media processing across isolated BullMQ execution lanes:
 * 1. lane:fast-io    - 8-16 concurrency: zero-copy stream copy, audio extraction, remuxing
 * 2. lane:transcode  - 1-2 concurrency (pinned): bounded heavy video transcoding & merges
 * 3. lane:batch      - 2-4 concurrency: playlist fan-out & streaming STORE-mode ZIP packaging
 * 4. cleanup         - Delayed eviction worker (exact 60m for guests, 24h for users)
 * 
 * Features:
 * - Real-time telemetry heartbeat to muxaro:heartbeat:media:{workerId} (EX 30)
 * - Server-Sent Events progress publishing to Redis Pub/Sub
 * - Full AbortSignal cancellation support
 * - Zero-loss graceful shutdown with 20s drain timeout
 */

import { Worker, type Job } from 'bullmq';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import {
  LANE_QUEUES,
  MuxaroError,
  type LaneQueueName,
  type JobProgressEvent,
} from '@muxaro/shared';
import { getDb, closeDb, mediaJobs, getMuxaroRedis } from '@muxaro/db';
import { StreamPipeline } from './stream-pipeline.js';
import { BatchZipper } from './batch-zipper.js';
import { getCleanupManager, CLEANUP_QUEUE_NAME } from './cleanup-worker.js';
import { getWorkerHeartbeat, MediaWorkerHeartbeat } from './heartbeat.js';
import { getS3Client, getR2BucketName } from './s3-client.js';
import type {
  MediaJobPayload,
  BatchJobPayload,
  PipelineProcessingResult,
  BatchPackagingResult,
} from './types.js';

// =============================================================================
// 1. CONFIGURATION & STATE
// =============================================================================

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6380';
const FAST_IO_CONCURRENCY = Math.min(16, Math.max(8, Number.parseInt(process.env.FAST_IO_CONCURRENCY || '12', 10)));
const TRANSCODE_CONCURRENCY = Math.min(2, Math.max(1, Number.parseInt(process.env.TRANSCODE_CONCURRENCY || '2', 10)));
const BATCH_CONCURRENCY = Math.min(4, Math.max(2, Number.parseInt(process.env.BATCH_CONCURRENCY || '2', 10)));

const heartbeat = getWorkerHeartbeat();
const cleanupManager = getCleanupManager();
const activeAbortControllers = new Map<string, AbortController>();

let fastIoWorker: Worker<MediaJobPayload> | null = null;
let transcodeWorker: Worker<MediaJobPayload> | null = null;
let batchWorker: Worker<BatchJobPayload> | null = null;
let cleanupWorker: Worker<any> | null = null;
let isShuttingDown = false;

// =============================================================================
// 2. WORKER PROCESSORS
// =============================================================================

/**
 * Handles fast I/O tasks: zero-copy remuxing, audio extraction, format wrapping
 */
async function processFastIoJob(job: Job<MediaJobPayload>): Promise<PipelineProcessingResult> {
  const data = job.data;
  const laneName = 'lane:fast-io';
  const subjectKey = data.subjectKey || (data.userId ? `user:${data.userId}` : data.guestIpHash ? `guest:${data.guestIpHash}` : undefined);

  heartbeat.incrementActive(laneName);
  const abortController = new AbortController();
  activeAbortControllers.set(data.jobId, abortController);

  try {
    await updateJobStarted(data.jobId, heartbeat.id, 'fast_io', subjectKey);

    const result = await StreamPipeline.execute({
      job: data,
      signal: abortController.signal,
    });

    await updateJobCompleted(data.jobId, result, subjectKey);

    // Schedule delayed artifact eviction
    await cleanupManager.scheduleCleanup({
      jobId: data.jobId,
      storageKey: result.storageKey,
      retentionTier: data.retentionTier,
      userId: data.userId,
    });

    heartbeat.recordCompleted();
    return result;
  } catch (err: any) {
    heartbeat.recordFailed();
    await handleJobFailure(data.jobId, err, subjectKey);
    throw err;
  } finally {
    heartbeat.decrementActive(laneName);
    activeAbortControllers.delete(data.jobId);
    if (subjectKey) {
      const redis = getMuxaroRedis();
      redis.releaseActiveJob(subjectKey, data.jobId).catch(() => {});
    }
  }
}

/**
 * Handles compute-intensive transcoding: resolution downscaling, codec transforms, A/V merges
 */
async function processTranscodeJob(job: Job<MediaJobPayload>): Promise<PipelineProcessingResult> {
  const data = job.data;
  const laneName = 'lane:transcode';
  const subjectKey = data.subjectKey || (data.userId ? `user:${data.userId}` : data.guestIpHash ? `guest:${data.guestIpHash}` : undefined);

  heartbeat.incrementActive(laneName);
  const abortController = new AbortController();
  activeAbortControllers.set(data.jobId, abortController);

  try {
    await updateJobStarted(data.jobId, heartbeat.id, 'transcode', subjectKey);

    const result = await StreamPipeline.execute({
      job: data,
      signal: abortController.signal,
    });

    await updateJobCompleted(data.jobId, result, subjectKey);

    // Schedule delayed artifact eviction
    await cleanupManager.scheduleCleanup({
      jobId: data.jobId,
      storageKey: result.storageKey,
      retentionTier: data.retentionTier,
      userId: data.userId,
    });

    heartbeat.recordCompleted();
    return result;
  } catch (err: any) {
    heartbeat.recordFailed();
    await handleJobFailure(data.jobId, err, subjectKey);
    throw err;
  } finally {
    heartbeat.decrementActive(laneName);
    activeAbortControllers.delete(data.jobId);
    if (subjectKey) {
      const redis = getMuxaroRedis();
      redis.releaseActiveJob(subjectKey, data.jobId).catch(() => {});
    }
  }
}

/**
 * Handles batch & playlist archiver jobs: streaming STORE-mode ZIP packaging directly into R2
 */
async function processBatchJob(job: Job<BatchJobPayload>): Promise<BatchPackagingResult> {
  const data = job.data;
  const laneName = 'lane:batch';
  const subjectKey = data.subjectKey || (data.userId ? `user:${data.userId}` : data.guestIpHash ? `guest:${data.guestIpHash}` : undefined);

  heartbeat.incrementActive(laneName);
  const abortController = new AbortController();
  activeAbortControllers.set(data.jobId, abortController);

  try {
    await updateJobStarted(data.jobId, heartbeat.id, 'batch', subjectKey);

    const result = await BatchZipper.execute({
      job: data,
      signal: abortController.signal,
      concurrency: 2,
    });

    await updateBatchJobCompleted(data.jobId, result, subjectKey);

    // Schedule delayed artifact eviction
    await cleanupManager.scheduleCleanup({
      jobId: data.jobId,
      storageKey: result.storageKey,
      retentionTier: data.retentionTier,
      userId: data.userId,
    });

    heartbeat.recordCompleted();
    return result;
  } catch (err: any) {
    heartbeat.recordFailed();
    await handleJobFailure(data.jobId, err, subjectKey);
    throw err;
  } finally {
    heartbeat.decrementActive(laneName);
    activeAbortControllers.delete(data.jobId);
    if (subjectKey) {
      const redis = getMuxaroRedis();
      redis.releaseActiveJob(subjectKey, data.jobId).catch(() => {});
    }
  }
}

// =============================================================================
// 3. DATABASE & REDIS STATE HELPERS
// =============================================================================

async function updateJobStarted(jobId: string, workerId: string, lane: string, subjectKey?: string): Promise<void> {
  const redis = getMuxaroRedis();
  try {
    await redis.updateJobState(jobId, {
      status: 'processing',
      stage: lane === 'transcode' ? 'encoding' : 'remuxing',
      stageMessage: `Claimed by worker ${workerId} on ${lane}`,
      workerId,
      lane,
      progressPercent: 5,
      subjectKey,
      startedAt: new Date().toISOString(),
    });

    await redis.publishJobEvent(jobId, {
      jobId,
      status: 'processing',
      stage: (lane === 'transcode' ? 'encoding' : 'remuxing') as any,
      progressPercent: 5,
      message: `Media pipeline initiated on ${lane}`,
      timestamp: new Date().toISOString(),
    });
  } catch {}

  try {
    const db = getDb();
    await db
      .update(mediaJobs)
      .set({
        status: 'processing',
        stage: lane === 'transcode' ? 'encoding' : 'remuxing',
        stageMessage: `Claimed by worker ${workerId} on ${lane}`,
        workerId,
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(mediaJobs.id, jobId));
  } catch (err: any) {
    console.warn(`[Worker] Failed to update start state in DB for job ${jobId}: ${err.message}`);
  }
}

async function updateJobCompleted(jobId: string, result: PipelineProcessingResult, subjectKey?: string): Promise<void> {
  const redis = getMuxaroRedis();
  const filename = result.filename || `${jobId}.mp4`;
  const downloadUrl = `http://127.0.0.1:4000/v1/downloads/file/${encodeURIComponent(result.storageKey)}?fn=${encodeURIComponent(filename)}`;

  try {
    await redis.updateJobState(jobId, {
      status: 'completed',
      stage: 'ready',
      stageMessage: 'Processing complete and artifact verified',
      outputStorageKey: result.storageKey,
      outputFilename: result.filename,
      outputMimeType: result.mimeType,
      outputSizeBytes: result.sizeBytes > 0 ? result.sizeBytes : null,
      durationSeconds: result.durationSeconds > 0 ? String(result.durationSeconds) : null,
      progressPercent: 100.0,
      downloadUrl,
      completedAt: new Date().toISOString(),
    });

    let effectiveSubject = subjectKey;
    if (!effectiveSubject) {
      const state = await redis.getJobState(jobId);
      if (state && typeof state.subjectKey === 'string') {
        effectiveSubject = state.subjectKey;
      }
    }
    if (effectiveSubject) {
      await redis.releaseActiveJob(effectiveSubject, jobId);
    }

    await redis.publishJobEvent(jobId, {
      jobId,
      status: 'completed',
      stage: 'ready',
      progressPercent: 100.0,
      message: 'Processing complete and artifact ready for download',
      timestamp: new Date().toISOString(),
    });
  } catch {}

  try {
    const db = getDb();
    await db
      .update(mediaJobs)
      .set({
        status: 'completed',
        stage: 'ready',
        stageMessage: 'Processing complete and artifact verified',
        outputStorageKey: result.storageKey,
        outputFilename: result.filename,
        outputMimeType: result.mimeType,
        outputSizeBytes: result.sizeBytes > 0 ? result.sizeBytes : null,
        durationSeconds: result.durationSeconds > 0 ? String(result.durationSeconds) : null,
        progressPercent: '100.00',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(mediaJobs.id, jobId));
  } catch (err: any) {
    console.warn(`[Worker] Failed to update completed state in DB for job ${jobId}: ${err.message}`);
  }
}

async function updateBatchJobCompleted(jobId: string, result: BatchPackagingResult, subjectKey?: string): Promise<void> {
  const redis = getMuxaroRedis();
  const filename = result.filename || `${jobId}.zip`;
  const downloadUrl = `http://127.0.0.1:4000/v1/downloads/file/${encodeURIComponent(result.storageKey)}?fn=${encodeURIComponent(filename)}`;

  try {
    await redis.updateJobState(jobId, {
      status: 'completed',
      stage: 'ready',
      stageMessage: `Batch ZIP packaged (${result.totalEntries} items)`,
      outputStorageKey: result.storageKey,
      outputFilename: result.filename,
      outputMimeType: 'application/zip',
      progressPercent: 100.0,
      downloadUrl,
      completedAt: new Date().toISOString(),
    });

    let effectiveSubject = subjectKey;
    if (!effectiveSubject) {
      const state = await redis.getJobState(jobId);
      if (state && typeof state.subjectKey === 'string') {
        effectiveSubject = state.subjectKey;
      }
    }
    if (effectiveSubject) {
      await redis.releaseActiveJob(effectiveSubject, jobId);
    }

    await redis.publishJobEvent(jobId, {
      jobId,
      status: 'completed',
      stage: 'ready',
      progressPercent: 100.0,
      message: `Batch ZIP packaged (${result.totalEntries} items)`,
      timestamp: new Date().toISOString(),
    });
  } catch {}

  try {
    const db = getDb();
    await db
      .update(mediaJobs)
      .set({
        status: 'completed',
        stage: 'ready',
        stageMessage: `Batch ZIP packaged (${result.totalEntries} items)`,
        outputStorageKey: result.storageKey,
        outputFilename: result.filename,
        outputMimeType: 'application/zip',
        progressPercent: '100.00',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(mediaJobs.id, jobId));
  } catch (err: any) {
    console.warn(`[Worker] Failed to update batch completed state in DB for job ${jobId}: ${err.message}`);
  }
}

async function handleJobFailure(jobId: string, err: any, subjectKey?: string): Promise<void> {
  const errorCode = err instanceof MuxaroError ? err.code : 'TRANSCODE_FAILED';
  const errorMessage = err?.message || 'Media processing execution error';
  const redis = getMuxaroRedis();

  try {
    await redis.updateJobState(jobId, {
      status: 'failed',
      stage: 'failed',
      errorCode,
      errorMessage,
      updatedAt: new Date().toISOString(),
    });

    let effectiveSubject = subjectKey;
    if (!effectiveSubject) {
      const state = await redis.getJobState(jobId);
      if (state && typeof state.subjectKey === 'string') {
        effectiveSubject = state.subjectKey;
      }
    }
    if (effectiveSubject) {
      await redis.releaseActiveJob(effectiveSubject, jobId);
    }

    const event: JobProgressEvent = {
      jobId,
      status: 'failed',
      stage: 'failed',
      progressPercent: 0,
      message: errorMessage,
      timestamp: new Date().toISOString(),
    };
    await redis.publishJobEvent(jobId, event);
  } catch {}

  try {
    const db = getDb();
    await db
      .update(mediaJobs)
      .set({
        status: 'failed',
        stage: 'failed',
        errorCode,
        errorMessage: errorMessage.slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(eq(mediaJobs.id, jobId));
  } catch {
    // Non-fatal
  }
}

// =============================================================================
// 4. FLEET INITIALIZATION & LIFECYCLE
// =============================================================================

export async function startMediaWorkerFleet(): Promise<void> {
  console.log(`[WorkerMedia] Booting fleet | Worker ID: ${heartbeat.id}`);
  console.log(`[WorkerMedia] Concurrency: fast-io=${FAST_IO_CONCURRENCY}, transcode=${TRANSCODE_CONCURRENCY}, batch=${BATCH_CONCURRENCY}`);

  // 1. Start heartbeat reporting (EX 30)
  heartbeat.start();

  // 2. Start lane:fast-io worker
  fastIoWorker = new Worker<MediaJobPayload>(
    'fast-io',
    processFastIoJob,
    {
      prefix: 'lane',
      connection: { url: REDIS_URL },
      concurrency: FAST_IO_CONCURRENCY,
    }
  );

  // 3. Start lane:transcode worker (pinned 1-2 concurrency)
  transcodeWorker = new Worker<MediaJobPayload>(
    'transcode',
    processTranscodeJob,
    {
      prefix: 'lane',
      connection: { url: REDIS_URL },
      concurrency: TRANSCODE_CONCURRENCY,
    }
  );

  // 4. Start lane:batch worker
  batchWorker = new Worker<BatchJobPayload>(
    'batch',
    processBatchJob,
    {
      prefix: 'lane',
      connection: { url: REDIS_URL },
      concurrency: BATCH_CONCURRENCY,
    }
  );

  // 5. Start cleanup worker & periodic sweeper
  cleanupWorker = cleanupManager.startWorker(5);
  cleanupManager.startPeriodicSweeper(15 * 60 * 1000);

  // 6. Listen for global cancellation broadcast on Redis
  try {
    const redis = getMuxaroRedis();
    const subscriber = redis.raw.duplicate();
    subscriber.on('error', (err) => {
      console.warn(`[WorkerMedia] Redis subscriber error: ${err.message}`);
    });
    await subscriber.subscribe('muxaro:job:cancel');

    subscriber.on('message', (channel, msg) => {
      if (channel === 'muxaro:job:cancel') {
        try {
          const { jobId } = JSON.parse(msg);
          const controller = activeAbortControllers.get(jobId);
          if (controller) {
            console.log(`[WorkerMedia] Received cancellation signal for job ${jobId}`);
            controller.abort();
          }
        } catch {
          // ignore
        }
      }
    });
  } catch (err: any) {
    console.warn(`[WorkerMedia] Could not initialize cancellation subscriber: ${err.message}`);
  }

  console.log('[WorkerMedia] All processing lanes and cleanup queue are active.');
}

// =============================================================================
// 5. GRACEFUL SHUTDOWN HANDLER
// =============================================================================

export async function stopMediaWorkerFleet(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('[WorkerMedia] Graceful shutdown initiated. Draining active jobs...');

  // 1. Pause workers to stop accepting new jobs
  const pausePromises: Promise<void>[] = [];
  if (fastIoWorker) pausePromises.push(fastIoWorker.pause());
  if (transcodeWorker) pausePromises.push(transcodeWorker.pause());
  if (batchWorker) pausePromises.push(batchWorker.pause());
  await Promise.all(pausePromises).catch(() => {});

  // 2. Set timeout to abort remaining in-flight jobs if not completed within 20s
  const drainTimeout = setTimeout(() => {
    console.warn('[WorkerMedia] Drain timeout reached. Aborting remaining in-flight jobs...');
    for (const [jobId, controller] of activeAbortControllers.entries()) {
      controller.abort();
    }
  }, 20_000);

  // 3. Close BullMQ workers
  const closePromises: Promise<void>[] = [];
  if (fastIoWorker) closePromises.push(fastIoWorker.close());
  if (transcodeWorker) closePromises.push(transcodeWorker.close());
  if (batchWorker) closePromises.push(batchWorker.close());
  if (cleanupWorker) closePromises.push(cleanupManager.close());

  await Promise.all(closePromises).catch(() => {});
  clearTimeout(drainTimeout);

  // 4. Stop heartbeat telemetry
  await heartbeat.stop();

  // 5. Close DB and Redis
  await closeDb().catch(() => {});
  const redis = getMuxaroRedis();
  await redis.quit().catch(() => {});

  console.log('[WorkerMedia] Media worker fleet shut down cleanly.');
}

// Register global error and OS termination signal listeners
process.on('unhandledRejection', (reason, promise) => {
  console.error('[WorkerMedia] Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[WorkerMedia] Uncaught Exception:', err);
});

process.on('SIGTERM', async () => {
  console.log('[WorkerMedia] Received SIGTERM');
  await stopMediaWorkerFleet();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[WorkerMedia] Received SIGINT');
  await stopMediaWorkerFleet();
  process.exit(0);
});

// Auto-start fleet if launched directly
const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && (currentFilePath.endsWith(process.argv[1]) || process.argv[1].endsWith('index.ts') || process.argv[1].endsWith('index.js'))) {
  startMediaWorkerFleet().catch((err) => {
    console.error('[WorkerMedia] Fatal bootstrap error:', err);
    process.exit(1);
  });
}
