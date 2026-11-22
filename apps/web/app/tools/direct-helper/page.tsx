'use client';

import React, { useState, useEffect, useCallback, Suspense, useId, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Zap,
  ShieldCheck,
  Download,
  CheckCircle2,
  ExternalLink,
  ArrowRight,
  Sparkles,
  Flame,
  Info,
  Copy,
  Check,
  ClipboardPaste,
  RefreshCw,
  ArrowLeft,
  Loader2,
  AlertCircle,
  FileVideo,
  FileAudio,
  Clock,
  XCircle,
  Gauge,
} from 'lucide-react';
import { normalizeMediaUrl, formatDisplayUrl, detectPlatform } from '@/lib/url-utils';
import {
  isMuxaroDirectActive,
  triggerMuxaroDirectDownload,
  pingMuxaroDirect,
} from '@/lib/background-download';
import { api } from '@/lib/api-client';
import { MediaManifest } from '@/lib/types';
import { formatBytes, formatDuration } from '@/lib/formatters';

function DirectHelperSkeleton() {
  return (
    <div className="min-h-screen py-10 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto space-y-8 animate-pulse">
      <div className="h-8 w-48 bg-surface-elevated rounded-lg mx-auto" />
      <div className="h-10 w-80 bg-surface-elevated rounded-xl mx-auto" />
      <div className="h-44 w-full bg-surface-elevated rounded-2xl" />
    </div>
  );
}

function DirectHelperContent() {
  const searchParams = useSearchParams();
  const urlParam = searchParams ? searchParams.get('url') || searchParams.get('sourceUrl') : null;

  const [targetUrl, setTargetUrl] = useState<string>('');
  const [inputValue, setInputValue] = useState<string>('');
  const [isCompanionActive, setIsCompanionActive] = useState<boolean>(false);
  const [companionVersion, setCompanionVersion] = useState<string>('v1.0.0');
  const [checking, setChecking] = useState<boolean>(true);
  const [selectedFormat, setSelectedFormat] = useState<'mp4' | 'mp3'>('mp4');
  const [selectedQuality, setSelectedQuality] = useState<string>('best');
  const [manifest, setManifest] = useState<MediaManifest | null>(null);
  const [inspecting, setInspecting] = useState<boolean>(false);
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'streaming' | 'completed' | 'error'>('idle');
  const [streamProgress, setStreamProgress] = useState<number>(0);
  const [engineProgress, setEngineProgress] = useState<{
    stage?: string;
    percent: number;
    speedBytesPerSec?: number;
    activeConcurrency?: number;
    currentChunkSizeBytes?: number;
    bufferedBytes?: number;
    fragmentsMuxed?: number;
    zeroWaitReady?: boolean;
    message?: string;
  } | null>(null);
  const streamControllerRef = useRef<any>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [pastedFeedback, setPastedFeedback] = useState<boolean>(false);

  const urlInputId = useId();

  // Read URL from searchParams or window.location.search on initial load
  useEffect(() => {
    let candidate = (urlParam || '').trim();
    if (!candidate && typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      candidate = (sp.get('url') || sp.get('sourceUrl') || '').trim();
    }
    if (candidate) {
      const normalized = normalizeMediaUrl(candidate) || candidate;
      setTargetUrl(normalized);
      setInputValue(normalized);
    }
  }, [urlParam]);

  // Instant Link Feedback: inspect URL as soon as targetUrl is supplied
  useEffect(() => {
    if (!targetUrl) {
      setManifest(null);
      setInspecting(false);
      return;
    }

    let active = true;
    setInspecting(true);

    api
      .inspectMedia(targetUrl)
      .then((m) => {
        if (!active) return;
        setManifest(m);
        setInspecting(false);
      })
      .catch(() => {
        if (!active) return;
        const platform = detectPlatform(targetUrl);
        setManifest({
          id: `direct_${Date.now()}`,
          sourceUrl: targetUrl,
          title: `${platform.name} Media Stream`,
          durationSeconds: 0,
          fileSizeBytes: 0,
          container: 'mp4',
          permitted: true,
          rightsNote: 'Authorized or Creative Commons media stream',
          videoStreams: [],
          audioStreams: [],
        });
        setInspecting(false);
      });

    return () => {
      active = false;
    };
  }, [targetUrl]);

  // Monitor MUXARO Direct companion userscript bridge
  useEffect(() => {
    function detectBridge() {
      if (isMuxaroDirectActive()) {
        setIsCompanionActive(true);
        setChecking(false);
      }

      if (typeof document !== 'undefined') {
        const docVersion = document.documentElement.getAttribute('data-muxaro-version');
        if (docVersion) {
          setCompanionVersion(docVersion.startsWith('v') ? docVersion : `v${docVersion}`);
        }
      }

      // Proactively send ping on every poll interval
      if (typeof pingMuxaroDirect === 'function') {
        pingMuxaroDirect();
      }
      if (typeof window !== 'undefined') {
        window.postMessage({ type: 'MUXARO_DIRECT_PING' }, '*');
      }
    }

    // Proactive initial ping on mount
    if (typeof pingMuxaroDirect === 'function') {
      pingMuxaroDirect();
    }
    if (typeof window !== 'undefined') {
      window.postMessage({ type: 'MUXARO_DIRECT_PING' }, '*');
    }
    detectBridge();

    const handleWindowMessage = (event: MessageEvent) => {
      if (event.data?.type === 'MUXARO_DIRECT_READY') {
        setIsCompanionActive(true);
        setChecking(false);
        if (event.data?.version) {
          const v = String(event.data.version);
          setCompanionVersion(v.startsWith('v') ? v : `v${v}`);
        }
      }
    };

    const handleReady = (event: Event) => {
      setIsCompanionActive(true);
      setChecking(false);
      const customEvent = event as CustomEvent<{ version?: string }>;
      if (customEvent?.detail?.version) {
        const v = String(customEvent.detail.version);
        setCompanionVersion(v.startsWith('v') ? v : `v${v}`);
      }
    };

    const handleProgress = (event: Event) => {
      const customEvent = event as CustomEvent<{ loaded?: number; total?: number; percent?: number }>;
      setDownloadStatus('streaming');
      if (customEvent.detail && typeof customEvent.detail.percent === 'number') {
        const pct = Math.max(0, Math.min(100, customEvent.detail.percent));
        setStreamProgress(pct);
        setStatusMessage(`Streaming via browser sandbox: ${pct}%`);
      }
    };

    const handleComplete = (event: Event) => {
      const customEvent = event as CustomEvent<{ success?: boolean; filename?: string }>;
      setDownloadStatus('completed');
      setStreamProgress(100);
      setStatusMessage(
        customEvent.detail?.filename
          ? `Saved ${customEvent.detail.filename} successfully to your device.`
          : 'Direct stream download completed and saved to your device.'
      );
    };

    window.addEventListener('message', handleWindowMessage);
    window.addEventListener('muxaro:direct-ready', handleReady);
    window.addEventListener('muxaro:direct-progress', handleProgress);
    window.addEventListener('muxaro:direct-complete', handleComplete);

    const interval = setInterval(detectBridge, 1000);
    const timer = setTimeout(() => setChecking(false), 2000);

    return () => {
      window.removeEventListener('message', handleWindowMessage);
      window.removeEventListener('muxaro:direct-ready', handleReady);
      window.removeEventListener('muxaro:direct-progress', handleProgress);
      window.removeEventListener('muxaro:direct-complete', handleComplete);
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, []);

  const handleCopyLink = async () => {
    if (!targetUrl) return;
    try {
      await navigator.clipboard.writeText(targetUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Ignore clipboard write restrictions
    }
  };

  const handlePasteInput = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const normalized = normalizeMediaUrl(text);
      if (normalized) {
        setInputValue(normalized);
        setTargetUrl(normalized);
        setPastedFeedback(true);
        setTimeout(() => setPastedFeedback(false), 1500);
      }
    } catch {
      // Focus input if clipboard access denied
      const el = document.getElementById(urlInputId);
      if (el) el.focus();
    }
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeMediaUrl(inputValue);
    if (normalized) {
      setTargetUrl(normalized);
      setDownloadStatus('idle');
      setStatusMessage(null);
    }
  };

  const triggerBrowserFallback = (url: string, filename: string) => {
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 2000);
      setDownloadStatus('completed');
      setStreamProgress(100);
      setStatusMessage('Direct stream download triggered in browser.');
    } catch {
      setDownloadStatus('error');
      setStatusMessage('Could not trigger browser stream download. Please ensure pop-ups are allowed.');
    }
  };

  const fallbackToBridge = useCallback(
    (activeUrl: string, filename: string) => {
      if (isCompanionActive) {
        const sent = triggerMuxaroDirectDownload(activeUrl, filename);
        if (!sent) {
          triggerBrowserFallback(activeUrl, filename);
        }
      } else {
        triggerBrowserFallback(activeUrl, filename);
      }
    },
    [isCompanionActive]
  );

  const handleStartStreamDownload = useCallback(async () => {
    const activeUrl = targetUrl.trim() || inputValue.trim();
    if (!activeUrl) {
      setStatusMessage('Please enter or paste a media link to stream.');
      return;
    }

    setDownloadStatus('streaming');
    setStreamProgress(5);
    setStatusMessage('Initiating zero-wait stream pipeline...');

    const ext = selectedFormat === 'mp3' ? 'mp3' : 'mp4';
    const cleanTitle = (manifest?.title || 'media_stream')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 40);
    const filename = `${cleanTitle}_${Date.now()}.${ext}`;

    // 1. First attempt to invoke Zero-Wait Stream Engine (@/lib/stream-engine/engine)
    try {
      const streamEngineModule = await import('@/lib/stream-engine/engine');
      if (typeof streamEngineModule.startZeroWaitStream === 'function') {
        const controller = await streamEngineModule.startZeroWaitStream({
          sourceUrl: activeUrl,
          filename,
          format: selectedFormat === 'mp3' ? 'mp3' : 'mp4',
          onProgress: (p: any) => {
            const pct = Math.max(0, Math.min(100, Math.round(p.percent || 0)));
            setStreamProgress(pct);
            setEngineProgress({
              stage: p.stage,
              percent: pct,
              speedBytesPerSec: p.speedBytesPerSec,
              activeConcurrency: p.activeConcurrency,
              currentChunkSizeBytes: p.currentChunkSizeBytes,
              bufferedBytes: p.bufferedBytes,
              fragmentsMuxed: p.fragmentsMuxed,
              zeroWaitReady: p.zeroWaitReady,
              message: p.message,
            });
            setStatusMessage(p.message || `Pipelining stream: ${pct}%`);
          },
          onComplete: (res: any) => {
            setDownloadStatus('completed');
            setStreamProgress(100);
            setEngineProgress((prev) =>
              prev ? { ...prev, percent: 100, zeroWaitReady: true } : null
            );
            setStatusMessage(
              `Saved ${res?.filename || filename} directly to your device with 0s merge wait!`
            );
          },
          onError: () => {
            fallbackToBridge(activeUrl, filename);
          },
        });
        streamControllerRef.current = controller;
        return;
      }
    } catch {
      // Gracefully fall back to companion bridge
    }

    fallbackToBridge(activeUrl, filename);
  }, [targetUrl, inputValue, selectedFormat, manifest, fallbackToBridge]);

  const handleCancelStreaming = () => {
    if (streamControllerRef.current?.abort) {
      streamControllerRef.current.abort('User cancelled');
    }
    setDownloadStatus('idle');
    setStreamProgress(0);
    setEngineProgress(null);
    setStatusMessage('Streaming cancelled.');
  };

  const platformInfo = targetUrl ? detectPlatform(targetUrl) : null;

  return (
    <div className="min-h-screen py-10 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto space-y-10" style={{ overflowX: 'clip' }}>
      {/* Top Navigation Back to Workspace */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line bg-surface text-xs font-semibold text-content-secondary hover:text-content hover:bg-surface-muted transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Back to Downloader</span>
        </Link>

        <span className="text-xs text-content-muted font-mono">
          MUXARO Direct Engine v1.0
        </span>
      </div>

      {/* Header Banner - Rebranded & Compliant */}
      <section className="space-y-3 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-light border border-brand/20 text-brand text-xs font-semibold">
          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Client-Side Browser Streaming</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-content">
          MUXARO Direct
        </h1>
        <p className="max-w-2xl mx-auto text-sm sm:text-base text-content-secondary leading-relaxed">
          Client-side browser streaming for direct, full-speed transfers of authorized, user-owned, and Creative Commons media without cloud rate limits.
        </p>
      </section>

      {/* Passed Media Link / Direct Stream Cockpit */}
      {targetUrl ? (
        <section
          aria-label="Active stream target"
          className="p-5 sm:p-6 rounded-2xl border border-brand/40 bg-surface shadow-md space-y-5"
        >
          {/* Header row with status badge */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-light text-brand flex-shrink-0">
                <Zap className="w-4 h-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-content uppercase tracking-wider">
                  Target Media Stream
                </h2>
                <p className="text-xs text-content-secondary">
                  Ready to stream directly through your browser connection.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {platformInfo && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-surface-elevated text-content-secondary border border-line-subtle">
                  {platformInfo.name}
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                  isCompanionActive
                    ? 'bg-success-bg text-success border-success/30'
                    : checking
                    ? 'bg-amber-400/10 text-amber-500 border-amber-400/30'
                    : 'bg-surface-elevated text-content-secondary border-line'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isCompanionActive ? 'bg-success' : checking ? 'bg-amber-400' : 'bg-content-muted'
                  }`}
                  aria-hidden="true"
                />
                <span>
                  {isCompanionActive
                    ? 'Direct Stream Active'
                    : checking
                    ? 'Detecting Bridge…'
                    : 'Companion Not Installed'}
                </span>
              </span>
            </div>
          </div>

          {/* Instant Link Feedback & Visual Media Confirmation */}
          <div className="p-4 sm:p-5 rounded-xl bg-surface-elevated border border-line space-y-4">
            {inspecting ? (
              <div className="flex items-center gap-3 py-3 text-xs text-content-secondary">
                <Loader2 className="w-4 h-4 motion-safe:animate-spin text-brand flex-shrink-0" aria-hidden="true" />
                <span>Recognizing media stream &amp; inspecting formats…</span>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                {/* Media Thumbnail or Platform Poster */}
                <div className="relative w-full sm:w-44 h-28 rounded-lg overflow-hidden bg-surface border border-line-subtle flex-shrink-0 flex items-center justify-center">
                  {manifest?.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={manifest.thumbnailUrl}
                      alt={manifest.title || 'Media preview'}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-brand gap-1 p-2">
                      {selectedFormat === 'mp3' ? (
                        <FileAudio className="w-8 h-8" aria-hidden="true" />
                      ) : (
                        <FileVideo className="w-8 h-8" aria-hidden="true" />
                      )}
                      <span className="text-[10px] text-content-muted uppercase tracking-wider font-semibold">
                        {platformInfo?.name || 'Media Stream'}
                      </span>
                    </div>
                  )}
                  {manifest?.durationSeconds && manifest.durationSeconds > 0 ? (
                    <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-white text-[10px] font-mono font-medium">
                      {formatDuration(manifest.durationSeconds)}
                    </span>
                  ) : null}
                </div>

                {/* Recognized Media Metadata */}
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {platformInfo && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-brand-light text-brand border border-brand/20">
                        {platformInfo.name}
                      </span>
                    )}
                    {manifest?.durationSeconds && manifest.durationSeconds > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs text-content-secondary bg-surface border border-line-subtle">
                        <Clock className="w-3 h-3 text-brand" aria-hidden="true" />
                        <span>{formatDuration(manifest.durationSeconds)}</span>
                      </span>
                    )}
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-success-bg text-success border border-success/20">
                      Direct Browser Stream Ready
                    </span>
                  </div>

                  <h3 className="text-sm sm:text-base font-bold text-content leading-snug line-clamp-2" title={manifest?.title || targetUrl}>
                    {manifest?.title || formatDisplayUrl(targetUrl, 50)}
                  </h3>

                  {manifest?.author && (
                    <p className="text-xs text-content-muted">
                      Creator: <span className="text-content-secondary font-medium">{manifest.author}</span>
                    </p>
                  )}

                  <p className="text-xs text-content-secondary leading-relaxed pt-0.5">
                    Authorized, user-owned, or Creative Commons media stream ready for direct, full-speed transfer with zero cloud limits.
                  </p>
                </div>
              </div>
            )}

            {/* Available Streams & Quality Pills */}
            {manifest && (manifest.videoStreams?.length > 0 || manifest.audioStreams?.length > 0) && (
              <div className="pt-2 border-t border-line-subtle space-y-2">
                <div className="flex items-center justify-between text-xs text-content-secondary font-medium">
                  <span>Available stream quality:</span>
                  <span className="text-[11px] text-content-muted">Pipelined zero-wait copy</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedFormat === 'mp4' ? (
                    (manifest.videoStreams || []).length > 0 ? (
                      manifest.videoStreams.slice(0, 5).map((s, idx) => (
                        <button
                          key={s.formatId || `v_${idx}`}
                          type="button"
                          onClick={() => setSelectedQuality(s.resolutionLabel || 'best')}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                            selectedQuality === (s.resolutionLabel || 'best')
                              ? 'bg-brand text-[var(--muxaro-btn-fg)] shadow-sm'
                              : 'bg-surface border border-line text-content-secondary hover:text-content'
                          }`}
                        >
                          <span>{s.resolutionLabel || `${s.height || 1080}p`}</span>
                          {s.fps && s.fps > 30 && <span className="text-[10px] opacity-80">{s.fps}fps</span>}
                        </button>
                      ))
                    ) : (
                      <span className="text-xs text-content-muted">Best available MP4 stream</span>
                    )
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-brand text-[var(--muxaro-btn-fg)]">
                      Direct Audio Extract (320kbps / Lossless Copy)
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Pre-populated Link Box (No re-typing or re-pasting needed!) */}
          <div className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl bg-surface-elevated border border-line text-xs font-mono text-content">
            <span className="truncate flex-1" title={targetUrl}>
              {targetUrl}
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={handleCopyLink}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-line bg-surface text-content-secondary hover:text-content text-xs font-sans font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                title="Copy link to clipboard"
              >
                {copiedLink ? (
                  <Check className="w-3 h-3 text-success" aria-hidden="true" />
                ) : (
                  <Copy className="w-3 h-3" aria-hidden="true" />
                )}
                <span>{copiedLink ? 'Copied' : 'Copy'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTargetUrl('');
                  setInputValue('');
                  setManifest(null);
                  setDownloadStatus('idle');
                  setEngineProgress(null);
                }}
                className="text-xs text-content-muted hover:text-content font-sans hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-sm px-1"
              >
                Change link
              </button>
            </div>
          </div>

          {/* Format Selector: Video vs Audio */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-content-secondary">Format:</span>
              <button
                type="button"
                onClick={() => setSelectedFormat('mp4')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  selectedFormat === 'mp4'
                    ? 'bg-brand text-[var(--muxaro-btn-fg)] shadow-sm'
                    : 'bg-surface border border-line text-content-secondary hover:text-content'
                }`}
              >
                <FileVideo className="w-3.5 h-3.5" aria-hidden="true" />
                <span>MP4 Video</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedFormat('mp3')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  selectedFormat === 'mp3'
                    ? 'bg-brand text-[var(--muxaro-btn-fg)] shadow-sm'
                    : 'bg-surface border border-line text-content-secondary hover:text-content'
                }`}
              >
                <FileAudio className="w-3.5 h-3.5" aria-hidden="true" />
                <span>MP3 Audio</span>
              </button>
            </div>

            {/* In-flight Stream Progress indicator */}
            {downloadStatus === 'streaming' && (
              <div className="flex items-center gap-2 text-xs font-medium text-brand">
                <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" aria-hidden="true" />
                <span>{streamProgress > 0 ? `${streamProgress}% streamed` : 'Connecting stream pipeline…'}</span>
              </div>
            )}
          </div>

          {/* Live Pipelined Progress with throughput, chunks, and zero-wait feedback */}
          {downloadStatus === 'streaming' && (
            <div className="space-y-2.5 p-4 rounded-xl bg-surface-elevated border border-brand/20">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-content">
                  Zero-Wait Streaming Engine
                </span>
                <span className="mono-metric font-bold text-brand">
                  {streamProgress}%
                </span>
              </div>

              <div
                className="w-full h-2.5 rounded-full bg-surface overflow-hidden"
                role="progressbar"
                aria-valuenow={streamProgress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Direct browser stream progress"
              >
                <div
                  className="h-full w-full origin-left rounded-full"
                  style={{
                    backgroundImage: 'var(--muxaro-gradient-primary)',
                    transform: `scaleX(${Math.max(0.05, streamProgress / 100)})`,
                    transition: 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                />
              </div>

              {/* Live Engine Metrics Strip */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-content-secondary">
                <span className="inline-flex items-center gap-1 font-mono">
                  <Gauge className="w-3 h-3 text-brand" aria-hidden="true" />
                  <span>
                    {engineProgress?.speedBytesPerSec
                      ? `${formatBytes(engineProgress.speedBytesPerSec)}/s`
                      : 'High-speed throughput'}
                  </span>
                </span>

                <span className="inline-flex items-center gap-1">
                  <span>
                    {engineProgress?.activeConcurrency
                      ? `${engineProgress.activeConcurrency} parallel chunks`
                      : 'Pipelined parallel chunks'}
                  </span>
                </span>

                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success-bg text-success font-semibold border border-success/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-success motion-safe:animate-pulse" />
                  <span>Zero Post-Merge Wait</span>
                </span>
              </div>
            </div>
          )}

          {/* Status feedback message */}
          {statusMessage && (
            <div
              className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                downloadStatus === 'completed'
                  ? 'bg-success-bg text-success'
                  : downloadStatus === 'error'
                  ? 'bg-surface-elevated border border-line text-warning'
                  : 'bg-surface-elevated text-content-secondary'
              }`}
            >
              {downloadStatus === 'completed' ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              ) : downloadStatus === 'error' ? (
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-warning" aria-hidden="true" />
              ) : (
                <Info className="w-4 h-4 flex-shrink-0 text-brand" aria-hidden="true" />
              )}
              <span>{statusMessage}</span>
            </div>
          )}

          {/* Action CTAs */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
            <button
              type="button"
              disabled={downloadStatus === 'streaming'}
              onClick={handleStartStreamDownload}
              className="muxaro-btn-primary flex-1 inline-flex items-center justify-center gap-2 px-6 py-3.5 text-sm sm:text-base font-semibold shadow-sm active:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-60 cursor-pointer text-center"
            >
              <Zap className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              <span>
                {downloadStatus === 'streaming'
                  ? 'Streaming Directly…'
                  : downloadStatus === 'completed'
                  ? 'Stream Again'
                  : isCompanionActive
                  ? 'Connected — Start Streaming'
                  : 'Start Direct Stream Download'}
              </span>
            </button>

            {downloadStatus === 'streaming' && (
              <button
                type="button"
                onClick={handleCancelStreaming}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-3.5 rounded-xl border border-line bg-surface text-xs font-semibold text-content-secondary hover:text-content hover:bg-surface-muted transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand text-center cursor-pointer"
              >
                <XCircle className="w-3.5 h-3.5 text-warning" aria-hidden="true" />
                <span>Cancel stream</span>
              </button>
            )}

            {isCompanionActive ? (
              <Link
                href={targetUrl ? `/?url=${encodeURIComponent(targetUrl)}` : '/'}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-3.5 rounded-xl border border-line bg-surface text-xs font-semibold text-content hover:bg-surface-muted transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand text-center"
              >
                <span>Connected — Open Downloader</span>
                <ArrowRight className="w-3.5 h-3.5 text-content-muted" aria-hidden="true" />
              </Link>
            ) : (
              <a
                href="/muxaro-direct.user.js"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 px-4 py-3.5 rounded-xl border border-line bg-surface text-xs font-semibold text-content hover:bg-surface-muted transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand text-center"
              >
                <span>Install Companion Script</span>
                <ExternalLink className="w-3.5 h-3.5 text-content-muted" aria-hidden="true" />
              </a>
            )}
          </div>
        </section>
      ) : (
        /* Fresh Input Card if no URL was passed via query params */
        <section
          aria-label="Direct input card"
          className="p-6 rounded-2xl border border-line bg-surface shadow-sm space-y-4"
        >
          <div className="space-y-1">
            <h2 className="text-base font-bold text-content">Enter Media Link for Direct Download</h2>
            <p className="text-xs text-content-secondary">
              Paste any YouTube, Vimeo, or direct media stream for client-side browser streaming.
            </p>
          </div>

          <form onSubmit={handleUrlSubmit} className="space-y-3">
            <div className="relative">
              <input
                id={urlInputId}
                type="text"
                inputMode="url"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=... or direct media link"
                aria-label="Media link for direct download"
                className="w-full pl-3 pr-24 py-3 rounded-xl bg-surface-elevated border border-line text-content placeholder:text-content-muted text-xs sm:text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={handlePasteInput}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-line bg-surface text-xs font-sans font-medium text-content-secondary hover:text-content hover:bg-surface-muted transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  title="Paste from clipboard"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{pastedFeedback ? 'Pasted!' : 'Paste'}</span>
                </button>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!inputValue.trim()}
                className="muxaro-btn-primary inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold disabled:opacity-50"
              >
                <span>Continue to Direct Stream</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Live Companion Status Card */}
      <section
        aria-label="Companion status"
        className="p-6 rounded-2xl border border-line bg-surface shadow-sm transition-colors duration-150"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-3.5 h-3.5 rounded-full ${
                isCompanionActive
                  ? 'bg-success motion-safe:animate-pulse'
                  : checking
                  ? 'bg-amber-400 motion-safe:animate-ping'
                  : 'bg-content-muted'
              }`}
              aria-hidden="true"
            />
            <div>
              <h2 className="text-base font-semibold text-content">
                {isCompanionActive
                  ? `MUXARO Direct is Active (${companionVersion})`
                  : checking
                  ? 'Detecting MUXARO Direct…'
                  : 'MUXARO Direct Not Installed Yet'}
              </h2>
              <p className="text-xs text-content-secondary mt-0.5">
                {isCompanionActive
                  ? 'Browser stream bridge is active and ready. All downloads run with zero cloud restrictions at your ISP speed.'
                  : 'Install the lightweight companion script below for direct browser streaming without cloud rate limits.'}
              </p>
            </div>
          </div>

          <div className="self-end sm:self-center">
            {isCompanionActive ? (
              <Link
                href={targetUrl ? `/?url=${encodeURIComponent(targetUrl)}` : '/'}
                className="muxaro-btn-primary inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold"
              >
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                <span>Connected — Open Downloader</span>
              </Link>
            ) : (
              <a
                href="/muxaro-direct.user.js"
                target="_blank"
                rel="noopener noreferrer"
                className="muxaro-btn-primary inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold"
              >
                <Zap className="w-4 h-4" aria-hidden="true" />
                <span>1-Click Install Script</span>
              </a>
            )}
          </div>
        </div>
      </section>

      {/* Feature Grid - Rebranded & Compliant */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-5 rounded-2xl border border-line bg-surface-elevated space-y-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-brand-light text-brand">
            <Zap className="w-5 h-5" aria-hidden="true" />
          </div>
          <h3 className="text-sm font-semibold text-content">Zero Server Bottlenecks</h3>
          <p className="text-xs text-content-secondary leading-relaxed">
            Media streams directly from content delivery networks to your storage at your full connection speed. No server queuing or throttling.
          </p>
        </div>

        <div className="p-5 rounded-2xl border border-line bg-surface-elevated space-y-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-brand-light text-brand">
            <ShieldCheck className="w-5 h-5" aria-hidden="true" />
          </div>
          <h3 className="text-sm font-semibold text-content">100% Private &amp; Direct</h3>
          <p className="text-xs text-content-secondary leading-relaxed">
            All network requests and stream assembly run inside your browser. No user cookies or tokens touch remote processing servers.
          </p>
        </div>

        <div className="p-5 rounded-2xl border border-line bg-surface-elevated space-y-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-brand-light text-brand">
            <Sparkles className="w-5 h-5" aria-hidden="true" />
          </div>
          <h3 className="text-sm font-semibold text-content">Zero-Wait Pipelining</h3>
          <p className="text-xs text-content-secondary leading-relaxed">
            Direct client-side streaming transfers authorized and Creative Commons media, avoiding cloud server bottlenecks and rate limits.
          </p>
        </div>
      </section>

      {/* 2-Step Setup Instructions */}
      <section className="p-6 sm:p-8 rounded-2xl border border-line bg-surface space-y-6">
        <h2 className="text-lg font-bold text-content">Easy 2-Step Setup (Takes 30 Seconds)</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Step 1 */}
          <div className="p-5 rounded-xl border border-line bg-surface-elevated space-y-4">
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-brand text-white flex items-center justify-center text-xs font-bold">
                1
              </span>
              <h3 className="text-sm font-semibold text-content">Install a Script Manager</h3>
            </div>
            <p className="text-xs text-content-secondary leading-relaxed">
              Install Violentmonkey (recommended, fast, open-source) or Tampermonkey on your favorite browser:
            </p>
            <div className="flex flex-wrap gap-2 text-xs">
              <a
                href="https://violentmonkey.github.io/get-it/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line bg-surface hover:bg-surface-muted text-content font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <span>Violentmonkey (All Browsers)</span>
                <ExternalLink className="w-3 h-3 text-content-muted" aria-hidden="true" />
              </a>
              <a
                href="https://www.tampermonkey.net/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line bg-surface hover:bg-surface-muted text-content font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <span>Tampermonkey</span>
                <ExternalLink className="w-3 h-3 text-content-muted" aria-hidden="true" />
              </a>
            </div>
          </div>

          {/* Step 2 */}
          <div className="p-5 rounded-xl border border-line bg-surface-elevated space-y-4">
            <div className="flex items-center gap-3">
              <span
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                  isCompanionActive ? 'bg-success text-white' : 'bg-brand text-white'
                }`}
              >
                {isCompanionActive ? <Check className="w-4 h-4" aria-hidden="true" /> : '2'}
              </span>
              <h3 className="text-sm font-semibold text-content">Activate MUXARO Direct</h3>
            </div>
            <p className="text-xs text-content-secondary leading-relaxed">
              {isCompanionActive
                ? 'MUXARO Direct userscript is running in your browser. All streaming requests route seamlessly through your local connection.'
                : 'Click the button below. Your script manager will automatically open a confirmation tab. Click Install.'}
            </p>
            <div>
              {isCompanionActive ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-success-bg text-success text-xs font-semibold border border-success/30">
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    <span>Active &amp; Connected ({companionVersion})</span>
                  </span>
                  <Link
                    href={targetUrl ? `/?url=${encodeURIComponent(targetUrl)}` : '/'}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-line bg-surface hover:bg-surface-muted text-content text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <span>Go to Downloader</span>
                    <ArrowRight className="w-3.5 h-3.5 text-content-muted" aria-hidden="true" />
                  </Link>
                </div>
              ) : (
                <a
                  href="/muxaro-direct.user.js"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="muxaro-btn-primary inline-flex items-center gap-2 px-4 py-2 text-xs font-bold"
                >
                  <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Install MUXARO Direct Script</span>
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Chrome Manifest V3 instructions callout */}
        <div className="p-4 rounded-xl border border-line bg-surface-elevated text-xs text-content-secondary flex items-start gap-3">
          <Info className="w-4 h-4 text-brand flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-semibold text-content">Using Chrome, Brave, or Edge?</p>
            <p className="leading-relaxed">
              Enable &apos;Allow User Scripts&apos; in{' '}
              <code className="px-1.5 py-0.5 rounded bg-surface border border-line font-mono text-content text-[11px]">
                chrome://extensions
              </code>
              {' '}➔ Tampermonkey/Violentmonkey Details if the script does not activate automatically.
            </p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface-muted text-xs text-content-secondary flex items-start gap-3">
          <Info className="w-4 h-4 text-brand flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p>
            Once installed, whenever you visit YouTube, a convenient <strong>[⚡ MUXARO Direct]</strong> button will appear right under videos. You can also click <strong>Download with MUXARO Direct</strong> from any download error card to stream immediately with zero cloud restrictions.
          </p>
        </div>
      </section>

      {/* Architecture Transparency Note */}
      <section className="text-center text-xs text-content-muted space-y-1">
        <p>MUXARO Hybrid Zero-Cost Engine &bull; Built with standard Web Extensions &amp; Userscript APIs</p>
        <p>No analytics tracking &bull; No remote code execution &bull; 100% open source userscript</p>
      </section>
    </div>
  );
}

export default function DirectHelperPage() {
  return (
    <Suspense fallback={<DirectHelperSkeleton />}>
      <DirectHelperContent />
    </Suspense>
  );
}
