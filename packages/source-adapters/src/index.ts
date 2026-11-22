/**
 * Project Garuda / Muxaro - Source Adapters Package
 * 
 * Production TypeScript module providing:
 * - SourceAdapter, MediaStream, AudioTrack, MediaManifest, RightsCheckResult
 * - YouTubeAdapter / YouTubeSourceAdapter (Innertube multi-client fallback: TVHTML5_SIMPLY_EMBEDDED, IOS, WEB)
 * - YouTubePermittedAdapter (Dual-mode: Permitted inspection and Active streaming manifest resolution)
 * - DirectMediaAdapter (MP4, MKV, WebM, MP3, WAV, FLAC, M4A)
 * - StreamingManifestResolver (Resolves 4K, 1440p, 1080p, 720p, 480p, Opus, AAC direct CDN streams)
 * - IPv6Rotator (Outbound /64 subnet rotation and socket binding)
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
  YouTubeAdapter,
  YouTubeSourceAdapter,
  type YouTubeAdapterOptions,
} from './youtube-adapter.ts';
export {
  YouTubePermittedAdapter,
  type YouTubePermittedAdapterOptions,
  type YouTubeOEmbedResponse,
} from './youtube-permitted-adapter.ts';
export {
  TikTokAdapter,
  type TikTokAdapterOptions,
} from './tiktok-adapter.ts';
export {
  InstagramAdapter,
  type InstagramAdapterOptions,
} from './instagram-adapter.ts';
export {
  TwitterAdapter,
  type TwitterAdapterOptions,
} from './twitter-adapter.ts';

// Innertube Multi-Client Matrix
export {
  InnertubeClientMatrix,
  INNERTUBE_CLIENT_PROFILES,
  computeSapisidHash,
  buildPlayerRequestBody,
  buildPlayerRequestHeaders,
  type InnertubeClientProfile,
  type InnertubeRequestOptions,
  type InnertubeClientExecutionResult,
} from './innertube-client-matrix.ts';

// n-sig Throttling Parameter AST Solver
export {
  NSigSolver,
  NSigInterpreter,
  NSigExtractor,
  type NSigOpCode,
  type NSigDecipherPlan,
} from './n-sig-solver.ts';

// PoToken & BotGuard Pool Manager
export {
  PoTokenPool,
  type PoTokenRecord,
  type PoTokenLease,
  type PoTokenPoolOptions,
} from './potoken-pool.ts';

// Streaming Manifest Resolver
export {
  StreamingManifestResolver,
  type RawInnertubeFormat,
  type RawInnertubeStreamingData,
  type ParsedMimeInfo,
  type StreamingManifestResolution,
} from './utils/streaming-manifest-resolver.ts';

// Outbound IPv6 /64 Rotator
export {
  IPv6Rotator,
  Ipv6Rotator,
  type IPv6RotatorConfig,
  type IPv6SubnetInfo,
  expandIPv6,
  parseIPv6Subnet,
  isValidIPv6Subnet,
  generateRandomIPv6,
  RotatingIPv6HttpsAgent,
  defaultIPv6Rotator,
  getRandomIpv6Address,
  fetchWithIpv6Rotation,
} from './utils/ipv6-rotator.ts';

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
