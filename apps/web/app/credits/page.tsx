'use client';

import React, { useEffect, useState, useMemo, useId, useRef, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { EntitlementsUsage, CreditLedgerItem, CreditLedgerEventType } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import { formatUtcTimestamp } from '@/lib/formatters';
import { quotaManager } from '@/lib/quota/quota-manager';
import {
  Video,
  ListMusic,
  Clock,
  ShieldCheck,
  RefreshCw,
  Search,
  Download,
  Copy,
  Check,
  HelpCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Info,
  AlertCircle,
  Layers,
} from 'lucide-react';

/* =============================================================================
   DEFENSIVE VALUE HELPERS (ZERO UNDEFINED / NULL / NaN GUARANTEE)
   ============================================================================= */
function safeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function safeString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function safeParseDateMs(iso: unknown): number | null {
  if (typeof iso !== 'string' || !iso.trim()) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function safeFormatUtc(iso: unknown, fallback = 'Rolling 24-hour cycle'): string {
  const ms = safeParseDateMs(iso);
  if (ms === null) return fallback;
  return formatUtcTimestamp(new Date(ms).toISOString());
}

function safeFormatLocalDateTime(iso: unknown, fallback = 'None active'): string {
  const ms = safeParseDateMs(iso);
  if (ms === null) return fallback;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZoneName: 'short',
    }).format(new Date(ms));
  } catch {
    return formatUtcTimestamp(new Date(ms).toISOString());
  }
}

function computeRemainingSeconds(usage: EntitlementsUsage | null): number {
  if (!usage) return 0;
  const reportedSeconds = Math.max(0, Math.floor(safeNumber(usage.resetCountdownSeconds, 0)));
  const resetMs = safeParseDateMs(usage.nextResetIso);
  if (resetMs !== null && reportedSeconds > 0) {
    return Math.max(0, Math.floor((resetMs - Date.now()) / 1000));
  }
  return reportedSeconds;
}

function getLedgerEventBadge(eventType: CreditLedgerEventType | undefined): {
  label: string;
  className: string;
} | null {
  const normalized = String(eventType || '').trim().toUpperCase();
  switch (normalized) {
    case 'REWARD_GRANTED':
      return {
        label: 'REWARD_GRANTED',
        className: 'bg-success-bg text-success',
      };
    case 'CREDIT_RESERVED':
      return {
        label: 'CREDIT_RESERVED',
        className: 'bg-elevated text-content-secondary border border-line-subtle',
      };
    case 'CREDIT_CONSUMED':
      return {
        label: 'CREDIT_CONSUMED',
        className: 'bg-elevated text-content-secondary border border-line-subtle',
      };
    case 'CREDIT_RELEASED':
      return {
        label: 'CREDIT_RELEASED',
        className: 'bg-info-bg text-brand-blue',
      };
    case 'CREDIT_EXPIRED':
      return {
        label: 'CREDIT_EXPIRED',
        className: 'bg-warning-bg text-warning',
      };
    case 'ADMIN_ADJUSTMENT':
      return {
        label: 'ADMIN_ADJUSTMENT',
        className: 'bg-info-bg text-brand-indigo',
      };
    default:
      return null;
  }
}

/* =============================================================================
   ACCESSIBLE TOOLTIP COMPONENT (HOVER, FOCUS, TOUCH & ESCAPE SUPPORT)
   ============================================================================= */
interface TooltipProps {
  content: string;
  ariaLabel?: string;
  className?: string;
}

function Tooltip({ content, ariaLabel = 'More information', className = '' }: TooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const tooltipId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen]);

  return (
    <div ref={containerRef} className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        className="p-1 text-content-secondary hover:text-content active:opacity-80 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-brand-indigo"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-describedby={isOpen ? tooltipId : undefined}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setIsOpen(false);
          }
        }}
      >
        <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          id={tooltipId}
          role="tooltip"
          className="absolute bottom-full right-0 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 mb-2 w-64 max-w-[calc(100vw-2rem)] p-3 text-xs rounded-md bg-surface border border-line shadow-lg text-content-secondary z-30"
        >
          <p className="font-normal text-content-secondary leading-relaxed m-0">{content}</p>
        </div>
      )}
    </div>
  );
}

/* =============================================================================
   CIRCULAR PROGRESS GAUGE COMPONENT
   ============================================================================= */
interface CircularGaugeProps {
  remaining: number;
  limit: number;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  gradientId: string;
  startColorToken: string;
  endColorToken: string;
  tooltipText: string;
  badgeLabel: string;
  details: { label: string; value: string }[];
}

function CircularGauge({
  remaining,
  limit,
  title,
  subtitle,
  icon,
  gradientId,
  startColorToken,
  endColorToken,
  tooltipText,
  badgeLabel,
  details,
}: CircularGaugeProps) {
  const safeLimit = Math.max(0, safeNumber(limit, 0));
  const safeRemaining = Math.max(0, Math.min(safeLimit || remaining, safeNumber(remaining, 0)));
  const ratio = safeLimit > 0 ? Math.min(1, safeRemaining / safeLimit) : 0;
  const percentage = Math.round(ratio * 100);

  const size = 136;
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - ratio * circumference;

  return (
    <section
      className="muxaro-card p-6 flex flex-col justify-between"
      aria-label={`${title}: ${safeRemaining} of ${safeLimit} available (${percentage}%)`}
    >
      <div>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-md bg-elevated text-brand-indigo shrink-0">{icon}</div>
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <h2 className="text-base font-semibold text-content truncate">{title}</h2>
                <Tooltip content={tooltipText} ariaLabel={`How ${title.toLowerCase()} work`} />
              </div>
              <p className="text-xs text-content-secondary">{subtitle}</p>
            </div>
          </div>
          <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-elevated text-content-secondary border border-line-subtle shrink-0 whitespace-nowrap">
            {badgeLabel}
          </span>
        </div>

        <div className="flex items-center justify-center my-6">
          <div
            className="relative flex items-center justify-center"
            role="progressbar"
            aria-valuenow={safeRemaining}
            aria-valuemin={0}
            aria-valuemax={Math.max(1, safeLimit)}
            aria-label={`${title} remaining`}
          >
            <svg
              width={size}
              height={size}
              viewBox={`0 0 ${size} ${size}`}
              className="transform -rotate-90"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor={startColorToken} />
                  <stop offset="100%" stopColor={endColorToken} />
                </linearGradient>
              </defs>

              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="var(--muxaro-border)"
                strokeWidth={strokeWidth}
              />

              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={`url(#${gradientId})`}
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 500ms ease-out' }}
              />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-2xl font-bold text-content tracking-tight mono-metric">
                {safeRemaining}
                <span className="text-sm font-normal text-content-secondary ml-0.5">
                  /{safeLimit}
                </span>
              </span>
              <span className="text-xs text-content-secondary font-medium">available</span>
            </div>
          </div>
        </div>
      </div>

      <dl className="space-y-2.5 pt-4 border-t border-line-subtle text-xs">
        {details.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-4">
            <dt className="text-content-secondary">{item.label}</dt>
            <dd className="font-medium text-content text-right mono-metric">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* =============================================================================
   LOADING SKELETONS
   ============================================================================= */
function SummarySkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6" aria-hidden="true">
      {[0, 1, 2].map((idx) => (
        <div key={idx} className="muxaro-card p-5 space-y-2.5">
          <div className="w-28 h-3 rounded bg-elevated motion-safe:animate-pulse" />
          <div className="w-20 h-7 rounded bg-elevated motion-safe:animate-pulse" />
          <div className="w-40 h-3 rounded bg-elevated motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function GaugeSkeleton() {
  return (
    <div className="muxaro-card p-6" aria-hidden="true">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-elevated motion-safe:animate-pulse" />
          <div className="space-y-2">
            <div className="w-32 h-4 rounded bg-elevated motion-safe:animate-pulse" />
            <div className="w-44 h-3 rounded bg-elevated motion-safe:animate-pulse" />
          </div>
        </div>
        <div className="w-20 h-5 rounded-full bg-elevated motion-safe:animate-pulse" />
      </div>
      <div className="flex justify-center my-6">
        <div className="w-32 h-32 rounded-full border-8 border-line-subtle motion-safe:animate-pulse" />
      </div>
      <div className="space-y-2.5 pt-4 border-t border-line-subtle">
        <div className="h-3 rounded bg-elevated motion-safe:animate-pulse" />
        <div className="h-3 rounded bg-elevated motion-safe:animate-pulse" />
        <div className="h-3 rounded bg-elevated motion-safe:animate-pulse" />
      </div>
    </div>
  );
}

function TimerSkeleton() {
  return (
    <div className="muxaro-card p-6 md:p-8 mb-8" aria-hidden="true">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2.5 flex-1">
          <div className="w-40 h-4 rounded bg-elevated motion-safe:animate-pulse" />
          <div className="w-72 max-w-full h-3 rounded bg-elevated motion-safe:animate-pulse" />
          <div className="w-56 max-w-full h-3 rounded bg-elevated motion-safe:animate-pulse" />
        </div>
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-md bg-elevated motion-safe:animate-pulse" />
          <div className="w-14 h-14 rounded-md bg-elevated motion-safe:animate-pulse" />
          <div className="w-14 h-14 rounded-md bg-elevated motion-safe:animate-pulse" />
        </div>
      </div>
    </div>
  );
}

function LedgerSkeleton() {
  return (
    <div className="space-y-3 py-4 border-t border-line-subtle" aria-hidden="true">
      <div className="h-10 rounded bg-elevated motion-safe:animate-pulse" />
      <div className="h-10 rounded bg-elevated motion-safe:animate-pulse" />
      <div className="h-10 rounded bg-elevated motion-safe:animate-pulse" />
    </div>
  );
}

/* =============================================================================
   MAIN USAGE & DAILY LIMITS PAGE
   ============================================================================= */
export default function CreditsPage() {
  const { authenticated, user } = useAuth();
  const [usage, setUsage] = useState<EntitlementsUsage | null>(null);
  const [ledger, setLedger] = useState<CreditLedgerItem[]>([]);
  const [countdown, setCountdown] = useState<number>(0);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterType, setFilterType] = useState<'all' | 'deductions' | 'restorations'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchUsageAndLedger = useCallback(async () => {
    setIsRefreshing(true);
    setUsageError(null);
    setLedgerError(null);

    const [usageResult, ledgerResult] = await Promise.allSettled([
      api.getEntitlementsUsage(),
      api.getCreditLedger(),
    ]);

    if (usageResult.status === 'fulfilled' && usageResult.value && typeof usageResult.value === 'object') {
      const data = usageResult.value;
      const hasValidNumbers =
        typeof data.baseLimit === 'number' &&
        Number.isFinite(data.baseLimit) &&
        typeof data.totalAvailableIndividual === 'number' &&
        Number.isFinite(data.totalAvailableIndividual);

      if (hasValidNumbers) {
        setUsage(data);
        setCountdown(computeRemainingSeconds(data));
        quotaManager.invalidate().catch(() => {});
      } else {
        setUsage(null);
        setCountdown(0);
        setUsageError('The server returned an unexpected usage response. Please retry.');
      }
    } else {
      setUsage(null);
      setCountdown(0);
      const reason =
        usageResult.status === 'rejected' && usageResult.reason instanceof Error
          ? usageResult.reason.message
          : 'Could not reach the usage service right now.';
      setUsageError(reason);
    }

    if (ledgerResult.status === 'fulfilled') {
      setLedger(Array.isArray(ledgerResult.value) ? ledgerResult.value : []);
    } else {
      setLedger([]);
      const reason =
        ledgerResult.reason instanceof Error
          ? ledgerResult.reason.message
          : 'Could not load your recent activity right now.';
      setLedgerError(reason);
    }

    setIsInitialLoading(false);
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    fetchUsageAndLedger();
  }, [fetchUsageAndLedger, authenticated]);

  // Real-time 1-second Countdown Tick synced against actual API nextResetIso
  useEffect(() => {
    if (!usage) return;
    const resetMs = safeParseDateMs(usage.nextResetIso);
    const hasActiveReset = safeNumber(usage.resetCountdownSeconds, 0) > 0;

    if (!hasActiveReset) {
      setCountdown(0);
      return;
    }

    const timer = setInterval(() => {
      if (resetMs !== null) {
        setCountdown(Math.max(0, Math.floor((resetMs - Date.now()) / 1000)));
      } else {
        setCountdown((prev) => (Number.isFinite(prev) && prev > 0 ? prev - 1 : 0));
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [usage]);

  // Live API values ONLY (zero hardcoded fallback numbers)
  const baseLimit = usage ? Math.max(0, safeNumber(usage.baseLimit, 0)) : 0;
  const baseUsed = usage ? Math.max(0, safeNumber(usage.baseUsed, 0)) : 0;
  const baseRemaining = usage ? Math.max(0, safeNumber(usage.baseRemaining, 0)) : 0;
  const totalAvailableIndividual = usage
    ? Math.max(0, safeNumber(usage.totalAvailableIndividual, baseRemaining))
    : baseRemaining;
  const playlistLimit = usage ? Math.max(0, safeNumber(usage.playlistJobsLimit, 0)) : 0;
  const playlistRemaining = usage ? Math.max(0, safeNumber(usage.playlistJobsRemaining, 0)) : 0;
  const rollingHours = usage ? Math.max(1, safeNumber(usage.rollingWindowHours, 24)) : 24;
  const nextResetString = usage
    ? safeFormatUtc(usage.nextResetIso, 'Rolling 24-hour cycle')
    : 'Unavailable';

  const safeCountdown = Math.max(0, Math.floor(safeNumber(countdown, 0)));
  const countdownHours = Math.floor(safeCountdown / 3600);
  const countdownMinutes = Math.floor((safeCountdown % 3600) / 60);
  const countdownSeconds = Math.floor(safeCountdown % 60);
  const allBaseSlotsFull =
    usage !== null &&
    baseRemaining >= baseLimit &&
    playlistRemaining >= playlistLimit &&
    safeCountdown === 0;

  const handleCopyId = (id: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard
        .writeText(id)
        .then(() => {
          setCopiedId(id);
          setTimeout(() => setCopiedId(null), 2000);
        })
        .catch(() => {});
    }
  };

  const safeLedger = useMemo(() => (Array.isArray(ledger) ? ledger : []), [ledger]);

  const filteredLedger = useMemo(() => {
    return safeLedger.filter((tx) => {
      if (!tx || typeof tx !== 'object') return false;
      const changeVal = safeNumber(tx.change, 0);

      if (filterType === 'deductions' && changeVal >= 0) return false;
      if (filterType === 'restorations' && changeVal <= 0) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const matchId = safeString(tx.id, '').toLowerCase().includes(q);
      const matchOp = safeString(tx.operation, '').toLowerCase().includes(q);
      const matchType = safeString(tx.eventType, '').toLowerCase().includes(q);
      const matchRef = safeString(tx.referenceId, '').toLowerCase().includes(q);
      return matchId || matchOp || matchType || matchRef;
    });
  }, [safeLedger, filterType, searchQuery]);

  const handleExportCsv = () => {
    if (filteredLedger.length === 0) return;
    const rows = [
      ['Transaction ID', 'Timestamp UTC', 'Event Type', 'Activity', 'Change', 'Balance After', 'Reference ID'],
      ...filteredLedger.map((tx) => [
        safeString(tx?.id, 'tx_unknown'),
        safeFormatUtc(tx?.timestamp, 'Unknown time'),
        safeString(tx?.eventType, '-'),
        `"${safeString(tx?.operation, 'Media job').replace(/"/g, '""')}"`,
        String(safeNumber(tx?.change, 0)),
        String(safeNumber(tx?.balanceAfter, 0)),
        safeString(tx?.referenceId, '-'),
      ]),
    ];

    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((row) => row.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'muxaro_usage_history.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const refreshLabel = isRefreshing ? 'Syncing...' : 'Refresh';

  return (
    <div
      className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12"
      aria-busy={isInitialLoading}
    >
      {/* =====================================================================
          HEADER SECTION
          ===================================================================== */}
      <header className="muxaro-card p-6 md:p-8 mb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5 mb-2.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-success-bg text-success">
                <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Fair daily limits</span>
              </span>
              {authenticated && user?.publicUserId && (
                <span className="text-xs text-content-secondary mono-metric">
                  {user.publicUserId}
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-content tracking-tight">
              Usage &amp; Daily Limits
            </h1>
            <p className="text-sm text-content-secondary mt-2 max-w-2xl leading-relaxed">
              Track your daily video and playlist allowance live.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={fetchUsageAndLedger}
              disabled={isRefreshing}
              aria-disabled={isRefreshing}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md border border-line bg-surface hover:bg-elevated active:opacity-90 text-content-secondary hover:text-content transition-colors focus-visible:outline-2 focus-visible:outline-brand-indigo disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isRefreshing ? 'motion-safe:animate-spin text-brand-indigo' : ''}`}
                aria-hidden="true"
              />
              <span>{refreshLabel}</span>
            </button>
          </div>
        </div>
      </header>

      {/* =====================================================================
          LIVE ENTITLEMENT SUMMARY, GAUGES & RESET TIMER
          ===================================================================== */}
      {isInitialLoading ? (
        <div aria-label="Loading daily limits">
          <SummarySkeleton />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <GaugeSkeleton />
            <GaugeSkeleton />
          </div>
          <TimerSkeleton />
        </div>
      ) : usageError || !usage ? (
        <section
          role="alert"
          className="muxaro-card p-6 md:p-8 mb-8 border border-error"
          aria-label="Usage unavailable"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-error-bg text-error shrink-0">
                <AlertCircle className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-content">
                  Unable to load your daily limits
                </h2>
                <p className="text-xs text-content-secondary mt-1 max-w-xl leading-relaxed">
                  {usageError ||
                    'We could not connect to the usage service right now. Please try again.'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={fetchUsageAndLedger}
              disabled={isRefreshing}
              aria-disabled={isRefreshing}
              className="muxaro-btn-primary inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold active:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isRefreshing ? 'motion-safe:animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>Retry</span>
            </button>
          </div>
        </section>
      ) : (
        <>
          {/* Live Quota Breakdown Strip */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <section className="muxaro-card p-5" aria-label="Available individual jobs">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xs font-medium text-content-secondary">
                  Available video jobs
                </span>
                <Layers className="w-4 h-4 text-brand-indigo shrink-0" aria-hidden="true" />
              </div>
              <div className="text-2xl font-bold text-content mono-metric">
                {baseRemaining}
                <span className="text-sm font-normal text-content-secondary ml-0.5">
                  /{baseLimit}
                </span>
              </div>
              <p className="text-xs text-content-secondary mt-1">
                {baseRemaining} of {baseLimit} daily jobs available for conversion or download
              </p>
            </section>

            <section className="muxaro-card p-5" aria-label="Playlist allowance">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xs font-medium text-content-secondary">
                  Playlist jobs available
                </span>
                <ListMusic className="w-4 h-4 text-brand-blue shrink-0" aria-hidden="true" />
              </div>
              <div className="text-2xl font-bold text-content mono-metric">
                {playlistRemaining}
                <span className="text-sm font-normal text-content-secondary ml-0.5">
                  /{playlistLimit}
                </span>
              </div>
              <p className="text-xs text-content-secondary mt-1">
                Separate allowance for multi-item ZIP batches
              </p>
            </section>
          </div>

          {/* Circular Progress Gauges */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <CircularGauge
              remaining={baseRemaining}
              limit={baseLimit}
              title="Base video jobs"
              subtitle="Single video downloads, compression, and audio extraction"
              icon={<Video className="w-4 h-4" aria-hidden="true" />}
              gradientId="grad-video-quota"
              startColorToken="var(--muxaro-indigo)"
              endColorToken="var(--muxaro-cyan)"
              badgeLabel="Single media"
              tooltipText="Your base video allowance covers individual links and uploaded files. Each used slot restores automatically 24 hours after completion, and cancelled or failed jobs refund immediately."
              details={[
                { label: 'Daily allowance', value: `${baseLimit} jobs / ${rollingHours}h` },
                { label: 'Remaining slots', value: `${baseRemaining} available` },
                { label: 'Used in window', value: `${baseUsed} jobs` },
                { label: 'Max resolution', value: 'Up to 8K (lossless)' },
              ]}
            />

            <CircularGauge
              remaining={playlistRemaining}
              limit={playlistLimit}
              title="Playlist jobs"
              subtitle="Multi-item playlists bundled into a single ZIP download"
              icon={<ListMusic className="w-4 h-4" aria-hidden="true" />}
              gradientId="grad-playlist-quota"
              startColorToken="var(--muxaro-blue)"
              endColorToken="var(--muxaro-cyan)"
              badgeLabel="Batch archive"
              tooltipText="Playlist jobs bundle collections into one organized ZIP archive. This allowance is completely separate from your individual video jobs."
              details={[
                { label: 'Daily allowance', value: `${playlistLimit} playlist / ${rollingHours}h` },
                { label: 'Max playlist size', value: 'Up to 50 items' },
                { label: 'Download format', value: 'Single ZIP file' },
                { label: 'Pool isolation', value: 'Separate from single video jobs' },
              ]}
            />
          </div>

          {/* Guest Upgrade Prompt */}
          {!authenticated && (
            <aside className="muxaro-card p-5 mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-content">
                  Want higher daily limits and playlist downloads?
                </h2>
                <p className="text-xs text-content-secondary mt-1">
                  Create a free account to get full daily allowances, saved download history, and
                  faster queue priority.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link
                  href="/register"
                  className="muxaro-btn-primary inline-flex items-center px-3.5 py-2 text-xs font-semibold active:opacity-90 whitespace-nowrap"
                >
                  Create free account
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center px-3.5 py-2 text-xs font-medium rounded-md border border-line bg-surface hover:bg-elevated active:opacity-90 text-content-secondary hover:text-content transition-colors whitespace-nowrap"
                >
                  Sign in
                </Link>
              </div>
            </aside>
          )}

          {/* Live Reset Countdown Timer */}
          <section className="muxaro-card p-6 md:p-8 mb-8" aria-label="Next slot reset timer">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-brand-indigo" aria-hidden="true" />
                  <h2 className="text-base font-semibold text-content">Next slot reset</h2>
                  <Tooltip
                    content="Limits refresh continuously on a rolling 24-hour schedule. If you process a video at 14:30 UTC today, that exact slot unlocks again at 14:30 UTC tomorrow."
                    ariaLabel="How the rolling reset timer works"
                  />
                </div>
                <p className="text-xs text-content-secondary max-w-xl leading-relaxed">
                  {allBaseSlotsFull
                    ? 'All base daily slots are ready right now. The countdown starts automatically once you complete your next job.'
                    : 'Your oldest used job slot unlocks automatically when the timer reaches zero.'}
                </p>

                <div className="text-xs text-content-secondary mt-3 flex flex-wrap items-center gap-x-6 gap-y-1.5">
                  <div>
                    Next slot restores:{' '}
                    <span className="font-semibold text-content mono-metric">
                      {allBaseSlotsFull ? 'Ready now' : nextResetString}
                    </span>
                  </div>
                  <div>
                    Window length:{' '}
                    <span className="font-semibold text-content mono-metric">
                      {rollingHours} hours UTC
                    </span>
                  </div>
                </div>
              </div>

              <div
                className="flex items-center gap-2 self-start lg:self-auto"
                aria-live="off"
                aria-label={`Time until next quota slot restores: ${countdownHours} hours, ${countdownMinutes} minutes, ${countdownSeconds} seconds`}
              >
                <div className="flex flex-col items-center">
                  <div className="px-3.5 py-2.5 rounded-md bg-elevated border border-line-subtle min-w-[60px] text-center">
                    <span className="text-xl sm:text-2xl font-bold text-content mono-metric">
                      {String(countdownHours).padStart(2, '0')}
                    </span>
                  </div>
                  <span className="text-[11px] text-content-secondary mt-1 font-medium">hours</span>
                </div>

                <span className="text-lg font-bold text-content-muted mb-5" aria-hidden="true">
                  :
                </span>

                <div className="flex flex-col items-center">
                  <div className="px-3.5 py-2.5 rounded-md bg-elevated border border-line-subtle min-w-[60px] text-center">
                    <span className="text-xl sm:text-2xl font-bold text-content mono-metric">
                      {String(countdownMinutes).padStart(2, '0')}
                    </span>
                  </div>
                  <span className="text-[11px] text-content-secondary mt-1 font-medium">mins</span>
                </div>

                <span className="text-lg font-bold text-content-muted mb-5" aria-hidden="true">
                  :
                </span>

                <div className="flex flex-col items-center">
                  <div className="px-3.5 py-2.5 rounded-md bg-elevated border border-line-subtle min-w-[60px] text-center">
                    <span className="text-xl sm:text-2xl font-bold text-brand-indigo mono-metric">
                      {String(countdownSeconds).padStart(2, '0')}
                    </span>
                  </div>
                  <span className="text-[11px] text-content-secondary mt-1 font-medium">secs</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-6 pt-6 border-t border-line-subtle">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-content mb-1">
                  <RefreshCw className="w-3.5 h-3.5 text-brand-indigo shrink-0" aria-hidden="true" />
                  <span>Rolling 24-hour refresh</span>
                </div>
                <p className="text-xs text-content-secondary leading-relaxed">
                  No waiting for midnight. Each job slot frees up 24 hours after it was used.
                </p>
              </div>

              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-content mb-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-success shrink-0" aria-hidden="true" />
                  <span>Automatic refunds</span>
                </div>
                <p className="text-xs text-content-secondary leading-relaxed">
                  Cancelled or failed jobs immediately return that slot back to your balance.
                </p>
              </div>

              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-content mb-1">
                  <Info className="w-3.5 h-3.5 text-brand-blue shrink-0" aria-hidden="true" />
                  <span>Clear credit history</span>
                </div>
                <p className="text-xs text-content-secondary leading-relaxed">
                  Every earned credit, job usage, refund, and expiration is logged below in order.
                </p>
              </div>
            </div>
          </section>
        </>
      )}

      {/* =====================================================================
          IMMUTABLE ACTIVITY HISTORY / CREDIT LEDGER
          ===================================================================== */}
      <section className="muxaro-card p-6 md:p-8" aria-label="Activity history">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-line-subtle mb-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-content">Activity history</h2>
              <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-elevated text-content-secondary border border-line-subtle">
                Rolling 24h record
              </span>
              <Tooltip
                content="Every completed job, automatic refund, and account adjustment is recorded in order so you can verify your exact balance."
                ariaLabel="About your activity history"
              />
            </div>
            <p className="text-xs text-content-secondary mt-1">
              Recent job usage, automatic refunds, and account adjustments.
            </p>
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredLedger.length === 0}
            aria-disabled={filteredLedger.length === 0}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border border-line bg-surface hover:bg-elevated active:opacity-90 text-content-secondary hover:text-content transition-colors focus-visible:outline-2 focus-visible:outline-brand-indigo disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Export CSV</span>
          </button>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-5">
          <div
            className="muxaro-segmented-group"
            role="group"
            aria-label="Filter activity history"
          >
            <button
              type="button"
              onClick={() => setFilterType('all')}
              className={`muxaro-segmented-tab ${filterType === 'all' ? 'active' : ''}`}
            >
              All ({safeLedger.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterType('deductions')}
              className={`muxaro-segmented-tab ${filterType === 'deductions' ? 'active' : ''}`}
            >
              Used
            </button>
            <button
              type="button"
              onClick={() => setFilterType('restorations')}
              className={`muxaro-segmented-tab ${filterType === 'restorations' ? 'active' : ''}`}
            >
              Added
            </button>
          </div>

          <div className="relative min-w-[240px]">
            <Search
              className="w-3.5 h-3.5 text-content-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by ID, event, or reference..."
              aria-label="Search activity history"
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-line bg-surface text-content placeholder:text-content-muted transition-colors"
            />
          </div>
        </div>

        {/* Ledger Content States */}
        {isInitialLoading ? (
          <LedgerSkeleton />
        ) : ledgerError ? (
          <div
            role="alert"
            className="py-8 px-4 text-center border-t border-line-subtle flex flex-col items-center gap-3"
          >
            <div className="p-2 rounded-md bg-error-bg text-error">
              <AlertCircle className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-content">Unable to load activity history</p>
              <p className="text-xs text-content-secondary mt-1 max-w-md">{ledgerError}</p>
            </div>
            <button
              type="button"
              onClick={fetchUsageAndLedger}
              disabled={isRefreshing}
              aria-disabled={isRefreshing}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-md border border-line bg-surface hover:bg-elevated active:opacity-90 text-content transition-colors focus-visible:outline-2 focus-visible:outline-brand-indigo whitespace-nowrap"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isRefreshing ? 'motion-safe:animate-spin text-brand-indigo' : ''}`}
                aria-hidden="true"
              />
              <span>Retry</span>
            </button>
          </div>
        ) : safeLedger.length === 0 ? (
          <div className="py-10 text-center text-xs text-content-secondary border-t border-line-subtle">
            <p className="font-medium text-content">No activity yet in this rolling window.</p>
            <p className="mt-1">
              Completed jobs, automatic refunds, and account adjustments will appear here.
            </p>
          </div>
        ) : filteredLedger.length === 0 ? (
          <div className="py-10 text-center text-xs text-content-secondary border-t border-line-subtle">
            <p className="mb-2">No activity matches your current filter.</p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setFilterType('all');
              }}
              className="text-brand-indigo font-medium hover:underline active:opacity-80 focus-visible:outline-2 focus-visible:outline-brand-indigo rounded whitespace-nowrap"
            >
              Reset filters
            </button>
          </div>
        ) : (
          <>
            {/* Mobile Stacked List (< md) */}
            <div className="md:hidden divide-y divide-line-subtle border-t border-line-subtle">
              {filteredLedger.map((tx, idx) => {
                const changeVal = safeNumber(tx?.change, 0);
                const isPositive = changeVal > 0;
                const safeId = safeString(tx?.id, `tx_row_${idx}`);
                const safeOperation = safeString(tx?.operation, 'Media processing job');
                const safeBalance = safeNumber(tx?.balanceAfter, 0);
                const safeRef = safeString(tx?.referenceId, '-');
                const safeTime = safeFormatUtc(tx?.timestamp, 'Unknown time');
                const badge = getLedgerEventBadge(tx?.eventType);
                const isCopied = copiedId === safeId;

                return (
                  <div key={safeId} className="py-3.5 space-y-2 text-xs">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          {isPositive ? (
                            <ArrowUpRight className="w-3.5 h-3.5 text-success shrink-0" aria-hidden="true" />
                          ) : (
                            <ArrowDownLeft className="w-3.5 h-3.5 text-brand-indigo shrink-0" aria-hidden="true" />
                          )}
                          <span className="font-medium text-content break-words">
                            {safeOperation}
                          </span>
                        </div>
                        {badge && (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] font-medium mono-metric ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        )}
                      </div>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-semibold mono-metric shrink-0 ${
                          isPositive
                            ? 'bg-success-bg text-success'
                            : 'bg-elevated text-content-secondary border border-line-subtle'
                        }`}
                      >
                        {isPositive ? `+${changeVal}` : changeVal}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-content-secondary">
                      <span className="mono-metric">{safeTime}</span>
                      <span className="font-semibold text-content mono-metric">
                        Balance: {safeBalance}
                      </span>
                    </div>

                    {tx?.expiresAt && (
                      <div className="text-[11px] text-content-secondary">
                        Expires: {safeFormatLocalDateTime(tx.expiresAt)}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="inline-flex items-center gap-1">
                        <span className="text-content-secondary mono-metric">{safeId}</span>
                        <button
                          type="button"
                          onClick={() => handleCopyId(safeId)}
                          className="p-1 rounded-sm text-content-secondary hover:text-content hover:bg-elevated active:opacity-80 transition-colors"
                          aria-label={`Copy ID ${safeId}`}
                        >
                          {isCopied ? (
                            <Check className="w-3 h-3 text-success" aria-hidden="true" />
                          ) : (
                            <Copy className="w-3 h-3" aria-hidden="true" />
                          )}
                        </button>
                      </div>
                      <span className="px-2 py-0.5 rounded-sm bg-elevated text-content-secondary mono-metric">
                        {safeRef}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table (md+) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-line text-content-secondary font-medium">
                    <th scope="col" className="py-2.5 pr-4">
                      Time (UTC)
                    </th>
                    <th scope="col" className="py-2.5 pr-4">
                      ID
                    </th>
                    <th scope="col" className="py-2.5 pr-4">
                      Activity
                    </th>
                    <th scope="col" className="py-2.5 pr-4">
                      Event
                    </th>
                    <th scope="col" className="py-2.5 pr-4">
                      Change
                    </th>
                    <th scope="col" className="py-2.5 pr-4">
                      Balance
                    </th>
                    <th scope="col" className="py-2.5">
                      Reference
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {filteredLedger.map((tx, idx) => {
                    const changeVal = safeNumber(tx?.change, 0);
                    const isPositive = changeVal > 0;
                    const safeId = safeString(tx?.id, `tx_row_${idx}`);
                    const safeOperation = safeString(tx?.operation, 'Media processing job');
                    const safeBalance = safeNumber(tx?.balanceAfter, 0);
                    const safeRef = safeString(tx?.referenceId, '-');
                    const safeTime = safeFormatUtc(tx?.timestamp, 'Unknown time');
                    const badge = getLedgerEventBadge(tx?.eventType);
                    const isCopied = copiedId === safeId;

                    return (
                      <tr key={safeId} className="hover:bg-elevated transition-colors">
                        <td className="py-3 pr-4 text-content-secondary mono-metric whitespace-nowrap">
                          {safeTime}
                        </td>

                        <td className="py-3 pr-4 whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <span className="font-semibold text-content mono-metric">{safeId}</span>
                            <button
                              type="button"
                              onClick={() => handleCopyId(safeId)}
                              className="p-1 rounded-sm text-content-secondary hover:text-content hover:bg-surface-muted active:opacity-80 transition-colors"
                              title="Copy ID"
                              aria-label={`Copy ID ${safeId}`}
                            >
                              {isCopied ? (
                                <Check className="w-3 h-3 text-success" aria-hidden="true" />
                              ) : (
                                <Copy className="w-3 h-3" aria-hidden="true" />
                              )}
                            </button>
                          </div>
                        </td>

                        <td className="py-3 pr-4 text-content">
                          <div className="flex items-center gap-2">
                            {isPositive ? (
                              <ArrowUpRight className="w-3.5 h-3.5 text-success shrink-0" aria-hidden="true" />
                            ) : (
                              <ArrowDownLeft className="w-3.5 h-3.5 text-brand-indigo shrink-0" aria-hidden="true" />
                            )}
                            <div>
                              <span className="font-medium">{safeOperation}</span>
                              {tx?.expiresAt && (
                                <div className="text-[11px] text-content-secondary mt-0.5">
                                  Expires {safeFormatLocalDateTime(tx.expiresAt)}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="py-3 pr-4 whitespace-nowrap">
                          {badge ? (
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] font-medium mono-metric ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                          ) : (
                            <span className="text-content-muted">-</span>
                          )}
                        </td>

                        <td className="py-3 pr-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-semibold mono-metric ${
                              isPositive
                                ? 'bg-success-bg text-success'
                                : 'bg-elevated text-content-secondary border border-line-subtle'
                            }`}
                          >
                            {isPositive ? `+${changeVal}` : changeVal}
                          </span>
                        </td>

                        <td className="py-3 pr-4 font-semibold text-content mono-metric whitespace-nowrap">
                          {safeBalance}
                        </td>

                        <td className="py-3 text-content-secondary mono-metric whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded-sm bg-elevated text-content-secondary">
                            {safeRef}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
