/**
 * MUXARO Media Processing Engine - Stream & Resolution Classifier
 * Maps dimensions to authentic resolution tiers (up to genuine 8K) and evaluates stream-copy viability.
 */

import { ResolutionTier, VideoStreamInfo, AudioStreamInfo } from '../types/media.js';
import { VideoContainer, AudioContainer } from '../types/transcode.js';

export class MediaClassifier {
  /**
   * Resolves dimension numbers to standard marketing and broadcast resolution tiers.
   * Recognizes non-standard aspect ratios (ultrawide 21:9, vertical 9:16) by max(width, height)
   * or min(width, height) appropriately.
   */
  public static classifyResolution(width: number, height: number): ResolutionTier {
    const maxDim = Math.max(width, height);
    const minDim = Math.min(width, height);

    if (maxDim >= 7000 || minDim >= 4000) return '8K';
    if (maxDim >= 3500 || minDim >= 2000) return '4K';
    if (maxDim >= 2400 || minDim >= 1400) return '1440p';
    if (maxDim >= 1800 || minDim >= 1000) return '1080p';
    if (maxDim >= 1200 || minDim >= 700) return '720p';
    if (maxDim >= 800 || minDim >= 450) return '480p';
    if (maxDim >= 600 || minDim >= 340) return '360p';

    return 'UNKNOWN';
  }

  /**
   * Rank order of resolutions: higher number = higher resolution.
   */
  public static readonly RESOLUTION_RANKS: Record<ResolutionTier, number> = {
    'UNKNOWN': 0,
    '360p': 1,
    '480p': 2,
    '720p': 3,
    '1080p': 4,
    '1440p': 5,
    '4K': 6,
    '8K': 7
  };

  /**
   * Standard width x height bounds for each tier (16:9 standard).
   */
  public static readonly TIER_DIMENSIONS: Record<ResolutionTier, { width: number; height: number }> = {
    '8K': { width: 7680, height: 4320 },
    '4K': { width: 3840, height: 2160 },
    '1440p': { width: 2560, height: 1440 },
    '1080p': { width: 1920, height: 1080 },
    '720p': { width: 1280, height: 720 },
    '480p': { width: 854, height: 480 },
    '360p': { width: 640, height: 360 },
    'UNKNOWN': { width: 0, height: 0 }
  };

  /**
   * Computes target dimensions while maintaining aspect ratio and scaling down only.
   * Guarantees even dimensions (divisible by 2) to satisfy H.264/H.265 encoder constraints.
   */
  public static computeTargetDimensions(
    sourceWidth: number,
    sourceHeight: number,
    targetTier?: ResolutionTier
  ): { targetWidth: number; targetHeight: number; needsScaling: boolean } {
    if (!targetTier || targetTier === 'UNKNOWN') {
      return {
        targetWidth: sourceWidth - (sourceWidth % 2),
        targetHeight: sourceHeight - (sourceHeight % 2),
        needsScaling: false
      };
    }

    const tierBounds = this.TIER_DIMENSIONS[targetTier];
    if (tierBounds.height === 0) {
      return {
        targetWidth: sourceWidth - (sourceWidth % 2),
        targetHeight: sourceHeight - (sourceHeight % 2),
        needsScaling: false
      };
    }

    const sourceAspect = sourceWidth / sourceHeight;

    // Strict downscaling rule: never upscale beyond source dimensions
    if (sourceHeight <= tierBounds.height && sourceWidth <= tierBounds.width) {
      return {
        targetWidth: sourceWidth - (sourceWidth % 2),
        targetHeight: sourceHeight - (sourceHeight % 2),
        needsScaling: false
      };
    }

    // Scale down bound by max width and max height
    let targetH = tierBounds.height;
    let targetW = Math.round(targetH * sourceAspect);

    if (targetW > tierBounds.width) {
      targetW = tierBounds.width;
      targetH = Math.round(targetW / sourceAspect);
    }

    // Ensure divisible by 2
    targetW = targetW - (targetW % 2);
    targetH = targetH - (targetH % 2);

    return {
      targetWidth: targetW,
      targetHeight: targetH,
      needsScaling: true
    };
  }

  /**
   * Evaluates if a video codec is natively supported inside a target container without transcoding.
   */
  public static isVideoCodecCompatibleWithContainer(codec: string, container: VideoContainer): boolean {
    const c = codec.toLowerCase();
    switch (container) {
      case 'mp4':
        return ['h264', 'hevc', 'h265', 'av01', 'av1', 'vp9', 'mpeg4'].includes(c);
      case 'mkv':
        return true; // Matroska accepts virtually all video codecs
      case 'webm':
        return ['vp8', 'vp9', 'av1', 'av01'].includes(c);
      default:
        return false;
    }
  }

  /**
   * Evaluates if an audio codec is natively supported inside a target container without transcoding.
   */
  public static isAudioCodecCompatibleWithContainer(codec: string, container: VideoContainer | AudioContainer): boolean {
    const c = codec.toLowerCase();
    switch (container) {
      case 'mp4':
      case 'm4a':
        return ['aac', 'mp3', 'alac', 'ac3', 'eac3', 'opus'].includes(c);
      case 'mkv':
        return true; // Matroska accepts virtually all audio codecs
      case 'webm':
      case 'ogg':
      case 'opus':
        return ['opus', 'vorbis'].includes(c);
      case 'mp3':
        return c === 'mp3';
      case 'flac':
        return c === 'flac';
      case 'wav':
        return ['pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le'].includes(c);
      default:
        return false;
    }
  }

  /**
   * Determines if stream-copy is possible for a video pipeline.
   * Conditions:
   * 1. No resolution downscale is requested (or target resolution >= source resolution).
   * 2. Target video codec is 'copy' or matches source video codec.
   * 3. Source video codec is compatible with target container.
   * 4. Source audio codec is compatible with target container (or audio is 'copy').
   */
  public static canStreamCopyVideo(
    videoStream: VideoStreamInfo,
    audioStream: AudioStreamInfo | undefined,
    targetContainer: VideoContainer,
    requestedResolution?: ResolutionTier,
    requestedVideoCodec?: string
  ): { canCopyVideo: boolean; canCopyAudio: boolean; reason: string } {
    // 1. Resolution check
    if (requestedResolution && requestedResolution !== 'UNKNOWN') {
      const sourceRank = this.RESOLUTION_RANKS[videoStream.resolutionTier];
      const targetRank = this.RESOLUTION_RANKS[requestedResolution];
      if (targetRank < sourceRank) {
        return {
          canCopyVideo: false,
          canCopyAudio: false,
          reason: `Downscaling required from ${videoStream.resolutionTier} to ${requestedResolution}.`
        };
      }
    }

    // 2. Video codec compatibility
    const videoCodec = videoStream.codec.toLowerCase();
    const wantsExplicitDifferentCodec =
      requestedVideoCodec &&
      requestedVideoCodec !== 'copy' &&
      requestedVideoCodec.toLowerCase() !== videoCodec;

    if (wantsExplicitDifferentCodec) {
      return {
        canCopyVideo: false,
        canCopyAudio: false,
        reason: `Explicit video codec conversion requested from ${videoCodec} to ${requestedVideoCodec}.`
      };
    }

    const videoCompatible = this.isVideoCodecCompatibleWithContainer(videoCodec, targetContainer);
    if (!videoCompatible) {
      return {
        canCopyVideo: false,
        canCopyAudio: false,
        reason: `Source video codec (${videoCodec}) is not supported in ${targetContainer} container.`
      };
    }

    // 3. Audio compatibility
    let canCopyAudio = true;
    if (audioStream) {
      canCopyAudio = this.isAudioCodecCompatibleWithContainer(audioStream.codec, targetContainer);
    }

    return {
      canCopyVideo: true,
      canCopyAudio,
      reason: canCopyAudio
        ? 'Full stream-copy possible (zero quality loss, near-instant remux).'
        : 'Video stream-copy possible; audio requires transcoding for container compatibility.'
    };
  }

  /**
   * Evaluates audio extraction honesty.
   */
  public static evaluateAudioHonesty(
    sourceStream: AudioStreamInfo,
    targetFormat: AudioContainer,
    requestedBitrateKbps?: number
  ): {
    isStreamCopy: boolean;
    isLosslessTarget: boolean;
    isUpsampling: boolean;
    verdict: 'NATIVE_COPY' | 'TRANSPARENT_ENCODE' | 'LOSSY_TO_LOSSY_DEGRADATION' | 'FALSE_FIDELITY_UPSAMPLING';
    explanation: string;
  } {
    const srcCodec = sourceStream.codec.toLowerCase();
    const isLosslessTarget = ['flac', 'wav'].includes(targetFormat.toLowerCase());
    const isLosslessSource = sourceStream.isLossless;

    // Check if target is a direct stream-copy
    const isNativeMatch =
      (targetFormat === 'copy') ||
      (targetFormat === 'aac' && srcCodec === 'aac') ||
      (targetFormat === 'm4a' && srcCodec === 'aac') ||
      (targetFormat === 'opus' && srcCodec === 'opus') ||
      (targetFormat === 'mp3' && srcCodec === 'mp3') ||
      (targetFormat === 'flac' && srcCodec === 'flac');

    if (isNativeMatch) {
      return {
        isStreamCopy: true,
        isLosslessTarget: isLosslessSource,
        isUpsampling: false,
        verdict: 'NATIVE_COPY',
        explanation: `Pure bit-for-bit stream copy of source ${srcCodec} audio. Zero re-encoding loss.`
      };
    }

    // Check if user is asking for FLAC / WAV from a lossy source (e.g. 128kbps AAC -> FLAC)
    if (!isLosslessSource && isLosslessTarget) {
      return {
        isStreamCopy: false,
        isLosslessTarget: true,
        isUpsampling: true,
        verdict: 'FALSE_FIDELITY_UPSAMPLING',
        explanation: `Source audio is lossy (${srcCodec} @ ${sourceStream.bitrateKbps ?? 'unknown'} kbps). Converting to ${targetFormat.toUpperCase()} produces a larger container but CANNOT restore high frequencies discarded by original lossy compression.`
      };
    }

    // Check if user is asking for a higher bitrate than source (e.g. 128k AAC -> 320k MP3)
    if (
      sourceStream.bitrateKbps &&
      requestedBitrateKbps &&
      requestedBitrateKbps > sourceStream.bitrateKbps + 32 &&
      !isLosslessSource
    ) {
      return {
        isStreamCopy: false,
        isLosslessTarget: false,
        isUpsampling: true,
        verdict: 'LOSSY_TO_LOSSY_DEGRADATION',
        explanation: `Source bitrate is ~${sourceStream.bitrateKbps} kbps. Re-encoding to ${requestedBitrateKbps} kbps ${targetFormat.toUpperCase()} increases file size and introduces generational compression artifacts without improving fidelity.`
      };
    }

    return {
      isStreamCopy: false,
      isLosslessTarget,
      isUpsampling: false,
      verdict: 'TRANSPARENT_ENCODE',
      explanation: `Transcoding audio from ${srcCodec} to ${targetFormat.toUpperCase()} with high-quality parameters.`
    };
  }
}
