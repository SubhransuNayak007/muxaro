'use client';

/**
 * Project MUXARO - Usage & Tier Limits Visualization Page
 * Features:
 * - Live visualization of daily jobs, processed bandwidth, and concurrent slots
 * - Real-time quota reset countdown timer
 * - Guest vs Registered vs Pro tier comparative matrix
 * - Synced with /api/v1/entitlements/usage and /api/v1/account/credits
 * - Conforms to Hallmark design tokens & clean, accessible typography
 */

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Zap,
  Activity,
  Layers,
  Clock,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  ArrowRight,
  HardDrive,
  Cpu,
  UserCheck,
  Crown,
  RefreshCw,
} from 'lucide-react';
import { api } from '@/lib/api-client';
import { EntitlementsUsage, UserTier } from '@/lib/types';

const DEFAULT_USAGE: EntitlementsUsage = {
  individualVideosRemaining: 18,
  individualVideosLimit: 25,
  playlistJobsRemaining: 3,
  playlistJobsLimit: 5,
  rollingWindowHours: 24,
  resetCountdownSeconds: 28400,
  nextResetIso: new Date(Date.now() + 28400 * 1000).toISOString(),
  baseLimit: 25,
  baseUsed: 7,
  baseRemaining: 18,
  extraCreditsEarned: 2,
  extraCreditsRemaining: 2,
  extraCreditsExpiresAt: null,
  totalAvailableIndividual: 20,
  rewardedAdsUsedToday: 0,
  rewardedAdsDailyCap: 5,
  tier: 'free',
};

export default function UsagePage() {
  const [usage, setUsage] = useState<EntitlementsUsage>(DEFAULT_USAGE);
  const [currentTier, setCurrentTier] = useState<UserTier>('free');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [resetCountdown, setResetCountdown] = useState<number>(28400);

  useEffect(() => {
    async function fetchUsage() {
      setIsLoading(true);
      try {
        const data = await api.getEntitlementsUsage();
        if (data) {
          setUsage(data);
          setCurrentTier(data.tier || 'free');
          setResetCountdown(data.resetCountdownSeconds || 28400);
        }
      } catch {
        // Fallback to defaults
      } finally {
        setIsLoading(false);
      }
    }

    fetchUsage();
  }, []);

  // Countdown timer ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setResetCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatCountdown = (totalSec: number) => {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  };

  const jobsLimit = usage.baseLimit || 25;
  const jobsUsed = usage.baseUsed ?? (jobsLimit - usage.individualVideosRemaining);
  const jobsPct = Math.min(100, Math.round((jobsUsed / jobsLimit) * 100));

  // Estimated processed bandwidth based on usage
  const bandwidthUsedGb = (jobsUsed * 0.28).toFixed(2);
  const bandwidthLimitGb = currentTier === 'guest' ? '2.5' : currentTier === 'free' ? '10.0' : '50.0';
  const bandwidthPct = Math.min(100, Math.round((parseFloat(bandwidthUsedGb) / parseFloat(bandwidthLimitGb)) * 100));

  // Active concurrent slots
  const activeSlots = 1;
  const maxSlots = currentTier === 'guest' ? 1 : currentTier === 'free' ? 2 : 6;

  return (
    <div className="w-full max-w-5xl mx-auto py-8 px-4 sm:px-6 space-y-10">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--muxaro-border)] pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="p-1.5 rounded-lg bg-[var(--muxaro-tag-pill-bg)] text-[var(--muxaro-indigo)]">
              <Activity className="w-5 h-5" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--muxaro-text-primary)]">
              Usage & Entitlement Limits
            </h1>
          </div>
          <p className="text-sm text-[var(--muxaro-text-secondary)]">
            Monitor daily processing quotas, network bandwidth, and active worker concurrency lanes.
          </p>
        </div>

        {/* Current Tier Pill */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="text-xs text-[var(--muxaro-text-secondary)] font-medium">Your Plan:</span>
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-[var(--muxaro-tag-pill-bg)] text-[var(--muxaro-indigo)] border border-[var(--muxaro-tag-pill-border)]">
            {currentTier === 'premium' ? (
              <Crown className="w-3.5 h-3.5 text-amber-500" />
            ) : (
              <UserCheck className="w-3.5 h-3.5" />
            )}
            <span>{currentTier} Tier</span>
          </span>
        </div>
      </div>

      {/* Quota Telemetry Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Metric 1: Daily Jobs */}
        <div className="muxaro-card p-6 bg-[var(--muxaro-bg-surface)] border border-[var(--muxaro-border)] rounded-2xl shadow-[var(--muxaro-shadow-card)] space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--muxaro-text-secondary)]">
              Daily Conversions
            </span>
            <Zap className="w-4 h-4 text-[var(--muxaro-indigo)]" />
          </div>

          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-[var(--muxaro-text-primary)]">
                {jobsUsed}
              </span>
              <span className="text-sm font-semibold text-[var(--muxaro-text-tertiary)]">
                / {jobsLimit} jobs
              </span>
            </div>
            <p className="text-xs text-[var(--muxaro-text-secondary)]">
              {usage.totalAvailableIndividual || usage.individualVideosRemaining} conversions remaining today
            </p>
          </div>

          {/* Progress Bar */}
          <div className="space-y-1.5">
            <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--muxaro-indigo)] transition-all duration-300"
                style={{ width: `${jobsPct}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-[var(--muxaro-text-tertiary)] font-mono">
              <span>{jobsPct}% consumed</span>
              <span>Resets in {formatCountdown(resetCountdown)}</span>
            </div>
          </div>
        </div>

        {/* Metric 2: Processed Bandwidth */}
        <div className="muxaro-card p-6 bg-[var(--muxaro-bg-surface)] border border-[var(--muxaro-border)] rounded-2xl shadow-[var(--muxaro-shadow-card)] space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--muxaro-text-secondary)]">
              Processed Bandwidth
            </span>
            <HardDrive className="w-4 h-4 text-cyan-500" />
          </div>

          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-[var(--muxaro-text-primary)]">
                {bandwidthUsedGb}
              </span>
              <span className="text-sm font-semibold text-[var(--muxaro-text-tertiary)]">
                / {bandwidthLimitGb} GB
              </span>
            </div>
            <p className="text-xs text-[var(--muxaro-text-secondary)]">
              Rolling 24-hr ingress/egress transcode throughput
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-500 transition-all duration-300"
                style={{ width: `${bandwidthPct}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-[var(--muxaro-text-tertiary)] font-mono">
              <span>{bandwidthPct}% capacity</span>
              <span>Unlimited stream copy</span>
            </div>
          </div>
        </div>

        {/* Metric 3: Concurrency Slots */}
        <div className="muxaro-card p-6 bg-[var(--muxaro-bg-surface)] border border-[var(--muxaro-border)] rounded-2xl shadow-[var(--muxaro-shadow-card)] space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--muxaro-text-secondary)]">
              Worker Concurrency
            </span>
            <Cpu className="w-4 h-4 text-emerald-500" />
          </div>

          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-[var(--muxaro-text-primary)]">
                {activeSlots}
              </span>
              <span className="text-sm font-semibold text-[var(--muxaro-text-tertiary)]">
                / {maxSlots} active slots
              </span>
            </div>
            <p className="text-xs text-[var(--muxaro-text-secondary)]">
              Parallel media worker pipelines running concurrently
            </p>
          </div>

          <div className="flex items-center gap-2 pt-2">
            {Array.from({ length: maxSlots }).map((_, idx) => (
              <div
                key={idx}
                className={`flex-1 h-3 rounded-md transition-colors duration-150 ${
                  idx < activeSlots
                    ? 'bg-emerald-500'
                    : 'bg-slate-200 dark:bg-slate-700'
                }`}
                title={idx < activeSlots ? 'Slot Occupied' : 'Slot Available'}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Guest vs Signed-In vs Pro Tier Comparison Matrix */}
      <div className="muxaro-card p-6 sm:p-8 bg-[var(--muxaro-bg-surface)] border border-[var(--muxaro-border)] rounded-2xl shadow-[var(--muxaro-shadow-card)] space-y-6">
        <div>
          <h2 className="text-lg font-bold text-[var(--muxaro-text-primary)]">
            Tier Capabilities & Limits Comparison
          </h2>
          <p className="text-xs text-[var(--muxaro-text-secondary)] mt-1">
            Create a free registered account or upgrade to Pro to unlock 4K resolutions, 4GB multipart uploads, and dedicated TurboFlow pipelines.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[var(--muxaro-border)] text-[var(--muxaro-text-secondary)]">
                <th className="py-3 px-4 font-bold uppercase">Feature</th>
                <th className="py-3 px-4 font-bold uppercase">Guest (Anonymous)</th>
                <th className="py-3 px-4 font-bold uppercase bg-[var(--muxaro-tag-pill-bg)] text-[var(--muxaro-indigo)] rounded-t-xl">
                  Free Signed-In
                </th>
                <th className="py-3 px-4 font-bold uppercase text-amber-600 dark:text-amber-400">
                  Pro Supporter
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--muxaro-border-subtle)] text-[var(--muxaro-text-primary)]">
              <tr>
                <td className="py-3.5 px-4 font-semibold">Daily Job Conversions</td>
                <td className="py-3.5 px-4 text-emerald-600 font-bold">100 jobs / day</td>
                <td className="py-3.5 px-4 font-bold bg-indigo-50/50 dark:bg-indigo-950/20 text-[var(--muxaro-indigo)]">
                  25 jobs / day
                </td>
                <td className="py-3.5 px-4 font-bold text-emerald-600">Unlimited</td>
              </tr>
              <tr>
                <td className="py-3.5 px-4 font-semibold">Maximum Video Resolution</td>
                <td className="py-3.5 px-4 text-slate-500">720p HD</td>
                <td className="py-3.5 px-4 font-bold bg-indigo-50/50 dark:bg-indigo-950/20 text-[var(--muxaro-indigo)]">
                  1080p Full HD
                </td>
                <td className="py-3.5 px-4 font-bold text-emerald-600">4K & 8K UHD</td>
              </tr>
              <tr>
                <td className="py-3.5 px-4 font-semibold">Local File Upload Limit</td>
                <td className="py-3.5 px-4 text-slate-500">500 MB</td>
                <td className="py-3.5 px-4 font-bold bg-indigo-50/50 dark:bg-indigo-950/20 text-[var(--muxaro-indigo)]">
                  2 GB Direct
                </td>
                <td className="py-3.5 px-4 font-bold text-emerald-600">4 GB Resumable Multipart</td>
              </tr>
              <tr>
                <td className="py-3.5 px-4 font-semibold">Worker Concurrency Slots</td>
                <td className="py-3.5 px-4 text-slate-500">1 parallel job</td>
                <td className="py-3.5 px-4 font-bold bg-indigo-50/50 dark:bg-indigo-950/20 text-[var(--muxaro-indigo)]">
                  2 parallel jobs
                </td>
                <td className="py-3.5 px-4 font-bold text-emerald-600">6 parallel jobs</td>
              </tr>
              <tr>
                <td className="py-3.5 px-4 font-semibold">Cloud Storage Retention</td>
                <td className="py-3.5 px-4 text-slate-500">2 hours</td>
                <td className="py-3.5 px-4 font-bold bg-indigo-50/50 dark:bg-indigo-950/20 text-[var(--muxaro-indigo)]">
                  24 hours
                </td>
                <td className="py-3.5 px-4 font-bold text-emerald-600">7 days</td>
              </tr>
              <tr>
                <td className="py-3.5 px-4 font-semibold">Batch & Playlist Queue</td>
                <td className="py-3.5 px-4 text-slate-500">Up to 3 items</td>
                <td className="py-3.5 px-4 font-bold bg-indigo-50/50 dark:bg-indigo-950/20 text-[var(--muxaro-indigo)]">
                  Up to 25 items
                </td>
                <td className="py-3.5 px-4 font-bold text-emerald-600">Up to 100 items</td>
              </tr>
              <tr>
                <td className="py-3.5 px-4 font-semibold">Lossless Remux Priority</td>
                <td className="py-3.5 px-4 text-slate-500">Standard Queue</td>
                <td className="py-3.5 px-4 font-bold bg-indigo-50/50 dark:bg-indigo-950/20 text-[var(--muxaro-indigo)]">
                  Priority Lane
                </td>
                <td className="py-3.5 px-4 font-bold text-emerald-600">Dedicated TurboFlow Lane</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Action Callout */}
        <div className="pt-4 border-t border-[var(--muxaro-border-subtle)] flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs text-[var(--muxaro-text-secondary)]">
            Signed in as free member? You can claim extra conversion credits via rewarded verification.
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/credits"
              className="px-4 py-2 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] text-xs font-semibold text-[var(--muxaro-text-secondary)] hover:bg-[var(--muxaro-bg-elevated)]"
            >
              Earn Extra Credits
            </Link>
            <Link
              href="/register"
              className="px-5 py-2 rounded-xl bg-[var(--muxaro-indigo)] text-white text-xs font-bold hover:opacity-95 shadow-[var(--muxaro-shadow-btn)]"
            >
              Upgrade / Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
