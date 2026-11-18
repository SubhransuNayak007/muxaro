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
  Info,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import { api } from '@/lib/api-client';
import { ProcessingJob } from '@/lib/types';

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
  const [sampleRate, setSampleRate] = useState<string>('source');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [activeJob, setActiveJob] = useState<ProcessingJob | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const startExtraction = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setErrorMsg('Please paste a valid authorised media link first.');
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
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface border border-line text-xs font-medium text-brand mb-4">
              <Music className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Audio extractor</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-content tracking-tight">
              Extract clean audio from any video
            </h1>
            <p className="text-base text-content-secondary mt-3 leading-relaxed">
              Save original audio with zero loss, or export FLAC, WAV, and MP3.
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
                  htmlFor="audio-source-url"
                  className="block text-sm font-medium text-content mb-2"
                >
                  Authorised media link
                </label>
                <input
                  id="audio-source-url"
                  type="url"
                  required
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="Paste an authorised video or audio link (https://…)"
                  className="w-full px-4 py-3 rounded-sm bg-base border border-line text-content placeholder:text-content-muted text-sm focus:border-brand transition-colors"
                />
              </div>

              <div>
                <span className="block text-sm font-medium text-content mb-3">
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
                        className={`p-3.5 rounded-md border text-left transition-colors active:opacity-90 ${
                          selected
                            ? 'border-brand bg-surface-muted'
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

              <div className="max-w-sm">
                <label
                  htmlFor="audio-sample-rate"
                  className="block text-sm font-medium text-content mb-2"
                >
                  Sample rate
                </label>
                <select
                  id="audio-sample-rate"
                  value={sampleRate}
                  onChange={(e) => setSampleRate(e.target.value)}
                  disabled={format === 'native'}
                  className="w-full px-4 py-2.5 rounded-sm bg-base border border-line text-content text-sm focus:border-brand transition-colors disabled:opacity-50"
                >
                  <option value="source">Match original source (recommended)</option>
                  <option value="44100">44.1 kHz (CD standard)</option>
                  <option value="48000">48.0 kHz (Video and broadcast)</option>
                  <option value="96000">96.0 kHz (High-resolution master)</option>
                </select>
              </div>

              <div className="p-4 rounded-md bg-surface-elevated border border-line-subtle flex items-start gap-3">
                <Info
                  className="w-4 h-4 text-brand shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <p className="text-xs text-content-secondary leading-relaxed">
                  Honest audio note: converting a compressed source (such as 128 kbps AAC) into FLAC or 320 kbps MP3 cannot restore audio detail that was already discarded. Choose Original audio to keep 100% of the source quality without re-encoding.
                </p>
              </div>

              {errorMsg && (
                <div className="p-4 rounded-md bg-error-bg border border-error text-sm text-error flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{errorMsg}</span>
                  </div>
                  <button
                    type="button"
                    onClick={startExtraction}
                    disabled={isSubmitting || !url.trim()}
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
                  disabled={isSubmitting || !url.trim()}
                  className="muxaro-btn-primary px-6 py-3 text-sm whitespace-nowrap active:opacity-90 disabled:opacity-50"
                >
                  {isSubmitting ? 'Starting extraction…' : 'Extract audio'}
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
                <Sparkles className="w-4 h-4 text-brand" aria-hidden="true" />
                <span>Why keep original audio?</span>
              </div>
              <ul className="space-y-3 text-xs text-content-secondary leading-relaxed">
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Preserves exact source quality with zero re-encoding loss.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Completes in seconds instead of waiting for full conversion.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Output playback integrity is verified before download delivery.</span>
                </li>
              </ul>
            </div>

            <div className="muxaro-card p-6 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-content">
                <ShieldCheck className="w-4 h-4 text-brand" aria-hidden="true" />
                <span>Automatic privacy cleanup</span>
              </div>
              <p className="text-xs text-content-secondary leading-relaxed">
                Extracted audio files stay available for download temporarily, then are automatically deleted for your privacy.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
