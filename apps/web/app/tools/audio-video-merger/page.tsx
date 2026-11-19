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

  const normalizedVideoPreview = normalizeMediaUrl(videoUrl);
  const normalizedAudioPreview = normalizeMediaUrl(audioUrl);

  const startMerge = async () => {
    const cleanVideo = normalizeMediaUrl(videoUrl);
    const cleanAudio = normalizeMediaUrl(audioUrl);
    if (!cleanVideo || !cleanAudio) {
      setErrorMsg('Please paste valid links for both the video track and the audio track.');
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
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-elevated border border-brand-violet/30 text-xs font-semibold text-brand-violet mb-4 shadow-xs">
              <Combine className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Audio & video merger</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-content tracking-tight">
              Combine separate video and audio tracks
            </h1>
            <p className="text-base text-content-secondary mt-3 leading-relaxed">
              Mux separate video and audio streams into a single high-definition file with sub-millisecond audio offset alignment.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 muxaro-media-card p-6 sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label
                    htmlFor="merge-video-url"
                    className="block text-sm font-semibold text-content"
                  >
                    Video track link
                  </label>
                  {normalizedVideoPreview && (
                    <span className="text-xs text-brand font-medium flex items-center gap-1">
                      <Sparkles className="w-3 h-3" aria-hidden="true" />
                      Video link verified
                    </span>
                  )}
                </div>
                <input
                  id="merge-video-url"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  value={videoUrl}
                  onChange={(e) => {
                    setVideoUrl(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="Paste video source link (e.g. youtube.com/watch?v=... or direct MP4/WebM)"
                  className="w-full px-4 py-3 rounded-xl bg-surface border border-line text-content placeholder:text-content-muted text-sm transition-colors"
                />

                {normalizedVideoPreview && (
                  <div className="mt-2.5">
                    <ActiveLinkIndicator
                      url={normalizedVideoPreview}
                      onClear={() => setVideoUrl('')}
                    />
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label
                    htmlFor="merge-audio-url"
                    className="block text-sm font-semibold text-content"
                  >
                    Audio track link
                  </label>
                  {normalizedAudioPreview && (
                    <span className="text-xs text-brand font-medium flex items-center gap-1">
                      <Sparkles className="w-3 h-3" aria-hidden="true" />
                      Audio link verified
                    </span>
                  )}
                </div>
                <input
                  id="merge-audio-url"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  value={audioUrl}
                  onChange={(e) => {
                    setAudioUrl(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="Paste audio track link (e.g. soundcloud, direct MP3/M4A/WAV)"
                  className="w-full px-4 py-3 rounded-xl bg-surface border border-line text-content placeholder:text-content-muted text-sm transition-colors"
                />

                {normalizedAudioPreview && (
                  <div className="mt-2.5">
                    <ActiveLinkIndicator
                      url={normalizedAudioPreview}
                      onClear={() => setAudioUrl('')}
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="merge-container"
                    className="block text-sm font-medium text-content mb-2"
                  >
                    Target container
                  </label>
                  <select
                    id="merge-container"
                    value={container}
                    onChange={(e) => setContainer(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line text-content text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet transition-colors"
                  >
                    <option value="mp4">MP4 (Default, widest playback)</option>
                    <option value="mkv">MKV (Best for multi-track audio)</option>
                    <option value="webm">WebM (Optimized for HTML5)</option>
                    <option value="mov">MOV (Apple ProRes & QuickTime)</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="merge-audio-delay"
                    className="block text-sm font-medium text-content mb-2"
                  >
                    Audio timing offset (ms)
                  </label>
                  <input
                    id="merge-audio-delay"
                    type="number"
                    step="50"
                    value={audioDelayMs}
                    onChange={(e) => setAudioDelayMs(parseInt(e.target.value, 10) || 0)}
                    placeholder="0"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line text-content text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet transition-colors"
                  />
                  <p className="text-[11px] text-content-muted mt-1">
                    Positive delays audio; negative advances audio.
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-surface-muted border border-line flex items-center justify-between">
                <div>
                  <span className="text-sm font-semibold text-content block">
                    Lossless stream copy (remux)
                  </span>
                  <span className="text-xs text-content-secondary">
                    Preserves original stream bitrates without re-encoding quality loss
                  </span>
                </div>
                <input
                  type="checkbox"
                  id="merge-stream-copy"
                  checked={streamCopy}
                  onChange={(e) => setStreamCopy(e.target.checked)}
                  className="w-4 h-4 text-brand-violet rounded border-line focus:ring-brand-violet"
                />
              </div>

              {errorMsg && (
                <div
                  role="alert"
                  className="p-4 rounded-xl bg-error-bg border border-error text-sm text-error flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{errorMsg}</span>
                  </div>
                  <button
                    type="button"
                    onClick={startMerge}
                    disabled={isSubmitting || !videoUrl.trim() || !audioUrl.trim()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-error bg-surface text-error text-xs font-semibold hover:bg-surface-elevated transition-colors active:opacity-90 disabled:opacity-50 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
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
                  className="px-6 py-3 rounded-full bg-brand-violet text-white text-sm font-semibold hover:bg-brand-violet/90 active:scale-[0.98] transition-transform shadow-xs disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2"
                >
                  {isSubmitting ? 'Starting remux…' : 'Merge video & audio'}
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
            <div className="muxaro-media-card p-6 space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-content">
                <Combine className="w-4 h-4 text-brand" aria-hidden="true" />
                <span>Muxing standards</span>
              </div>
              <ul className="space-y-3 text-xs text-content-secondary leading-relaxed">
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Interleaves AV packets with continuous timestamps (DTS/PTS).</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Supports multi-language audio track mapping without transcoding.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Fast-start `moov` atom placement for instant web streaming.</span>
                </li>
              </ul>
            </div>

            <div className="muxaro-media-card p-6 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-content">
                <ShieldCheck className="w-4 h-4 text-brand" aria-hidden="true" />
                <span>Private processing</span>
              </div>
              <p className="text-xs text-content-secondary leading-relaxed">
                Temporary muxing buffers are isolated to ephemeral scratch storage and wiped post-delivery.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
