'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Type,
  Square,
  Circle,
  Minus,
  ArrowRight,
  Eraser,
  Image as ImageIcon,
  Undo2,
  Redo2,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Link2,
  SearchCode,
  MousePointerClick,
  Bold,
  Italic,
  ExternalLink,
  RotateCcw,
  Check,
  X,
  Eye,
  EyeOff,
} from 'lucide-react';
import PdfToolShell from './PdfToolShell';
import {
  applyEditsAndSignaturesToPdf,
  getPageLinkAnnotations,
  getPageTextSpans,
  loadPdfJsDocument,
  readExistingAcroFormFields,
  renderPdfPageToCanvas,
  type PdfEditorOverlayElement,
  type PdfExistingLink,
  type PdfExistingLinkEdit,
  type PdfFormFieldSpec,
  type PdfInlineTextEdit,
  type PdfStandardFontChoice,
  type PdfTextSpan,
} from '@/lib/pdf';
import { buildCssFontStack, ensurePdfFontLoadedForBrowser } from '@/lib/pdf/font-matcher';

type ActiveEditorTool = 'edit-text' | PdfEditorOverlayElement['kind'];

interface HistorySnapshot {
  elements: PdfEditorOverlayElement[];
  edits: PdfInlineTextEdit[];
  linkEdits: PdfExistingLinkEdit[];
}

interface DocumentMatch {
  pageNumber: number;
  span: PdfTextSpan;
}

const RENDER_SCALE = 1.35;

function cssFontForEdit(
  choice: PdfStandardFontChoice,
  modernSlug?: PdfInlineTextEdit['modernSlug']
): string {
  return buildCssFontStack(modernSlug, choice);
}

function replaceTextOccurrences(
  source: string,
  query: string,
  replacement: string,
  caseSensitive: boolean
): string {
  if (!query) return source;
  if (caseSensitive) {
    return source.split(query).join(replacement);
  }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.replace(new RegExp(escaped, 'gi'), () => replacement);
}

function spanMatchesQuery(text: string, query: string, caseSensitive: boolean): boolean {
  if (!query) return false;
  return caseSensitive
    ? text.includes(query)
    : text.toLowerCase().includes(query.toLowerCase());
}

function buildEditFromSpan(
  sp: PdfTextSpan,
  pageNumber: number,
  overrideText?: string
): PdfInlineTextEdit {
  return {
    id: sp.id,
    pageNumber,
    x: sp.x,
    y: sp.y,
    width: sp.width,
    height: sp.height,
    originalText: sp.text,
    newText: overrideText !== undefined ? overrideText : sp.text,
    fontFamily: sp.mappedFamily || 'helvetica',
    fontName: sp.fontName,
    modernSlug: sp.modernSlug,
    fontWeight: sp.fontWeight,
    ascentRatio: sp.ascentRatio,
    fontSize: Math.max(5.5, Math.round(sp.fontSize * 100) / 100),
    color: sp.color || '#0b0b0d',
    bgColor: sp.bgColor || '#ffffff',
    bgSliceDataUrl: sp.bgSliceDataUrl,
    baselineY: sp.baselineY,
    bold: sp.bold,
    italic: sp.italic,
    matchOriginalWidth: true,
    blockWidth: sp.blockWidth,
  };
}

export default function PdfEditorWorkspace() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spansCacheRef = useRef<Map<number, PdfTextSpan[]>>(new Map());
  const linksCacheRef = useRef<Map<number, PdfExistingLink[]>>(new Map());

  const [file, setFile] = useState<File | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageHeightPts, setPageHeightPts] = useState(792);
  const [canvasDisplayHeight, setCanvasDisplayHeight] = useState(1069);

  const [elements, setElements] = useState<PdfEditorOverlayElement[]>([]);
  const [inlineEdits, setInlineEdits] = useState<PdfInlineTextEdit[]>([]);
  const [existingLinkEdits, setExistingLinkEdits] = useState<PdfExistingLinkEdit[]>([]);
  const [history, setHistory] = useState<HistorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<HistorySnapshot[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [draftLinkUrl, setDraftLinkUrl] = useState('');

  const [pageSpans, setPageSpans] = useState<PdfTextSpan[]>([]);
  const [pageLinks, setPageLinks] = useState<PdfExistingLink[]>([]);
  const [editingSpan, setEditingSpan] = useState<PdfInlineTextEdit | null>(null);
  const [sampledBgColor, setSampledBgColor] = useState<string>('#ffffff');
  const [showEditHighlights, setShowEditHighlights] = useState<boolean>(false);

  const [activeTool, setActiveTool] = useState<ActiveEditorTool>('edit-text');
  const [drawColor, setDrawColor] = useState('#111827');
  const [fontSize, setFontSize] = useState(13);
  const [fontFamily, setFontFamily] = useState<PdfStandardFontChoice>('helvetica');
  const [linkUrlInput, setLinkUrlInput] = useState('https://');

  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matches, setMatches] = useState<DocumentMatch[]>([]);
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [replaceNotice, setReplaceNotice] = useState<string | null>(null);

  const [acroFields, setAcroFields] = useState<PdfFormFieldSpec[]>([]);
  const [formValues, setFormValues] = useState<Record<string, string | boolean>>({});
  const [renderError, setRenderError] = useState<string | null>(null);

  // Observe responsive canvas height for proportional WYSIWYG inline text sizing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const syncSize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.height > 0) setCanvasDisplayHeight(rect.height);
    };
    syncSize();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(syncSize);
      ro.observe(canvas);
      return () => ro.disconnect();
    }
  }, [file, pageNumber]);

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
        const targetPage = Math.min(pageNumber, pdf.numPages);
        if (canvasRef.current) {
          const dims = await renderPdfPageToCanvas(pdf, targetPage, canvasRef.current, RENDER_SCALE);
          if (!cancelled) {
            setPageHeightPts(Math.max(1, dims.height / RENDER_SCALE));
            const rect = canvasRef.current.getBoundingClientRect();
            setCanvasDisplayHeight(rect.height > 0 ? rect.height : dims.height);
          }
        }

        const cachedSpans = spansCacheRef.current.get(targetPage);
        const cachedLinks = linksCacheRef.current.get(targetPage);

        const [spans, links] = await Promise.all([
          cachedSpans ? Promise.resolve(cachedSpans) : getPageTextSpans(pdf, targetPage),
          cachedLinks ? Promise.resolve(cachedLinks) : getPageLinkAnnotations(pdf, targetPage),
        ]);

        if (!cancelled) {
          spansCacheRef.current.set(targetPage, spans);
          linksCacheRef.current.set(targetPage, links);
          setPageSpans(spans);
          setPageLinks(links);

          // Preload detected modern @fontsource fonts so canvas edits match PDF typography
          const uniqueFonts = new Map<string, { slug: PdfTextSpan['modernSlug']; weight: 400 | 600 | 700; italic: boolean }>();
          for (const sp of spans) {
            if (!sp.modernSlug) continue;
            const weight = sp.fontWeight || (sp.bold ? 700 : 400);
            const key = `${sp.modernSlug}-${weight}-${sp.italic ? 'i' : 'n'}`;
            if (!uniqueFonts.has(key)) {
              uniqueFonts.set(key, { slug: sp.modernSlug, weight, italic: sp.italic });
            }
          }
          uniqueFonts.forEach((f) => {
            void ensurePdfFontLoadedForBrowser(f.slug, f.weight, f.italic);
          });
        }
        await pdf.destroy();
      })
      .catch((err) => {
        if (!cancelled) {
          setRenderError(err instanceof Error ? err.message : 'Unable to load PDF page in editor.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [file, pageNumber]);

  const getAllDocumentSpans = useCallback(
    async (targetFile: File): Promise<Map<number, PdfTextSpan[]>> => {
      const pdf = await loadPdfJsDocument(targetFile);
      try {
        for (let p = 1; p <= pdf.numPages; p += 1) {
          if (!spansCacheRef.current.has(p)) {
            const spans = await getPageTextSpans(pdf, p);
            spansCacheRef.current.set(p, spans);
          }
        }
        return spansCacheRef.current;
      } finally {
        await pdf.destroy();
      }
    },
    []
  );

  // Live Find & Replace match indexing across all pages
  useEffect(() => {
    const q = findText.trim();
    if (!file || !q) {
      setMatches([]);
      setActiveMatchIdx(0);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const allMap = await getAllDocumentSpans(file);
        if (cancelled) return;
        const found: DocumentMatch[] = [];
        const sortedPages = Array.from(allMap.keys()).sort((a, b) => a - b);
        for (const p of sortedPages) {
          const spans = allMap.get(p) || [];
          for (const sp of spans) {
            const existing = inlineEdits.find((e) => e.id === sp.id);
            const currentText = existing ? existing.newText : sp.text;
            if (spanMatchesQuery(currentText, q, caseSensitive)) {
              found.push({ pageNumber: p, span: sp });
            }
          }
        }
        if (!cancelled) {
          setMatches(found);
          setActiveMatchIdx((prev) => (found.length === 0 ? 0 : Math.min(prev, found.length - 1)));
        }
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [file, findText, caseSensitive, inlineEdits, getAllDocumentSpans]);

  const handleFilesSelected = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    spansCacheRef.current.clear();
    linksCacheRef.current.clear();
    setFile(f);
    setPageNumber(1);
    setElements([]);
    setInlineEdits([]);
    setExistingLinkEdits([]);
    setHistory([]);
    setRedoStack([]);
    setSelectedId(null);
    setSelectedLinkId(null);
    setEditingSpan(null);
    setReplaceNotice(null);
    setMatches([]);
    setActiveMatchIdx(0);
    try {
      const fields = await readExistingAcroFormFields(f);
      setAcroFields(fields);
      const initial: Record<string, string | boolean> = {};
      for (const fld of fields) {
        initial[fld.name] = fld.type === 'checkbox' ? Boolean(fld.checked) : fld.defaultValue || '';
      }
      setFormValues(initial);
    } catch {
      setAcroFields([]);
      setFormValues({});
    }
  };

  const commitState = (
    nextElements: PdfEditorOverlayElement[],
    nextEdits: PdfInlineTextEdit[],
    nextLinkEdits: PdfExistingLinkEdit[] = existingLinkEdits
  ) => {
    setHistory((h) => [
      ...h.slice(-29),
      { elements, edits: inlineEdits, linkEdits: existingLinkEdits },
    ]);
    setRedoStack([]);
    setElements(nextElements);
    setInlineEdits(nextEdits);
    setExistingLinkEdits(nextLinkEdits);
  };

  const undo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setRedoStack((r) => [
      { elements, edits: inlineEdits, linkEdits: existingLinkEdits },
      ...r,
    ]);
    setHistory((h) => h.slice(0, -1));
    setElements(prev.elements);
    setInlineEdits(prev.edits);
    setExistingLinkEdits(prev.linkEdits);
  };

  const redo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[0];
    setHistory((h) => [
      ...h,
      { elements, edits: inlineEdits, linkEdits: existingLinkEdits },
    ]);
    setRedoStack((r) => r.slice(1));
    setElements(next.elements);
    setInlineEdits(next.edits);
    setExistingLinkEdits(next.linkEdits);
  };

  const proportionalPx = useCallback(
    (ptSize: number) => Math.max(8, (ptSize / Math.max(1, pageHeightPts)) * canvasDisplayHeight),
    [pageHeightPts, canvasDisplayHeight]
  );

  const openInlineSpanEditor = (sp: PdfTextSpan) => {
    const existingPatch = inlineEdits.find((e) => e.id === sp.id);
    setSelectedId(null);
    setSelectedLinkId(null);
    setSampledBgColor(sp.bgColor || '#ffffff');
    setEditingSpan(existingPatch ? { ...existingPatch } : buildEditFromSpan(sp, pageNumber));
  };

  const commitInlineEdit = (editToSave: PdfInlineTextEdit) => {
    const next = [...inlineEdits.filter((x) => x.id !== editToSave.id), editToSave];
    commitState(elements, next, existingLinkEdits);
    setEditingSpan(null);
  };

  const revertInlineEdit = (editId: string) => {
    commitState(
      elements,
      inlineEdits.filter((x) => x.id !== editId),
      existingLinkEdits
    );
    setEditingSpan(null);
  };

  const selectExistingLink = (link: PdfExistingLink) => {
    const existingEdit = existingLinkEdits.find((e) => e.id === link.id);
    setEditingSpan(null);
    setSelectedId(null);
    setSelectedLinkId(link.id);
    setDraftLinkUrl(existingEdit ? existingEdit.url : link.url || '');
  };

  const saveExistingLinkEdit = (link: PdfExistingLink, nextUrl: string, deleted = false) => {
    const patch: PdfExistingLinkEdit = {
      id: link.id,
      pageNumber: link.pageNumber,
      originalRect: link.originalRect,
      url: nextUrl,
      deleted,
    };
    const next = [...existingLinkEdits.filter((e) => e.id !== link.id), patch];
    commitState(elements, inlineEdits, next);
  };

  const restoreExistingLink = (linkId: string) => {
    const next = existingLinkEdits.filter((e) => e.id !== linkId);
    commitState(elements, inlineEdits, next);
    const base = pageLinks.find((l) => l.id === linkId);
    if (base) setDraftLinkUrl(base.url || '');
  };

  const addOverlayAt = (nx: number, ny: number) => {
    if (activeTool === 'edit-text') return;
    const id = `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const isText = activeTool === 'text';
    const isLink = activeTool === 'link';
    const isRedact = activeTool === 'redact';
    const isWhiteout = activeTool === 'whiteout';

    const el: PdfEditorOverlayElement = {
      id,
      pageNumber,
      kind: activeTool,
      x: Math.max(0.02, Math.min(0.75, nx)),
      y: Math.max(0.02, Math.min(0.85, ny)),
      width: isText || isLink ? 0.28 : 0.2,
      height:
        isText || isLink ? 0.045 : activeTool === 'line' || activeTool === 'arrow' ? 0.03 : 0.07,
      text: isText ? 'New text' : isLink ? 'Click link' : undefined,
      linkUrl: isLink ? linkUrlInput || 'https://example.com' : undefined,
      fontSize,
      fontFamily,
      color: isLink ? '#2563eb' : drawColor,
      fillColor: isRedact ? '#000000' : isWhiteout ? '#ffffff' : undefined,
      strokeWidth: 2.5,
      opacity: 1,
    };
    commitState([...elements, el], inlineEdits, existingLinkEdits);
    setSelectedLinkId(null);
    setEditingSpan(null);
    setSelectedId(id);
  };

  const jumpToMatch = (idx: number) => {
    if (matches.length === 0) return;
    const normalized = ((idx % matches.length) + matches.length) % matches.length;
    setActiveMatchIdx(normalized);
    const target = matches[normalized];
    if (target.pageNumber !== pageNumber) {
      setPageNumber(target.pageNumber);
    }
  };

  const handleReplaceCurrent = () => {
    const q = findText.trim();
    if (!q || matches.length === 0) return;
    const target = matches[Math.min(activeMatchIdx, matches.length - 1)];
    if (!target) return;

    const existing = inlineEdits.find((e) => e.id === target.span.id);
    const baseEdit = existing ? { ...existing } : buildEditFromSpan(target.span, target.pageNumber);
    const updatedText = replaceTextOccurrences(
      baseEdit.newText,
      q,
      replaceText,
      caseSensitive
    );
    const nextEdit: PdfInlineTextEdit = { ...baseEdit, newText: updatedText };
    const merged = [...inlineEdits.filter((e) => e.id !== nextEdit.id), nextEdit];
    commitState(elements, merged, existingLinkEdits);
    if (target.pageNumber !== pageNumber) {
      setPageNumber(target.pageNumber);
    }
    setReplaceNotice(`Replaced match on page ${target.pageNumber}.`);
  };

  const handleFindAndReplaceAll = async () => {
    const q = findText.trim();
    if (!file || !q) return;
    const allMap = await getAllDocumentSpans(file);
    const newEdits: PdfInlineTextEdit[] = [];

    const sortedPages = Array.from(allMap.keys()).sort((a, b) => a - b);
    for (const p of sortedPages) {
      const spans = allMap.get(p) || [];
      for (const sp of spans) {
        const existing = inlineEdits.find((e) => e.id === sp.id);
        const sourceText = existing ? existing.newText : sp.text;
        if (spanMatchesQuery(sourceText, q, caseSensitive)) {
          const base = existing ? { ...existing } : buildEditFromSpan(sp, p);
          newEdits.push({
            ...base,
            newText: replaceTextOccurrences(sourceText, q, replaceText, caseSensitive),
          });
        }
      }
    }

    if (newEdits.length > 0) {
      const merged = [
        ...inlineEdits.filter((e) => !newEdits.some((n) => n.id === e.id)),
        ...newEdits,
      ];
      commitState(elements, merged, existingLinkEdits);
      setReplaceNotice(`Replaced "${q}" across ${newEdits.length} span(s).`);
    } else {
      setReplaceNotice(`No matches found for "${q}".`);
    }
  };

  const handleImageAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const imgFile = e.target.files?.[0];
    if (!imgFile) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const id = `img-${Date.now()}`;
        commitState(
          [
            ...elements,
            {
              id,
              pageNumber,
              kind: 'image',
              x: 0.2,
              y: 0.2,
              width: 0.25,
              height: 0.16,
              imageDataUrl: reader.result,
            },
          ],
          inlineEdits,
          existingLinkEdits
        );
        setSelectedId(id);
        setSelectedLinkId(null);
        setEditingSpan(null);
      }
    };
    reader.readAsDataURL(imgFile);
    e.target.value = '';
  };

  const pageElements = elements.filter((el) => el.pageNumber === pageNumber);
  const pageInlineEdits = inlineEdits.filter((ed) => ed.pageNumber === pageNumber);
  const selectedEl = elements.find((el) => el.id === selectedId) || null;
  const selectedLink = pageLinks.find((l) => l.id === selectedLinkId) || null;
  const selectedLinkEdit = selectedLink
    ? existingLinkEdits.find((e) => e.id === selectedLink.id) || null
    : null;
  const pageFields = acroFields.filter((f) => f.pageNumber === pageNumber);

  const activeMatchSpanId = useMemo(
    () => (matches[activeMatchIdx]?.pageNumber === pageNumber ? matches[activeMatchIdx].span.id : null),
    [matches, activeMatchIdx, pageNumber]
  );

  const pageMatchSpanIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of matches) {
      if (m.pageNumber === pageNumber) set.add(m.span.id);
    }
    return set;
  }, [matches, pageNumber]);

  return (
    <PdfToolShell
      title="Edit PDF"
      description="Sejda-style WYSIWYG inline editing of existing PDF text, Find & Replace, editable hyperlinks, whiteout, shapes, images, and AcroForm filling."
      currentHref="/tools/pdf/edit"
      selectedFiles={file ? [file] : []}
      onFilesSelected={handleFilesSelected}
      submitLabel="Save Edited PDF"
      onRun={(onProgress) =>
        applyEditsAndSignaturesToPdf(
          file!,
          elements,
          formValues,
          onProgress,
          inlineEdits,
          existingLinkEdits
        )
      }
    >
      {file && (
        <div className="space-y-4">
          {renderError && (
            <div className="p-3 rounded-xl bg-error-bg border border-error text-error text-xs font-medium">
              {renderError}
            </div>
          )}
          {/* Primary Toolbar */}
          <div className="p-3 rounded-2xl border border-line bg-surface flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { kind: 'edit-text' as const, label: 'Edit Existing Text', Icon: MousePointerClick },
                { kind: 'text' as const, label: 'Add Text', Icon: Type },
                { kind: 'whiteout' as const, label: 'Whiteout', Icon: Eraser },
                { kind: 'redact' as const, label: 'Blackout', Icon: Square },
                { kind: 'link' as const, label: 'Link', Icon: Link2 },
                { kind: 'rect' as const, label: 'Box', Icon: Square },
                { kind: 'ellipse' as const, label: 'Circle', Icon: Circle },
                { kind: 'line' as const, label: 'Line', Icon: Minus },
                { kind: 'arrow' as const, label: 'Arrow', Icon: ArrowRight },
              ].map(({ kind, label, Icon }) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => {
                    setActiveTool(kind);
                    if (kind !== 'edit-text') setEditingSpan(null);
                  }}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border ${
                    activeTool === kind
                      ? 'bg-brand text-white border-brand'
                      : 'bg-surface-elevated text-content border-line hover:bg-surface-muted'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}

              <label className="px-2.5 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border border-line bg-surface-elevated text-content cursor-pointer hover:bg-surface-muted">
                <ImageIcon className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Image</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  className="sr-only"
                  onChange={handleImageAdd}
                />
              </label>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value as PdfStandardFontChoice)}
                className="px-2 py-1 rounded-lg border border-line bg-surface-elevated text-xs text-content"
                aria-label="Font family"
              >
                <option value="helvetica">Helvetica / Sans</option>
                <option value="times">Times / Serif</option>
                <option value="courier">Courier / Mono</option>
              </select>
              <input
                type="color"
                value={drawColor}
                onChange={(e) => setDrawColor(e.target.value)}
                aria-label="Color"
                className="w-8 h-8 rounded-lg border border-line cursor-pointer"
              />
              <button
                type="button"
                onClick={() => setShowEditHighlights((v) => !v)}
                aria-pressed={showEditHighlights}
                title="Highlight edited regions"
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 ${
                  showEditHighlights
                    ? 'bg-brand text-white border-brand'
                    : 'bg-surface-elevated text-content-secondary border-line hover:text-content'
                }`}
              >
                {showEditHighlights ? (
                  <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>Show edits</span>
              </button>

              <button
                type="button"
                disabled={history.length === 0}
                onClick={undo}
                aria-label="Undo"
                className="p-2 rounded-lg border border-line bg-surface-elevated disabled:opacity-40"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={redoStack.length === 0}
                onClick={redo}
                aria-label="Redo"
                className="p-2 rounded-lg border border-line bg-surface-elevated disabled:opacity-40"
              >
                <Redo2 className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-1 ml-1">
                <button
                  type="button"
                  disabled={pageNumber <= 1}
                  onClick={() => {
                    setEditingSpan(null);
                    setSelectedLinkId(null);
                    setPageNumber((p) => Math.max(1, p - 1));
                  }}
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
                  onClick={() => {
                    setEditingSpan(null);
                    setSelectedLinkId(null);
                    setPageNumber((p) => Math.min(numPages, p + 1));
                  }}
                  className="p-1.5 rounded-lg border border-line bg-surface-elevated disabled:opacity-40"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Sejda-style Find & Replace Bar */}
          <div className="p-3 rounded-2xl border border-line bg-surface flex flex-wrap items-center gap-2">
            <SearchCode className="w-4 h-4 text-content-secondary shrink-0" aria-hidden="true" />
            <input
              type="text"
              placeholder="Find text across document…"
              value={findText}
              onChange={(e) => {
                setFindText(e.target.value);
                setReplaceNotice(null);
              }}
              className="px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content w-44"
            />
            <button
              type="button"
              onClick={() => setCaseSensitive((v) => !v)}
              aria-pressed={caseSensitive}
              title="Match case"
              className={`px-2 py-1.5 rounded-lg border text-xs font-mono font-bold ${
                caseSensitive
                  ? 'bg-brand text-white border-brand'
                  : 'bg-surface-elevated text-content-secondary border-line hover:text-content'
              }`}
            >
              Aa
            </button>
            <input
              type="text"
              placeholder="Replace with…"
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content w-44"
            />

            {findText.trim() && (
              <div className="flex items-center gap-1 text-xs font-mono text-content-secondary px-1">
                <span>
                  {isSearching
                    ? 'Scanning…'
                    : matches.length > 0
                    ? `${activeMatchIdx + 1}/${matches.length}`
                    : '0 matches'}
                </span>
                <button
                  type="button"
                  disabled={matches.length === 0}
                  onClick={() => jumpToMatch(activeMatchIdx - 1)}
                  aria-label="Previous match"
                  className="p-1 rounded border border-line bg-surface-elevated disabled:opacity-40"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={matches.length === 0}
                  onClick={() => jumpToMatch(activeMatchIdx + 1)}
                  aria-label="Next match"
                  className="p-1 rounded border border-line bg-surface-elevated disabled:opacity-40"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <button
              type="button"
              disabled={matches.length === 0}
              onClick={handleReplaceCurrent}
              className="px-3 py-1.5 rounded-xl border border-line bg-surface-elevated hover:bg-surface-muted text-xs font-semibold text-content disabled:opacity-40"
            >
              Replace current
            </button>
            <button
              type="button"
              disabled={!findText.trim()}
              onClick={handleFindAndReplaceAll}
              className="px-3.5 py-1.5 rounded-xl border border-line bg-surface-elevated hover:bg-surface-muted text-xs font-semibold text-content disabled:opacity-40"
            >
              Replace all
            </button>
            {replaceNotice && <span className="text-xs text-brand font-medium">{replaceNotice}</span>}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
            <div className="lg:col-span-3 p-4 rounded-2xl border border-line bg-surface-elevated overflow-auto flex justify-center">
              <div
                className={`relative inline-block shadow-lg bg-white select-none ${
                  activeTool === 'edit-text' ? 'cursor-text' : 'cursor-crosshair'
                }`}
                onClick={(e) => {
                  if (e.target !== canvasRef.current) return;
                  if (activeTool === 'edit-text') {
                    setEditingSpan(null);
                    setSelectedLinkId(null);
                    return;
                  }
                  const rect = canvasRef.current!.getBoundingClientRect();
                  addOverlayAt(
                    (e.clientX - rect.left) / rect.width,
                    (e.clientY - rect.top) / rect.height
                  );
                }}
              >
                <canvas ref={canvasRef} className="block max-w-full h-auto" />

                {/* Existing Detected Text Spans (WYSIWYG Inline Editing) */}
                {activeTool === 'edit-text' &&
                  pageSpans.map((sp) => {
                    const isEditingThis = editingSpan?.id === sp.id;
                    const existingPatch = pageInlineEdits.find((e) => e.id === sp.id);
                    const isMatch = pageMatchSpanIds.has(sp.id);
                    const isActiveMatch = activeMatchSpanId === sp.id;

                    if (isEditingThis && editingSpan) {
                      const pxFs = proportionalPx(editingSpan.fontSize);
                      const weightVal = editingSpan.bold
                        ? editingSpan.fontWeight && editingSpan.fontWeight >= 600
                          ? editingSpan.fontWeight
                          : 700
                        : 400;
                      const topPos =
                        typeof editingSpan.baselineY === 'number'
                          ? `${(editingSpan.baselineY - (editingSpan.fontSize * (editingSpan.ascentRatio ?? 0.88)) / Math.max(1, pageHeightPts)) * 100}%`
                          : `${editingSpan.y * 100}%`;
                      return (
                        <div
                          key={sp.id}
                          style={{
                            left: `${editingSpan.x * 100}%`,
                            top: topPos,
                            minWidth: `${Math.max(4, editingSpan.width * 100)}%`,
                            height: `${editingSpan.height * 100}%`,
                          }}
                          className="absolute z-30"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="text"
                            autoFocus
                            value={editingSpan.newText}
                            onChange={(e) =>
                              setEditingSpan({ ...editingSpan, newText: e.target.value })
                            }
                            onBlur={(e) => {
                              // Keep open if clicking the floating action bar buttons
                              const nextFocus = e.relatedTarget as HTMLElement | null;
                              if (nextFocus && nextFocus.closest('[data-inline-toolbar]')) return;
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitInlineEdit(editingSpan);
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setEditingSpan(null);
                              }
                            }}
                            style={{
                              fontFamily: cssFontForEdit(
                                editingSpan.fontFamily,
                                editingSpan.modernSlug
                              ),
                              fontSize: `${pxFs}px`,
                              fontWeight: weightVal,
                              fontStyle: editingSpan.italic ? 'italic' : 'normal',
                              color: editingSpan.color,
                              backgroundColor: editingSpan.bgColor || '#ffffff',
                              ...(editingSpan.bgSliceDataUrl
                                ? {
                                    backgroundImage: `url("${editingSpan.bgSliceDataUrl}")`,
                                    backgroundSize: '100% 100%',
                                    backgroundRepeat: 'no-repeat',
                                  }
                                : {}),
                              lineHeight: 1,
                              padding: 0,
                              margin: 0,
                            }}
                            className="w-full h-full border-0 outline-1 outline-dashed outline-brand bg-transparent"
                          />
                          {/* Compact inline quick-action bar */}
                          <div
                            data-inline-toolbar="true"
                            className="absolute left-0 top-full mt-1 z-40 flex items-center gap-1 px-1.5 py-1 rounded-lg border border-line bg-surface shadow-lg text-xs whitespace-nowrap"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setEditingSpan({
                                  ...editingSpan,
                                  bold: !editingSpan.bold,
                                  fontWeight: !editingSpan.bold ? 700 : 400,
                                })
                              }
                              aria-label="Toggle bold"
                              className={`p-1 rounded ${
                                editingSpan.bold ? 'bg-brand text-white' : 'hover:bg-surface-muted'
                              }`}
                            >
                              <Bold className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setEditingSpan({ ...editingSpan, italic: !editingSpan.italic })
                              }
                              aria-label="Toggle italic"
                              className={`p-1 rounded ${
                                editingSpan.italic
                                  ? 'bg-brand text-white'
                                  : 'hover:bg-surface-muted'
                              }`}
                            >
                              <Italic className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => commitInlineEdit(editingSpan)}
                              aria-label="Apply edit"
                              className="p-1 rounded bg-brand text-white hover:opacity-90"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingSpan(null)}
                              aria-label="Cancel edit"
                              className="p-1 rounded hover:bg-surface-muted text-content-secondary"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    }

                    const activeEdit = existingPatch;
                    const pxFs = activeEdit
                      ? proportionalPx(activeEdit.fontSize)
                      : proportionalPx(sp.fontSize);
                    const committedWeight = activeEdit
                      ? activeEdit.bold
                        ? activeEdit.fontWeight && activeEdit.fontWeight >= 600
                          ? activeEdit.fontWeight
                          : 700
                        : 400
                      : 400;
                    const committedTop =
                      activeEdit && typeof activeEdit.baselineY === 'number'
                        ? `${(activeEdit.baselineY - (activeEdit.fontSize * (activeEdit.ascentRatio ?? 0.88)) / Math.max(1, pageHeightPts)) * 100}%`
                        : `${sp.y * 100}%`;

                    return (
                      <button
                        key={sp.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openInlineSpanEditor(sp);
                        }}
                        style={{
                          left: `${sp.x * 100}%`,
                          top: activeEdit ? committedTop : `${sp.y * 100}%`,
                          minWidth: `${sp.width * 100}%`,
                          width: activeEdit ? 'max-content' : `${sp.width * 100}%`,
                          height: `${sp.height * 100}%`,
                          padding: 0,
                          margin: 0,
                          border: 'none',
                          boxShadow: 'none',
                          ...(activeEdit
                            ? {
                                backgroundColor: activeEdit.bgColor || '#ffffff',
                                ...(activeEdit.bgSliceDataUrl
                                  ? {
                                      backgroundImage: `url("${activeEdit.bgSliceDataUrl}")`,
                                      backgroundSize: '100% 100%',
                                      backgroundRepeat: 'no-repeat',
                                    }
                                  : {}),
                                color: activeEdit.color,
                                fontFamily: cssFontForEdit(
                                  activeEdit.fontFamily,
                                  activeEdit.modernSlug
                                ),
                                fontSize: `${pxFs}px`,
                                fontWeight: committedWeight,
                                fontStyle: activeEdit.italic ? 'italic' : 'normal',
                                lineHeight: 1,
                              }
                            : {}),
                        }}
                        className={`absolute text-left leading-none flex items-center ${
                          activeEdit
                            ? `whitespace-nowrap ${
                                showEditHighlights
                                  ? 'outline-1 outline-dashed outline-brand/85'
                                  : 'hover:outline-1 hover:outline-dashed hover:outline-brand/60'
                              }`
                            : isActiveMatch
                            ? 'bg-amber-400/30 ring-2 ring-amber-500'
                            : isMatch
                            ? 'bg-amber-300/20 outline-1 outline-amber-400/80'
                            : 'hover:outline-1 hover:outline-dashed hover:outline-brand/60 hover:bg-brand/5'
                        }`}
                        title={`Edit: ${sp.text} (${sp.fontName || sp.mappedFamily}, ${Math.round(sp.fontSize)}pt)`}
                      >
                        {activeEdit ? activeEdit.newText : ''}
                      </button>
                    );
                  })}

                {/* Show Inline Edits cleanly even when switching to another tool */}
                {activeTool !== 'edit-text' &&
                  pageInlineEdits.map((ed) => (
                    <div
                      key={ed.id}
                      style={{
                        left: `${ed.x * 100}%`,
                        top:
                          typeof ed.baselineY === 'number'
                            ? `${(ed.baselineY - (ed.fontSize * (ed.ascentRatio ?? 0.88)) / Math.max(1, pageHeightPts)) * 100}%`
                            : `${ed.y * 100}%`,
                        minWidth: `${ed.width * 100}%`,
                        width: 'max-content',
                        height: `${ed.height * 100}%`,
                        backgroundColor: ed.bgColor || '#ffffff',
                        ...(ed.bgSliceDataUrl
                          ? {
                              backgroundImage: `url("${ed.bgSliceDataUrl}")`,
                              backgroundSize: '100% 100%',
                              backgroundRepeat: 'no-repeat',
                            }
                          : {}),
                        color: ed.color,
                        fontFamily: cssFontForEdit(ed.fontFamily, ed.modernSlug),
                        fontSize: `${proportionalPx(ed.fontSize)}px`,
                        fontWeight: ed.bold ? ed.fontWeight || 700 : 400,
                        fontStyle: ed.italic ? 'italic' : 'normal',
                        lineHeight: 1,
                        padding: 0,
                        border: 'none',
                      }}
                      className={`absolute whitespace-nowrap pointer-events-none flex items-center ${
                        showEditHighlights ? 'outline-1 outline-dashed outline-brand/70' : ''
                      }`}
                    >
                      {ed.newText}
                    </div>
                  ))}

                {/* Existing Detected /Link Annotations */}
                {pageLinks.map((link) => {
                  const linkEdit = existingLinkEdits.find((e) => e.id === link.id);
                  const isSelected = selectedLinkId === link.id;
                  const isDeleted = Boolean(linkEdit?.deleted);
                  const isModified = Boolean(linkEdit && !linkEdit.deleted && linkEdit.url !== link.url);

                  return (
                    <div
                      key={link.id}
                      style={{
                        left: `${link.x * 100}%`,
                        top: `${link.y * 100}%`,
                        width: `${Math.max(0.02, link.width) * 100}%`,
                        height: `${Math.max(0.015, link.height) * 100}%`,
                      }}
                      className={`absolute pointer-events-none border border-dashed rounded-sm ${
                        isSelected
                          ? 'ring-2 ring-brand border-brand bg-brand/15 z-20'
                          : isDeleted
                          ? 'border-red-500/80 bg-red-500/15 z-10'
                          : isModified
                          ? 'border-emerald-500/80 bg-emerald-500/10 z-10'
                          : 'border-blue-500/60 bg-blue-500/5 z-10'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          selectExistingLink(link);
                        }}
                        title={
                          isDeleted
                            ? `Deleted link (was: ${link.url || link.dest || 'internal'})`
                            : `Edit hyperlink: ${linkEdit?.url || link.url || link.dest || 'internal'}`
                        }
                        className={`pointer-events-auto absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full flex items-center justify-center shadow text-[10px] border ${
                          isDeleted
                            ? 'bg-red-600 text-white border-red-700'
                            : isModified
                            ? 'bg-emerald-600 text-white border-emerald-700'
                            : 'bg-blue-600 text-white border-blue-700'
                        }`}
                      >
                        <Link2 className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  );
                })}

                {/* Existing AcroForm inputs */}
                {pageFields.map((fld) => (
                  <div
                    key={fld.id}
                    style={{
                      left: `${fld.x * 100}%`,
                      top: `${fld.y * 100}%`,
                      width: `${fld.width * 100}%`,
                      height: `${fld.height * 100}%`,
                    }}
                    className="absolute z-10"
                  >
                    {fld.type === 'checkbox' ? (
                      <input
                        type="checkbox"
                        checked={Boolean(formValues[fld.name])}
                        onChange={(e) =>
                          setFormValues((v) => ({ ...v, [fld.name]: e.target.checked }))
                        }
                        className="w-full h-full accent-brand"
                        aria-label={fld.name}
                      />
                    ) : (
                      <input
                        type="text"
                        value={String(formValues[fld.name] || '')}
                        onChange={(e) =>
                          setFormValues((v) => ({ ...v, [fld.name]: e.target.value }))
                        }
                        className="w-full h-full px-1 text-xs bg-blue-50/80 border border-blue-400 text-black rounded"
                        aria-label={fld.name}
                      />
                    )}
                  </div>
                ))}

                {/* Placed Overlay Elements */}
                {pageElements.map((el) => (
                  <div
                    key={el.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingSpan(null);
                      setSelectedLinkId(null);
                      setSelectedId(el.id);
                    }}
                    style={{
                      left: `${el.x * 100}%`,
                      top: `${el.y * 100}%`,
                      width: `${el.width * 100}%`,
                      height: `${el.height * 100}%`,
                      borderColor: el.id === selectedId ? '#5562F0' : el.color || '#5562F0',
                    }}
                    className={`absolute z-20 flex items-center justify-center cursor-pointer ${
                      el.id === selectedId ? 'ring-2 ring-brand' : ''
                    } ${el.kind === 'redact' ? 'bg-black' : ''} ${
                      el.kind === 'whiteout' ? 'bg-white border border-dashed border-gray-400' : ''
                    } ${el.kind === 'rect' ? 'border-2' : ''} ${
                      el.kind === 'ellipse' ? 'border-2 rounded-full' : ''
                    }`}
                  >
                    {(el.kind === 'text' || el.kind === 'link') && (
                      <span
                        style={{
                          color: el.color || '#000',
                          fontSize: `${proportionalPx(el.fontSize || 13)}px`,
                          fontFamily: cssFontForEdit(el.fontFamily || 'helvetica'),
                        }}
                        className={`w-full h-full px-1 leading-tight overflow-hidden bg-white/85 border border-dashed border-black/20 ${
                          el.kind === 'link' ? 'underline text-blue-600' : ''
                        }`}
                      >
                        {el.text}
                      </span>
                    )}
                    {el.kind === 'image' && el.imageDataUrl && (
                      <img
                        src={el.imageDataUrl}
                        alt="Placed element"
                        className="w-full h-full object-contain"
                      />
                    )}
                    {(el.kind === 'line' || el.kind === 'arrow') && (
                      <div
                        style={{ backgroundColor: el.color || '#5562F0' }}
                        className="w-full h-0.5"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Inspector */}
            <aside className="p-4 rounded-2xl border border-line bg-surface space-y-4">
              {editingSpan ? (
                <div className="space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-content">Edit Existing PDF Text</span>
                    <button
                      type="button"
                      onClick={() => revertInlineEdit(editingSpan.id)}
                      className="text-[11px] text-content-secondary hover:text-error inline-flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Revert</span>
                    </button>
                  </div>
                  <div className="text-[11px] text-content-secondary truncate">
                    Original: &ldquo;{editingSpan.originalText}&rdquo;
                  </div>
                  {editingSpan.fontName && (
                    <div className="px-2 py-1 rounded-md bg-surface-elevated border border-line text-[11px] text-content-secondary flex items-center justify-between gap-2">
                      <span className="truncate">
                        Detected: <strong className="text-content">{editingSpan.fontName}</strong>
                      </span>
                      <span className="font-mono shrink-0">{Math.round(editingSpan.fontSize * 10) / 10}pt</span>
                    </div>
                  )}
                  <label className="flex items-center gap-2 text-[11px] text-content-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingSpan.matchOriginalWidth !== false}
                      onChange={(e) =>
                        setEditingSpan({ ...editingSpan, matchOriginalWidth: e.target.checked })
                      }
                      className="accent-brand"
                    />
                    <span>Match original horizontal width (Tz scaling)</span>
                  </label>
                  <input
                    type="text"
                    value={editingSpan.newText}
                    onChange={(e) =>
                      setEditingSpan({ ...editingSpan, newText: e.target.value })
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg border border-line bg-surface-elevated text-content"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={editingSpan.fontFamily}
                      onChange={(e) =>
                        setEditingSpan({
                          ...editingSpan,
                          fontFamily: e.target.value as PdfStandardFontChoice,
                        })
                      }
                      aria-label="Span font family"
                      className="px-2 py-1 rounded border border-line bg-surface-elevated text-content"
                    >
                      <option value="helvetica">Helvetica</option>
                      <option value="times">Times</option>
                      <option value="courier">Courier</option>
                    </select>
                    <input
                      type="number"
                      min={6}
                      max={96}
                      step={0.5}
                      value={editingSpan.fontSize}
                      onChange={(e) =>
                        setEditingSpan({
                          ...editingSpan,
                          fontSize: Math.max(6, Number(e.target.value) || 12),
                        })
                      }
                      aria-label="Span font size"
                      className="px-2 py-1 rounded border border-line bg-surface-elevated text-content"
                    />
                  </div>

                  {/* Bold / Italic toggles */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setEditingSpan({ ...editingSpan, bold: !editingSpan.bold })
                      }
                      className={`flex-1 py-1.5 rounded-lg border inline-flex items-center justify-center gap-1 font-semibold ${
                        editingSpan.bold
                          ? 'bg-brand text-white border-brand'
                          : 'bg-surface-elevated text-content border-line'
                      }`}
                    >
                      <Bold className="w-3.5 h-3.5" />
                      <span>Bold</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setEditingSpan({ ...editingSpan, italic: !editingSpan.italic })
                      }
                      className={`flex-1 py-1.5 rounded-lg border inline-flex items-center justify-center gap-1 font-semibold ${
                        editingSpan.italic
                          ? 'bg-brand text-white border-brand'
                          : 'bg-surface-elevated text-content border-line'
                      }`}
                    >
                      <Italic className="w-3.5 h-3.5" />
                      <span>Italic</span>
                    </button>
                  </div>

                  {/* Text Color + Whiteout Backdrop Color */}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1 text-content-secondary">
                      <span>Text color</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={editingSpan.color}
                          onChange={(e) =>
                            setEditingSpan({ ...editingSpan, color: e.target.value })
                          }
                          className="w-8 h-7 rounded border border-line cursor-pointer"
                        />
                        <span className="font-mono text-[10px]">{editingSpan.color}</span>
                      </div>
                    </label>
                    <label className="space-y-1 text-content-secondary">
                      <span className="flex items-center justify-between">
                        <span>Backdrop</span>
                        <button
                          type="button"
                          onClick={() =>
                            setEditingSpan({ ...editingSpan, bgColor: sampledBgColor })
                          }
                          className="text-[10px] text-brand hover:underline"
                        >
                          Sampled
                        </button>
                      </span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={editingSpan.bgColor || '#ffffff'}
                          onChange={(e) =>
                            setEditingSpan({ ...editingSpan, bgColor: e.target.value })
                          }
                          className="w-8 h-7 rounded border border-line cursor-pointer"
                        />
                        <span className="font-mono text-[10px]">
                          {editingSpan.bgColor || '#ffffff'}
                        </span>
                      </div>
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={() => commitInlineEdit(editingSpan)}
                    className="w-full py-1.5 rounded-lg bg-brand text-white font-semibold"
                  >
                    Apply text edit
                  </button>
                </div>
              ) : selectedLink ? (
                <div className="space-y-3 text-xs">
                  <div className="flex items-center justify-between font-bold text-content">
                    <span className="inline-flex items-center gap-1.5">
                      <ExternalLink className="w-3.5 h-3.5 text-brand" />
                      <span>Existing Hyperlink</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedLinkId(null)}
                      className="text-content-secondary hover:text-content"
                    >
                      Close
                    </button>
                  </div>

                  {selectedLink.dest && !selectedLink.url && (
                    <div className="p-2 rounded-lg bg-surface-elevated border border-line text-[11px] text-content-secondary">
                      Internal destination: <span className="font-mono">{selectedLink.dest}</span>
                    </div>
                  )}

                  <label className="block space-y-1 text-content-secondary">
                    <span>Destination URL</span>
                    <input
                      type="url"
                      placeholder="https://example.com"
                      value={draftLinkUrl}
                      onChange={(e) => setDraftLinkUrl(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-line bg-surface-elevated text-content"
                    />
                  </label>

                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => saveExistingLinkEdit(selectedLink, draftLinkUrl, false)}
                      className="w-full py-1.5 rounded-lg bg-brand text-white font-semibold"
                    >
                      Update link URL
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        saveExistingLinkEdit(
                          selectedLink,
                          draftLinkUrl || selectedLink.url,
                          !selectedLinkEdit?.deleted
                        )
                      }
                      className={`w-full py-1.5 rounded-lg border font-semibold inline-flex items-center justify-center gap-1.5 ${
                        selectedLinkEdit?.deleted
                          ? 'border-brand text-brand bg-surface-elevated'
                          : 'border-error/50 text-error bg-surface-elevated hover:bg-error/10'
                      }`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>
                        {selectedLinkEdit?.deleted ? 'Restore hyperlink' : 'Delete hyperlink'}
                      </span>
                    </button>

                    {selectedLinkEdit && (
                      <button
                        type="button"
                        onClick={() => restoreExistingLink(selectedLink.id)}
                        className="text-[11px] text-content-secondary hover:text-content underline"
                      >
                        Reset to original link
                      </button>
                    )}
                  </div>
                </div>
              ) : selectedEl ? (
                <div className="space-y-3 text-xs">
                  <div className="flex items-center justify-between font-bold text-content">
                    <span>Selected: {selectedEl.kind}</span>
                    <button
                      type="button"
                      onClick={() => {
                        commitState(
                          elements.filter((e) => e.id !== selectedEl.id),
                          inlineEdits,
                          existingLinkEdits
                        );
                        setSelectedId(null);
                      }}
                      className="text-error inline-flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  </div>

                  {(selectedEl.kind === 'text' || selectedEl.kind === 'link') && (
                    <textarea
                      rows={2}
                      value={selectedEl.text || ''}
                      onChange={(e) =>
                        setElements((prev) =>
                          prev.map((item) =>
                            item.id === selectedEl.id ? { ...item, text: e.target.value } : item
                          )
                        )
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-line bg-surface-elevated text-content"
                    />
                  )}

                  {selectedEl.kind === 'link' && (
                    <input
                      type="url"
                      placeholder="https://..."
                      value={selectedEl.linkUrl || ''}
                      onChange={(e) => {
                        setLinkUrlInput(e.target.value);
                        setElements((prev) =>
                          prev.map((item) =>
                            item.id === selectedEl.id ? { ...item, linkUrl: e.target.value } : item
                          )
                        );
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-line bg-surface-elevated text-content"
                    />
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1 text-content-secondary">
                      <span>X (%)</span>
                      <input
                        type="number"
                        min={0}
                        max={95}
                        value={Math.round(selectedEl.x * 100)}
                        onChange={(e) =>
                          setElements((prev) =>
                            prev.map((item) =>
                              item.id === selectedEl.id
                                ? { ...item, x: Number(e.target.value) / 100 }
                                : item
                            )
                          )
                        }
                        className="w-full px-2 py-1 rounded border border-line bg-surface-elevated text-content"
                      />
                    </label>
                    <label className="space-y-1 text-content-secondary">
                      <span>Y (%)</span>
                      <input
                        type="number"
                        min={0}
                        max={95}
                        value={Math.round(selectedEl.y * 100)}
                        onChange={(e) =>
                          setElements((prev) =>
                            prev.map((item) =>
                              item.id === selectedEl.id
                                ? { ...item, y: Number(e.target.value) / 100 }
                                : item
                            )
                          )
                        }
                        className="w-full px-2 py-1 rounded border border-line bg-surface-elevated text-content"
                      />
                    </label>
                    <label className="space-y-1 text-content-secondary">
                      <span>Width (%)</span>
                      <input
                        type="number"
                        min={2}
                        max={95}
                        value={Math.round(selectedEl.width * 100)}
                        onChange={(e) =>
                          setElements((prev) =>
                            prev.map((item) =>
                              item.id === selectedEl.id
                                ? { ...item, width: Number(e.target.value) / 100 }
                                : item
                            )
                          )
                        }
                        className="w-full px-2 py-1 rounded border border-line bg-surface-elevated text-content"
                      />
                    </label>
                    <label className="space-y-1 text-content-secondary">
                      <span>Height (%)</span>
                      <input
                        type="number"
                        min={1}
                        max={95}
                        value={Math.round(selectedEl.height * 100)}
                        onChange={(e) =>
                          setElements((prev) =>
                            prev.map((item) =>
                              item.id === selectedEl.id
                                ? { ...item, height: Number(e.target.value) / 100 }
                                : item
                            )
                          )
                        }
                        className="w-full px-2 py-1 rounded border border-line bg-surface-elevated text-content"
                      />
                    </label>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 text-xs text-content-secondary">
                  <div className="font-bold text-content">
                    {activeTool === 'edit-text'
                      ? 'Hover & click any text on the PDF to edit it inline.'
                      : `Click anywhere on the page to place a ${activeTool}.`}
                  </div>
                  <p>
                    {inlineEdits.length} inline text edit(s) · {elements.length} overlay(s) ·{' '}
                    {existingLinkEdits.length} link edit(s)
                  </p>

                  {pageLinks.length > 0 && (
                    <div className="pt-2 border-t border-line space-y-1.5">
                      <div className="font-semibold text-content">
                        Detected Links on Page {pageNumber} ({pageLinks.length})
                      </div>
                      <div className="max-h-48 overflow-auto space-y-1">
                        {pageLinks.map((lnk) => {
                          const patch = existingLinkEdits.find((e) => e.id === lnk.id);
                          return (
                            <button
                              key={lnk.id}
                              type="button"
                              onClick={() => selectExistingLink(lnk)}
                              className={`w-full text-left px-2 py-1.5 rounded-lg border text-[11px] truncate flex items-center gap-1.5 ${
                                patch?.deleted
                                  ? 'border-red-500/40 text-red-500 line-through bg-surface-elevated'
                                  : 'border-line bg-surface-elevated hover:border-brand text-content'
                              }`}
                            >
                              <Link2 className="w-3 h-3 shrink-0 text-brand" />
                              <span className="truncate">
                                {patch ? patch.url || '(deleted)' : lnk.url || lnk.dest || 'Internal link'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </aside>
          </div>
        </div>
      )}
    </PdfToolShell>
  );
}
