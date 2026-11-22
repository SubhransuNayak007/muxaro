/**
 * MUXARO Media Processing Platform - Worker Types & Queue Job Payloads
 * 
 * Defines strict TypeScript contracts for multi-lane media processing,
 * streaming pipelines, batch ZIP packaging, and delayed artifact cleanup.
 */

import type {
  ToolType,
  LaneType,
  RetentionTier,
  AudioBitrate,
  ContainerFormat,
  JobStatus,
  JobStage,
} from '@muxaro/shared';

// =============================================================================
// 1. MEDIA JOB DATA (lane:fast-io & lane:transcode)
// =============================================================================

export interface MediaJobPayload {
  readonly jobId: string;
  readonly userId?: string | null;
  readonly guestIpHash?: string | null;
  readonly tool: ToolType;
  readonly lane: LaneType;
  readonly sourceUrl?: string;
  readonly uploadSessionId?: string;
  readonly inputStorageKey?: string;
  readonly targetFormat: ContainerFormat;
  readonly targetResolution?: string;
  readonly videoCodec?: string;
  readonly audioCodec?: string;
  readonly audioBitrate?: AudioBitrate;
  readonly audioOffsetMs?: number;
  readonly secondaryAudioUrl?: string;
  readonly secondaryAudioSessionId?: string;
  readonly normalizeAudio?: boolean;
  readonly ecoMode?: boolean;
  readonly retentionTier: RetentionTier;
  readonly idempotencyKey?: string;
  readonly priority?: number;
  readonly totalDurationSeconds?: number;
  readonly title?: string;
  readonly subjectKey?: string;
}

// =============================================================================
// 2. BATCH & PLAYLIST JOB DATA (lane:batch)
// =============================================================================

export interface BatchItemInput {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly targetFormat: ContainerFormat;
  readonly filename?: string;
  readonly durationSeconds?: number;
  readonly audioBitrate?: AudioBitrate;
}

export interface BatchJobPayload {
  readonly jobId: string;
  readonly userId?: string | null;
  readonly guestIpHash?: string | null;
  readonly subjectKey?: string;
  readonly tool: 'batch_playlist';
  readonly lane: 'batch';
  readonly retentionTier: RetentionTier;
  readonly title?: string;
  readonly playlistUrl?: string;
  readonly items: readonly BatchItemInput[];
  readonly ecoMode?: boolean;
}

// =============================================================================
// 3. CLEANUP JOB DATA (queue: cleanup)
// =============================================================================

export interface CleanupJobPayload {
  readonly jobId: string;
  readonly storageKey: string;
  readonly retentionTier: RetentionTier;
  readonly userId?: string | null;
  readonly expiresAt?: string;
}

// =============================================================================
// 4. PIPELINE RESULT & EXECUTION TELEMETRY
// =============================================================================

export interface PipelineProcessingResult {
  readonly success: boolean;
  readonly jobId: string;
  readonly storageKey: string;
  readonly publicUrl?: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly durationSeconds: number;
  readonly isStreamCopy: boolean;
  readonly processingTimeMs: number;
  readonly computeSavedWh?: number;
  readonly co2SavedGrams?: number;
}

export interface BatchPackagingResult {
  readonly success: boolean;
  readonly jobId: string;
  readonly storageKey: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly totalEntries: number;
  readonly processingTimeMs: number;
}
