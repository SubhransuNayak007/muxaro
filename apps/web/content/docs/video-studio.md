---
title: "Video Studio Guide: 14 Hybrid FFmpeg Tools & Tool Chaining"
slug: "video-studio"
description: "Complete guide to MUXARO's 14 Video Studio tools, Tier-1 browser-local WASM execution, Cloud FFmpeg 8 targets, and zero-reupload chaining."
author: "MUXARO Media Engineering Team"
publishedAt: "2026-11-26"
updatedAt: "2026-11-26"
category: "Suite Guides"
keywords: ["video studio", "ffmpeg wasm", "10mb discord compressor", "lossless video trimmer", "9:16 smart pad", "zero reupload chaining"]
---

# Video Studio Guide: 14 Hybrid FFmpeg Tools & Tool Chaining

MUXARO's **Video Studio** consolidates 14 specialized video and audio utilities into a unified hybrid engine. Every tool runs with **zero credits**, **zero watermarks**, and **zero display ads**, pairing instant in-browser WebAssembly execution with multi-core Cloud FFmpeg 8 workers for heavy tasks.

---

## 1. Execution Model: Browser Local vs. Cloud FFmpeg 8

| Execution Path | Trigger Condition | Upload Behavior | Retention |
| :--- | :--- | :--- | :--- |
| **Tier-1 Browser Local** | Local files `<= 350 MB` on supported tools | **0 bytes uploaded** (WORKERFS / Canvas / Pure JS) | Stays strictly in your browser memory |
| **Tier-2 Cloud FFmpeg 8** | Remote URLs, files `> 350 MB`, or 2-pass encodes | Chunked resumable transfer to isolated scratch disk | Automatically purged within **60 minutes** |

> [!TIP]
> You can drop any `.mp4`, `.mkv`, `.mov`, `.webm`, or audio file anywhere on the screen (`Cmd/Ctrl + K`) to route straight into the right tool without hunting through menus.

---

## 2. Complete 14-Tool Directory

### Core Conversion & Merging
1. **[Convert Video & Audio](/tools/media-converter):** Transcode across **105+ formats** or trigger 1-second `-c copy` MKV-to-MP4 container remuxing, WhatsApp MP4 presets, and Premiere/DaVinci editing presets.
2. **[Merge Video & Audio](/tools/audio-video-merger):** Combine separate video and audio tracks with `-5000 ms` to `+5000 ms` sync offset nudges, 10-second live aligned preview, and optional `-14 LUFS` normalization.
3. **[Join Video Clips](/tools/video-merger):** Concatenate two or more video clips with automatic resolution and frame-rate conformance.

### Compress & Trim
4. **[Target-Size Video Compressor](/tools/video-compressor):** Hit exact **10 MB (Discord)**, **16 MB (WhatsApp)**, **25 MB (Slack/Email)**, or custom MB budgets via true 2-pass `libx264` + AAC bitrate calculation. Automatically adapts to MP3 bitrate targets if you drop an audio-only file.
5. **[Instant Lossless Trimmer & 60s Splitter](/tools/video-trimmer):** Cut exact ranges in ~1 second using Tier-1 browser `-c copy` stream copy, run frame-accurate re-encodes, or split long videos into 15s / 30s / 60s / 90s Reels/Shorts ZIP parts.

### Creator & Audio
6. **[Extract Audio & Stems](/tools/audio-extractor):** Save lossless FLAC/WAV, 320 kbps MP3, or 256 kbps AAC with start/end trims, fade-in/out curves, mono/stereo switching, and ID3 tags.
7. **[Audio Loudness Normalizer](/tools/audio-normalizer):** Apply 2-pass EBU R128 `loudnorm` targeting **-14 LUFS** (YouTube/Spotify), **-16 LUFS** (Podcasts), or **-23 LUFS** (Broadcast) while keeping video frames untouched (`-c:v copy`).
8. **[Aspect Ratio & 9:16 Smart Pad](/tools/aspect-ratio-pad):** Reframe landscape 16:9 clips into vertical **9:16**, **1:1**, or **4:5** outputs using blurred ambient backdrops, center crop, or letterbox padding.
9. **[Subtitle Burner & Timing Shifter](/tools/subtitle-burner):** Shift `.srt` / `.vtt` cue timestamps (`+/- ms`) instantaneously in Pure JS with zero upload, or burn styled hardcoded captions onto MP4 video.
10. **[Video to GIF & Animated WebP](/tools/video-to-gif):** Generate crisp 2-pass `palettegen`/`paletteuse` GIFs or compact Animated WebP loops with FPS and width controls.

### Inspect & Batch
11. **[Metadata Inspector & Privacy Scrubber](/tools/metadata-scrubber):** Inspect codecs, HDR profiles, and camera/GPS EXIF tags, then scrub private metadata locally via `-map_metadata -1 -fflags +bitexact -c copy`.
12. **[Frame Grabber & Thumbnail Checker](/tools/thumbnail-extractor):** Capture lossless PNG/JPG frames from local videos in 0 ms via HTML5 Canvas, or extract HD covers and preview them in Dark/Light YouTube feed layouts.
13. **[Transcript & Subtitle Extractor](/tools/transcript-extractor):** Pull deduplicated captions in `.srt`, `.vtt`, `.md`, or Clean AI/Notion paragraphs with live keyword search.
14. **[Batch & Playlist ZIP Hub](/tools/playlist-batch):** Queue multi-URL batches or inspect public playlists up to 50 items with custom filename templates (`{index}_{title}_{res}`) and single-ZIP delivery.

---

## 3. Zero-Reupload Tool Chaining

After any local WASM or Cloud FFmpeg operation completes, a **Continue in another tool** bar appears directly beneath the download button. You can pass the output artifact immediately into **Trim**, **Compress (10/16 MB)**, **Convert**, **Extract Audio**, **Normalize Loudness**, **Merge A/V**, **Reframe 9:16**, or **Scrub Metadata** with zero re-uploading.

---

*Related guides: [PDF Studio Guide](/docs/pdf-studio) · [Audio Studio Roadmap](/docs/audio-studio) · [Containers vs. Codecs](/docs/formats)*
