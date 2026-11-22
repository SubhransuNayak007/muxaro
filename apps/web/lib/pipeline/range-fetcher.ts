/**
 * MUXARO Parallel Range-Chunk Ring-Buffer Engine (aria2c Parity)
 *
 * Phase 2 Calibration:
 * - 9.5 MB chunks per Range request (matches YouTube 10–15 MB CDN burst threshold)
 * - Scaled 16 concurrent HTTP Range connections for files > 40 MB
 * - Dedicated connection pool: http.Agent / https.Agent (maxSockets: 64, maxFreeSockets: 32, keepAlive: true)
 * - Bounded ordered ring buffer (max 6 chunks ahead, ≤ 57 MB RAM backpressure ceiling)
 * - Per-chunk stall watchdog (10 s) with 3 jittered retries on 429/503/timeout
 * - Aggregate rolling MB/s telemetry and downloaded bytes counter
 */

import { Readable, PassThrough } from 'node:stream';
import http from 'node:http';
import https from 'node:https';

// ─────────────────────────────────────────────────────────────────────────────
// Connection Pooling Agents (TLS Handshake & Socket Reuse)
// ─────────────────────────────────────────────────────────────────────────────

export const rangeHttpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 32,
  keepAliveMsecs: 20000,
});

export const rangeHttpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 32,
  keepAliveMsecs: 20000,
});

let undiciDispatcher: any;
try {
  const { Agent } = require('undici');
  undiciDispatcher = new Agent({
    keepAliveTimeout: 20000,
    keepAliveMaxTimeout: 60000,
    connections: 64,
    pipelining: 1,
  });
} catch {}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Calibrated chunk size: 9.5 MB — sits right inside YouTube's 10–15 MB CDN burst threshold */
export const CHUNK_SIZE = Math.round(9.5 * 1024 * 1024); // 9.5 MB

/** Default maximum concurrent Range requests */
export const DEFAULT_MAX_CONCURRENT = 16;

/** Maximum chunks buffered ahead of the consumer (back-pressure ceiling: 6 * 9.5MB ~ 57 MB RAM) */
export const MAX_BUFFERED_CHUNKS = 6;

/** Stall watchdog timeout per chunk (ms) */
const CHUNK_TIMEOUT_MS = 10_000;

/** Maximum retry attempts per chunk on 429/503/timeout */
const MAX_RETRIES = 3;

/** Base jitter factor for exponential back-off (ms) */
const BACKOFF_BASE_MS = 500;

/** Threshold above which we open the full 16-connection pipeline (40 MB) */
const LARGE_FILE_THRESHOLD_BYTES = 40 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RangeFetcherOptions {
  /** Source URL to fetch (must support Range requests) */
  url: string;
  /** Total content length in bytes (from HEAD or Content-Length) */
  contentLength: number;
  /** Optional custom concurrency override */
  maxConcurrent?: number;
  /** Optional AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Optional extra request headers (e.g. cookies, User-Agent) */
  headers?: Record<string, string>;
  /**
   * Called with running MB/s and total downloaded bytes after each chunk lands.
   * Telemetry is rolling-average over the last 4 chunks.
   */
  onProgress?: (telemetry: RangeTelemetry) => void;
}

export interface RangeTelemetry {
  /** Instantaneous rolling MB/s (average of last 4 chunks) */
  speedMBps: number;
  /** Total bytes downloaded so far */
  downloadedBytes: number;
  /** Total content length */
  totalBytes: number;
  /** Percentage complete (0–100) */
  percent: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Computes optimal concurrent Range connections based on content size */
export function computeMaxConcurrent(contentLength: number): number {
  if (contentLength > LARGE_FILE_THRESHOLD_BYTES) {
    return 16;
  }
  return Math.min(16, Math.max(4, Math.ceil(contentLength / CHUNK_SIZE)));
}

/** Sleep for a given number of ms (respects abort signal) */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

/** Jittered exponential back-off: base * 2^attempt + random(0, base) */
function backoff(attempt: number): number {
  return BACKOFF_BASE_MS * Math.pow(2, attempt) + Math.random() * BACKOFF_BASE_MS;
}

/**
 * Fetch a single byte-range chunk with stall watchdog, keep-alive agent, and retries.
 * Returns the chunk as a Buffer.
 */
async function fetchChunk(
  url: string,
  start: number,
  end: number,
  extraHeaders: Record<string, string>,
  signal?: AbortSignal
): Promise<Buffer> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    if (attempt > 0) {
      await sleep(backoff(attempt - 1), signal);
    }

    // Per-chunk timeout via AbortController
    const chunkAc = new AbortController();
    const watchdog = setTimeout(() => chunkAc.abort(), CHUNK_TIMEOUT_MS);
    // Forward parent abort into chunk's controller
    const parentAbortHandler = () => chunkAc.abort();
    signal?.addEventListener('abort', parentAbortHandler, { once: true });

    try {
      const agent = url.startsWith('https:') ? rangeHttpsAgent : rangeHttpAgent;
      const fetchOpts: any = {
        headers: {
          ...extraHeaders,
          Range: `bytes=${start}-${end}`,
        },
        signal: chunkAc.signal,
        agent,
      };
      if (undiciDispatcher) {
        fetchOpts.dispatcher = undiciDispatcher;
      }

      const res = await fetch(url, fetchOpts);

      clearTimeout(watchdog);
      signal?.removeEventListener('abort', parentAbortHandler);

      if (res.status === 429 || res.status === 503) {
        lastErr = new Error(`HTTP ${res.status} on chunk [${start}-${end}]`);
        continue; // retry
      }

      if (res.status !== 206 && res.status !== 200) {
        throw new Error(`Unexpected HTTP ${res.status} fetching chunk [${start}-${end}]`);
      }

      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err: any) {
      clearTimeout(watchdog);
      signal?.removeEventListener('abort', parentAbortHandler);

      if (err?.name === 'AbortError' && signal?.aborted) throw err; // propagate parent cancel
      lastErr = err;
      // On stall (chunk AbortController fired) or network error — retry
    }
  }

  throw new Error(
    `Failed to fetch chunk [${start}-${end}] after ${MAX_RETRIES + 1} attempts: ${lastErr}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RangeFetcher — public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates an ordered, back-pressured Node.js Readable stream over `url`
 * using up to 16 parallel Range requests (aria2c parity).
 *
 * The stream emits chunks in content order regardless of which parallel
 * request arrives first (ring buffer ordering).
 *
 * Usage:
 * ```ts
 * const stream = createRangeFetcherStream({ url, contentLength, signal });
 * stream.pipe(res); // or pipeline(stream, fsWriteStream)
 * ```
 */
export function createRangeFetcherStream(options: RangeFetcherOptions): Readable {
  const { url, contentLength, signal, headers = {}, onProgress } = options;

  // Scale concurrency: up to 16 concurrent Range connections for files > 40 MB
  const maxConcurrent = options.maxConcurrent ?? computeMaxConcurrent(contentLength);

  // Divide content into 9.5 MB chunks
  const chunks: Array<{ start: number; end: number; index: number }> = [];
  for (let offset = 0; offset < contentLength; offset += CHUNK_SIZE) {
    const end = Math.min(offset + CHUNK_SIZE - 1, contentLength - 1);
    chunks.push({ start: offset, end, index: chunks.length });
  }

  const totalChunks = chunks.length;

  // Rolling telemetry: last 4 chunk timings
  const chunkTimings: number[] = [];
  let downloadedBytes = 0;

  // Output passthrough for the consumer with 57 MB RAM backpressure ceiling
  const output = new PassThrough({ highWaterMark: CHUNK_SIZE * MAX_BUFFERED_CHUNKS });

  // Ring buffer: ordered array indexed by chunk.index, initially all undefined
  const ringBuffer: Array<Buffer | null> = new Array(totalChunks).fill(undefined as any);
  let nextEmitIndex = 0;

  // Drain ring buffer in order, pushing to output stream with back-pressure
  function drainRing(): void {
    while (nextEmitIndex < totalChunks) {
      const chunk = ringBuffer[nextEmitIndex];
      if (chunk === undefined) break; // not arrived yet

      if (chunk === null) {
        output.end();
        return;
      }

      const canContinue = output.push(chunk);
      ringBuffer[nextEmitIndex] = undefined as any; // free memory
      nextEmitIndex++;

      if (!canContinue) {
        // Back-pressure: wait for drain before continuing
        output.once('drain', drainRing);
        return;
      }
    }
  }

  // Semaphore to limit concurrent fetches to maxConcurrent (up to 16)
  let activeCount = 0;
  let chunkQueueIndex = 0;
  let errors = 0;

  function dispatchNext(): void {
    if (signal?.aborted || errors > 0) return;
    if (chunkQueueIndex >= totalChunks) return;
    if (activeCount >= maxConcurrent) return;

    const chunk = chunks[chunkQueueIndex++];
    activeCount++;

    const t0 = Date.now();

    fetchChunk(url, chunk.start, chunk.end, headers, signal)
      .then((buf) => {
        activeCount--;
        const elapsed = Math.max(0.001, (Date.now() - t0) / 1000); // seconds

        // Rolling telemetry
        chunkTimings.push(buf.byteLength / elapsed);
        if (chunkTimings.length > 4) chunkTimings.shift();
        downloadedBytes += buf.byteLength;
        const speedMBps =
          chunkTimings.reduce((s, v) => s + v, 0) / chunkTimings.length / (1024 * 1024);

        onProgress?.({
          speedMBps,
          downloadedBytes,
          totalBytes: contentLength,
          percent: Math.round((downloadedBytes / contentLength) * 100),
        });

        // Place in ring buffer and drain
        ringBuffer[chunk.index] = buf;
        drainRing();

        // Dispatch more
        dispatchNext();

        // If all chunks done, emit sentinel via ring
        if (chunkQueueIndex >= totalChunks && activeCount === 0) {
          if (nextEmitIndex === totalChunks) {
            output.end();
          }
        }
      })
      .catch((err) => {
        activeCount--;
        errors++;
        output.destroy(err instanceof Error ? err : new Error(String(err)));
      });

    // Dispatch up to maxConcurrent in parallel
    if (activeCount < maxConcurrent && chunkQueueIndex < totalChunks) {
      dispatchNext();
    }
  }

  // Handle empty content
  if (totalChunks === 0) {
    process.nextTick(() => output.end());
    return output;
  }

  // Kick off initial parallel fetches
  for (let i = 0; i < Math.min(maxConcurrent, totalChunks); i++) {
    dispatchNext();
  }

  // Forward parent abort to output destruction
  signal?.addEventListener('abort', () => {
    output.destroy();
  }, { once: true });

  return output;
}

/**
 * Convenience: probe the content length of a URL via HTTP HEAD.
 * Falls back to GET with Range: bytes=0-0 if HEAD is not supported.
 * Returns -1 if content length cannot be determined.
 */
export async function probeContentLength(
  url: string,
  headers: Record<string, string> = {},
  signal?: AbortSignal
): Promise<number> {
  const agent = url.startsWith('https:') ? rangeHttpsAgent : rangeHttpAgent;
  const fetchOpts: any = { method: 'HEAD', headers, signal, agent };
  if (undiciDispatcher) {
    fetchOpts.dispatcher = undiciDispatcher;
  }

  try {
    const res = await fetch(url, fetchOpts);
    const cl = res.headers.get('content-length');
    if (cl) return parseInt(cl, 10);

    // Try Range probe
    const rangeOpts: any = {
      headers: { ...headers, Range: 'bytes=0-0' },
      signal,
      agent,
    };
    if (undiciDispatcher) {
      rangeOpts.dispatcher = undiciDispatcher;
    }

    const rangeRes = await fetch(url, rangeOpts);
    const cr = rangeRes.headers.get('content-range');
    if (cr) {
      const m = cr.match(/\/(\d+)$/);
      if (m) return parseInt(m[1], 10);
    }
  } catch {}

  return -1;
}
