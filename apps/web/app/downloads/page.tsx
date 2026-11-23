'use client';

/**
 * Project MUXARO - My Downloads (60-Minute Ephemeral Cloud Storage & Session History)
 * Features:
 * - 60-minute ephemeral session history synced with local storage & API
 * - Live per-second countdown timers with color-coded urgency and tabular-nums
 * - Copy Resumable Link with instant clipboard feedback
 * - Direct download streaming trigger
 * - Instant "Delete Now" cloud purge
 * - Filter by All, Video, Audio, Archives + instant search
 * - Hallmark compliant tokenized layout, no transition:all
 *
 * Bug fixes (Wave 2):
 * - BUG 1: Expired rows now show disabled buttons + 'Expired' badge + 'Re-analyze' action
 * - BUG 2: Real MIME type (from Content-Type) and actual byte size stored and displayed
 * - BUG 3: HEAD-request sync verifies R2 presigned URL liveness on page load
 * - BUG 4: Single-file downloads are NEVER wrapped in .zip
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Download,
  Clock,
  Trash2,
  Copy,
  Check,
  Film,
  Music,
  Archive,
  RefreshCw,
  Search,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  ArrowRight,
  RotateCcw,
} from 'lucide-react';
import { api } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export interface DownloadItem {
  id: string;
  jobId: string;
  title: string;
  /** Real file extension derived from Content-Type (e.g. 'mp4', 'm4a', 'webm'). */
  format: string;
  /** Real byte size from the media backend or R2 metadata. 0 when unknown. */
  fileSize: number;
  createdAt: string;
  /** ISO date string — 60 minutes from job creation for R2 presigned URLs. */
  expiresAt: string;
  downloadUrl: string;
  type: 'video' | 'audio' | 'archive';
  /** Original source URL — used by Re-analyze to prefill homepage. */
  sourceUrl?: string;
  /** True when a HEAD check confirmed the presigned URL is no longer alive. */
  urlExpired?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'muxaro_downloads_history_v1';

// MIME type → file extension map (Content-Type prefix to extension)
const MIME_EXT_MAP: Record<string, string> = {
  'video/mp4':  'mp4',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'video/quicktime': 'mov',
  'video/x-msvideo': 'avi',
  'video/3gpp': '3gp',
  'audio/mpeg': 'mp3',
  'audio/mp4':  'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac':  'aac',
  'audio/ogg':  'ogg',
  'audio/opus': 'opus',
  'audio/flac': 'flac',
  'audio/wav':  'wav',
  'audio/x-wav': 'wav',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
};

/** Derive a clean file extension from a MIME type string. */
function mimeToExt(mime: string | null | undefined, fallback = 'mp4'): string {
  if (!mime) return fallback;
  const base = mime.split(';')[0].trim().toLowerCase();
  if (MIME_EXT_MAP[base]) return MIME_EXT_MAP[base];
  // Last resort: take the subtype part (e.g. video/mp4 → mp4)
  const sub = base.split('/')[1];
  return sub && sub.length <= 5 ? sub : fallback;
}

/** Derive 'video' | 'audio' | 'archive' from MIME or format string. */
function deriveType(
  mime: string | null | undefined,
  format: string,
  operation: string
): 'video' | 'audio' | 'archive' {
  const mimeBase = (mime || '').split(';')[0].trim().toLowerCase();
  if (mimeBase.startsWith('audio/')) return 'audio';
  if (mimeBase === 'application/zip' || mimeBase === 'application/x-zip-compressed') return 'archive';

  const fmt = format.toLowerCase();
  if (['mp3', 'wav', 'flac', 'aac', 'm4a', 'opus', 'ogg'].includes(fmt)) return 'audio';

  const op = operation.toUpperCase();
  if (op === 'EXTRACT_AUDIO') return 'audio';
  if (op === 'BATCH') return 'archive';

  // Single-file downloads are NEVER 'archive' (BUG 4)
  return 'video';
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function DownloadsPage() {
  const router = useRouter();
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [filterType, setFilterType] = useState<'all' | 'video' | 'audio' | 'archive'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(Date.now());
  /** Tracks which job IDs have had their URL HEAD-checked. */
  const headCheckedRef = useRef<Set<string>>(new Set());

  // Per-second clock tick for live countdown timers
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // -------------------------------------------------------------------------
  // Sync: on page load, HEAD-check every non-expired R2 presigned URL
  // -------------------------------------------------------------------------

  const syncUrlLiveness = useCallback(async (list: DownloadItem[]) => {
    const toCheck = list.filter((item) => {
      if (headCheckedRef.current.has(item.jobId)) return false;
      const expiry = new Date(item.expiresAt).getTime();
      if (Date.now() >= expiry) return false; // already locally expired
      return item.downloadUrl?.startsWith('http');
    });

    if (toCheck.length === 0) return;

    const results = await Promise.allSettled(
      toCheck.map(async (item) => {
        headCheckedRef.current.add(item.jobId);
        try {
          const res = await fetch(item.downloadUrl, { method: 'HEAD', cache: 'no-store' });
          return { jobId: item.jobId, alive: res.ok };
        } catch {
          // Network error — assume still alive rather than false-positive expire
          return { jobId: item.jobId, alive: true };
        }
      })
    );

    const deadIds = new Set<string>();
    for (const result of results) {
      if (result.status === 'fulfilled' && !result.value.alive) {
        deadIds.add(result.value.jobId);
      }
    }

    if (deadIds.size === 0) return;

    setItems((prev) => {
      const updated = prev.map((item) =>
        deadIds.has(item.jobId) ? { ...item, urlExpired: true } : item
      );
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  // -------------------------------------------------------------------------
  // Load history
  // -------------------------------------------------------------------------

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    let localList: DownloadItem[] = [];

    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          localList = JSON.parse(raw);
        }
      } catch {}
    }

    // Locally mark entries that have passed their expiresAt timestamp (BUG 3)
    const now = Date.now();
    localList = localList.map((item) => {
      const expiry = new Date(item.expiresAt).getTime();
      if (now >= expiry && !item.urlExpired) {
        return { ...item, urlExpired: true };
      }
      return item;
    });

    // Attempt to merge server history
    try {
      const serverJobs = await api.listJobs().catch(() => []);
      if (Array.isArray(serverJobs)) {
        const mappedServer: DownloadItem[] = serverJobs
          .filter((j: any) => j.status === 'READY' && j.downloadUrl)
          .map((j: any) => {
            const operation = String(j.operation || '').toUpperCase();
            const isBatch = operation === 'BATCH' || j.jobType === 'batch' || j.jobType === 'playlist';

            // BUG 4: Single-file downloads are NEVER 'archive' / .zip
            // Only 2+ file batch operations produce a zip
            const isTrueArchive = isBatch && Boolean(j.batchId);

            // BUG 2: Use real MIME from artifact or Content-Type, not guesses
            const realMime: string | undefined =
              j.artifact?.mimeType ||
              j.directMimeType ||
              j.mimeType ||
              undefined;

            const isAudio =
              operation === 'EXTRACT_AUDIO' ||
              j.jobType === 'extract_audio' ||
              (realMime && realMime.startsWith('audio/')) ||
              ['mp3', 'wav', 'flac', 'aac', 'm4a', 'opus'].includes(
                String(j.targetFormat || '').toLowerCase()
              );

            const derivedType = isTrueArchive
              ? 'archive'
              : deriveType(realMime, String(j.targetFormat || 'mp4'), operation);

            // Real file extension from MIME (BUG 2)
            const realFormat = isTrueArchive
              ? 'zip'
              : realMime
              ? mimeToExt(realMime, String(j.targetFormat || isAudio ? 'mp3' : 'mp4').toLowerCase())
              : String(j.targetFormat || (isAudio ? 'mp3' : 'mp4')).toLowerCase();

            // Real byte size (BUG 2) — prefer artifact.size/sizeBytes, then outputSizeBytes
            const realSize: number =
              j.artifact?.size ??
              j.artifact?.sizeBytes ??
              j.outputSizeBytes ??
              0;

            const created = new Date(j.createdAt || Date.now());
            const expires = j.expiresAt
              ? new Date(j.expiresAt).toISOString()
              : new Date(created.getTime() + 60 * 60 * 1000).toISOString();

            const jId = (j.id || j.jobId || `job_${Math.random().toString(36).slice(2, 8)}`) as string;

            const expiredByTime = now >= new Date(expires).getTime();

            return {
              id: jId,
              jobId: jId,
              title: j.inputTitle || j.outputFilename || j.artifact?.filename || `Media Export (${jId.slice(0, 8)})`,
              format: realFormat,
              fileSize: realSize,
              createdAt: created.toISOString(),
              expiresAt: expires,
              downloadUrl: j.downloadUrl,
              type: derivedType,
              sourceUrl: j.sourceUrl || undefined,
              urlExpired: expiredByTime,
            } satisfies DownloadItem;
          });

        // Merge without duplicates (server data wins for existing IDs)
        const map = new Map<string, DownloadItem>();
        for (const it of localList) {
          map.set(it.jobId, it);
        }
        for (const it of mappedServer) {
          map.set(it.jobId, it);
        }
        localList = Array.from(map.values()).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      }
    } catch {}

    setItems(localList);
    setIsLoading(false);

    // Fire-and-forget HEAD checks after state is set
    void syncUrlLiveness(localList);
  }, [syncUrlLiveness]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Persist local changes
  const saveItems = (updated: DownloadItem[]) => {
    setItems(updated);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
    }
  };

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  // Instant Delete Now
  const handleDeleteNow = async (jobId: string) => {
    const updated = items.filter((i) => i.jobId !== jobId);
    saveItems(updated);

    try {
      await fetch(`/api/v1/jobs/${encodeURIComponent(jobId)}`, {
        method: 'DELETE',
      }).catch(() => {});
    } catch {}
  };

  // Copy Resumable Link (disabled when expired — guard in JSX too)
  const handleCopyLink = async (item: DownloadItem) => {
    if (isItemExpired(item)) return;
    const fullUrl = item.downloadUrl.startsWith('http')
      ? item.downloadUrl
      : `${window.location.origin}${item.downloadUrl}`;

    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  };

  // Re-analyze: navigate home with source URL prefilled (BUG 1)
  const handleReanalyze = (item: DownloadItem) => {
    if (item.sourceUrl) {
      router.push(`/?url=${encodeURIComponent(item.sourceUrl)}`);
    } else {
      router.push('/');
    }
  };

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** An entry is considered expired if its timestamp has passed OR the HEAD check failed. */
  function isItemExpired(item: DownloadItem): boolean {
    if (item.urlExpired) return true;
    return new Date(item.expiresAt).getTime() <= currentTime;
  }

  // Formatter for 60-Minute Countdown
  const getRemainingTime = (item: DownloadItem) => {
    if (isItemExpired(item)) {
      return { text: 'Expired', expired: true, urgency: 'expired' as const };
    }

    const expiry = new Date(item.expiresAt).getTime();
    const diffMs = expiry - currentTime;
    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const text = `${totalMinutes}m ${pad(seconds)}s remaining`;

    let urgency: 'normal' | 'warning' | 'danger' = 'normal';
    if (totalMinutes < 10) urgency = 'danger';
    else if (totalMinutes < 25) urgency = 'warning';

    return { text, expired: false, urgency };
  };

  /** Human-readable file size (e.g. '24.3 MB'). Returns '—' when size is 0 or unknown. */
  function formatFileSize(bytes: number): string {
    if (!bytes || bytes <= 0) return '—';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (filterType !== 'all' && item.type !== filterType) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return (
          item.title.toLowerCase().includes(query) ||
          item.format.toLowerCase().includes(query) ||
          item.jobId.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [items, filterType, searchQuery]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="w-full max-w-5xl mx-auto py-8 px-4 sm:px-6 space-y-8">
      {/* Header & 60m Retention Notice */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[var(--muxaro-border)] pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="p-1.5 rounded-lg bg-[var(--muxaro-tag-pill-bg)] text-[var(--muxaro-indigo)]">
              <Clock className="w-5 h-5" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--muxaro-text-primary)]">
              Downloads &amp; Session History
            </h1>
          </div>
          <p className="text-sm text-[var(--muxaro-text-secondary)]">
            Encrypted 60-minute ephemeral retention. Temporary files automatically purge when timer expires.
          </p>
        </div>

        <button
          type="button"
          onClick={loadHistory}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] text-xs font-semibold text-[var(--muxaro-text-secondary)] hover:bg-[var(--muxaro-bg-elevated)] transition-colors duration-150 self-start md:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Sync Session</span>
        </button>
      </div>

      {/* Retention Guarantee Card */}
      <div className="p-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-[var(--muxaro-indigo)] shrink-0" />
          <div className="text-xs text-indigo-900 dark:text-indigo-200">
            <span className="font-bold">Zero-Knowledge Ephemeral Storage:</span> All files are encrypted at rest and permanently purged from media nodes exactly 60 minutes after conversion.
          </div>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-xs font-bold text-[var(--muxaro-indigo)] hover:underline shrink-0"
        >
          <span>New Conversion</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Type Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-[var(--muxaro-bg-base)] border border-[var(--muxaro-border)] rounded-xl">
          {(
            [
              { id: 'all', label: 'All Files' },
              { id: 'video', label: 'Videos' },
              { id: 'audio', label: 'Audio' },
              { id: 'archive', label: 'ZIP Archives' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilterType(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors duration-150 ${
                filterType === t.id
                  ? 'bg-[var(--muxaro-bg-surface)] text-[var(--muxaro-indigo)] shadow-sm'
                  : 'text-[var(--muxaro-text-secondary)] hover:text-[var(--muxaro-text-primary)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative min-w-[240px]">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-[var(--muxaro-text-tertiary)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search filenames or IDs…"
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] text-xs text-[var(--muxaro-text-primary)] focus:border-[var(--muxaro-border-focus)] focus-visible:outline-none"
          />
        </div>
      </div>

      {/* Downloads List */}
      {filteredItems.length === 0 ? (
        <div className="muxaro-card p-12 text-center rounded-2xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] space-y-4">
          <Clock className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600" />
          <div className="space-y-1">
            <h3 className="text-base font-bold text-[var(--muxaro-text-primary)]">
              No recent downloads found
            </h3>
            <p className="text-xs text-[var(--muxaro-text-secondary)]">
              Files you convert or extract will appear here with live 60-minute expiration timers.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--muxaro-indigo)] text-white text-xs font-semibold hover:opacity-95"
          >
            Start a Conversion
          </Link>
        </div>
      ) : (
        <div className="divide-y divide-[var(--muxaro-border-subtle)] border border-[var(--muxaro-border)] rounded-2xl overflow-hidden bg-[var(--muxaro-bg-surface)] shadow-[var(--muxaro-shadow-card)]">
          {filteredItems.map((item) => {
            const countdown = getRemainingTime(item);
            const expired = countdown.expired;

            return (
              <div
                key={item.id}
                className={`p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors duration-150 ${
                  expired
                    ? 'bg-[var(--muxaro-bg-base)] opacity-75'
                    : 'hover:bg-[var(--muxaro-bg-base)]'
                }`}
              >
                {/* Media Icon & Info */}
                <div className="flex items-start gap-3.5 min-w-0">
                  <span
                    className={`p-2.5 rounded-xl shrink-0 mt-0.5 ${
                      expired
                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                        : 'bg-[var(--muxaro-tag-pill-bg)] text-[var(--muxaro-indigo)]'
                    }`}
                  >
                    {item.type === 'video' ? (
                      <Film className="w-5 h-5" />
                    ) : item.type === 'audio' ? (
                      <Music className="w-5 h-5" />
                    ) : (
                      <Archive className="w-5 h-5" />
                    )}
                  </span>
                  <div className="space-y-1 min-w-0">
                    <h3 className="text-sm font-bold text-[var(--muxaro-text-primary)] truncate">
                      {item.title}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muxaro-text-secondary)]">
                      {/* BUG 2 fix: display real format (e.g. MP4, M4A) and real size */}
                      <span className="font-mono font-semibold uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px]">
                        {item.format.toUpperCase()}
                      </span>
                      <span>•</span>
                      <span>{formatFileSize(item.fileSize)}</span>
                      <span>•</span>
                      <span className="font-mono text-slate-400 text-[11px]">{item.jobId}</span>
                    </div>
                  </div>
                </div>

                {/* Expiry Countdown & Actions */}
                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  {/* Countdown Badge with Tabular Numerals */}
                  <div
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold tabular-nums ${
                      expired
                        ? 'bg-red-500/10 text-red-600'
                        : countdown.urgency === 'danger'
                        ? 'bg-red-500/15 text-red-600 animate-pulse'
                        : countdown.urgency === 'warning'
                        ? 'bg-amber-500/15 text-amber-600'
                        : 'bg-emerald-500/15 text-emerald-600'
                    }`}
                    title="Time remaining before temporary file is securely erased"
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span className="tabular-nums">{countdown.text}</span>
                  </div>

                  {expired ? (
                    /* BUG 1 fix: Expired state — disabled actions + Re-analyze */
                    <>
                      {/* Expired Badge */}
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-500/30 bg-red-500/8 text-xs font-semibold text-red-600 dark:text-red-400 select-none">
                        <AlertCircle className="w-3.5 h-3.5" />
                        Expired
                      </span>

                      {/* Disabled Copy Link (BUG 1: disabled + pointer-events:none) */}
                      <button
                        type="button"
                        disabled
                        aria-disabled="true"
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] text-xs font-semibold text-[var(--muxaro-text-tertiary)] opacity-40 cursor-not-allowed"
                        style={{ pointerEvents: 'none' }}
                        title="Link has expired"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Link</span>
                      </button>

                      {/* Disabled Download (BUG 1: not an <a> when expired) */}
                      <button
                        type="button"
                        disabled
                        aria-disabled="true"
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 text-xs font-bold opacity-50 cursor-not-allowed"
                        style={{ pointerEvents: 'none' }}
                        title="File has expired"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </button>

                      {/* Re-analyze Button (BUG 1: navigates home with URL prefilled) */}
                      <button
                        type="button"
                        onClick={() => handleReanalyze(item)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--muxaro-indigo)]/40 text-xs font-semibold text-[var(--muxaro-indigo)] hover:bg-[var(--muxaro-indigo)]/8 transition-colors duration-150"
                        title="Re-analyze the original source URL"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Re-analyze</span>
                      </button>
                    </>
                  ) : (
                    /* Active state — normal Copy Link + Download */
                    <>
                      {/* Copy Link Button */}
                      <button
                        type="button"
                        onClick={() => handleCopyLink(item)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] text-xs font-semibold text-[var(--muxaro-text-secondary)] hover:bg-[var(--muxaro-bg-elevated)] transition-colors duration-150"
                        title="Copy direct resumable download link"
                      >
                        {copiedId === item.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                            <span className="text-emerald-600">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy Link</span>
                          </>
                        )}
                      </button>

                      {/* Download Button (live <a> tag only when not expired) */}
                      <a
                        href={item.downloadUrl}
                        download
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--muxaro-indigo)] text-white text-xs font-bold hover:opacity-95 transition-opacity"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </a>
                    </>
                  )}

                  {/* Instant Delete Button (always visible) */}
                  <button
                    type="button"
                    onClick={() => handleDeleteNow(item.jobId)}
                    className="p-2 rounded-xl border border-red-500/20 text-red-500 hover:bg-red-500/10 transition-colors duration-150"
                    title="Instant Delete Now (Purges cloud storage immediately)"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
