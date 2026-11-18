# MUXARO Frontend Component Guide

**Directory:** `apps/web/components/`  
**Conventions:** Client components explicitly declare `'use client'`, use Lucide SVG icons (`lucide-react`) with `aria-hidden="true"`, consume design tokens via Tailwind classes, and never invent mock fallback data.

---

## 1. Component Inventory

| Component | File | Client/Server | Primary Responsibility |
| :--- | :--- | :---: | :--- |
| **`Navbar`** | `components/Navbar.tsx` | Client | Sticky global navigation, live quota/credits pill, account dropdown, theme toggle, lightweight mode toggle, responsive mobile drawer |
| **`Footer`** | `components/Footer.tsx` | Server | 4-column semantic footer (Brand/Status, Product, Resources, Legal) with 60-minute auto-delete notice |
| **`MediaInspector`** | `components/MediaInspector.tsx` | Client (Dynamic) | Inspects `MediaManifest`; provides Video, Audio, and Merge mode tabs, normalized quality options, compression toggle, and job submission |
| **`JobProgress`** | `components/JobProgress.tsx` | Client (Dynamic) | Tracks active/completed jobs via visibility-aware polling, honest progress bar, opt-in auto-download toggle, on-demand preview, Background Fetch, retry/cancel |
| **`RewardedAdCard`** | `components/RewardedAdCard.tsx` | Client | Optional GAM rewarded ad UI; hidden unless server config confirms ads are enabled and configured; polls server SSV verification before granting credits |
| **`ConsentBanner`** | `components/ConsentBanner.tsx` | Client | Fixed bottom Consent Mode v2 privacy controls (Essential only, Customize switches, Accept all) |
| **`AnalyticsProvider`** | `components/AnalyticsProvider.tsx` | Client | Bootstraps default-denied `gtag` Consent Mode v2 and tracks route-change page views when `NEXT_PUBLIC_GA_MEASUREMENT_ID` or `NEXT_PUBLIC_GTM_CONTAINER_ID` is configured |
| **`DimensionTick`** | `components/DimensionTick.tsx` | Server | Compact label + monospace value/unit metric row |

---

## 2. Core Components in Detail

### 2.1 `Navbar` (`apps/web/components/Navbar.tsx`)
- **Navigation Links:** `Home` (`/`), `Tools` (`/tools`), `My Downloads` (`/dashboard`), `Usage` (`/credits`), `Account` (`/account`). Conditionally shows `Admin` (`/admin`) when `authenticated && user.role === 'admin'`.
- **Live Quota Pill:** Calls `api.getQuota()` whenever auth state (`authenticated`, `user?.publicUserId`) changes. Renders loading skeleton while fetching, exact `available/baseLimit` or `available credits` when loaded, and a plain `Usage` fallback on error—never fabricated counts.
- **Account Menu:** Displays sanitized avatar (`isSafeAvatarUrl`) or computed initials, `user.publicUserId` (`MXR-*`), quick links, and `Sign out` action. Supports `Escape` key dismissal with focus restoration and outside-click closing via `pointerdown`.
- **Utility Controls:**
  - **Lightweight Mode (`Feather` button):** Wired to `useDeviceMode().toggleLightweight`, exposing `aria-pressed`.
  - **Theme Switcher (`Sun`/`Moon` button):** Toggles `.dark`, `data-theme="dark|light"`, and `localStorage.theme`.

### 2.2 `MediaInspector` (`apps/web/components/MediaInspector.tsx`)
Loaded lazily on `/` via `next/dynamic(..., { ssr: false })` to keep initial hero bundle size low.
- **Props:** `{ manifest: MediaManifest; onJobStarted: (job: ProcessingJob) => void }`.
- **Modes (`InspectorMode`):**
  - `'video'`: Uses `normalizeVideoOptions(manifest, savedPref)` from `lib/format-normalizer.ts` to deduplicate resolution/FPS/HDR tiers, prefer H.264 compatibility, highlight recommended/stream-copy options, and optionally enable compression (`720p` / `480p`) or container selection (`mp4`, `mkv`, `webm`).
  - `'audio'`: Uses `normalizeAudioOptions(manifest)` and offers 6 formats (`original`, `mp3`, `m4a`, `opus`, `wav`, `flac`) with plain-English descriptions.
  - `'merge'`: Combines video with either included audio or a separately pasted URL / uploaded local audio file.
- **Persistence:** Remembers the user's preferred video height in `localStorage` (`muxaro-preferred-height`) via `saveQualityPreference()`.

### 2.3 `JobProgress` (`apps/web/components/JobProgress.tsx`)
Also dynamically split (`next/dynamic(..., { ssr: false })`).
- **Props:** `{ initialJob: ProcessingJob; onJobUpdate?: (updated: ProcessingJob) => void; onDismiss?: () => void }`.
- **Polling Strategy:** Polls `api.getJob(job.id)` every `2000ms` (`BASE_POLL_INTERVAL_MS`), backing off exponentially up to `10000ms` (`MAX_BACKOFF_INTERVAL_MS`) across up to `15` retries (`MAX_POLL_RETRIES`). Automatically pauses when `document.visibilityState === 'hidden'` and resumes 200ms after returning to foreground.
- **Honest Progress Bar:** Displays an indeterminate pulse while `CREATED`/`QUEUED` or `0%`; switches to a GPU-composited `transform: scaleX(...)` bar once the backend reports real progress.
- **Completion View (`READY`):**
  - Primary download link pointing to `/api/v1/jobs/:id/download` or signed URL.
  - **Opt-In Auto-Download:** `role="switch"` defaulting strictly to **OFF** (`muxaro-auto-download` in `localStorage`).
  - **On-Demand Media Preview:** `<video>` / `<audio>` elements use `preload="metadata"` and are NEVER mounted until the user explicitly clicks **Preview** (protecting mobile / Save-Data bandwidth).
  - **Progressive Background Fetch:** Shows `Save in background` only when `detectBackgroundDownloadSupport()` confirms an active Service Worker exposing `backgroundFetch`.
  - **Collapsible Technical Disclosure:** Reveals SHA-256 checksum (with copy button), processing lane (`Instant`/`Smart`/`Power`), and 60-minute retention note.

### 2.4 `RewardedAdCard` (`apps/web/components/RewardedAdCard.tsx`)
- **Zero-Clutter Guard:** Renders `null` whenever unauthenticated, disabled, or `GAM_REWARDED_AD_UNIT_PATH` is unconfigured (except an optional muted status line when `showUnconfiguredNote={true}` on `/credits`).
- **Server-Verified Flow:**
  1. Calls `api.createRewardSession()` to mint a server-signed `MXRWD-*` session before loading any ad script.
  2. Lazily injects `https://securepubads.g.doubleclick.net/tag/js/gpt.js` only after explicit user click.
  3. On GPT `rewardedSlotGranted` + `rewardedSlotClosed`, **never credits locally**—polls `api.refreshRewardSession(sessionId)` up to 12 times (`2000ms` interval) until server-side ECDSA SSV marks the session `VERIFIED`.

### 2.5 `ConsentBanner` & `AnalyticsProvider`
- `ConsentBanner` listens for `OPEN_CONSENT_EVENT` (`muxaro-open-consent-settings`) and `CONSENT_CHANGE_EVENT` (`muxaro-consent-change`) so footer/privacy links can reopen preferences at any time.
- `AnalyticsProvider` validates `NEXT_PUBLIC_GA_MEASUREMENT_ID` (`/^G-[A-Z0-9]{4,20}$/i`) and `NEXT_PUBLIC_GTM_CONTAINER_ID` (`/^GTM-[A-Z0-9]{4,20}$/i`) before injecting `<Script strategy="afterInteractive">` tags.

---

## 3. Authoring Guidelines for New Components

1. **No Literal Colors:** Always use Tailwind semantic tokens (`bg-surface`, `text-content`, `border-line`, `text-brand-violet`).
2. **Accessible Interactive Controls:** Include explicit `type="button"`, `aria-label` on icon-only buttons, `aria-expanded`/`aria-controls` on disclosures/drawers, and `aria-hidden="true"` on decorative Lucide icons.
3. **Motion Safety:** Prefix utility animations with `motion-safe:` (e.g., `motion-safe:animate-spin`) and never use `transition-all`.
4. **Error Hygiene:** Route error strings through `mapFriendlyError()` (`apps/web/lib/background-download.ts`) so internal enums or HTTP stack details are never shown as primary UI messages.
