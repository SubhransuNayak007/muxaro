import React from 'react';

export interface TocHeading {
  id: string;
  text: string;
  level: 2 | 3;
}

export type MarkdownBlock =
  | { type: 'h2' | 'h3' | 'h4'; id: string; text: string }
  | { type: 'hr' }
  | { type: 'code'; lang: string; content: string }
  | { type: 'blockquote'; alertType?: 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION'; lines: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'p'; text: string };

export function stripFrontmatter(raw: string): string {
  const trimmed = raw.replace(/\r\n/g, '\n');
  if (trimmed.startsWith('---\n')) {
    const endIdx = trimmed.indexOf('\n---\n', 4);
    if (endIdx !== -1) {
      return trimmed.slice(endIdx + 5).trim();
    }
  }
  return trimmed.trim();
}

export function normalizeHref(href: string): string {
  const trimmed = (href || '').trim();
  if (!trimmed) return '#';
  if (trimmed === '/legal/terms') return '/terms';
  if (trimmed === '/legal/privacy') return '/privacy';
  if (trimmed === '/legal/dmca') return '/dmca';
  // Block dangerous URI schemes (javascript:, vbscript:, data:, file:)
  if (/^(javascript|vbscript|data|file):/i.test(trimmed.replace(/[\x00-\x20]/g, ''))) {
    return '#';
  }
  return trimmed;
}

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Normalizes simple inline LaTeX expressions into clean readable Unicode text
 * so raw `$...$` syntax never leaks into rendered documentation pages.
 */
export function normalizeInlineMath(text: string): string {
  return text.replace(/\$([^$\n]+)\$/g, (_full, expr: string) => {
    return expr
      .replace(/\\times/g, '×')
      .replace(/\\to/g, '→')
      .replace(/\\approx/g, '≈')
      .replace(/\\%/g, '%')
      .replace(/\\text\{([^}]*)\}/g, '$1')
      .replace(/_\{([^}]*)\}/g, '$1')
      .replace(/_([a-zA-Z0-9])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  });
}

export function parseMarkdownBlocks(source: string): {
  blocks: MarkdownBlock[];
  headings: TocHeading[];
} {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  const headings: TocHeading[] = [];
  const usedIds = new Map<string, number>();

  const uniqueId = (rawText: string) => {
    const base = slugifyHeading(rawText) || 'section';
    const count = usedIds.get(base) ?? 0;
    usedIds.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  };

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
      i++;
      blocks.push({ type: 'code', lang, content: codeLines.join('\n') });
      continue;
    }

    if (trimmed.startsWith('#### ')) {
      const text = normalizeInlineMath(trimmed.slice(5).trim());
      blocks.push({ type: 'h4', id: uniqueId(text), text });
      i++;
      continue;
    }
    if (trimmed.startsWith('### ')) {
      const text = normalizeInlineMath(trimmed.slice(4).trim());
      const id = uniqueId(text);
      blocks.push({ type: 'h3', id, text });
      headings.push({ id, text: text.replace(/[`*]/g, ''), level: 3 });
      i++;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      const text = normalizeInlineMath(trimmed.slice(3).trim());
      const id = uniqueId(text);
      blocks.push({ type: 'h2', id, text });
      headings.push({ id, text: text.replace(/[`*]/g, ''), level: 2 });
      i++;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      let alertType: 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION' | undefined;
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        const cleaned = lines[i].trim().replace(/^>\s?/, '').trim();
        const alertMatch = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/.exec(cleaned);
        if (alertMatch) {
          alertType = alertMatch[1] as typeof alertType;
        } else if (cleaned) {
          quoteLines.push(normalizeInlineMath(cleaned));
        }
        i++;
      }
      if (quoteLines.length > 0) {
        blocks.push({ type: 'blockquote', alertType, lines: quoteLines });
      }
      continue;
    }

    if (
      trimmed.startsWith('|') &&
      i + 1 < lines.length &&
      lines[i + 1].trim().startsWith('|') &&
      lines[i + 1].includes('---')
    ) {
      const parseRow = (row: string) =>
        row
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((cell) => normalizeInlineMath(cell.trim()));

      const headers = parseRow(lines[i]);
      i += 2;
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
      while (i < lines.length) {
        const cur = lines[i].trim();
        if (/^[-*]\s+/.test(cur)) {
          items.push(normalizeInlineMath(cur.replace(/^[-*]\s+/, '')));
          i++;
        } else if (cur !== '' && /^\s{2,}/.test(lines[i]) && items.length > 0) {
          items[items.length - 1] += ' ' + normalizeInlineMath(cur);
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const cur = lines[i].trim();
        if (/^\d+\.\s+/.test(cur)) {
          items.push(normalizeInlineMath(cur.replace(/^\d+\.\s+/, '')));
          i++;
        } else if (
          cur !== '' &&
          (/^\s{2,}/.test(lines[i]) || /^[-*]\s+/.test(cur)) &&
          items.length > 0
        ) {
          items[items.length - 1] += ' ' + normalizeInlineMath(cur.replace(/^[-*]\s+/, '• '));
          i++;
        } else {
          break;
        }
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
      !lines[i].trim().startsWith('>') &&
      !lines[i].trim().startsWith('|') &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      lines[i].trim() !== '---'
    ) {
      paraLines.push(normalizeInlineMath(lines[i].trim()));
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'p', text: paraLines.join(' ') });
    }
  }

  return { blocks, headings };
}
