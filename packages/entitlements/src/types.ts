/**
 * @file types.ts
 * Core types, interfaces, and domain models for @vyro/entitlements
 */

export type UserRole = 'anonymous' | 'free' | 'pro' | 'admin';

export type PlanTier = 'free' | 'pro' | 'enterprise';

export interface User {
  id: string;
  email?: string;
  role: UserRole;
  tier: PlanTier;
  createdAt: number;
  isAnonymous?: boolean;
  metadata?: Record<string, unknown>;
}

export interface Session {
  sessionId: string;
  userId: string;
  role: UserRole;
  tier: PlanTier;
  createdAt: number;
  expiresAt: number;
  lastActiveAt: number;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export type Permission =
  | 'jobs:create:video'
  | 'jobs:create:playlist'
  | 'jobs:create:merge'
  | 'jobs:create:audio'
  | 'jobs:read'
  | 'jobs:cancel'
  | 'quota:read'
  | 'credits:read'
  | 'credits:purchase'
  | 'admin:metrics'
  | 'admin:override_quota'
  | 'admin:users:manage'
  | 'admin:ledger:view_all';

export type JobQuotaType =
  | 'VIDEO_DOWNLOAD'
  | 'PLAYLIST_DOWNLOAD'
  | 'AUDIO_EXTRACTION'
  | 'MEDIA_MERGE'
  | 'INDIVIDUAL_VIDEO_JOB'
  | 'PLAYLIST_JOB'
  | 'PLAYLIST_CHILD';

export type QuotaBucket = 'video' | 'playlist' | 'none';

export interface TierQuotaLimits {
  tier: PlanTier;
  videoDailyLimit: number; // Rolling 24-hour limit
  playlistDailyLimit: number; // Rolling 24-hour limit
  maxPlaylistItems: number; // Maximum items allowed in a single playlist job
  maxConcurrentJobs: number;
  allowPriorityQueue: boolean;
  allowUnlimitedBypass: boolean;
}

export interface BucketUsage {
  bucket: QuotaBucket;
  limit: number;
  used: number; // Count of committed + active pending reservations in rolling window
  remaining: number;
  activeReservations: number;
  windowMs: number; // e.g. 86400000 ms (24 hours)
  resetsAt: number | null; // Epoch timestamp (ms) when earliest consumed slot expires, or null if 0 used
  resetInSeconds: number; // Seconds until next slot becomes available (0 if remaining > 0)
  maxItemsPerJob?: number;
}

export interface QuotaSummary {
  userId: string;
  tier: PlanTier;
  role: UserRole;
  evaluatedAt: number;
  buckets: {
    video: BucketUsage;
    playlist: BucketUsage;
  };
  credits: {
    balance: number;
    currency: string;
  };
}

export interface CanExecuteResult {
  allowed: boolean;
  reason?: string;
  code?: 'ALLOWED' | 'QUOTA_EXCEEDED' | 'PLAYLIST_ITEM_LIMIT_EXCEEDED' | 'FORBIDDEN_ROLE' | 'CONCURRENT_LIMIT_EXCEEDED';
  bucket: QuotaBucket;
  limit: number;
  used: number;
  remaining: number;
  resetsAt: number | null;
  resetInSeconds: number;
}

export type ReservationStatus =
  | 'PENDING'
  | 'COMMITTED'
  | 'ROLLED_BACK'
  | 'EXPIRED'
  | 'RESERVED'
  | 'CONSUMED'
  | 'RELEASED';

export interface QuotaReservation {
  reservationId: string;
  userId: string;
  jobId?: string;
  idempotencyKey?: string;
  jobType: JobQuotaType;
  bucket: QuotaBucket;
  cost: number; // Usually 1 slot
  itemCount: number; // e.g. 1 for video, N for playlist
  status: ReservationStatus;
  createdAt: number;
  expiresAt: number; // Automatic expiration if worker never commits
  committedAt?: number;
  rolledBackAt?: number;
  rollbackReason?: string;
  metadata?: Record<string, unknown>;
}

export interface ReserveJobParams {
  userId: string;
  userRole?: UserRole;
  userTier?: PlanTier;
  jobType: JobQuotaType;
  itemCount?: number;
  jobId?: string;
  idempotencyKey?: string;
  ttlMs?: number; // Reservation lock TTL in ms (default 15 minutes)
  metadata?: Record<string, unknown>;
}

export type IdempotencyStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface IdempotencyRecord<T = unknown> {
  key: string;
  userId: string;
  requestHash: string;
  status: IdempotencyStatus;
  jobId?: string;
  reservationId?: string;
  response?: T;
  createdAt: number;
  expiresAt: number;
  lastUpdatedAt: number;
}

export type LedgerAction =
  | 'QUOTA_RESERVE'
  | 'QUOTA_COMMIT'
  | 'QUOTA_ROLLBACK'
  | 'QUOTA_EXPIRE'
  | 'CREDIT_GRANT'
  | 'CREDIT_DEBIT'
  | 'CREDIT_REFUND'
  | 'ADMIN_ADJUSTMENT';

export interface LedgerEntry {
  id: string;
  sequenceNumber: number;
  userId: string;
  action: LedgerAction;
  bucket: QuotaBucket;
  amount: number; // Cost or change (+/-)
  balanceAfter: number; // Usage or credit balance after transaction
  reservationId?: string;
  jobId?: string;
  idempotencyKey?: string;
  reason?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface LedgerQueryOptions {
  limit?: number;
  offset?: number;
  bucket?: QuotaBucket;
  action?: LedgerAction;
  since?: number; // epoch ms
  until?: number; // epoch ms
}

export interface LedgerHistoryResult {
  totalCount: number;
  entries: LedgerEntry[];
  hasMore: boolean;
}

export interface EntitlementsEngineOptions {
  windowMs?: number; // Rolling window, default 86_400_000 ms (24 hours)
  defaultReservationTtlMs?: number; // Default 900_000 ms (15 minutes)
  idempotencyTtlMs?: number; // Default 86_400_000 ms (24 hours)
  sessionSecret?: string; // Secret for HMAC signing
  sessionTtlMs?: number; // Default 7 * 86_400_000 ms (7 days)
  tierOverrides?: Partial<Record<PlanTier, Partial<TierQuotaLimits>>>;
}
