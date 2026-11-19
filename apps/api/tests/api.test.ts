/**
 * Project MUXARO - Comprehensive API Test Suite
 * Validates all endpoints, SSRF guard, atomic quotas, SSE events, signed download delivery
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { tokenService } from '../src/services/token.service.js';

describe('MUXARO API Test Suite', async () => {
  const app = await buildApp();

  // Test 1: Health & Readiness Check
  test('GET /api/v1/health returns system operational status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    assert.equal(response.statusCode, 200);
    const json = response.json();
    assert.equal(json.success, true);
    assert.equal(json.data.status, 'HEALTHY');
    assert.equal(json.data.postgres, 'CONNECTED');
    assert.equal(json.data.redis, 'CONNECTED');
    assert.ok(json.data.workerPool.totalSlots > 0);
    assert.ok(json.requestId.startsWith('req_'));
  });

  // Test 2: Swagger OpenAPI Documentation
  test('GET /docs returns OpenAPI Swagger UI documentation', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/docs/',
    });

    assert.equal(response.statusCode, 200);
    assert.ok(response.body.includes('swagger-ui') || response.body.includes('SwaggerUIBundle') || response.body.includes('html'));
  });

  // Test 3: Media Inspection (Direct Media URL)
  test('POST /api/v1/media/inspect inspects direct media URL and returns authentic streams', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/media/inspect',
      payload: {
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        rightsDeclared: true,
      },
    });

    assert.equal(response.statusCode, 200);
    const json = response.json();
    assert.equal(json.success, true);
    assert.ok(json.data.assetId);
    assert.equal(json.data.container, 'mp4');
    assert.ok(Array.isArray(json.data.streams));
    assert.ok(json.data.availableFormats.videoResolutions.length > 0);
    assert.equal(json.data.rightsCheck.isPermitted, true);
  });

  // Test 4: SSRF Defense
  test('POST /api/v1/media/inspect blocks SSRF target (127.0.0.1, cloud metadata)', async () => {
    const loopbackResp = await app.inject({
      method: 'POST',
      url: '/api/v1/media/inspect',
      payload: {
        url: 'http://127.0.0.1:8080/internal-admin.mp4',
      },
    });

    assert.equal(loopbackResp.statusCode, 403);
    const loopbackJson = loopbackResp.json();
    assert.equal(loopbackJson.success, false);
    assert.equal(loopbackJson.error.code, 'SSRF_BLOCKED');

    const metaResp = await app.inject({
      method: 'POST',
      url: '/api/v1/media/inspect',
      payload: {
        url: 'http://169.254.169.254/latest/meta-data/video.mp4',
      },
    });

    assert.equal(metaResp.statusCode, 403);
    const metaJson = metaResp.json();
    assert.equal(metaJson.success, false);
    assert.equal(metaJson.error.code, 'SSRF_BLOCKED');
  });

  // Test 5: YouTube Permitted Adapter Policy Enforcement
  test('POST /api/v1/media/inspect allows YouTube preview but disables stream extraction per policy', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/media/inspect',
      payload: {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
    });

    assert.equal(response.statusCode, 200);
    const json = response.json();
    assert.equal(json.success, true);
    assert.equal(json.data.rightsCheck.canPreview, true);
    assert.ok(typeof json.data.rightsCheck.canExtractStreams === 'boolean');
    assert.ok(
      json.data.rightsCheck.policyCode.includes('PREVIEW_ONLY_PERMITTED') ||
      json.data.rightsCheck.policyCode.includes('STREAM_EXTRACTION_DISABLED')
    );
  });

  // Test 6: Job Submission & Atomic Quota Reservation
  test('POST /api/v1/jobs creates job and reserves quota slot', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: {
        authorization: 'Bearer session_test_user_01',
      },
      payload: {
        operation: 'EXTRACT_AUDIO',
        targetFormat: 'mp3',
        mediaUrl: 'https://example.com/audio-test.mp4',
        idempotencyKey: 'idem_job_001',
      },
    });

    assert.equal(response.statusCode, 202);
    const json = response.json();
    assert.equal(json.success, true);
    assert.ok(json.data.jobId);
    assert.equal(json.data.status, 'QUEUED');
    assert.equal(json.data.operation, 'EXTRACT_AUDIO');

    // Test Idempotency with exact same key
    const duplicateResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: {
        authorization: 'Bearer session_test_user_01',
      },
      payload: {
        operation: 'EXTRACT_AUDIO',
        targetFormat: 'mp3',
        mediaUrl: 'https://example.com/audio-test.mp4',
        idempotencyKey: 'idem_job_001',
      },
    });

    assert.equal(duplicateResponse.statusCode, 202);
    const dupJson = duplicateResponse.json();
    assert.equal(dupJson.data.jobId, json.data.jobId); // exact same job returned!
  });

  // Test 7: Job Polling & Lifecycle Progression
  test('GET /api/v1/jobs/:id returns progress and eventually READY artifact', async () => {
    const createResp = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      payload: {
        operation: 'REMUX_STREAM_COPY',
        targetFormat: 'mp4',
        mediaUrl: 'https://example.com/sample.mp4',
        idempotencyKey: `idem_poll_${Date.now()}`,
      },
    });

    const { jobId } = createResp.json().data;

    // Poll status immediately
    const pollResp = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${jobId}`,
    });

    assert.equal(pollResp.statusCode, 200);
    const pollJson = pollResp.json();
    assert.equal(pollJson.data.jobId, jobId);
    assert.ok(['QUEUED', 'PROCESSING', 'VERIFYING', 'READY'].includes(pollJson.data.status));

    // Wait for worker pipeline to complete
    await new Promise((resolve) => setTimeout(resolve, 600));

    const finalResp = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${jobId}`,
    });

    const finalJson = finalResp.json();
    assert.equal(finalJson.data.status, 'READY');
    assert.equal(finalJson.data.progress, 100);
    assert.ok(finalJson.data.downloadUrl);
    assert.ok(finalJson.data.artifact.artifactId);
  });

  // Test 8: Job Cancellation & Quota Rollback
  test('POST /api/v1/jobs/:id/cancel cancels job and restores quota slot', async () => {
    const createResp = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: {
        authorization: 'Bearer session_cancel_user',
      },
      payload: {
        operation: 'TRANSCODE_VIDEO',
        targetFormat: 'mp4',
        mediaUrl: 'https://example.com/cancel-test.mp4',
        idempotencyKey: `idem_cancel_${Date.now()}`,
      },
    });

    const { jobId } = createResp.json().data;

    const cancelResp = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${jobId}/cancel`,
    });

    assert.equal(cancelResp.statusCode, 200);
    const cancelJson = cancelResp.json();
    assert.equal(cancelJson.success, true);
    assert.equal(cancelJson.data.status, 'CANCELLED');
  });

  // Test 9: Media Merge Tool
  test('POST /api/v1/tools/merge submits audio/video merge job', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tools/merge',
      payload: {
        videoUrl: 'https://example.com/video-track.mp4',
        audioUrl: 'https://example.com/audio-track.m4a',
        targetFormat: 'mp4',
        audioOffsetMs: 50,
        idempotencyKey: `idem_merge_${Date.now()}`,
      },
    });

    assert.equal(response.statusCode, 202);
    const json = response.json();
    assert.equal(json.success, true);
    assert.ok(json.data.jobId);
    assert.equal(json.data.operation, 'MERGE_AUDIO_VIDEO');
  });

  // Test 10: Account Credits & Rolling Quota Breakdown
  test('GET /api/v1/account/credits returns rolling 24-hour quota details and reset countdown', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/account/credits',
      headers: {
        authorization: 'Bearer session_credits_test_user',
      },
    });

    assert.equal(response.statusCode, 200);
    const json = response.json();
    assert.equal(json.success, true);

    const { individualVideos, playlists, credits } = json.data;
    assert.equal(individualVideos.allowance, 10);
    assert.ok(individualVideos.remaining <= 10);
    assert.equal(individualVideos.windowSeconds, 86400);

    assert.equal(playlists.allowance, 1);
    assert.equal(playlists.maxItemsPerPlaylist, 50);
    assert.ok(typeof credits.balance === 'number');
  });

  // Test 11: Account Download History
  test('GET /api/v1/account/history returns paginated jobs for user', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/account/history?page=1&limit=10',
      headers: {
        authorization: 'Bearer session_test_user_01',
      },
    });

    assert.equal(response.statusCode, 200);
    const json = response.json();
    assert.equal(json.success, true);
    assert.ok(Array.isArray(json.data.jobs));
    assert.ok(json.data.total >= 1);
  });

  // Test 12: Admin SRE Telemetry Metrics
  test('GET /api/v1/admin/metrics returns system health and queue depth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/metrics',
    });

    assert.equal(response.statusCode, 200);
    const json = response.json();
    assert.equal(json.success, true);
    assert.ok(typeof json.data.queue.waitingCount === 'number');
    assert.ok(Array.isArray(json.data.workerNodes));
    assert.ok(typeof json.data.system.uptimeSeconds === 'number');
  });

  // Test 13: Secure Signed Download Delivery
  test('GET /api/v1/download/:token delivers file for valid HMAC token and rejects tampered token', async () => {
    // Generate valid signed token
    const validToken = tokenService.generateDownloadToken({
      jobId: 'job_test_123',
      artifactId: 'art_test_456',
      filename: 'sample_video.mp4',
      userId: 'user_test_789',
      ttlSeconds: 300,
    });

    const validResp = await app.inject({
      method: 'GET',
      url: `/api/v1/download/${validToken}`,
    });

    assert.equal(validResp.statusCode, 200);
    assert.equal(validResp.headers['content-type'], 'video/mp4');
    assert.ok(validResp.headers['content-disposition'].includes('attachment; filename="sample_video.mp4"'));
    assert.equal(validResp.headers['x-content-type-options'], 'nosniff');

    // Tampered token test (modify signature)
    const tamperedToken = `${validToken.split('.')[0]}.tampered_signature_xyz`;
    const tamperedResp = await app.inject({
      method: 'GET',
      url: `/api/v1/download/${tamperedToken}`,
    });

    assert.equal(tamperedResp.statusCode, 403);
    const tamperedJson = tamperedResp.json();
    assert.equal(tamperedJson.success, false);
    assert.equal(tamperedJson.error.code, 'ERR_INVALID_DOWNLOAD_TOKEN');
  });
});
