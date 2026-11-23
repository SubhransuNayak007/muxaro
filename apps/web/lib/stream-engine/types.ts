/**
 * MUXARO 5-Stage Zero-Wait Pipelined Stream-Muxer Engine
 * apps/web/lib/stream-engine/types.ts
 *
 * Core TypeScript definitions and contracts across all 5 streaming stages.
 */

export type StreamStage =
  | 'idle'
  | 'warmup'
  | 'connecting'
  | 'pipelining'
  | 'remuxing'
  | 'transcoding'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type OutputContainer = 'mp4' | 'webm' | 'mkv' | 'mp3' | 'aac' | 'wav';
export type VideoCodec = 'h264' | 'vp9' | 'av1' | 'copy';
export type AudioCodec = 'aac' | 'opus' | 'mp3' | 'copy';
export type SinkType = 'opfs' | 'file-system' | 'service-worker' | 'blob';

export interface WarmupOptions {
  /** Target origin or direct media URL */
  sourceUrl: string;
  /** Direct audio stream URL if separate */
  audioUrl?: string;
  /** Direct video stream URL if separate */
  videoUrl?: string;
  /** Timeout for speculative pre-flight in milliseconds (default: 4000ms) */
  timeoutMs?: number;
  /** Whether to fetch the first 64KB init segment speculatively (default: true) */
  fetchInitSegment?: boolean;
}

export interface WarmupSession {
  sourceUrl: string;
  timestamp: number;
  rttMs: number;
  acceptsRanges: boolean;
  contentLength?: number;
  contentType?: string;
  initSegment?: Uint8Array;
  audioContentLength?: number;
  videoContentLength?: number;
  audioInitSegment?: Uint8Array;
  videoInitSegment?: Uint8Array;
  preconnected: boolean;
}

export interface StreamProgress {
  stage: StreamStage;
  percent: number; // 0 - 100
  downloadedBytes: number;
  totalBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  activeConcurrency: number;
  currentChunkSizeBytes: number;
  bufferedBytes: number;
  fragmentsMuxed: number;
  transcodedFrames?: number;
  zeroWaitReady: boolean;
  message: string;
}

export interface StreamStats {
  bytesDownloaded: number;
  bytesWritten: number;
  totalBytesExpected: number;
  startTime: number;
  durationMs: number;
  averageSpeedBytesPerSec: number;
  peakSpeedBytesPerSec: number;
  chunkCount: number;
  fragmentsCount: number;
  concurrencyLevel: number;
  currentChunkSize: number;
  sinkType: SinkType;
}

export interface StreamResult {
  success: boolean;
  filename: string;
  totalBytes: number;
  durationMs: number;
  sinkType: SinkType;
  averageSpeedBytesPerSec: number;
  savedToDiskDirectly: boolean;
  downloadUrl?: string;
}

export interface StreamEngineOptions {
  /** Original user media URL (e.g. YouTube, Vimeo, direct HTTP) */
  sourceUrl: string;
  /** Direct downloadable video stream URL (if adaptive / separated) */
  videoUrl?: string;
  /** Direct downloadable audio stream URL (if adaptive / separated) */
  audioUrl?: string;
  /** Target output filename (e.g. "my-video.mp4") */
  filename?: string;
  /** Output container format (default: 'mp4') */
  format?: OutputContainer;
  /** Video codec setting: 'copy' for zero-wait stream copy, or specific codec */
  videoCodec?: VideoCodec;
  /** Audio codec setting: 'copy' for zero-wait stream copy, or specific codec */
  audioCodec?: AudioCodec;
  /** Expected total size in bytes if known from manifest */
  totalSizeBytes?: number;
  /** Expected video stream size in bytes */
  videoSizeBytes?: number;
  /** Expected audio stream size in bytes */
  audioSizeBytes?: number;
  /** Initial chunk size in bytes (default: 1MB, dynamic range: 512KB - 8MB) */
  initialChunkSize?: number;
  /** Initial AIMD concurrency (default: 4, min: 2, max: 8) */
  initialConcurrency?: number;
  /** Max buffered in-memory bytes before applying backpressure (default: 32MB) */
  maxBufferBytes?: number;
  /** Force hardware GPU transcoding via WebCodecs API */
  forceTranscode?: boolean;
  /** Preferred disk streaming sink */
  preferredSink?: SinkType;
  /** Optional pre-warmed session from speculative paste */
  warmupSession?: WarmupSession;
  /** Progress event callback */
  onProgress?: (progress: StreamProgress) => void;
  /** Stage transition callback */
  onStageChange?: (stage: StreamStage, message?: string) => void;
  /** Completion callback */
  onComplete?: (result: StreamResult) => void;
  /** Error callback */
  onError?: (error: Error) => void;
  /** External abort signal */
  abortSignal?: AbortSignal;
}

export interface StreamPipelineController {
  pause(): void;
  resume(): void;
  abort(reason?: string): void;
  getProgress(): StreamProgress;
  getStats(): StreamStats;
}

export interface StreamSink {
  type: SinkType;
  init(filename: string, mimeType: string, expectedSize?: number): Promise<void>;
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
  getBytesWritten(): number;
  getDownloadUrl?(): string | undefined;
}

export interface MediaSample {
  trackId: number;
  type: 'video' | 'audio';
  data: Uint8Array;
  pts: number; // Presentation timestamp in timescale units
  dts: number; // Decode timestamp in timescale units
  duration: number; // Duration in timescale units
  isKeyframe: boolean;
  timescale: number;
}

export interface VideoTrackConfig {
  trackId: number;
  codec: string; // 'avc1.640028' | 'vp09.00.10.08' | 'av01.0.08M.10'
  width: number;
  height: number;
  timescale: number; // e.g. 90000
  sps?: Uint8Array;
  pps?: Uint8Array;
}

export interface AudioTrackConfig {
  trackId: number;
  codec: string; // 'mp4a.40.2' | 'opus'
  channelCount: number;
  sampleRate: number;
  timescale: number; // e.g. 48000
  audioSpecificConfig?: Uint8Array;
}

export interface AIMDConfig {
  initialConcurrency: number;
  minConcurrency: number;
  maxConcurrency: number;
  additiveIncreaseThreshold: number; // number of fast chunks needed to +1
  rttSpikeRatio: number; // e.g. 2.0x moving average triggers decrease
}

export interface ChunkSizerConfig {
  minChunkSize: number; // 512 KB
  maxChunkSize: number; // 8 MB
  defaultChunkSize: number; // 1 MB
  targetChunkDurationMs: number; // ~500ms transfer target
}
