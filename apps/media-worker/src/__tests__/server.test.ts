import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createServer } from '../server.js';
import { FastifyInstance } from 'fastify';

describe('Media Worker Fastify Server API', () => {
  let server: FastifyInstance;
  const testDir = path.join(os.tmpdir(), `muxaro_server_test_${Date.now()}`);
  const sampleVideo = path.join(testDir, 'sample.mp4');

  before(async () => {
    fs.mkdirSync(testDir, { recursive: true });
    // Generate a quick 1-second video
    spawnSync('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'testsrc=duration=1:size=640x360:rate=25',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1',
      '-c:v', 'libx264', '-preset', 'ultrafast',
      '-c:a', 'aac',
      sampleVideo
    ]);

    server = createServer();
    await server.ready();
  });

  after(async () => {
    await server.close();
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  test('GET /health returns 200 with healthy status', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/health'
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.status, 'healthy');
    assert.ok(body.ffmpegVersion);
    assert.ok(body.ffprobeVersion);
  });

  test('POST /api/probe returns media stream metadata', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/probe',
      payload: {
        inputPath: sampleVideo
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.success, true);
    assert.equal(body.data.hasVideo, true);
    assert.equal(body.data.trueResolutionTier, '360p');
    assert.ok(body.requestId);
  });

  test('POST /api/extract-audio extracts audio via API', async () => {
    const outputAudio = path.join(testDir, 'api_audio.mp3');
    const res = await server.inject({
      method: 'POST',
      url: '/api/extract-audio',
      payload: {
        inputPath: sampleVideo,
        outputPath: outputAudio,
        targetFormat: 'mp3',
        bitrateKbps: 192
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.success, true);
    assert.equal(body.data.actionTaken, 'AUDIO_TRANSCODE');
    assert.ok(fs.existsSync(outputAudio));
  });

  test('POST /api/verify checks file integrity', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/verify',
      payload: {
        filePath: sampleVideo,
        requireVideo: true,
        requireAudio: true
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.success, true);
    assert.equal(body.data.valid, true);
    assert.equal(body.data.hasVideo, true);
  });

  test('GET /api/scratch/stats returns disk metrics', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/scratch/stats'
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.success, true);
    assert.ok(body.data.maxSizeBytes > 0);
  });
});
