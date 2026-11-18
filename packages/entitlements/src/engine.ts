/**
 * @file engine.ts
 * Unified EntitlementsEngine orchestrating Authentication, Quota Enforcement, Idempotency, and Ledger
 */

import type {
  EntitlementsEngineOptions,
  Session,
  User,
  UserRole,
  PlanTier,
  Permission,
  JobQuotaType,
  QuotaReservation,
  ReserveJobParams,
  CanExecuteResult,
  QuotaSummary,
  LedgerEntry,
  LedgerQueryOptions,
  LedgerHistoryResult,
} from './types.js';
import type { IEntitlementStorage } from './storage/interfaces.js';
import { InMemoryEntitlementStore } from './storage/in-memory-store.js';
import { SessionManager, type CreateSessionOptions } from './auth/session.js';
import { hasPermission, requirePermission, isRoleAtLeast, requireRole } from './auth/rbac.js';
import { IdempotencyManager, type AcquireIdempotencyOptions } from './idempotency/idempotency-manager.js';
import { TransactionLedger } from './ledger/ledger.js';
import { QuotaReservationManager } from './quota/reservation.js';

export class EntitlementsEngine {
  public readonly storage: IEntitlementStorage;
  public readonly sessions: SessionManager;
  public readonly idempotency: IdempotencyManager;
  public readonly ledger: TransactionLedger;
  public readonly reservations: QuotaReservationManager;

  constructor(storage?: IEntitlementStorage, options?: EntitlementsEngineOptions) {
    this.storage = storage ?? new InMemoryEntitlementStore();
    this.sessions = new SessionManager({
      secret: options?.sessionSecret,
      defaultTtlMs: options?.sessionTtlMs,
    });
    this.idempotency = new IdempotencyManager(this.storage, {
      defaultTtlMs: options?.idempotencyTtlMs,
    });
    this.ledger = new TransactionLedger(this.storage);
    this.reservations = new QuotaReservationManager(this.storage, this.ledger, {
      windowMs: options?.windowMs,
      defaultTtlMs: options?.defaultReservationTtlMs,
      tierOverrides: options?.tierOverrides,
    });
  }

  // ==========================================
  // Session & Authentication Operations
  // ==========================================

  public async createSession(options: CreateSessionOptions = {}): Promise<{ session: Session; token: string }> {
    const { session, token } = this.sessions.createSession(options);
    await this.storage.saveSession(session);
    return { session, token };
  }

  public async createAnonymousSession(
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ session: Session; token: string }> {
    const { session, token } = this.sessions.createAnonymousSession(ipAddress, userAgent);
    await this.storage.saveSession(session);
    return { session, token };
  }

  public async authenticateToken(token: string): Promise<Session> {
    const sessionId = this.sessions.parseAndVerifyToken(token);
    const session = await this.storage.getSession(sessionId);
    const valid = this.sessions.validateSession(session);
    // Touch session activity
    await this.storage.touchSession(sessionId, Date.now());
    return valid;
  }

  public async revokeSession(sessionId: string): Promise<boolean> {
    return this.storage.deleteSession(sessionId);
  }

  public sessionToUser(session: Session): User {
    return this.sessions.sessionToUser(session);
  }

  public checkPermission(role: UserRole, permission: Permission): boolean {
    return hasPermission(role, permission);
  }

  public requirePermission(role: UserRole, permission: Permission): void {
    requirePermission(role, permission);
  }

  public isRoleAtLeast(userRole: UserRole, minimumRole: UserRole): boolean {
    return isRoleAtLeast(userRole, minimumRole);
  }

  public requireRole(userRole: UserRole, minimumRole: UserRole): void {
    requireRole(userRole, minimumRole);
  }

  // ==========================================
  // Quota & Entitlement Operations
  // ==========================================

  public async getQuotaSummary(
    userId: string,
    tier: PlanTier = 'free',
    role: UserRole = 'free',
    now?: number
  ): Promise<QuotaSummary> {
    return this.reservations.getQuotaSummary(userId, tier, role, now);
  }

  public async canExecuteJob(
    userId: string,
    tier: PlanTier,
    jobType: JobQuotaType,
    itemCount?: number,
    now?: number
  ): Promise<CanExecuteResult> {
    return this.reservations.canExecute(userId, tier, jobType, itemCount, now);
  }

  public async reserveJobQuota(params: ReserveJobParams): Promise<QuotaReservation> {
    return this.reservations.reserveQuota(params);
  }

  public async commitJobQuota(reservationId: string): Promise<QuotaReservation> {
    return this.reservations.commitQuota(reservationId);
  }

  public async rollbackJobQuota(
    reservationIdOrJobId: string,
    reason: string = 'Job failed or cancelled'
  ): Promise<QuotaReservation> {
    return this.reservations.rollbackQuota(reservationIdOrJobId, reason);
  }

  // ==========================================
  // Idempotency Operations
  // ==========================================

  public async executeIdempotent<T>(
    key: string | undefined | null,
    userId: string,
    requestPayload: unknown,
    fn: () => Promise<T>,
    options?: AcquireIdempotencyOptions
  ): Promise<T> {
    return this.idempotency.executeIdempotent<T>(key, userId, requestPayload, fn, options);
  }

  // ==========================================
  // Ledger & Credit Operations
  // ==========================================

  public async getLedgerHistory(userId: string, options: LedgerQueryOptions = {}): Promise<LedgerHistoryResult> {
    return this.ledger.getHistory(userId, options);
  }

  public async getCreditBalance(userId: string): Promise<number> {
    return this.ledger.getCreditBalance(userId);
  }

  public async grantCredits(
    userId: string,
    amount: number,
    reason: string,
    metadata?: Record<string, unknown>
  ): Promise<LedgerEntry> {
    return this.ledger.grantCredits({
      userId,
      action: 'CREDIT_GRANT',
      amount,
      reason,
      metadata,
    });
  }

  public async debitCredits(
    userId: string,
    amount: number,
    reason: string,
    metadata?: Record<string, unknown>
  ): Promise<LedgerEntry> {
    return this.ledger.debitCredits({
      userId,
      action: 'CREDIT_DEBIT',
      amount,
      reason,
      metadata,
    });
  }

  public async refundCredits(
    userId: string,
    amount: number,
    reason: string,
    metadata?: Record<string, unknown>
  ): Promise<LedgerEntry> {
    return this.ledger.refundCredits({
      userId,
      action: 'CREDIT_REFUND',
      amount,
      reason,
      metadata,
    });
  }
}
