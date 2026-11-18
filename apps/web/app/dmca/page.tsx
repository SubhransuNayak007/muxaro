import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { Scale, Calendar, ChevronRight } from 'lucide-react';

export const metadata = {
  title: 'DMCA & Copyright Takedown Procedure — MUXARO',
  description:
    'Digital Millennium Copyright Act compliance, designated agent notification procedure, and counter-notice process.',
};

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
    } catch {
      // Try next path
    }
  }
  return null;
}

function stripFrontmatter(raw: string): string {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (normalized.startsWith('---\n')) {
    const endIdx = normalized.indexOf('\n---\n', 4);
    if (endIdx !== -1) {
      return normalized.slice(endIdx + 5).trim();
    }
  }
  return normalized.trim();
}

function normalizeHref(href: string): string {
  if (href === '/legal/terms') return '/terms';
  if (href === '/legal/privacy') return '/privacy';
  if (href === '/legal/dmca') return '/dmca';
  return href;
}

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={key++} className="font-semibold text-content">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={key++}
          className="px-1.5 py-0.5 rounded-sm bg-surface-elevated border border-line-subtle font-mono text-[0.85em] text-content"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (linkMatch) {
        const label = linkMatch[1];
        const href = normalizeHref(linkMatch[2]);
        if (href.startsWith('/')) {
          nodes.push(
            <Link
              key={key++}
              href={href}
              className="text-brand font-medium hover:underline underline-offset-2"
            >
              {label}
            </Link>
          );
        } else {
          nodes.push(
            <a
              key={key++}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand font-medium hover:underline underline-offset-2"
            >
              {label}
            </a>
          );
        }
      } else {
        nodes.push(token);
      }
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

type LegalBlock =
  | { type: 'h2' | 'h3'; text: string }
  | { type: 'hr' }
  | { type: 'code'; content: string }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'p'; text: string };

function parseLegalBlocks(source: string): LegalBlock[] {
  const lines = source.split('\n');
  const blocks: LegalBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (trimmed === '' || trimmed.startsWith('# ')) {
      i++;
      continue;
    }

    if (trimmed === '---' || trimmed === '***') {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: 'code', content: codeLines.join('\n') });
      continue;
    }

    if (trimmed.startsWith('### ')) {
      blocks.push({ type: 'h3', text: trimmed.slice(4).trim() });
      i++;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      blocks.push({ type: 'h2', text: trimmed.slice(3).trim() });
      i++;
      continue;
    }

    if (trimmed.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        const cleaned = lines[i].trim().replace(/^>\s?/, '').trim();
        if (cleaned && !/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/.test(cleaned)) {
          quoteLines.push(cleaned);
        }
        i++;
      }
      if (quoteLines.length > 0) {
        blocks.push({ type: 'blockquote', lines: quoteLines });
      }
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(
          lines[i]
            .trim()
            .replace(/^[-*]\s+/, '')
            .replace(/^\[[ xX]\]\s+/, '')
        );
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('> ') &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      lines[i].trim() !== '---'
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'p', text: paraLines.join(' ') });
    }
  }

  return blocks;
}

export default function DmcaPage() {
  const raw = readLegalMarkdown('dmca.md');
  const body = raw
    ? stripFrontmatter(raw)
    : 'Muxaro Copyright Policy and Digital Millennium Copyright Act (17 U.S.C. § 512) takedown procedure.';
  const blocks = parseLegalBlocks(body);

  return (
    <div className="min-h-screen bg-base">
      <section className="muxaro-hero-surface border-b border-line">
        <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-14">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-content-secondary mb-5">
            <Link href="/" className="hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:opacity-90 rounded-sm transition-colors font-medium">
              Home
            </Link>
            <ChevronRight className="w-4 h-4 text-content-muted" aria-hidden="true" />
            <span className="text-content font-medium">Copyright and DMCA</span>
          </nav>

          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface border border-line text-xs font-medium text-content-secondary mb-4 shadow-sm">
              <Scale className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
              <span>Copyright compliance</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-content tracking-tight">
              Copyright and DMCA procedure
            </h1>
            <p className="text-base text-content-secondary mt-3 leading-relaxed">
              Statutory copyright notices, designated agent details, and counter-notification steps.
            </p>
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-content-muted mt-4">
              <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Last updated November 18, 2026</span>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <aside className="lg:col-span-3 lg:sticky lg:top-24">
            <div className="muxaro-card p-4">
              <h2 className="text-sm font-semibold text-content mb-3 px-2">
                Legal policies
              </h2>
              <nav aria-label="Legal navigation" className="space-y-1">
                {LEGAL_LINKS.map((item) => {
                  const isActive = item.href === '/dmca';
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`block px-3 py-2 rounded-sm text-sm transition-colors ${
                        isActive
                          ? 'bg-surface-muted text-brand font-semibold'
                          : 'text-content-secondary hover:bg-surface-elevated hover:text-content'
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </aside>

          <article className="lg:col-span-9 muxaro-card p-6 sm:p-8 md:p-10">
            <div className="max-w-3xl text-sm sm:text-base text-content-secondary leading-relaxed space-y-4">
              {blocks.map((block, idx) => {
                switch (block.type) {
                  case 'h2':
                    return (
                      <h2
                        key={idx}
                        className="text-xl sm:text-2xl font-bold text-content tracking-tight mt-10 mb-3 pt-6 border-t border-line-subtle first:mt-0 first:pt-0 first:border-t-0"
                      >
                        {renderInline(block.text)}
                      </h2>
                    );
                  case 'h3':
                    return (
                      <h3 key={idx} className="text-base sm:text-lg font-semibold text-content mt-7 mb-2">
                        {renderInline(block.text)}
                      </h3>
                    );
                  case 'hr':
                    return <hr key={idx} className="my-6 border-line-subtle" />;
                  case 'code':
                    return (
                      <pre
                        key={idx}
                        className="rounded-md bg-surface-elevated border border-line p-4 overflow-x-auto text-xs sm:text-sm font-mono text-content leading-relaxed my-4"
                      >
                        <code>{block.content}</code>
                      </pre>
                    );
                  case 'blockquote':
                    return (
                      <blockquote
                        key={idx}
                        className="border-l-2 border-warning bg-warning-bg rounded-r-md px-4 py-3 text-sm text-content space-y-1.5 my-4"
                      >
                        {block.lines.map((line, lIdx) => (
                          <p key={lIdx}>{renderInline(line)}</p>
                        ))}
                      </blockquote>
                    );
                  case 'ul':
                    return (
                      <ul key={idx} className="list-disc pl-5 space-y-2 text-content-secondary">
                        {block.items.map((item, iIdx) => (
                          <li key={iIdx} className="leading-relaxed">
                            {renderInline(item)}
                          </li>
                        ))}
                      </ul>
                    );
                  case 'ol':
                    return (
                      <ol key={idx} className="list-decimal pl-5 space-y-2 text-content-secondary">
                        {block.items.map((item, iIdx) => (
                          <li key={iIdx} className="leading-relaxed">
                            {renderInline(item)}
                          </li>
                        ))}
                      </ol>
                    );
                  case 'p':
                    return (
                      <p key={idx} className="text-content-secondary leading-relaxed">
                        {renderInline(block.text)}
                      </p>
                    );
                  default:
                    return null;
                }
              })}
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
