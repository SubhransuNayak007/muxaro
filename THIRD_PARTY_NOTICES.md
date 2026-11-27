# Third-Party Notices & License Attribution

**Project:** MUXARO (`SubhransuNayak007/muxaro`)
**Repository License:** Apache License, Version 2.0 (`Apache-2.0`) — see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE)
**Audit Date:** 2026-11-27

This document summarizes the verified third-party packages, client/mobile runtimes, AI models, typography, and external CLI tools used across MUXARO.

---

## 1. License Compatibility Overview

First-party TypeScript, React, Electron, Capacitor/Android Java, and API modules use **permissive dependencies** (`MIT`, `Apache-2.0`, `ISC`, `BSD-3-Clause`, `0BSD`, `BlueOak-1.0.0`, `CC-BY-4.0`) compatible with **`Apache-2.0`**.

External copyleft or platform binaries (such as GPL/LGPL `FFmpeg` builds and `@ffmpeg/core` WebAssembly workers) are strictly isolated across out-of-process CLI subprocess boundaries (`execFile` / `spawn`, `shell: false`) or browser Web Workers.

---

## 2. Core Dependencies by Application

### 2.1 `apps/web` (`@muxaro/web`)
| Package / Component | License | Role |
| :--- | :--- | :--- |
| `next` (`16.4.6`), `react`, `react-dom` | `MIT` | App Router UI and static bundle export (`apps/web/out`) |
| `tailwindcss`, `clsx`, `tailwind-merge` | `MIT` | Design token styling and utilities |
| `lucide-react` | `ISC` | UI iconography |
| `@huggingface/transformers` | `Apache-2.0` | On-device semantic routing embeddings & quantized browser Whisper (`q8` WebGPU/WASM) |
| `pdf-lib`, `jspdf`, `jsqr`, `jszip`, `@aiden0z/pptx-renderer` | `MIT` | Client-side PDF composition, form/text authoring, QR decode, ZIP archives |
| `pdfjs-dist` | `Apache-2.0` | Client-side PDF parsing, layout IR, and canvas rendering |
| `tesseract.js`, `@tesseract.js-data/eng` | `Apache-2.0` | Local WASM multi-worker OCR engine |
| `qpdf-run` | `Apache-2.0` | Client-side QPDF WASM AES-256 encryption, decryption, repair, and lossless compression |
| `@ffmpeg/ffmpeg`, `@ffmpeg/util` | `MIT` | Sandboxed FFmpeg Web Worker bridge |
| `@ffmpeg/core` | `LGPL-2.1+` / `GPL-2.0+` *(upstream compile flags)* | Browser WASM transcoding core executed strictly inside Web Workers |
| `@distube/ytdl-core` | `MIT` | Optional URL metadata/stream inspection |

### 2.2 `apps/desktop` (`@muxaro/desktop`)
| Package / Tool | License | Role |
| :--- | :--- | :--- |
| `electron` | `MIT` | Windows portable desktop runtime (`MUXARO-Studio-Windows-x64.exe`) |
| `ffmpeg-static` (`ffmpeg.exe`) | Binary build *(GPL-3.0 / LGPL depending on upstream build)* | Out-of-process video/audio engine in `extraResources/bin` |
| `yt-dlp.exe` *(out-of-process binary)* | `Unlicense` | Out-of-process multi-platform URL stream resolver |
| `whisper.cpp` *(optional user-fetched pack)* | `MIT` | Optional local offline STT (`ggml-tiny-q5_1` / `ggml-base-q5_1`) |
| `Piper` *(optional user-fetched pack)* | `MIT` | Optional local neural TTS (`en_US-lessac-medium.onnx`) |
| `Ollama` / `llama-server` *(user local runtime)* | `MIT` | Optional local LLM streaming (`127.0.0.1:11434` / `:8080`) |

### 2.3 `apps/mobile` (`@muxaro/mobile`)
| Package / Component | License | Role |
| :--- | :--- | :--- |
| `@capacitor/core`, `@capacitor/android`, `@capacitor/camera`, `@capacitor/filesystem`, `@capacitor/haptics`, `@capacitor/share`, `@capacitor/splash-screen`, `@capacitor/status-bar` | `MIT` | Android Capacitor bridge (`MUXARO-Studio.apk`) and hardware camera/filesystem APIs |
| Android SDK `SpeechRecognizer` & `TextToSpeech` | Apache-2.0 (AOSP) | Native `MuxaroAiPlugin.java` offline speech capture & synthesis |

### 2.4 `apps/api`, `apps/media-worker` & `packages/*`
| Component | License | Role |
| :--- | :--- | :--- |
| `fastify`, `@fastify/cors`, `@fastify/helmet`, `@fastify/sensible`, `@fastify/swagger`, `@fastify/swagger-ui`, `zod`, `archiver` | `MIT` | Self-hostable REST/SSE API gateway and FFmpeg media worker microservice |
| `drizzle-orm`, `postgres`, `ioredis`, `bullmq` | `Apache-2.0` / `MIT` | Database ORM, PostgreSQL driver, and queue infrastructure |
| `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | `Apache-2.0` | Object storage integration |

---

## 3. Typography
- **Inter**, **Plus Jakarta Sans**, **Merriweather**, and **JetBrains Mono** via `@fontsource/*` (`OFL-1.1`, SIL Open Font License 1.1).

---

## 4. Clean-Room & Binary Distribution Notice
1. All first-party source code across MUXARO is authored clean-room under the **Apache License 2.0**.
2. Pre-built desktop installers that bundle `ffmpeg.exe` (`ffmpeg-static` / FFmpeg upstream builds) are accompanied by corresponding FFmpeg source attribution: upstream FFmpeg source archives are available at `https://ffmpeg.org/download.html`.
