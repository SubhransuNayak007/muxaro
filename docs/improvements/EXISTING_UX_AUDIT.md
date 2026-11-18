# MUXARO Existing Product & UX Audit (Phase 1 Baseline)
**Product:** MUXARO — *Your Media. One Powerful Workspace.*  
**Author:** AGENT 01 — Principal Architect & System Designer  
**Audit Method:** Source-line inspection across `apps/web/` and `apps/api/`  
**Date:** 18 November 2026  
**Scope:** End-to-end customer journey from homepage ingress through processing, download delivery, usage limits, and mobile navigation.

---

## 1. Executive Summary

MUXARO v2.0 successfully transitioned away from its legacy dark engineering terminal into a clean light-first workspace backed by real `yt-dlp`, `ffmpeg`, and `ffprobe` execution. However, a deep line-by-line audit of the live codebase exposes **high-impact UX, honesty, reliability, and performance gaps** that separate a working prototype from a zero-clutter, low-end-device-ready consumer product:

1. **Production Demo & Mock Contamination:** Visible sample buttons (`Ultra HD Demo`, `4K Nature Clip`, `Audio Sample`) and pre-filled `storage.googleapis.com/test-media/*` URLs exist on the live homepage and all 7 tool subpages, alongside fabricated fallback ledger rows (`tx_99120`), fabricated `10/10` offline quota defaults, and hardcoded operational metrics (`99.98%`, `14,820`).
2. **Retention Policy Mismatch:** The backend (`apps/api/src/services/queue.service.ts:34`) deletes artifacts after **60 minutes** (`ARTIFACT_TTL_MS = 60 * 60 * 1000`), while `dashboard/page.tsx:726, 872, 908` tells customers files are stored for **24 hours**.
3. **Manifest Normalisation & Resolution Duplication Risk:** Backend format grouping ignores frame-rate buckets (`30fps` vs `60fps`) and HDR while lacking `estimatedSizeBytes`, `sizeIsEstimate`, and `recommended` metadata; frontend preset construction can overlap or hide real options without letting power users inspect true details.
4. **Bandwidth & Resumability Gaps:** Uploads lack chunked resumability, live `0–100%` progress, and cancellation (`AbortController`); downloads lack `ETag`, `Last-Modified`, and `If-Range` conditional resume validation; completion auto-downloads unconditionally and auto-mounts `<video>` preview even on metered/Save-Data connections.
5. **Single-Queue Contention:** Heavy 4K/8K transcodes share the same execution lane as fast stream-copy remuxes and audio extractions.

---

## 2. Surface-by-Surface Audit Findings

### 2.1 Homepage & First Screen (`apps/web/app/page.tsx`)
- **Lines 49–62 & 360–372:** Hardcoded `SAMPLE_ITEMS` (`Ultra HD Demo`, `4K Nature Clip`, `Audio Sample`) render visible `"Try a sample:"` buttons pointing to non-existent `https://storage.googleapis.com/test-media/*` URLs. Clicking them triggers real failing network probes on production.
- **Background Queue Continuity:** When a customer starts a job and closes or refreshes the homepage tab, `page.tsx` starts with `activeJob = null` and provides no automatic restoration banner from `api.getHistory()`.
- **Visual Budget:** Hero uses a static `.muxaro-hero-surface` wash with no lightweight-mode / `Save-Data` awareness.
- **Required Fix (P0/P1/P2):** Remove all sample chips/URLs completely; streamline first screen to `Paste or upload → Analyse → Choose → Download`; restore active/recent server jobs on load; wrap hero in CSS-only `.muxaro-aurora-shell` with automatic pause when hidden or in Lightweight Mode.

### 2.2 URL Input (`apps/web/app/page.tsx:333–383`)
- Clipboard paste helper (`handleClipboardPaste`) works cleanly and focuses the input on fallback.
- Error box (`lines 463–471`) displays raw error strings without an inline **Retry** action button.
- **Required Fix (P0):** Display human-friendly error explanations paired with a direct **Retry** button and zero fabricated fallback state.

### 2.3 Local Computer File Upload (`apps/web/lib/api-client.ts:381–409`, `apps/api/src/routes/media.ts`)
- Currently uses single-request `fetch('/api/v1/media/upload', { body: file })`.
- **UX Defects:**
  - Browser `fetch()` cannot report upload byte progress (`0–100%`), leaving users with an indeterminate spinner during large (100 MB–2 GB) uploads.
  - No `AbortController` **Cancel upload** control.
  - A transient cellular drop at 80% forces a complete restart from byte 0.
- **Required Fix (P1):** Add resumable multipart upload session endpoints (`POST /media/upload/init`, `PUT /media/upload/:uploadId/part/:partNumber`, `POST /media/upload/:uploadId/complete`, `DELETE /media/upload/:uploadId`) with streamed disk concatenation and a client-side `0–100%` progress bar + Cancel button.

### 2.4 Media Inspection & Resolution Duplication Root Cause
- **Backend (`apps/api/src/services/adapter.service.ts:237–254`):**
  - Groups video formats strictly by `normalizeHeightBucket(fmt.height)` (`Map<number, YtDlpFormat>`).
  - **Root Causes of Poor/Duplicate Resolution Presentation:**
    1. Does not key by `(height, fpsBucket, hdr)` — cannot distinguish a genuine `1080p 60fps` master from `1080p 30fps`, or HDR from SDR.
    2. Does not expose `fps`, `hdr`, `estimatedSizeBytes`, `sizeIsEstimate`, `recommended`, or audio `isNativeLossless` cleanly on normalized stream entries.
    3. On frontend (`apps/web/components/MediaInspector.tsx:63–158`), `buildVideoChoices()` maps `streams[0]` to `'Best quality'` (e.g. `1080p`) while lines `138–155` synthesize extra `'Full HD (1080p)'` / `'HD (720p)'` options independently of actual stream capabilities, and `COMPRESS_PRESETS` (`lines 39–61`) always renders static `1080p`/`720p`/`480p` choices even when the source video is only `360p` or `480p` (offering misleading upscaling options!).
    4. No collapsible `"Advanced"` disclosure exists for power users who want codec/bitrate/container verification.
- **Required Fix (P0):** Deduplicate strictly by `(height, fpsBucket, hdr)` in `adapter.service.ts`, emit accurate `estimatedSizeBytes` / `sizeIsEstimate` / `recommended` / `isNativeLossless`, never invent higher resolutions than the source, and render clean deduplicated consumer choices with a collapsed `"Advanced"` drawer in `MediaInspector.tsx`.

### 2.5 Audio Extraction (`apps/web/app/tools/audio-extractor/page.tsx`)
- **Line 62:** Initializes the URL input with hardcoded fake URL `'https://storage.googleapis.com/test-media/orchestra-audio.opus'`.
- **Line 293:** Claims 24-hour file retention instead of actual 60-minute TTL.
- **Good Practice Preserved:** Line 223 already includes an honest audio fidelity callout against lossy upsampling — must be preserved across all audio views.

### 2.6 Video & Audio Merging (`apps/web/app/tools/audio-video-merger/page.tsx`, `video-merger/page.tsx`)
- Both pages initialize inputs with hardcoded `https://storage.googleapis.com/test-media/*` URLs (`audio-video-merger/page.tsx:28–31`, `video-merger/page.tsx:29–30`).
- **Required Fix (P0):** Empty initial values with clear placeholders, honest validation, and real error + Retry handling.

### 2.7 Playlist & Batch Processing (`apps/web/app/tools/playlist-processing/page.tsx`, `playlist-batch/page.tsx`, `batch-processing/page.tsx`)
- `playlist-processing/page.tsx:32–41, 179–184` displays a hardcoded `SAMPLE_ITEMS` fake playlist preview and submits fake counts without inspecting the user's real playlist.
- `batch-processing/page.tsx:38–44` and `playlist-batch/page.tsx:42–61` pre-populate fake `storage.googleapis.com/test-media/*` rows.
- **Required Fix (P0/P1):** Remove all hardcoded sample rows; show genuine per-item completion status; prefer a single verified **Download all as ZIP** option alongside manual per-item download buttons (never trigger multiple simultaneous automatic browser downloads).

### 2.8 Processing Status (`apps/web/components/JobProgress.tsx`)
- Polling logic (`lines 103–150`) uses resilient exponential backoff (good).
- **Defects:**
  - When `progress === 0` or `status === 'QUEUED'`, displays `0%` instead of a calm indeterminate state.
  - On failure, lacks a **`Try again`** button wired to `POST /api/v1/jobs/:id/retry` and can surface raw backend error strings instead of friendly `userMessage`.
  - Does not pause polling when `document.visibilityState === 'hidden'`.
- **Required Fix (P0/P1):** Indeterminate calm indicator until real progress > 0, human-friendly error mapping + working `Try again` button, visibility-aware polling.

### 2.9 Completion Screen (`apps/web/components/JobProgress.tsx`)
- **Unconditional Auto-Download:** Auto-triggers browser download on `READY` without user consent — can surprise users on mobile data or be blocked by popup blockers. Must become an **opt-in toggle ("Automatically download when ready", Default: OFF)** persisted in `localStorage` (`'muxaro-auto-download'`).
- **Unconditional Media Preview Mount:** Renders `<video controls preload="metadata">` immediately upon completion, initiating extra HTTP Range requests even on `Save-Data` / slow cellular connections. Must become an opt-in **"Preview video" / "Preview audio"** toggle button.
- **Honest Fidelity Badge:** Must ONLY show `"Original quality preserved"` when backend confirms `job.losslessPreserved === true` (Instant/Smart copy), never for transcoded files.
- **Retention & File Details:** Must display actual `job.retentionMinutes ?? 60` minutes and tuck technical metadata (SHA-256 checksum, processing lane, job ID) inside a collapsed **"File details"** disclosure.

### 2.10 Credits & Usage Limits (`apps/web/app/credits/page.tsx`, `apps/web/lib/api-client.ts:525–570`)
- `credits/page.tsx:42–70, 302–305` populates fabricated `getFallbackLedger()` entries (`tx_99120`, `tx_99119`, `tx_99118`) whenever the ledger is empty or API fails!
- `api-client.ts:546–554` silently returns fabricated `10/10` quota numbers on API failure.
- **Required Fix (P0):** Zero fake fallbacks. Render clean loading skeleton, genuine empty state (`"No activity yet in this rolling window."`), and clear error + **Retry** panel if API fails. Rename to **Usage & Daily Limits**.

### 2.11 My Downloads / Dashboard (`apps/web/app/dashboard/page.tsx`)
- **Retention Inaccuracy:** Hardcodes `24` hours in `RetentionIndicator` (`lines 72–94`) and UI copy (`lines 726, 872, 908`) whereas backend deletes files after **60 minutes**.
- **Card Clutter:** Exposes `Verified SHA-256` banner on every completed card by default instead of an optional disclosure.
- **Missing Recovery & Live Sync:** No 3-second auto-refresh while jobs are active (paused when hidden), and no **Retry** button on failed jobs.
- **Required Fix (P0/P1):** Retitle to **My Downloads**, show accurate `retentionMinutes` (60 min), auto-refresh active jobs with visibility pause, add **Retry** on failed jobs, tuck SHA-256 into optional disclosure, and show honest loading/empty/error states.

### 2.12 Navigation & Mobile Nav (`apps/web/components/Navbar.tsx`, `Footer.tsx`, `layout.tsx`)
- Primary nav shows `Tools`, `How it works`, `Formats`, `Docs` instead of focused consumer destinations (**Home**, **Tools**, **My Downloads**, **Usage**).
- `Navbar.tsx:15–18` initializes `quota` to hardcoded `{ remaining: 10, limit: 10 }`, displaying fake availability before the API responds or during an outage.
- No **Lightweight mode** toggle exists for low-end devices or slow networks.
- **Required Fix (P0/P1):** Move `Docs`/`Formats`/`Status`/Legal links to `Footer.tsx`; keep primary nav strictly `Home`, `Tools`, `My Downloads`, `Usage`; start `quota = null` with no fake `10/10` fallback; add accessible Lightweight Mode toggle synced via pre-hydration script in `layout.tsx`.

### 2.13 Backend Queue & Processing Pipeline (`apps/api/src/services/queue.service.ts`)
- Lacks 6-class queue isolation (`instant-processing`, `audio-processing`, `merge-processing`, `video-transcoding`, `high-resolution-processing`, `playlist-packaging`) and explicit TurboFlow strategy selection (`instant` | `smart` | `power`).
- Does not expose `processingLane`, `strategyLabel`, `losslessPreserved`, `retentionMinutes`, or human-friendly `userMessage` on job/error payloads.
- **Required Fix (P0/P1):** Implement `turboflow.service.ts` + 6-class fair round-robin queues with independent concurrency caps, backpressure, bounded retries (max 3), and tab-disconnect persistence.

### 2.14 Download Delivery (`apps/api/src/routes/download.ts`)
- Lines 108–168 stream files cleanly via `fs.createReadStream` with `Accept-Ranges: bytes` and `206`/`416` handling.
- **Missing Production Resume Safeguards:**
  - Does NOT emit `ETag` or `Last-Modified` headers (`line 113` sets `no-cache, no-store` with no validator).
  - Does NOT evaluate `If-Range` conditional headers (a mismatched `If-Range` must gracefully return `200` full stream rather than `206` partial bytes from a different file version).
  - `416` error message (`line 157`) says `"Requested byte range is out of bounds"` instead of customer-friendly `"This download could not be resumed. Start a new download."`.
- **Required Fix (P1):** Add strong `ETag`, `Last-Modified`, `If-Range` validation, and human-friendly `416` messaging.

---
*Audit grounded directly in workspace source lines prior to TurboFlow + Zero-Clutter UX rollout.*
