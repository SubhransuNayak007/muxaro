import { PDFDocument, StandardFonts, rgb, TextRenderingMode, pushGraphicsState, popGraphicsState, setTextRenderingMode } from 'pdf-lib';
import { sanitizeFilenameStem } from './errors.ts';
import { loadPdfJsDocument, renderPdfPageToBlob } from './pdf-browser.ts';
import type { PdfProcessResult } from './types.ts';

export interface OcrWordBox {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  fontSize?: number;
  baseline?: number;
}

export interface OcrPageOutput {
  pageNumber: number;
  text: string;
  confidence: number;
  words: OcrWordBox[];
  renderWidth: number;
  renderHeight: number;
}

function multiplyAffine2D(
  m1: readonly number[],
  m2: readonly number[]
): [number, number, number, number, number, number] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export async function runPdfOcr(
  file: File,
  options: {
    mode: 'text-layer' | 'ocr';
    maxPages?: number;
    concurrency?: number;
    outputFormat: 'txt' | 'md' | 'searchable-pdf';
  },
  onProgress?: (pct: number, status?: string) => void,
  signal?: AbortSignal
): Promise<{
  pages: OcrPageOutput[];
  fullText: string;
  result: PdfProcessResult;
}> {
  const t0 = performance.now();
  const stem = sanitizeFilenameStem(file.name, 'document');

  if (options.mode === 'text-layer') {
    const pdf = await loadPdfJsDocument(file);
    try {
      const pages: OcrPageOutput[] = [];
      for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const page = await pdf.getPage(pageNo);
        try {
          const vp = page.getViewport({ scale: 1 });
          const tc = await page.getTextContent();
          const words: OcrWordBox[] = [];
          let buf = '';

          for (const raw of tc.items) {
            if (!('str' in raw)) continue;
            const tx = multiplyAffine2D(vp.transform, raw.transform);
            const fontSize = Math.max(4, Math.hypot(tx[0], tx[1]) || raw.height || 11);
            buf += raw.str;
            if (raw.hasEOL) {
              buf += '\n';
            } else if (raw.str.length > 0 && !raw.str.endsWith(' ') && (raw.width || 0) > fontSize * 0.16) {
              buf += ' ';
            }

            if (!raw.str.trim()) continue;
            const itemHeight = Math.max(4, raw.height > 0 ? raw.height : fontSize);
            const itemWidth = Math.max(1, raw.width > 0 ? raw.width : raw.str.length * fontSize * 0.5);
            const originX = tx[4];
            const baselineY = tx[5];
            const totalLen = Math.max(1, raw.str.length);

            for (const match of raw.str.matchAll(/\S+/g)) {
              const wordText = match[0];
              const startIdx = match.index ?? 0;
              const endIdx = startIdx + wordText.length;
              const x0 = originX + (startIdx / totalLen) * itemWidth;
              const x1 = Math.max(x0 + 1, originX + (endIdx / totalLen) * itemWidth);
              const y0 = baselineY - itemHeight * 0.82;
              const y1 = baselineY + itemHeight * 0.18;

              words.push({
                text: wordText,
                bbox: { x0, y0, x1, y1 },
                fontSize: Math.round(fontSize * 100) / 100,
                baseline: Math.round(baselineY * 100) / 100,
              });
            }
          }

          const cleanText = buf.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
          pages.push({
            pageNumber: pageNo,
            text: cleanText,
            confidence: 100,
            words,
            renderWidth: Math.round(vp.width),
            renderHeight: Math.round(vp.height),
          });
        } finally {
          page.cleanup();
        }
        onProgress?.(Math.round((pageNo / pdf.numPages) * 100), 'Extracting embedded text layer…');
      }

      const fullTextPlain = pages
        .map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`)
        .join('\n\n');
      const textPayload =
        options.outputFormat === 'md'
          ? pages.map((p) => `## Page ${p.pageNumber}\n\n${p.text || '_Empty page_'}`).join('\n\n')
          : fullTextPlain;
      const ext = options.outputFormat === 'md' ? 'md' : 'txt';
      const blob = new Blob([textPayload], { type: 'text/plain;charset=utf-8' });
      return {
        pages,
        fullText: textPayload,
        result: {
          blob,
          url: URL.createObjectURL(blob),
          fileName: `${stem}-extracted.${ext}`,
          mimeType: 'text/plain;charset=utf-8',
          sizeBytes: blob.size,
          elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
          pageCount: pages.length,
          summary: `Extracted text from ${pages.length} page(s)`,
        },
      };
    } finally {
      await pdf.destroy().catch(() => {});
    }
  }

  // OCR Mode: Bounded Tesseract.js worker pool with local /vendor/tesseract assets
  const { createWorker, OEM } = await import('tesseract.js');
  const origin = window.location.origin;
  const pdf = await loadPdfJsDocument(file);
  const totalToProcess = options.maxPages
    ? Math.min(pdf.numPages, options.maxPages)
    : pdf.numPages;

  const poolSize = Math.min(Math.max(1, options.concurrency ?? 2), totalToProcess, 3);
  const workers = await Promise.all(
    Array.from({ length: poolSize }, () =>
      createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: `${origin}/vendor/tesseract/worker.min.js`,
        corePath: `${origin}/vendor/tesseract/core/`,
        langPath: `${origin}/vendor/tesseract/lang/`,
        gzip: false,
      })
    )
  );

  const outputs: OcrPageOutput[] = new Array(totalToProcess);
  const renderedImages: Array<{ blob: Blob; pdfW: number; pdfH: number; pxW: number; pxH: number }> =
    new Array(totalToProcess);

  try {
    let nextIdx = 0;
    let doneCount = 0;

    const workerLoop = async (worker: Awaited<ReturnType<typeof createWorker>>) => {
      while (true) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const idx = nextIdx;
        nextIdx += 1;
        if (idx >= totalToProcess) break;

        const pageNo = idx + 1;
        onProgress?.(
          Math.max(5, Math.round((doneCount / totalToProcess) * 85)),
          `OCR scanning page ${pageNo} of ${totalToProcess}…`
        );
        const page = await pdf.getPage(pageNo);
        const vp = page.getViewport({ scale: 1 });
        page.cleanup();

        const { blob, width, height } = await renderPdfPageToBlob(pdf, pageNo, {
          scale: 2.0,
          format: 'png',
          quality: 1,
        });
        renderedImages[idx] = { blob, pdfW: vp.width, pdfH: vp.height, pxW: width, pxH: height };

        const objUrl = URL.createObjectURL(blob);
        try {
          const res = await worker.recognize(objUrl);
          const words = (res.data.words || []).map((w) => ({
            text: w.text,
            bbox: w.bbox,
          }));
          outputs[idx] = {
            pageNumber: pageNo,
            text: (res.data.text || '').trim(),
            confidence: Math.round(res.data.confidence || 0),
            words,
            renderWidth: width,
            renderHeight: height,
          };
        } finally {
          URL.revokeObjectURL(objUrl);
        }

        doneCount += 1;
        onProgress?.(
          Math.round((doneCount / totalToProcess) * 90),
          `Completed page ${pageNo} of ${totalToProcess}`
        );
      }
    };

    await Promise.all(workers.map((w) => workerLoop(w)));

    if (options.outputFormat === 'searchable-pdf') {
      // Innovation: Build true Searchable PDF with invisible Tr=3 text layer aligned to OCR bboxes
      const outPdf = await PDFDocument.create();
      const font = await outPdf.embedFont(StandardFonts.Helvetica);

      for (let i = 0; i < totalToProcess; i += 1) {
        const imgInfo = renderedImages[i];
        const ocr = outputs[i];
        const embedded = await outPdf.embedPng(await imgInfo.blob.arrayBuffer());
        const page = outPdf.addPage([imgInfo.pdfW, imgInfo.pdfH]);
        page.drawImage(embedded, { x: 0, y: 0, width: imgInfo.pdfW, height: imgInfo.pdfH });

        const scaleX = imgInfo.pdfW / Math.max(1, imgInfo.pxW);
        const scaleY = imgInfo.pdfH / Math.max(1, imgInfo.pxH);

        page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
        for (const w of ocr.words) {
          const safe = w.text.replace(/[^\x20-\x7e\u00a0-\u00ff]/g, ' ').trim();
          if (!safe) continue;
          const x = w.bbox.x0 * scaleX;
          const boxH = Math.max(6, (w.bbox.y1 - w.bbox.y0) * scaleY);
          const y = imgInfo.pdfH - w.bbox.y1 * scaleY;
          page.drawText(safe, {
            x,
            y,
            size: Math.max(6, Math.min(48, boxH * 0.85)),
            font,
            color: rgb(0, 0, 0),
          });
        }
        page.pushOperators(popGraphicsState());
      }
      const pdfBytes = await outPdf.save({ useObjectStreams: true });
      const pdfBlob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
      const fullText = outputs
        .map((p) => `--- Page ${p.pageNumber} (${p.confidence}% conf) ---\n${p.text}`)
        .join('\n\n');
      onProgress?.(100, 'Searchable PDF ready');
      return {
        pages: outputs,
        fullText,
        result: {
          blob: pdfBlob,
          url: URL.createObjectURL(pdfBlob),
          fileName: `${stem}-searchable.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: pdfBlob.size,
          elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
          pageCount: totalToProcess,
          summary: `Created ${totalToProcess}-page searchable OCR PDF`,
        },
      };
    }

    const fullText =
      options.outputFormat === 'md'
        ? outputs
            .map((p) => `## Page ${p.pageNumber} (${p.confidence}% confidence)\n\n${p.text || '_No text detected_'}`)
            .join('\n\n')
        : outputs
            .map((p) => `--- Page ${p.pageNumber} (${p.confidence}% confidence) ---\n${p.text}`)
            .join('\n\n');
    const ext = options.outputFormat === 'md' ? 'md' : 'txt';
    const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
    onProgress?.(100, 'OCR complete');
    return {
      pages: outputs,
      fullText,
      result: {
        blob,
        url: URL.createObjectURL(blob),
        fileName: `${stem}-ocr.${ext}`,
        mimeType: 'text/plain;charset=utf-8',
        sizeBytes: blob.size,
        elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
        pageCount: totalToProcess,
        summary: `OCR extracted text from ${totalToProcess} page(s)`,
      },
    };
  } finally {
    await Promise.all(workers.map((w) => w.terminate().catch(() => {})));
    await pdf.destroy().catch(() => {});
  }
}

interface AnalyzedRow {
  cells: string[];
  rawText: string;
  fontSize: number;
}

interface PageLayoutAnalysis {
  pageNumber: number;
  rows: AnalyzedRow[];
  colCount: number;
  isTabular: boolean;
  medianFontSize: number;
}

function medianNumber(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function analyzePageLayout(page: OcrPageOutput): PageLayoutAnalysis {
  const words = (page.words || []).filter((w) => w.text.trim().length > 0);

  if (words.length === 0) {
    const rawLines = (page.text || '')
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length > 0);
    const splitRows = rawLines.map((line) => {
      const cells = line.split(/\t+| {2,}/).map((c) => c.trim());
      return {
        cells,
        rawText: line.trim(),
        fontSize: 11,
      };
    });
    const maxCols = Math.max(1, ...splitRows.map((r) => r.cells.length));
    const multiColRows = splitRows.filter((r) => r.cells.filter(Boolean).length >= 2).length;
    const normalizedRows = splitRows.map((r) => ({
      ...r,
      cells:
        maxCols > 1
          ? Array.from({ length: maxCols }, (_, idx) => r.cells[idx] ?? '')
          : [r.rawText],
    }));
    return {
      pageNumber: page.pageNumber,
      rows: normalizedRows,
      colCount: maxCols,
      isTabular: maxCols >= 2 && multiColRows >= 2,
      medianFontSize: 11,
    };
  }

  const heights = words.map((w) => Math.max(6, w.bbox.y1 - w.bbox.y0));
  const lineHeight = Math.max(6, medianNumber(heights, 12));
  const fontSizes = words.map((w) => w.fontSize ?? Math.max(6, w.bbox.y1 - w.bbox.y0));
  const medianFontSize = Math.max(6, medianNumber(fontSizes, 11));

  // Pass 1: Group words into rows by y-center tolerance (<= lineHeight * 0.55)
  const sorted = [...words].sort((a, b) => {
    const ay = (a.bbox.y0 + a.bbox.y1) / 2;
    const by = (b.bbox.y0 + b.bbox.y1) / 2;
    if (Math.abs(ay - by) > lineHeight * 0.35) return ay - by;
    return a.bbox.x0 - b.bbox.x0;
  });

  const rawRows: Array<{ words: OcrWordBox[]; yCenterSum: number }> = [];
  for (const w of sorted) {
    const yc = (w.bbox.y0 + w.bbox.y1) / 2;
    const last = rawRows[rawRows.length - 1];
    if (last) {
      const avgY = last.yCenterSum / last.words.length;
      if (Math.abs(yc - avgY) <= lineHeight * 0.55) {
        last.words.push(w);
        last.yCenterSum += yc;
        continue;
      }
    }
    rawRows.push({ words: [w], yCenterSum: yc });
  }

  for (const r of rawRows) {
    r.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  }

  // Pass 2: Build horizontal X-axis occupancy projection histogram across all rows
  let minX = Infinity;
  let maxX = -Infinity;
  for (const w of words) {
    if (w.bbox.x0 < minX) minX = w.bbox.x0;
    if (w.bbox.x1 > maxX) maxX = w.bbox.x1;
  }

  const span = Math.max(1, Math.ceil(maxX - minX));
  const occupancy = new Uint32Array(span + 1);
  for (const r of rawRows) {
    for (const w of r.words) {
      const s = Math.max(0, Math.floor(w.bbox.x0 - minX));
      const e = Math.min(span, Math.ceil(w.bbox.x1 - minX));
      for (let x = s; x <= e; x += 1) {
        occupancy[x] += 1;
      }
    }
  }

  const gutterThreshold = Math.max(6, lineHeight * 0.75);
  const colSplits: number[] = [];
  let inGap = false;
  let gapStart = 0;

  for (let x = 0; x <= span; x += 1) {
    if (occupancy[x] === 0) {
      if (!inGap) {
        inGap = true;
        gapStart = x;
      }
    } else if (inGap) {
      const gapWidth = x - gapStart;
      if (gapStart > 0 && gapWidth >= gutterThreshold) {
        colSplits.push(minX + (gapStart + x) / 2);
      }
      inGap = false;
    }
  }

  const colCount = colSplits.length + 1;
  const rows: AnalyzedRow[] = rawRows.map((r) => {
    const cells = new Array<string>(colCount).fill('');
    for (const w of r.words) {
      const cx = (w.bbox.x0 + w.bbox.x1) / 2;
      let colIdx = 0;
      while (colIdx < colSplits.length && cx > colSplits[colIdx]) {
        colIdx += 1;
      }
      cells[colIdx] = cells[colIdx] ? `${cells[colIdx]} ${w.text}` : w.text;
    }
    const trimmedCells = cells.map((c) => c.trim());
    const rowFontSize = medianNumber(
      r.words.map((w) => w.fontSize ?? Math.max(6, w.bbox.y1 - w.bbox.y0)),
      medianFontSize
    );
    return {
      cells: trimmedCells,
      rawText: r.words.map((w) => w.text).join(' ').trim(),
      fontSize: rowFontSize,
    };
  });

  const multiColRowCount = rows.filter((r) => r.cells.filter(Boolean).length >= 2).length;
  return {
    pageNumber: page.pageNumber,
    rows,
    colCount,
    isTabular: colCount >= 2 && multiColRowCount >= 2,
    medianFontSize,
  };
}

function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRtfText(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0x5c) {
      out += '\\\\';
    } else if (code === 0x7b) {
      out += '\\{';
    } else if (code === 0x7d) {
      out += '\\}';
    } else if (code === 0x0a) {
      out += '\\par\n';
    } else if (code === 0x0d) {
      // skip CR
    } else if (code >= 0x20 && code <= 0x7e) {
      out += value[i];
    } else {
      const signed = code > 32767 ? code - 65536 : code;
      out += `\\u${signed}?`;
    }
  }
  return out;
}

function segmentPageRows(layout: PageLayoutAnalysis): {
  beforeRows: AnalyzedRow[];
  tableRows: AnalyzedRow[];
  afterRows: AnalyzedRow[];
} {
  if (!layout.isTabular) {
    return { beforeRows: layout.rows, tableRows: [], afterRows: [] };
  }
  const firstMulti = layout.rows.findIndex((r) => r.cells.filter(Boolean).length >= 2);
  let lastMulti = -1;
  for (let i = layout.rows.length - 1; i >= 0; i -= 1) {
    if (layout.rows[i].cells.filter(Boolean).length >= 2) {
      lastMulti = i;
      break;
    }
  }
  if (firstMulti === -1 || lastMulti < firstMulti) {
    return { beforeRows: layout.rows, tableRows: [], afterRows: [] };
  }
  return {
    beforeRows: layout.rows.slice(0, firstMulti),
    tableRows: layout.rows.slice(firstMulti, lastMulti + 1),
    afterRows: layout.rows.slice(lastMulti + 1),
  };
}

/**
 * Formats OCR or text-layer page output into TXT, structured 2-pass CSV, standalone HTML5, or UTF-8 RTF.
 */
export function formatOcrOutputAs(
  pages: OcrPageOutput[],
  format: 'txt' | 'csv' | 'html' | 'rtf' | 'xml',
  baseFileName: string
): PdfProcessResult {
  const t0 = performance.now();
  const stem = sanitizeFilenameStem(baseFileName, 'document');
  const safeUrl = (blob: Blob) =>
    typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? URL.createObjectURL(blob)
      : '';

  if (format === 'xml') {
    const xmlPages = pages
      .map((p) => {
        const wordsXml = p.words
          .map(
            (w) =>
              `    <word x="${Math.round(w.bbox.x0 * 100) / 100}" y="${Math.round(w.bbox.y0 * 100) / 100}" width="${Math.round((w.bbox.x1 - w.bbox.x0) * 100) / 100}" height="${Math.round((w.bbox.y1 - w.bbox.y0) * 100) / 100}">${escapeHtmlText(w.text)}</word>`
          )
          .join('\n');
        return `  <page number="${p.pageNumber}" width="${p.renderWidth}" height="${p.renderHeight}" confidence="${p.confidence}">\n${wordsXml}\n  </page>`;
      })
      .join('\n');
    const xmlDoc = `<?xml version="1.0" encoding="UTF-8"?>\n<document fileName="${escapeHtmlText(baseFileName)}">\n${xmlPages}\n</document>\n`;
    const blob = new Blob([xmlDoc], { type: 'application/xml;charset=utf-8' });
    return {
      blob,
      url: safeUrl(blob),
      fileName: `${stem}.xml`,
      mimeType: 'application/xml;charset=utf-8',
      sizeBytes: blob.size,
      elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
      pageCount: pages.length,
      summary: `Exported word coordinates from ${pages.length} page(s) as XML`,
    };
  }

  if (format === 'txt') {
    const content =
      pages.length === 1
        ? pages[0]?.text || ''
        : pages.map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`).join('\n\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    return {
      blob,
      url: safeUrl(blob),
      fileName: `${stem}.txt`,
      mimeType: 'text/plain;charset=utf-8',
      sizeBytes: blob.size,
      elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
      pageCount: pages.length,
      summary: `Exported ${pages.length} page(s) as TXT`,
    };
  }

  const layouts = pages.map((p) => analyzePageLayout(p));

  if (format === 'csv') {
    const pageBlocks: string[] = [];
    let detectedTables = 0;

    for (const layout of layouts) {
      if (layout.isTabular) detectedTables += 1;
      const lines: string[] = [];
      for (const row of layout.rows) {
        if (layout.colCount >= 2) {
          lines.push(row.cells.map(escapeCsvCell).join(','));
        } else {
          lines.push(escapeCsvCell(row.rawText));
        }
      }
      pageBlocks.push(lines.join('\r\n'));
    }

    const csvText = pageBlocks.join('\r\n');
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
    return {
      blob,
      url: safeUrl(blob),
      fileName: `${stem}.csv`,
      mimeType: 'text/csv;charset=utf-8',
      sizeBytes: blob.size,
      elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
      pageCount: pages.length,
      summary:
        detectedTables > 0
          ? `Exported ${pages.length} page(s) to CSV (${detectedTables} page(s) with aligned table columns)`
          : `Exported ${pages.length} page(s) to CSV`,
    };
  }

  if (format === 'html') {
    const renderParagraphsHtml = (rows: AnalyzedRow[], medianFontSize: number) =>
      rows
        .map((r) => {
          const text = escapeHtmlText(r.rawText);
          if (!text) return '';
          const ratio = r.fontSize / Math.max(6, medianFontSize);
          if (ratio >= 1.45 && r.rawText.length < 140) return `    <h2>${text}</h2>`;
          if (ratio >= 1.2 && r.rawText.length < 140) return `    <h3>${text}</h3>`;
          return `    <p>${text}</p>`;
        })
        .filter(Boolean)
        .join('\n');

    const sectionsHtml = layouts
      .map((layout) => {
        const { beforeRows, tableRows, afterRows } = segmentPageRows(layout);
        const parts: string[] = [];
        const beforeHtml = renderParagraphsHtml(beforeRows, layout.medianFontSize);
        if (beforeHtml) parts.push(beforeHtml);

        if (tableRows.length > 0) {
          const headRow = tableRows[0];
          const bodyRows = tableRows.slice(1);
          const thead = `      <thead><tr>${headRow.cells
            .map((c) => `<th>${escapeHtmlText(c)}</th>`)
            .join('')}</tr></thead>`;
          const tbody = bodyRows.length
            ? `\n      <tbody>\n${bodyRows
                .map(
                  (r) =>
                    `        <tr>${r.cells
                      .map((c) => `<td>${escapeHtmlText(c)}</td>`)
                      .join('')}</tr>`
                )
                .join('\n')}\n      </tbody>`
            : '';
          parts.push(`    <table>\n${thead}${tbody}\n    </table>`);
        }

        const afterHtml = renderParagraphsHtml(afterRows, layout.medianFontSize);
        if (afterHtml) parts.push(afterHtml);

        if (parts.length === 0) {
          parts.push('    <p><em>Empty page</em></p>');
        }

        return `  <section data-page="${layout.pageNumber}">\n    <h2 class="page-label">Page ${layout.pageNumber}</h2>\n${parts.join('\n')}\n  </section>`;
      })
      .join('\n');

    const htmlDoc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtmlText(stem)}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; padding: 2rem 1rem; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.55; color: #111827; background: #f8fafc; }
    main { max-width: 960px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.5rem; }
    section[data-page] { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 1.5rem 2rem; }
    .page-label { margin: 0 0 1rem; font-size: 0.875rem; color: #475569; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem; }
    h2, h3 { color: #0f172a; margin: 1rem 0 0.5rem; }
    p { margin: 0.45rem 0; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.925rem; }
    th, td { border: 1px solid #cbd5e1; padding: 0.5rem 0.65rem; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; font-weight: 600; }
  </style>
</head>
<body>
<main>
${sectionsHtml}
</main>
</body>
</html>`;

    const blob = new Blob([htmlDoc], { type: 'text/html;charset=utf-8' });
    return {
      blob,
      url: safeUrl(blob),
      fileName: `${stem}.html`,
      mimeType: 'text/html;charset=utf-8',
      sizeBytes: blob.size,
      elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
      pageCount: pages.length,
      summary: `Exported ${pages.length} page(s) as standalone HTML5`,
    };
  }

  // Rich Text Format (RTF)
  const rtfParts: string[] = [
    '{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1{\\fonttbl{\\f0\\fswiss Helvetica;}}\\fs22\n',
  ];

  const pushRtfParagraphs = (rows: AnalyzedRow[], medianFontSize: number) => {
    for (const r of rows) {
      const text = r.rawText.trim();
      if (!text) continue;
      const ratio = r.fontSize / Math.max(6, medianFontSize);
      if (ratio >= 1.3 && text.length < 140) {
        rtfParts.push(`{\\pard\\sb160\\sa80\\b\\fs28 ${escapeRtfText(text)}\\b0\\par}\n`);
      } else {
        rtfParts.push(`{\\pard\\sa100\\fs22 ${escapeRtfText(text)}\\par}\n`);
      }
    }
  };

  layouts.forEach((layout, idx) => {
    if (layouts.length > 1) {
      rtfParts.push(`{\\pard\\sb200\\sa100\\b\\fs26 Page ${layout.pageNumber}\\b0\\par}\n`);
    }
    const { beforeRows, tableRows, afterRows } = segmentPageRows(layout);
    pushRtfParagraphs(beforeRows, layout.medianFontSize);

    if (tableRows.length > 0) {
      const colCount = Math.max(1, layout.colCount);
      const totalTwips = 9360;
      const cellDefs = Array.from({ length: colCount }, (_, c) => {
        const right = Math.round(((c + 1) * totalTwips) / colCount);
        return `\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10\\cellx${right}`;
      }).join('');

      tableRows.forEach((row, rIdx) => {
        rtfParts.push(`\\trowd\\trgaph108\\trleft0${cellDefs}\n`);
        for (let c = 0; c < colCount; c += 1) {
          const cellVal = escapeRtfText(row.cells[c] || '');
          const cellBody = rIdx === 0 ? `\\b ${cellVal}\\b0` : cellVal;
          rtfParts.push(`\\pard\\intbl ${cellBody}\\cell`);
        }
        rtfParts.push('\\row\n');
      });
    }

    pushRtfParagraphs(afterRows, layout.medianFontSize);
    if (idx < layouts.length - 1) {
      rtfParts.push('\\page\n');
    }
  });

  rtfParts.push('}');
  const rtfText = rtfParts.join('');
  const blob = new Blob([rtfText], { type: 'application/rtf' });
  return {
    blob,
    url: safeUrl(blob),
    fileName: `${stem}.rtf`,
    mimeType: 'application/rtf',
    sizeBytes: blob.size,
    elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
    pageCount: pages.length,
    summary: `Exported ${pages.length} page(s) as Rich Text Format (.rtf)`,
  };
}
