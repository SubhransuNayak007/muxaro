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

type ExtendedMediaJobPayload = MediaJobPayload & {
  operation?: string;
  clipUrls?: string[];
  audioUrl?: string;
  audioAssetId?: string;
  videoUrl?: string;
  videoAssetId?: string;
  secondaryAudioStorageKey?: string;
  formatId?: string;
  streamCopy?: boolean;
  egressProfileId?: string;
};

function getExecutionEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const candidateDirs = [
    path.join(os.homedir(), '.deno', 'bin'),
    path.join(os.homedir(), '.local', 'bin'),
    ...(process.platform !== 'win32' ? ['/usr/local/bin', '/usr/bin'] : []),
  ];
  for (const envVar of ['FFMPEG_PATH', 'FFPROBE_PATH', 'YTDLP_PATH', 'DENO_PATH']) {
    const val = env[envVar]?.trim();
    if (val && path.isAbsolute(val)) {
      candidateDirs.unshift(path.dirname(val));
    }
  }
  const existingPath = env.PATH || env.Path || '';
  const merged = [...candidateDirs, ...existingPath.split(path.delimiter)]
    .map((entry) => entry.trim())
    .filter((entry, idx, arr) => entry.length > 0 && arr.indexOf(entry) === idx)
    .join(path.delimiter);
  env.PATH = merged;
  if (process.platform === 'win32') {
    env.Path = merged;
  }
  return env;
}

function resolveExecutable(envVar: string, defaultCommand: string): string {
  const configured = process.env[envVar]?.trim();
  if (configured) {
    if (path.isAbsolute(configured) && fs.existsSync(configured)) {
      return configured;
    }
    return configured;
  }
  const searchDirs = (getExecutionEnv().PATH || '').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? ['', '.exe', '.cmd', '.bat']
    : [''];
  for (const dir of searchDirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, `${defaultCommand}${ext}`);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // continue scanning $PATH
      }
    }
  }
  return defaultCommand;
}

const FFMPEG_BIN = resolveExecutable('FFMPEG_PATH', 'ffmpeg');
const YTDLP_BIN = resolveExecutable('YTDLP_PATH', 'yt-dlp');

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

function resolveLocalUploadOrStorage(sessionId?: string, storageKey?: string): string | undefined {
  if (storageKey) {
    if (fs.existsSync(storageKey)) {
      return storageKey;
    }
    const { directPath, artifactPath } = getStorageArtifactPath(storageKey);
    if (fs.existsSync(directPath)) return directPath;
    if (fs.existsSync(artifactPath)) return artifactPath;
  }
  if (sessionId) {
    const uploadCandidates = [
      path.resolve(process.cwd(), '.muxaro-uploads', sessionId),
      path.resolve(process.cwd(), 'storage/uploads', sessionId),
      path.resolve(os.tmpdir(), sessionId),
    ];
    for (const dir of uploadCandidates) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter((f) => !f.startsWith('part_'));
        if (files.length > 0) {
          return path.join(dir, files[0]);
        }
      }
    }
  }
  return undefined;
}

function getCookieFileCandidates(): string[] {
  return [
    process.env.YTDLP_COOKIES_FILE,
    process.env.YTDLP_COOKIES_PATH,
    path.resolve(process.cwd(), '.muxaro-data', 'cookies.txt'),
    path.resolve(process.cwd(), 'storage', 'cookies.txt'),
    path.resolve(os.tmpdir(), 'muxaro-data', 'cookies.txt'),
  ].filter((p): p is string => Boolean(p && fs.existsSync(p)));
}

function resolveWorkerEgressArgs(egressProfileId?: string): string[] {
  const args: string[] = ['--js-runtimes', 'deno', '--js-runtimes', 'node', '--no-warnings'];
  let matchedProfile: {
    proxyUrl?: string;
    playerClients?: string;
    bgutilUrl?: string;
    poToken?: string;
    visitorData?: string;
    cookiesPath?: string;
    forceIpVersion?: '4' | '6' | 'auto';
  } | null = null;

  const jsonEnv = process.env.MUXARO_EGRESS_PROFILES_JSON?.trim();
  if (jsonEnv) {
    try {
      const profiles = JSON.parse(jsonEnv);
      if (Array.isArray(profiles) && profiles.length > 0) {
        matchedProfile =
          (egressProfileId ? profiles.find((p: any) => p?.id === egressProfileId) : null) || profiles[0];
      }
    } catch {
      // ignore malformed JSON
    }
  }

  const playerClients = (matchedProfile?.playerClients || process.env.YTDLP_PLAYER_CLIENTS || 'ios,android,tv,mweb,web').trim();
  const poToken = (matchedProfile?.poToken || process.env.YTDLP_PO_TOKEN || '').trim();
  const visitorData = (matchedProfile?.visitorData || process.env.YTDLP_VISITOR_DATA || '').trim();
  let ytArg = `youtube:player_client=${playerClients}`;
  if (poToken) {
    const formatted = /^[a-zA-Z0-9_]+[+]/.test(poToken) ? poToken : `web+${poToken}`;
    ytArg += `;po_token=${formatted}${visitorData ? `+${visitorData}` : ''}`;
  }
  args.push('--extractor-args', ytArg);

  const bgutilUrl = (
    matchedProfile?.bgutilUrl ||
    process.env.BGUTIL_BASE_URL ||
    process.env.YTDLP_BGUTIL_URL ||
    process.env.POT_PROVIDER_URL ||
    ''
  ).trim();
  if (bgutilUrl) {
    args.push('--extractor-args', `youtubepot-bgutilhttp:base_url=${bgutilUrl}`);
  }

  const proxy = (
    matchedProfile?.proxyUrl ||
    process.env.YTDLP_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    ''
  ).trim();
  if (proxy) {
    args.push('--proxy', proxy);
  }

  if (matchedProfile?.forceIpVersion === '4') {
    args.push('--force-ipv4');
  } else if (matchedProfile?.forceIpVersion === '6') {
    args.push('--force-ipv6');
  }

  const explicitCookie = matchedProfile?.cookiesPath;
  if (explicitCookie && fs.existsSync(explicitCookie)) {
    args.push('--cookies', explicitCookie);
  } else {
    const cookies = getCookieFileCandidates();
    if (cookies.length > 0) {
      args.push('--cookies', cookies[0]);
    }
  }

  return args;
}

function selectYtDlpFormatArgs(
  sourceUrl: string,
  opts: { isAudioOnly?: boolean; targetResolution?: string; targetExt?: ContainerFormat; formatId?: string }
): string[] {
  if (opts.formatId) {
    return ['-f', opts.formatId, '--merge-output-format', 'mkv'];
  }
  if (opts.isAudioOnly) {
    return ['-f', 'ba/b'];
  }
  const res = opts.targetResolution || '';
  const is8K = /^(?:8k|4320p?)/i.test(res) || res.includes('4320');
  const is4K = /^(?:4k|2160p?)/i.test(res) || res.includes('2160');
  const is1440 = /^(?:2k|1440p?)/i.test(res) || res.includes('1440');
  const isRedditOrFacebook = /(?:reddit\.com|redd\.it|facebook\.com|fb\.watch)/i.test(sourceUrl);

  if (is8K) {
    const format8k = opts.targetExt === 'mp4'
      ? 'bestvideo[height>=4320][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height>=4320]+bestaudio/bestvideo[height<=4320][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=4320]+bestaudio/bestvideo+bestaudio/best'
      : 'bestvideo[height>=4320]+bestaudio/bestvideo[height<=4320]+bestaudio/bestvideo+bestaudio/best';
    return ['-f', format8k, '--merge-output-format', 'mkv', '--buffer-size', '32M', '--http-chunk-size', '10M'];
  }
  if (is4K || isRedditOrFacebook) {
    const format4k = opts.targetExt === 'mp4'
      ? 'bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=2160]+bestaudio/bestvideo+bestaudio/best'
      : 'bestvideo[height<=2160]+bestaudio/bestvideo+bestaudio/best';
    return ['-f', format4k, '--merge-output-format', 'mkv', '--buffer-size', '16M'];
  }
  if (is1440) {
    return ['-f', 'bestvideo[height<=1440]+bestaudio/best[height<=1440]/best', '--merge-output-format', 'mkv', '--buffer-size', '16M'];
  }
  const heightMatch = res.match(/(\d{3,4})/);
  const maxHeight = heightMatch ? Math.min(4320, Math.max(144, Number.parseInt(heightMatch[1], 10))) : 1080;
  return [
    '-f',
    `bv*[height<=${maxHeight}]+ba/b[height<=${maxHeight}]/best`,
    '--merge-output-format',
    'mkv',
  ];
}

async function downloadRemoteMediaToTempDir(
  rawUrl: string,
  workDir: string,
  baseName: string,
  opts: {
    isAudioOnly?: boolean;
    targetResolution?: string;
    targetExt?: ContainerFormat;
    formatId?: string;
    allowPlaylist?: boolean;
    egressProfileId?: string;
    signal?: AbortSignal;
  }
): Promise<string> {
  const safeInfo = await assertSafeMediaUrl(rawUrl);
  const safeUrl = safeInfo.canonicalUrl || rawUrl;

  const ytdlpArgs: string[] = [
    '-q',
    ...resolveWorkerEgressArgs(opts.egressProfileId),
  ];

  if (!opts.allowPlaylist && !safeInfo.isPlaylist) {
    ytdlpArgs.push('--no-playlist');
  }

  const resolvedFfmpeg = resolveExecutable('FFMPEG_PATH', 'ffmpeg');
  if (path.isAbsolute(resolvedFfmpeg)) {
    ytdlpArgs.push('--ffmpeg-location', path.dirname(resolvedFfmpeg));
  }

  ytdlpArgs.push(...selectYtDlpFormatArgs(safeUrl, opts));
  const template = path.join(workDir, `${baseName}.%(ext)s`);
  ytdlpArgs.push('-o', template, '--', safeUrl);

  const ytdlpBin = resolveExecutable('YTDLP_PATH', 'yt-dlp');
  await new Promise<void>((resolve, reject) => {
    let stderr = '';
    const child = spawn(ytdlpBin, ytdlpArgs, {
      shell: false,
      windowsHide: true,
      env: getExecutionEnv(),
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    const onAbort = () => {
      try {
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/pid', child.pid.toString(), '/T', '/F'], { shell: false, windowsHide: true });
        } else {
          child.kill('SIGTERM');
        }
      } catch {}
    };

    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort();
        return reject(new MuxaroError('Job cancelled by client', 'CANCELLED', 499));
      }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf-8')).slice(-8192);
    });
    child.on('error', (err) => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(new MuxaroError(`yt-dlp spawn failed: ${err.message}`, 'INTERNAL_ERROR', 500));
    });
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort);
      if (opts.signal?.aborted) {
        return reject(new MuxaroError('Job cancelled by client', 'CANCELLED', 499));
      }
      if (code === 0) {
        return resolve();
      }
      if (StreamPipeline.isAgeRestricted(stderr)) {
        return reject(
          new MuxaroError(
            'This YouTube video is age-restricted and requires sign-in. Please use a public video or direct media URL.',
            'UNPROCESSABLE_ENTITY',
            422
          )
        );
      }
      const cleanErr = StreamPipeline.extractYtDlpErrorMessage(stderr);
      reject(new MuxaroError(`yt-dlp exited with code ${code}: ${cleanErr}`, 'EXTRACTION_FAILED', 502));
    });
  });

  const produced = fs.readdirSync(workDir)
    .filter((f) => f.startsWith(`${baseName}.`) && !f.endsWith('.part') && !f.endsWith('.ytdl'))
    .map((f) => path.join(workDir, f));

  if (produced.length === 0) {
    throw new MuxaroError(`yt-dlp produced no output file for ${baseName}`, 'EXTRACTION_FAILED', 502);
  }
  return validateSandboxPath(produced[0]);
}

function parseResolutionDimensions(targetResolution?: string, fallbackWidth = 1280, fallbackHeight = 720): { width: number; height: number } {
  if (!targetResolution) {
    return {
      width: fallbackWidth % 2 === 0 ? fallbackWidth : fallbackWidth + 1,
      height: fallbackHeight % 2 === 0 ? fallbackHeight : fallbackHeight + 1,
    };
  }
  const r = targetResolution.toLowerCase();
  if (r.includes('8k') || r.includes('4320')) return { width: 7680, height: 4320 };
  if (r.includes('4k') || r.includes('2160')) return { width: 3840, height: 2160 };
  if (r.includes('1440') || r.includes('2k')) return { width: 2560, height: 1440 };
  if (r.includes('1080')) return { width: 1920, height: 1080 };
  if (r.includes('720')) return { width: 1280, height: 720 };
  if (r.includes('480')) return { width: 854, height: 480 };
  if (r.includes('360')) return { width: 640, height: 360 };
  const m = r.match(/(\d{3,4})/);
  if (m) {
    const h = Math.min(4320, Math.max(144, Number.parseInt(m[1], 10)));
    const w = Math.round((h * 16) / 9);
    return { width: w % 2 === 0 ? w : w + 1, height: h % 2 === 0 ? h : h + 1 };
  }
  return { width: 1280, height: 720 };
}

function getContainerOutputArgs(targetExt: ContainerFormat): string[] {
  if (targetExt === 'mp4') {
    return ['-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof'];
  }
  if (targetExt === 'mov') {
    return ['-f', 'mov', '-movflags', 'frag_keyframe+empty_moov+default_base_moof'];
  }
  if (targetExt === 'webm') {
    return ['-f', 'webm'];
  }
  if (targetExt === 'mkv') {
    return ['-f', 'matroska'];
  }
  return ['-f', targetExt];
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
    const job = options.job as ExtendedMediaJobPayload;
    const { signal } = options;
    const s3Client = options.s3Client || getS3Client();
    const bucketName = options.bucketName || getR2BucketName();
    const redis = options.redisClient || getMuxaroRedis();

    const targetExt = (job.targetFormat || 'mp4').toLowerCase() as ContainerFormat;
    const isExplicitStream = Boolean(options.inputStream);
    const clipUrls = Array.isArray(job.clipUrls) ? job.clipUrls.map((u) => String(u || '').trim()).filter(Boolean) : [];
    const isConcatMode = !isExplicitStream && (job.operation === 'CONCAT_VIDEO' || clipUrls.length >= 2);
    const secondaryAudioUrl = job.secondaryAudioUrl || job.audioUrl;
    const secondaryAudioSessionId = job.secondaryAudioSessionId || job.audioAssetId;
    const isDualTrackMerge =
      !isExplicitStream &&
      !isConcatMode &&
      (job.tool === 'merge_av' || job.operation === 'MERGE_AUDIO_VIDEO') &&
      Boolean(secondaryAudioUrl || secondaryAudioSessionId || job.secondaryAudioStorageKey);

    let tempWorkDir: string | null = null;
    const cleanupTempDir = () => {
      if (tempWorkDir) {
        try {
          fs.rmSync(tempWorkDir, { recursive: true, force: true });
        } catch {}
        tempWorkDir = null;
      }
    };

    try {
      const storageKey = `outputs/${job.retentionTier}/${job.jobId}.${targetExt}`;
      const outputFilename = `${job.title ? sanitizeFilename(job.title) : job.jobId}.${targetExt}`;
      const mimeType = CONTAINER_MIME_TYPES[targetExt] || 'application/octet-stream';

      let inputSource = job.sourceUrl || job.videoUrl || job.inputStorageKey || '';
      if (!inputSource && (job.uploadSessionId || job.videoAssetId)) {
        inputSource = resolveLocalUploadOrStorage(job.uploadSessionId || job.videoAssetId) || '';
      }

      if (!isConcatMode && !inputSource && !isExplicitStream) {
        throw new MuxaroError('No source URL, input storage key, or stream provided', 'BAD_REQUEST', 400);
      }

      const isRemoteUrl = !isExplicitStream && !isConcatMode && (Boolean(job.sourceUrl || job.videoUrl) || /^https?:\/\//i.test(inputSource));
      let isPipedInput = isExplicitStream;
      let upstreamChild: ChildProcess | null = null;
      let upstreamStderr = '';
      let upstreamError: Error | null = null;
      let inputStream: Readable | undefined = options.inputStream;
      let durationSeconds = job.totalDurationSeconds || 0;
      let plan: EcoEnforcementPlan;
      let savings: EcoSavingsEstimate;
      let ffmpegArgs: string[];

      if (isConcatMode) {
        if (clipUrls.length < 2) {
          throw new MuxaroError('CONCAT_VIDEO requires at least 2 clipUrls', 'BAD_REQUEST', 400);
        }

        tempWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), `muxaro-concat-${job.jobId}-`));
        const clipFiles: string[] = [];
        const clipProbes: ProbedMediaMetadata[] = [];

        for (let i = 0; i < clipUrls.length; i++) {
          const clip = clipUrls[i];
          let localClip: string;
          if (/^https?:\/\//i.test(clip)) {
            localClip = await downloadRemoteMediaToTempDir(clip, tempWorkDir, `clip_${i}`, {
              targetResolution: job.targetResolution,
              targetExt,
              formatId: job.formatId,
              signal,
            });
          } else {
            const resolved = resolveLocalUploadOrStorage(undefined, clip) || clip;
            localClip = validateSandboxPath(resolved);
          }
          clipFiles.push(localClip);
          const clipProbe = await probeInputMedia(localClip).catch(() => ({ durationSeconds: 0 }));
          clipProbes.push(clipProbe);
          durationSeconds += clipProbe.durationSeconds || 0;
        }

        const firstProbe = clipProbes[0] || { durationSeconds: 0 };
        const uniformCodecs = clipProbes.every(
          (p) =>
            p.video?.codec &&
            p.video.codec === firstProbe.video?.codec &&
            p.video.width === firstProbe.video?.width &&
            p.video.height === firstProbe.video?.height &&
            Boolean(p.audio?.codec) === Boolean(firstProbe.audio?.codec) &&
            (!p.audio?.codec || p.audio.codec === firstProbe.audio?.codec)
        );
        const canStreamCopyConcat =
          uniformCodecs &&
          job.ecoMode !== false &&
          job.streamCopy !== false &&
          !job.targetResolution &&
          !job.normalizeAudio &&
          Boolean(
            firstProbe.video &&
            EcoModeEngine.planExecution(job, firstProbe).isStreamCopy
          );

        const is8K = Boolean(
          (job.targetResolution && /^(?:8k|4320p?)/i.test(job.targetResolution)) ||
          (firstProbe.video?.height && firstProbe.video.height >= 4320)
        );
        const containerFlags = getContainerOutputArgs(targetExt);

        if (canStreamCopyConcat) {
          const concatManifestPath = path.join(tempWorkDir, 'concat.txt');
          const manifestLines = clipFiles.map((f) => {
            const normalized = f.replace(/\\/g, '/').replace(/'/g, "'\\''");
            return `file '${normalized}'`;
          });
          fs.writeFileSync(concatManifestPath, manifestLines.join('\n'), 'utf8');

          ffmpegArgs = [
            '-hide_banner',
            '-loglevel', 'error',
            '-progress', 'pipe:2',
            '-nostdin',
            '-threads', '4',
            '-protocol_whitelist', 'file,pipe',
            '-f', 'concat',
            '-safe', '0',
            '-i', concatManifestPath,
            '-c', 'copy',
            ...containerFlags,
            '-t', '14400',
            '-fs', is8K ? '34359738368' : '4294967296',
            'pipe:1',
          ];

          plan = {
            isStreamCopy: true,
            action: 'STREAM_COPY_REMUX',
            scaleCapApplied: false,
            targetResolution: job.targetResolution,
            ffmpegVideoArgs: ['-c:v', 'copy'],
            ffmpegAudioArgs: ['-c:a', 'copy'],
            ffmpegFilterArgs: [],
            ffmpegFormatArgs: containerFlags,
            reason: 'Zero-Copy Multi-Clip Concat',
          };
        } else {
          const dims = parseResolutionDimensions(
            job.targetResolution,
            firstProbe.video?.width || 1280,
            firstProbe.video?.height || 720
          );
          const filterInputs: string[] = [];
          const filterChains: string[] = [];
          const concatRefs: string[] = [];

          for (let i = 0; i < clipFiles.length; i++) {
            filterInputs.push('-i', clipFiles[i]);
            filterChains.push(
              `[${i}:v:0]scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease,` +
              `pad=${dims.width}:${dims.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`
            );
            if (clipProbes[i]?.audio) {
              filterChains.push(
                `[${i}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`
              );
            } else {
              const clipDur = Math.max(0.1, clipProbes[i]?.durationSeconds || 1);
              filterChains.push(
                `anullsrc=channel_layout=stereo:sample_rate=48000:duration=${clipDur.toFixed(3)}[a${i}]`
              );
            }
            concatRefs.push(`[v${i}][a${i}]`);
          }

          filterChains.push(`${concatRefs.join('')}concat=n=${clipFiles.length}:v=1:a=1[outv][cat_a]`);
          const audioOutLabel = job.normalizeAudio ? '[outa]' : '[cat_a]';
          if (job.normalizeAudio) {
            filterChains.push('[cat_a]loudnorm=I=-14:TP=-1.5:LRA=11[outa]');
          }

          const videoEncodeArgs = targetExt === 'webm'
            ? ['-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0']
            : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p'];
          const audioEncodeArgs = targetExt === 'webm'
            ? ['-c:a', 'libopus', '-b:a', job.audioBitrate || '128k']
            : ['-c:a', 'aac', '-b:a', job.audioBitrate || '192k'];

          ffmpegArgs = [
            '-hide_banner',
            '-loglevel', 'error',
            '-progress', 'pipe:2',
            '-nostdin',
            '-threads', '4',
            '-protocol_whitelist', 'file,pipe',
            ...filterInputs,
            '-filter_complex', filterChains.join(';'),
            '-map', '[outv]',
            '-map', audioOutLabel,
            ...videoEncodeArgs,
            ...audioEncodeArgs,
            ...containerFlags,
            '-t', '14400',
            '-fs', is8K ? '34359738368' : '4294967296',
            'pipe:1',
          ];

          plan = {
            isStreamCopy: false,
            action: 'OPTIMIZED_TRANSCODE',
            scaleCapApplied: Boolean(job.targetResolution),
            targetResolution: job.targetResolution,
            targetWidth: dims.width,
            targetHeight: dims.height,
            presetUsed: targetExt === 'webm' ? 'vp9' : 'veryfast',
            ffmpegVideoArgs: videoEncodeArgs,
            ffmpegAudioArgs: audioEncodeArgs,
            ffmpegFilterArgs: [],
            ffmpegFormatArgs: containerFlags,
            reason: 'Multi-Clip Filter Concat',
          };
        }
        savings = EcoModeEngine.estimateSavings(plan, durationSeconds);
      } else if (isDualTrackMerge) {
        tempWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), `muxaro-merge-${job.jobId}-`));

        let localVideoPath: string;
        if (isRemoteUrl) {
          localVideoPath = await downloadRemoteMediaToTempDir(inputSource, tempWorkDir, 'video_src', {
            targetResolution: job.targetResolution,
            targetExt,
            formatId: job.formatId,
            signal,
          });
        } else {
          const resolvedVideo = resolveLocalUploadOrStorage(job.uploadSessionId || job.videoAssetId, inputSource) || inputSource;
          localVideoPath = validateSandboxPath(resolvedVideo);
        }

        let localAudioPath: string;
        if (secondaryAudioUrl && /^https?:\/\//i.test(secondaryAudioUrl)) {
          localAudioPath = await downloadRemoteMediaToTempDir(secondaryAudioUrl, tempWorkDir, 'audio_src', {
            isAudioOnly: true,
            signal,
          });
        } else {
          const resolvedAudio = resolveLocalUploadOrStorage(
            secondaryAudioSessionId,
            job.secondaryAudioStorageKey
          );
          if (!resolvedAudio) {
            throw new MuxaroError('Secondary audio input not found for A/V merge', 'BAD_REQUEST', 400);
          }
          localAudioPath = validateSandboxPath(resolvedAudio);
        }

        const videoProbe: ProbedMediaMetadata = await probeInputMedia(localVideoPath).catch(() => ({ durationSeconds: 0 }));
        const audioProbe: ProbedMediaMetadata = await probeInputMedia(localAudioPath).catch(() => ({ durationSeconds: 0 }));
        durationSeconds = durationSeconds || videoProbe.durationSeconds || audioProbe.durationSeconds || 0;

        const basePlan = EcoModeEngine.planExecution(job, {
          ...videoProbe,
          audio: audioProbe.audio,
        });
        const containerFlags = getContainerOutputArgs(targetExt);
        const offsetSeconds = (job.audioOffsetMs || 0) / 1000;

        const videoArgs = job.ecoMode !== false && job.streamCopy !== false && !job.targetResolution && basePlan.isStreamCopy
          ? ['-c:v', 'copy']
          : basePlan.ffmpegVideoArgs;

        const audioFilters: string[] = [];
        if (job.normalizeAudio) {
          audioFilters.push('loudnorm=I=-14:TP=-1.5:LRA=11');
        }
        const canCopyAudio =
          !job.normalizeAudio &&
          audioProbe.audio?.codec &&
          ((targetExt === 'mp4' || targetExt === 'mov') ? ['aac', 'alac'].includes(audioProbe.audio.codec) :
            targetExt === 'webm' ? ['opus', 'vorbis'].includes(audioProbe.audio.codec) : true);
        const audioArgs = canCopyAudio
          ? ['-c:a', 'copy']
          : targetExt === 'webm'
          ? ['-c:a', 'libopus', '-b:a', job.audioBitrate || '128k']
          : ['-c:a', 'aac', '-b:a', job.audioBitrate || '192k'];

        const is8K = Boolean(
          (job.targetResolution && /^(?:8k|4320p?)/i.test(job.targetResolution)) ||
          (videoProbe.video?.height && videoProbe.video.height >= 4320)
        );

        ffmpegArgs = [
          '-hide_banner',
          '-loglevel', 'error',
          '-progress', 'pipe:2',
          '-nostdin',
          '-threads', '4',
          '-protocol_whitelist', 'file,pipe',
          '-i', localVideoPath,
          ...(offsetSeconds !== 0 ? ['-itsoffset', offsetSeconds.toFixed(3)] : []),
          '-i', localAudioPath,
          '-map', '0:v:0',
          '-map', '1:a:0',
          ...videoArgs,
          ...audioArgs,
          ...(audioFilters.length > 0 ? ['-af', audioFilters.join(',')] : []),
          ...basePlan.ffmpegFilterArgs,
          ...containerFlags,
          '-t', '14400',
          '-fs', is8K ? '34359738368' : '4294967296',
          'pipe:1',
        ];

        const streamCopyBoth = videoArgs[1] === 'copy' && audioArgs[1] === 'copy';
        plan = {
          ...basePlan,
          isStreamCopy: streamCopyBoth,
          action: streamCopyBoth ? 'STREAM_COPY_REMUX' : 'OPTIMIZED_TRANSCODE',
          ffmpegFormatArgs: containerFlags,
          reason: 'Dual-Track A/V Mux',
        };
        savings = EcoModeEngine.estimateSavings(plan, durationSeconds);
      } else {
        if (isRemoteUrl) {
          const safeInfo = await assertSafeMediaUrl(inputSource);
          inputSource = safeInfo.canonicalUrl || inputSource;

          const isYouTube = /(?:youtube\.com|youtu\.be)/i.test(inputSource);
          const isAdaptiveHighRes = Boolean(
            isYouTube ||
            (job.targetResolution && /^(?:1080p?|1440p?|2k|4k|2160p?|8k|4320p?)/i.test(job.targetResolution)) ||
            (job.formatId && job.formatId.includes('+'))
          );

          if (isAdaptiveHighRes && job.tool !== 'extract_audio') {
            // Adaptive DASH streams (YouTube 1080p/1440p/4K/8K) require yt-dlp on-disk video+audio muxing before FFmpeg pipe
            tempWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), `muxaro-job-${job.jobId}-`));
            inputSource = await downloadRemoteMediaToTempDir(inputSource, tempWorkDir, 'source', {
              targetResolution: job.targetResolution,
              targetExt,
              formatId: job.formatId,
              allowPlaylist: job.tool === 'batch_playlist',
              egressProfileId: job.egressProfileId,
              signal,
            });
            isPipedInput = false;
          } else {
            const ytdlpArgs = [
              '-q',
              ...resolveWorkerEgressArgs(job.egressProfileId),
            ];
            if (!safeInfo.isPlaylist && job.tool !== 'batch_playlist') {
              ytdlpArgs.push('--no-playlist');
            }

            ytdlpArgs.push(...selectYtDlpFormatArgs(inputSource, {
              isAudioOnly: job.tool === 'extract_audio',
              targetResolution: job.targetResolution,
              targetExt,
              formatId: job.formatId,
            }));
            ytdlpArgs.push('-o', '-', '--', inputSource);

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
          }
        } else if (!isPipedInput) {
          if (!fs.existsSync(inputSource)) {
            const { directPath } = getStorageArtifactPath(inputSource);
            if (fs.existsSync(directPath)) {
              inputSource = directPath;
            }
          }
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
          } catch {
            probe = { durationSeconds: job.totalDurationSeconds || 0 };
          }
        }

        durationSeconds = probe.durationSeconds || job.totalDurationSeconds || 0;
        plan = EcoModeEngine.planExecution(job, probe);
        savings = EcoModeEngine.estimateSavings(plan, durationSeconds);
        ffmpegArgs = StreamPipeline.buildFFmpegArgs(inputSource, plan, targetExt, isPipedInput);
      }

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
    } finally {
      cleanupTempDir();
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
