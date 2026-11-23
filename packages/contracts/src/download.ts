/**
 * MUXARO Download Contract (/v1/download, /v1/jobs)
 * 
 * Strict schemas for initiating and responding to media downloads,
 * zero-hop client handovers, and media conversions.
 */

import { z } from 'zod';
import { type DeterministicStatusCode, statusCodeSchema } from './status-codes.js';
import { errorDetailSchema } from './errors.js';

// =============================================================================
// 1. Types & Enums
// =============================================================================

export const TARGET_CONTAINERS = [
  'mp4',
  'mkv',
  'webm',
  'mp3',
  'm4a',
  'flac',
  'wav',
  'opus',
] as const;
export type TargetContainer = (typeof TARGET_CONTAINERS)[number];
export const targetContainerSchema = z.enum(TARGET_CONTAINERS);

export const DOWNLOAD_OPERATIONS = [
  'download',
  'audio_extract',
  'merge',
  'transcode',
] as const;
export type DownloadOperation = (typeof DOWNLOAD_OPERATIONS)[number];

export const PIPELINE_JOB_STATUSES = [
  'queued',
  'fetching_metadata',
  'downloading_video',
  'downloading_audio',
  'merging',
  'converting',
  'ready',
  'failed',
  'cancelled',
] as const;
export type PipelineJobStatus = (typeof PIPELINE_JOB_STATUSES)[number];
export const pipelineJobStatusSchema = z.enum(PIPELINE_JOB_STATUSES);

// =============================================================================
// 2. Download Request Contract
// =============================================================================

export const downloadRequestSchema = z.object({
  url: z.string().trim().min(1, 'Source media URL is required'),
  targetFormat: targetContainerSchema.default('mp4'),
  targetResolution: z.string().trim().optional(),
  formatId: z.string().trim().optional(),
  videoFormatId: z.string().trim().optional(),
  audioFormatId: z.string().trim().optional(),
  title: z.string().trim().optional(),
  operation: z.enum(DOWNLOAD_OPERATIONS).default('download'),
  idempotencyKey: z.string().trim().max(128).optional(),
  deliveryMode: z.enum(['zero-hop', 'tunnel', 'worker']).optional(),
  poToken: z.string().trim().optional(),
});
export type DownloadRequest = z.infer<typeof downloadRequestSchema>;

// =============================================================================
// 3. Download Response Contract
// =============================================================================

export const downloadResponseSchema = z.object({
  jobId: z.string().min(1),
  status: statusCodeSchema,
  jobStatus: pipelineJobStatusSchema,
  stage: z.string().min(1),
  stageMessage: z.string().optional(),
  progressPercent: z.number().min(0).max(100).default(0),
  downloadUrl: z.string().optional(),
  directStreamUrl: z.string().optional(),
  deliveryMode: z.enum(['zero-hop', 'tunnel', 'worker']).default('worker'),
  filename: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  mimeType: z.string().optional(),
  expiresAt: z.string().optional(),
  createdAt: z.string().datetime().or(z.string()),
  error: errorDetailSchema.optional(),
});
export type DownloadResponse = z.infer<typeof downloadResponseSchema>;

// =============================================================================
// 4. Validators
// =============================================================================

export function validateDownloadRequest(data: unknown): {
  success: boolean;
  data?: DownloadRequest;
  error?: z.ZodError;
} {
  const result = downloadRequestSchema.safeParse(data);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: result.error };
}

export function validateDownloadResponse(data: unknown): {
  success: boolean;
  data?: DownloadResponse;
  error?: z.ZodError;
} {
  const result = downloadResponseSchema.safeParse(data);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: result.error };
}
