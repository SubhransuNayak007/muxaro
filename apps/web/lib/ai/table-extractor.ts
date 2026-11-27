import { getPageTextSpans, loadPdfJsDocument } from '@/lib/pdf/pdf-browser';
import type { PdfTextSpan } from '@/lib/pdf/types';
import type { ExtractedTable } from './types';

function clusterValues(values: number[], tol: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const centers: number[] = [];
  for (const v of sorted) {
    const prev = centers[centers.length - 1];
    if (prev !== undefined && Math.abs(v - prev) <= tol) {
      centers[centers.length - 1] = (prev + v) * 0.5;
    } else {
      centers.push(v);
    }
  }
  return centers;
}

interface GroupedRow {
  y: number;
  cells: Array<{ x: number; right: number; text: string }>;
}

function groupPageRows(spans: PdfTextSpan[]): GroupedRow[] {
  const sorted = [...spans]
    .filter((s) => s.text.trim().length > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const rows: GroupedRow[] = [];
  for (const sp of sorted) {
    const last = rows[rows.length - 1];
    const yTol = Math.max(0.009, sp.height * 0.65);
    if (last && Math.abs(last.y - sp.y) <= yTol) {
      const prevCell = last.cells[last.cells.length - 1];
      if (prevCell && sp.x - prevCell.right <= 0.012) {
        prevCell.text = `${prevCell.text} ${sp.text}`.trim();
        prevCell.right = Math.max(prevCell.right, sp.x + sp.width);
      } else {
        last.cells.push({ x: sp.x, right: sp.x + sp.width, text: sp.text.trim() });
      }
    } else {
      rows.push({
        y: sp.y,
        cells: [{ x: sp.x, right: sp.x + sp.width, text: sp.text.trim() }],
      });
    }
  }
  return rows;
}

/**
 * Spatial Table Extractor (SciSpace / Nitro equivalent):
 * Identifies multi-column tabular bands using repeating X-column alignments across consecutive Y rows.
 */
export async function extractTablesFromPdf(file: File, maxPages = 35): Promise<ExtractedTable[]> {
  const pdf = await loadPdfJsDocument(file);
  const pageCount = Math.min(pdf.numPages, maxPages);

  const tables: ExtractedTable[] = [];
  let seq = 1;

  try {
  for (let pageNo = 1; pageNo <= pageCount; pageNo += 1) {
    const spans = await getPageTextSpans(pdf, pageNo);
    const rows = groupPageRows(spans);

    // Collect contiguous sequences of rows containing >= 2 horizontally separated cells
    let band: GroupedRow[] = [];
    const flushBand = () => {
      if (band.length < 3) {
        band = [];
        return;
      }
      const allX = band.flatMap((r) => r.cells.map((c) => c.x));
      const colAnchors = clusterValues(allX, 0.048);
      if (colAnchors.length < 2 || colAnchors.length > 14) {
        band = [];
        return;
      }

      const matrix = band.map((r) => {
        const out = new Array<string>(colAnchors.length).fill('');
        for (const c of r.cells) {
          let bestIdx = 0;
          let bestDist = Infinity;
          for (let ci = 0; ci < colAnchors.length; ci += 1) {
            const d = Math.abs(c.x - colAnchors[ci]);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = ci;
            }
          }
          out[bestIdx] = out[bestIdx] ? `${out[bestIdx]} ${c.text}` : c.text;
        }
        return out;
      });

      const filledRatio =
        matrix.reduce((acc, row) => acc + row.filter(Boolean).length, 0) /
        Math.max(1, matrix.length * colAnchors.length);
      if (filledRatio < 0.42) {
        band = [];
        return;
      }

      const headers = matrix[0].map((h, i) => h || `Column ${i + 1}`);
      const dataRows = matrix.slice(1);
      const minX = Math.min(...band.flatMap((r) => r.cells.map((c) => c.x)));
      const maxX = Math.max(...band.flatMap((r) => r.cells.map((c) => c.right)));
      const minY = Math.min(...band.map((r) => r.y));
      const maxY = Math.max(...band.map((r) => r.y + 0.025));

      tables.push({
        id: `tbl-${pageNo}-${seq}`,
        pageNumber: pageNo,
        title: `Table ${seq} (Page ${pageNo})`,
        headers,
        rows: dataRows,
        confidence: Math.round(filledRatio * 100),
        bounds: {
          x: Math.max(0, minX),
          y: Math.max(0, minY),
          width: Math.min(1, maxX - minX),
          height: Math.min(1, maxY - minY),
        },
      });
      seq += 1;
      band = [];
    };

    for (const r of rows) {
      if (r.cells.length >= 2) {
        band.push(r);
      } else {
        flushBand();
      }
    }
    flushBand();
  }
  } finally {
    await pdf.destroy().catch(() => {});
  }

  return tables;
}

export function tableToCsv(table: ExtractedTable): string {
  const esc = (val: string) => {
    const s = String(val ?? '');
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  return [table.headers.map(esc).join(','), ...table.rows.map((r) => r.map(esc).join(','))].join('\n');
}

export function allTablesToJson(tables: ExtractedTable[]): string {
  return JSON.stringify(
    tables.map((t) => ({
      title: t.title,
      pageNumber: t.pageNumber,
      headers: t.headers,
      rows: t.rows.map((r) => Object.fromEntries(t.headers.map((h, idx) => [h, r[idx] || '']))),
    })),
    null,
    2
  );
}
