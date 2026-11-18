/**
 * @file rules.ts
 * Tier limits, bucket definitions, and job-to-bucket mapping rules
 */

import type { PlanTier, JobQuotaType, QuotaBucket, TierQuotaLimits } from '../types.js';

/**
 * Standard tier configuration
 */
export const DEFAULT_TIER_LIMITS: Record<PlanTier, TierQuotaLimits> = {
  free: {
    tier: 'free',
    videoDailyLimit: 10, // Exactly 10 individual video jobs per rolling 24 hours
    playlistDailyLimit: 1, // Exactly 1 playlist job per rolling 24 hours
    maxPlaylistItems: 50, // Up to 50 items cap for playlist jobs
    maxConcurrentJobs: 2,
    allowPriorityQueue: false,
    allowUnlimitedBypass: false,
  },
  pro: {
    tier: 'pro',
    videoDailyLimit: 500,
    playlistDailyLimit: 25,
    maxPlaylistItems: 500,
    maxConcurrentJobs: 10,
    allowPriorityQueue: true,
    allowUnlimitedBypass: false,
  },
  enterprise: {
    tier: 'enterprise',
    videoDailyLimit: 10_000,
    playlistDailyLimit: 1_000,
    maxPlaylistItems: 5_000,
    maxConcurrentJobs: 50,
    allowPriorityQueue: true,
    allowUnlimitedBypass: true,
  },
};

/**
 * Maps incoming job operation types to their respective isolated quota buckets.
 *
 * CRITICAL RULE:
 * Playlist jobs map to 'playlist' bucket.
 * Individual video downloads, audio extractions, and media merges map to 'video' bucket.
 * The buckets are completely isolated: a playlist job NEVER depletes the individual video bucket,
 * and an individual video job NEVER depletes the playlist bucket.
 */
export function getQuotaBucketForJobType(jobType: JobQuotaType): QuotaBucket {
  switch (jobType) {
    case 'PLAYLIST_DOWNLOAD':
    case 'PLAYLIST_JOB':
      return 'playlist';
    case 'PLAYLIST_CHILD':
      return 'none';
    case 'VIDEO_DOWNLOAD':
    case 'AUDIO_EXTRACTION':
    case 'MEDIA_MERGE':
    case 'INDIVIDUAL_VIDEO_JOB':
    default:
      return 'video';
  }
}

/**
 * Get tier quota limits, with optional runtime overrides.
 */
export function getTierLimits(
  tier: PlanTier,
  overrides?: Partial<Record<PlanTier, Partial<TierQuotaLimits>>>
): TierQuotaLimits {
  const base = DEFAULT_TIER_LIMITS[tier] || DEFAULT_TIER_LIMITS.free;
  const tierOverride = overrides?.[tier];
  if (!tierOverride) {
    return { ...base };
  }
  return {
    ...base,
    ...tierOverride,
  };
}

/**
 * Get the limit for a specific bucket and tier.
 */
export function getBucketLimit(
  bucket: QuotaBucket,
  tier: PlanTier,
  overrides?: Partial<Record<PlanTier, Partial<TierQuotaLimits>>>
): number {
  if (bucket === 'none') return 999_999;
  const limits = getTierLimits(tier, overrides);
  return bucket === 'playlist' ? limits.playlistDailyLimit : limits.videoDailyLimit;
}
