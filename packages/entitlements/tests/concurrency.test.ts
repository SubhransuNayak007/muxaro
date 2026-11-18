/**
 * @file concurrency.test.ts
 * Race-condition simulation: concurrent simultaneous job admissions
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EntitlementsEngine } from '../src/engine.js';
import { QuotaExceededError } from '../src/errors.js';

describe('Concurrency & Race-Condition Guard', () => {
  it('prevents quota race conditions under 20 simultaneous parallel requests', async () => {
    const engine = new EntitlementsEngine();
    const userId = 'usr_race_test_user';

    // Launch 20 concurrent reservation attempts simultaneously via Promise.all
    const promises = Array.from({ length: 20 }, (_, i) => {
      return engine
        .reserveJobQuota({
          userId,
          userTier: 'free',
          jobType: 'VIDEO_DOWNLOAD',
          jobId: `job_parallel_${i}`,
        })
        .then((res) => ({ success: true, res }))
        .catch((err) => ({ success: false, err }));
    });

    const results = await Promise.all(promises);

    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    // EXACTLY 10 must succeed (the Free tier video allowance)
    assert.equal(successful.length, 10, `Expected exactly 10 successes, got ${successful.length}`);

    // EXACTLY 10 must fail with QuotaExceededError
    assert.equal(failed.length, 10, `Expected exactly 10 failures, got ${failed.length}`);
    for (const f of failed) {
      assert.ok(f.err instanceof QuotaExceededError);
      assert.equal((f.err as QuotaExceededError).code, 'QUOTA_EXCEEDED');
    }

    // Verify storage state
    const summary = await engine.getQuotaSummary(userId, 'free');
    assert.equal(summary.buckets.video.used, 10);
    assert.equal(summary.buckets.video.remaining, 0);
  });
});
