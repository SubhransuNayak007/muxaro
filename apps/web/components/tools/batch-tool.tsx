'use client';

/**
 * Project MUXARO - Batch & Playlists Processing Tool Component
 * Supports:
 * - Playlist URL inspection (YouTube, SoundCloud, Bandcamp playlists)
 * - Multi-link & multi-track queue with expandable track listing
 * - Per-item progress bar, stage indicator, and live status
 * - Global batch controls (Process All, Cancel, Format Selector)
 * - Single streaming ZIP archive download when complete
 * - Hallmark compliant token styling, accessible UI, no blanket all-property transitions
 */

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  ListVideo,
  Download,
  Archive,
  CheckCircle2,
  AlertCircle,
  Clock,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Plus,
  Trash2,
} from 'lucide-react';
import { getApiBaseUrl, readCsrfTokenFromCookie } from '@/lib/api-client';
import { normalizeMediaUrl } from '@/lib/url-utils';

export interface BatchItem {
  id: string;
  itemNumber: number;
  title: string;
  mediaUrl: string;
  duration?: number;
  format: string;
  resolution?: string;
  status: 'PENDING' | 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED' | 'CANCELLED';
  progress: number;
  stageMessage?: string;
  downloadUrl?: string;
  error?: string;
}

const AUDIO_FORMATS = new Set(['mp3', 'flac', 'wav', 'aac', 'm4a', 'opus']);
const RESOLUTION_OPTIONS = ['source', '2160p', '1440p', '1080p', '720p', '480p'] as const;
const TERMINAL_BATCH_STATUSES = new Set([
  'READY',
  'COMPLETED',
  'PARTIAL_FAILURE',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
]);

function mapItemOperation(fmt: string) {
  const lower = fmt.toLowerCase();
  if (AUDIO_FORMATS.has(lower)) return 'EXTRACT_AUDIO' as const;
  if (lower === 'mkv' || lower === 'native') return 'REMUX_STREAM_COPY' as const;
  return 'TRANSCODE_VIDEO' as const;
}

function parseBatchToolError(
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
        'Backend worker is not configured (ERR_BACKEND_NOT_CONFIGURED). Connect an execution node in Settings or set API_INTERNAL_URL.',
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

export function BatchTool() {
  const [sourceMode, setSourceMode] = useState<'playlist' | 'manual'>('playlist');
  const [playlistUrl, setPlaylistUrl] = useState<string>('');
  const [isInspecting, setIsInspecting] = useState<boolean>(false);
  const [playlistTitle, setPlaylistTitle] = useState<string>('');

  // Manual URLs list
  const [manualUrlInput, setManualUrlInput] = useState<string>('');

  // Batch Queue
  const [items, setItems] = useState<BatchItem[]>([]);
  const [globalFormat, setGlobalFormat] = useState<string>('mp4');
  const [globalResolution, setGlobalResolution] = useState<string>('1080p');
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  // Active Batch Processing
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<string>('QUEUED');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [zipDownloadUrl, setZipDownloadUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [backendDisconnected, setBackendDisconnected] = useState<boolean>(false);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean polling timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // Inspect playlist URL
  const handleInspectPlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = normalizeMediaUrl(playlistUrl);
    if (!cleanUrl) {
      setErrorMessage('Please enter a valid playlist link.');
      return;
    }

    setIsInspecting(true);
    setErrorMessage(null);
    setBackendDisconnected(false);

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
        body: JSON.stringify({ url: cleanUrl, maxItems: 50 }),
      });

      const body = (await res.json().catch(() => null)) as Record<string, any> | null;
      if (!res.ok || body?.success === false) {
        const parsed = parseBatchToolError(
          res.status,
          body,
          `Failed to inspect playlist (HTTP ${res.status}).`
        );
        setBackendDisconnected(parsed.isBackendDisconnected);
        throw new Error(parsed.message);
      }

      const discoveredItems: any[] = body?.data?.items || body?.items || [];
      const title = body?.data?.title || 'Imported Playlist';

      setPlaylistTitle(title);

      const parsed: BatchItem[] = discoveredItems.map((item, idx) => ({
        id: `item_${idx + 1}_${Date.now()}`,
        itemNumber: Number(item?.position) || idx + 1,
        title: item?.title || `Track ${idx + 1}`,
        mediaUrl: item?.url || item?.mediaUrl || cleanUrl,
        duration: item?.durationSeconds ?? item?.duration,
        format: globalFormat,
        resolution: AUDIO_FORMATS.has(globalFormat) ? undefined : globalResolution,
        status: 'PENDING',
        progress: 0,
        stageMessage: 'Ready to process',
      }));

      setItems(parsed);
    } catch (err: any) {
      const msg = err?.message || 'Playlist inspection failed.';
      setErrorMessage(msg);
      if (msg.includes('ERR_BACKEND_NOT_CONFIGURED')) setBackendDisconnected(true);
    } finally {
      setIsInspecting(false);
    }
  };

  // Add a manual URL to the queue
  const handleAddManualItem = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = normalizeMediaUrl(manualUrlInput);
    if (!clean) {
      setErrorMessage('Please enter a valid media link.');
      return;
    }

    const newItem: BatchItem = {
      id: `manual_${items.length + 1}_${Date.now()}`,
      itemNumber: items.length + 1,
      title: `Item ${items.length + 1} (${clean.replace(/^https?:\/\//, '').slice(0, 30)}...)`,
      mediaUrl: clean,
      format: globalFormat,
      resolution: AUDIO_FORMATS.has(globalFormat) ? undefined : globalResolution,
      status: 'PENDING',
      progress: 0,
      stageMessage: 'Ready to process',
    };

    setItems((prev) => [...prev, newItem]);
    setManualUrlInput('');
    setErrorMessage(null);
    setBackendDisconnected(false);
  };

  // Remove an item from the queue
  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  // Apply format to all items
  const handleGlobalFormatChange = (fmt: string) => {
    setGlobalFormat(fmt);
    setItems((prev) =>
      prev.map((item) =>
        item.status === 'PENDING'
          ? {
              ...item,
              format: fmt,
              resolution: AUDIO_FORMATS.has(fmt) ? undefined : globalResolution,
            }
          : item
      )
    );
  };

  const handleGlobalResolutionChange = (resOpt: string) => {
    setGlobalResolution(resOpt);
    setItems((prev) =>
      prev.map((item) =>
        item.status === 'PENDING' && !AUDIO_FORMATS.has(item.format)
          ? { ...item, resolution: resOpt }
          : item
      )
    );
  };

  // Poll batch progress (both /batches/:id summary and /batches/:id/jobs child items)
  const startPollingBatch = (id: string) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    const apiBase = getApiBaseUrl();

    const poll = async () => {
      try {
        const [summaryRes, jobsRes] = await Promise.all([
          fetch(`${apiBase}/batches/${encodeURIComponent(id)}`, {
            credentials: 'include',
            headers: { Accept: 'application/json' },
          }),
          fetch(`${apiBase}/batches/${encodeURIComponent(id)}/jobs`, {
            credentials: 'include',
            headers: { Accept: 'application/json' },
          }),
        ]);

        const summaryJson = (await summaryRes.json().catch(() => null)) as Record<string, any> | null;
        if (!summaryRes.ok || summaryJson?.success === false) {
          if (
            summaryRes.status === 503 ||
            summaryRes.status === 403 ||
            summaryRes.status === 404 ||
            summaryJson?.code === 'ERR_BACKEND_NOT_CONFIGURED'
          ) {
            const parsed = parseBatchToolError(
              summaryRes.status,
              summaryJson,
              `Batch polling failed (HTTP ${summaryRes.status}).`
            );
            setBackendDisconnected(parsed.isBackendDisconnected);
            setErrorMessage(parsed.message);
            setBatchStatus('FAILED');
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          }
          return;
        }

        const data = summaryJson?.data || summaryJson;
        const nextStatus = String(data?.status || 'PROCESSING').toUpperCase();
        setBatchStatus(nextStatus);

        const jobsJson = (await jobsRes.json().catch(() => null)) as Record<string, any> | null;
        const remoteJobs: any[] =
          (Array.isArray(jobsJson?.data?.jobs) && jobsJson.data.jobs) ||
          (Array.isArray(data?.jobs) && data.jobs) ||
          (Array.isArray(data?.items) && data.items) ||
          [];

        if (remoteJobs.length > 0) {
          setItems((prev) =>
            prev.map((existing, idx) => {
              const updated =
                remoteJobs.find(
                  (j) =>
                    (j.id && j.id === existing.id) ||
                    (j.jobId && j.jobId === existing.id) ||
                    (typeof j.itemNumber === 'number' && j.itemNumber === existing.itemNumber)
                ) || remoteJobs[idx];
              if (!updated) return existing;
              return {
                ...existing,
                status: String(updated.status || existing.status).toUpperCase() as BatchItem['status'],
                progress: typeof updated.progress === 'number' ? updated.progress : existing.progress,
                stageMessage: updated.stageMessage || updated.status,
                downloadUrl: updated.downloadUrl || updated.artifact?.downloadUrl || existing.downloadUrl,
                error: updated.userMessage || updated.error?.userMessage || updated.error?.message,
              };
            })
          );
        }

        if (TERMINAL_BATCH_STATUSES.has(nextStatus)) {
          const completed = Number(data?.completedItems) || 0;
          if (
            nextStatus === 'READY' ||
            nextStatus === 'COMPLETED' ||
            (nextStatus === 'PARTIAL_FAILURE' && completed > 0) ||
            data?.zipDownloadUrl ||
            data?.downloadUrl
          ) {
            setZipDownloadUrl(
              data?.zipDownloadUrl ||
                data?.downloadUrl ||
                `${apiBase}/batches/${encodeURIComponent(id)}/download.zip`
            );
          }
          if (nextStatus === 'FAILED' && data?.error) {
            setErrorMessage(String(data.error));
          }
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        }
      } catch {
        // Non-blocking transient network errors
      }
    };

    pollTimerRef.current = setInterval(poll, 2000);
  };

  // Start Batch Execution
  const handleStartBatch = async () => {
    if (items.length === 0) {
      setErrorMessage('Please add at least one track or playlist item to start.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setBackendDisconnected(false);
    setZipDownloadUrl(null);

    try {
      const apiBase = getApiBaseUrl();
      const csrf = readCsrfTokenFromCookie();
      const idempotencyKey = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const isGlobalAudio = AUDIO_FORMATS.has(globalFormat);
      const operation = mapItemOperation(globalFormat);

      const payload = {
        title: playlistTitle || `Batch Export (${items.length} items)`,
        operation,
        targetFormat: globalFormat,
        targetResolution: isGlobalAudio ? undefined : globalResolution,
        streamCopy: globalFormat === 'mkv' || globalFormat === 'native',
        idempotencyKey,
        items: items.map((i) => {
          const itemFormat = i.format || globalFormat;
          const itemIsAudio = AUDIO_FORMATS.has(itemFormat);
          return {
            mediaUrl: i.mediaUrl,
            title: i.title,
            operation: mapItemOperation(itemFormat),
            targetFormat: itemFormat,
            targetResolution: itemIsAudio ? undefined : i.resolution || globalResolution,
            streamCopy: itemFormat === 'mkv' || itemFormat === 'native',
          };
        }),
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': idempotencyKey,
      };
      if (csrf) headers['X-CSRF-Token'] = csrf;

      const res = await fetch(`${apiBase}/batches`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(payload),
      });

      const body = (await res.json().catch(() => null)) as Record<string, any> | null;
      if (!res.ok || body?.success === false) {
        const parsed = parseBatchToolError(
          res.status,
          body,
          `Failed to initialize batch (HTTP ${res.status}).`
        );
        setBackendDisconnected(parsed.isBackendDisconnected);
        throw new Error(parsed.message);
      }

      const d = body?.data || body || {};
      const createdBatchId = String(d.batchId || d.id || '');
      if (!createdBatchId) {
        throw new Error('Batch creation response did not contain a batch ID.');
      }
      if (Array.isArray(d.jobs) && d.jobs.length > 0) {
        setItems((prev) =>
          prev.map((existing, idx) => {
            const j = d.jobs[idx];
            if (!j) return existing;
            return {
              ...existing,
              id: String(j.id || j.jobId || existing.id),
              status: String(j.status || 'QUEUED').toUpperCase() as BatchItem['status'],
              progress: typeof j.progress === 'number' ? j.progress : 0,
            };
          })
        );
      }
      setBatchId(createdBatchId);
      setBatchStatus(String(d.status || 'QUEUED').toUpperCase());
      startPollingBatch(createdBatchId);
    } catch (err: any) {
      const msg = err?.message || 'Batch creation failed.';
      setErrorMessage(msg);
      if (msg.includes('ERR_BACKEND_NOT_CONFIGURED')) setBackendDisconnected(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetBatch = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setBatchId(null);
    setBatchStatus('QUEUED');
    setZipDownloadUrl(null);
    setErrorMessage(null);
    setBackendDisconnected(false);
    setItems([]);
    setPlaylistUrl('');
    setPlaylistTitle('');
  };

  const completedCount = items.filter((i) => i.status === 'READY').length;
  const failedCount = items.filter((i) => i.status === 'FAILED').length;
  const overallProgress =
    items.length > 0
      ? Math.round(
          items.reduce((acc, curr) => acc + (curr.progress || 0), 0) / items.length
        )
      : 0;

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8">
      {/* Header Bar */}
      <div className="border-b border-[var(--muxaro-border)] pb-6">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="p-1.5 rounded-lg bg-[var(--muxaro-tag-pill-bg)] text-[var(--muxaro-indigo)]">
            <ListVideo className="w-5 h-5" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--muxaro-text-primary)]">
            Batch & Playlists
          </h1>
        </div>
        <p className="text-sm text-[var(--muxaro-text-secondary)]">
          Queue up to 50 tracks or full playlists for automated multi-threaded conversion and single streaming ZIP packaging.
        </p>
      </div>

      {!batchId ? (
        <div className="space-y-6">
          {/* Source Selection & Import */}
          <div className="muxaro-card p-6 bg-[var(--muxaro-bg-surface)] border border-[var(--muxaro-border)] rounded-2xl shadow-[var(--muxaro-shadow-card)] space-y-5">
            <div className="flex items-center gap-2 border-b border-[var(--muxaro-border-subtle)] pb-4">
              <button
                type="button"
                onClick={() => setSourceMode('playlist')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
                  sourceMode === 'playlist'
                    ? 'bg-[var(--muxaro-indigo)] text-white'
                    : 'text-[var(--muxaro-text-secondary)] hover:bg-[var(--muxaro-bg-elevated)]'
                }`}
              >
                <ListVideo className="w-4 h-4" />
                <span>Import Public Playlist</span>
              </button>
              <button
                type="button"
                onClick={() => setSourceMode('manual')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
                  sourceMode === 'manual'
                    ? 'bg-[var(--muxaro-indigo)] text-white'
                    : 'text-[var(--muxaro-text-secondary)] hover:bg-[var(--muxaro-bg-elevated)]'
                }`}
              >
                <Plus className="w-4 h-4" />
                <span>Add Multiple Links Manually</span>
              </button>
            </div>

            {sourceMode === 'playlist' ? (
              <form onSubmit={handleInspectPlaylist} className="flex gap-3">
                <input
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={playlistUrl}
                  onChange={(e) => setPlaylistUrl(e.target.value)}
                  placeholder="Paste playlist link or album URL…"
                  className="flex-1 min-w-0 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] text-xs sm:text-sm text-[var(--muxaro-text-primary)] placeholder-[var(--muxaro-text-tertiary)] placeholder:truncate truncate focus:border-[var(--muxaro-border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet transition-colors"
                />
                <button
                  type="submit"
                  disabled={isInspecting}
                  className="px-6 py-3 rounded-xl bg-[var(--muxaro-indigo)] text-white font-semibold text-sm hover:opacity-95 disabled:opacity-50 transition-opacity"
                >
                  {isInspecting ? 'Inspecting…' : 'Load Playlist'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleAddManualItem} className="flex gap-3">
                <input
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={manualUrlInput}
                  onChange={(e) => setManualUrlInput(e.target.value)}
                  placeholder="Paste video or audio link to queue…"
                  className="flex-1 min-w-0 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] text-xs sm:text-sm text-[var(--muxaro-text-primary)] placeholder-[var(--muxaro-text-tertiary)] placeholder:truncate truncate focus:border-[var(--muxaro-border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet transition-colors"
                />
                <button
                  type="submit"
                  className="px-6 py-3 rounded-xl bg-[var(--muxaro-indigo)] text-white font-semibold text-sm hover:opacity-95 transition-opacity"
                >
                  Add Item
                </button>
              </form>
            )}
          </div>

          {/* Queue & Configuration */}
          {items.length > 0 && (
            <div className="muxaro-card p-6 bg-[var(--muxaro-bg-surface)] border border-[var(--muxaro-border)] rounded-2xl shadow-[var(--muxaro-shadow-card)] space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--muxaro-border-subtle)] pb-4">
                <div>
                  <h2 className="text-base font-bold text-[var(--muxaro-text-primary)]">
                    {playlistTitle || 'Queued Items'} ({items.length} total)
                  </h2>
                  <p className="text-xs text-[var(--muxaro-text-secondary)]">
                    Configure target container, resolution, or adjust individual track formats below.
                  </p>
                </div>

                {/* Global Format & Resolution Selectors */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[var(--muxaro-text-secondary)]">
                      Format All:
                    </span>
                    <select
                      value={globalFormat}
                      onChange={(e) => handleGlobalFormatChange(e.target.value)}
                      className="px-3 py-1.5 rounded-lg border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] text-xs font-semibold text-[var(--muxaro-text-primary)]"
                    >
                      <option value="mp4">MP4 Video (H.264/AAC)</option>
                      <option value="mkv">MKV Video (Stream Copy)</option>
                      <option value="webm">WebM Video (VP9)</option>
                      <option value="mp3">MP3 Audio (320 kbps)</option>
                      <option value="flac">FLAC Audio (Lossless)</option>
                      <option value="wav">WAV Audio (Studio PCM)</option>
                      <option value="aac">AAC Audio (256 kbps)</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[var(--muxaro-text-secondary)]">
                      Resolution:
                    </span>
                    <select
                      value={AUDIO_FORMATS.has(globalFormat) ? 'audio_only' : globalResolution}
                      disabled={AUDIO_FORMATS.has(globalFormat)}
                      onChange={(e) => handleGlobalResolutionChange(e.target.value)}
                      className="px-3 py-1.5 rounded-lg border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] text-xs font-semibold text-[var(--muxaro-text-primary)] disabled:opacity-50"
                    >
                      {AUDIO_FORMATS.has(globalFormat) ? (
                        <option value="audio_only">Audio only</option>
                      ) : (
                        RESOLUTION_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt === 'source' ? 'Original' : opt}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                </div>
              </div>

              {/* Expandable Track Listing */}
              <div className="divide-y divide-[var(--muxaro-border-subtle)] border border-[var(--muxaro-border)] rounded-xl overflow-hidden">
                {items.map((item) => {
                  const isExpanded = expandedItemId === item.id;
                  return (
                    <div
                      key={item.id}
                      className="bg-[var(--muxaro-bg-base)] hover:bg-[var(--muxaro-bg-surface)] transition-colors duration-150"
                    >
                      <div className="p-3.5 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="font-mono text-xs font-bold text-[var(--muxaro-indigo)] shrink-0">
                            #{String(item.itemNumber).padStart(3, '0')}
                          </span>
                          <span className="text-sm font-semibold text-[var(--muxaro-text-primary)] truncate">
                            {item.title}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-[var(--muxaro-tag-pill-bg)] text-[var(--muxaro-indigo)]">
                            .{item.format}
                          </span>
                          <button
                            type="button"
                            onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                            className="p-1 rounded text-slate-400 hover:text-slate-600"
                            title="Toggle Details"
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            className="p-1 rounded text-red-400 hover:text-red-600"
                            title="Remove"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Expanded Settings */}
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-1 bg-[var(--muxaro-bg-surface)] border-t border-[var(--muxaro-border-subtle)] text-xs space-y-2">
                          <div className="text-slate-500 font-mono break-all">
                            Source: {item.mediaUrl}
                          </div>
                          <div className="flex flex-wrap items-center gap-4 pt-1">
                            <label className="flex items-center gap-2">
                              <span className="font-semibold text-slate-700 dark:text-slate-300">
                                Override Format:
                              </span>
                              <select
                                value={item.format}
                                onChange={(e) => {
                                  const nextFmt = e.target.value;
                                  setItems((prev) =>
                                    prev.map((i) =>
                                      i.id === item.id ? { ...i, format: nextFmt } : i
                                    )
                                  );
                                }}
                                className="px-2 py-1 rounded border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] text-xs"
                              >
                                <option value="mp4">MP4</option>
                                <option value="mkv">MKV</option>
                                <option value="webm">WebM</option>
                                <option value="mp3">MP3</option>
                                <option value="flac">FLAC</option>
                                <option value="wav">WAV</option>
                                <option value="aac">AAC</option>
                              </select>
                            </label>
                            {!AUDIO_FORMATS.has(item.format) && (
                              <label className="flex items-center gap-2">
                                <span className="font-semibold text-slate-700 dark:text-slate-300">
                                  Resolution:
                                </span>
                                <select
                                  value={item.resolution || globalResolution}
                                  onChange={(e) => {
                                    const nextRes = e.target.value;
                                    setItems((prev) =>
                                      prev.map((i) =>
                                        i.id === item.id ? { ...i, resolution: nextRes } : i
                                      )
                                    );
                                  }}
                                  className="px-2 py-1 rounded border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] text-xs"
                                >
                                  {RESOLUTION_OPTIONS.map((opt) => (
                                    <option key={opt} value={opt}>
                                      {opt === 'source' ? 'Original' : opt}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Start Batch Button */}
              <button
                type="button"
                onClick={handleStartBatch}
                disabled={isSubmitting}
                className="w-full py-3.5 px-6 rounded-xl bg-[var(--muxaro-indigo)] text-white font-semibold text-sm shadow-[var(--muxaro-shadow-btn)] hover:shadow-[var(--muxaro-shadow-btn-hover)] hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--muxaro-border-focus)] transition-opacity duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <span>Queuing Batch Jobs…</span>
                ) : (
                  <>
                    <span>Start Batch Processing ({items.length} items)</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-medium flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
              {backendDisconnected && (
                <Link
                  href="/settings?tab=instances"
                  className="px-3 py-1 rounded-lg border border-red-500/40 text-xs font-semibold hover:bg-red-500/10 shrink-0"
                >
                  Configure Backend
                </Link>
              )}
            </div>
          )}
        </div>
      ) : (
        /* Real-Time Processing View */
        <div className="muxaro-card p-6 bg-[var(--muxaro-bg-surface)] border border-[var(--muxaro-border)] rounded-2xl shadow-[var(--muxaro-shadow-card)] space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--muxaro-border-subtle)] pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-[var(--muxaro-tag-pill-bg)] text-[var(--muxaro-indigo)]">
                  <Archive className="w-5 h-5" />
                </span>
                <h3 className="text-base font-bold text-[var(--muxaro-text-primary)]">
                  Batch Execution: {playlistTitle || 'Media Batch'}
                </h3>
              </div>
              <p className="text-xs text-[var(--muxaro-text-secondary)] font-mono mt-1">
                Batch ID: {batchId}
              </p>
            </div>

            <span
              className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                batchStatus === 'READY' || batchStatus === 'COMPLETED'
                  ? 'bg-emerald-500/15 text-emerald-600'
                  : batchStatus === 'FAILED' || batchStatus === 'PARTIAL_FAILURE'
                  ? 'bg-red-500/15 text-red-600'
                  : 'bg-[var(--muxaro-tag-pill-bg)] text-[var(--muxaro-indigo)] animate-pulse'
              }`}
            >
              {batchStatus === 'READY' || batchStatus === 'COMPLETED'
                ? 'All Ready'
                : batchStatus === 'PARTIAL_FAILURE'
                ? `${completedCount} Ready, ${failedCount} Failed`
                : batchStatus === 'FAILED'
                ? 'Failed'
                : `${completedCount} of ${items.length} Complete`}
            </span>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-medium flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
              {backendDisconnected && (
                <Link
                  href="/settings?tab=instances"
                  className="px-3 py-1 rounded-lg border border-red-500/40 text-xs font-semibold hover:bg-red-500/10 shrink-0"
                >
                  Configure Backend
                </Link>
              )}
            </div>
          )}

          {/* Overall Batch Progress */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-[var(--muxaro-text-secondary)]">
              <span>Overall Progress ({batchStatus})</span>
              <span>{overallProgress}%</span>
            </div>
            <div className="w-full h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="w-full h-full bg-[var(--muxaro-indigo)] origin-left transition-transform duration-300"
                style={{ transform: `scaleX(${Math.min(1, Math.max(0, overallProgress / 100))})` }}
              />
            </div>
          </div>

          {/* Per-Item Track Progress List */}
          <div className="divide-y divide-[var(--muxaro-border-subtle)] border border-[var(--muxaro-border)] rounded-xl overflow-hidden max-h-96 overflow-y-auto">
            {items.map((item) => (
              <div key={item.id} className="p-3.5 bg-[var(--muxaro-bg-base)] space-y-2">
                <div className="flex items-center justify-between text-xs gap-2">
                  <div className="flex items-center gap-2 truncate min-w-0">
                    <span className="font-mono font-bold text-[var(--muxaro-indigo)]">
                      #{String(item.itemNumber).padStart(3, '0')}
                    </span>
                    <span className="font-medium text-[var(--muxaro-text-primary)] truncate">
                      {item.title}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {item.status === 'READY' && item.downloadUrl && (
                      <a
                        href={item.downloadUrl}
                        download
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold"
                      >
                        <Download className="w-3 h-3" />
                        <span>Save</span>
                      </a>
                    )}
                    <span
                      className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        item.status === 'READY'
                          ? 'bg-emerald-500/15 text-emerald-600'
                          : item.status === 'FAILED'
                          ? 'bg-red-500/15 text-red-600'
                          : 'bg-indigo-500/10 text-indigo-600'
                      }`}
                    >
                      {item.status} ({item.progress || 0}%)
                    </span>
                  </div>
                </div>

                {item.error && (
                  <p className="text-[11px] text-red-500">{item.error}</p>
                )}

                <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`w-full h-full origin-left transition-transform duration-200 ${
                      item.status === 'FAILED'
                        ? 'bg-red-500'
                        : item.status === 'READY'
                        ? 'bg-emerald-500'
                        : 'bg-[var(--muxaro-indigo)]'
                    }`}
                    style={{ transform: `scaleX(${Math.min(1, Math.max(0, (item.progress || 0) / 100))})` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Single Streaming ZIP Download Card */}
          {zipDownloadUrl && (
            <div className="p-6 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-3">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
                <div>
                  <h4 className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                    Batch Ready for Archive Download!
                  </h4>
                  <p className="text-xs text-emerald-700 dark:text-emerald-400">
                    All tracks have been processed and packaged into a single streaming ZIP archive.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <a
                  href={zipDownloadUrl}
                  download
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors duration-150"
                >
                  <Archive className="w-4 h-4" />
                  <span>Download Complete ZIP Archive</span>
                </a>
                <Link
                  href="/downloads"
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] text-xs font-semibold text-[var(--muxaro-text-secondary)] hover:bg-[var(--muxaro-bg-elevated)]"
                >
                  <span>View in Cloud Downloads</span>
                </Link>
                <button
                  type="button"
                  onClick={handleResetBatch}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] text-xs font-semibold text-[var(--muxaro-text-secondary)] hover:bg-[var(--muxaro-bg-elevated)]"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Start Another Batch</span>
                </button>
              </div>
            </div>
          )}

          {!zipDownloadUrl && TERMINAL_BATCH_STATUSES.has(batchStatus) && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleResetBatch}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] text-xs font-semibold text-[var(--muxaro-text-secondary)] hover:bg-[var(--muxaro-bg-elevated)]"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Start Another Batch</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default BatchTool;
