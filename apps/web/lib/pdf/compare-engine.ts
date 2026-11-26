import JSZip from 'jszip';
import { PdfToolError } from './errors.ts';
import { docxToPdfRich } from './office-convert.ts';
import { loadPdfJsDocument, renderPdfPageToCanvas } from './pdf-browser.ts';
import type { FormattingDelta, StyledWordToken } from './types.ts';

type PdfJsDocumentProxy = import('pdfjs-dist/types/src/display/api').PDFDocumentProxy;
type PdfJsPageProxy = import('pdfjs-dist/types/src/display/api').PDFPageProxy;

export type NormalizedFontFamily = 'helvetica' | 'times' | 'courier' | 'other';

export interface PageWordDiff {
  pageNumber: number;
  status: 'identical' | 'modified' | 'added-in-b' | 'removed-in-b' | 'no-text';
  addedWords: string[];
  removedWords: string[];
  formattingDeltas: FormattingDelta[];
  formattingChangeCount: number;
  visualDiffPercent?: number;
}

export interface PdfComparisonSummary {
  pagesA: number;
  pagesB: number;
  identicalCount: number;
  modifiedCount: number;
  formattingChangeCount: number;
  totalAddedWords: number;
  totalRemovedWords: number;
  docTypeA: 'pdf' | 'docx';
  docTypeB: 'pdf' | 'docx';
  pageDiffs: PageWordDiff[];
  reportText: string;
}

export interface CompareDocumentsOptions {
  trackFormatting?: boolean;
  formattingSensitivityPt?: number;
  onProgress?: (pct: number) => void;
}

export interface ComparableDocument {
  docType: 'pdf' | 'docx';
  originalFile: File;
  pdfFile: File;
  styledPages?: StyledWordToken[][];
}

const comparableDocCache = new WeakMap<File, Promise<ComparableDocument>>();

export function isDocxFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return (
    lower.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
}

function clamp01(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.max(0, Math.min(1, val));
}

function roundPt(pt: number): number {
  if (!Number.isFinite(pt) || pt <= 0) return 11;
  return Math.round(pt * 10) / 10;
}

function formatFamilyLabel(family: string): string {
  switch (family) {
    case 'helvetica':
      return 'Helvetica';
    case 'times':
      return 'Times';
    case 'courier':
      return 'Courier';
    default:
      return 'Other';
  }
}

function classifyFont(
  rawName: string,
  styleHint = '',
  explicitBold?: boolean,
  explicitItalic?: boolean
): { fontFamily: NormalizedFontFamily; rawFontName: string; bold: boolean; italic: boolean } {
  const cleanedRaw = rawName.replace(/^[A-Z]{6}\+/, '').trim() || 'sans-serif';
  const desc = `${cleanedRaw} ${styleHint}`.toLowerCase();

  const bold =
    explicitBold !== undefined
      ? explicitBold
      : /bold|black|heavy|semibold|demi|extra[- ]?bold|\b[6-9]00\b/.test(desc);
  const italic =
    explicitItalic !== undefined
      ? explicitItalic
      : /italic|oblique|slant|\bsl\b/.test(desc);

  let fontFamily: NormalizedFontFamily = 'other';
  if (/courier|consolas|monaco|menlo|mono|fira\s?code|source\s?code|dejavu\s?sans\s?mono|monospace/.test(desc)) {
    fontFamily = 'courier';
  } else if (/times|serif|georgia|garamond|palatino|cambria|calisto|baskerville|book\s?antiqua/.test(desc)) {
    fontFamily = 'times';
  } else if (/helvetica|arial|calibri|sans|inter|roboto|segoe|verdana|tahoma|trebuchet|lato|open\s?sans|aptos|sans-serif/.test(desc)) {
    fontFamily = 'helvetica';
  }

  return { fontFamily, rawFontName: cleanedRaw, bold, italic };
}

/**
 * Extracts styled word tokens from a PDF.js page using getOperatorList() + commonObjs
 * for accurate PostScript font resolution alongside item.transform font sizing.
 */
export async function extractPdfPageStyledTokens(page: PdfJsPageProxy): Promise<StyledWordToken[]> {
  try {
    await page.getOperatorList();
  } catch {
    // Continue gracefully with textContent styles fallback if operator list fails
  }

  const vp = page.getViewport({ scale: 1 });
  const pdfjs = await import('pdfjs-dist');
  const tc = await page.getTextContent();
  const styles = (tc.styles || {}) as Record<string, { fontFamily?: string }>;
  const tokens: StyledWordToken[] = [];

  for (const rawItem of tc.items) {
    if (!('str' in rawItem) || !rawItem.str.trim()) continue;
    const item = rawItem;
    const tx = pdfjs.Util.transform(vp.transform, item.transform);
    const fontSizePt = roundPt(Math.hypot(tx[0], tx[1]) || item.height || 11);
    const xPts = tx[4];
    // vp.transform maps PDF coordinates to viewport top-left space (y increases downward)
    const yTopPts = tx[5] - fontSizePt;
    const yNorm = clamp01(yTopPts / Math.max(1, vp.height));

    const styleInfo = styles[item.fontName];
    let resolvedName = '';
    if (item.fontName && page.commonObjs.has(item.fontName)) {
      const fontObj = page.commonObjs.get(item.fontName) as { name?: string } | undefined;
      if (fontObj?.name) resolvedName = fontObj.name;
    }

    const fontMeta = classifyFont(
      resolvedName || styleInfo?.fontFamily || item.fontName || 'sans-serif',
      `${styleInfo?.fontFamily || ''} ${item.fontName || ''}`
    );

    const words = item.str.trim().split(/\s+/).filter(Boolean);
    const itemWidth = Math.max(0, item.width || 0);
    const stepW = words.length > 1 ? itemWidth / words.length : 0;

    for (let wIdx = 0; wIdx < words.length; wIdx += 1) {
      const xNorm = clamp01((xPts + wIdx * stepW) / Math.max(1, vp.width));
      tokens.push({
        word: words[wIdx],
        fontFamily: fontMeta.fontFamily,
        rawFontName: fontMeta.rawFontName,
        fontSizePt,
        bold: fontMeta.bold,
        italic: fontMeta.italic,
        xNorm,
        yNorm,
      });
    }
  }

  return tokens;
}

interface DocxRunStyleDefaults {
  fontName?: string;
  fontSizePt?: number;
  bold?: boolean;
  italic?: boolean;
}

function getDirectChild(el: Element, localName: string): Element | null {
  for (const child of Array.from(el.children)) {
    const ln = child.localName || child.tagName.split(':').pop();
    if (ln === localName) return child;
  }
  return null;
}

function getDirectChildren(el: Element, localName: string): Element[] {
  const out: Element[] = [];
  for (const child of Array.from(el.children)) {
    const ln = child.localName || child.tagName.split(':').pop();
    if (ln === localName) out.push(child);
  }
  return out;
}

function getXmlAttr(el: Element | null, attrName: string): string | null {
  if (!el) return null;
  return el.getAttribute(`w:${attrName}`) ?? el.getAttribute(attrName);
}

function parseWmlToggle(el: Element | null): boolean | undefined {
  if (!el) return undefined;
  const val = getXmlAttr(el, 'val');
  if (val === null) return true;
  const lower = val.toLowerCase();
  return lower !== '0' && lower !== 'false' && lower !== 'off';
}

function parseRPrElement(rPr: Element | null): DocxRunStyleDefaults {
  if (!rPr) return {};
  const bEl = getDirectChild(rPr, 'b');
  const iEl = getDirectChild(rPr, 'i');
  const szEl = getDirectChild(rPr, 'sz');
  const rFontsEl = getDirectChild(rPr, 'rFonts');

  const szRaw = getXmlAttr(szEl, 'val');
  const szNum = szRaw ? Number(szRaw) : NaN;
  const fontSizePt = Number.isFinite(szNum) && szNum > 0 ? roundPt(szNum / 2) : undefined;

  const fontName =
    getXmlAttr(rFontsEl, 'ascii') ||
    getXmlAttr(rFontsEl, 'hAnsi') ||
    getXmlAttr(rFontsEl, 'cs') ||
    getXmlAttr(rFontsEl, 'eastAsia') ||
    undefined;

  return {
    bold: parseWmlToggle(bEl),
    italic: parseWmlToggle(iEl),
    fontSizePt,
    fontName,
  };
}

/**
 * Extracts per-page styled word tokens directly from a DOCX archive's word/document.xml
 * (with optional word/styles.xml inheritance) preserving exact <w:rPr> font, size, bold, and italic.
 */
export async function extractDocxStyledPages(file: File): Promise<StyledWordToken[][]> {
  if (file.size > 64 * 1024 * 1024) {
    throw new PdfToolError('Word document exceeds 64 MB browser limit.', 'validation');
  }
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const docEntry = zip.file('word/document.xml');
  if (!docEntry) {
    throw new PdfToolError('Invalid .docx archive (missing word/document.xml).', 'validation');
  }

  let docDefaults: DocxRunStyleDefaults = {
    fontName: 'Calibri',
    fontSizePt: 11,
    bold: false,
    italic: false,
  };
  const styleMap = new Map<string, DocxRunStyleDefaults>();

  const stylesEntry = zip.file('word/styles.xml');
  if (stylesEntry) {
    try {
      const stylesXml = new DOMParser().parseFromString(
        await stylesEntry.async('text'),
        'application/xml'
      );
      const rPrDefault = stylesXml.getElementsByTagName('w:rPrDefault')[0];
      if (rPrDefault) {
        const parsedDefault = parseRPrElement(getDirectChild(rPrDefault, 'rPr'));
        docDefaults = { ...docDefaults, ...parsedDefault };
      }
      for (const st of Array.from(stylesXml.getElementsByTagName('w:style'))) {
        const styleId = getXmlAttr(st, 'styleId');
        if (!styleId) continue;
        const parsed = parseRPrElement(getDirectChild(st, 'rPr'));
        styleMap.set(styleId, parsed);
      }
    } catch {
      // Non-fatal: fall back to standard defaults
    }
  }

  const docXmlText = await docEntry.async('text');
  const docXml = new DOMParser().parseFromString(docXmlText, 'application/xml');
  const body = docXml.getElementsByTagName('w:body')[0] || docXml.documentElement;

  const pages: StyledWordToken[][] = [[]];
  const MAX_LINES_PER_PAGE = 46;
  const MAX_CHARS_PER_LINE = 86;
  let currentLine = 0;

  const startNewPage = () => {
    if (pages[pages.length - 1].length > 0) {
      pages.push([]);
      currentLine = 0;
    }
  };

  const processParagraph = (pEl: Element) => {
    const pPr = getDirectChild(pEl, 'pPr');
    const pStyleId = getXmlAttr(getDirectChild(pPr || pEl, 'pStyle'), 'val') || '';
    const pageBreakBefore = parseWmlToggle(getDirectChild(pPr || pEl, 'pageBreakBefore'));
    if (pageBreakBefore) {
      startNewPage();
    }

    const styleDefaults = styleMap.get(pStyleId) || {};
    const pRPrDefaults = parseRPrElement(pPr ? getDirectChild(pPr, 'rPr') : null);
    const headingFallbackPt = /heading1|title/i.test(pStyleId)
      ? 18
      : /heading2|subtitle/i.test(pStyleId)
      ? 14.5
      : /heading3/i.test(pStyleId)
      ? 12.5
      : undefined;
    const headingFallbackBold = /heading[1-3]|title/i.test(pStyleId) ? true : undefined;

    let lineChars = 0;
    let paragraphHadTokens = false;

    const handleRun = (rEl: Element) => {
      const rPr = parseRPrElement(getDirectChild(rEl, 'rPr'));

      for (const child of Array.from(rEl.children)) {
        const ln = child.localName || child.tagName.split(':').pop();
        if (ln === 'br') {
          const brType = getXmlAttr(child, 'type');
          if (brType === 'page') {
            startNewPage();
            lineChars = 0;
          } else {
            currentLine += 1;
            lineChars = 0;
            if (currentLine >= MAX_LINES_PER_PAGE) startNewPage();
          }
          continue;
        }
        if (ln !== 't' && ln !== 'delText') continue;
        if (ln === 'delText') continue; // Skip tracked deletions in current view

        const rawText = child.textContent || '';
        const words = rawText.trim().split(/\s+/).filter(Boolean);
        if (words.length === 0) continue;

        const effectiveFontName =
          rPr.fontName ?? pRPrDefaults.fontName ?? styleDefaults.fontName ?? docDefaults.fontName ?? 'Calibri';
        const effectiveSizePt =
          rPr.fontSizePt ??
          pRPrDefaults.fontSizePt ??
          styleDefaults.fontSizePt ??
          headingFallbackPt ??
          docDefaults.fontSizePt ??
          11;
        const effectiveBold =
          rPr.bold ?? pRPrDefaults.bold ?? styleDefaults.bold ?? headingFallbackBold ?? docDefaults.bold ?? false;
        const effectiveItalic =
          rPr.italic ?? pRPrDefaults.italic ?? styleDefaults.italic ?? docDefaults.italic ?? false;

        const fontMeta = classifyFont(effectiveFontName, '', effectiveBold, effectiveItalic);

        for (const word of words) {
          if (lineChars > 0 && lineChars + word.length + 1 > MAX_CHARS_PER_LINE) {
            currentLine += 1;
            lineChars = 0;
            if (currentLine >= MAX_LINES_PER_PAGE) {
              startNewPage();
            }
          }

          const xNorm = clamp01(lineChars / MAX_CHARS_PER_LINE);
          const yNorm = clamp01(currentLine / MAX_LINES_PER_PAGE);

          pages[pages.length - 1].push({
            word,
            fontFamily: fontMeta.fontFamily,
            rawFontName: fontMeta.rawFontName,
            fontSizePt: effectiveSizePt,
            bold: fontMeta.bold,
            italic: fontMeta.italic,
            xNorm,
            yNorm,
          });

          lineChars += word.length + 1;
          paragraphHadTokens = true;
        }
      }
    };

    for (const child of Array.from(pEl.children)) {
      const ln = child.localName || child.tagName.split(':').pop();
      if (ln === 'r') {
        handleRun(child);
      } else if (ln === 'hyperlink' || ln === 'ins') {
        for (const nestedRun of getDirectChildren(child, 'r')) {
          handleRun(nestedRun);
        }
      }
    }

    if (paragraphHadTokens) {
      currentLine += 1;
      if (currentLine >= MAX_LINES_PER_PAGE) {
        startNewPage();
      }
    }
  };

  const processNode = (node: Element) => {
    const ln = node.localName || node.tagName.split(':').pop();
    if (ln === 'p') {
      processParagraph(node);
    } else if (ln === 'tbl') {
      for (const tr of getDirectChildren(node, 'tr')) {
        for (const tc of getDirectChildren(tr, 'tc')) {
          for (const cellChild of Array.from(tc.children)) {
            processNode(cellChild);
          }
        }
      }
    } else if (ln === 'sdt') {
      const sdtContent = getDirectChild(node, 'sdtContent');
      if (sdtContent) {
        for (const c of Array.from(sdtContent.children)) processNode(c);
      }
    }
  };

  for (const child of Array.from(body.children)) {
    processNode(child);
  }

  return pages;
}

/**
 * Ensures any PDF or DOCX file is ready for both visual canvas rendering and styled token comparison.
 * PDF files pass through with zero overhead; DOCX files are cached per File reference.
 */
export async function ensureComparableDocument(file: File): Promise<ComparableDocument> {
  if (!isDocxFile(file)) {
    return {
      docType: 'pdf',
      originalFile: file,
      pdfFile: file,
    };
  }

  const existing = comparableDocCache.get(file);
  if (existing) return existing;

  const promise = (async (): Promise<ComparableDocument> => {
    const [styledPages, pdfResult] = await Promise.all([
      extractDocxStyledPages(file),
      docxToPdfRich(file),
    ]);
    const pdfFile = new File([pdfResult.blob], pdfResult.fileName, { type: 'application/pdf' });
    return {
      docType: 'docx',
      originalFile: file,
      pdfFile,
      styledPages,
    };
  })();

  comparableDocCache.set(file, promise);
  try {
    return await promise;
  } catch (err) {
    comparableDocCache.delete(file);
    throw err;
  }
}

function lcsAlignIndices(wordsA: string[], wordsB: string[]): Array<[number, number]> {
  const n = wordsA.length;
  const m = wordsB.length;
  if (n === 0 || m === 0) return [];

  let prefix = 0;
  while (prefix < n && prefix < m && wordsA[prefix] === wordsB[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < n - prefix &&
    suffix < m - prefix &&
    wordsA[n - 1 - suffix] === wordsB[m - 1 - suffix]
  ) {
    suffix += 1;
  }

  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < prefix; i += 1) {
    pairs.push([i, i]);
  }

  const midN = n - prefix - suffix;
  const midM = m - prefix - suffix;

  if (midN > 0 && midM > 0) {
    if (midN * midM <= 500_000) {
      const cols = midM + 1;
      const dp = new Int32Array((midN + 1) * cols);

      for (let i = 1; i <= midN; i += 1) {
        const wA = wordsA[prefix + i - 1];
        const rowOffset = i * cols;
        const prevRowOffset = (i - 1) * cols;
        for (let j = 1; j <= midM; j += 1) {
          if (wA === wordsB[prefix + j - 1]) {
            dp[rowOffset + j] = dp[prevRowOffset + j - 1] + 1;
          } else {
            const up = dp[prevRowOffset + j];
            const left = dp[rowOffset + j - 1];
            dp[rowOffset + j] = up >= left ? up : left;
          }
        }
      }

      const midPairs: Array<[number, number]> = [];
      let i = midN;
      let j = midM;
      while (i > 0 && j > 0) {
        if (wordsA[prefix + i - 1] === wordsB[prefix + j - 1]) {
          midPairs.push([prefix + i - 1, prefix + j - 1]);
          i -= 1;
          j -= 1;
        } else if (dp[(i - 1) * cols + j] >= dp[i * cols + (j - 1)]) {
          i -= 1;
        } else {
          j -= 1;
        }
      }
      midPairs.reverse();
      for (const pair of midPairs) pairs.push(pair);
    } else {
      // Bounded greedy lookahead fallback for ultra-dense multi-thousand-word pages
      let ia = 0;
      let ib = 0;
      const LOOKAHEAD = 64;
      while (ia < midN && ib < midM) {
        if (wordsA[prefix + ia] === wordsB[prefix + ib]) {
          pairs.push([prefix + ia, prefix + ib]);
          ia += 1;
          ib += 1;
          continue;
        }
        let bestSkipA = -1;
        let bestSkipB = -1;
        let bestDist = LOOKAHEAD * 2 + 1;
        for (let da = 0; da < LOOKAHEAD && ia + da < midN; da += 1) {
          const target = wordsA[prefix + ia + da];
          for (let db = 0; db < LOOKAHEAD && ib + db < midM; db += 1) {
            if (target === wordsB[prefix + ib + db]) {
              const dist = da + db;
              if (dist < bestDist) {
                bestDist = dist;
                bestSkipA = da;
                bestSkipB = db;
              }
              break;
            }
          }
        }
        if (bestSkipA >= 0) {
          ia += bestSkipA;
          ib += bestSkipB;
          pairs.push([prefix + ia, prefix + ib]);
          ia += 1;
          ib += 1;
        } else {
          ia += 1;
          ib += 1;
        }
      }
    }
  }

  for (let s = suffix - 1; s >= 0; s -= 1) {
    pairs.push([n - 1 - s, m - 1 - s]);
  }

  return pairs;
}

function buildFormattingChanges(
  a: StyledWordToken,
  b: StyledWordToken,
  sensitivityPt: number
): FormattingDelta['changes'] {
  const changes: FormattingDelta['changes'] = [];
  if (a.fontFamily !== b.fontFamily) {
    changes.push({
      kind: 'fontFamily',
      from: formatFamilyLabel(a.fontFamily),
      to: formatFamilyLabel(b.fontFamily),
    });
  }
  const deltaPt = Number((b.fontSizePt - a.fontSizePt).toFixed(1));
  if (Math.abs(deltaPt) > sensitivityPt) {
    changes.push({
      kind: 'fontSize',
      from: a.fontSizePt,
      to: b.fontSizePt,
      deltaPt,
    });
  }
  if (a.bold !== b.bold) {
    changes.push({
      kind: 'bold',
      from: a.bold,
      to: b.bold,
    });
  }
  if (a.italic !== b.italic) {
    changes.push({
      kind: 'italic',
      from: a.italic,
      to: b.italic,
    });
  }
  return changes;
}

function formatDeltaListForReport(changes: FormattingDelta['changes']): string {
  return changes
    .map((c) => {
      if (c.kind === 'fontFamily') return `Font ${c.from} -> ${c.to}`;
      if (c.kind === 'fontSize') {
        const sign = c.deltaPt > 0 ? '+' : '';
        return `Size ${c.from}pt -> ${c.to}pt (${sign}${c.deltaPt}pt)`;
      }
      if (c.kind === 'bold') return c.to ? 'Regular -> Bold' : 'Bold -> Regular';
      return c.to ? 'Roman -> Italic' : 'Italic -> Roman';
    })
    .join(', ');
}

function diffPageTokens(
  tokensA: StyledWordToken[],
  tokensB: StyledWordToken[],
  pageNumber: number,
  trackFormatting: boolean,
  sensitivityPt: number
): {
  addedWords: string[];
  removedWords: string[];
  addedCount: number;
  removedCount: number;
  formattingDeltas: FormattingDelta[];
} {
  const wordsA = tokensA.map((t) => t.word);
  const wordsB = tokensB.map((t) => t.word);
  const aligned = lcsAlignIndices(wordsA, wordsB);

  const matchedA = new Set<number>();
  const matchedB = new Set<number>();
  for (const [ia, ib] of aligned) {
    matchedA.add(ia);
    matchedB.add(ib);
  }

  const removedAll: string[] = [];
  for (let i = 0; i < wordsA.length; i += 1) {
    if (!matchedA.has(i)) removedAll.push(wordsA[i]);
  }
  const addedAll: string[] = [];
  for (let j = 0; j < wordsB.length; j += 1) {
    if (!matchedB.has(j)) addedAll.push(wordsB[j]);
  }

  const formattingDeltas: FormattingDelta[] = [];
  if (trackFormatting && aligned.length > 0) {
    let activeRun: {
      lastIdxA: number;
      lastIdxB: number;
      lastYNorm: number;
      sig: string;
      words: string[];
      changes: FormattingDelta['changes'];
    } | null = null;

    const flushRun = () => {
      if (!activeRun) return;
      const joined = activeRun.words.join(' ');
      const textSample = joined.length > 110 ? `${joined.slice(0, 107)}…` : joined;
      formattingDeltas.push({
        pageNumber,
        textSample,
        changes: activeRun.changes,
      });
      activeRun = null;
    };

    for (const [ia, ib] of aligned) {
      const tokA = tokensA[ia];
      const tokB = tokensB[ib];
      const changes = buildFormattingChanges(tokA, tokB, sensitivityPt);
      if (changes.length === 0) {
        flushRun();
        continue;
      }

      const sig = JSON.stringify(changes);
      const isConsecutiveSameLine =
        activeRun !== null &&
        ia === activeRun.lastIdxA + 1 &&
        ib === activeRun.lastIdxB + 1 &&
        Math.abs(tokB.yNorm - activeRun.lastYNorm) < 0.03 &&
        activeRun.sig === sig;

      if (isConsecutiveSameLine && activeRun) {
        activeRun.words.push(tokB.word);
        activeRun.lastIdxA = ia;
        activeRun.lastIdxB = ib;
        activeRun.lastYNorm = tokB.yNorm;
      } else {
        flushRun();
        activeRun = {
          lastIdxA: ia,
          lastIdxB: ib,
          lastYNorm: tokB.yNorm,
          sig,
          words: [tokB.word],
          changes,
        };
      }
    }
    flushRun();
  }

  return {
    addedWords: addedAll.slice(0, 35),
    removedWords: removedAll.slice(0, 35),
    addedCount: addedAll.length,
    removedCount: removedAll.length,
    formattingDeltas,
  };
}

/**
 * Innovation: Uncapped Full-Document Word + Visual Pixel Diff Engine.
 * Supports PDF and DOCX files seamlessly, generating a magenta pixel-diff overlay canvas.
 */
export async function renderVisualPixelDiff(
  fileA: File,
  fileB: File,
  pageNumber: number,
  targetCanvas: HTMLCanvasElement,
  scale = 1.25
): Promise<{ diffPercent: number; width: number; height: number }> {
  const [compA, compB] = await Promise.all([
    ensureComparableDocument(fileA),
    ensureComparableDocument(fileB),
  ]);
  const [pdfA, pdfB] = await Promise.all([
    loadPdfJsDocument(compA.pdfFile),
    loadPdfJsDocument(compB.pdfFile),
  ]);
  const cA = document.createElement('canvas');
  const cB = document.createElement('canvas');

  try {
    if (pageNumber <= pdfA.numPages) {
      await renderPdfPageToCanvas(pdfA, pageNumber, cA, scale);
    }
    if (pageNumber <= pdfB.numPages) {
      await renderPdfPageToCanvas(pdfB, pageNumber, cB, scale);
    }

    const w = Math.max(1, cA.width, cB.width);
    const h = Math.max(1, cA.height, cB.height);
    targetCanvas.width = w;
    targetCanvas.height = h;
    const outCtx = targetCanvas.getContext('2d');
    if (!outCtx) throw new Error('Canvas unavailable');

    outCtx.fillStyle = '#ffffff';
    outCtx.fillRect(0, 0, w, h);

    const ctxA = cA.getContext('2d');
    const ctxB = cB.getContext('2d');
    const imgA = cA.width > 0 && ctxA ? ctxA.getImageData(0, 0, cA.width, cA.height) : null;
    const imgB = cB.width > 0 && ctxB ? ctxB.getImageData(0, 0, cB.width, cB.height) : null;
    const out = outCtx.createImageData(w, h);

    let changedPixels = 0;
    const totalPixels = w * h;

    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const outIdx = (y * w + x) * 4;
        const aInBounds = imgA && x < imgA.width && y < imgA.height;
        const bInBounds = imgB && x < imgB.width && y < imgB.height;
        const idxA = aInBounds ? (y * imgA.width + x) * 4 : -1;
        const idxB = bInBounds ? (y * imgB.width + x) * 4 : -1;

        const rA = idxA >= 0 ? imgA!.data[idxA] : 255;
        const gA = idxA >= 0 ? imgA!.data[idxA + 1] : 255;
        const bA = idxA >= 0 ? imgA!.data[idxA + 2] : 255;

        const rB = idxB >= 0 ? imgB!.data[idxB] : 255;
        const gB = idxB >= 0 ? imgB!.data[idxB + 1] : 255;
        const bB = idxB >= 0 ? imgB!.data[idxB + 2] : 255;

        const delta = Math.abs(rA - rB) + Math.abs(gA - gB) + Math.abs(bA - bB);
        if (delta > 45) {
          changedPixels += 1;
          out.data[outIdx] = 228;
          out.data[outIdx + 1] = 33;
          out.data[outIdx + 2] = 92;
          out.data[outIdx + 3] = 255;
        } else {
          const lum = Math.round((rB + gB + bB) / 3);
          const muted = Math.min(255, Math.round(lum * 0.4 + 150));
          out.data[outIdx] = muted;
          out.data[outIdx + 1] = muted;
          out.data[outIdx + 2] = muted;
          out.data[outIdx + 3] = 255;
        }
      }
    }

    outCtx.putImageData(out, 0, 0);
    const diffPercent = Number(((changedPixels / totalPixels) * 100).toFixed(2));
    return { diffPercent, width: w, height: h };
  } finally {
    cA.width = 0;
    cA.height = 0;
    cB.width = 0;
    cB.height = 0;
    await pdfA.destroy().catch(() => {});
    await pdfB.destroy().catch(() => {});
  }
}

export async function comparePdfDocuments(
  fileA: File,
  fileB: File,
  optionsOrProgress?: ((pct: number) => void) | CompareDocumentsOptions,
  onProgressFallback?: (pct: number) => void
): Promise<PdfComparisonSummary> {
  const options: CompareDocumentsOptions =
    typeof optionsOrProgress === 'function' ? {} : optionsOrProgress ?? {};
  const onProgress =
    typeof optionsOrProgress === 'function'
      ? optionsOrProgress
      : options.onProgress ?? onProgressFallback;
  const trackFormatting = options.trackFormatting ?? true;
  const sensitivityPt = options.formattingSensitivityPt ?? 0.5;

  const [compA, compB] = await Promise.all([
    ensureComparableDocument(fileA),
    ensureComparableDocument(fileB),
  ]);

  let pdfA: PdfJsDocumentProxy | null = null;
  let pdfB: PdfJsDocumentProxy | null = null;

  try {
    [pdfA, pdfB] = await Promise.all([
      compA.docType === 'pdf' ? loadPdfJsDocument(compA.pdfFile) : Promise.resolve(null),
      compB.docType === 'pdf' ? loadPdfJsDocument(compB.pdfFile) : Promise.resolve(null),
    ]);

    const pagesA = compA.docType === 'docx' ? compA.styledPages?.length ?? 0 : pdfA?.numPages ?? 0;
    const pagesB = compB.docType === 'docx' ? compB.styledPages?.length ?? 0 : pdfB?.numPages ?? 0;
    const maxPages = Math.max(1, pagesA, pagesB);

    const pageDiffs: PageWordDiff[] = [];
    let identicalCount = 0;
    let modifiedCount = 0;
    let totalFormattingChanges = 0;
    let totalAddedWords = 0;
    let totalRemovedWords = 0;

    for (let p = 1; p <= maxPages; p += 1) {
      let tokensA: StyledWordToken[] = [];
      let tokensB: StyledWordToken[] = [];

      if (p <= pagesA) {
        if (compA.docType === 'docx') {
          tokensA = compA.styledPages?.[p - 1] ?? [];
        } else if (pdfA) {
          const pageA = await pdfA.getPage(p);
          try {
            tokensA = await extractPdfPageStyledTokens(pageA);
          } finally {
            pageA.cleanup();
          }
        }
      }

      if (p <= pagesB) {
        if (compB.docType === 'docx') {
          tokensB = compB.styledPages?.[p - 1] ?? [];
        } else if (pdfB) {
          const pageB = await pdfB.getPage(p);
          try {
            tokensB = await extractPdfPageStyledTokens(pageB);
          } finally {
            pageB.cleanup();
          }
        }
      }

      if (p > pagesA) {
        modifiedCount += 1;
        totalAddedWords += tokensB.length;
        pageDiffs.push({
          pageNumber: p,
          status: 'added-in-b',
          addedWords: tokensB.slice(0, 25).map((t) => t.word),
          removedWords: [],
          formattingDeltas: [],
          formattingChangeCount: 0,
        });
      } else if (p > pagesB) {
        modifiedCount += 1;
        totalRemovedWords += tokensA.length;
        pageDiffs.push({
          pageNumber: p,
          status: 'removed-in-b',
          addedWords: [],
          removedWords: tokensA.slice(0, 25).map((t) => t.word),
          formattingDeltas: [],
          formattingChangeCount: 0,
        });
      } else if (tokensA.length === 0 && tokensB.length === 0) {
        pageDiffs.push({
          pageNumber: p,
          status: 'no-text',
          addedWords: [],
          removedWords: [],
          formattingDeltas: [],
          formattingChangeCount: 0,
        });
      } else {
        const diff = diffPageTokens(tokensA, tokensB, p, trackFormatting, sensitivityPt);
        totalAddedWords += diff.addedCount;
        totalRemovedWords += diff.removedCount;
        totalFormattingChanges += diff.formattingDeltas.length;

        const hasChanges =
          diff.addedCount > 0 || diff.removedCount > 0 || diff.formattingDeltas.length > 0;

        if (!hasChanges) {
          identicalCount += 1;
          pageDiffs.push({
            pageNumber: p,
            status: 'identical',
            addedWords: [],
            removedWords: [],
            formattingDeltas: [],
            formattingChangeCount: 0,
          });
        } else {
          modifiedCount += 1;
          pageDiffs.push({
            pageNumber: p,
            status: 'modified',
            addedWords: diff.addedWords,
            removedWords: diff.removedWords,
            formattingDeltas: diff.formattingDeltas,
            formattingChangeCount: diff.formattingDeltas.length,
          });
        }
      }

      onProgress?.(Math.round((p / maxPages) * 100));
    }

    const lines: string[] = [
      `MUXARO Document Comparison Report`,
      `Document A: ${fileA.name} [${compA.docType.toUpperCase()}] (${pagesA} pages)`,
      `Document B: ${fileB.name} [${compB.docType.toUpperCase()}] (${pagesB} pages)`,
      `Formatting Tracking: ${trackFormatting ? `Enabled (>= ${sensitivityPt}pt)` : 'Disabled'}`,
      `Summary: ${identicalCount} identical, ${modifiedCount} changed, +${totalAddedWords} added words, -${totalRemovedWords} removed words, ${totalFormattingChanges} formatting changes`,
      ``,
    ];

    for (const d of pageDiffs) {
      if (d.status === 'identical') continue;
      lines.push(`Page ${d.pageNumber} [${d.status.toUpperCase()}]`);
      if (d.removedWords.length > 0) lines.push(`  - Removed: ${d.removedWords.join(' ')}`);
      if (d.addedWords.length > 0) lines.push(`  + Added:   ${d.addedWords.join(' ')}`);
      if (d.formattingDeltas.length > 0) {
        lines.push(`  * Formatting (${d.formattingDeltas.length}):`);
        for (const fd of d.formattingDeltas) {
          lines.push(`      "${fd.textSample}" -> ${formatDeltaListForReport(fd.changes)}`);
        }
      }
    }

    return {
      pagesA,
      pagesB,
      identicalCount,
      modifiedCount,
      formattingChangeCount: totalFormattingChanges,
      totalAddedWords,
      totalRemovedWords,
      docTypeA: compA.docType,
      docTypeB: compB.docType,
      pageDiffs,
      reportText: lines.join('\n'),
    };
  } finally {
    if (pdfA) await pdfA.destroy().catch(() => {});
    if (pdfB) await pdfB.destroy().catch(() => {});
  }
}
