/**
 * MUXARO Manifest Cache & Request Coalescing Engine
 * apps/web/lib/pipeline/manifest-cache.ts
 *
 * Pod 2 (Agent 05) High-Performance In-Memory Cache
 *
 * Features:
 * - In-memory LRU cache with strict 250-entry cap anchored on globalThis.__muxaroManifestCache
 * - Normalized canonical keys across YouTube, TikTok, X/Twitter, Instagram, Reddit, Vimeo
 * - Expiration-aware dynamic TTL: min(5 minutes, signedUrlExpiry - 90 seconds)
 * - Singleflight in-flight Promise coalescing to eliminate thundering-herd duplicate extractions
 * - Explicit bypassCache: true support for client retries and force-refreshes
 * - Full telemetry and inspection metrics
 */

export interface CachedManifestEntry<T = any> {
  key: string;
  data: T;
  cachedAt: number;
  expiresAt: number;
  ttlMs: number;
  hitCount: number;
  sourceUrl?: string;
  platform?: string;
}

export interface ManifestCacheStats {
  size: number;
  maxEntries: number;
  hits: number;
  misses: number;
  coalescedHits: number;
  evictions: number;
  activeInFlight: number;
}

export interface ManifestFetchOptions {
  bypassCache?: boolean;
  customTtlMs?: number;
}

const DEFAULT_MAX_ENTRIES = 250;
const MAX_DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SIGNED_EXPIRY_SAFETY_MARGIN_MS = 90 * 1000; // 90 seconds
const MIN_SAFETY_TTL_MS = 30 * 1000; // 30 seconds

/**
 * Normalizes any media URL into a stable, deduplicated cache key
 * Examples:
 *   https://www.youtube.com/watch?v=dQw4w9WgXcQ -> youtube:dQw4w9WgXcQ
 *   https://youtu.be/dQw4w9WgXcQ?si=xyz        -> youtube:dQw4w9WgXcQ
 *   https://www.tiktok.com/@user/video/123456  -> tiktok:123456
 *   https://x.com/user/status/7890123          -> x:7890123
 */
export function normalizeManifestKey(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return 'empty';
  }

  const trimmed = rawUrl.trim();

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    // 1. YouTube
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      if (host.includes('youtu.be')) {
        const vid = pathname.replace(/^\/+/, '').split('/')[0]?.split('?')[0];
        if (vid && /^[a-zA-Z0-9_-]{11}$/.test(vid)) {
          return `youtube:${vid}`;
        }
      }

      // Check standard query param ?v=
      const vParam = parsed.searchParams.get('v');
      if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
        return `youtube:${vParam}`;
      }

      // Check Shorts / Embed / Live
      const shortsMatch = pathname.match(/\/(?:shorts|embed|live|v)\/([a-zA-Z0-9_-]{11})/i);
      if (shortsMatch && shortsMatch[1]) {
        return `youtube:${shortsMatch[1]}`;
      }

      return `youtube:${pathname.replace(/\/+$/, '')}`;
    }

    // 2. TikTok
    if (host.includes('tiktok.com')) {
      const vidMatch = pathname.match(/\/video\/(\d+)/i);
      if (vidMatch && vidMatch[1]) {
        return `tiktok:${vidMatch[1]}`;
      }
      return `tiktok:${pathname.replace(/\/+$/, '')}`;
    }

    // 3. Twitter / X
    if (host.includes('twitter.com') || host.includes('x.com')) {
      const statusMatch = pathname.match(/\/status(?:es)?\/(\d+)/i);
      if (statusMatch && statusMatch[1]) {
        return `x:${statusMatch[1]}`;
      }
      return `x:${pathname.replace(/\/+$/, '')}`;
    }

    // 4. Instagram
    if (host.includes('instagram.com')) {
      const igMatch = pathname.match(/\/(?:p|reel|tv)\/([a-zA-Z0-9_-]+)/i);
      if (igMatch && igMatch[1]) {
        return `instagram:${igMatch[1]}`;
      }
      return `instagram:${pathname.replace(/\/+$/, '')}`;
    }

    // 5. Reddit
    if (host.includes('reddit.com')) {
      const postMatch = pathname.match(/\/comments\/([a-zA-Z0-9]+)/i);
      if (postMatch && postMatch[1]) {
        return `reddit:${postMatch[1]}`;
      }
      return `reddit:${pathname.replace(/\/+$/, '')}`;
    }

    // 6. Vimeo
    if (host.includes('vimeo.com')) {
      const vimeoMatch = pathname.match(/\/(\d+)/);
      if (vimeoMatch && vimeoMatch[1]) {
        return `vimeo:${vimeoMatch[1]}`;
      }
      return `vimeo:${pathname.replace(/\/+$/, '')}`;
    }

    // Generic Sanitized Canonical URL: strip tracking/affiliate search params
    const cleanParams = new URLSearchParams();
    const trackingBlacklist = new Set([
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'si', 'feature', 'fbclid', 'gclid', 'ref', 'source', 't', 'timestamp'
    ]);

    parsed.searchParams.forEach((val, key) => {
      if (!trackingBlacklist.has(key.toLowerCase())) {
        cleanParams.append(key, val);
      }
    });

    const cleanQuery = cleanParams.toString();
    return `generic:${host}${pathname.replace(/\/+$/, '')}${cleanQuery ? '?' + cleanQuery : ''}`;
  } catch {
    // Malformed URL fallback
    return `raw:${trimmed.toLowerCase().replace(/[^a-z0-9]/gi, '_').slice(0, 80)}`;
  }
}

/**
 * Parses signed media URLs in manifest/formats to find the earliest expiring token
 * Computes: min(5 minutes, signedUrlExpiry - 90 seconds)
 */
export function calculateManifestTtlMs(manifest: any): number {
  if (!manifest || typeof manifest !== 'object') {
    return MAX_DEFAULT_TTL_MS;
  }

  const candidateUrls: string[] = [];

  // Check direct URL fields
  if (typeof manifest.url === 'string') candidateUrls.push(manifest.url);
  if (typeof manifest.manifest_url === 'string') candidateUrls.push(manifest.manifest_url);

  // Check formats array (yt-dlp format contracts)
  if (Array.isArray(manifest.formats)) {
    for (const f of manifest.formats) {
      if (typeof f?.url === 'string') candidateUrls.push(f.url);
      if (typeof f?.manifest_url === 'string') candidateUrls.push(f.manifest_url);
    }
  }

  // Check streams array (canonical MUXARO MediaStream contracts)
  if (Array.isArray(manifest.streams)) {
    for (const s of manifest.streams) {
      if (typeof s?.url === 'string') candidateUrls.push(s.url);
    }
  }

  let earliestExpiryEpochSeconds = Infinity;
  const nowEpochSeconds = Math.floor(Date.now() / 1000);

  for (const mediaUrl of candidateUrls) {
    try {
      const u = new URL(mediaUrl);

      // YouTube / GoogleVideo signed query param: `expire=1710000000`
      const expireParam = u.searchParams.get('expire') || u.searchParams.get('expires');
      if (expireParam) {
        const parsed = parseInt(expireParam, 10);
        if (!isNaN(parsed) && parsed > nowEpochSeconds && parsed < earliestExpiryEpochSeconds) {
          earliestExpiryEpochSeconds = parsed;
        }
      }

      // AWS / CloudFront signed query param: `Expires=1710000000`
      const cfExpires = u.searchParams.get('Expires');
      if (cfExpires) {
        const parsed = parseInt(cfExpires, 10);
        if (!isNaN(parsed) && parsed > nowEpochSeconds && parsed < earliestExpiryEpochSeconds) {
          earliestExpiryEpochSeconds = parsed;
        }
      }

      // Instagram / Facebook CDN: `oe=HEX_TIMESTAMP`
      const oeParam = u.searchParams.get('oe');
      if (oeParam) {
        const parsed = parseInt(oeParam, 16);
        if (!isNaN(parsed) && parsed > nowEpochSeconds && parsed < earliestExpiryEpochSeconds) {
          earliestExpiryEpochSeconds = parsed;
        }
      }
    } catch {
      // Ignore URL parsing errors on fragments
    }
  }

  // If a signed expiration was detected, clamp with 90-second safety margin
  if (earliestExpiryEpochSeconds !== Infinity) {
    const remainingMs = (earliestExpiryEpochSeconds - nowEpochSeconds) * 1000;
    const expirationAwareTtlMs = Math.max(MIN_SAFETY_TTL_MS, remainingMs - SIGNED_EXPIRY_SAFETY_MARGIN_MS);
    return Math.min(MAX_DEFAULT_TTL_MS, expirationAwareTtlMs);
  }

  // Default fallback: 5 minutes
  return MAX_DEFAULT_TTL_MS;
}

/**
 * ManifestCache: LRU Cache with Singleflight Request Coalescing
 */
export class ManifestCache {
  private readonly maxEntries: number;
  private entries = new Map<string, CachedManifestEntry>();
  private inFlight = new Map<string, Promise<any>>();

  // Telemetry metrics
  private hits = 0;
  private misses = 0;
  private coalescedHits = 0;
  private evictions = 0;

  constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
    this.maxEntries = maxEntries;
  }

  public get size(): number {
    return this.entries.size;
  }

  public getStats(): ManifestCacheStats {
    return {
      size: this.entries.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
      coalescedHits: this.coalescedHits,
      evictions: this.evictions,
      activeInFlight: this.inFlight.size,
    };
  }

  /**
   * Retrieves an item from the LRU cache if present and not expired
   */
  public get<T>(rawUrlOrKey: string): T | undefined {
    const key = normalizeManifestKey(rawUrlOrKey);
    const entry = this.entries.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      this.misses++;
      return undefined;
    }

    // Refresh LRU ordering (re-insert moves key to the most recent end)
    this.entries.delete(key);
    entry.hitCount++;
    this.entries.set(key, entry);

    this.hits++;
    return entry.data as T;
  }

  /**
   * Stores a manifest in the LRU cache with expiration-aware TTL calculation
   */
  public set<T>(rawUrlOrKey: string, data: T, customTtlMs?: number): CachedManifestEntry<T> {
    const key = normalizeManifestKey(rawUrlOrKey);
    const now = Date.now();
    const ttlMs = typeof customTtlMs === 'number' && customTtlMs > 0
      ? customTtlMs
      : calculateManifestTtlMs(data);

    // Evict existing key if present to update position
    if (this.entries.has(key)) {
      this.entries.delete(key);
    } else if (this.entries.size >= this.maxEntries) {
      // Evict least-recently-used entry (first key in iteration order)
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
        this.evictions++;
      }
    }

    const entry: CachedManifestEntry<T> = {
      key,
      data,
      cachedAt: now,
      expiresAt: now + ttlMs,
      ttlMs,
      hitCount: 0,
      sourceUrl: rawUrlOrKey,
    };

    this.entries.set(key, entry);
    return entry;
  }

  public has(rawUrlOrKey: string): boolean {
    const key = normalizeManifestKey(rawUrlOrKey);
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  public delete(rawUrlOrKey: string): boolean {
    const key = normalizeManifestKey(rawUrlOrKey);
    return this.entries.delete(key);
  }

  public clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }

  /**
   * Singleflight Request Coalescing:
   * Simultaneous paste/click calls for the same resource share the exact same extraction Promise.
   */
  public async coalesce<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    if (this.inFlight.has(key)) {
      this.coalescedHits++;
      return this.inFlight.get(key)! as Promise<T>;
    }

    const extractionPromise = (async () => {
      try {
        return await fetcher();
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, extractionPromise);
    return extractionPromise;
  }

  /**
   * High-Level Fetch Orchestrator:
   * Checks LRU -> Singleflight In-flight Coalescing -> Auto-cache with TTL
   * Supports options.bypassCache: true on retry
   */
  public async getOrFetch<T>(
    rawUrl: string,
    fetcher: () => Promise<T>,
    options: ManifestFetchOptions = {}
  ): Promise<T> {
    const key = normalizeManifestKey(rawUrl);

    // If cache not bypassed, attempt cache hit
    if (!options.bypassCache) {
      const cached = this.get<T>(key);
      if (cached !== undefined) {
        return cached;
      }
    } else {
      // Explicit bypass: evict stale cache entry so fresh result replaces it
      this.delete(key);
    }

    // Coalesce simultaneous identical requests via singleflight
    const data = await this.coalesce<T>(key, fetcher);

    // Cache the fresh result
    this.set<T>(key, data, options.customTtlMs);

    return data;
  }
}

// Global anchor on globalThis preserves LRU cache across Next.js HMR reloads
declare global {
  // eslint-disable-next-line no-var
  var __muxaroManifestCache: ManifestCache | undefined;
}

export function getManifestCache(): ManifestCache {
  if (!globalThis.__muxaroManifestCache) {
    globalThis.__muxaroManifestCache = new ManifestCache(DEFAULT_MAX_ENTRIES);
  }
  return globalThis.__muxaroManifestCache;
}

export const manifestCache = getManifestCache();
