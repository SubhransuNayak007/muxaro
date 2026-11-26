'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Cpu,
  Cloud,
  Search,
  LayoutGrid,
  List,
  ShieldCheck,
  Clock,
} from 'lucide-react';
import {
  ALL_STUDIO_TOOLS,
  CREATOR_TOOLS_CATALOG,
  PDF_TOOLS_CATALOG,
  type StudioToolMeta,
} from '@/lib/tools-catalog';
import { getToolIcon, TOOL_ICON_TONE } from '@/lib/tool-icons';
import { getRecentToolHrefs, recordRecentTool } from '@/lib/recent-tools';
import { useWorkspacePrefs } from '@/lib/workspace-prefs';

type DomainTab = 'featured' | 'video' | 'pdf';

const FEATURED_HREFS = [
  '/tools/video-compressor',
  '/tools/video-trimmer',
  '/tools/media-converter',
  '/tools/audio-extractor',
  '/tools/pdf/compress',
  '/tools/pdf/edit',
  '/tools/pdf/ocr',
  '/tools/pdf/compare',
  '/tools/pdf/verify-signatures',
];

export default function HomeToolsDirectory() {
  const { prefs, updatePrefs } = useWorkspacePrefs();
  const [tab, setTab] = useState<DomainTab>('featured');
  const [query, setQuery] = useState('');
  const [recentHrefs, setRecentHrefs] = useState<string[]>([]);

  useEffect(() => {
    setRecentHrefs(getRecentToolHrefs());
  }, []);

  const recentTools = useMemo(() => {
    return recentHrefs
      .map((href) => ALL_STUDIO_TOOLS.find((t) => t.href === href))
      .filter((t): t is StudioToolMeta => Boolean(t))
      .slice(0, 4);
  }, [recentHrefs]);

  const visibleTools = useMemo(() => {
    const q = query.trim().toLowerCase();
    const basePool =
      q.length > 0
        ? ALL_STUDIO_TOOLS
        : tab === 'video'
        ? CREATOR_TOOLS_CATALOG
        : tab === 'pdf'
        ? PDF_TOOLS_CATALOG.slice(0, 12)
        : FEATURED_HREFS.map((href) => ALL_STUDIO_TOOLS.find((t) => t.href === href)).filter(
            (t): t is StudioToolMeta => Boolean(t)
          );

    if (!q) return basePool;
    return basePool.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.keywords.some((k) => k.includes(q))
    );
  }, [tab, query]);

  return (
    <section
      className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-16 border-t border-line space-y-8"
      aria-labelledby="directory-heading"
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1.5">
          <h2
            id="directory-heading"
            className="text-3xl sm:text-4xl font-display font-medium text-content tracking-[-0.02em]"
          >
            Jump straight to a tool
          </h2>
          <p className="text-sm text-content-secondary">
            Filter by suite, switch to compact list density, or search all {ALL_STUDIO_TOOLS.length} utilities.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-line bg-surface text-xs text-content-secondary">
            <ShieldCheck className="w-3.5 h-3.5 text-success shrink-0" aria-hidden="true" />
            <span>Local WASM tools upload 0 bytes</span>
          </span>
          <Link
            href="/tools"
            className="text-xs font-semibold text-brand hover:text-brand-hover inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded"
          >
            <span>Open full {ALL_STUDIO_TOOLS.length}-tool directory</span>
            <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>

      {/* Recently Used Row (only when user has history) */}
      {recentTools.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pb-1">
          <span className="inline-flex items-center gap-1.5 text-xs text-content-secondary mr-1">
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Recent:</span>
          </span>
          {recentTools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="px-3 py-1 rounded-full border border-line bg-surface hover:border-line-hover text-xs font-medium text-content transition-colors"
            >
              {tool.title}
            </Link>
          ))}
        </div>
      )}

      {/* Launcher Control Bar: Suite Tabs + Search + Card/Compact Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Filter homepage tools"
          className="inline-flex items-center gap-1 p-1 rounded-xl border border-line bg-surface-elevated"
        >
          {[
            { id: 'featured' as const, label: 'Featured' },
            { id: 'video' as const, label: `Video (${CREATOR_TOOLS_CATALOG.length})` },
            { id: 'pdf' as const, label: `PDF (${PDF_TOOLS_CATALOG.length})` },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tab === item.id
                  ? 'bg-surface text-content font-semibold shadow-sm'
                  : 'text-content-secondary hover:text-content'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-1 sm:flex-initial justify-end">
          <div className="relative w-full sm:w-64">
            <Search
              className="w-3.5 h-3.5 text-content-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${ALL_STUDIO_TOOLS.length} tools…`}
              aria-label="Filter tools by keyword"
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-line bg-surface text-xs text-content placeholder:text-content-secondary"
            />
          </div>

          <div
            role="group"
            aria-label="View density"
            className="inline-flex items-center p-1 rounded-xl border border-line bg-surface-elevated shrink-0"
          >
            <button
              type="button"
              onClick={() => updatePrefs({ viewMode: 'cards' })}
              aria-pressed={prefs.viewMode === 'cards'}
              aria-label="Card grid view"
              className={`p-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                prefs.viewMode === 'cards' ? 'bg-surface text-content' : 'text-content-secondary hover:text-content'
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
                prefs.viewMode === 'compact' ? 'bg-surface text-content' : 'text-content-secondary hover:text-content'
              }`}
            >
              <List className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {visibleTools.length === 0 ? (
        <div className="p-8 rounded-2xl border border-line bg-surface text-center space-y-2">
          <p className="text-sm font-medium text-content">No matching tools found.</p>
          <button
            type="button"
            onClick={() => setQuery('')}
            className="text-xs font-semibold text-brand hover:underline"
          >
            Clear search
          </button>
        </div>
      ) : prefs.viewMode === 'compact' ? (
        <div className="rounded-2xl border border-line bg-surface divide-y divide-line overflow-hidden">
          {visibleTools.map((tool) => {
            const Icon = getToolIcon(tool.href);
            const isLocal = tool.tierBadge === 'Local Instant' || tool.domain === 'pdf';
            return (
              <Link
                key={tool.href}
                href={tool.href}
                onClick={() => recordRecentTool(tool.href)}
                className="px-4 py-3 flex items-center justify-between gap-4 hover:bg-surface-elevated/60 transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                <div className="min-w-0 flex items-center gap-3">
                  <span
                    className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${TOOL_ICON_TONE[tool.accentKind]}`}
                  >
                    <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  </span>
                  <span className="text-sm font-semibold text-content group-hover:text-brand truncate">
                    {tool.title}
                  </span>
                  <span className="hidden md:inline text-xs text-content-secondary truncate">
                    {tool.description}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="inline-flex items-center gap-1 text-[11px] font-mono text-content-secondary">
                    {isLocal ? (
                      <Cpu className="w-3 h-3 text-success" aria-hidden="true" />
                    ) : (
                      <Cloud className="w-3 h-3" aria-hidden="true" />
                    )}
                    <span>{tool.domain === 'pdf' ? 'Browser Local' : tool.tierBadge}</span>
                  </span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-content-tertiary group-hover:text-brand" aria-hidden="true" />
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleTools.map((tool) => {
            const Icon = getToolIcon(tool.href);
            const isLocal = tool.tierBadge === 'Local Instant' || tool.domain === 'pdf';
            return (
              <Link
                key={tool.href}
                href={tool.href}
                onClick={() => recordRecentTool(tool.href)}
                className="p-5 rounded-2xl liquid-glass spring-bounce flex flex-col justify-between gap-4 group min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${TOOL_ICON_TONE[tool.accentKind]}`}
                      >
                        <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                      </span>
                      <span className="text-xs font-medium text-content-secondary truncate">
                        {tool.category}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-content-tertiary shrink-0">
                      {tool.tag}
                    </span>
                  </div>
                  <h3 className="text-base font-semibold text-content group-hover:text-brand transition-colors">
                    {tool.title}
                  </h3>
                  <p className="text-xs text-content-secondary leading-relaxed line-clamp-2">
                    {tool.description}
                  </p>
                </div>

                <div className="pt-3 border-t border-line-subtle flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-content-secondary">
                    {isLocal ? (
                      <Cpu className="w-3.5 h-3.5 text-success shrink-0" aria-hidden="true" />
                    ) : (
                      <Cloud className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    )}
                    <span>{tool.domain === 'pdf' ? 'Browser Local' : tool.tierBadge}</span>
                  </span>
                  <ArrowUpRight
                    className="w-4 h-4 text-content-tertiary group-hover:text-brand shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    aria-hidden="true"
                  />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Clean Execution Architecture Spec Table */}
      <div className="pt-4 overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs sm:text-sm border-y border-line">
          <caption className="sr-only">
            Comparison between Browser Local WebAssembly execution and Cloud FFmpeg 8 workers
          </caption>
          <thead>
            <tr className="border-b border-line text-content-secondary">
              <th scope="col" className="py-3 pr-4 font-medium">Execution tier</th>
              <th scope="col" className="py-3 px-4 font-medium">Upload behavior</th>
              <th scope="col" className="py-3 px-4 font-medium">Supported suites</th>
              <th scope="col" className="py-3 pl-4 font-medium text-right">Retention &amp; access</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            <tr>
              <th scope="row" className="py-3.5 pr-4 font-semibold text-content">
                Browser Local (WASM / QPDF)
              </th>
              <td className="py-3.5 px-4 text-content-secondary">0 bytes uploaded</td>
              <td className="py-3.5 px-4 text-content-secondary">All 38 PDF tools plus Tier-1 Video/Audio</td>
              <td className="py-3.5 pl-4 font-mono text-success text-right">Instant and unlimited</td>
            </tr>
            <tr>
              <th scope="row" className="py-3.5 pr-4 font-semibold text-content">
                Cloud FFmpeg 8 Worker
              </th>
              <td className="py-3.5 px-4 text-content-secondary">Resumable chunked transfer</td>
              <td className="py-3.5 px-4 text-content-secondary">8K URLs, 2-pass compression, heavy encodes</td>
              <td className="py-3.5 pl-4 font-mono text-content text-right">Auto-purged in 60 min</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
