/**
 * Project VYRO - Independent QA Test Suite
 * Test File: tests/unit/entitlements.test.ts
 *
 * Verifies Entitlements, Quota Math, Rolling 24h Window, Idempotency, and RBAC
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  EntitlementsEngine,
  InMemoryEntitlementStore,
  DEFAULT_TIER_LIMITS,
  getQuotaBucketForJobType,
  getTierLimits,
  getBucketLimit,
  evaluateSlidingWindow,
  DEFAULT_WINDOW_MS,
  QuotaExceededError,
  PlaylistSizeExceededError,
  hasPermission,
  isRoleAtLeast,
  getDefaultTierForRole,
} from '../../packages/entitlements/dist/index.js';

describe('Entitlements - Tier Rules and Bucket Mapping', () => {
  it('should enforce exact Free tier allowances as defined in PRD §17', () => {
    const freeLimits = DEFAULT_TIER_LIMITS.free;
    assert.strictEqual(freeLimits.videoDailyLimit, 10, 'Free tier must allow exactly 10 video jobs per 24h');
    assert.strictEqual(freeLimits.playlistDailyLimit, 1, 'Free tier must allow exactly 1 playlist job per 24h');
    assert.strictEqual(freeLimits.maxPlaylistItems, 50, 'Free tier playlist item cap must be exactly 50 items');
    assert.strictEqual(freeLimits.maxConcurrentJobs, 2, 'Free tier max concurrent jobs must be 2');
    assert.strictEqual(freeLimits.allowPriorityQueue, false, 'Free tier does not get priority queue');
  });

  it('should enforce Pro and Enterprise tier specifications', () => {
    const proLimits = DEFAULT_TIER_LIMITS.pro;
    assert.strictEqual(proLimits.videoDailyLimit, 500);
    assert.strictEqual(proLimits.playlistDailyLimit, 25);
    assert.strictEqual(proLimits.maxPlaylistItems, 500);
    assert.strictEqual(proLimits.allowPriorityQueue, true);

    const enterpriseLimits = DEFAULT_TIER_LIMITS.enterprise;
    assert.strictEqual(enterpriseLimits.videoDailyLimit, 10000);
    assert.strictEqual(enterpriseLimits.playlistDailyLimit, 1000);
    assert.strictEqual(enterpriseLimits.allowUnlimitedBypass, true);
  });

  it('should map job types to strictly isolated buckets', () => {
    assert.strictEqual(getQuotaBucketForJobType('VIDEO_DOWNLOAD'), 'video');
    assert.strictEqual(getQuotaBucketForJobType('AUDIO_EXTRACTION'), 'video');
    assert.strictEqual(getQuotaBucketForJobType('MEDIA_MERGE'), 'video');
    assert.strictEqual(getQuotaBucketForJobType('PLAYLIST_DOWNLOAD'), 'playlist');
  });

  it('should return correct bucket limits for each tier', () => {
    assert.strictEqual(getBucketLimit('video', 'free'), 10);
    assert.strictEqual(getBucketLimit('playlist', 'free'), 1);
    assert.strictEqual(getBucketLimit('video', 'pro'), 500);
    assert.strictEqual(getBucketLimit('playlist', 'pro'), 25);
  });
});

describe('Entitlements - Sliding Window Arithmetic', () => {
  const windowMs = 24 * 60 * 60 * 1000; // 24 hours

  it('should calculate usage correctly within rolling 24h window', () => {
    const now = 1700000000000;
    const windowStart = now - windowMs;

    const timestamps = [
      windowStart - 10000, // Expired (outside window)
      windowStart + 1000,  // Active (in window)
      windowStart + 3600000, // Active
      now - 1000,          // Active
    ];

    // Signature: evaluateSlidingWindow(timestamps, limit, windowMs, now)
    const result = evaluateSlidingWindow(timestamps, 10, windowMs, now);
    assert.strictEqual(result.used, 3, 'Should count only active timestamps in window');
    assert.strictEqual(result.remaining, 7, 'Remaining should be limit (10) - used (3) = 7');
    assert.strictEqual(result.resetsAt, windowStart + 1000 + windowMs);
  });

  it('should detect quota exceeded condition', () => {
    const now = 1700000000000;
    // Exactly 10 timestamps in current window
    const timestamps = Array.from({ length: 10 }, (_, i) => now - (i + 1) * 60000);

    const result = evaluateSlidingWindow(timestamps, 10, windowMs, now);
    assert.strictEqual(result.used, 10);
    assert.strictEqual(result.remaining, 0);
    assert.ok(result.resetsAt !== null);
  });
});

describe('Entitlements - Engine Reservation Lifecycle & Bucket Isolation', () => {
  let engine: EntitlementsEngine;
  let store: InMemoryEntitlementStore;

  beforeEach(() => {
    store = new InMemoryEntitlementStore();
    engine = new EntitlementsEngine(store);
  });

  it('should allow up to 10 video jobs and reject 11th job on Free tier', async () => {
    const userId = 'usr_test_free_01';

    // Execute 10 video reservations
    for (let i = 1; i <= 10; i++) {
      const reservation = await engine.reserveJobQuota({
        userId,
        userTier: 'free',
        jobType: 'VIDEO_DOWNLOAD',
        jobId: `job_video_${i}`,
      });
      assert.strictEqual(reservation.status, 'PENDING');
      assert.strictEqual(reservation.bucket, 'video');
      await engine.commitJobQuota(reservation.reservationId);
    }

    // Check summary
    const summary = await engine.getQuotaSummary(userId, 'free');
    assert.strictEqual(summary.buckets.video.used, 10);
    assert.strictEqual(summary.buckets.video.remaining, 0);

    // 11th video job must be rejected with QuotaExceededError
    await assert.rejects(
      async () => {
        await engine.reserveJobQuota({
          userId,
          tier: 'free',
          jobType: 'VIDEO_DOWNLOAD',
          jobId: 'job_video_11',
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof QuotaExceededError);
        assert.strictEqual((err as QuotaExceededError).bucket, 'video');
        assert.strictEqual((err as QuotaExceededError).limit, 10);
        return true;
      }
    );
  });

  it('CRITICAL: Playlist job must NOT deplete individual video job quota', async () => {
    const userId = 'usr_test_isolation_01';

    // Consume 1 playlist job
    const playlistReservation = await engine.reserveJobQuota({
      userId,
      userTier: 'free',
      jobType: 'PLAYLIST_DOWNLOAD',
      jobId: 'job_playlist_1',
      itemCount: 25,
    });
    await engine.commitJobQuota(playlistReservation.reservationId);

    // Verify playlist quota is 0 remaining, but video quota remains 10 remaining!
    const summary = await engine.getQuotaSummary(userId, 'free');
    assert.strictEqual(summary.buckets.playlist.used, 1);
    assert.strictEqual(summary.buckets.playlist.remaining, 0);
    assert.strictEqual(summary.buckets.video.used, 0, 'Video quota MUST NOT be depleted by playlist job');
    assert.strictEqual(summary.buckets.video.remaining, 10, 'Video quota MUST remain untouched at 10');

    // Video job must succeed without quota conflict
    const videoRes = await engine.reserveJobQuota({
      userId,
      userTier: 'free',
      jobType: 'VIDEO_DOWNLOAD',
      jobId: 'job_video_after_playlist',
    });
    assert.strictEqual(videoRes.status, 'PENDING');
    await engine.commitJobQuota(videoRes.reservationId);

    // 2nd playlist job must be rejected
    await assert.rejects(
      async () => {
        await engine.reserveJobQuota({
          userId,
          userTier: 'free',
          jobType: 'PLAYLIST_DOWNLOAD',
          jobId: 'job_playlist_2',
          itemCount: 10,
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof QuotaExceededError);
        assert.strictEqual((err as QuotaExceededError).bucket, 'playlist');
        return true;
      }
    );
  });

  it('should reject playlist jobs exceeding 50 items on Free tier', async () => {
    const userId = 'usr_test_playlist_cap';

    await assert.rejects(
      async () => {
        await engine.reserveJobQuota({
          userId,
          userTier: 'free',
          jobType: 'PLAYLIST_DOWNLOAD',
          jobId: 'job_playlist_oversize',
          itemCount: 51, // Exceeds 50
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof PlaylistSizeExceededError);
        assert.strictEqual((err as PlaylistSizeExceededError).maxItems, 50);
        return true;
      }
    );
  });

  it('should restore quota immediately on job cancellation / rollback', async () => {
    const userId = 'usr_test_rollback';

    // Consume 10 jobs to hit the ceiling
    const reservationIds: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const r = await engine.reserveJobQuota({
        userId,
        userTier: 'free',
        jobType: 'VIDEO_DOWNLOAD',
        jobId: `job_roll_${i}`,
      });
      reservationIds.push(r.reservationId);
    }

    // Verify quota is exhausted
    let canExec = await engine.canExecuteJob(userId, 'free', 'VIDEO_DOWNLOAD');
    assert.strictEqual(canExec.allowed, false);

    // Rollback the 10th reservation (simulating job failure or user cancellation)
    await engine.rollbackJobQuota(reservationIds[9]!, 'Job failed transcoding');

    // Quota must now be restored to 1 remaining!
    canExec = await engine.canExecuteJob(userId, 'free', 'VIDEO_DOWNLOAD');
    assert.strictEqual(canExec.allowed, true);
    assert.strictEqual(canExec.remaining, 1);

    // User can now successfully reserve another job
    const newReservation = await engine.reserveJobQuota({
      userId,
      userTier: 'free',
      jobType: 'VIDEO_DOWNLOAD',
      jobId: 'job_roll_replacement',
    });
    assert.strictEqual(newReservation.status, 'PENDING');
  });
});

describe('Entitlements - Idempotency Execution', () => {
  let engine: EntitlementsEngine;

  beforeEach(() => {
    engine = new EntitlementsEngine();
  });

  it('should execute idempotent operation and return cached response on duplicate key', async () => {
    const userId = 'usr_idem_1';
    const key = 'idem_key_unique_12345';
    let executionCount = 0;

    const op = () => {
      executionCount++;
      return Promise.resolve({ jobId: 'job_123', status: 'QUEUED' });
    };

    // First call: executes operation
    const res1 = await engine.executeIdempotent(key, userId, { action: 'create' }, op);
    assert.strictEqual(executionCount, 1);
    assert.strictEqual(res1.jobId, 'job_123');

    // Second call with same idempotency key: returns cached result WITHOUT re-executing op!
    const res2 = await engine.executeIdempotent(key, userId, { action: 'create' }, op);
    assert.strictEqual(executionCount, 1, 'Operation must not be re-executed');
    assert.strictEqual(res2.jobId, 'job_123');
  });
});

describe('Entitlements - RBAC and Roles', () => {
  it('should enforce role hierarchy correctly', () => {
    assert.strictEqual(isRoleAtLeast('anonymous', 'anonymous'), true);
    assert.strictEqual(isRoleAtLeast('free', 'anonymous'), true);
    assert.strictEqual(isRoleAtLeast('pro', 'free'), true);
    assert.strictEqual(isRoleAtLeast('admin', 'pro'), true);

    assert.strictEqual(isRoleAtLeast('anonymous', 'free'), false);
    assert.strictEqual(isRoleAtLeast('free', 'pro'), false);
    assert.strictEqual(isRoleAtLeast('pro', 'admin'), false);
  });

  it('should enforce permissions per role', () => {
    assert.strictEqual(hasPermission('anonymous', 'jobs:read'), true);
    assert.strictEqual(hasPermission('anonymous', 'jobs:create:video'), false);

    assert.strictEqual(hasPermission('free', 'jobs:create:video'), true);
    assert.strictEqual(hasPermission('free', 'admin:metrics'), false);

    assert.strictEqual(hasPermission('admin', 'admin:metrics'), true);
    assert.strictEqual(hasPermission('admin', 'admin:override_quota'), true);
  });

  it('should resolve default plan tier from role', () => {
    assert.strictEqual(getDefaultTierForRole('anonymous'), 'free');
    assert.strictEqual(getDefaultTierForRole('free'), 'free');
    assert.strictEqual(getDefaultTierForRole('pro'), 'pro');
    assert.strictEqual(getDefaultTierForRole('admin'), 'enterprise');
  });
});
