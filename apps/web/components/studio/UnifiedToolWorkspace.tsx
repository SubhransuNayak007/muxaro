'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  FileText,
  Film,
  History,
  Maximize2,
  Minimize2,
  Music,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Search,
  ShieldCheck,
  X,
  Zap,
  Cloud,
} from 'lucide-react';
import {
  ALL_STUDIO_TOOLS,
  CREATOR_TOOLS_CATALOG,
  PDF_TOOLS_CATALOG,
  type StudioToolMeta,
} from '@/lib/tools-catalog';
import { getToolIcon, TOOL_ICON_TONE } from '@/lib/tool-icons';
import { formatBytes } from '@/lib/formatters';
import { isCapacitorApp, isDesktopApp, isNativeAppRuntime } from '@/lib/native-bridge';
import { useOpenedArtifact, type OpenedArtifact } from '@/lib/opened-artifact';
import {
  getPinnedToolHrefs,
  getRecentToolHrefs,
  recordRecentTool,
  togglePinnedTool,
} from '@/lib/recent-tools';
import { useWorkspacePrefs } from '@/lib/workspace-prefs';

export interface UnifiedToolWorkspaceProps {
  suite: 'pdf' | 'video';
  currentHref: string;
  title: string;
  description: string;
  backHref: string;
  backLabel: string;
  historyHref?: string;
  historyLabel?: string;
  badgeText?: string;
  statusLabel: string;
  statusTone?: 'local' | 'hybrid' | 'cloud';
  activeLoadedNames?: string[];
  onSelectSessionArtifact?: (artifact: OpenedArtifact) => void;
  children: React.ReactNode;
}

/**
 * ONE Reusable Studio Workspace Shell across PDF, Video, and Audio tools:
 * - Stirling-inspired collapsible left-hand searchable tool switcher with Pinned/Recent quick access
 * - Session File Shelf keeping loaded files ready across tool transitions (0 server uploads)
 * - BentoPDF-inspired Full-Width Mode toggle (Alt+W) & clean keyboard shortcuts
 */
export default function UnifiedToolWorkspace({
  suite,
  currentHref,
  title,
  description,
  backHref,
  backLabel,
  historyHref,
  historyLabel = 'Local History',
  badgeText,
  statusLabel,
  statusTone = 'local',
  activeLoadedNames = [],
  onSelectSessionArtifact,
  children,
}: UnifiedToolWorkspaceProps) {
  const { prefs, updatePrefs } = useWorkspacePrefs();
  const { sessionFiles, artifact, selectSessionFile, removeSessionFile } = useOpenedArtifact();

  const [railSuite, setRailSuite] = useState<'pdf' | 'video'>(suite);
  const [railQuery, setRailQuery] = useState('');
  const [pinnedHrefs, setPinnedHrefs] = useState<string[]>([]);
  const [recentHrefs, setRecentHrefs] = useState<string[]>([]);
  const [nativePlatform, setNativePlatform] = useState<'exe' | 'apk' | null>(null);

  useEffect(() => {
    if (isDesktopApp()) setNativePlatform('exe');
    else if (isCapacitorApp()) setNativePlatform('apk');
    else setNativePlatform(null);
  }, []);

  useEffect(() => {
    setRailSuite(suite);
  }, [suite]);

  useEffect(() => {
    setPinnedHrefs(getPinnedToolHrefs());
    setRecentHrefs(getRecentToolHrefs());
    if (currentHref) {
      recordRecentTool(currentHref);
    }
  }, [currentHref]);

  // Keyboard shortcuts: Alt+W toggles Full-Width Mode, Alt+B toggles Tool Switcher Rail
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (isInput) return;

      if (e.altKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        updatePrefs((prev) => ({ ...prev, fullWidth: !prev.fullWidth }));
      } else if (e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        updatePrefs((prev) => ({ ...prev, toolRailOpen: !prev.toolRailOpen }));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [updatePrefs]);

  const railTools = useMemo(() => {
    const q = railQuery.trim().toLowerCase();
    const base =
      q.length > 0
        ? ALL_STUDIO_TOOLS
        : railSuite === 'pdf'
        ? PDF_TOOLS_CATALOG
        : CREATOR_TOOLS_CATALOG;

    if (!q) return base;
    return base.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.keywords.some((k) => k.toLowerCase().includes(q))
    );
  }, [railSuite, railQuery]);

  const groupedRailTools = useMemo(() => {
    const map = new Map<string, StudioToolMeta[]>();
    for (const tool of railTools) {
      const key = railQuery.trim() ? `${tool.domain === 'pdf' ? 'PDF' : 'Video'}: ${tool.category}` : tool.category;
      const list = map.get(key) ?? [];
      list.push(tool);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [railTools, railQuery]);

  const quickAccessTools = useMemo(() => {
    const combined = [...new Set([...pinnedHrefs, ...recentHrefs])].filter((h) => h !== currentHref);
    return combined
      .map((href) => ALL_STUDIO_TOOLS.find((t) => t.href === href))
      .filter((t): t is StudioToolMeta => Boolean(t))
      .slice(0, 4);
  }, [pinnedHrefs, recentHrefs, currentHref]);

  const domainSessionFiles = useMemo(() => {
    return sessionFiles.filter((item) =>
      suite === 'pdf'
        ? item.domain === 'pdf' || item.domain === 'image'
        : item.domain === 'video' || item.domain === 'audio'
    );
  }, [sessionFiles, suite]);

  const handleTogglePin = (e: React.MouseEvent, href: string) => {
    e.preventDefault();
    e.stopPropagation();
    setPinnedHrefs(togglePinnedTool(href));
  };

  const containerClass = prefs.fullWidth
    ? 'w-full max-w-none mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8'
    : 'w-full max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8';

  const hasSidebar = nativePlatform === 'apk' ? false : prefs.toolRailOpen;
  const resolvedBackHref = nativePlatform === 'exe' ? '/app' : nativePlatform === 'apk' ? '/m' : backHref;
  const resolvedBackLabel =
    nativePlatform === 'exe' ? 'Workstation' : nativePlatform === 'apk' ? 'Mobile Studio' : backLabel;

  return (
    <div className="w-full min-h-[calc(100vh-140px)] scroll-mt-20">
      <div className={containerClass}>
        {/* Top Unified Breadcrumb & Workbench Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-6 border-b border-line">
          <div className="flex flex-wrap items-center gap-2.5">
            {nativePlatform !== 'apk' && (
              <button
                type="button"
                onClick={() => updatePrefs((prev) => ({ ...prev, toolRailOpen: !prev.toolRailOpen }))}
                aria-expanded={prefs.toolRailOpen}
                aria-label={prefs.toolRailOpen ? 'Hide tools sidebar' : 'Show tools sidebar'}
                title="Toggle tool switcher (Alt+B)"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line bg-surface hover:border-line-hover text-xs font-medium text-content whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                {prefs.toolRailOpen ? (
                  <PanelLeftClose className="w-3.5 h-3.5 text-content-secondary" aria-hidden="true" />
                ) : (
                  <PanelLeftOpen className="w-3.5 h-3.5 text-content-secondary" aria-hidden="true" />
                )}
                <span>{prefs.toolRailOpen ? 'Hide tools' : 'Switch tool'}</span>
              </button>
            )}

            <Link
              href={resolvedBackHref}
              className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-content-secondary hover:text-content whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded px-1 py-0.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{resolvedBackLabel}</span>
            </Link>

            {historyHref && (
              <Link
                href={historyHref}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-content-secondary hover:text-content whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded px-1.5 py-0.5"
              >
                <History className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{historyLabel}</span>
              </Link>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {badgeText && (
              <span className="px-2.5 py-1 rounded-full bg-surface-elevated border border-line text-[11px] font-mono text-content-secondary whitespace-nowrap">
                {badgeText}
              </span>
            )}

            <button
              type="button"
              onClick={() => updatePrefs((prev) => ({ ...prev, fullWidth: !prev.fullWidth }))}
              aria-pressed={prefs.fullWidth}
              title="Toggle full-width canvas (Alt+W)"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-line bg-surface hover:border-line-hover text-xs font-medium text-content-secondary hover:text-content whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {prefs.fullWidth ? (
                <Minimize2 className="w-3 h-3" aria-hidden="true" />
              ) : (
                <Maximize2 className="w-3 h-3" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">{prefs.fullWidth ? 'Centered' : 'Full width'}</span>
            </button>

            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-elevated border border-line text-xs font-medium text-content-secondary whitespace-nowrap">
              {statusTone === 'local' ? (
                <ShieldCheck className="w-3.5 h-3.5 text-success shrink-0" aria-hidden="true" />
              ) : statusTone === 'hybrid' ? (
                <Zap className="w-3.5 h-3.5 text-success shrink-0" aria-hidden="true" />
              ) : (
                <Cloud className="w-3.5 h-3.5 text-brand shrink-0" aria-hidden="true" />
              )}
              <span>{statusLabel}</span>
            </span>
          </div>
        </div>

        {/* Main Two-Pane Workbench (Collapsible Tool Switcher + Active Tool Stage) */}
        <div
          className={
            hasSidebar
              ? 'grid grid-cols-1 lg:grid-cols-[264px_minmax(0,1fr)] gap-6 items-start'
              : 'block'
          }
        >
          {hasSidebar && (
            <aside
              aria-label="Workspace tool switcher"
              className="rounded-2xl border border-line bg-surface p-3 space-y-3 lg:sticky lg:top-20"
            >
              {/* Suite Tabs inside Left Rail */}
              <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-elevated border border-line">
                <button
                  type="button"
                  onClick={() => setRailSuite('pdf')}
                  className={`flex-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                    railSuite === 'pdf'
                      ? 'bg-surface text-content shadow-sm'
                      : 'text-content-secondary hover:text-content'
                  }`}
                >
                  PDF ({PDF_TOOLS_CATALOG.length})
                </button>
                <button
                  type="button"
                  onClick={() => setRailSuite('video')}
                  className={`flex-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                    railSuite === 'video'
                      ? 'bg-surface text-content shadow-sm'
                      : 'text-content-secondary hover:text-content'
                  }`}
                >
                  Video ({CREATOR_TOOLS_CATALOG.length})
                </button>
              </div>

              {/* Search Tools */}
              <div className="relative">
                <Search
                  className="w-3.5 h-3.5 text-content-secondary absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={railQuery}
                  onChange={(e) => setRailQuery(e.target.value)}
                  placeholder="Filter tools…"
                  aria-label="Filter workspace tools"
                  className="w-full pl-8 pr-2.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content placeholder:text-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                />
              </div>

              {/* Quick Access (Pinned & Recent) */}
              {!railQuery.trim() && quickAccessTools.length > 0 && (
                <div className="space-y-1">
                  <div className="px-1.5 text-[11px] font-medium text-content-tertiary">
                    Quick access
                  </div>
                  <div className="space-y-0.5">
                    {quickAccessTools.map((tool) => {
                      const Icon = getToolIcon(tool.href);
                      return (
                        <Link
                          key={`quick-${tool.href}`}
                          href={tool.domain === suite ? `${tool.href}?handoff=1` : tool.href}
                          onClick={() => recordRecentTool(tool.href)}
                          className="px-2 py-1.5 rounded-lg flex items-center justify-between gap-2 text-xs text-content hover:bg-surface-elevated transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                        >
                          <span className="inline-flex items-center gap-2 min-w-0">
                            <Icon className="w-3.5 h-3.5 text-content-secondary shrink-0" aria-hidden="true" />
                            <span className="truncate font-medium">{tool.title}</span>
                          </span>
                          {pinnedHrefs.includes(tool.href) && (
                            <Pin className="w-3 h-3 text-brand shrink-0" aria-hidden="true" />
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Categorized Tool List */}
              <nav
                aria-label="Switch active tool"
                className="max-h-[320px] lg:max-h-[calc(100vh-310px)] overflow-y-auto pr-0.5 space-y-3"
              >
                {groupedRailTools.length === 0 ? (
                  <p className="px-2 py-4 text-xs text-content-secondary text-center">
                    No matching tools.
                  </p>
                ) : (
                  groupedRailTools.map(([groupName, tools]) => (
                    <div key={groupName} className="space-y-0.5">
                      <div className="px-2 py-1 text-[11px] font-semibold text-content-tertiary">
                        {groupName}
                      </div>
                      {tools.map((tool) => {
                        const active = tool.href === currentHref;
                        const Icon = getToolIcon(tool.href);
                        const isPinned = pinnedHrefs.includes(tool.href);
                        const targetHref =
                          tool.domain === suite && domainSessionFiles.length > 0
                            ? `${tool.href}?handoff=1`
                            : tool.href;

                        return (
                          <div key={tool.href} className="group flex items-center gap-1">
                            <Link
                              href={targetHref}
                              onClick={() => recordRecentTool(tool.href)}
                              aria-current={active ? 'page' : undefined}
                              className={`flex-1 min-w-0 px-2 py-1.5 rounded-lg flex items-center gap-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                                active
                                  ? 'bg-brand/12 text-brand font-semibold'
                                  : 'text-content-secondary hover:text-content hover:bg-surface-elevated'
                              }`}
                            >
                              <span
                                className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                                  active ? 'border-brand/30 bg-brand/10 text-brand' : TOOL_ICON_TONE[tool.accentKind]
                                }`}
                              >
                                <Icon className="w-3 h-3" aria-hidden="true" />
                              </span>
                              <span className="truncate">{tool.title}</span>
                            </Link>
                            <button
                              type="button"
                              onClick={(e) => handleTogglePin(e, tool.href)}
                              aria-label={isPinned ? `Unpin ${tool.title}` : `Pin ${tool.title}`}
                              className={`p-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                                isPinned ? 'opacity-100 text-brand' : 'text-content-tertiary hover:text-content'
                              }`}
                            >
                              <Pin className="w-3 h-3" aria-hidden="true" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </nav>
            </aside>
          )}

          {/* Main Active Tool Stage */}
          <div className="min-w-0 space-y-6">
            {/* Persistent Session File Shelf (Stirling Library Pattern) */}
            {domainSessionFiles.length > 0 && (
              <div
                aria-label="Session files"
                className="p-3 rounded-xl border border-line bg-surface flex flex-wrap items-center justify-between gap-2.5"
              >
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="text-xs font-medium text-content-secondary whitespace-nowrap">
                    Session files:
                  </span>
                  {domainSessionFiles.slice(0, 4).map((item) => {
                    const isLoadedHere = activeLoadedNames.includes(item.file.name);
                    const isActive = artifact?.id === item.id;
                    const FileIcon =
                      item.domain === 'pdf' || item.domain === 'image'
                        ? FileText
                        : item.domain === 'audio'
                        ? Music
                        : Film;

                    return (
                      <div
                        key={item.id}
                        className={`inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-lg border text-xs transition-colors ${
                          isLoadedHere
                            ? 'border-success/35 bg-success-bg text-content'
                            : isActive
                            ? 'border-brand/35 bg-brand/8 text-content'
                            : 'border-line bg-surface-elevated text-content-secondary'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            selectSessionFile(item.id);
                            onSelectSessionArtifact?.(item);
                          }}
                          className="inline-flex items-center gap-1.5 min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded"
                          title={isLoadedHere ? 'Active in current tool' : 'Load into current tool'}
                        >
                          {isLoadedHere ? (
                            <Check className="w-3.5 h-3.5 text-success shrink-0" aria-hidden="true" />
                          ) : (
                            <FileIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          )}
                          <span className="max-w-[160px] truncate font-medium">{item.file.name}</span>
                          <span className="font-mono tabular-nums text-[10px] opacity-75">
                            {formatBytes(item.file.size)}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSessionFile(item.id)}
                          aria-label={`Remove ${item.file.name} from session`}
                          className="p-0.5 rounded hover:bg-surface text-content-tertiary hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                        >
                          <X className="w-3 h-3" aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <span className="text-[11px] font-mono text-content-tertiary whitespace-nowrap">
                  Stays loaded across tools
                </span>
              </div>
            )}

            {/* Tool Heading */}
            <header className="max-w-3xl space-y-1.5">
              <h1 className="text-2xl sm:text-3xl font-display font-medium text-content tracking-[-0.02em]">
                {title}
              </h1>
              <p className="text-sm sm:text-base text-content-secondary leading-relaxed">
                {description}
              </p>
            </header>

            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
