'use client';

import React, { useEffect, useRef, useState } from 'react';
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
} from 'lucide-react';
import PdfToolShell from './PdfToolShell';
import { useOpenedArtifact } from '@/lib/opened-artifact';
import {
  getPdfMetadata,
  getPdfThumbnails,
  loadPdfJsDocument,
  renderPdfPageToCanvas,
  rotatePdfPages,
  type PdfMetadataValues,
} from '@/lib/pdf';

const SMALLPDF_ACTION_BAR = [
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

export default function PdfCanvasViewer() {
  const router = useRouter();
  const { setArtifactFromFile } = useOpenedArtifact();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const thumbAbortRef = useRef<AbortController | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [isDirtyBuffer, setIsDirtyBuffer] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1.25);
  const [meta, setMeta] = useState<PdfMetadataValues | null>(null);
  const [thumbs, setThumbs] = useState<Array<{ pageNumber: number; dataUrl: string }>>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [matchingPages, setMatchingPages] = useState<number[]>([]);
  const [rendering, setRendering] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);

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
        if (canvasRef.current) {
          await renderPdfPageToCanvas(pdf, Math.min(pageNumber, pdf.numPages), canvasRef.current, zoom);
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

  useEffect(() => {
    return () => {
      thumbAbortRef.current?.abort();
    };
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
    setThumbs([]);
    setArtifactFromFile(f, 'pdf', '/tools/pdf/view');
    try {
      setMeta(await getPdfMetadata(f));
    } catch {
      setMeta(null);
    }
    void getPdfThumbnails(f, {
      scale: 0.22,
      maxPages: 40,
      signal: ctrl.signal,
      onPage: (p, url) => {
        if (ctrl.signal.aborted) return;
        setThumbs((prev) => (prev.some((x) => x.pageNumber === p) ? prev : [...prev, { pageNumber: p, dataUrl: url }]));
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

  const handleSearch = async () => {
    if (!file || !searchTerm.trim()) {
      setMatchingPages([]);
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
      if (hits.length > 0) setPageNumber(hits[0]);
    } finally {
      await pdf.destroy();
    }
  };

  const handoffTo = (href: string) => {
    if (!file) return;
    setArtifactFromFile(file, 'pdf', '/tools/pdf/view');
    router.push(`${href}?handoff=1`);
  };

  return (
    <PdfToolShell
      title="Read & inspect PDF"
      description="Smallpdf-style clean viewer with page thumbnail rail, text search, and instant jump to Edit, Sign, or Compress."
      currentHref="/tools/pdf/view"
      selectedFiles={file ? [file] : []}
      onFilesSelected={handleFiles}
      hideSubmitBar
    >
      {file && (
        <div className="space-y-4">
          {/* Smallpdf Benchmark: Clean Viewer Action Bar */}
          <div className="p-3 rounded-2xl border border-line bg-surface flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-content-secondary px-1.5">
                Continue with{isDirtyBuffer ? ' (modified)' : ''}:
              </span>
              {SMALLPDF_ACTION_BAR.map(({ href, label, Icon }) => (
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
                title="Rotate current page 90° clockwise (updates buffer passed forward)"
                className="px-2.5 py-1.5 rounded-xl border border-line bg-surface-elevated hover:bg-surface-muted text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
              >
                <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Rotate 90°</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
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
                  className="px-2.5 py-1.5 rounded-lg border border-line bg-surface-elevated text-xs text-content w-36"
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
                  <span className="text-[11px] text-brand font-medium">
                    Hits: {matchingPages.join(', ')}
                  </span>
                )}
              </div>

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
                <span className="text-xs font-mono px-1.5 tabular-metrics">
                  {pageNumber}/{numPages || '—'}
                </span>
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

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                  className="p-1.5 rounded-lg border border-line bg-surface-elevated"
                  aria-label="Zoom out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-xs font-mono px-1 tabular-metrics">{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
                  className="p-1.5 rounded-lg border border-line bg-surface-elevated"
                  aria-label="Zoom in"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* Thumbnail Rail */}
            <aside className="hidden lg:flex flex-col gap-2 max-h-[680px] overflow-y-auto p-2.5 rounded-2xl border border-line bg-surface">
              <div className="text-[11px] font-bold text-content-secondary px-1">Pages ({numPages})</div>
              {thumbs.map((t) => (
                <button
                  key={t.pageNumber}
                  type="button"
                  onClick={() => setPageNumber(t.pageNumber)}
                  className={`p-1.5 rounded-xl border text-center transition-colors ${
                    pageNumber === t.pageNumber
                      ? 'border-brand ring-2 ring-brand/25 bg-brand/5'
                      : 'border-line bg-surface-elevated hover:border-line-hover'
                  }`}
                >
                  <img src={t.dataUrl} alt={`Page ${t.pageNumber}`} className="w-full rounded bg-white" />
                  <span className="text-[10px] font-mono text-content-secondary block mt-1">
                    {t.pageNumber}
                  </span>
                </button>
              ))}
              {meta && (
                <div className="mt-2 pt-2 border-t border-line text-[11px] space-y-1 px-1 text-content-secondary">
                  <div className="flex items-center gap-1 font-bold text-content">
                    <Info className="w-3 h-3" />
                    <span>Info</span>
                  </div>
                  <div className="truncate">Title: {meta.title || '-'}</div>
                  <div className="truncate">Author: {meta.author || '-'}</div>
                </div>
              )}
            </aside>

            {/* Main Canvas */}
            <div className="lg:col-span-4 p-4 rounded-2xl border border-line bg-surface-elevated overflow-auto flex flex-col items-center min-h-[480px]">
              {viewerError && (
                <div className="w-full mb-3 p-3 rounded-xl bg-error-bg border border-error text-error text-xs font-medium">
                  {viewerError}
                </div>
              )}
              <div className="relative">
                {rendering && (
                  <div className="text-xs text-content-secondary mb-2">Rendering page…</div>
                )}
                <canvas ref={canvasRef} className="rounded-lg shadow-md bg-white max-w-full h-auto" />
              </div>
            </div>
          </div>
        </div>
      )}
    </PdfToolShell>
  );
}
