/**
 * @file index.ts
 * Public entrypoint for @vyro/entitlements
 */

// Core Engine
export { EntitlementsEngine } from './engine.js';

// Types & Interfaces
export type {
  UserRole,
  PlanTier,
  User,
  Session,
  Permission,
  JobQuotaType,
  QuotaBucket,
  TierQuotaLimits,
  BucketUsage,
  QuotaSummary,
  CanExecuteResult,
  ReservationStatus,
  QuotaReservation,
  ReserveJobParams,
  IdempotencyStatus,
  IdempotencyRecord,
  LedgerAction,
  LedgerEntry,
  LedgerQueryOptions,
  LedgerHistoryResult,
  EntitlementsEngineOptions,
} from './types.js';

// Domain Errors
export {
  EntitlementError,
  QuotaExceededError,
  PlaylistSizeExceededError,
  IdempotencyConflictError,
  IdempotencyProcessingError,
  UnauthorizedError,
  ForbiddenError,
  ReservationNotFoundError,
  InvalidReservationStateError,
} from './errors.js';

// Auth & RBAC
export { SessionManager, type CreateSessionOptions, type SessionTokenPayload } from './auth/session.js';
export {
  ROLE_HIERARCHY,
  ROLE_PERMISSIONS,
  hasPermission,
  requirePermission,
  isRoleAtLeast,
  requireRole,
  getDefaultTierForRole,
} from './auth/rbac.js';
export {
  generateSecureToken,
  generateId,
  hashString,
  hashRequestPayload,
  canonicalStringify,
  createHmacSignature,
  verifyHmacSignature,
} from './auth/crypto.js';

// Quota & Sliding Window
export {
  DEFAULT_TIER_LIMITS,
  getQuotaBucketForJobType,
  getTierLimits,
  getBucketLimit,
} from './quota/rules.js';
export {
  evaluateSlidingWindow,
  buildBucketUsage,
  DEFAULT_WINDOW_MS,
  type SlidingWindowResult,
} from './quota/sliding-window.js';
export { QuotaReservationManager } from './quota/reservation.js';

// Idempotency
export {
  IdempotencyManager,
  type IdempotencyAcquireResult,
  type AcquireIdempotencyOptions,
} from './idempotency/idempotency-manager.js';

// Ledger
export {
  TransactionLedger,
  type RecordQuotaEventParams,
  type RecordCreditEventParams,
} from './ledger/ledger.js';

// Storage
export type { IEntitlementStorage } from './storage/interfaces.js';
export { InMemoryEntitlementStore } from './storage/in-memory-store.js';
export { POSTGRES_ENTITLEMENTS_SCHEMA } from './storage/sql-schema.js';
