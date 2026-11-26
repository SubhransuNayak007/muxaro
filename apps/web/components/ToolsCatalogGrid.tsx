'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  RefreshCw,
  ArrowUpRight,
  Cpu,
  Cloud,
  Search,
  History,
  LayoutGrid,
  List,
  Pin,
  Clock,
  Sliders,
  Maximize2,
  Minimize2,
  ShieldCheck,
} from 'lucide-react';
import {
  ALL_STUDIO_TOOLS,
  CREATOR_TOOLS_CATALOG,
  PDF_TOOLS_CATALOG,
  UPCOMING_AUDIO_MODULES,
  type StudioToolMeta,
} from '@/lib/tools-catalog';
import { getToolIcon, TOOL_ICON_TONE } from '@/lib/tool-icons';
import {
  getPinnedToolHrefs,
  getRecentToolHrefs,
  recordRecentTool,
  togglePinnedTool,
} from '@/lib/recent-tools';
import { useWorkspacePrefs } from '@/lib/workspace-prefs';

type SectionFilter = 'all' | 'video' | 'pdf' | 'audio';

const VIDEO_CATEGORIES = ['All', 'Core', 'Compress & Trim', 'Creator & Audio', 'Inspect & Batch'] as const;
const PDF_CATEGORIES = ['All', 'Create', 'Edit', 'Optimize', 'Convert', 'Secure'] as const;

export default function ToolsCatalogGrid({
  initialSection = 'all',
}: {
  initialSection?: SectionFilter;
}) {
  const { prefs, updatePrefs } = useWorkspacePrefs();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [section, setSection] = useState<SectionFilter>(initialSection);
  const [category, setCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [localOnly, setLocalOnly] = useState<boolean>(false);
  const [recentHrefs, setRecentHrefs] = useState<string[]>([]);
  const [pinnedHrefs, setPinnedHrefs] = useState<string[]>([]);

  useEffect(() => {
    setRecentHrefs(getRecentToolHrefs());
    setPinnedHrefs(getPinnedToolHrefs());
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const sec = sp.get('section');
    if (sec === 'video' || sec === 'pdf' || sec === 'audio' || sec === 'all') {
      setSection(sec);
      setCategory('All');
    }
  }, []);

  // Super ToolKit / BentoPDF style keyboard shortcuts: '/' focuses search, Alt+W toggles full width
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (e.key === '/' && !isInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
        });
      } else if (e.altKey && e.key.toLowerCase() === 'w' && !isInput) {
        e.preventDefault();
        updatePrefs((prev) => ({ ...prev, fullWidth: !prev.fullWidth }));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [updatePrefs]);

  const availableCategories = useMemo(() => {
    if (section === 'video') return [...VIDEO_CATEGORIES];
    if (section === 'pdf') return [...PDF_CATEGORIES];
    return ['All'];
  }, [section]);

  const filterList = (list: StudioToolMeta[]) => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = list.filter((tool) => {
      if (category !== 'All' && tool.category !== category) return false;
      if (localOnly && tool.tierBadge !== 'Local Instant' && tool.tierBadge !== 'Hybrid') {
        return false;
      }
      if (q) {
        const hit =
          tool.title.toLowerCase().includes(q) ||
          tool.description.toLowerCase().includes(q) ||
          tool.category.toLowerCase().includes(q) ||
          tool.keywords.some((k) => k.toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
    if (prefs.sortMode === 'az') {
      return [...filtered].sort((a, b) => a.title.localeCompare(b.title));
    }
    return filtered;
  };

  const videoTools = useMemo(
    () => (section === 'pdf' || section === 'audio' ? [] : filterList(CREATOR_TOOLS_CATALOG)),
    [section, category, localOnly, searchQuery, prefs.sortMode] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const pdfTools = useMemo(
    () => (section === 'video' || section === 'audio' ? [] : filterList(PDF_TOOLS_CATALOG)),
    [section, category, localOnly, searchQuery, prefs.sortMode] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const audioActiveTools = useMemo(
    () =>
      section === 'audio'
        ? filterList(CREATOR_TOOLS_CATALOG.filter((t) => Boolean(t.audioCapable)))
        : [],
    [section, localOnly, searchQuery, prefs.sortMode] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const quickAccessTools = useMemo(() => {
    const combined = [...new Set([...pinnedHrefs, ...recentHrefs])];
    return combined
      .map((href) => ALL_STUDIO_TOOLS.find((t) => t.href === href))
      .filter((t): t is StudioToolMeta => Boolean(t))
      .slice(0, 6);
  }, [pinnedHrefs, recentHrefs]);

  const handleTogglePin = (e: React.MouseEvent, href: string) => {
    e.preventDefault();
    e.stopPropagation();
    setPinnedHrefs(togglePinnedTool(href));
  };

  const renderToolRow = (tool: StudioToolMeta) => {
    const Icon = getToolIcon(tool.href) || RefreshCw;
    const isLocal = tool.tierBadge === 'Local Instant' || tool.domain === 'pdf';
    const isPinned = pinnedHrefs.includes(tool.href);

    return (
      <Link
        key={tool.href}
        href={tool.href}
        onClick={() => recordRecentTool(tool.href)}
        className="px-4 py-3 flex items-center justify-between gap-4 hover:bg-surface-elevated/60 transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${TOOL_ICON_TONE[tool.accentKind]}`}
          >
            <Icon className="w-4 h-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-content group-hover:text-brand truncate">
                {tool.title}
              </span>
              {tool.beta && (
                <span className="px-1.5 py-0.5 rounded bg-surface-elevated border border-line text-[10px] font-medium text-content-secondary">
                  Beta
                </span>
              )}
            </div>
            <p className="text-xs text-content-secondary truncate">{tool.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="hidden sm:inline font-mono text-[11px] text-content-tertiary">
            {tool.tag}
          </span>
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-content-secondary">
            {isLocal ? (
              <Cpu className="w-3 h-3 text-success" aria-hidden="true" />
            ) : (
              <Cloud className="w-3 h-3" aria-hidden="true" />
            )}
            <span className="hidden md:inline">{tool.domain === 'pdf' ? 'Browser Local' : tool.tierBadge}</span>
          </span>
          <button
            type="button"
            onClick={(e) => handleTogglePin(e, tool.href)}
            aria-label={isPinned ? `Unpin ${tool.title}` : `Pin ${tool.title}`}
            className={`p-1 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
              isPinned ? 'text-brand' : 'text-content-tertiary hover:text-content'
            }`}
          >
            <Pin className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <ArrowUpRight className="w-4 h-4 text-content-tertiary group-hover:text-brand" aria-hidden="true" />
        </div>
      </Link>
    );
  };

  const renderCard = (tool: StudioToolMeta, idx: number, totalInGroup: number) => {
    const Icon = getToolIcon(tool.href) || RefreshCw;
    const isLocal = tool.tierBadge === 'Local Instant' || tool.domain === 'pdf';
    const isPinned = pinnedHrefs.includes(tool.href);
    const featuredSpan =
      tool.domain === 'video' && totalInGroup === 14 && idx === 0 && prefs.sortMode === 'category'
        ? 'lg:col-span-2'
        : '';

    return (
      <Link
        key={tool.href}
        href={tool.href}
        onClick={() => recordRecentTool(tool.href)}
        className={`${featuredSpan} rounded-2xl border border-line bg-surface hover:border-line-hover p-5 flex flex-col justify-between group transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus`}
      >
        <div>
          <div className="flex items-center justify-between gap-3 mb-3.5">
            <div
              className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${TOOL_ICON_TONE[tool.accentKind]}`}
            >
              <Icon className="w-4 h-4" aria-hidden={true} />
            </div>
            <div className="flex items-center gap-1.5">
              {tool.beta && (
                <span className="px-2 py-0.5 rounded-full bg-surface-elevated border border-line text-[10px] font-semibold text-content-secondary">
                  Beta
                </span>
              )}
              <span className="px-2.5 py-0.5 rounded-lg border border-line bg-surface-elevated text-[11px] font-medium text-content-secondary">
                {tool.tag}
              </span>
              <button
                type="button"
                onClick={(e) => handleTogglePin(e, tool.href)}
                aria-label={isPinned ? `Unpin ${tool.title}` : `Pin ${tool.title}`}
                className={`p-1 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                  isPinned ? 'text-brand' : 'text-content-tertiary hover:text-content'
                }`}
              >
                <Pin className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
          <h3 className="text-base font-semibold text-content mb-1.5 group-hover:text-brand transition-colors">
            {tool.title}
          </h3>
          <p className="text-xs text-content-secondary leading-relaxed mb-4">
            {tool.description}
          </p>
        </div>

        <div className="pt-3.5 border-t border-line-subtle flex items-center justify-between text-xs font-semibold text-content">
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-content-secondary">
            {isLocal ? (
              <Cpu className="w-3.5 h-3.5 text-success shrink-0" aria-hidden="true" />
            ) : (
              <Cloud className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            )}
            <span>{tool.domain === 'pdf' ? 'Browser Local' : tool.tierBadge}</span>
          </span>
          <span className="inline-flex items-center gap-1 text-brand">
            <span>Open</span>
            <ArrowUpRight
              className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform"
              aria-hidden="true"
            />
          </span>
        </div>
      </Link>
    );
  };

  return (
    <div className={`space-y-8 ${prefs.fullWidth ? 'w-full' : ''}`}>
      {/* Local Execution Architecture Strip (Super ToolKit inspired, factual stages) */}
      <div className="p-4 rounded-2xl border border-line bg-surface flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 text-xs">
          <ShieldCheck className="w-4 h-4 text-success shrink-0" aria-hidden="true" />
          <span className="font-semibold text-content">0 Bytes Uploaded for Local Tools</span>
          <span className="hidden md:inline text-content-secondary">
            Browser PDF and Tier-1 media engines run directly in local memory.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-content-secondary">
          <span className="px-2 py-0.5 rounded-md bg-surface-elevated border border-line">File.arrayBuffer()</span>
          <span aria-hidden="true">-&gt;</span>
          <span className="px-2 py-0.5 rounded-md bg-surface-elevated border border-line">WASM Heap</span>
          <span aria-hidden="true">-&gt;</span>
          <span className="px-2 py-0.5 rounded-md bg-surface-elevated border border-line">Blob Export</span>
        </div>
      </div>

      {/* Recently Used / Pinned Quick Access Row */}
      {quickAccessTools.length > 0 && (
        <div className="p-4 rounded-2xl border border-line bg-surface flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-content-secondary mr-1">
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Pinned and recent:</span>
            </span>
            {quickAccessTools.map((tool) => (
              <Link
                key={tool.href}
                href={tool.href}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-line bg-surface-elevated hover:border-line-hover text-xs font-medium text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                {pinnedHrefs.includes(tool.href) && (
                  <Pin className="w-3 h-3 text-brand" aria-hidden="true" />
                )}
                <span>{tool.title}</span>
              </Link>
            ))}
          </div>
          <span className="text-[11px] font-mono text-content-tertiary">
            Local memory only
          </span>
        </div>
      )}

      {/* Top Suite Switcher + Search (/) + View, Sort & Full-Width Controls */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Switch tool suite"
            className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-surface border border-line"
          >
            {[
              { id: 'all' as const, label: `All (${ALL_STUDIO_TOOLS.length})` },
              { id: 'video' as const, label: `Video (${CREATOR_TOOLS_CATALOG.length})` },
              { id: 'pdf' as const, label: `PDF (${PDF_TOOLS_CATALOG.length})` },
              { id: 'audio' as const, label: 'Audio (Roadmap)' },
            ].map((tab) => {
              const active = section === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setSection(tab.id);
                    setCategory('All');
                  }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                    active
                      ? 'bg-brand text-brand-fg'
                      : 'text-content-secondary hover:text-content'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto lg:flex-1 justify-end">
            <div className="relative w-full sm:w-64">
              <Search
                className="w-3.5 h-3.5 text-content-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search ${ALL_STUDIO_TOOLS.length} tools…`}
                aria-label="Search tools"
                className="w-full pl-8 pr-12 py-1.5 rounded-xl border border-line bg-surface text-xs text-content placeholder:text-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded bg-surface-elevated text-[10px] font-medium text-content-secondary hover:text-content"
                >
                  Clear
                </button>
              ) : (
                <kbd
                  aria-hidden="true"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded bg-surface-elevated border border-line font-mono text-[10px] text-content-tertiary pointer-events-none"
                >
                  /
                </kbd>
              )}
            </div>

            <button
              type="button"
              onClick={() => setLocalOnly((v) => !v)}
              aria-pressed={localOnly}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                localOnly
                  ? 'bg-brand/12 border-brand/35 text-brand'
                  : 'bg-surface border-line text-content-secondary hover:text-content'
              }`}
            >
              <Cpu className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Local and hybrid</span>
            </button>

            <button
              type="button"
              onClick={() =>
                updatePrefs((prev) => ({
                  ...prev,
                  sortMode: prev.sortMode === 'category' ? 'az' : 'category',
                }))
              }
              aria-pressed={prefs.sortMode === 'az'}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                prefs.sortMode === 'az'
                  ? 'bg-brand/12 border-brand/35 text-brand'
                  : 'bg-surface border-line text-content-secondary hover:text-content'
              }`}
            >
              <span>{prefs.sortMode === 'az' ? 'A to Z' : 'By category'}</span>
            </button>

            <button
              type="button"
              onClick={() => updatePrefs((prev) => ({ ...prev, fullWidth: !prev.fullWidth }))}
              aria-pressed={prefs.fullWidth}
              title="Toggle full-width mode (Alt+W)"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                prefs.fullWidth
                  ? 'bg-brand/12 border-brand/35 text-brand'
                  : 'bg-surface border-line text-content-secondary hover:text-content'
              }`}
            >
              {prefs.fullWidth ? (
                <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>

            <div
              role="group"
              aria-label="Layout density"
              className="inline-flex items-center p-0.5 rounded-xl border border-line bg-surface"
            >
              <button
                type="button"
                onClick={() => updatePrefs({ viewMode: 'cards' })}
                aria-pressed={prefs.viewMode === 'cards'}
                aria-label="Bento card grid"
                className={`p-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                  prefs.viewMode === 'cards' ? 'bg-surface-elevated text-content' : 'text-content-secondary hover:text-content'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => updatePrefs({ viewMode: 'compact' })}
                aria-pressed={prefs.viewMode === 'compact'}
                aria-label="Compact list view"
                className={`p-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                  prefs.viewMode === 'compact' ? 'bg-surface-elevated text-content' : 'text-content-secondary hover:text-content'
                }`}
              >
                <List className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        {/* Category Pills */}
        {availableCategories.length > 1 && (
          <div
            role="tablist"
            aria-label="Filter by category"
            className="flex flex-wrap items-center gap-1.5"
          >
            {availableCategories.map((cat) => {
              const active = category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setCategory(cat)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                    active
                      ? 'bg-brand/12 border-brand/35 text-brand font-semibold'
                      : 'bg-surface border-line text-content-secondary hover:text-content'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Video Section */}
      {videoTools.length > 0 && (
        <section id="video-section" aria-labelledby="video-section-heading" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2 pb-3 border-b border-line">
            <div>
              <h2 id="video-section-heading" className="text-2xl font-display font-medium text-content tracking-[-0.02em]">
                Video and Audio Studio ({videoTools.length})
              </h2>
              <p className="text-xs sm:text-sm text-content-secondary mt-0.5">
                Hybrid FFmpeg WebAssembly and Cloud FFmpeg 8 tools with zero-reupload chaining.
              </p>
            </div>
            {section === 'all' && (
              <button
                type="button"
                onClick={() => {
                  setSection('video');
                  setCategory('All');
                }}
                className="text-xs font-semibold text-brand hover:underline whitespace-nowrap"
              >
                Filter Video only
              </button>
            )}
          </div>

          {prefs.viewMode === 'compact' ? (
            <div className="rounded-2xl border border-line bg-surface divide-y divide-line overflow-hidden">
              {videoTools.map((tool) => renderToolRow(tool))}
            </div>
          ) : (
            <div className="muxaro-stage-enter grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {videoTools.map((tool, idx) => renderCard(tool, idx, videoTools.length))}
            </div>
          )}
        </section>
      )}

      {/* PDF Section */}
      {pdfTools.length > 0 && (
        <section id="pdf-section" aria-labelledby="pdf-section-heading" className="space-y-4 pt-2">
          <div className="flex flex-wrap items-end justify-between gap-2 pb-3 border-b border-line">
            <div>
              <h2 id="pdf-section-heading" className="text-2xl font-display font-medium text-content tracking-[-0.02em]">
                PDF Studio ({pdfTools.length})
              </h2>
              <p className="text-xs sm:text-sm text-content-secondary mt-0.5">
                Browser-local PDF creation, editing, QPDF compression and encryption, OCR, comparison, and verification.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/tools/pdf/recent"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-content-secondary hover:text-content whitespace-nowrap"
              >
                <History className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Local History</span>
              </Link>
              <Link
                href="/tools/pdf"
                className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline whitespace-nowrap"
              >
                <span>Open PDF Studio</span>
                <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
            </div>
          </div>

          {prefs.viewMode === 'compact' ? (
            <div className="rounded-2xl border border-line bg-surface divide-y divide-line overflow-hidden">
              {pdfTools.map((tool) => renderToolRow(tool))}
            </div>
          ) : (
            <div className="muxaro-stage-enter grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {pdfTools.map((tool, idx) => renderCard(tool, idx, pdfTools.length))}
            </div>
          )}
        </section>
      )}

      {/* Audio Studio (Active Audio Tools + Upcoming Roadmap) */}
      {section === 'audio' && (
        <section id="audio-section" aria-labelledby="audio-section-heading" className="space-y-8">
          <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-2 pb-3 border-b border-line">
              <div>
                <h2 id="audio-section-heading" className="text-2xl font-display font-medium text-content tracking-[-0.02em]">
                  Available Audio Tools ({audioActiveTools.length})
                </h2>
                <p className="text-xs sm:text-sm text-content-secondary mt-0.5">
                  Ready today for extraction, EBU R128 loudness normalization, format conversion, A/V sync, and metadata scrubbing.
                </p>
              </div>
              <Link
                href="/docs/audio-studio"
                className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline whitespace-nowrap"
              >
                <span>Audio Studio architecture</span>
                <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
            </div>

            {prefs.viewMode === 'compact' ? (
              <div className="rounded-2xl border border-line bg-surface divide-y divide-line overflow-hidden">
                {audioActiveTools.map((tool) => renderToolRow(tool))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {audioActiveTools.map((tool, idx) => renderCard(tool, idx, audioActiveTools.length))}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="pb-3 border-b border-line flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-content">
                  Upcoming Audio Studio Modules ({UPCOMING_AUDIO_MODULES.length})
                </h3>
                <p className="text-xs text-content-secondary mt-0.5">
                  In active planning for the next dedicated Audio Suite release.
                </p>
              </div>
              <span role="status" className="px-2.5 py-1 rounded-full border border-line bg-surface text-xs font-medium text-content-secondary">
                Roadmap
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {UPCOMING_AUDIO_MODULES.map((mod) => (
                <div
                  key={mod.id}
                  className="p-5 rounded-2xl border border-line bg-surface-elevated/60 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-content-secondary">
                      <Sliders className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{mod.category}</span>
                    </span>
                    <span className="px-2 py-0.5 rounded-full border border-line bg-surface text-[11px] font-mono text-content-secondary">
                      {mod.tag}
                    </span>
                  </div>
                  <h4 className="text-base font-semibold text-content">{mod.title}</h4>
                  <p className="text-xs text-content-secondary leading-relaxed">{mod.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {section !== 'audio' && videoTools.length === 0 && pdfTools.length === 0 && (
        <div className="p-10 rounded-2xl border border-line bg-surface text-center space-y-3">
          <p className="text-sm font-semibold text-content">No tools matched your search</p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setCategory('All');
              setLocalOnly(false);
            }}
            className="px-4 py-2 rounded-xl border border-line bg-surface-elevated text-xs font-semibold text-content hover:border-line-hover"
          >
            Reset filters
          </button>
        </div>
      )}
    </div>
  );
}
