# MUXARO — Tool Capability & Risk Matrix (52 Tools)

- **PDF Suite (38 tools)**: Registered in `apps/web/lib/tools-catalog.ts` & `apps/web/lib/ai/tool-registry.ts`. Execution engine runs locally via `pdf-lib`, `pdfjs-dist`, `qpdf-run` (WASM), and `tesseract.js` (WASM) under `tier0_local`. High-risk destructive tools (`redact`, `delete`, `protect`, `sanitize`, `strip-metadata`) require explicit confirmation (`requiresConfirmation: true`).
- **Media Suite (14 tools)**: Registered in `apps/web/lib/tools-catalog.ts` & `apps/web/lib/ai/tool-registry.ts`. Desktop `.exe` executes locally via bundled `ffmpeg.exe` and `yt-dlp`; browser/APK runtimes execute supported jobs via FFmpeg.wasm or classify platform/heavy URLs cleanly via `lib/media/source-resolver.ts`.
- **Unified AI Orchestrator**: Natural-language prompts route deterministically through:
  1. Source classification (`classifyMediaSourceUrl`) for pasted links
  2. Validated multi-image ingestion (`ingestImageBatch` -> `imagesToPdf` -> OCR + RAG summary)
  3. Multi-PDF merge & sequential pipelines (`planRecipeFromPrompt` -> `executeAgentRecipe`)
  4. Document-grounded Q&A (`queryRagSpace` -> `buildTier0ExtractiveAnswer` / local SLM / masked BYOK)
  5. Inline media jobs (`/api/v1/jobs` on Desktop Studio)
