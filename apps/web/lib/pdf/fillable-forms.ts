import { PDFDocument, StandardFonts } from 'pdf-lib';
import { assertValidPdfFile, classifyPdfError, PdfToolError, sanitizeFilenameStem } from './errors';
import { loadPdfJsDocument, renderPdfPageToCanvas } from './pdf-browser';
import type { PdfFormFieldSpec, PdfProcessResult } from './types';

export async function readExistingAcroFormFields(file: File): Promise<PdfFormFieldSpec[]> {
  const pdf = await loadPdfJsDocument(file);
  const fields: PdfFormFieldSpec[] = [];

  try {
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const vp = page.getViewport({ scale: 1 });
      const annots = await page.getAnnotations();
      for (const a of annots) {
        if (a.subtype !== 'Widget' || !a.rect) continue;
        const [x1, y1, x2, y2] = a.rect;
        const w = Math.abs(x2 - x1);
        const h = Math.abs(y2 - y1);
        const x = Math.min(x1, x2) / vp.width;
        const y = (vp.height - Math.max(y1, y2)) / vp.height;

        let type: PdfFormFieldSpec['type'] = 'text';
        if (a.fieldType === 'Btn') {
          type = a.radioButton ? 'radio' : 'checkbox';
        } else if (a.fieldType === 'Ch') {
          type = 'dropdown';
        } else if (a.multiLine) {
          type = 'multiline';
        }

        fields.push({
          id: `existing-${pageNo}-${a.id || fields.length}`,
          pageNumber: pageNo,
          type,
          name: a.fieldName || `field_${fields.length + 1}`,
          x: Math.max(0, Math.min(1, x)),
          y: Math.max(0, Math.min(1, y)),
          width: Math.max(0.02, Math.min(1, w / vp.width)),
          height: Math.max(0.015, Math.min(1, h / vp.height)),
          defaultValue: typeof a.fieldValue === 'string' ? a.fieldValue : '',
          checked: Boolean(a.fieldValue && a.fieldValue !== 'Off'),
          options: Array.isArray(a.options)
            ? a.options.map((o: { displayValue?: string; exportValue?: string }) => o.displayValue || o.exportValue || '')
            : undefined,
        });
      }
      page.cleanup();
    }
    return fields;
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

/**
 * Innovation: Multi-signal local heuristic detector
 * 1) Text label scanner ("Name:", "Date:", "Signature:", "Email:", etc.)
 * 2) Visual underline & closed-box scanner (detects fillable lines, boxes, and checkboxes)
 */
export async function suggestFormFieldsForPage(
  file: File,
  pageNumber: number
): Promise<PdfFormFieldSpec[]> {
  const pdf = await loadPdfJsDocument(file);
  const suggestions: PdfFormFieldSpec[] = [];
  const MAX_SUGGESTIONS = 40;

  try {
    const page = await pdf.getPage(pageNumber);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();

    for (const rawItem of tc.items) {
      if (suggestions.length >= MAX_SUGGESTIONS) break;
      if (!('str' in rawItem)) continue;
      const text = rawItem.str.trim();
      if (!text) continue;

      const isLabel =
        /[:?]$/.test(text) ||
        /\b(name|date|email|phone|mobile|address|city|state|zip|country|signature|amount|total|company|title)\b/i.test(
          text
        );
      if (!isLabel) continue;

      const tx = rawItem.transform;
      const fs = Math.max(8, Math.hypot(tx[0], tx[1]) || 12);
      const labelRight = (tx[4] + (rawItem.width || text.length * fs * 0.5)) / vp.width;
      const topNorm = (vp.height - tx[5] - fs * 1.1) / vp.height;

      if (labelRight < 0.78) {
        const cleanName = text
          .replace(/[^a-z0-9]+/gi, '_')
          .replace(/^_|_$/g, '')
          .toLowerCase();
        suggestions.push({
          id: `sug-lbl-${pageNumber}-${suggestions.length}`,
          pageNumber,
          type: /notes|comments|address|description/i.test(text) ? 'multiline' : 'text',
          name: cleanName || `field_${suggestions.length + 1}`,
          x: Math.min(0.85, labelRight + 0.015),
          y: Math.max(0.02, topNorm - 0.004),
          width: Math.min(0.45, Math.max(0.15, 0.92 - labelRight)),
          height: /notes|comments|address|description/i.test(text) ? 0.06 : 0.028,
          suggested: true,
        });
      }
    }

    // Visual underline & checkbox geometry scan
    const canvas = document.createElement('canvas');
    try {
      await renderPdfPageToCanvas(pdf, pageNumber, canvas, 1);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const w = canvas.width;
        const h = canvas.height;
        const img = ctx.getImageData(0, 0, w, h).data;
        const isDark = (x: number, y: number) => {
          const idx = (y * w + x) * 4;
          return (img[idx] + img[idx + 1] + img[idx + 2]) / 3 < 130;
        };

        for (let y = 12; y < h - 12 && suggestions.length < MAX_SUGGESTIONS; y += 5) {
          let runStart = -1;
          for (let x = 10; x < w - 10; x += 1) {
            if (isDark(x, y)) {
              if (runStart < 0) runStart = x;
            } else if (runStart >= 0) {
              const runLen = x - runStart;
              // Detect small checkbox squares (10-24px wide horizontal border with matching vertical span)
              if (runLen >= 10 && runLen <= 24 && y + runLen < h - 4) {
                let topEdge = true;
                let leftEdge = true;
                let rightEdge = true;
                for (let k = 1; k < runLen - 1; k += 2) {
                  if (!isDark(runStart + k, y)) topEdge = false;
                  if (!isDark(runStart, y + k)) leftEdge = false;
                  if (!isDark(x - 1, y + k)) rightEdge = false;
                }
                if (topEdge && leftEdge && rightEdge) {
                  const nx = runStart / w;
                  const ny = y / h;
                  const overlaps = suggestions.some(
                    (s) => Math.abs(s.x - nx) < 0.03 && Math.abs(s.y - ny) < 0.025
                  );
                  if (!overlaps) {
                    suggestions.push({
                      id: `sug-chk-${pageNumber}-${suggestions.length}`,
                      pageNumber,
                      type: 'checkbox',
                      name: `checkbox_${suggestions.length + 1}`,
                      x: nx,
                      y: ny,
                      width: Math.max(0.02, runLen / w),
                      height: Math.max(0.018, runLen / h),
                      suggested: true,
                    });
                  }
                }
              } else if (runLen >= w * 0.14 && runLen <= w * 0.7) {
                const nx = runStart / w;
                const ny = Math.max(0.01, (y - 22) / h);
                const nw = runLen / w;
                const overlaps = suggestions.some(
                  (s) => Math.abs(s.x - nx) < 0.08 && Math.abs(s.y - ny) < 0.03
                );
                if (!overlaps) {
                  suggestions.push({
                    id: `sug-line-${pageNumber}-${suggestions.length}`,
                    pageNumber,
                    type: 'text',
                    name: `line_field_${suggestions.length + 1}`,
                    x: nx,
                    y: ny,
                    width: nw,
                    height: 0.028,
                    suggested: true,
                  });
                }
              }
              runStart = -1;
            }
          }
        }
      }
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }

    page.cleanup();
    return suggestions;
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

export async function createFillablePdf(
  file: File,
  fields: PdfFormFieldSpec[],
  onProgress?: (pct: number) => void
): Promise<PdfProcessResult> {
  if (fields.length === 0) {
    throw new PdfToolError('Add or accept at least one form field before exporting.', 'validation');
  }
  const t0 = performance.now();
  await assertValidPdfFile(file);
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(await file.arrayBuffer());
  } catch (err) {
    throw classifyPdfError(err, file.name);
  }

  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const usedNames = new Map<string, number>();

  const uniqueName = (raw: string) => {
    const base = raw.trim() || 'field';
    const count = usedNames.get(base) || 0;
    usedNames.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  };

  for (let i = 0; i < fields.length; i += 1) {
    const f = fields[i];
    const page = pages[f.pageNumber - 1];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();
    const x = f.x * pw;
    const w = Math.max(14, f.width * pw);
    const h = Math.max(14, f.height * ph);
    const y = ph - f.y * ph - h;

    if (f.type === 'checkbox') {
      const cb = form.createCheckBox(uniqueName(f.name));
      cb.addToPage(page, { x, y, width: w, height: h });
      if (f.checked) cb.check();
    } else if (f.type === 'radio') {
      const groupName = f.radioGroup || f.name || 'radio_group';
      const rg = (() => {
        try {
          return form.getRadioGroup(groupName);
        } catch {
          return form.createRadioGroup(groupName);
        }
      })();
      rg.addOptionToPage(f.defaultValue || `opt_${i + 1}`, page, { x, y, width: w, height: h });
    } else if (f.type === 'dropdown') {
      const dd = form.createDropdown(uniqueName(f.name));
      dd.addOptions(f.options?.length ? f.options : ['Option 1', 'Option 2', 'Option 3']);
      dd.addToPage(page, { x, y, width: w, height: h, font });
    } else {
      const tf = form.createTextField(uniqueName(f.name));
      if (f.type === 'multiline') tf.enableMultiline();
      if (f.required) tf.enableRequired();
      if (f.defaultValue) tf.setText(f.defaultValue);
      tf.addToPage(page, { x, y, width: w, height: h, font });
    }
    onProgress?.(Math.round(((i + 1) / fields.length) * 90));
  }

  const bytes = await doc.save({ useObjectStreams: true });
  onProgress?.(100);
  const stem = sanitizeFilenameStem(file.name, 'form');
  return {
    blob: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
    url: URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })),
    fileName: `${stem}-fillable.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: bytes.length,
    elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
    pageCount: pages.length,
    summary: `Created ${fields.length} interactive AcroForm field(s)`,
  };
}
