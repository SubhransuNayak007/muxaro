/**
 * MUXARO Media Processing Platform - Database & Redis Unit Tests
 * 
 * Validates Drizzle ORM PostgreSQL schema structure, column types,
 * and typed Redis client topology helpers.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  users,
  uploadSessions,
  mediaJobs,
  dailyUsageLedger,
  serviceIncidents,
  REDIS_KEYS,
  MuxaroRedisClient,
  getMuxaroRedis,
} from '../dist/index.js';

describe('MUXARO Database - Drizzle PostgreSQL Schema', () => {
  it('defines the users table with all expected columns', () => {
    assert.ok(users.id);
    assert.ok(users.email);
    assert.ok(users.emailVerified);
    assert.ok(users.tier);
    assert.ok(users.passwordHash);
    assert.ok(users.displayName);
    assert.ok(users.avatarUrl);
    assert.ok(users.metadataJson);
    assert.ok(users.createdAt);
    assert.ok(users.updatedAt);
  });

  it('defines the upload_sessions table matching multipart R2 spec', () => {
    assert.ok(uploadSessions.id);
    assert.ok(uploadSessions.userId);
    assert.ok(uploadSessions.guestIpHash);
    assert.ok(uploadSessions.storageKey);
    assert.ok(uploadSessions.filename);
    assert.ok(uploadSessions.mimeType);
    assert.ok(uploadSessions.sizeBytes);
    assert.ok(uploadSessions.chunkSize);
    assert.ok(uploadSessions.totalChunks);
    assert.ok(uploadSessions.tool);
    assert.ok(uploadSessions.targetFormat);
    assert.ok(uploadSessions.status);
    assert.ok(uploadSessions.partsJson);
    assert.ok(uploadSessions.retentionTier);
    assert.ok(uploadSessions.magicBytesVerified);
    assert.ok(uploadSessions.expiresAt);
  });

  it('defines the media_jobs table with multi-lane execution support', () => {
    assert.ok(mediaJobs.id);
    assert.ok(mediaJobs.userId);
    assert.ok(mediaJobs.guestIpHash);
    assert.ok(mediaJobs.guestSessionHash);
    assert.ok(mediaJobs.tool);
    assert.ok(mediaJobs.status);
    assert.ok(mediaJobs.lane);
    assert.ok(mediaJobs.priority);
    assert.ok(mediaJobs.sourceUrl);
    assert.ok(mediaJobs.uploadSessionId);
    assert.ok(mediaJobs.targetFormat);
    assert.ok(mediaJobs.targetResolution);
    assert.ok(mediaJobs.optionsJson);
    assert.ok(mediaJobs.outputStorageKey);
    assert.ok(mediaJobs.outputFilename);
    assert.ok(mediaJobs.outputSizeBytes);
    assert.ok(mediaJobs.outputMimeType);
    assert.ok(mediaJobs.durationSeconds);
    assert.ok(mediaJobs.progressPercent);
    assert.ok(mediaJobs.stage);
    assert.ok(mediaJobs.stageMessage);
    assert.ok(mediaJobs.errorCode);
    assert.ok(mediaJobs.errorMessage);
    assert.ok(mediaJobs.idempotencyKey);
    assert.ok(mediaJobs.workerId);
    assert.ok(mediaJobs.retentionTier);
    assert.ok(mediaJobs.expiresAt);
  });

  it('defines the daily_usage_ledger table for rolling quota accounting', () => {
    assert.ok(dailyUsageLedger.id);
    assert.ok(dailyUsageLedger.subjectKey);
    assert.ok(dailyUsageLedger.userId);
    assert.ok(dailyUsageLedger.usageDate);
    assert.ok(dailyUsageLedger.tier);
    assert.ok(dailyUsageLedger.jobsCount);
    assert.ok(dailyUsageLedger.bandwidthBytes);
  });

  it('defines the service_incidents table for system audits & circuit tracking', () => {
    assert.ok(serviceIncidents.id);
    assert.ok(serviceIncidents.serviceName);
    assert.ok(serviceIncidents.incidentType);
    assert.ok(serviceIncidents.severity);
    assert.ok(serviceIncidents.detailsJson);
    assert.ok(serviceIncidents.resolved);
    assert.ok(serviceIncidents.createdAt);
  });
});

describe('MUXARO Redis Topology - Key Namespace & Client Helpers', () => {
  it('generates exact Redis key namespaces matching architecture spec', () => {
    assert.equal(
      REDIS_KEYS.analyseCache('YouTube', 'hash987'),
      'muxaro:analyse:youtube:hash987'
    );
    assert.equal(
      REDIS_KEYS.dedupLock('jobHash123'),
      'muxaro:dedup:jobHash123'
    );
    assert.equal(
      REDIS_KEYS.jobEventsChannel('job-uuid-1'),
      'muxaro:events:job:job-uuid-1'
    );
    assert.equal(
      REDIS_KEYS.proxyHealth('proxy-res-1'),
      'muxaro:proxy:proxy-res-1:health'
    );
    assert.equal(
      REDIS_KEYS.profileState('TV_EMBEDDED'),
      'muxaro:profile:tv_embedded:state'
    );
    assert.equal(
      REDIS_KEYS.circuitBreaker('WORKER-MEDIA'),
      'muxaro:circuit:worker-media'
    );
    assert.equal(
      REDIS_KEYS.rateLimitZset('guest:ip123', 'analyse'),
      'muxaro:ratelimit:api:guest:ip123:analyse'
    );
    assert.equal(
      REDIS_KEYS.workerHeartbeat('MEDIA', 'worker-pod-4'),
      'muxaro:heartbeat:media:worker-pod-4'
    );
    assert.equal(
      REDIS_KEYS.quotaActive('user:uuid-1'),
      'muxaro:quota:active:user:uuid-1'
    );
    assert.equal(
      REDIS_KEYS.quotaDaily('guest:ip123', '2026-11-20'),
      'muxaro:quota:daily:guest:ip123:2026-11-20'
    );
  });

  it('instantiates MuxaroRedisClient and exposes typed methods', () => {
    const client = new MuxaroRedisClient({ lazyConnect: true });
    assert.ok(typeof client.getAnalyseCache === 'function');
    assert.ok(typeof client.setAnalyseCache === 'function');
    assert.ok(typeof client.tryAcquireDedupLock === 'function');
    assert.ok(typeof client.releaseDedupLock === 'function');
    assert.ok(typeof client.publishJobEvent === 'function');
    assert.ok(typeof client.subscribeJobEvents === 'function');
    assert.ok(typeof client.getCircuitState === 'function');
    assert.ok(typeof client.tripCircuit === 'function');
    assert.ok(typeof client.resetCircuit === 'function');
    assert.ok(typeof client.checkSlidingWindowRateLimit === 'function');
    assert.ok(typeof client.sendWorkerHeartbeat === 'function');
    assert.ok(typeof client.getActiveWorkers === 'function');
    assert.ok(typeof client.acquireJobQuota === 'function');
    assert.ok(typeof client.releaseActiveJob === 'function');
  });

  it('validates acquire-quota.lua script structure and logic', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const luaPath = path.resolve('packages/db/src/lua/acquire-quota.lua');
    assert.ok(fs.existsSync(luaPath), 'acquire-quota.lua must exist');
    const luaContent = fs.readFileSync(luaPath, 'utf8');

    assert.ok(luaContent.includes('KEYS[1]'));
    assert.ok(luaContent.includes('KEYS[2]'));
    assert.ok(luaContent.includes('CONCURRENT_LIMIT_REACHED'));
    assert.ok(luaContent.includes('DAILY_QUOTA_REACHED'));
    assert.ok(luaContent.includes("redis.call('SADD', active_key, job_id)"));
    assert.ok(luaContent.includes("redis.call('EXPIRE', active_key, 3600)"));
    assert.ok(luaContent.includes("redis.call('INCR', daily_key)"));
    assert.ok(luaContent.includes("redis.call('EXPIRE', daily_key, 90000)"));
    assert.ok(luaContent.includes("{1, 'OK'}"));
  });
});
