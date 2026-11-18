'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Film,
  Music,
  Layers,
  Clock,
  HardDrive,
  AlertCircle,
  Play,
  Download,
  Check,
  ChevronDown,
  Minimize2,
  Upload,
  Info,
  SlidersHorizontal,
} from 'lucide-react';
import { MediaManifest, ProcessingJob } from '@/lib/types';
import { formatBytes, formatDuration } from '@/lib/formatters';
import { api } from '@/lib/api-client';
import {
  normalizeVideoOptions,
  normalizeAudioOptions,
  getSavedQualityPreference,
  saveQualityPreference,
  NormalizedVideoOption,
  NormalizedAudioTrack,
} from '@/lib/format-normalizer';

interface MediaInspectorProps {
  manifest: MediaManifest;
  onJobStarted: (job: ProcessingJob) => void;
}

type InspectorMode = 'video' | 'audio' | 'merge';
type AudioFormatId = 'original' | 'mp3' | 'm4a' | 'wav' | 'opus' | 'flac';
type VideoContainer = 'mp4' | 'mkv' | 'webm';
type CompressTarget = '720p' | '480p';

interface AudioFormatChoice {
  id: AudioFormatId;
  label: string;
  description: string;
  badge?: string;
}

const AUDIO_FORMATS: AudioFormatChoice[] = [
  {
    id: 'original',
    label: 'Original audio',
    description: 'Fastest option. Keeps the exact source audio without re-encoding.',
    badge: 'Fastest',
  },
  {
    id: 'mp3',
    label: 'MP3',
    description: 'Plays reliably on phones, cars, and everyday speakers.',
    badge: 'Most compatible',
  },
  {
    id: 'm4a',
    label: 'M4A',
    description: 'Compact high-clarity audio ideal for Apple devices and mobile.',
  },
  {
    id: 'opus',
    label: 'Opus',
    description: 'Smallest file size with clear voice and music reproduction.',
  },
  {
    id: 'wav',
    label: 'WAV',
    description: 'Uncompressed audio ready for video editors and music apps.',
  },
  {
    id: 'flac',
    label: 'FLAC',
    description: 'Uncompressed-quality archival format with no added compression.',
  },
];

function formatOptionSize(bytes: number | undefined, isEstimate: boolean): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return null;
  return `${isEstimate ? '~' : ''}${formatBytes(bytes)}`;
}

export default function MediaInspector({ manifest, onJobStarted }: MediaInspectorProps) {
  const [savedPref, setSavedPref] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [thumbnailError, setThumbnailError] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setSavedPref(getSavedQualityPreference());
  }, []);

  const videoOptions: NormalizedVideoOption[] = useMemo(
    () => normalizeVideoOptions(manifest, savedPref),
    [manifest, savedPref]
  );

  const audioTracks: NormalizedAudioTrack[] = useMemo(
    () => normalizeAudioOptions(manifest),
    [manifest]
  );

  const isLocalUpload =
    Boolean(manifest?.isLocalUpload) ||
    !/^https?:\/\//i.test(String(manifest?.sourceUrl || '').trim());

  const defaultMode: InspectorMode =
    videoOptions.length === 0 && audioTracks.length > 0 ? 'audio' : 'video';

  const [mode, setMode] = useState<InspectorMode>(defaultMode);
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');
  const [compressEnabled, setCompressEnabled] = useState<boolean>(false);
  const [compressTarget, setCompressTarget] = useState<CompressTarget>('720p');
  const [moreOptionsOpen, setMoreOptionsOpen] = useState<boolean>(false);
  const [targetContainer, setTargetContainer] = useState<VideoContainer>('mp4');

  const [selectedAudioFormat, setSelectedAudioFormat] = useState<AudioFormatId>('mp3');
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<string>('');

  // Merge mode optional external audio state
  const [mergeAudioSource, setMergeAudioSource] = useState<'included' | 'separate'>('included');
  const [separateAudioUrl, setSeparateAudioUrl] = useState<string>('');
  const [separateAudioAssetId, setSeparateAudioAssetId] = useState<string | null>(null);
  const [separateAudioName, setSeparateAudioName] = useState<string | null>(null);
  const [uploadingAudio, setUploadingAudio] = useState<boolean>(false);

  // Reset selections cleanly whenever a new manifest arrives
  useEffect(() => {
    setMode(defaultMode);
    const recommended = videoOptions.find((o) => o.recommended) || videoOptions[0];
    setSelectedVideoId(recommended?.id || '');
    setCompressEnabled(Boolean(isLocalUpload && videoOptions.length > 0));
    setCompressTarget('720p');
    setMoreOptionsOpen(false);
    setTargetContainer('mp4');
    setSelectedAudioTrackId(audioTracks[0]?.id || '');
    setMergeAudioSource(audioTracks.length > 0 ? 'included' : 'separate');
    setSeparateAudioUrl('');
    setSeparateAudioAssetId(null);
    setSeparateAudioName(null);
    setThumbnailError(false);
    setErrorMsg(null);
  }, [manifest, defaultMode, isLocalUpload, videoOptions, audioTracks]);

  if (!manifest) {
    return null;
  }

  const selectedVideo =
    videoOptions.find((o) => o.id === selectedVideoId) ||
    videoOptions.find((o) => o.recommended) ||
    videoOptions[0] ||
    null;

  const selectedAudioTrack =
    audioTracks.find((t) => t.id === selectedAudioTrackId) || audioTracks[0] || null;

  const cleanTitle = String(manifest.title || 'Media file').trim();
  const showAuthor =
    Boolean(manifest.author) &&
    manifest.author !== 'Verified Source Pipeline' &&
    manifest.author !== 'Local Computer Upload';
  const durationSeconds =
    typeof manifest.durationSeconds === 'number' && Number.isFinite(manifest.durationSeconds)
      ? manifest.durationSeconds
      : 0;
  const fileSizeBytes =
    typeof manifest.fileSizeBytes === 'number' && Number.isFinite(manifest.fileSizeBytes)
      ? manifest.fileSizeBytes
      : 0;
  const durationText = durationSeconds > 0 ? formatDuration(durationSeconds) : null;
  const sizeText = fileSizeBytes > 0 ? formatBytes(fileSizeBytes) : null;

  const handleSelectVideoOption = (option: NormalizedVideoOption) => {
    setSelectedVideoId(option.id);
    setCompressEnabled(false);
    if (option.height > 0) {
      saveQualityPreference(option.height);
    }
  };

  const handleStartVideoJob = async () => {
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      if (compressEnabled) {
        const job = await api.createJob({
          mediaAssetId: manifest.id || undefined,
          sourceUrl: manifest.sourceUrl || undefined,
          jobType: 'transcode_video',
          operation: 'CONVERT_FORMAT',
          targetFormat: targetContainer,
          targetResolution: compressTarget,
          streamCopy: false,
          title: `${cleanTitle} (Compressed)`,
        });
        onJobStarted(job);
      } else {
        if (!selectedVideo) return;
        const useStreamCopy =
          selectedVideo.isStreamCopyCandidate && targetContainer === 'mp4';
        const job = await api.createJob({
          mediaAssetId: manifest.id || undefined,
          sourceUrl: manifest.sourceUrl || undefined,
          jobType: 'transcode_video',
          operation: useStreamCopy ? 'REMUX_STREAM_COPY' : 'TRANSCODE_VIDEO',
          targetFormat: targetContainer,
          targetResolution: selectedVideo.resolutionLabel,
          formatId: selectedVideo.formatId,
          streamCopy: useStreamCopy,
          title: cleanTitle,
        });
        onJobStarted(job);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not start video processing.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartAudioJob = async () => {
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const isOriginal = selectedAudioFormat === 'original';
      const sourceCodec = String(selectedAudioTrack?.codec || '').toLowerCase();
      const targetFormat = isOriginal
        ? sourceCodec.includes('aac') || sourceCodec.includes('mp4a')
          ? 'm4a'
          : sourceCodec.includes('flac')
          ? 'flac'
          : sourceCodec.includes('mp3')
          ? 'mp3'
          : 'opus'
        : selectedAudioFormat;

      const job = await api.createJob({
        mediaAssetId: manifest.id || undefined,
        sourceUrl: manifest.sourceUrl || undefined,
        jobType: 'extract_audio',
        operation: 'EXTRACT_AUDIO',
        targetFormat,
        targetAudioCodec: targetFormat,
        streamCopy: isOriginal,
        title: cleanTitle,
      });
      onJobStarted(job);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not start audio extraction.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUploadSeparateAudio = async (file: File) => {
    if (!file || uploadingAudio) return;
    setUploadingAudio(true);
    setErrorMsg(null);
    try {
      const uploaded = await api.uploadLocalFile(file);
      setSeparateAudioAssetId(uploaded.id || null);
      setSeparateAudioName(file.name);
      setSeparateAudioUrl('');
      setMergeAudioSource('separate');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not upload the separate audio file.');
    } finally {
      setUploadingAudio(false);
    }
  };

  const handleStartMergeJob = async () => {
    if (submitting || !selectedVideo) return;
    if (
      mergeAudioSource === 'separate' &&
      !separateAudioAssetId &&
      !/^https?:\/\//i.test(separateAudioUrl.trim())
    ) {
      setErrorMsg('Please choose an audio file or paste a valid audio link to merge.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const job = await api.createJob({
        mediaAssetId: manifest.id || undefined,
        sourceUrl: manifest.sourceUrl || undefined,
        audioAssetId: mergeAudioSource === 'separate' ? separateAudioAssetId || undefined : undefined,
        audioUrl:
          mergeAudioSource === 'separate' && /^https?:\/\//i.test(separateAudioUrl.trim())
            ? separateAudioUrl.trim()
            : undefined,
        jobType: 'merge_av',
        operation: 'MERGE_AUDIO_VIDEO',
        targetFormat: targetContainer,
        targetResolution: selectedVideo.resolutionLabel,
        formatId: selectedVideo.formatId,
        streamCopy:
          mergeAudioSource === 'included' &&
          Boolean(selectedVideo.isStreamCopyCandidate) &&
          Boolean(selectedAudioTrack?.stream?.isStreamCopyCandidate),
        title: `${cleanTitle} (Merged)`,
      });
      onJobStarted(job);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not start merging your files.');
    } finally {
      setSubmitting(false);
    }
  };

  const showLossyDisclosure =
    (selectedAudioFormat === 'flac' || selectedAudioFormat === 'wav') &&
    selectedAudioTrack !== null &&
    !selectedAudioTrack.isNativeLossless;

  const primaryVideoCtaLabel = submitting
    ? 'Starting...'
    : compressEnabled
    ? 'Compress video'
    : 'Download video';

  const primaryAudioCtaLabel = submitting ? 'Starting...' : 'Download audio';
  const primaryMergeCtaLabel = submitting ? 'Starting...' : 'Merge video and audio';

  return (
    <section
      aria-label="Choose format and quality"
      className="bg-surface border border-line rounded-2xl shadow-card overflow-hidden"
    >
      {/* Clean Everyday Media Header */}
      <div className="p-5 sm:p-6 border-b border-line bg-surface">
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,13.5rem)_minmax(0,1fr)] gap-5 items-center">
          {/* Thumbnail */}
          <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-surface-elevated border border-line flex items-center justify-center">
            {manifest.thumbnailUrl && !thumbnailError ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={manifest.thumbnailUrl}
                alt={cleanTitle}
                onError={() => setThumbnailError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center"
                style={{ background: 'var(--muxaro-gradient-subtle)' }}
              >
                <div className="w-11 h-11 rounded-full bg-surface border border-line flex items-center justify-center shadow-subtle">
                  <Play aria-hidden="true" className="w-5 h-5 text-brand ml-0.5" />
                </div>
              </div>
            )}

            {durationText && (
              <span
                className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md text-xs font-medium flex items-center gap-1 shadow-sm"
                style={{
                  backgroundColor: 'var(--dark-bg-surface)',
                  color: 'var(--dark-text-primary)',
                }}
              >
                <Clock aria-hidden="true" className="w-3 h-3" />
                <span>{durationText}</span>
              </span>
            )}
          </div>

          {/* Title, Creator, Duration & Size */}
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-content leading-snug break-words min-w-0">
              {cleanTitle}
            </h2>

            {showAuthor && (
              <p className="text-sm text-content-secondary mt-1 truncate">
                {manifest.author}
              </p>
            )}

            {(durationText || sizeText) && (
              <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-content-secondary">
                {durationText && (
                  <span className="inline-flex items-center gap-1.5">
                    <Clock aria-hidden="true" className="w-3.5 h-3.5 text-content-muted" />
                    <span>{durationText}</span>
                  </span>
                )}
                {sizeText && (
                  <span className="inline-flex items-center gap-1.5">
                    <HardDrive aria-hidden="true" className="w-3.5 h-3.5 text-content-muted" />
                    <span>{sizeText}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Friendly Error Banner */}
      {errorMsg && (
        <div
          role="alert"
          className="mx-5 sm:mx-6 mt-5 p-3.5 rounded-xl bg-error-bg border border-line text-error text-sm flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle aria-hidden="true" className="w-4 h-4 flex-shrink-0" />
            <span className="break-words">{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-xs font-semibold hover:underline flex-shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:opacity-80"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 3 Primary Modes: Video, Audio, Merge */}
      <div className="px-5 sm:px-6 pt-5 pb-4">
        <div
          role="tablist"
          aria-label="Output mode"
          className="grid grid-cols-3 gap-1.5 p-1 bg-surface-elevated rounded-xl border border-line"
        >
          <button
            id="tab-video"
            type="button"
            role="tab"
            aria-selected={mode === 'video'}
            aria-controls="panel-video"
            onClick={() => setMode('video')}
            className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:opacity-90 ${
              mode === 'video'
                ? 'bg-surface text-content shadow-subtle font-semibold border border-line'
                : 'text-content-secondary hover:text-content'
            }`}
          >
            <Film
              aria-hidden="true"
              className={`w-4 h-4 ${mode === 'video' ? 'text-brand' : 'text-content-muted'}`}
            />
            <span>Video</span>
          </button>

          <button
            id="tab-audio"
            type="button"
            role="tab"
            aria-selected={mode === 'audio'}
            aria-controls="panel-audio"
            onClick={() => setMode('audio')}
            className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:opacity-90 ${
              mode === 'audio'
                ? 'bg-surface text-content shadow-subtle font-semibold border border-line'
                : 'text-content-secondary hover:text-content'
            }`}
          >
            <Music
              aria-hidden="true"
              className={`w-4 h-4 ${mode === 'audio' ? 'text-brand-blue' : 'text-content-muted'}`}
            />
            <span>Audio</span>
          </button>

          <button
            id="tab-merge"
            type="button"
            role="tab"
            aria-selected={mode === 'merge'}
            aria-controls="panel-merge"
            onClick={() => setMode('merge')}
            className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:opacity-90 ${
              mode === 'merge'
                ? 'bg-surface text-content shadow-subtle font-semibold border border-line'
                : 'text-content-secondary hover:text-content'
            }`}
          >
            <Layers
              aria-hidden="true"
              className={`w-4 h-4 ${mode === 'merge' ? 'text-brand-cyan' : 'text-content-muted'}`}
            />
            <span>Merge</span>
          </button>
        </div>
      </div>

      {/* Mode Panels */}
      <div className="px-5 sm:px-6 pb-6">
        {/* MODE 1: VIDEO (Deduplicated Scannable Quality List + Optional Compress + More Options) */}
        {mode === 'video' && (
          <div id="panel-video" role="tabpanel" aria-labelledby="tab-video" className="space-y-4">
            {videoOptions.length === 0 ? (
              <div className="p-6 text-center rounded-xl bg-surface-elevated border border-line text-content-secondary text-sm">
                This file contains audio only. Switch to the Audio tab to download it.
              </div>
            ) : (
              <>
                <p className="text-sm text-content-secondary">
                  Choose a quality supported by this video, or shrink the file size for sharing.
                </p>

                {/* Scannable, Deduplicated Quality Selector List */}
                <div
                  role="radiogroup"
                  aria-label="Video quality options"
                  className="divide-y divide-line rounded-xl border border-line bg-surface overflow-hidden"
                >
                  {videoOptions.map((option) => {
                    const isSelected = !compressEnabled && selectedVideo?.id === option.id;
                    const sizeDisplay = formatOptionSize(
                      option.estimatedSizeBytes,
                      option.sizeIsEstimate
                    );

                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => handleSelectVideoOption(option)}
                        className={`w-full px-4 py-3 text-left flex flex-wrap items-center justify-between gap-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand active:opacity-90 ${
                          isSelected
                            ? 'bg-surface-elevated'
                            : 'bg-surface hover:bg-surface-elevated'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                          <span
                            aria-hidden="true"
                            className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${
                              isSelected
                                ? 'border-brand bg-brand'
                                : 'border-line bg-surface'
                            }`}
                            style={isSelected ? { color: 'var(--muxaro-btn-fg)' } : undefined}
                          >
                            {isSelected && <Check className="w-2.5 h-2.5" />}
                          </span>

                          <span className="font-semibold text-sm text-content">
                            {option.resolutionLabel}
                          </span>
                          <span className="text-sm text-content-secondary">
                            {option.qualityName}
                          </span>

                          {option.fpsBadge && (
                            <span className="px-2 py-0.5 rounded-md bg-surface border border-line text-xs font-medium text-content-secondary">
                              {option.fpsBadge}
                            </span>
                          )}

                          {option.hdr && (
                            <span className="px-2 py-0.5 rounded-md bg-warning-bg text-warning text-xs font-semibold">
                              HDR
                            </span>
                          )}

                          {option.recommended && (
                            <span className="px-2 py-0.5 rounded-full bg-info-bg text-brand text-xs font-medium">
                              Recommended
                            </span>
                          )}
                        </div>

                        {sizeDisplay && (
                          <span className="text-xs font-medium text-content-secondary font-mono flex-shrink-0">
                            {sizeDisplay}
                          </span>
                        )}
                      </button>
                    );
                  })}

                  {/* Optional Smaller File (Compress) Row — especially handy for computer uploads */}
                  <div
                    className={`px-4 py-3 transition-colors ${
                      compressEnabled ? 'bg-surface-elevated' : 'bg-surface'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2.5 min-w-0 flex-1">
                        <button
                          type="button"
                          role="radio"
                          aria-checked={compressEnabled}
                          onClick={() => setCompressEnabled(true)}
                          className="inline-flex items-center gap-2 text-left whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded active:opacity-90"
                        >
                          <span
                            aria-hidden="true"
                            className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${
                              compressEnabled
                                ? 'border-brand bg-brand'
                                : 'border-line bg-surface'
                            }`}
                            style={compressEnabled ? { color: 'var(--muxaro-btn-fg)' } : undefined}
                          >
                            {compressEnabled && <Check className="w-2.5 h-2.5" />}
                          </span>

                          <Minimize2 aria-hidden="true" className="w-4 h-4 text-brand-blue flex-shrink-0" />
                          <span className="font-semibold text-sm text-content">
                            Smaller file (Compress)
                          </span>
                        </button>
                        <span className="text-xs text-content-secondary">
                          Shrink size for messaging and email
                        </span>
                      </div>

                      {compressEnabled && (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {(['720p', '480p'] as CompressTarget[]).map((target) => (
                            <button
                              key={target}
                              type="button"
                              onClick={() => setCompressTarget(target)}
                              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:opacity-90 ${
                                compressTarget === target
                                  ? 'border-brand bg-info-bg text-brand'
                                  : 'border-line bg-surface text-content-secondary hover:text-content'
                              }`}
                            >
                              {target === '720p' ? 'Small (720p)' : 'Extra small (480p)'}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Primary Video Action */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setMoreOptionsOpen(!moreOptionsOpen)}
                    aria-expanded={moreOptionsOpen}
                    aria-controls="more-quality-options"
                    className="inline-flex items-center gap-2 text-xs font-medium text-content-secondary hover:text-content transition-colors whitespace-nowrap rounded-lg px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:opacity-80"
                  >
                    <SlidersHorizontal aria-hidden="true" className="w-3.5 h-3.5" />
                    <span>More quality options</span>
                    <ChevronDown
                      aria-hidden="true"
                      className={`w-3.5 h-3.5 motion-safe:transition-transform motion-safe:duration-200 motion-reduce:transition-none ${
                        moreOptionsOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  <button
                    type="button"
                    disabled={submitting || (!compressEnabled && !selectedVideo)}
                    onClick={handleStartVideoJob}
                    className="muxaro-btn-primary inline-flex items-center justify-center gap-2 px-6 py-2.5 text-sm whitespace-nowrap disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:opacity-90"
                  >
                    {compressEnabled ? (
                      <Minimize2 aria-hidden="true" className="w-4 h-4" />
                    ) : (
                      <Download aria-hidden="true" className="w-4 h-4" />
                    )}
                    <span>{primaryVideoCtaLabel}</span>
                  </button>
                </div>

                {/* Collapsed-by-default "More quality options" Drawer */}
                {moreOptionsOpen && (
                  <div
                    id="more-quality-options"
                    className="p-4 rounded-xl bg-surface-elevated border border-line space-y-4 text-xs"
                  >
                    {/* Output Container */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="font-semibold text-content">Container format</span>
                      <div className="flex items-center gap-1.5">
                        {(['mp4', 'mkv', 'webm'] as VideoContainer[]).map((fmt) => (
                          <button
                            key={fmt}
                            type="button"
                            onClick={() => setTargetContainer(fmt)}
                            className={`px-3 py-1 rounded-md font-medium border transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:opacity-90 ${
                              targetContainer === fmt
                                ? 'border-brand bg-info-bg text-brand'
                                : 'border-line bg-surface text-content-secondary hover:text-content'
                            }`}
                          >
                            {fmt.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Selected Stream Technical Summary */}
                    {selectedVideo && !compressEnabled && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-line">
                        <div>
                          <span className="text-content-muted block">Codec</span>
                          <span className="text-content font-mono">{selectedVideo.codec}</span>
                        </div>
                        <div>
                          <span className="text-content-muted block">Frame rate</span>
                          <span className="text-content font-mono">
                            {selectedVideo.stream?.fps || selectedVideo.stream?.frameRate
                              ? `${selectedVideo.stream.fps || selectedVideo.stream.frameRate} fps`
                              : 'Standard'}
                          </span>
                        </div>
                        <div>
                          <span className="text-content-muted block">Dynamic range</span>
                          <span className="text-content font-medium">
                            {selectedVideo.hdr ? 'HDR' : 'SDR'}
                          </span>
                        </div>
                        <div>
                          <span className="text-content-muted block">Dimensions</span>
                          <span className="text-content font-mono">
                            {selectedVideo.width && selectedVideo.height
                              ? `${selectedVideo.width}x${selectedVideo.height}`
                              : selectedVideo.resolutionLabel}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Separate Audio Track Selector (ONLY when >1 audio track exists) */}
                    {audioTracks.length > 1 && (
                      <div className="pt-3 border-t border-line flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-content">Audio track</span>
                        <div className="flex flex-wrap gap-1.5">
                          {audioTracks.map((track) => (
                            <button
                              key={track.id}
                              type="button"
                              onClick={() => setSelectedAudioTrackId(track.id)}
                              className={`px-2.5 py-1 rounded-md font-medium border transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:opacity-90 ${
                                selectedAudioTrack?.id === track.id
                                  ? 'border-brand bg-info-bg text-brand'
                                  : 'border-line bg-surface text-content-secondary hover:text-content'
                              }`}
                            >
                              {track.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* MODE 2: AUDIO */}
        {mode === 'audio' && (
          <div id="panel-audio" role="tabpanel" aria-labelledby="tab-audio" className="space-y-4">
            <p className="text-sm text-content-secondary">
              Choose an audio format to save the soundtrack.
            </p>

            {/* Show source audio track selector ONLY when >1 audio track exists */}
            {audioTracks.length > 1 && (
              <div className="p-3 rounded-xl bg-surface-elevated border border-line flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-content">Source audio track</span>
                <div className="flex flex-wrap gap-1.5">
                  {audioTracks.map((track) => (
                    <button
                      key={track.id}
                      type="button"
                      onClick={() => setSelectedAudioTrackId(track.id)}
                      className={`px-2.5 py-1 rounded-md font-medium border transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:opacity-90 ${
                        selectedAudioTrack?.id === track.id
                          ? 'border-brand bg-info-bg text-brand'
                          : 'border-line bg-surface text-content-secondary hover:text-content'
                      }`}
                    >
                      {track.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Audio Format Grid */}
            <div
              role="radiogroup"
              aria-label="Audio output format"
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5"
            >
              {AUDIO_FORMATS.map((fmt) => {
                const isSelected = selectedAudioFormat === fmt.id;
                return (
                  <button
                    key={fmt.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelectedAudioFormat(fmt.id)}
                    className={`p-3.5 rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:opacity-90 ${
                      isSelected
                        ? 'border-brand bg-surface-elevated shadow-subtle'
                        : 'border-line bg-surface hover:border-brand'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-semibold text-sm text-content">{fmt.label}</span>
                      {fmt.badge && (
                        <span className="px-2 py-0.5 rounded-full bg-info-bg text-brand text-xs font-medium">
                          {fmt.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-content-secondary leading-relaxed">
                      {fmt.description}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Radical Honesty Disclosure for Lossy -> Lossless conversion */}
            {showLossyDisclosure && (
              <div className="p-3 rounded-xl bg-surface-elevated border border-line text-xs text-content-secondary flex items-start gap-2">
                <Info aria-hidden="true" className="w-4 h-4 text-brand flex-shrink-0 mt-0.5" />
                <span>
                  The source audio is compressed. Saving as {selectedAudioFormat.toUpperCase()} avoids extra compression loss, but cannot restore detail already removed from the original recording.
                </span>
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="button"
                disabled={submitting}
                onClick={handleStartAudioJob}
                className="muxaro-btn-primary inline-flex items-center justify-center gap-2 px-6 py-2.5 text-sm whitespace-nowrap disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:opacity-90"
              >
                <Download aria-hidden="true" className="w-4 h-4" />
                <span>{primaryAudioCtaLabel}</span>
              </button>
            </div>
          </div>
        )}

        {/* MODE 3: MERGE */}
        {mode === 'merge' && (
          <div id="panel-merge" role="tabpanel" aria-labelledby="tab-merge" className="space-y-4">
            <p className="text-sm text-content-secondary">
              Combine your chosen video quality with an included or separate audio track into one MP4 file.
            </p>

            {videoOptions.length === 0 ? (
              <div className="p-6 text-center rounded-xl bg-surface-elevated border border-line text-content-secondary text-sm">
                Merge requires a video stream. Upload or paste a video first.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Video Quality Picker */}
                  <div className="p-4 rounded-xl bg-surface-elevated border border-line space-y-2.5">
                    <div className="text-xs font-semibold text-content flex items-center gap-2">
                      <Film aria-hidden="true" className="w-4 h-4 text-brand" />
                      <span>1. Video quality</span>
                    </div>

                    <div className="space-y-1.5">
                      {videoOptions.map((option) => {
                        const isSelected = selectedVideo?.id === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => handleSelectVideoOption(option)}
                            className={`w-full px-3 py-2 rounded-lg text-left text-xs border transition-colors flex items-center justify-between gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:opacity-90 ${
                              isSelected
                                ? 'border-brand bg-surface text-content font-semibold shadow-subtle'
                                : 'border-line bg-surface text-content-secondary hover:text-content'
                            }`}
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="truncate">
                                {option.resolutionLabel} {option.qualityName}
                              </span>
                              {option.fpsBadge && (
                                <span className="text-content-muted">{option.fpsBadge}</span>
                              )}
                            </span>
                            {isSelected && (
                              <Check aria-hidden="true" className="w-3.5 h-3.5 text-brand flex-shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Audio Source Picker */}
                  <div className="p-4 rounded-xl bg-surface-elevated border border-line space-y-3">
                    <div className="text-xs font-semibold text-content flex items-center gap-2">
                      <Music aria-hidden="true" className="w-4 h-4 text-brand-blue" />
                      <span>2. Audio track</span>
                    </div>

                    {audioTracks.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setMergeAudioSource('included')}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:opacity-90 ${
                            mergeAudioSource === 'included'
                              ? 'border-brand bg-info-bg text-brand'
                              : 'border-line bg-surface text-content-secondary hover:text-content'
                          }`}
                        >
                          Included audio
                        </button>
                        <button
                          type="button"
                          onClick={() => setMergeAudioSource('separate')}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:opacity-90 ${
                            mergeAudioSource === 'separate'
                              ? 'border-brand bg-info-bg text-brand'
                              : 'border-line bg-surface text-content-secondary hover:text-content'
                          }`}
                        >
                          Separate audio file
                        </button>
                      </div>
                    )}

                    {mergeAudioSource === 'included' && audioTracks.length > 0 ? (
                      <div className="space-y-1.5">
                        {audioTracks.map((track) => {
                          const isSelected = selectedAudioTrack?.id === track.id;
                          return (
                            <button
                              key={track.id}
                              type="button"
                              onClick={() => setSelectedAudioTrackId(track.id)}
                              className={`w-full px-3 py-2 rounded-lg text-left text-xs border transition-colors flex items-center justify-between gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:opacity-90 ${
                                isSelected
                                  ? 'border-brand bg-surface text-content font-semibold shadow-subtle'
                                  : 'border-line bg-surface text-content-secondary hover:text-content'
                              }`}
                            >
                              <span className="truncate">{track.label}</span>
                              {isSelected && (
                                <Check aria-hidden="true" className="w-3.5 h-3.5 text-brand flex-shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        <label className="block">
                          <span className="sr-only">Paste audio URL</span>
                          <input
                            type="url"
                            value={separateAudioUrl}
                            onChange={(e) => {
                              setSeparateAudioUrl(e.target.value);
                              setSeparateAudioAssetId(null);
                              setSeparateAudioName(null);
                            }}
                            placeholder="Paste an audio link..."
                            className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-xs text-content placeholder:text-content-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                          />
                        </label>

                        <div className="flex flex-wrap items-center gap-2">
                          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line bg-surface text-xs font-medium text-content hover:border-brand transition-colors cursor-pointer whitespace-nowrap">
                            <Upload aria-hidden="true" className="w-3.5 h-3.5 text-brand" />
                            <span>{uploadingAudio ? 'Uploading...' : 'Choose audio file'}</span>
                            <input
                              type="file"
                              accept="audio/*"
                              disabled={uploadingAudio}
                              className="sr-only"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  handleUploadSeparateAudio(file);
                                }
                                e.target.value = '';
                              }}
                            />
                          </label>

                          {separateAudioName && (
                            <span className="text-xs text-success font-medium truncate">
                              {separateAudioName}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    disabled={submitting || uploadingAudio || !selectedVideo}
                    onClick={handleStartMergeJob}
                    className="muxaro-btn-primary inline-flex items-center justify-center gap-2 px-6 py-2.5 text-sm whitespace-nowrap disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:opacity-90"
                  >
                    <Layers aria-hidden="true" className="w-4 h-4" />
                    <span>{primaryMergeCtaLabel}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
