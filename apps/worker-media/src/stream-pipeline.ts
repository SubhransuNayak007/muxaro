/**
 * MUXARO Media Processing Platform - Zero-Copy Stream Pipeline
 * 
 * Implements direct-to-R2 streaming via FFmpeg stdout piped directly to
 * @aws-sdk/lib-storage Upload, eliminating intermediate disk serialization.
 * 
 * Hardening & Security Features:
 * - Strictly spawn with { shell: false }, never exec()
 * - True zero-copy upstream piping from yt-dlp in streaming mode into FFmpeg stdin
 * - SSRF defense via assertSafeMediaUrl for remote URLs
 * - Sandbox containment via validateSandboxPath strictly for local file paths
 * - Graceful age-restriction detection and actionable user error messaging
 * - Resilient storage sink: pipes directly to local disk (storage/artifacts/${storageKey}) when S3/MinIO is offline
 * - Hardened -protocol_whitelist pipe (for streams) or file,pipe (for files)
 * - Zero network/http/https/crypto demuxers allowed inside ffmpeg (SSRF/HLS immune)
 * - Enforces hard limits: -threads 4, -t 14400, -fs 4294967296 (4 GB ceiling)
 * - Passes -movflags frag_keyframe+empty_moov+default_base_moof for fragmented MP4/MOV streaming
 * - Emits real-time progress parsed from stderr (out_time_us, speed, fps) to Redis Pub/Sub & state store
 * - Full AbortSignal and timeout support with clean child process termination
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { PassThrough, type Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import {
  CONTAINER_MIME_TYPES,
  MuxaroError,
  assertSafeMediaUrl,
  type ContainerFormat,
  type JobProgressEvent,
} from '@muxaro/shared';
import { getMuxaroRedis, type MuxaroRedisClient } from '@muxaro/db';
import { getS3Client, getR2BucketName } from './s3-client.js';
import {
  EcoModeEngine,
  type ProbedMediaMetadata,
  type EcoEnforcementPlan,
  type EcoSavingsEstimate,
} from './eco-mode.js';
import type { MediaJobPayload, PipelineProcessingResult } from './types.js';
import {
  safeProbeMedia,
  validateSandboxPath,
  parseFps,
  type SafeProbeResult,
  type SafeProbeOptions,
} from './security/hardened-ffprobe.js';

// Re-export prober functions and types
export {
  safeProbeMedia,
  validateSandboxPath,
  type SafeProbeResult,
  type SafeProbeOptions,
};

// =============================================================================
// 1. CONFIGURATION & INTERFACES
// =============================================================================

export interface StreamPipelineOptions {
  readonly job: MediaJobPayload;
  readonly inputStream?: Readable;
  readonly s3Client?: S3Client;
  readonly bucketName?: string;
  readonly redisClient?: MuxaroRedisClient;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';
const YTDLP_BIN = process.env.YTDLP_PATH || 'yt-dlp';

function getExecutionEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const customPaths = [
    'C:\\Users\\sbhrn\\.deno\\bin',
    'C:\\Users\\sbhrn\\AppData\\Local\\Programs\\Python\\Python312\\Scripts',
    'C:\\Users\\sbhrn\\AppData\\Local\\Programs\\Python\\Python312',
    path.join(os.homedir(), '.deno', 'bin'),
  ];
  const existingPath = env.PATH || env.Path || '';
  env.PATH = `${customPaths.join(';')};${existingPath}`;
  env.Path = env.PATH;
  return env;
}

/**
 * Resolves local artifact file paths ensuring compatible directory structures
 * for both /storage/artifacts/${storageKey} and /storage/${storageKey}
 */
export function getStorageArtifactPath(storageKey: string): { artifactPath: string; directPath: string } {
  let rootDir = process.cwd();
  if (!fs.existsSync(path.join(rootDir, 'apps'))) {
    const parent1 = path.resolve(rootDir, '..');
    const parent2 = path.resolve(rootDir, '../..');
    if (fs.existsSync(path.join(parent1, 'apps'))) {
      rootDir = parent1;
    } else if (fs.existsSync(path.join(parent2, 'apps'))) {
      rootDir = parent2;
    }
  }

  const cleanKey = storageKey.replace(/^\/+/, '');
  const artifactPath = path.resolve(rootDir, 'storage/artifacts', cleanKey);
  const directPath = path.resolve(rootDir, 'storage', cleanKey);
  return { artifactPath, directPath };
}

// =============================================================================
// 2. HARDENED FFPROBE METADATA PROBER DELEGATE
// =============================================================================

/**
 * Safely probes input media by delegating to hardened safeProbeMedia.
 * Enforces strict sandbox containment, format whitelisting, and resource ceilings.
 */
export async function probeInputMedia(
  inputSource: string,
  timeoutMs: number = 20_000
): Promise<ProbedMediaMetadata> {
  const result = await safeProbeMedia(inputSource, { timeoutMs });
  return {
    formatName: result.formatName,
    durationSeconds: result.durationSeconds,
    sizeBytes: result.sizeBytes,
    bitrate: result.bitrate,
    video: result.video,
    audio: result.audio,
  };
}

// =============================================================================
// 3. ZERO-COPY STREAM PIPELINE RUNNER
// =============================================================================

export class StreamPipeline {
  /**
   * Executes an end-to-end media job with zero-copy stream piping into Cloudflare R2 / S3
   * or resilient local disk fallback when storage is offline.
   */
  public static async execute(options: StreamPipelineOptions): Promise<PipelineProcessingResult> {
    const startTime = Date.now();
    const { job, signal } = options;
    const s3Client = options.s3Client || getS3Client();
    const bucketName = options.bucketName || getR2BucketName();
    const redis = options.redisClient || getMuxaroRedis();

    // 1. Resolve input source: URL, uploaded storage key, or readable stream
    const isExplicitStream = Boolean(options.inputStream);
    let inputSource = job.sourceUrl || job.inputStorageKey || '';
    if (!inputSource && job.uploadSessionId) {
      const uploadCandidates = [
        path.resolve(process.cwd(), '.muxaro-uploads', job.uploadSessionId),
        path.resolve(process.cwd(), 'storage/uploads', job.uploadSessionId),
        path.resolve(os.tmpdir(), job.uploadSessionId),
      ];
      for (const dir of uploadCandidates) {
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          if (files.length > 0) {
            inputSource = path.join(dir, files[0]);
            break;
          }
        }
      }
    }
    if (!inputSource && !isExplicitStream) {
      throw new MuxaroError('No source URL, input storage key, or stream provided', 'BAD_REQUEST', 400);
    }

    const isRemoteUrl = !isExplicitStream && (Boolean(job.sourceUrl) || /^https?:\/\//i.test(inputSource));
    const targetExt = (job.targetFormat || 'mp4').toLowerCase() as ContainerFormat;
    let isPipedInput = isExplicitStream;
    let upstreamChild: ChildProcess | null = null;
    let upstreamStderr = '';
    let upstreamError: Error | null = null;
    let inputStream: Readable | undefined = options.inputStream;

    if (isRemoteUrl) {
      // 1a. SSRF defense via URL guard
      const safeInfo = await assertSafeMediaUrl(inputSource);
      inputSource = safeInfo.canonicalUrl || inputSource;

      const isYouTube = /(?:youtube\.com|youtu\.be)/i.test(inputSource);

      // 1b. Spawn yt-dlp in streaming mode (--js-runtimes deno,node -q --no-warnings -o -)
      const ytdlpArgs = [
        '--js-runtimes', 'deno,node',
        '-q',
        '--no-warnings',
        '--force-ipv4',
      ];

      const cookieCandidates = [
        process.env.YTDLP_COOKIES_FILE,
        path.resolve(process.cwd(), '.muxaro-data', 'cookies.txt'),
        path.resolve(process.cwd(), 'storage', 'cookies.txt'),
        path.resolve(os.tmpdir(), 'muxaro-data', 'cookies.txt'),
      ].filter((p): p is string => Boolean(p && fs.existsSync(p)));

      if (cookieCandidates.length > 0) {
        ytdlpArgs.push('--cookies', cookieCandidates[0]);
      }

      if (!safeInfo.isPlaylist && job.tool !== 'batch_playlist') {
        ytdlpArgs.push('--no-playlist');
      }
      const isRedditOrFacebook = /(?:reddit\.com|redd\.it|facebook\.com|fb\.watch)/i.test(inputSource);
      const is8K = Boolean(
        (job.targetResolution && /^(?:8k|4320p?)/i.test(job.targetResolution)) ||
        (job.targetResolution && job.targetResolution.includes('4320'))
      );
      const is4K = Boolean(
        (job.targetResolution && /^(?:4k|2160p?)/i.test(job.targetResolution)) ||
        (job.targetResolution && job.targetResolution.includes('2160'))
      );

      if (job.tool === 'extract_audio') {
        ytdlpArgs.push('-f', 'ba/b');
      } else if (is8K) {
        // Enforce 8K Lossless Remuxing Rules: Pair best 8K video stream with best audio
        const format8k = targetExt === 'mp4'
          ? 'bestvideo[height>=4320][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height>=4320]+bestaudio/bestvideo[height<=4320][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=4320]+bestaudio/bestvideo+bestaudio/best'
          : 'bestvideo[height>=4320]+bestaudio/bestvideo[height<=4320]+bestaudio/bestvideo+bestaudio/best';
        ytdlpArgs.push(
          '-f', format8k,
          '--merge-output-format', 'mkv',
          '--buffer-size', '32M',
          '--http-chunk-size', '10M'
        );
      } else if (isRedditOrFacebook || is4K) {
        // Enforce 4K Lossless Remuxing Rules: Reddit/Facebook HD & 4K: bestvideo+bestaudio/best so audio is never dropped
        ytdlpArgs.push(
          '-f', 'bestvideo+bestaudio/best',
          '--merge-output-format', 'mkv',
          '--buffer-size', '16M'
        );
      } else {
        ytdlpArgs.push('-f', 'bv*[height<=1080]+ba/b[height<=1080]/best');
      }
      ytdlpArgs.push('-o', '-', inputSource);

      upstreamChild = spawn(YTDLP_BIN, ytdlpArgs, {
        shell: false,
        windowsHide: true,
        env: getExecutionEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      upstreamChild.stdout?.on('error', () => {});
      upstreamChild.stderr?.on('error', () => {});
      upstreamChild.stdin?.on('error', () => {});

      upstreamChild.stderr?.on('data', (d: Buffer) => {
        const text = d.toString('utf-8');
        upstreamStderr = (upstreamStderr + text).slice(-8192);
      });

      upstreamChild.on('error', (err) => {
        upstreamError = new MuxaroError(`yt-dlp spawn failed: ${err.message}`, 'INTERNAL_ERROR', 500);
        terminateChild('yt-dlp spawn error');
      });

      upstreamChild.on('close', (code) => {
        if (code !== 0 && !isTerminated) {
          if (StreamPipeline.isAgeRestricted(upstreamStderr)) {
            upstreamError = new MuxaroError(
              'This YouTube video is age-restricted and requires sign-in. Please use a public video or direct media URL.',
              'UNPROCESSABLE_ENTITY',
              422
            );
          } else {
            const cleanErr = StreamPipeline.extractYtDlpErrorMessage(upstreamStderr);
            upstreamError = new MuxaroError(`yt-dlp exited with code ${code}: ${cleanErr}`, 'EXTRACTION_FAILED', 502);
          }
          terminateChild(`yt-dlp exited with code ${code}`);
        }
      });

      if (upstreamChild.stdout) {
        inputStream = upstreamChild.stdout as Readable;
        isPipedInput = true;
      }
    } else if (!isPipedInput) {
      if (!fs.existsSync(inputSource)) {
        const { directPath } = getStorageArtifactPath(inputSource);
        if (fs.existsSync(directPath)) {
          inputSource = directPath;
        }
      }
      // Only call validateSandboxPath for local file paths!
      inputSource = validateSandboxPath(inputSource);
    }

    // 2. Run FFprobe on source to extract stream topology & codecs
    let probe: ProbedMediaMetadata;
    if (isPipedInput) {
      probe = {
        durationSeconds: job.totalDurationSeconds || 0,
        video: job.videoCodec ? {
          codec: job.videoCodec,
          width: 0,
          height: job.targetResolution ? (Number.parseInt(job.targetResolution.replace(/[^\d]/g, ''), 10) || 0) : 0,
        } : undefined,
        audio: job.audioCodec ? {
          codec: job.audioCodec,
        } : undefined,
      };
    } else {
      try {
        probe = await probeInputMedia(inputSource);
      } catch (probeErr) {
        // If direct probing fails on a remote URL, fallback to minimal duration or throw
        if (job.totalDurationSeconds && job.totalDurationSeconds > 0) {
          probe = { durationSeconds: job.totalDurationSeconds };
        } else {
          probe = { durationSeconds: 0 };
        }
      }
    }

    const durationSeconds = probe.durationSeconds || job.totalDurationSeconds || 0;

    // 3. Formulate Eco Mode execution plan
    const plan = EcoModeEngine.planExecution(job, probe);
    const savings = EcoModeEngine.estimateSavings(plan, durationSeconds);

    // 4. Construct target storage key & content type
    const storageKey = `outputs/${job.retentionTier}/${job.jobId}.${targetExt}`;
    const outputFilename = `${job.title ? sanitizeFilename(job.title) : job.jobId}.${targetExt}`;
    const mimeType = CONTAINER_MIME_TYPES[targetExt] || 'application/octet-stream';

    // 5. Construct safe FFmpeg argument array
    const ffmpegArgs = StreamPipeline.buildFFmpegArgs(inputSource, plan, targetExt, isPipedInput);

    // 6. Spawn FFmpeg process with pipe streaming
    const { childProcess, outputStream } = StreamPipeline.spawnFFmpeg(ffmpegArgs, inputStream);

    // 7. Track process lifecycle & abort signal
    let isTerminated = false;
    let accumulatedStderr = '';
    let lastProgressTime = 0;
    let lastProgressPercent = 0;
    let lastProcessedBytes = 0;
    let timedOut = false;
    let fileWriter: fs.WriteStream | null = null;

    const terminateChild = (reason: string) => {
      if (isTerminated) return;
      isTerminated = true;

      const killProc = (proc: ChildProcess | null) => {
        if (!proc || !proc.pid) return;
        try {
          if (proc.stdin) {
            try { proc.stdin.destroy(); } catch {}
          }
          if (process.platform === 'win32') {
            const tk = spawn('taskkill', ['/pid', proc.pid.toString(), '/T', '/F'], {
              shell: false,
              windowsHide: true,
            });
            tk.on('error', () => {
              try { proc.kill(); } catch {}
            });
          } else {
            proc.kill('SIGTERM');
            const killTimer = setTimeout(() => {
              try {
                if (!proc.killed) {
                  proc.kill('SIGKILL');
                }
              } catch {}
            }, 2500);
            killTimer.unref?.();
          }
        } catch {}
      };

      if (upstreamChild) {
        killProc(upstreamChild);
      }
      killProc(childProcess);

      if (fileWriter) {
        try { fileWriter.destroy(); } catch {}
      }
      if (outputStream) {
        try { outputStream.destroy(); } catch {}
      }
    };

    const executionTimeoutMs = options.timeoutMs ?? (14400 * 1000);
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminateChild('FFmpeg execution timed out');
      if (upload) {
        upload.abort().catch(() => {});
      }
    }, executionTimeoutMs);
    timeoutTimer.unref?.();

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timeoutTimer);
        terminateChild('AbortSignal initially triggered');
        throw new MuxaroError('Job cancelled by client', 'CANCELLED', 499);
      }
      signal.addEventListener('abort', () => {
        terminateChild('AbortSignal triggered during processing');
        if (upload) {
          upload.abort().catch(() => {});
        }
      });
    }

    // 8. Resilient storage sink: Check if S3 / MinIO is offline
    const isS3Offline = await StreamPipeline.checkIfS3Offline(s3Client, bucketName);
    let upload: Upload | null = null;
    let localFilePromise: Promise<number> | null = null;
    const { artifactPath, directPath } = getStorageArtifactPath(storageKey);

    if (isS3Offline) {
      // Offline sink: pipe FFmpeg output stream directly to local disk at storage/artifacts/${storageKey} with mkdirp
      fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
      fs.mkdirSync(path.dirname(directPath), { recursive: true });

      fileWriter = fs.createWriteStream(artifactPath);
      outputStream.pipe(fileWriter);

      localFilePromise = new Promise<number>((resolve, reject) => {
        fileWriter!.on('finish', () => {
          try {
            const stats = fs.statSync(artifactPath);
            // Also link / copy to direct storage path for immediate API route accessibility
            try {
              if (artifactPath !== directPath) {
                if (fs.existsSync(directPath)) {
                  fs.unlinkSync(directPath);
                }
                fs.linkSync(artifactPath, directPath);
              }
            } catch {
              try {
                fs.copyFileSync(artifactPath, directPath);
              } catch {}
            }
            resolve(stats.size);
          } catch {
            resolve(0);
          }
        });
        fileWriter!.on('error', (err) => {
          reject(new MuxaroError(`Failed writing artifact to disk: ${err.message}`, 'INTERNAL_ERROR', 500));
        });
      });
    } else {
      // Online sink: setup S3 Multipart Upload directly from FFmpeg stdout stream
      upload = new Upload({
        client: s3Client,
        params: {
          Bucket: bucketName,
          Key: storageKey,
          Body: outputStream,
          ContentType: mimeType,
        },
        partSize: 8 * 1024 * 1024, // 8 MB chunks for optimal R2 throughput
        queueSize: 4,
        leavePartsOnError: false,
      });

      if (signal) {
        signal.addEventListener('abort', () => {
          upload?.abort().catch(() => {});
        });
      }
    }

    // 9. Stderr progress parser
    childProcess.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      accumulatedStderr = (accumulatedStderr + text).slice(-8192); // Keep last 8 KB

      const parsed = StreamPipeline.parseStderrProgress(text, durationSeconds);
      if (parsed) {
        if (parsed.processedBytes) {
          lastProcessedBytes = parsed.processedBytes;
        }
        const now = Date.now();
        // Throttle updates to at most once per 400ms unless progress stepped up significantly
        if (now - lastProgressTime >= 400 || parsed.progressPercent - lastProgressPercent >= 3) {
          lastProgressTime = now;
          lastProgressPercent = parsed.progressPercent;

          const progressEvent: JobProgressEvent = {
            jobId: job.jobId,
            status: 'processing',
            stage: plan.isStreamCopy ? 'remuxing' : 'encoding',
            progressPercent: parsed.progressPercent,
            speed: parsed.speed,
            etaSeconds: parsed.etaSeconds,
            processedBytes: parsed.processedBytes,
            message: plan.isStreamCopy
              ? `Zero-copy stream remuxing (${parsed.progressPercent.toFixed(1)}%)`
              : `Transcoding to ${targetExt} (${parsed.progressPercent.toFixed(1)}%)`,
            timestamp: new Date().toISOString(),
          };

          redis.publishJobEvent(job.jobId, progressEvent).catch(() => {});
          const r = redis as any;
          if (typeof r.updateJobState === 'function') {
            r.updateJobState(job.jobId, {
              progressPercent: parsed.progressPercent,
              stage: progressEvent.stage,
              stageMessage: progressEvent.message,
            }).catch(() => {});
          }
        }
      }
    });

    // 10. Execute storage upload/write and wait for FFmpeg child process to finish
    try {
      const storagePromise = isS3Offline
        ? localFilePromise!
        : upload!.done();

      // Attach catch handler immediately to prevent UnhandledPromiseRejection if FFmpeg fails first
      storagePromise.catch(() => {});

      const ffmpegPromise = new Promise<void>((resolve, reject) => {
        childProcess.on('error', (err) => {
          clearTimeout(timeoutTimer);
          terminateChild('FFmpeg process failed to spawn');
          reject(new MuxaroError(`FFmpeg process failed to spawn: ${err.message}`, 'INTERNAL_ERROR', 500));
        });

        childProcess.on('close', (code) => {
          clearTimeout(timeoutTimer);
          if (timedOut) {
            return reject(new MuxaroError('FFmpeg execution timed out', 'GATEWAY_TIMEOUT', 504));
          }
          if (signal?.aborted) {
            return reject(new MuxaroError('Job cancelled by client', 'CANCELLED', 499));
          }
          if (upstreamError) {
            return reject(upstreamError);
          }
          if (StreamPipeline.isAgeRestricted(upstreamStderr)) {
            return reject(
              new MuxaroError(
                'This YouTube video is age-restricted and requires sign-in. Please use a public video or direct media URL.',
                'UNPROCESSABLE_ENTITY',
                422
              )
            );
          }
          if (code !== 0) {
            terminateChild(`FFmpeg exited with error code ${code}`);
            const msg = StreamPipeline.extractFFmpegErrorMessage(accumulatedStderr) || upstreamStderr.slice(-300);
            return reject(
              new MuxaroError(`FFmpeg exited with error code ${code}: ${msg}`, 'TRANSCODE_FAILED', 500)
            );
          }
          resolve();
        });
      });

      // Attach catch handler immediately to prevent UnhandledPromiseRejection if storage fails first
      ffmpegPromise.catch(() => {});

      const [storageResult] = await Promise.all([storagePromise, ffmpegPromise]);

      let sizeBytes = 0;
      if (isS3Offline && typeof storageResult === 'number') {
        sizeBytes = storageResult;
      } else {
        try {
          if (fs.existsSync(artifactPath)) {
            sizeBytes = fs.statSync(artifactPath).size;
          }
        } catch {}
      }
      if (sizeBytes === 0 && lastProcessedBytes > 0) {
        sizeBytes = lastProcessedBytes;
      }

      const processingTimeMs = Date.now() - startTime;

      // 11. Emit 100% completion event
      const completionEvent: JobProgressEvent = {
        jobId: job.jobId,
        status: 'completed',
        stage: 'ready',
        progressPercent: 100.0,
        message: 'Processing complete and artifact ready for download',
        timestamp: new Date().toISOString(),
      };
      await redis.publishJobEvent(job.jobId, completionEvent);
      const r = redis as any;
      if (typeof r.updateJobState === 'function') {
        r.updateJobState(job.jobId, {
          progressPercent: 100.0,
          stage: 'ready',
          stageMessage: 'Processing complete and artifact ready for download',
        }).catch(() => {});
      }

      return {
        success: true,
        jobId: job.jobId,
        storageKey,
        filename: outputFilename,
        mimeType,
        sizeBytes,
        durationSeconds,
        isStreamCopy: plan.isStreamCopy,
        processingTimeMs,
        computeSavedWh: savings.computeSavedWh,
        co2SavedGrams: savings.co2SavedGrams,
        publicUrl: isS3Offline ? `/v1/downloads/file/${storageKey}` : undefined,
      };
    } catch (err: any) {
      clearTimeout(timeoutTimer);
      terminateChild('Error during pipeline execution');

      if (StreamPipeline.isAgeRestricted(upstreamStderr)) {
        throw new MuxaroError(
          'This YouTube video is age-restricted and requires sign-in. Please use a public video or direct media URL.',
          'UNPROCESSABLE_ENTITY',
          422
        );
      }

      if (upstreamError) {
        throw upstreamError;
      }

      try {
        if (upload) {
          await upload.abort();
        }
      } catch {}

      if (isS3Offline) {
        try { if (fs.existsSync(artifactPath)) fs.unlinkSync(artifactPath); } catch {}
        try { if (fs.existsSync(directPath)) fs.unlinkSync(directPath); } catch {}
      }

      throw err;
    }
  }

  // ===========================================================================
  // 4. ARGUMENT BUILDER & SPAWN HELPERS
  // ===========================================================================

  public static buildFFmpegArgs(
    inputSource: string,
    plan: EcoEnforcementPlan,
    targetFormat: ContainerFormat,
    isPipedInput: boolean = false
  ): string[] {
    const args: string[] = [
      '-hide_banner',
      '-loglevel', 'error',
      '-progress', 'pipe:2',
    ];

    if (!isPipedInput) {
      args.push('-nostdin');
    }

    // Thread caps to bound CPU utilization and prevent multi-thread CPU starvation
    args.push('-threads', '4');

    // Strict protocol whitelist:
    // - 'pipe' for piped stdin streams
    // - 'file,pipe' for sandbox file inputs
    // Strictly ZERO network/http/https/tcp/tls/crypto/hls protocols permitted
    const protocolWhitelist = isPipedInput ? 'pipe' : 'file,pipe';
    args.push('-protocol_whitelist', protocolWhitelist);

    // Input file or pipe
    if (isPipedInput) {
      args.push('-i', 'pipe:0');
    } else {
      args.push('-i', inputSource);
    }

    // Video codec & flags
    args.push(...plan.ffmpegVideoArgs);

    // Audio codec & flags
    args.push(...plan.ffmpegAudioArgs);

    // Filter flags (scale, loudnorm, etc.)
    args.push(...plan.ffmpegFilterArgs);

    // Container output format flags (e.g. -f mp4 -movflags frag_keyframe+empty_moov+default_base_moof)
    args.push(...plan.ffmpegFormatArgs);

    // Hard limits:
    // -t 14400 (4 hours maximum duration ceiling)
    // -fs 4294967296 (4 GB maximum output file size ceiling to prevent storage exhaustion bombs)
    // For 8K video streams, raise size ceiling to 32 GB (34359738368) to prevent premature truncation of high-bitrate 8K media
    const is8K = Boolean(
      (plan.targetResolution && /^(?:8k|4320p?)/i.test(plan.targetResolution)) ||
      (plan.targetHeight && plan.targetHeight >= 4320)
    );
    args.push('-t', '14400');
    args.push('-fs', is8K ? '34359738368' : '4294967296');

    // Output to stdout pipe
    args.push('pipe:1');

    return args;
  }

  private static spawnFFmpeg(
    args: string[],
    inputStream?: Readable
  ): { childProcess: ChildProcess; outputStream: PassThrough } {
    const is8K = args.some((a) => a.includes('4320') || a.includes('8k') || a === '34359738368');
    const highWaterMark = is8K ? 32 * 1024 * 1024 : 16 * 1024 * 1024;
    const outputStream = new PassThrough({ highWaterMark });

    // Guarantee spawn with { shell: false }, never exec()
    const child = spawn(FFMPEG_BIN, args, {
      shell: false,
      windowsHide: true,
      env: getExecutionEnv(),
      stdio: [inputStream ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });

    if (inputStream) {
      inputStream.on('error', () => {
        // Suppress unhandled stream error if upstream stream fails
      });
      if (child.stdin) {
        child.stdin.on('error', () => {
          // Suppress unhandled EPIPE error when FFmpeg closes stdin early
        });
        inputStream.pipe(child.stdin);
      }
    }

    if (child.stdout) {
      child.stdout.on('error', () => {
        // Suppress unhandled stream error on child stdout
      });
      child.stdout.pipe(outputStream);
    }

    if (child.stderr) {
      child.stderr.on('error', () => {
        // Suppress unhandled stream error on child stderr
      });
    }

    outputStream.on('error', () => {
      // Suppress unhandled stream error on outputStream
    });

    return { childProcess: child, outputStream };
  }

  // ===========================================================================
  // 5. HELPER METHODS: ERROR PARSING, AGE-RESTRICTION, & OFFLINE DETECTION
  // ===========================================================================

  /**
   * Determines whether yt-dlp stderr output indicates an age-restricted video
   */
  public static isAgeRestricted(stderr: string): boolean {
    if (!stderr) return false;
    const lower = stderr.toLowerCase();
    return (
      lower.includes('sign in to confirm your age') ||
      lower.includes('inappropriate') ||
      lower.includes('age-restricted') ||
      lower.includes('confirm your age')
    );
  }

  /**
   * Extracts clean error lines from yt-dlp stderr output
   */
  public static extractYtDlpErrorMessage(stderr: string): string {
    const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
    const errorLines = lines.filter((l) => l.startsWith('ERROR:') || l.includes('Error:'));
    if (errorLines.length > 0) {
      return errorLines.slice(-2).join('; ');
    }
    return lines.slice(-2).join('; ') || 'Upstream stream extraction failed';
  }

  /**
   * Probes S3 / MinIO storage availability with a fast timeout.
   * Returns true if S3 is offline (e.g. ECONNREFUSED) to trigger resilient local disk sink.
   */
  public static async checkIfS3Offline(
    s3Client: S3Client,
    bucketName: string,
    timeoutMs: number = 1000
  ): Promise<boolean> {
    if (process.env.STORAGE_SINK === 'local' || process.env.OFFLINE_MODE === '1') {
      return true;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }), {
          abortSignal: controller.signal,
        });
        return false;
      } finally {
        clearTimeout(timer);
      }
    } catch (err: any) {
      // If S3 responded with an HTTP status (e.g. 400, 403, 404), server is alive
      if (err?.$metadata?.httpStatusCode || (err?.statusCode && err.statusCode < 500)) {
        return false;
      }

      const code = (err?.code || err?.name || '').toString();
      const msg = (err?.message || '').toString().toLowerCase();

      if (
        code === 'ECONNREFUSED' ||
        code === 'ENOTFOUND' ||
        code === 'ETIMEDOUT' ||
        code === 'TimeoutError' ||
        code === 'AbortError' ||
        msg.includes('econnrefused') ||
        msg.includes('fetch failed') ||
        msg.includes('connect error') ||
        msg.includes('timed out')
      ) {
        return true;
      }

      return false;
    }
  }

  // ===========================================================================
  // 6. STDERR PROGRESS PARSER
  // ===========================================================================

  public static parseStderrProgress(
    text: string,
    totalDurationSeconds: number
  ): {
    progressPercent: number;
    speed?: string;
    etaSeconds?: number;
    processedBytes?: number;
  } | null {
    // 1. Check out_time_us (microseconds)
    const outTimeUsMatch = text.match(/out_time_us=(\d+)/);
    let currentSeconds = 0;

    if (outTimeUsMatch) {
      currentSeconds = Number.parseInt(outTimeUsMatch[1], 10) / 1_000_000;
    } else {
      // 2. Check out_time=HH:MM:SS.ms
      const outTimeMatch = text.match(/out_time=(\d+):(\d+):(\d+\.\d+)/);
      if (outTimeMatch) {
        const hours = Number.parseInt(outTimeMatch[1], 10);
        const mins = Number.parseInt(outTimeMatch[2], 10);
        const secs = Number.parseFloat(outTimeMatch[3]);
        currentSeconds = hours * 3600 + mins * 60 + secs;
      }
    }

    if (currentSeconds <= 0) return null;

    // Extract speed (e.g. speed= 2.45x)
    const speedMatch = text.match(/speed=\s*([\d\.]+)x/);
    const speed = speedMatch ? `${speedMatch[1]}x` : undefined;

    // Extract total_size
    const sizeMatch = text.match(/total_size=(\d+)/);
    const processedBytes = sizeMatch ? Number.parseInt(sizeMatch[1], 10) : undefined;

    // Calculate percentage and ETA
    let progressPercent = 0;
    let etaSeconds: number | undefined;

    if (totalDurationSeconds > 0) {
      progressPercent = Math.min(99.0, (currentSeconds / totalDurationSeconds) * 100);
      progressPercent = Math.round(progressPercent * 10) / 10;

      if (speedMatch) {
        const speedMultiplier = Number.parseFloat(speedMatch[1]);
        if (speedMultiplier > 0) {
          const remainingSeconds = Math.max(0, totalDurationSeconds - currentSeconds);
          etaSeconds = Math.round(remainingSeconds / speedMultiplier);
        }
      }
    } else {
      // Monotonic estimate when total duration is not probed
      progressPercent = Math.min(95.0, Math.round(Math.log10(currentSeconds + 1) * 35));
    }

    return { progressPercent, speed, etaSeconds, processedBytes };
  }

  private static extractFFmpegErrorMessage(stderr: string): string {
    const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
    const errorLines = lines.filter(
      (l) =>
        l.includes('Error') ||
        l.includes('Invalid') ||
        l.includes('failed') ||
        l.includes('Cannot') ||
        l.includes('corrupt')
    );
    if (errorLines.length > 0) {
      return errorLines.slice(-3).join('; ');
    }
    return lines.slice(-2).join('; ') || 'Unknown FFmpeg execution failure';
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-\.]/g, '_').slice(0, 100);
}
