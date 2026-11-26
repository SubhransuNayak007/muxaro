'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  Layers,
  Loader2,
  SlidersHorizontal,
  Type,
  UploadCloud,
} from 'lucide-react';
import PdfToolShell from './PdfToolShell';
import { useOpenedArtifact } from '@/lib/opened-artifact';
import {
  comparePdfDocuments,
  ensureComparableDocument,
  isDocxFile,
  loadPdfJsDocument,
  renderPdfPageToCanvas,
  renderVisualPixelDiff,
  type FormattingDelta,
  type PdfComparisonSummary,
} from '@/lib/pdf';

const COMPARE_ACCEPT =
  '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const SENSITIVITY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'All (0pt)' },
  { value: 0.5, label: 'Standard (0.5pt)' },
  { value: 1, label: 'Moderate (1pt+)' },
  { value: 2, label: 'Major (2pt+)' },
];

type ChangeFilter = 'all' | 'changed' | 'formatting' | 'text';

function formatChangeBadge(change: FormattingDelta['changes'][number]): {
  label: string;
  detail: string;
} {
  if (change.kind === 'fontFamily') {
    return { label: 'Font', detail: `${change.from} → ${change.to}` };
  }
  if (change.kind === 'fontSize') {
    const sign = change.deltaPt > 0 ? '+' : '';
    return {
      label: 'Size',
      detail: `${change.from}pt → ${change.to}pt (${sign}${change.deltaPt}pt)`,
    };
  }
  if (change.kind === 'bold') {
    return {
      label: 'Weight',
      detail: `${change.from ? 'Bold' : 'Regular'} → ${change.to ? 'Bold' : 'Regular'}`,
    };
  }
  return {
    label: 'Style',
    detail: `${change.from ? 'Italic' : 'Roman'} → ${change.to ? 'Italic' : 'Roman'}`,
  };
}

export default function PdfCompareWorkspace() {
  const { artifact, setArtifactFromFile } = useOpenedArtifact();
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const consumedHandoffRef = useRef(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [visualPageCount, setVisualPageCount] = useState(1);
  const [viewMode, setViewMode] = useState<'side-by-side' | 'slider' | 'overlay' | 'pixel-diff'>(
    'side-by-side'
  );
  const [sliderPct, setSliderPct] = useState(50);
  const [diffPct, setDiffPct] = useState<number | null>(null);
  const [summary, setSummary] = useState<PdfComparisonSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [renderingPreview, setRenderingPreview] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [trackFormatting, setTrackFormatting] = useState(true);
  const [formattingSensitivityPt, setFormattingSensitivityPt] = useState<number>(0.5);
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>('all');

  const canvasARef = useRef<HTMLCanvasElement>(null);
  const canvasBRef = useRef<HTMLCanvasElement>(null);
  const diffCanvasRef = useRef<HTMLCanvasElement>(null);
  const sliderBoxRef = useRef<HTMLDivElement>(null);
  const draggingSliderRef = useRef(false);
  const pdfCacheRef = useRef<{
    fileA: File | null;
    fileB: File | null;
    compA?: File;
    compB?: File;
  }>({ fileA: null, fileB: null });

  const handleSelectFile = useCallback((slot: 'A' | 'B', nextFile: File | null) => {
    setErrorMsg(null);
    setSummary(null);
    setDiffPct(null);
    setPageNumber(1);
    if (slot === 'A') {
      pdfCacheRef.current.compA = undefined;
      setFileA(nextFile);
    } else {
      pdfCacheRef.current.compB = undefined;
      setFileB(nextFile);
    }
    if (nextFile) {
      setArtifactFromFile(nextFile, 'pdf', '/tools/pdf/compare');
    }
  }, [setArtifactFromFile]);

  useEffect(() => {
    if (consumedHandoffRef.current || fileA) return;
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('handoff') === '1' && artifact?.file && artifact.domain === 'pdf') {
      consumedHandoffRef.current = true;
      setFileA(artifact.file);
    }
  }, [artifact, fileA]);

  useEffect(() => {
    if (!fileA || !fileB) return;
    let cancelled = false;

    const renderViews = async () => {
      setRenderingPreview(true);
      setErrorMsg(null);
      try {
        if (pdfCacheRef.current.fileA !== fileA || !pdfCacheRef.current.compA) {
          const resA = await ensureComparableDocument(fileA);
          pdfCacheRef.current.fileA = fileA;
          pdfCacheRef.current.compA = resA.pdfFile;
        }
        if (pdfCacheRef.current.fileB !== fileB || !pdfCacheRef.current.compB) {
          const resB = await ensureComparableDocument(fileB);
          pdfCacheRef.current.fileB = fileB;
          pdfCacheRef.current.compB = resB.pdfFile;
        }
        const cachedA = pdfCacheRef.current.compA!;
        const cachedB = pdfCacheRef.current.compB!;

        if (viewMode === 'pixel-diff' && diffCanvasRef.current) {
          const [res, pdfA, pdfB] = await Promise.all([
            renderVisualPixelDiff(cachedA, cachedB, pageNumber, diffCanvasRef.current, 1.15),
            loadPdfJsDocument(cachedA),
            loadPdfJsDocument(cachedB),
          ]);
          try {
            if (!cancelled) {
              setDiffPct(res.diffPercent);
              setVisualPageCount(Math.max(1, pdfA.numPages, pdfB.numPages));
            }
          } finally {
            await pdfA.destroy().catch(() => {});
            await pdfB.destroy().catch(() => {});
          }
          return;
        }

        const [pdfA, pdfB] = await Promise.all([
          loadPdfJsDocument(cachedA),
          loadPdfJsDocument(cachedB),
        ]);
        try {
          if (!cancelled) {
            setVisualPageCount(Math.max(1, pdfA.numPages, pdfB.numPages));
          }
          if (!cancelled && canvasARef.current && pageNumber <= pdfA.numPages) {
            await renderPdfPageToCanvas(pdfA, pageNumber, canvasARef.current, 1.05);
          }
          if (!cancelled && canvasBRef.current && pageNumber <= pdfB.numPages) {
            await renderPdfPageToCanvas(pdfB, pageNumber, canvasBRef.current, 1.05);
          }
        } finally {
          await pdfA.destroy().catch(() => {});
          await pdfB.destroy().catch(() => {});
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(
            err instanceof Error ? err.message : 'Unable to render one of the selected documents.'
          );
        }
      } finally {
        if (!cancelled) setRenderingPreview(false);
      }
    };

    void renderViews();
    return () => {
      cancelled = true;
    };
  }, [fileA, fileB, pageNumber, viewMode]);

  const runComparison = useCallback(
    async (nextTrackFormatting: boolean, nextSensitivityPt: number) => {
      if (!fileA || !fileB) return;
      setRunning(true);
      setErrorMsg(null);
      try {
        const res = await comparePdfDocuments(fileA, fileB, {
          trackFormatting: nextTrackFormatting,
          formattingSensitivityPt: nextSensitivityPt,
        });
        setSummary(res);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Comparison failed.');
      } finally {
        setRunning(false);
      }
    },
    [fileA, fileB]
  );

  const handleRunCompare = () => {
    void runComparison(trackFormatting, formattingSensitivityPt);
  };

  const handleToggleFormatting = () => {
    const next = !trackFormatting;
    setTrackFormatting(next);
    if (summary && !running) {
      void runComparison(next, formattingSensitivityPt);
    }
  };

  const handleChangeSensitivity = (nextSensitivity: number) => {
    setFormattingSensitivityPt(nextSensitivity);
    if (summary && !running && trackFormatting) {
      void runComparison(trackFormatting, nextSensitivity);
    }
  };

  const downloadReport = () => {
    if (!summary) return;
    const blob = new Blob([summary.reportText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'document-comparison-report.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const maxPages = summary
    ? Math.max(1, summary.pagesA, summary.pagesB, visualPageCount)
    : visualPageCount;

  const filteredPageDiffs = useMemo(() => {
    if (!summary) return [];
    return summary.pageDiffs.filter((d) => {
      if (changeFilter === 'changed') return d.status !== 'identical';
      if (changeFilter === 'formatting') return d.formattingChangeCount > 0;
      if (changeFilter === 'text') return d.addedWords.length > 0 || d.removedWords.length > 0;
      return true;
    });
  }, [summary, changeFilter]);

  return (
    <PdfToolShell
      title="Compare PDF & DOCX"
      description="Side-by-side word, formatting, and pixel diff across PDF and Word (.docx) documents, 100% local in your browser."
      currentHref="/tools/pdf/compare"
      requiresFile={false}
      selectedFiles={fileA ? (fileB ? [fileA, fileB] : [fileA]) : []}
      onFilesSelected={(files) => {
        if (files[0] && !fileA) handleSelectFile('A', files[0]);
        else if (files[0]) handleSelectFile('B', files[0]);
      }}
      hideSubmitBar
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { slot: 'A' as const, label: 'Original Document (A)', file: fileA },
          { slot: 'B' as const, label: 'Revised Document (B)', file: fileB },
        ].map((item) => {
          const isDocx = item.file ? isDocxFile(item.file) : false;
          return (
            <label
              key={item.slot}
              className="p-5 rounded-2xl border-2 border-dashed border-line bg-surface hover:border-line-hover cursor-pointer flex items-center gap-3.5 focus-within:ring-2 focus-within:ring-brand"
            >
              <UploadCloud className="w-6 h-6 text-content-secondary shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-content-secondary">{item.label}</span>
                  {item.file && (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold border ${
                        isDocx
                          ? 'bg-info-bg text-info border-info/30'
                          : 'bg-brand/10 text-brand border-brand/30'
                      }`}
                    >
                      {isDocx ? 'docx' : 'pdf'}
                    </span>
                  )}
                </div>
                <div className="text-sm font-bold text-content truncate mt-0.5">
                  {item.file ? item.file.name : 'Choose PDF or DOCX file…'}
                </div>
              </div>
              <input
                type="file"
                accept={COMPARE_ACCEPT}
                className="sr-only"
                onChange={(e) => handleSelectFile(item.slot, e.target.files?.[0] || null)}
              />
            </label>
          );
        })}
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="p-3.5 rounded-xl border border-error/40 bg-error/10 text-error text-xs font-medium flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      )}

      {fileA && fileB && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 p-3.5 rounded-2xl border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { id: 'side-by-side' as const, label: 'Side-by-side' },
                  { id: 'slider' as const, label: 'Swipe slider' },
                  { id: 'overlay' as const, label: 'Overlay' },
                  { id: 'pixel-diff' as const, label: 'Pixel diff' },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setViewMode(m.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                      viewMode === m.id
                        ? 'bg-brand text-brand-fg'
                        : 'bg-surface-elevated text-content-secondary hover:text-content'
                    }`}
                  >
                    {m.id === 'slider' && <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />}
                    {m.id === 'pixel-diff' && <Layers className="w-3.5 h-3.5" aria-hidden="true" />}
                    <span>{m.label}</span>
                  </button>
                ))}
                {viewMode === 'pixel-diff' && diffPct !== null && (
                  <span className="text-xs font-mono tabular-nums text-content-secondary ml-2">
                    {diffPct}% pixels changed
                  </span>
                )}
                {renderingPreview && (
                  <span className="text-xs text-content-secondary inline-flex items-center gap-1.5 ml-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    <span>Rendering…</span>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={pageNumber <= 1}
                  onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                  className="p-1.5 rounded-lg border border-line bg-surface-elevated disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs font-mono tabular-nums">
                  Page {pageNumber} / {maxPages}
                </span>
                <button
                  type="button"
                  disabled={pageNumber >= maxPages}
                  onClick={() => setPageNumber((p) => Math.min(maxPages, p + 1))}
                  className="p-1.5 rounded-lg border border-line bg-surface-elevated disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  disabled={running}
                  onClick={handleRunCompare}
                  className="muxaro-btn-primary px-4 py-1.5 rounded-xl text-xs font-semibold ml-2 inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {running && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
                  <span>{running ? 'Analyzing…' : 'Analyze all pages'}</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-line text-xs">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={trackFormatting}
                  onClick={handleToggleFormatting}
                  className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                    trackFormatting
                      ? 'border-brand/40 bg-brand/10 text-content'
                      : 'border-line bg-surface-elevated text-content-secondary'
                  }`}
                >
                  <Type className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
                  <span>Track Formatting Changes</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[11px] font-mono ${
                      trackFormatting ? 'bg-brand text-brand-fg' : 'bg-surface text-content-secondary'
                    }`}
                  >
                    {trackFormatting ? 'On' : 'Off'}
                  </span>
                </button>

                <div className="flex items-center gap-1.5">
                  <label
                    htmlFor="formatting-sensitivity-select"
                    className="text-content-secondary font-medium"
                  >
                    Size threshold:
                  </label>
                  <select
                    id="formatting-sensitivity-select"
                    disabled={!trackFormatting}
                    value={formattingSensitivityPt}
                    onChange={(e) => handleChangeSensitivity(Number(e.target.value))}
                    className="px-2.5 py-1 rounded-lg border border-line bg-surface-elevated text-content text-xs font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    {SENSITIVITY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {(isDocxFile(fileA) || isDocxFile(fileB)) && (
                <span className="text-[11px] text-content-secondary">
                  DOCX styling extracted directly from XML runs
                </span>
              )}
            </div>
          </div>

          {viewMode === 'slider' && (
            <div className="p-4 rounded-2xl border border-line bg-surface-elevated space-y-3 flex flex-col items-center">
              <div className="flex items-center gap-3 text-xs text-content-secondary">
                <span>Original (Left)</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={sliderPct}
                  onChange={(e) => setSliderPct(Number(e.target.value))}
                  aria-label="Comparison swipe slider"
                  className="w-56 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
                <span>Revised (Right)</span>
              </div>
              <div
                ref={sliderBoxRef}
                onPointerDown={(e) => {
                  draggingSliderRef.current = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const rect = e.currentTarget.getBoundingClientRect();
                  if (rect.width > 0) {
                    setSliderPct(Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100))));
                  }
                }}
                onPointerMove={(e) => {
                  if (!draggingSliderRef.current || !sliderBoxRef.current) return;
                  const rect = sliderBoxRef.current.getBoundingClientRect();
                  if (rect.width > 0) {
                    setSliderPct(Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100))));
                  }
                }}
                onPointerUp={() => {
                  draggingSliderRef.current = false;
                }}
                onPointerCancel={() => {
                  draggingSliderRef.current = false;
                }}
                className="relative inline-block bg-surface rounded-lg shadow overflow-hidden cursor-ew-resize select-none"
              >
                <canvas
                  ref={canvasBRef}
                  aria-label="Revised document page preview"
                  className="block max-w-full h-auto"
                />
                <div
                  style={{ clipPath: `inset(0 ${100 - sliderPct}% 0 0)` }}
                  className="absolute inset-0 pointer-events-none"
                >
                  <canvas
                    ref={canvasARef}
                    aria-label="Original document page preview"
                    className="block w-full h-full object-contain"
                  />
                </div>
                <div
                  style={{ left: `${sliderPct}%` }}
                  className="absolute top-0 bottom-0 w-0.5 bg-brand pointer-events-none"
                />
              </div>
            </div>
          )}

          {viewMode === 'overlay' && (
            <div className="p-4 rounded-2xl border border-line bg-surface-elevated flex justify-center">
              <div className="relative inline-block bg-surface rounded-lg shadow">
                <canvas
                  ref={canvasARef}
                  aria-label="Original document overlay"
                  className="block max-w-full h-auto"
                />
                <canvas
                  ref={canvasBRef}
                  aria-label="Revised document difference overlay"
                  className="absolute inset-0 block max-w-full h-auto opacity-50 mix-blend-difference pointer-events-none"
                />
              </div>
            </div>
          )}

          {viewMode === 'pixel-diff' && (
            <div className="p-4 rounded-2xl border border-line bg-surface-elevated flex justify-center">
              <canvas
                ref={diffCanvasRef}
                aria-label="Visual pixel difference map"
                className="max-w-full rounded-lg bg-surface shadow"
              />
            </div>
          )}

          {viewMode === 'side-by-side' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="p-3 rounded-2xl border border-line bg-surface-elevated flex flex-col items-center gap-2">
                <span className="text-xs font-semibold text-content-secondary">{fileA.name}</span>
                <canvas
                  ref={canvasARef}
                  aria-label={`Original document ${fileA.name} page ${pageNumber}`}
                  className="max-w-full rounded-lg bg-surface shadow"
                />
              </div>
              <div className="p-3 rounded-2xl border border-line bg-surface-elevated flex flex-col items-center gap-2">
                <span className="text-xs font-semibold text-content-secondary">{fileB.name}</span>
                <canvas
                  ref={canvasBRef}
                  aria-label={`Revised document ${fileB.name} page ${pageNumber}`}
                  className="max-w-full rounded-lg bg-surface shadow"
                />
              </div>
            </div>
          )}

          {summary && (
            <div className="p-5 rounded-2xl border border-line bg-surface space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-bold text-content">Change List &amp; Inspector</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums">
                    <span className="px-2 py-0.5 rounded-md bg-surface-elevated border border-line text-content-secondary">
                      {summary.identicalCount} identical
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-surface-elevated border border-line text-content">
                      {summary.modifiedCount} changed
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-success-bg border border-success/30 text-success">
                      +{summary.totalAddedWords} added
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-error-bg border border-error/30 text-error">
                      -{summary.totalRemovedWords} removed
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-warning-bg border border-warning/30 text-warning">
                      {summary.formattingChangeCount} formatting
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 bg-surface-elevated p-1 rounded-xl border border-line text-xs">
                    {(
                      [
                        { id: 'all', label: 'All' },
                        { id: 'changed', label: 'Changed' },
                        { id: 'text', label: 'Text' },
                        { id: 'formatting', label: 'Formatting' },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setChangeFilter(f.id)}
                        className={`px-2.5 py-1 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                          changeFilter === f.id
                            ? 'bg-brand text-brand-fg'
                            : 'text-content-secondary hover:text-content'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={downloadReport}
                    className="px-3.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-1.5 hover:border-line-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Download report (.txt)</span>
                  </button>
                </div>
              </div>

              <div className="max-h-96 overflow-y-auto space-y-2.5 text-xs pr-1">
                {filteredPageDiffs.length === 0 ? (
                  <div className="p-4 rounded-xl border border-line bg-surface-elevated text-content-secondary text-center">
                    No pages match the selected filter.
                  </div>
                ) : (
                  filteredPageDiffs.map((d) => (
                    <div
                      key={d.pageNumber}
                      className="p-3.5 rounded-xl border border-line bg-surface-elevated space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setPageNumber(d.pageNumber)}
                            className="text-brand hover:underline font-mono tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
                          >
                            Page {d.pageNumber}
                          </button>
                          {d.formattingChangeCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-warning-bg border border-warning/30 text-warning text-[11px] font-mono tabular-nums">
                              {d.formattingChangeCount} formatting
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-[11px] text-content-secondary capitalize">
                          {d.status}
                        </span>
                      </div>

                      {d.removedWords.length > 0 && (
                        <div className="text-error leading-relaxed">
                          - {d.removedWords.join(' ')}
                        </div>
                      )}
                      {d.addedWords.length > 0 && (
                        <div className="text-success leading-relaxed">
                          + {d.addedWords.join(' ')}
                        </div>
                      )}

                      {d.formattingDeltas.length > 0 && (
                        <div className="pt-1.5 border-t border-line/60 space-y-1.5">
                          {d.formattingDeltas.map((delta, idx) => (
                            <div
                              key={`${d.pageNumber}-fmt-${idx}`}
                              className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-surface border border-line/70"
                            >
                              <span className="text-content font-medium truncate max-w-md">
                                &ldquo;{delta.textSample}&rdquo;
                              </span>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {delta.changes.map((ch, cIdx) => {
                                  const badge = formatChangeBadge(ch);
                                  return (
                                    <span
                                      key={cIdx}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-warning-bg border border-warning/30 text-warning font-mono text-[11px] tabular-nums"
                                    >
                                      <span className="opacity-75">{badge.label}:</span>
                                      <span>{badge.detail}</span>
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </PdfToolShell>
  );
}
