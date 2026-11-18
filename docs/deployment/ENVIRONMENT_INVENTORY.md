# MUXARO Environment Variable Inventory
**Product:** MUXARO — *Your Media. One Powerful Workspace.*  
**Author:** AGENT 01 — Principal Architect & System Designer  
**Date:** 18 November 2026  
**Security Policy:** Every variable below is verified directly against `apps/api/` and `apps/web/` source code. **Zero literal secrets or placeholder credentials are invented or committed.**

---

## 1. Frontend Public Build-Time Variables (`NEXT_PUBLIC_*` — Safe for Browser Bundle)

| Variable | Required in Prod | Default / Unset Behavior | Used In | Purpose |
| :--- | :---: | :--- | :--- | :--- |
| `NEXT_PUBLIC_SITE_URL` | **Yes** | `https://muxaro.app` | `apps/web/app/layout.tsx`, `robots.ts`, `sitemap.ts` | Canonical site origin for metadataBase, OpenGraph, robots, and sitemap |
| `NEXT_PUBLIC_API_URL` | **Yes** | Relative `/api/v1` (browser) | `apps/web/lib/api-client.ts`, `auth-context.tsx` | Public API origin (`https://api.muxaro.app`) for cross-origin cookie-authenticated API calls |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Optional | No-op (zero scripts loaded) | `apps/web/lib/analytics.ts`, `AnalyticsProvider.tsx` | Official Google Analytics 4 Measurement ID (`G-...`), gated behind Consent Mode v2 |
| `NEXT_PUBLIC_GTM_CONTAINER_ID` | Optional | No-op | `apps/web/lib/analytics.ts` | Optional Google Tag Manager container ID (`GTM-...`) |

## 2. Frontend Build-Only Variables (Never Bundled Into Browser)

| Variable | Required in Prod | Default | Used In | Purpose |
| :--- | :---: | :--- | :--- | :--- |
| `CLOUDFLARE_PAGES` | **Yes** (Pages build) | Unset (standard Next.js build) | `apps/web/next.config.mjs` | Set to `1` to enable `output: 'export'` + `images: { unoptimized: true }` into `apps/web/out/` |
| `API_INTERNAL_URL` | Local SSR only | `http://127.0.0.1:4000` | `apps/web/next.config.mjs`, `api-client.ts` | Server-side proxy target during local development only |

---

## 3. API Server Runtime & Networking Variables (`apps/api` — Non-Secret Config)

| Variable | Required in Prod | Default | Source File | Purpose |
| :--- | :---: | :--- | :--- | :--- |
| `NODE_ENV` | **Yes** (`production`) | `development` | `config.ts`, `auth.middleware.ts` | Enables `Secure` cookies, strict production config checks, disables dev outbox sink |
| `PORT` | **Yes** (Cloud Run sets `8080`) | `4000` | `config.ts`, `index.ts` | HTTP listen port |
| `HOST` | **Yes** (`0.0.0.0`) | `0.0.0.0` | `config.ts` | Bind address inside container |
| `CORS_ORIGIN` | **Yes** (`https://muxaro.app`) | `*` (dev) | `config.ts`, `app.ts` | Exact allowed frontend origin for `credentials: true` cookies |
| `SITE_URL` / `FRONTEND_URL` | **Yes** (`https://muxaro.app`) | — | `config.ts`, `auth.service.ts` | Canonical frontend URL for OAuth redirects & verification links |
| `BASE_URL` | **Yes** (`https://api.muxaro.app`) | — | `config.ts`, `routes/jobs.ts` | Public API base URL for signed download redirects |
| `TRUST_PROXY` | **Yes** (`true`) | `false` | `config.ts`, `app.ts` | Trust `X-Forwarded-For` / `X-Forwarded-Proto` behind Cloudflare + Cloud Run |
| `MAX_PAYLOAD_BYTES` | Optional | `2147483648` (2 GB) | `config.ts`, `app.ts` | Max request body limit |
| `WORKER_CONCURRENCY` | Optional | `4` | `config.ts`, `queue.service.ts` | Worker concurrency ceiling |
| `RATE_LIMIT_ENABLED` | **Yes** (`true`) | `true` | `ratelimit.service.ts` | Enables multi-layer rate limiter |
| `STORAGE_DIR` / `MUXARO_DB_PATH` | Local dev only | `.muxaro-artifacts` / `.muxaro-data/muxaro.db` | `database.ts`, `queue.service.ts` | Ephemeral/local SQLite & scratch paths |

---

## 4. Server Secrets (GCP Secret Manager / GitHub Secrets — NEVER Commit or Prefix `NEXT_PUBLIC_`)

| Variable | Required in Prod | Unset Behavior | Used In | Purpose |
| :--- | :---: | :--- | :--- | :--- |
| `SESSION_SECRET` | **Yes** (≥32 random bytes) | Dev fallback warning | `auth.service.ts` | HMAC signing for session/CSRF/custom_data bindings |
| `SIGNED_TOKEN_SECRET` | **Yes** (≥32 random bytes) | Dev fallback warning | `token.service.ts` | HMAC-SHA256 signing for time-limited download tokens |
| `MFA_ENCRYPTION_KEY` | **Yes** (32-byte hex/base64) | Ephemeral dev key | `mfa.service.ts` | AES-256-GCM encryption at rest for Admin TOTP secrets |
| `DATABASE_URL` | **Yes** (Postgres prod) | Falls back to local SQLite WAL | `config.ts`, `infra/scripts/run-migrations.sh` | PostgreSQL connection string (`sslmode=require`) |
| `REDIS_URL` | Optional | DB/memory rate-limit backend | `config.ts`, `ratelimit.service.ts` | Optional managed Redis for multi-instance rate-limiting & queues |
| `R2_ACCOUNT_ID` | **Yes** (R2 mode) | Local disk storage mode | `storage.service.ts`, `config.ts` | Cloudflare Account ID for R2 S3 endpoint |
| `R2_ACCESS_KEY_ID` | **Yes** (R2 mode) | Local disk storage mode | `storage.service.ts`, `config.ts` | R2 API token Access Key ID (scoped to single bucket) |
| `R2_SECRET_ACCESS_KEY` | **Yes** (R2 mode) | Local disk storage mode | `storage.service.ts`, `config.ts` | R2 API token Secret Access Key for AWS SigV4 signing |
| `R2_BUCKET_NAME` | **Yes** (R2 mode) | Local disk storage mode | `storage.service.ts`, `config.ts` | Target R2 bucket name (e.g., `muxaro-media-prod`) |
| `R2_ENDPOINT` / `R2_PUBLIC_ENDPOINT` | Optional | Derived from `R2_ACCOUNT_ID` | `storage.service.ts` | Custom S3-compatible endpoint override |
| `GOOGLE_CLIENT_ID` | Optional | Returns `503 ERR_GOOGLE_AUTH_NOT_CONFIGURED` | `auth.service.ts` | Google OAuth 2.0 Web Client ID |
| `GOOGLE_CLIENT_SECRET` | Optional | Returns `503` | `auth.service.ts` | Google OAuth 2.0 Web Client Secret |
| `GOOGLE_REDIRECT_URI` | Optional | Returns `503` | `auth.service.ts` | Exact callback URI (`https://api.muxaro.app/api/v1/auth/google/callback`) |
| `GAM_REWARDED_AD_UNIT_PATH` | Optional | `configured: false` (UI hidden) | `rewards.service.ts` | Google Ad Manager rewarded ad unit path |
| `GAM_SSV_KEY_URL` | Optional | Official Google verifier keys URL | `rewards.service.ts` | Google SSV public key JSON endpoint |
| `REWARDED_ADS_ENABLED` | Optional | `false` | `rewards.service.ts` | Master feature flag for rewarded ads |
| `REWARD_SESSION_TTL_SECONDS` | Optional | `900` (15m) | `rewards.service.ts` | Pending reward session expiry |
| `GAM_SSV_PUBLIC_KEY_PEM` / `GAM_SSV_TEST_KEY_ID` | Test only | Unused in prod | `rewards.service.ts` | Deterministic offline ECDSA test key override (never set in prod) |
| `MUXARO_ADMIN_EMAIL` | **Yes** (initial bootstrap) | No auto-admin promotion | `auth.service.ts`, `admin.service.ts` | Idempotent bootstrap email for initial admin account (requires TOTP MFA) |
| `SMTP_HOST` | Optional | Local dev writes `dev-outbox.jsonl` | `auth.service.ts` | Transactional email relay for verification & password reset |
