/**
 * MUXARO Tier 0 Zero-Hop Pass-Through
 *
 * For progressive MP4 / direct audio streams that need no conversion,
 * pipes upstream bytes straight to the HTTP response with:
 * - Content-Disposition: attachment (or inline)
 * - Content-Type (inferred from filename or explicit)
 * - Content-Length (when known)
 * - Content-Range (for RFC 9110 Range 206 responses)
 * - Accept-Ranges: bytes
 * - X-Content-Type-Options: nosniff
 *
 * Uses stream.pipeline() for automatic, guaranteed cleanup on client disconnect,
 * pipe errors, and AbortSignal cancellation.
 */

import { Readable, pipeline as nodePipeline } from 'node:stream';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { formatContentDisposition } from '../security-validator.ts';

const streamPipeline = promisify(nodePipeline);

// ─────────────────────────────────────────────────────────────────────────────
// MIME map
// ─────────────────────────────────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  mp4:  'video/mp4',
  webm: 'video/webm',
  mkv:  'video/x-matroska',
  mov:  'video/quicktime',
  mp3:  'audio/mpeg',
  m4a:  'audio/mp4',
  opus: 'audio/opus',
  flac: 'audio/flac',
  wav:  'audio/wav',
  aac:  'audio/aac',
  ogg:  'audio/ogg',
};

export function inferMime(filename: string): string {
  const ext = path.extname(filename).replace('.', '').toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

// ─────────────────────────────────────────────────────────────────────────────
// Options
// ─────────────────────────────────────────────────────────────────────────────

export interface Tier0PassthroughOptions {
  /**
   * Source: either a file path (string), a Node.js Readable stream, or a Web ReadableStream.
   * When a file path is provided, an `fs.createReadStream` is opened automatically.
   */
  source: string | Readable | ReadableStream;
  /** Suggested download filename (used for Content-Disposition and MIME inference) */
  filename: string;
  /**
   * Total byte length of the content (or chunk length for 206).
   * Required for `Content-Length` header; pass 0 or omit to skip the header.
   */
  contentLength?: number;
  /**
   * Optional HTTP byte range for file sources { start, end }
   */
  range?: { start: number; end: number };
  /**
   * Optional Content-Range header value for 206 responses (e.g. 'bytes 0-1023/2048')
   */
  contentRange?: string;
  /**
   * Explicit MIME content type override (if omitted, inferred from filename)
   */
  contentType?: string;
  /**
   * HTTP status code (defaults to 206 if contentRange or range is provided, otherwise 200)
   */
  status?: number;
  /**
   * Optional AbortSignal — when signalled the upstream is destroyed immediately,
   * freeing the upstream socket and stopping file I/O.
   */
  signal?: AbortSignal;
  /**
   * Pass `'inline'` to use `Content-Disposition: inline` (browser preview).
   * Default is `'attachment'` (force download).
   */
  disposition?: 'attachment' | 'inline';
}

export interface Tier0Response {
  /** HTTP status (200 or 206) */
  status: number;
  headers: Record<string, string>;
  /** Node.js Readable that the caller should pipe to the HTTP response body */
  body: Readable;
  /**
   * Call `cleanup()` if the stream was not fully consumed.
   * Safe to call multiple times.
   */
  cleanup: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// createTier0Passthrough — synchronous setup, returns a ready-to-send response
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Synchronously wires a Tier 0 pass-through response object.
 *
 * The caller is responsible for piping `response.body` to the HTTP response.
 * For Next.js Route Handlers, use `streamTier0ToResponse()` instead.
 */
export function createTier0Passthrough(opts: Tier0PassthroughOptions): Tier0Response {
  const { source, filename, contentLength = 0, signal, disposition = 'attachment' } = opts;

  // Open source stream
  let readable: Readable;
  if (typeof source === 'string') {
    readable = opts.range
      ? fs.createReadStream(source, { start: opts.range.start, end: opts.range.end })
      : fs.createReadStream(source);
  } else if (source instanceof Readable) {
    readable = source;
  } else if (typeof (Readable as any).fromWeb === 'function') {
    readable = (Readable as any).fromWeb(source);
  } else {
    readable = Readable.from(source as any);
  }

  // Wire abort signal → immediate stream destruction
  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    if (!readable.destroyed) readable.destroy();
  }

  if (signal) {
    if (signal.aborted) {
      process.nextTick(cleanup);
    } else {
      signal.addEventListener('abort', cleanup, { once: true });
    }
  }

  readable.once('close', () => {
    signal?.removeEventListener('abort', cleanup);
  });

  // Determine status code
  const status = opts.status ?? (opts.contentRange || opts.range ? 206 : 200);

  // Build headers
  const mimeType = opts.contentType || inferMime(filename);
  const dispositionHeader =
    disposition === 'inline'
      ? `inline; filename="${filename}"`
      : formatContentDisposition(filename);

  const headers: Record<string, string> = {
    'Content-Type': mimeType,
    'Content-Disposition': dispositionHeader,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=3600',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type, Authorization, If-Range, X-Requested-With',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, ETag, Content-Disposition',
  };

  if (contentLength > 0) {
    headers['Content-Length'] = String(contentLength);
  }

  if (opts.contentRange) {
    headers['Content-Range'] = opts.contentRange;
  }

  return {
    status,
    headers,
    body: readable,
    cleanup,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// streamTier0ToResponse — Next.js / Web Streams API adapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a Web `Response` object (compatible with Next.js Route Handlers)
 * that streams the source directly to the client using Tier 0 pass-through.
 *
 * Supports:
 * - Direct HTTP remote streams (Web ReadableStream or Node Readable)
 * - Local filesystem paths
 * - RFC 9110 Range 206 responses
 * - Automatic socket cleanup on client disconnect (via req.signal)
 */
export function streamTier0ToResponse(opts: Tier0PassthroughOptions): Response {
  const t0 = createTier0Passthrough(opts);

  // Convert Node.js Readable → Web ReadableStream
  let webStream: ReadableStream<Uint8Array>;

  if (typeof (Readable as any).toWeb === 'function') {
    webStream = (Readable as any).toWeb(t0.body) as ReadableStream<Uint8Array>;
  } else {
    // Manual shim for environments without Readable.toWeb
    webStream = new ReadableStream<Uint8Array>({
      start(controller) {
        t0.body.on('data', (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk));
        });
        t0.body.on('end', () => controller.close());
        t0.body.on('error', (err) => controller.error(err));
      },
      cancel() {
        t0.cleanup();
      },
    });
  }

  return new Response(webStream, {
    status: t0.status,
    headers: t0.headers,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// pipeNodeToNodeResponse — raw Node.js http.ServerResponse helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full pipeline from source to a Node.js `http.ServerResponse`.
 * Writes headers, then awaits completion or throws on error.
 * Guarantees upstream cleanup via stream.pipeline().
 */
export async function pipeNodeToNodeResponse(
  res: { writeHead(status: number, headers: Record<string, string>): void; end(): void },
  opts: Tier0PassthroughOptions
): Promise<void> {
  const t0 = createTier0Passthrough(opts);

  (res as any).writeHead(t0.status, t0.headers);

  try {
    await streamPipeline(t0.body, res as any);
  } catch (err: any) {
    if (err?.code !== 'ERR_STREAM_DESTROYED' && err?.code !== 'ECONNRESET') {
      throw err;
    }
  } finally {
    t0.cleanup();
  }
}
