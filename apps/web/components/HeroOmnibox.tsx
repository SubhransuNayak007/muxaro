'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Link2,
  ClipboardPaste,
  X,
  ArrowUp,
  Loader2,
  Check,
  Sparkles,
  SlidersHorizontal,
  ShieldCheck,
  Clock,
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

export type SmartPreset = 'best' | '1080p' | 'mp3' | 'lossless';

export interface PlatformConfig {
  id: NonNullable<SupportedPlatform>;
  name: string;
  domainPattern: RegExp;
  colorClass: string;
  hoverColorClass: string;
  activeBgClass: string;
  activeBorderClass: string;
}

export const SUPPORTED_PLATFORMS: PlatformConfig[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    domainPattern: /youtube\.com|youtu\.be/i,
    colorClass: 'text-[#FF0000]',
    hoverColorClass: 'group-hover:text-[#FF0000]',
    activeBgClass: 'bg-[#FF0000]/10',
    activeBorderClass: 'border-[#FF0000]/40',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    domainPattern: /instagram\.com/i,
    colorClass: 'text-[#E4405F]',
    hoverColorClass: 'group-hover:text-[#E4405F]',
    activeBgClass: 'bg-[#E4405F]/10',
    activeBorderClass: 'border-[#E4405F]/40',
  },
  {
    id: 'x',
    name: 'X',
    domainPattern: /twitter\.com|x\.com/i,
    colorClass: 'text-content',
    hoverColorClass: 'group-hover:text-content',
    activeBgClass: 'bg-surface-elevated',
    activeBorderClass: 'border-line',
  },
  {
    id: 'facebook',
    name: 'Facebook',
    domainPattern: /facebook\.com|fb\.watch/i,
    colorClass: 'text-[#1877F2]',
    hoverColorClass: 'group-hover:text-[#1877F2]',
    activeBgClass: 'bg-[#1877F2]/10',
    activeBorderClass: 'border-[#1877F2]/40',
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    domainPattern: /pinterest\.com|pin\.it/i,
    colorClass: 'text-[#BD081C]',
    hoverColorClass: 'group-hover:text-[#BD081C]',
    activeBgClass: 'bg-[#BD081C]/10',
    activeBorderClass: 'border-[#BD081C]/40',
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    domainPattern: /tiktok\.com/i,
    colorClass: 'text-[#00F2FE] dark:text-[#FE2C55]',
    hoverColorClass: 'group-hover:text-[#00F2FE] dark:group-hover:text-[#FE2C55]',
    activeBgClass: 'bg-info-bg',
    activeBorderClass: 'border-info-bg',
  },
  {
    id: 'reddit',
    name: 'Reddit',
    domainPattern: /reddit\.com/i,
    colorClass: 'text-[#FF4500]',
    hoverColorClass: 'group-hover:text-[#FF4500]',
    activeBgClass: 'bg-[#FF4500]/10',
    activeBorderClass: 'border-[#FF4500]/40',
  },
  {
    id: 'vimeo',
    name: 'Vimeo',
    domainPattern: /vimeo\.com/i,
    colorClass: 'text-[#1AB7EA]',
    hoverColorClass: 'group-hover:text-[#1AB7EA]',
    activeBgClass: 'bg-[#1AB7EA]/10',
    activeBorderClass: 'border-[#1AB7EA]/40',
  },
];

export function detectPlatform(url: string): SupportedPlatform {
  if (!url || typeof url !== 'string') return null;
  const lower = url.trim().toLowerCase();
  for (const plat of SUPPORTED_PLATFORMS) {
    if (plat.domainPattern.test(lower)) {
      return plat.id;
    }
  }
  return null;
}

// Crisp, lightweight inline SVGs for platforms
export function PlatformIcon({ platform, className = 'w-4 h-4' }: { platform: SupportedPlatform; className?: string }) {
  switch (platform) {
    case 'youtube':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.5 12 3.5 12 3.5s-7.505 0-9.377.55a3.016 3.016 0 0 0-2.122 2.136C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.55 9.376.55 9.376.55s7.505 0 9.377-.55a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      );
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
          <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
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
          <path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738.098.119.112.224.083.345-.09.375-.291 1.199-.332 1.357-.053.211-.174.268-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146 1.124.347 2.317.535 3.554.535 6.627 0 12-5.373 12-12 0-6.628-5.373-12-12-12z" />
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
  onFocusChange?: (focused: boolean) => void;
}

export default function HeroOmnibox({
  url,
  onUrlChange,
  onSubmit,
  probing,
  onFocusChange,
}: HeroOmniboxProps) {
  const [detectedPlatform, setDetectedPlatform] = useState<SupportedPlatform>(null);
  const [activePreset, setActivePreset] = useState<SmartPreset>('best');
  const [pastedFeedback, setPastedFeedback] = useState<boolean>(false);
  const [presetDropdownOpen, setPresetDropdownOpen] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Synchronize detected platform with URL changes
  useEffect(() => {
    setDetectedPlatform(detectPlatform(url));
  }, [url]);

  // Global Cmd/Ctrl+V listener
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

  // Handle Clipboard API Paste Click
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
    } catch {
      // Focus input if clipboard permission denied
    }
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
    if (trimmed) {
      onSubmit(trimmed, activePreset);
    }
  };

  const handleBadgeClick = (platformId: NonNullable<SupportedPlatform>) => {
    inputRef.current?.focus();
  };

  const presetLabels: Record<SmartPreset, string> = {
    best: 'Best (8K/4K)',
    '1080p': '1080p MP4',
    mp3: 'MP3 Audio',
    lossless: 'Lossless FLAC',
  };

  return (
    <div className="w-full space-y-4">
      {/* SSR-first Fixed Shell Container: Exactly min-h-[76px] to guarantee CLS = 0.00 */}
      <div
        ref={containerRef}
        className="w-full min-h-[76px] rounded-2xl bg-surface border border-line p-2 sm:p-2.5 shadow-card transition-colors duration-150 flex flex-col justify-center relative focus-within:border-brand-violet focus-within:ring-2 focus-within:ring-brand-violet/20"
      >
        <form onSubmit={handleSubmitForm} className="flex items-center gap-2 w-full">
          {/* Left: Platform badge or Link Icon */}
          <div className="flex items-center pl-1.5 shrink-0">
            {detectedPlatform ? (
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors duration-150 ${
                  SUPPORTED_PLATFORMS.find((p) => p.id === detectedPlatform)?.activeBgClass || 'bg-surface-elevated'
                } ${
                  SUPPORTED_PLATFORMS.find((p) => p.id === detectedPlatform)?.activeBorderClass || 'border-line'
                } ${
                  SUPPORTED_PLATFORMS.find((p) => p.id === detectedPlatform)?.colorClass || 'text-content'
                }`}
                title={`Detected platform: ${detectedPlatform}`}
              >
                <PlatformIcon platform={detectedPlatform} className="w-3.5 h-3.5 shrink-0" />
                <span className="capitalize hidden xs:inline">{detectedPlatform}</span>
              </span>
            ) : (
              <span className="p-1.5 text-content-secondary" aria-hidden="true">
                <Link2 className="w-4 h-4" />
              </span>
            )}
          </div>

          {/* Center Input */}
          <input
            ref={inputRef}
            type="text"
            inputMode="url"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            onFocus={() => onFocusChange?.(true)}
            onBlur={() => onFocusChange?.(false)}
            placeholder="Paste link from YouTube, Instagram, X, TikTok, Vimeo…"
            aria-label="Media URL input"
            className="flex-1 min-w-0 bg-transparent border-0 text-content placeholder:text-content-secondary text-sm sm:text-base font-sans focus:outline-none focus:ring-0 px-2 py-1 select-text"
          />

          {/* Right Action Cluster */}
          <div className="flex items-center gap-1.5 shrink-0 pr-1">
            {/* Clear Button */}
            {url.trim().length > 0 && (
              <button
                type="button"
                onClick={handleClear}
                aria-label="Clear URL input"
                title="Clear"
                className="p-1.5 rounded-lg text-content-secondary hover:text-content hover:bg-surface-elevated transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}

            {/* Smart Presets Toggle */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setPresetDropdownOpen((prev) => !prev)}
                aria-expanded={presetDropdownOpen}
                aria-label="Smart Presets"
                title="Choose processing preset"
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs font-medium text-content-secondary hover:text-content transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-brand-violet" aria-hidden="true" />
                <span className="text-[11px] font-semibold">{presetLabels[activePreset]}</span>
              </button>

              {presetDropdownOpen && (
                <div
                  role="menu"
                  aria-label="Smart Presets"
                  className="absolute right-0 mt-2 w-48 rounded-xl border border-line bg-surface shadow-lg p-1.5 z-50 text-xs"
                >
                  <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-content-secondary border-b border-line mb-1">
                    Quality Preset
                  </div>
                  {(['best', '1080p', 'mp3', 'lossless'] as SmartPreset[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setActivePreset(p);
                        setPresetDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors duration-150 ${
                        activePreset === p
                          ? 'bg-info-bg text-brand-violet font-semibold'
                          : 'text-content hover:bg-surface-elevated'
                      }`}
                    >
                      <span>{presetLabels[p]}</span>
                      {activePreset === p && <Check className="w-3.5 h-3.5 text-brand-violet" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Paste Button (Clipboard API) */}
            <button
              type="button"
              onClick={handlePasteClick}
              aria-label="Paste URL from clipboard"
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs font-medium text-content hover:border-brand-violet transition-colors duration-150 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet whitespace-nowrap"
            >
              {pastedFeedback ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" />
              ) : (
                <ClipboardPaste className="w-3.5 h-3.5 text-brand-violet" aria-hidden="true" />
              )}
              <span className="hidden xs:inline">{pastedFeedback ? 'Pasted!' : 'Paste'}</span>
            </button>

            {/* Primary Submit Button */}
            <button
              type="submit"
              disabled={probing || !url.trim()}
              aria-label={probing ? 'Analyzing media link' : 'Analyze media link'}
              className={`px-3.5 sm:px-5 py-2 min-h-[38px] sm:min-h-[40px] rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 whitespace-nowrap active:scale-[0.98] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface shadow-sm select-none ${
                url.trim() && !probing
                  ? 'bg-brand-violet hover:bg-brand-violet/90 text-white shadow-md shadow-brand-violet/25 cursor-pointer ring-1 ring-brand-violet/50'
                  : 'bg-surface-elevated text-content-secondary/60 border border-line cursor-not-allowed opacity-60'
              }`}
            >
              {probing ? (
                <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="w-4 h-4 text-amber-300 dark:text-amber-200" aria-hidden="true" />
              )}
              <span>{probing ? 'Analyzing…' : 'Analyze'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Sleek, Non-Clickable Informational Supported Platform Strip */}
      <div
        role="region"
        aria-label="Supported media platforms"
        className="w-full flex items-center justify-center py-1"
      >
        <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 text-xs max-w-full">
          <span className="text-[11px] font-medium text-content-secondary shrink-0 mr-1 select-none">
            Supported:
          </span>
          {SUPPORTED_PLATFORMS.map((platform) => {
            const isDetected = detectedPlatform === platform.id;
            return (
              <span
                key={platform.id}
                title={`${platform.name} supported (Lossless up to 8K)`}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors duration-150 select-none shrink-0 ${
                  isDetected
                    ? `${platform.activeBgClass} ${platform.activeBorderClass} ${platform.colorClass} font-semibold ring-1 ring-current shadow-xs`
                    : 'bg-surface border-line/60 text-content-secondary/70'
                }`}
              >
                <PlatformIcon
                  platform={platform.id}
                  className={`w-3 h-3 shrink-0 ${
                    isDetected ? platform.colorClass : 'text-content-secondary/60'
                  }`}
                />
                <span className="leading-none">{platform.name}</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
