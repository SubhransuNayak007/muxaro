/**
 * @file idempotency.test.ts
 * Tests for server-side idempotency key checking to prevent double-charging on network retries
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EntitlementsEngine } from '../src/engine.js';
import { IdempotencyConflictError, IdempotencyProcessingError } from '../src/errors.js';

describe('Server-Side Idempotency Key Engine', () => {
  it('prevents double-charging and duplicate reservations on network retries', async () => {
    const engine = new EntitlementsEngine();
    const userId = 'usr_idempotent_1';
    const idempotencyKey = 'idem-req-uuid-12345';
    const payload = { url: 'https://example.com/video.mp4', quality: '1080p' };

    let executionCount = 0;

    const executeJobSubmission = async () => {
      return engine.executeIdempotent(
        idempotencyKey,
        userId,
        payload,
        async () => {
          executionCount++;
          // Reserve quota inside the idempotent boundary
          const res = await engine.reserveJobQuota({
            userId,
            userTier: 'free',
            jobType: 'VIDEO_DOWNLOAD',
            idempotencyKey,
            jobId: `job_${idempotencyKey}`,
          });
          await engine.commitJobQuota(res.reservationId);
          return { jobId: `job_${idempotencyKey}`, status: 'QUEUED', reservationId: res.reservationId };
        }
      );
    };

    // First request (client sends request)
    const result1 = await executeJobSubmission();
    assert.equal(result1.status, 'QUEUED');
    assert.equal(executionCount, 1);

    // Verify 1 quota slot was used
    let summary = await engine.getQuotaSummary(userId, 'free');
    assert.equal(summary.buckets.video.used, 1);
    assert.equal(summary.buckets.video.remaining, 9);

    // Second request: Client experiences network timeout and retries with EXACT same key & payload
    const result2 = await executeJobSubmission();

    // CRITICAL ASSERTION: The operation did NOT execute again (executionCount remains 1)
    assert.equal(executionCount, 1);
    // Cached response is returned
    assert.deepEqual(result2, result1);

    // CRITICAL ASSERTION: Quota was NOT double-charged! Still exactly 1 used!
    summary = await engine.getQuotaSummary(userId, 'free');
    assert.equal(summary.buckets.video.used, 1);
    assert.equal(summary.buckets.video.remaining, 9);
  });

  it('rejects reused idempotency key with conflicting request payload', async () => {
    const engine = new EntitlementsEngine();
    const userId = 'usr_idempotent_conflict';
    const key = 'idem-key-conflict-777';

    // First request with payload A
    await engine.executeIdempotent(
      key,
      userId,
      { url: 'https://example.com/first.mp4' },
      async () => ({ success: true })
    );

    // Second request with SAME key but DIFFERENT payload B
    await assert.rejects(
      async () => {
        await engine.executeIdempotent(
          key,
          userId,
          { url: 'https://example.com/different-target.mp4' }, // changed URL
          async () => ({ success: true })
        );
      },
      (err: unknown) => {
        assert.ok(err instanceof IdempotencyConflictError);
        assert.equal(err.code, 'IDEMPOTENCY_CONFLICT');
        assert.equal(err.key, key);
        return true;
      }
    );
  });

  it('detects concurrent request processing with the same idempotency key', async () => {
    const engine = new EntitlementsEngine();
    const userId = 'usr_concurrent_idem';
    const key = 'idem-processing-lock';
    const payload = { target: 'media_123' };

    // Acquire idempotency lock
    const acquire1 = await engine.idempotency.acquire(key, userId, payload);
    assert.equal(acquire1.isNew, true);
    assert.equal(acquire1.completed, false);

    // Concurrent request arriving before first finishes
    await assert.rejects(
      async () => {
        await engine.idempotency.acquire(key, userId, payload);
      },
      (err: unknown) => {
        assert.ok(err instanceof IdempotencyProcessingError);
        assert.equal(err.code, 'IDEMPOTENCY_PROCESSING');
        return true;
      }
    );

    // Once completed, subsequent requests succeed with cached response
    await engine.idempotency.complete(key, userId, { status: 'DONE' });
    const acquire3 = await engine.idempotency.acquire(key, userId, payload);
    assert.equal(acquire3.isNew, false);
    assert.equal(acquire3.completed, true);
    assert.deepEqual(acquire3.response, { status: 'DONE' });
  });
});
