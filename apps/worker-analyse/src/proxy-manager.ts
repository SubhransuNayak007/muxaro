/**
 * MUXARO Media Processing Platform - Sticky Proxy & Client Profile Manager
 * 
 * Implements Part 4.2 specification:
 * 1. Sticky Residential/ISP Proxy routing with session pinning by video/media ID.
 * 2. Proxy health scoring (0-100), degradation penalties, and automatic quarantine.
 * 3. Client profile rotation across (tv_embedded, ios, mweb, web).
 * 4. Redis-backed Circuit Breaker (CLOSED / OPEN / HALF_OPEN).
 */

import * as crypto from 'node:crypto';
import type { Redis } from 'ioredis';
import { MuxaroError, type CircuitState } from '@muxaro/shared';
import { REDIS_KEYS } from '@muxaro/db';

// =============================================================================
// 1. CLIENT PROFILES (tv_embedded, ios, mweb, web)
// =============================================================================

export type ClientProfileType = 'tv_embedded' | 'ios' | 'mweb' | 'web';

export interface ClientProfile {
  readonly id: ClientProfileType;
  readonly name: string;
  readonly clientName: string;
  readonly clientVersion: string;
  readonly userAgent: string;
  readonly clientScreen?: string;
  readonly headers: Record<string, string>;
  readonly innertubeContext: Record<string, unknown>;
}

export const CLIENT_PROFILES: Record<ClientProfileType, ClientProfile> = {
  tv_embedded: {
    id: 'tv_embedded',
    name: 'TV Embedded Player',
    clientName: 'TVHTML5_EMBEDDED',
    clientVersion: '2.0',
    userAgent:
      'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/6.0 TV Safari/537.36',
    clientScreen: 'EMBED',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/6.0 TV Safari/537.36',
      'X-YouTube-Client-Name': '85',
      'X-YouTube-Client-Version': '2.0',
    },
    innertubeContext: {
      client: {
        clientName: 'TVHTML5_EMBEDDED',
        clientVersion: '2.0',
        platform: 'TV',
        clientScreen: 'EMBED',
        hl: 'en',
        gl: 'US',
      },
      thirdParty: {
        embedUrl: 'https://www.youtube.com',
      },
    },
  },
  ios: {
    id: 'ios',
    name: 'iOS YouTube Client',
    clientName: 'IOS',
    clientVersion: '19.29.1',
    userAgent:
      'com.google.ios.youtube/19.29.1 (iPhone14,3; U; CPU iOS 17_5_1 like Mac OS X; en_US)',
    headers: {
      'User-Agent':
        'com.google.ios.youtube/19.29.1 (iPhone14,3; U; CPU iOS 17_5_1 like Mac OS X; en_US)',
      'X-YouTube-Client-Name': '5',
      'X-YouTube-Client-Version': '19.29.1',
    },
    innertubeContext: {
      client: {
        clientName: 'IOS',
        clientVersion: '19.29.1',
        deviceMake: 'Apple',
        deviceModel: 'iPhone14,3',
        osName: 'iOS',
        osVersion: '17.5.1.21F90',
        hl: 'en',
        gl: 'US',
      },
    },
  },
  mweb: {
    id: 'mweb',
    name: 'Mobile Web Chrome',
    clientName: 'MWEB',
    clientVersion: '2.20241118.01.00',
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.107 Mobile Safari/537.36',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.107 Mobile Safari/537.36',
      'X-YouTube-Client-Name': '2',
      'X-YouTube-Client-Version': '2.20241118.01.00',
    },
    innertubeContext: {
      client: {
        clientName: 'MWEB',
        clientVersion: '2.20241118.01.00',
        platform: 'MOBILE',
        osName: 'Android',
        osVersion: '14',
        hl: 'en',
        gl: 'US',
      },
    },
  },
  web: {
    id: 'web',
    name: 'Desktop Web Browser',
    clientName: 'WEB',
    clientVersion: '2.20241118.01.00',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': '2.20241118.01.00',
    },
    innertubeContext: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20241118.01.00',
        platform: 'DESKTOP',
        osName: 'Windows',
        osVersion: '10.0',
        hl: 'en',
        gl: 'US',
      },
    },
  },
};

export const PROFILE_ROTATION_ORDER: readonly ClientProfileType[] = [
  'tv_embedded',
  'ios',
  'mweb',
  'web',
];

// =============================================================================
// 2. STICKY PROXY MODELS & HEALTH SCORING
// =============================================================================

export interface ProxyNode {
  readonly id: string;
  readonly url: string;
  score: number;                   // Health score: 0 to 100
  consecutiveFailures: number;
  quarantineUntilMs: number;       // Timestamp when quarantine lifts
}

export type FailureReason = 'rate_limited' | 'bot_challenge' | 'network_error' | 'drm_blocked';

// =============================================================================
// 3. PROXY & PROFILE MANAGER
// =============================================================================

export class ProxyManager {
  private readonly redis: Redis;
  private readonly proxies: ProxyNode[] = [];
  private consecutiveCircuitFailures: Map<string, number> = new Map();

  constructor(redis: Redis, proxyUrls?: string[]) {
    this.redis = redis;

    // Load proxies from parameter, env PROXY_POOL, or PROXY_LIST
    const rawList =
      proxyUrls ||
      (process.env.PROXY_POOL ? process.env.PROXY_POOL.split(',') : []) ||
      (process.env.PROXY_LIST ? process.env.PROXY_LIST.split(',') : []);

    for (const raw of rawList) {
      const trimmed = raw.trim();
      if (trimmed.length > 0) {
        const id = this.hashProxyUrl(trimmed);
        this.proxies.push({
          id,
          url: trimmed,
          score: 100,
          consecutiveFailures: 0,
          quarantineUntilMs: 0,
        });
      }
    }
  }

  private hashProxyUrl(url: string): string {
    return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
  }

  /**
   * Returns a sticky residential/ISP proxy pinned to the given resource ID.
   * If all proxies are quarantined or no proxies configured, returns null (direct mode).
   */
  public getStickyProxy(resourceId: string): ProxyNode | null {
    const now = Date.now();
    // Filter proxies that are not quarantined and have a health score >= 20
    const available = this.proxies.filter(
      (p) => p.quarantineUntilMs <= now && p.score >= 20
    );

    if (available.length === 0) {
      return null;
    }

    // Hash resource ID to integer for deterministic sticky indexing
    const hash = crypto.createHash('md5').update(resourceId).digest();
    const index = Math.abs(hash.readInt32BE(0)) % available.length;
    return available[index];
  }

  /**
   * Records a successful upstream extraction outcome for a proxy.
   */
  public async recordSuccess(proxyId: string, latencyMs: number): Promise<void> {
    const proxy = this.proxies.find((p) => p.id === proxyId);
    if (proxy) {
      proxy.score = Math.min(100, proxy.score + 5);
      proxy.consecutiveFailures = 0;
      proxy.quarantineUntilMs = 0;
    }

    try {
      const key = REDIS_KEYS.proxyHealth(proxyId);
      const pipeline = this.redis.pipeline();
      pipeline.hincrby(key, 'totalRequests', 1);
      pipeline.hincrby(key, 'successCount', 1);
      pipeline.hincrby(key, 'totalLatencyMs', Math.round(latencyMs));
      pipeline.hset(key, 'lastUsedAt', new Date().toISOString());
      pipeline.expire(key, 86400 * 7);
      await pipeline.exec();
    } catch (err) {
      console.warn(`[ProxyManager] Failed to record success for proxy ${proxyId}:`, err);
    }
  }

  /**
   * Records a proxy failure and penalizes health score.
   * Quarantines proxy if score drops below threshold or 3 consecutive failures occur.
   */
  public async recordFailure(
    proxyId: string,
    reason: FailureReason,
    latencyMs: number = 0
  ): Promise<void> {
    const proxy = this.proxies.find((p) => p.id === proxyId);
    if (!proxy) return;

    proxy.consecutiveFailures += 1;

    let penalty = 20;
    if (reason === 'bot_challenge') penalty = 35;
    if (reason === 'rate_limited') penalty = 25;
    if (reason === 'network_error') penalty = 30;

    proxy.score = Math.max(0, proxy.score - penalty);

    // Quarantine proxy if severely degraded or 3 consecutive failures
    if (proxy.score < 20 || proxy.consecutiveFailures >= 3) {
      // 5-minute quarantine
      proxy.quarantineUntilMs = Date.now() + 300_000;
      console.warn(
        `[ProxyManager] Quarantined proxy ${proxyId} for 5m (score=${proxy.score}, failures=${proxy.consecutiveFailures})`
      );
    }

    try {
      const key = REDIS_KEYS.proxyHealth(proxyId);
      const pipeline = this.redis.pipeline();
      pipeline.hincrby(key, 'totalRequests', 1);
      pipeline.hincrby(key, 'failureCount', 1);
      pipeline.hincrby(key, 'totalLatencyMs', Math.round(latencyMs));
      pipeline.hset(key, 'lastFailureReason', reason);
      pipeline.hset(key, 'lastFailureAt', new Date().toISOString());
      pipeline.expire(key, 86400 * 7);
      await pipeline.exec();
    } catch (err) {
      console.warn(`[ProxyManager] Failed to record failure for proxy ${proxyId}:`, err);
    }
  }

  // ===========================================================================
  // 4. CLIENT PROFILE ROTATION
  // ===========================================================================

  /**
   * Returns the initial preferred profile for extraction.
   */
  public getInitialProfile(): ClientProfile {
    return CLIENT_PROFILES.tv_embedded;
  }

  /**
   * Returns the next client profile in rotation sequence when a bot-check or 403 occurs.
   * Rotation: tv_embedded -> ios -> mweb -> web
   */
  public getNextProfile(currentProfile: ClientProfileType): ClientProfile | null {
    const currentIndex = PROFILE_ROTATION_ORDER.indexOf(currentProfile);
    if (currentIndex < 0 || currentIndex >= PROFILE_ROTATION_ORDER.length - 1) {
      return null; // All profiles exhausted
    }
    const nextType = PROFILE_ROTATION_ORDER[currentIndex + 1];
    return CLIENT_PROFILES[nextType];
  }

  // ===========================================================================
  // 5. REDIS CIRCUIT BREAKER
  // ===========================================================================

  /**
   * Checks if the circuit breaker is open for the given service.
   * Throws MuxaroError.circuitBreakerOpen if OPEN.
   */
  public async assertCircuitClosed(serviceName: string): Promise<void> {
    const key = REDIS_KEYS.circuitBreaker(serviceName);
    const state = (await this.redis.get(key)) as CircuitState | null;

    if (state === 'OPEN') {
      throw MuxaroError.circuitBreakerOpen(serviceName);
    }
  }

  /**
   * Records a circuit failure for a service.
   * Trips circuit to OPEN for 60s if 5 consecutive failures occur.
   */
  public async recordCircuitFailure(serviceName: string): Promise<void> {
    const current = (this.consecutiveCircuitFailures.get(serviceName) || 0) + 1;
    this.consecutiveCircuitFailures.set(serviceName, current);

    if (current >= 5) {
      const key = REDIS_KEYS.circuitBreaker(serviceName);
      await this.redis.set(key, 'OPEN', 'EX', 60);
      console.error(
        `[CircuitBreaker] Service "${serviceName}" tripped OPEN for 60s after ${current} failures`
      );
    }
  }

  /**
   * Resets circuit breaker on successful operation.
   */
  public async recordCircuitSuccess(serviceName: string): Promise<void> {
    this.consecutiveCircuitFailures.set(serviceName, 0);
    const key = REDIS_KEYS.circuitBreaker(serviceName);
    const state = await this.redis.get(key);
    if (state === 'HALF_OPEN') {
      await this.redis.del(key);
    }
  }
}
