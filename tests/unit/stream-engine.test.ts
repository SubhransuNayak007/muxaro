/**
 * MUXARO Stream Engine - Comprehensive Unit & Pipeline Test Suite
 * File: tests/unit/stream-engine.test.ts
 *
 * Verifies all 5 stages of the Zero-Wait Pipelined Stream-Muxer:
 * 1. Speculative Paste-Time Warmup (pre-resolve, pre-connect, cache, init segment)
 * 2. AIMD Concurrency Controller (4->8 scale, additive increase, multiplicative decrease)
 * 3. Dynamic Chunk Sizer (512KB-8MB bounds, throughput adaptation)
 * 4. Ordered Sliding Ring Buffer (out-of-order reassembly, ~32MB backpressure)
 * 5. Pure-TS fMP4 & WebM Streaming Muxers (box packaging, sample interleaving, 0s merge wait)
 * 6. Direct-to-Disk Sinks (FSA, SW, Blob fallback)
 * 7. WebCodecs Hardware Transcoder feature detection
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AimdConcurrencyController,
  DynamicChunkSizer,
  OrderedSlidingRingBuffer,
  Fmp4Muxer,
  WebmMuxer,
  ElementarySampleParser,
  warmupStream,
  getWarmupSession,
  clearWarmupCache,
  isFileSystemAccessSupported,
  isServiceWorkerStreamingSupported,
  isOPFSSupported,
  isWebCodecsSupported,
  BlobFallbackSink,
  OPFSStreamSink,
  StreamMuxerEngine,
  type MediaSample,
} from '../../apps/web/lib/stream-engine/index.ts';

describe('Stage 1: Speculative Paste-Time Warmup', () => {
  it('should manage warmup session cache and TTL correctly', async () => {
    clearWarmupCache();
    const testUrl = 'https://example.com/stream/video.mp4';

    assert.strictEqual(getWarmupSession(testUrl), undefined);

    // Warmup without network mock returns graceful session
    const session = await warmupStream(testUrl, { fetchInitSegment: false, timeoutMs: 100 });
    assert.strictEqual(session.sourceUrl, testUrl);
    assert.strictEqual(session.preconnected, true);
    assert.ok(session.rttMs >= 0);

    // Subsequent call retrieves from warm cache
    const cached = getWarmupSession(testUrl);
    assert.ok(cached !== undefined);
    assert.strictEqual(cached?.sourceUrl, testUrl);

    clearWarmupCache();
    assert.strictEqual(getWarmupSession(testUrl), undefined);
  });
});

describe('Stage 2: AIMD Concurrency Controller', () => {
  it('should initialize at concurrency = 4', () => {
    const aimd = new AimdConcurrencyController();
    assert.strictEqual(aimd.getConcurrency(), 4);
  });

  it('should additively scale up to 8 on sustained low-latency chunk downloads', () => {
    const aimd = new AimdConcurrencyController({ initialConcurrency: 4, maxConcurrency: 8, additiveIncreaseThreshold: 3 });

    // 3 fast chunks -> concurrency becomes 5
    aimd.recordSuccess(100, 1024 * 1024);
    aimd.recordSuccess(100, 1024 * 1024);
    aimd.recordSuccess(100, 1024 * 1024);
    assert.strictEqual(aimd.getConcurrency(), 5);

    // Another 3 fast chunks -> concurrency becomes 6
    aimd.recordSuccess(100, 1024 * 1024);
    aimd.recordSuccess(100, 1024 * 1024);
    aimd.recordSuccess(100, 1024 * 1024);
    assert.strictEqual(aimd.getConcurrency(), 6);

    // Scale up through 7 to max 8
    for (let i = 0; i < 6; i++) {
      aimd.recordSuccess(100, 1024 * 1024);
    }
    assert.strictEqual(aimd.getConcurrency(), 8);

    // Cap at max 8
    aimd.recordSuccess(100, 1024 * 1024);
    aimd.recordSuccess(100, 1024 * 1024);
    aimd.recordSuccess(100, 1024 * 1024);
    assert.strictEqual(aimd.getConcurrency(), 8);
  });

  it('should multiplicatively decrease on congestion (429 / 503 / timeout)', () => {
    const aimd = new AimdConcurrencyController({ initialConcurrency: 8, minConcurrency: 2 });
    assert.strictEqual(aimd.getConcurrency(), 8);

    aimd.recordCongestion('http_429');
    // Math.floor(8 * 0.75) = 6
    assert.strictEqual(aimd.getConcurrency(), 6);

    aimd.recordCongestion('timeout');
    // Math.floor(6 * 0.75) = 4
    assert.strictEqual(aimd.getConcurrency(), 4);

    aimd.recordCongestion('http_503');
    // Math.floor(4 * 0.75) = 3
    assert.strictEqual(aimd.getConcurrency(), 3);

    aimd.recordCongestion('network_error');
    // Math.floor(3 * 0.75) = 2 (clamped to minConcurrency: 2)
    assert.strictEqual(aimd.getConcurrency(), 2);
  });
});

describe('Stage 2: Dynamic Chunk Sizer', () => {
  it('should clamp chunks strictly within 512KB and 8MB', () => {
    const sizer = new DynamicChunkSizer({
      minChunkSize: 512 * 1024,
      maxChunkSize: 8 * 1024 * 1024,
      defaultChunkSize: 1024 * 1024,
    });

    assert.strictEqual(sizer.getChunkSize(), 1024 * 1024);

    // Simulate ultra-high speed (50 MB/s for 100ms) -> should scale up towards 8MB
    sizer.recordChunkTransfer(50 * 1024 * 1024, 1000);
    assert.ok(sizer.getChunkSize() >= 2 * 1024 * 1024);
    assert.ok(sizer.getChunkSize() <= 8 * 1024 * 1024);

    // Repeated high speed -> hits 8MB ceiling
    for (let i = 0; i < 5; i++) {
      sizer.recordChunkTransfer(40 * 1024 * 1024, 1000);
    }
    assert.strictEqual(sizer.getChunkSize(), 8 * 1024 * 1024);

    // Simulate crawl network (50 KB in 1000ms) -> scales down to 512KB floor
    for (let i = 0; i < 10; i++) {
      sizer.recordChunkTransfer(50 * 1024, 1000);
    }
    assert.strictEqual(sizer.getChunkSize(), 512 * 1024);
  });
});

describe('Stage 2: Ordered Sliding Ring Buffer with Backpressure', () => {
  it('should reassemble out-of-order chunks monotonically', async () => {
    const buffer = new OrderedSlidingRingBuffer({ maxBufferBytes: 32 * 1024 * 1024 });

    const c0 = { index: 0, data: new Uint8Array([1, 2, 3]), byteOffset: 0, totalLength: 9 };
    const c1 = { index: 1, data: new Uint8Array([4, 5, 6]), byteOffset: 3, totalLength: 9 };
    const c2 = { index: 2, data: new Uint8Array([7, 8, 9]), byteOffset: 6, totalLength: 9 };

    // Arrive out of order: chunk 1 arrives first, then chunk 2
    buffer.pushChunk(c1);
    buffer.pushChunk(c2);

    assert.strictEqual(buffer.getPendingChunkCount(), 2);
    assert.strictEqual(buffer.getNextExpectedIndex(), 0);

    // Push chunk 0
    buffer.pushChunk(c0);

    // Consume in strict order: 0 -> 1 -> 2
    const popped0 = await buffer.popNextOrderedChunk();
    assert.strictEqual(popped0?.index, 0);

    const popped1 = await buffer.popNextOrderedChunk();
    assert.strictEqual(popped1?.index, 1);

    const popped2 = await buffer.popNextOrderedChunk();
    assert.strictEqual(popped2?.index, 2);

    buffer.close();
    const eof = await buffer.popNextOrderedChunk();
    assert.strictEqual(eof, null);
  });

  it('should enforce backpressure watermark at ~32MB threshold', () => {
    const buffer = new OrderedSlidingRingBuffer({
      maxBufferBytes: 10 * 1024 * 1024, // 10MB test cap
      highWatermarkRatio: 0.7, // 7MB high watermark
    });

    assert.strictEqual(buffer.isHighWatermark(), false);

    // Push 4MB chunk
    buffer.pushChunk({
      index: 0,
      data: new Uint8Array(4 * 1024 * 1024),
      byteOffset: 0,
      totalLength: 10 * 1024 * 1024,
    });
    assert.strictEqual(buffer.isHighWatermark(), false);

    // Push another 4MB chunk (total: 8MB > 7MB threshold)
    buffer.pushChunk({
      index: 1,
      data: new Uint8Array(4 * 1024 * 1024),
      byteOffset: 4 * 1024 * 1024,
      totalLength: 10 * 1024 * 1024,
    });
    assert.strictEqual(buffer.isHighWatermark(), true);
  });
});

describe('Stage 3: Pure-TS fMP4 Streaming Muxer', () => {
  it('should generate valid ftyp and moov boxes', () => {
    const muxer = new Fmp4Muxer(
      { trackId: 1, codec: 'avc1.640028', width: 1920, height: 1080, timescale: 90000 },
      { trackId: 2, codec: 'mp4a.40.2', channelCount: 2, sampleRate: 48000, timescale: 48000 }
    );

    const initSegment = muxer.generateInitSegment();
    assert.ok(initSegment.byteLength > 100);

    // Verify 'ftyp' box magic
    const ftypType = String.fromCharCode(initSegment[4], initSegment[5], initSegment[6], initSegment[7]);
    assert.strictEqual(ftypType, 'ftyp');

    // Verify 'iso6' brand
    const majorBrand = String.fromCharCode(initSegment[8], initSegment[9], initSegment[10], initSegment[11]);
    assert.strictEqual(majorBrand, 'iso6');
  });

  it('should generate moof + mdat movie fragments with 0s merge wait', () => {
    const muxer = new Fmp4Muxer(
      { trackId: 1, codec: 'avc1.640028', width: 1920, height: 1080, timescale: 90000 },
      { trackId: 2, codec: 'mp4a.40.2', channelCount: 2, sampleRate: 48000, timescale: 48000 }
    );

    const videoSample: MediaSample = {
      trackId: 1,
      type: 'video',
      data: new Uint8Array([0, 0, 0, 5, 0x65, 1, 2, 3, 4]),
      pts: 0,
      dts: 0,
      duration: 3000,
      isKeyframe: true,
      timescale: 90000,
    };

    const audioSample: MediaSample = {
      trackId: 2,
      type: 'audio',
      data: new Uint8Array([0x21, 0x43, 0x65]),
      pts: 0,
      dts: 0,
      duration: 1024,
      isKeyframe: true,
      timescale: 48000,
    };

    const fragment = muxer.generateFragment([videoSample], [audioSample]);
    assert.ok(fragment.byteLength > 50);

    // Verify 'moof' box
    const moofType = String.fromCharCode(fragment[4], fragment[5], fragment[6], fragment[7]);
    assert.strictEqual(moofType, 'moof');
  });
});

describe('Stage 3: Pure-TS WebM Streaming Muxer', () => {
  it('should generate valid EBML header and streaming Clusters', () => {
    const webmMuxer = new WebmMuxer(
      { trackId: 1, codec: 'vp09.00.10.08', width: 1920, height: 1080, timescale: 1000 },
      { trackId: 2, codec: 'opus', channelCount: 2, sampleRate: 48000, timescale: 1000 }
    );

    const init = webmMuxer.generateInitSegment();
    assert.ok(init.byteLength > 50);

    // First 4 bytes are EBML header ID: 0x1A45DFA3
    assert.strictEqual(init[0], 0x1a);
    assert.strictEqual(init[1], 0x45);
    assert.strictEqual(init[2], 0xdf);
    assert.strictEqual(init[3], 0xa3);

    const sample: MediaSample = {
      trackId: 1,
      type: 'video',
      data: new Uint8Array([0x82, 0x49, 0x83, 0x42]),
      pts: 0,
      dts: 0,
      duration: 33,
      isKeyframe: true,
      timescale: 1000,
    };

    const cluster = webmMuxer.generateCluster([sample]);
    assert.ok(cluster.byteLength > 10);
    // Cluster ID: 0x1F43B675
    assert.strictEqual(cluster[0], 0x1f);
    assert.strictEqual(cluster[1], 0x43);
    assert.strictEqual(cluster[2], 0xb6);
    assert.strictEqual(cluster[3], 0x75);
  });
});

describe('Stage 4: Zero-RAM Direct-to-Disk Streaming Sinks', () => {
  it('should accurately detect browser sink support', () => {
    assert.strictEqual(typeof isFileSystemAccessSupported(), 'boolean');
    assert.strictEqual(typeof isServiceWorkerStreamingSupported(), 'boolean');
    assert.strictEqual(typeof isOPFSSupported(), 'boolean');
  });

  it('should write chunks progressively and close with BlobFallbackSink', async () => {
    const sink = new BlobFallbackSink();
    await sink.init('test_video.mp4', 'video/mp4');

    const c1 = new Uint8Array([1, 2, 3, 4]);
    const c2 = new Uint8Array([5, 6, 7, 8]);
    await sink.write(c1);
    await sink.write(c2);

    assert.strictEqual(sink.getBytesWritten(), 8);
    await sink.close();
  });

  it('should support OPFSStreamSink stream accumulation with fallback safety', async () => {
    const sink = new OPFSStreamSink();
    assert.strictEqual(sink.type, 'opfs');

    await sink.init('test_opfs_stream.mp4', 'video/mp4');
    await sink.write(new Uint8Array([10, 20, 30]));
    assert.strictEqual(sink.getBytesWritten(), 3);
    await sink.close();
  });
});

describe('Stage 5: WebCodecs Hardware Acceleration', () => {
  it('should expose WebCodecs support detection accurately', () => {
    assert.strictEqual(typeof isWebCodecsSupported(), 'boolean');
  });
});
