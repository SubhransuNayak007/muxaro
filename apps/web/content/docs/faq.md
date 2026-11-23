---
title: "Frequently Asked Questions (FAQ) & Platform Policy"
slug: "faq"
description: "Everything you need to know about MUXARO's rolling 24-hour allowances, copyright and ethical policy, processing speeds, and zero-retention ephemeral privacy guarantees."
author: "MUXARO Operations Team"
publishedAt: "2026-11-18"
updatedAt: "2026-11-18"
category: "Platform & Support"
keywords: ["Muxaro faq", "daily allowance quota", "rolling 24 hour reset", "copyright policy", "ffmpeg processing speed", "ephemeral storage"]
---

# Frequently Asked Questions (FAQ)

Find clear, honest answers regarding MUXARO's daily job allowances, ethical media processing policies, computational speeds, and privacy protections.

---

## 1. Daily Allowances & Quota Mechanics

### What is the free tier allowance on MUXARO?
Every user on MUXARO is granted:
- **10 Individual Video Processing Jobs** per rolling 24-hour window.
- **1 Batch / Playlist Job** (supporting up to 50 items) per rolling 24-hour window.

### How does the rolling 24-hour window work?
Unlike platforms that reset counters at an arbitrary midnight timezone (which penalizes international users), MUXARO calculates quota **dynamically on a rolling 24-hour basis**:
- When you execute a job at 2:15 PM on Tuesday, that individual credit restores automatically at **2:15 PM on Wednesday**.
- You can monitor your remaining credits and exact countdown timers in real time on our [Credits Dashboard](/credits).

```
Rolling 24-Hour Quota Timeline Example:
Job 1 executed (10:00 AM) ────────► Restores at 10:00 AM Next Day
Job 2 executed (11:30 AM) ────────► Restores at 11:30 AM Next Day
Job 3 executed (04:00 PM) ────────► Restores at 04:00 PM Next Day
```

### Does running a playlist job deplete my individual video jobs?
**No. Quotas are strictly segregated.**  
Your playlist quota (1 playlist of up to 50 videos) runs on an independent ledger. Processing a playlist will never consume or block your 10 individual video processing credits.

### What happens if a processing job fails?
**You are never charged or penalized for failed jobs.**  
MUXARO employs **atomic quota reservations**. When you submit a job, a credit is held in a provisional state. If the upstream network fails, a container is corrupted, or the job is cancelled before completion, our transactional engine **automatically rolls back the reservation**, restoring your credit immediately.

---

## 2. Copyright, Ethical Policy & Terms

### Can I download any video from YouTube or streaming services?
**MUXARO is an ethical media utility and does not support unauthorized commercial ripping or copyright infringement.**  
Our platform is engineered for:
1. Content creators inspecting and extracting their own uploaded media masters.
2. Journalists, educators, and researchers analyzing public interest broadcasts.
3. Processing Creative Commons, open-access, and public domain audiovisual works.
4. Offline personal media transcoding and format migration.

We **strictly prohibit**:
- Bypassing Digital Rights Management (DRM) technologies (such as Widevine, FairPlay, or PlayReady).
- Evading CAPTCHAs or circumventing platform security firewalls using rotating residential proxies.
- Scraping or distributing copyrighted commercial motion pictures, premium subscription content, or recorded music without rightsholder authorization.

### How do rightsholders request content removal?
We maintain a strict and responsive copyright compliance process. Rightsholders can submit formal DMCA notifications directly to our legal team via our [DMCA Takedown Procedure](/legal/dmca). Legitimate takedown notices are processed within statutory timelines.

---

## 3. Platform Architecture & Operating Modes

MUXARO operates with three transparent, honest modes designed to respect network boundaries and platform policies:

### 1. Cloud Mode (Mobile & Web)
- **Specification:** Up to 2K lossless stream copy for open & supported hosts.
- **How it works:** Shared cloud edge workers demux and remux audio/video streams at line speed. Perfect for smartphones, tablets, and lightweight web sessions on platforms that do not restrict datacenter IPs.
- **Capabilities:** Up to 1440p (2K), instant packaging, zero local CPU load.

### 2. Direct Mode (Desktop)
- **Specification:** Up to 8K via local browser bridge using your own residential connection.
- **How it works:** Uses a lightweight desktop userscript or Chrome extension to orchestrate bitstream downloads directly through your home internet connection. Because requests originate from your residential IP rather than shared datacenter servers, upstream bot-blocking (from hosts like YouTube or Instagram) is completely bypassed.
- **Capabilities:** Full 4K and 8K 60fps bitstream copy with Origin Private File System (OPFS) disk streaming.

### 3. Studio Tools
- **Specification:** 100% private in-browser conversion, audio extraction, and audio/video merging.
- **How it works:** Powered by client-side WebAssembly FFmpeg. When you convert a container or extract audio stems, processing happens 100% locally in your browser memory/OPFS. No files are ever uploaded to cloud servers.

### 4. Custom Worker URL (Cobalt Architecture)
- **What is BYO-Worker?** Following the Cobalt self-hosted model, users can connect their own Docker media-worker instance (running on `localhost:5001`, an Oracle Cloud Always Free instance, or a VPS).
- **Configuration:** Go to [Settings > Custom Worker](/settings?tab=instances) and enter your worker URL. It is saved directly in your browser's `localStorage` (`muxaro_custom_worker_url`).

---

## 4. Processing Speeds & Engine Mechanics

### What do the consumer processing presets (Best Quality, Balanced, Audio-Only, Lossless) do?
MUXARO provides four streamlined, one-click processing presets with an optional Advanced Settings drawer:
1. **Best Quality:** Selects the highest available source video resolution (up to 8K) and best available audio stream, performing synchronized stream multiplexing with zero loss.
2. **Balanced:** Optimizes for web sharing, email, and social delivery by selecting 1080p Full HD with high-efficiency codecs (AV1 or VP9) for an ideal balance of compact file size and sharp visual fidelity.
3. **Audio-Only:** Extracts the soundtrack directly from the container as an uncompressed bitstream (Opus or AAC) or high-compatibility MP3 for portable listening.
4. **Lossless (Stream Copy):** Bypasses the transcoding engine completely (`-c copy`), delivering bit-for-bit mathematical clones of the source streams in seconds with zero generational degradation.

### Why do some operations finish in 3 seconds while others take 2 minutes?
Processing speed is determined by whether your job requires **Stream-Copying (Remuxing)** or **Full Transcoding (Re-encoding)**:

| Operation | Mode | Typical Speed | Explanation |
| :--- | :--- | :--- | :--- |
| **Audio Extraction (AAC/Opus)** | Stream Copy | **2 – 5 seconds** | Raw bitstream packets are demuxed from the container with zero decoding. Bound only by disk I/O. |
| **Audio-Video Merging (DASH)** | Stream Copy | **3 – 8 seconds** | Disjoint video and audio streams are interleaved into an MP4/MKV container without re-encoding frames. |
| **Resolution Downscaling (4K to 720p)** | Full Transcode | **30 – 120 seconds** | Every frame is decoded, downscaled, and re-compressed using CPU/GPU rendering pipelines. |
| **Audio Transcoding (Opus to MP3)** | Transcode | **5 – 15 seconds** | Audio is decoded to raw PCM and re-encoded using the MP3 psychoacoustic filterbank. |

Whenever possible, MUXARO defaults to **Stream-Copy** to deliver instantaneous results with zero loss in visual or acoustic fidelity.

---

## 4. Privacy & Ephemeral Data Storage

### How long are my files stored on Muxaro servers?
**All processing storage is strictly ephemeral.**
- While your job is running, temporary media chunks are held in an isolated, sandboxed scratch disk volume.
- Once processing concludes, the output file is transferred to an isolated object storage bucket and issued a cryptographically signed, short-lived download token (valid for 60 minutes).
- Once downloaded or upon token expiration, files are **permanently and irreversibly shredded from disk**.

### Do you analyze files, serve ads, or train AI models on user content?
**Never.**
- We do not sell user data or share media files with third parties.
- We do not analyze, fingerprint, or train machine learning models on your uploaded files.
- We do not run third-party tracking scripts, deceptive pop-unders, or intrusive advertising networks.

---

## 5. Technical Capabilities & File Limits

### What is the maximum resolution supported?
MUXARO supports up to **8K Full Ultra HD ($7680 \times 4320$)** at 60 frames per second, provided the source stream provides genuine 8K bitstream packets (typically AV1 or VP9).

### What container formats can I export?
You can export to:
- **Video Containers:** MP4 (ISO Base Media), WebM (EBML open web format), and MKV (Matroska universal multimedia).
- **Audio Formats:** Native bitstream copy (`.m4a`, `.opus`), MP3 (up to 320 kbps), AAC, and FLAC (lossless).

### What is the maximum duration supported?
Individual processing jobs are limited to source files of up to **3 hours in duration** and a worker execution timeout of **300 seconds** to ensure fair resource availability across all concurrent users.

---

*Still have questions? Explore our [Troubleshooting Guide](/docs/troubleshooting) or review our [Terms of Service](/legal/terms).*
