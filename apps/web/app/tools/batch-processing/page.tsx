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
} from 'lucide-react';
import { api } from '@/lib/api-client';
import { ProcessingJob } from '@/lib/types';

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

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newUrl.trim();
    if (!trimmed) return;
    setItems((prev) => [
      ...prev,
      {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        url: trimmed,
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
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface border border-line text-xs font-medium text-brand mb-4">
              <Layers className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Batch processing</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-content tracking-tight">
              Process multiple files in one go
            </h1>
            <p className="text-base text-content-secondary mt-3 leading-relaxed">
              Queue multiple authorised links together and track every file in real time.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 muxaro-card p-6 sm:p-8">
            <form
              onSubmit={handleAddItem}
              className="space-y-4 pb-6 mb-6 border-b border-line"
            >
              <label
                htmlFor="batch-new-url"
                className="block text-sm font-medium text-content"
              >
                Add a media link to your batch queue
              </label>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  id="batch-new-url"
                  type="url"
                  required
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="Paste an authorised video or audio link (https://…)"
                  className="flex-1 px-4 py-2.5 rounded-sm bg-base border border-line text-content placeholder:text-content-muted text-sm focus:border-brand transition-colors"
                />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-sm border border-line bg-surface-elevated text-content text-sm font-semibold hover:border-brand transition-colors active:opacity-90 whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>Add item</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <div>
                  <label
                    htmlFor="batch-default-op"
                    className="block text-xs font-medium text-content-secondary mb-1.5"
                  >
                    Action for added links
                  </label>
                  <select
                    id="batch-default-op"
                    value={defaultOperation}
                    onChange={(e) =>
                      setDefaultOperation(
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
                    htmlFor="batch-default-format"
                    className="block text-xs font-medium text-content-secondary mb-1.5"
                  >
                    Output format
                  </label>
                  <select
                    id="batch-default-format"
                    value={defaultFormat}
                    onChange={(e) => setDefaultFormat(e.target.value)}
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

            <div className="space-y-3 mb-6">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-content-secondary">
                <span className="font-semibold text-content">
                  Queued items ({items.length})
                </span>
                <span>Uses {items.length} of 10 daily video jobs</span>
              </div>

              {items.length === 0 ? (
                <div className="p-8 rounded-md border border-dashed border-line text-center">
                  <p className="text-sm font-medium text-content mb-1">
                    No links queued yet
                  </p>
                  <p className="text-xs text-content-secondary">
                    Paste one or more authorised media links above to build your batch queue.
                  </p>
                </div>
              ) : (
                items.map((item, index) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 p-3.5 rounded-md bg-surface-elevated border border-line-subtle"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="w-6 h-6 rounded-full bg-surface text-brand font-semibold text-xs flex items-center justify-center border border-line shrink-0">
                        {index + 1}
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
                        onClick={() => handleRemoveItem(item.id)}
                        aria-label={`Remove item ${index + 1}`}
                        className="p-1.5 rounded-sm text-content-secondary hover:text-error transition-colors active:opacity-90"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {errorMsg && (
              <div className="p-4 rounded-md bg-error-bg border border-error text-sm text-error flex flex-wrap items-center justify-between gap-3 mb-5">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{errorMsg}</span>
                </div>
                <button
                  type="button"
                  onClick={handleRunBatch}
                  disabled={isQueueing || items.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-error bg-surface text-error text-xs font-semibold hover:bg-surface-elevated transition-colors active:opacity-90 disabled:opacity-50 whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Retry</span>
                </button>
              </div>
            )}

            <button
              type="button"
              disabled={isQueueing || items.length === 0}
              onClick={handleRunBatch}
              className="muxaro-btn-primary px-6 py-3 text-sm whitespace-nowrap active:opacity-90 disabled:opacity-50"
            >
              {isQueueing
                ? 'Starting batch…'
                : items.length === 0
                ? 'Add links to start'
                : `Process ${items.length} ${items.length === 1 ? 'item' : 'items'}`}
            </button>

            {activeJobs.length > 0 && (
              <div className="mt-8 pt-6 border-t border-line space-y-4">
                <h2 className="text-base font-bold text-content">
                  Active batch jobs
                </h2>
                {activeJobs.map((job) => (
                  <JobProgress key={job.id} initialJob={job} />
                ))}
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="muxaro-card p-6 space-y-4">
              <div className="text-sm font-bold text-content">
                Batch queue rules
              </div>
              <ul className="space-y-3 text-xs text-content-secondary leading-relaxed">
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Each individual link uses 1 of your 10 rolling daily media jobs.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>If any job fails or is cancelled, its quota slot is returned automatically.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Working with an authorised playlist? Use Playlist processing so your 10 individual jobs stay untouched.</span>
                </li>
              </ul>
            </div>

            <div className="muxaro-card p-6 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-content">
                <ShieldCheck className="w-4 h-4 text-brand" aria-hidden="true" />
                <span>Need playlist packaging?</span>
              </div>
              <p className="text-xs text-content-secondary leading-relaxed mb-3">
                Bundle up to 50 authorised playlist items into a single verified ZIP archive.
              </p>
              <Link
                href="/tools/playlist-processing"
                className="text-xs font-semibold text-brand hover:underline"
              >
                Switch to playlist processing
              </Link>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
