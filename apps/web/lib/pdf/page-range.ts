export interface ParsedPageRange {
  pages: number[];
  invalidTokens: string[];
}

/**
 * Parses human page range specifications like "1-3, 5, odd, even, last, 12-end"
 * into deduplicated 1-based page numbers preserving input order.
 */
export function parsePageRange(input: string, totalPages: number): ParsedPageRange {
  if (totalPages < 1) {
    return { pages: [], invalidTokens: [] };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return {
      pages: Array.from({ length: totalPages }, (_, i) => i + 1),
      invalidTokens: [],
    };
  }

  const seen = new Set<number>();
  const pages: number[] = [];
  const invalidTokens: string[] = [];

  const pushPage = (n: number) => {
    if (n >= 1 && n <= totalPages && !seen.has(n)) {
      seen.add(n);
      pages.push(n);
    }
  };

  for (const rawToken of trimmed.split(',')) {
    const token = rawToken.trim().toLowerCase();
    if (!token) continue;

    if (token === 'all') {
      for (let i = 1; i <= totalPages; i += 1) pushPage(i);
      continue;
    }
    if (token === 'odd') {
      for (let i = 1; i <= totalPages; i += 2) pushPage(i);
      continue;
    }
    if (token === 'even') {
      for (let i = 2; i <= totalPages; i += 2) pushPage(i);
      continue;
    }
    if (token === 'last' || token === 'end') {
      pushPage(totalPages);
      continue;
    }

    const rangeMatch = /^(\d+)\s*-\s*(\d+|last|end)$/.exec(token);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1], 10);
      const end =
        rangeMatch[2] === 'last' || rangeMatch[2] === 'end'
          ? totalPages
          : Number.parseInt(rangeMatch[2], 10);
      if (start < 1 || end < 1 || start > totalPages || end > totalPages) {
        invalidTokens.push(rawToken.trim());
        continue;
      }
      const step = start <= end ? 1 : -1;
      for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
        pushPage(i);
      }
      continue;
    }

    if (/^\d+$/.test(token)) {
      const n = Number.parseInt(token, 10);
      if (n < 1 || n > totalPages) {
        invalidTokens.push(rawToken.trim());
      } else {
        pushPage(n);
      }
      continue;
    }

    invalidTokens.push(rawToken.trim());
  }

  return { pages, invalidTokens };
}

/**
 * Formats a sorted or unsorted set of 1-based page numbers into a compact range string (e.g. "1, 4-8, 12").
 */
export function formatPagesToRangeString(pages: number[]): string {
  const sorted = Array.from(new Set(pages.filter((n) => Number.isFinite(n) && n >= 1))).sort(
    (a, b) => a - b
  );
  if (sorted.length === 0) return '';
  const parts: string[] = [];
  let start = sorted[0];
  let end = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    const cur = sorted[i];
    if (cur === end + 1) {
      end = cur;
    } else {
      parts.push(start === end ? `${start}` : `${start}-${end}`);
      start = cur;
      end = cur;
    }
  }
  parts.push(start === end ? `${start}` : `${start}-${end}`);
  return parts.join(', ');
}

export function parseSplitGroups(input: string, totalPages: number): number[][] {
  const groups: number[][] = [];
  for (const segment of input.split(';')) {
    const clean = segment.trim();
    if (!clean) continue;
    const { pages } = parsePageRange(clean, totalPages);
    if (pages.length > 0) {
      groups.push(pages);
    }
  }
  return groups;
}

export function formatPageSelectionSummary(pages: number[], totalPages: number): string {
  if (pages.length === 0) return 'No pages selected';
  if (pages.length === totalPages) return `All ${totalPages} pages`;
  if (pages.length <= 6) return `Pages ${pages.join(', ')}`;
  return `${pages.length} of ${totalPages} pages selected`;
}
