/**
 * Project MUXARO - Sticky Egress Pool Manager & Circuit Breaker
 *
 * Enforces the YouTube anti-ban Trust Tuple:
 *   Clean ISP/Residential IP + Matching IP-bound PO Token + Sticky Account Cookie + Bounded RPM
 *
 * Key invariants:
 * - Never blindly rotates one Google account cookie across multiple IPs (binds cookies 1:1 per profile).
 * - Preserves `ip=` signed URL affinity via `preferredId` / `egressProfileId` between /probe and /tunnel or worker jobs.
 * - Quarantines blocked/rate-limited (429 / 403 / BotGuard) egress profiles with exponential cooldowns.
 * - Never logs or exposes proxy credentials, cookies, or PO tokens in snapshots.
 */

import fs from 'node:fs';
import path from 'node:path';

export type EgressProxyType = 'isp' | 'residential' | 'ipv6' | 'direct';

export interface EgressProfileConfig {
  id: string;
  label?: string;
  proxyType: EgressProxyType;
  proxyUrl?: string;
  playerClients?: string;
  bgutilUrl?: string;
  poToken?: string;
  visitorData?: string;
  cookiesPath?: string;
  cookiesContent?: string;
  maxRpm?: number;
  priority?: number;
  forceIpVersion?: '4' | '6' | 'auto';
}

interface EgressRuntimeState {
  config: EgressProfileConfig;
  requestsTimestamps: number[];
  activeCount: number;
  consecutiveFailures: number;
  quarantineLevel: number;
  cooldownUntil: number;
  lastUsedAt: number;
  lastError?: string;
  successCount: number;
}

export interface EgressProfilePublicSummary {
  id: string;
  label: string;
  proxyType: EgressProxyType;
  hasProxy: boolean;
  proxyHost: string | null;
  hasCookies: boolean;
  hasBgutil: boolean;
  healthy: boolean;
  cooldownRemainingSec: number;
  rpmUsed: number;
  maxRpm: number;
  consecutiveFailures: number;
  successCount: number;
}

const DEFAULT_PRIORITY_BY_TYPE: Record<EgressProxyType, number> = {
  isp: 100,
  residential: 80,
  ipv6: 50,
  direct: 20,
};

const DEFAULT_RPM_BY_TYPE: Record<EgressProxyType, number> = {
  isp: 8,
  residential: 12,
  ipv6: 10,
  direct: 6,
};

const COOLDOWN_STEPS_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000];

function redactProxyHost(proxyUrl?: string): string | null {
  if (!proxyUrl) return null;
  try {
    const parsed = new URL(proxyUrl);
    return parsed.hostname || null;
  } catch {
    return 'configured-proxy';
  }
}

export function inferProxyTypeFromUrl(proxyUrl?: string): EgressProxyType {
  if (!proxyUrl) return 'direct';
  const lower = proxyUrl.toLowerCase();
  if (lower.includes('res') || lower.includes('residential')) return 'residential';
  if (lower.includes('ipv6') || lower.includes('[') || lower.includes('v6')) return 'ipv6';
  if (lower.includes('isp')) return 'isp';
  return 'isp';
}

export class EgressPoolManager {
  private profiles = new Map<string, EgressRuntimeState>();
  private lastEnvFingerprint = '';
  private explicitOverride = false;

  constructor(initialProfiles?: EgressProfileConfig[]) {
    if (initialProfiles && initialProfiles.length > 0) {
      this.explicitOverride = true;
      this.loadConfigs(initialProfiles);
    } else {
      this.reloadFromEnvIfNeeded();
    }
  }

  public loadConfigs(configs: EgressProfileConfig[]): void {
    const nextMap = new Map<string, EgressRuntimeState>();
    for (const raw of configs) {
      if (!raw || !raw.id) continue;
      const proxyType: EgressProxyType = raw.proxyType || inferProxyTypeFromUrl(raw.proxyUrl);
      const existing = this.profiles.get(raw.id);
      const normalized: EgressProfileConfig = {
        ...raw,
        proxyType,
        maxRpm: typeof raw.maxRpm === 'number' && raw.maxRpm > 0 ? raw.maxRpm : DEFAULT_RPM_BY_TYPE[proxyType],
        priority: typeof raw.priority === 'number' ? raw.priority : DEFAULT_PRIORITY_BY_TYPE[proxyType],
        forceIpVersion: raw.forceIpVersion || (proxyType === 'ipv6' ? '6' : 'auto'),
      };
      nextMap.set(raw.id, {
        config: normalized,
        requestsTimestamps: existing?.requestsTimestamps || [],
        activeCount: existing?.activeCount || 0,
        consecutiveFailures: existing?.consecutiveFailures || 0,
        quarantineLevel: existing?.quarantineLevel || 0,
        cooldownUntil: existing?.cooldownUntil || 0,
        lastUsedAt: existing?.lastUsedAt || 0,
        lastError: existing?.lastError,
        successCount: existing?.successCount || 0,
      });
    }

    if (nextMap.size === 0) {
      nextMap.set('direct-default', {
        config: {
          id: 'direct-default',
          label: 'Direct Egress (Unproxied)',
          proxyType: 'direct',
          maxRpm: DEFAULT_RPM_BY_TYPE.direct,
          priority: DEFAULT_PRIORITY_BY_TYPE.direct,
          forceIpVersion: 'auto',
        },
        requestsTimestamps: [],
        activeCount: 0,
        consecutiveFailures: 0,
        quarantineLevel: 0,
        cooldownUntil: 0,
        lastUsedAt: 0,
        successCount: 0,
      });
    }

    this.profiles = nextMap;
  }

  public reloadFromEnvIfNeeded(): void {
    if (this.explicitOverride && this.profiles.size > 0) {
      return;
    }
    const fingerprint = [
      process.env.MUXARO_EGRESS_PROFILES_JSON || '',
      process.env.YTDLP_PROXY_POOL || '',
      process.env.YTDLP_COOKIE_POOL_DIR || '',
      process.env.YTDLP_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '',
      process.env.BGUTIL_BASE_URL || process.env.YTDLP_BGUTIL_URL || process.env.POT_PROVIDER_URL || '',
      process.env.YTDLP_PLAYER_CLIENTS || '',
    ].join('|');

    if (fingerprint === this.lastEnvFingerprint && this.profiles.size > 0) {
      return;
    }
    this.lastEnvFingerprint = fingerprint;

    const jsonEnv = process.env.MUXARO_EGRESS_PROFILES_JSON?.trim();
    if (jsonEnv) {
      try {
        const parsed = JSON.parse(jsonEnv);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.loadConfigs(parsed);
          return;
        }
      } catch {
        // Ignore malformed JSON and fall back safely to structured env pools
      }
    }

    const bgutilUrl = (
      process.env.BGUTIL_BASE_URL ||
      process.env.YTDLP_BGUTIL_URL ||
      process.env.POT_PROVIDER_URL ||
      ''
    ).trim() || undefined;

    const cookieFiles: string[] = [];
    const cookiePoolDir = process.env.YTDLP_COOKIE_POOL_DIR?.trim();
    if (cookiePoolDir && fs.existsSync(cookiePoolDir)) {
      try {
        const entries = fs.readdirSync(cookiePoolDir);
        for (const name of entries.sort()) {
          if (name.endsWith('.txt')) {
            const full = path.join(cookiePoolDir, name);
            if (fs.statSync(full).size > 0) {
              cookieFiles.push(full);
            }
          }
        }
      } catch {
        // Ignore unreadable cookie directory
      }
    }

    const rawPool = (process.env.YTDLP_PROXY_POOL || '')
      .split(/[\r\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (rawPool.length > 0) {
      const configs: EgressProfileConfig[] = rawPool.map((proxyUrl, idx) => ({
        id: `pool-${idx + 1}`,
        label: `Egress Pool #${idx + 1}`,
        proxyType: inferProxyTypeFromUrl(proxyUrl),
        proxyUrl,
        bgutilUrl,
        // Bind each cookie file 1:1 to a single proxy index so one Google account never jumps IPs
        cookiesPath: cookieFiles[idx] || undefined,
      }));
      this.loadConfigs(configs);
      return;
    }

    const singleProxy = (
      process.env.YTDLP_PROXY ||
      process.env.HTTPS_PROXY ||
      process.env.HTTP_PROXY ||
      ''
    ).trim() || undefined;

    this.loadConfigs([
      {
        id: singleProxy ? 'env-primary' : 'direct-default',
        label: singleProxy ? 'Primary Configured Proxy' : 'Direct Egress (Unproxied)',
        proxyType: singleProxy ? inferProxyTypeFromUrl(singleProxy) : 'direct',
        proxyUrl: singleProxy,
        bgutilUrl,
        cookiesPath: cookieFiles[0] || undefined,
      },
    ]);
  }

  private pruneWindow(state: EgressRuntimeState, now: number): void {
    const cutoff = now - 60_000;
    state.requestsTimestamps = state.requestsTimestamps.filter((ts) => ts >= cutoff);
  }

  public getProfileById(id?: string): EgressProfileConfig | null {
    this.reloadFromEnvIfNeeded();
    if (!id) return null;
    return this.profiles.get(id)?.config || null;
  }

  public selectProfile(options: {
    preferredId?: string;
    excludeIds?: string[];
  } = {}): EgressProfileConfig {
    this.reloadFromEnvIfNeeded();
    const now = Date.now();
    const exclude = new Set(options.excludeIds || []);

    if (options.preferredId && !exclude.has(options.preferredId)) {
      const pinned = this.profiles.get(options.preferredId);
      if (pinned) {
        this.pruneWindow(pinned, now);
        pinned.requestsTimestamps.push(now);
        pinned.activeCount += 1;
        pinned.lastUsedAt = now;
        return pinned.config;
      }
    }

    const candidates = Array.from(this.profiles.values()).filter((s) => !exclude.has(s.config.id));
    const healthy = candidates.filter((s) => s.cooldownUntil <= now);
    const pool = healthy.length > 0 ? healthy : candidates;

    for (const s of pool) {
      this.pruneWindow(s, now);
    }

    const withinRpm = pool.filter((s) => s.requestsTimestamps.length < (s.config.maxRpm || 8));
    const finalCandidates = withinRpm.length > 0 ? withinRpm : pool;

    finalCandidates.sort((a, b) => {
      const prioDiff = (b.config.priority || 0) - (a.config.priority || 0);
      if (prioDiff !== 0) return prioDiff;
      if (a.activeCount !== b.activeCount) return a.activeCount - b.activeCount;
      if (a.requestsTimestamps.length !== b.requestsTimestamps.length) {
        return a.requestsTimestamps.length - b.requestsTimestamps.length;
      }
      return a.lastUsedAt - b.lastUsedAt;
    });

    const chosen = finalCandidates[0] || Array.from(this.profiles.values())[0];
    chosen.requestsTimestamps.push(now);
    chosen.activeCount += 1;
    chosen.lastUsedAt = now;
    return chosen.config;
  }

  public releaseProfile(id?: string): void {
    if (!id) return;
    const state = this.profiles.get(id);
    if (state && state.activeCount > 0) {
      state.activeCount -= 1;
    }
  }

  public markSuccess(id?: string): void {
    if (!id) return;
    const state = this.profiles.get(id);
    if (!state) return;
    state.consecutiveFailures = 0;
    state.quarantineLevel = 0;
    state.cooldownUntil = 0;
    state.lastError = undefined;
    state.successCount += 1;
    if (state.activeCount > 0) state.activeCount -= 1;
  }

  public markRateLimitedOrBlocked(id: string | undefined, reason: string): void {
    if (!id) return;
    const state = this.profiles.get(id);
    if (!state) return;
    if (state.activeCount > 0) state.activeCount -= 1;
    state.consecutiveFailures += 1;
    state.lastError = reason.slice(0, 240);
    // Quarantine immediately on explicit bot/rate block when multiple profiles exist, or after 2 consecutive blocks
    if (this.profiles.size > 1 || state.consecutiveFailures >= 2) {
      const idx = Math.min(state.quarantineLevel, COOLDOWN_STEPS_MS.length - 1);
      state.cooldownUntil = Date.now() + COOLDOWN_STEPS_MS[idx];
      state.quarantineLevel = Math.min(state.quarantineLevel + 1, COOLDOWN_STEPS_MS.length - 1);
    }
  }

  public getPoolSnapshot(): {
    totalProfiles: number;
    healthyProfiles: number;
    quarantinedProfiles: number;
    profiles: EgressProfilePublicSummary[];
  } {
    this.reloadFromEnvIfNeeded();
    const now = Date.now();
    const profiles: EgressProfilePublicSummary[] = [];
    let healthyProfiles = 0;
    let quarantinedProfiles = 0;

    for (const s of this.profiles.values()) {
      this.pruneWindow(s, now);
      const isQuarantined = s.cooldownUntil > now;
      if (isQuarantined) {
        quarantinedProfiles += 1;
      } else {
        healthyProfiles += 1;
      }
      profiles.push({
        id: s.config.id,
        label: s.config.label || s.config.id,
        proxyType: s.config.proxyType,
        hasProxy: Boolean(s.config.proxyUrl),
        proxyHost: redactProxyHost(s.config.proxyUrl),
        hasCookies: Boolean(s.config.cookiesPath || s.config.cookiesContent),
        hasBgutil: Boolean(s.config.bgutilUrl),
        healthy: !isQuarantined,
        cooldownRemainingSec: isQuarantined ? Math.ceil((s.cooldownUntil - now) / 1000) : 0,
        rpmUsed: s.requestsTimestamps.length,
        maxRpm: s.config.maxRpm || 8,
        consecutiveFailures: s.consecutiveFailures,
        successCount: s.successCount,
      });
    }

    return {
      totalProfiles: profiles.length,
      healthyProfiles,
      quarantinedProfiles,
      profiles,
    };
  }
}

export const egressPoolManager = new EgressPoolManager();
