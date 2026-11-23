/**
 * Project MUXARO - API Domain Types and Request/Response Envelopes
 * Tagline: "Your Media. One Powerful Workspace."
 * Strict adherence to docs/MASTER_PRD.md and docs/architecture/openapi.yaml
 */

export interface ApiResponse<T = unknown> {
  success: true;
  data: T;
  requestId: string;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  userMessage?: string;
  details?: Record<string, unknown> | null;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorDetail;
  requestId: string;
}

export type ProcessingLane = 'instant' | 'smart' | 'power';

export type PriorityTier = 'PREMIUM' | 'REGISTERED' | 'GUEST';

export type QueueClass =
  | 'instant-processing'
  | 'audio-processing'
  | 'merge-processing'
  | 'video-transcoding'
  | 'high-resolution-processing'
  | 'playlist-packaging';

export type JobStatus =
  | 'CREATED'
  | 'VALIDATING'
  | 'QUEUED'
  | 'PROCESSING'
  | 'VERIFYING'
  | 'READY'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED';

export type JobOperation =
  | 'EXTRACT_AUDIO'
  | 'REMUX_STREAM_COPY'
  | 'TRANSCODE_VIDEO'
  | 'CONVERT_FORMAT'
  | 'MERGE_AUDIO_VIDEO'
  | 'PLAYLIST_BATCH';

export interface MediaStreamItem {
  index: number;
  formatId?: string;
  type: 'VIDEO' | 'AUDIO' | 'SUBTITLE';
  codec: string;
  width?: number;
  height?: number;
  resolution?: string;
  bitrate?: number;
  fps?: number;
  hdr?: boolean;
  estimatedSizeBytes?: number;
  sizeIsEstimate?: boolean;
  recommended?: boolean;
  sampleRate?: number;
  channels?: number;
  isNativeLossless?: boolean;
  mimeType?: string;
  isExtractable?: boolean;
}

export interface MediaAssetInfo {
  assetId: string;
  url: string;
  title: string;
  author?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  fileSizeBytes?: number;
  container: string;
  isLocalUpload?: boolean;
  localFilePath?: string;
  streams: MediaStreamItem[];
  availableFormats: {
    videoResolutions: string[];
    audioFormats: string[];
  };
  rightsCheck: {
    isPermitted: boolean;
    policyCode: string;
    canExtractStreams: boolean;
    canPreview: boolean;
    reason: string;
    warnings: string[];
  };
  inspectedAt: string;
}

export interface CreateJobInput {
  jobId?: string;
  mediaAssetId?: string;
  mediaUrl?: string;
  sourceUrl?: string;
  localFilePath?: string;
  batchId?: string;
  itemNumber?: string;
  operation: JobOperation;
  targetFormat: string;
  targetResolution?: string;
  targetAudioCodec?: string;
  title?: string;
  streamCopy?: boolean;
  formatId?: string;
  idempotencyKey: string;
  userId?: string;
  ownerTier?: PriorityTier;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export interface MergeJobInput {
  jobId?: string;
  videoAssetId?: string;
  videoUrl?: string;
  audioAssetId?: string;
  audioUrl?: string;
  targetFormat: string;
  audioOffsetMs?: number;
  idempotencyKey: string;
  title?: string;
  userId?: string;
  ownerTier?: PriorityTier;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export interface JobOutputArtifact {
  artifactId: string;
  ownerUserId?: string;
  filePath?: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  container: string;
  codec?: string;
  durationSeconds?: number;
  checksumSha256?: string;
  downloadUrl?: string;
  expiresAt?: string;
}

export interface JobRecord {
  jobId: string;
  ownerUserId: string;
  ownerTier?: PriorityTier;
  priorityWeight?: number;
  batchId?: string;
  itemNumber?: string;
  requestId?: string;
  operation: JobOperation;
  status: JobStatus;
  progress: number; // 0 - 100
  stage?: string;
  stageMessage?: string;
  inputTitle?: string;
  mediaAssetId?: string;
  mediaUrl?: string;
  localFilePath?: string;
  audioUrl?: string;
  audioOffsetMs?: number;
  targetFormat: string;
  targetResolution?: string;
  targetAudioCodec?: string;
  streamCopy?: boolean;
  formatId?: string;
  processingLane?: ProcessingLane;
  queueClass?: QueueClass;
  strategyLabel?: string;
  losslessPreserved?: boolean;
  retentionMinutes?: number;
  queuedAt?: string;
  startedAt?: string;
  queueWaitMs?: number;
  processingMs?: number;
  idempotencyKey: string;
  reservationId?: string;
  artifact?: JobOutputArtifact;
  downloadUrl?: string;
  error?: {
    code: string;
    message: string;
    userMessage?: string;
    details?: unknown;
  } | null;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  expiresAt?: string;
}

export interface JobProgressEvent {
  jobId: string;
  status: JobStatus;
  progress: number;
  stage: string;
  message?: string;
  processingLane?: ProcessingLane;
  queueClass?: QueueClass;
  strategyLabel?: string;
  losslessPreserved?: boolean;
  retentionMinutes?: number;
  downloadUrl?: string;
  artifact?: JobOutputArtifact;
  error?: {
    code: string;
    message: string;
    userMessage?: string;
  };
  timestamp: string;
}

export interface PlaylistInspectItem {
  position: number;
  title: string;
  url: string;
  durationSeconds?: number;
}

export interface PlaylistManifest {
  title: string;
  sourceUrl: string;
  totalItems: number;
  items: PlaylistInspectItem[];
}

export interface PlaylistJobItemStatus {
  position: number;
  title: string;
  url: string;
  status: 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED' | 'CANCELLED';
  downloadUrl?: string | null;
  filename?: string | null;
  sizeBytes?: number | null;
  error?: string | null;
}

export interface PlaylistJobRecord {
  playlistJobId: string;
  ownerUserId: string;
  title: string;
  sourceUrl: string;
  status: 'CREATED' | 'QUEUED' | 'PROCESSING' | 'PACKAGING' | 'COMPLETED' | 'PARTIAL_FAILURE' | 'FAILED' | 'CANCELLED';
  processingLane?: ProcessingLane;
  queueClass?: QueueClass;
  retentionMinutes?: number;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  cancelledItems: number;
  progress: number;
  items?: PlaylistJobItemStatus[];
  zipDownloadUrl?: string | null;
  zipFilePath?: string;
  zipFilename?: string;
  zipSizeBytes?: number;
  error?: string | null;
  reservationId?: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface SignedDownloadTokenPayload {
  jobId: string;
  artifactId: string;
  filename: string;
  userId: string;
  expiresAt: number;
}
