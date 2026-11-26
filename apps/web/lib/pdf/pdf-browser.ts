import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib';
import { assertValidPdfFile, classifyPdfError } from './errors.ts';
import { classifyPdfFont, type ModernFontSlug } from './font-matcher.ts';
import type {
  PdfExistingLink,
  PdfExtractedImage,
  PdfPageInfo,
  PdfRawBufferEntry,
  PdfStandardFontChoice,
  PdfTextSpan,
} from './types.ts';

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type PdfJsDocumentProxy = import('pdfjs-dist/types/src/display/api').PDFDocumentProxy;

let pdfjsPromise: Promise<PdfJsModule> | null = null;

export async function getPdfJs(): Promise<PdfJsModule> {
  if (typeof window === 'undefined') {
    throw new Error('PDF.js can only run in the browser.');
  }
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((mod) => {
      const origin = window.location.origin;
      mod.GlobalWorkerOptions.workerSrc = `${origin}/vendor/pdfjs/pdf.worker.min.mjs`;
      return mod;
    });
  }
  return pdfjsPromise;
}

function getPdfJsDocumentParams(data: Uint8Array) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return {
    data,
    cMapUrl: `${origin}/vendor/pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${origin}/vendor/pdfjs/standard_fonts/`,
    canvasMaxAreaInBytes: 64 * 1024 * 1024,
    useSystemFonts: false,
  };
}

export async function loadPdfJsDocument(
  source: File | Uint8Array,
  password?: string
): Promise<PdfJsDocumentProxy> {
  if (source instanceof File) {
    await assertValidPdfFile(source);
  }
  const pdfjs = await getPdfJs();
  const bytes =
    source instanceof File ? new Uint8Array(await source.arrayBuffer()) : source.slice();

  try {
    const task = pdfjs.getDocument({
      ...getPdfJsDocumentParams(bytes),
      ...(password !== undefined ? { password } : {}),
    });
    return await task.promise;
  } catch (err) {
    throw classifyPdfError(err, source instanceof File ? source.name : undefined);
  }
}

export async function opensWithoutPassword(file: File): Promise<boolean> {
  let pdf: PdfJsDocumentProxy | null = null;
  try {
    pdf = await loadPdfJsDocument(file);
    return true;
  } catch {
    return false;
  } finally {
    if (pdf) {
      await pdf.destroy().catch(() => {});
    }
  }
}

export async function getPdfPageInfos(file: File, password?: string): Promise<PdfPageInfo[]> {
  const pdf = await loadPdfJsDocument(file, password);
  try {
    const infos: PdfPageInfo[] = [];
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      infos.push({
        pageNumber: i,
        width: vp.width,
        height: vp.height,
        rotation: page.rotate || 0,
      });
      page.cleanup();
    }
    return infos;
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

export async function renderPdfPageToCanvas(
  pdf: PdfJsDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = 1.25,
  extraRotation = 0
): Promise<{ width: number; height: number }> {
  const page = await pdf.getPage(pageNumber);
  try {
    const rotation = (page.rotate + extraRotation) % 360;
    const viewport = page.getViewport({ scale, rotation });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not initialize 2D canvas context.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;

    return { width: canvas.width, height: canvas.height };
  } finally {
    page.cleanup();
  }
}

export async function canvasToBlobSafe(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality = 0.9
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas encoding returned an empty blob.'));
      },
      mimeType,
      quality
    );
  });
}

function encodeRgbaToBaselineTiff(rgba: Uint8ClampedArray, width: number, height: number): Blob {
  const pixelBytesLen = width * height * 3;
  const ifdEntries = 10;
  const ifdOffset = 8;
  const ifdByteLen = 2 + ifdEntries * 12 + 4;
  const extraOffset = ifdOffset + ifdByteLen;
  const bpsOffset = extraOffset; // 6 bytes
  const xResOffset = bpsOffset + 6; // 8 bytes
  const yResOffset = xResOffset + 8; // 8 bytes
  const pixelOffset = yResOffset + 8;
  const out = new Uint8Array(pixelOffset + pixelBytesLen);
  const view = new DataView(out.buffer);

  // TIFF Header: Little-endian 'II', version 42, IFD offset = 8
  out[0] = 0x49;
  out[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);

  let cursor = ifdOffset;
  view.setUint16(cursor, ifdEntries, true);
  cursor += 2;
  const writeTag = (tag: number, type: number, count: number, valOrOffset: number) => {
    view.setUint16(cursor, tag, true);
    view.setUint16(cursor + 2, type, true);
    view.setUint32(cursor + 4, count, true);
    view.setUint32(cursor + 8, valOrOffset, true);
    cursor += 12;
  };
  writeTag(256, 4, 1, width); // ImageWidth
  writeTag(257, 4, 1, height); // ImageLength
  writeTag(258, 3, 3, bpsOffset); // BitsPerSample -> 8,8,8
  writeTag(259, 3, 1, 1); // Compression -> Uncompressed
  writeTag(262, 3, 1, 2); // PhotometricInterpretation -> RGB
  writeTag(273, 4, 1, pixelOffset); // StripOffsets
  writeTag(277, 3, 1, 3); // SamplesPerPixel -> 3
  writeTag(278, 4, 1, height); // RowsPerStrip
  writeTag(279, 4, 1, pixelBytesLen); // StripByteCounts
  writeTag(282, 5, 1, xResOffset); // XResolution -> 72 DPI
  view.setUint32(cursor, 0, true); // Next IFD = 0

  view.setUint16(bpsOffset, 8, true);
  view.setUint16(bpsOffset + 2, 8, true);
  view.setUint16(bpsOffset + 4, 8, true);
  view.setUint32(xResOffset, 72, true);
  view.setUint32(xResOffset + 4, 1, true);
  view.setUint32(yResOffset, 72, true);
  view.setUint32(yResOffset + 4, 1, true);

  for (let i = 0, p = pixelOffset; i < rgba.length; i += 4, p += 3) {
    out[p] = rgba[i];
    out[p + 1] = rgba[i + 1];
    out[p + 2] = rgba[i + 2];
  }
  return new Blob([out], { type: 'image/tiff' });
}

function encodeRgbaToGif89a(rgba: Uint8ClampedArray, width: number, height: number): Blob {
  // Build 216-color web-safe 6x6x6 RGB global color table padded to 256 entries
  const palette = new Uint8Array(256 * 3);
  let pIdx = 0;
  for (let r = 0; r < 6; r += 1) {
    for (let g = 0; g < 6; g += 1) {
      for (let b = 0; b < 6; b += 1) {
        palette[pIdx++] = Math.round((r * 255) / 5);
        palette[pIdx++] = Math.round((g * 255) / 5);
        palette[pIdx++] = Math.round((b * 255) / 5);
      }
    }
  }
  const pixelCount = width * height;
  const indices = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    const o = i * 4;
    const r6 = Math.round((rgba[o] * 5) / 255);
    const g6 = Math.round((rgba[o + 1] * 5) / 255);
    const b6 = Math.round((rgba[o + 2] * 5) / 255);
    indices[i] = r6 * 36 + g6 * 6 + b6;
  }

  // Pack 9-bit GIF LZW stream with periodic ClearCode (256) every 250 pixels so code size stays 9 bits
  const lzwBytes: number[] = [];
  let bitBuf = 0;
  let bitLen = 0;
  const pushCode9 = (code: number) => {
    bitBuf |= (code & 0x1ff) << bitLen;
    bitLen += 9;
    while (bitLen >= 8) {
      lzwBytes.push(bitBuf & 0xff);
      bitBuf >>= 8;
      bitLen -= 8;
    }
  };
  pushCode9(256); // Initial ClearCode
  for (let i = 0; i < indices.length; i += 1) {
    pushCode9(indices[i]);
    if ((i + 1) % 250 === 0 && i + 1 < indices.length) {
      pushCode9(256);
    }
  }
  pushCode9(257); // EOI
  if (bitLen > 0) lzwBytes.push(bitBuf & 0xff);

  const chunks: number[] = [
    // GIF89a Header
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    width & 0xff, (width >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
    0xf7, 0x00, 0x00, // GCT present, 8-bit color, 256 entries
  ];
  for (let i = 0; i < palette.length; i += 1) chunks.push(palette[i]);
  // Image descriptor
  chunks.push(
    0x2c, 0x00, 0x00, 0x00, 0x00,
    width & 0xff, (width >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
    0x00,
    8 // LZW minimum code size
  );
  for (let offset = 0; offset < lzwBytes.length; offset += 255) {
    const slice = lzwBytes.slice(offset, offset + 255);
    chunks.push(slice.length, ...slice);
  }
  chunks.push(0x00, 0x3b); // Block terminator + Trailer
  return new Blob([new Uint8Array(chunks)], { type: 'image/gif' });
}

export async function renderPdfPageToBlob(
  pdf: PdfJsDocumentProxy,
  pageNumber: number,
  options: {
    scale?: number;
    format?: 'jpeg' | 'png' | 'webp' | 'gif' | 'tiff';
    quality?: number;
    extraRotation?: number;
  } = {}
): Promise<{ blob: Blob; width: number; height: number }> {
  const {
    scale = 1.5,
    format = 'jpeg',
    quality = 0.9,
    extraRotation = 0,
  } = options;
  const canvas = document.createElement('canvas');
  try {
    const dims = await renderPdfPageToCanvas(pdf, pageNumber, canvas, scale, extraRotation);
    if (format === 'tiff' || format === 'gif') {
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not initialize 2D canvas context.');
      const idata = ctx.getImageData(0, 0, dims.width, dims.height);
      const blob =
        format === 'tiff'
          ? encodeRgbaToBaselineTiff(idata.data, dims.width, dims.height)
          : encodeRgbaToGif89a(idata.data, dims.width, dims.height);
      return { blob, ...dims };
    }
    const mime =
      format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
    const blob = await canvasToBlobSafe(canvas, mime, quality);
    return { blob, ...dims };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function getPdfThumbnails(
  file: File,
  options: {
    scale?: number;
    maxPages?: number;
    signal?: AbortSignal;
    onPage?: (pageNumber: number, dataUrl: string) => void;
  } = {}
): Promise<Array<{ pageNumber: number; dataUrl: string; width: number; height: number }>> {
  const { scale = 0.45, maxPages, signal, onPage } = options;
  const pdf = await loadPdfJsDocument(file);
  const results: Array<{ pageNumber: number; dataUrl: string; width: number; height: number }> = [];
  const limit = maxPages ? Math.min(pdf.numPages, maxPages) : pdf.numPages;

  try {
    for (let i = 1; i <= limit; i += 1) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const canvas = document.createElement('canvas');
      try {
        const { width, height } = await renderPdfPageToCanvas(pdf, i, canvas, scale);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        results.push({ pageNumber: i, dataUrl, width, height });
        onPage?.(i, dataUrl);
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
    return results;
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function rgbToHex(r: number, g: number, b: number): string {
  const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    '#' +
    [clampByte(r), clampByte(g), clampByte(b)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
  );
}

function parseHexColor(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0');
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return [Number.isFinite(r) ? r : 0, Number.isFinite(g) ? g : 0, Number.isFinite(b) ? b : 0];
}

function colorDistSq(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function resolveFontNameFromPage(
  page: import('pdfjs-dist/types/src/display/api').PDFPageProxy,
  fontKey: string
): string {
  if (!fontKey) return '';
  try {
    if (page.commonObjs?.has(fontKey)) {
      const obj = page.commonObjs.get(fontKey) as { name?: string } | null;
      if (obj && typeof obj.name === 'string' && obj.name) return obj.name;
    }
  } catch {
    // Ignore unresolved commonObjs lookup
  }
  try {
    if (page.objs?.has(fontKey)) {
      const obj = page.objs.get(fontKey) as { name?: string } | null;
      if (obj && typeof obj.name === 'string' && obj.name) return obj.name;
    }
  } catch {
    // Ignore unresolved objs lookup
  }
  return fontKey;
}

function parseOpFillColor(
  fn: number,
  args: unknown[] | undefined,
  OPS: PdfJsModule['OPS']
): string | null {
  if (!args || args.length === 0) return null;
  if (fn === OPS.setFillRGBColor) {
    if (typeof args[0] === 'string' && args[0].startsWith('#')) {
      return args[0].slice(0, 7).toLowerCase();
    }
    if (args.length >= 3 && typeof args[0] === 'number') {
      const r = args[0] <= 1 && args[1] as number <= 1 && args[2] as number <= 1 ? args[0] * 255 : args[0];
      const g = args[0] <= 1 && args[1] as number <= 1 && args[2] as number <= 1 ? (args[1] as number) * 255 : (args[1] as number);
      const b = args[0] <= 1 && args[1] as number <= 1 && args[2] as number <= 1 ? (args[2] as number) * 255 : (args[2] as number);
      return rgbToHex(r, g, b);
    }
    const arr = args[0];
    if (Array.isArray(arr) || arr instanceof Uint8ClampedArray) {
      if (arr.length >= 3) {
        return rgbToHex(Number(arr[0]), Number(arr[1]), Number(arr[2]));
      }
    }
  } else if (fn === OPS.setFillGray && typeof args[0] === 'number') {
    const g = args[0] <= 1 ? args[0] * 255 : args[0];
    return rgbToHex(g, g, g);
  } else if (fn === OPS.setFillCMYKColor && args.length >= 4) {
    const c = Number(args[0]) || 0;
    const m = Number(args[1]) || 0;
    const y = Number(args[2]) || 0;
    const k = Number(args[3]) || 0;
    const r = 255 * (1 - c) * (1 - k);
    const g = 255 * (1 - m) * (1 - k);
    const b = 255 * (1 - y) * (1 - k);
    return rgbToHex(r, g, b);
  }
  return null;
}

function medianChannel(values: number[]): number {
  if (values.length === 0) return 255;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function medianRgb(samples: Array<[number, number, number]>): [number, number, number] {
  if (samples.length === 0) return [255, 255, 255];
  return [
    medianChannel(samples.map((s) => s[0])),
    medianChannel(samples.map((s) => s[1])),
    medianChannel(samples.map((s) => s[2])),
  ];
}

function sampleSpanColorsFromCanvas(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  scale: number,
  xVp: number,
  yTopVp: number,
  wVp: number,
  hVp: number
): { bgColor: string; fgColor: string | null; bgSliceDataUrl?: string } {
  const px = Math.max(0, Math.floor(xVp * scale));
  const py = Math.max(0, Math.floor(yTopVp * scale));
  const pw = Math.max(2, Math.min(canvasW - px, Math.ceil(wVp * scale)));
  const ph = Math.max(2, Math.min(canvasH - py, Math.ceil(hVp * scale)));

  // Sample strictly 2px OUTSIDE the glyph bounding box so anti-aliasing never biases background
  const pad = 3;
  const sx = Math.max(0, px - pad);
  const sy = Math.max(0, py - pad);
  const sw = Math.min(canvasW - sx, pw + pad * 2);
  const sh = Math.min(canvasH - sy, ph + pad * 2);

  if (sw <= 0 || sh <= 0) {
    return { bgColor: '#ffffff', fgColor: null };
  }

  const data = ctx.getImageData(sx, sy, sw, sh).data;
  const topSamples: Array<[number, number, number]> = [];
  const bottomSamples: Array<[number, number, number]> = [];
  const ringSamples: Array<[number, number, number]> = [];

  const innerX0 = px - sx;
  const innerY0 = py - sy;
  const innerX1 = innerX0 + pw;
  const innerY1 = innerY0 + ph;

  for (let iy = 0; iy < sh; iy += 1) {
    for (let ix = 0; ix < sw; ix += 1) {
      const inInnerX = ix >= innerX0 && ix < innerX1;
      const inInnerY = iy >= innerY0 && iy < innerY1;
      if (inInnerX && inInnerY) continue;
      const idx = (iy * sw + ix) * 4;
      const sample: [number, number, number] = [data[idx], data[idx + 1], data[idx + 2]];
      ringSamples.push(sample);
      if (iy < innerY0) topSamples.push(sample);
      else if (iy >= innerY1) bottomSamples.push(sample);
    }
  }

  // Fallback to extreme perimeter if span touches page edges
  if (ringSamples.length === 0) {
    const idx = 0;
    ringSamples.push([data[idx], data[idx + 1], data[idx + 2]]);
  }

  // Exact per-channel median across outer 2px ring handles warm off-white, dark cards, and colored pills
  const bgRgb = medianRgb(ringSamples);

  // Detect vertical gradient or textured card background along top vs bottom ring
  let bgSliceDataUrl: string | undefined;
  if (topSamples.length >= 3 && bottomSamples.length >= 3) {
    const topMed = medianRgb(topSamples);
    const botMed = medianRgb(bottomSamples);
    if (colorDistSq(topMed, botMed) > 144 && typeof document !== 'undefined') {
      const colX = sx > 0 ? sx : Math.min(canvasW - 1, sx + sw - 1);
      const sliceData = ctx.getImageData(colX, Math.max(0, py), 1, ph);
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = 1;
      sliceCanvas.height = ph;
      const sCtx = sliceCanvas.getContext('2d');
      if (sCtx) {
        sCtx.putImageData(sliceData, 0, 0);
        bgSliceDataUrl = sliceCanvas.toDataURL('image/png');
      }
      sliceCanvas.width = 0;
      sliceCanvas.height = 0;
    }
  }

  // Sample core interior ink pixels contrasting most strongly against bgRgb
  let bestDist = 0;
  let fgRgb: [number, number, number] | null = null;
  const clampedX0 = Math.max(0, innerX0);
  const clampedY0 = Math.max(0, innerY0);
  const clampedX1 = Math.min(sw, innerX1);
  const clampedY1 = Math.min(sh, innerY1);

  const highContrastPixels: Array<{ rgb: [number, number, number]; dist: number }> = [];
  for (let iy = clampedY0; iy < clampedY1; iy += 1) {
    for (let ix = clampedX0; ix < clampedX1; ix += 1) {
      const idx = (iy * sw + ix) * 4;
      const sample: [number, number, number] = [data[idx], data[idx + 1], data[idx + 2]];
      const d = colorDistSq(sample, bgRgb);
      if (d > 1600) {
        highContrastPixels.push({ rgb: sample, dist: d });
        if (d > bestDist) bestDist = d;
      }
    }
  }

  if (highContrastPixels.length > 0) {
    const threshold = bestDist * 0.78;
    const coreSamples: Array<[number, number, number]> = [];
    for (const p of highContrastPixels) {
      if (p.dist >= threshold) coreSamples.push(p.rgb);
    }
    if (coreSamples.length > 0) {
      fgRgb = medianRgb(coreSamples);
    }
  }

  return {
    bgColor: rgbToHex(bgRgb[0], bgRgb[1], bgRgb[2]),
    fgColor: fgRgb ? rgbToHex(fgRgb[0], fgRgb[1], fgRgb[2]) : null,
    bgSliceDataUrl,
  };
}

interface RawPositionedSpan {
  text: string;
  xVp: number;
  yTopVp: number;
  baselineYPts: number;
  widthVp: number;
  heightVp: number;
  fontSize: number;
  fontName: string;
  mappedFamily: PdfStandardFontChoice;
  modernSlug: ModernFontSlug;
  fontWeight: 400 | 600 | 700;
  ascentRatio: number;
  bold: boolean;
  italic: boolean;
  color: string;
  bgColor: string;
  bgSliceDataUrl?: string;
  blockId?: string;
  blockWidth?: number;
}

export async function getPageTextSpans(
  pdf: PdfJsDocumentProxy,
  pageNumber: number
): Promise<PdfTextSpan[]> {
  const pdfjs = await getPdfJs();
  const page = await pdf.getPage(pageNumber);
  const sampleCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

  try {
    const vp = page.getViewport({ scale: 1 });
    // Calling getOperatorList() populates page.commonObjs with real PostScript font names and tracks fill colors
    const opList = await page.getOperatorList();
    const content = await page.getTextContent();
    const styles = (content.styles || {}) as Record<
      string,
      { fontFamily?: string; ascent?: number; descent?: number }
    >;

    // Track graphics-state text fill colors across operator list
    const textColorEvents: Array<{ x: number; y: number; color: string }> = [];
    {
      const OPS = pdfjs.OPS;
      interface GState {
        fillColor: string;
        ctm: number[];
        textMatrix: number[];
        textLineMatrix: number[];
        leading: number;
      }
      const stack: GState[] = [];
      let state: GState = {
        fillColor: '#0b0b0d',
        ctm: [1, 0, 0, 1, 0, 0],
        textMatrix: [1, 0, 0, 1, 0, 0],
        textLineMatrix: [1, 0, 0, 1, 0, 0],
        leading: 0,
      };

      for (let i = 0; i < opList.fnArray.length; i += 1) {
        const fn = opList.fnArray[i];
        const args = opList.argsArray[i] as unknown[] | undefined;

        if (fn === OPS.save) {
          stack.push({
            fillColor: state.fillColor,
            ctm: state.ctm.slice(),
            textMatrix: state.textMatrix.slice(),
            textLineMatrix: state.textLineMatrix.slice(),
            leading: state.leading,
          });
        } else if (fn === OPS.restore) {
          const prev = stack.pop();
          if (prev) state = prev;
        } else if (fn === OPS.transform && args && args.length >= 6) {
          state.ctm = pdfjs.Util.transform(state.ctm, args.slice(0, 6) as number[]);
        } else if (
          fn === OPS.setFillRGBColor ||
          fn === OPS.setFillGray ||
          fn === OPS.setFillCMYKColor
        ) {
          const parsed = parseOpFillColor(fn, args, OPS);
          if (parsed) state.fillColor = parsed;
        } else if (fn === OPS.beginText) {
          state.textMatrix = [1, 0, 0, 1, 0, 0];
          state.textLineMatrix = [1, 0, 0, 1, 0, 0];
        } else if (fn === OPS.setLeading && args && typeof args[0] === 'number') {
          state.leading = args[0];
        } else if (fn === OPS.moveText && args && args.length >= 2) {
          state.textLineMatrix = pdfjs.Util.transform(state.textLineMatrix, [
            1,
            0,
            0,
            1,
            Number(args[0]) || 0,
            Number(args[1]) || 0,
          ]);
          state.textMatrix = state.textLineMatrix.slice();
        } else if (fn === OPS.setLeadingMoveText && args && args.length >= 2) {
          state.leading = -(Number(args[1]) || 0);
          state.textLineMatrix = pdfjs.Util.transform(state.textLineMatrix, [
            1,
            0,
            0,
            1,
            Number(args[0]) || 0,
            Number(args[1]) || 0,
          ]);
          state.textMatrix = state.textLineMatrix.slice();
        } else if (fn === OPS.setTextMatrix && args && args.length >= 6) {
          state.textMatrix = (args.slice(0, 6) as number[]).slice();
          state.textLineMatrix = state.textMatrix.slice();
        } else if (fn === OPS.nextLine) {
          state.textLineMatrix = pdfjs.Util.transform(state.textLineMatrix, [
            1,
            0,
            0,
            1,
            0,
            -state.leading,
          ]);
          state.textMatrix = state.textLineMatrix.slice();
        } else if (
          fn === OPS.showText ||
          fn === OPS.showSpacedText ||
          fn === OPS.nextLineShowText ||
          fn === OPS.nextLineSetSpacingShowText
        ) {
          if (fn === OPS.nextLineShowText || fn === OPS.nextLineSetSpacingShowText) {
            state.textLineMatrix = pdfjs.Util.transform(state.textLineMatrix, [
              1,
              0,
              0,
              1,
              0,
              -state.leading,
            ]);
            state.textMatrix = state.textLineMatrix.slice();
          }
          const full = pdfjs.Util.transform(
            vp.transform,
            pdfjs.Util.transform(state.ctm, state.textMatrix)
          );
          textColorEvents.push({ x: full[4], y: full[5], color: state.fillColor });
        }
      }
    }

    // Render page once onto a low-res offscreen canvas for foreground/background pixel sampling
    let sampleCtx: CanvasRenderingContext2D | null = null;
    let sampleScale = 1.5;
    if (sampleCanvas) {
      const maxDim = Math.max(vp.width, vp.height, 1);
      if (maxDim * sampleScale > 1800) {
        sampleScale = 1800 / maxDim;
      }
      const sampleVp = page.getViewport({ scale: sampleScale });
      sampleCanvas.width = Math.max(1, Math.floor(sampleVp.width));
      sampleCanvas.height = Math.max(1, Math.floor(sampleVp.height));
      const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true, alpha: false });
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, sampleCanvas.width, sampleCanvas.height);
        await page.render({ canvasContext: ctx, viewport: sampleVp }).promise;
        sampleCtx = ctx;
      }
    }

    const rawSpans: RawPositionedSpan[] = [];
    for (const rawItem of content.items) {
      if (!('str' in rawItem) || !rawItem.str.trim()) continue;
      const item = rawItem;

      // Multiply viewport transform with item.transform so /Rotate pages map accurately
      const tx = pdfjs.Util.transform(vp.transform, item.transform);
      const matrixW = Math.hypot(tx[0], tx[1]);
      const matrixH = Math.hypot(tx[2], tx[3]);
      const rawItemH = typeof item.height === 'number' && item.height > 0 ? item.height : 0;
      let fontSize = matrixH || matrixW || rawItemH || 12;
      if (rawItemH > 0 && fontSize > rawItemH * 1.45) {
        fontSize = rawItemH;
      }
      fontSize = Math.max(5.5, Math.min(120, Math.round(fontSize * 100) / 100));

      const styleInfo = styles[item.fontName] || {};
      const ascentRatio = Math.max(
        0.72,
        Math.min(1.02, typeof styleInfo.ascent === 'number' && styleInfo.ascent > 0 ? styleInfo.ascent : 0.88)
      );

      const xVp = tx[4];
      const baselineYPts = tx[5];
      const yTopVp = baselineYPts - fontSize * ascentRatio;
      const wVp = Math.max(3, Math.abs(item.width || 0) || item.str.length * fontSize * 0.48);
      const hVp = fontSize * 1.15;

      const resolvedRawName = resolveFontNameFromPage(page, item.fontName);
      const classified = classifyPdfFont(resolvedRawName, styleInfo.fontFamily);
      const { mappedFamily, bold, italic, cleanName, modernSlug, fontWeight } = classified;

      // Find nearest opList color event
      let opColor: string | null = null;
      let bestDist = Infinity;
      for (const ev of textColorEvents) {
        const d = Math.hypot(ev.x - xVp, ev.y - baselineYPts);
        if (d < bestDist) {
          bestDist = d;
          opColor = ev.color;
        }
      }
      if (bestDist > fontSize * 6) {
        opColor = null;
      }

      let bgColor = '#ffffff';
      let bgSliceDataUrl: string | undefined;
      let fgColor = opColor || '#0b0b0d';
      if (sampleCtx && sampleCanvas) {
        const sampled = sampleSpanColorsFromCanvas(
          sampleCtx,
          sampleCanvas.width,
          sampleCanvas.height,
          sampleScale,
          xVp,
          yTopVp,
          wVp,
          hVp
        );
        bgColor = sampled.bgColor;
        bgSliceDataUrl = sampled.bgSliceDataUrl;
        // Prefer sampled ink color if opList color is missing, generic dark/light, or low-contrast
        const bgRgb = parseHexColor(bgColor);
        const opRgb = opColor ? parseHexColor(opColor) : null;
        const opIsAmbiguous =
          !opColor ||
          opColor === '#000000' ||
          opColor === '#0b0b0d' ||
          opColor === '#ffffff' ||
          (opRgb !== null && colorDistSq(opRgb, bgRgb) < 900);
        if (opIsAmbiguous && sampled.fgColor) {
          fgColor = sampled.fgColor;
        }
      }

      rawSpans.push({
        text: item.str,
        xVp,
        yTopVp,
        baselineYPts,
        widthVp: wVp,
        heightVp: hVp,
        fontSize,
        fontName: cleanName,
        mappedFamily,
        modernSlug,
        fontWeight,
        ascentRatio,
        bold,
        italic,
        color: fgColor,
        bgColor,
        bgSliceDataUrl,
      });
    }

    // Group adjacent runs on the same baseline into logical editable line spans
    rawSpans.sort((a, b) => {
      const tol = Math.min(a.fontSize, b.fontSize) * 0.25;
      if (Math.abs(a.baselineYPts - b.baselineYPts) <= tol) {
        return a.xVp - b.xVp;
      }
      return a.baselineYPts - b.baselineYPts;
    });

    const grouped: RawPositionedSpan[] = [];
    for (const run of rawSpans) {
      const prev = grouped[grouped.length - 1];
      if (prev) {
        const minFs = Math.min(prev.fontSize, run.fontSize);
        const maxFs = Math.max(prev.fontSize, run.fontSize);
        const dy = Math.abs(run.baselineYPts - prev.baselineYPts);
        const prevRight = prev.xVp + prev.widthVp;
        const gap = run.xVp - prevRight;
        const sameStyle =
          prev.modernSlug === run.modernSlug &&
          prev.bold === run.bold &&
          prev.italic === run.italic &&
          Math.abs(prev.fontSize - run.fontSize) <= maxFs * 0.14 &&
          colorDistSq(parseHexColor(prev.color), parseHexColor(run.color)) <= 900;

        if (sameStyle && dy <= minFs * 0.25 && gap >= -minFs * 0.4 && gap <= maxFs * 1.1) {
          const needsSpace =
            gap > minFs * 0.16 && !prev.text.endsWith(' ') && !run.text.startsWith(' ');
          prev.text = needsSpace ? `${prev.text} ${run.text}` : `${prev.text}${run.text}`;
          const newRight = Math.max(prevRight, run.xVp + run.widthVp);
          prev.widthVp = newRight - prev.xVp;
          prev.yTopVp = Math.min(prev.yTopVp, run.yTopVp);
          prev.heightVp = Math.max(prev.heightVp, run.heightVp);
          if (!prev.bgSliceDataUrl && run.bgSliceDataUrl) {
            prev.bgSliceDataUrl = run.bgSliceDataUrl;
          }
          continue;
        }
      }
      grouped.push({ ...run });
    }

    // Spatial paragraph grouping to infer column boundaries (blockWidth)
    let blockCounter = 0;
    for (let i = 0; i < grouped.length; i += 1) {
      const cur = grouped[i];
      if (!cur.blockId) {
        blockCounter += 1;
        cur.blockId = `b${blockCounter}`;
        let maxRight = cur.xVp + cur.widthVp;
        let minLeft = cur.xVp;
        const members = [cur];

        for (let j = i + 1; j < grouped.length; j += 1) {
          const cand = grouped[j];
          const last = members[members.length - 1];
          const verticalLead = cand.baselineYPts - last.baselineYPts;
          if (verticalLead < cur.fontSize * 0.8) continue;
          if (verticalLead > cur.fontSize * 1.95) break;
          const sameBlockStyle =
            cand.modernSlug === cur.modernSlug &&
            cand.bold === cur.bold &&
            Math.abs(cand.fontSize - cur.fontSize) <= cur.fontSize * 0.15 &&
            Math.abs(cand.xVp - minLeft) <= cur.fontSize * 2.2;
          if (sameBlockStyle) {
            cand.blockId = cur.blockId;
            members.push(cand);
            minLeft = Math.min(minLeft, cand.xVp);
            maxRight = Math.max(maxRight, cand.xVp + cand.widthVp);
          }
        }
        const blockW = maxRight - minLeft;
        for (const m of members) m.blockWidth = blockW;
      }
    }

    return grouped.map((sp, idx) => ({
      id: `p${pageNumber}-t${idx}`,
      pageNumber,
      text: sp.text,
      x: clamp01(sp.xVp / vp.width),
      y: clamp01(sp.yTopVp / vp.height),
      width: clamp01(sp.widthVp / vp.width),
      height: clamp01(sp.heightVp / vp.height),
      fontSize: sp.fontSize,
      fontName: sp.fontName,
      mappedFamily: sp.mappedFamily,
      modernSlug: sp.modernSlug,
      fontWeight: sp.fontWeight,
      ascentRatio: sp.ascentRatio,
      bold: sp.bold,
      italic: sp.italic,
      color: sp.color,
      bgColor: sp.bgColor,
      bgSliceDataUrl: sp.bgSliceDataUrl,
      baselineY: clamp01(sp.baselineYPts / vp.height),
      blockId: sp.blockId,
      blockWidth: sp.blockWidth ? clamp01(sp.blockWidth / vp.width) : undefined,
    }));
  } finally {
    if (sampleCanvas) {
      sampleCanvas.width = 0;
      sampleCanvas.height = 0;
    }
    page.cleanup();
  }
}

export async function getPageLinkAnnotations(
  fileOrDoc: File | unknown,
  pageNumber: number
): Promise<PdfExistingLink[]> {
  const ownsDoc = fileOrDoc instanceof File;
  const pdf = ownsDoc
    ? await loadPdfJsDocument(fileOrDoc)
    : (fileOrDoc as PdfJsDocumentProxy);

  try {
    const page = await pdf.getPage(pageNumber);
    try {
      const vp = page.getViewport({ scale: 1 });
      const annots = await page.getAnnotations();
      const links: PdfExistingLink[] = [];
      let idx = 0;

      for (const annot of annots) {
        if (!annot || annot.subtype !== 'Link' || !Array.isArray(annot.rect) || annot.rect.length < 4) {
          continue;
        }
        const rectNum: [number, number, number, number] = [
          Number(annot.rect[0]) || 0,
          Number(annot.rect[1]) || 0,
          Number(annot.rect[2]) || 0,
          Number(annot.rect[3]) || 0,
        ];
        const vpRect = vp.convertToViewportRectangle(rectNum);
        const minX = Math.min(vpRect[0], vpRect[2]);
        const maxX = Math.max(vpRect[0], vpRect[2]);
        const minY = Math.min(vpRect[1], vpRect[3]);
        const maxY = Math.max(vpRect[1], vpRect[3]);

        const url =
          typeof annot.url === 'string' && annot.url
            ? annot.url
            : typeof annot.unsafeUrl === 'string'
            ? annot.unsafeUrl
            : '';
        const dest =
          typeof annot.dest === 'string'
            ? annot.dest
            : Array.isArray(annot.dest)
            ? JSON.stringify(annot.dest)
            : undefined;

        links.push({
          id: `p${pageNumber}-link-${idx++}`,
          pageNumber,
          x: clamp01(minX / vp.width),
          y: clamp01(minY / vp.height),
          width: clamp01((maxX - minX) / vp.width),
          height: clamp01((maxY - minY) / vp.height),
          originalRect: rectNum,
          url,
          ...(dest ? { dest } : {}),
        });
      }

      return links;
    } finally {
      page.cleanup();
    }
  } finally {
    if (ownsDoc) {
      await pdf.destroy().catch(() => {});
    }
  }
}

export async function extractAllSelectableText(
  file: File,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<{ pages: Array<{ pageNumber: number; text: string }>; fullText: string }> {
  const pdf = await loadPdfJsDocument(file);
  try {
    const pages: Array<{ pageNumber: number; text: string }> = [];
    for (let i = 1; i <= pdf.numPages; i += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      let buf = '';
      for (const item of tc.items) {
        if ('str' in item) {
          buf += item.str;
          buf += item.hasEOL ? '\n' : ' ';
        }
      }
      const clean = buf.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      pages.push({ pageNumber: i, text: clean });
      page.cleanup();
      onProgress?.(Math.round((i / pdf.numPages) * 100));
    }
    const fullText = pages
      .map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`)
      .join('\n\n');
    return { pages, fullText };
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

function fnv1aHash(bytes: Uint8Array): string {
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Innovation: Extracts native /DCTDecode JPEG streams losslessly without PNG bloat first,
 * then captures decoded /FlateDecode or masked images via PDF.js canvas export, deduplicated by FNV-1a.
 */
export async function extractEmbeddedImagesFromPdf(
  file: File,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<PdfExtractedImage[]> {
  await assertValidPdfFile(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const seenHashes = new Set<string>();
  const images: PdfExtractedImage[] = [];

  // Pass 1: Extract raw /DCTDecode JPEG streams directly via pdf-lib (lossless pass-through!)
  try {
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const rawObjects = pdfDoc.context.enumerateIndirectObjects();
    let imgCounter = 0;

    for (const [, obj] of rawObjects) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!(obj instanceof PDFRawStream)) continue;
      const dict = obj.dict;
      const subtype = dict.lookup(PDFName.of('Subtype'));
      if (subtype !== PDFName.of('Image')) continue;

      const filter = dict.lookup(PDFName.of('Filter'));
      const filterStr = filter?.toString() || '';
      if (!filterStr.includes('DCTDecode')) continue;
      if (dict.has(PDFName.of('SMask')) || dict.has(PDFName.of('Mask'))) continue;

      const contents = obj.getContents();
      if (contents.length < 256) continue;
      const widthObj = dict.lookup(PDFName.of('Width'));
      const heightObj = dict.lookup(PDFName.of('Height'));
      const width = Number(widthObj?.toString() || 0);
      const height = Number(heightObj?.toString() || 0);
      if (width < 16 || height < 16) continue;

      const sig = `${width}x${height}-${fnv1aHash(contents)}`;
      if (seenHashes.has(sig)) continue;
      seenHashes.add(sig);

      const copyBytes = new Uint8Array(contents.length);
      copyBytes.set(contents);
      const blob = new Blob([copyBytes], { type: 'image/jpeg' });
      imgCounter += 1;
      images.push({
        id: `raw-jpg-${imgCounter}`,
        pageNumber: 0,
        width,
        height,
        format: 'jpeg',
        blob,
        url: URL.createObjectURL(blob),
        fileName: `extracted-image-${String(imgCounter).padStart(3, '0')}.jpg`,
      });
    }
  } catch {
    // Continue to PDF.js operator pass
  }

  onProgress?.(40);

  // Pass 2: PDF.js operator list for Flate/masked/inline images (and page numbering)
  const pdf = await loadPdfJsDocument(bytes);
  const pdfjs = await getPdfJs();
  try {
    let pngCounter = images.length;
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const page = await pdf.getPage(pageNo);
      try {
        const opList = await page.getOperatorList();
        for (let i = 0; i < opList.fnArray.length; i += 1) {
          const fn = opList.fnArray[i];
          if (
            fn !== pdfjs.OPS.paintImageXObject &&
            fn !== pdfjs.OPS.paintInlineImageXObject
          ) {
            continue;
          }
          const arg = opList.argsArray[i]?.[0];
          let imgData: {
            width: number;
            height: number;
            data?: Uint8ClampedArray;
            bitmap?: ImageBitmap;
          } | null = null;

          if (fn === pdfjs.OPS.paintInlineImageXObject && arg && typeof arg === 'object') {
            imgData = arg;
          } else if (typeof arg === 'string') {
            imgData = page.objs.has(arg)
              ? page.objs.get(arg)
              : page.commonObjs.has(arg)
              ? page.commonObjs.get(arg)
              : null;
          }

          if (!imgData || !imgData.width || !imgData.height) continue;
          if (imgData.width < 16 || imgData.height < 16) continue;

          const canvas = document.createElement('canvas');
          canvas.width = imgData.width;
          canvas.height = imgData.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          if (imgData.bitmap) {
            ctx.drawImage(imgData.bitmap, 0, 0);
          } else if (imgData.data) {
            const rgba =
              imgData.data.length === imgData.width * imgData.height * 4
                ? imgData.data
                : expandRgbToRgba(imgData.data, imgData.width, imgData.height);
            if (!rgba) {
              canvas.width = 0;
              canvas.height = 0;
              continue;
            }
            const idata = new ImageData(new Uint8ClampedArray(rgba), imgData.width, imgData.height);
            ctx.putImageData(idata, 0, 0);
          } else {
            canvas.width = 0;
            canvas.height = 0;
            continue;
          }

          const sample = ctx.getImageData(0, 0, Math.min(64, canvas.width), Math.min(64, canvas.height)).data;
          const hash = `${canvas.width}x${canvas.height}-${fnv1aHash(new Uint8Array(sample.buffer))}`;
          if (seenHashes.has(hash)) {
            canvas.width = 0;
            canvas.height = 0;
            continue;
          }
          seenHashes.add(hash);

          const blob = await canvasToBlobSafe(canvas, 'image/png', 1);
          canvas.width = 0;
          canvas.height = 0;
          pngCounter += 1;
          images.push({
            id: `img-${pngCounter}`,
            pageNumber: pageNo,
            width: imgData.width,
            height: imgData.height,
            format: 'png',
            blob,
            url: URL.createObjectURL(blob),
            fileName: `page-${pageNo}-image-${String(pngCounter).padStart(3, '0')}.png`,
          });
        }
      } finally {
        page.cleanup();
      }
      onProgress?.(40 + Math.round((pageNo / pdf.numPages) * 60));
    }
    return images;
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

function expandRgbToRgba(data: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray | null {
  const pixels = w * h;
  if (data.length === pixels * 3) {
    const out = new Uint8ClampedArray(pixels * 4);
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      out[j] = data[i];
      out[j + 1] = data[i + 1];
      out[j + 2] = data[i + 2];
      out[j + 3] = 255;
    }
    return out;
  }
  if (data.length === pixels) {
    const out = new Uint8ClampedArray(pixels * 4);
    for (let i = 0, j = 0; i < data.length; i += 1, j += 4) {
      out[j] = data[i];
      out[j + 1] = data[i];
      out[j + 2] = data[i];
      out[j + 3] = 255;
    }
    return out;
  }
  return null;
}

function dilateBinaryMask(mask: Uint8Array, w: number, h: number, radius = 2): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h - 1, y + radius);
    for (let x = 0; x < w; x += 1) {
      if (mask[y * w + x]) {
        out[y * w + x] = 1;
        continue;
      }
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w - 1, x + radius);
      let hit = 0;
      for (let ny = y0; ny <= y1 && !hit; ny += 1) {
        const row = ny * w;
        for (let nx = x0; nx <= x1; nx += 1) {
          if (mask[row + nx]) {
            hit = 1;
            break;
          }
        }
      }
      out[y * w + x] = hit;
    }
  }
  return out;
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function mergeNearbyBoxes(boxes: BBox[], gapX: number, gapY: number): BBox[] {
  const list = boxes.map((b) => ({ ...b }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        const overlapX = a.minX - gapX <= b.maxX && b.minX - gapX <= a.maxX;
        const overlapY = a.minY - gapY <= b.maxY && b.minY - gapY <= a.maxY;
        if (overlapX && overlapY) {
          a.minX = Math.min(a.minX, b.minX);
          a.minY = Math.min(a.minY, b.minY);
          a.maxX = Math.max(a.maxX, b.maxX);
          a.maxY = Math.max(a.maxY, b.maxY);
          list.splice(j, 1);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  return list;
}

/**
 * Splits multi-photo scanned PDF pages into individual cropped PNG image blobs
 * using adaptive paper-background thresholding, morphological bridging, and 2-pass CCL.
 */
export async function splitScannedPagePhotos(
  file: File,
  options: {
    minAreaRatio?: number;
    threshold?: number;
    paddingPx?: number;
    signal?: AbortSignal;
    onProgress?: (pct: number) => void;
  } = {}
): Promise<PdfExtractedImage[]> {
  const {
    minAreaRatio = 0.025,
    threshold,
    paddingPx = 6,
    signal,
    onProgress,
  } = options;

  const pdf = await loadPdfJsDocument(file);
  const results: PdfExtractedImage[] = [];

  try {
    let cropCounter = 0;

    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const page = await pdf.getPage(pageNo);
      const baseVp = page.getViewport({ scale: 1 });
      const maxBaseDim = Math.max(baseVp.width, baseVp.height, 1);
      const renderScale = Math.min(2, Math.max(1.25, 2000 / maxBaseDim));

      const fullCanvas = document.createElement('canvas');
      const analysisCanvas = document.createElement('canvas');

      try {
        const { width: fullW, height: fullH } = await renderPdfPageToCanvas(
          pdf,
          pageNo,
          fullCanvas,
          renderScale
        );

        const maxAnalysisDim = 480;
        const downScale = Math.min(1, maxAnalysisDim / Math.max(fullW, fullH, 1));
        const aw = Math.max(16, Math.round(fullW * downScale));
        const ah = Math.max(16, Math.round(fullH * downScale));
        analysisCanvas.width = aw;
        analysisCanvas.height = ah;
        const aCtx = analysisCanvas.getContext('2d', { willReadFrequently: true, alpha: false });
        if (!aCtx) continue;
        aCtx.drawImage(fullCanvas, 0, 0, aw, ah);
        const pixels = aCtx.getImageData(0, 0, aw, ah).data;

        // Estimate paper luminance from 85th percentile of grayscale histogram
        const lumHist = new Int32Array(256);
        const lumGrid = new Uint8Array(aw * ah);
        const chromaGrid = new Uint8Array(aw * ah);
        for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];
          const l = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
          lumGrid[p] = l;
          chromaGrid[p] = Math.max(r, g, b) - Math.min(r, g, b);
          lumHist[l] += 1;
        }

        let targetCount = Math.floor(aw * ah * 0.85);
        let paperLum = 245;
        let acc = 0;
        for (let l = 0; l < 256; l += 1) {
          acc += lumHist[l];
          if (acc >= targetCount) {
            paperLum = l;
            break;
          }
        }

        const lumCutoff = typeof threshold === 'number' ? threshold : Math.max(40, paperLum - 26);
        const rawMask = new Uint8Array(aw * ah);
        for (let p = 0; p < rawMask.length; p += 1) {
          if (lumGrid[p] < lumCutoff || chromaGrid[p] > 24) {
            rawMask[p] = 1;
          }
        }

        // Bridge interior highlights inside photos with two light dilations
        const bridged = dilateBinaryMask(dilateBinaryMask(rawMask, aw, ah, 2), aw, ah, 2);

        // 2-pass Connected Component Labeling with Union-Find
        const labels = new Int32Array(aw * ah);
        const parent: number[] = [0];
        const findRoot = (x: number): number => {
          while (parent[x] !== x) {
            parent[x] = parent[parent[x]];
            x = parent[x];
          }
          return x;
        };
        const unionLabels = (a: number, b: number) => {
          const ra = findRoot(a);
          const rb = findRoot(b);
          if (ra !== rb) {
            if (ra < rb) parent[rb] = ra;
            else parent[ra] = rb;
          }
        };

        let nextLabel = 1;
        for (let y = 0; y < ah; y += 1) {
          const row = y * aw;
          for (let x = 0; x < aw; x += 1) {
            const idx = row + x;
            if (!bridged[idx]) continue;
            const left = x > 0 ? labels[idx - 1] : 0;
            const up = y > 0 ? labels[idx - aw] : 0;
            if (left === 0 && up === 0) {
              labels[idx] = nextLabel;
              parent.push(nextLabel);
              nextLabel += 1;
            } else if (left !== 0 && up === 0) {
              labels[idx] = left;
            } else if (left === 0 && up !== 0) {
              labels[idx] = up;
            } else {
              labels[idx] = Math.min(left, up);
              if (left !== up) unionLabels(left, up);
            }
          }
        }

        const boxesByRoot = new Map<number, BBox & { count: number }>();
        for (let y = 0; y < ah; y += 1) {
          const row = y * aw;
          for (let x = 0; x < aw; x += 1) {
            const lbl = labels[row + x];
            if (lbl === 0) continue;
            const root = findRoot(lbl);
            const cur = boxesByRoot.get(root);
            if (!cur) {
              boxesByRoot.set(root, { minX: x, minY: y, maxX: x, maxY: y, count: 1 });
            } else {
              if (x < cur.minX) cur.minX = x;
              if (y < cur.minY) cur.minY = y;
              if (x > cur.maxX) cur.maxX = x;
              if (y > cur.maxY) cur.maxY = y;
              cur.count += 1;
            }
          }
        }

        const totalArea = aw * ah;
        const candidateBoxes: BBox[] = [];
        for (const box of boxesByRoot.values()) {
          const bw = box.maxX - box.minX + 1;
          const bh = box.maxY - box.minY + 1;
          const boxAreaRatio = (bw * bh) / totalArea;
          if (boxAreaRatio >= minAreaRatio && bw >= 12 && bh >= 12) {
            candidateBoxes.push({
              minX: box.minX,
              minY: box.minY,
              maxX: box.maxX,
              maxY: box.maxY,
            });
          }
        }

        const mergedBoxes = mergeNearbyBoxes(
          candidateBoxes,
          Math.max(4, Math.round(aw * 0.015)),
          Math.max(4, Math.round(ah * 0.015))
        );
        mergedBoxes.sort((a, b) => (Math.abs(a.minY - b.minY) < ah * 0.08 ? a.minX - b.minX : a.minY - b.minY));

        const scaleBackX = fullW / aw;
        const scaleBackY = fullH / ah;

        for (const box of mergedBoxes) {
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          const sx = Math.max(0, Math.floor(box.minX * scaleBackX) - paddingPx);
          const sy = Math.max(0, Math.floor(box.minY * scaleBackY) - paddingPx);
          const ex = Math.min(fullW, Math.ceil((box.maxX + 1) * scaleBackX) + paddingPx);
          const ey = Math.min(fullH, Math.ceil((box.maxY + 1) * scaleBackY) + paddingPx);
          const cw = ex - sx;
          const ch = ey - sy;
          if (cw < 24 || ch < 24) continue;

          // Estimate dominant edge orientation inside component mask for deskewing tilted photo scans
          const bx0 = box.minX;
          const by0 = box.minY;
          const bx1 = box.maxX;
          const by1 = box.maxY;
          let sumCos = 0;
          let sumSin = 0;
          let edgeCount = 0;
          for (let py = by0 + 1; py < by1 - 1; py += 2) {
            for (let px = bx0 + 1; px < bx1 - 1; px += 2) {
              const idx = py * aw + px;
              if (!bridged[idx]) continue;
              const isEdge =
                !bridged[idx - 1] || !bridged[idx + 1] || !bridged[idx - aw] || !bridged[idx + aw];
              if (!isEdge) continue;
              const gx = lumGrid[idx + 1] - lumGrid[idx - 1];
              const gy = lumGrid[idx + aw] - lumGrid[idx - aw];
              const mag = Math.hypot(gx, gy);
              if (mag > 18) {
                const ang = Math.atan2(gy, gx);
                sumCos += Math.cos(4 * ang);
                sumSin += Math.sin(4 * ang);
                edgeCount += 1;
              }
            }
          }
          let deskewRad = 0;
          if (edgeCount > 20) {
            const rawAngle = Math.atan2(sumSin, sumCos) / 4;
            if (Math.abs(rawAngle) > 0.018 && Math.abs(rawAngle) < 0.32) {
              deskewRad = -rawAngle;
            }
          }

          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = cw;
          cropCanvas.height = ch;
          try {
            const cCtx = cropCanvas.getContext('2d');
            if (!cCtx) continue;
            if (deskewRad !== 0) {
              cCtx.fillStyle = '#ffffff';
              cCtx.fillRect(0, 0, cw, ch);
              cCtx.save();
              cCtx.translate(cw / 2, ch / 2);
              cCtx.rotate(deskewRad);
              cCtx.drawImage(fullCanvas, sx, sy, cw, ch, -cw / 2, -ch / 2, cw, ch);
              cCtx.restore();
            } else {
              cCtx.drawImage(fullCanvas, sx, sy, cw, ch, 0, 0, cw, ch);
            }
            const blob = await canvasToBlobSafe(cropCanvas, 'image/png', 1);
            cropCounter += 1;
            results.push({
              id: `scan-p${pageNo}-crop-${cropCounter}`,
              pageNumber: pageNo,
              width: cw,
              height: ch,
              format: 'png',
              blob,
              url: URL.createObjectURL(blob),
              fileName: `page-${pageNo}-photo-${String(cropCounter).padStart(2, '0')}.png`,
            });
          } finally {
            cropCanvas.width = 0;
            cropCanvas.height = 0;
          }
        }
      } finally {
        fullCanvas.width = 0;
        fullCanvas.height = 0;
        analysisCanvas.width = 0;
        analysisCanvas.height = 0;
        page.cleanup();
      }

      onProgress?.(Math.round((pageNo / pdf.numPages) * 100));
    }

    return results;
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

function getStreamFilterNames(dict: PDFDict): string[] {
  const filterObj = dict.lookup(PDFName.of('Filter'));
  if (!filterObj) return [];
  if (filterObj instanceof PDFName) {
    return [filterObj.decodeText()];
  }
  if (filterObj instanceof PDFArray) {
    const names: string[] = [];
    for (let i = 0; i < filterObj.size(); i += 1) {
      const item = filterObj.lookup(i);
      if (item instanceof PDFName) names.push(item.decodeText());
    }
    return names;
  }
  return [filterObj.toString().replace(/^\//, '')];
}

function toCopyUint8Array(src: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(src.byteLength));
  copy.set(src);
  return copy;
}

function detectFontProgramFormat(
  bytes: Uint8Array,
  descriptorKey: string
): { ext: string; mimeType: string; label: string } {
  if (bytes.length >= 4) {
    // TrueType (\x00\x01\x00\x00 or 'true')
    if (
      (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) ||
      (bytes[0] === 0x74 && bytes[1] === 0x72 && bytes[2] === 0x75 && bytes[3] === 0x65)
    ) {
      return { ext: 'ttf', mimeType: 'font/ttf', label: 'TrueType (.ttf)' };
    }
    // OpenType ('OTTO')
    if (bytes[0] === 0x4f && bytes[1] === 0x54 && bytes[2] === 0x54 && bytes[3] === 0x4f) {
      return { ext: 'otf', mimeType: 'font/otf', label: 'OpenType (.otf)' };
    }
    // Type1 PostScript ('%!PS')
    if (bytes[0] === 0x25 && bytes[1] === 0x21 && bytes[2] === 0x50 && bytes[3] === 0x53) {
      return { ext: 'pfb', mimeType: 'application/x-font-type1', label: 'PostScript Type1 (.pfb)' };
    }
  }
  if (descriptorKey === 'FontFile2') {
    return { ext: 'ttf', mimeType: 'font/ttf', label: 'TrueType (.ttf)' };
  }
  if (descriptorKey === 'FontFile3') {
    return { ext: 'cff', mimeType: 'application/font-cff', label: 'CFF / OpenType (.cff)' };
  }
  return { ext: 'pfb', mimeType: 'application/x-font-type1', label: 'Type1 Font (.pfb)' };
}

/**
 * Extracts pure raw internal PDF object buffers (image streams, embedded font programs,
 * embedded file attachments, XMP metadata XML, and decoded page content instruction streams).
 */
export async function extractRawPdfBuffers(
  file: File,
  options: {
    signal?: AbortSignal;
    onProgress?: (pct: number) => void;
  } = {}
): Promise<PdfRawBufferEntry[]> {
  const { signal, onProgress } = options;
  await assertValidPdfFile(file);
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const pdfDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
  onProgress?.(10);

  // Map page content stream refs -> pageNumber
  const pageContentRefMap = new Map<string, number>();
  const pages = pdfDoc.getPages();
  for (let i = 0; i < pages.length; i += 1) {
    const contents = pages[i].node.get(PDFName.of('Contents'));
    if (contents instanceof PDFRef) {
      pageContentRefMap.set(contents.toString(), i + 1);
    } else if (contents instanceof PDFArray) {
      for (let j = 0; j < contents.size(); j += 1) {
        const item = contents.get(j);
        if (item instanceof PDFRef) {
          pageContentRefMap.set(item.toString(), i + 1);
        }
      }
    }
  }

  // Map FontFile/FontFile2/FontFile3 refs and EmbeddedFiles /EF refs
  const fontRefMap = new Map<string, { fontName: string; key: string }>();
  const embeddedFileNameMap = new Map<string, string>();

  const indirectObjects = pdfDoc.context.enumerateIndirectObjects();
  for (const [, obj] of indirectObjects) {
    if (!(obj instanceof PDFDict)) continue;
    const typeName = obj.lookup(PDFName.of('Type'));
    if (typeName === PDFName.of('FontDescriptor')) {
      const baseFontObj = obj.lookup(PDFName.of('FontName'));
      const rawFontName =
        baseFontObj instanceof PDFName
          ? baseFontObj.decodeText().replace(/^[A-Z]{6}\+/, '')
          : 'EmbeddedFont';
      for (const key of ['FontFile', 'FontFile2', 'FontFile3']) {
        const ref = obj.get(PDFName.of(key));
        if (ref instanceof PDFRef) {
          fontRefMap.set(ref.toString(), { fontName: rawFontName, key });
        }
      }
    }
    const efDict = obj.lookup(PDFName.of('EF'));
    if (efDict instanceof PDFDict) {
      const uf = obj.lookup(PDFName.of('UF'));
      const f = obj.lookup(PDFName.of('F'));
      const rawName =
        uf instanceof PDFString
          ? uf.decodeText()
          : f instanceof PDFString
          ? f.decodeText()
          : undefined;
      if (rawName) {
        for (const key of ['F', 'UF', 'DOS', 'Mac', 'Unix']) {
          const ref = efDict.get(PDFName.of(key));
          if (ref instanceof PDFRef) {
            embeddedFileNameMap.set(ref.toString(), rawName);
          }
        }
      }
    }
  }

  const entries: PdfRawBufferEntry[] = [];
  let imageIdx = 0;
  let fontIdx = 0;
  let fileIdx = 0;
  let xmpIdx = 0;
  let contentIdx = 0;
  const MAX_PAGE_CONTENT_STREAMS = 50;

  const total = Math.max(1, indirectObjects.length);
  for (let i = 0; i < indirectObjects.length; i += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const [ref, obj] = indirectObjects[i];
    if (!(obj instanceof PDFRawStream)) continue;

    const refKey = ref.toString();
    const dict = obj.dict;
    const subtype = dict.lookup(PDFName.of('Subtype'));
    const type = dict.lookup(PDFName.of('Type'));
    const filters = getStreamFilterNames(dict);

    // 1. Image XObjects
    if (subtype === PDFName.of('Image')) {
      imageIdx += 1;
      const w = Number(dict.lookup(PDFName.of('Width'))?.toString() || 0);
      const h = Number(dict.lookup(PDFName.of('Height'))?.toString() || 0);
      const isSingleDct = filters.length === 1 && filters[0] === 'DCTDecode';
      const isSingleJpx = filters.length === 1 && filters[0] === 'JPXDecode';

      let rawBytes: Uint8Array<ArrayBuffer>;
      let mimeType: string;
      let ext: string;
      let filterLabel: string;

      if (isSingleDct) {
        rawBytes = toCopyUint8Array(obj.getContents());
        mimeType = 'image/jpeg';
        ext = 'jpg';
        filterLabel = 'DCTDecode JPEG';
      } else if (isSingleJpx) {
        rawBytes = toCopyUint8Array(obj.getContents());
        mimeType = 'image/jp2';
        ext = 'jp2';
        filterLabel = 'JPXDecode JPEG2000';
      } else {
        try {
          rawBytes = toCopyUint8Array(decodePDFRawStream(obj).decode());
        } catch {
          rawBytes = toCopyUint8Array(obj.getContents());
        }
        mimeType = 'application/octet-stream';
        ext = 'bin';
        filterLabel = filters.join('+') || 'Raw';
      }

      const blob = new Blob([rawBytes], { type: mimeType });
      entries.push({
        id: `raw-img-${imageIdx}-${ref.objectNumber}`,
        category: 'image-stream',
        label: `Image #${imageIdx} (${w}×${h} · ${filterLabel})`,
        mimeType,
        sizeBytes: blob.size,
        fileName: `image-${String(imageIdx).padStart(3, '0')}-${w}x${h}.${ext}`,
        blob,
        url: URL.createObjectURL(blob),
      });
    }
    // 2. Embedded Font Programs
    else if (fontRefMap.has(refKey)) {
      fontIdx += 1;
      const meta = fontRefMap.get(refKey)!;
      let decoded: Uint8Array<ArrayBuffer>;
      try {
        decoded = toCopyUint8Array(decodePDFRawStream(obj).decode());
      } catch {
        decoded = toCopyUint8Array(obj.getContents());
      }
      const fmt = detectFontProgramFormat(decoded, meta.key);
      const safeName = meta.fontName.replace(/[^a-zA-Z0-9._-]+/g, '_') || `font-${fontIdx}`;
      const blob = new Blob([decoded], { type: fmt.mimeType });
      entries.push({
        id: `raw-font-${fontIdx}-${ref.objectNumber}`,
        category: 'font-program',
        label: `Font: ${meta.fontName} (${fmt.label})`,
        mimeType: fmt.mimeType,
        sizeBytes: blob.size,
        fileName: `${safeName}.${fmt.ext}`,
        blob,
        url: URL.createObjectURL(blob),
      });
    }
    // 3. Embedded File Streams
    else if (subtype === PDFName.of('EmbeddedFile') || embeddedFileNameMap.has(refKey)) {
      fileIdx += 1;
      let decoded: Uint8Array<ArrayBuffer>;
      try {
        decoded = toCopyUint8Array(decodePDFRawStream(obj).decode());
      } catch {
        decoded = toCopyUint8Array(obj.getContents());
      }
      const attachedName =
        embeddedFileNameMap.get(refKey) || `attachment-${String(fileIdx).padStart(3, '0')}.bin`;
      const blob = new Blob([decoded], { type: 'application/octet-stream' });
      entries.push({
        id: `raw-file-${fileIdx}-${ref.objectNumber}`,
        category: 'embedded-file',
        label: `Attachment: ${attachedName}`,
        mimeType: 'application/octet-stream',
        sizeBytes: blob.size,
        fileName: attachedName,
        blob,
        url: URL.createObjectURL(blob),
      });
    }
    // 4. XMP Metadata Streams
    else if (type === PDFName.of('Metadata') || subtype === PDFName.of('XML')) {
      xmpIdx += 1;
      let decoded: Uint8Array<ArrayBuffer>;
      try {
        decoded = toCopyUint8Array(decodePDFRawStream(obj).decode());
      } catch {
        decoded = toCopyUint8Array(obj.getContents());
      }
      const blob = new Blob([decoded], { type: 'application/xml' });
      entries.push({
        id: `raw-xmp-${xmpIdx}-${ref.objectNumber}`,
        category: 'xmp-metadata',
        label: `XMP Metadata Stream #${xmpIdx}`,
        mimeType: 'application/xml',
        sizeBytes: blob.size,
        fileName: `metadata-${String(xmpIdx).padStart(2, '0')}.xml`,
        blob,
        url: URL.createObjectURL(blob),
      });
    }
    // 5. Page Content Streams (capped for responsiveness on huge documents)
    else if (pageContentRefMap.has(refKey) && contentIdx < MAX_PAGE_CONTENT_STREAMS) {
      contentIdx += 1;
      const pageNo = pageContentRefMap.get(refKey)!;
      let decoded: Uint8Array<ArrayBuffer>;
      try {
        decoded = toCopyUint8Array(decodePDFRawStream(obj).decode());
      } catch {
        decoded = toCopyUint8Array(obj.getContents());
      }
      const blob = new Blob([decoded], { type: 'text/plain;charset=utf-8' });
      entries.push({
        id: `raw-content-${contentIdx}-${ref.objectNumber}`,
        category: 'page-content',
        label: `Page ${pageNo} Content Stream (obj ${ref.objectNumber})`,
        mimeType: 'text/plain;charset=utf-8',
        sizeBytes: blob.size,
        fileName: `page-${pageNo}-content-obj${ref.objectNumber}.txt`,
        blob,
        url: URL.createObjectURL(blob),
      });
    }

    if (i % 25 === 0) {
      onProgress?.(10 + Math.round(((i + 1) / total) * 85));
    }
  }

  onProgress?.(100);
  return entries;
}
