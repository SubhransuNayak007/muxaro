import {
  addPageNumbersToPdf,
  addWatermarkToPdf,
  compressPdfSmart,
  detectBlankPages,
  removeBlankPagesFromPdf,
  repairPdfMultiEngine,
  rotatePdfPages,
  sanitizePdfDeep,
} from '@/lib/pdf/pdf-document';
import { loadPdfJsDocument } from '@/lib/pdf/pdf-browser';
import { runPdfOcr } from '@/lib/pdf/ocr-engine';
import { pdfToDocxRich, pdfToImagesZip } from '@/lib/pdf/office-convert';
import { protectPdfWithQpdf } from '@/lib/pdf/qpdf-browser';
import { sanitizeFilenameStem } from '@/lib/pdf/errors';
import { applyDestructivePiiRedaction, scanPdfForPii } from './pii-detector';
import { allTablesToJson, extractTablesFromPdf, tableToCsv } from './table-extractor';
import type { AgentRecipeStep, CopilotExecutionResult } from './types';
export { planRecipeFromPrompt } from './recipe-planner';

/**
 * Executes an approved multi-step recipe strictly in memory, passing output Files
 * cleanly from each stage to the next and returning the finalized deliverable.
 */
export async function executeAgentRecipe(
  initialFile: File,
  steps: AgentRecipeStep[],
  onStepUpdate: (updatedSteps: AgentRecipeStep[], progressPct: number, statusText: string) => void,
  signal?: AbortSignal
): Promise<CopilotExecutionResult> {
  const t0 = performance.now();
  if (!steps.length) {
    throw new Error('No runnable action steps were planned.');
  }

  const state = steps.map((s) => ({ ...s, status: 'pending' as AgentRecipeStep['status'], detail: '' }));
  let currentFile = initialFile;
  let extraTextExport: CopilotExecutionResult['extraTextExport'];
  const stem = sanitizeFilenameStem(initialFile.name, 'document');

  for (let i = 0; i < state.length; i += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const step = state[i];
    step.status = 'running';
    const basePct = Math.round((i / state.length) * 100);
    onStepUpdate([...state], basePct, `Running ${step.title}…`);

    try {
      switch (step.toolId) {
        case 'ocr_pdf': {
          const ocr = await runPdfOcr(
            currentFile,
            {
              mode: 'ocr',
              maxPages: Number(step.params.maxPages || 30),
              outputFormat: 'searchable-pdf',
            },
            (p, msg) => onStepUpdate([...state], basePct + Math.round((p / 100) * (100 / state.length)), msg || step.title),
            signal
          );
          currentFile = new File([ocr.result.blob], ocr.result.fileName, { type: ocr.result.mimeType });
          step.detail = `OCR indexed ${ocr.pages.length} page(s)`;
          break;
        }
        case 'remove_blank_pages': {
          const check = await detectBlankPages(currentFile, 0.0005, undefined, signal);
          if (check.blankPages.length > 0 && check.blankPages.length < check.totalPages) {
            const res = await removeBlankPagesFromPdf(currentFile, check.blankPages, undefined, signal);
            currentFile = new File([res.blob], res.fileName, { type: 'application/pdf' });
            step.detail = `Removed ${check.blankPages.length} blank page(s)`;
          } else {
            step.detail = '0 removable blank pages found';
          }
          break;
        }
        case 'smart_redact_pii': {
          const hits = await scanPdfForPii(currentFile);
          if (hits.length > 0) {
            const res = await applyDestructivePiiRedaction(currentFile, hits);
            currentFile = new File([res.blob], res.fileName, { type: 'application/pdf' });
            step.detail = res.summary || `Redacted ${hits.length} PII item(s)`;
          } else {
            step.detail = '0 matching PII entities detected';
          }
          break;
        }
        case 'sanitize_metadata': {
          const res = await sanitizePdfDeep(currentFile, {
            stripJavaScript: true,
            stripEmbeddedFiles: true,
            stripMetadata: true,
            stripExternalActions: true,
          });
          currentFile = new File([res.blob], res.fileName, { type: 'application/pdf' });
          step.detail = res.summary || 'Metadata & scripts stripped';
          break;
        }
        case 'rotate_pages': {
          const deg = Number(step.params.degrees || 90);
          const pdf = await loadPdfJsDocument(currentFile);
          const total = pdf.numPages;
          await pdf.destroy().catch(() => {});
          const map: Record<number, number> = {};
          for (let p = 1; p <= total; p += 1) map[p] = deg;
          const res = await rotatePdfPages(currentFile, map, undefined, signal);
          currentFile = new File([res.blob], res.fileName, { type: 'application/pdf' });
          step.detail = `Rotated ${total} page(s) by ${deg}°`;
          break;
        }
        case 'add_watermark': {
          const text = String(step.params.text || 'CONFIDENTIAL').trim() || 'CONFIDENTIAL';
          const res = await addWatermarkToPdf(currentFile, {
            kind: 'text',
            text,
            fontSize: 36,
            opacity: 0.22,
            rotation: -35,
            color: '#254EDB',
            layout: 'tiled',
            layer: 'above',
          });
          currentFile = new File([res.blob], res.fileName, { type: 'application/pdf' });
          step.detail = `Stamped "${text}" watermark`;
          break;
        }
        case 'add_page_numbers': {
          const res = await addPageNumbersToPdf(currentFile, {
            format: String(step.params.format || 'Page {page} of {total}'),
            position: 'bottom-center',
            fontSize: 10,
            startNumber: 1,
            marginPt: 24,
            color: '#545964',
          });
          currentFile = new File([res.blob], res.fileName, { type: 'application/pdf' });
          step.detail = res.summary || 'Stamped footer page numbers';
          break;
        }
        case 'compress_pdf': {
          const mode = (String(step.params.mode || 'balanced') as 'balanced' | 'lossless' | 'grayscale');
          const res = await compressPdfSmart(
            currentFile,
            { mode, quality: 0.72, targetDpi: 150, allowLarger: false },
            undefined,
            signal
          );
          currentFile = new File([res.blob], res.fileName, { type: 'application/pdf' });
          step.detail = res.summary || `Compressed to ${(currentFile.size / 1024).toFixed(0)} KB`;
          break;
        }
        case 'extract_tables_csv': {
          const tables = await extractTablesFromPdf(currentFile);
          if (tables.length === 1) {
            extraTextExport = {
              fileName: `${stem}-table-1.csv`,
              content: tableToCsv(tables[0]),
              mimeType: 'text/csv;charset=utf-8',
            };
          } else if (tables.length > 1) {
            extraTextExport = {
              fileName: `${stem}-tables.json`,
              content: allTablesToJson(tables),
              mimeType: 'application/json;charset=utf-8',
            };
          }
          step.detail = `Extracted ${tables.length} structured table(s)`;
          break;
        }
        case 'pdf_to_word': {
          const res = await pdfToDocxRich(currentFile, undefined, signal);
          currentFile = new File([res.blob], res.fileName, { type: res.mimeType });
          step.detail = res.summary || 'Exported Word (.docx)';
          break;
        }
        case 'pdf_to_images': {
          const res = await pdfToImagesZip(currentFile, { format: 'png', dpi: 150, quality: 0.92 }, undefined, signal);
          currentFile = new File([res.blob], res.fileName, { type: res.mimeType });
          step.detail = res.summary || 'Exported PNG Zip';
          break;
        }
        case 'repair_pdf': {
          const res = await repairPdfMultiEngine(currentFile, undefined, signal);
          currentFile = new File([res.blob], res.fileName, { type: 'application/pdf' });
          step.detail = res.summary || 'Repaired PDF structure & cross-reference tables';
          break;
        }
        case 'protect_pdf': {
          const pw = String(step.params.password || '').trim();
          if (pw.length < 4) {
            throw new Error('Password must be at least 4 characters to encrypt.');
          }
          const rawBytes = new Uint8Array(await currentFile.arrayBuffer());
          const encBytes = await protectPdfWithQpdf(rawBytes, {
            userPassword: pw,
            keyBits: 256,
            allowPrint: true,
            allowModify: false,
            allowCopy: true,
          });
          const encBlob = new Blob([new Uint8Array(encBytes)], { type: 'application/pdf' });
          currentFile = new File([encBlob], `${sanitizeFilenameStem(currentFile.name)}-locked.pdf`, {
            type: 'application/pdf',
          });
          step.detail = 'Encrypted with QPDF AES-256';
          break;
        }
        default: {
          step.detail = 'Skipped unsupported step';
        }
      }
      step.status = 'done';
    } catch (err) {
      step.status = 'error';
      step.detail = err instanceof Error ? err.message : String(err);
      onStepUpdate([...state], basePct, `Stopped at ${step.title}`);
      throw err;
    }
  }

  onStepUpdate([...state], 100, 'Pipeline completed cleanly');
  return {
    summary: `Completed ${state.length} step(s): ${state.map((s) => s.title).join(' -> ')}`,
    outputFile: currentFile,
    extraTextExport,
    steps: state,
    elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
  };
}
