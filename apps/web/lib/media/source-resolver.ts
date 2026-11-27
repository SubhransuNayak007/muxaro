export type ClassifiedSourceKind =
  | 'direct_media'
  | 'youtube'
  | 'platform_video'
  | 'cloud_storage'
  | 'webpage'
  | 'invalid_or_restricted';

export interface ClassifiedMediaSource {
  normalizedUrl: string;
  kind: ClassifiedSourceKind;
  platformLabel: string;
  host: string;
  directDownloadableOnClient: boolean;
  requiresNativeOrWorker: boolean;
  blockedReason?: string;
  alternatives: Array<{
    id: 'upload' | 'drive' | 'open_source' | 'worker_settings';
    label: string;
  }>;
}

const PRIVATE_HOST_RE = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|::1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+)$/i;

const DIRECT_MEDIA_EXT_RE = /\.(mp4|m4v|webm|mkv|mov|avi|flv|mp3|wav|flac|m4a|aac|ogg|opus)(\?.*)?$/i;

const DIRECT_MEDIA_CDN_HOSTS = [
  'v.pinimg.com',
  'video.twimg.com',
  'v.redd.it',
  'akamaized.net',
  'vimeocdn.com',
  'googlevideo.com',
  'tiktokcdn.com',
  'fbcdn.net',
  'cdninstagram.com',
];

const PLATFORM_VIDEO_HOSTS: Array<[string, string]> = [
  ['youtube.com', 'YouTube'],
  ['youtu.be', 'YouTube'],
  ['tiktok.com', 'TikTok'],
  ['instagram.com', 'Instagram'],
  ['facebook.com', 'Facebook'],
  ['fb.watch', 'Facebook'],
  ['x.com', 'X / Twitter'],
  ['twitter.com', 'X / Twitter'],
  ['vimeo.com', 'Vimeo'],
  ['reddit.com', 'Reddit'],
  ['pinterest.com', 'Pinterest'],
  ['pin.it', 'Pinterest'],
  ['twitch.tv', 'Twitch'],
];

function matchesHost(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Classifies any pasted URL deterministically before invoking probes or downloaders.
 * Prevents misleading empty-manifest errors and blocks SSRF/local/unsupported schemes cleanly.
 */
export function classifyMediaSourceUrl(rawUrl: string): ClassifiedMediaSource {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    return {
      normalizedUrl: '',
      kind: 'invalid_or_restricted',
      platformLabel: 'Empty URL',
      host: '',
      directDownloadableOnClient: false,
      requiresNativeOrWorker: false,
      blockedReason: 'Enter a valid http:// or https:// URL.',
      alternatives: [{ id: 'upload', label: 'Choose a local file' }],
    };
  }

  if (/^(javascript|data|file|vbscript|blob|ftp):/i.test(trimmed)) {
    return {
      normalizedUrl: trimmed,
      kind: 'invalid_or_restricted',
      platformLabel: 'Restricted scheme',
      host: '',
      directDownloadableOnClient: false,
      requiresNativeOrWorker: false,
      blockedReason: 'Only public https:// or http:// links are permitted.',
      alternatives: [{ id: 'upload', label: 'Choose a local file' }],
    };
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      normalizedUrl: trimmed,
      kind: 'invalid_or_restricted',
      platformLabel: 'Malformed URL',
      host: '',
      directDownloadableOnClient: false,
      requiresNativeOrWorker: false,
      blockedReason: 'This text is not a valid web link.',
      alternatives: [{ id: 'upload', label: 'Choose a local file' }],
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (!host || PRIVATE_HOST_RE.test(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    return {
      normalizedUrl: parsed.toString(),
      kind: 'invalid_or_restricted',
      platformLabel: 'Private network link',
      host,
      directDownloadableOnClient: false,
      requiresNativeOrWorker: false,
      blockedReason: 'Links pointing to localhost or private internal network addresses are blocked for security.',
      alternatives: [{ id: 'upload', label: 'Choose a local file' }],
    };
  }

  if (
    matchesHost(host, 'drive.google.com') ||
    matchesHost(host, 'docs.google.com') ||
    matchesHost(host, 'dropbox.com')
  ) {
    return {
      normalizedUrl: parsed.toString(),
      kind: 'cloud_storage',
      platformLabel: matchesHost(host, 'dropbox.com') ? 'Dropbox' : 'Google Drive',
      host,
      directDownloadableOnClient: true,
      requiresNativeOrWorker: false,
      alternatives: [
        { id: 'drive', label: 'Import via Drive Importer' },
        { id: 'upload', label: 'Choose a local file' },
      ],
    };
  }

  if (DIRECT_MEDIA_EXT_RE.test(parsed.pathname) || DIRECT_MEDIA_CDN_HOSTS.some((d) => matchesHost(host, d))) {
    return {
      normalizedUrl: parsed.toString(),
      kind: 'direct_media',
      platformLabel: 'Direct Media File',
      host,
      directDownloadableOnClient: true,
      requiresNativeOrWorker: false,
      alternatives: [{ id: 'upload', label: 'Choose a local file' }],
    };
  }

  if (matchesHost(host, 'youtube.com') || matchesHost(host, 'youtu.be')) {
    return {
      normalizedUrl: parsed.toString(),
      kind: 'youtube',
      platformLabel: 'YouTube',
      host,
      directDownloadableOnClient: false,
      requiresNativeOrWorker: true,
      blockedReason:
        'YouTube stream URLs cannot be resolved solely inside an offline browser/mobile WebView because video/audio streams require Desktop local extractor or a configured extraction worker.',
      alternatives: [
        { id: 'upload', label: 'Upload video/audio file' },
        { id: 'drive', label: 'Import from Google Drive' },
        { id: 'open_source', label: 'Open link in browser' },
      ],
    };
  }

  const plat = PLATFORM_VIDEO_HOSTS.find(([d]) => matchesHost(host, d));
  if (plat) {
    return {
      normalizedUrl: parsed.toString(),
      kind: 'platform_video',
      platformLabel: plat[1],
      host,
      directDownloadableOnClient: false,
      requiresNativeOrWorker: true,
      blockedReason: `${plat[1]} links require Desktop Studio's local media resolver or a configured server worker because standalone mobile/browser runtimes cannot bypass CORS or platform stream signing.`,
      alternatives: [
        { id: 'upload', label: 'Upload saved video file' },
        { id: 'open_source', label: `Open ${plat[1]} page` },
      ],
    };
  }

  return {
    normalizedUrl: parsed.toString(),
    kind: 'webpage',
    platformLabel: 'Webpage',
    host,
    directDownloadableOnClient: false,
    requiresNativeOrWorker: true,
    blockedReason:
      'This appears to be a webpage rather than a direct .mp4/.mp3 media stream. Paste a direct media file link or upload a local video/audio file.',
    alternatives: [
      { id: 'upload', label: 'Upload local media file' },
      { id: 'open_source', label: 'Open webpage' },
    ],
  };
}

export type ConversionExecutionMethod = 'remux' | 'transcode' | 'unsupported';

export interface ConversionPlan {
  method: ConversionExecutionMethod;
  feasibleRemux: boolean;
  losslessGuarantee: boolean;
  badgeLabel: string;
  headline: string;
  explanation: string;
  warning?: string;
}

const CONTAINER_VIDEO_COMPAT: Record<string, string[]> = {
  mp4: ['h264', 'avc', 'hevc', 'h265', 'av1', 'vp9', 'mpeg4'],
  m4v: ['h264', 'avc', 'hevc', 'h265', 'mpeg4'],
  mkv: ['h264', 'avc', 'hevc', 'h265', 'vp8', 'vp9', 'av1', 'mpeg4', 'mpeg2video'],
  mov: ['h264', 'avc', 'hevc', 'h265', 'prores', 'mpeg4'],
  webm: ['vp8', 'vp9', 'av1'],
  avi: ['h264', 'mpeg4', 'msmpeg4', 'mjpeg'],
};

const CONTAINER_AUDIO_COMPAT: Record<string, string[]> = {
  mp4: ['aac', 'mp3', 'opus', 'flac', 'ac3', 'eac3', 'alac'],
  m4v: ['aac', 'ac3', 'alac'],
  mkv: ['aac', 'opus', 'vorbis', 'mp3', 'flac', 'ac3', 'eac3', 'dts', 'pcm_s16le'],
  mov: ['aac', 'alac', 'pcm_s16le', 'mp3'],
  webm: ['opus', 'vorbis'],
  avi: ['mp3', 'ac3', 'pcm_s16le'],
};

export function inferSourceCodecsFromFile(fileName: string, mime = ''): {
  sourceExt: string;
  videoCodec: string;
  audioCodec: string;
  known: boolean;
} {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (ext === 'mp4' || ext === 'm4v' || mime.includes('mp4')) {
    return { sourceExt: ext || 'mp4', videoCodec: 'h264', audioCodec: 'aac', known: false };
  }
  if (ext === 'webm' || mime.includes('webm')) {
    return { sourceExt: 'webm', videoCodec: 'vp9', audioCodec: 'opus', known: true };
  }
  if (ext === 'mkv' || ext === 'mov' || ext === 'ts') {
    return { sourceExt: ext, videoCodec: 'h264', audioCodec: 'aac', known: false };
  }
  if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus'].includes(ext)) {
    return { sourceExt: ext, videoCodec: 'none', audioCodec: ext === 'm4a' ? 'aac' : ext, known: true };
  }
  return { sourceExt: ext, videoCodec: 'unknown', audioCodec: 'unknown', known: false };
}

/**
 * Evaluates actual container + codec compatibility without claiming impossible "12x" speed or unconditional lossless claims.
 */
export function planMediaConversion(params: {
  sourceFileName?: string;
  sourceMime?: string;
  sourceExt?: string;
  targetContainer: string;
  targetType: 'video' | 'audio';
  requestedVideoCodec?: string;
  requestedAudioCodec?: string;
  probedVideoCodec?: string;
  probedAudioCodec?: string;
}): ConversionPlan {
  const target = params.targetContainer.toLowerCase();
  const inferred = params.sourceFileName
    ? inferSourceCodecsFromFile(params.sourceFileName, params.sourceMime)
    : { sourceExt: params.sourceExt || '', videoCodec: 'unknown', audioCodec: 'unknown', known: false };

  const vCodec = (params.probedVideoCodec || inferred.videoCodec).toLowerCase();
  const aCodec = (params.probedAudioCodec || inferred.audioCodec).toLowerCase();
  const isAudioSource = vCodec === 'none' || ['mp3', 'wav', 'flac', 'aac', 'ogg', 'opus', 'm4a'].includes(inferred.sourceExt);

  if (params.targetType === 'video' && isAudioSource) {
    return {
      method: 'unsupported',
      feasibleRemux: false,
      losslessGuarantee: false,
      badgeLabel: 'Incompatible Input',
      headline: 'Audio-only source cannot stream-copy to video',
      explanation: `Source file "${params.sourceFileName || 'input'}" has no video track to package into .${target.toUpperCase()}. Select an audio output format or supply a video file.`,
      warning: 'Missing video track.',
    };
  }

  if (params.targetType === 'audio') {
    const canCopyAudio = aCodec !== 'unknown' && (CONTAINER_AUDIO_COMPAT[target]?.includes(aCodec) ?? false) && aCodec === target;
    if (canCopyAudio && params.requestedAudioCodec === 'copy') {
      return {
        method: 'remux',
        feasibleRemux: true,
        losslessGuarantee: true,
        badgeLabel: 'Remux (No Re-encode)',
        headline: 'Container Repack Only',
        explanation: `Audio stream (${aCodec.toUpperCase()}) fits cleanly inside .${target.toUpperCase()} without re-encoding.`,
      };
    }
    return {
      method: 'transcode',
      feasibleRemux: false,
      losslessGuarantee: target === 'flac' || target === 'wav',
      badgeLabel: 'Transcode Required',
      headline: 'Audio Re-encoding',
      explanation: `Audio will be encoded to ${target.toUpperCase()}. Re-encoding from lossy formats (MP3/AAC) cannot recover discarded frequencies.`,
    };
  }

  const wantsCopy = !params.requestedVideoCodec || params.requestedVideoCodec === 'copy';
  const vCompat = vCodec !== 'unknown' && (CONTAINER_VIDEO_COMPAT[target]?.includes(vCodec) ?? false);
  const aCompat = aCodec === 'unknown' || aCodec === 'none' || (CONTAINER_AUDIO_COMPAT[target]?.includes(aCodec) ?? false);

  if (target === 'gif') {
    return {
      method: 'transcode',
      feasibleRemux: false,
      losslessGuarantee: false,
      badgeLabel: 'Frame Conversion',
      headline: 'GIF Animation Encoding',
      explanation: 'GIF requires full frame decoding and 256-color palette quantization (audio tracks are dropped).',
    };
  }

  if (wantsCopy && vCompat && aCompat) {
    return {
      method: 'remux',
      feasibleRemux: true,
      losslessGuarantee: true,
      badgeLabel: 'Remux Eligible (Stream Copy)',
      headline: 'Container Repack Without Re-encoding',
      explanation: inferred.known
        ? `Compatible ${vCodec.toUpperCase()}/${aCodec.toUpperCase()} tracks can be remuxed into .${target.toUpperCase()} without re-encoding video frames.`
        : `Streams from .${(inferred.sourceExt || 'input').toUpperCase()} will attempt remuxing into .${target.toUpperCase()} if actual track codecs are supported by the container; FFmpeg falls back to transcoding if any track is incompatible.`,
    };
  }

  return {
    method: 'transcode',
    feasibleRemux: false,
    losslessGuarantee: false,
    badgeLabel: 'Transcode Required',
    headline: 'Re-encoding Required',
    explanation: `Converting ${inferred.sourceExt ? `.${inferred.sourceExt.toUpperCase()} ` : ''}streams to .${target.toUpperCase()} requires re-encoding incompatible video or audio codecs. Speed depends on hardware encoder and resolution.`,
    warning: !vCompat && vCodec !== 'unknown' ? `${vCodec.toUpperCase()} video stream is not compatible with .${target.toUpperCase()} container copy.` : undefined,
  };
}
