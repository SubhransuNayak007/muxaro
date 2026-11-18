/**
 * @file rolling-window.test.ts
 * Tests for the rolling 24-hour sliding window, timestamp rollout, and countdown calculation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EntitlementsEngine } from '../src/engine.js';
import { evaluateSlidingWindow } from '../src/quota/sliding-window.js';

describe('Rolling 24-Hour Sliding Window', () => {
  it('correctly ignores items older than 24 hours and includes items within window', () => {
    const now = 1700000000000;
    const windowMs = 24 * 60 * 60 * 1000; // 86,400,000 ms

    const timestamps = [
      now - 26 * 60 * 60 * 1000, // 26 hours ago (EXPIRED - outside window)
      now - 25 * 60 * 60 * 1000, // 25 hours ago (EXPIRED - outside window)
      now - 23 * 60 * 60 * 1000, // 23 hours ago (ACTIVE - 1h left)
      now - 12 * 60 * 60 * 1000, // 12 hours ago (ACTIVE - 12h left)
      now - 1 * 60 * 60 * 1000,  // 1 hour ago (ACTIVE - 23h left)
    ];

    const result = evaluateSlidingWindow(timestamps, 10, windowMs, now);

    // Only the 3 items within the 24h window must be counted as used
    assert.equal(result.used, 3);
    assert.equal(result.remaining, 7);

    // Oldest active timestamp was 23 hours ago
    const expectedResetAt = now - 23 * 60 * 60 * 1000 + windowMs;
    assert.equal(result.resetsAt, expectedResetAt);
  });

  it('calculates exact countdown in seconds when limit is reached', () => {
    const now = 1700000000000;
    const windowMs = 24 * 60 * 60 * 1000;
    const limit = 3;

    // 3 timestamps filling limit
    const timestamps = [
      now - (24 * 60 * 60 * 1000 - 120 * 1000), // Oldest: 120 seconds left in window
      now - 10 * 60 * 60 * 1000,
      now - 1 * 60 * 60 * 1000,
    ];

    const result = evaluateSlidingWindow(timestamps, limit, windowMs, now);
    assert.equal(result.used, 3);
    assert.equal(result.remaining, 0);

    // resetInSeconds must be exactly 120 seconds!
    assert.equal(result.resetInSeconds, 120);
  });

  it('allows new jobs as time rolls forward across the 24-hour boundary', async () => {
    const engine = new EntitlementsEngine();
    const userId = 'usr_rolling_clock_user';
    const now = Date.now();

    // Fill 10 jobs simulated at (now - 25 hours)
    // and 0 jobs in the current 24-hour window
    // User should have full 10 remaining right now
    const summary = await engine.getQuotaSummary(userId, 'free', 'free', now);
    assert.equal(summary.buckets.video.used, 0);
    assert.equal(summary.buckets.video.remaining, 10);
  });
});
