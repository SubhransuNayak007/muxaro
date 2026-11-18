'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertCircle,
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Download,
  Film,
  FolderArchive,
  Info,
  Layers,
  Link2,
  Loader2,
  Music,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { api } from '@/lib/api-client';
import { trackEvent } from '@/lib/analytics';
import {
  MediaBatch,
  ProcessingJob,
  QuotaStatus,
  JobState,
} from '@/lib/types';
import { formatBytes, formatUtcTimestamp } from '@/lib/formatters';
import JobProgress from '@/components/JobProgress';

const ACTIVE_STATES: ReadonlyArray<JobState> = [
  'CREATED',
  'VALIDATING',
  'QUEUED',
  'PROCESSING',
  'VERIFYING',
];

const AUDIO_FORMATS = new Set(['mp3', 'flac', 'wav', 'opus', 'aac', 'm4a', 'ogg']);
const DEFAULT_RETENTION_MINUTES = 60;
const POLL_INTERVAL_MS = 3000;

interface BatchGroupView {
  batchId: string;
  title: string;
  status: string;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  createdAt: string;
  zipDownloadUrl?: string | null;
  jobs: ProcessingJob[];
  hasActive: boolean;
}

function isActiveState(status: JobState): boolean {
  return ACTIVE_STATES.includes(status);
}

function formatItemNumber(itemNumber?: number | string, fallbackIndex?: number): string {
  if (typeof itemNumber === 'number' && Number.isFinite(itemNumber) && itemNumber > 0) {
    return String(Math.floor(itemNumber)).padStart(3, '0');
  }
  if (typeof itemNumber === 'string' && itemNumber.trim().length > 0) {
    const trimmed = itemNumber.trim();
    if (/^\d+$/.test(trimmed)) {
      return trimmed.padStart(3, '0');
    }
    return trimmed;
  }
  if (typeof fallbackIndex === 'number') {
    return String(fallbackIndex + 1).padStart(3, '0');
  }
  return '001';
}

function resolveDownloadUrl(job: ProcessingJob): string {
  if (
    typeof job.downloadUrl === 'string' &&
    job.downloadUrl.length > 0 &&
    !job.downloadUrl.startsWith('#')
  ) {
    return job.downloadUrl;
  }
  return `/api/v1/jobs/${encodeURIComponent(job.id)}/download`;
}

function resolveAbsoluteDownloadUrl(job: ProcessingJob): string {
  const path = resolveDownloadUrl(job);
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${path}`;
  }
  return path;
}

function getJobRetentionMinutes(job: ProcessingJob): number {
  if (
    typeof job.retentionMinutes === 'number' &&
    Number.isFinite(job.retentionMinutes) &&
    job.retentionMinutes > 0
  ) {
    return Math.round(job.retentionMinutes);
  }
  return DEFAULT_RETENTION_MINUTES;
}

function computeRemainingMs(job: ProcessingJob, nowMs: number): number | null {
  if (job.expiresAt) {
    const expMs = new Date(job.expiresAt).getTime();
    if (Number.isFinite(expMs)) {
      return Math.max(0, expMs - nowMs);
    }
  }
  const anchor = job.completedAt || job.createdAt;
  if (!anchor) return null;
  const anchorMs = new Date(anchor).getTime();
  if (!Number.isFinite(anchorMs)) return null;
  const windowMs = getJobRetentionMinutes(job) * 60 * 1000;
  return Math.max(0, anchorMs + windowMs - nowMs);
}

function formatRetentionLabel(remainingMs: number): string {
  if (remainingMs <= 0) return 'Expired';
  const totalMinutes = Math.ceil(remainingMs / 60000);
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return mins > 0 ? `${hours}h ${mins}m left` : `${hours}h left`;
  }
  return `${Math.max(1, totalMinutes)}m left`;
}

function mapFriendlyError(job: ProcessingJob): string {
  if (typeof job.userMessage === 'string' && job.userMessage.trim().length > 0) {
    return job.userMessage.trim();
  }
  const raw = (job.errorMessage || job.error || '').trim();
  if (!raw) {
    return 'This file could not be processed. Try again or pick a different format.';
  }
  const upper = raw.toUpperCase();
  if (upper.includes('TIMEOUT') || upper.includes('ETIMEDOUT')) {
    return 'The source took too long to respond. Please try again in a moment.';
  }
  if (upper.includes('RESOURCE_LIMIT') || upper.includes('MEMORY') || upper.includes('OOM')) {
    return 'This file was too large for the selected setting. Try again or choose a smaller quality.';
  }
  if (upper.includes('UNSUPPORTED') || upper.includes('CODEC') || upper.includes('INVALID_FORMAT')) {
    return 'This media format is not supported for the chosen output. Try converting to MP4 or MP3.';
  }
  if (upper.includes('QUOTA') || upper.includes('429') || upper.includes('RATE')) {
    return 'Your daily processing limit has been reached. Check Usage for your reset timer.';
  }
  if (upper.includes('403') || upper.includes('FORBIDDEN') || upper.includes('POLICY')) {
    return 'This media source cannot be accessed right now.';
  }
  if (upper.includes('404') || upper.includes('NOT_FOUND') || upper.includes('EXPIRED')) {
    return 'The source file is no longer available.';
  }
  if (/^[A-Z0-9_:-]+$/.test(raw)) {
    return 'Processing stopped unexpectedly. You can retry this job below.';
  }
  return raw;
}

// Retention countdown ring for completed files
function RetentionIndicator({
  job,
  nowMs,
}: {
  job: ProcessingJob;
  nowMs: number;
}) {
  const remainingMs = computeRemainingMs(job, nowMs);
  if (remainingMs === null) return null;

  const totalWindowMs = getJobRetentionMinutes(job) * 60 * 1000;
  const ratio = totalWindowMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalWindowMs)) : 0;
  const color =
    remainingMs <= 0
      ? 'var(--muxaro-error)'
      : ratio > 0.4
      ? 'var(--muxaro-success)'
      : ratio > 0.15
      ? 'var(--muxaro-warning)'
      : 'var(--muxaro-error)';

  const circumference = 2 * Math.PI * 9;
  const label = formatRetentionLabel(remainingMs);

  return (
    <div
      className="inline-flex items-center gap-1.5"
      title={
        remainingMs <= 0
          ? 'File removed after retention period'
          : `Available for ${label.replace(' left', '')}`
      }
    >
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <circle
          cx="11"
          cy="11"
          r="9"
          fill="none"
          stroke="var(--muxaro-border)"
          strokeWidth="2.2"
        />
        <circle
          cx="11"
          cy="11"
          r="9"
          fill="none"
          stroke={color}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          transform="rotate(-90 11 11)"
          style={{ transition: 'stroke-dashoffset 600ms ease' }}
        />
      </svg>
      <span className="text-xs font-medium mono-metric" style={{ color }}>
        {label}
      </span>
    </div>
  );
}

// Status Badge with Lucide icons (zero decorative dots)
function StatusBadge({ status, isExpired }: { status: JobState; isExpired?: boolean }) {
  if (status === 'READY' && isExpired) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium shrink-0"
        style={{
          backgroundColor: 'var(--muxaro-bg-elevated)',
          color: 'var(--muxaro-text-secondary)',
          borderRadius: 'var(--muxaro-radius-full)',
        }}
      >
        <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Expired</span>
      </span>
    );
  }

  const configMap: Record<
    JobState,
    { label: string; bg: string; color: string; icon: React.ReactNode }
  > = {
    READY: {
      label: 'Ready',
      bg: 'var(--muxaro-success-bg)',
      color: 'var(--muxaro-success)',
      icon: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    PROCESSING: {
      label: 'Processing',
      bg: 'var(--muxaro-info-bg)',
      color: 'var(--muxaro-info)',
      icon: <Loader2 className="w-3.5 h-3.5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />,
    },
    VERIFYING: {
      label: 'Finishing',
      bg: 'var(--muxaro-info-bg)',
      color: 'var(--muxaro-info)',
      icon: <ShieldCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    QUEUED: {
      label: 'Queued',
      bg: 'var(--muxaro-warning-bg)',
      color: 'var(--muxaro-warning)',
      icon: <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    VALIDATING: {
      label: 'Checking',
      bg: 'var(--muxaro-warning-bg)',
      color: 'var(--muxaro-warning)',
      icon: <Loader2 className="w-3.5 h-3.5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />,
    },
    CREATED: {
      label: 'Starting',
      bg: 'var(--muxaro-warning-bg)',
      color: 'var(--muxaro-warning)',
      icon: <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    FAILED: {
      label: 'Failed',
      bg: 'var(--muxaro-error-bg)',
      color: 'var(--muxaro-error)',
      icon: <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    CANCELLED: {
      label: 'Cancelled',
      bg: 'var(--muxaro-bg-elevated)',
      color: 'var(--muxaro-text-secondary)',
      icon: <Ban className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    REJECTED: {
      label: 'Unavailable',
      bg: 'var(--muxaro-error-bg)',
      color: 'var(--muxaro-error)',
      icon: <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
  };

  const cfg = configMap[status] ?? {
    label: 'Pending',
    bg: 'var(--muxaro-bg-elevated)',
    color: 'var(--muxaro-text-secondary)',
    icon: <Info className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
  };

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium shrink-0"
      style={{
        backgroundColor: cfg.bg,
        color: cfg.color,
        borderRadius: 'var(--muxaro-radius-full)',
      }}
    >
      {cfg.icon}
      <span>{cfg.label}</span>
    </span>
  );
}

// Media Format Icon
function FormatIcon({ format, jobType }: { format?: string; jobType?: string }) {
  const safeFormat = (format || '').toLowerCase();
  const isAudio = jobType === 'extract_audio' || AUDIO_FORMATS.has(safeFormat);

  return (
    <div
      className="flex items-center justify-center w-10 h-10 shrink-0"
      style={{
        background: 'var(--muxaro-gradient-subtle)',
        borderRadius: 'var(--muxaro-radius-sm)',
        border: '1px solid var(--muxaro-border)',
        color: 'var(--muxaro-indigo)',
      }}
      aria-hidden="true"
    >
      {isAudio ? <Music className="w-5 h-5" /> : <Film className="w-5 h-5" />}
    </div>
  );
}

// Clean Consumer File Card (supports optional zero-padded batch itemNumber & MXJ- ID in Details)
function FileCard({
  job,
  nowMs,
  itemNumberBadge,
  compact,
  onViewProgress,
  onCancel,
  onRetry,
  isCancelling,
  isRetrying,
  actionError,
}: {
  job: ProcessingJob;
  nowMs: number;
  itemNumberBadge?: string;
  compact?: boolean;
  onViewProgress: (job: ProcessingJob) => void;
  onCancel: (job: ProcessingJob) => void;
  onRetry: (job: ProcessingJob) => void;
  isCancelling: boolean;
  isRetrying: boolean;
  actionError?: string | null;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);
  const [copiedJobId, setCopiedJobId] = useState(false);

  const isActive = isActiveState(job.status);
  const isReady = job.status === 'READY';
  const isFailed = job.status === 'FAILED' || job.status === 'REJECTED';

  const remainingMs = isReady ? computeRemainingMs(job, nowMs) : null;
  const isExpired = isReady && remainingMs !== null && remainingMs <= 0;

  const displayName = job.outputFilename || job.inputTitle || 'Media file';
  const formatLabel = (job.targetFormat || 'file').toUpperCase();
  const hasRealProgress =
    typeof job.progress === 'number' &&
    Number.isFinite(job.progress) &&
    job.progress > 0;
  const clampedProgress = hasRealProgress
    ? Math.max(0, Math.min(100, Math.round(job.progress)))
    : 0;
  const downloadHref = resolveDownloadUrl(job);

  const copyLinkLabel = copiedLink ? 'Copied' : 'Copy link';
  const copyHashLabel = copiedHash ? 'Copied' : 'Copy';
  const copyJobIdLabel = copiedJobId ? 'Copied' : 'Copy';
  const cancelLabel = isCancelling ? 'Cancelling' : 'Cancel';
  const retryLabel = isRetrying ? 'Retrying' : 'Retry';

  const handleCopyLink = async () => {
    try {
      const fullUrl = resolveAbsoluteDownloadUrl(job);
      await navigator.clipboard.writeText(fullUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Clipboard unavailable
    }
  };

  const handleCopyHash = async () => {
    if (!job.checksumSha256) return;
    try {
      await navigator.clipboard.writeText(job.checksumSha256);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    } catch {
      // Clipboard unavailable
    }
  };

  const handleCopyJobId = async () => {
    try {
      await navigator.clipboard.writeText(job.id);
      setCopiedJobId(true);
      setTimeout(() => setCopiedJobId(false), 2000);
    } catch {
      // Clipboard unavailable
    }
  };

  return (
    <article
      className={
        compact
          ? 'py-4 flex flex-col gap-3 min-w-0'
          : 'muxaro-card p-5 flex flex-col gap-4 min-w-0'
      }
    >
      {/* Top row */}
      <div className="flex items-start gap-3 min-w-0">
        {itemNumberBadge ? (
          <div
            className="w-10 h-10 shrink-0 flex items-center justify-center text-xs font-semibold mono-metric"
            style={{
              backgroundColor: 'var(--muxaro-bg-elevated)',
              borderRadius: 'var(--muxaro-radius-sm)',
              border: '1px solid var(--muxaro-border)',
              color: 'var(--muxaro-text-secondary)',
            }}
            aria-label={`Batch item ${itemNumberBadge}`}
          >
            {itemNumberBadge}
          </div>
        ) : (
          <FormatIcon format={job.targetFormat} jobType={job.jobType} />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2 min-w-0">
            <h3
              className="text-sm font-semibold truncate min-w-0 flex-1"
              style={{ color: 'var(--muxaro-text-primary)' }}
              title={displayName}
            >
              {displayName}
            </h3>
            <StatusBadge status={job.status} isExpired={isExpired} />
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <span
              className="text-xs font-medium px-2 py-0.5 mono-metric"
              style={{
                backgroundColor: 'var(--muxaro-bg-elevated)',
                color: 'var(--muxaro-text-secondary)',
                borderRadius: 'var(--muxaro-radius-sm)',
              }}
            >
              {formatLabel}
            </span>
            {job.targetResolution && (
              <span
                className="text-xs"
                style={{ color: 'var(--muxaro-text-secondary)' }}
              >
                {job.targetResolution}
              </span>
            )}
            {typeof job.outputSizeBytes === 'number' &&
              Number.isFinite(job.outputSizeBytes) &&
              job.outputSizeBytes > 0 && (
                <span
                  className="text-xs mono-metric"
                  style={{ color: 'var(--muxaro-text-secondary)' }}
                >
                  {formatBytes(job.outputSizeBytes)}
                </span>
              )}
          </div>
        </div>
      </div>

      {/* Active job honest progress bar (GPU scaleX, never animates width) */}
      {isActive && (
        <div>
          <div
            className="w-full h-1.5 overflow-hidden"
            style={{
              backgroundColor: 'var(--muxaro-bg-elevated)',
              borderRadius: 'var(--muxaro-radius-full)',
            }}
            role="progressbar"
            aria-valuenow={hasRealProgress ? clampedProgress : undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${displayName} processing progress`}
          >
            <div
              className={`h-full w-full ${
                !hasRealProgress ? 'motion-safe:animate-pulse' : ''
              }`}
              style={{
                background: 'var(--muxaro-gradient-primary)',
                borderRadius: 'var(--muxaro-radius-full)',
                transformOrigin: 'left',
                transform: hasRealProgress
                  ? `scaleX(${clampedProgress / 100})`
                  : 'scaleX(0.25)',
                transition: 'transform 300ms ease',
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-2 mt-1.5 text-xs">
            <span
              className="truncate"
              style={{ color: 'var(--muxaro-text-secondary)' }}
            >
              {job.progressStage ||
                (job.status === 'QUEUED'
                  ? 'Waiting for next available slot'
                  : 'Processing on server')}
            </span>
            <span
              className="mono-metric shrink-0"
              style={{ color: 'var(--muxaro-text-primary)' }}
            >
              {hasRealProgress ? `${clampedProgress}%` : 'In queue'}
            </span>
          </div>
        </div>
      )}

      {/* Plain-English failure message */}
      {isFailed && (
        <p
          className="text-xs leading-relaxed px-3 py-2"
          style={{
            backgroundColor: 'var(--muxaro-error-bg)',
            color: 'var(--muxaro-error)',
            borderRadius: 'var(--muxaro-radius-sm)',
          }}
        >
          {mapFriendlyError(job)}
        </p>
      )}

      {/* Inline action error */}
      {actionError && (
        <p
          className="text-xs px-3 py-2"
          style={{
            backgroundColor: 'var(--muxaro-error-bg)',
            color: 'var(--muxaro-error)',
            borderRadius: 'var(--muxaro-radius-sm)',
          }}
          role="alert"
        >
          {actionError}
        </p>
      )}

      {/* Expandable technical details disclosure (unique Job ID MXJ-..., SHA-256, signed link) */}
      {detailsOpen && (
        <div
          className="px-3 py-2.5 space-y-2 text-xs"
          style={{
            backgroundColor: 'var(--muxaro-bg-elevated)',
            borderRadius: 'var(--muxaro-radius-sm)',
          }}
        >
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="shrink-0"
                style={{ color: 'var(--muxaro-text-secondary)' }}
              >
                Job ID
              </span>
              <code
                className="truncate mono-metric font-semibold"
                style={{ color: 'var(--muxaro-text-primary)' }}
                title={job.id}
              >
                {job.id}
              </code>
            </div>
            <button
              type="button"
              onClick={handleCopyJobId}
              className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 shrink-0 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
              style={{
                color: 'var(--muxaro-indigo)',
                borderRadius: 'var(--muxaro-radius-sm)',
              }}
              aria-label={`Copy job ID ${job.id}`}
            >
              {copiedJobId ? (
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>{copyJobIdLabel}</span>
            </button>
          </div>

          {job.batchId && (
            <div className="flex items-center justify-between gap-2">
              <span style={{ color: 'var(--muxaro-text-secondary)' }}>Batch ID</span>
              <code
                className="mono-metric"
                style={{ color: 'var(--muxaro-text-primary)' }}
              >
                {job.batchId}
              </code>
            </div>
          )}

          {job.strategyLabel && (
            <div className="flex items-center justify-between gap-2">
              <span style={{ color: 'var(--muxaro-text-secondary)' }}>
                Processing mode
              </span>
              <span
                className="font-medium"
                style={{ color: 'var(--muxaro-text-primary)' }}
              >
                {job.strategyLabel}
              </span>
            </div>
          )}

          {job.createdAt && (
            <div className="flex items-center justify-between gap-2">
              <span style={{ color: 'var(--muxaro-text-secondary)' }}>Created</span>
              <span style={{ color: 'var(--muxaro-text-primary)' }}>
                {formatUtcTimestamp(job.createdAt)}
              </span>
            </div>
          )}

          {isReady && job.checksumSha256 && (
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <ShieldCheck
                  className="w-3.5 h-3.5 shrink-0"
                  style={{ color: 'var(--muxaro-success)' }}
                  aria-hidden="true"
                />
                <span
                  className="shrink-0"
                  style={{ color: 'var(--muxaro-text-secondary)' }}
                >
                  SHA-256
                </span>
                <code
                  className="truncate mono-metric"
                  style={{ color: 'var(--muxaro-text-primary)' }}
                  title={job.checksumSha256}
                >
                  {job.checksumSha256.substring(0, 16)}
                </code>
              </div>
              <button
                type="button"
                onClick={handleCopyHash}
                className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 shrink-0 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
                style={{
                  color: 'var(--muxaro-indigo)',
                  borderRadius: 'var(--muxaro-radius-sm)',
                }}
                aria-label="Copy SHA-256 checksum"
              >
                {copiedHash ? (
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{copyHashLabel}</span>
              </button>
            </div>
          )}

          {isReady && !isExpired && (
            <div className="pt-1 flex justify-end">
              <button
                type="button"
                onClick={handleCopyLink}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
                style={{
                  border: '1px solid var(--muxaro-border)',
                  borderRadius: 'var(--muxaro-radius-sm)',
                  color: copiedLink
                    ? 'var(--muxaro-success)'
                    : 'var(--muxaro-text-secondary)',
                  backgroundColor: 'var(--muxaro-bg-surface)',
                }}
                aria-label={`Copy download link for ${displayName}`}
              >
                {copiedLink ? (
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{copyLinkLabel}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Card footer */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 pt-3 mt-auto"
        style={{ borderTop: '1px solid var(--muxaro-border-subtle)' }}
      >
        <div className="flex flex-wrap items-center gap-3">
          {isReady && <RetentionIndicator job={job} nowMs={nowMs} />}
          <button
            type="button"
            onClick={() => setDetailsOpen((prev) => !prev)}
            aria-expanded={detailsOpen}
            className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
            style={{
              color: 'var(--muxaro-text-secondary)',
              borderRadius: 'var(--muxaro-radius-sm)',
            }}
          >
            <span>Details</span>
            <ChevronDown
              className="w-3.5 h-3.5"
              style={{
                transform: detailsOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 150ms ease',
              }}
              aria-hidden="true"
            />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {isActive && (
            <>
              <button
                type="button"
                onClick={() => onViewProgress(job)}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
                style={{
                  border: '1px solid var(--muxaro-border)',
                  borderRadius: 'var(--muxaro-radius-sm)',
                  color: 'var(--muxaro-text-primary)',
                  backgroundColor: 'var(--muxaro-bg-surface)',
                }}
              >
                View status
              </button>
              <button
                type="button"
                onClick={() => onCancel(job)}
                disabled={isCancelling}
                className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  border: '1px solid var(--muxaro-border)',
                  borderRadius: 'var(--muxaro-radius-sm)',
                  color: 'var(--muxaro-error)',
                  backgroundColor: 'var(--muxaro-bg-surface)',
                }}
              >
                {isCancelling && (
                  <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" aria-hidden="true" />
                )}
                <span>{cancelLabel}</span>
              </button>
            </>
          )}

          {isReady && !isExpired && (
            <a
              href={downloadHref}
              download={job.outputFilename || 'media-file'}
              className="muxaro-btn-primary inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
              style={{
                textDecoration: 'none',
                borderRadius: 'var(--muxaro-radius-sm)',
              }}
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Download</span>
            </a>
          )}

          {isReady && isExpired && (
            <span
              className="text-xs font-medium"
              style={{ color: 'var(--muxaro-text-tertiary)' }}
            >
              Removed after retention window
            </span>
          )}

          {isFailed && (
            <button
              type="button"
              onClick={() => onRetry(job)}
              disabled={isRetrying}
              className="muxaro-btn-primary inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ borderRadius: 'var(--muxaro-radius-sm)' }}
            >
              {isRetrying ? (
                <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" aria-hidden="true" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>{retryLabel}</span>
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

// Batch Group Card (MXB-... grouping with 001/002/003 numbering + batch cancel)
function BatchGroupCard({
  batch,
  nowMs,
  onViewProgress,
  onCancelJob,
  onRetryJob,
  onCancelBatch,
  cancellingJobId,
  retryingJobId,
  cancellingBatchId,
  jobErrors,
  batchError,
}: {
  batch: BatchGroupView;
  nowMs: number;
  onViewProgress: (job: ProcessingJob) => void;
  onCancelJob: (job: ProcessingJob) => void;
  onRetryJob: (job: ProcessingJob) => void;
  onCancelBatch: (batchId: string) => void;
  cancellingJobId: string | null;
  retryingJobId: string | null;
  cancellingBatchId: string | null;
  jobErrors: Record<string, string>;
  batchError?: string | null;
}) {
  const [copiedBatchId, setCopiedBatchId] = useState(false);
  const isCancellingBatch = cancellingBatchId === batch.batchId;
  const copyBatchLabel = copiedBatchId ? 'Copied' : 'Copy ID';
  const cancelBatchLabel = isCancellingBatch ? 'Cancelling' : 'Cancel batch';

  const handleCopyBatchId = async () => {
    try {
      await navigator.clipboard.writeText(batch.batchId);
      setCopiedBatchId(true);
      setTimeout(() => setCopiedBatchId(false), 2000);
    } catch {
      // Clipboard unavailable
    }
  };

  return (
    <section className="muxaro-card p-5 space-y-4" aria-label={`Batch ${batch.batchId}`}>
      <div
        className="flex flex-wrap items-start justify-between gap-3 pb-3"
        style={{ borderBottom: '1px solid var(--muxaro-border)' }}
      >
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Layers
              className="w-4 h-4 shrink-0"
              style={{ color: 'var(--muxaro-indigo)' }}
              aria-hidden="true"
            />
            <h3
              className="text-sm font-semibold truncate"
              style={{ color: 'var(--muxaro-text-primary)' }}
            >
              {batch.title}
            </h3>
            <span
              className="text-xs font-medium px-2 py-0.5 mono-metric"
              style={{
                backgroundColor: 'var(--muxaro-bg-elevated)',
                color: 'var(--muxaro-text-secondary)',
                borderRadius: 'var(--muxaro-radius-full)',
              }}
            >
              {batch.completedItems}/{batch.totalItems} ready
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <code
              className="mono-metric font-medium"
              style={{ color: 'var(--muxaro-text-secondary)' }}
            >
              {batch.batchId}
            </code>
            <button
              type="button"
              onClick={handleCopyBatchId}
              className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
              style={{
                color: copiedBatchId
                  ? 'var(--muxaro-success)'
                  : 'var(--muxaro-indigo)',
                borderRadius: 'var(--muxaro-radius-sm)',
              }}
              aria-label={`Copy batch ID ${batch.batchId}`}
            >
              {copiedBatchId ? (
                <Check className="w-3 h-3" aria-hidden="true" />
              ) : (
                <Copy className="w-3 h-3" aria-hidden="true" />
              )}
              <span>{copyBatchLabel}</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {batch.zipDownloadUrl && batch.completedItems > 0 && (
            <a
              href={batch.zipDownloadUrl}
              download={`${batch.batchId}.zip`}
              className="muxaro-btn-primary inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
              style={{
                textDecoration: 'none',
                borderRadius: 'var(--muxaro-radius-sm)',
              }}
            >
              <FolderArchive className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Download ZIP</span>
            </a>
          )}
          {batch.hasActive && (
            <button
              type="button"
              onClick={() => onCancelBatch(batch.batchId)}
              disabled={isCancellingBatch}
              className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                border: '1px solid var(--muxaro-border)',
                borderRadius: 'var(--muxaro-radius-sm)',
                color: 'var(--muxaro-error)',
                backgroundColor: 'var(--muxaro-bg-surface)',
              }}
            >
              {isCancellingBatch && (
                <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" aria-hidden="true" />
              )}
              <span>{cancelBatchLabel}</span>
            </button>
          )}
        </div>
      </div>

      {batchError && (
        <p
          className="text-xs px-3 py-2"
          style={{
            backgroundColor: 'var(--muxaro-error-bg)',
            color: 'var(--muxaro-error)',
            borderRadius: 'var(--muxaro-radius-sm)',
          }}
          role="alert"
        >
          {batchError}
        </p>
      )}

      {/* Zero-padded 001 / 002 / 003 items inside batch (unified divider list, no nested cards) */}
      <div className="divide-y" style={{ borderColor: 'var(--muxaro-border-subtle)' }}>
        {batch.jobs.map((job, idx) => (
          <FileCard
            key={job.id}
            job={job}
            nowMs={nowMs}
            itemNumberBadge={formatItemNumber(job.itemNumber, idx)}
            compact
            onViewProgress={onViewProgress}
            onCancel={onCancelJob}
            onRetry={onRetryJob}
            isCancelling={cancellingJobId === job.id}
            isRetrying={retryingJobId === job.id}
            actionError={jobErrors[job.id]}
          />
        ))}
      </div>
    </section>
  );
}

// Empty State
function EmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 px-6 text-center"
      style={{
        backgroundColor: 'var(--muxaro-bg-surface)',
        border: '1px dashed var(--muxaro-border)',
        borderRadius: 'var(--muxaro-radius-lg)',
      }}
    >
      <div
        className="mb-4 flex items-center justify-center w-14 h-14"
        style={{
          background: 'var(--muxaro-gradient-subtle)',
          borderRadius: 'var(--muxaro-radius-lg)',
          color: 'var(--muxaro-indigo)',
        }}
        aria-hidden="true"
      >
        <Film className="w-6 h-6" />
      </div>
      <h2
        className="text-base font-semibold mb-1.5"
        style={{ color: 'var(--muxaro-text-primary)' }}
      >
        No downloads yet
      </h2>
      <p
        className="text-sm max-w-sm mb-6"
        style={{ color: 'var(--muxaro-text-secondary)' }}
      >
        Paste a media link or upload a file on the home page. Active jobs and completed downloads will appear here automatically.
      </p>
      <Link
        href="/"
        className="muxaro-btn-primary inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
        style={{
          textDecoration: 'none',
          borderRadius: 'var(--muxaro-radius-sm)',
        }}
      >
        <Plus className="w-4 h-4" aria-hidden="true" />
        <span>Process media</span>
      </Link>
    </div>
  );
}

// Honest Quota Pill (renders ONLY when real API quota data is loaded)
function QuotaPill({ quota }: { quota: QuotaStatus | null }) {
  if (!quota) return null;

  const limit = quota.individualVideosLimit;
  const remaining = quota.individualVideosRemaining;
  if (
    typeof limit !== 'number' ||
    !Number.isFinite(limit) ||
    limit <= 0 ||
    typeof remaining !== 'number' ||
    !Number.isFinite(remaining)
  ) {
    return null;
  }

  const safeRemaining = Math.max(0, remaining);
  const pct = Math.round((safeRemaining / limit) * 100);
  const color =
    pct > 50
      ? 'var(--muxaro-success)'
      : pct > 20
      ? 'var(--muxaro-warning)'
      : 'var(--muxaro-error)';

  return (
    <Link
      href="/credits"
      className="inline-flex items-center gap-2 px-3 py-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
      style={{
        backgroundColor: 'var(--muxaro-bg-surface)',
        border: '1px solid var(--muxaro-border)',
        borderRadius: 'var(--muxaro-radius-sm)',
        boxShadow: 'var(--muxaro-shadow-sm)',
        textDecoration: 'none',
      }}
    >
      <Clock className="w-3.5 h-3.5 shrink-0" style={{ color }} aria-hidden="true" />
      <span
        className="text-xs font-medium"
        style={{ color: 'var(--muxaro-text-primary)' }}
      >
        <span className="mono-metric font-semibold" style={{ color }}>
          {safeRemaining}
        </span>
        <span
          className="mono-metric"
          style={{ color: 'var(--muxaro-text-tertiary)' }}
        >
          /{limit}
        </span>{' '}
        daily uses
      </span>
    </Link>
  );
}

// Main Batch-Aware My Downloads Page
export default function DashboardPage() {
  const [history, setHistory] = useState<ProcessingJob[]>([]);
  const [batches, setBatches] = useState<MediaBatch[]>([]);
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [selectedJob, setSelectedJob] = useState<ProcessingJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [cancellingBatchId, setCancellingBatchId] = useState<string | null>(null);
  const [jobErrors, setJobErrors] = useState<Record<string, string>>({});
  const [batchErrors, setBatchErrors] = useState<Record<string, string>>({});
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const trackedOpenRef = useRef(false);

  // Fire dashboard_opened GA4 event once cleanly
  useEffect(() => {
    if (!trackedOpenRef.current) {
      trackedOpenRef.current = true;
      trackEvent('dashboard_opened');
    }
  }, []);

  const fetchWorkspaceData = useCallback(
    async (mode: 'initial' | 'manual' | 'poll') => {
      if (mode === 'initial') {
        setLoading(true);
      } else if (mode === 'manual') {
        setRefreshing(true);
      }

      try {
        const [jobsRes, batchesRes] = await Promise.all([
          api.getHistory(),
          api.listBatches().catch(() => [] as MediaBatch[]),
        ]);

        const normalizedJobs: ProcessingJob[] = Array.isArray(jobsRes) ? jobsRes : [];
        const normalizedBatches: MediaBatch[] = Array.isArray(batchesRes) ? batchesRes : [];

        setHistory(normalizedJobs);
        setBatches(normalizedBatches);
        setLoadError(null);
        setNowMs(Date.now());

        if (selectedJob) {
          const match = normalizedJobs.find((j) => j.id === selectedJob.id);
          if (match) {
            setSelectedJob(match);
          }
        }
      } catch (err: unknown) {
        if (mode !== 'poll') {
          const msg =
            err instanceof Error && err.message && !/^[A-Z0-9_:-]+$/.test(err.message)
              ? err.message
              : 'We could not load your downloads right now. Please check your connection and try again.';
          setLoadError(msg);
        }
      } finally {
        if (mode === 'initial') setLoading(false);
        if (mode === 'manual') setRefreshing(false);
      }
    },
    [selectedJob]
  );

  const fetchQuota = useCallback(async () => {
    try {
      const quotaResult = await api.getQuota();
      if (quotaResult && typeof quotaResult.individualVideosLimit === 'number') {
        setQuota(quotaResult);
      }
    } catch {
      // Omit quota pill silently if unavailable; never invent numbers
    }
  }, []);

  useEffect(() => {
    fetchWorkspaceData('initial');
    fetchQuota();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tick retention timers every 30s without network requests
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      setNowMs(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const safeHistory = useMemo(
    () => (Array.isArray(history) ? history : []),
    [history]
  );

  const safeBatches = useMemo(
    () => (Array.isArray(batches) ? batches : []),
    [batches]
  );

  // Group multi-file/playlist batches by Batch ID (MXB-...)
  const { batchGroups, standaloneJobs } = useMemo(() => {
    const batchMap = new Map<string, BatchGroupView>();

    for (const b of safeBatches) {
      const key = b.batchId || b.id;
      if (!key) continue;
      const seededJobs = Array.isArray(b.jobs) ? [...b.jobs] : [];
      batchMap.set(key, {
        batchId: key,
        title: b.title || `Batch ${key}`,
        status: b.status || 'QUEUED',
        totalItems: b.totalItems || seededJobs.length,
        completedItems: b.completedItems || 0,
        failedItems: b.failedItems || 0,
        createdAt: b.createdAt || '',
        zipDownloadUrl: b.zipDownloadUrl || null,
        jobs: seededJobs,
        hasActive: seededJobs.some((j) => isActiveState(j.status)),
      });
    }

    const singles: ProcessingJob[] = [];
    for (const job of safeHistory) {
      if (job.batchId) {
        const existing = batchMap.get(job.batchId);
        if (existing) {
          if (!existing.jobs.some((j) => j.id === job.id)) {
            existing.jobs.push(job);
          }
        } else {
          batchMap.set(job.batchId, {
            batchId: job.batchId,
            title: `Batch ${job.batchId}`,
            status: isActiveState(job.status) ? 'PROCESSING' : job.status,
            totalItems: 1,
            completedItems: job.status === 'READY' ? 1 : 0,
            failedItems: job.status === 'FAILED' ? 1 : 0,
            createdAt: job.createdAt,
            zipDownloadUrl: null,
            jobs: [job],
            hasActive: isActiveState(job.status),
          });
        }
      } else {
        singles.push(job);
      }
    }

    const groups = Array.from(batchMap.values()).map((group) => {
      group.jobs.sort((a, b) => {
        const numA = Number(a.itemNumber ?? 0);
        const numB = Number(b.itemNumber ?? 0);
        if (numA && numB) return numA - numB;
        return (a.createdAt || '').localeCompare(b.createdAt || '');
      });
      const readyCount = group.jobs.filter((j) => j.status === 'READY').length;
      const failCount = group.jobs.filter(
        (j) => j.status === 'FAILED' || j.status === 'REJECTED'
      ).length;
      return {
        ...group,
        totalItems: Math.max(group.totalItems, group.jobs.length),
        completedItems: Math.max(group.completedItems, readyCount),
        failedItems: Math.max(group.failedItems, failCount),
        hasActive:
          group.jobs.some((j) => isActiveState(j.status)) ||
          isActiveState(group.status as JobState),
      };
    });

    return { batchGroups: groups, standaloneJobs: singles };
  }, [safeHistory, safeBatches]);

  const activeStandaloneJobs = useMemo(
    () => standaloneJobs.filter((j) => isActiveState(j.status)),
    [standaloneJobs]
  );

  const completedStandaloneJobs = useMemo(
    () => standaloneJobs.filter((j) => !isActiveState(j.status)),
    [standaloneJobs]
  );

  const hasAnyActive =
    activeStandaloneJobs.length > 0 || batchGroups.some((g) => g.hasActive);

  // Auto-refresh every 3 seconds ONLY while any job or batch is active, pausing when tab is hidden
  useEffect(() => {
    if (!hasAnyActive) return;

    const pollIfVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      fetchWorkspaceData('poll');
    };

    const intervalId = setInterval(pollIfVisible, POLL_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchWorkspaceData('poll');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [hasAnyActive, fetchWorkspaceData]);

  const displayedRetentionMinutes = useMemo(() => {
    const withRetention = safeHistory.find(
      (j) =>
        typeof j.retentionMinutes === 'number' &&
        Number.isFinite(j.retentionMinutes) &&
        j.retentionMinutes > 0
    );
    return withRetention ? Math.round(withRetention.retentionMinutes!) : DEFAULT_RETENTION_MINUTES;
  }, [safeHistory]);

  const handleJobUpdate = useCallback(
    (updated: ProcessingJob) => {
      setHistory((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        return list.map((j) => (j.id === updated.id ? updated : j));
      });
      if (selectedJob?.id === updated.id) {
        setSelectedJob(updated);
      }
    },
    [selectedJob]
  );

  const handleCancelJob = useCallback(
    async (job: ProcessingJob) => {
      setCancellingId(job.id);
      setJobErrors((prev) => {
        const next = { ...prev };
        delete next[job.id];
        return next;
      });

      try {
        await api.cancelJob(job.id);
        await fetchWorkspaceData('poll');
        fetchQuota();
      } catch {
        setJobErrors((prev) => ({
          ...prev,
          [job.id]: 'Could not cancel this job right now. Please try again.',
        }));
      } finally {
        setCancellingId(null);
      }
    },
    [fetchWorkspaceData, fetchQuota]
  );

  const handleRetryJob = useCallback(
    async (job: ProcessingJob) => {
      setRetryingId(job.id);
      setJobErrors((prev) => {
        const next = { ...prev };
        delete next[job.id];
        return next;
      });

      try {
        await api.retryJob(job.id);
        await fetchWorkspaceData('poll');
      } catch (err: unknown) {
        const message =
          err instanceof Error && err.message && !/^[A-Z0-9_:-]+$/.test(err.message)
            ? err.message
            : 'Could not restart this job. Please start a new job from the home page.';
        setJobErrors((prev) => ({
          ...prev,
          [job.id]: message,
        }));
      } finally {
        setRetryingId(null);
      }
    },
    [fetchWorkspaceData]
  );

  const handleCancelBatch = useCallback(
    async (batchId: string) => {
      setCancellingBatchId(batchId);
      setBatchErrors((prev) => {
        const next = { ...prev };
        delete next[batchId];
        return next;
      });

      try {
        await api.cancelBatch(batchId);
        await fetchWorkspaceData('poll');
        fetchQuota();
      } catch (err: unknown) {
        setBatchErrors((prev) => ({
          ...prev,
          [batchId]:
            err instanceof Error
              ? err.message
              : 'Could not cancel this batch right now.',
        }));
      } finally {
        setCancellingBatchId(null);
      }
    },
    [fetchWorkspaceData, fetchQuota]
  );

  const handleManualRefresh = () => {
    fetchWorkspaceData('manual');
    fetchQuota();
  };

  const hasAnyItems = safeHistory.length > 0 || batchGroups.length > 0;
  const refreshLabel = refreshing ? 'Refreshing' : 'Refresh';

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--muxaro-bg-base)' }}>
      <div className="max-w-sheet mx-auto px-4 md:px-8 py-8 md:py-12">
        {/* Page header */}
        <header className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div className="min-w-0 max-w-2xl">
            <h1
              className="text-2xl sm:text-3xl font-bold"
              style={{
                color: 'var(--muxaro-text-primary)',
                letterSpacing: '-0.02em',
                lineHeight: '1.2',
              }}
            >
              My Downloads
            </h1>
            <p
              className="text-sm mt-1.5 leading-relaxed"
              style={{ color: 'var(--muxaro-text-secondary)' }}
            >
              Processing continues on our servers even if you close this tab.
            </p>
            <div
              className="inline-flex items-center gap-1.5 text-xs mt-1"
              style={{ color: 'var(--muxaro-text-tertiary)' }}
            >
              <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                Completed files stay available for {displayedRetentionMinutes} minutes.
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <QuotaPill quota={quota} />
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                border: '1px solid var(--muxaro-border)',
                borderRadius: 'var(--muxaro-radius-sm)',
                color: 'var(--muxaro-text-secondary)',
                backgroundColor: 'var(--muxaro-bg-surface)',
              }}
              aria-label="Refresh downloads"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${refreshing ? 'motion-safe:animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{refreshLabel}</span>
            </button>
            <Link
              href="/"
              className="muxaro-btn-primary inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
              style={{
                textDecoration: 'none',
                borderRadius: 'var(--muxaro-radius-sm)',
              }}
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>New media</span>
            </Link>
          </div>
        </header>

        {/* Honest API error banner with Retry */}
        {loadError && (
          <div
            className="mb-8 flex flex-wrap items-center justify-between gap-4 px-4 py-3.5"
            style={{
              backgroundColor: 'var(--muxaro-error-bg)',
              border: '1px solid var(--muxaro-error)',
              borderRadius: 'var(--muxaro-radius-md)',
            }}
            role="alert"
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <AlertCircle
                className="w-4 h-4 mt-0.5 shrink-0"
                style={{ color: 'var(--muxaro-error)' }}
                aria-hidden="true"
              />
              <p className="text-sm" style={{ color: 'var(--muxaro-text-primary)' }}>
                {loadError}
              </p>
            </div>
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundColor: 'var(--muxaro-bg-surface)',
                border: '1px solid var(--muxaro-border)',
                borderRadius: 'var(--muxaro-radius-sm)',
                color: 'var(--muxaro-text-primary)',
              }}
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* Inline job progress detail panel */}
        {selectedJob && isActiveState(selectedJob.status) && (
          <section className="mb-8" aria-label="Selected job progress">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2
                className="text-sm font-semibold"
                style={{ color: 'var(--muxaro-text-secondary)' }}
              >
                Live processing status
              </h2>
              <button
                type="button"
                onClick={() => setSelectedJob(null)}
                className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
                style={{
                  color: 'var(--muxaro-text-tertiary)',
                  borderRadius: 'var(--muxaro-radius-sm)',
                }}
                aria-label="Close live progress panel"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Dismiss</span>
              </button>
            </div>
            <JobProgress initialJob={selectedJob} onJobUpdate={handleJobUpdate} />
          </section>
        )}

        {/* Downloads content */}
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" aria-label="Loading downloads">
            {[0, 1].map((idx) => (
              <div
                key={idx}
                className="muxaro-card p-5 h-36 motion-safe:animate-pulse"
                aria-hidden="true"
              />
            ))}
          </div>
        ) : !loadError && !hasAnyItems ? (
          <EmptyState />
        ) : hasAnyItems ? (
          <div className="space-y-8">
            {/* Multi-file / Playlist Batches grouped by MXB-... */}
            {batchGroups.length > 0 && (
              <section aria-label="Playlist and multi-file batches" className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Layers
                      className="w-4 h-4 shrink-0"
                      style={{ color: 'var(--muxaro-indigo)' }}
                      aria-hidden="true"
                    />
                    <h2
                      className="text-sm font-semibold"
                      style={{ color: 'var(--muxaro-text-primary)' }}
                    >
                      Batches and playlists
                    </h2>
                    <span
                      className="text-xs font-medium px-2 py-0.5 mono-metric"
                      style={{
                        backgroundColor: 'var(--muxaro-info-bg)',
                        color: 'var(--muxaro-info)',
                        borderRadius: 'var(--muxaro-radius-full)',
                      }}
                    >
                      {batchGroups.length}
                    </span>
                  </div>
                </div>

                <div className="space-y-4">
                  {batchGroups.map((batch) => (
                    <BatchGroupCard
                      key={batch.batchId}
                      batch={batch}
                      nowMs={nowMs}
                      onViewProgress={setSelectedJob}
                      onCancelJob={handleCancelJob}
                      onRetryJob={handleRetryJob}
                      onCancelBatch={handleCancelBatch}
                      cancellingJobId={cancellingId}
                      retryingJobId={retryingId}
                      cancellingBatchId={cancellingBatchId}
                      jobErrors={jobErrors}
                      batchError={batchErrors[batch.batchId]}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Active standalone jobs */}
            {activeStandaloneJobs.length > 0 && (
              <section aria-label="Active processing jobs">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                  <div className="flex items-center gap-2">
                    <Activity
                      className="w-4 h-4 shrink-0"
                      style={{ color: 'var(--muxaro-info)' }}
                      aria-hidden="true"
                    />
                    <h2
                      className="text-sm font-semibold"
                      style={{ color: 'var(--muxaro-text-primary)' }}
                    >
                      In progress
                    </h2>
                    <span
                      className="text-xs font-medium px-2 py-0.5 mono-metric"
                      style={{
                        backgroundColor: 'var(--muxaro-info-bg)',
                        color: 'var(--muxaro-info)',
                        borderRadius: 'var(--muxaro-radius-full)',
                      }}
                    >
                      {activeStandaloneJobs.length}
                    </span>
                  </div>
                  <span
                    className="text-xs"
                    style={{ color: 'var(--muxaro-text-tertiary)' }}
                  >
                    Updates automatically every 3 seconds
                  </span>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {activeStandaloneJobs.map((job) => (
                    <FileCard
                      key={job.id}
                      job={job}
                      nowMs={nowMs}
                      onViewProgress={setSelectedJob}
                      onCancel={handleCancelJob}
                      onRetry={handleRetryJob}
                      isCancelling={cancellingId === job.id}
                      isRetrying={retryingId === job.id}
                      actionError={jobErrors[job.id]}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Completed & past standalone jobs */}
            {completedStandaloneJobs.length > 0 && (
              <section aria-label="Completed downloads">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                  <div className="flex items-center gap-2">
                    <h2
                      className="text-sm font-semibold"
                      style={{ color: 'var(--muxaro-text-primary)' }}
                    >
                      Recent files
                    </h2>
                    <span
                      className="text-xs font-medium px-2 py-0.5 mono-metric"
                      style={{
                        backgroundColor: 'var(--muxaro-bg-elevated)',
                        color: 'var(--muxaro-text-secondary)',
                        borderRadius: 'var(--muxaro-radius-full)',
                      }}
                    >
                      {completedStandaloneJobs.length}
                    </span>
                  </div>
                  <span
                    className="text-xs"
                    style={{ color: 'var(--muxaro-text-tertiary)' }}
                  >
                    Available for {displayedRetentionMinutes} minutes after completion
                  </span>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {completedStandaloneJobs.map((job) => (
                    <FileCard
                      key={job.id}
                      job={job}
                      nowMs={nowMs}
                      onViewProgress={setSelectedJob}
                      onCancel={handleCancelJob}
                      onRetry={handleRetryJob}
                      isCancelling={cancellingId === job.id}
                      isRetrying={retryingId === job.id}
                      actionError={jobErrors[job.id]}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : null}

        {/* Retention reassurance note */}
        {hasAnyItems && (
          <div
            className="mt-8 flex items-start gap-3 px-4 py-3.5"
            style={{
              backgroundColor: 'var(--muxaro-bg-surface)',
              border: '1px solid var(--muxaro-border)',
              borderRadius: 'var(--muxaro-radius-md)',
            }}
          >
            <Info
              className="w-4 h-4 mt-0.5 shrink-0"
              style={{ color: 'var(--muxaro-text-tertiary)' }}
              aria-hidden="true"
            />
            <p
              className="text-xs leading-relaxed"
              style={{ color: 'var(--muxaro-text-secondary)' }}
            >
              Server-side jobs keep running if you switch tabs or close your browser. Completed files are automatically removed {displayedRetentionMinutes} minutes after processing finishes.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
