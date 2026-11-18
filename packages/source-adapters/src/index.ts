/**
 * Project MUXARO - Source Adapters Package
 * 
 * Production TypeScript module providing:
 * - SourceAdapter, MediaStream, AudioTrack, MediaManifest, RightsCheckResult
 * - DirectMediaAdapter (MP4, MKV, WebM, MP3, WAV, FLAC, M4A)
 * - YouTubePermittedAdapter (Permitted metadata and preview only; extraction permanently disabled)
 * - RightsValidator & AbuseDetector
 * - SourceAdapterRegistry & convenience inspection functions
 * - SSRF defense and MIME classification utilities
 */

// Core Types
export * from './types.ts';

// Domain Errors
export * from './errors.ts';

// Adapters
export { DirectMediaAdapter } from './direct-adapter.ts';
export {
  YouTubePermittedAdapter,
  type YouTubeOEmbedResponse,
} from './youtube-permitted-adapter.ts';

// Rights & Abuse Detection
export {
  RightsValidator,
  AbuseDetector,
} from './rights-validator.ts';

// Registry & Factory
export {
  SourceAdapterRegistry,
  defaultAdapterRegistry,
  inspectMediaUrl,
  checkMediaRights,
  type RegisteredAdapterEntry,
} from './adapter-registry.ts';

// SSRF Defense
export {
  validateSsrfSafety,
  assertSsrfSafe,
  ipv4ToNumber,
  isForbiddenIpv4,
  isForbiddenIpv6,
  type SsrfCheckResult,
} from './ssrf-filter.ts';

// MIME & Container Helpers
export {
  classifyMedia,
  extractExtension,
  parseContentDispositionFilename,
  deriveTitleFromUrl,
  type MimeClassification,
} from './utils/mime-detector.ts';

// HTTP Inspector
export {
  inspectHttpMediaHeaders,
  type HttpInspectionResult,
  type HttpInspectionOptions,
} from './utils/http-inspector.ts';
