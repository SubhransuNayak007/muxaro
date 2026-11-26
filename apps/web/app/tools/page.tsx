import React from 'react';
import Link from 'next/link';
import { Layers, ArrowLeft, Film, FileText, History, Music } from 'lucide-react';
import { constructMetadata, buildBreadcrumbsJsonLd } from '@/lib/seo';
import {
  ALL_STUDIO_TOOLS,
  CREATOR_TOOLS_CATALOG,
  PDF_TOOLS_CATALOG,
} from '@/lib/tools-catalog';
import ToolsCatalogGrid from '@/components/ToolsCatalogGrid';

export const metadata = constructMetadata({
  title: `${ALL_STUDIO_TOOLS.length} Video, PDF & Audio Studio Tools | MUXARO`,
  description:
    'All-in-one creator workstation featuring 14 Video and Audio tools plus 38 browser-local, zero-upload PDF tools (merge, split, compress, edit, sign, OCR, verify, batch).',
  path: '/tools',
  keywords: [
    'target size video compressor',
    'lossless video trimmer 60s split',
    'private browser pdf tools',
    'merge compress edit pdf locally',
    'ocr searchable pdf',
    'video format converter 105 formats',
  ],
});

export default function ToolsIndexPage() {
  const breadcrumbJsonLd = buildBreadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Tools', path: '/tools' },
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
              href="/"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-content-secondary hover:text-content transition-colors"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>Back to studio home</span>
            </Link>

            <div className="flex flex-wrap items-center gap-2">
              <a
                href="#video-section"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line bg-surface text-xs font-semibold text-content hover:bg-surface-elevated"
              >
                <Film className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Video ({CREATOR_TOOLS_CATALOG.length})</span>
              </a>
              <a
                href="#pdf-section"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line bg-surface text-xs font-semibold text-content hover:bg-surface-elevated"
              >
                <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                <span>PDF ({PDF_TOOLS_CATALOG.length})</span>
              </a>
              <Link
                href="/tools?section=audio"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line bg-surface text-xs font-semibold text-content hover:bg-surface-elevated"
              >
                <Music className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Audio Roadmap</span>
              </Link>
              <Link
                href="/tools/pdf/recent"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line bg-surface text-xs font-semibold text-content hover:bg-surface-elevated"
              >
                <History className="w-3.5 h-3.5" aria-hidden="true" />
                <span>PDF History</span>
              </Link>
            </div>
          </div>

          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-elevated border border-line text-xs font-medium text-content-secondary mb-4">
              <Layers className="w-3.5 h-3.5 text-content" aria-hidden="true" />
              <span>
                {CREATOR_TOOLS_CATALOG.length} Video Tools and {PDF_TOOLS_CATALOG.length} Private PDF Tools
              </span>
            </div>
            <h1 className="text-3xl sm:text-5xl font-display font-medium text-content tracking-[-0.025em]">
              All-in-one creator and PDF studio
            </h1>
            <p className="text-base text-content-secondary mt-3 leading-relaxed">
              52 video, audio, and browser-local PDF utilities with zero credits.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <ToolsCatalogGrid />
      </section>
    </div>
  );
}
