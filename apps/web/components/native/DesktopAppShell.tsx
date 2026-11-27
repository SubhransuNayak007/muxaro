'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  Camera,
  Cloud,
  FolderOpen,
  FileText,
  Film,
  Sparkles,
  Search,
  Clock,
  FolderDown,
  Sun,
  Moon,
  ArrowRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Link2,
  Layers,
  Minimize2,
  PenTool,
  Scissors,
  Music,
  Edit3,
  ScanLine,
  Pin,
} from 'lucide-react';
import {
  ALL_STUDIO_TOOLS,
  CREATOR_TOOLS_CATALOG,
  PDF_TOOLS_CATALOG,
  type PdfToolCategory,
} from '@/lib/tools-catalog';
import { useOpenedArtifact } from '@/lib/opened-artifact';
import {
  getPinnedToolHrefs,
  getRecentToolHrefs,
  recordRecentTool,
  togglePinnedTool,
} from '@/lib/recent-tools';
import {
  captureDesktopScreenFile,
  fetchRemoteUrlToFile,
  isDesktopApp,
  resolveGoogleDriveDownloadUrl,
  saveOrShareArtifact,
} from '@/lib/native-bridge';
import { matchCopilotActions, type CopilotAction } from '@/lib/native-copilot';
import { api, extractDisplayError } from '@/lib/api-client';
import { formatBytes } from '@/lib/formatters';
import type { MediaManifest, ProcessingJob } from '@/lib/types';
import GoogleDriveModal from './GoogleDriveModal';

const AdaptiveMediaCard = dynamic(() => import('@/components/AdaptiveMediaCard'), {
  ssr: false,
});
const JobProgress = dynamic(() => import('@/components/JobProgress'), {
  ssr: false,
});

type DeskSection = 'home' | 'pdf' | 'media' | 'queue';

const PDF_CATEGORIES: Array<'All' | PdfToolCategory> = [
  'All',
  'Create',
  'Edit',
  'Optimize',
  'Convert',
  'Secure',
];

const QUICK_LAUNCH_TOOLS = [
  { href: '/tools/pdf/make-pdf', title: 'Camera -> PDF', sub: '5 scan filters + crop', icon: ScanLine, tone: 'text-emerald-500' },
  { href: '/tools/pdf/merge', title: 'Merge PDFs', sub: 'Reorder & combine', icon: Layers, tone: 'text-brand' },
  { href: '/tools/pdf/compress', title: 'Compress PDF', sub: 'QPDF lossless shrink', icon: Minimize2, tone: 'text-amber-500' },
  { href: '/tools/pdf/sign', title: 'Sign PDF', sub: 'Draw, type or stamp', icon: PenTool, tone: 'text-brand' },
  { href: '/tools/pdf/edit', title: 'Edit & Redact', sub: 'Text, highlights, ink', icon: Edit3, tone: 'text-emerald-500' },
  { href: '/tools/video-compressor', title: 'Video Compressor', sub: '10 MB / 16 MB target', icon: Minimize2, tone: 'text-amber-500' },
  { href: '/tools/video-trimmer', title: 'Lossless Trimmer', sub: 'Instant stream-copy', icon: Scissors, tone: 'text-brand' },
  { href: '/tools/audio-extractor', title: 'Extract Audio', sub: 'FLAC, WAV & MP3', icon: Music, tone: 'text-emerald-500' },
] as const;

export default function DesktopAppShell() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { artifact, setArtifactFromFile, clearArtifact } = useOpenedArtifact();

  const [section, setSection] = useState<DeskSection>('home');
  const [pdfCategory, setPdfCategory] = useState<'All' | PdfToolCategory>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [linkInput, setLinkInput] = useState('');
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<MediaManifest | null>(null);
  const [activeJob, setActiveJob] = useState<ProcessingJob | null>(null);

  const [driveOpen, setDriveOpen] = useState(false);
  const [isDark, setIsDark] = useState(true);
  const [desktopEngineOk, setDesktopEngineOk] = useState(false);
  const [recentHrefs, setRecentHrefs] = useState<string[]>([]);
  const [pinnedHrefs, setPinnedHrefs] = useState<string[]>([]);
  const [statusToast, setStatusToast] = useState<string | null>(null);

  useEffect(() => {
    setRecentHrefs(getRecentToolHrefs());
    setPinnedHrefs(getPinnedToolHrefs());
    setDesktopEngineOk(isDesktopApp());
    try {
      setIsDark(document.documentElement.classList.contains('dark'));
    } catch {}
  }, []);

  const showToast = (msg: string) => {
    setStatusToast(msg);
    setTimeout(() => setStatusToast(null), 2600);
  };

  const toggleTheme = () => {
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

  const openTool = (href: string) => {
    setRecentHrefs(recordRecentTool(href));
    router.push(href);
  };

  const routeLocalFileToWorkspace = (file: File, sourceLabel = 'Desktop Studio') => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const isPdf = ext === 'pdf' || file.type === 'application/pdf';
    const isImage = ['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(ext) || file.type.startsWith('image/');
    const isAudio = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus'].includes(ext) || file.type.startsWith('audio/');
    const domain = isPdf ? 'pdf' : isImage ? 'image' : isAudio ? 'audio' : 'video';

    setArtifactFromFile(file, domain, '/app');
    showToast(`Loaded ${file.name} (${sourceLabel})`);

    if (isPdf) {
      openTool('/tools/pdf/view?handoff=1');
    } else if (isImage) {
      openTool('/tools/pdf/make-pdf?handoff=1');
    } else if (isAudio) {
      openTool('/tools/audio-extractor?handoff=1');
    } else {
      openTool('/tools/video-trimmer?handoff=1');
    }
  };

  const handleCaptureScreenToPdf = async () => {
    const file = await captureDesktopScreenFile();
    if (!file) {
      showToast('Screen capture unavailable.');
      return;
    }
    routeLocalFileToWorkspace(file, 'Screen Capture');
  };

  const runCopilotAction = (action: CopilotAction) => {
    if (action.kind === 'drive') {
      setDriveOpen(true);
      return;
    }
    if (action.kind === 'screen') {
      void handleCaptureScreenToPdf();
      return;
    }
    if (action.href) {
      openTool(action.href);
    }
  };

  const copilotMatches = useMemo(() => matchCopilotActions(linkInput), [linkInput]);

  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = linkInput.trim();
    if (!raw) return;

    setProbeError(null);
    setManifest(null);
    setActiveJob(null);

    if (copilotMatches.length > 0 && !/^https?:\/\//i.test(raw)) {
      runCopilotAction(copilotMatches[0]);
      return;
    }

    const driveInfo = resolveGoogleDriveDownloadUrl(raw);
    if (driveInfo.isDrive) {
      setProbing(true);
      try {
        const file = await fetchRemoteUrlToFile(raw);
        routeLocalFileToWorkspace(file, 'Google Drive');
      } catch (err) {
        setProbeError(extractDisplayError(err, 'Google Drive import failed.'));
      } finally {
        setProbing(false);
      }
      return;
    }

    setProbing(true);
    try {
      const m = await api.probeUrl(raw);
      setManifest(m);
    } catch (err) {
      setProbeError(extractDisplayError(err, 'Could not inspect this URL locally.'));
    } finally {
      setProbing(false);
    }
  };

  const filteredPdf = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return PDF_TOOLS_CATALOG.filter((item) => {
      if (pdfCategory !== 'All' && item.category !== pdfCategory) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.tag.toLowerCase().includes(q) ||
        item.keywords.some((k) => k.includes(q))
      );
    });
  }, [pdfCategory, searchQuery]);

  const filteredMedia = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return CREATOR_TOOLS_CATALOG;
    return CREATOR_TOOLS_CATALOG.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.tag.toLowerCase().includes(q) ||
        item.keywords.some((k) => k.includes(q))
    );
  }, [searchQuery]);

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

  return (
    <div className="min-h-screen bg-base text-content flex">
      <input
        ref={fileInputRef}
        type="file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) routeLocalFileToWorkspace(f, 'Local File');
        }}
        className="hidden"
        aria-label="Open file from computer"
      />

      <GoogleDriveModal
        open={driveOpen}
        onClose={() => setDriveOpen(false)}
        onImported={(file) => routeLocalFileToWorkspace(file, 'Google Drive')}
      />

      {/* Left Translucent Hardware Instrument Sidebar */}
      <aside className="w-[232px] shrink-0 border-r border-line bg-surface/85 backdrop-blur-xl flex flex-col justify-between p-3.5 sticky top-0 h-screen">
        <div className="space-y-5">
          {/* App Brand Mark */}
          <div className="px-2 pt-1 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-brand/12 border border-brand/25 flex items-center justify-center text-brand">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-semibold tracking-tight leading-none text-content">
                  MUXARO
                </div>
                <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium mt-0.5 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>{desktopEngineOk ? 'Local Engine Ready' : 'Offline App Ready'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Primary Navigation */}
          <nav aria-label="App workspace sections" className="space-y-1">
            {(
              [
                { id: 'home', label: 'Studio Desk', icon: Sparkles },
                { id: 'pdf', label: `PDF Suite (${PDF_TOOLS_CATALOG.length})`, icon: FileText },
                { id: 'media', label: `Video & Audio (${CREATOR_TOOLS_CATALOG.length})`, icon: Film },
                { id: 'queue', label: 'Queue & Recent', icon: Clock },
              ] as const
            ).map((nav) => {
              const Icon = nav.icon;
              const active = section === nav.id;
              return (
                <button
                  key={nav.id}
                  type="button"
                  onClick={() => setSection(nav.id)}
                  className={`muxaro-spring-tap w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-medium text-left transition-colors ${
                    active
                      ? 'bg-brand text-white shadow-sm'
                      : 'text-content-secondary hover:bg-surface-elevated hover:text-content'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{nav.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Direct Native Shortcuts */}
          <div className="pt-2 border-t border-line space-y-1">
            <div className="px-2 pb-1 text-[11px] font-medium text-content-tertiary">
              Quick Sources
            </div>
            <button
              type="button"
              onClick={() => openTool('/tools/pdf/make-pdf')}
              className="muxaro-spring-tap w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-content-secondary hover:bg-surface-elevated hover:text-content text-left"
            >
              <Camera className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>Camera -&gt; PDF</span>
            </button>
            <button
              type="button"
              onClick={() => void handleCaptureScreenToPdf()}
              className="muxaro-spring-tap w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-content-secondary hover:bg-surface-elevated hover:text-content text-left"
            >
              <ScanLine className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>Screen -&gt; PDF</span>
            </button>
            <button
              type="button"
              onClick={() => setDriveOpen(true)}
              className="muxaro-spring-tap w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-content-secondary hover:bg-surface-elevated hover:text-content text-left"
            >
              <Cloud className="w-4 h-4 text-brand shrink-0" />
              <span>Google Drive</span>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="muxaro-spring-tap w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-content-secondary hover:bg-surface-elevated hover:text-content text-left"
            >
              <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
              <span>Open File…</span>
            </button>
          </div>
        </div>

        {/* Bottom Controls */}
        <div className="space-y-2 pt-3 border-t border-line">
          {desktopEngineOk && (
            <button
              type="button"
              onClick={() => void window.muxaroDesktop?.openDownloadsFolder()}
              className="muxaro-spring-tap w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-elevated border border-line text-xs font-medium text-content hover:border-line-hover"
            >
              <FolderDown className="w-4 h-4 text-brand shrink-0" />
              <span>Downloads Folder</span>
            </button>
          )}
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] text-content-tertiary">Appearance</span>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="muxaro-spring-tap w-8 h-8 rounded-lg bg-surface-elevated border border-line flex items-center justify-center text-content-secondary hover:text-content"
            >
              {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </aside>

      {/* Main App Canvas */}
      <main className="flex-1 min-w-0 p-5 lg:p-8 overflow-y-auto">
        <div className="max-w-5xl mx-auto space-y-6">
          {statusToast && (
            <div className="muxaro-dropdown-enter rounded-xl px-4 py-2.5 bg-emerald-500/12 border border-emerald-500/30 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {statusToast}
            </div>
          )}

          {/* HOME DESK */}
          {section === 'home' && (
            <div className="muxaro-sheet-enter space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-display font-medium tracking-tight text-content">
                    Local Studio Desk
                  </h1>
                  <p className="text-xs text-content-secondary mt-0.5">
                    100% on-device execution · PDF tools, Camera scanner, Google Drive &amp; FFmpeg
                  </p>
                </div>

                {artifact && (
                  <div className="muxaro-liquid-glass rounded-xl px-3.5 py-2 flex items-center gap-3">
                    <div className="min-w-0 max-w-[200px]">
                      <div className="text-[10px] font-medium text-brand">Active File</div>
                      <div className="text-xs font-semibold truncate">{artifact.file.name}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void saveOrShareArtifact(artifact.file, artifact.file.name, artifact.file.name)
                      }
                      className="px-2.5 py-1 rounded-lg bg-brand text-white text-[11px] font-semibold"
                    >
                      Save
                    </button>
                  </div>
                )}
              </div>

              {/* Unified Smart Link + Drag-and-Drop Bar */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) routeLocalFileToWorkspace(f, 'Dropped File');
                }}
                className="muxaro-liquid-glass rounded-2xl p-4 sm:p-5 space-y-3.5"
              >
                <form onSubmit={handleLinkSubmit} className="flex flex-col sm:flex-row gap-2.5">
                  <div className="flex-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-surface-elevated border border-line focus-within:border-brand">
                    <Link2 className="w-4 h-4 text-content-tertiary shrink-0" />
                    <input
                      type="text"
                      value={linkInput}
                      onChange={(e) => setLinkInput(e.target.value)}
                      placeholder='Paste video / Google Drive URL, or type a command (e.g. "compress pdf", "capture screen")…'
                      className="w-full bg-transparent text-sm text-content placeholder:text-content-tertiary focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={probing || !linkInput.trim()}
                    className="muxaro-spring-tap px-5 py-2.5 rounded-xl bg-brand text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 shrink-0"
                  >
                    {probing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Running Locally…</span>
                      </>
                    ) : (
                      <>
                        <span>{copilotMatches.length > 0 ? 'Run Action' : 'Inspect / Import'}</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>

                {copilotMatches.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {copilotMatches.map((act) => (
                      <button
                        key={act.id}
                        type="button"
                        onClick={() => runCopilotAction(act)}
                        className="muxaro-spring-tap px-3 py-1.5 rounded-xl bg-brand/10 border border-brand/25 text-xs font-medium text-brand inline-flex items-center gap-1.5"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>{act.label}</span>
                      </button>
                    ))}
                  </div>
                )}

                {probeError && (
                  <div className="p-3 rounded-xl bg-error-bg border border-error/30 text-error text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{probeError}</span>
                  </div>
                )}
              </div>

              {/* Live Local Media Result Card (No Verification Gate!) */}
              {manifest && !activeJob && (
                <AdaptiveMediaCard
                  manifest={manifest}
                  onJobStarted={(job) => setActiveJob(job)}
                  onReset={() => setManifest(null)}
                />
              )}

              {activeJob && (
                <JobProgress
                  initialJob={activeJob}
                  sourceUrl={activeJob.sourceUrl}
                  onDismiss={() => setActiveJob(null)}
                />
              )}

              {/* 3 Big Primary Import & Capture Tiles */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                <button
                  type="button"
                  onClick={() => openTool('/tools/pdf/make-pdf')}
                  className="muxaro-liquid-glass muxaro-spring-tap rounded-2xl p-5 text-left space-y-3 border border-line hover:border-brand/40"
                >
                  <div className="w-11 h-11 rounded-2xl bg-emerald-500/14 border border-emerald-500/25 flex items-center justify-center text-emerald-500">
                    <Camera className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-content">Camera -&gt; PDF Scanner</div>
                    <div className="text-xs text-content-secondary mt-0.5">
                      Capture pages via webcam/camera with Magic Color, B&amp;W Crisp, Lighten &amp; edge crop
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setDriveOpen(true)}
                  className="muxaro-liquid-glass muxaro-spring-tap rounded-2xl p-5 text-left space-y-3 border border-line hover:border-brand/40"
                >
                  <div className="w-11 h-11 rounded-2xl bg-brand/14 border border-brand/25 flex items-center justify-center text-brand">
                    <Cloud className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-content">Import from Google Drive</div>
                    <div className="text-xs text-content-secondary mt-0.5">
                      Pull Drive PDFs, Docs, Slides, videos or images directly into your local studio
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="muxaro-liquid-glass muxaro-spring-tap rounded-2xl p-5 text-left space-y-3 border border-line hover:border-brand/40"
                >
                  <div className="w-11 h-11 rounded-2xl bg-amber-500/14 border border-amber-500/25 flex items-center justify-center text-amber-500">
                    <FolderOpen className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-content">Open Any Local File</div>
                    <div className="text-xs text-content-secondary mt-0.5">
                      Auto-routes PDF, DOCX, PPTX, MP4, MKV, MP3 &amp; photos into the right local tool
                    </div>
                  </div>
                </button>
              </div>

              {/* Essential 8 Quick Tools */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-content-secondary">
                    Quick Local Workflows
                  </h2>
                  <button
                    type="button"
                    onClick={() => setSection('pdf')}
                    className="text-xs font-medium text-brand hover:underline"
                  >
                    Browse all {ALL_STUDIO_TOOLS.length} tools →
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {QUICK_LAUNCH_TOOLS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.href}
                        type="button"
                        onClick={() => openTool(item.href)}
                        className="muxaro-spring-tap rounded-2xl bg-surface border border-line p-4 text-left space-y-2.5 hover:border-line-hover"
                      >
                        <div className="w-9 h-9 rounded-xl bg-surface-elevated border border-line flex items-center justify-center">
                          <Icon className={`w-4 h-4 ${item.tone}`} />
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-content">{item.title}</div>
                          <div className="text-[11px] text-content-secondary mt-0.5">{item.sub}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
          )}

          {/* PDF SUITE (38 TOOLS) */}
          {section === 'pdf' && (
            <div className="muxaro-sheet-enter space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-xl font-display font-medium text-content">
                  PDF Studio ({filteredPdf.length})
                </h1>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface border border-line w-full sm:w-64">
                  <Search className="w-4 h-4 text-content-tertiary" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter PDF tools..."
                    className="w-full bg-transparent text-xs text-content focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {PDF_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setPdfCategory(cat)}
                    className={`muxaro-spring-tap px-3.5 py-1.5 rounded-full text-xs font-medium border ${
                      pdfCategory === cat
                        ? 'bg-brand text-white border-brand'
                        : 'bg-surface border-line text-content-secondary'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredPdf.map((tool) => {
                  const pinned = pinnedHrefs.includes(tool.href);
                  return (
                    <div
                      key={tool.href}
                      className="muxaro-spring-tap rounded-2xl bg-surface border border-line p-4 flex flex-col justify-between gap-2.5"
                    >
                      <button
                        type="button"
                        onClick={() => openTool(tool.href)}
                        className="text-left space-y-1 flex-1"
                      >
                        <div className="text-sm font-semibold text-content">{tool.title}</div>
                        <div className="text-xs text-content-secondary line-clamp-2">
                          {tool.description}
                        </div>
                      </button>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                          {tool.tag}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPinnedHrefs(togglePinnedTool(tool.href))}
                          aria-label={pinned ? 'Unpin tool' : 'Pin tool'}
                          className={`p-1.5 rounded-lg ${
                            pinned ? 'text-brand bg-brand/10' : 'text-content-tertiary hover:text-content'
                          }`}
                        >
                          <Pin className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* VIDEO & AUDIO STUDIO */}
          {section === 'media' && (
            <div className="muxaro-sheet-enter space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-xl font-display font-medium text-content">
                    Local Video &amp; Audio Studio ({filteredMedia.length})
                  </h1>
                  <p className="text-xs text-content-secondary mt-0.5">
                    Powered locally by bundled FFmpeg &amp; yt-dlp on your PC
                  </p>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface border border-line w-full sm:w-64">
                  <Search className="w-4 h-4 text-content-tertiary" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter media tools..."
                    className="w-full bg-transparent text-xs text-content focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredMedia.map((tool) => (
                  <button
                    key={tool.href}
                    type="button"
                    onClick={() => openTool(tool.href)}
                    className="muxaro-spring-tap rounded-2xl bg-surface border border-line p-4 text-left space-y-1.5 hover:border-line-hover"
                  >
                    <div className="text-sm font-semibold text-content">{tool.title}</div>
                    <div className="text-xs text-content-secondary line-clamp-2">
                      {tool.description}
                    </div>
                    <div className="text-[11px] font-medium text-brand pt-1">{tool.tag}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* QUEUE & RECENT */}
          {section === 'queue' && (
            <div className="muxaro-sheet-enter space-y-5">
              <h1 className="text-xl font-display font-medium text-content">
                Active Workspace &amp; Recent Tools
              </h1>

              {artifact ? (
                <div className="muxaro-liquid-glass rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium text-brand">Loaded Session Artifact</div>
                    <div className="text-sm font-semibold text-content">{artifact.file.name}</div>
                    <div className="text-xs text-content-secondary">
                      {formatBytes(artifact.file.size)} · {artifact.domain.toUpperCase()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void saveOrShareArtifact(artifact.file, artifact.file.name, artifact.file.name)
                      }
                      className="px-3.5 py-2 rounded-xl bg-brand text-white text-xs font-semibold"
                    >
                      Save Copy
                    </button>
                    <button
                      type="button"
                      onClick={clearArtifact}
                      className="px-3 py-2 rounded-xl bg-surface-elevated border border-line text-xs"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl bg-surface border border-line p-5 text-xs text-content-secondary">
                  No active workspace file loaded yet. Open a local file, scan via Camera, or import from Google Drive.
                </div>
              )}

              {pinnedTools.length > 0 && (
                <div className="space-y-2">
                  <h2 className="text-xs font-semibold text-content-secondary">Pinned</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {pinnedTools.map((t) => (
                      <button
                        key={t.href}
                        type="button"
                        onClick={() => openTool(t.href)}
                        className="muxaro-spring-tap rounded-xl bg-surface border border-line p-3 text-left"
                      >
                        <div className="text-xs font-semibold text-content truncate">{t.title}</div>
                        <div className="text-[11px] text-content-secondary truncate">{t.tag}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {recentTools.length > 0 && (
                <div className="space-y-2">
                  <h2 className="text-xs font-semibold text-content-secondary">Recently Used</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {recentTools.map((t) => (
                      <button
                        key={t.href}
                        type="button"
                        onClick={() => openTool(t.href)}
                        className="muxaro-spring-tap rounded-xl bg-surface border border-line px-4 py-3 flex items-center justify-between text-left"
                      >
                        <span className="text-xs font-semibold text-content">{t.title}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-content-tertiary" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
