'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Music,
  UploadCloud,
  FileVideo,
  FileAudio,
  CheckCircle2,
  AlertCircle,
  Download,
  RotateCcw,
  Sliders,
  ShieldCheck,
  Zap,
  Clock,
  HardDrive,
  X,
  Play,
  Cpu,
  Loader2,
} from 'lucide-react';
import { useFFmpegWorker } from '@/lib/ffmpeg';
import { formatBytes, formatDuration } from '@/lib/formatters';

interface FormatOption {
  value: 'native' | 'mp3' | 'aac' | 'wav' | 'flac' | 'opus';
  label: string;
  badge: string;
  badgeType: 'fast' | 'universal' | 'lossless' | 'modern';
  detail: string;
  hasBitrate?: boolean;
}

const FORMAT_OPTIONS: FormatOption[] = [
  {
    value: 'native',
    label: 'Original Stream Copy',
    badge: '1–2s · 0% Loss',
    badgeType: 'fast',
    detail: 'Lossless bitstream copy (-vn -c:a copy). No re-encoding, instant turnaround.',
  },
  {
    value: 'mp3',
    label: 'MP3 Audio',
    badge: 'Universal',
    badgeType: 'universal',
    detail: 'Compatible with every music player, smartphone, and vehicle stereo.',
    hasBitrate: true,
  },
  {
    value: 'aac',
    label: 'AAC / M4A',
    badge: 'Apple & Web',
    badgeType: 'modern',
    detail: 'High-efficiency acoustic fidelity at smaller file sizes. Ideal for iOS and Mac.',
    hasBitrate: true,
  },
  {
    value: 'wav',
    label: 'WAV PCM (16-bit)',
    badge: 'Studio Uncompressed',
    badgeType: 'lossless',
    detail: 'Uncompressed broadcast waveform standard. Pristine foundation for audio editors.',
  },
  {
    value: 'flac',
    label: 'FLAC Lossless',
    badge: 'Audiophile Master',
    badgeType: 'lossless',
    detail: 'Bit-perfect compression preserving 100% of the acoustic waveform.',
  },
  {
    value: 'opus',
    label: 'Opus Audio',
    badge: 'High Clarity',
    badgeType: 'modern',
    detail: 'Next-generation low-latency audio codec with exceptional clarity.',
  },
];

const BITRATE_OPTIONS = [
  { value: 320, label: '320 kbps', detail: 'Studio quality (Best)' },
  { value: 256, label: '256 kbps', detail: 'High quality (Standard for AAC)' },
  { value: 192, label: '192 kbps', detail: 'Balanced fidelity & size' },
  { value: 128, label: '128 kbps', detail: 'Compact size' },
];

export default function AudioExtractorPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [format, setFormat] = useState<'native' | 'mp3' | 'aac' | 'wav' | 'flac' | 'opus'>('native');
  const [bitrate, setBitrate] = useState<number>(320);
  const [localError, setLocalError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  const {
    isReady,
    isLoading,
    isProcessing,
    progress,
    error: workerError,
    result,
    extractAudio,
    cancel,
    reset,
  } = useFFmpegWorker();

  // Inspect video duration when file is selected
  useEffect(() => {
    if (!selectedFile) {
      setMediaDuration(null);
      return;
    }

    const objUrl = URL.createObjectURL(selectedFile);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      if (video.duration && !isNaN(video.duration) && isFinite(video.duration)) {
        setMediaDuration(video.duration);
      }
      URL.revokeObjectURL(objUrl);
    };
    video.onerror = () => {
      URL.revokeObjectURL(objUrl);
    };
    video.src = objUrl;

    return () => {
      URL.revokeObjectURL(objUrl);
    };
  }, [selectedFile]);

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

    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles && droppedFiles.length > 0) {
      const file = droppedFiles[0];
      handleFileSelected(file);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelected(files[0]);
    }
  };

  const handleFileSelected = (file: File) => {
    setLocalError(null);
    reset();
    setSelectedFile(file);
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setMediaDuration(null);
    setLocalError(null);
    reset();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleExtract = async () => {
    if (!selectedFile) {
      setLocalError('Please select a video file first.');
      return;
    }

    setLocalError(null);

    try {
      const isNative = format === 'native';
      await extractAudio({
        file: selectedFile,
        fileName: selectedFile.name,
        targetFormat: isNative ? 'copy' : format,
        streamCopy: isNative,
        bitrateKbps: format === 'mp3' || format === 'aac' ? bitrate : undefined,
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const msg = err instanceof Error ? err.message : 'Audio extraction failed.';
      setLocalError(msg);
    }
  };

  const currentFormatObj = FORMAT_OPTIONS.find((f) => f.value === format);
  const displayError = localError || workerError;

  return (
    <div className="w-full">
      {/* Hero Header */}
      <section className="muxaro-hero-surface border-b border-line">
        <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
          <div className="flex flex-wrap items-center gap-4 mb-6 text-sm">
            <Link
              href="/tools"
              className="inline-flex items-center gap-1.5 font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 rounded-md"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>All tools</span>
            </Link>
            <span className="text-zinc-300 dark:text-zinc-700">/</span>
            <Link
              href="/"
              className="font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 rounded-md"
            >
              Home workspace
            </Link>
          </div>

          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-900 dark:text-zinc-100 mb-4 shadow-xs">
              <Music className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <span>In-Browser Audio Extractor</span>
              <span className="text-zinc-400 dark:text-zinc-500">·</span>
              <span className="text-emerald-700 dark:text-emerald-400 font-medium">100% Client-Side</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-zinc-900 dark:text-zinc-100 tracking-tight">
              Extract clean audio from video
            </h1>
            <p className="text-base text-zinc-600 dark:text-zinc-400 mt-3 leading-relaxed">
              Extract the original bitstream audio in 1–2 seconds with zero re-encoding loss, or convert locally into studio MP3, AAC, WAV, FLAC, and Opus. 100% private in your browser.
            </p>
          </div>
        </div>
      </section>

      {/* Main Workspace */}
      <section className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Card */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 sm:p-8 shadow-xs">
              {/* Step 1: File Selection */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Source video file
                  </label>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    Never leaves your device
                  </span>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*,.mp4,.mkv,.webm,.mov,.avi,.flv,.ts,.m4v,.m4a"
                  onChange={handleFileInputChange}
                  className="hidden"
                  id="video-file-input"
                />

                {!selectedFile ? (
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`relative border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 ${
                      isDragging
                        ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/20'
                        : 'border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-600 bg-zinc-50/50 dark:bg-zinc-900/50'
                    }`}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                  >
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <div className="w-12 h-12 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-zinc-700 dark:text-zinc-300 shadow-xs">
                        <UploadCloud className="w-6 h-6" aria-hidden="true" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          Click to select a video or drag and drop
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                          MP4, MKV, WebM, MOV, AVI, and other media containers up to 2GB+
                        </p>
                      </div>
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                        <Zap className="w-3 h-3" aria-hidden="true" />
                        <span>Stream-copy: Extracts audio in 1–2 seconds</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 sm:p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
                          <FileVideo className="w-5 h-5" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                            {selectedFile.name}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            <span>{formatBytes(selectedFile.size)}</span>
                            {mediaDuration !== null && (
                              <>
                                <span>·</span>
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="w-3 h-3" aria-hidden="true" />
                                  {formatDuration(mediaDuration)}
                                </span>
                              </>
                            )}
                            <span>·</span>
                            <span className="uppercase text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300">
                              {selectedFile.name.split('.').pop() || 'video'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isProcessing}
                          className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
                        >
                          Change
                        </button>
                        <button
                          type="button"
                          onClick={handleRemoveFile}
                          disabled={isProcessing}
                          aria-label="Remove selected file"
                          className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
                        >
                          <X className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Step 2: Format Selection */}
              <div className="mt-8 pt-6 border-t border-zinc-200 dark:border-zinc-800 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Choose output audio format
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {format === 'native' ? 'Zero re-encoding (Lossless copy)' : 'Custom transcode'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {FORMAT_OPTIONS.map((option) => {
                    const isSelected = format === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setFormat(option.value);
                          if (localError) setLocalError(null);
                        }}
                        disabled={isProcessing}
                        className={`p-3.5 rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 disabled:opacity-50 ${
                          isSelected
                            ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-800/80 shadow-xs ring-1 ring-zinc-900 dark:ring-zinc-100'
                            : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {option.label}
                          </span>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              option.badgeType === 'fast'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : option.badgeType === 'universal'
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                                : option.badgeType === 'lossless'
                                ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                                : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300'
                            }`}
                          >
                            {option.badge}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                          {option.detail}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {/* Sub-options: Bitrate selection for MP3 / AAC */}
                {currentFormatObj?.hasBitrate && (
                  <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 space-y-2 mt-3">
                    <label className="block text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      Select audio bitrate
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {BITRATE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setBitrate(opt.value)}
                          disabled={isProcessing}
                          className={`px-3 py-2 rounded-lg border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 ${
                            bitrate === opt.value
                              ? 'border-zinc-900 dark:border-zinc-100 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                              : 'border-zinc-200 dark:border-zinc-700 bg-zinc-100/60 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                          }`}
                        >
                          <div>{opt.label}</div>
                          <div className="text-[10px] font-normal text-zinc-500 dark:text-zinc-400 truncate">
                            {opt.detail.split(' ')[0]}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Error Box */}
              {displayError && (
                <div
                  role="alert"
                  className="mt-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertCircle className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
                    <span>{displayError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleExtract}
                    disabled={isProcessing || !selectedFile}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-zinc-900 text-red-700 dark:text-red-300 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Retry</span>
                  </button>
                </div>
              )}

              {/* Progress Card */}
              {isProcessing && (
                <div className="mt-6 p-5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600 dark:text-blue-400" aria-hidden="true" />
                      <span>{progress.message || (format === 'native' ? 'Extracting audio track (Stream copy)...' : 'Transcoding audio track...')}</span>
                    </span>
                    <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                      {Math.round(progress.percent)}%
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-zinc-200 dark:bg-zinc-700 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-600 h-2 rounded-full origin-left transition-transform duration-150 ease-out"
                      style={{
                        transform: `scaleX(${Math.max(0.02, Math.min(1, (progress.percent || 0) / 100))})`,
                      }}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400 pt-1">
                    <div className="flex items-center gap-3">
                      {progress.speed && <span>Speed: {progress.speed}</span>}
                      {progress.timeFormatted && <span>Time: {progress.timeFormatted}</span>}
                      <span>Engine: FFmpeg.wasm Worker</span>
                    </div>

                    <button
                      type="button"
                      onClick={cancel}
                      className="text-red-600 dark:text-red-400 hover:underline font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-600 rounded"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              {!result && (
                <div className="mt-8 pt-4 flex flex-wrap items-center gap-4">
                  <button
                    type="button"
                    onClick={handleExtract}
                    disabled={!selectedFile || isProcessing || isLoading}
                    className="px-6 py-3 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-200 active:scale-[0.98] transition-transform shadow-xs disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 focus-visible:ring-offset-2 flex items-center gap-2"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        <span>Extracting audio…</span>
                      </>
                    ) : (
                      <>
                        <Music className="w-4 h-4" aria-hidden="true" />
                        <span>Extract audio track</span>
                      </>
                    )}
                  </button>

                  <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                    <span>Zero server costs · 100% offline in browser</span>
                  </span>
                </div>
              )}

              {/* Success Result Display */}
              {result && (
                <div className="mt-8 pt-6 border-t border-zinc-200 dark:border-zinc-800 space-y-5">
                  <div className="p-5 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                          <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                            Audio extracted successfully!
                          </h3>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                            Completed in {(result.elapsedMs / 1000).toFixed(1)}s ·{' '}
                            {result.isStreamCopy ? 'Lossless Stream Copy' : 'Transcoded'}
                          </p>
                        </div>
                      </div>

                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300">
                        {formatBytes(result.sizeBytes)}
                      </span>
                    </div>

                    {/* Audio Player for Instant Preview */}
                    <div className="space-y-1.5 pt-1">
                      <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        Live audio preview:
                      </span>
                      <audio
                        controls
                        src={result.url}
                        className="w-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                        preload="metadata"
                      />
                    </div>

                    {/* Metadata details */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 text-xs">
                      <div className="p-2.5 rounded-lg bg-white/80 dark:bg-zinc-900/80 border border-emerald-100 dark:border-emerald-900/40">
                        <span className="text-zinc-500 dark:text-zinc-400 block text-[11px]">Filename</span>
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100 truncate block">
                          {result.fileName}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-white/80 dark:bg-zinc-900/80 border border-emerald-100 dark:border-emerald-900/40">
                        <span className="text-zinc-500 dark:text-zinc-400 block text-[11px]">Size savings</span>
                        <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                          {selectedFile
                            ? `${Math.max(0, Math.round((1 - result.sizeBytes / selectedFile.size) * 100))}% smaller`
                            : formatBytes(result.sizeBytes)}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-white/80 dark:bg-zinc-900/80 border border-emerald-100 dark:border-emerald-900/40 col-span-2 sm:col-span-1">
                        <span className="text-zinc-500 dark:text-zinc-400 block text-[11px]">Format & Codec</span>
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100 uppercase">
                          {result.fileName.split('.').pop()}
                        </span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <a
                        href={result.url}
                        download={result.fileName}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
                      >
                        <Download className="w-4 h-4" aria-hidden="true" />
                        <span>Download audio ({formatBytes(result.sizeBytes)})</span>
                      </a>

                      <button
                        type="button"
                        onClick={() => {
                          reset();
                          handleRemoveFile();
                        }}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
                      >
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Extract another video</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar Specs & Guarantees */}
          <aside className="space-y-4">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-4 shadow-xs">
              <div className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                <Sliders className="w-4 h-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                <span>Audio extraction specifications</span>
              </div>
              <ul className="space-y-3 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>
                    <strong className="text-zinc-900 dark:text-zinc-100">Lossless Stream Copy:</strong> Uses{' '}
                    <code className="text-[11px] font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">-vn -c:a copy</code> for near-instant (1–2s) zero-loss isolation.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>
                    <strong className="text-zinc-900 dark:text-zinc-100">Wide Container Support:</strong> Handles MP4, MKV, WebM, MOV, AVI, FLV, and TS.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>
                    <strong className="text-zinc-900 dark:text-zinc-100">Fallback Protection:</strong> If stream-copy encounters a container conflict, it seamlessly falls back to high-bitrate AAC.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>
                    <strong className="text-zinc-900 dark:text-zinc-100">No Re-encoding Latency:</strong> Only transcodes when MP3, WAV, or FLAC are explicitly selected.
                  </span>
                </li>
              </ul>
            </div>

            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-3 shadow-xs">
              <div className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <span>100% Client-Side Privacy Guarantee</span>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                Your media never touches any external server or cloud storage. Extraction runs strictly inside your browser’s sandboxed Web Worker using WebAssembly.
              </p>
              <div className="pt-2 flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                <Cpu className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
                <span>Engine: ffmpeg.wasm (In-browser worker)</span>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
