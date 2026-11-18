/**
 * @file in-memory-store.ts
 * Robust, concurrency-safe in-memory implementation of IEntitlementStorage
 */

import type {
  Session,
  QuotaReservation,
  ReservationStatus,
  QuotaBucket,
  IdempotencyRecord,
  LedgerEntry,
  LedgerQueryOptions,
  LedgerHistoryResult,
} from '../types.js';
import type { IEntitlementStorage } from './interfaces.js';
import { generateSecureToken } from '../auth/crypto.js';
import { ReservationNotFoundError } from '../errors.js';

interface LockRecord {
  token: string;
  expiresAt: number;
}

export class InMemoryEntitlementStore implements IEntitlementStorage {
  private sessions = new Map<string, Session>();
  private reservations = new Map<string, QuotaReservation>();
  private idempotency = new Map<string, IdempotencyRecord<unknown>>();
  private ledger = new Map<string, LedgerEntry[]>();
  private userSequences = new Map<string, number>();
  private credits = new Map<string, number>();
  private locks = new Map<string, LockRecord>();

  // ==========================================
  // Session Operations
  // ==========================================

  public async saveSession(session: Session): Promise<void> {
    this.sessions.set(session.sessionId, { ...session });
  }

  public async getSession(sessionId: string): Promise<Session | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (Date.now() >= session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }
    return { ...session };
  }

  public async deleteSession(sessionId: string): Promise<boolean> {
    return this.sessions.delete(sessionId);
  }

  public async touchSession(sessionId: string, lastActiveAt: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActiveAt = lastActiveAt;
    }
  }

  // ==========================================
  // Reservation Operations
  // ==========================================

  public async saveReservation(res: QuotaReservation): Promise<void> {
    this.reservations.set(res.reservationId, { ...res });
  }

  public async getReservation(reservationId: string): Promise<QuotaReservation | null> {
    const res = this.reservations.get(reservationId);
    if (!res) return null;
    return { ...res };
  }

  public async getReservationByIdempotencyKey(userId: string, idempotencyKey: string): Promise<QuotaReservation | null> {
    for (const res of this.reservations.values()) {
      if (res.userId === userId && res.idempotencyKey === idempotencyKey) {
        return { ...res };
      }
    }
    return null;
  }

  public async getReservationByJobId(jobId: string): Promise<QuotaReservation | null> {
    for (const res of this.reservations.values()) {
      if (res.jobId === jobId) {
        return { ...res };
      }
    }
    return null;
  }

  public async updateReservationStatus(
    reservationId: string,
    status: ReservationStatus,
    details?: { committedAt?: number; rolledBackAt?: number; rollbackReason?: string }
  ): Promise<QuotaReservation> {
    const res = this.reservations.get(reservationId);
    if (!res) {
      throw new ReservationNotFoundError(reservationId);
    }

    res.status = status;
    if (details?.committedAt) res.committedAt = details.committedAt;
    if (details?.rolledBackAt) res.rolledBackAt = details.rolledBackAt;
    if (details?.rollbackReason) res.rollbackReason = details.rollbackReason;

    this.reservations.set(reservationId, res);
    return { ...res };
  }

  public async getActiveUsageTimestamps(
    userId: string,
    bucket: QuotaBucket,
    windowStartMs: number,
    nowMs: number
  ): Promise<number[]> {
    const timestamps: number[] = [];

    // Expire any timed out pending reservations first
    await this.expirePendingReservations(nowMs);

    for (const res of this.reservations.values()) {
      // Must match user and bucket
      if (res.userId !== userId || res.bucket !== bucket) {
        continue;
      }

      // If committed/consumed, count against window if committedAt is within window
      if ((res.status === 'COMMITTED' || res.status === 'CONSUMED') && res.committedAt) {
        if (res.committedAt > windowStartMs && res.committedAt <= nowMs) {
          timestamps.push(res.committedAt);
        }
      }

      // If pending/reserved and unexpired, it holds a slot currently
      if ((res.status === 'PENDING' || res.status === 'RESERVED') && res.expiresAt > nowMs) {
        if (res.createdAt > windowStartMs) {
          timestamps.push(res.createdAt);
        }
      }

      // ROLLED_BACK, RELEASED and EXPIRED reservations NEVER consume quota slots!
    }

    return timestamps.sort((a, b) => a - b);
  }

  public async getActivePendingReservations(
    userId: string,
    bucket: QuotaBucket,
    nowMs: number
  ): Promise<QuotaReservation[]> {
    const list: QuotaReservation[] = [];
    for (const res of this.reservations.values()) {
      if (res.userId === userId && res.bucket === bucket && (res.status === 'PENDING' || res.status === 'RESERVED') && res.expiresAt > nowMs) {
        list.push({ ...res });
      }
    }
    return list;
  }

  public async expirePendingReservations(nowMs: number): Promise<QuotaReservation[]> {
    const expired: QuotaReservation[] = [];
    for (const res of this.reservations.values()) {
      if ((res.status === 'PENDING' || res.status === 'RESERVED') && res.expiresAt <= nowMs) {
        res.status = 'EXPIRED';
        res.rolledBackAt = nowMs;
        res.rollbackReason = 'Reservation TTL expired without commitment';
        expired.push({ ...res });
      }
    }
    return expired;
  }

  // ==========================================
  // Idempotency Operations
  // ==========================================

  private getIdempotencyCompositeKey(key: string, userId: string): string {
    return `${userId}:${key}`;
  }

  public async getIdempotencyRecord<T = unknown>(key: string, userId: string): Promise<IdempotencyRecord<T> | null> {
    const compositeKey = this.getIdempotencyCompositeKey(key, userId);
    const record = this.idempotency.get(compositeKey);
    if (!record) return null;
    if (Date.now() >= record.expiresAt) {
      this.idempotency.delete(compositeKey);
      return null;
    }
    return { ...record } as IdempotencyRecord<T>;
  }

  public async saveIdempotencyRecord<T = unknown>(record: IdempotencyRecord<T>): Promise<void> {
    const compositeKey = this.getIdempotencyCompositeKey(record.key, record.userId);
    this.idempotency.set(compositeKey, { ...record } as IdempotencyRecord<unknown>);
  }

  public async deleteIdempotencyRecord(key: string, userId: string): Promise<boolean> {
    const compositeKey = this.getIdempotencyCompositeKey(key, userId);
    return this.idempotency.delete(compositeKey);
  }

  // ==========================================
  // Transaction Ledger Operations
  // ==========================================

  public async getNextSequenceNumber(userId: string): Promise<number> {
    const current = this.userSequences.get(userId) || 0;
    const next = current + 1;
    this.userSequences.set(userId, next);
    return next;
  }

  public async appendLedgerEntry(entry: LedgerEntry): Promise<void> {
    const list = this.ledger.get(entry.userId) || [];
    list.push({ ...entry });
    this.ledger.set(entry.userId, list);
  }

  public async queryLedger(userId: string, options: LedgerQueryOptions = {}): Promise<LedgerHistoryResult> {
    let list = this.ledger.get(userId) || [];

    // Filter by bucket if specified
    if (options.bucket) {
      list = list.filter((e) => e.bucket === options.bucket);
    }

    // Filter by action if specified
    if (options.action) {
      list = list.filter((e) => e.action === options.action);
    }

    // Filter by time range
    if (options.since !== undefined) {
      list = list.filter((e) => e.timestamp >= options.since!);
    }
    if (options.until !== undefined) {
      list = list.filter((e) => e.timestamp <= options.until!);
    }

    // Sort descending by sequenceNumber / timestamp (newest first)
    const sorted = [...list].sort((a, b) => b.sequenceNumber - a.sequenceNumber);
    const totalCount = sorted.length;

    const offset = options.offset || 0;
    const limit = options.limit !== undefined ? options.limit : 50;
    const paginated = sorted.slice(offset, offset + limit);
    const hasMore = offset + paginated.length < totalCount;

    return {
      totalCount,
      entries: paginated,
      hasMore,
    };
  }

  // ==========================================
  // Credit Operations
  // ==========================================

  public async getCreditBalance(userId: string): Promise<number> {
    return this.credits.get(userId) || 0;
  }

  public async adjustCreditBalance(userId: string, delta: number): Promise<number> {
    const current = this.credits.get(userId) || 0;
    const updated = Math.max(0, current + delta);
    this.credits.set(userId, updated);
    return updated;
  }

  // ==========================================
  // Concurrency Locking
  // ==========================================

  public async acquireLock(resourceKey: string, ttlMs: number = 5000): Promise<string | null> {
    const now = Date.now();
    const existing = this.locks.get(resourceKey);

    if (existing && existing.expiresAt > now) {
      return null; // Lock is currently held
    }

    const token = generateSecureToken(16);
    this.locks.set(resourceKey, {
      token,
      expiresAt: now + ttlMs,
    });
    return token;
  }

  public async releaseLock(resourceKey: string, lockToken: string): Promise<boolean> {
    const existing = this.locks.get(resourceKey);
    if (!existing) return true;
    if (existing.token === lockToken) {
      this.locks.delete(resourceKey);
      return true;
    }
    return false;
  }

  public async clearAll(): Promise<void> {
    this.sessions.clear();
    this.reservations.clear();
    this.idempotency.clear();
    this.ledger.clear();
    this.userSequences.clear();
    this.credits.clear();
    this.locks.clear();
  }
}
