/**
 * MUXARO Media Processing Platform - Shared Core Types
 * 
 * Strict TypeScript domain models, constants, and lookup maps across the MUXARO platform.
 * Covers user tiers, processing tools, execution lanes, job lifecycles, artifact retentions,
 * audio/video codecs, container formats, and telemetry data models.
 */

// =============================================================================
// 1. USER TIERS & CAPACITIES
// =============================================================================

export const USER_TIERS = ['guest', 'free_account', 'pro'] as const;
export type UserTier = (typeof USER_TIERS)[number];

export interface TierLimits {
  readonly tier: UserTier;
  readonly retentionTier: RetentionTier;
  readonly retentionSeconds: number;
  readonly maxConcurrentJobs: number;
  readonly dailyJobLimit: number;
  readonly maxUploadSizeBytes: number;
  readonly allowedTools: readonly ToolType[];
  readonly priorityWeight: number;
  readonly maxPlaylistItems: number;
}

export const TIER_CONFIGS: Record<UserTier, TierLimits> = {
  guest: {
    tier: 'guest',
    retentionTier: '60m',
    retentionSeconds: 3600,
    maxConcurrentJobs: 10,
    dailyJobLimit: 100, // 100 credits for guest
    maxUploadSizeBytes: 524_288_000, // 500 MB
    allowedTools: ['convert_video', 'extract_audio', 'merge_av'],
    priorityWeight: 5,
    maxPlaylistItems: 0, // Playlists disabled for unauthenticated guests
  },
  free_account: {
    tier: 'free_account',
    retentionTier: '24h',
    retentionSeconds: 86400,
    maxConcurrentJobs: 10,
    dailyJobLimit: 100,
    maxUploadSizeBytes: 2_147_483_648, // 2 GB
    allowedTools: ['convert_video', 'extract_audio', 'merge_av', 'batch_playlist'],
    priorityWeight: 10,
    maxPlaylistItems: 10,
  },
  pro: {
    tier: 'pro',
    retentionTier: '24h',
    retentionSeconds: 86400,
    maxConcurrentJobs: 5,
    dailyJobLimit: 100,
    maxUploadSizeBytes: 4_294_967_296, // 4 GB
    allowedTools: ['convert_video', 'extract_audio', 'merge_av', 'batch_playlist'],
    priorityWeight: 20,
    maxPlaylistItems: 50,
  },
};

// =============================================================================
// 2. TOOLS & OPERATIONS
// =============================================================================

export const TOOLS = [
  'convert_video',
  'extract_audio',
  'merge_av',
  'batch_playlist',
] as const;
export type ToolType = (typeof TOOLS)[number];

export interface ToolDefinition {
  readonly id: ToolType;
  readonly name: string;
  readonly description: string;
  readonly requiresSourceUrlOrUpload: boolean;
  readonly supportsAudioOffset: boolean;
  readonly defaultLane: LaneType;
}

export const TOOL_DEFINITIONS: Record<ToolType, ToolDefinition> = {
  convert_video: {
    id: 'convert_video',
    name: 'Convert Video',
    description: 'Lossless remux or ultra-fast transcode to MP4, MKV, WebM, MOV',
    requiresSourceUrlOrUpload: true,
    supportsAudioOffset: false,
    defaultLane: 'fast_io',
  },
  extract_audio: {
    id: 'extract_audio',
    name: 'Extract Audio',
    description: 'Direct stream copy or high-quality encode to MP3, FLAC, WAV, AAC, Opus',
    requiresSourceUrlOrUpload: true,
    supportsAudioOffset: false,
    defaultLane: 'fast_io',
  },
  merge_av: {
    id: 'merge_av',
    name: 'Merge Video & Audio',
    description: 'Multiplex separate video and audio streams with millisecond sync offset',
    requiresSourceUrlOrUpload: true,
    supportsAudioOffset: true,
    defaultLane: 'transcode',
  },
  batch_playlist: {
    id: 'batch_playlist',
    name: 'Batch & Playlist Archiver',
    description: 'Process whole playlists or item lists and stream into a STORE-mode ZIP archive',
    requiresSourceUrlOrUpload: true,
    supportsAudioOffset: false,
    defaultLane: 'batch',
  },
};

// =============================================================================
// 3. PROCESSING LANES & QUEUES
// =============================================================================

export const LANES = ['fast_io', 'transcode', 'batch'] as const;
export type LaneType = (typeof LANES)[number];

export const LANE_QUEUES = {
  fast_io: 'lane:fast-io',
  transcode: 'lane:transcode',
  batch: 'lane:batch',
  analyse: 'lane:analyse',
} as const;

export type LaneQueueName = (typeof LANE_QUEUES)[keyof typeof LANE_QUEUES];

export interface LaneConcurrencyBudget {
  readonly lane: LaneType;
  readonly minConcurrency: number;
  readonly maxConcurrency: number;
  readonly defaultTimeoutMs: number;
  readonly maxMemoryMb: number;
}

export const LANE_BUDGETS: Record<LaneType, LaneConcurrencyBudget> = {
  fast_io: {
    lane: 'fast_io',
    minConcurrency: 8,
    maxConcurrency: 16,
    defaultTimeoutMs: 300_000, // 5 minutes
    maxMemoryMb: 512,
  },
  transcode: {
    lane: 'transcode',
    minConcurrency: 2,
    maxConcurrency: 6,
    defaultTimeoutMs: 1_200_000, // 20 minutes
    maxMemoryMb: 2048,
  },
  batch: {
    lane: 'batch',
    minConcurrency: 2,
    maxConcurrency: 4,
    defaultTimeoutMs: 3_600_000, // 60 minutes
    maxMemoryMb: 1024,
  },
};

// =============================================================================
// 4. JOB STATUSES & STAGES
// =============================================================================

export const JOB_STATUSES = [
  'pending',
  'queued',
  'processing',
  'completed',
  'failed',
  'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STAGES = [
  'queued',
  'analysing',
  'downloading',
  'inspecting',
  'remuxing',
  'encoding',
  'packaging',
  'uploading',
  'verifying',
  'ready',
  'failed',
  'aborted',
] as const;
export type JobStage = (typeof JOB_STAGES)[number];

export interface JobProgressEvent {
  readonly jobId: string;
  readonly status: JobStatus;
  readonly stage: JobStage;
  readonly progressPercent: number; // 0.00 to 100.00
  readonly speed?: string;          // e.g. "2.4x" or "14.2MB/s"
  readonly etaSeconds?: number;
  readonly processedBytes?: number;
  readonly totalBytes?: number;
  readonly message?: string;
  readonly timestamp: string;       // ISO 8601 UTC
}

// =============================================================================
// 5. ARTIFACT RETENTION TIERS
// =============================================================================

export const RETENTION_TIERS = ['60m', '24h'] as const;
export type RetentionTier = (typeof RETENTION_TIERS)[number];

export const RETENTION_SECONDS: Record<RetentionTier, number> = {
  '60m': 3600,
  '24h': 86400,
};

export const RETENTION_MINUTES: Record<RetentionTier, number> = {
  '60m': 60,
  '24h': 1440,
};

export const RETENTION_PREFIXES: Record<RetentionTier, string> = {
  '60m': 'outputs/60m/',
  '24h': 'outputs/24h/',
};

// =============================================================================
// 6. AUDIO BITRATES & ENCODING OPTIONS
// =============================================================================

export const AUDIO_BITRATES = ['128k', '192k', '256k', '320k'] as const;
export type AudioBitrate = (typeof AUDIO_BITRATES)[number];

export const AUDIO_BITRATE_NUMBERS: Record<AudioBitrate, number> = {
  '128k': 128_000,
  '192k': 192_000,
  '256k': 256_000,
  '320k': 320_000,
};

// =============================================================================
// 7. CONTAINER FORMATS & EXTENSIONS
// =============================================================================

export const CONTAINERS_VIDEO = ['mp4', 'mkv', 'webm', 'mov'] as const;
export type VideoContainer = (typeof CONTAINERS_VIDEO)[number];

export const CONTAINERS_AUDIO = [
  'mp3',
  'flac',
  'wav',
  'aac',
  'm4a',
  'opus',
] as const;
export type AudioContainer = (typeof CONTAINERS_AUDIO)[number];

export const CONTAINERS = [
  ...CONTAINERS_VIDEO,
  ...CONTAINERS_AUDIO,
] as const;
export type ContainerFormat = (typeof CONTAINERS)[number];

export const CONTAINER_MIME_TYPES: Record<ContainerFormat, string> = {
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  opus: 'audio/opus',
};

// =============================================================================
// 8. STREAM & ANALYSIS MODELS
// =============================================================================

export type MediaPlatform = 'youtube' | 'vimeo' | 'direct';

export interface MediaStreamInfo {
  readonly index: number;
  readonly codecName: string;
  readonly codecType: 'video' | 'audio' | 'subtitle' | 'data';
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
  readonly bitrate?: number;
  readonly channels?: number;
  readonly sampleRate?: number;
  readonly channelLayout?: string;
  readonly isDefault?: boolean;
}

export interface MediaFormatInfo {
  readonly formatId: string;
  readonly container: string;
  readonly resolution?: string;
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
  readonly videoCodec?: string;
  readonly audioCodec?: string;
  readonly bitrate?: number;
  readonly filesize?: number;
  readonly hasVideo: boolean;
  readonly hasAudio: boolean;
  readonly url?: string;
}

export interface PlaylistItemSummary {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly durationSeconds?: number;
  readonly thumbnail?: string;
  readonly position?: number;
}

export interface MediaAnalysisResult {
  readonly platform: MediaPlatform;
  readonly id: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly description?: string;
  readonly author?: string;
  readonly durationSeconds: number;
  readonly thumbnail?: string;
  readonly formats: readonly MediaFormatInfo[];
  readonly isPlaylist: boolean;
  readonly playlistItems?: readonly PlaylistItemSummary[];
  readonly cached?: boolean;
  readonly inspectedAt: string;
}

// =============================================================================
// 9. UPLOAD & MULTIPART MODELS
// =============================================================================

export const UPLOAD_STATUSES = [
  'initiated',
  'uploading',
  'completed',
  'aborted',
  'expired',
] as const;
export type UploadSessionStatus = (typeof UPLOAD_STATUSES)[number];

export interface UploadPartRecord {
  readonly partNumber: number;
  readonly etag: string;
  readonly sizeBytes: number;
  readonly uploadedAt: string;
}

// =============================================================================
// 10. SYSTEM TELEMETRY, HEALTH & CIRCUIT BREAKERS
// =============================================================================

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerTelemetry {
  readonly serviceName: string;
  readonly state: CircuitState;
  readonly failureCount: number;
  readonly lastFailureTime?: string;
  readonly nextRetryTime?: string;
}

export interface WorkerTelemetry {
  readonly workerId: string;
  readonly workerType: 'media' | 'analyse';
  readonly host: string;
  readonly pid: number;
  readonly activeJobs: number;
  readonly totalCompleted: number;
  readonly totalFailed: number;
  readonly cpuUsagePercent?: number;
  readonly memoryUsageMb?: number;
  readonly lastHeartbeat: string;
}

export interface LaneDepth {
  readonly waiting: number;
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly delayed: number;
}
