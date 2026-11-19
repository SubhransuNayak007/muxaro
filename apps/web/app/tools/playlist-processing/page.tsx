'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ListVideo,
  Package,
  CheckCircle2,
  ShieldCheck,
  AlertCircle,
  RotateCcw,
  Download,
  Clock,
  Loader2,
  Search,
} from 'lucide-react';

import { normalizeMediaUrl } from '@/lib/url-utils';
import ActiveLinkIndicator from '@/components/ActiveLinkIndicator';

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

function formatTrackDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

export default function PlaylistProcessingPage() {
  const [playlistUrl, setPlaylistUrl] = useState<string>('');
  const [targetFormat, setTargetFormat] = useState<string>('mp4');
  const [packageAsZip, setPackageAsZip] = useState<boolean>(true);

  const [isInspecting, setIsInspecting] = useState<boolean>(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspected, setInspected] = useState<InspectedPlaylist | null>(null);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [playlistJob, setPlaylistJob] = useState<PlaylistJobStatus | null>(null);

  const inspectPlaylist = useCallback(async () => {
    const trimmed = normalizeMediaUrl(playlistUrl);
    if (!trimmed) {
      setInspectError('Please paste a valid authorised playlist link (e.g. youtube.com/playlist?list=...).');
      return;
    }

    setIsInspecting(true);
    setInspectError(null);
    setSubmitError(null);
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

  const submitPlaylistJob = useCallback(async () => {
    const trimmed = playlistUrl.trim();
    if (!trimmed) {
      setSubmitError('Please paste an authorised playlist link first.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const idempotencyKey = `pl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const res = await fetch('/api/v1/playlists/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          playlistUrl: trimmed,
          targetFormat,
          packageAsZip,
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
          : 'Could not submit playlist job. Please try again.';
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [playlistUrl, targetFormat, packageAsZip, inspected]);

  // Poll real playlist job status while active (pauses when tab is hidden)
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
        // Keep current status on transient poll issue
      }
    };

    const timer = setInterval(poll, 1500);
    poll();
    return () => clearInterval(timer);
  }, [playlistJob?.playlistJobId, playlistJob?.status, playlistJob?.totalItems]);

  const derivedItemStates: PlaylistJobItemStatus[] = (() => {
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

  const isJobComplete =
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
              <ListVideo className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Playlist processor</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-content tracking-tight">
              Process an authorised playlist into one archive
            </h1>
            <p className="text-base text-content-secondary mt-3 leading-relaxed">
              Process up to 50 authorised playlist items into one verified ZIP download.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 muxaro-media-card p-6 sm:p-8 space-y-6">
            {/* Step 1: Inspect Playlist URL */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                inspectPlaylist();
              }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between">
                <label
                  htmlFor="playlist-url"
                  className="block text-sm font-semibold text-content"
                >
                  Authorised playlist link
                </label>
                {normalizeMediaUrl(playlistUrl) && (
                  <span className="text-xs text-brand font-medium flex items-center gap-1">
                    Valid playlist link
                  </span>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  id="playlist-url"
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
                  className="flex-1 px-4 py-3 rounded-xl bg-surface border border-line text-content placeholder:text-content-muted text-sm transition-colors"
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
              <div
                role="alert"
                className="p-4 rounded-xl bg-error-bg border border-error text-sm text-error flex flex-wrap items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{inspectError}</span>
                </div>
                <button
                  type="button"
                  onClick={inspectPlaylist}
                  disabled={isInspecting || !playlistUrl.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-error bg-surface text-error text-xs font-semibold hover:bg-surface-elevated transition-colors active:opacity-90 disabled:opacity-50 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Retry</span>
                </button>
              </div>
            )}

            {/* Format & ZIP Delivery Options */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-line-subtle">
              <div>
                <label
                  htmlFor="playlist-format"
                  className="block text-sm font-medium text-content mb-2"
                >
                  Output format
                </label>
                <select
                  id="playlist-format"
                  value={targetFormat}
                  onChange={(e) => setTargetFormat(e.target.value)}
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
                  htmlFor="playlist-zip"
                  className="flex items-center gap-2.5 text-sm text-content cursor-pointer"
                >
                  <input
                    id="playlist-zip"
                    type="checkbox"
                    checked={packageAsZip}
                    onChange={(e) => setPackageAsZip(e.target.checked)}
                    className="w-4 h-4 rounded-sm border border-line accent-brand"
                  />
                  <span>Bundle completed files into one ZIP archive (recommended)</span>
                </label>
              </div>
            </div>

            {/* Honest Empty State or Inspected Tracks List */}
            {!inspected && !playlistJob && (
              <div className="p-8 rounded-md border border-dashed border-line text-center">
                <p className="text-sm font-medium text-content mb-1">
                  No playlist loaded yet
                </p>
                <p className="text-xs text-content-secondary">
                  Paste an authorised playlist link above and click Inspect playlist to view its tracks before processing.
                </p>
              </div>
            )}

            {inspected && !playlistJob && (
              <div className="p-4 rounded-md bg-surface-elevated border border-line-subtle space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-line text-xs text-content-secondary">
                  <span className="font-semibold text-content">
                    {inspected.title}
                  </span>
                  <span className="tabular-nums">
                    {inspected.totalItems} of 50 items max
                  </span>
                </div>
                {inspected.items.length === 0 ? (
                  <p className="text-xs text-content-secondary py-2">
                    No playable items were found in this playlist.
                  </p>
                ) : (
                  <div className="divide-y divide-line-subtle text-sm max-h-72 overflow-y-auto">
                    {inspected.items.map((item) => (
                      <div
                        key={item.position}
                        className="py-2.5 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-xs text-content-muted tabular-nums w-5 shrink-0">
                            {item.position}
                          </span>
                          <span className="text-content truncate">{item.title}</span>
                        </div>
                        {item.durationSeconds ? (
                          <span className="tabular-nums text-xs text-content-secondary shrink-0">
                            {formatTrackDuration(item.durationSeconds)}
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {submitError && (
              <div className="p-4 rounded-md bg-error-bg border border-error text-sm text-error flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{submitError}</span>
                </div>
                <button
                  type="button"
                  onClick={submitPlaylistJob}
                  disabled={isSubmitting || !playlistUrl.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-error bg-surface text-error text-xs font-semibold hover:bg-surface-elevated transition-colors active:opacity-90 disabled:opacity-50 whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Retry</span>
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-4 pt-1">
              <button
                type="button"
                onClick={submitPlaylistJob}
                disabled={isSubmitting || !playlistUrl.trim()}
                className="muxaro-btn-primary px-6 py-3 text-sm whitespace-nowrap active:opacity-90 disabled:opacity-50"
              >
                {isSubmitting ? 'Starting playlist…' : 'Process playlist'}
              </button>
              <span className="text-xs text-content-secondary">
                Uses your dedicated daily playlist allowance
              </span>
            </div>

            {/* Smart Playlist Delivery Panel (Individual Item States + Single ZIP CTA) */}
            {playlistJob && (
              <div className="mt-6 pt-6 border-t border-line space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-content">
                      {playlistJob.title}
                    </h2>
                    <p className="text-xs text-content-secondary mt-0.5 tabular-nums">
                      {playlistJob.completedItems} of {playlistJob.totalItems} items complete
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-surface-elevated border border-line text-content">
                    {isJobComplete ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-success" aria-hidden="true" />
                    ) : (
                      <Loader2 className="w-3.5 h-3.5 text-brand motion-safe:animate-spin" aria-hidden="true" />
                    )}
                    <span>{isJobComplete ? 'Ready to download' : 'Processing'}</span>
                  </span>
                </div>

                {/* GPU-composited progress bar */}
                <div className="w-full h-2.5 rounded-full bg-surface-elevated border border-line overflow-hidden">
                  <div
                    className="h-full w-full bg-brand origin-left transition-transform duration-300"
                    style={{ transform: `scaleX(${playlistJob.progress / 100})` }}
                  />
                </div>

                {/* Prominent Single Verified ZIP Delivery CTA */}
                {isJobComplete && playlistJob.zipDownloadUrl && (
                  <div className="p-4 rounded-md bg-surface-muted border border-line flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-content">
                        All {playlistJob.completedItems} files are packaged and ready
                      </p>
                      <p className="text-xs text-content-secondary mt-0.5">
                        Download everything cleanly in one verified ZIP file instead of multiple pop-up downloads.
                      </p>
                    </div>
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

                {/* Individual Item Completion States + Manual Per-Item Download */}
                {derivedItemStates.length > 0 && (
                  <div className="p-4 rounded-md bg-surface-elevated border border-line-subtle">
                    <div className="text-xs font-semibold text-content pb-2.5 mb-2 border-b border-line">
                      Individual item status
                    </div>
                    <div className="divide-y divide-line-subtle text-sm max-h-72 overflow-y-auto">
                      {derivedItemStates.map((item) => (
                        <div
                          key={item.position}
                          className="py-2.5 flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {item.status === 'READY' ? (
                              <CheckCircle2
                                className="w-4 h-4 text-success shrink-0"
                                aria-hidden="true"
                              />
                            ) : item.status === 'PROCESSING' ? (
                              <Loader2
                                className="w-4 h-4 text-brand motion-safe:animate-spin shrink-0"
                                aria-hidden="true"
                              />
                            ) : item.status === 'FAILED' ? (
                              <AlertCircle
                                className="w-4 h-4 text-error shrink-0"
                                aria-hidden="true"
                              />
                            ) : (
                              <Clock
                                className="w-4 h-4 text-content-muted shrink-0"
                                aria-hidden="true"
                              />
                            )}
                            <span className="text-content truncate">{item.title}</span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
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
                              <span className="text-xs text-content-secondary">
                                {item.status === 'READY'
                                  ? 'Included in ZIP'
                                  : item.status === 'PROCESSING'
                                  ? 'Processing…'
                                  : item.status === 'FAILED'
                                  ? 'Failed'
                                  : 'Queued'}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="muxaro-media-card p-6 space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-content">
                <Package className="w-4 h-4 text-brand" aria-hidden="true" />
                <span>Separate playlist quota</span>
              </div>
              <ul className="space-y-3 text-xs text-content-secondary leading-relaxed">
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Includes 1 full playlist job every rolling 24 hours.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Does not deduct from your 10 individual daily video jobs.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Supports up to 50 authorised items packaged into a single ZIP file.</span>
                </li>
              </ul>
            </div>

            <div className="muxaro-media-card p-6 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-content">
                <ShieldCheck className="w-4 h-4 text-brand" aria-hidden="true" />
                <span>Authorised sources only</span>
              </div>
              <p className="text-xs text-content-secondary leading-relaxed">
                Playlist processing supports user-owned collections and explicitly permitted media sources.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
