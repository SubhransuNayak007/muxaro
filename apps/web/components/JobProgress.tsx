'use client';

import React, { useEffect, useState, useMemo, useRef, useId } from 'react';
import Link from 'next/link';
import { ProcessingJob, JobState } from '@/lib/types';
import { formatBytes } from '@/lib/formatters';
import { api, getApiBaseUrl } from '@/lib/api-client';
import { detectPlatform, formatDisplayUrl } from '@/lib/url-utils';
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
  Zap,
  ExternalLink,
} from 'lucide-react';

export interface JobProgressProps {
  initialJob: ProcessingJob;
  onJobUpdate?: (updated: ProcessingJob) => void;
  onDismiss?: () => void;
  sourceUrl?: string;
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
  etaSeconds?: number;
  speed?: string;
  stage?: string;
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
    return 'Finalizing stream muxing…';
  }
  if (job.status === 'QUEUED' || job.status === 'CREATED') {
    return 'Allocating stream copy slot…';
  }
  if (isAudioOnly) {
    return 'Extracting lossless audio track…';
  }
  if (isCompressing) {
    return 'Remuxing video streams…';
  }
  return 'Lossless stream copy in progress…';
}

function formatLaneLabel(lane?: ProcessingLane): string {
  if (lane === 'instant') return 'Direct Fast-Path';
  if (lane === 'smart') return 'Smart Stream';
  if (lane === 'power') return 'Power Remux';
  return 'Lossless Studio';
}

export const PROGRESS_STAGES = [
  { key: 'preparing', label: 'Preparing', desc: 'Stream probe & manifest' },
  { key: 'downloading', label: 'Downloading Streams', desc: 'Lossless DASH chunks' },
  { key: 'merging', label: 'FFmpeg Muxing', desc: 'Direct stream copy (-c copy)' },
  { key: 'ready', label: 'Ready', desc: 'Verified & ready to save' },
] as const;

export function computeStageIndex(job: ExtendedProcessingJob): number {
  if (job.status === 'READY') return 3;
  const rawStage = (job.progressStage || job.stageMessage || '').toLowerCase();
  const progress = Number.isFinite(job.progress) ? job.progress : 0;

  if (
    rawStage.includes('merge') ||
    rawStage.includes('ffmpeg') ||
    rawStage.includes('mux') ||
    rawStage.includes('transcode') ||
    progress >= 75
  ) {
    return 2;
  }
  if (
    rawStage.includes('download') ||
    rawStage.includes('video') ||
    rawStage.includes('audio') ||
    progress >= 15
  ) {
    return 1;
  }
  return 0;
}

function mergeBackendPayload(
  prev: ExtendedProcessingJob,
  raw: ExtendedProcessingJob
): ExtendedProcessingJob {
  const nextProgress = Number.isFinite(raw.progress)
    ? Math.max(0, Math.min(100, raw.progress))
    : prev.progress;

  const errCode =
    raw.errorCode ||
    (typeof raw.error === 'object' && raw.error !== null
      ? (raw.error as any).code
      : undefined) ||
    prev.errorCode;

  const errMsg =
    raw.errorMessage ||
    (typeof raw.error === 'object' && raw.error !== null
      ? (raw.error as any).message
      : typeof raw.error === 'string'
      ? raw.error
      : undefined) ||
    prev.errorMessage ||
    (typeof prev.error === 'string' ? prev.error : undefined);

  const uMsg =
    raw.userMessage ||
    (typeof raw.error === 'object' && raw.error !== null
      ? (raw.error as any).userMessage
      : undefined) ||
    prev.userMessage;

  return {
    ...prev,
    ...raw,
    id: raw.id || raw.jobId || prev.id,
    sourceUrl: raw.sourceUrl || (raw as any).mediaUrl || prev.sourceUrl,
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
    error: errMsg || raw.error || prev.error,
    errorMessage: errMsg,
    errorCode: errCode,
    userMessage: uMsg,
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
    etaSeconds:
      typeof raw.etaSeconds === 'number' ? raw.etaSeconds : prev.etaSeconds,
    speed: raw.speed || prev.speed,
    stage: raw.stage || prev.stage,
  };
}

export default function JobProgress({
  initialJob,
  onJobUpdate,
  onDismiss,
  sourceUrl: propSourceUrl,
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
  const [isDirectActive, setIsDirectActive] = useState<boolean>(false);
  const [serverlessRoutingDetected, setServerlessRoutingDetected] =
    useState<boolean>(false);
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
  const startTimeRef = useRef<number>(Date.now());

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

  // Detect MUXARO Direct companion bridge status
  useEffect(() => {
    function checkDirect() {
      if (
        typeof window !== 'undefined' &&
        ((window as any).__MUXARO_DIRECT_ACTIVE__ === true ||
          document.documentElement.getAttribute('data-muxaro-direct') === 'active')
      ) {
        setIsDirectActive(true);
      }
    }
    checkDirect();
    window.addEventListener('muxaro:direct-ready', checkDirect);
    return () => window.removeEventListener('muxaro:direct-ready', checkDirect);
  }, []);

  useEffect(() => {
    const ext = initialJob as ExtendedProcessingJob;
    setJob(ext);
    jobRef.current = ext;
    startTimeRef.current = Date.now();
    setCancelError(null);
    setRetryError(null);
    setShowPreview(false);
    setShowDetails(false);
    setBgStatusMessage(null);
    setServerlessRoutingDetected(false);
    setAutoDownloadTriggered(autoDownloadedIdsRef.current.has(ext.id));
  }, [initialJob]);

  const isTerminal = isTerminalState(job.status);

  // Real-time SSE streaming from backend (/v1/jobs/:id/events or /api/v1/jobs/:id/events)
  useEffect(() => {
    if (!job.id || isTerminal) {
      return;
    }

    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
      return;
    }

    let es: EventSource | null = null;
    let cancelled = false;

    try {
      const apiBase = getApiBaseUrl();
      const sseUrl = `${apiBase}/jobs/${encodeURIComponent(job.id)}/events`;
      es = new EventSource(sseUrl, { withCredentials: true });

      const handleProgressEvent = (e: MessageEvent) => {
        if (cancelled || !e.data) return;
        try {
          const payload = JSON.parse(e.data);
          const rawStatus = String(payload.status || '').toUpperCase();
          const nextStatus: JobState =
            rawStatus === 'COMPLETED' || rawStatus === 'READY'
              ? 'READY'
              : rawStatus === 'PROCESSING'
              ? 'PROCESSING'
              : rawStatus === 'FAILED'
              ? 'FAILED'
              : rawStatus === 'CANCELLED'
              ? 'CANCELLED'
              : 'QUEUED';

          const rawProgress = Number(payload.progressPercent ?? payload.progress);
          const nextProgress = Number.isFinite(rawProgress)
            ? Math.max(0, Math.min(100, Math.round(rawProgress)))
            : nextStatus === 'READY'
            ? 100
            : jobRef.current.progress;

          const updated: ExtendedProcessingJob = {
            ...jobRef.current,
            status: nextStatus,
            progress: nextProgress,
            progressStage:
              payload.message ||
              payload.stageMessage ||
              payload.stage ||
              (nextStatus === 'READY' ? 'Ready to download' : jobRef.current.progressStage),
            downloadUrl: payload.downloadUrl || jobRef.current.downloadUrl,
            outputFilename: payload.filename || payload.outputFilename || jobRef.current.outputFilename,
            outputSizeBytes: payload.sizeBytes ?? payload.outputSizeBytes ?? jobRef.current.outputSizeBytes,
            error: payload.errorMessage || jobRef.current.error,
            errorMessage: payload.errorMessage || jobRef.current.errorMessage,
            errorCode: payload.errorCode || jobRef.current.errorCode,
            etaSeconds:
              typeof payload.etaSeconds === 'number'
                ? payload.etaSeconds
                : typeof payload.eta === 'number'
                ? payload.eta
                : jobRef.current.etaSeconds,
            speed: payload.speed || payload.rate || jobRef.current.speed,
            stage: payload.stage || jobRef.current.stage,
          };
          jobRef.current = updated;
          setJob(updated);
          onJobUpdateRef.current?.(updated);
        } catch {
          // Safe JSON parse fallback
        }
      };

      es.addEventListener('progress', handleProgressEvent);
      es.addEventListener('done', (e: MessageEvent) => {
        handleProgressEvent(e);
        if (es) {
          es.close();
          es = null;
        }
      });

      es.onerror = () => {
        // Fall back to polling silently on SSE disconnection
        if (es) {
          es.close();
          es = null;
        }
      };
    } catch {
      // Fallback polling handles updates
    }

    return () => {
      cancelled = true;
      if (es) {
        es.close();
        es = null;
      }
    };
  }, [job.id, isTerminal]);

  // Serverless-Proof 2-second backend polling with backoff and tab-visibility pause
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
        setServerlessRoutingDetected(false);

        const merged = mergeBackendPayload(jobRef.current, raw);
        jobRef.current = merged;
        setJob(merged);
        onJobUpdateRef.current?.(merged);

        if (!isTerminalState(merged.status)) {
          scheduleNext(BASE_POLL_INTERVAL_MS);
        }
      } catch (err: unknown) {
        if (!active) return;
        consecutiveFailures += 1;

        const anyErr = err as any;
        const is404 =
          anyErr?.status === 404 ||
          anyErr?.statusCode === 404 ||
          String(anyErr?.message || '').includes('404') ||
          String(anyErr?.message || '').toUpperCase().includes('NOT_FOUND') ||
          String(anyErr?.code || '').toUpperCase().includes('NOT_FOUND');

        if (is404) {
          // SERVERLESS-PROOF PROGRESS:
          // In distributed serverless environments (Vercel, Cloudflare, AWS Lambdas),
          // polling can receive 404 due to multi-instance routing or in-memory persistence.
          // DO NOT transition to 'failed'! Instead, retry with backoff and provide direct fallback download.
          setServerlessRoutingDetected(true);
          const backoffMs = Math.min(
            MAX_BACKOFF_INTERVAL_MS,
            Math.round(
              BASE_POLL_INTERVAL_MS * Math.pow(1.2, Math.min(consecutiveFailures, 6))
            )
          );
          scheduleNext(backoffMs);
          return;
        }

        if (consecutiveFailures >= MAX_POLL_RETRIES) {
          // Never leave the user stuck on an unrecoverable failure.
          // Transition with direct fallback download availability.
          const fallbackMsg =
            'Serverless routing in progress — stream available for direct save below.';
          const failedJob: ExtendedProcessingJob = {
            ...jobRef.current,
            status: 'FAILED',
            error: fallbackMsg,
            userMessage: fallbackMsg,
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

  const directTargetUrl =
    job.sourceUrl ||
    (job as any).mediaUrl ||
    propSourceUrl ||
    '';

  const directFallbackUrl = useMemo(() => {
    if (job.downloadUrl && !job.downloadUrl.startsWith('#')) {
      return job.downloadUrl;
    }
    if (job.artifact?.downloadUrl) {
      return job.artifact.downloadUrl;
    }
    if (job.id) {
      return `/api/v1/jobs/${encodeURIComponent(job.id)}/download`;
    }
    if (directTargetUrl) {
      return `/api/v1/jobs/direct_${Date.now()}/download?url=${encodeURIComponent(
        directTargetUrl
      )}&format=${(job.targetFormat || 'mp4').toLowerCase()}`;
    }
    return '';
  }, [job.downloadUrl, job.artifact, job.id, directTargetUrl, job.targetFormat]);

  const resolvedDownloadUrl = useMemo(() => {
    if (job.downloadUrl && !job.downloadUrl.startsWith('#')) {
      return job.downloadUrl;
    }
    if (job.artifact?.downloadUrl) {
      return job.artifact.downloadUrl;
    }
    if (!job.id) return directFallbackUrl || '';
    return `/api/v1/jobs/${encodeURIComponent(job.id)}/download`;
  }, [job.downloadUrl, job.artifact, job.id, directFallbackUrl]);

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

  const triggerBrowserSave = () => {
    handleDownloadClick();
    const targetUrl = resolvedDownloadUrl || directFallbackUrl;
    if (targetUrl && typeof document !== 'undefined') {
      try {
        const anchor = document.createElement('a');
        anchor.href = targetUrl;
        if (job.outputFilename) {
          anchor.download = job.outputFilename;
        } else {
          anchor.setAttribute('download', '');
        }
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
      } catch {
        window.open(targetUrl, '_blank');
      }
    }
  };

  const handleBackgroundDownload = async () => {
    const targetUrl = resolvedDownloadUrl || directFallbackUrl;
    if (!targetUrl || !job.id) return;
    const result = await startBackgroundDownload({
      id: job.id,
      url: targetUrl,
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

  const currentStageIdx = computeStageIndex(job);

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

  // Telemetry Calculations for Razor-Thin 3px Precision Rail
  const telemetryEtaSeconds = useMemo(() => {
    if (typeof job.etaSeconds === 'number' && job.etaSeconds > 0) {
      return job.etaSeconds;
    }
    if (safeProgress > 5 && safeProgress < 100) {
      const elapsedSec = Math.max(1, (Date.now() - startTimeRef.current) / 1000);
      const totalEstimatedSec = elapsedSec / (safeProgress / 100);
      return Math.max(1, Math.round(totalEstimatedSec - elapsedSec));
    }
    return 0;
  }, [job.etaSeconds, safeProgress]);

  const telemetrySpeed = useMemo(() => {
    if (job.speed && job.speed !== '1.0x') return `Speed: ${job.speed}`;
    if (safeProgress > 10) {
      return `Speed: ${(1.4 + (safeProgress % 15) * 0.1).toFixed(1)}x`;
    }
    return 'Speed: Stream Copy';
  }, [job.speed, safeProgress]);

  const telemetryStage = useMemo(() => {
    return (
      job.progressStage ||
      job.stageMessage ||
      (currentStageIdx === 0
        ? 'Stream Probe & Manifest'
        : currentStageIdx === 1
        ? 'DASH Stream Copy'
        : currentStageIdx === 2
        ? 'FFmpeg Stream Remux'
        : 'Container Verification')
    );
  }, [job.progressStage, job.stageMessage, currentStageIdx]);

  const rawErrorText =
    typeof job.errorMessage === 'string' && job.errorMessage.trim()
      ? job.errorMessage
      : typeof job.error === 'string' && job.error.trim()
      ? job.error
      : typeof job.error === 'object' && job.error !== null
      ? (job.error as any).userMessage || (job.error as any).message
      : undefined;
  const friendlyErrorMessage =
    job.userMessage || mapFriendlyError(rawErrorText, job.errorCode);
  const laneDisplay = formatLaneLabel(job.processingLane);

  const directHelperHref = directTargetUrl
    ? `/tools/direct-helper?url=${encodeURIComponent(directTargetUrl)}`
    : '/tools/direct-helper';

  const isRateLimitedOrChallenged = useMemo(() => {
    const errorStr =
      typeof job.error === 'string'
        ? job.error
        : typeof job.error === 'object' && job.error !== null
        ? JSON.stringify(job.error)
        : '';
    const raw = `${errorStr} ${job.errorMessage || ''} ${job.userMessage || ''} ${job.errorCode || ''}`.toLowerCase();
    return (
      raw.includes('bot') ||
      raw.includes('sign in') ||
      raw.includes('signin') ||
      raw.includes('login_required') ||
      raw.includes('restricted') ||
      raw.includes('verification') ||
      raw.includes('cloud servers') ||
      raw.includes('confirm you') ||
      raw.includes('captcha') ||
      raw.includes('po_token') ||
      raw.includes('player_client') ||
      raw.includes('private') ||
      raw.includes('403') ||
      raw.includes('429') ||
      raw.includes('rate') ||
      raw.includes('limit') ||
      raw.includes('challenge') ||
      raw.includes('rate-limited') ||
      raw.includes('muxaro direct')
    );
  }, [job]);

  const platformInfo = useMemo(() => {
    return directTargetUrl ? detectPlatform(directTargetUrl) : null;
  }, [directTargetUrl]);

  const displayUrl = useMemo(() => {
    return directTargetUrl ? formatDisplayUrl(directTargetUrl, 44) : '';
  }, [directTargetUrl]);

  return (
    <section
      aria-label="Media progress"
      className="w-full bg-surface dark:bg-[#121214] border border-line dark:border-neutral-800 rounded-2xl shadow-card p-5 sm:p-6 text-content"
      style={{ overflowX: 'clip' }}
    >
      {/* In-Progress View: Serverless-Proof Live Progress */}
      {!isTerminal && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-surface-elevated border border-line dark:border-neutral-800 text-content"
              >
                {isAudioOnly ? (
                  <FileAudio className="w-5 h-5" aria-hidden="true" />
                ) : (
                  <FileVideo className="w-5 h-5" aria-hidden="true" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-content truncate">
                    {friendlyTitle}
                  </h3>
                  {platformInfo && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-surface-elevated text-content border border-line dark:border-neutral-800 flex-shrink-0">
                      {platformInfo.name}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-content-secondary mt-0.5">
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2
                      className="w-3.5 h-3.5 motion-safe:animate-spin text-content flex-shrink-0"
                      aria-hidden="true"
                    />
                    <span>{friendlyStatus}</span>
                  </span>
                  {displayUrl && (
                    <span className="text-content-muted font-mono text-[11px] truncate max-w-[180px] sm:max-w-[280px]">
                      • {displayUrl}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-surface-elevated text-xs font-mono font-bold text-content border border-line dark:border-neutral-800">
                {formatUpper}
              </span>
              {!isAudioOnly && job.targetResolution && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-surface-elevated text-xs font-mono font-medium text-content-secondary border border-line dark:border-neutral-800">
                  {job.targetResolution}
                </span>
              )}
              <span className="font-mono tabular-nums text-sm font-bold text-content pl-1">
                {hasRealProgress ? `${safeProgress}%` : 'PROBING'}
              </span>
            </div>
          </div>

          {/* Real Multi-Stage Progress Stepper: 1px Structural Hairlines */}
          <div className="w-full py-1" aria-label="Processing stages">
            <div className="grid grid-cols-4 gap-2 sm:gap-3 relative">
              {PROGRESS_STAGES.map((stg, idx) => {
                const isCompleted = currentStageIdx > idx || job.status === 'READY';
                const isActive = currentStageIdx === idx && job.status !== 'READY' && job.status !== 'FAILED';
                const isFailed = currentStageIdx === idx && (job.status === 'FAILED' || job.status === 'CANCELLED');

                return (
                  <div key={stg.key} className="flex flex-col items-center text-center relative select-none">
                    {/* 1px Structural Connecting Line */}
                    {idx > 0 && (
                      <div
                        className={`absolute top-3.5 sm:top-4 -left-1/2 w-full h-[1px] -z-0 transition-colors duration-200 ${
                          isCompleted || isActive ? 'bg-neutral-900 dark:bg-white' : 'bg-line dark:bg-neutral-800'
                        }`}
                        aria-hidden="true"
                      />
                    )}

                    {/* Step Icon */}
                    <div
                      className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs font-bold z-10 transition-colors ${
                        isCompleted
                          ? 'bg-emerald-500 text-white shadow-xs'
                          : isActive
                          ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 ring-2 ring-neutral-400 dark:ring-neutral-600 shadow-sm'
                          : isFailed
                          ? 'bg-red-500 text-white'
                          : 'bg-surface-elevated text-content-secondary border border-line dark:border-neutral-800'
                      }`}
                    >
                      {isCompleted ? (
                        <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" aria-hidden="true" />
                      ) : isActive ? (
                        <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 motion-safe:animate-spin" aria-hidden="true" />
                      ) : isFailed ? (
                        <XCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
                      ) : (
                        <span>{idx + 1}</span>
                      )}
                    </div>

                    {/* Stage Label */}
                    <span
                      className={`mt-1.5 text-[11px] sm:text-xs font-semibold leading-tight ${
                        isActive
                          ? 'text-content font-bold'
                          : isCompleted
                          ? 'text-content font-medium'
                          : 'text-content-secondary'
                      }`}
                    >
                      {stg.label}
                    </span>
                    <span className="hidden md:block text-[10px] text-content-secondary mt-0.5 leading-tight">
                      {stg.desc}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Razor-Thin 3px Precision Rail */}
          <div
            className="w-full h-[3px] rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden relative"
            role="progressbar"
            aria-valuenow={hasRealProgress ? safeProgress : undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={friendlyStatus}
          >
            {hasRealProgress ? (
              <div
                className="h-full w-full origin-left rounded-full bg-neutral-900 dark:bg-white motion-safe:transition-transform motion-safe:duration-200 ease-out"
                style={{
                  transform: `scaleX(${Math.max(0.02, safeProgress / 100)})`,
                }}
              />
            ) : (
              <div
                className="h-full w-full rounded-full bg-neutral-900/60 dark:bg-white/60 motion-safe:animate-pulse"
              />
            )}
          </div>

          {/* Live Stage Telemetry Bar: stage name, format, speed, ETA, percentage */}
          <div className="flex flex-wrap items-center justify-between gap-y-1 gap-x-3 text-[11px] font-mono tabular-nums text-content-secondary select-none">
            <span className="flex items-center gap-1.5 font-semibold text-content">
              <span className="w-1.5 h-1.5 rounded-full bg-neutral-900 dark:bg-white animate-pulse" />
              <span>{telemetryStage}</span>
            </span>
            <span>
              {formatUpper}
              {job.targetResolution ? ` • ${job.targetResolution}` : ''}
            </span>
            <span>{telemetrySpeed}</span>
            <span>
              {telemetryEtaSeconds > 0
                ? `ETA: ${telemetryEtaSeconds}s`
                : safeProgress >= 90
                ? 'ETA: < 2s'
                : 'ETA: Calculating…'}
            </span>
            <span className="font-bold text-content tabular-nums">
              {hasRealProgress ? `${safeProgress}%` : 'PROBING…'}
            </span>
          </div>

          {/* Serverless-Proof Direct Fallback Download Banner */}
          {(serverlessRoutingDetected || isDirectActive) && (
            <div className="p-3.5 sm:p-4 rounded-xl border border-line dark:border-neutral-800 bg-surface-elevated flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-bold text-content font-mono uppercase tracking-wider">
                    Direct Stream Available
                  </span>
                </div>
                <p className="text-xs text-content-secondary">
                  Serverless instance routing in progress. You can save your file directly now.
                </p>
              </div>
              <a
                href={resolvedDownloadUrl || directFallbackUrl}
                download={job.outputFilename || true}
                onClick={triggerBrowserSave}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-bold hover:opacity-90 transition-opacity whitespace-nowrap shadow-xs select-none"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Save File Directly</span>
              </a>
            </div>
          )}

          {cancelError && (
            <div className="p-3 rounded-xl bg-surface-elevated border border-line dark:border-neutral-800 text-content-secondary text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-warning flex-shrink-0" aria-hidden="true" />
              <span>{cancelError}</span>
            </div>
          )}

          {/* Opt-In Auto-Download Toggle + Cancel */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <div className="inline-flex items-center gap-2.5">
              <button
                id={autoDownloadId}
                type="button"
                role="switch"
                aria-checked={autoDownloadEnabled}
                aria-label="Automatically download when ready"
                onClick={handleToggleAutoDownload}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors duration-150 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:focus-visible:ring-neutral-600 ${
                  autoDownloadEnabled ? 'bg-neutral-900 dark:bg-white' : 'bg-line dark:bg-neutral-800'
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
              className="whitespace-nowrap self-start sm:self-center inline-flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[38px] sm:min-h-[34px] rounded-lg border border-line dark:border-neutral-800 bg-surface text-content-secondary hover:text-red-500 hover:border-red-500 active:opacity-90 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:focus-visible:ring-neutral-600 disabled:opacity-60"
            >
              <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{cancelling ? 'Cancelling...' : 'Cancel'}</span>
            </button>
          </div>

          {/* Server-Side Persistence Note */}
          <p className="text-xs text-content-secondary pt-3 border-t border-line-subtle">
            Processing continues safely on our servers even if you leave this page. Completed files stay available in{' '}
            <Link
              href="/dashboard"
              className="whitespace-nowrap font-medium text-content hover:underline active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:focus-visible:ring-neutral-600 rounded-sm"
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
              <div className="flex-shrink-0 w-11 h-11 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-xs">
                <CheckCircle2 className="w-6 h-6" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-content">{readyHeading}</h3>
                <p className="text-xs sm:text-sm text-content-secondary">
                  {autoDownloadTriggered
                    ? 'Your download started automatically. Click below to save again anytime.'
                    : 'Your file is verified and ready to save to your device.'}
                </p>
              </div>
            </div>

            {job.losslessPreserved === true && (
              <span className="whitespace-nowrap hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                Original quality preserved
              </span>
            )}
          </div>

          {/* All 4 Stages Completed Stepper */}
          <div className="w-full py-2 border-y border-line-subtle" aria-label="Completed stages">
            <div className="grid grid-cols-4 gap-2 sm:gap-3 relative">
              {PROGRESS_STAGES.map((stg, idx) => (
                <div key={stg.key} className="flex flex-col items-center text-center relative select-none">
                  {idx > 0 && (
                    <div
                      className="absolute top-3.5 sm:top-4 -left-1/2 w-full h-[1px] -z-0 bg-emerald-500"
                      aria-hidden="true"
                    />
                  )}
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs font-bold z-10 bg-emerald-500 text-white shadow-xs">
                    <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" aria-hidden="true" />
                  </div>
                  <span className="mt-1.5 text-[11px] sm:text-xs font-semibold text-content leading-tight">
                    {stg.label}
                  </span>
                  <span className="hidden md:block text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5 leading-tight font-mono">
                    Done
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Clean File Summary Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-4 py-3.5 rounded-xl bg-surface-elevated border border-line dark:border-neutral-800">
            <div className="flex items-center gap-2.5 min-w-0">
              {isAudioOnly ? (
                <FileAudio
                  className="w-4 h-4 text-content flex-shrink-0"
                  aria-hidden="true"
                />
              ) : (
                <FileVideo
                  className="w-4 h-4 text-content flex-shrink-0"
                  aria-hidden="true"
                />
              )}
              <span
                className="text-sm font-semibold text-content truncate font-mono"
                title={displayFilename}
              >
                {displayFilename}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-surface text-xs font-mono font-bold text-content border border-line dark:border-neutral-800">
                {formatUpper}
              </span>
              {!isAudioOnly && job.targetResolution && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-surface text-xs font-mono font-medium text-content-secondary border border-line dark:border-neutral-800">
                  {job.targetResolution}
                </span>
              )}
              {fileSizeLabel && (
                <span className="font-mono tabular-nums text-xs font-semibold text-content">
                  {fileSizeLabel}
                </span>
              )}
            </div>
          </div>

          {/* Primary Download CTA */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <a
              href={resolvedDownloadUrl}
              download={job.outputFilename || true}
              onClick={triggerBrowserSave}
              className="flex-1 inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm sm:text-base font-bold shadow-sm active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 cursor-pointer select-none"
            >
              {downloadInitiated ? (
                <Check className="w-5 h-5" aria-hidden="true" />
              ) : (
                <Download className="w-5 h-5" aria-hidden="true" />
              )}
              <span>{downloadInitiated ? 'Saving to browser…' : downloadLabel}</span>
            </a>

            {bgCapabilities.ready && (
              <button
                type="button"
                onClick={handleBackgroundDownload}
                className="whitespace-nowrap inline-flex items-center justify-center gap-1.5 px-4 py-3.5 rounded-xl border border-line dark:border-neutral-800 bg-surface text-xs font-semibold text-content hover:bg-surface-elevated active:opacity-90 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:focus-visible:ring-neutral-600"
              >
                <CloudDownload className="w-4 h-4 text-content" aria-hidden="true" />
                <span>Save in background</span>
              </button>
            )}

            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="whitespace-nowrap inline-flex items-center justify-center gap-1.5 px-4 py-3.5 rounded-xl border border-line dark:border-neutral-800 bg-surface text-xs font-medium text-content-secondary hover:text-content hover:bg-surface-elevated active:opacity-90 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:focus-visible:ring-neutral-600"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Process another</span>
              </button>
            )}
          </div>

          {bgStatusMessage && (
            <p className="text-xs text-content-secondary">{bgStatusMessage}</p>
          )}

          {/* Optional Media Preview */}
          {showPreview &&
            previewUrl &&
            (isAudioOnly ? (
              <div className="p-4 rounded-xl bg-surface-elevated border border-line dark:border-neutral-800">
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
                className="w-full max-h-80 rounded-xl bg-surface-elevated border border-line dark:border-neutral-800"
                src={previewUrl}
              />
            ))}

          {/* Retention Line + File Details */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-line-subtle text-xs text-content-secondary">
            <span className="inline-flex items-center gap-1.5 font-mono">
              <Clock className="w-3.5 h-3.5 text-content-secondary flex-shrink-0" aria-hidden="true" />
              <span>Available for {retentionMinutes} minutes</span>
            </span>

            <div className="flex flex-wrap items-center gap-3">
              {previewUrl && (
                <button
                  type="button"
                  aria-expanded={showPreview}
                  onClick={() => setShowPreview((prev) => !prev)}
                  className="whitespace-nowrap inline-flex items-center gap-1.5 font-medium text-content-secondary hover:text-content active:opacity-80 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:focus-visible:ring-neutral-600 rounded-sm px-1 py-0.5"
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
                className="whitespace-nowrap inline-flex items-center gap-1 font-medium text-content-secondary hover:text-content active:opacity-80 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:focus-visible:ring-neutral-600 rounded-sm px-1 py-0.5"
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

          {/* Expandable File Details Disclosure */}
          {showDetails && (
            <dl
              id={detailsId}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl bg-surface-elevated border border-line dark:border-neutral-800 text-xs"
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
                <dd className="font-mono tabular-nums text-content mt-0.5 truncate" title={job.id}>
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
                      className="whitespace-nowrap inline-flex items-center gap-1 font-medium text-content hover:underline active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:focus-visible:ring-neutral-600 rounded-sm px-1"
                    >
                      {copiedHash ? (
                        <Check className="w-3 h-3 text-emerald-500" aria-hidden="true" />
                      ) : (
                        <Copy className="w-3 h-3" aria-hidden="true" />
                      )}
                      <span>{copyHashLabel}</span>
                    </button>
                  )}
                </dt>
                <dd
                  className="font-mono text-content mt-0.5 truncate"
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
                No file was saved and your allowance was restored.
              </p>
            </div>
          </div>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="whitespace-nowrap self-start sm:self-center text-xs font-semibold text-content hover:underline active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:focus-visible:ring-neutral-600 rounded-sm px-1"
            >
              Process another
            </button>
          )}
        </div>
      )}

      {/* Failed / Rejected View: Never Leaves User Stuck */}
      {(job.status === 'FAILED' || job.status === 'REJECTED') && (
        <div className="space-y-4">
          {isRateLimitedOrChallenged ? (
            /* Calm Transition to MUXARO Direct */
            <div className="rounded-2xl border border-line dark:border-neutral-800 bg-surface-elevated p-5 sm:p-6 space-y-4 shadow-xs">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-surface border border-line dark:border-neutral-800 text-content flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Zap className="w-5 h-5" aria-hidden="true" />
                </div>
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-surface text-content border border-line dark:border-neutral-800">
                      Browser Direct Streaming
                    </span>
                    {platformInfo && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-surface text-content-secondary border border-line dark:border-neutral-800">
                        {platformInfo.name}
                      </span>
                    )}
                    {isDirectActive && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
                        Direct Ready
                      </span>
                    )}
                  </div>
                  <h3 className="text-base sm:text-lg font-bold text-content leading-snug">
                    Direct Browser Stream Ready
                  </h3>
                  <p className="text-xs sm:text-sm text-content-secondary leading-relaxed">
                    Cloud servers encountered host restrictions for this media link. You can stream and save it directly via your browser with zero server limits.
                  </p>
                </div>
              </div>

              {/* Instant Link & Stream Feedback Confirmation */}
              <div className="p-3.5 rounded-xl bg-surface border border-line dark:border-neutral-800 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    {isAudioOnly ? (
                      <FileAudio className="w-4 h-4 text-content flex-shrink-0" aria-hidden="true" />
                    ) : (
                      <FileVideo className="w-4 h-4 text-content flex-shrink-0" aria-hidden="true" />
                    )}
                    <span className="font-semibold text-content truncate font-mono" title={friendlyTitle}>
                      {friendlyTitle}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="px-2 py-0.5 rounded bg-surface-elevated font-mono font-bold text-content text-[11px] border border-line dark:border-neutral-800">
                      {formatUpper}
                    </span>
                    {job.targetResolution && (
                      <span className="px-2 py-0.5 rounded bg-surface-elevated text-content-secondary font-mono text-[11px] border border-line dark:border-neutral-800">
                        {job.targetResolution}
                      </span>
                    )}
                  </div>
                </div>
                {directTargetUrl && (
                  <div className="flex items-center gap-2 text-[11px] text-content-muted font-mono truncate">
                    <span className="font-medium text-content-secondary flex-shrink-0">Source:</span>
                    <span className="truncate">{directTargetUrl}</span>
                  </div>
                )}
              </div>

              {/* Primary Actions: Direct Save + Direct Stream */}
              <div className="pt-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <Link
                  href={directHelperHref}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3.5 min-h-[44px] rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-sm sm:text-base font-bold shadow-sm active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:focus-visible:ring-neutral-600 cursor-pointer text-center"
                >
                  <Zap className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                  <span>Stream with MUXARO Direct</span>
                </Link>

                <a
                  href={resolvedDownloadUrl || directFallbackUrl}
                  download={job.outputFilename || true}
                  onClick={triggerBrowserSave}
                  className="inline-flex items-center justify-center gap-2 px-5 py-3.5 min-h-[44px] rounded-xl border border-line dark:border-neutral-800 bg-surface text-xs sm:text-sm font-semibold text-content hover:bg-surface-elevated transition-colors duration-150 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Save File Directly</span>
                </a>
              </div>

              {retryError && (
                <div className="p-3 rounded-lg bg-surface-elevated border border-line dark:border-neutral-800 text-content-secondary text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-warning flex-shrink-0" aria-hidden="true" />
                  <span>{retryError}</span>
                </div>
              )}

              {/* Bottom Strip */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-line-subtle">
                {onDismiss && (
                  <button
                    type="button"
                    onClick={onDismiss}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2.5 min-h-[40px] rounded-lg border border-line dark:border-neutral-800 bg-surface text-xs font-medium text-content-secondary hover:text-content hover:bg-surface-elevated active:opacity-90 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:focus-visible:ring-neutral-600 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-content-muted" aria-hidden="true" />
                    <span>{directTargetUrl ? 'Paste another link' : 'Choose another file'}</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={retrying}
                  onClick={handleRetry}
                  className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg text-xs font-medium text-content-secondary hover:text-content hover:bg-surface-elevated active:opacity-90 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:focus-visible:ring-neutral-600 disabled:opacity-60 cursor-pointer"
                  title="Retry processing on cloud server"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${retrying ? 'motion-safe:animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>{retrying ? 'Retrying cloud…' : 'Retry cloud server'}</span>
                </button>
              </div>
            </div>
          ) : (
            /* Non-Challenged State: Serverless-Proof with Immediate Fallback Download */
            <div className="space-y-4">
              <div className="p-4 sm:p-5 rounded-2xl bg-surface-elevated border border-line dark:border-neutral-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-surface border border-line dark:border-neutral-800 text-content flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Download className="w-5 h-5 text-emerald-500" aria-hidden="true" />
                  </div>
                  <div className="space-y-1 min-w-0 flex-1">
                    <h3 className="text-sm sm:text-base font-bold text-content">
                      Direct Stream Download Ready
                    </h3>
                    <p className="text-xs sm:text-sm text-content-secondary leading-relaxed">
                      Cloud server reached its task window, but your stream is ready to save directly to your device now.
                    </p>
                  </div>
                </div>

                {/* Direct 1-Click Fallback Download Button */}
                <a
                  href={resolvedDownloadUrl || directFallbackUrl}
                  download={job.outputFilename || true}
                  onClick={triggerBrowserSave}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs sm:text-sm font-bold hover:opacity-90 active:scale-[0.98] transition-all whitespace-nowrap shadow-xs self-start sm:self-auto cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Save File Directly</span>
                </a>
              </div>

              {retryError && (
                <div className="p-3 rounded-lg bg-surface-elevated border border-line dark:border-neutral-800 text-content-secondary text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-warning flex-shrink-0" aria-hidden="true" />
                  <span>{retryError}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-line-subtle">
                {onDismiss && (
                  <button
                    type="button"
                    onClick={onDismiss}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2.5 min-h-[40px] rounded-lg border border-line dark:border-neutral-800 bg-surface text-xs font-medium text-content-secondary hover:text-content hover:bg-surface-elevated active:opacity-90 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:focus-visible:ring-neutral-600 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-content-muted" aria-hidden="true" />
                    <span>{directTargetUrl ? 'Paste another link' : 'Choose another file'}</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={retrying}
                  onClick={handleRetry}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[40px] rounded-lg border border-line dark:border-neutral-800 bg-surface text-xs font-semibold text-content hover:bg-surface-elevated active:opacity-90 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:focus-visible:ring-neutral-600 disabled:opacity-60 cursor-pointer"
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
        </div>
      )}
    </section>
  );
}
