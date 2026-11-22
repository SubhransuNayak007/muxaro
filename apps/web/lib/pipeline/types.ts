/**
 * MUXARO 4-Tier Hyper-Pipeline Canonical Contracts
 * apps/web/lib/pipeline/types.ts
 */

export type ExecutionTier =
  | 'TIER_0_ZERO_HOP'
  | 'TIER_1_CLIENT_WEBCODECS'
  | 'TIER_2_CUT_THROUGH_PIPE'
  | 'TIER_3_FASTSTART_SCRATCH';

export type DiskIoMode = 'zero-disk' | 'tmpfs' | 'scratch';
export type MuxMode = 'stream-copy' | 'audio-aac-only' | 'transcode';

export interface PipelineTelemetry {
  executionTier: ExecutionTier;
  cacheHit: boolean;
  ttfbMs?: number;
  totalDurationMs?: number;
  parallelConnections?: number;
  bytesPerSec?: number;
  diskIoMode: DiskIoMode;
  muxMode: MuxMode;
}

export interface StreamTrackDescriptor {
  trackType: 'video' | 'audio';
  url: string;
  codec: string;
  container: string;
  contentLength?: number;
  bitrateKbps?: number;
  width?: number;
  height?: number;
  fps?: number;
  headers?: Record<string, string>;
}

export interface HyperPipelineJobSpec {
  jobId: string;
  sourceUrl: string;
  targetFormat: string;
  targetResolution?: string;
  preferredDeliveryMode?: 'instant_stream' | 'universal_faststart';
  title?: string;
  videoTrack?: StreamTrackDescriptor;
  audioTrack?: StreamTrackDescriptor;
  directProgressiveUrl?: string;
  isLocalUpload?: boolean;
}

export interface RouteDecision {
  tier: ExecutionTier;
  diskIoMode: DiskIoMode;
  muxMode: MuxMode;
  reason: string;
  outputContainer: string;
}
