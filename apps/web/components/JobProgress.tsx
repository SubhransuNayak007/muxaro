'use client';

import React, { useEffect, useState, useMemo, useRef, useId } from 'react';
import Link from 'next/link';
import { ProcessingJob, JobState } from '@/lib/types';
import { formatBytes } from '@/lib/formatters';
import { api } from '@/lib/api-client';
import {
  detectBackgroundDownloadSupport,
  getAutoDownloadPreference,
  setAutoDownloadPreference,
  startBackgroundDownload,
  mapFriendlyError,
  BackgroundDownloadCapabilities,
} from '@/lib/background-download';
import {
  CheckCircle2,
  Check,
  Copy,
  Download,
  AlertCircle,
  XCircle,
  Clock,
  FileVideo,
  FileAudio,
  Loader2,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Play,
  EyeOff,
  CloudDownload,
  RefreshCw,
} from 'lucide-react';

export interface JobProgressProps {
  initialJob: ProcessingJob;
  onJobUpdate?: (updated: ProcessingJob) => void;
  onDismiss?: () => void;
}

const MAX_POLL_RETRIES = 15;
const BASE_POLL_INTERVAL_MS = 2000;
const MAX_BACKOFF_INTERVAL_MS = 10000;

type ProcessingLane = 'instant' | 'smart' | 'power';

type ExtendedProcessingJob = ProcessingJob & {
  jobId?: string;
  stageMessage?: string;
  errorMessage?: string;
  errorCode?: string;
  userMessage?: string;
  processingLane?: ProcessingLane;
  strategyLabel?: string;
  losslessPreserved?: boolean;
  retentionMinutes?: number;
  artifact?: {
    filename?: string;
    sizeBytes?: number;
    checksumSha256?: string;
    downloadUrl?: string;
    container?: string;
    codec?: string;
  };
};

function isTerminalState(status: JobState | undefined): boolean {
  return (
    status === 'READY' ||
    status === 'FAILED' ||
    status === 'CANCELLED' ||
    status === 'REJECTED'
  );
}

function getFriendlyProgressMessage(
  job: ExtendedProcessingJob,
  isAudioOnly: boolean,
  safeProgress: number
): string {
  const op = (job.operation || '').toLowerCase();
  const isCompressing = op.includes('compress') || op === 'convert_format';

  if (job.status === 'VERIFYING' || safeProgress >= 85) {
    return 'Almost ready...';
  }
  if (job.status === 'QUEUED' || job.status === 'CREATED') {
    return 'Waiting for an available slot...';
  }
  if (isAudioOnly) {
    return 'Extracting your audio...';
  }
  if (isCompressing) {
    return 'Compressing your video...';
  }
  return 'Preparing your video...';
}

function formatLaneLabel(lane?: ProcessingLane): string {
  if (lane === 'instant') return 'Instant';
  if (lane === 'smart') return 'Smart';
  if (lane === 'power') return 'Power';
  return 'Standard';
}

function mergeBackendPayload(
  prev: ExtendedProcessingJob,
  raw: ExtendedProcessingJob
): ExtendedProcessingJob {
  const nextProgress = Number.isFinite(raw.progress)
    ? Math.max(0, Math.min(100, raw.progress))
    : prev.progress;

  return {
    ...prev,
    ...raw,
    id: raw.id || raw.jobId || prev.id,
    inputTitle: raw.inputTitle || prev.inputTitle,
    operation: raw.operation || prev.operation,
    targetFormat: raw.targetFormat || prev.targetFormat,
    targetResolution: raw.targetResolution || prev.targetResolution,
    status: raw.status || prev.status,
    progress: nextProgress,
    progressStage: raw.progressStage || raw.stageMessage || prev.progressStage,
    outputFilename:
      raw.outputFilename || raw.artifact?.filename || prev.outputFilename,
    outputSizeBytes:
      raw.outputSizeBytes ?? raw.artifact?.sizeBytes ?? prev.outputSizeBytes,
    checksumSha256:
      raw.checksumSha256 ||
      raw.artifact?.checksumSha256 ||
      prev.checksumSha256,
    downloadUrl:
      raw.downloadUrl || raw.artifact?.downloadUrl || prev.downloadUrl,
    error: raw.error || raw.errorMessage || prev.error,
    errorMessage: raw.errorMessage || prev.errorMessage,
    errorCode: raw.errorCode || prev.errorCode,
    userMessage: raw.userMessage || prev.userMessage,
    processingLane: raw.processingLane || prev.processingLane,
    strategyLabel: raw.strategyLabel || prev.strategyLabel,
    losslessPreserved:
      typeof raw.losslessPreserved === 'boolean'
        ? raw.losslessPreserved
        : prev.losslessPreserved,
    retentionMinutes:
      typeof raw.retentionMinutes === 'number' && raw.retentionMinutes > 0
        ? raw.retentionMinutes
        : prev.retentionMinutes,
  };
}

export default function JobProgress({
  initialJob,
  onJobUpdate,
  onDismiss,
}: JobProgressProps) {
  const [job, setJob] = useState<ExtendedProcessingJob>(
    initialJob as ExtendedProcessingJob
  );
  const [cancelling, setCancelling] = useState<boolean>(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<boolean>(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [downloadInitiated, setDownloadInitiated] = useState<boolean>(false);
  const [autoDownloadEnabled, setAutoDownloadEnabled] = useState<boolean>(false);
  const [autoDownloadTriggered, setAutoDownloadTriggered] =
    useState<boolean>(false);
  const [showDetails, setShowDetails] = useState<boolean>(false);
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [copiedHash, setCopiedHash] = useState<boolean>(false);
  const [bgStatusMessage, setBgStatusMessage] = useState<string | null>(null);
  const [bgCapabilities, setBgCapabilities] =
    useState<BackgroundDownloadCapabilities>({
      supported: false,
      ready: false,
      saveData: false,
      note: 'Processing continues safely on our servers even if you leave this page. Completed files stay available in My Downloads.',
    });

  const detailsId = useId();
  const autoDownloadId = useId();
  const jobRef = useRef<ExtendedProcessingJob>(
    initialJob as ExtendedProcessingJob
  );
  const onJobUpdateRef = useRef(onJobUpdate);
  const autoDownloadedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    onJobUpdateRef.current = onJobUpdate;
  }, [onJobUpdate]);

  // Read opt-in auto-download preference (default OFF) and detect Background Fetch support
  useEffect(() => {
    setAutoDownloadEnabled(getAutoDownloadPreference());
    let mounted = true;
    detectBackgroundDownloadSupport().then((caps) => {
      if (mounted) {
        setBgCapabilities(caps);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const ext = initialJob as ExtendedProcessingJob;
    setJob(ext);
    jobRef.current = ext;
    setCancelError(null);
    setRetryError(null);
    setShowPreview(false);
    setShowDetails(false);
    setBgStatusMessage(null);
    setAutoDownloadTriggered(autoDownloadedIdsRef.current.has(ext.id));
  }, [initialJob]);

  const isTerminal = isTerminalState(job.status);

  // Polite 2-second backend polling with backoff and tab-visibility pause
  useEffect(() => {
    if (!job.id || isTerminal) {
      return;
    }

    let active = true;
    let consecutiveFailures = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const clearPending = () => {
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
    };

    const scheduleNext = (delayMs: number) => {
      if (!active) return;
      clearPending();
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      timerId = setTimeout(pollOnce, delayMs);
    };

    const pollOnce = async () => {
      if (!active) return;

      try {
        const raw = (await api.getJob(job.id)) as ExtendedProcessingJob;
        if (!active) return;

        if (!raw || !raw.status) {
          throw new Error('Waiting for status update');
        }

        consecutiveFailures = 0;

        const merged = mergeBackendPayload(jobRef.current, raw);
        jobRef.current = merged;
        setJob(merged);
        onJobUpdateRef.current?.(merged);

        if (!isTerminalState(merged.status)) {
          scheduleNext(BASE_POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (!active) return;
        consecutiveFailures += 1;

        if (consecutiveFailures >= MAX_POLL_RETRIES) {
          const message = mapFriendlyError(
            err instanceof Error ? err.message : undefined
          );
          const failedJob: ExtendedProcessingJob = {
            ...jobRef.current,
            status: 'FAILED',
            error: message,
            userMessage: message,
          };
          jobRef.current = failedJob;
          setJob(failedJob);
          onJobUpdateRef.current?.(failedJob);
          return;
        }

        const backoffMs = Math.min(
          MAX_BACKOFF_INTERVAL_MS,
          Math.round(
            BASE_POLL_INTERVAL_MS *
              Math.pow(1.35, Math.min(consecutiveFailures, 6))
          )
        );
        scheduleNext(backoffMs);
      }
    };

    const handleVisibilityChange = () => {
      if (!active) return;
      if (document.visibilityState === 'visible') {
        scheduleNext(200);
      } else {
        clearPending();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    scheduleNext(500);

    return () => {
      active = false;
      clearPending();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [job.id, isTerminal]);

  const resolvedDownloadUrl = useMemo(() => {
    if (job.downloadUrl && !job.downloadUrl.startsWith('#')) {
      return job.downloadUrl;
    }
    if (!job.id) return '';
    return `/api/v1/jobs/${encodeURIComponent(job.id)}/download`;
  }, [job.downloadUrl, job.id]);

  const previewUrl = useMemo(() => {
    if (!resolvedDownloadUrl || resolvedDownloadUrl.startsWith('#')) {
      return '';
    }
    return resolvedDownloadUrl.includes('?')
      ? `${resolvedDownloadUrl}&inline=1`
      : `${resolvedDownloadUrl}?inline=1`;
  }, [resolvedDownloadUrl]);

  // Opt-in automatic download ONLY when user explicitly enabled it (default OFF), once per job.id
  useEffect(() => {
    if (
      autoDownloadEnabled &&
      job.status === 'READY' &&
      job.id &&
      resolvedDownloadUrl &&
      !resolvedDownloadUrl.startsWith('#') &&
      !autoDownloadedIdsRef.current.has(job.id)
    ) {
      autoDownloadedIdsRef.current.add(job.id);
      setAutoDownloadTriggered(true);
      try {
        const anchor = document.createElement('a');
        anchor.href = resolvedDownloadUrl;
        if (job.outputFilename) {
          anchor.download = job.outputFilename;
        } else {
          anchor.setAttribute('download', '');
        }
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
      } catch {
        // Primary Download button always remains available below
      }
    }
  }, [
    autoDownloadEnabled,
    job.status,
    job.id,
    job.outputFilename,
    resolvedDownloadUrl,
  ]);

  const handleToggleAutoDownload = () => {
    const next = !autoDownloadEnabled;
    setAutoDownloadEnabled(next);
    setAutoDownloadPreference(next);
  };

  const handleCancel = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      await api.cancelJob(job.id);
      const updated: ExtendedProcessingJob = {
        ...jobRef.current,
        status: 'CANCELLED',
      };
      jobRef.current = updated;
      setJob(updated);
      onJobUpdateRef.current?.(updated);
    } catch (err) {
      setCancelError(
        mapFriendlyError(err instanceof Error ? err.message : undefined)
      );
    } finally {
      setCancelling(false);
    }
  };

  const handleRetry = async () => {
    if (!job.id || retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const apiWithRetry = api as typeof api & {
        retryJob?: (jobId: string) => Promise<ProcessingJob>;
      };

      let raw: ExtendedProcessingJob;
      if (typeof apiWithRetry.retryJob === 'function') {
        raw = (await apiWithRetry.retryJob(job.id)) as ExtendedProcessingJob;
      } else {
        const response = await fetch(
          `/api/v1/jobs/${encodeURIComponent(job.id)}/retry`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
          }
        );
        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          throw new Error(
            errBody?.error?.userMessage ||
              errBody?.error?.message ||
              `HTTP_${response.status}`
          );
        }
        const json = await response.json();
        raw = (json.data !== undefined ? json.data : json) as ExtendedProcessingJob;
      }

      const nextJob: ExtendedProcessingJob = {
        ...mergeBackendPayload(jobRef.current, raw),
        status: raw.status && !isTerminalState(raw.status) ? raw.status : 'QUEUED',
        progress: Number.isFinite(raw.progress) ? raw.progress : 0,
        error: undefined,
        errorMessage: undefined,
        errorCode: undefined,
        userMessage: undefined,
      };
      jobRef.current = nextJob;
      setJob(nextJob);
      onJobUpdateRef.current?.(nextJob);
    } catch (err) {
      setRetryError(
        mapFriendlyError(err instanceof Error ? err.message : undefined)
      );
    } finally {
      setRetrying(false);
    }
  };

  const handleDownloadClick = () => {
    setDownloadInitiated(true);
    setTimeout(() => setDownloadInitiated(false), 3000);
  };

  const handleBackgroundDownload = async () => {
    if (!resolvedDownloadUrl || !job.id) return;
    const result = await startBackgroundDownload({
      id: job.id,
      url: resolvedDownloadUrl,
      title: friendlyTitle,
      filename: displayFilename,
      sizeBytes: job.outputSizeBytes,
    });
    setBgStatusMessage(result.message);
  };

  const handleCopyHash = async () => {
    if (!job.checksumSha256) return;
    try {
      await navigator.clipboard.writeText(job.checksumSha256);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2200);
    } catch {
      // Ignore clipboard failure in restricted contexts
    }
  };

  const hasRealProgress =
    Number.isFinite(job.progress) &&
    job.progress > 0 &&
    job.status !== 'CREATED' &&
    job.status !== 'QUEUED';
  const safeProgress = hasRealProgress
    ? Math.max(0, Math.min(100, Math.round(job.progress)))
    : 0;

  const isAudioOnly =
    job.jobType === 'extract_audio' ||
    ['mp3', 'flac', 'opus', 'aac', 'wav', 'm4a'].includes(
      (job.targetFormat || '').toLowerCase()
    );

  const formatUpper = (
    job.targetFormat || (isAudioOnly ? 'mp3' : 'mp4')
  ).toUpperCase();
  const friendlyTitle =
    job.inputTitle || (isAudioOnly ? 'Your audio' : 'Your video');
  const friendlyStatus = getFriendlyProgressMessage(
    job,
    isAudioOnly,
    safeProgress
  );
  const readyHeading = isAudioOnly
    ? 'Your audio is ready'
    : 'Your video is ready';
  const primaryDownloadLabel = isAudioOnly ? 'Download audio' : 'Download video';
  const downloadLabel = downloadInitiated
    ? 'Download started'
    : primaryDownloadLabel;
  const previewToggleLabel = showPreview
    ? 'Hide preview'
    : isAudioOnly
      ? 'Preview audio'
      : 'Preview video';
  const copyHashLabel = copiedHash ? 'Copied' : 'Copy';
  const retryButtonLabel = retrying ? 'Retrying...' : 'Try again';

  const fileSizeLabel =
    typeof job.outputSizeBytes === 'number' && job.outputSizeBytes > 0
      ? formatBytes(job.outputSizeBytes)
      : '';
  const displayFilename =
    job.outputFilename ||
    `${friendlyTitle}.${(
      job.targetFormat || (isAudioOnly ? 'mp3' : 'mp4')
    ).toLowerCase()}`;
  const retentionMinutes =
    typeof job.retentionMinutes === 'number' && job.retentionMinutes > 0
      ? Math.round(job.retentionMinutes)
      : 60;
  const checksumValue = job.checksumSha256 || '';
  const checksumPreview = checksumValue
    ? `${checksumValue.slice(0, 12)}…${checksumValue.slice(-8)}`
    : '';
  const friendlyErrorMessage =
    job.userMessage || mapFriendlyError(job.error || job.errorMessage, job.errorCode);
  const laneDisplay = formatLaneLabel(job.processingLane);

  return (
    <section
      aria-label="Media progress"
      className="w-full bg-surface border border-line rounded-2xl shadow-md p-5 sm:p-6 text-content"
    >
      {/* In-Progress View */}
      {!isTerminal && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-brand"
                style={{ backgroundImage: 'var(--muxaro-gradient-subtle)' }}
              >
                {isAudioOnly ? (
                  <FileAudio className="w-5 h-5" aria-hidden="true" />
                ) : (
                  <FileVideo className="w-5 h-5" aria-hidden="true" />
                )}
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-content truncate">
                  {friendlyTitle}
                </h3>
                <p className="text-xs text-content-secondary flex items-center gap-1.5 mt-0.5">
                  <Loader2
                    className="w-3.5 h-3.5 motion-safe:animate-spin text-brand flex-shrink-0"
                    aria-hidden="true"
                  />
                  <span>{friendlyStatus}</span>
                </p>
              </div>
            </div>

            <span className="mono-metric text-sm font-semibold text-content flex-shrink-0">
              {hasRealProgress ? `${safeProgress}%` : 'Starting'}
            </span>
          </div>

          {/* Honest Progress Bar: calm indeterminate state while queued/0%, scaleX once backend reports % */}
          <div
            className="w-full h-2.5 rounded-full bg-surface-elevated overflow-hidden"
            role="progressbar"
            aria-valuenow={hasRealProgress ? safeProgress : undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={friendlyStatus}
          >
            {hasRealProgress ? (
              <div
                className="h-full w-full origin-left rounded-full"
                style={{
                  backgroundImage: 'var(--muxaro-gradient-primary)',
                  transform: `scaleX(${safeProgress / 100})`,
                  transition: 'transform 350ms cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              />
            ) : (
              <div
                className="h-full w-full rounded-full opacity-60 motion-safe:animate-pulse"
                style={{
                  backgroundImage: 'var(--muxaro-gradient-primary)',
                }}
              />
            )}
          </div>

          {cancelError && (
            <div className="p-3 rounded-lg bg-error-bg text-error text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              <span>{cancelError}</span>
            </div>
          )}

          {/* Opt-In Auto-Download Toggle (Default: OFF) + Cancel */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <div className="inline-flex items-center gap-2.5">
              <button
                id={autoDownloadId}
                type="button"
                role="switch"
                aria-checked={autoDownloadEnabled}
                aria-label="Automatically download when ready"
                onClick={handleToggleAutoDownload}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors duration-150 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
                  autoDownloadEnabled ? 'bg-brand' : 'bg-line'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-3.5 w-3.5 rounded-full bg-surface shadow-sm"
                  style={{
                    transform: autoDownloadEnabled
                      ? 'translateX(18px)'
                      : 'translateX(3px)',
                    transition: 'transform 150ms ease',
                  }}
                />
              </button>
              <label
                htmlFor={autoDownloadId}
                className="text-xs text-content-secondary hover:text-content cursor-pointer select-none"
              >
                Automatically download when ready
              </label>
            </div>

            <button
              type="button"
              disabled={cancelling}
              onClick={handleCancel}
              className="whitespace-nowrap self-start sm:self-center inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-line bg-surface text-content-secondary hover:text-error hover:border-error active:opacity-90 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-60"
            >
              <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{cancelling ? 'Cancelling...' : 'Cancel'}</span>
            </button>
          </div>

          {/* Honest Server-Side Persistence Note */}
          <p className="text-xs text-content-secondary pt-3 border-t border-line-subtle">
            Processing continues safely on our servers even if you leave this page. Completed files stay available in{' '}
            <Link
              href="/dashboard"
              className="whitespace-nowrap font-medium text-brand hover:underline active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-sm"
            >
              My Downloads
            </Link>
            .
          </p>
        </div>
      )}

      {/* Clean Ready Completion Screen */}
      {job.status === 'READY' && (
        <div className="space-y-5">
          {/* Success Header */}
          <div className="flex items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="flex-shrink-0 w-11 h-11 rounded-full bg-success text-[var(--muxaro-btn-fg)] flex items-center justify-center shadow-sm">
                <CheckCircle2 className="w-6 h-6" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-content">{readyHeading}</h3>
                <p className="text-xs sm:text-sm text-content-secondary">
                  {autoDownloadTriggered
                    ? 'Your download started automatically. Click below if you need it again.'
                    : 'Your file is ready to save to your device.'}
                </p>
              </div>
            </div>

            {job.losslessPreserved === true && (
              <span className="whitespace-nowrap hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-success-bg text-success">
                Original quality preserved
              </span>
            )}
          </div>

          {/* Clean File Summary Row (Name, Format, Resolution, Size) */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-4 py-3.5 rounded-xl bg-surface-elevated">
            <div className="flex items-center gap-2.5 min-w-0">
              {isAudioOnly ? (
                <FileAudio
                  className="w-4 h-4 text-brand flex-shrink-0"
                  aria-hidden="true"
                />
              ) : (
                <FileVideo
                  className="w-4 h-4 text-brand flex-shrink-0"
                  aria-hidden="true"
                />
              )}
              <span
                className="text-sm font-semibold text-content truncate"
                title={displayFilename}
              >
                {displayFilename}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
              <span className="inline-flex items-center px-2 py-0.5 rounded-sm bg-surface text-xs font-medium text-brand border border-line-subtle">
                {formatUpper}
              </span>
              {!isAudioOnly && job.targetResolution && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-sm bg-surface text-xs font-medium text-content-secondary border border-line-subtle">
                  {job.targetResolution}
                </span>
              )}
              {fileSizeLabel && (
                <span className="mono-metric text-xs font-semibold text-content">
                  {fileSizeLabel}
                </span>
              )}
            </div>
          </div>

          {/* Primary Download CTA + Optional Background Fetch + Process Another */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <a
              href={resolvedDownloadUrl}
              download={job.outputFilename || true}
              onClick={handleDownloadClick}
              className="muxaro-btn-primary whitespace-nowrap flex-1 inline-flex items-center justify-center gap-2 px-6 py-3.5 text-sm sm:text-base font-semibold active:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface cursor-pointer"
            >
              {downloadInitiated ? (
                <Check className="w-5 h-5" aria-hidden="true" />
              ) : (
                <Download className="w-5 h-5" aria-hidden="true" />
              )}
              <span>{downloadLabel}</span>
            </a>

            {bgCapabilities.ready && (
              <button
                type="button"
                onClick={handleBackgroundDownload}
                className="whitespace-nowrap inline-flex items-center justify-center gap-1.5 px-4 py-3.5 rounded-lg border border-line bg-surface text-xs font-semibold text-content hover:bg-surface-muted active:opacity-90 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <CloudDownload className="w-4 h-4 text-brand" aria-hidden="true" />
                <span>Save in background</span>
              </button>
            )}

            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="whitespace-nowrap inline-flex items-center justify-center gap-1.5 px-4 py-3.5 rounded-lg border border-line bg-surface text-xs font-medium text-content-secondary hover:text-content hover:bg-surface-muted active:opacity-90 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Process another</span>
              </button>
            )}
          </div>

          {bgStatusMessage && (
            <p className="text-xs text-content-secondary">{bgStatusMessage}</p>
          )}

          {/* Optional On-Demand Media Preview (NEVER auto-loaded to save mobile/Save-Data bandwidth) */}
          {showPreview &&
            previewUrl &&
            (isAudioOnly ? (
              <div className="p-4 rounded-xl bg-surface-elevated border border-line">
                <audio
                  controls
                  preload="metadata"
                  aria-label={displayFilename}
                  className="w-full"
                  src={previewUrl}
                />
              </div>
            ) : (
              <video
                controls
                preload="metadata"
                playsInline
                poster="/brand/og-image.png"
                aria-label={displayFilename}
                className="w-full max-h-80 rounded-xl bg-surface-elevated border border-line"
                src={previewUrl}
              />
            ))}

          {/* Retention Line + On-Demand Preview Toggle + Collapsed-by-Default File Details */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-line-subtle text-xs text-content-secondary">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-brand flex-shrink-0" aria-hidden="true" />
              <span>Available for {retentionMinutes} minutes</span>
            </span>

            <div className="flex flex-wrap items-center gap-3">
              {previewUrl && (
                <button
                  type="button"
                  aria-expanded={showPreview}
                  onClick={() => setShowPreview((prev) => !prev)}
                  className="whitespace-nowrap inline-flex items-center gap-1.5 font-medium text-content-secondary hover:text-content active:opacity-80 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-sm px-1 py-0.5"
                >
                  {showPreview ? (
                    <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                  ) : (
                    <Play className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>{previewToggleLabel}</span>
                </button>
              )}

              <button
                type="button"
                aria-expanded={showDetails}
                aria-controls={detailsId}
                onClick={() => setShowDetails((prev) => !prev)}
                className="whitespace-nowrap inline-flex items-center gap-1 font-medium text-content-secondary hover:text-content active:opacity-80 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-sm px-1 py-0.5"
              >
                <span>File details</span>
                {showDetails ? (
                  <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {bgCapabilities.saveData && !showPreview && (
            <p className="text-xs text-content-muted">
              Data Saver is on, so preview loads only when opened.
            </p>
          )}

          {/* Expandable File Details Disclosure (Collapsed by default) */}
          {showDetails && (
            <dl
              id={detailsId}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl bg-surface-elevated text-xs"
            >
              <div>
                <dt className="text-content-secondary">Processing lane</dt>
                <dd className="font-medium text-content mt-0.5">
                  {laneDisplay}
                  {job.strategyLabel ? ` (${job.strategyLabel})` : ''}
                </dd>
              </div>

              <div>
                <dt className="text-content-secondary">Verification</dt>
                <dd className="font-medium text-content mt-0.5">
                  {job.losslessPreserved === true
                    ? `Original quality preserved (${formatUpper})`
                    : `${formatUpper} container verified`}
                </dd>
              </div>

              <div>
                <dt className="text-content-secondary">Job ID</dt>
                <dd className="mono-metric text-content mt-0.5 truncate" title={job.id}>
                  {job.id}
                </dd>
              </div>

              <div>
                <dt className="flex items-center justify-between gap-2 text-content-secondary">
                  <span>SHA-256 checksum</span>
                  {checksumValue && (
                    <button
                      type="button"
                      onClick={handleCopyHash}
                      className="whitespace-nowrap inline-flex items-center gap-1 font-medium text-brand hover:underline active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-sm px-1"
                    >
                      {copiedHash ? (
                        <Check className="w-3 h-3 text-success" aria-hidden="true" />
                      ) : (
                        <Copy className="w-3 h-3" aria-hidden="true" />
                      )}
                      <span>{copyHashLabel}</span>
                    </button>
                  )}
                </dt>
                <dd
                  className="mono-metric text-content mt-0.5 truncate"
                  title={checksumValue || undefined}
                >
                  {checksumPreview || 'Not available'}
                </dd>
              </div>
            </dl>
          )}
        </div>
      )}

      {/* Cancelled View */}
      {job.status === 'CANCELLED' && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <XCircle
              className="w-5 h-5 flex-shrink-0 text-warning mt-0.5"
              aria-hidden="true"
            />
            <div>
              <h3 className="text-sm font-semibold text-content">
                Processing cancelled
              </h3>
              <p className="text-xs text-content-secondary mt-0.5">
                No file was saved and your daily allowance was restored.
              </p>
            </div>
          </div>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="whitespace-nowrap self-start sm:self-center text-xs font-semibold text-brand hover:underline active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-sm px-1"
            >
              Process another
            </button>
          )}
        </div>
      )}

      {/* Failed / Rejected View with Real Retry */}
      {(job.status === 'FAILED' || job.status === 'REJECTED') && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-error-bg text-xs text-content flex items-start gap-3">
            <AlertCircle
              className="w-5 h-5 flex-shrink-0 text-error mt-0.5"
              aria-hidden="true"
            />
            <div className="space-y-1">
              <div className="font-semibold text-sm text-content">
                Something went wrong
              </div>
              <p className="text-content-secondary">{friendlyErrorMessage}</p>
            </div>
          </div>

          {retryError && (
            <p className="text-xs text-error">{retryError}</p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3">
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="whitespace-nowrap px-3.5 py-2 rounded-lg border border-line bg-surface text-xs font-medium text-content-secondary hover:text-content hover:bg-surface-muted active:opacity-90 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Choose another file
              </button>
            )}
            <button
              type="button"
              disabled={retrying}
              onClick={handleRetry}
              className="muxaro-btn-primary whitespace-nowrap inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold active:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-60"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${retrying ? 'motion-safe:animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{retryButtonLabel}</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
