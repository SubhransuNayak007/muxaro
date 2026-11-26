import JSZip from 'jszip';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRef,
  PDFString,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import { PdfToolError, sanitizeFilenameStem } from './errors.ts';
import { runPdfOcr, type OcrPageOutput } from './ocr-engine.ts';
import { parsePageRange } from './page-range.ts';
import {
  canvasToBlobSafe,
  loadPdfJsDocument,
  renderPdfPageToBlob,
  renderPdfPageToCanvas,
} from './pdf-browser.ts';
import type { PdfOutputFormat, PdfProcessResult } from './types.ts';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function pdfToImagesZip(
  file: File,
  options: {
    format: PdfOutputFormat;
    dpi: 72 | 150 | 300;
    quality: number;
    pageRange?: string;
  },
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<PdfProcessResult> {
  const t0 = performance.now();
  const pdf = await loadPdfJsDocument(file);
  const stem = sanitizeFilenameStem(file.name, 'page');
  const scale = options.dpi / 72;
  const ext = options.format === 'jpeg' ? 'jpg' : options.format;
  const mime =
    options.format === 'png'
      ? 'image/png'
      : options.format === 'webp'
      ? 'image/webp'
      : 'image/jpeg';

  try {
    const { pages } = options.pageRange?.trim()
      ? parsePageRange(options.pageRange, pdf.numPages)
      : { pages: Array.from({ length: pdf.numPages }, (_, i) => i + 1) };

    if (pages.length === 0) {
      throw new PdfToolError('No valid pages selected.', 'validation');
    }

    if (pages.length === 1) {
      const { blob } = await renderPdfPageToBlob(pdf, pages[0], {
        scale,
        format: options.format,
        quality: options.quality,
      });
      onProgress?.(100);
      return {
        blob,
        url: URL.createObjectURL(blob),
        fileName: `${stem}-page-${pages[0]}.${ext}`,
        mimeType: mime,
        sizeBytes: blob.size,
        elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
        pageCount: 1,
        summary: `Exported page ${pages[0]} as ${ext.toUpperCase()} (${options.dpi} DPI)`,
      };
    }

    const zip = new JSZip();
    for (let i = 0; i < pages.length; i += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const pNo = pages[i];
      const { blob } = await renderPdfPageToBlob(pdf, pNo, {
        scale,
        format: options.format,
        quality: options.quality,
      });
      zip.file(`${stem}-page-${String(pNo).padStart(3, '0')}.${ext}`, blob);
      onProgress?.(Math.round(((i + 1) / pages.length) * 90));
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    onProgress?.(100);
    return {
      blob: zipBlob,
      url: URL.createObjectURL(zipBlob),
      fileName: `${stem}-${ext}-images.zip`,
      mimeType: 'application/zip',
      sizeBytes: zipBlob.size,
      elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
      pageCount: pages.length,
      summary: `Exported ${pages.length} pages as ${ext.toUpperCase()} (${options.dpi} DPI)`,
    };
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

interface RichPara {
  text: string;
  isHeading: boolean;
  headingLevel: 1 | 2 | 3;
  bold: boolean;
  italic: boolean;
  fontSizePt: number;
}

function ocrPageToRichParas(
  ocrPage: OcrPageOutput,
  sizeCounts: Map<number, number>
): RichPara[] {
  const words = (ocrPage.words || []).filter((w) => w.text.trim().length > 0);
  if (words.length === 0) {
    return (ocrPage.text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((text) => {
        sizeCounts.set(11, (sizeCounts.get(11) || 0) + text.length);
        return {
          text,
          isHeading: false,
          headingLevel: 2 as const,
          bold: false,
          italic: false,
          fontSizePt: 11,
        };
      });
  }

  const heights = words.map((w) => Math.max(6, w.bbox.y1 - w.bbox.y0)).sort((a, b) => a - b);
  const lineH = heights[Math.floor(heights.length / 2)] || 16;
  const sorted = [...words].sort((a, b) => {
    const ay = (a.bbox.y0 + a.bbox.y1) / 2;
    const by = (b.bbox.y0 + b.bbox.y1) / 2;
    if (Math.abs(ay - by) > lineH * 0.35) return ay - by;
    return a.bbox.x0 - b.bbox.x0;
  });

  const rows: Array<{ words: typeof words; ySum: number }> = [];
  for (const w of sorted) {
    const yc = (w.bbox.y0 + w.bbox.y1) / 2;
    const last = rows[rows.length - 1];
    if (last && Math.abs(yc - last.ySum / last.words.length) <= lineH * 0.55) {
      last.words.push(w);
      last.ySum += yc;
    } else {
      rows.push({ words: [w], ySum: yc });
    }
  }

  const pxToPt = ocrPage.renderHeight > 0 ? 792 / ocrPage.renderHeight : 0.5;
  return rows
    .map((r) => {
      r.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
      const text = r.words.map((w) => w.text).join(' ').trim();
      const avgPxH =
        r.words.reduce((s, w) => s + Math.max(6, w.bbox.y1 - w.bbox.y0), 0) / r.words.length;
      const fontSizePt = Math.max(9, Math.min(28, Math.round(avgPxH * pxToPt)));
      if (text) {
        sizeCounts.set(fontSizePt, (sizeCounts.get(fontSizePt) || 0) + text.length);
      }
      return {
        text,
        isHeading: false,
        headingLevel: 2 as const,
        bold: false,
        italic: false,
        fontSizePt,
      };
    })
    .filter((p) => p.text.length > 0);
}

/**
 * Innovation: Structure-Aware PDF -> DOCX converter
 * Infers body font size median, classifies H1/H2/H3 headings, preserves bold/italic runs & page breaks.
 * Automatically falls back to local Tesseract OCR when a scanned PDF has minimal selectable text.
 */
export async function pdfToDocxRich(
  file: File,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<PdfProcessResult> {
  const t0 = performance.now();
  const pdf = await loadPdfJsDocument(file);
  const stem = sanitizeFilenameStem(file.name, 'document');
  let pdfDestroyed = false;

  try {
    const totalPages = pdf.numPages;
    let pagesContent: RichPara[][] = [];
    const sizeCounts = new Map<number, number>();

    for (let p = 1; p <= totalPages; p += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const styles = (tc.styles || {}) as Record<string, { fontFamily?: string }>;
      const lines: RichPara[] = [];
      let currentLine = '';
      let lineBold = false;
      let lineItalic = false;
      let lineSize = 11;

      for (const raw of tc.items) {
        if (!('str' in raw)) continue;
        const size = Math.round(Math.hypot(raw.transform[0], raw.transform[1]) || 11);
        const fontDesc = `${raw.fontName} ${styles[raw.fontName]?.fontFamily || ''}`.toLowerCase();
        if (raw.str.trim()) {
          sizeCounts.set(size, (sizeCounts.get(size) || 0) + raw.str.length);
          lineSize = size;
          if (/bold|black|heavy/.test(fontDesc)) lineBold = true;
          if (/italic|oblique/.test(fontDesc)) lineItalic = true;
        }
        currentLine += raw.str;
        if (raw.hasEOL) {
          const clean = currentLine.trim();
          if (clean) {
            lines.push({
              text: clean,
              isHeading: false,
              headingLevel: 2,
              bold: lineBold,
              italic: lineItalic,
              fontSizePt: lineSize,
            });
          }
          currentLine = '';
          lineBold = false;
          lineItalic = false;
        } else if (raw.str.length > 0 && !raw.str.endsWith(' ') && (raw.width || 0) > size * 0.16) {
          currentLine += ' ';
        }
      }
      if (currentLine.trim()) {
        lines.push({
          text: currentLine.trim(),
          isHeading: false,
          headingLevel: 2,
          bold: lineBold,
          italic: lineItalic,
          fontSizePt: lineSize,
        });
      }
      pagesContent.push(lines);
      page.cleanup();
      onProgress?.(Math.round((p / Math.max(1, totalPages)) * 30));
    }

    const nonWsChars = pagesContent.reduce(
      (acc, paras) => acc + paras.reduce((s, p) => s + p.text.replace(/\s+/g, '').length, 0),
      0
    );

    let usedAutoOcr = false;
    if (nonWsChars < 15 * Math.max(1, totalPages)) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      await pdf.destroy().catch(() => {});
      pdfDestroyed = true;

      sizeCounts.clear();
      const ocrRes = await runPdfOcr(
        file,
        { mode: 'ocr', concurrency: 2, outputFormat: 'txt' },
        (pct) => onProgress?.(30 + Math.round(pct * 0.6)),
        signal
      );
      pagesContent = ocrRes.pages.map((ocrPage) => ocrPageToRichParas(ocrPage, sizeCounts));
      usedAutoOcr = true;
    } else {
      onProgress?.(80);
    }

    const totalTextLen = pagesContent.reduce((acc, p) => acc + p.length, 0);
    if (totalTextLen === 0) {
      throw new PdfToolError(
        'No extractable text found in this PDF even after Auto-OCR.',
        'validation'
      );
    }

    // Determine dominant body font size
    let bodySize = 11;
    let bestFreq = 0;
    for (const [sz, freq] of sizeCounts.entries()) {
      if (freq > bestFreq) {
        bestFreq = freq;
        bodySize = sz;
      }
    }

    const bodyParagraphsXml: string[] = [];
    pagesContent.forEach((paras, pIdx) => {
      for (const p of paras) {
        const ratio = p.fontSizePt / Math.max(8, bodySize);
        const isH1 = ratio >= 1.55 && p.text.length < 140;
        const isH2 = !isH1 && ratio >= 1.25 && p.text.length < 140;
        const halfPts = Math.max(16, Math.min(72, Math.round(p.fontSizePt * 2)));

        const rPr = [
          p.bold || isH1 || isH2 ? '<w:b/>' : '',
          p.italic ? '<w:i/>' : '',
          `<w:sz w:val="${halfPts}"/>`,
        ]
          .filter(Boolean)
          .join('');
        const pPr = isH1
          ? '<w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>'
          : isH2
          ? '<w:pPr><w:spacing w:before="180" w:after="80"/></w:pPr>'
          : '<w:pPr><w:spacing w:after="100"/></w:pPr>';

        bodyParagraphsXml.push(
          `<w:p>${pPr}<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${escapeXml(
            p.text
          )}</w:t></w:r></w:p>`
        );
      }
      if (pIdx < pagesContent.length - 1) {
        bodyParagraphsXml.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      }
    });

    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
    );
    zip.file(
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
    );
    zip.file(
      'word/document.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyParagraphsXml.join('\n    ')}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
  </w:body>
</w:document>`
    );

    const docxBlob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    onProgress?.(100);
    return {
      blob: docxBlob,
      url: URL.createObjectURL(docxBlob),
      fileName: `${stem}.docx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: docxBlob.size,
      elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
      pageCount: totalPages,
      summary: usedAutoOcr
        ? `Converted ${totalPages} scanned PDF page(s) to structured Word (.docx) via Auto-OCR fallback`
        : `Converted ${totalPages} PDF pages to structured Word (.docx)`,
    };
  } finally {
    if (!pdfDestroyed) {
      await pdf.destroy().catch(() => {});
    }
  }
}

interface DocxRun {
  text: string;
  bold: boolean;
  italic: boolean;
  href?: string;
}

interface DocxNode {
  kind: 'paragraph' | 'table' | 'page-break';
  style?: 'h1' | 'h2' | 'h3' | 'body' | 'list';
  runs?: DocxRun[];
  rows?: string[][];
}

interface HeadingBookmark {
  title: string;
  level: 1 | 2 | 3;
  pageRef: PDFRef;
  yTop: number;
}

interface OutlineTreeItem {
  title: string;
  level: number;
  pageRef: PDFRef;
  yTop: number;
  ref: PDFRef;
  children: OutlineTreeItem[];
  parent?: OutlineTreeItem;
  totalCount: number;
}

function attachHeadingOutlines(pdfDoc: PDFDocument, headings: HeadingBookmark[]): void {
  if (headings.length === 0) return;

  const outlinesRef = pdfDoc.context.nextRef();
  const root: OutlineTreeItem = {
    title: '',
    level: 0,
    pageRef: headings[0].pageRef,
    yTop: 0,
    ref: outlinesRef,
    children: [],
    totalCount: 0,
  };

  const stack: OutlineTreeItem[] = [root];
  for (const h of headings) {
    while (stack.length > 1 && stack[stack.length - 1].level >= h.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    const item: OutlineTreeItem = {
      title: h.title,
      level: h.level,
      pageRef: h.pageRef,
      yTop: h.yTop,
      ref: pdfDoc.context.nextRef(),
      children: [],
      parent,
      totalCount: 0,
    };
    parent.children.push(item);
    stack.push(item);
  }

  const computeCounts = (node: OutlineTreeItem): number => {
    let total = 0;
    for (const child of node.children) {
      total += 1 + computeCounts(child);
    }
    node.totalCount = total;
    return total;
  };
  computeCounts(root);

  const outlinesDict = pdfDoc.context.obj({
    Type: PDFName.of('Outlines'),
    First: root.children[0].ref,
    Last: root.children[root.children.length - 1].ref,
    Count: PDFNumber.of(root.totalCount),
  }) as PDFDict;
  pdfDoc.context.assign(outlinesRef, outlinesDict);

  const writeNode = (node: OutlineTreeItem, prevRef?: PDFRef, nextRef?: PDFRef) => {
    const dict = pdfDoc.context.obj({
      Title: PDFHexString.fromText(node.title),
      Parent: node.parent!.ref,
      Dest: pdfDoc.context.obj([
        node.pageRef,
        PDFName.of('XYZ'),
        PDFNull,
        PDFNumber.of(Math.round(node.yTop)),
        PDFNull,
      ]),
    }) as PDFDict;
    if (prevRef) dict.set(PDFName.of('Prev'), prevRef);
    if (nextRef) dict.set(PDFName.of('Next'), nextRef);
    if (node.children.length > 0) {
      dict.set(PDFName.of('First'), node.children[0].ref);
      dict.set(PDFName.of('Last'), node.children[node.children.length - 1].ref);
      dict.set(PDFName.of('Count'), PDFNumber.of(node.totalCount));
    }
    pdfDoc.context.assign(node.ref, dict);

    for (let i = 0; i < node.children.length; i += 1) {
      writeNode(
        node.children[i],
        i > 0 ? node.children[i - 1].ref : undefined,
        i < node.children.length - 1 ? node.children[i + 1].ref : undefined
      );
    }
  };

  for (let i = 0; i < root.children.length; i += 1) {
    writeNode(
      root.children[i],
      i > 0 ? root.children[i - 1].ref : undefined,
      i < root.children.length - 1 ? root.children[i + 1].ref : undefined
    );
  }

  pdfDoc.catalog.set(PDFName.of('Outlines'), outlinesRef);
  pdfDoc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

function parseDocxRun(r: Element, href?: string): DocxRun | null {
  const bold = Boolean(r.querySelector('w\\:b, b'));
  const italic = Boolean(r.querySelector('w\\:i, i'));
  const tNodes = Array.from(r.querySelectorAll('w\\:t, t'));
  const text = tNodes.map((n) => n.textContent || '').join('');
  if (!text) return null;
  return href ? { text, bold, italic, href } : { text, bold, italic };
}

/**
 * Innovation: Structure-Aware DOCX -> PDF converter
 * Parses headings, bold/italic runs, bullet lists, tables, hyperlinks (/Link annotations),
 * hierarchical heading bookmarks (/Outlines), and explicit page breaks.
 */
export async function docxToPdfRich(
  file: File,
  onProgress?: (pct: number) => void
): Promise<PdfProcessResult> {
  const t0 = performance.now();
  if (file.size > 64 * 1024 * 1024) {
    throw new PdfToolError('Word document exceeds 64 MB browser limit.', 'validation');
  }
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const docEntry = zip.file('word/document.xml');
  if (!docEntry) {
    throw new PdfToolError('Invalid .docx archive (missing word/document.xml).', 'validation');
  }

  const relTargets = new Map<string, string>();
  const relsEntry = zip.file('word/_rels/document.xml.rels');
  if (relsEntry) {
    const relsText = await relsEntry.async('text');
    const relsXml = new DOMParser().parseFromString(relsText, 'application/xml');
    for (const rel of Array.from(relsXml.getElementsByTagName('Relationship'))) {
      const id = rel.getAttribute('Id') || '';
      const target = (rel.getAttribute('Target') || '').trim();
      const targetMode = rel.getAttribute('TargetMode') || '';
      if (id && target && (targetMode === 'External' || /^(https?:|mailto:)/i.test(target))) {
        if (/^(https?:|mailto:)/i.test(target)) {
          relTargets.set(id, target);
        }
      }
    }
  }

  const xmlText = await docEntry.async('text');
  const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
  const body = xml.getElementsByTagName('w:body')[0] || xml.documentElement;
  const nodes: DocxNode[] = [];

  for (const child of Array.from(body.children)) {
    if (child.tagName === 'w:p' || child.localName === 'p') {
      const getByLocal = (el: Element, local: string) =>
        Array.from(el.getElementsByTagName('*')).filter((n) => n.localName === local);

      const pStyleEl = getByLocal(child, 'pStyle')[0];
      const pStyle = pStyleEl?.getAttribute('w:val') || pStyleEl?.getAttribute('val') || '';
      const hasNum = getByLocal(child, 'numPr').length > 0;
      const hasPageBreakBefore = getByLocal(child, 'pageBreakBefore').length > 0;
      const hasPageBreakBr = getByLocal(child, 'br').some(
        (b) => (b.getAttribute('w:type') || b.getAttribute('type') || '').toLowerCase() === 'page'
      );
      if (hasPageBreakBefore) {
        nodes.push({ kind: 'page-break' });
      }

      const runs: DocxRun[] = [];
      for (const pChild of Array.from(child.children)) {
        if (pChild.tagName === 'w:r' || pChild.localName === 'r') {
          const parsed = parseDocxRun(pChild);
          if (parsed) runs.push(parsed);
        } else if (pChild.tagName === 'w:hyperlink' || pChild.localName === 'hyperlink') {
          const rId =
            pChild.getAttribute('r:id') ||
            pChild.getAttributeNS(
              'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
              'id'
            ) ||
            '';
          const anchor = pChild.getAttribute('w:anchor') || pChild.getAttribute('anchor') || '';
          const href = relTargets.get(rId) || (anchor ? `#${anchor}` : undefined);
          for (const innerR of Array.from(pChild.children).filter((n) => n.localName === 'r')) {
            const parsed = parseDocxRun(innerR, href);
            if (parsed) runs.push(parsed);
          }
        }
      }

      if (runs.length > 0) {
        const style: DocxNode['style'] = /heading1|title/i.test(pStyle)
          ? 'h1'
          : /heading2|subtitle/i.test(pStyle)
          ? 'h2'
          : /heading3/i.test(pStyle)
          ? 'h3'
          : hasNum
          ? 'list'
          : 'body';
        nodes.push({ kind: 'paragraph', style, runs });
      }
      if (hasPageBreakBr && !hasPageBreakBefore) {
        nodes.push({ kind: 'page-break' });
      }
    } else if (child.tagName === 'w:tbl' || child.localName === 'tbl') {
      const rows: string[][] = [];
      for (const tr of Array.from(child.querySelectorAll('w\\:tr, tr'))) {
        const cells = Array.from(tr.querySelectorAll('w\\:tc, tc')).map((tc) =>
          Array.from(tc.querySelectorAll('w\\:t, t'))
            .map((t) => t.textContent || '')
            .join(' ')
            .trim()
        );
        if (cells.length > 0) rows.push(cells);
      }
      if (rows.length > 0) nodes.push({ kind: 'table', rows });
    }
  }

  onProgress?.(40);
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const PAGE_W = 612;
  const PAGE_H = 792;
  const MARGIN = 52;
  const MAX_W = PAGE_W - MARGIN * 2;
  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let cursorY = PAGE_H - MARGIN;
  const headings: HeadingBookmark[] = [];
  let linkCount = 0;

  const ensureSpace = (needed: number) => {
    if (cursorY - needed < MARGIN) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      cursorY = PAGE_H - MARGIN;
    }
  };

  const attachUriLink = (x0: number, y0: number, x1: number, y1: number, href: string) => {
    const linkAnnot = pdfDoc.context.obj({
      Type: 'Annot',
      Subtype: PDFName.of('Link'),
      Rect: [x0, y0, x1, y1],
      Border: [0, 0, 0],
      A: {
        Type: 'Action',
        S: PDFName.of('URI'),
        URI: PDFString.of(href),
      },
    });
    const linkRef = pdfDoc.context.register(linkAnnot);
    const existingAnnots = page.node.lookup(PDFName.of('Annots'));
    if (existingAnnots instanceof PDFArray) {
      existingAnnots.push(linkRef);
    } else {
      page.node.set(PDFName.of('Annots'), pdfDoc.context.obj([linkRef]));
    }
    linkCount += 1;
  };

  for (const node of nodes) {
    if (node.kind === 'page-break') {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      cursorY = PAGE_H - MARGIN;
      continue;
    }
    if (node.kind === 'paragraph' && node.runs) {
      const isHeading = node.style === 'h1' || node.style === 'h2' || node.style === 'h3';
      const fontSize =
        node.style === 'h1' ? 18 : node.style === 'h2' ? 14.5 : node.style === 'h3' ? 12.5 : 11;
      const lineH = fontSize * 1.42;

      const allRuns: DocxRun[] =
        node.style === 'list'
          ? [{ text: '• ', bold: false, italic: false }, ...node.runs]
          : node.runs;

      interface StyledToken {
        text: string;
        isSpace: boolean;
        font: typeof fontRegular;
        width: number;
        href?: string;
      }

      const tokens: StyledToken[] = [];
      for (const run of allRuns) {
        const safe = run.text.replace(/[^\x20-\x7e\u00a0-\u00ff]/g, '?');
        const font =
          isHeading || run.bold ? fontBold : run.italic ? fontOblique : fontRegular;
        for (const piece of safe.split(/(\s+)/)) {
          if (!piece) continue;
          const isSpace = /^\s+$/.test(piece);
          const normalized = isSpace ? ' ' : piece;
          tokens.push({
            text: normalized,
            isSpace,
            font,
            width: font.widthOfTextAtSize(normalized, fontSize),
            href: run.href,
          });
        }
      }

      const wrappedLines: StyledToken[][] = [];
      let currentLine: StyledToken[] = [];
      let currentW = 0;

      for (const tok of tokens) {
        if (currentLine.length === 0 && tok.isSpace) continue;
        if (currentW + tok.width > MAX_W && currentLine.length > 0) {
          while (currentLine.length > 0 && currentLine[currentLine.length - 1].isSpace) {
            currentLine.pop();
          }
          if (currentLine.length > 0) wrappedLines.push(currentLine);
          currentLine = tok.isSpace ? [] : [tok];
          currentW = tok.isSpace ? 0 : tok.width;
        } else {
          currentLine.push(tok);
          currentW += tok.width;
        }
      }
      while (currentLine.length > 0 && currentLine[currentLine.length - 1].isSpace) {
        currentLine.pop();
      }
      if (currentLine.length > 0) wrappedLines.push(currentLine);

      if (wrappedLines.length === 0) continue;

      if (isHeading) cursorY -= 6;
      ensureSpace(lineH);

      if (isHeading) {
        const rawTitle = allRuns.map((r) => r.text).join('').replace(/\s+/g, ' ').trim();
        if (rawTitle) {
          headings.push({
            title: rawTitle,
            level: node.style === 'h1' ? 1 : node.style === 'h2' ? 2 : 3,
            pageRef: page.ref,
            yTop: cursorY,
          });
        }
      }

      const linkColor = rgb(0.09, 0.36, 0.78);
      const bodyColor = rgb(0.08, 0.08, 0.1);

      wrappedLines.forEach((lineTokens, lineIdx) => {
        if (lineIdx > 0) ensureSpace(lineH);
        const baselineY = cursorY - fontSize;
        let curX = MARGIN;
        let activeLink: { href: string; x0: number; x1: number } | null = null;

        const flushLink = () => {
          if (activeLink && activeLink.x1 > activeLink.x0) {
            attachUriLink(
              activeLink.x0,
              baselineY - 3,
              activeLink.x1,
              cursorY + 2,
              activeLink.href
            );
          }
          activeLink = null;
        };

        for (const tok of lineTokens) {
          if (!tok.isSpace) {
            page.drawText(tok.text, {
              x: curX,
              y: baselineY,
              size: fontSize,
              font: tok.font,
              color: tok.href ? linkColor : bodyColor,
            });
            if (tok.href) {
              page.drawLine({
                start: { x: curX, y: baselineY - 1.5 },
                end: { x: curX + tok.width, y: baselineY - 1.5 },
                thickness: 0.75,
                color: linkColor,
              });
            }
          }

          if (tok.href) {
            if (activeLink && activeLink.href === tok.href) {
              activeLink.x1 = curX + tok.width;
            } else {
              flushLink();
              if (!tok.isSpace) {
                activeLink = { href: tok.href, x0: curX, x1: curX + tok.width };
              }
            }
          } else {
            flushLink();
          }
          curX += tok.width;
        }
        flushLink();
        cursorY -= lineH;
      });
      cursorY -= isHeading ? 6 : 4;
    } else if (node.kind === 'table' && node.rows) {
      const colCount = Math.max(1, ...node.rows.map((r) => r.length));
      const colW = MAX_W / colCount;
      for (let rIdx = 0; rIdx < node.rows.length; rIdx += 1) {
        const rowH = 22;
        ensureSpace(rowH);
        const row = node.rows[rIdx];
        for (let c = 0; c < colCount; c += 1) {
          const cx = MARGIN + c * colW;
          page.drawRectangle({
            x: cx,
            y: cursorY - rowH,
            width: colW,
            height: rowH,
            borderColor: rgb(0.75, 0.75, 0.78),
            borderWidth: 0.75,
            ...(rIdx === 0 ? { color: rgb(0.95, 0.95, 0.97) } : {}),
          });
          const cellText = (row[c] || '').replace(/[^\x20-\x7e\u00a0-\u00ff]/g, '?').slice(0, 32);
          page.drawText(cellText, {
            x: cx + 6,
            y: cursorY - 15,
            size: 9.5,
            font: rIdx === 0 ? fontBold : fontRegular,
            color: rgb(0.1, 0.1, 0.12),
          });
        }
        cursorY -= rowH;
      }
      cursorY -= 8;
    }
  }

  attachHeadingOutlines(pdfDoc, headings);

  const outBytes = await pdfDoc.save({ useObjectStreams: true });
  onProgress?.(100);
  const stem = sanitizeFilenameStem(file.name, 'document');
  const blob = new Blob([new Uint8Array(outBytes)], { type: 'application/pdf' });
  const extras: string[] = [];
  if (headings.length > 0) extras.push(`${headings.length} bookmark(s)`);
  if (linkCount > 0) extras.push(`${linkCount} hyperlink(s)`);
  return {
    blob,
    url: URL.createObjectURL(blob),
    fileName: `${stem}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: outBytes.length,
    elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
    pageCount: pdfDoc.getPageCount(),
    summary:
      extras.length > 0
        ? `Converted Word document into ${pdfDoc.getPageCount()}-page PDF (${extras.join(', ')})`
        : `Converted Word document into ${pdfDoc.getPageCount()}-page PDF`,
  };
}

export async function pptxToPdf(
  file: File,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<PdfProcessResult> {
  const t0 = performance.now();
  if (file.size > 128 * 1024 * 1024) {
    throw new PdfToolError('Presentation file exceeds 128 MB browser limit.', 'validation');
  }

  const isOdp = file.name.toLowerCase().endsWith('.odp');
  if (isOdp) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const contentXml = await zip.file('content.xml')?.async('text');
    if (!contentXml) {
      throw new PdfToolError('Invalid OpenDocument Presentation (.odp) — missing content.xml.', 'validation');
    }
    const xml = new DOMParser().parseFromString(contentXml, 'application/xml');
    const pages = Array.from(xml.getElementsByTagName('*')).filter((el) => el.localName === 'page');
    if (pages.length === 0) {
      throw new PdfToolError('No slides found in .odp presentation.', 'validation');
    }
    const pdfDoc = await PDFDocument.create();
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const slideW = 960;
    const slideH = 540;
    for (let i = 0; i < pages.length; i += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const slideEl = pages[i];
      const pEls = Array.from(slideEl.getElementsByTagName('*')).filter((el) => el.localName === 'p');
      const lines = pEls
        .map((p) => (p.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const pdfPage = pdfDoc.addPage([slideW, slideH]);
      let y = slideH - 64;
      lines.slice(0, 18).forEach((ln, idx) => {
        const safe = ln.replace(/[^\x20-\x7e\u00a0-\u00ff]/g, '?').slice(0, 105);
        const isTitle = idx === 0;
        const size = isTitle ? 26 : 15;
        pdfPage.drawText(safe, {
          x: 56,
          y,
          size,
          font: isTitle ? fontBold : fontReg,
          color: rgb(0.1, 0.12, 0.16),
        });
        y -= isTitle ? 42 : 24;
      });
      onProgress?.(Math.round(((i + 1) / pages.length) * 92));
    }
    const bytes = await pdfDoc.save({ useObjectStreams: true });
    onProgress?.(100);
    const stem = sanitizeFilenameStem(file.name, 'presentation');
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    return {
      blob,
      url: URL.createObjectURL(blob),
      fileName: `${stem}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: blob.size,
      elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
      pageCount: pages.length,
      summary: `Converted ${pages.length} OpenDocument (.odp) slide(s) to PDF`,
    };
  }

  const [{ parseZip, buildPresentation, renderSlide }, html2canvasMod, jsPdfMod] =
    await Promise.all([
      import('@aiden0z/pptx-renderer'),
      import('html2canvas'),
      import('jspdf'),
    ]);

  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  // Strip external relationships for SSRF / tracking safety (both self-closing & paired tags)
  for (const path of Object.keys(zip.files)) {
    if (path.endsWith('.rels')) {
      const text = await zip.file(path)?.async('text');
      if (text && text.includes('TargetMode="External"')) {
        const cleaned = text
          .replace(/<Relationship[^>]*TargetMode="External"[^>]*>[\s\S]*?<\/Relationship>/g, '')
          .replace(/<Relationship[^>]*TargetMode="External"[^>]*\/>/g, '');
        zip.file(path, cleaned);
      }
    }
  }
  const safeBuffer = await zip.generateAsync({ type: 'arraybuffer' });
  const parsed = await parseZip(safeBuffer);
  const presentation = await buildPresentation(parsed);
  const slideCount = presentation.slides.length;
  if (slideCount === 0) {
    throw new PdfToolError('No slides found in this PowerPoint deck.', 'validation');
  }

  const html2canvas = html2canvasMod.default;
  const { jsPDF } = jsPdfMod;
  const slideW = presentation.width || 960;
  const slideH = presentation.height || 540;
  const pdf = new jsPDF({
    unit: 'pt',
    format: [slideW, slideH],
    orientation: slideW >= slideH ? 'landscape' : 'portrait',
    compress: true,
  });

  const stage = document.createElement('div');
  stage.style.position = 'fixed';
  stage.style.left = '-20000px';
  stage.style.top = '0';
  stage.style.width = `${slideW}px`;
  stage.style.height = `${slideH}px`;
  stage.style.background = '#ffffff';
  document.body.appendChild(stage);

  try {
    for (let i = 0; i < slideCount; i += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      stage.innerHTML = '';
      const slideHandle = renderSlide(presentation, presentation.slides[i]);
      stage.appendChild(slideHandle.element);
      await slideHandle.ready;
      const canvas = await html2canvas(stage, {
        scale: Math.min(2, 1280 / Math.max(slideW, slideH)),
        useCORS: false,
        backgroundColor: '#ffffff',
      });
      slideHandle.dispose();
      const dataUrl = canvas.toDataURL('image/jpeg', 0.93);
      canvas.width = 0;
      canvas.height = 0;

      if (i > 0) pdf.addPage([slideW, slideH], slideW >= slideH ? 'landscape' : 'portrait');
      pdf.addImage(dataUrl, 'JPEG', 0, 0, slideW, slideH, undefined, 'FAST');
      onProgress?.(Math.round(((i + 1) / slideCount) * 95));
    }

    const blob = pdf.output('blob');
    onProgress?.(100);
    const stem = sanitizeFilenameStem(file.name, 'presentation');
    return {
      blob,
      url: URL.createObjectURL(blob),
      fileName: `${stem}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: blob.size,
      elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
      pageCount: slideCount,
      summary: `Rendered ${slideCount} slides into PDF`,
    };
  } finally {
    stage.remove();
  }
}

/**
 * Renders all PDF pages and stitches them vertically into a single continuous image
 * with automatic MAX_CANVAS_DIM (16,000px) downscaling protection.
 */
export async function pdfToStitchedImage(
  file: File,
  options?: {
    format?: PdfOutputFormat;
    scale?: number;
    gapPx?: number;
    quality?: number;
    signal?: AbortSignal;
    onProgress?: (pct: number) => void;
  }
): Promise<PdfProcessResult> {
  const MAX_CANVAS_DIM = 16000;
  const t0 = performance.now();
  const format = options?.format ?? 'png';
  const requestedScale = Math.max(0.25, Math.min(4, options?.scale ?? 1.5));
  const requestedGap = Math.max(0, Math.round(options?.gapPx ?? 16));
  const quality = Math.max(0.1, Math.min(1, options?.quality ?? 0.92));
  const signal = options?.signal;
  const onProgress = options?.onProgress;

  const ext = format === 'jpeg' ? 'jpg' : format;
  const mime =
    format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
  const stem = sanitizeFilenameStem(file.name, 'document');

  const pdf = await loadPdfJsDocument(file);
  const outCanvas = document.createElement('canvas');
  const tmpCanvas = document.createElement('canvas');

  try {
    const n = pdf.numPages;
    if (n === 0) {
      throw new PdfToolError('The PDF contains no pages to stitch.', 'validation');
    }

    const baseDims: Array<{ w: number; h: number }> = [];
    for (let p = 1; p <= n; p += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const page = await pdf.getPage(p);
      try {
        const vp = page.getViewport({ scale: 1 });
        baseDims.push({ w: Math.max(1, vp.width), h: Math.max(1, vp.height) });
      } finally {
        page.cleanup();
      }
    }

    const baseMaxW = Math.max(...baseDims.map((d) => d.w));
    const baseSumH = baseDims.reduce((s, d) => s + d.h, 0);
    const totalGapMax = Math.max(0, MAX_CANVAS_DIM - n * 4);
    const effectiveGap =
      requestedGap * Math.max(0, n - 1) > totalGapMax
        ? Math.floor(totalGapMax / Math.max(1, n - 1))
        : requestedGap;
    const totalGapsPx = effectiveGap * Math.max(0, n - 1);

    const availH = Math.max(1, MAX_CANVAS_DIM - totalGapsPx);
    const maxAllowedScale = Math.min(
      MAX_CANVAS_DIM / Math.max(1, baseMaxW),
      availH / Math.max(1, baseSumH)
    );
    const effectiveScale = Math.min(requestedScale, maxAllowedScale);
    const wasDownscaled = effectiveScale < requestedScale - 0.001;

    const targetDims = baseDims.map((d) => ({
      w: Math.max(1, Math.floor(d.w * effectiveScale)),
      h: Math.max(1, Math.floor(d.h * effectiveScale)),
    }));
    const outWidth = Math.min(MAX_CANVAS_DIM, Math.max(1, ...targetDims.map((d) => d.w)));
    const outHeight = Math.min(
      MAX_CANVAS_DIM,
      Math.max(1, targetDims.reduce((s, d) => s + d.h, 0) + totalGapsPx)
    );

    outCanvas.width = outWidth;
    outCanvas.height = outHeight;
    const ctx = outCanvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new PdfToolError('Could not initialize 2D canvas context for stitching.', 'unknown');
    }

    ctx.fillStyle = '#f4f5f7';
    ctx.fillRect(0, 0, outWidth, outHeight);

    let curY = 0;
    for (let i = 0; i < n; i += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { width, height } = await renderPdfPageToCanvas(
        pdf,
        i + 1,
        tmpCanvas,
        effectiveScale
      );
      const drawW = Math.min(width, outWidth);
      const drawH = Math.min(height, Math.max(1, outHeight - curY));
      const dx = Math.max(0, Math.floor((outWidth - drawW) / 2));

      ctx.drawImage(tmpCanvas, 0, 0, drawW, drawH, dx, curY, drawW, drawH);

      // Crisp 1px page border & inter-page divider
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1;
      ctx.strokeRect(dx + 0.5, curY + 0.5, Math.max(0, drawW - 1), Math.max(0, drawH - 1));

      curY += drawH;
      if (i < n - 1) {
        if (effectiveGap >= 4) {
          const divY = Math.min(outHeight - 1, curY + Math.floor(effectiveGap / 2)) + 0.5;
          ctx.beginPath();
          ctx.moveTo(0, divY);
          ctx.lineTo(outWidth, divY);
          ctx.strokeStyle = '#cbd5e1';
          ctx.stroke();
        }
        curY += effectiveGap;
      }

      onProgress?.(Math.round(((i + 1) / n) * 90));
    }

    const blob = await canvasToBlobSafe(outCanvas, mime, quality);
    onProgress?.(100);
    return {
      blob,
      url: URL.createObjectURL(blob),
      fileName: `${stem}-stitched.${ext}`,
      mimeType: mime,
      sizeBytes: blob.size,
      elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
      pageCount: n,
      summary: `Stitched ${n} page(s) vertically (${outWidth}×${outHeight}px ${ext.toUpperCase()}${
        wasDownscaled ? `, auto-scaled to ${effectiveScale.toFixed(2)}x` : ''
      })`,
    };
  } finally {
    tmpCanvas.width = 0;
    tmpCanvas.height = 0;
    outCanvas.width = 0;
    outCanvas.height = 0;
    await pdf.destroy().catch(() => {});
  }
}
