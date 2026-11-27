<div align="center">

<p>
  <a href="https://muxaro.vercel.app">
    <img src="assets/branding/muxaro-logo.svg" alt="MUXARO Logo" width="460" />
  </a>
</p>

<h3>Private Offline AI, PDF &amp; 12K Media Workstation</h3>

<p>
  Chat, speak, redact personal info, run OCR, trim lossless 4K–12K video, and extract media locally on
  <strong>Windows Desktop (.exe)</strong>, <strong>Android (.apk)</strong>, and <strong>Web</strong> — with zero mandatory cloud uploads.
</p>

<p>
  <a href="https://muxaro.vercel.app">
    <img src="https://img.shields.io/badge/Production-muxaro.vercel.app-000000?style=flat-square&logo=vercel" alt="Live Production Vercel App" />
  </a>
  <a href="https://github.com/SubhransuNayak007/muxaro/releases/tag/v2.0.0">
    <img src="https://img.shields.io/badge/Release-v2.0.0-254EDB?style=flat-square" alt="MUXARO v2.0.0" />
  </a>
  <a href="https://github.com/SubhransuNayak007/muxaro/actions/workflows/ci.yml">
    <img src="https://github.com/SubhransuNayak007/muxaro/actions/workflows/ci.yml/badge.svg" alt="CI Status" />
  </a>
  <a href="https://github.com/SubhransuNayak007/muxaro/actions/workflows/security.yml">
    <img src="https://github.com/SubhransuNayak007/muxaro/actions/workflows/security.yml/badge.svg" alt="Security Scan" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-Apache_2.0-254EDB?style=flat-square" alt="Apache 2.0 License" />
  </a>
  <img src="https://img.shields.io/badge/Platforms-Windows_%C2%B7_Android_%C2%B7_Web-1F2937?style=flat-square" alt="Platforms" />
  <img src="https://img.shields.io/badge/Tools-52_Local_Utilities-15803D?style=flat-square" alt="52 Tools" />
</p>

<p>
  <a href="https://muxaro.vercel.app"><strong>🚀 Live App (Vercel)</strong></a> ·
  <a href="#preview">🎬 Video Walkthrough</a> ·
  <a href="#how-to-use-muxaro">📖 How to Use</a> ·
  <a href="#why-muxaro">Why MUXARO</a> ·
  <a href="#features">Features</a> ·
  <a href="#screenshots">Screenshots</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="SECURITY.md">Security</a> ·
  <a href="LICENSE">License</a>
</p>

</div>

---

## Preview

<div align="center">

### 🎬 Full Product Walkthrough &amp; Showcase

<p align="center">
  <a href="https://raw.githubusercontent.com/SubhransuNayak007/muxaro/main/assets/animations/muxaro-showcase.mp4" title="Click to view full-resolution MP4 video">
    <img src="assets/animations/muxaro-demo.gif" alt="MUXARO v2.0 Assistant, PDF Studio, 12K Media Studio, and Android Mobile walkthrough" width="880" />
  </a>
</p>

<p align="center">
  <a href="https://raw.githubusercontent.com/SubhransuNayak007/muxaro/main/assets/animations/muxaro-showcase.mp4"><strong>▶ Watch or Download Full 1280×800 60fps MP4 Showcase Video (535 KB)</strong></a>
  <br />
  <sub>Local Voice Orb · Instant &lt;20 ms Speech Barge-In · Multi-Step Self-Corrections · Permanent PII Burn-In · Lossless 12K Stream-Copy · Android Mobile Studio</sub>
</p>

</div>

---

## Why MUXARO

- **Private &amp; Offline-First:** PDF processing, OCR, personal-info redaction, semantic intent routing, and local voice capture run directly on your hardware. External cloud keys (Gemini / OpenAI / Anthropic / OpenRouter) remain opt-in and automatically mask sensitive entities before leaving your device.
- **Natural Conversational Control:** Instead of hunting across 52 disconnected buttons, drop files or speak naturally (*"trim 0:10 to 0:45 and shrink for WhatsApp"* or *"remove blank pages, redact my phone number, and compress"*). Ambiguous inputs trigger 1-tap preset chips rather than blind guesses.
- **Cross-Platform Native Runtimes:** Ships a unified Next.js 16 UI packaged as a standalone **Windows portable `.exe`** (`Electron 35` + native `FFmpeg`/`yt-dlp`/`whisper.cpp`/`Piper`), an **Android `.apk`** (`Capacitor 7` + native Java media & on-device speech plugins), and an optional self-hostable **Fastify 5 REST/SSE API**.
- **Clean-Room Apache-2.0 Boundary:** First-party TypeScript, React, Electron, and Android Java sources carry no copyleft dependencies; CLI engines (`FFmpeg`, `yt-dlp`, `whisper.cpp`, `Piper`) run strictly out-of-process.

---

## How to Use MUXARO

MUXARO combines an **intelligent conversational assistant** with **dedicated full-screen tool suites**. You can accomplish any document or media task using your voice, chat, or direct studio controls.

```mermaid
flowchart TD
    START(["Drop File, Type, or Speak"]) --> ROUTE{"Intent Router"}
    
    ROUTE -->|"Voice / Natural Query"| VOICE["Voice Orb & Workspace Memory"]
    ROUTE -->|"Document / PDF Intent"| PDF["Private PDF Studio (38 Tools)"]
    ROUTE -->|"Video / Audio Intent"| MEDIA["12K Media Studio (14 Tools)"]
    ROUTE -->|"Complex Workflow"| COMPOUND["Multi-Step Recipe Planner"]

    VOICE -->|"Self-Correction / Barge-in"| EXEC["Zero-Upload Client Execution"]
    PDF -->|"OCR / Redact / Compress"| EXEC
    MEDIA -->|"Stream-Copy / Target MB"| EXEC
    COMPOUND -->|"Auto-Chained Pipeline"| EXEC

    EXEC --> OUT(["Downloadable Result + Interactive Chat Card"])
```

### 1. Conversational AI &amp; Local Voice Orb (`/app`)

1. **Launch the Workspace:**
   - On Web: Visit [muxaro.vercel.app/app](https://muxaro.vercel.app/app).
   - On Windows Desktop: Run `MUXARO-Studio-Windows-x64.exe`.
   - On Android: Open the MUXARO app and navigate to **Studio**.
2. **Activate the Voice Orb:**
   - Click or tap the iridescent **Voice Orb** at the center of the composer, or press `Ctrl + Space` on Windows.
   - Speak naturally: *"Shrink this video for WhatsApp"* or *"Redact my Aadhaar number and compress this PDF"*.
3. **Mid-Sentence Self-Corrections:**
   - MUXARO's normalizer automatically cleans spoken fillers and catches intent pivots in real time:
     - *"Make the file 25 MB no wait actually make it 10 MB for Discord"* &rarr; cleanly resolves to `target_mb: 10`.
     - *"Extract audio as wav wait scratch that mp3"* &rarr; extracts as `MP3`.
4. **Instant Barge-In (`<20 ms`):**
   - If the AI is speaking synthesized audio and you begin talking, the engine cuts off speech playback immediately without queuing or echoes.
5. **Multi-Turn Workspace Memory:**
   - Attach multiple files once. Follow-up commands remember active assets:
     - *"Now compress the second file"* &rarr; targets document 2 without re-uploading.

### 2. Private PDF Studio (`/tools/pdf`) — 38 Utilities

All PDF operations execute locally inside sandboxed WebAssembly and browser workers:

- **Permanent PII Redaction &amp; Privacy Scrub:**
  - Detects phone numbers, emails, credit cards, IBAN, SSN, and Indian Aadhaar/PAN numbers.
  - Unlike cosmetic black boxes, MUXARO permanently burns out the underlying text stream from the PDF content dictionary so redacted text cannot be copied or extracted.
- **Scanned Document OCR (Searchable PDF):**
  - Image-only or camera-scanned documents automatically trigger the integrated multi-worker Tesseract WASM engine to generate a searchable text layer.
- **Smart Document Generation:**
  - Generate invoices, quotes, receipts, or structured study sheets from prompt outlines with professional typography and automatic pagination.
- **Lossless Compression &amp; Optimization:**
  - Uses QPDF WASM to linearize, deduplicate duplicate object streams, and downsample embedded imagery to 150 DPI or grayscale with zero data loss.
- **Digital Signatures &amp; Form Fill:**
  - Draw or upload signatures, fill AcroForm fields, flatten annotations, reorder pages, and apply Bates numbering.

### 3. 12K Media &amp; Audio Studio (`/tools/media`) — 14 Utilities

Built on an out-of-process stream-copy-first pipeline:

- **Target-Size Compressor:**
  - Select preset target sizes: **WhatsApp (16 MB)**, **Discord (10 MB)**, **Email (25 MB)**, or enter a custom megabyte limit. MUXARO computes the exact two-pass video and audio bitrates to hit the target file size without guesswork.
- **Stream-Copy Lossless Trimming:**
  - Inspects keyframe intervals with `ffprobe`. If trimming on I-frames, MUXARO remuxes with `-c copy` in milliseconds with zero generation loss and zero re-encoding artifacts.
- **Reels, Shorts &amp; Social Reframer:**
  - 1-click splitting into sequential 60-second clips for YouTube Shorts and Instagram Reels, with smart center-crop reframing to `9:16` vertical or `1:1` square.
- **Broadcast Audio Mastering (`EBU R128`):**
  - Measures integrated loudness and peak levels, normalizing audio tracks to `-16 LUFS` (podcasts) or `-14 LUFS` (YouTube) with true-peak limiting.
- **Lossless Audio Extraction:**
  - Extract tracks directly to `MP3`, `FLAC`, `WAV`, or `Opus` without transcoding overhead.

### 4. Local AI &amp; Private Hardware Integration

- **Local LLM Discovery:**
  - Automatically checks for active local instances of `Ollama` (`http://localhost:11434`), `LM Studio` (`http://localhost:1234`), or `llama-server` (`http://localhost:8080`).
  - Streams responses token-by-token over Server-Sent Events (SSE) with live token/sec telemetry.
- **Encrypted Local Wi-Fi Mesh Sharing:**
  - Connect your mobile phone (`apps/mobile`) to your desktop workstation's local LLM and GPU over your private home Wi-Fi using a 6-digit PIN handshake. No data ever crosses the public internet.

---

## Features

### Conversational AI &amp; 100% Offline Voice
- **Hybrid Intent &amp; Dictation Engine:** Cleans spoken fillers, resolves mid-sentence self-corrections (*"make it 16 MB no wait 10 MB"*), handles Hinglish phrases, and maps requests across all 52 tools using exact rules + quantized on-device embeddings (`all-MiniLM-L6-v2`, `q8` WebGPU/WASM).
- **Thread Workspace Memory:** Tracks multiple attached files and outputs so follow-ups like *"compress the second PDF"* or *"make it smaller"* adjust parameters cleanly without re-attaching files.
- **Offline Speech-to-Text &amp; Neural TTS:**
  - **Windows Desktop:** 16 kHz mono PCM + energy VAD into local `whisper.cpp` (`tiny`/`base` `q5_1`), with `Piper` neural speech synthesis and Windows SAPI fallback.
  - **Android Mobile:** Native `SpeechRecognizer.createOnDeviceSpeechRecognizer` (API 31+) with RMS amplitude telemetry and queued `TextToSpeech` playback.
- **Voice Orb Mode:** Full-screen amplitude-reactive listening overlay with instant `<20 ms` speech **barge-in** interruption and confirmation handshakes before destructive edits.
- **Local LLM Streaming:** Auto-discovers local `Ollama` (`:11434`), `LM Studio` (`:1234`), or `llama-server` (`:8080`) with live Server-Sent Events (SSE) streaming and tokens/sec telemetry, plus encrypted home LAN Wi-Fi sharing (`PIN` paired) for mobile phones.

### Private PDF Studio (38 Tools)
- **Create &amp; Scan:** Invoice/Quote/Receipt maker, prompt-to-PDF generator, validated camera/multi-image batch scanner (`lib/pdf/image-pipeline.ts`), and native Electron Screen-to-PDF capture.
- **Edit &amp; Convert:** Merge, split, compress (QPDF WASM lossless, balanced, grayscale), rotate, reorder, watermark, Bates/page numbering, form fill, flatten, digital e-sign, and PDF-to-Word/JPG export.
- **Intelligent Extraction &amp; Redaction:** Multi-worker Tesseract WASM OCR (auto-inserted when redacting or summarizing scanned PDFs), X/Y table-to-CSV/JSON extraction, permanent burn-in PII redaction (cards, IBAN, SSN, Aadhaar/PAN, phone, email, optional secrets), and page-cited local RAG answers.

### 12K Media &amp; Audio Studio (14 Tools)
- **Stream-Copy First Engine:** Inspects real container/codec metadata via `ffprobe` and uses lossless `-c copy` remuxing whenever containers permit.
- **Creator Workflows:** Exact target-size compression (`10 MB Discord`, `16 MB WhatsApp`, `25 MB Email`), lossless timestamp cutting, 60-second Reels splitting, `9:16` / `16:9` / `1:1` reframing, `EBU R128` loudness normalization, `MP3`/`FLAC`/`WAV`/`Opus` audio extraction, metadata scrubbing, and cross-domain video/audio transcription to structured PDF notes.
- **Native Multi-Platform URL Resolver:** Inspects highest-quality streams on Desktop (`yt-dlp`) and Android (`MuxaroMediaPlugin`) with safe fallback cards in offline browsers.

---

## Screenshots

| Assistant Workspace (`/app`) | Unified 52-Tool Suite (`/tools`) |
| :---: | :---: |
| ![MUXARO Assistant Home](assets/screenshots/assistant-home.png) | ![MUXARO All 52 Tools](assets/screenshots/tools-suite.png) |
| *Clean conversational entry with on-device privacy toggle and Voice Orb trigger.* | *All 38 PDF and 14 Media utilities searchable in one place.* |

| PDF Studio (`/tools/pdf`) | Target-Size Video Compressor |
| :---: | :---: |
| ![MUXARO Private PDF Studio](assets/screenshots/pdf-studio.png) | ![MUXARO Video Compressor](assets/screenshots/media-studio.png) |
| *Zero-upload local PDF tools powered by QPDF, pdf-lib, pdfjs-dist, and Tesseract.* | *Exact bitrate/size calculator for Discord, WhatsApp, Email, and custom MB targets.* |

<p align="center">
  <img src="assets/screenshots/mobile-studio.png" alt="MUXARO Android Mobile Studio" width="320" />
  <br />
  <em>Android Mobile Studio (<code>/m</code>) packaged inside <code>MUXARO-Studio.apk</code>.</em>
</p>

---

## Architecture

<p align="center">
  <img src="assets/diagrams/architecture.svg" alt="MUXARO System Architecture Diagram" width="920" />
</p>

```mermaid
flowchart LR
    subgraph Clients["Clients (Shared Next.js 16 Studio)"]
        WEB["Web App (apps/web)"]
        WIN["Windows Desktop .exe (Electron 35)"]
        APK["Android App .apk (Capacitor 7)"]
    end

    subgraph AI["On-Device AI & Voice Layer"]
        NORM["Utterance Normalizer & Workspace Memory"]
        SEM["Semantic Router (all-MiniLM-L6-v2 Q8 + RAG)"]
        VOICE["Offline Voice (whisper.cpp / Piper / Android Speech)"]
        SLM["Ollama / LM Studio / BYOK SSE Stream"]
    end

    subgraph Engines["Execution & Self-Hosted Backend"]
        PDF["Browser PDF Engine (pdf-lib, pdfjs, QPDF, Tesseract)"]
        NATIVE["Out-of-Process Native Binaries (FFmpeg, FFprobe, yt-dlp)"]
        API["Self-Hosted API (apps/api Fastify 5 + SQLite/Postgres + apps/media-worker)"]
    end

    WEB --> PDF
    WIN --> NORM --> SEM --> VOICE
    APK --> NORM --> VOICE
    SEM --> SLM
    WIN --> NATIVE
    APK --> API
    WEB --> API
```

---

## Tech Stack

| Layer | Technologies | Notes |
| :--- | :--- | :--- |
| **Web Workspace (`apps/web`)** | Next.js `16.4`, React `18`, TypeScript, Tailwind CSS `3.4` | Prerendered static export (`apps/web/out`) deployed on [Vercel](https://muxaro.vercel.app) and shared across Electron/Capacitor |
| **Local AI &amp; RAG** | `@huggingface/transformers`, `Xenova/all-MiniLM-L6-v2` (`q8`), Ollama/llama-server SSE | Hybrid BM25 + vector RAG, typed intent routing, automatic PII masking on cloud fallback |
| **Offline Speech** | Web Audio `16 kHz` PCM + VAD, `whisper.cpp` (`tiny`/`base` `q5_1`), `Piper` ONNX, Android `SpeechRecognizer` &amp; `TextToSpeech` | Zero cloud `webkitSpeechRecognition` lock-in; instant `<20 ms` TTS barge-in |
| **PDF Engine** | `pdf-lib`, `pdfjs-dist`, `tesseract.js`, `qpdf-run`, `jspdf`, `jsqr`, `jszip` | 100% browser/on-device execution (`0` bytes uploaded) |
| **Desktop (`apps/desktop`)** | Electron `35`, Node.js `24`, native `ffmpeg.exe`, `yt-dlp.exe` | Portable Windows x64 executable with local HTTP IPC and LAN Wi-Fi mesh sharing |
| **Mobile (`apps/mobile`)** | Capacitor `7.4`, Android Java SDK (`MuxaroAiPlugin`, `MuxaroMediaPlugin`) | Native Android voice recognition, TTS queueing, hardware camera scanner, and media downloader |
| **Self-Hosted Backend (`apps/api`, `apps/media-worker`)** | Fastify `5`, Zod, `node:sqlite` / PostgreSQL (`drizzle-orm`), Redis / BullMQ, S3 / R2 | Optional multi-user API control plane and isolated transcoding microservice |

---

## Quick Start

### 1. Web Workspace (`apps/web`)

Live on production: **[https://muxaro.vercel.app](https://muxaro.vercel.app)**

To run locally:
```bash
git clone https://github.com/SubhransuNayak007/muxaro.git
cd muxaro

npm --prefix apps/web ci
npm --prefix apps/web run dev
```

Open `http://localhost:3000` (or `/app` for the full-screen Assistant workspace).

### 2. Windows Desktop App (`apps/desktop`)

```bash
STATIC_EXPORT=1 npm --prefix apps/web run build
npm --prefix apps/desktop ci
npm --prefix apps/desktop run build
```

Outputs portable `MUXARO-Studio-Windows-x64.exe` under `apps/desktop/release/`. Place `ffmpeg.exe` and `yt-dlp.exe` in `apps/desktop/bin/` prior to packaging (`copy-web.mjs` automatically bundles `ffmpeg-static`).

### 3. Android APK (`apps/mobile`)

> Requires JDK 21 (e.g. Android Studio JBR) and Android SDK configured.

```bash
STATIC_EXPORT=1 npm --prefix apps/web run build
npm --prefix apps/mobile ci
npm --prefix apps/mobile run build:apk
```

Outputs `app-debug.apk` under `apps/mobile/android/app/build/outputs/apk/debug/`.

### 4. Verification Checks

```bash
npm --prefix apps/web run lint
node --test apps/web/lib/ai/__tests__/intent-engine.test.mjs
npm --prefix apps/desktop run build:ts
```

---

## Repository Layout

<details>
<summary>Expand monorepo structure</summary>

```text
muxaro/
├── apps/
│   ├── web/                # Next.js 16 UI, 52 PDF + Media tools, semantic AI & Voice Orb
│   ├── desktop/            # Electron 35 Windows workstation, local Whisper/Piper/Ollama bridge
│   ├── mobile/             # Capacitor 7 Android app + MuxaroAiPlugin / MuxaroMediaPlugin
│   ├── api/                # Optional Fastify 5 REST/SSE API server
│   └── media-worker/       # Optional standalone FFmpeg/FFprobe microservice
├── packages/
│   ├── chrome-extension/   # Browser companion helper extension
│   ├── config/             # Shared brand constants
│   ├── contracts/          # Shared TypeScript API/job contracts
│   ├── db/                 # Drizzle schema & database definitions
│   ├── entitlements/       # Quota & credit ledger engine
│   ├── network/            # Networking helpers
│   ├── shared/             # Common types & utilities
│   └── source-adapters/    # Permitted media inspection adapters
├── security/               # SSRF guard, FFmpeg arg sanitizer, token signer, rate limiter
├── assets/                 # Branding SVGs, architecture diagram, screenshots, demo MP4/GIF
├── scripts/                # Build and release helper scripts
├── LICENSE                 # Apache License 2.0
├── NOTICE                  # Copyright & out-of-process boundary notices
└── THIRD_PARTY_NOTICES.md  # Verified dependency & binary attributions
```

</details>

---

## Security &amp; Privacy

MUXARO is engineered ground-up for zero unauthorized data egress:
- **Client-Side WASM Boundaries:** PDF rendering, form fields, and OCR run directly inside your browser / Electron webview using memory-isolated WebAssembly workers.
- **Hardened Subprocess Invocation:** All CLI binaries (`ffmpeg`, `ffprobe`, `yt-dlp`) execute strictly via sanitized argument vectors with `shell: false` and strict path whitelists.
- **SSRF &amp; Host Guard:** Local API workers reject private RFC 1918 subnets, cloud metadata IPs (`169.254.169.254`), and loopback addresses.
- **Security Policy:** For vulnerability reporting and our 48-hour triage SLA, review [`SECURITY.md`](SECURITY.md).

---

## License

First-party MUXARO source code across the repository is licensed under the **[Apache License 2.0](LICENSE)** — chosen specifically for its explicit **patent grant &amp; retaliation clause**, **contributor IP protections**, and **trademark reservation** (`NOTICE` §3).

External command-line binaries and WebAssembly codecs (`FFmpeg`, `yt-dlp`, `@ffmpeg/core`, optional user-downloaded `whisper.cpp` and `Piper`) operate strictly out-of-process or inside sandboxed browser Web Workers with full attribution in [`NOTICE`](NOTICE) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
