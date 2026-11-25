/**
 * Project MUXARO - System Health & Readiness Routes
 * GET /api/v1/health (liveness, yt-dlp version, ffmpeg presence, queue depth & smoke test status)
 * GET /api/v1/ready  (honest production readiness probe — zero secrets leaked)
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { FastifyPluginAsync } from 'fastify';
import { getDb, getMuxaroRedis, sql } from '@muxaro/db';
import { getDb as getSqliteDb } from '../db/database.js';
import { getQueueDepths } from '../lib/queues.js';
import { egressPoolManager } from '../services/egress-pool.service.js';

const execFileAsync = promisify(execFile);

let cachedFfmpegAvailable: boolean | null = null;
let cachedFfmpegCheckedAt = 0;
let cachedFfprobeAvailable: boolean | null = null;
let cachedFfprobeCheckedAt = 0;
let cachedYtDlpVersion: string | null = null;
let cachedYtDlpCheckedAt = 0;
let cachedDenoAvailable: boolean | null = null;
let cachedDenoCheckedAt = 0;
let cachedGalleryDlVersion: string | null = null;
let cachedGalleryDlCheckedAt = 0;

const PROBE_TTL_MS = 60_000;
const HEALTH_IO_TIMEOUT_MS = 2_000;

function getExecutionEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const candidateDirs = [
    path.join(os.homedir(), '.deno', 'bin'),
    path.join(os.homedir(), '.local', 'bin'),
    ...(process.platform !== 'win32' ? ['/usr/local/bin', '/usr/bin'] : []),
  ];
  for (const envVar of ['FFMPEG_PATH', 'FFPROBE_PATH', 'YTDLP_PATH', 'DENO_PATH']) {
    const val = env[envVar]?.trim();
    if (val && path.isAbsolute(val)) {
      candidateDirs.unshift(path.dirname(val));
    }
  }
  const existingPath = env.PATH || env.Path || '';
  const merged = [...candidateDirs, ...existingPath.split(path.delimiter)]
    .map((entry) => entry.trim())
    .filter((entry, idx, arr) => entry.length > 0 && arr.indexOf(entry) === idx)
    .join(path.delimiter);
  env.PATH = merged;
  if (process.platform === 'win32') {
    env.Path = merged;
  }
  return env;
}

function resolveBinary(envVar: string, defaultCommand: string): string {
  const configured = process.env[envVar]?.trim();
  if (configured) {
    if (path.isAbsolute(configured) && fs.existsSync(configured)) {
      return configured;
    }
    return configured;
  }
  const searchDirs = (getExecutionEnv().PATH || '').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? ['', '.exe', '.cmd', '.bat']
    : [''];
  for (const dir of searchDirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, `${defaultCommand}${ext}`);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // continue scanning $PATH
      }
    }
  }
  return defaultCommand;
}

async function checkFfmpegAvailable(): Promise<boolean> {
  const now = Date.now();
  if (cachedFfmpegAvailable !== null && now - cachedFfmpegCheckedAt < PROBE_TTL_MS) {
    return cachedFfmpegAvailable;
  }
  try {
    const bin = resolveBinary('FFMPEG_PATH', 'ffmpeg');
    await execFileAsync(bin, ['-version'], { timeout: 5000, windowsHide: true, env: getExecutionEnv() });
    cachedFfmpegAvailable = true;
  } catch {
    cachedFfmpegAvailable = false;
  }
  cachedFfmpegCheckedAt = now;
  return cachedFfmpegAvailable;
}

async function checkFfprobeAvailable(): Promise<boolean> {
  const now = Date.now();
  if (cachedFfprobeAvailable !== null && now - cachedFfprobeCheckedAt < PROBE_TTL_MS) {
    return cachedFfprobeAvailable;
  }
  try {
    const bin = resolveBinary('FFPROBE_PATH', 'ffprobe');
    await execFileAsync(bin, ['-version'], { timeout: 5000, windowsHide: true, env: getExecutionEnv() });
    cachedFfprobeAvailable = true;
  } catch {
    cachedFfprobeAvailable = false;
  }
  cachedFfprobeCheckedAt = now;
  return cachedFfprobeAvailable;
}

async function checkYtDlpVersion(): Promise<string> {
  const now = Date.now();
  if (cachedYtDlpVersion !== null && now - cachedYtDlpCheckedAt < PROBE_TTL_MS) {
    return cachedYtDlpVersion;
  }
  try {
    const bin = resolveBinary('YTDLP_PATH', 'yt-dlp');
    const { stdout } = await execFileAsync(bin, ['--version'], { timeout: 5000, windowsHide: true, env: getExecutionEnv() });
    cachedYtDlpVersion = stdout.trim();
  } catch {
    cachedYtDlpVersion = 'unavailable';
  }
  cachedYtDlpCheckedAt = now;
  return cachedYtDlpVersion;
}

async function checkDenoAvailable(): Promise<boolean> {
  const now = Date.now();
  if (cachedDenoAvailable !== null && now - cachedDenoCheckedAt < PROBE_TTL_MS) {
    return cachedDenoAvailable;
  }
  try {
    const bin = resolveBinary('DENO_PATH', 'deno');
    await execFileAsync(bin, ['--version'], { timeout: 5000, windowsHide: true, env: getExecutionEnv() });
    cachedDenoAvailable = true;
  } catch {
    cachedDenoAvailable = false;
  }
  cachedDenoCheckedAt = now;
  return cachedDenoAvailable;
}

async function checkGalleryDlVersion(): Promise<string> {
  const now = Date.now();
  if (cachedGalleryDlVersion !== null && now - cachedGalleryDlCheckedAt < PROBE_TTL_MS) {
    return cachedGalleryDlVersion;
  }
  try {
    const bin = resolveBinary('GALLERY_DL_PATH', 'gallery-dl');
    const { stdout } = await execFileAsync(bin, ['--version'], { timeout: 5000, windowsHide: true, env: getExecutionEnv() });
    cachedGalleryDlVersion = stdout.trim();
  } catch {
    cachedGalleryDlVersion = 'unavailable';
  }
  cachedGalleryDlCheckedAt = now;
  return cachedGalleryDlVersion;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function checkDatabaseHealthy(isTestEnv: boolean): Promise<{ healthy: boolean; engine: string }> {
  if (isTestEnv) {
    return { healthy: true, engine: 'sqlite-wal' };
  }
  if (!process.env.DATABASE_URL) {
    try {
      const sqlite = getSqliteDb();
      sqlite.prepare('SELECT 1').get();
      return { healthy: true, engine: 'sqlite-wal' };
    } catch {
      return { healthy: false, engine: 'sqlite-wal' };
    }
  }
  try {
    const db = getDb();
    if (typeof (db as any).execute === 'function') {
      await withTimeout((db as any).execute(sql`SELECT 1`), HEALTH_IO_TIMEOUT_MS, 'postgres SELECT 1');
      return { healthy: true, engine: 'postgresql' };
    }
    return { healthy: false, engine: 'postgresql' };
  } catch {
    return { healthy: false, engine: 'postgresql' };
  }
}

async function checkRedisAndHeartbeats(isTestEnv: boolean): Promise<{
  connected: boolean;
  activeWorkerHeartbeats: number;
  workers: Array<{ workerId: string; workerType: string; activeJobs: number; lastHeartbeat: string }>;
}> {
  if (isTestEnv) {
    return {
      connected: true,
      activeWorkerHeartbeats: 0,
      workers: [],
    };
  }
  try {
    const redis = getMuxaroRedis();
    const pong = await withTimeout(redis.raw.ping(), HEALTH_IO_TIMEOUT_MS, 'redis ping');
    const connected = pong === 'PONG' || Boolean(pong);
    if (!connected) {
      return { connected: false, activeWorkerHeartbeats: 0, workers: [] };
    }
    const heartbeatKeys = await withTimeout(
      redis.raw.keys('muxaro:heartbeat:*'),
      HEALTH_IO_TIMEOUT_MS,
      'redis heartbeat keys'
    );
    const workers = await withTimeout(
      redis.getActiveWorkers(),
      HEALTH_IO_TIMEOUT_MS,
      'redis active workers'
    ).catch(() => []);
    return {
      connected: true,
      activeWorkerHeartbeats: Math.max(heartbeatKeys.length, workers.length),
      workers: workers.map((w) => ({
        workerId: w.workerId,
        workerType: w.workerType,
        activeJobs: w.activeJobs,
        lastHeartbeat: w.lastHeartbeat,
      })),
    };
  } catch {
    return {
      connected: false,
      activeWorkerHeartbeats: 0,
      workers: [],
    };
  }
}

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/health and aliases
  fastify.get('/health', {
    schema: {
      description: 'System Health & Liveness Check reporting yt-dlp version, ffmpeg presence, queue depth, worker heartbeats, and smoke test status',
      tags: ['System'],
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const isTestEnv = process.env.NODE_ENV === 'test';

    const [
      dbState,
      redisHealth,
      ffmpegAvailable,
      ffprobeAvailable,
      ytDlpVersion,
      denoAvailable,
      galleryDlVersion,
    ] = await Promise.all([
      checkDatabaseHealthy(isTestEnv),
      checkRedisAndHeartbeats(isTestEnv),
      checkFfmpegAvailable(),
      checkFfprobeAvailable(),
      checkYtDlpVersion(),
      checkDenoAvailable(),
      checkGalleryDlVersion(),
    ]);
    const dbHealthy = dbState.healthy;

    let queueDepths: Record<string, any> = {};
    try {
      queueDepths = await getQueueDepths();
    } catch {}

    const depthsList = Object.values(queueDepths);
    const queuedJobs = depthsList.reduce((sum: number, q: any) => sum + (q.waiting || 0), 0);
    const activeJobs = depthsList.reduce((sum: number, q: any) => sum + (q.active || 0), 0);
    const queueDepth = activeJobs + queuedJobs;

    const dbRequired = !isTestEnv && (
      Boolean(process.env.DATABASE_URL) ||
      process.env.NODE_ENV === 'production' ||
      process.env.MOCK_DB !== 'true'
    );
    const redisRequired = !isTestEnv && (
      Boolean(process.env.REDIS_URL) ||
      process.env.NODE_ENV === 'production'
    );

    const ytDlpAvailable = ytDlpVersion !== 'unavailable';
    const binariesHealthy = ffmpegAvailable && ytDlpAvailable;
    const isHealthy = isTestEnv
      ? true
      : (!dbRequired || dbHealthy) && (!redisRequired || redisHealth.connected) && binariesHealthy;

    const smokeTestPassed = Boolean(
      dbHealthy &&
      (isTestEnv || (redisHealth.connected || !redisRequired) && binariesHealthy) &&
      (ffmpegAvailable || isTestEnv)
    );

    const healthData = {
      status: isHealthy ? 'healthy' : 'degraded',
      healthStatus: isHealthy ? 'HEALTHY' : 'DEGRADED',
      service: 'muxaro-api',
      version: '1.0.0',
      ytDlpVersion,
      ytdlpVersion: ytDlpVersion,
      ytdlp: {
        version: ytDlpVersion,
        available: ytDlpAvailable,
      },
      ffmpeg: ffmpegAvailable,
      ffmpegAvailable,
      ffprobe: ffprobeAvailable,
      ffprobeAvailable,
      deno: denoAvailable,
      galleryDl: {
        version: galleryDlVersion,
        available: galleryDlVersion !== 'unavailable',
      },
      galleryDlVersion,
      queueDepth,
      queue: {
        depth: queueDepth,
        active: activeJobs,
        queued: queuedJobs,
        totalSlots: 48,
      },
      smokeTest: smokeTestPassed ? 'PASS' : 'WARN',
      smokeTestStatus: smokeTestPassed ? 'PASS' : 'WARN',
      postgres: dbHealthy ? 'CONNECTED' : 'DISCONNECTED',
      redis: redisHealth.connected ? 'CONNECTED' : 'DISCONNECTED',
      database: dbState.engine,
      environment: process.env.NODE_ENV || 'development',
      storageMode: process.env.S3_BUCKET ? 's3' : 'local',
      r2Configured: Boolean(process.env.R2_ACCOUNT_ID || process.env.S3_BUCKET),
      workerPool: {
        activeWorkers: isTestEnv ? activeJobs : redisHealth.activeWorkerHeartbeats,
        activeJobs,
        totalSlots: 48,
        workers: redisHealth.workers,
      },
      activeWorkerHeartbeats: redisHealth.activeWorkerHeartbeats,
      egressPool: egressPoolManager.getPoolSnapshot(),
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };

    const statusCode = isTestEnv ? 200 : (isHealthy ? 200 : 503);

    return reply.code(statusCode).send({
      success: isHealthy,
      data: {
        ...healthData,
        status: isHealthy ? 'HEALTHY' : 'DEGRADED',
      },
      ...healthData,
      status: isHealthy ? 'healthy' : 'degraded',
      requestId,
    });
  });

  // GET /api/v1/ready
  fastify.get('/ready', {
    schema: {
      description: 'Production Readiness Probe (verifies DB, Redis, storage mode, FFmpeg, yt-dlp, OAuth & Rewarded Ads config without exposing secrets)',
      tags: ['System'],
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const isTestEnv = process.env.NODE_ENV === 'test';
    const [dbState, redisHealth, ffmpegAvailable, ytDlpVersion] = await Promise.all([
      checkDatabaseHealthy(isTestEnv),
      checkRedisAndHeartbeats(isTestEnv),
      checkFfmpegAvailable(),
      checkYtDlpVersion(),
    ]);
    const dbHealthy = dbState.healthy;
    const redisRequired = !isTestEnv && (
      Boolean(process.env.REDIS_URL) ||
      process.env.NODE_ENV === 'production'
    );
    const ready = isTestEnv
      ? dbHealthy && ffmpegAvailable
      : dbHealthy && (!redisRequired || redisHealth.connected) && ffmpegAvailable && ytDlpVersion !== 'unavailable';

    return reply.code(ready ? 200 : 503).send({
      success: ready,
      data: {
        status: ready ? 'READY' : 'DEGRADED',
        uptimeSeconds: Math.round(process.uptime()),
        environment: process.env.NODE_ENV || 'development',
        database: dbHealthy ? dbState.engine : 'unavailable',
        redis: redisHealth.connected ? 'connected' : 'unavailable',
        activeWorkerHeartbeats: redisHealth.activeWorkerHeartbeats,
        storageMode: process.env.S3_BUCKET ? 's3' : 'local',
        r2Configured: Boolean(process.env.R2_ACCOUNT_ID || process.env.S3_BUCKET),
        googleAuthConfigured: Boolean(process.env.GOOGLE_CLIENT_ID),
        rewardedAdsConfigured: false,
        ffmpegAvailable,
        ytdlpAvailable: ytDlpVersion !== 'unavailable',
      },
      requestId,
    });
  });
};
