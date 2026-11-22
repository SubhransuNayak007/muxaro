/**
 * MUXARO Media Processing Platform - Analysis Worker Service
 * 
 * High-throughput worker processing BullMQ `lane:analyse` jobs with concurrency (20-50).
 * Orchestrates URL canonicalization, SSRF protection, Redis manifest caching (1800s / 600s),
 * rotating client profiles (tv_embedded, ios, mweb, web), sticky proxy routing,
 * outbound rate limiting (8-12 req/s with 150-450ms jitter), and worker telemetry heartbeats.
 */

import process from 'node:process';
import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import {
  MuxaroError,
  assertSafeMediaUrl,
  LANE_QUEUES,
  type MediaAnalysisResult,
} from '@muxaro/shared';
import { HeartbeatReporter } from './heartbeat.js';
import { ManifestCacheManager } from './cache.js';
import { OutboundRateLimiter } from './token-bucket.js';
import { ProxyManager } from './proxy-manager.js';
import { YouTubeExtractor } from './extractors/youtube.js';
import { VimeoExtractor } from './extractors/vimeo.js';
import { DirectMediaExtractor } from './extractors/direct.js';

export interface AnalyseJobPayload {
  url: string;
  forceRefresh?: boolean;
  poToken?: string;
  requestedBy?: string;
  tier?: string;
}

// =============================================================================
// 1. INITIALIZATION & CONFIGURATION
// =============================================================================

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6380';

// Clamp concurrency between 20 and 50 as specified
const RAW_CONCURRENCY = Number.parseInt(process.env.ANALYSE_CONCURRENCY || '25', 10);
const CONCURRENCY = Math.min(50, Math.max(20, Number.isNaN(RAW_CONCURRENCY) ? 25 : RAW_CONCURRENCY));

// Dedicated Redis clients for BullMQ worker and shared services
const redisConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const serviceRedis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

// Telemetry counters
let activeJobsCount = 0;
let totalCompleted = 0;
let totalFailed = 0;

// Subsystems
const cache = new ManifestCacheManager(serviceRedis);
const proxyManager = new ProxyManager(serviceRedis);
const rateLimiter = new OutboundRateLimiter(serviceRedis);

const youtubeExtractor = new YouTubeExtractor({ proxyManager, rateLimiter });
const vimeoExtractor = new VimeoExtractor({ proxyManager, rateLimiter });
const directExtractor = new DirectMediaExtractor();

// Worker heartbeat reporter
const heartbeat = new HeartbeatReporter(serviceRedis, {
  getActiveJobs: () => activeJobsCount,
  getStats: () => ({ totalCompleted, totalFailed }),
});

// =============================================================================
// 2. BULLMQ WORKER PIPELINE
// =============================================================================

console.log(
  `[worker-analyse] Starting Muxaro Analysis Worker on queue "analyse" (prefix "lane") with concurrency=${CONCURRENCY}...`
);

export const worker = new Worker<AnalyseJobPayload, MediaAnalysisResult>(
  'analyse',
  async (job: Job<AnalyseJobPayload, MediaAnalysisResult>) => {
    activeJobsCount += 1;
    const { url, forceRefresh, poToken } = job.data;

    try {
      if (!url || typeof url !== 'string' || url.trim().length === 0) {
        throw MuxaroError.badRequest('Missing or empty media URL for analysis');
      }

      await job.updateProgress({ stage: 'analysing', progress: 10 });

      // 1. SSRF defense & URL canonicalization
      const canonical = await assertSafeMediaUrl(url);

      const cacheKeyId = canonical.id || canonical.canonicalUrl;

      // 2. Redis Manifest Cache Lookup
      if (!forceRefresh) {
        const cached = await cache.get(canonical.platform, cacheKeyId);
        if (cached) {
          await job.updateProgress({ stage: 'ready', progress: 100 });
          totalCompleted += 1;
          return cached;
        }
      }

      await job.updateProgress({ stage: 'analysing', progress: 35 });

      // 3. Platform Extraction Routing
      let analysisResult: MediaAnalysisResult;

      switch (canonical.platform) {
        case 'youtube': {
          analysisResult = await youtubeExtractor.extract(canonical.canonicalUrl, poToken);
          break;
        }
        case 'vimeo': {
          analysisResult = await vimeoExtractor.extract(canonical.canonicalUrl);
          break;
        }
        case 'direct':
        default: {
          analysisResult = await directExtractor.extract(canonical.canonicalUrl);
          break;
        }
      }

      // 4. Cache Result in Redis (1800s for YouTube/Vimeo, 600s for direct)
      await cache.set(canonical.platform, cacheKeyId, analysisResult);

      await job.updateProgress({ stage: 'ready', progress: 100 });
      totalCompleted += 1;

      return analysisResult;
    } catch (err) {
      totalFailed += 1;
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[worker-analyse] Job ${job.id} failed:`, errorMessage);

      if (err instanceof MuxaroError) {
        throw new Error(JSON.stringify(err.toJSON()));
      }
      throw err;
    } finally {
      activeJobsCount = Math.max(0, activeJobsCount - 1);
    }
  },
  {
    prefix: 'lane',
    connection: redisConnection,
    concurrency: CONCURRENCY,
    lockDuration: 30_000,
  }
);

// Worker lifecycle event listeners
worker.on('ready', () => {
  console.log(`[worker-analyse] Worker connected and listening for jobs on "${LANE_QUEUES.analyse}"`);
  heartbeat.start();
});

worker.on('error', (err: Error) => {
  console.error('[worker-analyse] Worker encountered error:', err);
});

worker.on('failed', (job: Job<AnalyseJobPayload, MediaAnalysisResult> | undefined, err: Error) => {
  console.warn(`[worker-analyse] Job ${job?.id} failed: ${err.message}`);
});

// =============================================================================
// 3. GRACEFUL SHUTDOWN
// =============================================================================

let isShuttingDown = false;

export async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[worker-analyse] Received ${signal}. Initiating graceful shutdown...`);

  try {
    // 1. Stop heartbeat reporter
    await heartbeat.stop();

    // 2. Close BullMQ worker (allows active jobs to drain within grace period)
    console.log('[worker-analyse] Closing BullMQ worker...');
    await worker.close();

    // 3. Close Redis connections
    console.log('[worker-analyse] Closing Redis connections...');
    await serviceRedis.quit();
    await redisConnection.quit();

    console.log('[worker-analyse] Graceful shutdown completed cleanly.');
    process.exit(0);
  } catch (err) {
    console.error('[worker-analyse] Error during graceful shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
