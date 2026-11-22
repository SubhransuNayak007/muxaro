/**
 * MUXARO 5-Stage Zero-Wait Pipelined Stream-Muxer Engine
 * apps/web/lib/stream-engine/index.ts
 *
 * Browser-native high-performance streaming pipeline:
 * 1. Speculative Paste-Time Warmup (pre-resolve, pre-connect, fetch init segments sub-200ms)
 * 2. Congestion-Aware Parallel Range Pipelining (512KB-8MB dynamic chunks, AIMD 4->8, 32MB RingBuffer)
 * 3. Real-Time Interleaved Remuxing (Pure-TS fMP4 & WebM/MKV with 0-second post-download merge wait)
 * 4. Zero-RAM Direct-to-Disk Streaming (Chromium FileSystemAccess & Safari/Firefox ServiceWorker)
 * 5. Hardware GPU Transcoding (WebCodecs with hardware acceleration)
 */

export type * from './types.ts';
export * from './warmup.ts';
export * from './aimd-concurrency.ts';
export * from './chunk-sizer.ts';
export * from './ring-buffer.ts';
export * from './range-pipeline.ts';
export * from './fmp4.ts';
export * from './webm.ts';
export * from './sample-parser.ts';
export * from './muxer.ts';
export * from './sink.ts';
export * from './webcodecs-transcoder.ts';
export * from './engine.ts';

// Explicit named re-exports for CommonJS / ESM toolchain compatibility
export {
  warmupStream,
  getWarmupSession,
  clearWarmupCache,
  preconnectOrigin,
} from './warmup.ts';
export {
  AimdConcurrencyController,
  DEFAULT_AIMD_CONFIG,
} from './aimd-concurrency.ts';
export {
  DynamicChunkSizer,
  DEFAULT_CHUNK_SIZER_CONFIG,
} from './chunk-sizer.ts';
export {
  OrderedSlidingRingBuffer,
} from './ring-buffer.ts';
export {
  ParallelRangePipeline,
} from './range-pipeline.ts';
export {
  ByteWriter,
  Fmp4Muxer,
} from './fmp4.ts';
export {
  WebmMuxer,
} from './webm.ts';
export {
  ElementarySampleParser,
} from './sample-parser.ts';
export {
  StreamingRemuxer,
  interleaveMediaSamples,
} from './muxer.ts';
export {
  BlobFallbackSink,
  FileSystemAccessSink,
  ServiceWorkerStreamSink,
  createOptimalSink,
  isFileSystemAccessSupported,
  isServiceWorkerStreamingSupported,
} from './sink.ts';
export {
  HardwareGpuTranscoder,
  isHardwareCodecSupported,
  isWebCodecsSupported,
} from './webcodecs-transcoder.ts';
export {
  StreamMuxerEngine,
  startZeroWaitStream,
} from './engine.ts';
