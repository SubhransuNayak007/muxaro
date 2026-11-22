/**
 * MUXARO Job Manager & Media Pipeline Orchestrator
 * 
 * Features:
 * 1. In-memory job registry with real stdout progress parsing from yt-dlp & FFmpeg.
 * 2. Stage transitions: queued -> downloading_video -> downloading_audio -> merging/converting -> ready.
 * 3. Real Server-Sent Events (SSE) notification bus.
 * 4. Streaming file delivery via fs.createReadStream with Content-Disposition attachment.
 * 5. 60-minute auto-cleanup background sweeper.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { sanitizeFilename } from './security-validator.ts';
import { muxMedia, extractAudio, transcodeVideo } from './ffmpeg-muxer.ts';
import type { JobStatus, JobError } from './contracts.ts';

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
  const localProjectDir = path.resolve('storage/outputs/60m');
  try {
    fs.mkdirSync(localProjectDir, { recursive: true });
    return localProjectDir;
  } catch {
    const tmpOutputs = path.join(os.tmpdir(), 'muxaro-outputs-60m');
    fs.mkdirSync(tmpOutputs, { recursive: true });
    return tmpOutputs;
  }
}

export const OUTPUTS_DIR = resolveOutputsDir();
const RETENTION_MS = 60 * 60 * 1000; // 60 minutes

class JobManager {
  private jobs = new Map<string, JobRecord>();
  private subscribers = new Map<string, Set<JobSubscriber>>();
  private abortControllers = new Map<string, AbortController>();
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
   * Retrieves a job by ID
   */
  public getJob(id: string): JobRecord | undefined {
    return this.jobs.get(id);
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
   * Notifies subscribers of a job state change
   */
  private notify(job: JobRecord) {
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
   * Creates and starts a new media download/muxing pipeline
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
    const abortController = new AbortController();
    this.abortControllers.set(jobId, abortController);

    // Run pipeline asynchronously
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

      // Configure yt-dlp arguments
      const args: string[] = [
        '--newline',
        '--no-warnings',
        '--no-playlist',
        '--socket-timeout', '30',
      ];

      // Format selection
      if (isAudioOnly) {
        if (params.audioFormatId && params.audioFormatId !== 'source') {
          args.push('-f', params.audioFormatId);
        } else {
          args.push('-f', 'ba/b');
        }
      } else {
        const videoId = params.videoFormatId;
        const audioId = params.audioFormatId;

        if (videoId && audioId) {
          args.push('-f', `${videoId}+${audioId}/${videoId}+ba/${videoId}/best`);
        } else if (videoId) {
          args.push('-f', `${videoId}+ba/${videoId}/best`);
        } else {
          const height = parseInt(job.targetResolution || '1080', 10) || 1080;
          args.push('-f', `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`);
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

      await this.runYtDlpDownload(job, args, signal, isAudioOnly);

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
   * Executes yt-dlp and parses stdout progress lines
   */
  private runYtDlpDownload(
    job: JobRecord,
    args: string[],
    signal: AbortSignal,
    isAudioOnly: boolean
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('yt-dlp', args, {
        shell: false,
        windowsHide: true,
      });

      const abortHandler = () => {
        try {
          child.kill('SIGTERM');
        } catch {}
        reject(new Error('Job aborted.'));
      };

      signal.addEventListener('abort', abortHandler, { once: true });

      let stderrLog = '';

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        const lines = text.split(/\r?\n/);

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Track stage transitions
          if (trimmed.includes('[download] Destination:') || trimmed.includes('[download] Downloading video')) {
            if (!isAudioOnly) {
              if (trimmed.includes('.f') && trimmed.includes('.mp4') || trimmed.includes('video')) {
                job.status = 'downloading_video';
                job.stage = 'DOWNLOADING_VIDEO';
                job.stageMessage = 'Downloading video stream...';
              } else if (trimmed.includes('.f') && trimmed.includes('.m4a') || trimmed.includes('audio')) {
                job.status = 'downloading_audio';
                job.stage = 'DOWNLOADING_AUDIO';
                job.stageMessage = 'Downloading paired audio stream...';
              }
            }
          }

          if (trimmed.includes('[Merger] Merging formats into') || trimmed.includes('[ffmpeg] Merging')) {
            job.status = 'merging';
            job.stage = 'MERGING';
            job.stageMessage = 'Merging audio and video streams...';
            job.progress = 85;
            this.notify(job);
          }

          // Parse progress: [download]  45.2% of ~ 15.20MiB at 4.25MiB/s ETA 00:03
          const match = trimmed.match(
            /\[download\]\s+(\d+\.?\d*)%\s+of\s+~?(\S+)\s+at\s+(\S+)\s+ETA\s+(\S+)/
          );

          if (match) {
            const rawPercent = parseFloat(match[1]);
            const speed = match[3];
            const etaStr = match[4];

            job.speed = speed;

            // Convert ETA (HH:MM:SS or MM:SS) to seconds
            const etaParts = etaStr.split(':').map(Number);
            if (etaParts.length === 2) {
              job.etaSeconds = etaParts[0] * 60 + etaParts[1];
            } else if (etaParts.length === 3) {
              job.etaSeconds = etaParts[0] * 3600 + etaParts[1] * 60 + etaParts[2];
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
        stderrLog += chunk.toString('utf8');
        if (stderrLog.length > 4000) {
          stderrLog = stderrLog.slice(-2000);
        }
      });

      child.on('error', (err) => {
        signal.removeEventListener('abort', abortHandler);
        reject(err);
      });

      child.on('close', (code) => {
        signal.removeEventListener('abort', abortHandler);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderrLog.trim() || `yt-dlp exited with code ${code}`));
        }
      });
    });
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

// Global singleton instance
export const jobManager = new JobManager();
