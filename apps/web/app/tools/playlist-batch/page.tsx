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
import { api } from '@/lib/api-client';
import { ProcessingJob } from '@/lib/types';
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

interface BatchEntry {
  id: string;
  url: string;
  format: string;
  operation: 'extract_audio' | 'transcode_video';
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

  // Batch state (starts clean and empty)
  const [items, setItems] = useState<BatchEntry[]>([]);
  const [newUrl, setNewUrl] = useState<string>('');
  const [batchOp, setBatchOp] = useState<'extract_audio' | 'transcode_video'>(
    'transcode_video'
  );
  const [batchFormat, setBatchFormat] = useState<string>('mp4');
  const [isBatchSubmitting, setIsBatchSubmitting] = useState<boolean>(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [activeJobs, setActiveJobs] = useState<ProcessingJob[]>([]);

  // Playlist state (starts clean and empty)
  const [playlistUrl, setPlaylistUrl] = useState<string>('');
  const [playlistFormat, setPlaylistFormat] = useState<string>('mp4');
  const [packageZip, setPackageZip] = useState<boolean>(true);
  const [isInspecting, setIsInspecting] = useState<boolean>(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspected, setInspected] = useState<InspectedPlaylist | null>(null);
  const [isPlaylistSubmitting, setIsPlaylistSubmitting] = useState<boolean>(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [playlistJob, setPlaylistJob] = useState<PlaylistJobStatus | null>(null);

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
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        url: normalized,
        format: batchFormat,
        operation: batchOp,
      },
    ]);
    setNewUrl('');
    setBatchError(null);
  };

  const handleRunBatch = async () => {
    if (items.length === 0) return;
    setIsBatchSubmitting(true);
    setBatchError(null);
    try {
      const jobs: ProcessingJob[] = [];
      for (const item of items) {
        const name = item.url.split('/').pop() || 'Media file';
        const job = await api.createJob({
          sourceUrl: item.url,
          jobType: item.operation,
          operation:
            item.operation === 'extract_audio'
              ? 'EXTRACT_AUDIO'
              : 'CONVERT_FORMAT',
          targetFormat: item.format,
          streamCopy: item.format === 'native',
          title: name,
        });
        jobs.push(job);
      }
      setActiveJobs(jobs);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Could not start batch processing. Check your links and try again.';
      setBatchError(message);
    } finally {
      setIsBatchSubmitting(false);
    }
  };

  const inspectPlaylist = useCallback(async () => {
    const trimmed = normalizeMediaUrl(playlistUrl);
    if (!trimmed) {
      setInspectError('Please paste a valid authorised playlist link (e.g. youtube.com/playlist?list=...).');
      return;
    }

    setIsInspecting(true);
    setInspectError(null);
    setPlaylistError(null);
    try {
      const res = await fetch('/api/v1/playlists/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ url: trimmed, maxItems: 50 }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(
          json?.error?.message || `Could not inspect playlist (HTTP ${res.status}).`
        );
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
    try {
      const idempotencyKey = `plb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const res = await fetch('/api/v1/playlists/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          playlistUrl: trimmed,
          targetFormat: playlistFormat,
          packageAsZip: packageZip,
          idempotencyKey,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(
          json?.error?.message || `Could not start playlist job (HTTP ${res.status}).`
        );
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
  }, [playlistUrl, playlistFormat, packageZip, inspected]);

  useEffect(() => {
    if (!playlistJob?.playlistJobId) return;
    const st = playlistJob.status.toUpperCase();
    if (st === 'COMPLETED' || st === 'READY' || st === 'FAILED' || st === 'CANCELLED') {
      return;
    }

    const poll = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      try {
        const res = await fetch(
          `/api/v1/playlists/jobs/${encodeURIComponent(playlistJob.playlistJobId)}`,
          { headers: { Accept: 'application/json' } }
        );
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success || !json.data) return;
        const d = json.data;
        const total = Number(d.totalItems) || playlistJob.totalItems;
        const completed = Number(d.completedItems) || 0;
        const pct =
          typeof d.progress === 'number'
            ? d.progress
            : total > 0
            ? Math.round((completed / total) * 100)
            : 0;
        setPlaylistJob((prev) =>
          prev
            ? {
                ...prev,
                status: String(d.status || prev.status).toUpperCase(),
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
                      placeholder="Paste video or audio link (e.g. youtube.com/watch?v=... or direct MP4)"
                      className="flex-1 px-4 py-2.5 rounded-xl bg-surface border border-line text-content placeholder:text-content-muted text-sm transition-colors"
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

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                          setBatchOp(
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
                        <option value="mp4">MP4 (Standard video)</option>
                        <option value="mkv">MKV (High compatibility)</option>
                        <option value="mp3">MP3 (320 kbps audio)</option>
                        <option value="flac">FLAC (Lossless audio)</option>
                      </select>
                    </div>
                  </div>
                </form>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-content-secondary">
                    <span className="font-semibold text-content">
                      Items in queue ({items.length})
                    </span>
                    <span>Uses {items.length} of 10 daily video jobs</span>
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
                            {item.format}
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

                {activeJobs.length > 0 && (
                  <div className="mt-6 pt-6 border-t border-line space-y-4">
                    <h2 className="text-base font-bold text-content">
                      Active batch jobs
                    </h2>
                    {activeJobs.map((job) => (
                      <JobProgress key={job.id} initialJob={job} />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-6">
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
                      placeholder="Paste playlist link (e.g. youtube.com/playlist?list=...)"
                      className="flex-1 px-4 py-3 rounded-xl bg-surface border border-line text-content placeholder:text-content-muted text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet transition-colors"
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
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                      <option value="flac">FLAC (Lossless audio)</option>
                      <option value="mp3">MP3 (320 kbps audio)</option>
                      <option value="mkv">MKV (High compatibility)</option>
                    </select>
                  </div>

                  <div className="flex items-end pb-1.5">
                    <label
                      htmlFor="pb-playlist-zip"
                      className="flex items-center gap-2.5 text-sm text-content cursor-pointer"
                    >
                      <input
                        id="pb-playlist-zip"
                        type="checkbox"
                        checked={packageZip}
                        onChange={(e) => setPackageZip(e.target.checked)}
                        className="w-4 h-4 rounded-sm border border-line accent-brand"
                      />
                      <span>Download all as one ZIP archive</span>
                    </label>
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
                )}

                <button
                  type="button"
                  onClick={submitPlaylist}
                  disabled={isPlaylistSubmitting || !playlistUrl.trim()}
                  className="muxaro-btn-primary px-6 py-3 text-sm whitespace-nowrap active:opacity-90 disabled:opacity-50"
                >
                  {isPlaylistSubmitting ? 'Starting playlist…' : 'Process playlist'}
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
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-surface-elevated border border-line text-content">
                        {isPlaylistComplete ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-success" aria-hidden="true" />
                        ) : (
                          <Loader2 className="w-3.5 h-3.5 text-brand motion-safe:animate-spin" aria-hidden="true" />
                        )}
                        <span>{isPlaylistComplete ? 'Ready' : 'Processing'}</span>
                      </span>
                    </div>

                    <div className="w-full h-2.5 rounded-full bg-surface-elevated border border-line overflow-hidden">
                      <div
                        className="h-full w-full bg-brand origin-left transition-transform duration-300"
                        style={{ transform: `scaleX(${playlistJob.progress / 100})` }}
                      />
                    </div>

                    {isPlaylistComplete && playlistJob.zipDownloadUrl && (
                      <div className="p-4 rounded-md bg-surface-muted border border-line flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <p className="text-sm font-semibold text-content">
                          Your verified playlist ZIP archive is ready.
                        </p>
                        <a
                          href={playlistJob.zipDownloadUrl}
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
                            {item.status === 'READY' && item.downloadUrl ? (
                              <a
                                href={item.downloadUrl}
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
              <div className="text-sm font-bold text-content">
                Daily allowance overview
              </div>
              <ul className="space-y-3 text-xs text-content-secondary leading-relaxed">
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>10 individual video or audio jobs every rolling 24 hours.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>1 separate playlist job (up to 50 items) every rolling 24 hours.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Playlist jobs never subtract from your 10 individual media jobs.</span>
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
