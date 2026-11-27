# MUXARO — Architecture & Product Audit Summary

## 1. Monorepo Architecture
- **Frontend & Shared Engines (`apps/web`)**: Next.js 16 + React 18 + Tailwind CSS static-exportable studio housing 52 tools (38 PDF + 14 Media), local AI RAG/orchestration (`lib/ai/`), PDF processing (`lib/pdf/`), unified image ingestion (`lib/pdf/image-pipeline.ts`), and media planning (`lib/media/source-resolver.ts`).
- **Desktop Workstation (`apps/desktop`)**: Electron 35 portable Windows app (`MUXARO-Studio-Windows-x64.exe`) serving `resources/web-dist` over `127.0.0.1` HTTP + IPC/REST bridges to native `ffmpeg.exe` and `yt-dlp`.
- **Android Mobile App (`apps/mobile`)**: Capacitor 7 Android shell (`MUXARO-Studio.apk`) syncing `apps/web/out` via `scripts/sync-www.mjs` cleanly into `/m/`.

## 2. Priority Zero Walkthrough Root Causes & Fixes
1. **Image Decoding Failure ("The source image could not be decoded.")**
   - *Cause*: `PdfMakeFromCameraTool` & `PdfImageToPdfTool` checked `file.type.startsWith('image/')`, lacked magic-byte checks or `Image` canvas fallback, and failed the entire batch on any corrupt/HEIC/0-byte file.
   - *Fix*: Built `lib/pdf/image-pipeline.ts` with magic-byte detection, bounded decode concurrency (`2` on mobile / `3` on desktop), multi-tier decode fallback, explicit per-file states, and isolated **Retry / Replace / Remove** recovery keeping valid pages in order.
2. **YouTube / Media Link Inspection ("Media inspection returned an empty manifest.")**
   - *Cause*: Pasted URLs went unconditionally to `/media/inspect` and threw an empty manifest error without source classification.
   - *Fix*: Added `lib/media/source-resolver.ts` classifying `direct_media`, `youtube`, `platform_video`, `cloud_storage`, `webpage`, and `invalid_or_restricted` (with SSRF guard) and offering real alternatives (**Upload local file**, **Google Drive**, **Open source page**).
3. **Microphone Permission Failure**
   - *Cause*: Bare boolean error on failure without permission probing or track cleanup.
   - *Fix*: Added `VoiceLifecycleState` (`not_requested` -> `requesting` -> `granted` / `denied` / `dismissed` / `device_unavailable` / `unsupported` / `recording` / `transcribing` / `failed`), `probeVoiceCapabilities()`, immediate track stop, retry button, and typed fallback in `lib/ai/speech-engine.ts` + `MuxaroCopilotPanel.tsx`.
4. **Inconsistent Mobile Navigation**
   - *Cause*: Legacy `"Mobile Hub"` button & floating back badge differed from `/m` bottom tabs (`Studio / PDF / Media / Files`).
   - *Fix*: Unified `LayoutChrome.tsx` & `MobileStudioShell.tsx` to use consistent MUXARO chrome and direct tab links (`/m?tab=studio|pdf|media|saved`).
5. **AI Formatting & Citation Grounding**
   - *Cause*: Assistant messages rendered raw `**` markdown tokens; RAG allowed duplicate chunks and truncated filenames blindly via `.slice(0, 16)`.
   - *Fix*: Created `AssistantMarkdown.tsx` for formatted Markdown rendering and updated `local-rag.ts` with Jaccard/substring passage deduplication, OCR page indicators, insufficient-evidence detection, and clean truncation with full tooltip provenance.
6. **Misleading Media Conversion Claims**
   - *Cause*: `convert-tool.tsx` displayed static `"12x faster"` and unconditional `"100% mathematical fidelity"`.
   - *Fix*: Wired `planMediaConversion()` distinguishing **Remux (Container Copy)** vs **Transcode Required** vs **Incompatible Input** cleanly.
