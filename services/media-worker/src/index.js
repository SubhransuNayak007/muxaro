const Fastify = require('fastify');
const { spawn } = require('child_process');
const path = require('path');

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

// Environment Configuration
const PORT = parseInt(process.env.PORT || '5001', 10);
const HOST = process.env.HOST || '0.0.0.0';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '500', 10);
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const PROBE_TIMEOUT_MS = 8000; // Strict 8-second timeout

// Global CORS & pre-flight hook
fastify.addHook('onRequest', async (req, reply) => {
  reply.header('Access-Control-Allow-Origin', ALLOWED_ORIGINS);
  reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
  reply.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') {
    return reply.status(204).send();
  }
});

// Bot-detection and access restricted pattern matching
const BOT_BLOCKED_PATTERNS = [
  /403\s+Forbidden/i,
  /429\s+Too\s+Many\s+Requests/i,
  /Sign in to confirm you(?:’|')re not a bot/i,
  /bot\s*detection/i,
  /captcha/i,
  /Turnstile/i,
  /cloudflare/i,
  /login required/i,
  /confirm your age/i,
  /private video/i,
  /access denied/i,
  /blocked/i,
  /HTTP Error (?:403|429)/i,
];

function isBotBlockedError(text) {
  if (!text || typeof text !== 'string') return false;
  return BOT_BLOCKED_PATTERNS.some((pattern) => pattern.test(text));
}

function isDirectStreamUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const pathname = parsed.pathname.toLowerCase();
    if (/\.(mp4|m3u8|webm|ts|mkv|mov|m4a|mp3|aac)($|\?)/i.test(pathname) ||
        /\.(mp4|m3u8|webm|ts|mkv|mov|m4a|mp3|aac)($|\?)/i.test(rawUrl)) {
      return true;
    }
    const host = parsed.hostname.toLowerCase();
    if (host.includes('googlevideo.com') ||
        host.includes('akamaized.net') ||
        host.includes('cloudfront.net') ||
        host.includes('fastly.net')) {
      return true;
    }
  } catch {
    // Malformed URL
  }
  return false;
}

// ----------------------------------------------------------------------------
// Fast pre-flight check using native fetch (< 2.0s timeout)
// ----------------------------------------------------------------------------
async function preflightBotCheck(targetUrl) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);

    const res = await fetch(targetUrl, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
      },
      signal: controller.signal,
      redirect: 'follow',
    }).catch(async (err) => {
      if (err.name === 'AbortError') throw err;
      // Fallback: try GET with Range 0-0 in case server rejects HEAD with 405
      return fetch(targetUrl, {
        method: 'GET',
        headers: {
          'Range': 'bytes=0-0',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
        },
        signal: controller.signal,
      });
    });

    clearTimeout(timer);

    if (res.status === 403 || res.status === 429) {
      return { blocked: true, status: res.status, reason: `HTTP ${res.status}` };
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const cfMitigated = res.headers.get('cf-mitigated');
    if (cfMitigated || (contentType.includes('html') && res.status >= 400)) {
      return { blocked: true, status: 403, reason: 'Cloudflare bot mitigation' };
    }

    return {
      blocked: false,
      contentType,
      contentLength: res.headers.get('content-length'),
      status: res.status,
    };
  } catch (err) {
    return { blocked: false, error: err.message };
  }
}

// ----------------------------------------------------------------------------
// FFprobe Inspector (Fast fallback for direct media files and playlists)
// ----------------------------------------------------------------------------
function probeWithFFprobe(targetUrl, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      targetUrl,
    ];

    let stdout = '';
    let killed = false;

    const child = spawn('ffprobe', args, { shell: false });
    const timer = setTimeout(() => {
      killed = true;
      try { child.kill('SIGKILL'); } catch (_) {}
      resolve(null);
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed || code !== 0) return resolve(null);
      try {
        const json = JSON.parse(stdout);
        resolve(json);
      } catch (_) {
        resolve(null);
      }
    });

    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

function transformFFprobeData(ffprobeData, targetUrl) {
  const format = ffprobeData.format || {};
  const streams = Array.isArray(ffprobeData.streams) ? ffprobeData.streams : [];
  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');

  const rawHeight = videoStream?.height || 0;
  const rawWidth = videoStream?.width || 0;
  // Cap at 2K / 1440p
  const height = rawHeight > 1440 ? 1440 : rawHeight;
  const width = rawWidth > 2560 ? 2560 : rawWidth;

  let fps = 30;
  if (videoStream?.r_frame_rate) {
    const parts = videoStream.r_frame_rate.split('/').map(Number);
    if (parts.length === 2 && parts[1] > 0) {
      fps = Math.round(parts[0] / parts[1]) || 30;
    }
  }

  const duration = Math.round(parseFloat(format.duration || '0'));
  const size = parseInt(format.size || '0', 10);
  const formats = [];

  if (videoStream) {
    formats.push({
      formatId: 'direct-video',
      ext: 'mp4',
      resolution: height >= 1440 ? '1440p' : (height ? `${height}p` : '720p'),
      width,
      height,
      fps,
      vcodec: videoStream.codec_name || 'h264',
      acodec: audioStream?.codec_name || 'aac',
      filesize: size || undefined,
      url: targetUrl,
      hasVideo: true,
      hasAudio: Boolean(audioStream),
      isStreamCopyCandidate: true,
    });
  }

  if (audioStream && !videoStream) {
    formats.push({
      formatId: 'direct-audio',
      ext: audioStream.codec_name || 'aac',
      acodec: audioStream.codec_name || 'aac',
      filesize: size || undefined,
      url: targetUrl,
      hasVideo: false,
      hasAudio: true,
      isStreamCopyCandidate: true,
    });
  }

  return {
    ok: true,
    id: `direct_${Date.now()}`,
    title: format.tags?.title || path.basename(new URL(targetUrl).pathname) || 'Direct Media Stream',
    duration,
    thumbnail: undefined,
    formats,
    videoFormats: formats.filter((f) => f.hasVideo),
    audioFormats: formats.filter((f) => f.hasAudio && !f.hasVideo),
  };
}

// ----------------------------------------------------------------------------
// yt-dlp Native Metadata Probe (Strict 8-second timeout)
// ----------------------------------------------------------------------------
function probeWithYtdlp(targetUrl, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const args = [
      '-J',
      '--no-playlist',
      '--no-warnings',
      '--socket-timeout', '5',
      '--max-downloads', '1',
      targetUrl,
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
      if (timedOut) return resolve({ timedOut: true });

      if (code !== 0) {
        return resolve({
          success: false,
          code,
          stderr: stderr.trim(),
          isBlocked: isBotBlockedError(stderr),
        });
      }

      try {
        const json = JSON.parse(stdout);
        resolve({ success: true, data: json });
      } catch (err) {
        resolve({ success: false, code: -1, stderr: err.message, isBlocked: false });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, code: -1, stderr: err.message, isBlocked: false });
    });
  });
}

function normalizeAndFilterFormats(rawFormats) {
  if (!Array.isArray(rawFormats)) return [];
  return rawFormats
    .filter((f) => {
      // Requirement: formats capped up to 2K (1440p)
      if (typeof f.height === 'number' && f.height > 1440) return false;
      if (!f.height && typeof f.width === 'number' && f.width > 2560) return false;
      return true;
    })
    .map((f) => {
      const hasVideo = Boolean(f.vcodec && f.vcodec !== 'none');
      const hasAudio = Boolean(f.acodec && f.acodec !== 'none');
      const height = typeof f.height === 'number' ? f.height : 0;
      let resolution = f.resolution;
      if (!resolution && height) {
        resolution = height >= 1440 ? '1440p' : `${height}p`;
      }
      return {
        formatId: String(f.format_id || ''),
        ext: f.ext || 'mp4',
        resolution,
        width: f.width,
        height: f.height,
        fps: f.fps || 30,
        vcodec: f.vcodec,
        acodec: f.acodec,
        filesize: f.filesize || f.filesize_approx,
        bitrate: f.tbr ? Math.round(f.tbr * 1000) : (f.vbr ? Math.round(f.vbr * 1000) : undefined),
        url: f.url,
        hasVideo,
        hasAudio,
        isStreamCopyCandidate: true,
      };
    });
}

// ----------------------------------------------------------------------------
// Resolve direct stream URLs via yt-dlp -g
// ----------------------------------------------------------------------------
function resolveStreamUrlsWithYtdlp(targetUrl, targetQuality = '1440p', timeoutMs = 5000) {
  return new Promise((resolve) => {
    let formatSelector = 'bestvideo[height<=1440]+bestaudio/best[height<=1440]/best';
    if (targetQuality === 'audio-only' || targetQuality === 'audio') {
      formatSelector = 'bestaudio/ba';
    } else if (targetQuality === '720p') {
      formatSelector = 'bestvideo[height<=720]+bestaudio/best[height<=720]/best';
    } else if (targetQuality === '1080p') {
      formatSelector = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
    }

    const args = [
      '-g',
      '-f', formatSelector,
      '--no-playlist',
      '--no-warnings',
      '--socket-timeout', '4',
      targetUrl,
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
      if (timedOut) return resolve({ timedOut: true });
      if (code !== 0) {
        return resolve({
          success: false,
          code,
          stderr: stderr.trim(),
          isBlocked: isBotBlockedError(stderr),
        });
      }
      const urls = stdout.trim().split(/\r?\n/).filter(Boolean);
      resolve({ success: true, urls });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, code: -1, stderr: err.message, isBlocked: false });
    });
  });
}

// ============================================================================
// ROUTES
// ============================================================================

// 1. Healthcheck: GET /health
fastify.get('/health', async () => ({
  status: 'ok',
  worker: 'muxaro-media-worker',
  timestamp: new Date().toISOString(),
  maxFileSizeMb: MAX_FILE_SIZE_MB,
  version: '1.2.0',
}));

fastify.get('/', async () => ({
  service: 'MUXARO Dedicated Media Worker',
  status: 'online',
  endpoints: {
    health: 'GET /health',
    probe: 'POST /probe',
    stream: 'GET /stream?url=<target_url>&format=mp4&quality=1440p',
  },
}));

// 2. Core Probe Implementation: POST /probe
async function handleProbe(req, reply) {
  const body = req.body || {};
  const query = req.query || {};
  const rawUrl = String(body.url || body.mediaUrl || query.url || query.mediaUrl || '').trim();

  if (!rawUrl) {
    return reply.status(400).send({
      ok: false,
      code: 'INVALID_URL',
      message: 'Valid media URL is required in request body or query parameter.',
    });
  }

  // Ensure valid URL protocol
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return reply.status(400).send({
        ok: false,
        code: 'INVALID_URL',
        message: 'Only HTTP and HTTPS URLs are supported.',
      });
    }
  } catch {
    return reply.status(400).send({
      ok: false,
      code: 'INVALID_URL',
      message: 'Malformed URL provided.',
    });
  }

  // Step A: Fast pre-flight bot check (< 2 seconds timeout)
  const preflight = await preflightBotCheck(rawUrl);
  if (preflight.blocked) {
    fastify.log.warn({ url: rawUrl, reason: preflight.reason }, 'Bot detection triggered in preflight');
    return reply.status(403).send({
      ok: false,
      code: 'HOST_BLOCKED',
      status: 403,
      message: 'Host blocked by bot-detection or access forbidden',
    });
  }

  // Step B: Direct stream shortcut via FFprobe if URL looks direct or preflight returned media type
  const isDirect = isDirectStreamUrl(rawUrl) || (preflight.contentType && preflight.contentType.startsWith('video/'));
  if (isDirect) {
    const ffprobeData = await probeWithFFprobe(rawUrl, 2500);
    if (ffprobeData && ffprobeData.streams && ffprobeData.streams.length > 0) {
      const result = transformFFprobeData(ffprobeData, rawUrl);
      return reply.status(200).send(result);
    }
  }

  // Step C: Full probe via yt-dlp with strict 8-second timeout
  const ytdlpResult = await probeWithYtdlp(rawUrl, PROBE_TIMEOUT_MS);

  if (ytdlpResult.timedOut) {
    return reply.status(504).send({
      ok: false,
      code: 'TIMEOUT',
      status: 504,
      message: 'Probe operation timed out after 8 seconds.',
    });
  }

  if (ytdlpResult.isBlocked) {
    return reply.status(403).send({
      ok: false,
      code: 'HOST_BLOCKED',
      status: 403,
      rawMessage: ytdlpResult.stderr,
    });
  }

  if (!ytdlpResult.success) {
    // Attempt FFprobe fallback once more
    const ffprobeFallback = await probeWithFFprobe(rawUrl, 2500);
    if (ffprobeFallback && ffprobeFallback.streams && ffprobeFallback.streams.length > 0) {
      return reply.status(200).send(transformFFprobeData(ffprobeFallback, rawUrl));
    }

    return reply.status(422).send({
      ok: false,
      code: 'PROBE_FAILED',
      message: ytdlpResult.stderr || 'Could not probe media stream.',
    });
  }

  // Parse & filter formats capped at 2K (1440p)
  const info = ytdlpResult.data;
  const formats = normalizeAndFilterFormats(info.formats);
  const videoFormats = formats.filter((f) => f.hasVideo);
  const audioFormats = formats.filter((f) => f.hasAudio && !f.hasVideo);

  return reply.status(200).send({
    ok: true,
    id: info.id || `media_${Date.now()}`,
    title: info.title || 'Media',
    duration: info.duration || 0,
    thumbnail: info.thumbnail || (info.thumbnails && info.thumbnails.length ? info.thumbnails[info.thumbnails.length - 1].url : undefined),
    formats,
    videoFormats,
    audioFormats,
  });
}

fastify.post('/probe', handleProbe);
fastify.get('/probe', handleProbe);
fastify.post('/api/probe', handleProbe);
fastify.get('/api/probe', handleProbe);

// ----------------------------------------------------------------------------
// 3. Core Zero-Disk Stream Pipeline: GET /stream
// ----------------------------------------------------------------------------
async function handleStream(req, reply) {
  const query = req.query || {};
  const rawUrl = String(query.url || query.mediaUrl || '').trim();

  if (!rawUrl) {
    return reply.status(400).send({
      ok: false,
      code: 'INVALID_URL',
      message: 'url query parameter is required.',
    });
  }

  // Quality cap: strictly capped at 2K / 1440p
  let quality = String(query.quality || '1440p').toLowerCase();
  if (/4k|8k|2160|4320/i.test(quality)) {
    quality = '1440p';
  }

  const format = String(query.format || 'mp4').toLowerCase();
  const safeFilename = query.filename
    ? String(query.filename).replace(/[^a-zA-Z0-9._-]/g, '_')
    : `muxaro_${Date.now()}.${format === 'mp3' ? 'mp3' : 'mp4'}`;

  // Determine media input stream URLs
  let inputUrls = [];
  if (isDirectStreamUrl(rawUrl)) {
    inputUrls = [rawUrl];
  } else {
    // Resolve upstream stream URLs via yt-dlp -g
    const resolution = await resolveStreamUrlsWithYtdlp(rawUrl, quality, 6000);
    if (resolution.timedOut) {
      return reply.status(504).send({
        ok: false,
        code: 'TIMEOUT',
        message: 'Resolving stream URLs timed out.',
      });
    }
    if (resolution.isBlocked) {
      return reply.status(403).send({
        ok: false,
        code: 'HOST_BLOCKED',
        status: 403,
        rawMessage: resolution.stderr,
      });
    }
    if (resolution.success && resolution.urls && resolution.urls.length > 0) {
      inputUrls = resolution.urls;
    } else {
      // Direct fallback to rawUrl
      inputUrls = [rawUrl];
    }
  }

  // Construct FFmpeg command arguments:
  // -c:v copy -c:a copy -f mp4 -movflags frag_keyframe+empty_moov pipe:1
  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel', 'error',
    '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ];

  // Add inputs with reconnection options for network resilience
  for (const streamUrl of inputUrls) {
    ffmpegArgs.push(
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', streamUrl
    );
  }

  // If two inputs (separate video & audio streams from DASH)
  if (inputUrls.length === 2) {
    ffmpegArgs.push(
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov',
      'pipe:1'
    );
  } else if (format === 'mp3' || quality === 'audio-only' || quality === 'audio') {
    ffmpegArgs.push(
      '-vn',
      '-c:a', 'copy',
      '-f', 'mp3',
      'pipe:1'
    );
  } else {
    // Single video/audio multiplex or direct MP4/HLS
    ffmpegArgs.push(
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov',
      'pipe:1'
    );
  }

  fastify.log.info({ ffmpegArgs }, 'Spawning FFmpeg stream copy pipeline');

  // Hijack Fastify reply to manage the raw streaming lifecycle directly
  reply.hijack();

  // Spawn FFmpeg subprocess
  const ffmpeg = spawn('ffmpeg', ffmpegArgs, { shell: false });
  let totalBytes = 0;
  let isCleanedUp = false;
  let headersSent = false;
  let stderrBuffer = '';

  function sendStreamHeaders() {
    if (headersSent) return;
    headersSent = true;
    reply.raw.statusCode = 200;
    reply.raw.setHeader('Content-Type', format === 'mp3' ? 'audio/mpeg' : 'video/mp4');
    reply.raw.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('X-Content-Type-Options', 'nosniff');
  }

  function killFfmpeg(reason) {
    if (isCleanedUp) return;
    isCleanedUp = true;
    fastify.log.warn({ reason }, 'Terminating FFmpeg stream subprocess');
    if (ffmpeg && !ffmpeg.killed) {
      try {
        ffmpeg.kill('SIGKILL');
      } catch (_) {}
    }
  }

  // Requirement 4: Kill FFmpeg immediately if client disconnects
  req.raw.on('close', () => {
    killFfmpeg('client_connection_closed');
  });

  req.raw.on('error', (err) => {
    killFfmpeg(`client_socket_error: ${err.message}`);
  });

  ffmpeg.stderr.on('data', (d) => {
    stderrBuffer += d.toString();
    if (stderrBuffer.length > 4096) {
      stderrBuffer = stderrBuffer.slice(-4096);
    }
  });

  // Zero disk writes: pipe directly to HTTP response stream
  ffmpeg.stdout.on('data', (chunk) => {
    sendStreamHeaders();
    totalBytes += chunk.length;

    // Enforce 500 MB limit
    if (totalBytes > MAX_FILE_SIZE_BYTES) {
      killFfmpeg('max_file_size_limit_exceeded');
      if (!reply.raw.writableEnded) {
        reply.raw.destroy(new Error(`Stream exceeded maximum file size of ${MAX_FILE_SIZE_MB}MB`));
      }
      return;
    }

    const canContinue = reply.raw.write(chunk);
    if (!canContinue) {
      ffmpeg.stdout.pause();
      reply.raw.once('drain', () => {
        if (!isCleanedUp && ffmpeg.stdout) {
          ffmpeg.stdout.resume();
        }
      });
    }
  });

  ffmpeg.stdout.on('end', () => {
    if (totalBytes > 0 && !reply.raw.writableEnded) {
      reply.raw.end();
    }
  });

  ffmpeg.on('error', (err) => {
    killFfmpeg(`spawn_error: ${err.message}`);
    if (!reply.raw.headersSent) {
      reply.raw.removeHeader('Content-Disposition');
      reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
      reply.raw.end(JSON.stringify({ ok: false, code: 'FFMPEG_ERROR', message: err.message }));
    } else if (!reply.raw.writableEnded) {
      reply.raw.destroy(err);
    }
  });

  ffmpeg.on('close', (code) => {
    // If FFmpeg exited with error before any bytes were written
    if (code !== 0 && totalBytes === 0 && !reply.raw.headersSent) {
      const blocked = isBotBlockedError(stderrBuffer);
      reply.raw.removeHeader('Content-Disposition');
      reply.raw.writeHead(blocked ? 403 : 502, { 'Content-Type': 'application/json' });
      return reply.raw.end(JSON.stringify({
        ok: false,
        code: blocked ? 'HOST_BLOCKED' : 'STREAM_FAILED',
        status: blocked ? 403 : 502,
        rawMessage: stderrBuffer.trim(),
      }));
    }

    if (!reply.raw.writableEnded) {
      reply.raw.end();
    }
  });
}

fastify.get('/stream', handleStream);
fastify.post('/stream', handleStream);
fastify.get('/api/stream', handleStream);
fastify.post('/api/stream', handleStream);

// Graceful legacy route informing clients of direct zero-disk streaming
fastify.post('/api/jobs', async (req, reply) => {
  return reply.status(200).send({
    ok: true,
    message: 'Worker operates in direct zero-disk streaming mode. Use GET /stream or POST /probe directly.',
    endpoints: {
      probe: 'POST /probe',
      stream: 'GET /stream?url=<url>&format=mp4&quality=1440p',
    },
  });
});

// Start Server
const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(`MUXARO Media Worker listening on http://${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown signals
process.on('SIGTERM', async () => {
  fastify.log.info('Received SIGTERM, closing server cleanly');
  await fastify.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  fastify.log.info('Received SIGINT, closing server cleanly');
  await fastify.close();
  process.exit(0);
});

start();
