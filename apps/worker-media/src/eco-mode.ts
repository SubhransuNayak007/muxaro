/**
 * MUXARO Media Processing Platform - Eco Mode Enforcement Engine
 * 
 * Enforces energy-efficient media transformations:
 * 1. Lossless zero-copy stream copy (-c copy) whenever codecs natively fit target container
 * 2. 1080p scale cap with strict downscale-only enforcement and even pixel dimensions
 * 3. Fast encoder presets (veryfast for x264/x265) to minimize server CPU time
 * 4. High-efficiency VP9/CRF tuning (-crf 32 -b:v 0 -cpu-used 4 -row-mt 1)
 * 5. Deterministic Wh compute & CO2 emission savings calculation
 */

import {
  canZeroCopyRemux,
  isZeroCopyVideoSupported,
  isZeroCopyAudioSupported,
  CONTAINERS_VIDEO,
  CONTAINERS_AUDIO,
  type ContainerFormat,
  type VideoContainer,
  type AudioContainer,
  type AudioBitrate,
} from '@muxaro/shared';
import type { MediaJobPayload } from './types.js';

// =============================================================================
// 1. DATA MODELS & INTERFACES
// =============================================================================

export interface ProbedMediaMetadata {
  readonly formatName?: string;
  readonly durationSeconds: number;
  readonly sizeBytes?: number;
  readonly bitrate?: number;
  readonly video?: {
    readonly codec: string;
    readonly width: number;
    readonly height: number;
    readonly fps?: number;
    readonly bitrate?: number;
    readonly pixelFormat?: string;
  };
  readonly audio?: {
    readonly codec: string;
    readonly channels?: number;
    readonly sampleRate?: number;
    readonly bitrate?: number;
  };
}

export type EcoActionType =
  | 'STREAM_COPY_REMUX'
  | 'AUDIO_EXTRACT_DIRECT'
  | 'AUDIO_EXTRACT_OPTIMIZED'
  | 'OPTIMIZED_TRANSCODE';

export interface EcoEnforcementPlan {
  readonly isStreamCopy: boolean;
  readonly action: EcoActionType;
  readonly ffmpegVideoArgs: readonly string[];
  readonly ffmpegAudioArgs: readonly string[];
  readonly ffmpegFilterArgs: readonly string[];
  readonly ffmpegFormatArgs: readonly string[];
  readonly scaleCapApplied: boolean;
  readonly targetResolution?: string;
  readonly targetWidth?: number;
  readonly targetHeight?: number;
  readonly presetUsed?: string;
  readonly reason: string;
}

export interface EcoSavingsEstimate {
  readonly computeSavedWh: number;
  readonly co2SavedGrams: number;
  readonly cpuReductionPercent: number;
  readonly generationLossPrevented: boolean;
  readonly summary: string;
}

// =============================================================================
// 2. CONSTANTS & MODEL COEFFICIENTS
// =============================================================================

/** Average carbon intensity of electricity grid: ~385 grams CO2 per kWh (0.385 g/Wh) */
const GLOBAL_GRID_CARBON_INTENSITY_G_PER_WH = 0.385;

/** Estimated power consumption of CPU executing full multithreaded transcode (Watts) */
const CPU_TRANSCODE_POWER_WATTS = 110.0;

/** Estimated power consumption of server performing lightweight stream copy / I/O (Watts) */
const CPU_STREAM_COPY_POWER_WATTS = 4.0;

/** Estimated power consumption of server performing optimized fast transcode (Watts) */
const CPU_OPTIMIZED_TRANSCODE_POWER_WATTS = 48.0;

// =============================================================================
// 3. ECO MODE ENFORCEMENT ENGINE
// =============================================================================

export class EcoModeEngine {
  /**
   * Evaluates input media metadata and user options to construct an optimized,
   * low-carbon execution plan.
   */
  public static planExecution(
    options: MediaJobPayload,
    probe: ProbedMediaMetadata
  ): EcoEnforcementPlan {
    const isEcoRequested = options.ecoMode !== false; // Default is true
    const targetFormat = options.targetFormat.toLowerCase() as ContainerFormat;
    const isVideoTarget = (CONTAINERS_VIDEO as readonly string[]).includes(targetFormat);
    const isAudioTarget = (CONTAINERS_AUDIO as readonly string[]).includes(targetFormat);

    const videoCodec = probe.video?.codec;
    const audioCodec = probe.audio?.codec;

    // -------------------------------------------------------------------------
    // CASE A: AUDIO EXTRACTION TOOL
    // -------------------------------------------------------------------------
    if (options.tool === 'extract_audio' || isAudioTarget) {
      // Check if native audio stream can be extracted directly without re-encoding
      const canDirectCopyAudio = isZeroCopyAudioSupported(audioCodec, targetFormat);

      if (canDirectCopyAudio && isEcoRequested) {
        return {
          isStreamCopy: true,
          action: 'AUDIO_EXTRACT_DIRECT',
          ffmpegVideoArgs: ['-vn'],
          ffmpegAudioArgs: ['-c:a', 'copy'],
          ffmpegFilterArgs: [],
          ffmpegFormatArgs: EcoModeEngine.getFormatFlag(targetFormat),
          scaleCapApplied: false,
          reason: `Lossless direct audio stream copy (${audioCodec} -> ${targetFormat}). Zero generational loss.`,
        };
      }

      // Fallback: Optimized Audio Transcode
      const audioBitrate = options.audioBitrate || '192k';
      const audioArgs = EcoModeEngine.getOptimizedAudioArgs(targetFormat, audioBitrate, isEcoRequested);

      return {
        isStreamCopy: false,
        action: 'AUDIO_EXTRACT_OPTIMIZED',
        ffmpegVideoArgs: ['-vn'],
        ffmpegAudioArgs: audioArgs,
        ffmpegFilterArgs: options.normalizeAudio ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11'] : [],
        ffmpegFormatArgs: EcoModeEngine.getFormatFlag(targetFormat),
        scaleCapApplied: false,
        reason: `Optimized audio encode to ${targetFormat} (${audioBitrate}).`,
      };
    }

    // -------------------------------------------------------------------------
    // CASE B: VIDEO TARGET (convert_video or merge_av)
    // -------------------------------------------------------------------------
    if (isVideoTarget) {
      const userRequestedResolution = options.targetResolution;
      const is4K8K = Boolean(
        (probe.video && (probe.video.height >= 2160 || probe.video.width >= 3840)) ||
        (userRequestedResolution && /^(?:4k|8k|2160p?|4320p?)/i.test(userRequestedResolution))
      );

      // 8K / 4K LOSSLESS REMUXING RULE: NEVER re-encode 4K/8K video (-c:v copy)
      if (is4K8K) {
        if (targetFormat === 'mkv' || targetFormat === 'webm') {
          return {
            isStreamCopy: true,
            action: 'STREAM_COPY_REMUX',
            ffmpegVideoArgs: ['-c:v', 'copy'],
            ffmpegAudioArgs: ['-c:a', 'copy'],
            ffmpegFilterArgs: [],
            ffmpegFormatArgs: EcoModeEngine.getFormatFlag(targetFormat),
            scaleCapApplied: false,
            targetResolution: probe.video?.height ? `${probe.video.height}p` : userRequestedResolution,
            reason: `8K Lossless Remuxing Rule: MKV/WebM -c copy. Never re-encode 4K/8K video.`,
          };
        } else {
          // MP4 at 4K/8K: -c:v copy -c:a aac -b:a 192k -movflags +faststart
          return {
            isStreamCopy: true,
            action: 'STREAM_COPY_REMUX',
            ffmpegVideoArgs: ['-c:v', 'copy'],
            ffmpegAudioArgs: ['-c:a', 'aac', '-b:a', '192k'],
            ffmpegFilterArgs: [],
            ffmpegFormatArgs: ['-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof+faststart'],
            scaleCapApplied: false,
            targetResolution: probe.video?.height ? `${probe.video.height}p` : userRequestedResolution,
            reason: `8K Lossless Remuxing Rule: MP4 at 4K/8K -c:v copy -c:a aac -b:a 192k -movflags +faststart.`,
          };
        }
      }

      // Check if zero-copy remux is possible
      const canZeroCopy = canZeroCopyRemux(videoCodec, audioCodec, targetFormat);
      const exceedsEcoCap = Boolean(
        isEcoRequested &&
        probe.video &&
        (probe.video.height > 1080 || probe.video.width > 1920)
      );
      const requiresResolutionChange = Boolean(
        exceedsEcoCap || (
          userRequestedResolution &&
          probe.video &&
          !EcoModeEngine.resolutionMatches(userRequestedResolution, probe.video.height)
        )
      );

      // If zero-copy is possible, no scaling requested, and doesn't exceed eco cap, FORCE STREAM COPY
      if (canZeroCopy && !requiresResolutionChange && isEcoRequested) {
        return {
          isStreamCopy: true,
          action: 'STREAM_COPY_REMUX',
          ffmpegVideoArgs: ['-c:v', 'copy'],
          ffmpegAudioArgs: ['-c:a', 'copy'],
          ffmpegFilterArgs: [],
          ffmpegFormatArgs: EcoModeEngine.getFormatFlag(targetFormat),
          scaleCapApplied: false,
          reason: `Zero-copy remux (-c copy). Input codecs (${videoCodec}/${audioCodec}) natively supported by ${targetFormat}.`,
        };
      }

      // Transcoding is necessary — apply Eco Mode optimizations
      const { filterArgs, scaleCapApplied, targetWidth, targetHeight, targetResolution } =
        EcoModeEngine.calculateScaleFilter(probe.video, userRequestedResolution, isEcoRequested);

      const { videoArgs, presetUsed } = EcoModeEngine.getOptimizedVideoArgs(targetFormat, isEcoRequested);
      const audioArgs = EcoModeEngine.getOptimizedAudioForVideo(audioCodec, targetFormat, options.audioBitrate, isEcoRequested);

      return {
        isStreamCopy: false,
        action: 'OPTIMIZED_TRANSCODE',
        ffmpegVideoArgs: videoArgs,
        ffmpegAudioArgs: audioArgs,
        ffmpegFilterArgs: filterArgs,
        ffmpegFormatArgs: EcoModeEngine.getFormatFlag(targetFormat),
        scaleCapApplied,
        targetResolution,
        targetWidth,
        targetHeight,
        presetUsed,
        reason: scaleCapApplied
          ? `Eco Mode: 1080p scale cap applied with ${presetUsed} preset to minimize server compute.`
          : `Optimized transcode for ${targetFormat} with ${presetUsed} preset.`,
      };
    }

    // Default fallback
    return {
      isStreamCopy: false,
      action: 'OPTIMIZED_TRANSCODE',
      ffmpegVideoArgs: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22'],
      ffmpegAudioArgs: ['-c:a', 'aac', '-b:a', '192k'],
      ffmpegFilterArgs: [],
      ffmpegFormatArgs: EcoModeEngine.getFormatFlag(targetFormat),
      scaleCapApplied: false,
      reason: 'Standard fallback transcoding configuration.',
    };
  }

  // ===========================================================================
  // 4. COMPUTE & CO2 SAVINGS ESTIMATOR
  // ===========================================================================

  /**
   * Calculates deterministic energy (Wh) and carbon emission (grams CO2) savings
   * achieved by Eco Mode compared to standard unoptimized transcoding.
   */
  public static estimateSavings(
    plan: EcoEnforcementPlan,
    durationSeconds: number
  ): EcoSavingsEstimate {
    const validDuration = Math.max(1, durationSeconds);
    const durationHours = validDuration / 3600;

    // Baseline: Unoptimized transcode running at ~1.2x realtime using heavy CPU
    const baselineExecutionHours = durationHours * 1.2;
    const baselineWh = baselineExecutionHours * CPU_TRANSCODE_POWER_WATTS;

    let actualWh = 0;
    let cpuReductionPercent = 0;
    let generationLossPrevented = false;

    if (plan.isStreamCopy) {
      // Stream copy completes in seconds regardless of media length (~3s typical)
      const streamCopyHours = Math.min(validDuration, 4) / 3600;
      actualWh = streamCopyHours * CPU_STREAM_COPY_POWER_WATTS;
      cpuReductionPercent = 96.5;
      generationLossPrevented = true;
    } else {
      // Optimized transcode: runs at ~3.0x realtime using 'veryfast' preset and 1080p cap
      const optimizedExecutionHours = durationHours * 0.35;
      actualWh = optimizedExecutionHours * CPU_OPTIMIZED_TRANSCODE_POWER_WATTS;
      cpuReductionPercent = Math.round(
        (1 - actualWh / Math.max(0.01, baselineWh)) * 100
      );
    }

    const computeSavedWh = Math.max(0, Math.round((baselineWh - actualWh) * 100) / 100);
    const co2SavedGrams = Math.max(
      0,
      Math.round(computeSavedWh * GLOBAL_GRID_CARBON_INTENSITY_G_PER_WH * 100) / 100
    );

    const summary = plan.isStreamCopy
      ? `Saved ~${computeSavedWh} Wh (${co2SavedGrams}g CO2) via zero-copy remuxing (-c copy). Zero quality loss.`
      : `Saved ~${computeSavedWh} Wh (${co2SavedGrams}g CO2) via 1080p cap and veryfast preset (${cpuReductionPercent}% CPU reduction).`;

    return {
      computeSavedWh,
      co2SavedGrams,
      cpuReductionPercent,
      generationLossPrevented,
      summary,
    };
  }

  // ===========================================================================
  // 5. INTERNAL REUSABLE HELPERS
  // ===========================================================================

  private static getFormatFlag(container: ContainerFormat): string[] {
    switch (container) {
      case 'mp4':
        return ['-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof'];
      case 'mov':
        return ['-f', 'mov', '-movflags', 'frag_keyframe+empty_moov+default_base_moof'];
      case 'mkv':
        return ['-f', 'matroska'];
      case 'webm':
        return ['-f', 'webm'];
      case 'mp3':
        return ['-f', 'mp3'];
      case 'flac':
        return ['-f', 'flac'];
      case 'wav':
        return ['-f', 'wav'];
      case 'aac':
        return ['-f', 'adts'];
      case 'm4a':
        return ['-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof'];
      case 'opus':
        return ['-f', 'opus'];
      default:
        return ['-f', container];
    }
  }

  private static calculateScaleFilter(
    video: ProbedMediaMetadata['video'],
    requestedRes?: string,
    isEco: boolean = true
  ): {
    filterArgs: string[];
    scaleCapApplied: boolean;
    targetWidth?: number;
    targetHeight?: number;
    targetResolution?: string;
  } {
    if (!video) {
      return { filterArgs: [], scaleCapApplied: false };
    }

    const srcW = video.width;
    const srcH = video.height;

    // Determine target maximum height
    let maxH = 1080;
    if (requestedRes) {
      const match = requestedRes.match(/(\d+)p?/);
      if (match) {
        maxH = Number.parseInt(match[1], 10);
      }
    }

    // STRICT DOWNSCALE-ONLY RULE: Target height must NEVER exceed source height
    const effectiveTargetH = Math.min(srcH, isEco ? Math.min(maxH, 1080) : maxH);
    const scaleCapApplied = isEco && (srcH > 1080 || srcW > 1920);

    if (effectiveTargetH < srcH || scaleCapApplied) {
      // Scale maintaining aspect ratio and ensuring both width & height are divisible by 2
      const filter = `scale='min(1920,iw)':min'(${effectiveTargetH},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`;
      return {
        filterArgs: ['-vf', filter],
        scaleCapApplied,
        targetHeight: effectiveTargetH,
        targetResolution: `${effectiveTargetH}p`,
      };
    }

    return { filterArgs: [], scaleCapApplied: false, targetHeight: srcH, targetWidth: srcW };
  }

  private static getOptimizedVideoArgs(
    targetContainer: ContainerFormat,
    isEco: boolean
  ): { videoArgs: string[]; presetUsed: string } {
    if (targetContainer === 'webm') {
      // VP9 tuning for fast multi-threaded encoding
      return {
        videoArgs: [
          '-c:v', 'libvpx-vp9',
          '-crf', '32',
          '-b:v', '0',
          '-cpu-used', isEco ? '4' : '2',
          '-row-mt', '1',
        ],
        presetUsed: isEco ? 'cpu-used 4' : 'cpu-used 2',
      };
    }

    // Default: H.264 / MP4 / MKV
    const preset = isEco ? 'veryfast' : 'medium';
    return {
      videoArgs: [
        '-c:v', 'libx264',
        '-preset', preset,
        '-crf', '22',
        '-pix_fmt', 'yuv420p',
      ],
      presetUsed: preset,
    };
  }

  private static getOptimizedAudioForVideo(
    sourceAudioCodec: string | undefined,
    targetContainer: ContainerFormat,
    userBitrate?: AudioBitrate,
    isEco: boolean = true
  ): string[] {
    // If audio is already compatible, copy directly
    if (isZeroCopyAudioSupported(sourceAudioCodec, targetContainer) && isEco) {
      return ['-c:a', 'copy'];
    }

    if (targetContainer === 'webm') {
      return ['-c:a', 'libopus', '-b:a', '128k'];
    }

    const bitrate = isEco ? '192k' : (userBitrate || '256k');
    return ['-c:a', 'aac', '-b:a', bitrate];
  }

  private static getOptimizedAudioArgs(
    targetFormat: ContainerFormat,
    bitrate: AudioBitrate,
    isEco: boolean
  ): string[] {
    switch (targetFormat) {
      case 'mp3':
        return ['-c:a', 'libmp3lame', '-b:a', isEco && bitrate === '320k' ? '256k' : bitrate];
      case 'flac':
        return ['-c:a', 'flac', '-compression_level', '5'];
      case 'wav':
        return ['-c:a', 'pcm_s16le'];
      case 'aac':
      case 'm4a':
        return ['-c:a', 'aac', '-b:a', bitrate];
      case 'opus':
        return ['-c:a', 'libopus', '-b:a', bitrate === '320k' ? '192k' : bitrate];
      default:
        return ['-c:a', 'libmp3lame', '-b:a', bitrate];
    }
  }

  private static resolutionMatches(requested: string, currentH: number): boolean {
    const num = Number.parseInt(requested.replace(/[^\d]/g, ''), 10);
    return !Number.isNaN(num) && Math.abs(num - currentH) <= 16;
  }
}
