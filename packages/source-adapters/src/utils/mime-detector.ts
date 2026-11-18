/**
 * Project MUXARO - MIME & Container Detection Utilities
 * 
 * Maps extensions, Content-Type headers, and Content-Disposition headers
 * to standardized ContainerFormats, StreamTypes, and media codecs.
 */

import type { ContainerFormat, StreamType } from '../types.ts';

export interface MimeClassification {
  container: ContainerFormat;
  streamType: StreamType;
  canonicalMime: string;
  defaultVideoCodec?: string;
  defaultAudioCodec?: string;
  isAudioOnly: boolean;
  isVideo: boolean;
}

const EXTENSION_MAP: Record<string, MimeClassification> = {
  // Video containers
  mp4: {
    container: 'mp4',
    streamType: 'muxed',
    canonicalMime: 'video/mp4',
    defaultVideoCodec: 'h264',
    defaultAudioCodec: 'aac',
    isAudioOnly: false,
    isVideo: true,
  },
  m4v: {
    container: 'mp4',
    streamType: 'muxed',
    canonicalMime: 'video/mp4',
    defaultVideoCodec: 'h264',
    defaultAudioCodec: 'aac',
    isAudioOnly: false,
    isVideo: true,
  },
  webm: {
    container: 'webm',
    streamType: 'muxed',
    canonicalMime: 'video/webm',
    defaultVideoCodec: 'vp9',
    defaultAudioCodec: 'opus',
    isAudioOnly: false,
    isVideo: true,
  },
  mkv: {
    container: 'mkv',
    streamType: 'muxed',
    canonicalMime: 'video/x-matroska',
    defaultVideoCodec: 'h264',
    defaultAudioCodec: 'aac',
    isAudioOnly: false,
    isVideo: true,
  },

  // Audio containers
  mp3: {
    container: 'mp3',
    streamType: 'audio',
    canonicalMime: 'audio/mpeg',
    defaultAudioCodec: 'mp3',
    isAudioOnly: true,
    isVideo: false,
  },
  wav: {
    container: 'wav',
    streamType: 'audio',
    canonicalMime: 'audio/wav',
    defaultAudioCodec: 'pcm',
    isAudioOnly: true,
    isVideo: false,
  },
  flac: {
    container: 'flac',
    streamType: 'audio',
    canonicalMime: 'audio/flac',
    defaultAudioCodec: 'flac',
    isAudioOnly: true,
    isVideo: false,
  },
  m4a: {
    container: 'm4a',
    streamType: 'audio',
    canonicalMime: 'audio/mp4',
    defaultAudioCodec: 'aac',
    isAudioOnly: true,
    isVideo: false,
  },
  aac: {
    container: 'aac',
    streamType: 'audio',
    canonicalMime: 'audio/aac',
    defaultAudioCodec: 'aac',
    isAudioOnly: true,
    isVideo: false,
  },
  ogg: {
    container: 'ogg',
    streamType: 'audio',
    canonicalMime: 'audio/ogg',
    defaultAudioCodec: 'vorbis',
    isAudioOnly: true,
    isVideo: false,
  },
  oga: {
    container: 'ogg',
    streamType: 'audio',
    canonicalMime: 'audio/ogg',
    defaultAudioCodec: 'vorbis',
    isAudioOnly: true,
    isVideo: false,
  },
};

const MIME_MAP: Record<string, MimeClassification> = {
  // Video MIME types
  'video/mp4': {
    container: 'mp4',
    streamType: 'muxed',
    canonicalMime: 'video/mp4',
    defaultVideoCodec: 'h264',
    defaultAudioCodec: 'aac',
    isAudioOnly: false,
    isVideo: true,
  },
  'video/webm': {
    container: 'webm',
    streamType: 'muxed',
    canonicalMime: 'video/webm',
    defaultVideoCodec: 'vp9',
    defaultAudioCodec: 'opus',
    isAudioOnly: false,
    isVideo: true,
  },
  'video/x-matroska': {
    container: 'mkv',
    streamType: 'muxed',
    canonicalMime: 'video/x-matroska',
    defaultVideoCodec: 'h264',
    defaultAudioCodec: 'aac',
    isAudioOnly: false,
    isVideo: true,
  },
  'video/quicktime': {
    container: 'mp4',
    streamType: 'muxed',
    canonicalMime: 'video/mp4',
    defaultVideoCodec: 'h264',
    defaultAudioCodec: 'aac',
    isAudioOnly: false,
    isVideo: true,
  },

  // Audio MIME types
  'audio/mpeg': {
    container: 'mp3',
    streamType: 'audio',
    canonicalMime: 'audio/mpeg',
    defaultAudioCodec: 'mp3',
    isAudioOnly: true,
    isVideo: false,
  },
  'audio/mp3': {
    container: 'mp3',
    streamType: 'audio',
    canonicalMime: 'audio/mpeg',
    defaultAudioCodec: 'mp3',
    isAudioOnly: true,
    isVideo: false,
  },
  'audio/wav': {
    container: 'wav',
    streamType: 'audio',
    canonicalMime: 'audio/wav',
    defaultAudioCodec: 'pcm',
    isAudioOnly: true,
    isVideo: false,
  },
  'audio/x-wav': {
    container: 'wav',
    streamType: 'audio',
    canonicalMime: 'audio/wav',
    defaultAudioCodec: 'pcm',
    isAudioOnly: true,
    isVideo: false,
  },
  'audio/flac': {
    container: 'flac',
    streamType: 'audio',
    canonicalMime: 'audio/flac',
    defaultAudioCodec: 'flac',
    isAudioOnly: true,
    isVideo: false,
  },
  'audio/x-flac': {
    container: 'flac',
    streamType: 'audio',
    canonicalMime: 'audio/flac',
    defaultAudioCodec: 'flac',
    isAudioOnly: true,
    isVideo: false,
  },
  'audio/mp4': {
    container: 'm4a',
    streamType: 'audio',
    canonicalMime: 'audio/mp4',
    defaultAudioCodec: 'aac',
    isAudioOnly: true,
    isVideo: false,
  },
  'audio/x-m4a': {
    container: 'm4a',
    streamType: 'audio',
    canonicalMime: 'audio/mp4',
    defaultAudioCodec: 'aac',
    isAudioOnly: true,
    isVideo: false,
  },
  'audio/aac': {
    container: 'aac',
    streamType: 'audio',
    canonicalMime: 'audio/aac',
    defaultAudioCodec: 'aac',
    isAudioOnly: true,
    isVideo: false,
  },
  'audio/ogg': {
    container: 'ogg',
    streamType: 'audio',
    canonicalMime: 'audio/ogg',
    defaultAudioCodec: 'vorbis',
    isAudioOnly: true,
    isVideo: false,
  },
  'audio/webm': {
    container: 'webm',
    streamType: 'audio',
    canonicalMime: 'audio/webm',
    defaultAudioCodec: 'opus',
    isAudioOnly: true,
    isVideo: false,
  },
};

/**
 * Extract clean file extension from a URL path or filename
 */
export function extractExtension(pathOrUrl: string): string | null {
  try {
    const raw = pathOrUrl.includes('://') ? new URL(pathOrUrl).pathname : pathOrUrl;
    const clean = raw.split('?')[0].split('#')[0];
    const lastSlash = clean.lastIndexOf('/');
    const filename = lastSlash >= 0 ? clean.substring(lastSlash + 1) : clean;
    const lastDot = filename.lastIndexOf('.');
    if (lastDot > 0 && lastDot < filename.length - 1) {
      return filename.substring(lastDot + 1).toLowerCase();
    }
  } catch {
    // If parsing fails, use regex fallback
    const match = pathOrUrl.match(/\.([a-zA-Z0-9]{2,5})(?:[?#]|$)/);
    if (match) return match[1].toLowerCase();
  }
  return null;
}

/**
 * Classify media from Content-Type header or file extension
 */
export function classifyMedia(contentTypeHeader?: string | null, urlOrFilename?: string): MimeClassification | null {
  // First attempt Content-Type lookup
  if (contentTypeHeader) {
    const normalized = contentTypeHeader.split(';')[0].trim().toLowerCase();
    if (MIME_MAP[normalized]) {
      return MIME_MAP[normalized];
    }
    // Handle application/octet-stream fallback via extension
    if (normalized === 'application/octet-stream' && urlOrFilename) {
      const ext = extractExtension(urlOrFilename);
      if (ext && EXTENSION_MAP[ext]) {
        return EXTENSION_MAP[ext];
      }
    }
  }

  // Second attempt: lookup via file extension
  if (urlOrFilename) {
    const ext = extractExtension(urlOrFilename);
    if (ext && EXTENSION_MAP[ext]) {
      return EXTENSION_MAP[ext];
    }
  }

  return null;
}

/**
 * Extract original filename from Content-Disposition header
 */
export function parseContentDispositionFilename(header?: string | null): string | null {
  if (!header) return null;

  // RFC 5987 / RFC 6266 filename*=UTF-8''filename.ext
  const utf8Match = header.match(/filename\*\s*=\s*UTF-8''([^;\r\n]+)/i);
  if (utf8Match && utf8Match[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return utf8Match[1].trim();
    }
  }

  // Standard filename="filename.ext" or filename=filename.ext
  const standardMatch = header.match(/filename\s*=\s*(?:"([^"]+)"|([^;\s\r\n]+))/i);
  if (standardMatch) {
    return (standardMatch[1] || standardMatch[2] || '').trim();
  }

  return null;
}

/**
 * Derive human-friendly title from URL or filename
 */
export function deriveTitleFromUrl(url: string, fallbackName?: string): string {
  if (fallbackName && fallbackName.trim().length > 0) {
    // Strip extension
    const dot = fallbackName.lastIndexOf('.');
    return dot > 0 ? fallbackName.substring(0, dot) : fallbackName;
  }

  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      const last = decodeURIComponent(segments[segments.length - 1]);
      const dot = last.lastIndexOf('.');
      const title = dot > 0 ? last.substring(0, dot) : last;
      if (title.trim().length > 0) {
        return title.replace(/[-_]+/g, ' ');
      }
    }
    return parsed.hostname;
  } catch {
    return 'Direct Media Stream';
  }
}
