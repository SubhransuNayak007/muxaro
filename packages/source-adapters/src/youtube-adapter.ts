/**
 * Project Garuda - High-Performance YouTube Source Adapter
 * 
 * Production YouTube extraction adapter with multi-client Innertube fallback
 * (TVHTML5_SIMPLY_EMBEDDED, IOS, WEB), dynamic IPv6 /64 subnet binding,
 * and real-time streaming manifest resolution.
 * 
 * Core Features:
 * - Multi-client Innertube fallback sequence:
 *   1. TVHTML5_SIMPLY_EMBEDDED: Bypasses SABR/bot limits, returns clear direct CDN URLs.
 *   2. IOS: High-fidelity mobile client with unthrottled streaming streams.
 *   3. WEB: Desktop web fallback.
 * - Outgoing IPv6 rotation binding via IPv6Rotator.
 * - Full streaming manifest resolution: 4K, 1440p, 1080p, 720p, 480p, 360p video streams,
 *   adaptive audio tracks (Opus, AAC), bitrates, codecs, and direct CDN URLs.
 * - Hard legal & DRM gate: Strictly rejects Widevine/PlayReady DRM streams.
 */

import type {
  SourceAdapter,
  MediaManifest,
  MediaStream,
  RightsCheckResult,
  RightsDeclaration,
  AdapterCapabilities,
  InspectOptions,
  ContainerFormat,
} from './types.ts';
import {
  InvalidMediaError,
  RightsViolationError,
} from './errors.ts';
import { AbuseDetector, RightsValidator } from './rights-validator.ts';
import {
  StreamingManifestResolver,
  type RawInnertubeStreamingData,
  type StreamingManifestResolution,
} from './utils/streaming-manifest-resolver.ts';
import { IPv6Rotator, defaultIPv6Rotator } from './utils/ipv6-rotator.ts';

export interface YouTubeAdapterOptions {
  /** Optional custom IPv6 rotator instance or subnet CIDR */
  ipv6Rotator?: IPv6Rotator;
  ipv6Subnet?: string;
  /** Request timeout in ms (default: 10000) */
  timeoutMs?: number;
  /** Optional custom fetch implementation for unit tests / mocking */
  customFetch?: typeof fetch;
}

export interface InnertubeClientProfile {
  name: string;
  clientName: string;
  clientVersion: string;
  headers: Record<string, string>;
  innertubeContext: Record<string, unknown>;
}

const INNERTUBE_PROFILES: readonly InnertubeClientProfile[] = [
  // 1. TV Embedded: Highest reliability, clear direct URLs without complex throttling
  {
    name: 'TVHTML5_SIMPLY_EMBEDDED',
    clientName: 'TVHTML5_SIMPLY_EMBEDDED',
    clientVersion: '2.0',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/5.0 TV Safari/538.1',
      'X-YouTube-Client-Name': '85',
      'X-YouTube-Client-Version': '2.0',
      Origin: 'https://www.youtube.com',
      Referer: 'https://www.youtube.com/tv',
    },
    innertubeContext: {
      client: {
        clientName: 'TVHTML5_SIMPLY_EMBEDDED',
        clientVersion: '2.0',
        clientScreen: 'EMBED',
        platform: 'TV',
        hl: 'en',
        gl: 'US',
        utcOffsetMinutes: 0,
      },
      thirdParty: {
        embedUrl: 'https://www.youtube.com',
      },
    },
  },

  // 2. iOS Mobile: Direct unthrottled streaming streams
  {
    name: 'IOS',
    clientName: 'IOS',
    clientVersion: '19.45.4',
    headers: {
      'User-Agent':
        'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X; en_US)',
      'X-YouTube-Client-Name': '5',
      'X-YouTube-Client-Version': '19.45.4',
      Origin: 'https://www.youtube.com',
    },
    innertubeContext: {
      client: {
        clientName: 'IOS',
        clientVersion: '19.45.4',
        deviceMake: 'Apple',
        deviceModel: 'iPhone16,2',
        osName: 'iOS',
        osVersion: '17.5.1.21F90',
        hl: 'en',
        gl: 'US',
        utcOffsetMinutes: 0,
      },
    },
  },

  // 3. Desktop Web Fallback
  {
    name: 'WEB',
    clientName: 'WEB',
    clientVersion: '2.20241118.01.00',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': '2.20241118.01.00',
      Origin: 'https://www.youtube.com',
      Referer: 'https://www.youtube.com/',
    },
    innertubeContext: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20241118.01.00',
        hl: 'en',
        gl: 'US',
        utcOffsetMinutes: 0,
      },
    },
  },
];

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

export class YouTubeAdapter implements SourceAdapter {
  public readonly id = 'youtube-source-adapter';
  public readonly name = 'youtube-adapter';
  public readonly supportedProtocols = ['http:', 'https:'] as const;

  private readonly rotator: IPv6Rotator;
  private readonly defaultTimeoutMs: number;
  private readonly fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

  constructor(options?: YouTubeAdapterOptions) {
    if (options?.ipv6Rotator) {
      this.rotator = options.ipv6Rotator;
    } else if (options?.ipv6Subnet) {
      this.rotator = new IPv6Rotator({ subnet: options.ipv6Subnet });
    } else {
      this.rotator = defaultIPv6Rotator;
    }

    this.defaultTimeoutMs = options?.timeoutMs ?? 10000;
    this.fetchImpl = options?.customFetch ?? ((u, i) => this.rotator.fetch(u, i));
  }

  /**
   * Return the underlying IPv6 rotator
   */
  public getRotator(): IPv6Rotator {
    return this.rotator;
  }

  /**
   * Determine if the URL belongs to YouTube
   */
  public canHandle(rawUrl: string): boolean {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }
      const host = parsed.hostname.toLowerCase();
      if (!YOUTUBE_HOSTS.has(host) && !host.endsWith('.youtube.com')) {
        return false;
      }
      return this.extractVideoId(rawUrl) !== null;
    } catch {
      return false;
    }
  }

  /**
   * Extract YouTube video ID from various URL variants:
   * - https://www.youtube.com/watch?v=dQw4w9WgXcQ
   * - https://youtu.be/dQw4w9WgXcQ
   * - https://www.youtube.com/embed/dQw4w9WgXcQ
   * - https://www.youtube.com/shorts/dQw4w9WgXcQ
   * - https://music.youtube.com/watch?v=dQw4w9WgXcQ
   */
  public extractVideoId(rawUrl: string): string | null {
    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.toLowerCase();

      // youtu.be/VIDEO_ID
      if (host === 'youtu.be') {
        const id = parsed.pathname.slice(1).split('/')[0]?.split('?')[0] || '';
        return this.isValidVideoId(id) ? id : null;
      }

      // /watch?v=VIDEO_ID
      if (parsed.pathname === '/watch' || parsed.pathname === '/watch/') {
        const id = parsed.searchParams.get('v');
        return id && this.isValidVideoId(id) ? id : null;
      }

      // /embed/VIDEO_ID
      if (parsed.pathname.startsWith('/embed/')) {
        const id = parsed.pathname.substring('/embed/'.length).split('/')[0]?.split('?')[0] || '';
        return this.isValidVideoId(id) ? id : null;
      }

      // /shorts/VIDEO_ID
      if (parsed.pathname.startsWith('/shorts/')) {
        const id = parsed.pathname.substring('/shorts/'.length).split('/')[0]?.split('?')[0] || '';
        return this.isValidVideoId(id) ? id : null;
      }

      // /v/VIDEO_ID
      if (parsed.pathname.startsWith('/v/')) {
        const id = parsed.pathname.substring('/v/'.length).split('/')[0]?.split('?')[0] || '';
        return this.isValidVideoId(id) ? id : null;
      }

      return null;
    } catch {
      return null;
    }
  }

  private isValidVideoId(id: string): boolean {
    return /^[a-zA-Z0-9_-]{11}$/.test(id);
  }

  /**
   * Primary inspection and streaming manifest extraction method
   */
  public async inspect(url: string, options?: InspectOptions): Promise<MediaManifest> {
    const inspectedAt = new Date().toISOString();

    // 1. Abuse defense assertion
    AbuseDetector.assertSafe(url);

    // 2. Parse 11-char video ID
    const videoId = this.extractVideoId(url);
    if (!videoId) {
      throw new InvalidMediaError(`Unable to parse valid 11-character YouTube video ID from URL: ${url}`, {
        url,
      });
    }

    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const previewUrl = `https://www.youtube-nocookie.com/embed/${videoId}`;
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;

    // 3. Multi-client Innertube fallback loop
    let manifestResult: StreamingManifestResolution | null = null;
    let videoTitle = `YouTube Video (${videoId})`;
    let authorName = 'YouTube Creator';
    let authorUrl = canonicalUrl;
    let description: string | undefined;
    let durationSeconds = 0;
    let thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    let activeClientUsed = 'NONE';

    for (const profile of INNERTUBE_PROFILES) {
      try {
        const responseData = await this.queryInnertubePlayer(videoId, profile, timeoutMs);
        if (!responseData) continue;

        // Check playabilityStatus
        const playability = responseData.playabilityStatus;
        if (playability) {
          // Hard DRM tripwire
          if (
            playability.drmFamilies ||
            (playability.reason && /drm|copyright|protected|license|purchase/i.test(playability.reason))
          ) {
            throw new RightsViolationError(
              'DRM_PROTECTED: Stream is encrypted with Digital Rights Management. Extraction is strictly prohibited under DMCA §1201.',
              { videoId, reason: playability.reason }
            );
          }

          if (playability.status !== 'OK') {
            continue; // Fallback to next client profile
          }
        }

        // Extract metadata attributes from videoDetails
        const details = responseData.videoDetails;
        if (details) {
          if (details.title) videoTitle = details.title;
          if (details.author) authorName = details.author;
          if (details.channelId) authorUrl = `https://www.youtube.com/channel/${details.channelId}`;
          if (details.shortDescription) description = details.shortDescription;
          if (details.lengthSeconds) {
            durationSeconds = Number.parseInt(details.lengthSeconds, 10) || 0;
          }
          if (details.thumbnail?.thumbnails && details.thumbnail.thumbnails.length > 0) {
            const sorted = [...details.thumbnail.thumbnails].sort(
              (a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)
            );
            thumbnailUrl = sorted[0]?.url || thumbnailUrl;
          }
        }

        // Resolve streamingData formats
        if (responseData.streamingData) {
          const resolved = StreamingManifestResolver.resolve(responseData.streamingData);
          if (resolved.streams.length > 0) {
            manifestResult = resolved;
            activeClientUsed = profile.name;
            break; // Successfully resolved formats!
          }
        }
      } catch (err: unknown) {
        // If DRM error, abort immediately without retrying other profiles
        if (err instanceof RightsViolationError) {
          throw err;
        }
        // Otherwise continue to next profile in fallback matrix
      }
    }

    // 4. If all Innertube profiles failed or returned no streams, fallback to oEmbed for metadata
    if (!manifestResult || manifestResult.streams.length === 0) {
      const oEmbed = await this.fetchOEmbed(canonicalUrl, timeoutMs);
      if (oEmbed) {
        if (oEmbed.title) videoTitle = oEmbed.title;
        if (oEmbed.author_name) authorName = oEmbed.author_name;
        if (oEmbed.author_url) authorUrl = oEmbed.author_url;
        if (oEmbed.thumbnail_url) thumbnailUrl = oEmbed.thumbnail_url;
      }
    }

    const streams = manifestResult?.streams ?? [];
    const audioTracks = manifestResult?.audioTracks ?? [];
    const canExtract = streams.length > 0 && (manifestResult?.isExtractable ?? false);

    const embedHtml = `<iframe width="560" height="315" src="${previewUrl}" title="${videoTitle.replace(
      /"/g,
      '&quot;'
    )}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;

    // 5. Evaluate rights
    const rights = RightsValidator.evaluate(url, options?.rightsDeclaration, 'direct_media');

    return {
      sourceUrl: url,
      canonicalUrl,
      sourceType: 'youtube_permitted',
      title: videoTitle,
      author: authorName,
      authorUrl,
      thumbnailUrl,
      description: description || `YouTube video: ${videoTitle}`,
      durationSeconds,
      container: 'mp4' as ContainerFormat,
      mimeType: 'video/mp4',
      streams,
      audioTracks,
      rights: {
        ...rights,
        canExtractStreams: canExtract,
      },
      canExtractStreams: canExtract,
      extractionPolicyNotice: canExtract
        ? `Streaming manifest resolved successfully via Innertube profile '${activeClientUsed}'. Unencrypted public CDN stream URLs ready for direct extraction.`
        : 'Metadata retrieved. Direct streams could not be resolved from active Innertube profiles.',
      previewUrl,
      embedHtml,
      metadata: {
        videoId,
        activeClientUsed,
        streamsCount: streams.length,
        audioTracksCount: audioTracks.length,
        hasDirectCdnUrls: manifestResult?.hasDirectCdnUrls ?? false,
        expiresInSeconds: manifestResult?.expiresInSeconds,
      },
      inspectedAt,
    };
  }

  /**
   * Internal query to YouTube Innertube /player endpoint
   */
  private async queryInnertubePlayer(
    videoId: string,
    profile: InnertubeClientProfile,
    timeoutMs: number
  ): Promise<{
    playabilityStatus?: { status?: string; reason?: string; drmFamilies?: unknown };
    videoDetails?: {
      title?: string;
      author?: string;
      channelId?: string;
      lengthSeconds?: string;
      shortDescription?: string;
      thumbnail?: { thumbnails?: Array<{ url: string; width: number; height: number }> };
    };
    streamingData?: RawInnertubeStreamingData;
  } | null> {
    const endpoint = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

    const payload = {
      context: profile.innertubeContext,
      videoId,
      playbackContext: {
        contentPlaybackContext: {
          html5Preference: 'HTML5_PREF_WANTS',
          signatureTimestamp: 19800,
        },
      },
      contentCheckOk: true,
      racyCheckOk: true,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...profile.headers,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        return null;
      }

      return (await res.json()) as any;
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Fetch official oEmbed metadata as fallback
   */
  private async fetchOEmbed(
    canonicalUrl: string,
    timeoutMs: number
  ): Promise<{ title?: string; author_name?: string; author_url?: string; thumbnail_url?: string } | null> {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), Math.min(timeoutMs, 5000));

    try {
      const res = await this.fetchImpl(oembedUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GarudaMediaProbe/1.0',
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (res.ok) {
        return (await res.json()) as any;
      }
      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Resolve active direct download streams for given stream IDs
   */
  public async getDownloadStreams(
    url: string,
    selectedStreamIds: string[]
  ): Promise<MediaStream[]> {
    const manifest = await this.inspect(url);
    if (!manifest.canExtractStreams || manifest.streams.length === 0) {
      throw new InvalidMediaError(`No extractable streams available for YouTube video: ${url}`, {
        url,
      });
    }

    if (!selectedStreamIds || selectedStreamIds.length === 0) {
      // Default: return best muxed or highest quality stream + audio
      return manifest.streams.slice(0, 1);
    }

    const matched = manifest.streams.filter((s) => selectedStreamIds.includes(s.id));
    if (matched.length === 0) {
      // Fallback to top available stream
      return [manifest.streams[0]!];
    }

    return matched;
  }

  /**
   * Evaluate rights for YouTube links
   */
  public async checkRights(url: string, declaration?: RightsDeclaration): Promise<RightsCheckResult> {
    AbuseDetector.assertSafe(url);
    return RightsValidator.evaluate(url, declaration, 'direct_media');
  }

  /**
   * Return adapter capabilities
   */
  public getCapabilities(): AdapterCapabilities {
    return {
      canExtractMedia: true,
      canFetchMetadata: true,
      canGeneratePreview: true,
      requiresRightsAttestation: false,
      supportedContainers: ['mp4', 'webm', 'm4a'],
      complianceNotes:
        'Project Garuda YouTube source adapter with multi-client Innertube fallback (TVHTML5_SIMPLY_EMBEDDED, IOS, WEB), outbound IPv6 /64 rotation, and real-time streaming manifest resolution. DRM-encrypted streams strictly rejected.',
    };
  }
}

// Alias for alternate naming
export { YouTubeAdapter as YouTubeSourceAdapter };
