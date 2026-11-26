import React from 'react';
import Link from 'next/link';
import {
  ChevronRight,
  BookOpen,
  ShieldCheck,
  Activity,
} from 'lucide-react';
import { ALL_DOCS } from '@/content';
import { constructMetadata, buildBreadcrumbsJsonLd } from '@/lib/seo';
import DocsCatalogClient from '@/components/DocsCatalogClient';

export const metadata = constructMetadata({
  title: 'Documentation & Studio Engineering Guides — MUXARO',
  description:
    'Complete guides to Video Studio (14 tools), browser-local PDF Studio (38 tools), Audio Studio roadmap, containers vs. codecs, and zero-upload privacy.',
  path: '/docs',
  keywords: [
    'muxaro documentation',
    'video studio guide',
    'pdf studio wasm guide',
    'audio studio roadmap',
    'video containers vs codecs',
    'ffmpeg troubleshooting',
  ],
});

export default function DocsIndexPage() {
  const breadcrumbsJsonLd = buildBreadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Documentation', path: '/docs' },
  ]);

  return (
    <div className="min-h-screen bg-base">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }}
      />

      {/* Editorial Header */}
      <section className="muxaro-hero-surface border-b border-line">
        <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface border border-line text-xs font-medium text-content-secondary mb-4">
              <BookOpen className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
              <span>Documentation</span>
            </div>
            <h1 className="text-3xl sm:text-5xl font-display font-medium text-content tracking-[-0.025em]">
              Studio guides and architecture
            </h1>
            <p className="text-base text-content-secondary mt-3 leading-relaxed">
              Manuals for 14 video tools, 38 PDF workflows, and codecs.
            </p>
          </div>
        </div>
      </section>

      {/* Searchable Guides Grid */}
      <section className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-14">
        <DocsCatalogClient docs={ALL_DOCS} />

        {/* Support & Policy Links */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-line bg-surface p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-surface-elevated border border-line flex items-center justify-center text-brand shrink-0">
                <Activity className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-content">
                  Settings &amp; Preferences
                </h2>
                <p className="text-sm text-content-secondary mt-1">
                  Configure custom media worker endpoints, appearance themes, Eco Mode, and audio/video defaults.
                </p>
              </div>
            </div>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-surface-elevated border border-line text-sm font-medium text-content hover:border-brand hover:text-brand transition-colors shrink-0"
            >
              <span>Open Settings</span>
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-surface-elevated border border-line flex items-center justify-center text-brand shrink-0">
                <ShieldCheck className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-content">
                  Privacy and legal policies
                </h2>
                <p className="text-sm text-content-secondary mt-1">
                  Review our browser-local guarantees, 60-minute ephemeral deletion, terms, and DMCA procedure.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Link
                href="/privacy"
                className="px-3 py-1.5 rounded-lg bg-surface-elevated border border-line text-xs font-medium text-content hover:border-brand hover:text-brand transition-colors"
              >
                Privacy
              </Link>
              <Link
                href="/terms"
                className="px-3 py-1.5 rounded-lg bg-surface-elevated border border-line text-xs font-medium text-content hover:border-brand hover:text-brand transition-colors"
              >
                Terms
              </Link>
              <Link
                href="/dmca"
                className="px-3 py-1.5 rounded-lg bg-surface-elevated border border-line text-xs font-medium text-content hover:border-brand hover:text-brand transition-colors"
              >
                DMCA
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
