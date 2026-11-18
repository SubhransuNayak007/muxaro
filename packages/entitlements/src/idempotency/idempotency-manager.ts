/**
 * @file idempotency-manager.ts
 * Server-side idempotency key checking to prevent double-charging and duplicate jobs
 */

import type { IdempotencyRecord } from '../types.js';
import type { IEntitlementStorage } from '../storage/interfaces.js';
import { hashRequestPayload } from '../auth/crypto.js';
import { IdempotencyConflictError, IdempotencyProcessingError } from '../errors.js';

export interface IdempotencyAcquireResult<T = unknown> {
  isNew: boolean;
  completed: boolean;
  response?: T;
  record: IdempotencyRecord<T>;
}

export interface AcquireIdempotencyOptions {
  jobId?: string;
  reservationId?: string;
  ttlMs?: number; // Default 24 hours (86,400,000 ms)
}

export class IdempotencyManager {
  private readonly storage: IEntitlementStorage;
  private readonly defaultTtlMs: number;

  constructor(storage: IEntitlementStorage, options?: { defaultTtlMs?: number }) {
    this.storage = storage;
    this.defaultTtlMs = options?.defaultTtlMs ?? 24 * 60 * 60 * 1000; // 24 hours
  }

  /**
   * Acquire or evaluate an idempotency key before performing an operation.
   */
  public async acquire<T = unknown>(
    key: string,
    userId: string,
    requestPayload: unknown,
    options: AcquireIdempotencyOptions = {}
  ): Promise<IdempotencyAcquireResult<T>> {
    if (!key || typeof key !== 'string') {
      throw new Error('Valid idempotency key string is required');
    }

    const requestHash = hashRequestPayload(requestPayload);
    const existing = await this.storage.getIdempotencyRecord<T>(key, userId);
    const now = Date.now();

    if (existing) {
      // Validate that request payload matches original request
      if (existing.requestHash !== requestHash) {
        throw new IdempotencyConflictError(
          key,
          `Idempotency key '${key}' was already used with a different request payload.`
        );
      }

      // If already completed, return cached response directly
      if (existing.status === 'COMPLETED') {
        return {
          isNew: false,
          completed: true,
          response: existing.response,
          record: existing,
        };
      }

      // If currently processing, prevent concurrent double execution
      if (existing.status === 'PROCESSING') {
        // If it has been processing for longer than 60 seconds, treat as stalled/failed and allow retry
        const processingAge = now - existing.lastUpdatedAt;
        if (processingAge < 60_000) {
          throw new IdempotencyProcessingError(
            key,
            `A request with idempotency key '${key}' is currently being processed. Please retry shortly.`
          );
        }
      }
    }

    // Register new processing record
    const ttlMs = options.ttlMs ?? this.defaultTtlMs;
    const newRecord: IdempotencyRecord<T> = {
      key,
      userId,
      requestHash,
      status: 'PROCESSING',
      jobId: options.jobId,
      reservationId: options.reservationId,
      createdAt: existing ? existing.createdAt : now,
      expiresAt: now + ttlMs,
      lastUpdatedAt: now,
    };

    await this.storage.saveIdempotencyRecord(newRecord);

    return {
      isNew: true,
      completed: false,
      record: newRecord,
    };
  }

  /**
   * Complete an idempotency transaction and store the resulting response.
   */
  public async complete<T = unknown>(
    key: string,
    userId: string,
    response: T,
    options?: { jobId?: string; reservationId?: string }
  ): Promise<void> {
    const existing = await this.storage.getIdempotencyRecord<T>(key, userId);
    const now = Date.now();

    const record: IdempotencyRecord<T> = {
      key,
      userId,
      requestHash: existing?.requestHash || hashRequestPayload(response),
      status: 'COMPLETED',
      response,
      jobId: options?.jobId ?? existing?.jobId,
      reservationId: options?.reservationId ?? existing?.reservationId,
      createdAt: existing?.createdAt || now,
      expiresAt: existing?.expiresAt || now + this.defaultTtlMs,
      lastUpdatedAt: now,
    };

    await this.storage.saveIdempotencyRecord(record);
  }

  /**
   * Mark an idempotency transaction as failed, allowing client to retry.
   */
  public async fail(key: string, userId: string, removeOnFail: boolean = true): Promise<void> {
    if (removeOnFail) {
      await this.storage.deleteIdempotencyRecord(key, userId);
      return;
    }

    const existing = await this.storage.getIdempotencyRecord(key, userId);
    if (existing) {
      existing.status = 'FAILED';
      existing.lastUpdatedAt = Date.now();
      await this.storage.saveIdempotencyRecord(existing);
    }
  }

  /**
   * Execute an operation idempotently. If key is omitted, simply runs fn().
   */
  public async executeIdempotent<T>(
    key: string | undefined | null,
    userId: string,
    requestPayload: unknown,
    fn: () => Promise<T>,
    options?: AcquireIdempotencyOptions
  ): Promise<T> {
    if (!key) {
      return fn();
    }

    const acquireResult = await this.acquire<T>(key, userId, requestPayload, options);
    if (!acquireResult.isNew && acquireResult.completed) {
      return acquireResult.response as T;
    }

    try {
      const result = await fn();
      await this.complete(key, userId, result, options);
      return result;
    } catch (err) {
      await this.fail(key, userId, true);
      throw err;
    }
  }
}
