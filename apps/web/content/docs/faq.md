---
title: "Frequently Asked Questions (FAQ) & Platform Architecture"
slug: "faq"
description: "Answers on MUXARO's zero-credit access, 38 browser-local PDF tools, 14 hybrid Video Studio tools, upcoming Audio Studio, and 60-minute auto-delete privacy."
author: "MUXARO Team"
publishedAt: "2026-11-18"
updatedAt: "2026-11-26"
category: "Platform & Support"
keywords: ["Muxaro faq", "zero credits", "local ffmpeg wasm", "browser pdf tools", "zero reupload chaining", "105 formats"]
---

# Frequently Asked Questions (FAQ)

Clear engineering answers on local browser execution, Video Studio, PDF Studio, Audio roadmap, and privacy.

---

## 1. Pricing, Credits & Access

### Are there any daily credits, paywalls, or ads?
No. Daily credits and rewarded-ad mechanics have been **completely removed**. MUXARO runs with zero display ads, zero watermarks, and zero account walls.

### Which tools run 100% locally with zero server upload?
- **All 38 PDF Studio tools** (merge, split, 3-tier QPDF compression, edit, fillable AcroForms, sign, Tesseract OCR, Compare, PKCS#7 signature verification, AES-256 protect, and sanitize) execute 100% inside your browser tab with **0 bytes uploaded**.
- **Tier-1 Video & Audio tools**—including **Metadata Scrubber**, **Video Frame Grabber**, **Subtitle Timing Shifter**, **Lossless Stream-Copy Trimmer**, **Container Remux (`MKV → MP4`)**, and **Stream-Copy Audio Extraction**—process files up to **350 MB** directly in your browser using WebAssembly, HTML5 Canvas, or Pure JS.

---

## 2. File Limits, Cloud Workers & Privacy

### What is the file size limit?
Browser-local PDF tools depend only on your device memory and run without server caps. Tier-1 local FFmpeg WASM tools handle files up to **350 MB** locally, while Cloud FFmpeg worker tasks and URL/file uploads support up to **2 GB**.

### How long are Cloud worker files kept?
Files processed by Cloud FFmpeg workers or URL downloads remain in isolated temporary scratch storage only long enough for you to download or chain them into another tool, and are **automatically deleted within 60 minutes**.

### How does zero-reupload tool chaining work?
After any local WASM or Cloud job finishes, click any suggested next tool directly below the download button (for example: **Trim Clip → Compress under 10 MB → Scrub Metadata**, or **Compress PDF → Sign → Protect AES-256**). MUXARO passes the artifact directly in browser memory or on the worker with zero re-uploading.

---

## 3. Suites & Future Audio Tools

### How many formats and codecs are supported?
The [Media Converter](/tools/media-converter) supports **105+ video, audio, and image formats** including MP4 (H.264/HEVC/AV1), MKV, WebM, MOV, AVI, GIF, Animated WebP, MP3, FLAC, WAV, AAC, M4A, and Opus, alongside stream downloads up to **8K** and full **38-tool PDF** support.

### What is coming in the Audio Studio suite?
The upcoming [Audio Studio](/docs/audio-studio) expands our existing audio tools (**Extract Audio & Stems**, **EBU R128 Loudness Normalizer**, and **A/V Sync Merger**) with local stem separation, voice de-noise/de-reverb, interactive waveform silence trimming, and podcast mastering.
