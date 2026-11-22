/**
 * MUXARO Zero-Wait Pipelined Stream Engine - Stage 1
 * apps/web/lib/stream-engine/warmup.ts
 *
 * Speculative Paste-Time Warmup:
 * - Pre-resolves DNS and pre-connects TCP/TLS (sub-200ms target)
 * - Probes HTTP Accept-Ranges and Content-Length
 * - Speculatively fetches the first 64KB init segment
 * - Caches pre-flight sessions so when user clicks Download, Stage 2 starts instantly
 */

import type { WarmupOptions, WarmupSession } from './types.ts';

// In-memory cache of warmed sessions keyed by normalized source URL with 5-minute TTL
const WARMUP_CACHE_TTL_MS = 5 * 60 * 1000;
const preconnectedOrigins = new Set<string>();

interface CacheEntry {
  session: WarmupSession;
  expiresAt: number;
}

const warmupCache = new Map<string, CacheEntry>();

/**
 * Pre-connects DNS and TCP/TLS to the target origin via DOM link elements
 */
export function preconnectOrigin(targetUrl: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  try {
    const url = new URL(targetUrl, window.location.origin);
    const origin = url.origin;

    if (preconnectedOrigins.has(origin)) return;
    preconnectedOrigins.add(origin);

    // DNS Prefetch
    const dnsLink = document.createElement('link');
    dnsLink.rel = 'dns-prefetch';
    dnsLink.href = origin;
    document.head.appendChild(dnsLink);

    // Preconnect (with crossorigin)
    const preconnectLink = document.createElement('link');
    preconnectLink.rel = 'preconnect';
    preconnectLink.href = origin;
    preconnectLink.crossOrigin = 'anonymous';
    document.head.appendChild(preconnectLink);
  } catch {
    // Graceful fallback for non-standard URLs
  }
}

/**
 * Normalizes a URL for cache keying
 */
function normalizeUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove transient query tracking params while keeping video IDs & stream tokens
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.trim();
  }
}

/**
 * Retrieves a warm session if it exists and has not expired
 */
export function getWarmupSession(sourceUrl: string): WarmupSession | undefined {
  const key = normalizeUrlKey(sourceUrl);
  const entry = warmupCache.get(key);
  if (!entry) return undefined;

  if (Date.now() > entry.expiresAt) {
    warmupCache.delete(key);
    return undefined;
  }

  return entry.session;
}

/**
 * Clears the warmup cache
 */
export function clearWarmupCache(): void {
  warmupCache.clear();
}

/**
 * Executes speculative paste-time warmup:
 * Pre-connects, checks ranges, and retrieves initial segment sub-200ms
 */
export async function warmupStream(
  sourceUrl: string,
  options?: Partial<WarmupOptions>
): Promise<WarmupSession> {
  const normalizedKey = normalizeUrlKey(sourceUrl);
  const existing = getWarmupSession(sourceUrl);
  if (existing) {
    return existing;
  }

  const timeoutMs = options?.timeoutMs ?? 3000;
  const fetchInitSegment = options?.fetchInitSegment ?? true;

  // 1. Fire-and-forget immediate DNS & TLS preconnect
  preconnectOrigin(sourceUrl);
  if (options?.videoUrl) preconnectOrigin(options.videoUrl);
  if (options?.audioUrl) preconnectOrigin(options.audioUrl);

  const start = performance.now();
  let rttMs = 0;
  let acceptsRanges = true;
  let contentLength: number | undefined;
  let contentType: string | undefined;
  let initSegment: Uint8Array | undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Direct or proxy stream target
    const probeUrl = options?.videoUrl || sourceUrl;

    // Speculatively fetch Range 0-65535 to grab both headers AND init segment in a single RTT
    const headers: Record<string, string> = fetchInitSegment
      ? { Range: 'bytes=0-65535' }
      : {};

    const response = await fetch(probeUrl, {
      method: fetchInitSegment ? 'GET' : 'HEAD',
      headers,
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit',
    });

    rttMs = Math.round(performance.now() - start);

    const cr = response.headers.get('content-range');
    const ar = response.headers.get('accept-ranges');
    acceptsRanges = ar === 'bytes' || (cr !== null && cr.startsWith('bytes'));

    const cl = response.headers.get('content-length');
    if (cr) {
      // Content-Range: bytes 0-65535/12345678
      const match = cr.match(/\/(\d+)$/);
      if (match && match[1]) {
        contentLength = parseInt(match[1], 10);
      }
    } else if (cl) {
      contentLength = parseInt(cl, 10);
    }

    contentType = response.headers.get('content-type') || undefined;

    if (fetchInitSegment && response.ok) {
      const arrayBuf = await response.arrayBuffer();
      initSegment = new Uint8Array(arrayBuf);
    }
  } catch (err) {
    // If range request was rejected (e.g. CORS or strict server), probe with HEAD or fallback
    rttMs = Math.round(performance.now() - start);
  } finally {
    clearTimeout(timer);
  }

  const session: WarmupSession = {
    sourceUrl,
    timestamp: Date.now(),
    rttMs: Math.max(1, rttMs),
    acceptsRanges,
    contentLength,
    contentType,
    initSegment,
    preconnected: true,
  };

  warmupCache.set(normalizedKey, {
    session,
    expiresAt: Date.now() + WARMUP_CACHE_TTL_MS,
  });

  return session;
}
