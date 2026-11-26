import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { sanitizeFilenameStem } from './errors.ts';
import { loadMatchedFontBytes } from './font-matcher.ts';
import type { BusinessDocInput, BusinessDocLabelKey, PdfProcessResult } from './types.ts';

function hexToRgbColor(hex: string) {
  const clean = hex.replace('#', '').padEnd(6, '0');
  const r = Number.parseInt(clean.slice(0, 2), 16) / 255;
  const g = Number.parseInt(clean.slice(2, 4), 16) / 255;
  const b = Number.parseInt(clean.slice(4, 6), 16) / 255;
  return rgb(
    Number.isFinite(r) ? r : 0.15,
    Number.isFinite(g) ? g : 0.31,
    Number.isFinite(b) ? b : 0.86
  );
}

function sanitizeLineText(str: string, unicodeEnabled: boolean): string {
  const clean = (str || '').replace(/[\r\n\t]+/g, ' ');
  if (unicodeEnabled) {
    return clean;
  }
  return clean
    .replace(/\u20B9/g, 'INR ')
    .replace(/\u20AC/g, 'EUR ')
    .replace(/\u00A3/g, 'GBP ')
    .replace(/\u00A5/g, 'JPY ')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\x20-\x7e\u00a0-\u00ff]/g, '?');
}

function splitCleanLines(str: string, unicodeEnabled: boolean): string[] {
  return (str || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => sanitizeLineText(line, unicodeEnabled).trimEnd());
}

function currencySymbol(currency: string, unicodeEnabled: boolean): string {
  switch (currency) {
    case 'EUR':
      return unicodeEnabled ? '€' : 'EUR ';
    case 'GBP':
      return unicodeEnabled ? '£' : 'GBP ';
    case 'INR':
      return unicodeEnabled ? '₹' : 'INR ';
    case 'JPY':
      return unicodeEnabled ? '¥' : 'JPY ';
    case 'AUD':
      return 'A$';
    case 'CAD':
      return 'C$';
    case 'USD':
    default:
      return '$';
  }
}

function formatMoney(amount: number, currency: string, unicodeEnabled: boolean): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const sym = currencySymbol(currency, unicodeEnabled);
  const formatted =
    currency === 'JPY'
      ? Math.round(safe).toLocaleString('en-US')
      : safe.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sym}${formatted}`;
}

function wrapTextToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return [clean];

  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        current = word;
      } else {
        // Hard-break ultra-long token
        let slice = '';
        for (const ch of word) {
          if (font.widthOfTextAtSize(slice + ch, size) > maxWidth && slice) {
            lines.push(slice);
            slice = ch;
          } else {
            slice += ch;
          }
        }
        current = slice;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawPaidRubberStamp(
  page: ReturnType<PDFDocument['addPage']>,
  fontBold: PDFFont,
  stampText: string,
  centerX: number,
  centerY: number,
  color: ReturnType<typeof rgb>,
  scale = 1
) {
  const label = stampText.toUpperCase().slice(0, 16);
  const fontSize = 22 * scale;
  const tw = fontBold.widthOfTextAtSize(label, fontSize);
  const padX = 14 * scale;
  const padY = 8 * scale;
  const boxW = tw + padX * 2;
  const boxH = fontSize + padY * 2;
  const angle = -18;
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = -boxW / 2;
  const ry = -boxH / 2;
  const bx = centerX + rx * cos - ry * sin;
  const by = centerY + rx * sin + ry * cos;

  page.drawRectangle({
    x: bx,
    y: by,
    width: boxW,
    height: boxH,
    borderColor: color,
    borderWidth: 2.2 * scale,
    borderOpacity: 0.28,
    rotate: degrees(angle),
  });

  const tx = centerX - (tw / 2) * cos + (fontSize * 0.32) * sin;
  const ty = centerY - (tw / 2) * sin - (fontSize * 0.32) * cos;
  page.drawText(label, {
    x: tx,
    y: ty,
    size: fontSize,
    font: fontBold,
    color,
    opacity: 0.28,
    rotate: degrees(angle),
  });
}

/**
 * Unified Invoice / Receipt / Quote Generator:
 * - Supports A4, US Letter, A6, and 80mm Thermal POS layouts
 * - Embeds Inter Unicode font when available (rendering ₹, €, £, ¥ cleanly)
 * - Right-aligned columns, multi-page table & summary pagination, GST/VAT/Sales Tax math
 * - Vector rotated PAID rubber-stamp, custom editable labels, Scope/Terms/Signature blocks
 */
export async function renderBusinessDocumentPdf(input: BusinessDocInput): Promise<PdfProcessResult> {
  const t0 = performance.now();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  let fontRegular: PDFFont;
  let fontBold: PDFFont;
  let unicodeEnabled = false;

  try {
    const [regBytes, boldBytes] = await Promise.all([
      loadMatchedFontBytes('inter', 400, false),
      loadMatchedFontBytes('inter', 700, false),
    ]);
    if (regBytes && boldBytes) {
      fontRegular = await doc.embedFont(regBytes, { subset: true });
      fontBold = await doc.embedFont(boldBytes, { subset: true });
      unicodeEnabled = true;
    } else {
      fontRegular = await doc.embedFont(StandardFonts.Helvetica);
      fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    }
  } catch {
    fontRegular = await doc.embedFont(StandardFonts.Helvetica);
    fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  }

  const labelFor = (key: BusinessDocLabelKey, fallback: string) => {
    const custom = input.customLabels?.[key]?.trim();
    return sanitizeLineText(custom || fallback, unicodeEnabled);
  };

  const subtotal = input.items.reduce(
    (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
    0
  );
  const rawDisc = Math.max(0, Number(input.discountAmount) || 0);
  const discAmt = input.discountType === 'percent' ? subtotal * (rawDisc / 100) : rawDisc;
  const taxableBase = Math.max(0, subtotal - discAmt);
  const taxPct = Math.max(0, Number(input.taxPercent) || 0);
  const taxAmt = taxableBase * (taxPct / 100);
  const shippingAmt = Math.max(0, Number(input.shippingAmount) || 0);
  const grandTotal = Math.max(0, taxableBase + taxAmt + shippingAmt);

  const accent = hexToRgbColor(input.accentColor || '#254EDB');
  const ink = rgb(0.08, 0.08, 0.1);
  const muted = rgb(0.42, 0.42, 0.46);
  const lineCol = rgb(0.84, 0.84, 0.86);
  const stampGreen = rgb(0.08, 0.5, 0.24);

  const s = (txt: string) => sanitizeLineText(txt, unicodeEnabled);

  const embedLogo = async () => {
    if (!input.logoDataUrl) return null;
    try {
      const resp = await fetch(input.logoDataUrl);
      const buf = await resp.arrayBuffer();
      const lower = input.logoDataUrl.toLowerCase();
      if (lower.includes('image/jpeg') || lower.includes('image/jpg')) {
        return await doc.embedJpg(buf);
      }
      return await doc.embedPng(buf);
    } catch {
      return null;
    }
  };
  const logoImage = await embedLogo();

  // 80mm Thermal POS Receipt Mode
  if (input.templateSize === 'thermal-80mm') {
    const W = 226.77;
    const M = 14;
    const senderLines = splitCleanLines(input.senderAddress, unicodeEnabled).filter(Boolean).slice(0, 3);
    const noteLines = splitCleanLines(input.notes, unicodeEnabled).filter(Boolean).slice(0, 4);
    const extraLines =
      (logoImage ? 38 : 0) +
      senderLines.length * 12 +
      (input.senderTaxId ? 13 : 0) +
      (input.recipientName ? 13 : 0) +
      (discAmt > 0 ? 14 : 0) +
      (taxAmt > 0 ? (input.taxMode === 'gst-intra' ? 28 : 14) : 0) +
      (shippingAmt > 0 ? 14 : 0) +
      (input.paymentMethod || input.paymentReference ? 18 : 0) +
      noteLines.length * 12;
    const H = Math.max(360, 240 + input.items.length * 22 + extraLines);
    const page = doc.addPage([W, H]);
    let y = H - 20;

    if (logoImage) {
      const sc = Math.min(68 / logoImage.width, 28 / logoImage.height);
      const lw = logoImage.width * sc;
      const lh = logoImage.height * sc;
      page.drawImage(logoImage, { x: W / 2 - lw / 2, y: y - lh, width: lw, height: lh });
      y -= lh + 10;
    }

    const centerText = (txt: string, size: number, bold = false, color = ink) => {
      const f = bold ? fontBold : fontRegular;
      const lines = wrapTextToWidth(s(txt), f, size, W - M * 2);
      for (const ln of lines.slice(0, 2)) {
        const tw = f.widthOfTextAtSize(ln, size);
        page.drawText(ln, { x: Math.max(M, W / 2 - tw / 2), y, size, font: f, color });
        y -= size + 4;
      }
    };

    centerText(input.senderName || 'Merchant Receipt', 11, true, accent);
    for (const sl of senderLines) centerText(sl, 7.5, false, muted);
    if (input.senderTaxId) centerText(`Tax/GST: ${input.senderTaxId}`, 7.5, false, muted);
    y -= 2;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.7, color: lineCol });
    y -= 12;

    centerText(
      `${labelFor('docTitle', input.kind.toUpperCase())} #${input.documentNumber || '001'}`,
      9.5,
      true,
      ink
    );
    centerText(`${labelFor('date', 'Date')}: ${input.issueDate || '-'}`, 7.5, false, muted);
    if (input.recipientName) centerText(`Customer: ${input.recipientName}`, 8, false, ink);

    y -= 4;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: lineCol });
    y -= 12;

    for (const item of input.items) {
      const qty = Number(item.quantity) || 0;
      const unitP = Number(item.unitPrice) || 0;
      const lineTotal = qty * unitP;
      const price = formatMoney(lineTotal, input.currency, unicodeEnabled);
      const pw = fontBold.widthOfTextAtSize(price, 8);
      const maxLabelW = Math.max(60, W - M * 2 - pw - 8);
      const labelLines = wrapTextToWidth(s(`${qty}x ${item.description || 'Item'}`), fontRegular, 8, maxLabelW);
      page.drawText(labelLines[0] || '', { x: M, y, size: 8, font: fontRegular, color: ink });
      page.drawText(price, { x: W - M - pw, y, size: 8, font: fontBold, color: ink });
      y -= 14;
    }

    y -= 2;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.7, color: lineCol });
    y -= 13;

    const drawReceiptRow = (lbl: string, val: string, bold = false) => {
      const f = bold ? fontBold : fontRegular;
      const sz = bold ? 10 : 8;
      const vw = f.widthOfTextAtSize(val, sz);
      page.drawText(s(lbl), { x: M, y, size: sz, font: f, color: bold ? accent : muted });
      page.drawText(val, { x: W - M - vw, y, size: sz, font: f, color: ink });
      y -= sz + 5;
    };

    drawReceiptRow(labelFor('subtotal', 'Subtotal'), formatMoney(subtotal, input.currency, unicodeEnabled));
    if (discAmt > 0) drawReceiptRow('Discount', `-${formatMoney(discAmt, input.currency, unicodeEnabled)}`);
    if (taxAmt > 0) {
      if (input.taxMode === 'gst-intra') {
        drawReceiptRow(`CGST (${(taxPct / 2).toFixed(1)}%)`, formatMoney(taxAmt / 2, input.currency, unicodeEnabled));
        drawReceiptRow(`SGST (${(taxPct / 2).toFixed(1)}%)`, formatMoney(taxAmt / 2, input.currency, unicodeEnabled));
      } else if (input.taxMode === 'gst-inter') {
        drawReceiptRow(`IGST (${taxPct}%)`, formatMoney(taxAmt, input.currency, unicodeEnabled));
      } else if (input.taxMode === 'vat') {
        drawReceiptRow(`VAT (${taxPct}%)`, formatMoney(taxAmt, input.currency, unicodeEnabled));
      } else if (input.taxMode === 'sales-tax') {
        drawReceiptRow(`Sales Tax (${taxPct}%)`, formatMoney(taxAmt, input.currency, unicodeEnabled));
      } else {
        drawReceiptRow(`${labelFor('tax', 'Tax')} (${taxPct}%)`, formatMoney(taxAmt, input.currency, unicodeEnabled));
      }
    }
    if (shippingAmt > 0) drawReceiptRow('Shipping', formatMoney(shippingAmt, input.currency, unicodeEnabled));
    drawReceiptRow(labelFor('total', 'TOTAL'), formatMoney(grandTotal, input.currency, unicodeEnabled), true);

    if (input.paymentMethod || input.paymentReference) {
      y -= 4;
      centerText(
        `${input.paymentMethod || 'Paid'}${input.paymentReference ? ` · ${input.paymentReference}` : ''}`,
        7.5,
        false,
        muted
      );
    }
    for (const nl of noteLines) centerText(nl, 7.5, false, muted);

    if (input.showPaidWatermark || (input.kind === 'receipt' && input.statusStamp?.trim().toUpperCase() === 'PAID')) {
      drawPaidRubberStamp(page, fontBold, input.statusStamp?.trim() || 'PAID', W / 2, H * 0.45, stampGreen, 0.72);
    }

    const bytes = await doc.save({ useObjectStreams: true });
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    const stem = sanitizeFilenameStem(`${input.kind}-80mm-${input.documentNumber}`, input.kind);
    return {
      blob,
      url: URL.createObjectURL(blob),
      fileName: `${stem}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: blob.size,
      elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
      pageCount: 1,
      summary: `Generated 80mm thermal ${input.kind} (${formatMoney(grandTotal, input.currency, unicodeEnabled)})`,
    };
  }

  // Standard Sheet Geometries: A4, US Letter, or A6
  const sizeDims: Record<'a4' | 'letter' | 'a6', [number, number]> = {
    a4: [595.28, 841.89],
    letter: [612, 792],
    a6: [297.64, 419.53],
  };
  const tmpl = input.templateSize === 'letter' || input.templateSize === 'a6' ? input.templateSize : 'a4';
  const [W, H] = sizeDims[tmpl];
  const isCompact = tmpl === 'a6';
  const MARGIN = isCompact ? 22 : 44;

  let page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: H - (isCompact ? 5 : 8), width: W, height: isCompact ? 5 : 8, color: accent });

  let headerY = H - MARGIN;
  if (logoImage) {
    const maxLogoW = isCompact ? 54 : 84;
    const maxLogoH = isCompact ? 30 : 46;
    const scale = Math.min(maxLogoW / logoImage.width, maxLogoH / logoImage.height);
    page.drawImage(logoImage, {
      x: MARGIN,
      y: headerY - logoImage.height * scale,
      width: logoImage.width * scale,
      height: logoImage.height * scale,
    });
  }

  const defaultDocTitle =
    input.kind === 'invoice' ? 'INVOICE' : input.kind === 'receipt' ? 'PAYMENT RECEIPT' : 'QUOTE';
  const titleLabel = labelFor('docTitle', defaultDocTitle);
  const titleSize = isCompact ? 15 : 24;
  const titleW = fontBold.widthOfTextAtSize(titleLabel, titleSize);
  page.drawText(titleLabel, {
    x: W - MARGIN - titleW,
    y: headerY - (isCompact ? 14 : 22),
    size: titleSize,
    font: fontBold,
    color: accent,
  });

  const numText = s(`# ${input.documentNumber || '001'}`);
  const numSize = isCompact ? 9 : 11;
  const numW = fontBold.widthOfTextAtSize(numText, numSize);
  page.drawText(numText, {
    x: W - MARGIN - numW,
    y: headerY - (isCompact ? 28 : 40),
    size: numSize,
    font: fontBold,
    color: ink,
  });

  if (input.statusStamp?.trim() && !input.showPaidWatermark) {
    const stamp = s(input.statusStamp.trim().toUpperCase());
    const sw = fontBold.widthOfTextAtSize(stamp, isCompact ? 8 : 10) + 14;
    page.drawRectangle({
      x: W - MARGIN - sw,
      y: headerY - (isCompact ? 46 : 62),
      width: sw,
      height: isCompact ? 14 : 17,
      borderColor: accent,
      borderWidth: 1,
    });
    page.drawText(stamp, {
      x: W - MARGIN - sw + 7,
      y: headerY - (isCompact ? 42 : 57),
      size: isCompact ? 8 : 10,
      font: fontBold,
      color: accent,
    });
  }

  headerY -= isCompact ? 50 : 72;
  const colW = isCompact ? (W - MARGIN * 2) * 0.48 : 175;
  const drawBlock = (
    label: string,
    name: string,
    email: string,
    address: string,
    taxId: string | undefined,
    x: number,
    yPos: number
  ): number => {
    page.drawText(s(label).toUpperCase(), { x, y: yPos, size: isCompact ? 6.5 : 8, font: fontBold, color: muted });
    let cur = yPos - (isCompact ? 11 : 15);
    for (const ln of wrapTextToWidth(s(name || '-'), fontBold, isCompact ? 9 : 11, colW).slice(0, 2)) {
      page.drawText(ln, { x, y: cur, size: isCompact ? 9 : 11, font: fontBold, color: ink });
      cur -= isCompact ? 11 : 14;
    }
    if (taxId?.trim()) {
      for (const ln of wrapTextToWidth(s(`Tax ID: ${taxId.trim()}`), fontBold, isCompact ? 7 : 8.5, colW)) {
        page.drawText(ln, { x, y: cur, size: isCompact ? 7 : 8.5, font: fontBold, color: muted });
        cur -= isCompact ? 9.5 : 12;
      }
    }
    if (email.trim()) {
      for (const ln of wrapTextToWidth(s(email), fontRegular, isCompact ? 7.5 : 9.5, colW)) {
        page.drawText(ln, { x, y: cur, size: isCompact ? 7.5 : 9.5, font: fontRegular, color: muted });
        cur -= isCompact ? 10 : 13;
      }
    }
    for (const rawLine of splitCleanLines(address, unicodeEnabled).slice(0, 4)) {
      if (!rawLine.trim()) continue;
      for (const ln of wrapTextToWidth(rawLine.trim(), fontRegular, isCompact ? 7.5 : 9.5, colW)) {
        page.drawText(ln, { x, y: cur, size: isCompact ? 7.5 : 9.5, font: fontRegular, color: muted });
        cur -= isCompact ? 10 : 13;
      }
    }
    return cur;
  };

  const fromBottom = drawBlock(
    labelFor('from', 'From'),
    input.senderName,
    input.senderEmail,
    input.senderAddress,
    input.senderTaxId,
    MARGIN,
    headerY
  );
  const toBottom = drawBlock(
    labelFor('billTo', input.kind === 'receipt' ? 'Received From' : 'Bill To'),
    input.recipientName,
    input.recipientEmail,
    input.recipientAddress,
    input.recipientTaxId,
    MARGIN + (isCompact ? colW + 10 : 192),
    headerY
  );

  let metaBottom = headerY;
  if (!isCompact) {
    const defaultDateLabel =
      input.kind === 'quote' ? 'Valid Until' : input.kind === 'receipt' ? 'Paid Date' : 'Due Date';
    const metaX = W - MARGIN - 110;
    page.drawText(labelFor('date', 'ISSUE DATE').toUpperCase(), { x: metaX, y: headerY, size: 8, font: fontBold, color: muted });
    page.drawText(s(input.issueDate || '-'), { x: metaX, y: headerY - 14, size: 10, font: fontRegular, color: ink });
    page.drawText(labelFor('dueDate', defaultDateLabel).toUpperCase(), {
      x: metaX,
      y: headerY - 34,
      size: 8,
      font: fontBold,
      color: muted,
    });
    page.drawText(s(input.dueOrValidDate || '-'), { x: metaX, y: headerY - 48, size: 10, font: fontRegular, color: ink });
    metaBottom = headerY - 64;
  }

  let y = Math.min(fromBottom, toBottom, metaBottom) - (isCompact ? 14 : 22);

  const qtyRightX = W - MARGIN - (isCompact ? 96 : 168);
  const priceRightX = W - MARGIN - (isCompact ? 50 : 90);
  const totalRightX = W - MARGIN - 8;
  const descMaxW = qtyRightX - (MARGIN + 10) - 24;

  const drawTableHeader = () => {
    const hH = isCompact ? 18 : 24;
    const fsz = isCompact ? 7 : 8.5;
    page.drawRectangle({ x: MARGIN, y: y - hH, width: W - MARGIN * 2, height: hH, color: accent });
    page.drawText(labelFor('description', 'DESCRIPTION').toUpperCase(), {
      x: MARGIN + 8,
      y: y - (isCompact ? 12 : 16),
      size: fsz,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
    const qLbl = labelFor('qty', 'QTY').toUpperCase();
    const pLbl = labelFor('price', 'PRICE').toUpperCase();
    const tLbl = labelFor('total', 'TOTAL').toUpperCase();
    page.drawText(qLbl, {
      x: qtyRightX - fontBold.widthOfTextAtSize(qLbl, fsz),
      y: y - (isCompact ? 12 : 16),
      size: fsz,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
    page.drawText(pLbl, {
      x: priceRightX - fontBold.widthOfTextAtSize(pLbl, fsz),
      y: y - (isCompact ? 12 : 16),
      size: fsz,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
    page.drawText(tLbl, {
      x: totalRightX - fontBold.widthOfTextAtSize(tLbl, fsz),
      y: y - (isCompact ? 12 : 16),
      size: fsz,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
    y -= hH;
  };

  const ensureSpace = (needed: number, withTableHeader = false) => {
    if (y - needed < MARGIN + 18) {
      page = doc.addPage([W, H]);
      y = H - MARGIN;
      if (withTableHeader) drawTableHeader();
    }
  };

  drawTableHeader();
  const itemFontSize = isCompact ? 8 : 10;

  for (const item of input.items) {
    const qty = Number(item.quantity) || 0;
    const unitP = Number(item.unitPrice) || 0;
    const lineTotal = qty * unitP;
    const descLines = wrapTextToWidth(s(item.description || 'Item'), fontRegular, itemFontSize, descMaxW);
    const rowH = Math.max(isCompact ? 20 : 26, descLines.length * (itemFontSize + 4) + 10);
    ensureSpace(rowH + 10, true);

    page.drawLine({
      start: { x: MARGIN, y: y - rowH },
      end: { x: W - MARGIN, y: y - rowH },
      thickness: 0.6,
      color: lineCol,
    });

    descLines.forEach((ln, idx) => {
      page.drawText(ln, {
        x: MARGIN + 8,
        y: y - (isCompact ? 13 : 16) - idx * (itemFontSize + 3),
        size: itemFontSize,
        font: fontRegular,
        color: ink,
      });
    });

    const qtyStr = String(qty);
    const priceStr = formatMoney(unitP, input.currency, unicodeEnabled);
    const totalStr = formatMoney(lineTotal, input.currency, unicodeEnabled);

    page.drawText(qtyStr, {
      x: qtyRightX - fontRegular.widthOfTextAtSize(qtyStr, itemFontSize),
      y: y - (isCompact ? 13 : 16),
      size: itemFontSize,
      font: fontRegular,
      color: ink,
    });
    page.drawText(priceStr, {
      x: priceRightX - fontRegular.widthOfTextAtSize(priceStr, itemFontSize),
      y: y - (isCompact ? 13 : 16),
      size: itemFontSize,
      font: fontRegular,
      color: ink,
    });
    page.drawText(totalStr, {
      x: totalRightX - fontBold.widthOfTextAtSize(totalStr, itemFontSize),
      y: y - (isCompact ? 13 : 16),
      size: itemFontSize,
      font: fontBold,
      color: ink,
    });
    y -= rowH;
  }

  // Ensure summary block fits cleanly on current or next page
  ensureSpace(isCompact ? 95 : 130, false);
  y -= isCompact ? 14 : 20;

  const summaryX = isCompact ? MARGIN : W - MARGIN - 220;
  const drawSumRow = (lbl: string, val: string, bold = false) => {
    ensureSpace(24, false);
    const sz = bold ? (isCompact ? 10 : 12) : isCompact ? 8 : 10;
    const f = bold ? fontBold : fontRegular;
    page.drawText(s(lbl), {
      x: summaryX,
      y,
      size: sz,
      font: f,
      color: bold ? accent : muted,
    });
    const vw = f.widthOfTextAtSize(val, sz);
    page.drawText(val, {
      x: W - MARGIN - vw - 4,
      y,
      size: sz,
      font: f,
      color: ink,
    });
    y -= bold ? (isCompact ? 16 : 22) : isCompact ? 13 : 17;
  };

  drawSumRow(labelFor('subtotal', 'Subtotal'), formatMoney(subtotal, input.currency, unicodeEnabled));
  if (discAmt > 0) {
    drawSumRow(
      input.discountType === 'percent' ? `Discount (${rawDisc}%)` : 'Discount',
      `-${formatMoney(discAmt, input.currency, unicodeEnabled)}`
    );
  }
  if (taxAmt > 0) {
    if (input.taxMode === 'gst-intra') {
      drawSumRow(`CGST (${(taxPct / 2).toFixed(1)}%)`, formatMoney(taxAmt / 2, input.currency, unicodeEnabled));
      drawSumRow(`SGST (${(taxPct / 2).toFixed(1)}%)`, formatMoney(taxAmt / 2, input.currency, unicodeEnabled));
    } else if (input.taxMode === 'gst-inter') {
      drawSumRow(`IGST (${taxPct}%)`, formatMoney(taxAmt, input.currency, unicodeEnabled));
    } else if (input.taxMode === 'vat') {
      drawSumRow(`VAT (${taxPct}%)`, formatMoney(taxAmt, input.currency, unicodeEnabled));
    } else if (input.taxMode === 'sales-tax') {
      drawSumRow(`Sales Tax (${taxPct}%)`, formatMoney(taxAmt, input.currency, unicodeEnabled));
    } else {
      drawSumRow(`${labelFor('tax', 'Tax')} (${taxPct}%)`, formatMoney(taxAmt, input.currency, unicodeEnabled));
    }
  }
  if (shippingAmt > 0) {
    drawSumRow('Shipping', formatMoney(shippingAmt, input.currency, unicodeEnabled));
  }
  page.drawLine({
    start: { x: summaryX, y: y + 8 },
    end: { x: W - MARGIN, y: y + 8 },
    thickness: 1,
    color: accent,
  });
  y -= 4;
  drawSumRow(
    input.kind === 'receipt' ? 'Amount Paid' : 'Total Due',
    formatMoney(grandTotal, input.currency, unicodeEnabled),
    true
  );

  if (input.kind === 'receipt' && (input.paymentMethod || input.paymentReference)) {
    ensureSpace(24, false);
    y -= 4;
    page.drawText(
      s(
        `Payment Method: ${input.paymentMethod || 'Card'}${
          input.paymentReference ? ` · Ref: ${input.paymentReference}` : ''
        }`
      ),
      { x: MARGIN, y, size: isCompact ? 8 : 9.5, font: fontBold, color: muted }
    );
    y -= 18;
  }

  const drawWrappedSection = (heading: string, content: string) => {
    const rawLines = splitCleanLines(content, unicodeEnabled).filter((l) => l.trim().length > 0);
    if (rawLines.length === 0) return;
    ensureSpace(44, false);
    y -= 14;
    page.drawText(s(heading).toUpperCase(), { x: MARGIN, y, size: isCompact ? 7 : 8, font: fontBold, color: muted });
    y -= 13;
    const sz = isCompact ? 8 : 9.5;
    for (const rawLine of rawLines) {
      for (const wrapped of wrapTextToWidth(rawLine, fontRegular, sz, W - MARGIN * 2)) {
        ensureSpace(16, false);
        page.drawText(wrapped, { x: MARGIN, y, size: sz, font: fontRegular, color: muted });
        y -= sz + 3.5;
      }
    }
  };

  if (input.kind === 'quote' && input.scopeOfWork?.trim()) {
    drawWrappedSection('Scope of Work', input.scopeOfWork);
  }
  if (input.kind === 'quote' && input.termsAndConditions?.trim()) {
    drawWrappedSection('Terms & Conditions', input.termsAndConditions);
  }
  if (input.notes.trim()) {
    drawWrappedSection(labelFor('notes', 'Notes'), input.notes);
  }

  if (input.kind === 'quote' && input.acceptanceSignature?.enabled) {
    ensureSpace(64, false);
    y -= 26;
    const sigW = Math.min(220, (W - MARGIN * 2) * 0.48);
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + sigW, y }, thickness: 0.8, color: muted });
    page.drawLine({ start: { x: W - MARGIN - 130, y }, end: { x: W - MARGIN, y }, thickness: 0.8, color: muted });
    page.drawText(s(input.acceptanceSignature.label || 'Client Acceptance Signature'), {
      x: MARGIN,
      y: y - 12,
      size: 8,
      font: fontRegular,
      color: muted,
    });
    page.drawText('Date', { x: W - MARGIN - 130, y: y - 12, size: 8, font: fontRegular, color: muted });
  }

  if (input.showPaidWatermark || (input.kind === 'receipt' && input.statusStamp?.trim().toUpperCase() === 'PAID')) {
    const firstPage = doc.getPages()[0];
    drawPaidRubberStamp(
      firstPage,
      fontBold,
      input.statusStamp?.trim() || 'PAID',
      W * 0.68,
      H * 0.45,
      stampGreen,
      isCompact ? 0.85 : 1.35
    );
  }

  const bytes = await doc.save({ useObjectStreams: true });
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
  const stem = sanitizeFilenameStem(
    `${input.kind}-${input.documentNumber || '001'}-${input.recipientName || 'client'}`,
    input.kind
  );

  return {
    blob,
    url: URL.createObjectURL(blob),
    fileName: `${stem}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: blob.size,
    elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
    pageCount: doc.getPageCount(),
    summary: `Generated ${titleLabel} (${formatMoney(grandTotal, input.currency, unicodeEnabled)})`,
  };
}
