'use client';

/**
 * Project MUXARO - Convert Video Tool Component
 * Supports MP4, MKV, WebM, MOV with:
 * - Real-time Lossless Remux / Stream Copy detection indicator
 * - Integrated Eco Mode toggle (energy savings & carbon reduction)
 * - Dual input: URL inspection or 4GB Resumable Multipart Local Upload
 * - Real-time SSE stage & progress tracking with ETA
 * - Conforms to Hallmark design standards (tokenized, no blanket all-property transitions)
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  Film,
  Zap,
  Leaf,
  UploadCloud,
  Link2,
  CheckCircle2,
  AlertCircle,
  Clock,
  RotateCcw,
  Download,
  Sliders,
  Play,
  Pause,
  X,
  Layers,
  ArrowRight,
  Search,
} from 'lucide-react';
import { api, extractDisplayError, getApiBaseUrl } from '@/lib/api-client';
import TurnstileChallenge from '@/components/TurnstileChallenge';
import { isNativeAppRuntime } from '@/lib/native-bridge';
import CommandPreviewDrawer from '@/components/tools/CommandPreviewDrawer';
import { useEcoStore } from '@/lib/eco-store';
import { useJobStream } from '@/hooks/use-job-stream';
import { ResumableMultipartUploader, MultipartUploadStats } from '@/lib/multipart-uploader';
import { FFmpegWorkerClient } from '@/lib/ffmpeg/ffmpeg-client';
import type { FFmpegProgress, FFmpegTaskResult } from '@/lib/ffmpeg/types';
import { normalizeMediaUrl, sanitizeSafeNavigationUrl, generateSecureId } from '@/lib/url-utils';

export type VideoContainer = string;
export type VideoCodec = 'copy' | 'h264' | 'hevc' | 'vp9' | 'av1';
export type Resolution = 'source' | '4320p' | '2160p' | '1440p' | '1080p' | '720p' | '480p';

interface FormatCatalogItem {
  ext: string;
  name: string;
  category: string;
  type: 'video' | 'audio' | 'image';
  streamCopy: boolean;
}

const FALLBACK_FORMATS: FormatCatalogItem[] = [
  { ext: 'mp4', name: 'MP4 (MPEG-4 Part 14)', category: 'Popular Video', type: 'video', streamCopy: true },
  { ext: 'mkv', name: 'MKV (Matroska)', category: 'Popular Video', type: 'video', streamCopy: true },
  { ext: 'webm', name: 'WebM (VP9 / Opus)', category: 'Popular Video', type: 'video', streamCopy: true },
  { ext: 'mov', name: 'MOV (QuickTime)', category: 'Popular Video', type: 'video', streamCopy: true },
  { ext: 'avi', name: 'AVI (Audio Video Interleave)', category: 'Popular Video', type: 'video', streamCopy: true },
  { ext: 'flv', name: 'FLV (Flash Video)', category: 'Popular Video', type: 'video', streamCopy: false },
  { ext: 'wmv', name: 'WMV (Windows Media)', category: 'Popular Video', type: 'video', streamCopy: false },
  { ext: 'ts', name: 'MPEG-TS', category: 'Broadcast & Streaming', type: 'video', streamCopy: true },
  { ext: 'gif', name: 'GIF (Animated)', category: 'Animated & Visual', type: 'video', streamCopy: false },
  { ext: 'mp3', name: 'MP3 Audio', category: 'Popular Audio', type: 'audio', streamCopy: false },
  { ext: 'flac', name: 'FLAC Lossless', category: 'Lossless & Studio Audio', type: 'audio', streamCopy: false },
  { ext: 'wav', name: 'WAV PCM', category: 'Lossless & Studio Audio', type: 'audio', streamCopy: false },
  { ext: 'm4a', name: 'M4A AAC', category: 'Popular Audio', type: 'audio', streamCopy: true },
  { ext: 'opus', name: 'Opus Audio', category: 'Popular Audio', type: 'audio', streamCopy: true },
  { ext: 'ogg', name: 'OGG Vorbis', category: 'Popular Audio', type: 'audio', streamCopy: false },
];

// Keep proxied multipart chunks comfortably under Vercel's 4.5 MB request body ceiling
const SAFE_CHUNK_SIZE_BYTES = Math.floor(3.5 * 1024 * 1024);

function isBackendDisconnectedMessage(message: string): boolean {
  return (
    message.includes('ERR_BACKEND_NOT_CONFIGURED') ||
    message.includes('503') ||
    message.toLowerCase().includes('backend not configured')
  );
}

export function ConvertTool() {
  const { settings: ecoSettings, toggleEco, recordSavedJob } = useEcoStore();

  const [inputMode, setInputMode] = useState<'url' | 'file'>('url');
  const [urlInput, setUrlInput] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedAssetId, setUploadedAssetId] = useState<string | null>(null);

  // Target Settings
  const [targetContainer, setTargetContainer] = useState<VideoContainer>('mp4');
  const [formatCatalog, setFormatCatalog] = useState<FormatCatalogItem[]>(FALLBACK_FORMATS);
  const [formatSearch, setFormatSearch] = useState<string>('');
  const [formatCategory, setFormatCategory] = useState<string>('All');
  const [videoCodec, setVideoCodec] = useState<VideoCodec>('copy');
  const [resolution, setResolution] = useState<Resolution>('source');
  const [qualityPreset, setQualityPreset] = useState<'fast' | 'balanced' | 'high'>('balanced');
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const preset = (sp.get('preset') || '').toLowerCase();
    if (preset === 'mkv-to-mp4' || preset === 'remux') {
      setInputMode('file');
      setTargetContainer('mp4');
      setVideoCodec('copy');
    } else if (preset === 'whatsapp-mp4') {
      setTargetContainer('mp4');
      setVideoCodec('h264');
      setResolution('720p');
    } else if (preset === 'prores' || preset === 'edit-ready') {
      setTargetContainer('mov');
      setShowAdvanced(true);
    }
  }, []);

  useEffect(() => {
    const hasCustomWorker =
      typeof window !== 'undefined' && Boolean(window.localStorage.getItem('muxaro_custom_worker_url')?.trim());
    const hasPublicApi = Boolean(process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_VERIFIED_API_URL);
    if (!hasCustomWorker && !hasPublicApi) return;

    let active = true;
    const base = getApiBaseUrl().replace(/\/+$/, '');
    fetch(`${base}/formats`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (active && json?.data && Array.isArray(json.data) && json.data.length > 0) {
          setFormatCatalog(json.data);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const formatCategories = useMemo(() => {
    const cats = new Set<string>(['All']);
    for (const item of formatCatalog) cats.add(item.category);
    return Array.from(cats);
  }, [formatCatalog]);

  const filteredFormats = useMemo(() => {
    const q = formatSearch.trim().toLowerCase();
    return formatCatalog.filter((item) => {
      if (formatCategory !== 'All' && item.category !== formatCategory) return false;
      if (!q) return true;
      return (
        item.ext.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [formatCatalog, formatCategory, formatSearch]);

  const selectedFormatSpec = useMemo(() => {
    return formatCatalog.find((f) => f.ext === targetContainer) || FALLBACK_FORMATS[0];
  }, [formatCatalog, targetContainer]);

  // Local Upload State
  const [uploader, setUploader] = useState<ResumableMultipartUploader | null>(null);
  const [uploadStats, setUploadStats] = useState<MultipartUploadStats | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Local Browser FFmpeg WASM Fallback State
  const [isLocalProcessing, setIsLocalProcessing] = useState<boolean>(false);
  const [localProgress, setLocalProgress] = useState<FFmpegProgress | null>(null);
  const [localResult, setLocalResult] = useState<FFmpegTaskResult | null>(null);

  // Job Submission & Streaming
  const [submittedJobId, setSubmittedJobId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string>('');
  const [backendDisconnected, setBackendDisconnected] = useState<boolean>(false);

  useEffect(() => {
    if (isNativeAppRuntime()) {
      setCaptchaToken('native-local-verified');
    }
  }, []);

  const jobStream = useJobStream(submittedJobId);

  // Clean up local object URL on unmount
  useEffect(() => {
    return () => {
      if (localResult?.url) {
        URL.revokeObjectURL(localResult.url);
      }
    };
  }, [localResult?.url]);

  // When job succeeds and was stream copy, record eco savings
  useEffect(() => {
    if (jobStream.status === 'READY' && videoCodec === 'copy') {
      recordSavedJob(180);
    }
  }, [jobStream.status, videoCodec, recordSavedJob]);

  // Stream Copy / Lossless Remux Feasibility Detection
  const remuxFeasibility = useMemo(() => {
    if (selectedFormatSpec.streamCopy && selectedFormatSpec.type === 'video' && targetContainer !== 'webm') {
      return {
        feasible: true,
        reason: 'Input container streams are natively packable without re-encoding.',
        speedMultiplier: '12x faster',
        lossless: true,
      };
    }
    if (targetContainer === 'webm') {
      return {
        feasible: false,
        reason: 'Targeting WebM typically requires transcoding VP9/Opus streams.',
        speedMultiplier: '1x transcode',
        lossless: false,
      };
    }
    return {
      feasible: false,
      reason: `Converting to .${targetContainer.toUpperCase()} (${selectedFormatSpec.name}) via FFmpeg.`,
      speedMultiplier: 'FFmpeg Transcode',
      lossless: false,
    };
  }, [targetContainer, selectedFormatSpec]);

  // Keep codec in sync with Eco mode if remux is feasible
  useEffect(() => {
    if (ecoSettings.enabled && ecoSettings.preferStreamCopy && remuxFeasibility.feasible) {
      setVideoCodec('copy');
    }
  }, [ecoSettings.enabled, ecoSettings.preferStreamCopy, remuxFeasibility.feasible]);

  // Handle Local File Selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploader?.cancel().catch(() => {});
    if (localResult?.url) URL.revokeObjectURL(localResult.url);
    setLocalResult(null);
    setSelectedFile(file);
    setUploadedAssetId(null);
    setUploadStats(null);
    setErrorMessage(null);
    setBackendDisconnected(false);

    const instance = new ResumableMultipartUploader(file, {
      apiBase: getApiBaseUrl(),
      chunkSize: SAFE_CHUNK_SIZE_BYTES,
      onProgress: (stats) => {
        setUploadStats(stats);
      },
      onError: (err) => {
        const msg = err.message || 'File upload failed';
        setErrorMessage(msg);
        setBackendDisconnected(isBackendDisconnectedMessage(msg));
        setIsUploading(false);
      },
    });
    setUploader(instance);
  };

  const resolveUploadedId = (manifest: Record<string, any> | null | undefined): string => {
    const id =
      manifest?.uploadSessionId ||
      manifest?.assetId ||
      manifest?.uploadId ||
      manifest?.id;
    if (!id || typeof id !== 'string') {
      throw new Error('Upload completed without a server session or asset ID.');
    }
    return id;
  };

  const startUpload = async () => {
    if (!uploader) return;
    setIsUploading(true);
    setErrorMessage(null);
    setBackendDisconnected(false);
    try {
      const manifest = await uploader.start();
      setUploadedAssetId(resolveUploadedId(manifest));
      setIsUploading(false);
    } catch (err: any) {
      const msg = err?.message || 'Failed to upload media.';
      if (msg !== 'Upload paused or cancelled.') {
        setErrorMessage(msg);
        setBackendDisconnected(isBackendDisconnectedMessage(msg));
      }
      setIsUploading(false);
    }
  };

  const handlePauseResumeUpload = async () => {
    if (!uploader) return;
    if (uploadStats?.state === 'uploading') {
      await uploader.pause();
      setIsUploading(false);
    } else if (uploadStats?.state === 'paused') {
      setIsUploading(true);
      try {
        const manifest = await uploader.resume();
        setUploadedAssetId(resolveUploadedId(manifest));
        setIsUploading(false);
      } catch (err: any) {
        const msg = err?.message || 'Failed to resume upload.';
        if (msg !== 'Upload paused or cancelled.') {
          setErrorMessage(msg);
          setBackendDisconnected(isBackendDisconnectedMessage(msg));
        }
        setIsUploading(false);
      }
    }
  };

  const runLocalFfmpegConvert = async () => {
    if (!selectedFile) return;
    if (localResult?.url) URL.revokeObjectURL(localResult.url);
    setLocalResult(null);
    setErrorMessage(null);
    setIsLocalProcessing(true);
    setLocalProgress({ ratio: 0, percent: 0, message: 'Initializing FFmpeg Web Worker…' });
    try {
      const client = FFmpegWorkerClient.getInstance();
      const wasmContainer = ['mp4', 'mkv', 'webm', 'mov'].includes(targetContainer)
        ? (targetContainer as 'mp4' | 'mkv' | 'webm' | 'mov')
        : 'mp4';
      const result = await client.convert({
        file: selectedFile,
        fileName: selectedFile.name,
        targetContainer: wasmContainer,
        streamCopy: videoCodec === 'copy',
        videoCodec: videoCodec === 'copy' ? undefined : videoCodec,
        onProgress: (prog) => setLocalProgress(prog),
      });
      setLocalResult(result);
      if (result.isStreamCopy) recordSavedJob(120);
    } catch (err: any) {
      setErrorMessage(
        err?.message || 'Local FFmpeg WASM conversion failed for this file.'
      );
    } finally {
      setIsLocalProcessing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setBackendDisconnected(false);

    if (inputMode === 'url') {
      const trimmed = normalizeMediaUrl(urlInput);
      if (!trimmed) {
        setErrorMessage('Please enter a valid media link (YouTube, Vimeo, SoundCloud, or direct video URL).');
        return;
      }
    } else if (!uploadedAssetId) {
      setErrorMessage('Please upload your local video file before starting server conversion, or convert locally in browser.');
      return;
    }

    setIsSubmitting(true);
    try {
      const isCopy = videoCodec === 'copy' && selectedFormatSpec.streamCopy;
      const isAudioTarget = selectedFormatSpec.type === 'audio';
      const operation = isAudioTarget
        ? 'EXTRACT_AUDIO'
        : isCopy
        ? 'REMUX_STREAM_COPY'
        : 'CONVERT_FORMAT';

      const job = await api.createJob({
        sourceUrl: inputMode === 'url' ? normalizeMediaUrl(urlInput) : undefined,
        mediaAssetId: inputMode === 'file' ? uploadedAssetId! : undefined,
        uploadSessionId: inputMode === 'file' ? uploadedAssetId! : undefined,
        jobType: isAudioTarget ? 'extract_audio' : 'transcode_video',
        operation,
        targetFormat: targetContainer,
        targetVideoCodec: videoCodec === 'copy' ? undefined : videoCodec,
        targetResolution: resolution === 'source' ? undefined : resolution,
        streamCopy: isCopy,
        ecoMode: ecoSettings.enabled,
        qualityPreset,
        title: inputMode === 'file' && selectedFile ? selectedFile.name : undefined,
        captchaToken: captchaToken || undefined,
        idempotencyKey: generateSecureId('conv_'),
      });

      setSubmittedJobId(job.jobId || job.id);
    } catch (err: unknown) {
      const msg = extractDisplayError(
        err,
        'Failed to initialize conversion job. Please try again.'
      );
      setErrorMessage(msg);
      setBackendDisconnected(isBackendDisconnectedMessage(msg));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    jobStream.reset();
    uploader?.cancel().catch(() => {});
    if (localResult?.url) URL.revokeObjectURL(localResult.url);
    setLocalResult(null);
    setLocalProgress(null);
    setIsLocalProcessing(false);
    setSubmittedJobId(null);
    setUrlInput('');
    setSelectedFile(null);
    setUploadedAssetId(null);
    setUploadStats(null);
    setUploader(null);
    setIsUploading(false);
    setErrorMessage(null);
    setBackendDisconnected(false);
  };

  const jobDownloadHref = submittedJobId
    ? sanitizeSafeNavigationUrl(
        jobStream.downloadUrl ||
          `${getApiBaseUrl()}/jobs/${encodeURIComponent(submittedJobId)}/download`
      )
    : undefined;

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--muxaro-border)] pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="p-1.5 rounded-lg bg-[var(--muxaro-tag-pill-bg)] text-[var(--muxaro-indigo)]">
              <Film className="w-5 h-5" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--muxaro-text-primary)]">
              Convert Video
            </h1>
          </div>
          <p className="text-sm text-[var(--muxaro-text-secondary)]">
            High-efficiency stream conversion across MP4, MKV, WebM, and MOV containers.
          </p>
        </div>

        {/* Eco Mode Toggle Pill */}
        <button
          type="button"
          onClick={toggleEco}
          className={`inline-flex items-center gap-2.5 px-3.5 py-2 rounded-full border text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--muxaro-border-focus)] ${
            ecoSettings.enabled
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
              : 'bg-[var(--muxaro-bg-surface)] border-[var(--muxaro-border)] text-[var(--muxaro-text-tertiary)] hover:border-[var(--muxaro-border-focus)]'
          }`}
          title="Eco Mode prioritizes lossless stream copy to save computing power and carbon emissions"
        >
          <Leaf className={`w-4 h-4 ${ecoSettings.enabled ? 'text-emerald-500' : 'text-slate-400'}`} />
          <span>Eco Mode: {ecoSettings.enabled ? 'Active' : 'Off'}</span>
          {ecoSettings.enabled && (
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          )}
        </button>
      </div>

      {/* Main Conversion Panel */}
      {localResult ? (
        <div className="muxaro-card p-6 bg-[var(--muxaro-bg-surface)] border border-[var(--muxaro-border)] rounded-2xl shadow-[var(--muxaro-shadow-card)] space-y-5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
            <div>
              <h3 className="text-base font-bold text-[var(--muxaro-text-primary)]">
                Local Browser Conversion Complete
              </h3>
              <p className="text-xs text-[var(--muxaro-text-secondary)]">
                Processed in-browser via FFmpeg Web Worker ({localResult.isStreamCopy ? 'lossless remux' : 'transcode'}).
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={sanitizeSafeNavigationUrl(localResult.url) ?? '#'}
              download={localResult.fileName}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors duration-150"
            >
              <Download className="w-4 h-4" />
              <span>Download {localResult.fileName}</span>
            </a>
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] text-xs font-semibold text-[var(--muxaro-text-secondary)] hover:bg-[var(--muxaro-bg-elevated)]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Convert Another Video</span>
            </button>
          </div>
        </div>
      ) : !submittedJobId ? (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Source Input Tabs */}
          <div className="muxaro-card p-6 bg-[var(--muxaro-bg-surface)] border border-[var(--muxaro-border)] rounded-2xl shadow-[var(--muxaro-shadow-card)] space-y-5">
            <div className="flex items-center gap-2 border-b border-[var(--muxaro-border-subtle)] pb-4">
              <button
                type="button"
                onClick={() => setInputMode('url')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
                  inputMode === 'url'
                    ? 'bg-[var(--muxaro-indigo)] text-white'
                    : 'text-[var(--muxaro-text-secondary)] hover:bg-[var(--muxaro-bg-elevated)]'
                }`}
              >
                <Link2 className="w-4 h-4" />
                <span>Web Media Link</span>
              </button>
              <button
                type="button"
                onClick={() => setInputMode('file')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
                  inputMode === 'file'
                    ? 'bg-[var(--muxaro-indigo)] text-white'
                    : 'text-[var(--muxaro-text-secondary)] hover:bg-[var(--muxaro-bg-elevated)]'
                }`}
              >
                <UploadCloud className="w-4 h-4" />
                <span>Local Computer File (Up to 4GB)</span>
              </button>
            </div>

            {inputMode === 'url' ? (
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--muxaro-text-secondary)]">
                  Media Source URL
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="Paste video or direct media link…"
                    className="w-full px-4 py-3 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] text-xs sm:text-sm text-[var(--muxaro-text-primary)] placeholder-[var(--muxaro-text-tertiary)] placeholder:truncate truncate focus:border-[var(--muxaro-border-focus)] focus:bg-[var(--muxaro-bg-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--muxaro-border-focus)] transition-colors duration-150"
                  />
                  {urlInput && (
                    <button
                      type="button"
                      onClick={() => setUrlInput('')}
                      aria-label="Clear URL"
                      className="absolute right-3 top-3 text-[var(--muxaro-text-tertiary)] hover:text-[var(--muxaro-text-primary)]"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="video/*,audio/*,.mkv,.mp4,.webm,.mov,.avi"
                  className="hidden"
                />

                {!selectedFile ? (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-[var(--muxaro-border)] hover:border-[var(--muxaro-border-focus)] rounded-2xl p-8 text-center cursor-pointer bg-[var(--muxaro-bg-base)] hover:bg-[var(--muxaro-bg-surface)] transition-colors duration-150"
                  >
                    <UploadCloud className="w-10 h-10 mx-auto text-[var(--muxaro-indigo)] mb-3" />
                    <p className="text-sm font-semibold text-[var(--muxaro-text-primary)]">
                      Click to choose video or drag file here
                    </p>
                    <p className="text-xs text-[var(--muxaro-text-tertiary)] mt-1">
                      Resumable chunked upload (3.5 MB parts) or local browser FFmpeg fallback
                    </p>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <Film className="w-5 h-5 text-[var(--muxaro-indigo)] shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[var(--muxaro-text-primary)] truncate">
                            {selectedFile.name}
                          </div>
                          <div className="text-xs text-[var(--muxaro-text-tertiary)]">
                            {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
                          </div>
                        </div>
                      </div>

                      {!uploadedAssetId && (
                        <div className="flex flex-wrap items-center gap-2">
                          {isUploading || uploadStats?.state === 'paused' ? (
                            <button
                              type="button"
                              onClick={handlePauseResumeUpload}
                              className="px-3 py-1.5 rounded-lg border border-[var(--muxaro-border)] text-xs font-medium text-[var(--muxaro-text-secondary)] hover:bg-[var(--muxaro-bg-elevated)]"
                            >
                              {uploadStats?.state === 'uploading' ? (
                                <span className="flex items-center gap-1.5">
                                  <Pause className="w-3.5 h-3.5" /> Pause
                                </span>
                              ) : (
                                <span className="flex items-center gap-1.5">
                                  <Play className="w-3.5 h-3.5" /> Resume
                                </span>
                              )}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={startUpload}
                              className={`px-4 py-1.5 rounded-lg text-xs font-semibold ${
                                remuxFeasibility.feasible &&
                                videoCodec === 'copy' &&
                                selectedFile.size <= 350 * 1024 * 1024
                                  ? 'border border-[var(--muxaro-border)] text-[var(--muxaro-text-secondary)] hover:bg-[var(--muxaro-bg-elevated)]'
                                  : 'bg-[var(--muxaro-indigo)] text-white hover:opacity-95'
                              }`}
                            >
                              Upload to Cloud
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={runLocalFfmpegConvert}
                            disabled={isLocalProcessing}
                            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 ${
                              remuxFeasibility.feasible &&
                              videoCodec === 'copy' &&
                              selectedFile.size <= 350 * 1024 * 1024
                                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                : 'border border-[var(--muxaro-border)] text-[var(--muxaro-text-primary)] hover:bg-[var(--muxaro-bg-elevated)]'
                            }`}
                          >
                            {isLocalProcessing
                              ? 'Remuxing Locally…'
                              : remuxFeasibility.feasible &&
                                videoCodec === 'copy' &&
                                selectedFile.size <= 350 * 1024 * 1024
                              ? 'Instant Local Remux'
                              : 'Process in Browser'}
                          </button>
                          <button
                            type="button"
                            aria-label="Remove selected file"
                            onClick={() => {
                              uploader?.cancel().catch(() => {});
                              setUploader(null);
                              setIsUploading(false);
                              setSelectedFile(null);
                              setUploadedAssetId(null);
                              setUploadStats(null);
                            }}
                            className="p-1.5 text-slate-400 hover:text-slate-600"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      )}

                      {uploadedAssetId && (
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                          <CheckCircle2 className="w-4 h-4" /> Ready for conversion
                        </span>
                      )}
                    </div>

                    {isLocalProcessing && localProgress && (
                      <div className="space-y-1.5 pt-2">
                        <div className="flex justify-between text-xs text-[var(--muxaro-text-secondary)]">
                          <span>{localProgress.message || 'Running local FFmpeg worker…'}</span>
                          <span>{Math.round(localProgress.percent)}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className="w-full h-full bg-emerald-500 origin-left transition-transform duration-200"
                            style={{ transform: `scaleX(${Math.min(1, Math.max(0, localProgress.percent / 100))})` }}
                          />
                        </div>
                      </div>
                    )}

                    {uploadStats && !uploadedAssetId && !isLocalProcessing && (
                      <div className="space-y-1.5 pt-2">
                        <div className="flex justify-between text-xs text-[var(--muxaro-text-secondary)]">
                          <span>
                            {uploadStats.state === 'uploading'
                              ? `Uploading (${uploadStats.activeWorkers} workers)`
                              : uploadStats.state}
                          </span>
                          <span>
                            {uploadStats.percent}% • {uploadStats.mbps} MB/s • ETA: {uploadStats.etaSeconds}s
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className="w-full h-full bg-[var(--muxaro-indigo)] origin-left transition-transform duration-200"
                            style={{ transform: `scaleX(${Math.min(1, Math.max(0, uploadStats.percent / 100))})` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Conversion Configuration & Remux Detection Banner */}
          <div className="muxaro-card p-6 bg-[var(--muxaro-bg-surface)] border border-[var(--muxaro-border)] rounded-2xl shadow-[var(--muxaro-shadow-card)] space-y-6">
            <h2 className="text-base font-bold text-[var(--muxaro-text-primary)]">
              Output Container & Quality
            </h2>

            {/* Target Container Selection (100+ Video, Audio & Visual Formats) */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="block text-xs font-semibold text-[var(--muxaro-text-secondary)]">
                  Target format ({formatCatalog.length}+ supported formats) — Selected:{' '}
                  <span className="font-mono text-[var(--muxaro-text-primary)] uppercase">
                    .{targetContainer}
                  </span>
                </label>
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-[var(--muxaro-text-tertiary)] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={formatSearch}
                    onChange={(e) => setFormatSearch(e.target.value)}
                    placeholder="Search 100+ formats (mp4, flac, gif…)"
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] text-xs text-[var(--muxaro-text-primary)] focus:outline-none focus:border-[var(--muxaro-border-focus)]"
                  />
                </div>
              </div>

              {/* Category Filter Pills */}
              <div className="flex flex-wrap gap-1.5">
                {formatCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setFormatCategory(cat)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                      formatCategory === cat
                        ? 'bg-[var(--muxaro-text-primary)] text-[var(--muxaro-bg-base)] border-[var(--muxaro-text-primary)]'
                        : 'bg-[var(--muxaro-bg-base)] text-[var(--muxaro-text-secondary)] border-[var(--muxaro-border)] hover:border-[var(--muxaro-border-focus)]'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Scrollable Format Grid */}
              <div className="max-h-60 overflow-y-auto pr-1 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {filteredFormats.map((fmt) => (
                  <button
                    key={fmt.ext}
                    type="button"
                    onClick={() => setTargetContainer(fmt.ext)}
                    title={fmt.name}
                    className={`py-2 px-2.5 rounded-xl border text-left transition-colors duration-150 ${
                      targetContainer === fmt.ext
                        ? 'border-[var(--muxaro-indigo)] bg-[var(--muxaro-tag-pill-bg)] text-[var(--muxaro-indigo)]'
                        : 'border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] text-[var(--muxaro-text-secondary)] hover:border-[var(--muxaro-border-focus)]'
                    }`}
                  >
                    <div className="text-xs font-bold uppercase font-mono">.{fmt.ext}</div>
                    <div className="text-[10px] opacity-75 truncate">{fmt.name}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Lossless Remux Detection Indicator */}
            <div
              className={`p-4 rounded-xl border transition-colors duration-150 ${
                remuxFeasibility.feasible
                  ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-800 dark:text-emerald-300'
                  : 'bg-amber-500/5 border-amber-500/20 text-amber-800 dark:text-amber-300'
              }`}
            >
              <div className="flex items-start gap-3">
                {remuxFeasibility.feasible ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
                ) : (
                  <Zap className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
                )}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold">
                      {remuxFeasibility.feasible
                        ? 'Lossless Stream Copy (Remux) Feasible'
                        : 'Full Transcode Mode'}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        remuxFeasibility.feasible
                          ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                          : 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                      }`}
                    >
                      {remuxFeasibility.speedMultiplier}
                    </span>
                  </div>
                  <p className="text-xs opacity-90 leading-relaxed">
                    {remuxFeasibility.feasible
                      ? 'No re-encoding required! Video and audio bitstreams will be multiplexed into the new container with 100% mathematical fidelity and zero CPU bottleneck.'
                      : 'Audio/video codecs will be transcoded to match container constraints. Processing will consume full hardware acceleration.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Advanced Video Settings Toggle */}
            <div className="pt-2 border-t border-[var(--muxaro-border-subtle)]">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-xs font-semibold text-[var(--muxaro-indigo)] hover:underline"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>{showAdvanced ? 'Hide Advanced Stream Settings' : 'Show Advanced Stream Settings'}</span>
              </button>

              {showAdvanced && (
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-[var(--muxaro-border-subtle)]">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--muxaro-text-secondary)] mb-1">
                      Video Codec
                    </label>
                    <select
                      value={videoCodec}
                      onChange={(e) => setVideoCodec(e.target.value as VideoCodec)}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] text-xs text-[var(--muxaro-text-primary)]"
                    >
                      <option value="copy">Stream Copy (Lossless Remux)</option>
                      <option value="h264">H.264 / AVC (Broad Compatibility)</option>
                      <option value="hevc">H.265 / HEVC (High Efficiency)</option>
                      <option value="vp9">VP9 (Web Optimized)</option>
                      <option value="av1">AV1 (Next-Gen Open Standard)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[var(--muxaro-text-secondary)] mb-1">
                      Resolution
                    </label>
                    <select
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value as Resolution)}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] text-xs text-[var(--muxaro-text-primary)]"
                    >
                      <option value="source">Match Source</option>
                      <option value="4320p">8K UHD (4320p) · Local Ultra HD</option>
                      <option value="2160p">4K UHD (2160p) · Ultra HD</option>
                      <option value="1440p">2K QHD (1440p) · Cloud & Local Ready</option>
                      <option value="1080p">Full HD (1080p) · Cloud Ready</option>
                      <option value="720p">HD (720p) · Cloud Ready</option>
                      <option value="480p">SD (480p) · Cloud Ready</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[var(--muxaro-text-secondary)] mb-1">
                      Encoding Preset
                    </label>
                    <select
                      value={qualityPreset}
                      onChange={(e) => setQualityPreset(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] text-xs text-[var(--muxaro-text-primary)]"
                    >
                      <option value="fast">Fast (Lower CPU / Larger File)</option>
                      <option value="balanced">Balanced (Optimal)</option>
                      <option value="high">High Fidelity (Best Compression)</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div
              role="alert"
              className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-medium flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {backendDisconnected && selectedFile && (
                  <button
                    type="button"
                    onClick={runLocalFfmpegConvert}
                    disabled={isLocalProcessing}
                    className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                  >
                    Process Locally (FFmpeg WASM)
                  </button>
                )}
                {backendDisconnected && (
                  <Link
                    href="/settings?tab=instances"
                    className="px-3 py-1 rounded-lg border border-red-500/40 text-xs font-semibold hover:bg-red-500/10"
                  >
                    Configure Backend
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Quick 1-Click Intent Presets */}
          <div className="muxaro-card p-5 bg-[var(--muxaro-bg-surface)] border border-[var(--muxaro-border)] rounded-2xl space-y-3">
            <span className="text-xs font-semibold text-[var(--muxaro-text-secondary)]">
              1-Click Workflow Presets
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setTargetContainer('mov');
                  setVideoCodec('h264');
                  setResolution('source');
                  setQualityPreset('high');
                }}
                className="p-3 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] hover:bg-[var(--muxaro-bg-elevated)] text-left transition-colors"
              >
                <div className="text-xs font-bold text-[var(--muxaro-text-primary)]">Edit-Ready (Premiere / DaVinci)</div>
                <div className="text-[11px] text-[var(--muxaro-text-secondary)] mt-0.5">High-bitrate MOV · Source resolution</div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTargetContainer('mp4');
                  setVideoCodec('h264');
                  setResolution('1080p');
                  setQualityPreset('balanced');
                }}
                className="p-3 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] hover:bg-[var(--muxaro-bg-elevated)] text-left transition-colors"
              >
                <div className="text-xs font-bold text-[var(--muxaro-text-primary)]">Universal WhatsApp / iOS MP4</div>
                <div className="text-[11px] text-[var(--muxaro-text-secondary)] mt-0.5">H.264 + AAC · Plays on every phone</div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTargetContainer('mp4');
                  setVideoCodec('copy');
                  setResolution('source');
                }}
                className="p-3 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] hover:bg-[var(--muxaro-bg-elevated)] text-left transition-colors"
              >
                <div className="text-xs font-bold text-[var(--muxaro-text-primary)]">Instant Remux (MKV → MP4)</div>
                <div className="text-[11px] text-[var(--muxaro-text-secondary)] mt-0.5">Stream copy in ~1s · zero quality loss</div>
              </button>
            </div>
          </div>

          <CommandPreviewDrawer
            command={`ffmpeg -i input.mkv -c:v ${videoCodec === 'copy' ? 'copy' : videoCodec} ${resolution !== 'source' ? `-vf scale=-2:${resolution.replace('p', '')} ` : ''}-c:a ${videoCodec === 'copy' ? 'copy' : 'aac'} output.${targetContainer}`}
            instantBadge={videoCodec === 'copy'}
          />

          <TurnstileChallenge
            onVerify={(tok) => {
              setCaptchaToken(tok);
              setErrorMessage((prev) =>
                prev && /verification|captcha/i.test(prev) ? null : prev
              );
            }}
            onReset={() => setCaptchaToken('')}
          />

          {/* Submit Action Button */}
          <button
            type="submit"
            disabled={
              isSubmitting ||
              isLocalProcessing ||
              !captchaToken ||
              (inputMode === 'file' && !uploadedAssetId)
            }
            className="w-full py-3.5 px-6 rounded-xl bg-[var(--muxaro-indigo)] text-white font-semibold text-sm shadow-[var(--muxaro-shadow-btn)] hover:shadow-[var(--muxaro-shadow-btn-hover)] hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--muxaro-border-focus)] transition-opacity duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <span>Submitting Conversion Job…</span>
            ) : (
              <>
                <span>Start Video Conversion</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      ) : (
        /* Real-Time Processing & Completed State */
        <div className="muxaro-card p-6 bg-[var(--muxaro-bg-surface)] border border-[var(--muxaro-border)] rounded-2xl shadow-[var(--muxaro-shadow-card)] space-y-6">
          <div className="flex items-center justify-between border-b border-[var(--muxaro-border-subtle)] pb-4">
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-xl bg-[var(--muxaro-tag-pill-bg)] text-[var(--muxaro-indigo)]">
                <Film className="w-6 h-6" />
              </span>
              <div>
                <h3 className="text-base font-bold text-[var(--muxaro-text-primary)]">
                  Converting to .{targetContainer.toUpperCase()}
                </h3>
                <p className="text-xs text-[var(--muxaro-text-secondary)]">
                  Job ID: <code className="font-mono text-slate-500">{submittedJobId}</code>
                </p>
              </div>
            </div>

            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                jobStream.status === 'READY'
                  ? 'bg-emerald-500/15 text-emerald-600'
                  : jobStream.status === 'FAILED'
                  ? 'bg-red-500/15 text-red-600'
                  : 'bg-[var(--muxaro-tag-pill-bg)] text-[var(--muxaro-indigo)] animate-pulse'
              }`}
            >
              {jobStream.stage}
            </span>
          </div>

          {/* Progress Bar & Telemetry */}
          <div className="space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-[var(--muxaro-text-primary)]">
                {jobStream.stageMessage}
              </span>
              <span className="font-mono text-[var(--muxaro-text-secondary)]">
                {jobStream.progress}% | Speed: {jobStream.speed} | ETA: {jobStream.etaSeconds}s
              </span>
            </div>

            <div className="w-full h-2.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`w-full h-full origin-left transition-transform duration-300 ${
                  jobStream.status === 'FAILED'
                    ? 'bg-red-500'
                    : jobStream.status === 'READY'
                    ? 'bg-emerald-500'
                    : 'bg-[var(--muxaro-indigo)]'
                }`}
                style={{ transform: `scaleX(${Math.min(1, Math.max(0, jobStream.progress / 100))})` }}
              />
            </div>
          </div>

          {/* Error Banner */}
          {jobStream.error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-medium space-y-2">
              <div className="font-bold">Conversion Failed: {jobStream.error.code}</div>
              <div>{jobStream.error.userMessage || jobStream.error.message}</div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={jobStream.retry}
                  className="px-3 py-1 bg-red-600 text-white rounded text-xs font-semibold"
                >
                  Retry Job
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-3 py-1 rounded border border-[var(--muxaro-border)] text-xs font-semibold"
                >
                  Start Over
                </button>
              </div>
            </div>
          )}

          {/* Download & Actions when Ready */}
          {jobStream.status === 'READY' && jobDownloadHref && (
            <div className="p-6 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
                <div>
                  <h4 className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                    Video Conversion Complete!
                  </h4>
                  <p className="text-xs text-emerald-700 dark:text-emerald-400">
                    Lossless media container ready. File is available in your cloud history for 24 hours.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <a
                  href={jobDownloadHref}
                  download
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors duration-150"
                >
                  <Download className="w-4 h-4" />
                  <span>Download .{targetContainer.toUpperCase()} Video</span>
                </a>
                <Link
                  href="/downloads"
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] text-xs font-semibold text-[var(--muxaro-text-secondary)] hover:bg-[var(--muxaro-bg-elevated)]"
                >
                  <span>View in Cloud Downloads</span>
                </Link>
                <button
                  type="button"
                  onClick={handleReset}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] text-xs font-semibold text-[var(--muxaro-text-secondary)] hover:bg-[var(--muxaro-bg-elevated)]"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Convert Another Video</span>
                </button>
              </div>
            </div>
          )}

          {/* Cancel Button during active stream */}
          {!jobStream.isTerminal && (
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={jobStream.cancel}
                className="text-xs text-red-500 hover:text-red-700 font-semibold"
              >
                Cancel Conversion
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ConvertTool;
