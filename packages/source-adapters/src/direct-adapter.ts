/**
 * Project MUXARO - Direct Media Source Adapter
 * 
 * Inspects and validates direct HTTP/HTTPS media streams:
 * - Supports MP4, MKV, WebM, MP3, WAV, FLAC, M4A, OGG, AAC
 * - Uses SSRF-safe HEAD requests with automated Range GET fallback
 * - Extracts Content-Type, Content-Length, Content-Disposition, and Accept-Ranges
 * - Validates container integrity and builds comprehensive MediaManifest
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
import { InvalidMediaError } from './errors.ts';
import { AbuseDetector, RightsValidator } from './rights-validator.ts';
import { inspectHttpMediaHeaders } from './utils/http-inspector.ts';
import {
  classifyMedia,
  parseContentDispositionFilename,
  deriveTitleFromUrl,
  extractExtension,
} from './utils/mime-detector.ts';

const SUPPORTED_CONTAINERS: readonly ContainerFormat[] = [
  'mp4',
  'webm',
  'mkv',
  'm4a',
  'mp3',
  'wav',
  'flac',
  'ogg',
  'aac',
];

const DIRECT_MEDIA_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'webm',
  'mkv',
  'mp3',
  'wav',
  'flac',
  'm4a',
  'aac',
  'ogg',
  'oga',
]);

export class DirectMediaAdapter implements SourceAdapter {
  public readonly name = 'direct-media-adapter';
  public readonly supportedProtocols = ['http:', 'https:'] as const;

  /**
   * Determine if the given URL is a candidate for direct media inspection
   */
  public canHandle(rawUrl: string): boolean {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }

      // Check if domain is a specialized video portal (handled by other adapters)
      const host = parsed.hostname.toLowerCase();
      if (
        host === 'youtube.com' ||
        host.endsWith('.youtube.com') ||
        host === 'youtu.be'
      ) {
        return false;
      }

      // Check file extension in path or query
      const ext = extractExtension(parsed.pathname) || extractExtension(parsed.href);
      if (ext && DIRECT_MEDIA_EXTENSIONS.has(ext)) {
        return true;
      }

      // If URL has typical media query params (e.g. ?format=mp4 or &ext=mp3)
      for (const val of parsed.searchParams.values()) {
        const queryExt = val.toLowerCase();
        if (DIRECT_MEDIA_EXTENSIONS.has(queryExt)) {
          return true;
        }
      }

      // Allow generic direct HTTP/HTTPS URLs to be tested via HEAD probe
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Inspect direct media link via HTTP HEAD / Range GET
   */
  public async inspect(url: string, options?: InspectOptions): Promise<MediaManifest> {
    const inspectedAt = new Date().toISOString();

    // 1. Abuse & anomaly assertion
    AbuseDetector.assertSafe(url);

    // 2. Evaluate rights & compliance
    const rights = RightsValidator.evaluate(url, options?.rightsDeclaration, 'direct_media');

    // 3. Perform safe HTTP inspection
    const httpInfo = await inspectHttpMediaHeaders(url, {
      timeoutMs: options?.timeoutMs ?? 8000,
      maxRedirects: options?.maxRedirects ?? 3,
      userAgent: options?.userAgent,
      customHeaders: options?.customHeaders,
      customSsrfValidator: options?.ssrfValidator,
    });

    // 4. Classify media type
    const filenameFromHeader = parseContentDispositionFilename(httpInfo.contentDisposition);
    const classification = classifyMedia(httpInfo.contentType, filenameFromHeader || httpInfo.finalUrl);

    if (!classification) {
      throw new InvalidMediaError(
        `Target URL did not return a supported media Content-Type or recognized extension. (Content-Type: ${httpInfo.contentType || 'none'})`,
        {
          url,
          finalUrl: httpInfo.finalUrl,
          contentType: httpInfo.contentType,
          statusCode: httpInfo.statusCode,
        }
      );
    }

    // 5. Derive metadata
    const title = deriveTitleFromUrl(httpInfo.finalUrl, filenameFromHeader || undefined);
    const filesizeBytes = httpInfo.contentLengthBytes ?? undefined;

    // 6. Build streams and audio tracks
    const streams: MediaStream[] = [];
    const audioTracks: AudioTrack[] = [];

    const streamId = 'stream-0';
    const isExtractable = rights.canExtractStreams;

    if (classification.isVideo || classification.streamType === 'muxed') {
      // Primary video/muxed stream
      streams.push({
        id: streamId,
        streamType: classification.streamType,
        container: classification.container,
        codec: classification.defaultVideoCodec,
        contentLengthBytes: filesizeBytes,
        directUrl: httpInfo.finalUrl,
        mimeType: classification.canonicalMime,
        isStreamExtractable: isExtractable,
        requiresRemux: false,
        requiresTranscode: false,
        headers: {
          'Accept-Ranges': httpInfo.acceptRanges ? 'bytes' : 'none',
        },
      });

      // Companion audio track for muxed streams
      audioTracks.push({
        id: 'audio-0',
        codec: classification.defaultAudioCodec || 'aac',
        channels: 2,
        sampleRateHz: 48000,
        contentLengthBytes: filesizeBytes,
        directUrl: httpInfo.finalUrl,
        mimeType: classification.container === 'webm' ? 'audio/webm' : 'audio/mp4',
        isExtractable,
      });
    } else {
      // Audio-only media
      streams.push({
        id: streamId,
        streamType: 'audio',
        container: classification.container,
        codec: classification.defaultAudioCodec,
        contentLengthBytes: filesizeBytes,
        directUrl: httpInfo.finalUrl,
        mimeType: classification.canonicalMime,
        isStreamExtractable: isExtractable,
        requiresRemux: false,
        requiresTranscode: false,
      });

      audioTracks.push({
        id: 'audio-0',
        codec: classification.defaultAudioCodec || 'mp3',
        channels: 2,
        sampleRateHz: 44100,
        contentLengthBytes: filesizeBytes,
        directUrl: httpInfo.finalUrl,
        mimeType: classification.canonicalMime,
        isExtractable,
      });
    }

    return {
      sourceUrl: url,
      canonicalUrl: httpInfo.finalUrl,
      sourceType: 'direct_media',
      title,
      filesizeBytes,
      container: classification.container,
      mimeType: classification.canonicalMime,
      streams,
      audioTracks,
      rights,
      canExtractStreams: rights.canExtractStreams,
      extractionPolicyNotice: rights.canExtractStreams
        ? 'Direct media stream extraction authorized under verified direct access.'
        : 'Direct media stream extraction restricted by rights policy.',
      previewUrl: httpInfo.finalUrl,
      metadata: {
        statusCode: httpInfo.statusCode,
        acceptRanges: httpInfo.acceptRanges,
        isRangeSupported: httpInfo.isRangeSupported,
        etag: httpInfo.etag,
        lastModified: httpInfo.lastModified,
        headers: httpInfo.headers,
      },
      inspectedAt,
    };
  }

  /**
   * Check rights compliance for direct media
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
      supportedContainers: SUPPORTED_CONTAINERS,
      complianceNotes:
        'DirectMediaAdapter inspects standard RFC-compliant HTTP/HTTPS media files with verified Content-Type and SSRF protection.',
    };
  }
}
