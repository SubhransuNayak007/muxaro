import React from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { CREATOR_TOOLS_CATALOG, PDF_TOOLS_CATALOG } from '@/lib/tools-catalog';

const SUITES = [
  {
    index: '01',
    name: 'AI Studio',
    summary: 'Autonomous ReAct agent, Python code sandbox, local WebGPU, and web research.',
    meta: 'Web & Desktop',
    href: '/ai',
    cta: 'Open AI',
  },
  {
    index: '02',
    name: 'Video & Audio',
    summary: 'Save streams up to 8K, target 10 MB compression, and lossless cuts.',
    meta: `${CREATOR_TOOLS_CATALOG.length} tools`,
    href: '/tools?section=video',
    cta: 'Browse',
  },
  {
    index: '03',
    name: 'PDF Studio',
    summary: 'Merge, compress, redact PII, OCR, and encrypt locally in WASM.',
    meta: `${PDF_TOOLS_CATALOG.length} tools`,
    href: '/tools/pdf',
    cta: 'Browse',
  },
] as const;

export default function SuiteIndexLedger() {
  return (
    <section
      className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-12 border-t border-line"
      aria-labelledby="suites-ledger-heading"
    >
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 mb-6">
        <h2
          id="suites-ledger-heading"
          className="text-2xl sm:text-3xl font-display font-medium text-content tracking-[-0.02em]"
        >
          One quiet workspace
        </h2>
        <span className="text-xs text-content-secondary tabular-nums">
          {CREATOR_TOOLS_CATALOG.length + PDF_TOOLS_CATALOG.length} utilities
        </span>
      </div>

      <div className="border-t border-line divide-y divide-line">
        {SUITES.map((suite) => (
          <Link
            key={suite.index}
            href={suite.href}
            className="py-5 grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-6 items-baseline group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-lg"
          >
            <div className="md:col-span-4 flex items-baseline gap-3">
              <span className="text-xs text-content-tertiary tabular-nums">
                {suite.index}
              </span>
              <span className="text-base sm:text-lg font-semibold text-content group-hover:text-brand transition-colors">
                {suite.name}
              </span>
            </div>

            <p className="md:col-span-5 text-sm text-content-secondary leading-relaxed">
              {suite.summary}
            </p>

            <div className="md:col-span-3 flex items-center justify-between md:justify-end gap-4">
              <span className="text-xs text-content-secondary tabular-nums">
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
