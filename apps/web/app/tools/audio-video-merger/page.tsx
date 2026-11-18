'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  ArrowLeft,
  Combine,
  CheckCircle2,
  ShieldCheck,
  AlertCircle,
  Clock,
  RotateCcw,
} from 'lucide-react';
import { api } from '@/lib/api-client';
import { ProcessingJob } from '@/lib/types';

const JobProgress = dynamic(() => import('@/components/JobProgress'), {
  ssr: false,
  loading: () => (
    <div className="muxaro-card p-6 my-6 text-sm text-content-secondary">
      Loading merge progress…
    </div>
  ),
});

export default function AudioVideoMergerPage() {
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [container, setContainer] = useState<string>('mp4');
  const [audioDelayMs, setAudioDelayMs] = useState<number>(0);
  const [streamCopy, setStreamCopy] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [activeJob, setActiveJob] = useState<ProcessingJob | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const startMerge = async () => {
    const cleanVideo = videoUrl.trim();
    const cleanAudio = audioUrl.trim();
    if (!cleanVideo || !cleanAudio) {
      setErrorMsg('Please paste both a video link and an audio link first.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const job = await api.createJob({
        sourceUrl: cleanVideo,
        jobType: 'merge_av',
        operation: 'MERGE_AUDIO_VIDEO',
        targetFormat: container,
        streamCopy,
        audioDelayMs,
        title: `Merged Video & Audio (${container.toUpperCase()})`,
      });
      setActiveJob(job);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Could not start track merge. Check both links and try again.';
      setErrorMsg(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await startMerge();
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
              <Combine className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Audio & video merger</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-content tracking-tight">
              Combine separate video and audio tracks
            </h1>
            <p className="text-base text-content-secondary mt-3 leading-relaxed">
              Merge separate video and audio tracks with exact millisecond sync timing.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 muxaro-card p-6 sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label
                  htmlFor="merge-video-url"
                  className="block text-sm font-medium text-content mb-2"
                >
                  Video track link
                </label>
                <input
                  id="merge-video-url"
                  type="url"
                  required
                  value={videoUrl}
                  onChange={(e) => {
                    setVideoUrl(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="Paste an authorised video track link (https://…)"
                  className="w-full px-4 py-3 rounded-sm bg-base border border-line text-content placeholder:text-content-muted text-sm focus:border-brand transition-colors"
                />
              </div>

              <div>
                <label
                  htmlFor="merge-audio-url"
                  className="block text-sm font-medium text-content mb-2"
                >
                  Audio track link
                </label>
                <input
                  id="merge-audio-url"
                  type="url"
                  required
                  value={audioUrl}
                  onChange={(e) => {
                    setAudioUrl(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="Paste an authorised audio track link (https://…)"
                  className="w-full px-4 py-3 rounded-sm bg-base border border-line text-content placeholder:text-content-muted text-sm focus:border-brand transition-colors"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="merge-container"
                    className="block text-sm font-medium text-content mb-2"
                  >
                    Output format
                  </label>
                  <select
                    id="merge-container"
                    value={container}
                    onChange={(e) => setContainer(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-sm bg-base border border-line text-content text-sm focus:border-brand transition-colors"
                  >
                    <option value="mp4">MP4 (Best overall compatibility)</option>
                    <option value="mkv">MKV (Best for Opus and FLAC audio)</option>
                    <option value="webm">WebM (Web-ready video and audio)</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="merge-audio-delay"
                    className="block text-sm font-medium text-content mb-2"
                  >
                    Audio sync offset (milliseconds)
                  </label>
                  <input
                    id="merge-audio-delay"
                    type="number"
                    value={audioDelayMs}
                    onChange={(e) =>
                      setAudioDelayMs(parseInt(e.target.value, 10) || 0)
                    }
                    placeholder="0"
                    className="w-full px-3.5 py-2.5 rounded-sm bg-base border border-line text-content font-mono text-sm focus:border-brand transition-colors"
                  />
                  <p className="text-xs text-content-secondary mt-1.5">
                    Positive delays audio. Negative shifts audio earlier.
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-md bg-surface-elevated border border-line-subtle">
                <label
                  htmlFor="merge-stream-copy"
                  className="flex items-start gap-3 cursor-pointer"
                >
                  <input
                    id="merge-stream-copy"
                    type="checkbox"
                    checked={streamCopy}
                    onChange={(e) => setStreamCopy(e.target.checked)}
                    className="w-4 h-4 mt-0.5 rounded-sm border border-line accent-brand"
                  />
                  <span className="text-sm text-content leading-snug">
                    Keep original video and audio quality without re-encoding (recommended for fast, zero-loss merging)
                  </span>
                </label>
              </div>

              {errorMsg && (
                <div className="p-4 rounded-md bg-error-bg border border-error text-sm text-error flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{errorMsg}</span>
                  </div>
                  <button
                    type="button"
                    onClick={startMerge}
                    disabled={isSubmitting || !videoUrl.trim() || !audioUrl.trim()}
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
                  disabled={isSubmitting || !videoUrl.trim() || !audioUrl.trim()}
                  className="muxaro-btn-primary px-6 py-3 text-sm whitespace-nowrap active:opacity-90 disabled:opacity-50"
                >
                  {isSubmitting ? 'Starting merge…' : 'Merge video & audio'}
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
              <div className="flex items-center gap-2 text-sm font-bold text-content">
                <Clock className="w-4 h-4 text-brand" aria-hidden="true" />
                <span>Sync & quality highlights</span>
              </div>
              <ul className="space-y-3 text-xs text-content-secondary leading-relaxed">
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Ideal for combining silent 4K or 8K video tracks with studio audio.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Automatic format compatibility checks prevent playback errors.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Millisecond offset calibration fixes lip-sync drift accurately.</span>
                </li>
              </ul>
            </div>

            <div className="muxaro-card p-6 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-content">
                <ShieldCheck className="w-4 h-4 text-brand" aria-hidden="true" />
                <span>Verified output</span>
              </div>
              <p className="text-xs text-content-secondary leading-relaxed">
                Every merged file is checked for duration and playback integrity before your download link is generated.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
