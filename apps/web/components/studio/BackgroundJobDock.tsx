'use client';

import React, { useEffect, useState } from 'react';
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronUp,
  ChevronDown,
  FolderOpen,
  ExternalLink,
  X,
  RotateCcw,
} from 'lucide-react';
import { isDesktopApp } from '@/lib/native-bridge';
import { formatBytes } from '@/lib/formatters';

interface DockJob {
  id: string;
  state: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progressPct: number;
  stage: string;
  title: string;
  filename?: string;
  sizeBytes?: number;
  error?: string;
}

export default function BackgroundJobDock() {
  const [jobs, setJobs] = useState<DockJob[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [dismissedEmpty, setDismissedEmpty] = useState(false);

  const refreshJobs = async () => {
    if (!isDesktopApp()) return;
    try {
      const r = await fetch('/api/v1/jobs', { cache: 'no-store' });
      if (!r.ok) return;
      const res = await r.json();
      const list = Array.isArray(res?.jobs) ? res.jobs : Array.isArray(res?.data) ? res.data : [];
      setJobs(list.slice(0, 6));
    } catch {}
  };

  useEffect(() => {
    if (!isDesktopApp()) return;
    void refreshJobs();
    const hasActive = jobs.some((j) => j.state === 'processing' || j.state === 'queued');
    const timer = setInterval(() => {
      void refreshJobs();
    }, hasActive ? 1200 : 5000);
    return () => clearInterval(timer);
  }, [jobs.length, jobs.some((j) => j.state === 'processing')]);

  const activeJobs = jobs.filter((j) => j.state === 'processing' || j.state === 'queued');
  const recentJobs = jobs.slice(0, 4);

  if (!isDesktopApp() || recentJobs.length === 0 || (dismissedEmpty && activeJobs.length === 0)) {
    return null;
  }

  const head = activeJobs[0] || recentJobs[0];

  const handleAction = async (endpoint: string, jobId: string) => {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
    }).catch(() => {});
    void refreshJobs();
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 max-w-[calc(100vw-2rem)]">
      <div className="rounded-2xl border border-line bg-surface shadow-xl overflow-hidden">
        {/* Compact Dock Header */}
        <div className="px-3.5 py-2.5 flex items-center justify-between gap-2 bg-surface-elevated/80">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-2 min-w-0 flex-1 text-left"
          >
            {activeJobs.length > 0 ? (
              <Loader2 className="w-4 h-4 animate-spin text-brand shrink-0" />
            ) : head.state === 'failed' ? (
              <AlertCircle className="w-4 h-4 text-error shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-content truncate">
                {activeJobs.length > 0
                  ? `${activeJobs.length} running (${head.progressPct || 0}%)`
                  : head.filename || head.title}
              </div>
              <div className="text-[11px] text-content-secondary truncate">{head.stage}</div>
            </div>
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-content-tertiary shrink-0" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5 text-content-tertiary shrink-0" />
            )}
          </button>

          {activeJobs.length === 0 && (
            <button
              type="button"
              onClick={() => setDismissedEmpty(true)}
              aria-label="Hide background task dock"
              className="p-1 rounded-lg text-content-tertiary hover:text-content"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Progress Bar when active */}
        {activeJobs.length > 0 && (
          <div className="h-1 w-full bg-surface-elevated overflow-hidden">
            <div
              className="h-full bg-brand transition-transform duration-200 origin-left"
              style={{ transform: `scaleX(${Math.max(0.04, (head.progressPct || 4) / 100)})` }}
            />
          </div>
        )}

        {/* Expanded Jobs List */}
        {expanded && (
          <div className="p-2.5 space-y-2 max-h-72 overflow-y-auto border-t border-line bg-surface">
            {recentJobs.map((job) => (
              <div key={job.id} className="p-2.5 rounded-xl border border-line bg-surface-elevated/60 space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-content truncate">{job.filename || job.title}</span>
                  {typeof job.sizeBytes === 'number' && job.sizeBytes > 0 && (
                    <span className="text-[10px] text-content-tertiary tabular-nums shrink-0">
                      {formatBytes(job.sizeBytes)}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-content-secondary truncate">{job.error || job.stage}</div>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {job.state === 'processing' && (
                    <button
                      type="button"
                      onClick={() => void handleAction(`/api/v1/jobs/${encodeURIComponent(job.id)}/cancel`, job.id)}
                      className="px-2 py-1 rounded-lg border border-line bg-surface text-[10px] font-medium text-content"
                    >
                      Cancel
                    </button>
                  )}
                  {job.state === 'failed' && (
                    <button
                      type="button"
                      onClick={() => void handleAction(`/api/v1/jobs/${encodeURIComponent(job.id)}/retry`, job.id)}
                      className="px-2 py-1 rounded-lg bg-brand text-white text-[10px] font-semibold inline-flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Retry</span>
                    </button>
                  )}
                  {job.state === 'completed' && (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleAction('/api/v1/native/open-file', job.id)}
                        className="px-2 py-1 rounded-lg bg-brand text-white text-[10px] font-semibold inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Open</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleAction('/api/v1/native/show-in-folder', job.id)}
                        className="px-2 py-1 rounded-lg border border-line bg-surface text-[10px] font-medium text-content inline-flex items-center gap-1"
                      >
                        <FolderOpen className="w-3 h-3" />
                        <span>Folder</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
