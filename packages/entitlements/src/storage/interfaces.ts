/**
 * @file interfaces.ts
 * Storage interface abstractions for sessions, quotas, reservations, ledger, and concurrency locks
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

export interface IEntitlementStorage {
  // Session operations
  saveSession(session: Session): Promise<void>;
  getSession(sessionId: string): Promise<Session | null>;
  deleteSession(sessionId: string): Promise<boolean>;
  touchSession(sessionId: string, lastActiveAt: number): Promise<void>;

  // Reservation operations
  saveReservation(res: QuotaReservation): Promise<void>;
  getReservation(reservationId: string): Promise<QuotaReservation | null>;
  getReservationByIdempotencyKey(userId: string, idempotencyKey: string): Promise<QuotaReservation | null>;
  getReservationByJobId(jobId: string): Promise<QuotaReservation | null>;
  updateReservationStatus(
    reservationId: string,
    status: ReservationStatus,
    details?: { committedAt?: number; rolledBackAt?: number; rollbackReason?: string }
  ): Promise<QuotaReservation>;
  getActiveUsageTimestamps(userId: string, bucket: QuotaBucket, windowStartMs: number, nowMs: number): Promise<number[]>;
  getActivePendingReservations(userId: string, bucket: QuotaBucket, nowMs: number): Promise<QuotaReservation[]>;
  expirePendingReservations(nowMs: number): Promise<QuotaReservation[]>;

  // Idempotency operations
  getIdempotencyRecord<T = unknown>(key: string, userId: string): Promise<IdempotencyRecord<T> | null>;
  saveIdempotencyRecord<T = unknown>(record: IdempotencyRecord<T>): Promise<void>;
  deleteIdempotencyRecord(key: string, userId: string): Promise<boolean>;

  // Transaction Ledger operations
  appendLedgerEntry(entry: LedgerEntry): Promise<void>;
  queryLedger(userId: string, options?: LedgerQueryOptions): Promise<LedgerHistoryResult>;
  getNextSequenceNumber(userId: string): Promise<number>;

  // Credit operations
  getCreditBalance(userId: string): Promise<number>;
  adjustCreditBalance(userId: string, delta: number): Promise<number>;

  // Concurrency Locking
  acquireLock(resourceKey: string, ttlMs?: number): Promise<string | null>;
  releaseLock(resourceKey: string, lockToken: string): Promise<boolean>;

  // Lifecycle
  clearAll?(): Promise<void>;
}
