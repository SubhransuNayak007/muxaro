import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  PDFPage,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  StandardFonts,
  decodePDFRawStream,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import JSZip from 'jszip';
import QRCode from 'qrcode';
import { assertValidPdfFile, classifyPdfError, PdfToolError, sanitizeFilenameStem } from './errors.ts';
import { loadMatchedFontBytes, type ModernFontSlug } from './font-matcher.ts';
import { parsePageRange, parseSplitGroups } from './page-range.ts';
import { getPdfJs, loadPdfJsDocument, renderPdfPageToBlob, renderPdfPageToCanvas } from './pdf-browser.ts';
import { compressLosslessWithQpdf, purgeOrphanObjectsWithQpdf, repairWithQpdf } from './qpdf-browser.ts';
import jsQR from 'jsqr';
import type {
  BookmarkSplitEntry,
  GridPosition9,
  PdfCompressMode,
  PdfDeepInspectionResult,
  PdfEditorOverlayElement,
  PdfExistingLinkEdit,
  PdfFingerprintAudit,
  PdfInlineTextEdit,
  PdfMetadataValues,
  PdfPageSizePreset,
  PdfProcessResult,
  PdfStandardFontChoice,
} from './types.ts';

function makeResult(
  bytes: Uint8Array | Blob,
  fileName: string,
  mimeType: string,
  startMs: number,
  extra: Partial<PdfProcessResult> = {}
): PdfProcessResult {
  const blob =
    bytes instanceof Blob
      ? bytes
      : new Blob([new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) as BlobPart], {
          type: mimeType,
        });
  return {
    blob,
    url: URL.createObjectURL(blob),
    fileName,
    mimeType,
    sizeBytes: blob.size,
    elapsedMs: Math.max(1, Math.round(performance.now() - startMs)),
    ...extra,
  };
}

function hexToRgb(hex = '#0b0b0d') {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0');
  const r = Number.parseInt(full.slice(0, 2), 16) / 255;
  const g = Number.parseInt(full.slice(2, 4), 16) / 255;
  const b = Number.parseInt(full.slice(4, 6), 16) / 255;
  return rgb(
    Number.isFinite(r) ? r : 0,
    Number.isFinite(g) ? g : 0,
    Number.isFinite(b) ? b : 0
  );
}

async function embedChoiceFont(
  doc: PDFDocument,
  family: PdfStandardFontChoice = 'helvetica',
  bold = false,
  italic = false
) {
  if (family === 'times') {
    if (bold && italic) return doc.embedFont(StandardFonts.TimesRomanBoldItalic);
    if (bold) return doc.embedFont(StandardFonts.TimesRomanBold);
    if (italic) return doc.embedFont(StandardFonts.TimesRomanItalic);
    return doc.embedFont(StandardFonts.TimesRoman);
  }
  if (family === 'courier') {
    if (bold && italic) return doc.embedFont(StandardFonts.CourierBoldOblique);
    if (bold) return doc.embedFont(StandardFonts.CourierBold);
    if (italic) return doc.embedFont(StandardFonts.CourierOblique);
    return doc.embedFont(StandardFonts.Courier);
  }
  if (bold && italic) return doc.embedFont(StandardFonts.HelveticaBoldOblique);
  if (bold) return doc.embedFont(StandardFonts.HelveticaBold);
  if (italic) return doc.embedFont(StandardFonts.HelveticaOblique);
  return doc.embedFont(StandardFonts.Helvetica);
}

/**
 * Normalizes punctuation and strips non-WinAnsi characters (> 0xFF) so StandardFont
 * .drawText() never throws encoding errors on arbitrary filenames or pasted Unicode.
 */
function sanitizeWinAnsi(str: string): string {
  return str
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\u2022/g, '*')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
}

function toRoman(num: number): string {
  if (!Number.isFinite(num) || num <= 0) return String(num);
  let n = Math.floor(num);
  const table: Array<[number, string]> = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let out = '';
  for (const [val, sym] of table) {
    while (n >= val) {
      out += sym;
      n -= val;
    }
  }
  return out;
}

function expandPageVerticalMargins(page: PDFPage, addTop: number, addBottom: number): void {
  if (addTop <= 0 && addBottom <= 0) return;
  const mb = page.getMediaBox();
  page.setMediaBox(mb.x, mb.y - addBottom, mb.width, mb.height + addBottom + addTop);
  if (page.node.CropBox()) {
    const cb = page.getCropBox();
    page.setCropBox(cb.x, cb.y - addBottom, cb.width, cb.height + addBottom + addTop);
  }
}

async function loadPdfLibStrict(file: File, ignoreEncryption = false): Promise<PDFDocument> {
  await assertValidPdfFile(file);
  const bytes = await file.arrayBuffer();
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption });
  } catch (err) {
    throw classifyPdfError(err, file.name);
  }
}

export async function mergePdfs(
  items: Array<{ file: File; pageRange?: string }>,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<PdfProcessResult> {
  if (items.length < 2) {
    throw new PdfToolError('Select at least 2 PDF files to merge.', 'validation');
  }
  const t0 = performance.now();
  const merged = await PDFDocument.create();

  for (let idx = 0; idx < items.length; idx += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const { file, pageRange } = items[idx];
    const src = await loadPdfLibStrict(file);
    const total = src.getPageCount();
    const { pages } = pageRange?.trim()
      ? parsePageRange(pageRange, total)
      : { pages: Array.from({ length: total }, (_, i) => i + 1) };

    if (pages.length > 0) {
      const copied = await merged.copyPages(
        src,
        pages.map((p) => p - 1)
      );
      for (const p of copied) merged.addPage(p);
    }
    onProgress?.(Math.round(((idx + 1) / items.length) * 90));
  }

  const outBytes = await merged.save({ useObjectStreams: true });
  onProgress?.(100);
  const baseName = sanitizeFilenameStem(items[0].file.name, 'merged');
  return makeResult(outBytes, `${baseName}-merged.pdf`, 'application/pdf', t0, {
    pageCount: merged.getPageCount(),
    summary: `Merged ${items.length} PDFs (${merged.getPageCount()} pages)`,
  });
}

export async function splitPdf(
  file: File,
  options:
    | { mode: 'pages-per-file'; pagesPerFile: number }
    | { mode: 'ranges'; rangeSpec: string; mergeRanges?: boolean }
    | { mode: 'max-size'; maxMb: number }
    | { mode: 'qr-divider' },
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<PdfProcessResult> {
  const t0 = performance.now();
  const src = await loadPdfLibStrict(file);
  const total = src.getPageCount();
  const stem = sanitizeFilenameStem(file.name, 'document');
  const zip = new JSZip();
  let partCount = 0;
  const warnings: string[] = [];

  const writeChunk = async (pageIndices: number[], partIdx: number) => {
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, pageIndices);
    for (const p of copied) out.addPage(p);
    const bytes = await out.save({ useObjectStreams: true });
    zip.file(`${stem}-part-${String(partIdx).padStart(3, '0')}.pdf`, bytes);
    return bytes;
  };

  if (options.mode === 'qr-divider') {
    const pdf = await loadPdfJsDocument(file);
    const dividerPages = new Set<number>();
    try {
      for (let i = 1; i <= pdf.numPages; i += 1) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const canvas = document.createElement('canvas');
        try {
          await renderPdfPageToCanvas(pdf, i, canvas, 1.35);
          const ctx = canvas.getContext('2d');
          if (ctx && canvas.width > 0 && canvas.height > 0) {
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imgData.data, canvas.width, canvas.height);
            if (code && code.data) {
              dividerPages.add(i);
            }
          }
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
        onProgress?.(Math.round((i / pdf.numPages) * 60));
      }
    } finally {
      await pdf.destroy().catch(() => {});
    }

    const groups: number[][] = [];
    let currentGroup: number[] = [];
    for (let p = 1; p <= total; p += 1) {
      if (dividerPages.has(p)) {
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
          currentGroup = [];
        }
      } else {
        currentGroup.push(p - 1);
      }
    }
    if (currentGroup.length > 0) groups.push(currentGroup);

    if (groups.length === 0) {
      throw new PdfToolError('Only QR divider pages were found; no content pages remain.', 'validation');
    }

    for (let i = 0; i < groups.length; i += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      partCount += 1;
      await writeChunk(groups[i], partCount);
      onProgress?.(60 + Math.round(((i + 1) / groups.length) * 35));
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    onProgress?.(100);
    return makeResult(zipBlob, `${stem}-qr-split-${partCount}-parts.zip`, 'application/zip', t0, {
      pageCount: total,
      summary:
        dividerPages.size > 0
          ? `Detected ${dividerPages.size} QR divider sheet(s) and split into ${partCount} PDF(s)`
          : `No QR divider sheets detected; packaged ${partCount} PDF`,
    });
  } else if (options.mode === 'pages-per-file') {
    const step = Math.max(1, Math.floor(options.pagesPerFile));
    const totalParts = Math.ceil(total / step);
    for (let start = 0; start < total; start += step) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      partCount += 1;
      const indices: number[] = [];
      for (let i = start; i < Math.min(total, start + step); i += 1) indices.push(i);
      await writeChunk(indices, partCount);
      onProgress?.(Math.round((partCount / totalParts) * 90));
    }
  } else if (options.mode === 'ranges') {
    const groups = parseSplitGroups(options.rangeSpec, total);
    if (groups.length === 0) {
      throw new PdfToolError(
        'Enter valid page groups separated by semicolons (e.g. "1-3; 4-6; 7-last").',
        'validation'
      );
    }
    if (options.mergeRanges) {
      const flat = groups.flat().map((p) => p - 1);
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, flat);
      for (const p of copied) out.addPage(p);
      const bytes = await out.save({ useObjectStreams: true });
      onProgress?.(100);
      return makeResult(bytes, `${stem}-extracted-ranges.pdf`, 'application/pdf', t0, {
        pageCount: flat.length,
        summary: `Combined ${groups.length} range(s) into ${flat.length}-page PDF`,
      });
    }
    for (let i = 0; i < groups.length; i += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      partCount += 1;
      await writeChunk(
        groups[i].map((p) => p - 1),
        partCount
      );
      onProgress?.(Math.round(((i + 1) / groups.length) * 90));
    }
  } else {
    const maxBytes = Math.max(100_000, Math.round(options.maxMb * 1024 * 1024));
    let cursor = 0;
    while (cursor < total) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      let lo = cursor;
      let hi = total - 1;
      let bestEnd = cursor;

      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const testDoc = await PDFDocument.create();
        const slice: number[] = [];
        for (let k = cursor; k <= mid; k += 1) slice.push(k);
        const copied = await testDoc.copyPages(src, slice);
        for (const p of copied) testDoc.addPage(p);
        const testBytes = await testDoc.save({ useObjectStreams: true });

        if (testBytes.length <= maxBytes) {
          bestEnd = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }

      partCount += 1;
      const chunkIndices: number[] = [];
      for (let k = cursor; k <= bestEnd; k += 1) chunkIndices.push(k);
      const written = await writeChunk(chunkIndices, partCount);
      if (chunkIndices.length === 1 && written.length > maxBytes) {
        warnings.push(
          `Page ${cursor + 1} alone is ${(written.length / (1024 * 1024)).toFixed(2)} MB, exceeding the ${options.maxMb} MB target.`
        );
      }
      cursor = bestEnd + 1;
      onProgress?.(Math.round((cursor / total) * 90));
    }
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  onProgress?.(100);
  return makeResult(zipBlob, `${stem}-split-${partCount}-parts.zip`, 'application/zip', t0, {
    pageCount: total,
    summary: `Split ${total} pages into ${partCount} PDF files`,
    ...(warnings.length > 0 ? { warnings } : {}),
  });
}

export async function extractPagesFromPdf(
  file: File,
  selectedPages: number[],
  separateFiles = false,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<PdfProcessResult> {
  const t0 = performance.now();
  const src = await loadPdfLibStrict(file);
  const total = src.getPageCount();
  const valid = selectedPages.filter((p) => p >= 1 && p <= total);
  if (valid.length === 0) {
    throw new PdfToolError('Select at least one valid page to extract.', 'validation');
  }
  const stem = sanitizeFilenameStem(file.name, 'document');

  if (separateFiles) {
    const zip = new JSZip();
    for (let i = 0; i < valid.length; i += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const pNo = valid[i];
      const out = await PDFDocument.create();
      const [copied] = await out.copyPages(src, [pNo - 1]);
      out.addPage(copied);
      const bytes = await out.save({ useObjectStreams: true });
      zip.file(`${stem}-page-${String(pNo).padStart(3, '0')}.pdf`, bytes);
      onProgress?.(Math.round(((i + 1) / valid.length) * 90));
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    onProgress?.(100);
    return makeResult(zipBlob, `${stem}-extracted-pages.zip`, 'application/zip', t0, {
      pageCount: valid.length,
      summary: `Extracted ${valid.length} page(s) as separate PDFs`,
    });
  }

  const out = await PDFDocument.create();
  const copied = await out.copyPages(
    src,
    valid.map((p) => p - 1)
  );
  for (const p of copied) out.addPage(p);
  const bytes = await out.save({ useObjectStreams: true });
  onProgress?.(100);
  return makeResult(bytes, `${stem}-extracted.pdf`, 'application/pdf', t0, {
    pageCount: valid.length,
    summary: `Extracted ${valid.length} of ${total} pages`,
  });
}

export async function deletePagesFromPdf(
  file: File,
  pagesToDelete: number[],
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<PdfProcessResult> {
  const t0 = performance.now();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const src = await loadPdfLibStrict(file);
  const total = src.getPageCount();
  const removeSet = new Set(pagesToDelete);
  const keepIndices: number[] = [];
  for (let i = 1; i <= total; i += 1) {
    if (!removeSet.has(i)) keepIndices.push(i - 1);
  }
  if (keepIndices.length === 0) {
    throw new PdfToolError('Cannot delete every page in the document.', 'validation');
  }
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, keepIndices);
  for (const p of copied) out.addPage(p);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const bytes = await out.save({ useObjectStreams: true });
  onProgress?.(100);
  const stem = sanitizeFilenameStem(file.name, 'document');
  return makeResult(bytes, `${stem}-trimmed.pdf`, 'application/pdf', t0, {
    pageCount: keepIndices.length,
    summary: `Removed ${total - keepIndices.length} page(s); ${keepIndices.length} remaining`,
  });
}

export async function reorderPdfPages(
  file: File,
  newOrderOneBased: number[],
  rotationsByIndex: Record<number, number> = {},
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<PdfProcessResult> {
  const t0 = performance.now();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const src = await loadPdfLibStrict(file);
  const total = src.getPageCount();
  const valid = newOrderOneBased.filter((p) => p >= 1 && p <= total);
  if (valid.length === 0) {
    throw new PdfToolError('Page order cannot be empty.', 'validation');
  }
  const out = await PDFDocument.create();
  const copied = await out.copyPages(
    src,
    valid.map((p) => p - 1)
  );
  copied.forEach((p, idx) => {
    const delta = rotationsByIndex[idx] || 0;
    if (delta !== 0) {
      const cur = p.getRotation().angle || 0;
      p.setRotation(degrees((cur + delta + 360) % 360));
    }
    out.addPage(p);
  });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const bytes = await out.save({ useObjectStreams: true });
  onProgress?.(100);
  const stem = sanitizeFilenameStem(file.name, 'document');
  return makeResult(bytes, `${stem}-reordered.pdf`, 'application/pdf', t0, {
    pageCount: valid.length,
    summary: `Saved ${valid.length} reordered pages`,
  });
}

export async function rotatePdfPages(
  file: File,
  rotationsByPage: Record<number, number>,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<PdfProcessResult> {
  const t0 = performance.now();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const doc = await loadPdfLibStrict(file);
  const pages = doc.getPages();
  let rotatedCount = 0;

  pages.forEach((page, idx) => {
    const delta = rotationsByPage[idx + 1] || 0;
    if (delta !== 0) {
      const current = page.getRotation().angle || 0;
      page.setRotation(degrees((current + delta + 360) % 360));
      rotatedCount += 1;
    }
  });

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const bytes = await doc.save({ useObjectStreams: true });
  onProgress?.(100);
  const stem = sanitizeFilenameStem(file.name, 'document');
  return makeResult(bytes, `${stem}-rotated.pdf`, 'application/pdf', t0, {
    pageCount: pages.length,
    summary: `Rotated ${rotatedCount} of ${pages.length} pages`,
  });
}

export async function cropPdfPages(
  file: File,
  marginsPct: { top: number; right: number; bottom: number; left: number },
  targetPages?: number[],
  onProgress?: (pct: number) => void,
  options?: {
    permanentRemoveOutside?: boolean;
    perPageMargins?: Record<number, { top: number; right: number; bottom: number; left: number }>;
    signal?: AbortSignal;
  }
): Promise<PdfProcessResult> {
  const t0 = performance.now();
  if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const doc = await loadPdfLibStrict(file);
  const pages = doc.getPages();
  const targetSet = targetPages?.length ? new Set(targetPages) : null;

  const normalizeMargins = (m: { top: number; right: number; bottom: number; left: number }) => {
    const top = Math.max(0, Math.min(45, m.top)) / 100;
    const right = Math.max(0, Math.min(45, m.right)) / 100;
    const bottom = Math.max(0, Math.min(45, m.bottom)) / 100;
    const left = Math.max(0, Math.min(45, m.left)) / 100;
    if (left + right >= 0.9 || top + bottom >= 0.9) {
      throw new PdfToolError('Crop margins cannot exceed 90% of page width or height.', 'validation');
    }
    return { top, right, bottom, left };
  };

  const defaultM = normalizeMargins(marginsPct);
  let cropped = 0;

  if (options?.permanentRemoveOutside) {
    // Physical content removal outside crop area via high-DPI clipped rasterization
    const pdf = await loadPdfJsDocument(file);
    const out = await PDFDocument.create();
    try {
      for (let i = 1; i <= pdf.numPages; i += 1) {
        if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const pageNo = i;
        const shouldCrop = !targetSet || targetSet.has(pageNo);
        const m = shouldCrop
          ? normalizeMargins(options.perPageMargins?.[pageNo] || marginsPct)
          : { top: 0, right: 0, bottom: 0, left: 0 };

        const p = await pdf.getPage(pageNo);
        const vp = p.getViewport({ scale: 1 });
        p.cleanup();

        const canvas = document.createElement('canvas');
        try {
          const scale = 2.083; // ~150 DPI crisp visual crop
          await renderPdfPageToCanvas(pdf, pageNo, canvas, scale);
          const sx = Math.round(canvas.width * m.left);
          const sy = Math.round(canvas.height * m.top);
          const sw = Math.max(8, Math.round(canvas.width * (1 - m.left - m.right)));
          const sh = Math.max(8, Math.round(canvas.height * (1 - m.top - m.bottom)));

          const croppedCanvas = document.createElement('canvas');
          croppedCanvas.width = sw;
          croppedCanvas.height = sh;
          const cctx = croppedCanvas.getContext('2d');
          if (cctx) {
            cctx.fillStyle = '#ffffff';
            cctx.fillRect(0, 0, sw, sh);
            cctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
          }
          const jpgBlob = await new Promise<Blob | null>((r) =>
            croppedCanvas.toBlob(r, 'image/jpeg', 0.92)
          );
          croppedCanvas.width = 0;
          croppedCanvas.height = 0;
          if (!jpgBlob) throw new Error('Failed to crop page image.');
          const img = await out.embedJpg(await jpgBlob.arrayBuffer());
          const outW = Math.max(10, vp.width * (1 - m.left - m.right));
          const outH = Math.max(10, vp.height * (1 - m.top - m.bottom));
          const outPage = out.addPage([outW, outH]);
          outPage.drawImage(img, { x: 0, y: 0, width: outW, height: outH });
          if (shouldCrop) cropped += 1;
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
        onProgress?.(Math.round((i / pdf.numPages) * 92));
      }
      const bytes = await out.save({ useObjectStreams: true });
      onProgress?.(100);
      const stem = sanitizeFilenameStem(file.name, 'document');
      return makeResult(bytes, `${stem}-cropped-purged.pdf`, 'application/pdf', t0, {
        pageCount: pdf.numPages,
        summary: `Permanently cropped & purged outside-margin content on ${cropped} page(s)`,
      });
    } finally {
      await pdf.destroy().catch(() => {});
    }
  }

  pages.forEach((page, idx) => {
    const pageNo = idx + 1;
    if (targetSet && !targetSet.has(pageNo)) return;
    const m = options?.perPageMargins?.[pageNo]
      ? normalizeMargins(options.perPageMargins[pageNo])
      : defaultM;
    const box = page.getCropBox() || page.getMediaBox();
    const rot = (((page.getRotation().angle || 0) % 360) + 360) % 360;
    let l = m.left;
    let r = m.right;
    let t = m.top;
    let b = m.bottom;
    if (rot === 90) {
      [t, r, b, l] = [m.left, m.top, m.right, m.bottom];
    } else if (rot === 180) {
      [t, r, b, l] = [m.bottom, m.left, m.top, m.right];
    } else if (rot === 270) {
      [t, r, b, l] = [m.right, m.bottom, m.left, m.top];
    }
    const nx = box.x + box.width * l;
    const ny = box.y + box.height * b;
    const nw = Math.max(10, box.width * (1 - l - r));
    const nh = Math.max(10, box.height * (1 - t - b));
    page.setCropBox(nx, ny, nw, nh);
    page.setTrimBox(nx, ny, nw, nh);
    cropped += 1;
  });

  const bytes = await doc.save({ useObjectStreams: true });
  onProgress?.(100);
  const stem = sanitizeFilenameStem(file.name, 'document');
  return makeResult(bytes, `${stem}-cropped.pdf`, 'application/pdf', t0, {
    pageCount: pages.length,
    summary: `Vector-cropped ${cropped} page(s) (CropBox & TrimBox)`,
  });
}

export async function addWatermarkToPdf(
  file: File,
  opts: {
    kind?: 'text' | 'image' | 'qr';
    text?: string;
    qrText?: string;
    imageDataUrl?: string;
    fontSize: number;
    fontFamily?: PdfStandardFontChoice;
    opacity: number;
    rotation: number;
    color: string;
    layout: GridPosition9;
    layer?: 'above' | 'behind';
    pageRange?: string;
  },
  onProgress?: (pct: number) => void
): Promise<PdfProcessResult> {
  const kind = opts.kind || 'text';
  const rawText = opts.text || '';
  const qrPayload = (opts.qrText ?? rawText).trim();
  if (kind === 'text' && !rawText.trim()) {
    throw new PdfToolError('Enter watermark text.', 'validation');
  }
  if (kind === 'image' && !opts.imageDataUrl) {
    throw new PdfToolError('Upload a watermark image.', 'validation');
  }
  if (kind === 'qr' && !qrPayload) {
    throw new PdfToolError('Enter QR code text or URL.', 'validation');
  }

  const t0 = performance.now();
  const doc = await loadPdfLibStrict(file);
  const font = await embedChoiceFont(doc, opts.fontFamily || 'helvetica', true);
  const colorVal = hexToRgb(opts.color);
  const pages = doc.getPages();
  const total = pages.length;
  const targetPagesList = opts.pageRange?.trim()
    ? (() => {
        const parsed = parsePageRange(opts.pageRange, total);
        if (parsed.invalidTokens.length > 0 && parsed.pages.length === 0) {
          throw new PdfToolError(`Invalid page range: ${parsed.invalidTokens.join(', ')}`, 'validation');
        }
        return parsed.pages;
      })()
    : Array.from({ length: total }, (_, i) => i + 1);
  const targetSet = new Set(targetPagesList);
  const behind = opts.layer === 'behind';

  let embeddedImg: Awaited<ReturnType<PDFDocument['embedPng']>> | null = null;
  if (kind === 'image' && opts.imageDataUrl) {
    const buf = await (await fetch(opts.imageDataUrl)).arrayBuffer();
    embeddedImg = opts.imageDataUrl.includes('image/jpeg')
      ? await doc.embedJpg(buf)
      : await doc.embedPng(buf);
  }

  const qrMatrix = kind === 'qr' ? QRCode.create(qrPayload, { errorCorrectionLevel: 'M' }) : null;

  const resolveAnchor = (pw: number, ph: number, elemW: number, elemH: number, pos: GridPosition9) => {
    const pad = 28;
    const xMap = {
      left: pad,
      center: pw / 2 - elemW / 2,
      right: Math.max(pad, pw - elemW - pad),
    };
    const yMap = {
      top: Math.max(pad, ph - elemH - pad),
      center: ph / 2 - elemH / 2,
      bottom: pad,
    };
    const [v, h] = pos === 'center' ? ['center', 'center'] : pos.split('-');
    return {
      x: xMap[(h as 'left' | 'center' | 'right') || 'center'],
      y: yMap[(v as 'top' | 'center' | 'bottom') || 'center'],
    };
  };

  const drawVectorQrStamp = (page: PDFPage, bottomLeftX: number, bottomLeftY: number, boxSize: number) => {
    if (!qrMatrix) return;
    const count = qrMatrix.modules.size;
    const quiet = 2;
    const totalCols = count + quiet * 2;
    const modSize = boxSize / totalCols;
    const cx = bottomLeftX + boxSize / 2;
    const cy = bottomLeftY + boxSize / 2;
    const rad = (opts.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const rotPt = (lx: number, ly: number) => ({
      x: cx + lx * cos - ly * sin,
      y: cy + lx * sin + ly * cos,
    });

    const bgCorner = rotPt(-boxSize / 2, -boxSize / 2);
    page.drawRectangle({
      x: bgCorner.x,
      y: bgCorner.y,
      width: boxSize,
      height: boxSize,
      color: rgb(1, 1, 1),
      opacity: opts.opacity,
      rotate: degrees(opts.rotation),
    });

    for (let r = 0; r < count; r += 1) {
      for (let c = 0; c < count; c += 1) {
        if (!qrMatrix.modules.get(r, c)) continue;
        const lx = -boxSize / 2 + (c + quiet) * modSize;
        const ly = boxSize / 2 - (r + quiet + 1) * modSize;
        const pt = rotPt(lx, ly);
        page.drawRectangle({
          x: pt.x,
          y: pt.y,
          width: modSize,
          height: modSize,
          color: colorVal,
          opacity: opts.opacity,
          rotate: degrees(opts.rotation),
        });
      }
    }
  };

  pages.forEach((page, idx) => {
    if (!targetSet.has(idx + 1)) return;
    const box = page.getCropBox() || page.getMediaBox();
    const width = box.width;
    const height = box.height;
    const ox = box.x;
    const oy = box.y;

    let beforeSize = 0;
    if (behind) {
      page.node.normalize();
      page.resetPosition();
      const contents = page.node.Contents();
      beforeSize = contents instanceof PDFArray ? contents.size() : 0;
    }

    if (kind === 'image' && embeddedImg) {
      const targetW = Math.min(width * 0.45, Math.max(60, opts.fontSize * 3));
      const targetH = targetW * (embeddedImg.height / Math.max(1, embeddedImg.width));
      if (opts.layout === 'tiled') {
        const stepX = targetW + 64;
        const stepY = targetH + 64;
        let row = 0;
        for (let y = -targetH * 0.3; y < height + targetH * 0.3; y += stepY) {
          const offsetX = row % 2 === 1 ? stepX * 0.45 : 0;
          for (let x = -targetW * 0.3 + offsetX; x < width + targetW * 0.3; x += stepX) {
            page.drawImage(embeddedImg, {
              x: ox + x,
              y: oy + y,
              width: targetW,
              height: targetH,
              opacity: opts.opacity,
              rotate: degrees(opts.rotation),
            });
          }
          row += 1;
        }
      } else {
        const pt = resolveAnchor(width, height, targetW, targetH, opts.layout);
        page.drawImage(embeddedImg, {
          x: ox + pt.x,
          y: oy + pt.y,
          width: targetW,
          height: targetH,
          opacity: opts.opacity,
          rotate: degrees(opts.rotation),
        });
      }
    } else if (kind === 'qr' && qrMatrix) {
      const targetSize = Math.min(width * 0.42, Math.max(54, opts.fontSize * 2.2));
      if (opts.layout === 'tiled') {
        const step = targetSize + 64;
        let row = 0;
        for (let y = 12; y < height; y += step) {
          const offsetX = row % 2 === 1 ? step * 0.45 : 0;
          for (let x = 12 + offsetX; x < width; x += step) {
            drawVectorQrStamp(page, ox + x, oy + y, targetSize);
          }
          row += 1;
        }
      } else {
        const pt = resolveAnchor(width, height, targetSize, targetSize, opts.layout);
        drawVectorQrStamp(page, ox + pt.x, oy + pt.y, targetSize);
      }
    } else {
      const safeText = sanitizeWinAnsi(rawText);
      const tw = font.widthOfTextAtSize(safeText, opts.fontSize);
      if (opts.layout === 'tiled') {
        const stepX = Math.max(130, tw + 60);
        const stepY = Math.max(105, opts.fontSize * 2.8);
        let row = 0;
        for (let y = -20; y < height + 40; y += stepY) {
          const offsetX = row % 2 === 1 ? stepX * 0.45 : 0;
          for (let x = -40 + offsetX; x < width + 40; x += stepX) {
            page.drawText(safeText, {
              x: ox + x,
              y: oy + y,
              size: opts.fontSize,
              font,
              color: colorVal,
              opacity: opts.opacity,
              rotate: degrees(opts.rotation),
            });
          }
          row += 1;
        }
      } else if (opts.layout === 'center') {
        const rad = (opts.rotation * Math.PI) / 180;
        const cx = ox + width / 2 - (tw / 2) * Math.cos(rad) + (opts.fontSize * 0.32) * Math.sin(rad);
        const cy = oy + height / 2 - (tw / 2) * Math.sin(rad) - (opts.fontSize * 0.32) * Math.cos(rad);
        page.drawText(safeText, {
          x: cx,
          y: cy,
          size: opts.fontSize,
          font,
          color: colorVal,
          opacity: opts.opacity,
          rotate: degrees(opts.rotation),
        });
      } else {
        const pt = resolveAnchor(width, height, tw, opts.fontSize, opts.layout);
        page.drawText(safeText, {
          x: ox + pt.x,
          y: oy + pt.y,
          size: opts.fontSize,
          font,
          color: colorVal,
          opacity: opts.opacity,
          rotate: degrees(opts.rotation),
        });
      }
    }

    if (behind) {
      const contents = page.node.Contents();
      if (contents instanceof PDFArray && contents.size() > 1 && beforeSize > 0) {
        const wmRef = contents.get(contents.size() - 1);
        contents.remove(contents.size() - 1);
        contents.insert(0, wmRef);
      }
      page.resetPosition();
    }
  });

  const bytes = await doc.save({ useObjectStreams: true });
  onProgress?.(100);
  const stem = sanitizeFilenameStem(file.name, 'document');
  return makeResult(bytes, `${stem}-watermarked.pdf`, 'application/pdf', t0, {
    pageCount: total,
    summary: `Applied ${kind === 'qr' ? 'QR ' : ''}watermark ${behind ? 'behind' : 'above'} content across ${targetSet.size} page(s)`,
  });
}

export async function addPageNumbersToPdf(
  file: File,
  opts: {
    format: string;
    position: 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right' | 'top-left';
    fontSize: number;
    fontFamily?: PdfStandardFontChoice;
    startNumber: number;
    marginPt: number;
    color: string;
    pageRange?: string;
    numberStyle?: 'arabic' | 'roman-upper' | 'roman-lower';
    facingPages?: boolean;
    firstPageIsCover?: boolean;
    autoExpandMargins?: boolean;
  },
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<PdfProcessResult> {
  const t0 = performance.now();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const doc = await loadPdfLibStrict(file);
  const font = await embedChoiceFont(doc, opts.fontFamily || 'helvetica');
  const colorVal = hexToRgb(opts.color);
  const pages = doc.getPages();
  const total = pages.length;
  const targetSet = opts.pageRange?.trim()
    ? new Set(parsePageRange(opts.pageRange, total).pages)
    : null;
  const style = opts.numberStyle || 'arabic';
  const formatNum = (n: number) =>
    style === 'roman-upper'
      ? toRoman(n)
      : style === 'roman-lower'
      ? toRoman(n).toLowerCase()
      : String(n);

  let seq = 0;
  pages.forEach((page, idx) => {
    const pageNo = idx + 1;
    if (opts.firstPageIsCover && pageNo === 1) return;
    if (targetSet && !targetSet.has(pageNo)) return;
    seq += 1;

    const isTop = opts.position.startsWith('top');
    const pad = opts.autoExpandMargins ? 28 : 0;
    const rot = (((page.getRotation().angle || 0) % 360) + 360) % 360;
    if (pad > 0) {
      if (rot === 0) expandPageVerticalMargins(page, isTop ? pad : 0, isTop ? 0 : pad);
      else {
        const mb = page.getMediaBox();
        if (rot === 90) page.setMediaBox(mb.x - (isTop ? 0 : pad), mb.y, mb.width + pad, mb.height);
        else if (rot === 180) expandPageVerticalMargins(page, isTop ? 0 : pad, isTop ? pad : 0);
        else if (rot === 270) page.setMediaBox(mb.x - (isTop ? pad : 0), mb.y, mb.width + pad, mb.height);
      }
    }

    const box = page.getCropBox() || page.getMediaBox();
    const visW = rot % 180 === 90 ? box.height : box.width;
    const visH = rot % 180 === 90 ? box.width : box.height;
    const displayNum = opts.startNumber + seq - 1;
    const totalNumbered = targetSet
      ? targetSet.size - (opts.firstPageIsCover && targetSet.has(1) ? 1 : 0)
      : opts.firstPageIsCover
      ? Math.max(1, total - 1)
      : total;
    const rawLabel = opts.format
      .replace(/\{n\}|\[PAGE_NO\]/g, formatNum(displayNum))
      .replace(/\{total\}|\[TOTAL_PAGES\]/g, formatNum(Math.max(1, totalNumbered)));
    const label = sanitizeWinAnsi(rawLabel);
    const tw = font.widthOfTextAtSize(label, opts.fontSize);
    const m = Math.max(12, opts.marginPt);

    let effectivePos = opts.position;
    if (opts.facingPages && seq % 2 === 0) {
      if (effectivePos.endsWith('-left')) {
        effectivePos = effectivePos.replace('-left', '-right') as typeof effectivePos;
      } else if (effectivePos.endsWith('-right')) {
        effectivePos = effectivePos.replace('-right', '-left') as typeof effectivePos;
      }
    }

    let vx = visW / 2 - tw / 2;
    if (effectivePos.endsWith('left')) vx = m;
    else if (effectivePos.endsWith('right')) vx = Math.max(m, visW - tw - m);

    const vy = isTop
      ? pad > 0
        ? visH - pad + Math.max(6, (pad - opts.fontSize) / 2)
        : Math.max(m, visH - m - opts.fontSize)
      : pad > 0
      ? Math.max(6, (pad - opts.fontSize) / 2)
      : m;

    let px = box.x + vx;
    let py = box.y + vy;
    if (rot === 90) {
      px = box.x + (box.width - vy);
      py = box.y + vx;
    } else if (rot === 180) {
      px = box.x + (box.width - vx);
      py = box.y + (box.height - vy);
    } else if (rot === 270) {
      px = box.x + vy;
      py = box.y + (box.height - vx);
    }

    page.drawText(label, {
      x: px,
      y: py,
      size: opts.fontSize,
      font,
      color: colorVal,
      rotate: degrees(rot),
    });
  });

  const bytes = await doc.save({ useObjectStreams: true });
  onProgress?.(100);
  const stem = sanitizeFilenameStem(file.name, 'document');
  return makeResult(bytes, `${stem}-numbered.pdf`, 'application/pdf', t0, {
    pageCount: total,
    summary: `Added page numbers to ${seq} page(s)`,
  });
}

export async function addHeaderFooterToPdf(
  file: File,
  opts: {
    headerLeft?: string;
    headerCenter?: string;
    headerRight?: string;
    footerLeft?: string;
    footerCenter?: string;
    footerRight?: string;
    /** Legacy single-field compatibility */
    headerText?: string;
    footerText?: string;
    align?: 'left' | 'center' | 'right';
    fontSize: number;
    fontFamily?: PdfStandardFontChoice;
    color: string;
    marginPt: number;
    skipFirstPage?: boolean;
    sourceFileName?: string;
    increaseMargins?: boolean;
    batesStartOffset?: number;
  },
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<PdfProcessResult & { nextBatesOffset?: number }> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const hLeft = opts.headerLeft ?? (opts.align === 'left' ? opts.headerText : '') ?? '';
  const hCenter = opts.headerCenter ?? (opts.align !== 'left' && opts.align !== 'right' ? opts.headerText : '') ?? '';
  const hRight = opts.headerRight ?? (opts.align === 'right' ? opts.headerText : '') ?? '';
  const fLeft = opts.footerLeft ?? (opts.align === 'left' ? opts.footerText : '') ?? '';
  const fCenter = opts.footerCenter ?? (opts.align !== 'left' && opts.align !== 'right' ? opts.footerText : '') ?? '';
  const fRight = opts.footerRight ?? (opts.align === 'right' ? opts.footerText : '') ?? '';

  if (![hLeft, hCenter, hRight, fLeft, fCenter, fRight].some((s) => s.trim().length > 0)) {
    throw new PdfToolError('Enter text in at least one header or footer column.', 'validation');
  }

  const t0 = performance.now();
  const doc = await loadPdfLibStrict(file);
  const font = await embedChoiceFont(doc, opts.fontFamily || 'helvetica');
  const colorVal = hexToRgb(opts.color);
  const pages = doc.getPages();
  const total = pages.length;
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileNameStr = opts.sourceFileName || file.name;
  const titleStr = doc.getTitle() || sanitizeFilenameStem(fileNameStr, 'Document');
  const m = Math.max(14, opts.marginPt);
  const hasHeader = [hLeft, hCenter, hRight].some((s) => s.trim().length > 0);
  const hasFooter = [fLeft, fCenter, fRight].some((s) => s.trim().length > 0);
  const extraPad = opts.increaseMargins ? Math.max(28, opts.fontSize + 18) : 0;

  let batesSeq = opts.batesStartOffset ?? 0;
  let appliedPages = 0;
  pages.forEach((page, idx) => {
    if (opts.skipFirstPage && idx === 0) return;
    const rot = (((page.getRotation().angle || 0) % 360) + 360) % 360;
    if (extraPad > 0) {
      if (rot === 0) expandPageVerticalMargins(page, hasHeader ? extraPad : 0, hasFooter ? extraPad : 0);
      else if (rot === 180) expandPageVerticalMargins(page, hasFooter ? extraPad : 0, hasHeader ? extraPad : 0);
    }

    const box = page.getCropBox() || page.getMediaBox();
    const visW = rot % 180 === 90 ? box.height : box.width;
    const visH = rot % 180 === 90 ? box.width : box.height;
    const seqForPage = batesSeq;
    batesSeq += 1;
    appliedPages += 1;

    const fmt = (tpl: string) =>
      sanitizeWinAnsi(
        tpl
          .replace(/\{bates:([^:}]*):(\d+)\}/g, (_match, prefix: string, digits: string) => {
            const parsedStart = Number.parseInt(digits, 10);
            const startNum = Number.isFinite(parsedStart) ? parsedStart : 1;
            return `${prefix}${String(startNum + seqForPage).padStart(digits.length, '0')}`;
          })
          .replace(/\{n\}|\[PAGE_NO\]/g, String(idx + 1))
          .replace(/\{total\}|\[TOTAL_PAGES\]/g, String(total))
          .replace(/\{date\}|\[DATE\]/g, dateStr)
          .replace(/\{title\}|\[TITLE\]/g, titleStr)
          .replace(/\{filename\}|\[FILENAME\]/g, fileNameStr)
      );

    const slotMaxW = Math.max(40, (visW - m * 2) * 0.31);
    const fitToSlot = (txt: string) => {
      let cur = txt;
      while (cur.length > 4 && font.widthOfTextAtSize(cur, opts.fontSize) > slotMaxW) {
        cur = `${cur.slice(0, -2)}…`;
      }
      return cur;
    };

    const drawSlot = (tpl: string, slot: 'left' | 'center' | 'right', vy: number) => {
      const rawTxt = fmt(tpl).trim();
      if (!rawTxt) return;
      const txt = fitToSlot(rawTxt);
      const tw = font.widthOfTextAtSize(txt, opts.fontSize);
      const vx =
        slot === 'left'
          ? m
          : slot === 'right'
          ? Math.max(m, visW - tw - m)
          : visW / 2 - tw / 2;

      let px = box.x + vx;
      let py = box.y + vy;
      if (rot === 90) {
        px = box.x + (box.width - vy);
        py = box.y + vx;
      } else if (rot === 180) {
        px = box.x + (box.width - vx);
        py = box.y + (box.height - vy);
      } else if (rot === 270) {
        px = box.x + vy;
        py = box.y + (box.height - vx);
      }
      page.drawText(txt, { x: px, y: py, size: opts.fontSize, font, color: colorVal, rotate: degrees(rot) });
    };

    const topY =
      extraPad > 0 && hasHeader
        ? visH - extraPad + Math.max(6, (extraPad - opts.fontSize) / 2)
        : Math.max(m, visH - m - opts.fontSize);
    const botY =
      extraPad > 0 && hasFooter
        ? Math.max(6, (extraPad - opts.fontSize) / 2)
        : m;

    drawSlot(hLeft, 'left', topY);
    drawSlot(hCenter, 'center', topY);
    drawSlot(hRight, 'right', topY);
    drawSlot(fLeft, 'left', botY);
    drawSlot(fCenter, 'center', botY);
    drawSlot(fRight, 'right', botY);
  });

  const bytes = await doc.save({ useObjectStreams: true });
  onProgress?.(100);
  const stem = sanitizeFilenameStem(file.name, 'document');
  return {
    ...makeResult(bytes, `${stem}-header-footer.pdf`, 'application/pdf', t0, {
      pageCount: total,
      summary: `Applied 3-column header/footer across ${appliedPages} page(s)`,
    }),
    nextBatesOffset: batesSeq,
  };
}

export async function flattenPdf(
  file: File,
  mode: 'structural' | 'raster' = 'structural',
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<PdfProcessResult> {
  const t0 = performance.now();
  const stem = sanitizeFilenameStem(file.name, 'document');

  if (mode === 'structural') {
    const doc = await loadPdfLibStrict(file);
    try {
      doc.getForm().flatten();
    } catch {
      // No AcroForm dictionary
    }
    const bytes = await doc.save({ useObjectStreams: true });
    onProgress?.(100);
    return makeResult(bytes, `${stem}-flattened.pdf`, 'application/pdf', t0, {
      pageCount: doc.getPageCount(),
      summary: 'Flattened interactive form fields into static PDF layers',
    });
  }

  const pdf = await loadPdfJsDocument(file);
  const out = await PDFDocument.create();
  try {
    for (let i = 1; i <= pdf.numPages; i += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      page.cleanup();
      const { blob } = await renderPdfPageToBlob(pdf, i, {
        scale: 2,
        format: 'jpeg',
        quality: 0.92,
      });
      const jpgBytes = new Uint8Array(await blob.arrayBuffer());
      const img = await out.embedJpg(jpgBytes);
      const outPage = out.addPage([vp.width, vp.height]);
      outPage.drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
      onProgress?.(Math.round((i / pdf.numPages) * 90));
    }
    const bytes = await out.save({ useObjectStreams: true });
    onProgress?.(100);
    return makeResult(bytes, `${stem}-visual-flattened.pdf`, 'application/pdf', t0, {
      pageCount: pdf.numPages,
      summary: `Visually flattened ${pdf.numPages} pages`,
    });
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

export async function repairPdfMultiEngine(
  file: File,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<PdfProcessResult> {
  const t0 = performance.now();
  let rawBytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
  const stem = sanitizeFilenameStem(file.name, 'document');
  onProgress?.(15);

  // Strip leading non-PDF garbage bytes before %PDF- header if present
  const headText = new TextDecoder('latin1').decode(rawBytes.slice(0, Math.min(2048, rawBytes.length)));
  const headerIdx = headText.indexOf('%PDF-');
  if (headerIdx > 0) {
    rawBytes = rawBytes.slice(headerIdx);
  }

  try {
    const repaired = await repairWithQpdf(rawBytes);
    const verify = await PDFDocument.load(repaired, { ignoreEncryption: true });
    onProgress?.(100);
    return makeResult(repaired, `${stem}-repaired.pdf`, 'application/pdf', t0, {
      pageCount: verify.getPageCount(),
      summary: 'Stage 1 (QPDF): Rebuilt cross-reference table and object streams',
    });
  } catch {
    // Stage 2 fallback
  }
  onProgress?.(45);

  try {
    const doc = await PDFDocument.load(rawBytes);
    const bytes = await doc.save({ useObjectStreams: false });
    onProgress?.(100);
    return makeResult(bytes, `${stem}-repaired.pdf`, 'application/pdf', t0, {
      pageCount: doc.getPageCount(),
      summary: 'Stage 2 (pdf-lib): Rebuilt PDF catalog & xref structure',
    });
  } catch {
    // Stage 3 fallback
  }
  onProgress?.(65);

  const pdf = await loadPdfJsDocument(rawBytes);
  const out = await PDFDocument.create();
  try {
    for (let i = 1; i <= pdf.numPages; i += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      page.cleanup();
      const { blob } = await renderPdfPageToBlob(pdf, i, {
        scale: 1.75,
        format: 'jpeg',
        quality: 0.92,
      });
      const jpg = await out.embedJpg(await blob.arrayBuffer());
      const p = out.addPage([vp.width, vp.height]);
      p.drawImage(jpg, { x: 0, y: 0, width: vp.width, height: vp.height });
      onProgress?.(65 + Math.round((i / pdf.numPages) * 35));
    }
    const bytes = await out.save({ useObjectStreams: true });
    return makeResult(bytes, `${stem}-reconstructed.pdf`, 'application/pdf', t0, {
      pageCount: pdf.numPages,
      summary: `Stage 3 (Visual Recovery): Reconstructed ${pdf.numPages} pages`,
      warnings: ['Document structure was severely damaged; pages were visually reconstructed.'],
    });
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

export async function getPdfMetadata(file: File): Promise<PdfMetadataValues> {
  const doc = await loadPdfLibStrict(file, true);
  return {
    title: doc.getTitle() || '',
    author: doc.getAuthor() || '',
    subject: doc.getSubject() || '',
    keywords: doc.getKeywords() || '',
    creator: doc.getCreator() || '',
    producer: doc.getProducer() || '',
    creationDate: doc.getCreationDate()?.toISOString(),
    modificationDate: doc.getModificationDate()?.toISOString(),
    pageCount: doc.getPageCount(),
    isEncrypted: doc.isEncrypted,
  };
}

/**
 * Super ToolKit Benchmark: Pre-scan hidden fingerprint audit before scrubbing.
 */
export async function inspectHiddenFingerprints(file: File): Promise<PdfFingerprintAudit> {
  const doc = await loadPdfLibStrict(file, true);
  const infoFields: Array<{ key: string; value: string }> = [];
  const seenInfoKeys = new Set<string>();
  const maybePush = (key: string, val: string | undefined) => {
    if (val && val.trim() && !seenInfoKeys.has(key)) {
      seenInfoKeys.add(key);
      infoFields.push({ key, value: val.trim() });
    }
  };

  maybePush('Title', doc.getTitle());
  maybePush('Author', doc.getAuthor());
  maybePush('Subject', doc.getSubject());
  maybePush('Keywords', doc.getKeywords());
  maybePush('Creator', doc.getCreator());
  maybePush('Producer', doc.getProducer());
  maybePush('CreationDate', doc.getCreationDate()?.toISOString());
  maybePush('ModDate', doc.getModificationDate()?.toISOString());

  // Inspect custom /Info dictionary entries
  const infoRef = doc.context.trailerInfo.Info;
  if (infoRef) {
    const infoDict = doc.context.lookup(infoRef);
    if (infoDict instanceof PDFDict) {
      for (const [k, v] of infoDict.entries()) {
        const keyName = k.decodeText();
        if (!seenInfoKeys.has(keyName)) {
          const valStr =
            v instanceof PDFString || v instanceof PDFHexString
              ? v.decodeText()
              : v?.toString() || '';
          maybePush(keyName, valStr);
        }
      }
    }
  }

  let hasXmpMetadata = doc.catalog.has(PDFName.of('Metadata'));
  const hasOpenAction = doc.catalog.has(PDFName.of('OpenAction'));
  const hasCatalogActions = doc.catalog.has(PDFName.of('AA'));

  let javaScriptCount = 0;
  let embeddedFilesCount = 0;
  const names = doc.catalog.lookup(PDFName.of('Names'));
  if (names && 'lookup' in names && typeof names.lookup === 'function') {
    const jsTree = names.lookup(PDFName.of('JavaScript'));
    if (jsTree instanceof PDFDict) {
      const nArr = jsTree.lookupMaybe(PDFName.of('Names'), PDFArray);
      javaScriptCount += nArr ? Math.max(1, Math.floor(nArr.size() / 2)) : 1;
    } else if (jsTree) {
      javaScriptCount += 1;
    }
    const efTree = names.lookup(PDFName.of('EmbeddedFiles'));
    if (efTree instanceof PDFDict) {
      const nArr = efTree.lookupMaybe(PDFName.of('Names'), PDFArray);
      embeddedFilesCount += nArr ? Math.max(1, Math.floor(nArr.size() / 2)) : 1;
    } else if (efTree) {
      embeddedFilesCount += 1;
    }
  }

  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj && 'has' in obj && typeof obj.has === 'function') {
      if (obj.has(PDFName.of('JS'))) {
        javaScriptCount += 1;
      }
      if (obj.has(PDFName.of('Subtype')) && (obj as PDFDict).lookup(PDFName.of('Subtype')) === PDFName.of('FileAttachment')) {
        embeddedFilesCount += 1;
      }
    }
  }

  let commentAnnotationsCount = 0;
  let formWidgetsCount = 0;
  let thumbnailCount = 0;
  let pieceInfoCount = 0;
  if (doc.catalog.has(PDFName.of('PieceInfo'))) pieceInfoCount += 1;

  for (const page of doc.getPages()) {
    if (page.node.has(PDFName.of('Thumb'))) thumbnailCount += 1;
    if (page.node.has(PDFName.of('PieceInfo'))) pieceInfoCount += 1;
    if (page.node.has(PDFName.of('Metadata'))) hasXmpMetadata = true;
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (annots && 'asArray' in annots && typeof annots.asArray === 'function') {
      for (const ref of annots.asArray()) {
        const dict = doc.context.lookup(ref);
        if (dict && 'lookup' in dict && typeof dict.lookup === 'function') {
          const st = dict.lookup(PDFName.of('Subtype'));
          if (st === PDFName.of('Widget')) formWidgetsCount += 1;
          else if (st !== PDFName.of('Link')) commentAnnotationsCount += 1;
        }
      }
    }
  }

  const totalFingerprints =
    infoFields.length +
    (hasXmpMetadata ? 1 : 0) +
    (hasOpenAction ? 1 : 0) +
    (hasCatalogActions ? 1 : 0) +
    javaScriptCount +
    embeddedFilesCount +
    commentAnnotationsCount +
    thumbnailCount +
    pieceInfoCount;

  return {
    infoFields,
    hasXmpMetadata,
    hasOpenAction,
    hasCatalogActions,
    javaScriptCount,
    embeddedFilesCount,
    commentAnnotationsCount,
    formWidgetsCount,
    thumbnailCount,
    pieceInfoCount,
    totalFingerprints,
  };
}

export async function setPdfMetadata(
  file: File,
  values: Partial<PdfMetadataValues>,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<PdfProcessResult> {
  const t0 = performance.now();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const doc = await loadPdfLibStrict(file);
  doc.setTitle(values.title ?? '');
  doc.setAuthor(values.author ?? '');
  doc.setSubject(values.subject ?? '');
  if (values.keywords !== undefined) {
    const kws = values.keywords
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    doc.setKeywords(kws);
  }
  doc.setCreator(values.creator ?? '');
  doc.setProducer(values.producer ?? '');
  if (values.creationDate) {
    const d = new Date(values.creationDate);
    if (!Number.isNaN(d.getTime())) doc.setCreationDate(d);
  }
  if (values.modificationDate) {
    const d = new Date(values.modificationDate);
    if (!Number.isNaN(d.getTime())) doc.setModificationDate(d);
  }
  // Remove stale XMP packet so readers don't display old Ghost metadata
  const xmpRef = doc.catalog.get(PDFName.of('Metadata'));
  if (xmpRef instanceof PDFRef) doc.context.delete(xmpRef);
  doc.catalog.delete(PDFName.of('Metadata'));

  const bytes = await doc.save({ useObjectStreams: true });
  onProgress?.(100);
  const stem = sanitizeFilenameStem(file.name, 'document');
  return makeResult(bytes, `${stem}-metadata.pdf`, 'application/pdf', t0, {
    pageCount: doc.getPageCount(),
    summary: 'Updated PDF document metadata & cleared stale XMP',
  });
}

function stripInfoAndCatalogExtras(doc: PDFDocument): string[] {
  const wiped: string[] = [];
  if (doc.getTitle()) wiped.push(`Info/Title: ${doc.getTitle()}`);
  if (doc.getAuthor()) wiped.push(`Info/Author: ${doc.getAuthor()}`);
  if (doc.getSubject()) wiped.push(`Info/Subject: ${doc.getSubject()}`);
  if (doc.getKeywords()) wiped.push(`Info/Keywords: ${doc.getKeywords()}`);
  if (doc.getCreator()) wiped.push(`Info/Creator: ${doc.getCreator()}`);
  if (doc.getProducer()) wiped.push(`Info/Producer: ${doc.getProducer()}`);

  doc.setTitle('');
  doc.setAuthor('');
  doc.setSubject('');
  doc.setKeywords([]);
  doc.setCreator('');
  doc.setProducer('');

  const infoRef = doc.context.trailerInfo.Info;
  if (infoRef) {
    const infoDict = doc.context.lookup(infoRef);
    if (infoDict instanceof PDFDict) {
      for (const [k] of infoDict.entries()) {
        const keyName = k.decodeText();
        if (!['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer'].includes(keyName)) {
          wiped.push(`Info/${keyName}`);
        }
        infoDict.delete(k);
      }
    }
    if (infoRef instanceof PDFRef) {
      doc.context.delete(infoRef);
    }
    delete (doc.context.trailerInfo as Record<string, unknown>).Info;
  }

  for (const key of ['Metadata', 'ViewerPreferences', 'PieceInfo']) {
    const val = doc.catalog.get(PDFName.of(key));
    if (val) {
      wiped.push(`Catalog/${key}`);
      if (val instanceof PDFRef) doc.context.delete(val);
      doc.catalog.delete(PDFName.of(key));
    }
  }

  for (const page of doc.getPages()) {
    for (const pKey of ['Thumb', 'PieceInfo', 'Metadata']) {
      const pVal = page.node.get(PDFName.of(pKey));
      if (pVal) {
        wiped.push(`Page/${pKey}`);
        if (pVal instanceof PDFRef) doc.context.delete(pVal);
        page.node.delete(PDFName.of(pKey));
      }
    }
  }

  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.lookup(PDFName.of('Subtype')) === PDFName.of('XML')) {
      doc.context.delete(ref);
    }
  }

  return wiped;
}

export async function removePdfMetadata(
  file: File,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<PdfProcessResult & { wipedFields?: string[] }> {
  const t0 = performance.now();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  await assertValidPdfFile(file);
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
  } catch (err) {
    throw classifyPdfError(err, file.name);
  }
  const wiped = stripInfoAndCatalogExtras(doc);
  const rawSaved = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
  const bytes = await purgeOrphanObjectsWithQpdf(rawSaved);
  onProgress?.(100);
  const stem = sanitizeFilenameStem(file.name, 'document');
  return {
    ...makeResult(bytes, `${stem}-no-metadata.pdf`, 'application/pdf', t0, {
      pageCount: doc.getPageCount(),
      summary:
        wiped.length > 0
          ? `Scrubbed ${wiped.length} metadata/XMP/thumbnail entries`
          : 'No hidden metadata found; verified clean copy',
    }),
    wipedFields: wiped,
  };
}

export async function removePdfAnnotations(
  file: File,
  keepFormWidgetsOrOpts:
    | boolean
    | {
        keepFormWidgets?: boolean;
        keepLinks?: boolean;
        subtypesToStrip?: string[];
      } = true,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<PdfProcessResult> {
  const t0 = performance.now();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const doc = await loadPdfLibStrict(file);
  const opts =
    typeof keepFormWidgetsOrOpts === 'boolean'
      ? { keepFormWidgets: keepFormWidgetsOrOpts, keepLinks: false }
      : keepFormWidgetsOrOpts;
  const keepWidgets = opts.keepFormWidgets !== false;
  const keepLinks = Boolean(opts.keepLinks);
  const filterSubtypes =
    opts.subtypesToStrip && opts.subtypesToStrip.length > 0
      ? new Set(opts.subtypesToStrip)
      : null;

  let removed = 0;

  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!annots || !('asArray' in annots) || typeof annots.asArray !== 'function') continue;

    const kept: unknown[] = [];
    for (const ref of annots.asArray()) {
      const dict = doc.context.lookup(ref as never);
      if (!(dict instanceof PDFDict)) {
        if (ref instanceof PDFRef) doc.context.delete(ref);
        removed += 1;
        continue;
      }
      const subtypeObj = dict.lookup(PDFName.of('Subtype'));
      const subtypeName = subtypeObj instanceof PDFName ? subtypeObj.decodeText() : '';

      const preserve =
        (keepWidgets && subtypeName === 'Widget') ||
        (keepLinks && subtypeName === 'Link') ||
        (filterSubtypes !== null &&
          subtypeName !== 'Widget' &&
          subtypeName !== 'Link' &&
          !filterSubtypes.has(subtypeName));

      if (preserve) {
        kept.push(ref);
      } else {
        removed += 1;
        const popupRef = dict.get(PDFName.of('Popup'));
        if (popupRef instanceof PDFRef) doc.context.delete(popupRef);
        const apDict = dict.lookup(PDFName.of('AP'));
        if (apDict instanceof PDFDict) {
          for (const [, apVal] of apDict.entries()) {
            if (apVal instanceof PDFRef) doc.context.delete(apVal);
          }
        }
        if (ref instanceof PDFRef) doc.context.delete(ref);
      }
    }

    if (kept.length === 0) {
      page.node.delete(PDFName.of('Annots'));
    } else {
      page.node.set(PDFName.of('Annots'), doc.context.obj(kept as never[]));
    }
  }

  const rawSaved = await doc.save({ useObjectStreams: true });
  const bytes = await purgeOrphanObjectsWithQpdf(rawSaved);
  onProgress?.(100);
  const stem = sanitizeFilenameStem(file.name, 'document');
  return makeResult(bytes, `${stem}-no-comments.pdf`, 'application/pdf', t0, {
    pageCount: doc.getPageCount(),
    summary: `Removed ${removed} annotation(s)`,
  });
}

export async function sanitizePdfDeep(
  file: File,
  options: {
    stripJavaScript?: boolean;
    stripEmbeddedFiles?: boolean;
    stripMetadata?: boolean;
    stripAnnotations?: boolean;
    stripForms?: boolean;
    stripExternalActions?: boolean;
    burnToPixels?: boolean;
  } = {},
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<PdfProcessResult> {
  const t0 = performance.now();
  const stem = sanitizeFilenameStem(file.name, 'document');

  if (options.burnToPixels) {
    const flattened = await flattenPdf(file, 'raster', onProgress, signal);
    return {
      ...flattened,
      fileName: `${stem}-sanitized-burned.pdf`,
      summary: 'Burned all pages to clean pixels (zero scripts, hidden layers, or metadata)',
    };
  }

  await assertValidPdfFile(file);
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
  } catch (err) {
    throw classifyPdfError(err, file.name);
  }

  if (options.stripMetadata !== false) {
    stripInfoAndCatalogExtras(doc);
  }

  const stripJs = options.stripJavaScript !== false;
  const stripEf = options.stripEmbeddedFiles !== false;
  const stripExt = options.stripExternalActions !== false;

  if (stripJs) {
    for (const key of ['OpenAction', 'AA']) {
      const ref = doc.catalog.get(PDFName.of(key));
      if (ref instanceof PDFRef) doc.context.delete(ref);
      doc.catalog.delete(PDFName.of(key));
    }
  }

  const names = doc.catalog.lookup(PDFName.of('Names'));
  if (names instanceof PDFDict) {
    if (stripJs) {
      const r = names.get(PDFName.of('JavaScript'));
      if (r instanceof PDFRef) doc.context.delete(r);
      names.delete(PDFName.of('JavaScript'));
    }
    if (stripEf) {
      const r = names.get(PDFName.of('EmbeddedFiles'));
      if (r instanceof PDFRef) doc.context.delete(r);
      names.delete(PDFName.of('EmbeddedFiles'));
    }
  }
  if (stripEf) {
    const afRef = doc.catalog.get(PDFName.of('AF'));
    if (afRef instanceof PDFRef) doc.context.delete(afRef);
    doc.catalog.delete(PDFName.of('AF'));
  }

  if (options.stripForms) {
    const acroRef = doc.catalog.get(PDFName.of('AcroForm'));
    if (acroRef instanceof PDFRef) doc.context.delete(acroRef);
    doc.catalog.delete(PDFName.of('AcroForm'));
  }

  const dangerousActionTypes = new Set<string>([
    ...(stripJs ? ['JavaScript'] : []),
    ...(stripExt ? ['Launch', 'URI', 'GoToR', 'GoToE', 'SubmitForm', 'ImportData', 'ResetForm'] : []),
  ]);

  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict) {
      const sName = obj.lookup(PDFName.of('S'));
      const sText = sName instanceof PDFName ? sName.decodeText() : '';
      if (dangerousActionTypes.has(sText)) {
        for (const k of ['JS', 'JavaScript', 'F', 'Win', 'Mac', 'Unix', 'URI', 'Next', 'S', 'Type']) {
          const v = obj.get(PDFName.of(k));
          if (v instanceof PDFRef) doc.context.delete(v);
          obj.delete(PDFName.of(k));
        }
        doc.context.delete(ref);
        continue;
      }
      if (stripJs) {
        for (const k of ['JS', 'JavaScript', 'AA', 'OpenAction']) {
          const v = obj.get(PDFName.of(k));
          if (v instanceof PDFRef) doc.context.delete(v);
          obj.delete(PDFName.of(k));
        }
      }
      if (stripEf && obj.lookup(PDFName.of('Type')) === PDFName.of('Filespec')) {
        const ef = obj.lookup(PDFName.of('EF'));
        if (ef instanceof PDFDict) {
          for (const [, fRef] of ef.entries()) {
            if (fRef instanceof PDFRef) doc.context.delete(fRef);
          }
        }
        doc.context.delete(ref);
      }
    }
  }

  for (const page of doc.getPages()) {
    if (stripJs) {
      const aa = page.node.get(PDFName.of('AA'));
      if (aa instanceof PDFRef) doc.context.delete(aa);
      page.node.delete(PDFName.of('AA'));
    }
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (annots && 'asArray' in annots && typeof annots.asArray === 'function') {
      const kept: unknown[] = [];
      for (const aRef of annots.asArray()) {
        const dict = doc.context.lookup(aRef as never);
        if (!(dict instanceof PDFDict)) {
          if (aRef instanceof PDFRef) doc.context.delete(aRef);
          continue;
        }
        const st = dict.lookup(PDFName.of('Subtype'));
        const stText = st instanceof PDFName ? st.decodeText() : '';
        const shouldRemove =
          (stripEf && stText === 'FileAttachment') ||
          (options.stripForms && stText === 'Widget') ||
          (options.stripAnnotations !== false && stText !== 'Widget' && !(stText === 'Link' && !stripExt)) ||
          (stripExt && stText === 'Link');
        if (shouldRemove) {
          if (aRef instanceof PDFRef) doc.context.delete(aRef);
        } else {
          if (stripJs) {
            dict.delete(PDFName.of('AA'));
          }
          kept.push(aRef);
        }
      }
      if (kept.length === 0) page.node.delete(PDFName.of('Annots'));
      else page.node.set(PDFName.of('Annots'), doc.context.obj(kept as never[]));
    }
  }

  const rawSaved = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
  const bytes = await purgeOrphanObjectsWithQpdf(rawSaved);
  onProgress?.(100);
  return makeResult(bytes, `${stem}-sanitized.pdf`, 'application/pdf', t0, {
    pageCount: doc.getPageCount(),
    summary: 'Deep-sanitized metadata, scripts, actions, attachments, and orphaned objects',
  });
}

export async function detectBlankPages(
  file: File,
  nonWhiteThreshold = 0.0005,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
  options?: { marginIgnorePct?: number; luminanceDelta?: number }
): Promise<{
  blankPages: number[];
  pageDetails: Array<{ pageNumber: number; inkRatio: number; isBlank: boolean; thumbUrl: string }>;
  totalPages: number;
}> {
  const pdf = await loadPdfJsDocument(file);
  const blankPages: number[] = [];
  const pageDetails: Array<{ pageNumber: number; inkRatio: number; isBlank: boolean; thumbUrl: string }> = [];
  const marginPct = Math.max(0, Math.min(0.25, (options?.marginIgnorePct ?? 6) / 100));
  const lumDelta = Math.max(8, Math.min(120, options?.luminanceDelta ?? 26));

  try {
    for (let i = 1; i <= pdf.numPages; i += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      const hasVisibleText = tc.items.some(
        (it) => 'str' in it && it.str.replace(/\s+/g, '').length > 0
      );

      let inkRatio = hasVisibleText ? 1 : 0;
      let thumbUrl = '';

      const canvas = document.createElement('canvas');
      try {
        await renderPdfPageToCanvas(pdf, i, canvas, 0.35);
        thumbUrl = canvas.toDataURL('image/jpeg', 0.72);
        if (!hasVisibleText) {
          const ctx = canvas.getContext('2d');
          if (ctx && canvas.width > 8 && canvas.height > 8) {
            const cw = canvas.width;
            const ch = canvas.height;
            const img = ctx.getImageData(0, 0, cw, ch).data;
            const x0 = Math.floor(cw * marginPct);
            const x1 = Math.ceil(cw * (1 - marginPct));
            const y0 = Math.floor(ch * marginPct);
            const y1 = Math.ceil(ch * (1 - marginPct));
            let nonWhite = 0;
            let scannedPx = 0;
            for (let py = y0; py < y1; py += 1) {
              for (let px = x0; px < x1; px += 1) {
                const idx = (py * cw + px) * 4;
                const minCh = Math.min(img[idx], img[idx + 1], img[idx + 2]);
                if (255 - minCh > lumDelta) nonWhite += 1;
                scannedPx += 1;
              }
            }
            inkRatio = nonWhite / Math.max(1, scannedPx);
          }
        }
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }

      const isBlank = !hasVisibleText && inkRatio <= nonWhiteThreshold;
      if (isBlank) blankPages.push(i);
      pageDetails.push({ pageNumber: i, inkRatio, isBlank, thumbUrl });

      page.cleanup();
      onProgress?.(Math.round((i / pdf.numPages) * 100));
    }
    return { blankPages, pageDetails, totalPages: pdf.numPages };
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

export async function removeBlankPagesFromPdf(
  file: File,
  blankPages: number[],
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<PdfProcessResult> {
  if (blankPages.length === 0) {
    throw new PdfToolError('No blank pages selected to remove.', 'validation');
  }
  const res = await deletePagesFromPdf(file, blankPages, onProgress, signal);
  const stem = sanitizeFilenameStem(file.name, 'document');
  return {
    ...res,
    fileName: `${stem}-cleaned.pdf`,
    summary: `Removed ${blankPages.length} blank page(s)`,
  };
}

async function renderPageToGrayscaleJpegBlob(
  pdf: Awaited<ReturnType<typeof loadPdfJsDocument>>,
  pageNumber: number,
  scale: number,
  quality: number,
  invertColors = false
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  try {
    await renderPdfPageToCanvas(pdf, pageNumber, canvas, scale);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        let lum = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
        if (invertColors) lum = 255 - lum;
        d[i] = lum;
        d[i + 1] = lum;
        d[i + 2] = lum;
      }
      ctx.putImageData(imgData, 0, 0);
    }
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Grayscale encoding failed.'))),
        'image/jpeg',
        quality
      );
    });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function estimateCompressedSize(
  file: File,
  mode: PdfCompressMode,
  quality: number,
  targetDpi: number
): Promise<{ estimatedBytes: number; reductionPct: number }> {
  if (mode === 'lossless') {
    const est = Math.round(file.size * 0.9);
    return { estimatedBytes: est, reductionPct: 10 };
  }
  if (mode === 'less') {
    const est = Math.round(file.size * 0.78);
    return { estimatedBytes: est, reductionPct: 22 };
  }
  if (mode === 'balanced') {
    const factor = Math.max(0.45, Math.min(0.95, quality * 0.95));
    const est = Math.round(file.size * factor);
    return {
      estimatedBytes: est,
      reductionPct: Math.max(0, Math.round(((file.size - est) / file.size) * 100)),
    };
  }
  if (mode === 'strip-images') {
    try {
      const doc = await loadPdfLibStrict(file, true);
      let imageBytes = 0;
      for (const [, obj] of doc.context.enumerateIndirectObjects()) {
        if (obj instanceof PDFRawStream && obj.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image')) {
          imageBytes += obj.getContents().length;
        }
      }
      const est = Math.max(2048, file.size - Math.round(imageBytes * 0.92));
      return {
        estimatedBytes: est,
        reductionPct: Math.max(0, Math.round(((file.size - est) / file.size) * 100)),
      };
    } catch {
      const est = Math.max(2048, Math.round(file.size * 0.35));
      return {
        estimatedBytes: est,
        reductionPct: Math.max(0, Math.round(((file.size - est) / file.size) * 100)),
      };
    }
  }
  // Sample first page in rasterize / grayscale mode for genuine byte projection
  const pdf = await loadPdfJsDocument(file);
  try {
    const renderScale = Math.max(0.75, Math.min(3.1, targetDpi / 72));
    const blob =
      mode === 'grayscale'
        ? await renderPageToGrayscaleJpegBlob(pdf, 1, renderScale, quality)
        : (
            await renderPdfPageToBlob(pdf, 1, {
              scale: renderScale,
              format: 'jpeg',
              quality,
            })
          ).blob;
    const est = Math.max(2048, blob.size * pdf.numPages + 1200);
    return {
      estimatedBytes: est,
      reductionPct: Math.round(((file.size - est) / file.size) * 100),
    };
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

export async function compressPdfSmart(
  file: File,
  options: {
    mode: PdfCompressMode;
    quality: number;
    targetDpi: number;
    allowLarger?: boolean;
    invertColors?: boolean;
  },
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<PdfProcessResult> {
  const t0 = performance.now();
  await assertValidPdfFile(file);
  const rawBytes = new Uint8Array(await file.arrayBuffer());
  const stem = sanitizeFilenameStem(file.name, 'document');

  let candidateBytes: Uint8Array;
  let pageCount = 0;

  if (options.mode === 'lossless') {
    onProgress?.(25);
    try {
      candidateBytes = await compressLosslessWithQpdf(rawBytes);
      const doc = await PDFDocument.load(candidateBytes, { ignoreEncryption: true });
      pageCount = doc.getPageCount();
    } catch (err) {
      throw classifyPdfError(err, file.name);
    }
    onProgress?.(95);
  } else if (options.mode === 'strip-images') {
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(rawBytes);
    } catch (err) {
      throw classifyPdfError(err, file.name);
    }
    pageCount = doc.getPageCount();
    const visitedForms = new Set<PDFDict>();

    const stripXObjectsFromResources = (res: PDFDict): string[] => {
      const removedNames: string[] = [];
      const xObj = res.lookupMaybe(PDFName.of('XObject'), PDFDict);
      if (!xObj) return removedNames;

      for (const [key, val] of xObj.entries()) {
        const target = doc.context.lookup(val);
        if (target instanceof PDFRawStream || target instanceof PDFStream) {
          const subtype = target.dict.lookup(PDFName.of('Subtype'));
          if (subtype === PDFName.of('Image')) {
            removedNames.push(key.decodeText());
            xObj.delete(key);
          } else if (subtype === PDFName.of('Form') && !visitedForms.has(target.dict)) {
            visitedForms.add(target.dict);
            const formRes = target.dict.lookupMaybe(PDFName.of('Resources'), PDFDict);
            if (formRes) {
              const nestedRemoved = stripXObjectsFromResources(formRes);
              if (nestedRemoved.length > 0 && target instanceof PDFRawStream && val instanceof PDFRef) {
                try {
                  const decoded = new TextDecoder('latin1').decode(decodePDFRawStream(target).decode());
                  let cleaned = decoded;
                  for (const name of nestedRemoved) {
                    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    cleaned = cleaned.replace(new RegExp(`/${escaped}\\s+Do\\b`, 'g'), '');
                  }
                  const replacement = doc.context.flateStream(cleaned, {
                    Type: 'XObject',
                    Subtype: 'Form',
                    BBox: target.dict.lookup(PDFName.of('BBox')) || [0, 0, 1, 1],
                    Resources: formRes,
                  });
                  doc.context.assign(val, replacement);
                } catch {
                  // Keep form stream if filter is non-standard
                }
              }
            }
          }
        }
      }
      return removedNames;
    };

    const pages = doc.getPages();
    for (let i = 0; i < pages.length; i += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const page = pages[i];
      const res = page.node.Resources();
      if (res) {
        const removedNames = stripXObjectsFromResources(res);
        if (removedNames.length > 0) {
          const contentsObj = page.node.Contents();
          const streamRefs: PDFRef[] = [];
          if (contentsObj instanceof PDFArray) {
            for (let k = 0; k < contentsObj.size(); k += 1) {
              const item = contentsObj.get(k);
              if (item instanceof PDFRef) streamRefs.push(item);
            }
          } else {
            const rawRef = page.node.get(PDFName.of('Contents'));
            if (rawRef instanceof PDFRef) streamRefs.push(rawRef);
          }
          for (const sRef of streamRefs) {
            const stream = doc.context.lookup(sRef);
            if (!(stream instanceof PDFRawStream)) continue;
            try {
              const decoded = new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());
              let cleaned = decoded;
              for (const name of removedNames) {
                const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                cleaned = cleaned.replace(new RegExp(`/${escaped}\\s+Do\\b`, 'g'), '');
              }
              if (cleaned !== decoded) {
                doc.context.assign(sRef, doc.context.flateStream(cleaned));
              }
            } catch {
              // Keep content stream if unsupported filter
            }
          }
        }
      }
      onProgress?.(Math.min(60, Math.round(((i + 1) / Math.max(1, pages.length)) * 60)));
    }

    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream && obj.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image')) {
        const smask = obj.dict.get(PDFName.of('SMask'));
        const mask = obj.dict.get(PDFName.of('Mask'));
        doc.context.delete(ref);
        if (smask instanceof PDFRef) doc.context.delete(smask);
        if (mask instanceof PDFRef) doc.context.delete(mask);
      }
    }

    const saved = await doc.save({ useObjectStreams: true });
    onProgress?.(85);
    try {
      candidateBytes = await compressLosslessWithQpdf(saved);
    } catch {
      candidateBytes = saved;
    }
    onProgress?.(95);
  } else if (options.mode === 'balanced' || options.mode === 'less') {
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(rawBytes);
    } catch (err) {
      throw classifyPdfError(err, file.name);
    }
    pageCount = doc.getPageCount();
    const effectiveDpi = options.mode === 'less' ? Math.max(200, options.targetDpi) : options.targetDpi;
    const effectiveQuality = options.mode === 'less' ? Math.max(0.88, options.quality) : options.quality;
    const scale = Math.min(1, effectiveDpi / 150);
    const objs = doc.context.enumerateIndirectObjects();
    let idx = 0;

    for (const [, obj] of objs) {
      idx += 1;
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!(obj instanceof PDFRawStream)) continue;
      const dict = obj.dict;
      if (dict.lookup(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
      if (dict.has(PDFName.of('SMask')) || dict.has(PDFName.of('Mask'))) continue;

      const width = Number(dict.lookup(PDFName.of('Width'))?.toString() || 0);
      const height = Number(dict.lookup(PDFName.of('Height'))?.toString() || 0);
      if (width < 120 || height < 120) continue;

      const filterStr = dict.lookup(PDFName.of('Filter'))?.toString() || '';
      if (!filterStr.includes('DCTDecode') || filterStr.includes('[')) continue;

      const origContents = obj.getContents();
      try {
        const srcCopy = new Uint8Array(origContents.length);
        srcCopy.set(origContents);
        const srcBlob = new Blob([srcCopy], { type: 'image/jpeg' });
        const bmp = await createImageBitmap(srcBlob);
        const tw = Math.max(64, Math.round(bmp.width * scale));
        const th = Math.max(64, Math.round(bmp.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = tw;
        canvas.height = th;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bmp, 0, 0, tw, th);
          const reBlob = await new Promise<Blob | null>((r) =>
            canvas.toBlob(r, 'image/jpeg', effectiveQuality)
          );
          if (reBlob && reBlob.size < origContents.length) {
            const nextBytes = new Uint8Array(await reBlob.arrayBuffer());
            dict.set(PDFName.of('Width'), doc.context.obj(tw));
            dict.set(PDFName.of('Height'), doc.context.obj(th));
            dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
            dict.set(PDFName.of('BitsPerComponent'), doc.context.obj(8));
            dict.delete(PDFName.of('Decode'));
            dict.delete(PDFName.of('DecodeParms'));
            dict.set(PDFName.of('Length'), doc.context.obj(nextBytes.length));
            (obj as unknown as { contents: Uint8Array }).contents = nextBytes;
          }
        }
        bmp.close();
        canvas.width = 0;
        canvas.height = 0;
      } catch {
        // Leave unsupported image untouched
      }
      if (idx % 10 === 0) onProgress?.(Math.min(75, Math.round((idx / objs.length) * 75)));
    }

    const saved = await doc.save({ useObjectStreams: true });
    onProgress?.(85);
    try {
      candidateBytes = await compressLosslessWithQpdf(saved);
    } catch {
      candidateBytes = saved;
    }
    onProgress?.(95);
  } else {
    const pdf = await loadPdfJsDocument(rawBytes);
    pageCount = pdf.numPages;
    const out = await PDFDocument.create();
    const renderScale = Math.max(0.75, Math.min(3.1, options.targetDpi / 72));
    try {
      for (let i = 1; i <= pdf.numPages; i += 1) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        page.cleanup();
        const blob =
          options.mode === 'grayscale'
            ? await renderPageToGrayscaleJpegBlob(
                pdf,
                i,
                renderScale,
                options.quality,
                Boolean(options.invertColors)
              )
            : (
                await renderPdfPageToBlob(pdf, i, {
                  scale: renderScale,
                  format: 'jpeg',
                  quality: options.quality,
                })
              ).blob;
        const img = await out.embedJpg(await blob.arrayBuffer());
        const p = out.addPage([vp.width, vp.height]);
        p.drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
        onProgress?.(Math.round((i / pdf.numPages) * 92));
      }
      candidateBytes = await out.save({ useObjectStreams: true });
    } finally {
      await pdf.destroy().catch(() => {});
    }
  }

  onProgress?.(100);
  if (!options.allowLarger && candidateBytes.length >= file.size) {
    return makeResult(rawBytes, file.name, 'application/pdf', t0, {
      pageCount,
      skippedCompression: true,
      summary: 'Already optimal — compression would not reduce file size, kept original bytes.',
    });
  }

  const savedPct = Math.round(((file.size - candidateBytes.length) / file.size) * 100);
  return makeResult(candidateBytes, `${stem}-compressed.pdf`, 'application/pdf', t0, {
    pageCount,
    summary: `Reduced size by ${savedPct}% (${(file.size / 1024).toFixed(0)} KB -> ${(candidateBytes.length / 1024).toFixed(0)} KB)`,
  });
}

export async function imagesToPdf(
  items: Array<{ file: File; rotation?: number; filter?: 'none' | 'grayscale' | 'bw' }>,
  options: {
    pageSize: PdfPageSizePreset;
    orientation?: 'auto' | 'portrait' | 'landscape';
    marginPt: number;
    fitMode: 'contain' | 'cover';
  },
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<PdfProcessResult> {
  if (items.length === 0) {
    throw new PdfToolError('Add at least one image.', 'validation');
  }
  const t0 = performance.now();
  const doc = await PDFDocument.create();

  for (let i = 0; i < items.length; i += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const item = items[i];
    const { detectImageSignatureFromBytes, decodeImageFileResilient } = await import('./image-pipeline');
    if (item.file.size === 0) {
      throw new PdfToolError(`Image #${i + 1} (${item.file.name}) is 0 bytes.`, 'validation');
    }
    const headBytes = new Uint8Array(await item.file.slice(0, Math.min(item.file.size, 512)).arrayBuffer());
    const sig = detectImageSignatureFromBytes(headBytes, item.file.name);
    if (sig === 'heic' || sig === 'tiff' || sig === 'unknown') {
      throw new PdfToolError(
        `"${item.file.name}" (${sig.toUpperCase()}) cannot be decoded natively here. Replace or convert to JPEG/PNG and keep your remaining pages.`,
        'validation'
      );
    }

    const decoded = await decodeImageFileResilient(item.file, sig);
    let outBlob: Blob | null = null;
    const isPngLike = sig === 'png' || sig === 'webp' || sig === 'svg';
    const outMime = isPngLike && item.filter !== 'bw' ? 'image/png' : 'image/jpeg';
    try {
      const rot = (((item.rotation || 0) % 360) + 360) % 360;
      const swap = rot === 90 || rot === 270;
      const cw = swap ? decoded.height : decoded.width;
      const ch = swap ? decoded.width : decoded.height;

      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      if (!isPngLike) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cw, ch);
      }
      ctx.save();
      ctx.translate(cw / 2, ch / 2);
      ctx.rotate((rot * Math.PI) / 180);
      if (item.filter === 'grayscale') {
        ctx.filter = 'grayscale(100%) contrast(1.15)';
      } else if (item.filter === 'bw') {
        ctx.filter = 'grayscale(100%) contrast(1.7) brightness(1.05)';
      }
      ctx.drawImage(decoded.canvas, -decoded.width / 2, -decoded.height / 2);
      ctx.restore();

      outBlob = await new Promise<Blob | null>((r) => canvas.toBlob(r, outMime, 0.92));
      canvas.width = 0;
      canvas.height = 0;
    } finally {
      decoded.cleanup();
    }
    if (!outBlob) throw new Error(`Failed to encode ${item.file.name}`);

    const img =
      outMime === 'image/png'
        ? await doc.embedPng(await outBlob.arrayBuffer())
        : await doc.embedJpg(await outBlob.arrayBuffer());
    const rot = (((item.rotation || 0) % 360) + 360) % 360;
    const swap = rot === 90 || rot === 270;
    const cw = swap ? decoded.height : decoded.width;
    const ch = swap ? decoded.width : decoded.height;
    const isLandscape =
      options.orientation === 'landscape'
        ? true
        : options.orientation === 'portrait'
        ? false
        : cw > ch;

    let pageW = cw * 0.75;
    let pageH = ch * 0.75;
    if (options.pageSize === 'a4') {
      pageW = isLandscape ? 841.89 : 595.28;
      pageH = isLandscape ? 595.28 : 841.89;
    } else if (options.pageSize === 'letter') {
      pageW = isLandscape ? 792 : 612;
      pageH = isLandscape ? 612 : 792;
    }

    const page = doc.addPage([pageW, pageH]);
    const m = options.pageSize === 'auto' ? 0 : Math.max(0, options.marginPt);
    const availW = Math.max(20, pageW - m * 2);
    const availH = Math.max(20, pageH - m * 2);
    const ratio =
      options.fitMode === 'cover'
        ? Math.max(availW / img.width, availH / img.height)
        : Math.min(availW / img.width, availH / img.height);
    const drawW = img.width * ratio;
    const drawH = img.height * ratio;

    page.drawImage(img, {
      x: (pageW - drawW) / 2,
      y: (pageH - drawH) / 2,
      width: drawW,
      height: drawH,
    });

    onProgress?.(Math.round(((i + 1) / items.length) * 90));
  }

  const bytes = await doc.save({ useObjectStreams: true });
  onProgress?.(100);
  const stem = sanitizeFilenameStem(items[0].file.name, 'images');
  return makeResult(bytes, `${stem}-bundle.pdf`, 'application/pdf', t0, {
    pageCount: items.length,
    summary: `Created ${items.length}-page PDF`,
  });
}

export async function applyEditsAndSignaturesToPdf(
  file: File,
  overlays: PdfEditorOverlayElement[],
  formValues: Record<string, string | boolean> = {},
  onProgress?: (pct: number) => void,
  inlineTextEdits: PdfInlineTextEdit[] = [],
  existingLinkEdits: PdfExistingLinkEdit[] = []
): Promise<PdfProcessResult> {
  const t0 = performance.now();
  const doc = await loadPdfLibStrict(file);
  const pages = doc.getPages();

  if (Object.keys(formValues).length > 0) {
    try {
      const form = doc.getForm();
      for (const [fieldName, val] of Object.entries(formValues)) {
        try {
          const field = form.getField(fieldName);
          if (typeof val === 'boolean' && 'check' in field && 'uncheck' in field) {
            const cb = field as unknown as { check: () => void; uncheck: () => void };
            if (val) cb.check();
            else cb.uncheck();
          } else if (typeof val === 'string' && 'setText' in field) {
            (field as unknown as { setText: (s: string) => void }).setText(val);
          } else if (typeof val === 'string' && 'select' in field) {
            (field as unknown as { select: (s: string) => void }).select(val);
          }
        } catch {
          // Skip incompatible field update
        }
      }
    } catch {
      // No AcroForm
    }
  }

  // Edit or delete existing PDF /Link annotations matching originalRect within <= 3pt
  if (existingLinkEdits.length > 0) {
    for (let pageIdx = 0; pageIdx < pages.length; pageIdx += 1) {
      const page = pages[pageIdx];
      const pageEdits = existingLinkEdits.filter((e) => e.pageNumber === pageIdx + 1);
      if (pageEdits.length === 0) continue;

      const annots = page.node.lookup(PDFName.of('Annots'));
      if (!(annots instanceof PDFArray)) continue;

      const remainingRefs: PDFRef[] = [];
      let modifiedArray = false;

      for (let i = 0; i < annots.size(); i += 1) {
        const rawRef = annots.get(i);
        const dict = doc.context.lookup(rawRef);
        if (!(dict instanceof PDFDict) || dict.lookup(PDFName.of('Subtype')) !== PDFName.of('Link')) {
          if (rawRef instanceof PDFRef) remainingRefs.push(rawRef);
          continue;
        }

        const rectObj = dict.lookup(PDFName.of('Rect'));
        let matchedEdit: PdfExistingLinkEdit | undefined;
        if (rectObj instanceof PDFArray && rectObj.size() >= 4) {
          const nums = [0, 1, 2, 3].map((k) => {
            const item = rectObj.lookup(k);
            return item instanceof PDFNumber ? item.asNumber() : Number(item?.toString() || 0);
          });
          matchedEdit = pageEdits.find(
            (e) =>
              Math.abs(nums[0] - e.originalRect[0]) <= 3 &&
              Math.abs(nums[1] - e.originalRect[1]) <= 3 &&
              Math.abs(nums[2] - e.originalRect[2]) <= 3 &&
              Math.abs(nums[3] - e.originalRect[3]) <= 3
          );
        }

        if (matchedEdit) {
          if (matchedEdit.deleted) {
            modifiedArray = true;
            continue;
          }
          dict.delete(PDFName.of('Dest'));
          dict.set(
            PDFName.of('A'),
            doc.context.obj({
              Type: 'Action',
              S: 'URI',
              URI: PDFString.of(matchedEdit.url),
            })
          );
        }

        if (rawRef instanceof PDFRef) remainingRefs.push(rawRef);
      }

      if (modifiedArray) {
        if (remainingRefs.length === 0) {
          page.node.delete(PDFName.of('Annots'));
        } else {
          page.node.set(PDFName.of('Annots'), doc.context.obj(remainingRefs));
        }
      }
    }
  }

  // True content-stream surgical text removal + @pdf-lib/fontkit modern font matching + Tz scaling
  if (inlineTextEdits.length > 0) {
    doc.registerFontkit(fontkit);
  }

  const mulMat6 = (a: number[], b: number[]): number[] => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];

  interface StreamTok {
    kind: 'num' | 'str' | 'hex' | 'arr' | 'word' | 'other';
    start: number;
    end: number;
    num?: number;
    text?: string;
  }

  const tokenizePdfStream = (src: string): StreamTok[] => {
    const out: StreamTok[] = [];
    const n = src.length;
    let i = 0;
    while (i < n) {
      const ch = src[i];
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '\f' || ch === '\0') {
        i += 1;
        continue;
      }
      if (ch === '%') {
        while (i < n && src[i] !== '\n' && src[i] !== '\r') i += 1;
        continue;
      }
      if (ch === '(') {
        const start = i;
        i += 1;
        let depth = 1;
        while (i < n && depth > 0) {
          if (src[i] === '\\') {
            i += 2;
            continue;
          }
          if (src[i] === '(') depth += 1;
          else if (src[i] === ')') depth -= 1;
          i += 1;
        }
        out.push({ kind: 'str', start, end: i, text: src.slice(start + 1, i - 1) });
        continue;
      }
      if (ch === '<' && src[i + 1] !== '<') {
        const start = i;
        i += 1;
        while (i < n && src[i] !== '>') i += 1;
        if (i < n) i += 1;
        out.push({ kind: 'hex', start, end: i });
        continue;
      }
      if (ch === '[') {
        const start = i;
        i += 1;
        let arrDepth = 1;
        while (i < n && arrDepth > 0) {
          if (src[i] === '(') {
            i += 1;
            let pDepth = 1;
            while (i < n && pDepth > 0) {
              if (src[i] === '\\') {
                i += 2;
                continue;
              }
              if (src[i] === '(') pDepth += 1;
              else if (src[i] === ')') pDepth -= 1;
              i += 1;
            }
            continue;
          }
          if (src[i] === '[') arrDepth += 1;
          else if (src[i] === ']') arrDepth -= 1;
          i += 1;
        }
        out.push({ kind: 'arr', start, end: i, text: src.slice(start, i) });
        continue;
      }
      if ((ch === '<' && src[i + 1] === '<') || (ch === '>' && src[i + 1] === '>')) {
        out.push({ kind: 'other', start: i, end: i + 2 });
        i += 2;
        continue;
      }
      const start = i;
      while (
        i < n &&
        !' \t\r\n\f\0()<>[]{}/%'.includes(src[i])
      ) {
        i += 1;
      }
      if (i === start) {
        // Handle `/Name` tokens cleanly
        if (src[i] === '/') {
          i += 1;
          while (i < n && !' \t\r\n\f\0()<>[]{}/%'.includes(src[i])) i += 1;
          out.push({ kind: 'word', start, end: i, text: src.slice(start, i) });
        } else {
          out.push({ kind: 'other', start, end: i + 1 });
          i += 1;
        }
        continue;
      }
      const word = src.slice(start, i);
      const parsedNum = Number(word);
      if (word !== '' && Number.isFinite(parsedNum) && /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(word)) {
        out.push({ kind: 'num', start, end: i, num: parsedNum });
      } else {
        out.push({ kind: 'word', start, end: i, text: word });
      }
    }
    return out;
  };

  const suppressPageInlineEditsInStreams = (
    page: PDFPage,
    pageEdits: PdfInlineTextEdit[]
  ): Set<string> => {
    const removed = new Set<string>();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    if (rot !== 0 || pageEdits.length === 0) return removed;

    const { width: pw, height: ph } = page.getSize();
    const box = page.getCropBox() || page.getMediaBox();
    const targets = pageEdits.map((ed) => {
      const h = Math.max(6, ed.height * ph);
      const w = Math.max(6, ed.width * pw);
      const x = box.x + ed.x * pw;
      const yBottom = box.y + ph - ed.y * ph - h;
      const baseline =
        typeof ed.baselineY === 'number' && ed.baselineY >= 0 && ed.baselineY <= 1
          ? box.y + ph * (1 - ed.baselineY)
          : yBottom + h * 0.2;
      return {
        id: ed.id,
        x0: x - 5,
        x1: x + w + 5,
        y0: Math.min(yBottom, baseline) - 4,
        y1: Math.max(yBottom + h, baseline + ed.fontSize * 0.5) + 4,
      };
    });

    const contentsObj = page.node.Contents();
    const refs: PDFRef[] = [];
    if (contentsObj instanceof PDFArray) {
      for (let k = 0; k < contentsObj.size(); k += 1) {
        const it = contentsObj.get(k);
        if (it instanceof PDFRef) refs.push(it);
      }
    } else {
      const raw = page.node.get(PDFName.of('Contents'));
      if (raw instanceof PDFRef) refs.push(raw);
    }

    for (const ref of refs) {
      const stream = doc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) continue;
      let decoded = '';
      try {
        decoded = new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());
      } catch {
        continue;
      }
      const toks = tokenizePdfStream(decoded);
      const replacements: Array<{ start: number; end: number; value: string }> = [];

      const ctmStack: number[][] = [];
      let ctm = [1, 0, 0, 1, 0, 0];
      let tm = [1, 0, 0, 1, 0, 0];
      let tlm = [1, 0, 0, 1, 0, 0];
      let leading = 0;
      let operands: StreamTok[] = [];

      for (const tok of toks) {
        if (tok.kind !== 'word') {
          operands.push(tok);
          continue;
        }
        const op = tok.text;
        if (op === 'q') {
          ctmStack.push(ctm.slice());
        } else if (op === 'Q') {
          const prev = ctmStack.pop();
          if (prev) ctm = prev;
        } else if (op === 'cm' && operands.length >= 6) {
          const nums = operands.slice(-6).map((o) => o.num ?? 0);
          ctm = mulMat6(ctm, nums);
        } else if (op === 'BT') {
          tm = [1, 0, 0, 1, 0, 0];
          tlm = [1, 0, 0, 1, 0, 0];
        } else if (op === 'TL' && operands.length >= 1) {
          leading = operands[operands.length - 1].num ?? leading;
        } else if ((op === 'Td' || op === 'TD') && operands.length >= 2) {
          const tx = operands[operands.length - 2].num ?? 0;
          const ty = operands[operands.length - 1].num ?? 0;
          if (op === 'TD') leading = -ty;
          tlm = mulMat6(tlm, [1, 0, 0, 1, tx, ty]);
          tm = tlm.slice();
        } else if (op === 'T*') {
          tlm = mulMat6(tlm, [1, 0, 0, 1, 0, -leading]);
          tm = tlm.slice();
        } else if (op === 'Tm' && operands.length >= 6) {
          tm = operands.slice(-6).map((o) => o.num ?? 0);
          tlm = tm.slice();
        } else if (op === 'Tj' || op === 'TJ' || op === '\'' || op === '"') {
          if (op === '\'' || op === '"') {
            tlm = mulMat6(tlm, [1, 0, 0, 1, 0, -leading]);
            tm = tlm.slice();
          }
          const payloadTok = operands[operands.length - 1];
          if (payloadTok) {
            const pos = mulMat6(ctm, tm);
            const px = pos[4];
            const py = pos[5];
            const matched = targets.find(
              (t) => px >= t.x0 && px <= t.x1 && py >= t.y0 && py <= t.y1
            );
            if (matched) {
              removed.add(matched.id);
              const emptyVal =
                payloadTok.kind === 'arr'
                  ? '[]'
                  : payloadTok.kind === 'hex'
                  ? '<>'
                  : '()';
              replacements.push({ start: payloadTok.start, end: payloadTok.end, value: emptyVal });
            }
          }
        }
        operands = [];
      }

      if (replacements.length > 0) {
        let updated = '';
        let cursor = 0;
        for (const r of replacements) {
          updated += decoded.slice(cursor, r.start) + r.value;
          cursor = r.end;
        }
        updated += decoded.slice(cursor);
        doc.context.assign(ref, doc.context.flateStream(updated));
      }
    }

    return removed;
  };

  const embeddedModernFontCache = new Map<string, Awaited<ReturnType<PDFDocument['embedFont']>>>();
  const resolveInlineEditFont = async (edit: PdfInlineTextEdit) => {
    const weight = edit.fontWeight || (edit.bold ? 700 : 400);
    const italic = Boolean(edit.italic);
    const slug: ModernFontSlug | undefined = edit.modernSlug;

    if (slug) {
      const cacheKey = `${slug}-${weight}-${italic ? 'i' : 'n'}`;
      const cached = embeddedModernFontCache.get(cacheKey);
      if (cached) return { font: cached, isCustom: true };
      const bytes = await loadMatchedFontBytes(slug, weight, italic);
      if (bytes) {
        try {
          const customFont = await doc.embedFont(bytes, { subset: true });
          embeddedModernFontCache.set(cacheKey, customFont);
          return { font: customFont, isCustom: true };
        } catch {
          // Fall back cleanly to StandardFonts if custom font subsetting fails
        }
      }
    }
    const stdFont = await embedChoiceFont(doc, edit.fontFamily, Boolean(edit.bold), italic);
    return { font: stdFont, isCustom: false };
  };

  const editsByPage = new Map<number, PdfInlineTextEdit[]>();
  for (const edit of inlineTextEdits) {
    const arr = editsByPage.get(edit.pageNumber) || [];
    arr.push(edit);
    editsByPage.set(edit.pageNumber, arr);
  }

  for (const [pageNumberKey, pageEdits] of Array.from(editsByPage.entries())) {
    const page = pages[pageNumberKey - 1];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();
    const box = page.getCropBox() || page.getMediaBox();
    const surgicallyRemoved = suppressPageInlineEditsInStreams(page, pageEdits);

    for (const edit of pageEdits) {
      const x = box.x + edit.x * pw;
      const w = Math.max(6, edit.width * pw);
      const h = Math.max(6, edit.height * ph);
      const y = box.y + ph - edit.y * ph - h;

      // Paint tight adaptive background patch ONLY when old glyph run wasn't stripped from stream
      if (!surgicallyRemoved.has(edit.id)) {
        page.drawRectangle({
          x: Math.max(box.x, x - 0.8),
          y: Math.max(box.y, y - 0.8),
          width: w + 1.6,
          height: h + 1.6,
          color: hexToRgb(edit.bgColor || '#ffffff'),
        });
      }

      if (edit.newText.trim()) {
        const { font, isCustom } = await resolveInlineEditFont(edit);
        const textToDraw = isCustom ? edit.newText : sanitizeWinAnsi(edit.newText);
        let textY = y + Math.max(0.5, (h - edit.fontSize) * 0.25);
        if (typeof edit.baselineY === 'number' && Number.isFinite(edit.baselineY)) {
          const candidateY =
            edit.baselineY >= 0 && edit.baselineY <= 1
              ? box.y + ph * (1 - edit.baselineY)
              : box.y + edit.baselineY;
          textY = Math.max(y, Math.min(y + h - edit.fontSize * 0.3, candidateY));
        }

        let tzPct: number | null = null;
        if (edit.matchOriginalWidth !== false && w > 12) {
          try {
            const newW = font.widthOfTextAtSize(textToDraw, edit.fontSize);
            if (newW > 0) {
              const ratio = w / newW;
              if (ratio >= 0.85 && ratio <= 1.15 && Math.abs(ratio - 1) > 0.015) {
                tzPct = Math.round(ratio * 1000) / 10;
              }
            }
          } catch {
            tzPct = null;
          }
        }

        if (tzPct !== null) {
          page.pushOperators(
            pushGraphicsState(),
            PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(tzPct)])
          );
        }

        page.drawText(textToDraw, {
          x,
          y: textY,
          size: edit.fontSize,
          font,
          color: hexToRgb(edit.color || '#0b0b0d'),
        });

        if (tzPct !== null) {
          page.pushOperators(popGraphicsState());
        }
      }
    }
  }

  for (let i = 0; i < overlays.length; i += 1) {
    const el = overlays[i];
    const page = pages[el.pageNumber - 1];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();
    const x = el.x * pw;
    const w = Math.max(4, el.width * pw);
    const h = Math.max(4, el.height * ph);
    const y = ph - el.y * ph - h;

    if (el.kind === 'redact' || el.kind === 'whiteout') {
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        color: hexToRgb(el.kind === 'whiteout' ? '#ffffff' : el.fillColor || '#000000'),
        opacity: el.opacity ?? 1,
      });
    } else if (el.kind === 'link' && el.linkUrl) {
      const col = hexToRgb(el.color || '#2563eb');
      if (el.text) {
        const font = await embedChoiceFont(doc, el.fontFamily || 'helvetica');
        page.drawText(el.text, {
          x,
          y: y + 4,
          size: el.fontSize ?? 12,
          font,
          color: col,
        });
      }
      page.drawLine({ start: { x, y: y + 2 }, end: { x: x + w, y: y + 2 }, thickness: 0.75, color: col });

      // Add real clickable PDF /Link URI annotation
      const linkAnnot = doc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [x, y, x + w, y + h],
        Border: [0, 0, 0],
        A: {
          Type: 'Action',
          S: 'URI',
          URI: PDFString.of(el.linkUrl),
        },
      });
      const linkRef = doc.context.register(linkAnnot);
      const existingAnnots = page.node.lookup(PDFName.of('Annots'));
      if (existingAnnots instanceof PDFArray) {
        existingAnnots.push(linkRef);
      } else {
        page.node.set(PDFName.of('Annots'), doc.context.obj([linkRef]));
      }
    } else if (el.kind === 'rect') {
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        borderColor: hexToRgb(el.color || '#5562F0'),
        borderWidth: el.strokeWidth ?? 2,
        ...(el.fillColor ? { color: hexToRgb(el.fillColor) } : {}),
        opacity: el.opacity ?? 1,
      });
    } else if (el.kind === 'ellipse') {
      page.drawEllipse({
        x: x + w / 2,
        y: y + h / 2,
        xScale: w / 2,
        yScale: h / 2,
        borderColor: hexToRgb(el.color || '#5562F0'),
        borderWidth: el.strokeWidth ?? 2,
        ...(el.fillColor ? { color: hexToRgb(el.fillColor) } : {}),
        opacity: el.opacity ?? 1,
      });
    } else if (el.kind === 'line' || el.kind === 'arrow') {
      const x1 = x;
      const y1 = y + h / 2;
      const x2 = x + w;
      const y2 = y + h / 2;
      const col = hexToRgb(el.color || '#5562F0');
      const sw = el.strokeWidth ?? 2.5;
      page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: sw, color: col });
      if (el.kind === 'arrow') {
        const head = Math.min(14, Math.max(6, w * 0.12));
        page.drawLine({ start: { x: x2, y: y2 }, end: { x: x2 - head, y: y2 + head * 0.6 }, thickness: sw, color: col });
        page.drawLine({ start: { x: x2, y: y2 }, end: { x: x2 - head, y: y2 - head * 0.6 }, thickness: sw, color: col });
      }
    } else if (el.kind === 'text' && el.text) {
      const fs = el.fontSize ?? 14;
      const font = await embedChoiceFont(doc, el.fontFamily || 'helvetica');
      if (el.fillColor) {
        page.drawRectangle({ x, y, width: w, height: h, color: hexToRgb(el.fillColor) });
      }
      page.drawText(el.text.replace(/[^\x20-\x7e\u00a0-\u00ff]/g, '?'), {
        x: x + 2,
        y: y + h - fs,
        size: fs,
        font,
        color: hexToRgb(el.color || '#0b0b0d'),
        maxWidth: Math.max(20, w - 4),
        lineHeight: fs * 1.25,
      });
    } else if ((el.kind === 'image' || el.kind === 'signature') && el.imageDataUrl) {
      const resp = await fetch(el.imageDataUrl);
      const buf = await resp.arrayBuffer();
      const embedded = el.imageDataUrl.includes('image/jpeg')
        ? await doc.embedJpg(buf)
        : await doc.embedPng(buf);
      page.drawImage(embedded, {
        x,
        y,
        width: w,
        height: h,
        opacity: el.opacity ?? 1,
      });
    }

    onProgress?.(Math.round(((i + 1) / Math.max(1, overlays.length)) * 90));
  }

  const bytes = await doc.save({ useObjectStreams: true });
  onProgress?.(100);
  const stem = sanitizeFilenameStem(file.name, 'document');
  const totalChanges = overlays.length + inlineTextEdits.length + existingLinkEdits.length;
  return makeResult(bytes, `${stem}-edited.pdf`, 'application/pdf', t0, {
    pageCount: pages.length,
    summary: `Saved ${totalChanges} edit(s) across ${pages.length} pages`,
  });
}

function classifyPaperName(widthPt: number, heightPt: number): string {
  const minDim = Math.min(widthPt, heightPt);
  const maxDim = Math.max(widthPt, heightPt);
  const near = (a: number, b: number) => Math.abs(a - b) <= 6;
  if (near(minDim, 595.28) && near(maxDim, 841.89)) return 'A4';
  if (near(minDim, 612) && near(maxDim, 792)) return 'Letter';
  if (near(minDim, 612) && near(maxDim, 1008)) return 'Legal';
  if (near(minDim, 841.89) && near(maxDim, 1190.55)) return 'A3';
  if (near(minDim, 419.53) && near(maxDim, 595.28)) return 'A5';
  if (near(minDim, 792) && near(maxDim, 1224)) return 'Tabloid';
  return 'Custom';
}

export async function autoRotatePdf(
  file: File,
  options?: { signal?: AbortSignal; onProgress?: (pct: number) => void }
): Promise<
  PdfProcessResult & {
    rotatedPages: Array<{ pageNumber: number; degreesApplied: number; reason: string }>;
  }
> {
  const t0 = performance.now();
  await assertValidPdfFile(file);
  const rawBytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await loadPdfJsDocument(rawBytes);
  const pdfjs = await getPdfJs();
  const doc = await PDFDocument.load(rawBytes);
  const pages = doc.getPages();
  const rotatedPages: Array<{ pageNumber: number; degreesApplied: number; reason: string }> = [];

  let tesseractWorker: Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>> | null = null;
  const getTesseractWorker = async () => {
    if (tesseractWorker) return tesseractWorker;
    const { createWorker, OEM } = await import('tesseract.js');
    const origin = window.location.origin;
    tesseractWorker = await createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${origin}/vendor/tesseract/worker.min.js`,
      corePath: `${origin}/vendor/tesseract/core/`,
      langPath: `${origin}/vendor/tesseract/lang/`,
      gzip: false,
    });
    return tesseractWorker;
  };

  try {
    for (let i = 1; i <= pdf.numPages; i += 1) {
      if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const pdfjsPage = await pdf.getPage(i);
      try {
        const vp = pdfjsPage.getViewport({ scale: 1 });
        const tc = await pdfjsPage.getTextContent();
        const buckets: Record<number, number> = { 0: 0, 90: 0, 180: 0, 270: 0 };
        let totalWeight = 0;

        for (const item of tc.items) {
          if (!('str' in item)) continue;
          const weight = item.str.trim().length;
          if (weight === 0) continue;
          const m = pdfjs.Util.transform(vp.transform, item.transform);
          const deg = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
          const snapped = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
          const neededDelta = (360 - snapped) % 360;
          buckets[neededDelta] = (buckets[neededDelta] || 0) + weight;
          totalWeight += weight;
        }

        let chosenDelta = 0;
        let reason = 'Already upright';

        if (totalWeight >= 6) {
          let bestDelta = 0;
          let bestWeight = -1;
          for (const d of [0, 90, 180, 270]) {
            if ((buckets[d] || 0) > bestWeight) {
              bestWeight = buckets[d] || 0;
              bestDelta = d;
            }
          }
          if (bestDelta !== 0 && bestWeight / totalWeight >= 0.55) {
            chosenDelta = bestDelta;
            reason = `Text baseline orientation (${Math.round((bestWeight / totalWeight) * 100)}% consensus)`;
          }
        } else {
          // Zero/minimal text page: compare horizontal vs vertical projection variance on thumbnail
          const canvas = document.createElement('canvas');
          try {
            await renderPdfPageToCanvas(pdf, i, canvas, 0.35);
            const ctx = canvas.getContext('2d');
            if (ctx && canvas.width > 16 && canvas.height > 16) {
              const { width: cw, height: ch } = canvas;
              const data = ctx.getImageData(0, 0, cw, ch).data;
              const rowInk = new Float64Array(ch);
              const colInk = new Float64Array(cw);
              let totalInk = 0;

              for (let y = 0; y < ch; y += 1) {
                for (let x = 0; x < cw; x += 1) {
                  const idx = (y * cw + x) * 4;
                  const lum = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
                  if (lum < 200) {
                    const ink = 255 - lum;
                    rowInk[y] += ink;
                    colInk[x] += ink;
                    totalInk += 1;
                  }
                }
              }

              if (totalInk > 40) {
                const variance = (arr: Float64Array, norm: number) => {
                  let mean = 0;
                  for (let k = 0; k < arr.length; k += 1) mean += arr[k] / norm;
                  mean /= arr.length;
                  let v = 0;
                  for (let k = 0; k < arr.length; k += 1) {
                    const diff = arr[k] / norm - mean;
                    v += diff * diff;
                  }
                  return v / arr.length;
                };

                const rowVar = variance(rowInk, cw);
                const colVar = variance(colInk, ch);
                const ratio = colVar / Math.max(1e-6, rowVar);

                // Run Tesseract confidence check across [0, 90, 180, 270] (or [90, 270] when strongly vertical)
                // so 180° upside-down scans are reliably detected as well as sideways scans.
                try {
                  const worker = await getTesseractWorker();
                  const candidates = ratio >= 1.38 ? [90, 270] : [0, 180, 90, 270];
                  let bestAngle = 0;
                  let bestScore = -1;
                  for (const angle of candidates) {
                    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
                    const testCanvas = document.createElement('canvas');
                    try {
                      await renderPdfPageToCanvas(pdf, i, testCanvas, 0.9, angle);
                      const res = await worker.recognize(testCanvas);
                      const textLen = (res.data.text || '').trim().length;
                      const score = textLen >= 8 ? res.data.confidence + Math.min(20, textLen * 0.1) : 0;
                      if (score > bestScore) {
                        bestScore = score;
                        bestAngle = angle;
                      }
                    } finally {
                      testCanvas.width = 0;
                      testCanvas.height = 0;
                    }
                  }
                  if (bestScore >= 42 && bestAngle !== 0) {
                    chosenDelta = bestAngle;
                    reason =
                      bestAngle === 180
                        ? 'OCR detected upside-down (180°) scanned page'
                        : 'OCR orientation verification on scanned page';
                  }
                } catch {
                  if (ratio >= 1.38) {
                    chosenDelta = 90;
                    reason = 'Edge-projection detected sideways scan';
                  }
                }
              }
            }
          } finally {
            canvas.width = 0;
            canvas.height = 0;
          }
        }

        if (chosenDelta !== 0) {
          const libPage = pages[i - 1];
          const cur = libPage.getRotation().angle || 0;
          libPage.setRotation(degrees((cur + chosenDelta + 360) % 360));
          rotatedPages.push({ pageNumber: i, degreesApplied: chosenDelta, reason });
        }
      } finally {
        pdfjsPage.cleanup();
      }
      options?.onProgress?.(Math.round((i / pdf.numPages) * 92));
    }

    const bytes = await doc.save({ useObjectStreams: true });
    options?.onProgress?.(100);
    const stem = sanitizeFilenameStem(file.name, 'document');
    return {
      ...makeResult(bytes, `${stem}-autorotated.pdf`, 'application/pdf', t0, {
        pageCount: pages.length,
        summary:
          rotatedPages.length > 0
            ? `Auto-rotated ${rotatedPages.length} of ${pages.length} page(s)`
            : `All ${pages.length} page(s) already upright`,
      }),
      rotatedPages,
    };
  } finally {
    if (tesseractWorker) {
      await (tesseractWorker as { terminate: () => Promise<unknown> }).terminate().catch(() => {});
    }
    await pdf.destroy().catch(() => {});
  }
}

export async function rotatePdfByOrientation(
  file: File,
  angle: number,
  orientation: 'all' | 'portrait' | 'landscape',
  options?: { signal?: AbortSignal; onProgress?: (pct: number) => void }
): Promise<PdfProcessResult> {
  const t0 = performance.now();
  const doc = await loadPdfLibStrict(file);
  const pages = doc.getPages();
  let rotatedCount = 0;

  pages.forEach((page, idx) => {
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const { width, height } = page.getSize();
    const cur = (((page.getRotation().angle || 0) % 360) + 360) % 360;
    const visW = cur % 180 === 90 ? height : width;
    const visH = cur % 180 === 90 ? width : height;
    const matches =
      orientation === 'all' ||
      (orientation === 'portrait' && visH >= visW) ||
      (orientation === 'landscape' && visW > visH);

    if (matches && angle % 360 !== 0) {
      page.setRotation(degrees((cur + angle + 360) % 360));
      rotatedCount += 1;
    }
    options?.onProgress?.(Math.round(((idx + 1) / Math.max(1, pages.length)) * 90));
  });

  const bytes = await doc.save({ useObjectStreams: true });
  options?.onProgress?.(100);
  const stem = sanitizeFilenameStem(file.name, 'document');
  return makeResult(bytes, `${stem}-rotated.pdf`, 'application/pdf', t0, {
    pageCount: pages.length,
    summary: `Rotated ${rotatedCount} ${orientation === 'all' ? '' : `${orientation} `}page(s) by ${angle}°`,
  });
}

export async function inspectPdfBookmarks(file: File): Promise<BookmarkSplitEntry[]> {
  const pdf = await loadPdfJsDocument(file);
  try {
    const outline = await pdf.getOutline();
    if (!outline || outline.length === 0) return [];

    type RawOutlineItem = {
      title?: string;
      dest?: string | unknown[] | null;
      items?: RawOutlineItem[];
    };

    const flat: Array<{ title: string; level: number; startPage: number }> = [];

    const resolveDestPage = async (dest: string | unknown[] | null | undefined): Promise<number | null> => {
      if (!dest) return null;
      try {
        const resolved = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
        if (!Array.isArray(resolved) || resolved.length === 0) return null;
        const ref = resolved[0];
        if (typeof ref === 'number') return Math.max(1, Math.min(pdf.numPages, ref + 1));
        if (ref && typeof ref === 'object') {
          const idx = await pdf.getPageIndex(ref as Parameters<typeof pdf.getPageIndex>[0]);
          return Math.max(1, Math.min(pdf.numPages, idx + 1));
        }
      } catch {
        return null;
      }
      return null;
    };

    const walk = async (items: RawOutlineItem[], level: number) => {
      for (const item of items) {
        const pageNo = await resolveDestPage(item.dest);
        if (pageNo !== null) {
          flat.push({
            title: (item.title || `Section ${flat.length + 1}`).trim(),
            level,
            startPage: pageNo,
          });
        }
        if (Array.isArray(item.items) && item.items.length > 0) {
          await walk(item.items, level + 1);
        }
      }
    };

    await walk(outline as RawOutlineItem[], 1);

    const entries: BookmarkSplitEntry[] = [];
    for (let i = 0; i < flat.length; i += 1) {
      const cur = flat[i];
      let endPage = pdf.numPages;
      for (let j = i + 1; j < flat.length; j += 1) {
        if (flat[j].level <= cur.level && flat[j].startPage > cur.startPage) {
          endPage = flat[j].startPage - 1;
          break;
        }
      }
      entries.push({
        title: cur.title,
        level: cur.level,
        startPage: cur.startPage,
        endPage: Math.max(cur.startPage, endPage),
      });
    }
    return entries;
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

export async function splitPdfByBookmarks(
  file: File,
  options?: { maxLevel?: number; signal?: AbortSignal; onProgress?: (pct: number) => void }
): Promise<PdfProcessResult> {
  const t0 = performance.now();
  const allEntries = await inspectPdfBookmarks(file);
  if (allEntries.length === 0) {
    throw new PdfToolError('No bookmarks or outline chapters were found in this PDF.', 'validation');
  }

  const maxLevel = options?.maxLevel ?? Number.POSITIVE_INFINITY;
  const filtered = allEntries.filter((e) => e.level <= maxLevel);
  const chosen = filtered.length > 0 ? filtered : allEntries;

  const src = await loadPdfLibStrict(file);
  const totalPages = src.getPageCount();
  const zip = new JSZip();
  const stem = sanitizeFilenameStem(file.name, 'document');

  for (let i = 0; i < chosen.length; i += 1) {
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const entry = chosen[i];
    const nextStart = i + 1 < chosen.length ? chosen[i + 1].startPage : totalPages + 1;
    const endPage = Math.max(entry.startPage, Math.min(totalPages, nextStart - 1));

    const indices: number[] = [];
    for (let p = entry.startPage; p <= endPage; p += 1) {
      indices.push(p - 1);
    }
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, indices);
    for (const p of copied) out.addPage(p);
    const bytes = await out.save({ useObjectStreams: true });
    const safeTitle = sanitizeFilenameStem(entry.title, `Chapter_${i + 1}`).slice(0, 64);
    zip.file(`${String(i + 1).padStart(2, '0')}_${safeTitle}.pdf`, bytes);
    options?.onProgress?.(Math.round(((i + 1) / chosen.length) * 90));
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  options?.onProgress?.(100);
  return makeResult(zipBlob, `${stem}-chapters.zip`, 'application/zip', t0, {
    pageCount: totalPages,
    summary: `Split into ${chosen.length} bookmark chapter PDF(s)`,
  });
}

export async function mergePdfPagesExpanded(
  items: Array<{ file: File; pageIndex: number }>,
  options?: { outputName?: string; signal?: AbortSignal; onProgress?: (pct: number) => void }
): Promise<PdfProcessResult> {
  if (items.length === 0) {
    throw new PdfToolError('Select at least one page to merge.', 'validation');
  }
  const t0 = performance.now();
  const merged = await PDFDocument.create();
  const cache = new Map<File, PDFDocument>();
  const neededIndicesByFile = new Map<File, Set<number>>();

  for (let i = 0; i < items.length; i += 1) {
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const { file, pageIndex } = items[i];
    let src = cache.get(file);
    if (!src) {
      src = await loadPdfLibStrict(file);
      cache.set(file, src);
    }
    if (pageIndex < 0 || pageIndex >= src.getPageCount()) {
      throw new PdfToolError(`Page index ${pageIndex + 1} is out of range for ${file.name}.`, 'validation');
    }
    let set = neededIndicesByFile.get(file);
    if (!set) {
      set = new Set<number>();
      neededIndicesByFile.set(file, set);
    }
    set.add(pageIndex);
  }

  // Batch-copy all needed pages per source PDF once so shared fonts/XObjects/ICC profiles are deduplicated!
  const copiedByFileAndIndex = new Map<File, Map<number, PDFPage>>();
  let copiedDone = 0;
  for (const [file, idxSet] of Array.from(neededIndicesByFile.entries())) {
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const src = cache.get(file)!;
    const indices = Array.from(idxSet).sort((a, b) => a - b);
    const copiedPages = await merged.copyPages(src, indices);
    const pageMap = new Map<number, PDFPage>();
    indices.forEach((origIdx, k) => {
      pageMap.set(origIdx, copiedPages[k]);
    });
    copiedByFileAndIndex.set(file, pageMap);
    copiedDone += 1;
    options?.onProgress?.(Math.round((copiedDone / Math.max(1, neededIndicesByFile.size)) * 85));
  }

  for (const { file, pageIndex } of items) {
    const page = copiedByFileAndIndex.get(file)?.get(pageIndex);
    if (page) merged.addPage(page);
  }

  const bytes = await merged.save({ useObjectStreams: true });
  options?.onProgress?.(100);
  const outName = options?.outputName?.trim()
    ? `${sanitizeFilenameStem(options.outputName, 'merged')}.pdf`
    : `${sanitizeFilenameStem(items[0].file.name, 'merged')}-merged.pdf`;
  return makeResult(bytes, outName, 'application/pdf', t0, {
    pageCount: merged.getPageCount(),
    summary: `Merged ${items.length} page(s) from ${cache.size} PDF(s) with shared resource deduplication`,
  });
}

export async function inspectPdfDeep(file: File): Promise<PdfDeepInspectionResult> {
  await assertValidPdfFile(file);
  const rawBytes = new Uint8Array(await file.arrayBuffer());
  const headerSlice = new TextDecoder('latin1').decode(rawBytes.slice(0, 64));
  const headerMatch = /%PDF-(\d+\.\d+)/.exec(headerSlice);
  const headerVersion = headerMatch?.[1] || '1.4';

  const doc = await PDFDocument.load(rawBytes, { ignoreEncryption: true });
  const catalogVersionObj = doc.catalog.lookup(PDFName.of('Version'));
  const catalogVersion =
    catalogVersionObj instanceof PDFName ? catalogVersionObj.decodeText() : undefined;
  const effectiveVersion = catalogVersion || headerVersion;
  const objectCount = doc.context.enumerateIndirectObjects().length;

  const pdfPages = doc.getPages();
  const sizeKeys = new Set<string>();
  const pages: PdfDeepInspectionResult['pages'] = pdfPages.map((page, idx) => {
    const { width, height } = page.getSize();
    const rot = (((page.getRotation().angle || 0) % 360) + 360) % 360;
    const widthPt = Math.round((rot % 180 === 90 ? height : width) * 100) / 100;
    const heightPt = Math.round((rot % 180 === 90 ? width : height) * 100) / 100;
    const widthMm = Math.round((widthPt / 72) * 25.4 * 10) / 10;
    const heightMm = Math.round((heightPt / 72) * 25.4 * 10) / 10;
    const widthIn = Math.round((widthPt / 72) * 100) / 100;
    const heightIn = Math.round((heightPt / 72) * 100) / 100;
    const paperName = classifyPaperName(widthPt, heightPt);
    sizeKeys.add(`${Math.round(widthPt)}x${Math.round(heightPt)}`);
    return {
      pageNumber: idx + 1,
      widthPt,
      heightPt,
      widthMm,
      heightMm,
      widthIn,
      heightIn,
      paperName,
      rotation: rot,
    };
  });

  // Detect PDF/A conformance from XMP packet + OutputIntents
  let pdfaConformance: string | null = null;
  const xmpStream = doc.catalog.lookup(PDFName.of('Metadata'));
  if (xmpStream instanceof PDFRawStream) {
    try {
      const xmpText = new TextDecoder('utf-8', { fatal: false }).decode(decodePDFRawStream(xmpStream).decode());
      const partM = /pdfaid:part[=>"\s]+(\d+)/i.exec(xmpText);
      const confM = /pdfaid:conformance[=>"\s]+([A-Z])/i.exec(xmpText);
      if (partM) {
        pdfaConformance = `PDF/A-${partM[1]}${confM ? confM[1].toLowerCase() : ''}`;
      }
    } catch {}
  }

  // Decode Encryption & /P permission bitmask
  let encryptionInfo: PdfDeepInspectionResult['encryptionInfo'] | undefined;
  const encRef = doc.context.trailerInfo.Encrypt;
  if (encRef) {
    const encDict = doc.context.lookup(encRef);
    if (encDict instanceof PDFDict) {
      const filterObj = encDict.lookup(PDFName.of('Filter'));
      const lengthObj = encDict.lookup(PDFName.of('Length'));
      const rObj = encDict.lookup(PDFName.of('R'));
      const pObj = encDict.lookup(PDFName.of('P'));
      const pVal = pObj instanceof PDFNumber ? pObj.asNumber() : 0;
      const bit = (n: number) => ((pVal & (1 << (n - 1))) !== 0);
      encryptionInfo = {
        filter: filterObj instanceof PDFName ? filterObj.decodeText() : 'Standard',
        keyBits: lengthObj instanceof PDFNumber ? lengthObj.asNumber() : 128,
        revision: rObj instanceof PDFNumber ? rObj.asNumber() : undefined,
        allowPrint: bit(3),
        allowModify: bit(4),
        allowCopy: bit(5),
        allowAnnotate: bit(6),
        allowFillForms: bit(9),
        allowAssemble: bit(11),
        allowPrintHighRes: bit(12),
      };
    }
  }

  const hasMixedPageSizes = sizeKeys.size > 1;
  const pageSizesSummary =
    pages.length === 0
      ? '0 pages'
      : hasMixedPageSizes
      ? `Mixed (${sizeKeys.size} sizes across ${pages.length} pages)`
      : `All ${pages[0].paperName} (${pages[0].widthMm} × ${pages[0].heightMm} mm)`;

  // Font inventory walking /Resources/Font and Type0 /DescendantFonts
  const fontMap = new Map<
    string,
    {
      baseFont: string;
      cleanFamily: string;
      subtype: string;
      isSubset: boolean;
      isEmbedded: boolean;
      streamBytes: number;
      pages: Set<number>;
    }
  >();

  const getDescriptorEmbedInfo = (desc: PDFDict): { isEmbedded: boolean; streamBytes: number } => {
    for (const key of ['FontFile', 'FontFile2', 'FontFile3']) {
      const fObj = desc.lookup(PDFName.of(key));
      if (fObj instanceof PDFRawStream) {
        return { isEmbedded: true, streamBytes: fObj.getContents().length };
      }
      if (fObj instanceof PDFStream) {
        return { isEmbedded: true, streamBytes: 0 };
      }
    }
    return { isEmbedded: false, streamBytes: 0 };
  };

  pdfPages.forEach((page, idx) => {
    const pageNo = idx + 1;
    const res = page.node.Resources();
    if (!res) return;
    const fontDict = res.lookupMaybe(PDFName.of('Font'), PDFDict);
    if (!fontDict) return;

    for (const [, val] of fontDict.entries()) {
      const f = doc.context.lookup(val);
      if (!(f instanceof PDFDict)) continue;

      const baseNameObj = f.lookup(PDFName.of('BaseFont'));
      const baseFont = baseNameObj instanceof PDFName ? baseNameObj.decodeText() : 'Unknown';
      const subtypeObj = f.lookup(PDFName.of('Subtype'));
      const subtype = subtypeObj instanceof PDFName ? subtypeObj.decodeText() : 'Font';
      const isSubset = /^[A-Z]{6}\+/.test(baseFont);
      const cleanFamily = baseFont.replace(/^[A-Z]{6}\+/, '');

      let isEmbedded = false;
      let streamBytes = 0;

      const directDesc = f.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
      if (directDesc) {
        const info = getDescriptorEmbedInfo(directDesc);
        isEmbedded = info.isEmbedded;
        streamBytes = info.streamBytes;
      } else if (subtype === 'Type0') {
        const descendants = f.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
        if (descendants) {
          for (let d = 0; d < descendants.size(); d += 1) {
            const cidFont = descendants.lookup(d);
            if (cidFont instanceof PDFDict) {
              const cidDesc = cidFont.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
              if (cidDesc) {
                const info = getDescriptorEmbedInfo(cidDesc);
                if (info.isEmbedded) {
                  isEmbedded = true;
                  streamBytes += info.streamBytes;
                }
              }
            }
          }
        }
      }

      const mapKey = `${baseFont}|${subtype}`;
      const existing = fontMap.get(mapKey);
      if (existing) {
        existing.pages.add(pageNo);
        if (isEmbedded && !existing.isEmbedded) {
          existing.isEmbedded = true;
          existing.streamBytes = streamBytes;
        }
      } else {
        fontMap.set(mapKey, {
          baseFont,
          cleanFamily,
          subtype,
          isSubset,
          isEmbedded,
          streamBytes,
          pages: new Set([pageNo]),
        });
      }
    }
  });

  const fonts: PdfDeepInspectionResult['fonts'] = Array.from(fontMap.values()).map((entry) => ({
    baseFont: entry.baseFont,
    cleanFamily: entry.cleanFamily,
    subtype: entry.subtype,
    isSubset: entry.isSubset,
    isEmbedded: entry.isEmbedded,
    streamBytes: entry.streamBytes,
    pages: Array.from(entry.pages).sort((a, b) => a - b),
  }));

  // JavaScript extraction across all 5 PDF action locations
  const scripts: PdfDeepInspectionResult['scripts'] = [];
  const decodeJsObject = (obj: unknown): string => {
    if (obj instanceof PDFString || obj instanceof PDFHexString) {
      return obj.decodeText();
    }
    if (obj instanceof PDFRawStream) {
      try {
        return new TextDecoder('utf-8', { fatal: false }).decode(decodePDFRawStream(obj).decode());
      } catch {
        return new TextDecoder('latin1').decode(obj.getContents());
      }
    }
    return '';
  };

  const inspectActionDict = (action: unknown, location: string) => {
    const resolved = action instanceof PDFRef ? doc.context.lookup(action) : action;
    if (!(resolved instanceof PDFDict)) return;
    if (resolved.lookup(PDFName.of('S')) === PDFName.of('JavaScript')) {
      const code = decodeJsObject(resolved.lookup(PDFName.of('JS'))).trim();
      if (code) scripts.push({ location, code });
    }
    const next = resolved.lookup(PDFName.of('Next'));
    if (next instanceof PDFDict) {
      inspectActionDict(next, `${location} -> Next`);
    } else if (next instanceof PDFArray) {
      for (let i = 0; i < next.size(); i += 1) {
        inspectActionDict(next.lookup(i), `${location} -> Next[${i}]`);
      }
    }
  };

  const inspectAdditionalActions = (aaDict: unknown, prefix: string) => {
    const resolved = aaDict instanceof PDFRef ? doc.context.lookup(aaDict) : aaDict;
    if (!(resolved instanceof PDFDict)) return;
    for (const [k, v] of resolved.entries()) {
      inspectActionDict(v, `${prefix} /AA/${k.decodeText()}`);
    }
  };

  // 1. /Names/JavaScript name tree
  const walkJsNameTree = (node: unknown, prefix: string) => {
    const dict = node instanceof PDFRef ? doc.context.lookup(node) : node;
    if (!(dict instanceof PDFDict)) return;
    const namesArr = dict.lookupMaybe(PDFName.of('Names'), PDFArray);
    if (namesArr) {
      for (let i = 0; i + 1 < namesArr.size(); i += 2) {
        const label = decodeJsObject(namesArr.lookup(i)) || `Script #${i / 2 + 1}`;
        inspectActionDict(namesArr.lookup(i + 1), `${prefix} (${label})`);
      }
    }
    const kids = dict.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (kids) {
      for (let i = 0; i < kids.size(); i += 1) {
        walkJsNameTree(kids.lookup(i), prefix);
      }
    }
  };

  const namesDict = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (namesDict) {
    const jsTree = namesDict.lookup(PDFName.of('JavaScript'));
    if (jsTree) walkJsNameTree(jsTree, 'Catalog /Names/JavaScript');
  }

  // 2. Catalog /OpenAction (and Catalog /AA)
  const openAction = doc.catalog.lookup(PDFName.of('OpenAction'));
  if (openAction) inspectActionDict(openAction, 'Catalog /OpenAction');
  const catalogAA = doc.catalog.lookup(PDFName.of('AA'));
  if (catalogAA) inspectAdditionalActions(catalogAA, 'Catalog');

  // 3, 4, 5. Page /AA, Widget /AA, Link /A
  pdfPages.forEach((page, idx) => {
    const pageNo = idx + 1;
    const pageAA = page.node.lookup(PDFName.of('AA'));
    if (pageAA) inspectAdditionalActions(pageAA, `Page ${pageNo}`);

    const annots = page.node.lookup(PDFName.of('Annots'));
    if (annots instanceof PDFArray) {
      for (let i = 0; i < annots.size(); i += 1) {
        const annot = annots.lookup(i);
        if (!(annot instanceof PDFDict)) continue;
        const subtypeObj = annot.lookup(PDFName.of('Subtype'));
        const subtype = subtypeObj instanceof PDFName ? subtypeObj.decodeText() : 'Annot';
        const fieldName = decodeJsObject(annot.lookup(PDFName.of('T')));
        const label = fieldName ? `${subtype} "${fieldName}"` : `${subtype} #${i + 1}`;

        if (subtype === 'Widget') {
          const wAA = annot.lookup(PDFName.of('AA'));
          if (wAA) inspectAdditionalActions(wAA, `Page ${pageNo} Widget (${label})`);
          const wA = annot.lookup(PDFName.of('A'));
          if (wA) inspectActionDict(wA, `Page ${pageNo} Widget (${label}) /A`);
        } else if (subtype === 'Link') {
          const lA = annot.lookup(PDFName.of('A'));
          if (lA) inspectActionDict(lA, `Page ${pageNo} Link #${i + 1} /A`);
        } else {
          const aAA = annot.lookup(PDFName.of('AA'));
          if (aAA) inspectAdditionalActions(aAA, `Page ${pageNo} ${label}`);
          const aA = annot.lookup(PDFName.of('A'));
          if (aA) inspectActionDict(aA, `Page ${pageNo} ${label} /A`);
        }
      }
    }
  });

  return {
    headerVersion,
    catalogVersion,
    effectiveVersion,
    pdfaConformance,
    isEncrypted: doc.isEncrypted,
    encryptionInfo,
    fileSizeBytes: file.size,
    objectCount,
    pageCount: pages.length,
    pageSizesSummary,
    hasMixedPageSizes,
    pages,
    fonts,
    scripts,
  };
}

export async function clearReadOnlyFormFields(file: File): Promise<PdfProcessResult> {
  const t0 = performance.now();
  const doc = await loadPdfLibStrict(file);
  let unlockedCount = 0;
  try {
    const form = doc.getForm();
    const fields = form.getFields();
    for (const field of fields) {
      field.disableReadOnly();
      unlockedCount += 1;
    }
  } catch {
    // Document has no AcroForm dictionary
  }
  const bytes = await doc.save({ useObjectStreams: true });
  const stem = sanitizeFilenameStem(file.name, 'document');
  return makeResult(bytes, `${stem}-unlocked-fields.pdf`, 'application/pdf', t0, {
    pageCount: doc.getPageCount(),
    summary:
      unlockedCount > 0
        ? `Unlocked ${unlockedCount} form field(s) (removed read-only flags)`
        : 'No AcroForm fields found to unlock',
  });
}
