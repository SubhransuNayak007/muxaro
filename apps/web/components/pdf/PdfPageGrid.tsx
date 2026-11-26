'use client';

import React, { useEffect, useState } from 'react';
import {
  RotateCw,
  RotateCcw,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Loader2,
  Trash2,
  X,
} from 'lucide-react';
import { getPdfThumbnails } from '@/lib/pdf';

export interface PdfThumbItem {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
}

interface PdfPageGridProps {
  file: File | null;
  mode: 'select' | 'rotate' | 'reorder';
  selectIntent?: 'keep' | 'delete';
  selectedPages?: number[];
  onSelectionChange?: (pages: number[]) => void;
  rotations?: Record<number, number>;
  onRotationsChange?: (rotations: Record<number, number>) => void;
  pageOrder?: number[];
  onOrderChange?: (order: number[]) => void;
  orderRotations?: Record<number, number>;
  onOrderRotationsChange?: (rotations: Record<number, number>) => void;
  onTotalPages?: (total: number) => void;
}

export default function PdfPageGrid({
  file,
  mode,
  selectIntent = 'keep',
  selectedPages = [],
  onSelectionChange,
  rotations = {},
  onRotationsChange,
  pageOrder,
  onOrderChange,
  orderRotations = {},
  onOrderRotationsChange,
  onTotalPages,
}: PdfPageGridProps) {
  const [thumbs, setThumbs] = useState<PdfThumbItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!file) {
      setThumbs([]);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    setThumbs([]);

    let cancelled = false;
    getPdfThumbnails(file, {
      scale: 0.38,
      signal: ctrl.signal,
      onPage: (pageNumber, dataUrl) => {
        if (cancelled) return;
        setThumbs((prev) => {
          if (prev.some((t) => t.pageNumber === pageNumber)) return prev;
          const next = [...prev, { pageNumber, dataUrl, width: 0, height: 0 }];
          return next;
        });
      },
    })
      .then((all) => {
        if (cancelled || ctrl.signal.aborted) return;
        setThumbs(all);
        onTotalPages?.(all.length);
        if (mode === 'reorder' && onOrderChange) {
          onOrderChange(all.map((t) => t.pageNumber));
        }
      })
      .catch((err) => {
        if ((err as Error)?.name !== 'AbortError') {
          setError(err instanceof Error ? err.message : 'Could not render page thumbnails.');
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });

    return () => ctrl.abort();
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!file) return null;

  const selectedSet = new Set(selectedPages);
  const orderedList =
    mode === 'reorder' && pageOrder && pageOrder.length > 0
      ? pageOrder
      : thumbs.map((t) => t.pageNumber);

  const thumbByPage = new Map(thumbs.map((t) => [t.pageNumber, t]));

  const toggleSelect = (p: number) => {
    if (!onSelectionChange) return;
    if (selectedSet.has(p)) {
      onSelectionChange(selectedPages.filter((n) => n !== p));
    } else {
      onSelectionChange([...selectedPages, p].sort((a, b) => a - b));
    }
  };

  const rotateOne = (p: number, delta: number) => {
    if (!onRotationsChange) return;
    const cur = rotations[p] || 0;
    onRotationsChange({ ...rotations, [p]: (cur + delta + 360) % 360 });
  };

  const moveAt = (fromIdx: number, toIdx: number) => {
    if (!onOrderChange || fromIdx === toIdx) return;
    if (toIdx < 0 || toIdx >= orderedList.length) return;
    const copy = [...orderedList];
    const [moved] = copy.splice(fromIdx, 1);
    copy.splice(toIdx, 0, moved);
    onOrderChange(copy);
  };

  const duplicateAt = (idx: number) => {
    if (!onOrderChange) return;
    const copy = [...orderedList];
    copy.splice(idx + 1, 0, copy[idx]);
    onOrderChange(copy);
  };

  const deleteAt = (idx: number) => {
    if (!onOrderChange || orderedList.length <= 1) return;
    onOrderChange(orderedList.filter((_, i) => i !== idx));
  };

  const rotateSlotAt = (idx: number, delta: number) => {
    if (!onOrderRotationsChange) return;
    const cur = orderRotations[idx] || 0;
    onOrderRotationsChange({ ...orderRotations, [idx]: (cur + delta + 360) % 360 });
  };

  return (
    <div className="space-y-3">
      {loading && (
        <div className="flex items-center gap-2 text-xs text-content-secondary">
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          <span>Rendering page previews ({thumbs.length} loaded)…</span>
        </div>
      )}
      {error && <div className="text-xs text-error">{error}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {orderedList.map((pageNo, idx) => {
          const item = thumbByPage.get(pageNo);
          const isSelected = selectedSet.has(pageNo);
          const rot = mode === 'reorder' ? orderRotations[idx] || 0 : rotations[pageNo] || 0;
          const isDeleteMarked = mode === 'select' && selectIntent === 'delete' && isSelected;
          const isKeepMarked = mode === 'select' && selectIntent === 'keep' && isSelected;

          return (
            <div
              key={`${pageNo}-${idx}`}
              draggable={mode === 'reorder'}
              onDragStart={() => setDragIdx(idx)}
              onDragOver={(e) => {
                if (mode !== 'reorder') return;
                e.preventDefault();
                setOverIdx(idx);
              }}
              onDragLeave={() => {
                if (overIdx === idx) setOverIdx(null);
              }}
              onDrop={(e) => {
                if (mode !== 'reorder') return;
                e.preventDefault();
                if (dragIdx !== null) moveAt(dragIdx, idx);
                setDragIdx(null);
                setOverIdx(null);
              }}
              onDragEnd={() => {
                setDragIdx(null);
                setOverIdx(null);
              }}
              className={`rounded-xl border p-2.5 bg-surface flex flex-col gap-2 transition-colors ${
                mode === 'reorder' ? 'cursor-grab active:cursor-grabbing' : ''
              } ${
                overIdx === idx && dragIdx !== idx
                  ? 'border-brand ring-2 ring-brand/40'
                  : isDeleteMarked
                  ? 'border-error ring-2 ring-error/30 opacity-75'
                  : isKeepMarked
                  ? 'border-brand ring-2 ring-brand/25'
                  : 'border-line'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  if (mode === 'select') toggleSelect(pageNo);
                  else if (mode === 'rotate') rotateOne(pageNo, 90);
                }}
                className="relative aspect-[3/4] w-full rounded-lg bg-white border border-line/50 overflow-hidden flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                aria-label={
                  mode === 'select'
                    ? `Toggle page ${pageNo}`
                    : mode === 'rotate'
                    ? `Rotate page ${pageNo}`
                    : `Page ${pageNo}`
                }
              >
                {item ? (
                  <img
                    src={item.dataUrl}
                    alt={`Page ${pageNo}`}
                    className="max-w-full max-h-full object-contain transition-transform duration-150"
                    style={{ transform: `rotate(${rot}deg)` }}
                  />
                ) : (
                  <span className="text-xs text-content-muted">Page {pageNo}</span>
                )}

                {isKeepMarked && (
                  <span className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-brand text-white flex items-center justify-center shadow">
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  </span>
                )}
                {isDeleteMarked && (
                  <span className="absolute inset-0 bg-error/20 flex flex-col items-center justify-center gap-1 backdrop-blur-[1px]">
                    <span className="w-8 h-8 rounded-full bg-error text-white flex items-center justify-center shadow">
                      <X className="w-4 h-4" aria-hidden="true" />
                    </span>
                    <span className="px-2 py-0.5 rounded bg-error text-white text-[10px] font-bold tracking-wide uppercase">
                      Delete
                    </span>
                  </span>
                )}
                {rot !== 0 && (
                  <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/75 text-white font-mono text-[10px]">
                    {rot}°
                  </span>
                )}
              </button>

              <div className="flex items-center justify-between gap-1 text-xs">
                <span className="font-mono text-content-secondary">
                  {mode === 'reorder' ? `#${idx + 1} (p.${pageNo})` : `Page ${pageNo}`}
                </span>

                {mode === 'rotate' && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => rotateOne(pageNo, -90)}
                      aria-label={`Rotate page ${pageNo} left`}
                      className="p-1 rounded hover:bg-surface-elevated text-content-secondary hover:text-content"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => rotateOne(pageNo, 90)}
                      aria-label={`Rotate page ${pageNo} right`}
                      className="p-1 rounded hover:bg-surface-elevated text-content-secondary hover:text-content"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {mode === 'reorder' && (
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => moveAt(idx, idx - 1)}
                      disabled={idx === 0}
                      aria-label={`Move page ${pageNo} earlier`}
                      className="p-1 rounded hover:bg-surface-elevated disabled:opacity-30"
                    >
                      <ArrowLeft className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveAt(idx, idx + 1)}
                      disabled={idx === orderedList.length - 1}
                      aria-label={`Move page ${pageNo} later`}
                      className="p-1 rounded hover:bg-surface-elevated disabled:opacity-30"
                    >
                      <ArrowRight className="w-3 h-3" />
                    </button>
                    {onOrderRotationsChange && (
                      <button
                        type="button"
                        onClick={() => rotateSlotAt(idx, 90)}
                        aria-label={`Rotate slot ${idx + 1}`}
                        className="p-1 rounded hover:bg-surface-elevated"
                      >
                        <RotateCw className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => duplicateAt(idx)}
                      aria-label={`Duplicate page ${pageNo}`}
                      className="p-1 rounded hover:bg-surface-elevated"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      disabled={orderedList.length <= 1}
                      onClick={() => deleteAt(idx)}
                      aria-label={`Remove page ${pageNo}`}
                      className="p-1 rounded hover:bg-surface-elevated text-error disabled:opacity-30"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
