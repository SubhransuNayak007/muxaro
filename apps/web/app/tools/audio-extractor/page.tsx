'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  ArrowLeft,
  Music,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import { api } from '@/lib/api-client';
import { ProcessingJob } from '@/lib/types';
import { normalizeMediaUrl } from '@/lib/url-utils';
import ActiveLinkIndicator from '@/components/ActiveLinkIndicator';

const JobProgress = dynamic(() => import('@/components/JobProgress'), {
  ssr: false,
  loading: () => (
    <div className="muxaro-card p-6 my-6 text-sm text-content-secondary">
      Loading progress tracker…
    </div>
  ),
});

const FORMAT_OPTIONS = [
  {
    value: 'native',
    label: 'Original audio (best quality)',
    detail: 'Zero quality loss, fastest turnaround',
  },
  {
    value: 'flac',
    label: 'FLAC lossless',
    detail: '24-bit studio archive quality',
  },
  {
    value: 'mp3',
    label: 'MP3 (320 kbps)',
    detail: 'Plays on any phone or music player',
  },
  {
    value: 'wav',
    label: 'WAV uncompressed',
    detail: 'Standard audio editing format',
  },
  {
    value: 'aac',
    label: 'AAC (256 kbps)',
    detail: 'Balanced size and clarity for Apple and web',
  },
  {
    value: 'opus',
    label: 'Opus (160 kbps)',
    detail: 'Modern compact high-clarity audio',
  },
];

export default function AudioExtractorPage() {
  const [url, setUrl] = useState<string>('');
  const [format, setFormat] = useState<string>('native');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [activeJob, setActiveJob] = useState<ProcessingJob | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const normalizedPreview = normalizeMediaUrl(url);

  const startExtraction = async () => {
    const trimmed = normalizeMediaUrl(url);
    if (!trimmed) {
      setErrorMsg('Please paste a valid media link (e.g. youtube.com/watch?v=... or direct video link).');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const isNative = format === 'native';
      const targetAudioCodec = isNative ? 'opus' : format;
      const job = await api.createJob({
        sourceUrl: trimmed,
        jobType: 'extract_audio',
        operation: 'EXTRACT_AUDIO',
        targetFormat: isNative ? 'opus' : format,
        targetAudioCodec,
        streamCopy: isNative,
        title: `Extracted Audio (${format === 'native' ? 'Original' : format.toUpperCase()})`,
      });
      setActiveJob(job);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Could not start audio extraction. Check the link and try again.';
      setErrorMsg(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await startExtraction();
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
              <Music className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Audio extractor</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-content tracking-tight">
              Extract clean audio from any video
            </h1>
            <p className="text-base text-content-secondary mt-3 leading-relaxed">
              Save original audio streams with zero re-encoding loss, or export to pristine FLAC, WAV, and MP3.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 deepseek-input-card p-6 sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label
                    htmlFor="audio-source-url"
                    className="block text-sm font-semibold text-content"
                  >
                    Authorised media link
                  </label>
                  {normalizedPreview && (
                    <span className="text-xs text-brand-violet font-medium flex items-center gap-1">
                      <Sparkles className="w-3 h-3" aria-hidden="true" />
                      Protocol verified
                    </span>
                  )}
                </div>
                <input
                  id="audio-source-url"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="Paste video or audio link (e.g. youtube.com/watch?v=... or direct MP4)"
                  className="w-full px-4 py-3 rounded-xl bg-surface border border-line text-content placeholder:text-content-muted text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet transition-colors"
                />

                {normalizedPreview && (
                  <div className="mt-3">
                    <ActiveLinkIndicator
                      url={normalizedPreview}
                      onClear={() => setUrl('')}
                    />
                  </div>
                )}
              </div>

              <div>
                <span className="block text-sm font-semibold text-content mb-3">
                  Choose output format
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {FORMAT_OPTIONS.map((option) => {
                    const selected = format === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setFormat(option.value)}
                        className={`p-3.5 rounded-xl border text-left transition-colors active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet ${
                          selected
                            ? 'border-brand-violet bg-surface-elevated shadow-xs ring-1 ring-brand-violet/20'
                            : 'border-line bg-surface hover:bg-surface-elevated'
                        }`}
                      >
                        <div className="text-sm font-semibold text-content">
                          {option.label}
                        </div>
                        <div className="text-xs text-content-secondary mt-0.5">
                          {option.detail}
                        </div>
                      </button>
                    );
                  })}
                </div>
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
                    onClick={startExtraction}
                    disabled={isSubmitting || !url.trim()}
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
                  disabled={isSubmitting || !url.trim()}
                  className="px-6 py-3 rounded-full bg-brand-violet text-white text-sm font-semibold hover:bg-brand-violet/90 active:scale-[0.98] transition-transform shadow-xs disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2"
                >
                  {isSubmitting ? 'Extracting audio…' : 'Extract audio track'}
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
            <div className="deepseek-input-card p-6 space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-content">
                <Sparkles className="w-4 h-4 text-brand-violet" aria-hidden="true" />
                <span>Audio extraction specs</span>
              </div>
              <ul className="space-y-3 text-xs text-content-secondary leading-relaxed">
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Original audio stream copy mode avoids quality degradation.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Supports multi-channel 5.1 and stereo downmixing automatically.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Full ID3 and Vorbis metadata preservation where available.</span>
                </li>
              </ul>
            </div>

            <div className="deepseek-input-card p-6 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-content">
                <ShieldCheck className="w-4 h-4 text-brand-violet" aria-hidden="true" />
                <span>Zero storage retention</span>
              </div>
              <p className="text-xs text-content-secondary leading-relaxed">
                Processed audio files are stored only for your temporary download session and purged automatically.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
