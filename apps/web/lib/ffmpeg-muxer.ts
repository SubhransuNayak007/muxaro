/**
 * MUXARO FFmpeg High-Performance Muxer & Transcoder
 * 
 * Handles:
 * 1. MP4 AAC audio transcode (when source audio is Opus or non-AAC) via:
 *    -c:v copy -c:a aac -b:a 192k -movflags +faststart
 * 2. Lossless stream-copy for MKV/WebM via:
 *    -c copy
 * 3. MP4 lossless stream-copy when source audio is already AAC/M4A via:
 *    -c:v copy -c:a copy -movflags +faststart
 * 4. High-fidelity audio extraction (MP3 320k, FLAC lossless, WAV PCM, Opus, M4A)
 * 5. Real progress parsing from stderr and cancellation support via AbortSignal.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { parseResolutionHeight } from './format-normalizer.ts';

export type TargetMuxContainer = 'mp4' | 'mkv' | 'webm';
export type TargetAudioFormat = 'mp3' | 'm4a' | 'opus' | 'flac' | 'wav';

export interface MuxProgress {
  timeSeconds?: number;
  timeDisplay?: string;
  speed?: string;
  percent?: number;
}

export interface MuxMediaOptions {
  videoPath: string;
  audioPath?: string;
  outputPath: string;
  targetContainer: TargetMuxContainer;
  sourceAudioCodec?: string;
  durationSeconds?: number;
  onProgress?: (progress: MuxProgress) => void;
  signal?: AbortSignal;
}

export interface ExtractAudioOptions {
  inputPath: string;
  outputPath: string;
  targetFormat: TargetAudioFormat;
  bitrateKbps?: number;
  durationSeconds?: number;
  onProgress?: (progress: MuxProgress) => void;
  signal?: AbortSignal;
}

export interface TranscodeVideoOptions {
  inputPath: string;
  outputPath: string;
  targetResolution?: '8K' | '4K' | '1440p' | '1080p' | '720p' | '480p' | '360p' | '240p' | string;
  durationSeconds?: number;
  onProgress?: (progress: MuxProgress) => void;
  signal?: AbortSignal;
}

function parseTimeToSeconds(timeStr: string): number | undefined {
  const parts = timeStr.trim().split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]);
    const minutes = parseFloat(parts[1]);
    const seconds = parseFloat(parts[2]);
    if (!isNaN(hours) && !isNaN(minutes) && !isNaN(seconds)) {
      return hours * 3600 + minutes * 60 + seconds;
    }
  }
  return undefined;
}

/**
 * Executes FFmpeg command with progress parsing and abort signal handling
 */
function runFFmpeg(
  args: string[],
  options: {
    durationSeconds?: number;
    onProgress?: (progress: MuxProgress) => void;
    signal?: AbortSignal;
  }
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      return reject(new Error('FFmpeg operation was aborted before starting.'));
    }

    const child = spawn('ffmpeg', args, {
      shell: false,
      windowsHide: true,
    });

    let stderrBuffer = '';

    const abortHandler = () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // Child might have already exited
      }
      reject(new Error('FFmpeg process was cancelled by user.'));
    };

    if (options.signal) {
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderrBuffer += text;

      // Keep only last 4000 characters to prevent memory blowup
      if (stderrBuffer.length > 8000) {
        stderrBuffer = stderrBuffer.slice(-4000);
      }

      if (options.onProgress) {
        // Parse time=HH:MM:SS.ms and speed=...x
        const timeMatch = text.match(/time=(\d{2}:\d{2}:\d{2}\.\d+)/);
        const speedMatch = text.match(/speed=\s*([\d.]+x)/);

        if (timeMatch) {
          const timeDisplay = timeMatch[1];
          const timeSec = parseTimeToSeconds(timeDisplay);
          let percent: number | undefined;

          if (timeSec !== undefined && options.durationSeconds && options.durationSeconds > 0) {
            percent = Math.min(100, Math.round((timeSec / options.durationSeconds) * 100));
          }

          options.onProgress({
            timeSeconds: timeSec,
            timeDisplay,
            speed: speedMatch ? speedMatch[1] : undefined,
            percent,
          });
        }
      }
    });

    child.on('error', (err) => {
      if (options.signal) {
        options.signal.removeEventListener('abort', abortHandler);
      }
      reject(err);
    });

    child.on('close', (code) => {
      if (options.signal) {
        options.signal.removeEventListener('abort', abortHandler);
      }

      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `FFmpeg exited with code ${code}. Error detail: ${stderrBuffer.slice(-1000).trim()}`
          )
        );
      }
    });
  });
}

/**
 * Multiplexes video and audio streams according to container specifications
 */
export async function muxMedia(options: MuxMediaOptions): Promise<void> {
  const {
    videoPath,
    audioPath,
    outputPath,
    targetContainer,
    sourceAudioCodec,
    durationSeconds,
    onProgress,
    signal,
  } = options;

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Source video file does not exist: ${videoPath}`);
  }

  if (audioPath && !fs.existsSync(audioPath)) {
    throw new Error(`Source audio file does not exist: ${audioPath}`);
  }

  const args: string[] = ['-y'];

  args.push('-i', videoPath);

  if (audioPath) {
    args.push('-i', audioPath);
  }

  if (targetContainer === 'mp4') {
    // If multiplexing into MP4:
    // Check if audio codec is Opus or not native AAC/MP3
    const audioCodecLower = String(sourceAudioCodec || '').toLowerCase();
    const isOpusOrIncompatible =
      audioCodecLower.includes('opus') ||
      audioCodecLower.includes('vorbis') ||
      audioCodecLower.includes('flac') ||
      audioCodecLower.includes('wav') ||
      audioCodecLower.includes('pcm');

    if (audioPath) {
      if (isOpusOrIncompatible) {
        // Transcode Opus/incompatible audio to AAC 192k, stream-copy video, optimize MP4 header for web streaming
        args.push(
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-movflags', '+faststart'
        );
      } else {
        // Audio is already AAC or MP4 compatible - stream copy both!
        args.push(
          '-c:v', 'copy',
          '-c:a', 'copy',
          '-movflags', '+faststart'
        );
      }
    } else {
      // Single file input containing video (and possibly audio)
      if (isOpusOrIncompatible) {
        args.push(
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-movflags', '+faststart'
        );
      } else {
        args.push(
          '-c:v', 'copy',
          '-c:a', 'copy',
          '-movflags', '+faststart'
        );
      }
    }
  } else if (targetContainer === 'mkv') {
    // Lossless stream-copy for MKV (-c copy supports all codecs)
    args.push('-c', 'copy');
  } else if (targetContainer === 'webm') {
    // WebM only accepts VP8/VP9/AV1 video and Opus/Vorbis audio.
    const audioCodecLower = String(sourceAudioCodec || '').toLowerCase();
    const isOpusOrVorbis = audioCodecLower.includes('opus') || audioCodecLower.includes('vorbis');
    const isWebmVideo =
      videoPath.toLowerCase().endsWith('.webm') ||
      videoPath.toLowerCase().endsWith('.vp9') ||
      videoPath.toLowerCase().endsWith('.av1');

    if (isWebmVideo && isOpusOrVorbis) {
      args.push('-c', 'copy');
    } else if (isWebmVideo) {
      args.push('-c:v', 'copy', '-c:a', 'libopus', '-b:a', '128k');
    } else {
      // Transcode video to VP9 and audio to Opus
      args.push('-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-c:a', 'libopus', '-b:a', '128k');
    }
  } else {
    // Fallback stream copy
    args.push('-c', 'copy');
  }

  args.push(outputPath);

  await runFFmpeg(args, { durationSeconds, onProgress, signal });

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    throw new Error(`Muxing completed but output file is empty: ${outputPath}`);
  }
}

/**
 * Extracts high-fidelity audio track with specific codec and bitrate
 */
export async function extractAudio(options: ExtractAudioOptions): Promise<void> {
  const { inputPath, outputPath, targetFormat, bitrateKbps, durationSeconds, onProgress, signal } =
    options;

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input media file does not exist: ${inputPath}`);
  }

  const args: string[] = ['-y', '-i', inputPath, '-vn'];

  switch (targetFormat) {
    case 'mp3':
      args.push('-c:a', 'libmp3lame', '-b:a', `${bitrateKbps || 320}k`);
      break;
    case 'm4a':
      args.push('-c:a', 'aac', '-b:a', `${bitrateKbps || 192}k`, '-movflags', '+faststart');
      break;
    case 'opus':
      args.push('-c:a', 'libopus', '-b:a', `${bitrateKbps || 160}k`);
      break;
    case 'flac':
      args.push('-c:a', 'flac');
      break;
    case 'wav':
      args.push('-c:a', 'pcm_s16le');
      break;
    default:
      args.push('-c:a', 'libmp3lame', '-b:a', '320k');
      break;
  }

  args.push(outputPath);

  await runFFmpeg(args, { durationSeconds, onProgress, signal });

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    throw new Error(`Audio extraction completed but output file is empty: ${outputPath}`);
  }
}

/**
 * Transcodes/compresses video to lower resolution target
 */
export async function transcodeVideo(options: TranscodeVideoOptions): Promise<void> {
  const { inputPath, outputPath, targetResolution, durationSeconds, onProgress, signal } = options;

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input media file does not exist: ${inputPath}`);
  }

  const targetHeight = parseResolutionHeight(targetResolution);

  const args: string[] = [
    '-y',
    '-i', inputPath,
    '-vf', `scale=-2:${targetHeight}`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath,
  ];

  await runFFmpeg(args, { durationSeconds, onProgress, signal });

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    throw new Error(`Video transcoding completed but output file is empty: ${outputPath}`);
  }
}
