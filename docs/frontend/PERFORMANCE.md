# MUXARO Frontend Performance Engineering

**Scope:** `apps/web` (Next.js `14.2.24` App Router)  
**Measurement Basis:** Local lab measurements from compiled `npx next build` artifacts and Chrome DevTools mobile throttling (`20× CPU`, Fast 4G). These are **not** Chrome User Experience Report (CrUX) field metrics; real-world field telemetry requires public deployment with RUM.

---

## 1. Bundle & Code-Splitting Architecture

MUXARO prioritizes fast initial paint on low-end mobile devices and constrained cellular links:

- **Dynamic Interactive Islands (`apps/web/app/page.tsx`):** `MediaInspector` and `JobProgress` are loaded via `next/dynamic(..., { ssr: false })`. Users landing on `/` do not download or parse inspection/progress UI chunks until they submit a URL or file.
- **Lazy Third-Party Scripts:**
  - Google Publisher Tag (`gpt.js` in `RewardedAdCard.tsx`) is never loaded on page boot; it is injected only when an authenticated user explicitly clicks **Watch advertisement** and server config confirms ads are enabled.
  - Google Analytics / GTM (`AnalyticsProvider.tsx`) are omitted completely unless `NEXT_PUBLIC_GA_MEASUREMENT_ID` or `NEXT_PUBLIC_GTM_CONTAINER_ID` is configured, and use `strategy="afterInteractive"` with default-denied Consent Mode v2.
- **Static Export Compatibility:** `CLOUDFLARE_PAGES=1 npm run build` emits pure static HTML/JS/CSS/SVG assets (`apps/web/out/`) with immutable edge caching on `/_next/static/*` (`Cache-Control: public, max-age=31536000, immutable` in `public/_headers`).

### Measured Next.js 14.2.24 Production Build Footprint

From local verification (`docs/account-platform/FINAL_QA_REPORT.md` and `docs/performance/LOW_END_DEVICE_REPORT.md`):

| Route | Route JS (Gzipped) | First Load JS (Gzipped) | Notes |
| :--- | ---: | ---: | :--- |
| **Shared Runtime (All Routes)** | `87.4 kB` | `87.4 kB` | React 18 + Next.js App Router runtime |
| **Homepage (`/`)** | `9.23 kB` | `116 kB` | `MediaInspector` & `JobProgress` dynamically split |
| **Tools Directory (`/tools`)** | `188 B` | `94.3 kB` | Pure static HTML |
| **Docs & Legal (`/docs/*`, `/privacy`, `/terms`, `/dmca`)** | `188 B` | `94.3 kB` | Prerendered static / SSG HTML |
| **Account (`/account`)** | `11.3 kB` | — | Profile, MFA, and session management |
| **My Downloads (`/dashboard`)** | `19.9 kB` | — | Server-persisted background queue & batches |
| **Usage & Limits (`/credits`)** | `16.3 kB` | — | Live rolling quota & credit ledger |
| **Admin (`/admin`)** | `12.6 kB` | — | MFA-gated Admin Control Centre |

---

## 2. Font & Render-Path Optimization

1. **Self-Hosted Next.js Fonts (`apps/web/app/layout.tsx`):** `Inter` and `JetBrains_Mono` load via `next/font/google` with `display: 'swap'`. Zero render-blocking external `<link rel="stylesheet">` font requests exist in `<head>`.
2. **Bandwidth Prioritization:** `JetBrains_Mono` sets `preload: false` so `Inter` WOFF2 receives uncontested download priority during initial hero paint.
3. **Zero-Flash Pre-Hydration Script (`app/layout.tsx`):** A minimal inline script sets `.dark`, `data-theme`, and `data-lightweight="true"` on `<html>` before first paint, keeping Cumulative Layout Shift (`CLS`) near zero (`0.0003` in local DevTools trace).
4. **Layout Cost Mitigation (`globals.css`):** `text-wrap: balance` is restricted to `h1` and disabled under `[data-lightweight="true"]` (`text-wrap: normal`) to avoid multi-pass line-breaking overhead on low-end CPUs.

---

## 3. Adaptive Low-End Device & Network Mode (`lib/device-mode.ts`)

`useDeviceMode()` automatically detects constrained hardware and networks and applies `[data-lightweight="true"]`:

| Signal | Detection Source | Runtime Action |
| :--- | :--- | :--- |
| **Manual Lightweight Mode** | Navbar `Feather` button (`localStorage['muxaro-lightweight']`) | Disables Aurora keyframes & blur filters, swaps to `--muxaro-aurora-static` gradient, disables `h1` `text-wrap: balance` |
| **Reduced Motion** | `matchMedia('(prefers-reduced-motion: reduce)')` + CSS media query | Disables all animations/transitions and Aurora motion |
| **Save-Data / 2G Network** | Feature-detected `navigator.connection?.saveData` & `effectiveType` (`2g`/`slow-2g`) | Auto-enables Lightweight mode; prevents any automatic media preloading |
| **Background Tab** | `document.visibilityState === 'hidden'` | Sets `data-aurora-paused="true"` to stop GPU compositor wakeups and pauses `JobProgress` / `Dashboard` polling |

---

## 4. Network & Memory Discipline for Large Media

- **Zero-RAM Multipart Uploads (`lib/api-client.ts`):** Local uploads larger than 5 MB stream via `file.slice()` in 5 MB parts (`PUT /api/v1/media/upload/:uploadId/part/:partNumber`) with up to 3 automatic retries per chunk and `AbortController` cancel support. The browser never calls `file.arrayBuffer()` on large video files.
- **Resumable Downloads (`JobProgress.tsx` & `lib/background-download.ts`):** Download links target server endpoints supporting HTTP `Range` (`206`), strong `ETag`, `If-Range`, and optional Background Fetch API progressive enhancement when a supporting Service Worker is active.
- **Click-to-Preview Protection:** Media `<video>` / `<audio>` tags use `preload="metadata"` and mount strictly on user click.

---

## 5. Verification Commands

```bash
# Type-check frontend
cd apps/web && npx tsc --noEmit

# Standard production build (inspect route bundle sizes)
cd apps/web && npm run build

# Static Cloudflare Pages export verification
cd apps/web && CLOUDFLARE_PAGES=1 npm run build
node qa/harness/verify-static-export.mjs
```
