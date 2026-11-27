import type { CitationRef, DocumentLayoutIR, MindMapNode } from './types';

export interface ActionRiskItem {
  id: string;
  kind: 'action' | 'risk' | 'deadline';
  text: string;
  pageNumber: number;
  sectionTitle: string;
}

/**
 * Generates an interactive hierarchical Mind Map from DocumentLayoutIR headings & key sentences.
 * Works 100% locally in Tier-0 mode and accepts optional LLM JSON overrides.
 */
export function buildMindMapFromLayout(ir: DocumentLayoutIR): MindMapNode {
  const root: MindMapNode = {
    id: 'mm-root',
    label: ir.fileName.replace(/\.pdf$/i, ''),
    pageNumber: 1,
    children: [],
  };

  const sectionMap = new Map<string, MindMapNode>();
  let idx = 1;

  for (const blk of ir.blocks) {
    const secKey = blk.sectionTitle || 'Overview';
    let secNode = sectionMap.get(secKey);
    if (!secNode) {
      if (sectionMap.size >= 8) continue;
      secNode = {
        id: `mm-sec-${idx++}`,
        label: secKey.slice(0, 52),
        pageNumber: blk.pageNumber,
        children: [],
      };
      sectionMap.set(secKey, secNode);
      root.children.push(secNode);
    }

    if (blk.kind !== 'heading' && secNode.children.length < 3) {
      const sentence = blk.text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)[0] || blk.text;
      const trimmed = sentence.trim().slice(0, 68);
      if (trimmed.length >= 16) {
        secNode.children.push({
          id: `mm-leaf-${idx++}`,
          label: trimmed.length === 68 ? `${trimmed}…` : trimmed,
          pageNumber: blk.pageNumber,
          children: [],
        });
      }
    }
  }

  return root;
}

/**
 * Extracts concrete obligations, deadlines, and risk/penalty clauses with page provenance.
 */
export function extractActionItemsAndRisks(ir: DocumentLayoutIR): ActionRiskItem[] {
  const items: ActionRiskItem[] = [];
  let seq = 1;

  for (const blk of ir.blocks) {
    if (blk.kind === 'heading') continue;
    const sentences = blk.text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/);
    for (const s of sentences) {
      const clean = s.trim();
      if (clean.length < 24 || clean.length > 260) continue;
      if (/\b(deadline|due\s+by|expires?|before\s+\w+\s+\d{1,2}|within\s+\d+\s+days)\b/i.test(clean)) {
        items.push({
          id: `ar-${seq++}`,
          kind: 'deadline',
          text: clean,
          pageNumber: blk.pageNumber,
          sectionTitle: blk.sectionTitle,
        });
      } else if (/\b(liability|penalty|indemnif|breach|terminate|risk|warning|prohibit|confidential)\b/i.test(clean)) {
        items.push({
          id: `ar-${seq++}`,
          kind: 'risk',
          text: clean,
          pageNumber: blk.pageNumber,
          sectionTitle: blk.sectionTitle,
        });
      } else if (/\b(must|shall|required\s+to|action\s+item|submit|deliver|verify|approve)\b/i.test(clean)) {
        items.push({
          id: `ar-${seq++}`,
          kind: 'action',
          text: clean,
          pageNumber: blk.pageNumber,
          sectionTitle: blk.sectionTitle,
        });
      }
      if (items.length >= 18) return items;
    }
  }
  return items;
}

/**
 * Builds an executive Audio Overview briefing script ready for local Windows SAPI /
 * Android TextToSpeech synthesis.
 */
export function buildAudioOverviewScript(ir: DocumentLayoutIR, topCitations?: CitationRef[]): string {
  const intro = `MUXARO Audio Briefing for ${ir.fileName.replace(/\.pdf$/i, '')}. This document has ${ir.pageCount} pages.`;
  const highlights: string[] = [];

  if (topCitations && topCitations.length > 0) {
    for (const cit of topCitations.slice(0, 5)) {
      const firstLine = cit.snippet.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)[0] || '';
      if (firstLine.trim().length > 20) {
        highlights.push(`On page ${cit.pageNumber}, under ${cit.sectionTitle}: ${firstLine.trim()}`);
      }
    }
  } else {
    const pickedPages = new Set<number>();
    for (const blk of ir.blocks) {
      if (blk.kind === 'heading' || pickedPages.has(blk.pageNumber)) continue;
      const firstLine = blk.text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)[0] || '';
      if (firstLine.trim().length > 28) {
        pickedPages.add(blk.pageNumber);
        highlights.push(`Section ${blk.sectionTitle}, page ${blk.pageNumber}: ${firstLine.trim()}`);
      }
      if (highlights.length >= 6) break;
    }
  }

  if (!highlights.length) {
    return `${intro} No extractable text was found yet. Run Searchable OCR first to generate a narrated briefing.`;
  }

  return `${intro} Here are the key takeaways. ${highlights.join(' ')} End of briefing.`;
}
