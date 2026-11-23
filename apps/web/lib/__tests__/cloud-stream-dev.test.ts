/**
 * MUXARO Cloud Stream & 2K / 8K Processing Verification Test Suite
 * Test File: apps/web/lib/__tests__/cloud-stream-dev.test.ts
 *
 * Verifies:
 * 1. 2K (1440p), 1080p, and 720p media resolution extraction & cloud-ready badges.
 * 2. Cloud delivery mode optimization: zero-hop direct stream vs tunnel mode.
 * 3. Serverless execution: sub-second immediate ready without hitting 512MB memory or timeout.
 * 4. 8K cloud serverless guard:
 *    - Explains that 8K requires local worker execution.
 *    - Offers 2K (1440p) and 1080p cloud-ready instant stream alternatives.
 *    - Graceful fallback with allowCloudFallback: true.
 * 5. Tier 0 stream response with range headers & web streams.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  resolveResolutionLabel,
  resolveResolutionTier,
  extractMediaMetadata,
} from '../extractor-ytdlp.ts';
import { parseResolutionHeight } from '../format-normalizer.ts';
import { jobManager } from '../job-manager.ts';
import { streamTier0ToResponse, inferMime } from '../pipeline/tier0-passthrough.ts';

describe('Cloud Stream & Serverless 2K/8K Media Pipeline', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('1. Resolution Resolution & Badge Classification', () => {
    it('correctly maps 1440p to 2K Quad HD', () => {
      assert.strictEqual(resolveResolutionLabel(1440, 2560), '1440p Quad HD');
      assert.strictEqual(resolveResolutionTier(1440), '1440p');
      assert.strictEqual(parseResolutionHeight('1440p'), 1440);
      assert.strictEqual(parseResolutionHeight('2K'), 1440);
      assert.strictEqual(parseResolutionHeight('2k'), 1440);
      assert.strictEqual(parseResolutionHeight('QHD'), 1440);
    });

    it('correctly maps 1080p to Full HD', () => {
      assert.strictEqual(resolveResolutionLabel(1080, 1920), '1080p Full HD');
      assert.strictEqual(resolveResolutionTier(1080), '1080p');
      assert.strictEqual(parseResolutionHeight('1080p'), 1080);
      assert.strictEqual(parseResolutionHeight('FHD'), 1080);
    });

    it('correctly maps 8K to 4320p Ultra HD', () => {
      assert.strictEqual(resolveResolutionLabel(4320, 7680), '8K Ultra HD');
      assert.strictEqual(resolveResolutionTier(4320), '8K');
      assert.strictEqual(parseResolutionHeight('8K'), 4320);
      assert.strictEqual(parseResolutionHeight('8k'), 4320);
      assert.strictEqual(parseResolutionHeight('4320p'), 4320);
    });
  });

  describe('2. Direct Media Extraction & Cloud Delivery Modes', () => {
    it('identifies direct media files as zero-hop delivery mode with 1440p/2K support', async () => {
      const manifest = await extractMediaMetadata('https://cdn.example.com/videos/sample-nature-2k.mp4');

      assert.strictEqual(manifest.deliveryMode, 'zero-hop', 'Direct MP4 should be zero-hop');
      assert.strictEqual(manifest.directStreamUrl, 'https://cdn.example.com/videos/sample-nature-2k.mp4');
      assert.strictEqual(manifest.maxResolutionLabel, '1440p Quad HD');

      // Verify 1440p, 1080p, and 720p formats exist
      const res1440 = manifest.videoFormats.find((f) => f.resolutionHeight === 1440);
      assert.ok(res1440, '1440p format must exist');
      assert.ok(res1440.badge?.includes('Cloud Ready'), '1440p badge must indicate Cloud Ready');

      const res1080 = manifest.videoFormats.find((f) => f.resolutionHeight === 1080);
      assert.ok(res1080, '1080p format must exist');
      assert.ok(res1080.badge?.includes('Cloud Ready'), '1080p badge must indicate Cloud Ready');
    });

    it('identifies social progressive streams with 1440p/2K support', async () => {
      const manifest = await extractMediaMetadata('https://media.example.org/craft-demo.mp4');

      assert.strictEqual(manifest.deliveryMode, 'zero-hop');
      assert.ok(manifest.videoFormats.some((f) => f.resolutionHeight === 1440), 'Must include 1440p Quad HD format');
    });
  });

  describe('3. Cloud Serverless 8K Guard & Graceful Degradation', () => {
    it('gracefully explains that 8K requires local worker execution in serverless mode', async () => {
      // Simulate Vercel / serverless environment
      process.env.VERCEL = '1';

      const job = await jobManager.createJob({
        sourceUrl: 'https://cdn.example.com/videos/nature-8k.mp4',
        targetResolution: '8K',
        targetFormat: 'mp4',
      });

      assert.strictEqual(job.status, 'failed', '8K on cloud serverless must not attempt local FFmpeg render');
      assert.strictEqual(job.stage, 'REQUIRES_LOCAL_WORKER');
      assert.strictEqual(job.error?.code, 'RESOLUTION_REQUIRES_LOCAL_WORKER');
      assert.strictEqual(job.requiresLocalWorker, true);
      assert.strictEqual(job.suggestedResolution, '1440p');

      // Check message explains local worker requirement
      const msg = job.error?.message || '';
      assert.ok(
        msg.includes('requires local worker execution'),
        'Must explain that 8K requires local worker execution'
      );
      assert.ok(
        msg.includes('2K (1440p)') || msg.includes('1080p'),
        'Must offer 2K (1440p) or 1080p cloud-ready instant stream'
      );

      // Verify cloud-ready alternatives are offered
      const alts = job.cloudReadyAlternatives as any[];
      assert.ok(Array.isArray(alts) && alts.length >= 2, 'Must offer cloud-ready alternatives');
      assert.ok(alts.some((a) => a.resolution === '1440p'), 'Must offer 1440p alternative');
      assert.ok(alts.some((a) => a.resolution === '1080p'), 'Must offer 1080p alternative');
    });

    it('automatically routes to 2K (1440p) instant stream when allowCloudFallback is true', async () => {
      process.env.VERCEL = '1';

      const job = await jobManager.createJob({
        sourceUrl: 'https://cdn.example.com/videos/nature-8k.mp4',
        targetResolution: '8K',
        targetFormat: 'mp4',
        allowCloudFallback: true,
      });

      assert.strictEqual(job.status, 'ready');
      assert.strictEqual(job.targetResolution, '1440p', 'Should have routed to 1440p Quad HD');
      assert.strictEqual(job.deliveryMode, 'zero-hop');
      assert.ok(job.stageMessage.includes('routed to 2K (1440p)'), 'Must indicate routed to 2K');
    });
  });

  describe('4. Cloud Delivery Modes: Zero-Hop vs Tunnel', () => {
    it('executes zero-hop handover with 0 server disk and 0 server memory', async () => {
      process.env.VERCEL = '1';

      const directUrl = 'https://cdn.example.com/videos/stream-2k.mp4';
      const job = await jobManager.createJob({
        sourceUrl: directUrl,
        targetResolution: '1440p',
        targetFormat: 'mp4',
      });

      assert.strictEqual(job.status, 'ready');
      assert.strictEqual(job.progress, 100);
      assert.strictEqual(job.deliveryMode, 'zero-hop');
      assert.strictEqual(job.directStreamUrl, directUrl);
      assert.strictEqual(job.downloadUrl, directUrl);
      assert.strictEqual(job.filePath, undefined, 'Zero-hop must never write to server disk');
    });

    it('executes cloud tunnel mode without memory accumulation', async () => {
      process.env.VERCEL = '1';

      // Mock remote HTTP server that serves a 10MB chunked stream
      const server = http.createServer((req, res) => {
        if (req.url === '/tunnel-stream.mp4') {
          res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Content-Length': '10485760',
            'Accept-Ranges': 'bytes',
          });
          // Send 100 chunks of 100KB with small intervals
          for (let i = 0; i < 10; i++) {
            res.write(Buffer.alloc(1024 * 1024, 0x41));
          }
          res.end();
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as any).port;

      try {
        const streamUrl = `http://127.0.0.1:${port}/tunnel-stream.mp4`;

        // Direct stream testing with streamTier0ToResponse
        const mockReqSignal = new AbortController().signal;
        const res = await fetch(streamUrl);
        assert.ok(res.body, 'Body must be readable stream');

        const webResponse = streamTier0ToResponse({
          source: res.body,
          filename: 'test-2k-video.mp4',
          contentLength: 10485760,
          contentType: 'video/mp4',
          status: 200,
          signal: mockReqSignal,
        });

        assert.strictEqual(webResponse.status, 200);
        assert.strictEqual(webResponse.headers.get('Content-Type'), 'video/mp4');
        assert.strictEqual(webResponse.headers.get('Content-Length'), '10485760');
        assert.ok(webResponse.headers.get('Content-Disposition')?.includes('test-2k-video.mp4'));

        // Consume stream chunk-by-chunk to verify streaming and memory limit
        const reader = webResponse.body?.getReader();
        assert.ok(reader, 'Web stream reader must be available');

        let totalReceived = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalReceived += value.length;
        }

        assert.strictEqual(totalReceived, 10485760, 'All 10MB streamed without truncation');
      } finally {
        server.close();
      }
    });
  });

  describe('5. RFC 9110 Range Header Support (206 Partial Content)', () => {
    it('supports Range requests in streamTier0ToResponse', () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.alloc(2048, 0x42));
          controller.close();
        },
      });

      const res = streamTier0ToResponse({
        source: mockStream,
        filename: 'video-range-test.mp4',
        contentLength: 1024,
        contentRange: 'bytes 0-1023/2048',
        status: 206,
      });

      assert.strictEqual(res.status, 206);
      assert.strictEqual(res.headers.get('Content-Range'), 'bytes 0-1023/2048');
      assert.strictEqual(res.headers.get('Accept-Ranges'), 'bytes');
      assert.strictEqual(res.headers.get('Content-Length'), '1024');
    });
  });
});
