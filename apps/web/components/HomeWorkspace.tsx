'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  UploadCloud,
  Loader2,
  AlertCircle,
  RotateCcw,
  X,
  FileText,
  Music,
  Film,
  Image as ImageIcon,
  ArrowUpRight,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import HeroOmnibox, { type DownloadIntentMode, type SmartPreset } from '@/components/HeroOmnibox';
import AdaptiveMediaCard from '@/components/AdaptiveMediaCard';
import { api } from '@/lib/api-client';
import { useDeviceDetection } from '@/hooks/useDeviceDetection';
import { useOpenedArtifact } from '@/lib/opened-artifact';
import { recordRecentTool } from '@/lib/recent-tools';
import { PDF_TOOLS_CATALOG } from '@/lib/tools-catalog';
import { formatBytes } from '@/lib/formatters';
import { MediaManifest, ProcessingJob } from '@/lib/types';

const JobProgress = dynamic(() => import('@/components/JobProgress'), {
  ssr: false,
  loading: () => (
    <div className="muxaro-card rounded-2xl p-8 my-6 text-center flex flex-col items-center justify-center gap-3">
      <Loader2 className="w-6 h-6 text-brand motion-safe:animate-spin" aria-hidden="true" />
      <span className="text-sm font-medium text-content-secondary">
        Opening progress monitor…
      </span>
    </div>
  ),
});

type FailedAction =
  | { type: 'url'; url: string }
  | { type: 'file'; file: File };

interface QuickRouteOption {
  href: string;
  label: string;
  note: string;
}

interface DroppedStudioFile {
  file: File;
  domain: 'pdf' | 'audio' | 'image' | 'video';
  browseHref: string;
  browseLabel: string;
  routes: QuickRouteOption[];
}

function classifyDroppedStudioFile(file: File): DroppedStudioFile | null {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';

  if (ext === 'pdf' || file.type === 'application/pdf') {
    return {
      file,
      domain: 'pdf',
      browseHref: '/tools/pdf',
      browseLabel: `Browse all ${PDF_TOOLS_CATALOG.length} PDF tools`,
      routes: [
        { href: '/tools/pdf/compress?handoff=1', label: 'Compress PDF', note: 'Lossless QPDF or balanced shrink' },
        { href: '/tools/pdf/edit?handoff=1', label: 'Edit and Annotate', note: 'Text, highlights, and redactions' },
        { href: '/tools/pdf/sign?handoff=1', label: 'Sign PDF', note: 'Draw, type, or stamp signature' },
        { href: '/tools/pdf/ocr?handoff=1', label: 'Extract Text / OCR', note: 'Searchable PDF or Markdown' },
        { href: '/tools/pdf/merge?handoff=1', label: 'Merge PDFs', note: 'Combine with additional files' },
        { href: '/tools/pdf/view?handoff=1', label: 'Read and Inspect', note: 'High-DPI local canvas reader' },
      ],
    };
  }

  if (ext === 'docx') {
    return {
      file,
      domain: 'pdf',
      browseHref: '/tools/pdf',
      browseLabel: 'Browse PDF Studio',
      routes: [
        { href: '/tools/pdf/word-to-pdf?handoff=1', label: 'Word to PDF', note: 'Preserves headings, lists, and tables' },
      ],
    };
  }

  if (ext === 'pptx') {
    return {
      file,
      domain: 'pdf',
      browseHref: '/tools/pdf',
      browseLabel: 'Browse PDF Studio',
      routes: [
        { href: '/tools/pdf/powerpoint-to-pdf?handoff=1', label: 'PowerPoint to PDF', note: 'Native aspect ratio slide export' },
      ],
    };
  }

  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
    return {
      file,
      domain: 'image',
      browseHref: '/tools/pdf',
      browseLabel: 'Browse PDF Studio',
      routes: [
        { href: '/tools/pdf/image-to-pdf?handoff=1', label: 'Image to PDF', note: 'EXIF-aware A4 or Letter PDF' },
      ],
    };
  }

  if (file.type.startsWith('audio/') || ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus'].includes(ext)) {
    return {
      file,
      domain: 'audio',
      browseHref: '/tools?section=audio',
      browseLabel: 'Browse Audio tools',
      routes: [
        { href: '/tools/audio-normalizer?handoff=1', label: 'Normalize Loudness', note: 'EBU R128 for YouTube or Podcasts' },
        { href: '/tools/media-converter?handoff=1', label: 'Convert Audio', note: 'MP3, FLAC, WAV, AAC, or Opus' },
        { href: '/tools/metadata-scrubber?handoff=1', label: 'Scrub Metadata', note: 'Inspect codecs and strip ID3 tags' },
      ],
    };
  }

  if (file.type.startsWith('video/') || ['mp4', 'mkv', 'webm', 'mov', 'avi', 'flv', 'm4v'].includes(ext)) {
    return {
      file,
      domain: 'video',
      browseHref: '/tools?section=video',
      browseLabel: 'Browse Video Studio',
      routes: [
        { href: '/tools/video-compressor?handoff=1', label: 'Compress (10 / 16 MB)', note: 'Discord and WhatsApp 2-pass target' },
        { href: '/tools/video-trimmer?handoff=1', label: 'Lossless Trim / 60s Split', note: 'Instant browser stream-copy cut' },
        { href: '/tools/media-converter?handoff=1', label: 'Convert Format', note: 'Remux MKV or convert 105+ formats' },
        { href: '/tools/audio-extractor?handoff=1', label: 'Extract Audio', note: 'Save FLAC, WAV, or 320 kbps MP3' },
        { href: '/tools/aspect-ratio-pad?handoff=1', label: 'Reframe 9:16 Reels', note: 'Blur fill or center crop' },
        { href: '/tools/metadata-scrubber?handoff=1', label: 'Inspect and Scrub Tags', note: 'View streams and strip GPS/EXIF' },
      ],
    };
  }

  return null;
}

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

const PRESET_BY_MODE: Record<DownloadIntentMode, SmartPreset> = {
  video: '4k',
  audio: 'audio',
  compact: '720p',
  ai: 'best',
};

export default function HomeWorkspace() {
  const router = useRouter();
  const { isMobile } = useDeviceDetection();
  const { setArtifactFromFile } = useOpenedArtifact();

  const [url, setUrl] = useState<string>('');
  const [downloadMode, setDownloadMode] = useState<DownloadIntentMode>('video');
  const [inspecting, setInspecting] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [manifest, setManifest] = useState<MediaManifest | null>(null);
  const [droppedStudio, setDroppedStudio] = useState<DroppedStudioFile | null>(null);
  const [activeJob, setActiveJob] = useState<ProcessingJob | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastFailedAction, setLastFailedAction] = useState<FailedAction | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const consumedQueryUrlRef = useRef(false);

  useEffect(() => {
    return () => {
      uploadAbortRef.current?.abort();
    };
  }, []);

  const inspectTargetUrl = useCallback(
    async (targetUrl: string) => {
      let trimmed = targetUrl.trim();
      const embeddedUrlMatch = trimmed.match(/https?:\/\/[^\s"'<>]+/i);
      if (embeddedUrlMatch && (/\s/.test(trimmed) || !/^https?:\/\//i.test(trimmed))) {
        trimmed = embeddedUrlMatch[0];
      }
      if (!trimmed) {
        setErrorMessage('Please paste a valid media link to continue.');
        setLastFailedAction(null);
        return;
      }

      if (!/^https?:\/\//i.test(trimmed)) {
        trimmed = `https://${trimmed}`;
      }
      setUrl(trimmed);

      setInspecting(true);
      setErrorMessage(null);
      setUploadNotice(null);
      setDroppedStudio(null);
      setLastFailedAction(null);
      setActiveJob(null);

      try {
        const data = await api.probeUrl(trimmed);
        setManifest(data);
      } catch (err: unknown) {
        let message = err instanceof Error ? err.message : '';
        const errCode = String((err as any)?.code || '').toUpperCase();
        const errStatus = (err as any)?.status;
        if (errCode === 'ERR_BACKEND_NOT_CONFIGURED' || errStatus === 503) {
          message = 'Media worker is offline. Configure a custom worker in Settings or use browser Studio tools.';
        } else if (errCode === 'HOST_BLOCKED' || errStatus === 'host_restricted') {
          message = isMobile
            ? 'This host challenged the server IP. Connect a custom worker in Settings to process this link.'
            : 'This host challenged extraction. Connect a custom worker or retry shortly.';
        } else if (!message || message.includes('[object Object]')) {
          message = 'Could not analyze that link. Check the URL and try again.';
        }
        setErrorMessage(message);
        setLastFailedAction({ type: 'url', url: trimmed });
      } finally {
        setInspecting(false);
      }
    },
    [isMobile]
  );

  const runLocalFileInspect = useCallback(async (file: File) => {
    const maxSizeBytes = 2 * 1024 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      setErrorMessage('File exceeds the 2 GB browser limit. Please select a smaller file.');
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
    setDroppedStudio(null);
    setLastFailedAction(null);
    setManifest(null);
    setActiveJob(null);

    try {
      const data = await api.uploadLocalFile(file, {
        onProgress: (pct) => setUploadProgress(pct),
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;
      setManifest(data);
      if (data.id && data.id.startsWith('local_')) {
        setUploadNotice('Loaded locally in your browser with zero server upload.');
      }
    } catch (err: unknown) {
      if (isAbortError(err) || controller.signal.aborted) {
        setUploadNotice('Upload cancelled.');
        return;
      }
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Could not load that file. Please try again.';
      setErrorMessage(message);
      setLastFailedAction({ type: 'file', file });
    } finally {
      setUploading(false);
      setUploadProgress(null);
      if (uploadAbortRef.current === controller) {
        uploadAbortRef.current = null;
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, []);

  const handleFileUpload = useCallback(
    async (file: File) => {
      const studioMatch = classifyDroppedStudioFile(file);
      if (studioMatch) {
        setErrorMessage(null);
        setUploadNotice(null);
        setManifest(null);
        setActiveJob(null);
        const artifactDomain = studioMatch.domain === 'image' ? 'pdf' : studioMatch.domain;
        setArtifactFromFile(file, artifactDomain, '/');
        setDroppedStudio(studioMatch);
        return;
      }

      await runLocalFileInspect(file);
    },
    [runLocalFileInspect, setArtifactFromFile]
  );

  useEffect(() => {
    if (consumedQueryUrlRef.current || typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const paramUrl = (sp.get('url') || '').trim();
    if (paramUrl) {
      consumedQueryUrlRef.current = true;
      void inspectTargetUrl(paramUrl);
    }
  }, [inspectTargetUrl]);

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

  const uploadScale = uploadProgress !== null ? uploadProgress / 100 : 0;

  return (
    <div className="max-w-3xl mx-auto">
      {activeJob ? (
        <div key="stage-job" className="muxaro-stage-enter">
          <JobProgress
            initialJob={activeJob}
            onJobUpdate={setActiveJob}
            sourceUrl={activeJob.sourceUrl || url || manifest?.sourceUrl}
            manifest={manifest}
            onDismiss={() => {
              setActiveJob(null);
              setManifest(null);
              setUrl('');
              setErrorMessage(null);
              setLastFailedAction(null);
            }}
          />
        </div>
      ) : manifest ? (
        <div key="stage-result" className="muxaro-stage-enter">
          <AdaptiveMediaCard
            manifest={manifest}
            initialPreset={PRESET_BY_MODE[downloadMode]}
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
        </div>
      ) : droppedStudio ? (
        <div key="stage-studio-route" className="muxaro-stage-enter rounded-2xl border border-line bg-surface p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-line">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl border border-line bg-surface-elevated flex items-center justify-center text-brand shrink-0">
                {droppedStudio.domain === 'pdf' ? (
                  <FileText className="w-5 h-5" aria-hidden="true" />
                ) : droppedStudio.domain === 'audio' ? (
                  <Music className="w-5 h-5" aria-hidden="true" />
                ) : droppedStudio.domain === 'image' ? (
                  <ImageIcon className="w-5 h-5" aria-hidden="true" />
                ) : (
                  <Film className="w-5 h-5" aria-hidden="true" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-content truncate">
                  {droppedStudio.file.name}
                </p>
                <p className="text-xs text-content-secondary font-mono tabular-nums">
                  {formatBytes(droppedStudio.file.size)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-line bg-surface-elevated text-[11px] font-medium text-content-secondary">
                <ShieldCheck className="w-3.5 h-3.5 text-success" aria-hidden="true" />
                <span>0 bytes uploaded</span>
              </span>
              <button
                type="button"
                onClick={() => setDroppedStudio(null)}
                className="p-1.5 rounded-lg border border-line text-content-secondary hover:text-content"
                aria-label="Choose another file"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {droppedStudio.routes.map((route) => (
              <Link
                key={route.href}
                href={route.href}
                onClick={() => {
                  recordRecentTool(route.href.split('?')[0]);
                }}
                className="p-3.5 rounded-xl border border-line bg-surface-elevated hover:border-brand/50 hover:bg-surface transition-colors flex items-center justify-between gap-2 group"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-content group-hover:text-brand truncate">
                    {route.label}
                  </div>
                  <div className="text-[11px] text-content-secondary truncate mt-0.5">
                    {route.note}
                  </div>
                </div>
                <ArrowUpRight className="w-3.5 h-3.5 text-content-tertiary group-hover:text-brand shrink-0" aria-hidden="true" />
              </Link>
            ))}
          </div>

          <div className="pt-2 border-t border-line flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={`/ai?prompt=${encodeURIComponent(`Help me work on ${droppedStudio.file.name}`)}`}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand text-brand-fg font-semibold hover:bg-brand-hover transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Ask AI about this file</span>
              </Link>
              <Link
                href={droppedStudio.browseHref}
                className="font-semibold text-brand hover:underline inline-flex items-center gap-1"
              >
                <span>{droppedStudio.browseLabel}</span>
                <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
            </div>
            {(droppedStudio.domain === 'video' || droppedStudio.domain === 'audio') && (
              <button
                type="button"
                onClick={() => void runLocalFileInspect(droppedStudio.file)}
                className="font-medium text-content-secondary hover:text-content underline whitespace-nowrap"
              >
                Inspect streams here
              </button>
            )}
          </div>
        </div>
      ) : (
        <div
          key="stage-omnibox"
          data-dropzone="true"
          onDragOver={(e) => {
            e.preventDefault();
            if (!uploading) setIsDragging(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
              setIsDragging(false);
            }
          }}
          onDrop={handleDrop}
          className={`muxaro-stage-enter relative rounded-2xl transition-[box-shadow] duration-150 ${
            isDragging ? 'ring-2 ring-brand/40 bg-surface/50' : ''
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,audio/*,image/*,.mp4,.mkv,.webm,.mov,.avi,.mp3,.flac,.wav,.m4a,.opus,.ogg,.pdf,.docx,.pptx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileUpload(file);
            }}
          />

          {isDragging && (
            <div className="absolute inset-0 z-20 rounded-xl bg-surface/95 border-2 border-dashed border-brand flex flex-col items-center justify-center gap-1 pointer-events-none">
              <UploadCloud className="w-6 h-6 text-brand" aria-hidden="true" />
              <p className="text-xs font-semibold text-content">
                Drop video, audio, or PDF to route locally
              </p>
            </div>
          )}

          {uploading ? (
            <div className="rounded-xl border border-line bg-surface p-5">
              <div className="space-y-3 max-w-md mx-auto">
                <div className="flex items-center justify-center gap-2 text-sm font-medium text-content">
                  <Loader2 className="w-4 h-4 text-brand motion-safe:animate-spin shrink-0" aria-hidden="true" />
                  <span className="truncate">{selectedFileName || 'Loading file…'}</span>
                </div>

                <div className="w-full h-1.5 rounded-full bg-surface-elevated border border-line overflow-hidden">
                  {uploadProgress !== null ? (
                    <div
                      className="h-full w-full bg-brand origin-left transition-transform duration-150"
                      style={{ transform: `scaleX(${Math.max(0.02, Math.min(1, uploadScale))})` }}
                    />
                  ) : (
                    <div className="h-full w-1/3 rounded-full bg-brand animate-indeterminate-shimmer" />
                  )}
                </div>

                <div className="flex items-center justify-between text-xs text-content-secondary tabular-nums">
                  <span>{uploadProgress !== null ? `${uploadProgress}% loaded` : 'Inspecting streams…'}</span>
                  <button
                    type="button"
                    onClick={handleCancelUpload}
                    className="inline-flex items-center gap-1 font-medium text-content hover:text-error"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Cancel</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <HeroOmnibox
              url={url}
              mode={downloadMode}
              onModeChange={setDownloadMode}
              onUrlChange={(next) => {
                setUrl(next);
                setErrorMessage(null);
              }}
              onSubmit={(targetUrl) => {
                const cleaned = targetUrl.trim();
                const looksLikeUrl =
                  /^https?:\/\//i.test(cleaned) ||
                  (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/:?#].*)?$/i.test(cleaned) && !/\s/.test(cleaned));
                if (downloadMode === 'ai' || (!looksLikeUrl && cleaned.length > 0)) {
                  router.push(cleaned ? `/ai?prompt=${encodeURIComponent(cleaned)}` : '/ai');
                  return;
                }
                void inspectTargetUrl(targetUrl);
              }}
              onFileDropClick={() => fileInputRef.current?.click()}
              uploadingFile={uploading}
              probing={inspecting}
            />
          )}
        </div>
      )}

      {uploadNotice && !errorMessage && (
        <div
          role="status"
          className="mt-4 rounded-xl border border-line bg-surface px-4 py-3 text-xs text-content-secondary flex items-center justify-between gap-3"
        >
          <span>{uploadNotice}</span>
          <button
            type="button"
            onClick={() => setUploadNotice(null)}
            className="text-content-muted hover:text-content p-1"
            aria-label="Dismiss notice"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-error/25 bg-error-bg px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 text-sm text-error min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRetryLastAction}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-line text-xs font-semibold text-content hover:border-line-hover"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Try again</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                setLastFailedAction(null);
              }}
              aria-label="Dismiss error"
              className="p-1.5 rounded-lg text-error/80 hover:text-error"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
