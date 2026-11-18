/**
 * Project MUXARO - FFmpeg Command Sanitizer & Hardening Module
 * 
 * Provides:
 * - Safe argument array construction (guaranteed shell: false execution)
 * - Strict rejection of shell metacharacters and command injection payloads
 * - Scratch path whitelisting & directory traversal defense (canonicalization, base directory enforcement)
 * - Safe filename sanitization
 * - FFmpeg protocol whitelisting (-protocol_whitelist "file,crypto,data" / -nostdin)
 * - Preset, codec, resolution, and time range parameter validation
 * - Process boundary enforcement (timeouts, buffer limits, non-root guidance)
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawn } from 'node:child_process';

/**
 * Shell metacharacters regex
 * Strictly prohibits characters that could trigger command execution if mistakenly passed to a shell
 */
export const SHELL_METACHARS_REGEX = /[;&|`$\0\n\r<>()"'\*\?\[\]~!\^]/;

/**
 * Safe filename regex
 * Allowed: alphanumeric characters, dots, dashes, underscores
 */
export const SAFE_FILENAME_REGEX = /^[a-zA-Z0-9_\-\.]+$/;

/**
 * Validated video codecs allowed in MUXARO media worker
 */
export const ALLOWED_VIDEO_CODECS = new Set([
  'copy',
  'libx264',
  'libx265',
  'libvpx-vp9',
  'libsvtav1'
]);

/**
 * Validated audio codecs allowed in MUXARO media worker
 */
export const ALLOWED_AUDIO_CODECS = new Set([
  'copy',
  'aac',
  'libmp3lame',
  'libopus',
  'flac'
]);

/**
 * Validated FFmpeg encoder presets
 */
export const ALLOWED_PRESETS = new Set([
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow'
]);

/**
 * Validated standard resolutions
 */
export const RESOLUTION_PRESETS: Record<string, { width: number; height: number }> = {
  '8k': { width: 7680, height: 4320 },
  '4k': { width: 3840, height: 2160 },
  '1440p': { width: 2560, height: 1440 },
  '1080p': { width: 1920, height: 1080 },
  '720p': { width: 1280, height: 720 },
  '480p': { width: 854, height: 480 },
  '360p': { width: 640, height: 360 }
};

/**
 * Validated audio bitrates
 */
export const ALLOWED_AUDIO_BITRATES = new Set([
  '64k',
  '96k',
  '128k',
  '160k',
  '192k',
  '256k',
  '320k'
]);

/**
 * Sanitize a filename to only safe characters and avoid path traversal or hidden files
 */
export function sanitizeFilename(filename: string, fallback = 'media_output'): string {
  if (!filename || typeof filename !== 'string') {
    return fallback;
  }

  // Normalize backslashes to forward slashes and extract base component
  const forwardSlashed = filename.replace(/\\/g, '/');
  const base = path.posix.basename(forwardSlashed);

  // Replace disallowed characters with underscore
  let clean = base.replace(/[^a-zA-Z0-9_\-\.]/g, '_');

  // Prevent hidden files and dot-sequences (leading dots)
  clean = clean.replace(/^\.+/, '');

  // Prevent empty or only underscores/separators
  if (!clean || clean.replace(/_/g, '').trim().length === 0) {
    return fallback;
  }

  // Cap length to prevent filesystem errors / buffer overflows
  if (clean.length > 200) {
    const ext = path.extname(clean);
    const stem = clean.slice(0, 200 - ext.length);
    clean = `${stem}${ext}`;
  }

  return clean;
}

/**
 * Validate that a file path is safe and strictly resides within an allowed scratch directory
 */
export function validateSafePath(
  filePath: string,
  allowedBaseDirs: string[],
  options: { mustExist?: boolean } = {}
): { isSafe: boolean; resolvedPath?: string; error?: string } {
  if (!filePath || typeof filePath !== 'string') {
    return { isSafe: false, error: 'Path must be a non-empty string' };
  }

  // Reject null bytes and shell metacharacters in paths
  if (filePath.includes('\0') || SHELL_METACHARS_REGEX.test(filePath)) {
    return { isSafe: false, error: 'Path contains prohibited characters or null bytes' };
  }

  // Reject path traversal patterns before normalization
  if (filePath.includes('..')) {
    return { isSafe: false, error: 'Directory traversal sequence (..) detected' };
  }

  // Canonicalize path
  const resolved = path.resolve(filePath);

  // Ensure allowed base dirs are also resolved
  const resolvedBaseDirs = allowedBaseDirs.map(d => path.resolve(d));

  // Verify the target path resides inside at least one allowed directory
  const isInsideAllowed = resolvedBaseDirs.some(baseDir => {
    // Relative path must not start with '..' and must not be equal to root
    const rel = path.relative(baseDir, resolved);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  });

  if (!isInsideAllowed) {
    return {
      isSafe: false,
      error: `Path '${resolved}' is outside allowed directories: [${resolvedBaseDirs.join(', ')}]`
    };
  }

  // If path must exist, verify realpath (to protect against symlink escapes)
  if (options.mustExist) {
    try {
      const real = fs.realpathSync(resolved);
      const isRealInsideAllowed = resolvedBaseDirs.some(baseDir => {
        const rel = path.relative(baseDir, real);
        return !rel.startsWith('..') && !path.isAbsolute(rel);
      });
      if (!isRealInsideAllowed) {
        return {
          isSafe: false,
          error: `Symlink target '${real}' points outside allowed sandbox directories`
        };
      }
    } catch (err) {
      return { isSafe: false, error: `File existence check failed: ${(err as Error).message}` };
    }
  }

  return { isSafe: true, resolvedPath: resolved };
}

/**
 * Validate that an argument string contains no shell metacharacters
 */
export function assertNoShellMetachars(value: string, fieldName = 'argument'): void {
  if (SHELL_METACHARS_REGEX.test(value)) {
    throw new Error(
      `Security violation: ${fieldName} contains forbidden shell metacharacters: "${value}"`
    );
  }
}

/**
 * Options for probe command argument building
 */
export interface ProbeArgsOptions {
  inputPath: string;
  allowedBaseDirs: string[];
}

/**
 * Build safe argument array for ffprobe
 * Guarantees no shell interpolation and enforces file-only protocol whitelist
 */
export function buildSafeProbeArgs(options: ProbeArgsOptions): string[] {
  const pathCheck = validateSafePath(options.inputPath, options.allowedBaseDirs, { mustExist: true });
  if (!pathCheck.isSafe || !pathCheck.resolvedPath) {
    throw new Error(`Invalid ffprobe input path: ${pathCheck.error}`);
  }

  return [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    '-show_error',
    // Security: restrict protocols so probing local media cannot trigger network SSRF or internal file demuxer exploits
    '-protocol_whitelist', 'file,crypto,data',
    pathCheck.resolvedPath
  ];
}

/**
 * Options for transcode / conversion argument builder
 */
export interface TranscodeArgsOptions {
  inputPath: string;
  outputPath: string;
  allowedBaseDirs: string[];
  videoCodec?: string;
  audioCodec?: string;
  resolution?: string; // e.g. "1080p", "1920:1080"
  crf?: number; // 0 - 51
  preset?: string;
  audioBitrate?: string; // e.g. "192k"
  audioSampleRate?: number; // e.g. 44100, 48000
  audioChannels?: number; // 1 or 2
  videoOnly?: boolean;
  audioOnly?: boolean;
  startSeconds?: number;
  durationSeconds?: number;
  threads?: number;
}

/**
 * Build safe argument array for ffmpeg
 * Guarantees safe argument array, protocol whitelist, and parameter boundaries
 */
export function buildSafeTranscodeArgs(options: TranscodeArgsOptions): string[] {
  // 1. Validate Input Path
  const inCheck = validateSafePath(options.inputPath, options.allowedBaseDirs, { mustExist: true });
  if (!inCheck.isSafe || !inCheck.resolvedPath) {
    throw new Error(`Invalid FFmpeg input path: ${inCheck.error}`);
  }

  // 2. Validate Output Path
  const outCheck = validateSafePath(options.outputPath, options.allowedBaseDirs, { mustExist: false });
  if (!outCheck.isSafe || !outCheck.resolvedPath) {
    throw new Error(`Invalid FFmpeg output path: ${outCheck.error}`);
  }

  const args: string[] = [
    '-nostdin',                      // Do not wait for terminal input
    '-y',                            // Overwrite output files
    '-hide_banner',                  // Suppress version banners
    '-loglevel', 'error',            // Only log errors
    '-protocol_whitelist', 'file,crypto,data' // Restrict protocol access
  ];

  // Seeking before input for fast keyframe seek
  if (options.startSeconds !== undefined) {
    if (typeof options.startSeconds !== 'number' || options.startSeconds < 0 || !Number.isFinite(options.startSeconds)) {
      throw new Error(`Invalid startSeconds: ${options.startSeconds}`);
    }
    args.push('-ss', options.startSeconds.toFixed(3));
  }

  if (options.durationSeconds !== undefined) {
    if (typeof options.durationSeconds !== 'number' || options.durationSeconds <= 0 || !Number.isFinite(options.durationSeconds)) {
      throw new Error(`Invalid durationSeconds: ${options.durationSeconds}`);
    }
    args.push('-t', options.durationSeconds.toFixed(3));
  }

  // Input file
  args.push('-i', inCheck.resolvedPath);

  // Audio-only or Video-only handling
  if (options.audioOnly) {
    args.push('-vn'); // No video
  } else if (options.videoOnly) {
    args.push('-an'); // No audio
  }

  // Video Codec
  if (!options.audioOnly && options.videoCodec) {
    if (!ALLOWED_VIDEO_CODECS.has(options.videoCodec)) {
      throw new Error(`Forbidden or unsupported video codec: '${options.videoCodec}'`);
    }
    args.push('-c:v', options.videoCodec);

    // CRF / quality setting
    if (options.crf !== undefined && options.videoCodec !== 'copy') {
      if (!Number.isInteger(options.crf) || options.crf < 0 || options.crf > 51) {
        throw new Error(`Invalid CRF value: ${options.crf}. Must be an integer between 0 and 51.`);
      }
      args.push('-crf', options.crf.toString());
    }

    // Preset
    if (options.preset && options.videoCodec !== 'copy') {
      if (!ALLOWED_PRESETS.has(options.preset)) {
        throw new Error(`Invalid preset: '${options.preset}'`);
      }
      args.push('-preset', options.preset);
    }

    // Resolution scaling
    if (options.resolution && options.videoCodec !== 'copy') {
      let scaleFilter = '';
      if (RESOLUTION_PRESETS[options.resolution.toLowerCase()]) {
        const res = RESOLUTION_PRESETS[options.resolution.toLowerCase()];
        scaleFilter = `scale=${res.width}:${res.height}:force_original_aspect_ratio=decrease,pad=${res.width}:${res.height}:(ow-iw)/2:(oh-ih)/2`;
      } else if (/^\d{2,4}:\d{2,4}$/.test(options.resolution)) {
        // e.g. "1920:1080"
        scaleFilter = `scale=${options.resolution}`;
      } else {
        throw new Error(`Invalid resolution format: '${options.resolution}'`);
      }
      args.push('-vf', scaleFilter);
    }
  }

  // Audio Codec
  if (!options.videoOnly && options.audioCodec) {
    if (!ALLOWED_AUDIO_CODECS.has(options.audioCodec)) {
      throw new Error(`Forbidden or unsupported audio codec: '${options.audioCodec}'`);
    }
    args.push('-c:a', options.audioCodec);

    // Audio bitrate
    if (options.audioBitrate && options.audioCodec !== 'copy') {
      if (!ALLOWED_AUDIO_BITRATES.has(options.audioBitrate)) {
        throw new Error(`Invalid audio bitrate: '${options.audioBitrate}'`);
      }
      args.push('-b:a', options.audioBitrate);
    }

    // Audio sample rate
    if (options.audioSampleRate && options.audioCodec !== 'copy') {
      const allowedRates = [22050, 32000, 44100, 48000, 96000];
      if (!allowedRates.includes(options.audioSampleRate)) {
        throw new Error(`Invalid audio sample rate: ${options.audioSampleRate}`);
      }
      args.push('-ar', options.audioSampleRate.toString());
    }

    // Audio channels
    if (options.audioChannels && options.audioCodec !== 'copy') {
      if (![1, 2].includes(options.audioChannels)) {
        throw new Error(`Invalid channel count: ${options.audioChannels}. Only mono (1) or stereo (2) allowed.`);
      }
      args.push('-ac', options.audioChannels.toString());
    }
  }

  // Thread limit to prevent CPU hogging
  const threads = options.threads ?? 4;
  if (threads > 0 && threads <= 16) {
    args.push('-threads', threads.toString());
  }

  // Output file
  args.push(outCheck.resolvedPath);

  return args;
}

/**
 * Options for audio/video merge argument builder
 */
export interface MergeArgsOptions {
  videoInputPath: string;
  audioInputPath: string;
  outputPath: string;
  allowedBaseDirs: string[];
  copyStreams?: boolean;
}

/**
 * Build safe argument array for merging separate video and audio streams
 */
export function buildSafeMergeArgs(options: MergeArgsOptions): string[] {
  const vCheck = validateSafePath(options.videoInputPath, options.allowedBaseDirs, { mustExist: true });
  if (!vCheck.isSafe || !vCheck.resolvedPath) {
    throw new Error(`Invalid video input path: ${vCheck.error}`);
  }

  const aCheck = validateSafePath(options.audioInputPath, options.allowedBaseDirs, { mustExist: true });
  if (!aCheck.isSafe || !aCheck.resolvedPath) {
    throw new Error(`Invalid audio input path: ${aCheck.error}`);
  }

  const outCheck = validateSafePath(options.outputPath, options.allowedBaseDirs, { mustExist: false });
  if (!outCheck.isSafe || !outCheck.resolvedPath) {
    throw new Error(`Invalid merge output path: ${outCheck.error}`);
  }

  const args: string[] = [
    '-nostdin',
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-protocol_whitelist', 'file,crypto,data',
    '-i', vCheck.resolvedPath,
    '-i', aCheck.resolvedPath,
    '-map', '0:v:0', // Video from first input
    '-map', '1:a:0'  // Audio from second input
  ];

  if (options.copyStreams !== false) {
    args.push('-c:v', 'copy', '-c:a', 'copy');
  } else {
    args.push('-c:v', 'libx264', '-preset', 'fast', '-c:a', 'aac');
  }

  args.push('-shortest', outCheck.resolvedPath);

  return args;
}

/**
 * Safe process execution wrapper
 * Guarantees { shell: false }, strict timeout boundaries, and max stderr buffer
 */
export async function executeSafeFfmpeg(
  binaryPath: string,
  args: string[],
  options: {
    timeoutMs?: number;
    maxBufferBytes?: number;
    env?: NodeJS.ProcessEnv;
  } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const timeoutMs = options.timeoutMs ?? 300000; // 5 min default
  const maxBuffer = options.maxBufferBytes ?? 10 * 1024 * 1024; // 10MB

  return new Promise((resolve, reject) => {
    // Explicitly enforce shell: false to guarantee argument array cannot be injected
    const proc = spawn(binaryPath, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env ?? process.env
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeoutMs);

    proc.stdout.on('data', chunk => {
      if (stdout.length < maxBuffer) {
        stdout += chunk.toString();
      }
    });

    proc.stderr.on('data', chunk => {
      if (stderr.length < maxBuffer) {
        stderr += chunk.toString();
      }
    });

    proc.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on('close', code => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`FFmpeg process timed out after ${timeoutMs}ms and was killed`));
        return;
      }
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0
      });
    });
  });
}
