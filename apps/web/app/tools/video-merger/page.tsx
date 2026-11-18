'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  ArrowLeft,
  Film,
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
    <div className="muxaro-card p-6 my-6 text-sm text-content-secondary">
      Loading video join progress…
    </div>
  ),
});

export default function VideoMergerPage() {
  const [videoList, setVideoList] = useState<string[]>(['', '']);
  const [outputFormat, setOutputFormat] = useState<string>('mp4');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [activeJob, setActiveJob] = useState<ProcessingJob | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const validCount = videoList.filter((v) => v.trim().length > 0).length;

  const handleAddVideo = () => {
    setVideoList([...videoList, '']);
  };

  const handleUpdateVideo = (index: number, val: string) => {
    const updated = [...videoList];
    updated[index] = val;
    setVideoList(updated);
    if (errorMsg) setErrorMsg(null);
  };

  const handleRemoveVideo = (index: number) => {
    if (videoList.length <= 2) return;
    setVideoList(videoList.filter((_, i) => i !== index));
  };

  const startJoin = async () => {
    const valid = videoList.filter((v) => v.trim().length > 0);
    if (valid.length < 2) {
      setErrorMsg('Please enter at least two authorised video links to join.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const job = await api.createJob({
        sourceUrl: valid[0],
        jobType: 'transcode_video',
        operation: 'REMUX_STREAM_COPY',
        targetFormat: outputFormat,
        streamCopy: true,
        title: `Joined Video (${valid.length} clips)`,
      });
      setActiveJob(job);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Could not join video clips. Check the links and try again.';
      setErrorMsg(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await startJoin();
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
              <Film className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Video clip joiner</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-content tracking-tight">
              Join multiple video clips into one file
            </h1>
            <p className="text-base text-content-secondary mt-3 leading-relaxed">
              Join continuous video clips into one file with zero quality loss.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 muxaro-card p-6 sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="flex items-center justify-between gap-4 pb-3 border-b border-line-subtle">
                <span className="text-sm font-semibold text-content">
                  Clip sequence ({videoList.length} slots)
                </span>
                <button
                  type="button"
                  onClick={handleAddVideo}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold border border-line bg-surface-elevated text-content hover:border-brand transition-colors active:opacity-90 whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Add clip</span>
                </button>
              </div>

              <div className="space-y-3">
                {videoList.map((url, idx) => (
                  <div key={idx} className="flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-full bg-surface-muted text-brand font-semibold text-xs flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <input
                      type="url"
                      required
                      value={url}
                      onChange={(e) => handleUpdateVideo(idx, e.target.value)}
                      placeholder={`Paste clip ${idx + 1} link (https://…)`}
                      aria-label={`Video clip ${idx + 1} URL`}
                      className="flex-1 px-4 py-2.5 rounded-sm bg-base border border-line text-content placeholder:text-content-muted text-sm focus:border-brand transition-colors"
                    />
                    {videoList.length > 2 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveVideo(idx)}
                        aria-label={`Remove clip ${idx + 1}`}
                        className="p-2.5 rounded-sm border border-line text-content-secondary hover:text-error hover:border-error transition-colors active:opacity-90"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-line-subtle max-w-xs">
                <label
                  htmlFor="video-merger-format"
                  className="block text-sm font-medium text-content mb-2"
                >
                  Output format
                </label>
                <select
                  id="video-merger-format"
                  value={outputFormat}
                  onChange={(e) => setOutputFormat(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-sm bg-base border border-line text-content text-sm focus:border-brand transition-colors"
                >
                  <option value="mp4">MP4 (Standard video)</option>
                  <option value="mkv">MKV (High compatibility)</option>
                  <option value="webm">WebM (Web video)</option>
                </select>
              </div>

              {errorMsg && (
                <div className="p-4 rounded-md bg-error-bg border border-error text-sm text-error flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{errorMsg}</span>
                  </div>
                  <button
                    type="button"
                    onClick={startJoin}
                    disabled={isSubmitting || validCount < 2}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-error bg-surface text-error text-xs font-semibold hover:bg-surface-elevated transition-colors active:opacity-90 disabled:opacity-50 whitespace-nowrap"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Retry</span>
                  </button>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-4 pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting || validCount < 2}
                  className="muxaro-btn-primary px-6 py-3 text-sm whitespace-nowrap active:opacity-90 disabled:opacity-50"
                >
                  {isSubmitting ? 'Joining clips…' : 'Join video clips'}
                </button>
                <span className="text-xs text-content-secondary">
                  Uses 1 of your 10 daily free media jobs
                </span>
              </div>
            </form>

            {activeJob && (
              <div className="mt-8 pt-6 border-t border-line">
                <JobProgress initialJob={activeJob} onJobUpdate={setActiveJob} />
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="muxaro-card p-6 space-y-4">
              <div className="text-sm font-bold text-content">
                How clip joining works
              </div>
              <ul className="space-y-3 text-xs text-content-secondary leading-relaxed">
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Clips with matching resolution and format are joined directly without re-encoding.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Mismatched clips automatically fall back to clean frame-aligned rendering.</span>
                </li>
              </ul>
            </div>

            <div className="muxaro-card p-6 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-content">
                <ShieldCheck className="w-4 h-4 text-brand" aria-hidden="true" />
                <span>Private workspace</span>
              </div>
              <p className="text-xs text-content-secondary leading-relaxed">
                Joined outputs stay ready for download temporarily, then are automatically removed for privacy.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
