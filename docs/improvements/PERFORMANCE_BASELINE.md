# MUXARO Performance & Low-End Device Baseline (Phase 1 Measurement)
**Product:** MUXARO — *Your Media. One Powerful Workspace.*  
**Author:** AGENT 01 — Principal Architect & System Designer  
**Measurement Environment:** Local Windows Workstation, Next.js `14.2.24` Production Build (`apps/web/.next`), Fastify API (`http://127.0.0.1:4000`)  
**Date:** 18 November 2026  

---

## 1. Methodological Integrity: Lab Measurements vs. Real-World Field Data (CrUX)

> **Important Distinction:** Every timing, bundle size, and latency number in this report is a **local lab measurement** captured on `localhost` (`127.0.0.1`) from the compiled Next.js `.next` production bundle and local Fastify server.
>
> **These figures are NOT Chrome User Experience Report (CrUX) field data.** Real-world Core Web Vitals (`LCP`, `INP`, `CLS`, `TTFB`) vary substantially across real user hardware (e.g., 2 GB RAM Android Go handsets, thermal-throttled CPUs, high-RTT 3G/4G cellular links, and TLS/CDN hops). Production CrUX telemetry can only be reported after deploying to public traffic with Real User Monitoring (RUM) enabled.

---

## 2. Next.js Production Route Bundle Sizes (Verified Baseline)

Captured from `npx next build` (`apps/web`, Next.js `14.2.24`, documented in `docs/design/FRONTEND_QA.md`):

| Route | Route-Specific JS (Gzip) | First Load JS (Gzip) | Rendering Mode | Notes |
| :--- | ---: | ---: | :--- | :--- |
| **Shared Runtime (`_app` / chunks)** | — | **`87.3 kB`** | Shared | `fd9d1056`: `53.6 kB`, `117`: `31.6 kB`, other: `2.04 kB` |
| **Homepage (`/`)** | `7.14 kB` | **`105 kB`** | Static + Dynamic Islands | `MediaInspector` & `JobProgress` split via `next/dynamic({ ssr: false })` |
| **My Downloads (`/dashboard`)** | `10.4 kB` | **`108 kB`** | Client Workspace | Highest route-specific JS due to inline `JobProgress` import & retention SVG |
| **Usage & Quota (`/credits`)** | `8.01 kB` | **`98.9 kB`** | Client Workspace | Circular SVG gauges, countdown timer, search/filter ledger |
| **Tools Directory (`/tools`)** | `188 B` | **`94.3 kB`** | Static SSG | Minimal JS footprint |
| **Tool Subpages (7 routes)** | `4.38 kB – 5.35 kB` | **`102 – 103 kB`** | Client Forms + Dynamic `JobProgress` | `/tools/playlist-batch` at `5.35 kB` |
| **Docs & Legal (`/docs`, `/docs/[slug]`, `/privacy`, `/terms`, `/dmca`)** | `188 B` | **`94.3 kB`** | Static SSG | Pure static HTML + shared shell |

---

## 3. Uncompressed Built Chunk & CSS Asset Breakdown

Measured directly on disk from `apps/web/.next/static/chunks/` and `apps/web/.next/static/css/`:

### 3.1 Top Built JavaScript Chunks (Uncompressed Parse/Compile Weight)
Even when gzip transfer size is ~87–105 kB, **low-end mobile CPUs must parse and compile uncompressed JS bytes**:

| Built Asset (`apps/web/.next/static/chunks/`) | Uncompressed Size (KB) | Role |
| :--- | ---: | :--- |
| `fd9d1056-88c310b6d67230a6.js` | **168.78 KB** | React DOM runtime bundle |
| `framework-f66176bb897dc684.js` | **136.70 KB** | React / Next.js core framework |
| `main-a43ae17380f92d73.js` | **123.27 KB** | Next.js App Router client runtime |
| `117-254380b2e9c3a322.js` | **120.63 KB** | Shared client libraries & routing utilities |
| `polyfills-42372ed130431b0a.js` | **109.96 KB** | Legacy browser polyfills |
| `page-559e599d7584cd22.js` | **28.66 KB** | Heavy page bundle (dashboard/credits) |
| `page-9c94608afbb49982.js` | **23.72 KB** | Secondary page bundle |
| `972-a54ad908503a0a4b.js` | **20.10 KB** | Shared icon / helper chunk |
| `page-e42a31eedf0742e9.js` | **18.59 KB** | Route page chunk |
| `588.13fba08f20ea76eb.js` | **17.36 KB** | Dynamic island chunk (`MediaInspector` / `JobProgress`) |

### 3.2 Stylesheet Weight (`apps/web/.next/static/css/`)
- `d15319f1ddd97032.css`: **`36.63 KB`** uncompressed (Tailwind purged + `apps/web/app/globals.css` token definitions).
- **Zero render-blocking third-party CSS:** External stylesheet links are completely absent.

---

## 4. Font Loading Strategy Audit (`apps/web/app/layout.tsx`)

- **Current Implementation (`layout.tsx:2–17`):**
  - Loads `Inter` (`--font-sans`) and `JetBrains_Mono` (`--font-mono`) via `next/font/google` with `display: 'swap'` and `subsets: ['latin']`.
  - Self-hosted automatically by Next.js build pipeline (eliminated the prior v1.0 `6,632 ms` throttled LCP font-blocking regression).
- **Low-End Improvement Opportunities:**
  - Every page currently preloads both `Inter` and `JetBrains_Mono`, even consumer screens that render zero monospace metrics by default.
  - Pre-hydration inline script (`layout.tsx:50–54`) currently initializes dark/light theme only; it should also initialize `data-lightweight="true"` from `localStorage` (`'muxaro-lightweight'`) before first paint so low-end devices never flash ambient animations.

---

## 5. Real Chrome DevTools Trace Analysis (`Trace-20261118T135740.json.gz`)

Parsed directly from the user's live Chrome DevTools Performance Trace recorded against `http://localhost:3000/` (`2026-11-18T08:27:40Z`, **iPhone 16 emulation, 20× CPU throttle, Fast 4G network throttle — 165 ms RTT, 1.01 MB/s down**; pre-Phase-2 build snapshot):

### 5.1 Core Web Vitals & Main-Thread Telemetry (Lab — Extreme 20× CPU + Fast 4G)

| Metric | v1.0 Pre-Redesign | Measured in Trace (`135740`) | CWV Target | Assessment |
| :--- | ---: | ---: | :---: | :--- |
| **FCP (First Contentful Paint)** | — | **`1,639.8 ms`** | `< 1,800 ms` | **PASS** (even under 20× CPU + Fast 4G) |
| **LCP (Largest Contentful Paint)** | `7,210 ms` | **`2,848.1 ms`** (`-60.5%`) | `< 2,500 ms` | **348 ms over target** under 20× CPU; LCP node = Hero `<h1>` `.muxaro-text-gradient` span (`size: 19,288`) after `Inter` woff2 swap (`1,992.7 ms`) |
| **CLS (Cumulative Layout Shift)** | `0.08` | **`0.0003`** (`2` micro-shifts) | `< 0.10` | **EXCELLENT PASS** (333× better than threshold) |
| **Long Tasks (`>= 50 ms`)** | — | **`38` tasks** (`TBT: 7,617.4 ms` at 20× CPU) | — | Dominated by `Layout` (`3,299.6 ms`), `FunctionCall` (`3,090.2 ms`), `EvaluateScript` (`1,156.7 ms`) |
| **CSS Delivery (`d15319f1...css`)** | — | **`672.9 ms`** finish | — | Clean single stylesheet, zero external font `<link>` |
| **Primary Font (`Inter` woff2, 47.3 KB)** | Render-blocking | **`1,992.7 ms`** finish (`809.8 ms` fetch) | — | Self-hosted `next/font/google`, swapped cleanly with `display: 'swap'` |
| **CrUX Field Data in Trace** | — | `null` (`localhost`) | — | Confirms zero CrUX field records exist for `localhost` |

### 5.2 Top Slowest Trace Bottlenecks (Evidence-Based Root Causes)
1. **Hydration Full-Document Layout Spike (`1,545.1 ms` at `t=4,428.8 ms`, 217/293 dirty objects):** Caused by large initial DOM tree + `text-wrap: balance` multi-pass Blink line-breaking on headings during React hydration and font swap under 20× CPU throttling.
2. **Primary Font Contention (`Inter` finished at `1,992.7 ms`):** `JetBrains_Mono` in `layout.tsx` defaults to `preload: true`, competing with `Inter` on Fast 4G even though `/` renders zero monospace text on initial paint.
3. **Chunk Parse/Evaluate under 20× CPU:** `webpack` (`765.2 ms` evaluate including module init), `fd9d1056` (`168.8 KB` uncompressed; `1,067 ms` fetch on Fast 4G), `117` (`120.6 KB` uncompressed; `1,055.8 ms` fetch).
4. **Actionable Micro-Optimisations Flagged:**
   - Set `preload: false` on `JetBrains_Mono` in `apps/web/app/layout.tsx` so `Inter` gets uncontested Fast 4G priority on `/`.
   - Restrict `text-wrap: balance` in `apps/web/app/globals.css` (disable under `[data-lightweight="true"]` and remove from `h2, h3, h4` to eliminate multi-pass Blink layout spikes on low-end CPUs).
   - Phase 2 homepage simplification (`apps/web/app/page.tsx`) already removes the 3-step section and sample chip row, cutting initial hydrated DOM node count.

---

## 6. Live Local API Response Latency (Measured)

Measured synchronously against live Fastify server (`http://127.0.0.1:4000`, no network RTT):

| Endpoint | HTTP Status | Measured Latency (Local) | Payload Size | Observation |
| :--- | :---: | ---: | ---: | :--- |
| `GET /api/v1/health` | `200` | `545 ms` (initial cold connect) | `210 B` | Fast subsequent responses; check overhead minimal |
| `GET /api/v1/account/credits` | `200` | `20 ms` | `359 B` | Sub-25ms rolling window quota lookup |
| `GET /api/v1/admin/metrics` | `200` | `15 ms` | `493 B` | Instant in-memory telemetry response |

---

## 7. Low-End Device & Network Bottlenecks Identified for Remediation

1. **Unconditional Video Preview Bandwidth Drain (`JobProgress.tsx`):** Auto-mounting `<video controls preload="metadata">` on job completion immediately initiates extra HTTP Range fetches on metered cellular or `Save-Data` connections. **Fix:** Mount preview player only when user clicks `"Preview video"` / `"Preview audio"`.
2. **Unconditional Background Polling (`JobProgress.tsx`, `dashboard/page.tsx`):** Polling continues even when browser tabs are backgrounded (`document.visibilityState === 'hidden'`), wasting battery and CPU wakeups on budget Android devices. **Fix:** Pause polling while hidden and resume cleanly on `visibilitychange`.
3. **No Adaptive Lightweight Mode (`useDeviceMode`):** No automatic detection for `prefers-reduced-motion: reduce`, `navigator.connection?.saveData`, `effectiveType` (`slow-2g`/`2g`), `navigator.deviceMemory <= 2`, or `navigator.hardwareConcurrency <= 4`. **Fix:** Introduce `useDeviceMode()` + user-accessible Lightweight Mode toggle in `Navbar` + CSS-only `.muxaro-aurora-shell` with `data-aurora-paused="true"` and `[data-lightweight="true"]` animation suppression.
4. **Monolithic Single-Shot Uploads (`api-client.ts:381–409`):** Uploading a 500 MB file on an unstable 3G/4G link fails completely on a single drop. **Fix:** Resumable multipart chunked upload with per-part retry and `AbortController` cancellation.
5. **Single-Queue Contention (`queue.service.ts`):** Heavy transcoding blocks lightweight remux/audio jobs. **Fix:** 6-class TurboFlow smart queue separation with stream-copy Instant Lane (`-c copy -movflags +faststart`).

---
*All metrics grounded in verified workspace artifacts prior to Phase 2–4 optimisations.*
