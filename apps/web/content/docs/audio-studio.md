---
title: "Audio Studio Architecture & Upcoming Suite Roadmap"
slug: "audio-studio"
description: "Current audio tools available in MUXARO today and the engineering roadmap for the upcoming dedicated Audio Studio suite."
author: "MUXARO Audio Engineering Division"
publishedAt: "2026-11-26"
updatedAt: "2026-11-26"
category: "Audio Engineering"
keywords: ["audio studio", "stem separation", "ebu r128 loudness", "voice denoise", "waveform trimmer", "audio extractor"]
---

# Audio Studio Architecture & Upcoming Suite Roadmap

MUXARO is expanding into a dedicated **Audio Studio** suite designed with the same zero-ad, zero-credit, browser-first engineering principles as our Video and PDF Studios.

---

## 1. Audio Tools Available Today

You can already run core audio extraction, conversion, loudness mastering, and sync workflows across MUXARO:

| Tool | Execution | Primary Capabilities |
| :--- | :--- | :--- |
| **[Extract Audio & Stems](/tools/audio-extractor)** | Hybrid (WASM + Cloud) | Lossless `-c:a copy` extraction, 16/24-bit FLAC & WAV, 320 kbps MP3, AAC, start/end trim, fade-in/out, ID3 tags |
| **[Audio Loudness Normalizer](/tools/audio-normalizer)** | Cloud FFmpeg 8 | 2-pass EBU R128 linear `loudnorm` for `-14 LUFS` (YouTube), `-16 LUFS` (Podcasts), and `-23 LUFS` (Broadcast) |
| **[Media Converter](/tools/media-converter)** | Hybrid (WASM + Cloud) | Transcode across MP3, FLAC, WAV, M4A, AAC, Opus, and OGG |
| **[Merge Video & Audio](/tools/audio-video-merger)** | Hybrid (WASM + Cloud) | Multiplex separate video/audio tracks with `-5000 ms` to `+5000 ms` offset alignment |
| **[Metadata Scrubber](/tools/metadata-scrubber)** | Hybrid (Local WASM) | Inspect sample rates, channels, and codecs; strip ID3/metadata tags locally |

---

## 2. Upcoming Dedicated Audio Studio Modules

The dedicated Audio Studio expansion introduces four browser-native DSP modules:

1. **Source Stem Separator:** Isolate vocals, drums, bass, and instrumental tracks directly in-browser using quantized WASM / WebGPU audio models with zero cloud upload.
2. **Voice De-Noise & De-Reverb:** Suppress room echo, HVAC fan hum, and mouth clicks on spoken-word interviews and voiceovers without metallic spectral artifacts.
3. **Interactive Waveform Silence Trimmer:** Replace static previews with real `AudioContext.decodeAudioData()` peak waveforms to trim dead air automatically, shape fade curves, and export podcast chapters.
4. **Podcast Master & ID3 Batcher:** Chain multi-band voice compression, EBU R128 loudness targeting (`-16 LUFS`), and batch cover-art / chapter tag embedding in one pass.

> [!NOTE]
> Just like our Video and PDF Studios, every Audio Studio workflow will adhere strictly to MUXARO's [Audio Quality Policy](/docs/audio-quality): honest bitrate reporting, lossless stream copying whenever possible, and zero fake upsampling.

---

*Related guides: [Audio Quality Mythbusting](/docs/audio-quality) · [Video Studio Guide](/docs/video-studio)*
