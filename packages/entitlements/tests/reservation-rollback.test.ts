/**
 * @file reservation-rollback.test.ts
 * Tests for atomic two-phase reservation, rollback on failure/cancellation, and TTL expiration
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EntitlementsEngine } from '../src/engine.js';
import { QuotaExceededError, InvalidReservationStateError } from '../src/errors.js';

describe('Atomic Quota Reservation & Rollback', () => {
  it('rolls back a pending reservation on job failure and immediately restores quota', async () => {
    const engine = new EntitlementsEngine();
    const userId = 'usr_rollback_1';

    // 1. Consume 9 video jobs
    for (let i = 1; i <= 9; i++) {
      const res = await engine.reserveJobQuota({
        userId,
        userTier: 'free',
        jobType: 'VIDEO_DOWNLOAD',
        jobId: `job_9_${i}`,
      });
      await engine.commitJobQuota(res.reservationId);
    }

    let summary = await engine.getQuotaSummary(userId, 'free');
    assert.equal(summary.buckets.video.remaining, 1);

    // 2. Reserve the 10th slot
    const res10 = await engine.reserveJobQuota({
      userId,
      userTier: 'free',
      jobType: 'VIDEO_DOWNLOAD',
      jobId: 'job_10_will_fail',
    });
    assert.equal(res10.status, 'PENDING');

    // 3. User is now at limit (0 remaining) while job is processing
    summary = await engine.getQuotaSummary(userId, 'free');
    assert.equal(summary.buckets.video.used, 10);
    assert.equal(summary.buckets.video.remaining, 0);

    // Another job attempt would be blocked
    await assert.rejects(
      async () => {
        await engine.reserveJobQuota({
          userId,
          userTier: 'free',
          jobType: 'VIDEO_DOWNLOAD',
          jobId: 'job_blocked',
        });
      },
      QuotaExceededError
    );

    // 4. Job fails! API or worker triggers rollbackQuota
    const rolledBack = await engine.rollbackJobQuota(res10.reservationId, 'FFmpeg transcoding crashed: OOM');
    assert.equal(rolledBack.status, 'ROLLED_BACK');
    assert.equal(rolledBack.rollbackReason, 'FFmpeg transcoding crashed: OOM');

    // 5. CRITICAL: Quota must be restored immediately back to 1 remaining!
    summary = await engine.getQuotaSummary(userId, 'free');
    assert.equal(summary.buckets.video.used, 9);
    assert.equal(summary.buckets.video.remaining, 1);

    // 6. User can now retry successfully!
    const retryRes = await engine.reserveJobQuota({
      userId,
      userTier: 'free',
      jobType: 'VIDEO_DOWNLOAD',
      jobId: 'job_10_retry',
    });
    assert.equal(retryRes.status, 'PENDING');
    await engine.commitJobQuota(retryRes.reservationId);

    summary = await engine.getQuotaSummary(userId, 'free');
    assert.equal(summary.buckets.video.used, 10);
    assert.equal(summary.buckets.video.remaining, 0);
  });

  it('rolls back quota when user cancels a job via jobId', async () => {
    const engine = new EntitlementsEngine();
    const userId = 'usr_cancel_user';
    const jobId = 'job_user_cancelled_42';

    // Reserve a playlist job
    const res = await engine.reserveJobQuota({
      userId,
      userTier: 'free',
      jobType: 'PLAYLIST_DOWNLOAD',
      itemCount: 20,
      jobId,
    });
    assert.equal(res.status, 'PENDING');

    // User cancels job
    const cancelled = await engine.rollbackJobQuota(jobId, 'Cancelled by user from web dashboard');
    assert.equal(cancelled.status, 'ROLLED_BACK');
    assert.equal(cancelled.jobId, jobId);

    // Playlist slot is available again
    const summary = await engine.getQuotaSummary(userId, 'free');
    assert.equal(summary.buckets.playlist.remaining, 1);
  });

  it('handles committed job rollback and rejects invalid state transitions', async () => {
    const engine = new EntitlementsEngine();
    const userId = 'usr_state_check';

    const res = await engine.reserveJobQuota({
      userId,
      userTier: 'free',
      jobType: 'VIDEO_DOWNLOAD',
      jobId: 'job_state_test',
    });

    // Rollback first
    await engine.rollbackJobQuota(res.reservationId, 'Test rollback');

    // Trying to commit an already rolled-back reservation must throw InvalidReservationStateError
    await assert.rejects(
      async () => {
        await engine.commitJobQuota(res.reservationId);
      },
      InvalidReservationStateError
    );
  });

  it('automatically expires abandoned reservations past TTL', async () => {
    const engine = new EntitlementsEngine(undefined, {
      defaultReservationTtlMs: 100, // short TTL 100ms
    });
    const userId = 'usr_ttl_user';

    // Reserve 10 jobs without committing them
    for (let i = 1; i <= 10; i++) {
      await engine.reserveJobQuota({
        userId,
        userTier: 'free',
        jobType: 'VIDEO_DOWNLOAD',
        jobId: `job_ttl_${i}`,
        ttlMs: 50, // 50ms TTL
      });
    }

    // Immediately after, user has 0 remaining
    let summary = await engine.getQuotaSummary(userId, 'free');
    assert.equal(summary.buckets.video.used, 10);
    assert.equal(summary.buckets.video.remaining, 0);

    // Wait 70ms for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 70));

    // Summary query triggers expiration cleanup and frees all 10 slots!
    summary = await engine.getQuotaSummary(userId, 'free');
    assert.equal(summary.buckets.video.used, 0);
    assert.equal(summary.buckets.video.remaining, 10);
  });
});
