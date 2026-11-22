/**
 * MUXARO Media Processing Platform - Redis Manifest Cache Manager
 * 
 * Caches extracted media manifests with differentiated TTLs:
 * - YouTube: 1800s (30 minutes)
 * - Vimeo: 1800s (30 minutes)
 * - Direct Media URLs: 600s (10 minutes)
 */

import * as crypto from 'node:crypto';
import type { Redis } from 'ioredis';
import type { MediaAnalysisResult, MediaPlatform } from '@muxaro/shared';
import { REDIS_KEYS } from '@muxaro/db';

export const CACHE_TTLS: Record<MediaPlatform, number> = {
  youtube: 1800, // 30 minutes
  vimeo: 1800,   // 30 minutes
  direct: 600,   // 10 minutes
};

export class ManifestCacheManager {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Computes a deterministic 32-character hexadecimal digest from a URL or video ID.
   */
  public computeHash(input: string): string {
    return crypto.createHash('sha256').update(input.trim()).digest('hex').slice(0, 32);
  }

  /**
   * Retrieves a cached manifest for a platform and identifier/URL.
   * Returns null if cache miss or expired. Sets `cached: true` on hit.
   */
  public async get(platform: MediaPlatform, idOrUrl: string): Promise<MediaAnalysisResult | null> {
    try {
      const hash = this.computeHash(idOrUrl);
      const key = REDIS_KEYS.analyseCache(platform, hash);
      const raw = await this.redis.get(key);

      if (!raw) return null;

      const parsed = JSON.parse(raw) as MediaAnalysisResult;
      return {
        ...parsed,
        cached: true,
      };
    } catch (err) {
      console.warn(`[ManifestCache] Cache read failed for platform=${platform}:`, err);
      return null;
    }
  }

  /**
   * Stores an analysis result in Redis with the appropriate platform TTL.
   */
  public async set(
    platform: MediaPlatform,
    idOrUrl: string,
    result: MediaAnalysisResult
  ): Promise<void> {
    try {
      const hash = this.computeHash(idOrUrl);
      const key = REDIS_KEYS.analyseCache(platform, hash);
      const ttl = CACHE_TTLS[platform] ?? 600;

      // Ensure cached flag is false when persisted
      const payload: MediaAnalysisResult = {
        ...result,
        cached: false,
      };

      await this.redis.set(key, JSON.stringify(payload), 'EX', ttl);
    } catch (err) {
      console.warn(`[ManifestCache] Cache write failed for platform=${platform}:`, err);
    }
  }

  /**
   * Explicitly evicts a cached manifest.
   */
  public async delete(platform: MediaPlatform, idOrUrl: string): Promise<void> {
    try {
      const hash = this.computeHash(idOrUrl);
      const key = REDIS_KEYS.analyseCache(platform, hash);
      await this.redis.del(key);
    } catch (err) {
      console.warn(`[ManifestCache] Cache delete failed for platform=${platform}:`, err);
    }
  }
}
