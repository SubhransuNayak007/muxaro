/**
 * @file sliding-window.ts
 * High-precision rolling sliding-window evaluation and countdown timer calculation
 */

import type { BucketUsage, QuotaBucket } from '../types.js';

export const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000; // 86,400,000 ms (24 hours)

export interface SlidingWindowResult {
  used: number;
  limit: number;
  remaining: number;
  windowMs: number;
  activeTimestamps: number[];
  resetsAt: number | null; // Timestamp when earliest active item rolls out of the window
  resetInSeconds: number; // Seconds until next slot is freed (0 if remaining > 0)
}

/**
 * Evaluates a sliding window over a list of event timestamps.
 *
 * @param timestamps Array of epoch millisecond timestamps representing consumed quota items
 * @param limit Total allowance in the rolling window
 * @param windowMs Rolling window duration (default 24h)
 * @param now Current epoch millisecond timestamp (default Date.now())
 */
export function evaluateSlidingWindow(
  timestamps: number[],
  limit: number,
  windowMs: number = DEFAULT_WINDOW_MS,
  now: number = Date.now()
): SlidingWindowResult {
  const windowStart = now - windowMs;

  // Filter timestamps that fall strictly within [now - windowMs, now]
  // and sort ascending (oldest first)
  const activeTimestamps = timestamps
    .filter((ts) => ts > windowStart && ts <= now)
    .sort((a, b) => a - b);

  const used = activeTimestamps.length;
  const remaining = Math.max(0, limit - used);

  let resetsAt: number | null = null;
  let resetInSeconds = 0;

  if (activeTimestamps.length > 0) {
    const oldestTimestamp = activeTimestamps[0]!;
    resetsAt = oldestTimestamp + windowMs;

    // Only set resetInSeconds if user has no remaining slots, or if requested for countdown
    if (remaining === 0) {
      resetInSeconds = Math.max(0, Math.ceil((resetsAt - now) / 1000));
    } else {
      // Even if user has slots remaining, calculate when the next used slot will reset
      resetInSeconds = Math.max(0, Math.ceil((resetsAt - now) / 1000));
    }
  }

  return {
    used,
    limit,
    remaining,
    windowMs,
    activeTimestamps,
    resetsAt,
    resetInSeconds: remaining === 0 ? resetInSeconds : 0, // 0 if user still has available quota
  };
}

/**
 * Builds a BucketUsage object from sliding window calculation.
 */
export function buildBucketUsage(
  bucket: QuotaBucket,
  activeTimestamps: number[],
  limit: number,
  activeReservationsCount: number = 0,
  windowMs: number = DEFAULT_WINDOW_MS,
  maxItemsPerJob?: number,
  now: number = Date.now()
): BucketUsage {
  const windowResult = evaluateSlidingWindow(activeTimestamps, limit, windowMs, now);
  const totalUsed = windowResult.used;
  const remaining = Math.max(0, limit - totalUsed);

  // If user is at or over limit, resetInSeconds is time until earliest item rolls out
  let resetInSeconds = 0;
  if (remaining === 0 && windowResult.resetsAt !== null) {
    resetInSeconds = Math.max(0, Math.ceil((windowResult.resetsAt - now) / 1000));
  }

  return {
    bucket,
    limit,
    used: totalUsed,
    remaining,
    activeReservations: activeReservationsCount,
    windowMs,
    resetsAt: windowResult.resetsAt,
    resetInSeconds,
    maxItemsPerJob,
  };
}
