'use strict';
/**
 * POST /v1/inspect
 * Probes a media URL via yt-dlp and returns a structured InspectResponse
 * matching packages/contracts/src/inspect.ts.
 *
 * Features:
 *  - 10-minute Redis cache (key = sha256(url))
 *  - Internal API-key auth guard (enforced upstream in index.js but re-checked here)
 *  - MuxaroError JSON on all failures — no raw stack traces
 *  - Available resolutions: 8K down to 240p based on probed streams, with size estimates
 */

const { spawn }  = require('child_process');
const { createHash } = require('crypto');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PROBE_TIMEOUT_MS = 10_000; // 10 s hard cap for yt-dlp

/** Canonical platform detector */
const PLATFORM_PATTERNS = [
  { pattern: /youtube\.com|youtu\.be/i,      platform: 'youtube'   },
  { pattern: /instagram\.com/i,              platform: 'instagram' },
  { pattern: /tiktok\.com/i,                 platform: 'tiktok'    },
  { pattern: /(?:twitter|x)\.com/i,          platform: 'x'         },
  { pattern: /facebook\.com|fb\.watch/i,     platform: 'facebook'  },
  { pattern: /reddit\.com/i,                 platform: 'reddit'    },
  { pattern: /pinterest\.com/i,              platform: 'pinterest' },
  { pattern: /vimeo\.com/i,                  platform: 'vimeo'     },
];

/** Resolution tier ordering (high → low) */
const RESOLUTION_TIERS = [
  { label: '8K',    height: 4320, suffix: ' Ultra HD 8K'    },
  { label: '4K',    height: 2160, suffix: ' Ultra HD 4K'    },
  { label: '1440p', height: 1440, suffix: ' Quad HD'        },
  { label: '1080p', height: 1080, suffix: ' Full HD'        },
  { label: '720p',  height:  720, suffix: ' HD'             },
  { label: '480p',  height:  480, suffix: ' SD'             },
  { label: '360p',  height:  360, suffix: ''                },
  { label: '240p',  height:  240, suffix: ''                },
];

/** Rough bitrate budget (kbps) per resolution for size estimation */
const BITRATE_ESTIMATES_KBPS = {
  4320: 60_000,
  2160: 25_000,
  1440: 10_000,
  1080:  5_000,
  720:   2_500,
  480:   1_200,
  360:    700,
  240:    400,
};

// ---------------------------------------------------------------------------
// Redis helpers (gracefully degrade when Redis is unavailable)
// ---------------------------------------------------------------------------
let redisClient = null;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CACHE_TTL_SECONDS = 600; // 10 minutes

async function getRedisClient() {
  if (redisClient) return redisClient;
  try {
    // Use ioredis if available (added in package.json by agent), else skip
    const Redis = require('ioredis');
    const client = new Redis(REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 1500,
      maxRetriesPerRequest: 1,
    });
    await client.connect().catch(() => null);
    if (client.status === 'ready') {
      redisClient = client;
    }
  } catch (_) {
    // ioredis not installed or Redis unavailable — cache disabled
  }
  return redisClient;
}

function cacheKey(url) {
  return `muxaro:inspect:${createHash('sha256').update(url).digest('hex')}`;
}

async function cacheGet(url) {
  try {
    const r = await getRedisClient();
    if (!r) return null;
    const raw = await r.get(cacheKey(url));
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

async function cacheSet(url, data) {
  try {
    const r = await getRedisClient();
    if (!r) return;
    await r.set(cacheKey(url), JSON.stringify(data), 'EX', CACHE_TTL_SECONDS);
  } catch (_) {
    // non-fatal
  }
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------
function detectPlatform(url) {
  try {
    const u = new URL(url);
    const full = u.hostname + u.pathname;
    for (const { pattern, platform } of PLATFORM_PATTERNS) {
      if (pattern.test(full)) return platform;
    }
    // Check if URL looks like a direct media file
    if (/\.(mp4|mkv|webm|mov|avi|m4a|mp3|aac|flac|wav|opus)(\?|$)/i.test(u.pathname)) {
      return 'direct';
    }
  } catch (_) {}
  return 'other';
}

// ---------------------------------------------------------------------------
// Duration formatter: seconds → "HH:MM:SS" / "MM:SS"
// ---------------------------------------------------------------------------
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '00:00';
  const s = Math.floor(seconds);
  const hrs  = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad  = (n) => String(n).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

// ---------------------------------------------------------------------------
// Estimate filesize from duration + bitrate
// ---------------------------------------------------------------------------
function estimateFilesize(durationSeconds, heightPx) {
  if (!durationSeconds || durationSeconds <= 0) return undefined;
  const tierHeight = [4320, 2160, 1440, 1080, 720, 480, 360, 240]
    .find((h) => heightPx >= h) || 240;
  const bitrateKbps = BITRATE_ESTIMATES_KBPS[tierHeight] || 1000;
  // bytes = (kbps * 1000 / 8) * seconds
  return Math.round((bitrateKbps * 1000 / 8) * durationSeconds);
}

// ---------------------------------------------------------------------------
// yt-dlp probe
// ---------------------------------------------------------------------------
function probeWithYtdlp(targetUrl, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const args = [
      '-J',
      '--no-playlist',
      '--no-warnings',
      '--socket-timeout', '8',
      '--max-downloads', '1',
      '--flat-playlist',
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
      if (timedOut) return;
      if (code !== 0) {
        return resolve({ success: false, code, stderr: stderr.trim() });
      }
      try {
        resolve({ success: true, data: JSON.parse(stdout) });
      } catch (e) {
        resolve({ success: false, code: -1, stderr: `JSON parse error: ${e.message}` });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, code: -1, stderr: err.message });
    });
  });
}

// ---------------------------------------------------------------------------
// Transform yt-dlp raw formats → available resolutions + audio formats
// ---------------------------------------------------------------------------
function buildResolutionsAndAudio(ytInfo, durationSeconds) {
  const rawFormats = Array.isArray(ytInfo.formats) ? ytInfo.formats : [];

  // ── Video resolutions ────────────────────────────────────────────────────
  // Find the best available format per resolution tier
  const tierMap = new Map(); // heightLabel → best format obj

  for (const f of rawFormats) {
    if (!f.height || f.height <= 0) continue;
    // Bucket this format into the nearest tier from below
    const tier = RESOLUTION_TIERS.find((t) => f.height >= t.height);
    if (!tier) continue;

    const existing = tierMap.get(tier.label);
    if (!existing || (f.filesize || f.filesize_approx || 0) > (existing.filesize || existing.filesize_approx || 0)) {
      tierMap.set(tier.label, f);
    }
  }

  // Build ordered resolution option array
  const availableResolutions = [];
  for (const tier of RESOLUTION_TIERS) {
    const best = tierMap.get(tier.label);
    if (!best) continue;

    const height      = best.height;
    const width       = best.width || Math.round(height * (16 / 9));
    const fps         = best.fps || 30;
    const vcodec      = best.vcodec && best.vcodec !== 'none' ? best.vcodec : 'h264';
    const acodec      = best.acodec && best.acodec !== 'none' ? best.acodec : undefined;
    const container   = best.ext || 'mp4';
    const bitrateKbps = best.tbr ? Math.round(best.tbr) : (BITRATE_ESTIMATES_KBPS[
      [4320, 2160, 1440, 1080, 720, 480, 360, 240].find((h) => height >= h) || 240
    ]);
    const filesize    = best.filesize || best.filesize_approx || estimateFilesize(durationSeconds, height);
    const isHdr       = Boolean(best.dynamic_range && best.dynamic_range !== 'SDR');
    const requiresMerge = Boolean(
      (best.vcodec && best.vcodec !== 'none') &&
      (!best.acodec || best.acodec === 'none')
    );

    const badges = [];
    if (fps >= 60) badges.push('60fps');
    if (isHdr) badges.push('HDR');
    if (tier.label === '8K' || tier.label === '4K') badges.push('Ultra HD');

    availableResolutions.push({
      id:                  `${tier.label}-${best.format_id}`,
      formatId:            String(best.format_id),
      pairedAudioFormatId: requiresMerge ? (rawFormats.find((f) => f.acodec && f.acodec !== 'none' && !f.vcodec || f.vcodec === 'none')?.format_id) : undefined,
      label:               `${tier.label}${tier.suffix}`,
      resolution:          tier.label,
      height,
      width,
      fps,
      vcodec,
      acodec,
      container,
      targetContainer:     'mp4',
      filesize,
      bitrateKbps,
      isHdr,
      requiresMerge,
      badge:               badges.join(' ') || undefined,
    });
  }

  // ── Audio formats ────────────────────────────────────────────────────────
  const audioOnlyFormats = rawFormats.filter(
    (f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none')
  );

  // Deduplicate by acodec
  const audioMap = new Map();
  for (const f of audioOnlyFormats) {
    const key = `${f.acodec}-${f.abr || 0}`;
    const existing = audioMap.get(key);
    if (!existing || (f.abr || 0) > (existing.abr || 0)) {
      audioMap.set(key, f);
    }
  }

  const AUDIO_FORMAT_LABELS = {
    mp3:  'MP3',
    aac:  'AAC',
    m4a:  'M4A',
    opus: 'Opus',
    vorbis: 'Ogg Vorbis',
    flac: 'FLAC',
    wav:  'WAV',
  };

  const availableAudioFormats = [];
  for (const f of audioMap.values()) {
    const codec      = f.acodec || 'aac';
    const ext        = f.ext || 'm4a';
    const bitrateKbps = Math.round(f.abr || f.tbr || 128);
    const filesize   = f.filesize || f.filesize_approx || estimateFilesize(durationSeconds, 0);
    const label      = `${AUDIO_FORMAT_LABELS[ext] || ext.toUpperCase()} ${bitrateKbps}kbps`;

    availableAudioFormats.push({
      id:           `audio-${f.format_id}`,
      formatId:     String(f.format_id),
      label,
      format:       ext,
      bitrateKbps,
      bitrateLabel: `${bitrateKbps} kbps`,
      filesize,
      acodec:       codec,
    });
  }

  // Sort audio formats by bitrate descending
  availableAudioFormats.sort((a, b) => b.bitrateKbps - a.bitrateKbps);

  return { availableResolutions, availableAudioFormats };
}

// ---------------------------------------------------------------------------
// Best thumbnail selector
// ---------------------------------------------------------------------------
function pickThumbnail(ytInfo) {
  if (ytInfo.thumbnail) return ytInfo.thumbnail;
  if (Array.isArray(ytInfo.thumbnails) && ytInfo.thumbnails.length > 0) {
    // Prefer highest resolution thumbnail
    const sorted = [...ytInfo.thumbnails]
      .filter((t) => t.url)
      .sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)));
    return sorted[0]?.url || null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Error response builder (MuxaroError — no raw stack traces)
// ---------------------------------------------------------------------------
function muxaroError(reply, httpStatus, code, message, retryable = false) {
  return reply.status(httpStatus).send({
    ok: false,
    success: false,
    status: code,
    error: {
      code,
      message,
      retryable,
    },
    requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
  });
}

function sanitizeStderr(stderr) {
  if (!stderr) return 'Unknown probe failure.';
  const first = stderr.split('\n')[0] || stderr;
  if (/403|Forbidden|Sign in|bot|captcha|Turnstile|cloudflare/i.test(first)) {
    return 'Upstream media source restricted cloud access.';
  }
  if (/429|Too Many Requests|rate.?limit/i.test(first)) {
    return 'Rate limit reached. Please wait before retrying.';
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(first)) {
    return 'Media host unreachable or timed out.';
  }
  // Strip file paths
  return first.replace(/\/[^\s]+/g, '').replace(/\s{2,}/g, ' ').trim().slice(0, 200);
}

// ---------------------------------------------------------------------------
// Route handler factory (called from index.js)
// ---------------------------------------------------------------------------
function registerInspectRoute(fastify) {
  fastify.post('/v1/inspect', async (req, reply) => {
    const body   = req.body || {};
    const rawUrl = String(body.url || '').trim();

    // ── 1. Validate URL ────────────────────────────────────────────────────
    if (!rawUrl) {
      return muxaroError(reply, 400, 'INVALID_URL', 'Media URL is required in request body.');
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(rawUrl);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return muxaroError(reply, 400, 'INVALID_URL', 'Only HTTP and HTTPS URLs are supported.');
      }
    } catch (_) {
      return muxaroError(reply, 400, 'INVALID_URL', 'Malformed URL provided.');
    }

    // ── 2. Redis cache lookup ──────────────────────────────────────────────
    const forceRefresh = body.forceRefresh === true;
    if (!forceRefresh) {
      const cached = await cacheGet(rawUrl);
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return reply.status(200).send(cached);
      }
    }

    // ── 3. yt-dlp probe ───────────────────────────────────────────────────
    const result = await probeWithYtdlp(rawUrl, PROBE_TIMEOUT_MS);

    if (result.timedOut) {
      return muxaroError(reply, 504, 'TIMEOUT', 'Probe timed out after 10 seconds.', true);
    }

    if (!result.success) {
      const isBlocked = /403|Forbidden|Sign in|bot|captcha/i.test(result.stderr || '');
      const isRateLimit = /429|Too Many Requests/i.test(result.stderr || '');
      if (isBlocked) {
        return muxaroError(reply, 403, 'HOST_BLOCKED', sanitizeStderr(result.stderr));
      }
      if (isRateLimit) {
        return muxaroError(reply, 429, 'RATE_LIMITED', sanitizeStderr(result.stderr), true);
      }
      return muxaroError(reply, 422, 'PROBE_FAILED', sanitizeStderr(result.stderr));
    }

    const info = result.data;
    const durationSeconds = typeof info.duration === 'number' ? info.duration : 0;
    const thumbnailUrl    = pickThumbnail(info);

    if (!thumbnailUrl) {
      // Not a hard failure — some platforms don't expose thumbnails
    }

    const { availableResolutions, availableAudioFormats } = buildResolutionsAndAudio(info, durationSeconds);
    const platform = detectPlatform(rawUrl);

    const response = {
      id:                   info.id || `media_${Date.now()}`,
      url:                  rawUrl,
      title:                info.title || 'Media',
      thumbnailUrl:         thumbnailUrl || '',
      durationSeconds,
      durationFormatted:    formatDuration(durationSeconds),
      uploader:             info.uploader || info.channel || 'Unknown',
      uploaderUrl:          info.uploader_url || info.channel_url || undefined,
      platform,
      status:               'ready',
      availableResolutions,
      availableAudioFormats,
      isPlaylist:           info._type === 'playlist',
      playlistItems:        undefined,
      deliveryMode:         'worker',
      inspectedAt:          new Date().toISOString(),
    };

    // Handle playlist: surface up to 50 items
    if (info._type === 'playlist' && Array.isArray(info.entries)) {
      response.playlistItems = info.entries.slice(0, 50).map((e, idx) => ({
        index:          idx,
        id:             e.id || String(idx),
        title:          e.title || `Item ${idx + 1}`,
        url:            e.url || e.webpage_url || rawUrl,
        durationSeconds: e.duration || undefined,
        thumbnailUrl:   e.thumbnail || undefined,
      }));
    }

    // ── 4. Cache result ───────────────────────────────────────────────────
    await cacheSet(rawUrl, response);

    reply.header('X-Cache', 'MISS');
    return reply.status(200).send(response);
  });
}

module.exports = { registerInspectRoute };
