'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  ArrowLeft,
  Layers,
  ListVideo,
  Plus,
  Trash2,
  CheckCircle2,
  ShieldCheck,
  AlertCircle,
  RotateCcw,
  Download,
  Clock,
  Loader2,
  Search,
} from 'lucide-react';
import { api, getApiBaseUrl, readCsrfTokenFromCookie } from '@/lib/api-client';
import { JobState, ProcessingJob } from '@/lib/types';
import { normalizeMediaUrl, sanitizeSafeNavigationUrl, generateSecureId } from '@/lib/url-utils';
import ActiveLinkIndicator from '@/components/ActiveLinkIndicator';

const JobProgress = dynamic(() => import('@/components/JobProgress'), {
  ssr: false,
  loading: () => (
    <div className="muxaro-card p-6 my-4 text-sm text-content-secondary">
      Loading job progress…
    </div>
  ),
});

interface BatchEntry {
  id: string;
  url: string;
  format: string;
  resolution: string;
  operation: 'extract_audio' | 'transcode_video';
}

interface BatchSessionSummary {
  id: string;
  title: string;
  status: string;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  progress: number;
  zipDownloadUrl?: string | null;
}

const VIDEO_FORMATS = ['mp4', 'mkv', 'webm', 'mov', 'native'] as const;
const AUDIO_FORMATS = ['mp3', 'flac', 'wav', 'aac', 'm4a', 'opus'] as const;
const RESOLUTION_OPTIONS = ['source', '2160p', '1440p', '1080p', '720p', '480p'] as const;
const TERMINAL_STATUSES = new Set([
  'COMPLETED',
  'READY',
  'PARTIAL_FAILURE',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
]);

function isAudioFormat(fmt: string): boolean {
  return AUDIO_FORMATS.includes(fmt.toLowerCase() as any);
}

function mapApiOperation(op: 'extract_audio' | 'transcode_video', format: string) {
  if (op === 'extract_audio' || isAudioFormat(format)) return 'EXTRACT_AUDIO' as const;
  if (format === 'native') return 'REMUX_STREAM_COPY' as const;
  return 'TRANSCODE_VIDEO' as const;
}

function parseEndpointError(
  status: number,
  json: Record<string, any> | null,
  fallback: string
): { message: string; isBackendDisconnected: boolean } {
  const code = json?.error?.code || json?.code;
  const isBackendDisconnected =
    status === 503 || code === 'ERR_BACKEND_NOT_CONFIGURED';
  if (isBackendDisconnected) {
    return {
      message:
        json?.error?.message ||
        json?.rawMessage ||
        'Backend worker is not configured (ERR_BACKEND_NOT_CONFIGURED). Connect an execution server in Settings or set API_INTERNAL_URL.',
      isBackendDisconnected: true,
    };
  }
  return {
    message:
      json?.error?.userMessage ||
      json?.error?.message ||
      json?.message ||
      fallback,
    isBackendDisconnected: false,
  };
}

function normalizeChildJob(raw: Record<string, any>, idx: number): ProcessingJob {
  const id = String(raw?.id || raw?.jobId || `batch_job_${idx}`);
  const rawStatus = String(raw?.status || 'QUEUED').toUpperCase();
  const status = (rawStatus === 'COMPLETED' ? 'READY' : rawStatus) as JobState;
  const targetFormat = String(raw?.targetFormat || 'mp4');
  return {
    id,
    jobId: id,
    batchId: raw?.batchId || undefined,
    itemNumber: raw?.itemNumber ?? idx + 1,
    sourceUrl: raw?.sourceUrl || undefined,
    jobType: raw?.operation === 'EXTRACT_AUDIO' ? 'extract_audio' : 'transcode_video',
    operation: String(raw?.operation || 'TRANSCODE_VIDEO'),
    targetFormat,
    targetResolution: raw?.targetResolution || undefined,
    streamCopy: Boolean(raw?.losslessPreserved ?? targetFormat === 'native'),
    status,
    progress: typeof raw?.progress === 'number' ? raw.progress : 0,
    progressStage: String(raw?.stageMessage || raw?.stage || status),
    inputTitle: String(raw?.inputTitle || raw?.title || `Item ${idx + 1}`),
    downloadUrl: raw?.downloadUrl || raw?.artifact?.downloadUrl || undefined,
    error:
      raw?.error?.userMessage ||
      raw?.error?.message ||
      raw?.userMessage ||
      undefined,
    errorMessage:
      raw?.error?.message || raw?.userMessage || undefined,
    userMessage: raw?.userMessage || undefined,
    createdAt: String(raw?.createdAt || new Date().toISOString()),
    completedAt: raw?.completedAt || undefined,
    expiresAt: raw?.expiresAt || undefined,
  };
}

interface InspectedPlaylistItem {
  position: number;
  title: string;
  url: string;
  durationSeconds?: number;
}

interface InspectedPlaylist {
  title: string;
  sourceUrl: string;
  totalItems: number;
  items: InspectedPlaylistItem[];
}

interface PlaylistJobItemStatus {
  position: number;
  title: string;
  status: 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED';
  downloadUrl?: string | null;
}

interface PlaylistJobStatus {
  playlistJobId: string;
  title: string;
  status: string;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  progress: number;
  zipDownloadUrl?: string | null;
  items?: PlaylistJobItemStatus[];
}

export default function PlaylistBatchPage() {
  const [mode, setMode] = useState<'batch' | 'playlist'>('batch');
  const maxPlaylistItems = 50;
  const [filenameTemplate, setFilenameTemplate] = useState<string>('{index}_{title}_{res}');
  const [skipFailed, setSkipFailed] = useState<boolean>(true);

  // Batch state (starts clean and empty)
  const [items, setItems] = useState<BatchEntry[]>([]);
  const [newUrl, setNewUrl] = useState<string>('');
  const [batchOp, setBatchOp] = useState<'extract_audio' | 'transcode_video'>(
    'transcode_video'
  );
  const [batchFormat, setBatchFormat] = useState<string>('mp4');
  const [batchResolution, setBatchResolution] = useState<string>('1080p');
  const [isBatchSubmitting, setIsBatchSubmitting] = useState<boolean>(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchBackendDisconnected, setBatchBackendDisconnected] = useState<boolean>(false);
  const [batchSession, setBatchSession] = useState<BatchSessionSummary | null>(null);
  const [activeJobs, setActiveJobs] = useState<ProcessingJob[]>([]);

  // Playlist state (starts clean and empty)
  const [playlistUrl, setPlaylistUrl] = useState<string>('');
  const [playlistFormat, setPlaylistFormat] = useState<string>('mp4');
  const [playlistResolution, setPlaylistResolution] = useState<string>('1080p');
  const [packageZip, setPackageZip] = useState<boolean>(true);
  const [isInspecting, setIsInspecting] = useState<boolean>(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspected, setInspected] = useState<InspectedPlaylist | null>(null);
  const [isPlaylistSubmitting, setIsPlaylistSubmitting] = useState<boolean>(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [playlistBackendDisconnected, setPlaylistBackendDisconnected] = useState<boolean>(false);
  const [playlistJob, setPlaylistJob] = useState<PlaylistJobStatus | null>(null);

  const handleBatchOperationChange = (
    nextOp: 'extract_audio' | 'transcode_video'
  ) => {
    setBatchOp(nextOp);
    if (nextOp === 'extract_audio' && !isAudioFormat(batchFormat)) {
      setBatchFormat('mp3');
    } else if (nextOp === 'transcode_video' && isAudioFormat(batchFormat)) {
      setBatchFormat('mp4');
    }
  };

  const handleAddBatchItem = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeMediaUrl(newUrl);
    if (!normalized) {
      setBatchError('Please paste a valid media link (e.g. youtube.com/watch?v=... or direct MP4).');
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        id: generateSecureId('item_'),
        url: normalized,
        format: batchFormat,
        resolution: batchOp === 'extract_audio' ? 'audio_only' : batchResolution,
        operation: batchOp,
      },
    ]);
    setNewUrl('');
    setBatchError(null);
    setBatchBackendDisconnected(false);
  };

  const handleRunBatch = async () => {
    if (items.length === 0) return;

    setIsBatchSubmitting(true);
    setBatchError(null);
    setBatchBackendDisconnected(false);
    setBatchSession(null);

    try {
      const apiBase = getApiBaseUrl();
      const csrf = readCsrfTokenFromCookie();
      const idempotencyKey = generateSecureId('bat_');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': idempotencyKey,
      };
      if (csrf) headers['X-CSRF-Token'] = csrf;

      const primary = items[0];
      const primaryOp = mapApiOperation(primary.operation, primary.format);

      const res = await fetch(`${apiBase}/batches`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          title: `Batch (${items.length} ${items.length === 1 ? 'item' : 'items'})`,
          operation: primaryOp,
          targetFormat: primary.format,
          targetResolution:
            primary.operation === 'extract_audio' ? undefined : primary.resolution,
          filenameTemplate,
          skipFailed,
          streamCopy: primary.format === 'native',
          idempotencyKey,
          items: items.map((item) => ({
            mediaUrl: item.url,
            title: item.url.split('/').pop()?.split('?')[0] || 'Media file',
            operation: mapApiOperation(item.operation, item.format),
            targetFormat: item.format,
            targetResolution:
              item.operation === 'extract_audio' ? undefined : item.resolution,
            streamCopy: item.format === 'native',
          })),
        }),
      });

      const json = (await res.json().catch(() => null)) as Record<string, any> | null;

      if (res.status === 404 || res.status === 405) {
        const jobs: ProcessingJob[] = [];
        for (const item of items) {
          const name = item.url.split('/').pop() || 'Media file';
          const job = await api.createJob({
            sourceUrl: item.url,
            jobType: item.operation,
            operation: mapApiOperation(item.operation, item.format),
            targetFormat: item.format,
            targetResolution:
              item.operation === 'extract_audio' ? undefined : item.resolution,
            streamCopy: item.format === 'native',
            title: name,
          });
          jobs.push(job);
        }
        setActiveJobs(jobs);
        return;
      }

      if (!res.ok || !json?.success || !json?.data) {
        const parsed = parseEndpointError(
          res.status,
          json,
          `Could not start batch processing (HTTP ${res.status}).`
        );
        setBatchBackendDisconnected(parsed.isBackendDisconnected);
        throw new Error(parsed.message);
      }

      const d = json.data;
      const batchId = String(d.batchId || d.id || '');
      const childJobs = Array.isArray(d.jobs)
        ? d.jobs.map((j: Record<string, any>, idx: number) => normalizeChildJob(j, idx))
        : [];
      setActiveJobs(childJobs);
      if (batchId) {
        setBatchSession({
          id: batchId,
          title: String(d.title || `Batch (${items.length} items)`),
          status: String(d.status || 'QUEUED').toUpperCase(),
          totalItems: Number(d.totalItems) || items.length,
          completedItems: Number(d.completedItems) || 0,
          failedItems: Number(d.failedItems) || 0,
          progress: typeof d.progress === 'number' ? d.progress : 0,
          zipDownloadUrl: d.zipDownloadUrl || null,
        });
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Could not start batch processing. Check your links and try again.';
      if (
        message.includes('ERR_BACKEND_NOT_CONFIGURED') ||
        message.includes('503')
      ) {
        setBatchBackendDisconnected(true);
      }
      setBatchError(message);
    } finally {
      setIsBatchSubmitting(false);
    }
  };

  useEffect(() => {
    if (!batchSession?.id) return;
    if (TERMINAL_STATUSES.has(batchSession.status.toUpperCase())) return;

    const apiBase = getApiBaseUrl();
    const poll = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      try {
        const [summaryRes, jobsRes] = await Promise.all([
          fetch(`${apiBase}/batches/${encodeURIComponent(batchSession.id)}`, {
            credentials: 'include',
            headers: { Accept: 'application/json' },
          }),
          fetch(`${apiBase}/batches/${encodeURIComponent(batchSession.id)}/jobs`, {
            credentials: 'include',
            headers: { Accept: 'application/json' },
          }),
        ]);
        const summaryJson = (await summaryRes.json().catch(() => null)) as Record<string, any> | null;
        if (!summaryRes.ok || !summaryJson?.success || !summaryJson?.data) {
          if (
            summaryRes.status === 503 ||
            summaryRes.status === 403 ||
            summaryRes.status === 404 ||
            summaryJson?.code === 'ERR_BACKEND_NOT_CONFIGURED'
          ) {
            const parsed = parseEndpointError(
              summaryRes.status,
              summaryJson,
              `Batch status polling failed (HTTP ${summaryRes.status}).`
            );
            setBatchBackendDisconnected(parsed.isBackendDisconnected);
            setBatchError(parsed.message);
            setBatchSession((prev) => (prev ? { ...prev, status: 'FAILED' } : null));
          }
          return;
        }
        const d = summaryJson.data;
        setBatchSession({
          id: String(d.batchId || d.id || batchSession.id),
          title: String(d.title || batchSession.title),
          status: String(d.status || 'PROCESSING').toUpperCase(),
          totalItems: Number(d.totalItems) || batchSession.totalItems,
          completedItems: Number(d.completedItems) || 0,
          failedItems: Number(d.failedItems) || 0,
          progress: typeof d.progress === 'number' ? d.progress : batchSession.progress,
          zipDownloadUrl: d.zipDownloadUrl || null,
        });

        const jobsJson = (await jobsRes.json().catch(() => null)) as Record<string, any> | null;
        if (jobsRes.ok && jobsJson?.success && Array.isArray(jobsJson?.data?.jobs)) {
          setActiveJobs(
            jobsJson.data.jobs.map((j: Record<string, any>, idx: number) =>
              normalizeChildJob(j, idx)
            )
          );
        }
      } catch {
        // Keep current status on transient network hiccup
      }
    };

    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, [batchSession?.id, batchSession?.status, batchSession?.title, batchSession?.totalItems, batchSession?.progress]);

  const inspectPlaylist = useCallback(async () => {
    const trimmed = normalizeMediaUrl(playlistUrl);
    if (!trimmed) {
      setInspectError('Please paste a valid authorised playlist link (e.g. youtube.com/playlist?list=...).');
      return;
    }

    setIsInspecting(true);
    setInspectError(null);
    setPlaylistError(null);
    setPlaylistBackendDisconnected(false);
    try {
      const apiBase = getApiBaseUrl();
      const csrf = readCsrfTokenFromCookie();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (csrf) headers['X-CSRF-Token'] = csrf;

      const res = await fetch(`${apiBase}/playlists/inspect`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ url: trimmed, maxItems: 50 }),
      });
      const json = (await res.json().catch(() => null)) as Record<string, any> | null;
      if (!res.ok || !json?.success) {
        const parsed = parseEndpointError(
          res.status,
          json,
          `Could not inspect playlist (HTTP ${res.status}).`
        );
        setPlaylistBackendDisconnected(parsed.isBackendDisconnected);
        throw new Error(parsed.message);
      }
      const data = json.data;
      const rawItems = Array.isArray(data?.items) ? data.items : [];
      setInspected({
        title: String(data?.title || 'Authorised Playlist'),
        sourceUrl: String(data?.sourceUrl || trimmed),
        totalItems: Number(data?.totalItems) || rawItems.length,
        items: rawItems.map((item: InspectedPlaylistItem, idx: number) => ({
          position: Number(item?.position) || idx + 1,
          title: String(item?.title || `Track ${idx + 1}`),
          url: String(item?.url || ''),
          durationSeconds:
            typeof item?.durationSeconds === 'number' ? item.durationSeconds : undefined,
        })),
      });
      setPlaylistJob(null);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Could not inspect this playlist. Check the link and try again.';
      setInspectError(message);
      setInspected(null);
    } finally {
      setIsInspecting(false);
    }
  }, [playlistUrl]);

  const submitPlaylist = useCallback(async () => {
    const trimmed = normalizeMediaUrl(playlistUrl);
    if (!trimmed) {
      setPlaylistError('Please paste a valid authorised playlist link (e.g. youtube.com/playlist?list=...).');
      return;
    }

    setIsPlaylistSubmitting(true);
    setPlaylistError(null);
    setPlaylistBackendDisconnected(false);
    try {
      const apiBase = getApiBaseUrl();
      const csrf = readCsrfTokenFromCookie();
      const idempotencyKey = generateSecureId('plb_');
      const audioOnly = isAudioFormat(playlistFormat);
      const operation = audioOnly
        ? 'EXTRACT_AUDIO'
        : playlistFormat === 'native'
        ? 'REMUX_STREAM_COPY'
        : 'TRANSCODE_VIDEO';

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': idempotencyKey,
      };
      if (csrf) headers['X-CSRF-Token'] = csrf;

      const res = await fetch(`${apiBase}/playlists/jobs`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          playlistUrl: trimmed,
          operation,
          targetFormat: playlistFormat,
          targetResolution: audioOnly ? undefined : playlistResolution,
          filenameTemplate,
          skipFailed,
          packageAsZip: packageZip,
          idempotencyKey,
        }),
      });
      const json = (await res.json().catch(() => null)) as Record<string, any> | null;
      if (!res.ok || !json?.success) {
        const parsed = parseEndpointError(
          res.status,
          json,
          `Could not start playlist job (HTTP ${res.status}).`
        );
        setPlaylistBackendDisconnected(parsed.isBackendDisconnected);
        throw new Error(parsed.message);
      }
      const d = json.data || {};
      const total = Number(d.totalItems) || inspected?.totalItems || 0;
      const completed = Number(d.completedItems) || 0;
      setPlaylistJob({
        playlistJobId: String(d.playlistJobId || ''),
        title: inspected?.title || String(d.title || 'Authorised Playlist'),
        status: String(d.status || 'QUEUED').toUpperCase(),
        totalItems: total,
        completedItems: completed,
        failedItems: Number(d.failedItems) || 0,
        progress: total > 0 ? Math.round((completed / total) * 100) : 0,
        zipDownloadUrl: d.zipDownloadUrl || null,
        items: Array.isArray(d.items) ? d.items : undefined,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Could not start playlist job. Please try again.';
      setPlaylistError(message);
    } finally {
      setIsPlaylistSubmitting(false);
    }
  }, [
    playlistUrl,
    playlistFormat,
    playlistResolution,
    packageZip,
    inspected,
  ]);

  useEffect(() => {
    if (!playlistJob?.playlistJobId) return;
    const st = playlistJob.status.toUpperCase();
    if (TERMINAL_STATUSES.has(st)) {
      return;
    }

    const apiBase = getApiBaseUrl();
    const poll = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      try {
        const res = await fetch(
          `${apiBase}/playlists/jobs/${encodeURIComponent(playlistJob.playlistJobId)}`,
          { credentials: 'include', headers: { Accept: 'application/json' } }
        );
        const json = (await res.json().catch(() => null)) as Record<string, any> | null;
        if (!res.ok || !json?.success || !json.data) {
          if (
            res.status === 503 ||
            res.status === 403 ||
            res.status === 404 ||
            json?.code === 'ERR_BACKEND_NOT_CONFIGURED'
          ) {
            const parsed = parseEndpointError(
              res.status,
              json,
              `Playlist status check failed (HTTP ${res.status}).`
            );
            setPlaylistBackendDisconnected(parsed.isBackendDisconnected);
            setPlaylistError(parsed.message);
            setPlaylistJob((prev) => (prev ? { ...prev, status: 'FAILED' } : null));
          }
          return;
        }
        const d = json.data;
        const nextStatus = String(d.status || playlistJob.status).toUpperCase();
        const total = Number(d.totalItems) || playlistJob.totalItems;
        const completed = Number(d.completedItems) || 0;
        const pct =
          typeof d.progress === 'number'
            ? d.progress
            : total > 0
            ? Math.round((completed / total) * 100)
            : 0;
        if (nextStatus === 'FAILED' && d.error) {
          setPlaylistError(String(d.error));
        }
        setPlaylistJob((prev) =>
          prev
            ? {
                ...prev,
                status: nextStatus,
                totalItems: total,
                completedItems: completed,
                failedItems: Number(d.failedItems) || 0,
                progress: Math.min(100, Math.max(0, pct)),
                zipDownloadUrl: d.zipDownloadUrl || prev.zipDownloadUrl || null,
                items: Array.isArray(d.items) ? d.items : prev.items,
              }
            : null
        );
      } catch {
        // Keep current status on transient network hiccup
      }
    };

    const timer = setInterval(poll, 1500);
    poll();
    return () => clearInterval(timer);
  }, [playlistJob?.playlistJobId, playlistJob?.status, playlistJob?.totalItems]);

  const derivedPlaylistItems: PlaylistJobItemStatus[] = (() => {
    if (!playlistJob) return [];
    if (Array.isArray(playlistJob.items) && playlistJob.items.length > 0) {
      return playlistJob.items;
    }
    const baseItems = inspected?.items || [];
    const count = Math.max(baseItems.length, playlistJob.totalItems);
    const isComplete =
      playlistJob.status === 'COMPLETED' || playlistJob.status === 'READY';
    return Array.from({ length: count }).map((_, idx) => {
      const source = baseItems[idx];
      let itemStatus: PlaylistJobItemStatus['status'] = 'QUEUED';
      if (isComplete || idx < playlistJob.completedItems) {
        itemStatus = 'READY';
      } else if (idx === playlistJob.completedItems && playlistJob.status === 'PROCESSING') {
        itemStatus = 'PROCESSING';
      }
      return {
        position: source?.position || idx + 1,
        title: source?.title || `Item ${idx + 1}`,
        status: itemStatus,
        downloadUrl: null,
      };
    });
  })();

  const isPlaylistComplete =
    playlistJob?.status === 'COMPLETED' || playlistJob?.status === 'READY';
  const isPlaylistPartial = playlistJob?.status === 'PARTIAL_FAILURE';
  const isPlaylistFailed = playlistJob?.status === 'FAILED';
  const playlistZipHref = playlistJob
    ? sanitizeSafeNavigationUrl(
        playlistJob.zipDownloadUrl ||
          `${getApiBaseUrl()}/playlists/jobs/${encodeURIComponent(playlistJob.playlistJobId)}/download`
      )
    : undefined;
  const batchZipHref = batchSession
    ? sanitizeSafeNavigationUrl(
        batchSession.zipDownloadUrl ||
          `${getApiBaseUrl()}/batches/${encodeURIComponent(batchSession.id)}/download.zip`
      )
    : undefined;
  const isBatchZipReady =
    !!batchSession &&
    (batchSession.status === 'COMPLETED' ||
      batchSession.status === 'READY' ||
      (batchSession.status === 'PARTIAL_FAILURE' && batchSession.completedItems > 0) ||
      !!batchSession.zipDownloadUrl);

  return (
    <div className="w-full">
      <section className="muxaro-hero-surface border-b border-line">
        <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
          <div className="flex flex-wrap items-center gap-4 mb-6 text-sm">
            <Link
              href="/tools"
              className="inline-flex items-center gap-1.5 font-medium text-content-secondary hover:text-content transition-colors"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>All tools</span>
            </Link>
            <Link
              href="/"
              className="font-medium text-content-secondary hover:text-content transition-colors"
            >
              Home workspace
            </Link>
          </div>

          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface border border-line text-xs font-medium text-brand mb-4">
              <Layers className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Batch & playlist workspace</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-content tracking-tight">
              Batch and playlist processing
            </h1>
            <p className="text-base text-content-secondary mt-3 leading-relaxed">
              Queue multiple links or package an authorised playlist into one ZIP file.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 muxaro-media-card p-6 sm:p-8">
            {/* Mode Switcher Tabs */}
            <div
              role="tablist"
              aria-label="Processing mode"
              className="muxaro-segmented-group mb-6"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'batch'}
                onClick={() => setMode('batch')}
                className={`muxaro-segmented-tab ${mode === 'batch' ? 'active' : ''}`}
              >
                <Layers className="w-4 h-4 text-brand" aria-hidden="true" />
                <span>Batch links</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'playlist'}
                onClick={() => setMode('playlist')}
                className={`muxaro-segmented-tab ${mode === 'playlist' ? 'active' : ''}`}
              >
                <ListVideo className="w-4 h-4 text-info" aria-hidden="true" />
                <span>Playlist archive</span>
              </button>
            </div>

            {mode === 'batch' ? (
              <div className="space-y-6">
                <form
                  onSubmit={handleAddBatchItem}
                  className="space-y-4 pb-6 border-b border-line"
                >
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="pb-batch-url"
                      className="block text-sm font-semibold text-content"
                    >
                      Add link to batch queue
                    </label>
                    {normalizeMediaUrl(newUrl) && (
                      <span className="text-xs text-brand font-medium">Valid link</span>
                    )}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <input
                      id="pb-batch-url"
                      type="text"
                      inputMode="url"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck="false"
                      value={newUrl}
                      onChange={(e) => {
                        setNewUrl(e.target.value);
                        if (batchError) setBatchError(null);
                      }}
                      placeholder="Paste video, audio, or direct media link…"
                      className="flex-1 min-w-0 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-surface border border-line text-content placeholder:text-content-muted placeholder:truncate truncate text-xs sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet transition-colors"
                    />
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full border border-brand-violet/40 bg-surface-elevated text-brand-violet text-sm font-semibold hover:bg-brand-violet hover:text-white transition-colors active:scale-[0.98] shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet whitespace-nowrap"
                    >
                      <Plus className="w-4 h-4" aria-hidden="true" />
                      <span>Add link</span>
                    </button>
                  </div>

                  {normalizeMediaUrl(newUrl) && (
                    <div className="pt-1">
                      <ActiveLinkIndicator
                        url={normalizeMediaUrl(newUrl)}
                        onClear={() => setNewUrl('')}
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label
                        htmlFor="pb-batch-op"
                        className="block text-xs font-medium text-content-secondary mb-1.5"
                      >
                        Action
                      </label>
                      <select
                        id="pb-batch-op"
                        value={batchOp}
                        onChange={(e) =>
                          handleBatchOperationChange(
                            e.target.value as 'extract_audio' | 'transcode_video'
                          )
                        }
                        className="w-full px-3.5 py-2 rounded-sm bg-base border border-line text-content text-sm focus:border-brand transition-colors"
                      >
                        <option value="transcode_video">Convert video</option>
                        <option value="extract_audio">Extract audio</option>
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="pb-batch-format"
                        className="block text-xs font-medium text-content-secondary mb-1.5"
                      >
                        Format
                      </label>
                      <select
                        id="pb-batch-format"
                        value={batchFormat}
                        onChange={(e) => setBatchFormat(e.target.value)}
                        className="w-full px-3.5 py-2 rounded-sm bg-base border border-line text-content text-sm focus:border-brand transition-colors"
                      >
                        {(batchOp === 'extract_audio' ? AUDIO_FORMATS : VIDEO_FORMATS).map(
                          (fmt) => (
                            <option key={fmt} value={fmt}>
                              {fmt === 'native' ? 'Native stream copy' : fmt.toUpperCase()}
                            </option>
                          )
                        )}
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="pb-batch-resolution"
                        className="block text-xs font-medium text-content-secondary mb-1.5"
                      >
                        Resolution
                      </label>
                      <select
                        id="pb-batch-resolution"
                        value={batchOp === 'extract_audio' ? 'audio_only' : batchResolution}
                        disabled={batchOp === 'extract_audio'}
                        onChange={(e) => setBatchResolution(e.target.value)}
                        className="w-full px-3.5 py-2 rounded-sm bg-base border border-line text-content text-sm disabled:opacity-60 focus:border-brand transition-colors"
                      >
                        {batchOp === 'extract_audio' ? (
                          <option value="audio_only">Audio only</option>
                        ) : (
                          RESOLUTION_OPTIONS.map((resOpt) => (
                            <option key={resOpt} value={resOpt}>
                              {resOpt === 'source' ? 'Original source' : resOpt}
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                  </div>
                </form>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-content-secondary">
                    <span className="font-semibold text-content">
                      Items in queue ({items.length})
                    </span>
                    <span>
                      {items.length} queued for batch packaging
                    </span>
                  </div>

                  {items.length === 0 ? (
                    <div className="p-8 rounded-md border border-dashed border-line text-center">
                      <p className="text-sm font-medium text-content mb-1">
                        No links in your batch queue yet
                      </p>
                      <p className="text-xs text-content-secondary">
                        Paste one or more authorised media links above to get started.
                      </p>
                    </div>
                  ) : (
                    items.map((item, idx) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 p-3.5 rounded-md bg-surface-elevated border border-line-subtle"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className="w-6 h-6 rounded-full bg-surface text-brand font-semibold text-xs flex items-center justify-center border border-line shrink-0">
                            {idx + 1}
                          </span>
                          <span className="text-sm text-content truncate">
                            {item.url}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="px-2.5 py-1 rounded-full bg-surface border border-line text-xs font-medium text-content-secondary">
                            {item.format.toUpperCase()}
                            {item.operation === 'transcode_video' && item.resolution !== 'source'
                              ? ` · ${item.resolution}`
                              : ''}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setItems((prev) => prev.filter((x) => x.id !== item.id))
                            }
                            aria-label={`Remove item ${idx + 1}`}
                            className="p-1.5 rounded-sm text-content-secondary hover:text-error transition-colors active:opacity-90"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {batchError && (
                  <div className="p-4 rounded-md bg-error-bg border border-error text-sm text-error flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>{batchError}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {batchBackendDisconnected && (
                        <Link
                          href="/settings?tab=instances"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-error bg-surface text-error text-xs font-semibold hover:bg-surface-elevated transition-colors whitespace-nowrap"
                        >
                          Configure Backend
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={handleRunBatch}
                        disabled={isBatchSubmitting || items.length === 0}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-error bg-surface text-error text-xs font-semibold hover:bg-surface-elevated transition-colors active:opacity-90 disabled:opacity-50 whitespace-nowrap"
                      >
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Retry</span>
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  disabled={isBatchSubmitting || items.length === 0}
                  onClick={handleRunBatch}
                  className="muxaro-btn-primary px-6 py-3 text-sm whitespace-nowrap active:opacity-90 disabled:opacity-50"
                >
                  {isBatchSubmitting
                    ? 'Starting batch…'
                    : items.length === 0
                    ? 'Add links to start'
                    : `Process ${items.length} ${items.length === 1 ? 'file' : 'files'}`}
                </button>

                {batchSession && (
                  <div className="mt-6 pt-6 border-t border-line">
                    <div className="p-4 rounded-md bg-surface-elevated border border-line space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-content">
                            {batchSession.title}
                          </p>
                          <p className="text-xs text-content-secondary tabular-nums mt-0.5">
                            {batchSession.completedItems} of {batchSession.totalItems} complete
                            {batchSession.failedItems > 0
                              ? ` (${batchSession.failedItems} failed)`
                              : ''}
                            {' '}— {batchSession.status}
                          </p>
                        </div>
                        {isBatchZipReady && batchZipHref ? (
                          <a
                            href={batchZipHref}
                            download
                            className="muxaro-btn-primary px-4 py-2 text-xs sm:text-sm inline-flex items-center gap-2 whitespace-nowrap active:opacity-90 shrink-0"
                          >
                            <Download className="w-4 h-4" aria-hidden="true" />
                            <span>Download batch ZIP</span>
                          </a>
                        ) : !TERMINAL_STATUSES.has(batchSession.status) ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand">
                            <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" aria-hidden="true" />
                            <span>Processing {batchSession.progress}%</span>
                          </span>
                        ) : null}
                      </div>
                      <div className="w-full h-2 rounded-full bg-surface border border-line overflow-hidden">
                        <div
                          className="h-full w-full bg-brand origin-left transition-transform duration-300"
                          style={{
                            transform: `scaleX(${Math.min(1, Math.max(0, batchSession.progress / 100))})`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {activeJobs.length > 0 && (
                  <div className="mt-6 space-y-4">
                    <h2 className="text-base font-bold text-content">
                      Active batch jobs
                    </h2>
                    {activeJobs.map((job) => (
                      <JobProgress
                        key={job.id}
                        initialJob={job}
                        onJobUpdate={(updated) => {
                          setActiveJobs((prev) =>
                            prev.map((j) => (j.id === updated.id ? updated : j))
                          );
                        }}
                        onDismiss={() => {
                          setActiveJobs((prev) => prev.filter((j) => j.id !== job.id));
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                <div className="p-3.5 rounded-xl bg-surface border border-line-subtle flex flex-wrap items-center justify-between gap-3 text-xs text-content-secondary">
                  <div className="flex items-center gap-2">
                    <ListVideo className="w-4 h-4 text-brand-violet shrink-0" aria-hidden="true" />
                    <span>
                      Playlist ZIP packaging with up to {maxPlaylistItems} items
                    </span>
                  </div>
                  <span>Max {maxPlaylistItems} items per archive</span>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    inspectPlaylist();
                  }}
                  className="space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="pb-playlist-url"
                      className="block text-sm font-semibold text-content"
                    >
                      Authorised playlist link
                    </label>
                    {normalizeMediaUrl(playlistUrl) && (
                      <span className="text-xs text-brand-violet font-medium">Valid playlist link</span>
                    )}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <input
                      id="pb-playlist-url"
                      type="text"
                      inputMode="url"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck="false"
                      value={playlistUrl}
                      onChange={(e) => {
                        setPlaylistUrl(e.target.value);
                        if (inspectError) setInspectError(null);
                      }}
                      placeholder="Paste playlist link or album URL…"
                      className="flex-1 min-w-0 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl bg-surface border border-line text-content placeholder:text-content-muted placeholder:truncate truncate text-xs sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet transition-colors"
                    />
                    <button
                      type="submit"
                      disabled={isInspecting || !playlistUrl.trim()}
                      className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-brand-violet text-white text-sm font-semibold hover:bg-brand-violet/90 active:scale-[0.98] transition-transform shadow-xs disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet whitespace-nowrap"
                    >
                      <Search className="w-4 h-4" aria-hidden="true" />
                      <span>{isInspecting ? 'Inspecting…' : 'Inspect playlist'}</span>
                    </button>
                  </div>

                  {normalizeMediaUrl(playlistUrl) && (
                    <div className="pt-1">
                      <ActiveLinkIndicator
                        url={normalizeMediaUrl(playlistUrl)}
                        onClear={() => setPlaylistUrl('')}
                      />
                    </div>
                  )}
                </form>

                {inspectError && (
                  <div className="p-4 rounded-md bg-error-bg border border-error text-sm text-error flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>{inspectError}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {playlistBackendDisconnected && (
                        <Link
                          href="/settings?tab=instances"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-error bg-surface text-error text-xs font-semibold hover:bg-surface-elevated transition-colors whitespace-nowrap"
                        >
                          Configure Backend
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={inspectPlaylist}
                        disabled={isInspecting || !playlistUrl.trim()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-error bg-surface text-error text-xs font-semibold hover:bg-surface-elevated transition-colors active:opacity-90 disabled:opacity-50 whitespace-nowrap"
                      >
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Retry</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label
                      htmlFor="pb-playlist-format"
                      className="block text-sm font-medium text-content mb-2"
                    >
                      Output format
                    </label>
                    <select
                      id="pb-playlist-format"
                      value={playlistFormat}
                      onChange={(e) => setPlaylistFormat(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-sm bg-base border border-line text-content text-sm focus:border-brand transition-colors"
                    >
                      <option value="mp4">MP4 (Standard video)</option>
                      <option value="mkv">MKV (High compatibility)</option>
                      <option value="webm">WEBM (VP9 / Opus video)</option>
                      <option value="mp3">MP3 (320 kbps audio)</option>
                      <option value="flac">FLAC (Lossless audio)</option>
                      <option value="aac">AAC (M4A audio)</option>
                      <option value="wav">WAV (PCM audio)</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="pb-playlist-resolution"
                      className="block text-sm font-medium text-content mb-2"
                    >
                      Target resolution
                    </label>
                    <select
                      id="pb-playlist-resolution"
                      value={isAudioFormat(playlistFormat) ? 'audio_only' : playlistResolution}
                      disabled={isAudioFormat(playlistFormat)}
                      onChange={(e) => setPlaylistResolution(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-sm bg-base border border-line text-content text-sm disabled:opacity-60 focus:border-brand transition-colors"
                    >
                      {isAudioFormat(playlistFormat) ? (
                        <option value="audio_only">Audio only</option>
                      ) : (
                        RESOLUTION_OPTIONS.map((resOpt) => (
                          <option key={resOpt} value={resOpt}>
                            {resOpt === 'source' ? 'Original source' : resOpt}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div className="sm:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-line-subtle">
                    <div>
                      <label htmlFor="pb-filename-template" className="block text-xs font-medium text-content-secondary mb-1.5">
                        ZIP filename template
                      </label>
                      <select
                        id="pb-filename-template"
                        value={filenameTemplate}
                        onChange={(e) => setFilenameTemplate(e.target.value)}
                        className="w-full px-3 py-2 rounded-sm bg-base border border-line text-content text-xs font-mono"
                      >
                        <option value="{index}_{title}_{res}">{'{index}_{title}_{res}'}</option>
                        <option value="{index} - {title}">{'{index} - {title}'}</option>
                        <option value="{title}_{res}">{'{title}_{res}'}</option>
                      </select>
                    </div>
                    <div className="flex items-end pb-1">
                      <label className="flex items-center gap-2 text-xs text-content cursor-pointer">
                        <input
                          type="checkbox"
                          checked={skipFailed}
                          onChange={(e) => setSkipFailed(e.target.checked)}
                          className="w-4 h-4 rounded-sm border border-line accent-brand"
                        />
                        <span>Skip unavailable items automatically so one dead link never aborts the ZIP</span>
                      </label>
                    </div>
                  </div>
                </div>

                {!inspected && !playlistJob && (
                  <div className="p-8 rounded-md border border-dashed border-line text-center">
                    <p className="text-sm font-medium text-content mb-1">
                      No playlist inspected yet
                    </p>
                    <p className="text-xs text-content-secondary">
                      Paste an authorised playlist link above to inspect its items before processing.
                    </p>
                  </div>
                )}

                {inspected && !playlistJob && (
                  <div className="p-4 rounded-md bg-surface-elevated border border-line-subtle space-y-2">
                    <div className="flex items-center justify-between text-xs pb-2 border-b border-line">
                      <span className="font-semibold text-content">{inspected.title}</span>
                      <span className="text-content-secondary tabular-nums">
                        {inspected.totalItems} items
                      </span>
                    </div>
                    <div className="divide-y divide-line-subtle text-sm max-h-56 overflow-y-auto">
                      {inspected.items.map((item) => (
                        <div key={item.position} className="py-2 text-content truncate">
                          {item.position}. {item.title}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {playlistError && (
                  <div className="p-4 rounded-md bg-error-bg border border-error text-sm text-error flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>{playlistError}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {playlistBackendDisconnected && (
                        <Link
                          href="/settings?tab=instances"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-error bg-surface text-error text-xs font-semibold hover:bg-surface-elevated transition-colors whitespace-nowrap"
                        >
                          Configure Backend
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={submitPlaylist}
                        disabled={isPlaylistSubmitting || !playlistUrl.trim()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-error bg-surface text-error text-xs font-semibold hover:bg-surface-elevated transition-colors active:opacity-90 disabled:opacity-50 whitespace-nowrap"
                      >
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Retry</span>
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={submitPlaylist}
                  disabled={isPlaylistSubmitting || !playlistUrl.trim()}
                  className="muxaro-btn-primary px-6 py-3 text-sm whitespace-nowrap active:opacity-90 disabled:opacity-50"
                >
                  {isPlaylistSubmitting
                    ? 'Starting playlist…'
                    : 'Process playlist'}
                </button>

                {playlistJob && (
                  <div className="pt-6 border-t border-line space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-base font-bold text-content">
                          {playlistJob.title}
                        </h2>
                        <p className="text-xs text-content-secondary tabular-nums">
                          {playlistJob.completedItems} of {playlistJob.totalItems} items complete
                          {playlistJob.failedItems > 0
                            ? ` (${playlistJob.failedItems} failed)`
                            : ''}
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-surface-elevated border border-line text-content">
                        {isPlaylistComplete ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-success" aria-hidden="true" />
                        ) : isPlaylistPartial || isPlaylistFailed ? (
                          <AlertCircle className="w-3.5 h-3.5 text-error" aria-hidden="true" />
                        ) : (
                          <Loader2 className="w-3.5 h-3.5 text-brand motion-safe:animate-spin" aria-hidden="true" />
                        )}
                        <span>
                          {isPlaylistComplete
                            ? 'Ready'
                            : isPlaylistPartial
                            ? 'Partial complete'
                            : isPlaylistFailed
                            ? 'Failed'
                            : 'Processing'}
                        </span>
                      </span>
                    </div>

                    <div className="w-full h-2.5 rounded-full bg-surface-elevated border border-line overflow-hidden">
                      <div
                        className="h-full w-full bg-brand origin-left transition-transform duration-300"
                        style={{ transform: `scaleX(${playlistJob.progress / 100})` }}
                      />
                    </div>

                    {packageZip &&
                      playlistZipHref &&
                      (isPlaylistComplete ||
                        (isPlaylistPartial && playlistJob.completedItems > 0) ||
                        !!playlistJob.zipDownloadUrl) && (
                        <div className="p-4 rounded-md bg-surface-muted border border-line flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <p className="text-sm font-semibold text-content">
                            {isPlaylistPartial
                              ? `Partial archive ready (${playlistJob.completedItems} of ${playlistJob.totalItems} items).`
                              : 'Your verified playlist ZIP archive is ready.'}
                          </p>
                          <a
                            href={playlistZipHref}
                            download
                            className="muxaro-btn-primary px-5 py-2.5 text-sm inline-flex items-center justify-center gap-2 whitespace-nowrap active:opacity-90 shrink-0"
                          >
                            <Download className="w-4 h-4" aria-hidden="true" />
                            <span>Download all as ZIP</span>
                          </a>
                        </div>
                      )}

                    {derivedPlaylistItems.length > 0 && (
                      <div className="p-4 rounded-md bg-surface-elevated border border-line-subtle divide-y divide-line-subtle text-sm max-h-64 overflow-y-auto">
                        {derivedPlaylistItems.map((item) => (
                          <div
                            key={item.position}
                            className="py-2 flex items-center justify-between gap-3"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              {item.status === 'READY' ? (
                                <CheckCircle2 className="w-4 h-4 text-success shrink-0" aria-hidden="true" />
                              ) : item.status === 'PROCESSING' ? (
                                <Loader2 className="w-4 h-4 text-brand motion-safe:animate-spin shrink-0" aria-hidden="true" />
                              ) : item.status === 'FAILED' ? (
                                <AlertCircle className="w-4 h-4 text-error shrink-0" aria-hidden="true" />
                              ) : (
                                <Clock className="w-4 h-4 text-content-muted shrink-0" aria-hidden="true" />
                              )}
                              <span className="text-content truncate">{item.title}</span>
                            </div>
                            {item.status === 'READY' && sanitizeSafeNavigationUrl(item.downloadUrl) ? (
                              <a
                                href={sanitizeSafeNavigationUrl(item.downloadUrl) ?? '#'}
                                download
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-sm border border-line bg-surface text-xs font-semibold text-brand hover:border-brand transition-colors active:opacity-90 whitespace-nowrap"
                              >
                                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Download</span>
                              </a>
                            ) : (
                              <span className="text-xs text-content-secondary shrink-0">
                                {item.status === 'READY'
                                  ? 'In ZIP'
                                  : item.status === 'PROCESSING'
                                  ? 'Processing…'
                                  : item.status === 'FAILED'
                                  ? 'Failed'
                                  : 'Queued'}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="muxaro-media-card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-content">
                  Batch &amp; playlist capabilities
                </span>
                <Link
                  href="/docs/video-studio"
                  className="text-xs text-brand hover:underline font-medium"
                >
                  Read guide
                </Link>
              </div>
              <ul className="space-y-3 text-xs text-content-secondary leading-relaxed">
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>
                    Queue multi-URL video or audio batches with unified or per-item format rules.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>
                    Package up to <strong className="text-content font-semibold">{maxPlaylistItems}</strong> authorised items into a single organized ZIP archive.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>
                    Skip-failed resilience and custom filename templates with 60-minute ephemeral cleanup.
                  </span>
                </li>
              </ul>
            </div>

            <div className="muxaro-media-card p-6 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-content">
                <ShieldCheck className="w-4 h-4 text-brand" aria-hidden="true" />
                <span>Dedicated pages</span>
              </div>
              <div className="flex flex-col gap-2 text-xs pt-1">
                <Link
                  href="/tools/batch-processing"
                  className="font-semibold text-brand hover:underline"
                >
                  Open standalone batch processor
                </Link>
                <Link
                  href="/tools/playlist-processing"
                  className="font-semibold text-brand hover:underline"
                >
                  Open standalone playlist processor
                </Link>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
