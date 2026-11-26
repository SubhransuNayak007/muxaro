'use client';

/**
 * Project MUXARO - Extract Audio Tool Component
 * Supports:
 * - MP3: 128k, 192k, 256k, 320k
 * - FLAC: Studio Lossless 16-bit & 24-bit
 * - WAV: Studio PCM Uncompressed (16-bit / 24-bit)
 * - AAC: 128k, 256k LC-AAC
 * - Web URL source or 4GB Local File Upload
 * - Real-time SSE progress tracking via useJobStream
 * - Strict Hallmark tokens, accessible styling, no blanket all-property transitions
 */

import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import {
  Music,
  Headphones,
  UploadCloud,
  Link2,
  CheckCircle2,
  AlertCircle,
  Download,
  RotateCcw,
  Play,
  Pause,
  X,
  ArrowRight,
} from 'lucide-react';
import { api, extractDisplayError, getApiBaseUrl } from '@/lib/api-client';
import TurnstileChallenge from '@/components/TurnstileChallenge';
import { useJobStream } from '@/hooks/use-job-stream';
import { ResumableMultipartUploader, MultipartUploadStats } from '@/lib/multipart-uploader';
import { FFmpegWorkerClient } from '@/lib/ffmpeg/ffmpeg-client';
import type { FFmpegProgress, FFmpegTaskResult } from '@/lib/ffmpeg/types';
import { normalizeMediaUrl, sanitizeSafeNavigationUrl, generateSecureId } from '@/lib/url-utils';

export type AudioFormat = 'copy' | 'mp3' | 'flac' | 'wav' | 'aac';
export type Mp3Bitrate = '128k' | '192k' | '256k' | '320k';
export type AacBitrate = '128k' | '256k';
export type PcmBitDepth = '16' | '24';

const SAFE_CHUNK_SIZE_BYTES = Math.floor(3.5 * 1024 * 1024);

function isBackendDisconnectedMessage(message: string): boolean {
  return (
    message.includes('ERR_BACKEND_NOT_CONFIGURED') ||
    message.includes('503') ||
    message.toLowerCase().includes('backend not configured')
  );
}

export function ExtractAudioTool() {
  const [inputMode, setInputMode] = useState<'url' | 'file'>('url');
  const [urlInput, setUrlInput] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedAssetId, setUploadedAssetId] = useState<string | null>(null);

  // Audio Target Settings
  const [format, setFormat] = useState<AudioFormat>('mp3');
  const [mp3Bitrate, setMp3Bitrate] = useState<Mp3Bitrate>('320k');
  const [aacBitrate, setAacBitrate] = useState<AacBitrate>('256k');
  const [pcmBitDepth, setPcmBitDepth] = useState<PcmBitDepth>('24');
  const [normalizeVolume, setNormalizeVolume] = useState<boolean>(true);
  const [audioChannels, setAudioChannels] = useState<'stereo' | 'mono'>('stereo');

  // Metadata tags
  const [tagTitle, setTagTitle] = useState<string>('');
  const [tagArtist, setTagArtist] = useState<string>('');
  const [trimStart, setTrimStart] = useState<string>('');
  const [trimEnd, setTrimEnd] = useState<string>('');
  const [fadeInSec, setFadeInSec] = useState<string>('0');
  const [fadeOutSec, setFadeOutSec] = useState<string>('0');

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
      onProgress: (stats) => setUploadStats(stats),
      onError: (err) => {
        const msg = err.message || 'File upload failed';
        setErrorMessage(msg);
        setBackendDisconnected(isBackendDisconnectedMessage(msg));
        setIsUploading(false);
      },
    });
    setUploader(instance);
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
      const msg = err?.message || 'Upload failed.';
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

  const runLocalFfmpegExtract = async () => {
    if (!selectedFile) return;
    if (localResult?.url) URL.revokeObjectURL(localResult.url);
    setLocalResult(null);
    setErrorMessage(null);
    setIsLocalProcessing(true);
    setLocalProgress({ ratio: 0, percent: 0, message: 'Initializing FFmpeg Web Worker…' });
    try {
      const bitrateStr = format === 'mp3' ? mp3Bitrate : format === 'aac' ? aacBitrate : undefined;
      const bitrateKbps = bitrateStr ? parseInt(bitrateStr, 10) : undefined;
      const client = FFmpegWorkerClient.getInstance();
      const result = await client.extractAudio({
        file: selectedFile,
        fileName: selectedFile.name,
        targetFormat: format,
        streamCopy: format === 'copy',
        bitrateKbps,
        onProgress: (prog) => setLocalProgress(prog),
      });
      setLocalResult(result);
    } catch (err: any) {
      setErrorMessage(
        err?.message || 'Local FFmpeg WASM audio extraction failed for this file.'
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
        setErrorMessage('Please enter an authorised media link.');
        return;
      }
    } else if (!uploadedAssetId) {
      setErrorMessage('Please upload your media file before extracting audio, or extract locally in browser.');
      return;
    }

    setIsSubmitting(true);
    try {
      const selectedBitrate = format === 'mp3' ? mp3Bitrate : format === 'aac' ? aacBitrate : undefined;

      const job = await api.createJob({
        sourceUrl: inputMode === 'url' ? normalizeMediaUrl(urlInput) : undefined,
        mediaAssetId: inputMode === 'file' ? uploadedAssetId! : undefined,
        uploadSessionId: inputMode === 'file' ? uploadedAssetId! : undefined,
        jobType: 'extract_audio',
        operation: format === 'copy' ? 'REMUX_STREAM_COPY' : 'EXTRACT_AUDIO',
        targetFormat: format === 'copy' ? 'native' : format,
        streamCopy: format === 'copy',
        targetAudioCodec: format,
        targetAudioBitrate: selectedBitrate,
        audioChannels: audioChannels === 'mono' ? 1 : 2,
        normalizeLoudness: normalizeVolume,
        trimStart: trimStart.trim() ? Number(trimStart) : undefined,
        trimEnd: trimEnd.trim() ? Number(trimEnd) : undefined,
        fadeInSec: Number(fadeInSec) > 0 ? Number(fadeInSec) : undefined,
        fadeOutSec: Number(fadeOutSec) > 0 ? Number(fadeOutSec) : undefined,
        metadata:
          tagTitle || tagArtist || format === 'wav' || format === 'flac'
            ? {
                ...(tagTitle ? { title: tagTitle } : {}),
                ...(tagArtist ? { artist: tagArtist } : {}),
                ...(format === 'wav' || format === 'flac' ? { pcmBitDepth } : {}),
              }
            : undefined,
        title: inputMode === 'file' && selectedFile ? selectedFile.name : undefined,
        captchaToken: captchaToken || undefined,
        idempotencyKey: generateSecureId('audio_'),
      });

      setSubmittedJobId(job.jobId || job.id);
    } catch (err: unknown) {
      const msg = extractDisplayError(err, 'Failed to submit audio extraction job.');
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
    setTagTitle('');
    setTagArtist('');
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
      <div className="border-b border-[var(--muxaro-border)] pb-6">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="p-1.5 rounded-lg bg-[var(--muxaro-tag-pill-bg)] text-[var(--muxaro-indigo)]">
            <Music className="w-5 h-5" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--muxaro-text-primary)]">
            Extract Audio
          </h1>
        </div>
        <p className="text-sm text-[var(--muxaro-text-secondary)]">
          Extract studio-grade audio bitstreams into MP3, FLAC lossless, WAV PCM, or AAC.
        </p>
      </div>

      {localResult ? (
        <div className="muxaro-card p-6 bg-[var(--muxaro-bg-surface)] border border-[var(--muxaro-border)] rounded-2xl shadow-[var(--muxaro-shadow-card)] space-y-5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
            <div>
              <h3 className="text-base font-bold text-[var(--muxaro-text-primary)]">
                Local Browser Audio Extraction Complete
              </h3>
              <p className="text-xs text-[var(--muxaro-text-secondary)]">
                Processed locally via FFmpeg Web Worker with zero server round-trip.
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
              <span>Extract Another Audio Track</span>
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
                <span>Web Audio/Video Link</span>
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
                  Video or Music URL
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
                    placeholder="Paste audio link or media URL…"
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
                  accept="video/*,audio/*"
                  className="hidden"
                />
                {!selectedFile ? (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-[var(--muxaro-border)] hover:border-[var(--muxaro-border-focus)] rounded-2xl p-8 text-center cursor-pointer bg-[var(--muxaro-bg-base)] hover:bg-[var(--muxaro-bg-surface)] transition-colors duration-150"
                  >
                    <UploadCloud className="w-10 h-10 mx-auto text-[var(--muxaro-indigo)] mb-3" />
                    <p className="text-sm font-semibold text-[var(--muxaro-text-primary)]">
                      Click to choose video/audio file
                    </p>
                    <p className="text-xs text-[var(--muxaro-text-tertiary)] mt-1">
                      Chunked uploads under 4 MB or instant browser FFmpeg extraction
                    </p>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <Music className="w-5 h-5 text-[var(--muxaro-indigo)] shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[var(--muxaro-text-primary)] truncate">
                            {selectedFile.name}
                          </div>
                          <div className="text-xs text-[var(--muxaro-text-tertiary)]">
                            {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
                          </div>
                        </div>
                      </div>

                      {!uploadedAssetId ? (
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
                              className="px-4 py-1.5 rounded-lg bg-[var(--muxaro-indigo)] text-white text-xs font-semibold hover:opacity-95"
                            >
                              Upload File
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={runLocalFfmpegExtract}
                            disabled={isLocalProcessing}
                            className="px-3 py-1.5 rounded-lg border border-[var(--muxaro-border)] text-xs font-semibold text-[var(--muxaro-text-primary)] hover:bg-[var(--muxaro-bg-elevated)] disabled:opacity-50"
                          >
                            {isLocalProcessing ? 'Extracting Locally…' : 'Process in Browser'}
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
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                          <CheckCircle2 className="w-4 h-4" /> Ready for extraction
                        </span>
                      )}
                    </div>

                    {isLocalProcessing && localProgress && (
                      <div className="space-y-1.5 pt-2">
                        <div className="flex justify-between text-xs text-[var(--muxaro-text-secondary)]">
                          <span>{localProgress.message || 'Extracting audio locally…'}</span>
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
                          <span>Uploading ({uploadStats.activeWorkers} concurrent streams)</span>
                          <span>
                            {uploadStats.percent}% • {uploadStats.mbps} MB/s
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

          {/* Audio Output Settings */}
          <div className="muxaro-card p-6 bg-[var(--muxaro-bg-surface)] border border-[var(--muxaro-border)] rounded-2xl shadow-[var(--muxaro-shadow-card)] space-y-6">
            <h2 className="text-base font-bold text-[var(--muxaro-text-primary)]">
              Output Audio Format & Quality
            </h2>

            {/* Format Buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {(
                [
                  { id: 'copy', label: 'COPY', desc: 'Original stream · Instant' },
                  { id: 'mp3', label: 'MP3', desc: 'Universal audio' },
                  { id: 'flac', label: 'FLAC', desc: 'Lossless master' },
                  { id: 'wav', label: 'WAV', desc: 'Studio PCM' },
                  { id: 'aac', label: 'AAC', desc: 'Apple / mobile' },
                ] as const
              ).map((fmt) => (
                <button
                  key={fmt.id}
                  type="button"
                  onClick={() => setFormat(fmt.id)}
                  className={`p-3 rounded-xl border text-left transition-colors duration-150 ${
                    format === fmt.id
                      ? 'border-[var(--muxaro-indigo)] bg-[var(--muxaro-tag-pill-bg)]'
                      : 'border-[var(--muxaro-border)] bg-[var(--muxaro-bg-base)] hover:border-[var(--muxaro-border-focus)]'
                  }`}
                >
                  <div className="text-sm font-bold text-[var(--muxaro-text-primary)]">
                    .{fmt.label}
                  </div>
                  <div className="text-[11px] text-[var(--muxaro-text-secondary)] mt-0.5">
                    {fmt.desc}
                  </div>
                </button>
              ))}
            </div>

            {/* Format-Specific Bitrate / Bit-Depth Configuration */}
            <div className="p-4 rounded-xl border border-[var(--muxaro-border-subtle)] bg-[var(--muxaro-bg-base)] space-y-4">
              {format === 'mp3' && (
                <div>
                  <label className="block text-xs font-semibold text-[var(--muxaro-text-secondary)] mb-2">
                    MP3 Bitrate Preset
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {(['128k', '192k', '256k', '320k'] as Mp3Bitrate[]).map((br) => (
                      <button
                        key={br}
                        type="button"
                        onClick={() => setMp3Bitrate(br)}
                        className={`py-2 px-3 rounded-lg border text-xs font-bold transition-colors duration-150 ${
                          mp3Bitrate === br
                            ? 'bg-[var(--muxaro-indigo)] text-white border-[var(--muxaro-indigo)]'
                            : 'bg-[var(--muxaro-bg-surface)] text-[var(--muxaro-text-secondary)] border-[var(--muxaro-border)]'
                        }`}
                      >
                        {br.replace('k', ' kbps')}
                        {br === '320k' && ' (Highest)'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {format === 'aac' && (
                <div>
                  <label className="block text-xs font-semibold text-[var(--muxaro-text-secondary)] mb-2">
                    AAC Bitrate Preset
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['128k', '256k'] as AacBitrate[]).map((br) => (
                      <button
                        key={br}
                        type="button"
                        onClick={() => setAacBitrate(br)}
                        className={`py-2 px-3 rounded-lg border text-xs font-bold transition-colors duration-150 ${
                          aacBitrate === br
                            ? 'bg-[var(--muxaro-indigo)] text-white border-[var(--muxaro-indigo)]'
                            : 'bg-[var(--muxaro-bg-surface)] text-[var(--muxaro-text-secondary)] border-[var(--muxaro-border)]'
                        }`}
                      >
                        {br.replace('k', ' kbps')} {br === '256k' && '(iTunes Match Quality)'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(format === 'wav' || format === 'flac') && (
                <div>
                  <label className="block text-xs font-semibold text-[var(--muxaro-text-secondary)] mb-2">
                    PCM Bit-Depth Resolution
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['16', '24'] as PcmBitDepth[]).map((depth) => (
                      <button
                        key={depth}
                        type="button"
                        onClick={() => setPcmBitDepth(depth)}
                        className={`py-2 px-3 rounded-lg border text-xs font-bold transition-colors duration-150 ${
                          pcmBitDepth === depth
                            ? 'bg-[var(--muxaro-indigo)] text-white border-[var(--muxaro-indigo)]'
                            : 'bg-[var(--muxaro-bg-surface)] text-[var(--muxaro-text-secondary)] border-[var(--muxaro-border)]'
                        }`}
                      >
                        {depth}-Bit {depth === '24' ? 'Studio Master (Hi-Res)' : 'Standard CD Audio'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Volume Normalization & Channel toggles */}
              <div className="pt-3 border-t border-[var(--muxaro-border-subtle)] flex flex-wrap items-center justify-between gap-4">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-[var(--muxaro-text-primary)]">
                  <input
                    type="checkbox"
                    checked={normalizeVolume}
                    onChange={(e) => setNormalizeVolume(e.target.checked)}
                    className="rounded border-[var(--muxaro-border)] text-[var(--muxaro-indigo)] focus:ring-[var(--muxaro-border-focus)]"
                  />
                  <span>EBU R128 Volume Normalization (-14 LUFS)</span>
                </label>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-[var(--muxaro-text-secondary)] font-medium">Channels:</span>
                  <button
                    type="button"
                    onClick={() => setAudioChannels('stereo')}
                    className={`px-2.5 py-1 rounded text-xs font-semibold ${
                      audioChannels === 'stereo'
                        ? 'bg-[var(--muxaro-indigo)] text-white'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    Stereo
                  </button>
                  <button
                    type="button"
                    onClick={() => setAudioChannels('mono')}
                    className={`px-2.5 py-1 rounded text-xs font-semibold ${
                      audioChannels === 'mono'
                        ? 'bg-[var(--muxaro-indigo)] text-white'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    Mono
                  </button>
                </div>
              </div>

              <div className="pt-3 border-t border-[var(--muxaro-border-subtle)] grid grid-cols-2 sm:grid-cols-4 gap-3">
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-[var(--muxaro-text-secondary)]">Trim Start (sec)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={trimStart}
                    onChange={(e) => setTrimStart(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-1.5 rounded-lg border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] text-xs font-mono text-[var(--muxaro-text-primary)]"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-[var(--muxaro-text-secondary)]">Trim End (sec)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={trimEnd}
                    onChange={(e) => setTrimEnd(e.target.value)}
                    placeholder="Full"
                    className="w-full px-3 py-1.5 rounded-lg border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] text-xs font-mono text-[var(--muxaro-text-primary)]"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-[var(--muxaro-text-secondary)]">Fade In (sec)</span>
                  <input
                    type="number"
                    min={0}
                    max={15}
                    step={0.5}
                    value={fadeInSec}
                    onChange={(e) => setFadeInSec(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] text-xs font-mono text-[var(--muxaro-text-primary)]"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-[var(--muxaro-text-secondary)]">Fade Out (sec)</span>
                  <input
                    type="number"
                    min={0}
                    max={15}
                    step={0.5}
                    value={fadeOutSec}
                    onChange={(e) => setFadeOutSec(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] text-xs font-mono text-[var(--muxaro-text-primary)]"
                  />
                </label>
              </div>

              <div className="pt-3 border-t border-[var(--muxaro-border-subtle)] grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={tagTitle}
                  onChange={(e) => setTagTitle(e.target.value)}
                  placeholder="Optional track title metadata"
                  className="px-3 py-2 rounded-lg border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] text-xs text-[var(--muxaro-text-primary)]"
                />
                <input
                  type="text"
                  value={tagArtist}
                  onChange={(e) => setTagArtist(e.target.value)}
                  placeholder="Optional artist metadata"
                  className="px-3 py-2 rounded-lg border border-[var(--muxaro-border)] bg-[var(--muxaro-bg-surface)] text-xs text-[var(--muxaro-text-primary)]"
                />
              </div>
            </div>
          </div>

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
                    onClick={runLocalFfmpegExtract}
                    disabled={isLocalProcessing}
                    className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                  >
                    Extract Locally (FFmpeg WASM)
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

          <TurnstileChallenge
            onVerify={(tok) => {
              setCaptchaToken(tok);
              setErrorMessage((prev) =>
                prev && /verification|captcha/i.test(prev) ? null : prev
              );
            }}
            onReset={() => setCaptchaToken('')}
          />

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
              <span>Submitting Audio Extraction…</span>
            ) : (
              <>
                <span>Extract .{format.toUpperCase()} Audio</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      ) : (
        /* Live Progress and Ready View */
        <div className="muxaro-card p-6 bg-[var(--muxaro-bg-surface)] border border-[var(--muxaro-border)] rounded-2xl shadow-[var(--muxaro-shadow-card)] space-y-6">
          <div className="flex items-center justify-between border-b border-[var(--muxaro-border-subtle)] pb-4">
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-xl bg-[var(--muxaro-tag-pill-bg)] text-[var(--muxaro-indigo)]">
                <Headphones className="w-6 h-6" />
              </span>
              <div>
                <h3 className="text-base font-bold text-[var(--muxaro-text-primary)]">
                  Extracting .{format.toUpperCase()}
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
              <div className="font-bold">Extraction Failed: {jobStream.error.code}</div>
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
                    Audio Extracted Successfully!
                  </h4>
                  <p className="text-xs text-emerald-700 dark:text-emerald-400">
                    Clean, normalized audio master ready for download or cloud saving.
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
                  <span>Download .{format.toUpperCase()} Audio</span>
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
                  <span>Extract Another Audio Track</span>
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
                Cancel Extraction
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ExtractAudioTool;
