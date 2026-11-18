/**
 * @file quota-isolation.test.ts
 * Tests verifying that playlist jobs do NOT deplete video job quotas, and vice versa.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EntitlementsEngine } from '../src/engine.js';
import { QuotaExceededError } from '../src/errors.js';

describe('Quota Bucket Isolation', () => {
  it('ensures playlist jobs do NOT deplete individual video job quotas', async () => {
    const engine = new EntitlementsEngine();
    const userId = 'usr_isolation_user_1';

    // 1. Consume the single allowed playlist job
    const plRes = await engine.reserveJobQuota({
      userId,
      userTier: 'free',
      jobType: 'PLAYLIST_DOWNLOAD',
      itemCount: 45,
      jobId: 'job_pl_isolation',
    });
    await engine.commitJobQuota(plRes.reservationId);

    // Verify playlist quota is 0 remaining
    let summary = await engine.getQuotaSummary(userId, 'free');
    assert.equal(summary.buckets.playlist.used, 1);
    assert.equal(summary.buckets.playlist.remaining, 0);

    // CRITICAL ASSERTION: Video quota must still be completely untouched (10 remaining)
    assert.equal(summary.buckets.video.used, 0);
    assert.equal(summary.buckets.video.remaining, 10);

    // 2. The user can still execute all 10 individual video jobs!
    for (let i = 1; i <= 10; i++) {
      const vidRes = await engine.reserveJobQuota({
        userId,
        userTier: 'free',
        jobType: 'VIDEO_DOWNLOAD',
        jobId: `job_vid_iso_${i}`,
      });
      await engine.commitJobQuota(vidRes.reservationId);
    }

    // Now video should be 10/10, playlist 1/1
    summary = await engine.getQuotaSummary(userId, 'free');
    assert.equal(summary.buckets.video.used, 10);
    assert.equal(summary.buckets.video.remaining, 0);
    assert.equal(summary.buckets.playlist.used, 1);
    assert.equal(summary.buckets.playlist.remaining, 0);
  });

  it('ensures individual video jobs do NOT deplete playlist job quotas', async () => {
    const engine = new EntitlementsEngine();
    const userId = 'usr_isolation_user_2';

    // 1. Consume all 10 individual video jobs
    for (let i = 1; i <= 10; i++) {
      const vidRes = await engine.reserveJobQuota({
        userId,
        userTier: 'free',
        jobType: 'VIDEO_DOWNLOAD',
        jobId: `job_vid_fill_${i}`,
      });
      await engine.commitJobQuota(vidRes.reservationId);
    }

    // Verify video quota is exhausted
    let summary = await engine.getQuotaSummary(userId, 'free');
    assert.equal(summary.buckets.video.used, 10);
    assert.equal(summary.buckets.video.remaining, 0);

    // 11th video job fails
    await assert.rejects(
      async () => {
        await engine.reserveJobQuota({
          userId,
          userTier: 'free',
          jobType: 'VIDEO_DOWNLOAD',
          jobId: 'job_vid_fail',
        });
      },
      QuotaExceededError
    );

    // CRITICAL ASSERTION: Playlist quota must still be completely untouched (1 remaining)
    assert.equal(summary.buckets.playlist.used, 0);
    assert.equal(summary.buckets.playlist.remaining, 1);

    // 2. The user can still execute their 1 allowed playlist job!
    const plRes = await engine.reserveJobQuota({
      userId,
      userTier: 'free',
      jobType: 'PLAYLIST_DOWNLOAD',
      itemCount: 30,
      jobId: 'job_pl_still_allowed',
    });
    await engine.commitJobQuota(plRes.reservationId);

    summary = await engine.getQuotaSummary(userId, 'free');
    assert.equal(summary.buckets.playlist.used, 1);
    assert.equal(summary.buckets.playlist.remaining, 0);
  });
});
