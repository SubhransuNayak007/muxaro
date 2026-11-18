# MUXARO Production Mock, Sample & Fake Fallback Inventory
**Product:** MUXARO — *Your Media. One Powerful Workspace.*  
**Author:** AGENT 01 — Principal Architect & System Designer  
**Date:** 18 November 2026  
**Policy:** Zero hardcoded samples, fake operational fallbacks, or fabricated ledger/quota/status data in production runtime (`apps/web/` & `apps/api/`). Automated test fixtures in `qa/` and `tests/` remain strictly isolated and preserved.

---

## 1. Executive Summary

Line-by-line static scanning of `apps/web/` and `apps/api/` identified **13 distinct production locations** containing hardcoded sample buttons, pre-filled fake URLs (`storage.googleapis.com/test-media/*`), fabricated fallback ledgers, synthetic offline quota balances (`10/10`), and hardcoded operational uptime/throughput metrics (`99.98%`, `14,820`).

Every item below has an assigned P0 remediation owner and target honest behavior (loading skeleton, genuine empty state, or clear error banner with a working **Retry** button).

---

## 2. Production Code Inventory (`apps/web/` — MUST BE REMOVED OR REPLACED)

### 2.1 Homepage Demo Chips & Sample URLs
| File | Exact Lines | Current Code / Artifact | Defect | Owner & Required Fix |
| :--- | :--- | :--- | :--- | :--- |
| `apps/web/app/page.tsx` | `49–62`, `171–175`, `360–372` | `SAMPLE_ITEMS`: `'Ultra HD Demo'`, `'4K Nature Clip'`, `'Audio Sample'` pointing to `https://storage.googleapis.com/test-media/sample-8k-av1.mp4`, `sample-4k-vp9.webm`, `orchestra-audio.opus` + `"Try a sample:"` button row | Visible demo shortcuts on live consumer homepage pointing to non-existent external URLs | **`@uihero`**: Delete `SAMPLE_ITEMS`, `handleUseSample`, and entire `"Try a sample:"` row completely. |

### 2.2 API Client Fake Operational Fallbacks
| File | Exact Lines | Current Code / Artifact | Defect | Owner & Required Fix |
| :--- | :--- | :--- | :--- | :--- |
| `apps/web/lib/api-client.ts` | `512–520` | `getHistory()` silently catches errors and returns `[]` | Masks API outages as "empty history" instead of allowing UI to show an error + Retry banner | **`@uiinspect` / `@uiwork`**: Propagate real error or expose honest status so My Downloads displays an error banner + Retry on failure. |
| `apps/web/lib/api-client.ts` | `525–555` | `getQuota()` catches API errors and returns hardcoded `{ individualVideosRemaining: 10, individualVideosLimit: 10, playlistJobsRemaining: 1, playlistJobsLimit: 1, ... }` | Fabricates full `10/10` availability when the backend is unreachable or returns an error | **`@uiinspect` / `@uinav` / `@uiquota`**: Throw genuine error (or return `null` on failure) — NEVER fabricate `10/10`. |
| `apps/web/lib/api-client.ts` | `560–570` | `getCreditLedger()` catches errors and returns `[]` | Hides backend ledger failures; combined with `credits/page.tsx:302`, triggers fake sample ledger rows | **`@uiinspect` / `@uiquota`**: Throw on API failure so UI shows honest error + Retry; render honest empty state when API returns `[]`. |
| `apps/web/lib/api-client.ts` | `575–589` | `getSystemMetrics()` hardcodes `apiLatencyMs: 14`, `cpuLoadPercent: 28`, `uptimePercent: 99.98`, `errorRate24hPercent: 0.12` inside the live `/admin/metrics` branch | Injects fabricated numbers (`14 ms`, `28%`, `99.98%`) into live API responses instead of reporting actual server fields | **`@uiinspect` / `@pipeline`**: Map strictly real backend metrics or `null`/unavailable; zero invented SLA/latency constants. |

### 2.3 Usage / Credits Page Mock Ledger
| File | Exact Lines | Current Code / Artifact | Defect | Owner & Required Fix |
| :--- | :--- | :--- | :--- | :--- |
| `apps/web/app/credits/page.tsx` | `42–70`, `294`, `302–305` | `getFallbackLedger()` returning fake transactions `tx_99120` (`Video conversion (4K Remux)`), `tx_99119` (`Audio extraction (Studio FLAC)`), `tx_99118` (`Daily quota refresh`) whenever API returns empty or errors | Shows fabricated job history to brand-new users who have zero activity | **`@uiquota`**: Delete `getFallbackLedger()` completely. Render loading skeleton, genuine empty state (`"No activity yet in this rolling window."`), or error + Retry banner. |

### 2.4 Navbar Hardcoded Initial Quota
| File | Exact Lines | Current Code / Artifact | Defect | Owner & Required Fix |
| :--- | :--- | :--- | :--- | :--- |
| `apps/web/components/Navbar.tsx` | `15–18`, `46–48` | `useState({ remaining: 10, limit: 10 })` + silent catch keeping `10/10` | Displays fake `10/10` quota before API responds or while offline | **`@uinav`**: Initialize `quota = null`. Show real `${remaining}/${limit}` only after API responds; on error show clean `Usage` link without fake numbers. |

### 2.5 Hardcoded Sample URLs & Fake Playlists Across Tool Pages
| File | Exact Lines | Current Code / Artifact | Defect | Owner & Required Fix |
| :--- | :--- | :--- | :--- | :--- |
| `apps/web/app/tools/audio-extractor/page.tsx` | `61–63` | Pre-filled `url = 'https://storage.googleapis.com/test-media/orchestra-audio.opus'` | Pre-fills broken demo URL into real customer input | **`@frontend`**: Initialize `url` to `''` with clean placeholder only. |
| `apps/web/app/tools/media-converter/page.tsx` | `27–29` | Pre-filled `url = 'https://storage.googleapis.com/test-media/...'` | Pre-fills broken demo URL | **`@frontend`**: Initialize `url` to `''`. |
| `apps/web/app/tools/audio-video-merger/page.tsx` | `28–31` | Pre-filled video & audio `storage.googleapis.com/test-media/*` URLs | Pre-fills broken demo URLs | **`@frontend`**: Initialize both inputs to `''`. |
| `apps/web/app/tools/video-merger/page.tsx` | `29–30` | Pre-filled clip array with `storage.googleapis.com/test-media/*` URLs | Pre-fills broken demo clip URLs | **`@frontend`**: Initialize empty input slots `['', '']`. |
| `apps/web/app/tools/batch-processing/page.tsx` | `38–44` | Pre-filled batch queue rows pointing to `storage.googleapis.com/test-media/*` | Shows fake batch jobs before user enters any URLs | **`@frontend`**: Initialize empty input list with honest empty state. |
| `apps/web/app/tools/playlist-processing/page.tsx` | `32–41`, `62`, `179–184` | Hardcoded `SAMPLE_ITEMS` fake playlist preview tracks & pre-filled playlist URL | Displays and submits fake playlist tracks instead of real inspected items | **`@frontend`**: Remove `SAMPLE_ITEMS` completely; inspect real playlist URLs via API and render real items + single verified **Download all as ZIP**. |
| `apps/web/app/tools/playlist-batch/page.tsx` | `42–61` | Pre-filled batch rows and playlist URL pointing to `storage.googleapis.com/test-media/*` | Shows fake batch & playlist inputs on initial load | **`@frontend`**: Remove all hardcoded test URLs; start clean with honest empty/loading/error states. |

### 2.6 Status & Admin Hardcoded Baseline Metrics
| File | Exact Lines | Current Code / Artifact | Defect | Owner & Required Fix |
| :--- | :--- | :--- | :--- | :--- |
| `apps/web/app/status/page.tsx` | `19–28`, `65`, `76–82` | `DEFAULT_METRICS` (`apiLatencyMs: 14`, `uptimePercent: 99.98`, `totalProcessed24h: 14820`) | Displays synthetic operational numbers before/without live API response | Flagged for cleanup (do not invent SLA numbers when API is unreachable). |
| `apps/web/app/admin/page.tsx` | `29–31` | Hardcoded `uptimePercent: 99.98`, `totalProcessed24h: 14820` defaults | Synthetic admin metrics prior to live fetch | Flagged for honest null/loading state on admin view. |

### 2.7 Synthetic Preset Synthesis & Placeholder Fallbacks
| File | Exact Lines | Current Code / Artifact | Defect | Owner & Required Fix |
| :--- | :--- | :--- | :--- | :--- |
| `apps/web/components/MediaInspector.tsx` | `39–61`, `138–155` | Static `COMPRESS_PRESETS` (`1080p`, `720p`, `480p`) shown unconditionally even if source video height is `< 1080` (e.g., `240p` or `360p` source) | Offers resolution choices higher than the actual source video | **`@uiinspect`**: Only render resolution/compression presets strictly `<=` true source height, backed by deduplicated API manifest. |
| `apps/web/lib/api-client.ts` | `195`, `296` | Generic fallback titles `'Media Processing Job'`, `'Media File'` | Acceptable only when source genuinely lacks a filename/title — must prefer actual uploaded filename or inspected title | Verified safe when used strictly as last-resort fallback. |

---

## 3. Isolated Automated Test Fixtures (PRESERVED — NOT PRODUCTION CODE)

The following files exist **solely for automated regression testing, security testing, and FFmpeg benchmarking** and are NEVER bundled into the Next.js web app or Fastify production routes:

- **`qa/harness/verify-web-live.mjs`** — Live HTTP route and asset verifier.
- **`qa/harness/verify-real-download-e2e.mjs`** — End-to-end binary upload, compression, YouTube download, Range `206`, and `ffprobe` verifier.
- **`qa/load/load-simulation.ts`** — 100K CCU / 20.5K RPS Monte Carlo load test harness.
- **`tests/**`** — Unit, concurrency race, SSRF security regression, media engine synthetic FFmpeg test files, and API integration suites.

**Isolation Rule:** Production code in `apps/web/` and `apps/api/src/` MUST NEVER import from `qa/` or `tests/`. All automated QA fixtures remain untouched and isolated.
