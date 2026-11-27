'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import JSZip from 'jszip';
import QRCode from 'qrcode';
import {
  Camera,
  Download,
  Trash2,
  Copy,
  Check,
  Plus,
  ArrowRight,
  QrCode,
  ScanLine,
  SlidersHorizontal,
  Sparkles,
  Eye,
  X,
  FileCode2,
  Images,
  Scissors,
  Binary,
  Loader2,
  ArrowUp,
  ArrowDown,
  FolderOpen,
  Upload,
  Clock,
} from 'lucide-react';
import PdfToolShell from './PdfToolShell';
import GoogleDriveModal from '@/components/native/GoogleDriveModal';
import {
  captureDesktopScreenFile,
  captureNativeCameraPhoto,
  isDesktopApp,
  isNativeAppRuntime,
} from '@/lib/native-bridge';
import { formatBytes } from '@/lib/formatters';
import {
  addPageNumbersToPdf,
  addWatermarkToPdf,
  compressPdfSmart,
  docxToPdfRich,
  extractAllSelectableText,
  extractEmbeddedImagesFromPdf,
  flattenPdf,
  imagesToPdf,
  pdfToDocxRich,
  pdfToImagesZip,
  pptxToPdf,
  protectPdfWithQpdf,
  removeBlankPagesFromPdf,
  removePdfAnnotations,
  removePdfMetadata,
  repairPdfMultiEngine,
  rotatePdfPages,
  runPdfOcr,
  sanitizeFilenameStem,
  sanitizePdfDeep,
  splitPdf,
  unlockPdfWithQpdf,
  type PdfExtractedImage,
  type PdfOutputFormat,
  type PdfPageSizePreset,
  type PdfProcessResult,
  type PdfRawBufferEntry,
} from '@/lib/pdf';
import { autoRotatePdf, detectBlankPages, rotatePdfByOrientation } from '@/lib/pdf/pdf-document';
import { pdfToStitchedImage } from '@/lib/pdf/office-convert';
import { formatOcrOutputAs, type OcrPageOutput } from '@/lib/pdf/ocr-engine';
import { extractRawPdfBuffers, getPdfPageInfos, splitScannedPagePhotos } from '@/lib/pdf/pdf-browser';

interface ScanPoint {
  x: number; // normalized 0..1
  y: number; // normalized 0..1
}

type ScanQuad = [ScanPoint, ScanPoint, ScanPoint, ScanPoint]; // TL, TR, BR, BL
type ScanFilterPreset =
  | 'original'
  | 'magic-color'
  | 'vivid'
  | 'lighten'
  | 'bw-document'
  | 'grayscale';

interface ScanPageItem {
  id: string;
  originalFile: File;
  originalUrl: string;
  file: File;
  previewUrl: string;
  filter: ScanFilterPreset;
  corners: ScanQuad;
  processing?: boolean;
}

const DEFAULT_FULL_QUAD: ScanQuad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const DEFAULT_INSET_QUAD: ScanQuad = [
  { x: 0.05, y: 0.05 },
  { x: 0.95, y: 0.05 },
  { x: 0.95, y: 0.95 },
  { x: 0.05, y: 0.95 },
];

function quadPolygonArea(q: ScanQuad): number {
  let area = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

function isConvexQuad(q: ScanQuad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const p0 = q[i];
    const p1 = q[(i + 1) % 4];
    const p2 = q[(i + 2) % 4];
    const cross = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x);
    if (Math.abs(cross) < 1e-6) return false;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (sign !== s) return false;
  }
  return true;
}

function detectDocumentQuadFromBitmap(bmp: ImageBitmap): ScanQuad {
  const maxDim = 320;
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.max(32, Math.round(bmp.width * scale));
  const h = Math.max(32, Math.round(bmp.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return DEFAULT_INSET_QUAD;
  ctx.drawImage(bmp, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  c.width = 0;
  c.height = 0;

  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }

  const grad = new Float32Array(w * h);
  const hist = new Uint32Array(1024);
  const margin = 3;
  let edgeSamples = 0;
  for (let y = margin; y < h - margin; y += 1) {
    for (let x = margin; x < w - margin; x += 1) {
      const idx = y * w + x;
      const gx =
        -gray[idx - w - 1] +
        gray[idx - w + 1] -
        2 * gray[idx - 1] +
        2 * gray[idx + 1] -
        gray[idx + w - 1] +
        gray[idx + w + 1];
      const gy =
        -gray[idx - w - 1] -
        2 * gray[idx - w] -
        gray[idx - w + 1] +
        gray[idx + w - 1] +
        2 * gray[idx + w] +
        gray[idx + w + 1];
      const mag = Math.abs(gx) + Math.abs(gy);
      grad[idx] = mag;
      const bin = Math.min(1023, Math.floor(mag));
      hist[bin] += 1;
      edgeSamples += 1;
    }
  }

  // Pick top ~10% edge threshold
  let threshold = 48;
  let acc = 0;
  const target = Math.floor(edgeSamples * 0.9);
  for (let b = 0; b < 1024; b += 1) {
    acc += hist[b];
    if (acc >= target) {
      threshold = Math.max(36, b);
      break;
    }
  }

  let tl = { x: w * 0.05, y: h * 0.05, score: Infinity };
  let tr = { x: w * 0.95, y: h * 0.05, score: -Infinity };
  let br = { x: w * 0.95, y: h * 0.95, score: -Infinity };
  let bl = { x: w * 0.05, y: h * 0.95, score: Infinity };
  let foundCount = 0;

  for (let y = margin + 1; y < h - margin - 1; y += 1) {
    for (let x = margin + 1; x < w - margin - 1; x += 1) {
      if (grad[y * w + x] < threshold) continue;
      foundCount += 1;
      const sum = x + y;
      const diff = x - y;
      if (sum < tl.score) tl = { x, y, score: sum };
      if (diff > tr.score) tr = { x, y, score: diff };
      if (sum > br.score) br = { x, y, score: sum };
      if (diff < bl.score) bl = { x, y, score: diff };
    }
  }

  if (foundCount < 20) return DEFAULT_INSET_QUAD;

  const candidate: ScanQuad = [
    { x: Math.max(0, Math.min(1, tl.x / w)), y: Math.max(0, Math.min(1, tl.y / h)) },
    { x: Math.max(0, Math.min(1, tr.x / w)), y: Math.max(0, Math.min(1, tr.y / h)) },
    { x: Math.max(0, Math.min(1, br.x / w)), y: Math.max(0, Math.min(1, br.y / h)) },
    { x: Math.max(0, Math.min(1, bl.x / w)), y: Math.max(0, Math.min(1, bl.y / h)) },
  ];

  if (quadPolygonArea(candidate) < 0.16 || !isConvexQuad(candidate)) {
    return DEFAULT_INSET_QUAD;
  }
  return candidate;
}

/**
 * Solve 8-DOF homography mapping destination (u,v) -> source (x,y)
 * using Gaussian elimination with partial pivoting.
 */
function solveHomography(
  dstPts: [ScanPoint, ScanPoint, ScanPoint, ScanPoint],
  srcPts: [ScanPoint, ScanPoint, ScanPoint, ScanPoint]
): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const u = dstPts[i].x;
    const v = dstPts[i].y;
    const x = srcPts[i].x;
    const y = srcPts[i].y;
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }

  const n = 8;
  for (let col = 0; col < n; col += 1) {
    let pivotRow = col;
    let maxVal = Math.abs(A[col][col]);
    for (let r = col + 1; r < n; r += 1) {
      const val = Math.abs(A[r][col]);
      if (val > maxVal) {
        maxVal = val;
        pivotRow = r;
      }
    }
    if (pivotRow !== col) {
      [A[col], A[pivotRow]] = [A[pivotRow], A[col]];
      [b[col], b[pivotRow]] = [b[pivotRow], b[col]];
    }
    const diag = Math.abs(A[col][col]) < 1e-12 ? 1e-12 : A[col][col];
    for (let r = col + 1; r < n; r += 1) {
      const factor = A[r][col] / diag;
      for (let c = col; c < n; c += 1) {
        A[r][c] -= factor * A[col][c];
      }
      b[r] -= factor * b[col];
    }
  }

  const h = new Array<number>(8).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) {
    let sum = b[r];
    for (let c = r + 1; c < n; c += 1) {
      sum -= A[r][c] * h[c];
    }
    h[r] = sum / (Math.abs(A[r][r]) < 1e-12 ? 1e-12 : A[r][r]);
  }
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function applyScanFilterInPlace(img: ImageData, filter: ScanFilterPreset) {
  if (filter === 'original') return;
  const { data, width: w, height: h } = img;
  const n = w * h;

  if (filter === 'grayscale') {
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const v = Math.max(0, Math.min(255, Math.round((lum - 128) * 1.18 + 132)));
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    }
    return;
  }

  if (filter === 'lighten') {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, Math.round(Math.pow(data[i] / 255, 0.72) * 255 + 14));
      data[i + 1] = Math.min(255, Math.round(Math.pow(data[i + 1] / 255, 0.72) * 255 + 14));
      data[i + 2] = Math.min(255, Math.round(Math.pow(data[i + 2] / 255, 0.72) * 255 + 14));
    }
    return;
  }

  if (filter === 'vivid') {
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const avg = (r + g + b) / 3;
      const sat = 1.32;
      const nr = (avg + (r - avg) * sat - 128) * 1.24 + 136;
      const ng = (avg + (g - avg) * sat - 128) * 1.24 + 136;
      const nb = (avg + (b - avg) * sat - 128) * 1.24 + 136;
      data[i] = Math.max(0, Math.min(255, Math.round(nr)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(ng)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(nb)));
    }
    return;
  }

  // Build 2D integral image of grayscale luminance for Bradley adaptive local thresholding / Magic Color
  const lum = new Uint8Array(n);
  const stride = w + 1;
  const integral = new Float64Array((w + 1) * (h + 1));

  for (let y = 0; y < h; y += 1) {
    let rowSum = 0;
    const rowOff = y * w;
    const intRow = (y + 1) * stride;
    const prevIntRow = y * stride;
    for (let x = 0; x < w; x += 1) {
      const p = (rowOff + x) * 4;
      const v = Math.round(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]);
      lum[rowOff + x] = v;
      rowSum += v;
      integral[intRow + x + 1] = integral[prevIntRow + x + 1] + rowSum;
    }
  }

  if (filter === 'bw-document') {
    // Bradley-Roth integral-image adaptive thresholding
    const s = Math.max(8, Math.round(Math.min(w, h) / 24));
    const t = 0.14;
    for (let y = 0; y < h; y += 1) {
      const y1 = Math.max(0, y - s);
      const y2 = Math.min(h - 1, y + s);
      for (let x = 0; x < w; x += 1) {
        const x1 = Math.max(0, x - s);
        const x2 = Math.min(w - 1, x + s);
        const count = (x2 - x1 + 1) * (y2 - y1 + 1);
        const sum =
          integral[(y2 + 1) * stride + (x2 + 1)] -
          integral[y1 * stride + (x2 + 1)] -
          integral[(y2 + 1) * stride + x1] +
          integral[y1 * stride + x1];
        const idx = y * w + x;
        const bin = lum[idx] * count < sum * (1 - t) ? 0 : 255;
        const p = idx * 4;
        data[p] = bin;
        data[p + 1] = bin;
        data[p + 2] = bin;
      }
    }
    return;
  }

  // Magic Color: local illumination normalization + crisp white background + vivid ink
  const s = Math.max(12, Math.round(Math.min(w, h) / 16));
  for (let y = 0; y < h; y += 1) {
    const y1 = Math.max(0, y - s);
    const y2 = Math.min(h - 1, y + s);
    for (let x = 0; x < w; x += 1) {
      const x1 = Math.max(0, x - s);
      const x2 = Math.min(w - 1, x + s);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum =
        integral[(y2 + 1) * stride + (x2 + 1)] -
        integral[y1 * stride + (x2 + 1)] -
        integral[(y2 + 1) * stride + x1] +
        integral[y1 * stride + x1];
      const localMean = sum / Math.max(1, count);
      const paperWhite = Math.max(90, localMean * 1.08);
      const idx = y * w + x;
      const p = idx * 4;
      const gain = Math.min(2.4, 248 / paperWhite);
      let r = data[p] * gain;
      let g = data[p + 1] * gain;
      let b = data[p + 2] * gain;
      // Push near-white paper cleanly to #fff while boosting darker ink contrast
      const avg = (r + g + b) / 3;
      if (avg > 212 && Math.max(r, g, b) - Math.min(r, g, b) < 28) {
        r = 255;
        g = 255;
        b = 255;
      } else {
        r = (r - 128) * 1.18 + 128;
        g = (g - 128) * 1.18 + 128;
        b = (b - 128) * 1.18 + 128;
      }
      data[p] = Math.max(0, Math.min(255, Math.round(r)));
      data[p + 1] = Math.max(0, Math.min(255, Math.round(g)));
      data[p + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }
  }
}

async function processScanDocument(
  originalFile: File,
  corners: ScanQuad,
  filter: ScanFilterPreset
): Promise<{ file: File; previewUrl: string }> {
  const bmp = await createImageBitmap(originalFile);
  try {
    const sw = bmp.width;
    const sh = bmp.height;
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = sw;
    srcCanvas.height = sh;
    const srcCtx = srcCanvas.getContext('2d');
    if (!srcCtx) throw new Error('Canvas unavailable');
    srcCtx.drawImage(bmp, 0, 0);

    const isIdentityQuad =
      corners.every((pt, idx) => Math.hypot(pt.x - DEFAULT_FULL_QUAD[idx].x, pt.y - DEFAULT_FULL_QUAD[idx].y) < 0.004);

    let outCanvas: HTMLCanvasElement;
    if (isIdentityQuad) {
      outCanvas = srcCanvas;
    } else {
      const srcPx: [ScanPoint, ScanPoint, ScanPoint, ScanPoint] = [
        { x: corners[0].x * sw, y: corners[0].y * sh },
        { x: corners[1].x * sw, y: corners[1].y * sh },
        { x: corners[2].x * sw, y: corners[2].y * sh },
        { x: corners[3].x * sw, y: corners[3].y * sh },
      ];
      const topW = Math.hypot(srcPx[1].x - srcPx[0].x, srcPx[1].y - srcPx[0].y);
      const botW = Math.hypot(srcPx[2].x - srcPx[3].x, srcPx[2].y - srcPx[3].y);
      const leftH = Math.hypot(srcPx[3].x - srcPx[0].x, srcPx[3].y - srcPx[0].y);
      const rightH = Math.hypot(srcPx[2].x - srcPx[1].x, srcPx[2].y - srcPx[1].y);

      let outW = Math.max(120, Math.round(Math.max(topW, botW)));
      let outH = Math.max(120, Math.round(Math.max(leftH, rightH)));
      const maxEdge = 1800;
      if (Math.max(outW, outH) > maxEdge) {
        const s = maxEdge / Math.max(outW, outH);
        outW = Math.round(outW * s);
        outH = Math.round(outH * s);
      }

      const dstPx: [ScanPoint, ScanPoint, ScanPoint, ScanPoint] = [
        { x: 0, y: 0 },
        { x: outW - 1, y: 0 },
        { x: outW - 1, y: outH - 1 },
        { x: 0, y: outH - 1 },
      ];
      const H = solveHomography(dstPx, srcPx);
      const srcData = srcCtx.getImageData(0, 0, sw, sh).data;
      outCanvas = document.createElement('canvas');
      outCanvas.width = outW;
      outCanvas.height = outH;
      const outCtx = outCanvas.getContext('2d');
      if (!outCtx) throw new Error('Canvas unavailable');
      const outImg = outCtx.createImageData(outW, outH);
      const outData = outImg.data;

      for (let v = 0; v < outH; v += 1) {
        for (let u = 0; u < outW; u += 1) {
          const denom = H[6] * u + H[7] * v + H[8];
          const sx = (H[0] * u + H[1] * v + H[2]) / denom;
          const sy = (H[3] * u + H[4] * v + H[5]) / denom;

          const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)));
          const y0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)));
          const x1 = Math.min(sw - 1, x0 + 1);
          const y1 = Math.min(sh - 1, y0 + 1);
          const fx = Math.max(0, Math.min(1, sx - x0));
          const fy = Math.max(0, Math.min(1, sy - y0));

          const i00 = (y0 * sw + x0) * 4;
          const i10 = (y0 * sw + x1) * 4;
          const i01 = (y1 * sw + x0) * 4;
          const i11 = (y1 * sw + x1) * 4;
          const w00 = (1 - fx) * (1 - fy);
          const w10 = fx * (1 - fy);
          const w01 = (1 - fx) * fy;
          const w11 = fx * fy;

          const dp = (v * outW + u) * 4;
          outData[dp] = Math.round(
            srcData[i00] * w00 + srcData[i10] * w10 + srcData[i01] * w01 + srcData[i11] * w11
          );
          outData[dp + 1] = Math.round(
            srcData[i00 + 1] * w00 +
              srcData[i10 + 1] * w10 +
              srcData[i01 + 1] * w01 +
              srcData[i11 + 1] * w11
          );
          outData[dp + 2] = Math.round(
            srcData[i00 + 2] * w00 +
              srcData[i10 + 2] * w10 +
              srcData[i01 + 2] * w01 +
              srcData[i11 + 2] * w11
          );
          outData[dp + 3] = 255;
        }
      }
      outCtx.putImageData(outImg, 0, 0);
      srcCanvas.width = 0;
      srcCanvas.height = 0;
    }

    if (filter !== 'original') {
      const ctx = outCanvas.getContext('2d');
      if (ctx) {
        const img = ctx.getImageData(0, 0, outCanvas.width, outCanvas.height);
        applyScanFilterInPlace(img, filter);
        ctx.putImageData(img, 0, 0);
      }
    }

    const blob = await new Promise<Blob | null>((r) => outCanvas.toBlob(r, 'image/jpeg', 0.92));
    outCanvas.width = 0;
    outCanvas.height = 0;
    if (!blob) throw new Error('Failed to encode scan image.');
    const stem = sanitizeFilenameStem(originalFile.name, 'scan');
    const outFile = new File([blob], `${stem}-scanned.jpg`, { type: 'image/jpeg' });
    return { file: outFile, previewUrl: URL.createObjectURL(outFile) };
  } finally {
    bmp.close();
  }
}

export function PdfMakeFromCameraTool() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const editorWrapRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const createdUrlsRef = useRef<Set<string>>(new Set());
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [items, setItems] = useState<ScanPageItem[]>([]);
  const [pageSize, setPageSize] = useState<PdfPageSizePreset>('a4');
  const [marginPt, setMarginPt] = useState<number>(18);
  const [camError, setCamError] = useState<string | null>(null);

  // Mobile QR handoff (session-scoped 5-minute TTL + BroadcastChannel streaming)
  const [showQrPanel, setShowQrPanel] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [handoffUrl, setHandoffUrl] = useState<string>('');
  const [handoffToken, setHandoffToken] = useState<string>('');
  const [handoffExpiresAt, setHandoffExpiresAt] = useState<number>(0);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [mobilePairToken, setMobilePairToken] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Interactive 4-corner perspective editor
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftCorners, setDraftCorners] = useState<ScanQuad>(DEFAULT_INSET_QUAD);
  const [draftFilter, setDraftFilter] = useState<ScanFilterPreset>('magic-color');
  const [draggingCornerIdx, setDraggingCornerIdx] = useState<number | null>(null);
  const [applyingEdit, setApplyingEdit] = useState(false);
  const [driveModalOpen, setDriveModalOpen] = useState(false);
  const [nativeAppMode, setNativeAppMode] = useState(false);

  useEffect(() => {
    setNativeAppMode(isNativeAppRuntime());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const sess = params.get('session');
    if (params.get('mobile') === '1' && sess) {
      setMobilePairToken(sess);
    }
  }, []);

  // Bind live camera MediaStream once <video> mounts
  useEffect(() => {
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Cleanup camera stream and created object URLs on unmount
  useEffect(() => {
    const urls = createdUrlsRef.current;
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  // Desktop BroadcastChannel receiver + 5-minute TTL countdown
  useEffect(() => {
    if (!showQrPanel || typeof window === 'undefined') return;
    const token =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().slice(0, 12)
        : Math.random().toString(36).slice(2, 14);
    const exp = Date.now() + 5 * 60 * 1000;
    setHandoffToken(token);
    setHandoffExpiresAt(exp);
    setSecondsLeft(300);

    const target = `${window.location.origin}/tools/pdf/make-pdf?mobile=1&session=${encodeURIComponent(token)}`;
    setHandoffUrl(target);
    QRCode.toDataURL(target, { width: 176, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => setQrDataUrl(url))
      .catch(() => setQrDataUrl(''));

    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel(`muxaro-scan-handoff-${token}`);
      bc.onmessage = (ev) => {
        if (Date.now() > exp) return;
        const msg = ev.data as { kind?: string; name?: string; mimeType?: string; buffer?: ArrayBuffer } | null;
        if (msg?.kind === 'scan-page' && msg.buffer instanceof ArrayBuffer) {
          const file = new File([msg.buffer], msg.name || `phone-scan-${Date.now()}.jpg`, {
            type: msg.mimeType || 'image/jpeg',
          });
          void ingestFiles([file], 'magic-color');
        }
      };
    }

    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.round((exp - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) {
        window.clearInterval(timer);
        setShowQrPanel(false);
      }
    }, 1000);

    return () => {
      window.clearInterval(timer);
      bc?.close();
    };
  }, [showQrPanel]);

  const sendQueueToDesktop = async () => {
    if (!mobilePairToken || items.length === 0 || typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel(`muxaro-scan-handoff-${mobilePairToken}`);
    for (const it of items) {
      const buf = await it.file.arrayBuffer();
      bc.postMessage({ kind: 'scan-page', name: it.file.name, mimeType: it.file.type, buffer: buf });
    }
    bc.close();
  };

  const ingestFiles = async (files: File[], defaultFilter: ScanFilterPreset = 'original') => {
    const created: ScanPageItem[] = [];
    for (let i = 0; i < files.length; i += 1) {
      const f = files[i];
      if (!f.type.startsWith('image/')) continue;
      const id = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
      const originalUrl = URL.createObjectURL(f);
      createdUrlsRef.current.add(originalUrl);
      let detectedCorners = DEFAULT_FULL_QUAD;
      try {
        const bmp = await createImageBitmap(f);
        detectedCorners = detectDocumentQuadFromBitmap(bmp);
        bmp.close();
      } catch {
        detectedCorners = DEFAULT_INSET_QUAD;
      }
      let outFile = f;
      let outUrl = originalUrl;
      if (defaultFilter !== 'original') {
        try {
          const processed = await processScanDocument(f, detectedCorners, defaultFilter);
          outFile = processed.file;
          outUrl = processed.previewUrl;
          createdUrlsRef.current.add(outUrl);
        } catch {
          // Keep original on filter failure
        }
      }
      created.push({
        id,
        originalFile: f,
        originalUrl,
        file: outFile,
        previewUrl: outUrl,
        filter: defaultFilter,
        corners: detectedCorners,
      });
    }
    if (created.length === 0) return;
    setItems((prev) => [...prev, ...created]);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const files: File[] = [];
    for (const item of Array.from(e.clipboardData?.items || [])) {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      void ingestFiles(files, 'magic-color');
    }
  };

  const startCamera = async () => {
    setCamError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setStream(s);
    } catch {
      setCamError('Camera permission denied or unavailable. Use "Choose file" or paste an image instead.');
    }
  };

  const stopCamera = () => {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  };

  const captureFrame = () => {
    const v = videoRef.current;
    if (!v) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth || 1280;
    c.height = v.videoHeight || 720;
    c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(
      (blob) => {
        if (!blob) return;
        const f = new File([blob], `scan-${Date.now()}.jpg`, { type: 'image/jpeg' });
        void ingestFiles([f], 'magic-color');
      },
      'image/jpeg',
      0.92
    );
  };

  const openPerspectiveEditor = (item: ScanPageItem) => {
    setEditingId(item.id);
    setDraftCorners(item.corners);
    setDraftFilter(item.filter);
  };

  const reprocessItem = async (
    id: string,
    corners: ScanQuad,
    filter: ScanFilterPreset
  ) => {
    const target = items.find((x) => x.id === id);
    if (!target) return;
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, processing: true } : x)));
    try {
      const processed = await processScanDocument(target.originalFile, corners, filter);
      setItems((prev) =>
        prev.map((x) =>
          x.id === id
            ? {
                ...x,
                corners,
                filter,
                file: processed.file,
                previewUrl: processed.previewUrl,
                processing: false,
              }
            : x
        )
      );
    } catch {
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, processing: false } : x)));
    }
  };

  const applyEditorChanges = async () => {
    if (!editingId) return;
    setApplyingEdit(true);
    try {
      await reprocessItem(editingId, draftCorners, draftFilter);
      setEditingId(null);
    } finally {
      setApplyingEdit(false);
    }
  };

  const handleAutoDetectInEditor = async () => {
    const target = items.find((x) => x.id === editingId);
    if (!target) return;
    const bmp = await createImageBitmap(target.originalFile);
    const quad = detectDocumentQuadFromBitmap(bmp);
    bmp.close();
    setDraftCorners(quad);
  };

  const handleCornerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingCornerIdx === null || !editorWrapRef.current) return;
    const rect = editorWrapRef.current.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
    setDraftCorners((prev) => {
      const copy = [...prev] as ScanQuad;
      copy[draggingCornerIdx] = { x: nx, y: ny };
      return copy;
    });
  };

  const editingItem = items.find((x) => x.id === editingId) || null;

  return (
    <PdfToolShell
      title="Create / scan PDF"
      description="Camera & phone-QR scanner with Sobel auto-edge detection, 4-corner homography dewarp, and adaptive B&W / Magic Color filters."
      currentHref="/tools/pdf/make-pdf"
      accept="image/jpeg,image/png,image/webp"
      multiple
      selectedFiles={items.map((i) => i.file)}
      onFilesSelected={(files) => void ingestFiles(files, 'original')}
      submitLabel={`Create PDF (${items.length} page${items.length === 1 ? '' : 's'})`}
      canSubmit={items.length > 0}
      onRun={(onProgress, signal) =>
        imagesToPdf(
          items.map((i) => ({ file: i.file, filter: 'none' })),
          { pageSize, marginPt, fitMode: 'contain' },
          onProgress,
          signal
        )
      }
    >
      <div
        onPaste={handlePaste}
        className="p-5 rounded-2xl border border-line bg-surface space-y-4"
      >
        <GoogleDriveModal
          open={driveModalOpen}
          onClose={() => setDriveModalOpen(false)}
          onImported={(file) => void ingestFiles([file], 'magic-color')}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {!stream ? (
              <button
                type="button"
                onClick={async () => {
                  const nativeSnap = await captureNativeCameraPhoto();
                  if (nativeSnap) {
                    void ingestFiles([nativeSnap], 'magic-color');
                    return;
                  }
                  void startCamera();
                }}
                className="px-3.5 py-2 rounded-xl border border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Camera className="w-4 h-4 text-emerald-500" aria-hidden="true" />
                <span>{nativeAppMode ? 'Take Camera Photo' : 'Open camera scanner'}</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={captureFrame}
                  className="muxaro-btn-primary px-4 py-2 rounded-xl text-xs font-semibold"
                >
                  Capture page
                </button>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="px-3 py-2 rounded-xl border border-line text-xs"
                >
                  Close camera
                </button>
              </>
            )}

            {nativeAppMode && (
              <>
                <button
                  type="button"
                  onClick={() => setDriveModalOpen(true)}
                  className="px-3.5 py-2 rounded-xl border border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <FolderOpen className="w-4 h-4 text-brand" aria-hidden="true" />
                  <span>Google Drive</span>
                </button>
                {isDesktopApp() && (
                  <button
                    type="button"
                    onClick={async () => {
                      const shot = await captureDesktopScreenFile();
                      if (shot) void ingestFiles([shot], 'original');
                    }}
                    className="px-3.5 py-2 rounded-xl border border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <ScanLine className="w-4 h-4 text-brand" aria-hidden="true" />
                    <span>Capture Screen</span>
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              onClick={() => setShowQrPanel((v) => !v)}
              className={`px-3.5 py-2 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 ${
                showQrPanel
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-line bg-surface-elevated text-content'
              }`}
            >
              <QrCode className="w-4 h-4" aria-hidden="true" />
              <span>Mobile QR Handoff</span>
            </button>

            {items.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  items.forEach((it) => {
                    void reprocessItem(it.id, it.corners, 'bw-document');
                  });
                }}
                className="px-3 py-2 rounded-xl border border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5 text-brand" />
                <span>Auto-Dewarp &amp; B&amp;W All</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={(e) => setPageSize(e.target.value as PdfPageSizePreset)}
              className="px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
              aria-label="Page size"
            >
              <option value="a4">A4</option>
              <option value="letter">US Letter</option>
              <option value="auto">Auto fit photo</option>
            </select>
            <select
              value={marginPt}
              onChange={(e) => setMarginPt(Number(e.target.value))}
              className="px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
              aria-label="Page margin"
            >
              <option value={0}>No margin</option>
              <option value={18}>Small margin</option>
              <option value={36}>Wide margin</option>
            </select>
          </div>
        </div>

        {mobilePairToken && (
          <div className="p-3 rounded-xl border border-brand/30 bg-brand/5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>Paired with desktop session <code className="font-mono">{handoffToken || mobilePairToken}</code></span>
            <button
              type="button"
              disabled={items.length === 0}
              onClick={() => void sendQueueToDesktop()}
              className="px-3 py-1 rounded-lg bg-brand text-white font-semibold disabled:opacity-40"
            >
              Send {items.length} Page(s) to Desktop Tab
            </button>
          </div>
        )}

        {showQrPanel && (
          <div className="p-4 rounded-xl border border-brand/30 bg-brand/5 flex flex-col sm:flex-row items-center gap-4">
            <div className="w-40 h-40 rounded-xl bg-white p-2 border border-line flex items-center justify-center shrink-0">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="QR code to open mobile document scanner"
                  className="w-full h-full object-contain"
                />
              ) : (
                <span className="text-[11px] text-content-muted">Generating QR…</span>
              )}
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-content">Capture &amp; Stream into Desktop Queue</span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-elevated border border-line font-mono text-[10px] text-content-secondary">
                  <Clock className="w-3 h-3 text-brand" />
                  <span>Expires {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</span>
                </span>
              </div>
              <p className="text-content-secondary leading-relaxed">
                Scan this one-time session QR (<code className="font-mono">{handoffToken}</code>) to capture pages directly or paste with <kbd className="px-1.5 py-0.5 rounded border border-line bg-surface">Ctrl+V</kbd>. Timeout resets automatically in {Math.ceil((handoffExpiresAt - Date.now()) / 60000) || 5} min.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="px-2 py-1 rounded bg-surface-elevated border border-line text-[11px] truncate max-w-xs">
                  {handoffUrl}
                </code>
                <button
                  type="button"
                  onClick={async () => {
                    if (!handoffUrl) return;
                    await navigator.clipboard.writeText(handoffUrl);
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 1800);
                  }}
                  className="px-2.5 py-1 rounded-lg border border-line bg-surface-elevated font-semibold inline-flex items-center gap-1"
                >
                  {copiedLink ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedLink ? 'Copied' : 'Copy link'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {camError && <p className="text-xs text-amber-500">{camError}</p>}

        {stream && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full max-w-md rounded-xl border border-line bg-black"
          />
        )}

        {editingItem && (
          <div className="p-4 rounded-2xl border border-brand/40 bg-surface-elevated space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-content">
                <ScanLine className="w-4 h-4 text-brand" />
                <span>Perspective Dewarp &amp; Scan Filter — {editingItem.originalFile.name}</span>
              </div>
              <button
                type="button"
                onClick={() => setEditingId(null)}
                aria-label="Close perspective editor"
                className="p-1 rounded-lg border border-line bg-surface"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleAutoDetectInEditor()}
                  className="px-2.5 py-1 rounded-lg border border-line bg-surface text-xs font-semibold"
                >
                  Auto-Detect Edges
                </button>
                <button
                  type="button"
                  onClick={() => setDraftCorners(DEFAULT_FULL_QUAD)}
                  className="px-2.5 py-1 rounded-lg border border-line bg-surface text-xs font-semibold"
                >
                  Full Frame
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1">
                {(
                  [
                    { id: 'original', label: 'Original' },
                    { id: 'magic-color', label: 'Magic Color' },
                    { id: 'vivid', label: 'Vivid Docs' },
                    { id: 'lighten', label: 'Lighten' },
                    { id: 'bw-document', label: 'B&W Crisp' },
                    { id: 'grayscale', label: 'Grayscale' },
                  ] as const
                ).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setDraftFilter(preset.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                      draftFilter === preset.id
                        ? 'bg-brand text-white border-brand'
                        : 'bg-surface text-content border-line'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-center bg-black/80 rounded-xl p-3 overflow-hidden">
              <div
                ref={editorWrapRef}
                onPointerMove={handleCornerPointerMove}
                onPointerUp={() => setDraggingCornerIdx(null)}
                onPointerCancel={() => setDraggingCornerIdx(null)}
                className="relative inline-block select-none touch-none max-w-full"
              >
                <img
                  src={editingItem.originalUrl}
                  alt="Adjust 4 perspective corners"
                  draggable={false}
                  className="max-h-[420px] w-auto block rounded"
                />
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  className="absolute inset-0 w-full h-full pointer-events-none"
                >
                  <polygon
                    points={draftCorners
                      .map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`)
                      .join(' ')}
                    fill="rgba(85, 98, 240, 0.14)"
                    stroke="#5562F0"
                    strokeWidth="0.7"
                  />
                </svg>
                {draftCorners.map((pt, cIdx) => (
                  <button
                    key={cIdx}
                    type="button"
                    aria-label={`Corner handle ${cIdx + 1}`}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setDraggingCornerIdx(cIdx);
                    }}
                    style={{
                      left: `${pt.x * 100}%`,
                      top: `${pt.y * 100}%`,
                    }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-brand border-2 border-white shadow cursor-grab active:cursor-grabbing"
                  />
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingId(null)}
                className="px-3.5 py-1.5 rounded-xl border border-line text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={applyingEdit}
                onClick={() => void applyEditorChanges()}
                className="muxaro-btn-primary px-4 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5"
              >
                {applyingEdit && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Apply Dewarp &amp; Filter</span>
              </button>
            </div>
          </div>
        )}

        {items.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {items.map((it, idx) => (
              <div
                key={it.id}
                className="p-2.5 rounded-xl border border-line bg-surface-elevated space-y-2"
              >
                <div className="relative">
                  <img
                    src={it.previewUrl}
                    alt={it.file.name}
                    className="w-full h-36 object-cover rounded-lg bg-white"
                  />
                  {it.processing && (
                    <div className="absolute inset-0 bg-black/45 rounded-lg flex items-center justify-center">
                      <Loader2 className="w-5 h-5 text-white animate-spin" />
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-1">
                  <select
                    value={it.filter}
                    onChange={(e) =>
                      void reprocessItem(
                        it.id,
                        it.corners,
                        e.target.value as ScanFilterPreset
                      )
                    }
                    className="px-2 py-1 rounded border border-line bg-surface text-[11px] min-w-0 flex-1"
                    aria-label={`Filter for page ${idx + 1}`}
                  >
                    <option value="original">Original</option>
                    <option value="magic-color">Magic Color</option>
                    <option value="vivid">Vivid Docs</option>
                    <option value="lighten">Lighten</option>
                    <option value="bw-document">B&amp;W Crisp</option>
                    <option value="grayscale">Grayscale</option>
                  </select>
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() =>
                      setItems((prev) => {
                        const c = [...prev];
                        [c[idx - 1], c[idx]] = [c[idx], c[idx - 1]];
                        return c;
                      })
                    }
                    aria-label={`Move scan ${idx + 1} earlier`}
                    className="p-1 rounded border border-line bg-surface disabled:opacity-30"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === items.length - 1}
                    onClick={() =>
                      setItems((prev) => {
                        const c = [...prev];
                        [c[idx], c[idx + 1]] = [c[idx + 1], c[idx]];
                        return c;
                      })
                    }
                    aria-label={`Move scan ${idx + 1} later`}
                    className="p-1 rounded border border-line bg-surface disabled:opacity-30"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openPerspectiveEditor(it)}
                    aria-label={`Adjust perspective for page ${idx + 1}`}
                    title="Adjust corners & dewarp"
                    className="p-1.5 rounded border border-line bg-surface text-content hover:text-brand"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (editingId === it.id) setEditingId(null);
                      URL.revokeObjectURL(it.originalUrl);
                      if (it.previewUrl !== it.originalUrl) URL.revokeObjectURL(it.previewUrl);
                      createdUrlsRef.current.delete(it.originalUrl);
                      createdUrlsRef.current.delete(it.previewUrl);
                      setItems((prev) => prev.filter((x) => x.id !== it.id));
                    }}
                    aria-label="Remove scan"
                    className="p-1 text-error"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PdfToolShell>
  );
}

/**
 * iLovePDF Benchmark: Orientation + Margin Presets + Page Size
 */
export function PdfImageToPdfTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [pageSize, setPageSize] = useState<PdfPageSizePreset>('a4');
  const [orientation, setOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto');
  const [marginPt, setMarginPt] = useState(14);
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');

  const moveFile = (idx: number, delta: -1 | 1) => {
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= files.length) return;
    setFiles((prev) => {
      const copy = [...prev];
      const [m] = copy.splice(idx, 1);
      copy.splice(nextIdx, 0, m);
      return copy;
    });
  };

  return (
    <PdfToolShell
      title="Image to PDF"
      description="Convert JPG, PNG, WebP, BMP, TIFF, or SVG images with fit modes, orientation, and EXIF rotation."
      currentHref="/tools/pdf/image-to-pdf"
      accept="image/jpeg,image/png,image/webp,image/bmp,image/svg+xml,image/tiff,.bmp,.svg,.tif,.tiff,.webp"
      multiple
      selectedFiles={files}
      onFilesSelected={(next) => setFiles((prev) => [...prev, ...next])}
      submitLabel={`Convert ${files.length} Image(s) to PDF`}
      canSubmit={files.length > 0}
      onRun={(onProgress, signal) =>
        imagesToPdf(
          files.map((f) => ({ file: f })),
          { pageSize, orientation, marginPt, fitMode },
          onProgress,
          signal
        )
      }
    >
      <div className="p-5 rounded-2xl border border-line bg-surface space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <label className="text-xs text-content-secondary space-y-1">
            <span>Page size</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(e.target.value as PdfPageSizePreset)}
              className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
            >
              <option value="a4">A4</option>
              <option value="letter">US Letter</option>
              <option value="auto">Fit each image natively</option>
            </select>
          </label>
          <label className="text-xs text-content-secondary space-y-1">
            <span>Orientation</span>
            <select
              value={orientation}
              onChange={(e) => setOrientation(e.target.value as 'auto' | 'portrait' | 'landscape')}
              className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
            >
              <option value="auto">Auto (match photo)</option>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
          <label className="text-xs text-content-secondary space-y-1">
            <span>Margin preset</span>
            <select
              value={marginPt}
              onChange={(e) => setMarginPt(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
            >
              <option value={0}>No margin (0pt)</option>
              <option value={14}>Small (14pt)</option>
              <option value={32}>Big (32pt)</option>
            </select>
          </label>
          <label className="text-xs text-content-secondary space-y-1">
            <span>Scaling / fit</span>
            <select
              value={fitMode}
              onChange={(e) => setFitMode(e.target.value as 'contain' | 'cover')}
              className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
            >
              <option value="contain">Contain (no crop)</option>
              <option value="cover">Cover (edge to edge)</option>
            </select>
          </label>
        </div>

        {files.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-line">
            {files.map((f, idx) => (
              <div
                key={`${f.name}-${idx}`}
                className="px-3 py-2 rounded-xl border border-line bg-surface-elevated flex items-center justify-between gap-2 text-xs"
              >
                <span className="truncate font-medium text-content">
                  {idx + 1}. {f.name} ({formatBytes(f.size)})
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => moveFile(idx, -1)}
                    aria-label="Move image up"
                    className="p-1 rounded border border-line bg-surface disabled:opacity-30"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === files.length - 1}
                    onClick={() => moveFile(idx, 1)}
                    aria-label="Move image down"
                    className="p-1 rounded border border-line bg-surface disabled:opacity-30"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                    aria-label="Remove image"
                    className="p-1 text-error"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PdfToolShell>
  );
}

export function PdfToImageTool() {
  const [file, setFile] = useState<File | null>(null);
  const [layout, setLayout] = useState<'zip' | 'stitched'>('zip');
  const [format, setFormat] = useState<PdfOutputFormat>('jpeg');
  const [dpi, setDpi] = useState<72 | 150 | 300>(150);
  const [pageRange, setPageRange] = useState('');
  const [gapPx, setGapPx] = useState(16);

  return (
    <PdfToolShell
      title="PDF to Image"
      description="Export PDF pages to individual JPG/PNG/WebP images (ZIP) or a single stitched vertical long-strip image."
      currentHref="/tools/pdf/pdf-to-jpg"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => setFile(files[0] || null)}
      submitLabel={layout === 'stitched' ? 'Export Stitched Vertical Image' : 'Export Images'}
      onRun={(onProgress, signal) => {
        if (layout === 'stitched') {
          return pdfToStitchedImage(file!, {
            format,
            scale: dpi / 72,
            gapPx,
            quality: 0.9,
            signal,
            onProgress,
          });
        }
        return pdfToImagesZip(file!, { format, dpi, quality: 0.9, pageRange }, onProgress, signal);
      }}
    >
      <div className="p-5 rounded-2xl border border-line bg-surface space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-content-secondary mr-1">Output Layout:</span>
          <button
            type="button"
            onClick={() => setLayout('zip')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border ${
              layout === 'zip'
                ? 'bg-brand text-white border-brand'
                : 'bg-surface-elevated text-content border-line'
            }`}
          >
            Individual Images (ZIP)
          </button>
          <button
            type="button"
            onClick={() => setLayout('stitched')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border ${
              layout === 'stitched'
                ? 'bg-brand text-white border-brand'
                : 'bg-surface-elevated text-content border-line'
            }`}
          >
            Single Stitched Vertical Image
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="text-xs text-content-secondary space-y-1">
            <span>Format</span>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as PdfOutputFormat)}
              className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
            >
              <option value="jpeg">JPG (compact)</option>
              <option value="png">PNG (lossless)</option>
              <option value="webp">WebP</option>
              {layout === 'zip' && <option value="gif">GIF</option>}
              {layout === 'zip' && <option value="tiff">TIFF</option>}
            </select>
          </label>
          <label className="text-xs text-content-secondary space-y-1">
            <span>Resolution</span>
            <select
              value={dpi}
              onChange={(e) => setDpi(Number(e.target.value) as 72 | 150 | 300)}
              className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
            >
              <option value={72}>72 DPI (Screen)</option>
              <option value={150}>150 DPI (Standard)</option>
              <option value={300}>300 DPI (Print sharp)</option>
            </select>
          </label>
          {layout === 'zip' ? (
            <label className="text-xs text-content-secondary space-y-1">
              <span>Page range (optional)</span>
              <input
                type="text"
                placeholder="All pages (or 1-4, 6)"
                value={pageRange}
                onChange={(e) => setPageRange(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
              />
            </label>
          ) : (
            <label className="text-xs text-content-secondary space-y-1">
              <span>Gap between pages (px)</span>
              <input
                type="number"
                min={0}
                max={120}
                value={gapPx}
                onChange={(e) => setGapPx(Math.max(0, Number(e.target.value)))}
                className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
              />
            </label>
          )}
        </div>
      </div>
    </PdfToolShell>
  );
}

export function PdfToWordTool() {
  const [file, setFile] = useState<File | null>(null);
  return (
    <PdfToolShell
      title="PDF to Word"
      description="Convert PDF text into structured Word (.docx) preserving headings, bold/italic styles, and page breaks."
      currentHref="/tools/pdf/pdf-to-word"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => setFile(files[0] || null)}
      submitLabel="Convert to .docx"
      onRun={(onProgress, signal) => pdfToDocxRich(file!, onProgress, signal)}
    >
      <div className="p-4 rounded-xl border border-line bg-surface flex flex-wrap items-center justify-between gap-3 text-xs text-content-secondary">
        <span>
          Structure-aware conversion extracts headings and styled text locally. If your PDF is scanned, run OCR first.
        </span>
        <Link
          href="/tools/pdf/ocr"
          className="inline-flex items-center gap-1 text-brand font-semibold shrink-0"
        >
          <span>Open OCR Tool</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </PdfToolShell>
  );
}

export function PdfWordToPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  return (
    <PdfToolShell
      title="Word to PDF"
      description="Convert .docx files locally preserving headings, bold/italic runs, bullet lists, and tables."
      currentHref="/tools/pdf/word-to-pdf"
      accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      filePromptLabel="Choose a Word (.docx) file or drag and drop"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => setFile(files[0] || null)}
      submitLabel="Convert .docx to PDF"
      onRun={(onProgress) => docxToPdfRich(file!, onProgress)}
    >
      {file && (
        <div className="p-4 rounded-xl border border-line bg-surface text-xs text-content-secondary">
          Loaded <strong className="text-content">{file.name}</strong> ({formatBytes(file.size)}).
        </div>
      )}
    </PdfToolShell>
  );
}

export function PdfPptxToPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  return (
    <PdfToolShell
      title="PowerPoint / ODP to PDF"
      description="Render .pptx and OpenDocument .odp slides locally at native aspect ratio into a crisp PDF."
      currentHref="/tools/pdf/powerpoint-to-pdf"
      accept=".pptx,.odp,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.oasis.opendocument.presentation"
      filePromptLabel="Choose a PowerPoint (.pptx) or OpenDocument (.odp) presentation"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => setFile(files[0] || null)}
      submitLabel="Convert Presentation to PDF"
      onRun={(onProgress, signal) => pptxToPdf(file!, onProgress, signal)}
    >
      {file && (
        <div className="p-4 rounded-xl border border-line bg-surface text-xs text-content-secondary">
          Loaded <strong className="text-content">{file.name}</strong> ({formatBytes(file.size)}). External links are stripped before rendering.
        </div>
      )}
    </PdfToolShell>
  );
}

type OcrExportFormat = 'searchable-pdf' | 'txt' | 'md' | 'csv' | 'html' | 'rtf' | 'xml' | 'json';

export function PdfOcrTool() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'text-layer' | 'ocr'>('ocr');
  const [outputFormat, setOutputFormat] = useState<OcrExportFormat>('searchable-pdf');
  const [maxPages, setMaxPages] = useState(10);
  const [extractedText, setExtractedText] = useState('');
  const [lastPages, setLastPages] = useState<OcrPageOutput[]>([]);
  const [copied, setCopied] = useState(false);

  const buildJsonResult = (pages: OcrPageOutput[], sourceName: string, elapsedMs: number): PdfProcessResult => {
    const stem = sanitizeFilenameStem(sourceName, 'document');
    const jsonPayload = JSON.stringify(
      {
        fileName: sourceName,
        mode,
        pageCount: pages.length,
        pages,
      },
      null,
      2
    );
    const blob = new Blob([jsonPayload], { type: 'application/json;charset=utf-8' });
    return {
      blob,
      url: URL.createObjectURL(blob),
      fileName: `${stem}-ocr.json`,
      mimeType: 'application/json;charset=utf-8',
      sizeBytes: blob.size,
      elapsedMs,
      pageCount: pages.length,
      summary: `Exported ${pages.length} page(s) as structured JSON`,
    };
  };

  const triggerDownloadResult = (res: PdfProcessResult) => {
    const a = document.createElement('a');
    a.href = res.url;
    a.download = res.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(res.url), 1000);
  };

  return (
    <PdfToolShell
      title="Extract Text & OCR"
      description="Extract native text or run multi-worker Tesseract OCR to export Searchable PDF, TXT, Markdown, Table CSV, HTML, RTF, or JSON."
      currentHref="/tools/pdf/ocr"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => {
        setFile(files[0] || null);
        setExtractedText('');
        setLastPages([]);
      }}
      submitLabel={mode === 'ocr' ? 'Run Local OCR' : 'Extract Text Layer'}
      onRun={async (onProgress, signal) => {
        const t0 = performance.now();
        const engineFormat: 'txt' | 'md' | 'searchable-pdf' =
          outputFormat === 'searchable-pdf' || outputFormat === 'md' ? outputFormat : 'txt';
        const res = await runPdfOcr(
          file!,
          { mode, maxPages, concurrency: 2, outputFormat: engineFormat },
          onProgress,
          signal
        );
        setExtractedText(res.fullText);
        setLastPages(res.pages);

        if (outputFormat === 'searchable-pdf' || outputFormat === 'md') {
          return res.result;
        }
        if (outputFormat === 'json') {
          return buildJsonResult(
            res.pages,
            file!.name,
            Math.max(1, Math.round(performance.now() - t0))
          );
        }
        return formatOcrOutputAs(res.pages, outputFormat, file!.name);
      }}
    >
      <div className="p-5 rounded-2xl border border-line bg-surface grid grid-cols-1 sm:grid-cols-3 gap-4">
        <label className="text-xs text-content-secondary space-y-1">
          <span>Extraction mode</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as 'text-layer' | 'ocr')}
            className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
          >
            <option value="ocr">OCR (for scanned PDFs &amp; images)</option>
            <option value="text-layer">Fast text layer (digital PDFs)</option>
          </select>
        </label>
        <label className="text-xs text-content-secondary space-y-1">
          <span>Output format</span>
          <select
            value={outputFormat}
            onChange={(e) => setOutputFormat(e.target.value as OcrExportFormat)}
            className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
          >
            <option value="searchable-pdf">Searchable PDF (invisible OCR text)</option>
            <option value="txt">Plain Text (.txt)</option>
            <option value="csv">Table-to-CSV (.csv)</option>
            <option value="html">Formatted HTML (.html)</option>
            <option value="rtf">Rich Text (.rtf)</option>
            <option value="xml">OCR Word Coordinates (.xml)</option>
            <option value="json">Structured JSON (.json)</option>
            <option value="md">Markdown (.md)</option>
          </select>
        </label>
        {mode === 'ocr' && (
          <label className="text-xs text-content-secondary space-y-1">
            <span>Max pages to OCR (English model)</span>
            <input
              type="number"
              min={1}
              max={100}
              value={maxPages}
              onChange={(e) => setMaxPages(Math.max(1, Number(e.target.value)))}
              className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
            />
          </label>
        )}
      </div>

      {extractedText && (
        <div className="p-4 rounded-2xl border border-line bg-surface space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-content">Extracted text preview</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {lastPages.length > 0 &&
                file &&
                (['txt', 'csv', 'html', 'rtf', 'xml'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => triggerDownloadResult(formatOcrOutputAs(lastPages, fmt, file.name))}
                    className="px-2.5 py-1 rounded-lg border border-line bg-surface-elevated text-[11px] font-semibold uppercase hover:bg-surface-muted"
                  >
                    .{fmt}
                  </button>
                ))}
              {lastPages.length > 0 && file && (
                <button
                  type="button"
                  onClick={() => triggerDownloadResult(buildJsonResult(lastPages, file.name, 1))}
                  className="px-2.5 py-1 rounded-lg border border-line bg-surface-elevated text-[11px] font-semibold uppercase hover:bg-surface-muted"
                >
                  .json
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(extractedText);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                }}
                className="px-3 py-1 rounded-lg border border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-1"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy text'}</span>
              </button>
            </div>
          </div>
          <textarea
            readOnly
            rows={7}
            value={extractedText}
            className="w-full p-3 rounded-xl border border-line bg-surface-elevated font-mono text-xs text-content"
          />
        </div>
      )}
    </PdfToolShell>
  );
}

type ExtractMode = 'embedded' | 'split-scans' | 'raw-buffers';
type RawCategoryFilter = 'all' | PdfRawBufferEntry['category'];

export function PdfExtractImagesTool() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ExtractMode>('embedded');
  const [images, setImages] = useState<PdfExtractedImage[]>([]);
  const [minAreaRatio, setMinAreaRatio] = useState(0.04);
  const [paddingPx, setPaddingPx] = useState(8);

  const [rawBuffers, setRawBuffers] = useState<PdfRawBufferEntry[]>([]);
  const [rawCategory, setRawCategory] = useState<RawCategoryFilter>('all');
  const [inspectingEntry, setInspectingEntry] = useState<PdfRawBufferEntry | null>(null);
  const [inspectText, setInspectText] = useState<string | null>(null);

  const filteredBuffers = useMemo(
    () =>
      rawCategory === 'all'
        ? rawBuffers
        : rawBuffers.filter((b) => b.category === rawCategory),
    [rawBuffers, rawCategory]
  );

  const inspectBuffer = async (entry: PdfRawBufferEntry) => {
    setInspectingEntry(entry);
    if (entry.mimeType.startsWith('image/')) {
      setInspectText(null);
      return;
    }
    if (
      entry.mimeType.includes('xml') ||
      entry.mimeType.startsWith('text/') ||
      entry.category === 'page-content' ||
      entry.category === 'xmp-metadata'
    ) {
      const txt = await entry.blob.text();
      setInspectText(txt.slice(0, 12000));
      return;
    }
    const buf = new Uint8Array(await entry.blob.slice(0, 256).arrayBuffer());
    const hex = Array.from(buf)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    setInspectText(`Binary stream (${formatBytes(entry.sizeBytes)})\nFirst ${buf.length} bytes (hex):\n${hex}`);
  };

  return (
    <PdfToolShell
      title="Extract images & raw buffers"
      description="Extract embedded XObject images, split multiple photos scanned on a flatbed page, or inspect pure raw PDF streams."
      currentHref="/tools/pdf/extract-images"
      selectedFiles={file ? [file] : []}
      onFilesSelected={(files) => {
        setFile(files[0] || null);
        setImages([]);
        setRawBuffers([]);
        setInspectingEntry(null);
        setInspectText(null);
      }}
      submitLabel={
        mode === 'embedded'
          ? 'Extract All Embedded Images'
          : mode === 'split-scans'
          ? 'Detect & Split Scanned Photos'
          : 'Extract Pure Raw Buffers'
      }
      onRun={async (onProgress, signal) => {
        const t0 = performance.now();
        const stem = sanitizeFilenameStem(file!.name, 'document');

        if (mode === 'raw-buffers') {
          const found = await extractRawPdfBuffers(file!, { signal, onProgress });
          setRawBuffers(found);
          setImages([]);
          const zip = new JSZip();
          found.forEach((entry) => zip.file(`${entry.category}/${entry.fileName}`, entry.blob));
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          return {
            blob: zipBlob,
            url: URL.createObjectURL(zipBlob),
            fileName: `${stem}-raw-buffers.zip`,
            mimeType: 'application/zip',
            sizeBytes: zipBlob.size,
            elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
            summary: `Extracted ${found.length} raw PDF stream(s)`,
          };
        }

        const found =
          mode === 'split-scans'
            ? await splitScannedPagePhotos(file!, { minAreaRatio, paddingPx, signal, onProgress })
            : await extractEmbeddedImagesFromPdf(file!, onProgress, signal);

        setImages(found);
        setRawBuffers([]);
        const zip = new JSZip();
        found.forEach((img) => zip.file(img.fileName, img.blob));
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        return {
          blob: zipBlob,
          url: URL.createObjectURL(zipBlob),
          fileName: mode === 'split-scans' ? `${stem}-split-photos.zip` : `${stem}-images.zip`,
          mimeType: 'application/zip',
          sizeBytes: zipBlob.size,
          elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
          summary:
            mode === 'split-scans'
              ? `Cropped ${found.length} scanned photo(s)`
              : `Extracted ${found.length} embedded image(s)`,
        };
      }}
    >
      <div className="p-5 rounded-2xl border border-line bg-surface space-y-4">
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'embedded' as const, label: 'Embedded XObjects', icon: Images },
            { id: 'split-scans' as const, label: 'Split Scanned Page Photos', icon: Scissors },
            { id: 'raw-buffers' as const, label: 'Pure Raw Buffers', icon: Binary },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMode(tab.id)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border inline-flex items-center gap-1.5 ${
                  mode === tab.id
                    ? 'bg-brand text-white border-brand'
                    : 'bg-surface-elevated text-content border-line'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {mode === 'embedded' && (
          <p className="text-xs text-content-secondary">
            Extracts native DCTDecode JPEGs losslessly and Flate/masked XObjects as PNGs.
          </p>
        )}

        {mode === 'split-scans' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="text-xs text-content-secondary space-y-1">
              <span>Minimum photo area ({Math.round(minAreaRatio * 100)}% of page)</span>
              <input
                type="range"
                min={0.01}
                max={0.25}
                step={0.01}
                value={minAreaRatio}
                onChange={(e) => setMinAreaRatio(Number(e.target.value))}
                className="w-full block"
              />
            </label>
            <label className="text-xs text-content-secondary space-y-1">
              <span>Crop margin padding ({paddingPx}px)</span>
              <input
                type="range"
                min={0}
                max={24}
                step={2}
                value={paddingPx}
                onChange={(e) => setPaddingPx(Number(e.target.value))}
                className="w-full block"
              />
            </label>
          </div>
        )}

        {mode === 'raw-buffers' && (
          <p className="text-xs text-content-secondary">
            Decodes raw Image Streams, pure font programs (.ttf/.otf/.pfb), embedded attachments, XMP XML metadata, and page content streams.
          </p>
        )}
      </div>

      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {images.map((img) => (
            <div key={img.id} className="p-2.5 rounded-xl border border-line bg-surface space-y-2">
              <img src={img.url} alt={img.fileName} className="w-full h-32 object-contain rounded bg-white" />
              <div className="flex items-center justify-between text-[11px] text-content-secondary">
                <span>
                  {img.width}×{img.height} · {img.format.toUpperCase()}
                </span>
                <a
                  href={img.url}
                  download={img.fileName}
                  className="text-brand font-semibold inline-flex items-center gap-0.5"
                >
                  <Download className="w-3 h-3" />
                  <span>Save</span>
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {rawBuffers.length > 0 && (
        <div className="p-4 rounded-2xl border border-line bg-surface space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-content">
              Extracted Raw Buffers ({filteredBuffers.length})
            </span>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'image-stream', label: 'Images' },
                  { id: 'font-program', label: 'Fonts' },
                  { id: 'embedded-file', label: 'Attachments' },
                  { id: 'xmp-metadata', label: 'XMP XML' },
                  { id: 'page-content', label: 'Page Streams' },
                ] as const
              ).map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setRawCategory(cat.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${
                    rawCategory === cat.id
                      ? 'bg-brand text-white border-brand'
                      : 'bg-surface-elevated text-content border-line'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-line rounded-xl border border-line bg-surface-elevated max-h-72 overflow-y-auto">
            {filteredBuffers.map((entry) => (
              <div
                key={entry.id}
                className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-brand/10 text-brand font-mono text-[10px]">
                      {entry.category}
                    </span>
                    <span className="font-semibold text-content truncate">{entry.label}</span>
                  </div>
                  <div className="text-[11px] text-content-secondary font-mono">
                    {entry.fileName} · {entry.mimeType} · {formatBytes(entry.sizeBytes)}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void inspectBuffer(entry)}
                    className="px-2.5 py-1 rounded-lg border border-line bg-surface text-[11px] font-semibold inline-flex items-center gap-1"
                  >
                    <Eye className="w-3 h-3" />
                    <span>Inspect</span>
                  </button>
                  <a
                    href={entry.url}
                    download={entry.fileName}
                    className="px-2.5 py-1 rounded-lg border border-line bg-surface text-brand text-[11px] font-semibold inline-flex items-center gap-1"
                  >
                    <Download className="w-3 h-3" />
                    <span>Save</span>
                  </a>
                </div>
              </div>
            ))}
          </div>

          {inspectingEntry && (
            <div className="p-3.5 rounded-xl border border-brand/30 bg-surface-elevated space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-content">
                <div className="flex items-center gap-1.5">
                  <FileCode2 className="w-4 h-4 text-brand" />
                  <span>{inspectingEntry.fileName}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setInspectingEntry(null);
                    setInspectText(null);
                  }}
                  aria-label="Close buffer inspector"
                  className="p-1 rounded border border-line bg-surface"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {inspectingEntry.mimeType.startsWith('image/') ? (
                <img
                  src={inspectingEntry.url}
                  alt={inspectingEntry.fileName}
                  className="max-h-64 rounded bg-white border border-line object-contain"
                />
              ) : (
                <pre className="p-3 rounded-lg border border-line bg-surface text-[11px] font-mono text-content max-h-60 overflow-auto whitespace-pre-wrap break-all">
                  {inspectText}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </PdfToolShell>
  );
}

type BatchOp =
  | 'compress'
  | 'split'
  | 'pdf-to-image'
  | 'pdf-to-word'
  | 'auto-rotate'
  | 'remove-blank'
  | 'ocr'
  | 'rotate'
  | 'protect'
  | 'unlock'
  | 'metadata'
  | 'sanitize'
  | 'remove-annotations'
  | 'flatten'
  | 'extract-text'
  | 'watermark'
  | 'page-numbers'
  | 'repair';

const PIPELINE_STEPS: Array<{ id: BatchOp; label: string; chainsToPdf: boolean }> = [
  { id: 'auto-rotate', label: 'Auto-Rotate Upright', chainsToPdf: true },
  { id: 'remove-blank', label: 'Remove Blank Pages', chainsToPdf: true },
  { id: 'ocr', label: 'OCR Searchable PDF', chainsToPdf: true },
  { id: 'metadata', label: 'Strip Metadata', chainsToPdf: true },
  { id: 'remove-annotations', label: 'Remove Comments', chainsToPdf: true },
  { id: 'sanitize', label: 'Deep Sanitize', chainsToPdf: true },
  { id: 'flatten', label: 'Flatten Forms', chainsToPdf: true },
  { id: 'rotate', label: 'Rotate All Pages', chainsToPdf: true },
  { id: 'watermark', label: 'Add Watermark', chainsToPdf: true },
  { id: 'page-numbers', label: 'Add Page Numbers', chainsToPdf: true },
  { id: 'compress', label: 'Compress PDF', chainsToPdf: true },
  { id: 'repair', label: 'Repair PDF', chainsToPdf: true },
  { id: 'protect', label: 'Protect (AES-256)', chainsToPdf: true },
  { id: 'unlock', label: 'Unlock PDF', chainsToPdf: true },
  { id: 'split', label: 'Split (1 page/file)', chainsToPdf: false },
  { id: 'pdf-to-image', label: 'PDF to Image (JPG)', chainsToPdf: false },
  { id: 'pdf-to-word', label: 'PDF to Word (.docx)', chainsToPdf: false },
  { id: 'extract-text', label: 'Extract Text (.txt)', chainsToPdf: false },
];

const BATCH_PRESETS: Array<{ label: string; steps: BatchOp[] }> = [
  { label: 'Scan Cleanup Stack', steps: ['auto-rotate', 'remove-blank', 'ocr', 'compress', 'metadata'] },
  { label: 'Redaction & Share Guard', steps: ['remove-annotations', 'sanitize', 'metadata', 'compress'] },
  { label: 'Legal Stamped Archive', steps: ['page-numbers', 'watermark', 'flatten', 'protect'] },
];

/**
 * iLovePDF / Stirling PDF Benchmark: Multi-Step Pipeline Chaining, Pre-Checks & Folder Batching
 */
export function PdfBatchTool() {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [pipeline, setPipeline] = useState<BatchOp[]>(['compress']);
  const [watermarkText, setWatermarkText] = useState('CONFIDENTIAL');
  const [password, setPassword] = useState('');
  const [rotation, setRotation] = useState(90);
  const [skipCompressUnderMb, setSkipCompressUnderMb] = useState(0);
  const [skipOcrIfText, setSkipOcrIfText] = useState(true);
  const [minPagesForSplit, setMinPagesForSplit] = useState(2);
  const [presetNotice, setPresetNotice] = useState<string | null>(null);

  const needsPassword = pipeline.includes('protect') || pipeline.includes('unlock');

  const handleFolderPick = async () => {
    const win = window as unknown as {
      showDirectoryPicker?: () => Promise<{ values: () => AsyncIterable<{ kind: string; name: string; getFile?: () => Promise<File> }> }>;
    };
    if (typeof win.showDirectoryPicker === 'function') {
      try {
        const dir = await win.showDirectoryPicker();
        const picked: File[] = [];
        for await (const entry of dir.values()) {
          if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.pdf') && entry.getFile) {
            picked.push(await entry.getFile());
          }
        }
        if (picked.length > 0) setFiles((prev) => [...prev, ...picked]);
        return;
      } catch {
        // User cancelled or fallback to directory input
      }
    }
    folderInputRef.current?.click();
  };

  const exportPipelineJson = () => {
    const blob = new Blob(
      [JSON.stringify({ version: 1, pipeline, watermarkText, rotation, skipCompressUnderMb, skipOcrIfText, minPagesForSplit }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `muxaro-pipeline-${pipeline.slice(0, 3).join('-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importPipelineJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text()) as {
        pipeline?: BatchOp[];
        watermarkText?: string;
        rotation?: number;
        skipCompressUnderMb?: number;
        skipOcrIfText?: boolean;
        minPagesForSplit?: number;
      };
      const validIds = new Set(PIPELINE_STEPS.map((s) => s.id));
      if (Array.isArray(data.pipeline)) {
        const cleaned = data.pipeline.filter((s) => validIds.has(s));
        if (cleaned.length > 0) setPipeline(cleaned);
      }
      if (typeof data.watermarkText === 'string') setWatermarkText(data.watermarkText);
      if (typeof data.rotation === 'number') setRotation(data.rotation);
      if (typeof data.skipCompressUnderMb === 'number') setSkipCompressUnderMb(data.skipCompressUnderMb);
      if (typeof data.skipOcrIfText === 'boolean') setSkipOcrIfText(data.skipOcrIfText);
      if (typeof data.minPagesForSplit === 'number') setMinPagesForSplit(data.minPagesForSplit);
      setPresetNotice(`Loaded preset from ${f.name}`);
    } catch {
      setPresetNotice('Invalid pipeline JSON file.');
    } finally {
      e.target.value = '';
    }
  };

  const applySingleOp = async (
    f: File,
    op: BatchOp,
    signal?: AbortSignal
  ): Promise<{ file: File; terminal?: { name: string; blob: Blob } }> => {
    const stem = sanitizeFilenameStem(f.name, 'doc');
    const wrapPdf = (blob: Blob, name: string) =>
      new File([blob], name, { type: 'application/pdf' });

    if (op === 'auto-rotate') {
      const r = await autoRotatePdf(f);
      return { file: wrapPdf(r.blob, `${stem}.pdf`) };
    }
    if (op === 'remove-blank') {
      const scan = await detectBlankPages(f, 0.0005, undefined, signal);
      if (scan.blankPages.length === 0 || scan.blankPages.length >= scan.pageDetails.length) {
        return { file: f };
      }
      const r = await removeBlankPagesFromPdf(f, scan.blankPages, undefined, signal);
      return { file: wrapPdf(r.blob, `${stem}.pdf`) };
    }
    if (op === 'ocr') {
      if (skipOcrIfText) {
        const textCheck = await extractAllSelectableText(f);
        if (textCheck.fullText.trim().length > 80) return { file: f };
      }
      const r = await runPdfOcr(f, { mode: 'ocr', maxPages: 25, outputFormat: 'searchable-pdf' }, undefined, signal);
      return { file: wrapPdf(r.result.blob, `${stem}.pdf`) };
    }
    if (op === 'compress') {
      if (skipCompressUnderMb > 0 && f.size < skipCompressUnderMb * 1024 * 1024) {
        return { file: f };
      }
      const r = await compressPdfSmart(f, { mode: 'balanced', quality: 0.76, targetDpi: 144 }, undefined, signal);
      return { file: wrapPdf(r.blob, `${stem}.pdf`) };
    }
    if (op === 'rotate') {
      const r = await rotatePdfByOrientation(f, rotation, 'all', { signal });
      return { file: wrapPdf(r.blob, `${stem}.pdf`) };
    }
    if (op === 'protect') {
      const bytes = await protectPdfWithQpdf(new Uint8Array(await f.arrayBuffer()), { userPassword: password });
      return { file: wrapPdf(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), `${stem}.pdf`) };
    }
    if (op === 'unlock') {
      const bytes = await unlockPdfWithQpdf(new Uint8Array(await f.arrayBuffer()), password);
      return { file: wrapPdf(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), `${stem}.pdf`) };
    }
    if (op === 'metadata') {
      const r = await removePdfMetadata(f);
      return { file: wrapPdf(r.blob, `${stem}.pdf`) };
    }
    if (op === 'remove-annotations') {
      const r = await removePdfAnnotations(f, true);
      return { file: wrapPdf(r.blob, `${stem}.pdf`) };
    }
    if (op === 'sanitize') {
      const r = await sanitizePdfDeep(f, undefined, undefined, signal);
      return { file: wrapPdf(r.blob, `${stem}.pdf`) };
    }
    if (op === 'flatten') {
      const r = await flattenPdf(f, 'structural');
      return { file: wrapPdf(r.blob, `${stem}.pdf`) };
    }
    if (op === 'watermark') {
      const r = await addWatermarkToPdf(f, {
        text: watermarkText,
        fontSize: 44,
        opacity: 0.25,
        rotation: -45,
        color: '#5562F0',
        layout: 'center',
      });
      return { file: wrapPdf(r.blob, `${stem}.pdf`) };
    }
    if (op === 'page-numbers') {
      const r = await addPageNumbersToPdf(f, {
        format: 'Page {n} of {total}',
        position: 'bottom-center',
        fontSize: 10,
        startNumber: 1,
        marginPt: 22,
        color: '#222226',
      });
      return { file: wrapPdf(r.blob, `${stem}.pdf`) };
    }
    if (op === 'repair') {
      const r = await repairPdfMultiEngine(f);
      return { file: wrapPdf(r.blob, `${stem}.pdf`) };
    }
    if (op === 'split') {
      if (minPagesForSplit > 1) {
        const infos = await getPdfPageInfos(f);
        if (infos.length < minPagesForSplit) {
          return { file: f, terminal: { name: `${stem}.pdf`, blob: f } };
        }
      }
      const r = await splitPdf(f, { mode: 'pages-per-file', pagesPerFile: 1 }, undefined, signal);
      return { file: f, terminal: { name: `${stem}-split.zip`, blob: r.blob } };
    }
    if (op === 'pdf-to-image') {
      const r = await pdfToImagesZip(f, { format: 'jpeg', dpi: 150, quality: 0.88 }, undefined, signal);
      return { file: f, terminal: { name: r.fileName, blob: r.blob } };
    }
    if (op === 'pdf-to-word') {
      const r = await pdfToDocxRich(f, undefined, signal);
      return { file: f, terminal: { name: `${stem}.docx`, blob: r.blob } };
    }
    const res = await extractAllSelectableText(f);
    return {
      file: f,
      terminal: { name: `${stem}.txt`, blob: new Blob([res.fullText], { type: 'text/plain' }) },
    };
  };

  return (
    <PdfToolShell
      title="Batch PDF processing & workflows"
      description="Multi-step pipeline automation with Pre-Checks, Folder ingestion, and reusable JSON workflow presets."
      currentHref="/tools/pdf/batch"
      multiple
      selectedFiles={files}
      onFilesSelected={(next) => setFiles((prev) => [...prev, ...next])}
      submitLabel={`Run ${pipeline.length}-Step Pipeline on ${files.length} File(s)`}
      canSubmit={
        files.length > 0 &&
        pipeline.length > 0 &&
        (!needsPassword || password.length >= (pipeline.includes('protect') ? 4 : 1))
      }
      onRun={async (onProgress, signal): Promise<PdfProcessResult> => {
        const t0 = performance.now();
        const zip = new JSZip();
        const usedNames = new Set<string>();
        const uniqueZipName = (desired: string) => {
          if (!usedNames.has(desired)) {
            usedNames.add(desired);
            return desired;
          }
          const dot = desired.lastIndexOf('.');
          const stem = dot > 0 ? desired.slice(0, dot) : desired;
          const ext = dot > 0 ? desired.slice(dot) : '';
          let idx = 2;
          while (usedNames.has(`${stem}-${idx}${ext}`)) idx += 1;
          const next = `${stem}-${idx}${ext}`;
          usedNames.add(next);
          return next;
        };
        const failures: string[] = [];
        let completed = 0;

        const runFile = async (origFile: File) => {
          const stem = sanitizeFilenameStem(origFile.name, 'doc');
          try {
            let currentFile = origFile;
            let finalOut: { name: string; blob: Blob } | null = null;
            for (const step of pipeline) {
              if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
              const out = await applySingleOp(currentFile, step, signal);
              if (out.terminal) {
                finalOut = out.terminal;
                break;
              }
              currentFile = out.file;
            }
            if (finalOut) {
              zip.file(uniqueZipName(finalOut.name), finalOut.blob);
            } else {
              zip.file(uniqueZipName(`${stem}-processed.pdf`), currentFile);
            }
          } catch (err) {
            if ((err as Error)?.name === 'AbortError') throw err;
            failures.push(`${origFile.name}: ${err instanceof Error ? err.message : 'Failed'}`);
          } finally {
            completed += 1;
            onProgress(Math.round((completed / files.length) * 92), `Processed ${completed}/${files.length}`);
          }
        };

        const queue = [...files];
        await Promise.all(
          Array.from({ length: Math.min(2, queue.length) }, async () => {
            while (queue.length > 0) {
              if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
              const next = queue.shift();
              if (next) await runFile(next);
            }
          })
        );

        if (failures.length === files.length) {
          throw new Error(`All ${files.length} files failed:\n${failures.join('\n')}`);
        }
        if (failures.length > 0) zip.file('failures.txt', failures.join('\n'));
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        onProgress(100, 'Batch ZIP ready');
        return {
          blob: zipBlob,
          url: URL.createObjectURL(zipBlob),
          fileName: `muxaro-pipeline-${pipeline.join('-')}.zip`,
          mimeType: 'application/zip',
          sizeBytes: zipBlob.size,
          elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
          summary: `${files.length - failures.length}/${files.length} files completed (${pipeline.length} step pipeline)`,
          warnings: failures.length > 0 ? [`${failures.length} file(s) logged in failures.txt`] : undefined,
        };
      }}
    >
      <div className="p-5 rounded-2xl border border-line bg-surface space-y-4">
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          // @ts-expect-error non-standard folder selection fallback
          webkitdirectory=""
          onChange={(e) => {
            const pdfs = Array.from(e.target.files || []).filter((f) =>
              f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf'
            );
            if (pdfs.length > 0) setFiles((prev) => [...prev, ...pdfs]);
            e.target.value = '';
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-line">
          <div className="flex flex-wrap items-center gap-1.5">
            {BATCH_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setPipeline(preset.steps);
                  setPresetNotice(`Applied "${preset.label}"`);
                }}
                className="px-2.5 py-1 rounded-lg border border-line bg-surface-elevated hover:border-brand text-[11px] font-semibold"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleFolderPick()}
              className="px-2.5 py-1 rounded-lg border border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-1"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Add Folder</span>
            </button>
            <button
              type="button"
              onClick={exportPipelineJson}
              className="px-2.5 py-1 rounded-lg border border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Recipe JSON</span>
            </button>
            <label className="px-2.5 py-1 rounded-lg border border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-1 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>Load JSON</span>
              <input type="file" accept=".json,application/json" className="sr-only" onChange={importPipelineJson} />
            </label>
          </div>
        </div>
        {presetNotice && <div className="text-[11px] text-brand font-medium">{presetNotice}</div>}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-content">Pipeline Steps (executed in order)</span>
            <button
              type="button"
              onClick={() => setPipeline((p) => [...p, 'compress'])}
              className="px-2.5 py-1 rounded-lg border border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add step</span>
            </button>
          </div>
          <div className="space-y-2">
            {pipeline.map((step, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="text-xs font-mono text-content-secondary w-6">{idx + 1}.</span>
                <select
                  value={step}
                  onChange={(e) =>
                    setPipeline((prev) =>
                      prev.map((s, i) => (i === idx ? (e.target.value as BatchOp) : s))
                    )
                  }
                  className="flex-1 px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
                >
                  {PIPELINE_STEPS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={pipeline.length <= 1}
                  onClick={() => setPipeline((prev) => prev.filter((_, i) => i !== idx))}
                  className="p-1.5 text-error disabled:opacity-30"
                  aria-label="Remove step"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {pipeline.includes('watermark') && (
            <label className="text-xs text-content-secondary space-y-1">
              <span>Watermark text</span>
              <input
                type="text"
                value={watermarkText}
                onChange={(e) => setWatermarkText(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
              />
            </label>
          )}
          {needsPassword && (
            <label className="text-xs text-content-secondary space-y-1">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
              />
            </label>
          )}
          {pipeline.includes('rotate') && (
            <label className="text-xs text-content-secondary space-y-1">
              <span>Rotation angle</span>
              <select
                value={rotation}
                onChange={(e) => setRotation(Number(e.target.value))}
                className="w-full px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
              >
                <option value={90}>90° clockwise</option>
                <option value={180}>180°</option>
                <option value={270}>270°</option>
              </select>
            </label>
          )}
          {pipeline.includes('compress') && (
            <label className="text-xs text-content-secondary space-y-1">
              <span>Pre-check: skip if &lt; MB</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={skipCompressUnderMb}
                onChange={(e) => setSkipCompressUnderMb(Math.max(0, Number(e.target.value)))}
                className="w-full px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
              />
            </label>
          )}
          {pipeline.includes('ocr') && (
            <label className="inline-flex items-center gap-2 text-xs text-content pt-5">
              <input
                type="checkbox"
                checked={skipOcrIfText}
                onChange={(e) => setSkipOcrIfText(e.target.checked)}
              />
              <span>Pre-check: skip OCR if selectable text exists</span>
            </label>
          )}
          {pipeline.includes('split') && (
            <label className="text-xs text-content-secondary space-y-1">
              <span>Pre-check: only split if ≥ pages</span>
              <input
                type="number"
                min={1}
                value={minPagesForSplit}
                onChange={(e) => setMinPagesForSplit(Math.max(1, Number(e.target.value)))}
                className="w-full px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
              />
            </label>
          )}
        </div>

        {files.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-line">
            {files.map((f, idx) => (
              <div
                key={`${f.name}-${idx}`}
                className="px-3 py-2 rounded-xl border border-line bg-surface-elevated flex items-center justify-between text-xs"
              >
                <span className="truncate font-medium text-content">
                  {idx + 1}. {f.name} ({formatBytes(f.size)})
                </span>
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                  className="text-error ml-2"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </PdfToolShell>
  );
}
