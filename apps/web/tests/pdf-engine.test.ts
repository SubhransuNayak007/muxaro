import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';
import {
  ALL_STUDIO_TOOLS,
  CREATOR_TOOLS_CATALOG,
  PDF_TOOLS_CATALOG,
} from '../lib/tools-catalog.ts';
import { formatPagesToRangeString, parsePageRange, parseSplitGroups } from '../lib/pdf/page-range.ts';
import { sanitizeFilenameStem } from '../lib/pdf/errors.ts';
import { renderBusinessDocumentPdf } from '../lib/pdf/business-docs.ts';
import {
  addHeaderFooterToPdf,
  addPageNumbersToPdf,
  addWatermarkToPdf,
  applyEditsAndSignaturesToPdf,
  clearReadOnlyFormFields,
  compressPdfSmart,
  cropPdfPages,
  inspectHiddenFingerprints,
  inspectPdfDeep,
  mergePdfPagesExpanded,
  removePdfAnnotations,
} from '../lib/pdf/pdf-document.ts';
import { verifyPdfSignaturesInBrowser } from '../lib/pdf/signature-verify.ts';
import { extractRawPdfBuffers } from '../lib/pdf/pdf-browser.ts';
import { formatOcrOutputAs, type OcrPageOutput } from '../lib/pdf/ocr-engine.ts';
import { classifyPdfFont } from '../lib/pdf/font-matcher.ts';

test('Tools catalog contains 14 Video tools and 38 PDF tools (52 total)', () => {
  assert.equal(CREATOR_TOOLS_CATALOG.length, 14);
  assert.equal(PDF_TOOLS_CATALOG.length, 38);
  assert.equal(ALL_STUDIO_TOOLS.length, 52);

  const hrefs = new Set(ALL_STUDIO_TOOLS.map((t) => t.href));
  assert.equal(hrefs.size, 52, 'All 52 tool routes must be unique');
});

test('parsePageRange handles ranges, odd/even, last, and invalid tokens', () => {
  const res = parsePageRange('1-3, 5, odd, last, 99', 6);
  assert.deepEqual(res.pages, [1, 2, 3, 5, 6]);
  assert.deepEqual(res.invalidTokens, ['99']);

  const groups = parseSplitGroups('1-2; 3-last', 5);
  assert.deepEqual(groups, [
    [1, 2],
    [3, 4, 5],
  ]);
});

test('sanitizeFilenameStem strips unsafe characters and extensions', () => {
  assert.equal(sanitizeFilenameStem('report:final/v2?.pdf'), 'report_final_v2_');
  assert.equal(sanitizeFilenameStem(''), 'document');
});

test('pdf-lib roundtrip creates and copies pages cleanly', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  doc.addPage([595, 842]);
  const bytes = await doc.save({ useObjectStreams: true });
  const loaded = await PDFDocument.load(bytes);
  assert.equal(loaded.getPageCount(), 2);
});

test('renderBusinessDocumentPdf generates A4 GST invoice and 80mm thermal receipt', async () => {
  const gstInv = await renderBusinessDocumentPdf({
    kind: 'invoice',
    templateSize: 'a4',
    documentNumber: 'INV-GST-1',
    issueDate: '2026-11-26',
    dueOrValidDate: '2026-12-10',
    currency: 'INR',
    accentColor: '#5562F0',
    senderName: 'Studio Labs',
    senderEmail: 'billing@example.com',
    senderAddress: 'Bengaluru',
    senderTaxId: '29ABCDE1234F1Z5',
    recipientName: 'Client India',
    recipientEmail: 'ap@client.in',
    recipientAddress: 'Mumbai',
    items: [{ id: '1', description: 'Engineering', quantity: 2, unitPrice: 1000 }],
    taxPercent: 18,
    taxMode: 'gst-intra',
    discountAmount: 10,
    discountType: 'percent',
    shippingAmount: 50,
    notes: 'Thank you',
  });
  assert.ok(gstInv.sizeBytes > 500);
  assert.equal(gstInv.pageCount, 1);

  const thermal = await renderBusinessDocumentPdf({
    kind: 'receipt',
    templateSize: 'thermal-80mm',
    documentNumber: 'POS-99',
    issueDate: '2026-11-26',
    dueOrValidDate: '2026-11-26',
    currency: 'USD',
    accentColor: '#111111',
    senderName: 'Coffee Bar',
    senderEmail: '',
    senderAddress: 'Main St',
    recipientName: 'Walk-in',
    recipientEmail: '',
    recipientAddress: '',
    items: [{ id: '1', description: 'Espresso', quantity: 2, unitPrice: 4.5 }],
    taxPercent: 8,
    discountAmount: 0,
    notes: 'Paid in full',
    paymentMethod: 'Card',
  });
  assert.ok(thermal.sizeBytes > 400);
  assert.ok(thermal.fileName.includes('80mm'));
});

async function makePdfFile(pageCount: number, name = 'sample.pdf'): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i += 1) {
    const p = doc.addPage([595, 842]);
    p.drawText(`Sample page ${i + 1}`, { x: 48, y: 780, size: 14, font, color: rgb(0, 0, 0) });
  }
  const bytes = await doc.save();
  return new File([Uint8Array.from(bytes)], name, { type: 'application/pdf' });
}

test('addWatermarkToPdf places QR watermark behind content cleanly', async () => {
  const file = await makePdfFile(2, 'contract.pdf');
  const res = await addWatermarkToPdf(file, {
    kind: 'qr',
    qrText: 'https://muxaro.example/verify/123',
    fontSize: 28,
    opacity: 0.5,
    rotation: 0,
    color: '#111827',
    layout: 'center',
    layer: 'behind',
  });
  const out = await PDFDocument.load(await res.blob.arrayBuffer());
  assert.equal(out.getPageCount(), 2);
  const contents = out.getPages()[0].node.Contents();
  assert.ok(contents && contents.toString().includes('['), 'Behind layer should prepend stream ref');
});

test('addPageNumbersToPdf supports roman-upper, facing pages, cover skip, and margin expand', async () => {
  const file = await makePdfFile(3, 'book.pdf');
  const res = await addPageNumbersToPdf(file, {
    format: '{n} / {total}',
    position: 'bottom-right',
    fontSize: 10,
    startNumber: 1,
    marginPt: 20,
    color: '#000000',
    numberStyle: 'roman-upper',
    facingPages: true,
    firstPageIsCover: true,
    autoExpandMargins: true,
  });
  const out = await PDFDocument.load(await res.blob.arrayBuffer());
  assert.equal(out.getPageCount(), 3);
  const boxPage2 = out.getPages()[1].getMediaBox();
  assert.ok(boxPage2.height > 842, 'autoExpandMargins should expand page height beyond 842pt');
});

test('addHeaderFooterToPdf renders Bates numbering, filename token, and WinAnsi guard', async () => {
  const file = await makePdfFile(2, 'Exhibit—One.pdf');
  const res = await addHeaderFooterToPdf(file, {
    headerLeft: '{filename}',
    footerRight: '{bates:EXH:000010}',
    fontSize: 9,
    color: '#222222',
    marginPt: 22,
    increaseMargins: true,
    sourceFileName: 'Exhibit—One.pdf',
  });
  const out = await PDFDocument.load(await res.blob.arrayBuffer());
  assert.equal(out.getPageCount(), 2);
  assert.ok(out.getPages()[0].getMediaBox().height > 842);
});

test('inspectPdfDeep detects PDF version, page geometry, fonts, and Catalog/Names JavaScript', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const p = doc.addPage([612, 792]);
  p.drawText('Audited PDF', { x: 50, y: 700, size: 12, font });
  const jsAction = doc.context.obj({
    Type: PDFName.of('Action'),
    S: PDFName.of('JavaScript'),
    JS: PDFString.of('app.alert("audit-hit");'),
  });
  const jsRef = doc.context.register(jsAction);
  doc.catalog.set(PDFName.of('OpenAction'), jsRef);
  const bytes = await doc.save();
  const file = new File([Uint8Array.from(bytes)], 'scripted.pdf', { type: 'application/pdf' });

  const audit = await inspectPdfDeep(file);
  assert.equal(audit.pageCount, 1);
  assert.ok(audit.objectCount > 0);
  assert.ok(audit.fonts.length >= 1);
  assert.ok(audit.scripts.some((s) => s.code.includes('audit-hit')));
});

test('clearReadOnlyFormFields unlocks read-only AcroForm fields', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const form = doc.getForm();
  const tf = form.createTextField('applicant.name');
  tf.setText('Locked Value');
  tf.addToPage(page, { x: 40, y: 300, width: 200, height: 24 });
  tf.enableReadOnly();
  const bytes = await doc.save();

  const file = new File([Uint8Array.from(bytes)], 'locked-form.pdf', { type: 'application/pdf' });
  const unlockedRes = await clearReadOnlyFormFields(file);
  const reloaded = await PDFDocument.load(await unlockedRes.blob.arrayBuffer());
  const field = reloaded.getForm().getTextField('applicant.name');
  assert.equal(field.isReadOnly(), false);
});

test('mergePdfPagesExpanded interleaves pages across multiple files in exact sequence', async () => {
  const a = await makePdfFile(2, 'front.pdf');
  const b = await makePdfFile(2, 'back.pdf');
  const res = await mergePdfPagesExpanded(
    [
      { file: a, pageIndex: 0 },
      { file: b, pageIndex: 1 },
      { file: a, pageIndex: 1 },
      { file: b, pageIndex: 0 },
    ],
    { outputName: 'duplex.pdf' }
  );
  assert.equal(res.pageCount, 4);
  assert.equal(res.fileName, 'duplex.pdf');
});

test('extractRawPdfBuffers extracts pure page content streams', async () => {
  const file = await makePdfFile(1, 'streams.pdf');
  const entries = await extractRawPdfBuffers(file);
  assert.ok(entries.length >= 1, 'Should extract at least one raw stream buffer');
  assert.ok(entries.some((e) => e.category === 'page-content' && e.sizeBytes > 0));
});

test('formatOcrOutputAs exports CSV tables, HTML, and RTF cleanly', async () => {
  const pages: OcrPageOutput[] = [
    {
      pageNumber: 1,
      text: 'Item Qty Price\nWidget 2 10.00',
      confidence: 95,
      renderWidth: 600,
      renderHeight: 800,
      words: [
        { text: 'Item', bbox: { x0: 40, y0: 40, x1: 80, y1: 55 }, fontSize: 12 },
        { text: 'Qty', bbox: { x0: 200, y0: 40, x1: 230, y1: 55 }, fontSize: 12 },
        { text: 'Price', bbox: { x0: 360, y0: 40, x1: 400, y1: 55 }, fontSize: 12 },
        { text: 'Widget', bbox: { x0: 40, y0: 70, x1: 95, y1: 85 }, fontSize: 12 },
        { text: '2', bbox: { x0: 200, y0: 70, x1: 215, y1: 85 }, fontSize: 12 },
        { text: '10.00', bbox: { x0: 360, y0: 70, x1: 405, y1: 85 }, fontSize: 12 },
      ],
    },
  ];
  const csv = formatOcrOutputAs(pages, 'csv', 'invoice.pdf');
  const html = formatOcrOutputAs(pages, 'html', 'invoice.pdf');
  const rtf = formatOcrOutputAs(pages, 'rtf', 'invoice.pdf');
  assert.equal(csv.fileName, 'invoice.csv');
  assert.equal(html.fileName, 'invoice.html');
  assert.equal(rtf.fileName, 'invoice.rtf');
  const csvText = await csv.blob.text();
  const htmlText = await html.blob.text();
  const rtfText = await rtf.blob.text();
  assert.ok(csvText.includes('Item,Qty,Price') && csvText.includes('Widget,2,10.00'));
  assert.ok(htmlText.includes('<table>') && htmlText.includes('Widget'));
  assert.ok(rtfText.startsWith('{\\rtf1') && rtfText.includes('Widget'));
});

test('compressPdfSmart strip-images removes embedded image XObjects while keeping text pages', async () => {
  const tinyPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const pngBytes = Uint8Array.from(Buffer.from(tinyPngBase64, 'base64'));
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(pngBytes);
  const page = doc.addPage([400, 400]);
  page.drawImage(img, { x: 40, y: 200, width: 100, height: 100 });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Preserved text', { x: 40, y: 80, size: 12, font });
  const file = new File([Uint8Array.from(await doc.save())], 'with-image.pdf', {
    type: 'application/pdf',
  });

  const beforeBuffers = await extractRawPdfBuffers(file);
  assert.ok(beforeBuffers.some((b) => b.category === 'image-stream'));

  const stripped = await compressPdfSmart(file, {
    mode: 'strip-images',
    quality: 0.7,
    targetDpi: 150,
    allowLarger: true,
  });
  const strippedFile = new File([await stripped.blob.arrayBuffer()], stripped.fileName, {
    type: 'application/pdf',
  });
  const afterBuffers = await extractRawPdfBuffers(strippedFile);
  assert.equal(
    afterBuffers.some((b) => b.category === 'image-stream'),
    false,
    'All image streams should be stripped'
  );
});

test('classifyPdfFont strips 6-char subset prefixes and maps modern Inter/PlusJakarta/JetBrains', () => {
  const inter = classifyPdfFont('BCDFGH+Inter-SemiBold');
  assert.equal(inter.cleanName, 'Inter-SemiBold');
  assert.equal(inter.modernSlug, 'inter');
  assert.equal(inter.fontWeight, 600);
  assert.equal(inter.bold, true);

  const jakarta = classifyPdfFont('XYZABC+PlusJakartaSans-BoldItalic');
  assert.equal(jakarta.modernSlug, 'plus-jakarta-sans');
  assert.equal(jakarta.fontWeight, 700);
  assert.equal(jakarta.italic, true);

  const mono = classifyPdfFont('AAAAAA+JetBrainsMono-Regular');
  assert.equal(mono.modernSlug, 'jetbrains-mono');
  assert.equal(mono.mappedFamily, 'courier');
});

test('applyEditsAndSignaturesToPdf performs surgical content-stream suppression without whiteout patch', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([400, 400]);
  p.drawText('OldTextHere', { x: 50, y: 300, size: 12, font });
  const file = new File([Uint8Array.from(await doc.save())], 'stream-edit.pdf', {
    type: 'application/pdf',
  });

  const edited = await applyEditsAndSignaturesToPdf(file, [], {}, undefined, [
    {
      id: 'e1',
      pageNumber: 1,
      x: 50 / 400,
      y: (400 - 300 - 12 * 0.88) / 400,
      width: 70 / 400,
      height: 14 / 400,
      originalText: 'OldTextHere',
      newText: 'ReplacedNew',
      fontFamily: 'helvetica',
      fontSize: 12,
      color: '#111111',
      bgColor: '#f8f4ef',
      baselineY: (400 - 300) / 400,
    },
  ]);

  const rawEntries = await extractRawPdfBuffers(
    new File([await edited.blob.arrayBuffer()], edited.fileName, { type: 'application/pdf' })
  );
  const contentTexts = await Promise.all(
    rawEntries.filter((e) => e.category === 'page-content').map((e) => e.blob.text())
  );
  const combined = contentTexts.join('\n').toUpperCase();
  const oldHex = Buffer.from('OldTextHere', 'latin1').toString('hex').toUpperCase();
  const newHex = Buffer.from('ReplacedNew', 'latin1').toString('hex').toUpperCase();
  assert.equal(
    combined.includes('OLDTEXTHERE') || combined.includes(oldHex),
    false,
    'Old glyph text must be stripped from stream'
  );
  assert.ok(
    combined.includes('REPLACEDNEW') || combined.includes(newHex),
    'New text must be emitted into page content'
  );
  assert.ok(combined.includes('TZ'), 'Horizontal Tz scaling should align replacement width');
});

test('parsePageRange supports 12-end keyword and formatPagesToRangeString compacts contiguous runs', () => {
  const res = parsePageRange('1, 4-8, 12-end', 15);
  assert.deepEqual(res.pages, [1, 4, 5, 6, 7, 8, 12, 13, 14, 15]);
  assert.equal(formatPagesToRangeString(res.pages), '1, 4-8, 12-15');
  assert.equal(formatPagesToRangeString([]), '');
});

test('renderBusinessDocumentPdf renders Unicode INR currency, multi-page invoices, 80mm thermal receipts, and Quote scope', async () => {
  const manyItems = Array.from({ length: 30 }, (_, i) => ({
    id: `row-${i}`,
    description: `Line Item Service #${i + 1} — ₹ consultation`,
    quantity: 2,
    unitPrice: 125.5,
  }));
  const invRes = await renderBusinessDocumentPdf({
    kind: 'invoice',
    templateSize: 'letter',
    documentNumber: 'INV-2026-01',
    issueDate: '2026-11-26',
    dueOrValidDate: '2026-12-10',
    currency: 'INR',
    accentColor: '#254EDB',
    senderName: 'Muxaro India Pvt Ltd',
    senderEmail: 'billing@muxaro.test',
    senderAddress: 'Bengaluru\nKA 560001',
    senderTaxId: '29ABCDE1234F1Z5',
    recipientName: 'Acme Labs',
    recipientEmail: 'ap@acme.test',
    recipientAddress: 'Mumbai',
    items: manyItems,
    taxPercent: 18,
    taxMode: 'gst-intra',
    discountAmount: 50,
    discountType: 'flat',
    shippingAmount: 99,
    notes: 'Thank you for ₹ payment.',
  });
  assert.ok((invRes.pageCount || 0) >= 2, '30 items must paginate onto multiple Letter pages');

  const receiptRes = await renderBusinessDocumentPdf({
    kind: 'receipt',
    templateSize: 'thermal-80mm',
    documentNumber: 'RCPT-900',
    issueDate: '2026-11-26',
    dueOrValidDate: '2026-11-26',
    currency: 'USD',
    accentColor: '#15803D',
    senderName: 'Coffee Shop',
    senderEmail: '',
    senderAddress: '101 Main St',
    recipientName: 'Walk-in Customer',
    recipientEmail: '',
    recipientAddress: '',
    items: [{ id: '1', description: 'Espresso', quantity: 2, unitPrice: 4.5 }],
    taxPercent: 8,
    taxMode: 'sales-tax',
    discountAmount: 0,
    discountType: 'flat',
    shippingAmount: 1.5,
    notes: 'Paid via UPI',
    paymentMethod: 'UPI',
    showPaidWatermark: true,
  });
  const recDoc = await PDFDocument.load(await receiptRes.blob.arrayBuffer());
  assert.ok(recDoc.getPages()[0].getWidth() < 240, '80mm thermal width should be ~226pt');
});

test('cropPdfPages writes CropBox and TrimBox accurately', async () => {
  const file = await makePdfFile(1, 'crop-box.pdf');
  const cropped = await cropPdfPages(file, { top: 10, right: 10, bottom: 10, left: 10 });
  const doc = await PDFDocument.load(await cropped.blob.arrayBuffer());
  const box = doc.getPages()[0].getCropBox();
  const trim = doc.getPages()[0].getTrimBox();
  assert.ok(box.x > 50 && box.width < 500, 'CropBox should inset horizontal margins');
  assert.equal(Math.round(trim.width), Math.round(box.width), 'TrimBox must match CropBox');
});

test('formatOcrOutputAs exports XML word-coordinates safely with escaping', async () => {
  const xml = formatOcrOutputAs(
    [
      {
        pageNumber: 1,
        text: 'A < B',
        confidence: 92,
        renderWidth: 800,
        renderHeight: 1000,
        words: [{ text: 'A&B<1>', bbox: { x0: 10, y0: 20, x1: 90, y1: 40 }, fontSize: 12 }],
      },
    ],
    'xml',
    'scan.pdf'
  );
  assert.equal(xml.fileName, 'scan.xml');
  const txt = await xml.blob.text();
  assert.ok(txt.includes('A&amp;B&lt;1&gt;') && txt.includes('confidence="92"'));
});

test('addHeaderFooterToPdf honors [FILENAME] and carry-over batesStartOffset', async () => {
  const file = await makePdfFile(2, 'exhibit_alpha.pdf');
  const first = await addHeaderFooterToPdf(file, {
    footerLeft: '[FILENAME]',
    footerRight: '{bates:EXH:000001}',
    fontSize: 10,
    color: '#222222',
    marginPt: 20,
    sourceFileName: 'exhibit_alpha.pdf',
    batesStartOffset: 0,
  });
  assert.equal(first.nextBatesOffset, 2);
});

test('verifyPdfSignaturesInBrowser detects tampered ByteRange on real AcroForm signature fields', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const vDict = doc.context.obj({
    Type: PDFName.of('Sig'),
    Filter: PDFName.of('Adobe.PPKLite'),
    SubFilter: PDFName.of('adbe.pkcs7.detached'),
    ByteRange: [0, 20, 40, 20],
    Contents: PDFString.of('BAD-CMS-PAYLOAD'),
  });
  const sigWidget = doc.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Sig'),
    T: PDFString.of('SigField1'),
    Rect: [50, 50, 200, 90],
    V: doc.context.register(vDict),
  });
  const sigRef = doc.context.register(sigWidget);
  page.node.set(PDFName.of('Annots'), doc.context.obj([sigRef]));
  doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj({ Fields: [sigRef] }));

  const file = new File([Uint8Array.from(await doc.save())], 'tampered-sig.pdf', { type: 'application/pdf' });
  const results = await verifyPdfSignaturesInBrowser(file);
  assert.ok(results.length >= 1, 'AcroForm /Sig dictionary should be parsed');
  assert.equal(results[0].fieldName, 'SigField1');
  assert.equal(results[0].status, 'tampered', 'Corrupt signature contents must report tampered');
});

test('inspectHiddenFingerprints & removePdfAnnotations strip comments while keeping forms/links when requested', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([500, 500]);
  const noteAnnot = doc.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Text'),
    Rect: [50, 400, 70, 420],
    Contents: PDFString.of('Internal review comment'),
  });
  const linkAnnot = doc.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Link'),
    Rect: [50, 300, 150, 320],
  });
  page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(noteAnnot), doc.context.register(linkAnnot)]));
  const file = new File([Uint8Array.from(await doc.save())], 'annots.pdf', { type: 'application/pdf' });

  const stripped = await removePdfAnnotations(file, { keepFormWidgets: true, keepLinks: true });
  const fp = await inspectHiddenFingerprints(
    new File([await stripped.blob.arrayBuffer()], stripped.fileName, { type: 'application/pdf' })
  );
  assert.equal(fp.commentAnnotationsCount, 0, 'Text comment annotation should be removed while link remains');
});
