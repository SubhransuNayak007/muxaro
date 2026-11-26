'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Image as ImageIcon,
  Link2,
  ClipboardPaste,
  Download,
  Copy,
  Check,
  AlertCircle,
  Loader2,
  ExternalLink,
  ArrowRight,
} from 'lucide-react';
import { getApiBaseUrl } from '@/lib/api-client';
import { formatBytes } from '@/lib/formatters';
import { normalizeMediaUrl } from '@/lib/url-utils';
import { captureLocalVideoFrame } from '@/lib/tier1-local';

interface ThumbnailVariant {
  id: string;
  label: string;
  url: string;
  width: number;
  height: number;
  ext: string;
  sizeBytes?: number;
}

interface ThumbnailResult {
  title: string;
  uploader?: string | null;
  platform?: string | null;
  sourceUrl: string;
  thumbnails: ThumbnailVariant[];
}

export default function ThumbnailExtractorPage() {
  const [urlInput, setUrlInput] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ThumbnailResult | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewTheme, setPreviewTheme] = useState<'dark' | 'light'>('dark');
  const [frameTimeSec, setFrameTimeSec] = useState<number>(5);
  const [frameFormat, setFrameFormat] = useState<'png' | 'jpg'>('png');
  const [localVideoFile, setLocalVideoFile] = useState<File | null>(null);
  const [grabbingFrame, setGrabbingFrame] = useState<boolean>(false);
  const [grabbedFrame, setGrabbedFrame] = useState<{ dataUrl: string; filename: string; sizeBytes: number } | null>(null);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text?.trim()) setUrlInput(text.trim());
    } catch {}
  };

  const handleInspect = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    const normalized = normalizeMediaUrl(urlInput);
    if (!normalized) {
      setErrorMessage('Please enter a valid video URL.');
      return;
    }

    setLoading(true);
    try {
      const base = getApiBaseUrl().replace(/\/+$/, '');
      const res = await fetch(`${base}/tools/thumbnails`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ url: normalized }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success || !json?.data) {
        throw new Error(json?.error?.message || 'Failed to extract thumbnails.');
      }
      setResult(json.data);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Could not extract thumbnails from that URL.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyUrl = async (id: string, imgUrl: string) => {
    try {
      await navigator.clipboard.writeText(imgUrl);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {}
  };

  const buildDownloadHref = (variant: ThumbnailVariant) => {
    const base = getApiBaseUrl().replace(/\/+$/, '');
    const stem = (result?.title || 'thumbnail')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .slice(0, 60);
    const filename = `${stem}_${variant.id}.${variant.ext || 'jpg'}`;
    return `${base}/tools/thumbnails/download?url=${encodeURIComponent(
      variant.url
    )}&filename=${encodeURIComponent(filename)}`;
  };

  const handleGrabFrame = async (fileOverride?: File | null) => {
    const fileToUse = fileOverride ?? localVideoFile;
    if (fileToUse) {
      setErrorMessage(null);
      setGrabbingFrame(true);
      try {
        const res = await captureLocalVideoFrame(fileToUse, frameTimeSec, frameFormat);
        setGrabbedFrame(res);
      } catch (err: any) {
        setErrorMessage(err?.message || 'Could not capture local frame.');
      } finally {
        setGrabbingFrame(false);
      }
      return;
    }

    const normalized = normalizeMediaUrl(urlInput);
    if (!normalized) {
      setErrorMessage('Paste a valid video URL or pick a local video file to grab a frame.');
      return;
    }
    setErrorMessage(null);
    setGrabbingFrame(true);
    try {
      const base = getApiBaseUrl().replace(/\/+$/, '');
      const res = await fetch(`${base}/tools/frame-grab`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalized, timestampSec: frameTimeSec, format: frameFormat }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success || !json?.data) {
        throw new Error(json?.error?.message || 'Frame grab failed.');
      }
      setGrabbedFrame(json.data);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Could not capture frame.');
    } finally {
      setGrabbingFrame(false);
    }
  };

  return (
    <div className="w-full">
      <section className="muxaro-hero-surface border-b border-line">
        <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
          <div className="mb-5">
            <Link
              href="/tools"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-content-secondary hover:text-content transition-colors"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>All media tools</span>
            </Link>
          </div>

          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-elevated border border-line text-xs font-medium text-content-secondary mb-3">
              <ImageIcon className="w-3.5 h-3.5 text-content" aria-hidden="true" />
              <span>Multi-resolution cover art</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-content tracking-tight">
              Thumbnail extractor
            </h1>
            <p className="text-base text-content-secondary mt-2.5 leading-relaxed">
              Grab verified HD (1280×720), SD, and timeline frame thumbnails directly from YouTube and 1,000+ platforms with zero watermarks.
            </p>
          </div>
        </div>
      </section>

      <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-6">
        <form
          onSubmit={handleInspect}
          className="muxaro-media-card p-5 sm:p-6 space-y-4 max-w-4xl mx-auto"
        >
          <label
            htmlFor="thumb-url"
            className="block text-xs font-semibold text-content-secondary"
          >
            Video URL
          </label>
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Link2 className="w-4 h-4 text-content-secondary absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="thumb-url"
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="muxaro-input w-full pl-10 pr-4 py-3 text-sm"
                required
              />
            </div>
            <button
              type="button"
              onClick={handlePaste}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl border border-line bg-surface-elevated text-xs font-semibold text-content hover:border-line-hover transition-colors"
            >
              <ClipboardPaste className="w-4 h-4 text-content-secondary" />
              <span>Paste</span>
            </button>
            <button
              type="submit"
              disabled={loading || !urlInput.trim()}
              className="muxaro-btn-primary px-6 py-3 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Inspecting…</span>
                </>
              ) : (
                <>
                  <span>Extract Thumbnails</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-error-bg border border-error/20 text-error text-xs flex items-center gap-2.5"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
        </form>

        {result && (
          <div className="max-w-5xl mx-auto space-y-5">
            <div className="muxaro-card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-bold text-content truncate">
                  {result.title}
                </h2>
                <p className="text-xs text-content-secondary mt-0.5">
                  {[result.uploader, result.platform, `${result.thumbnails.length} verified resolutions`]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <div className="inline-flex rounded-xl border border-line bg-surface-elevated p-1 text-xs shrink-0">
                <button
                  type="button"
                  onClick={() => setPreviewTheme('dark')}
                  className={`px-3 py-1 rounded-lg font-medium ${previewTheme === 'dark' ? 'bg-content text-base' : 'text-content-secondary'}`}
                >
                  YouTube Dark
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTheme('light')}
                  className={`px-3 py-1 rounded-lg font-medium ${previewTheme === 'light' ? 'bg-content text-base' : 'text-content-secondary'}`}
                >
                  YouTube Light
                </button>
              </div>
            </div>

            {/* Frame Grabber & YouTube Safe-Zone Preview */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="muxaro-card p-5 space-y-3">
                <h3 className="text-sm font-bold text-content">Lossless Video Frame Grabber</h3>
                <p className="text-xs text-content-secondary">
                  Step to any timestamp to extract a full-resolution PNG or JPG frame directly from the video stream.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFrameTimeSec((s) => Math.max(0, Number((s - 1).toFixed(1))))}
                    className="px-2.5 py-2 rounded-xl border border-line bg-surface-elevated text-xs font-mono text-content"
                  >
                    -1s
                  </button>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={frameTimeSec}
                    onChange={(e) => setFrameTimeSec(Math.max(0, Number(e.target.value) || 0))}
                    className="w-24 px-3 py-2 rounded-xl border border-line bg-surface-elevated text-xs font-mono text-content"
                  />
                  <button
                    type="button"
                    onClick={() => setFrameTimeSec((s) => Number((s + 1).toFixed(1)))}
                    className="px-2.5 py-2 rounded-xl border border-line bg-surface-elevated text-xs font-mono text-content"
                  >
                    +1s
                  </button>
                  <select
                    value={frameFormat}
                    onChange={(e) => setFrameFormat(e.target.value as 'png' | 'jpg')}
                    className="px-3 py-2 rounded-xl border border-line bg-surface-elevated text-xs text-content"
                  >
                    <option value="png">Lossless PNG</option>
                    <option value="jpg">JPG</option>
                  </select>
                  <label className="px-3 py-2 rounded-xl border border-line bg-surface-elevated text-xs font-medium text-content cursor-pointer hover:border-line-hover">
                    <input
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        setLocalVideoFile(f);
                        if (f) void handleGrabFrame(f);
                      }}
                    />
                    {localVideoFile ? `Local: ${localVideoFile.name.slice(0, 18)}` : 'Local video (0ms)'}
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleGrabFrame()}
                    disabled={grabbingFrame}
                    className="px-4 py-2 rounded-xl bg-content text-base text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                  >
                    {grabbingFrame ? 'Capturing…' : 'Grab Frame'}
                  </button>
                </div>
                {grabbedFrame && (
                  <div className="pt-2 space-y-2">
                    <img
                      src={grabbedFrame.dataUrl}
                      alt={grabbedFrame.filename}
                      className="w-full rounded-xl border border-line object-cover max-h-52"
                    />
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-content-secondary">
                        {grabbedFrame.filename} ({formatBytes(grabbedFrame.sizeBytes)})
                      </span>
                      <a
                        href={grabbedFrame.dataUrl}
                        download={grabbedFrame.filename}
                        className="inline-flex items-center gap-1 font-semibold text-content hover:underline"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Save Frame</span>
                      </a>
                    </div>
                  </div>
                )}
              </div>

              {result.thumbnails[0] && (
                <div
                  className={`rounded-2xl border border-line p-4 space-y-2.5 ${
                    previewTheme === 'dark' ? 'bg-[#0F0F0F] text-white' : 'bg-white text-[#0F0F0F]'
                  }`}
                >
                  <div className="text-[11px] font-semibold opacity-70">
                    YouTube Feed Preview ({previewTheme === 'dark' ? 'Dark' : 'Light'} Mode + Safe Zone)
                  </div>
                  <div className="relative aspect-video rounded-xl overflow-hidden">
                    <img
                      src={result.thumbnails[0].url}
                      alt={result.title}
                      className="w-full h-full object-cover"
                    />
                    <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-white text-[11px] font-mono font-semibold">
                      12:45
                    </span>
                  </div>
                  <div className="text-sm font-semibold line-clamp-2 leading-snug">{result.title}</div>
                  <div className="text-xs opacity-65">{result.uploader || 'Creator Channel'}</div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {result.thumbnails.map((variant) => (
                <div
                  key={variant.id}
                  className="muxaro-card overflow-hidden flex flex-col justify-between"
                >
                  <div className="bg-surface-elevated border-b border-line aspect-video overflow-hidden flex items-center justify-center">
                    <img
                      src={variant.url}
                      alt={`${result.title} (${variant.label})`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-content">
                        {variant.label}
                      </div>
                      <div className="text-xs font-mono text-content-secondary tabular-nums mt-0.5">
                        {variant.width > 0 ? `${variant.width}×${variant.height}` : 'Native'} ·{' '}
                        {variant.ext.toUpperCase()}
                        {variant.sizeBytes ? ` · ${formatBytes(variant.sizeBytes)}` : ''}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleCopyUrl(variant.id, variant.url)}
                        className="px-3 py-2 rounded-xl border border-line bg-surface-elevated text-xs font-medium text-content-secondary hover:text-content inline-flex items-center gap-1.5"
                      >
                        {copiedId === variant.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy URL</span>
                          </>
                        )}
                      </button>

                      <a
                        href={variant.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-xl border border-line bg-surface-elevated text-content-secondary hover:text-content"
                        title="Open image in new tab"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>

                      <a
                        href={buildDownloadHref(variant)}
                        download
                        className="px-3.5 py-2 rounded-xl bg-content text-base text-xs font-semibold inline-flex items-center gap-1.5 hover:opacity-90"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
