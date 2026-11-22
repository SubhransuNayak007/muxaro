/**
 * MUXARO Media Processing Platform - BullMQ Queue Manager
 *
 * Manages connections and telemetry for BullMQ execution queues:
 * - lane:analyse (Metadata inspection)
 * - lane:fast-io (Zero-copy stream copy & fast extractions)
 * - lane:transcode (Heavy FFmpeg CPU/GPU re-encoding)
 * - lane:batch (Playlist fan-out and ZIP archiving)
 */

import { Queue, QueueEvents } from 'bullmq';
import type { LaneType, LaneDepth } from '@muxaro/shared';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6380';

function parseRedisUrl(urlStr: string) {
  const retryStrategy = (times: number) => {
    if (process.env.NODE_ENV === 'test') return null;
    if (times > 5) return null;
    return Math.min(times * 100, 2000);
  };

  try {
    const parsed = new URL(urlStr);
    return {
      host: parsed.hostname || '127.0.0.1',
      port: parsed.port ? Number.parseInt(parsed.port, 10) : 6380,
      password: parsed.password || undefined,
      maxRetriesPerRequest: null,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy,
    };
  } catch {
    return {
      host: '127.0.0.1',
      port: 6380,
      maxRetriesPerRequest: null,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy,
    };
  }
}

const connectionOptions = parseRedisUrl(REDIS_URL);

let analyseQueue: Queue | null = null;
let fastIoQueue: Queue | null = null;
let transcodeQueue: Queue | null = null;
let batchQueue: Queue | null = null;
let analyseQueueEvents: QueueEvents | null = null;

export function getAnalyseQueue(): Queue {
  if (!analyseQueue) {
    analyseQueue = new Queue('analyse', {
      prefix: 'lane',
      connection: connectionOptions,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
    analyseQueue.on('error', () => {});
  }
  return analyseQueue;
}

export function getAnalyseQueueEvents(): QueueEvents {
  if (!analyseQueueEvents) {
    analyseQueueEvents = new QueueEvents('analyse', {
      prefix: 'lane',
      connection: connectionOptions,
    });
    analyseQueueEvents.on('error', () => {});
  }
  return analyseQueueEvents;
}

export function getFastIoQueue(): Queue {
  if (!fastIoQueue) {
    fastIoQueue = new Queue('fast-io', {
      prefix: 'lane',
      connection: connectionOptions,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
    fastIoQueue.on('error', () => {});
  }
  return fastIoQueue;
}

export function getTranscodeQueue(): Queue {
  if (!transcodeQueue) {
    transcodeQueue = new Queue('transcode', {
      prefix: 'lane',
      connection: connectionOptions,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
    transcodeQueue.on('error', () => {});
  }
  return transcodeQueue;
}

export function getBatchQueue(): Queue {
  if (!batchQueue) {
    batchQueue = new Queue('batch', {
      prefix: 'lane',
      connection: connectionOptions,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
    batchQueue.on('error', () => {});
  }
  return batchQueue;
}

export function getQueueByLane(lane: LaneType | 'analyse'): Queue {
  switch (lane) {
    case 'analyse':
      return getAnalyseQueue();
    case 'fast_io':
      return getFastIoQueue();
    case 'transcode':
      return getTranscodeQueue();
    case 'batch':
      return getBatchQueue();
    default:
      return getFastIoQueue();
  }
}

/**
 * Gathers queue depths across all BullMQ processing lanes
 */
export async function getQueueDepths(): Promise<Record<string, LaneDepth>> {
  const queues = [
    { name: 'lane:analyse', queue: getAnalyseQueue() },
    { name: 'lane:fast-io', queue: getFastIoQueue() },
    { name: 'lane:transcode', queue: getTranscodeQueue() },
    { name: 'lane:batch', queue: getBatchQueue() },
  ];

  const results: Record<string, LaneDepth> = {};

  await Promise.all(
    queues.map(async ({ name, queue }) => {
      try {
        const countsPromise = queue.getJobCounts(
          'waiting',
          'active',
          'completed',
          'failed',
          'delayed'
        );
        const counts = await Promise.race([
          countsPromise,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 500)),
        ]);
        results[name] = {
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
        };
      } catch {
        results[name] = {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        };
      }
    })
  );

  return results;
}

/**
 * Closes all active BullMQ queue instances during graceful shutdown
 */
export async function closeQueues(): Promise<void> {
  const instances = [
    analyseQueueEvents,
    analyseQueue,
    fastIoQueue,
    transcodeQueue,
    batchQueue,
  ];

  for (const inst of instances) {
    if (inst) {
      try {
        await inst.close();
      } catch {
        // Silently close during shutdown
      }
    }
  }

  analyseQueue = null;
  fastIoQueue = null;
  transcodeQueue = null;
  batchQueue = null;
  analyseQueueEvents = null;
}
