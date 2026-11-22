/**
 * Project MUXARO - Persistent SQLite-Backed TurboFlow 6-Class + 3-Tier Priority Queue Service
 *
 * Implements:
 * - Persistent storage of `processing_jobs`, `job_events`, and `output_artifacts` in SQLite
 * - `MXJ-XXXXXXXXXX` job IDs + `MXB-...` batch association with `001`/`002`/`003` item numbering
 * - 6 isolated queue classes with independent concurrency caps
 * - 3-Tier Fair Priority Scheduling: PREMIUM (weight 6) > REGISTERED (weight 3) > GUEST (weight 1)
 *   with anti-starvation aging boost (+1 weight / 5s waited, cap +12) and per-tier concurrency caps
 * - Per-tier wait & processing p50/p95 telemetry
 * - Real yt-dlp + ffmpeg + ffprobe execution and 60-min artifact TTL cleanup
 */

import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  JobRecord,
  JobStatus,
  JobOperation,
  JobProgressEvent,
  JobOutputArtifact,
  CreateJobInput,
  MergeJobInput,
  ProcessingLane,
  PriorityTier,
  QueueClass,
} from '../types/index.js';
import { validateUrlForSsrf, sanitizeFilename, validateSafePath } from '@vyro/security';
import { deriveTitleFromUrl } from '@vyro/source-adapters';
import { getDb, getNumericSetting, recordAnalyticsEvent } from '../db/database.js';
import { generateJobId, generatePrefixedId } from './id.service.js';
import { tokenService } from './token.service.js';
import { entitlementsService } from './entitlements.service.js';
import { adapterService, UPLOADS_ROOT } from './adapter.service.js';
import {
  DEFAULT_RETENTION_MINUTES,
  mapHumanFriendlyError,
  parseResolutionHeight,
  selectTurboFlowStrategy,
  getYtDlpBaseArgs as getTurboYtDlpBaseArgs,
  isBotVerificationError,
} from './turboflow.service.js';

const execFileAsync = promisify(execFile);

export const ARTIFACTS_ROOT = path.resolve(process.cwd(), '.muxaro-artifacts');
const ARTIFACT_TTL_MS = DEFAULT_RETENTION_MINUTES * 60 * 1000;
const PROCESS_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TOTAL_QUEUED = 200;

export const TIER_PRIORITY_WEIGHTS: Record<PriorityTier, number> = {
  PREMIUM: 6,
  REGISTERED: 3,
  GUEST: 1,
};

export const ANTI_STARVATION_AGING_STEP_MS = 5000; // +1 priority weight per 5s waited
export const ANTI_STARVATION_MAX_BOOST = 12;

export const QUEUE_CLASSES: readonly QueueClass[] = [
  'instant-processing',
  'audio-processing',
  'merge-processing',
  'video-transcoding',
  'high-resolution-processing',
  'playlist-packaging',
] as const;

const QUEUE_CLASS_CAPS: Record<QueueClass, number> = {
  'instant-processing': 4,
  'audio-processing': 4,
  'merge-processing': 2,
  'video-transcoding': 2,
  'high-resolution-processing': 1,
  'playlist-packaging': 1,
};

const AUDIO_FORMATS = new Set(['mp3', 'm4a', 'aac', 'flac', 'wav', 'opus']);
const VIDEO_FORMATS = new Set(['mp4', 'mkv', 'webm']);
const IGNORED_EXTENSIONS = new Set([
  '.part',
  '.ytdl',
  '.tmp',
  '.temp',
  '.json',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.description',
  '.vtt',
  '.srt',
]);

const MIME_TYPE_MAP: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  opus: 'audio/opus',
  ogg: 'audio/ogg',
  zip: 'application/zip',
};

export function getMimeTypeForExtension(ext: string): string {
  const normalized = ext.toLowerCase().replace(/^\./, '').trim();
  return MIME_TYPE_MAP[normalized] || 'application/octet-stream';
}

function normalizeTargetExtension(rawFormat: string | undefined, isAudio: boolean): string {
  const cleaned = (rawFormat || '').toLowerCase().trim().replace(/^\./, '');
  if (isAudio) {
    if (AUDIO_FORMATS.has(cleaned)) return cleaned;
    return 'mp3';
  }
  if (VIDEO_FORMATS.has(cleaned)) return cleaned;
  return 'mp4';
}

function stripInternalArtifactFields(artifact?: JobOutputArtifact): JobOutputArtifact | undefined {
  if (!artifact) return undefined;
  const { filePath: _internalPath, ...publicArtifact } = artifact;
  return publicArtifact;
}

function computePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1));
  return Math.round(sorted[idx]);
}

async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

interface ProbeVerificationResult {
  durationSeconds?: number;
  codec?: string;
  videoCodec?: string;
  audioCodec?: string;
  hasVideo: boolean;
  hasAudio: boolean;
}

async function verifyMediaWithFfprobe(filePath: string): Promise<ProbeVerificationResult> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      '-protocol_whitelist',
      'file,crypto,data',
      filePath,
    ],
    {
      timeout: 20000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    }
  );

  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string; format_name?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string; duration?: string }>;
  };

  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  if (streams.length === 0) {
    throw new Error('FFprobe verification failed: output file contains no playable media streams');
  }

  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');
  if (!videoStream && !audioStream) {
    throw new Error('FFprobe verification failed: output file contains neither video nor audio streams');
  }

  const rawDuration =
    parsed.format?.duration || videoStream?.duration || audioStream?.duration;
  const parsedDuration = rawDuration ? Number(rawDuration) : undefined;
  const durationSeconds =
    parsedDuration !== undefined && Number.isFinite(parsedDuration) && parsedDuration > 0
      ? Math.round(parsedDuration * 10) / 10
      : undefined;

  return {
    durationSeconds,
    codec: videoStream?.codec_name || audioStream?.codec_name,
    videoCodec: videoStream?.codec_name,
    audioCodec: audioStream?.codec_name,
    hasVideo: Boolean(videoStream),
    hasAudio: Boolean(audioStream),
  };
}

interface DbJobRow {
  id: string;
  owner_user_id: string;
  owner_tier: string;
  batch_id: string | null;
  item_number: string | null;
  media_asset_id: string | null;
  media_url: string | null;
  local_file_path: string | null;
  audio_url: string | null;
  audio_offset_ms: number | null;
  input_title: string | null;
  operation: string;
  target_format: string;
  target_resolution: string | null;
  target_audio_codec: string | null;
  stream_copy: number;
  format_id: string | null;
  processing_lane: string;
  queue_class: string;
  strategy_label: string | null;
  lossless_preserved: number;
  retention_minutes: number;
  priority_weight: number;
  status: string;
  progress: number;
  stage: string | null;
  stage_message: string | null;
  idempotency_key: string | null;
  reservation_id: string | null;
  request_id: string | null;
  attempts: number;
  max_attempts: number;
  queued_at: string | null;
  started_at: string | null;
  queue_wait_ms: number | null;
  processing_ms: number | null;
  download_url: string | null;
  error_code: string | null;
  error_message: string | null;
  user_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  expires_at: string | null;
}

interface DbArtifactRow {
  id: string;
  job_id: string;
  owner_user_id: string;
  file_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  container: string;
  codec: string | null;
  duration_seconds: number | null;
  checksum_sha256: string | null;
  download_url: string | null;
  expires_at: string | null;
}

export class QueueService extends EventEmitter {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly standaloneArtifacts = new Map<string, JobOutputArtifact>();
  private readonly classQueues = new Map<QueueClass, string[]>();
  private readonly classActiveCount = new Map<QueueClass, number>();
  private readonly userActiveCount = new Map<string, number>();
  private readonly lastServedUserPerClass = new Map<QueueClass, string>();
  private readonly activeProcesses = new Map<string, ChildProcess>();
  private readonly cleanupTimers = new Map<string, NodeJS.Timeout>();
  private activeJobsCount = 0;

  // Per-tier latency samples for p50/p95 telemetry (rolling 500 samples per tier)
  private readonly tierWaitSamples: Record<PriorityTier, number[]> = {
    PREMIUM: [],
    REGISTERED: [],
    GUEST: [],
  };
  private readonly tierProcessingSamples: Record<PriorityTier, number[]> = {
    PREMIUM: [],
    REGISTERED: [],
    GUEST: [],
  };

  // Telemetry metrics
  private totalEnqueued = 0;
  private totalCompleted = 0;
  private totalFailed = 0;
  private completedLastHour = 0;
  private failedLastHour = 0;
  private topErrorCode: string = 'NONE';

  constructor() {
    super();
    this.setMaxListeners(5000);

    for (const qc of QUEUE_CLASSES) {
      this.classQueues.set(qc, []);
      this.classActiveCount.set(qc, 0);
    }

    fs.mkdirSync(ARTIFACTS_ROOT, { recursive: true });

    setInterval(() => {
      this.completedLastHour = 0;
      this.failedLastHour = 0;
    }, 3600000).unref();
  }

  public getArtifactsRoot(): string {
    return ARTIFACTS_ROOT;
  }

  public getTierConcurrencyCap(tier: PriorityTier): number {
    try {
      if (tier === 'PREMIUM') return Math.max(1, getNumericSetting('premium_max_concurrent', 5));
      if (tier === 'REGISTERED') return Math.max(1, getNumericSetting('free_max_concurrent', 2));
      return Math.max(1, getNumericSetting('guest_max_concurrent', 1));
    } catch {
      return tier === 'PREMIUM' ? 5 : tier === 'REGISTERED' ? 2 : 1;
    }
  }

  // ==========================================
  // SQLite Persistence Helpers
  // ==========================================

  private persistJobUpsert(job: JobRecord): void {
    try {
      const db = getDb();
      db.prepare(
        `INSERT INTO processing_jobs (
          id, owner_user_id, owner_tier, batch_id, item_number, media_asset_id, media_url,
          local_file_path, audio_url, audio_offset_ms, input_title, operation, target_format,
          target_resolution, target_audio_codec, stream_copy, format_id, processing_lane,
          queue_class, strategy_label, lossless_preserved, retention_minutes, priority_weight,
          status, progress, stage, stage_message, idempotency_key, reservation_id, request_id,
          attempts, max_attempts, queued_at, started_at, queue_wait_ms, processing_ms,
          download_url, error_code, error_message, user_message, created_at, updated_at,
          completed_at, expires_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          progress = excluded.progress,
          stage = excluded.stage,
          stage_message = excluded.stage_message,
          processing_lane = excluded.processing_lane,
          queue_class = excluded.queue_class,
          strategy_label = excluded.strategy_label,
          lossless_preserved = excluded.lossless_preserved,
          input_title = excluded.input_title,
          attempts = excluded.attempts,
          queued_at = excluded.queued_at,
          started_at = excluded.started_at,
          queue_wait_ms = excluded.queue_wait_ms,
          processing_ms = excluded.processing_ms,
          download_url = excluded.download_url,
          error_code = excluded.error_code,
          error_message = excluded.error_message,
          user_message = excluded.user_message,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at,
          expires_at = excluded.expires_at`
      ).run(
        job.jobId,
        job.ownerUserId,
        job.ownerTier || 'GUEST',
        job.batchId ?? null,
        job.itemNumber ?? null,
        job.mediaAssetId ?? null,
        job.mediaUrl ?? null,
        job.localFilePath ?? null,
        job.audioUrl ?? null,
        job.audioOffsetMs ?? 0,
        job.inputTitle ?? null,
        job.operation,
        job.targetFormat,
        job.targetResolution ?? null,
        job.targetAudioCodec ?? null,
        job.streamCopy ? 1 : 0,
        job.formatId ?? null,
        job.processingLane || 'smart',
        job.queueClass || 'video-transcoding',
        job.strategyLabel ?? null,
        job.losslessPreserved ? 1 : 0,
        job.retentionMinutes ?? DEFAULT_RETENTION_MINUTES,
        job.priorityWeight ?? TIER_PRIORITY_WEIGHTS[job.ownerTier || 'GUEST'],
        job.status,
        job.progress,
        job.stage ?? null,
        job.stageMessage ?? null,
        job.idempotencyKey ?? null,
        job.reservationId ?? null,
        job.requestId ?? null,
        job.attempts,
        job.maxAttempts,
        job.queuedAt ?? job.createdAt,
        job.startedAt ?? null,
        job.queueWaitMs ?? null,
        job.processingMs ?? null,
        job.downloadUrl ?? null,
        job.error?.code ?? null,
        job.error?.message ?? null,
        job.error?.userMessage ?? null,
        job.createdAt,
        job.updatedAt,
        job.completedAt ?? null,
        job.expiresAt ?? null
      );
    } catch {
      // Do not crash worker loop if DB persistence hits transient contention
    }
  }

  private persistJobEvent(jobId: string, status: JobStatus, progress: number, stage?: string, message?: string): void {
    try {
      const db = getDb();
      db.prepare(
        `INSERT INTO job_events (id, job_id, status, progress, stage, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        generatePrefixedId('jevt', 8),
        jobId,
        status,
        progress,
        stage ?? status,
        message ?? null,
        new Date().toISOString()
      );
    } catch {
      // Non-fatal event log
    }
  }

  private persistArtifact(jobId: string, ownerUserId: string, artifact: JobOutputArtifact): void {
    try {
      const db = getDb();
      db.prepare(
        `INSERT OR REPLACE INTO output_artifacts (
          id, job_id, owner_user_id, file_path, filename, mime_type, size_bytes,
          container, codec, duration_seconds, checksum_sha256, download_url, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        artifact.artifactId,
        jobId,
        ownerUserId,
        artifact.filePath || '',
        artifact.filename,
        artifact.mimeType,
        artifact.sizeBytes,
        artifact.container,
        artifact.codec ?? null,
        artifact.durationSeconds ?? null,
        artifact.checksumSha256 ?? null,
        artifact.downloadUrl ?? null,
        artifact.expiresAt ?? null,
        new Date().toISOString()
      );
    } catch {
      // Non-fatal
    }
  }

  private syncParentBatchStatus(batchId?: string): void {
    if (!batchId) return;
    try {
      const db = getDb();
      const counts = db
        .prepare(
          `SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'READY' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
            AVG(progress) AS avg_progress
           FROM processing_jobs
           WHERE batch_id = ?`
        )
        .get(batchId) as
        | { total: number; completed: number; failed: number; cancelled: number; avg_progress: number | null }
        | undefined;

      if (!counts || counts.total === 0) return;

      const total = Number(counts.total);
      const completed = Number(counts.completed || 0);
      const failed = Number(counts.failed || 0);
      const cancelled = Number(counts.cancelled || 0);
      const terminal = completed + failed + cancelled;
      const progress = Math.min(100, Math.round(Number(counts.avg_progress || 0)));

      let status = 'PROCESSING';
      let completedAt: string | null = null;
      const nowIso = new Date().toISOString();

      if (terminal >= total) {
        completedAt = nowIso;
        if (cancelled === total) status = 'CANCELLED';
        else if (failed === total) status = 'FAILED';
        else if (failed > 0 || cancelled > 0) status = 'PARTIAL_FAILURE';
        else status = 'COMPLETED';
      }

      db.prepare(
        `UPDATE batches
         SET completed_items = ?, failed_items = ?, cancelled_items = ?,
             progress = ?, status = ?, updated_at = ?, completed_at = COALESCE(completed_at, ?)
         WHERE id = ?`
      ).run(completed, failed, cancelled, progress, status, nowIso, completedAt, batchId);
    } catch {
      // Non-fatal batch sync
    }
  }

  private hydrateJobFromDbRow(row: DbJobRow): JobRecord {
    const db = getDb();
    const artRow = db
      .prepare(
        `SELECT id, job_id, owner_user_id, file_path, filename, mime_type, size_bytes,
                container, codec, duration_seconds, checksum_sha256, download_url, expires_at
         FROM output_artifacts
         WHERE job_id = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(row.id) as DbArtifactRow | undefined;

    const artifact: JobOutputArtifact | undefined = artRow
      ? {
          artifactId: artRow.id,
          ownerUserId: artRow.owner_user_id,
          filePath: artRow.file_path,
          filename: artRow.filename,
          mimeType: artRow.mime_type,
          sizeBytes: artRow.size_bytes,
          container: artRow.container,
          codec: artRow.codec ?? undefined,
          durationSeconds: artRow.duration_seconds ?? undefined,
          checksumSha256: artRow.checksum_sha256 ?? undefined,
          downloadUrl: artRow.download_url ?? undefined,
          expiresAt: artRow.expires_at ?? undefined,
        }
      : undefined;

    return {
      jobId: row.id,
      ownerUserId: row.owner_user_id,
      ownerTier: (row.owner_tier as PriorityTier) || 'GUEST',
      priorityWeight: row.priority_weight,
      batchId: row.batch_id ?? undefined,
      itemNumber: row.item_number ?? undefined,
      requestId: row.request_id ?? undefined,
      operation: row.operation as JobOperation,
      status: row.status as JobStatus,
      progress: row.progress,
      stage: row.stage ?? undefined,
      stageMessage: row.stage_message ?? undefined,
      inputTitle: row.input_title ?? undefined,
      mediaAssetId: row.media_asset_id ?? undefined,
      mediaUrl: row.media_url ?? undefined,
      localFilePath: row.local_file_path ?? undefined,
      audioUrl: row.audio_url ?? undefined,
      audioOffsetMs: row.audio_offset_ms ?? undefined,
      targetFormat: row.target_format,
      targetResolution: row.target_resolution ?? undefined,
      targetAudioCodec: row.target_audio_codec ?? undefined,
      streamCopy: Boolean(row.stream_copy),
      formatId: row.format_id ?? undefined,
      processingLane: row.processing_lane as ProcessingLane,
      queueClass: row.queue_class as QueueClass,
      strategyLabel: row.strategy_label ?? undefined,
      losslessPreserved: Boolean(row.lossless_preserved),
      retentionMinutes: row.retention_minutes,
      queuedAt: row.queued_at ?? row.created_at,
      startedAt: row.started_at ?? undefined,
      queueWaitMs: row.queue_wait_ms ?? undefined,
      processingMs: row.processing_ms ?? undefined,
      idempotencyKey: row.idempotency_key || row.id,
      reservationId: row.reservation_id ?? undefined,
      artifact,
      downloadUrl: row.download_url ?? artifact?.downloadUrl,
      error: row.error_code
        ? {
            code: row.error_code,
            message: row.error_message || 'Processing failed',
            userMessage: row.user_message || mapHumanFriendlyError(row.error_code, row.error_message || undefined),
          }
        : null,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at ?? undefined,
      expiresAt: row.expires_at ?? undefined,
    };
  }

  /**
   * Registers a standalone artifact (e.g., playlist ZIP archive) so it can be delivered
   * via /api/v1/download/:token with full HTTP Range, ETag, IDOR owner checks, and 60-min TTL cleanup.
   */
  public registerStandaloneArtifact(
    jobId: string,
    artifact: JobOutputArtifact,
    cleanupDir?: string
  ): void {
    const key = `${jobId}:${artifact.artifactId}`;
    this.standaloneArtifacts.set(key, artifact);
    if (artifact.ownerUserId) {
      this.persistArtifact(jobId, artifact.ownerUserId, artifact);
    }
    if (cleanupDir) {
      const timer = setTimeout(() => {
        this.standaloneArtifacts.delete(key);
        fsp.rm(cleanupDir, { recursive: true, force: true }).catch(() => {});
      }, ARTIFACT_TTL_MS);
      timer.unref();
      this.cleanupTimers.set(key, timer);
    }
  }

  /**
   * Resolves a verified download artifact from memory or SQLite `output_artifacts`.
   */
  public resolveDownloadArtifact(jobId: string, artifactId: string): JobOutputArtifact | undefined {
    const job = this.jobs.get(jobId);
    if (
      job &&
      job.status === 'READY' &&
      job.artifact &&
      job.artifact.artifactId === artifactId &&
      job.artifact.filePath
    ) {
      return { ...job.artifact, ownerUserId: job.ownerUserId };
    }
    const standalone = this.standaloneArtifacts.get(`${jobId}:${artifactId}`);
    if (standalone) return standalone;

    // Fallback to SQLite persistence across restarts
    try {
      const db = getDb();
      const row = db
        .prepare(
          `SELECT id, job_id, owner_user_id, file_path, filename, mime_type, size_bytes,
                  container, codec, duration_seconds, checksum_sha256, download_url, expires_at
           FROM output_artifacts
           WHERE id = ? AND job_id = ?
           LIMIT 1`
        )
        .get(artifactId, jobId) as DbArtifactRow | undefined;
      if (!row || !row.file_path) return undefined;
      if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return undefined;
      return {
        artifactId: row.id,
        ownerUserId: row.owner_user_id,
        filePath: row.file_path,
        filename: row.filename,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        container: row.container,
        codec: row.codec ?? undefined,
        durationSeconds: row.duration_seconds ?? undefined,
        checksumSha256: row.checksum_sha256 ?? undefined,
        downloadUrl: row.download_url ?? undefined,
        expiresAt: row.expires_at ?? undefined,
      };
    } catch {
      return undefined;
    }
  }

  private getTotalWaitingCount(): number {
    let total = 0;
    for (const q of this.classQueues.values()) {
      total += q.length;
    }
    return total;
  }

  private assertBackpressureCapacity(): void {
    if (this.getTotalWaitingCount() >= MAX_TOTAL_QUEUED) {
      const err = new Error('Server processing queue is at capacity. Please try again shortly.');
      (err as any).statusCode = 503;
      (err as any).code = 'ERR_BACKPRESSURE';
      throw err;
    }
  }

  /**
   * Enqueues a new media processing job with MXJ- ID, priority tier weight, and SQLite persistence
   */
  public async enqueueJob(
    input: CreateJobInput,
    ownerUserId: string,
    reservationId?: string
  ): Promise<JobRecord> {
    this.assertBackpressureCapacity();

    const jobId = generateJobId();
    const now = new Date().toISOString();
    const resolvedUrl = input.mediaUrl || input.sourceUrl;
    const sourceAsset = input.mediaAssetId ? adapterService.getAsset(input.mediaAssetId) : undefined;
    const ownerTier: PriorityTier = input.ownerTier || 'GUEST';
    const priorityWeight = TIER_PRIORITY_WEIGHTS[ownerTier];

    const strategy = selectTurboFlowStrategy({
      operation: input.operation,
      targetFormat: input.targetFormat,
      targetResolution: input.targetResolution,
      targetAudioCodec: input.targetAudioCodec,
      streamCopy: input.streamCopy,
      isLocalUpload: Boolean(input.localFilePath || sourceAsset?.localFilePath),
      sourceAsset,
    });

    const job: JobRecord = {
      jobId,
      ownerUserId,
      ownerTier,
      priorityWeight,
      batchId: input.batchId,
      itemNumber: input.itemNumber,
      requestId: input.requestId,
      operation: input.operation,
      status: 'QUEUED',
      progress: 0,
      stage: 'QUEUED',
      stageMessage: 'Queued for processing',
      inputTitle: input.title || sourceAsset?.title,
      mediaAssetId: input.mediaAssetId,
      mediaUrl: resolvedUrl,
      localFilePath: input.localFilePath || sourceAsset?.localFilePath,
      targetFormat: (input.targetFormat || 'mp4').toLowerCase().trim(),
      targetResolution: input.targetResolution,
      targetAudioCodec: input.targetAudioCodec,
      streamCopy: input.streamCopy,
      formatId: input.formatId,
      processingLane: strategy.processingLane,
      queueClass: strategy.queueClass,
      strategyLabel: strategy.strategyLabel,
      losslessPreserved: strategy.losslessPreserved,
      retentionMinutes: strategy.retentionMinutes,
      queuedAt: now,
      idempotencyKey: input.idempotencyKey,
      reservationId,
      attempts: 0,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(jobId, job);
    this.persistJobUpsert(job);
    this.persistJobEvent(jobId, 'QUEUED', 0, 'QUEUED', job.stageMessage);
    recordAnalyticsEvent('job_created', ownerUserId, ownerTier, {
      operation: job.operation,
      queueClass: job.queueClass,
      processingLane: job.processingLane,
      targetFormat: job.targetFormat,
    });

    this.classQueues.get(strategy.queueClass)!.push(jobId);
    this.totalEnqueued++;

    this.emitProgress(jobId, {
      jobId,
      status: 'QUEUED',
      progress: 0,
      stage: 'QUEUED',
      message: job.stageMessage,
      processingLane: job.processingLane,
      queueClass: job.queueClass,
      strategyLabel: job.strategyLabel,
      losslessPreserved: job.losslessPreserved,
      retentionMinutes: job.retentionMinutes,
      timestamp: now,
    });

    setImmediate(() => this.dispatchAllClasses());

    return job;
  }

  /**
   * Enqueues a merge job into the `merge-processing` Smart Lane
   */
  public async enqueueMergeJob(
    input: MergeJobInput,
    ownerUserId: string,
    reservationId?: string,
    ownerTier: PriorityTier = 'GUEST',
    requestId?: string
  ): Promise<JobRecord> {
    this.assertBackpressureCapacity();

    const jobId = generateJobId();
    const now = new Date().toISOString();
    const sourceAsset = input.videoAssetId ? adapterService.getAsset(input.videoAssetId) : undefined;
    const priorityWeight = TIER_PRIORITY_WEIGHTS[ownerTier];

    const strategy = selectTurboFlowStrategy({
      operation: 'MERGE_AUDIO_VIDEO',
      targetFormat: input.targetFormat,
      streamCopy: true,
      sourceAsset,
    });

    const job: JobRecord = {
      jobId,
      ownerUserId,
      ownerTier,
      priorityWeight,
      requestId,
      operation: 'MERGE_AUDIO_VIDEO',
      status: 'QUEUED',
      progress: 0,
      stage: 'QUEUED',
      stageMessage: 'Merge job queued',
      inputTitle: sourceAsset?.title,
      mediaAssetId: input.videoAssetId,
      mediaUrl: input.videoUrl,
      audioUrl: input.audioUrl,
      audioOffsetMs: input.audioOffsetMs ?? 0,
      targetFormat: (input.targetFormat || 'mp4').toLowerCase().trim(),
      processingLane: strategy.processingLane,
      queueClass: strategy.queueClass,
      strategyLabel: strategy.strategyLabel,
      losslessPreserved: strategy.losslessPreserved,
      retentionMinutes: strategy.retentionMinutes,
      queuedAt: now,
      idempotencyKey: input.idempotencyKey,
      reservationId,
      attempts: 0,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(jobId, job);
    this.persistJobUpsert(job);
    this.persistJobEvent(jobId, 'QUEUED', 0, 'QUEUED', job.stageMessage);
    recordAnalyticsEvent('job_created', ownerUserId, ownerTier, {
      operation: job.operation,
      queueClass: job.queueClass,
      processingLane: job.processingLane,
    });

    this.classQueues.get(strategy.queueClass)!.push(jobId);
    this.totalEnqueued++;

    this.emitProgress(jobId, {
      jobId,
      status: 'QUEUED',
      progress: 0,
      stage: 'QUEUED',
      message: job.stageMessage,
      processingLane: job.processingLane,
      queueClass: job.queueClass,
      strategyLabel: job.strategyLabel,
      losslessPreserved: job.losslessPreserved,
      retentionMinutes: job.retentionMinutes,
      timestamp: now,
    });

    setImmediate(() => this.dispatchAllClasses());

    return job;
  }

  /**
   * Retrieves a job by ID (checks memory cache first, falls back to SQLite persistence)
   */
  public getJob(jobId: string): JobRecord | undefined {
    const inMem = this.jobs.get(jobId);
    if (inMem) return inMem;

    try {
      const db = getDb();
      const row = db
        .prepare('SELECT * FROM processing_jobs WHERE id = ? LIMIT 1')
        .get(jobId) as DbJobRow | undefined;
      if (!row) return undefined;
      const hydrated = this.hydrateJobFromDbRow(row);
      this.jobs.set(jobId, hydrated);
      return hydrated;
    } catch {
      return undefined;
    }
  }

  /**
   * Lists jobs for a user from SQLite (merged with live in-memory progress)
   */
  public getUserJobs(userId: string, limit: number = 20, offset: number = 0): { items: JobRecord[]; total: number } {
    try {
      const db = getDb();
      const totalRow = db
        .prepare('SELECT COUNT(*) AS cnt FROM processing_jobs WHERE owner_user_id = ?')
        .get(userId) as { cnt: number } | undefined;
      const rows = db
        .prepare(
          `SELECT * FROM processing_jobs
           WHERE owner_user_id = ?
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`
        )
        .all(userId, limit, offset) as unknown as DbJobRow[];

      const items = rows.map((row) => this.jobs.get(row.id) ?? this.hydrateJobFromDbRow(row));
      return {
        items,
        total: Number(totalRow?.cnt || items.length),
      };
    } catch {
      const userJobs = Array.from(this.jobs.values())
        .filter((j) => j.ownerUserId === userId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return {
        items: userJobs.slice(offset, offset + limit),
        total: userJobs.length,
      };
    }
  }

  /**
   * Lists all child jobs belonging to a batch, ordered by item_number ("001", "002", ...)
   */
  public getBatchJobs(batchId: string): JobRecord[] {
    try {
      const db = getDb();
      const rows = db
        .prepare(
          `SELECT * FROM processing_jobs
           WHERE batch_id = ?
           ORDER BY item_number ASC, created_at ASC`
        )
        .all(batchId) as unknown as DbJobRow[];
      return rows.map((row) => this.jobs.get(row.id) ?? this.hydrateJobFromDbRow(row));
    } catch {
      return Array.from(this.jobs.values())
        .filter((j) => j.batchId === batchId)
        .sort((a, b) => (a.itemNumber || '').localeCompare(b.itemNumber || ''));
    }
  }

  /**
   * Cancels a queued or processing job, terminates any active child process, and releases quota reservation
   */
  public async cancelJob(jobId: string, reason: string = 'Cancelled by user'): Promise<JobRecord> {
    const job = this.getJob(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    if (['READY', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(job.status)) {
      return job;
    }

    for (const queue of this.classQueues.values()) {
      const idx = queue.indexOf(jobId);
      if (idx >= 0) {
        queue.splice(idx, 1);
      }
    }

    job.status = 'CANCELLED';
    job.stage = 'CANCELLED';
    job.stageMessage = reason;
    job.updatedAt = new Date().toISOString();
    this.persistJobUpsert(job);
    this.persistJobEvent(jobId, 'CANCELLED', job.progress, 'CANCELLED', reason);
    this.syncParentBatchStatus(job.batchId);

    const activeProc = this.activeProcesses.get(jobId);
    if (activeProc && !activeProc.killed) {
      try {
        activeProc.kill('SIGTERM');
        setTimeout(() => {
          if (!activeProc.killed) {
            try {
              activeProc.kill('SIGKILL');
            } catch {
              // ignore already exited
            }
          }
        }, 1500).unref();
      } catch {
        // ignore kill error
      }
      this.activeProcesses.delete(jobId);
    }

    this.removeJobDir(jobId).catch(() => {});

    if (job.reservationId) {
      try {
        await entitlementsService.rollbackQuota(job.reservationId, reason);
      } catch {
        // Log rollback error
      }
    }

    this.emitProgress(jobId, {
      jobId,
      status: 'CANCELLED',
      progress: job.progress,
      stage: 'CANCELLED',
      message: reason,
      processingLane: job.processingLane,
      queueClass: job.queueClass,
      strategyLabel: job.strategyLabel,
      losslessPreserved: job.losslessPreserved,
      retentionMinutes: job.retentionMinutes,
      timestamp: job.updatedAt,
    });

    return job;
  }

  /**
   * Retries a failed job (bounded to maxAttempts = 3)
   */
  public async retryJob(jobId: string): Promise<JobRecord> {
    const job = this.getJob(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    if (job.status !== 'FAILED') {
      throw new Error(`Only FAILED jobs can be retried (current status: ${job.status})`);
    }

    if (job.attempts >= job.maxAttempts) {
      throw new Error(`Max retry attempts (${job.maxAttempts}) reached for job ${jobId}`);
    }

    this.assertBackpressureCapacity();

    const now = new Date().toISOString();
    const queueClass: QueueClass = job.queueClass || 'video-transcoding';

    job.status = 'QUEUED';
    job.progress = 0;
    job.stage = 'QUEUED';
    job.stageMessage = `Retrying job (attempt ${job.attempts + 1}/${job.maxAttempts})`;
    job.error = null;
    job.queuedAt = now;
    job.startedAt = undefined;
    job.queueWaitMs = undefined;
    job.processingMs = undefined;
    job.updatedAt = now;

    this.persistJobUpsert(job);
    this.persistJobEvent(jobId, 'QUEUED', 0, 'QUEUED', job.stageMessage);
    this.classQueues.get(queueClass)!.push(jobId);

    this.emitProgress(jobId, {
      jobId,
      status: 'QUEUED',
      progress: 0,
      stage: 'QUEUED',
      message: job.stageMessage,
      processingLane: job.processingLane,
      queueClass: job.queueClass,
      strategyLabel: job.strategyLabel,
      losslessPreserved: job.losslessPreserved,
      retentionMinutes: job.retentionMinutes,
      timestamp: now,
    });

    setImmediate(() => this.dispatchAllClasses());

    return job;
  }

  public canAcquirePlaylistSlot(): boolean {
    return (this.classActiveCount.get('playlist-packaging') ?? 0) < QUEUE_CLASS_CAPS['playlist-packaging'];
  }

  public setPlaylistSlotActive(delta: 1 | -1): void {
    const current = this.classActiveCount.get('playlist-packaging') ?? 0;
    this.classActiveCount.set('playlist-packaging', Math.max(0, current + delta));
    this.activeJobsCount = Math.max(0, this.activeJobsCount + delta);
  }

  /**
   * Returns system telemetry, per-lane queue metrics, and per-tier p50/p95 wait/duration metrics
   */
  public getMetrics() {
    const totalJobs = this.totalCompleted + this.totalFailed;
    const errorRatePercent = totalJobs > 0 ? (this.totalFailed / totalJobs) * 100 : 0;
    const nowMs = Date.now();

    const lanes: Record<string, { waiting: number; active: number; cap: number; oldestQueuedMs: number }> = {};
    for (const qc of QUEUE_CLASSES) {
      const q = this.classQueues.get(qc) ?? [];
      let oldestQueuedMs = 0;
      if (q.length > 0) {
        const firstJob = this.jobs.get(q[0]);
        if (firstJob?.queuedAt) {
          oldestQueuedMs = Math.max(0, nowMs - new Date(firstJob.queuedAt).getTime());
        }
      }
      lanes[qc] = {
        waiting: q.length,
        active: this.classActiveCount.get(qc) ?? 0,
        cap: QUEUE_CLASS_CAPS[qc],
        oldestQueuedMs,
      };
    }

    const priorityTiers: Record<
      PriorityTier,
      {
        weight: number;
        maxConcurrentPerUser: number;
        sampleCount: number;
        queueWaitP50Ms: number;
        queueWaitP95Ms: number;
        processingP50Ms: number;
        processingP95Ms: number;
      }
    > = {
      PREMIUM: {
        weight: TIER_PRIORITY_WEIGHTS.PREMIUM,
        maxConcurrentPerUser: this.getTierConcurrencyCap('PREMIUM'),
        sampleCount: this.tierWaitSamples.PREMIUM.length,
        queueWaitP50Ms: computePercentile(this.tierWaitSamples.PREMIUM, 50),
        queueWaitP95Ms: computePercentile(this.tierWaitSamples.PREMIUM, 95),
        processingP50Ms: computePercentile(this.tierProcessingSamples.PREMIUM, 50),
        processingP95Ms: computePercentile(this.tierProcessingSamples.PREMIUM, 95),
      },
      REGISTERED: {
        weight: TIER_PRIORITY_WEIGHTS.REGISTERED,
        maxConcurrentPerUser: this.getTierConcurrencyCap('REGISTERED'),
        sampleCount: this.tierWaitSamples.REGISTERED.length,
        queueWaitP50Ms: computePercentile(this.tierWaitSamples.REGISTERED, 50),
        queueWaitP95Ms: computePercentile(this.tierWaitSamples.REGISTERED, 95),
        processingP50Ms: computePercentile(this.tierProcessingSamples.REGISTERED, 50),
        processingP95Ms: computePercentile(this.tierProcessingSamples.REGISTERED, 95),
      },
      GUEST: {
        weight: TIER_PRIORITY_WEIGHTS.GUEST,
        maxConcurrentPerUser: this.getTierConcurrencyCap('GUEST'),
        sampleCount: this.tierWaitSamples.GUEST.length,
        queueWaitP50Ms: computePercentile(this.tierWaitSamples.GUEST, 50),
        queueWaitP95Ms: computePercentile(this.tierWaitSamples.GUEST, 95),
        processingP50Ms: computePercentile(this.tierProcessingSamples.GUEST, 50),
        processingP95Ms: computePercentile(this.tierProcessingSamples.GUEST, 95),
      },
    };

    return {
      queue: {
        waitingCount: this.getTotalWaitingCount(),
        activeCount: this.activeJobsCount,
        completedLastHour: this.completedLastHour,
        failedLastHour: this.failedLastHour,
        totalEnqueued: this.totalEnqueued,
        lanes,
      },
      priorityTiers,
      workerNodes: [
        {
          id: 'worker-turboflow-01',
          status: 'READY',
          activeJobs: this.activeJobsCount,
          cpuPercent: Math.min(100, Math.round(12 + this.activeJobsCount * 10)),
          memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        },
      ],
      errorRates: {
        fiveMinutePercent: Math.round(errorRatePercent * 10) / 10,
        topErrorCode: this.topErrorCode,
      },
    };
  }

  // ==========================================
  // 3-Tier Fair Priority Scheduler + Anti-Starvation Aging
  // ==========================================

  private recordTierSample(tier: PriorityTier, waitMs: number, processingMs?: number): void {
    const waits = this.tierWaitSamples[tier];
    waits.push(waitMs);
    if (waits.length > 500) waits.shift();

    if (processingMs !== undefined && Number.isFinite(processingMs)) {
      const procs = this.tierProcessingSamples[tier];
      procs.push(processingMs);
      if (procs.length > 500) procs.shift();
    }
  }

  private dispatchAllClasses(): void {
    for (const qc of QUEUE_CLASSES) {
      this.dispatchClass(qc);
    }
  }

  private dispatchClass(qc: QueueClass): void {
    const queue = this.classQueues.get(qc);
    if (!queue || queue.length === 0) return;

    const cap = QUEUE_CLASS_CAPS[qc];
    while ((this.classActiveCount.get(qc) ?? 0) < cap && queue.length > 0) {
      const nextIdx = this.pickPriorityNextJobIndex(qc, queue);
      if (nextIdx < 0) {
        break;
      }

      const [jobId] = queue.splice(nextIdx, 1);
      const job = this.jobs.get(jobId);
      if (!job || job.status === 'CANCELLED') {
        continue;
      }

      this.startJobInClass(qc, job);
    }
  }

  /**
   * 3-Tier Fair Priority Selector:
   * - Base weights: PREMIUM (6) > REGISTERED (3) > GUEST (1)
   * - Anti-starvation aging boost: +1 weight per 5s waited (max +12) so guests are never starved
   * - Per-tier concurrency cap enforced per user (from system_settings)
   * - Round-robin bonus across users within identical priority scores
   */
  private pickPriorityNextJobIndex(qc: QueueClass, queue: string[]): number {
    const nowMs = Date.now();
    const lastUser = this.lastServedUserPerClass.get(qc);

    let bestIdx = -1;
    let bestScore = -Infinity;
    let bestQueuedAt = Infinity;

    for (let i = 0; i < queue.length; i++) {
      const job = this.jobs.get(queue[i]);
      if (!job || job.status === 'CANCELLED') {
        return i; // purge stale entry immediately
      }

      const tier: PriorityTier = job.ownerTier || 'GUEST';
      const userCap = this.getTierConcurrencyCap(tier);
      const userActive = this.userActiveCount.get(job.ownerUserId) ?? 0;
      if (userActive >= userCap) {
        continue;
      }

      const baseWeight = TIER_PRIORITY_WEIGHTS[tier];
      const queuedMs = job.queuedAt ? new Date(job.queuedAt).getTime() : nowMs;
      const waitMs = Math.max(0, nowMs - queuedMs);
      const agingBoost = Math.min(ANTI_STARVATION_MAX_BOOST, waitMs / ANTI_STARVATION_AGING_STEP_MS);
      const rrBonus = lastUser && job.ownerUserId !== lastUser ? 0.05 : 0;
      const score = baseWeight + agingBoost + rrBonus;

      if (score > bestScore || (Math.abs(score - bestScore) < 1e-6 && queuedMs < bestQueuedAt)) {
        bestScore = score;
        bestQueuedAt = queuedMs;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      const chosen = this.jobs.get(queue[bestIdx]);
      if (chosen) this.lastServedUserPerClass.set(qc, chosen.ownerUserId);
    }
    return bestIdx;
  }

  private startJobInClass(qc: QueueClass, job: JobRecord): void {
    const now = new Date();
    const nowIso = now.toISOString();
    const queuedMs = job.queuedAt ? new Date(job.queuedAt).getTime() : now.getTime();
    const tier: PriorityTier = job.ownerTier || 'GUEST';

    this.classActiveCount.set(qc, (this.classActiveCount.get(qc) ?? 0) + 1);
    this.userActiveCount.set(job.ownerUserId, (this.userActiveCount.get(job.ownerUserId) ?? 0) + 1);
    this.activeJobsCount++;

    job.attempts++;
    job.status = 'PROCESSING';
    job.progress = 5;
    job.stage = 'VALIDATING';
    job.stageMessage = 'Preparing your media';
    job.startedAt = nowIso;
    job.queueWaitMs = Math.max(0, now.getTime() - queuedMs);
    job.updatedAt = nowIso;

    this.recordTierSample(tier, job.queueWaitMs);
    this.persistJobUpsert(job);
    this.persistJobEvent(job.jobId, 'PROCESSING', 5, 'VALIDATING', job.stageMessage);

    this.emitProgress(job.jobId, {
      jobId: job.jobId,
      status: 'PROCESSING',
      progress: 5,
      stage: 'VALIDATING',
      message: job.stageMessage,
      processingLane: job.processingLane,
      queueClass: job.queueClass,
      strategyLabel: job.strategyLabel,
      losslessPreserved: job.losslessPreserved,
      retentionMinutes: job.retentionMinutes,
      timestamp: nowIso,
    });

    this.runWorkerPipeline(job).finally(() => {
      this.activeProcesses.delete(job.jobId);
      this.classActiveCount.set(qc, Math.max(0, (this.classActiveCount.get(qc) ?? 1) - 1));
      const uCount = (this.userActiveCount.get(job.ownerUserId) ?? 1) - 1;
      if (uCount <= 0) this.userActiveCount.delete(job.ownerUserId);
      else this.userActiveCount.set(job.ownerUserId, uCount);
      this.activeJobsCount = Math.max(0, this.activeJobsCount - 1);
      setImmediate(() => this.dispatchAllClasses());
    });
  }

  private isCancelled(job: JobRecord): boolean {
    return job.status === 'CANCELLED';
  }

  private getJobDir(jobId: string): string {
    return path.join(ARTIFACTS_ROOT, jobId);
  }

  private async removeJobDir(jobId: string): Promise<void> {
    const existingTimer = this.cleanupTimers.get(jobId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.cleanupTimers.delete(jobId);
    }
    const dir = this.getJobDir(jobId);
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  private scheduleArtifactCleanup(jobId: string): void {
    const existingTimer = this.cleanupTimers.get(jobId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(() => {
      this.cleanupTimers.delete(jobId);
      const job = this.jobs.get(jobId);
      if (job && job.status === 'READY') {
        job.status = 'EXPIRED';
        job.stage = 'EXPIRED';
        job.stageMessage = 'Artifact expired after 60 minutes';
        job.updatedAt = new Date().toISOString();
        this.persistJobUpsert(job);
      }
      this.removeJobDir(jobId).catch(() => {});
    }, ARTIFACT_TTL_MS);
    timer.unref();
    this.cleanupTimers.set(jobId, timer);
  }

  private runTrackedProcess(
    job: JobRecord,
    binary: string,
    args: string[],
    onLine?: (line: string) => void
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      if (this.isCancelled(job)) {
        reject(new Error('Job cancelled'));
        return;
      }

      const cleanEnv = { ...process.env };
      delete cleanEnv.TRUST_PROXY;

      const proc = spawn(binary, args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: cleanEnv,
      });

      this.activeProcesses.set(job.jobId, proc);

      let stdout = '';
      let stderr = '';
      let stdoutBuf = '';
      let stderrBuf = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          proc.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, PROCESS_TIMEOUT_MS);

      const handleChunk = (chunk: Buffer, isStderr: boolean) => {
        const text = chunk.toString('utf8');
        if (isStderr) {
          if (stderr.length < 256 * 1024) stderr += text;
          stderrBuf += text;
          const lines = stderrBuf.split(/\r?\n|\r/);
          stderrBuf = lines.pop() ?? '';
          for (const line of lines) {
            if (line.trim() && onLine) onLine(line);
          }
        } else {
          if (stdout.length < 256 * 1024) stdout += text;
          stdoutBuf += text;
          const lines = stdoutBuf.split(/\r?\n|\r/);
          stdoutBuf = lines.pop() ?? '';
          for (const line of lines) {
            if (line.trim() && onLine) onLine(line);
          }
        }
      };

      proc.stdout.on('data', (chunk: Buffer) => handleChunk(chunk, false));
      proc.stderr.on('data', (chunk: Buffer) => handleChunk(chunk, true));

      proc.on('error', (err) => {
        clearTimeout(timer);
        if (this.activeProcesses.get(job.jobId) === proc) {
          this.activeProcesses.delete(job.jobId);
        }
        reject(new Error(`Failed to execute ${binary}: ${err.message}`));
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (this.activeProcesses.get(job.jobId) === proc) {
          this.activeProcesses.delete(job.jobId);
        }
        if (stdoutBuf.trim() && onLine) onLine(stdoutBuf);
        if (stderrBuf.trim() && onLine) onLine(stderrBuf);

        if (this.isCancelled(job)) {
          reject(new Error('Job cancelled'));
          return;
        }
        if (timedOut) {
          reject(new Error(`${binary} timed out after ${Math.round(PROCESS_TIMEOUT_MS / 1000)}s`));
          return;
        }
        if (code !== 0) {
          const errLines = stderr
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
          const summary = errLines.slice(-3).join(' | ') || `exit code ${code}`;
          reject(new Error(`${binary} failed (exit ${code}): ${summary}`));
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  }

  private async findGeneratedMediaFile(
    jobDir: string,
    preferredPrefix: string,
    preferredExt?: string
  ): Promise<string | null> {
    const entries = await fsp.readdir(jobDir, { withFileTypes: true });
    const candidates: Array<{ filePath: string; size: number; ext: string; name: string }> = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (IGNORED_EXTENSIONS.has(ext)) continue;
      if (preferredPrefix && !entry.name.startsWith(preferredPrefix)) continue;

      const fullPath = path.join(jobDir, entry.name);
      const stat = await fsp.stat(fullPath).catch(() => null);
      if (stat && stat.size > 0) {
        candidates.push({
          filePath: fullPath,
          size: stat.size,
          ext: ext.replace(/^\./, ''),
          name: entry.name,
        });
      }
    }

    if (candidates.length === 0) return null;

    if (preferredExt) {
      const exact = candidates.find((c) => c.ext === preferredExt.toLowerCase());
      if (exact) return exact.filePath;
    }

    candidates.sort((a, b) => b.size - a.size);
    return candidates[0].filePath;
  }

  private getYtDlpBaseArgs(playerClient?: string): string[] {
    return getTurboYtDlpBaseArgs({ playerClient });
  }

  /**
   * Executes yt-dlp with an automatic player client retry cascade.
   * If primary client triggers YouTube bot verification / datacenter challenge,
   * automatically retries with 'tv,mweb' and 'android' before failing.
   */
  private async runTrackedYtDlpWithFallback(
    job: JobRecord,
    buildArgs: (baseArgs: string[]) => string[],
    onLine?: (line: string) => void
  ): Promise<void> {
    const clientChains = ['ios,android,tv,mweb,web', 'tv,mweb', 'android'];
    let lastError: any = null;

    for (let i = 0; i < clientChains.length; i++) {
      const client = clientChains[i];
      const base = this.getYtDlpBaseArgs(client);
      const args = buildArgs(base);

      try {
        await this.runTrackedProcess(job, 'yt-dlp', args, onLine);
        return;
      } catch (err: any) {
        lastError = err;
        if (this.isCancelled(job)) return;
        if (i < clientChains.length - 1 && isBotVerificationError(err)) {
          // Log and retry with next client in fallback chain
          continue;
        }
        throw err;
      }
    }

    if (lastError) throw lastError;
  }

  private async convertWithFfmpeg(
    job: JobRecord,
    inputPath: string,
    outputPath: string,
    targetExt: string,
    isAudio: boolean,
    allowAudioDirectCopy: boolean = false
  ): Promise<{ losslessStreamCopy: boolean }> {
    const baseArgs = [
      '-nostdin',
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-protocol_whitelist',
      'file,crypto,data',
      '-i',
      inputPath,
    ];

    if (isAudio) {
      if (allowAudioDirectCopy) {
        const directCopyArgs = [...baseArgs, '-vn', '-c:a', 'copy', outputPath];
        try {
          await this.runTrackedProcess(job, 'ffmpeg', directCopyArgs);
          return { losslessStreamCopy: true };
        } catch {
          // Fall through to clean audio encode if container/codec copy fails
        }
      }

      const audioArgs: string[] = [...baseArgs, '-vn'];
      switch (targetExt) {
        case 'mp3':
          audioArgs.push('-c:a', 'libmp3lame', '-q:a', '0');
          break;
        case 'flac':
          audioArgs.push('-c:a', 'flac');
          break;
        case 'wav':
          audioArgs.push('-c:a', 'pcm_s16le');
          break;
        case 'opus':
          audioArgs.push('-c:a', 'libopus', '-b:a', '192k');
          break;
        case 'm4a':
        case 'aac':
          audioArgs.push('-c:a', 'aac', '-b:a', '256k');
          break;
        default:
          audioArgs.push('-c:a', 'aac', '-b:a', '192k');
          break;
      }
      audioArgs.push(outputPath);
      await this.runTrackedProcess(job, 'ffmpeg', audioArgs);
      return { losslessStreamCopy: false };
    }

    if (job.streamCopy !== false) {
      const copyArgs = [...baseArgs, '-c', 'copy'];
      if (targetExt === 'mp4') {
        copyArgs.push('-movflags', '+faststart');
      }
      copyArgs.push(outputPath);
      try {
        await this.runTrackedProcess(job, 'ffmpeg', copyArgs);
        return { losslessStreamCopy: true };
      } catch {
        // Container/codec mismatch for stream copy — fall through to clean transcode
      }
    }

    const transcodeArgs = [...baseArgs];
    if (targetExt === 'webm') {
      transcodeArgs.push('-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-c:a', 'libopus', '-b:a', '160k');
    } else {
      transcodeArgs.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k');
      if (targetExt === 'mp4') {
        transcodeArgs.push('-movflags', '+faststart');
      }
    }
    transcodeArgs.push(outputPath);
    await this.runTrackedProcess(job, 'ffmpeg', transcodeArgs);
    return { losslessStreamCopy: false };
  }

  private async compressVideoWithFfmpeg(
    job: JobRecord,
    inputPath: string,
    outputPath: string,
    targetExt: string,
    targetHeight: number | null,
    inputDurationSec: number | undefined,
    reportProgress: (pct: number, stage: string, message: string) => void,
    progressStart: number = 15,
    progressEnd: number = 85
  ): Promise<void> {
    const scaleFilter = targetHeight
      ? `scale=-2:trunc(min(ih\\,${targetHeight})/2)*2`
      : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';

    const args: string[] = [
      '-nostdin',
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostats',
      '-progress',
      'pipe:1',
      '-protocol_whitelist',
      'file,crypto,data',
      '-i',
      inputPath,
      '-vf',
      scaleFilter,
    ];

    if (targetExt === 'webm') {
      args.push('-c:v', 'libvpx-vp9', '-crf', '33', '-b:v', '0', '-c:a', 'libopus', '-b:a', '128k');
    } else {
      args.push(
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '28',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k'
      );
      if (targetExt === 'mp4') {
        args.push('-movflags', '+faststart');
      }
    }
    args.push(outputPath);

    await this.runTrackedProcess(job, 'ffmpeg', args, (line) => {
      const match = line.match(/^out_time_us=(\d+)/);
      if (match && inputDurationSec && inputDurationSec > 0) {
        const outSec = Number(match[1]) / 1_000_000;
        const ratio = Math.max(0, Math.min(1, outSec / inputDurationSec));
        const pct = progressStart + ratio * (progressEnd - progressStart);
        reportProgress(pct, 'TRANSFORMING', `Compressing video (${Math.round(ratio * 100)}%)`);
      }
    });
  }

  private async runWorkerPipeline(job: JobRecord): Promise<void> {
    const jobId = job.jobId;
    const jobDir = this.getJobDir(jobId);
    const runStartMs = Date.now();
    const tier: PriorityTier = job.ownerTier || 'GUEST';

    try {
      const cachedAsset = job.mediaAssetId ? adapterService.getAsset(job.mediaAssetId) : undefined;
      const candidateLocalPath = job.localFilePath || cachedAsset?.localFilePath;
      let verifiedLocalInputPath: string | null = null;

      if (candidateLocalPath) {
        const localCheck = validateSafePath(candidateLocalPath, [UPLOADS_ROOT], { mustExist: true });
        if (!localCheck.isSafe || !localCheck.resolvedPath) {
          const err = new Error('Uploaded source file is missing or expired. Please upload it again.');
          (err as any).code = 'ERR_UPLOAD_NOT_FOUND';
          throw err;
        }
        verifiedLocalInputPath = localCheck.resolvedPath;
      } else {
        if (!job.mediaUrl) {
          const err = new Error('Job is missing a valid source mediaUrl or uploaded file');
          (err as any).code = 'ERR_INVALID_REQUEST';
          throw err;
        }

        const ssrfCheck = await validateUrlForSsrf(job.mediaUrl);
        if (!ssrfCheck.isSafe) {
          const err = new Error(ssrfCheck.error || 'Target URL blocked by security policy');
          (err as any).code = 'SSRF_BLOCKED';
          throw err;
        }

        if (job.audioUrl) {
          const audioSsrf = await validateUrlForSsrf(job.audioUrl);
          if (!audioSsrf.isSafe) {
            const err = new Error(audioSsrf.error || 'Audio URL blocked by security policy');
            (err as any).code = 'SSRF_BLOCKED';
            throw err;
          }
        }
      }

      if (this.isCancelled(job)) return;

      await fsp.mkdir(jobDir, { recursive: true });

      const isAudio = job.operation === 'EXTRACT_AUDIO';
      const targetExt = normalizeTargetExtension(
        isAudio ? job.targetFormat || job.targetAudioCodec : job.targetFormat,
        isAudio
      );

      job.progress = 10;
      job.stage = verifiedLocalInputPath ? 'TRANSFORMING' : 'FETCHING';
      job.stageMessage = verifiedLocalInputPath
        ? isAudio
          ? `Extracting ${targetExt.toUpperCase()} audio`
          : job.processingLane === 'instant'
          ? `Remuxing video into ${targetExt.toUpperCase()}`
          : `Compressing video to ${targetExt.toUpperCase()}`
        : isAudio
        ? `Downloading source media and extracting ${targetExt.toUpperCase()} audio`
        : `Downloading media (${job.targetResolution || 'best'} -> ${targetExt.toUpperCase()})`;
      job.updatedAt = new Date().toISOString();
      this.persistJobUpsert(job);

      this.emitProgress(jobId, {
        jobId,
        status: 'PROCESSING',
        progress: 10,
        stage: job.stage,
        message: job.stageMessage,
        processingLane: job.processingLane,
        queueClass: job.queueClass,
        strategyLabel: job.strategyLabel,
        losslessPreserved: job.losslessPreserved,
        retentionMinutes: job.retentionMinutes,
        timestamp: job.updatedAt,
      });

      let lastReportedProgress = 10;
      const reportProgress = (pct: number, stage: string, message: string) => {
        if (this.isCancelled(job)) return;
        const clamped = Math.max(lastReportedProgress, Math.min(85, Math.round(pct)));
        if (clamped === lastReportedProgress && stage === job.stage && message === job.stageMessage) {
          return;
        }
        lastReportedProgress = clamped;
        job.progress = clamped;
        job.stage = stage;
        job.stageMessage = message;
        job.updatedAt = new Date().toISOString();
        this.persistJobUpsert(job);
        this.emitProgress(jobId, {
          jobId,
          status: 'PROCESSING',
          progress: clamped,
          stage,
          message,
          processingLane: job.processingLane,
          queueClass: job.queueClass,
          strategyLabel: job.strategyLabel,
          losslessPreserved: job.losslessPreserved,
          retentionMinutes: job.retentionMinutes,
          timestamp: job.updatedAt,
        });
      };

      const onYtDlpLine = (line: string) => {
        const dlMatch = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (dlMatch) {
          const rawPct = Number.parseFloat(dlMatch[1]);
          if (Number.isFinite(rawPct)) {
            const mapped = 10 + (rawPct / 100) * 70;
            reportProgress(mapped, 'FETCHING', `Downloading media (${rawPct.toFixed(1)}%)`);
          }
          return;
        }

        if (line.includes('[ExtractAudio]')) {
          reportProgress(82, 'TRANSFORMING', `Extracting ${targetExt.toUpperCase()} audio`);
        } else if (line.includes('[Merger]') || line.includes('[Fixup')) {
          reportProgress(83, 'TRANSFORMING', `Packaging ${targetExt.toUpperCase()} container`);
        }
      };

      let finalFilePath: string | null = null;
      let actualLosslessPreserved = Boolean(job.losslessPreserved);

      if (verifiedLocalInputPath) {
        const inputProbe = await verifyMediaWithFfprobe(verifiedLocalInputPath);
        if (this.isCancelled(job)) return;

        const targetHeight = parseResolutionHeight(job.targetResolution);
        const outputPath = path.join(jobDir, `output.${targetExt}`);

        if (isAudio || !inputProbe.hasVideo) {
          const audioOutExt = isAudio ? targetExt : AUDIO_FORMATS.has(targetExt) ? targetExt : 'mp3';
          const audioOutPath = path.join(jobDir, `output.${audioOutExt}`);
          const srcAudioBase = (inputProbe.audioCodec || '').toLowerCase();
          const canCopyAudio =
            (audioOutExt === 'mp3' && srcAudioBase === 'mp3') ||
            (audioOutExt === 'flac' && srcAudioBase === 'flac') ||
            (audioOutExt === 'opus' && srcAudioBase === 'opus') ||
            ((audioOutExt === 'm4a' || audioOutExt === 'aac') && srcAudioBase === 'aac');

          reportProgress(20, 'TRANSFORMING', `Extracting ${audioOutExt.toUpperCase()} audio`);
          const res = await this.convertWithFfmpeg(
            job,
            verifiedLocalInputPath,
            audioOutPath,
            audioOutExt,
            true,
            canCopyAudio
          );
          actualLosslessPreserved = res.losslessStreamCopy;
          finalFilePath = audioOutPath;
        } else if (
          job.processingLane === 'power' ||
          job.operation === 'CONVERT_FORMAT' ||
          job.operation === 'TRANSCODE_VIDEO' ||
          job.streamCopy === false
        ) {
          reportProgress(15, 'TRANSFORMING', `Compressing video to ${targetExt.toUpperCase()}`);
          await this.compressVideoWithFfmpeg(
            job,
            verifiedLocalInputPath,
            outputPath,
            targetExt,
            targetHeight,
            inputProbe.durationSeconds ?? cachedAsset?.durationSeconds,
            reportProgress,
            15,
            85
          );
          actualLosslessPreserved = false;
          job.processingLane = 'power';
          finalFilePath = outputPath;
        } else {
          reportProgress(25, 'TRANSFORMING', `Instant stream-copy remux to ${targetExt.toUpperCase()}`);
          const res = await this.convertWithFfmpeg(job, verifiedLocalInputPath, outputPath, targetExt, false);
          actualLosslessPreserved = res.losslessStreamCopy;
          if (!res.losslessStreamCopy) {
            job.processingLane = 'power';
            job.strategyLabel = 'Power Format Conversion';
          }
          finalFilePath = outputPath;
        }
      } else if (job.operation === 'MERGE_AUDIO_VIDEO' && job.audioUrl) {
        const remoteMediaUrl = job.mediaUrl as string;
        const videoTpl = path.join(jobDir, 'video_src.%(ext)s');
        const audioTpl = path.join(jobDir, 'audio_src.%(ext)s');

        await this.runTrackedYtDlpWithFallback(
          job,
          (base) => [...base, '-o', videoTpl, remoteMediaUrl],
          onYtDlpLine
        );
        if (this.isCancelled(job)) return;

        reportProgress(55, 'FETCHING', 'Downloading external audio track');
        await this.runTrackedYtDlpWithFallback(
          job,
          (base) => [...base, '-o', audioTpl, job.audioUrl as string],
          onYtDlpLine
        );
        if (this.isCancelled(job)) return;

        const videoFile = await this.findGeneratedMediaFile(jobDir, 'video_src');
        const audioFile = await this.findGeneratedMediaFile(jobDir, 'audio_src');
        if (!videoFile || !audioFile) {
          throw new Error('Failed to retrieve both video and audio inputs for merge');
        }

        reportProgress(82, 'TRANSFORMING', `Combining video & audio into ${targetExt.toUpperCase()}`);
        const mergedPath = path.join(jobDir, `output.${targetExt}`);
        const offsetSec = (job.audioOffsetMs ?? 0) / 1000;
        const mergeArgs = [
          '-nostdin',
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
          '-protocol_whitelist',
          'file,crypto,data',
          '-i',
          videoFile,
          ...(offsetSec !== 0 ? ['-itsoffset', offsetSec.toFixed(3)] : []),
          '-i',
          audioFile,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-c:v',
          'copy',
          '-c:a',
          targetExt === 'webm' ? 'libopus' : 'aac',
          ...(targetExt === 'mp4' ? ['-movflags', '+faststart'] : []),
          '-shortest',
          mergedPath,
        ];
        await this.runTrackedProcess(job, 'ffmpeg', mergeArgs);
        actualLosslessPreserved = false;
        finalFilePath = mergedPath;
      } else if (isAudio) {
        const remoteMediaUrl = job.mediaUrl as string;
        const outputTemplate = path.join(jobDir, 'output.%(ext)s');

        await this.runTrackedYtDlpWithFallback(
          job,
          (base) => [
            ...base,
            '-x',
            '--audio-format',
            targetExt,
            '--audio-quality',
            '0',
            '-o',
            outputTemplate,
            remoteMediaUrl,
          ],
          onYtDlpLine
        );
        if (this.isCancelled(job)) return;

        const downloaded = await this.findGeneratedMediaFile(jobDir, 'output', targetExt);
        if (!downloaded) {
          throw new Error('Audio extraction completed but produced no output file');
        }

        const downloadedExt = path.extname(downloaded).toLowerCase().replace(/^\./, '');
        if (downloadedExt !== targetExt) {
          reportProgress(84, 'TRANSFORMING', `Converting audio to ${targetExt.toUpperCase()}`);
          const convertedPath = path.join(jobDir, `final.${targetExt}`);
          const res = await this.convertWithFfmpeg(job, downloaded, convertedPath, targetExt, true);
          actualLosslessPreserved = res.losslessStreamCopy;
          finalFilePath = convertedPath;
        } else {
          finalFilePath = downloaded;
        }
      } else {
        const remoteMediaUrl = job.mediaUrl as string;
        const outputTemplate = path.join(jobDir, 'output.%(ext)s');
        const targetHeight = parseResolutionHeight(job.targetResolution);
        const safeFormatId =
          job.formatId && /^[a-zA-Z0-9_+\-\/]+$/.test(job.formatId) ? job.formatId : null;

        const is4K8K = Boolean(
          (targetHeight && targetHeight >= 2160) ||
          (job.targetResolution && /^(?:4k|8k|2160p?|4320p?)/i.test(job.targetResolution))
        );
        const isRedditOrFacebook = Boolean(
          remoteMediaUrl && /(?:reddit\.com|redd\.it|facebook\.com|fb\.watch)/i.test(remoteMediaUrl)
        );

        let formatSelector: string;
        if (isRedditOrFacebook) {
          // Rule: Reddit/Facebook HD: bestvideo+bestaudio/best so audio is never dropped
          formatSelector = 'bestvideo+bestaudio/best';
        } else if (safeFormatId) {
          formatSelector = safeFormatId.includes('+') ? safeFormatId : `${safeFormatId}+bestaudio/best`;
        } else if (targetHeight) {
          formatSelector =
            targetExt === 'mp4'
              ? `bestvideo[height<=${targetHeight}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${targetHeight}]+bestaudio/best[height<=${targetHeight}][ext=mp4]/best[height<=${targetHeight}]/best`
              : `bestvideo[height<=${targetHeight}]+bestaudio/best[height<=${targetHeight}]/best`;
        } else {
          formatSelector =
            targetExt === 'mp4'
              ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best'
              : 'bestvideo+bestaudio/best';
        }

        await this.runTrackedYtDlpWithFallback(
          job,
          (base) => [
            ...base,
            '-f',
            formatSelector,
            '--merge-output-format',
            targetExt,
            '-o',
            outputTemplate,
            remoteMediaUrl,
          ],
          onYtDlpLine
        );
        if (this.isCancelled(job)) return;

        const downloaded = await this.findGeneratedMediaFile(jobDir, 'output', targetExt);
        if (!downloaded) {
          throw new Error('Media download completed but produced no output file');
        }

        const downloadedExt = path.extname(downloaded).toLowerCase().replace(/^\./, '');
        if (is4K8K) {
          // Rule: NEVER re-encode 4K/8K video (-c:v copy)
          if (downloadedExt !== targetExt) {
            reportProgress(84, 'TRANSFORMING', `Lossless 8K remuxing into ${targetExt.toUpperCase()}`);
            const remuxedPath = path.join(jobDir, `final.${targetExt}`);
            const ffmpegArgs = [
              '-y',
              '-hide_banner',
              '-loglevel', 'error',
              '-i', downloaded,
              '-c:v', 'copy',
            ];
            if (targetExt === 'mkv' || targetExt === 'webm') {
              // MKV/WebM: -c copy
              ffmpegArgs.push('-c:a', 'copy');
            } else {
              // MP4 at 4K/8K: -c:v copy -c:a aac -b:a 192k -movflags +faststart
              ffmpegArgs.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart');
            }
            ffmpegArgs.push(remuxedPath);
            await this.runTrackedProcess(job, 'ffmpeg', ffmpegArgs);
            actualLosslessPreserved = true;
            finalFilePath = remuxedPath;
          } else {
            actualLosslessPreserved = true;
            finalFilePath = downloaded;
          }
        } else if (job.operation === 'CONVERT_FORMAT' || job.operation === 'TRANSCODE_VIDEO' || job.streamCopy === false) {
          reportProgress(78, 'TRANSFORMING', `Compressing video to ${targetExt.toUpperCase()}`);
          const dlProbe = await verifyMediaWithFfprobe(downloaded).catch(() => ({
            durationSeconds: undefined,
            hasVideo: true,
            hasAudio: true,
          }));
          const compressedPath = path.join(jobDir, `final.${targetExt}`);
          await this.compressVideoWithFfmpeg(
            job,
            downloaded,
            compressedPath,
            targetExt,
            targetHeight,
            dlProbe.durationSeconds ?? cachedAsset?.durationSeconds,
            reportProgress,
            78,
            85
          );
          actualLosslessPreserved = false;
          job.processingLane = 'power';
          finalFilePath = compressedPath;
        } else if (downloadedExt !== targetExt) {
          reportProgress(84, 'TRANSFORMING', `Packaging media into ${targetExt.toUpperCase()}`);
          const convertedPath = path.join(jobDir, `final.${targetExt}`);
          const res = await this.convertWithFfmpeg(job, downloaded, convertedPath, targetExt, false);
          actualLosslessPreserved = res.losslessStreamCopy;
          if (!res.losslessStreamCopy) {
            job.processingLane = 'power';
            job.strategyLabel = 'Power Format Conversion';
          }
          finalFilePath = convertedPath;
        } else {
          actualLosslessPreserved = true;
          finalFilePath = downloaded;
        }
      }

      if (this.isCancelled(job)) return;

      if (!finalFilePath) {
        throw new Error('Media pipeline did not generate an output file');
      }

      const fileStat = await fsp.stat(finalFilePath).catch(() => null);
      if (!fileStat || !fileStat.isFile() || fileStat.size <= 0) {
        throw new Error('Generated output media file is missing or empty (0 bytes)');
      }

      job.status = 'VERIFYING';
      job.progress = 90;
      job.stage = 'VERIFYING';
      job.stageMessage = 'Checking output quality and integrity';
      job.losslessPreserved = actualLosslessPreserved;
      job.updatedAt = new Date().toISOString();
      this.persistJobUpsert(job);
      this.persistJobEvent(jobId, 'VERIFYING', 90, 'VERIFYING', job.stageMessage);

      this.emitProgress(jobId, {
        jobId,
        status: 'VERIFYING',
        progress: 90,
        stage: 'VERIFYING',
        message: job.stageMessage,
        processingLane: job.processingLane,
        queueClass: job.queueClass,
        strategyLabel: job.strategyLabel,
        losslessPreserved: job.losslessPreserved,
        retentionMinutes: job.retentionMinutes,
        timestamp: job.updatedAt,
      });

      const probeResult = await verifyMediaWithFfprobe(finalFilePath);
      if (this.isCancelled(job)) return;

      const checksumSha256 = await computeFileSha256(finalFilePath);
      if (this.isCancelled(job)) return;

      const actualExt = path.extname(finalFilePath).toLowerCase().replace(/^\./, '') || targetExt;
      const mimeType = getMimeTypeForExtension(actualExt);

      const inspectedTitle = job.mediaAssetId ? adapterService.getAsset(job.mediaAssetId)?.title : undefined;
      const derivedUrlTitle = job.mediaUrl ? deriveTitleFromUrl(job.mediaUrl) : undefined;
      const resolvedDisplayTitle = (job.inputTitle || inspectedTitle || derivedUrlTitle || '').trim();
      if (resolvedDisplayTitle && !job.inputTitle) {
        job.inputTitle = resolvedDisplayTitle;
      }
      const rawTitleStem = (resolvedDisplayTitle || `muxaro_media_${jobId.slice(0, 8)}`)
        .replace(/\.[a-z0-9]{2,5}$/i, '')
        .trim();
      const safeStem =
        sanitizeFilename(rawTitleStem, `muxaro_media_${jobId.slice(0, 8)}`)
          .replace(/_+/g, '_')
          .replace(/^_+|_+$/g, '')
          .replace(/\.+$/, '') || `muxaro_media_${jobId.slice(0, 8)}`;
      const itemPrefix = job.itemNumber ? `${job.itemNumber}_` : '';
      const filename = sanitizeFilename(
        `${itemPrefix}${safeStem}.${actualExt}`,
        `muxaro_media_${jobId.slice(0, 8)}.${actualExt}`
      );

      const artifactId = generatePrefixedId('art', 10);
      const expiresAt = new Date(Date.now() + ARTIFACT_TTL_MS).toISOString();
      const token = tokenService.generateDownloadToken({
        jobId,
        artifactId,
        filename,
        userId: job.ownerUserId,
        ttlSeconds: Math.round(ARTIFACT_TTL_MS / 1000),
      });
      const downloadUrl = `/api/v1/download/${token}`;

      const artifact: JobOutputArtifact = {
        artifactId,
        ownerUserId: job.ownerUserId,
        filePath: finalFilePath,
        filename,
        mimeType,
        sizeBytes: fileStat.size,
        container: actualExt,
        codec: probeResult.codec,
        durationSeconds: probeResult.durationSeconds,
        checksumSha256,
        downloadUrl,
        expiresAt,
      };

      const processingMs = Math.max(1, Date.now() - runStartMs);
      job.status = 'READY';
      job.progress = 100;
      job.stage = 'READY';
      job.stageMessage = 'Your media is ready to download.';
      job.losslessPreserved = actualLosslessPreserved;
      job.retentionMinutes = DEFAULT_RETENTION_MINUTES;
      job.processingMs = processingMs;
      job.artifact = artifact;
      job.downloadUrl = downloadUrl;
      job.completedAt = new Date().toISOString();
      job.expiresAt = expiresAt;
      job.updatedAt = job.completedAt;

      this.recordTierSample(tier, job.queueWaitMs ?? 0, processingMs);
      this.persistJobUpsert(job);
      this.persistArtifact(jobId, job.ownerUserId, artifact);
      this.persistJobEvent(jobId, 'READY', 100, 'READY', job.stageMessage);
      this.syncParentBatchStatus(job.batchId);
      recordAnalyticsEvent('job_completed', job.ownerUserId, tier, {
        operation: job.operation,
        processingLane: job.processingLane,
        queueWaitMs: job.queueWaitMs ?? 0,
        processingMs,
        sizeBytes: fileStat.size,
      });

      this.scheduleArtifactCleanup(jobId);

      if (job.reservationId) {
        try {
          await entitlementsService.commitQuota(job.reservationId);
        } catch {
          // Log commit error
        }
      }

      this.totalCompleted++;
      this.completedLastHour++;

      this.emitProgress(jobId, {
        jobId,
        status: 'READY',
        progress: 100,
        stage: 'READY',
        message: job.stageMessage,
        processingLane: job.processingLane,
        queueClass: job.queueClass,
        strategyLabel: job.strategyLabel,
        losslessPreserved: job.losslessPreserved,
        retentionMinutes: job.retentionMinutes,
        downloadUrl,
        artifact: stripInternalArtifactFields(artifact),
        timestamp: job.completedAt,
      });
    } catch (err: any) {
      await this.removeJobDir(jobId).catch(() => {});

      if (this.isCancelled(job)) return;

      const isBot = isBotVerificationError(err);
      const errorCode = isBot ? 'ERR_BOT_VERIFICATION_REQUIRED' : (err?.code || 'ERR_PROCESSING_FAILED');
      const errorMessage = isBot
        ? 'YouTube requires verification for this stream on cloud servers. Use MUXARO Direct to download seamlessly from your browser.'
        : (err?.message || 'Media worker encountered an unrecoverable error');
      const userMessage = mapHumanFriendlyError(errorCode, errorMessage);

      job.status = 'FAILED';
      job.stage = 'FAILED';
      job.stageMessage = userMessage;
      job.processingMs = Math.max(1, Date.now() - runStartMs);
      job.error = {
        code: errorCode,
        message: errorMessage,
        userMessage,
      };
      job.updatedAt = new Date().toISOString();

      this.persistJobUpsert(job);
      this.persistJobEvent(jobId, 'FAILED', job.progress, 'FAILED', userMessage);
      this.syncParentBatchStatus(job.batchId);
      recordAnalyticsEvent('job_failed', job.ownerUserId, tier, {
        operation: job.operation,
        errorCode,
      });

      this.totalFailed++;
      this.failedLastHour++;
      this.topErrorCode = errorCode;

      if (job.reservationId) {
        try {
          await entitlementsService.rollbackQuota(job.reservationId, 'Job failed during execution');
        } catch {
          // Log rollback error
        }
      }

      this.emitProgress(jobId, {
        jobId,
        status: 'FAILED',
        progress: job.progress,
        stage: 'FAILED',
        message: userMessage,
        processingLane: job.processingLane,
        queueClass: job.queueClass,
        strategyLabel: job.strategyLabel,
        losslessPreserved: job.losslessPreserved,
        retentionMinutes: job.retentionMinutes,
        error: {
          code: errorCode,
          message: errorMessage,
          userMessage,
        },
        timestamp: job.updatedAt,
      });
    }
  }

  private emitProgress(jobId: string, event: JobProgressEvent): void {
    this.emit(`job:${jobId}`, event);
  }
}

export const queueService = new QueueService();
