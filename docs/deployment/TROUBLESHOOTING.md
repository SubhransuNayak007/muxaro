# MUXARO Deployment & Operations Troubleshooting Guide

Use this reference to diagnose common local setup, build, authentication, media processing, storage, and cloud deployment issues.

---

## 1. Local Startup & Runtime Issues

### `Cannot find module 'node:sqlite'` on `apps/api` startup
- **Cause:** Running Node.js `< 22.5` (e.g., Node 18 or 20). `apps/api/src/db/database.ts` requires Node.js 24's built-in `node:sqlite` (`DatabaseSync`).
- **Fix:** Switch to Node 24 LTS (`node -v` should show `v24.x`).

### `GET /api/v1/ready` returns `503 DEGRADED` with `"ffmpegAvailable": false`
- **Cause:** `ffmpeg` is not installed or not discoverable in `PATH` (`apps/api/src/routes/health.ts` runs `ffmpeg -version`).
- **Fix:** Install FFmpeg and FFprobe, open a new shell, confirm `ffmpeg -version` succeeds, and wait up to 60 seconds (or restart `apps/api` to clear the 60s probe cache).

### `npm install` fails in repository root (`ENOENT: package.json`)
- **Cause:** MUXARO does not use a root `package.json`; apps and packages manage dependencies individually.
- **Fix:** Install inside `apps/api`, `apps/web`, `apps/media-worker`, and `packages/entitlements` directly (see [Local Setup](./LOCAL_SETUP.md)).

---

## 2. Authentication, Cookies & CSRF Issues

### `403 ERR_CSRF_INVALID` on `POST` / `PATCH` / `DELETE`
- **Cause:** A cookie-authenticated mutating request omitted the `x-muxaro-csrf` header or sent a token that did not match the session's `csrf_token` / `muxaro_csrf` cookie (`apps/api/src/middleware/auth.middleware.ts`).
- **Fix:** Ensure `credentials: 'include'` is set and `x-muxaro-csrf` carries the value from `muxaro_csrf` cookie or `GET /api/v1/auth/session`.

### Cookies Not Persisting Between `muxaro.app` and `api.muxaro.app`
- **Cause:** `serializeCookie()` in `apps/api/src/middleware/auth.middleware.ts` issues host-only cookies by default (`SameSite=Lax`, no `Domain` attribute).
- **Fix:** Either proxy `/api/v1/*` on the same origin (`https://muxaro.app/api/v1/*`) via Cloudflare or configure explicit `Domain=.muxaro.app` + `CORS_ORIGIN=https://muxaro.app` + `TRUST_PROXY=true`.

### `403 ERR_ADMIN_MFA_REQUIRED` on `/api/v1/admin/*`
- **Cause:** All admin management endpoints enforce `requireAdminMfa` (valid `admin` role **and** verified RFC 6238 TOTP MFA on the active session).
- **Fix:** Complete `POST /api/v1/auth/mfa/setup` and `POST /api/v1/auth/mfa/verify` on `/account` with a 6-digit authenticator code.

### `503 ERR_GOOGLE_AUTH_NOT_CONFIGURED` on `/api/v1/auth/google/start`
- **Cause:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, or `GOOGLE_REDIRECT_URI` is empty.
- **Fix:** This is intentional fail-closed behavior. Configure all three variables with real Google Cloud OAuth Web Client credentials to enable Google Sign-In.

---

## 3. Media Processing, Upload & SSRF Issues

### `403 SSRF_BLOCKED` when inspecting a URL
- **Cause:** The target URL resolved to a loopback, RFC 1918 private, link-local, CGNAT, cloud metadata (`169.254.169.254`), blocked port, or non-HTTP(S) address (`security/src/ssrf-guard.ts`).
- **Fix:** Only public `http://` and `https://` media URLs on ports `80`/`443` are permitted. Do not disable SSRF guards in production.

### `413 ERR_FILE_TOO_LARGE` during local upload
- **Cause:** Upload exceeded the streaming `MAX_UPLOAD_BYTES` limit (`2 GiB`) in `apps/api/src/routes/media.ts`.
- **Fix:** Compress or trim files above 2 GiB before uploading.

### `416 ERR_RANGE_NOT_SATISFIABLE` on download resume
- **Cause:** The client sent an out-of-bounds byte range or resumed against an expired/regenerated artifact (`apps/api/src/routes/download.ts`).
- **Fix:** Start a fresh download without a stale `Range` header. Note that artifacts expire after `60` minutes (`DEFAULT_RETENTION_MINUTES`).

---

## 4. Cloud Deployment & TLS Issues

### `api.muxaro.app` Cloud Run TLS Certificate Stuck in `Pending`
- **Cause:** Cloudflare `api` CNAME was switched to **Proxied (Orange Cloud)** before Google finished ACME certificate validation.
- **Fix:** Temporarily set `api` CNAME to **DNS Only (Grey Cloud)** until `gcloud beta run domain-mappings describe --domain=api.muxaro.app` reports `CertificateProvisioned: True`, then re-enable **Proxied** with Cloudflare SSL/TLS mode set to **Full (Strict)**.

### Cloudflare `525 SSL Handshake Failed` or `526 Invalid SSL Certificate`
- **Cause:** Cloudflare SSL/TLS mode is **Full (Strict)** while the origin certificate on `api.muxaro.app` is missing or mismatched.
- **Fix:** Verify the Cloud Run domain mapping certificate status; never downgrade Cloudflare to `Flexible`.

### `validateProductionConfig()` Errors on Startup (`NODE_ENV=production`)
- **Cause:** Default development secrets (`SESSION_SECRET` / `SIGNED_TOKEN_SECRET` < 32 chars) or `localhost` URLs are present in production (`apps/api/src/config.ts`).
- **Fix:** Inject 64-char hex CSPRNG secrets via Google Secret Manager and set `BASE_URL=https://api.muxaro.app`, `SITE_URL=https://muxaro.app`, `CORS_ORIGIN=https://muxaro.app`.

### Supabase Free Database Unresponsive After Idle Period
- **Cause:** Supabase Free pauses databases after 7 consecutive days of inactivity.
- **Fix:** Resume the project in the Supabase dashboard and consider upgrading to Supabase Pro or Cloud SQL for always-on production hosting.
