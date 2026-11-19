/**
 * MUXARO Media Pipeline Verification Harness
 * Validates:
 * 1. Media inspection & processing contracts across Edge & Worker environments.
 * 2. yt-dlp format extraction, resolution buckets (8K, 4K, 1440p, 1080p, 720p, 480p, 360p),
 *    audio extraction (MP3, M4A, FLAC, WAV, OPUS), and stream copy remuxing payload definitions.
 * 3. Download signed tokens (HMAC-SHA256, expiration, tamper detection).
 * 4. RFC 9110 Range-request streaming with zero binary corruption (full, partial, suffix, If-Range, 416).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { type FastifyInstance } from 'fastify';

import { buildApp } from '../../apps/api/src/app.ts';
import { tokenService, TokenService } from '../../apps/api/src/services/token.service.ts';
import { ARTIFACTS_ROOT } from '../../apps/api/src/services/queue.service.ts';
import { getDb } from '../../apps/api/src/db/database.ts';
import {
  parseResolutionHeight,
  selectTurboFlowStrategy,
} from '../../apps/api/src/services/turboflow.service.ts';
import { onRequestPost as edgeInspectPost } from '../../apps/web/functions/api/v1/media/inspect.ts';
import { onRequestPost as edgeJobsPost } from '../../apps/web/functions/api/v1/jobs/index.ts';
import { onRequestGet as edgeDownloadGet } from '../../apps/web/functions/api/v1/download/[token].ts';
import type { MediaAssetInfo, MediaStreamItem } from '../../apps/api/src/types/index.js';

describe('Media Pipeline Verification - Contract & Payload Definitions', () => {
  it('should validate unambiguous resolution bucket definitions and height parsing', () => {
    const expectations: Array<[string, number | null]> = [
      ['8K (4320p)', 4320],
      ['8K', 4320],
      ['4320p', 4320],
      ['4K (2160p)', 2160],
      ['4K', 2160],
      ['2160p', 2160],
      ['1440p', 1440],
      ['1080p', 1080],
      ['720p', 720],
      ['480p', 480],
      ['360p', 360],
      ['240p', 240],
      ['invalid', null],
      ['', null],
    ];

    for (const [input, expectedHeight] of expectations) {
      const parsed = parseResolutionHeight(input);
      assert.strictEqual(
        parsed,
        expectedHeight,
        `parseResolutionHeight("${input}") expected ${expectedHeight}, got ${parsed}`
      );
    }
  });

  it('should validate unambiguous audio extraction formats (MP3, M4A, FLAC, WAV, OPUS, AAC)', () => {
    const audioFormats = ['mp3', 'm4a', 'flac', 'wav', 'opus', 'aac'];
    for (const fmt of audioFormats) {
      const decision = selectTurboFlowStrategy({
        operation: 'EXTRACT_AUDIO',
        targetFormat: fmt,
      });

      assert.strictEqual(decision.processingLane, 'smart');
      assert.strictEqual(decision.queueClass, 'audio-processing');
      assert.ok(decision.strategyLabel.includes('Audio Extract'));
      assert.strictEqual(decision.requiresVideoTranscode, false);
    }
  });

  it('should validate stream copy remuxing vs transcoding payload definitions in TurboFlow', () => {
    // 1. Instant Lane: Compatible stream copy (H.264/AAC to MP4)
    const instantDecision = selectTurboFlowStrategy({
      operation: 'REMUX_STREAM_COPY',
      targetFormat: 'mp4',
      streamCopy: true,
      sourceAsset: {
        assetId: 'test-asset-1',
        url: 'https://example.com/test.mp4',
        title: 'Test Stream Copy',
        container: 'mp4',
        streams: [
          {
            index: 0,
            type: 'VIDEO',
            codec: 'h264',
            width: 1920,
            height: 1080,
            resolution: '1080p',
            recommended: true,
            isExtractable: true,
          },
          {
            index: 1,
            type: 'AUDIO',
            codec: 'aac',
            sampleRate: 48000,
            channels: 2,
            isExtractable: true,
          },
        ],
        availableFormats: {
          videoResolutions: ['1080p'],
          audioFormats: ['mp3', 'm4a', 'aac', 'opus', 'wav', 'flac'],
        },
        rightsCheck: {
          isPermitted: true,
          policyCode: 'USER_RIGHTS_DECLARED',
          canExtractStreams: true,
          canPreview: true,
          warnings: [],
        },
        inspectedAt: new Date().toISOString(),
      },
    });

    assert.strictEqual(instantDecision.processingLane, 'instant');
    assert.strictEqual(instantDecision.queueClass, 'instant-processing');
    assert.strictEqual(instantDecision.losslessPreserved, true);
    assert.strictEqual(instantDecision.requiresVideoTranscode, false);

    // 2. Power Lane: Explicit transcode / compression (streamCopy: false)
    const powerDecision = selectTurboFlowStrategy({
      operation: 'TRANSCODE_VIDEO',
      targetFormat: 'mp4',
      targetResolution: '720p',
      streamCopy: false,
    });

    assert.strictEqual(powerDecision.processingLane, 'power');
    assert.strictEqual(powerDecision.queueClass, 'video-transcoding');
    assert.strictEqual(powerDecision.losslessPreserved, false);
    assert.strictEqual(powerDecision.requiresVideoTranscode, true);

    // 3. Power Lane: High-resolution (4K / 8K)
    const highResDecision = selectTurboFlowStrategy({
      operation: 'TRANSCODE_VIDEO',
      targetFormat: 'mp4',
      targetResolution: '4K',
      streamCopy: false,
    });

    assert.strictEqual(highResDecision.processingLane, 'power');
    assert.strictEqual(highResDecision.queueClass, 'high-resolution-processing');
    assert.strictEqual(highResDecision.requiresVideoTranscode, true);

    // 4. Merge Lane: A/V Multiplexing
    const mergeDecision = selectTurboFlowStrategy({
      operation: 'MERGE_AUDIO_VIDEO',
      targetFormat: 'mp4',
    });

    assert.strictEqual(mergeDecision.processingLane, 'smart');
    assert.strictEqual(mergeDecision.queueClass, 'merge-processing');
  });
});

describe('Media Pipeline Verification - Download Signed Tokens', () => {
  const customSecret = 'pipeline-test-secret-key-32-bytes-secure!';
  const customTokenService = new TokenService(customSecret);

  it('should generate and verify valid signed download tokens', () => {
    const token = customTokenService.generateDownloadToken({
      jobId: 'MXJ-TEST-12345',
      artifactId: 'art_pipe_001',
      filename: 'video_1080p.mp4',
      userId: 'usr_pipeline_test',
      ttlSeconds: 300,
    });

    assert.ok(token);
    assert.strictEqual(token.split('.').length, 2);

    const payload = customTokenService.verifyDownloadToken(token);
    assert.strictEqual(payload.jobId, 'MXJ-TEST-12345');
    assert.strictEqual(payload.artifactId, 'art_pipe_001');
    assert.strictEqual(payload.filename, 'video_1080p.mp4');
    assert.strictEqual(payload.userId, 'usr_pipeline_test');
    assert.ok(payload.expiresAt > Date.now());
  });

  it('should strictly reject expired signed tokens', async () => {
    const expiredToken = customTokenService.generateDownloadToken({
      jobId: 'MXJ-TEST-EXPIRED',
      artifactId: 'art_pipe_expired',
      filename: 'video_expired.mp4',
      userId: 'usr_test',
      ttlSeconds: -10, // already expired
    });

    assert.throws(
      () => customTokenService.verifyDownloadToken(expiredToken),
      /expired/i
    );
  });

  it('should strictly reject tampered download token signatures', () => {
    const token = customTokenService.generateDownloadToken({
      jobId: 'MXJ-TEST-TAMPER',
      artifactId: 'art_pipe_tamper',
      filename: 'tamper_test.mp4',
      userId: 'usr_legit',
      ttlSeconds: 600,
    });

    const [payloadB64, signature] = token.split('.');
    // Flip a character in signature
    const corruptSig = signature.slice(0, -2) + (signature.slice(-2) === 'aa' ? 'bb' : 'aa');
    const tamperedSigToken = `${payloadB64}.${corruptSig}`;

    assert.throws(
      () => customTokenService.verifyDownloadToken(tamperedSigToken),
      /signature/i
    );

    // Tamper payload
    const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    decoded.userId = 'usr_evil_hacker';
    const evilPayloadB64 = Buffer.from(JSON.stringify(decoded)).toString('base64url');
    const tamperedPayloadToken = `${evilPayloadB64}.${signature}`;

    assert.throws(
      () => customTokenService.verifyDownloadToken(tamperedPayloadToken),
      /signature/i
    );
  });

  it('should strictly reject malformed or non-string tokens', () => {
    for (const bad of ['', 'singleparttoken', 'one.two.three', null as any, undefined as any]) {
      assert.throws(
        () => customTokenService.verifyDownloadToken(bad),
        /token/i
      );
    }
  });
});

describe('Media Pipeline Verification - Range-Request Streaming & Binary Integrity', () => {
  let app: FastifyInstance;
  const testJobId = 'MXJ-PIPE-RANGE-TEST';
  const testArtifactId = 'art_binary_range_001';
  const testUserId = 'usr_pipeline_verifier';
  const testFilename = 'deterministic_binary_sample.mp4';
  const testDir = path.join(ARTIFACTS_ROOT, testJobId);
  const testFilePath = path.join(testDir, testFilename);

  // Deterministic 1 MB binary payload with known hash
  const binaryPayload = Buffer.alloc(1024 * 1024);
  for (let i = 0; i < binaryPayload.length; i++) {
    binaryPayload[i] = (i * 31 + 17) & 0xff;
  }
  const expectedSha256 = crypto.createHash('sha256').update(binaryPayload).digest('hex');
  let downloadToken: string;

  before(async () => {
    app = await buildApp();
    await fsp.mkdir(testDir, { recursive: true });
    await fsp.writeFile(testFilePath, binaryPayload);

    // Seed artifact directly into SQLite output_artifacts table
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO output_artifacts (
        id, job_id, owner_user_id, file_path, filename, mime_type, size_bytes,
        container, codec, duration_seconds, checksum_sha256, download_url, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      testArtifactId,
      testJobId,
      testUserId,
      testFilePath,
      testFilename,
      'video/mp4',
      binaryPayload.length,
      'mp4',
      'h264',
      60.0,
      expectedSha256,
      `/api/v1/download/mock-token`,
      new Date(Date.now() + 3600000).toISOString(),
      new Date().toISOString()
    );

    downloadToken = tokenService.generateDownloadToken({
      jobId: testJobId,
      artifactId: testArtifactId,
      filename: testFilename,
      userId: testUserId,
      ttlSeconds: 3600,
    });
  });

  after(async () => {
    try {
      const db = getDb();
      db.prepare('DELETE FROM output_artifacts WHERE id = ?').run(testArtifactId);
    } catch {}
    await fsp.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('GET full file should return HTTP 200, Content-Length, strong ETag, and exact binary payload (0% corruption)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/download/${downloadToken}`,
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(Number(res.headers['content-length']), binaryPayload.length);
    assert.strictEqual(res.headers['accept-ranges'], 'bytes');
    assert.strictEqual(res.headers['etag'], `"${expectedSha256}"`);
    assert.ok(res.headers['content-disposition']?.includes('attachment'));
    assert.strictEqual(res.headers['content-type'], 'video/mp4');

    const receivedBuffer = res.rawPayload;
    assert.strictEqual(receivedBuffer.length, binaryPayload.length);
    assert.strictEqual(
      crypto.createHash('sha256').update(receivedBuffer).digest('hex'),
      expectedSha256
    );
    assert.strictEqual(receivedBuffer.equals(binaryPayload), true);
  });

  it('GET with ?inline=1 should return Content-Disposition: inline', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/download/${downloadToken}?inline=1`,
    });

    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.headers['content-disposition']?.startsWith('inline'));
  });

  it('GET with Range: bytes=0-1023 should return HTTP 206, Content-Range, Content-Length: 1024, and exact slice', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/download/${downloadToken}`,
      headers: {
        range: 'bytes=0-1023',
      },
    });

    assert.strictEqual(res.statusCode, 206);
    assert.strictEqual(res.headers['content-range'], `bytes 0-1023/${binaryPayload.length}`);
    assert.strictEqual(Number(res.headers['content-length']), 1024);

    const receivedSlice = res.rawPayload;
    const expectedSlice = binaryPayload.subarray(0, 1024);
    assert.strictEqual(receivedSlice.length, 1024);
    assert.strictEqual(receivedSlice.equals(expectedSlice), true);
  });

  it('GET with mid-stream Range: bytes=65536-131071 should return HTTP 206 with exact byte integrity', async () => {
    const start = 65536;
    const end = 131071;
    const expectedLength = end - start + 1;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/download/${downloadToken}`,
      headers: {
        range: `bytes=${start}-${end}`,
      },
    });

    assert.strictEqual(res.statusCode, 206);
    assert.strictEqual(res.headers['content-range'], `bytes ${start}-${end}/${binaryPayload.length}`);
    assert.strictEqual(Number(res.headers['content-length']), expectedLength);

    const receivedSlice = res.rawPayload;
    const expectedSlice = binaryPayload.subarray(start, end + 1);
    assert.strictEqual(receivedSlice.length, expectedLength);
    assert.strictEqual(receivedSlice.equals(expectedSlice), true);
  });

  it('GET with suffix Range: bytes=-2048 should return last 2048 bytes with HTTP 206', async () => {
    const suffixLength = 2048;
    const start = binaryPayload.length - suffixLength;
    const end = binaryPayload.length - 1;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/download/${downloadToken}`,
      headers: {
        range: `bytes=-${suffixLength}`,
      },
    });

    assert.strictEqual(res.statusCode, 206);
    assert.strictEqual(res.headers['content-range'], `bytes ${start}-${end}/${binaryPayload.length}`);
    assert.strictEqual(Number(res.headers['content-length']), suffixLength);

    const receivedSlice = res.rawPayload;
    const expectedSlice = binaryPayload.subarray(start);
    assert.strictEqual(receivedSlice.length, suffixLength);
    assert.strictEqual(receivedSlice.equals(expectedSlice), true);
  });

  it('GET with open-ended Range: bytes=1000000- should stream to end of file with HTTP 206', async () => {
    const start = 1000000;
    const end = binaryPayload.length - 1;
    const expectedLength = end - start + 1;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/download/${downloadToken}`,
      headers: {
        range: `bytes=${start}-`,
      },
    });

    assert.strictEqual(res.statusCode, 206);
    assert.strictEqual(res.headers['content-range'], `bytes ${start}-${end}/${binaryPayload.length}`);
    assert.strictEqual(Number(res.headers['content-length']), expectedLength);

    const receivedSlice = res.rawPayload;
    const expectedSlice = binaryPayload.subarray(start);
    assert.strictEqual(receivedSlice.length, expectedLength);
    assert.strictEqual(receivedSlice.equals(expectedSlice), true);
  });

  it('GET with out-of-bounds Range: bytes=2000000- should return HTTP 416 Range Not Satisfiable', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/download/${downloadToken}`,
      headers: {
        range: 'bytes=2000000-3000000',
      },
    });

    assert.strictEqual(res.statusCode, 416);
    assert.strictEqual(res.headers['content-range'], `bytes */${binaryPayload.length}`);
    const body = res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'ERR_RANGE_NOT_SATISFIABLE');
  });

  it('GET with inverted Range: bytes=500-200 should return HTTP 416 Range Not Satisfiable', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/download/${downloadToken}`,
      headers: {
        range: 'bytes=500-200',
      },
    });

    assert.strictEqual(res.statusCode, 416);
    assert.strictEqual(res.headers['content-range'], `bytes */${binaryPayload.length}`);
  });

  it('GET with If-Range matching strong ETag should return HTTP 206 partial content', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/download/${downloadToken}`,
      headers: {
        range: 'bytes=0-511',
        'if-range': `"${expectedSha256}"`,
      },
    });

    assert.strictEqual(res.statusCode, 206);
    assert.strictEqual(res.headers['content-range'], `bytes 0-511/${binaryPayload.length}`);
  });

  it('GET with If-Range mismatching strong ETag should fall back to HTTP 200 full file stream', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/download/${downloadToken}`,
      headers: {
        range: 'bytes=0-511',
        'if-range': '"stale_outdated_etag_xyz"',
      },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(Number(res.headers['content-length']), binaryPayload.length);
    assert.strictEqual(res.rawPayload.length, binaryPayload.length);
  });
});

describe('Media Pipeline Verification - Cloudflare Edge Pages Functions Honesty & Security', () => {
  it('Edge POST /api/v1/media/inspect without upstream honestly returns HTTP 503 (zero hardcoded mocks)', async () => {
    const req = new Request('https://muxaro.pages.dev/api/v1/media/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        rightsDeclared: true,
      }),
    });

    const res = await edgeInspectPost({
      request: req,
      env: {},
      params: {},
      data: {},
      waitUntil: () => {},
      next: async () => new Response(),
      functionPath: '/api/v1/media/inspect',
    });

    assert.strictEqual(res.status, 503);
    const body = await res.json() as any;
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'ERR_BACKEND_UNAVAILABLE');
    assert.strictEqual(body.error.details.requiresYtDlp, true);
    assert.strictEqual(body.error.details.requiresFfmpeg, true);
    assert.ok(body.error.message.includes('yt-dlp'));
    assert.ok(body.requestId.startsWith('edge_insp_'));
  });

  it('Edge POST /api/v1/jobs without upstream honestly returns HTTP 503 (zero fake completed jobs)', async () => {
    const req = new Request('https://muxaro.pages.dev/api/v1/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'EXTRACT_AUDIO',
        targetFormat: 'mp3',
        title: 'Rick Astley Audio',
        idempotencyKey: 'idem_edge_test_1',
      }),
    });

    const res = await edgeJobsPost({
      request: req,
      env: {},
      params: {},
      data: {},
      waitUntil: () => {},
      next: async () => new Response(),
      functionPath: '/api/v1/jobs',
    });

    assert.strictEqual(res.status, 503);
    const body = await res.json() as any;
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'ERR_BACKEND_UNAVAILABLE');
    assert.strictEqual(body.error.details.requiresFfmpeg, true);
  });

  it('Edge GET /api/v1/download/:token without upstream honestly returns HTTP 404 ERR_ARTIFACT_NOT_FOUND (zero dummy 32-byte buffers)', async () => {
    const payload = {
      jobId: 'job_edge_dl_1',
      artifactId: 'art_edge_dl_1',
      filename: 'sample_video.mp4',
      userId: 'usr_edge',
      expiresAt: Date.now() + 3600000,
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const validEdgeToken = `${payloadB64}.fake_edge_sig`;

    const req = new Request(`https://muxaro.pages.dev/api/v1/download/${validEdgeToken}`, {
      method: 'GET',
    });

    const res = await edgeDownloadGet({
      request: req,
      env: {},
      params: { token: validEdgeToken },
      data: {},
      waitUntil: () => {},
      next: async () => new Response(),
      functionPath: '/api/v1/download/[token]',
    });

    assert.strictEqual(res.status, 404);
    const body = await res.json() as any;
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'ERR_ARTIFACT_NOT_FOUND');
  });
});
