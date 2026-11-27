import { createStudioError, type StudioErrorCode } from '../studio-errors.ts';

export type ImageSignatureFormat =
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'gif'
  | 'bmp'
  | 'tiff'
  | 'svg'
  | 'heic'
  | 'empty'
  | 'unknown';

export type ImageIngestState =
  | 'pending'
  | 'validating'
  | 'decoding'
  | 'normalizing'
  | 'ready'
  | 'processing'
  | 'failed'
  | 'removed';

export interface ImageIngestionRecord {
  id: string;
  orderIndex: number;
  originalFile: File;
  displayName: string;
  sizeBytes: number;
  detectedFormat: ImageSignatureFormat;
  state: ImageIngestState;
  width?: number;
  height?: number;
  estimatedMemoryMb?: number;
  thumbnailUrl?: string;
  normalizedFile?: File;
  errorCode?: StudioErrorCode;
  errorMessage?: string;
  suggestedAction?: string;
}

/**
 * Inspects file header magic bytes rather than trusting filename extension or File.type.
 */
export function detectImageSignatureFromBytes(bytes: Uint8Array, fileName = ''): ImageSignatureFormat {
  if (!bytes || bytes.length === 0) return 'empty';

  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  // GIF: GIF87a / GIF89a
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return 'gif';
  }
  // WEBP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }
  // BMP: BM
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'bmp';
  }
  // TIFF: II*\0 or MM\0*
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))
  ) {
    return 'tiff';
  }
  // ISO BMFF / HEIC / HEIF / AVIF: ....ftyp<brand>
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase();
    if (
      brand === 'heic' ||
      brand === 'heix' ||
      brand === 'hevc' ||
      brand === 'hevx' ||
      brand === 'mif1' ||
      brand === 'msf1'
    ) {
      return 'heic';
    }
  }
  // SVG XML text check
  const headText = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 256))).trimStart();
  if (/^<\?xml|^<svg[\s>]/i.test(headText) || (/\.svg$/i.test(fileName) && headText.includes('<svg'))) {
    return 'svg';
  }

  return 'unknown';
}

export function isFormatNativelyDecodable(fmt: ImageSignatureFormat): boolean {
  return fmt === 'jpeg' || fmt === 'png' || fmt === 'webp' || fmt === 'gif' || fmt === 'bmp' || fmt === 'svg';
}

export function mimeForSignature(fmt: ImageSignatureFormat): string {
  switch (fmt) {
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'bmp':
      return 'image/bmp';
    case 'tiff':
      return 'image/tiff';
    case 'svg':
      return 'image/svg+xml';
    case 'heic':
      return 'image/heic';
    default:
      return 'application/octet-stream';
  }
}

export function validateBatchOrder<T extends { orderIndex: number; state: ImageIngestState }>(
  records: T[]
): T[] {
  return records
    .filter((r) => r.state !== 'removed')
    .sort((a, b) => a.orderIndex - b.orderIndex);
}

async function readHeadBytes(file: File, len = 512): Promise<Uint8Array> {
  const slice = file.slice(0, Math.min(file.size, len));
  return new Uint8Array(await slice.arrayBuffer());
}

/**
 * Multi-tier resilient bitmap decoder:
 * 1. Tries createImageBitmap with EXIF 'from-image' orientation.
 * 2. Falls back to createImageBitmap without options (older WebViews).
 * 3. Falls back to <img> element decode onto canvas.
 */
export async function decodeImageFileResilient(
  file: File,
  detectedFormat: ImageSignatureFormat
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number; cleanup: () => void }> {
  const typedBlob = new Blob([file], { type: mimeForSignature(detectedFormat) });

  if (detectedFormat === 'svg') {
    const svgText = await file.text();
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('SVG element failed to decode'));
        el.src = url;
      });
      const w = Math.max(120, img.naturalWidth || 1200);
      const h = Math.max(120, img.naturalHeight || 900);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.drawImage(img, 0, 0, w, h);
      return {
        canvas: c,
        width: w,
        height: h,
        cleanup: () => {
          c.width = 0;
          c.height = 0;
        },
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  let bmp: ImageBitmap | null = null;
  if (typeof createImageBitmap === 'function') {
    try {
      bmp = await createImageBitmap(typedBlob, { imageOrientation: 'from-image' });
    } catch {
      try {
        bmp = await createImageBitmap(typedBlob);
      } catch {
        bmp = null;
      }
    }
  }

  if (bmp) {
    try {
      const maxDim = 2600;
      const scale = Math.min(1, maxDim / Math.max(1, Math.max(bmp.width, bmp.height)));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      if (detectedFormat === 'jpeg' || detectedFormat === 'bmp') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(bmp, 0, 0, w, h);
      return {
        canvas: c,
        width: w,
        height: h,
        cleanup: () => {
          c.width = 0;
          c.height = 0;
        },
      };
    } finally {
      bmp.close();
    }
  }

  // Fallback via HTMLImageElement (handles WebP / baseline JPEGs rejected by createImageBitmap in some WebViews)
  const objUrl = URL.createObjectURL(typedBlob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Unable to decode ${file.name}`));
      el.src = objUrl;
    });
    const maxDim = 2600;
    const nw = Math.max(1, img.naturalWidth);
    const nh = Math.max(1, img.naturalHeight);
    const scale = Math.min(1, maxDim / Math.max(nw, nh));
    const w = Math.max(1, Math.round(nw * scale));
    const h = Math.max(1, Math.round(nh * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(img, 0, 0, w, h);
    return {
      canvas: c,
      width: w,
      height: h,
      cleanup: () => {
        c.width = 0;
        c.height = 0;
      },
    };
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

function makeThumbnailDataUrl(srcCanvas: HTMLCanvasElement, maxThumbEdge = 280): string {
  const scale = Math.min(1, maxThumbEdge / Math.max(1, Math.max(srcCanvas.width, srcCanvas.height)));
  const tw = Math.max(1, Math.round(srcCanvas.width * scale));
  const th = Math.max(1, Math.round(srcCanvas.height * scale));
  const tCanvas = document.createElement('canvas');
  tCanvas.width = tw;
  tCanvas.height = th;
  const tCtx = tCanvas.getContext('2d');
  if (!tCtx) return '';
  tCtx.drawImage(srcCanvas, 0, 0, tw, th);
  const url = tCanvas.toDataURL('image/jpeg', 0.8);
  tCanvas.width = 0;
  tCanvas.height = 0;
  return url;
}

/**
 * Normalizes and validates one single image item independently without failing siblings.
 */
export async function processSingleImageRecord(
  record: ImageIngestionRecord,
  onProgress?: (updated: ImageIngestionRecord) => void
): Promise<ImageIngestionRecord> {
  const emit = (patch: Partial<ImageIngestionRecord>): ImageIngestionRecord => {
    const next = { ...record, ...patch };
    Object.assign(record, next);
    onProgress?.(next);
    return next;
  };

  try {
    emit({ state: 'validating', errorCode: undefined, errorMessage: undefined, suggestedAction: undefined });

    if (record.originalFile.size === 0) {
      const err = createStudioError('IMAGE_DECODE_FAILED', 'image_ingest', {
        inputRef: record.displayName,
        message: `"${record.displayName}" is 0 bytes (empty file).`,
        suggestedAction: 'Replace this file with a valid image or remove it.',
      });
      return emit({
        state: 'failed',
        detectedFormat: 'empty',
        errorCode: err.details.code,
        errorMessage: err.details.message,
        suggestedAction: err.details.suggestedAction,
      });
    }

    const head = await readHeadBytes(record.originalFile);
    const sig = detectImageSignatureFromBytes(head, record.displayName);

    if (sig === 'heic') {
      const err = createStudioError('IMAGE_UNSUPPORTED_FORMAT', 'image_ingest', {
        inputRef: record.displayName,
        message: `"${record.displayName}" uses Apple HEIC/HEIF encoding, which cannot be decoded offline in this runtime.`,
        suggestedAction: 'Convert to JPEG or PNG (on iPhone Camera Settings -> Most Compatible) or replace this item.',
      });
      return emit({
        state: 'failed',
        detectedFormat: sig,
        errorCode: err.details.code,
        errorMessage: err.details.message,
        suggestedAction: err.details.suggestedAction,
      });
    }

    if (sig === 'tiff') {
      const err = createStudioError('IMAGE_UNSUPPORTED_FORMAT', 'image_ingest', {
        inputRef: record.displayName,
        message: `"${record.displayName}" is a TIFF file not natively decoded by this WebView.`,
        suggestedAction: 'Export as PNG or JPEG, or replace this file.',
      });
      return emit({
        state: 'failed',
        detectedFormat: sig,
        errorCode: err.details.code,
        errorMessage: err.details.message,
        suggestedAction: err.details.suggestedAction,
      });
    }

    if (!isFormatNativelyDecodable(sig)) {
      const err = createStudioError('IMAGE_DECODE_FAILED', 'image_ingest', {
        inputRef: record.displayName,
        message: `"${record.displayName}" has an unrecognized or damaged image header.`,
        suggestedAction: 'Check that the file is a valid JPEG, PNG, or WebP photo or remove it.',
      });
      return emit({
        state: 'failed',
        detectedFormat: sig,
        errorCode: err.details.code,
        errorMessage: err.details.message,
        suggestedAction: err.details.suggestedAction,
      });
    }

    emit({ state: 'decoding', detectedFormat: sig });
    const decoded = await decodeImageFileResilient(record.originalFile, sig);
    try {
      emit({ state: 'normalizing', width: decoded.width, height: decoded.height });
      const keepPng = sig === 'png' || sig === 'svg' || sig === 'webp';
      const outMime = keepPng ? 'image/png' : 'image/jpeg';
      const outExt = keepPng ? 'png' : 'jpg';
      const normalizedBlob = await new Promise<Blob | null>((resolve) =>
        decoded.canvas.toBlob(resolve, outMime, 0.92)
      );
      if (!normalizedBlob || normalizedBlob.size === 0) {
        throw new Error(`Encoding ${record.displayName} returned an empty buffer.`);
      }

      const stem = record.displayName.replace(/\.[^.]+$/, '') || 'page';
      const normalizedFile = new File([normalizedBlob], `${stem}.${outExt}`, {
        type: outMime,
        lastModified: record.originalFile.lastModified || Date.now(),
      });
      const thumbnailUrl = makeThumbnailDataUrl(decoded.canvas);
      const estimatedMemoryMb = Math.round(((decoded.width * decoded.height * 4) / (1024 * 1024)) * 10) / 10;

      return emit({
        state: 'ready',
        width: decoded.width,
        height: decoded.height,
        estimatedMemoryMb,
        thumbnailUrl,
        normalizedFile,
        errorCode: undefined,
        errorMessage: undefined,
        suggestedAction: undefined,
      });
    } finally {
      decoded.cleanup();
    }
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : `Failed to decode "${record.displayName}".`;
    return emit({
      state: 'failed',
      errorCode: 'IMAGE_DECODE_FAILED',
      errorMessage: `"${record.displayName}" could not be decoded (${message}).`,
      suggestedAction: 'Retry, replace with a JPEG/PNG image, or remove this item.',
    });
  }
}

/**
 * Processes an ordered batch with bounded concurrency (2 workers on mobile, 3 on desktop)
 * so 20-50 high-res camera images never crash device memory and invalid files isolate cleanly.
 */
export async function ingestImageBatch(
  files: File[],
  startingOrderIndex = 0,
  onUpdate?: (records: ImageIngestionRecord[]) => void,
  concurrency = 2
): Promise<ImageIngestionRecord[]> {
  const initial: ImageIngestionRecord[] = files.map((file, i) => ({
    id: `img-${Date.now()}-${startingOrderIndex + i}-${Math.random().toString(36).slice(2, 6)}`,
    orderIndex: startingOrderIndex + i,
    originalFile: file,
    displayName: file.name || `image-${startingOrderIndex + i + 1}`,
    sizeBytes: file.size,
    detectedFormat: 'unknown',
    state: 'pending',
  }));

  onUpdate?.([...initial]);
  let cursor = 0;

  async function worker() {
    while (cursor < initial.length) {
      const idx = cursor++;
      await processSingleImageRecord(initial[idx], () => {
        onUpdate?.([...initial]);
      });
    }
  }

  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), initial.length) }, () => worker());
  await Promise.all(workers);
  return validateBatchOrder(initial);
}
