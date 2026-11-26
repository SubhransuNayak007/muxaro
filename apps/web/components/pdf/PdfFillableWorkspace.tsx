'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Trash2, ChevronLeft, ChevronRight, Unlock } from 'lucide-react';
import PdfToolShell from './PdfToolShell';
import {
  clearReadOnlyFormFields,
  createFillablePdf,
  loadPdfJsDocument,
  readExistingAcroFormFields,
  renderPdfPageToCanvas,
  suggestFormFieldsForPage,
  type PdfFormFieldSpec,
  type PdfProcessResult,
} from '@/lib/pdf';

export default function PdfFillableWorkspace() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [fields, setFields] = useState<PdfFormFieldSpec[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<PdfFormFieldSpec['type']>('text');
  const [detecting, setDetecting] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [externalResult, setExternalResult] = useState<PdfProcessResult | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

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
          await renderPdfPageToCanvas(pdf, Math.min(pageNumber, pdf.numPages), canvasRef.current, 1.3);
        }
        await pdf.destroy();
      })
      .catch((err) => {
        if (!cancelled) {
          setRenderError(err instanceof Error ? err.message : 'Unable to render PDF for form editing.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [file, pageNumber]);

  const exportTemplateJson = () => {
    if (fields.length === 0) return;
    const blob = new Blob([JSON.stringify({ version: 1, fields }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(file?.name || 'form').replace(/\.pdf$/i, '')}-template.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importTemplateJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const jsonFile = e.target.files?.[0];
    if (!jsonFile) return;
    try {
      const parsed = JSON.parse(await jsonFile.text());
      const incoming = Array.isArray(parsed) ? parsed : parsed?.fields;
      if (Array.isArray(incoming)) {
        const valid = incoming.filter(
          (f) => f && typeof f.name === 'string' && typeof f.x === 'number' && typeof f.y === 'number'
        ) as PdfFormFieldSpec[];
        setFields(valid);
      }
    } catch {
      setRenderError('Invalid form template JSON file.');
    } finally {
      e.target.value = '';
    }
  };

  const handleDetect = async () => {
    if (!file) return;
    setDetecting(true);
    try {
      const detected = await suggestFormFieldsForPage(file, pageNumber);
      setFields((prev) => [
        ...prev.filter((f) => !(f.pageNumber === pageNumber && f.suggested)),
        ...detected,
      ]);
    } finally {
      setDetecting(false);
    }
  };

  const handleUnlockReadOnly = async () => {
    if (!file) return;
    setUnlocking(true);
    try {
      const res = await clearReadOnlyFormFields(file);
      const unlockedFile = new File([res.blob], res.fileName, { type: 'application/pdf' });
      setFile(unlockedFile);
      setExternalResult(res);
      try {
        const existing = await readExistingAcroFormFields(unlockedFile);
        if (existing.length > 0) setFields(existing);
      } catch {}
    } finally {
      setUnlocking(false);
    }
  };

  const addFieldAt = (nx: number, ny: number) => {
    const id = `fld-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const isBox = activeType === 'checkbox' || activeType === 'radio';
    setFields((prev) => [
      ...prev,
      {
        id,
        pageNumber,
        type: activeType,
        name: `${activeType}_${prev.length + 1}`,
        x: Math.max(0.02, Math.min(0.85, nx)),
        y: Math.max(0.02, Math.min(0.9, ny)),
        width: isBox ? 0.035 : 0.25,
        height: activeType === 'multiline' ? 0.07 : isBox ? 0.028 : 0.032,
        options: activeType === 'dropdown' ? ['Option 1', 'Option 2', 'Option 3'] : undefined,
        radioGroup: activeType === 'radio' ? 'group_1' : undefined,
      },
    ]);
  };

  const handleDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingId || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    setFields((prev) =>
      prev.map((f) =>
        f.id === draggingId
          ? {
              ...f,
              x: Math.max(0.01, Math.min(0.98 - f.width, nx - f.width / 2)),
              y: Math.max(0.01, Math.min(0.98 - f.height, ny - f.height / 2)),
            }
          : f
      )
    );
  };

  const pageFields = fields.filter((f) => f.pageNumber === pageNumber);

  return (
    <PdfToolShell
      title="Make PDF fillable"
      description="Sejda & iLovePDF-style AcroForm builder: auto-detect blank lines or drag-and-drop text, checkbox, radio, and dropdown fields."
      currentHref="/tools/pdf/make-fillable"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => {
        setFile(files[0] || null);
        setPageNumber(1);
        setFields([]);
        setExternalResult(null);
      }}
      submitLabel="Create Fillable PDF"
      canSubmit={fields.length > 0}
      externalResult={externalResult}
      onClearExternalResult={() => setExternalResult(null)}
      onRun={(onProgress) => createFillablePdf(file!, fields, onProgress)}
    >
      {file && (
        <div className="space-y-4">
          {renderError && (
            <div className="p-3 rounded-xl bg-error-bg border border-error text-error text-xs font-medium">
              {renderError}
            </div>
          )}
          <div className="p-3 rounded-2xl border border-line bg-surface flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(['text', 'multiline', 'checkbox', 'radio', 'dropdown'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setActiveType(t)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border capitalize ${
                    activeType === t
                      ? 'bg-brand text-white border-brand'
                      : 'bg-surface-elevated text-content border-line'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={unlocking}
                onClick={handleUnlockReadOnly}
                className="px-3.5 py-1.5 rounded-xl border border-line bg-surface-elevated hover:bg-surface-muted text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Unlock className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
                <span>{unlocking ? 'Unlocking…' : 'Unlock Read-Only Fields'}</span>
              </button>

              <button
                type="button"
                disabled={detecting}
                onClick={handleDetect}
                className="px-3.5 py-1.5 rounded-xl border border-line bg-surface-elevated hover:bg-surface-muted text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
                <span>{detecting ? 'Scanning page…' : 'Suggest fields'}</span>
              </button>

              <button
                type="button"
                disabled={fields.length === 0}
                onClick={exportTemplateJson}
                className="px-3 py-1.5 rounded-xl border border-line bg-surface-elevated hover:bg-surface-muted text-xs font-semibold disabled:opacity-40"
              >
                Export JSON
              </button>
              <label className="px-3 py-1.5 rounded-xl border border-line bg-surface-elevated hover:bg-surface-muted text-xs font-semibold cursor-pointer">
                <span>Import JSON</span>
                <input type="file" accept="application/json,.json" className="sr-only" onChange={importTemplateJson} />
              </label>

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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 p-4 rounded-2xl border border-line bg-surface-elevated overflow-auto flex justify-center">
              <div
                className="relative inline-block bg-white shadow-lg cursor-crosshair select-none"
                onPointerMove={handleDragMove}
                onPointerUp={() => setDraggingId(null)}
                onClick={(e) => {
                  if (e.target !== canvasRef.current) return;
                  const rect = canvasRef.current!.getBoundingClientRect();
                  addFieldAt(
                    (e.clientX - rect.left) / rect.width,
                    (e.clientY - rect.top) / rect.height
                  );
                }}
              >
                <canvas ref={canvasRef} className="block max-w-full h-auto" />
                {pageFields.map((fld) => (
                  <div
                    key={fld.id}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setDraggingId(fld.id);
                    }}
                    style={{
                      left: `${fld.x * 100}%`,
                      top: `${fld.y * 100}%`,
                      width: `${fld.width * 100}%`,
                      height: `${fld.height * 100}%`,
                    }}
                    className={`absolute border-2 text-[10px] font-semibold px-1 flex items-center truncate cursor-grab active:cursor-grabbing ${
                      fld.suggested
                        ? 'border-amber-500 bg-amber-400/20 text-amber-900'
                        : 'border-brand bg-brand/15 text-brand'
                    }`}
                  >
                    {fld.name}
                  </div>
                ))}
              </div>
            </div>

            <aside className="p-4 rounded-2xl border border-line bg-surface space-y-3">
              <div className="text-xs font-bold text-content">
                Page {pageNumber} Fields ({pageFields.length}) — drag boxes on canvas to reposition
              </div>
              <div className="max-h-[460px] overflow-y-auto space-y-2.5">
                {pageFields.length === 0 ? (
                  <p className="text-xs text-content-secondary">
                    Click on the document to place a {activeType} field, or click &ldquo;Suggest fields&rdquo;.
                  </p>
                ) : (
                  pageFields.map((fld) => (
                    <div
                      key={fld.id}
                      className="p-2.5 rounded-xl border border-line bg-surface-elevated space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <input
                          type="text"
                          value={fld.name}
                          onChange={(e) =>
                            setFields((prev) =>
                              prev.map((item) =>
                                item.id === fld.id ? { ...item, name: e.target.value } : item
                              )
                            )
                          }
                          className="flex-1 px-2 py-1 rounded border border-line bg-surface text-content font-mono text-[11px]"
                        />
                        <button
                          type="button"
                          onClick={() => setFields((prev) => prev.filter((item) => item.id !== fld.id))}
                          aria-label={`Remove ${fld.name}`}
                          className="p-1 text-content-secondary hover:text-error"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {fld.type === 'dropdown' && (
                        <input
                          type="text"
                          placeholder="Options comma-separated"
                          value={(fld.options || []).join(', ')}
                          onChange={(e) =>
                            setFields((prev) =>
                              prev.map((item) =>
                                item.id === fld.id
                                  ? {
                                      ...item,
                                      options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                                    }
                                  : item
                              )
                            )
                          }
                          className="w-full px-2 py-1 rounded border border-line bg-surface text-[11px]"
                        />
                      )}

                      <div className="flex items-center justify-between text-[11px] text-content-secondary">
                        <span className="capitalize">{fld.type}</span>
                        <label className="inline-flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={Boolean(fld.required)}
                            onChange={(e) =>
                              setFields((prev) =>
                                prev.map((item) =>
                                  item.id === fld.id ? { ...item, required: e.target.checked } : item
                                )
                              )
                            }
                          />
                          <span>Required</span>
                        </label>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </aside>
          </div>
        </div>
      )}
    </PdfToolShell>
  );
}
