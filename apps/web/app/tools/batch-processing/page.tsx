'use client';

import React, { useState } from 'react';
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
  Sparkles,
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

interface BatchItem {
  id: string;
  url: string;
  format: string;
  operation: 'extract_audio' | 'transcode_video';
}

export default function BatchProcessingPage() {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [newUrl, setNewUrl] = useState<string>('');
  const [defaultFormat, setDefaultFormat] = useState<string>('mp4');
  const [defaultOperation, setDefaultOperation] = useState<
    'extract_audio' | 'transcode_video'
  >('transcode_video');
  const [isQueueing, setIsQueueing] = useState<boolean>(false);
  const [activeJobs, setActiveJobs] = useState<ProcessingJob[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const normalizedInputPreview = normalizeMediaUrl(newUrl);

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
        operation: defaultOperation,
      },
    ]);
    setNewUrl('');
    setErrorMsg(null);
  };

  const handleRemoveItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleRunBatch = async () => {
    if (items.length === 0) return;
    setIsQueueing(true);
    setErrorMsg(null);
    try {
      const createdJobs: ProcessingJob[] = [];
      for (const item of items) {
        const filename = item.url.split('/').pop() || 'Media file';
        const job = await api.createJob({
          sourceUrl: item.url,
          jobType: item.operation,
          operation:
            item.operation === 'extract_audio'
              ? 'EXTRACT_AUDIO'
              : 'CONVERT_FORMAT',
          targetFormat: item.format,
          streamCopy: item.format === 'native',
          title: filename,
        });
        createdJobs.push(job);
      }
      setActiveJobs(createdJobs);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Could not start batch queue. Check your links and try again.';
      setErrorMsg(message);
    } finally {
      setIsQueueing(false);
    }
  };

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
                    <Sparkles className="w-3 h-3" aria-hidden="true" />
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
                  placeholder="Paste video or audio link (e.g. youtube.com/watch?v=... or direct MP4)"
                  className="flex-1 px-4 py-2.5 rounded-xl bg-surface border border-line text-content placeholder:text-content-muted text-sm transition-colors"
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

            {activeJobs.length > 0 && (
              <div className="mt-8 pt-6 border-t border-line space-y-4">
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
