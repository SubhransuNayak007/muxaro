'use client';

/**
 * Project MUXARO - Merge Video & Audio Tool Component
 * Multiplexes separate video and audio tracks with:
 * - Millisecond audio sync offset slider (-5000ms to +5000ms) with ±50ms nudge controls
 * - Two-pass EBU R128 volume normalization (loudnorm) toggle
 * - Dual inputs (URL or 4GB multipart upload per track)
 * - Lossless video stream copy preservation
 * - Real-time SSE progress tracking via useJobStream
 * - Strict Hallmark design tokens & accessible layout
 */

import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import {
  Layers,
  Film,
  Music,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  Download,
  RotateCcw,
  ArrowRight,
  X,
  Pause,
  Play,
} from 'lucide-react';
import {
  api,
  extractDisplayError,
  getApiBaseUrl,
  readCsrfTokenFromCookie,
} from '@/lib/api-client';
import { useJobStream } from '@/hooks/use-job-stream';
import { ResumableMultipartUploader, MultipartUploadStats } from '@/lib/multipart-uploader';
import { FFmpegWorkerClient } from '@/lib/ffmpeg/ffmpeg-client';
import type { FFmpegProgress, FFmpegTaskResult } from '@/lib/ffmpeg/types';
import { normalizeMediaUrl } from '@/lib/url-utils';

const SAFE_CHUNK_SIZE_BYTES = Math.floor(3.5 * 1024 * 1024);

function isBackendDisconnectedMessage(message: string): boolean {
  return (
    message.includes('ERR_BACKEND_NOT_CONFIGURED') ||
    message.includes('503') ||
    message.toLowerCase().includes('backend not configured')
  );
}

export function MergeTool() {
  // Video Source Track
  const [videoMode, setVideoMode] = useState<'url' | 'file'>('url');
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoAssetId, setVideoAssetId] = useState<string | null>(null);
  const [videoUploadStats, setVideoUploadStats] = useState<MultipartUploadStats | null>(null);
  const [isVideoUploading, setIsVideoUploading] = useState<boolean>(false);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const videoUploaderRef = useRef<ResumableMultipartUploader | null>(null);

  // Audio Source Track
  const [audioMode, setAudioMode] = useState<'url' | 'file'>('url');
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioAssetId, setAudioAssetId] = useState<string | null>(null);
  const [audioUploadStats, setAudioUploadStats] = useState<MultipartUploadStats | null>(null);
  const [isAudioUploading, setIsAudioUploading] = useState<boolean>(false);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const audioUploaderRef = useRef<ResumableMultipartUploader | null>(null);

  // Sync and Processing Parameters
  const [audioOffsetMs, setAudioOffsetMs] = useState<number>(0);
  const [normalizeVolume, setNormalizeVolume] = useState<boolean>(true);
  const [targetFormat, setTargetFormat] = useState<'mp4' | 'mkv' | 'webm'>('mp4');
  const [preserveVideoStream, setPreserveVideoStream] = useState<boolean>(true);

  // Local Browser FFmpeg WASM Fallback State
  const [isLocalProcessing, setIsLocalProcessing] = useState<boolean>(false);
  const [localProgress, setLocalProgress] = useState<FFmpegProgress | null>(null);
  const [localResult, setLocalResult] = useState<FFmpegTaskResult | null>(null);

  // Job Submission & Streaming
  const [submittedJobId, setSubmittedJobId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [backendDisconnected, setBackendDisconnected] = useState<boolean>(false);

  const jobStream = useJobStream(submittedJobId);

  useEffect(() => {
    return () => {
      if (localResult?.url) URL.revokeObjectURL(localResult.url);
    };
  }, [localResult?.url]);

  const resolveUploadedId = (manifest: Record<string, any> | null | undefined): string => {
    const id =
      manifest?.uploadSessionId ||
      manifest?.assetId ||
      manifest?.uploadId ||
      manifest?.id;
    if (!id || typeof id !== 'string') {
      throw new Error('Upload finished without a server session or asset ID.');
    }
    return id;
  };

  // Video File Upload Handler
  const handleVideoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    videoUploaderRef.current?.cancel().catch(() => {});
    if (localResult?.url) URL.revokeObjectURL(localResult.url);
    setLocalResult(null);
    setVideoFile(file);
    setVideoAssetId(null);
    setVideoUploadStats(null);
    setErrorMessage(null);
    setBackendDisconnected(false);

    const instance = new ResumableMultipartUploader(file, {
      apiBase: getApiBaseUrl(),
      chunkSize: SAFE_CHUNK_SIZE_BYTES,
      onProgress: (stats) => setVideoUploadStats(stats),
      onError: (err) => {
        const msg = err.message || 'Video upload failed';
        setErrorMessage(`Video upload error: ${msg}`);
        setBackendDisconnected(isBackendDisconnectedMessage(msg));
        setIsVideoUploading(false);
      },
    });
    videoUploaderRef.current = instance;

    setIsVideoUploading(true);
    instance
      .start()
      .then((res) => {
        setVideoAssetId(resolveUploadedId(res));
        setIsVideoUploading(false);
      })
      .catch((err) => {
        const msg = err?.message || 'Video upload failed';
        if (msg !== 'Upload paused or cancelled.') {
          setErrorMessage(msg);
          setBackendDisconnected(isBackendDisconnectedMessage(msg));
        }
        setIsVideoUploading(false);
      });
  };

  const handleVideoPauseResume = async () => {
    const inst = videoUploaderRef.current;
    if (!inst) return;
    if (videoUploadStats?.state === 'uploading') {
      await inst.pause();
      setIsVideoUploading(false);
    } else if (videoUploadStats?.state === 'paused') {
      setIsVideoUploading(true);
      try {
        const res = await inst.resume();
        setVideoAssetId(resolveUploadedId(res));
      } catch (err: any) {
        const msg = err?.message || 'Failed to resume video upload.';
        if (msg !== 'Upload paused or cancelled.') {
          setErrorMessage(msg);
          setBackendDisconnected(isBackendDisconnectedMessage(msg));
        }
      } finally {
        setIsVideoUploading(false);
      }
    }
  };

  // Audio File Upload Handler
  const handleAudioFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    audioUploaderRef.current?.cancel().catch(() => {});
    if (localResult?.url) URL.revokeObjectURL(localResult.url);
    setLocalResult(null);
    setAudioFile(file);
    setAudioAssetId(null);
    setAudioUploadStats(null);
    setErrorMessage(null);
    setBackendDisconnected(false);

    const instance = new ResumableMultipartUploader(file, {
      apiBase: getApiBaseUrl(),
      chunkSize: SAFE_CHUNK_SIZE_BYTES,
      onProgress: (stats) => setAudioUploadStats(stats),
      onError: (err) => {
        const msg = err.message || 'Audio upload failed';
        setErrorMessage(`Audio upload error: ${msg}`);
        setBackendDisconnected(isBackendDisconnectedMessage(msg));
        setIsAudioUploading(false);
      },
    });
    audioUploaderRef.current = instance;

    setIsAudioUploading(true);
    instance
      .start()
      .then((res) => {
        setAudioAssetId(resolveUploadedId(res));
        setIsAudioUploading(false);
      })
      .catch((err) => {
        const msg = err?.message || 'Audio upload failed';
        if (msg !== 'Upload paused or cancelled.') {
          setErrorMessage(msg);
          setBackendDisconnected(isBackendDisconnectedMessage(msg));
        }
        setIsAudioUploading(false);
      });
  };

  const handleAudioPauseResume = async () => {
    const inst = audioUploaderRef.current;
    if (!inst) return;
    if (audioUploadStats?.state === 'uploading') {
      await inst.pause();
      setIsAudioUploading(false);
    } else if (audioUploadStats?.state === 'paused') {
      setIsAudioUploading(true);
      try {
        const res = await inst.resume();
        setAudioAssetId(resolveUploadedId(res));
      } catch (err: any) {
        const msg = err?.message || 'Failed to resume audio upload.';
        if (msg !== 'Upload paused or cancelled.') {
          setErrorMessage(msg);
          setBackendDisconnected(isBackendDisconnectedMessage(msg));
        }
      } finally {
        setIsAudioUploading(false);
      }
    }
  };

  // Nudge audio sync offset by delta ms
  const nudgeOffset = (delta: number) => {
    setAudioOffsetMs((prev) => Math.min(5000, Math.max(-5000, prev + delta)));
  };

  const runLocalFfmpegMerge = async () => {
    if (!videoFile || !audioFile) return;
    if (localResult?.url) URL.revokeObjectURL(localResult.url);
    setLocalResult(null);
    setErrorMessage(null);
    setIsLocalProcessing(true);
    setLocalProgress({ ratio: 0, percent: 0, message: 'Initializing FFmpeg Web Worker…' });
    try {
      const client = FFmpegWorkerClient.getInstance();
      const result = await client.merge({
        videoFile,
        videoFileName: videoFile.name,
        audioFile,
        audioFileName: audioFile.name,
        targetContainer: targetFormat,
        streamCopy: preserveVideoStream,
        audioDelayMs: audioOffsetMs,
        onProgress: (prog) => setLocalProgress(prog),
      });
      setLocalResult(result);
    } catch (err: any) {
      setErrorMessage(
        err?.message || 'Local FFmpeg WASM audio/video merge failed.'
      );
    } finally {
      setIsLocalProcessing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setBackendDisconnected(false);

    const normalizedVideo = videoMode === 'url' ? normalizeMediaUrl(videoUrl) : null;
    const normalizedAudio = audioMode === 'url' ? normalizeMediaUrl(audioUrl) : null;

    if (videoMode === 'url' && !normalizedVideo) {
      setErrorMessage('Please provide a valid video URL.');
      return;
    }
    if (videoMode === 'file' && !videoAssetId) {
      setErrorMessage('Please wait for your video upload to finish, or use local FFmpeg merge with local files.');
      return;
    }
    if (audioMode === 'url' && !normalizedAudio) {
      setErrorMessage('Please provide a valid audio URL.');
      return;
    }
    if (audioMode === 'file' && !audioAssetId) {
      setErrorMessage('Please wait for your audio upload to finish, or use local FFmpeg merge with local files.');
      return;
    }

    setIsSubmitting(true);
    try {
      const apiBase = getApiBaseUrl();
      const csrf = readCsrfTokenFromCookie();
      const token =
        typeof window !== 'undefined' ? localStorage.getItem('muxaro_auth_token') : null;
      const idempotencyKey = `merge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const payload = {
        videoUrl: normalizedVideo || undefined,
        videoAssetId: videoMode === 'file' ? videoAssetId! : undefined,
        videoSessionId: videoMode === 'file' ? videoAssetId! : undefined,
        audioUrl: normalizedAudio || undefined,
        audioAssetId: audioMode === 'file' ? audioAssetId! : undefined,
        audioSessionId: audioMode === 'file' ? audioAssetId! : undefined,
        targetFormat,
        audioOffsetMs,
        normalizeLoudness: normalizeVolume,
        preserveVideoStream,
        streamCopy: preserveVideoStream,
        idempotencyKey,
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': idempotencyKey,
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (csrf) headers['X-CSRF-Token'] = csrf;

      const res = await fetch(`${apiBase}/tools/merge`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(payload),
      });

      const body = (await res.json().catch(() => null)) as Record<string, any> | null;

      if (res.status === 503 || body?.code === 'ERR_BACKEND_NOT_CONFIGURED' || body?.error?.code === 'ERR_BACKEND_NOT_CONFIGURED') {
        setBackendDisconnected(true);
        throw new Error(
          body?.error?.message ||
            body?.rawMessage ||
            'Backend worker is not configured (ERR_BACKEND_NOT_CONFIGURED). Connect a backend node in Settings or configure API_INTERNAL_URL.'
        );
      }

      if (res.ok && body?.success !== false) {
        const jobId = body?.data?.jobId || body?.data?.id || body?.jobId || body?.id;
        if (jobId) {
          setSubmittedJobId(String(jobId));
          return;
        }
      }

      if (res.status === 404 || res.status === 405) {
        const job = await api.createJob({
          sourceUrl: normalizedVideo || undefined,
          mediaAssetId: videoMode === 'file' ? videoAssetId! : undefined,
          uploadSessionId: videoMode === 'file' ? videoAssetId! : undefined,
          audioUrl: normalizedAudio || undefined,
          audioAssetId: audioMode === 'file' ? audioAssetId! : undefined,
          secondaryAudioUrl: normalizedAudio || undefined,
          secondaryAudioSessionId: audioMode === 'file' ? audioAssetId! : undefined,
          jobType: 'merge_av',
          operation: 'MERGE_AUDIO_VIDEO',
          targetFormat,
          audioDelayMs: audioOffsetMs,
          audioOffsetMs,
          normalizeLoudness: normalizeVolume,
          streamCopy: preserveVideoStream,
          idempotencyKey,
        });
        setSubmittedJobId(job.jobId || job.id);
        return;
      }

      throw new Error(
        body?.error?.userMessage ||
          body?.error?.message ||
          body?.message ||
          `Failed to start merge job (HTTP ${res.status}).`
      );
    } catch (err: unknown) {
      const msg = extractDisplayError(err, 'Failed to submit merge job.');
      setErrorMessage(msg);
      if (isBackendDisconnectedMessage(msg)) {
        setBackendDisconnected(true);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    jobStream.reset();
    videoUploaderRef.current?.cancel().catch(() => {});
    audioUploaderRef.current?.cancel().catch(() => {});
    videoUploaderRef.current = null;
    audioUploaderRef.current = null;
    if (localResult?.url) URL.revokeObjectURL(localResult.url);
    setLocalResult(null);
    setLocalProgress(null);
    setIsLocalProcessing(false);
    setSubmittedJobId(null);
    setVideoUrl('');
    setAudioUrl('');
    setVideoFile(null);
    setAudioFile(null);
    setVideoAssetId(null);
    setAudioAssetId(null);
    setVideoUploadStats(null);
    setAudioUploadStats(null);
    setIsVideoUploading(false);
    setIsAudioUploading(false);
    setAudioOffsetMs(0);
    setErrorMessage(null);
    setBackendDisconnected(false);
  };

  const jobDownloadHref = submittedJobId
    ? jobStream.downloadUrl ||
      `${getApiBaseUrl()}/jobs/${encodeURIComponent(submittedJobId)}/download`
    : null;

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8">
      {/* Header Bar */}
      <div className="border-b border-[var(--muxaro-border)] pb-6">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="p-1.5 rounded-lg bg-[var(--muxaro-tag-pill-bg)] text-[var(--muxaro-indigo)]">
            <Layers className="w-5 h-5" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--muxaro-text-primary)]">
            Merge Video & Audio
          </h1>
        </div>
        <p className="text-sm text-[var(--muxaro-text-secondary)]">
          Combine high-resolution video and studio audio tracks with millisecond sync calibration and volume normalization.
        </p>
      </div>

      {localResult ? (
        <div className="muxaro-card p-6 bg-[var(--muxaro-bg-surface)] border border-[var(--muxaro-border)] rounded-2xl shadow-[var(--muxaro-shadow-card)] space-y-5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
            <div>
              <h3 className="text-base font-bold text-[var(--muxaro-text-primary)]">
                Local Browser Merge Complete
              </h3>
              <p className="text-xs text-[var(--muxaro-text-secondary)]">
                Audio synchronized ({audioOffsetMs}ms) and multiplexed locally via FFmpeg Web Worker.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={localResult.url}
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
              <span>Merge Another Pair</span>
            </button>
          </div>
        </div>
      ) : !submittedJobId ? (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Dual Inputs Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Track 1: Video */}
            <div className="muxaro-card p-5 bg-[var(--muxaro-bg-surface)] border border-[var(--muxaro-border)] rounded-2xl shadow-[var(--muxaro-shadow-card)] space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--muxaro-border-subtle)] pb-3">
                <div className="flex items-center gap-2 font-bold text-sm text-[var(--muxaro-text-primary)]">
                  <Film className="w-4 h-4 text-[var(--muxaro-indigo)]" />
                  <span>1. Video Track</span>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setVideoMode('url')}
                    className={`px-2.5 py-1 rounded text-xs font-semibold ${
                      videoMode === 'url'
                        ? 'bg-[var(--muxaro-indigo)] text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-[var(--muxaro-text-secondary)]'
                    }`}
                  >
                    URL
                  </button>
                  <button
                    type="button"
                    onClick={() => setVideoMode('file')}
                    className={`px-2.5 py-1 rounded text-xs font-semibold ${
                      videoMode === 'file'
                        ? 'bg-[var(--muxaro-indigo)] text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-[var(--muxaro-text-secondary)]'
                    }`}
                  >
                    Upload
                  </button>
                </div>
              </div>

              {videoMode === 'url' ? (
                <div className="relative">
                  <input
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    placeholder="Paste video URL…"
                    className="w-full px-3 py-2.5 pr-8 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] text-xs text-[var(--muxaro-text-primary)] placeholder-[var(--muxaro-text-tertiary)] placeholder:truncate truncate focus:border-[var(--muxaro-border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet transition-colors"
                  />
                  {videoUrl && (
                    <button
                      type="button"
                      onClick={() => setVideoUrl('')}
                      aria-label="Clear video URL"
                      className="absolute right-2.5 top-2.5 text-[var(--muxaro-text-tertiary)] hover:text-[var(--muxaro-text-primary)]"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <input
                    type="file"
                    ref={videoInputRef}
                    onChange={handleVideoFileChange}
                    accept="video/*"
                    className="hidden"
                  />
                  {!videoFile ? (
                    <div
                      onClick={() => videoInputRef.current?.click()}
                      className="border border-dashed border-[var(--muxaro-border)] hover:border-[var(--muxaro-border-focus)] rounded-xl p-5 text-center cursor-pointer bg-[var(--muxaro-bg-base)]"
                    >
                      <UploadCloud className="w-6 h-6 mx-auto text-[var(--muxaro-indigo)] mb-1.5" />
                      <div className="text-xs font-semibold text-[var(--muxaro-text-primary)]">
                        Select Video File
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs p-3 rounded-lg bg-[var(--muxaro-bg-base)] border border-[var(--muxaro-border)] space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-[var(--muxaro-text-primary)] truncate">
                          {videoFile.name}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {!videoAssetId && (isVideoUploading || videoUploadStats?.state === 'paused') && (
                            <button
                              type="button"
                              onClick={handleVideoPauseResume}
                              className="p-1 rounded border border-[var(--muxaro-border)] text-[var(--muxaro-text-secondary)]"
                              aria-label={videoUploadStats?.state === 'uploading' ? 'Pause video upload' : 'Resume video upload'}
                            >
                              {videoUploadStats?.state === 'uploading' ? (
                                <Pause className="w-3 h-3" />
                              ) : (
                                <Play className="w-3 h-3" />
                              )}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              videoUploaderRef.current?.cancel().catch(() => {});
                              videoUploaderRef.current = null;
                              setIsVideoUploading(false);
                              setVideoFile(null);
                              setVideoAssetId(null);
                              setVideoUploadStats(null);
                            }}
                            aria-label="Remove video file"
                            className="p-1 text-slate-400 hover:text-slate-600"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      {isVideoUploading && videoUploadStats && (
                        <div className="space-y-1">
                          <div className="text-slate-500">
                            Uploading: {videoUploadStats.percent}% • {videoUploadStats.mbps} MB/s
                          </div>
                          <div className="w-full h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className="w-full h-full bg-[var(--muxaro-indigo)] origin-left transition-transform duration-200"
                              style={{ transform: `scaleX(${Math.min(1, Math.max(0, videoUploadStats.percent / 100))})` }}
                            />
                          </div>
                        </div>
                      )}
                      {videoAssetId && (
                        <div className="text-emerald-600 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Uploaded
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Track 2: Audio */}
            <div className="muxaro-card p-5 bg-[var(--muxaro-bg-surface)] border border-[var(--muxaro-border)] rounded-2xl shadow-[var(--muxaro-shadow-card)] space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--muxaro-border-subtle)] pb-3">
                <div className="flex items-center gap-2 font-bold text-sm text-[var(--muxaro-text-primary)]">
                  <Music className="w-4 h-4 text-emerald-500" />
                  <span>2. Audio Track</span>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setAudioMode('url')}
                    className={`px-2.5 py-1 rounded text-xs font-semibold ${
                      audioMode === 'url'
                        ? 'bg-[var(--muxaro-indigo)] text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-[var(--muxaro-text-secondary)]'
                    }`}
                  >
                    URL
                  </button>
                  <button
                    type="button"
                    onClick={() => setAudioMode('file')}
                    className={`px-2.5 py-1 rounded text-xs font-semibold ${
                      audioMode === 'file'
                        ? 'bg-[var(--muxaro-indigo)] text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-[var(--muxaro-text-secondary)]'
                    }`}
                  >
                    Upload
                  </button>
                </div>
              </div>

              {audioMode === 'url' ? (
                <div className="relative">
                  <input
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    value={audioUrl}
                    onChange={(e) => setAudioUrl(e.target.value)}
                    placeholder="Paste audio URL…"
                    className="w-full px-3 py-2.5 pr-8 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] text-xs text-[var(--muxaro-text-primary)] placeholder-[var(--muxaro-text-tertiary)] placeholder:truncate truncate focus:border-[var(--muxaro-border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet transition-colors"
                  />
                  {audioUrl && (
                    <button
                      type="button"
                      onClick={() => setAudioUrl('')}
                      aria-label="Clear audio URL"
                      className="absolute right-2.5 top-2.5 text-[var(--muxaro-text-tertiary)] hover:text-[var(--muxaro-text-primary)]"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <input
                    type="file"
                    ref={audioInputRef}
                    onChange={handleAudioFileChange}
                    accept="audio/*"
                    className="hidden"
                  />
                  {!audioFile ? (
                    <div
                      onClick={() => audioInputRef.current?.click()}
                      className="border border-dashed border-[var(--muxaro-border)] hover:border-[var(--muxaro-border-focus)] rounded-xl p-5 text-center cursor-pointer bg-[var(--muxaro-bg-base)]"
                    >
                      <UploadCloud className="w-6 h-6 mx-auto text-emerald-500 mb-1.5" />
                      <div className="text-xs font-semibold text-[var(--muxaro-text-primary)]">
                        Select Audio File
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs p-3 rounded-lg bg-[var(--muxaro-bg-base)] border border-[var(--muxaro-border)] space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-[var(--muxaro-text-primary)] truncate">
                          {audioFile.name}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {!audioAssetId && (isAudioUploading || audioUploadStats?.state === 'paused') && (
                            <button
                              type="button"
                              onClick={handleAudioPauseResume}
                              className="p-1 rounded border border-[var(--muxaro-border)] text-[var(--muxaro-text-secondary)]"
                              aria-label={audioUploadStats?.state === 'uploading' ? 'Pause audio upload' : 'Resume audio upload'}
                            >
                              {audioUploadStats?.state === 'uploading' ? (
                                <Pause className="w-3 h-3" />
                              ) : (
                                <Play className="w-3 h-3" />
                              )}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              audioUploaderRef.current?.cancel().catch(() => {});
                              audioUploaderRef.current = null;
                              setIsAudioUploading(false);
                              setAudioFile(null);
                              setAudioAssetId(null);
                              setAudioUploadStats(null);
                            }}
                            aria-label="Remove audio file"
                            className="p-1 text-slate-400 hover:text-slate-600"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      {isAudioUploading && audioUploadStats && (
                        <div className="space-y-1">
                          <div className="text-slate-500">
                            Uploading: {audioUploadStats.percent}% • {audioUploadStats.mbps} MB/s
                          </div>
                          <div className="w-full h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className="w-full h-full bg-emerald-500 origin-left transition-transform duration-200"
                              style={{ transform: `scaleX(${Math.min(1, Math.max(0, audioUploadStats.percent / 100))})` }}
                            />
                          </div>
                        </div>
                      )}
                      {audioAssetId && (
                        <div className="text-emerald-600 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Uploaded
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Sync Calibration & Output Settings */}
          <div className="muxaro-card p-6 bg-[var(--muxaro-bg-surface)] border border-[var(--muxaro-border)] rounded-2xl shadow-[var(--muxaro-shadow-card)] space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-bold text-[var(--muxaro-text-primary)]">
                Audio Synchronization & Calibration
              </h2>
              <div className="flex items-center gap-1.5">
                {(['mp4', 'mkv', 'webm'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setTargetFormat(fmt)}
                    className={`px-2.5 py-1 rounded-lg border text-xs font-semibold uppercase transition-colors ${
                      targetFormat === fmt
                        ? 'border-[var(--muxaro-indigo)] bg-[var(--muxaro-tag-pill-bg)] text-[var(--muxaro-indigo)]'
                        : 'border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] text-[var(--muxaro-text-secondary)]'
                    }`}
                  >
                    .{fmt}
                  </button>
                ))}
              </div>
            </div>

            {/* Offset Slider & Nudge Buttons */}
            <div className="p-4 rounded-xl bg-[var(--muxaro-bg-base)] border border-[var(--muxaro-border)] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--muxaro-text-secondary)]">
                  Audio Sync Offset
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-[var(--muxaro-indigo)]">
                    {audioOffsetMs > 0 ? `+${audioOffsetMs}` : audioOffsetMs} ms
                  </span>
                  {audioOffsetMs !== 0 && (
                    <button
                      type="button"
                      onClick={() => setAudioOffsetMs(0)}
                      className="text-[10px] text-slate-500 hover:text-slate-800 underline"
                    >
                      Reset to 0
                    </button>
                  )}
                </div>
              </div>

              <input
                type="range"
                min="-5000"
                max="5000"
                step="25"
                value={audioOffsetMs}
                onChange={(e) => setAudioOffsetMs(parseInt(e.target.value, 10))}
                className="w-full accent-[var(--muxaro-indigo)] cursor-pointer"
              />

              <div className="flex items-center justify-between text-[11px] text-[var(--muxaro-text-tertiary)] pt-1">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => nudgeOffset(-250)}
                    className="px-2 py-0.5 rounded border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] hover:bg-[var(--muxaro-bg-elevated)]"
                  >
                    -250ms
                  </button>
                  <button
                    type="button"
                    onClick={() => nudgeOffset(-50)}
                    className="px-2 py-0.5 rounded border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] hover:bg-[var(--muxaro-bg-elevated)]"
                  >
                    -50ms
                  </button>
                  <span>(Audio earlier)</span>
                </div>

                <div className="flex items-center gap-1">
                  <span>(Audio delayed)</span>
                  <button
                    type="button"
                    onClick={() => nudgeOffset(50)}
                    className="px-2 py-0.5 rounded border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] hover:bg-[var(--muxaro-bg-elevated)]"
                  >
                    +50ms
                  </button>
                  <button
                    type="button"
                    onClick={() => nudgeOffset(250)}
                    className="px-2 py-0.5 rounded border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] hover:bg-[var(--muxaro-bg-elevated)]"
                  >
                    +250ms
                  </button>
                </div>
              </div>
            </div>

            {/* Volume Normalization & Stream Preservation Toggles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="p-3.5 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={normalizeVolume}
                  onChange={(e) => setNormalizeVolume(e.target.checked)}
                  className="mt-0.5 rounded border-[var(--muxaro-border)] text-[var(--muxaro-indigo)] focus:ring-[var(--muxaro-border-focus)]"
                />
                <div>
                  <div className="text-xs font-bold text-[var(--muxaro-text-primary)]">
                    EBU R128 Loudness Normalization
                  </div>
                  <div className="text-[11px] text-[var(--muxaro-text-secondary)] mt-0.5">
                    Equalizes audio to streaming standard (-14 LUFS) with true-peak limiter.
                  </div>
                </div>
              </label>

              <label className="p-3.5 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={preserveVideoStream}
                  onChange={(e) => setPreserveVideoStream(e.target.checked)}
                  className="mt-0.5 rounded border-[var(--muxaro-border)] text-[var(--muxaro-indigo)] focus:ring-[var(--muxaro-border-focus)]"
                />
                <div>
                  <div className="text-xs font-bold text-[var(--muxaro-text-primary)]">
                    Preserve Video Bitstream (Stream Copy)
                  </div>
                  <div className="text-[11px] text-[var(--muxaro-text-secondary)] mt-0.5">
                    Lossless video multiplexing without recompression artifacts.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {isLocalProcessing && localProgress && (
            <div className="p-4 rounded-xl bg-[var(--muxaro-bg-surface)] border border-[var(--muxaro-border)] space-y-2">
              <div className="flex justify-between text-xs text-[var(--muxaro-text-secondary)]">
                <span>{localProgress.message || 'Merging tracks locally in browser…'}</span>
                <span>{Math.round(localProgress.percent)}%</span>
              </div>
              <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="w-full h-full bg-emerald-500 origin-left transition-transform duration-200"
                  style={{ transform: `scaleX(${Math.min(1, Math.max(0, localProgress.percent / 100))})` }}
                />
              </div>
            </div>
          )}

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
                {backendDisconnected && videoFile && audioFile && (
                  <button
                    type="button"
                    onClick={runLocalFfmpegMerge}
                    disabled={isLocalProcessing}
                    className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                  >
                    Merge Locally (FFmpeg WASM)
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

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={isSubmitting || isLocalProcessing || isVideoUploading || isAudioUploading}
              className="flex-1 py-3.5 px-6 rounded-xl bg-[var(--muxaro-indigo)] text-white font-semibold text-sm shadow-[var(--muxaro-shadow-btn)] hover:shadow-[var(--muxaro-shadow-btn-hover)] hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--muxaro-border-focus)] transition-opacity duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <span>Submitting Multiplexing Job…</span>
              ) : (
                <>
                  <span>Merge Video & Audio Tracks</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            {videoFile && audioFile && (
              <button
                type="button"
                onClick={runLocalFfmpegMerge}
                disabled={isLocalProcessing}
                className="py-3.5 px-5 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] text-xs font-semibold text-[var(--muxaro-text-primary)] hover:bg-[var(--muxaro-bg-elevated)] disabled:opacity-50"
              >
                {isLocalProcessing ? 'Merging Locally…' : 'Process in Browser'}
              </button>
            )}
          </div>
        </form>
      ) : (
        /* Real-Time Multiplexing Stream */
        <div className="muxaro-card p-6 bg-[var(--muxaro-bg-surface)] border border-[var(--muxaro-border)] rounded-2xl shadow-[var(--muxaro-shadow-card)] space-y-6">
          <div className="flex items-center justify-between border-b border-[var(--muxaro-border-subtle)] pb-4">
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-xl bg-[var(--muxaro-tag-pill-bg)] text-[var(--muxaro-indigo)]">
                <Layers className="w-6 h-6" />
              </span>
              <div>
                <h3 className="text-base font-bold text-[var(--muxaro-text-primary)]">
                  Multiplexing Audio & Video (.{targetFormat.toUpperCase()})
                </h3>
                <p className="text-xs text-[var(--muxaro-text-secondary)] font-mono">
                  {submittedJobId}
                </p>
              </div>
            </div>

            <span
              className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
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

          <div className="space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-[var(--muxaro-text-primary)]">
                {jobStream.stageMessage}
              </span>
              <span className="font-mono text-[var(--muxaro-text-secondary)]">
                {jobStream.progress}% • Speed: {jobStream.speed} • ETA: {jobStream.etaSeconds}s
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

          {jobStream.error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-medium space-y-2">
              <div className="font-bold">Merge Failed: {jobStream.error.code}</div>
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

          {jobStream.status === 'READY' && jobDownloadHref && (
            <div className="p-6 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
                <div>
                  <h4 className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                    Media Successfully Merged!
                  </h4>
                  <p className="text-xs text-emerald-700 dark:text-emerald-400">
                    Audio synchronized ({audioOffsetMs}ms) and multiplexed with zero drift.
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
                  <span>Download Merged Video</span>
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
                  <span>Merge Another Pair</span>
                </button>
              </div>
            </div>
          )}

          {!jobStream.isTerminal && (
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={jobStream.cancel}
                className="text-xs text-red-500 hover:text-red-700 font-semibold"
              >
                Cancel Merge
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default MergeTool;
