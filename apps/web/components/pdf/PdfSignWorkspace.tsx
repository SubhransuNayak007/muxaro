'use client';

import React, { useEffect, useRef, useState } from 'react';
import { PenTool, Type, Upload, Trash2, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import PdfToolShell from './PdfToolShell';
import {
  applyEditsAndSignaturesToPdf,
  loadPdfJsDocument,
  renderPdfPageToCanvas,
  type PdfEditorOverlayElement,
} from '@/lib/pdf';

const SAVED_SIG_KEY = 'muxaro.pdf.saved_signature.v1';
const SAVED_SIGS_LIST_KEY = 'muxaro.pdf.saved_signatures_list.v1';

export default function PdfSignWorkspace() {
  const padRef = useRef<HTMLCanvasElement>(null);
  const pageCanvasRef = useRef<HTMLCanvasElement>(null);
  const strokePointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const [drawing, setDrawing] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [renderError, setRenderError] = useState<string | null>(null);

  const [sigMode, setSigMode] = useState<'draw' | 'type' | 'upload'>('draw');
  const [typedName, setTypedName] = useState('Jane Doe');
  const [typeStyle, setTypeStyle] = useState<'serif' | 'cursive' | 'mono'>('serif');
  const [penColor, setPenColor] = useState('#0b0b0d');
  const [sigScalePct, setSigScalePct] = useState(24);
  const [sigDataUrl, setSigDataUrl] = useState<string | null>(null);
  const [savedSlots, setSavedSlots] = useState<string[]>([]);
  const [placements, setPlacements] = useState<PdfEditorOverlayElement[]>([]);

  const saveSigToSlots = (url: string) => {
    try {
      localStorage.setItem(SAVED_SIG_KEY, url);
      setSavedSlots((prev) => {
        const next = [url, ...prev.filter((s) => s !== url)].slice(0, 3);
        try {
          localStorage.setItem(SAVED_SIGS_LIST_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
    } catch {}
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_SIG_KEY);
      if (saved) setSigDataUrl(saved);
      const rawList = localStorage.getItem(SAVED_SIGS_LIST_KEY);
      if (rawList) {
        const parsed = JSON.parse(rawList);
        if (Array.isArray(parsed)) setSavedSlots(parsed.filter((s) => typeof s === 'string').slice(0, 3));
      } else if (saved) {
        setSavedSlots([saved]);
      }
    } catch {}
  }, []);

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
        if (pageCanvasRef.current) {
          await renderPdfPageToCanvas(pdf, Math.min(pageNumber, pdf.numPages), pageCanvasRef.current, 1.3);
        }
        await pdf.destroy();
      })
      .catch((err) => {
        if (!cancelled) {
          setRenderError(err instanceof Error ? err.message : 'Unable to render PDF for signing.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [file, pageNumber]);

  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = padRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    strokePointsRef.current = [{ x, y }];
    setDrawing(true);
  };

  const moveDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing) return;
    const canvas = padRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pts = strokePointsRef.current;
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    pts.push({ x, y });
    if (pts.length < 2) return;
    ctx.strokeStyle = penColor;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (pts.length === 2) {
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
    } else {
      const p0 = pts[pts.length - 3];
      const p1 = pts[pts.length - 2];
      const p2 = pts[pts.length - 1];
      const mid1x = (p0.x + p1.x) / 2;
      const mid1y = (p0.y + p1.y) / 2;
      const mid2x = (p1.x + p2.x) / 2;
      const mid2y = (p1.y + p2.y) / 2;
      ctx.moveTo(mid1x, mid1y);
      ctx.quadraticCurveTo(p1.x, p1.y, mid2x, mid2y);
    }
    ctx.stroke();
  };

  const endDraw = () => {
    if (!drawing) return;
    setDrawing(false);
    strokePointsRef.current = [];
    const canvas = padRef.current;
    if (canvas) {
      const url = canvas.toDataURL('image/png');
      setSigDataUrl(url);
      saveSigToSlots(url);
    }
  };

  const clearPad = () => {
    const canvas = padRef.current;
    if (!canvas) return;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setSigDataUrl(null);
    try {
      localStorage.removeItem(SAVED_SIG_KEY);
    } catch {}
  };

  const renderTypedSignature = (name: string, color: string, style: typeof typeStyle) => {
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = 140;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = color;
    ctx.font =
      style === 'cursive'
        ? 'italic 50px "Brush Script MT", "Segoe Script", cursive'
        : style === 'mono'
        ? 'bold 38px "Courier New", monospace'
        : 'italic 46px Georgia, "Times New Roman", serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(name || 'Signature', 20, 72);
    const url = c.toDataURL('image/png');
    setSigDataUrl(url);
    saveSigToSlots(url);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const imgFile = e.target.files?.[0];
    if (!imgFile) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(img, 0, 0);
          const idata = ctx.getImageData(0, 0, c.width, c.height);
          const d = idata.data;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) {
              d[i + 3] = 0;
            }
          }
          ctx.putImageData(idata, 0, 0);
          setSigDataUrl(c.toDataURL('image/png'));
        };
        img.src = reader.result;
      }
    };
    reader.readAsDataURL(imgFile);
  };

  const placeOnPage = (nx: number, ny: number) => {
    if (!sigDataUrl) return;
    const w = sigScalePct / 100;
    const img = new Image();
    const commitPlacement = (aspect: number) => {
      const canvasRect = pageCanvasRef.current?.getBoundingClientRect();
      const pageAspect = canvasRect && canvasRect.width > 0 ? canvasRect.height / canvasRect.width : 1.414;
      const h = Math.max(0.03, Math.min(0.45, (w / Math.max(0.3, aspect)) / pageAspect));
      setPlacements((prev) => [
        ...prev,
        {
          id: `sig-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          pageNumber,
          kind: 'signature',
          x: Math.max(0.02, Math.min(0.95 - w, nx - w / 2)),
          y: Math.max(0.02, Math.min(0.95 - h, ny - h / 2)),
          width: w,
          height: h,
          imageDataUrl: sigDataUrl,
        },
      ]);
    };
    img.onload = () => {
      const aspect = img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 3.0;
      commitPlacement(aspect);
    };
    img.onerror = () => commitPlacement(3.0);
    img.src = sigDataUrl;
  };

  const addDateStamp = () => {
    setPlacements((prev) => [
      ...prev,
      {
        id: `date-${Date.now()}`,
        pageNumber,
        kind: 'text',
        x: 0.65,
        y: 0.85,
        width: 0.22,
        height: 0.04,
        text: new Date().toISOString().slice(0, 10),
        fontSize: 12,
        color: penColor,
      },
    ]);
  };

  const handleDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingId || !pageCanvasRef.current) return;
    const rect = pageCanvasRef.current.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    setPlacements((prev) =>
      prev.map((p) =>
        p.id === draggingId
          ? {
              ...p,
              x: Math.max(0.01, Math.min(0.98 - p.width, nx - p.width / 2)),
              y: Math.max(0.01, Math.min(0.98 - p.height, ny - p.height / 2)),
            }
          : p
      )
    );
  };

  const pagePlacements = placements.filter((p) => p.pageNumber === pageNumber);

  return (
    <PdfToolShell
      title="Sign PDF"
      description="Draw, type, or upload a transparent signature, drag to position it anywhere, and add a date stamp."
      currentHref="/tools/pdf/sign"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => {
        setFile(files[0] || null);
        setPageNumber(1);
        setPlacements([]);
      }}
      submitLabel="Apply Signature & Save PDF"
      canSubmit={placements.length > 0}
      onRun={(onProgress) => applyEditsAndSignaturesToPdf(file!, placements, {}, onProgress)}
    >
      <div className="p-5 rounded-2xl border border-line bg-surface space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {[
              { id: 'draw' as const, label: 'Draw', Icon: PenTool },
              { id: 'type' as const, label: 'Type', Icon: Type },
              { id: 'upload' as const, label: 'Upload image', Icon: Upload },
            ].map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSigMode(id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border ${
                  sigMode === id
                    ? 'bg-brand text-white border-brand'
                    : 'bg-surface-elevated text-content border-line'
                }`}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-content-secondary inline-flex items-center gap-2">
              <span>Size ({sigScalePct}%)</span>
              <input
                type="range"
                min={12}
                max={45}
                value={sigScalePct}
                onChange={(e) => setSigScalePct(Number(e.target.value))}
              />
            </label>
            <input
              type="color"
              value={penColor}
              onChange={(e) => {
                const next = e.target.value;
                setPenColor(next);
                if (sigMode === 'type') {
                  renderTypedSignature(typedName, next, typeStyle);
                }
              }}
              aria-label="Signature ink color"
              className="w-8 h-8 rounded-lg border border-line cursor-pointer"
            />
            {sigMode === 'draw' && (
              <button
                type="button"
                onClick={clearPad}
                className="px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs font-medium inline-flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear pad</span>
              </button>
            )}
          </div>
        </div>

        {sigMode === 'draw' && (
          <canvas
            ref={padRef}
            width={560}
            height={150}
            onPointerDown={startDraw}
            onPointerMove={moveDraw}
            onPointerUp={endDraw}
            onPointerCancel={endDraw}
            className="w-full max-w-xl h-36 rounded-xl border border-line bg-white touch-none cursor-crosshair"
          />
        )}

        {sigMode === 'type' && (
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={typedName}
              onChange={(e) => {
                setTypedName(e.target.value);
                renderTypedSignature(e.target.value, penColor, typeStyle);
              }}
              placeholder="Type your signature…"
              className="px-3.5 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content w-64"
            />
            <select
              value={typeStyle}
              onChange={(e) => {
                const st = e.target.value as typeof typeStyle;
                setTypeStyle(st);
                renderTypedSignature(typedName, penColor, st);
              }}
              className="px-3 py-2 rounded-xl border border-line bg-surface-elevated text-xs text-content"
            >
              <option value="serif">Classic Serif</option>
              <option value="cursive">Calligraphic Script</option>
              <option value="mono">Executive Mono</option>
            </select>
          </div>
        )}

        {sigMode === 'upload' && (
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-line bg-surface-elevated text-xs font-semibold cursor-pointer">
            <Upload className="w-4 h-4" />
            <span>Upload signature PNG/JPG (white background auto-removed)</span>
            <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={handleImageUpload} />
          </label>
        )}

        {sigDataUrl && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-content-secondary">
            <span>Active signature:</span>
            <img src={sigDataUrl} alt="Active signature preview" className="h-10 px-2 py-1 rounded bg-white border border-line" />
            {savedSlots.length > 1 && (
              <div className="flex items-center gap-1.5">
                <span>Saved:</span>
                {savedSlots.map((slot, idx) => (
                  <button
                    key={slot.slice(-16) + idx}
                    type="button"
                    onClick={() => setSigDataUrl(slot)}
                    className={`p-0.5 rounded border ${
                      sigDataUrl === slot ? 'border-brand ring-1 ring-brand/40' : 'border-line'
                    } bg-white`}
                    title={`Select saved signature ${idx + 1}`}
                  >
                    <img src={slot} alt={`Saved signature ${idx + 1}`} className="h-6 w-14 object-contain" />
                  </button>
                ))}
              </div>
            )}
            <span>Click the PDF page to stamp, then drag to reposition.</span>
          </div>
        )}
      </div>

      {file && (
        <div className="space-y-3">
          {renderError && (
            <div className="p-3 rounded-xl bg-error-bg border border-error text-error text-xs font-medium">
              {renderError}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-content-secondary">
                {placements.length} placement(s)
              </span>
              <button
                type="button"
                onClick={addDateStamp}
                className="px-3 py-1 rounded-lg border border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-1"
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Add today&apos;s date</span>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={pageNumber <= 1}
                onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded-lg border border-line bg-surface-elevated disabled:opacity-40"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs font-mono">
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
          </div>

          <div className="p-4 rounded-2xl border border-line bg-surface-elevated overflow-auto flex justify-center">
            <div
              className="relative inline-block bg-white shadow-lg cursor-crosshair select-none"
              onPointerMove={handleDragMove}
              onPointerUp={() => setDraggingId(null)}
              onClick={(e) => {
                if (e.target !== pageCanvasRef.current) return;
                const rect = pageCanvasRef.current!.getBoundingClientRect();
                placeOnPage(
                  (e.clientX - rect.left) / rect.width,
                  (e.clientY - rect.top) / rect.height
                );
              }}
            >
              <canvas ref={pageCanvasRef} className="block max-w-full h-auto" />
              {pagePlacements.map((p) => (
                <div
                  key={p.id}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setDraggingId(p.id);
                  }}
                  style={{
                    left: `${p.x * 100}%`,
                    top: `${p.y * 100}%`,
                    width: `${p.width * 100}%`,
                    height: `${p.height * 100}%`,
                  }}
                  className="absolute border border-dashed border-brand bg-brand/5 cursor-grab active:cursor-grabbing"
                >
                  {p.kind === 'text' ? (
                    <span className="text-xs font-mono px-1" style={{ color: p.color || '#0b0b0d' }}>
                      {p.text}
                    </span>
                  ) : (
                    p.imageDataUrl && (
                      <img src={p.imageDataUrl} alt="Placed signature" className="w-full h-full object-contain pointer-events-none" />
                    )
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPlacements((prev) => prev.filter((item) => item.id !== p.id));
                    }}
                    aria-label="Remove signature stamp"
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-error text-white text-[10px] font-bold"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </PdfToolShell>
  );
}
