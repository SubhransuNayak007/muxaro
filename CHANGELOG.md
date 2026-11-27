# Changelog

All notable changes to **MUXARO** are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - 2026-11-27

### Added
- **Smart Intent, Entity Memory & Semantic Routing (`apps/web/lib/ai/`):**
  - `intent-normalizer.ts`: Dictation filler stripping, mid-sentence reversal recovery, spoken number normalization, and Hinglish/bilingual intent cues.
  - `workspace-memory.ts`: Thread entity tracking for multi-file ordinals, output referencing, and iterative follow-up refinements.
  - `intent-router.ts`: Typed routing across 52 tools with 1-tap clarification chips, automatic OCR injection on scanned PDFs, destructive voice handshakes, and cross-domain media-to-PDF-notes pipelines.
  - `semantic-router.ts` & `local-rag.ts`: On-device `@huggingface/transformers` (`Xenova/all-MiniLM-L6-v2` `q8`, WebGPU/WASM) semantic matching and hybrid BM25+vector RAG fusion.
- **100% Offline Cross-Platform Voice Stack:**
  - `speech-engine.ts` & `VoiceOrbOverlay.tsx`: `16 kHz` mono PCM capture with energy VAD, sentence-queued TTS, instant `<20 ms` barge-in cancellation, and pulsing Voice Orb UI.
  - Windows Desktop (`apps/desktop/src/main.ts`): `/api/v1/ai/stt` (`whisper.cpp` via bundled `ffmpeg.exe`), `/api/v1/ai/tts` (`Piper` neural TTS with Windows SAPI fallback), `/api/v1/ai/voice/*` pack installer, and `/api/v1/ai/chat/stream` SSE streaming for Ollama/LM Studio/BYOK.
  - Android APK (`MuxaroAiPlugin.java`, `MuxaroMediaPlugin.java`): Native `SpeechRecognizer.createOnDeviceSpeechRecognizer` + `RECORD_AUDIO` flow, RMS telemetry, `UtteranceProgressListener` TTS queueing, and native multi-platform video downloading.
- **Unified Studio & Governance:**
  - 52 browser-local and hybrid tools (38 PDF + 14 Media) across Next.js 16 static export shared by Web, Electron 35 `.exe`, and Capacitor 7 `.apk`.
  - Updated live screenshots, showcase MP4 (`assets/animations/muxaro-showcase.mp4`), demo GIF (`assets/animations/muxaro-demo.gif`), SVG architecture diagram, and harmonized `Apache-2.0` licensing metadata.

---

## [0.1.0] - 2026-11-18

- Initial Fastify 5 API, media worker, SSRF/security package, TurboFlow priority queue, and Next.js Web workspace release.
