/**
 * MUXARO Unified Quota Manager
 * Single source of truth for daily processing limits, used jobs, and remaining credits
 * shared across /credits, /tools/playlist-batch, and API routes.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import type { UserTier } from '@/lib/types';

export interface UnifiedQuotaInfo {
  tier: UserTier | string;
  accountTier: string;
  dailyVideoLimit: number;
  usedVideoJobs: number;
  remainingVideoCredits: number;
  playlistJobsLimit: number;
  usedPlaylistJobs: number;
  remainingPlaylistCredits: number;
  maxPlaylistItems: number;
  rollingWindowHours: number;
  resetCountdownSeconds: number;
  nextResetIso: string;
  evaluatedAt: string;
}

// Canonical default baseline for guest / unauthenticated sessions
export const DEFAULT_UNIFIED_QUOTA: UnifiedQuotaInfo = {
  tier: 'guest',
  accountTier: 'GUEST',
  dailyVideoLimit: 10,
  usedVideoJobs: 0,
  remainingVideoCredits: 10,
  playlistJobsLimit: 1,
  usedPlaylistJobs: 0,
  remainingPlaylistCredits: 1,
  maxPlaylistItems: 50,
  rollingWindowHours: 24,
  resetCountdownSeconds: 86400,
  nextResetIso: new Date(Date.now() + 86400000).toISOString(),
  evaluatedAt: new Date().toISOString(),
};

/**
 * Normalizes raw payload from API into the canonical UnifiedQuotaInfo.
 */
export function normalizeUnifiedQuota(raw: unknown): UnifiedQuotaInfo {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_UNIFIED_QUOTA, evaluatedAt: new Date().toISOString() };
  }

  const d = (raw as Record<string, unknown>).data && typeof (raw as Record<string, unknown>).data === 'object'
    ? ((raw as Record<string, unknown>).data as Record<string, unknown>)
    : (raw as Record<string, unknown>);

  const num = (val: unknown, fallback: number): number => {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val === 'string') {
      const p = Number(val);
      if (Number.isFinite(p)) return p;
    }
    return fallback;
  };

  const dailyVideoLimit = Math.max(
    0,
    num(d.dailyVideoLimit ?? d.baseLimit ?? d.individualVideosLimit, DEFAULT_UNIFIED_QUOTA.dailyVideoLimit)
  );

  const usedVideoJobs = Math.max(
    0,
    num(d.usedVideoJobs ?? d.baseUsed, 0)
  );

  const remainingVideoCredits = Math.max(
    0,
    num(
      d.remainingVideoCredits ?? d.baseRemaining ?? d.totalAvailableIndividual ?? d.individualVideosRemaining,
      Math.max(0, dailyVideoLimit - usedVideoJobs)
    )
  );

  const playlistJobsLimit = Math.max(
    0,
    num(d.playlistJobsLimit, DEFAULT_UNIFIED_QUOTA.playlistJobsLimit)
  );

  const usedPlaylistJobs = Math.max(
    0,
    num(d.usedPlaylistJobs ?? d.playlistJobsUsed, 0)
  );

  const remainingPlaylistCredits = Math.max(
    0,
    num(
      d.remainingPlaylistCredits ?? d.playlistJobsRemaining,
      Math.max(0, playlistJobsLimit - usedPlaylistJobs)
    )
  );

  const maxPlaylistItems = Math.max(
    1,
    num(d.maxPlaylistItems, DEFAULT_UNIFIED_QUOTA.maxPlaylistItems)
  );

  const rollingWindowHours = Math.max(
    1,
    num(d.rollingWindowHours, DEFAULT_UNIFIED_QUOTA.rollingWindowHours)
  );

  const resetCountdownSeconds = Math.max(
    0,
    num(d.resetCountdownSeconds, DEFAULT_UNIFIED_QUOTA.resetCountdownSeconds)
  );

  const nextResetIso =
    typeof d.nextResetIso === 'string' && d.nextResetIso.trim()
      ? d.nextResetIso.trim()
      : new Date(Date.now() + resetCountdownSeconds * 1000).toISOString();

  const tier = (typeof d.tier === 'string' ? d.tier : DEFAULT_UNIFIED_QUOTA.tier) as UserTier;
  const accountTier = typeof d.accountTier === 'string' ? d.accountTier : String(tier).toUpperCase();

  return {
    tier,
    accountTier,
    dailyVideoLimit,
    usedVideoJobs,
    remainingVideoCredits,
    playlistJobsLimit,
    usedPlaylistJobs,
    remainingPlaylistCredits,
    maxPlaylistItems,
    rollingWindowHours,
    resetCountdownSeconds,
    nextResetIso,
    evaluatedAt: typeof d.evaluatedAt === 'string' ? d.evaluatedAt : new Date().toISOString(),
  };
}

class UnifiedQuotaManager {
  private cachedQuota: UnifiedQuotaInfo | null = null;
  private lastFetchTime = 0;
  private inFlightPromise: Promise<UnifiedQuotaInfo> | null = null;
  private listeners = new Set<(quota: UnifiedQuotaInfo) => void>();
  private readonly cacheTtlMs = 4000; // 4-second coalescing window

  /**
   * Fetches the unified quota from the authoritative API endpoint.
   */
  public async getQuota(forceRefresh = false): Promise<UnifiedQuotaInfo> {
    const now = Date.now();
    if (!forceRefresh && this.cachedQuota && now - this.lastFetchTime < this.cacheTtlMs) {
      return this.cachedQuota;
    }

    if (this.inFlightPromise && !forceRefresh) {
      return this.inFlightPromise;
    }

    this.inFlightPromise = (async () => {
      try {
        if (typeof window === 'undefined') {
          return { ...DEFAULT_UNIFIED_QUOTA, evaluatedAt: new Date().toISOString() };
        }

        const res = await fetch('/api/v1/account/credits', {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });

        if (!res.ok) {
          throw new Error(`Failed to fetch quota: HTTP ${res.status}`);
        }

        const json = await res.json();
        const normalized = normalizeUnifiedQuota(json);

        this.cachedQuota = normalized;
        this.lastFetchTime = Date.now();
        this.notify(normalized);
        return normalized;
      } catch (err) {
        // Fall back to degraded guest baseline if offline or network failure
        const fallback = this.cachedQuota || {
          ...DEFAULT_UNIFIED_QUOTA,
          evaluatedAt: new Date().toISOString(),
        };
        return fallback;
      } finally {
        this.inFlightPromise = null;
      }
    })();

    return this.inFlightPromise;
  }

  /**
   * Invalidate cached quota and broadcast updated data to all subscribers.
   */
  public async invalidate(): Promise<UnifiedQuotaInfo> {
    this.cachedQuota = null;
    this.lastFetchTime = 0;
    return this.getQuota(true);
  }

  /**
   * Record optimistic deduction when a job begins.
   */
  public recordOptimisticDeduction(type: 'video' | 'playlist', count = 1): void {
    if (!this.cachedQuota) return;

    if (type === 'video') {
      this.cachedQuota = {
        ...this.cachedQuota,
        usedVideoJobs: this.cachedQuota.usedVideoJobs + count,
        remainingVideoCredits: Math.max(0, this.cachedQuota.remainingVideoCredits - count),
      };
    } else {
      this.cachedQuota = {
        ...this.cachedQuota,
        usedPlaylistJobs: this.cachedQuota.usedPlaylistJobs + count,
        remainingPlaylistCredits: Math.max(0, this.cachedQuota.remainingPlaylistCredits - count),
      };
    }

    this.notify(this.cachedQuota);

    // Revalidate in background after 2 seconds to match server state
    setTimeout(() => {
      this.invalidate().catch(() => {});
    }, 2000);
  }

  /**
   * Subscribe to quota updates.
   */
  public subscribe(listener: (quota: UnifiedQuotaInfo) => void): () => void {
    this.listeners.add(listener);
    if (this.cachedQuota) {
      listener(this.cachedQuota);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(quota: UnifiedQuotaInfo): void {
    this.listeners.forEach((listener) => {
      try {
        listener(quota);
      } catch {
        // ignore subscriber exceptions
      }
    });
  }
}

export const quotaManager = new UnifiedQuotaManager();

/**
 * Convenient React hook to consume unified quota in any component.
 */
export function useUnifiedQuota() {
  const [quota, setQuota] = useState<UnifiedQuotaInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = await quotaManager.invalidate();
      setQuota(q);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh quota');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = quotaManager.subscribe((q) => {
      if (mounted) {
        setQuota(q);
        setLoading(false);
      }
    });

    quotaManager.getQuota().then((q) => {
      if (mounted) {
        setQuota(q);
        setLoading(false);
      }
    }).catch((err) => {
      if (mounted) {
        setError(err instanceof Error ? err.message : 'Failed to load quota');
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return {
    quota,
    loading,
    error,
    refresh,
    hasVideoCredits: (quota?.remainingVideoCredits ?? 0) > 0,
    hasPlaylistCredits: (quota?.remainingPlaylistCredits ?? 0) > 0,
  };
}
