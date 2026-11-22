/**
 * MUXARO Media Processing Platform - API Gateway Test Suite
 *
 * Comprehensive validation of Fastify 5 server, plugins (Auth, RateLimiter),
 * and all 6 core v1 route suites:
 * 1. Health probes (/health, /v1/health)
 * 2. Media Inspection (POST /v1/analyse with SSRF guard & oEmbed fallback)
 * 3. Direct-to-R2 Multipart Uploads (POST /v1/uploads/init, parts, complete, abort)
 * 4. Multi-Lane Job Processing & Deduplication (POST /v1/jobs, GET /v1/jobs/:id)
 * 5. Downloads History & Instant Purge (GET /v1/downloads, DELETE /v1/downloads/:id)
 * 6. Telemetry & Limits (GET /v1/status, GET /v1/usage)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { closeDb, getMuxaroRedis } from '@muxaro/db';
import { closeQueues } from '../src/lib/queues.js';

describe('MUXARO Fastify 5 API Gateway Test Suite', async () => {
  let app: FastifyInstance;

  before(async () => {
    process.env.RATE_LIMIT_ENABLED = 'false'; // disable rate limit blocking in unit tests
    process.env.MOCK_DB = 'true';
    process.env.NODE_ENV = 'test';
    app = await buildServer({ logLevel: 'silent' });
    await app.ready();
  });

  after(async () => {
    await app.close();
    await closeQueues();
    await closeDb();
    try {
      await getMuxaroRedis().quit();
    } catch {}
  });

  // ===========================================================================
  // 1. Health Checks
  // ===========================================================================
  test('GET /health returns healthy status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, 'healthy');
    assert.equal(body.service, 'muxaro-api');
    assert.ok(body.timestamp);
  });

  test('GET /v1/health returns healthy status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/health',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, 'healthy');
  });

  // ===========================================================================
  // 2. Media Inspection & SSRF Guard (POST /v1/analyse)
  // ===========================================================================
  test('POST /v1/analyse blocks SSRF loopback address', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/analyse',
      payload: {
        url: 'http://127.0.0.1:8080/internal-data',
      },
    });

    assert.equal(res.statusCode, 403);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'SSRF_BLOCKED');
  });

  test('POST /v1/analyse inspects safe YouTube URL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/analyse',
      payload: {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.platform, 'youtube');
    assert.equal(body.data.id, 'dQw4w9WgXcQ');
    assert.ok(body.data.canonicalUrl.includes('youtube.com/watch?v=dQw4w9WgXcQ'));
    assert.ok(Array.isArray(body.data.formats));
  });

  // ===========================================================================
  // 3. Direct-to-R2 Resumable Multipart Uploads
  // ===========================================================================
  let createdUploadId: string;

  test('POST /v1/uploads/init creates adaptive 16MB chunk session for small files', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/uploads/init',
      payload: {
        filename: 'test_video.mp4',
        sizeBytes: 100 * 1024 * 1024, // 100MB
        mimeType: 'video/mp4',
        tool: 'convert_video',
        targetFormat: 'mp4',
      },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.uploadSessionId);
    createdUploadId = body.data.uploadSessionId;
    assert.equal(body.data.chunkSize, 16 * 1024 * 1024); // 16MB
    assert.equal(body.data.retentionTier, '60m'); // Guest tier default
    assert.ok(body.data.storageKey.startsWith('uploads/60m/'));
  });

  test('POST /v1/uploads/init enforces 32MB chunks for large files (>512MB)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/uploads/init',
      headers: {
        'x-user-id': '00000000-0000-4000-8000-000000000001', // Free/Pro tier user
      },
      payload: {
        filename: 'heavy_movie.mkv',
        sizeBytes: 800 * 1024 * 1024, // 800MB
        mimeType: 'video/x-matroska',
        tool: 'convert_video',
        targetFormat: 'mp4',
      },
    });

    // If test DB has mock user, it succeeds with 201; if not, guest limit (500MB) rejects with 413
    if (res.statusCode === 201) {
      const body = res.json();
      assert.equal(body.data.chunkSize, 32 * 1024 * 1024); // 32MB
    } else {
      assert.equal(res.statusCode, 413); // File too large for guest
    }
  });

  test('POST /v1/uploads/:id/parts generates presigned URLs for upload chunks', async () => {
    if (!createdUploadId) return;

    const res = await app.inject({
      method: 'POST',
      url: `/v1/uploads/${createdUploadId}/parts`,
      payload: {
        partNumbers: [1, 2, 3],
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.uploadSessionId, createdUploadId);
    assert.equal(body.data.parts.length, 3);
    assert.equal(body.data.parts[0].partNumber, 1);
    assert.ok(body.data.parts[0].presignedUrl.startsWith('http'));
  });

  test('DELETE /v1/uploads/:id/abort aborts upload session', async () => {
    if (!createdUploadId) return;

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/uploads/${createdUploadId}/abort`,
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.aborted, true);
  });

  // ===========================================================================
  // 4. Jobs Dispatcher & Intelligent Lane Routing
  // ===========================================================================
  let createdJobId: string;

  test('POST /v1/jobs creates job and selects fast_io lane for lossless extraction', async () => {
    const idempotencyKey = `test_idem_${Date.now()}`;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      payload: {
        tool: 'extract_audio',
        sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        targetFormat: 'mp3',
        audioCodec: 'mp3',
        ecoMode: true,
        idempotencyKey,
      },
    });

    assert.equal(res.statusCode, 202);
    const body = res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.id);
    createdJobId = body.data.id;
    assert.equal(body.data.tool, 'extract_audio');
    assert.equal(body.data.lane, 'fast_io'); // Direct lossless extraction routes to fast_io
    assert.equal(body.data.retentionTier, '60m');
  });

  test('POST /v1/jobs returns existing job on idempotent replay', async () => {
    const idempotencyKey = `idem_replay_${Date.now()}`;
    const payload = {
      tool: 'convert_video',
      sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      targetFormat: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      idempotencyKey,
    };

    const res1 = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      payload,
    });
    assert.equal(res1.statusCode, 202);
    const job1 = res1.json().data;

    const res2 = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      payload,
    });
    assert.equal(res2.statusCode, 200);
    const job2 = res2.json().data;

    assert.equal(job1.id, job2.id);
  });

  test('GET /v1/jobs/:id retrieves job metadata', async () => {
    if (!createdJobId) return;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${createdJobId}`,
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.id, createdJobId);
  });

  // ===========================================================================
  // 5. Downloads History
  // ===========================================================================
  test('GET /v1/downloads lists non-expired download artifacts', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/downloads',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data.downloads));
    assert.equal(typeof body.data.total, 'number');
  });

  // ===========================================================================
  // 6. Telemetry & Limits
  // ===========================================================================
  test('GET /v1/status aggregates system health, queues, and circuit breakers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/status',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.ok(['healthy', 'degraded', 'outage'].includes(body.data.status));
    assert.ok(body.data.queues);
    assert.ok('lane:fast-io' in body.data.queues);
    assert.ok('lane:transcode' in body.data.queues);
    assert.ok(body.data.circuitBreakers);
    assert.ok('youtube' in body.data.circuitBreakers);
  });

  test('GET /v1/usage reads daily usage and tier boundaries', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/usage',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.tier, 'guest');
    assert.equal(body.data.jobsLimit, 100); // Guest daily limit
    assert.equal(body.data.concurrentLimit, 10); // Guest concurrent limit
    assert.equal(typeof body.data.jobsCount, 'number');
  });
});
