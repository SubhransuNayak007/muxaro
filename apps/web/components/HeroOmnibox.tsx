'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Link2,
  ClipboardPaste,
  UploadCloud,
  X,
  ArrowRight,
  Loader2,
  Check,
  Plus,
  Film,
  Music,
  Minimize2,
  Sparkles,
} from 'lucide-react';

export type SupportedPlatform =
  | 'youtube'
  | 'instagram'
  | 'x'
  | 'facebook'
  | 'pinterest'
  | 'tiktok'
  | 'reddit'
  | 'vimeo'
  | null;

export type SmartPreset =
  | '8k'
  | '4k'
  | '2k'
  | '1080p'
  | '720p'
  | '480p'
  | 'audio'
  | 'mute'
  | 'desktop-direct'
  | 'best'
  | 'mp3'
  | 'lossless';

export type DownloadIntentMode = 'video' | 'audio' | 'compact' | 'ai';

export interface PlatformConfig {
  id: NonNullable<SupportedPlatform>;
  name: string;
  domainPattern: RegExp;
}

export const SUPPORTED_PLATFORMS: PlatformConfig[] = [
  { id: 'youtube', name: 'YouTube', domainPattern: /youtube\.com|youtu\.be/i },
  { id: 'instagram', name: 'Instagram', domainPattern: /instagram\.com/i },
  { id: 'x', name: 'X', domainPattern: /twitter\.com|x\.com/i },
  { id: 'facebook', name: 'Facebook', domainPattern: /facebook\.com|fb\.watch/i },
  { id: 'pinterest', name: 'Pinterest', domainPattern: /pinterest\.com|pin\.it/i },
  { id: 'tiktok', name: 'TikTok', domainPattern: /tiktok\.com/i },
  { id: 'reddit', name: 'Reddit', domainPattern: /reddit\.com|redd\.it/i },
  { id: 'vimeo', name: 'Vimeo', domainPattern: /vimeo\.com/i },
];

export function detectPlatform(url: string): SupportedPlatform {
  const clean = url.trim();
  if (!clean) return null;
  for (const p of SUPPORTED_PLATFORMS) {
    if (p.domainPattern.test(clean)) return p.id;
  }
  return null;
}

export function PlatformIcon({
  platform,
  className = 'w-4 h-4',
}: {
  platform: SupportedPlatform;
  className?: string;
}) {
  switch (platform) {
    case 'youtube':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      );
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
        </svg>
      );
    case 'x':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    case 'facebook':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      );
    case 'pinterest':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M12 0a12 12 0 0 0-4.37 23.17c-.07-.63-.13-1.6.03-2.29.14-.62.93-3.95.93-3.95s-.24-.48-.24-1.18c0-1.11.64-1.94 1.44-1.94.68 0 1 .51 1 1.12 0 .68-.44 1.71-.66 2.66-.19.8.4 1.45 1.18 1.45 1.42 0 2.51-1.5 2.51-3.66 0-1.91-1.37-3.25-3.33-3.25-2.27 0-3.6 1.7-3.6 3.46 0 .69.26 1.42.59 1.82.07.08.07.15.05.23-.06.25-.2.8-.23.91-.04.14-.12.17-.27.1-1-.46-1.62-1.92-1.62-3.09 0-2.52 1.83-4.83 5.28-4.83 2.77 0 4.93 1.98 4.93 4.62 0 2.76-1.74 4.97-4.15 4.97-.81 0-1.57-.42-1.83-.92l-.5 1.9c-.18.69-.67 1.56-1 2.09A12 12 0 1 0 12 0z" />
        </svg>
      );
    case 'tiktok':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.24 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
        </svg>
      );
    case 'reddit':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.703zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
        </svg>
      );
    case 'vimeo':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M23.977 6.416c-.105 2.338-1.739 5.543-4.894 9.609-3.268 4.247-6.026 6.37-8.29 6.37-1.409 0-2.578-1.294-3.553-3.881L5.322 11.4C4.603 8.816 3.834 7.522 3.01 7.522c-.179 0-.806.378-1.881 1.132L0 7.197c1.185-1.044 2.351-2.084 3.501-3.128 1.581-1.371 2.775-2.086 3.593-2.146 1.944-.146 3.14 1.185 3.593 3.991.536 3.324.908 5.398 1.118 6.222.632 3.037 1.326 4.555 2.087 4.555.599 0 1.341-.825 2.228-2.476.887-1.65 1.37-2.887 1.448-3.712.16-1.503-.42-2.256-1.745-2.256-.628 0-1.275.143-1.94.429 1.289-4.214 3.738-6.243 7.348-6.088 2.681.116 3.929 1.83 3.746 5.146l.001-.018z" />
        </svg>
      );
    default:
      return <Link2 className={className} aria-hidden="true" />;
  }
}

interface HeroOmniboxProps {
  url: string;
  onUrlChange: (url: string) => void;
  onSubmit: (url: string, preset: SmartPreset) => void;
  probing: boolean;
  mode: DownloadIntentMode;
  onModeChange: (mode: DownloadIntentMode) => void;
  onFocusChange?: (focused: boolean) => void;
  onFileDropClick?: () => void;
  uploadingFile?: boolean;
}

const MODE_PRESET_MAP: Record<DownloadIntentMode, SmartPreset> = {
  video: '4k',
  audio: 'audio',
  compact: '720p',
  ai: 'best',
};

const INTENT_MODES = [
  { id: 'video', label: 'Video', icon: Film },
  { id: 'audio', label: 'Audio', icon: Music },
  { id: 'compact', label: 'Compact', icon: Minimize2 },
  { id: 'ai', label: 'Ask AI', icon: Sparkles },
] as const;

export default function HeroOmnibox({
  url,
  onUrlChange,
  onSubmit,
  probing,
  mode,
  onModeChange,
  onFocusChange,
  onFileDropClick,
  uploadingFile = false,
}: HeroOmniboxProps) {
  const [detectedPlatform, setDetectedPlatform] = useState<SupportedPlatform>(null);
  const [pastedFeedback, setPastedFeedback] = useState<boolean>(false);
  const [showPlatforms, setShowPlatforms] = useState<boolean>(false);
  const [isMobileWidth, setIsMobileWidth] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const activePreset = MODE_PRESET_MAP[mode];

  useEffect(() => {
    const checkWidth = () => setIsMobileWidth(window.innerWidth < 440);
    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  useEffect(() => {
    setDetectedPlatform(detectPlatform(url));
  }, [url]);

  useEffect(() => {
    if (!showPlatforms) return;
    const onPointerDown = (e: PointerEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPlatforms(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowPlatforms(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showPlatforms]);

  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      const pastedText = e.clipboardData?.getData('text')?.trim();
      if (pastedText) {
        e.preventDefault();
        onUrlChange(pastedText);
        setDetectedPlatform(detectPlatform(pastedText));
        setPastedFeedback(true);
        setTimeout(() => setPastedFeedback(false), 1600);
        inputRef.current?.focus();
        if (/^https?:\/\//i.test(pastedText)) {
          onSubmit(pastedText, activePreset);
        }
      }
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [onUrlChange, onSubmit, activePreset]);

  const handlePasteClick = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        const trimmed = text.trim();
        if (trimmed) {
          onUrlChange(trimmed);
          setDetectedPlatform(detectPlatform(trimmed));
          setPastedFeedback(true);
          setTimeout(() => setPastedFeedback(false), 1600);
          inputRef.current?.focus();
          if (/^https?:\/\//i.test(trimmed)) {
            onSubmit(trimmed, activePreset);
          }
          return;
        }
      }
    } catch {}
    inputRef.current?.focus();
  };

  const handleClear = () => {
    onUrlChange('');
    setDetectedPlatform(null);
    inputRef.current?.focus();
  };

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      if (mode === 'ai') {
        onSubmit('', activePreset);
        return;
      }
      inputRef.current?.focus();
      return;
    }
    const looksLikeUrl =
      /^https?:\/\//i.test(trimmed) ||
      (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/:?#].*)?$/i.test(trimmed) && !/\s/.test(trimmed));
    if (mode === 'ai' || (!looksLikeUrl && /\s/.test(trimmed))) {
      onSubmit(trimmed, activePreset);
      return;
    }
    if (!looksLikeUrl && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('muxaro:open-command', { detail: { query: trimmed } }));
      return;
    }
    onSubmit(trimmed, activePreset);
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-2.5">
      {/* Main Command Bar */}
      <div className="w-full min-h-[54px] rounded-2xl liquid-glass px-2.5 py-1.5 flex flex-col justify-center relative focus-within:border-line-focus focus-within:ring-2 focus-within:ring-focus/15">
        <form onSubmit={handleSubmitForm} className="flex items-center gap-1.5 w-full">
          <div className="flex items-center pl-1.5 shrink-0">
            {probing ? (
              <Loader2 className="w-4 h-4 text-brand motion-safe:animate-spin" aria-hidden="true" />
            ) : detectedPlatform ? (
              <span
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs font-medium bg-surface-elevated border border-line text-content"
                title={detectedPlatform}
              >
                <PlatformIcon platform={detectedPlatform} className="w-3.5 h-3.5 shrink-0" />
                <span className="capitalize hidden xs:inline">{detectedPlatform}</span>
              </span>
            ) : (
              <span className="p-1 text-content-secondary" aria-hidden="true">
                <Link2 className="w-4 h-4" />
              </span>
            )}
          </div>

          <input
            ref={inputRef}
            type="text"
            inputMode="url"
            maxLength={512}
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            onFocus={() => onFocusChange?.(true)}
            onBlur={() => onFocusChange?.(false)}
            placeholder={
              mode === 'ai'
                ? 'Ask anything, summarize files, or write Python…'
                : isMobileWidth
                  ? 'Paste link, ask AI, or drop file…'
                  : 'Paste video URL, ask MUXARO AI, or drop PDF / MP4…'
            }
            aria-label="Media link or file input"
            className="flex-1 min-w-0 bg-transparent border-0 text-content placeholder:text-content-secondary placeholder:truncate truncate text-sm font-sans focus:outline-none focus:ring-0 px-1.5 py-1.5 select-text"
          />

          <div className="flex items-center gap-1 shrink-0">
            {url.trim().length > 0 && (
              <button
                type="button"
                onClick={handleClear}
                aria-label="Clear URL input"
                className="p-1.5 rounded-lg text-content-secondary hover:text-content hover:bg-surface-elevated transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}

            {onFileDropClick && (
              <button
                type="button"
                onClick={onFileDropClick}
                disabled={uploadingFile}
                aria-label="Choose local media file"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line bg-surface-elevated text-xs font-medium text-content-secondary hover:text-content hover:border-line-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus whitespace-nowrap disabled:opacity-50"
              >
                <UploadCloud className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Drop file</span>
              </button>
            )}

            <button
              type="button"
              onClick={handlePasteClick}
              aria-label="Paste URL from clipboard"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line bg-surface-elevated text-xs font-medium text-content-secondary hover:text-content hover:border-line-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus whitespace-nowrap"
            >
              {pastedFeedback ? (
                <Check className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
              ) : (
                <ClipboardPaste className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span className="hidden xs:inline">{pastedFeedback ? 'Pasted' : 'Paste'}</span>
            </button>

            {/* Primary CTA: Highest Visual Hierarchy Weight on Screen */}
            <button
              type="submit"
              disabled={probing}
              aria-label={probing ? 'Analyzing link' : 'Analyze link'}
              className="px-4 py-1.5 min-h-[36px] rounded-lg text-xs font-semibold bg-brand text-brand-fg hover:bg-brand-hover flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
            >
              <span>{probing ? 'Wait' : 'Go'}</span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            </button>
          </div>
        </form>
      </div>

      {/* MUXARO Output Intent Modes (Soft Active Tint + Strict Monochrome Icons) + Supported Services */}
      <div className="flex flex-wrap items-center justify-between gap-2 relative" ref={popoverRef}>
        <div
          role="listbox"
          aria-label="Output mode"
          className="inline-flex items-center rounded-xl border border-line bg-surface p-0.5"
        >
          {INTENT_MODES.map((item) => {
            const Icon = item.icon;
            const selected = mode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onModeChange(item.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-xs font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus whitespace-nowrap ${
                  selected
                    ? 'bg-brand/12 border-brand/30 text-brand font-semibold'
                    : 'border-transparent text-content-secondary hover:text-content'
                }`}
              >
                <Icon
                  className={`w-3.5 h-3.5 shrink-0 ${
                    selected ? 'text-brand' : 'text-content-secondary'
                  }`}
                  aria-hidden={true}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setShowPlatforms((v) => !v)}
          aria-expanded={showPlatforms}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line bg-surface hover:border-line-hover text-xs font-medium text-content-secondary hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus whitespace-nowrap"
        >
          <Plus
            className={`w-3.5 h-3.5 transition-transform duration-150 ${
              showPlatforms ? 'rotate-45 text-brand' : ''
            }`}
            aria-hidden="true"
          />
          <span>Supported services</span>
        </button>

        {showPlatforms && (
          <div
            role="dialog"
            aria-label="Supported video platforms"
            className="absolute right-0 top-full mt-2 z-30 w-full sm:w-80 rounded-xl border border-line bg-surface p-3.5 shadow-card"
          >
            <div className="grid grid-cols-2 gap-1.5 mb-2.5">
              {SUPPORTED_PLATFORMS.map((platform) => (
                <div
                  key={platform.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface-elevated border border-line-subtle text-xs text-content"
                >
                  <PlatformIcon platform={platform.id} className="w-3.5 h-3.5 text-content-secondary shrink-0" />
                  <span>{platform.name}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-content-secondary leading-snug">
              Supports direct media URLs and local uploads up to 2 GB, plus instant browser-local PDF and audio routing.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
