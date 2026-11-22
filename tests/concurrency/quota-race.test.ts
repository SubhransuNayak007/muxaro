/**
 * Project VYRO - Independent QA & Concurrency Test Suite
 * Test File: tests/concurrency/quota-race.test.ts
 *
 * Verifies Quota Race Conditions, High-Concurrency Contention,
 * Boundary Rolling 24h Windows, and Atomic Rollback Guarantees
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  EntitlementsEngine,
  InMemoryEntitlementStore,
  QuotaExceededError,
} from '../../packages/entitlements/dist/index.js';

describe('Quota Race Condition - Thundering Herd Contention', () => {
  let engine: EntitlementsEngine;
  let store: InMemoryEntitlementStore;

  beforeEach(() => {
    store = new InMemoryEntitlementStore();
    engine = new EntitlementsEngine(store);
  });

  it('should allow exactly 2 out of 50 concurrent requests when only 2 slots remain', async () => {
    const userId = 'usr_race_thundering_herd';

    // 1. Consume 8 video jobs first
    for (let i = 1; i <= 8; i++) {
      const res = await engine.reserveJobQuota({
        userId,
        userTier: 'free',
        jobType: 'VIDEO_DOWNLOAD',
        jobId: `job_prep_${i}`,
      });
      await engine.commitJobQuota(res.reservationId);
    }

    // Verify 8 used, 2 remaining
    const beforeSummary = await engine.getQuotaSummary(userId, 'free');
    assert.strictEqual(beforeSummary.buckets.video.used, 8);
    assert.strictEqual(beforeSummary.buckets.video.remaining, 2);

    // 2. Fire 50 simultaneous concurrent reservation requests
    const concurrency = 50;
    const promises = Array.from({ length: concurrency }, (_, idx) => {
      return engine
        .reserveJobQuota({
          userId,
          userTier: 'free',
          jobType: 'VIDEO_DOWNLOAD',
          jobId: `job_burst_${idx + 1}`,
        })
        .then((reservation) => ({ success: true as const, reservation }))
        .catch((err) => ({ success: false as const, error: err }));
    });

    const results = await Promise.all(promises);

    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    // Commit any succeeded reservations
    for (const s of succeeded) {
      if (s.reservation) {
        await engine.commitJobQuota(s.reservation.reservationId);
      }
    }

    // 3. Assertions: EXACTLY 2 must succeed, EXACTLY 48 must fail!
    assert.strictEqual(
      succeeded.length,
      2,
      `Expected exactly 2 requests to succeed, but got ${succeeded.length}`
    );
    assert.strictEqual(
      failed.length,
      48,
      `Expected exactly 48 requests to fail, but got ${failed.length}`
    );

    // Verify all failures were QuotaExceededError
    for (const f of failed) {
      assert.ok(
        f.error instanceof QuotaExceededError,
        `Expected QuotaExceededError, got ${(f.error as Error)?.name}: ${(f.error as Error)?.message}`
      );
    }

    // 4. Verify post-condition: total used MUST BE EXACTLY 10, remaining EXACTLY 0!
    const afterSummary = await engine.getQuotaSummary(userId, 'free');
    assert.strictEqual(afterSummary.buckets.video.used, 10, 'Total consumed video jobs must not exceed 10');
    assert.strictEqual(afterSummary.buckets.video.remaining, 0, 'Remaining must be exactly 0');
  });

  it('should allow exactly 1 out of 25 concurrent requests for playlist quota', async () => {
    const userId = 'usr_race_playlist_contention';

    // Free tier allows exactly 1 playlist job per 24 hours
    const concurrency = 25;
    const promises = Array.from({ length: concurrency }, (_, idx) => {
      return engine
        .reserveJobQuota({
          userId,
          userTier: 'free',
          jobType: 'PLAYLIST_DOWNLOAD',
          jobId: `job_pl_burst_${idx + 1}`,
          itemCount: 15,
        })
        .then((reservation) => ({ success: true as const, reservation }))
        .catch((err) => ({ success: false as const, error: err }));
    });

    const results = await Promise.all(promises);

    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    for (const s of succeeded) {
      if (s.reservation) {
        await engine.commitJobQuota(s.reservation.reservationId);
      }
    }

    // Exactly 1 must succeed, exactly 24 must fail
    assert.strictEqual(succeeded.length, 1, 'Only 1 playlist job must succeed');
    assert.strictEqual(failed.length, 24, '24 playlist jobs must be rejected');

    const summary = await engine.getQuotaSummary(userId, 'free');
    assert.strictEqual(summary.buckets.playlist.used, 1);
    assert.strictEqual(summary.buckets.playlist.remaining, 0);
  });
});

describe('Quota Concurrency - Multi-User Isolation & Deadlock Freedom', () => {
  it('should handle 10 concurrent users with 5 concurrent requests each without deadlock', async () => {
    const store = new InMemoryEntitlementStore();
    const engine = new EntitlementsEngine(store);

    const userCount = 10;
    const requestsPerUser = 5;

    const allPromises: Promise<{ userIdx: number; success: boolean }>[] = [];

    for (let u = 0; u < userCount; u++) {
      const userId = `usr_multi_${u}`;
      for (let r = 0; r < requestsPerUser; r++) {
        allPromises.push(
          engine
            .reserveJobQuota({
              userId,
              userTier: 'free',
              jobType: 'VIDEO_DOWNLOAD',
              jobId: `job_u${u}_r${r}`,
            })
            .then(() => ({ userIdx: u, success: true }))
            .catch(() => ({ userIdx: u, success: false }))
        );
      }
    }

    const start = performance.now();
    const results = await Promise.all(allPromises);
    const duration = performance.now() - start;

    assert.strictEqual(results.length, userCount * requestsPerUser);
    // Since each user requested 5 jobs and limit is 10, ALL 50 requests must succeed!
    const succeededCount = results.filter((r) => r.success).length;
    assert.strictEqual(succeededCount, 50, 'All 50 requests across 10 distinct users must succeed');
    assert.ok(duration < 3000, `Execution took ${duration.toFixed(1)}ms, should be under 3000ms`);
  });
});

describe('Quota Boundary - Rolling 24-Hour Time Window Dynamics', () => {
  it('should reject request at T=23h59m59s and accept request at T=24h00m01s', async () => {
    const store = new InMemoryEntitlementStore();
    const engine = new EntitlementsEngine(store);

    const userId = 'usr_rolling_boundary';
    const T0 = 1700000000000; // Base epoch

    // 1. Consume 10 jobs at T0
    for (let i = 1; i <= 10; i++) {
      await store.saveReservation({
        reservationId: `res_boundary_${i}`,
        userId,
        jobId: `job_boundary_${i}`,
        jobType: 'VIDEO_DOWNLOAD',
        bucket: 'video',
        cost: 1,
        itemCount: 1,
        status: 'COMMITTED',
        createdAt: T0,
        expiresAt: T0 + 900000,
        committedAt: T0,
      });
    }

    // Verify 10 used, 0 remaining at T0 + 1 second
    const check1 = await engine.canExecuteJob(userId, 'free', 'VIDEO_DOWNLOAD', 1, T0 + 1000);
    assert.strictEqual(check1.allowed, false, 'At T0+1s, user must have 0 remaining');
    assert.strictEqual(check1.used, 10);
    assert.strictEqual(check1.remaining, 0);

    // 2. Boundary Test 1: Exactly 23 hours, 59 minutes, 59 seconds after T0
    const T_boundary_before = T0 + (24 * 3600 - 1) * 1000;
    const checkBefore = await engine.canExecuteJob(userId, 'free', 'VIDEO_DOWNLOAD', 1, T_boundary_before);
    assert.strictEqual(
      checkBefore.allowed,
      false,
      'At T=23h59m59s, 24-hour window has not elapsed; quota MUST remain exhausted'
    );
    assert.strictEqual(checkBefore.remaining, 0);
    assert.strictEqual(checkBefore.resetInSeconds, 1, 'Reset countdown should report 1 second remaining');

    // 3. Boundary Test 2: Exactly 24 hours, 00 minutes, 01 seconds after T0
    const T_boundary_after = T0 + (24 * 3600 + 1) * 1000;
    const checkAfter = await engine.canExecuteJob(userId, 'free', 'VIDEO_DOWNLOAD', 1, T_boundary_after);
    assert.strictEqual(
      checkAfter.allowed,
      true,
      'At T=24h00m01s, 24-hour window has elapsed; quota MUST be restored'
    );
    assert.strictEqual(checkAfter.used, 0, 'Used count should be 0 as all 10 jobs rolled off');
    assert.strictEqual(checkAfter.remaining, 10, 'Remaining should be restored to 10');
  });
});

describe('Quota Concurrency - Rollback Contention', () => {
  it('should cleanly race 1 rollback against 10 competing new requests', async () => {
    const store = new InMemoryEntitlementStore();
    const engine = new EntitlementsEngine(store);

    const userId = 'usr_rollback_race';

    // Consume all 10 jobs
    const reservations: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const res = await engine.reserveJobQuota({
        userId,
        userTier: 'free',
        jobType: 'VIDEO_DOWNLOAD',
        jobId: `job_rb_${i}`,
      });
      reservations.push(res.reservationId);
    }

    // Now fire 1 rollback and 10 new reservation attempts in parallel
    const rollbackPromise = engine.rollbackJobQuota(reservations[0]!, 'Cancelled by user');
    const newReservationPromises = Array.from({ length: 10 }, (_, idx) => {
      return engine
        .reserveJobQuota({
          userId,
          userTier: 'free',
          jobType: 'VIDEO_DOWNLOAD',
          jobId: `job_replacement_${idx + 1}`,
        })
        .then(() => ({ success: true }))
        .catch(() => ({ success: false }));
    });

    const [rbResult, ...newResults] = await Promise.all([
      rollbackPromise,
      ...newReservationPromises,
    ]);

    assert.ok(rbResult.reservationId);
    assert.strictEqual(rbResult.status, 'ROLLED_BACK');

    const successfulNew = newResults.filter((r) => r.success);
    // Exactly 1 new reservation should have captured the released slot!
    assert.strictEqual(
      successfulNew.length,
      1,
      `Expected exactly 1 request to claim the rolled back slot, but got ${successfulNew.length}`
    );
  });
});
