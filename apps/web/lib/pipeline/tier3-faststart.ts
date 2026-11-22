/**
 * MUXARO Tier 3 — Universal Faststart MP4 Engine
 * apps/web/lib/pipeline/tier3-faststart.ts
 *
 * Implements high-throughput parallel downloads into tmpfs/scratch storage
 * followed by zero-reencode faststart packaging with full HTTP Range 206 streaming.
 *
 * Core Features:
 * 1. Concurrent parallel download of Video and Audio tracks simultaneously (Promise.all)
 *    using ParallelRangePipeline into scratch files (`video.part`, `audio.part`).
 * 2. Zero-reencode policy: run FFmpeg `-c copy -movflags +faststart`
 *    (or `-c:v copy -c:a aac -b:a 192k` if source audio is Opus) with `-y -nostdin`.
 * 3. Immediately unlink raw `.part` files once output is verified > 0 bytes.
 * 4. Stream completed output with full Range 206 support.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable, pipeline as streamPipeline } from 'node:stream';
import { promisify } from 'node:util';
import type { ServerResponse, IncomingHttpHeaders } from 'node:http';

import { allocateScratch } from './scratch.ts';
import type { ScratchDirectory } from './scratch.ts';
import { ParallelRangePipeline } from '../stream-engine/range-pipeline.ts';
import { probeContentLength } from './range-fetcher.ts';
import { formatContentDisposition, sanitizeFilename } from '../security-validator.ts';
import type {
  StreamTrackDescriptor,
  PipelineTelemetry,
  MuxMode,
  DiskIoMode,
} from './types.ts';

const pipelineAsync = promisify(streamPipeline);

// ---------------------------------------------------------------------------
// MIME & Extension Mappings
// ---------------------------------------------------------------------------

const MIME_MAP: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  flac: 'audio/flac',
  wav: 'audio/wav',
  opus: 'audio/opus',
  aac: 'audio/aac',
};

// ---------------------------------------------------------------------------
// Types & Options
// ---------------------------------------------------------------------------

export interface Tier3Options {
  jobId: string;
  videoTrack?: StreamTrackDescriptor;
  audioTrack?: StreamTrackDescriptor;
  directProgressiveUrl?: string;
  targetFormat?: string;
  title?: string;
  signal?: AbortSignal;
  customScratchBase?: string;
  onProgress?: (progress: Tier3Progress) => void;
}

export interface Tier3Progress {
  stage: 'allocating' | 'downloading' | 'muxing' | 'ready';
  percent: number;
  videoDownloadedBytes?: number;
  audioDownloadedBytes?: number;
  totalBytes?: number;
  speedMBps?: number;
}

export interface ByteRange {
  start: number;
  end: number;
}

export interface Tier3Result {
  jobId: string;
  outputPath: string;
  fileSizeBytes: number;
  mimeType: string;
  filename: string;
  telemetry: PipelineTelemetry;
  createReadStream: (range?: ByteRange) => fs.ReadStream;
  handleRangeResponse: (
    reqHeaders: IncomingHttpHeaders | Headers | Record<string, string | string[] | undefined>,
    res: ServerResponse
  ) => Promise<void>;
  createRangeWebResponse: (
    reqHeaders: Headers | Record<string, string | string[] | undefined>
  ) => Response;
  cleanup: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Track Downloader (ParallelRangePipeline to Scratch File)
// ---------------------------------------------------------------------------

/**
 * Downloads a media track into a scratch .part file using ParallelRangePipeline
 * with fallback to direct web stream.
 */
async function downloadTrackToScratch(
  track: StreamTrackDescriptor,
  destPartPath: string,
  signal?: AbortSignal,
  onTrackProgress?: (downloaded: number, total: number) => void
): Promise<number> {
  // If track contentLength is missing or zero, probe via HEAD / Range 0-0
  let totalBytes = track.contentLength || 0;
  if (totalBytes <= 0) {
    try {
      totalBytes = await probeContentLength(track.url, track.headers, signal);
      if (totalBytes < 0) totalBytes = 0;
    } catch {
      totalBytes = 0;
    }
  }

  // 1. Try parallel range pipeline download
  try {
    const pipeline = new ParallelRangePipeline({
      url: track.url,
      totalBytes,
      streamType: track.trackType === 'video' ? 'video' : 'audio',
      signal,
      headers: track.headers,
      onProgress: (p) => {
        if (p.downloadedBytes) {
          onTrackProgress?.(p.downloadedBytes, p.totalBytes || totalBytes);
        }
      },
    });

    const writeStream = fs.createWriteStream(destPartPath);
    const ringBuffer = pipeline.getRingBuffer();
    const startPromise = pipeline.start();

    let bytesWritten = 0;

    while (true) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const chunk = await ringBuffer.popNextOrderedChunk(signal);
      if (!chunk) break; // Finished and closed

      const canContinue = writeStream.write(chunk.data);
      bytesWritten += chunk.data.byteLength;
      onTrackProgress?.(bytesWritten, totalBytes || bytesWritten);

      if (!canContinue) {
        await new Promise<void>((resolve, reject) => {
          const onDrain = () => {
            cleanupListeners();
            resolve();
          };
          const onAbort = () => {
            cleanupListeners();
            reject(new DOMException('Aborted', 'AbortError'));
          };
          const onError = (err: Error) => {
            cleanupListeners();
            reject(err);
          };
          const cleanupListeners = () => {
            writeStream.removeListener('drain', onDrain);
            writeStream.removeListener('error', onError);
            signal?.removeEventListener('abort', onAbort);
          };

          writeStream.once('drain', onDrain);
          writeStream.once('error', onError);
          signal?.addEventListener('abort', onAbort, { once: true });
        });
      }
    }

    await new Promise<void>((resolve, reject) => {
      writeStream.end((err?: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });

    await startPromise;

    if (bytesWritten > 0) {
      return bytesWritten;
    }
  } catch (err: any) {
    if (signal?.aborted) throw err;
    console.warn(`[Tier3] ParallelRangePipeline download hit an exception, falling back to direct stream:`, err?.message || err);
  }

  // 2. Resilient Direct Stream Fallback
  try {
    const fetchHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      ...(track.headers || {}),
    };

    const res = await fetch(track.url, {
      headers: fetchHeaders,
      signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`Direct fetch failed with HTTP ${res.status}: ${res.statusText}`);
    }

    const nodeReadable = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    const fileOut = fs.createWriteStream(destPartPath);

    let directBytes = 0;
    nodeReadable.on('data', (c: Buffer) => {
      directBytes += c.length;
      onTrackProgress?.(directBytes, totalBytes || directBytes);
    });

    await pipelineAsync(nodeReadable, fileOut);
    return directBytes;
  } catch (directErr) {
    // Clean up partial file on failure
    try {
      await fs.promises.unlink(destPartPath);
    } catch {}
    throw directErr;
  }
}

// ---------------------------------------------------------------------------
// HTTP Range 206 Parser
// ---------------------------------------------------------------------------

/**
 * Parses HTTP Range header string (e.g. 'bytes=0-1024', 'bytes=1024-', 'bytes=-500').
 * Returns null if the range is syntactically invalid or unsatisfiable.
 */
export function parseRangeHeader(
  rangeHeader: string | undefined | null,
  totalBytes: number
): ByteRange | null | 'not_requested' {
  if (!rangeHeader || typeof rangeHeader !== 'string') {
    return 'not_requested';
  }

  const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    return null; // Malformed range
  }

  const [, startStr, endStr] = match;

  // Suffix range: bytes=-500 (last 500 bytes)
  if (!startStr && endStr) {
    const suffixLen = parseInt(endStr, 10);
    if (isNaN(suffixLen) || suffixLen <= 0) return null;
    const start = Math.max(0, totalBytes - suffixLen);
    return { start, end: totalBytes - 1 };
  }

  // Open range: bytes=100- (from 100 to end)
  if (startStr && !endStr) {
    const start = parseInt(startStr, 10);
    if (isNaN(start) || start < 0 || start >= totalBytes) return null;
    return { start, end: totalBytes - 1 };
  }

  // Bounded range: bytes=100-500
  if (startStr && endStr) {
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (isNaN(start) || isNaN(end) || start < 0 || start > end || start >= totalBytes) {
      return null;
    }
    return { start, end: Math.min(end, totalBytes - 1) };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tier 3 Engine Execution
// ---------------------------------------------------------------------------

/**
 * Executes the Tier 3 Universal Faststart MP4 Engine.
 */
export async function executeTier3Faststart(opts: Tier3Options): Promise<Tier3Result> {
  const {
    jobId,
    videoTrack,
    audioTrack,
    directProgressiveUrl,
    targetFormat = 'mp4',
    title = 'muxaro_media',
    signal,
    customScratchBase,
    onProgress,
  } = opts;

  const startTime = Date.now();
  const format = targetFormat.toLowerCase();
  const isMp4Family = ['mp4', 'm4v', 'm4a', 'mov'].includes(format);
  const mimeType = MIME_MAP[format] || 'application/octet-stream';
  const cleanFilename = sanitizeFilename(title, format);

  // 1. Calculate estimated payload size for scratch allocator
  const estimatedBytes =
    (videoTrack?.contentLength || 0) + (audioTrack?.contentLength || 0) ||
    250 * 1024 * 1024;

  onProgress?.({
    stage: 'allocating',
    percent: 0,
    totalBytes: estimatedBytes,
  });

  // 2. Allocate scratch workspace (Linux /dev/shm tmpfs if eligible, else disk)
  const scratch: ScratchDirectory = await allocateScratch({
    jobId,
    estimatedSizeBytes: estimatedBytes,
    customScratchBase,
  });

  const videoPartPath = scratch.getFilePath('video.part');
  const audioPartPath = scratch.getFilePath('audio.part');
  const outputPath = scratch.getFilePath(`output.${format}`);

  let muxMode: MuxMode = 'stream-copy';

  // 3. Concurrent Parallel Download Phase (Promise.all)
  onProgress?.({
    stage: 'downloading',
    percent: 10,
    totalBytes: estimatedBytes,
  });

  let videoDownloaded = 0;
  let audioDownloaded = 0;

  const updateDownloadProgress = () => {
    const totalDown = videoDownloaded + audioDownloaded;
    const pct = estimatedBytes > 0
      ? Math.min(85, Math.round(10 + (totalDown / estimatedBytes) * 75))
      : 50;
    const elapsedSec = (Date.now() - startTime) / 1000;
    const speedMBps = elapsedSec > 0.2 ? totalDown / (elapsedSec * 1024 * 1024) : 0;

    onProgress?.({
      stage: 'downloading',
      percent: pct,
      videoDownloadedBytes: videoDownloaded,
      audioDownloadedBytes: audioDownloaded,
      totalBytes: estimatedBytes,
      speedMBps,
    });
  };

  const downloadTasks: Promise<number>[] = [];

  // Determine tracks to download
  let hasVideo = false;
  let hasAudio = false;

  if (videoTrack) {
    hasVideo = true;
    downloadTasks.push(
      downloadTrackToScratch(videoTrack, videoPartPath, signal, (down) => {
        videoDownloaded = down;
        updateDownloadProgress();
      })
    );
  } else if (directProgressiveUrl) {
    // Single progressive video stream
    hasVideo = true;
    const dummyTrack: StreamTrackDescriptor = {
      trackType: 'video',
      url: directProgressiveUrl,
      codec: 'h264',
      container: 'mp4',
    };
    downloadTasks.push(
      downloadTrackToScratch(dummyTrack, videoPartPath, signal, (down) => {
        videoDownloaded = down;
        updateDownloadProgress();
      })
    );
  }

  if (audioTrack) {
    hasAudio = true;
    downloadTasks.push(
      downloadTrackToScratch(audioTrack, audioPartPath, signal, (down) => {
        audioDownloaded = down;
        updateDownloadProgress();
      })
    );
  }

  if (downloadTasks.length === 0) {
    await scratch.cleanup();
    throw new Error('No video, audio, or progressive track provided to Tier 3 engine.');
  }

  // Concurrent parallel execution of Video and Audio downloads simultaneously
  await Promise.all(downloadTasks);

  if (signal?.aborted) {
    await scratch.cleanup();
    throw new DOMException('Aborted', 'AbortError');
  }

  // 4. Zero-Reencode FFmpeg Muxing Policy
  onProgress?.({
    stage: 'muxing',
    percent: 88,
  });

  // Determine audio codec & re-encode policy
  const sourceAudioCodec = audioTrack?.codec?.toLowerCase() || '';
  const isSourceOpus = sourceAudioCodec.includes('opus');

  if (isMp4Family && isSourceOpus) {
    // Safari / QuickTime / Apple MP4 container incompatibility with Opus
    // Convert Opus to pristine 192k AAC
    muxMode = 'audio-aac-only';
  } else {
    // Zero-reencode copy mode
    muxMode = 'stream-copy';
  }

  const ffmpegArgs: string[] = [
    '-y',
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
  ];

  if (hasVideo) {
    ffmpegArgs.push('-i', videoPartPath);
  }
  if (hasAudio) {
    ffmpegArgs.push('-i', audioPartPath);
  }

  // Stream mapping
  if (hasVideo && hasAudio) {
    ffmpegArgs.push('-map', '0:v:0', '-map', '1:a:0');
  } else if (hasVideo) {
    ffmpegArgs.push('-map', '0:v:0');
  } else if (hasAudio) {
    ffmpegArgs.push('-map', '0:a:0');
  }

  // Codec application
  if (muxMode === 'audio-aac-only') {
    ffmpegArgs.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k');
  } else {
    ffmpegArgs.push('-c', 'copy');
  }

  // Faststart header relocation for MP4 containers
  if (isMp4Family) {
    ffmpegArgs.push('-movflags', '+faststart');
  }

  ffmpegArgs.push(outputPath);

  // Execute FFmpeg
  await new Promise<void>((resolve, reject) => {
    const ffmpegProc = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    const stderrLines: string[] = [];
    ffmpegProc.stderr.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      stderrLines.push(text);
      if (stderrLines.length > 30) stderrLines.shift();
    });

    const onAbort = () => {
      ffmpegProc.kill('SIGKILL');
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    ffmpegProc.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
    });

    ffmpegProc.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (code === 0) {
        resolve();
      } else {
        const errorDetail = stderrLines.join('\n').trim();
        reject(
          new Error(
            `FFmpeg exited with error code ${code}: ${errorDetail || 'Unknown FFmpeg error'}`
          )
        );
      }
    });
  });

  // 5. Verification & Immediate Raw Part File Cleanup
  const outputFileSize = await scratch.getFileSize(outputPath);
  if (outputFileSize <= 0) {
    await scratch.cleanup();
    throw new Error(`FFmpeg exited 0 but output file is empty (0 bytes): ${outputPath}`);
  }

  // Immediately unlink raw .part files once output is verified > 0 bytes
  await Promise.all([
    hasVideo ? scratch.removeFile(videoPartPath) : Promise.resolve(),
    hasAudio ? scratch.removeFile(audioPartPath) : Promise.resolve(),
  ]);

  const totalDurationMs = Date.now() - startTime;
  const avgThroughputBytesPerSec =
    totalDurationMs > 0 ? Math.round((outputFileSize / totalDurationMs) * 1000) : 0;

  const telemetry: PipelineTelemetry = {
    executionTier: 'TIER_3_FASTSTART_SCRATCH',
    cacheHit: false,
    totalDurationMs,
    bytesPerSec: avgThroughputBytesPerSec,
    diskIoMode: scratch.diskIoMode,
    muxMode,
  };

  onProgress?.({
    stage: 'ready',
    percent: 100,
    totalBytes: outputFileSize,
  });

  // 6. Output Stream Factory & Range 206 Handlers
  const createReadStream = (range?: ByteRange): fs.ReadStream => {
    if (range) {
      return fs.createReadStream(outputPath, { start: range.start, end: range.end });
    }
    return fs.createReadStream(outputPath);
  };

  const handleRangeResponse = async (
    reqHeaders: IncomingHttpHeaders | Headers | Record<string, string | string[] | undefined>,
    res: ServerResponse
  ): Promise<void> => {
    let rawRange: string | undefined;
    if (reqHeaders instanceof Headers) {
      rawRange = reqHeaders.get('range') || undefined;
    } else {
      const headerVal = (reqHeaders as Record<string, any>)['range'];
      rawRange = Array.isArray(headerVal) ? headerVal[0] : headerVal;
    }

    const rangeParsed = parseRangeHeader(rawRange, outputFileSize);

    if (rangeParsed === null) {
      // 416 Range Not Satisfiable
      res.writeHead(416, {
        'Content-Range': `bytes */${outputFileSize}`,
        'Content-Type': 'text/plain',
      });
      res.end('Requested Range Not Satisfiable');
      return;
    }

    if (rangeParsed === 'not_requested') {
      // 200 OK Full Stream
      res.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Length': String(outputFileSize),
        'Accept-Ranges': 'bytes',
        'Content-Disposition': formatContentDisposition(cleanFilename),
        'X-Content-Type-Options': 'nosniff',
        'X-Muxaro-Tier': 'TIER_3_FASTSTART_SCRATCH',
        'X-Muxaro-Disk-Mode': scratch.diskIoMode,
        'X-Muxaro-Mux-Mode': muxMode,
      });

      const fileStream = createReadStream();
      await pipelineAsync(fileStream, res);
      return;
    }

    // 206 Partial Content Stream
    const { start, end } = rangeParsed;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${outputFileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(chunkSize),
      'Content-Type': mimeType,
      'Content-Disposition': formatContentDisposition(cleanFilename),
      'X-Content-Type-Options': 'nosniff',
      'X-Muxaro-Tier': 'TIER_3_FASTSTART_SCRATCH',
      'X-Muxaro-Disk-Mode': scratch.diskIoMode,
      'X-Muxaro-Mux-Mode': muxMode,
    });

    const fileStream = createReadStream({ start, end });
    await pipelineAsync(fileStream, res);
  };

  const createRangeWebResponse = (
    reqHeaders: Headers | Record<string, string | string[] | undefined>
  ): Response => {
    let rawRange: string | undefined;
    if (reqHeaders instanceof Headers) {
      rawRange = reqHeaders.get('range') || undefined;
    } else {
      const headerVal = (reqHeaders as Record<string, any>)['range'];
      rawRange = Array.isArray(headerVal) ? headerVal[0] : headerVal;
    }

    const rangeParsed = parseRangeHeader(rawRange, outputFileSize);

    if (rangeParsed === null) {
      return new Response('Requested Range Not Satisfiable', {
        status: 416,
        headers: {
          'Content-Range': `bytes */${outputFileSize}`,
          'Content-Type': 'text/plain',
        },
      });
    }

    const commonHeaders: Record<string, string> = {
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Content-Disposition': formatContentDisposition(cleanFilename),
      'X-Content-Type-Options': 'nosniff',
      'X-Muxaro-Tier': 'TIER_3_FASTSTART_SCRATCH',
      'X-Muxaro-Disk-Mode': scratch.diskIoMode,
      'X-Muxaro-Mux-Mode': muxMode,
    };

    if (rangeParsed === 'not_requested') {
      const nodeStream = createReadStream();
      const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
      return new Response(webStream, {
        status: 200,
        headers: {
          ...commonHeaders,
          'Content-Length': String(outputFileSize),
        },
      });
    }

    const { start, end } = rangeParsed;
    const chunkSize = end - start + 1;
    const nodeStream = createReadStream({ start, end });
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    return new Response(webStream, {
      status: 206,
      headers: {
        ...commonHeaders,
        'Content-Range': `bytes ${start}-${end}/${outputFileSize}`,
        'Content-Length': String(chunkSize),
      },
    });
  };

  return {
    jobId,
    outputPath,
    fileSizeBytes: outputFileSize,
    mimeType,
    filename: cleanFilename,
    telemetry,
    createReadStream,
    handleRangeResponse,
    createRangeWebResponse,
    cleanup: () => scratch.cleanup(),
  };
}
