# MUXARO Analytics, Consent Mode v2 & Auth Session Context Implementation Report

**Workstream:** Workstream 8 — Google Analytics 4, Consent Mode v2 & Cookie-Session Auth Context  
**Owner:** UI Lead (`@uilead`)  
**Status:** Implemented & Verified  
**Owned Artifacts:**
- `apps/web/lib/analytics.ts`
- `apps/web/components/ConsentBanner.tsx`
- `apps/web/components/AnalyticsProvider.tsx`
- `apps/web/lib/auth-context.tsx`

---

## 1. Environment Configuration & Safe No-Op Mode

MUXARO reads analytics credentials strictly from public runtime environment variables and **never invents or hardcodes measurement IDs**:

| Environment Variable | Format Validation | Behavior When Unset |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | `/^G-[A-Z0-9]{4,20}$/i` | Zero external `gtag.js` script injected; `trackEvent`, `trackPageView`, and `setAnalyticsUserId` cleanly no-op. |
| `NEXT_PUBLIC_GTM_CONTAINER_ID` | `/^GTM-[A-Z0-9]{4,20}$/i` | Zero external `gtm.js` script injected; clean no-op. |

Benefits of strict validation + no-op mode:
- Zero wasted network bytes or third-party scripts in local development, CI, or privacy-only deployments.
- Prevents malformed environment strings from injecting unexpected markup into inline bootstrap scripts (`JSON.stringify` + `encodeURIComponent` + strict regex guards).

---

## 2. Google Consent Mode v2 Architecture

### 2.1 Pre-Load Denied Defaults
Before `https://www.googletagmanager.com/gtag/js` loads, `AnalyticsProvider.tsx` executes a synchronous bootstrap script (`id="muxaro-consent-mode-v2"`) and `applyConsentDefaults()` in `apps/web/lib/analytics.ts` that initializes `window.dataLayer` and `window.gtag` with **all four Consent Mode v2 signals set to `'denied'`**:

```js
gtag('consent', 'default', {
  analytics_storage: 'denied',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  wait_for_update: 500,
});
```

If a returning user already saved a decision in `localStorage` under `muxaro-consent-v2`, the bootstrap immediately emits `gtag('consent', 'update', ...)` before any event is dispatched.

### 2.2 Privacy Choice UI (`apps/web/components/ConsentBanner.tsx`)
- Rendered as a non-blocking bottom floating bar (`role="region"`, `aria-label="Privacy and cookie preferences"`). Users can interact with MUXARO immediately without dismissing the banner.
- Provides three clear actions:
  - **Essential only**: sets `analytics: false`, `rewardedAds: false` (`denied` across all 4 Consent Mode v2 flags).
  - **Customize**: expands inline accessible `role="switch"` controls for **Product analytics** and **Optional rewarded ads** alongside a read-only **Essential cookies (Always on)** indicator, plus **Save preferences**.
  - **Accept all**: sets `analytics: true`, `rewardedAds: true` (`granted`).
- Persists structured JSON under `localStorage['muxaro-consent-v2']`:

```json
{
  "version": 2,
  "decided": true,
  "analytics": false,
  "rewardedAds": false,
  "updatedAt": "2026-11-18T14:20:00.000Z"
}
```

- Calling `openConsentSettings()` from `apps/web/lib/analytics.ts` dispatches `muxaro-open-consent-settings` so Footer or Account Settings can reopen the preference drawer at any time.

---

## 3. Event Taxonomy

All analytics events pass through the strongly typed `trackEvent(name, params?)` helper in `apps/web/lib/analytics.ts` and are suppressed whenever GA4 is unconfigured or `analytics_storage` is not granted.

| Category | Event Names | Typical Safe Parameters |
| :--- | :--- | :--- |
| **Acquisition** | `page_view`, `cta_clicked`, `tool_opened` | `page_path` (route only, no query string), `tool_slug`, `placement` |
| **Auth** | `auth_signup_started`, `auth_signup_completed`, `auth_login_completed`, `auth_logout`, `auth_email_verified`, `auth_google_started` | `method`, `scope` (`current_session` / `all_sessions`) |
| **Media Inspection & Upload** | `media_inspect_started`, `media_inspect_succeeded`, `media_inspect_failed`, `upload_started`, `upload_completed`, `upload_cancelled` | `input_mode`, `has_video`, `has_audio`, `chunked` |
| **Processing** | `job_created`, `job_completed`, `job_failed`, `job_cancelled`, `job_retried`, `batch_created` | `operation`, `lane` (`instant`/`smart`/`power`), `target_format`, `item_count` |
| **Downloads** | `download_started`, `download_completed`, `playlist_zip_downloaded` | `format`, `mode` (`manual`/`auto`) |
| **Rewards** | `reward_prompt_viewed`, `reward_session_started`, `reward_verified`, `reward_expired`, `rewarded_ad_offer_shown`, `rewarded_ad_started`, `rewarded_ad_completed`, `reward_granted`, `rewarded_ad_unavailable` | `reward_amount`, `reason` |
| **Engagement** | `dashboard_opened`, `mode_switched`, `advanced_drawer_toggled`, `lightweight_mode_toggled`, `theme_toggled`, `consent_updated` | `mode`, `enabled`, `analytics_granted`, `rewarded_ads_granted` |

---

## 4. Strict PII Protection & Official GA4 `user_id`

### 4.1 Automated Parameter Scrubber (`sanitizeAnalyticsParams`)
Every event payload is scrubbed before calling `window.gtag('event', ...)`:
1. **Key Denylist (`BLOCKED_KEY_PATTERN`)**: Drops any key matching `email`, `mail`, `name`, `display_name`, `username`, `url`, `uri`, `href`, `link`, `token`, `csrf`, `session`, `cookie`, `secret`, `password`, `auth`, `filename`, `filepath`, `path`, `title`, `ip`, `phone`, `address`, `user_id`, `public_user_id`, `internal_user_id`, `raw`.
2. **Value Denylist**: Drops any string matching email addresses, HTTP/FTP/file URLs, JWTs (`eyJ...`), `Bearer` tokens, 32+ char hex hashes, local OS paths (`C:\...`, `/Users/...`), or media file extensions (`.mp4`, `.mp3`, `.flac`, `.zip`, etc.).
3. **Length & Type Guard**: Accepts only finite numbers, booleans, and clean strings truncated to 64 characters.
4. **Route-Only Page Views**: `trackPageView(pathname)` strips all query strings (`?...`) and hash fragments (`#...`) so reset tokens, OAuth state/code parameters, or shared URLs can never appear in GA4.

### 4.2 Official GA4 `user_id` Binding
- `setAnalyticsUserId(opaqueInternalId | null)` sets GA4's official `user_id` property via `gtag('set', { user_id })` and `gtag('config', GA_MEASUREMENT_ID, { user_id, send_page_view: false })`.
- `user_id` is **blocked from custom event parameters** so it never duplicates into custom dimensions.
- Rejects any string containing emails, URLs, whitespace, or non-opaque characters.
- Automatically called with `null` upon logout or unauthenticated session refresh.

---

## 5. Cookie-Session Auth Context (`apps/web/lib/auth-context.tsx`)

- `AuthProvider` and `useAuth()` manage authentication strictly via HttpOnly server cookies (`credentials: 'include'` against `GET /api/v1/auth/session`). **Zero authentication tokens are stored in `localStorage`.**
- Mutating auth calls (`logout` -> `POST /api/v1/auth/logout`, `logoutAll` -> `POST /api/v1/auth/logout-all`) attach the `x-muxaro-csrf` header read from session state or the readable `muxaro_csrf` cookie.
- Exposes `{ user, authenticated, loading, csrfToken, googleAuthConfigured, refreshSession, logout, logoutAll, savePendingTask, consumePendingTask }`.
- **Login Continuity (`sessionStorage`)**: `savePendingTask()` stores an in-progress media URL, mode, resolution, format, and safe relative `returnTo` path in `sessionStorage['muxaro-pending-task']` (30-minute TTL); `consumePendingTask()` restores and clears it once after sign-in so users never lose their inspected media during authentication.
- **GA4 Sync**: Automatically invokes `setAnalyticsUserId(opaqueId)` on authenticated session load and `setAnalyticsUserId(null)` when signed out.

---

## 6. DebugView & QA Verification Checklist

1. **Unconfigured Environment Check**: Run `apps/web` without `NEXT_PUBLIC_GA_MEASUREMENT_ID` and confirm Network DevTools shows **0 requests** to `googletagmanager.com` or `google-analytics.com`.
2. **Consent Mode v2 Default Check**: With `NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX` set and fresh storage, inspect `window.dataLayer` on load and verify the first `consent` entry is `['consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', wait_for_update: 500 }]`.
3. **Consent Update Check**: Click **Accept all** (or toggle **Product analytics** inside **Customize** -> **Save preferences**) and confirm `window.dataLayer` receives `['consent', 'update', { analytics_storage: 'granted', ... }]` and `localStorage['muxaro-consent-v2']` persists across reloads.
4. **PII Scrubber Verification**: Pass `{ email: 'a@b.com', media_url: 'https://example.com/v.mp4', filename: 'clip.mp4', note: 'user@domain.com', format: 'mp4', lane: 'instant' }` into `sanitizeAnalyticsParams()` and verify ONLY `{ format: 'mp4', lane: 'instant' }` survives.
5. **GA4 DebugView Check**: Enable Google Analytics Debugger extension on a configured test property, verify `page_view` omits query strings, confirm `user_id` populates only after sign-in with an opaque ID, and verify `user_id` resets to `null` immediately upon clicking **Sign out**.
