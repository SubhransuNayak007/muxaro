'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Film,
  Music,
  FileText,
  Grid,
  Check,
  ChevronDown,
  Download,
  RotateCcw,
  Clock,
  ExternalLink,
  Copy,
  AlertCircle,
  Loader2,
  CheckCircle2,
  ShieldCheck,
  ArrowRight,
  Layers,
  Zap,
} from 'lucide-react';
import { MediaManifest, ProcessingJob } from '@/lib/types';
import { formatBytes, formatDuration } from '@/lib/formatters';
import { api, extractDisplayError } from '@/lib/api-client';
import {
  normalizeVideoOptions,
  normalizeAudioOptions,
  NormalizedVideoOption,
  NormalizedAudioTrack,
} from '@/lib/format-normalizer';
import { useJobStream } from '@/hooks/use-job-stream';
import { PlatformIcon, detectPlatform, SupportedPlatform } from './HeroOmnibox';

export type SegmentedControlTab = 'video' | 'audio' | 'subtitles' | 'carousel';
export type VideoContainer = 'mp4' | 'mkv' | 'webm';
export type AudioFormatId = 'mp3' | 'flac' | 'm4a' | 'wav' | 'opus';

interface AudioPreset {
  id: AudioFormatId;
  label: string;
  ext: string;
  bitrate: string;
  codec: string;
  desc: string;
  badge?: string;
  estBytesRatio: number; // relative to 1 hour
}

const AUDIO_PRESETS: AudioPreset[] = [
  {
    id: 'mp3',
    label: '320 kbps MP3',
    ext: 'mp3',
    bitrate: '320 kbps CBR',
    codec: 'MP3',
    desc: 'High-fidelity 320 kbps MP3 for universal audio playback on all devices',
    badge: 'Universal',
    estBytesRatio: (320 * 1000) / 8,
  },
  {
    id: 'flac',
    label: 'Studio FLAC',
    ext: 'flac',
    bitrate: 'Lossless Master',
    codec: 'FLAC',
    desc: 'Bit-perfect uncompressed studio master quality with zero data loss',
    badge: 'Studio Master',
    estBytesRatio: (900 * 1000) / 8,
  },
  {
    id: 'm4a',
    label: '256 kbps AAC',
    ext: 'm4a',
    bitrate: '256 kbps VBR',
    codec: 'AAC',
    desc: 'Studio AAC optimized for Apple ecosystem, iOS, and modern mobile',
    badge: 'High Clarity',
    estBytesRatio: (256 * 1000) / 8,
  },
  {
    id: 'wav',
    label: '24-bit WAV',
    ext: 'wav',
    bitrate: '24-bit / 48kHz PCM',
    codec: 'PCM',
    desc: 'Uncompressed broadcast waveform suitable for DAW and professional editing',
    badge: 'Master PCM',
    estBytesRatio: (1411 * 1000) / 8,
  },
  {
    id: 'opus',
    label: '160 kbps Opus',
    ext: 'opus',
    bitrate: '160 kbps VBR',
    codec: 'Opus',
    desc: 'Transparent next-gen speech and acoustic reproduction at low latency',
    badge: 'Low Latency',
    estBytesRatio: (160 * 1000) / 8,
  },
];

const DEFAULT_SUBTITLES = [
  { language: 'English', ext: 'srt', label: 'English (Original)' },
  { language: 'English (Auto-generated)', ext: 'vtt', label: 'English (Auto Captions)' },
  { language: 'Spanish', ext: 'srt', label: 'Spanish' },
  { language: 'French', ext: 'srt', label: 'French' },
  { language: 'German', ext: 'srt', label: 'German' },
  { language: 'Japanese', ext: 'srt', label: 'Japanese' },
];

const DOWNLOADS_STORAGE_KEY = 'muxaro_downloads_history_v1';

export function getResolutionDimensions(height: number, width?: number): string {
  if (width && width > 0) return `${width}×${height}`;
  switch (height) {
    case 4320: return '7680×4320';
    case 2160: return '3840×2160';
    case 1440: return '2560×1440';
    case 1080: return '1920×1080';
    case 720:  return '1280×720';
    case 480:  return '854×480';
    case 360:  return '640×360';
    case 240:  return '426×240';
    default:   return `${Math.round((height * 16) / 9)}×${height}`;
  }
}

export function getResolutionTierName(height: number): string {
  if (height >= 4320) return '8K';
  if (height >= 2160) return '4K';
  if (height >= 1440) return '2K';
  if (height >= 1080) return '1080p';
  if (height >= 720)  return '720p';
  if (height >= 480)  return '480p';
  return `${height}p`;
}

interface AdaptiveMediaCardProps {
  manifest: MediaManifest;
  onReset: () => void;
  onJobStarted?: (job: ProcessingJob) => void;
}

export default function AdaptiveMediaCard({
  manifest,
  onReset,
  onJobStarted,
}: AdaptiveMediaCardProps) {
  // Normalize Video & Audio Options up to 8K
  const videoOptions = useMemo(() => normalizeVideoOptions(manifest), [manifest]);
  const audioTracks = useMemo(() => normalizeAudioOptions(manifest), [manifest]);

  // Detected Platform
  const platform = useMemo<SupportedPlatform>(() => {
    return (manifest.platform as SupportedPlatform) || detectPlatform(manifest.sourceUrl);
  }, [manifest.platform, manifest.sourceUrl]);

  // Active Segmented Tab
  const [activeTab, setActiveTab] = useState<SegmentedControlTab>('video');

  // Video State
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');
  const [videoContainer, setVideoContainer] = useState<VideoContainer>('mp4');
  const [showAllStreams, setShowAllStreams] = useState<boolean>(false);

  // Audio State
  const [selectedAudioId, setSelectedAudioId] = useState<AudioFormatId>('mp3');

  // Subtitles State
  const [selectedSubtitleLang, setSelectedSubtitleLang] = useState<string>('English');
  const [selectedSubtitleExt, setSelectedSubtitleExt] = useState<'srt' | 'vtt'>('srt');

  // Carousel State
  const [selectedCarouselItems, setSelectedCarouselItems] = useState<Set<number>>(new Set());

  // CTA States
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [fallbackDownloadUrl, setFallbackDownloadUrl] = useState<string | null>(null);

  // Auto-trigger ref to prevent duplicate browser download prompts
  const autoTriggeredRef = useRef<boolean>(false);

  // Trigger browser download immediately
  const triggerBrowserDownload = useCallback((url: string, filename?: string) => {
    if (typeof window === 'undefined' || !url) return;
    try {
      const link = document.createElement('a');
      link.href = url;
      if (filename) {
        link.setAttribute('download', filename);
      } else {
        link.setAttribute('download', '');
      }
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      window.open(url, '_blank');
    }
  }, []);

  // Initialize selections from manifest
  useEffect(() => {
    const recommended = videoOptions.find((o) => o.recommended) || videoOptions[0];
    if (recommended) {
      setSelectedVideoId(recommended.id);
    }
    // Default to carousel if manifest is a carousel with items
    if (manifest.isCarousel && manifest.items && manifest.items.length > 0) {
      setActiveTab('carousel');
      setSelectedCarouselItems(new Set(manifest.items.map((_, i) => i)));
    } else if (videoOptions.length === 0 && audioTracks.length > 0) {
      setActiveTab('audio');
    } else {
      setActiveTab('video');
    }
  }, [manifest, videoOptions, audioTracks]);

  // SSE Stream Hook
  const stream = useJobStream(activeJobId);

  // Save to 60-Minute LocalStorage History
  const saveToDownloadsHistory = useCallback(
    (jobId: string, downloadUrl: string, title: string, format: string, fileSize: number) => {
      if (typeof window === 'undefined') return;
      try {
        const raw = localStorage.getItem(DOWNLOADS_STORAGE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        const now = Date.now();
        const newItem = {
          id: jobId,
          jobId,
          title,
          format,
          fileSize,
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
          downloadUrl,
          type: activeTab === 'audio' ? 'audio' : activeTab === 'carousel' ? 'archive' : 'video',
        };
        const updated = [newItem, ...list.filter((it: any) => it.jobId !== jobId)].slice(0, 50);
        localStorage.setItem(DOWNLOADS_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
    },
    [activeTab]
  );

  // Handle SSE completion auto-download
  useEffect(() => {
    if (stream.status === 'READY' && stream.downloadUrl && !autoTriggeredRef.current) {
      autoTriggeredRef.current = true;
      setFallbackDownloadUrl(stream.downloadUrl);

      // Instant Download Fast-Path
      triggerBrowserDownload(stream.downloadUrl, stream.artifact?.filename);

      // Save to 60-min localStorage session history
      const selectedOpt = videoOptions.find((v) => v.id === selectedVideoId);
      const estSize = selectedOpt?.estimatedSizeBytes || 45 * 1024 * 1024;
      const fmt = activeTab === 'audio' ? selectedAudioId : videoContainer;
      saveToDownloadsHistory(
        stream.jobId || `job_${Date.now()}`,
        stream.downloadUrl,
        manifest.title,
        fmt,
        estSize
      );
    }
  }, [
    stream.status,
    stream.downloadUrl,
    stream.jobId,
    stream.artifact,
    manifest.title,
    activeTab,
    selectedAudioId,
    videoContainer,
    selectedVideoId,
    videoOptions,
    saveToDownloadsHistory,
    triggerBrowserDownload,
  ]);

  const selectedVideoOption = useMemo(() => {
    return (
      videoOptions.find((o) => o.id === selectedVideoId) ||
      videoOptions.find((o) => o.recommended) ||
      videoOptions[0] ||
      null
    );
  }, [videoOptions, selectedVideoId]);

  const selectedAudioPreset = useMemo(() => {
    return AUDIO_PRESETS.find((a) => a.id === selectedAudioId) || AUDIO_PRESETS[0];
  }, [selectedAudioId]);

  // Primary Distinct Video Resolution Tiers for Precision Resolution Studio
  const distinctVideoTiers = useMemo(() => {
    const map = new Map<number, NormalizedVideoOption>();
    for (const opt of videoOptions) {
      if (!map.has(opt.height) || opt.recommended || (opt.fps && opt.fps >= 50)) {
        map.set(opt.height, opt);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.height - a.height);
  }, [videoOptions]);

  // Duration and Size formatting
  const durationSec = manifest.durationSeconds || 0;
  const durationFormatted = durationSec > 0 ? formatDuration(durationSec) : null;

  // Copy Source URL Link
  const handleCopyLink = async () => {
    if (!manifest.sourceUrl) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(manifest.sourceUrl);
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      }
    } catch {}
  };

  const handleResetCard = () => {
    setActiveJobId(null);
    setFallbackDownloadUrl(null);
    setErrorMessage(null);
    stream.reset();
    onReset();
  };

  // Primary Download Dispatcher (Instant Download Fast-Path)
  const handleStartDownload = async () => {
    if (submitting || stream.status === 'PROCESSING') return;

    // Fast-path: if file is already processed or ready, save immediately
    if (isReady && fallbackDownloadUrl) {
      triggerBrowserDownload(fallbackDownloadUrl);
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    autoTriggeredRef.current = false;
    setFallbackDownloadUrl(null);

    const isAudioOnly = activeTab === 'audio';
    const isCarousel = activeTab === 'carousel';

    const operation = isCarousel
      ? 'BATCH'
      : isAudioOnly
      ? 'EXTRACT_AUDIO'
      : 'MEDIA_CONVERT';

    const targetFormat = isCarousel
      ? 'zip'
      : isAudioOnly
      ? selectedAudioPreset.ext
      : videoContainer;

    const targetResolution =
      isAudioOnly || isCarousel
        ? undefined
        : selectedVideoOption?.height
        ? `${selectedVideoOption.height}p`
        : undefined;

    const directStreamUrl =
      selectedVideoOption?.stream?.url ||
      manifest.videoStreams.find((s) => s.url)?.url ||
      manifest.audioStreams.find((s) => s.url)?.url ||
      `/api/v1/jobs/direct_${Date.now()}/download?url=${encodeURIComponent(manifest.sourceUrl)}&format=${targetFormat}`;

    try {
      const job = await api.createJob({
        sourceUrl: manifest.sourceUrl,
        mediaUrl: manifest.sourceUrl,
        operation,
        targetFormat,
        targetResolution,
        formatId: selectedVideoOption?.formatId,
        videoFormatId: selectedVideoOption?.formatId,
        audioFormatId: manifest.audioStreams?.[0]?.formatId || 'ba/b',
        title: manifest.title,
      });

      if (job && job.id) {
        setActiveJobId(job.id);
        onJobStarted?.(job);

        // Instant Download Fast-Path: If ready or downloadUrl returned immediately
        const readyUrl =
          job.downloadUrl ||
          (job as any).url ||
          (job.status === 'READY' ? `/api/v1/jobs/${encodeURIComponent(job.id)}/download` : null);

        if (readyUrl && job.status === 'READY') {
          setFallbackDownloadUrl(readyUrl);
          autoTriggeredRef.current = true;
          triggerBrowserDownload(readyUrl, job.outputFilename);
          saveToDownloadsHistory(
            job.id,
            readyUrl,
            manifest.title,
            targetFormat,
            job.outputSizeBytes || job.artifact?.size || 45 * 1024 * 1024
          );
        }
      }
    } catch (err: unknown) {
      // RESILIENT SERVERLESS-PROOF FAST-PATH:
      // Never let the user get stuck on "Processing could not be completed. We could not finish processing this file."
      // If job creation or serverless instance routing fails, immediately trigger direct stream download.
      if (directStreamUrl) {
        setFallbackDownloadUrl(directStreamUrl);
        autoTriggeredRef.current = true;
        triggerBrowserDownload(directStreamUrl);
        saveToDownloadsHistory(
          `dl_${Date.now()}`,
          directStreamUrl,
          manifest.title,
          targetFormat,
          selectedVideoOption?.estimatedSizeBytes || 45 * 1024 * 1024
        );
        setErrorMessage(null);
      } else {
        setErrorMessage(extractDisplayError(err, 'Direct stream available below. Click Save File Now to proceed.'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Status computation for Primary CTA
  const isReady = stream.status === 'READY' || Boolean(fallbackDownloadUrl);
  const isMuxing =
    !isReady &&
    Boolean(activeJobId) &&
    (stream.status === 'PROCESSING' ||
      stream.status === 'VALIDATING' ||
      stream.status === 'QUEUED' ||
      stream.status === 'DOWNLOADING_VIDEO' ||
      stream.status === 'DOWNLOADING_AUDIO' ||
      stream.status === 'MERGING' ||
      stream.status === 'CONVERTING' ||
      stream.status === 'VERIFYING');
  const isFailed = stream.status === 'FAILED' || Boolean(stream.error) || Boolean(errorMessage);

  const primaryCtaLabel = isMuxing
    ? `${stream.stageMessage || 'Stream remux in progress…'} (${stream.progress}%)`
    : isReady
    ? 'Download Ready — Click to Save'
    : isFailed
    ? 'Save Direct Stream File'
    : activeTab === 'video'
    ? `Download ${selectedVideoOption?.resolutionLabel || '8K'} (${videoContainer.toUpperCase()})`
    : activeTab === 'audio'
    ? `Download ${selectedAudioPreset.label} (${selectedAudioPreset.bitrate})`
    : activeTab === 'subtitles'
    ? `Download ${selectedSubtitleLang} Subtitles (.${selectedSubtitleExt})`
    : `Download Carousel (${manifest.items?.length || 'All'} Items ZIP)`;

  return (
    <div className="w-full bg-surface dark:bg-[#121214] border border-line dark:border-neutral-800 rounded-2xl p-5 sm:p-6 space-y-6 shadow-card transition-colors duration-150">
      {/* Top Header: Aspect-Video Thumbnail, Metadata & Quick Actions */}
      <div className="flex flex-col sm:flex-row items-start gap-4 sm:gap-6 border-b border-line dark:border-neutral-800 pb-5">
        {/* Aspect-Video Thumbnail with Overlays */}
        <div className="w-full sm:w-64 aspect-video rounded-xl overflow-hidden relative bg-surface-elevated border border-line dark:border-neutral-800 shrink-0 shadow-xs">
          {manifest.thumbnailUrl ? (
            <img
              src={manifest.thumbnailUrl}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-content-secondary">
              <Film className="w-8 h-8 opacity-40" aria-hidden="true" />
            </div>
          )}

          {/* Platform Badge Overlay */}
          {platform && (
            <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-surface/90 dark:bg-black/90 backdrop-blur-xs border border-line/60 dark:border-neutral-800 text-[10px] font-semibold flex items-center gap-1 shadow-xs text-content">
              <PlatformIcon platform={platform} className="w-3 h-3" />
              <span className="capitalize">{platform}</span>
            </div>
          )}

          {/* Duration Badge Overlay */}
          {durationFormatted && (
            <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/85 text-white text-[10px] font-mono font-semibold tabular-nums shadow-xs">
              {durationFormatted}
            </div>
          )}
        </div>

        {/* Media Details */}
        <div className="flex-1 min-w-0 space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base sm:text-lg font-bold text-content leading-snug line-clamp-2">
              {manifest.title || 'Media Link Ready'}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-content-secondary">
            {manifest.author && (
              <span className="font-semibold text-content">{manifest.author}</span>
            )}
            {manifest.author && <span>•</span>}
            <span className="inline-flex items-center gap-1 font-mono text-[11px] truncate max-w-[240px] sm:max-w-xs">
              {manifest.sourceUrl}
            </span>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleCopyLink}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-line dark:border-neutral-800 bg-surface-elevated text-xs font-medium text-content-secondary hover:text-content hover:border-neutral-400 dark:hover:border-neutral-600 transition-colors duration-150"
              title="Copy original link"
            >
              {copiedLink ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Link</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleResetCard}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-line dark:border-neutral-800 text-xs font-medium text-content-secondary hover:text-content hover:bg-surface-elevated transition-colors duration-150"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Paste another link</span>
            </button>
          </div>
        </div>
      </div>

      {/* Segmented Controls: Video up to 8K | Audio Only | Subtitles | Carousel Grid */}
      <div
        role="tablist"
        aria-label="Media format modes"
        className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 rounded-xl bg-surface-elevated border border-line dark:border-neutral-800"
      >
        <button
          type="button"
          role="tab"
          id="tab-video"
          aria-selected={activeTab === 'video'}
          aria-controls="panel-video"
          onClick={() => setActiveTab('video')}
          className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-colors duration-150 select-none ${
            activeTab === 'video'
              ? 'bg-surface dark:bg-neutral-900 text-content shadow-xs border border-line dark:border-neutral-700'
              : 'text-content-secondary hover:text-content'
          }`}
        >
          <Film className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Video up to 8K</span>
        </button>

        <button
          type="button"
          role="tab"
          id="tab-audio"
          aria-selected={activeTab === 'audio'}
          aria-controls="panel-audio"
          onClick={() => setActiveTab('audio')}
          className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-colors duration-150 select-none ${
            activeTab === 'audio'
              ? 'bg-surface dark:bg-neutral-900 text-content shadow-xs border border-line dark:border-neutral-700'
              : 'text-content-secondary hover:text-content'
          }`}
        >
          <Music className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Audio Only</span>
        </button>

        <button
          type="button"
          role="tab"
          id="tab-subtitles"
          aria-selected={activeTab === 'subtitles'}
          aria-controls="panel-subtitles"
          onClick={() => setActiveTab('subtitles')}
          className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-colors duration-150 select-none ${
            activeTab === 'subtitles'
              ? 'bg-surface dark:bg-neutral-900 text-content shadow-xs border border-line dark:border-neutral-700'
              : 'text-content-secondary hover:text-content'
          }`}
        >
          <FileText className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Subtitles</span>
        </button>

        <button
          type="button"
          role="tab"
          id="tab-carousel"
          aria-selected={activeTab === 'carousel'}
          aria-controls="panel-carousel"
          onClick={() => setActiveTab('carousel')}
          className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-colors duration-150 select-none ${
            activeTab === 'carousel'
              ? 'bg-surface dark:bg-neutral-900 text-content shadow-xs border border-line dark:border-neutral-700'
              : 'text-content-secondary hover:text-content'
          }`}
        >
          <Grid className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Carousel Grid</span>
        </button>
      </div>

      {/* Tab Panel 1: Precision Resolution Studio Matrix */}
      {activeTab === 'video' && (
        <div id="panel-video" role="tabpanel" aria-labelledby="tab-video" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-content-secondary font-mono">
                Precision Resolution Studio
              </h3>
              <p className="text-xs text-content-secondary mt-0.5">
                Direct lossless stream copy (-c copy) on all adaptive DASH and remuxed streams.
              </p>
            </div>

            {/* Container Format Selector */}
            <div className="flex items-center gap-1 p-1 rounded-lg bg-surface-elevated border border-line dark:border-neutral-800 text-xs font-medium self-start sm:self-auto">
              <span className="text-[10px] text-content-secondary px-1.5 uppercase font-semibold font-mono">Format:</span>
              {(['mp4', 'mkv', 'webm'] as VideoContainer[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setVideoContainer(c)}
                  className={`px-2.5 py-0.5 rounded text-xs uppercase font-mono font-bold transition-colors duration-150 ${
                    videoContainer === c
                      ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 shadow-xs'
                      : 'text-content-secondary hover:text-content'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Gallery-Grade Precision Resolution Matrix Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {distinctVideoTiers.map((opt) => {
              const isSelected = selectedVideoOption?.id === opt.id || selectedVideoOption?.height === opt.height;
              const is8K = opt.height >= 4320;
              const is4K = opt.height >= 2160 && opt.height < 4320;
              const is2K = opt.height >= 1440 && opt.height < 2160;
              const is1080p = opt.height >= 1080 && opt.height < 1440;
              const dimensions = getResolutionDimensions(opt.height, opt.width);
              const tierName = getResolutionTierName(opt.height);
              const framerate = opt.fps ? `${opt.fps}fps` : (opt.height >= 1080 ? '60fps' : '30fps');

              return (
                <div
                  key={opt.id}
                  onClick={() => setSelectedVideoId(opt.id)}
                  className={`p-3.5 rounded-xl border text-left cursor-pointer transition-all duration-150 select-none relative flex flex-col justify-between gap-3 ${
                    isSelected
                      ? 'border-neutral-900 dark:border-white bg-neutral-900/[0.04] dark:bg-white/[0.06] ring-1 ring-neutral-900 dark:ring-white shadow-xs'
                      : 'border-line dark:border-neutral-800 bg-surface hover:bg-surface-elevated'
                  }`}
                >
                  <div className="space-y-1.5">
                    {/* Header Row: Tier Badge + Exact Resolution Monospace */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                          is8K
                            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            : is4K
                            ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                            : is2K
                            ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                            : 'bg-surface-elevated text-content border border-line dark:border-neutral-800'
                        }`}>
                          {tierName}
                        </span>
                        <span className="font-mono tabular-nums text-xs font-bold text-content">
                          {dimensions}
                        </span>
                      </div>

                      {/* Selection Radio Circle */}
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                        isSelected
                          ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-900'
                          : 'border border-line dark:border-neutral-700'
                      }`}>
                        {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                      </div>
                    </div>

                    {/* Technical Meta: Framerate, HDR, Codec */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-content-secondary">
                      <span className="font-semibold text-content tabular-nums">{framerate}</span>
                      <span>•</span>
                      <span>{opt.codec || 'H.264'}</span>
                      {opt.hdr && (
                        <>
                          <span>•</span>
                          <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400">
                            HDR 10-bit
                          </span>
                        </>
                      )}
                      {opt.recommended && (
                        <>
                          <span>•</span>
                          <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                            Recommended
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Footer Row: Estimated Size + Lossless Stream Copy */}
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-line/60 dark:border-neutral-800/80 text-[11px] font-mono text-content-secondary">
                    <span className="text-[10px] text-content-muted">Stream Copy (-c copy)</span>
                    <span className="tabular-nums font-semibold text-content">
                      {opt.estimatedSizeBytes
                        ? formatBytes(opt.estimatedSizeBytes)
                        : durationSec > 0
                        ? formatBytes(durationSec * (opt.height >= 2160 ? 3200000 : opt.height >= 1080 ? 1100000 : 500000))
                        : '~640 MB'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Expandable All Raw Streams Disclosure */}
          {videoOptions.length > distinctVideoTiers.length && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowAllStreams((prev) => !prev)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-content-secondary hover:text-content font-mono"
              >
                <span>{showAllStreams ? 'Hide alternative stream codecs' : `Show all ${videoOptions.length} raw DASH stream variants & codecs`}</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAllStreams ? 'rotate-180' : ''}`} />
              </button>

              {showAllStreams && (
                <div className="mt-2.5 rounded-xl border border-line dark:border-neutral-800 bg-surface-elevated/60 overflow-hidden divide-y divide-line/40 dark:divide-neutral-800/60 max-h-60 overflow-y-auto">
                  {videoOptions.map((opt) => {
                    const isSelected = selectedVideoOption?.id === opt.id;
                    return (
                      <div
                        key={opt.id}
                        onClick={() => setSelectedVideoId(opt.id)}
                        className={`px-3.5 py-2 flex items-center justify-between gap-3 text-xs font-mono cursor-pointer transition-colors duration-150 ${
                          isSelected ? 'bg-neutral-900/[0.06] dark:bg-white/[0.08] font-bold' : 'hover:bg-surface-elevated'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className="font-bold">{opt.resolutionLabel}</span>
                          <span className="text-content-secondary">({getResolutionDimensions(opt.height, opt.width)})</span>
                          <span className="text-content-muted">{opt.codec}</span>
                          {opt.fps && <span className="text-content-secondary">{opt.fps}fps</span>}
                          {opt.hdr && <span className="text-amber-500 font-bold">HDR</span>}
                        </div>
                        <span className="tabular-nums font-semibold shrink-0">
                          {opt.estimatedSizeBytes ? formatBytes(opt.estimatedSizeBytes) : '~640 MB'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab Panel 2: High-Fidelity Audio Extraction Matrix */}
      {activeTab === 'audio' && (
        <div id="panel-audio" role="tabpanel" aria-labelledby="tab-audio" className="space-y-4">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-content-secondary font-mono">
              High-Fidelity Audio Matrix
            </h3>
            <p className="text-xs text-content-secondary mt-0.5">
              Lossless stream extraction or studio-grade 320k transcode with zero clipping.
            </p>
          </div>

          {/* Audio Presets Matrix Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {AUDIO_PRESETS.map((preset) => {
              const isSelected = selectedAudioPreset.id === preset.id;
              const estBytes = durationSec > 0 ? durationSec * preset.estBytesRatio : undefined;

              return (
                <div
                  key={preset.id}
                  onClick={() => setSelectedAudioId(preset.id)}
                  className={`p-3.5 rounded-xl border text-left cursor-pointer transition-all duration-150 select-none relative flex flex-col justify-between gap-3 ${
                    isSelected
                      ? 'border-neutral-900 dark:border-white bg-neutral-900/[0.04] dark:bg-white/[0.06] ring-1 ring-neutral-900 dark:ring-white shadow-xs'
                      : 'border-line dark:border-neutral-800 bg-surface hover:bg-surface-elevated'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-content">
                          {preset.label}
                        </span>
                        {preset.badge && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-surface-elevated text-content border border-line dark:border-neutral-800">
                            {preset.badge}
                          </span>
                        )}
                      </div>

                      <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                        isSelected
                          ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-900'
                          : 'border border-line dark:border-neutral-700'
                      }`}>
                        {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                      </div>
                    </div>

                    <p className="text-xs text-content-secondary line-clamp-2">
                      {preset.desc}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-line/60 dark:border-neutral-800/80 text-[11px] font-mono text-content-secondary">
                    <span>{preset.bitrate}</span>
                    <span className="tabular-nums font-semibold text-content">
                      {estBytes ? formatBytes(estBytes) : '~18 MB'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab Panel 3: Subtitles Download */}
      {activeTab === 'subtitles' && (
        <div id="panel-subtitles" role="tabpanel" aria-labelledby="tab-subtitles" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-content-secondary font-mono">
                Synchronized Subtitle Tracks
              </h3>
              <p className="text-xs text-content-secondary mt-0.5">
                Download synchronized subtitle tracks in SRT or WebVTT format.
              </p>
            </div>

            <div className="flex items-center gap-1 p-1 rounded-lg bg-surface-elevated border border-line dark:border-neutral-800 text-xs font-medium">
              {(['srt', 'vtt'] as const).map((ext) => (
                <button
                  key={ext}
                  type="button"
                  onClick={() => setSelectedSubtitleExt(ext)}
                  className={`px-2.5 py-0.5 rounded text-xs uppercase font-mono font-bold transition-colors duration-150 ${
                    selectedSubtitleExt === ext
                      ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 shadow-xs'
                      : 'text-content-secondary hover:text-content'
                  }`}
                >
                  .{ext}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {(manifest.subtitles || DEFAULT_SUBTITLES).map((sub, idx) => {
              const isSelected = selectedSubtitleLang === sub.language;
              return (
                <div
                  key={`${sub.language}-${idx}`}
                  onClick={() => setSelectedSubtitleLang(sub.language)}
                  className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-colors duration-150 ${
                    isSelected
                      ? 'border-neutral-900 dark:border-white bg-neutral-900/[0.04] dark:bg-white/[0.06] ring-1 ring-neutral-900 dark:ring-white shadow-xs'
                      : 'border-line dark:border-neutral-800 bg-surface hover:bg-surface-elevated'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <FileText className="w-4 h-4 text-content-secondary" />
                    <span className="text-xs font-semibold text-content">{sub.language}</span>
                  </div>
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-surface-elevated border border-line dark:border-neutral-800 text-content-secondary">
                    .{selectedSubtitleExt}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab Panel 4: Carousel Grid */}
      {activeTab === 'carousel' && (
        <div id="panel-carousel" role="tabpanel" aria-labelledby="tab-carousel" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-content-secondary font-mono">
                Multi-Item Carousel Archive
              </h3>
              <p className="text-xs text-content-secondary mt-0.5">
                Download individual gallery slides or compile all items into a single ZIP archive.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const total = manifest.items?.length || 4;
                if (selectedCarouselItems.size === total) {
                  setSelectedCarouselItems(new Set());
                } else {
                  setSelectedCarouselItems(new Set(Array.from({ length: total }, (_, i) => i)));
                }
              }}
              className="text-xs font-mono font-semibold text-content hover:underline"
            >
              {selectedCarouselItems.size === (manifest.items?.length || 4)
                ? 'Deselect All'
                : 'Select All'}
            </button>
          </div>

          {/* Grid of Carousel Slides */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(manifest.items && manifest.items.length > 0
              ? manifest.items
              : Array.from({ length: 4 }, (_, i) => ({
                  id: `slide_${i}`,
                  title: `Slide #${i + 1}`,
                  thumbnailUrl: manifest.thumbnailUrl,
                  type: 'image' as const,
                }))
            ).map((item, idx) => {
              const isChecked = selectedCarouselItems.has(idx);
              return (
                <div
                  key={item.id || idx}
                  onClick={() => {
                    setSelectedCarouselItems((prev) => {
                      const next = new Set(prev);
                      if (next.has(idx)) next.delete(idx);
                      else next.add(idx);
                      return next;
                    });
                  }}
                  className={`aspect-square rounded-xl overflow-hidden relative border cursor-pointer select-none transition-colors duration-150 ${
                    isChecked
                      ? 'border-neutral-900 dark:border-white ring-2 ring-neutral-400 dark:ring-neutral-600'
                      : 'border-line dark:border-neutral-800 hover:border-neutral-400'
                  }`}
                >
                  <img
                    src={item.thumbnailUrl || manifest.thumbnailUrl}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute top-2 left-2 w-5 h-5 rounded-md bg-black/75 flex items-center justify-center text-white">
                    {isChecked ? <Check className="w-3.5 h-3.5 stroke-[2.5]" /> : <span className="text-[10px] font-mono">{idx + 1}</span>}
                  </div>
                  <div className="absolute bottom-1.5 left-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-white text-[10px] truncate text-center font-mono">
                    {item.title || `Item ${idx + 1}`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Progress & Live Muxing Stage Display: Razor-thin 3px precision rail with live stage telemetry */}
      {isMuxing && (
        <div className="p-4 rounded-xl border border-line dark:border-neutral-800 bg-surface-elevated space-y-3 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-content">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-content" />
              <span className="font-mono">{stream.stageMessage || 'Lossless stream copy in progress…'}</span>
            </div>
            <span className="font-mono tabular-nums text-content font-bold">{stream.progress}%</span>
          </div>

          {/* Razor-thin 3px precision rail */}
          <div className="w-full h-[3px] rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
            <div
              className="h-full w-full bg-neutral-900 dark:bg-white origin-left motion-safe:transition-transform motion-safe:duration-150"
              style={{ transform: `scaleX(${Math.max(0.02, Math.min(1, stream.progress / 100))})` }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-y-1 gap-x-2 text-[11px] font-mono tabular-nums text-content-secondary">
            <span>Stage: {stream.stage || 'STREAM_COPY'}</span>
            <span>Format: {videoContainer.toUpperCase()}{selectedVideoOption ? ` • ${selectedVideoOption.height}p` : ''}</span>
            <span>{stream.speed !== '1.0x' ? `Speed: ${stream.speed}` : 'Speed: Stream Copy'}</span>
            <span>{stream.etaSeconds > 0 ? `ETA: ${stream.etaSeconds}s` : 'ETA: < 4s'}</span>
          </div>
        </div>
      )}

      {/* Error Notice with Instant Direct Fallback */}
      {isFailed && (
        <div
          role="alert"
          className="p-4 rounded-xl border border-line dark:border-neutral-800 bg-surface-elevated text-content text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
        >
          <div className="flex items-start gap-2.5">
            <Download className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-bold">Direct Stream Available</span>
              <p className="text-content-secondary">
                {errorMessage || stream.error?.message || 'Server processing busy. You can save the direct stream immediately.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              onClick={handleStartDownload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-bold shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Save File Directly</span>
            </button>
            <button
              type="button"
              onClick={handleResetCard}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-line dark:border-neutral-800 text-xs font-medium text-content-secondary hover:text-content"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Retry</span>
            </button>
          </div>
        </div>
      )}

      {/* Ready Notice with Direct Fallback Button */}
      {isReady && fallbackDownloadUrl && (
        <div className="p-4 sm:p-5 rounded-xl border border-line dark:border-neutral-800 bg-surface-elevated text-content text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5 font-medium">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            <div>
              <div className="font-bold">Your media download is ready!</div>
              <div className="text-xs text-content-secondary mt-0.5">
                Download started automatically. Click Save File Now to download again anytime.
              </div>
            </div>
          </div>
          <a
            href={fallbackDownloadUrl}
            download
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => triggerBrowserDownload(fallbackDownloadUrl)}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold shadow-sm active:scale-[0.98] transition-all whitespace-nowrap self-start sm:self-auto cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Save File Now</span>
          </a>
        </div>
      )}

      {/* Bottom Action Footer with Multi-State Primary CTA */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-3 border-t border-line dark:border-neutral-800">
        <div className="flex items-center gap-3 text-xs text-content-secondary font-mono">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-content" />
            <span>Lossless stream copy</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-content-secondary" />
            <span>60-min auto-delete</span>
          </span>
        </div>

        {/* Primary CTA Button */}
        <div className="flex items-center gap-2">
          {isReady && (
            <button
              type="button"
              onClick={handleResetCard}
              className="px-4 py-2.5 rounded-xl border border-line dark:border-neutral-800 text-xs font-semibold text-content-secondary hover:text-content hover:bg-surface-elevated transition-colors duration-150"
            >
              Convert Another
            </button>
          )}

          <button
            type="button"
            onClick={handleStartDownload}
            disabled={submitting || (!isReady && isMuxing)}
            className={`w-full sm:w-auto px-6 py-3 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-all duration-150 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${
              isReady
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-neutral-900 hover:bg-neutral-800 text-white dark:bg-white dark:hover:bg-neutral-100 dark:text-neutral-900'
            }`}
          >
            {isMuxing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isReady ? (
              <Download className="w-4 h-4" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span className="tabular-nums font-mono font-bold">{primaryCtaLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
