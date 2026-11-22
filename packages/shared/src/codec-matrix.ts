/**
 * MUXARO Media Processing Platform - Codec Compatibility & Remux Matrix
 * 
 * Defines target container compatibility profiles and zero-copy stream copy validation.
 * Enables automatic lossless remuxing (-c copy) when input streams natively fit the
 * target container, saving 90%+ CPU time and preventing generation loss.
 */

import {
  CONTAINERS_VIDEO,
  CONTAINERS_AUDIO,
  type ContainerFormat,
  type VideoContainer,
  type AudioContainer,
} from './types.js';

// =============================================================================
// 1. CODEC NORMALIZATION ALIASES
// =============================================================================

const VIDEO_CODEC_ALIASES: Record<string, string> = {
  // H.264 / AVC
  h264: 'h264',
  avc: 'h264',
  avc1: 'h264',
  x264: 'h264',
  'video/avc': 'h264',

  // H.265 / HEVC
  hevc: 'hevc',
  h265: 'hevc',
  hvc1: 'hevc',
  hev1: 'hevc',
  x265: 'hevc',
  'video/hevc': 'hevc',

  // AV1
  av1: 'av1',
  av01: 'av1',
  'video/av01': 'av1',

  // VP9
  vp9: 'vp9',
  vp09: 'vp9',
  'video/vp9': 'vp9',

  // VP8
  vp8: 'vp8',
  vp08: 'vp8',
  'video/vp8': 'vp8',

  // MPEG-4 Visual / Xvid
  mpeg4: 'mpeg4',
  mp4v: 'mpeg4',
  'mp4v-es': 'mpeg4',
  xvid: 'mpeg4',
  divx: 'mpeg4',

  // MPEG-2
  mpeg2video: 'mpeg2',
  mpeg2: 'mpeg2',
  mp2v: 'mpeg2',

  // Apple ProRes
  prores: 'prores',
  apch: 'prores',
  apcn: 'prores',
  apcs: 'prores',
  apco: 'prores',
  ap4h: 'prores',

  // Avid DNxHD / DNxHR
  dnxhd: 'dnxhd',
  dnxhr: 'dnxhd',

  // Theora
  theora: 'theora',
};

const AUDIO_CODEC_ALIASES: Record<string, string> = {
  // AAC
  aac: 'aac',
  mp4a: 'aac',
  'mp4a-latm': 'aac',
  'audio/aac': 'aac',
  'audio/mp4a-latm': 'aac',

  // MP3 / MPEG Audio Layer 3
  mp3: 'mp3',
  mp3float: 'mp3',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',

  // Opus
  opus: 'opus',
  'audio/opus': 'opus',

  // FLAC
  flac: 'flac',
  'audio/flac': 'flac',

  // Vorbis
  vorbis: 'vorbis',
  'audio/vorbis': 'vorbis',

  // AC-3 / Dolby Digital
  ac3: 'ac3',
  'audio/ac3': 'ac3',

  // E-AC-3 / Dolby Digital Plus
  eac3: 'eac3',
  'ec-3': 'eac3',
  'audio/eac3': 'eac3',

  // Apple Lossless (ALAC)
  alac: 'alac',
  'audio/alac': 'alac',

  // Linear PCM / WAV
  pcm: 'pcm',
  pcm_s16le: 'pcm',
  pcm_s24le: 'pcm',
  pcm_s32le: 'pcm',
  pcm_f32le: 'pcm',
  pcm_u8: 'pcm',
  'audio/wav': 'pcm',

  // DTS
  dts: 'dts',
  'dts-hd': 'dts',
};

/**
 * Normalizes raw codec strings from ffprobe, MediaSource, or yt-dlp.
 * Strips RFC 6381 parameter strings (e.g. "avc1.640028" -> "h264", "mp4a.40.2" -> "aac").
 */
export function normalizeCodec(rawCodec: string | undefined | null): string {
  if (!rawCodec || typeof rawCodec !== 'string') return '';
  const clean = rawCodec.trim().toLowerCase().split('.')[0].replace(/[^a-z0-9_-]/g, '');
  
  if (VIDEO_CODEC_ALIASES[clean]) return VIDEO_CODEC_ALIASES[clean];
  if (AUDIO_CODEC_ALIASES[clean]) return AUDIO_CODEC_ALIASES[clean];
  
  // Direct check against prefixes
  if (clean.startsWith('avc1') || clean.startsWith('h264')) return 'h264';
  if (clean.startsWith('hvc1') || clean.startsWith('hev1') || clean.startsWith('h265')) return 'hevc';
  if (clean.startsWith('av01') || clean.startsWith('av1')) return 'av1';
  if (clean.startsWith('vp09') || clean.startsWith('vp9')) return 'vp9';
  if (clean.startsWith('vp08') || clean.startsWith('vp8')) return 'vp8';
  if (clean.startsWith('mp4a')) return 'aac';
  if (clean.startsWith('pcm_')) return 'pcm';

  return clean;
}

// =============================================================================
// 2. TARGET CONTAINER COMPATIBILITY PROFILES
// =============================================================================

export interface ContainerCompatibilityProfile {
  readonly container: ContainerFormat;
  readonly isVideoContainer: boolean;
  readonly supportedVideoCodecs: ReadonlySet<string>;
  readonly supportedAudioCodecs: ReadonlySet<string>;
  readonly defaultVideoCodec: string;
  readonly defaultAudioCodec: string;
}

export const CONTAINER_PROFILES: Record<ContainerFormat, ContainerCompatibilityProfile> = {
  // --- Video Containers ---
  mp4: {
    container: 'mp4',
    isVideoContainer: true,
    supportedVideoCodecs: new Set(['h264', 'hevc', 'av1', 'vp9', 'mpeg4']),
    supportedAudioCodecs: new Set(['aac', 'mp3', 'opus', 'ac3', 'eac3', 'flac', 'alac']),
    defaultVideoCodec: 'h264',
    defaultAudioCodec: 'aac',
  },
  mkv: {
    container: 'mkv',
    isVideoContainer: true,
    supportedVideoCodecs: new Set([
      'h264',
      'hevc',
      'av1',
      'vp9',
      'vp8',
      'mpeg4',
      'mpeg2',
      'prores',
      'theora',
      'dnxhd',
    ]),
    supportedAudioCodecs: new Set([
      'aac',
      'mp3',
      'opus',
      'flac',
      'vorbis',
      'ac3',
      'eac3',
      'dts',
      'pcm',
      'alac',
    ]),
    defaultVideoCodec: 'h264',
    defaultAudioCodec: 'aac',
  },
  webm: {
    container: 'webm',
    isVideoContainer: true,
    supportedVideoCodecs: new Set(['vp8', 'vp9', 'av1']),
    supportedAudioCodecs: new Set(['opus', 'vorbis']),
    defaultVideoCodec: 'vp9',
    defaultAudioCodec: 'opus',
  },
  mov: {
    container: 'mov',
    isVideoContainer: true,
    supportedVideoCodecs: new Set(['h264', 'hevc', 'prores', 'dnxhd', 'mpeg4']),
    supportedAudioCodecs: new Set(['aac', 'alac', 'pcm', 'mp3', 'ac3']),
    defaultVideoCodec: 'h264',
    defaultAudioCodec: 'aac',
  },

  // --- Audio Containers ---
  mp3: {
    container: 'mp3',
    isVideoContainer: false,
    supportedVideoCodecs: new Set([]),
    supportedAudioCodecs: new Set(['mp3']),
    defaultVideoCodec: '',
    defaultAudioCodec: 'mp3',
  },
  flac: {
    container: 'flac',
    isVideoContainer: false,
    supportedVideoCodecs: new Set([]),
    supportedAudioCodecs: new Set(['flac']),
    defaultVideoCodec: '',
    defaultAudioCodec: 'flac',
  },
  wav: {
    container: 'wav',
    isVideoContainer: false,
    supportedVideoCodecs: new Set([]),
    supportedAudioCodecs: new Set(['pcm']),
    defaultVideoCodec: '',
    defaultAudioCodec: 'pcm',
  },
  aac: {
    container: 'aac',
    isVideoContainer: false,
    supportedVideoCodecs: new Set([]),
    supportedAudioCodecs: new Set(['aac']),
    defaultVideoCodec: '',
    defaultAudioCodec: 'aac',
  },
  m4a: {
    container: 'm4a',
    isVideoContainer: false,
    supportedVideoCodecs: new Set([]),
    supportedAudioCodecs: new Set(['aac', 'alac']),
    defaultVideoCodec: '',
    defaultAudioCodec: 'aac',
  },
  opus: {
    container: 'opus',
    isVideoContainer: false,
    supportedVideoCodecs: new Set([]),
    supportedAudioCodecs: new Set(['opus']),
    defaultVideoCodec: '',
    defaultAudioCodec: 'opus',
  },
};

// =============================================================================
// 3. ZERO-COPY REMUX VALIDATION HELPERS
// =============================================================================

/**
 * Checks if a video codec can be directly copied (-c:v copy) into the target container.
 */
export function isZeroCopyVideoSupported(
  videoCodec: string | undefined | null,
  targetContainer: string
): boolean {
  if (!videoCodec) return false;
  const container = targetContainer.toLowerCase() as ContainerFormat;
  const profile = CONTAINER_PROFILES[container];
  if (!profile || !profile.isVideoContainer) return false;

  const norm = normalizeCodec(videoCodec);
  return profile.supportedVideoCodecs.has(norm);
}

/**
 * Checks if an audio codec can be directly copied (-c:a copy) into the target container.
 */
export function isZeroCopyAudioSupported(
  audioCodec: string | undefined | null,
  targetContainer: string
): boolean {
  if (!audioCodec) return false;
  const container = targetContainer.toLowerCase() as ContainerFormat;
  const profile = CONTAINER_PROFILES[container];
  if (!profile) return false;

  const norm = normalizeCodec(audioCodec);
  return profile.supportedAudioCodecs.has(norm);
}

/**
 * Primary helper: Determines whether a complete media conversion can be achieved
 * via zero-copy stream copy remuxing (-c copy) without re-encoding video or audio.
 *
 * @param videoCodec - Video codec of input (or empty if audio-only)
 * @param audioCodec - Audio codec of input (or empty if video-only)
 * @param targetContainer - Target format container (e.g. "mp4", "mkv", "webm", "mov")
 * @returns true if zero-copy remux is completely viable; false if re-encoding is necessary
 */
export function canZeroCopyRemux(
  videoCodec: string | undefined | null,
  audioCodec: string | undefined | null,
  targetContainer: string
): boolean {
  if (!targetContainer) return false;
  const container = targetContainer.trim().toLowerCase() as ContainerFormat;
  const profile = CONTAINER_PROFILES[container];
  if (!profile) return false;

  const hasVideo = Boolean(videoCodec && videoCodec.trim().length > 0);
  const hasAudio = Boolean(audioCodec && audioCodec.trim().length > 0);

  // If target is video container:
  if (profile.isVideoContainer) {
    if (hasVideo && !isZeroCopyVideoSupported(videoCodec, container)) {
      return false;
    }
    if (hasAudio && !isZeroCopyAudioSupported(audioCodec, container)) {
      return false;
    }
    // Must have at least one valid stream to copy
    return hasVideo || hasAudio;
  }

  // If target is audio-only container (e.g. mp3, flac, aac, opus, wav):
  if (!hasAudio) return false;
  return isZeroCopyAudioSupported(audioCodec, container);
}

/**
 * Returns supported video codecs for a container.
 */
export function getSupportedVideoCodecs(targetContainer: string): readonly string[] {
  const container = targetContainer.toLowerCase() as ContainerFormat;
  const profile = CONTAINER_PROFILES[container];
  return profile ? Array.from(profile.supportedVideoCodecs) : [];
}

/**
 * Returns supported audio codecs for a container.
 */
export function getSupportedAudioCodecs(targetContainer: string): readonly string[] {
  const container = targetContainer.toLowerCase() as ContainerFormat;
  const profile = CONTAINER_PROFILES[container];
  return profile ? Array.from(profile.supportedAudioCodecs) : [];
}

/**
 * Returns recommended fallback transcode codecs if zero-copy is impossible.
 */
export function getRecommendedTranscodeCodecs(
  targetContainer: string
): { videoCodec: string; audioCodec: string } {
  const container = targetContainer.toLowerCase() as ContainerFormat;
  const profile = CONTAINER_PROFILES[container];
  if (!profile) {
    return { videoCodec: 'libx264', audioCodec: 'aac' };
  }
  return {
    videoCodec: profile.defaultVideoCodec ? `lib${profile.defaultVideoCodec}` : '',
    audioCodec: profile.defaultAudioCodec,
  };
}
