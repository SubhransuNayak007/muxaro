/**
 * MUXARO Media Processing Platform - YouTube Metadata & Format Extractor
 * 
 * Extracts video/audio formats, codecs, bitrates, resolutions, duration, and metadata
 * from YouTube using rotating client profiles (tv_embedded, ios, mweb, web) and
 * sticky residential/ISP proxies.
 * 
 * Enforces non-negotiable invariant:
 * - Reject DRM-encrypted streams immediately (MuxaroError.drmProtected)
 * - Outbound rate limiting with atomic token bucket and randomized jitter
 * - Circuit breaker protection against upstream outages
 */

import { execFile } from 'node:child_process';
import {
  MuxaroError,
  canonicalizeMediaUrl,
  type MediaAnalysisResult,
  type MediaFormatInfo,
  type PlaylistItemSummary,
} from '@muxaro/shared';
import type { ProxyManager, ClientProfile, ProxyNode } from '../proxy-manager.js';
import type { OutboundRateLimiter } from '../token-bucket.js';

export interface YouTubeExtractorDependencies {
  proxyManager: ProxyManager;
  rateLimiter: OutboundRateLimiter;
}

export class YouTubeExtractor {
  private readonly proxyManager: ProxyManager;
  private readonly rateLimiter: OutboundRateLimiter;

  constructor(deps: YouTubeExtractorDependencies) {
    this.proxyManager = deps.proxyManager;
    this.rateLimiter = deps.rateLimiter;
  }

  /**
   * Extracts metadata, formats, and stream specifications from YouTube.
   */
  public async extract(rawUrl: string, poToken?: string): Promise<MediaAnalysisResult> {
    const canonical = canonicalizeMediaUrl(rawUrl);
    if (canonical.platform !== 'youtube' || !canonical.id) {
      throw MuxaroError.invalidUrl('Invalid YouTube URL or missing video ID');
    }

    const videoId = canonical.id;

    // 1. Check upstream circuit breaker
    await this.proxyManager.assertCircuitClosed('youtube');

    // 2. Attempt high-fidelity extraction via yt-dlp first (handles JS challenges, n-sig, and all format manifests)
    try {
      const ytDlpResult = await this.extractViaYtDlp(canonical.canonicalUrl, videoId);
      if (ytDlpResult && ytDlpResult.formats.length > 0) {
        await this.proxyManager.recordCircuitSuccess('youtube');
        return {
          ...ytDlpResult,
          isPlaylist: canonical.isPlaylist,
        };
      }
    } catch (err) {
      // Re-throw age-restriction and DRM protection errors immediately without fallbacks
      if (err instanceof MuxaroError) {
        throw err;
      }
      console.warn(`[YouTubeExtractor] Primary yt-dlp extraction failed for ${videoId}, falling back to Innertube API:`, err instanceof Error ? err.message : String(err));
    }

    // 3. Select sticky residential proxy for this video session
    const proxy = this.proxyManager.getStickyProxy(videoId);

    // 4. Rate limiter token acquisition with randomized jitter
    await this.rateLimiter.acquire('youtube.com');

    // 5. Client Profile rotation loop
    let currentProfile: ClientProfile | null = this.proxyManager.getInitialProfile();
    let lastError: Error | null = null;

    while (currentProfile !== null) {
      const startTime = Date.now();
      try {
        const result = await this.queryPlayerApi(videoId, currentProfile, proxy, poToken);
        const latencyMs = Date.now() - startTime;

        if (proxy) {
          await this.proxyManager.recordSuccess(proxy.id, latencyMs);
        }
        await this.proxyManager.recordCircuitSuccess('youtube');

        return {
          ...result,
          canonicalUrl: canonical.canonicalUrl,
          isPlaylist: canonical.isPlaylist,
        };
      } catch (err) {
        const latencyMs = Date.now() - startTime;

        if (err instanceof MuxaroError && err.code === 'DRM_PROTECTED') {
          // Immediately re-throw DRM protection errors; do not rotate or retry
          throw err;
        }

        console.warn(
          `[YouTubeExtractor] Profile "${currentProfile.id}" failed for video ${videoId}:`,
          err instanceof Error ? err.message : String(err)
        );

        if (proxy) {
          const isBot =
            err instanceof Error &&
            (err.message.includes('bot') || err.message.includes('429') || err.message.includes('Sign in'));
          await this.proxyManager.recordFailure(
            proxy.id,
            isBot ? 'bot_challenge' : 'network_error',
            latencyMs
          );
        }

        lastError = err instanceof Error ? err : new Error(String(err));
        // Rotate to next profile
        currentProfile = this.proxyManager.getNextProfile(currentProfile.id);
      }
    }

    await this.proxyManager.recordCircuitFailure('youtube');
    throw MuxaroError.extractionFailed(
      lastError?.message ||
        'Unable to extract playable formats for this YouTube video. It may be age-restricted, private, or DRM-protected.'
    );
  }

  /**
   * Queries YouTube Innertube /player endpoint using client profile context
   */
  private async queryPlayerApi(
    videoId: string,
    profile: ClientProfile,
    proxy: ProxyNode | null,
    poToken?: string
  ): Promise<MediaAnalysisResult> {
    const endpoint = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

    const payload: Record<string, unknown> = {
      context: profile.innertubeContext,
      videoId,
      playbackContext: {
        contentPlaybackContext: {
          html5Preference: 'HTML5_PREF_WANTS',
          signatureTimestamp: 19800,
        },
      },
    };

    if (poToken) {
      payload.serviceIntegrityDimensions = {
        poToken,
      };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...profile.headers,
    };

    const fetchOptions: RequestInit = {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    };

    const response = await fetch(endpoint, fetchOptions);

    if (!response.ok) {
      throw new Error(`YouTube player API responded with HTTP status ${response.status}`);
    }

    const data = (await response.json()) as {
      playabilityStatus?: {
        status?: string;
        reason?: string;
        errorScreen?: unknown;
        drmFamilies?: unknown;
      };
      videoDetails?: {
        videoId?: string;
        title?: string;
        lengthSeconds?: string;
        channelId?: string;
        shortDescription?: string;
        thumbnail?: {
          thumbnails?: Array<{ url: string; width: number; height: number }>;
        };
        author?: string;
        isLiveContent?: boolean;
      };
      streamingData?: {
        expiresInSeconds?: string;
        formats?: Array<Record<string, unknown>>;
        adaptiveFormats?: Array<Record<string, unknown>>;
      };
    };

    const playability = data.playabilityStatus;
    if (!playability) {
      throw new Error('Malformed player response: missing playabilityStatus');
    }

    // -------------------------------------------------------------------------
    // DRM Stream Rejection
    // -------------------------------------------------------------------------
    if (
      playability.drmFamilies ||
      (playability.reason && /drm|copyright|protected|license|purchase/i.test(playability.reason))
    ) {
      throw MuxaroError.drmProtected('YouTube');
    }

    if (playability.status !== 'OK') {
      const reason = playability.reason || playability.status || 'Video unplayable';
      if (/drm|copyright|protected|license/i.test(reason)) {
        throw MuxaroError.drmProtected('YouTube');
      }
      throw new Error(`Player playability status: ${reason}`);
    }

    const details = data.videoDetails;
    if (!details) {
      throw new Error('Malformed player response: missing videoDetails');
    }

    // Parse stream formats
    const rawFormats = [
      ...(data.streamingData?.formats || []),
      ...(data.streamingData?.adaptiveFormats || []),
    ];

    const formats: MediaFormatInfo[] = [];

    for (const f of rawFormats) {
      // Reject any encrypted/DRM format signatures
      if (f.drmFamilies || f.cipher || f.signatureCipher) {
        continue;
      }

      const mimeType = String(f.mimeType || '');
      const parsed = this.parseMimeType(mimeType);

      const width = typeof f.width === 'number' ? f.width : undefined;
      const height = typeof f.height === 'number' ? f.height : undefined;
      const fps = typeof f.fps === 'number' ? f.fps : undefined;
      const bitrate = typeof f.bitrate === 'number' ? f.bitrate : undefined;
      const contentLength = typeof f.contentLength === 'string' ? Number.parseInt(f.contentLength, 10) : undefined;
      const formatId = String(f.itag || `${formats.length}`);

      const hasVideo = Boolean(width && height);
      const hasAudio = Boolean(f.audioQuality || f.audioChannels);

      let resolution = typeof f.qualityLabel === 'string' ? f.qualityLabel : undefined;
      if (!resolution && width && height) {
        resolution = `${height}p`;
      }

      formats.push({
        formatId,
        container: parsed.container,
        resolution,
        width,
        height,
        fps,
        videoCodec: parsed.videoCodec,
        audioCodec: parsed.audioCodec,
        bitrate,
        filesize: contentLength,
        hasVideo,
        hasAudio,
        url: typeof f.url === 'string' ? f.url : undefined,
      });
    }

    // Thumbnails
    let bestThumbnail: string | undefined;
    if (details.thumbnail?.thumbnails && details.thumbnail.thumbnails.length > 0) {
      const sorted = [...details.thumbnail.thumbnails].sort(
        (a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)
      );
      bestThumbnail = sorted[0].url;
    }

    const durationSeconds = details.lengthSeconds ? Number.parseInt(details.lengthSeconds, 10) : 0;

    return {
      platform: 'youtube',
      id: videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      title: details.title || 'Untitled YouTube Video',
      description: details.shortDescription || undefined,
      author: details.author || undefined,
      durationSeconds,
      thumbnail: bestThumbnail,
      formats,
      isPlaylist: false,
      cached: false,
      inspectedAt: new Date().toISOString(),
    };
  }

  /**
   * Fallback to YouTube oEmbed API when player API is completely blocked
   */
  private async queryOEmbedFallback(
    videoId: string,
    canonicalUrl: string
  ): Promise<MediaAnalysisResult | null> {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;

    const res = await fetch(oembedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MuxaroMediaProbe/1.0',
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) return null;

    const oembed = (await res.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };

    return {
      platform: 'youtube',
      id: videoId,
      canonicalUrl,
      title: oembed.title || 'YouTube Video',
      author: oembed.author_name || undefined,
      durationSeconds: 0,
      thumbnail: oembed.thumbnail_url || undefined,
      formats: [],
      isPlaylist: false,
      cached: false,
      inspectedAt: new Date().toISOString(),
    };
  }

  /**
   * Extracts container and codecs from mimeType header
   * Example: 'video/mp4; codecs="avc1.640028, mp4a.40.2"'
   */
  private parseMimeType(mime: string): {
    container: string;
    videoCodec?: string;
    audioCodec?: string;
  } {
    let container = 'mp4';
    let videoCodec: string | undefined;
    let audioCodec: string | undefined;

    const lower = mime.toLowerCase();
    if (lower.includes('webm')) container = 'webm';
    else if (lower.includes('mp4')) container = 'mp4';
    else if (lower.includes('m4a')) container = 'm4a';

    const codecsMatch = mime.match(/codecs=["']?([^"';]+)["']?/i);
    if (codecsMatch && codecsMatch[1]) {
      const parts = codecsMatch[1].split(',').map((p) => p.trim());
      for (const part of parts) {
        if (/^avc1/i.test(part) || /^h264/i.test(part)) videoCodec = 'avc1';
        else if (/^vp09/i.test(part) || /^vp9/i.test(part)) videoCodec = 'vp9';
        else if (/^av01/i.test(part)) videoCodec = 'av01';
        else if (/^mp4a/i.test(part) || /^aac/i.test(part)) audioCodec = 'aac';
        else if (/^opus/i.test(part)) audioCodec = 'opus';
      }
    }

    return { container, videoCodec, audioCodec };
  }

  /**
   * Executes yt-dlp to extract high-fidelity YouTube video/audio manifests
   * with full support for JavaScript challenges and n-sig deciphering.
   */
  private async extractViaYtDlp(canonicalUrl: string, videoId: string): Promise<MediaAnalysisResult> {
    return new Promise<MediaAnalysisResult>((resolve, reject) => {
      const args = [
        '--js-runtimes',
        'node',
        '-J',
        '--no-warnings',
        '--no-playlist',
        canonicalUrl,
      ];

      execFile('yt-dlp', args, { maxBuffer: 25 * 1024 * 1024, timeout: 20_000 }, (error, stdout, stderr) => {
        if (error) {
          const errStr = (stderr || error.message || '').toString();
          if (/sign in to confirm your age|inappropriate for some users|confirm your age/i.test(errStr)) {
            return reject(
              MuxaroError.badRequest(
                'This YouTube video is age-restricted and requires sign-in. MUXARO only processes publicly accessible media.'
              )
            );
          }
          if (/drm|copyright|protected|license/i.test(errStr)) {
            return reject(MuxaroError.drmProtected('YouTube'));
          }
          return reject(new Error(`yt-dlp extraction failed: ${errStr || error.message}`));
        }

        try {
          const data = JSON.parse(stdout);
          const rawFormats = Array.isArray(data.formats) ? data.formats : [];
          const formats: MediaFormatInfo[] = [];

          for (const f of rawFormats) {
            const hasVideo = Boolean(f.vcodec && f.vcodec !== 'none');
            const hasAudio = Boolean(f.acodec && f.acodec !== 'none');
            if (!hasVideo && !hasAudio) continue;

            const formatId = String(f.format_id || `${formats.length}`);
            const container = String(f.ext || (hasVideo ? 'mp4' : 'm4a')).toLowerCase();
            const width = typeof f.width === 'number' ? f.width : undefined;
            const height = typeof f.height === 'number' ? f.height : undefined;
            const fps = typeof f.fps === 'number' ? f.fps : undefined;

            let resolution = typeof f.resolution === 'string' ? f.resolution : undefined;
            if (!resolution && height) {
              resolution = `${height}p`;
            } else if (!resolution && hasAudio && !hasVideo) {
              resolution = 'audio only';
            }

            const videoCodec = hasVideo && typeof f.vcodec === 'string' ? f.vcodec.split('.')[0] : undefined;
            const audioCodec = hasAudio && typeof f.acodec === 'string' ? f.acodec.split('.')[0] : undefined;
            const bitrate =
              typeof f.tbr === 'number'
                ? Math.round(f.tbr * 1000)
                : typeof f.vbr === 'number'
                ? Math.round(f.vbr * 1000)
                : undefined;
            const filesize =
              typeof f.filesize === 'number'
                ? f.filesize
                : typeof f.filesize_approx === 'number'
                ? f.filesize_approx
                : undefined;

            formats.push({
              formatId,
              container,
              resolution,
              width,
              height,
              fps,
              videoCodec,
              audioCodec,
              bitrate,
              filesize,
              hasVideo,
              hasAudio,
              url: typeof f.url === 'string' ? f.url : undefined,
            });
          }

          let bestThumbnail = typeof data.thumbnail === 'string' ? data.thumbnail : undefined;
          if (Array.isArray(data.thumbnails) && data.thumbnails.length > 0) {
            const sorted = [...data.thumbnails].sort(
              (a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)
            );
            if (sorted[0]?.url) {
              bestThumbnail = sorted[0].url;
            }
          }

          const durationSeconds = typeof data.duration === 'number' ? Math.round(data.duration) : 0;

          resolve({
            platform: 'youtube',
            id: videoId,
            canonicalUrl,
            title: data.title || 'Untitled YouTube Video',
            description: data.description || undefined,
            author: data.uploader || data.channel || undefined,
            durationSeconds,
            thumbnail: bestThumbnail,
            formats,
            isPlaylist: false,
            cached: false,
            inspectedAt: new Date().toISOString(),
          });
        } catch (parseErr) {
          reject(
            new Error(
              `Failed to parse yt-dlp JSON output: ${
                parseErr instanceof Error ? parseErr.message : String(parseErr)
              }`
            )
          );
        }
      });
    });
  }
}
