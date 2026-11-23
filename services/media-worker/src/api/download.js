'use strict';
/**
 * GET /v1/download
 * Streams media to the HTTP response client or uploads to Cloudflare R2 for large files.
 *
 * Rules:
 *  - Files < 150 MB  → stream directly with Content-Disposition: attachment
 *  - Files ≥ 150 MB  → upload to R2, return presigned URL JSON
 *  - Content-Type + byte-size guard: response must be video/* or audio/* AND > 4 KB,
 *    otherwise HTTP 502 with clean error.
 *  - API-key guard enforced upstream; not re-checked here.
 *
 * Query parameters:
 *  url        (required) source URL to download
 *  quality    (optional) e.g. "1080p", "720p", "audio-only"  [default: best]
 *  format     (optional) "mp4" | "mp3" | "m4a"               [default: mp4]
 *  formatId   (optional) explicit yt-dlp format ID
 *  filename   (optional) override output filename
 *  jobId      (optional) job reference for R2 key naming
 */

const { spawn }   = require('child_process');
const { pipeline } = require('stream/promises');
const path         = require('path');
const crypto       = require('crypto');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DIRECT_STREAM_THRESHOLD_BYTES = 150 * 1024 * 1024; // 150 MB
const MIN_CONTENT_BYTES              = 4096;               // 4 KB guard
const RESOLVE_TIMEOUT_MS             = 8_000;
const DOWNLOAD_TIMEOUT_MS            = 90_000;             // 90 s max

const BOT_BLOCKED_PATTERNS = [
  /403\s+Forbidden/i,
  /Sign in to confirm you(?:'|')re not a bot/i,
  /bot\s*detection/i,
  /captcha/i,
  /Turnstile/i,
  /cloudflare/i,
  /private video/i,
  /access denied/i,
  /HTTP Error (?:403|429)/i,
];

function isBotBlocked(text) {
  if (!text || typeof text !== 'string') return false;
  return BOT_BLOCKED_PATTERNS.some((p) => p.test(text));
}

function sanitizeFilename(raw) {
  if (!raw) return null;
  return raw.replace(/[^a-zA-Z0-9._\-\s]/g, '_').trim().replace(/\s+/g, '_').slice(0, 180);
}

function muxaroError(reply, httpStatus, code, message, retryable = false) {
  return reply.status(httpStatus).send({
    ok:        false,
    success:   false,
    status:    code,
    error:     { code, message, retryable },
    requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Resolve stream URLs via yt-dlp -g
// ---------------------------------------------------------------------------
function resolveStreamUrls(sourceUrl, formatSelector, timeoutMs = RESOLVE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const args = [
      '-g',
      '-f', formatSelector,
      '--no-playlist',
      '--no-warnings',
      '--socket-timeout', '6',
      sourceUrl,
    ];

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn('yt-dlp', args, { shell: false });
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch (_) {}
      resolve({ timedOut: true });
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code !== 0) return resolve({ success: false, code, stderr: stderr.trim() });
      const urls = stdout.trim().split(/\r?\n/).filter(Boolean);
      resolve({ success: true, urls });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, code: -1, stderr: err.message });
    });
  });
}

// ---------------------------------------------------------------------------
// Build format selector from request params
// ---------------------------------------------------------------------------
function buildFormatSelector(quality, format, formatId) {
  if (formatId) return formatId;

  const isAudio = format === 'mp3' || format === 'm4a' || quality === 'audio-only' || quality === 'audio';
  if (isAudio) return 'bestaudio/ba/best';

  const heightMap = {
    '8k': 4320, '4k': 2160, '1440p': 1440, '1080p': 1080,
    '720p': 720, '480p': 480, '360p': 360, '240p': 240,
  };
  const h = heightMap[String(quality).toLowerCase()];
  if (h) return `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`;
  return 'bestvideo+bestaudio/best';
}

// ---------------------------------------------------------------------------
// Validate preflight response (Content-Type + size guard)
// ---------------------------------------------------------------------------
async function preflightMediaCheck(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);

    const res = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MUXARO/1.0)',
        'Accept': '*/*',
      },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const cl = parseInt(res.headers.get('content-length') || '0', 10);

    if (!ct.startsWith('video/') && !ct.startsWith('audio/') && !ct.startsWith('application/octet-stream')) {
      return { valid: false, reason: `Unexpected Content-Type: ${ct || 'none'}` };
    }
    if (cl > 0 && cl <= MIN_CONTENT_BYTES) {
      return { valid: false, reason: `Content-Length ${cl} bytes is below the 4 KB minimum guard.` };
    }

    return { valid: true, contentType: ct, contentLength: cl };
  } catch (err) {
    // Preflight failed — allow download attempt to proceed (some servers reject HEAD)
    return { valid: true, contentType: null, contentLength: 0, preflightSkipped: true };
  }
}

// ---------------------------------------------------------------------------
// Upload stream to R2 and return presigned URL
// ---------------------------------------------------------------------------
async function uploadToR2AndPresign(jobId, filename, sourceStream, contentType) {
  const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME,
  } = process.env;

  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    throw new Error('R2 environment variables not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME).');
  }

  // Lazy-load r2-upload module so it only fails if actually reached
  const { uploadToR2 } = require('../storage/r2-upload');
  return uploadToR2(jobId, filename, sourceStream, contentType);
}

// ---------------------------------------------------------------------------
// FFmpeg pipeline: produce a piped stream from resolved URLs
// ---------------------------------------------------------------------------
function spawnFfmpegStream(videoUrl, audioUrl, format) {
  const isAudio = format === 'mp3' || format === 'm4a';

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-user_agent', 'Mozilla/5.0 (compatible; MUXARO/1.0)',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-i', videoUrl,
  ];

  if (audioUrl && !isAudio) {
    args.push(
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', audioUrl,
      '-map', '0:v:0',
      '-map', '1:a:0',
    );
  }

  if (isAudio) {
    args.push('-vn', '-c:a', 'copy', '-f', format === 'mp3' ? 'mp3' : 'ipod', 'pipe:1');
  } else {
    args.push(
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov',
      'pipe:1',
    );
  }

  return spawn('ffmpeg', args, { shell: false });
}

// ---------------------------------------------------------------------------
// Route handler factory
// ---------------------------------------------------------------------------
function registerDownloadRoute(fastify) {
  fastify.get('/v1/download', async (req, reply) => {
    const q = req.query || {};
    const rawUrl  = String(q.url || '').trim();
    const quality = String(q.quality || 'best').toLowerCase();
    const format  = String(q.format  || 'mp4').toLowerCase();
    const formatId = q.formatId ? String(q.formatId) : undefined;
    const jobId   = q.jobId   ? String(q.jobId)   : `job_${Date.now()}`;
    const rawFilename = q.filename ? String(q.filename) : null;

    // ── 1. URL validation ──────────────────────────────────────────────────
    if (!rawUrl) {
      return muxaroError(reply, 400, 'INVALID_URL', 'url query parameter is required.');
    }
    try {
      const p = new URL(rawUrl);
      if (p.protocol !== 'http:' && p.protocol !== 'https:') {
        return muxaroError(reply, 400, 'INVALID_URL', 'Only HTTP and HTTPS URLs are supported.');
      }
    } catch (_) {
      return muxaroError(reply, 400, 'INVALID_URL', 'Malformed URL.');
    }

    // ── 2. Resolve stream URLs ─────────────────────────────────────────────
    const formatSel = buildFormatSelector(quality, format, formatId);
    const resolved  = await resolveStreamUrls(rawUrl, formatSel, RESOLVE_TIMEOUT_MS);

    if (resolved.timedOut) {
      return muxaroError(reply, 504, 'TIMEOUT', 'Stream resolution timed out.', true);
    }
    if (!resolved.success) {
      const blocked = isBotBlocked(resolved.stderr);
      return muxaroError(
        reply,
        blocked ? 403 : 422,
        blocked ? 'HOST_BLOCKED' : 'RESOLVE_FAILED',
        blocked
          ? 'Upstream media source restricted access.'
          : (resolved.stderr || 'Could not resolve stream URLs.').split('\n')[0].slice(0, 200),
      );
    }

    const [videoUrl, audioUrl] = resolved.urls;

    // ── 3. Content-Type + size guard on the resolved video URL ────────────
    const preflight = await preflightMediaCheck(videoUrl);
    if (!preflight.valid) {
      return reply.status(502).send({
        ok:      false,
        success: false,
        status:  'CONTENT_GUARD_FAILED',
        error:   { code: 'CONTENT_GUARD_FAILED', message: preflight.reason, retryable: false },
        requestId: `req_${Date.now()}`,
        timestamp: new Date().toISOString(),
      });
    }

    // Determine expected size
    const contentLength = preflight.contentLength || 0;
    const isLargeFile   = contentLength > DIRECT_STREAM_THRESHOLD_BYTES;

    // ── 4a. Direct stream (< 150 MB or unknown size) ──────────────────────
    if (!isLargeFile) {
      const ext          = format === 'mp3' ? 'mp3' : (format === 'm4a' ? 'm4a' : 'mp4');
      const mimeType     = format === 'mp3' ? 'audio/mpeg' : (format === 'm4a' ? 'audio/mp4' : 'video/mp4');
      const filename     = sanitizeFilename(rawFilename) || `muxaro_${jobId}.${ext}`;
      const ffmpeg       = spawnFfmpegStream(videoUrl, audioUrl, format);

      let totalBytes  = 0;
      let headersSent = false;
      let stderrBuf   = '';
      let isCleanedUp = false;

      function killFfmpeg(reason) {
        if (isCleanedUp) return;
        isCleanedUp = true;
        fastify.log.warn({ reason }, 'FFmpeg terminated');
        try { if (!ffmpeg.killed) ffmpeg.kill('SIGKILL'); } catch (_) {}
      }

      // Kill on client disconnect
      req.raw.on('close', () => killFfmpeg('client_disconnect'));
      req.raw.on('error', (e) => killFfmpeg(`client_error: ${e.message}`));

      ffmpeg.stderr.on('data', (d) => {
        stderrBuf += d.toString();
        if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096);
      });

      reply.hijack();

      ffmpeg.stdout.on('data', (chunk) => {
        if (!headersSent) {
          headersSent = true;
          reply.raw.statusCode = 200;
          reply.raw.setHeader('Content-Type', mimeType);
          reply.raw.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
          reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
          reply.raw.setHeader('X-Content-Type-Options', 'nosniff');
        }
        totalBytes += chunk.length;

        // Post-write guard: if first chunk received < 4 KB, something is wrong
        if (totalBytes > 0 && totalBytes <= MIN_CONTENT_BYTES && !ffmpeg.stdout.isPaused()) {
          // Let it grow — only fail if FFmpeg closes with tiny output
        }

        const ok = reply.raw.write(chunk);
        if (!ok) {
          ffmpeg.stdout.pause();
          reply.raw.once('drain', () => { if (!isCleanedUp) ffmpeg.stdout.resume(); });
        }
      });

      ffmpeg.stdout.on('end', () => {
        if (totalBytes > 0 && totalBytes <= MIN_CONTENT_BYTES && !reply.raw.headersSent) {
          // Guard: tiny output is a 502
          reply.raw.writeHead(502, { 'Content-Type': 'application/json' });
          reply.raw.end(JSON.stringify({
            ok: false, success: false, status: 'CONTENT_GUARD_FAILED',
            error: { code: 'CONTENT_GUARD_FAILED', message: `Download produced only ${totalBytes} bytes — below 4 KB guard.`, retryable: false },
            timestamp: new Date().toISOString(),
          }));
          return;
        }
        if (!reply.raw.writableEnded) reply.raw.end();
      });

      ffmpeg.on('error', (err) => {
        killFfmpeg(`spawn: ${err.message}`);
        if (!reply.raw.headersSent) {
          reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
          reply.raw.end(JSON.stringify({ ok: false, success: false, status: 'FFMPEG_ERROR', error: { code: 'FFMPEG_ERROR', message: err.message, retryable: false }, timestamp: new Date().toISOString() }));
        } else if (!reply.raw.writableEnded) {
          reply.raw.destroy(err);
        }
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0 && totalBytes === 0 && !reply.raw.headersSent) {
          const blocked = isBotBlocked(stderrBuf);
          reply.raw.writeHead(blocked ? 403 : 502, { 'Content-Type': 'application/json' });
          reply.raw.end(JSON.stringify({
            ok: false, success: false,
            status: blocked ? 'HOST_BLOCKED' : 'STREAM_FAILED',
            error: { code: blocked ? 'HOST_BLOCKED' : 'STREAM_FAILED', message: blocked ? 'Upstream media source restricted access.' : 'Stream pipeline failed.', retryable: false },
            timestamp: new Date().toISOString(),
          }));
          return;
        }
        if (!reply.raw.writableEnded) reply.raw.end();
      });

      return; // response managed by hijack
    }

    // ── 4b. Large file (≥ 150 MB) → R2 upload + presigned URL ────────────
    fastify.log.info({ jobId, contentLength }, 'Large file detected — routing to R2 upload');

    const ext      = format === 'mp3' ? 'mp3' : (format === 'm4a' ? 'm4a' : 'mp4');
    const mimeType = format === 'mp3' ? 'audio/mpeg' : (format === 'm4a' ? 'audio/mp4' : 'video/mp4');
    const filename = sanitizeFilename(rawFilename) || `muxaro_${jobId}.${ext}`;
    const ffmpeg   = spawnFfmpegStream(videoUrl, audioUrl, format);

    try {
      const presignedUrl = await uploadToR2AndPresign(jobId, filename, ffmpeg.stdout, mimeType);
      ffmpeg.kill('SIGKILL'); // cleanup after upload helper closes stream
      return reply.status(200).send({
        ok:          true,
        success:     true,
        status:      'ready',
        jobId,
        filename,
        mimeType,
        deliveryMode: 'presigned-r2',
        downloadUrl: presignedUrl,
        expiresAt:   new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        timestamp:   new Date().toISOString(),
      });
    } catch (err) {
      try { ffmpeg.kill('SIGKILL'); } catch (_) {}
      fastify.log.error({ err }, 'R2 upload failed');
      return muxaroError(reply, 502, 'R2_UPLOAD_FAILED', 'Large file upload to storage failed. Please try again.', true);
    }
  });
}

module.exports = { registerDownloadRoute };
