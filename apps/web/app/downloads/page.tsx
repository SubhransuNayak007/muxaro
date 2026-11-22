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
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
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
} from 'lucide-react';
import { api } from '@/lib/api-client';

export interface DownloadItem {
  id: string;
  jobId: string;
  title: string;
  format: string;
  fileSize: number; // in bytes
  createdAt: string;
  expiresAt: string; // ISO date string 24h from creation
  downloadUrl: string;
  type: 'video' | 'audio' | 'archive';
}

const STORAGE_KEY = 'muxaro_downloads_history_v1';

export default function DownloadsPage() {
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [filterType, setFilterType] = useState<'all' | 'video' | 'audio' | 'archive'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(Date.now());

  // Per-second clock tick for live countdown timers
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Load history from localStorage and API
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

    // Attempt to merge server history
    try {
      const serverJobs = await api.listJobs().catch(() => []);
      if (Array.isArray(serverJobs)) {
        const mappedServer: DownloadItem[] = serverJobs
          .filter((j: any) => j.status === 'READY' && j.downloadUrl)
          .map((j: any) => {
            const isAudio = j.operation === 'EXTRACT_AUDIO' || ['mp3', 'wav', 'flac', 'aac'].includes(j.targetFormat);
            const isArchive = j.operation === 'BATCH' || j.targetFormat === 'zip';
            const created = new Date(j.createdAt || Date.now());
            const expires = j.expiresAt
              ? new Date(j.expiresAt).toISOString()
              : new Date(created.getTime() + 60 * 60 * 1000).toISOString();

            const jId = (j.jobId || j.id || `job_${Math.random().toString(36).slice(2, 8)}`) as string;
            return {
              id: jId,
              jobId: jId,
              title: j.artifact?.filename || j.title || `Media Export (${jId.slice(0, 8)})`,
              format: j.targetFormat || (isAudio ? 'mp3' : 'mp4'),
              fileSize: j.artifact?.size || 45 * 1024 * 1024,
              createdAt: created.toISOString(),
              expiresAt: expires,
              downloadUrl: j.downloadUrl,
              type: isArchive ? 'archive' : isAudio ? 'audio' : 'video',
            };
          });

        // Merge without duplicates
        const map = new Map<string, DownloadItem>();
        for (const it of [...localList, ...mappedServer]) {
          map.set(it.jobId, it);
        }
        localList = Array.from(map.values()).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      }
    } catch {}

    setItems(localList);
    setIsLoading(false);
  }, []);

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

  // Instant Delete Now
  const handleDeleteNow = async (jobId: string) => {
    const updated = items.filter((i) => i.jobId !== jobId);
    saveItems(updated);

    // Call server deletion in background
    try {
      await fetch(`/api/v1/jobs/${encodeURIComponent(jobId)}`, {
        method: 'DELETE',
      }).catch(() => {});
    } catch {}
  };

  // Copy Resumable Link
  const handleCopyLink = async (item: DownloadItem) => {
    const fullUrl = item.downloadUrl.startsWith('http')
      ? item.downloadUrl
      : `${window.location.origin}${item.downloadUrl}`;

    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  };

  // Formatter for 60-Minute Countdown
  const getRemainingTime = (expiresAtStr: string) => {
    const expiry = new Date(expiresAtStr).getTime();
    const diffMs = expiry - currentTime;

    if (diffMs <= 0) {
      return { text: 'Expired', expired: true, urgency: 'expired' };
    }

    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

    const pad = (n: number) => String(n).padStart(2, '0');
    const text = `${totalMinutes}m ${pad(seconds)}s remaining`;

    let urgency: 'normal' | 'warning' | 'danger' = 'normal';
    if (totalMinutes < 10) urgency = 'danger';
    else if (totalMinutes < 25) urgency = 'warning';

    return { text, expired: false, urgency };
  };

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
              Downloads & Session History
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
            const countdown = getRemainingTime(item.expiresAt);
            return (
              <div
                key={item.id}
                className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-[var(--muxaro-bg-base)] transition-colors duration-150"
              >
                {/* Media Icon & Info */}
                <div className="flex items-start gap-3.5 min-w-0">
                  <span className="p-2.5 rounded-xl bg-[var(--muxaro-tag-pill-bg)] text-[var(--muxaro-indigo)] shrink-0 mt-0.5">
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
                      <span className="font-mono font-semibold uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px]">
                        .{item.format}
                      </span>
                      <span>•</span>
                      <span>{(item.fileSize / (1024 * 1024)).toFixed(1)} MB</span>
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
                      countdown.expired
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

                  {/* Download Button */}
                  <a
                    href={item.downloadUrl}
                    download
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--muxaro-indigo)] text-white text-xs font-bold hover:opacity-95 transition-opacity"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </a>

                  {/* Instant Delete Button */}
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
