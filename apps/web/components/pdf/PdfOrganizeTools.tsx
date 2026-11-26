'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowDownAZ,
  ArrowUpZA,
  Trash2,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  RotateCw,
  Copy,
  FilePlus2,
  Plus,
  Sparkles,
  BookOpen,
  Layers,
  Columns2,
  Loader2,
  CheckCircle2,
  QrCode,
  Undo2,
  Redo2,
  ShieldAlert,
} from 'lucide-react';
import { PDFDocument } from 'pdf-lib';
import PdfToolShell from './PdfToolShell';
import PdfPageGrid from './PdfPageGrid';
import { formatBytes } from '@/lib/formatters';
import {
  cropPdfPages,
  deletePagesFromPdf,
  detectBlankPages,
  extractPagesFromPdf,
  formatPagesToRangeString,
  getPdfPageInfos,
  getPdfThumbnails,
  loadPdfJsDocument,
  mergePdfs,
  parsePageRange,
  removeBlankPagesFromPdf,
  renderPdfPageToCanvas,
  reorderPdfPages,
  rotatePdfPages,
  sanitizeFilenameStem,
  splitPdf,
} from '@/lib/pdf';
import {
  autoRotatePdf,
  inspectPdfBookmarks,
  mergePdfPagesExpanded,
  rotatePdfByOrientation,
  splitPdfByBookmarks,
} from '@/lib/pdf/pdf-document';
import type { BookmarkSplitEntry, PdfPageInfo, PdfProcessResult } from '@/lib/pdf/types';

interface QueuedMergeFile {
  id: string;
  file: File;
  pageRange: string;
  thumbUrl?: string;
  pageCount?: number;
}

interface MergePageSlot {
  key: string;
  fileId: string;
  file: File;
  fileName: string;
  pageNumber: number;
  pageIndex: number;
  dataUrl?: string;
}

export function PdfMergeTool() {
  const [items, setItems] = useState<QueuedMergeFile[]>([]);
  const [mergeMode, setMergeMode] = useState<'file' | 'page' | 'interleave'>('file');
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [pageSlots, setPageSlots] = useState<MergePageSlot[]>([]);
  const [loadingPages, setLoadingPages] = useState(false);
  const [pageDragIdx, setPageDragIdx] = useState<number | null>(null);
  const [pageOverIdx, setPageOverIdx] = useState<number | null>(null);
  const [interleavingNow, setInterleavingNow] = useState(false);
  const [interleaveError, setInterleaveError] = useState<string | null>(null);
  const [externalResult, setExternalResult] = useState<PdfProcessResult | null>(null);

  const thumbCacheRef = useRef<Map<string, Array<{ pageNumber: number; dataUrl: string }>>>(
    new Map()
  );

  const addFiles = (files: File[]) => {
    const base = Date.now();
    const newEntries: QueuedMergeFile[] = files.map((file, idx) => ({
      id: `${base}-${idx}-${file.name}`,
      file,
      pageRange: '',
    }));
    setItems((prev) => [...prev, ...newEntries]);
    setExternalResult(null);
    setInterleaveError(null);

    newEntries.forEach((entry) => {
      void getPdfThumbnails(entry.file, { scale: 0.28, maxPages: 1 })
        .then((res) => {
          if (res[0]) {
            setItems((curr) =>
              curr.map((x) => (x.id === entry.id ? { ...x, thumbUrl: res[0].dataUrl } : x))
            );
          }
        })
        .catch(() => {});
      void loadPdfJsDocument(entry.file)
        .then(async (pdf) => {
          const n = pdf.numPages;
          await pdf.destroy();
          setItems((curr) =>
            curr.map((x) => (x.id === entry.id ? { ...x, pageCount: n } : x))
          );
        })
        .catch(() => {});
    });
  };

  const move = (fromIdx: number, toIdx: number) => {
    if (toIdx < 0 || toIdx >= items.length || fromIdx === toIdx) return;
    const copy = [...items];
    const [moved] = copy.splice(fromIdx, 1);
    copy.splice(toIdx, 0, moved);
    setItems(copy);
  };

  const sortByName = (direction: 'asc' | 'desc') => {
    const next = [...items].sort((a, b) =>
      a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: 'base' })
    );
    const ordered = direction === 'desc' ? next.reverse() : next;
    setItems(ordered);
    if (mergeMode === 'page') {
      void rebuildPageSlotsFromFiles(ordered);
    }
  };

  const rebuildPageSlotsFromFiles = async (
    fileList: QueuedMergeFile[],
    signal?: AbortSignal
  ) => {
    if (fileList.length === 0) {
      setPageSlots([]);
      return;
    }
    setLoadingPages(true);
    try {
      const built: MergePageSlot[] = [];
      for (const entry of fileList) {
        if (signal?.aborted) return;
        let pages = thumbCacheRef.current.get(entry.id);
        if (!pages) {
          const rendered = await getPdfThumbnails(entry.file, { scale: 0.26, signal });
          pages = rendered.map((p) => ({ pageNumber: p.pageNumber, dataUrl: p.dataUrl }));
          thumbCacheRef.current.set(entry.id, pages);
          setItems((curr) =>
            curr.map((x) =>
              x.id === entry.id ? { ...x, pageCount: x.pageCount ?? pages!.length } : x
            )
          );
        }
        for (const p of pages) {
          built.push({
            key: `${entry.id}-p${p.pageNumber}`,
            fileId: entry.id,
            file: entry.file,
            fileName: entry.file.name,
            pageNumber: p.pageNumber,
            pageIndex: p.pageNumber - 1,
            dataUrl: p.dataUrl,
          });
        }
      }
      if (!signal?.aborted) {
        setPageSlots(built);
      }
    } finally {
      if (!signal?.aborted) setLoadingPages(false);
    }
  };

  useEffect(() => {
    if (mergeMode !== 'page') return;
    const ctrl = new AbortController();
    void rebuildPageSlotsFromFiles(items, ctrl.signal);
    return () => ctrl.abort();
  }, [mergeMode, items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const movePageSlot = (fromIdx: number, toIdx: number) => {
    if (toIdx < 0 || toIdx >= pageSlots.length || fromIdx === toIdx) return;
    setPageSlots((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, moved);
      return copy;
    });
  };

  const buildInterleaveSequence = async (
    fileA: QueuedMergeFile,
    fileB: QueuedMergeFile
  ): Promise<Array<{ file: File; pageIndex: number }>> => {
    const resolveCount = async (entry: QueuedMergeFile) => {
      if (entry.pageCount && entry.pageCount > 0) return entry.pageCount;
      const pdf = await loadPdfJsDocument(entry.file);
      const count = pdf.numPages;
      await pdf.destroy();
      return count;
    };
    const [countA, countB] = await Promise.all([resolveCount(fileA), resolveCount(fileB)]);
    const seq: Array<{ file: File; pageIndex: number }> = [];
    const maxLen = Math.max(countA, countB);
    for (let i = 0; i < maxLen; i += 1) {
      if (i < countA) {
        seq.push({ file: fileA.file, pageIndex: i });
      }
      const reverseIdx = countB - 1 - i;
      if (reverseIdx >= 0) {
        seq.push({ file: fileB.file, pageIndex: reverseIdx });
      }
    }
    return seq;
  };

  const runQuickInterleave = async () => {
    if (items.length !== 2) return;
    setInterleavingNow(true);
    setInterleaveError(null);
    try {
      const seq = await buildInterleaveSequence(items[0], items[1]);
      const stem = sanitizeFilenameStem(items[0].file.name, 'duplex');
      const res = await mergePdfPagesExpanded(seq, {
        outputName: `${stem}-duplex-interleaved.pdf`,
      });
      setExternalResult(res);
    } catch (err) {
      setInterleaveError(err instanceof Error ? err.message : 'Interleave failed.');
    } finally {
      setInterleavingNow(false);
    }
  };

  const canSubmit =
    mergeMode === 'file'
      ? items.length >= 2
      : mergeMode === 'page'
      ? pageSlots.length >= 1
      : items.length === 2;

  const submitLabel =
    mergeMode === 'file'
      ? `Merge ${items.length} PDF(s)`
      : mergeMode === 'page'
      ? `Merge ${pageSlots.length} Arranged Page(s)`
      : 'Interleave & Merge Duplex PDF';

  return (
    <PdfToolShell
      title="Merge PDF"
      description="Combine PDFs in File Order, drag individual pages across files in Page-Level View, or duplex-interleave Front + Reverse Back scans."
      currentHref="/tools/pdf/merge"
      multiple
      selectedFiles={items.map((i) => i.file)}
      onFilesSelected={addFiles}
      submitLabel={submitLabel}
      canSubmit={canSubmit}
      externalResult={externalResult}
      onClearExternalResult={() => setExternalResult(null)}
      onRun={async (onProgress, signal) => {
        if (mergeMode === 'file') {
          return mergePdfs(
            items.map((i) => ({ file: i.file, pageRange: i.pageRange })),
            onProgress,
            signal
          );
        }
        if (mergeMode === 'page') {
          const stem = sanitizeFilenameStem(items[0]?.file.name || 'merged', 'merged');
          return mergePdfPagesExpanded(
            pageSlots.map((s) => ({ file: s.file, pageIndex: s.pageIndex })),
            { outputName: `${stem}-custom-pages.pdf`, signal, onProgress }
          );
        }
        const seq = await buildInterleaveSequence(items[0], items[1]);
        const stem = sanitizeFilenameStem(items[0].file.name, 'duplex');
        return mergePdfPagesExpanded(seq, {
          outputName: `${stem}-duplex-interleaved.pdf`,
          signal,
          onProgress,
        });
      }}
    >
      {items.length > 0 && (
        <div className="space-y-4">
          {/* File Queue Control Bar */}
          <div className="p-3.5 rounded-2xl border border-line bg-surface flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: 'file' as const, label: 'File Order' },
                { id: 'page' as const, label: 'Page-Level View' },
                { id: 'interleave' as const, label: 'Interleave / Duplex Collate' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMergeMode(m.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                    mergeMode === m.id
                      ? 'bg-brand text-white border-brand'
                      : 'bg-surface-elevated text-content border-line hover:bg-surface-muted'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => sortByName('asc')}
                className="px-2.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-1 hover:bg-surface-muted"
              >
                <ArrowDownAZ className="w-3.5 h-3.5" />
                <span>Sort A → Z</span>
              </button>
              <button
                type="button"
                onClick={() => sortByName('desc')}
                className="px-2.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-1 hover:bg-surface-muted"
              >
                <ArrowUpZA className="w-3.5 h-3.5" />
                <span>Sort Z → A</span>
              </button>
              {items.length === 2 && (
                <button
                  type="button"
                  disabled={interleavingNow}
                  onClick={runQuickInterleave}
                  className="px-3 py-1.5 rounded-xl border border-brand/40 bg-brand/10 text-brand text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-brand/15 disabled:opacity-50"
                >
                  {interleavingNow ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Columns2 className="w-3.5 h-3.5" />
                  )}
                  <span>Interleave (Front + Reverse Back)</span>
                </button>
              )}
            </div>
          </div>

          {interleaveError && (
            <div className="p-3 rounded-xl border border-error/40 bg-error-bg/40 text-xs text-error">
              {interleaveError}
            </div>
          )}

          {mergeMode === 'file' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((item, idx) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={() => setDragIdx(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIdx !== null) move(dragIdx, idx);
                    setDragIdx(null);
                  }}
                  className="p-3.5 rounded-2xl border border-line bg-surface flex flex-col gap-3 cursor-grab active:cursor-grabbing"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-16 h-20 rounded-lg border border-line bg-white overflow-hidden flex items-center justify-center shrink-0">
                      {item.thumbUrl ? (
                        <img
                          src={item.thumbUrl}
                          alt={item.file.name}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <span className="text-[10px] text-content-muted">PDF</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-content truncate">
                        {idx + 1}. {item.file.name}
                      </div>
                      <div className="text-[11px] text-content-secondary mt-0.5">
                        {formatBytes(item.file.size)}
                        {item.pageCount ? ` · ${item.pageCount} pages` : ''}
                      </div>
                      <input
                        type="text"
                        placeholder="All pages (or 1-3, 5)"
                        value={item.pageRange}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((it) =>
                              it.id === item.id ? { ...it, pageRange: e.target.value } : it
                            )
                          )
                        }
                        className="mt-2 w-full px-2.5 py-1 rounded-lg border border-line bg-surface-elevated text-[11px] text-content"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-1 pt-2 border-t border-line">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => move(idx, idx - 1)}
                      aria-label="Move earlier"
                      className="p-1.5 rounded-lg border border-line bg-surface-elevated disabled:opacity-30"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === items.length - 1}
                      onClick={() => move(idx, idx + 1)}
                      aria-label="Move later"
                      className="p-1.5 rounded-lg border border-line bg-surface-elevated disabled:opacity-30"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        thumbCacheRef.current.delete(item.id);
                        setItems((prev) => prev.filter((it) => it.id !== item.id));
                      }}
                      aria-label="Remove file"
                      className="p-1.5 rounded-lg border border-line bg-surface-elevated text-error"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {mergeMode === 'page' && (
            <div className="p-4 rounded-2xl border border-line bg-surface space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-content-secondary">
                  <Layers className="w-4 h-4 text-brand" />
                  <span>
                    Drag individual pages across any queued PDF ({pageSlots.length} page(s) total).
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void rebuildPageSlotsFromFiles(items)}
                  className="px-3 py-1 rounded-lg border border-line bg-surface-elevated text-xs font-semibold"
                >
                  Reset from file order
                </button>
              </div>

              {loadingPages && (
                <div className="flex items-center gap-2 text-xs text-content-secondary">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Loading page thumbnails across queued PDFs…</span>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-3">
                {pageSlots.map((slot, idx) => {
                  const fileOrderIdx = Math.max(0, items.findIndex((f) => f.id === slot.fileId));
                  const badgePalette = [
                    'bg-blue-600 text-white',
                    'bg-emerald-600 text-white',
                    'bg-amber-600 text-white',
                    'bg-rose-600 text-white',
                    'bg-cyan-600 text-white',
                    'bg-indigo-600 text-white',
                  ];
                  const borderPalette = [
                    'border-blue-500/40',
                    'border-emerald-500/40',
                    'border-amber-500/40',
                    'border-rose-500/40',
                    'border-cyan-500/40',
                    'border-indigo-500/40',
                  ];
                  const badgeClass = badgePalette[fileOrderIdx % badgePalette.length];
                  const colorBorder = borderPalette[fileOrderIdx % borderPalette.length];
                  return (
                  <div
                    key={`${slot.key}-${idx}`}
                    draggable
                    onDragStart={() => setPageDragIdx(idx)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setPageOverIdx(idx);
                    }}
                    onDragLeave={() => {
                      if (pageOverIdx === idx) setPageOverIdx(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (pageDragIdx !== null) movePageSlot(pageDragIdx, idx);
                      setPageDragIdx(null);
                      setPageOverIdx(null);
                    }}
                    onDragEnd={() => {
                      setPageDragIdx(null);
                      setPageOverIdx(null);
                    }}
                    className={`rounded-xl border p-2 bg-surface-elevated flex flex-col gap-1.5 cursor-grab active:cursor-grabbing ${
                      pageOverIdx === idx && pageDragIdx !== idx
                        ? 'border-brand ring-2 ring-brand/40'
                        : colorBorder
                    }`}
                  >
                    <div className="relative aspect-[3/4] rounded-lg bg-white border border-line/50 overflow-hidden flex items-center justify-center">
                      {slot.dataUrl ? (
                        <img
                          src={slot.dataUrl}
                          alt={`${slot.fileName} page ${slot.pageNumber}`}
                          className="max-w-full max-h-full object-contain"
                        />
                      ) : (
                        <span className="text-[10px] text-content-muted">p.{slot.pageNumber}</span>
                      )}
                      <span className={`absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-bold ${badgeClass}`}>
                        F{fileOrderIdx + 1}
                      </span>
                    </div>
                    <div className="text-[10px] font-medium text-content truncate" title={slot.fileName}>
                      {slot.fileName}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-content-secondary">
                      <span className="font-mono">
                        #{idx + 1} (p.{slot.pageNumber})
                      </span>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => movePageSlot(idx, idx - 1)}
                          aria-label="Move page earlier"
                          className="p-0.5 rounded hover:bg-surface disabled:opacity-30"
                        >
                          <ArrowLeft className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === pageSlots.length - 1}
                          onClick={() => movePageSlot(idx, idx + 1)}
                          aria-label="Move page later"
                          className="p-0.5 rounded hover:bg-surface disabled:opacity-30"
                        >
                          <ArrowRight className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={pageSlots.length <= 1}
                          onClick={() =>
                            setPageSlots((prev) => prev.filter((_, slotI) => slotI !== idx))
                          }
                          aria-label="Remove page"
                          className="p-0.5 rounded text-error hover:bg-surface disabled:opacity-30"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
                })}
              </div>
            </div>
          )}

          {mergeMode === 'interleave' && (
            <div className="p-5 rounded-2xl border border-line bg-surface space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-content">
                <Columns2 className="w-4 h-4 text-brand" />
                <span>Duplex Scanner Collation (Alternate + Reverse File B)</span>
              </div>
              {items.length !== 2 ? (
                <p className="text-xs text-amber-500">
                  Duplex Interleave requires exactly 2 PDFs in the queue (currently {items.length}). File 1 = front sides (1, 3, 5…), File 2 = back sides scanned in reverse order (N…4, 2).
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl border border-line bg-surface-elevated space-y-1">
                    <div className="font-semibold text-content">1. Front Stack (Forward Order)</div>
                    <div className="text-content-secondary truncate">{items[0].file.name}</div>
                    <div className="font-mono text-[11px] text-content-muted">
                      Pages: 1 → {items[0].pageCount ?? '?'}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl border border-line bg-surface-elevated space-y-1">
                    <div className="font-semibold text-content">2. Back Stack (Reversed Order)</div>
                    <div className="text-content-secondary truncate">{items[1].file.name}</div>
                    <div className="font-mono text-[11px] text-content-muted">
                      Pages: {items[1].pageCount ?? '?'} → 1 (interleaved after each front)
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </PdfToolShell>
  );
}

export function PdfSplitTool() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<
    'pages-per-file' | 'ranges' | 'extract-all' | 'max-size' | 'bookmarks' | 'qr-divider'
  >('pages-per-file');
  const [pagesPerFile, setPagesPerFile] = useState(1);
  const [rangeSpec, setRangeSpec] = useState('1-3; 4-last');
  const [mergeRanges, setMergeRanges] = useState(false);
  const [maxMb, setMaxMb] = useState(5);
  const [bookmarks, setBookmarks] = useState<BookmarkSplitEntry[]>([]);
  const [inspectingBookmarks, setInspectingBookmarks] = useState(false);
  const [bookmarkError, setBookmarkError] = useState<string | null>(null);
  const [bookmarkLevelFilter, setBookmarkLevelFilter] = useState<'level1' | 'all'>('all');

  useEffect(() => {
    if (!file || mode !== 'bookmarks') return;
    let cancelled = false;
    setInspectingBookmarks(true);
    setBookmarkError(null);
    inspectPdfBookmarks(file)
      .then((entries) => {
        if (!cancelled) setBookmarks(entries);
      })
      .catch((err) => {
        if (!cancelled) {
          setBookmarks([]);
          setBookmarkError(err instanceof Error ? err.message : 'Could not inspect bookmarks.');
        }
      })
      .finally(() => {
        if (!cancelled) setInspectingBookmarks(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file, mode]);

  const filteredBookmarks = useMemo(
    () => (bookmarkLevelFilter === 'level1' ? bookmarks.filter((b) => b.level <= 1) : bookmarks),
    [bookmarks, bookmarkLevelFilter]
  );

  const canSubmit =
    Boolean(file) &&
    (mode !== 'bookmarks' || (!inspectingBookmarks && filteredBookmarks.length > 0));

  return (
    <PdfToolShell
      title="Split PDF"
      description="Split by fixed interval, custom ranges, bookmarks (/Outlines), target max MB, or scanned QR divider sheets."
      currentHref="/tools/pdf/split"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => {
        setFile(files[0] || null);
        setBookmarks([]);
        setBookmarkError(null);
      }}
      canSubmit={canSubmit}
      submitLabel={
        mode === 'bookmarks'
          ? `Split into ${filteredBookmarks.length} Chapter(s)`
          : mode === 'qr-divider'
          ? 'Detect QR Dividers & Split'
          : mergeRanges && mode === 'ranges'
          ? 'Extract Combined PDF'
          : 'Split PDF & Download ZIP'
      }
      onRun={(onProgress, signal) => {
        if (mode === 'bookmarks') {
          return splitPdfByBookmarks(file!, {
            maxLevel: bookmarkLevelFilter === 'level1' ? 1 : Number.POSITIVE_INFINITY,
            signal,
            onProgress,
          });
        }
        return splitPdf(
          file!,
          mode === 'extract-all'
            ? { mode: 'pages-per-file', pagesPerFile: 1 }
            : mode === 'pages-per-file'
            ? { mode: 'pages-per-file', pagesPerFile }
            : mode === 'ranges'
            ? { mode: 'ranges', rangeSpec, mergeRanges }
            : mode === 'qr-divider'
            ? { mode: 'qr-divider' }
            : { mode: 'max-size', maxMb },
          onProgress,
          signal
        );
      }}
    >
      <div className="p-5 rounded-2xl border border-line bg-surface space-y-4">
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'pages-per-file' as const, label: 'Fixed pages' },
            { id: 'ranges' as const, label: 'Custom ranges' },
            { id: 'bookmarks' as const, label: 'Split by Bookmarks' },
            { id: 'qr-divider' as const, label: 'QR Divider Scan' },
            { id: 'extract-all' as const, label: 'Extract every page' },
            { id: 'max-size' as const, label: 'Target max MB' },
          ].map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border ${
                mode === m.id
                  ? 'bg-brand text-white border-brand'
                  : 'bg-surface-elevated text-content border-line'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'pages-per-file' && (
          <label className="block text-xs text-content-secondary space-y-1 max-w-xs">
            <span>Pages per output PDF</span>
            <input
              type="number"
              min={1}
              value={pagesPerFile}
              onChange={(e) => setPagesPerFile(Math.max(1, Number(e.target.value)))}
              className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
            />
          </label>
        )}

        {mode === 'ranges' && (
          <div className="space-y-3 max-w-md">
            <label className="block text-xs text-content-secondary space-y-1">
              <span>Semicolon-separated groups (e.g. &ldquo;1-3; 4-6; 7-last&rdquo;)</span>
              <input
                type="text"
                value={rangeSpec}
                onChange={(e) => setRangeSpec(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
              />
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-content">
              <input
                type="checkbox"
                checked={mergeRanges}
                onChange={(e) => setMergeRanges(e.target.checked)}
              />
              <span>Merge all extracted ranges into a single PDF</span>
            </label>
          </div>
        )}

        {mode === 'bookmarks' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-content">
                <BookOpen className="w-4 h-4 text-brand" />
                <span>Detected PDF Outline Chapters</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setBookmarkLevelFilter('level1')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                    bookmarkLevelFilter === 'level1'
                      ? 'bg-brand text-white border-brand'
                      : 'bg-surface-elevated text-content border-line'
                  }`}
                >
                  Level 1 chapters
                </button>
                <button
                  type="button"
                  onClick={() => setBookmarkLevelFilter('all')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                    bookmarkLevelFilter === 'all'
                      ? 'bg-brand text-white border-brand'
                      : 'bg-surface-elevated text-content border-line'
                  }`}
                >
                  All levels
                </button>
              </div>
            </div>

            {!file && (
              <p className="text-xs text-content-secondary">
                Choose a PDF above to inspect its bookmark outline tree automatically.
              </p>
            )}

            {file && inspectingBookmarks && (
              <div className="flex items-center gap-2 text-xs text-content-secondary">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Inspecting PDF /Outlines tree…</span>
              </div>
            )}

            {file && bookmarkError && (
              <p className="text-xs text-error">{bookmarkError}</p>
            )}

            {file && !inspectingBookmarks && !bookmarkError && bookmarks.length === 0 && (
              <p className="text-xs text-amber-500">
                No bookmarks (/Outlines) were found in this PDF. Switch to Custom ranges or Fixed pages to split manually.
              </p>
            )}

            {file && !inspectingBookmarks && filteredBookmarks.length > 0 && (
              <div className="max-h-60 overflow-y-auto rounded-xl border border-line bg-surface-elevated divide-y divide-line">
                {filteredBookmarks.map((b, idx) => (
                  <div
                    key={`${b.title}-${b.startPage}-${idx}`}
                    style={{ paddingLeft: `${12 + Math.max(0, b.level - 1) * 16}px` }}
                    className="pr-3 py-2 flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="truncate text-content font-medium">
                      {b.title || `Chapter ${idx + 1}`}
                    </span>
                    <span className="font-mono text-[11px] text-content-secondary shrink-0">
                      p.{b.startPage}–{b.endPage}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {mode === 'qr-divider' && (
          <div className="p-3.5 rounded-xl border border-line bg-surface-elevated flex items-start gap-2.5 text-xs text-content-secondary">
            <QrCode className="w-4 h-4 text-brand shrink-0 mt-0.5" />
            <div>
              Scans every page locally with computer-vision QR detection (`jsQR`). Whenever a physical QR separator page is found, the PDF splits at that boundary and automatically discards the separator sheet.
            </div>
          </div>
        )}

        {mode === 'extract-all' && (
          <p className="text-xs text-content-secondary">
            Every page will be extracted into its own standalone PDF inside a single ZIP archive.
          </p>
        )}

        {mode === 'max-size' && (
          <label className="block text-xs text-content-secondary space-y-1 max-w-xs">
            <span>Maximum MB per output PDF (binary-search optimized)</span>
            <input
              type="number"
              min={0.2}
              step={0.5}
              value={maxMb}
              onChange={(e) => setMaxMb(Math.max(0.2, Number(e.target.value)))}
              className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
            />
          </label>
        )}
      </div>
    </PdfToolShell>
  );
}

function BulkPageSelectorBar({
  totalPages,
  selected,
  onSelect,
}: {
  totalPages: number;
  selected: number[];
  onSelect: (pages: number[]) => void;
}) {
  const all = Array.from({ length: totalPages }, (_, i) => i + 1);
  const selectedSet = new Set(selected);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onSelect(all.filter((n) => n % 2 === 1))}
        className="px-2.5 py-1 rounded-lg border border-line bg-surface-elevated text-xs font-medium hover:bg-surface-muted"
      >
        Odd pages
      </button>
      <button
        type="button"
        onClick={() => onSelect(all.filter((n) => n % 2 === 0))}
        className="px-2.5 py-1 rounded-lg border border-line bg-surface-elevated text-xs font-medium hover:bg-surface-muted"
      >
        Even pages
      </button>
      <button
        type="button"
        onClick={() => onSelect(all.slice(0, Math.ceil(totalPages / 2)))}
        className="px-2.5 py-1 rounded-lg border border-line bg-surface-elevated text-xs font-medium hover:bg-surface-muted"
      >
        First half
      </button>
      <button
        type="button"
        onClick={() => onSelect(all.slice(Math.ceil(totalPages / 2)))}
        className="px-2.5 py-1 rounded-lg border border-line bg-surface-elevated text-xs font-medium hover:bg-surface-muted"
      >
        Second half
      </button>
      <button
        type="button"
        onClick={() => onSelect(all.filter((n) => !selectedSet.has(n)))}
        className="px-2.5 py-1 rounded-lg border border-line bg-surface-elevated text-xs font-medium hover:bg-surface-muted"
      >
        Invert
      </button>
      <button
        type="button"
        onClick={() => onSelect([])}
        className="px-2.5 py-1 rounded-lg border border-line text-xs text-content-secondary"
      >
        Clear
      </button>
    </div>
  );
}

export function PdfDeletePagesTool() {
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [rangeText, setRangeText] = useState('');

  const updateSelection = (pages: number[]) => {
    setSelected(pages);
    setRangeText(formatPagesToRangeString(pages));
  };

  return (
    <PdfToolShell
      title="Delete pages"
      description="Live two-way bound thumbnail grid, Bulk Odd/Even/Invert toggles, and instant range syntax (`1, 4-8, 12-end`)."
      currentHref="/tools/pdf/delete-pages"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => {
        setFile(files[0] || null);
        setSelected([]);
        setRangeText('');
      }}
      submitLabel={`Delete ${selected.length} Page(s)`}
      canSubmit={selected.length > 0 && selected.length < totalPages}
      onRun={(onProgress, signal) => deletePagesFromPdf(file!, selected, onProgress, signal)}
    >
      {file && (
        <div className="space-y-4">
          <div className="p-3.5 rounded-2xl border border-line bg-surface flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={rangeText}
                onChange={(e) => {
                  const val = e.target.value;
                  setRangeText(val);
                  if (!val.trim()) {
                    setSelected([]);
                  } else if (totalPages > 0) {
                    const parsed = parsePageRange(val, totalPages).pages;
                    setSelected(parsed);
                  }
                }}
                placeholder="e.g. 1, 4-8, 12-end"
                className="px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content w-48"
              />
            </div>
            <BulkPageSelectorBar
              totalPages={totalPages}
              selected={selected}
              onSelect={updateSelection}
            />
          </div>

          <PdfPageGrid
            file={file}
            mode="select"
            selectIntent="delete"
            selectedPages={selected}
            onSelectionChange={updateSelection}
            onTotalPages={setTotalPages}
          />
        </div>
      )}
    </PdfToolShell>
  );
}

export function PdfExtractPagesTool() {
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [rangeText, setRangeText] = useState('');
  const [separateFiles, setSeparateFiles] = useState(false);

  const updateSelection = (pages: number[]) => {
    setSelected(pages);
    setRangeText(formatPagesToRangeString(pages));
  };

  return (
    <PdfToolShell
      title="Extract pages"
      description="Two-way synced visual page picker with Odd/Even bulk selection and lossless stream passthrough (single PDF or ZIP)."
      currentHref="/tools/pdf/extract"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => {
        setFile(files[0] || null);
        setSelected([]);
        setRangeText('');
      }}
      submitLabel={`Extract ${selected.length} Page(s)`}
      canSubmit={selected.length > 0}
      onRun={(onProgress, signal) => extractPagesFromPdf(file!, selected, separateFiles, onProgress, signal)}
    >
      {file && (
        <div className="space-y-4">
          <div className="p-3.5 rounded-2xl border border-line bg-surface flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={rangeText}
                onChange={(e) => {
                  const val = e.target.value;
                  setRangeText(val);
                  if (!val.trim()) {
                    setSelected([]);
                  } else if (totalPages > 0) {
                    setSelected(parsePageRange(val, totalPages).pages);
                  }
                }}
                placeholder="e.g. 1-3, 8, 12-end"
                className="px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content w-44"
              />
            </div>

            <BulkPageSelectorBar
              totalPages={totalPages}
              selected={selected}
              onSelect={updateSelection}
            />

            <label className="inline-flex items-center gap-2 text-xs text-content">
              <input
                type="checkbox"
                checked={separateFiles}
                onChange={(e) => setSeparateFiles(e.target.checked)}
              />
              <span>Separate PDFs (ZIP)</span>
            </label>
          </div>
          <PdfPageGrid
            file={file}
            mode="select"
            selectIntent="keep"
            selectedPages={selected}
            onSelectionChange={updateSelection}
            onTotalPages={setTotalPages}
          />
        </div>
      )}
    </PdfToolShell>
  );
}

interface ReorderSlot {
  id: string;
  file: File;
  pageIndex: number;
  pageNumber: number;
  sourceLabel: string;
  isBlank?: boolean;
  thumbUrl?: string;
  rotation: number;
  widthPt: number;
  heightPt: number;
}

function uidSuffix() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().slice(0, 8);
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function PdfReorderPagesTool() {
  const appendInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [slots, setSlots] = useState<ReorderSlot[]>([]);
  const [undoStack, setUndoStack] = useState<ReorderSlot[][]>([]);
  const [redoStack, setRedoStack] = useState<ReorderSlot[][]>([]);
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([]);
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const commitSlots = (updater: (prev: ReorderSlot[]) => ReorderSlot[]) => {
    setSlots((prev) => {
      const next = updater(prev);
      if (next !== prev) {
        setUndoStack((u) => [...u.slice(-29), prev]);
        setRedoStack([]);
      }
      return next;
    });
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((u) => u.slice(0, -1));
    setRedoStack((r) => [...r.slice(-29), slots]);
    setSlots(previous);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((u) => [...u.slice(-29), slots]);
    setSlots(next);
  };

  const loadSlotsForFile = async (
    targetFile: File,
    signal?: AbortSignal
  ): Promise<ReorderSlot[]> => {
    const [infos, thumbs] = await Promise.all([
      getPdfPageInfos(targetFile),
      getPdfThumbnails(targetFile, { scale: 0.35, signal }),
    ]);
    const thumbMap = new Map(thumbs.map((t) => [t.pageNumber, t.dataUrl]));
    const stamp = uidSuffix();
    return infos.map((info) => ({
      id: `${stamp}-p${info.pageNumber}-${uidSuffix()}`,
      file: targetFile,
      pageIndex: info.pageNumber - 1,
      pageNumber: info.pageNumber,
      sourceLabel: targetFile.name,
      thumbUrl: thumbMap.get(info.pageNumber),
      rotation: 0,
      widthPt: info.width || 595.28,
      heightPt: info.height || 841.89,
    }));
  };

  useEffect(() => {
    if (!file) {
      setSlots([]);
      setUndoStack([]);
      setRedoStack([]);
      setSelectedSlotIds([]);
      setLastClickedIdx(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setLoadError(null);
    loadSlotsForFile(file, ctrl.signal)
      .then((next) => {
        if (!ctrl.signal.aborted) {
          setSlots(next);
          setUndoStack([]);
          setRedoStack([]);
          setSelectedSlotIds([]);
          setLastClickedIdx(null);
        }
      })
      .catch((err) => {
        if (!ctrl.signal.aborted && (err as Error)?.name !== 'AbortError') {
          setLoadError(err instanceof Error ? err.message : 'Failed to load PDF pages.');
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [file]);

  const insertBlankPage = async () => {
    const primaryId = selectedSlotIds[selectedSlotIds.length - 1];
    const selectedIdx = primaryId ? slots.findIndex((s) => s.id === primaryId) : -1;
    const refSlot =
      selectedIdx >= 0 ? slots[selectedIdx] : slots[slots.length - 1];
    const widthPt = refSlot?.widthPt || 595.28;
    const heightPt = refSlot?.heightPt || 841.89;

    const blankDoc = await PDFDocument.create();
    blankDoc.addPage([widthPt, heightPt]);
    const bytes = await blankDoc.save();
    const blankFile = new File([new Uint8Array(bytes)], 'blank-page.pdf', {
      type: 'application/pdf',
    });
    const newSlot: ReorderSlot = {
      id: `blank-${uidSuffix()}`,
      file: blankFile,
      pageIndex: 0,
      pageNumber: 1,
      sourceLabel: 'Blank Page',
      isBlank: true,
      rotation: 0,
      widthPt,
      heightPt,
    };

    commitSlots((prev) => {
      const insertAt = selectedIdx >= 0 ? selectedIdx + 1 : prev.length;
      const copy = [...prev];
      copy.splice(insertAt, 0, newSlot);
      return copy;
    });
    setSelectedSlotIds([newSlot.id]);
  };

  const handleAppendPdfs = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setLoading(true);
    setLoadError(null);
    try {
      const appended: ReorderSlot[] = [];
      for (const f of Array.from(list)) {
        const next = await loadSlotsForFile(f);
        appended.push(...next);
      }
      commitSlots((prev) => [...prev, ...appended]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not append PDF.');
    } finally {
      setLoading(false);
      if (appendInputRef.current) appendInputRef.current.value = '';
    }
  };

  const moveAt = (fromIdx: number, toIdx: number) => {
    if (toIdx < 0 || toIdx >= slots.length || fromIdx === toIdx) return;
    commitSlots((prev) => {
      const dragged = prev[fromIdx];
      if (!dragged) return prev;
      if (selectedSlotIds.length > 1 && selectedSlotIds.includes(dragged.id)) {
        const selSet = new Set(selectedSlotIds);
        const movingGroup = prev.filter((s) => selSet.has(s.id));
        const targetId = prev[toIdx]?.id;
        const remaining = prev.filter((s) => !selSet.has(s.id));
        const anchorIdx = targetId ? remaining.findIndex((s) => s.id === targetId) : -1;
        const insertAt = anchorIdx >= 0 ? (fromIdx < toIdx ? anchorIdx + 1 : anchorIdx) : remaining.length;
        remaining.splice(insertAt, 0, ...movingGroup);
        return remaining;
      }
      const copy = [...prev];
      const [moved] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, moved);
      return copy;
    });
  };

  const duplicateAt = (idx: number) => {
    commitSlots((prev) => {
      const src = prev[idx];
      if (!src) return prev;
      const copy = [...prev];
      copy.splice(idx + 1, 0, {
        ...src,
        id: `${src.id}-dup-${uidSuffix()}`,
      });
      return copy;
    });
  };

  const rotateAt = (idx: number, delta: number) => {
    commitSlots((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, rotation: (s.rotation + delta + 360) % 360 } : s))
    );
  };

  const deleteAt = (idx: number) => {
    if (slots.length <= 1) return;
    const removedId = slots[idx]?.id;
    commitSlots((prev) => prev.filter((_, i) => i !== idx));
    if (removedId) setSelectedSlotIds((prev) => prev.filter((id) => id !== removedId));
  };

  const toggleSlotSelection = (idx: number, id: string, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedIdx !== null) {
      const lo = Math.min(lastClickedIdx, idx);
      const hi = Math.max(lastClickedIdx, idx);
      const rangeIds = slots.slice(lo, hi + 1).map((s) => s.id);
      setSelectedSlotIds((prev) => Array.from(new Set([...prev, ...rangeIds])));
    } else if (e.metaKey || e.ctrlKey) {
      setSelectedSlotIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );
      setLastClickedIdx(idx);
    } else {
      setSelectedSlotIds((prev) => (prev.length === 1 && prev[0] === id ? [] : [id]));
      setLastClickedIdx(idx);
    }
  };

  return (
    <PdfToolShell
      title="Reorder pages"
      description="Multi-select canvas (Shift/Ctrl+Click), Undo/Redo stack, inline rotate, duplicate, + Insert Blank Page, and + Append PDF."
      currentHref="/tools/pdf/reorder"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => {
        setFile(files[0] || null);
        setSlots([]);
        setUndoStack([]);
        setRedoStack([]);
        setSelectedSlotIds([]);
      }}
      submitLabel={`Save Reordered PDF (${slots.length} pages)`}
      canSubmit={slots.length > 0}
      onRun={async (onProgress, signal) => {
        const singleOriginalOnly =
          Boolean(file) && slots.every((s) => s.file === file && !s.isBlank);
        if (singleOriginalOnly) {
          const rotMap: Record<number, number> = {};
          slots.forEach((s, idx) => {
            if (s.rotation !== 0) rotMap[idx] = s.rotation;
          });
          return reorderPdfPages(
            file!,
            slots.map((s) => s.pageNumber),
            rotMap,
            onProgress,
            signal
          );
        }

        const stem = sanitizeFilenameStem(file?.name || 'document', 'document');
        const merged = await mergePdfPagesExpanded(
          slots.map((s) => ({ file: s.file, pageIndex: s.pageIndex })),
          {
            outputName: `${stem}-reordered.pdf`,
            signal,
            onProgress: (pct) => onProgress(Math.round(pct * 0.85)),
          }
        );

        const rotByPage: Record<number, number> = {};
        let hasRot = false;
        slots.forEach((s, idx) => {
          if (s.rotation !== 0) {
            rotByPage[idx + 1] = s.rotation;
            hasRot = true;
          }
        });
        if (!hasRot) {
          onProgress(100);
          return merged;
        }
        const mergedFile = new File([merged.blob], merged.fileName, { type: 'application/pdf' });
        const rotated = await rotatePdfPages(mergedFile, rotByPage, (pct) =>
          onProgress(85 + Math.round(pct * 0.15))
        );
        return {
          ...rotated,
          fileName: merged.fileName,
          summary: `Saved ${slots.length} reordered pages`,
        };
      }}
    >
      {file && (
        <div className="space-y-4">
          <input
            ref={appendInputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(e) => void handleAppendPdfs(e.target.files)}
          />

          <div className="p-3.5 rounded-2xl border border-line bg-surface flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-content-secondary">
              Click a page to select an insertion point, drag to reorder, or append PDFs &amp; blank pages.
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={undoStack.length === 0}
                onClick={handleUndo}
                aria-label="Undo reorder"
                className="px-2.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-40"
              >
                <Undo2 className="w-3.5 h-3.5" />
                <span>Undo</span>
              </button>
              <button
                type="button"
                disabled={redoStack.length === 0}
                onClick={handleRedo}
                aria-label="Redo reorder"
                className="px-2.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-40"
              >
                <Redo2 className="w-3.5 h-3.5" />
                <span>Redo</span>
              </button>
              {selectedSlotIds.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const selSet = new Set(selectedSlotIds);
                      commitSlots((prev) =>
                        prev.map((s) =>
                          selSet.has(s.id) ? { ...s, rotation: (s.rotation + 90) % 360 } : s
                        )
                      );
                    }}
                    className="px-2.5 py-1.5 rounded-xl border border-brand/40 bg-brand/10 text-brand text-xs font-semibold"
                  >
                    Rotate {selectedSlotIds.length} Selected +90°
                  </button>
                  <button
                    type="button"
                    disabled={slots.length - selectedSlotIds.length < 1}
                    onClick={() => {
                      const selSet = new Set(selectedSlotIds);
                      commitSlots((prev) => prev.filter((s) => !selSet.has(s.id)));
                      setSelectedSlotIds([]);
                    }}
                    className="px-2.5 py-1.5 rounded-xl border border-error/40 bg-error-bg text-error text-xs font-semibold disabled:opacity-40"
                  >
                    Delete {selectedSlotIds.length} Selected
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => void insertBlankPage()}
                className="px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-surface-muted"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Insert Blank Page</span>
              </button>
              <button
                type="button"
                onClick={() => appendInputRef.current?.click()}
                className="px-3 py-1.5 rounded-xl border border-brand/40 bg-brand/10 text-brand text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-brand/15"
              >
                <FilePlus2 className="w-3.5 h-3.5" />
                <span>+ Append PDF</span>
              </button>
              <button
                type="button"
                onClick={() => commitSlots((prev) => [...prev].reverse())}
                className="px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs font-semibold"
              >
                Reverse all pages
              </button>
            </div>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-xs text-content-secondary">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Loading page previews…</span>
            </div>
          )}
          {loadError && <div className="text-xs text-error">{loadError}</div>}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {slots.map((slot, idx) => {
              const isSelected = selectedSlotIds.includes(slot.id);
              return (
                <div
                  key={slot.id}
                  draggable
                  onClick={(e) => toggleSlotSelection(idx, slot.id, e)}
                  onDragStart={() => setDragIdx(idx)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOverIdx(idx);
                  }}
                  onDragLeave={() => {
                    if (overIdx === idx) setOverIdx(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIdx !== null) moveAt(dragIdx, idx);
                    setDragIdx(null);
                    setOverIdx(null);
                  }}
                  onDragEnd={() => {
                    setDragIdx(null);
                    setOverIdx(null);
                  }}
                  className={`rounded-xl border p-2.5 bg-surface flex flex-col gap-2 cursor-grab active:cursor-grabbing ${
                    overIdx === idx && dragIdx !== idx
                      ? 'border-brand ring-2 ring-brand/40'
                      : isSelected
                      ? 'border-brand ring-2 ring-brand/25'
                      : 'border-line'
                  }`}
                >
                  <div className="relative aspect-[3/4] w-full rounded-lg bg-white border border-line/50 overflow-hidden flex items-center justify-center">
                    {slot.isBlank ? (
                      <div className="text-center px-2">
                        <div className="text-[11px] font-semibold text-content-muted">Blank Page</div>
                        <div className="text-[10px] font-mono text-content-muted mt-0.5">
                          {Math.round(slot.widthPt)}×{Math.round(slot.heightPt)}pt
                        </div>
                      </div>
                    ) : slot.thumbUrl ? (
                      <img
                        src={slot.thumbUrl}
                        alt={`${slot.sourceLabel} page ${slot.pageNumber}`}
                        className="max-w-full max-h-full object-contain"
                        style={{ transform: `rotate(${slot.rotation}deg)` }}
                      />
                    ) : (
                      <span className="text-xs text-content-muted">p.{slot.pageNumber}</span>
                    )}

                    {slot.rotation !== 0 && (
                      <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/75 text-white font-mono text-[10px]">
                        {slot.rotation}°
                      </span>
                    )}
                    {slot.file !== file && !slot.isBlank && (
                      <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-brand/90 text-white text-[9px] font-semibold max-w-[85%] truncate">
                        {slot.sourceLabel}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-1 text-xs">
                    <span className="font-mono text-content-secondary text-[11px]">
                      #{idx + 1} {slot.isBlank ? '(blank)' : `(p.${slot.pageNumber})`}
                    </span>
                    <div
                      className="flex items-center gap-0.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => moveAt(idx, idx - 1)}
                        disabled={idx === 0}
                        aria-label={`Move slot ${idx + 1} earlier`}
                        className="p-1 rounded hover:bg-surface-elevated disabled:opacity-30"
                      >
                        <ArrowLeft className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveAt(idx, idx + 1)}
                        disabled={idx === slots.length - 1}
                        aria-label={`Move slot ${idx + 1} later`}
                        className="p-1 rounded hover:bg-surface-elevated disabled:opacity-30"
                      >
                        <ArrowRight className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => rotateAt(idx, 90)}
                        aria-label={`Rotate slot ${idx + 1}`}
                        className="p-1 rounded hover:bg-surface-elevated"
                      >
                        <RotateCw className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => duplicateAt(idx)}
                        aria-label={`Duplicate slot ${idx + 1}`}
                        className="p-1 rounded hover:bg-surface-elevated"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteAt(idx)}
                        disabled={slots.length <= 1}
                        aria-label={`Remove slot ${idx + 1}`}
                        className="p-1 rounded hover:bg-surface-elevated text-error disabled:opacity-30"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </PdfToolShell>
  );
}

export function PdfRotatePagesTool() {
  const [file, setFile] = useState<File | null>(null);
  const [rotations, setRotations] = useState<Record<number, number>>({});
  const [totalPages, setTotalPages] = useState(0);
  const [pageInfos, setPageInfos] = useState<PdfPageInfo[]>([]);
  const [orientationFilter, setOrientationFilter] = useState<'all' | 'portrait' | 'landscape'>('all');
  const [pendingOrientationOp, setPendingOrientationOp] = useState<{
    angle: number;
    orientation: 'all' | 'portrait' | 'landscape';
  } | null>(null);
  const [autoRotating, setAutoRotating] = useState(false);
  const [autoRotateError, setAutoRotateError] = useState<string | null>(null);
  const [autoRotateDetails, setAutoRotateDetails] = useState<Array<{
    pageNumber: number;
    degreesApplied: number;
    reason: string;
  }> | null>(null);
  const [externalResult, setExternalResult] = useState<PdfProcessResult | null>(null);

  useEffect(() => {
    if (!file) {
      setPageInfos([]);
      return;
    }
    let cancelled = false;
    getPdfPageInfos(file)
      .then((infos) => {
        if (!cancelled) setPageInfos(infos);
      })
      .catch(() => {
        if (!cancelled) setPageInfos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const matchesOrientation = (pageNumber: number) => {
    if (orientationFilter === 'all') return true;
    const info = pageInfos.find((p) => p.pageNumber === pageNumber);
    if (!info) return true;
    const delta = ((rotations[pageNumber] || 0) % 360 + 360) % 360;
    const swapped = delta === 90 || delta === 270;
    const effW = swapped ? info.height : info.width;
    const effH = swapped ? info.width : info.height;
    const isLandscape = effW > effH;
    return orientationFilter === 'landscape' ? isLandscape : !isLandscape;
  };

  const rotateFiltered = (delta: number) => {
    const hadAny = Object.values(rotations).some((v) => v !== 0);
    const next: Record<number, number> = { ...rotations };
    for (let i = 1; i <= totalPages; i += 1) {
      if (matchesOrientation(i)) {
        next[i] = ((next[i] || 0) + delta + 360) % 360;
      }
    }
    setRotations(next);

    if (!hadAny) {
      setPendingOrientationOp({
        angle: ((delta % 360) + 360) % 360,
        orientation: orientationFilter,
      });
    } else if (
      pendingOrientationOp &&
      pendingOrientationOp.orientation === orientationFilter
    ) {
      setPendingOrientationOp({
        angle: (pendingOrientationOp.angle + delta + 360) % 360,
        orientation: orientationFilter,
      });
    } else {
      setPendingOrientationOp(null);
    }
  };

  const runAutoRotateUpright = async () => {
    if (!file) return;
    setAutoRotating(true);
    setAutoRotateError(null);
    try {
      const res = await autoRotatePdf(file);
      const nextRot: Record<number, number> = {};
      for (const item of res.rotatedPages) {
        nextRot[item.pageNumber] = ((item.degreesApplied % 360) + 360) % 360;
      }
      setRotations(nextRot);
      setPendingOrientationOp(null);
      setAutoRotateDetails(res.rotatedPages);
      setExternalResult(res);
    } catch (err) {
      setAutoRotateError(err instanceof Error ? err.message : 'Auto-rotate failed.');
    } finally {
      setAutoRotating(false);
    }
  };

  return (
    <PdfToolShell
      title="Rotate pages"
      description="Rotate individual pages, batch-rotate by Portrait/Landscape orientation, or 1-click Auto-Rotate Upright."
      currentHref="/tools/pdf/rotate"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => {
        setFile(files[0] || null);
        setRotations({});
        setPendingOrientationOp(null);
        setAutoRotateDetails(null);
        setAutoRotateError(null);
        setExternalResult(null);
      }}
      externalResult={externalResult}
      onClearExternalResult={() => setExternalResult(null)}
      submitLabel={
        pendingOrientationOp && pendingOrientationOp.angle !== 0
          ? `Apply ${pendingOrientationOp.angle}° (${orientationFilter}) & Save`
          : 'Apply Rotations & Save'
      }
      onRun={(onProgress, signal) => {
        if (pendingOrientationOp && pendingOrientationOp.angle !== 0) {
          return rotatePdfByOrientation(
            file!,
            pendingOrientationOp.angle,
            pendingOrientationOp.orientation,
            { signal, onProgress }
          );
        }
        return rotatePdfPages(file!, rotations, onProgress, signal);
      }}
    >
      {file && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl border border-line bg-surface space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-content-secondary mr-1">
                  Orientation filter:
                </span>
                {[
                  { id: 'all' as const, label: 'All Pages' },
                  { id: 'portrait' as const, label: 'Portrait Only' },
                  { id: 'landscape' as const, label: 'Landscape Only' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setOrientationFilter(opt.id);
                      setPendingOrientationOp(null);
                    }}
                    className={`px-3 py-1 rounded-xl text-xs font-semibold border ${
                      orientationFilter === opt.id
                        ? 'bg-brand text-white border-brand'
                        : 'bg-surface-elevated text-content border-line'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                disabled={autoRotating}
                onClick={() => void runAutoRotateUpright()}
                className="px-3.5 py-1.5 rounded-xl border border-brand/40 bg-brand/10 text-brand text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-brand/15 disabled:opacity-50"
              >
                {autoRotating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span>Auto-Rotate Upright</span>
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => rotateFiltered(-90)}
                className="px-3.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Rotate 90° Left</span>
              </button>
              <button
                type="button"
                onClick={() => rotateFiltered(90)}
                className="px-3.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>Rotate 90° Right</span>
              </button>
              <button
                type="button"
                onClick={() => rotateFiltered(180)}
                className="px-3.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs font-semibold"
              >
                Rotate 180°
              </button>
              <button
                type="button"
                onClick={() => {
                  setRotations({});
                  setPendingOrientationOp(null);
                }}
                className="px-3.5 py-1.5 rounded-xl border border-line text-xs text-content-secondary"
              >
                Reset all
              </button>
            </div>

            {autoRotateError && (
              <div className="text-xs text-error">{autoRotateError}</div>
            )}

            {autoRotateDetails && (
              <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-1.5 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-content">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>
                    Auto-Rotate Upright analyzed {totalPages || pageInfos.length || 'all'} pages:{' '}
                    {autoRotateDetails.length} page(s) corrected
                  </span>
                </div>
                {autoRotateDetails.length > 0 && (
                  <ul className="space-y-0.5 text-content-secondary pl-5 list-disc">
                    {autoRotateDetails.map((item) => (
                      <li key={item.pageNumber}>
                        Page {item.pageNumber}: applied {item.degreesApplied}° ({item.reason})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <PdfPageGrid
            file={file}
            mode="rotate"
            rotations={rotations}
            onRotationsChange={(next) => {
              setRotations(next);
              setPendingOrientationOp(null);
            }}
            onTotalPages={setTotalPages}
          />
        </div>
      )}
    </PdfToolShell>
  );
}

/**
 * iLovePDF Benchmark: Interactive Visual Crop Bounding Box + Current Page vs All Pages toggle
 */
export function PdfCropTool() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [applyScope, setApplyScope] = useState<'all' | 'current' | 'per-page'>('all');
  const [margins, setMargins] = useState({ top: 6, right: 6, bottom: 6, left: 6 });
  const [perPageMargins, setPerPageMargins] = useState<
    Record<number, { top: number; right: number; bottom: number; left: number }>
  >({});
  const [permanentRemoveOutside, setPermanentRemoveOutside] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [dragEdge, setDragEdge] = useState<'top' | 'right' | 'bottom' | 'left' | null>(null);

  const activeMargins =
    applyScope === 'per-page' ? perPageMargins[pageNumber] || margins : margins;

  const updateActiveMargins = (
    updater: (prev: { top: number; right: number; bottom: number; left: number }) => {
      top: number;
      right: number;
      bottom: number;
      left: number;
    }
  ) => {
    if (applyScope === 'per-page') {
      setPerPageMargins((map) => ({
        ...map,
        [pageNumber]: updater(map[pageNumber] || margins),
      }));
    } else {
      setMargins((m) => updater(m));
    }
  };

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setRenderError(null);
    loadPdfJsDocument(file)
      .then(async (pdf) => {
        if (cancelled) {
          await pdf.destroy();
          return;
        }
        setNumPages(pdf.numPages);
        if (canvasRef.current) {
          await renderPdfPageToCanvas(pdf, Math.min(pageNumber, pdf.numPages), canvasRef.current, 1.15);
        }
        await pdf.destroy();
      })
      .catch((err) => {
        if (!cancelled) {
          setRenderError(err instanceof Error ? err.message : 'Unable to render PDF for cropping.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [file, pageNumber]);

  const handleEdgePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragEdge || !previewBoxRef.current) return;
    const rect = previewBoxRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const px = Math.max(0, Math.min(45, ((e.clientX - rect.left) / rect.width) * 100));
    const rx = Math.max(0, Math.min(45, ((rect.right - e.clientX) / rect.width) * 100));
    const py = Math.max(0, Math.min(45, ((e.clientY - rect.top) / rect.height) * 100));
    const by = Math.max(0, Math.min(45, ((rect.bottom - e.clientY) / rect.height) * 100));
    updateActiveMargins((prev) => ({
      ...prev,
      ...(dragEdge === 'top' ? { top: Math.round(py) } : {}),
      ...(dragEdge === 'bottom' ? { bottom: Math.round(by) } : {}),
      ...(dragEdge === 'left' ? { left: Math.round(px) } : {}),
      ...(dragEdge === 'right' ? { right: Math.round(rx) } : {}),
    }));
  };

  return (
    <PdfToolShell
      title="Crop PDF"
      description="Vector-preserving CropBox trimming with drag handles, per-page book margins, and optional hard out-of-bounds strip."
      currentHref="/tools/pdf/crop"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => {
        setFile(files[0] || null);
        setPageNumber(1);
        setPerPageMargins({});
        setRenderError(null);
      }}
      submitLabel={
        applyScope === 'all'
          ? 'Crop All Pages & Save'
          : applyScope === 'per-page'
          ? 'Apply Custom Page Crops & Save'
          : `Crop Page ${pageNumber} & Save`
      }
      onRun={(onProgress, signal) =>
        cropPdfPages(
          file!,
          margins,
          applyScope === 'current' ? [pageNumber] : undefined,
          onProgress,
          {
            permanentRemoveOutside,
            perPageMargins: applyScope === 'per-page' ? perPageMargins : undefined,
            signal,
          }
        )
      }
    >
      <div className="p-5 rounded-2xl border border-line bg-surface space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'all' as const, label: 'All pages' },
              { id: 'current' as const, label: `Current page (#${pageNumber})` },
              { id: 'per-page' as const, label: 'Per-page custom' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setApplyScope(opt.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border ${
                  applyScope === opt.id
                    ? 'bg-brand text-white border-brand'
                    : 'bg-surface-elevated border-line text-content'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {file && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={pageNumber <= 1}
                onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded-lg border border-line bg-surface-elevated disabled:opacity-40"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs font-mono px-1.5">
                {pageNumber}/{numPages || 1}
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
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
            <label key={side} className="space-y-1 text-xs text-content-secondary capitalize">
              <span>{side} trim ({activeMargins[side]}%)</span>
              <input
                type="range"
                min={0}
                max={42}
                value={activeMargins[side]}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  updateActiveMargins((m) => ({
                    ...m,
                    [side]: val,
                  }));
                }}
                className="w-full"
              />
            </label>
          ))}
        </div>

        <label className="flex items-start gap-2.5 p-3 rounded-xl border border-line bg-surface-elevated text-xs text-content cursor-pointer">
          <input
            type="checkbox"
            checked={permanentRemoveOutside}
            onChange={(e) => setPermanentRemoveOutside(e.target.checked)}
            className="mt-0.5"
          />
          <div>
            <div className="font-semibold inline-flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
              <span>Permanently remove content outside crop area</span>
            </div>
            <p className="text-[11px] text-content-secondary mt-0.5">
              Updating CropBox alone hides margins losslessly. Enable this to burn cropped pages cleanly so hidden edges cannot be uncropped.
            </p>
          </div>
        </label>
      </div>

      {file && (
        <div className="p-4 rounded-2xl border border-line bg-surface-elevated flex flex-col items-center overflow-auto">
          {renderError && (
            <div className="w-full mb-3 p-3 rounded-xl bg-error-bg border border-error text-error text-xs font-medium">
              {renderError}
            </div>
          )}
          <div
            ref={previewBoxRef}
            onPointerMove={handleEdgePointerMove}
            onPointerUp={() => setDragEdge(null)}
            onPointerLeave={() => setDragEdge(null)}
            className="relative inline-block shadow-lg bg-white select-none"
          >
            <canvas ref={canvasRef} className="block max-w-full h-auto" />
            <div
              style={{
                top: `${activeMargins.top}%`,
                right: `${activeMargins.right}%`,
                bottom: `${activeMargins.bottom}%`,
                left: `${activeMargins.left}%`,
              }}
              className="absolute border-2 border-dashed border-brand bg-brand/5 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
            >
              <button
                type="button"
                aria-label="Drag top crop margin"
                onPointerDown={() => setDragEdge('top')}
                className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-8 h-3 rounded-full bg-brand cursor-ns-resize"
              />
              <button
                type="button"
                aria-label="Drag bottom crop margin"
                onPointerDown={() => setDragEdge('bottom')}
                className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-8 h-3 rounded-full bg-brand cursor-ns-resize"
              />
              <button
                type="button"
                aria-label="Drag left crop margin"
                onPointerDown={() => setDragEdge('left')}
                className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-3 h-8 rounded-full bg-brand cursor-ew-resize"
              />
              <button
                type="button"
                aria-label="Drag right crop margin"
                onPointerDown={() => setDragEdge('right')}
                className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-3 h-8 rounded-full bg-brand cursor-ew-resize"
              />
            </div>
          </div>
        </div>
      )}
    </PdfToolShell>
  );
}

/**
 * Mapsoft / Stirling Benchmark: Blank Page Detection with Thumbnail Verification
 */
export function PdfRemoveBlankPagesTool() {
  const [file, setFile] = useState<File | null>(null);
  const [threshold, setThreshold] = useState(0.0005);
  const [marginIgnorePct, setMarginIgnorePct] = useState(4);
  const [luminanceDelta, setLuminanceDelta] = useState(28);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [details, setDetails] = useState<
    Array<{ pageNumber: number; inkRatio: number; isBlank: boolean; thumbUrl: string }>
  >([]);
  const [selectedToRemove, setSelectedToRemove] = useState<number[]>([]);
  const [scanned, setScanned] = useState(false);

  const scanNow = async () => {
    if (!file) return;
    setScanning(true);
    setScanError(null);
    try {
      const res = await detectBlankPages(file, threshold, undefined, undefined, {
        marginIgnorePct,
        luminanceDelta,
      });
      setDetails(res.pageDetails);
      setSelectedToRemove(res.blankPages);
      setScanned(true);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Unable to scan PDF for blank pages.');
    } finally {
      setScanning(false);
    }
  };

  return (
    <PdfToolShell
      title="Remove blank pages"
      description="Automatic blank-page detection with margin/punch-hole ignore, gray-paper tolerance, and thumbnail verification."
      currentHref="/tools/pdf/remove-blank-pages"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => {
        setFile(files[0] || null);
        setDetails([]);
        setSelectedToRemove([]);
        setScanned(false);
        setScanError(null);
      }}
      submitLabel={`Remove ${selectedToRemove.length} Blank Page(s)`}
      canSubmit={selectedToRemove.length > 0 && selectedToRemove.length < details.length}
      onRun={(onProgress, signal) => removeBlankPagesFromPdf(file!, selectedToRemove, onProgress, signal)}
    >
      {file && (
        <div className="p-5 rounded-2xl border border-line bg-surface space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 flex-1">
              <label className="space-y-1 text-xs text-content-secondary">
                <span>Max ink ratio ({(threshold * 100).toFixed(2)}%)</span>
                <input
                  type="range"
                  min={0.0001}
                  max={0.015}
                  step={0.0003}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="w-full block"
                />
              </label>
              <label className="space-y-1 text-xs text-content-secondary">
                <span>Ignore edges / holes ({marginIgnorePct}%)</span>
                <input
                  type="range"
                  min={0}
                  max={12}
                  step={1}
                  value={marginIgnorePct}
                  onChange={(e) => setMarginIgnorePct(Number(e.target.value))}
                  className="w-full block"
                />
              </label>
              <label className="space-y-1 text-xs text-content-secondary">
                <span>Gray paper threshold (Δ{luminanceDelta})</span>
                <input
                  type="range"
                  min={10}
                  max={70}
                  step={2}
                  value={luminanceDelta}
                  onChange={(e) => setLuminanceDelta(Number(e.target.value))}
                  className="w-full block"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={scanning}
              onClick={scanNow}
              className="px-4 py-2 rounded-xl border border-line bg-surface-elevated text-xs font-semibold"
            >
              {scanning ? 'Scanning pages…' : 'Scan for blank pages'}
            </button>
          </div>
          {scanError && (
            <div className="p-3 rounded-xl bg-error-bg border border-error text-error text-xs font-medium">
              {scanError}
            </div>
          )}

          {scanned && (
            <div className="space-y-3">
              <div className="text-xs text-content">
                {selectedToRemove.length > 0
                  ? `${selectedToRemove.length} page(s) marked for removal (uncheck any page you want to keep):`
                  : 'No blank pages detected at this threshold.'}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
                {details
                  .filter((d) => d.isBlank)
                  .map((d) => {
                    const checked = selectedToRemove.includes(d.pageNumber);
                    return (
                      <label
                        key={d.pageNumber}
                        className={`p-2 rounded-xl border cursor-pointer text-xs space-y-1.5 ${
                          checked ? 'border-error bg-error-bg/40' : 'border-line bg-surface-elevated'
                        }`}
                      >
                        <img src={d.thumbUrl} alt={`Page ${d.pageNumber}`} className="w-full rounded bg-white border border-line/40" />
                        <div className="flex items-center justify-between">
                          <span className="font-mono">p.{d.pageNumber}</span>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setSelectedToRemove((prev) =>
                                e.target.checked
                                  ? [...prev, d.pageNumber].sort((a, b) => a - b)
                                  : prev.filter((n) => n !== d.pageNumber)
                              )
                            }
                          />
                        </div>
                        <div className="text-[10px] text-content-secondary font-mono">
                          {(d.inkRatio * 100).toFixed(3)}% ink
                        </div>
                      </label>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      )}
    </PdfToolShell>
  );
}
