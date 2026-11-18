/**
 * @file ledger.ts
 * Append-only transactional ledger for quota events, audit tracking, and credit accounting
 */

import type {
  LedgerEntry,
  LedgerAction,
  QuotaBucket,
  LedgerQueryOptions,
  LedgerHistoryResult,
} from '../types.js';
import type { IEntitlementStorage } from '../storage/interfaces.js';
import { generateId } from '../auth/crypto.js';

export interface RecordQuotaEventParams {
  userId: string;
  action: LedgerAction;
  bucket: QuotaBucket;
  amount: number;
  balanceAfter: number;
  reservationId?: string;
  jobId?: string;
  idempotencyKey?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface RecordCreditEventParams {
  userId: string;
  action: 'CREDIT_GRANT' | 'CREDIT_DEBIT' | 'CREDIT_REFUND' | 'ADMIN_ADJUSTMENT';
  amount: number;
  reason: string;
  idempotencyKey?: string;
  jobId?: string;
  metadata?: Record<string, unknown>;
}

export class TransactionLedger {
  private readonly storage: IEntitlementStorage;

  constructor(storage: IEntitlementStorage) {
    this.storage = storage;
  }

  /**
   * Append an immutable quota lifecycle event to the user's ledger.
   */
  public async recordQuotaEvent(params: RecordQuotaEventParams): Promise<LedgerEntry> {
    const seq = await this.storage.getNextSequenceNumber(params.userId);
    const entry: LedgerEntry = {
      id: generateId('tx'),
      sequenceNumber: seq,
      userId: params.userId,
      action: params.action,
      bucket: params.bucket,
      amount: params.amount,
      balanceAfter: params.balanceAfter,
      reservationId: params.reservationId,
      jobId: params.jobId,
      idempotencyKey: params.idempotencyKey,
      reason: params.reason,
      timestamp: Date.now(),
      metadata: params.metadata,
    };

    await this.storage.appendLedgerEntry(entry);
    return entry;
  }

  /**
   * Credit operation: Grant credits to a user balance.
   */
  public async grantCredits(params: RecordCreditEventParams): Promise<LedgerEntry> {
    const newBalance = await this.storage.adjustCreditBalance(params.userId, Math.abs(params.amount));
    const seq = await this.storage.getNextSequenceNumber(params.userId);

    const entry: LedgerEntry = {
      id: generateId('tx_crd'),
      sequenceNumber: seq,
      userId: params.userId,
      action: params.action,
      bucket: 'video',
      amount: Math.abs(params.amount),
      balanceAfter: newBalance,
      idempotencyKey: params.idempotencyKey,
      jobId: params.jobId,
      reason: params.reason,
      timestamp: Date.now(),
      metadata: params.metadata,
    };

    await this.storage.appendLedgerEntry(entry);
    return entry;
  }

  /**
   * Credit operation: Debit credits from a user balance.
   */
  public async debitCredits(params: RecordCreditEventParams): Promise<LedgerEntry> {
    const currentBalance = await this.storage.getCreditBalance(params.userId);
    if (currentBalance < params.amount) {
      throw new Error(`Insufficient credits: balance is ${currentBalance}, required ${params.amount}`);
    }

    const newBalance = await this.storage.adjustCreditBalance(params.userId, -Math.abs(params.amount));
    const seq = await this.storage.getNextSequenceNumber(params.userId);

    const entry: LedgerEntry = {
      id: generateId('tx_crd'),
      sequenceNumber: seq,
      userId: params.userId,
      action: params.action,
      bucket: 'video',
      amount: -Math.abs(params.amount),
      balanceAfter: newBalance,
      idempotencyKey: params.idempotencyKey,
      jobId: params.jobId,
      reason: params.reason,
      timestamp: Date.now(),
      metadata: params.metadata,
    };

    await this.storage.appendLedgerEntry(entry);
    return entry;
  }

  /**
   * Credit operation: Refund credits to a user balance.
   */
  public async refundCredits(params: RecordCreditEventParams): Promise<LedgerEntry> {
    return this.grantCredits({
      ...params,
      action: 'CREDIT_REFUND',
    });
  }

  /**
   * Get current credit balance for a user.
   */
  public async getCreditBalance(userId: string): Promise<number> {
    return this.storage.getCreditBalance(userId);
  }

  /**
   * Query transparent audit and credit transaction history.
   */
  public async getHistory(userId: string, options: LedgerQueryOptions = {}): Promise<LedgerHistoryResult> {
    return this.storage.queryLedger(userId, options);
  }
}
