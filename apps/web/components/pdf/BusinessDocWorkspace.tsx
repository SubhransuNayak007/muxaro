'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Eye, X, Upload, ArrowRight, CheckCircle2 } from 'lucide-react';
import PdfToolShell from './PdfToolShell';
import {
  type BusinessDocInput,
  type BusinessDocKind,
  type BusinessDocLineItem,
  loadPdfJsDocument,
  renderBusinessDocumentPdf,
  renderPdfPageToBlob,
} from '@/lib/pdf';

const SENDER_STORAGE_KEY = 'muxaro.pdf.business.sender.v1';
const QUOTE_HANDOFF_KEY = 'muxaro_pdf_quote_handoff';
const INVOICE_SEQ_KEY = 'muxaro.pdf.invoice.seq.v1';

function formatLocalYmd(d: Date): string {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
}

export default function BusinessDocWorkspace({
  kind,
  currentHref,
}: {
  kind: BusinessDocKind;
  currentHref: string;
}) {
  const titleMap: Record<BusinessDocKind, { title: string; desc: string; cta: string; prefix: string }> = {
    invoice: {
      title: 'Invoice maker',
      desc: 'Unicode A4/Letter/A6 invoice builder with logo, GST/VAT/Sales Tax breakdown, custom labels & live PDF preview.',
      cta: 'Download Invoice PDF',
      prefix: 'INV-001',
    },
    receipt: {
      title: 'Receipt maker',
      desc: 'Payment receipt generator with A4, Letter, A6, or 80mm thermal POS templates, UPI/Card badges & PAID stamp.',
      cta: 'Download Receipt PDF',
      prefix: 'RCPT-001',
    },
    quote: {
      title: 'Quote & estimate maker',
      desc: 'Create itemized client proposals with Scope of Work, Terms, Acceptance Signature & 1-click Quote-to-Invoice conversion.',
      cta: 'Download Quote PDF',
      prefix: 'QTE-001',
    },
  };
  const meta = titleMap[kind];

  const today = formatLocalYmd(new Date());
  const dueDefault = formatLocalYmd(new Date(Date.now() + 14 * 86400_000));

  const [form, setForm] = useState<BusinessDocInput>({
    kind,
    templateSize: 'a4',
    documentNumber: meta.prefix,
    issueDate: today,
    dueOrValidDate: dueDefault,
    currency: 'USD',
    accentColor: '#5562F0',
    senderName: '',
    senderEmail: '',
    senderAddress: '',
    senderTaxId: '',
    recipientName: '',
    recipientEmail: '',
    recipientAddress: '',
    recipientTaxId: '',
    items: [
      { id: 'item-1', description: 'Design & consulting services', quantity: 1, unitPrice: 450 },
    ],
    taxPercent: 0,
    taxMode: 'standard',
    discountAmount: 0,
    discountType: 'flat',
    shippingAmount: 0,
    notes: kind === 'invoice' ? 'Thank you for your business.' : '',
    paymentMethod: 'Bank Transfer',
    paymentReference: '',
    statusStamp: kind === 'receipt' ? 'PAID' : '',
    showPaidWatermark: false,
    scopeOfWork: '',
    termsAndConditions: '',
    acceptanceSignature: { enabled: kind === 'quote' },
    customLabels: {
      tax: '',
      notes: '',
      total: '',
      billTo: '',
    },
  });

  const router = useRouter();
  const [livePreviewUrl, setLivePreviewUrl] = useState<string | null>(null);
  const [modalPreviewUrl, setModalPreviewUrl] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [handoffNotice, setHandoffNotice] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SENDER_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<BusinessDocInput>;
      const savedNotes = parsed.notes;
        setForm((prev) => ({
          ...prev,
          senderName: parsed.senderName || prev.senderName,
          senderEmail: parsed.senderEmail || prev.senderEmail,
          senderAddress: parsed.senderAddress || prev.senderAddress,
          senderTaxId: parsed.senderTaxId || prev.senderTaxId,
          accentColor: parsed.accentColor || prev.accentColor,
          currency: parsed.currency || prev.currency,
          logoDataUrl: parsed.logoDataUrl || prev.logoDataUrl,
          notes: savedNotes !== undefined ? savedNotes : prev.notes,
        }));
      }
    } catch {}
    try {
      if (kind === 'invoice') {
        const storedSeq = Number.parseInt(localStorage.getItem(INVOICE_SEQ_KEY) || '0', 10) || 0;
        if (storedSeq >= 1) {
          setForm((prev) => ({
            ...prev,
            documentNumber: `INV-${String(storedSeq + 1).padStart(3, '0')}`,
          }));
        }
      }
    } catch {}
  }, [kind]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalPreviewUrl) setModalPreviewUrl(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalPreviewUrl]);

  useEffect(() => {
    return () => {
      if (livePreviewUrl) URL.revokeObjectURL(livePreviewUrl);
      if (modalPreviewUrl) URL.revokeObjectURL(modalPreviewUrl);
    };
  }, [livePreviewUrl, modalPreviewUrl]);

  useEffect(() => {
    if (kind !== 'invoice' || typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('handoff') !== 'quote') return;
    try {
      const raw = localStorage.getItem(QUOTE_HANDOFF_KEY);
      if (!raw) return;
      const payload = JSON.parse(raw) as Partial<BusinessDocInput> & {
        sourceQuoteNumber?: string;
        timestamp?: number;
      };
      localStorage.removeItem(QUOTE_HANDOFF_KEY);

      const prevSeq = Number.parseInt(localStorage.getItem(INVOICE_SEQ_KEY) || '0', 10) || 0;
      const quoteDigitsMatch = /(\d+)$/.exec(payload.sourceQuoteNumber || '');
      const nextNum = Math.max(prevSeq + 1, quoteDigitsMatch ? Number.parseInt(quoteDigitsMatch[1], 10) : 1);
      localStorage.setItem(INVOICE_SEQ_KEY, String(nextNum));
      const invNumber = `INV-${String(nextNum).padStart(3, '0')}`;

      setForm((prev) => ({
        ...prev,
        documentNumber: invNumber,
        currency: payload.currency || prev.currency,
        accentColor: payload.accentColor || prev.accentColor,
        senderName: payload.senderName || prev.senderName,
        senderEmail: payload.senderEmail || prev.senderEmail,
        senderAddress: payload.senderAddress || prev.senderAddress,
        senderTaxId: payload.senderTaxId ?? prev.senderTaxId,
        recipientName: payload.recipientName || prev.recipientName,
        recipientEmail: payload.recipientEmail || prev.recipientEmail,
        recipientAddress: payload.recipientAddress || prev.recipientAddress,
        recipientTaxId: payload.recipientTaxId ?? prev.recipientTaxId,
        items: Array.isArray(payload.items) && payload.items.length > 0 ? payload.items : prev.items,
        taxPercent: typeof payload.taxPercent === 'number' ? payload.taxPercent : prev.taxPercent,
        taxMode: payload.taxMode || prev.taxMode,
        discountAmount: typeof payload.discountAmount === 'number' ? payload.discountAmount : prev.discountAmount,
        discountType: payload.discountType || prev.discountType,
        shippingAmount: typeof payload.shippingAmount === 'number' ? payload.shippingAmount : prev.shippingAmount,
        notes: payload.notes || prev.notes,
        logoDataUrl: payload.logoDataUrl || prev.logoDataUrl,
      }));
      setHandoffNotice(
        `Imported line items and customer details from Quote ${payload.sourceQuoteNumber || ''} as ${invNumber}.`
      );
    } catch {}
  }, [kind]);

  const handleConvertQuoteToInvoice = () => {
    try {
      localStorage.setItem(
        QUOTE_HANDOFF_KEY,
        JSON.stringify({
          sourceQuoteNumber: form.documentNumber,
          currency: form.currency,
          accentColor: form.accentColor,
          senderName: form.senderName,
          senderEmail: form.senderEmail,
          senderAddress: form.senderAddress,
          senderTaxId: form.senderTaxId,
          recipientName: form.recipientName,
          recipientEmail: form.recipientEmail,
          recipientAddress: form.recipientAddress,
          recipientTaxId: form.recipientTaxId,
          dueOrValidDate: form.dueOrValidDate,
          items: form.items,
          taxPercent: form.taxPercent,
          taxMode: form.taxMode,
          discountAmount: form.discountAmount,
          discountType: form.discountType,
          shippingAmount: form.shippingAmount,
          notes: form.notes,
          termsAndConditions: form.termsAndConditions,
          logoDataUrl: form.logoDataUrl,
          timestamp: Date.now(),
        })
      );
      router.push('/tools/pdf/invoice?handoff=quote');
    } catch {}
  };

  // Debounced live side-by-side WYSIWYG canvas preview
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await renderBusinessDocumentPdf(form);
        const pdf = await loadPdfJsDocument(new Uint8Array(await res.blob.arrayBuffer()));
        const { blob } = await renderPdfPageToBlob(pdf, 1, { scale: 1.15, format: 'png' });
        await pdf.destroy();
        URL.revokeObjectURL(res.url);
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setLivePreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch {
        // Ignore transient invalid edits
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form]);

  const persistSender = (next: BusinessDocInput) => {
    try {
      localStorage.setItem(
        SENDER_STORAGE_KEY,
        JSON.stringify({
          senderName: next.senderName,
          senderEmail: next.senderEmail,
          senderAddress: next.senderAddress,
          senderTaxId: next.senderTaxId,
          accentColor: next.accentColor,
          currency: next.currency,
          logoDataUrl: next.logoDataUrl,
          notes: next.notes,
        })
      );
    } catch {}
  };

  const updateField = <K extends keyof BusinessDocInput>(key: K, val: BusinessDocInput[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: val };
      persistSender(next);
      return next;
    });
  };

  const updateItem = (id: string, patch: Partial<BusinessDocLineItem>) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    }));
  };

  const totals = useMemo(() => {
    const subtotal = form.items.reduce(
      (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
      0
    );
    const rawDisc = Math.max(0, Number(form.discountAmount) || 0);
    const disc = form.discountType === 'percent' ? subtotal * (rawDisc / 100) : rawDisc;
    const base = Math.max(0, subtotal - disc);
    const tax = base * (Math.max(0, Number(form.taxPercent) || 0) / 100);
    const ship = Math.max(0, Number(form.shippingAmount) || 0);
    return { subtotal, disc, tax, ship, total: Math.max(0, base + tax + ship) };
  }, [form.items, form.taxPercent, form.discountAmount, form.discountType, form.shippingAmount]);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        updateField('logoDataUrl', reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFullModalPreview = async () => {
    setPreviewBusy(true);
    try {
      const res = await renderBusinessDocumentPdf(form);
      const pdf = await loadPdfJsDocument(new Uint8Array(await res.blob.arrayBuffer()));
      const { blob } = await renderPdfPageToBlob(pdf, 1, { scale: 1.6, format: 'png' });
      await pdf.destroy();
      URL.revokeObjectURL(res.url);
      if (modalPreviewUrl) URL.revokeObjectURL(modalPreviewUrl);
      setModalPreviewUrl(URL.createObjectURL(blob));
    } finally {
      setPreviewBusy(false);
    }
  };

  return (
    <PdfToolShell
      title={meta.title}
      description={meta.desc}
      currentHref={currentHref}
      requiresFile={false}
      submitLabel={meta.cta}
      onRun={async (onProgress) => {
        onProgress(35, 'Composing PDF…');
        const res = await renderBusinessDocumentPdf(form);
        if (kind === 'invoice') {
          try {
            const digits = /(\d+)$/.exec(form.documentNumber || '');
            if (digits) {
              localStorage.setItem(INVOICE_SEQ_KEY, String(Number.parseInt(digits[1], 10) || 1));
            }
          } catch {}
        }
        onProgress(100, 'Done');
        return res;
      }}
    >
      {handoffNotice && (
        <div className="mb-4 p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-xs text-content flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden="true" />
            <span>{handoffNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setHandoffNotice(null)}
            aria-label="Dismiss import notice"
            className="p-1 rounded hover:bg-surface-elevated text-content-secondary"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Form Controls (7 cols) */}
        <div className="xl:col-span-7 space-y-4">
          {/* Template & Branding Strip */}
          <div className="p-4 rounded-2xl border border-line bg-surface flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(kind === 'receipt'
                ? ([
                    ['a4', 'A4'],
                    ['letter', 'Letter'],
                    ['a6', 'A6 Card'],
                    ['thermal-80mm', '80mm Thermal'],
                  ] as const)
                : ([
                    ['a4', 'A4'],
                    ['letter', 'US Letter'],
                    ['a6', 'A6 Compact'],
                  ] as const)
              ).map(([sizeId, sizeLabel]) => (
                <button
                  key={sizeId}
                  type="button"
                  onClick={() => updateField('templateSize', sizeId)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border ${
                    form.templateSize === sizeId
                      ? 'bg-brand text-white border-brand'
                      : 'bg-surface-elevated border-line text-content'
                  }`}
                >
                  {sizeLabel}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={form.currency}
                onChange={(e) => updateField('currency', e.target.value)}
                className="px-2.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
                aria-label="Currency"
              >
                <option value="USD">USD ($)</option>
                <option value="INR">INR</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="AUD">AUD</option>
                <option value="CAD">CAD</option>
              </select>
              <input
                type="text"
                placeholder="Stamp (e.g. PAID)"
                value={form.statusStamp || ''}
                onChange={(e) => updateField('statusStamp', e.target.value)}
                className="w-28 px-2.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
              />
              <input
                type="color"
                value={form.accentColor}
                onChange={(e) => updateField('accentColor', e.target.value)}
                aria-label="Accent color"
                className="w-8 h-8 rounded-lg border border-line cursor-pointer"
              />
              {kind === 'quote' && (
                <button
                  type="button"
                  onClick={handleConvertQuoteToInvoice}
                  className="px-3.5 py-1.5 rounded-xl bg-brand text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-brand-hover"
                >
                  <span>Convert to Invoice</span>
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {/* Sender + Client */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl border border-line bg-surface space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold text-content">From (Saved locally)</h2>
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-1 text-xs font-medium text-brand cursor-pointer">
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{form.logoDataUrl ? 'Change logo' : 'Add logo'}</span>
                    <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={handleLogoUpload} />
                  </label>
                  {form.logoDataUrl && (
                    <button
                      type="button"
                      onClick={() => updateField('logoDataUrl', undefined)}
                      className="text-[11px] text-error hover:underline"
                    >
                      Clear logo
                    </button>
                  )}
                </div>
              </div>
              <input
                type="text"
                placeholder="Business or full name"
                value={form.senderName}
                onChange={(e) => updateField('senderName', e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
              />
              <input
                type="text"
                placeholder="Tax ID / GSTIN (optional)"
                value={form.senderTaxId || ''}
                onChange={(e) => updateField('senderTaxId', e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
              />
              <input
                type="email"
                placeholder="Email"
                value={form.senderEmail}
                onChange={(e) => updateField('senderEmail', e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
              />
              <textarea
                rows={2}
                placeholder="Street address, city"
                value={form.senderAddress}
                onChange={(e) => updateField('senderAddress', e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
              />
            </div>

            <div className="p-4 rounded-2xl border border-line bg-surface space-y-2.5">
              <h2 className="text-xs font-bold text-content">
                {kind === 'receipt' ? 'Received From' : 'Bill To'} &amp; Dates
              </h2>
              <input
                type="text"
                placeholder="Document #"
                value={form.documentNumber}
                onChange={(e) => updateField('documentNumber', e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
              />
              <input
                type="text"
                placeholder="Client / Recipient name"
                value={form.recipientName}
                onChange={(e) => updateField('recipientName', e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
              />
              <input
                type="text"
                placeholder="Client Tax ID / GSTIN (optional)"
                value={form.recipientTaxId || ''}
                onChange={(e) => updateField('recipientTaxId', e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={form.issueDate}
                  onChange={(e) => updateField('issueDate', e.target.value)}
                  className="px-2.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
                  aria-label="Issue date"
                />
                <input
                  type="date"
                  value={form.dueOrValidDate}
                  onChange={(e) => updateField('dueOrValidDate', e.target.value)}
                  className="px-2.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
                  aria-label="Due or valid date"
                />
              </div>
              <textarea
                rows={1}
                placeholder="Client address"
                value={form.recipientAddress}
                onChange={(e) => updateField('recipientAddress', e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
              />
            </div>
          </div>

          {/* Line Items & Tax/GST */}
          <div className="p-4 rounded-2xl border border-line bg-surface space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-content">Line items</h2>
              <button
                type="button"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    items: [
                      ...prev.items,
                      { id: `item-${Date.now()}`, description: '', quantity: 1, unitPrice: 0 },
                    ],
                  }))
                }
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-line bg-surface-elevated text-xs font-semibold"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Add item</span>
              </button>
            </div>

            <div className="space-y-2">
              {form.items.map((item) => (
                <div key={item.id} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    type="text"
                    placeholder="Description"
                    value={item.description}
                    onChange={(e) => updateItem(item.id, { description: e.target.value })}
                    className="col-span-6 px-2.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
                  />
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={item.quantity}
                    onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) })}
                    className="col-span-2 px-2.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
                  />
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={item.unitPrice}
                    onChange={(e) => updateItem(item.id, { unitPrice: Number(e.target.value) })}
                    className="col-span-3 px-2.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
                  />
                  <button
                    type="button"
                    disabled={form.items.length <= 1}
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        items: prev.items.filter((i) => i.id !== item.id),
                      }))
                    }
                    aria-label="Remove item"
                    className="col-span-1 p-1.5 text-content-secondary hover:text-error disabled:opacity-30"
                  >
                    <Trash2 className="w-3.5 h-3.5 mx-auto" />
                  </button>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-line">
              <label className="text-[11px] text-content-secondary space-y-1">
                <span>Tax Mode</span>
                <select
                  value={form.taxMode || 'standard'}
                  onChange={(e) => updateField('taxMode', e.target.value as BusinessDocInput['taxMode'])}
                  className="w-full px-2 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
                >
                  <option value="standard">Standard Tax</option>
                  <option value="gst-intra">GST (CGST + SGST)</option>
                  <option value="gst-inter">GST (IGST)</option>
                  <option value="vat">VAT</option>
                  <option value="sales-tax">Sales Tax</option>
                </select>
              </label>
              <label className="text-[11px] text-content-secondary space-y-1">
                <span>Tax (%)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  value={form.taxPercent}
                  onChange={(e) => updateField('taxPercent', Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
                />
              </label>
              <label className="text-[11px] text-content-secondary space-y-1">
                <span>Discount ({form.discountType === 'percent' ? '%' : form.currency})</span>
                <div className="flex gap-1">
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={form.discountAmount}
                    onChange={(e) => updateField('discountAmount', Number(e.target.value))}
                    className="w-full px-2 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      updateField('discountType', form.discountType === 'percent' ? 'flat' : 'percent')
                    }
                    className="px-2 rounded-lg border border-line bg-surface-elevated text-[10px] font-mono"
                  >
                    {form.discountType === 'percent' ? '%' : '$'}
                  </button>
                </div>
              </label>
              <label className="text-[11px] text-content-secondary space-y-1">
                <span>Shipping</span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={form.shippingAmount || 0}
                  onChange={(e) => updateField('shippingAmount', Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
                />
              </label>
            </div>

            {kind === 'receipt' && (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(['UPI', 'Card', 'Cash', 'Bank Transfer'] as const).map((pm) => (
                      <button
                        key={pm}
                        type="button"
                        onClick={() => updateField('paymentMethod', pm)}
                        className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${
                          form.paymentMethod === pm
                            ? 'bg-brand text-white border-brand'
                            : 'bg-surface-elevated border-line text-content-secondary'
                        }`}
                      >
                        {pm}
                      </button>
                    ))}
                  </div>
                  <label className="inline-flex items-center gap-1.5 text-xs text-content cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(form.showPaidWatermark)}
                      onChange={(e) => updateField('showPaidWatermark', e.target.checked)}
                    />
                    <span>Vector PAID Stamp</span>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    placeholder="Payment method"
                    value={form.paymentMethod || ''}
                    onChange={(e) => updateField('paymentMethod', e.target.value)}
                    className="px-2.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
                  />
                  <input
                    type="text"
                    placeholder="Transaction / Ref ID"
                    value={form.paymentReference || ''}
                    onChange={(e) => updateField('paymentReference', e.target.value)}
                    className="px-2.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
                  />
                </div>
              </div>
            )}

            {kind === 'quote' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-line">
                <textarea
                  rows={2}
                  placeholder="Scope of work / Deliverables…"
                  value={form.scopeOfWork || ''}
                  onChange={(e) => updateField('scopeOfWork', e.target.value)}
                  className="px-2.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
                />
                <div className="space-y-1.5">
                  <textarea
                    rows={2}
                    placeholder="Terms & conditions…"
                    value={form.termsAndConditions || ''}
                    onChange={(e) => updateField('termsAndConditions', e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
                  />
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-content">
                    <input
                      type="checkbox"
                      checked={Boolean(form.acceptanceSignature?.enabled)}
                      onChange={(e) =>
                        updateField('acceptanceSignature', {
                          ...form.acceptanceSignature,
                          enabled: e.target.checked,
                        })
                      }
                    />
                    <span>Include Client Acceptance Signature block</span>
                  </label>
                </div>
              </div>
            )}

            <details className="pt-2 border-t border-line text-xs text-content-secondary">
              <summary className="cursor-pointer font-semibold text-content">
                Customize field labels &amp; live itemized breakdown
              </summary>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                <input
                  type="text"
                  placeholder="Issued To label"
                  value={form.customLabels?.billTo || ''}
                  onChange={(e) =>
                    updateField('customLabels', { ...form.customLabels, billTo: e.target.value })
                  }
                  className="px-2 py-1 rounded-lg border border-line bg-surface-elevated text-[11px] text-content"
                />
                <input
                  type="text"
                  placeholder="Total / Summary title"
                  value={form.customLabels?.total || ''}
                  onChange={(e) =>
                    updateField('customLabels', { ...form.customLabels, total: e.target.value })
                  }
                  className="px-2 py-1 rounded-lg border border-line bg-surface-elevated text-[11px] text-content"
                />
                <input
                  type="text"
                  placeholder="Tax line label"
                  value={form.customLabels?.tax || ''}
                  onChange={(e) =>
                    updateField('customLabels', { ...form.customLabels, tax: e.target.value })
                  }
                  className="px-2 py-1 rounded-lg border border-line bg-surface-elevated text-[11px] text-content"
                />
                <input
                  type="text"
                  placeholder="Notes heading"
                  value={form.customLabels?.notes || ''}
                  onChange={(e) =>
                    updateField('customLabels', { ...form.customLabels, notes: e.target.value })
                  }
                  className="px-2 py-1 rounded-lg border border-line bg-surface-elevated text-[11px] text-content"
                />
              </div>
            </details>

            <div className="p-3 rounded-xl border border-line bg-surface-elevated grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
              <div>
                <span className="text-content-secondary block">Subtotal</span>
                <span className="font-bold text-content">{form.currency} {totals.subtotal.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-content-secondary block">Discount</span>
                <span className="font-bold text-content">-{form.currency} {totals.disc.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-content-secondary block">
                  {form.taxMode === 'gst-intra'
                    ? `CGST+SGST (${form.taxPercent}%)`
                    : form.taxMode === 'gst-inter'
                    ? `IGST (${form.taxPercent}%)`
                    : form.taxMode === 'vat'
                    ? `VAT (${form.taxPercent}%)`
                    : form.taxMode === 'sales-tax'
                    ? `Sales Tax (${form.taxPercent}%)`
                    : `Tax (${form.taxPercent}%)`}
                </span>
                <span className="font-bold text-content">{form.currency} {totals.tax.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-content-secondary block">Shipping</span>
                <span className="font-bold text-content">{form.currency} {totals.ship.toFixed(2)}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <input
                type="text"
                placeholder="Notes or terms…"
                value={form.notes}
                onChange={(e) => updateField('notes', e.target.value)}
                className="flex-1 min-w-[180px] px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content"
              />
              <div className="text-right">
                <span className="text-[11px] text-content-secondary mr-2">Total:</span>
                <span className="text-base font-extrabold font-mono text-content">
                  {form.currency} {totals.total.toFixed(2)}
                </span>
              </div>
              <button
                type="button"
                disabled={previewBusy}
                onClick={handleFullModalPreview}
                className="xl:hidden px-3.5 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-1"
              >
                <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{previewBusy ? 'Rendering…' : 'Preview PDF'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Live Side-by-Side WYSIWYG Preview (5 cols on desktop) */}
        <aside className="xl:col-span-5 p-4 rounded-2xl border border-line bg-surface space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-content">Live WYSIWYG Preview</span>
            <button
              type="button"
              disabled={previewBusy}
              onClick={handleFullModalPreview}
              className="text-xs font-semibold text-brand inline-flex items-center gap-1"
            >
              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Expand</span>
            </button>
          </div>
          <div className="rounded-xl border border-line bg-surface-elevated p-3 flex justify-center min-h-[380px]">
            {livePreviewUrl ? (
              <img
                src={livePreviewUrl}
                alt="Live PDF preview"
                className="max-w-full h-auto rounded shadow bg-white"
              />
            ) : (
              <div className="text-xs text-content-secondary self-center">Rendering preview…</div>
            )}
          </div>
        </aside>
      </div>

      {modalPreviewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setModalPreviewUrl(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Document preview"
        >
          <div
            className="bg-surface border border-line rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-auto p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-content">Live PDF Preview</span>
              <button
                type="button"
                onClick={() => setModalPreviewUrl(null)}
                className="p-1.5 rounded-lg hover:bg-surface-elevated"
                aria-label="Close preview"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img src={modalPreviewUrl} alt="Rendered PDF page preview" className="w-full rounded-lg border border-line bg-white" />
          </div>
        </div>
      )}
    </PdfToolShell>
  );
}
