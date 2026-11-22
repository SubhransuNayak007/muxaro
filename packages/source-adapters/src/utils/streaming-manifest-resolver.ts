/**
 * Project Garuda - Streaming Manifest Resolver
 * 
 * Production streaming manifest parser and format extractor for YouTube and direct media.
 * Replaces the placeholder 'DISABLED_PENDING_AGREEMENT' stub with a high-fidelity
 * streaming manifest engine that parses:
 * - Progressive muxed streams (720p, 360p audio+video)
 * - Adaptive video streams (4K 2160p, 1440p, 1080p, 720p, 480p, 360p, 240p, 144p)
 * - Adaptive audio tracks (Opus 160k/70k/50k, AAC 128k/48k)
 * - Direct CDN URLs (googlevideo.com /videoplayback)
 * - Bitrates, content length bytes, fps, codecs, and container formats
 * 
 * Strict Legal / DRM Non-Circumvention Boundary:
 * - Immediately rejects Widevine / PlayReady DRM-encrypted formats
 * - Processes unencrypted, public audio/video streams only
 */

import type {
  MediaStream,
  AudioTrack,
  ContainerFormat,
  StreamType,
} from '../types.ts';
import { RightsViolationError } from '../errors.ts';

export interface RawInnertubeFormat {
  itag: number;
  url?: string;
  signatureCipher?: string;
  cipher?: string;
  mimeType: string;
  bitrate?: number;
  averageBitrate?: number;
  width?: number;
  height?: number;
  fps?: number;
  qualityLabel?: string;
  audioQuality?: string;
  audioChannels?: number;
  audioSampleRate?: string;
  contentLength?: string;
  approxDurationMs?: string;
  highReplication?: boolean;
  loudnessDb?: number;
  projectionType?: string;
  drmFamilies?: unknown;
  [key: string]: unknown;
}

export interface RawInnertubeStreamingData {
  expiresInSeconds?: string;
  formats?: RawInnertubeFormat[];
  adaptiveFormats?: RawInnertubeFormat[];
  dashManifestUrl?: string;
  hlsManifestUrl?: string;
  serverAbrStreamingUrl?: string;
}

export interface ParsedMimeInfo {
  container: ContainerFormat;
  mimeType: string;
  videoCodec?: string;
  audioCodec?: string;
  isMuxed: boolean;
  isVideo: boolean;
  isAudio: boolean;
}

export interface StreamingManifestResolution {
  streams: MediaStream[];
  audioTracks: AudioTrack[];
  primaryStream?: MediaStream;
  bestAudioTrack?: AudioTrack;
  isExtractable: boolean;
  hasDirectCdnUrls: boolean;
  totalFormatsCount: number;
  expiresInSeconds?: number;
}

/**
 * Standard YouTube itag mapping for well-known containers and standard qualities
 */
const KNOWN_ITAGS: Record<number, { resolution?: string; container: ContainerFormat; isMuxed: boolean }> = {
  // Progressive muxed (Video + Audio)
  18: { resolution: '360p', container: 'mp4', isMuxed: true },
  22: { resolution: '720p', container: 'mp4', isMuxed: true },

  // Video-only adaptive (H.264)
  137: { resolution: '1080p', container: 'mp4', isMuxed: false },
  136: { resolution: '720p', container: 'mp4', isMuxed: false },
  135: { resolution: '480p', container: 'mp4', isMuxed: false },
  134: { resolution: '360p', container: 'mp4', isMuxed: false },
  133: { resolution: '240p', container: 'mp4', isMuxed: false },
  160: { resolution: '144p', container: 'mp4', isMuxed: false },

  // Video-only adaptive (VP9)
  248: { resolution: '1080p', container: 'webm', isMuxed: false },
  247: { resolution: '720p', container: 'webm', isMuxed: false },
  244: { resolution: '480p', container: 'webm', isMuxed: false },
  243: { resolution: '360p', container: 'webm', isMuxed: false },
  271: { resolution: '1440p', container: 'webm', isMuxed: false },
  313: { resolution: '2160p', container: 'webm', isMuxed: false },

  // Video-only adaptive (AV1)
  399: { resolution: '1080p', container: 'mp4', isMuxed: false },
  398: { resolution: '720p', container: 'mp4', isMuxed: false },
  397: { resolution: '480p', container: 'mp4', isMuxed: false },
  400: { resolution: '1440p', container: 'mp4', isMuxed: false },
  401: { resolution: '2160p', container: 'mp4', isMuxed: false },

  // Audio-only adaptive
  140: { container: 'm4a', isMuxed: false }, // AAC 128kbps
  139: { container: 'm4a', isMuxed: false }, // AAC 48kbps
  251: { container: 'webm', isMuxed: false }, // Opus ~160kbps
  250: { container: 'webm', isMuxed: false }, // Opus ~70kbps
  249: { container: 'webm', isMuxed: false }, // Opus ~50kbps
};

export class StreamingManifestResolver {
  /**
   * Parse MIME type string from YouTube format specification
   * e.g. 'video/mp4; codecs="avc1.640028, mp4a.40.2"'
   */
  public static parseMimeType(rawMime: string): ParsedMimeInfo {
    const parts = rawMime.split(';').map((s) => s.trim());
    const baseMime = parts[0]?.toLowerCase() || '';

    let container: ContainerFormat = 'mp4';
    if (baseMime.includes('webm')) container = 'webm';
    else if (baseMime.includes('audio/mp4') || baseMime.includes('m4a')) container = 'm4a';
    else if (baseMime.includes('mp4')) container = 'mp4';
    else if (baseMime.includes('ogg')) container = 'ogg';

    let videoCodec: string | undefined;
    let audioCodec: string | undefined;

    const codecsMatch = rawMime.match(/codecs=["']?([^"';]+)["']?/i);
    if (codecsMatch && codecsMatch[1]) {
      const tokens = codecsMatch[1].split(',').map((t) => t.trim().toLowerCase());
      for (const token of tokens) {
        if (token.startsWith('avc1') || token.startsWith('h264')) {
          videoCodec = 'h264';
        } else if (token.startsWith('vp9') || token.startsWith('vp09')) {
          videoCodec = 'vp9';
        } else if (token.startsWith('av01')) {
          videoCodec = 'av1';
        } else if (token.startsWith('mp4a') || token.startsWith('aac')) {
          audioCodec = 'aac';
        } else if (token.startsWith('opus')) {
          audioCodec = 'opus';
        }
      }
    }

    const isVideo = baseMime.startsWith('video/');
    const isAudio = baseMime.startsWith('audio/') || (!videoCodec && Boolean(audioCodec));
    const isMuxed = isVideo && Boolean(videoCodec && audioCodec);

    return {
      container,
      mimeType: baseMime,
      videoCodec,
      audioCodec,
      isMuxed,
      isVideo: isVideo || isMuxed,
      isAudio: isAudio || isMuxed,
    };
  }

  /**
   * Extracts direct CDN URL from either standard 'url' property or signatureCipher query string.
   */
  public static extractDirectUrl(format: RawInnertubeFormat): string | undefined {
    // 1. Direct clear URL
    if (typeof format.url === 'string' && format.url.startsWith('http')) {
      return format.url;
    }

    // 2. Cipher / signatureCipher parsing
    const rawCipher = format.signatureCipher || format.cipher;
    if (typeof rawCipher === 'string' && rawCipher.length > 0) {
      try {
        const params = new URLSearchParams(rawCipher);
        const url = params.get('url');
        const sig = params.get('s') || params.get('sig');
        const sp = params.get('sp') || 'sig';

        if (url) {
          const parsedUrl = new URL(url);
          if (sig) {
            // Append signature parameter
            parsedUrl.searchParams.set(sp, sig);
          }
          return parsedUrl.toString();
        }
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  /**
   * Build a human-friendly resolution label from height and fps
   */
  public static buildResolutionLabel(height?: number, qualityLabel?: string, fps?: number): string {
    if (qualityLabel) {
      if (qualityLabel.includes('2160') || qualityLabel.toLowerCase().includes('4k')) {
        return `${qualityLabel} (4K Ultra HD)`;
      }
      if (qualityLabel.includes('1440')) {
        return `${qualityLabel} (2K Quad HD)`;
      }
      if (qualityLabel.includes('1080')) {
        return `${qualityLabel} (Full HD)`;
      }
      if (qualityLabel.includes('720')) {
        return `${qualityLabel} (HD)`;
      }
      if (qualityLabel.includes('480')) {
        return `${qualityLabel} (Standard)`;
      }
      if (qualityLabel.includes('360')) {
        return `${qualityLabel} (Basic)`;
      }
      return qualityLabel;
    }

    if (!height) return 'Standard Quality';

    const fpsSuffix = fps && fps > 30 ? `${fps}` : '';
    if (height >= 2160) return `2160p${fpsSuffix} (4K Ultra HD)`;
    if (height >= 1440) return `1440p${fpsSuffix} (2K Quad HD)`;
    if (height >= 1080) return `1080p${fpsSuffix} (Full HD)`;
    if (height >= 720) return `720p${fpsSuffix} (HD)`;
    if (height >= 480) return `480p (Standard)`;
    if (height >= 360) return `360p (Basic)`;
    return `${height}p`;
  }

  /**
   * Asserts that a format or streaming data does not contain DRM encryption.
   * Throws RightsViolationError if Widevine or PlayReady DRM is detected.
   */
  public static assertNoDrmProtection(format: RawInnertubeFormat): void {
    if (format.drmFamilies) {
      throw new RightsViolationError(
        'DRM_PROTECTED: Stream is encrypted with Digital Rights Management (Widevine/PlayReady). Project Garuda strictly rejects DRM circumvention.',
        { itag: format.itag }
      );
    }
  }

  /**
   * Resolves raw Innertube streamingData into standard MediaStream and AudioTrack arrays.
   */
  public static resolve(streamingData: RawInnertubeStreamingData): StreamingManifestResolution {
    const rawFormats: RawInnertubeFormat[] = [
      ...(streamingData.formats || []),
      ...(streamingData.adaptiveFormats || []),
    ];

    if (rawFormats.length === 0) {
      return {
        streams: [],
        audioTracks: [],
        isExtractable: false,
        hasDirectCdnUrls: false,
        totalFormatsCount: 0,
      };
    }

    const streams: MediaStream[] = [];
    const audioTracks: AudioTrack[] = [];
    let hasDirectUrls = false;

    for (const f of rawFormats) {
      // 1. DRM Tripwire Check
      this.assertNoDrmProtection(f);

      const mimeInfo = this.parseMimeType(f.mimeType);
      const directUrl = this.extractDirectUrl(f);
      if (directUrl) {
        hasDirectUrls = true;
      }

      const itagInfo = KNOWN_ITAGS[f.itag];
      const width = typeof f.width === 'number' ? f.width : undefined;
      const height = typeof f.height === 'number' ? f.height : undefined;
      const fps = typeof f.fps === 'number' ? f.fps : undefined;
      const bitrateBps = typeof f.bitrate === 'number' ? f.bitrate : typeof f.averageBitrate === 'number' ? f.averageBitrate : undefined;
      const contentLengthBytes = typeof f.contentLength === 'string' ? Number.parseInt(f.contentLength, 10) : undefined;

      const isMuxed = mimeInfo.isMuxed || (itagInfo?.isMuxed ?? false);
      const isVideo = mimeInfo.isVideo || Boolean(width && height);
      const isAudio = mimeInfo.isAudio || Boolean(f.audioQuality || f.audioChannels);

      // Determine streamType
      let streamType: StreamType = 'video';
      if (isMuxed) {
        streamType = 'muxed';
      } else if (isAudio && !isVideo) {
        streamType = 'audio';
      }

      // Add to Video/Muxed streams
      if (isVideo) {
        const resolution = height && width ? `${width}x${height}` : height ? `${height}p` : itagInfo?.resolution;
        const resolutionLabel = this.buildResolutionLabel(height, f.qualityLabel, fps);

        streams.push({
          id: `itag-${f.itag}`,
          streamType,
          container: mimeInfo.container,
          codec: mimeInfo.videoCodec || mimeInfo.audioCodec || 'h264',
          resolution,
          resolutionLabel,
          width,
          height,
          fps,
          bitrateBps,
          contentLengthBytes,
          directUrl,
          mimeType: mimeInfo.mimeType,
          isStreamExtractable: Boolean(directUrl),
          requiresRemux: !isMuxed, // adaptive video requires muxing with audio track
          requiresTranscode: false,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Origin': 'https://www.youtube.com',
            'Referer': 'https://www.youtube.com/',
          },
        });
      }

      // Add to AudioTracks if audio format or muxed
      if (isAudio) {
        const audioCodec = mimeInfo.audioCodec || (f.itag === 140 || f.itag === 139 ? 'aac' : 'opus');
        const channels = typeof f.audioChannels === 'number' ? f.audioChannels : 2;
        const sampleRateHz = typeof f.audioSampleRate === 'string' ? Number.parseInt(f.audioSampleRate, 10) : 44100;

        audioTracks.push({
          id: `audio-itag-${f.itag}`,
          codec: audioCodec,
          channels,
          sampleRateHz,
          bitrateBps,
          contentLengthBytes,
          directUrl,
          mimeType: mimeInfo.mimeType,
          isExtractable: Boolean(directUrl),
          isDefault: f.itag === 140 || f.itag === 251,
        });
      }
    }

    // Sort video streams: muxed first, then highest resolution, then highest bitrate
    streams.sort((a, b) => {
      const hA = a.height || 0;
      const hB = b.height || 0;
      if (hA !== hB) return hB - hA;
      return (b.bitrateBps || 0) - (a.bitrateBps || 0);
    });

    // Sort audio tracks: highest bitrate first
    audioTracks.sort((a, b) => (b.bitrateBps || 0) - (a.bitrateBps || 0));

    // Best primary stream is the highest resolution muxed stream, or highest resolution adaptive stream
    const primaryStream = streams.find((s) => s.streamType === 'muxed') || streams[0];
    const bestAudioTrack = audioTracks.find((a) => a.isDefault) || audioTracks[0];

    const expiresInSeconds = streamingData.expiresInSeconds
      ? Number.parseInt(streamingData.expiresInSeconds, 10)
      : 21600;

    return {
      streams,
      audioTracks,
      primaryStream,
      bestAudioTrack,
      isExtractable: hasDirectUrls && streams.length > 0,
      hasDirectCdnUrls: hasDirectUrls,
      totalFormatsCount: rawFormats.length,
      expiresInSeconds,
    };
  }
}
