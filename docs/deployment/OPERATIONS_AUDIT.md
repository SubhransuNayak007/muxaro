# MUXARO Platform Operations Audit & Reliability Runbook

**Document Version:** 2.0.0  
**Environment Scope:** `apps/web` (Next.js / Cloudflare Pages) & `apps/api` (Fastify / Cloud Run)  
**Auditor:** Operations Lead  
**Audit Date:** 2026-11-19  
**Status:** **VERIFIED & OPERATIONAL (PASS)**  

---

## 1. Executive Summary

This operational audit evaluates runtime environment configurations, session cookies, guest session tokens, CSRF synchronizer tokens, operational telemetry, and background daemon resilience across local development and Cloudflare Pages edge deployments.

All operational verification gates passed with **0 errors and 0 uncaught exceptions**:
- **API Integration Suite (`tests/integration/api-integration.test.ts`):** 14 / 14 PASS (0 fail)
- **Operations Telemetry & Session Suite (`tests/integration/operations-telemetry-session.test.ts`):** 6 / 6 PASS (0 fail)
- **Process Guarding:** Process-level `uncaughtException` and `unhandledRejection` handlers active in `apps/api/src/index.ts` with zero unhandled fatal exits.

---

## 2. Runtime Environment Configuration Audit

### 2.1 Frontend Configuration (`apps/web`)

| Variable | Local Development | Cloudflare Pages Export (`CLOUDFLARE_PAGES=1`) | Purpose / Impact |
| :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | `https://muxaro.app` (or `https://muxaro.pages.dev`) | Canonical web origin for SEO, OG tags, and sitemaps. |
| `NEXT_PUBLIC_API_URL` | *(empty)* | *(empty)* | **Critical Fix**: Kept empty in client builds so browser always routes to same-origin `/api/v1`. Eliminates `net::ERR_NAME_NOT_RESOLVED`. |
| `API_INTERNAL_URL` | `http://127.0.0.1:4000` | N/A (static export) | Server-side SSR/SSG fallback; never baked into client bundles. |
| `CLOUDFLARE_PAGES` | `0` (or unset) | `1` | Triggers Next.js `output: 'export'` and unoptimized images for static bundle in `out/`. |
| `wrangler.toml` | N/A | `name = "muxaro"`, `pages_build_output_dir = "out"`, `compatibility_date = "2026-04-01"` | Cloudflare Pages deployment manifest. |

### 2.2 Backend Configuration (`apps/api`)

| Variable | Local Development | Cloud Run Production | Purpose / Impact |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | `development` | `production` | Enforces 32+ char cryptographic secrets and strict security validations. |
| `PORT` | `4000` | `4000` (or `$PORT` assigned by Knative) | HTTP listen port. |
| `HOST` | `0.0.0.0` | `0.0.0.0` | Ingress bind address. |
| `SESSION_SECRET` | Dev fallback key | Secret Manager secret (64-char hex) | HMAC SHA-256 session token hashing key. |
| `SIGNED_TOKEN_SECRET` | Dev fallback key | Secret Manager secret (64-char hex) | HMAC SHA-256 download token signing key. |
| `CORS_ORIGIN` | `http://localhost:3000` | `https://muxaro.app,https://muxaro.pages.dev` | Controls allowed browser origins with credentials support. |
| `STORAGE_DIR` | `./storage/scratch` | `/tmp/muxaro-scratch` (mode 0700) | Local scratch directory for video processing. |
| `STORAGE_MODE` | `local` | `r2` (when configured) or `local` container scratch | Ephemeral artifact storage provider. |
| `RATE_LIMIT_ENABLED` | `true` | `true` | Multi-layer IP, token bucket, and flood protection. |

---

## 3. Session, Cookie & CSRF Architecture

### 3.1 Cookie Specifications & Parity Matrix

All cookies are standardized across local development and Cloudflare Pages:

| Cookie Name | Purpose | Value Format | Flags (Local Dev) | Flags (Production / Cloudflare) |
| :--- | :--- | :--- | :--- | :--- |
| `muxaro_session` | Authenticated session token | 64-char random hex | `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` | `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000; Secure` |
| `muxaro_guest` | Anonymous visitor quota isolation | `guest_<16-64 hex>` | `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` | `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000; Secure` |
| `muxaro_csrf` | Synchronizer double-submit token | 32-64 char random hex | `SameSite=Lax; Path=/; Max-Age=2592000` *(no HttpOnly)* | `SameSite=Lax; Path=/; Max-Age=2592000; Secure` *(no HttpOnly)* |
| `muxaro_oauth_state` | Google OAuth 2.0 PKCE state | Base64 URL-safe state | `HttpOnly; SameSite=Lax; Path=/; Max-Age=600` | `HttpOnly; SameSite=Lax; Path=/; Max-Age=600; Secure` |

### 3.2 Consistency Between Local Development and Cloudflare Pages

1. **Same-Origin Guarantee**:
   - In local development, Next.js rewrites `/api/v1/:path*` to `http://127.0.0.1:4000/api/v1/:path*`.
   - On Cloudflare Pages, Cloudflare Pages Functions (`functions/api/v1/*`) route same-origin `/api/v1/*` requests directly on Edge.
   - Because both environments use same-origin `/api/v1`, browsers treat all cookies as first-party (`SameSite=Lax`), preventing third-party cookie blocking.
2. **Dynamic `Secure` Flag**:
   - In local HTTP development (`http://localhost:3000`), the `Secure` flag is automatically omitted so browser cookies persist on localhost.
   - Behind HTTPS reverse proxies (Cloudflare, Cloud Run, `x-forwarded-proto: https`), the `Secure` flag is automatically added.
3. **Double-Submit CSRF Protection**:
   - State-mutating routes (`POST`, `PUT`, `PATCH`, `DELETE`) require the `x-muxaro-csrf` HTTP header.
   - The server validates that `x-muxaro-csrf` matches both the server-side session token and the `muxaro_csrf` cookie using timing-safe comparison.

---

## 4. Operational Telemetry & Observability

### 4.1 Request Tracing (`x-request-id`)
- Every request entering the system is stamped with a unique trace identifier (`req_<16 hex chars>` or UUIDv7).
- The `x-request-id` is returned in response headers and the standard JSON envelope (`requestId`).
- Client-side error logs and telemetry events correlate directly with server-side logs via this identifier.

### 4.2 Structured Redacted Telemetry
- Fastify `onResponse` and `onError` hooks automatically redact passwords, API tokens, session secrets, and credentials before writing error events to stdout/stderr.
- 5xx errors emit structured JSON events:
  ```json
  {"level":"error","event":"http_server_error","requestId":"req_...","method":"POST","path":"/api/v1/...","statusCode":500}
  ```

---

## 5. Background Daemons & Zero Uncaught Exception Verification

### 5.1 Daemon & Background Process Audit

| Subsystem | Daemon / Timer Mechanism | Failure Handling & Guardrails | Status |
| :--- | :--- | :--- | :--- |
| **API Entrypoint** | `apps/api/src/index.ts` | Process-level `uncaughtException` and `unhandledRejection` handlers active; structured redacted logging without process termination. | **PASS** |
| **Queue Service** | `setInterval(..., 3600000).unref()` | In-memory hourly statistics rollover; cannot throw. | **PASS** |
| **Artifact Expiration** | `setTimeout(..., ARTIFACT_TTL_MS).unref()` | 60-minute artifact cleanup wrapped in `try/catch` and `fsp.rm(...).catch(() => {})`. | **PASS** |
| **Process Execution** | Child process `spawn()` with timeout | Kill timer executes `proc.kill('SIGKILL')` wrapped in `try/catch`. | **PASS** |
| **Rate Limit GC** | `setInterval(..., 60000).unref()` | `gc()` runs with try/catch transaction protecting SQLite deletes. | **PASS** |
| **SSE Heartbeat** | `setInterval(..., 15000)` | `reply.raw.write()` wrapped in `try/catch` with automated cleanup on client disconnect. | **PASS** |
| **Multipart Uploads** | `setTimeout(..., MULTIPART_TTL_MS).unref()` | Session directory cleanup wrapped in `fsp.rm(...).catch(() => {})`. | **PASS** |

### 5.2 Test Execution Results

```text
▶ Operations Telemetry & Session Lifecycle Verification
  ✔ GET /api/v1/auth/session mints cryptographic guest session cookie and returns 200 unauthenticated payload (20.8854ms)
  ✔ GET /api/v1/auth/session preserves existing guest cookie across requests (1.0729ms)
  ✔ GET /api/v1/account/history returns 200 and empty job list for guest sessions with valid telemetry (2.3897ms)
  ✔ Cookie security flags enforce Secure attribute when behind HTTPS proxy (0.6963ms)
  ✔ Operational telemetry: every endpoint emits x-request-id and X-Content-Type-Options: nosniff (6.1421ms)
  ✔ Process-level exception handlers are registered and functional (0.1796ms)
✔ Operations Telemetry & Session Lifecycle Verification (449.1599ms)
ℹ tests 6
ℹ suites 1
ℹ pass 6
ℹ fail 0
```

---

## 6. Conclusion & Operational Recommendation

1. **Production Parity**: Same-origin `/api/v1` eliminates cross-origin DNS lookups (`api.muxaro.app`) while preserving first-party cookie handling across dev and Cloudflare Pages.
2. **Zero Uncaught Exceptions**: All background daemons, timers, and process listeners are guarded against unhandled promise rejections and uncaught exceptions.
3. **Operational Recommendation**: **GO (READY FOR DEPLOYMENT)**.
