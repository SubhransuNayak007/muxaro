/**
 * MUXARO Unified Quota Contract (/v1/account/credits, /v1/entitlements/usage, /v1/quota)
 * 
 * Single source of truth for daily jobs, playlist jobs, rolling reset windows,
 * and user entitlement tiers.
 */

import { z } from 'zod';

// =============================================================================
// 1. Quota Tiers & Enums
// =============================================================================

export const USER_TIERS = ['anonymous', 'free', 'pro', 'admin', 'enterprise'] as const;
export type UserTier = (typeof USER_TIERS)[number];
export const userTierSchema = z.enum(USER_TIERS);

export const QUOTA_BUCKETS = ['daily', 'playlist', 'concurrency'] as const;
export type QuotaBucketType = (typeof QUOTA_BUCKETS)[number];

// =============================================================================
// 2. Bucket Usage Schemas
// =============================================================================

export const dailyJobsQuotaSchema = z.object({
  limit: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  resetTime: z.string().datetime().or(z.string()), // ISO 8601 string
  resetInSeconds: z.number().int().nonnegative(),
});
export type DailyJobsQuota = z.infer<typeof dailyJobsQuotaSchema>;

export const playlistJobsQuotaSchema = z.object({
  limit: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  resetTime: z.string().datetime().or(z.string()),
  resetInSeconds: z.number().int().nonnegative(),
  maxItemsPerJob: z.number().int().positive(),
});
export type PlaylistJobsQuota = z.infer<typeof playlistJobsQuotaSchema>;

export const concurrencyQuotaSchema = z.object({
  active: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});
export type ConcurrencyQuota = z.infer<typeof concurrencyQuotaSchema>;

export const creditsSummarySchema = z.object({
  balance: z.number().int().nonnegative(),
  currency: z.string().default('credits'),
});
export type CreditsSummary = z.infer<typeof creditsSummarySchema>;

// =============================================================================
// 3. Unified Quota Contract
// =============================================================================

export const unifiedQuotaSchema = z.object({
  userId: z.string().min(1),
  tier: userTierSchema,
  role: z.string().default('user'),
  evaluatedAt: z.string().datetime().or(z.string()),
  dailyJobs: dailyJobsQuotaSchema,
  playlistJobs: playlistJobsQuotaSchema,
  concurrency: concurrencyQuotaSchema,
  credits: creditsSummarySchema,
  canExecute: z.boolean().default(true),
  reason: z.string().optional(),
});
export type UnifiedQuotaSummary = z.infer<typeof unifiedQuotaSchema>;

// =============================================================================
// 4. Default Limits Configuration
// =============================================================================

export const DEFAULT_TIER_LIMITS: Record<UserTier, {
  dailyLimit: number;
  playlistLimit: number;
  maxPlaylistItems: number;
  concurrencyLimit: number;
}> = {
  anonymous: {
    dailyLimit: 10,
    playlistLimit: 2,
    maxPlaylistItems: 10,
    concurrencyLimit: 2,
  },
  free: {
    dailyLimit: 25,
    playlistLimit: 5,
    maxPlaylistItems: 25,
    concurrencyLimit: 3,
  },
  pro: {
    dailyLimit: 200,
    playlistLimit: 50,
    maxPlaylistItems: 100,
    concurrencyLimit: 8,
  },
  enterprise: {
    dailyLimit: 1000,
    playlistLimit: 500,
    maxPlaylistItems: 500,
    concurrencyLimit: 20,
  },
  admin: {
    dailyLimit: 999999,
    playlistLimit: 999999,
    maxPlaylistItems: 999999,
    concurrencyLimit: 50,
  },
};

// =============================================================================
// 5. Validators
// =============================================================================

export function validateQuotaSummary(data: unknown): {
  success: boolean;
  data?: UnifiedQuotaSummary;
  error?: z.ZodError;
} {
  const result = unifiedQuotaSchema.safeParse(data);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: result.error };
}
