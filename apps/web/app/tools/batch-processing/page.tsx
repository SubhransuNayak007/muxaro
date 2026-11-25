'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  ArrowLeft,
  Layers,
  Plus,
  Trash2,
  CheckCircle2,
  ShieldCheck,
  AlertCircle,
  RotateCcw,
  Download,
  Loader2,
} from 'lucide-react';
import { api, getApiBaseUrl, readCsrfTokenFromCookie } from '@/lib/api-client';
import { JobState, ProcessingJob } from '@/lib/types';
import { normalizeMediaUrl } from '@/lib/url-utils';
import ActiveLinkIndicator from '@/components/ActiveLinkIndicator';

const JobProgress = dynamic(() => import('@/components/JobProgress'), {
  ssr: false,
  loading: () => (
    <div className="muxaro-card p-6 my-4 text-sm text-content-secondary">
      Loading job progress…
    </div>
  ),
});

interface BatchItem {
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
const TERMINAL_BATCH_STATUSES = new Set([
  'COMPLETED',
  'READY',
  'PARTIAL_FAILURE',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
]);

function mapItemApiOperation(item: Pick<BatchItem, 'operation' | 'format'>) {
  if (item.operation === 'extract_audio') return 'EXTRACT_AUDIO' as const;
  if (item.format === 'native') return 'REMUX_STREAM_COPY' as const;
  return 'TRANSCODE_VIDEO' as const;
}

function parseBatchError(
  status: number,
  json: Record<string, any> | null,
  fallback: string
): { message: string; isBackendDisconnected: boolean } {
  const errCode = json?.error?.code || json?.code;
  const isBackendDisconnected =
    status === 503 || errCode === 'ERR_BACKEND_NOT_CONFIGURED';
  if (isBackendDisconnected) {
    return {
      message:
        json?.error?.message ||
        json?.rawMessage ||
        'Backend worker is not configured (ERR_BACKEND_NOT_CONFIGURED). Connect an execution server in Settings or configure API_INTERNAL_URL.',
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

function toProcessingJob(raw: Record<string, any>, idx: number): ProcessingJob {
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
    jobType:
      raw?.operation === 'EXTRACT_AUDIO' ? 'extract_audio' : 'transcode_video',
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

export default function BatchProcessingPage() {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [newUrl, setNewUrl] = useState<string>('');
  const [defaultFormat, setDefaultFormat] = useState<string>('mp4');
  const [defaultResolution, setDefaultResolution] = useState<string>('1080p');
  const [defaultOperation, setDefaultOperation] = useState<
    'extract_audio' | 'transcode_video'
  >('transcode_video');
  const [isQueueing, setIsQueueing] = useState<boolean>(false);
  const [activeJobs, setActiveJobs] = useState<ProcessingJob[]>([]);
  const [batchSession, setBatchSession] = useState<BatchSessionSummary | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [backendDisconnected, setBackendDisconnected] = useState<boolean>(false);

  const normalizedInputPreview = normalizeMediaUrl(newUrl);

  const handleOperationChange = (nextOp: 'extract_audio' | 'transcode_video') => {
    setDefaultOperation(nextOp);
    if (nextOp === 'extract_audio' && !AUDIO_FORMATS.includes(defaultFormat as any)) {
      setDefaultFormat('mp3');
    } else if (
      nextOp === 'transcode_video' &&
      !VIDEO_FORMATS.includes(defaultFormat as any)
    ) {
      setDefaultFormat('mp4');
    }
  };

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeMediaUrl(newUrl);
    if (!normalized) {
      setErrorMsg('Please enter a valid media link (e.g. youtube.com/watch?v=... or direct media link).');
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        url: normalized,
        format: defaultFormat,
        resolution: defaultOperation === 'extract_audio' ? 'audio_only' : defaultResolution,
        operation: defaultOperation,
      },
    ]);
    setNewUrl('');
    setErrorMsg(null);
    setBackendDisconnected(false);
  };

  const handleRemoveItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleRunBatch = async () => {
    if (items.length === 0) return;
    setIsQueueing(true);
    setErrorMsg(null);
    setBackendDisconnected(false);
    setBatchSession(null);

    try {
      const apiBase = getApiBaseUrl();
      const csrf = readCsrfTokenFromCookie();
      const idempotencyKey = `bat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': idempotencyKey,
      };
      if (csrf) headers['X-CSRF-Token'] = csrf;

      const primaryOp = mapItemApiOperation(items[0]);
      const primaryFormat = items[0].format || defaultFormat;
      const primaryResolution =
        items[0].operation === 'extract_audio' ? undefined : items[0].resolution;

      const res = await fetch(`${apiBase}/batches`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          title: `Batch (${items.length} ${items.length === 1 ? 'item' : 'items'})`,
          operation: primaryOp,
          targetFormat: primaryFormat,
          targetResolution: primaryResolution,
          streamCopy: primaryFormat === 'native',
          idempotencyKey,
          items: items.map((item) => ({
            mediaUrl: item.url,
            title: item.url.split('/').pop()?.split('?')[0] || 'Media file',
            operation: mapItemApiOperation(item),
            targetFormat: item.format,
            targetResolution:
              item.operation === 'extract_audio' ? undefined : item.resolution,
            streamCopy: item.format === 'native',
          })),
        }),
      });

      const json = (await res.json().catch(() => null)) as Record<string, any> | null;

      if (res.status === 404 || res.status === 405) {
        const createdJobs: ProcessingJob[] = [];
        for (const item of items) {
          const filename = item.url.split('/').pop() || 'Media file';
          const job = await api.createJob({
            sourceUrl: item.url,
            jobType: item.operation,
            operation: mapItemApiOperation(item),
            targetFormat: item.format,
            targetResolution:
              item.operation === 'extract_audio' ? undefined : item.resolution,
            streamCopy: item.format === 'native',
            title: filename,
          });
          createdJobs.push(job);
        }
        setActiveJobs(createdJobs);
        return;
      }

      if (!res.ok || !json?.success || !json?.data) {
        const parsed = parseBatchError(
          res.status,
          json,
          `Could not start batch queue (HTTP ${res.status}).`
        );
        setBackendDisconnected(parsed.isBackendDisconnected);
        throw new Error(parsed.message);
      }

      const d = json.data;
      const batchId = String(d.batchId || d.id || '');
      const childJobs = Array.isArray(d.jobs)
        ? d.jobs.map((j: Record<string, any>, idx: number) => toProcessingJob(j, idx))
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
          : 'Could not start batch queue. Check your links and try again.';
      if (
        message.includes('ERR_BACKEND_NOT_CONFIGURED') ||
        message.includes('503')
      ) {
        setBackendDisconnected(true);
      }
      setErrorMsg(message);
    } finally {
      setIsQueueing(false);
    }
  };

  useEffect(() => {
    if (!batchSession?.id) return;
    if (TERMINAL_BATCH_STATUSES.has(batchSession.status.toUpperCase())) return;

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
            const parsed = parseBatchError(
              summaryRes.status,
              summaryJson,
              `Batch status check failed (HTTP ${summaryRes.status}).`
            );
            setBackendDisconnected(parsed.isBackendDisconnected);
            setErrorMsg(parsed.message);
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
              toProcessingJob(j, idx)
            )
          );
        }
      } catch {
        // Keep polling on transient client network interruption
      }
    };

    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, [batchSession?.id, batchSession?.status, batchSession?.title, batchSession?.totalItems, batchSession?.progress]);

  const batchZipHref = batchSession
    ? batchSession.zipDownloadUrl ||
      `${getApiBaseUrl()}/batches/${encodeURIComponent(batchSession.id)}/download.zip`
    : null;
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
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-elevated border border-brand-violet/30 text-xs font-semibold text-brand-violet mb-4 shadow-xs">
              <Layers className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Batch processing</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-content tracking-tight">
              Process multiple files in one go
            </h1>
            <p className="text-base text-content-secondary mt-3 leading-relaxed">
              Queue multiple media links into parallel execution workers with individual progress tracking.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 muxaro-media-card p-6 sm:p-8">
            <form
              onSubmit={handleAddItem}
              className="space-y-4 pb-6 mb-6 border-b border-line"
            >
              <div className="flex items-center justify-between">
                <label
                  htmlFor="batch-new-url"
                  className="block text-sm font-semibold text-content"
                >
                  Add a media link to your batch queue
                </label>
                {normalizedInputPreview && (
                  <span className="text-xs text-brand font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" aria-hidden="true" />
                    Valid address
                  </span>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  id="batch-new-url"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  value={newUrl}
                  onChange={(e) => {
                    setNewUrl(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="Paste video, audio, or direct media link…"
                  className="flex-1 min-w-0 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-surface border border-line text-content placeholder:text-content-muted placeholder:truncate truncate text-xs sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet transition-colors"
                />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-full bg-surface-elevated border border-brand-violet/40 text-brand-violet text-sm font-semibold hover:bg-brand-violet hover:text-white transition-colors active:scale-[0.98] shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>Add to queue</span>
                </button>
              </div>

              {normalizedInputPreview && (
                <div className="pt-1">
                  <ActiveLinkIndicator
                    url={normalizedInputPreview}
                    onClear={() => setNewUrl('')}
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div>
                  <label
                    htmlFor="batch-default-op"
                    className="block text-xs font-medium text-content-secondary mb-1.5"
                  >
                    Operation
                  </label>
                  <select
                    id="batch-default-op"
                    value={defaultOperation}
                    onChange={(e) =>
                      handleOperationChange(
                        e.target.value as 'extract_audio' | 'transcode_video'
                      )
                    }
                    className="w-full px-3 py-2 rounded-xl bg-surface border border-line text-content text-xs sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet transition-colors"
                  >
                    <option value="transcode_video">Convert video</option>
                    <option value="extract_audio">Extract audio</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="batch-default-format"
                    className="block text-xs font-medium text-content-secondary mb-1.5"
                  >
                    Target format
                  </label>
                  <select
                    id="batch-default-format"
                    value={defaultFormat}
                    onChange={(e) => setDefaultFormat(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-surface border border-line text-content text-xs sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet transition-colors"
                  >
                    {(defaultOperation === 'extract_audio'
                      ? AUDIO_FORMATS
                      : VIDEO_FORMATS
                    ).map((fmt) => (
                      <option key={fmt} value={fmt}>
                        {fmt === 'native' ? 'Native stream copy' : fmt.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="batch-default-resolution"
                    className="block text-xs font-medium text-content-secondary mb-1.5"
                  >
                    Target resolution
                  </label>
                  <select
                    id="batch-default-resolution"
                    value={
                      defaultOperation === 'extract_audio'
                        ? 'audio_only'
                        : defaultResolution
                    }
                    disabled={defaultOperation === 'extract_audio'}
                    onChange={(e) => setDefaultResolution(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-surface border border-line text-content text-xs sm:text-sm disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet transition-colors"
                  >
                    {defaultOperation === 'extract_audio' ? (
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

            {items.length === 0 ? (
              <div className="p-8 text-center rounded-2xl bg-surface/50 border border-dashed border-line">
                <Layers className="w-8 h-8 text-content-muted mx-auto mb-2" aria-hidden="true" />
                <p className="text-sm font-medium text-content">No items in your batch queue yet</p>
                <p className="text-xs text-content-muted mt-1">
                  Paste a link above to add items to your conversion queue.
                </p>
              </div>
            ) : (
              <div className="space-y-3 mb-6">
                <div className="flex items-center justify-between text-xs text-content-secondary px-1">
                  <span className="font-semibold text-content">
                    Queued items ({items.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setItems([])}
                    className="text-error hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error rounded-sm px-1"
                  >
                    Clear all
                  </button>
                </div>
                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div
                      key={item.id}
                      className="p-3 rounded-xl bg-surface border border-line flex flex-wrap items-center justify-between gap-3 shadow-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="w-6 h-6 rounded-full bg-surface-elevated text-brand-violet text-xs font-semibold flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <ActiveLinkIndicator url={item.url} showPlatformBadge={false} />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-surface-elevated border border-line text-content-secondary">
                          {item.format.toUpperCase()}
                          {item.operation === 'transcode_video' && item.resolution !== 'source'
                            ? ` · ${item.resolution}`
                            : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(item.id)}
                          aria-label={`Remove item ${idx + 1}`}
                          className="p-1.5 rounded-lg text-content-muted hover:text-error hover:bg-error-bg/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {errorMsg && (
              <div
                role="alert"
                className="p-4 rounded-xl bg-error-bg border border-error text-sm text-error flex flex-wrap items-center justify-between gap-3 mb-6"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{errorMsg}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {backendDisconnected && (
                    <Link
                      href="/settings?tab=instances"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-error bg-surface text-error text-xs font-semibold hover:bg-surface-elevated transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
                    >
                      Configure Backend
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={handleRunBatch}
                    disabled={isQueueing || items.length === 0}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-error bg-surface text-error text-xs font-semibold hover:bg-surface-elevated transition-colors active:opacity-90 disabled:opacity-50 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Retry</span>
                  </button>
                </div>
              </div>
            )}

            {items.length > 0 && (
              <div className="flex flex-wrap items-center gap-4 pt-2">
                <button
                  type="button"
                  onClick={handleRunBatch}
                  disabled={isQueueing || items.length === 0}
                  className="px-6 py-3 rounded-full bg-brand-violet text-white text-sm font-semibold hover:bg-brand-violet/90 active:scale-[0.98] transition-transform shadow-xs disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2"
                >
                  {isQueueing ? 'Queueing jobs…' : `Start batch of ${items.length} ${items.length === 1 ? 'job' : 'jobs'}`}
                </button>
                <span className="text-xs text-content-secondary">
                  Uses {items.length} of your 10 daily free media jobs
                </span>
              </div>
            )}

            {batchSession && (
              <div className="mt-8 pt-6 border-t border-line">
                <div className="p-4 sm:p-5 rounded-xl bg-surface border border-line space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-content">
                        {batchSession.title}
                      </p>
                      <p className="text-xs text-content-secondary mt-0.5">
                        {batchSession.completedItems} of {batchSession.totalItems} complete
                        {batchSession.failedItems > 0
                          ? ` (${batchSession.failedItems} failed)`
                          : ''}
                        {' '}— Status: {batchSession.status}
                      </p>
                    </div>
                    {isBatchZipReady && batchZipHref ? (
                      <a
                        href={batchZipHref}
                        download
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-violet text-white text-xs sm:text-sm font-semibold hover:bg-brand-violet/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet"
                      >
                        <Download className="w-4 h-4" aria-hidden="true" />
                        <span>Download batch ZIP archive</span>
                      </a>
                    ) : !TERMINAL_BATCH_STATUSES.has(batchSession.status) ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-violet">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                        <span>Processing {batchSession.progress}%</span>
                      </span>
                    ) : null}
                  </div>
                  <div className="w-full h-2 rounded-full bg-surface-elevated overflow-hidden">
                    <div
                      className="w-full h-full bg-brand-violet origin-left transition-transform duration-300"
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
                <h3 className="text-sm font-bold text-content">Active batch progress</h3>
                <div className="space-y-4">
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
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="muxaro-media-card p-6 space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-content">
                <Layers className="w-4 h-4 text-brand" aria-hidden="true" />
                <span>Batch processing specs</span>
              </div>
              <ul className="space-y-3 text-xs text-content-secondary leading-relaxed">
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Parallel queuing with worker autoscaling for fast turnaround.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Independent retry logic for transient upstream network drops.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Instant per-item download buttons upon task completion.</span>
                </li>
              </ul>
            </div>

            <div className="muxaro-media-card p-6 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-content">
                <ShieldCheck className="w-4 h-4 text-brand" aria-hidden="true" />
                <span>Isolated sandboxing</span>
              </div>
              <p className="text-xs text-content-secondary leading-relaxed">
                Every batch job executes inside an isolated sandbox with zero cross-job data leakage.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
