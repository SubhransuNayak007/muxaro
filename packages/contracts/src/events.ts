/**
 * MUXARO Real-Time Job Progress SSE Contract (/v1/jobs/:id/events)
 * 
 * Strict schemas for Server-Sent Events (SSE) telemetry:
 * status, progress, speed, stage, ETA, and download artifacts.
 */

import { z } from 'zod';
import { errorDetailSchema } from './errors.js';

// =============================================================================
// 1. SSE Progress Payload Schema
// =============================================================================

export const sseStatusSchema = z.enum([
  'QUEUED',
  'PROCESSING',
  'DOWNLOADING',
  'MERGING',
  'CONVERTING',
  'READY',
  'FAILED',
  'CANCELLED',
]);
export type SseJobStatus = z.infer<typeof sseStatusSchema>;

export const jobArtifactSchema = z.object({
  filename: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  durationSeconds: z.number().nonnegative().optional(),
});
export type JobArtifact = z.infer<typeof jobArtifactSchema>;

export const jobProgressEventSchema = z.object({
  jobId: z.string().min(1),
  status: sseStatusSchema,
  stage: z.string().min(1), // e.g. "METADATA", "DOWNLOADING_VIDEO", "MERGING", "READY"
  stageMessage: z.string().optional(),
  progress: z.number().min(0).max(100),
  speed: z.string().optional(), // e.g. "12.8 MB/s" or "Complete"
  speedBytesPerSec: z.number().nonnegative().optional(),
  etaSeconds: z.number().nonnegative().optional(),
  processedBytes: z.number().int().nonnegative().optional(),
  totalBytes: z.number().int().nonnegative().optional(),
  downloadUrl: z.string().optional(),
  artifact: jobArtifactSchema.optional(),
  error: errorDetailSchema.optional(),
  timestamp: z.string().datetime().or(z.string()).default(() => new Date().toISOString()),
});
export type JobProgressEvent = z.infer<typeof jobProgressEventSchema>;

// =============================================================================
// 2. SSE Serialization & Parsing Helpers
// =============================================================================

/**
 * Formats a typed JobProgressEvent into a standard Server-Sent Event stream packet.
 */
export function formatSseEvent(event: JobProgressEvent): string {
  return `event: progress\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Formats an SSE keep-alive heartbeat packet.
 */
export function formatSseHeartbeat(): string {
  return `: ping\n\n`;
}

/**
 * Parses raw SSE payload into typed JobProgressEvent.
 */
export function parseSseEvent(raw: string): JobProgressEvent | null {
  try {
    const lines = raw.trim().split('\n');
    let dataStr = '';
    for (const line of lines) {
      if (line.startsWith('data:')) {
        dataStr = line.replace(/^data:\s*/, '').trim();
      }
    }
    if (!dataStr) return null;
    const parsed = JSON.parse(dataStr);
    const result = jobProgressEventSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function validateJobEvent(data: unknown): {
  success: boolean;
  data?: JobProgressEvent;
  error?: z.ZodError;
} {
  const result = jobProgressEventSchema.safeParse(data);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: result.error };
}
