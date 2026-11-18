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

interface Props {
  params: {
    slug: string;
  };
}

export function generateStaticParams() {
  return ALL_DOCS.map((doc) => ({
    slug: doc.slug,
  }));
}

export function generateMetadata({ params }: Props) {
  const doc = DOCS_REGISTRY[params.slug];
  if (!doc) return { title: 'Guide Not Found — MUXARO' };
  return {
    title: `${doc.title} — MUXARO Docs`,
    description: doc.description,
  };
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

function stripFrontmatter(raw: string): string {
  const trimmed = raw.replace(/\r\n/g, '\n');
  if (trimmed.startsWith('---\n')) {
    const endIdx = trimmed.indexOf('\n---\n', 4);
    if (endIdx !== -1) {
      return trimmed.slice(endIdx + 5).trim();
    }
  }
  return trimmed.trim();
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

type MarkdownBlock =
  | { type: 'h2' | 'h3' | 'h4'; text: string }
  | { type: 'hr' }
  | { type: 'code'; lang: string; content: string }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'p'; text: string };

function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const lines = source.split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

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
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push({ type: 'code', lang, content: codeLines.join('\n') });
      continue;
    }

    if (trimmed.startsWith('#### ')) {
      blocks.push({ type: 'h4', text: trimmed.slice(5).trim() });
      i++;
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

    if (trimmed.startsWith('|') && i + 1 < lines.length && lines[i + 1].trim().startsWith('|') && lines[i + 1].includes('---')) {
      const parseRow = (row: string) =>
        row
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((cell) => cell.trim());

      const headers = parseRow(lines[i]);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
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
      !lines[i].trim().startsWith('|') &&
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

export default function DocDetailPage({ params }: Props) {
  const doc = DOCS_REGISTRY[params.slug];
  if (!doc) notFound();

  const rawContent = readMarkdownFile(doc.filePath);
  const bodyMarkdown = rawContent
    ? stripFrontmatter(rawContent)
    : `${doc.description}`;
  const blocks = parseMarkdownBlocks(bodyMarkdown);

  const currentIdx = ALL_DOCS.findIndex((item) => item.slug === doc.slug);
  const prevDoc = currentIdx > 0 ? ALL_DOCS[currentIdx - 1] : null;
  const nextDoc = currentIdx >= 0 && currentIdx < ALL_DOCS.length - 1 ? ALL_DOCS[currentIdx + 1] : null;

  return (
    <div className="min-h-screen bg-base">
      {/* Editorial Header */}
      <section className="muxaro-hero-surface border-b border-line">
        <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-14">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-content-secondary mb-5">
            <Link href="/docs" className="hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:opacity-90 rounded-sm transition-colors font-medium">
              Documentation
            </Link>
            <ChevronRight className="w-4 h-4 text-content-muted" aria-hidden="true" />
            <span className="text-content font-medium">{doc.category}</span>
          </nav>

          <div className="max-w-3xl">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-content tracking-tight leading-tight">
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
              <span className="inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-content-muted" aria-hidden="true" />
                <span>{doc.readingTime}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-content-muted" aria-hidden="true" />
                <span>Updated {doc.lastUpdated}</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content + Sidebar */}
      <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Sidebar Navigation */}
          <aside className="lg:col-span-3 lg:sticky lg:top-24 space-y-4">
            <div className="muxaro-card p-4">
              <h2 className="text-sm font-semibold text-content mb-3 px-2">
                All guides
              </h2>
              <nav aria-label="Documentation guides" className="space-y-1">
                {ALL_DOCS.map((item) => {
                  const isActive = item.slug === doc.slug;
                  return (
                    <Link
                      key={item.slug}
                      href={`/docs/${item.slug}`}
                      className={`block px-3 py-2 rounded-sm text-sm transition-colors ${
                        isActive
                          ? 'bg-surface-muted text-brand font-semibold'
                          : 'text-content-secondary hover:bg-surface-elevated hover:text-content'
                      }`}
                    >
                      {item.title}
                    </Link>
                  );
                })}
              </nav>
            </div>

            <div className="muxaro-card p-5">
              <h2 className="text-sm font-semibold text-content mb-1.5">
                Ready to process media?
              </h2>
              <p className="text-xs text-content-secondary leading-relaxed mb-4">
                Inspect streams, extract audio without re-encoding, or merge video and audio in seconds.
              </p>
              <Link
                href="/"
                className="muxaro-btn-primary w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm"
              >
                <span>Open workspace</span>
                <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
              </Link>
            </div>
          </aside>

          {/* Editorial Article Surface */}
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
                      <h3
                        key={idx}
                        className="text-base sm:text-lg font-semibold text-content mt-7 mb-2"
                      >
                        {renderInline(block.text)}
                      </h3>
                    );
                  case 'h4':
                    return (
                      <h4
                        key={idx}
                        className="text-sm sm:text-base font-semibold text-content mt-5 mb-1.5"
                      >
                        {renderInline(block.text)}
                      </h4>
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
                        className="border-l-2 border-brand bg-surface-elevated rounded-r-md px-4 py-3 text-sm text-content-secondary space-y-1.5 my-4"
                      >
                        {block.lines.map((line, lIdx) => (
                          <p key={lIdx}>{renderInline(line)}</p>
                        ))}
                      </blockquote>
                    );
                  case 'table':
                    return (
                      <div
                        key={idx}
                        className="overflow-x-auto rounded-md border border-line my-5"
                      >
                        <table className="w-full text-left border-collapse text-xs sm:text-sm">
                          <thead>
                            <tr className="bg-surface-elevated border-b border-line">
                              {block.headers.map((header, hIdx) => (
                                <th
                                  key={hIdx}
                                  className="px-4 py-2.5 font-semibold text-content whitespace-nowrap"
                                >
                                  {renderInline(header)}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line-subtle bg-surface">
                            {block.rows.map((row, rIdx) => (
                              <tr key={rIdx} className="hover:bg-surface-elevated transition-colors">
                                {row.map((cell, cIdx) => (
                                  <td key={cIdx} className="px-4 py-2.5 text-content-secondary align-top">
                                    {renderInline(cell)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
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

            {/* Previous / Next Guide Navigation */}
            <div className="mt-12 pt-6 border-t border-line grid grid-cols-1 sm:grid-cols-2 gap-4">
              {prevDoc ? (
                <Link
                  href={`/docs/${prevDoc.slug}`}
                  className="muxaro-card-interactive p-4 flex items-center gap-3 group"
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
                  className="muxaro-card-interactive p-4 flex items-center justify-between gap-3 text-right group"
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
        </div>
      </div>
    </div>
  );
}
