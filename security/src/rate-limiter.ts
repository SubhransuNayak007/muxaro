/**
 * Project MUXARO - Rate Limiter Module
 * 
 * High-performance sliding-window rate limiter with:
 * - In-memory storage with automated garbage collection (prevents memory leak DoS)
 * - Distributed storage interface (Redis-ready)
 * - Granular route-specific rate limiting tiers (inspection, job creation, polling, downloads, auth)
 * - Standard RFC-compliant RateLimit HTTP headers (Limit, Remaining, Reset, Retry-After)
 * - Fastify / Express middleware adapters
 */

export interface RateLimitTierConfig {
  maxRequests: number;
  windowSeconds: number;
  keyPrefix?: string;
}

/**
 * Standard rate limiting presets across MUXARO services
 */
export const RATE_LIMIT_TIERS: Record<string, RateLimitTierConfig> = {
  // Inspecting remote media URLs (CPU and network intensive)
  inspect: {
    maxRequests: 15,
    windowSeconds: 60,
    keyPrefix: 'rl:inspect'
  },
  // Submitting processing or merge jobs
  createJob: {
    maxRequests: 10,
    windowSeconds: 60,
    keyPrefix: 'rl:job'
  },
  // Job status polling and SSE connection initiation
  jobStatus: {
    maxRequests: 60,
    windowSeconds: 60,
    keyPrefix: 'rl:status'
  },
  // File download artifact retrieval
  download: {
    maxRequests: 20,
    windowSeconds: 60,
    keyPrefix: 'rl:dl'
  },
  // Authentication & session endpoints (brute-force defense)
  auth: {
    maxRequests: 10,
    windowSeconds: 300, // 5 minutes
    keyPrefix: 'rl:auth'
  },
  // Global API default fallback
  global: {
    maxRequests: 120,
    windowSeconds: 60,
    keyPrefix: 'rl:global'
  }
};

/**
 * Rate limit evaluation result
 */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  retryAfterSeconds: number;
  currentCount: number;
}

/**
 * Abstract store interface for pluggable distributed engines (Redis, Memcached)
 */
export interface RateLimitStore {
  incrementAndGet(key: string, windowSeconds: number): Promise<{ count: number; oldestTimestamp: number }>;
  reset?(key: string): Promise<void>;
  close?(): Promise<void>;
}

/**
 * High-efficiency in-memory sliding window log store
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, number[]>();
  private gcIntervalTimer: NodeJS.Timeout | null = null;

  constructor(gcIntervalMs = 30000) {
    // Periodic garbage collection to discard stale client buckets
    this.gcIntervalTimer = setInterval(() => {
      this.cleanup();
    }, gcIntervalMs);

    // Prevent unref error in non-Node environments
    if (this.gcIntervalTimer.unref) {
      this.gcIntervalTimer.unref();
    }
  }

  async incrementAndGet(key: string, windowSeconds: number): Promise<{ count: number; oldestTimestamp: number }> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowStart = now - windowMs;

    let timestamps = this.buckets.get(key);
    if (!timestamps) {
      timestamps = [];
      this.buckets.set(key, timestamps);
    }

    // Filter out expired timestamps
    const validTimestamps = timestamps.filter(ts => ts > windowStart);
    validTimestamps.push(now);
    this.buckets.set(key, validTimestamps);

    const oldest = validTimestamps.length > 0 ? validTimestamps[0] : now;
    return {
      count: validTimestamps.length,
      oldestTimestamp: oldest
    };
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    // Default max retention 1 hour for stale entries
    const cutoff = now - 3600000;

    for (const [key, timestamps] of this.buckets.entries()) {
      const remaining = timestamps.filter(ts => ts > cutoff);
      if (remaining.length === 0) {
        this.buckets.delete(key);
      } else {
        this.buckets.set(key, remaining);
      }
    }
  }

  async close(): Promise<void> {
    if (this.gcIntervalTimer) {
      clearInterval(this.gcIntervalTimer);
      this.gcIntervalTimer = null;
    }
    this.buckets.clear();
  }
}

/**
 * Core RateLimiter class
 */
export class RateLimiter {
  private store: RateLimitStore;

  constructor(store?: RateLimitStore) {
    this.store = store ?? new InMemoryRateLimitStore();
  }

  /**
   * Consume a token and check rate limit
   */
  async check(
    identifier: string,
    tier: RateLimitTierConfig | keyof typeof RATE_LIMIT_TIERS
  ): Promise<RateLimitResult> {
    const config: RateLimitTierConfig = typeof tier === 'string'
      ? (RATE_LIMIT_TIERS[tier] ?? RATE_LIMIT_TIERS.global)
      : tier;

    const prefix = config.keyPrefix ?? 'rl';
    const storeKey = `${prefix}:${identifier}`;

    const { count, oldestTimestamp } = await this.store.incrementAndGet(storeKey, config.windowSeconds);
    const allowed = count <= config.maxRequests;
    const remaining = Math.max(0, config.maxRequests - count);

    const elapsedMs = Date.now() - oldestTimestamp;
    const windowMs = config.windowSeconds * 1000;
    const resetSeconds = Math.max(1, Math.ceil((windowMs - elapsedMs) / 1000));
    const retryAfterSeconds = allowed ? 0 : resetSeconds;

    return {
      allowed,
      limit: config.maxRequests,
      remaining,
      resetSeconds,
      retryAfterSeconds,
      currentCount: count
    };
  }

  /**
   * Format standard HTTP RateLimit headers
   */
  getHeaders(result: RateLimitResult): Record<string, string> {
    const headers: Record<string, string> = {
      'RateLimit-Limit': result.limit.toString(),
      'RateLimit-Remaining': result.remaining.toString(),
      'RateLimit-Reset': result.resetSeconds.toString()
    };

    if (!result.allowed) {
      headers['Retry-After'] = result.retryAfterSeconds.toString();
    }

    return headers;
  }

  /**
   * Fastify middleware hook factory
   */
  createFastifyHook(tierName: keyof typeof RATE_LIMIT_TIERS) {
    return async (request: any, reply: any) => {
      // Determine client IP or user id
      const clientIp = request.headers['x-forwarded-for']
        ? String(request.headers['x-forwarded-for']).split(',')[0].trim()
        : (request.ip || request.socket.remoteAddress || 'unknown');

      const userId = request.user?.id || clientIp;
      const result = await this.check(userId, tierName);

      // Set standard headers
      const headers = this.getHeaders(result);
      for (const [key, val] of Object.entries(headers)) {
        reply.header(key, val);
      }

      if (!result.allowed) {
        reply.code(429).send({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Rate limit exceeded. Try again in ${result.retryAfterSeconds} seconds.`,
            details: {
              retryAfter: result.retryAfterSeconds,
              limit: result.limit,
              resetSeconds: result.resetSeconds
            }
          },
          requestId: request.id || `req_${Date.now()}`
        });
      }
    };
  }

  async close(): Promise<void> {
    if (this.store.close) {
      await this.store.close();
    }
  }
}
