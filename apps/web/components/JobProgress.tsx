'use client';

import React, { useEffect, useState, useMemo, useRef, useId } from 'react';
import Link from 'next/link';
import { ProcessingJob, JobState } from '@/lib/types';
import { formatBytes } from '@/lib/formatters';
import { api, getApiBaseUrl } from '@/lib/api-client';
import { detectPlatform } from '@/lib/url-utils';
import TurnstileChallenge from '@/components/TurnstileChallenge';
import CommandPreviewDrawer from '@/components/tools/CommandPreviewDrawer';
import ToolChainBar from '@/components/tools/ToolChainBar';
import {
  getAutoDownloadPreference,
  setAutoDownloadPreference,
  mapFriendlyError,
} from '@/lib/background-download';
import {
  CheckCircle2,
  Check,
  Download,
  AlertCircle,
  XCircle,
  FileVideo,
  FileAudio,
  RotateCcw,
  Play,
  EyeOff,
  Zap,
  ShieldCheck,
  Copy,
} from 'lucide-react';

export interface JobProgressProps {
  initialJob: ProcessingJob;
  onJobUpdate?: (updated: ProcessingJob) => void;
  onDismiss?: () => void;
  sourceUrl?: string;
  manifest?: any;
}

const MAX_POLL_RETRIES = 15;
const BASE_POLL_INTERVAL_MS = 2000;
const MAX_BACKOFF_INTERVAL_MS = 10000;

type ExtendedProcessingJob = ProcessingJob & {
  jobId?: string;
  stageMessage?: string;
  errorMessage?: string;
  errorCode?: string;
  userMessage?: string;
  retentionMinutes?: number;
  etaSeconds?: number;
  speed?: string;
  stage?: string;
  deliveryMode?: 'zero-hop' | 'tunnel';
  directStreamUrl?: string;
  fileSizeBytes?: number;
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

function normalizeContractStatus(
  rawStatusStr: string | undefined,
  defaultStatus: JobState = 'QUEUED'
): JobState {
  const s = String(rawStatusStr || '').toUpperCase();
  if (s === 'COMPLETED' || s === 'READY') return 'READY';
  if (s === 'FAILED') return 'FAILED';
  if (s === 'CANCELLED') return 'CANCELLED';
  if (s === 'REJECTED') return 'REJECTED';
  if (
    s === 'PROCESSING' ||
    s === 'DOWNLOADING_VIDEO' ||
    s === 'DOWNLOADING_AUDIO' ||
    s === 'DOWNLOADING' ||
    s === 'MERGING' ||
    s === 'CONVERTING' ||
    s === 'PROBING' ||
    s === 'EXTRACTING' ||
    s === 'PACKAGING' ||
    s === 'VERIFYING'
  ) {
    return 'PROCESSING';
  }
  if (s === 'CREATED' || s === 'QUEUED') return 'QUEUED';
  return defaultStatus;
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

  const nextStatus = normalizeContractStatus(raw.status, prev.status || 'PROCESSING');

  return {
    ...prev,
    ...raw,
    id: raw.id || raw.jobId || prev.id,
    sourceUrl: raw.sourceUrl || (raw as any).mediaUrl || prev.sourceUrl,
    inputTitle: raw.inputTitle || prev.inputTitle,
    operation: raw.operation || prev.operation,
    targetFormat: raw.targetFormat || prev.targetFormat,
    targetResolution: raw.targetResolution || prev.targetResolution,
    status: nextStatus,
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
    etaSeconds:
      typeof raw.etaSeconds === 'number' ? raw.etaSeconds : prev.etaSeconds,
    speed: raw.speed || prev.speed,
    stage: raw.stage || prev.stage,
    deliveryMode: raw.deliveryMode || prev.deliveryMode,
    directStreamUrl: raw.directStreamUrl || prev.directStreamUrl,
    fileSizeBytes: raw.fileSizeBytes ?? prev.fileSizeBytes,
  };
}

export default function JobProgress({
  initialJob,
  onJobUpdate,
  onDismiss,
  sourceUrl: propSourceUrl,
  manifest,
}: JobProgressProps) {
  const [job, setJob] = useState<ExtendedProcessingJob>(() => {
    const ext = initialJob as ExtendedProcessingJob;
    return {
      ...ext,
      status: normalizeContractStatus(ext.status, 'QUEUED'),
    };
  });

  const [cancelling, setCancelling] = useState<boolean>(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<boolean>(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [downloadInitiated, setDownloadInitiated] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [autoDownloadEnabled, setAutoDownloadEnabled] = useState<boolean>(true);
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [serverlessRoutingDetected, setServerlessRoutingDetected] = useState<boolean>(false);
  const [isMobileDevice, setIsMobileDevice] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
    const ua = navigator.userAgent || '';
    const isDesktopOS = /Windows NT|Macintosh|X11; Linux x86_64/i.test(ua);
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);

    if (isDesktopOS && !isMobileUA) {
      setIsMobileDevice(false);
      return;
    }

    const isSmallScreen = window.innerWidth <= 768;
    setIsMobileDevice(isMobileUA || (navigator.maxTouchPoints > 0 && isSmallScreen && !isDesktopOS));
  }, []);

  const autoDownloadId = useId();
  const jobRef = useRef<ExtendedProcessingJob>(job);
  const onJobUpdateRef = useRef(onJobUpdate);
  const autoDownloadedIdsRef = useRef<Set<string>>(new Set());
  const zeroHopTriggeredRef = useRef<Set<string>>(new Set());
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    onJobUpdateRef.current = onJobUpdate;
  }, [onJobUpdate]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('muxaro-auto-download');
      setAutoDownloadEnabled(stored === null ? true : stored === 'true');
    } catch {
      setAutoDownloadEnabled(true);
    }
  }, []);

  useEffect(() => {
    const ext = initialJob as ExtendedProcessingJob;
    const normalized: ExtendedProcessingJob = {
      ...ext,
      status: normalizeContractStatus(ext.status, 'QUEUED'),
    };
    setJob(normalized);
    jobRef.current = normalized;
    startTimeRef.current = Date.now();
    setCancelError(null);
    setRetryError(null);
    setShowPreview(false);
    setServerlessRoutingDetected(false);
  }, [initialJob]);

  const isTerminal = isTerminalState(job.status);

  // Real-time SSE streaming from backend
  useEffect(() => {
    if (!job.id || isTerminal) return;
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') return;

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
          const nextStatus = normalizeContractStatus(payload.status, jobRef.current.status || 'PROCESSING');
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
            deliveryMode: payload.deliveryMode || jobRef.current.deliveryMode,
            directStreamUrl: payload.directStreamUrl || payload.streamUrl || jobRef.current.directStreamUrl,
            fileSizeBytes: payload.fileSizeBytes ?? payload.sizeBytes ?? jobRef.current.fileSizeBytes,
          };
          jobRef.current = updated;
          setJob(updated);
          onJobUpdateRef.current?.(updated);
        } catch {}
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
        console.warn('[MUXARO Job Stream] SSE connection interrupted; switching to polling fallback.');
        if (es) {
          es.close();
          es = null;
        }
      };
    } catch {}

    return () => {
      cancelled = true;
      if (es) {
        es.close();
        es = null;
      }
    };
  }, [job.id, isTerminal]);

  // Polling fallback
  useEffect(() => {
    if (!job.id || isTerminal) return;

    let timer: NodeJS.Timeout | null = null;
    let consecutiveFailures = 0;
    let cancelled = false;

    async function poll() {
      if (cancelled || !job.id) return;
      try {
        const raw = (await api.getJob(job.id)) as ExtendedProcessingJob;
        if (cancelled) return;
        consecutiveFailures = 0;
        const nextJob = mergeBackendPayload(jobRef.current, raw);
        jobRef.current = nextJob;
        setJob(nextJob);
        onJobUpdateRef.current?.(nextJob);

        if (!isTerminalState(nextJob.status)) {
          const delay = Math.min(
            BASE_POLL_INTERVAL_MS * Math.pow(1.2, consecutiveFailures),
            MAX_BACKOFF_INTERVAL_MS
          );
          timer = setTimeout(poll, delay);
        }
      } catch (err: any) {
        if (cancelled) return;
        consecutiveFailures++;
        if (err?.status === 404) {
          console.warn('[MUXARO Job Polling] Job status not found on edge storage; checking direct stream fallback.');
          setServerlessRoutingDetected(true);
        } else {
          console.warn(`[MUXARO Job Polling] Status check failed (attempt ${consecutiveFailures}/${MAX_POLL_RETRIES}):`, err?.message || err);
        }
        if (consecutiveFailures < MAX_POLL_RETRIES) {
          const delay = Math.min(
            BASE_POLL_INTERVAL_MS * Math.pow(1.5, consecutiveFailures),
            MAX_BACKOFF_INTERVAL_MS
          );
          timer = setTimeout(poll, delay);
        }
      }
    }

    const initialDelay = setTimeout(poll, BASE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(initialDelay);
      if (timer) clearTimeout(timer);
    };
  }, [job.id, isTerminal]);

  const directTargetUrl =
    job.sourceUrl ||
    (job as any).mediaUrl ||
    propSourceUrl ||
    '';

  const isAudioOnly =
    job.jobType === 'extract_audio' ||
    ['mp3', 'flac', 'opus', 'aac', 'wav', 'm4a'].includes(
      (job.targetFormat || '').toLowerCase()
    );
  const friendlyTitle =
    job.inputTitle || (isAudioOnly ? 'Your audio' : 'Your video');
  const displayFilename =
    job.outputFilename ||
    `${friendlyTitle}.${(
      job.targetFormat || (isAudioOnly ? 'mp3' : 'mp4')
    ).toLowerCase()}`;

  const directFallbackUrl = useMemo(() => {
    if (job.deliveryMode === 'zero-hop' && (job.directStreamUrl || job.downloadUrl)) {
      return job.directStreamUrl || job.downloadUrl || '';
    }
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
  }, [job.deliveryMode, job.directStreamUrl, job.downloadUrl, job.artifact, job.id, directTargetUrl, job.targetFormat]);

  const resolvedDownloadUrl = useMemo(() => {
    if (job.deliveryMode === 'zero-hop') {
      return job.directStreamUrl || job.downloadUrl || directFallbackUrl || '';
    }
    if (job.downloadUrl && !job.downloadUrl.startsWith('#')) {
      return job.downloadUrl;
    }
    if (job.artifact?.downloadUrl) {
      return job.artifact.downloadUrl;
    }
    if (!job.id) return directFallbackUrl || '';
    return `/api/v1/jobs/${encodeURIComponent(job.id)}/download`;
  }, [job.deliveryMode, job.directStreamUrl, job.downloadUrl, job.artifact, job.id, directFallbackUrl]);

  const previewUrl = useMemo(() => {
    if (!resolvedDownloadUrl || resolvedDownloadUrl.startsWith('#')) {
      return '';
    }
    return resolvedDownloadUrl.includes('?')
      ? `${resolvedDownloadUrl}&inline=1`
      : `${resolvedDownloadUrl}?inline=1`;
  }, [resolvedDownloadUrl]);

  // Opt-in automatic download ONLY when user explicitly enabled it
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
      try {
        const anchor = document.createElement('a');
        anchor.href = resolvedDownloadUrl;
        if (job.outputFilename) {
          anchor.download = job.outputFilename;
        } else {
          anchor.setAttribute('download', '');
        }
        if (job.deliveryMode === 'zero-hop') {
          anchor.rel = 'noreferrer';
          anchor.referrerPolicy = 'no-referrer';
        }
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
      } catch {}
    }
  }, [
    autoDownloadEnabled,
    job.status,
    job.id,
    job.outputFilename,
    resolvedDownloadUrl,
    job.deliveryMode,
  ]);

  // Zero-hop Client Handover: trigger instant browser download directly from origin CDN
  useEffect(() => {
    if (
      job.deliveryMode === 'zero-hop' &&
      job.id &&
      typeof document !== 'undefined' &&
      !zeroHopTriggeredRef.current.has(job.id)
    ) {
      const streamUrl = job.directStreamUrl || job.downloadUrl || directFallbackUrl;
      if (streamUrl) {
        zeroHopTriggeredRef.current.add(job.id);
        const a = document.createElement('a');
        a.href = streamUrl;
        a.download = job.outputFilename || 'media.mp4';
        a.rel = 'noreferrer';
        a.referrerPolicy = 'no-referrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    }
  }, [
    job.deliveryMode,
    job.id,
    job.directStreamUrl,
    job.downloadUrl,
    job.outputFilename,
    directFallbackUrl,
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
      const friendly = mapFriendlyError(err instanceof Error ? err.message : undefined);
      console.error('[MUXARO Job Cancel Error]', friendly, err);
      setCancelError(friendly);
    } finally {
      setCancelling(false);
    }
  };

  const handleRetry = async () => {
    if (!job.id || retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
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
      const raw = (json.data !== undefined ? json.data : json) as ExtendedProcessingJob;

      const nextJob: ExtendedProcessingJob = {
        ...mergeBackendPayload(jobRef.current, raw),
        status: normalizeContractStatus(raw.status, 'PROCESSING'),
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
      const friendly = mapFriendlyError(err instanceof Error ? err.message : undefined);
      console.error('[MUXARO Job Retry Error]', friendly, err);
      setRetryError(friendly);
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
        if (job.deliveryMode === 'zero-hop') {
          anchor.rel = 'noreferrer';
          anchor.referrerPolicy = 'no-referrer';
        }
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
      } catch {
        window.open(targetUrl, '_blank');
      }
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

  const formatUpper = (
    job.targetFormat || (isAudioOnly ? 'mp3' : 'mp4')
  ).toUpperCase();
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
  const retryButtonLabel = retrying ? 'Retrying...' : 'Try again';

  const fileSizeLabel =
    typeof job.fileSizeBytes === 'number' && job.fileSizeBytes > 0
      ? formatBytes(job.fileSizeBytes)
      : typeof job.outputSizeBytes === 'number' && job.outputSizeBytes > 0
      ? formatBytes(job.outputSizeBytes)
      : '';

  // Telemetry Calculations for Clean Status Line
  const telemetryEtaSeconds = useMemo(() => {
    if (typeof job.etaSeconds === 'number' && job.etaSeconds > 0) {
      return Math.round(job.etaSeconds);
    }
    if (hasRealProgress && safeProgress > 5 && safeProgress < 100) {
      const elapsedSec = Math.max(1, (Date.now() - startTimeRef.current) / 1000);
      const totalEstimatedSec = elapsedSec / (safeProgress / 100);
      const remaining = Math.round(totalEstimatedSec - elapsedSec);
      return remaining > 0 ? remaining : 0;
    }
    return 0;
  }, [job.etaSeconds, safeProgress, hasRealProgress]);

  const platformInfo = useMemo(() => {
    return directTargetUrl ? detectPlatform(directTargetUrl) : null;
  }, [directTargetUrl]);

  const shortDomain = useMemo(() => {
    const candidate = directTargetUrl || job.sourceUrl || propSourceUrl;
    if (!candidate) return '';
    try {
      const parsed = new URL(candidate.startsWith('http') ? candidate : `https://${candidate}`);
      return parsed.hostname.replace(/^www\./i, '');
    } catch {
      return platformInfo?.name ? `${platformInfo.name.toLowerCase()}.com` : '';
    }
  }, [directTargetUrl, job.sourceUrl, propSourceUrl, platformInfo]);

  const formatPillLabel = useMemo(() => {
    if (isAudioOnly) {
      return formatUpper;
    }
    return job.targetResolution ? `${formatUpper} · ${job.targetResolution}` : formatUpper;
  }, [isAudioOnly, formatUpper, job.targetResolution]);

  // NEVER render "Speed: Stream Copy". While probing/connecting, show only "Connecting to stream…".
  // Show real MB/s and ETA ONLY once numeric progress > 0 arrives.
  const statusString = useMemo(() => {
    if (job.deliveryMode === 'zero-hop') {
      return 'Connecting to CDN stream · Starting instant download…';
    }

    if (!hasRealProgress || safeProgress <= 0) {
      return 'Connecting to stream…';
    }

    const parts: string[] = [];
    const rawStage = (job.progressStage || job.stageMessage || job.stage || '').toLowerCase();
    if (safeProgress >= 90 || rawStage.includes('mux') || rawStage.includes('merge')) {
      parts.push('Muxing');
    } else if (rawStage.includes('extract')) {
      parts.push('Extracting');
    } else {
      parts.push('Downloading');
    }

    parts.push(`${safeProgress}%`);

    if (job.speed) {
      const cleanSpeed = job.speed.replace(/^speed:\s*/i, '').trim();
      if (
        cleanSpeed &&
        !cleanSpeed.toLowerCase().includes('copy') &&
        !cleanSpeed.toLowerCase().includes('stream')
      ) {
        parts.push(cleanSpeed);
      }
    }

    if (telemetryEtaSeconds > 0) {
      const mins = Math.floor(telemetryEtaSeconds / 60);
      const secs = telemetryEtaSeconds % 60;
      parts.push(mins > 0 ? `${mins}m ${secs}s left` : `${secs}s left`);
    }

    return parts.join(' · ');
  }, [job.deliveryMode, hasRealProgress, safeProgress, job.progressStage, job.stageMessage, job.stage, job.speed, telemetryEtaSeconds]);

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

  const directHelperHref = directTargetUrl
    ? `/tools/direct-helper?url=${encodeURIComponent(directTargetUrl)}`
    : '/tools/direct-helper';

  const fallbackDirectStream = useMemo(() => {
    if (job.directStreamUrl && !job.directStreamUrl.startsWith('/api')) {
      return job.directStreamUrl;
    }
    const isWatchPage = (u?: string) =>
      Boolean(u && /^(https?:\/\/)?(www\.)?(youtube\.com\/watch|youtu\.be\/[a-zA-Z0-9_-]+|instagram\.com\/(?:p|reel)\/|tiktok\.com\/@[^\/]+\/video\/|twitter\.com\/[^\/]+\/status\/|x\.com\/[^\/]+\/status\/)/i.test(u));

    const fromManifest =
      manifest?.videoStreams?.find((s: any) => s.url && !isWatchPage(s.url))?.url ||
      (manifest?.directStreamUrl && !isWatchPage(manifest.directStreamUrl) ? manifest.directStreamUrl : undefined) ||
      manifest?.audioStreams?.find((a: any) => a.url && !isWatchPage(a.url))?.url;
    return fromManifest;
  }, [job.directStreamUrl, manifest]);

  const normalizedFailureRaw = useMemo(() => {
    const errorStr =
      typeof job.error === 'string'
        ? job.error
        : typeof job.error === 'object' && job.error !== null
        ? JSON.stringify(job.error)
        : '';
    return `${errorStr} ${job.errorMessage || ''} ${job.userMessage || ''} ${job.errorCode || ''}`.toLowerCase();
  }, [job]);

  const isBackendUnavailable = useMemo(() => {
    const code = String(job.errorCode || '').toUpperCase();
    return (
      serverlessRoutingDetected ||
      code === 'ERR_BACKEND_NOT_CONFIGURED' ||
      code === 'DEGRADED' ||
      normalizedFailureRaw.includes('err_backend_not_configured') ||
      normalizedFailureRaw.includes('backend is not configured') ||
      normalizedFailureRaw.includes('backend media processing server is not configured') ||
      normalizedFailureRaw.includes('service degraded') ||
      /\b503\b/.test(normalizedFailureRaw)
    );
  }, [job.errorCode, normalizedFailureRaw, serverlessRoutingDetected]);

  const isHostBlocked = useMemo(() => {
    const code = String(job.errorCode || '').toUpperCase();
    return (
      code === 'HOST_BLOCKED' ||
      normalizedFailureRaw.includes('host_blocked') ||
      normalizedFailureRaw.includes('blocks free cloud') ||
      normalizedFailureRaw.includes('host restricted') ||
      normalizedFailureRaw.includes('host_restricted') ||
      normalizedFailureRaw.includes('datacenter ip')
    );
  }, [job.errorCode, normalizedFailureRaw]);

  const isRateLimitedOrChallenged = useMemo(() => {
    return (
      isHostBlocked ||
      normalizedFailureRaw.includes('bot') ||
      normalizedFailureRaw.includes('sign in') ||
      normalizedFailureRaw.includes('signin') ||
      normalizedFailureRaw.includes('login_required') ||
      normalizedFailureRaw.includes('restricted') ||
      normalizedFailureRaw.includes('verification') ||
      normalizedFailureRaw.includes('captcha') ||
      normalizedFailureRaw.includes('private') ||
      normalizedFailureRaw.includes('403') ||
      normalizedFailureRaw.includes('429') ||
      normalizedFailureRaw.includes('empty') ||
      normalizedFailureRaw.includes('incomplete') ||
      normalizedFailureRaw.includes('0 bytes') ||
      normalizedFailureRaw.includes('unable to fetch')
    );
  }, [isHostBlocked, normalizedFailureRaw]);

  return (
    <section
      aria-label="Media progress"
      className="w-full bg-surface border border-line rounded-2xl shadow-card p-5 sm:p-6 text-content transition-colors"
      style={{ overflowX: 'clip' }}
    >
      {/* 1. In-Progress View: Clean 3-Row Linear/Hallmark Layout */}
      {!isTerminal && (
        <div className="space-y-4">
          {/* Row 1: Icon + Title + short domain on left; single format pill + Cancel button on right */}
          <div className="flex items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-surface-elevated border border-line shrink-0 text-content">
                {isAudioOnly ? (
                  <FileAudio className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <FileVideo className="w-4 h-4" aria-hidden="true" />
                )}
              </div>
              <div className="min-w-0">
                <h3 className="text-sm sm:text-base font-semibold text-content truncate leading-tight">
                  {friendlyTitle}
                </h3>
                {shortDomain && (
                  <p className="text-xs text-content-secondary font-mono mt-0.5 truncate">
                    {shortDomain}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-surface-elevated text-xs font-mono font-medium text-content border border-line">
                {formatPillLabel}
              </span>
              <button
                type="button"
                disabled={cancelling}
                onClick={handleCancel}
                className="text-xs text-content-secondary hover:text-content font-medium px-2 py-1 rounded hover:bg-surface-elevated transition-colors disabled:opacity-50"
              >
                {cancelling ? 'Cancelling…' : 'Cancel'}
              </button>
            </div>
          </div>

          {/* Row 2: Single 4px high-contrast progress bar */}
          <div
            className="w-full h-1 rounded-full bg-line/60 overflow-hidden relative"
            role="progressbar"
            aria-valuenow={hasRealProgress ? safeProgress : undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={statusString}
          >
            {hasRealProgress && safeProgress > 0 ? (
              <div
                className="h-full bg-content rounded-full transition-transform duration-150 origin-left ease-out will-change-transform"
                style={{
                  transform: `scaleX(${Math.max(0.02, safeProgress / 100)})`,
                }}
              />
            ) : (
              <div className="h-full w-1/3 bg-content/80 rounded-full animate-indeterminate-shimmer" />
            )}
          </div>

          {/* Row 3: Single crisp status string on left + compact Auto-download toggle on right */}
          <div className="flex items-center justify-between gap-3 text-xs">
            <div className="text-content-secondary font-mono truncate">
              {statusString}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                id={autoDownloadId}
                type="button"
                role="switch"
                aria-checked={autoDownloadEnabled}
                aria-label="Automatically download when ready"
                onClick={handleToggleAutoDownload}
                className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-content ${
                  autoDownloadEnabled ? 'bg-content' : 'bg-line'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-2.5 w-2.5 rounded-full bg-surface shadow-xs transition-transform duration-150"
                  style={{
                    transform: autoDownloadEnabled ? 'translateX(14px)' : 'translateX(2px)',
                  }}
                />
              </button>
              <label
                htmlFor={autoDownloadId}
                className="text-xs text-content-secondary cursor-pointer select-none"
              >
                Auto-download
              </label>
            </div>
          </div>

          {/* Direct Stream Available Fallback (if serverless instance routing detected) */}
          {serverlessRoutingDetected && (
            <div className="p-3 rounded-xl border border-line bg-surface-elevated flex items-center justify-between gap-3 text-xs">
              <span className="text-content-secondary truncate">
                Direct stream connection available
              </span>
              <a
                href={resolvedDownloadUrl || directFallbackUrl}
                download={job.outputFilename || true}
                rel={job.deliveryMode === 'zero-hop' ? 'noreferrer' : undefined}
                referrerPolicy={job.deliveryMode === 'zero-hop' ? 'no-referrer' : undefined}
                onClick={triggerBrowserSave}
                className="font-semibold text-content hover:underline shrink-0"
              >
                Save directly
              </a>
            </div>
          )}

          {cancelError && (
            <div className="p-2.5 rounded-lg bg-surface-elevated border border-line text-xs text-content-secondary flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-warning shrink-0" aria-hidden="true" />
              <span>{cancelError}</span>
            </div>
          )}

          {/* Zero-Hop Client Handover */}
          {job.deliveryMode === 'zero-hop' && (
            <div className="p-2.5 rounded-xl border border-line bg-surface-elevated/50 flex items-center justify-between gap-3 text-xs">
              <span className="text-content-secondary truncate">
                Direct CDN download active
              </span>
              <a
                href={resolvedDownloadUrl || directFallbackUrl || (job.id ? `/api/v1/jobs/${encodeURIComponent(job.id)}/download` : '#')}
                download={job.outputFilename || true}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line bg-surface hover:bg-surface-elevated text-xs font-medium text-content transition-colors select-none shrink-0"
                title="Download directly from CDN stream"
              >
                <Download className="w-3.5 h-3.5 text-content-secondary" />
                <span>Save direct stream</span>
              </a>
            </div>
          )}

          {/* Subtle card footer: One understated 12px line */}
          <div className="pt-3 border-t border-line/60 text-[12px] text-content-secondary/80">
            {job.deliveryMode === 'zero-hop' || isRateLimitedOrChallenged ? (
              <span>Direct browser streams process inside your active tab. Keep this page open until your download starts.</span>
            ) : (
              <span>
                Safe to leave this page — server-processed files remain in{' '}
                <Link href="/downloads" className="text-content hover:underline font-medium">
                  My Downloads
                </Link>{' '}
                for 60 minutes.
              </span>
            )}
          </div>
        </div>
      )}

      {/* 2. Ready View: Clean, Confident Verified Artifact Completion */}
      {job.status === 'READY' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-3.5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
                <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-content truncate leading-tight">
                    {readyHeading}
                  </h3>
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 font-medium">
                    <ShieldCheck className="w-3 h-3" />
                    Bitstream Verified
                  </span>
                </div>
                <p className="text-xs text-content-secondary truncate mt-0.5">
                  {friendlyTitle}
                  {shortDomain ? ` · ${shortDomain}` : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
              <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-surface-elevated text-xs font-mono font-medium text-content border border-line">
                {formatPillLabel}
              </span>
              {fileSizeLabel && (
                <span className="text-xs font-mono text-content-secondary tabular-nums">
                  {fileSizeLabel}
                </span>
              )}
            </div>
          </div>

          {/* SHA-256 Checksum badge if available */}
          {(job.checksumSha256 || job.artifact?.checksumSha256) && (
            <div className="p-2.5 rounded-xl border border-line bg-surface-elevated/60 flex items-center justify-between gap-2 text-xs font-mono">
              <span className="text-content-secondary truncate">
                SHA-256: {(job.checksumSha256 || job.artifact?.checksumSha256 || '').slice(0, 16)}…
              </span>
              <button
                type="button"
                onClick={async () => {
                  const hash = job.checksumSha256 || job.artifact?.checksumSha256;
                  if (hash && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(hash);
                  }
                }}
                className="text-[11px] font-semibold text-content hover:underline shrink-0"
              >
                Copy Hash
              </button>
            </div>
          )}

          {/* Primary CTA + Secondary Actions */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
            <a
              href={job.deliveryMode === 'zero-hop' ? (job.directStreamUrl || job.downloadUrl || resolvedDownloadUrl) : resolvedDownloadUrl}
              download={job.outputFilename || true}
              rel={job.deliveryMode === 'zero-hop' ? 'noreferrer' : undefined}
              referrerPolicy={job.deliveryMode === 'zero-hop' ? 'no-referrer' : undefined}
              onClick={triggerBrowserSave}
              className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-content text-base font-semibold text-xs sm:text-sm hover:opacity-90 active:scale-[0.99] transition-[opacity,transform] duration-150 shadow-xs cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-content"
            >
              {downloadInitiated ? (
                <Check className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Download className="w-4 h-4" aria-hidden="true" />
              )}
              <span>{downloadInitiated ? 'Saving to browser…' : downloadLabel}</span>
            </a>

            <button
              type="button"
              onClick={async () => {
                const url = job.deliveryMode === 'zero-hop' ? (job.directStreamUrl || job.downloadUrl || resolvedDownloadUrl) : resolvedDownloadUrl;
                if (url && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                  await navigator.clipboard.writeText(url);
                  setCopiedLink(true);
                  setTimeout(() => setCopiedLink(false), 2000);
                }
              }}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-line bg-surface hover:bg-surface-elevated text-xs font-medium text-content-secondary hover:text-content transition-colors select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-content"
              title="Copy direct download URL"
            >
              {copiedLink ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Link</span>
                </>
              )}
            </button>

            {previewUrl && (
              <button
                type="button"
                onClick={() => setShowPreview((prev) => !prev)}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-line bg-surface hover:bg-surface-elevated text-xs font-medium text-content-secondary hover:text-content transition-colors select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-content"
              >
                {showPreview ? (
                  <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <Play className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{previewToggleLabel}</span>
              </button>
            )}

            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-line bg-surface hover:bg-surface-elevated text-xs font-medium text-content-secondary hover:text-content transition-colors select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-content"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Process another</span>
              </button>
            )}
          </div>

          {/* Optional Media Preview */}
          {showPreview && previewUrl && (
            <div className="pt-2">
              {isAudioOnly ? (
                <audio
                  controls
                  preload="metadata"
                  aria-label={displayFilename}
                  className="w-full rounded-lg"
                  src={previewUrl}
                />
              ) : (
                <video
                  controls
                  preload="metadata"
                  playsInline
                  aria-label={displayFilename}
                  className="w-full max-h-80 rounded-xl bg-surface-elevated border border-line"
                  src={previewUrl}
                />
              )}
            </div>
          )}

          {/* Power-user FFmpeg Command Drawer */}
          {(job as ExtendedProcessingJob & { ffmpegCommand?: string }).ffmpegCommand && (
            <CommandPreviewDrawer
              command={(job as ExtendedProcessingJob & { ffmpegCommand?: string }).ffmpegCommand || ''}
            />
          )}

          {/* Zero-Reupload Tool Chaining */}
          {!isRateLimitedOrChallenged && job.deliveryMode !== 'zero-hop' && (job.id || job.jobId) && (
            <ToolChainBar
              jobId={String(job.id || job.jobId)}
              title={friendlyTitle}
              isAudioOnly={isAudioOnly}
            />
          )}

          {/* Subtle card footer */}
          <div className="pt-3 border-t border-line/60 text-[12px] text-content-secondary/80">
            {isRateLimitedOrChallenged || job.deliveryMode === 'zero-hop' ? (
              <span>Direct browser streams process inside your active tab. File saved directly to your device.</span>
            ) : (
              <span>
                Safe to leave this page — server-processed files remain in{' '}
                <Link href="/downloads" className="text-content hover:underline font-medium">
                  My Downloads
                </Link>{' '}
                for 60 minutes.
              </span>
            )}
          </div>
        </div>
      )}

      {/* 3. Cancelled View */}
      {job.status === 'CANCELLED' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs sm:text-sm text-content-secondary">
              <XCircle className="w-4 h-4 text-content-secondary shrink-0" aria-hidden="true" />
              <span>Download cancelled.</span>
            </div>
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="text-xs font-semibold text-content hover:underline"
              >
                Process another
              </button>
            )}
          </div>
          <div className="pt-3 border-t border-line/60 text-[12px] text-content-secondary/80">
            {isRateLimitedOrChallenged || job.deliveryMode === 'zero-hop' ? (
              <span>Direct browser stream was cancelled.</span>
            ) : (
              <span>
                Safe to leave this page — server-processed files remain in{' '}
                <Link href="/downloads" className="text-content hover:underline font-medium">
                  My Downloads
                </Link>{' '}
                for 60 minutes.
              </span>
            )}
          </div>
        </div>
      )}

      {/* 4. Failed / Rejected View */}
      {(job.status === 'FAILED' || job.status === 'REJECTED') && (
        <div className="space-y-4">
          {isBackendUnavailable ? (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-error-bg border border-error text-error flex items-center justify-center shrink-0 mt-0.5">
                  <AlertCircle className="w-4 h-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm sm:text-base font-semibold text-content leading-tight">
                    Backend media server unavailable
                  </h3>
                  <p className="text-xs text-content-secondary mt-1 leading-relaxed">
                    {friendlyErrorMessage ||
                      'This deployment does not have an active cloud media worker configured (DEGRADED / ERR_BACKEND_NOT_CONFIGURED). Process files locally in your browser or connect a custom worker.'}
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
                <Link
                  href="/tools/media-converter"
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-content text-base text-xs sm:text-sm font-semibold hover:opacity-90 transition-opacity"
                >
                  <Zap className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Open In-Browser Tools</span>
                </Link>
                <Link
                  href="/settings"
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-line bg-surface hover:bg-surface-elevated text-xs sm:text-sm font-semibold text-content transition-colors"
                >
                  <span>Connect Custom Worker</span>
                </Link>
                {onDismiss && (
                  <button
                    type="button"
                    onClick={onDismiss}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-line text-xs font-medium text-content-secondary hover:text-content transition-colors"
                  >
                    <span>Dismiss</span>
                  </button>
                )}
              </div>
            </div>
          ) : isRateLimitedOrChallenged ? (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-surface-elevated border border-line flex items-center justify-center shrink-0 mt-0.5 text-zinc-900 dark:text-zinc-100">
                  <Zap className="w-4 h-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
                    {fallbackDirectStream ? 'Direct browser stream ready' : 'Host restriction detected'}
                  </h3>
                  <p className="text-xs text-zinc-700 dark:text-zinc-300 mt-1 leading-relaxed">
                    {isHostBlocked
                      ? friendlyErrorMessage ||
                        (isMobileDevice
                          ? 'This host challenged cloud worker egress. Connect a custom worker with a clean ISP IP to process this link on mobile.'
                          : 'This host challenged cloud server requests (HOST_BLOCKED). Use MUXARO Direct on desktop or connect a custom worker.')
                      : isMobileDevice
                      ? 'This host challenged cloud worker egress. Connect a custom worker with a clean ISP IP to process this link on mobile.'
                      : 'Cloud servers encountered host restrictions for this media link. Use MUXARO Direct or save the direct stream when available.'}
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
                {!isMobileDevice ? (
                  <Link
                    href={directHelperHref}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-content text-base text-xs sm:text-sm font-semibold hover:opacity-90 transition-opacity"
                  >
                    <Zap className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Stream with MUXARO Direct</span>
                  </Link>
                ) : fallbackDirectStream ? (
                  <a
                    href={fallbackDirectStream}
                    download={job.outputFilename || true}
                    rel="noreferrer"
                    referrerPolicy="no-referrer"
                    onClick={triggerBrowserSave}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-content text-base text-xs sm:text-sm font-semibold hover:opacity-90 transition-opacity"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Download Direct Stream</span>
                  </a>
                ) : (
                  <Link
                    href="/settings"
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-content text-base text-xs sm:text-sm font-semibold transition-opacity"
                  >
                    <span>Connect Custom Worker</span>
                  </Link>
                )}

                {fallbackDirectStream && !isMobileDevice && (
                  <a
                    href={fallbackDirectStream}
                    download={job.outputFilename || true}
                    rel="noreferrer"
                    referrerPolicy="no-referrer"
                    onClick={triggerBrowserSave}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-line bg-surface hover:bg-surface-elevated text-xs sm:text-sm font-semibold text-content transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Save file directly</span>
                  </a>
                )}

                {onDismiss && (
                  <button
                    type="button"
                    onClick={onDismiss}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-line text-xs font-medium text-content-secondary hover:text-content transition-colors"
                  >
                    <span>Dismiss</span>
                  </button>
                )}
              </div>

              <TurnstileChallenge
                title="Human verification"
                subtitle="Complete the verification check below if prompted, then retry."
              />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-error-bg border border-error text-error flex items-center justify-center shrink-0 mt-0.5">
                  <AlertCircle className="w-4 h-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm sm:text-base font-semibold text-content leading-tight">
                    Processing could not be completed
                  </h3>
                  <p className="text-xs text-content-secondary mt-1 leading-relaxed">
                    {friendlyErrorMessage || 'Media processing could not be completed. Check your input file format or settings and try again.'}
                  </p>
                  {(job as ExtendedProcessingJob & { technicalDetails?: string }).technicalDetails && (
                    <details className="mt-2 rounded-lg border border-line bg-surface-elevated/60 px-3 py-2 text-[11px] text-content-secondary">
                      <summary className="cursor-pointer font-medium text-content select-none">
                        Technical details
                      </summary>
                      <pre className="mt-1.5 whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed">
                        {(job as ExtendedProcessingJob & { technicalDetails?: string }).technicalDetails}
                      </pre>
                    </details>
                  )}
                  {retryError && (
                    <p className="text-xs text-error mt-1 leading-relaxed">
                      {retryError}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                {fallbackDirectStream ? (
                  <a
                    href={fallbackDirectStream}
                    download={job.outputFilename || true}
                    rel="noreferrer"
                    referrerPolicy="no-referrer"
                    onClick={triggerBrowserSave}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-content text-base text-xs font-semibold hover:opacity-90 transition-opacity"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Save directly</span>
                  </a>
                ) : !isMobileDevice &&
                  job.sourceUrl &&
                  /^https?:\/\//i.test(job.sourceUrl) &&
                  ![
                    'COMPRESS_TARGET',
                    'TRIM_SPLIT',
                    'VIDEO_TO_GIF',
                    'LOUDNORM_AUDIO',
                    'BURN_SUBTITLES',
                    'SCRUB_METADATA',
                    'ASPECT_RATIO_PAD',
                  ].includes(String(job.operation || '').toUpperCase()) ? (
                  <Link
                    href={directHelperHref}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-content text-base text-xs font-semibold hover:opacity-90 transition-opacity"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>Stream with MUXARO Direct</span>
                  </Link>
                ) : null}

                <button
                  type="button"
                  disabled={retrying}
                  onClick={handleRetry}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-line bg-surface hover:bg-surface-elevated text-xs font-medium text-content transition-colors disabled:opacity-50"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />
                  <span>{retryButtonLabel}</span>
                </button>

                {onDismiss && (
                  <button
                    type="button"
                    onClick={onDismiss}
                    className="inline-flex items-center justify-center px-3 py-2 rounded-xl border border-line text-xs font-medium text-content-secondary hover:text-content transition-colors"
                  >
                    <span>Dismiss</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Subtle card footer */}
          <div className="pt-3 border-t border-line/60 text-[12px] text-content-secondary/80">
            {isBackendUnavailable ? (
              <span>In-browser FFmpeg tools process files locally on your device without server storage.</span>
            ) : (isRateLimitedOrChallenged || job.deliveryMode === 'zero-hop') ? (
              <span>
                {fallbackDirectStream
                  ? 'Direct browser streams process inside your active tab. File saved directly to your device.'
                  : 'Restricted media hosts block datacenter workers. Use MUXARO Direct or connect a custom worker.'}
              </span>
            ) : (
              <span>No output artifact was generated for this failed job.</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
