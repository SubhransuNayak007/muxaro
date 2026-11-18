/**
 * Project MUXARO - Unified Account Quota & Immutable Credit Ledger Service
 *
 * Persists entitlements, atomic quota reservations, and immutable credit ledger entries
 * in SQLite (Node 24 node:sqlite, WAL mode, BEGIN IMMEDIATE atomic transactions) while
 * maintaining 100% backwards-compatible method signatures for existing routes and tests.
 */

import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  EntitlementsEngine,
  InMemoryEntitlementStore,
  type Session,
  type QuotaSummary,
  type QuotaReservation,
  type JobQuotaType,
  type UserRole,
  type PlanTier,
  type QuotaBucket,
} from '@vyro/entitlements';
import { config } from '../config.js';
import {
  getDb,
  runInTransaction,
  getNumericSetting,
  getBooleanSetting,
  recordAnalyticsEvent,
} from '../db/database.js';
import { generatePrefixedId } from './id.service.js';

export type AccountTier = 'GUEST' | 'FREE' | 'PREMIUM';

export type CreditLedgerEntryType =
  | 'REWARD_GRANTED'
  | 'CREDIT_RESERVED'
  | 'CREDIT_CONSUMED'
  | 'CREDIT_RELEASED'
  | 'ADMIN_ADJUSTMENT'
  | 'CREDIT_EXPIRED';

export interface QuotaPolicy {
  guestIndividualLimit: number;
  guestPlaylistLimit: number;
  guestMaxConcurrent: number;
  freeIndividualLimit: number;
  freePlaylistLimit: number;
  freeMaxConcurrent: number;
  premiumIndividualLimit: number;
  premiumPlaylistLimit: number;
  premiumMaxConcurrent: number;
  rewardCreditsPerAd: number;
  rewardDailyCap: number;
  rewardExpiryHours: number;
  maxPlaylistItems: number;
  rollingWindowHours: number;
  rewardedAdsEnabled: boolean;
}

export interface TierPolicyLimits {
  accountTier: AccountTier;
  individualLimit: number;
  playlistLimit: number;
  maxConcurrent: number;
  maxPlaylistItems: number;
  queuePriority: 'GUEST' | 'REGISTERED' | 'PREMIUM';
}

export interface UnifiedQuotaStatus {
  userId: string;
  tier: AccountTier;
  role: string;
  queuePriority: 'GUEST' | 'REGISTERED' | 'PREMIUM';
  maxConcurrentJobs: number;
  baseLimit: number;
  baseUsed: number;
  baseRemaining: number;
  extraCreditsEarned: number;
  extraCreditsRemaining: number;
  extraCreditsExpiresAt: string | null;
  totalAvailableIndividual: number;
  maxIndividualWithRewards: number;
  rewardedAdsUsedToday: number;
  rewardedAdsDailyCap: number;
  remainingRewardedAdsToday: number;
  playlistJobsLimit: number;
  playlistJobsUsed: number;
  playlistJobsRemaining: number;
  maxPlaylistItems: number;
  rollingWindowHours: number;
  windowSeconds: number;
  resetCountdownSeconds: number;
  nextResetIso: string | null;
  playlistResetCountdownSeconds: number;
  playlistNextResetIso: string | null;
  evaluatedAt: string;
}

export interface CreditLedgerRecord {
  id: string;
  userId: string;
  entryType: CreditLedgerEntryType;
  delta: number;
  remainingDelta: number;
  balanceAfter: number;
  referenceId: string | null;
  reason: string;
  expiresAt: string | null;
  createdAt: string;
  // Backwards-compatible aliases for existing /credits UI
  timestamp: string;
  operation: string;
  change: number;
}

interface ExtraCreditLot {
  id: string;
  amount: number;
  remaining: number;
  expiresAtMs: number | null;
  createdAtMs: number;
  alreadyExpiredLogged: boolean;
}

interface ExtraCreditEvaluation {
  extraCreditsEarned24h: number;
  extraCreditsRemaining: number;
  extraCreditsExpiresAt: string | null;
  expiredCountThisSweep: number;
}

const ROLLING_WINDOW_HOURS = 24;
const ROLLING_WINDOW_MS = ROLLING_WINDOW_HOURS * 60 * 60 * 1000;
const DEFAULT_RESERVATION_TTL_MS = 30 * 60 * 1000; // 30 minutes for long transcode jobs

function getBucketForJobType(jobType: JobQuotaType): QuotaBucket {
  switch (jobType) {
    case 'PLAYLIST_DOWNLOAD':
    case 'PLAYLIST_JOB':
      return 'playlist';
    case 'PLAYLIST_CHILD':
      return 'none';
    case 'VIDEO_DOWNLOAD':
    case 'AUDIO_EXTRACTION':
    case 'MEDIA_MERGE':
    case 'INDIVIDUAL_VIDEO_JOB':
    default:
      return 'video';
  }
}

export function normalizeAccountTier(tier?: string | null, role?: string | null): AccountTier {
  const normRole = String(role || '').trim().toUpperCase();
  const normTier = String(tier || '').trim().toUpperCase();

  if (normRole === 'ANONYMOUS' || normRole === 'GUEST' || normTier === 'GUEST') {
    return 'GUEST';
  }
  if (normTier === 'PREMIUM' || normTier === 'PRO' || normTier === 'ENTERPRISE' || normRole === 'PRO') {
    return 'PREMIUM';
  }
  return 'FREE';
}

function mapAccountTierToPlanTier(tier: AccountTier): PlanTier {
  return tier === 'PREMIUM' ? 'pro' : 'free';
}

function mapAccountTierToUserRole(tier: AccountTier, rawRole?: string | null): UserRole {
  const norm = String(rawRole || '').trim().toLowerCase();
  if (norm === 'admin') return 'admin';
  if (tier === 'GUEST') return 'anonymous';
  if (tier === 'PREMIUM') return 'pro';
  return 'free';
}

export class EntitlementsService {
  public readonly engine: EntitlementsEngine;

  constructor() {
    const store = new InMemoryEntitlementStore();
    this.engine = new EntitlementsEngine(store, {
      sessionSecret: config.sessionSecret,
    });
  }

  /**
   * Reads live configurable quota & reward policy from `system_settings`.
   */
  public getPolicy(db: DatabaseSync = getDb()): QuotaPolicy {
    return {
      guestIndividualLimit: Math.max(0, getNumericSetting('guest_individual_limit', 3, db)),
      guestPlaylistLimit: Math.max(0, getNumericSetting('guest_playlist_limit', 0, db)),
      guestMaxConcurrent: Math.max(1, getNumericSetting('guest_max_concurrent', 1, db)),
      freeIndividualLimit: Math.max(1, getNumericSetting('base_individual_limit', 10, db)),
      freePlaylistLimit: Math.max(0, getNumericSetting('base_playlist_limit', 1, db)),
      freeMaxConcurrent: Math.max(1, getNumericSetting('free_max_concurrent', 2, db)),
      premiumIndividualLimit: Math.max(1, getNumericSetting('premium_individual_limit', 100, db)),
      premiumPlaylistLimit: Math.max(0, getNumericSetting('premium_playlist_limit', 10, db)),
      premiumMaxConcurrent: Math.max(1, getNumericSetting('premium_max_concurrent', 5, db)),
      rewardCreditsPerAd: Math.max(1, getNumericSetting('reward_credits_per_ad', 2, db)),
      rewardDailyCap: Math.max(0, getNumericSetting('reward_daily_cap', 3, db)),
      rewardExpiryHours: Math.max(1, getNumericSetting('reward_expiry_hours', 24, db)),
      maxPlaylistItems: Math.max(1, getNumericSetting('max_playlist_items', 50, db)),
      rollingWindowHours: ROLLING_WINDOW_HOURS,
      rewardedAdsEnabled:
        process.env.REWARDED_ADS_ENABLED !== 'false' &&
        getBooleanSetting('rewarded_ads_enabled', true, db),
    };
  }

  /**
   * Resolves effective account tier and limits for a user (checking DB `users` table first).
   */
  public resolveTierLimits(
    userId: string,
    tierHint?: string | null,
    roleHint?: string | null,
    db: DatabaseSync = getDb()
  ): TierPolicyLimits {
    const policy = this.getPolicy(db);

    let effectiveTier: AccountTier;
    const dbUser = db
      .prepare('SELECT tier, role FROM users WHERE id = ? AND deleted_at IS NULL')
      .get(userId) as { tier?: string; role?: string } | undefined;

    if (dbUser) {
      effectiveTier = normalizeAccountTier(dbUser.tier, dbUser.role);
    } else if (tierHint || roleHint) {
      effectiveTier = normalizeAccountTier(tierHint, roleHint);
    } else if (userId.startsWith('guest_') || userId.startsWith('anon_')) {
      effectiveTier = 'GUEST';
    } else {
      effectiveTier = 'FREE';
    }

    if (effectiveTier === 'GUEST') {
      return {
        accountTier: 'GUEST',
        individualLimit: policy.guestIndividualLimit,
        playlistLimit: policy.guestPlaylistLimit,
        maxConcurrent: policy.guestMaxConcurrent,
        maxPlaylistItems: policy.maxPlaylistItems,
        queuePriority: 'GUEST',
      };
    }

    if (effectiveTier === 'PREMIUM') {
      return {
        accountTier: 'PREMIUM',
        individualLimit: policy.premiumIndividualLimit,
        playlistLimit: policy.premiumPlaylistLimit,
        maxConcurrent: policy.premiumMaxConcurrent,
        maxPlaylistItems: policy.maxPlaylistItems,
        queuePriority: 'PREMIUM',
      };
    }

    return {
      accountTier: 'FREE',
      individualLimit: policy.freeIndividualLimit,
      playlistLimit: policy.freePlaylistLimit,
      maxConcurrent: policy.freeMaxConcurrent,
      maxPlaylistItems: policy.maxPlaylistItems,
      queuePriority: 'REGISTERED',
    };
  }

  /**
   * Resolves or creates a session for the incoming request.
   * Supports:
   * 1. Persistent `user_sessions` lookup when a session token / cookie token is supplied.
   * 2. Legacy deterministic dev/test Bearer tokens (`usr_*`, `session_*`) for integration tests.
   * 3. Anonymous guest session scoped to IP/UA or `@vyro/entitlements` token.
   */
  public async resolveSession(
    tokenHeader?: string,
    ipAddress?: string,
    userAgent?: string,
    cookieSessionToken?: string
  ): Promise<{ session: Session; token?: string }> {
    const db = getDb();

    // 1. Check cookie session token or Bearer token against persistent `user_sessions`
    const candidateTokens: string[] = [];
    if (cookieSessionToken && cookieSessionToken.trim()) {
      candidateTokens.push(cookieSessionToken.trim());
    }
    if (tokenHeader && tokenHeader.trim()) {
      candidateTokens.push(tokenHeader.replace(/^Bearer\s+/i, '').trim());
    }

    for (const rawToken of candidateTokens) {
      if (!rawToken) continue;
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const row = db
        .prepare(
          `SELECT s.id AS session_id, s.user_id, s.created_at, s.expires_at, s.last_seen_at,
                  u.role, u.tier, u.account_status, u.public_user_id
           FROM user_sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ?
             AND s.revoked_at IS NULL
             AND s.expires_at > ?
             AND u.deleted_at IS NULL`
        )
        .get(tokenHash, new Date().toISOString()) as
        | {
            session_id: string;
            user_id: string;
            created_at: string;
            expires_at: string;
            last_seen_at: string;
            role: string;
            tier: string;
            account_status: string;
            public_user_id: string;
          }
        | undefined;

      if (row && row.account_status === 'ACTIVE') {
        const accountTier = normalizeAccountTier(row.tier, row.role);
        return {
          session: {
            sessionId: row.session_id,
            userId: row.user_id,
            role: mapAccountTierToUserRole(accountTier, row.role),
            tier: mapAccountTierToPlanTier(accountTier),
            createdAt: Date.parse(row.created_at) || Date.now(),
            expiresAt: Date.parse(row.expires_at) || Date.now() + 86400000,
            lastActiveAt: Date.parse(row.last_seen_at) || Date.now(),
            ipAddress,
            userAgent,
            metadata: {
              publicUserId: row.public_user_id,
              accountTier,
              authenticated: true,
            },
          },
        };
      }
    }

    // 2. Existing @vyro/entitlements token / legacy `usr_` or `session_` bearer support
    if (tokenHeader) {
      const cleanToken = tokenHeader.replace(/^Bearer\s+/i, '').trim();
      try {
        const session = await this.engine.authenticateToken(cleanToken);
        return { session };
      } catch {
        if (cleanToken.startsWith('session_') || cleanToken.startsWith('usr_')) {
          const userId = cleanToken;
          return {
            session: {
              sessionId: `sess_${userId}`,
              userId,
              role: 'free',
              tier: 'free',
              createdAt: Date.now(),
              expiresAt: Date.now() + 86400000,
              lastActiveAt: Date.now(),
              ipAddress,
              userAgent,
            },
          };
        }
      }
    }

    // 3. Deterministic anonymous guest session scoped cleanly to client fingerprint
    const fingerprint = crypto
      .createHash('sha256')
      .update(`${ipAddress || '127.0.0.1'}|${userAgent || 'unknown'}|${config.sessionSecret}`)
      .digest('hex')
      .slice(0, 16);
    const guestUserId = `guest_${fingerprint}`;
    const now = Date.now();
    return {
      session: {
        sessionId: `gsess_${fingerprint}`,
        userId: guestUserId,
        role: 'anonymous',
        tier: 'free',
        createdAt: now,
        expiresAt: now + 86400000,
        lastActiveAt: now,
        ipAddress,
        userAgent,
        metadata: {
          accountTier: 'GUEST',
          authenticated: false,
        },
      },
    };
  }

  /**
   * Releases stale pending reservations whose TTL elapsed without commit.
   * Must be called inside a write transaction.
   */
  private expireStaleReservationsInTx(db: DatabaseSync, userId: string, nowIso: string): void {
    const staleRows = db
      .prepare(
        `SELECT id, bucket, units, source
         FROM quota_reservations
         WHERE user_id = ? AND status = 'RESERVED' AND expires_at <= ?`
      )
      .all(userId, nowIso) as Array<{
      id: string;
      bucket: string;
      units: number;
      source: string;
    }>;

    if (staleRows.length === 0) return;

    const updateStmt = db.prepare(
      `UPDATE quota_reservations
       SET status = 'EXPIRED', reason = 'Reservation TTL expired without commit', updated_at = ?
       WHERE id = ? AND status = 'RESERVED'`
    );

    for (const row of staleRows) {
      updateStmt.run(nowIso, row.id);
      if (row.source === 'extra' && row.bucket === 'video') {
        const extraEval = this.evaluateExtraCreditsInTx(db, userId, Date.parse(nowIso), false);
        const newBal = extraEval.extraCreditsRemaining + row.units;
        db.prepare(
          `INSERT INTO credit_ledger
            (id, user_id, entry_type, delta, remaining_delta, balance_after, reference_id, reason, expires_at, expired_processed, created_at)
           VALUES (?, ?, 'CREDIT_RELEASED', ?, ?, ?, ?, ?, NULL, 0, ?)`
        ).run(
          generatePrefixedId('led'),
          userId,
          row.units,
          row.units,
          newBal,
          row.id,
          'Released extra credit after reservation expiration',
          nowIso
        );
      }
    }
  }

  /**
   * Pure deterministic FIFO evaluation & optional expiry sweep over immutable `credit_ledger`.
   * NEVER executes UPDATE or DELETE on `credit_ledger` — logs `CREDIT_EXPIRED` rows referencing
   * expired grant IDs so history remains strictly append-only.
   */
  private evaluateExtraCreditsInTx(
    db: DatabaseSync,
    userId: string,
    nowMs: number,
    emitExpiryRows: boolean
  ): ExtraCreditEvaluation {
    const rows = db
      .prepare(
        `SELECT rowid, id, entry_type, delta, remaining_delta, reference_id, expires_at, created_at
         FROM credit_ledger
         WHERE user_id = ?
         ORDER BY created_at ASC, rowid ASC`
      )
      .all(userId) as Array<{
      rowid: number;
      id: string;
      entry_type: string;
      delta: number;
      remaining_delta: number;
      reference_id: string | null;
      expires_at: string | null;
      created_at: string;
    }>;

    const expiredGrantIds = new Set<string>();
    for (const r of rows) {
      if (r.entry_type === 'CREDIT_EXPIRED' && r.reference_id) {
        expiredGrantIds.add(r.reference_id);
      }
    }

    const windowStartMs = nowMs - ROLLING_WINDOW_MS;
    let extraCreditsEarned24h = 0;
    const lots: ExtraCreditLot[] = [];

    for (const r of rows) {
      const createdAtMs = Date.parse(r.created_at) || 0;

      if (r.entry_type === 'REWARD_GRANTED' && r.delta > 0) {
        if (createdAtMs > windowStartMs) {
          extraCreditsEarned24h += r.delta;
        }
        const expiresAtMs = r.expires_at ? Date.parse(r.expires_at) : null;
        lots.push({
          id: r.id,
          amount: r.delta,
          remaining: r.delta,
          expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : null,
          createdAtMs,
          alreadyExpiredLogged: expiredGrantIds.has(r.id),
        });
      } else if (r.entry_type === 'ADMIN_ADJUSTMENT') {
        const adj = r.remaining_delta !== 0 ? r.remaining_delta : r.delta;
        if (adj > 0) {
          const expiresAtMs = r.expires_at ? Date.parse(r.expires_at) : null;
          lots.push({
            id: r.id,
            amount: adj,
            remaining: adj,
            expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : null,
            createdAtMs,
            alreadyExpiredLogged: expiredGrantIds.has(r.id),
          });
        } else if (adj < 0) {
          let toDeduct = Math.abs(adj);
          for (const lot of lots) {
            if (toDeduct <= 0) break;
            if (lot.remaining <= 0) continue;
            if (lot.expiresAtMs !== null && lot.expiresAtMs <= createdAtMs) continue;
            const take = Math.min(lot.remaining, toDeduct);
            lot.remaining -= take;
            toDeduct -= take;
          }
        }
      } else if (r.entry_type === 'CREDIT_RESERVED' && r.remaining_delta < 0) {
        let toConsume = Math.abs(r.remaining_delta);
        // FIFO: earliest expiring active lot first
        const candidateLots = lots
          .filter((l) => l.remaining > 0 && (l.expiresAtMs === null || l.expiresAtMs > createdAtMs))
          .sort((a, b) => {
            const aExp = a.expiresAtMs ?? Number.MAX_SAFE_INTEGER;
            const bExp = b.expiresAtMs ?? Number.MAX_SAFE_INTEGER;
            return aExp - bExp || a.createdAtMs - b.createdAtMs;
          });
        for (const lot of candidateLots) {
          if (toConsume <= 0) break;
          const take = Math.min(lot.remaining, toConsume);
          lot.remaining -= take;
          toConsume -= take;
        }
      } else if (r.entry_type === 'CREDIT_RELEASED' && r.remaining_delta > 0) {
        let toRefund = r.remaining_delta;
        // Restore to latest unexpired lot that has room below its original grant amount
        const candidateLots = lots
          .filter(
            (l) =>
              l.remaining < l.amount &&
              (l.expiresAtMs === null || l.expiresAtMs > createdAtMs)
          )
          .sort((a, b) => {
            const aExp = a.expiresAtMs ?? Number.MAX_SAFE_INTEGER;
            const bExp = b.expiresAtMs ?? Number.MAX_SAFE_INTEGER;
            return bExp - aExp;
          });
        for (const lot of candidateLots) {
          if (toRefund <= 0) break;
          const space = lot.amount - lot.remaining;
          const give = Math.min(space, toRefund);
          lot.remaining += give;
          toRefund -= give;
        }
      } else if (r.entry_type === 'CREDIT_EXPIRED' && r.reference_id) {
        const lot = lots.find((l) => l.id === r.reference_id);
        if (lot) {
          lot.remaining = 0;
          lot.alreadyExpiredLogged = true;
        }
      }
    }

    // Sweep lots that have passed their rolling expiration timestamp
    let expiredCountThisSweep = 0;
    const nowIso = new Date(nowMs).toISOString();

    for (const lot of lots) {
      if (lot.expiresAtMs !== null && lot.expiresAtMs <= nowMs) {
        const unusedExpired = lot.remaining;
        lot.remaining = 0;

        if (emitExpiryRows && !lot.alreadyExpiredLogged && unusedExpired > 0) {
          lot.alreadyExpiredLogged = true;
          expiredCountThisSweep += unusedExpired;

          const remainingAfter = lots.reduce(
            (sum, l) =>
              sum + (l.remaining > 0 && (l.expiresAtMs === null || l.expiresAtMs > nowMs) ? l.remaining : 0),
            0
          );

          db.prepare(
            `INSERT INTO credit_ledger
              (id, user_id, entry_type, delta, remaining_delta, balance_after, reference_id, reason, expires_at, expired_processed, created_at)
             VALUES (?, ?, 'CREDIT_EXPIRED', ?, ?, ?, ?, ?, NULL, 1, ?)`
          ).run(
            generatePrefixedId('led'),
            userId,
            -unusedExpired,
            -unusedExpired,
            remainingAfter,
            lot.id,
            `Earned reward credits expired after rolling window`,
            nowIso
          );
        }
      }
    }

    let extraCreditsRemaining = 0;
    let earliestExpiryMs: number | null = null;
    for (const lot of lots) {
      if (lot.remaining > 0 && (lot.expiresAtMs === null || lot.expiresAtMs > nowMs)) {
        extraCreditsRemaining += lot.remaining;
        if (lot.expiresAtMs !== null) {
          if (earliestExpiryMs === null || lot.expiresAtMs < earliestExpiryMs) {
            earliestExpiryMs = lot.expiresAtMs;
          }
        }
      }
    }

    return {
      extraCreditsEarned24h,
      extraCreditsRemaining,
      extraCreditsExpiresAt: earliestExpiryMs !== null ? new Date(earliestExpiryMs).toISOString() : null,
      expiredCountThisSweep,
    };
  }

  /**
   * Computes rolling 24h base usage for a bucket (`'video'` or `'playlist'`).
   */
  private computeBaseBucketUsageInTx(
    db: DatabaseSync,
    userId: string,
    bucket: 'video' | 'playlist',
    limit: number,
    nowMs: number
  ): {
    used: number;
    remaining: number;
    activeReservations: number;
    resetsAtMs: number | null;
    resetInSeconds: number;
  } {
    const windowStartIso = new Date(nowMs - ROLLING_WINDOW_MS).toISOString();
    const rows = db
      .prepare(
        `SELECT units, status, created_at
         FROM quota_reservations
         WHERE user_id = ?
           AND bucket = ?
           AND source = 'base'
           AND status IN ('RESERVED', 'COMMITTED')
           AND created_at > ?
         ORDER BY created_at ASC`
      )
      .all(userId, bucket, windowStartIso) as Array<{
      units: number;
      status: string;
      created_at: string;
    }>;

    let used = 0;
    let activeReservations = 0;
    let earliestCreatedMs: number | null = null;

    for (const r of rows) {
      used += r.units;
      if (r.status === 'RESERVED') {
        activeReservations += r.units;
      }
      const createdMs = Date.parse(r.created_at);
      if (Number.isFinite(createdMs)) {
        if (earliestCreatedMs === null || createdMs < earliestCreatedMs) {
          earliestCreatedMs = createdMs;
        }
      }
    }

    const remaining = Math.max(0, limit - used);
    const resetsAtMs = earliestCreatedMs !== null ? earliestCreatedMs + ROLLING_WINDOW_MS : null;
    const resetInSeconds =
      resetsAtMs !== null && used > 0 ? Math.max(0, Math.ceil((resetsAtMs - nowMs) / 1000)) : 0;

    return {
      used,
      remaining,
      activeReservations,
      resetsAtMs,
      resetInSeconds,
    };
  }

  /**
   * Counts verified rewarded ads completed by a user in the rolling 24h window.
   */
  public getVerifiedRewardAdsCount24h(
    userId: string,
    nowMs: number = Date.now(),
    db: DatabaseSync = getDb()
  ): number {
    const windowStartIso = new Date(nowMs - ROLLING_WINDOW_MS).toISOString();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS cnt
         FROM reward_sessions
         WHERE user_id = ?
           AND status = 'VERIFIED'
           AND COALESCE(verified_at, updated_at, created_at) > ?`
      )
      .get(userId, windowStartIso) as { cnt?: number } | undefined;
    return Number(row?.cnt ?? 0);
  }

  /**
   * Upserts the user's current entitlement snapshot row in `entitlements`.
   */
  private syncEntitlementsSnapshotInTx(
    db: DatabaseSync,
    userId: string,
    limits: TierPolicyLimits,
    extraCreditsBalance: number,
    nowIso: string
  ): void {
    db.prepare(
      `INSERT INTO entitlements (user_id, tier, base_individual_limit, base_playlist_limit, max_concurrent_jobs, extra_credits_balance, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         tier = excluded.tier,
         base_individual_limit = excluded.base_individual_limit,
         base_playlist_limit = excluded.base_playlist_limit,
         max_concurrent_jobs = excluded.max_concurrent_jobs,
         extra_credits_balance = excluded.extra_credits_balance,
         updated_at = excluded.updated_at`
    ).run(
      userId,
      limits.accountTier,
      limits.individualLimit,
      limits.playlistLimit,
      limits.maxConcurrent,
      extraCreditsBalance,
      nowIso
    );
  }

  /**
   * Runs an atomic expiry sweep for a user and returns updated unified quota status.
   */
  public sweepExpiredCredits(userId: string, nowMs: number = Date.now()): ExtraCreditEvaluation {
    return runInTransaction((db) => {
      this.expireStaleReservationsInTx(db, userId, new Date(nowMs).toISOString());
      const evalResult = this.evaluateExtraCreditsInTx(db, userId, nowMs, true);
      const limits = this.resolveTierLimits(userId, undefined, undefined, db);
      this.syncEntitlementsSnapshotInTx(
        db,
        userId,
        limits,
        evalResult.extraCreditsRemaining,
        new Date(nowMs).toISOString()
      );
      return evalResult;
    });
  }

  /**
   * Returns full unified quota & credit breakdown for `/api/v1/entitlements`, `/api/v1/credits`,
   * and `/api/v1/account/credits`.
   */
  public async getQuotaStatus(
    userId: string,
    tier?: string | null,
    role?: string | null,
    nowMs: number = Date.now()
  ): Promise<UnifiedQuotaStatus> {
    return runInTransaction((db) => {
      const nowIso = new Date(nowMs).toISOString();
      this.expireStaleReservationsInTx(db, userId, nowIso);

      const policy = this.getPolicy(db);
      const limits = this.resolveTierLimits(userId, tier, role, db);
      const extra = this.evaluateExtraCreditsInTx(db, userId, nowMs, true);
      const videoBase = this.computeBaseBucketUsageInTx(db, userId, 'video', limits.individualLimit, nowMs);
      const playlistBase = this.computeBaseBucketUsageInTx(db, userId, 'playlist', limits.playlistLimit, nowMs);
      const rewardedAdsUsedToday = this.getVerifiedRewardAdsCount24h(userId, nowMs, db);
      const remainingRewardedAdsToday = Math.max(0, policy.rewardDailyCap - rewardedAdsUsedToday);

      this.syncEntitlementsSnapshotInTx(db, userId, limits, extra.extraCreditsRemaining, nowIso);

      const totalAvailableIndividual = videoBase.remaining + extra.extraCreditsRemaining;
      const maxIndividualWithRewards =
        limits.accountTier === 'GUEST'
          ? limits.individualLimit
          : limits.individualLimit + policy.rewardDailyCap * policy.rewardCreditsPerAd;

      return {
        userId,
        tier: limits.accountTier,
        role: role || (limits.accountTier === 'GUEST' ? 'GUEST' : 'USER'),
        queuePriority: limits.queuePriority,
        maxConcurrentJobs: limits.maxConcurrent,
        baseLimit: limits.individualLimit,
        baseUsed: videoBase.used,
        baseRemaining: videoBase.remaining,
        extraCreditsEarned: extra.extraCreditsEarned24h,
        extraCreditsRemaining: extra.extraCreditsRemaining,
        extraCreditsExpiresAt: extra.extraCreditsExpiresAt,
        totalAvailableIndividual,
        maxIndividualWithRewards,
        rewardedAdsUsedToday,
        rewardedAdsDailyCap: policy.rewardDailyCap,
        remainingRewardedAdsToday,
        playlistJobsLimit: limits.playlistLimit,
        playlistJobsUsed: playlistBase.used,
        playlistJobsRemaining: playlistBase.remaining,
        maxPlaylistItems: limits.maxPlaylistItems,
        rollingWindowHours: policy.rollingWindowHours,
        windowSeconds: ROLLING_WINDOW_HOURS * 3600,
        resetCountdownSeconds: videoBase.resetInSeconds,
        nextResetIso: videoBase.resetsAtMs ? new Date(videoBase.resetsAtMs).toISOString() : null,
        playlistResetCountdownSeconds: playlistBase.resetInSeconds,
        playlistNextResetIso: playlistBase.resetsAtMs
          ? new Date(playlistBase.resetsAtMs).toISOString()
          : null,
        evaluatedAt: nowIso,
      };
    });
  }

  /**
   * Backwards-compatible QuotaSummary view used by existing routes & tests.
   */
  public async getQuotaSummary(
    userId: string,
    tier: PlanTier = 'free',
    role: UserRole = 'free'
  ): Promise<QuotaSummary> {
    const status = await this.getQuotaStatus(userId, tier, role);
    return {
      userId,
      tier: mapAccountTierToPlanTier(status.tier),
      role: mapAccountTierToUserRole(status.tier, role),
      evaluatedAt: Date.parse(status.evaluatedAt),
      buckets: {
        video: {
          bucket: 'video',
          limit: status.baseLimit,
          used: status.baseUsed,
          remaining: status.totalAvailableIndividual,
          activeReservations: 0,
          windowMs: ROLLING_WINDOW_MS,
          resetsAt: status.nextResetIso ? Date.parse(status.nextResetIso) : null,
          resetInSeconds: status.resetCountdownSeconds,
        },
        playlist: {
          bucket: 'playlist',
          limit: status.playlistJobsLimit,
          used: status.playlistJobsUsed,
          remaining: status.playlistJobsRemaining,
          activeReservations: 0,
          windowMs: ROLLING_WINDOW_MS,
          resetsAt: status.playlistNextResetIso ? Date.parse(status.playlistNextResetIso) : null,
          resetInSeconds: status.playlistResetCountdownSeconds,
          maxItemsPerJob: status.maxPlaylistItems,
        },
      },
      credits: {
        balance: status.extraCreditsRemaining,
        currency: 'INDIVIDUAL_CREDITS',
      },
    };
  }

  /**
   * Atomically reserves a quota slot inside a SQLite IMMEDIATE transaction.
   * - Enforces rolling 24h base quota + unexpired extra rewarded credits for individual jobs.
   * - Strictly isolates playlist quota (rewarded credits NEVER apply to playlist jobs).
   * - Idempotent by `idempotencyKey`.
   * - Appends immutable `CREDIT_RESERVED` row to `credit_ledger`.
   */
  public async reserveQuota(params: {
    userId: string;
    role?: UserRole | string;
    tier?: PlanTier | string;
    jobType: JobQuotaType;
    itemCount?: number;
    jobId?: string;
    idempotencyKey?: string;
    ttlMs?: number;
  }): Promise<QuotaReservation> {
    const bucket = getBucketForJobType(params.jobType);
    const itemCount = Math.max(1, params.itemCount ?? 1);
    const units = 1;
    const ttlMs = params.ttlMs ?? DEFAULT_RESERVATION_TTL_MS;

    return runInTransaction((db) => {
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const expiresAtMs = nowMs + ttlMs;
      const expiresAtIso = new Date(expiresAtMs).toISOString();

      this.expireStaleReservationsInTx(db, params.userId, nowIso);

      // 1. Idempotency check (same user + same idempotencyKey returns existing reservation)
      if (params.idempotencyKey) {
        const existing = db
          .prepare(
            `SELECT id, user_id, bucket, units, source, status, idempotency_key, reference_id, expires_at, created_at, updated_at
             FROM quota_reservations
             WHERE idempotency_key = ? AND user_id = ?`
          )
          .get(params.idempotencyKey, params.userId) as
          | {
              id: string;
              user_id: string;
              bucket: string;
              units: number;
              source: string;
              status: string;
              idempotency_key: string;
              reference_id: string | null;
              expires_at: string;
              created_at: string;
              updated_at: string;
            }
          | undefined;

        if (existing) {
          return {
            reservationId: existing.id,
            userId: existing.user_id,
            jobId: existing.reference_id ?? params.jobId,
            idempotencyKey: existing.idempotency_key,
            jobType: params.jobType,
            bucket: existing.bucket as QuotaBucket,
            cost: existing.units,
            itemCount,
            status: existing.status as QuotaReservation['status'],
            createdAt: Date.parse(existing.created_at) || nowMs,
            expiresAt: Date.parse(existing.expires_at) || expiresAtMs,
            metadata: { source: existing.source, idempotentReplay: true },
          };
        }
      }

      // 2. Bucket 'none' (e.g., playlist child task) requires no independent reservation
      if (bucket === 'none') {
        return {
          reservationId: generatePrefixedId('res'),
          userId: params.userId,
          jobId: params.jobId,
          idempotencyKey: params.idempotencyKey,
          jobType: params.jobType,
          bucket: 'none',
          cost: 0,
          itemCount,
          status: 'COMMITTED',
          createdAt: nowMs,
          expiresAt: expiresAtMs,
        };
      }

      const limits = this.resolveTierLimits(params.userId, params.tier, params.role, db);

      // 3. Enforce playlist rules (strict isolation: extra rewarded credits NEVER unlock playlists)
      if (bucket === 'playlist') {
        if (limits.playlistLimit <= 0) {
          const err = new Error(
            'Playlist processing requires a free registered account. Sign in to unlock 1 playlist job every 24 hours.'
          );
          (err as any).statusCode = 409;
          (err as any).code = 'ERR_QUOTA_EXCEEDED';
          (err as any).details = {
            bucket: 'playlist',
            limit: 0,
            remaining: 0,
            tier: limits.accountTier,
            requiresAccount: limits.accountTier === 'GUEST',
          };
          throw err;
        }

        if (itemCount > limits.maxPlaylistItems) {
          const err = new Error(
            `Playlist item count (${itemCount}) exceeds the maximum limit of ${limits.maxPlaylistItems} items per playlist job.`
          );
          (err as any).statusCode = 400;
          (err as any).code = 'ERR_PLAYLIST_ITEM_LIMIT_EXCEEDED';
          (err as any).details = {
            bucket: 'playlist',
            maxPlaylistItems: limits.maxPlaylistItems,
            requestedItems: itemCount,
          };
          throw err;
        }

        const playlistUsage = this.computeBaseBucketUsageInTx(
          db,
          params.userId,
          'playlist',
          limits.playlistLimit,
          nowMs
        );
        if (playlistUsage.remaining < units) {
          const err = new Error(
            `Playlist job quota exceeded (${playlistUsage.used}/${limits.playlistLimit} used in rolling 24h window).`
          );
          (err as any).statusCode = 409;
          (err as any).code = 'ERR_QUOTA_EXCEEDED';
          (err as any).details = {
            bucket: 'playlist',
            limit: limits.playlistLimit,
            used: playlistUsage.used,
            remaining: 0,
            resetInSeconds: playlistUsage.resetInSeconds,
            nextResetIso: playlistUsage.resetsAtMs
              ? new Date(playlistUsage.resetsAtMs).toISOString()
              : null,
          };
          throw err;
        }

        const reservationId = generatePrefixedId('res');
        db.prepare(
          `INSERT INTO quota_reservations
            (id, user_id, bucket, units, source, status, idempotency_key, reference_id, reason, expires_at, created_at, updated_at)
           VALUES (?, ?, 'playlist', ?, 'base', 'RESERVED', ?, ?, ?, ?, ?, ?)`
        ).run(
          reservationId,
          params.userId,
          units,
          params.idempotencyKey ?? null,
          params.jobId ?? null,
          `Reserved playlist job (${itemCount} items)`,
          expiresAtIso,
          nowIso,
          nowIso
        );

        const playlistRemainingAfter = Math.max(0, playlistUsage.remaining - units);
        db.prepare(
          `INSERT INTO credit_ledger
            (id, user_id, entry_type, delta, remaining_delta, balance_after, reference_id, reason, expires_at, expired_processed, created_at)
           VALUES (?, ?, 'CREDIT_RESERVED', ?, 0, ?, ?, ?, NULL, 0, ?)`
        ).run(
          generatePrefixedId('led'),
          params.userId,
          -units,
          playlistRemainingAfter,
          params.jobId ?? reservationId,
          `Reserved playlist quota slot (${params.jobType})`,
          nowIso
        );

        return {
          reservationId,
          userId: params.userId,
          jobId: params.jobId,
          idempotencyKey: params.idempotencyKey,
          jobType: params.jobType,
          bucket: 'playlist',
          cost: units,
          itemCount,
          status: 'RESERVED',
          createdAt: nowMs,
          expiresAt: expiresAtMs,
          metadata: { source: 'base' },
        };
      }

      // 4. Individual video/audio/merge bucket: sweep expired credits first, then consume base -> extra
      const extra = this.evaluateExtraCreditsInTx(db, params.userId, nowMs, true);
      const videoBase = this.computeBaseBucketUsageInTx(
        db,
        params.userId,
        'video',
        limits.individualLimit,
        nowMs
      );

      let source: 'base' | 'extra';
      let extraRemainingAfter = extra.extraCreditsRemaining;
      let baseRemainingAfter = videoBase.remaining;

      if (videoBase.remaining >= units) {
        source = 'base';
        baseRemainingAfter = videoBase.remaining - units;
      } else if (extra.extraCreditsRemaining >= units) {
        source = 'extra';
        extraRemainingAfter = extra.extraCreditsRemaining - units;
      } else {
        const err = new Error(
          `Individual job quota exceeded (${videoBase.used}/${limits.individualLimit} base used, 0 extra credits available in rolling 24h window).`
        );
        (err as any).statusCode = 409;
        (err as any).code = 'ERR_QUOTA_EXCEEDED';
        (err as any).details = {
          bucket: 'video',
          tier: limits.accountTier,
          baseLimit: limits.individualLimit,
          baseUsed: videoBase.used,
          baseRemaining: 0,
          extraCreditsRemaining: 0,
          resetInSeconds: videoBase.resetInSeconds,
          nextResetIso: videoBase.resetsAtMs ? new Date(videoBase.resetsAtMs).toISOString() : null,
        };
        throw err;
      }

      const reservationId = generatePrefixedId('res');
      db.prepare(
        `INSERT INTO quota_reservations
          (id, user_id, bucket, units, source, status, idempotency_key, reference_id, reason, expires_at, created_at, updated_at)
         VALUES (?, ?, 'video', ?, ?, 'RESERVED', ?, ?, ?, ?, ?, ?)`
      ).run(
        reservationId,
        params.userId,
        units,
        source,
        params.idempotencyKey ?? null,
        params.jobId ?? null,
        source === 'extra'
          ? `Reserved rewarded extra credit (${params.jobType})`
          : `Reserved base individual quota slot (${params.jobType})`,
        expiresAtIso,
        nowIso,
        nowIso
      );

      const totalAvailableAfter = baseRemainingAfter + extraRemainingAfter;
      db.prepare(
        `INSERT INTO credit_ledger
          (id, user_id, entry_type, delta, remaining_delta, balance_after, reference_id, reason, expires_at, expired_processed, created_at)
         VALUES (?, ?, 'CREDIT_RESERVED', ?, ?, ?, ?, ?, NULL, 0, ?)`
      ).run(
        generatePrefixedId('led'),
        params.userId,
        -units,
        source === 'extra' ? -units : 0,
        totalAvailableAfter,
        params.jobId ?? reservationId,
        source === 'extra'
          ? `Reserved rewarded extra credit (${params.jobType})`
          : `Reserved individual job slot (${params.jobType})`,
        nowIso
      );

      this.syncEntitlementsSnapshotInTx(db, params.userId, limits, extraRemainingAfter, nowIso);

      return {
        reservationId,
        userId: params.userId,
        jobId: params.jobId,
        idempotencyKey: params.idempotencyKey,
        jobType: params.jobType,
        bucket: 'video',
        cost: units,
        itemCount,
        status: 'RESERVED',
        createdAt: nowMs,
        expiresAt: expiresAtMs,
        metadata: { source },
      };
    });
  }

  /**
   * Commits a reserved quota slot when a job completes successfully.
   * Appends immutable `CREDIT_CONSUMED` entry to `credit_ledger`.
   */
  public async commitQuota(reservationId: string): Promise<QuotaReservation> {
    return runInTransaction((db) => {
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      const row = db
        .prepare(
          `SELECT id, user_id, bucket, units, source, status, idempotency_key, reference_id, expires_at, created_at, updated_at
           FROM quota_reservations
           WHERE id = ? OR reference_id = ?`
        )
        .get(reservationId, reservationId) as
        | {
            id: string;
            user_id: string;
            bucket: string;
            units: number;
            source: string;
            status: string;
            idempotency_key: string | null;
            reference_id: string | null;
            expires_at: string;
            created_at: string;
            updated_at: string;
          }
        | undefined;

      if (!row) {
        // Fallback for non-persisted synthetic reservations (e.g. bucket === 'none')
        return {
          reservationId,
          userId: 'unknown',
          jobType: 'VIDEO_DOWNLOAD',
          bucket: 'none',
          cost: 0,
          itemCount: 1,
          status: 'COMMITTED',
          createdAt: nowMs,
          expiresAt: nowMs,
          committedAt: nowMs,
        };
      }

      if (row.status === 'COMMITTED') {
        return {
          reservationId: row.id,
          userId: row.user_id,
          jobId: row.reference_id ?? undefined,
          idempotencyKey: row.idempotency_key ?? undefined,
          jobType: row.bucket === 'playlist' ? 'PLAYLIST_DOWNLOAD' : 'VIDEO_DOWNLOAD',
          bucket: row.bucket as QuotaBucket,
          cost: row.units,
          itemCount: 1,
          status: 'COMMITTED',
          createdAt: Date.parse(row.created_at) || nowMs,
          expiresAt: Date.parse(row.expires_at) || nowMs,
          committedAt: Date.parse(row.updated_at) || nowMs,
        };
      }

      if (row.status === 'RESERVED') {
        db.prepare(
          `UPDATE quota_reservations SET status = 'COMMITTED', updated_at = ? WHERE id = ? AND status = 'RESERVED'`
        ).run(nowIso, row.id);

        const limits = this.resolveTierLimits(row.user_id, undefined, undefined, db);
        const extra = this.evaluateExtraCreditsInTx(db, row.user_id, nowMs, false);
        const baseUsage = this.computeBaseBucketUsageInTx(
          db,
          row.user_id,
          row.bucket === 'playlist' ? 'playlist' : 'video',
          row.bucket === 'playlist' ? limits.playlistLimit : limits.individualLimit,
          nowMs
        );
        const balanceAfter =
          row.bucket === 'playlist'
            ? baseUsage.remaining
            : baseUsage.remaining + extra.extraCreditsRemaining;

        db.prepare(
          `INSERT INTO credit_ledger
            (id, user_id, entry_type, delta, remaining_delta, balance_after, reference_id, reason, expires_at, expired_processed, created_at)
           VALUES (?, ?, 'CREDIT_CONSUMED', 0, 0, ?, ?, ?, NULL, 0, ?)`
        ).run(
          generatePrefixedId('led'),
          row.user_id,
          balanceAfter,
          row.reference_id ?? row.id,
          row.source === 'extra'
            ? 'Consumed rewarded extra credit on job completion'
            : `Consumed ${row.bucket} quota slot on job completion`,
          nowIso
        );

        if (row.source === 'extra') {
          recordAnalyticsEvent('extra_credit_consumed', row.user_id, limits.accountTier, {
            units: row.units,
          });
        }
      }

      return {
        reservationId: row.id,
        userId: row.user_id,
        jobId: row.reference_id ?? undefined,
        idempotencyKey: row.idempotency_key ?? undefined,
        jobType: row.bucket === 'playlist' ? 'PLAYLIST_DOWNLOAD' : 'VIDEO_DOWNLOAD',
        bucket: row.bucket as QuotaBucket,
        cost: row.units,
        itemCount: 1,
        status: 'COMMITTED',
        createdAt: Date.parse(row.created_at) || nowMs,
        expiresAt: Date.parse(row.expires_at) || nowMs,
        committedAt: nowMs,
      };
    });
  }

  /**
   * Releases/refunds a reserved quota slot when a job is cancelled or fails.
   * Appends immutable `CREDIT_RELEASED` entry to `credit_ledger`.
   */
  public async rollbackQuota(
    reservationIdOrJobId: string,
    reason: string = 'Job failed or cancelled'
  ): Promise<QuotaReservation> {
    return runInTransaction((db) => {
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      const row = db
        .prepare(
          `SELECT id, user_id, bucket, units, source, status, idempotency_key, reference_id, expires_at, created_at, updated_at
           FROM quota_reservations
           WHERE id = ? OR reference_id = ?`
        )
        .get(reservationIdOrJobId, reservationIdOrJobId) as
        | {
            id: string;
            user_id: string;
            bucket: string;
            units: number;
            source: string;
            status: string;
            idempotency_key: string | null;
            reference_id: string | null;
            expires_at: string;
            created_at: string;
            updated_at: string;
          }
        | undefined;

      if (!row) {
        return {
          reservationId: reservationIdOrJobId,
          userId: 'unknown',
          jobType: 'VIDEO_DOWNLOAD',
          bucket: 'none',
          cost: 0,
          itemCount: 1,
          status: 'RELEASED',
          createdAt: nowMs,
          expiresAt: nowMs,
          rolledBackAt: nowMs,
          rollbackReason: reason,
        };
      }

      if (row.status === 'RELEASED' || row.status === 'ROLLED_BACK') {
        return {
          reservationId: row.id,
          userId: row.user_id,
          jobId: row.reference_id ?? undefined,
          idempotencyKey: row.idempotency_key ?? undefined,
          jobType: row.bucket === 'playlist' ? 'PLAYLIST_DOWNLOAD' : 'VIDEO_DOWNLOAD',
          bucket: row.bucket as QuotaBucket,
          cost: row.units,
          itemCount: 1,
          status: 'RELEASED',
          createdAt: Date.parse(row.created_at) || nowMs,
          expiresAt: Date.parse(row.expires_at) || nowMs,
          rolledBackAt: Date.parse(row.updated_at) || nowMs,
          rollbackReason: reason,
        };
      }

      if (row.status === 'RESERVED') {
        db.prepare(
          `UPDATE quota_reservations SET status = 'RELEASED', reason = ?, updated_at = ? WHERE id = ? AND status = 'RESERVED'`
        ).run(reason, nowIso, row.id);

        const limits = this.resolveTierLimits(row.user_id, undefined, undefined, db);
        const extraBeforeRefund = this.evaluateExtraCreditsInTx(db, row.user_id, nowMs, true);
        // Check whether an unexpired extra-credit lot can actually accept the refund
        const activeGrantCapRow = db
          .prepare(
            `SELECT COALESCE(SUM(delta), 0) AS cap
             FROM credit_ledger
             WHERE user_id = ?
               AND entry_type IN ('REWARD_GRANTED', 'ADMIN_ADJUSTMENT')
               AND delta > 0
               AND (expires_at IS NULL OR expires_at > ?)`
          )
          .get(row.user_id, nowIso) as { cap?: number } | undefined;
        const activeCap = Number(activeGrantCapRow?.cap ?? 0);
        const effectiveExtraRefund =
          row.source === 'extra'
            ? Math.min(row.units, Math.max(0, activeCap - extraBeforeRefund.extraCreditsRemaining))
            : 0;
        const extraAfterRefund = extraBeforeRefund.extraCreditsRemaining + effectiveExtraRefund;

        const baseUsage = this.computeBaseBucketUsageInTx(
          db,
          row.user_id,
          row.bucket === 'playlist' ? 'playlist' : 'video',
          row.bucket === 'playlist' ? limits.playlistLimit : limits.individualLimit,
          nowMs
        );
        const balanceAfter =
          row.bucket === 'playlist' ? baseUsage.remaining : baseUsage.remaining + extraAfterRefund;

        db.prepare(
          `INSERT INTO credit_ledger
            (id, user_id, entry_type, delta, remaining_delta, balance_after, reference_id, reason, expires_at, expired_processed, created_at)
           VALUES (?, ?, 'CREDIT_RELEASED', ?, ?, ?, ?, ?, NULL, 0, ?)`
        ).run(
          generatePrefixedId('led'),
          row.user_id,
          row.source === 'extra' ? effectiveExtraRefund : row.units,
          effectiveExtraRefund,
          balanceAfter,
          row.reference_id ?? row.id,
          `Released ${row.source === 'extra' ? 'rewarded extra credit' : `${row.bucket} quota slot`}: ${reason}`,
          nowIso
        );

        this.syncEntitlementsSnapshotInTx(db, row.user_id, limits, extraAfterRefund, nowIso);
      }

      return {
        reservationId: row.id,
        userId: row.user_id,
        jobId: row.reference_id ?? undefined,
        idempotencyKey: row.idempotency_key ?? undefined,
        jobType: row.bucket === 'playlist' ? 'PLAYLIST_DOWNLOAD' : 'VIDEO_DOWNLOAD',
        bucket: row.bucket as QuotaBucket,
        cost: row.units,
        itemCount: 1,
        status: 'RELEASED',
        createdAt: Date.parse(row.created_at) || nowMs,
        expiresAt: Date.parse(row.expires_at) || nowMs,
        rolledBackAt: nowMs,
        rollbackReason: reason,
      };
    });
  }

  /**
   * Grants verified rewarded ad credits inside an existing SQLite transaction.
   * Appends immutable `REWARD_GRANTED` entry with rolling 24h expiration.
   */
  public grantRewardCreditsInTx(
    db: DatabaseSync,
    params: {
      userId: string;
      amount: number;
      rewardSessionId: string;
      expiryHours?: number;
      reason?: string;
      nowMs?: number;
    }
  ): {
    ledgerId: string;
    expiresAt: string;
    extraCreditsRemaining: number;
    totalAvailableIndividual: number;
  } {
    const nowMs = params.nowMs ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const policy = this.getPolicy(db);
    const expiryHours = Math.max(1, params.expiryHours ?? policy.rewardExpiryHours);
    const expiresAt = new Date(nowMs + expiryHours * 60 * 60 * 1000).toISOString();

    const limits = this.resolveTierLimits(params.userId, undefined, undefined, db);
    const extraBefore = this.evaluateExtraCreditsInTx(db, params.userId, nowMs, true);
    const videoBase = this.computeBaseBucketUsageInTx(
      db,
      params.userId,
      'video',
      limits.individualLimit,
      nowMs
    );

    const extraAfter = extraBefore.extraCreditsRemaining + params.amount;
    const totalAvailableAfter = videoBase.remaining + extraAfter;
    const ledgerId = generatePrefixedId('led');

    db.prepare(
      `INSERT INTO credit_ledger
        (id, user_id, entry_type, delta, remaining_delta, balance_after, reference_id, reason, expires_at, expired_processed, created_at)
       VALUES (?, ?, 'REWARD_GRANTED', ?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(
      ledgerId,
      params.userId,
      params.amount,
      params.amount,
      totalAvailableAfter,
      params.rewardSessionId,
      params.reason || `Verified rewarded advertisement (+${params.amount} individual credits)`,
      expiresAt,
      nowIso
    );

    this.syncEntitlementsSnapshotInTx(db, params.userId, limits, extraAfter, nowIso);

    return {
      ledgerId,
      expiresAt,
      extraCreditsRemaining: extraAfter,
      totalAvailableIndividual: totalAvailableAfter,
    };
  }

  /**
   * Appends an immutable `ADMIN_ADJUSTMENT` credit entry for a user.
   */
  public grantAdminAdjustment(params: {
    userId: string;
    delta: number;
    referenceId: string;
    reason: string;
    expiryHours?: number | null;
  }): { ledgerId: string; extraCreditsRemaining: number } {
    return runInTransaction((db) => {
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const limits = this.resolveTierLimits(params.userId, undefined, undefined, db);
      const extraBefore = this.evaluateExtraCreditsInTx(db, params.userId, nowMs, true);
      const videoBase = this.computeBaseBucketUsageInTx(
        db,
        params.userId,
        'video',
        limits.individualLimit,
        nowMs
      );
      const extraAfter = Math.max(0, extraBefore.extraCreditsRemaining + params.delta);
      const totalAvailableAfter = videoBase.remaining + extraAfter;
      const expiresAt =
        params.delta > 0 && params.expiryHours
          ? new Date(nowMs + params.expiryHours * 60 * 60 * 1000).toISOString()
          : null;
      const ledgerId = generatePrefixedId('led');

      db.prepare(
        `INSERT INTO credit_ledger
          (id, user_id, entry_type, delta, remaining_delta, balance_after, reference_id, reason, expires_at, expired_processed, created_at)
         VALUES (?, ?, 'ADMIN_ADJUSTMENT', ?, ?, ?, ?, ?, ?, 0, ?)`
      ).run(
        ledgerId,
        params.userId,
        params.delta,
        params.delta,
        totalAvailableAfter,
        params.referenceId,
        params.reason,
        expiresAt,
        nowIso
      );

      this.syncEntitlementsSnapshotInTx(db, params.userId, limits, extraAfter, nowIso);
      return { ledgerId, extraCreditsRemaining: extraAfter };
    });
  }

  /**
   * Returns paginated immutable `credit_ledger` entries for a user (running expiry sweep first).
   */
  public async getLedger(
    userId: string,
    options: { limit?: number; offset?: number; entryType?: CreditLedgerEntryType } = {}
  ): Promise<{ items: CreditLedgerRecord[]; total: number; limit: number; offset: number }> {
    const limit = Math.min(200, Math.max(1, Number(options.limit ?? 50)));
    const offset = Math.max(0, Number(options.offset ?? 0));

    return runInTransaction((db) => {
      const nowMs = Date.now();
      this.expireStaleReservationsInTx(db, userId, new Date(nowMs).toISOString());
      this.evaluateExtraCreditsInTx(db, userId, nowMs, true);

      const whereClause = options.entryType
        ? 'WHERE user_id = ? AND entry_type = ?'
        : 'WHERE user_id = ?';
      const queryParams = options.entryType ? [userId, options.entryType] : [userId];

      const countRow = db
        .prepare(`SELECT COUNT(*) AS cnt FROM credit_ledger ${whereClause}`)
        .get(...queryParams) as { cnt?: number } | undefined;
      const total = Number(countRow?.cnt ?? 0);

      const rows = db
        .prepare(
          `SELECT id, user_id, entry_type, delta, remaining_delta, balance_after, reference_id, reason, expires_at, created_at
           FROM credit_ledger
           ${whereClause}
           ORDER BY created_at DESC, rowid DESC
           LIMIT ? OFFSET ?`
        )
        .all(...queryParams, limit, offset) as Array<{
        id: string;
        user_id: string;
        entry_type: CreditLedgerEntryType;
        delta: number;
        remaining_delta: number;
        balance_after: number;
        reference_id: string | null;
        reason: string | null;
        expires_at: string | null;
        created_at: string;
      }>;

      const items: CreditLedgerRecord[] = rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        entryType: r.entry_type,
        delta: r.delta,
        remainingDelta: r.remaining_delta,
        balanceAfter: r.balance_after,
        referenceId: r.reference_id,
        reason: r.reason || r.entry_type,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
        // Backwards-compatible aliases
        timestamp: r.created_at,
        operation: r.reason || r.entry_type,
        change: r.delta,
      }));

      return { items, total, limit, offset };
    });
  }

  /**
   * Executes an operation with idempotency protection.
   */
  public async executeIdempotent<T>(
    key: string | undefined | null,
    userId: string,
    payload: unknown,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.engine.executeIdempotent<T>(key, userId, payload, fn);
  }
}

export const entitlementsService = new EntitlementsService();
