import type { AgentRecipeStep } from './types.ts';

function makeStepId(idx: number, toolId: string): string {
  return `step-${idx}-${toolId}`;
}

/**
 * Compound Natural-Language Recipe Planner:
 * Parses single or multi-step prompts (e.g. "OCR, remove blank pages, redact PII, compress and lock")
 * into an ordered deterministic execution DAG in < 5ms offline.
 */
export function planRecipeFromPrompt(
  prompt: string,
  context?: { scannedPagesCount?: number }
): AgentRecipeStep[] {
  const clean = prompt.trim();
  if (!clean) return [];

  const steps: AgentRecipeStep[] = [];
  let seq = 1;

  const pushStep = (step: Omit<AgentRecipeStep, 'id' | 'status'>) => {
    if (steps.some((s) => s.toolId === step.toolId)) return;
    steps.push({
      ...step,
      id: makeStepId(seq++, step.toolId),
      status: 'pending',
    });
  };

  const scannedCount = context?.scannedPagesCount || 0;
  const needsTextLayer = /\b(ocr|searchable|scan\s*text|recognize\s*text|pii|redact|sensitive|table|csv|excel|extract)\b/i.test(clean);

  if (/\b(ocr|searchable|scan\s*text|recognize\s*text)\b/i.test(clean) || (scannedCount > 0 && needsTextLayer)) {
    pushStep({
      toolId: 'ocr_pdf',
      title: scannedCount > 0 ? `Run Searchable OCR (${scannedCount} scanned page(s))` : 'Run Searchable OCR',
      description: 'Embed invisible selectable text layer privately on your device',
      destructive: false,
      params: { maxPages: 30 },
    });
  }

  if (/\b(blank|empty)\s*pages?\b/i.test(clean)) {
    pushStep({
      toolId: 'remove_blank_pages',
      title: 'Remove Blank Pages',
      description: 'Scan page ink ratio & delete near-empty sheets',
      destructive: true,
      params: {},
    });
  }

  if (/\b(pii|redact|sensitive|mask|ssn|email|card|privacy)\b/i.test(clean)) {
    pushStep({
      toolId: 'smart_redact_pii',
      title: 'Smart PII Redact (Permanent Burn)',
      description: 'Auto-detect emails, cards, IBAN, SSN, API keys & burn permanently',
      destructive: true,
      params: {},
    });
  }

  if (/\b(sanitize|strip\s*metadata|clean\s*metadata|scrub)\b/i.test(clean)) {
    pushStep({
      toolId: 'sanitize_metadata',
      title: 'Sanitize & Scrub Metadata',
      description: 'Strip scripts, hidden metadata, and external link actions',
      destructive: true,
      params: {},
    });
  }

  if (/\b(rotate|orientation|landscape|portrait|90|180|270)\b/i.test(clean)) {
    const degMatch = clean.match(/\b(90|180|270)\b/);
    const deg = degMatch ? Number(degMatch[1]) : 90;
    pushStep({
      toolId: 'rotate_pages',
      title: `Rotate All Pages +${deg}°`,
      description: 'Apply clean lossless /Contents rotation across document pages',
      destructive: false,
      requiresInput: degMatch ? undefined : 'degrees',
      params: { degrees: deg },
    });
  }

  if (/\b(watermark|stamp|confidential|draft)\b/i.test(clean)) {
    const quoted = clean.match(/["']([^"']{2,40})["']/);
    pushStep({
      toolId: 'add_watermark',
      title: 'Apply Diagonal Watermark',
      description: 'Stamp crisp vector watermark text across all pages',
      destructive: false,
      requiresInput: quoted ? undefined : 'watermark-text',
      params: { text: quoted?.[1] || 'CONFIDENTIAL' },
    });
  }

  if (/\b(page\s*numbers?|number\s*pages|numbering)\b/i.test(clean)) {
    pushStep({
      toolId: 'add_page_numbers',
      title: 'Add Footer Page Numbers',
      description: 'Stamp clean tabular-numerals footer ("Page X of Y")',
      destructive: false,
      params: { format: 'Page {page} of {total}' },
    });
  }

  if (/\b(table|csv|excel|xlsx|spreadsheet)\b/i.test(clean)) {
    pushStep({
      toolId: 'extract_tables_csv',
      title: 'Extract Tables to CSV',
      description: 'Cluster multi-column grids using spatial X/Y alignment',
      destructive: false,
      params: {},
    });
  }

  if (/\b(compress|shrink|smaller|reduce|optimize|size)\b/i.test(clean)) {
    const mode = /\b(lossless|qpdf)\b/i.test(clean)
      ? 'lossless'
      : /\b(gray|grey|grayscale)\b/i.test(clean)
        ? 'grayscale'
        : 'balanced';
    pushStep({
      toolId: 'compress_pdf',
      title: `Compress PDF (${mode})`,
      description: 'Shrink streams and images without uploading to any server',
      destructive: false,
      params: { mode },
    });
  }

  if (/\b(word|docx)\b/i.test(clean)) {
    pushStep({
      toolId: 'pdf_to_word',
      title: 'Convert PDF to Word (.docx)',
      description: 'Structure-aware heading & style export locally',
      destructive: false,
      params: {},
    });
  }

  if (/\b(images|png|jpg|jpeg)\b/i.test(clean)) {
    pushStep({
      toolId: 'pdf_to_images',
      title: 'Export Pages to PNG Zip',
      description: 'Render crisp page snapshots locally into ZIP archive',
      destructive: false,
      params: {},
    });
  }

  if (/\b(repair|fix\s*corrupt|rebuild)\b/i.test(clean)) {
    pushStep({
      toolId: 'repair_pdf',
      title: 'Repair PDF XRef',
      description: 'Rebuild broken cross-reference tables cleanly',
      destructive: false,
      params: {},
    });
  }

  if (/\b(lock|encrypt|password|protect)\b/i.test(clean)) {
    pushStep({
      toolId: 'protect_pdf',
      title: 'Encrypt PDF (AES-256)',
      description: 'Lock file locally with QPDF AES-256 encryption',
      destructive: true,
      requiresInput: 'password',
      params: { password: '' },
    });
  }

  return steps;
}
