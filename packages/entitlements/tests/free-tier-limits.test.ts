/**
 * @file free-tier-limits.test.ts
 * Tests for Free Tier limits: exactly 10 video jobs / 24h, 1 playlist job / 24h (cap 50 items)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EntitlementsEngine } from '../src/engine.js';
import { QuotaExceededError, PlaylistSizeExceededError } from '../src/errors.js';

describe('Free Tier Quota Limits', () => {
  it('allows exactly 10 individual video jobs in rolling 24 hours and rejects the 11th', async () => {
    const engine = new EntitlementsEngine();
    const userId = 'usr_free_user_1';

    // Submit 10 individual video jobs
    for (let i = 1; i <= 10; i++) {
      const res = await engine.reserveJobQuota({
        userId,
        userTier: 'free',
        jobType: 'VIDEO_DOWNLOAD',
        jobId: `job_vid_${i}`,
      });
      assert.equal(res.status, 'PENDING');
      assert.equal(res.bucket, 'video');

      // Commit the reservation
      await engine.commitJobQuota(res.reservationId);
    }

    // Check summary after 10 jobs
    const summary = await engine.getQuotaSummary(userId, 'free');
    assert.equal(summary.buckets.video.used, 10);
    assert.equal(summary.buckets.video.limit, 10);
    assert.equal(summary.buckets.video.remaining, 0);
    assert.ok(summary.buckets.video.resetInSeconds > 0, 'Reset countdown must be > 0');

    // 11th video job must be rejected with QuotaExceededError
    await assert.rejects(
      async () => {
        await engine.reserveJobQuota({
          userId,
          userTier: 'free',
          jobType: 'VIDEO_DOWNLOAD',
          jobId: 'job_vid_11',
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof QuotaExceededError);
        assert.equal(err.code, 'QUOTA_EXCEEDED');
        assert.equal(err.bucket, 'video');
        assert.equal(err.used, 10);
        assert.equal(err.limit, 10);
        return true;
      }
    );
  });

  it('allows exactly 1 playlist job per rolling 24 hours and rejects the 2nd', async () => {
    const engine = new EntitlementsEngine();
    const userId = 'usr_free_user_playlist';

    // Submit 1 playlist job with 25 items
    const res1 = await engine.reserveJobQuota({
      userId,
      userTier: 'free',
      jobType: 'PLAYLIST_DOWNLOAD',
      itemCount: 25,
      jobId: 'job_pl_1',
    });
    assert.equal(res1.status, 'PENDING');
    assert.equal(res1.bucket, 'playlist');
    await engine.commitJobQuota(res1.reservationId);

    // Summary should show 1/1 playlist used
    const summary = await engine.getQuotaSummary(userId, 'free');
    assert.equal(summary.buckets.playlist.used, 1);
    assert.equal(summary.buckets.playlist.limit, 1);
    assert.equal(summary.buckets.playlist.remaining, 0);

    // 2nd playlist job must be rejected
    await assert.rejects(
      async () => {
        await engine.reserveJobQuota({
          userId,
          userTier: 'free',
          jobType: 'PLAYLIST_DOWNLOAD',
          itemCount: 10,
          jobId: 'job_pl_2',
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof QuotaExceededError);
        assert.equal(err.bucket, 'playlist');
        assert.equal(err.limit, 1);
        assert.equal(err.used, 1);
        return true;
      }
    );
  });

  it('enforces playlist items cap of 50 items on free tier', async () => {
    const engine = new EntitlementsEngine();
    const userId = 'usr_free_user_pl_cap';

    // Playlist with 50 items is permitted
    const res = await engine.reserveJobQuota({
      userId,
      userTier: 'free',
      jobType: 'PLAYLIST_DOWNLOAD',
      itemCount: 50,
      jobId: 'job_pl_50',
    });
    assert.equal(res.status, 'PENDING');
    assert.equal(res.itemCount, 50);

    // Playlist with 51 items must be rejected with PlaylistSizeExceededError
    await assert.rejects(
      async () => {
        await engine.reserveJobQuota({
          userId: 'usr_free_user_pl_cap_2',
          userTier: 'free',
          jobType: 'PLAYLIST_DOWNLOAD',
          itemCount: 51,
          jobId: 'job_pl_51',
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof PlaylistSizeExceededError);
        assert.equal(err.code, 'PLAYLIST_SIZE_EXCEEDED');
        assert.equal(err.maxItems, 50);
        assert.equal(err.requestedItems, 51);
        return true;
      }
    );
  });
});
