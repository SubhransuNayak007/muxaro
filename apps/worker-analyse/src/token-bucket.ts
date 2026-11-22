/**
 * MUXARO Media Processing Platform - Outbound Token Bucket Rate Limiter
 * 
 * Enforces outbound egress rate limits (8-12 requests/second) using an atomic
 * Redis Lua token-bucket algorithm with randomized jitter (150-450ms) to
 * prevent upstream IP bans, bot challenges, and traffic spikes.
 */

import type { Redis } from 'ioredis';
import { MuxaroError } from '@muxaro/shared';

export interface TokenBucketOptions {
  capacity?: number;       // Max burst bucket capacity (default: 12)
  refillRate?: number;     // Tokens refilled per second (default: 10, range 8-12)
  minJitterMs?: number;    // Min randomized jitter (default: 150ms)
  maxJitterMs?: number;    // Max randomized jitter (default: 450ms)
  defaultTimeoutMs?: number; // Max wait before failing with rateLimited error (default: 15000ms)
}

const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local requested = tonumber(ARGV[4] or 1)

local data = redis.call('HMGET', key, 'tokens', 'last_updated')
local tokens = tonumber(data[1])
local last_updated = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  last_updated = now_ms
else
  local delta_sec = math.max(0, (now_ms - last_updated) / 1000)
  tokens = math.min(capacity, tokens + delta_sec * refill_rate)
  last_updated = now_ms
end

if tokens >= requested then
  tokens = tokens - requested
  redis.call('HMSET', key, 'tokens', tokens, 'last_updated', last_updated)
  redis.call('EXPIRE', key, math.ceil(capacity / refill_rate) + 60)
  return {1, math.floor(tokens), 0}
else
  redis.call('HMSET', key, 'tokens', tokens, 'last_updated', last_updated)
  redis.call('EXPIRE', key, math.ceil(capacity / refill_rate) + 60)
  local deficit = requested - tokens
  local wait_ms = math.ceil((deficit / refill_rate) * 1000)
  return {0, 0, wait_ms}
end
`;

export class OutboundRateLimiter {
  private readonly redis: Redis;
  private readonly capacity: number;
  private readonly refillRate: number;
  private readonly minJitterMs: number;
  private readonly maxJitterMs: number;
  private readonly defaultTimeoutMs: number;

  constructor(redis: Redis, options?: TokenBucketOptions) {
    this.redis = redis;
    this.capacity = options?.capacity ?? 12; // Burst allowance of 12 requests
    // Refill rate clamped between 8 and 12 req/sec
    const rate = options?.refillRate ?? 10;
    this.refillRate = Math.min(12, Math.max(8, rate));
    this.minJitterMs = options?.minJitterMs ?? 150;
    this.maxJitterMs = options?.maxJitterMs ?? 450;
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 15_000;
  }

  /**
   * Generates a randomized jitter delay between minJitterMs and maxJitterMs.
   */
  public async randomJitter(minMs = this.minJitterMs, maxMs = this.maxJitterMs): Promise<void> {
    const jitter = Math.floor(minMs + Math.random() * (maxMs - minMs + 1));
    await new Promise((resolve) => setTimeout(resolve, jitter));
  }

  /**
   * Acquires a token from the Redis atomic token bucket for the target domain or service.
   * If tokens are temporarily exhausted, waits and retries until timeout.
   * Injects randomized jitter (150-450ms) upon acquisition to decorrelate concurrent requests.
   */
  public async acquire(
    domainOrService: string,
    options?: { maxWaitMs?: number; tokens?: number }
  ): Promise<void> {
    const key = `muxaro:ratelimit:outbound:${domainOrService.toLowerCase().trim()}`;
    const maxWaitMs = options?.maxWaitMs ?? this.defaultTimeoutMs;
    const requested = options?.tokens ?? 1;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const nowMs = Date.now();
      const result = (await this.redis.eval(
        TOKEN_BUCKET_LUA,
        1,
        key,
        this.capacity.toString(),
        this.refillRate.toString(),
        nowMs.toString(),
        requested.toString()
      )) as [number, number, number];

      const [allowed, , waitMs] = result;

      if (allowed === 1) {
        // Token acquired! Apply decorrelation jitter before releasing to make HTTP request
        await this.randomJitter();
        return;
      }

      // Bucket exhausted - compute backoff delay with minor jitter
      const remainingTime = maxWaitMs - (Date.now() - startTime);
      if (remainingTime <= 0) {
        break;
      }

      const backoff = Math.min(Math.max(50, waitMs), remainingTime);
      const extraJitter = Math.floor(Math.random() * 100);
      await new Promise((resolve) => setTimeout(resolve, Math.min(backoff + extraJitter, remainingTime)));
    }

    throw MuxaroError.rateLimited(
      `Outbound egress rate limit reached for "${domainOrService}". Upstream rate throttled.`,
      Math.ceil((maxWaitMs - (Date.now() - startTime)) / 1000)
    );
  }
}
