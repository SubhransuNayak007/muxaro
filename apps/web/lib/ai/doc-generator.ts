import { jsPDF } from 'jspdf';
import { renderBusinessDocumentPdf } from '@/lib/pdf/business-docs';
import { sanitizeFilenameStem } from '@/lib/pdf/errors';

/**
 * Generates an Invoice / Quote / Receipt or Clean Styled Study/Report PDF
 * directly from natural-language chat prompts cleanly offline.
 */
export async function generatePdfFromChatPrompt(prompt: string): Promise<{
  file: File;
  summary: string;
}> {
  const clean = prompt.trim();
  const isInvoice = /\b(invoice|bill)\b/i.test(clean);
  const isQuote = /\b(quote|estimate|proposal)\b/i.test(clean);
  const isReceipt = /\b(receipt|payment\s*proof)\b/i.test(clean);

  if (isInvoice || isQuote || isReceipt) {
    const amountMatch = clean.match(/(?:₹|INR|Rs\.?|\$|EUR|€|£)\s*([\d,]+(?:\.\d{1,2})?)/i);
    const rawNum = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : 25000;
    const amount = Number.isFinite(rawNum) && rawNum > 0 ? rawNum : 25000;
    const currency = /₹|inr|rs\.?/i.test(clean)
      ? 'INR'
      : /€|eur/i.test(clean)
        ? 'EUR'
        : /£|gbp/i.test(clean)
          ? 'GBP'
          : clean.includes('$')
            ? 'USD'
            : 'USD';

    const forMatch = clean.match(/\bfor\s+([A-Za-z0-9 &.,'-]{3,48})(?:\s+for\s+([A-Za-z0-9 &.,'-]{2,40}))?/i);
    const recipientMatch = clean.match(/\bto\s+([A-Za-z0-9 &.,'-]{2,40})/i);
    const serviceDesc = (forMatch?.[1] || 'Professional Services').trim();
    const clientName = (forMatch?.[2] || recipientMatch?.[1] || 'Valued Client').trim();
    const today = new Date().toISOString().slice(0, 10);
    const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    const kind = isQuote ? 'quote' : isReceipt ? 'receipt' : 'invoice';
    const hasGst = /\bgst\b/i.test(clean);

    const res = await renderBusinessDocumentPdf({
      kind,
      templateSize: 'a4',
      documentNumber: `${kind.slice(0, 3).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`,
      issueDate: today,
      dueOrValidDate: due,
      currency,
      accentColor: '#254EDB',
      senderName: 'Your Business Studio',
      senderEmail: 'billing@studio.local',
      senderAddress: 'Editable inside Invoice Maker',
      recipientName: clientName,
      recipientEmail: '',
      recipientAddress: '',
      items: [
        {
          id: 'item-1',
          description: serviceDesc,
          quantity: 1,
          unitPrice: amount,
        },
      ],
      taxPercent: hasGst ? 18 : 0,
      taxMode: hasGst ? 'gst-intra' : 'standard',
      discountAmount: 0,
      discountType: 'flat',
      notes: 'Generated locally by MUXARO Studio.',
    });

    const file = new File([res.blob], res.fileName, { type: 'application/pdf' });
    return {
      file,
      summary: `Created A4 ${kind} (${res.fileName}) for ${clientName}.`,
    };
  }

  // Generic styled PDF note / report
  const titleMatch = clean.replace(/^(?:create|make|generate|write|export)\s+(?:a|an)?\s*(?:pdf|report|notes|summary)?\s*(?:about|on|for)?/i, '').trim();
  const title = (titleMatch || 'Document Notes').slice(0, 64);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(title, 48, 68);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  const lines = doc.splitTextToSize(clean, 498);
  doc.text(lines, 48, 104);
  const blob = doc.output('blob');
  const fileName = `${sanitizeFilenameStem(title, 'muxaro-notes')}.pdf`;
  return {
    file: new File([blob], fileName, { type: 'application/pdf' }),
    summary: `Created formatted PDF "${fileName}".`,
  };
}

export async function generateStructuredNotesPdf(
  title: string,
  transcriptOrNotes: string,
  subtitle = 'Generated locally by MUXARO Studio'
): Promise<{ file: File; summary: string }> {
  const cleanTitle = (title.trim() || 'Transcript Notes').slice(0, 72);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const maxWidth = pageWidth - margin * 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(cleanTitle, margin, 64, { maxWidth });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(100, 108, 120);
  doc.text(subtitle, margin, 84);
  doc.setTextColor(18, 20, 24);

  doc.setFontSize(11);
  const lines: string[] = doc.splitTextToSize(transcriptOrNotes.trim() || '(Empty transcript)', maxWidth);
  let y = 112;
  const lineHeight = 16;
  for (const line of lines) {
    if (y > pageHeight - 54) {
      doc.addPage();
      y = 56;
    }
    doc.text(line, margin, y);
    y += lineHeight;
  }

  const blob = doc.output('blob');
  const fileName = `${sanitizeFilenameStem(cleanTitle, 'transcript-notes')}.pdf`;
  return {
    file: new File([blob], fileName, { type: 'application/pdf' }),
    summary: `Compiled ${doc.getNumberOfPages()}-page structured notes PDF "${fileName}".`,
  };
}
