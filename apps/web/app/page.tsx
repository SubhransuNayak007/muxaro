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
import { api } from '@/lib/api-client';
import { useDeviceMode } from '@/lib/device-mode';
import { useAuth } from '@/lib/auth-context';
import { trackEvent } from '@/lib/analytics';
import { MediaManifest, ProcessingJob, JobState } from '@/lib/types';

// Dynamic code splitting for heavy interactive islands to preserve fast LCP
const MediaInspector = dynamic(() => import('@/components/MediaInspector'), {
  ssr: false,
  loading: () => (
    <div className="muxaro-card rounded-2xl p-8 mt-8 text-center flex flex-col items-center justify-center gap-3">
      <Loader2 className="w-6 h-6 text-brand-violet motion-safe:animate-spin" aria-hidden="true" />
      <span className="text-sm font-medium text-content-secondary">
        Analysing your media…
      </span>
    </div>
  ),
});

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
    description: 'Switch between MP4, MOV, MKV, and WebM cleanly.',
    icon: Film,
    accentClass: 'bg-interactive text-brand-violet dark:text-content',
  },
  {
    href: '/tools/audio-extractor',
    title: 'Extract Audio',
    description: 'Save audio from any video as MP3 or music files.',
    icon: Music,
    accentClass: 'bg-info-bg text-brand-blue dark:text-content',
  },
  {
    href: '/tools/audio-video-merger',
    title: 'Merge Video & Audio',
    description: 'Combine a video clip with your own audio track.',
    icon: Layers,
    accentClass: 'bg-success-bg text-success',
  },
  {
    href: '/tools/playlist-batch',
    title: 'Batch & Playlists',
    description: 'Process multiple links or files into one download.',
    icon: ListVideo,
    accentClass: 'bg-interactive text-brand-violet dark:text-content',
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
      const data = await api.inspectMedia(trimmed);
      setManifest(data);
      trackEvent('media_inspect_succeeded', {
        source_type: 'url',
        video_options: Array.isArray(data.videoStreams) ? data.videoStreams.length : 0,
        audio_options: Array.isArray(data.audioStreams) ? data.audioStreams.length : 0,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'We could not analyse that link. Please check the URL and try again.';
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
          <div className="text-center max-w-3xl mx-auto mb-8 sm:mb-10">
            <h1 className="text-4xl sm:text-5xl lg:text-[3.5rem] font-extrabold text-content tracking-tight leading-[1.12] mb-4">
              Your media,{' '}
              <span className="muxaro-text-gradient block sm:inline">
                ready in seconds.
              </span>
            </h1>

            <p className="text-base sm:text-lg text-content-secondary max-w-2xl mx-auto leading-relaxed">
              Convert video formats, extract high-fidelity audio, and remux streams with zero quality loss.
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
                    href="/dashboard"
                    className="px-3 py-1.5 rounded-lg border border-line text-content-secondary text-xs font-medium hover:text-content hover:border-brand-violet active:translate-y-px transition-colors duration-150 whitespace-nowrap"
                  >
                    My Downloads
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Alex Reji & Untitled UI Clean Media Workspace Card */}
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
              /* Stage 2: Media Inspector & Options */
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success-bg text-success text-xs font-semibold shrink-0">
                      <Check className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Link ready</span>
                    </span>
                    <span className="text-xs text-content-secondary truncate max-w-[220px] sm:max-w-md font-mono">
                      {manifest.sourceUrl || url}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setManifest(null);
                      setUrl('');
                      setErrorMessage(null);
                      setLastFailedAction(null);
                      window.setTimeout(() => urlInputRef.current?.focus(), 50);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-medium text-content-secondary hover:text-brand bg-interactive hover:bg-info-bg active:translate-y-px transition-colors duration-150 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Paste another link</span>
                  </button>
                </div>

                <MediaInspector
                  manifest={manifest}
                  onJobStarted={(job) => {
                    setActiveJob(job);
                  }}
                />
              </div>
            ) : inspecting ? (
              /* Stage 3: Animated Analyzing Progress State */
              <div className="muxaro-media-card p-4 sm:p-6 relative overflow-hidden">
                <div className="py-10 px-4 text-center space-y-4">
                  <div className="w-14 h-14 rounded-2xl bg-interactive text-brand-violet dark:text-content mx-auto flex items-center justify-center shadow-xs">
                    <Loader2 className="w-7 h-7 motion-safe:animate-spin text-brand" aria-hidden="true" />
                  </div>
                  <div className="space-y-1.5 max-w-md mx-auto">
                    <h3 className="text-base sm:text-lg font-bold text-content">
                      Analyzing media link…
                    </h3>
                    <p className="text-xs sm:text-sm font-mono text-content-secondary truncate px-3 py-1.5 rounded-lg bg-surface border border-line">
                      {url}
                    </p>
                    <p className="text-xs text-content-muted pt-1">
                      Extracting video resolutions, audio streams, and available formats…
                    </p>
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        setInspecting(false);
                        setErrorMessage(null);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-content-secondary hover:text-content border border-line hover:bg-surface-muted transition-colors"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Cancel</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* Stage 4: Clean Input Card (Paste a link | Upload a file) */
              <div className="muxaro-media-card p-4 sm:p-6 relative overflow-hidden">
                {/* Alex Reji Segmented Input Mode Tabs */}
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

                {/* Panel 1: Paste a Link */}
                {activeTab === 'link' ? (
                  <div id="panel-link" role="tabpanel" aria-labelledby="tab-link">
                    <form onSubmit={handleSubmit} className="space-y-3">
                      <div className="relative">
                        <Link2
                          className="w-4 h-4 text-content-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                          aria-hidden="true"
                        />
                        <input
                          ref={urlInputRef}
                          type="text"
                          inputMode="url"
                          value={url}
                          onFocus={() => setInputFocused(true)}
                          onBlur={() => setInputFocused(false)}
                          onChange={(e) => setUrl(e.target.value)}
                          onPaste={handleInputPaste}
                          placeholder="Paste a video or audio link (YouTube, Vimeo, direct media URL)…"
                          aria-label="Media link"
                          className="w-full pl-10 pr-28 py-3.5 rounded-xl bg-surface border border-line text-content placeholder:text-content-muted text-sm sm:text-base font-sans transition-colors duration-150"
                        />
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                          {url.trim().length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setUrl('');
                                setErrorMessage(null);
                                urlInputRef.current?.focus();
                              }}
                              aria-label="Clear link input"
                              className="p-1.5 rounded-lg text-content-muted hover:text-content hover:bg-interactive transition-colors"
                              title="Clear"
                            >
                              <X className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={handleClipboardPaste}
                            aria-label="Paste link from clipboard"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-brand bg-interactive hover:bg-info-bg active:translate-y-px transition-colors duration-150 whitespace-nowrap"
                          >
                            {pastedFeedback ? (
                              <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            ) : (
                              <ClipboardPaste className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            )}
                            <span className="whitespace-nowrap">{pasteLabel}</span>
                          </button>
                        </div>
                      </div>

                      {/* Bottom Action Strip with clean circular action button */}
                      <div className="flex items-center justify-between gap-3 pt-1">
                        <div className="flex items-center gap-2 text-xs text-content-secondary">
                          <span className="inline-flex items-center gap-1.5">
                            <ShieldCheck className="w-4 h-4 text-brand shrink-0" aria-hidden="true" />
                            <span className="hidden sm:inline">Permission-verified media</span>
                            <span className="sm:hidden">Verified media</span>
                          </span>
                          <span className="text-content-muted">•</span>
                          <span>Auto-deletes in 60m</span>
                        </div>

                        <div className="flex items-center gap-3">
                          <button
                            type="submit"
                            disabled={inspecting || !url.trim()}
                            className="muxaro-action-circle"
                            title={inspecting ? 'Analysing link...' : 'Analyse media'}
                            aria-label={inspecting ? 'Analysing media link' : 'Analyse media link'}
                          >
                            {inspecting ? (
                              <Loader2 className="w-5 h-5 motion-safe:animate-spin" aria-hidden="true" />
                            ) : (
                              <ArrowUp className="w-5 h-5" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      </div>
                    </form>
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

            {/* Quick Action Tool Pills (Alex Reji style) */}
            {!activeJob && !manifest && !inspecting && (
              <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 mt-5">
                {CAPABILITIES.map((cap) => {
                  const Icon = cap.icon;
                  return (
                    <Link
                      key={cap.href}
                      href={cap.href}
                      className="muxaro-pill-btn"
                    >
                      <Icon className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
                      <span>{cap.title}</span>
                    </Link>
                  );
                })}
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
        {/* Helpful Sign-In Prompt for Guest Inspection (non-blocking, preserves task) */}
        {!authLoading && !authenticated && manifest && !activeJob && (
          <div className="max-w-3xl mx-auto mb-5">
            <div className="rounded-2xl bg-surface border border-line shadow-sm px-4 py-3.5 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start sm:items-center gap-2.5 text-sm text-content min-w-0">
                <Sparkles className="w-4 h-4 text-brand-violet shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
                <span>
                  Sign in to save history, get priority processing, and receive 10 daily jobs.
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
                </Link>
              );
            })}
          </div>
        </section>

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
