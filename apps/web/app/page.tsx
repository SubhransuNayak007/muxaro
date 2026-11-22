'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Link2,
  UploadCloud,
  ClipboardPaste,
  Check,
  Loader2,
  Film,
  Music,
  Layers,
  ListVideo,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  RotateCcw,
  X,
  Clock,
  Sparkles,
  ArrowUp,
  ExternalLink,
} from 'lucide-react';
import HeroWaveLines from '@/components/HeroWaveLines';
import ActiveLinkIndicator from '@/components/ActiveLinkIndicator';
import HeroOmnibox from '@/components/HeroOmnibox';
import AdaptiveMediaCard from '@/components/AdaptiveMediaCard';
import TrustStrip from '@/components/TrustStrip';
import WhyChooseMuxaro from '@/components/WhyChooseMuxaro';
import { api } from '@/lib/api-client';
import { useDeviceMode } from '@/lib/device-mode';
import { useAuth } from '@/lib/auth-context';
import { trackEvent } from '@/lib/analytics';
import { MediaManifest, ProcessingJob, JobState } from '@/lib/types';

const JobProgress = dynamic(() => import('@/components/JobProgress'), {
  ssr: false,
  loading: () => (
    <div className="muxaro-card rounded-2xl p-8 my-6 text-center flex flex-col items-center justify-center gap-3">
      <Loader2 className="w-6 h-6 text-brand-blue motion-safe:animate-spin" aria-hidden="true" />
      <span className="text-sm font-medium text-content-secondary">
        Opening your download progress…
      </span>
    </div>
  ),
});

const CAPABILITIES = [
  {
    href: '/tools/media-converter',
    title: 'Convert Video',
    description: 'Switch between video formats cleanly with zero quality degradation.',
    icon: Film,
    accentClass: 'bg-interactive text-brand-violet dark:text-content',
    formats: ['MP4', 'MKV', 'WebM', 'MOV'],
  },
  {
    href: '/tools/audio-extractor',
    title: 'Extract Audio',
    description: 'Save studio-quality audio from any video with customizable bitrates.',
    icon: Music,
    accentClass: 'bg-info-bg text-brand-blue dark:text-content',
    formats: ['MP3', 'FLAC', 'WAV', 'AAC'],
  },
  {
    href: '/tools/audio-video-merger',
    title: 'Merge Video & Audio',
    description: 'Combine high-res video streams with custom audio or commentary tracks.',
    icon: Layers,
    accentClass: 'bg-success-bg text-success',
    formats: ['MP4', 'MKV', 'WebM', 'WAV'],
  },
  {
    href: '/tools/playlist-batch',
    title: 'Batch & Playlists',
    description: 'Process full playlists or multi-file batches into a single archive.',
    icon: ListVideo,
    accentClass: 'bg-interactive text-brand-violet dark:text-content',
    formats: ['MP4', 'MKV', 'MP3', 'ZIP'],
  },
] as const;

const TRUST_GUARANTEES = [
  'Zero ads or pop-ups',
  '60-minute auto-delete',
  'Original quality when compatible',
  'Continues safely in background',
] as const;

const ACTIVE_STATES = new Set<JobState>([
  'CREATED',
  'VALIDATING',
  'QUEUED',
  'PROCESSING',
  'VERIFYING',
]);

type FailedAction =
  | { type: 'url'; url: string }
  | { type: 'file'; file: File };

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

export default function HomePage() {
  const router = useRouter();
  const { shouldAnimateAurora } = useDeviceMode();
  const {
    authenticated,
    loading: authLoading,
    savePendingTask,
    consumePendingTask,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<'link' | 'upload'>('link');
  const [url, setUrl] = useState<string>('');
  const [inputFocused, setInputFocused] = useState<boolean>(false);
  const [inspecting, setInspecting] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [manifest, setManifest] = useState<MediaManifest | null>(null);
  const [activeJob, setActiveJob] = useState<ProcessingJob | null>(null);
  const [backgroundJobs, setBackgroundJobs] = useState<ProcessingJob[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastFailedAction, setLastFailedAction] = useState<FailedAction | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [pastedFeedback, setPastedFeedback] = useState<boolean>(false);

  const urlInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const restoredPendingRef = useRef<boolean>(false);

  // Track landing page view cleanly with zero PII
  useEffect(() => {
    trackEvent('page_view', { page_group: 'landing' });
  }, []);

  // Restore active background jobs when returning to the workspace
  useEffect(() => {
    let cancelled = false;

    const loadBackgroundJobs = async () => {
      try {
        const jobs = await api.getHistory();
        if (cancelled || !Array.isArray(jobs)) return;
        const inFlight = jobs.filter((job) => job && ACTIVE_STATES.has(job.status));
        setBackgroundJobs(inFlight);
      } catch {
        // Stay quietly clean if API is offline or has no session history
      }
    };

    void loadBackgroundJobs();
    return () => {
      cancelled = true;
    };
  }, []);

  // Abort any in-flight browser upload if the user navigates away
  useEffect(() => {
    return () => {
      uploadAbortRef.current?.abort();
    };
  }, []);

  const inspectTargetUrl = useCallback(async (targetUrl: string) => {
    let trimmed = targetUrl.trim();
    if (!trimmed) {
      setErrorMessage('Please paste a valid media link to get started.');
      setLastFailedAction(null);
      return;
    }

    // Auto-normalize protocol if user enters or pastes link without https://
    if (!/^https?:\/\//i.test(trimmed)) {
      trimmed = `https://${trimmed}`;
    }
    setUrl(trimmed);

    setInspecting(true);
    setErrorMessage(null);
    setUploadNotice(null);
    setLastFailedAction(null);
    setActiveJob(null);
    trackEvent('media_inspect_started', { source_type: 'url' });

    try {
      const data = await api.probeUrl(trimmed);
      setManifest(data);
      trackEvent('media_inspect_succeeded', {
        source_type: 'url',
        video_options: Array.isArray(data.videoStreams) ? data.videoStreams.length : 0,
        audio_options: Array.isArray(data.audioStreams) ? data.audioStreams.length : 0,
      });
    } catch (err: unknown) {
      let message = err instanceof Error ? err.message : '';
      if (!message || message === '[object Object]' || message.includes('[object Object]')) {
        message = 'We could not analyse that link. Please check the URL and try again.';
      }
      setErrorMessage(message);
      setLastFailedAction({ type: 'url', url: trimmed });
      trackEvent('media_inspect_failed', { source_type: 'url' });
    } finally {
      setInspecting(false);
    }
  }, []);

  // Restore any pending media link saved before navigating to sign-in / registration
  useEffect(() => {
    if (restoredPendingRef.current) return;
    restoredPendingRef.current = true;
    const pending = consumePendingTask();
    if (pending?.url && /^https?:\/\//i.test(pending.url)) {
      setActiveTab('link');
      setUrl(pending.url);
      void inspectTargetUrl(pending.url);
    }
  }, [consumePendingTask, inspectTargetUrl]);

  const handleSaveAndNavigateToAuth = (target: '/login' | '/register') => {
    const candidateUrl =
      url.trim() ||
      (manifest?.sourceUrl && /^https?:\/\//i.test(manifest.sourceUrl)
        ? manifest.sourceUrl
        : undefined);
    if (candidateUrl) {
      savePendingTask({
        url: candidateUrl,
        returnTo: '/',
      });
    }
    trackEvent('cta_clicked', {
      placement: 'guest_inspect_prompt',
      destination: target === '/login' ? 'login' : 'register',
    });
    router.push(`${target}?returnTo=${encodeURIComponent('/')}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await inspectTargetUrl(url);
  };

  const handleClipboardPaste = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        const trimmed = text.trim();
        if (trimmed) {
          setUrl(trimmed);
          setErrorMessage(null);
          setLastFailedAction(null);
          setPastedFeedback(true);
          window.setTimeout(() => setPastedFeedback(false), 1800);
          if (
            /^https?:\/\//i.test(trimmed) ||
            /^(www\.|youtu\.be|youtube\.com|vimeo\.com|tiktok\.com|twitter\.com|x\.com|instagram\.com|twitch\.tv|soundcloud\.com)/i.test(trimmed)
          ) {
            void inspectTargetUrl(trimmed);
            return;
          }
          urlInputRef.current?.focus();
          return;
        }
      }
    } catch {
      // Clipboard access unavailable or denied; focus input for manual paste
    }
    urlInputRef.current?.focus();
  };

  const handleInputPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text').trim();
    if (text) {
      if (
        /^https?:\/\//i.test(text) ||
        /^(www\.|youtu\.be|youtube\.com|vimeo\.com|tiktok\.com|twitter\.com|x\.com|instagram\.com|twitch\.tv|soundcloud\.com)/i.test(text)
      ) {
        setUrl(text);
        setErrorMessage(null);
        setLastFailedAction(null);
        window.setTimeout(() => {
          void inspectTargetUrl(text);
        }, 50);
      }
    }
  };

  const handleFileUpload = useCallback(async (file: File) => {
    const maxSizeBytes = 2 * 1024 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      setErrorMessage('That file is larger than 2 GB. Please choose a smaller file.');
      setLastFailedAction(null);
      return;
    }

    uploadAbortRef.current?.abort();
    const controller = new AbortController();
    uploadAbortRef.current = controller;

    setUploading(true);
    setUploadProgress(null);
    setSelectedFileName(file.name);
    setErrorMessage(null);
    setUploadNotice(null);
    setLastFailedAction(null);
    setManifest(null);
    setActiveJob(null);
    trackEvent('upload_started', { source_type: 'local_file' });

    try {
      const data = await api.uploadLocalFile(file, {
        onProgress: (pct) => {
          if (Number.isFinite(pct)) {
            setUploadProgress(Math.max(0, Math.min(100, Math.round(pct))));
          }
        },
        signal: controller.signal,
      });
      setManifest(data);
      trackEvent('upload_completed', { source_type: 'local_file' });
      trackEvent('media_inspect_succeeded', {
        source_type: 'local_file',
        video_options: Array.isArray(data.videoStreams) ? data.videoStreams.length : 0,
        audio_options: Array.isArray(data.audioStreams) ? data.audioStreams.length : 0,
      });
    } catch (err: unknown) {
      if (isAbortError(err) || controller.signal.aborted) {
        setUploadNotice('Upload cancelled.');
        trackEvent('upload_cancelled', { source_type: 'local_file' });
      } else {
        const message =
          err instanceof Error
            ? err.message
            : 'We could not upload that file. Please try again.';
        setErrorMessage(message);
        setLastFailedAction({ type: 'file', file });
        trackEvent('media_inspect_failed', { source_type: 'local_file' });
      }
    } finally {
      if (uploadAbortRef.current === controller) {
        uploadAbortRef.current = null;
      }
      setUploading(false);
      setUploadProgress(null);
      setSelectedFileName(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, []);

  const handleCancelUpload = () => {
    uploadAbortRef.current?.abort();
  };

  const handleRetryLastAction = () => {
    if (lastFailedAction) {
      if (lastFailedAction.type === 'url') {
        void inspectTargetUrl(lastFailedAction.url);
      } else {
        void handleFileUpload(lastFailedAction.file);
      }
    } else if (url.trim()) {
      void inspectTargetUrl(url.trim());
    } else {
      setErrorMessage(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (!uploading && e.dataTransfer.files?.[0]) {
      void handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleResumeBackgroundJob = (job: ProcessingJob) => {
    setActiveJob(job);
    setBackgroundJobs((prev) => prev.filter((item) => item.id !== job.id));
  };

  const activeBackgroundCount = backgroundJobs.length;
  const analyseLabel = inspecting ? 'Analysing…' : 'Analyse';
  const pasteLabel = pastedFeedback ? 'Pasted' : 'Paste';
  const uploadScale = uploadProgress !== null ? uploadProgress / 100 : 0;

  return (
    <div className="w-full relative">
      {/* Hero Section with Minimalist Violet-Style Vector Wave Lines */}
      <section
        className={`muxaro-aurora-shell w-full pt-8 pb-14 sm:pt-12 sm:pb-20 relative overflow-hidden${
          inputFocused ? ' muxaro-aurora-focused' : ''
        }${inspecting || uploading ? ' muxaro-aurora-analyzing' : ''}`}
        data-aurora-paused={!shouldAnimateAurora ? 'true' : undefined}
      >
        <HeroWaveLines />
        <div className="muxaro-aurora-ribbon" aria-hidden="true" />
        <div className="muxaro-aurora-glow" aria-hidden="true" />

        <div className="relative z-10 max-w-sheet mx-auto px-4 sm:px-6 lg:px-8">
          {/* Hero Header */}
          <div className="text-center max-w-3xl mx-auto mb-6 sm:mb-8">
            <h1 className="text-4xl sm:text-5xl lg:text-[3.5rem] font-extrabold text-content tracking-tight leading-[1.12] mb-3">
              Universal Video Downloader &{' '}
              <span className="muxaro-text-gradient block sm:inline">
                Lossless Converter
              </span>
            </h1>

            <p className="text-base sm:text-lg text-content-secondary max-w-2xl mx-auto leading-relaxed">
              Download up to 8K video, extract lossless 320 kbps MP3 & studio FLAC, or convert formats cleanly. 100% ad-free with a 4 GB free limit.
            </p>
          </div>

          {/* Active Background Queue Restoration Banner */}
          {!activeJob && activeBackgroundCount > 0 && (
            <div className="max-w-3xl mx-auto mb-5">
              <div className="rounded-xl bg-surface border border-line shadow-sm px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 text-sm text-content min-w-0">
                  <Clock className="w-4 h-4 text-brand-violet shrink-0" aria-hidden="true" />
                  <span>
                    {activeBackgroundCount === 1
                      ? 'You have 1 job continuing in the background.'
                      : `You have ${activeBackgroundCount} jobs continuing in the background.`}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleResumeBackgroundJob(backgroundJobs[0])}
                    className="px-3 py-1.5 rounded-lg bg-interactive text-brand-violet dark:text-content text-xs font-semibold hover:bg-info-bg active:translate-y-px transition-colors duration-150 whitespace-nowrap"
                  >
                    View progress
                  </button>
                  <Link
                    href="/downloads"
                    className="px-3 py-1.5 rounded-lg border border-line text-content-secondary text-xs font-medium hover:text-content hover:border-brand-violet active:translate-y-px transition-colors duration-150 whitespace-nowrap"
                  >
                    Downloads
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Clean Media Workspace Card */}
          <div className="max-w-3xl mx-auto">
            {activeJob ? (
              /* Stage 1: Active Job Progress (Single Stage Container) */
              <JobProgress
                initialJob={activeJob}
                onJobUpdate={setActiveJob}
                sourceUrl={activeJob.sourceUrl || url || manifest?.sourceUrl}
                onDismiss={() => {
                  setActiveJob(null);
                  setManifest(null);
                  setUrl('');
                  setErrorMessage(null);
                  setLastFailedAction(null);
                }}
              />
            ) : manifest ? (
              /* Stage 2: Adaptive Media Result Stage */
              <AdaptiveMediaCard
                manifest={manifest}
                onReset={() => {
                  setManifest(null);
                  setUrl('');
                  setErrorMessage(null);
                  setLastFailedAction(null);
                }}
                onJobStarted={(job) => {
                  setActiveJob(job);
                }}
              />
            ) : (
              /* Stage 3: SSR-First Hero Omnibox & Mode Switcher */
              <div className="muxaro-media-card p-4 sm:p-6 relative overflow-hidden">
                {/* Segmented Input Mode Tabs */}
                <div
                  role="tablist"
                  aria-label="Choose how to add media"
                  className="muxaro-segmented-group mb-4"
                >
                  <button
                    type="button"
                    role="tab"
                    id="tab-link"
                    aria-selected={activeTab === 'link'}
                    aria-controls="panel-link"
                    onClick={() => setActiveTab('link')}
                    className={`muxaro-segmented-tab ${activeTab === 'link' ? 'active' : ''}`}
                  >
                    <Link2 className="w-3.5 h-3.5 text-brand shrink-0" aria-hidden="true" />
                    <span>Paste a link</span>
                  </button>

                  <button
                    type="button"
                    role="tab"
                    id="tab-upload"
                    aria-selected={activeTab === 'upload'}
                    aria-controls="panel-upload"
                    onClick={() => setActiveTab('upload')}
                    className={`muxaro-segmented-tab ${activeTab === 'upload' ? 'active' : ''}`}
                  >
                    <UploadCloud className="w-3.5 h-3.5 text-info shrink-0" aria-hidden="true" />
                    <span>Upload a file</span>
                  </button>
                </div>

                {/* Panel 1: Paste a Link with SSR-First Hero Omnibox */}
                {activeTab === 'link' ? (
                  <div id="panel-link" role="tabpanel" aria-labelledby="tab-link">
                    <HeroOmnibox
                      url={url}
                      onUrlChange={setUrl}
                      onSubmit={(targetUrl) => {
                        void inspectTargetUrl(targetUrl);
                      }}
                      probing={inspecting}
                      onFocusChange={setInputFocused}
                    />
                  </div>
                ) : (
                  /* Panel 2: Upload a File */
                  <div id="panel-upload" role="tabpanel" aria-labelledby="tab-upload">
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (!uploading) setIsDragging(true);
                      }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={handleDrop}
                      className={`p-8 sm:p-10 border-2 border-dashed rounded-xl text-center transition-colors duration-150 ${
                        isDragging
                          ? 'border-brand-violet bg-interactive'
                          : 'border-line bg-base hover:border-brand-violet'
                      }`}
                    >
                      <div
                        className="w-12 h-12 rounded-2xl bg-interactive text-brand-violet dark:text-content mx-auto flex items-center justify-center mb-3"
                        aria-hidden="true"
                      >
                        {uploading ? (
                          <Loader2 className="w-6 h-6 motion-safe:animate-spin" />
                        ) : (
                          <UploadCloud className="w-6 h-6" />
                        )}
                      </div>

                      {uploading ? (
                        <div className="max-w-md mx-auto space-y-4">
                          <div>
                            <h2 className="text-base font-semibold text-content mb-1">
                              {uploadProgress !== null
                                ? `Uploading your file (${uploadProgress}%)…`
                                : 'Uploading your file…'}
                            </h2>
                            {selectedFileName && (
                              <p className="text-sm text-content-secondary truncate">
                                {selectedFileName}
                              </p>
                            )}
                          </div>

                          <div
                            role="progressbar"
                            aria-label="Upload progress"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={uploadProgress ?? undefined}
                            className="w-full h-2 rounded-full bg-elevated overflow-hidden"
                          >
                            <div
                              className="h-full w-full origin-left bg-muxaro-gradient motion-safe:transition-transform motion-safe:duration-150"
                              style={{ transform: `scaleX(${uploadScale})` }}
                            />
                          </div>

                          <button
                            type="button"
                            onClick={handleCancelUpload}
                            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl border border-line bg-surface text-sm font-medium text-content-secondary hover:text-content hover:border-brand-violet active:translate-y-px transition-colors duration-150 whitespace-nowrap"
                          >
                            <X className="w-4 h-4 shrink-0" aria-hidden="true" />
                            <span>Cancel upload</span>
                          </button>
                        </div>
                      ) : (
                        <>
                          <h2 className="text-base font-semibold text-content mb-1">
                            Drop a file from your computer
                          </h2>
                          <p className="text-sm text-content-secondary max-w-md mx-auto mb-5">
                            Compress a video, change its format, or extract audio. Supports MP4, MOV, MKV, WebM, MP3, and WAV up to 2 GB.
                          </p>
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="muxaro-btn-primary px-5 py-2.5 min-h-[44px] rounded-xl text-sm font-semibold inline-flex items-center justify-center whitespace-nowrap active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                          >
                            Choose a file
                          </button>
                        </>
                      )}

                      <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        disabled={uploading}
                        accept="video/*,audio/*,.mp4,.mkv,.webm,.mov,.mp3,.flac,.wav,.aac,.m4a"
                        onChange={(e) => {
                          if (e.target.files?.[0]) {
                            void handleFileUpload(e.target.files[0]);
                          }
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Calm Cancellation Notice */}
            {!activeJob && uploadNotice && !errorMessage && (
              <div
                role="status"
                className="mt-4 px-4 py-3 rounded-xl bg-surface border border-line text-content-secondary text-sm flex items-center justify-between gap-3"
              >
                <span>{uploadNotice}</span>
                <button
                  type="button"
                  onClick={() => setUploadNotice(null)}
                  aria-label="Dismiss notice"
                  className="text-content-secondary hover:text-content active:translate-y-px transition-colors duration-150"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            )}

            {/* Honest API Error Banner with Retry */}
            {!activeJob && errorMessage && (
              <div
                role="alert"
                className="mt-4 p-4 rounded-xl bg-error-bg border border-error text-error text-sm flex flex-wrap items-center justify-between gap-3"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{errorMessage}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleRetryLastAction}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-error text-error text-xs font-semibold hover:bg-error-bg active:translate-y-px transition-colors duration-150 whitespace-nowrap"
                  >
                    <RotateCcw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Retry</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMessage(null);
                      setLastFailedAction(null);
                    }}
                    className="text-xs font-medium text-content-secondary hover:text-content px-2 py-1 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Main Content Container */}
      <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        {/* Core Reliability & Privacy Trust Strip */}
        <TrustStrip />
        {/* Helpful Sign-In Prompt for Guest Inspection (non-blocking, preserves task) */}
        {!authLoading && !authenticated && manifest && !activeJob && (
          <div className="max-w-3xl mx-auto mb-5">
            <div className="rounded-2xl bg-surface border border-line shadow-sm px-4 py-3.5 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start sm:items-center gap-2.5 text-sm text-content min-w-0">
                <Sparkles className="w-4 h-4 text-brand-violet shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
                <span>
                  Create a free account for higher file-size caps, batch playlist downloads, and 24-hr cloud history.
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleSaveAndNavigateToAuth('/login')}
                  className="px-3.5 py-2 rounded-xl bg-interactive text-brand-violet dark:text-content text-xs font-semibold hover:bg-info-bg active:translate-y-px transition-colors duration-150 whitespace-nowrap"
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveAndNavigateToAuth('/register')}
                  className="muxaro-btn-primary px-3.5 py-2 rounded-xl text-xs font-semibold active:translate-y-px whitespace-nowrap"
                >
                  Create free account
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Structured Free Account Benefits Card */}
        {!authLoading && !authenticated && !manifest && !activeJob && (
          <div className="max-w-3xl mx-auto mt-2 mb-10">
            <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6 shadow-card transition-colors">
              {/* Header with Title and Primary CTA Button */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-line/60">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-info-bg text-brand-violet dark:text-content text-[11px] font-semibold border border-brand-violet/20">
                      <Sparkles className="w-3 h-3 text-brand-violet" aria-hidden="true" />
                      Free Account Benefits
                    </span>
                  </div>
                  <h3 className="text-base sm:text-lg font-bold text-content tracking-tight">
                    Upgrade Your Media Studio Experience
                  </h3>
                  <p className="text-xs text-content-secondary mt-0.5">
                    100% free forever — no payment card required.
                  </p>
                </div>

                <Link
                  href="/register"
                  className="muxaro-btn-primary px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap active:scale-[0.98] transition-transform shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet self-stretch sm:self-auto"
                >
                  <span>Create free account</span>
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" />
                </Link>
              </div>

              {/* 3-Column Features */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
                <div className="flex items-start gap-3 p-3 rounded-xl bg-surface-elevated/40 border border-line/50">
                  <div className="w-8 h-8 rounded-lg bg-interactive text-brand-violet flex items-center justify-center shrink-0">
                    <UploadCloud className="w-4 h-4" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-content">Higher File-Size Caps</p>
                    <p className="text-[11px] text-content-secondary mt-0.5 leading-snug">
                      Process large media files up to 4 GB with dedicated priority worker allocations.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-surface-elevated/40 border border-line/50">
                  <div className="w-8 h-8 rounded-lg bg-info-bg text-brand-blue flex items-center justify-center shrink-0">
                    <ListVideo className="w-4 h-4" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-content">Batch Playlists</p>
                    <p className="text-[11px] text-content-secondary mt-0.5 leading-snug">
                      Download complete YouTube, Vimeo, or audio playlists into a single archive.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-surface-elevated/40 border border-line/50">
                  <div className="w-8 h-8 rounded-lg bg-success-bg text-success flex items-center justify-center shrink-0">
                    <Clock className="w-4 h-4" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-content">24-Hr Cloud History</p>
                    <p className="text-[11px] text-content-secondary mt-0.5 leading-snug">
                      Instant re-downloads, persistent SHA-256 hashes, and transfer sync across devices.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Concise 4-Item Capability Strip */}
        <section className="pt-4 pb-12" aria-labelledby="capabilities-heading">
          <h2 id="capabilities-heading" className="sr-only">
            Media tools
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {CAPABILITIES.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="muxaro-card-interactive rounded-2xl p-5 flex flex-col group active:translate-y-px"
                >
                  <div
                    className={`w-10 h-10 rounded-xl ${item.accentClass} flex items-center justify-center mb-3.5 motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-hover:scale-105`}
                    aria-hidden="true"
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-semibold text-content mb-1 group-hover:text-brand-violet transition-colors duration-150">
                    {item.title}
                  </h3>
                  <p className="text-sm text-content-secondary leading-relaxed">
                    {item.description}
                  </p>
                  <div className="mt-4 pt-3.5 border-t border-line/60 flex flex-wrap gap-1.5 items-center">
                    {item.formats.map((fmt) => (
                      <span
                        key={fmt}
                        className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-interactive text-content-secondary border border-line/60 group-hover:border-brand-violet/40 transition-colors duration-150"
                      >
                        {fmt}
                      </span>
                    ))}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Why Creators Choose MUXARO Comparison Module */}
        <WhyChooseMuxaro />

        {/* Clean Trust & Privacy Bar */}
        <section
          aria-label="Workspace guarantees"
          className="py-6 border-t border-line flex flex-wrap items-center justify-center sm:justify-between gap-x-8 gap-y-3 text-sm text-content-secondary"
        >
          {TRUST_GUARANTEES.map((item) => (
            <div key={item} className="inline-flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-success shrink-0" aria-hidden="true" />
              <span>{item}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
