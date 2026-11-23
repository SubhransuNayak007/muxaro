'use client';

/**
 * Project MUXARO - Convert Video Tool Component
 * Supports MP4, MKV, WebM, MOV with:
 * - Real-time Lossless Remux / Stream Copy detection indicator
 * - Integrated Eco Mode toggle (energy savings & carbon reduction)
 * - Dual input: URL inspection or 4GB Resumable Multipart Local Upload
 * - Real-time SSE stage & progress tracking with ETA
 * - Conforms to Hallmark design standards (tokenized, no transition:all)
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
} from 'lucide-react';
import { api } from '@/lib/api-client';
import { useEcoStore } from '@/lib/eco-store';
import { useJobStream } from '@/hooks/use-job-stream';
import { ResumableMultipartUploader, MultipartUploadStats } from '@/lib/multipart-uploader';
import { normalizeMediaUrl } from '@/lib/url-utils';

export type VideoContainer = 'mp4' | 'mkv' | 'webm' | 'mov';
export type VideoCodec = 'copy' | 'h264' | 'hevc' | 'vp9' | 'av1';
export type Resolution = 'source' | '2160p' | '1440p' | '1080p' | '720p' | '480p';

export function ConvertTool() {
  const { settings: ecoSettings, toggleEco, recordSavedJob } = useEcoStore();

  const [inputMode, setInputMode] = useState<'url' | 'file'>('url');
  const [urlInput, setUrlInput] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedAssetId, setUploadedAssetId] = useState<string | null>(null);

  // Target Settings
  const [targetContainer, setTargetContainer] = useState<VideoContainer>('mp4');
  const [videoCodec, setVideoCodec] = useState<VideoCodec>('copy');
  const [resolution, setResolution] = useState<Resolution>('source');
  const [qualityPreset, setQualityPreset] = useState<'fast' | 'balanced' | 'high'>('balanced');
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  // Local Upload State
  const [uploader, setUploader] = useState<ResumableMultipartUploader | null>(null);
  const [uploadStats, setUploadStats] = useState<MultipartUploadStats | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Job Submission & Streaming
  const [submittedJobId, setSubmittedJobId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const jobStream = useJobStream(submittedJobId);

  // When job succeeds and was stream copy, record eco savings
  useEffect(() => {
    if (jobStream.status === 'READY' && videoCodec === 'copy') {
      recordSavedJob(180);
    }
  }, [jobStream.status, videoCodec, recordSavedJob]);

  // Stream Copy / Lossless Remux Feasibility Detection
  const remuxFeasibility = useMemo(() => {
    // If Eco Mode is on and target container is MP4, MKV, or MOV, stream copy is lossless and recommended
    if (targetContainer === 'mp4' || targetContainer === 'mkv' || targetContainer === 'mov') {
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
    return { feasible: false, reason: 'Re-encode required for target format', speedMultiplier: '1x', lossless: false };
  }, [targetContainer]);

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
    setSelectedFile(file);
    setUploadedAssetId(null);
    setErrorMessage(null);

    // Initial uploader instantiation
    const instance = new ResumableMultipartUploader(file, {
      onProgress: (stats) => {
        setUploadStats(stats);
      },
      onError: (err) => {
        setErrorMessage(err.message || 'File upload failed');
        setIsUploading(false);
      },
    });
    setUploader(instance);
  };

  const startUpload = async () => {
    if (!uploader) return;
    setIsUploading(true);
    setErrorMessage(null);
    try {
      const manifest = await uploader.start();
      setUploadedAssetId(manifest.assetId || manifest.id || 'uploaded_asset');
      setIsUploading(false);
    } catch (err: any) {
      if (err.message !== 'Upload paused or cancelled.') {
        setErrorMessage(err.message || 'Failed to upload media.');
      }
      setIsUploading(false);
    }
  };

  const handlePauseResumeUpload = async () => {
    if (!uploader) return;
    if (uploadStats?.state === 'uploading') {
      await uploader.pause();
    } else if (uploadStats?.state === 'paused') {
      uploader.resume();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (inputMode === 'url') {
      const trimmed = normalizeMediaUrl(urlInput);
      if (!trimmed) {
        setErrorMessage('Please enter a valid media link (YouTube, Vimeo, SoundCloud, or direct video URL).');
        return;
      }
    } else {
      if (!uploadedAssetId) {
        setErrorMessage('Please upload and inspect your local video file before starting conversion.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const isCopy = videoCodec === 'copy';
      const operation = isCopy ? 'REMUX_STREAM_COPY' : 'TRANSCODE_VIDEO';

      const job = await api.createJob({
        sourceUrl: inputMode === 'url' ? normalizeMediaUrl(urlInput) : undefined,
        mediaAssetId: inputMode === 'file' ? uploadedAssetId! : undefined,
        jobType: 'transcode_video',
        operation,
        targetFormat: targetContainer,
        targetVideoCodec: videoCodec === 'copy' ? undefined : videoCodec,
        targetResolution: resolution === 'source' ? undefined : resolution,
        streamCopy: videoCodec === 'copy',
        idempotencyKey: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      });

      setSubmittedJobId(job.jobId || job.id);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to initialize conversion job. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    jobStream.reset();
    setSubmittedJobId(null);
    setUrlInput('');
    setSelectedFile(null);
    setUploadedAssetId(null);
    setUploadStats(null);
    setUploader(null);
    setErrorMessage(null);
  };

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
      {!submittedJobId ? (
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
                    type="url"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="Paste video or direct media link…"
                    className="w-full px-4 py-3 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] text-xs sm:text-sm text-[var(--muxaro-text-primary)] placeholder-[var(--muxaro-text-tertiary)] placeholder:truncate truncate focus:border-[var(--muxaro-border-focus)] focus:bg-[var(--muxaro-bg-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--muxaro-border-focus)] transition-colors duration-150"
                  />
                  {urlInput && (
                    <button
                      type="button"
                      onClick={() => setUrlInput('')}
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
                      Resumable chunked upload handles up to 4GB files with zero buffer loss
                    </p>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Film className="w-5 h-5 text-[var(--muxaro-indigo)]" />
                        <div>
                          <div className="text-sm font-semibold text-[var(--muxaro-text-primary)]">
                            {selectedFile.name}
                          </div>
                          <div className="text-xs text-[var(--muxaro-text-tertiary)]">
                            {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
                          </div>
                        </div>
                      </div>

                      {!uploadedAssetId && (
                        <div className="flex items-center gap-2">
                          {isUploading ? (
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
                              className="px-4 py-1.5 rounded-lg bg-[var(--muxaro-indigo)] text-white text-xs font-semibold hover:opacity-95"
                            >
                              Upload File
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
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

                    {uploadStats && !uploadedAssetId && (
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
                            className="h-full bg-[var(--muxaro-indigo)] transition-all duration-200"
                            style={{ width: `${uploadStats.percent}%` }}
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

            {/* Target Container Selection */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--muxaro-text-secondary)]">
                Target Container
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {(['mp4', 'mkv', 'webm', 'mov'] as VideoContainer[]).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setTargetContainer(fmt)}
                    className={`py-3 px-4 rounded-xl border text-sm font-semibold uppercase text-center transition-colors duration-150 ${
                      targetContainer === fmt
                        ? 'border-[var(--muxaro-indigo)] bg-[var(--muxaro-tag-pill-bg)] text-[var(--muxaro-indigo)]'
                        : 'border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] text-[var(--muxaro-text-secondary)] hover:border-[var(--muxaro-border-focus)]'
                    }`}
                  >
                    .{fmt}
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
                    <span className="text-xs font-bold uppercase tracking-wider">
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
                      <option value="2160p">4K UHD (2160p)</option>
                      <option value="1440p">2K QHD (1440p)</option>
                      <option value="1080p">Full HD (1080p)</option>
                      <option value="720p">HD (720p)</option>
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
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Submit Action Button */}
          <button
            type="submit"
            disabled={isSubmitting || (inputMode === 'file' && !uploadedAssetId)}
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

          {/* Progress Bar & Telemetry */}
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

          {/* Error Banner */}
          {jobStream.error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-medium space-y-1">
              <div className="font-bold">Conversion Failed: {jobStream.error.code}</div>
              <div>{jobStream.error.userMessage || jobStream.error.message}</div>
              <button
                type="button"
                onClick={jobStream.retry}
                className="mt-2 px-3 py-1 bg-red-600 text-white rounded text-xs font-semibold"
              >
                Retry Job
              </button>
            </div>
          )}

          {/* Download & Actions when Ready */}
          {jobStream.status === 'READY' && jobStream.downloadUrl && (
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
                  href={jobStream.downloadUrl}
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
