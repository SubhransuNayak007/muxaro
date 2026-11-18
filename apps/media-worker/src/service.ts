/**
 * MUXARO Media Processing Engine - Unified Service Orchestrator
 * High-level production service encapsulating probing, transcoding, audio extraction,
 * A/V merging, batch packaging, disk quotas, and integrity verification.
 */

import os from 'node:os';
import { FFprobeRunner } from './prober/ffprobe.js';
import { VideoTranscoder } from './transcoder/video.js';
import { AudioExtractor } from './transcoder/audio.js';
import { MediaMerger } from './merger/merger.js';
import { BatchPackager } from './packager/zipper.js';
import { ScratchDiskManager, DiskUsageStats } from './scratch/disk-manager.js';
import { OutputVerifier } from './verification/verifier.js';
import { FFmpegExecutor } from './process/executor.js';
import {
  MediaMetadata,
  VideoProcessingOptions,
  AudioExtractionOptions,
  MergeOptions,
  BatchPackagingOptions,
  ProcessingResult,
  OutputVerificationResult
} from './types/index.js';

export interface MediaWorkerConfig {
  ffmpegBinary?: string;
  ffprobeBinary?: string;
  scratchDirectory?: string;
  maxScratchSizeBytes?: number;
  retentionTtlMs?: number;
}

export interface WorkerHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  ffmpegVersion: string;
  ffprobeVersion: string;
  scratchStats: DiskUsageStats;
  system: {
    platform: string;
    cpus: number;
    freeMemoryBytes: number;
    totalMemoryBytes: number;
    loadAverage: number[];
  };
  timestamp: string;
}

export class MediaWorkerService {
  private prober: FFprobeRunner;
  private videoTranscoder: VideoTranscoder;
  private audioExtractor: AudioExtractor;
  private merger: MediaMerger;
  private packager: BatchPackager;
  private diskManager: ScratchDiskManager;
  private verifier: OutputVerifier;
  private ffmpegBinary: string;
  private ffprobeBinary: string;

  constructor(config: MediaWorkerConfig = {}) {
    this.ffmpegBinary = config.ffmpegBinary || process.env.FFMPEG_PATH || 'ffmpeg';
    this.ffprobeBinary = config.ffprobeBinary || process.env.FFPROBE_PATH || 'ffprobe';

    this.diskManager = new ScratchDiskManager({
      baseDirectory: config.scratchDirectory,
      maxSizeBytes: config.maxScratchSizeBytes,
      retentionTtlMs: config.retentionTtlMs
    });

    this.prober = new FFprobeRunner(this.ffprobeBinary);
    this.videoTranscoder = new VideoTranscoder(this.ffmpegBinary, this.ffprobeBinary);
    this.audioExtractor = new AudioExtractor(this.ffmpegBinary, this.ffprobeBinary);
    this.merger = new MediaMerger(this.ffmpegBinary, this.ffprobeBinary);
    this.packager = new BatchPackager();
    this.verifier = new OutputVerifier(this.prober);
  }

  // --- Workspace & Scratch Disk ---

  public createJobWorkspace(jobId: string): string {
    return this.diskManager.createJobWorkspace(jobId);
  }

  public async cleanupJobWorkspace(jobId: string): Promise<void> {
    return this.diskManager.cleanupJobWorkspace(jobId);
  }

  public getDiskStats(): DiskUsageStats {
    return this.diskManager.getUsageStats();
  }

  // --- Probing ---

  public async probe(inputPath: string, timeoutMs = 30000): Promise<MediaMetadata> {
    return this.prober.probe(inputPath, timeoutMs);
  }

  // --- Video Processing ---

  public async processVideo(options: VideoProcessingOptions): Promise<ProcessingResult> {
    return this.videoTranscoder.process(options);
  }

  // --- Audio Extraction ---

  public async extractAudio(options: AudioExtractionOptions): Promise<ProcessingResult> {
    return this.audioExtractor.extract(options);
  }

  // --- Audio/Video Merging ---

  public async mergeMedia(options: MergeOptions): Promise<ProcessingResult> {
    return this.merger.merge(options);
  }

  // --- Batch Packaging ---

  public async packageBatch(options: BatchPackagingOptions): Promise<ProcessingResult> {
    return this.packager.packageZip(options);
  }

  // --- Verification ---

  public async verifyOutput(
    filePath: string,
    options?: { expectedDurationSeconds?: number; requireVideo?: boolean; requireAudio?: boolean }
  ): Promise<OutputVerificationResult> {
    return this.verifier.verify(filePath, options);
  }

  // --- Health & Observability ---

  public async getHealth(): Promise<WorkerHealthStatus> {
    let ffmpegVersion = 'unavailable';
    let ffprobeVersion = 'unavailable';
    let isHealthy = true;

    try {
      const ffmpegRes = await FFmpegExecutor.execute(this.ffmpegBinary, ['-version'], { timeoutMs: 5000 });
      if (ffmpegRes.exitCode === 0) {
        const firstLine = ffmpegRes.stdout.split('\n')[0] || '';
        ffmpegVersion = firstLine.trim();
      } else {
        isHealthy = false;
      }
    } catch {
      isHealthy = false;
    }

    try {
      const ffprobeRes = await FFmpegExecutor.execute(this.ffprobeBinary, ['-version'], { timeoutMs: 5000 });
      if (ffprobeRes.exitCode === 0) {
        const firstLine = ffprobeRes.stdout.split('\n')[0] || '';
        ffprobeVersion = firstLine.trim();
      } else {
        isHealthy = false;
      }
    } catch {
      isHealthy = false;
    }

    const scratchStats = this.diskManager.getUsageStats();
    const isDegraded = scratchStats.percentUsed > 85;

    return {
      status: !isHealthy ? 'unhealthy' : isDegraded ? 'degraded' : 'healthy',
      ffmpegVersion,
      ffprobeVersion,
      scratchStats,
      system: {
        platform: process.platform,
        cpus: os.cpus().length,
        freeMemoryBytes: os.freemem(),
        totalMemoryBytes: os.totalmem(),
        loadAverage: os.loadavg()
      },
      timestamp: new Date().toISOString()
    };
  }
}
