'use client';

import React, { useEffect, useState } from 'react';
import JSZip from 'jszip';
import QRCode from 'qrcode';
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  Download,
  Upload,
  Trash2,
  ChevronDown,
  ChevronUp,
  Code2,
  FileSearch,
  Layers,
  QrCode,
} from 'lucide-react';
import PdfToolShell from './PdfToolShell';
import { formatBytes } from '@/lib/formatters';
import {
  addHeaderFooterToPdf,
  addPageNumbersToPdf,
  addWatermarkToPdf,
  compressPdfSmart,
  estimateCompressedSize,
  flattenPdf,
  getPdfMetadata,
  inspectHiddenFingerprints,
  inspectPdfDeep,
  protectPdfWithQpdf,
  removePdfAnnotations,
  removePdfMetadata,
  repairPdfMultiEngine,
  sanitizeFilenameStem,
  sanitizePdfDeep,
  setPdfMetadata,
  unlockPdfWithQpdf,
  verifyPdfSignaturesInBrowser,
  type GridPosition9,
  type PdfCompressMode,
  type PdfDeepInspectionResult,
  type PdfFingerprintAudit,
  type PdfMetadataValues,
  type PdfProcessResult,
  type PdfSignatureInfo,
  type PdfStandardFontChoice,
} from '@/lib/pdf';

const GRID_9_OPTIONS: Array<{ id: GridPosition9; label: string }> = [
  { id: 'top-left', label: 'TL' },
  { id: 'top-center', label: 'TC' },
  { id: 'top-right', label: 'TR' },
  { id: 'center-left', label: 'CL' },
  { id: 'center', label: 'C' },
  { id: 'center-right', label: 'CR' },
  { id: 'bottom-left', label: 'BL' },
  { id: 'bottom-center', label: 'BC' },
  { id: 'bottom-right', label: 'BR' },
];

export function PdfWatermarkTool() {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<'text' | 'image' | 'qr'>('text');
  const [text, setText] = useState('CONFIDENTIAL');
  const [qrText, setQrText] = useState('https://muxaro.com');
  const [qrPreviewUrl, setQrPreviewUrl] = useState<string>('');
  const [imageDataUrl, setImageDataUrl] = useState<string>('');
  const [fontFamily, setFontFamily] = useState<PdfStandardFontChoice>('helvetica');
  const [fontSize, setFontSize] = useState(44);
  const [opacity, setOpacity] = useState(0.25);
  const [rotation, setRotation] = useState(-45);
  const [color, setColor] = useState('#5562F0');
  const [layout, setLayout] = useState<GridPosition9>('center');
  const [layer, setLayer] = useState<'above' | 'behind'>('above');
  const [pageRange, setPageRange] = useState('');

  useEffect(() => {
    if (kind !== 'qr' || !qrText.trim()) {
      setQrPreviewUrl('');
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(qrText.trim(), {
      width: 140,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: color, light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setQrPreviewUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrPreviewUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [kind, qrText, color]);

  const handleImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      if (typeof r.result === 'string') setImageDataUrl(r.result);
    };
    r.readAsDataURL(f);
  };

  return (
    <PdfToolShell
      title="Watermark PDF"
      description="Text, image, or vector QR code watermarks with 9-point grid + tiled placement and above/behind content layering."
      currentHref="/tools/pdf/watermark"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => setFile(files[0] || null)}
      submitLabel="Apply Watermark"
      onRun={(onProgress) =>
        addWatermarkToPdf(
          file!,
          {
            kind,
            text,
            qrText,
            imageDataUrl,
            fontFamily,
            fontSize,
            opacity,
            rotation,
            color,
            layout,
            layer,
            pageRange,
          },
          onProgress
        )
      }
    >
      <div className="p-5 rounded-2xl border border-line bg-surface grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setKind('text')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border ${
                  kind === 'text' ? 'bg-brand text-white border-brand' : 'bg-surface-elevated border-line'
                }`}
              >
                Text watermark
              </button>
              <button
                type="button"
                onClick={() => setKind('image')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border ${
                  kind === 'image' ? 'bg-brand text-white border-brand' : 'bg-surface-elevated border-line'
                }`}
              >
                Image / Logo stamp
              </button>
              <button
                type="button"
                onClick={() => setKind('qr')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border inline-flex items-center gap-1.5 ${
                  kind === 'qr' ? 'bg-brand text-white border-brand' : 'bg-surface-elevated border-line'
                }`}
              >
                <QrCode className="w-3.5 h-3.5" aria-hidden="true" />
                <span>QR Code</span>
              </button>
            </div>

            <div className="inline-flex items-center gap-1 p-1 rounded-xl border border-line bg-surface-elevated text-xs">
              <Layers className="w-3.5 h-3.5 text-content-secondary ml-1.5" aria-hidden="true" />
              <button
                type="button"
                onClick={() => setLayer('above')}
                className={`px-2.5 py-1 rounded-lg font-semibold ${
                  layer === 'above' ? 'bg-brand text-white' : 'text-content-secondary hover:text-content'
                }`}
              >
                Above Content
              </button>
              <button
                type="button"
                onClick={() => setLayer('behind')}
                className={`px-2.5 py-1 rounded-lg font-semibold ${
                  layer === 'behind' ? 'bg-brand text-white' : 'text-content-secondary hover:text-content'
                }`}
              >
                Behind Content
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {kind === 'text' ? (
              <>
                <label className="text-xs text-content-secondary space-y-1">
                  <span>Watermark text</span>
                  <input
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
                  />
                </label>
                <label className="text-xs text-content-secondary space-y-1">
                  <span>Font</span>
                  <select
                    value={fontFamily}
                    onChange={(e) => setFontFamily(e.target.value as PdfStandardFontChoice)}
                    className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
                  >
                    <option value="helvetica">Helvetica</option>
                    <option value="times">Times Roman</option>
                    <option value="courier">Courier</option>
                  </select>
                </label>
              </>
            ) : kind === 'qr' ? (
              <div className="sm:col-span-2 flex flex-col sm:flex-row items-start sm:items-center gap-4 p-3 rounded-xl border border-line bg-surface-elevated">
                <label className="flex-1 w-full text-xs text-content-secondary space-y-1">
                  <span>QR Code URL or Payload</span>
                  <input
                    type="text"
                    placeholder="https://example.com or verification ID"
                    value={qrText}
                    onChange={(e) => setQrText(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-line bg-surface text-sm text-content"
                  />
                </label>
                {qrPreviewUrl && (
                  <img
                    src={qrPreviewUrl}
                    alt="QR stamp live preview"
                    className="w-20 h-20 rounded-lg border border-line bg-white p-1 shrink-0"
                  />
                )}
              </div>
            ) : (
              <label className="sm:col-span-2 px-4 py-3 rounded-xl border border-dashed border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-2 cursor-pointer">
                <Upload className="w-4 h-4" />
                <span>{imageDataUrl ? 'Logo image loaded (click to replace)' : 'Choose PNG / JPG watermark logo'}</span>
                <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={handleImagePick} />
              </label>
            )}

            <label className="text-xs text-content-secondary space-y-1">
              <span>Size ({fontSize}pt)</span>
              <input
                type="range"
                min={12}
                max={110}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="w-full"
              />
            </label>
            <label className="text-xs text-content-secondary space-y-1">
              <span>Opacity ({Math.round(opacity * 100)}%)</span>
              <input
                type="range"
                min={0.05}
                max={0.95}
                step={0.05}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                className="w-full"
              />
            </label>
            <label className="text-xs text-content-secondary space-y-1">
              <span>Rotation ({rotation}°)</span>
              <input
                type="range"
                min={-90}
                max={90}
                value={rotation}
                onChange={(e) => setRotation(Number(e.target.value))}
                className="w-full"
              />
            </label>
            <label className="text-xs text-content-secondary space-y-1">
              <span>Page range (optional)</span>
              <input
                type="text"
                placeholder="All pages (or 1-3, 5)"
                value={pageRange}
                onChange={(e) => setPageRange(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
              />
            </label>
            {(kind === 'text' || kind === 'qr') && (
              <label className="text-xs text-content-secondary space-y-1">
                <span>Color</span>
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-12 h-9 rounded-lg border border-line cursor-pointer block"
                />
              </label>
            )}
          </div>
        </div>

        {/* 9-Point Grid + Tiled */}
        <div className="space-y-3">
          <div className="text-xs font-bold text-content">9-Point Placement Grid</div>
          <div className="grid grid-cols-3 gap-2 max-w-[200px]">
            {GRID_9_OPTIONS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setLayout(g.id)}
                className={`h-10 rounded-lg border text-xs font-mono font-bold ${
                  layout === g.id
                    ? 'bg-brand text-white border-brand'
                    : 'bg-surface-elevated text-content-secondary border-line'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setLayout('tiled')}
            className={`w-full max-w-[200px] py-2 rounded-lg border text-xs font-semibold ${
              layout === 'tiled'
                ? 'bg-brand text-white border-brand'
                : 'bg-surface-elevated text-content-secondary border-line'
            }`}
          >
            Tiled Mosaic
          </button>
        </div>
      </div>
    </PdfToolShell>
  );
}

export function PdfPageNumbersTool() {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState('Page {n} of {total}');
  const [position, setPosition] = useState<
    'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right' | 'top-left'
  >('bottom-center');
  const [fontFamily, setFontFamily] = useState<PdfStandardFontChoice>('helvetica');
  const [fontSize, setFontSize] = useState(11);
  const [startNumber, setStartNumber] = useState(1);
  const [marginPt, setMarginPt] = useState(24);
  const [pageRange, setPageRange] = useState('');
  const [numberStyle, setNumberStyle] = useState<'arabic' | 'roman-upper' | 'roman-lower'>('arabic');
  const [facingPages, setFacingPages] = useState(false);
  const [firstPageIsCover, setFirstPageIsCover] = useState(false);
  const [autoExpandMargins, setAutoExpandMargins] = useState(false);
  const [color, setColor] = useState('#222226');

  return (
    <PdfToolShell
      title="Page numbers"
      description="6-corner position grid, Roman or Arabic numerals, facing-page duplex mirroring, cover skip, and auto-expanded margins."
      currentHref="/tools/pdf/page-numbers"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => setFile(files[0] || null)}
      submitLabel="Add Page Numbers"
      onRun={(onProgress, signal) =>
        addPageNumbersToPdf(
          file!,
          {
            format,
            position,
            fontSize,
            fontFamily,
            startNumber,
            marginPt,
            color,
            pageRange,
            numberStyle,
            facingPages,
            firstPageIsCover,
            autoExpandMargins,
          },
          onProgress,
          signal
        )
      }
    >
      <div className="p-5 rounded-2xl border border-line bg-surface grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="text-xs text-content-secondary space-y-1">
              <span>Template</span>
              <input
                type="text"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
              />
            </label>
            <label className="text-xs text-content-secondary space-y-1">
              <span>Number Style</span>
              <select
                value={numberStyle}
                onChange={(e) => setNumberStyle(e.target.value as 'arabic' | 'roman-upper' | 'roman-lower')}
                className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
              >
                <option value="arabic">1, 2, 3 (Arabic)</option>
                <option value="roman-upper">I, II, III (Roman Upper)</option>
                <option value="roman-lower">i, ii, iii (Roman Lower)</option>
              </select>
            </label>
            <label className="text-xs text-content-secondary space-y-1">
              <span>Font family</span>
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value as PdfStandardFontChoice)}
                className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
              >
                <option value="helvetica">Helvetica</option>
                <option value="times">Times Roman</option>
                <option value="courier">Courier</option>
              </select>
            </label>
            <label className="text-xs text-content-secondary space-y-1">
              <span>First number</span>
              <input
                type="number"
                min={1}
                value={startNumber}
                onChange={(e) => setStartNumber(Math.max(1, Number(e.target.value)))}
                className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
              />
            </label>
            <label className="text-xs text-content-secondary space-y-1">
              <span>Margin preset</span>
              <select
                value={marginPt}
                onChange={(e) => setMarginPt(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
              >
                <option value={14}>Small (14pt)</option>
                <option value={24}>Recommended (24pt)</option>
                <option value={38}>Big (38pt)</option>
              </select>
            </label>
            <label className="text-xs text-content-secondary space-y-1">
              <span>Font size (pt)</span>
              <input
                type="number"
                min={8}
                max={32}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
              />
            </label>
            <label className="text-xs text-content-secondary space-y-1">
              <span>Page range (optional)</span>
              <input
                type="text"
                placeholder="All pages (or 2-last)"
                value={pageRange}
                onChange={(e) => setPageRange(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
              />
            </label>
            <label className="text-xs text-content-secondary space-y-1">
              <span>Text color</span>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-12 h-9 rounded-lg border border-line cursor-pointer block"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-4 pt-1 text-xs text-content">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={facingPages}
                onChange={(e) => setFacingPages(e.target.checked)}
              />
              <span>Facing Pages (Mirror Left/Right)</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={firstPageIsCover}
                onChange={(e) => setFirstPageIsCover(e.target.checked)}
              />
              <span>First Page is Cover (Skip #1)</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoExpandMargins}
                onChange={(e) => setAutoExpandMargins(e.target.checked)}
              />
              <span>Auto-Expand Margins (+28pt safe band)</span>
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-bold text-content">Position Selector</div>
          <div className="grid grid-cols-3 gap-2 max-w-[220px]">
            {(
              [
                ['top-left', 'Top L'],
                ['top-center', 'Top C'],
                ['top-right', 'Top R'],
                ['bottom-left', 'Bot L'],
                ['bottom-center', 'Bot C'],
                ['bottom-right', 'Bot R'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPosition(id)}
                className={`h-11 rounded-lg border text-xs font-semibold ${
                  position === id
                    ? 'bg-brand text-white border-brand'
                    : 'bg-surface-elevated text-content-secondary border-line'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </PdfToolShell>
  );
}

/**
 * Sejda / Mapsoft Benchmark: 3-Column Header & Footer with dynamic variable & Bates chips
 */
export function PdfHeaderFooterTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [headerLeft, setHeaderLeft] = useState('');
  const [headerCenter, setHeaderCenter] = useState('{title}');
  const [headerRight, setHeaderRight] = useState('{date}');
  const [footerLeft, setFooterLeft] = useState('Confidential');
  const [footerCenter, setFooterCenter] = useState('');
  const [footerRight, setFooterRight] = useState('Page [PAGE_NO] of [TOTAL_PAGES]');
  const [fontFamily, setFontFamily] = useState<PdfStandardFontChoice>('helvetica');
  const [fontSize, setFontSize] = useState(10);
  const [color, setColor] = useState('#333338');
  const [marginPt, setMarginPt] = useState(22);
  const [skipFirstPage, setSkipFirstPage] = useState(false);
  const [increaseMargins, setIncreaseMargins] = useState(false);
  const [activeSlot, setActiveSlot] = useState<
    'headerLeft' | 'headerCenter' | 'headerRight' | 'footerLeft' | 'footerCenter' | 'footerRight'
  >('footerRight');

  const insertToken = (token: string) => {
    const append = (cur: string) => (cur && !cur.endsWith(' ') ? `${cur} ${token}` : `${cur}${token}`);
    if (activeSlot === 'headerLeft') setHeaderLeft(append);
    else if (activeSlot === 'headerCenter') setHeaderCenter(append);
    else if (activeSlot === 'headerRight') setHeaderRight(append);
    else if (activeSlot === 'footerLeft') setFooterLeft(append);
    else if (activeSlot === 'footerCenter') setFooterCenter(append);
    else setFooterRight(append);
  };

  return (
    <PdfToolShell
      title="Header & footer"
      description="3-column headers/footers & sequential multi-file Bates stamps (`{bates:EXH:000001}`, `[FILENAME]`, `[DATE]`)."
      currentHref="/tools/pdf/header-footer"
      multiple
      selectedFiles={files}
      onFilesSelected={(incoming) => setFiles(incoming)}
      submitLabel={files.length > 1 ? `Apply Across ${files.length} PDFs (ZIP)` : 'Apply Header & Footer'}
      onRun={async (onProgress, signal) => {
        if (files.length === 1) {
          return addHeaderFooterToPdf(
            files[0],
            {
              headerLeft,
              headerCenter,
              headerRight,
              footerLeft,
              footerCenter,
              footerRight,
              fontSize,
              fontFamily,
              color,
              marginPt,
              skipFirstPage,
              sourceFileName: files[0].name,
              increaseMargins,
            },
            onProgress,
            signal
          );
        }
        const t0 = performance.now();
        const zip = new JSZip();
        let nextOffset = 0;
        let totalPagesStamped = 0;
        for (let i = 0; i < files.length; i += 1) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          const f = files[i];
          const res = await addHeaderFooterToPdf(
            f,
            {
              headerLeft,
              headerCenter,
              headerRight,
              footerLeft,
              footerCenter,
              footerRight,
              fontSize,
              fontFamily,
              color,
              marginPt,
              skipFirstPage,
              sourceFileName: f.name,
              increaseMargins,
              batesStartOffset: nextOffset,
            },
            (pct) =>
              onProgress(Math.round(((i + pct / 100) / files.length) * 95), `Stamping ${f.name}`),
            signal
          );
          if (typeof res.nextBatesOffset === 'number') {
            nextOffset = res.nextBatesOffset;
          }
          totalPagesStamped += res.pageCount || 0;
          zip.file(res.fileName, res.blob);
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        onProgress(100, 'Header & footer ZIP ready');
        return {
          blob: zipBlob,
          url: URL.createObjectURL(zipBlob),
          fileName: 'header-footer-batch.zip',
          mimeType: 'application/zip',
          sizeBytes: zipBlob.size,
          elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
          pageCount: totalPagesStamped,
          summary: `Stamped ${files.length} files (${totalPagesStamped} pages total, sequential Bates offset: ${nextOffset})`,
        };
      }}
    >
      <div className="p-5 rounded-2xl border border-line bg-surface space-y-4">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-content-secondary">
          <span className="mr-1">Quick insert into focused field:</span>
          {[
            '{bates:DOC:000001}',
            '[FILENAME]',
            '[PAGE_NO]',
            '[TOTAL_PAGES]',
            '[DATE]',
            '{title}',
          ].map((tok) => (
            <button
              key={tok}
              type="button"
              onClick={() => insertToken(tok)}
              className="px-2 py-0.5 rounded-lg border border-line bg-surface-elevated hover:border-brand font-mono text-content"
            >
              {tok}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-bold text-content">Header (Top)</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text"
              placeholder="Header Left"
              value={headerLeft}
              onFocus={() => setActiveSlot('headerLeft')}
              onChange={(e) => setHeaderLeft(e.target.value)}
              className="px-3 py-2 rounded-xl border border-line bg-surface-elevated text-xs text-content"
            />
            <input
              type="text"
              placeholder="Header Center"
              value={headerCenter}
              onFocus={() => setActiveSlot('headerCenter')}
              onChange={(e) => setHeaderCenter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-line bg-surface-elevated text-xs text-content"
            />
            <input
              type="text"
              placeholder="Header Right"
              value={headerRight}
              onFocus={() => setActiveSlot('headerRight')}
              onChange={(e) => setHeaderRight(e.target.value)}
              className="px-3 py-2 rounded-xl border border-line bg-surface-elevated text-xs text-content"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-bold text-content">Footer (Bottom)</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text"
              placeholder="Footer Left"
              value={footerLeft}
              onFocus={() => setActiveSlot('footerLeft')}
              onChange={(e) => setFooterLeft(e.target.value)}
              className="px-3 py-2 rounded-xl border border-line bg-surface-elevated text-xs text-content"
            />
            <input
              type="text"
              placeholder="Footer Center"
              value={footerCenter}
              onFocus={() => setActiveSlot('footerCenter')}
              onChange={(e) => setFooterCenter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-line bg-surface-elevated text-xs text-content"
            />
            <input
              type="text"
              placeholder="Footer Right"
              value={footerRight}
              onFocus={() => setActiveSlot('footerRight')}
              onChange={(e) => setFooterRight(e.target.value)}
              className="px-3 py-2 rounded-xl border border-line bg-surface-elevated text-xs text-content"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 pt-2">
          <label className="text-xs text-content-secondary inline-flex items-center gap-2">
            <span>Font</span>
            <select
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value as PdfStandardFontChoice)}
              className="px-2.5 py-1.5 rounded-lg border border-line bg-surface-elevated text-content"
            >
              <option value="helvetica">Helvetica</option>
              <option value="times">Times Roman</option>
              <option value="courier">Courier</option>
            </select>
          </label>
          <label className="text-xs text-content-secondary inline-flex items-center gap-2">
            <span>Size (pt)</span>
            <input
              type="number"
              min={8}
              max={24}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="w-16 px-2 py-1.5 rounded-lg border border-line bg-surface-elevated text-content"
            />
          </label>
          <label className="text-xs text-content-secondary inline-flex items-center gap-2">
            <span>Margin (pt)</span>
            <input
              type="number"
              min={8}
              max={64}
              value={marginPt}
              onChange={(e) => setMarginPt(Math.max(8, Math.min(64, Number(e.target.value))))}
              className="w-16 px-2 py-1.5 rounded-lg border border-line bg-surface-elevated text-content"
            />
          </label>
          <label className="text-xs text-content-secondary inline-flex items-center gap-2">
            <span>Color</span>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-8 h-8 rounded border border-line cursor-pointer"
            />
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-content">
            <input
              type="checkbox"
              checked={skipFirstPage}
              onChange={(e) => setSkipFirstPage(e.target.checked)}
            />
            <span>Skip cover page (page 1)</span>
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-content">
            <input
              type="checkbox"
              checked={increaseMargins}
              onChange={(e) => setIncreaseMargins(e.target.checked)}
            />
            <span>Increase Page Margins</span>
          </label>
        </div>
      </div>
    </PdfToolShell>
  );
}

/**
 * Smallpdf / iLovePDF Benchmark: Quality Tiers + Grayscale + Strip-Images + Live Estimated Size Preview
 */
export function PdfCompressTool() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<PdfCompressMode>('balanced');
  const [quality, setQuality] = useState(0.76);
  const [targetDpi, setTargetDpi] = useState(144);
  const [invertColors, setInvertColors] = useState(false);
  const [estimate, setEstimate] = useState<{ estimatedBytes: number; reductionPct: number } | null>(null);

  useEffect(() => {
    if (!file) {
      setEstimate(null);
      return;
    }
    let cancelled = false;
    void estimateCompressedSize(file, mode, quality, targetDpi)
      .then((res) => {
        if (!cancelled) setEstimate(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [file, mode, quality, targetDpi]);

  return (
    <PdfToolShell
      title="Compress PDF"
      description="Light, Lossless QPDF, Balanced image downsampling, Grayscale, Strip Images, and High-Compression Rasterize tiers."
      currentHref="/tools/pdf/compress"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => setFile(files[0] || null)}
      submitLabel="Compress PDF"
      onRun={(onProgress, signal) =>
        compressPdfSmart(file!, { mode, quality, targetDpi, invertColors }, onProgress, signal)
      }
    >
      <div className="p-5 rounded-2xl border border-line bg-surface space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {[
            {
              id: 'less' as const,
              title: 'Light Compression',
              note: 'Minimum loss, preserves razor-sharp images with high-DPI light downscale',
            },
            {
              id: 'lossless' as const,
              title: 'Lossless QPDF',
              note: 'Flate + object streams (100% original image quality)',
            },
            {
              id: 'balanced' as const,
              title: 'Recommended (Balanced)',
              note: 'Downsamples heavy photos while keeping text selectable',
            },
            {
              id: 'grayscale' as const,
              title: 'Grayscale Document',
              note: 'Luminance grayscale re-encoding (~35–55% smaller)',
            },
            {
              id: 'strip-images' as const,
              title: 'Strip Images (Text/Vector)',
              note: 'Removes raster /Image XObjects, keeps text & vectors crisp',
            },
            {
              id: 'rasterize' as const,
              title: 'Strong (Extreme)',
              note: 'Maximum size drop via adaptive DPI page rasterization',
            },
          ].map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`p-3.5 rounded-xl border text-left transition-colors ${
                mode === m.id
                  ? 'border-brand bg-brand/8 text-content'
                  : 'border-line bg-surface-elevated text-content-secondary'
              }`}
            >
              <div className="text-xs font-bold text-content">{m.title}</div>
              <div className="text-[11px] mt-1 leading-snug">{m.note}</div>
            </button>
          ))}
        </div>

        {mode !== 'lossless' && mode !== 'strip-images' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <label className="text-xs text-content-secondary space-y-1">
              <span>Image quality ({Math.round(quality * 100)}%)</span>
              <input
                type="range"
                min={0.4}
                max={0.95}
                step={0.05}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="w-full"
              />
            </label>
            <label className="text-xs text-content-secondary space-y-1">
              <span>Target DPI ({targetDpi} DPI)</span>
              <input
                type="range"
                min={54}
                max={220}
                step={10}
                value={targetDpi}
                onChange={(e) => setTargetDpi(Number(e.target.value))}
                className="w-full"
              />
            </label>
          </div>
        )}

        {(mode === 'grayscale' || mode === 'rasterize') && (
          <label className="inline-flex items-center gap-2 text-xs text-content">
            <input
              type="checkbox"
              checked={invertColors}
              onChange={(e) => setInvertColors(e.target.checked)}
            />
            <span>Invert colors (high-contrast night / dark mode paper)</span>
          </label>
        )}

        {file && estimate && (
          <div className="p-3 rounded-xl border border-line bg-surface-elevated space-y-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-content-secondary">
                Original: <strong className="text-content font-mono">{formatBytes(file.size)}</strong>
              </span>
              <span className="text-brand font-semibold font-mono">
                Estimated: ~{formatBytes(estimate.estimatedBytes)} (~{estimate.reductionPct}% smaller)
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-surface overflow-hidden">
              <div
                className="h-full bg-brand rounded-full"
                style={{ width: `${Math.max(8, Math.min(100, 100 - estimate.reductionPct))}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </PdfToolShell>
  );
}

/**
 * iLovePDF Benchmark: Password Confirmation + Live Strength Indicator
 */
export function PdfProtectTool() {
  const [file, setFile] = useState<File | null>(null);
  const [userPassword, setUserPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [ownerPassword, setOwnerPassword] = useState('');
  const [keyBits, setKeyBits] = useState<128 | 256>(256);
  const [allowPrint, setAllowPrint] = useState(true);
  const [printQuality, setPrintQuality] = useState<'full' | 'low'>('full');
  const [allowCopy, setAllowCopy] = useState(false);
  const [allowModify, setAllowModify] = useState(false);
  const [allowAnnotate, setAllowAnnotate] = useState(false);
  const [allowForm, setAllowForm] = useState(true);
  const [allowAssemble, setAllowAssemble] = useState(false);

  const score =
    (userPassword.length >= 8 ? 1 : 0) +
    (/[A-Z]/.test(userPassword) && /[a-z]/.test(userPassword) ? 1 : 0) +
    (/\d/.test(userPassword) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(userPassword) ? 1 : 0);
  const strengthLabel =
    userPassword.length === 0
      ? ownerPassword.length >= 4
        ? 'Permissions Lock Only'
        : 'Enter open or owner password'
      : score <= 1
      ? 'Weak'
      : score === 2
      ? 'Fair'
      : score === 3
      ? 'Strong'
      : 'Very Strong';

  const hasValidUserPw = userPassword.length >= 4 && userPassword === confirmPassword;
  const hasOwnerOnlyLock = userPassword.length === 0 && ownerPassword.length >= 4;
  const canEncrypt = Boolean(file) && (hasValidUserPw || hasOwnerOnlyLock);

  return (
    <PdfToolShell
      title="Protect PDF"
      description="AES-256/AES-128 open-password encryption or open-without-password Owner permissions locking."
      currentHref="/tools/pdf/protect"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => setFile(files[0] || null)}
      submitLabel={hasOwnerOnlyLock ? 'Apply Permissions Lock' : 'Encrypt PDF'}
      canSubmit={canEncrypt}
      onRun={async (onProgress) => {
        const t0 = performance.now();
        onProgress(35, 'Encrypting via QPDF WASM…');
        const bytes = await protectPdfWithQpdf(new Uint8Array(await file!.arrayBuffer()), {
          userPassword,
          ownerPassword,
          keyBits,
          allowPrint,
          printQuality,
          allowCopy,
          allowModify,
          allowAnnotate,
          allowForm,
          allowAssemble,
        });
        onProgress(100, 'Encrypted');
        const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
        return {
          blob,
          url: URL.createObjectURL(blob),
          fileName: `${sanitizeFilenameStem(file!.name)}-protected.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: blob.size,
          elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
          summary: hasOwnerOnlyLock
            ? `Applied AES-${keyBits} Owner permissions lock (no open password)`
            : `Encrypted with AES-${keyBits}`,
        };
      }}
    >
      <div className="p-5 rounded-2xl border border-line bg-surface space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <label className="text-xs text-content-secondary space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span>Open password (optional if Owner set)</span>
              <span className="font-mono text-[10px] text-brand">{strengthLabel}</span>
            </div>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={userPassword}
                onChange={(e) => setUserPassword(e.target.value)}
                placeholder="Blank = permissions lock only"
                className="w-full pl-3 pr-9 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                aria-label="Toggle password visibility"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-content-secondary"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </label>

          <label className="text-xs text-content-secondary space-y-1">
            <span>Repeat open password</span>
            <input
              type={showPw ? 'text' : 'password'}
              value={confirmPassword}
              disabled={userPassword.length === 0}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={`w-full px-3 py-2 rounded-xl border bg-surface-elevated text-sm text-content disabled:opacity-50 ${
                userPassword && confirmPassword && !hasValidUserPw ? 'border-error' : 'border-line'
              }`}
            />
          </label>

          <label className="text-xs text-content-secondary space-y-1">
            <span>Owner password (permissions control)</span>
            <input
              type={showPw ? 'text' : 'password'}
              value={ownerPassword}
              onChange={(e) => setOwnerPassword(e.target.value)}
              placeholder="Min 4 chars for owner lock"
              className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
            />
          </label>

          <label className="text-xs text-content-secondary space-y-1">
            <span>Encryption &amp; print level</span>
            <div className="flex gap-2">
              <select
                value={keyBits}
                onChange={(e) => setKeyBits(Number(e.target.value) as 128 | 256)}
                className="flex-1 px-2.5 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
              >
                <option value={256}>AES-256</option>
                <option value={128}>AES-128</option>
              </select>
              <select
                value={printQuality}
                disabled={!allowPrint}
                onChange={(e) => setPrintQuality(e.target.value as 'full' | 'low')}
                className="px-2.5 py-2 rounded-xl border border-line bg-surface-elevated text-xs text-content disabled:opacity-50"
                aria-label="Print quality"
              >
                <option value="full">Hi-Res Print</option>
                <option value="low">Draft Print</option>
              </select>
            </div>
          </label>
        </div>

        <div className="flex flex-wrap gap-4 text-xs text-content">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={allowPrint} onChange={(e) => setAllowPrint(e.target.checked)} />
            <span>Allow printing</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={allowCopy} onChange={(e) => setAllowCopy(e.target.checked)} />
            <span>Allow copying text/images</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={allowModify} onChange={(e) => setAllowModify(e.target.checked)} />
            <span>Allow document edits</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={allowAnnotate} onChange={(e) => setAllowAnnotate(e.target.checked)} />
            <span>Allow comments</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={allowForm} onChange={(e) => setAllowForm(e.target.checked)} />
            <span>Allow form fill</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={allowAssemble} onChange={(e) => setAllowAssemble(e.target.checked)} />
            <span>Allow page assembly</span>
          </label>
        </div>
      </div>
    </PdfToolShell>
  );
}

export function PdfUnlockTool() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [stripSignatureLocks, setStripSignatureLocks] = useState(false);

  return (
    <PdfToolShell
      title="Unlock PDF"
      description="Remove password encryption, owner restrictions, or read-only certification signature locks locally via QPDF WASM."
      currentHref="/tools/pdf/unlock"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => setFile(files[0] || null)}
      submitLabel="Unlock PDF"
      onRun={async (onProgress) => {
        const t0 = performance.now();
        onProgress(40, 'Decrypting via QPDF WASM…');
        const bytes = await unlockPdfWithQpdf(new Uint8Array(await file!.arrayBuffer()), password, {
          stripSignatureLocks,
        });
        onProgress(100, 'Decrypted');
        const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
        return {
          blob,
          url: URL.createObjectURL(blob),
          fileName: `${sanitizeFilenameStem(file!.name)}-unlocked.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: blob.size,
          elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
          summary: stripSignatureLocks
            ? 'Removed protection and stripped certifying signature locks'
            : 'Removed password protection',
        };
      }}
    >
      <div className="p-5 rounded-2xl border border-line bg-surface space-y-3 max-w-lg">
        <label className="text-xs text-content-secondary space-y-1 block">
          <span>Document password (leave blank for owner-restricted PDFs)</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
          />
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-content">
          <input
            type="checkbox"
            checked={stripSignatureLocks}
            onChange={(e) => setStripSignatureLocks(e.target.checked)}
          />
          <span>Strip certifying signature locks to allow editing/merging</span>
        </label>
      </div>
    </PdfToolShell>
  );
}

/**
 * Mapsoft Signature Validator Benchmark: Structured Validation Report + Export
 */
export function PdfVerifySignaturesTool() {
  const [file, setFile] = useState<File | null>(null);
  const [sigs, setSigs] = useState<PdfSignatureInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const inspectFile = async (files: File[]) => {
    const f = files[0];
    setFile(f || null);
    setSigs(null);
    setVerifyError(null);
    if (!f) return;
    setLoading(true);
    try {
      setSigs(await verifyPdfSignaturesInBrowser(f));
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Unable to verify PDF signatures.');
    } finally {
      setLoading(false);
    }
  };

  const exportReport = () => {
    if (!sigs || !file) return;
    const payload = JSON.stringify({ file: file.name, inspectedAt: new Date().toISOString(), signatures: sigs }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFilenameStem(file.name)}-signature-report.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <PdfToolShell
      title="Verify PDF signatures"
      description="ASN.1 PKCS#7/CMS WebCrypto signature verification with X.509 certificate details, TSA timestamp, and ByteRange audit."
      currentHref="/tools/pdf/verify-signatures"
      selectedFiles={file ? [file] : []}
      onFilesSelected={inspectFile}
      hideSubmitBar
    >
      {loading && <div className="text-xs text-content-secondary">Inspecting cryptographic signature dictionaries…</div>}
      {verifyError && (
        <div className="p-4 rounded-xl bg-error-bg border border-error text-error text-xs font-medium">
          {verifyError}
        </div>
      )}
      {sigs && sigs.length === 0 && (
        <div className="p-5 rounded-2xl border border-line bg-surface text-sm text-content-secondary">
          No digital signature dictionaries (<code className="font-mono">/FT /Sig</code>) found in this PDF.
        </div>
      )}
      {sigs && sigs.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 p-4 rounded-2xl border border-line bg-surface">
            <div className="text-sm font-bold text-content">
              Found {sigs.length} Digital Signature(s)
            </div>
            <button
              type="button"
              onClick={exportReport}
              className="px-3.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Validation Report (.json)</span>
            </button>
          </div>

          {sigs.map((sig, i) => (
            <div key={i} className="p-5 rounded-2xl border border-line bg-surface space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-sm text-content">
                  {sig.status === 'valid-integrity' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  ) : sig.status === 'tampered' ? (
                    <AlertTriangle className="w-4 h-4 text-error" />
                  ) : (
                    <ShieldCheck className="w-4 h-4 text-amber-500" />
                  )}
                  <span>{sig.fieldName} — {sig.signerName}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                  <span className="px-2.5 py-0.5 rounded bg-surface-elevated border border-line">
                    {sig.digestAlgorithm} · {sig.subFilter}
                  </span>
                  {sig.isSelfSigned && (
                    <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-600">Self-Signed</span>
                  )}
                  {sig.hasTimestamp && (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600">TSA Timestamped</span>
                  )}
                  {sig.hasLaterRevisions && (
                    <span className="px-2 py-0.5 rounded bg-surface-elevated border border-line text-content-secondary">
                      Later Revisions Present
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
                <div className="p-2.5 rounded-xl bg-surface-elevated border border-line">
                  <div className="text-content-secondary">Certificate Issuer</div>
                  <div className="font-semibold text-content mt-0.5 truncate">{sig.issuer}</div>
                  {sig.serialNumber && (
                    <div className="text-[10px] font-mono text-content-secondary mt-0.5 truncate">
                      SN: {sig.serialNumber}
                    </div>
                  )}
                </div>
                <div className="p-2.5 rounded-xl bg-surface-elevated border border-line">
                  <div className="text-content-secondary">ByteRange Coverage</div>
                  <div className="font-semibold text-content mt-0.5">
                    {sig.byteRangeCoversWholeFile ? 'Full Document (100%)' : 'Partial / Incremental'}
                  </div>
                  {sig.byteRange && (
                    <div className="text-[10px] font-mono text-content-secondary mt-0.5">
                      [{sig.byteRange.join(', ')}]
                    </div>
                  )}
                </div>
                <div className="p-2.5 rounded-xl bg-surface-elevated border border-line">
                  <div className="text-content-secondary">Digest &amp; Crypto Verify</div>
                  <div className="font-semibold text-content mt-0.5">
                    {sig.digestValid === true
                      ? sig.cryptographicValid === true
                        ? 'RSA/ECDSA + Digest Valid'
                        : sig.cryptographicValid === false
                        ? 'Crypto Verify Failed'
                        : 'Integrity Intact'
                      : sig.digestValid === false
                      ? 'Modified / Mismatch'
                      : 'Indeterminate'}
                  </div>
                  {(sig.reason || sig.location) && (
                    <div className="text-[10px] text-content-secondary mt-0.5 truncate">
                      {[sig.reason, sig.location].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
                <div className="p-2.5 rounded-xl bg-surface-elevated border border-line">
                  <div className="text-content-secondary">Validity Window</div>
                  <div className="font-semibold text-content mt-0.5 truncate">
                    {sig.validTo ? `Until ${sig.validTo.slice(0, 10)}` : sig.signingTime || 'Not declared'}
                  </div>
                  {sig.timestampTime && (
                    <div className="text-[10px] text-content-secondary mt-0.5 truncate">
                      TSA: {sig.timestampTime}
                    </div>
                  )}
                </div>
              </div>
              <p className="text-xs text-content-secondary">{sig.notes}</p>
            </div>
          ))}
        </div>
      )}
    </PdfToolShell>
  );
}

export function PdfMetadataTool() {
  const [file, setFile] = useState<File | null>(null);
  const [vals, setVals] = useState<PdfMetadataValues>({
    title: '',
    author: '',
    subject: '',
    keywords: '',
    creator: '',
    producer: '',
    pageCount: 0,
  });
  const [deepInfo, setDeepInfo] = useState<PdfDeepInspectionResult | null>(null);
  const [deepLoading, setDeepLoading] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'pages' | 'fonts' | 'scripts'>('overview');
  const [deletingMeta, setDeletingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [externalResult, setExternalResult] = useState<PdfProcessResult | null>(null);

  const handleLoad = async (files: File[]) => {
    const f = files[0];
    setFile(f || null);
    setDeepInfo(null);
    setExternalResult(null);
    setMetaError(null);
    if (!f) return;
    setDeepLoading(true);
    try {
      const [meta, deep] = await Promise.all([
        getPdfMetadata(f).catch(() => null),
        inspectPdfDeep(f).catch(() => null),
      ]);
      if (meta) setVals(meta);
      if (deep) setDeepInfo(deep);
      if (!meta && !deep) setMetaError('Could not inspect PDF metadata.');
    } finally {
      setDeepLoading(false);
    }
  };

  const handleDeleteAllMetadata = async () => {
    if (!file) return;
    setDeletingMeta(true);
    setMetaError(null);
    try {
      const res = await removePdfMetadata(file);
      setExternalResult(res);
      setVals((prev) => ({
        ...prev,
        title: '',
        author: '',
        subject: '',
        keywords: '',
        creator: '',
        producer: '',
      }));
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : 'Failed to purge PDF metadata.');
    } finally {
      setDeletingMeta(false);
    }
  };

  return (
    <PdfToolShell
      title="Document info & metadata"
      description="Inspect and edit PDF tags, audit PDF version, object count, mixed page sizes, embedded fonts, and JavaScript actions."
      currentHref="/tools/pdf/metadata"
      selectedFiles={file ? [file] : []}
      onFilesSelected={handleLoad}
      submitLabel="Save Metadata"
      externalResult={externalResult}
      onClearExternalResult={() => setExternalResult(null)}
      onRun={(onProgress) => setPdfMetadata(file!, vals, onProgress)}
    >
      {file && (
        <div className="space-y-4">
          {metaError && (
            <div className="p-3 rounded-xl bg-error-bg border border-error text-error text-xs font-medium">
              {metaError}
            </div>
          )}
          <div className="p-5 rounded-2xl border border-line bg-surface space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-content">Standard Info Dictionary Tags</div>
              <button
                type="button"
                disabled={deletingMeta}
                onClick={handleDeleteAllMetadata}
                className="px-3 py-1.5 rounded-xl border border-error/40 bg-error-bg text-error text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{deletingMeta ? 'Purging…' : 'Delete All Metadata'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(['title', 'author', 'subject', 'keywords', 'creator', 'producer'] as const).map((k) => (
                <label key={k} className="text-xs text-content-secondary space-y-1 capitalize">
                  <span>{k}</span>
                  <input
                    type="text"
                    value={vals[k]}
                    onChange={(e) => setVals((prev) => ({ ...prev, [k]: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
                  />
                </label>
              ))}
            </div>
          </div>

          {/* Deep Inspector & JS Audit Panel */}
          <div className="rounded-2xl border border-line bg-surface overflow-hidden">
            <button
              type="button"
              onClick={() => setInspectorOpen((o) => !o)}
              className="w-full px-5 py-3.5 flex items-center justify-between text-left bg-surface-elevated border-b border-line"
            >
              <div className="flex items-center gap-2">
                <FileSearch className="w-4 h-4 text-brand" aria-hidden="true" />
                <span className="text-xs font-bold text-content">Deep Inspector &amp; JS Audit</span>
                {deepInfo && (
                  <span className="text-[11px] font-mono text-content-secondary">
                    PDF {deepInfo.effectiveVersion} · {deepInfo.objectCount} objects · {deepInfo.fonts.length} fonts ·{' '}
                    {deepInfo.scripts.length} JS
                  </span>
                )}
              </div>
              {inspectorOpen ? (
                <ChevronUp className="w-4 h-4 text-content-secondary" />
              ) : (
                <ChevronDown className="w-4 h-4 text-content-secondary" />
              )}
            </button>

            {inspectorOpen && (
              <div className="p-5 space-y-4">
                {deepLoading && (
                  <div className="text-xs text-content-secondary">Running deep structural and JavaScript audit…</div>
                )}

                {deepInfo && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          { id: 'overview', label: 'Overview' },
                          { id: 'pages', label: `Page Dimensions (${deepInfo.pages.length})` },
                          { id: 'fonts', label: `Font Inventory (${deepInfo.fonts.length})` },
                          { id: 'scripts', label: `JavaScript Audit (${deepInfo.scripts.length})` },
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setActiveTab(tab.id)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border ${
                            activeTab === tab.id
                              ? 'bg-brand text-white border-brand'
                              : 'bg-surface-elevated border-line text-content-secondary'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {activeTab === 'overview' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                        <div className="p-3 rounded-xl bg-surface-elevated border border-line">
                          <div className="text-content-secondary">PDF Version &amp; Conformance</div>
                          <div className="font-bold font-mono text-content mt-0.5">
                            Header {deepInfo.headerVersion}
                            {deepInfo.catalogVersion ? ` · Catalog ${deepInfo.catalogVersion}` : ''}
                          </div>
                          {deepInfo.pdfaConformance && (
                            <div className="text-[10px] font-mono text-brand mt-0.5">
                              {deepInfo.pdfaConformance}
                            </div>
                          )}
                        </div>
                        <div className="p-3 rounded-xl bg-surface-elevated border border-line">
                          <div className="text-content-secondary">Indirect Objects &amp; Dates</div>
                          <div className="font-bold font-mono text-content mt-0.5">
                            {deepInfo.objectCount.toLocaleString()} objects
                          </div>
                          {(vals.creationDate || vals.modificationDate) && (
                            <div className="text-[10px] font-mono text-content-secondary mt-0.5 truncate">
                              Mod: {(vals.modificationDate || vals.creationDate || '').slice(0, 16)}
                            </div>
                          )}
                        </div>
                        <div className="p-3 rounded-xl bg-surface-elevated border border-line">
                          <div className="text-content-secondary">Page Geometry</div>
                          <div className="font-semibold text-content mt-0.5">{deepInfo.pageSizesSummary}</div>
                        </div>
                        <div className="p-3 rounded-xl bg-surface-elevated border border-line">
                          <div className="text-content-secondary">Security &amp; Scripts</div>
                          <div className="font-semibold text-content mt-0.5">
                            {deepInfo.encryptionInfo
                              ? `Encrypted (${deepInfo.encryptionInfo.filter || ''}${deepInfo.encryptionInfo.keyBits ? ` AES-${deepInfo.encryptionInfo.keyBits}` : ''})`
                              : deepInfo.isEncrypted
                              ? 'Encrypted'
                              : 'Unencrypted'}{' '}
                            · {deepInfo.scripts.length} JS
                          </div>
                          {deepInfo.encryptionInfo && (
                            <div className="text-[10px] text-content-secondary mt-0.5">
                              Print: {deepInfo.encryptionInfo.allowPrint ? 'Yes' : 'No'} · Copy:{' '}
                              {deepInfo.encryptionInfo.allowCopy ? 'Yes' : 'No'}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {activeTab === 'pages' && (
                      <div className="space-y-3">
                        {deepInfo.hasMixedPageSizes && (
                          <div className="p-3 rounded-xl border border-amber-500/40 bg-amber-500/10 text-xs text-amber-600 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                            <span>
                              <strong>Mixed page sizes detected:</strong> {deepInfo.pageSizesSummary}
                            </span>
                          </div>
                        )}
                        <div className="max-h-64 overflow-auto rounded-xl border border-line">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-surface-elevated text-content-secondary border-b border-line">
                              <tr>
                                <th className="px-3 py-2">Page</th>
                                <th className="px-3 py-2">Format</th>
                                <th className="px-3 py-2">Dimensions (mm / in)</th>
                                <th className="px-3 py-2">Points (pt)</th>
                                <th className="px-3 py-2">Rotation</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                              {deepInfo.pages.map((p) => (
                                <tr key={p.pageNumber}>
                                  <td className="px-3 py-1.5 font-mono">#{p.pageNumber}</td>
                                  <td className="px-3 py-1.5 font-semibold">{p.paperName}</td>
                                  <td className="px-3 py-1.5 font-mono">
                                    {p.widthMm}×{p.heightMm}mm ({p.widthIn ?? (p.widthPt / 72).toFixed(2)}×{p.heightIn ?? (p.heightPt / 72).toFixed(2)}in)
                                  </td>
                                  <td className="px-3 py-1.5 font-mono text-content-secondary">
                                    {p.widthPt} × {p.heightPt}
                                  </td>
                                  <td className="px-3 py-1.5 font-mono">{p.rotation}°</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {activeTab === 'fonts' && (
                      <div className="max-h-64 overflow-auto rounded-xl border border-line">
                        {deepInfo.fonts.length === 0 ? (
                          <div className="p-4 text-xs text-content-secondary">No font dictionaries found.</div>
                        ) : (
                          <table className="w-full text-left text-xs">
                            <thead className="bg-surface-elevated text-content-secondary border-b border-line">
                              <tr>
                                <th className="px-3 py-2">Font Family</th>
                                <th className="px-3 py-2">Type</th>
                                <th className="px-3 py-2">Status</th>
                                <th className="px-3 py-2">Stream</th>
                                <th className="px-3 py-2">Pages</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                              {deepInfo.fonts.map((f, idx) => (
                                <tr key={`${f.baseFont}-${idx}`}>
                                  <td className="px-3 py-1.5">
                                    <div className="font-semibold text-content">{f.cleanFamily}</div>
                                    <div className="text-[10px] font-mono text-content-secondary">{f.baseFont}</div>
                                  </td>
                                  <td className="px-3 py-1.5 font-mono">
                                    {f.subtype}
                                    {f.isSubset ? ' (Subset)' : ''}
                                  </td>
                                  <td className="px-3 py-1.5">
                                    <span
                                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                        f.isEmbedded
                                          ? 'bg-emerald-500/15 text-emerald-600'
                                          : 'bg-amber-500/15 text-amber-600'
                                      }`}
                                    >
                                      {f.isEmbedded ? 'Embedded' : 'Missing / Standard'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-1.5 font-mono text-content-secondary">
                                    {f.streamBytes > 0 ? formatBytes(f.streamBytes) : '—'}
                                  </td>
                                  <td className="px-3 py-1.5 font-mono text-content-secondary">
                                    {f.pages.slice(0, 8).join(', ')}
                                    {f.pages.length > 8 ? ` +${f.pages.length - 8}` : ''}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}

                    {activeTab === 'scripts' && (
                      <div className="space-y-3">
                        {deepInfo.scripts.length === 0 ? (
                          <div className="p-4 rounded-xl border border-line bg-surface-elevated text-xs text-emerald-600 flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                            <span>No JavaScript actions found in Catalog, Names, Pages, Widgets, or Links.</span>
                          </div>
                        ) : (
                          deepInfo.scripts.map((sc, idx) => (
                            <div key={idx} className="rounded-xl border border-amber-500/30 bg-surface-elevated overflow-hidden">
                              <div className="px-3 py-2 border-b border-line flex items-center gap-2 text-xs font-semibold text-content">
                                <Code2 className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
                                <span>{sc.location}</span>
                              </div>
                              <pre className="p-3 text-[11px] font-mono text-content-secondary overflow-x-auto max-h-48 whitespace-pre-wrap">
                                {sc.code}
                              </pre>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </PdfToolShell>
  );
}

/**
 * Super ToolKit Benchmark: Pre-Scan Fingerprint Inspector + Zero-Upload Scrubber
 */
export function PdfRemoveMetadataTool() {
  const [file, setFile] = useState<File | null>(null);
  const [audit, setAudit] = useState<PdfFingerprintAudit | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const handleLoad = async (files: File[]) => {
    const f = files[0];
    setFile(f || null);
    setAudit(null);
    setScanError(null);
    if (!f) return;
    try {
      setAudit(await inspectHiddenFingerprints(f));
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Unable to scan hidden fingerprints.');
    }
  };

  return (
    <PdfToolShell
      title="Remove hidden info"
      description="Pre-scan fingerprint scanner revealing Info tags, XMP streams, thumbnails, PieceInfo, and OpenActions before QPDF scrub."
      currentHref="/tools/pdf/remove-metadata"
      selectedFiles={file ? [file] : []}
      onFilesSelected={handleLoad}
      submitLabel="Scrub All Hidden Fingerprints"
      onRun={(onProgress, signal) => removePdfMetadata(file!, onProgress, signal)}
    >
      {scanError && (
        <div className="p-3 rounded-xl bg-error-bg border border-error text-error text-xs font-medium">
          {scanError}
        </div>
      )}
      {audit && (
        <div className="p-5 rounded-2xl border border-line bg-surface space-y-3 text-xs">
          <div className="font-bold text-content">
            Detected {audit.infoFields.length} Info tag(s)
            {audit.hasXmpMetadata ? ' + XMP Stream' : ''}
            {audit.hasOpenAction ? ' + OpenAction' : ''}
            {audit.thumbnailCount ? ` + ${audit.thumbnailCount} Thumbnail(s)` : ''}
            {audit.pieceInfoCount ? ` + ${audit.pieceInfoCount} App PieceInfo` : ''}
          </div>
          {audit.infoFields.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {audit.infoFields.map((f) => (
                <div key={f.key} className="p-2 rounded-lg bg-surface-elevated border border-line truncate">
                  <span className="font-semibold text-content">{f.key}:</span>{' '}
                  <span className="text-content-secondary">{f.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-content-secondary">No Info dictionary tags detected.</div>
          )}
        </div>
      )}
    </PdfToolShell>
  );
}

const ANNOT_SUBTYPES = [
  { id: 'Text', label: 'Sticky Notes' },
  { id: 'Highlight', label: 'Highlights' },
  { id: 'FreeText', label: 'Text Callouts' },
  { id: 'Ink', label: 'Freehand Ink' },
  { id: 'Stamp', label: 'Stamps' },
  { id: 'Popup', label: 'Comment Popups' },
] as const;

export function PdfRemoveAnnotationsTool() {
  const [file, setFile] = useState<File | null>(null);
  const [keepForms, setKeepForms] = useState(true);
  const [keepLinks, setKeepLinks] = useState(true);
  const [stripAllComments, setStripAllComments] = useState(true);
  const [selectedSubtypes, setSelectedSubtypes] = useState<string[]>([
    'Text',
    'Highlight',
    'FreeText',
    'Ink',
    'Stamp',
    'Popup',
  ]);

  return (
    <PdfToolShell
      title="Remove comments"
      description="Delete comments, highlights, ink, or stamps selectively without disturbing page text, forms, or links."
      currentHref="/tools/pdf/remove-annotations"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => setFile(files[0] || null)}
      submitLabel="Remove Selected Annotations"
      onRun={(onProgress) =>
        removePdfAnnotations(
          file!,
          {
            keepFormWidgets: keepForms,
            keepLinks,
            subtypesToStrip: stripAllComments ? undefined : selectedSubtypes,
          },
          onProgress
        )
      }
    >
      <div className="p-4 rounded-xl border border-line bg-surface space-y-3 text-xs text-content">
        <div className="flex flex-wrap gap-5">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={keepForms}
              onChange={(e) => setKeepForms(e.target.checked)}
            />
            <span>Preserve fillable AcroForm fields</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={keepLinks}
              onChange={(e) => setKeepLinks(e.target.checked)}
            />
            <span>Preserve clickable hyperlinks</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={stripAllComments}
              onChange={(e) => setStripAllComments(e.target.checked)}
            />
            <span>Remove all comment &amp; markup subtypes</span>
          </label>
        </div>

        {!stripAllComments && (
          <div className="flex flex-wrap gap-3 pt-2 border-t border-line">
            {ANNOT_SUBTYPES.map((st) => {
              const checked = selectedSubtypes.includes(st.id);
              return (
                <label key={st.id} className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setSelectedSubtypes((prev) =>
                        e.target.checked ? [...prev, st.id] : prev.filter((x) => x !== st.id)
                      )
                    }
                  />
                  <span>{st.label}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </PdfToolShell>
  );
}

/**
 * Mapsoft / Stirling Benchmark: Granular Sanitization Checkboxes + Pre-Scan JS Code Audit
 */
export function PdfSanitizeTool() {
  const [file, setFile] = useState<File | null>(null);
  const [audit, setAudit] = useState<PdfFingerprintAudit | null>(null);
  const [scripts, setScripts] = useState<Array<{ location: string; code: string }>>([]);
  const [showJsPreview, setShowJsPreview] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [stripMetadata, setStripMetadata] = useState(true);
  const [stripAnnotations, setStripAnnotations] = useState(true);
  const [stripJavaScript, setStripJavaScript] = useState(true);
  const [stripEmbeddedFiles, setStripEmbeddedFiles] = useState(true);
  const [stripForms, setStripForms] = useState(false);
  const [stripExternalActions, setStripExternalActions] = useState(true);
  const [burnToPixels, setBurnToPixels] = useState(false);

  const handleLoad = async (files: File[]) => {
    const f = files[0];
    setFile(f || null);
    setAudit(null);
    setScripts([]);
    setShowJsPreview(false);
    setScanError(null);
    if (!f) return;
    try {
      const [fp, deep] = await Promise.all([
        inspectHiddenFingerprints(f),
        inspectPdfDeep(f).catch(() => null),
      ]);
      setAudit(fp);
      if (deep?.scripts) setScripts(deep.scripts);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Unable to scan PDF.');
    }
  };

  return (
    <PdfToolShell
      title="Clean up & sanitize PDF"
      description="Single-pass sanitizer with toggles for Metadata, Comments, JavaScript, Forms, /Launch+/URI Actions, Embedded Files, or Pixel-Burn."
      currentHref="/tools/pdf/sanitize"
      selectedFiles={file ? [file] : []}
      onFilesSelected={handleLoad}
      submitLabel="Sanitize PDF"
      onRun={(onProgress, signal) =>
        sanitizePdfDeep(
          file!,
          {
            stripMetadata,
            stripAnnotations,
            stripJavaScript,
            stripEmbeddedFiles,
            stripForms,
            stripExternalActions,
            burnToPixels,
          },
          onProgress,
          signal
        )
      }
    >
      <div className="p-5 rounded-2xl border border-line bg-surface space-y-3 text-xs text-content">
        {scanError && (
          <div className="p-3 rounded-xl bg-error-bg border border-error text-error font-medium">
            {scanError}
          </div>
        )}
        {audit && (
          <div className="p-3 rounded-xl bg-surface-elevated border border-line text-content-secondary flex flex-wrap items-center justify-between gap-2">
            <span>
              Pre-scan: <strong className="text-content">{audit.totalFingerprints}</strong> hidden item(s)
              ({audit.infoFields.length} metadata, {audit.commentAnnotationsCount} comments, {audit.javaScriptCount} JS, {audit.embeddedFilesCount} embedded)
            </span>
            {scripts.length > 0 && (
              <button
                type="button"
                onClick={() => setShowJsPreview((s) => !s)}
                className="px-2.5 py-1 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-600 font-semibold inline-flex items-center gap-1"
              >
                <Code2 className="w-3.5 h-3.5" />
                <span>{showJsPreview ? 'Hide JS' : `Inspect ${scripts.length} JS Script(s)`}</span>
              </button>
            )}
          </div>
        )}
        {showJsPreview && scripts.length > 0 && (
          <div className="max-h-48 overflow-auto rounded-xl border border-amber-500/30 bg-surface-elevated p-3 space-y-2">
            {scripts.map((sc, i) => (
              <div key={i}>
                <div className="font-mono font-semibold text-amber-600">{sc.location}</div>
                <pre className="text-[11px] font-mono text-content-secondary whitespace-pre-wrap">{sc.code}</pre>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={stripMetadata} onChange={(e) => setStripMetadata(e.target.checked)} />
            <span>Strip Info, XMP, Thumbs &amp; PieceInfo</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={stripAnnotations} onChange={(e) => setStripAnnotations(e.target.checked)} />
            <span>Remove Comments &amp; Annotations</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={stripJavaScript} onChange={(e) => setStripJavaScript(e.target.checked)} />
            <span>Purge JavaScript &amp; Auto-Actions</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={stripEmbeddedFiles} onChange={(e) => setStripEmbeddedFiles(e.target.checked)} />
            <span>Remove Embedded Attachments</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={stripForms} onChange={(e) => setStripForms(e.target.checked)} />
            <span>Remove AcroForm Fields</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={stripExternalActions} onChange={(e) => setStripExternalActions(e.target.checked)} />
            <span>Purge /Launch &amp; External /URI</span>
          </label>
        </div>
        <label className="inline-flex items-center gap-2 pt-2 border-t border-line">
          <input
            type="checkbox"
            checked={burnToPixels}
            onChange={(e) => setBurnToPixels(e.target.checked)}
          />
          <span>
            <strong>Pixel-burn mode</strong> (renders every page to clean raster layers — guarantees zero hidden text, layers, or scripts)
          </span>
        </label>
      </div>
    </PdfToolShell>
  );
}

export function PdfFlattenTool() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'structural' | 'raster'>('structural');
  return (
    <PdfToolShell
      title="Flatten PDF"
      description="Bake interactive form fields and annotations into static page content in one click."
      currentHref="/tools/pdf/flatten"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => setFile(files[0] || null)}
      submitLabel="Flatten PDF"
      onRun={(onProgress, signal) => flattenPdf(file!, mode, onProgress, signal)}
    >
      <div className="p-4 rounded-2xl border border-line bg-surface flex flex-wrap gap-3 text-xs">
        <button
          type="button"
          onClick={() => setMode('structural')}
          className={`px-3.5 py-2 rounded-xl border font-semibold ${
            mode === 'structural' ? 'bg-brand text-white border-brand' : 'bg-surface-elevated border-line'
          }`}
        >
          Structural AcroForm Flatten (keeps crisp vector text)
        </button>
        <button
          type="button"
          onClick={() => setMode('raster')}
          className={`px-3.5 py-2 rounded-xl border font-semibold ${
            mode === 'raster' ? 'bg-brand text-white border-brand' : 'bg-surface-elevated border-line'
          }`}
        >
          Full Visual Raster Flatten
        </button>
      </div>
    </PdfToolShell>
  );
}

export function PdfRepairTool() {
  const [file, setFile] = useState<File | null>(null);
  return (
    <PdfToolShell
      title="Repair PDF"
      description="3-stage local recovery: QPDF cross-reference repair, pdf-lib AST rebuild, and PDF.js visual reconstruction."
      currentHref="/tools/pdf/repair"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => setFile(files[0] || null)}
      submitLabel="Repair PDF"
      onRun={(onProgress, signal) => repairPdfMultiEngine(file!, onProgress, signal)}
    >
      {file && (
        <div className="p-4 rounded-xl border border-line bg-surface text-xs text-content-secondary">
          Loaded <strong className="text-content">{file.name}</strong> ({formatBytes(file.size)}). Ready for 3-stage recovery.
        </div>
      )}
    </PdfToolShell>
  );
}
