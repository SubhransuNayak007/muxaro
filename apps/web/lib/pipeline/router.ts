/**
 * MUXARO 4-Tier Adaptive Routing Engine
 * apps/web/lib/pipeline/router.ts
 */

import type { HyperPipelineJobSpec, RouteDecision, DiskIoMode, MuxMode } from './types.ts';

export function resolveOptimalTier(spec: HyperPipelineJobSpec): RouteDecision {
  const targetFormat = (spec.targetFormat || 'mp4').toLowerCase();
  const isAudioOnly = ['mp3', 'm4a', 'flac', 'wav', 'opus', 'aac'].includes(targetFormat);

  // 1. Tier 1: Local file upload tools in browser
  if (spec.isLocalUpload) {
    return {
      tier: 'TIER_1_CLIENT_WEBCODECS',
      diskIoMode: 'zero-disk',
      muxMode: 'stream-copy',
      reason: 'Local file processing executed inside browser Web Worker via WebCodecs/OPFS (0 MB uploaded)',
      outputContainer: targetFormat,
    };
  }

  // 2. Tier 0: Single progressive stream (direct MP4 / direct audio with no muxing required)
  if (spec.directProgressiveUrl && !spec.audioTrack) {
    return {
      tier: 'TIER_0_ZERO_HOP',
      diskIoMode: 'zero-disk',
      muxMode: 'stream-copy',
      reason: 'Progressive single-container stream delivered directly without FFmpeg re-packaging',
      outputContainer: targetFormat,
    };
  }

  // 3. Tier 2: Instant-start Cut-Through Streaming Muxer (0 disk writes, TTFB < 2s)
  // Selected for MKV, WebM, or explicit Instant Stream mode
  const isInstantStreamRequested =
    spec.preferredDeliveryMode === 'instant_stream' ||
    targetFormat === 'mkv' ||
    targetFormat === 'webm';

  if (isInstantStreamRequested && spec.videoTrack && spec.audioTrack) {
    return {
      tier: 'TIER_2_CUT_THROUGH_PIPE',
      diskIoMode: 'zero-disk',
      muxMode: 'stream-copy',
      reason: `Dual-track stream copy muxed through ephemeral loopback bridge directly to HTTP response (${targetFormat.toUpperCase()})`,
      outputContainer: targetFormat,
    };
  }

  // 4. Tier 3: Universal Faststart MP4 or audio container generation
  // Uses parallel chunk fetch into tmpfs/scratch + -c copy -movflags +faststart
  const isTmpfsAvailable = process.platform === 'linux';
  const diskIoMode: DiskIoMode = isTmpfsAvailable ? 'tmpfs' : 'scratch';
  
  let muxMode: MuxMode = 'stream-copy';
  if (targetFormat === 'mp4' && spec.audioTrack?.codec?.toLowerCase() === 'opus') {
    muxMode = 'audio-aac-only';
  } else if (isAudioOnly && targetFormat === 'mp3') {
    muxMode = 'transcode';
  }

  return {
    tier: 'TIER_3_FASTSTART_SCRATCH',
    diskIoMode,
    muxMode,
    reason: `Universal Faststart MP4/audio container requiring seekable headers with parallel chunk fetching into ${diskIoMode}`,
    outputContainer: targetFormat,
  };
}
