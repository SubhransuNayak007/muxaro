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
  Copy,
  Loader2,
  CheckCircle2,
  ArrowDown,
  Zap,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { MediaManifest, ProcessingJob } from '@/lib/types';
import { formatBytes, formatDuration } from '@/lib/formatters';
import { api, extractDisplayError } from '@/lib/api-client';
import {
  normalizeVideoOptions,
  normalizeAudioOptions,
  NormalizedVideoOption,
} from '@/lib/format-normalizer';
import { useJobStream } from '@/hooks/use-job-stream';
import { useDeviceDetection } from '@/hooks/useDeviceDetection';
import { useMuxaroBridge } from '@/hooks/useMuxaroBridge';
import { useMuxaroSettings } from '@/lib/settings-store';
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
  badge: string;
  estBytesRatio: number;
}

const AUDIO_PRESETS: AudioPreset[] = [
  {
    id: 'mp3',
    label: '320 kbps MP3',
    ext: 'mp3',
    bitrate: '320 kbps CBR',
    codec: 'MP3',
    desc: 'Universal compatibility for all players and devices',
    badge: 'Cloud Ready · Universal',
    estBytesRatio: (320 * 1000) / 8,
  },
  {
    id: 'flac',
    label: 'Studio FLAC',
    ext: 'flac',
    bitrate: 'Lossless Master',
    codec: 'FLAC',
    desc: 'Bit-perfect compression with zero quality loss',
    badge: 'Cloud Ready · Bit-Perfect',
    estBytesRatio: (900 * 1000) / 8,
  },
  {
    id: 'm4a',
    label: '256 kbps AAC',
    ext: 'm4a',
    bitrate: '256 kbps VBR',
    codec: 'AAC',
    desc: 'High clarity optimized for Apple and mobile devices',
    badge: 'Cloud Ready · Apple AAC',
    estBytesRatio: (256 * 1000) / 8,
  },
  {
    id: 'wav',
    label: '24-bit WAV',
    ext: 'wav',
    bitrate: '24-bit / 48kHz PCM',
    codec: 'PCM',
    desc: 'Uncompressed waveform for audio production and editing',
    badge: 'Cloud Ready · Studio PCM',
    estBytesRatio: (1411 * 1000) / 8,
  },
  {
    id: 'opus',
    label: '160 kbps Opus',
    ext: 'opus',
    bitrate: '160 kbps VBR',
    codec: 'Opus',
    desc: 'Next-gen acoustic reproduction at low latency',
    badge: 'Cloud Ready · Low Latency',
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

export function getResolutionTierName(height: number): string {
  if (height >= 4320) return '8K';
  if (height >= 2160) return '4K';
  if (height >= 1440) return '2K';
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  if (height >= 480) return '480p';
  if (height >= 360) return '360p';
  return `${height}p`;
}

export function getTierBadge(height: number): { label: string; className: string } {
  if (height >= 4320) {
    return {
      label: 'Local Ultra HD',
      className: 'bg-zinc-950 text-white dark:bg-white dark:text-zinc-950 font-semibold shadow-xs',
    };
  }
  if (height >= 2160) {
    return {
      label: '4K Ultra HD',
      className: 'bg-zinc-800 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900 font-semibold shadow-xs',
    };
  }
  if (height >= 1440) {
    return {
      label: 'Cloud & Local Ready',
      className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 font-medium',
    };
  }
  if (height >= 1080) {
    return {
      label: 'Cloud Ready',
      className: 'bg-black/[0.04] dark:bg-white/[0.06] text-content-secondary border border-black/[0.06] dark:border-white/[0.08] font-medium',
    };
  }
  if (height >= 720) {
    return {
      label: 'Cloud Ready',
      className: 'bg-black/[0.04] dark:bg-white/[0.06] text-content-secondary border border-black/[0.06] dark:border-white/[0.08] font-medium',
    };
  }
  if (height >= 480) {
    return {
      label: 'Cloud Ready',
      className: 'bg-black/[0.04] dark:bg-white/[0.06] text-content-secondary border border-black/[0.06] dark:border-white/[0.08] font-medium',
    };
  }
  return {
    label: 'Compact',
    className: 'bg-black/[0.04] dark:bg-white/[0.06] text-content-secondary font-normal',
  };
}

export function humanizeCodec(codec?: string | null): string {
  if (!codec) return 'H.264';
  const c = codec.toLowerCase();
  if (c.includes('av01') || c.includes('av1')) return 'AV1';
  if (c.includes('vp09') || c.includes('vp9')) return 'VP9';
  if (c.includes('avc') || c.includes('h264')) return 'H.264';
  if (c.includes('hev') || c.includes('hvc') || c.includes('h265')) return 'HEVC';
  if (c.includes('vp8')) return 'VP8';
  return codec.toUpperCase();
}

export function formatCleanDisplayUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl);
    const trackingParams = [
      'si',
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid',
      'igshid',
      'feature',
    ];
    for (const param of trackingParams) {
      parsed.searchParams.delete(param);
    }
    const host = parsed.hostname.replace(/^www\./, '');
    if ((host === 'youtube.com' || host === 'm.youtube.com') && parsed.pathname === '/watch') {
      const v = parsed.searchParams.get('v');
      if (v) return `youtu.be/${v}`;
    }
    const remainingSearch = parsed.search;
    const cleanPath = parsed.pathname === '/' ? '' : parsed.pathname;
    const res = `${host}${cleanPath}${remainingSearch}`;
    return res.replace(/\/$/, '');
  } catch {
    return rawUrl.replace(/^https?:\/\/(www\.)?/, '').split('?')[0];
  }
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
  const { isDesktop, isMobile, isLoaded: isDeviceLoaded } = useDeviceDetection();
  const { isInstalled: isDirectBridgeInstalled } = useMuxaroBridge();
  const { settings, mounted: settingsMounted } = useMuxaroSettings();

  // Normalize Video & Audio Options (Mobile capped to 2K, Desktop up to 8K)
  const allVideoOptions = useMemo(() => normalizeVideoOptions(manifest), [manifest]);
  const videoOptions = useMemo(() => {
    if (isDeviceLoaded && isMobile) {
      return allVideoOptions.filter((opt) => opt.height <= 1440);
    }
    return allVideoOptions;
  }, [allVideoOptions, isDeviceLoaded, isMobile]);

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

  // Sync with persistent user settings
  useEffect(() => {
    if (!settingsMounted) return;
    if (settings.containerFormat !== 'auto') {
      setVideoContainer(settings.containerFormat);
    }
    if (settings.audioFormat) {
      setSelectedAudioId(settings.audioFormat);
    }
    if (settings.videoQuality !== 'auto') {
      const targetHeight = parseInt(settings.videoQuality, 10);
      if (Number.isFinite(targetHeight)) {
        const match = videoOptions.find((o) => o.height === targetHeight);
        if (match) {
          setSelectedVideoId(match.id);
        }
      }
    }
  }, [settingsMounted, settings.containerFormat, settings.audioFormat, settings.videoQuality, videoOptions]);

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
  const [copiedDownloadLink, setCopiedDownloadLink] = useState<boolean>(false);
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
    // Only switch to carousel if manifest is a multi-item carousel
    if (manifest.isCarousel && manifest.items && manifest.items.length > 1) {
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

  // Primary Distinct Video Resolution Tiers
  const distinctVideoTiers = useMemo(() => {
    const map = new Map<number, NormalizedVideoOption>();
    for (const opt of videoOptions) {
      if (!map.has(opt.height) || opt.recommended || (opt.fps && opt.fps >= 50)) {
        map.set(opt.height, opt);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.height - a.height);
  }, [videoOptions]);

  // Split into primary tiers (>= 480p shown immediately) and lower SD tiers (collapsed by default)
  const primaryTiers = useMemo(() => {
    const primary = distinctVideoTiers.filter((t) => t.height >= 480);
    if (primary.length > 0) return primary;
    return distinctVideoTiers.slice(0, 3);
  }, [distinctVideoTiers]);

  const sdTiers = useMemo(() => {
    const primaryIds = new Set(primaryTiers.map((t) => t.id));
    return distinctVideoTiers.filter((t) => !primaryIds.has(t.id));
  }, [distinctVideoTiers, primaryTiers]);

  const rawVariants = useMemo(() => {
    const distinctIds = new Set(distinctVideoTiers.map((t) => t.id));
    return videoOptions.filter((o) => !distinctIds.has(o.id));
  }, [videoOptions, distinctVideoTiers]);

  // Duration and Size formatting
  const durationSec = manifest.durationSeconds || 0;
  const durationFormatted = durationSec > 0 ? formatDuration(durationSec) : null;
  const cleanDisplayUrl = useMemo(
    () => formatCleanDisplayUrl(manifest.sourceUrl),
    [manifest.sourceUrl]
  );

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

    const isYouTube = /(?:youtube\.com|youtu\.be)/i.test(manifest.sourceUrl);
    // YouTube adaptive video streams (1080p, 1440p, 4K, 8K) have NO audio track and MUST be multiplexed by FFmpeg.
    // Never treat adaptive video-only streams as zero-hop downloads; they must go through the pipeline to merge audio.
    const isAdaptiveVideoOnly = isYouTube && !isAudioOnly && selectedVideoOption && selectedVideoOption.height > 720;

    const directStreamUrl = isAdaptiveVideoOnly
      ? undefined
      : (isAudioOnly
          ? (manifest.audioStreams?.[0]?.url || manifest.directStreamUrl)
          : (!isYouTube ? (selectedVideoOption?.stream?.url || manifest.directStreamUrl) : undefined));

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
        directStreamUrl,
        directMimeType: (manifest as any).directMimeType || 'video/mp4',
        fileSizeBytes: selectedVideoOption?.estimatedSizeBytes || manifest.fileSizeBytes,
      } as any);

      if (job && job.id) {
        setActiveJobId(job.id);
        onJobStarted?.(job);

        // Zero-Hop Client Handover: direct origin CDN stream
        if (job.deliveryMode === 'zero-hop') {
          const streamUrl = job.directStreamUrl || job.downloadUrl;
          if (streamUrl && typeof document !== 'undefined') {
            const filename = job.outputFilename || `${manifest.title}.${targetFormat}`;
            const a = document.createElement('a');
            a.href = streamUrl;
            a.download = filename;
            a.rel = 'noreferrer';
            a.referrerPolicy = 'no-referrer';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            setFallbackDownloadUrl(streamUrl);
            autoTriggeredRef.current = true;
            saveToDownloadsHistory(
              job.id,
              streamUrl,
              manifest.title,
              targetFormat,
              job.fileSizeBytes || job.outputSizeBytes || 45 * 1024 * 1024
            );
            return;
          }
        }

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
      if (directStreamUrl) {
        console.info('[MUXARO Stream] Direct browser stream active from origin CDN.');
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
        const isBlocked = /(?:youtube\.com|youtu\.be|instagram\.com|instagr\.am)/i.test(manifest.sourceUrl || '');
        if (isBlocked && isMobile) {
          console.warn('[MUXARO Handover] Media host blocks datacenter IPs. Desktop Direct or custom worker required.');
          setErrorMessage('This host blocks free cloud servers. Use Desktop Direct or connect a custom worker.');
        } else {
          const displayErr = extractDisplayError(
            err,
            isBlocked
              ? 'This host blocks free cloud servers. Use Desktop Direct or connect a custom worker.'
              : 'Direct stream available below. Click Save File Now to proceed.'
          );
          console.error('[MUXARO Download Error]', displayErr, err);
          setErrorMessage(displayErr);
        }
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

  // Available tabs: ONLY show Carousel if multi-item carousel manifest exists
  const hasCarousel = Boolean(manifest.isCarousel && manifest.items && manifest.items.length > 1);
  const availableTabs = useMemo(() => {
    const list: { id: SegmentedControlTab; label: string; icon: React.ElementType }[] = [
      { id: 'video', label: 'Video', icon: Film },
      { id: 'audio', label: 'Audio', icon: Music },
      { id: 'subtitles', label: 'Subtitles', icon: FileText },
    ];
    if (hasCarousel) {
      list.push({ id: 'carousel', label: 'Carousel', icon: Grid });
    }
    return list;
  }, [hasCarousel]);

  // Selected Choice Summary for Sticky Bottom Action Bar
  const selectedTierName = selectedVideoOption
    ? getResolutionTierName(selectedVideoOption.height)
    : '8K';

  const selectedVideoSize = selectedVideoOption?.estimatedSizeBytes
    ? formatBytes(selectedVideoOption.estimatedSizeBytes)
    : durationSec > 0
    ? formatBytes(
        durationSec *
          (selectedVideoOption && selectedVideoOption.height >= 2160
            ? 3200000
            : selectedVideoOption && selectedVideoOption.height >= 1080
            ? 1100000
            : 500000)
      )
    : '1.48 GB';

  const audioEstSize = durationSec > 0
    ? formatBytes(durationSec * selectedAudioPreset.estBytesRatio)
    : '~18 MB';

  const activeChoiceHeading = useMemo(() => {
    if (activeTab === 'video') {
      return `${selectedTierName} ${videoContainer.toUpperCase()} · ${selectedVideoSize}`;
    }
    if (activeTab === 'audio') {
      return `${selectedAudioPreset.label} · ${audioEstSize}`;
    }
    if (activeTab === 'subtitles') {
      return `${selectedSubtitleLang} Subtitles · .${selectedSubtitleExt.toUpperCase()}`;
    }
    return `Carousel Archive · ${selectedCarouselItems.size || manifest.items?.length || 0} Items`;
  }, [
    activeTab,
    selectedTierName,
    videoContainer,
    selectedVideoSize,
    selectedAudioPreset,
    audioEstSize,
    selectedSubtitleLang,
    selectedSubtitleExt,
    selectedCarouselItems,
    manifest.items,
  ]);

  const activeChoiceSubline = useMemo(() => {
    if (activeTab === 'video') {
      const is8K = Boolean(selectedVideoOption && selectedVideoOption.height >= 4320);
      const is4K = Boolean(selectedVideoOption && selectedVideoOption.height >= 2160 && selectedVideoOption.height < 4320);
      if (is8K) {
        return '8K Local Ultra HD · Maximum fidelity with zero cloud compression';
      }
      if (is4K) {
        return '4K Ultra HD · Processed locally with direct stream pairing';
      }
      const isDirectRemux =
        videoContainer === 'mkv' ||
        videoContainer === 'webm' ||
        (selectedVideoOption?.codec && selectedVideoOption.codec.toLowerCase().includes('avc'));
      return isDirectRemux
        ? 'Instant cloud-side stream copy · 60m secure retention'
        : 'Instant cloud-side remux · Lossless video · 60m secure retention';
    }
    if (activeTab === 'audio') {
      return 'Instant cloud-side audio extraction · 60m secure retention';
    }
    if (activeTab === 'subtitles') {
      return 'Timed caption track · Instant download';
    }
    return 'ZIP container · Cloud storage 60m';
  }, [activeTab, videoContainer, selectedVideoOption]);

  const actionButtonLabel = useMemo(() => {
    if (activeTab === 'video') return `Download ${selectedTierName}`;
    if (activeTab === 'audio') return `Download ${selectedAudioPreset.id.toUpperCase()}`;
    if (activeTab === 'subtitles') return 'Download Subtitles';
    return 'Download ZIP';
  }, [activeTab, selectedTierName, selectedAudioPreset]);

  // Range label for collapsed SD tiers
  const sdRangeLabel = useMemo(() => {
    if (sdTiers.length === 0) return 'SD';
    const maxH = Math.max(...sdTiers.map((t) => t.height));
    const minH = Math.min(...sdTiers.map((t) => t.height));
    return `${maxH}p – ${minH}p`;
  }, [sdTiers]);

  // Helper to render high-density ledger row
  const renderLedgerRow = (opt: NormalizedVideoOption) => {
    const isSelected = selectedVideoOption?.id === opt.id || selectedVideoOption?.height === opt.height;
    const tierName = getResolutionTierName(opt.height);
    const framerate = opt.fps ? `${opt.fps}fps` : opt.height >= 1080 ? '60fps' : '30fps';
    const estSize = opt.estimatedSizeBytes
      ? formatBytes(opt.estimatedSizeBytes)
      : durationSec > 0
      ? formatBytes(
          durationSec *
            (opt.height >= 2160 ? 3200000 : opt.height >= 1080 ? 1100000 : 500000)
        )
      : '~640 MB';

    const badge = getTierBadge(opt.height);

    return (
      <div
        key={opt.id}
        onClick={() => setSelectedVideoId(opt.id)}
        className={`flex items-center justify-between px-3.5 sm:px-4 py-3 sm:py-3.5 cursor-pointer select-none transition-colors ${
          isSelected
            ? 'bg-black/[0.035] dark:bg-white/[0.055]'
            : 'hover:bg-black/[0.015] dark:hover:bg-white/[0.025]'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* 16px Minimal Radio Indicator */}
          <div
            className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 border transition-all ${
              isSelected
                ? 'border-zinc-950 dark:border-white bg-zinc-950 dark:bg-white'
                : 'border-black/20 dark:border-white/20 bg-transparent'
            }`}
          >
            {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white dark:bg-zinc-950" />}
          </div>

          {/* Primary Resolution Grotesque Sans Label (fixed w-14) */}
          <span className="w-12 sm:w-14 shrink-0 text-sm font-semibold tracking-tight text-content">
            {tierName}
          </span>

          {/* Technical Spec Inline in Refined Muted Text */}
          <div className="flex items-center gap-1.5 text-xs text-content-secondary tabular-nums min-w-0">
            <span>{opt.height}p</span>
            <span className="text-content-muted">·</span>
            <span>{framerate}</span>
            <span className="text-content-muted">·</span>
            <span>{humanizeCodec(opt.codec)}</span>

            {/* Clear Tier Badge */}
            <span className="text-content-muted">·</span>
            <span className={`text-[10px] px-2 py-0.5 rounded ${badge.className}`}>
              {badge.label}
            </span>

            {opt.hdr && (
              <>
                <span className="text-content-muted">·</span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                  HDR
                </span>
              </>
            )}

            {opt.recommended && (
              <>
                <span className="text-content-muted hidden sm:inline">·</span>
                <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-normal text-content-secondary">
                  <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 dark:bg-neutral-500" />
                  Best balance
                </span>
              </>
            )}
          </div>
        </div>

        {/* Right Cluster: Exact File Size */}
        <div className="text-right shrink-0 pl-2">
          <span className="text-xs sm:text-sm font-medium text-content tabular-nums font-mono">
            {estSize}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full bg-surface dark:bg-[#121214] border border-black/[0.08] dark:border-white/[0.08] rounded-2xl p-4 sm:p-6 space-y-5 shadow-card transition-colors duration-150">
      {/* 1. Compact Media Identity Header: 16:9 Thumbnail, Clean Title & Non-Clipped Source */}
      <div className="flex flex-col sm:flex-row items-start gap-4 sm:gap-5 border-b border-black/[0.06] dark:border-white/[0.08] pb-5">
        {/* Sharp 16:9 Thumbnail with Duration Pill */}
        <div className="w-full sm:w-60 md:w-64 aspect-video rounded-2xl overflow-hidden relative bg-surface-elevated border border-black/10 dark:border-white/10 ring-1 ring-inset ring-black/10 dark:ring-white/10 shrink-0 shadow-xs">
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
            <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/75 dark:bg-black/85 backdrop-blur-md text-white text-[10px] font-medium flex items-center gap-1 shadow-xs">
              <PlatformIcon platform={platform} className="w-3 h-3" />
              <span className="capitalize">{platform}</span>
            </div>
          )}

          {/* Duration Badge Overlay */}
          {durationFormatted && (
            <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-md text-white text-[10px] font-mono font-medium tabular-nums shadow-xs">
              {durationFormatted}
            </div>
          )}
        </div>

        {/* Media Details */}
        <div className="flex-1 min-w-0 space-y-2">
          <h2 className="text-lg sm:text-xl font-semibold tracking-[-0.02em] leading-snug text-content line-clamp-2">
            {manifest.title || 'Media Link Ready'}
          </h2>

          {/* Metadata + Actions Row (Single Clean Responsive Flex Row) */}
          <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 pt-1">
            <div className="flex items-center gap-2 text-xs text-content-secondary min-w-0 flex-1">
              {manifest.author && (
                <span className="font-medium text-content shrink-0">{manifest.author}</span>
              )}
              {manifest.author && <span className="text-content-muted">·</span>}
              <a
                href={manifest.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block truncate max-w-[180px] sm:max-w-[240px] md:max-w-[280px] font-mono text-[11px] text-content-secondary hover:text-content hover:underline"
                title={manifest.sourceUrl}
              >
                {cleanDisplayUrl}
              </a>
            </div>

            {/* Utility Pills */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCopyLink}
                className="h-8 px-2.5 rounded-lg border border-black/[0.08] dark:border-white/[0.08] bg-surface-elevated text-xs font-medium text-content-secondary hover:text-content inline-flex items-center gap-1.5 transition-colors"
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
                    <span>Copy</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleResetCard}
                className="h-8 px-2.5 rounded-lg border border-black/[0.08] dark:border-white/[0.08] bg-surface-elevated text-xs font-medium text-content-secondary hover:text-content inline-flex items-center gap-1.5 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>New link</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Single-Row True Segmented Control (Kill the 2x2 Box) */}
      <div
        role="tablist"
        aria-label="Media format modes"
        className="flex w-full items-center p-1 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.04] dark:border-white/[0.06] gap-1"
      >
        {availableTabs.map((tab) => {
          const TabIcon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all text-center flex items-center justify-center gap-1.5 select-none ${
                isActive
                  ? 'bg-white dark:bg-zinc-900 text-content shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.06] dark:ring-white/[0.1] font-semibold'
                  : 'text-content-secondary hover:text-content'
              }`}
            >
              <TabIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Processing Architecture & Execution Lane Indicator */}
      <div className="p-3.5 sm:p-4 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-surface-elevated/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-start sm:items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-black/[0.05] dark:bg-white/[0.08] flex items-center justify-center shrink-0 mt-0.5 sm:mt-0 text-content">
            <Zap className="w-3.5 h-3.5" aria-hidden="true" />
          </div>
          <div className="space-y-0.5 min-w-0">
            <div className="font-semibold text-content flex items-center gap-2">
              <span>Processing Routing Architecture</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/[0.06] dark:bg-white/[0.08] text-content-secondary font-normal">
                Auto-Routed
              </span>
            </div>
            <p className="text-content-secondary text-[11px] sm:text-xs leading-relaxed">
              <strong className="font-semibold text-content">≤ 2K (1440p) & Audio:</strong> Instant cloud-side processing with zero wait time.
              <span className="mx-1.5 text-content-muted hidden sm:inline">|</span>
              <br className="sm:hidden" />
              <strong className="font-semibold text-content">8K & 4K:</strong> Executes locally with direct zero-loss stream pairing for maximum fidelity.
            </p>
          </div>
        </div>
        <div className="shrink-0 self-start sm:self-auto pl-9 sm:pl-0">
          {activeTab === 'audio' || (selectedVideoOption && selectedVideoOption.height <= 1440) ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 text-[11px] font-mono font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              Instant Cloud Stream
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-950 text-white dark:bg-white dark:text-zinc-950 text-[11px] font-mono font-semibold shadow-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 dark:bg-emerald-500 animate-pulse shrink-0" />
              8K Local Ultra HD Engine
            </span>
          )}
        </div>
      </div>

      {/* 3. Tab Panel 1: Video High-Density Architectural Resolution Ledger */}
      {activeTab === 'video' && (
        <div id="panel-video" role="tabpanel" aria-labelledby="tab-video" className="space-y-3">
          {/* Header Toolbar Row */}
          <div className="flex items-center justify-between gap-3 pb-1">
            <span className="text-xs font-medium uppercase tracking-[0.08em] text-content-secondary">
              Resolution
            </span>

            {/* Container Format Selector */}
            <div className="flex items-center p-0.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-xs font-medium">
              {(['mp4', 'mkv', 'webm'] as VideoContainer[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setVideoContainer(c)}
                  className={`px-2.5 py-1 rounded-md text-xs uppercase font-mono transition-colors ${
                    videoContainer === c
                      ? 'bg-white dark:bg-zinc-900 text-content shadow-xs font-semibold'
                      : 'text-content-secondary hover:text-content'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* High-Density Ledger Surface */}
          <div className="rounded-2xl border border-black/[0.08] dark:border-white/[0.08] divide-y divide-black/[0.06] dark:divide-white/[0.06] overflow-hidden bg-surface dark:bg-[#151517]">
            {primaryTiers.map((opt) => renderLedgerRow(opt))}

            {/* Progressive Disclosure: Lower SD tiers & raw stream variants */}
            {(sdTiers.length > 0 || rawVariants.length > 0) && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowAllStreams((prev) => !prev)}
                  className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-medium text-content-secondary hover:text-content hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
                >
                  <span>
                    {showAllStreams
                      ? 'Hide lower resolutions & raw streams'
                      : `Lower resolutions (${sdRangeLabel}) & ${rawVariants.length} raw streams`}
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${showAllStreams ? 'rotate-180' : ''}`}
                  />
                </button>

                {showAllStreams && (
                  <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06] border-t border-black/[0.06] dark:border-white/[0.06]">
                    {sdTiers.map((opt) => renderLedgerRow(opt))}

                    {rawVariants.length > 0 && (
                      <div className="p-3 bg-black/[0.02] dark:bg-white/[0.02] space-y-1">
                        <div className="text-[10px] font-medium text-content-secondary uppercase tracking-wider px-1">
                          Alternative Stream Codecs
                        </div>
                        <div className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                          {rawVariants.map((opt) => {
                            const isSelected = selectedVideoOption?.id === opt.id;
                            return (
                              <div
                                key={opt.id}
                                onClick={() => setSelectedVideoId(opt.id)}
                                className={`px-3 py-2 flex items-center justify-between gap-3 text-xs font-mono cursor-pointer transition-colors ${
                                  isSelected
                                    ? 'bg-black/[0.05] dark:bg-white/[0.07] font-semibold'
                                    : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03]'
                                }`}
                              >
                                <div className="flex items-center gap-2 truncate">
                                  <span className="font-semibold">{opt.resolutionLabel}</span>
                                  <span className="text-content-secondary">{humanizeCodec(opt.codec)}</span>
                                  {opt.fps && <span className="text-content-secondary">{opt.fps}fps</span>}
                                  {opt.hdr && <span className="text-amber-500 font-semibold">HDR</span>}
                                </div>
                                <span className="tabular-nums text-content-secondary shrink-0">
                                  {opt.estimatedSizeBytes ? formatBytes(opt.estimatedSizeBytes) : '~640 MB'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Desktop 8K/4K Direct Banner - Strictly client-side to prevent SSR hydration mismatch */}
            {isDeviceLoaded && isDesktop && selectedVideoOption && selectedVideoOption.height > 1440 && (
              <div className="p-3.5 rounded-xl border border-line bg-surface-elevated text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2 text-content">
                  <Zap className="w-4 h-4 text-brand-violet shrink-0" aria-hidden="true" />
                  <span>
                    {isDirectBridgeInstalled
                      ? '⚡ MUXARO Direct Active — 8K/4K processes locally in your browser with zero cloud restrictions.'
                      : '8K/4K media requires MUXARO Direct companion for in-browser local stream processing.'}
                  </span>
                </div>
                {!isDirectBridgeInstalled && (
                  <Link
                    href={`/tools/direct-helper?url=${encodeURIComponent(manifest.sourceUrl)}`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-brand-violet hover:underline shrink-0"
                  >
                    <span>Install Helper Script</span>
                    <ArrowDown className="w-3 h-3" />
                  </Link>
                )}
              </div>
            )}

            {/* Mobile Device 2K Notice - Strictly client-side to prevent SSR hydration mismatch */}
            {isDeviceLoaded && isMobile && (
              <div className="p-3 rounded-xl border border-line bg-surface-elevated text-xs text-content-secondary flex items-center gap-2">
                <span>📱 Mobile Mode: Server-side stream copy (Up to 2K). Files download natively without browser extensions.</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. Tab Panel 2: Audio Extraction Matrix Ledger */}
      {activeTab === 'audio' && (
        <div id="panel-audio" role="tabpanel" aria-labelledby="tab-audio" className="space-y-3">
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-medium uppercase tracking-[0.08em] text-content-secondary">
              Audio Quality
            </span>
          </div>

          <div className="rounded-2xl border border-black/[0.08] dark:border-white/[0.08] divide-y divide-black/[0.06] dark:divide-white/[0.06] overflow-hidden bg-surface dark:bg-[#151517]">
            {AUDIO_PRESETS.map((preset) => {
              const isSelected = selectedAudioPreset.id === preset.id;
              const estBytes = durationSec > 0 ? durationSec * preset.estBytesRatio : undefined;
              const estSize = estBytes ? formatBytes(estBytes) : '~18 MB';

              return (
                <div
                  key={preset.id}
                  onClick={() => setSelectedAudioId(preset.id)}
                  className={`flex items-center justify-between px-3.5 sm:px-4 py-3 sm:py-3.5 cursor-pointer select-none transition-colors ${
                    isSelected
                      ? 'bg-black/[0.035] dark:bg-white/[0.055]'
                      : 'hover:bg-black/[0.015] dark:hover:bg-white/[0.025]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 border transition-all ${
                        isSelected
                          ? 'border-zinc-950 dark:border-white bg-zinc-950 dark:bg-white'
                          : 'border-black/20 dark:border-white/20 bg-transparent'
                      }`}
                    >
                      {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white dark:bg-zinc-950" />}
                    </div>

                    <span className="w-28 sm:w-32 shrink-0 text-sm font-semibold tracking-tight text-content">
                      {preset.label}
                    </span>

                    <div className="flex items-center gap-1.5 text-xs text-content-secondary tabular-nums min-w-0 truncate">
                      <span>{preset.bitrate}</span>
                      <span className="text-content-muted">·</span>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 shrink-0">
                        {preset.badge}
                      </span>
                      <span className="text-content-muted hidden md:inline">·</span>
                      <span className="hidden md:inline truncate">{preset.desc}</span>
                    </div>
                  </div>

                  <div className="text-right shrink-0 pl-2">
                    <span className="text-xs sm:text-sm font-medium text-content tabular-nums font-mono">
                      {estSize}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 5. Tab Panel 3: Subtitles Ledger */}
      {activeTab === 'subtitles' && (
        <div id="panel-subtitles" role="tabpanel" aria-labelledby="tab-subtitles" className="space-y-3">
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-medium uppercase tracking-[0.08em] text-content-secondary">
              Subtitles
            </span>

            <div className="flex items-center p-0.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-xs font-medium">
              {(['srt', 'vtt'] as const).map((ext) => (
                <button
                  key={ext}
                  type="button"
                  onClick={() => setSelectedSubtitleExt(ext)}
                  className={`px-2.5 py-1 rounded-md text-xs uppercase font-mono transition-colors ${
                    selectedSubtitleExt === ext
                      ? 'bg-white dark:bg-zinc-900 text-content shadow-xs font-semibold'
                      : 'text-content-secondary hover:text-content'
                  }`}
                >
                  .{ext}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-black/[0.08] dark:border-white/[0.08] divide-y divide-black/[0.06] dark:divide-white/[0.06] overflow-hidden bg-surface dark:bg-[#151517]">
            {(manifest.subtitles || DEFAULT_SUBTITLES).map((sub, idx) => {
              const isSelected = selectedSubtitleLang === sub.language;
              return (
                <div
                  key={`${sub.language}-${idx}`}
                  onClick={() => setSelectedSubtitleLang(sub.language)}
                  className={`flex items-center justify-between px-3.5 sm:px-4 py-3 cursor-pointer select-none transition-colors ${
                    isSelected
                      ? 'bg-black/[0.035] dark:bg-white/[0.055]'
                      : 'hover:bg-black/[0.015] dark:hover:bg-white/[0.025]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 border transition-all ${
                        isSelected
                          ? 'border-zinc-950 dark:border-white bg-zinc-950 dark:bg-white'
                          : 'border-black/20 dark:border-white/20 bg-transparent'
                      }`}
                    >
                      {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white dark:bg-zinc-950" />}
                    </div>
                    <span className="text-xs sm:text-sm font-medium text-content">{sub.language}</span>
                  </div>
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.06] text-content-secondary">
                    .{selectedSubtitleExt}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 6. Tab Panel 4: Carousel Grid (Only if multi-item carousel) */}
      {activeTab === 'carousel' && hasCarousel && (
        <div id="panel-carousel" role="tabpanel" aria-labelledby="tab-carousel" className="space-y-3">
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-medium uppercase tracking-[0.08em] text-content-secondary">
              Carousel Items
            </span>
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
              className="text-xs font-medium text-content hover:underline"
            >
              {selectedCarouselItems.size === (manifest.items?.length || 4)
                ? 'Deselect all'
                : 'Select all'}
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {(manifest.items || []).map((item, idx) => {
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
                  className={`aspect-square rounded-xl overflow-hidden relative border cursor-pointer select-none transition-all ${
                    isChecked
                      ? 'border-zinc-950 dark:border-white ring-1 ring-zinc-950 dark:ring-white'
                      : 'border-black/[0.08] dark:border-white/[0.08] hover:border-black/20'
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

      {/* 7. Live Muxing Progress Display: Razor-thin 3px precision rail */}
      {isMuxing && (
        <div className="p-3.5 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-surface-elevated space-y-2.5 shadow-xs">
          <div className="flex items-center justify-between text-xs font-medium text-content">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-content" />
              <span>{stream.stageMessage || 'Processing stream…'}</span>
            </div>
            <span className="font-mono tabular-nums font-semibold">{stream.progress}%</span>
          </div>

          {/* Razor-thin 3px precision rail */}
          <div className="w-full h-[3px] rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
            <div
              className="h-full w-full bg-neutral-900 dark:bg-white origin-left motion-safe:transition-transform motion-safe:duration-150"
              style={{ transform: `scaleX(${Math.max(0.02, Math.min(1, stream.progress / 100))})` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-content-secondary">
            <span>{videoContainer.toUpperCase()}{selectedVideoOption ? ` · ${selectedVideoOption.height}p` : ''}</span>
            {stream.progress > 0 && stream.speed && stream.speed !== '1.0x' && !stream.speed.toLowerCase().includes('copy') && (
              <span>{stream.speed}</span>
            )}
            {stream.etaSeconds > 0 && (
              <span>ETA {stream.etaSeconds}s</span>
            )}
          </div>
        </div>
      )}

      {/* Error Notice with Direct Fallback */}
      {isFailed && (
        <div
          role="alert"
          className="p-3.5 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-surface-elevated text-content text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
        >
          <div className="space-y-0.5">
            <span className="font-semibold text-content">
              {errorMessage?.includes('blocks free cloud servers') ? 'Host Restriction' : 'Direct stream available'}
            </span>
            <p className="text-content-secondary">
              {errorMessage || stream.error?.message || 'Server processing busy. You can save the direct stream immediately.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto shrink-0">
            {errorMessage?.includes('blocks free cloud servers') ? (
              <>
                <Link
                  href="/settings?tab=instances"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-violet text-white text-xs font-medium shadow-xs hover:bg-brand-violet-hover transition-colors"
                >
                  <span>Connect Custom Worker</span>
                </Link>
                <Link
                  href="/tools/direct-helper"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-line text-xs font-medium text-content hover:bg-surface transition-colors"
                >
                  <span>Desktop Direct</span>
                </Link>
              </>
            ) : (
              <button
                type="button"
                onClick={handleStartDownload}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-950 dark:bg-white text-white dark:text-zinc-950 text-xs font-medium shadow-xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Save file now</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleResetCard}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-black/[0.08] dark:border-white/[0.08] text-xs font-medium text-content-secondary hover:text-content"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Retry</span>
            </button>
          </div>
        </div>
      )}

      {/* Verified Download Card */}
      {isReady && fallbackDownloadUrl && (
        <div className="p-4 sm:p-5 rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-surface-elevated text-content text-xs sm:text-sm space-y-3.5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-black/[0.06] dark:border-white/[0.08] pb-3.5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              </div>
              <div>
                <div className="font-semibold text-content text-sm sm:text-base flex items-center gap-2">
                  <span>Verified Media Download Ready</span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 font-medium">
                    <ShieldCheck className="w-3 h-3" />
                    Bitstream Verified
                  </span>
                </div>
                <div className="text-xs text-content-secondary mt-0.5">
                  {selectedVideoOption && selectedVideoOption.height > 1440
                    ? 'Processed locally with maximum fidelity and zero cloud compression.'
                    : 'Stream-processed via instant cloud fast-path. File ready for immediate save.'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto font-mono text-xs text-content-secondary">
              <span className="px-2 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.06] text-content uppercase font-semibold">
                {activeTab === 'audio' ? selectedAudioPreset.ext : videoContainer}
              </span>
              <span>·</span>
              <span className="tabular-nums font-semibold text-content">{selectedVideoSize || audioEstSize}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
            <div className="text-xs text-content-secondary flex items-center gap-2 truncate min-w-0">
              <span className="truncate max-w-[280px] sm:max-w-md font-mono text-[11px] text-content-muted">
                {manifest.title || 'media'}.{activeTab === 'audio' ? selectedAudioPreset.ext : videoContainer}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  if (fallbackDownloadUrl && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(fallbackDownloadUrl);
                    setCopiedDownloadLink(true);
                    setTimeout(() => setCopiedDownloadLink(false), 2000);
                  }
                }}
                className="h-9 px-3 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-surface text-xs font-medium text-content-secondary hover:text-content inline-flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-content"
                title="Copy direct download link"
              >
                {copiedDownloadLink ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Link Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Link</span>
                  </>
                )}
              </button>

              <a
                href={fallbackDownloadUrl}
                download
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => triggerBrowserDownload(fallbackDownloadUrl)}
                className="h-9 px-4 rounded-xl bg-zinc-950 text-white dark:bg-white dark:text-zinc-950 text-xs sm:text-sm font-semibold shadow-sm active:scale-[0.98] transition-all inline-flex items-center gap-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-content"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Save File to Disk</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* 8. Sticky Bottom Action Dock (Instant Download Access) */}
      <div className="sticky bottom-3 z-20 mt-4 -mx-1 sm:mx-0 p-3.5 sm:p-4 rounded-2xl bg-surface/95 dark:bg-[#161618]/95 backdrop-blur-md border border-black/[0.08] dark:border-white/[0.1] shadow-lg flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Left: Dynamic Choice Summary */}
        <div className="space-y-0.5 min-w-0">
          <div className="text-sm font-semibold text-content tabular-nums tracking-tight truncate">
            {activeChoiceHeading}
          </div>
          <div className="text-xs text-content-secondary flex items-center gap-1.5">
            <span>{activeChoiceSubline}</span>
          </div>
        </div>

        {/* Right: High-Contrast Solid Primary Button */}
        <div className="flex items-center gap-2 shrink-0">
          {isReady && (
            <button
              type="button"
              onClick={handleResetCard}
              className="h-11 px-4 rounded-xl border border-black/[0.08] dark:border-white/[0.08] text-xs font-medium text-content-secondary hover:text-content hover:bg-surface-elevated transition-colors"
            >
              Convert another
            </button>
          )}

          <button
            type="button"
            onClick={handleStartDownload}
            disabled={submitting || (!isReady && isMuxing)}
            className="w-full sm:w-auto h-11 px-6 rounded-xl font-medium text-sm flex items-center justify-center gap-2 active:scale-[0.985] transition-all duration-150 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {isMuxing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="tabular-nums font-mono font-medium">
                  {stream.stageMessage || 'Remuxing…'} ({stream.progress}%)
                </span>
              </>
            ) : isReady ? (
              <>
                <Download className="w-4 h-4" />
                <span>Download Ready — Click to Save</span>
              </>
            ) : isFailed ? (
              <>
                <Download className="w-4 h-4" />
                <span>Save Direct Stream File</span>
              </>
            ) : (
              <>
                <ArrowDown className="w-4 h-4" />
                <span>{actionButtonLabel}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
