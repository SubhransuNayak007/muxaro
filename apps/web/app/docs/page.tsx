import React from 'react';
import Link from 'next/link';
import {
  FileVideo,
  MonitorPlay,
  Headphones,
  Wrench,
  HelpCircle,
  ChevronRight,
  BookOpen,
  ShieldCheck,
  Activity,
} from 'lucide-react';
import { ALL_DOCS } from '@/content';
import { constructMetadata, buildBreadcrumbsJsonLd } from '@/lib/seo';

export const metadata = constructMetadata({
  title: 'Documentation & Media Architecture Guides — MUXARO',
  description:
    'Engineering guides to video containers, audio codecs, streaming resolution realities, psychoacoustic fidelity, and troubleshooting.',
  path: '/docs',
  keywords: [
    'media architecture guides',
    'video containers vs codecs',
    'dash streaming',
    'psychoacoustic audio analysis',
    'ffmpeg troubleshooting',
    'muxaro documentation',
  ],
});

function getDocIcon(slug: string) {
  switch (slug) {
    case 'formats':
      return FileVideo;
    case 'resolutions':
      return MonitorPlay;
    case 'audio-quality':
      return Headphones;
    case 'troubleshooting':
      return Wrench;
    case 'faq':
      return HelpCircle;
    case 'security':
      return ShieldCheck;
    default:
      return BookOpen;
  }
}

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
      {/* Header Band */}
      <section className="muxaro-hero-surface border-b border-line">
        <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface border border-line text-xs font-medium text-content-secondary mb-4 shadow-sm">
              <BookOpen className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
              <span>Documentation</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-content tracking-tight">
              Media guides and answers
            </h1>
            <p className="text-base text-content-secondary mt-3 leading-relaxed">
              Clear guides to video formats, resolutions, audio quality, and common fixes.
            </p>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <section className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-14">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {ALL_DOCS.map((doc) => {
            const Icon = getDocIcon(doc.slug);
            return (
              <Link
                key={doc.slug}
                href={`/docs/${doc.slug}`}
                className="muxaro-card-interactive p-6 flex flex-col justify-between group"
              >
                <div>
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div className="w-10 h-10 rounded-md bg-surface-elevated border border-line-subtle flex items-center justify-center text-brand">
                      <Icon className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <span className="text-xs font-medium text-content-muted">
                      {doc.readingTime}
                    </span>
                  </div>

                  <div className="text-xs font-medium text-brand mb-1.5">
                    {doc.category}
                  </div>
                  <h2 className="text-lg font-semibold text-content group-hover:text-brand transition-colors mb-2 leading-snug">
                    {doc.title}
                  </h2>
                  <p className="text-sm text-content-secondary leading-relaxed">
                    {doc.description}
                  </p>
                </div>

                <div className="mt-6 pt-4 border-t border-line-subtle flex items-center justify-between text-sm font-medium text-content group-hover:text-brand transition-colors">
                  <span>Read guide</span>
                  <ChevronRight className="w-4 h-4 text-content-muted group-hover:text-brand transition-colors" aria-hidden="true" />
                </div>
              </Link>
            );
          })}
        </div>

        {/* Helpful Support & Policy Links */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="muxaro-card p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-md bg-surface-elevated border border-line-subtle flex items-center justify-center text-brand shrink-0">
                <Activity className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-content">
                  Studio Dock
                </h2>
                <p className="text-sm text-content-secondary mt-1">
                  Access core studio tools, format specifications, and keyboard shortcuts.
                </p>
              </div>
            </div>
            <Link
              href="/dock"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-sm bg-surface-elevated border border-line text-sm font-medium text-content hover:border-brand hover:text-brand transition-colors shrink-0"
            >
              <span>Open Dock</span>
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </div>

          <div className="muxaro-card p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-md bg-surface-elevated border border-line-subtle flex items-center justify-center text-brand shrink-0">
                <ShieldCheck className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-content">
                  Privacy and copyright
                </h2>
                <p className="text-sm text-content-secondary mt-1">
                  Read our zero-retention privacy guarantees, terms, and DMCA procedure.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Link
                href="/privacy"
                className="px-3 py-1.5 rounded-sm bg-surface-elevated border border-line text-xs font-medium text-content hover:border-brand hover:text-brand transition-colors"
              >
                Privacy
              </Link>
              <Link
                href="/terms"
                className="px-3 py-1.5 rounded-sm bg-surface-elevated border border-line text-xs font-medium text-content hover:border-brand hover:text-brand transition-colors"
              >
                Terms
              </Link>
              <Link
                href="/dmca"
                className="px-3 py-1.5 rounded-sm bg-surface-elevated border border-line text-xs font-medium text-content hover:border-brand hover:text-brand transition-colors"
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
