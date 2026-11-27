import { PDFDocument } from 'pdf-lib';
import { getPageTextSpans, loadPdfJsDocument, renderPdfPageToCanvas } from '@/lib/pdf/pdf-browser';
import { sanitizeFilenameStem } from '@/lib/pdf/errors';
import { sanitizePdfDeep } from '@/lib/pdf/pdf-document';
import { purgeOrphanObjectsWithQpdf } from '@/lib/pdf/qpdf-browser';
import type { PdfProcessResult } from '@/lib/pdf/types';
import type { NormalizedRect, PiiCategory, PiiFinding } from './types';

function luhnValid(digitsOnly: string): boolean {
  if (digitsOnly.length < 13 || digitsOnly.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digitsOnly.length - 1; i >= 0; i -= 1) {
    let n = digitsOnly.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (dbl) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

function ibanValid(raw: string): boolean {
  const clean = raw.replace(/\s+/g, '').toUpperCase();
  if (clean.length < 15 || clean.length > 34) return false;
  const rearranged = clean.slice(4) + clean.slice(0, 4);
  let mod = 0;
  for (let i = 0; i < rearranged.length; i += 1) {
    const code = rearranged.charCodeAt(i);
    const val = code >= 65 && code <= 90 ? String(code - 55) : rearranged[i];
    for (let j = 0; j < val.length; j += 1) {
      mod = (mod * 10 + (val.charCodeAt(j) - 48)) % 97;
    }
  }
  return mod === 1;
}

function maskPreview(raw: string): string {
  const clean = raw.trim();
  if (clean.length <= 4) return '••••';
  return `${clean.slice(0, 2)}${'•'.repeat(Math.min(8, Math.max(2, clean.length - 4)))}${clean.slice(-2)}`;
}

interface PatternSpec {
  category: PiiCategory;
  severity: 'high' | 'medium';
  regex: RegExp;
  validate?: (m: string, fullLine: string) => boolean;
}

const PII_PATTERNS: PatternSpec[] = [
  {
    category: 'Email Address',
    severity: 'high',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    category: 'Credit / Debit Card',
    severity: 'high',
    regex: /\b(?:\d[ -]*?){13,19}\b/g,
    validate: (m) => luhnValid(m.replace(/\D+/g, '')),
  },
  {
    category: 'IBAN',
    severity: 'high',
    regex: /\b[A-Z]{2}\d{2}[A-Z0-9\s]{11,30}\b/g,
    validate: (m) => ibanValid(m),
  },
  {
    category: 'US SSN',
    severity: 'high',
    regex: /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
  },
  {
    category: 'India Aadhaar',
    severity: 'high',
    regex: /\b[2-9]\d{3}[\s-]\d{4}[\s-]\d{4}\b/g,
  },
  {
    category: 'India PAN',
    severity: 'high',
    regex: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
  },
  {
    category: 'JWT Token',
    severity: 'high',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\b/g,
  },
  {
    category: 'API Key / Secret',
    severity: 'high',
    regex: /\b(?:sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|ghp_[A-Za-z0-9]{30,})\b/g,
  },
  {
    category: 'Phone Number',
    severity: 'medium',
    regex: /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g,
    validate: (m) => m.replace(/\D+/g, '').length >= 10,
  },
  {
    category: 'IPv4 Address',
    severity: 'medium',
    regex: /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)){3}\b/g,
  },
  {
    category: 'MAC Address',
    severity: 'medium',
    regex: /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g,
  },
  {
    category: 'Date of Birth',
    severity: 'medium',
    regex: /\b(?:\d{2}[/-]\d{2}[/-](?:19|20)\d{2}|(?:19|20)\d{2}[/-]\d{2}[/-]\d{2})\b/g,
    validate: (_m, line) => /\b(dob|birth|born|age)\b/i.test(line),
  },
  {
    category: 'Passport / Tax ID',
    severity: 'high',
    regex: /\b(?:TIN|EIN|ITIN|Passport)[:\s#-]*([A-Z0-9-]{6,15})\b/gi,
  },
];

export async function scanPdfForPii(file: File): Promise<PiiFinding[]> {
  const pdf = await loadPdfJsDocument(file);
  const pageCount = pdf.numPages;

  const findings: PiiFinding[] = [];
  const seen = new Set<string>();
  let seq = 0;

  try {
    for (let pageNo = 1; pageNo <= pageCount; pageNo += 1) {
      const spans = await getPageTextSpans(pdf, pageNo);
    for (const sp of spans) {
      const text = sp.text;
      if (!text.trim()) continue;
      for (const spec of PII_PATTERNS) {
        spec.regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = spec.regex.exec(text)) !== null) {
          const rawMatch = match[0];
          if (spec.validate && !spec.validate(rawMatch, text)) continue;
          const len = Math.max(1, text.length);
          const startRatio = match.index / len;
          const endRatio = Math.min(1, (match.index + rawMatch.length) / len);
          const rect: NormalizedRect = {
            x: sp.x + startRatio * sp.width,
            y: sp.y,
            width: Math.max(0.012, (endRatio - startRatio) * sp.width),
            height: sp.height,
          };
          const dedupKey = `${pageNo}:${spec.category}:${rawMatch}:${Math.round(rect.x * 100)}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          findings.push({
            id: `pii-${pageNo}-${seq++}`,
            category: spec.category,
            severity: spec.severity,
            maskedPreview: maskPreview(rawMatch),
            rawMatch,
            pageNumber: pageNo,
            rect,
            selected: true,
          });
        }
      }
    }
  }
  } finally {
    await pdf.destroy().catch(() => {});
  }

  return findings;
}

/**
 * Pre-Flight PII Firewall: Masks sensitive entities before sending any prompt
 * to optional Cloud BYOK endpoints and restores them locally upon completion.
 */
export function maskPromptWithPiiMap(input: string): {
  sanitizedText: string;
  tokenMap: Record<string, string>;
} {
  let sanitized = input;
  const tokenMap: Record<string, string> = {};
  let counter = 1;

  for (const spec of PII_PATTERNS) {
    spec.regex.lastIndex = 0;
    sanitized = sanitized.replace(spec.regex, (matched) => {
      if (spec.validate && !spec.validate(matched, input)) return matched;
      const tag = `[${spec.category.replace(/[^A-Z0-9]+/gi, '_').toUpperCase()}_${counter++}]`;
      tokenMap[tag] = matched;
      return tag;
    });
  }
  return { sanitizedText: sanitized, tokenMap };
}

export function unmaskResponseWithPiiMap(response: string, tokenMap: Record<string, string>): string {
  let out = response;
  for (const [tag, realVal] of Object.entries(tokenMap)) {
    out = out.split(tag).join(realVal);
  }
  return out;
}

/**
 * Guarantees destructive irreversible PII redaction (unlike cosmetic black boxes):
 * Any page with confirmed PII hits is rendered at high resolution, permanently punched
 * with opaque black bars in pixel space, re-assembled with untouched vector pages, and
 * scrubbed with sanitizePdfDeep + QPDF orphan object purge.
 */
export async function applyDestructivePiiRedaction(
  file: File,
  findings: PiiFinding[],
  onProgress?: (pct: number, status?: string) => void
): Promise<PdfProcessResult> {
  const t0 = performance.now();
  const active = findings.filter((f) => f.selected);
  if (!active.length) {
    throw new Error('Select at least one detected PII item to redact.');
  }

  const hitsByPage = new Map<number, PiiFinding[]>();
  for (const f of active) {
    const arr = hitsByPage.get(f.pageNumber) || [];
    arr.push(f);
    hitsByPage.set(f.pageNumber, arr);
  }

  const srcBytes = await file.arrayBuffer();
  const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const renderPdf = await loadPdfJsDocument(file);
  const outDoc = await PDFDocument.create();
  const totalPages = srcDoc.getPageCount();

  try {
  for (let i = 0; i < totalPages; i += 1) {
    const pageNo = i + 1;
    const pageHits = hitsByPage.get(pageNo);
    onProgress?.(Math.round(((i + 1) / totalPages) * 75), `Securing page ${pageNo} of ${totalPages}…`);

    if (!pageHits?.length) {
      const [copied] = await outDoc.copyPages(srcDoc, [i]);
      outDoc.addPage(copied);
      continue;
    }

    const srcPage = srcDoc.getPage(i);
    const { width: ptW, height: ptH } = srcPage.getSize();
    const canvas = document.createElement('canvas');
    await renderPdfPageToCanvas(renderPdf, pageNo, canvas, 2.0);

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#09090b';
      for (const hit of pageHits) {
        const padX = Math.max(2, canvas.width * 0.004);
        const padY = Math.max(2, canvas.height * 0.003);
        const rx = Math.max(0, hit.rect.x * canvas.width - padX);
        const ry = Math.max(0, hit.rect.y * canvas.height - padY);
        const rw = Math.min(canvas.width - rx, hit.rect.width * canvas.width + padX * 2);
        const rh = Math.min(canvas.height - ry, hit.rect.height * canvas.height + padY * 2);
        ctx.fillRect(rx, ry, rw, rh);
      }
    }

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed raster redaction'))), 'image/png');
    });
    canvas.width = 0;
    canvas.height = 0;

    const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());
    const embedded = await outDoc.embedPng(pngBytes);
    const burnedPage = outDoc.addPage([ptW, ptH]);
    burnedPage.drawImage(embedded, { x: 0, y: 0, width: ptW, height: ptH });
  }
  } finally {
    await renderPdf.destroy().catch(() => {});
  }

  onProgress?.(85, 'Sanitizing metadata & purging orphaned streams…');
  const draftBytes = await outDoc.save({ useObjectStreams: true });
  const draftFile = new File([new Uint8Array(draftBytes)], file.name, { type: 'application/pdf' });
  const sanitized = await sanitizePdfDeep(draftFile);

  let finalBytes: Uint8Array = new Uint8Array(await sanitized.blob.arrayBuffer());
  try {
    finalBytes = await purgeOrphanObjectsWithQpdf(finalBytes);
  } catch {
    // Non-fatal fallback if QPDF WASM is busy
  }

  const blob = new Blob([new Uint8Array(finalBytes)], { type: 'application/pdf' });
  const fileName = `${sanitizeFilenameStem(file.name)}-redacted.pdf`;
  onProgress?.(100, 'Redaction finalized');
  return {
    blob,
    url: URL.createObjectURL(blob),
    fileName,
    mimeType: 'application/pdf',
    sizeBytes: blob.size,
    elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
    pageCount: totalPages,
    summary: `Permanently redacted ${active.length} PII item(s) across ${hitsByPage.size} page(s).`,
  };
}
