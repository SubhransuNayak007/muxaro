/**
 * MUXARO Media Processing Platform - Typed Redis Client & Topology Helper
 * 
 * Implements the centralized Redis topology for MUXARO:
 * 1. muxaro:analyse:{platform}:{hash}       (EX 86400 - Extractor metadata cache)
 * 2. muxaro:dedup:{jobHash}                  (SET NX EX 600 - Distributed compute deduplication)
 * 3. muxaro:events:job:{jobId}               (Pub/Sub channel for real-time SSE progress)
 * 4. muxaro:proxy:{proxyId}:health           (HSET/HGET - Proxy health metrics & scores)
 * 5. muxaro:profile:{profileType}:state      (HSET - Client profile rotation & cooldowns)
 * 6. muxaro:circuit:{serviceName}            (STRING - Circuit breaker states: CLOSED/OPEN/HALF_OPEN)
 * 7. muxaro:ratelimit:api:{subject}:{group}  (ZSET - Atomic sliding-window rate limiting)
 * 8. muxaro:heartbeat:{type}:{workerId}      (EX 30 - Real-time worker telemetry heartbeats)
 */

import { Redis, type RedisOptions } from 'ioredis';
import type {
  MediaAnalysisResult,
  JobProgressEvent,
  CircuitState,
  WorkerTelemetry,
} from '@muxaro/shared';

// =============================================================================
// 1. TOPOLOGY KEY GENERATORS & CONSTANTS
// =============================================================================

export const REDIS_KEYS = {
  analyseCache: (platform: string, hash: string) => `muxaro:analyse:${platform.toLowerCase()}:${hash}`,
  dedupLock: (jobHash: string) => `muxaro:dedup:${jobHash}`,
  jobEventsChannel: (jobId: string) => `muxaro:events:job:${jobId}`,
  proxyHealth: (proxyId: string) => `muxaro:proxy:${proxyId}:health`,
  profileState: (profileType: string) => `muxaro:profile:${profileType.toLowerCase()}:state`,
  circuitBreaker: (serviceName: string) => `muxaro:circuit:${serviceName.toLowerCase()}`,
  rateLimitZset: (subjectKey: string, routeGroup: string) => `muxaro:ratelimit:api:${subjectKey}:${routeGroup}`,
  workerHeartbeat: (workerType: string, workerId: string) => `muxaro:heartbeat:${workerType.toLowerCase()}:${workerId}`,
  quotaActive: (subject: string) => `muxaro:quota:active:${subject}`,
  quotaDaily: (subject: string, yyyyMmDd: string) => `muxaro:quota:daily:${subject}:${yyyyMmDd}`,
  jobState: (jobId: string) => `muxaro:job:state:${jobId}`,
} as const;

export const DEFAULT_TTLS = {
  analyseCacheSeconds: 86400, // 24 hours
  dedupLockSeconds: 600,      // 10 minutes
  circuitTripSeconds: 60,     // 1 minute default trip
  workerHeartbeatSeconds: 30, // 30 seconds TTL
} as const;

// =============================================================================
// 2. TYPED MUXARO REDIS CLIENT
// =============================================================================

export class MuxaroRedisClient {
  private readonly client: Redis;
  private readonly subscriberClient?: Redis;

  constructor(clientOrOptions?: Redis | string | RedisOptions) {
    const retryStrategy = (times: number) => {
      if (process.env.NODE_ENV === 'test') return null;
      if (times > 5) return null;
      return Math.min(times * 100, 2000);
    };

    if (clientOrOptions instanceof Redis) {
      this.client = clientOrOptions;
    } else if (typeof clientOrOptions === 'string') {
      this.client = new Redis(clientOrOptions, {
        maxRetriesPerRequest: null,
        lazyConnect: false,
        enableOfflineQueue: true,
        retryStrategy,
      });
    } else {
      const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6380';
      this.client = new Redis(redisUrl, {
        ...(clientOrOptions || {}),
        maxRetriesPerRequest: null,
        lazyConnect: false,
        enableOfflineQueue: true,
        retryStrategy,
      });
    }
    this.client.on('error', () => {
      // Silently capture unhandled socket error events
    });
  }

  /**
   * Raw ioredis client accessor
   */
  public get raw(): Redis {
    return this.client;
  }

  /**
   * Connects client if not connected
   */
  public async connect(): Promise<void> {
    if (this.client.status === 'wait') {
      await this.client.connect();
    }
  }

  /**
   * Disconnects client
   */
  public async quit(): Promise<void> {
    if (this.subscriberClient) {
      await this.subscriberClient.quit();
    }
    await this.client.quit();
  }

  // ===========================================================================
  // 3. ANALYSE CACHE (muxaro:analyse:{platform}:{hash})
  // ===========================================================================

  public async getAnalyseCache(platform: string, hash: string): Promise<MediaAnalysisResult | null> {
    try {
      const key = REDIS_KEYS.analyseCache(platform, hash);
      const data = await this.client.get(key);
      if (!data) return null;
      return JSON.parse(data) as MediaAnalysisResult;
    } catch {
      return null;
    }
  }

  public async setAnalyseCache(
    platform: string,
    hash: string,
    result: MediaAnalysisResult,
    ttlSeconds: number = DEFAULT_TTLS.analyseCacheSeconds
  ): Promise<void> {
    try {
      const key = REDIS_KEYS.analyseCache(platform, hash);
      await this.client.set(key, JSON.stringify(result), 'EX', ttlSeconds);
    } catch {
      // Ignore cache write error when disconnected
    }
  }

  // ===========================================================================
  // 4. DEDUPLICATION LOCK (muxaro:dedup:{jobHash})
  // ===========================================================================

  /**
   * Attempts to acquire an atomic deduplication lock for a job hash.
   * Returns true if lock was acquired, false if a matching job is already executing.
   */
  public async tryAcquireDedupLock(
    jobHash: string,
    ttlSeconds: number = DEFAULT_TTLS.dedupLockSeconds
  ): Promise<boolean> {
    try {
      const key = REDIS_KEYS.dedupLock(jobHash);
      const acquired = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
      return acquired === 'OK';
    } catch {
      return true;
    }
  }

  public async releaseDedupLock(jobHash: string): Promise<void> {
    try {
      const key = REDIS_KEYS.dedupLock(jobHash);
      await this.client.del(key);
    } catch {}
  }

  // ===========================================================================
  // 5. JOB EVENTS PUB/SUB (muxaro:events:job:{jobId})
  // ===========================================================================

  /**
   * Publishes real-time job progress to the Redis Pub/Sub channel
   */
  public async publishJobEvent(jobId: string, event: JobProgressEvent): Promise<number> {
    const channel = REDIS_KEYS.jobEventsChannel(jobId);
    return this.client.publish(channel, JSON.stringify(event));
  }

  /**
   * Subscribes to real-time events for a specific job. Returns an unsubscribe function.
   */
  public async subscribeJobEvents(
    jobId: string,
    onEvent: (event: JobProgressEvent) => void
  ): Promise<() => Promise<void>> {
    const subscriber = this.client.duplicate();
    await subscriber.connect();

    const channel = REDIS_KEYS.jobEventsChannel(jobId);
    await subscriber.subscribe(channel);

    subscriber.on('message', (chan, message) => {
      if (chan === channel) {
        try {
          const parsed = JSON.parse(message) as JobProgressEvent;
          onEvent(parsed);
        } catch {
          // Ignore malformed message
        }
      }
    });

    return async () => {
      try {
        await subscriber.unsubscribe(channel);
        await subscriber.quit();
      } catch {
        // Silently close
      }
    };
  }

  // ===========================================================================
  // 6. PROXY HEALTH & SCORING (muxaro:proxy:{proxyId}:health)
  // ===========================================================================

  public async recordProxyOutcome(
    proxyId: string,
    success: boolean,
    latencyMs: number
  ): Promise<void> {
    const key = REDIS_KEYS.proxyHealth(proxyId);
    const pipeline = this.client.pipeline();
    pipeline.hincrby(key, 'totalRequests', 1);
    if (success) {
      pipeline.hincrby(key, 'successCount', 1);
    } else {
      pipeline.hincrby(key, 'failureCount', 1);
    }
    pipeline.hincrby(key, 'totalLatencyMs', Math.round(latencyMs));
    pipeline.hset(key, 'lastUsedAt', new Date().toISOString());
    pipeline.expire(key, 86400 * 7); // Retain for 7 days
    await pipeline.exec();
  }

  public async getProxyHealth(
    proxyId: string
  ): Promise<{ successRate: number; totalRequests: number; avgLatencyMs: number } | null> {
    const key = REDIS_KEYS.proxyHealth(proxyId);
    const data = await this.client.hgetall(key);
    if (!data || Object.keys(data).length === 0) return null;

    const total = Number.parseInt(data.totalRequests || '0', 10);
    const successes = Number.parseInt(data.successCount || '0', 10);
    const totalLatency = Number.parseInt(data.totalLatencyMs || '0', 10);

    return {
      totalRequests: total,
      successRate: total > 0 ? (successes / total) * 100 : 100,
      avgLatencyMs: total > 0 ? Math.round(totalLatency / total) : 0,
    };
  }

  // ===========================================================================
  // 7. CLIENT PROFILE ROTATION (muxaro:profile:{profileType}:state)
  // ===========================================================================

  public async getProfileState(profileType: string): Promise<Record<string, unknown> | null> {
    const key = REDIS_KEYS.profileState(profileType);
    const data = await this.client.get(key);
    if (!data) return null;
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  public async setProfileState(
    profileType: string,
    state: Record<string, unknown>,
    ttlSeconds: number = 86400
  ): Promise<void> {
    const key = REDIS_KEYS.profileState(profileType);
    await this.client.set(key, JSON.stringify(state), 'EX', ttlSeconds);
  }

  // ===========================================================================
  // 8. CIRCUIT BREAKER (muxaro:circuit:{serviceName})
  // ===========================================================================

  public async getCircuitState(serviceName: string): Promise<CircuitState> {
    const key = REDIS_KEYS.circuitBreaker(serviceName);
    const state = await this.client.get(key);
    if (state === 'OPEN' || state === 'HALF_OPEN') {
      return state;
    }
    return 'CLOSED';
  }

  public async tripCircuit(
    serviceName: string,
    durationSeconds: number = DEFAULT_TTLS.circuitTripSeconds
  ): Promise<void> {
    const key = REDIS_KEYS.circuitBreaker(serviceName);
    await this.client.set(key, 'OPEN', 'EX', durationSeconds);
  }

  public async setCircuitHalfOpen(serviceName: string, durationSeconds: number = 30): Promise<void> {
    const key = REDIS_KEYS.circuitBreaker(serviceName);
    await this.client.set(key, 'HALF_OPEN', 'EX', durationSeconds);
  }

  public async resetCircuit(serviceName: string): Promise<void> {
    const key = REDIS_KEYS.circuitBreaker(serviceName);
    await this.client.del(key);
  }

  // ===========================================================================
  // 9. SLIDING WINDOW RATE LIMITER (muxaro:ratelimit:api:{subject}:{group})
  // ===========================================================================

  /**
   * Atomic sliding-window rate limiter using Redis ZSET.
   * Removes timestamps older than (now - windowSeconds), adds current timestamp,
   * and checks if current count is within limit.
   */
  public async checkSlidingWindowRateLimit(
    subjectKey: string,
    routeGroup: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; resetMs: number; currentCount: number }> {
    const key = REDIS_KEYS.rateLimitZset(subjectKey, routeGroup);
    const now = Date.now();
    const clearBefore = now - windowSeconds * 1000;
    const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;

    const pipeline = this.client.pipeline();
    pipeline.zremrangebyscore(key, 0, clearBefore);
    pipeline.zadd(key, now, member);
    pipeline.zcard(key);
    pipeline.expire(key, windowSeconds + 10);

    const results = await pipeline.exec();
    if (!results) {
      return { allowed: true, remaining: limit, resetMs: now + windowSeconds * 1000, currentCount: 0 };
    }

    const currentCount = (results[2][1] as number) || 0;
    const allowed = currentCount <= limit;
    const remaining = Math.max(0, limit - currentCount);
    const resetMs = now + windowSeconds * 1000;

    return { allowed, remaining, resetMs, currentCount };
  }

  // ===========================================================================
  // 10. WORKER TELEMETRY & HEARTBEATS (muxaro:heartbeat:{type}:{workerId})
  // ===========================================================================

  public async sendWorkerHeartbeat(
    workerType: 'media' | 'analyse',
    workerId: string,
    telemetry: WorkerTelemetry,
    ttlSeconds: number = DEFAULT_TTLS.workerHeartbeatSeconds
  ): Promise<void> {
    const key = REDIS_KEYS.workerHeartbeat(workerType, workerId);
    await this.client.set(key, JSON.stringify(telemetry), 'EX', ttlSeconds);
  }

  public async getActiveWorkers(
    workerType?: 'media' | 'analyse'
  ): Promise<WorkerTelemetry[]> {
    const pattern = workerType
      ? `muxaro:heartbeat:${workerType.toLowerCase()}:*`
      : 'muxaro:heartbeat:*';
    const keys = await this.client.keys(pattern);
    if (!keys || keys.length === 0) return [];

    const rawValues = await this.client.mget(keys);
    const workers: WorkerTelemetry[] = [];
    for (const raw of rawValues) {
      if (raw) {
        try {
          workers.push(JSON.parse(raw) as WorkerTelemetry);
        } catch {
          // ignore parsing error
        }
      }
    }
    return workers;
  }

  // ===========================================================================
  // 11. ATOMIC QUOTA & CONCURRENCY (muxaro:quota:active, muxaro:quota:daily)
  // ===========================================================================

  /**
   * Atomically acquires active concurrent slot and daily quota counter via Lua.
   * Returns { success: true, code: 'OK' } or { success: false, code: 'CONCURRENT_LIMIT_REACHED' | 'DAILY_QUOTA_REACHED' }
   */
  public async acquireJobQuota(
    subject: string,
    jobId: string,
    maxConcurrent: number,
    maxDailyJobs: number,
    dateStr?: string
  ): Promise<{ success: boolean; code: string }> {
    const today = dateStr || new Date().toISOString().split('T')[0];
    const activeKey = REDIS_KEYS.quotaActive(subject);
    const dailyKey = REDIS_KEYS.quotaDaily(subject, today);

    try {
      const res = (await this.client.eval(
        ACQUIRE_QUOTA_LUA,
        2,
        activeKey,
        dailyKey,
        jobId,
        maxConcurrent.toString(),
        maxDailyJobs.toString()
      )) as [number, string];

      const allowed = res[0] === 1;
      return {
        success: allowed,
        code: res[1],
      };
    } catch {
      return {
        success: true,
        code: 'OK',
      };
    }
  }

  /**
   * Releases an active job from the concurrent active jobs set
   */
  public async releaseActiveJob(subject: string, jobId: string): Promise<void> {
    try {
      const activeKey = REDIS_KEYS.quotaActive(subject);
      await this.client.srem(activeKey, jobId);
    } catch {}
  }

  // ===========================================================================
  // 12. CENTRALIZED LIVE JOB STATE (muxaro:job:state:{jobId})
  // ===========================================================================

  public async setJobState(jobId: string, state: Record<string, unknown>, ttlSeconds = 86400): Promise<void> {
    try {
      const key = REDIS_KEYS.jobState(jobId);
      await this.client.set(key, JSON.stringify(state), 'EX', ttlSeconds);
    } catch {}
  }

  public async getJobState(jobId: string): Promise<Record<string, unknown> | null> {
    try {
      const key = REDIS_KEYS.jobState(jobId);
      const raw = await this.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  public async updateJobState(jobId: string, updates: Record<string, unknown>, ttlSeconds = 86400): Promise<Record<string, unknown>> {
    try {
      const current = (await this.getJobState(jobId)) || {};
      const merged = { ...current, ...updates, updatedAt: new Date().toISOString() };
      await this.setJobState(jobId, merged, ttlSeconds);
      return merged;
    } catch {
      return updates;
    }
  }
}

export const ACQUIRE_QUOTA_LUA = `
local active_key = KEYS[1]
local daily_key = KEYS[2]
local job_id = ARGV[1]
local max_concurrent = tonumber(ARGV[2])
local max_daily_jobs = tonumber(ARGV[3])

-- 1. Check active concurrent jobs
local active_count = redis.call('SCARD', active_key)
if active_count >= max_concurrent then
    return {0, 'CONCURRENT_LIMIT_REACHED'}
end

-- 2. Check daily job limit
local daily_raw = redis.call('GET', daily_key)
local daily_count = daily_raw and tonumber(daily_raw) or 0
if daily_count >= max_daily_jobs then
    return {0, 'DAILY_QUOTA_REACHED'}
end

-- 3. Atomically allocate quota:
redis.call('SADD', active_key, job_id)
redis.call('EXPIRE', active_key, 3600)
redis.call('INCR', daily_key)
redis.call('EXPIRE', daily_key, 90000)

return {1, 'OK'}
`.trim();

// =============================================================================
// SINGLETON INSTANCE & EXPORTS
// =============================================================================

let globalRedisClient: MuxaroRedisClient | null = null;

export function getMuxaroRedis(options?: RedisOptions | string): MuxaroRedisClient {
  if (!globalRedisClient) {
    globalRedisClient = new MuxaroRedisClient(options);
  }
  return globalRedisClient;
}
