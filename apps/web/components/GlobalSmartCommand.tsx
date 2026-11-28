'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Search,
  X,
  ArrowRight,
  Sparkles,
  FileVideo,
  Music,
  FileText,
  Link2,
} from 'lucide-react';
import { ALL_STUDIO_TOOLS } from '@/lib/tools-catalog';
import { getToolIcon, TOOL_ICON_TONE } from '@/lib/tool-icons';
import { useOpenedArtifact } from '@/lib/opened-artifact';
import { recordRecentTool } from '@/lib/recent-tools';

interface SmartSuggestion {
  href: string;
  label: string;
  note: string;
  domain?: 'video' | 'pdf' | 'audio' | 'image';
}

function getSmartSuggestionsForFile(file: File): SmartSuggestion[] {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf' || file.type === 'application/pdf') {
    return [
      { href: '/tools/pdf/view?handoff=1', label: 'Read and inspect PDF', note: 'High-DPI canvas viewer with text search', domain: 'pdf' as const },
      { href: '/tools/pdf/compress?handoff=1', label: 'Compress PDF locally', note: 'Lossless QPDF or balanced shrink (zero upload)', domain: 'pdf' as const },
      { href: '/tools/pdf/edit?handoff=1', label: 'Edit, sign, or redact PDF', note: 'Add text, shapes, signatures, or blackouts', domain: 'pdf' as const },
      { href: '/tools/pdf/ocr?handoff=1', label: 'Extract text or Searchable PDF (OCR)', note: 'Local multi-worker Tesseract OCR', domain: 'pdf' as const },
    ];
  }
  if (ext === 'docx') {
    return [
      { href: '/tools/pdf/word-to-pdf?handoff=1', label: 'Convert Word (.docx) to PDF', note: 'Preserves headings, styles, lists, and tables', domain: 'pdf' as const },
    ];
  }
  if (ext === 'pptx') {
    return [
      { href: '/tools/pdf/powerpoint-to-pdf?handoff=1', label: 'Convert PowerPoint (.pptx) to PDF', note: 'Native aspect ratio slide PDF', domain: 'pdf' as const },
    ];
  }
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
    return [
      { href: '/tools/pdf/image-to-pdf?handoff=1', label: 'Convert image to PDF', note: 'EXIF-aware photo to A4/Letter/Fit PDF', domain: 'pdf' as const },
    ];
  }
  const isAudio = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus'].includes(ext);
  if (isAudio) {
    return [
      { href: '/tools/audio-normalizer?handoff=1', label: 'Normalize loudness (-14 LUFS)', note: 'Consistent podcast or YouTube volume', domain: 'audio' as const },
      { href: '/tools/media-converter?handoff=1', label: 'Convert audio format', note: 'MP3, FLAC, WAV, AAC', domain: 'audio' as const },
      { href: '/tools/metadata-scrubber?handoff=1', label: 'Scrub audio metadata tags', note: 'Inspect codecs and remove ID3 privacy tags', domain: 'audio' as const },
    ];
  }
  return [
    { href: '/tools/video-compressor?handoff=1', label: 'Compress under 10 MB / 16 MB', note: '2-pass target size for Discord and WhatsApp', domain: 'video' as const },
    { href: '/tools/video-trimmer?handoff=1', label: 'Lossless trim or split 60s parts', note: 'Instant stream-copy cut or Reels ZIP splitter', domain: 'video' as const },
    { href: ext === 'mkv' ? '/tools/media-converter?handoff=1' : '/tools/aspect-ratio-pad?handoff=1', label: ext === 'mkv' ? 'Instant remux MKV to MP4 (1s)' : 'Reframe to 9:16 Reels / Shorts', note: ext === 'mkv' ? 'Stream copy without re-encoding' : 'Blur fill or center crop', domain: 'video' as const },
  ];
}

function getSmartSuggestionsForUrl(url: string): SmartSuggestion[] {
  const isPlaylist = /list=|\/playlist/i.test(url);
  if (isPlaylist) {
    return [
      { href: `/tools/playlist-batch`, label: 'Open Playlist and Batch ZIP Hub', note: 'Bundle up to 50 items into one archive' },
      { href: `/tools/transcript-extractor?url=${encodeURIComponent(url)}`, label: 'Extract clean AI transcript', note: 'Clean paragraphs or SRT/VTT' },
      { href: `/?url=${encodeURIComponent(url)}`, label: 'Inspect single video URL', note: 'Save up to 8K video or lossless audio' },
    ];
  }
  return [
    { href: `/?url=${encodeURIComponent(url)}`, label: 'Download video (up to 8K) or mute audio', note: 'Inspect all formats on Home Downloader' },
    { href: `/tools/video-trimmer?url=${encodeURIComponent(url)}`, label: 'Trim clip or split into 60s parts', note: 'Skip full edit and cut exact timestamps' },
    { href: `/tools/transcript-extractor?url=${encodeURIComponent(url)}`, label: 'Extract clean text / SRT captions', note: 'AI and Notion ready transcript' },
  ];
}

/**
 * Global Cmd/Ctrl + K Command Palette + Drop-Anywhere Smart Router.
 */
export default function GlobalSmartCommand({
  initialOpen = false,
  initialDragOver = false,
}: {
  initialOpen?: boolean;
  initialDragOver?: boolean;
}) {
  const router = useRouter();
  const { setArtifactFromFile } = useOpenedArtifact();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(initialOpen);
  const [query, setQuery] = useState('');
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [dragOverWindow, setDragOverWindow] = useState(initialDragOver);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
        setDragOverWindow(false);
      }
    };

    const onOpenCustom = (e: Event) => {
      const detail = (e as CustomEvent<{ query?: string }>).detail;
      if (detail && typeof detail.query === 'string') {
        setDroppedFile(null);
        setQuery(detail.query);
      }
      setOpen(true);
    };

    let dragCounter = 0;
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        dragCounter += 1;
        setDragOverWindow(true);
      }
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault();
      }
    };
    const onDragLeave = () => {
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) setDragOverWindow(false);
    };
    const onDrop = (e: DragEvent) => {
      dragCounter = 0;
      setDragOverWindow(false);
      const target = e.target as HTMLElement | null;
      if (target && target.closest('form, [data-dropzone], input[type="file"]')) {
        return;
      }
      const f = e.dataTransfer?.files?.[0];
      if (f) {
        e.preventDefault();
        setDroppedFile(f);
        setOpen(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('muxaro:open-command', onOpenCustom);
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('muxaro:open-command', onOpenCustom);
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const isUrlQuery = /^https?:\/\//i.test(query.trim());

  const smartActions = useMemo(() => {
    if (droppedFile) return getSmartSuggestionsForFile(droppedFile);
    if (isUrlQuery) return getSmartSuggestionsForUrl(query.trim());
    return [];
  }, [droppedFile, isUrlQuery, query]);

  const filteredTools = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || isUrlQuery) return ALL_STUDIO_TOOLS;
    return ALL_STUDIO_TOOLS.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.domain.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.keywords.some((k) => k.toLowerCase().includes(q))
    );
  }, [query, isUrlQuery]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, droppedFile]);

  const totalItems = smartActions.length + filteredTools.length;

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (totalItems === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % totalItems);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + totalItems) % totalItems);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex < smartActions.length) {
        const act = smartActions[activeIndex];
        if (droppedFile && act.domain) {
          setArtifactFromFile(droppedFile, act.domain, '/');
        }
        setOpen(false);
        router.push(act.href);
      } else {
        const tool = filteredTools[activeIndex - smartActions.length];
        if (tool) {
          recordRecentTool(tool.href);
          setOpen(false);
          router.push(tool.href);
        }
      }
    }
  };

  if (!open && !dragOverWindow) return null;

  return (
    <>
      {dragOverWindow && !open && (
        <div className="fixed inset-0 z-50 bg-base/90 backdrop-blur-md flex items-center justify-center p-6 pointer-events-none">
          <div className="max-w-md w-full p-8 rounded-2xl border-2 border-dashed border-brand bg-surface text-center space-y-2 shadow-xl">
            <Sparkles className="w-8 h-8 mx-auto text-brand" aria-hidden="true" />
            <div className="text-lg font-semibold text-content">Drop any file to route locally</div>
            <p className="text-xs text-content-secondary">
              MUXARO detects PDF, Word, PowerPoint, images, audio, and video automatically.
            </p>
          </div>
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-16 sm:pt-24 px-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="MUXARO Quick Tools and Smart Router"
        >
          <div
            className="w-full max-w-xl rounded-2xl border border-line bg-surface shadow-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
              <Search className="w-4 h-4 text-content-secondary shrink-0" aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (droppedFile) setDroppedFile(null);
                }}
                onKeyDown={handleInputKeyDown}
                placeholder={`Search ${ALL_STUDIO_TOOLS.length} Video and PDF tools, or paste any video URL…`}
                className="flex-1 bg-transparent text-sm text-content placeholder:text-content-secondary focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="px-2 py-0.5 rounded-md text-[11px] font-medium text-content-secondary hover:text-content bg-surface-elevated"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 rounded-lg text-content-secondary hover:text-content hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                aria-label="Close command palette"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-[65vh] overflow-y-auto p-3 space-y-4">
              {query.trim().length > 0 && !isUrlQuery && (
                <button
                  type="button"
                  onClick={() => {
                    const q = query.trim();
                    setOpen(false);
                    router.push(`/ai?prompt=${encodeURIComponent(q)}`);
                  }}
                  className="w-full p-2.5 rounded-xl text-left flex items-center justify-between gap-3 bg-brand/10 border border-brand/25 text-content hover:bg-brand/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Sparkles className="w-4 h-4 text-brand shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">Ask MUXARO AI: {query.trim()}</div>
                      <div className="text-[11px] text-content-secondary">Open AI Studio with autonomous tools &amp; Python sandbox</div>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-brand shrink-0" aria-hidden="true" />
                </button>
              )}

              {smartActions.length > 0 && (
                <div className="space-y-1.5">
                  <div className="px-2 flex items-center justify-between text-[11px] font-semibold text-content-secondary">
                    <span className="inline-flex items-center gap-1.5">
                      {droppedFile ? (
                        droppedFile.type === 'application/pdf' || droppedFile.name.toLowerCase().endsWith('.pdf') ? (
                          <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                        ) : droppedFile.type.startsWith('audio/') ? (
                          <Music className="w-3.5 h-3.5" aria-hidden="true" />
                        ) : (
                          <FileVideo className="w-3.5 h-3.5" aria-hidden="true" />
                        )
                      ) : (
                        <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                      <span>
                        {droppedFile
                          ? `Smart actions for ${droppedFile.name}`
                          : 'Recommended actions for pasted URL'}
                      </span>
                    </span>
                  </div>
                  <div className="space-y-1">
                    {smartActions.map((act, idx) => (
                      <button
                        key={act.href}
                        type="button"
                        onClick={() => {
                          if (droppedFile && act.domain) {
                            setArtifactFromFile(droppedFile, act.domain, '/');
                          }
                          setOpen(false);
                          router.push(act.href);
                        }}
                        className={`w-full p-2.5 rounded-xl text-left flex items-center justify-between gap-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                          activeIndex === idx
                            ? 'bg-brand text-brand-fg'
                            : 'bg-surface-elevated text-content hover:bg-interactive'
                        }`}
                      >
                        <div>
                          <div className="text-xs font-semibold">{act.label}</div>
                          <div className="text-[11px] opacity-80">{act.note}</div>
                        </div>
                        <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <div className="px-2 text-[11px] font-semibold text-content-secondary">
                  Studio tools ({filteredTools.length})
                </div>
                {filteredTools.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-content-secondary">
                    No matching tools found. Try a shorter keyword.
                  </div>
                ) : (
                  filteredTools.map((tool, idx) => {
                    const globalIdx = smartActions.length + idx;
                    const Icon = getToolIcon(tool.href);
                    const isFocused = activeIndex === globalIdx;
                    return (
                      <Link
                        key={tool.href}
                        href={tool.href}
                        onClick={() => {
                          recordRecentTool(tool.href);
                          setOpen(false);
                        }}
                        className={`flex items-center justify-between gap-3 px-3 py-2 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                          isFocused ? 'bg-surface-elevated ring-1 ring-line-hover' : 'hover:bg-surface-elevated'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${TOOL_ICON_TONE[tool.accentKind]}`}
                          >
                            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-content truncate">{tool.title}</div>
                            <div className="text-[11px] text-content-secondary truncate">{tool.description}</div>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-elevated border border-line text-content-secondary shrink-0">
                          {tool.domain === 'pdf' ? 'Local PDF' : tool.tag}
                        </span>
                      </Link>
                    );
                  })
                )}
              </div>
            </div>

            <div className="px-4 py-2 border-t border-line bg-surface-elevated/60 flex items-center justify-between text-[11px] text-content-secondary">
              <span>Drop any file anywhere to route automatically</span>
              <span className="font-mono">Arrows, Enter, Ctrl/Cmd+K, Esc</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
