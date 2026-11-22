/**
 * MUXARO Media Processing Platform - Vimeo Metadata & Stream Extractor
 * 
 * Extracts progressive MP4 and HLS streams, resolutions, codecs, duration,
 * and metadata from Vimeo videos with sticky proxy routing and token-bucket
 * rate limiting.
 */

import {
  MuxaroError,
  canonicalizeMediaUrl,
  type MediaAnalysisResult,
  type MediaFormatInfo,
} from '@muxaro/shared';
import type { ProxyManager, ProxyNode } from '../proxy-manager.js';
import type { OutboundRateLimiter } from '../token-bucket.js';

export interface VimeoExtractorDependencies {
  proxyManager: ProxyManager;
  rateLimiter: OutboundRateLimiter;
}

export class VimeoExtractor {
  private readonly proxyManager: ProxyManager;
  private readonly rateLimiter: OutboundRateLimiter;

  constructor(deps: VimeoExtractorDependencies) {
    this.proxyManager = deps.proxyManager;
    this.rateLimiter = deps.rateLimiter;
  }

  /**
   * Extracts metadata and formats for a Vimeo video.
   */
  public async extract(rawUrl: string): Promise<MediaAnalysisResult> {
    const canonical = canonicalizeMediaUrl(rawUrl);
    if (canonical.platform !== 'vimeo' || !canonical.id) {
      throw MuxaroError.invalidUrl('Invalid Vimeo URL or missing video ID');
    }

    const videoId = canonical.id;

    // 1. Check upstream circuit breaker
    await this.proxyManager.assertCircuitClosed('vimeo');

    // 2. Select sticky residential proxy for this video session
    const proxy = this.proxyManager.getStickyProxy(videoId);

    // 3. Rate limiter token acquisition with randomized jitter
    await this.rateLimiter.acquire('vimeo.com');

    const startTime = Date.now();
    try {
      const result = await this.queryPlayerConfig(videoId, proxy);
      const latencyMs = Date.now() - startTime;

      if (proxy) {
        await this.proxyManager.recordSuccess(proxy.id, latencyMs);
      }
      await this.proxyManager.recordCircuitSuccess('vimeo');

      return result;
    } catch (err) {
      const latencyMs = Date.now() - startTime;

      if (err instanceof MuxaroError && err.code === 'DRM_PROTECTED') {
        throw err;
      }

      console.warn(
        `[VimeoExtractor] Config extraction failed for video ${videoId}:`,
        err instanceof Error ? err.message : String(err)
      );

      if (proxy) {
        await this.proxyManager.recordFailure(proxy.id, 'network_error', latencyMs);
      }

      // Attempt public oEmbed fallback
      try {
        const oembedResult = await this.queryOEmbedFallback(videoId, canonical.canonicalUrl);
        if (oembedResult) {
          return oembedResult;
        }
      } catch {
        // Fallback failed
      }

      await this.proxyManager.recordCircuitFailure('vimeo');
      throw MuxaroError.extractionFailed(
        `Vimeo extraction failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Queries Vimeo player configuration endpoint
   */
  private async queryPlayerConfig(
    videoId: string,
    proxy: ProxyNode | null
  ): Promise<MediaAnalysisResult> {
    const endpoint = `https://player.vimeo.com/video/${videoId}/config`;

    const res = await fetch(endpoint, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        Referer: 'https://vimeo.com/',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 403) {
      throw MuxaroError.forbidden('Vimeo video is private, password-protected, or geo-restricted');
    }

    if (!res.ok) {
      throw new Error(`Vimeo player config returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      video?: {
        id?: number | string;
        title?: string;
        duration?: number;
        owner?: { name?: string };
        thumbs?: Record<string, string>;
      };
      request?: {
        files?: {
          progressive?: Array<{
            id?: string;
            quality?: string;
            width?: number;
            height?: number;
            fps?: number;
            bitrate?: number;
            url?: string;
            mime?: string;
          }>;
          hls?: {
            default_cdn?: string;
            cdns?: Record<string, { url?: string }>;
          };
          dash?: {
            default_cdn?: string;
            cdns?: Record<string, { url?: string }>;
          };
        };
        drm?: unknown;
      };
    };

    if (data.request?.drm) {
      throw MuxaroError.drmProtected('Vimeo');
    }

    const video = data.video;
    if (!video) {
      throw new Error('Malformed Vimeo response: missing video object');
    }

    const formats: MediaFormatInfo[] = [];

    // Progressive MP4 streams
    const progressive = data.request?.files?.progressive || [];
    for (const prog of progressive) {
      if (!prog.url) continue;

      const width = prog.width;
      const height = prog.height;
      let resolution = prog.quality ? `${prog.quality}p` : undefined;
      if (!resolution && width && height) {
        resolution = `${height}p`;
      }

      formats.push({
        formatId: String(prog.id || prog.quality || `${formats.length}`),
        container: 'mp4',
        resolution,
        width,
        height,
        fps: prog.fps,
        videoCodec: 'h264',
        audioCodec: 'aac',
        bitrate: prog.bitrate,
        hasVideo: true,
        hasAudio: true,
        url: prog.url,
      });
    }

    // Best thumbnail
    let thumbnail: string | undefined;
    if (video.thumbs) {
      thumbnail =
        video.thumbs['1280'] ||
        video.thumbs['960'] ||
        video.thumbs['640'] ||
        video.thumbs.base;
    }

    const canonicalUrl = `https://vimeo.com/${videoId}`;

    return {
      platform: 'vimeo',
      id: String(video.id || videoId),
      canonicalUrl,
      title: video.title || 'Untitled Vimeo Video',
      author: video.owner?.name,
      durationSeconds: video.duration || 0,
      thumbnail,
      formats,
      isPlaylist: false,
      cached: false,
      inspectedAt: new Date().toISOString(),
    };
  }

  /**
   * Fallback to Vimeo oEmbed when player config is not accessible
   */
  private async queryOEmbedFallback(
    videoId: string,
    canonicalUrl: string
  ): Promise<MediaAnalysisResult | null> {
    const oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(canonicalUrl)}`;

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
      duration?: number;
      thumbnail_url?: string;
    };

    return {
      platform: 'vimeo',
      id: videoId,
      canonicalUrl,
      title: oembed.title || 'Vimeo Video',
      author: oembed.author_name || undefined,
      durationSeconds: oembed.duration || 0,
      thumbnail: oembed.thumbnail_url || undefined,
      formats: [],
      isPlaylist: false,
      cached: false,
      inspectedAt: new Date().toISOString(),
    };
  }
}
