'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Combine,
  CheckCircle2,
  ShieldCheck,
  AlertCircle,
  RotateCcw,
  Upload,
  FileVideo,
  FileAudio,
  Download,
  X,
  Sliders,
  Cpu,
  Clock,
  Sparkles,
} from 'lucide-react';
import { useFFmpegWorker, ContainerFormat } from '@/lib/ffmpeg';
import { formatBytes } from '@/lib/formatters';

export default function AudioVideoMergerPage() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [container, setContainer] = useState<ContainerFormat>('mp4');
  const [streamCopy, setStreamCopy] = useState<boolean>(true);
  const [audioDelayMs, setAudioDelayMs] = useState<number>(0);

  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);

  const [isDraggingVideo, setIsDraggingVideo] = useState<boolean>(false);
  const [isDraggingAudio, setIsDraggingAudio] = useState<boolean>(false);

  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const {
    isReady,
    isLoading: isWorkerLoading,
    isProcessing,
    progress,
    error,
    result,
    merge,
    cancel,
    reset,
  } = useFFmpegWorker();

  // Create preview URLs when files change and clean up on unmount
  useEffect(() => {
    if (videoFile) {
      const url = URL.createObjectURL(videoFile);
      setVideoPreviewUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    } else {
      setVideoPreviewUrl(null);
    }
  }, [videoFile]);

  useEffect(() => {
    if (audioFile) {
      const url = URL.createObjectURL(audioFile);
      setAudioPreviewUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    } else {
      setAudioPreviewUrl(null);
    }
  }, [audioFile]);

  // Track elapsed processing time
  useEffect(() => {
    if (isProcessing) {
      setElapsedSeconds(0);
      const start = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - start) / 100) / 10);
      }, 100);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isProcessing]);

  const handleVideoSelect = (file: File) => {
    setVideoFile(file);
    reset();
  };

  const handleAudioSelect = (file: File) => {
    setAudioFile(file);
    reset();
  };

  const handleStartMerge = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!videoFile || !audioFile || isProcessing) return;

    try {
      await merge({
        videoFile,
        videoFileName: videoFile.name,
        audioFile,
        audioFileName: audioFile.name,
        targetContainer: container,
        streamCopy,
        audioDelayMs,
      });
    } catch (err) {
      console.error('[AudioVideoMerger] Merge failed:', err);
    }
  };

  const handleResetAll = () => {
    reset();
    setVideoFile(null);
    setAudioFile(null);
    setAudioDelayMs(0);
    if (videoInputRef.current) videoInputRef.current.value = '';
    if (audioInputRef.current) audioInputRef.current.value = '';
  };

  return (
    <div className="w-full">
      {/* Hero Header */}
      <section className="muxaro-hero-surface border-b border-line">
        <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
          <div className="flex flex-wrap items-center gap-4 mb-6 text-sm">
            <Link
              href="/tools"
              className="inline-flex items-center gap-1.5 font-medium text-content-secondary hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet rounded-lg"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>All tools</span>
            </Link>
            <Link
              href="/"
              className="font-medium text-content-secondary hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet rounded-lg"
            >
              Home workspace
            </Link>
          </div>

          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-elevated border border-brand-violet/30 text-xs font-semibold text-brand-violet mb-4 shadow-xs">
              <Combine className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Audio & video merger</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-zinc-900 dark:text-zinc-100 tracking-tight">
              Combine separate video and audio tracks
            </h1>
            <p className="text-base text-zinc-600 dark:text-zinc-400 mt-3 leading-relaxed">
              Mux separate video and audio streams directly in your browser with zero quality loss.
              100% private, instantaneous stream copy, $0 cloud cost.
            </p>
          </div>
        </div>
      </section>

      {/* Main Workspace */}
      <section className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="muxaro-media-card p-6 sm:p-8 space-y-6">
              {/* File Selectors: Video & Audio */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* 1. Video Track Picker */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                      <FileVideo className="w-4 h-4 text-brand-violet" aria-hidden="true" />
                      <span>1. Video track</span>
                    </label>
                    {videoFile && (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        Selected
                      </span>
                    )}
                  </div>

                  {!videoFile ? (
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDraggingVideo(true);
                      }}
                      onDragLeave={() => setIsDraggingVideo(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDraggingVideo(false);
                        const file = e.dataTransfer.files?.[0];
                        if (file) handleVideoSelect(file);
                      }}
                      onClick={() => videoInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-colors ${
                        isDraggingVideo
                          ? 'border-brand-violet bg-brand-violet/5'
                          : 'border-line hover:border-brand-violet/60 hover:bg-surface-elevated'
                      }`}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          videoInputRef.current?.click();
                        }
                      }}
                      aria-label="Upload video track file"
                    >
                      <input
                        ref={videoInputRef}
                        type="file"
                        accept="video/*,.mp4,.mkv,.webm,.mov,.avi,.ts"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleVideoSelect(file);
                        }}
                      />
                      <Upload className="w-8 h-8 text-zinc-400 mx-auto mb-2" aria-hidden="true" />
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        Drop video file here or click to browse
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                        MP4, MKV, WebM, MOV, AVI (no file size limit)
                      </p>
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-surface-elevated border border-line flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-brand-violet/10 flex items-center justify-center shrink-0">
                          <FileVideo className="w-5 h-5 text-brand-violet" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                            {videoFile.name}
                          </p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {formatBytes(videoFile.size)} · {videoFile.type || 'Video stream'}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setVideoFile(null);
                          reset();
                          if (videoInputRef.current) videoInputRef.current.value = '';
                        }}
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet"
                        aria-label="Remove video file"
                      >
                        <X className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>

                {/* 2. Audio Track Picker */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                      <FileAudio className="w-4 h-4 text-brand-violet" aria-hidden="true" />
                      <span>2. Audio track</span>
                    </label>
                    {audioFile && (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        Selected
                      </span>
                    )}
                  </div>

                  {!audioFile ? (
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDraggingAudio(true);
                      }}
                      onDragLeave={() => setIsDraggingAudio(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDraggingAudio(false);
                        const file = e.dataTransfer.files?.[0];
                        if (file) handleAudioSelect(file);
                      }}
                      onClick={() => audioInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-colors ${
                        isDraggingAudio
                          ? 'border-brand-violet bg-brand-violet/5'
                          : 'border-line hover:border-brand-violet/60 hover:bg-surface-elevated'
                      }`}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          audioInputRef.current?.click();
                        }
                      }}
                      aria-label="Upload audio track file"
                    >
                      <input
                        ref={audioInputRef}
                        type="file"
                        accept="audio/*,.mp3,.m4a,.aac,.wav,.flac,.opus,.ogg"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleAudioSelect(file);
                        }}
                      />
                      <Upload className="w-8 h-8 text-zinc-400 mx-auto mb-2" aria-hidden="true" />
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        Drop audio file here or click to browse
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                        MP3, M4A, AAC, WAV, FLAC, Opus, OGG
                      </p>
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-surface-elevated border border-line flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-brand-violet/10 flex items-center justify-center shrink-0">
                          <FileAudio className="w-5 h-5 text-brand-violet" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                            {audioFile.name}
                          </p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {formatBytes(audioFile.size)} · {audioFile.type || 'Audio stream'}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setAudioFile(null);
                          reset();
                          if (audioInputRef.current) audioInputRef.current.value = '';
                        }}
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet"
                        aria-label="Remove audio file"
                      >
                        <X className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Options Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-line">
                <div>
                  <label
                    htmlFor="merge-container"
                    className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2"
                  >
                    Target container
                  </label>
                  <select
                    id="merge-container"
                    value={container}
                    onChange={(e) => setContainer(e.target.value as ContainerFormat)}
                    disabled={isProcessing}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line text-zinc-900 dark:text-zinc-100 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet transition-colors"
                  >
                    <option value="mp4">MP4 (Universal playback, FastStart enabled)</option>
                    <option value="mkv">MKV (Lossless stream copy with any audio codec)</option>
                    <option value="webm">WebM (Optimized for HTML5 video)</option>
                    <option value="mov">MOV (Apple QuickTime compatible)</option>
                  </select>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5">
                    {container === 'mp4' && 'Recommended for mobile, web, and desktop players.'}
                    {container === 'mkv' && 'Preserves Opus, FLAC, and multi-channel audio tracks.'}
                    {container === 'webm' && 'Standard format for open web video.'}
                    {container === 'mov' && 'Native format for macOS and Final Cut Pro.'}
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="merge-audio-delay"
                    className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2 flex items-center justify-between"
                  >
                    <span>Audio timing offset (ms)</span>
                    <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                      {audioDelayMs === 0 ? 'Synchronized (0ms)' : `${audioDelayMs > 0 ? '+' : ''}${audioDelayMs}ms`}
                    </span>
                  </label>
                  <input
                    id="merge-audio-delay"
                    type="number"
                    step="50"
                    value={audioDelayMs}
                    onChange={(e) => setAudioDelayMs(parseInt(e.target.value, 10) || 0)}
                    disabled={isProcessing}
                    placeholder="0"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line text-zinc-900 dark:text-zinc-100 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet transition-colors"
                  />
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5">
                    Positive delays audio; negative advances audio to fix sync issues.
                  </p>
                </div>
              </div>

              {/* Stream Copy Settings */}
              <div className="p-4 rounded-xl bg-surface-elevated border border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Lossless stream copy (remux)
                    </span>
                    <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      2–5 seconds
                    </span>
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Copies compressed video and audio streams directly without re-encoding quality loss.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={streamCopy}
                    onChange={(e) => setStreamCopy(e.target.checked)}
                    disabled={isProcessing}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-zinc-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-brand-violet dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-violet rounded-full"></div>
                </label>
              </div>

              {/* Duration Mismatch Explanation Banner */}
              <div className="p-3.5 rounded-xl bg-surface-elevated/50 border border-line/60 flex items-start gap-2.5 text-xs text-zinc-600 dark:text-zinc-400">
                <Sliders className="w-4 h-4 text-brand-violet shrink-0 mt-0.5" aria-hidden="true" />
                <p>
                  <strong>Duration alignment:</strong> MUXARO automatically syncs streams using the{' '}
                  <code className="px-1 py-0.5 rounded bg-surface border border-line text-zinc-800 dark:text-zinc-200 font-mono text-[11px]">
                    -shortest
                  </code>{' '}
                  flag to eliminate trailing frozen frames or audio silence when track lengths differ.
                </p>
              </div>

              {/* Error Message */}
              {error && (
                <div
                  role="alert"
                  className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-600 dark:text-red-400 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleStartMerge()}
                    disabled={isProcessing || !videoFile || !audioFile}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/40 bg-surface text-red-600 dark:text-red-400 text-xs font-semibold hover:bg-surface-elevated transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Retry</span>
                  </button>
                </div>
              )}

              {/* Action Buttons */}
              {!result && (
                <div className="flex flex-wrap items-center gap-4 pt-2">
                  <button
                    type="button"
                    onClick={() => handleStartMerge()}
                    disabled={isProcessing || !videoFile || !audioFile}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-brand-violet text-white text-sm font-semibold hover:bg-brand-violet/90 active:scale-[0.98] transition-transform shadow-xs disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2"
                  >
                    {isProcessing ? (
                      <>
                        <Cpu className="w-4 h-4 animate-spin" aria-hidden="true" />
                        <span>Remuxing in browser ({progress.percent}%)…</span>
                      </>
                    ) : (
                      <>
                        <Combine className="w-4 h-4" aria-hidden="true" />
                        <span>Merge video & audio</span>
                      </>
                    )}
                  </button>

                  {isProcessing && (
                    <button
                      type="button"
                      onClick={cancel}
                      className="px-4 py-3 rounded-full border border-line text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-surface-elevated transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet"
                    >
                      Cancel
                    </button>
                  )}

                  <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-500" aria-hidden="true" />
                    <span>100% Client-Side · Zero uploads · $0 cost</span>
                  </span>
                </div>
              )}

              {/* Real-time Progress Card */}
              {isProcessing && (
                <div className="p-5 rounded-2xl bg-surface-elevated border border-line space-y-3">
                  <div className="flex items-center justify-between text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    <span className="flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-brand-violet" aria-hidden="true" />
                      <span>{progress.message || 'Processing in WebAssembly Worker…'}</span>
                    </span>
                    <span className="font-mono">{progress.percent}%</span>
                  </div>

                  <div className="w-full bg-surface rounded-full h-2.5 overflow-hidden border border-line">
                    <div
                      className="bg-brand-violet h-2.5 rounded-full origin-left transition-transform duration-200 ease-out w-full"
                      style={{ transform: `scaleX(${Math.max(0.05, (progress.percent || 0) / 100)})` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Elapsed: {elapsedSeconds.toFixed(1)}s</span>
                    </span>
                    {progress.speed && <span>Speed: {progress.speed}</span>}
                    {progress.timeFormatted && <span>Time: {progress.timeFormatted}</span>}
                  </div>
                </div>
              )}

              {/* Result Download & Preview Card */}
              {result && (
                <div className="p-6 rounded-2xl bg-surface-elevated border border-emerald-500/30 space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                        <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                          Tracks merged successfully!
                        </h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          Ready for instant local download
                        </p>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      {result.isStreamCopy ? '100% Lossless Stream Copy' : 'AAC Audio Transcode'}
                    </span>
                  </div>

                  {/* Merged Video Preview Player */}
                  <div className="rounded-xl overflow-hidden bg-black border border-line">
                    <video
                      src={result.url}
                      controls
                      playsInline
                      className="w-full max-h-[380px] object-contain mx-auto"
                    />
                  </div>

                  {/* Stats Strip */}
                  <div className="grid grid-cols-3 gap-2 py-3 px-4 rounded-xl bg-surface border border-line text-center text-xs">
                    <div>
                      <span className="text-zinc-500 dark:text-zinc-400 block text-[11px]">Format</span>
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100 uppercase">
                        {container}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500 dark:text-zinc-400 block text-[11px]">File Size</span>
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {formatBytes(result.sizeBytes)}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500 dark:text-zinc-400 block text-[11px]">Elapsed</span>
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {(result.elapsedMs / 1000).toFixed(1)}s
                      </span>
                    </div>
                  </div>

                  {/* Download & Reset CTA Buttons */}
                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <a
                      href={result.url}
                      download={result.fileName}
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold active:scale-[0.98] transition-transform shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                    >
                      <Download className="w-4 h-4" aria-hidden="true" />
                      <span>Download merged video ({formatBytes(result.sizeBytes)})</span>
                    </a>

                    <button
                      type="button"
                      onClick={handleResetAll}
                      className="inline-flex items-center gap-1.5 px-4 py-3 rounded-full border border-line text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Merge another file</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar Architecture & Standards Cards */}
          <aside className="space-y-4">
            <div className="muxaro-media-card p-6 space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                <Combine className="w-4 h-4 text-brand-violet" aria-hidden="true" />
                <span>Muxing standards</span>
              </div>
              <ul className="space-y-3 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>
                    <strong>Instant stream copy:</strong> Interleaves AV packets with continuous DTS/PTS timestamps in 2–5 seconds.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>
                    <strong>Smart container fallback:</strong> Retains 100% video bitstream and adapts Opus audio into AAC when muxing into MP4.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>
                    <strong>Web FastStart:</strong> Places the MP4 <code className="text-zinc-800 dark:text-zinc-200">moov</code> atom at the start of the container for instant streaming playback.
                  </span>
                </li>
              </ul>
            </div>

            <div className="muxaro-media-card p-6 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                <ShieldCheck className="w-4 h-4 text-emerald-500" aria-hidden="true" />
                <span>100% Private local processing</span>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                All multiplexing runs inside your browser using WebAssembly. Your video and audio files are never uploaded to any remote server or cloud bucket.
              </p>
            </div>

            <div className="muxaro-media-card p-6 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                <Sparkles className="w-4 h-4 text-brand-violet" aria-hidden="true" />
                <span>$0 infrastructure cost</span>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                Client-side execution eliminates server compute, bandwidth limits, and proxy rotation bottlenecks completely.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
