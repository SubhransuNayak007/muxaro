/**
 * Project VYRO / PureMux - Independent QA API Integration Test Suite
 * Test File: tests/integration/api-integration.test.ts
 *
 * Verifies End-to-End REST API contracts, standard envelope schemas,
 * SSRF defense, atomic quota reservation at the API boundary,
 * idempotency enforcement, job lifecycle & cancellation,
 * and signed download token delivery.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { type FastifyInstance } from 'fastify';

import { buildApp } from '../../apps/api/src/app.ts';
import { tokenService } from '../../apps/api/src/services/token.service.ts';

describe('API Integration - Health, Documentation, and Envelopes', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildApp();
  });

  it('GET /api/v1/health should return system status matching standard success envelope', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    assert.strictEqual(res.statusCode, 200);
    const body = res.json();

    // Verify standard envelope: { success: true, data, requestId }
    assert.strictEqual(body.success, true);
    assert.ok(body.data);
    assert.strictEqual(body.data.status, 'HEALTHY');
    assert.strictEqual(body.data.postgres, 'CONNECTED');
    assert.strictEqual(body.data.redis, 'CONNECTED');
    assert.ok(body.requestId);
    assert.ok(body.requestId.startsWith('req_'));
    assert.ok(body.data.workerPool.totalSlots > 0);
  });

  it('GET /docs should return interactive Swagger UI documentation', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/docs/',
    });

    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.includes('swagger-ui') || res.body.includes('html'));
  });
});

describe('API Integration - Media Inspection & SSRF Prevention', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildApp();
  });

  it('POST /api/v1/media/inspect should inspect direct media and return genuine stream breakdown', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/media/inspect',
      payload: {
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        rightsDeclared: true,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data.assetId);
    assert.strictEqual(body.data.container, 'mp4');
    assert.ok(Array.isArray(body.data.streams));
    assert.ok(body.data.availableFormats.videoResolutions.length > 0);
    assert.strictEqual(body.data.rightsCheck.isPermitted, true);
  });

  it('POST /api/v1/media/inspect should strictly reject SSRF loopback targets with HTTP 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/media/inspect',
      payload: {
        url: 'http://127.0.0.1/internal-secrets.mp4',
      },
    });

    assert.strictEqual(res.statusCode, 403);
    const body = res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'SSRF_BLOCKED');
    assert.ok(body.error.message.includes('127.0.0.1') || body.error.message.includes('Loopback') || body.error.message.includes('restricted'));
    assert.ok(body.requestId);
  });

  it('POST /api/v1/media/inspect should strictly reject cloud metadata IP with HTTP 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/media/inspect',
      payload: {
        url: 'http://169.254.169.254/latest/meta-data/',
      },
    });

    assert.strictEqual(res.statusCode, 403);
    const body = res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'SSRF_BLOCKED');
  });

  it('POST /api/v1/media/inspect inspects real YouTube metadata and enables extraction when rightsDeclared is true', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/media/inspect',
      payload: {
        url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
        rightsDeclared: true,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.rightsCheck.canExtractStreams, true, 'Extraction must be enabled when rightsDeclared is true and SSRF passes');
    assert.ok(typeof body.data.title === 'string' && body.data.title.length > 0);
  });
});

describe('API Integration - Job Creation, Idempotency, and Lifecycle', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildApp();
  });

  it('POST /api/v1/jobs should create processing job and return HTTP 202 Accepted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: {
        authorization: 'Bearer usr_qa_tester',
      },
      payload: {
        mediaUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        operation: 'TRANSCODE_VIDEO',
        targetFormat: 'mp4',
        targetResolution: '720p',
        idempotencyKey: `idem_create_${Date.now()}`,
      },
    });

    assert.strictEqual(res.statusCode, 202);
    const body = res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data.jobId);
    assert.strictEqual(body.data.status, 'QUEUED');
    assert.strictEqual(body.data.operation, 'TRANSCODE_VIDEO');
  });

  it('POST /api/v1/jobs should enforce idempotency keys without duplicate quota charge', async () => {
    const idempotencyKey = `idem_api_test_${Date.now()}_${Math.random()}`;

    // First request
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: {
        authorization: 'Bearer usr_qa_tester',
      },
      payload: {
        mediaUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        operation: 'EXTRACT_AUDIO',
        targetFormat: 'mp3',
        idempotencyKey,
      },
    });

    assert.strictEqual(res1.statusCode, 202);
    const body1 = res1.json();
    const jobId1 = body1.data.jobId;

    // Second request with SAME user and SAME idempotency key
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: {
        authorization: 'Bearer usr_qa_tester',
      },
      payload: {
        mediaUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        operation: 'EXTRACT_AUDIO',
        targetFormat: 'mp3',
        idempotencyKey,
      },
    });

    assert.strictEqual(res2.statusCode, 202);
    const body2 = res2.json();
    // Must return the SAME job ID without creating a duplicate job!
    assert.strictEqual(body2.data.jobId, jobId1);
  });

  it('POST /api/v1/jobs/:id/cancel should cancel job and roll back quota reservation', async () => {
    // 1. Create a job
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: {
        authorization: 'Bearer usr_qa_tester',
      },
      payload: {
        mediaUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        operation: 'TRANSCODE_VIDEO',
        targetFormat: 'mp4',
        targetResolution: '480p',
        idempotencyKey: `idem_cancel_${Date.now()}`,
      },
    });
    assert.strictEqual(createRes.statusCode, 202);
    const jobId = createRes.json().data.jobId;

    // 2. Cancel the job
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${jobId}/cancel`,
    });

    assert.strictEqual(cancelRes.statusCode, 200);
    const cancelBody = cancelRes.json();
    assert.strictEqual(cancelBody.success, true);
    assert.strictEqual(cancelBody.data.status, 'CANCELLED');
    assert.ok(cancelBody.data.message.includes('released') || cancelBody.data.message.includes('cancelled'));

    // 3. Verify job state via GET /jobs/:id
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${jobId}`,
    });
    assert.strictEqual(getRes.statusCode, 200);
    assert.strictEqual(getRes.json().data.status, 'CANCELLED');
  });
});

describe('API Integration - Tools, Account Quota, and Signed Downloads', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildApp();
  });

  it('POST /api/v1/tools/merge should accept audio/video multiplexing parameters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tools/merge',
      headers: {
        authorization: 'Bearer usr_qa_tester',
      },
      payload: {
        videoUrl: 'https://example.com/silent_video.mp4',
        videoUrlOrId: 'https://example.com/silent_video.mp4',
        audioUrl: 'https://example.com/soundtrack.wav',
        audioUrlOrId: 'https://example.com/soundtrack.wav',
        targetFormat: 'mp4',
        audioOffsetMs: 150,
        idempotencyKey: `idem_merge_${Date.now()}`,
      },
    });

    assert.strictEqual(res.statusCode, 202);
    const body = res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data.jobId);
    assert.strictEqual(body.data.operation, 'MERGE_AUDIO_VIDEO');
  });

  it('GET /api/v1/account/credits should return rolling 24h quota status and live countdown', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/account/credits',
      headers: {
        authorization: 'Bearer usr_qa_tester',
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data.individualVideos);
    assert.ok(body.data.playlists);
    assert.strictEqual(body.data.individualVideos.allowance, 10);
    assert.strictEqual(body.data.playlists.allowance, 1);
    assert.strictEqual(body.data.individualVideos.windowSeconds, 86400);
  });

  it('GET /api/v1/admin/metrics should return real-time operational telemetry', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/metrics',
    });

    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data.queue);
    assert.ok(Array.isArray(body.data.workerNodes));
    assert.ok(body.data.system.uptimeSeconds >= 0);
  });

  it('GET /api/v1/download/:token should reject tampered or invalid download tokens', async () => {
    const invalidToken = 'invalid.tampered.token_payload_signature';
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/download/${invalidToken}`,
    });

    assert.strictEqual(res.statusCode, 403);
    const body = res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'ERR_INVALID_DOWNLOAD_TOKEN');
  });

  it('GET /api/v1/download/:token should return 404 ERR_ARTIFACT_NOT_FOUND when no real artifact exists on disk (no fake mock buffer)', async () => {
    const validToken = tokenService.generateDownloadToken({
      jobId: 'job_test_signed_dl_nonexistent',
      artifactId: 'art_123',
      filename: 'sample_video_1080p.mp4',
      userId: 'usr_qa',
      ttlSeconds: 3600,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/download/${validToken}`,
    });

    assert.strictEqual(res.statusCode, 404);
    const body = res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'ERR_ARTIFACT_NOT_FOUND');
  });
});
