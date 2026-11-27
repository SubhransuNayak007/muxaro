'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  ArrowUpRight,
  Loader2,
  AlertCircle,
  Link2,
  Layers,
  Minimize2,
  PenTool,
  Scissors,
  Music,
  Edit3,
  ScanLine,
  Pin,
  Command,
  Download,
  X,
  Plus,
  Cpu,
  FolderCheck,
  CheckCircle2,
  MoreHorizontal,
  MessageSquare,
  Trash2,
} from 'lucide-react';
import {
  ALL_STUDIO_TOOLS,
  CREATOR_TOOLS_CATALOG,
  PDF_TOOLS_CATALOG,
  type PdfToolCategory,
} from '@/lib/tools-catalog';
import { getToolIcon, TOOL_ICON_TONE } from '@/lib/tool-icons';
import {
  deleteChatSession,
  deriveChatTitle,
  exportChatAsMarkdown,
  groupSessionsByDate,
  loadChatSessions,
  saveChatSessions,
  upsertChatSession,
  type ChatSessionRecord,
  type SavedAttachmentRef,
  type StoredChatMessage,
} from '@/lib/ai';
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
import { listWorkspaceOutputs, type LocalWorkspaceOutputItem } from '@/lib/pdf/workspace';
import { api, extractDisplayError } from '@/lib/api-client';
import { formatBytes } from '@/lib/formatters';
import type { MediaManifest, ProcessingJob } from '@/lib/types';
import GoogleDriveModal from './GoogleDriveModal';

const MuxaroCopilotPanel = dynamic(() => import('@/components/ai/MuxaroCopilotPanel'), {
  ssr: false,
});
const BackgroundJobDock = dynamic(() => import('@/components/studio/BackgroundJobDock'), {
  ssr: false,
});

const AdaptiveMediaCard = dynamic(() => import('@/components/AdaptiveMediaCard'), {
  ssr: false,
});
const JobProgress = dynamic(() => import('@/components/JobProgress'), {
  ssr: false,
});

type DeskSection = 'home' | 'pdf' | 'media' | 'queue';

interface DesktopDiagInfo {
  platform: string;
  arch: string;
  cpus: number;
  hasFfmpeg: boolean;
  hasYtdlp: boolean;
  downloadsDir: string;
}

interface DesktopJobEntry {
  id: string;
  status: string;
  title: string;
  filename?: string;
  sizeBytes?: number;
  progress?: number;
  stage?: string;
  updatedAt?: string;
}

const PDF_CATEGORIES: Array<'All' | PdfToolCategory> = [
  'All',
  'Create',
  'Edit',
  'Optimize',
  'Convert',
  'Secure',
];

const QUICK_LAUNCH_TOOLS = [
  { href: '/tools/pdf/make-pdf', title: 'Camera Scan', sub: '6 scan filters & OCR', icon: ScanLine, tone: 'text-emerald-500' },
  { href: '/tools/pdf/view', title: 'Read & Inspect', sub: 'Day, Sepia & Night', icon: FileText, tone: 'text-brand' },
  { href: '/tools/pdf/merge', title: 'Merge PDFs', sub: 'Reorder & combine', icon: Layers, tone: 'text-brand' },
  { href: '/tools/pdf/compress', title: 'Compress PDF', sub: 'QPDF lossless shrink', icon: Minimize2, tone: 'text-amber-500' },
  { href: '/tools/pdf/sign', title: 'Sign PDF', sub: 'Draw, type or stamp', icon: PenTool, tone: 'text-brand' },
  { href: '/tools/pdf/edit', title: 'Edit & Redact', sub: 'Text, highlights, ink', icon: Edit3, tone: 'text-emerald-500' },
  { href: '/tools/video-trimmer', title: 'Lossless Trimmer', sub: 'Instant stream-copy', icon: Scissors, tone: 'text-amber-500' },
  { href: '/tools/audio-extractor', title: 'Extract Audio', sub: 'FLAC, WAV & MP3', icon: Music, tone: 'text-emerald-500' },
] as const;

export default function DesktopAppShell() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { artifact, setArtifactFromBlob, setArtifactFromFile, clearArtifact } = useOpenedArtifact();

  const [section, setSection] = useState<DeskSection>('home');
  const [chatResetCounter, setChatResetCounter] = useState(0);
  const [chatSessions, setChatSessions] = useState<ChatSessionRecord[]>([]);
  const [activeChatId, setActiveChatId] = useState<string>(() => `chat-${Date.now()}`);
  const [menuChatId, setMenuChatId] = useState<string | null>(null);
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [undoDeleteToast, setUndoDeleteToast] = useState<ChatSessionRecord | null>(null);
  const [pdfCategory, setPdfCategory] = useState<'All' | PdfToolCategory>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');

  const [linkInput, setLinkInput] = useState('');
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<MediaManifest | null>(null);
  const [activeJob, setActiveJob] = useState<ProcessingJob | null>(null);

  const [driveOpen, setDriveOpen] = useState(false);
  const [isDark, setIsDark] = useState(true);
  const [desktopEngineOk, setDesktopEngineOk] = useState(false);
  const [diag, setDiag] = useState<DesktopDiagInfo | null>(null);
  const [desktopJobs, setDesktopJobs] = useState<DesktopJobEntry[]>([]);
  const [recentOutputs, setRecentOutputs] = useState<LocalWorkspaceOutputItem[]>([]);
  const [recentHrefs, setRecentHrefs] = useState<string[]>([]);
  const [pinnedHrefs, setPinnedHrefs] = useState<string[]>([]);
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [dragOverDesk, setDragOverDesk] = useState(false);

  const refreshLocalTelemetry = useCallback(() => {
    void listWorkspaceOutputs()
      .then((items) => setRecentOutputs(items.slice(0, 6)))
      .catch(() => {});

    if (isDesktopApp()) {
      void fetch('/api/v1/jobs')
        .then((r) => (r.ok ? r.json() : null))
        .then((res) => {
          const list = Array.isArray(res?.jobs) ? res.jobs : Array.isArray(res?.data) ? res.data : [];
          setDesktopJobs(list.slice(0, 12));
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    setRecentHrefs(getRecentToolHrefs());
    setPinnedHrefs(getPinnedToolHrefs());
    setChatSessions(loadChatSessions());
    const isExe = isDesktopApp();
    setDesktopEngineOk(isExe);

    if (isExe && window.muxaroDesktop?.getDiagnostics) {
      void window.muxaroDesktop
        .getDiagnostics()
        .then((info) => setDiag(info))
        .catch(() => {});
    }
    refreshLocalTelemetry();

    try {
      setIsDark(document.documentElement.classList.contains('dark'));
    } catch {}
  }, [refreshLocalTelemetry]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
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

  const routeLocalFileToWorkspace = (file: File, sourceLabel = 'Workstation') => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const isPdf = ext === 'pdf' || file.type === 'application/pdf';
    const isDocx = ext === 'docx';
    const isSlides = ext === 'pptx' || ext === 'odp';
    const isImage = ['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(ext) || file.type.startsWith('image/');
    const isAudio = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus'].includes(ext) || file.type.startsWith('audio/');
    const domain = isPdf || isDocx || isSlides ? 'pdf' : isImage ? 'image' : isAudio ? 'audio' : 'video';

    setArtifactFromFile(file, domain, '/app');
    showToast(`Loaded ${file.name} (${sourceLabel})`);

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

  const handleSubmittedUrl = async (raw: string) => {
    const clean = raw.trim();
    if (!clean) return;
    setProbeError(null);
    setManifest(null);
    setActiveJob(null);

    const driveInfo = resolveGoogleDriveDownloadUrl(clean);
    if (driveInfo.isDrive) {
      setProbing(true);
      try {
        const file = await fetchRemoteUrlToFile(clean);
        const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
        if (isPdf) {
          setArtifactFromFile(file, 'pdf', '/app');
          showToast(`Imported ${file.name} from Google Drive`);
        } else {
          routeLocalFileToWorkspace(file, 'Google Drive');
        }
      } catch (err) {
        setProbeError(extractDisplayError(err, 'Google Drive import failed.'));
      } finally {
        setProbing(false);
      }
      return;
    }

    setProbing(true);
    try {
      const m = await api.probeUrl(clean);
      setManifest(m);
    } catch (err) {
      setProbeError(extractDisplayError(err, 'Could not inspect this link locally.'));
    } finally {
      setProbing(false);
    }
  };

  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = linkInput.trim();
    if (!raw) return;
    if (copilotMatches.length > 0 && !/^https?:\/\//i.test(raw)) {
      runCopilotAction(copilotMatches[0]);
      return;
    }
    await handleSubmittedUrl(raw);
  };

  const revealJobInFolder = async (jobId: string) => {
    try {
      await fetch('/api/v1/native/show-in-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
    } catch {
      void window.muxaroDesktop?.openDownloadsFolder();
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

  const paletteChatMatches = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase();
    if (!q) return chatSessions.slice(0, 4);
    return chatSessions.filter((c) => c.title.toLowerCase().includes(q)).slice(0, 6);
  }, [paletteQuery, chatSessions]);

  const paletteFileMatches = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase();
    if (!q) return recentOutputs.slice(0, 3);
    return recentOutputs.filter((f) => f.fileName.toLowerCase().includes(q)).slice(0, 4);
  }, [paletteQuery, recentOutputs]);

  const groupedChatHistory = useMemo(() => groupSessionsByDate(chatSessions), [chatSessions]);

  const activeSessionRecord = useMemo(
    () => chatSessions.find((s) => s.id === activeChatId),
    [chatSessions, activeChatId]
  );

  const handleChatMessagesChange = useCallback(
    (msgs: StoredChatMessage[], activeRefs: SavedAttachmentRef[]) => {
      if (msgs.length === 0 && activeRefs.length === 0) return;
      const existing = loadChatSessions().find((s) => s.id === activeChatId);
      const firstUser = msgs.find((m) => m.role === 'user')?.text || '';
      const title = existing?.title && existing.title !== 'New conversation'
        ? existing.title
        : deriveChatTitle(firstUser, activeRefs);
      const record: ChatSessionRecord = {
        id: activeChatId,
        title,
        pinned: Boolean(existing?.pinned),
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
        activeFiles: activeRefs,
        messages: msgs,
      };
      setChatSessions(upsertChatSession(record));
    },
    [activeChatId]
  );

  const handleDeleteChat = (id: string) => {
    const { updated, removed } = deleteChatSession(id);
    setChatSessions(updated);
    setMenuChatId(null);
    if (removed) {
      setUndoDeleteToast(removed);
      setTimeout(() => setUndoDeleteToast(null), 5000);
    }
    if (activeChatId === id) {
      setActiveChatId(`chat-${Date.now()}`);
      setChatResetCounter((c) => c + 1);
    }
  };

  const handleUndoDeleteChat = () => {
    if (!undoDeleteToast) return;
    setChatSessions(upsertChatSession(undoDeleteToast));
    setActiveChatId(undoDeleteToast.id);
    setUndoDeleteToast(null);
  };

  const handlePinChat = (id: string) => {
    const all = loadChatSessions();
    const updated = all.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c));
    setChatSessions(saveChatSessions(updated));
    setMenuChatId(null);
  };

  const handleCommitRenameChat = (id: string) => {
    const clean = renameText.trim();
    if (clean) {
      const all = loadChatSessions();
      const updated = all.map((c) => (c.id === id ? { ...c, title: clean } : c));
      setChatSessions(saveChatSessions(updated));
    }
    setRenamingChatId(null);
    setRenameText('');
  };

  const handleExportChat = (chat: ChatSessionRecord) => {
    const md = exportChatAsMarkdown(chat);
    void saveOrShareArtifact(
      new Blob([md], { type: 'text/markdown;charset=utf-8' }),
      `${chat.title.replace(/[^a-z0-9-_]+/gi, '-')}.md`,
      `${chat.title}.md`
    );
    setMenuChatId(null);
  };

  const paletteMatches = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase();
    if (!q) return ALL_STUDIO_TOOLS.slice(0, 12);
    return ALL_STUDIO_TOOLS.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.tag.toLowerCase().includes(q) ||
        item.keywords.some((k) => k.includes(q))
    ).slice(0, 14);
  }, [paletteQuery]);

  return (
    <div
      className="min-h-screen bg-base text-content flex"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOverDesk(true);
      }}
      onDragLeave={() => setDragOverDesk(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOverDesk(false);
        const f = e.dataTransfer.files?.[0];
        if (f) routeLocalFileToWorkspace(f, 'Dropped File');
      }}
    >
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

      <BackgroundJobDock />

      {/* Command Palette (Ctrl+K) */}
      {paletteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/55 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Quick command palette"
          onClick={() => setPaletteOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-line bg-surface p-4 space-y-3 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-surface-elevated border border-line focus-within:border-brand">
              <Search className="w-4 h-4 text-content-tertiary shrink-0" />
              <input
                type="text"
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
                placeholder="Search 52 tools, saved chats, or output files…"
                autoFocus
                className="w-full bg-transparent text-sm text-content placeholder:text-content-tertiary focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setPaletteOpen(false)}
                aria-label="Close command palette"
                className="p-1 rounded-lg text-content-secondary hover:text-content"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto space-y-2">
              {paletteChatMatches.length > 0 && (
                <div className="space-y-0.5">
                  <div className="px-2 text-[10px] font-semibold uppercase tracking-wide text-content-tertiary">
                    Chats
                  </div>
                  {paletteChatMatches.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setPaletteOpen(false);
                        setPaletteQuery('');
                        setActiveChatId(c.id);
                        setSection('home');
                      }}
                      className="w-full px-3 py-1.5 rounded-xl hover:bg-surface-elevated flex items-center justify-between text-left"
                    >
                      <span className="text-xs font-medium text-content truncate">{c.title}</span>
                      <span className="text-[11px] text-content-tertiary">{c.messages.length} msgs</span>
                    </button>
                  ))}
                </div>
              )}

              {paletteFileMatches.length > 0 && (
                <div className="space-y-0.5">
                  <div className="px-2 text-[10px] font-semibold uppercase tracking-wide text-content-tertiary">
                    Recent Files
                  </div>
                  {paletteFileMatches.map((doc) => (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => {
                        setPaletteOpen(false);
                        setPaletteQuery('');
                        if (doc.blob) {
                          setArtifactFromBlob(doc.blob, doc.fileName, doc.domain === 'video' ? 'video' : 'pdf', '/app');
                          setSection('home');
                        }
                      }}
                      className="w-full px-3 py-1.5 rounded-xl hover:bg-surface-elevated flex items-center justify-between text-left"
                    >
                      <span className="text-xs font-medium text-content truncate">{doc.fileName}</span>
                      <span className="text-[11px] text-content-tertiary">{formatBytes(doc.sizeBytes)}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-0.5">
                <div className="px-2 text-[10px] font-semibold uppercase tracking-wide text-content-tertiary">
                  Tools
                </div>
                {paletteMatches.map((tool) => (
                  <button
                    key={tool.href}
                    type="button"
                    onClick={() => {
                      setPaletteOpen(false);
                      setPaletteQuery('');
                      openTool(tool.href);
                    }}
                    className="w-full px-3 py-2 rounded-xl hover:bg-surface-elevated flex items-center justify-between text-left transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-content truncate">{tool.title}</div>
                      <div className="text-[11px] text-content-secondary truncate">{tool.description}</div>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-content-tertiary shrink-0 ml-3" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Minimal Tonal Sidebar */}
      <aside className="w-[228px] shrink-0 border-r border-line bg-surface flex flex-col justify-between p-3.5 sticky top-0 h-screen">
        <div className="space-y-4 min-h-0 flex flex-col">
          {/* App Identity */}
          <div className="px-2 pt-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-brand/12 border border-brand/25 flex items-center justify-center text-brand">
                <Sparkles className="w-4 h-4" aria-hidden="true" />
              </div>
              <div>
                <div className="text-sm font-semibold tracking-tight leading-none text-content">
                  MUXARO
                </div>
                <div className="text-[11px] text-emerald-500 mt-0.5 font-medium">
                  Ready offline
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setSection('home');
              setManifest(null);
              setActiveJob(null);
              setProbeError(null);
              setActiveChatId(`chat-${Date.now()}`);
              setChatResetCounter((c) => c + 1);
            }}
            className="muxaro-spring-tap w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-elevated hover:bg-surface-interactive border border-line text-xs font-semibold text-content transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-brand" />
            <span>New Task</span>
          </button>

          {/* Primary Navigation (Calm Tonal Active Fills) */}
          <nav aria-label="App workspace sections" className="space-y-1">
            {(
              [
                { id: 'home', label: 'Assistant Home', icon: Sparkles },
                { id: 'pdf', label: `PDF Suite (${PDF_TOOLS_CATALOG.length})`, icon: FileText },
                { id: 'media', label: `Media Studio (${CREATOR_TOOLS_CATALOG.length})`, icon: Film },
                {
                  id: 'queue',
                  label: desktopJobs.length > 0 ? `Queue & Files (${desktopJobs.length})` : 'Queue & Files',
                  icon: Clock,
                },
              ] as const
            ).map((nav) => {
              const Icon = nav.icon;
              const active = section === nav.id;
              return (
                <button
                  key={nav.id}
                  type="button"
                  onClick={() => {
                    setSection(nav.id);
                    if (nav.id === 'queue' || nav.id === 'home') refreshLocalTelemetry();
                  }}
                  className={`muxaro-spring-tap w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-left transition-colors ${
                    active
                      ? 'bg-brand/12 text-brand border border-brand/25 font-semibold'
                      : 'text-content-secondary hover:bg-surface-elevated hover:text-content border border-transparent'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{nav.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Date-Grouped Persisted Chat History */}
          {groupedChatHistory.length > 0 && (
            <div className="pt-3 border-t border-line space-y-3 overflow-y-auto min-h-0 flex-1">
              {groupedChatHistory.map((bucket) => (
                <div key={bucket.group} className="space-y-0.5">
                  <div className="px-2 text-[10px] font-semibold uppercase tracking-wide text-content-tertiary">
                    {bucket.group}
                  </div>
                  {bucket.items.map((chat) => {
                    const isActive = section === 'home' && activeChatId === chat.id;
                    return (
                      <div
                        key={chat.id}
                        className={`group relative rounded-lg flex items-center justify-between gap-1 px-2 py-1.5 text-xs ${
                          isActive
                            ? 'bg-brand/12 text-brand font-medium'
                            : 'text-content-secondary hover:text-content hover:bg-surface-elevated'
                        }`}
                      >
                        {renamingChatId === chat.id ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              handleCommitRenameChat(chat.id);
                            }}
                            className="flex-1"
                          >
                            <input
                              type="text"
                              value={renameText}
                              onChange={(e) => setRenameText(e.target.value)}
                              onBlur={() => handleCommitRenameChat(chat.id)}
                              autoFocus
                              className="w-full bg-surface border border-brand rounded px-1.5 py-0.5 text-xs text-content focus:outline-none"
                            />
                          </form>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveChatId(chat.id);
                              setSection('home');
                              setMenuChatId(null);
                            }}
                            className="flex-1 min-w-0 text-left flex items-start gap-1.5"
                          >
                            <MessageSquare className="w-3 h-3 shrink-0 opacity-70 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate leading-tight">{chat.title}</div>
                              <div className="text-[10px] text-content-tertiary truncate mt-0.5 tabular-nums">
                                {new Date(chat.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                              </div>
                            </div>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuChatId(menuChatId === chat.id ? null : chat.id);
                          }}
                          aria-label="Chat options"
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface text-content-tertiary hover:text-content shrink-0"
                        >
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>

                        {menuChatId === chat.id && (
                          <div className="absolute right-0 top-7 z-40 w-36 rounded-xl border border-line bg-surface p-1 shadow-xl space-y-0.5 text-[11px]">
                            <button
                              type="button"
                              onClick={() => handlePinChat(chat.id)}
                              className="w-full px-2.5 py-1.5 rounded-lg hover:bg-surface-elevated text-left text-content flex items-center gap-2"
                            >
                              <Pin className="w-3 h-3" />
                              <span>{chat.pinned ? 'Unpin' : 'Pin'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setMenuChatId(null);
                                setRenamingChatId(chat.id);
                                setRenameText(chat.title);
                              }}
                              className="w-full px-2.5 py-1.5 rounded-lg hover:bg-surface-elevated text-left text-content flex items-center gap-2"
                            >
                              <Edit3 className="w-3 h-3" />
                              <span>Rename</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleExportChat(chat)}
                              className="w-full px-2.5 py-1.5 rounded-lg hover:bg-surface-elevated text-left text-content flex items-center gap-2"
                            >
                              <Download className="w-3 h-3" />
                              <span>Export .md</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteChat(chat.id)}
                              className="w-full px-2.5 py-1.5 rounded-lg hover:bg-error-bg text-left text-error flex items-center gap-2"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Delete</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {/* Recent Local Files */}
          {recentOutputs.length > 0 && groupedChatHistory.length === 0 && (
            <div className="pt-3 border-t border-line space-y-1 overflow-y-auto min-h-0">
              <div className="px-2 pb-1 text-[11px] font-medium text-content-tertiary">
                Recent Files
              </div>
              {recentOutputs.slice(0, 5).map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => {
                    if (!doc.blob) return;
                    setArtifactFromBlob(doc.blob, doc.fileName, doc.domain === 'video' ? 'video' : 'pdf', '/app');
                    setSection('home');
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs text-content-secondary hover:text-content hover:bg-surface-elevated truncate"
                >
                  {doc.fileName}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Bottom Controls */}
        <div className="space-y-2 pt-3 border-t border-line">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="muxaro-spring-tap w-full flex items-center justify-between px-3 py-2 rounded-xl bg-surface-elevated border border-line text-xs font-medium text-content-secondary hover:text-content"
          >
            <span className="inline-flex items-center gap-2">
              <Command className="w-3.5 h-3.5 text-brand" />
              <span>Quick Jump</span>
            </span>
            <kbd className="text-[10px] font-mono text-content-tertiary">Ctrl+K</kbd>
          </button>
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

      {/* Main Workstation Canvas */}
      <main className="flex-1 min-w-0 p-5 lg:p-8 overflow-y-auto">
        <div className="max-w-5xl mx-auto space-y-6">
          {dragOverDesk && (
            <div className="rounded-2xl border-2 border-dashed border-brand bg-brand/8 p-4 text-center text-xs font-semibold text-brand">
              Drop PDF, Word, Slides, Photo, Video, or Audio to route straight into the right local tool
            </div>
          )}

          {statusToast && (
            <div className="muxaro-dropdown-enter rounded-xl px-4 py-2.5 bg-emerald-500/12 border border-emerald-500/30 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {statusToast}
            </div>
          )}

          {undoDeleteToast && (
            <div className="muxaro-dropdown-enter rounded-xl px-4 py-2.5 bg-surface border border-line flex items-center justify-between text-xs text-content shadow-sm">
              <span>Deleted &ldquo;{undoDeleteToast.title}&rdquo;.</span>
              <button
                type="button"
                onClick={handleUndoDeleteChat}
                className="font-semibold text-brand hover:underline"
              >
                Undo
              </button>
            </div>
          )}

          {/* WORKSTATION HOME (Unified Gemini-Style Workspace) */}
          {section === 'home' && (
            <div className="muxaro-sheet-enter flex flex-col h-[calc(100vh-5rem)] max-w-4xl mx-auto">
              <MuxaroCopilotPanel
                variant="embedded"
                sessionId={activeChatId}
                initialMessages={activeSessionRecord?.messages}
                onMessagesChange={handleChatMessagesChange}
                resetSignal={chatResetCounter}
                onOpenCamera={() => openTool('/tools/pdf/make-pdf')}
                onOpenDrive={() => setDriveOpen(true)}
                onCaptureScreen={() => void handleCaptureScreenToPdf()}
                externalBottomSlot={
                  <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                    <span className="text-[11px] text-content-tertiary mr-1">Quick Tools:</span>
                    {[
                      { href: '/tools/pdf/merge', label: 'Merge PDF' },
                      { href: '/tools/pdf/sign', label: 'Sign PDF' },
                      { href: '/tools/pdf/edit', label: 'Edit PDF' },
                      { href: '/tools/pdf/compress', label: 'Compress PDF' },
                      { href: '/tools/video-compressor', label: 'Compress Video' },
                    ].map((qt) => (
                      <button
                        key={qt.href}
                        type="button"
                        onClick={() => openTool(qt.href)}
                        className="px-3 py-1 rounded-full border border-line bg-surface-elevated/70 hover:bg-surface-elevated text-[11px] font-medium text-content-secondary hover:text-content"
                      >
                        {qt.label}
                      </button>
                    ))}
                  </div>
                }
              />
            </div>
          )}

          {/* PDF SUITE */}
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
                    placeholder="Filter PDF tools…"
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
                  const Icon = getToolIcon(tool.href);
                  const tone = TOOL_ICON_TONE[tool.accentKind];
                  return (
                    <div
                      key={tool.href}
                      className="group rounded-2xl bg-surface border border-line px-4 py-3.5 flex items-center justify-between gap-3 hover:border-line-hover transition-colors min-h-[84px]"
                    >
                      <button
                        type="button"
                        onClick={() => openTool(tool.href)}
                        className="text-left flex items-center gap-3 min-w-0 flex-1"
                      >
                        <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${tone}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-content">{tool.title}</div>
                          <div className="text-xs text-content-secondary mt-0.5 leading-snug">
                            {tool.description}
                          </div>
                        </div>
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setPinnedHrefs(togglePinnedTool(tool.href))}
                          aria-label={pinned ? 'Unpin tool' : 'Pin tool'}
                          className={`p-1.5 rounded-lg transition-opacity ${
                            pinned
                              ? 'text-brand bg-brand/10 opacity-100'
                              : 'text-content-tertiary hover:text-content opacity-0 group-hover:opacity-100'
                          }`}
                        >
                          <Pin className="w-3.5 h-3.5" />
                        </button>
                        <ArrowRight className="w-3.5 h-3.5 text-content-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* MEDIA STUDIO */}
          {section === 'media' && (
            <div className="muxaro-sheet-enter space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-xl font-display font-medium text-content">
                    Video &amp; Audio Studio ({filteredMedia.length})
                  </h1>
                  <p className="text-xs text-content-secondary mt-0.5">
                    Fast, private video &amp; audio tools running on your PC.
                  </p>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface border border-line w-full sm:w-64">
                  <Search className="w-4 h-4 text-content-tertiary" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter media tools…"
                    className="w-full bg-transparent text-xs text-content focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredMedia.map((tool) => {
                  const Icon = getToolIcon(tool.href);
                  const tone = TOOL_ICON_TONE[tool.accentKind];
                  return (
                    <button
                      key={tool.href}
                      type="button"
                      onClick={() => openTool(tool.href)}
                      className="group rounded-2xl bg-surface border border-line px-4 py-3.5 flex items-center justify-between gap-3 text-left hover:border-line-hover transition-colors min-h-[84px]"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${tone}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-content">{tool.title}</div>
                          <div className="text-xs text-content-secondary mt-0.5 leading-snug">
                            {tool.description}
                          </div>
                        </div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-content-tertiary opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* QUEUE & FILES */}
          {section === 'queue' && (
            <div className="muxaro-sheet-enter space-y-5">
              <h1 className="text-xl font-display font-medium text-content">
                Local Queue &amp; Engine Diagnostics
              </h1>

              {diag && (
                <div className="rounded-2xl bg-surface border border-line p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <div className="text-[11px] text-content-tertiary flex items-center gap-1">
                      <Cpu className="w-3.5 h-3.5" />
                      <span>Processor</span>
                    </div>
                    <div className="font-mono font-semibold text-content mt-1 tabular-nums">
                      {diag.cpus} cores ({diag.arch})
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-content-tertiary">FFmpeg Engine</div>
                    <div className="font-semibold text-emerald-600 dark:text-emerald-400 mt-1">
                      {diag.hasFfmpeg ? 'Bundled Ready' : 'Missing'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-content-tertiary">yt-dlp Engine</div>
                    <div className="font-semibold text-emerald-600 dark:text-emerald-400 mt-1">
                      {diag.hasYtdlp ? 'Bundled Ready' : 'Missing'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-content-tertiary">Output Directory</div>
                    <button
                      type="button"
                      onClick={() => void window.muxaroDesktop?.openDownloadsFolder()}
                      className="font-medium text-brand hover:underline mt-1 truncate block max-w-full text-left"
                    >
                      Downloads/MUXARO
                    </button>
                  </div>
                </div>
              )}

              {artifact ? (
                <div className="rounded-2xl border border-line bg-surface p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium text-brand">Loaded Session File</div>
                    <div className="text-sm font-semibold text-content">{artifact.file.name}</div>
                    <div className="text-xs text-content-secondary tabular-nums">
                      {formatBytes(artifact.file.size)} ({artifact.domain.toUpperCase()})
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

              {desktopJobs.length > 0 && (
                <div className="space-y-2">
                  <h2 className="text-xs font-semibold text-content-secondary">
                    Local Desktop Jobs
                  </h2>
                  <div className="space-y-2">
                    {desktopJobs.map((j) => (
                      <div
                        key={j.id}
                        className="rounded-xl bg-surface border border-line px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-content truncate">
                            {j.filename || j.title}
                          </div>
                          <div className="text-[11px] text-content-secondary mt-0.5 tabular-nums">
                            {j.status} {j.sizeBytes ? `(${formatBytes(j.sizeBytes)})` : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {j.status === 'READY' && (
                            <button
                              type="button"
                              onClick={() =>
                                void fetch('/api/v1/native/open-file', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ jobId: j.id }),
                                })
                              }
                              className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-semibold hover:opacity-90"
                            >
                              Open File
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void revealJobInFolder(j.id)}
                            className="px-3 py-1.5 rounded-lg border border-line bg-surface-elevated text-xs font-medium text-content inline-flex items-center gap-1.5 hover:border-line-hover"
                          >
                            <FolderCheck className="w-3.5 h-3.5 text-brand" />
                            <span>Show in Folder</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {pinnedTools.length > 0 && (
                <div className="space-y-2">
                  <h2 className="text-xs font-semibold text-content-secondary">Pinned Tools</h2>
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
