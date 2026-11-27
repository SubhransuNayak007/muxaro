import { getPageTextSpans, loadPdfJsDocument } from '@/lib/pdf/pdf-browser';
import { runPdfOcr } from '@/lib/pdf/ocr-engine';
import type { PdfTextSpan } from '@/lib/pdf/types';
import type { DocumentLayoutIR, LayoutBlock, NormalizedRect } from './types';

function mergeRects(rects: NormalizedRect[]): NormalizedRect[] {
  if (rects.length <= 1) return rects;
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: NormalizedRect[] = [];
  for (const r of sorted) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      Math.abs(prev.y - r.y) <= Math.max(prev.height, r.height) * 0.55 &&
      r.x <= prev.x + prev.width + 0.035
    ) {
      const right = Math.max(prev.x + prev.width, r.x + r.width);
      const bottom = Math.max(prev.y + prev.height, r.y + r.height);
      prev.x = Math.min(prev.x, r.x);
      prev.y = Math.min(prev.y, r.y);
      prev.width = right - prev.x;
      prev.height = bottom - prev.y;
    } else {
      merged.push({ ...r });
    }
  }
  return merged.slice(0, 14);
}

/**
 * Detects whether a page uses a clear 2-column gutter in normalized coordinates (0.38..0.62)
 * using horizontal occupancy projection so 2-column reading order is never scrambled.
 */
function detectTwoColumnSplit(spans: PdfTextSpan[]): number | null {
  if (spans.length < 18) return null;
  const buckets = new Int32Array(20);
  for (const sp of spans) {
    if (sp.y < 0.08 || sp.y > 0.92) continue;
    const x0 = Math.max(0, Math.min(19, Math.floor(sp.x * 20)));
    const x1 = Math.max(x0, Math.min(19, Math.floor((sp.x + sp.width) * 20)));
    for (let b = x0; b <= x1; b += 1) {
      buckets[b] += 1;
    }
  }
  const leftMass = buckets.slice(1, 8).reduce((s, v) => s + v, 0);
  const rightMass = buckets.slice(12, 19).reduce((s, v) => s + v, 0);
  if (leftMass < 8 || rightMass < 8) return null;

  for (let b = 8; b <= 11; b += 1) {
    if (buckets[b] <= 1 && buckets[b + 1] <= 1) {
      return (b + 1) / 20;
    }
  }
  return null;
}

function groupSpansIntoBlocks(
  spans: PdfTextSpan[],
  pageNumber: number,
  medianFontSize: number,
  currentSection: { title: string }
): LayoutBlock[] {
  if (!spans.length) return [];

  const splitX = detectTwoColumnSplit(spans);
  const fullWidthHeaders: PdfTextSpan[] = [];
  const col0: PdfTextSpan[] = [];
  const col1: PdfTextSpan[] = [];

  for (const sp of spans) {
    if (!sp.text.trim()) continue;
    if (splitX === null) {
      col0.push(sp);
    } else if (sp.x < splitX && sp.x + sp.width > splitX + 0.06 && sp.y < 0.25) {
      fullWidthHeaders.push(sp);
    } else if (sp.x + sp.width * 0.5 < splitX) {
      col0.push(sp);
    } else {
      col1.push(sp);
    }
  }

  const columns: Array<{ colIdx: number; items: PdfTextSpan[] }> = [];
  if (fullWidthHeaders.length) columns.push({ colIdx: 0, items: fullWidthHeaders });
  if (col0.length) columns.push({ colIdx: 0, items: col0 });
  if (col1.length) columns.push({ colIdx: 1, items: col1 });

  const blocks: LayoutBlock[] = [];
  let seq = 0;

  for (const col of columns) {
    const ordered = [...col.items].sort((a, b) => a.y - b.y || a.x - b.x);
    const lines: Array<{
      y: number;
      height: number;
      fontSize: number;
      bold: boolean;
      spans: PdfTextSpan[];
      text: string;
    }> = [];

    for (const sp of ordered) {
      const last = lines[lines.length - 1];
      const dyTol = Math.max(0.012, Math.max(last?.height || 0.014, sp.height) * 0.6);
      if (last && Math.abs(last.y - sp.y) <= dyTol) {
        last.spans.push(sp);
        last.fontSize = (last.fontSize + sp.fontSize) * 0.5;
        last.bold = last.bold && sp.bold;
      } else {
        lines.push({
          y: sp.y,
          height: sp.height,
          fontSize: sp.fontSize,
          bold: sp.bold,
          spans: [sp],
          text: '',
        });
      }
    }

    for (const line of lines) {
      line.spans.sort((a, b) => a.x - b.x);
      let joined = '';
      for (let i = 0; i < line.spans.length; i += 1) {
        const cur = line.spans[i];
        const prev = i > 0 ? line.spans[i - 1] : null;
        if (prev) {
          const gap = cur.x - (prev.x + prev.width);
          if (gap > 0.004 && !joined.endsWith(' ') && !cur.text.startsWith(' ')) {
            joined += gap > 0.035 ? ' | ' : ' ';
          }
        }
        joined += cur.text;
      }
      line.text = joined.trim();
    }

    let activeBlock: {
      kind: LayoutBlock['kind'];
      texts: string[];
      rects: NormalizedRect[];
      fontSize: number;
      sectionTitle: string;
    } | null = null;
    let prevLineBottom = 0;

    const flush = () => {
      if (!activeBlock) return;
      const text = activeBlock.texts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      if (text.length >= 2) {
        blocks.push({
          id: `b-${pageNumber}-${col.colIdx}-${seq++}`,
          pageNumber,
          columnIndex: col.colIdx,
          kind: activeBlock.kind,
          text,
          fontSize: Math.round(activeBlock.fontSize * 10) / 10,
          sectionTitle: activeBlock.sectionTitle,
          rects: mergeRects(activeBlock.rects),
        });
      }
      activeBlock = null;
    };

    for (const line of lines) {
      if (!line.text) continue;
      const isHeading =
        (line.fontSize >= medianFontSize * 1.18 && line.text.length <= 120) ||
        (line.bold && line.fontSize >= medianFontSize * 0.98 && line.text.length <= 85 && !/[.,;]$/.test(line.text));
      const isList = /^([-*•]|\d+[.)])\s+/.test(line.text);
      const isTableRow = line.text.includes(' | ') && line.text.split(' | ').length >= 3;
      const lineRects: NormalizedRect[] = line.spans.map((s) => ({
        x: s.x,
        y: s.y,
        width: s.width,
        height: s.height,
      }));

      if (isHeading) {
        flush();
        currentSection.title = line.text;
        blocks.push({
          id: `b-${pageNumber}-${col.colIdx}-${seq++}`,
          pageNumber,
          columnIndex: col.colIdx,
          kind: 'heading',
          text: line.text,
          fontSize: Math.round(line.fontSize * 10) / 10,
          sectionTitle: line.text,
          rects: mergeRects(lineRects),
        });
        prevLineBottom = line.y + line.height;
        continue;
      }

      const kind: LayoutBlock['kind'] = isTableRow ? 'table' : isList ? 'list' : 'paragraph';
      const verticalGap = line.y - prevLineBottom;
      const shouldSplit =
        !activeBlock ||
        activeBlock.kind !== kind ||
        verticalGap > Math.max(0.028, line.height * 1.9) ||
        activeBlock.texts.join(' ').length > 720;

      if (shouldSplit) {
        flush();
        activeBlock = {
          kind,
          texts: [line.text],
          rects: [...lineRects],
          fontSize: line.fontSize,
          sectionTitle: currentSection.title,
        };
      } else if (activeBlock) {
        activeBlock.texts.push(line.text);
        activeBlock.rects.push(...lineRects);
      }
      prevLineBottom = line.y + line.height;
    }

    flush();
  }

  return blocks;
}

export async function computeFileQuickHash(file: File): Promise<string> {
  const head = await file.slice(0, Math.min(file.size, 65536)).arrayBuffer();
  const tail = await file.slice(Math.max(0, file.size - 16384), file.size).arrayBuffer();
  const joined = new Uint8Array(head.byteLength + tail.byteLength + 16);
  joined.set(new Uint8Array(head), 0);
  joined.set(new Uint8Array(tail), head.byteLength);
  const meta = new TextEncoder().encode(`${file.name}:${file.size}:${file.lastModified}`).slice(0, 16);
  joined.set(meta, head.byteLength + tail.byteLength);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', joined);
    return Array.from(new Uint8Array(digest))
      .slice(0, 12)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return `${file.name}-${file.size}-${file.lastModified}`;
}

export async function extractDocumentLayoutIR(
  file: File,
  options?: {
    autoOcrScanned?: boolean;
    maxOcrPages?: number;
    onProgress?: (pct: number, status: string) => void;
    signal?: AbortSignal;
  }
): Promise<DocumentLayoutIR> {
  const docId = await computeFileQuickHash(file);
  const pdf = await loadPdfJsDocument(file);
  const pageCount = pdf.numPages;

  const spansByPage = new Map<number, PdfTextSpan[]>();
  const fontSizes: number[] = [];
  const scannedPages: number[] = [];

  try {
    for (let p = 1; p <= pageCount; p += 1) {
      if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      options?.onProgress?.(Math.round((p / Math.max(1, pageCount)) * 65), `Parsing page ${p} of ${pageCount}…`);
      const spans = await getPageTextSpans(pdf, p);
      spansByPage.set(p, spans);
      const selectableChars = spans.reduce((s, sp) => s + sp.text.trim().length, 0);
      if (selectableChars < 28) {
        scannedPages.push(p);
      }
      for (const sp of spans) {
        if (sp.fontSize > 4 && sp.fontSize < 96) fontSizes.push(sp.fontSize);
      }
    }
  } finally {
    await pdf.destroy().catch(() => {});
  }

  fontSizes.sort((a, b) => a - b);
  const medianFontSize = fontSizes.length ? fontSizes[Math.floor(fontSizes.length * 0.5)] : 11;

  const ocrProcessedPages: number[] = [];
  const allBlocks: LayoutBlock[] = [];
  const currentSection = { title: 'Introduction' };

  for (let p = 1; p <= pageCount; p += 1) {
    const spans = spansByPage.get(p) || [];
    const blocks = groupSpansIntoBlocks(spans, p, medianFontSize, currentSection);
    allBlocks.push(...blocks);
  }

  if (options?.autoOcrScanned && scannedPages.length > 0 && scannedPages.length <= (options.maxOcrPages ?? 15)) {
    options?.onProgress?.(72, `Running local Tesseract OCR on ${scannedPages.length} scanned page(s)…`);
    const ocrOut = await runPdfOcr(
      file,
      { mode: 'ocr', maxPages: options.maxOcrPages ?? 15, outputFormat: 'txt' },
      (pct, msg) => options?.onProgress?.(72 + Math.round(pct * 0.25), msg || 'Running OCR…'),
      options.signal
    );
    for (const pg of ocrOut.pages) {
      if (!scannedPages.includes(pg.pageNumber) || !pg.text.trim()) continue;
      ocrProcessedPages.push(pg.pageNumber);
      const w = Math.max(1, pg.renderWidth || 1);
      const h = Math.max(1, pg.renderHeight || 1);
      const rects: NormalizedRect[] = pg.words.slice(0, 24).map((wd) => ({
        x: Math.max(0, Math.min(1, wd.bbox.x0 / w)),
        y: Math.max(0, Math.min(1, wd.bbox.y0 / h)),
        width: Math.max(0.01, Math.min(1, (wd.bbox.x1 - wd.bbox.x0) / w)),
        height: Math.max(0.01, Math.min(1, (wd.bbox.y1 - wd.bbox.y0) / h)),
      }));
      allBlocks.push({
        id: `ocr-${pg.pageNumber}`,
        pageNumber: pg.pageNumber,
        columnIndex: 0,
        kind: 'paragraph',
        text: pg.text.trim(),
        fontSize: medianFontSize,
        sectionTitle: `Scanned Page ${pg.pageNumber}`,
        rects: mergeRects(rects),
        isOcr: true,
      });
    }
  }

  allBlocks.sort((a, b) => a.pageNumber - b.pageNumber || a.columnIndex - b.columnIndex);

  return {
    docId,
    fileName: file.name,
    pageCount,
    scannedPages,
    ocrProcessedPages,
    medianFontSize,
    blocks: allBlocks,
    indexedAt: Date.now(),
  };
}
