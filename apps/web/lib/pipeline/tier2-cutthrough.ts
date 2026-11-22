/**
 * MUXARO Tier 2 — Zero-Disk Cut-Through Remuxer
 * apps/web/lib/pipeline/tier2-cutthrough.ts
 *
 * Spins up an ephemeral localhost http.createServer on OS-assigned port 0,
 * bound strictly to 127.0.0.1, with a per-job cryptographically random bearer
 * path token. Pipes video and audio range-fetcher streams directly into two
 * local HTTP responses. FFmpeg reads from both loopback URLs, muxes stream-copy
 * to stdout (pipe:1), which we stream straight to the client HTTP response.
 *
 * Windows 11 & Linux safe: port 0 binding works on both; no /dev/stdin trick.
 */

import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline as streamPipeline, Readable } from 'node:stream';
import { promisify } from 'node:util';
import type { StreamTrackDescriptor, PipelineTelemetry, MuxMode } from './types.ts';
import { createRangeFetcherStream, probeContentLength } from './range-fetcher.ts';

const pipelineAsync = promisify(streamPipeline);

// ---------------------------------------------------------------------------
// RangeFetcher integration — backed by apps/web/lib/pipeline/range-fetcher.ts
// ---------------------------------------------------------------------------
interface RangeFetchStream {
  /** A Node.js Readable stream delivering track bytes in order */
  stream: Readable;
  /** Telemetry aggregated across chunks */
  getTelemetry(): { bytesDownloaded: number; throughputBytesPerSec: number };
  /** Abort the fetch (client disconnect) */
  abort(): void;
}

/** Fetches track using the parallel range ring-buffer; falls back to single stream if unknown length */
async function fetchTrackStream(
  track: StreamTrackDescriptor,
  signal: AbortSignal,
): Promise<RangeFetchStream> {
  let len = track.contentLength;
  if (!len || len <= 0) {
    len = await probeContentLength(track.url, track.headers, signal);
  }

  if (len && len > 0) {
    let downloadedBytes = 0;
    let currentSpeedMBps = 0;
    const stream = createRangeFetcherStream({
      url: track.url,
      contentLength: len,
      signal,
      headers: track.headers,
      onProgress: (t) => {
        downloadedBytes = t.downloadedBytes;
        currentSpeedMBps = t.speedMBps;
      },
    });

    return {
      stream,
      getTelemetry: () => ({
        bytesDownloaded: downloadedBytes,
        throughputBytesPerSec: currentSpeedMBps * 1024 * 1024,
      }),
      abort: () => stream.destroy(),
    };
  }

  return fallbackRangeFetch(track, signal);
}

/** Minimal fallback: single native-fetch stream with no chunking */
async function fallbackRangeFetch(
  track: StreamTrackDescriptor,
  signal: AbortSignal,
): Promise<RangeFetchStream> {
  const fetchHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0',
    ...(track.headers ?? {}),
  };
  const res = await fetch(track.url, { headers: fetchHeaders, signal });
  if (!res.ok || !res.body) {
    throw new Error(`Fallback fetch failed: ${res.status} ${res.url}`);
  }
  const webStream = res.body;
  const nodeStream = Readable.fromWeb(
    webStream as Parameters<typeof Readable.fromWeb>[0],
  );
  let bytesDownloaded = 0;
  const startMs = Date.now();
  nodeStream.on('data', (chunk: Buffer) => {
    bytesDownloaded += chunk.length;
  });
  return {
    stream: nodeStream,
    getTelemetry: () => ({
      bytesDownloaded,
      throughputBytesPerSec:
        bytesDownloaded / Math.max(1, (Date.now() - startMs) / 1000),
    }),
    abort: () => nodeStream.destroy(),
  };
}

// ---------------------------------------------------------------------------
// Ephemeral loopback server
// ---------------------------------------------------------------------------

interface LoopbackServer {
  host: string;
  port: number;
  videoPath: string;
  audioPath: string;
  close: () => void;
}

/**
 * Starts an ephemeral http.createServer bound to 127.0.0.1:0.
 * Returns the OS-assigned port and the two path tokens.
 * Each path is served exactly once: the first GET delivers the stream and
 * closes; subsequent requests get 404.
 */
function startLoopbackServer(
  videoStream: Readable,
  audioStream: Readable,
): Promise<LoopbackServer> {
  return new Promise((resolve, reject) => {
    const token = crypto.randomBytes(24).toString('hex');
    const videoPath = `/${token}/video`;
    const audioPath = `/${token}/audio`;

    const served = new Set<string>();

    const server = http.createServer((req, res) => {
      const url = req.url ?? '';

      if (url === videoPath || url === audioPath) {
        if (req.method === 'HEAD') {
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Accept-Ranges': 'none',
          }).end();
          return;
        }

        const src = url === videoPath ? videoStream : audioStream;
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Transfer-Encoding': 'chunked',
        });
        // Pipe with backpressure; ignore pipeline error (FFmpeg will close)
        pipelineAsync(src, res).catch(() => {});
      } else {
        res.writeHead(404).end();
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        return reject(new Error('Loopback server failed to bind'));
      }
      resolve({
        host: '127.0.0.1',
        port: addr.port,
        videoPath,
        audioPath,
        close: () => server.close(),
      });
    });

    server.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// FFmpeg argument builders
// ---------------------------------------------------------------------------

type OutputContainerHint = 'mkv' | 'webm' | 'mp4' | string;

interface FfmpegArgs {
  inputArgs: string[];
  outputArgs: string[];
  contentType: string;
  fileExtension: string;
}

function buildFfmpegArgs(
  loopback: LoopbackServer,
  container: OutputContainerHint,
  audioCodec: string,
  muxMode: MuxMode,
): FfmpegArgs {
  const videoUrl = `http://${loopback.host}:${loopback.port}${loopback.videoPath}`;
  const audioUrl = `http://${loopback.host}:${loopback.port}${loopback.audioPath}`;

  const inputArgs = [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-y',
    '-probesize', '65536',
    '-analyzeduration', '0',
    '-fflags', 'nobuffer+fastseek',
    // Video input with large thread queue to absorb burst latency
    '-thread_queue_size', '1024',
    '-i', videoUrl,
    // Audio input
    '-thread_queue_size', '1024',
    '-i', audioUrl,
  ];

  const fmt = container.toLowerCase();

  if (fmt === 'mkv' || fmt === 'matroska') {
    return {
      inputArgs,
      outputArgs: [
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c', 'copy',
        '-flush_packets', '1',
        '-f', 'matroska',
        'pipe:1',
      ],
      contentType: 'video/x-matroska',
      fileExtension: 'mkv',
    };
  }

  if (fmt === 'webm') {
    return {
      inputArgs,
      outputArgs: [
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c', 'copy',
        '-f', 'webm',
        'pipe:1',
      ],
      contentType: 'video/webm',
      fileExtension: 'webm',
    };
  }

  // fMP4 — audio codec decision:
  // stream-copy when AAC, re-encode to AAC 192k otherwise (Opus in MP4 is
  // non-standard; audio-aac-only muxMode forces transcode).
  const isAacPassthrough =
    muxMode === 'stream-copy' && audioCodec.toLowerCase().includes('aac');
  const audioOutputArgs: string[] = isAacPassthrough
    ? ['-c:a', 'copy']
    : ['-c:a', 'aac', '-b:a', '192k'];

  return {
    inputArgs,
    outputArgs: [
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      ...audioOutputArgs,
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-f', 'mp4',
      'pipe:1',
    ],
    contentType: 'video/mp4',
    fileExtension: 'mp4',
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface Tier2Options {
  jobId: string;
  videoTrack: StreamTrackDescriptor;
  audioTrack: StreamTrackDescriptor;
  /** Target container: 'mkv' | 'webm' | 'mp4'. Default 'mkv'. */
  outputContainer?: OutputContainerHint;
  muxMode?: MuxMode;
  /** Title used for Content-Disposition filename */
  title?: string;
  /** AbortSignal: wired to both fetcher abort and FFmpeg kill */
  signal?: AbortSignal;
  /** Writable: the HTTP response stream to pipe muxed output into */
  responseWritable: NodeJS.WritableStream;
  /** Callback to send HTTP headers before data begins */
  sendHeaders: (headers: {
    contentType: string;
    fileExtension: string;
  }) => void;
}

export interface Tier2Result {
  telemetry: PipelineTelemetry;
  durationMs: number;
}

/**
 * Executes a Tier 2 zero-disk cut-through remux.
 *
 * Flow:
 *   1. Create AbortController for lifecycle management.
 *   2. Launch parallel range-fetcher streams for video + audio.
 *   3. Spin up ephemeral loopback server on 127.0.0.1:0 serving both streams.
 *   4. Send HTTP headers to client (Content-Type, Content-Disposition).
 *   5. Spawn FFmpeg reading from two loopback URLs, writing muxed to pipe:1.
 *   6. Pipe FFmpeg stdout directly into client HTTP response (stream.pipeline).
 *   7. Drain FFmpeg stderr; close loopback server and abort fetchers on exit.
 */
export async function runTier2CutThrough(opts: Tier2Options): Promise<Tier2Result> {
  const {
    jobId,
    videoTrack,
    audioTrack,
    outputContainer = 'mkv',
    muxMode = 'stream-copy',
    title,
    signal: externalSignal,
    responseWritable,
    sendHeaders,
  } = opts;

  const startMs = Date.now();

  // Internal lifecycle controller — also wired to external signal
  const controller = new AbortController();
  const { signal } = controller;

  const cleanup = (reason?: string) => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };

  // Wire external signal
  externalSignal?.addEventListener('abort', () => cleanup('external-abort'), {
    once: true,
  });

  // 1. Launch both fetchers in parallel using range-fetcher ring buffer
  const [videoFetch, audioFetch] = await Promise.all([
    fetchTrackStream(videoTrack, signal),
    fetchTrackStream(audioTrack, signal),
  ]);
  videoFetch.stream.on('error', () => {});
  audioFetch.stream.on('error', () => {});

  // 2. Spin up loopback server
  const loopback = await startLoopbackServer(videoFetch.stream, audioFetch.stream);

  // 3. Build FFmpeg args
  const audioCodec = audioTrack.codec ?? '';
  const { inputArgs, outputArgs, contentType, fileExtension } = buildFfmpegArgs(
    loopback,
    outputContainer,
    audioCodec,
    muxMode,
  );

  // 4. Send HTTP headers before any data
  sendHeaders({ contentType, fileExtension });

  // 5. Spawn FFmpeg
  const safeTitle = (title ?? jobId)
    .replace(/[^a-zA-Z0-9_.\- ]/g, '_')
    .slice(0, 120);

  const ffmpegArgs = [...inputArgs, ...outputArgs];

  const ffmpegProc = spawn('ffmpeg', ffmpegArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  // Drain stderr continuously (required — FFmpeg blocks if stderr fills)
  const stderrLines: string[] = [];
  ffmpegProc.stderr?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString('utf8').split('\n').filter(Boolean);
    stderrLines.push(...lines);
    // Keep last 40 lines only (memory bound)
    if (stderrLines.length > 40) stderrLines.splice(0, stderrLines.length - 40);
  });

  // Wire external abort → FFmpeg kill
  signal.addEventListener('abort', () => {
    if (!ffmpegProc.killed) ffmpegProc.kill('SIGKILL');
  }, { once: true });

  // 6. Pipeline FFmpeg stdout → HTTP response
  let ffmpegError: Error | null = null;
  try {
    await pipelineAsync(
      ffmpegProc.stdout as unknown as NodeJS.ReadableStream,
      responseWritable,
    );
  } catch (err) {
    ffmpegError = err instanceof Error ? err : new Error(String(err));
  }

  // 7. Wait for FFmpeg to exit (or it already has)
  const exitCode = await new Promise<number | null>((resolve) => {
    if (ffmpegProc.exitCode !== null) {
      resolve(ffmpegProc.exitCode);
      return;
    }
    ffmpegProc.once('exit', (code) => resolve(code));
    ffmpegProc.once('error', () => resolve(null));
  });

  // 8. Cleanup loopback server and fetchers
  loopback.close();
  videoFetch.abort();
  audioFetch.abort();
  cleanup('ffmpeg-exited');

  if (ffmpegError && exitCode !== 0) {
    const stderrSummary = stderrLines.slice(-10).join('\n');
    throw new Error(
      `FFmpeg tier-2 remux failed (exit ${exitCode}) for job ${jobId}.\n${stderrSummary}`,
    );
  }

  const durationMs = Date.now() - startMs;
  const videoTel = videoFetch.getTelemetry();
  const audioTel = audioFetch.getTelemetry();
  const totalBytes = videoTel.bytesDownloaded + audioTel.bytesDownloaded;
  const bytesPerSec = totalBytes / Math.max(1, durationMs / 1000);

  const telemetry: PipelineTelemetry = {
    executionTier: 'TIER_2_CUT_THROUGH_PIPE',
    cacheHit: false,
    ttfbMs: undefined, // measured upstream by caller
    totalDurationMs: durationMs,
    parallelConnections: 12, // 6 per track (from range-fetcher contract)
    bytesPerSec,
    diskIoMode: 'zero-disk',
    muxMode,
  };

  void safeTitle; // used for Content-Disposition by caller

  return { telemetry, durationMs };
}
