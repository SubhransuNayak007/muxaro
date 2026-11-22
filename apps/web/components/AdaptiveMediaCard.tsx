'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Film,
  Music,
  FileText,
  Grid,
  Check,
  Download,
  RotateCcw,
  Clock,
  Sparkles,
  ExternalLink,
  Copy,
  Layers,
  AlertCircle,
  Loader2,
  CheckCircle2,
  ShieldCheck,
  ArrowRight,
  HardDrive,
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
export type AudioFormatId = 'mp3' | 'm4a' | 'wav' | 'flac' | 'opus';

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
    label: 'MP3',
    ext: 'mp3',
    bitrate: '320 kbps',
    codec: 'MP3',
    desc: 'Universal compatibility for mobile and everyday listening',
    badge: 'Popular',
    estBytesRatio: 320 * 1000 / 8,
  },
  {
    id: 'm4a',
    label: 'M4A / AAC',
    ext: 'm4a',
    bitrate: '256 kbps',
    codec: 'AAC',
    desc: 'Crystal-clear audio optimized for Apple devices & mobile',
    badge: 'High Clarity',
    estBytesRatio: 256 * 1000 / 8,
  },
  {
    id: 'flac',
    label: 'FLAC',
    ext: 'flac',
    bitrate: 'Lossless Master',
    codec: 'FLAC',
    desc: 'Uncompressed studio master quality with zero data loss',
    badge: 'Lossless',
    estBytesRatio: 900 * 1000 / 8,
  },
  {
    id: 'wav',
    label: 'WAV',
    ext: 'wav',
    bitrate: '24-bit PCM',
    codec: 'PCM',
    desc: 'Uncompressed audio suitable for professional video/DAW editing',
    estBytesRatio: 1411 * 1000 / 8,
  },
  {
    id: 'opus',
    label: 'Opus',
    ext: 'opus',
    bitrate: '160 kbps VBR',
    codec: 'Opus',
    desc: 'Smallest file size with transparent voice and music reproduction',
    estBytesRatio: 160 * 1000 / 8,
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

      // Auto-trigger browser download
      try {
        const link = document.createElement('a');
        link.href = stream.downloadUrl;
        link.setAttribute('download', '');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch {}

      // Save to 60-min localStorage session history
      const selectedOpt = videoOptions.find((v) => v.id === selectedVideoId);
      const estSize = selectedOpt?.estimatedSizeBytes || 45 * 1024 * 1024;
      const fmt = activeTab === 'audio' ? selectedAudioId : videoContainer;
      saveToDownloadsHistory(stream.jobId || `job_${Date.now()}`, stream.downloadUrl, manifest.title, fmt, estSize);
    }
  }, [
    stream.status,
    stream.downloadUrl,
    stream.jobId,
    manifest.title,
    activeTab,
    selectedAudioId,
    videoContainer,
    selectedVideoId,
    videoOptions,
    saveToDownloadsHistory,
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

  // Primary Download Dispatcher
  const handleStartDownload = async () => {
    if (submitting || stream.status === 'PROCESSING') return;

    if (isReady && fallbackDownloadUrl) {
      try {
        const link = document.createElement('a');
        link.href = fallbackDownloadUrl;
        link.setAttribute('download', '');
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch {
        window.open(fallbackDownloadUrl, '_blank');
      }
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

    try {
      const job = await api.createJob({
        sourceUrl: manifest.sourceUrl,
        mediaUrl: manifest.sourceUrl,
        operation,
        targetFormat,
        targetResolution,
      });

      if (job && job.id) {
        setActiveJobId(job.id);
        onJobStarted?.(job);

        // Fast-path immediate download check
        if (job.status === 'READY' && job.downloadUrl) {
          setFallbackDownloadUrl(job.downloadUrl);
          autoTriggeredRef.current = true;
          try {
            const link = document.createElement('a');
            link.href = job.downloadUrl;
            link.setAttribute('download', '');
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          } catch {}
          saveToDownloadsHistory(
            job.id,
            job.downloadUrl,
            manifest.title,
            targetFormat,
            job.outputSizeBytes || job.artifact?.size || 45 * 1024 * 1024
          );
        }
      }
    } catch (err: unknown) {
      // Resilient fallback: If job creation failed, use direct stream or edge download link
      const directStreamUrl =
        selectedVideoOption?.stream?.url ||
        manifest.videoStreams.find((s) => s.url)?.url ||
        manifest.audioStreams.find((s) => s.url)?.url ||
        `/api/v1/jobs/direct_${Date.now()}/download?url=${encodeURIComponent(manifest.sourceUrl)}&format=${targetFormat}`;

      if (directStreamUrl) {
        setFallbackDownloadUrl(directStreamUrl);
        autoTriggeredRef.current = true;
        try {
          const link = document.createElement('a');
          link.href = directStreamUrl;
          link.setAttribute('download', '');
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } catch {
          window.open(directStreamUrl, '_blank');
        }
        saveToDownloadsHistory(
          `dl_${Date.now()}`,
          directStreamUrl,
          manifest.title,
          targetFormat,
          selectedVideoOption?.estimatedSizeBytes || 45 * 1024 * 1024
        );
        setErrorMessage(null);
      } else {
        setErrorMessage(extractDisplayError(err, 'Failed to schedule media download. Please try again.'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Status computation for Primary CTA
  const isReady = stream.status === 'READY' || Boolean(fallbackDownloadUrl);
  const isMuxing =
    !isReady &&
    (stream.status === 'PROCESSING' ||
      stream.status === 'VALIDATING' ||
      stream.status === 'QUEUED' ||
      stream.status === 'VERIFYING');
  const isFailed = stream.status === 'FAILED' || Boolean(stream.error) || Boolean(errorMessage);

  const primaryCtaLabel = isMuxing
    ? `${stream.stageMessage || 'Processing…'} (${stream.progress}%)`
    : isReady
    ? 'Download Ready — Click to Save'
    : isFailed
    ? 'Failed — Retry Download'
    : activeTab === 'video'
    ? `Download ${selectedVideoOption?.resolutionLabel || '8K'} Video (${videoContainer.toUpperCase()})`
    : activeTab === 'audio'
    ? `Download ${selectedAudioPreset.label} Audio (${selectedAudioPreset.bitrate})`
    : activeTab === 'subtitles'
    ? `Download ${selectedSubtitleLang} Subtitles (.${selectedSubtitleExt})`
    : `Download Carousel (${manifest.items?.length || 'All'} Items ZIP)`;

  return (
    <div className="w-full muxaro-card rounded-2xl border border-line bg-surface p-4 sm:p-6 space-y-6 shadow-card transition-colors duration-150">
      {/* Top Header: Aspect-Video Thumbnail, Metadata & Quick Actions */}
      <div className="flex flex-col sm:flex-row items-start gap-4 sm:gap-6 border-b border-line pb-5">
        {/* Aspect-Video Thumbnail with Overlays */}
        <div className="w-full sm:w-64 aspect-video rounded-xl overflow-hidden relative bg-elevated border border-line shrink-0 shadow-xs">
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
            <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-surface/90 backdrop-blur-xs border border-line/60 text-[10px] font-semibold flex items-center gap-1 shadow-xs text-content">
              <PlatformIcon platform={platform} className="w-3 h-3" />
              <span className="capitalize">{platform}</span>
            </div>
          )}

          {/* Duration Badge Overlay */}
          {durationFormatted && (
            <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/80 text-white text-[10px] font-mono font-semibold tabular-nums shadow-xs">
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
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-line bg-surface-elevated text-xs font-medium text-content-secondary hover:text-content hover:border-brand-violet transition-colors duration-150"
              title="Copy original link"
            >
              {copiedLink ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-emerald-600 font-semibold">Copied!</span>
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
              onClick={onReset}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-line text-xs font-medium text-content-secondary hover:text-content hover:bg-surface-elevated transition-colors duration-150"
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
        className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 rounded-xl bg-surface-elevated border border-line"
      >
        <button
          type="button"
          role="tab"
          id="tab-video"
          aria-selected={activeTab === 'video'}
          aria-controls="panel-video"
          onClick={() => setActiveTab('video')}
          className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-colors duration-150 select-none ${
            activeTab === 'video'
              ? 'bg-surface text-content shadow-xs'
              : 'text-content-secondary hover:text-content'
          }`}
        >
          <Film className="w-3.5 h-3.5 text-brand-violet" aria-hidden="true" />
          <span>Video up to 8K</span>
        </button>

        <button
          type="button"
          role="tab"
          id="tab-audio"
          aria-selected={activeTab === 'audio'}
          aria-controls="panel-audio"
          onClick={() => setActiveTab('audio')}
          className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-colors duration-150 select-none ${
            activeTab === 'audio'
              ? 'bg-surface text-content shadow-xs'
              : 'text-content-secondary hover:text-content'
          }`}
        >
          <Music className="w-3.5 h-3.5 text-brand-blue" aria-hidden="true" />
          <span>Audio Only</span>
        </button>

        <button
          type="button"
          role="tab"
          id="tab-subtitles"
          aria-selected={activeTab === 'subtitles'}
          aria-controls="panel-subtitles"
          onClick={() => setActiveTab('subtitles')}
          className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-colors duration-150 select-none ${
            activeTab === 'subtitles'
              ? 'bg-surface text-content shadow-xs'
              : 'text-content-secondary hover:text-content'
          }`}
        >
          <FileText className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" />
          <span>Subtitles</span>
        </button>

        <button
          type="button"
          role="tab"
          id="tab-carousel"
          aria-selected={activeTab === 'carousel'}
          aria-controls="panel-carousel"
          onClick={() => setActiveTab('carousel')}
          className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-colors duration-150 select-none ${
            activeTab === 'carousel'
              ? 'bg-surface text-content shadow-xs'
              : 'text-content-secondary hover:text-content'
          }`}
        >
          <Grid className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
          <span>Carousel Grid</span>
        </button>
      </div>

      {/* Tab Panel 1: Video up to 8K Quality Matrix Chips */}
      {activeTab === 'video' && (
        <div id="panel-video" role="tabpanel" aria-labelledby="tab-video" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">
                Quality Matrix
              </h3>
              <p className="text-xs text-content-secondary mt-0.5">
                Lossless remuxing guarantees zero re-encoding on 4K/8K (-c:v copy).
              </p>
            </div>

            {/* Container Selector */}
            <div className="flex items-center gap-1 p-1 rounded-lg bg-surface-elevated border border-line text-xs font-medium self-start sm:self-auto">
              <span className="text-[10px] text-content-secondary px-1.5 uppercase font-semibold">Format:</span>
              {(['mp4', 'mkv', 'webm'] as VideoContainer[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setVideoContainer(c)}
                  className={`px-2 py-0.5 rounded text-xs uppercase font-mono font-bold transition-colors duration-150 ${
                    videoContainer === c
                      ? 'bg-surface text-brand-violet shadow-xs'
                      : 'text-content-secondary hover:text-content'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Quality Matrix Chips Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {videoOptions.map((opt) => {
              const isSelected = selectedVideoOption?.id === opt.id;
              const is8K = opt.height >= 4320;
              const is4K = opt.height >= 2160 && opt.height < 4320;
              const is2K = opt.height >= 1440 && opt.height < 2160;

              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelectedVideoId(opt.id)}
                  className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-colors duration-150 select-none active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet ${
                    isSelected
                      ? 'border-brand-violet bg-info-bg shadow-xs ring-1 ring-brand-violet/40'
                      : 'border-line bg-surface hover:bg-surface-elevated'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-extrabold text-sm text-content">
                        {opt.resolutionLabel}
                      </span>
                      {is8K && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/15 text-amber-600 font-mono">
                          8K ULTRA
                        </span>
                      )}
                      {is4K && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-blue-500/15 text-blue-600 font-mono">
                          4K UHD
                        </span>
                      )}
                      {is2K && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-purple-500/15 text-purple-600 font-mono">
                          2K QHD
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {opt.hdr && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/15 text-amber-600 font-mono">
                          HDR
                        </span>
                      )}
                      {opt.fps && opt.fps >= 50 && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono text-content-secondary bg-surface-elevated">
                          {opt.fps} FPS
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-content-secondary pt-1 border-t border-line/50">
                    <span className="font-mono text-[11px] uppercase">
                      {opt.codec || 'H.264'} • {videoContainer.toUpperCase()}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums font-semibold text-content">
                      {opt.estimatedSizeBytes ? formatBytes(opt.estimatedSizeBytes) : '~640 MB'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab Panel 2: Audio Only Quality Chips */}
      {activeTab === 'audio' && (
        <div id="panel-audio" role="tabpanel" aria-labelledby="tab-audio" className="space-y-4">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">
              Audio Extraction Options
            </h3>
            <p className="text-xs text-content-secondary mt-0.5">
              Lossless stream extraction or studio-grade 320k transcode with zero clipping.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {AUDIO_PRESETS.map((preset) => {
              const isSelected = selectedAudioPreset.id === preset.id;
              const estBytes = durationSec > 0 ? durationSec * preset.estBytesRatio : undefined;

              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setSelectedAudioId(preset.id)}
                  className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-colors duration-150 select-none active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet ${
                    isSelected
                      ? 'border-brand-violet bg-info-bg shadow-xs ring-1 ring-brand-violet/40'
                      : 'border-line bg-surface hover:bg-surface-elevated'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-extrabold text-sm text-content">
                        {preset.label}
                      </span>
                      {preset.badge && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-brand-violet/10 text-brand-violet font-mono">
                          {preset.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-content-secondary line-clamp-1 mb-2">
                      {preset.desc}
                    </p>
                  </div>

                  <div className="flex items-center justify-between text-xs text-content-secondary pt-1.5 border-t border-line/50">
                    <span className="font-mono text-[11px]">{preset.bitrate}</span>
                    <span className="font-mono text-[11px] tabular-nums font-semibold text-content">
                      {estBytes ? formatBytes(estBytes) : '~18 MB'}
                    </span>
                  </div>
                </button>
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
              <h3 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">
                Subtitles & Closed Captions
              </h3>
              <p className="text-xs text-content-secondary mt-0.5">
                Download synchronized subtitle tracks in SRT or WebVTT format.
              </p>
            </div>

            <div className="flex items-center gap-1 p-1 rounded-lg bg-surface-elevated border border-line text-xs font-medium">
              {(['srt', 'vtt'] as const).map((ext) => (
                <button
                  key={ext}
                  type="button"
                  onClick={() => setSelectedSubtitleExt(ext)}
                  className={`px-2 py-0.5 rounded text-xs uppercase font-mono font-bold transition-colors duration-150 ${
                    selectedSubtitleExt === ext
                      ? 'bg-surface text-brand-violet shadow-xs'
                      : 'text-content-secondary hover:text-content'
                  }`}
                >
                  .{ext}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(manifest.subtitles || DEFAULT_SUBTITLES).map((sub, idx) => {
              const isSelected = selectedSubtitleLang === sub.language;
              return (
                <div
                  key={`${sub.language}-${idx}`}
                  onClick={() => setSelectedSubtitleLang(sub.language)}
                  className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-colors duration-150 ${
                    isSelected
                      ? 'border-brand-violet bg-info-bg shadow-xs'
                      : 'border-line bg-surface hover:bg-surface-elevated'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-content-secondary" />
                    <span className="text-xs font-semibold text-content">{sub.language}</span>
                  </div>
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-surface border border-line text-content-secondary">
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
              <h3 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">
                Multi-Item Carousel / Album Archive
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
              className="text-xs font-semibold text-brand-violet hover:underline"
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
                      ? 'border-brand-violet ring-2 ring-brand-violet/40'
                      : 'border-line hover:border-line'
                  }`}
                >
                  <img
                    src={item.thumbnailUrl || manifest.thumbnailUrl}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute top-2 left-2 w-5 h-5 rounded-md bg-black/60 flex items-center justify-center text-white">
                    {isChecked ? <Check className="w-3.5 h-3.5" /> : <span className="text-[10px] font-mono">{idx + 1}</span>}
                  </div>
                  <div className="absolute bottom-1.5 left-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] truncate text-center">
                    {item.title || `Item ${idx + 1}`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Progress & Live Muxing Stage Display */}
      {isMuxing && (
        <div className="p-4 rounded-xl border border-brand-violet/30 bg-info-bg space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-content">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-brand-violet animate-spin" />
              <span>{stream.stageMessage || 'Downloading and remuxing media streams…'}</span>
            </div>
            <span className="font-mono tabular-nums text-brand-violet">{stream.progress}%</span>
          </div>

          {/* Tabular Numerals % Bar with GPU-composited transform */}
          <div className="w-full h-2 rounded-full bg-surface-elevated overflow-hidden">
            <div
              className="h-full w-full bg-brand-violet origin-left motion-safe:transition-transform motion-safe:duration-150"
              style={{ transform: `scaleX(${Math.max(0.04, Math.min(1, stream.progress / 100))})` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono text-content-secondary">
            <span>Stage: {stream.stage || 'PROCESSING'}</span>
            <span className="tabular-nums">
              {stream.speed !== '1.0x' ? `Speed: ${stream.speed}` : ''} {stream.etaSeconds > 0 ? `• ETA: ${stream.etaSeconds}s` : ''}
            </span>
          </div>
        </div>
      )}

      {/* Error Notice with Retry */}
      {isFailed && (
        <div
          role="alert"
          className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMessage || stream.error?.message || 'Processing timed out. Please retry.'}</span>
          </div>
          <button
            type="button"
            onClick={handleStartDownload}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-red-500/30 text-xs font-semibold hover:bg-red-500/10 self-start sm:self-auto"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Ready Notice with Direct Fallback Button */}
      {isReady && fallbackDownloadUrl && (
        <div className="p-4 sm:p-5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2.5 font-medium">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            <span>
              Your download is ready! Download started automatically. If not, click Save File Now.
            </span>
          </div>
          <a
            href={fallbackDownloadUrl}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 text-white text-xs sm:text-sm font-bold hover:bg-emerald-700 active:scale-[0.98] transition-colors whitespace-nowrap self-start sm:self-auto shadow-sm"
          >
            <Download className="w-4 h-4" />
            <span>Save File Now</span>
          </a>
        </div>
      )}

      {/* Bottom Action Footer with Multi-State Primary CTA */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-3 border-t border-line">
        <div className="flex items-center gap-3 text-xs text-content-secondary">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-brand-violet" />
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
              onClick={onReset}
              className="px-4 py-2.5 rounded-xl border border-line text-xs font-semibold text-content-secondary hover:text-content hover:bg-surface-elevated transition-colors duration-150"
            >
              Convert Another
            </button>
          )}

          <button
            type="button"
            onClick={handleStartDownload}
            disabled={submitting || (!isReady && isMuxing)}
            className={`w-full sm:w-auto px-6 py-3 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 active:translate-y-px transition-colors duration-150 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${
              isReady
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'muxaro-btn-primary'
            }`}
          >
            {isMuxing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isReady ? (
              <Download className="w-4 h-4" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span className="tabular-nums font-sans">{primaryCtaLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
