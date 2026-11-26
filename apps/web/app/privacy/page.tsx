import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { Shield, Calendar, ChevronRight } from 'lucide-react';
import { constructMetadata, buildBreadcrumbsJsonLd } from '@/lib/seo';
import { parseMarkdownBlocks, stripFrontmatter } from '@/lib/markdown';
import MarkdownRenderer from '@/components/MarkdownRenderer';

export const metadata = constructMetadata({
  title: 'Privacy Policy & Zero-Upload Guarantees — MUXARO',
  description:
    'Privacy-by-design architecture, 100% browser-local PDF execution, zero tracking cookies, GDPR/CCPA compliance, and 60-minute ephemeral worker purging.',
  path: '/privacy',
  keywords: [
    'privacy policy',
    'browser local pdf privacy',
    'ephemeral storage security',
    'zero tracking cookies',
    'gdpr ccpa compliant media converter',
  ],
});

const LEGAL_LINKS = [
  { href: '/privacy', label: 'Privacy policy' },
  { href: '/terms', label: 'Terms of service' },
  { href: '/dmca', label: 'Copyright and DMCA' },
];

function readLegalMarkdown(filename: string): string | null {
  const candidates = [
    path.join(process.cwd(), 'content', 'legal', filename),
    path.join(process.cwd(), 'apps', 'web', 'content', 'legal', filename),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return fs.readFileSync(candidate, 'utf-8');
      }
    } catch {}
  }
  return null;
}

export default function PrivacyPage() {
  const raw = readLegalMarkdown('privacy.md');
  const body = raw ? stripFrontmatter(raw) : '';
  const { blocks } = parseMarkdownBlocks(body);

  const breadcrumbsJsonLd = buildBreadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Privacy Policy', path: '/privacy' },
  ]);

  return (
    <div className="min-h-screen bg-base">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }}
      />

      <section className="muxaro-hero-surface border-b border-line">
        <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-14">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-content-secondary mb-5">
            <Link href="/" className="hover:text-brand rounded-sm transition-colors font-medium">
              Home
            </Link>
            <ChevronRight className="w-4 h-4 text-content-muted" aria-hidden="true" />
            <span className="text-content font-medium">Privacy Policy</span>
          </nav>

          <div className="max-w-3xl">
            <h1 className="text-3xl sm:text-4xl font-display font-medium text-content tracking-[-0.025em]">
              Privacy Policy
            </h1>
            <p className="text-base text-content-secondary mt-3 leading-relaxed">
              Browser-local PDF execution, zero tracking cookies, and automatic 60-minute ephemeral worker file deletion.
            </p>
            <div className="flex flex-wrap items-center gap-4 mt-5 text-xs font-medium text-content-secondary">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface border border-line">
                <Shield className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
                <span>GDPR &amp; CCPA Compliant</span>
              </span>
              <span className="inline-flex items-center gap-1.5 font-mono">
                <Calendar className="w-3.5 h-3.5 text-content-muted" aria-hidden="true" />
                <span>Last updated November 26, 2026</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <aside className="lg:col-span-3 lg:sticky lg:top-24 space-y-4">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="text-sm font-semibold text-content mb-3 px-2 font-sans">
                Legal &amp; compliance
              </h2>
              <nav aria-label="Legal policies" className="space-y-1">
                {LEGAL_LINKS.map((link) => {
                  const isActive = link.href === '/privacy';
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
                        isActive
                          ? 'bg-surface-elevated text-brand font-semibold'
                          : 'text-content-secondary hover:bg-surface-elevated/60 hover:text-content'
                      }`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </aside>

          <article className="lg:col-span-9 rounded-2xl border border-line bg-surface p-6 sm:p-8 md:p-10">
            <MarkdownRenderer blocks={blocks} />
          </article>
        </div>
      </div>
    </div>
  );
}
