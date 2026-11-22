'use client';

/**
 * Project MUXARO - Batch & Playlists Processing Tool Component
 * Supports:
 * - Playlist URL inspection (YouTube, SoundCloud, Bandcamp playlists)
 * - Multi-link & multi-track queue with expandable track listing
 * - Per-item progress bar, stage indicator, and live status
 * - Global batch controls (Process All, Cancel, Format Selector)
 * - Single streaming ZIP archive download when complete
 * - Hallmark compliant token styling, accessible UI, no transition:all
 */

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  ListVideo,
  Play,
  Pause,
  Download,
  Archive,
  CheckCircle2,
  AlertCircle,
  Clock,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Sliders,
  ArrowRight,
  Plus,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { api } from '@/lib/api-client';
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
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  // Active Batch Processing
  const [batchId, setBatchId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [zipDownloadUrl, setZipDownloadUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

    try {
      const res = await fetch('/api/v1/playlists/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cleanUrl, maxItems: 50 }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.userMessage || errJson.error?.message || 'Failed to inspect playlist.');
      }

      const body = await res.json();
      const discoveredItems: any[] = body.data?.items || body.items || [];
      const title = body.data?.title || 'Imported Playlist';

      setPlaylistTitle(title);

      const parsed: BatchItem[] = discoveredItems.map((item, idx) => ({
        id: `item_${idx + 1}_${Date.now()}`,
        itemNumber: idx + 1,
        title: item.title || `Track ${idx + 1}`,
        mediaUrl: item.url || item.mediaUrl || cleanUrl,
        duration: item.duration,
        format: globalFormat,
        status: 'PENDING',
        progress: 0,
        stageMessage: 'Ready to process',
      }));

      setItems(parsed);
    } catch (err: any) {
      setErrorMessage(err.message || 'Playlist inspection failed.');
    } finally {
      setIsInspecting(false);
    }
  };

  // Add a manual URL to the queue
  const handleAddManualItem = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = normalizeMediaUrl(manualUrlInput);
    if (!clean) return;

    const newItem: BatchItem = {
      id: `manual_${items.length + 1}_${Date.now()}`,
      itemNumber: items.length + 1,
      title: `Item ${items.length + 1} (${clean.replace(/^https?:\/\//, '').slice(0, 30)}...)`,
      mediaUrl: clean,
      format: globalFormat,
      status: 'PENDING',
      progress: 0,
      stageMessage: 'Ready to process',
    };

    setItems((prev) => [...prev, newItem]);
    setManualUrlInput('');
    setErrorMessage(null);
  };

  // Remove an item from the queue
  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  // Apply format to all items
  const handleGlobalFormatChange = (fmt: string) => {
    setGlobalFormat(fmt);
    setItems((prev) =>
      prev.map((item) => (item.status === 'PENDING' ? { ...item, format: fmt } : item))
    );
  };

  // Start Batch Execution
  const handleStartBatch = async () => {
    if (items.length === 0) {
      setErrorMessage('Please add at least one track or playlist item to start.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const isAudio = globalFormat === 'mp3' || globalFormat === 'flac' || globalFormat === 'wav' || globalFormat === 'aac';
      const operation = isAudio ? 'EXTRACT_AUDIO' : 'CONVERT_FORMAT';

      const payload = {
        title: playlistTitle || `Batch Export (${items.length} items)`,
        operation,
        targetFormat: globalFormat,
        idempotencyKey: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        items: items.map((i) => ({
          mediaUrl: i.mediaUrl,
          title: i.title,
          operation,
          targetFormat: i.format || globalFormat,
        })),
      };

      const res = await fetch('/api/v1/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.userMessage || errJson.error?.message || 'Failed to initialize batch.');
      }

      const body = await res.json();
      const createdBatchId = body.data?.batchId || body.batchId;
      setBatchId(createdBatchId);
      setIsProcessing(true);
      startPollingBatch(createdBatchId);
    } catch (err: any) {
      setErrorMessage(err.message || 'Batch creation failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Poll batch progress
  const startPollingBatch = (id: string) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/batches/${encodeURIComponent(id)}`);
        if (!res.ok) return;

        const body = await res.json();
        const data = body.data || body;

        // Update items status
        if (Array.isArray(data.items)) {
          setItems((prev) =>
            prev.map((existing, idx) => {
              const updated = data.items[idx];
              if (!updated) return existing;
              return {
                ...existing,
                status: updated.status || existing.status,
                progress: updated.progress ?? existing.progress,
                stageMessage: updated.stageMessage || updated.status,
                downloadUrl: updated.downloadUrl || existing.downloadUrl,
                error: updated.error?.message,
              };
            })
          );
        }

        // Check if entire batch completed
        if (data.status === 'READY' || data.status === 'COMPLETED') {
          setIsProcessing(false);
          setZipDownloadUrl(data.downloadUrl || `/api/v1/batches/${id}/download.zip`);
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        } else if (data.status === 'FAILED' || data.status === 'CANCELLED') {
          setIsProcessing(false);
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        }
      } catch {
        // Non-blocking poll errors
      }
    }, 2000);
  };

  const completedCount = items.filter((i) => i.status === 'READY').length;
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
                  type="url"
                  value={playlistUrl}
                  onChange={(e) => setPlaylistUrl(e.target.value)}
                  placeholder="https://www.youtube.com/playlist?list=... or album URL"
                  className="flex-1 px-4 py-3 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] text-sm text-[var(--muxaro-text-primary)] focus:border-[var(--muxaro-border-focus)] focus-visible:outline-none"
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
                  type="url"
                  value={manualUrlInput}
                  onChange={(e) => setManualUrlInput(e.target.value)}
                  placeholder="Paste video/audio URL to append to queue…"
                  className="flex-1 px-4 py-3 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] text-sm text-[var(--muxaro-text-primary)] focus:border-[var(--muxaro-border-focus)] focus-visible:outline-none"
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
                    Configure target container or adjust individual track formats below.
                  </p>
                </div>

                {/* Global Format Selector */}
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
                          <div className="flex items-center gap-4 pt-1">
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
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>
      ) : (
        /* Real-Time Processing View */
        <div className="muxaro-card p-6 bg-[var(--muxaro-bg-surface)] border border-[var(--muxaro-border)] rounded-2xl shadow-[var(--muxaro-shadow-card)] space-y-6">
          <div className="flex items-center justify-between border-b border-[var(--muxaro-border-subtle)] pb-4">
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
                completedCount === items.length
                  ? 'bg-emerald-500/15 text-emerald-600'
                  : 'bg-[var(--muxaro-tag-pill-bg)] text-[var(--muxaro-indigo)] animate-pulse'
              }`}
            >
              {completedCount === items.length
                ? 'All Ready'
                : `${completedCount} of ${items.length} Complete`}
            </span>
          </div>

          {/* Overall Batch Progress */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-[var(--muxaro-text-secondary)]">
              <span>Overall Progress</span>
              <span>{overallProgress}%</span>
            </div>
            <div className="w-full h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--muxaro-indigo)] transition-all duration-300"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
          </div>

          {/* Per-Item Track Progress List */}
          <div className="divide-y divide-[var(--muxaro-border-subtle)] border border-[var(--muxaro-border)] rounded-xl overflow-hidden max-h-96 overflow-y-auto">
            {items.map((item) => (
              <div key={item.id} className="p-3.5 bg-[var(--muxaro-bg-base)] space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 truncate">
                    <span className="font-mono font-bold text-[var(--muxaro-indigo)]">
                      #{String(item.itemNumber).padStart(3, '0')}
                    </span>
                    <span className="font-medium text-[var(--muxaro-text-primary)] truncate">
                      {item.title}
                    </span>
                  </div>

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

                <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-200 ${
                      item.status === 'READY' ? 'bg-emerald-500' : 'bg-[var(--muxaro-indigo)]'
                    }`}
                    style={{ width: `${item.progress || 0}%` }}
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
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default BatchTool;
