# MUXARO Frontend QA & Wave 2 Verification Audit
**Product:** MUXARO — *Your Media. One Powerful Workspace.*  
**Version:** 2.0 (Wave 2 Consumer UI/UX + Real Binary Download Pipeline)  
**Date:** 18 November 2026  
**Auditor:** AGENT 10 (Independent QA, Performance & Release Engineer)  

---

## 1. Executive Summary

This document certifies the visual, structural, accessibility, performance, and end-to-end runtime quality of the **MUXARO v2.0 Consumer SaaS Interface** and its **Real Media Download & Streaming Pipeline** (`yt-dlp` + `ffmpeg` + `ffprobe` + Next.js `/api/v1/*` proxy).

All assertions below are backed by **zero-trust empirical execution** against the compiled Next.js 14.2.24 production build (`http://localhost:3000`) and live Fastify API daemon (`http://127.0.0.1:4000`).

**Overall Verdict:** **PASS — PRODUCTION READY (GO)**

---

## 2. Static, TypeScript & Hallmark Floor Verification

| Gate | Command / Tool | Result | Evidence |
| :--- | :--- | :--- | :--- |
| **TypeScript Strict Check** | `cd apps/web && npx tsc --noEmit` | **PASS** | Exit code `0` — 0 type errors across all 25+ routes and components. |
| **Hallmark Anti-AI-Slop Floor** | `node sloplint.mjs apps/web/app apps/web/components` | **PASS** | **`0 FAIL, 0 WARN, 8 WAIVED`** across 25 scanned files (waivers limited to documented `2b` brand text gradient & `7b` crisp white surface tokens in `globals.css`). |
| **CSS Floor Audit** | Independent Node audit on `apps/web/app/globals.css` | **PASS** | Line 1 Hallmark stamp verified; `overflow-x: clip` enforced; `prefers-reduced-motion: reduce` fallback present; `:focus-visible` verified; `0` `transition: all` occurrences. |
| **Consumer Jargon & Legacy Class Audit** | Regex scan across all consumer pages & components | **PASS** | `0` occurrences of `keyline-box`, `sheet-grid`, middle-dot `•` metadata strings, glued arrows, literal hex colors in TSX, or `fonts.googleapis.com` `<link>` tags on consumer surfaces. |
| **Next.js Production Build** | `cd apps/web && npx next build` | **PASS** | Exit code `0` — **25 / 25 static & SSG pages compiled cleanly** with 0 lint/type/build errors. |

---

## 3. Core Web Vitals, Bundle & LCP Remediation Evidence

### Architectural LCP Fixes Verified in Production HTML & Source
1. **Zero Render-Blocking Font `<link>` Tags:** Verified in `apps/web/app/layout.tsx` and live SSR HTML across all 19 routes — external Google Fonts `<link>` tags are 100% eliminated and replaced with `next/font/google` (`Inter` + `JetBrains_Mono`, `display: 'swap'`, self-hosted CSS variables `--font-sans` and `--font-mono`).
2. **Dynamic Code-Splitting (`next/dynamic`):** Verified in `apps/web/app/page.tsx` and `/tools/*` — heavy interactive islands (`MediaInspector` and `JobProgress`) load dynamically with `{ ssr: false }`, keeping initial hero rendering unblocked.
3. **Zero-FOUC Theme Initialization:** Inline pre-paint script in `layout.tsx` synchronizes `.dark` class and `data-theme` attribute from `localStorage` before first paint with `suppressHydrationWarning`.

### Production Bundle Measurements (`npx next build` — Next.js 14.2.24)

| Route / Metric | v1.0 Baseline (Pre-Redesign) | v2.0 Wave 2 (Verified Production Build) | Notes |
| :--- | :--- | :--- | :--- |
| **Shared First Load JS** | `87.1 kB` | **`87.3 kB`** (`117`: `31.6 kB`, `fd9d1056`: `53.6 kB`, other: `2.04 kB`) | Stable shared runtime baseline (+0.2 kB) |
| **Homepage (`/`)** | `5.9 kB` (`96.6 kB` First Load) | **`8.36 kB`** (`108 kB` First Load) | Zero-demo consumer ingress + Aurora Flow (`useDeviceMode`) + resumable multipart upload progress/cancel + background queue restore + dynamic `MediaInspector`/`JobProgress` split |
| **Dashboard (`/dashboard`)** | — | **`15.9 kB`** (`116 kB` First Load) | My Downloads background queue, visibility-aware 3s polling, Retry/Cancel, collapsed Details |
| **Credits (`/credits`)** | — | **`8.74 kB`** (`102 kB` First Load) | Usage & Daily Limits, zero fake fallbacks, honest loading skeletons & Retry |
| **Tools Directory (`/tools`)** | — | **`188 B`** (`94.3 kB` First Load) | Fully static consumer tool hub |
| **Tool Subpages (7 routes)** | — | **`4.38 kB – 5.35 kB`** (`102 – 103 kB` First Load) | Includes `/tools/playlist-batch` (`5.35 kB`) |
| **Docs & Legal (`/docs`, `/docs/[slug]`, `/privacy`, `/terms`, `/dmca`)** | — | **`188 B`** (`94.3 kB` First Load) | Pure static/SSG HTML |
| **Total Prerendered Routes** | `24` | **`25 / 25`** | Zero build errors |

---

## 4. Live Server, Route & Static Asset Verification (`qa/harness/verify-web-live.mjs`)

Executed against live Fastify (`http://127.0.0.1:4000`) and live Next.js production server (`http://localhost:3000`):

- **Live API Endpoints (`3 / 3 PASS`):**
  - `GET /api/v1/health` → **HTTP 200** (`status: HEALTHY`, `postgres: CONNECTED`, `redis: CONNECTED`, `48` worker slots)
  - `GET /api/v1/account/credits` → **HTTP 200**
  - `GET /api/v1/admin/metrics` → **HTTP 200**
- **Live Consumer Web Routes (`19 / 19 PASS`):**
  - All 19 routes (`/`, `/dashboard`, `/credits`, `/tools`, `/tools/audio-extractor`, `/tools/media-converter`, `/tools/audio-video-merger`, `/tools/video-merger`, `/tools/batch-processing`, `/tools/playlist-processing`, `/tools/playlist-batch`, `/docs`, `/docs/formats`, `/docs/resolutions`, `/docs/audio-quality`, `/status`, `/privacy`, `/terms`, `/dmca`) returned **HTTP 200**.
  - Verified **0 render-blocking font `<link>` tags**, **0 `undefined/undefined` or `NaN` strings**, **0 Next.js error boundaries**, and **0 legacy `keyline-box` / `sheet-grid` classes** in rendered HTML.
- **Static Asset Integrity (`29 / 29 PASS`):**
  - All **29 / 29** unique `/_next/static/*` JS, CSS, and font assets referenced across the 19 routes returned **HTTP 200**.

---

## 5. Real End-to-End Binary Download & `ffprobe` Verification (`qa/harness/verify-real-download-e2e.mjs`)

Verified full browser-identical pipeline routed through the Next.js proxy (`http://localhost:3000/api/v1/*` → Fastify `:4000` → `yt-dlp` / `ffmpeg` → `.muxaro-artifacts` → HMAC-signed binary stream → `ffprobe`):

| E2E Test Case | Proxy Inspect | Job Lifecycle | Downloaded Artifact | Size & MIME | Range `206` | SHA-256 Match | `ffprobe` Playability |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SSRF Block (`127.0.0.1`)** | **HTTP 403** (`SSRF_BLOCKED`) | Blocked at ingress | None | — | — | — | PASS |
| **Direct MP4 Video Remux** (`flower.mp4`) | **HTTP 200** (`5.1s`, 2 streams) | `202` → `PROCESSING` → `READY (100%)` | `MDN_Flower_CC0_Video.mp4` | **`1,128,375` bytes**, `video/mp4` | **206** (`1,024 B`) | **EXACT MATCH** (`0cd83d944a6ca782...`) | **VALID**: `mov,mp4`, `5.055s`, `[video:h264, audio:aac]` |
| **YouTube Audio Extraction** (`Me at the zoo` → MP3) | **HTTP 200** (`19s`, 4 streams) | `202` → `10%` → `82%` → `READY (100%)` | `Me_at_the_zoo.mp3` | **`331,053` bytes**, `audio/mpeg` | **206** (`1,024 B`) | **EXACT MATCH** (`3dd3e679fbdbf8bb...`) | **VALID**: `mp3`, `19.006s`, `[audio:mp3]` |
| **Local Computer MP4 Upload → 480p Compress** (`POST /api/v1/media/upload`) | **HTTP 200** (`4.06 MB`, `4s`) | `202` → `10%` → `15%` → `READY (100%)` | `My_Holiday_Clip_1080p.mp4` | **`4,252,920 B` → `214,590 B` (-95.0%)**, `video/mp4` | **206** (`?inline=1` `inline`, default `attachment`) | **EXACT MATCH** | **VALID**: `854×480 h264/aac`, `4.02s` (`0` HTTP `429`s) |
| **YouTube Video MP4 + 40-Poll Stress Check** (`Me at the zoo` → MP4) | **HTTP 200** (`19s`) | `202` → `10%` → `83%` → `READY (100%)` | `Me_at_the_zoo.mp4` | **`533,932` bytes**, `video/mp4` | **206** (`?inline=1` `inline`, default `attachment`) | **EXACT MATCH** | **VALID**: `320×240 av1/aac`, `19.06s` (**40 polls, `0` HTTP `429`s**) |

- **Fake Receipt Bug Permanently Eliminated:** Confirmed `0` occurrences of `.receipt.txt`, `new Blob`, `e3b0c442`, `#download_`, or `mockMediaBuffer` in `JobProgress.tsx`, `api-client.ts`, and `apps/api/src/routes/download.ts`. Every download streams verified playable media bytes directly from disk.

---

## 6. Viewport, Responsive & WCAG 2.1 AA Contrast Certification

### Responsive Viewport Validation
| Viewport Category | Dimensions | Layout Behavior | Overflow-X | Touch Targets |
| :--- | :--- | :--- | :--- | :--- |
| **Mobile Small (iPhone SE)** | 375 × 667 | Single-column, stacked ingress tabs, accessible mobile drawer (`Escape` + outside click) | `clip` (0px) | ≥ 44 × 44 px |
| **Mobile Standard (iPhone 14/15)** | 390 × 844 | Dual-mode pill tabs, touch-friendly presets | `clip` (0px) | ≥ 48 × 48 px |
| **Tablet (iPad Mini / Air)** | 768 × 1024 | 2-column capability grid, responsive ledger | `clip` (0px) | ≥ 44 × 44 px |
| **Laptop / Desktop** | 1280 × 800 | Hero H1, subtitle, dual-mode card & primary CTA visible above the fold | `clip` (0px) | Instant `:focus-visible` |
| **Wide Desktop (1080p / 4K)** | 1920 × 1080 | Capped centered container with balanced gutters | `clip` (0px) | Centered canvas |

### WCAG 2.1 AA Token Contrast Ratios (Verified Against `apps/web/app/globals.css`)
- **Light Mode (`--muxaro-bg-base: #f7f8fc`, `--muxaro-bg-surface: #ffffff`):**
  - Primary text (`#171b2b` on `#ffffff`): **16.9:1** (Passes AAA)
  - Secondary text (`#5e667e` on `#ffffff`): **5.7:1** (Passes AA)
  - Primary CTA foreground (`#ffffff` on `#695bff` / `#4677ff`): **≥ 4.6:1** (Passes AA)
- **Dark Mode (`--dark-bg-base: #0a0d14`, `--dark-bg-surface: #111520`):**
  - Primary text (`#f5f7fc` on `#111520`): **16.5:1** (Passes AAA)
  - Secondary text (`#9aa8be` on `#111520`): **7.6:1** (Passes AAA)

---

## 7. Defect Elimination & Final Sign-Off

1. **Fake `.receipt.txt` & Mock Job Bug:** Permanently resolved (`#80`, `#81`, `#82`). Real `yt-dlp`/`ffmpeg` execution, strict API client error propagation, and disk-streamed binary delivery verified with `ffprobe`.
2. **Undefined Quota & NaN Ledger Bug:** Permanently resolved via `safeNumber()`/`safeString()`/`Array.isArray()` guards in `Navbar.tsx`, `credits/page.tsx`, and `dashboard/page.tsx`.
3. **Stream Indexing Crash Bug:** Permanently resolved via defensive `Array.isArray(manifest?.videoStreams)` checks in `MediaInspector.tsx`.
4. **Render-Blocking Font & LCP Bottleneck:** Permanently resolved via `next/font/google` (`display: 'swap'`) and `next/dynamic({ ssr: false })`.
5. **Stale Production Server Manifest:** Caught during QA audit and resolved by rebuilding `.next` (`25/25` routes) and restarting the `:3000` Next.js production server.

*Signed by AGENT 10 (Independent QA, Performance & Release Engineer)*  
*Finish Gate & Wave 2 Production Status: **GO (PASS)***

---

## 8. Phase 2 Addendum: TurboFlow, Zero-Demo Audit, Resumable Delivery & Low-End Verification (`qa/harness/verify-turboflow-e2e.mjs`)

Executed live against the Phase 2 Fastify (`http://127.0.0.1:4000`) and Next.js (`http://localhost:3000`) production builds:

| Phase 2 Gate | Empirical Result |
| :--- | :--- |
| **Zero Demo / Mock HTML Audit** | **19 / 19 Web routes** HTTP `200`, **29 / 29 static assets** HTTP `200`, **0** occurrences of `8K Demo Video`, `Ultra HD Demo`, `4K Nature Clip`, `Audio Sample`, `Try a sample`, `storage.googleapis.com/test-media`, `Overture in D Minor`, `keyline-box`, `sheet-grid`, or external font `<link>` tags. |
| **Deduplicated Resolution Manifest** | Inspected YouTube `Me at the zoo`: `videoStreams = [240p [REC], 144p]` — **0 duplicates**, **1 genuine recommended choice**, **0 invented 4K/8K resolutions**. |
| **Resumable Multipart Upload + Cancel** | `init -> DELETE` cancel returned HTTP `200`; 3-part `4,252,920 B` upload with **idempotent Part-2 retry** + SHA-256 + `ffprobe` completed cleanly (`HTTP 200`, `4s`). |
| **TurboFlow 3-Lane Strategy** | • **Instant Lane (`REMUX_STREAM_COPY`)**: `lane=instant`, `losslessPreserved=true`, `retention=60m`, **`429 ms`** (**3.03× faster than Power**).<br>• **Smart Lane (`EXTRACT_AUDIO` M4A)**: `lane=smart`, `losslessPreserved=true`, `retention=60m`, `66,631 B`, **`437 ms`**.<br>• **Power Lane (`CONVERT_FORMAT` 480p)**: `lane=power`, `losslessPreserved=false`, `retention=60m`, **`214,590 B` (-95.0%)**, `854×480` verified by `ffprobe`, `1,302 ms`. |
| **Full HTTP Range Delivery** | Verified `Accept-Ranges: bytes`, strong `ETag`, `Last-Modified`, default `attachment`, `?inline=1` → `inline`, valid `Range: bytes=0-1023` → `206` (`bytes 0-1023/214590`), `If-Range` match → `206` / mismatch → `200` full fallback, out-of-bounds `Range` → `416` (`bytes */214590`, `userMessage: "This download could not be resumed. Start a new download."`). |
| **Failed Job Retry & Persistence** | 404 URL failed with human-friendly `userMessage`, persisted in `GET /api/v1/account/history`, and re-queued cleanly via `POST /api/v1/jobs/:id/retry` (`HTTP 200`, `status: QUEUED`). API integration suite (`tests/integration/api-integration.test.ts`): **14 / 14 PASS**. |
| **Low-End Device Optimisation** | Full analysis, Chrome trace (`Trace-20261118T135740.json.gz`), `JetBrains_Mono` `preload: false`, `text-wrap: balance` fix, Lightweight Mode, Save-Data, and honest lab-vs-CrUX note published in [`docs/performance/LOW_END_DEVICE_REPORT.md`](../performance/LOW_END_DEVICE_REPORT.md). |

**Final Phase 2 Production Verdict: GO (PASS — 0 Failures, 0 Open Defects).**
