'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Camera,
  FileText,
  Film,
  FolderOpen,
  Search,
  Sparkles,
  Scissors,
  Minimize2,
  PenTool,
  Layers,
  Music,
  Image as ImageIcon,
  Sun,
  Moon,
  Clock,
  Pin,
  ChevronRight,
  CheckCircle2,
  Shield,
  Sliders,
  X,
  Download,
  Cloud,
  Link2,
  ArrowRight,
  ArrowUpRight,
  Loader2,
  Share2,
} from 'lucide-react';
import {
  CREATOR_TOOLS_CATALOG,
  PDF_TOOLS_CATALOG,
  ALL_STUDIO_TOOLS,
  type PdfToolCategory,
} from '@/lib/tools-catalog';
import { useOpenedArtifact } from '@/lib/opened-artifact';
import {
  getRecentToolHrefs,
  getPinnedToolHrefs,
  recordRecentTool,
  togglePinnedTool,
} from '@/lib/recent-tools';
import {
  saveOrShareArtifact,
  triggerHapticTap,
  isCapacitorApp,
  fetchRemoteUrlToFile,
  resolveGoogleDriveDownloadUrl,
  captureNativeCameraPhoto,
} from '@/lib/native-bridge';
import GoogleDriveModal from '@/components/native/GoogleDriveModal';
import { getToolIcon, TOOL_ICON_TONE } from '@/lib/tool-icons';
import dynamic from 'next/dynamic';

const MuxaroCopilotPanel = dynamic(() => import('@/components/ai/MuxaroCopilotPanel'), {
  ssr: false,
});
import { matchCopilotActions } from '@/lib/native-copilot';
import { listWorkspaceOutputs, type LocalWorkspaceOutputItem } from '@/lib/pdf/workspace';
import { formatBytes } from '@/lib/formatters';

type MobileTab = 'studio' | 'pdf' | 'media' | 'saved';

const PDF_FILTERS: Array<'All' | PdfToolCategory> = [
  'All',
  'Create',
  'Edit',
  'Optimize',
  'Convert',
  'Secure',
];

const QUICK_MOBILE_TOOLS = [
  { href: '/tools/pdf/view', title: 'Read PDF', sub: 'Day, Sepia & Night', icon: FileText, accent: 'text-brand' },
  { href: '/tools/pdf/merge', title: 'Merge PDF', sub: 'Files & page order', icon: Layers, accent: 'text-brand' },
  { href: '/tools/pdf/compress', title: 'Compress PDF', sub: 'Shrink file size cleanly', icon: Minimize2, accent: 'text-amber-500' },
  { href: '/tools/pdf/sign', title: 'Sign PDF', sub: 'Draw, type or stamp', icon: PenTool, accent: 'text-brand' },
  { href: '/tools/video-trimmer', title: 'Trim Video', sub: 'Cut and split fast', icon: Scissors, accent: 'text-amber-500' },
  { href: '/tools/audio-extractor', title: 'Extract Audio', sub: 'MP3, FLAC & WAV', icon: Music, accent: 'text-emerald-500' },
] as const;

export default function MobileStudioShell() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { artifact, setArtifactFromBlob, setArtifactFromFile, clearArtifact } = useOpenedArtifact();

  const [tab, setTab] = useState<MobileTab>('studio');
  const [pdfFilter, setPdfFilter] = useState<'All' | PdfToolCategory>('All');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [isDark, setIsDark] = useState(true);
  const [lightweightGpu, setLightweightGpu] = useState(false);
  const [recentHrefs, setRecentHrefs] = useState<string[]>([]);
  const [pinnedHrefs, setPinnedHrefs] = useState<string[]>([]);
  const [recentDocs, setRecentDocs] = useState<LocalWorkspaceOutputItem[]>([]);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [isNativeMobile, setIsNativeMobile] = useState(false);
  const [driveOpen, setDriveOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [quickLink, setQuickLink] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    setRecentHrefs(getRecentToolHrefs());
    setPinnedHrefs(getPinnedToolHrefs());
    setIsNativeMobile(isCapacitorApp());
    try {
      const sp = new URLSearchParams(window.location.search);
      const t = sp.get('tab');
      if (t === 'studio' || t === 'pdf' || t === 'media' || t === 'saved') {
        setTab(t);
      }
    } catch {}
    void listWorkspaceOutputs()
      .then((items) => setRecentDocs(items.slice(0, 6)))
      .catch(() => {});
    try {
      setIsDark(document.documentElement.classList.contains('dark'));
      setLightweightGpu(document.documentElement.getAttribute('data-lightweight') === 'true');
    } catch {}
  }, []);

  const toggleTheme = () => {
    void triggerHapticTap();
    const nextDark = !isDark;
    setIsDark(nextDark);
    try {
      const root = document.documentElement;
      if (nextDark) {
        root.classList.add('dark');
        root.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
      } else {
        root.classList.remove('dark');
        root.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
      }
    } catch {}
  };

  const toggleLightweight = () => {
    void triggerHapticTap();
    const next = !lightweightGpu;
    setLightweightGpu(next);
    try {
      if (next) {
        document.documentElement.setAttribute('data-lightweight', 'true');
        localStorage.setItem('muxaro-lightweight', 'true');
      } else {
        document.documentElement.removeAttribute('data-lightweight');
        localStorage.setItem('muxaro-lightweight', 'false');
      }
    } catch {}
  };

  const openTool = (href: string) => {
    void triggerHapticTap();
    setRecentHrefs(recordRecentTool(href));
    router.push(href);
  };

  const handleTogglePin = (href: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void triggerHapticTap();
    setPinnedHrefs(togglePinnedTool(href));
  };

  const routeLocalFile = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const isPdf = ext === 'pdf' || file.type === 'application/pdf';
    const isDocx = ext === 'docx';
    const isSlides = ext === 'pptx' || ext === 'odp';
    const isImage = ['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(ext) || file.type.startsWith('image/');
    const isAudio = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus'].includes(ext) || file.type.startsWith('audio/');

    const domain = isPdf || isDocx || isSlides ? 'pdf' : isImage ? 'image' : isAudio ? 'audio' : 'video';
    setArtifactFromFile(file, domain, '/m');

    if (isPdf) {
      openTool('/tools/pdf/view?handoff=1');
    } else if (isDocx) {
      openTool('/tools/pdf/word-to-pdf?handoff=1');
    } else if (isSlides) {
      openTool('/tools/pdf/powerpoint-to-pdf?handoff=1');
    } else if (isImage) {
      openTool('/tools/pdf/make-pdf?handoff=1');
    } else if (isAudio) {
      openTool('/tools/audio-extractor?handoff=1');
    } else {
      openTool('/tools/video-trimmer?handoff=1');
    }
  };

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void triggerHapticTap();
    routeLocalFile(file);
  };

  const handleQuickCameraCapture = async () => {
    void triggerHapticTap();
    const photo = await captureNativeCameraPhoto();
    if (photo) {
      routeLocalFile(photo);
      return;
    }
    openTool('/tools/pdf/make-pdf');
  };

  const handleQuickLinkImport = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = quickLink.trim();
    if (!raw) return;
    void triggerHapticTap();
    setLinkError(null);
    setLinkLoading(true);
    try {
      const driveInfo = resolveGoogleDriveDownloadUrl(raw);
      if (driveInfo.isDrive || /\.(pdf|mp4|mkv|webm|mp3|wav|flac|jpg|jpeg|png)(\?|$)/i.test(raw)) {
        const file = await fetchRemoteUrlToFile(raw);
        setQuickLink('');
        routeLocalFile(file);
      } else {
        setLinkError('Paste a Google Drive link or direct file URL to import offline.');
      }
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setLinkLoading(false);
    }
  };

  const handleSaveCurrentArtifact = async () => {
    if (!artifact?.file) return;
    void triggerHapticTap();
    const res = await saveOrShareArtifact(artifact.file, artifact.file.name, artifact.file.name);
    setStatusNotice(res.ok ? `Saved ${artifact.file.name}` : 'Save canceled');
    setTimeout(() => setStatusNotice(null), 2600);
  };

  const filteredPdfTools = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PDF_TOOLS_CATALOG.filter((item) => {
      if (pdfFilter !== 'All' && item.category !== pdfFilter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.tag.toLowerCase().includes(q) ||
        item.keywords.some((k) => k.includes(q))
      );
    });
  }, [pdfFilter, query]);

  const filteredMediaTools = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = isNativeMobile
      ? CREATOR_TOOLS_CATALOG.filter((t) => t.tierBadge !== 'Cloud FFmpeg' || t.audioCapable)
      : CREATOR_TOOLS_CATALOG;
    if (!q) return list;
    return list.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.tag.toLowerCase().includes(q) ||
        item.keywords.some((k) => k.includes(q))
    );
  }, [query, isNativeMobile]);

  const copilotResults = useMemo(() => matchCopilotActions(query), [query]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return ALL_STUDIO_TOOLS.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.tag.toLowerCase().includes(q) ||
        item.keywords.some((k) => k.includes(q))
    ).slice(0, 12);
  }, [query]);

  const recentTools = useMemo(
    () =>
      recentHrefs
        .map((href) => ALL_STUDIO_TOOLS.find((t) => t.href === href))
        .filter((x): x is (typeof ALL_STUDIO_TOOLS)[number] => Boolean(x)),
    [recentHrefs]
  );

  const pinnedTools = useMemo(
    () =>
      pinnedHrefs
        .map((href) => ALL_STUDIO_TOOLS.find((t) => t.href === href))
        .filter((x): x is (typeof ALL_STUDIO_TOOLS)[number] => Boolean(x)),
    [pinnedHrefs]
  );

  const activeTabIndex = tab === 'studio' ? 0 : tab === 'pdf' ? 1 : tab === 'media' ? 2 : 3;

  return (
    <div
      className="min-h-[100dvh] bg-base text-content flex flex-col relative pb-28"
      style={{ paddingTop: 'env(safe-area-inset-top, 8px)' }}
    >
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFilePick}
        className="hidden"
        aria-label="Open file from device"
      />

      <GoogleDriveModal
        open={driveOpen}
        onClose={() => setDriveOpen(false)}
        onImported={(file) => routeLocalFile(file)}
      />

      {/* Sticky Minimal Instrument Header */}
      <header className="sticky top-0 z-30 px-4 pt-2 pb-2">
        <div className="muxaro-liquid-glass rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-2 max-w-xl mx-auto">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-brand/12 border border-brand/25 flex items-center justify-center text-brand">
              <Sparkles className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight text-content leading-none">
                MUXARO
              </div>
              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-0.5 font-medium">
                <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                <span>Ready offline</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                void triggerHapticTap();
                setSearchOpen((prev) => !prev);
              }}
              aria-label="Search tools"
              className="muxaro-spring-tap w-9 h-9 rounded-xl bg-surface-elevated border border-line flex items-center justify-center text-content-secondary hover:text-content"
            >
              {searchOpen ? <X className="w-4 h-4" /> : <Search className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle color theme"
              className="muxaro-spring-tap w-9 h-9 rounded-xl bg-surface-elevated border border-line flex items-center justify-center text-content-secondary hover:text-content"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Expanding Search Drawer */}
        {searchOpen && (
          <div className="muxaro-dropdown-enter mt-2 max-w-xl mx-auto rounded-2xl border border-line bg-surface p-3 space-y-2 shadow-lg">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-elevated border border-line">
              <Search className="w-4 h-4 text-content-tertiary shrink-0" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search 52 PDF & Media tools…"
                autoFocus
                className="w-full bg-transparent text-sm text-content placeholder:text-content-tertiary focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="text-xs text-content-secondary px-1.5 py-0.5 rounded bg-surface border border-line"
                >
                  Clear
                </button>
              )}
            </div>
            {query.trim().length > 0 && (
              <div className="max-h-60 overflow-y-auto space-y-1">
                {copilotResults.map((act) => (
                  <button
                    key={act.id}
                    type="button"
                    onClick={() => {
                      if (act.kind === 'drive') {
                        setSearchOpen(false);
                        setDriveOpen(true);
                      } else if (act.href) {
                        openTool(act.href);
                      }
                    }}
                    className="muxaro-spring-tap w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-brand/10 border border-brand/25 text-left"
                  >
                    <div>
                      <div className="text-xs font-semibold text-brand">{act.label}</div>
                      <div className="text-[11px] text-content-secondary">{act.subtitle}</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-brand" />
                  </button>
                ))}
                {searchResults.length === 0 && copilotResults.length === 0 ? (
                  <div className="text-xs text-content-secondary px-2 py-3 text-center">
                    No matching tools found.
                  </div>
                ) : (
                  searchResults.map((tool) => (
                    <button
                      key={tool.href}
                      type="button"
                      onClick={() => openTool(tool.href)}
                      className="muxaro-spring-tap w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-surface-elevated/60 hover:bg-surface-elevated border border-line text-left"
                    >
                      <div>
                        <div className="text-xs font-semibold text-content">{tool.title}</div>
                        <div className="text-[11px] text-content-secondary">{tool.tag}</div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-content-tertiary" />
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </header>

      {/* Main Thumb-Ergonomic Content Area */}
      <main className="flex-1 px-4 pt-2 max-w-xl w-full mx-auto space-y-5">
        {statusNotice && (
          <div className="muxaro-dropdown-enter rounded-xl px-3.5 py-2 bg-emerald-500/12 border border-emerald-500/30 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            {statusNotice}
          </div>
        )}

        {/* TAB 1: STUDIO HOME (Unified Gemini-Style Workspace) */}
        {tab === 'studio' && (
          <div key="studio" className="muxaro-sheet-enter flex flex-col min-h-[72dvh] space-y-4">
            <MuxaroCopilotPanel
              variant="embedded"
              compactMobile
              onOpenCamera={() => void handleQuickCameraCapture()}
              onOpenDrive={() => {
                void triggerHapticTap();
                setDriveOpen(true);
              }}
              externalBottomSlot={
                <div className="pt-1 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                  {[
                    { href: '/tools/pdf/merge', label: 'Merge PDF' },
                    { href: '/tools/pdf/sign', label: 'Sign PDF' },
                    { href: '/tools/pdf/compress', label: 'Compress PDF' },
                    { href: '/tools/video-trimmer', label: 'Trim Video' },
                  ].map((qt) => (
                    <button
                      key={qt.href}
                      type="button"
                      onClick={() => openTool(qt.href)}
                      className="px-3 py-1 rounded-full border border-line bg-surface text-[11px] font-medium text-content-secondary shrink-0"
                    >
                      {qt.label}
                    </button>
                  ))}
                </div>
              }
            />

            {/* Recent On-Device Files */}
            {recentDocs.length > 0 && (
              <section aria-label="Recent local documents" className="space-y-2 pt-2">
                <div className="flex items-center justify-between px-0.5">
                  <h2 className="text-xs font-semibold text-content-secondary">Recent Files</h2>
                  <button
                    type="button"
                    onClick={() => openTool('/tools/pdf/recent')}
                    className="text-xs font-medium text-brand inline-flex items-center gap-1"
                  >
                    <span>History</span>
                    <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
                <div className="space-y-1.5">
                  {recentDocs.slice(0, 3).map((doc) => (
                    <div
                      key={doc.id}
                      className="rounded-2xl bg-surface border border-line px-3.5 py-2.5 flex items-center justify-between gap-2.5"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (!doc.blob) return;
                          void triggerHapticTap();
                          setArtifactFromBlob(doc.blob, doc.fileName, doc.domain === 'video' ? 'video' : 'pdf', '/m');
                          openTool('/tools/pdf/view?handoff=1');
                        }}
                        className="min-w-0 text-left flex-1"
                      >
                        <div className="text-xs font-semibold text-content truncate">{doc.fileName}</div>
                        <div className="text-[11px] text-content-secondary truncate tabular-nums">
                          {doc.toolName} ({formatBytes(doc.sizeBytes)})
                        </div>
                      </button>
                      {doc.blob && (
                        <button
                          type="button"
                          onClick={() => {
                            void triggerHapticTap();
                            void saveOrShareArtifact(doc.blob!, doc.fileName, doc.fileName);
                          }}
                          aria-label={`Save or share ${doc.fileName}`}
                          className="p-2 rounded-xl bg-surface-elevated border border-line text-content-secondary shrink-0"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* TAB 2: PDF SUITE */}
        {tab === 'pdf' && (
          <div key="pdf" className="muxaro-sheet-enter space-y-3.5">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface border border-line">
              <Search className="w-4 h-4 text-content-tertiary shrink-0" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter 38 PDF tools…"
                className="w-full bg-transparent text-xs text-content placeholder:text-content-tertiary focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="text-[11px] text-content-secondary"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {PDF_FILTERS.map((cat) => {
                const active = pdfFilter === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      void triggerHapticTap();
                      setPdfFilter(cat);
                    }}
                    className={`muxaro-spring-tap shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium border ${
                      active
                        ? 'bg-brand text-white border-brand'
                        : 'bg-surface border-line text-content-secondary'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 gap-2">
              {filteredPdfTools.map((tool) => {
                const isPinned = pinnedHrefs.includes(tool.href);
                const Icon = getToolIcon(tool.href);
                const tone = TOOL_ICON_TONE[tool.accentKind];
                return (
                  <div
                    key={tool.href}
                    className="muxaro-spring-tap rounded-2xl bg-surface border border-line px-3.5 py-3 flex items-center justify-between gap-3"
                  >
                    <button
                      type="button"
                      onClick={() => openTool(tool.href)}
                      className="text-left flex items-center gap-3 min-w-0 flex-1 focus:outline-none"
                    >
                      <div className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 ${tone}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-content">{tool.title}</div>
                        <div className="text-[11px] text-content-secondary mt-0.5 leading-snug">
                          {tool.description}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleTogglePin(tool.href, e)}
                      aria-label={isPinned ? 'Unpin tool' : 'Pin tool'}
                      className={`p-1.5 rounded-lg shrink-0 ${
                        isPinned ? 'text-brand bg-brand/10' : 'text-content-tertiary'
                      }`}
                    >
                      <Pin className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: MEDIA TOOLS */}
        {tab === 'media' && (
          <div key="media" className="muxaro-sheet-enter space-y-3.5">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface border border-line">
              <Search className="w-4 h-4 text-content-tertiary shrink-0" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter Video & Audio tools…"
                className="w-full bg-transparent text-xs text-content placeholder:text-content-tertiary focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="text-[11px] text-content-secondary"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="rounded-2xl border border-line bg-surface p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <ImageIcon className="w-4 h-4 text-brand shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-content">Private Media Tools</div>
                  <div className="text-[11px] text-content-secondary">
                    Fast video &amp; audio editing on your phone
                  </div>
                </div>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/12 text-emerald-500">
                Ready
              </span>
            </div>

            <div className="space-y-2">
              {filteredMediaTools.map((tool) => {
                const Icon = getToolIcon(tool.href);
                const tone = TOOL_ICON_TONE[tool.accentKind];
                return (
                  <button
                    key={tool.href}
                    type="button"
                    onClick={() => openTool(tool.href)}
                    className="muxaro-spring-tap w-full rounded-2xl bg-surface border border-line px-3.5 py-3 flex items-center justify-between gap-3 text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 ${tone}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-content">{tool.title}</div>
                        <div className="text-[11px] text-content-secondary mt-0.5 leading-snug">
                          {tool.description}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-content-tertiary shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 4: FILES & PREFERENCES */}
        {tab === 'saved' && (
          <div key="saved" className="muxaro-sheet-enter space-y-4">
            {artifact ? (
              <div className="rounded-2xl border border-line bg-surface p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-brand">Active Session File</span>
                  <button
                    type="button"
                    onClick={clearArtifact}
                    className="text-[11px] text-content-secondary"
                  >
                    Clear
                  </button>
                </div>
                <div>
                  <div className="text-sm font-semibold text-content truncate">{artifact.file.name}</div>
                  <div className="text-xs text-content-secondary tabular-nums">
                    {formatBytes(artifact.file.size)} ({artifact.domain.toUpperCase()})
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleSaveCurrentArtifact}
                    className="muxaro-spring-tap px-3.5 py-2 rounded-xl bg-brand text-white text-xs font-semibold"
                  >
                    Save or Share File
                  </button>
                  {artifact.domain === 'pdf' && (
                    <>
                      <button
                        type="button"
                        onClick={() => openTool('/tools/pdf/compress?handoff=1')}
                        className="muxaro-spring-tap px-3 py-2 rounded-xl bg-surface-elevated border border-line text-xs font-medium"
                      >
                        Compress
                      </button>
                      <button
                        type="button"
                        onClick={() => openTool('/tools/pdf/sign?handoff=1')}
                        className="muxaro-spring-tap px-3 py-2 rounded-xl bg-surface-elevated border border-line text-xs font-medium"
                      >
                        Sign
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl bg-surface border border-line p-4 text-center space-y-1.5">
                <div className="text-xs font-medium text-content">No active file in queue</div>
                <div className="text-[11px] text-content-secondary">
                  Open or scan any document to pass it directly between tools.
                </div>
              </div>
            )}

            {recentDocs.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold text-content-secondary px-0.5">
                  Saved Outputs
                </h2>
                <div className="space-y-1.5">
                  {recentDocs.map((doc) => (
                    <div
                      key={doc.id}
                      className="rounded-xl bg-surface border border-line px-3.5 py-2.5 flex items-center justify-between gap-2"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (!doc.blob) return;
                          setArtifactFromBlob(doc.blob, doc.fileName, doc.domain === 'video' ? 'video' : 'pdf', '/m');
                          openTool('/tools/pdf/view?handoff=1');
                        }}
                        className="min-w-0 text-left flex-1"
                      >
                        <div className="text-xs font-semibold text-content truncate">{doc.fileName}</div>
                        <div className="text-[11px] text-content-secondary truncate tabular-nums">
                          {doc.toolName} ({formatBytes(doc.sizeBytes)})
                        </div>
                      </button>
                      {doc.blob && (
                        <button
                          type="button"
                          onClick={() => void saveOrShareArtifact(doc.blob!, doc.fileName, doc.fileName)}
                          aria-label={`Save ${doc.fileName}`}
                          className="p-2 rounded-lg bg-surface-elevated border border-line text-content-secondary"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {pinnedTools.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold text-content-secondary px-0.5">
                  Pinned Tools
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  {pinnedTools.map((tool) => (
                    <button
                      key={tool.href}
                      type="button"
                      onClick={() => openTool(tool.href)}
                      className="muxaro-spring-tap rounded-xl bg-surface border border-line p-3 text-left"
                    >
                      <div className="text-xs font-semibold text-content truncate">
                        {tool.title}
                      </div>
                      <div className="text-[11px] text-content-secondary truncate">{tool.tag}</div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {recentTools.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold text-content-secondary px-0.5">
                  Recent Tools
                </h2>
                <div className="space-y-1.5">
                  {recentTools.map((tool) => (
                    <button
                      key={tool.href}
                      type="button"
                      onClick={() => openTool(tool.href)}
                      className="muxaro-spring-tap w-full rounded-xl bg-surface border border-line px-3.5 py-2.5 flex items-center justify-between text-left"
                    >
                      <span className="text-xs font-medium text-content">{tool.title}</span>
                      <ChevronRight className="w-4 h-4 text-content-tertiary" />
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Mobile Device Preferences */}
            <section className="rounded-2xl bg-surface border border-line p-3.5 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-content">
                <Sliders className="w-4 h-4 text-brand" />
                <span>App Preferences</span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-content">Eco GPU Mode</div>
                  <div className="text-[11px] text-content-secondary">
                    Disable blur and animations for battery savings
                  </div>
                </div>
                <button
                  type="button"
                  onClick={toggleLightweight}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                    lightweightGpu
                      ? 'bg-brand text-white border-brand'
                      : 'bg-surface-elevated border-line text-content-secondary'
                  }`}
                >
                  {lightweightGpu ? 'On' : 'Off'}
                </button>
              </div>
              {!isNativeMobile && (
                <div className="pt-2 border-t border-line flex items-center justify-between">
                  <span className="text-xs text-content-secondary">Desktop View</span>
                  <Link href="/app" className="text-xs font-semibold text-brand">
                    Open Workstation
                  </Link>
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {/* Floating Thumb Dock */}
      <nav
        aria-label="Mobile navigation dock"
        className="fixed bottom-3 left-4 right-4 z-40 max-w-md mx-auto"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="muxaro-dock-glass rounded-full p-1.5 grid grid-cols-4 relative">
          <div
            aria-hidden="true"
            className="absolute top-1.5 bottom-1.5 left-1.5 rounded-full bg-brand/14 border border-brand/25 pointer-events-none"
            style={{
              width: 'calc((100% - 12px) / 4)',
              transform: `translate3d(${activeTabIndex * 100}%, 0, 0)`,
              transition: 'transform 280ms var(--ease-spring)',
            }}
          />

          {(
            [
              { id: 'studio', label: 'Studio', icon: Shield },
              { id: 'pdf', label: 'PDF', icon: FileText },
              { id: 'media', label: 'Media', icon: Film },
              { id: 'saved', label: 'Files', icon: Clock },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  void triggerHapticTap();
                  setTab(item.id);
                }}
                className={`relative z-10 py-2 rounded-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                  active ? 'text-brand font-semibold' : 'text-content-secondary'
                }`}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
