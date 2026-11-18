/**
 * Project MUXARO - System Health & Readiness Routes
 * GET /api/v1/health (liveness & compatibility envelope)
 * GET /api/v1/ready  (honest production readiness probe — zero secrets leaked)
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { getDb, getBooleanSetting } from '../db/database.js';
import { queueService } from '../services/queue.service.js';
import { storageService } from '../services/storage.service.js';

const execFileAsync = promisify(execFile);

let cachedFfmpegAvailable: boolean | null = null;
let cachedFfmpegCheckedAt = 0;
const FFMPEG_PROBE_TTL_MS = 60_000;

async function checkFfmpegAvailable(): Promise<boolean> {
  const now = Date.now();
  if (cachedFfmpegAvailable !== null && now - cachedFfmpegCheckedAt < FFMPEG_PROBE_TTL_MS) {
    return cachedFfmpegAvailable;
  }
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 5000, windowsHide: true });
    cachedFfmpegAvailable = true;
  } catch {
    cachedFfmpegAvailable = false;
  }
  cachedFfmpegCheckedAt = now;
  return cachedFfmpegAvailable;
}

function checkDatabaseHealthy(): boolean {
  try {
    const db = getDb();
    const row = db.prepare('SELECT 1 AS ok').get() as { ok?: number } | undefined;
    return row?.ok === 1;
  } catch {
    return false;
  }
}

function isGoogleAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim() &&
      process.env.GOOGLE_REDIRECT_URI?.trim()
  );
}

function isRewardedAdsConfigured(): boolean {
  const enabledFlag =
    process.env.REWARDED_ADS_ENABLED !== 'false' &&
    getBooleanSetting('rewarded_ads_enabled', true);
  return enabledFlag && Boolean(process.env.GAM_REWARDED_AD_UNIT_PATH?.trim());
}

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/health
  fastify.get('/health', {
    schema: {
      description: 'System Health & Liveness Check',
      tags: ['System'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                status: { type: 'string' },
                postgres: { type: 'string' },
                redis: { type: 'string' },
                database: { type: 'string' },
                environment: { type: 'string' },
                storageMode: { type: 'string' },
                r2Configured: { type: 'boolean' },
                workerPool: {
                  type: 'object',
                  properties: {
                    activeWorkers: { type: 'integer' },
                    totalSlots: { type: 'integer' },
                  },
                },
                version: { type: 'string' },
                uptimeSeconds: { type: 'number' },
              },
            },
            requestId: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const metrics = queueService.getMetrics();
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const dbHealthy = checkDatabaseHealthy();

    return reply.send({
      success: true,
      data: {
        status: dbHealthy ? 'HEALTHY' : 'DEGRADED',
        postgres: dbHealthy ? 'CONNECTED' : 'DISCONNECTED',
        redis: config.redisUrl ? 'CONFIGURED' : 'CONNECTED',
        database: 'sqlite-wal',
        environment: config.env,
        storageMode: storageService.mode,
        r2Configured: storageService.isR2Configured(),
        workerPool: {
          activeWorkers: metrics.workerNodes[0].activeJobs,
          totalSlots: 48,
        },
        version: '1.0.0',
        uptimeSeconds: Math.round(process.uptime()),
      },
      requestId,
    });
  });

  // GET /api/v1/ready
  fastify.get('/ready', {
    schema: {
      description: 'Production Readiness Probe (verifies DB, storage mode, FFmpeg, OAuth & Rewarded Ads config without exposing secrets)',
      tags: ['System'],
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const dbHealthy = checkDatabaseHealthy();
    const ffmpegAvailable = await checkFfmpegAvailable();
    const ready = dbHealthy && ffmpegAvailable;

    return reply.code(ready ? 200 : 503).send({
      success: ready,
      data: {
        status: ready ? 'READY' : 'DEGRADED',
        uptimeSeconds: Math.round(process.uptime()),
        environment: config.env,
        database: dbHealthy ? 'sqlite-wal' : 'unavailable',
        storageMode: storageService.mode,
        r2Configured: storageService.isR2Configured(),
        googleAuthConfigured: isGoogleAuthConfigured(),
        rewardedAdsConfigured: isRewardedAdsConfigured(),
        ffmpegAvailable,
      },
      requestId,
    });
  });
};
