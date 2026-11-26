/**
 * MUXARO Tier-1 Instant In-Browser Local Engine
 * Zero credits · Zero CAPTCHA · Zero server upload
 * Gracefully falls back to Tier-2 Cloud FFmpeg 8 if file > 350 MB or browser WASM is unavailable.
 */

import { FFmpegWorkerClient } from './ffmpeg/ffmpeg-client';
import type { ContainerFormat, AudioFormat } from './ffmpeg/types';

export const TIER1_MAX_BYTES = 350 * 1024 * 1024; // 350 MB browser RAM safety ceiling

export interface LocalProcessResult {
  blob: Blob;
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  command: string;
}

function parseFlexibleTimeToMs(str: string): number {
  const clean = String(str || '').trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 2) {
    return Math.round((Number(parts[0]) * 60 + Number(parts[1])) * 1000);
  }
  if (parts.length === 3) {
    return Math.round((Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2])) * 1000);
  }
  return Math.round((Number(clean) || 0) * 1000);
}

function formatMsSrt(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = String(Math.floor(total / 3600000)).padStart(2, '0');
  const m = String(Math.floor((total % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((total % 60000) / 1000)).padStart(2, '0');
  const r = String(total % 1000).padStart(3, '0');
  return `${h}:${m}:${s},${r}`;
}

/**
 * Pure JS Instant Subtitle Timing Shifter (Tier-1: 0ms, zero upload).
 */
export function shiftSubtitlesLocal(
  rawText: string,
  offsetMs = 0,
  targetFmt: 'srt' | 'vtt' = 'srt'
): { count: number; content: string } {
  const delta = Number(offsetMs) || 0;
  const blocks = String(rawText || '').replace(/\r\n/g, '\n').split(/\n\n+/);
  const cues: Array<{ startMs: number; endMs: number; body: string }> = [];

  for (const b of blocks) {
    const lines = b.split('\n').map((l) => l.trimEnd()).filter(Boolean);
    const tlIdx = lines.findIndex((l) => l.includes('-->'));
    if (tlIdx === -1) continue;
    const [sRaw, eRawPart] = lines[tlIdx].split('-->');
    const eRaw = (eRawPart || '').trim().split(/\s+/)[0];
    const startMs = Math.max(0, parseFlexibleTimeToMs(sRaw) + delta);
    const endMs = Math.max(startMs + 100, parseFlexibleTimeToMs(eRaw) + delta);
    const body = lines.slice(tlIdx + 1).join('\n').trim();
    if (body) cues.push({ startMs, endMs, body });
  }

  if (targetFmt === 'vtt') {
    const body = cues
      .map((c) => `${formatMsSrt(c.startMs).replace(',', '.')} --> ${formatMsSrt(c.endMs).replace(',', '.')}\n${c.body}`)
      .join('\n\n');
    return { count: cues.length, content: `WEBVTT\n\n${body}\n` };
  }
  const body = cues
    .map((c, idx) => `${idx + 1}\n${formatMsSrt(c.startMs)} --> ${formatMsSrt(c.endMs)}\n${c.body}`)
    .join('\n\n');
  return { count: cues.length, content: `${body}\n` };
}

/**
 * HTML5 Video + Canvas Lossless Frame Grabber (Tier-1: instant client-side capture).
 */
export async function captureLocalVideoFrame(
  file: File,
  timestampSec = 0,
  format: 'png' | 'jpg' = 'png'
): Promise<{
  format: 'png' | 'jpg';
  mime: string;
  filename: string;
  sizeBytes: number;
  dataUrl: string;
  width: number;
  height: number;
}> {
  const objUrl = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = objUrl;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Could not decode local video file in browser.'));
    });

    const targetTs = Math.min(Math.max(0, timestampSec), Math.max(0, (video.duration || 1) - 0.05));
    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error('Failed seeking video frame.'));
      video.currentTime = targetTs;
    });

    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    ctx.drawImage(video, 0, 0, w, h);

    const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Canvas frame encoding failed.'))),
        mime,
        format === 'jpg' ? 0.94 : undefined
      );
    });

    const dataUrl = canvas.toDataURL(mime, format === 'jpg' ? 0.94 : undefined);
    const stem = file.name.replace(/\.[^.]+$/, '') || 'frame';
    return {
      format,
      mime,
      filename: `${stem}_${targetTs.toFixed(2)}s.${format}`,
      sizeBytes: blob.size,
      dataUrl,
      width: w,
      height: h,
    };
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

export async function runLocalScrubMetadata(
  file: File,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<LocalProcessResult> {
  const client = FFmpegWorkerClient.getInstance();
  const inName = `input_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
  const outName = `clean_${Date.now()}.${ext}`;
  const args = [
    '-i', inName,
    '-map', '0:V?',
    '-map', '0:a?',
    '-map_chapters', '-1',
    '-map_metadata', '-1',
    '-map_metadata:s', '-1',
    '-fflags', '+bitexact',
    '-c', 'copy',
    ...(ext === 'mp4' || ext === 'mov' ? ['-movflags', '+faststart'] : []),
    outName,
  ];
  const res = await client.runTask({
    action: 'exec',
    inputFiles: [{ name: inName, data: file }],
    args,
    outputFileName: outName,
    outputMimeType: file.type || 'video/mp4',
    signal,
    onProgress: (p) => onProgress?.(p.percent),
  });
  const stem = file.name.replace(/\.[^.]+$/, '') || 'media';
  return {
    blob: res.blob,
    url: res.url,
    filename: `${stem}-clean.${ext}`,
    mimeType: res.mimeType,
    sizeBytes: res.sizeBytes,
    command: `ffmpeg -i ${file.name} -map 0:V? -map 0:a? -map_chapters -1 -map_metadata -1 -map_metadata:s -1 -fflags +bitexact -c copy clean.${ext}`,
  };
}

export async function runLocalLosslessTrim(
  file: File,
  startSec: number,
  endSec: number | null,
  targetExt?: string,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<LocalProcessResult> {
  const client = FFmpegWorkerClient.getInstance();
  const inName = `input_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const inExt = (file.name.split('.').pop() || 'mp4').toLowerCase();
  const outExt = targetExt || inExt;
  const outName = `trimmed_${Date.now()}.${outExt}`;
  const args = [
    '-ss', Math.max(0, startSec).toFixed(3),
    '-i', inName,
    ...(endSec !== null && endSec > startSec ? ['-to', endSec.toFixed(3)] : []),
    '-c', 'copy',
    '-avoid_negative_ts', 'make_zero',
    ...(outExt === 'mp4' ? ['-movflags', '+faststart'] : []),
    outName,
  ];
  const res = await client.runTask({
    action: 'exec',
    inputFiles: [{ name: inName, data: file }],
    args,
    outputFileName: outName,
    outputMimeType: outExt === 'mp4' ? 'video/mp4' : file.type || 'application/octet-stream',
    signal,
    onProgress: (p) => onProgress?.(p.percent),
  });
  const stem = file.name.replace(/\.[^.]+$/, '') || 'clip';
  return {
    blob: res.blob,
    url: res.url,
    filename: `${stem}-trimmed.${outExt}`,
    mimeType: res.mimeType,
    sizeBytes: res.sizeBytes,
    command: `ffmpeg -ss ${Math.max(0, startSec).toFixed(3)} -i ${file.name} ${endSec && endSec > startSec ? `-to ${endSec.toFixed(3)} ` : ''}-c copy -avoid_negative_ts make_zero trimmed.${outExt}`,
  };
}

export async function runLocalRemux(
  file: File,
  targetContainer: ContainerFormat,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<LocalProcessResult> {
  const client = FFmpegWorkerClient.getInstance();
  const res = await client.convert({
    file,
    targetContainer,
    streamCopy: true,
    signal,
    onProgress: (p) => onProgress?.(p.percent),
  });
  const stem = file.name.replace(/\.[^.]+$/, '') || 'video';
  return {
    blob: res.blob,
    url: res.url,
    filename: `${stem}.${targetContainer}`,
    mimeType: res.mimeType,
    sizeBytes: res.sizeBytes,
    command: `ffmpeg -i ${file.name} -c copy ${targetContainer === 'mp4' ? '-movflags +faststart ' : ''}output.${targetContainer}`,
  };
}

export async function runLocalAudioExtract(
  file: File,
  targetFormat: AudioFormat = 'copy',
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<LocalProcessResult> {
  const client = FFmpegWorkerClient.getInstance();
  const res = await client.extractAudio({
    file,
    targetFormat,
    streamCopy: targetFormat === 'copy' || targetFormat === 'native',
    signal,
    onProgress: (p) => onProgress?.(p.percent),
  });
  const stem = file.name.replace(/\.[^.]+$/, '') || 'audio';
  return {
    blob: res.blob,
    url: res.url,
    filename: res.fileName || `${stem}.${targetFormat === 'copy' ? 'm4a' : targetFormat}`,
    mimeType: res.mimeType,
    sizeBytes: res.sizeBytes,
    command: `ffmpeg -i ${file.name} -vn ${targetFormat === 'copy' || targetFormat === 'native' ? '-c:a copy' : `-c:a ${targetFormat}`} ${res.fileName}`,
  };
}

/**
 * Universal Offline Local FFmpeg WASM Fallback (for Android APK / Offline WebView).
 * Executes compress, gif, loudnorm, and aspect-ratio jobs directly on-device.
 */
export async function runLocalStudioJobFallback(
  file: File,
  params: Record<string, any>,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<LocalProcessResult> {
  const client = FFmpegWorkerClient.getInstance();
  const inName = `in_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const stem = file.name.replace(/\.[^.]+$/, '') || 'output';
  const tool = String(params.tool || params.jobType || params.operation || '').toLowerCase();

  let targetExt = String(params.targetFormat || 'mp4').replace(/^\./, '').toLowerCase();
  if (targetExt === 'source') {
    targetExt = (file.name.split('.').pop() || 'mp4').toLowerCase();
  }
  const outName = `local_${Date.now()}.${targetExt}`;
  let args: string[] = [];
  let mimeType = 'video/mp4';

  if (tool.includes('compress')) {
    const targetMb = Math.max(1, Number(params.targetSizeMb) || 10);
    const estKbps = Math.max(200, Math.min(4500, Math.round((targetMb * 7400) / 30)));
    args = ['-y', '-i', inName, '-c:v', 'libx264', '-b:v', `${estKbps}k`, '-preset', 'ultrafast'];
    if (params.muteVideo) args.push('-an');
    else args.push('-c:a', 'aac', '-b:a', '96k');
    args.push('-movflags', '+faststart', outName);
  } else if (tool.includes('gif')) {
    const fps = Math.max(5, Math.min(24, Number(params.fps) || 12));
    const width = Number(params.width) > 0 ? Number(params.width) : 480;
    mimeType = targetExt === 'webp' ? 'image/webp' : 'image/gif';
    args = ['-y', '-i', inName, '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos`, outName];
  } else if (tool.includes('normalizer') || tool.includes('loudnorm')) {
    const lufs = Number(params.targetLufs) || -14;
    const isAudioOnly = ['mp3', 'flac', 'wav', 'm4a', 'opus'].includes(targetExt);
    mimeType = isAudioOnly ? `audio/${targetExt === 'mp3' ? 'mpeg' : targetExt}` : 'video/mp4';
    args = ['-y', '-i', inName, ...(isAudioOnly ? ['-vn'] : ['-c:v', 'copy']), '-af', `loudnorm=I=${lufs}:TP=-1:LRA=11`, outName];
  } else if (tool.includes('aspect')) {
    const ratio = String(params.aspectRatio || '9:16');
    const dims =
      ratio === '1:1'
        ? { w: 720, h: 720 }
        : ratio === '4:5'
        ? { w: 720, h: 900 }
        : ratio === '16:9'
        ? { w: 1280, h: 720 }
        : { w: 720, h: 1280 };
    args = [
      '-y',
      '-i',
      inName,
      '-vf',
      `scale=${dims.w}:${dims.h}:force_original_aspect_ratio=decrease,pad=${dims.w}:${dims.h}:(ow-iw)/2:(oh-ih)/2`,
      '-c:a',
      'copy',
      outName,
    ];
  } else {
    args = ['-y', '-i', inName, outName];
  }

  const res = await client.runTask({
    action: 'exec',
    inputFiles: [{ name: inName, data: file }],
    args,
    outputFileName: outName,
    outputMimeType: mimeType,
    signal,
    onProgress: (p) => onProgress?.(p.percent),
  });

  return {
    blob: res.blob,
    url: res.url,
    filename: `${stem}-${tool.replace(/[^a-z0-9]/g, '') || 'local'}.${targetExt}`,
    mimeType: res.mimeType,
    sizeBytes: res.sizeBytes,
    command: `ffmpeg ${args.join(' ')}`,
  };
}

