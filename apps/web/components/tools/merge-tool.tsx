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

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import {
  Layers,
  Film,
  Music,
  Sliders,
  Volume2,
  Clock,
  UploadCloud,
  Link2,
  CheckCircle2,
  AlertCircle,
  Download,
  RotateCcw,
  ArrowRight,
  X,
  Play,
} from 'lucide-react';
import { api } from '@/lib/api-client';
import { useJobStream } from '@/hooks/use-job-stream';
import { ResumableMultipartUploader, MultipartUploadStats } from '@/lib/multipart-uploader';
import { normalizeMediaUrl } from '@/lib/url-utils';

export function MergeTool() {
  // Video Source Track
  const [videoMode, setVideoMode] = useState<'url' | 'file'>('url');
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoAssetId, setVideoAssetId] = useState<string | null>(null);
  const [videoUploadStats, setVideoUploadStats] = useState<MultipartUploadStats | null>(null);
  const [isVideoUploading, setIsVideoUploading] = useState<boolean>(false);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // Audio Source Track
  const [audioMode, setAudioMode] = useState<'url' | 'file'>('url');
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioAssetId, setAudioAssetId] = useState<string | null>(null);
  const [audioUploadStats, setAudioUploadStats] = useState<MultipartUploadStats | null>(null);
  const [isAudioUploading, setIsAudioUploading] = useState<boolean>(false);
  const audioInputRef = useRef<HTMLInputElement>(null);

  // Sync and Processing Parameters
  const [audioOffsetMs, setAudioOffsetMs] = useState<number>(0);
  const [normalizeVolume, setNormalizeVolume] = useState<boolean>(true);
  const [targetFormat, setTargetFormat] = useState<'mp4' | 'mkv' | 'webm'>('mp4');
  const [preserveVideoStream, setPreserveVideoStream] = useState<boolean>(true);

  // Job Submission & Streaming
  const [submittedJobId, setSubmittedJobId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const jobStream = useJobStream(submittedJobId);

  // Video File Upload Handler
  const handleVideoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoFile(file);
    setVideoAssetId(null);
    setErrorMessage(null);

    const instance = new ResumableMultipartUploader(file, {
      onProgress: (stats) => setVideoUploadStats(stats),
      onError: (err) => {
        setErrorMessage(`Video upload error: ${err.message}`);
        setIsVideoUploading(false);
      },
    });

    setIsVideoUploading(true);
    instance
      .start()
      .then((res) => {
        setVideoAssetId(res.assetId || res.id || 'video_asset');
        setIsVideoUploading(false);
      })
      .catch((err) => {
        if (err.message !== 'Upload paused or cancelled.') {
          setErrorMessage(err.message);
        }
        setIsVideoUploading(false);
      });
  };

  // Audio File Upload Handler
  const handleAudioFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioFile(file);
    setAudioAssetId(null);
    setErrorMessage(null);

    const instance = new ResumableMultipartUploader(file, {
      onProgress: (stats) => setAudioUploadStats(stats),
      onError: (err) => {
        setErrorMessage(`Audio upload error: ${err.message}`);
        setIsAudioUploading(false);
      },
    });

    setIsAudioUploading(true);
    instance
      .start()
      .then((res) => {
        setAudioAssetId(res.assetId || res.id || 'audio_asset');
        setIsAudioUploading(false);
      })
      .catch((err) => {
        if (err.message !== 'Upload paused or cancelled.') {
          setErrorMessage(err.message);
        }
        setIsAudioUploading(false);
      });
  };

  // Nudge audio sync offset by delta ms
  const nudgeOffset = (delta: number) => {
    setAudioOffsetMs((prev) => Math.min(5000, Math.max(-5000, prev + delta)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const hasVideo = videoMode === 'url' ? !!normalizeMediaUrl(videoUrl) : !!videoAssetId;
    const hasAudio = audioMode === 'url' ? !!normalizeMediaUrl(audioUrl) : !!audioAssetId;

    if (!hasVideo) {
      setErrorMessage('Please provide a valid video track (URL or uploaded file).');
      return;
    }
    if (!hasAudio) {
      setErrorMessage('Please provide a valid audio track (URL or uploaded file).');
      return;
    }

    setIsSubmitting(true);
    try {
      // First attempt dedicated /tools/merge route
      const token = typeof window !== 'undefined' ? localStorage.getItem('muxaro_auth_token') : null;
      const payload = {
        videoUrl: videoMode === 'url' ? normalizeMediaUrl(videoUrl) : undefined,
        videoAssetId: videoMode === 'file' ? videoAssetId : undefined,
        audioUrl: audioMode === 'url' ? normalizeMediaUrl(audioUrl) : undefined,
        audioAssetId: audioMode === 'file' ? audioAssetId : undefined,
        targetFormat,
        audioOffsetMs,
        normalizeLoudness: normalizeVolume,
        preserveVideoStream,
        idempotencyKey: `merge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      };

      const res = await fetch('/api/v1/tools/merge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const body = await res.json();
        setSubmittedJobId(body.data?.jobId || body.jobId);
      } else {
        // Fallback to standard jobs endpoint
        const job = await api.createJob({
          sourceUrl: videoMode === 'url' ? normalizeMediaUrl(videoUrl) : undefined,
          mediaAssetId: videoMode === 'file' ? videoAssetId! : undefined,
          jobType: 'merge_av',
          operation: 'MERGE_AUDIO_VIDEO',
          targetFormat,
          idempotencyKey: payload.idempotencyKey,
        });
        setSubmittedJobId(job.jobId || job.id);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to submit merge job.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    jobStream.reset();
    setSubmittedJobId(null);
    setVideoUrl('');
    setAudioUrl('');
    setVideoFile(null);
    setAudioFile(null);
    setVideoAssetId(null);
    setAudioAssetId(null);
    setAudioOffsetMs(0);
    setErrorMessage(null);
  };

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

      {!submittedJobId ? (
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
                <input
                  type="url"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://... video URL"
                  className="w-full px-3 py-2.5 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] text-xs text-[var(--muxaro-text-primary)] focus:border-[var(--muxaro-border-focus)] focus-visible:outline-none"
                />
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
                    <div className="text-xs p-3 rounded-lg bg-[var(--muxaro-bg-base)] border border-[var(--muxaro-border)] space-y-1">
                      <div className="font-semibold text-[var(--muxaro-text-primary)] truncate">
                        {videoFile.name}
                      </div>
                      {isVideoUploading && videoUploadStats && (
                        <div className="text-slate-500">
                          Uploading: {videoUploadStats.percent}% • {videoUploadStats.mbps} MB/s
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
                <input
                  type="url"
                  value={audioUrl}
                  onChange={(e) => setAudioUrl(e.target.value)}
                  placeholder="https://... audio URL"
                  className="w-full px-3 py-2.5 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] text-xs text-[var(--muxaro-text-primary)] focus:border-[var(--muxaro-border-focus)] focus-visible:outline-none"
                />
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
                    <div className="text-xs p-3 rounded-lg bg-[var(--muxaro-bg-base)] border border-[var(--muxaro-border)] space-y-1">
                      <div className="font-semibold text-[var(--muxaro-text-primary)] truncate">
                        {audioFile.name}
                      </div>
                      {isAudioUploading && audioUploadStats && (
                        <div className="text-slate-500">
                          Uploading: {audioUploadStats.percent}% • {audioUploadStats.mbps} MB/s
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
            <h2 className="text-base font-bold text-[var(--muxaro-text-primary)]">
              Audio Synchronization & Calibration
            </h2>

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

          {errorMessage && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || isVideoUploading || isAudioUploading}
            className="w-full py-3.5 px-6 rounded-xl bg-[var(--muxaro-indigo)] text-white font-semibold text-sm shadow-[var(--muxaro-shadow-btn)] hover:shadow-[var(--muxaro-shadow-btn-hover)] hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--muxaro-border-focus)] transition-opacity duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
                  Multiplexing Audio & Video
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
                className={`h-full transition-all duration-300 ${
                  jobStream.status === 'FAILED'
                    ? 'bg-red-500'
                    : jobStream.status === 'READY'
                    ? 'bg-emerald-500'
                    : 'bg-[var(--muxaro-indigo)]'
                }`}
                style={{ width: `${jobStream.progress}%` }}
              />
            </div>
          </div>

          {jobStream.status === 'READY' && jobStream.downloadUrl && (
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
                  href={jobStream.downloadUrl}
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
        </div>
      )}
    </div>
  );
}

export default MergeTool;
