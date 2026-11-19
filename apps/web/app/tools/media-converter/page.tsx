'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  ShieldCheck,
  AlertCircle,
  Sliders,
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
      Loading conversion status…
    </div>
  ),
});

export default function MediaConverterPage() {
  const [url, setUrl] = useState<string>('');
  const [outputContainer, setOutputContainer] = useState<string>('mp4');
  const [videoCodec, setVideoCodec] = useState<string>('copy');
  const [resolution, setResolution] = useState<string>('source');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [activeJob, setActiveJob] = useState<ProcessingJob | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isAudioOutput =
    outputContainer === 'mp3' || outputContainer === 'flac';

  const normalizedPreview = normalizeMediaUrl(url);

  const startConversion = async () => {
    const trimmed = normalizeMediaUrl(url);
    if (!trimmed) {
      setErrorMsg('Please paste an authorised media link (e.g. youtube.com/watch?v=... or https://...).');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const job = await api.createJob({
        sourceUrl: trimmed,
        jobType: isAudioOutput ? 'extract_audio' : 'transcode_video',
        operation: isAudioOutput
          ? 'EXTRACT_AUDIO'
          : videoCodec === 'copy'
          ? 'REMUX_STREAM_COPY'
          : 'CONVERT_FORMAT',
        targetFormat: outputContainer,
        targetResolution:
          isAudioOutput || videoCodec === 'copy' || resolution === 'source'
            ? undefined
            : resolution,
        streamCopy: !isAudioOutput && videoCodec === 'copy',
        title: `Converted Media (${outputContainer.toUpperCase()})`,
      });
      setActiveJob(job);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Could not start media conversion. Check the link and try again.';
      setErrorMsg(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await startConversion();
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
              <RefreshCw className="w-3.5 h-3.5 animate-spin-slow" aria-hidden="true" />
              <span>Media converter</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-content tracking-tight">
              Convert videos and audio cleanly
            </h1>
            <p className="text-base text-content-secondary mt-3 leading-relaxed">
              Switch between MP4, MKV, WebM, MOV, MP3, and FLAC with lossless stream copying or modern high-efficiency codecs.
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
                    htmlFor="converter-url"
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
                  id="converter-url"
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
                  className="w-full px-4 py-3 rounded-xl bg-surface border border-line text-content placeholder:text-content-muted text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:border-brand-violet transition-colors"
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

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label
                    htmlFor="converter-format"
                    className="block text-sm font-medium text-content mb-2"
                  >
                    Output format
                  </label>
                  <select
                    id="converter-format"
                    value={outputContainer}
                    onChange={(e) => setOutputContainer(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line text-content text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet transition-colors"
                  >
                    <option value="mp4">MP4 (Plays everywhere)</option>
                    <option value="mkv">MKV (High compatibility)</option>
                    <option value="webm">WebM (Web video)</option>
                    <option value="mov">MOV (Apple QuickTime)</option>
                    <option value="mp3">MP3 (Audio only)</option>
                    <option value="flac">FLAC (Lossless audio)</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="converter-codec"
                    className="block text-sm font-medium text-content mb-2"
                  >
                    Video quality mode
                  </label>
                  <select
                    id="converter-codec"
                    value={videoCodec}
                    onChange={(e) => setVideoCodec(e.target.value)}
                    disabled={isAudioOutput}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line text-content text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet transition-colors disabled:opacity-50"
                  >
                    <option value="copy">Keep original quality (fastest)</option>
                    <option value="libx264">H.264 (Plays everywhere)</option>
                    <option value="libx265">H.265 / HEVC (Smaller files)</option>
                    <option value="libvpx-vp9">VP9 (Web streaming)</option>
                    <option value="libsvtav1">AV1 (Modern high efficiency)</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="converter-resolution"
                    className="block text-sm font-medium text-content mb-2"
                  >
                    Resolution
                  </label>
                  <select
                    id="converter-resolution"
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                    disabled={isAudioOutput || videoCodec === 'copy'}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line text-content text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet transition-colors disabled:opacity-50"
                  >
                    <option value="source">Keep original resolution</option>
                    <option value="8K UHD">8K UHD (7680x4320)</option>
                    <option value="4K UHD">4K UHD (3840x2160)</option>
                    <option value="1440p QHD">1440p QHD (2560x1440)</option>
                    <option value="1080p FHD">1080p Full HD (1920x1080)</option>
                    <option value="720p HD">720p HD (1280x720)</option>
                    <option value="480p">480p Compact</option>
                  </select>
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
                    onClick={startConversion}
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
                  {isSubmitting ? 'Starting conversion…' : 'Start conversion'}
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
                <Sliders className="w-4 h-4 text-brand-violet" aria-hidden="true" />
                <span>Conversion guarantees</span>
              </div>
              <ul className="space-y-3 text-xs text-content-secondary leading-relaxed">
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>No artificial upscaling: output resolution never exceeds genuine source dimensions.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Preserves HDR color profiles and original aspect ratios.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Every converted file is verified for playback health before delivery.</span>
                </li>
              </ul>
            </div>

            <div className="deepseek-input-card p-6 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-content">
                <ShieldCheck className="w-4 h-4 text-brand-violet" aria-hidden="true" />
                <span>Private processing</span>
              </div>
              <p className="text-xs text-content-secondary leading-relaxed">
                Your files are processed privately and automatically deleted once your temporary download window expires.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
