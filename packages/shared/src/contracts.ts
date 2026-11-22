/**
 * MUXARO Media Processing Platform - API Contracts & Zod Schemas
 * 
 * Strict runtime validation schemas for all ingress requests and egress responses.
 * Provides end-to-end type safety between client, API gateway, and worker services.
 */

import { z } from 'zod';
import {
  USER_TIERS,
  TOOLS,
  LANES,
  JOB_STATUSES,
  JOB_STAGES,
  RETENTION_TIERS,
  AUDIO_BITRATES,
} from './types.js';

// =============================================================================
// 1. ANALYSE CONTRACTS
// =============================================================================

export const analyseRequestSchema = z.object({
  url: z.string().min(1, 'Media URL is required'),
  forceRefresh: z.boolean().default(false).optional(),
  poToken: z.string().optional(),
});
export type AnalyseRequest = z.infer<typeof analyseRequestSchema>;

export const mediaFormatSchema = z.object({
  formatId: z.string(),
  container: z.string(),
  resolution: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  fps: z.number().optional(),
  videoCodec: z.string().optional(),
  audioCodec: z.string().optional(),
  bitrate: z.number().optional(),
  filesize: z.number().optional(),
  hasVideo: z.boolean(),
  hasAudio: z.boolean(),
  url: z.string().optional(),
});
export type MediaFormat = z.infer<typeof mediaFormatSchema>;

export const playlistItemSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  durationSeconds: z.number().optional(),
  thumbnail: z.string().optional(),
  position: z.number().int().optional(),
});
export type PlaylistItemSummaryContract = z.infer<typeof playlistItemSummarySchema>;

export const analyseResponseSchema = z.object({
  platform: z.enum(['youtube', 'vimeo', 'direct']),
  id: z.string(),
  canonicalUrl: z.string(),
  title: z.string(),
  description: z.string().optional(),
  author: z.string().optional(),
  durationSeconds: z.number().nonnegative(),
  thumbnail: z.string().optional(),
  formats: z.array(mediaFormatSchema),
  isPlaylist: z.boolean().default(false),
  playlistItems: z.array(playlistItemSummarySchema).optional(),
  cached: z.boolean().default(false),
  inspectedAt: z.string(),
});
export type AnalyseResponse = z.infer<typeof analyseResponseSchema>;

// =============================================================================
// 2. JOBS CONTRACTS
// =============================================================================

export const createJobRequestSchema = z.object({
  tool: z.enum(TOOLS),
  sourceUrl: z.string().optional(),
  uploadSessionId: z.preprocess(
    (val) => (typeof val === 'string' && val.trim().length > 0 ? val.trim() : undefined),
    z.string().uuid().optional()
  ),
  targetFormat: z.string().min(1, 'Target format is required'),
  targetResolution: z.string().optional(),
  videoCodec: z.string().optional(),
  audioCodec: z.string().optional(),
  audioBitrate: z.enum(AUDIO_BITRATES).optional(),
  audioOffsetMs: z.number().int().default(0).optional(),
  secondaryAudioUrl: z.string().optional(),
  secondaryAudioSessionId: z.preprocess(
    (val) => (typeof val === 'string' && val.trim().length > 0 ? val.trim() : undefined),
    z.string().uuid().optional()
  ),
  normalizeAudio: z.boolean().default(false).optional(),
  ecoMode: z.boolean().default(true).optional(),
  idempotencyKey: z.string().min(1).max(128),
  lane: z.enum(LANES).optional(),
}).refine(
  (data: { sourceUrl?: string; uploadSessionId?: string }) => Boolean(data.sourceUrl || data.uploadSessionId),
  { message: 'Either sourceUrl or uploadSessionId must be provided', path: ['sourceUrl'] }
);
export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;

export const jobStatusSchema = z.enum(JOB_STATUSES);
export const jobStageSchema = z.enum(JOB_STAGES);

export const jobResponseSchema = z.object({
  id: z.string().uuid(),
  tool: z.enum(TOOLS),
  status: jobStatusSchema,
  lane: z.enum(LANES),
  priority: z.number().int(),
  progressPercent: z.number().min(0).max(100),
  stage: z.string(),
  stageMessage: z.string().optional(),
  downloadUrl: z.string().optional(),
  filename: z.string().optional(),
  sizeBytes: z.number().int().optional(),
  durationSeconds: z.number().optional(),
  retentionTier: z.enum(RETENTION_TIERS),
  expiresAt: z.string(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
});
export type JobResponse = z.infer<typeof jobResponseSchema>;

export const jobEventSchema = z.object({
  jobId: z.string().uuid(),
  status: jobStatusSchema,
  stage: z.string(),
  progressPercent: z.number().min(0).max(100),
  speed: z.string().optional(),
  etaSeconds: z.number().optional(),
  processedBytes: z.number().optional(),
  totalBytes: z.number().optional(),
  message: z.string().optional(),
  timestamp: z.string(),
});
export type JobEvent = z.infer<typeof jobEventSchema>;

// =============================================================================
// 3. UPLOAD CONTRACTS
// =============================================================================

export const uploadInitRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive('File size must be greater than 0'),
  mimeType: z.string().min(1),
  tool: z.enum(TOOLS),
  targetFormat: z.string().optional(),
});
export type UploadInitRequest = z.infer<typeof uploadInitRequestSchema>;

export const uploadInitResponseSchema = z.object({
  uploadSessionId: z.string().uuid(),
  storageKey: z.string(),
  chunkSize: z.number().int().positive(),
  totalChunks: z.number().int().positive(),
  retentionTier: z.enum(RETENTION_TIERS),
  expiresAt: z.string(),
});
export type UploadInitResponse = z.infer<typeof uploadInitResponseSchema>;

export const uploadPartsRequestSchema = z.object({
  uploadSessionId: z.string().uuid(),
  partNumbers: z.array(z.number().int().positive()).min(1).max(100),
});
export type UploadPartsRequest = z.infer<typeof uploadPartsRequestSchema>;

export const uploadPartsResponseSchema = z.object({
  uploadSessionId: z.string().uuid(),
  parts: z.array(
    z.object({
      partNumber: z.number().int().positive(),
      presignedUrl: z.string().url(),
    })
  ),
});
export type UploadPartsResponse = z.infer<typeof uploadPartsResponseSchema>;

export const uploadCompletePartSchema = z.object({
  partNumber: z.number().int().positive(),
  etag: z.string().min(1),
});

export const uploadCompleteRequestSchema = z.object({
  uploadSessionId: z.string().uuid(),
  parts: z.array(uploadCompletePartSchema).min(1),
});
export type UploadCompleteRequest = z.infer<typeof uploadCompleteRequestSchema>;

export const uploadCompleteResponseSchema = z.object({
  uploadSessionId: z.string().uuid(),
  storageKey: z.string(),
  sizeBytes: z.number().int().positive(),
  verified: z.boolean(),
  mimeType: z.string(),
});
export type UploadCompleteResponse = z.infer<typeof uploadCompleteResponseSchema>;

export const uploadAbortRequestSchema = z.object({
  uploadSessionId: z.string().uuid(),
});
export type UploadAbortRequest = z.infer<typeof uploadAbortRequestSchema>;

export const uploadAbortResponseSchema = z.object({
  uploadSessionId: z.string().uuid(),
  aborted: z.boolean(),
});
export type UploadAbortResponse = z.infer<typeof uploadAbortResponseSchema>;

// =============================================================================
// 4. DOWNLOAD CONTRACTS
// =============================================================================

export const downloadItemSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  filename: z.string(),
  sizeBytes: z.number().int(),
  mimeType: z.string(),
  container: z.string(),
  downloadUrl: z.string(),
  retentionTier: z.enum(RETENTION_TIERS),
  expiresAt: z.string(),
  remainingSeconds: z.number().int(),
  isExpired: z.boolean(),
  createdAt: z.string(),
});
export type DownloadItem = z.infer<typeof downloadItemSchema>;

export const downloadsListResponseSchema = z.object({
  downloads: z.array(downloadItemSchema),
  total: z.number().int(),
});
export type DownloadsListResponse = z.infer<typeof downloadsListResponseSchema>;

// =============================================================================
// 5. SERVICE STATUS & METRICS CONTRACTS
// =============================================================================

export const laneDepthSchema = z.object({
  waiting: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  delayed: z.number().int().nonnegative().optional(),
});

export const workerTelemetrySchema = z.object({
  workerId: z.string(),
  workerType: z.string(),
  activeJobs: z.number().int(),
  totalCompleted: z.number().int().optional(),
  totalFailed: z.number().int().optional(),
  cpuUsagePercent: z.number().optional(),
  memoryUsageMb: z.number().optional(),
  lastHeartbeat: z.string(),
});

export const circuitBreakerStatusSchema = z.object({
  state: z.enum(['CLOSED', 'OPEN', 'HALF_OPEN']),
  failureCount: z.number().int(),
  lastFailureTime: z.string().optional(),
  nextRetryTime: z.string().optional(),
});

export const serviceStatusResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'outage']),
  uptimeSeconds: z.number().nonnegative(),
  postgres: z.object({
    connected: z.boolean(),
    latencyMs: z.number().nonnegative(),
  }),
  redis: z.object({
    connected: z.boolean(),
    latencyMs: z.number().nonnegative(),
  }),
  queues: z.record(laneDepthSchema),
  workers: z.record(workerTelemetrySchema),
  circuitBreakers: z.record(circuitBreakerStatusSchema),
  timestamp: z.string(),
});
export type ServiceStatusResponse = z.infer<typeof serviceStatusResponseSchema>;

// =============================================================================
// 6. USAGE & LIMITS CONTRACTS
// =============================================================================

export const dailyUsageResponseSchema = z.object({
  subjectKey: z.string(),
  date: z.string(),
  tier: z.enum(USER_TIERS),
  jobsCount: z.number().int().nonnegative(),
  jobsLimit: z.number().int().nonnegative(),
  bandwidthBytes: z.number().int().nonnegative(),
  bandwidthLimitBytes: z.number().int().nonnegative(),
  concurrentActive: z.number().int().nonnegative(),
  concurrentLimit: z.number().int().nonnegative(),
});
export type DailyUsageResponse = z.infer<typeof dailyUsageResponseSchema>;
