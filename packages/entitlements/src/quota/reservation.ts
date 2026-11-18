/**
 * @file reservation.ts
 * Atomic two-phase quota reservation, rollback, and concurrency-safe limit enforcement
 */

import type {
  QuotaReservation,
  ReserveJobParams,
  CanExecuteResult,
  QuotaSummary,
  UserRole,
  PlanTier,
  JobQuotaType,
  TierQuotaLimits,
} from '../types.js';
import { setTimeout } from 'node:timers';
import type { IEntitlementStorage } from '../storage/interfaces.js';
import { generateId } from '../auth/crypto.js';
import {
  getQuotaBucketForJobType,
  getTierLimits,
  getBucketLimit,
} from './rules.js';
import {
  evaluateSlidingWindow,
  buildBucketUsage,
  DEFAULT_WINDOW_MS,
} from './sliding-window.js';
import {
  QuotaExceededError,
  PlaylistSizeExceededError,
  ReservationNotFoundError,
  InvalidReservationStateError,
} from '../errors.js';
import { TransactionLedger } from '../ledger/ledger.js';

export class QuotaReservationManager {
  private readonly storage: IEntitlementStorage;
  private readonly ledger: TransactionLedger;
  private readonly windowMs: number;
  private readonly defaultTtlMs: number;
  private readonly tierOverrides?: Partial<Record<PlanTier, Partial<TierQuotaLimits>>>;

  constructor(
    storage: IEntitlementStorage,
    ledger: TransactionLedger,
    options?: {
      windowMs?: number;
      defaultTtlMs?: number;
      tierOverrides?: Partial<Record<PlanTier, Partial<TierQuotaLimits>>>;
    }
  ) {
    this.storage = storage;
    this.ledger = ledger;
    this.windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS;
    this.defaultTtlMs = options?.defaultTtlMs ?? 15 * 60 * 1000; // 15 minutes
    this.tierOverrides = options?.tierOverrides;
  }

  /**
   * Evaluates if a user can execute a job type without committing or holding a reservation.
   */
  public async canExecute(
    userId: string,
    tier: PlanTier,
    jobType: JobQuotaType,
    itemCount: number = 1,
    now: number = Date.now()
  ): Promise<CanExecuteResult> {
    const bucket = getQuotaBucketForJobType(jobType);
    const tierLimits = getTierLimits(tier, this.tierOverrides);

    // If bucket is 'none' (e.g. child task spawned by playlist job), it consumes zero independent quota
    if (bucket === 'none') {
      return {
        allowed: true,
        code: 'ALLOWED',
        bucket: 'none',
        limit: 999_999,
        used: 0,
        remaining: 999_999,
        resetsAt: null,
        resetInSeconds: 0,
      };
    }

    // Validate playlist item cap
    if (bucket === 'playlist') {
      const maxAllowedItems = tierLimits.maxPlaylistItems;
      if (itemCount > maxAllowedItems) {
        return {
          allowed: false,
          code: 'PLAYLIST_ITEM_LIMIT_EXCEEDED',
          reason: `Playlist item count (${itemCount}) exceeds the maximum allowed limit of ${maxAllowedItems} for ${tier} tier`,
          bucket,
          limit: tierLimits.playlistDailyLimit,
          used: 0,
          remaining: 0,
          resetsAt: null,
          resetInSeconds: 0,
        };
      }
    }

    // Unlimited bypass check (e.g. enterprise/admin)
    if (tierLimits.allowUnlimitedBypass) {
      return {
        allowed: true,
        code: 'ALLOWED',
        bucket,
        limit: 999_999,
        used: 0,
        remaining: 999_999,
        resetsAt: null,
        resetInSeconds: 0,
      };
    }

    const limit = getBucketLimit(bucket, tier, this.tierOverrides);
    const windowStart = now - this.windowMs;
    const timestamps = await this.storage.getActiveUsageTimestamps(userId, bucket, windowStart, now);
    const windowResult = evaluateSlidingWindow(timestamps, limit, this.windowMs, now);

    if (windowResult.remaining < 1) {
      return {
        allowed: false,
        code: 'QUOTA_EXCEEDED',
        reason: `${bucket.toUpperCase()} rolling daily limit reached (${windowResult.used}/${limit})`,
        bucket,
        limit,
        used: windowResult.used,
        remaining: 0,
        resetsAt: windowResult.resetsAt,
        resetInSeconds: windowResult.resetInSeconds,
      };
    }

    return {
      allowed: true,
      code: 'ALLOWED',
      bucket,
      limit,
      used: windowResult.used,
      remaining: windowResult.remaining,
      resetsAt: windowResult.resetsAt,
      resetInSeconds: windowResult.resetInSeconds,
    };
  }

  /**
   * Atomically reserve quota for a job with lock synchronization and idempotency protection.
   */
  public async reserveQuota(params: ReserveJobParams): Promise<QuotaReservation> {
    const tier = params.userTier || 'free';
    const jobType = params.jobType;
    const bucket = getQuotaBucketForJobType(jobType);
    const itemCount = params.itemCount || 1;
    const now = Date.now();
    const lockKey = `lock:quota:${params.userId}:${bucket}`;

    // Acquire atomic per-user per-bucket lock
    const lockToken = await this.acquireUserLock(lockKey, 5000);

    try {
      // 1. Idempotency Check: if idempotencyKey was provided, check if already reserved
      if (params.idempotencyKey) {
        const existing = await this.storage.getReservationByIdempotencyKey(params.userId, params.idempotencyKey);
        if (existing) {
          if (existing.status === 'PENDING' || existing.status === 'COMMITTED') {
            return existing;
          }
        }
      }

      // 2. Validate Playlist Item Limits
      const tierLimits = getTierLimits(tier, this.tierOverrides);
      if (bucket === 'playlist' && itemCount > tierLimits.maxPlaylistItems) {
        throw new PlaylistSizeExceededError(itemCount, tierLimits.maxPlaylistItems);
      }

      // 3. Check Quota Availability
      const evalResult = await this.canExecute(params.userId, tier, jobType, itemCount, now);
      if (!evalResult.allowed) {
        throw new QuotaExceededError({
          bucket,
          limit: evalResult.limit,
          used: evalResult.used,
          resetsAt: evalResult.resetsAt,
          resetInSeconds: evalResult.resetInSeconds,
          message: evalResult.reason,
        });
      }

      // 4. Create and persist reservation
      const ttlMs = params.ttlMs ?? this.defaultTtlMs;
      const reservationId = generateId('res');
      const reservation: QuotaReservation = {
        reservationId,
        userId: params.userId,
        jobId: params.jobId,
        idempotencyKey: params.idempotencyKey,
        jobType,
        bucket,
        cost: 1,
        itemCount,
        status: 'PENDING',
        createdAt: now,
        expiresAt: now + ttlMs,
        metadata: params.metadata,
      };

      await this.storage.saveReservation(reservation);

      // 5. Append to transaction ledger
      await this.ledger.recordQuotaEvent({
        userId: params.userId,
        action: 'QUOTA_RESERVE',
        bucket,
        amount: 1,
        balanceAfter: evalResult.used + 1,
        reservationId,
        jobId: params.jobId,
        idempotencyKey: params.idempotencyKey,
        reason: `Reserved 1 slot for ${jobType} (${itemCount} item(s))`,
        metadata: params.metadata,
      });

      return reservation;
    } finally {
      if (lockToken) {
        await this.storage.releaseLock(lockKey, lockToken);
      }
    }
  }

  /**
   * Commit a previously reserved quota upon successful job dispatch or completion.
   */
  public async commitQuota(reservationId: string): Promise<QuotaReservation> {
    const reservation = await this.storage.getReservation(reservationId);
    if (!reservation) {
      throw new ReservationNotFoundError(reservationId);
    }

    if (reservation.status === 'COMMITTED' || reservation.status === 'CONSUMED') {
      return reservation; // Idempotent success
    }

    if (
      reservation.status === 'ROLLED_BACK' ||
      reservation.status === 'RELEASED' ||
      reservation.status === 'EXPIRED'
    ) {
      throw new InvalidReservationStateError(reservationId, reservation.status, 'commit');
    }

    const now = Date.now();
    const updated = await this.storage.updateReservationStatus(reservationId, 'COMMITTED', {
      committedAt: now,
    });

    // Record in transaction ledger
    await this.ledger.recordQuotaEvent({
      userId: reservation.userId,
      action: 'QUOTA_COMMIT',
      bucket: reservation.bucket,
      amount: 1,
      balanceAfter: 0,
      reservationId,
      jobId: reservation.jobId,
      idempotencyKey: reservation.idempotencyKey,
      reason: `Committed quota slot for reservation ${reservationId}`,
    });

    return updated;
  }

  /**
   * Roll back a reserved or committed quota upon job cancellation or execution failure.
   * Immediately restores user's quota.
   */
  public async rollbackQuota(reservationIdOrJobId: string, reason: string = 'Job failed or cancelled'): Promise<QuotaReservation> {
    let reservation = await this.storage.getReservation(reservationIdOrJobId);
    if (!reservation) {
      reservation = await this.storage.getReservationByJobId(reservationIdOrJobId);
    }

    if (!reservation) {
      throw new ReservationNotFoundError(reservationIdOrJobId);
    }

    if (reservation.status === 'ROLLED_BACK' || reservation.status === 'RELEASED') {
      return reservation; // Idempotent rollback
    }

    const now = Date.now();
    const updated = await this.storage.updateReservationStatus(reservation.reservationId, 'ROLLED_BACK', {
      rolledBackAt: now,
      rollbackReason: reason,
    });

    // Record in transaction ledger
    await this.ledger.recordQuotaEvent({
      userId: reservation.userId,
      action: 'QUOTA_ROLLBACK',
      bucket: reservation.bucket,
      amount: -1,
      balanceAfter: 0,
      reservationId: reservation.reservationId,
      jobId: reservation.jobId,
      idempotencyKey: reservation.idempotencyKey,
      reason,
    });

    return updated;
  }

  /**
   * Get comprehensive quota summary and honest countdown timers for UI dashboard.
   */
  public async getQuotaSummary(
    userId: string,
    tier: PlanTier = 'free',
    role: UserRole = 'free',
    now: number = Date.now()
  ): Promise<QuotaSummary> {
    const windowStart = now - this.windowMs;
    const tierLimits = getTierLimits(tier, this.tierOverrides);

    // Fetch video timestamps
    const videoTimestamps = await this.storage.getActiveUsageTimestamps(userId, 'video', windowStart, now);
    const videoPending = await this.storage.getActivePendingReservations(userId, 'video', now);
    const videoUsage = buildBucketUsage(
      'video',
      videoTimestamps,
      tierLimits.videoDailyLimit,
      videoPending.length,
      this.windowMs,
      undefined,
      now
    );

    // Fetch playlist timestamps
    const playlistTimestamps = await this.storage.getActiveUsageTimestamps(userId, 'playlist', windowStart, now);
    const playlistPending = await this.storage.getActivePendingReservations(userId, 'playlist', now);
    const playlistUsage = buildBucketUsage(
      'playlist',
      playlistTimestamps,
      tierLimits.playlistDailyLimit,
      playlistPending.length,
      this.windowMs,
      tierLimits.maxPlaylistItems,
      now
    );

    // Credit balance
    const creditBalance = await this.storage.getCreditBalance(userId);

    return {
      userId,
      tier,
      role,
      evaluatedAt: now,
      buckets: {
        video: videoUsage,
        playlist: playlistUsage,
      },
      credits: {
        balance: creditBalance,
        currency: 'CREDITS',
      },
    };
  }

  /**
   * Acquire a lock with retry loop.
   */
  private async acquireUserLock(lockKey: string, ttlMs: number): Promise<string | null> {
    const maxRetries = 10;
    const delayMs = 50;

    for (let i = 0; i < maxRetries; i++) {
      const token = await this.storage.acquireLock(lockKey, ttlMs);
      if (token) return token;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return null;
  }
}
