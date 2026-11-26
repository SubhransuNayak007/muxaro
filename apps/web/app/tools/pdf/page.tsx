import React from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck, History } from 'lucide-react';
import { constructMetadata, buildBreadcrumbsJsonLd } from '@/lib/seo';
import { PDF_TOOLS_CATALOG } from '@/lib/tools-catalog';
import ToolsCatalogGrid from '@/components/ToolsCatalogGrid';

export const metadata = constructMetadata({
  title: `${PDF_TOOLS_CATALOG.length} Private Browser PDF Tools | MUXARO`,
  description:
    'Process PDFs 100% locally in your browser with zero server uploads: merge, split, compress, edit, sign, OCR searchable PDF, make fillable forms, protect, and compare.',
  path: '/tools/pdf',
  keywords: [
    'private pdf tools',
    'browser pdf editor',
    'merge pdf locally',
    'compress pdf without upload',
    'ocr searchable pdf',
    'make fillable pdf',
  ],
});

export default function PdfStudioIndexPage() {
  const breadcrumbJsonLd = buildBreadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Tools', path: '/tools' },
    { name: 'PDF Studio', path: '/tools/pdf' },
  ]);

  return (
    <div className="w-full">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <section className="muxaro-hero-surface border-b border-line">
        <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <Link
              href="/tools"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-content-secondary hover:text-content transition-colors"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>All Studio Tools</span>
            </Link>

            <Link
              href="/tools/pdf/recent"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line bg-surface text-xs font-semibold text-content hover:bg-surface-elevated"
            >
              <History className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Local PDF History</span>
            </Link>
          </div>

          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-elevated border border-line text-xs font-medium text-content-secondary mb-4">
              <ShieldCheck className="w-3.5 h-3.5 text-success" aria-hidden="true" />
              <span>{PDF_TOOLS_CATALOG.length} Browser-Local PDF Utilities (0 bytes uploaded)</span>
            </div>
            <h1 className="text-3xl sm:text-5xl font-display font-medium text-content tracking-[-0.025em]">
              Private PDF Studio
            </h1>
            <p className="text-base text-content-secondary mt-3 leading-relaxed">
              Create invoices, edit and sign documents, compress with QPDF WASM, run multi-worker OCR into searchable PDFs, verify PKCS#7 signatures, or batch-process files. Every byte stays on your device.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <ToolsCatalogGrid initialSection="pdf" />
      </section>
    </div>
  );
}
