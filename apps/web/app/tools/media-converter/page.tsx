'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  ShieldCheck,
  AlertCircle,
  FileVideo,
  UploadCloud,
  Download,
  Zap,
  Clock,
  Cpu,
  Layers,
  X,
  RotateCcw,
  Check,
} from 'lucide-react';
import { useFFmpegWorker, ContainerFormat } from '@/lib/ffmpeg';
import { formatBytes } from '@/lib/formatters';

interface ContainerOption {
  id: ContainerFormat;
  label: string;
  tag: string;
  description: string;
  compatibleWith: string;
}

const CONTAINER_OPTIONS: ContainerOption[] = [
  {
    id: 'mp4',
    label: 'MP4',
    tag: 'Universal',
    description: 'Plays natively across iOS, Android, web browsers, and smart TVs.',
    compatibleWith: 'H.264 / HEVC / AAC / MP3',
  },
  {
    id: 'mkv',
    label: 'MKV',
    tag: 'Matroska',
    description: 'High-fidelity container preserving all audio streams and subtitles.',
    compatibleWith: 'All modern video and audio tracks',
  },
  {
    id: 'webm',
    label: 'WebM',
    tag: 'Open Web',
    description: 'Modern royalty-free web format optimized for HTML5 browsers.',
    compatibleWith: 'VP8 / VP9 / AV1 / Opus / Vorbis',
  },
  {
    id: 'mov',
    label: 'MOV',
    tag: 'QuickTime',
    description: 'Apple QuickTime container designed for macOS, iOS, and Final Cut.',
    compatibleWith: 'ProRes / H.264 / HEVC / AAC',
  },
];

export default function MediaConverterPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [targetContainer, setTargetContainer] = useState<ContainerFormat>('mp4');
  const [streamCopy, setStreamCopy] = useState<boolean>(true);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    isReady,
    isLoading: isEngineLoading,
    isProcessing,
    progress,
    error: workerError,
    result,
    convert,
    cancel,
    reset,
  } = useFFmpegWorker();

  // Manage elapsed processing time
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isProcessing && startTime) {
      interval = setInterval(() => {
        setElapsedTime((Date.now() - startTime) / 1000);
      }, 100);
    } else if (!isProcessing && startTime && result) {
      setElapsedTime(result.elapsedMs / 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isProcessing, startTime, result]);

  const validateAndSetFile = (file: File) => {
    reset();
    setSelectedFile(file);
    setStartTime(null);
    setElapsedTime(0);

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'mp4') {
      setTargetContainer('mkv');
    } else {
      setTargetContainer('mp4');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      validateAndSetFile(files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      validateAndSetFile(files[0]);
    }
  };

  const handleConvert = async () => {
    if (!selectedFile) return;
    setStartTime(Date.now());
    setElapsedTime(0);
    try {
      await convert({
        file: selectedFile,
        fileName: selectedFile.name,
        targetContainer,
        streamCopy,
      });
    } catch (err) {
      console.error('[MediaConverterPage] Conversion failed:', err);
    }
  };

  const handleCancel = () => {
    cancel();
    setStartTime(null);
  };

  const handleReset = () => {
    reset();
    setSelectedFile(null);
    setStartTime(null);
    setElapsedTime(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const detectedInputExt = selectedFile?.name.split('.').pop()?.toUpperCase() || '';

  return (
    <div className="w-full">
      {/* Header Bar */}
      <section className="muxaro-hero-surface border-b border-line">
        <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          <div className="flex flex-wrap items-center gap-4 mb-6 text-sm">
            <Link
              href="/tools"
              className="inline-flex items-center gap-1.5 font-medium text-content-secondary hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md px-1"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>All tools</span>
            </Link>
            <Link
              href="/"
              className="font-medium text-content-secondary hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md px-1"
            >
              Home workspace
            </Link>
          </div>

          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-elevated border border-line text-xs font-medium text-content-secondary mb-4 shadow-xs">
              <Zap className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
              <span>In-browser WebAssembly engine</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-zinc-900 dark:text-zinc-100 tracking-tight overflow-wrap-break-word">
              Convert video containers locally
            </h1>
            <p className="text-base text-zinc-600 dark:text-zinc-400 mt-3 leading-relaxed">
              Switch seamlessly between MP4, MKV, WebM, and MOV containers. Lossless stream copy (-c copy) finishes in 2–5 seconds with zero server uploads and zero cloud cost.
            </p>
          </div>
        </div>
      </section>

      {/* Main Content Area */}
      <section className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Interaction Column */}
          <div className="lg:col-span-2 space-y-6">
            <div className="muxaro-media-card p-6 sm:p-8">
              {/* Step 1: File Dropzone / Picker */}
              {!selectedFile ? (
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/*,.mp4,.mkv,.webm,.mov,.avi,.flv,.ts,.m4v,.wmv"
                    className="sr-only"
                    id="video-file-input"
                    onChange={handleFileSelect}
                  />
                  <label
                    htmlFor="video-file-input"
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`block w-full p-8 sm:p-12 text-center rounded-2xl border-2 border-dashed transition-colors cursor-pointer focus-within:ring-2 focus-within:ring-brand ${
                      isDragging
                        ? 'border-brand bg-surface-elevated'
                        : 'border-line hover:border-zinc-400 dark:hover:border-zinc-600 bg-surface'
                    }`}
                  >
                    <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-surface-elevated border border-line flex items-center justify-center text-content shadow-xs">
                      <UploadCloud className="w-7 h-7 text-brand" aria-hidden="true" />
                    </div>
                    <span className="block text-base font-semibold text-zinc-900 dark:text-zinc-100">
                      Drop your video file here, or browse
                    </span>
                    <span className="block text-sm text-zinc-600 dark:text-zinc-400 mt-1.5">
                      Supports MP4, MKV, WebM, MOV, AVI, TS, and FLV files up to 2 GB
                    </span>
                    <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-content-secondary">
                      <span className="px-2.5 py-1 rounded-md bg-surface-elevated border border-line">
                        Lossless bitstream copy
                      </span>
                      <span className="px-2.5 py-1 rounded-md bg-surface-elevated border border-line">
                        100% private in browser
                      </span>
                      <span className="px-2.5 py-1 rounded-md bg-surface-elevated border border-line">
                        $0 server cost
                      </span>
                    </div>
                  </label>
                </div>
              ) : (
                /* Selected File Card */
                <div className="space-y-6">
                  <div className="p-4 sm:p-5 rounded-2xl bg-surface-elevated border border-line flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-11 h-11 rounded-xl bg-surface border border-line flex items-center justify-center shrink-0 text-brand shadow-xs">
                        <FileVideo className="w-5 h-5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                          {selectedFile.name}
                        </p>
                        <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                          {formatBytes(selectedFile.size)} · Source: {detectedInputExt || 'Video'}
                        </p>
                      </div>
                    </div>

                    {!isProcessing && (
                      <button
                        type="button"
                        onClick={handleReset}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line bg-surface text-xs font-medium text-content-secondary hover:text-content hover:bg-surface-elevated transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Change file</span>
                      </button>
                    )}
                  </div>

                  {/* Step 2: Target Container Selection */}
                  {!result && (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
                          Target container format
                        </label>
                        <p className="text-xs text-zinc-600 dark:text-zinc-400">
                          Select the destination wrapper format for your video bitstreams.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {CONTAINER_OPTIONS.map((opt) => {
                          const isSelected = targetContainer === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              disabled={isProcessing}
                              onClick={() => setTargetContainer(opt.id)}
                              className={`p-4 rounded-xl border text-left transition-colors relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                                isSelected
                                  ? 'border-brand bg-surface-elevated shadow-xs'
                                  : 'border-line bg-surface hover:bg-surface-elevated'
                              } disabled:opacity-50`}
                            >
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                                    {opt.label}
                                  </span>
                                  <span className="text-xs px-2 py-0.5 rounded-md bg-surface border border-line font-medium text-content-secondary">
                                    {opt.tag}
                                  </span>
                                </div>
                                {isSelected && (
                                  <div className="w-5 h-5 rounded-full bg-brand text-white flex items-center justify-center shrink-0">
                                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                                  </div>
                                )}
                              </div>
                              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-normal">
                                {opt.description}
                              </p>
                            </button>
                          );
                        })}
                      </div>

                      {/* Stream Copy Switch */}
                      <div className="p-4 rounded-xl bg-surface border border-line">
                        <label className="flex items-start gap-3 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={streamCopy}
                            disabled={isProcessing}
                            onChange={(e) => setStreamCopy(e.target.checked)}
                            className="mt-1 w-4 h-4 rounded border-line text-brand focus-visible:ring-brand focus-visible:ring-offset-0"
                          />
                          <div>
                            <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                              Lossless Stream Copy (-c copy) · 2–5 seconds
                            </span>
                            <span className="block text-xs text-zinc-600 dark:text-zinc-400 mt-0.5 leading-relaxed">
                              Copies video and audio frames directly without re-encoding. 100% original quality, zero generational loss, and finishes almost instantly.
                            </span>
                          </div>
                        </label>
                      </div>

                      {/* Action Button */}
                      {!isProcessing && (
                        <div className="pt-2 flex flex-wrap items-center gap-4">
                          <button
                            type="button"
                            onClick={handleConvert}
                            disabled={isEngineLoading}
                            className="px-6 py-3 rounded-full bg-brand text-white text-sm font-semibold hover:opacity-95 active:scale-[0.99] transition-transform shadow-xs disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 min-h-[44px]"
                          >
                            {isEngineLoading
                              ? 'Loading FFmpeg engine…'
                              : `Convert to ${targetContainer.toUpperCase()}`}
                          </button>
                          <span className="text-xs text-zinc-600 dark:text-zinc-400">
                            Local WebAssembly execution · Zero cloud round-trips
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Processing State */}
                  {isProcessing && (
                    <div className="p-6 rounded-2xl bg-surface border border-line space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <RefreshCw className="w-4 h-4 text-brand animate-spin" aria-hidden="true" />
                          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            Remuxing to {targetContainer.toUpperCase()}…
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs font-mono text-zinc-600 dark:text-zinc-400">
                          {progress.speed && <span>{progress.speed}</span>}
                          <span>{elapsedTime.toFixed(1)}s elapsed</span>
                        </div>
                      </div>

                      {/* Progress Bar (scaleX to avoid Hallmark transition: width violation) */}
                      <div className="w-full bg-surface-elevated rounded-full h-2.5 overflow-hidden border border-line">
                        <div
                          className="h-full bg-brand rounded-full"
                          style={{
                            transform: `scaleX(${Math.max(0.04, Math.min(1, progress.percent / 100))})`,
                            transformOrigin: 'left',
                            transition: 'transform 150ms ease-out',
                          }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-xs text-content-secondary">
                        <span>
                          {progress.message || (streamCopy ? 'Executing lossless stream copy…' : 'Processing media streams…')}
                        </span>
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {Math.max(0, Math.min(100, Math.round(progress.percent)))}%
                        </span>
                      </div>

                      <div className="pt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={handleCancel}
                          className="px-4 py-2 rounded-lg border border-line bg-surface text-xs font-semibold text-content-secondary hover:text-content hover:bg-surface-elevated transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand min-h-[44px]"
                        >
                          Cancel conversion
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Step 3: Success & Download Card */}
                  {result && (
                    <div className="p-6 sm:p-8 rounded-2xl bg-surface border border-line space-y-6">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center shrink-0 text-emerald-600 dark:text-emerald-400 shadow-xs">
                          <CheckCircle2 className="w-6 h-6" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                            Conversion complete
                          </h2>
                          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                            Your video was converted in {elapsedTime.toFixed(1)}s using {result.isStreamCopy ? 'lossless stream copy' : 'high-efficiency transcode'}.
                          </p>
                        </div>
                      </div>

                      {/* File Details Summary */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl bg-surface-elevated border border-line text-xs">
                        <div>
                          <span className="block text-content-secondary">Output file</span>
                          <span className="block font-semibold text-zinc-900 dark:text-zinc-100 truncate mt-0.5" title={result.fileName}>
                            {result.fileName}
                          </span>
                        </div>
                        <div>
                          <span className="block text-content-secondary">Output size</span>
                          <span className="block font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">
                            {formatBytes(result.sizeBytes)}
                          </span>
                        </div>
                        <div>
                          <span className="block text-content-secondary">Elapsed time</span>
                          <span className="block font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">
                            {elapsedTime.toFixed(1)}s
                          </span>
                        </div>
                        <div>
                          <span className="block text-content-secondary">Strategy</span>
                          <span className="block font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">
                            {result.isStreamCopy ? 'Stream Copy' : 'Transcode'}
                          </span>
                        </div>
                      </div>

                      {/* Optional In-Browser Preview if supported */}
                      {(targetContainer === 'mp4' || targetContainer === 'webm') && (
                        <div className="space-y-2">
                          <span className="block text-xs font-medium text-content-secondary">
                            Instant playback preview
                          </span>
                          <video
                            src={result.url}
                            controls
                            playsInline
                            className="w-full max-h-72 rounded-xl bg-black border border-line"
                          />
                        </div>
                      )}

                      {/* Download & Reset Action Buttons */}
                      <div className="flex flex-wrap items-center gap-3 pt-2">
                        <a
                          href={result.url}
                          download={result.fileName}
                          className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-brand text-white text-sm font-semibold hover:opacity-95 active:scale-[0.99] transition-transform shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 min-h-[44px]"
                        >
                          <Download className="w-4 h-4" aria-hidden="true" />
                          <span>Download {result.fileName}</span>
                        </a>

                        <button
                          type="button"
                          onClick={handleReset}
                          className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full border border-line bg-surface text-sm font-semibold text-content hover:bg-surface-elevated transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand min-h-[44px]"
                        >
                          <RotateCcw className="w-4 h-4" aria-hidden="true" />
                          <span>Convert another file</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Error State */}
                  {workerError && (
                    <div
                      role="alert"
                      className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <AlertCircle className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
                        <span className="truncate">{workerError}</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleConvert}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-700 bg-surface text-red-700 dark:text-red-300 text-xs font-semibold hover:bg-surface-elevated transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand min-h-[44px]"
                      >
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Retry</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Sidebar / Technical Guarantees Column */}
          <aside className="space-y-4">
            <div className="muxaro-media-card p-6 space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                <Zap className="w-4 h-4 text-brand" aria-hidden="true" />
                <span>Stream copy advantages</span>
              </div>
              <ul className="space-y-3.5 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                <li className="flex items-start gap-2.5">
                  <CheckCircle2
                    className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>
                    <strong className="text-zinc-900 dark:text-zinc-100 font-semibold">2–5 second remuxing:</strong> Bypasses CPU-heavy decoding and encoding by transferring compressed packets directly into the new container.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2
                    className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>
                    <strong className="text-zinc-900 dark:text-zinc-100 font-semibold">Zero quality loss:</strong> Retains 100% of the original video bitrate, HDR color metadata, and multi-channel audio tracks without generational degradation.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2
                    className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>
                    <strong className="text-zinc-900 dark:text-zinc-100 font-semibold">Smart fallback:</strong> If the destination container requires AAC audio (e.g. MP4 with Opus input), the video stream is copied losslessly while only audio is adapted.
                  </span>
                </li>
              </ul>
            </div>

            <div className="muxaro-media-card p-6 space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                <ShieldCheck className="w-4 h-4 text-brand" aria-hidden="true" />
                <span>100% Client-Side Privacy</span>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                All media processing takes place directly in your browser using WebAssembly. Your files are never uploaded to any server or cloud storage, guaranteeing complete confidentiality at $0 cost.
              </p>
            </div>

            <div className="muxaro-media-card p-6 space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                <Cpu className="w-4 h-4 text-brand" aria-hidden="true" />
                <span>Format Compatibility Guide</span>
              </div>
              <div className="space-y-2.5 text-xs text-zinc-600 dark:text-zinc-400">
                <div>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">MP4:</span> Best for sharing on social platforms, web video players, iPhone, and Android.
                </div>
                <div>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">MKV:</span> Ideal for archiving, high-quality audio files, and multi-language subtitle tracks.
                </div>
                <div>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">WebM:</span> Lightweight open standard for Chrome, Firefox, and embedded web applications.
                </div>
                <div>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">MOV:</span> Seamless compatibility with macOS QuickTime Player, iOS Photos, and Final Cut Pro.
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
