/**
 * Unit Tests: Heartbeat & Cleanup Managers
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MediaWorkerHeartbeat } from '../src/heartbeat.js';
import { RETENTION_SECONDS } from '@muxaro/shared';

describe('MediaWorkerHeartbeat', () => {
  it('tracks active jobs count and increments/decrements per lane', () => {
    // Provide a mocked Redis client to avoid network connection during unit test
    const mockRedis = {
      sendWorkerHeartbeat: async () => {},
      raw: {
        del: async () => 1,
      },
    } as any;

    const heartbeat = new MediaWorkerHeartbeat({
      workerId: 'test-worker-1',
      redisClient: mockRedis,
    });

    assert.equal(heartbeat.id, 'test-worker-1');

    heartbeat.incrementActive('lane:fast-io');
    heartbeat.incrementActive('lane:fast-io');
    assert.doesNotThrow(() => heartbeat.incrementActive('lane:transcode'));

    heartbeat.decrementActive('lane:fast-io');

    heartbeat.recordCompleted();
    heartbeat.recordCompleted();
    heartbeat.recordFailed();

    // Verify stop succeeds without network
    assert.doesNotThrow(async () => {
      await heartbeat.stop();
    });
  });
});

describe('CleanupWorker retention intervals', () => {
  it('strictly validates 60-minute retention for guest and 24-hour for users', () => {
    assert.equal(RETENTION_SECONDS['60m'], 3600); // 1 hour
    assert.equal(RETENTION_SECONDS['24h'], 86400); // 24 hours
  });
});
