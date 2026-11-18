export interface MediaStream {
  streamIndex: number;
  streamType: 'video' | 'audio';
  codec: string;
  bitrateKbps: number;
  formatId?: string;
  width?: number;
  height?: number;
  resolutionLabel?: string; // '8K', '4K', '1440p', '1080p', '720p', '480p'
  sampleRateHz?: number;
  channels?: number;
  channelLayout?: string; // 'stereo', '5.1', etc.
  frameRate?: number;
  fps?: number;
  hdr?: boolean;
  estimatedSizeBytes?: number;
  sizeIsEstimate?: boolean;
  recommended?: boolean;
  isNativeLossless?: boolean;
  isStreamCopyCandidate: boolean;
  transcodeRequired: boolean;
  notes?: string;
}

export interface MediaManifest {
  id: string;
  sourceUrl: string;
  title: string;
  author?: string;
  durationSeconds: number;
  fileSizeBytes: number;
  container: string;
  thumbnailUrl?: string;
  isLocalUpload?: boolean;
  permitted: boolean;
  rightsNote: string;
  videoStreams: MediaStream[];
  audioStreams: MediaStream[];
}

export type JobState =
  | 'CREATED'
  | 'VALIDATING'
  | 'QUEUED'
  | 'PROCESSING'
  | 'VERIFYING'
  | 'READY'
  | 'FAILED'
  | 'CANCELLED'
  | 'REJECTED';

export type ProcessingLane = 'instant' | 'smart' | 'power';

export type UserRole = 'user' | 'admin';
export type UserTier = 'guest' | 'free' | 'registered' | 'premium';

export interface ProcessingJob {
  id: string;
  batchId?: string;
  itemNumber?: number | string;
  priorityTier?: UserTier;
  jobType: 'extract_audio' | 'merge_av' | 'transcode_video' | 'batch' | 'playlist';
  status: JobState;
  operation: string;
  targetFormat: string;
  targetResolution?: string;
  targetAudioCodec?: string;
  streamCopy: boolean;
  processingLane?: ProcessingLane;
  strategyLabel?: string;
  losslessPreserved?: boolean;
  retentionMinutes?: number;
  progress: number;
  progressStage: string;
  inputTitle: string;
  outputFilename?: string;
  outputSizeBytes?: number;
  downloadUrl?: string;
  checksumSha256?: string;
  error?: string;
  errorMessage?: string;
  userMessage?: string;
  expiresAt?: string;
  createdAt: string;
  completedAt?: string;
}

export interface QuotaStatus {
  individualVideosRemaining: number;
  individualVideosLimit: number;
  playlistJobsRemaining: number;
  playlistJobsLimit: number;
  rollingWindowHours: number;
  resetCountdownSeconds: number;
  nextResetIso: string;
  baseLimit?: number;
  baseUsed?: number;
  baseRemaining?: number;
  extraCreditsEarned?: number;
  extraCreditsRemaining?: number;
  extraCreditsExpiresAt?: string | null;
  totalAvailableIndividual?: number;
  rewardedAdsUsedToday?: number;
  rewardedAdsDailyCap?: number;
  tier?: UserTier;
}

export interface EntitlementsUsage extends QuotaStatus {
  baseLimit: number;
  baseUsed: number;
  baseRemaining: number;
  extraCreditsEarned: number;
  extraCreditsRemaining: number;
  extraCreditsExpiresAt: string | null;
  totalAvailableIndividual: number;
  rewardedAdsUsedToday: number;
  rewardedAdsDailyCap: number;
  tier: UserTier;
}

export type CreditLedgerEventType =
  | 'REWARD_GRANTED'
  | 'CREDIT_RESERVED'
  | 'CREDIT_CONSUMED'
  | 'CREDIT_RELEASED'
  | 'ADMIN_ADJUSTMENT'
  | 'CREDIT_EXPIRED'
  | string;

export interface CreditLedgerItem {
  id: string;
  timestamp: string;
  operation: string;
  eventType?: CreditLedgerEventType;
  change: number;
  balanceAfter: number;
  referenceId: string;
  expiresAt?: string | null;
}

export interface SystemHealthMetrics {
  status: 'OPERATIONAL' | 'DEGRADED' | 'MAINTENANCE';
  apiLatencyMs: number;
  queueDepth: number;
  activeMediaWorkers: number;
  cpuLoadPercent: number;
  uptimePercent: number;
  errorRate24hPercent: number;
  totalProcessed24h: number;
  queueClasses?: Record<string, unknown>;
}

/* =============================================================================
   AUTH, IDENTITY & SESSION TYPES
   ============================================================================= */
export interface AuthUser {
  id?: string;
  internalUserId?: string;
  publicUserId: string;
  email: string;
  emailVerified: boolean;
  displayName?: string | null;
  avatarUrl?: string | null;
  role: UserRole;
  tier: UserTier;
  mfaEnabled: boolean;
  mfaVerified: boolean;
  memberSince?: string;
  createdAt?: string;
  preferences?: Record<string, unknown>;
}

export interface AuthSessionResponse {
  authenticated: boolean;
  user?: AuthUser | null;
  csrfToken?: string;
  googleAuthConfigured: boolean;
  mfaRequired?: boolean;
}

export interface UserSessionInfo {
  id: string;
  sessionId?: string;
  current: boolean;
  userAgent: string;
  ipPrefix?: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt?: string;
}

export interface MfaSetupResponse {
  secret: string;
  otpauthUri: string;
  issuer?: string;
  accountName?: string;
}

/* =============================================================================
   REWARDED ADS TYPES
   ============================================================================= */
export interface RewardConfig {
  enabled: boolean;
  configured: boolean;
  adUnitPath: string | null;
  rewardAmount: number;
  dailyCap: number;
  remainingAdsToday: number;
  maxIndividualWithRewards: number;
  rewardExpiryHours?: number;
}

export type RewardSessionStatus = 'PENDING' | 'VERIFIED' | 'EXPIRED' | 'REJECTED';

export interface RewardSession {
  sessionId: string;
  status: RewardSessionStatus;
  adUnitPath?: string | null;
  customData?: string;
  rewardAmount: number;
  expiresAt?: string | null;
  verifiedAt?: string | null;
  creditsGranted?: number;
  message?: string;
}

/* =============================================================================
   BATCHES TYPES
   ============================================================================= */
export interface MediaBatch {
  id: string;
  batchId?: string;
  title?: string;
  status: string;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  createdAt: string;
  updatedAt?: string;
  zipDownloadUrl?: string | null;
  jobs?: ProcessingJob[];
}

/* =============================================================================
   ADMIN CONTROL CENTRE TYPES
   ============================================================================= */
export interface AdminUserSummary {
  id: string;
  publicUserId: string;
  email: string;
  displayName?: string | null;
  role: UserRole;
  tier: UserTier;
  status: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  createdAt: string;
  lastLoginAt?: string | null;
  abuseFlags?: number;
  usageSummary?: {
    baseRemaining?: number;
    extraCreditsRemaining?: number;
    totalJobs?: number;
  };
}

export interface AdminSearchResult {
  query: string;
  users: AdminUserSummary[];
  batches: MediaBatch[];
  jobs: ProcessingJob[];
  auditLogs?: AdminAuditLog[];
  securityEvents?: AdminSecurityEvent[];
}

export interface AdminPlatformSettings {
  baseVideoAllowance: number;
  playlistAllowance: number;
  rewardCreditsPerAd: number;
  rewardDailyCap: number;
  rewardExpiryHours: number;
  guestDailyAllowance?: number;
  guestConcurrency: number;
  freeConcurrency: number;
  premiumConcurrency: number;
  maxUploadSizeMb: number;
  maxPlaylistItems: number;
  rewardedAdsEnabled: boolean;
  [key: string]: unknown;
}

export interface AdminRewardsSummary {
  enabled: boolean;
  configured: boolean;
  adUnitPath?: string | null;
  totalSessions?: number;
  verifiedRewards: number;
  rejectedRewards: number;
  duplicateReplays: number;
  fraudFlags: number;
  creditsGranted24h?: number;
  recentSessions?: RewardSession[];
}

export interface AdminAnalyticsSummary {
  dau: number;
  mau: number;
  totalUsers?: number;
  registrations24h: number;
  registrations7d?: number;
  processingSuccessRate: number;
  jobsCompleted24h?: number;
  jobsFailed24h?: number;
  conversionFunnel?: Record<string, number>;
  queueWaitByTier?: Record<
    string,
    { p50Ms?: number; p95Ms?: number; avgMs?: number; count?: number }
  >;
  retention?: Record<string, number>;
}

export interface AdminAuditLog {
  id: string;
  timestamp: string;
  actorUserId?: string;
  actorPublicId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  details?: Record<string, unknown> | string;
}

export interface AdminSecurityEvent {
  id: string;
  timestamp: string;
  eventType: string;
  severity: string;
  ipPrefix?: string;
  userId?: string;
  publicUserId?: string;
  requestId?: string;
  message?: string;
  details?: Record<string, unknown> | string;
}
