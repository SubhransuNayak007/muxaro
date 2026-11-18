/**
 * MUXARO Media Processing Engine - FFprobe Metadata Extractor
 * Executes ffprobe to perform deep stream analysis, codec detection, and container validation.
 */

import { FFmpegExecutor } from '../process/executor.js';
import { ProcessSanitizer } from '../process/sanitizer.js';
import {
  RawFFprobeOutput,
  RawFFprobeStream,
  MediaMetadata,
  VideoStreamInfo,
  AudioStreamInfo,
  MediaContainerInfo,
  ResolutionTier
} from '../types/media.js';
import { MediaClassifier } from './classifier.js';

export class FFprobeRunner {
  private ffprobeBinary: string;

  constructor(ffprobeBinary = 'ffprobe') {
    this.ffprobeBinary = ffprobeBinary;
  }

  /**
   * Executes ffprobe against a media file or URL and produces parsed, strongly typed metadata.
   */
  public async probe(inputPath: string, timeoutMs = 30000): Promise<MediaMetadata> {
    const validatedPath = ProcessSanitizer.validatePath(inputPath);

    const args = [
      '-v', 'error',
      '-show_format',
      '-show_streams',
      '-show_error',
      '-print_format', 'json',
      validatedPath
    ];

    const result = await FFmpegExecutor.execute(this.ffprobeBinary, args, {
      timeoutMs,
      stage: 'probing'
    });

    if (result.exitCode !== 0) {
      throw new Error(`FFprobe failed with code ${result.exitCode}: ${result.stderr || result.stdout}`);
    }

    let parsed: RawFFprobeOutput;
    try {
      parsed = JSON.parse(result.stdout) as RawFFprobeOutput;
    } catch (err) {
      throw new Error(`Failed to parse FFprobe JSON output: ${(err as Error).message}. Output: ${result.stdout.slice(0, 500)}`);
    }

    if (parsed.error) {
      throw new Error(`FFprobe reported file error: ${parsed.error.string} (code ${parsed.error.code})`);
    }

    return this.normalizeMetadata(parsed);
  }

  /**
   * Normalizes raw FFprobe output into the standard Muxaro MediaMetadata structure.
   */
  public normalizeMetadata(raw: RawFFprobeOutput): MediaMetadata {
    const rawStreams = raw.streams ?? [];
    const rawFormat = raw.format ?? {};

    const errors: string[] = [];
    const warnings: string[] = [];

    // Parse format / container
    const durationSeconds = rawFormat.duration ? parseFloat(rawFormat.duration) : 0;
    const sizeBytes = rawFormat.size ? parseInt(rawFormat.size, 10) : 0;
    const overallBitrateKbps = rawFormat.bit_rate ? Math.round(parseInt(rawFormat.bit_rate, 10) / 1000) : undefined;

    const container: MediaContainerInfo = {
      formatName: rawFormat.format_name ?? 'unknown',
      formatLongName: rawFormat.format_long_name ?? 'Unknown format',
      durationSeconds: isNaN(durationSeconds) ? 0 : Math.max(0, durationSeconds),
      sizeBytes: isNaN(sizeBytes) ? 0 : Math.max(0, sizeBytes),
      overallBitrateKbps,
      tags: rawFormat.tags ?? {}
    };

    if (container.sizeBytes === 0) {
      warnings.push('Reported container size is 0 bytes or unavailable.');
    }
    if (container.durationSeconds === 0) {
      warnings.push('Reported container duration is 0 seconds or streaming.');
    }

    // Parse video streams
    const videoStreams: VideoStreamInfo[] = [];
    // Parse audio streams
    const audioStreams: AudioStreamInfo[] = [];

    for (const s of rawStreams) {
      if (s.codec_type === 'video') {
        const streamInfo = this.parseVideoStream(s, container.durationSeconds);
        if (streamInfo) videoStreams.push(streamInfo);
      } else if (s.codec_type === 'audio') {
        const streamInfo = this.parseAudioStream(s, container.durationSeconds);
        if (streamInfo) audioStreams.push(streamInfo);
      }
    }

    const hasVideo = videoStreams.length > 0;
    const hasAudio = audioStreams.length > 0;

    if (!hasVideo && !hasAudio) {
      errors.push('No video or audio streams detected in media container.');
    }

    const primaryVideoStream = videoStreams[0];
    const primaryAudioStream = audioStreams[0];

    const trueResolutionTier: ResolutionTier = primaryVideoStream
      ? primaryVideoStream.resolutionTier
      : 'UNKNOWN';

    const isHdr = videoStreams.some((v) => v.isHdr);

    return {
      container,
      hasVideo,
      hasAudio,
      videoStreams,
      audioStreams,
      primaryVideoStream,
      primaryAudioStream,
      trueResolutionTier,
      isHdr,
      integrity: {
        valid: errors.length === 0,
        errors,
        warnings
      }
    };
  }

  private parseVideoStream(s: RawFFprobeStream, defaultDuration: number): VideoStreamInfo | null {
    const width = s.width ?? 0;
    const height = s.height ?? 0;
    if (width <= 0 || height <= 0) return null;

    const codec = (s.codec_name ?? 'unknown').toLowerCase();
    const codecLongName = s.codec_long_name ?? codec;
    const resolutionTier = MediaClassifier.classifyResolution(width, height);

    // Frame rate parsing
    let fps = 0;
    if (s.r_frame_rate && s.r_frame_rate.includes('/')) {
      const [num, den] = s.r_frame_rate.split('/').map(Number);
      if (den > 0) fps = Math.round((num / den) * 100) / 100;
    } else if (s.avg_frame_rate && s.avg_frame_rate.includes('/')) {
      const [num, den] = s.avg_frame_rate.split('/').map(Number);
      if (den > 0) fps = Math.round((num / den) * 100) / 100;
    }

    const streamDuration = s.duration ? parseFloat(s.duration) : defaultDuration;
    const streamBitrate = s.bit_rate ? Math.round(parseInt(s.bit_rate, 10) / 1000) : undefined;
    const framesCount = s.nb_frames ? parseInt(s.nb_frames, 10) : undefined;

    // Aspect ratio calculation
    const aspect = s.display_aspect_ratio || `${width}:${height}`;

    // HDR Detection
    const colorTransfer = s.color_transfer?.toLowerCase();
    const colorPrimaries = s.color_primaries?.toLowerCase();
    const isHdr =
      colorTransfer === 'smpte2084' || // HDR10 / PQ
      colorTransfer === 'arib-std-b67' || // HLG
      colorPrimaries === 'bt2020';

    return {
      index: s.index,
      codec,
      codecLongName,
      profile: s.profile,
      width,
      height,
      resolutionTier,
      aspectRatio: aspect,
      frameRate: s.r_frame_rate ?? `${fps} fps`,
      fps,
      bitrateKbps: streamBitrate,
      pixelFormat: s.pix_fmt,
      colorSpace: s.color_space,
      colorPrimaries: s.color_primaries,
      colorTransfer: s.color_transfer,
      isHdr,
      durationSeconds: isNaN(streamDuration) ? defaultDuration : streamDuration,
      framesCount: isNaN(framesCount as number) ? undefined : framesCount
    };
  }

  private parseAudioStream(s: RawFFprobeStream, defaultDuration: number): AudioStreamInfo {
    const codec = (s.codec_name ?? 'unknown').toLowerCase();
    const codecLongName = s.codec_long_name ?? codec;
    const channels = s.channels ?? 2;
    const channelLayout = s.channel_layout ?? (channels === 1 ? 'mono' : 'stereo');
    const sampleRate = s.sample_rate ? parseInt(s.sample_rate, 10) : 44100;
    const streamDuration = s.duration ? parseFloat(s.duration) : defaultDuration;
    const streamBitrate = s.bit_rate ? Math.round(parseInt(s.bit_rate, 10) / 1000) : undefined;

    const isLossless = [
      'flac',
      'alac',
      'pcm_s16le',
      'pcm_s24le',
      'pcm_s32le',
      'pcm_f32le',
      'wav',
      'truehd'
    ].includes(codec);

    return {
      index: s.index,
      codec,
      codecLongName,
      profile: s.profile,
      channels,
      channelLayout,
      sampleRate,
      sampleFormat: s.sample_fmt,
      bitrateKbps: streamBitrate,
      durationSeconds: isNaN(streamDuration) ? defaultDuration : streamDuration,
      isLossless
    };
  }
}
