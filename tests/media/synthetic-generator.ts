/**
 * Project VYRO - Synthetic Media Generator for QA & Engine Verification
 * File: tests/media/synthetic-generator.ts
 *
 * Uses native FFmpeg to synthesize real, compliant media files
 * for automated testing of probe, transcode, stream-copy, and merging.
 */

import { spawn } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface SyntheticMediaManifest {
  video720p: string;
  video1080p: string;
  video4k: string;
  audioMp3: string;
  audioWav: string;
  audioFlac: string;
  videoSilent: string;
  corruptMedia: string;
}

export function runFfmpegCommand(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const procEvents = proc as unknown as EventEmitter;
    let stderr = '';

    proc.stderr?.on('data', (d: Buffer | string) => {
      stderr += d.toString();
    });

    procEvents.on('close', (code: number | null) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}:\n${stderr}`));
      }
    });

    procEvents.on('error', (err: Error) => {
      reject(err);
    });
  });
}

export async function generateSyntheticMediaFixtures(
  outputDir: string
): Promise<SyntheticMediaManifest> {
  await fs.mkdir(outputDir, { recursive: true });

  const paths: SyntheticMediaManifest = {
    video720p: path.join(outputDir, 'test_video_720p.mp4'),
    video1080p: path.join(outputDir, 'test_video_1080p.mp4'),
    video4k: path.join(outputDir, 'test_video_4k.webm'),
    audioMp3: path.join(outputDir, 'test_audio.mp3'),
    audioWav: path.join(outputDir, 'test_audio.wav'),
    audioFlac: path.join(outputDir, 'test_audio.flac'),
    videoSilent: path.join(outputDir, 'test_video_silent.mp4'),
    corruptMedia: path.join(outputDir, 'test_corrupt.mp4'),
  };

  // 1. 720p H.264 + AAC MP4 (1 sec)
  await runFfmpegCommand([
    '-f', 'lavfi', '-i', 'testsrc=duration=1:size=1280x720:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1',
    '-c:v', 'libx264', '-preset', 'ultrafast',
    '-c:a', 'aac', '-b:a', '128k',
    '-pix_fmt', 'yuv420p',
    '-y', paths.video720p,
  ]);

  // 2. 1080p H.264 + AAC MP4 (1 sec)
  await runFfmpegCommand([
    '-f', 'lavfi', '-i', 'testsrc=duration=1:size=1920x1080:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:v', 'libx264', '-preset', 'ultrafast',
    '-c:a', 'aac', '-b:a', '192k',
    '-pix_fmt', 'yuv420p',
    '-y', paths.video1080p,
  ]);

  // 3. 4K VP9 + Opus WebM (1 sec)
  await runFfmpegCommand([
    '-f', 'lavfi', '-i', 'testsrc=duration=1:size=3840x2160:rate=24',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1',
    '-c:v', 'libvpx-vp9', '-cpu-used', '8', '-deadline', 'realtime',
    '-c:a', 'libopus', '-b:a', '128k',
    '-pix_fmt', 'yuv420p',
    '-y', paths.video4k,
  ]);

  // 4. MP3 Audio (1 sec, 44.1kHz stereo)
  await runFfmpegCommand([
    '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1',
    '-c:a', 'libmp3lame', '-b:a', '192k',
    '-y', paths.audioMp3,
  ]);

  // 5. WAV Audio (1 sec, 48kHz stereo)
  await runFfmpegCommand([
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:a', 'pcm_s16le', '-ar', '48000',
    '-y', paths.audioWav,
  ]);

  // 6. FLAC Audio (1 sec, 44.1kHz lossless)
  await runFfmpegCommand([
    '-f', 'lavfi', '-i', 'sine=frequency=520:duration=1',
    '-c:a', 'flac',
    '-y', paths.audioFlac,
  ]);

  // 7. Video-only Silent MP4 (1 sec, no audio stream)
  await runFfmpegCommand([
    '-f', 'lavfi', '-i', 'testsrc=duration=1:size=1280x720:rate=30',
    '-c:v', 'libx264', '-preset', 'ultrafast',
    '-an',
    '-pix_fmt', 'yuv420p',
    '-y', paths.videoSilent,
  ]);

  // 8. Corrupted media file (invalid random bytes)
  const corruptBuffer = Buffer.from(
    'ftypisom\x00\x00\x00\x00corrupted_invalid_header_payload_test_bytes_' +
      Math.random().toString(36)
  );
  await fs.writeFile(paths.corruptMedia, corruptBuffer);

  return paths;
}
