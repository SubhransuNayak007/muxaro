import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ChevronRight,
  ChevronLeft,
  Clock,
  Calendar,
  BookOpen,
  ArrowUpRight,
} from 'lucide-react';
import { DOCS_REGISTRY, ALL_DOCS } from '@/content';
import {
  constructMetadata,
  buildTechArticleJsonLd,
  buildBreadcrumbsJsonLd,
  buildFaqJsonLd,
} from '@/lib/seo';
import { parseMarkdownBlocks, stripFrontmatter } from '@/lib/markdown';
import MarkdownRenderer from '@/components/MarkdownRenderer';

interface Props {
  params: Promise<{
    slug: string;
  }>;
}

export function generateStaticParams() {
  return ALL_DOCS.map((doc) => ({
    slug: doc.slug,
  }));
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const doc = DOCS_REGISTRY[slug];
  if (!doc) {
    return constructMetadata({
      title: 'Guide Not Found — MUXARO',
      description: 'The requested engineering guide could not be found.',
      path: `/docs/${slug}`,
      noIndex: true,
    });
  }
  return constructMetadata({
    title: `${doc.title} — MUXARO Docs`,
    description: doc.description,
    path: `/docs/${doc.slug}`,
    ogType: 'article',
    publishedTime: `${doc.lastUpdated}T00:00:00.000Z`,
    modifiedTime: `${doc.lastUpdated}T00:00:00.000Z`,
  });
}

function readMarkdownFile(filePathFromRoot: string): string | null {
  const normalized = filePathFromRoot.replace(/^apps\/web\//, '');
  const candidates = [
    path.join(process.cwd(), normalized),
    path.join(process.cwd(), filePathFromRoot),
    path.join(process.cwd(), 'apps', 'web', normalized),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return fs.readFileSync(candidate, 'utf-8');
      }
    } catch {
      // Try next candidate
    }
  }
  return null;
}

const UPDATED_FAQ_SCHEMA_ITEMS = [
  {
    question: 'Are there any daily credits, paywalls, or ads?',
    answer:
      'No. Daily credits and rewarded ads have been completely removed. MUXARO runs with zero display ads, zero watermarks, and zero account walls.',
  },
  {
    question: 'Which tools run 100% locally with zero server upload?',
    answer:
      'All 38 PDF Studio tools and Tier-1 video/audio tools (Metadata Scrubber, Video Frame Grabber, Subtitle Timing Shifter, Lossless Stream-Copy Trimmer, Container Remux, and Stream-Copy Audio Extraction up to 350 MB) run directly inside your browser.',
  },
  {
    question: 'How long are Cloud worker files kept?',
    answer:
      'Files processed by Cloud FFmpeg workers remain in isolated temporary scratch storage only long enough for downloads and zero-reupload tool chaining, and are automatically deleted within 60 minutes.',
  },
  {
    question: 'What is coming in the Audio Studio suite?',
    answer:
      'The upcoming Audio Studio expands MUXARO beyond Audio Extractor and Loudness Normalizer with local stem separation, voice de-noise/de-reverb, waveform silence trimming, and podcast mastering.',
  },
];

export default async function DocDetailPage({ params }: Props) {
  const { slug } = await params;
  const doc = DOCS_REGISTRY[slug];
  if (!doc) notFound();

  const rawContent = readMarkdownFile(doc.filePath);
  const bodyMarkdown = rawContent
    ? stripFrontmatter(rawContent)
    : `${doc.description}`;
  const { blocks, headings } = parseMarkdownBlocks(bodyMarkdown);

  const currentIdx = ALL_DOCS.findIndex((item) => item.slug === doc.slug);
  const prevDoc = currentIdx > 0 ? ALL_DOCS[currentIdx - 1] : null;
  const nextDoc = currentIdx >= 0 && currentIdx < ALL_DOCS.length - 1 ? ALL_DOCS[currentIdx + 1] : null;

  const breadcrumbsJsonLd = buildBreadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Documentation', path: '/docs' },
    { name: doc.title, path: `/docs/${doc.slug}` },
  ]);

  const articleJsonLd = buildTechArticleJsonLd({
    title: doc.title,
    description: doc.description,
    path: `/docs/${doc.slug}`,
    publishedAt: `${doc.lastUpdated}T00:00:00.000Z`,
    updatedAt: `${doc.lastUpdated}T00:00:00.000Z`,
  });

  const faqJsonLd =
    doc.slug === 'faq'
      ? buildFaqJsonLd(UPDATED_FAQ_SCHEMA_ITEMS, {
          path: '/docs/faq',
          name: 'MUXARO Frequently Asked Questions',
        })
      : null;

  return (
    <div className="min-h-screen bg-base">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      {faqJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
      )}

      {/* Editorial Header */}
      <section className="muxaro-hero-surface border-b border-line">
        <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-14">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-content-secondary mb-5">
            <Link href="/docs" className="hover:text-brand rounded-sm transition-colors font-medium">
              Documentation
            </Link>
            <ChevronRight className="w-4 h-4 text-content-muted" aria-hidden="true" />
            <span className="text-content font-medium">{doc.category}</span>
          </nav>

          <div className="max-w-3xl">
            <h1 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-display font-medium text-content tracking-[-0.025em] leading-[1.08]">
              {doc.title}
            </h1>
            <p className="text-base text-content-secondary mt-3 leading-relaxed">
              {doc.description}
            </p>

            <div className="flex flex-wrap items-center gap-4 mt-5 text-xs font-medium text-content-secondary">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface border border-line">
                <BookOpen className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
                <span>{doc.category}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 font-mono">
                <Clock className="w-3.5 h-3.5 text-content-muted" aria-hidden="true" />
                <span>{doc.readingTime}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 font-mono">
                <Calendar className="w-3.5 h-3.5 text-content-muted" aria-hidden="true" />
                <span>Updated {doc.lastUpdated}</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Main 3-Column Documentation Workspace */}
      <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Guide Navigation */}
          <aside className="lg:col-span-3 lg:sticky lg:top-24 space-y-4">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="text-sm font-semibold text-content mb-3 px-2 font-sans">
                All guides
              </h2>
              <nav aria-label="Documentation guides" className="space-y-1">
                {ALL_DOCS.map((item) => {
                  const isActive = item.slug === doc.slug;
                  return (
                    <Link
                      key={item.slug}
                      href={`/docs/${item.slug}`}
                      className={`block px-3 py-2 rounded-lg text-xs sm:text-sm transition-colors ${
                        isActive
                          ? 'bg-surface-elevated text-brand font-semibold'
                          : 'text-content-secondary hover:bg-surface-elevated/60 hover:text-content'
                      }`}
                    >
                      {item.title}
                    </Link>
                  );
                })}
              </nav>
            </div>

            <div className="rounded-2xl border border-line bg-surface p-5 space-y-3">
              <h2 className="text-sm font-semibold text-content font-sans">
                Open a studio suite
              </h2>
              <div className="flex flex-col gap-2">
                <Link
                  href="/tools?section=video"
                  className="inline-flex items-center justify-between px-3 py-2 rounded-xl border border-line bg-surface-elevated text-xs font-medium text-content hover:border-brand/40"
                >
                  <span>Video Studio (14)</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
                </Link>
                <Link
                  href="/tools/pdf"
                  className="inline-flex items-center justify-between px-3 py-2 rounded-xl border border-line bg-surface-elevated text-xs font-medium text-content hover:border-brand/40"
                >
                  <span>PDF Studio (38)</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
                </Link>
                <Link
                  href="/tools?section=audio"
                  className="inline-flex items-center justify-between px-3 py-2 rounded-xl border border-line bg-surface-elevated text-xs font-medium text-content hover:border-brand/40"
                >
                  <span>Audio Roadmap</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </aside>

          {/* Center Article Surface */}
          <article className="lg:col-span-9 xl:col-span-7 rounded-2xl border border-line bg-surface p-6 sm:p-8 md:p-10">
            <MarkdownRenderer blocks={blocks} />

            {/* Previous / Next Guide Navigation */}
            <div className="mt-12 pt-6 border-t border-line grid grid-cols-1 sm:grid-cols-2 gap-4">
              {prevDoc ? (
                <Link
                  href={`/docs/${prevDoc.slug}`}
                  className="rounded-xl border border-line bg-surface-elevated/40 hover:border-line-hover p-4 flex items-center gap-3 group transition-colors"
                >
                  <ChevronLeft className="w-4 h-4 text-content-muted group-hover:text-brand shrink-0 transition-colors" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="text-xs text-content-muted">Previous guide</div>
                    <div className="text-sm font-semibold text-content group-hover:text-brand transition-colors truncate">
                      {prevDoc.title}
                    </div>
                  </div>
                </Link>
              ) : (
                <div />
              )}

              {nextDoc ? (
                <Link
                  href={`/docs/${nextDoc.slug}`}
                  className="rounded-xl border border-line bg-surface-elevated/40 hover:border-line-hover p-4 flex items-center justify-between gap-3 text-right group transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-content-muted">Next guide</div>
                    <div className="text-sm font-semibold text-content group-hover:text-brand transition-colors truncate">
                      {nextDoc.title}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-content-muted group-hover:text-brand shrink-0 transition-colors" aria-hidden="true" />
                </Link>
              ) : (
                <div />
              )}
            </div>
          </article>

          {/* Right Sticky "On This Page" TOC */}
          {headings.length > 0 && (
            <aside className="hidden xl:block xl:col-span-2 xl:sticky xl:top-24">
              <div className="border-l border-line pl-4 space-y-2.5">
                <div className="text-xs font-semibold text-content">
                  On this page
                </div>
                <nav aria-label="On this page" className="space-y-1.5">
                  {headings.map((h) => (
                    <a
                      key={h.id}
                      href={`#${h.id}`}
                      className={`block text-xs text-content-secondary hover:text-brand transition-colors leading-snug ${
                        h.level === 3 ? 'pl-3 text-[11px]' : 'font-medium'
                      }`}
                    >
                      {h.text}
                    </a>
                  ))}
                </nav>
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
