# MUXARO Cloudflare Setup Guide (Pages, DNS, WAF & Headers)

**Live Deployment URL:** [`https://muxaro.pages.dev/`](https://muxaro.pages.dev/) *(verified live on `2026-11-18`: HTTP `200`, TLS 1.3 Let's Encrypt `YE1`, `301` HTTP→HTTPS redirect, security & `X-Robots-Tag` headers active)*  
**Frontend Project Config:** `apps/web/wrangler.toml`, `apps/web/next.config.mjs`  
**Edge Headers & Redirects:** `apps/web/public/_headers`, `apps/web/public/_redirects`  
**Infrastructure IaC Reference:** `infra/terraform/modules/cloudflare/main.tf`

---

## 1. Why Cloudflare Pages Static Export

MUXARO deploys `apps/web` to **Cloudflare Pages** as a pure static export (`CLOUDFLARE_PAGES=1` → `apps/web/out/`):
- **Zero Workers 10 ms CPU Limit Risk:** Static assets bypass Cloudflare Workers CPU ceilings completely.
- **All 30 Routes Prerendered:** Including `/docs/[slug]` via `generateStaticParams`; dynamic sessions, media inspection, job progress, and admin flows communicate with `NEXT_PUBLIC_API_URL` (`https://api.muxaro.app/api/v1`).
- **Global Edge Caching:** `/_next/static/*` is served with `Cache-Control: public, max-age=31536000, immutable`.

---

## 2. Cloudflare Pages Project Configuration (`apps/web/wrangler.toml`)

```toml
name = "muxaro"
compatibility_date = "2026-04-01"
pages_build_output_dir = "out"
```

### Dashboard Build Settings (if connecting Git directly)

| Setting | Value |
| :--- | :--- |
| **Root directory** | `apps/web` |
| **Build command** | `npm ci && npm run build` |
| **Build output directory** | `out` |
| **Node.js version (`NODE_VERSION`)** | `20` or `24` |

### Required Build Environment Variables (Public Only)

| Variable | Production Value | Notes |
| :--- | :--- | :--- |
| `CLOUDFLARE_PAGES` | `1` | Switches `next.config.mjs` to `output: 'export'` with `images: { unoptimized: true }` |
| `NEXT_PUBLIC_SITE_URL` | `https://muxaro.app` | Canonical metadata, OpenGraph, `robots.txt`, `sitemap.xml` |
| `NEXT_PUBLIC_API_URL` | `https://api.muxaro.app` | Public Fastify API origin |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | *(optional `G-...`)* | Leave empty to keep GA4 disabled |
| `NEXT_PUBLIC_GTM_CONTAINER_ID` | *(optional `GTM-...`)* | Leave empty to keep GTM disabled |

---

## 3. Edge Security Headers & Redirects

Cloudflare Pages automatically applies `apps/web/public/_headers` and `apps/web/public/_redirects` (copied into `apps/web/out/` at build time):

### 3.1 `_headers`
- **Global Security Headers (`/*`):**
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
- **Immutable & Brand Asset Caching:**
  - `/_next/static/*`: `Cache-Control: public, max-age=31536000, immutable`
  - `/brand/*`: `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`
- **Search Engine Privacy (`X-Robots-Tag: noindex, nofollow`):** Applied to `/account`, `/admin`, `/dashboard`, `/credits`, `/login`, `/register`, `/verify-email`, `/reset-password` and their subpaths.

### 3.2 `_redirects`
Forces permanent `301` canonicalization to apex HTTPS:
```text
https://www.muxaro.app/* https://muxaro.app/:splat 301
http://www.muxaro.app/* https://muxaro.app/:splat 301
http://muxaro.app/* https://muxaro.app/:splat 301
```

---

## 4. Cloudflare Zone Security & WAF Recommendations

When activating the `muxaro.app` zone in Cloudflare:
1. **SSL/TLS Encryption Mode:** Set strictly to **Full (Strict)** (see [SSL/TLS Guide](./SSL_TLS.md)).
2. **Always Use HTTPS & Automatic HTTPS Rewrites:** Enabled.
3. **Minimum TLS Version:** `TLS 1.2` (with `TLS 1.3` enabled).
4. **Rate Limiting / Bot Defense:** Add an edge WAF rate-limit rule on `api.muxaro.app/api/v1/auth/*` and `api.muxaro.app/api/v1/media/inspect` as an outer perimeter complement to the API's built-in `ratelimit.service.ts`.
5. **Emergency Shield:** `infra/scripts/emergency-shutdown.sh` supports toggling Cloudflare's `under_attack` security level automatically when `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_API_TOKEN` are provided.

---

## 5. Least-Privilege CI Token Scope

For automated deployments via GitHub Actions, create a Cloudflare API Token scoped **exclusively** to:
- `Account` → `Cloudflare Pages` → `Edit`
- *(Optional, only for emergency shutdown scripts)* `Zone` → `Zone Settings` → `Edit` on zone `muxaro.app`

Never use the Global API Key in CI/CD.
