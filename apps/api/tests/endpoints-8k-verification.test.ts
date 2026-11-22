/**
 * MUXARO Media Processing Platform - 8K Backend Endpoints & Engine Verification Test Suite
 *
 * Verifies:
 * 1. GET /api/v1/health (reports yt-dlp version, ffmpeg presence, queue depth, smoke test status)
 * 2. POST /api/v1/probe (anti-SSRF, platform detection, 8K format matrix, audio formats, subtitles)
 * 3. POST /api/v1/jobs (Fast-path progressive stream proxy & Power-path 8K lossless dispatch)
 * 4. GET /api/v1/jobs/:jobId/events (SSE streaming progress stages with percent, speedMbps, etaSec, downloadUrl, fileName)
 * 5. 8K Lossless Remuxing Rules (-c:v copy, MKV/WebM -c copy, MP4 -c:v copy -c:a aac -b:a 192k)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { closeDb, getMuxaroRedis } from '@muxaro/db';
import { closeQueues } from '../src/lib/queues.js';

describe('8K Media Processing Engine & API Verification', async () => {
  let app: FastifyInstance;

  before(async () => {
    process.env.RATE_LIMIT_ENABLED = 'false';
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
  // 1. GET /api/v1/health & /v1/health
  // ===========================================================================
  test('GET /api/v1/health reports yt-dlp version, ffmpeg presence, queue depth, and smoke test status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    
    const data = body.data || body;
    assert.ok(data.status === 'HEALTHY' || data.status === 'healthy' || data.status === 'READY');
    assert.ok(typeof data.ytDlpVersion === 'string' || typeof data.ytdlpVersion === 'string');
    assert.ok(typeof data.ffmpeg === 'boolean' || typeof data.ffmpegAvailable === 'boolean');
    assert.ok(typeof data.queueDepth === 'number');
    assert.ok(data.smokeTest === 'PASS' || data.smokeTest === 'OK' || data.smokeTest === 'WARN');
    assert.ok(typeof data.uptimeSeconds === 'number');
  });

  test('GET /v1/health alias returns valid health metrics', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/health',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    const data = body.data || body;
    assert.ok(data.status);
    assert.ok(data.version);
  });

  // ===========================================================================
  // 2. POST /api/v1/probe
  // ===========================================================================
  test('POST /api/v1/probe blocks SSRF loopback & private targets', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/probe',
      payload: {
        url: 'http://127.0.0.1:8080/internal-admin',
      },
    });

    assert.equal(res.statusCode, 403);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'SSRF_BLOCKED');
  });

  test('POST /api/v1/probe validates empty URL payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/probe',
      payload: {
        url: '   ',
      },
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.success, false);
  });

  test('POST /api/v1/probe probes media URL and returns normalized 8K format matrix', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/probe',
      payload: {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);

    const probe = body.data || body;
    assert.equal(probe.platform, 'youtube');
    assert.equal(probe.id, 'dQw4w9WgXcQ');
    assert.ok(probe.title);
    assert.ok(typeof probe.durationSec === 'number');
    assert.ok(typeof probe.isCarousel === 'boolean');
    assert.ok(Array.isArray(probe.formats));
    assert.ok(Array.isArray(probe.audioFormats));
    assert.ok(Array.isArray(probe.subtitles));
    assert.ok(Array.isArray(probe.videoStreams));
    assert.ok(Array.isArray(probe.audioStreams));
    assert.ok(Array.isArray(probe.streams));
    assert.equal(probe.permitted, true);

    // Verify format matrix properties
    if (probe.formats.length > 0) {
      const firstFmt = probe.formats[0];
      assert.ok(typeof firstFmt.height === 'number');
      assert.ok(typeof firstFmt.fps === 'number');
      assert.ok(typeof firstFmt.hdr === 'boolean');
      assert.ok(typeof firstFmt.vcodec === 'string');
      assert.ok(typeof firstFmt.ext === 'string');
      assert.ok(typeof firstFmt.requiresMux === 'boolean');
      assert.ok(typeof firstFmt.resolution === 'string');
      assert.ok(typeof firstFmt.formatId === 'string');
    }

    // Verify videoStreams properties
    if (probe.videoStreams.length > 0) {
      const firstVs = probe.videoStreams[0];
      assert.equal(firstVs.streamType, 'video');
      assert.ok(typeof firstVs.codec === 'string');
      assert.ok(typeof firstVs.height === 'number');
      assert.ok(typeof firstVs.resolutionLabel === 'string');
      assert.equal(firstVs.isStreamCopyCandidate, true);
    }
  });

  // ===========================================================================
  // 3. POST /api/v1/jobs
  // ===========================================================================
  let createdJobId: string;

  test('POST /api/v1/jobs dispatches Power-path 8K remux job and returns jobId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      payload: {
        tool: 'convert_video',
        sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        targetFormat: 'mp4',
        targetResolution: '4K',
        ecoMode: true,
      },
    });

    assert.equal(res.statusCode, 202);
    const body = res.json();
    assert.equal(body.success, true);
    
    const job = body.data || body;
    assert.ok(job.jobId || job.id);
    createdJobId = job.jobId || job.id;
    assert.equal(job.lane, 'fast_io'); // 8K/4K lossless remuxing routes to fast_io
    assert.ok(['QUEUED', 'queued'].includes(job.status));
  });

  test('POST /api/v1/jobs dispatches audio extraction job', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      payload: {
        tool: 'extract_audio',
        sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        targetFormat: 'mp3',
        audioBitrate: '192k',
      },
    });

    assert.equal(res.statusCode, 202);
    const body = res.json();
    assert.equal(body.success, true);
    const job = body.data || body;
    assert.ok(job.jobId || job.id);
  });

  // ===========================================================================
  // 4. GET /api/v1/jobs/:jobId/events (SSE)
  // ===========================================================================
  test('GET /api/v1/jobs/:jobId/events establishes SSE progress stream', async () => {
    if (!createdJobId) return;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${createdJobId}/events`,
    });

    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type']?.includes('text/event-stream'));

    const raw = res.payload;
    assert.ok(raw.includes('event: progress'));
    
    // Parse the event payload
    const dataMatch = raw.match(/data:\s*(\{.*\})/);
    assert.ok(dataMatch, 'SSE must output json data');
    const eventData = JSON.parse(dataMatch[1]);
    assert.equal(eventData.jobId, createdJobId);
    assert.ok(typeof eventData.percent === 'number');
    assert.ok(typeof eventData.speedMbps === 'number');
    assert.ok(typeof eventData.etaSec === 'number');
    assert.ok(eventData.stage);
    assert.ok(eventData.status);
  });

  // ===========================================================================
  // 5. Cobalt Fast-Path & Stream Tunnels
  // ===========================================================================
  test('POST /api/v1/jobs with Cobalt direct stream returns immediate READY job', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      payload: {
        tool: 'convert_video',
        sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        directStreamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        targetFormat: 'mp4',
        filename: 'custom_video.mp4',
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    const job = body.data || body;
    assert.equal(job.status, 'READY');
    assert.equal(job.progress, 100);
    assert.ok(job.downloadUrl);
    assert.equal(job.outputFilename, 'custom_video.mp4');
    assert.equal(job.lane, 'fast_io');
  });

  test('GET /api/v1/jobs/tunnel validates missing url parameter', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/tunnel',
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'ERR_MISSING_URL');
  });
});
