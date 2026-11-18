/**
 * @file errors.ts
 * Strongly-typed domain errors for @vyro/entitlements
 */

import type { QuotaBucket } from './types.js';

export class EntitlementError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code: string, status: number = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class QuotaExceededError extends EntitlementError {
  public readonly bucket: QuotaBucket;
  public readonly limit: number;
  public readonly used: number;
  public readonly resetsAt: number | null;
  public readonly resetInSeconds: number;

  constructor(params: {
    bucket: QuotaBucket;
    limit: number;
    used: number;
    resetsAt: number | null;
    resetInSeconds: number;
    message?: string;
  }) {
    const defaultMsg =
      params.bucket === 'playlist'
        ? `Playlist daily quota exceeded: ${params.used}/${params.limit} jobs used in rolling 24h. Reset in ${params.resetInSeconds}s.`
        : `Video daily quota exceeded: ${params.used}/${params.limit} jobs used in rolling 24h. Reset in ${params.resetInSeconds}s.`;

    super(params.message ?? defaultMsg, 'QUOTA_EXCEEDED', 429, {
      bucket: params.bucket,
      limit: params.limit,
      used: params.used,
      resetsAt: params.resetsAt,
      resetInSeconds: params.resetInSeconds,
    });

    this.bucket = params.bucket;
    this.limit = params.limit;
    this.used = params.used;
    this.resetsAt = params.resetsAt;
    this.resetInSeconds = params.resetInSeconds;
  }
}

export class PlaylistSizeExceededError extends EntitlementError {
  public readonly maxItems: number;
  public readonly requestedItems: number;

  constructor(requestedItems: number, maxItems: number) {
    super(
      `Playlist contains ${requestedItems} items, exceeding the maximum allowed limit of ${maxItems} items for this tier.`,
      'PLAYLIST_SIZE_EXCEEDED',
      400,
      { requestedItems, maxItems }
    );
    this.maxItems = maxItems;
    this.requestedItems = requestedItems;
  }
}

export class IdempotencyConflictError extends EntitlementError {
  public readonly key: string;

  constructor(key: string, message: string = 'Idempotency key reused with different request payload') {
    super(message, 'IDEMPOTENCY_CONFLICT', 409, { key });
    this.key = key;
  }
}

export class IdempotencyProcessingError extends EntitlementError {
  public readonly key: string;

  constructor(key: string, message: string = 'A request with this idempotency key is currently processing') {
    super(message, 'IDEMPOTENCY_PROCESSING', 409, { key });
    this.key = key;
  }
}

export class UnauthorizedError extends EntitlementError {
  constructor(message: string = 'Valid session or authentication required') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

export class ForbiddenError extends EntitlementError {
  public readonly requiredPermission?: string;
  public readonly requiredRole?: string;

  constructor(message: string = 'Forbidden: insufficient permissions', details?: { requiredPermission?: string; requiredRole?: string }) {
    super(message, 'FORBIDDEN', 403, details);
    this.requiredPermission = details?.requiredPermission;
    this.requiredRole = details?.requiredRole;
  }
}

export class ReservationNotFoundError extends EntitlementError {
  public readonly reservationId: string;

  constructor(reservationId: string) {
    super(`Quota reservation '${reservationId}' not found`, 'RESERVATION_NOT_FOUND', 404, { reservationId });
    this.reservationId = reservationId;
  }
}

export class InvalidReservationStateError extends EntitlementError {
  public readonly reservationId: string;
  public readonly currentStatus: string;
  public readonly attemptedAction: string;

  constructor(reservationId: string, currentStatus: string, attemptedAction: string) {
    super(
      `Cannot perform '${attemptedAction}' on reservation '${reservationId}' because it is in state '${currentStatus}'`,
      'INVALID_RESERVATION_STATE',
      409,
      { reservationId, currentStatus, attemptedAction }
    );
    this.reservationId = reservationId;
    this.currentStatus = currentStatus;
    this.attemptedAction = attemptedAction;
  }
}
