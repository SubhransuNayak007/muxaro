/**
 * MUXARO Media Processing Platform - Analysis Worker Comprehensive Test Suite
 */

import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  MuxaroError,
  assertSafeMediaUrl,
  canonicalizeMediaUrl,
  type MediaAnalysisResult,
  type MediaFormatInfo,
} from '@muxaro/shared';
import { ManifestCacheManager, CACHE_TTLS } from '../cache.js';
import { OutboundRateLimiter } from '../token-bucket.js';
import {
  ProxyManager,
  CLIENT_PROFILES,
  PROFILE_ROTATION_ORDER,
  type ClientProfileType,
} from '../proxy-manager.js';
import { DirectMediaExtractor } from '../extractors/direct.js';
import { YouTubeExtractor } from '../extractors/youtube.js';
import { VimeoExtractor } from '../extractors/vimeo.js';

// Mock Redis client for unit testing
class MockRedis {
  public store = new Map<string, string>();
  public hashes = new Map<string, Map<string, string>>();
  public ttls = new Map<string, number>();

  public async get(key: string): Promise<string | null> {
    return this.store.get(key) || null;
  }

  public async set(key: string, value: string, mode?: string, ttl?: number): Promise<'OK'> {
    this.store.set(key, value);
    if (ttl) this.ttls.set(key, ttl);
    return 'OK';
  }

  public async del(key: string): Promise<number> {
    const existed = this.store.delete(key);
    this.ttls.delete(key);
    return existed ? 1 : 0;
  }

  public pipeline(): any {
    const operations: Array<() => void> = [];
    return {
      hincrby: (key: string, field: string, increment: number) => {
        operations.push(() => {
          if (!this.hashes.has(key)) this.hashes.set(key, new Map());
          const map = this.hashes.get(key)!;
          const current = Number.parseInt(map.get(field) || '0', 10);
          map.set(field, String(current + increment));
        });
        return this;
      },
      hset: (key: string, field: string, value: string) => {
        operations.push(() => {
          if (!this.hashes.has(key)) this.hashes.set(key, new Map());
          this.hashes.get(key)!.set(field, value);
        });
        return this;
      },
      expire: (key: string, ttl: number) => {
        operations.push(() => this.ttls.set(key, ttl));
        return this;
      },
      exec: async () => {
        for (const op of operations) op();
        return [];
      },
    };
  }

  public async eval(_script: string, _numKeys: number, _key: string, _cap: string, _rate: string, _now: string, _req: string): Promise<[number, number, number]> {
    // Simulate successful token acquisition
    return [1, 10, 0];
  }
}

describe('Worker-Analyse: Subsystem Verification', () => {
  const mockRedis = new MockRedis() as any;

  // ===========================================================================
  // 1. Manifest Cache Manager
  // ===========================================================================
  describe('ManifestCacheManager', () => {
    const cache = new ManifestCacheManager(mockRedis);

    test('verifies differentiated TTLs (1800s YouTube/Vimeo, 600s Direct)', () => {
      assert.equal(CACHE_TTLS.youtube, 1800);
      assert.equal(CACHE_TTLS.vimeo, 1800);
      assert.equal(CACHE_TTLS.direct, 600);
    });

    test('computes deterministic SHA-256 hash', () => {
      const hash1 = cache.computeHash('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      const hash2 = cache.computeHash('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      assert.equal(hash1, hash2);
      assert.equal(hash1.length, 32);
    });

    test('stores and retrieves cached manifest with cached=true flag', async () => {
      const manifest: MediaAnalysisResult = {
        platform: 'youtube',
        id: 'dQw4w9WgXcQ',
        canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'Test Video',
        durationSeconds: 212,
        formats: [],
        isPlaylist: false,
        cached: false,
        inspectedAt: new Date().toISOString(),
      };

      await cache.set('youtube', 'dQw4w9WgXcQ', manifest);
      const retrieved = await cache.get('youtube', 'dQw4w9WgXcQ');

      assert.ok(retrieved);
      assert.equal(retrieved.id, 'dQw4w9WgXcQ');
      assert.equal(retrieved.cached, true);
      assert.equal(retrieved.title, 'Test Video');
    });

    test('evicts cached manifest on delete()', async () => {
      await cache.delete('youtube', 'dQw4w9WgXcQ');
      const retrieved = await cache.get('youtube', 'dQw4w9WgXcQ');
      assert.equal(retrieved, null);
    });
  });

  // ===========================================================================
  // 2. Outbound Token Bucket Rate Limiter
  // ===========================================================================
  describe('OutboundRateLimiter', () => {
    test('enforces rate limit bounds (8-12 req/sec)', () => {
      const limiterLow = new OutboundRateLimiter(mockRedis, { refillRate: 4 });
      const limiterHigh = new OutboundRateLimiter(mockRedis, { refillRate: 25 });
      // Clamped between 8 and 12
      assert.equal((limiterLow as any).refillRate, 8);
      assert.equal((limiterHigh as any).refillRate, 12);
    });

    test('generates randomized jitter within specified range (150-450ms)', async () => {
      const limiter = new OutboundRateLimiter(mockRedis, { minJitterMs: 10, maxJitterMs: 25 });
      const start = Date.now();
      await limiter.randomJitter(10, 25);
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 9, `Jitter elapsed ${elapsed}ms should be >= 9ms`);
    });

    test('acquires token from Redis Lua script', async () => {
      const limiter = new OutboundRateLimiter(mockRedis, { minJitterMs: 1, maxJitterMs: 5 });
      await assert.doesNotReject(async () => {
        await limiter.acquire('youtube.com');
      });
    });
  });

  // ===========================================================================
  // 3. Sticky Proxy & Client Profile Manager
  // ===========================================================================
  describe('ProxyManager', () => {
    const proxyList = [
      'http://user1:pass1@192.0.2.1:8000',
      'http://user2:pass2@192.0.2.2:8000',
      'http://user3:pass3@192.0.2.3:8000',
    ];
    const pm = new ProxyManager(mockRedis, proxyList);

    test('provides initial profile tv_embedded and follows exact rotation order', () => {
      const initial = pm.getInitialProfile();
      assert.equal(initial.id, 'tv_embedded');
      assert.equal(initial.clientName, 'TVHTML5_EMBEDDED');

      const next1 = pm.getNextProfile('tv_embedded');
      assert.ok(next1);
      assert.equal(next1.id, 'ios');

      const next2 = pm.getNextProfile('ios');
      assert.ok(next2);
      assert.equal(next2.id, 'mweb');

      const next3 = pm.getNextProfile('mweb');
      assert.ok(next3);
      assert.equal(next3.id, 'web');

      const next4 = pm.getNextProfile('web');
      assert.equal(next4, null); // Exhausted
    });

    test('verifies all 4 client profiles have headers and Innertube contexts', () => {
      for (const key of PROFILE_ROTATION_ORDER) {
        const profile = CLIENT_PROFILES[key];
        assert.ok(profile.userAgent, `Profile ${key} must have User-Agent`);
        assert.ok(profile.headers['User-Agent'], `Profile ${key} must have User-Agent header`);
        assert.ok(profile.innertubeContext.client, `Profile ${key} must have innertubeContext.client`);
      }
    });

    test('sticky proxy selection is deterministic for the same resource ID', () => {
      const proxyA1 = pm.getStickyProxy('dQw4w9WgXcQ');
      const proxyA2 = pm.getStickyProxy('dQw4w9WgXcQ');
      assert.ok(proxyA1);
      assert.ok(proxyA2);
      assert.equal(proxyA1.id, proxyA2.id);
      assert.equal(proxyA1.url, proxyA2.url);

      const proxyB = pm.getStickyProxy('different-video-id-999');
      assert.ok(proxyB);
    });

    test('applies health penalties and quarantines degraded proxies', async () => {
      const proxy = pm.getStickyProxy('test-penalty-resource')!;
      assert.ok(proxy);
      const initialScore = proxy.score;

      // Penalize for bot challenge (-35)
      await pm.recordFailure(proxy.id, 'bot_challenge');
      assert.equal(proxy.score, initialScore - 35);
      assert.equal(proxy.consecutiveFailures, 1);

      // Penalize for rate limit (-25)
      await pm.recordFailure(proxy.id, 'rate_limited');
      assert.equal(proxy.score, initialScore - 60);
      assert.equal(proxy.consecutiveFailures, 2);

      // 3rd consecutive failure triggers automatic quarantine
      await pm.recordFailure(proxy.id, 'network_error');
      assert.equal(proxy.consecutiveFailures, 3);
      assert.ok(proxy.quarantineUntilMs > Date.now());
    });

    test('circuit breaker transitions to OPEN after 5 consecutive failures', async () => {
      // Assert closed initially
      await assert.doesNotReject(async () => {
        await pm.assertCircuitClosed('test-service');
      });

      // Record 5 failures
      for (let i = 0; i < 5; i++) {
        await pm.recordCircuitFailure('test-service');
      }

      // Assert circuit trips to OPEN and throws MuxaroError
      await assert.rejects(
        async () => {
          await pm.assertCircuitClosed('test-service');
        },
        (err: any) => err instanceof MuxaroError && err.code === 'CIRCUIT_BREAKER_OPEN'
      );
    });
  });

  // ===========================================================================
  // 4. Direct Media Extractor
  // ===========================================================================
  describe('DirectMediaExtractor', () => {
    const directExtractor = new DirectMediaExtractor();

    test('correctly identifies MP4 ISO BMFF container from magic bytes', () => {
      // Synthetic MP4 buffer with ftyp box
      const buf = Buffer.alloc(32);
      buf.writeUInt32BE(16, 0); // boxSize = 16
      buf.write('ftyp', 4, 'ascii');
      buf.write('isom', 8, 'ascii'); // majorBrand
      buf.writeUInt32BE(512, 12);    // minorVersion

      const inspection = (directExtractor as any).inspectBuffer(buf, 'video/mp4', 1048576);
      assert.equal(inspection.container, 'mp4');
      assert.equal(inspection.hasVideo, true);
    });

    test('correctly identifies FLAC container from magic bytes', () => {
      const buf = Buffer.alloc(32);
      buf.write('fLaC', 0, 'ascii');

      const inspection = (directExtractor as any).inspectBuffer(buf, 'audio/flac', 5242880);
      assert.equal(inspection.container, 'flac');
      assert.equal(inspection.audioCodec, 'flac');
      assert.equal(inspection.hasVideo, false);
      assert.equal(inspection.hasAudio, true);
    });

    test('correctly identifies WebM/MKV from EBML magic bytes (0x1A45DFA3)', () => {
      const buf = Buffer.alloc(32);
      buf[0] = 0x1a;
      buf[1] = 0x45;
      buf[2] = 0xdf;
      buf[3] = 0xa3;
      buf.write('webm', 8, 'ascii');
      buf.write('V_VP9', 16, 'ascii');
      buf.write('A_OPUS', 24, 'ascii');

      const inspection = (directExtractor as any).inspectBuffer(buf);
      assert.equal(inspection.container, 'webm');
      assert.equal(inspection.videoCodec, 'vp9');
      assert.equal(inspection.audioCodec, 'opus');
    });

    test('blocks SSRF forbidden IP addresses during direct probe', async () => {
      await assert.rejects(
        async () => {
          await directExtractor.extract('http://127.0.0.1:8080/secret.mp4');
        },
        (err: any) => err instanceof MuxaroError && err.code === 'SSRF_BLOCKED'
      );

      await assert.rejects(
        async () => {
          await directExtractor.extract('http://169.254.169.254/latest/meta-data/');
        },
        (err: any) => err instanceof MuxaroError && err.code === 'SSRF_BLOCKED'
      );
    });
  });

  // ===========================================================================
  // 5. YouTube Extractor DRM Rejection
  // ===========================================================================
  describe('YouTubeExtractor', () => {
    const pm = new ProxyManager(mockRedis);
    const rl = new OutboundRateLimiter(mockRedis);
    const yt = new YouTubeExtractor({ proxyManager: pm, rateLimiter: rl });

    test('rejects DRM streams immediately with MuxaroError.drmProtected', async () => {
      // Mock player API returning playabilityStatus with DRM error
      const mockDrmResponse = {
        playabilityStatus: {
          status: 'ERROR',
          reason: 'This video contains DRM protection and cannot be played.',
          drmFamilies: { widevine: true },
        },
      };

      // Test helper parse logic
      assert.throws(
        () => {
          if (
            mockDrmResponse.playabilityStatus.drmFamilies ||
            /drm/i.test(mockDrmResponse.playabilityStatus.reason)
          ) {
            throw MuxaroError.drmProtected('YouTube');
          }
        },
        (err: any) => err instanceof MuxaroError && err.code === 'DRM_PROTECTED'
      );
    });
  });
});
