/**
 * Project MUXARO - YouTube Permitted Source Adapter
 * 
 * Permitted metadata, oEmbed inspection, and video preview ONLY for authorized links.
 * 
 * STRICT COMPLIANCE POLICY:
 * - NO unauthorized audiovisual stream extraction
 * - NO proxy rotation or pool management
 * - NO CAPTCHA evasion or solving
 * - NO HTML scraping or reverse-engineered internal API calls
 * - Extraction capability is marked permanently as DISABLED_PENDING_AGREEMENT.
 */

import type {
  SourceAdapter,
  MediaManifest,
  MediaStream,
  AudioTrack,
  RightsCheckResult,
  RightsDeclaration,
  AdapterCapabilities,
  InspectOptions,
  ContainerFormat,
} from './types.ts';
import { ExtractionDisabledError, InvalidMediaError } from './errors.ts';
import { AbuseDetector, RightsValidator } from './rights-validator.ts';
import { assertSsrfSafe } from './ssrf-filter.ts';

export interface YouTubeOEmbedResponse {
  title?: string;
  author_name?: string;
  author_url?: string;
  type?: string;
  height?: number;
  width?: number;
  version?: string;
  provider_name?: string;
  provider_url?: string;
  thumbnail_height?: number;
  thumbnail_width?: number;
  thumbnail_url?: string;
  html?: string;
}

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const YOUTUBE_EXTRACTION_POLICY_NOTICE =
  'Audiovisual stream extraction from YouTube is disabled in compliance with YouTube Terms of Service and developer policies. Extraction requires a direct platform API agreement or verified private copyright authorization.';

export class YouTubePermittedAdapter implements SourceAdapter {
  public readonly id = 'youtube-permitted-adapter';
  public readonly name = 'youtube-permitted-adapter';
  public readonly supportedProtocols = ['http:', 'https:'] as const;

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
      // Must contain a parseable video ID
      return this.extractVideoId(rawUrl) !== null;
    } catch {
      return false;
    }
  }

  /**
   * Extract YouTube video ID from various URL permutations
   * Supports:
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
        const id = parsed.pathname.slice(1).split('/')[0].split('?')[0];
        return this.isValidVideoId(id) ? id : null;
      }

      // /watch?v=VIDEO_ID
      if (parsed.pathname === '/watch' || parsed.pathname === '/watch/') {
        const id = parsed.searchParams.get('v');
        return id && this.isValidVideoId(id) ? id : null;
      }

      // /embed/VIDEO_ID
      if (parsed.pathname.startsWith('/embed/')) {
        const id = parsed.pathname.substring('/embed/'.length).split('/')[0];
        return this.isValidVideoId(id) ? id : null;
      }

      // /shorts/VIDEO_ID
      if (parsed.pathname.startsWith('/shorts/')) {
        const id = parsed.pathname.substring('/shorts/'.length).split('/')[0];
        return this.isValidVideoId(id) ? id : null;
      }

      // /v/VIDEO_ID
      if (parsed.pathname.startsWith('/v/')) {
        const id = parsed.pathname.substring('/v/'.length).split('/')[0];
        return this.isValidVideoId(id) ? id : null;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Standard 11-character YouTube video ID validator
   */
  private isValidVideoId(id: string): boolean {
    return /^[a-zA-Z0-9_-]{11}$/.test(id);
  }

  /**
   * Inspect YouTube URL for permitted metadata and preview ONLY
   */
  public async inspect(url: string, options?: InspectOptions): Promise<MediaManifest> {
    const inspectedAt = new Date().toISOString();

    // 1. Assert no abuse, scraping, or evasion payload in URL
    AbuseDetector.assertSafe(url);

    // 2. Validate video ID
    const videoId = this.extractVideoId(url);
    if (!videoId) {
      throw new InvalidMediaError(`Unable to parse valid 11-character YouTube video ID from URL: ${url}`, {
        url,
      });
    }

    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const previewUrl = `https://www.youtube-nocookie.com/embed/${videoId}`;

    // 3. Evaluate rights declaration and platform policy
    const rights = RightsValidator.evaluate(url, options?.rightsDeclaration, 'youtube_permitted');

    // 4. Fetch official oEmbed metadata (permissible public metadata endpoint)
    let oEmbedData: YouTubeOEmbedResponse | null = null;
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;

    try {
      // Validate oEmbed URL through SSRF guard
      await assertSsrfSafe(oembedUrl, {
        resolveDns: true,
        customValidator: options?.ssrfValidator,
      });

      const controller = new AbortController();
      const timeoutMs = options?.timeoutMs ?? 6000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(oembedUrl, {
          method: 'GET',
          headers: {
            'User-Agent': options?.userAgent || 'MUXARO-PermittedYouTubeAdapter/1.0',
            Accept: 'application/json',
          },
          signal: controller.signal,
        });

        if (res.ok) {
          oEmbedData = (await res.json()) as YouTubeOEmbedResponse;
        }
      } catch {
        // Graceful fallback to synthetic metadata if oEmbed network call fails or is restricted
        oEmbedData = null;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      oEmbedData = null;
    }

    // 5. Construct metadata attributes
    const title = oEmbedData?.title || `YouTube Video (${videoId})`;
    const author = oEmbedData?.author_name || 'YouTube Creator';
    const authorUrl = oEmbedData?.author_url || `https://www.youtube.com/watch?v=${videoId}`;
    const thumbnailUrl =
      oEmbedData?.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    const embedHtml =
      oEmbedData?.html ||
      `<iframe width="560" height="315" src="${previewUrl}" title="${title.replace(
        /"/g,
        '&quot;'
      )}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;

    // 6. Streams and audio tracks
    const streams: MediaStream[] = [
      {
        id: 'stream-1080p',
        streamType: 'video',
        container: 'mp4',
        codec: 'h264',
        height: 1080,
        width: 1920,
        resolution: '1080p',
        resolutionLabel: '1080p (Full HD)',
        mimeType: 'video/mp4',
        isStreamExtractable: rights.canExtractStreams,
        requiresRemux: false,
        requiresTranscode: false,
      },
      {
        id: 'stream-720p',
        streamType: 'video',
        container: 'mp4',
        codec: 'h264',
        height: 720,
        width: 1280,
        resolution: '720p',
        resolutionLabel: '720p (HD)',
        mimeType: 'video/mp4',
        isStreamExtractable: rights.canExtractStreams,
        requiresRemux: false,
        requiresTranscode: false,
      },
    ];

    const audioTracks: AudioTrack[] = [
      {
        id: 'audio-main',
        codec: 'aac',
        channels: 2,
        mimeType: 'audio/mp4',
        isExtractable: rights.canExtractStreams,
      },
    ];

    return {
      sourceUrl: url,
      canonicalUrl,
      sourceType: 'youtube_permitted',
      title,
      author,
      authorUrl,
      thumbnailUrl,
      description: `YouTube video: ${title}`,
      container: 'mp4' as ContainerFormat,
      mimeType: 'video/mp4',
      streams,
      audioTracks,
      rights,
      canExtractStreams: rights.canExtractStreams,
      extractionPolicyNotice: YOUTUBE_EXTRACTION_POLICY_NOTICE,
      previewUrl,
      embedHtml,
      metadata: {
        videoId,
        oEmbed: oEmbedData || { status: 'fallback_metadata_generated' },
        extractionAllowed: rights.canExtractStreams,
      },
      inspectedAt,
    };
  }

  /**
   * Evaluate rights for YouTube links
   */
  public async checkRights(url: string, declaration?: RightsDeclaration): Promise<RightsCheckResult> {
    AbuseDetector.assertSafe(url);
    return RightsValidator.evaluate(url, declaration, 'youtube_permitted');
  }

  /**
   * Alias for checkRights matching ADR-005 signature
   */
  public async validateRights(url: string, declaration?: RightsDeclaration): Promise<RightsCheckResult> {
    return this.checkRights(url, declaration);
  }

  /**
   * Attempt to resolve direct stream URLs for extraction
   * Strictly throws ExtractionDisabledError to prevent unauthorized scraping
   */
  public async getDownloadStreams(
    url: string,
    _selectedStreamIds: string[]
  ): Promise<never> {
    throw new ExtractionDisabledError(
      `ERR_SOURCE_PLATFORM_NOT_PERMITTED: ${YOUTUBE_EXTRACTION_POLICY_NOTICE}`,
      {
        url,
        adapter: this.name,
        code: 'ERR_SOURCE_PLATFORM_NOT_PERMITTED',
      }
    );
  }

  /**
   * Return adapter capabilities and operational constraints
   */
  public getCapabilities(): AdapterCapabilities {
    return {
      canExtractMedia: false, // ALWAYS FALSE
      canFetchMetadata: true,
      canGeneratePreview: true,
      requiresRightsAttestation: true,
      supportedContainers: ['mp4'],
      complianceNotes:
        'YouTubePermittedAdapter provides public oEmbed metadata and embedded video previews ONLY. Audiovisual extraction is permanently disabled pending written platform agreement.',
    };
  }
}
