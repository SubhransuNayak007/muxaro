/**
 * Project MUXARO - Source Adapters Core Type Definitions
 * 
 * Defines standard interfaces for:
 * - SourceAdapter (contract for all media source plugins)
 * - MediaStream (individual video/audio/muxed streams)
 * - AudioTrack (discrete audio track representation)
 * - MediaManifest (unified inspection result consumed by API and Media Worker)
 * - RightsCheckResult (verifiable compliance and rights evaluation)
 * - RightsDeclaration (user-supplied ownership / licensing declaration)
 * - AbuseCheckResult (abuse and malicious payload detection)
 * - AdapterCapabilities (declared operational capabilities and restrictions)
 */

export type SourceType =
  | 'direct_media'
  | 'youtube_permitted'
  | 'youtube'
  | 'tiktok'
  | 'instagram'
  | 'twitter'
  | 'unsupported';

export type StreamType = 'video' | 'audio' | 'muxed';

export type ContainerFormat = 
  | 'mp4' 
  | 'webm' 
  | 'mkv' 
  | 'm4a' 
  | 'mp3' 
  | 'wav' 
  | 'flac' 
  | 'ogg' 
  | 'aac' 
  | 'unknown';

export type RightsStatus = 
  | 'permitted' 
  | 'restricted' 
  | 'forbidden' 
  | 'requires_authorization';

export type OwnershipType = 
  | 'user_created_content' 
  | 'licensed_permission' 
  | 'public_domain' 
  | 'creative_commons' 
  | 'third_party_copyright';

export type RightsPolicyCode = 
  | 'DIRECT_MEDIA_VERIFIED'
  | 'USER_OWNED_VERIFIED'
  | 'CREATIVE_COMMONS_VERIFIED'
  | 'PUBLIC_DOMAIN_VERIFIED'
  | 'LICENSED_PERMITTED'
  | 'PREVIEW_ONLY_PERMITTED'
  | 'STREAM_EXTRACTION_DISABLED_PLATFORM_POLICY'
  | 'UNAUTHORIZED_THIRD_PARTY_RESTRICTED'
  | 'MISSING_ATTESTATION'
  | 'ABUSE_SUSPECTED'
  | 'SSRF_BLOCKED'
  | 'MALFORMED_URL'
  | 'UNSUPPORTED_SOURCE';

/**
 * User-supplied rights declaration submitted with inspection or job request
 */
export interface RightsDeclaration {
  /** Legal category of media ownership/authorization */
  ownershipType: OwnershipType;
  /** Explicit confirmation that user holds rights or authorization */
  attestation: boolean;
  /** License type string (e.g. 'CC-BY-4.0', 'CC0', 'Direct-Owner') */
  licenseType?: string;
  /** URL to official license grant or public domain evidence */
  licenseUrl?: string;
  /** Free-form notes regarding the authorization */
  notes?: string;
  /** User identifier who submitted the declaration */
  declaredByUserId?: string;
  /** ISO timestamp when declared */
  declaredAt?: string;
}

/**
 * Result of a rights and policy compliance check
 */
export interface RightsCheckResult {
  /** Whether the media is permitted for processing */
  isPermitted: boolean;
  /** Categorized compliance status */
  status: RightsStatus;
  /** Standard machine-readable policy code */
  policyCode: RightsPolicyCode;
  /** Human-readable explanation of the rights evaluation */
  reason: string;
  /** Whether audiovisual stream extraction is authorized and supported */
  canExtractStreams: boolean;
  /** Whether video preview (e.g. embedded player) is allowed */
  canPreview: boolean;
  /** Whether creator attribution is legally required (e.g. CC-BY) */
  attributionRequired: boolean;
  /** Original rights declaration if provided */
  rightsDeclaration?: RightsDeclaration;
  /** Any non-fatal compliance warnings or caveats */
  warnings: string[];
  /** ISO timestamp of evaluation */
  checkedAt: string;
}

/**
 * Individual media stream (video track, audio track, or multiplexed stream)
 */
export interface MediaStream {
  /** Unique stream identifier within the manifest */
  id: string;
  /** Type of stream (video, audio, or muxed audio/video) */
  streamType: StreamType;
  /** Container format (e.g., 'mp4', 'webm') */
  container: ContainerFormat;
  /** Codec identifier (e.g. 'h264', 'vp9', 'av1', 'aac', 'opus') */
  codec?: string;
  /** Standard resolution label if video (e.g. '1920x1080', '3840x2160') */
  resolution?: string;
  /** Human-readable resolution label (e.g. '1080p (Full HD)', '720p (HD)') */
  resolutionLabel?: string;
  /** Video frame width in pixels */
  width?: number;
  /** Video frame height in pixels */
  height?: number;
  /** Frame rate in frames per second */
  fps?: number;
  /** Bitrate in bits per second if known */
  bitrateBps?: number;
  /** Exact stream byte size if known */
  contentLengthBytes?: number;
  /** Direct URL to stream if extractable */
  directUrl?: string;
  /** MIME type string (e.g. 'video/mp4') */
  mimeType: string;
  /** Whether this stream can be extracted under current policy */
  isStreamExtractable: boolean;
  /** Whether the stream requires remuxing to standard container */
  requiresRemux: boolean;
  /** Whether the stream requires transcoding for target output */
  requiresTranscode: boolean;
  /** Optional HTTP headers required to access stream */
  headers?: Record<string, string>;
}

/**
 * Audio track representation within a media manifest
 */
export interface AudioTrack {
  /** Unique audio track identifier */
  id: string;
  /** Audio codec (e.g. 'aac', 'opus', 'mp3', 'flac') */
  codec: string;
  /** Number of audio channels (1 = mono, 2 = stereo, 6 = 5.1 surround) */
  channels: number;
  /** Audio sample rate in Hertz (e.g. 44100, 48000) */
  sampleRateHz?: number;
  /** Audio bitrate in bits per second */
  bitrateBps?: number;
  /** Audio language code (ISO 639-1 or ISO 639-2, e.g. 'en', 'eng') */
  language?: string;
  /** Whether this is the default audio track */
  isDefault?: boolean;
  /** Byte length if known */
  contentLengthBytes?: number;
  /** Direct URL to audio stream if available */
  directUrl?: string;
  /** MIME type string (e.g. 'audio/mpeg', 'audio/mp4') */
  mimeType: string;
  /** Whether audio track is extractable */
  isExtractable: boolean;
}

/**
 * Unified media manifest representing complete inspected media asset
 */
export interface MediaManifest {
  /** Input URL provided by user */
  sourceUrl: string;
  /** Normalized canonical URL */
  canonicalUrl: string;
  /** Categorized source type */
  sourceType: SourceType;
  /** Title of the media asset */
  title: string;
  /** Author or creator name if discovered */
  author?: string;
  /** Link to author's profile or channel */
  authorUrl?: string;
  /** Direct URL to thumbnail image */
  thumbnailUrl?: string;
  /** Description or summary text */
  description?: string;
  /** Media duration in fractional seconds */
  durationSeconds?: number;
  /** Total file size in bytes if known */
  filesizeBytes?: number;
  /** Media container format */
  container: ContainerFormat;
  /** Primary MIME type */
  mimeType?: string;
  /** Available streams discovered during inspection */
  streams: MediaStream[];
  /** Audio tracks discovered during inspection */
  audioTracks: AudioTrack[];
  /** Comprehensive rights and policy compliance evaluation */
  rights: RightsCheckResult;
  /** High-level flag whether any stream can be extracted */
  canExtractStreams: boolean;
  /** Explicit notice stating the extraction policy applied */
  extractionPolicyNotice: string;
  /** URL for permitted direct preview */
  previewUrl?: string;
  /** Safe embedded iframe HTML for permitted preview */
  embedHtml?: string;
  /** Raw adapter-specific metadata */
  metadata: Record<string, unknown>;
  /** ISO timestamp of inspection */
  inspectedAt: string;
}

/**
 * Result of abuse and anomaly detection
 */
export interface AbuseCheckResult {
  /** Whether the URL or payload exhibits suspicious patterns */
  isSuspicious: boolean;
  /** Anomaly risk score from 0 (clean) to 100 (critical threat) */
  riskScore: number;
  /** Specific threat flags triggered */
  flags: string[];
  /** Whether the request must be blocked immediately */
  blocked: boolean;
  /** Human-readable explanation if blocked */
  reason?: string;
}

/**
 * Declared capabilities and constraints of an adapter
 */
export interface AdapterCapabilities {
  /** Whether the adapter can extract audiovisual streams */
  canExtractMedia: boolean;
  /** Whether the adapter can inspect and return metadata */
  canFetchMetadata: boolean;
  /** Whether the adapter can provide preview functionality */
  canGeneratePreview: boolean;
  /** Whether user rights attestation is mandatory before inspection */
  requiresRightsAttestation: boolean;
  /** List of container formats supported by the adapter */
  supportedContainers: readonly ContainerFormat[];
  /** Human-readable statement of legal and policy compliance */
  complianceNotes: string;
}

/**
 * Options passed to adapter inspection
 */
export interface InspectOptions {
  /** Overall operation timeout in milliseconds (default: 8000) */
  timeoutMs?: number;
  /** Optional user rights declaration */
  rightsDeclaration?: RightsDeclaration;
  /** Max HTTP redirects to follow safely (default: 3) */
  maxRedirects?: number;
  /** User-Agent header to send with requests */
  userAgent?: string;
  /** Additional HTTP headers */
  customHeaders?: Record<string, string>;
  /** Optional custom SSRF validator hook */
  ssrfValidator?: (url: string) => Promise<{ isSafe: boolean; override?: boolean; reason?: string }>;
}

/**
 * Core Source Adapter contract that all source integrations must implement
 */
export interface SourceAdapter {
  /** Unique name of the adapter */
  readonly name: string;
  /** Protocols handled (e.g. ['http:', 'https:']) */
  readonly supportedProtocols: readonly string[];
  /** Check if this adapter can handle the given URL */
  canHandle(url: string): boolean;
  /** Inspect media URL and produce standard MediaManifest */
  inspect(url: string, options?: InspectOptions): Promise<MediaManifest>;
  /** Evaluate rights and policy compliance for URL */
  checkRights(url: string, declaration?: RightsDeclaration): Promise<RightsCheckResult>;
  /** Return capabilities and compliance metadata */
  getCapabilities(): AdapterCapabilities;
}
