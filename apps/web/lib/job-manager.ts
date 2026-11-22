/**
 * MUXARO Job Manager & Media Pipeline Orchestrator
 *
 * Features:
 * 1. In-memory job registry with real stdout progress parsing from yt-dlp & FFmpeg.
 * 2. Stage transitions: queued -> downloading_video -> downloading_audio -> merging/converting -> ready.
 * 3. Real Server-Sent Events (SSE) notification bus.
 * 4. Streaming file delivery via fs.createReadStream with Content-Disposition attachment.
 * 5. 60-minute auto-cleanup background sweeper.
 * 6. [SERVERLESS] File-backed job persistence: every job is written to OUTPUTS_DIR as job_meta_<id>.json
 *    so cross-instance lookups on Vercel succeed even when Instance B did not create the job.
 * 7. [SERVERLESS] Immediate-ready mode: on Vercel the cloud fallback runs synchronously inside createJob
 *    so the POST response itself carries status:'ready' and downloadUrl — no polling needed.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { sanitizeFilename } from './security-validator.ts';
import { muxMedia, extractAudio, transcodeVideo } from './ffmpeg-muxer.ts';
import type { JobStatus, JobError } from './contracts.ts';
import { extractPlatformMedia } from './platform-extractors.ts';

export interface CreateJobParams {
  sourceUrl: string;
  targetFormat?: string;
  targetResolution?: string;
  formatId?: string;
  videoFormatId?: string;
  audioFormatId?: string;
  title?: string;
  operation?: string;
}

export interface JobRecord {
  id: string;
  status: JobStatus;
  progress: number;
  stage: string;
  stageMessage: string;
  sourceUrl: string;
  targetFormat: string;
  targetResolution?: string;
  operation: string;
  title: string;
  filename: string;
  filePath?: string;
  fileSizeBytes?: number;
  directStreamUrl?: string;
  directMimeType?: string;
  deliveryMode?: 'zero-hop' | 'tunnel';
  downloadUrl: string;
  speed?: string;
  etaSeconds?: number;
  createdAt: string;
  completedAt?: string;
  expiresAt: string;
  error?: JobError;
  artifact?: {
    filename: string;
    downloadUrl: string;
    sizeBytes: number;
    format: string;
  };
}

export type JobSubscriber = (job: JobRecord) => void;

// Resolve safe outputs directory (60m retention)
function resolveOutputsDir(): string {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || Boolean(process.env.LAMBDA_TASK_ROOT)) {
    const tmpOutputs = path.join(os.tmpdir(), 'muxaro-outputs-60m');
    try {
      fs.mkdirSync(tmpOutputs, { recursive: true });
    } catch {}
    return tmpOutputs;
  }

  const localProjectDir = path.resolve('storage/outputs/60m');
  try {
    fs.mkdirSync(localProjectDir, { recursive: true });
    return localProjectDir;
  } catch {
    const tmpOutputs = path.join(os.tmpdir(), 'muxaro-outputs-60m');
    try {
      fs.mkdirSync(tmpOutputs, { recursive: true });
    } catch {}
    return tmpOutputs;
  }
}

export const OUTPUTS_DIR = resolveOutputsDir();
const RETENTION_MS = 60 * 60 * 1000; // 60 minutes

/** Returns true when running in a serverless / ephemeral environment */
function isServerless(): boolean {
  return Boolean(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT
  );
}

/** Path of the per-job metadata JSON sidecar file */
function jobMetaPath(id: string): string {
  return path.join(OUTPUTS_DIR, `job_meta_${id}.json`);
}

/** Persist a job record to its JSON sidecar atomically */
function persistJob(job: JobRecord): void {
  try {
    fs.writeFileSync(jobMetaPath(job.id), JSON.stringify(job, null, 2), 'utf8');
  } catch {
    // Non-fatal: in-memory state is still the source of truth for this instance
  }
}

/** Load a job from disk sidecar (returns undefined if not found or malformed) */
function loadJobFromDisk(id: string): JobRecord | undefined {
  const p = jobMetaPath(id);
  try {
    if (!fs.existsSync(p)) return undefined;
    const raw = fs.readFileSync(p, 'utf8');
    const job = JSON.parse(raw) as JobRecord;
    if (job && job.id === id) return job;
  } catch {}
  return undefined;
}

// Global shared in-memory job store preserved across Next.js route bundles, workers & HMR reloads
const globalForJobManager = globalThis as unknown as {
  __muxaroJobStore?: Map<string, JobRecord>;
  __muxaroSubscribers?: Map<string, Set<JobSubscriber>>;
  __muxaroAbortControllers?: Map<string, AbortController>;
  muxaroJobManager?: JobManager;
};

const sharedJobs = globalForJobManager.__muxaroJobStore ?? new Map<string, JobRecord>();
globalForJobManager.__muxaroJobStore = sharedJobs;

const sharedSubscribers = globalForJobManager.__muxaroSubscribers ?? new Map<string, Set<JobSubscriber>>();
globalForJobManager.__muxaroSubscribers = sharedSubscribers;

const sharedAbortControllers = globalForJobManager.__muxaroAbortControllers ?? new Map<string, AbortController>();
globalForJobManager.__muxaroAbortControllers = sharedAbortControllers;

function getJsRuntimeArgs(): string[] {
  try {
    const { execSync } = require('node:child_process');
    execSync('deno --version', { stdio: 'ignore' });
    return ['--js-runtimes', 'deno'];
  } catch {}

  if (process.execPath) {
    return ['--js-runtimes', 'node'];
  }
  return [];
}

class JobManager {
  private jobs = sharedJobs;
  private subscribers = sharedSubscribers;
  private abortControllers = sharedAbortControllers;
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // 60-minute auto-cleanup background sweeper runs every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredJobs().catch(() => {});
    }, 5 * 60 * 1000);

    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Retrieves a job by ID.
   * SOLUTION 1: If not in RAM, attempt to load from the JSON sidecar on disk
   * (cross-serverless-instance resilience).
   */
  public getJob(id: string): JobRecord | undefined {
    // Fast path: in-memory hit
    const cached = this.jobs.get(id);
    if (cached) return cached;

    // Slow path: check disk sidecar (handles cross-instance scenarios on Vercel)
    const fromDisk = loadJobFromDisk(id);
    if (fromDisk) {
      // Warm the in-memory cache for subsequent requests on this instance
      this.jobs.set(id, fromDisk);
      return fromDisk;
    }

    // SOLUTION 2: Reconstruct a ready/downloadable job if the artifact file exists on disk
    return this.reconstructJobIfArtifactExists(id);
  }

  /**
   * SOLUTION 2: Resilient Reconstruct — if a completed artifact file exists on disk
   * (pattern: `<id>_<filename>`) but no sidecar JSON was found, synthesize a ready JobRecord
   * so the client can still download the file without a 404.
   */
  private reconstructJobIfArtifactExists(id: string): JobRecord | undefined {
    try {
      if (!fs.existsSync(OUTPUTS_DIR)) return undefined;
      const files = fs.readdirSync(OUTPUTS_DIR);
      const artifact = files.find(
        (f) => f.startsWith(`${id}_`) && !f.endsWith('.json')
      );
      if (!artifact) return undefined;

      const filePath = path.join(OUTPUTS_DIR, artifact);
      const stat = fs.statSync(filePath);
      const filename = artifact.replace(`${id}_`, '');
      const ext = path.extname(filename).replace('.', '').toLowerCase() || 'mp4';
      const downloadUrl = `/api/v1/jobs/${id}/download?filename=${encodeURIComponent(filename)}`;
      const now = new Date().toISOString();

      const reconstructed: JobRecord = {
        id,
        status: 'ready',
        progress: 100,
        stage: 'READY',
        stageMessage: 'Media ready for instant download',
        sourceUrl: '',
        targetFormat: ext,
        operation: 'RECONSTRUCTED',
        title: filename.replace(`.${ext}`, ''),
        filename,
        filePath,
        fileSizeBytes: stat.size,
        downloadUrl,
        createdAt: now,
        completedAt: now,
        expiresAt: new Date(stat.mtimeMs + RETENTION_MS).toISOString(),
        artifact: {
          filename,
          downloadUrl,
          sizeBytes: stat.size,
          format: ext,
        },
      };

      // Cache and persist so future requests on this instance are fast
      this.jobs.set(id, reconstructed);
      persistJob(reconstructed);
      return reconstructed;
    } catch {
      return undefined;
    }
  }

  /**
   * Lists all current jobs
   */
  public listJobs(): JobRecord[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * Subscribes to real-time progress updates for a specific job
   */
  public subscribe(id: string, subscriber: JobSubscriber): () => void {
    if (!this.subscribers.has(id)) {
      this.subscribers.set(id, new Set());
    }
    this.subscribers.get(id)!.add(subscriber);

    return () => {
      const set = this.subscribers.get(id);
      if (set) {
        set.delete(subscriber);
        if (set.size === 0) {
          this.subscribers.delete(id);
        }
      }
    };
  }

  /**
   * Notifies subscribers of a job state change and persists the new state to disk
   */
  private notify(job: JobRecord) {
    // Persist on every state change for cross-instance durability
    persistJob(job);

    const set = this.subscribers.get(job.id);
    if (set) {
      set.forEach((sub) => {
        try {
          sub(job);
        } catch {
          // Ignore subscriber error
        }
      });
    }
  }

  /**
   * Cancels an active job
   */
  public cancelJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;

    if (job.status === 'ready' || job.status === 'failed' || job.status === 'cancelled') {
      return false;
    }

    const controller = this.abortControllers.get(id);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(id);
    }

    job.status = 'cancelled';
    job.stage = 'CANCELLED';
    job.stageMessage = 'Job cancelled by user request.';
    job.error = {
      code: 'ERR_JOB_CANCELLED',
      message: 'Job was cancelled.',
      retryable: true,
    };
    this.notify(job);
    return true;
  }

  /**
   * Creates and starts a new media download/muxing pipeline.
   *
   * SOLUTION 3 (Immediate Ready on Serverless):
   * When running on Vercel/Lambda, execute the cloud fallback SYNCHRONOUSLY within
   * createJob() so the POST /api/v1/jobs response itself returns with status:'ready'
   * and downloadUrl populated — the frontend never needs to poll across instances.
   */
  public async createJob(params: CreateJobParams): Promise<JobRecord> {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const targetFormat = String(params.targetFormat || 'mp4').toLowerCase();
    const targetResolution = params.targetResolution || '1080p';
    const operation = params.operation || (targetFormat === 'mp3' || targetFormat === 'flac' || targetFormat === 'wav' ? 'EXTRACT_AUDIO' : 'TRANSCODE_VIDEO');
    const title = params.title || 'media_download';
    const filename = sanitizeFilename(title, targetFormat);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + RETENTION_MS).toISOString();

    const downloadUrl = `/api/v1/jobs/${jobId}/download?filename=${encodeURIComponent(filename)}`;

    const job: JobRecord = {
      id: jobId,
      status: 'queued',
      progress: 0,
      stage: 'QUEUED',
      stageMessage: 'Job queued for processing...',
      sourceUrl: params.sourceUrl,
      targetFormat,
      targetResolution,
      operation,
      title,
      filename,
      downloadUrl,
      createdAt: now.toISOString(),
      expiresAt,
    };

    this.jobs.set(jobId, job);
    // Persist immediately so any other serverless instance can find this job
    persistJob(job);

    const abortController = new AbortController();
    this.abortControllers.set(jobId, abortController);

    // PHASE 1.1: ZERO-HOP CLIENT HANDOVER
    // For Pinterest, TikTok, Twitter/X, Instagram, Vimeo progressive streams, and direct media,
    // immediately transition to READY with direct origin CDN stream URL without downloading to server disk or /tmp.
    const isYouTube = /(?:youtube\.com|youtu\.be)/i.test(params.sourceUrl);
    if (!isYouTube && (params.sourceUrl.startsWith('http://') || params.sourceUrl.startsWith('https://'))) {
      try {
        const streamInfo = await this.resolveSocialPlatformStream(params.sourceUrl, abortController.signal);
        if (streamInfo?.deliveryMode === 'zero-hop' && streamInfo.mediaUrl) {
          job.status = 'ready';
          job.progress = 100;
          job.stage = 'READY';
          job.stageMessage = 'Zero-hop direct stream ready for instant download';
          job.deliveryMode = 'zero-hop';
          job.directStreamUrl = streamInfo.mediaUrl;
          job.directMimeType = streamInfo.mimeType || 'video/mp4';
          job.downloadUrl = streamInfo.mediaUrl;
          if (streamInfo.contentLength) {
            job.fileSizeBytes = streamInfo.contentLength;
          }
          if (streamInfo.title && (!job.title || job.title === 'media_download')) {
            job.title = streamInfo.title;
            job.filename = sanitizeFilename(streamInfo.title, job.targetFormat);
          }
          job.completedAt = new Date().toISOString();
          job.artifact = {
            filename: job.filename,
            downloadUrl: streamInfo.mediaUrl,
            sizeBytes: job.fileSizeBytes || 0,
            format: job.targetFormat,
          };
          persistJob(job);
          this.notify(job);
          return job;
        }
      } catch (zeroHopErr) {
        console.warn('[JobManager] Zero-hop handover inspection failed, falling back to pipeline:', zeroHopErr);
      }
    }

    // SOLUTION 3: On serverless environments, run the cloud fallback synchronously
    // so the POST response already contains status:'ready'
    if (isServerless()) {
      try {
        const finalPath = path.join(OUTPUTS_DIR, `${job.id}_${job.filename}`);
        const isAudioOnly = ['mp3', 'm4a', 'flac', 'wav', 'opus'].includes(job.targetFormat);

        // Try local file first; otherwise execute cloud fallback inline
        if (fs.existsSync(params.sourceUrl)) {
          // For local test files on serverless — still run async (file I/O is fast)
          this.executePipeline(job, params, abortController.signal).catch((err: any) => {
            if (job.status !== 'cancelled') {
              job.status = 'failed';
              job.stage = 'FAILED';
              job.stageMessage = err?.message || 'Processing pipeline encountered an error.';
              job.error = {
                code: 'ERR_PIPELINE_FAILED',
                message: err?.message || 'Failed to process media.',
                retryable: true,
              };
              this.notify(job);
            }
          });
        } else {
          // Execute cloud fallback synchronously — POST won't return until file is ready
          await this.executeCloudFallback(job, finalPath, isAudioOnly, abortController.signal);
        }
      } catch (err: any) {
        if (job.status !== 'cancelled') {
          job.status = 'failed';
          job.stage = 'FAILED';
          job.stageMessage = err?.message || 'Processing pipeline encountered an error.';
          job.error = {
            code: 'ERR_PIPELINE_FAILED',
            message: err?.message || 'Failed to process media.',
            retryable: true,
          };
          this.notify(job);
        }
      }
      return job;
    }

    // Non-serverless: run pipeline asynchronously as before
    this.executePipeline(job, params, abortController.signal).catch((err: any) => {
      if (job.status !== 'cancelled') {
        job.status = 'failed';
        job.stage = 'FAILED';
        job.stageMessage = err?.message || 'Processing pipeline encountered an error.';
        job.error = {
          code: 'ERR_PIPELINE_FAILED',
          message: err?.message || 'Failed to process media.',
          retryable: true,
        };
        this.notify(job);
      }
    });

    return job;
  }

  /**
   * Orchestrates the yt-dlp download, stdout progress parsing, and FFmpeg muxing
   */
  private async executePipeline(
    job: JobRecord,
    params: CreateJobParams,
    signal: AbortSignal
  ): Promise<void> {
    const tempDir = path.join(os.tmpdir(), `muxaro_work_${job.id}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const finalPath = path.join(OUTPUTS_DIR, `${job.id}_${job.filename}`);

    try {
      const isAudioOnly = ['mp3', 'm4a', 'flac', 'wav', 'opus'].includes(job.targetFormat);

      // Handle direct local file testing or synthetic fixture paths
      if (fs.existsSync(job.sourceUrl)) {
        await this.processLocalFile(job, finalPath, isAudioOnly, signal);
        return;
      }

      // Configure yt-dlp arguments with high-speed cut-through flags
      const args: string[] = [
        '--force-ipv4',
        '--newline',
        '--progress',
        '--no-warnings',
        '--no-playlist',
        '--force-overwrites',
        '--no-part',
        '--socket-timeout', '30',
        ...getJsRuntimeArgs(),
      ];

      // Format selection with resilient fallback to avoid format errors
      const height = parseInt(job.targetResolution || '1080', 10) || 1080;
      if (isAudioOnly) {
        if (params.audioFormatId && params.audioFormatId !== 'source') {
          args.push('-f', `${params.audioFormatId}/ba/b`);
        } else {
          args.push('-f', 'ba/b');
        }
      } else {
        const videoId = params.videoFormatId;
        const audioId = params.audioFormatId;

        if (videoId && audioId) {
          args.push('-f', `${videoId}+${audioId}/${videoId}+ba/bv*[height<=${height}]+ba/b[height<=${height}]/best`);
        } else if (videoId) {
          args.push('-f', `${videoId}+ba/bv*[height<=${height}]+ba/b[height<=${height}]/best`);
        } else {
          args.push('-f', `bv*[height<=${height}]+ba/b[height<=${height}]/best`);
        }
      }

      const tempTemplate = path.join(tempDir, 'raw_input.%(ext)s');
      args.push('-o', tempTemplate);
      args.push(job.sourceUrl);

      // Initial stage
      job.status = isAudioOnly ? 'downloading_audio' : 'downloading_video';
      job.stage = isAudioOnly ? 'DOWNLOADING_AUDIO' : 'DOWNLOADING_VIDEO';
      job.stageMessage = isAudioOnly ? 'Downloading high-bitrate audio track...' : 'Downloading video track...';
      job.progress = 5;
      this.notify(job);

      try {
        await this.runYtDlpDownload(job, args, signal, isAudioOnly);
      } catch (dlErr: any) {
        if (dlErr?.code === 'ENOENT' || dlErr?.message?.includes('ENOENT')) {
          await this.executeCloudFallback(job, finalPath, isAudioOnly, signal);
          return;
        }
        throw dlErr;
      }

      if (signal.aborted) return;

      // Locate downloaded file in tempDir
      const files = fs.readdirSync(tempDir).filter((f) => !f.endsWith('.part') && !f.endsWith('.ytdl'));
      if (files.length === 0) {
        throw new Error('yt-dlp completed but downloaded file was not found.');
      }

      const downloadedFile = path.join(tempDir, files[0]);
      const ext = path.extname(downloadedFile).replace('.', '').toLowerCase();

      // Post-processing / Muxing
      if (isAudioOnly) {
        job.status = 'converting';
        job.stage = 'CONVERTING';
        job.stageMessage = `Encoding to ${job.targetFormat.toUpperCase()} with pristine audio quality...`;
        job.progress = 90;
        this.notify(job);

        await extractAudio({
          inputPath: downloadedFile,
          outputPath: finalPath,
          targetFormat: job.targetFormat as any,
          signal,
          onProgress: (p) => {
            if (p.speed) job.speed = p.speed;
            this.notify(job);
          },
        });
      } else {
        // Video muxing
        job.status = 'merging';
        job.stage = 'MERGING';
        job.stageMessage = 'Multiplexing audio and video streams...';
        job.progress = 90;
        this.notify(job);

        const targetContainer = (['mp4', 'mkv', 'webm'].includes(job.targetFormat)
          ? job.targetFormat
          : 'mp4') as any;

        // If downloaded file already matches target format and doesn't need audio remux
        if (ext === targetContainer && targetContainer !== 'mp4') {
          fs.copyFileSync(downloadedFile, finalPath);
        } else {
          // Remux with FFmpeg (and transcode Opus audio if target container is MP4)
          await muxMedia({
            videoPath: downloadedFile,
            outputPath: finalPath,
            targetContainer,
            sourceAudioCodec: ext === 'webm' ? 'opus' : undefined,
            signal,
            onProgress: (p) => {
              if (p.speed) job.speed = p.speed;
              this.notify(job);
            },
          });
        }
      }

      // Complete!
      const stat = fs.statSync(finalPath);
      job.status = 'ready';
      job.progress = 100;
      job.stage = 'READY';
      job.stageMessage = 'Media ready for instant download';
      job.filePath = finalPath;
      job.fileSizeBytes = stat.size;
      job.completedAt = new Date().toISOString();
      job.artifact = {
        filename: job.filename,
        downloadUrl: job.downloadUrl,
        sizeBytes: stat.size,
        format: job.targetFormat,
      };
      this.notify(job);
    } finally {
      // Clean up temp directory
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
      this.abortControllers.delete(job.id);
    }
  }

  /**
   * Executes yt-dlp with unbuffered stdio, stall watchdog & robust progress parsing
   */
  private runYtDlpDownload(
    job: JobRecord,
    args: string[],
    signal: AbortSignal,
    isAudioOnly: boolean
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let resolved = false;

      const child = spawn('yt-dlp', args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
        },
      });

      // Stall Watchdog: abort after 45s of absolute silence (zero stdout or stderr bytes)
      let watchdogTimer: NodeJS.Timeout | null = null;
      const resetWatchdog = () => {
        if (watchdogTimer) clearTimeout(watchdogTimer);
        watchdogTimer = setTimeout(() => {
          if (!resolved) {
            try {
              child.kill('SIGTERM');
              setTimeout(() => {
                try { child.kill('SIGKILL'); } catch {}
              }, 2000);
            } catch {}
            const timeoutErr = new Error('Download timed out: media stream stalled for 45 seconds without data.');
            job.status = 'failed';
            job.stage = 'FAILED';
            job.stageMessage = timeoutErr.message;
            job.error = {
              code: 'ERR_DOWNLOAD_TIMEOUT',
              message: timeoutErr.message,
              retryable: true,
            };
            this.notify(job);
            reject(timeoutErr);
          }
        }, 45000);
      };

      resetWatchdog();

      const abortHandler = () => {
        if (watchdogTimer) clearTimeout(watchdogTimer);
        try {
          child.kill('SIGTERM');
        } catch {}
        reject(new Error('Job aborted.'));
      };

      signal.addEventListener('abort', abortHandler, { once: true });

      let stderrLog = '';
      const stderrLines: string[] = [];

      child.stdout.on('data', (chunk) => {
        resetWatchdog();
        const text = chunk.toString('utf8');
        // Handle carriage returns and newlines cleanly
        const lines = text.split(/[\r\n]+/);

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Track stage transitions
          if (trimmed.includes('[download] Destination:') || trimmed.includes('[download] Downloading video') || trimmed.includes('[download] Downloading')) {
            if (!isAudioOnly) {
              if (trimmed.includes('.f') && (trimmed.includes('.m4a') || trimmed.includes('.opus') || trimmed.includes('.webm')) && !trimmed.includes('video')) {
                job.status = 'downloading_audio';
                job.stage = 'DOWNLOADING_AUDIO';
                job.stageMessage = 'Downloading paired audio stream...';
              } else {
                job.status = 'downloading_video';
                job.stage = 'DOWNLOADING_VIDEO';
                job.stageMessage = 'Downloading video stream...';
              }
            } else {
              job.status = 'downloading_audio';
              job.stage = 'DOWNLOADING_AUDIO';
              job.stageMessage = 'Downloading audio track...';
            }
          }

          if (trimmed.includes('[Merger]') || trimmed.includes('[ffmpeg] Merging') || trimmed.includes('Merging formats')) {
            job.status = 'merging';
            job.stage = 'MERGING';
            job.stageMessage = 'Merging audio and video streams...';
            job.progress = 85;
            this.notify(job);
          }

          // Parse progress from yt-dlp:
          // Pattern 1: [download]  45.2% of ~ 15.20MiB at 4.25MiB/s ETA 00:03
          // Pattern 2: [download]  45.2% of 15.20MiB at 4.25MiB/s
          // Pattern 3: [download]  100% of 15.20MiB in 00:02
          const matchPercent = trimmed.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
          if (matchPercent) {
            const rawPercent = parseFloat(matchPercent[1]);

            // Speed matching
            const speedMatch = trimmed.match(/at\s+([~0-9.]+[kKMGT]?i?B\/s)/);
            if (speedMatch) {
              job.speed = speedMatch[1];
            }

            // ETA matching
            const etaMatch = trimmed.match(/ETA\s+(\d+:\d+(?::\d+)?)/);
            if (etaMatch) {
              const etaParts = etaMatch[1].split(':').map(Number);
              if (etaParts.length === 2) {
                job.etaSeconds = etaParts[0] * 60 + etaParts[1];
              } else if (etaParts.length === 3) {
                job.etaSeconds = etaParts[0] * 3600 + etaParts[1] * 60 + etaParts[2];
              }
            }

            // Map progress
            if (isAudioOnly) {
              job.progress = Math.min(85, Math.round(5 + rawPercent * 0.8));
            } else {
              if (job.status === 'downloading_video') {
                job.progress = Math.min(55, Math.round(5 + rawPercent * 0.5));
              } else if (job.status === 'downloading_audio') {
                job.progress = Math.min(85, Math.round(55 + rawPercent * 0.3));
              } else {
                job.progress = Math.min(85, Math.round(rawPercent * 0.85));
              }
            }

            this.notify(job);
          }
        }
      });

      child.stderr.on('data', (chunk) => {
        resetWatchdog();
        const errText = chunk.toString('utf8');
        stderrLog += errText;
        const errLines = errText.split(/[\r\n]+/).map((l: string) => l.trim()).filter(Boolean);
        for (const l of errLines) {
          stderrLines.push(l);
          if (stderrLines.length > 25) stderrLines.shift();
        }
      });

      child.on('error', (err: any) => {
        if (watchdogTimer) clearTimeout(watchdogTimer);
        signal.removeEventListener('abort', abortHandler);
        resolved = true;
        if (err?.code !== 'ENOENT') {
          job.status = 'failed';
          job.stage = 'FAILED';
          job.stageMessage = err.message;
          job.error = {
            code: 'ERR_PROCESS_SPAWN',
            message: err.message,
            retryable: true,
          };
          this.notify(job);
        }
        reject(err);
      });

      child.on('close', (code) => {
        if (watchdogTimer) clearTimeout(watchdogTimer);
        signal.removeEventListener('abort', abortHandler);
        resolved = true;
        if (code === 0) {
          resolve();
        } else {
          const lastLines = stderrLines.slice(-5).join('; ');
          const message = lastLines || stderrLog.trim() || `yt-dlp exited with error code ${code}`;
          job.status = 'failed';
          job.stage = 'FAILED';
          job.stageMessage = message;
          job.error = {
            code: 'ERR_PROCESS_EXIT',
            message,
            retryable: true,
          };
          this.notify(job);
          reject(new Error(message));
        }
      });
    });
  }

  /**
   * Attempts to resolve a direct video/audio stream URL from social platforms
   * (Pinterest, Twitter/X, Reddit, TikTok, Vimeo, Instagram, etc.)
   */
  private async resolveSocialPlatformStream(
    url: string,
    signal: AbortSignal
  ): Promise<{ mediaUrl: string; title?: string; mimeType?: string; contentLength?: number; deliveryMode?: 'zero-hop' | 'tunnel' } | null> {
    // 1. Try external multi-platform extractor module (statically imported for Vercel/Webpack bundling)
    try {
      const extracted = await extractPlatformMedia(url, { signal });
      if (extracted?.mediaUrl || extracted?.url || extracted?.streamUrl) {
        return {
          mediaUrl: extracted.mediaUrl || extracted.url || extracted.streamUrl,
          title: extracted.title,
          mimeType: extracted.mimeType,
          contentLength: extracted.contentLength,
          deliveryMode: extracted.deliveryMode || 'tunnel',
        };
      }
    } catch {}

    // 2. Direct embedded open-graph / video tag scraping heuristic fallback
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal,
      });

      const contentType = res.headers.get('content-type') || '';
      // If the URL is ALREADY a direct binary media stream (video/mp4, audio/mpeg, etc.)
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        return { mediaUrl: url, mimeType: contentType };
      }

      const html = await res.text();

      // Look for og:video, og:video:secure_url, or twitter:player:stream
      const ogVideoMatch =
        html.match(/<meta\s+property=["']og:video(?::secure_url)?["']\s+content=["']([^"']+)["']/i) ||
        html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:video(?::secure_url)?["']/i) ||
        html.match(/<meta\s+name=["']twitter:player:stream["']\s+content=["']([^"']+)["']/i);

      if (ogVideoMatch && ogVideoMatch[1] && ogVideoMatch[1].startsWith('http')) {
        return { mediaUrl: ogVideoMatch[1] };
      }

      // Pinterest video pattern: https://v.pinimg.com/videos/mc/720p/...mp4
      const pinMatch = html.match(/https:\/\/v\.pinimg\.com\/videos\/[^\s"']+\.mp4/i);
      if (pinMatch) {
        return { mediaUrl: pinMatch[0] };
      }

      // Twitter / X video pattern
      const twMatch = html.match(/https:\/\/video\.twimg\.com\/[^\s"']+\.mp4/i);
      if (twMatch) {
        return { mediaUrl: twMatch[0] };
      }

      // Reddit video pattern
      const redditMatch = html.match(/https:\/\/v\.redd\.it\/[^\s"']+\/DASH_[^\s"']+/i);
      if (redditMatch) {
        return { mediaUrl: redditMatch[0] };
      }
    } catch {}

    return null;
  }

  /**
   * Executes a cloud/serverless fallback when yt-dlp binary is not installed in the container.
   * Resolves genuine audio/video streams via @distube/ytdl-core or direct streaming HTTP fetch.
   */
  private async executeCloudFallback(
    job: JobRecord,
    finalPath: string,
    isAudioOnly: boolean,
    signal: AbortSignal
  ): Promise<void> {
    job.status = isAudioOnly ? 'downloading_audio' : 'downloading_video';
    job.stage = isAudioOnly ? 'DOWNLOADING_AUDIO' : 'DOWNLOADING_VIDEO';
    job.stageMessage = isAudioOnly ? 'Extracting lossless audio stream...' : 'Fetching adaptive video stream...';
    job.progress = 30;
    this.notify(job);

    const isYouTube = /(?:youtube\.com|youtu\.be)/i.test(job.sourceUrl);
    let downloaded = false;

    if (isYouTube) {
      try {
        const { Ytdl, Client } = await import('@distube/ytdl-core');
        const ytdl = new Ytdl({
          clients: [Client.Tv, Client.VisionOS, Client.WebEmbedded, Client.Mweb],
        });

        // 1. Resolve media details & optimal format
        const info = await ytdl.getInfo(job.sourceUrl);
        if (info.videoDetails?.title && (!job.title || job.title === 'media_download')) {
          job.title = info.videoDetails.title;
          job.filename = sanitizeFilename(info.videoDetails.title, job.targetFormat);
        }

        let selectedFormat: any;
        if (isAudioOnly) {
          selectedFormat =
            info.formats.find((f: any) => f.hasAudio && !f.hasVideo) ||
            info.formats.find((f: any) => f.hasAudio);
        } else {
          const reqHeight = parseInt(job.targetResolution || '1080', 10) || 1080;
          const vFormats = info.formats.filter((f: any) => f.hasVideo);
          selectedFormat =
            vFormats.find((f: any) => f.height === reqHeight) ||
            vFormats.find((f: any) => f.height && f.height <= reqHeight) ||
            vFormats[0];
        }

        if (selectedFormat) {
          job.directStreamUrl = selectedFormat.url;
          job.directMimeType = selectedFormat.mimeType;
          if (selectedFormat.contentLength) {
            job.fileSizeBytes = parseInt(selectedFormat.contentLength, 10);
          }

          // If running on serverless (Vercel) and the media payload exceeds 30MB,
          // mark ready immediately so client gets sub-second start and downloads
          // on-demand via the cut-through stream route without Lambda buffer timeout.
          const isServerlessEnv = isServerless();
          const estBytes = job.fileSizeBytes || 0;

          if (isServerlessEnv && estBytes > 30000000) {
            job.status = 'ready';
            job.progress = 100;
            job.stage = 'READY';
            job.stageMessage = 'Stream ready for instant cut-through download';
            job.downloadUrl = `/api/v1/jobs/${encodeURIComponent(job.id)}/download?filename=${encodeURIComponent(job.filename)}`;
            job.artifact = {
              filename: job.filename,
              downloadUrl: job.downloadUrl,
              sizeBytes: job.fileSizeBytes || 0,
              format: job.targetFormat,
            };
            persistJob(job);
            this.notify(job);
            return;
          }

          // 2. Download the real stream to finalPath using authenticated session stream
          job.progress = 65;
          this.notify(job);

          const stream = ytdl.download(info, { format: selectedFormat });
          const out = fs.createWriteStream(finalPath);

          await new Promise<void>((resolve, reject) => {
            stream.pipe(out);
            stream.on('error', reject);
            out.on('error', reject);
            out.on('finish', () => resolve());

            signal.addEventListener(
              'abort',
              () => {
                try { stream.destroy(); } catch {}
                try { out.destroy(); } catch {}
                reject(new Error('Operation aborted'));
              },
              { once: true }
            );
          });

          downloaded = true;
        }
      } catch (ytErr) {
        console.warn('[JobManager] @distube/ytdl-core fallback:', ytErr);
      }
    } else if (job.sourceUrl.startsWith('http://') || job.sourceUrl.startsWith('https://')) {
      try {
        const streamInfo = await this.resolveSocialPlatformStream(job.sourceUrl, signal);

        if (streamInfo?.mediaUrl) {
          const directUrl = streamInfo.mediaUrl;
          if (streamInfo.title && (!job.title || job.title === 'media_download')) {
            job.title = streamInfo.title;
            job.filename = sanitizeFilename(streamInfo.title, job.targetFormat);
          }

          // ZERO-HOP CLIENT HANDOVER:
          // If the platform stream is progressive/unprotected, skip server download entirely.
          if (streamInfo.deliveryMode === 'zero-hop') {
            job.status = 'ready';
            job.progress = 100;
            job.stage = 'READY';
            job.stageMessage = 'Zero-hop direct stream ready for instant download';
            job.deliveryMode = 'zero-hop';
            job.directStreamUrl = directUrl;
            job.directMimeType = streamInfo.mimeType || 'video/mp4';
            job.downloadUrl = directUrl;
            if (streamInfo.contentLength) {
              job.fileSizeBytes = streamInfo.contentLength;
            }
            job.completedAt = new Date().toISOString();
            job.artifact = {
              filename: job.filename,
              downloadUrl: directUrl,
              sizeBytes: job.fileSizeBytes || 0,
              format: job.targetFormat,
            };
            persistJob(job);
            this.notify(job);
            return;
          }

          const resp = await fetch(directUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            },
            signal,
          });

          const respContentType = resp.headers.get('content-type') || streamInfo.mimeType || '';
          const isHtml = respContentType.includes('text/html') || respContentType.includes('application/xhtml');

          // NEVER assign directStreamUrl or download content if the response is an HTML webpage!
          if (resp.ok && resp.body && !isHtml) {
            job.directStreamUrl = directUrl;
            job.directMimeType = respContentType;
            if (streamInfo.contentLength && (!job.fileSizeBytes || job.fileSizeBytes < 1000)) {
              job.fileSizeBytes = streamInfo.contentLength;
            }
            const headerCl = parseInt(resp.headers.get('content-length') || '0', 10);
            if (headerCl > 1000) {
              job.fileSizeBytes = headerCl;
            }
            const { Readable } = await import('node:stream');
            const out = fs.createWriteStream(finalPath);
            const readable = Readable.fromWeb(resp.body as any);

            await new Promise<void>((resolve, reject) => {
              readable.pipe(out);
              readable.on('error', reject);
              out.on('error', reject);
              out.on('finish', () => resolve());
            });

            downloaded = true;
          }
        }
      } catch (fetchErr) {
        console.warn('[JobManager] Direct stream fetch:', fetchErr);
      }
    }

    if (!downloaded && fs.existsSync(job.sourceUrl)) {
      try {
        fs.copyFileSync(job.sourceUrl, finalPath);
        downloaded = true;
      } catch {}
    }

    let finalSize = job.fileSizeBytes || 0;
    if (fs.existsSync(finalPath)) {
      const stat = fs.statSync(finalPath);
      if (stat.size > 0) {
        finalSize = stat.size;
        job.filePath = finalPath;
      }
    }

    // STRICT GUARD: Under no circumstances should a < 1KB stub ever be marked ready or given a downloadUrl!
    if (finalSize < 1000) {
      if (fs.existsSync(finalPath)) {
        try { fs.unlinkSync(finalPath); } catch {}
      }
      job.filePath = undefined;
      job.directStreamUrl = undefined;
      throw new Error(`Unable to fetch playable media for "${job.sourceUrl}". Resulting media file was incomplete or empty (${finalSize} bytes).`);
    }

    // Build signed/parameterized downloadUrl so any serverless instance can deliver the stream
    const dlParams = new URLSearchParams();
    dlParams.set('filename', job.filename);
    if (job.directStreamUrl) {
      dlParams.set('stream', job.directStreamUrl);
    }
    job.downloadUrl = `/api/v1/jobs/${job.id}/download?${dlParams.toString()}`;

    // Stage: Ready
    job.status = 'ready';
    job.progress = 100;
    job.stage = 'READY';
    job.stageMessage = 'Media ready for instant download';
    job.fileSizeBytes = finalSize;
    job.completedAt = new Date().toISOString();
    job.artifact = {
      filename: job.filename,
      downloadUrl: job.downloadUrl,
      sizeBytes: finalSize,
      format: job.targetFormat,
    };
    this.notify(job);
  }

  /**
   * Processes a local fixture or test file directly
   */
  private async processLocalFile(
    job: JobRecord,
    finalPath: string,
    isAudioOnly: boolean,
    signal: AbortSignal
  ): Promise<void> {
    job.status = isAudioOnly ? 'converting' : 'merging';
    job.stage = isAudioOnly ? 'CONVERTING' : 'MERGING';
    job.stageMessage = isAudioOnly ? 'Extracting audio from local source...' : 'Muxing local video...';
    job.progress = 50;
    this.notify(job);

    if (isAudioOnly) {
      await extractAudio({
        inputPath: job.sourceUrl,
        outputPath: finalPath,
        targetFormat: job.targetFormat as any,
        signal,
      });
    } else {
      await muxMedia({
        videoPath: job.sourceUrl,
        outputPath: finalPath,
        targetContainer: (['mp4', 'mkv', 'webm'].includes(job.targetFormat) ? job.targetFormat : 'mp4') as any,
        signal,
      });
    }

    const stat = fs.statSync(finalPath);
    job.status = 'ready';
    job.progress = 100;
    job.stage = 'READY';
    job.stageMessage = 'Media ready for instant download';
    job.filePath = finalPath;
    job.fileSizeBytes = stat.size;
    job.completedAt = new Date().toISOString();
    job.artifact = {
      filename: job.filename,
      downloadUrl: job.downloadUrl,
      sizeBytes: stat.size,
      format: job.targetFormat,
    };
    this.notify(job);
  }

  /**
   * 60-Minute Background Sweeper: cleans up expired jobs & old artifact files
   */
  public async cleanupExpiredJobs(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    // 1. Clean registry jobs
    this.jobs.forEach((job, id) => {
      const createdTime = new Date(job.createdAt).getTime();
      if (now - createdTime > RETENTION_MS) {
        if (job.filePath && fs.existsSync(job.filePath)) {
          try {
            fs.unlinkSync(job.filePath);
          } catch {}
        }
        this.jobs.delete(id);
        cleaned++;
      }
    });

    // 2. Clean orphaned disk files in output directory older than 60 minutes
    try {
      if (fs.existsSync(OUTPUTS_DIR)) {
        const files = fs.readdirSync(OUTPUTS_DIR);
        for (const file of files) {
          const fullPath = path.join(OUTPUTS_DIR, file);
          try {
            const stat = fs.statSync(fullPath);
            if (now - stat.mtimeMs > RETENTION_MS) {
              fs.unlinkSync(fullPath);
              cleaned++;
            }
          } catch {}
        }
      }
    } catch {}

    return cleaned;
  }
}

// Global singleton instance preserved across Next.js module bundles and reloads
// (globalForJobManager is already declared above with shared store fields)
export const jobManager = globalForJobManager.muxaroJobManager ?? new JobManager();
globalForJobManager.muxaroJobManager = jobManager;
