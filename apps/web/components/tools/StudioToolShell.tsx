'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowRight,
  UploadCloud,
  Link2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  Zap,
  AlertTriangle,
} from 'lucide-react';
import { api, extractDisplayError } from '@/lib/api-client';
import { ProcessingJob } from '@/lib/types';
import { formatBytes } from '@/lib/formatters';
import { ResumableMultipartUploader, MultipartUploadStats } from '@/lib/multipart-uploader';
import { normalizeMediaUrl } from '@/lib/url-utils';
import {
  TIER1_MAX_BYTES,
  runLocalStudioJobFallback,
  type LocalProcessResult,
} from '@/lib/tier1-local';
import { getNativeDesktopFilePath, isCapacitorApp, isDesktopApp, isNativeAppRuntime, saveOrShareArtifact } from '@/lib/native-bridge';
import GoogleDriveModal from '@/components/native/GoogleDriveModal';
import { useOpenedArtifact, type OpenedArtifact } from '@/lib/opened-artifact';
import TurnstileChallenge from '@/components/TurnstileChallenge';
import CommandPreviewDrawer from './CommandPreviewDrawer';
import UnifiedToolWorkspace from '@/components/studio/UnifiedToolWorkspace';
import WorkspaceResultCard from '@/components/studio/WorkspaceResultCard';

const LOCAL_VIDEO_CHAIN_TARGETS = [
  { href: '/tools/video-trimmer', label: 'Trim / 60s split' },
  { href: '/tools/video-compressor', label: 'Compress (10/16 MB)' },
  { href: '/tools/media-converter', label: 'Convert format' },
  { href: '/tools/audio-extractor', label: 'Extract audio' },
  { href: '/tools/audio-normalizer', label: 'Normalize loudness' },
  { href: '/tools/audio-video-merger', label: 'Merge A/V tracks' },
  { href: '/tools/aspect-ratio-pad', label: 'Reframe 9:16' },
  { href: '/tools/metadata-scrubber', label: 'Scrub metadata' },
];

const JobProgress = dynamic(() => import('@/components/JobProgress'), {
  ssr: false,
  loading: () => (
    <div className="muxaro-card p-6 text-sm text-content-secondary">
      Loading job progress…
    </div>
  ),
});

export interface ProbedLocalMedia {
  name: string;
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  hasVideo: boolean;
  mimeType: string;
}

export interface StudioSourcePayload {
  sourceUrl?: string;
  mediaUrl?: string;
  mediaAssetId?: string;
  sourceJobId?: string;
  title?: string;
  captchaToken: string;
}

interface StudioToolShellProps {
  title: string;
  description: string;
  badgeText?: string;
  executionMode: 'cloud' | 'hybrid';
  executionNote?: string;
  accept?: string;
  submitLabel: string;
  previewCommand: string;
  instantCommandBadge?: boolean;
  canSubmit?: boolean;
  requiresVideo?: boolean;
  localRunner?: (
    file: File | null,
    onProgress: (pct: number) => void,
    signal: AbortSignal
  ) => Promise<LocalProcessResult | null>;
  localOnlyWithoutFile?: boolean;
  onMediaLoaded?: (info: ProbedLocalMedia | null) => void;
  onBuildJobParams: (source: StudioSourcePayload) => Record<string, unknown>;
  children: React.ReactNode;
}

/**
 * Unified Hybrid Engine Shell for MUXARO Studio Creator Tools backed by UnifiedToolWorkspace:
 * - Tier-1 Local Instant (<= 350 MB / Pure JS): Zero credits, zero CAPTCHA, zero upload wait
 * - Tier-2 Cloud FFmpeg 8: Multi-core heavy encodes, URL inputs, >350 MB, and WASM fallback
 * - Persistent Session File Shelf + Smart Mis-Drop Interception
 */
export default function StudioToolShell({
  title,
  description,
  badgeText,
  executionMode,
  executionNote,
  accept = 'video/*,audio/*,.mkv,.mov,.webm,.avi,.flv,.flac,.wav,.mp3,.m4a',
  submitLabel,
  previewCommand,
  instantCommandBadge = false,
  canSubmit = true,
  requiresVideo = false,
  localRunner,
  localOnlyWithoutFile = false,
  onMediaLoaded,
  onBuildJobParams,
  children,
}: StudioToolShellProps) {
  const [inputMode, setInputMode] = useState<'url' | 'file' | 'chain'>('file');
  const [urlInput, setUrlInput] = useState('');
  const [chainedJobId, setChainedJobId] = useState('');
  const [chainedTitle, setChainedTitle] = useState('');

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [localInputPath, setLocalInputPath] = useState<string | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [videoPosterUrl, setVideoPosterUrl] = useState<string | null>(null);
  const [probedInfo, setProbedInfo] = useState<ProbedLocalMedia | null>(null);
  const [uploadedAssetId, setUploadedAssetId] = useState<string | null>(null);
  const [uploader, setUploader] = useState<ResumableMultipartUploader | null>(null);
  const [uploadStats, setUploadStats] = useState<MultipartUploadStats | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const [localProgressPct, setLocalProgressPct] = useState<number | null>(null);
  const [localResult, setLocalResult] = useState<LocalProcessResult | null>(null);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const localAbortRef = useRef<AbortController | null>(null);

  const [isNativeApp, setIsNativeApp] = useState(false);
  const [isDesktopExe, setIsDesktopExe] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');

  useEffect(() => {
    if (isNativeAppRuntime()) {
      setIsNativeApp(true);
      setIsDesktopExe(isDesktopApp());
      setCaptchaToken('native-local-verified');
    }
  }, []);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<ProcessingJob | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { artifact, setArtifactFromBlob, setArtifactFromFile } = useOpenedArtifact();
  const handoffConsumedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
      if (localResult?.url) URL.revokeObjectURL(localResult.url);
      localAbortRef.current?.abort();
    };
  }, [filePreviewUrl, localResult?.url]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const sJob = (sp.get('sourceJobId') || sp.get('jobId') || '').trim();
    const sUrl = (sp.get('url') || '').trim();
    const sTitle = (sp.get('title') || '').trim();
    const isHandoff = sp.get('handoff') === '1';
    if (sJob) {
      setChainedJobId(sJob);
      setChainedTitle(sTitle);
      setInputMode('chain');
    } else if (sUrl) {
      setUrlInput(sUrl);
      setInputMode('url');
    } else if (
      isHandoff &&
      !handoffConsumedRef.current &&
      artifact?.file &&
      (artifact.domain === 'video' || artifact.domain === 'audio')
    ) {
      handoffConsumedRef.current = true;
      setInputMode('file');
      void handleFileSelect(artifact.file, false);
    }
  }, [artifact]); // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveLocalRunner =
    localRunner ??
    (isNativeApp && isCapacitorApp() && !localOnlyWithoutFile
      ? async (
          file: File | null,
          onProg: (pct: number) => void,
          sig: AbortSignal
        ) => {
          if (!file) return null;
          return runLocalStudioJobFallback(
            file,
            onBuildJobParams({ captchaToken: 'local-device' }),
            onProg,
            sig
          );
        }
      : undefined);

  // On Desktop EXE, prefer native multi-core ffmpeg.exe over slow single-threaded WASM
  // except for 0ms pure-JS tools (localOnlyWithoutFile like subtitle shifter).
  const qualifiesForTier1 =
    Boolean(effectiveLocalRunner) &&
    ((localOnlyWithoutFile && inputMode !== 'url') ||
      (!isDesktopExe &&
        inputMode === 'file' &&
        Boolean(selectedFile) &&
        (selectedFile?.size ?? 0) <= TIER1_MAX_BYTES));

  const startCloudUpload = async (file: File): Promise<string | null> => {
    setIsUploading(true);
    const mp = new ResumableMultipartUploader(file, {
      onProgress: (stats) => setUploadStats(stats),
      onError: (err) => {
        setIsUploading(false);
        setErrorMessage(err.message || 'Upload failed.');
      },
    });
    setUploader(mp);
    try {
      const manifest = (await mp.start()) as unknown as Record<string, unknown>;
      setIsUploading(false);
      const id =
        (manifest?.uploadSessionId as string) ||
        (manifest?.mediaAssetId as string) ||
        (manifest?.assetId as string) ||
        (manifest?.uploadId as string) ||
        (manifest?.id as string);
      if (!id) {
        setErrorMessage('Upload finished without an asset session ID.');
        return null;
      }
      setUploadedAssetId(id);
      return id;
    } catch (err: unknown) {
      setIsUploading(false);
      setErrorMessage(err instanceof Error ? err.message : 'Upload failed.');
      return null;
    }
  };

  const handleFileSelect = async (file: File | null | undefined, recordSession = true) => {
    if (!file) return;
    setErrorMessage(null);
    setLocalNotice(null);
    setSelectedFile(null);
    setLocalInputPath(null);
    setUploadedAssetId(null);
    setVideoPosterUrl(null);

    try {
      const headText = (await file.slice(0, 256).text()).trimStart().toLowerCase();
      if (headText.startsWith('<!doctype') || headText.startsWith('<html')) {
        setErrorMessage(
          `"${file.name}" is an HTML web page saved with a media extension (${Math.round(file.size / 1024)} KB), not a valid video or audio file.`
        );
        return;
      }
    } catch {}

    if (filePreviewUrl) {
      URL.revokeObjectURL(filePreviewUrl);
      setFilePreviewUrl(null);
    }
    setProbedInfo(null);
    onMediaLoaded?.(null);

    const objUrl = URL.createObjectURL(file);
    setFilePreviewUrl(objUrl);

    const isLikelyAudio =
      file.type.startsWith('audio/') ||
      /\.(mp3|flac|wav|m4a|aac|ogg|opus)$/i.test(file.name);

    if (recordSession) {
      setArtifactFromFile(file, isLikelyAudio ? 'audio' : 'video', pathname);
    }

    const probeEl = document.createElement(isLikelyAudio ? 'audio' : 'video');
    probeEl.preload = 'metadata';
    probeEl.onloadedmetadata = () => {
      const vw = probeEl instanceof HTMLVideoElement ? probeEl.videoWidth || 0 : 0;
      const vh = probeEl instanceof HTMLVideoElement ? probeEl.videoHeight || 0 : 0;
      const info: ProbedLocalMedia = {
        name: file.name,
        sizeBytes: file.size,
        durationSec: Number.isFinite(probeEl.duration) ? probeEl.duration : 0,
        width: vw,
        height: vh,
        hasVideo: !isLikelyAudio && (vw > 0 || file.type.startsWith('video/')),
        mimeType: file.type || 'application/octet-stream',
      };
      setProbedInfo(info);
      onMediaLoaded?.(info);
      if (probeEl instanceof HTMLVideoElement && vw > 0 && vh > 0) {
        try {
          probeEl.currentTime = Math.min(0.25, info.durationSec * 0.1);
          probeEl.onseeked = () => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = Math.min(320, vw);
              canvas.height = Math.max(1, Math.round((canvas.width / vw) * vh));
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(probeEl, 0, 0, canvas.width, canvas.height);
                setVideoPosterUrl(canvas.toDataURL('image/jpeg', 0.72));
              }
            } catch {}
          };
        } catch {}
      }
    };
    probeEl.src = objUrl;

    setSelectedFile(file);

    // Zero-Copy OS File Path on Desktop EXE: skips slow RAM/temp chunking for 4K/8K/12K files
    const nativePath = isDesktopApp() ? getNativeDesktopFilePath(file) : '';
    if (nativePath) {
      setLocalInputPath(nativePath);
      try {
        const probeResp = await fetch('/api/v1/native/probe-local', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ localInputPath: nativePath }),
        });
        if (probeResp.ok) {
          const parsed = await probeResp.json();
          const pData = parsed?.data;
          if (pData) {
            const info: ProbedLocalMedia = {
              name: file.name,
              sizeBytes: pData.sizeBytes || file.size,
              durationSec: Number(pData.durationSec || 0),
              width: Number(pData.width || 0),
              height: Number(pData.height || 0),
              hasVideo: !isLikelyAudio && Number(pData.width || 0) > 0,
              mimeType: file.type || 'application/octet-stream',
            };
            setProbedInfo(info);
            onMediaLoaded?.(info);
            if (pData.needsProxy) {
              setLocalNotice(`Generating smooth 720p preview proxy for ${pData.width}x${pData.height} clip (exports use full original quality).`);
              setFilePreviewUrl(`/api/v1/native/media-proxy?path=${encodeURIComponent(nativePath)}`);
            }
          }
        }
      } catch {
        // Non-fatal; regular job path still runs cleanly
      }
      return;
    }

    const isTier1 = Boolean(effectiveLocalRunner) && file.size <= TIER1_MAX_BYTES;
    if (!isTier1) {
      await startCloudUpload(file);
    }
  };

  const handleSelectSessionArtifact = (item: OpenedArtifact) => {
    setInputMode('file');
    void handleFileSelect(item.file, false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setLocalNotice(null);

    if (qualifiesForTier1 && effectiveLocalRunner) {
      setSubmitting(true);
      setLocalProgressPct(5);
      const ctrl = new AbortController();
      localAbortRef.current = ctrl;
      try {
        const res = await effectiveLocalRunner(selectedFile, (pct) => setLocalProgressPct(pct), ctrl.signal);
        if (res) {
          setLocalResult(res);
          setSubmitting(false);
          setLocalProgressPct(null);
          return;
        }
      } catch (localErr: unknown) {
        if ((localErr as Error)?.name === 'AbortError') {
          setSubmitting(false);
          setLocalProgressPct(null);
          return;
        }
        setLocalNotice('Switched to Cloud FFmpeg 8 worker for full compatibility.');
      } finally {
        localAbortRef.current = null;
      }
      setLocalProgressPct(null);
      if (localOnlyWithoutFile && !selectedFile) {
        setSubmitting(false);
        return;
      }
    }

    const effectiveToken = captchaToken || (isNativeAppRuntime() ? 'native-local-verified' : '');
    if (!effectiveToken) {
      setSubmitting(false);
      setErrorMessage('Please complete the verification check below before starting a Cloud job.');
      return;
    }

    const sourcePayload: StudioSourcePayload = { captchaToken: effectiveToken };

    if (inputMode === 'chain') {
      if (!chainedJobId.trim()) {
        setSubmitting(false);
        setErrorMessage('Missing chained job ID. Upload a file or paste a URL instead.');
        return;
      }
      sourcePayload.sourceJobId = chainedJobId.trim();
      sourcePayload.title = chainedTitle || undefined;
    } else if (inputMode === 'url') {
      const normalized = normalizeMediaUrl(urlInput);
      if (!normalized) {
        setSubmitting(false);
        setErrorMessage('Please paste a valid HTTP or HTTPS media URL.');
        return;
      }
      sourcePayload.sourceUrl = normalized;
      sourcePayload.mediaUrl = normalized;
    } else if (localInputPath) {
      sourcePayload.title = selectedFile?.name;
    } else {
      let assetId = uploadedAssetId;
      if (!assetId && selectedFile) {
        assetId = await startCloudUpload(selectedFile);
      }
      if (!assetId) {
        setSubmitting(false);
        return;
      }
      sourcePayload.mediaAssetId = assetId;
      sourcePayload.title = selectedFile?.name;
    }

    setSubmitting(true);
    try {
      const extraParams = onBuildJobParams(sourcePayload);
      const job = await api.createJob({
        targetFormat: 'mp4',
        ...(localInputPath ? { localInputPath } : {}),
        ...sourcePayload,
        ...extraParams,
        captchaToken: captchaToken || undefined,
      });
      setActiveJob(job);
    } catch (err: unknown) {
      setErrorMessage(extractDisplayError(err, 'Could not start processing job.'));
    } finally {
      setSubmitting(false);
    }
  };

  const misDropAudioOnVideoTool =
    requiresVideo && inputMode === 'file' && Boolean(probedInfo) && !probedInfo?.hasVideo;

  const hasValidInput = localOnlyWithoutFile
    ? canSubmit
    : inputMode === 'chain'
    ? Boolean(chainedJobId.trim())
    : inputMode === 'url'
    ? Boolean(urlInput.trim())
    : qualifiesForTier1
    ? Boolean(selectedFile)
    : Boolean(uploadedAssetId);

  const needsCaptcha = !qualifiesForTier1 && !isNativeApp;

  const statusLabel = isNativeApp
    ? 'On-Device Local Engine'
    : qualifiesForTier1
    ? 'Browser Local, Instant'
    : executionNote ||
      (executionMode === 'hybrid'
        ? 'Hybrid: Local <= 350 MB / Cloud FFmpeg 8'
        : 'Cloud FFmpeg 8 (60m auto-delete)');

  const statusTone = isNativeApp || qualifiesForTier1
    ? 'local'
    : executionMode === 'hybrid'
    ? 'hybrid'
    : 'cloud';

  const durationText =
    probedInfo?.durationSec
      ? `${Math.floor(probedInfo.durationSec / 60)}:${String(Math.floor(probedInfo.durationSec % 60)).padStart(2, '0')}`
      : '';
  const dimsText =
    probedInfo?.width && probedInfo?.height
      ? `${probedInfo.width}x${probedInfo.height}`
      : probedInfo && !probedInfo.hasVideo
      ? 'Audio Track'
      : '';

  return (
    <UnifiedToolWorkspace
      suite="video"
      currentHref={pathname}
      title={title}
      description={description}
      backHref="/tools?section=video"
      backLabel="All Studio Tools"
      badgeText={badgeText}
      statusLabel={statusLabel}
      statusTone={statusTone}
      activeLoadedNames={selectedFile ? [selectedFile.name] : []}
      onSelectSessionArtifact={handleSelectSessionArtifact}
    >
      {localResult ? (
        <WorkspaceResultCard
          fileName={localResult.filename}
          sizeBytes={localResult.sizeBytes}
          statusLabel="Browser Local, 0 bytes uploaded"
          editableName={false}
          onDownload={() => {
            if (isNativeAppRuntime()) {
              void saveOrShareArtifact(localResult.blob, localResult.filename, localResult.filename);
              return;
            }
            const a = document.createElement('a');
            a.href = localResult.url;
            a.download = localResult.filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
          }}
          onReset={() => {
            if (localResult.url) URL.revokeObjectURL(localResult.url);
            setLocalResult(null);
          }}
          resetLabel="Process another"
          chainHeading="Continue in another video tool"
          chainSublabel="Zero re-upload, passes local output directly"
          chainTargets={LOCAL_VIDEO_CHAIN_TARGETS.filter((t) => t.href !== pathname)}
          onChainTo={(targetHref) => {
            const domain = localResult.mimeType.startsWith('audio/') ? 'audio' : 'video';
            setArtifactFromBlob(localResult.blob, localResult.filename, domain, pathname);
            router.push(`${targetHref}?handoff=1`);
          }}
          extraContent={
            <div className="pt-2">
              <CommandPreviewDrawer command={localResult.command} />
            </div>
          }
        />
      ) : !activeJob ? (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Source Selector Card */}
          <div className="muxaro-card p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-semibold text-content">Input source</span>
              <div className="inline-flex rounded-xl border border-line bg-surface-elevated p-1 gap-1">
                {chainedJobId && (
                  <button
                    type="button"
                    onClick={() => setInputMode('chain')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                      inputMode === 'chain'
                        ? 'bg-content text-base'
                        : 'text-content-secondary hover:text-content'
                    }`}
                  >
                    Chained output
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setInputMode('file')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                    inputMode === 'file'
                      ? 'bg-content text-base'
                      : 'text-content-secondary hover:text-content'
                  }`}
                >
                  <UploadCloud className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Upload file</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('url')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                    inputMode === 'url'
                      ? 'bg-content text-base'
                      : 'text-content-secondary hover:text-content'
                  }`}
                >
                  <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Paste URL</span>
                </button>
              </div>
            </div>

            {inputMode === 'chain' && chainedJobId && (
              <div className="p-3.5 rounded-xl border border-success/30 bg-success-bg flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-success shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="font-semibold text-content truncate">
                      Chained from {chainedTitle || `job ${chainedJobId}`}
                    </p>
                    <p className="text-content-secondary">
                      Piped directly on server: zero download or re-upload needed.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setInputMode('file')}
                  className="text-xs font-medium text-content-secondary hover:text-content underline shrink-0 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded"
                >
                  Switch source
                </button>
              </div>
            )}

            {inputMode === 'file' && (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={accept}
                  onChange={(e) => handleFileSelect(e.target.files?.[0])}
                  className="hidden"
                />
                {!selectedFile ? (
                  <div className="space-y-2.5">
                    <button
                      type="button"
                      data-dropzone="true"
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleFileSelect(e.dataTransfer.files?.[0]);
                      }}
                      className="w-full py-8 px-4 rounded-xl border border-dashed border-line bg-surface-elevated/50 hover:bg-surface-elevated hover:border-line-hover transition-colors flex flex-col items-center justify-center gap-2 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      <UploadCloud className="w-7 h-7 text-content-secondary" aria-hidden="true" />
                      <span className="text-sm font-semibold text-content whitespace-nowrap">
                        Drop or select media
                      </span>
                      <span className="text-xs text-content-secondary">
                        {isNativeApp
                          ? 'Processed locally on your device via bundled FFmpeg engine.'
                          : localRunner
                          ? 'Files up to 350 MB run locally when supported; larger files stream via Cloud (60m auto-delete).'
                          : 'Resumable chunked upload, auto-deleted after 60 minutes.'}
                      </span>
                    </button>
                    {isNativeApp && (
                      <div className="flex justify-end">
                        <DriveQuickButton onImported={(file) => void handleFileSelect(file)} />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="p-3.5 rounded-xl border border-line bg-surface-elevated flex items-center justify-between gap-3">
                      <div className="min-w-0 flex items-center gap-2.5">
                        {isUploading ? (
                          <Loader2 className="w-4 h-4 animate-spin text-content shrink-0" aria-hidden="true" />
                        ) : qualifiesForTier1 || uploadedAssetId ? (
                          <CheckCircle2 className="w-4 h-4 text-success shrink-0" aria-hidden="true" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-warning shrink-0" aria-hidden="true" />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-content truncate">
                            {selectedFile.name}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums text-content-secondary mt-0.5">
                            <span>{formatBytes(selectedFile.size)}</span>
                            {durationText && <span>{durationText}</span>}
                            {dimsText && <span>{dimsText}</span>}
                            <span>
                              {isUploading
                                ? `Uploading (${uploadStats?.percent ?? 0}%)…`
                                : qualifiesForTier1
                                ? 'On-device instant mode ready'
                                : uploadedAssetId
                                ? isDesktopExe
                                  ? 'Ready for Native Multi-Core FFmpeg'
                                  : 'Ready for Cloud FFmpeg 8'
                                : 'Preparing…'}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          uploader?.cancel().catch(() => {});
                          if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
                          setFilePreviewUrl(null);
                          setVideoPosterUrl(null);
                          setProbedInfo(null);
                          onMediaLoaded?.(null);
                          setSelectedFile(null);
                          setUploadedAssetId(null);
                          setUploadStats(null);
                          setIsUploading(false);
                        }}
                        className="p-1.5 rounded-lg hover:bg-surface text-content-secondary hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                        aria-label="Remove file"
                      >
                        <X className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>

                    {filePreviewUrl &&
                      (probedInfo && !probedInfo.hasVideo ? (
                        <audio controls preload="metadata" src={filePreviewUrl} className="w-full h-10" />
                      ) : (
                        <video
                          controls
                          preload="metadata"
                          playsInline
                          poster={videoPosterUrl || '/brand/og-image.png'}
                          src={filePreviewUrl}
                          className="w-full max-h-56 rounded-xl bg-base border border-line"
                        />
                      ))}

                    {/* Smart Mis-Drop Interception for audio-only files on video tools */}
                    {misDropAudioOnVideoTool && (
                      <div className="p-4 rounded-xl border border-warning/35 bg-warning-bg space-y-2.5 text-xs">
                        <div className="flex items-start gap-2 text-content">
                          <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" aria-hidden="true" />
                          <div>
                            <p className="font-semibold">
                              Audio-only file detected ({selectedFile.name})
                            </p>
                            <p className="text-content-secondary mt-0.5">
                              This tool requires a video stream. Open an audio workflow instead:
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href="/tools/audio-normalizer"
                            className="px-3 py-1.5 rounded-lg bg-surface border border-line font-semibold text-content hover:border-line-hover whitespace-nowrap"
                          >
                            Normalize Loudness (-14 LUFS)
                          </Link>
                          <Link
                            href="/tools/video-compressor"
                            className="px-3 py-1.5 rounded-lg bg-surface border border-line font-semibold text-content hover:border-line-hover whitespace-nowrap"
                          >
                            Compress Audio to Target MB
                          </Link>
                          <Link
                            href="/tools/media-converter"
                            className="px-3 py-1.5 rounded-lg bg-surface border border-line font-semibold text-content hover:border-line-hover whitespace-nowrap"
                          >
                            Audio Format Converter
                          </Link>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {inputMode === 'url' && (
              <div>
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://youtube.com/watch?v=... or direct .mp4 / .mp3 link"
                  className="w-full px-4 py-3 rounded-xl border border-line bg-surface-elevated text-sm text-content placeholder:text-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                />
              </div>
            )}
          </div>

          {/* Tool-Specific Controls */}
          <div className="muxaro-card p-5 sm:p-6 space-y-5">
            {children}
          </div>

          <CommandPreviewDrawer
            command={previewCommand}
            instantBadge={instantCommandBadge}
          />

          {needsCaptcha ? (
            <TurnstileChallenge
              onVerify={(tok) => {
                setCaptchaToken(tok);
                setErrorMessage((prev) =>
                  prev && /verification|captcha/i.test(prev) ? null : prev
                );
              }}
              onReset={() => setCaptchaToken('')}
            />
          ) : qualifiesForTier1 ? (
            <div className="p-3.5 rounded-xl border border-success/25 bg-success-bg text-xs text-content-secondary flex items-center gap-2">
              <Zap className="w-4 h-4 text-success shrink-0" aria-hidden="true" />
              <span>
                Running locally in your browser with zero server upload.
              </span>
            </div>
          ) : null}

          {localNotice && (
            <div className="p-3 rounded-xl border border-line bg-surface-elevated text-xs text-content-secondary">
              {localNotice}
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="p-4 rounded-xl bg-error-bg border border-error/30 text-error text-xs font-medium flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          )}

          {localProgressPct !== null && (
            <div className="p-4 rounded-xl border border-line bg-surface-elevated space-y-2">
              <div className="flex justify-between text-xs font-mono text-content">
                <span>Processing locally in WebAssembly…</span>
                <span className="tabular-nums">{localProgressPct}%</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-base overflow-hidden">
                <div
                  className="h-full bg-brand transition-transform duration-150 origin-left"
                  style={{ transform: `scaleX(${Math.max(0.05, Math.min(1, localProgressPct / 100))})` }}
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={
              submitting ||
              isUploading ||
              !hasValidInput ||
              !canSubmit ||
              misDropAudioOnVideoTool ||
              (needsCaptcha && !captchaToken)
            }
            className="w-full py-3.5 px-6 rounded-xl bg-brand hover:bg-brand-hover text-brand-fg font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>
                  {qualifiesForTier1
                    ? isNativeApp
                      ? 'Running locally on device…'
                      : 'Running locally in browser…'
                    : isDesktopExe
                    ? 'Running Native Multi-Core FFmpeg…'
                    : 'Starting Cloud FFmpeg 8…'}
                </span>
              </>
            ) : (
              <>
                <span>{submitLabel}</span>
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </>
            )}
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          <JobProgress
            initialJob={activeJob}
            sourceUrl={activeJob.sourceUrl}
            onDismiss={() => {
              setActiveJob(null);
              setErrorMessage(null);
            }}
          />
        </div>
      )}
    </UnifiedToolWorkspace>
  );
}

function DriveQuickButton({ onImported }: { onImported: (file: File) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3.5 py-2 rounded-xl border border-brand/30 bg-brand/10 text-brand text-xs font-semibold hover:bg-brand/15 transition-colors"
      >
        Import from Google Drive
      </button>
      <GoogleDriveModal
        open={open}
        onClose={() => setOpen(false)}
        onImported={onImported}
      />
    </>
  );
}
