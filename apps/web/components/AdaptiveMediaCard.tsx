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
  VolumeX,
  Volume2,
} from 'lucide-react';
import Link from 'next/link';
import TurnstileChallenge from './TurnstileChallenge';
import { MediaManifest, ProcessingJob } from '@/lib/types';
import { formatBytes, formatDuration } from '@/lib/formatters';
import {
  api,
  extractDisplayError,
  getApiBaseUrl,
  getRegisteredLocalFile,
  isClientOnlyAssetId,
} from '@/lib/api-client';
import { startZeroWaitStream } from '@/lib/stream-engine';
import { FFmpegWorkerClient } from '@/lib/ffmpeg/ffmpeg-client';
import { sanitizeSafeNavigationUrl } from '@/lib/url-utils';
import { isNativeAppRuntime } from '@/lib/native-bridge';
import { ResumableMultipartUploader } from '@/lib/multipart-uploader';
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

export function getTierBadge(height: number, isNativeApp = false): { label: string; className: string } {
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
      label: isNativeApp ? 'Local Ready' : 'Cloud & Local Ready',
      className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 font-medium',
    };
  }
  if (height >= 1080 || height >= 720 || height >= 480) {
    return {
      label: isNativeApp ? 'Local Ready' : 'Cloud Ready',
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
  initialPreset?: string;
  onReset: () => void;
  onJobStarted?: (job: ProcessingJob) => void;
}

export default function AdaptiveMediaCard({
  manifest,
  initialPreset,
  onReset,
  onJobStarted,
}: AdaptiveMediaCardProps) {
  const { isDesktop, isMobile, isLoaded: isDeviceLoaded } = useDeviceDetection();
  const { isInstalled: isDirectBridgeInstalled } = useMuxaroBridge();
  const { settings, mounted: settingsMounted } = useMuxaroSettings();
  const isNativeApp = isNativeAppRuntime();

  // Normalize Video & Audio Options (Full 8K support on both Mobile & Desktop)
  const allVideoOptions = useMemo(() => normalizeVideoOptions(manifest), [manifest]);
  const videoOptions = allVideoOptions;

  const audioTracks = useMemo(() => normalizeAudioOptions(manifest), [manifest]);

  // Detected Platform
  const platform = useMemo<SupportedPlatform>(() => {
    return (manifest.platform as SupportedPlatform) || detectPlatform(manifest.sourceUrl);
  }, [manifest.platform, manifest.sourceUrl]);

  // Active Segmented Tab (honors Omnibox preset if audio)
  const [activeTab, setActiveTab] = useState<SegmentedControlTab>(() =>
    initialPreset === 'audio' ? 'audio' : 'video'
  );

  // Video State
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');
  const [videoContainer, setVideoContainer] = useState<VideoContainer>('mp4');
  const [muteVideo, setMuteVideo] = useState<boolean>(() => initialPreset === 'mute');
  const [showAllStreams, setShowAllStreams] = useState<boolean>(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(() =>
    isNativeAppRuntime() ? 'native-local-verified' : null
  );
  const [challengeNonce, setChallengeNonce] = useState<number>(0);

  // Audio State
  const [selectedAudioId, setSelectedAudioId] = useState<AudioFormatId>('mp3');

  // Sync with HeroOmnibox preset or persistent user settings
  useEffect(() => {
    const presetTargetMap: Record<string, number> = {
      '8k': 4320,
      '4k': 2160,
      '2k': 1440,
      '1080p': 1080,
      '720p': 720,
      '480p': 480,
    };
    const presetHeight = initialPreset ? presetTargetMap[initialPreset] : undefined;
    if (presetHeight && videoOptions.length > 0) {
      const exactOrClosest =
        videoOptions.find((o) => o.height === presetHeight) ||
        videoOptions.find((o) => o.height <= presetHeight);
      if (exactOrClosest) {
        setSelectedVideoId(exactOrClosest.id);
        return;
      }
    }
    if (!settingsMounted) return;
    if (settings.containerFormat !== 'auto') {
      setVideoContainer(settings.containerFormat);
    }
    if (settings.audioFormat) {
      setSelectedAudioId(settings.audioFormat);
    }
    setMuteVideo(initialPreset === 'mute' || Boolean(settings.muteVideo));
    if (settings.videoQuality !== 'auto') {
      const targetHeight = parseInt(settings.videoQuality, 10);
      if (Number.isFinite(targetHeight)) {
        const match = videoOptions.find((o) => o.height === targetHeight);
        if (match) {
          setSelectedVideoId(match.id);
        }
      }
    }
  }, [initialPreset, settingsMounted, settings.containerFormat, settings.audioFormat, settings.videoQuality, videoOptions]);

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
  const [clientStreamProgress, setClientStreamProgress] = useState<{
    stage: string;
    percent: number;
    speed?: string;
    message?: string;
  } | null>(null);

  // Auto-trigger ref to prevent duplicate browser download prompts
  const autoTriggeredRef = useRef<boolean>(false);

  // Trigger browser download immediately
  const triggerBrowserDownload = useCallback((url: string, filename?: string) => {
    if (typeof window === 'undefined' || !url) return;
    const safeUrl = sanitizeSafeNavigationUrl(url);
    if (!safeUrl) return;
    try {
      const link = document.createElement('a');
      link.href = safeUrl;
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
      window.open(safeUrl, '_blank', 'noopener,noreferrer');
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

  // Primary Download Dispatcher: submit tracked backend job and hand off to JobProgress
  const handleStartDownload = async () => {
    if (submitting || stream.status === 'PROCESSING') return;

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
    const targetFormat = isAudioOnly ? selectedAudioPreset.ext : videoContainer;
    const targetResolution = isAudioOnly
      ? undefined
      : selectedVideoOption?.height
      ? `${selectedVideoOption.height}p`
      : undefined;

    // Local Upload Processing Path (homepage `/` file drops):
    // Route cleanly to in-browser FFmpegWorkerClient Web Worker first, or upload via
    // ResumableMultipartUploader + real mediaAssetId/uploadSessionId if server job is needed.
    if (manifest.isLocalUpload) {
      const localFile = getRegisteredLocalFile(manifest.id);

      if (localFile && !isCarousel && activeTab !== 'subtitles') {
        setClientStreamProgress({
          stage: 'pipelining',
          percent: 5,
          message: isAudioOnly
            ? 'Extracting audio in browser worker…'
            : 'Remuxing container in browser worker…',
        });
        try {
          const worker = FFmpegWorkerClient.getInstance();
          const workerRes = isAudioOnly
            ? await worker.extractAudio({
                file: localFile,
                fileName: localFile.name,
                targetFormat: selectedAudioPreset.ext as any,
                streamCopy: selectedAudioPreset.ext === 'm4a' || selectedAudioPreset.ext === 'opus',
                onProgress: (p) => {
                  const pct = Math.max(5, Math.min(99, Math.round((p.ratio || 0) * 100)));
                  setClientStreamProgress({
                    stage: 'finalizing',
                    percent: pct,
                    message: p.timeSeconds
                      ? `Extracting audio (${Math.round(p.timeSeconds)}s processed)…`
                      : 'Extracting audio in browser worker…',
                  });
                },
              })
            : await worker.convert({
                file: localFile,
                fileName: localFile.name,
                targetContainer: videoContainer,
                streamCopy: true,
                onProgress: (p) => {
                  const pct = Math.max(5, Math.min(99, Math.round((p.ratio || 0) * 100)));
                  setClientStreamProgress({
                    stage: 'finalizing',
                    percent: pct,
                    message: p.timeSeconds
                      ? `Remuxing ${videoContainer.toUpperCase()} (${Math.round(p.timeSeconds)}s processed)…`
                      : `Remuxing ${videoContainer.toUpperCase()} in browser worker…`,
                  });
                },
              });

          setClientStreamProgress(null);
          setFallbackDownloadUrl(workerRes.url);
          autoTriggeredRef.current = true;
          triggerBrowserDownload(workerRes.url, workerRes.fileName);
          saveToDownloadsHistory(
            `dl_${Date.now()}`,
            workerRes.url,
            manifest.title,
            targetFormat,
            workerRes.sizeBytes || localFile.size
          );
          setSubmitting(false);
          return;
        } catch (workerErr: any) {
          console.warn(
            '[FFmpegWorker] Local worker processing failed, trying server upload fallback:',
            workerErr
          );
          setClientStreamProgress(null);
        }
      }

      try {
        let serverAssetId =
          manifest.id && !isClientOnlyAssetId(manifest.id) ? manifest.id : '';

        if (!serverAssetId) {
          if (!localFile) {
            throw new Error('Local file reference is no longer available. Please choose the file again.');
          }
          setClientStreamProgress({
            stage: 'connecting',
            percent: 2,
            message: 'Uploading local file for server processing…',
          });
          const uploader = new ResumableMultipartUploader(localFile, {
            apiBase: getApiBaseUrl(),
            tool: isAudioOnly ? 'extract_audio' : 'convert_video',
            targetFormat,
            onProgress: (stats) => {
              setClientStreamProgress({
                stage: 'pipelining',
                percent: stats.percent,
                speed: `${stats.mbps} MB/s`,
                message: `Uploading to media worker (${stats.percent}%)…`,
              });
            },
          });
          const uploaded = await uploader.start();
          setClientStreamProgress(null);
          serverAssetId = String(
            uploaded?.assetId || uploaded?.id || uploaded?.uploadSessionId || uploaded?.uploadId || ''
          );
        }

        if (!serverAssetId) {
          throw new Error('Upload completed without a server mediaAssetId.');
        }

        const job = await api.createJob({
          mediaAssetId: serverAssetId,
          uploadSessionId: serverAssetId,
          operation,
          targetFormat,
          targetResolution,
          targetAudioCodec: isAudioOnly ? selectedAudioPreset.ext : undefined,
          streamCopy: !isAudioOnly,
          title: manifest.title,
          fileSizeBytes: manifest.fileSizeBytes,
        });

        if (job && job.id) {
          setActiveJobId(job.id);
          onJobStarted?.(job);
          const readyUrl =
            job.downloadUrl ||
            (job as any).url ||
            (job.status === 'READY'
              ? `/api/v1/jobs/${encodeURIComponent(job.id)}/download`
              : null);
          if (readyUrl && job.status === 'READY') {
            setFallbackDownloadUrl(readyUrl);
            autoTriggeredRef.current = true;
            triggerBrowserDownload(readyUrl, job.outputFilename);
            saveToDownloadsHistory(
              job.id,
              readyUrl,
              manifest.title,
              targetFormat,
              job.outputSizeBytes || job.artifact?.size || manifest.fileSizeBytes
            );
          }
        }
        return;
      } catch (localErr: unknown) {
        setClientStreamProgress(null);
        const displayErr = extractDisplayError(
          localErr,
          'Could not process this local file in-browser or upload it to a configured media server.'
        );
        console.error('[MUXARO Local Processing Error]', displayErr, localErr);
        setErrorMessage(displayErr);
        return;
      } finally {
        setSubmitting(false);
      }
    }

    const activeCaptchaToken = captchaToken || (isNativeApp ? 'native-local-verified' : null);
    if (!manifest.isLocalUpload && !activeCaptchaToken) {
      setErrorMessage('Please wait a moment for browser verification to complete, then click Retry.');
      setChallengeNonce((n) => n + 1);
      setSubmitting(false);
      return;
    }

    // Submit real tracked job -> HomePage opens JobProgress with live percentage & ETA
    try {
      const shouldMute = !isAudioOnly && muteVideo;
      const job = await api.createJob({
        sourceUrl: manifest.sourceUrl,
        mediaUrl: manifest.sourceUrl,
        operation,
        targetFormat,
        targetResolution,
        formatId: selectedVideoOption?.formatId,
        videoFormatId: selectedVideoOption?.formatId,
        ...(shouldMute
          ? { muteVideo: true, noAudio: true }
          : { audioFormatId: manifest.audioStreams?.[0]?.formatId || 'ba/b' }),
        captchaToken: activeCaptchaToken || undefined,
        title: manifest.title,
        fileSizeBytes: selectedVideoOption?.estimatedSizeBytes || manifest.fileSizeBytes,
      } as any);

      if (job && job.id) {
        setActiveJobId(job.id);
        onJobStarted?.(job);
      } else {
        throw new Error('Could not create download job.');
      }
    } catch (err: unknown) {
      const displayErr = extractDisplayError(
        err,
        'Download failed to start. Please verify the link and try again.'
      );
      const errStatus = (err as { status?: number } | null)?.status;
      if (errStatus === 403 && /verification|captcha/i.test(displayErr)) {
        setCaptchaToken(null);
        setChallengeNonce((n) => n + 1);
      }
      console.error('[MUXARO Download Error]', displayErr, err);
      setErrorMessage(displayErr);
    } finally {
      setSubmitting(false);
    }
  };

  // Status computation for Primary CTA
  const isReady = stream.status === 'READY' || Boolean(fallbackDownloadUrl);
  const isMuxing =
    !isReady &&
    (Boolean(clientStreamProgress) ||
      (Boolean(activeJobId) &&
        (stream.status === 'PROCESSING' ||
          stream.status === 'VALIDATING' ||
          stream.status === 'QUEUED' ||
          stream.status === 'DOWNLOADING_VIDEO' ||
          stream.status === 'DOWNLOADING_AUDIO' ||
          stream.status === 'MERGING' ||
          stream.status === 'CONVERTING' ||
          stream.status === 'VERIFYING')));
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
      return `${selectedTierName} ${videoContainer.toUpperCase()}${muteVideo ? ' (Muted)' : ''} — ${selectedVideoSize}`;
    }
    if (activeTab === 'audio') {
      return `${selectedAudioPreset.label} — ${audioEstSize}`;
    }
    if (activeTab === 'subtitles') {
      return `${selectedSubtitleLang} Subtitles (.${selectedSubtitleExt.toUpperCase()})`;
    }
    return `Carousel Archive (${selectedCarouselItems.size || manifest.items?.length || 0} items)`;
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
      if (muteVideo) {
        return 'Video stream only · Audio track stripped cleanly';
      }
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
      if (isNativeApp) {
        return 'Local on-device extraction & FFmpeg muxing';
      }
      return isDirectRemux
        ? 'Instant cloud-side stream copy · 60m secure retention'
        : 'Instant cloud-side remux · Lossless video · 60m secure retention';
    }
    if (activeTab === 'audio') {
      return isNativeApp
        ? 'Local on-device audio extraction'
        : 'Instant cloud-side audio extraction · 60m secure retention';
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

    const badge = getTierBadge(opt.height, isNativeApp);

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
            className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 border transition-[background-color,border-color] duration-150 ${
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
          <div className="flex flex-wrap items-center gap-2 text-xs text-content-secondary tabular-nums min-w-0">
            <span>{opt.height}p</span>
            <span className="text-content-muted">{framerate}</span>
            <span className="text-content-muted">{humanizeCodec(opt.codec)}</span>

            {/* Clear Tier Badge */}
            <span className={`text-[10px] px-2 py-0.5 rounded ${badge.className}`}>
              {badge.label}
            </span>

            {opt.hdr && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                HDR
              </span>
            )}

            {opt.recommended && (
              <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-elevated border border-line-subtle text-content-secondary">
                Recommended
              </span>
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
                href={sanitizeSafeNavigationUrl(manifest.sourceUrl) ?? '#'}
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
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-[background-color,color,box-shadow] duration-150 text-center flex items-center justify-center gap-1.5 select-none ${
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

      {/* 3. Tab Panel 1: Video High-Density Architectural Resolution Ledger */}
      {activeTab === 'video' && (
        <div id="panel-video" role="tabpanel" aria-labelledby="tab-video" className="muxaro-panel-swap space-y-3">
          {/* Header Toolbar Row */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-semibold text-content-secondary">
                Resolution
              </span>
              {selectedVideoOption && selectedVideoOption.height <= 1440 ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 text-[11px] font-mono font-medium">
                  Instant Cloud Stream
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-zinc-950 text-white dark:bg-white dark:text-zinc-950 text-[11px] font-mono font-semibold">
                  Local Direct Stream
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Mute Sound Toggle */}
              <button
                type="button"
                aria-pressed={muteVideo}
                onClick={() => setMuteVideo((prev) => !prev)}
                title={muteVideo ? 'Audio will be stripped (video only)' : 'Include original audio track'}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  muteVideo
                    ? 'bg-content text-base border-content font-semibold'
                    : 'bg-black/[0.04] dark:bg-white/[0.06] border-black/[0.06] dark:border-white/[0.08] text-content-secondary hover:text-content'
                }`}
              >
                {muteVideo ? (
                  <VolumeX className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                )}
                <span>{muteVideo ? 'Sound Muted' : 'Mute Sound'}</span>
              </button>

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
                        <div className="text-[11px] font-medium text-content-secondary px-1">
                          Alternative stream codecs
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

            {/* Desktop 8K/4K Direct Banner (hidden/replaced with Local Engine note inside native EXE/APK) */}
            {isDeviceLoaded && isDesktop && selectedVideoOption && selectedVideoOption.height > 1440 && (
              <div className="p-3.5 rounded-xl border border-line bg-surface-elevated text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2 text-content">
                  <Zap className="w-4 h-4 text-content shrink-0" aria-hidden="true" />
                  <span>
                    {isNativeApp
                      ? 'Local Engine Active — 8K/4K streams extract and mux directly on your device.'
                      : isDirectBridgeInstalled
                      ? 'MUXARO Direct Active — 8K/4K streams locally in your browser without cloud caps.'
                      : '8K/4K streams route locally via MUXARO Direct companion.'}
                  </span>
                </div>
                {!isNativeApp && !isDirectBridgeInstalled && (
                  <Link
                    href={`/tools/direct-helper?url=${encodeURIComponent(manifest.sourceUrl)}`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-content hover:underline shrink-0"
                  >
                    <span>Install Helper Script</span>
                    <ArrowDown className="w-3 h-3" />
                  </Link>
                )}
              </div>
            )}

            {/* Mobile Device Up to 8K Notice */}
            {isDeviceLoaded && isMobile && (
              <div className="p-3 rounded-xl border border-line bg-surface-elevated text-xs text-content-secondary flex items-center gap-2">
                <span>
                  {isNativeApp
                    ? 'On-Device Mode: Direct local processing and save.'
                    : 'Mobile Mode: Full up to 8K cloud remux & lossless downloads saved directly to your device.'}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. Tab Panel 2: Audio Extraction Matrix Ledger */}
      {activeTab === 'audio' && (
        <div id="panel-audio" role="tabpanel" aria-labelledby="tab-audio" className="muxaro-panel-swap space-y-3">
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-semibold text-content-secondary">
              Audio quality
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
                      className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 border transition-[background-color,border-color] duration-150 ${
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

                    <div className="flex items-center gap-2 text-xs text-content-secondary tabular-nums min-w-0 truncate">
                      <span>{preset.bitrate}</span>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 shrink-0">
                        {preset.badge}
                      </span>
                      <span className="hidden md:inline text-content-muted truncate">{preset.desc}</span>
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
        <div id="panel-subtitles" role="tabpanel" aria-labelledby="tab-subtitles" className="muxaro-panel-swap space-y-3">
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-semibold text-content-secondary">
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
                      className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 border transition-[background-color,border-color] duration-150 ${
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
        <div id="panel-carousel" role="tabpanel" aria-labelledby="tab-carousel" className="muxaro-panel-swap space-y-3">
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-semibold text-content-secondary">
              Carousel items
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
                  className={`aspect-square rounded-xl overflow-hidden relative border cursor-pointer select-none transition-[border-color,transform] duration-150 ${
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
              <span>{clientStreamProgress?.message || stream.stageMessage || 'Processing stream…'}</span>
            </div>
            <span className="font-mono tabular-nums font-semibold">
              {clientStreamProgress ? clientStreamProgress.percent : stream.progress}%
            </span>
          </div>

          {/* Razor-thin 3px precision rail */}
          <div className="w-full h-[3px] rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
            <div
              className="h-full w-full bg-neutral-900 dark:bg-white origin-left motion-safe:transition-transform motion-safe:duration-150"
              style={{
                transform: `scaleX(${Math.max(
                  0.02,
                  Math.min(1, (clientStreamProgress ? clientStreamProgress.percent : stream.progress) / 100)
                )})`,
              }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-content-secondary">
            <span>{videoContainer.toUpperCase()}{selectedVideoOption ? ` · ${selectedVideoOption.height}p` : ''}</span>
            {(clientStreamProgress?.speed || (stream.progress > 0 && stream.speed && stream.speed !== '1.0x' && !stream.speed.toLowerCase().includes('copy'))) && (
              <span>{clientStreamProgress?.speed || stream.speed}</span>
            )}
            {stream.etaSeconds > 0 && (
              <span>ETA {stream.etaSeconds}s</span>
            )}
          </div>
        </div>
      )}

      {/* Error Notice with Honest Fallback */}
      {isFailed && (() => {
        const displayErr = errorMessage || stream.error?.message || '';
        const errLower = displayErr.toLowerCase();
        const isHostRestricted =
          errLower.includes('blocks free cloud servers') ||
          errLower.includes('host_blocked') ||
          errLower.includes('host restriction');
        const isBackendUnconfigured =
          errLower.includes('not configured') ||
          errLower.includes('degraded') ||
          errLower.includes('err_backend_not_configured');
        const hasValidDirectStream = Boolean(
          (selectedVideoOption?.stream?.url || manifest.directStreamUrl) &&
            !/^blob:/i.test(selectedVideoOption?.stream?.url || manifest.directStreamUrl || '')
        );
        const showDirectSave = hasValidDirectStream && !isHostRestricted && !isBackendUnconfigured;

        const headingText = isHostRestricted
          ? 'Host Restriction'
          : isBackendUnconfigured
          ? 'Backend Unavailable'
          : showDirectSave
          ? 'Direct stream available'
          : 'Processing Error';

        return (
          <div
            role="alert"
            className="p-3.5 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-surface-elevated text-content text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
          >
            <div className="space-y-0.5">
              <span className="font-semibold text-content">{headingText}</span>
              <p className="text-content-secondary">
                {displayErr || 'Could not process this media request right now.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto shrink-0">
              {isHostRestricted || isBackendUnconfigured ? (
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
              ) : showDirectSave ? (
                <button
                  type="button"
                  onClick={() => void handleStartDownload()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-950 dark:bg-white text-white dark:text-zinc-950 text-xs font-medium shadow-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Save file now</span>
                </button>
              ) : null}
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
        );
      })()}

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
                href={sanitizeSafeNavigationUrl(fallbackDownloadUrl) ?? '#'}
                download
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => triggerBrowserDownload(fallbackDownloadUrl)}
                className="h-9 px-4 rounded-xl bg-zinc-950 text-white dark:bg-white dark:text-zinc-950 text-xs sm:text-sm font-semibold shadow-sm active:scale-[0.98] transition-[background-color,opacity,transform] duration-150 inline-flex items-center gap-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-content"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Save File to Disk</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Browser Security Gate (Never rendered inside native EXE or APK apps) */}
      {!isNativeApp && !manifest.isLocalUpload && !isReady && (
        <TurnstileChallenge
          key={challengeNonce}
          onVerify={(tok) => {
            setCaptchaToken(tok);
            setErrorMessage((prev) =>
              prev && /verification|captcha/i.test(prev) ? null : prev
            );
          }}
          onReset={() => setCaptchaToken(null)}
        />
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
            onClick={() => void handleStartDownload()}
            disabled={submitting || (!isReady && isMuxing)}
            className="w-full sm:w-auto h-11 px-6 rounded-xl font-medium text-sm flex items-center justify-center gap-2 active:scale-[0.985] transition-[background-color,opacity,transform] duration-150 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {isMuxing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="tabular-nums font-mono font-medium">
                  {clientStreamProgress?.message || stream.stageMessage || 'Remuxing…'} ({clientStreamProgress ? clientStreamProgress.percent : stream.progress}%)
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
