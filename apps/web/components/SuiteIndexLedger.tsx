import React from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { CREATOR_TOOLS_CATALOG, PDF_TOOLS_CATALOG } from '@/lib/tools-catalog';

const SUITES = [
  {
    index: '01',
    name: 'Stream Downloader',
    summary: 'Grab 8K video, native audio tracks, playlists, and clean AI transcripts from any supported link.',
    meta: '8K & 4K Direct',
    href: '#main-content',
    cta: 'Paste link above',
  },
  {
    index: '02',
    name: 'Video Studio',
    summary: 'Target-size 10 MB compression, lossless stream-copy cuts, 9:16 framing, subtitle burning, and 105+ format conversion.',
    meta: `${CREATOR_TOOLS_CATALOG.length} tools`,
    href: '/tools?section=video',
    cta: 'Browse Video',
  },
  {
    index: '03',
    name: 'PDF Studio',
    summary: 'Zero-upload browser tools powered by QPDF WASM, pdf-lib, Tesseract OCR, and WebCrypto PKCS#7 verification.',
    meta: `${PDF_TOOLS_CATALOG.length} local tools`,
    href: '/tools/pdf',
    cta: 'Browse PDF',
  },
  {
    index: '04',
    name: 'Audio Studio',
    summary: 'Dedicated stem separation, voice de-noise, waveform silence trimming, and podcast loudness mastering.',
    meta: 'Upcoming suite',
    href: '/docs/audio-studio',
    cta: 'Preview roadmap',
  },
] as const;

export default function SuiteIndexLedger() {
  return (
    <section
      className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-16 border-t border-line"
      aria-labelledby="suites-ledger-heading"
    >
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-8">
        <h2
          id="suites-ledger-heading"
          className="text-3xl sm:text-4xl font-display font-medium text-content tracking-[-0.02em]"
        >
          Four suites inside one workstation
        </h2>
        <span className="text-xs font-mono text-content-secondary tabular-nums">
          {CREATOR_TOOLS_CATALOG.length + PDF_TOOLS_CATALOG.length} active tools
        </span>
      </div>

      <div className="border-t border-line divide-y divide-line">
        {SUITES.map((suite) => (
          <Link
            key={suite.index}
            href={suite.href}
            className="py-6 sm:py-7 grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-6 items-baseline group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-lg"
          >
            <div className="md:col-span-4 flex items-baseline gap-3">
              <span className="font-mono text-xs text-content-tertiary tabular-nums">
                {suite.index}
              </span>
              <span className="text-lg sm:text-xl font-semibold text-content group-hover:text-brand transition-colors">
                {suite.name}
              </span>
            </div>

            <p className="md:col-span-5 text-sm text-content-secondary leading-relaxed">
              {suite.summary}
            </p>

            <div className="md:col-span-3 flex items-center justify-between md:justify-end gap-4">
              <span className="font-mono text-xs text-content-secondary tabular-nums">
                {suite.meta}
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand">
                <span>{suite.cta}</span>
                <ArrowUpRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
