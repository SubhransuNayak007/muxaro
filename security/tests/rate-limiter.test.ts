/**
 * Rate Limiter & Abuse Prevention Test Suite
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RateLimiter,
  InMemoryRateLimitStore,
  RATE_LIMIT_TIERS
} from '../src/rate-limiter.ts';

test('Rate Limiter - Enforces sliding window limits per client', async () => {
  const store = new InMemoryRateLimitStore();
  const limiter = new RateLimiter(store);

  const customTier = { maxRequests: 3, windowSeconds: 10, keyPrefix: 'test' };

  // Request 1: allowed
  const r1 = await limiter.check('192.0.2.1', customTier);
  assert.equal(r1.allowed, true);
  assert.equal(r1.remaining, 2);
  assert.equal(r1.currentCount, 1);

  // Request 2: allowed
  const r2 = await limiter.check('192.0.2.1', customTier);
  assert.equal(r2.allowed, true);
  assert.equal(r2.remaining, 1);
  assert.equal(r2.currentCount, 2);

  // Request 3: allowed (at limit)
  const r3 = await limiter.check('192.0.2.1', customTier);
  assert.equal(r3.allowed, true);
  assert.equal(r3.remaining, 0);
  assert.equal(r3.currentCount, 3);

  // Request 4: blocked
  const r4 = await limiter.check('192.0.2.1', customTier);
  assert.equal(r4.allowed, false);
  assert.equal(r4.remaining, 0);
  assert.equal(r4.currentCount, 4);
  assert.ok(r4.retryAfterSeconds > 0);

  // Different IP should still have full quota
  const otherIp = await limiter.check('198.51.100.1', customTier);
  assert.equal(otherIp.allowed, true);
  assert.equal(otherIp.remaining, 2);

  await limiter.close();
});

test('Rate Limiter - Header Generation', async () => {
  const store = new InMemoryRateLimitStore();
  const limiter = new RateLimiter(store);

  const tier = { maxRequests: 5, windowSeconds: 60 };
  const res = await limiter.check('user_123', tier);
  const headers = limiter.getHeaders(res);

  assert.equal(headers['RateLimit-Limit'], '5');
  assert.equal(headers['RateLimit-Remaining'], '4');
  assert.ok(Number.parseInt(headers['RateLimit-Reset'], 10) > 0);
  assert.equal(headers['Retry-After'], undefined);

  // Burn through remaining
  await limiter.check('user_123', tier);
  await limiter.check('user_123', tier);
  await limiter.check('user_123', tier);
  await limiter.check('user_123', tier);
  const blockedRes = await limiter.check('user_123', tier);

  const blockedHeaders = limiter.getHeaders(blockedRes);
  assert.equal(blockedHeaders['RateLimit-Remaining'], '0');
  assert.ok(Number.parseInt(blockedHeaders['Retry-After'], 10) > 0);

  await limiter.close();
});

test('Rate Limiter - Standard Tiers Sanity Check', () => {
  assert.ok(RATE_LIMIT_TIERS.inspect.maxRequests > 0);
  assert.ok(RATE_LIMIT_TIERS.createJob.maxRequests > 0);
  assert.ok(RATE_LIMIT_TIERS.jobStatus.maxRequests >= RATE_LIMIT_TIERS.createJob.maxRequests);
  assert.ok(RATE_LIMIT_TIERS.auth.windowSeconds >= 60);
});
