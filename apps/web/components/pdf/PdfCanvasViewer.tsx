'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Search,
  PenTool,
  Minimize2,
  Lock,
  Scissors,
  ScanText,
  FileSignature,
  Info,
  Layers,
  FileText,
  Image as ImageIcon,
  RotateCw,
  BookOpen,
  Sun,
  Moon,
  Contrast,
  Maximize2,
  MoveHorizontal,
  Download,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
} from 'lucide-react';
import PdfToolShell from './PdfToolShell';
import MuxaroCopilotPanel from '@/components/ai/MuxaroCopilotPanel';
import type { NormalizedRect } from '@/lib/ai';
import { useOpenedArtifact } from '@/lib/opened-artifact';
import { saveOrShareArtifact } from '@/lib/native-bridge';
import {
  getPdfMetadata,
  getPdfThumbnails,
  loadPdfJsDocument,
  renderPdfPageToCanvas,
  rotatePdfPages,
  type PdfMetadataValues,
} from '@/lib/pdf';

type ReadingTheme = 'day' | 'sepia' | 'night' | 'contrast';
type SidebarTab = 'thumbs' | 'outline' | 'info';

interface OutlineItem {
  title: string;
  pageNumber: number | null;
  level: number;
}

const READER_ACTION_BAR = [
  { href: '/tools/pdf/edit', label: 'Edit', Icon: PenTool },
  { href: '/tools/pdf/sign', label: 'Sign', Icon: FileSignature },
  { href: '/tools/pdf/compress', label: 'Compress', Icon: Minimize2 },
  { href: '/tools/pdf/merge', label: 'Merge', Icon: Layers },
  { href: '/tools/pdf/split', label: 'Split', Icon: Scissors },
  { href: '/tools/pdf/protect', label: 'Protect', Icon: Lock },
  { href: '/tools/pdf/pdf-to-word', label: 'Word', Icon: FileText },
  { href: '/tools/pdf/pdf-to-jpg', label: 'Images', Icon: ImageIcon },
  { href: '/tools/pdf/ocr', label: 'OCR / Text', Icon: ScanText },
];

const THEME_FILTER: Record<ReadingTheme, string> = {
  day: 'none',
  sepia: 'sepia(0.32) brightness(0.97) contrast(1.03)',
  night: 'invert(0.91) hue-rotate(180deg) contrast(0.96)',
  contrast: 'grayscale(1) contrast(1.38)',
};

export default function PdfCanvasViewer() {
  const router = useRouter();
  const { setArtifactFromFile } = useOpenedArtifact();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const thumbAbortRef = useRef<AbortController | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [isDirtyBuffer, setIsDirtyBuffer] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [zoom, setZoom] = useState(1.25);
  const [basePageDims, setBasePageDims] = useState<{ w: number; h: number } | null>(null);
  const [readingTheme, setReadingTheme] = useState<ReadingTheme>('day');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('thumbs');

  const [meta, setMeta] = useState<PdfMetadataValues | null>(null);
  const [thumbs, setThumbs] = useState<Array<{ pageNumber: number; dataUrl: string }>>([]);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [matchingPages, setMatchingPages] = useState<number[]>([]);
  const [matchCursor, setMatchCursor] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [citationHighlight, setCitationHighlight] = useState<{
    pageNumber: number;
    rects: NormalizedRect[];
  } | null>(null);

  useEffect(() => {
    setPageInput(String(pageNumber));
  }, [pageNumber]);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setRendering(true);
    setViewerError(null);
    loadPdfJsDocument(file)
      .then(async (pdf) => {
        if (cancelled) {
          await pdf.destroy();
          return;
        }
        setNumPages(pdf.numPages);
        const safePage = Math.min(pageNumber, pdf.numPages);
        const page = await pdf.getPage(safePage);
        const vp1 = page.getViewport({ scale: 1 });
        if (!cancelled) {
          setBasePageDims({ w: vp1.width, h: vp1.height });
        }
        page.cleanup();
        if (canvasRef.current) {
          await renderPdfPageToCanvas(pdf, safePage, canvasRef.current, zoom);
        }
        await pdf.destroy();
      })
      .catch((err) => {
        if (!cancelled) {
          setViewerError(err instanceof Error ? err.message : 'Unable to render PDF page.');
        }
      })
      .finally(() => {
        if (!cancelled) setRendering(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file, pageNumber, zoom]);

  // Keyboard navigation (PDF Expert / Apple Preview ergonomics)
  useEffect(() => {
    if (!file) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        setPageNumber((p) => Math.min(numPages || 1, p + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setPageNumber((p) => Math.max(1, p - 1));
      } else if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        setZoom((z) => Math.min(3, Number((z + 0.2).toFixed(2))));
      } else if (e.key === '-') {
        e.preventDefault();
        setZoom((z) => Math.max(0.4, Number((z - 0.2).toFixed(2))));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [file, numPages]);

  useEffect(() => {
    return () => {
      thumbAbortRef.current?.abort();
    };
  }, []);

  const loadOutlineForFile = useCallback(async (targetFile: File) => {
    try {
      const pdf = await loadPdfJsDocument(targetFile);
      try {
        const rawOutline = await pdf.getOutline();
        if (!rawOutline || rawOutline.length === 0) {
          setOutline([]);
          return;
        }
        const flat: OutlineItem[] = [];
        const walk = async (items: any[], level: number) => {
          for (const item of items) {
            if (!item || flat.length >= 120) break;
            let pageNo: number | null = null;
            try {
              let dest = item.dest;
              if (typeof dest === 'string') {
                dest = await pdf.getDestination(dest);
              }
              if (Array.isArray(dest) && dest[0]) {
                const idx = await pdf.getPageIndex(dest[0]);
                pageNo = idx + 1;
              }
            } catch {
              pageNo = null;
            }
            flat.push({
              title: String(item.title || 'Untitled section'),
              pageNumber: pageNo,
              level,
            });
            if (Array.isArray(item.items) && item.items.length > 0) {
              await walk(item.items, Math.min(3, level + 1));
            }
          }
        };
        await walk(rawOutline, 0);
        setOutline(flat);
      } finally {
        await pdf.destroy();
      }
    } catch {
      setOutline([]);
    }
  }, []);

  const handleFiles = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    thumbAbortRef.current?.abort();
    const ctrl = new AbortController();
    thumbAbortRef.current = ctrl;
    setFile(f);
    setIsDirtyBuffer(false);
    setViewerError(null);
    setPageNumber(1);
    setMatchingPages([]);
    setMatchCursor(0);
    setThumbs([]);
    setOutline([]);
    setArtifactFromFile(f, 'pdf', '/tools/pdf/view');

    void getPdfMetadata(f)
      .then(setMeta)
      .catch(() => setMeta(null));

    void loadOutlineForFile(f);

    void getPdfThumbnails(f, {
      scale: 0.22,
      maxPages: 40,
      signal: ctrl.signal,
      onPage: (p, url) => {
        if (ctrl.signal.aborted) return;
        setThumbs((prev) =>
          prev.some((x) => x.pageNumber === p) ? prev : [...prev, { pageNumber: p, dataUrl: url }]
        );
      },
    }).catch(() => {});
  };

  const handleQuickRotatePage = async () => {
    if (!file) return;
    try {
      setRendering(true);
      const res = await rotatePdfPages(file, { [pageNumber]: 90 });
      const updated = new File([res.blob], file.name, { type: 'application/pdf' });
      setFile(updated);
      setIsDirtyBuffer(true);
      setArtifactFromFile(updated, 'pdf', '/tools/pdf/view');
    } catch (err) {
      setViewerError(err instanceof Error ? err.message : 'Unable to rotate page.');
    } finally {
      setRendering(false);
    }
  };

  const handleFitWidth = () => {
    if (!stageRef.current || !basePageDims) return;
    const availW = Math.max(240, stageRef.current.clientWidth - 40);
    const nextZoom = Math.max(0.4, Math.min(3, Number((availW / basePageDims.w).toFixed(2))));
    setZoom(nextZoom);
  };

  const handleFitPage = () => {
    if (!stageRef.current || !basePageDims) return;
    const availW = Math.max(240, stageRef.current.clientWidth - 40);
    const availH = Math.max(360, window.innerHeight - 280);
    const nextZoom = Math.max(
      0.4,
      Math.min(3, Number(Math.min(availW / basePageDims.w, availH / basePageDims.h).toFixed(2)))
    );
    setZoom(nextZoom);
  };

  const handleSearch = async () => {
    if (!file || !searchTerm.trim()) {
      setMatchingPages([]);
      setMatchCursor(0);
      return;
    }
    const q = searchTerm.trim().toLowerCase();
    const pdf = await loadPdfJsDocument(file);
    const hits: number[] = [];
    try {
      for (let i = 1; i <= pdf.numPages; i += 1) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        const txt = tc.items.map((it) => ('str' in it ? it.str : '')).join(' ').toLowerCase();
        if (txt.includes(q)) hits.push(i);
        page.cleanup();
      }
      setMatchingPages(hits);
      setMatchCursor(0);
      if (hits.length > 0) setPageNumber(hits[0]);
    } finally {
      await pdf.destroy();
    }
  };

  const jumpMatch = (dir: 1 | -1) => {
    if (!matchingPages.length) return;
    const next = (matchCursor + dir + matchingPages.length) % matchingPages.length;
    setMatchCursor(next);
    setPageNumber(matchingPages[next]);
  };

  const handoffTo = (href: string) => {
    if (!file) return;
    setArtifactFromFile(file, 'pdf', '/tools/pdf/view');
    router.push(`${href}?handoff=1`);
  };

  return (
    <PdfToolShell
      title="Read & inspect PDF"
      description="Fast local reader with Day/Sepia/Night reading themes, outline navigation, fit controls, and instant tool handoff."
      currentHref="/tools/pdf/view"
      selectedFiles={file ? [file] : []}
      onFilesSelected={handleFiles}
      hideSubmitBar
    >
      {file && (
        <div className="space-y-3.5">
          {/* Primary Action & Handoff Toolbar (PDF Expert + PDFgear style) */}
          <div className="p-3 rounded-2xl border border-line bg-surface flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSidebarOpen((v) => !v)}
                aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
                className="p-1.5 rounded-xl border border-line bg-surface-elevated text-content-secondary hover:text-content"
              >
                {sidebarOpen ? (
                  <PanelLeftClose className="w-4 h-4" />
                ) : (
                  <PanelLeftOpen className="w-4 h-4" />
                )}
              </button>

              <span className="text-[11px] font-semibold text-content-secondary px-1">
                {isDirtyBuffer ? 'Modified buffer:' : 'Tools:'}
              </span>

              {READER_ACTION_BAR.map(({ href, label, Icon }) => (
                <button
                  key={href}
                  type="button"
                  onClick={() => handoffTo(href)}
                  className="px-2.5 py-1.5 rounded-xl border border-line bg-surface-elevated hover:bg-brand hover:text-white hover:border-brand text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                >
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}

              <button
                type="button"
                onClick={handleQuickRotatePage}
                disabled={rendering}
                title="Rotate current page 90° clockwise"
                className="px-2.5 py-1.5 rounded-xl border border-line bg-surface-elevated hover:bg-surface-interactive text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
              >
                <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Rotate</span>
              </button>

              <button
                type="button"
                onClick={() => void saveOrShareArtifact(file, file.name, file.name)}
                className="px-2.5 py-1.5 rounded-xl bg-brand text-white text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Save Copy</span>
              </button>

              <button
                type="button"
                onClick={() => setCopilotOpen((v) => !v)}
                className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                  copilotOpen
                    ? 'border-brand/40 bg-brand/10 text-brand'
                    : 'border-line bg-surface-elevated text-content hover:border-line-hover'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
                <span>Assistant</span>
              </button>
            </div>

            {/* Reading Modes, Search, Pagination & Fit/Zoom */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Reading Theme Switcher (Day / Sepia / Night / High Contrast) */}
              <div
                className="inline-flex items-center rounded-xl border border-line bg-surface-elevated p-0.5 gap-0.5"
                role="group"
                aria-label="Reading theme"
              >
                {(
                  [
                    { id: 'day', label: 'Day', icon: Sun },
                    { id: 'sepia', label: 'Sepia', icon: BookOpen },
                    { id: 'night', label: 'Night', icon: Moon },
                    { id: 'contrast', label: 'Contrast', icon: Contrast },
                  ] as const
                ).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setReadingTheme(id)}
                    title={`${label} reading mode`}
                    className={`px-2 py-1 rounded-lg text-[11px] font-medium inline-flex items-center gap-1 ${
                      readingTheme === id
                        ? 'bg-brand text-white'
                        : 'text-content-secondary hover:text-content'
                    }`}
                  >
                    <Icon className="w-3 h-3" aria-hidden="true" />
                    <span className="hidden xl:inline">{label}</span>
                  </button>
                ))}
              </div>

              {/* Text Search */}
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleSearch();
                    }
                  }}
                  placeholder="Find text…"
                  className="px-2.5 py-1.5 rounded-lg border border-line bg-surface-elevated text-xs text-content w-32"
                />
                <button
                  type="button"
                  onClick={handleSearch}
                  className="p-1.5 rounded-lg border border-line bg-surface-elevated"
                  aria-label="Search text"
                >
                  <Search className="w-3.5 h-3.5" />
                </button>
                {matchingPages.length > 0 && (
                  <div className="inline-flex items-center gap-1 text-[11px] text-brand font-medium">
                    <span>
                      {matchCursor + 1}/{matchingPages.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => jumpMatch(1)}
                      className="px-1.5 py-0.5 rounded bg-brand/10 hover:bg-brand/20"
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>

              {/* Page Jump */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={pageNumber <= 1}
                  onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                  className="p-1.5 rounded-lg border border-line bg-surface-elevated disabled:opacity-40"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const n = Math.max(1, Math.min(numPages || 1, Number(pageInput) || 1));
                    setPageNumber(n);
                  }}
                  className="flex items-center gap-1 text-xs font-mono"
                >
                  <input
                    type="text"
                    inputMode="numeric"
                    value={pageInput}
                    onChange={(e) => setPageInput(e.target.value)}
                    aria-label="Page number"
                    className="w-10 text-center py-1 rounded-md border border-line bg-surface-elevated text-xs text-content"
                  />
                  <span className="text-content-secondary">/{numPages || '—'}</span>
                </form>
                <button
                  type="button"
                  disabled={pageNumber >= numPages}
                  onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
                  className="p-1.5 rounded-lg border border-line bg-surface-elevated disabled:opacity-40"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Fit & Zoom */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleFitWidth}
                  title="Fit width"
                  className="p-1.5 rounded-lg border border-line bg-surface-elevated text-content-secondary hover:text-content"
                  aria-label="Fit width"
                >
                  <MoveHorizontal className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleFitPage}
                  title="Fit page"
                  className="p-1.5 rounded-lg border border-line bg-surface-elevated text-content-secondary hover:text-content"
                  aria-label="Fit page"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.4, Number((z - 0.2).toFixed(2))))}
                  className="p-1.5 rounded-lg border border-line bg-surface-elevated"
                  aria-label="Zoom out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-xs font-mono px-1 tabular-nums">{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(3, Number((z + 0.2).toFixed(2))))}
                  className="p-1.5 rounded-lg border border-line bg-surface-elevated"
                  aria-label="Zoom in"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* Sidebar Rail: Pages / Outline / Info */}
            {sidebarOpen && (
              <aside className="hidden lg:flex lg:col-span-2 flex-col gap-2.5 max-h-[700px] overflow-y-auto p-2.5 rounded-2xl border border-line bg-surface">
                <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-surface-elevated border border-line">
                  {(
                    [
                      { id: 'thumbs', label: 'Pages' },
                      { id: 'outline', label: 'Outline' },
                      { id: 'info', label: 'Info' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSidebarTab(t.id)}
                      className={`py-1 rounded-lg text-[11px] font-semibold ${
                        sidebarTab === t.id ? 'bg-brand text-white' : 'text-content-secondary hover:text-content'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {sidebarTab === 'thumbs' && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold text-content-secondary px-1">
                      {numPages} pages
                    </div>
                    {thumbs.map((t) => (
                      <button
                        key={t.pageNumber}
                        type="button"
                        onClick={() => setPageNumber(t.pageNumber)}
                        className={`w-full p-1.5 rounded-xl border text-center transition-colors ${
                          pageNumber === t.pageNumber
                            ? 'border-brand ring-2 ring-brand/25 bg-brand/5'
                            : 'border-line bg-surface-elevated hover:border-line-hover'
                        }`}
                      >
                        <img
                          src={t.dataUrl}
                          alt={`Page ${t.pageNumber}`}
                          className="w-full rounded bg-white"
                        />
                        <span className="text-[10px] font-mono text-content-secondary block mt-1">
                          {t.pageNumber}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {sidebarTab === 'outline' && (
                  <div className="space-y-1">
                    {outline.length === 0 ? (
                      <div className="text-xs text-content-secondary p-2">
                        This PDF has no embedded bookmarks or table of contents.
                      </div>
                    ) : (
                      outline.map((item, idx) => (
                        <button
                          key={`${item.title}-${idx}`}
                          type="button"
                          disabled={!item.pageNumber}
                          onClick={() => {
                            if (item.pageNumber) setPageNumber(item.pageNumber);
                          }}
                          style={{ paddingLeft: `${8 + item.level * 12}px` }}
                          className="w-full text-left py-1.5 pr-2 rounded-lg text-xs text-content-secondary hover:text-content hover:bg-surface-elevated flex items-center justify-between gap-2 disabled:opacity-50"
                        >
                          <span className="truncate">{item.title}</span>
                          {item.pageNumber && (
                            <span className="text-[10px] font-mono text-content-tertiary shrink-0">
                              {item.pageNumber}
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}

                {sidebarTab === 'info' && (
                  <div className="p-2 text-xs space-y-2 text-content-secondary">
                    <div className="flex items-center gap-1.5 font-semibold text-content">
                      <Info className="w-3.5 h-3.5 text-brand" />
                      <span>Document Properties</span>
                    </div>
                    <div>
                      <div className="text-[10px] text-content-tertiary">File</div>
                      <div className="font-medium text-content break-all">{file.name}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-content-tertiary">Pages</div>
                      <div className="font-mono text-content">{numPages}</div>
                    </div>
                    {meta && (
                      <>
                        <div>
                          <div className="text-[10px] text-content-tertiary">Title</div>
                          <div className="text-content break-words">{meta.title || '—'}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-content-tertiary">Author</div>
                          <div className="text-content break-words">{meta.author || '—'}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-content-tertiary">Creator</div>
                          <div className="text-content break-words">{meta.creator || '—'}</div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </aside>
            )}

            {/* Main Document Canvas */}
            <div
              ref={stageRef}
              className={`${
                sidebarOpen && copilotOpen
                  ? 'lg:col-span-6'
                  : sidebarOpen
                    ? 'lg:col-span-10'
                    : copilotOpen
                      ? 'lg:col-span-8'
                      : 'lg:col-span-12'
              } p-4 rounded-2xl border border-line bg-surface-elevated overflow-auto flex flex-col items-center min-h-[520px]`}
            >
              {viewerError && (
                <div className="w-full mb-3 p-3 rounded-xl bg-error-bg border border-error text-error text-xs font-medium">
                  {viewerError}
                </div>
              )}
              <div className="relative">
                {rendering && (
                  <div className="text-xs text-content-secondary mb-2">Rendering page…</div>
                )}
                <canvas
                  ref={canvasRef}
                  style={{ filter: THEME_FILTER[readingTheme] }}
                  className="rounded-lg shadow-md bg-white max-w-full h-auto"
                />
                {citationHighlight &&
                  citationHighlight.pageNumber === pageNumber &&
                  citationHighlight.rects.map((r, i) => (
                    <div
                      key={i}
                      aria-hidden="true"
                      style={{
                        left: `${Math.max(0, Math.min(99, r.x * 100))}%`,
                        top: `${Math.max(0, Math.min(99, r.y * 100))}%`,
                        width: `${Math.max(1, Math.min(100, r.width * 100))}%`,
                        height: `${Math.max(1, Math.min(100, r.height * 100))}%`,
                      }}
                      className="pointer-events-none absolute rounded bg-amber-400/35 ring-2 ring-brand"
                    />
                  ))}
              </div>
            </div>

            {/* Docked Split-Pane Assistant (never overlaps canvas) */}
            {copilotOpen && (
              <div className="lg:col-span-4 h-[680px]">
                <MuxaroCopilotPanel
                  open={copilotOpen}
                  onClose={() => setCopilotOpen(false)}
                  activeFile={file}
                  variant="split"
                  onJumpToCitation={(pg, rects) => {
                    setPageNumber(pg);
                    setCitationHighlight({ pageNumber: pg, rects });
                  }}
                  onFileMutated={(updated) => {
                    setFile(updated);
                    setIsDirtyBuffer(true);
                    setCitationHighlight(null);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </PdfToolShell>
  );
}
