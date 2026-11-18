# MUXARO Account Platform — Security & Abuse-Prevention Test Report

**Report Date:** 2026-11-18  
**Owner:** Workstream 4 (`secops`)  
**Scope:** Multi-Layer Rate Limiting (`apps/api/src/services/ratelimit.service.ts`), Administrator Control Centre (`apps/api/src/services/admin.service.ts`, `apps/api/src/routes/admin.ts`), Application Wiring & CORS/CSRF/Redaction (`apps/api/src/app.ts`), and Regression Verification (`tests/integration/api-integration.test.ts`).  
**Verdict:** **PASS (9 / 9 Security Verification Suites + 14 / 14 API Integration Tests)**

---

## 1. Executive Verification Summary

| Suite | Scope | Executed | Passed | Failed |
|---|---|---:|---:|---:|
| **Workstream 4 Security Verification (`verify-secops.ts`)** | CORS + CSRF, Public Redacted Metrics, Admin Bootstrap, Admin MFA Gate, Full Admin Control Centre & Audit Logs, Multi-Layer Rate Limits, Polling Exemption, Log Redaction | 9 | **9** | 0 |
| **Existing API Integration Regression (`tests/integration/api-integration.test.ts`)** | Health, Swagger, Media Inspect, SSRF Blocking, Job Lifecycle, Idempotency, Cancel Rollback, Merge, Rolling Quotas, Signed Downloads | 14 | **14** | 0 |
| **TypeScript Static Check (`tsc -p apps/api/tsconfig.json --noEmit`)** | All Workstream 4 owned files (`ratelimit.service.ts`, `admin.service.ts`, `routes/admin.ts`, `app.ts`) | 4 files | **0 errors** | 0 |

---

## 2. Detailed Security Verification Results

All tests below were executed against a real `buildApp()` Fastify instance backed by an isolated SQLite WAL database (`PRAGMA foreign_keys = ON`) with `RATE_LIMIT_ENABLED=true`.

| Test ID | Security Control Verified | Observed Empirical Result | Status |
|---|---|---|---|
| **SEC-01** | **CORS Credentials, Origin Reflection & CSRF Headers** | `OPTIONS /api/v1/admin/settings` with `Origin: http://localhost:3000` returned HTTP `204`, `Access-Control-Allow-Origin: http://localhost:3000`, `Access-Control-Allow-Credentials: true`, allowed `PATCH`, `x-muxaro-csrf`, `x-file-name`, and `Idempotency-Key`. | **PASS** |
| **SEC-02** | **Public Redacted Operational Metrics** | `GET /api/v1/admin/metrics` returned HTTP `200` with redacted queue/worker/uptime telemetry and `X-Content-Type-Options: nosniff` (preserving `/status` page compatibility without exposing internal secrets). | **PASS** |
| **SEC-03** | **Controlled Admin Bootstrap (`MUXARO_ADMIN_EMAIL`)** | Registering `member.secops@muxaro.test` created `user` (`MXR-6DHP466N`); registering `admin.secops@muxaro.test` promoted `role: admin` (`MXR-V8Q9SPNH`) solely via `MUXARO_ADMIN_EMAIL` with zero hardcoded backdoor passwords. | **PASS** |
| **SEC-04** | **Strict Admin Role & TOTP MFA Gating (`requireAdminMfa`)** | Unauthenticated `GET /api/v1/admin/users` -> HTTP `401`; regular member -> HTTP `403` (`ERR_ADMIN_REQUIRED`); admin without TOTP MFA verified -> HTTP `403` (`ERR_ADMIN_MFA_REQUIRED`). | **PASS** |
| **SEC-05** | **CSRF Double-Submit + Synchronizer Enforcement & RFC 6238 TOTP MFA** | Cookie-authenticated `POST /api/v1/auth/mfa/setup` without `x-muxaro-csrf` -> HTTP `403` (`ERR_CSRF_INVALID`). With valid `x-muxaro-csrf`, TOTP secret generated, real 6-digit RFC 6238 code verified, and `GET /api/v1/admin/users` returned HTTP `200` (`total=2`). | **PASS** |
| **SEC-06** | **Admin Control Centre API & Immutable Audit Trail** | Verified live HTTP `200` across `/admin/search?q=MXR-...`, `/admin/settings` (`GET` & `PATCH` with camelCase + snake_case keys and range validation), `/admin/users/:publicUserId/suspend` (revoked active sessions -> user's `/api/v1/me` immediately rejected with `401`), `/restore`, `/revoke-sessions`, `/admin/rewards`, `/admin/analytics`, `/admin/audit-logs` (5 immutable records including `SETTINGS_UPDATE`, `USER_SUSPEND`, `USER_RESTORE`, `USER_REVOKE_SESSIONS`), and `/admin/security-events` (6 redacted events). | **PASS** |
| **SEC-07** | **Multi-Layer Rate Limiting & Safe 429 Responses** | `POST /api/v1/media/upload/init` allowed 5/5 requests (`200`) and rejected the 6th with HTTP `429` (`ERR_RATE_LIMIT_EXCEEDED`, `Retry-After: 60`, zero risk-score leakage). Failed login brute-force rejected after 5 failures with HTTP `429` (`Retry-After: 900`). Active pending reward session blocked concurrent claim (`checkActiveRewardClaim` -> `allowed: false`, `retryAfterSeconds >= 1`). | **PASS** |
| **SEC-08** | **Polling & Progress Stream Exemption** | 60 rapid sequential polls (`30 × GET /api/v1/jobs/:id` + `30 × GET /api/v1/batches/:id`) produced **0** HTTP `429` responses, guaranteeing long-running 4K/8K jobs and playlists are never interrupted. | **PASS** |
| **SEC-09** | **Strict Log Redaction & IP Prefix Privacy** | `redactSensitiveData()` scrubbed passwords, `Bearer` JWTs, CSRF tokens, email addresses, and query-bearing private URLs. `truncateIpPrefix()` normalized IPv4 (`203.0.113.42` -> `203.0.113.0/24`), IPv4-mapped IPv6 (`::ffff:198.51.100.77` -> `198.51.100.0/24`), and IPv6 (`2001:db8:85a3:...` -> `2001:db8:85a3::/48`). Persisted SQLite `security_events` confirmed zero plaintext secret storage. | **PASS** |

---

## 3. Wired API Route Surface (`apps/api/src/app.ts`)

All 13 route plugins are registered cleanly under `/api/v1` with zero duplicate path collisions:

- `healthRoutes` (`/health`)
- `authRoutes` (`/auth/register`, `/auth/login`, `/auth/verify-email`, `/auth/resend-verification`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/session`, `/auth/logout`, `/auth/logout-all`, `/auth/google/start`, `/auth/google/callback`, `/auth/mfa/setup`, `/auth/mfa/verify`, `/auth/mfa/disable`)
- `meRoutes` (`/me`, `/me/identity`, `/me/sessions`, `/me/sessions/:sessionId`)
- `entitlementRoutes` (`/entitlements`, `/entitlements/usage`, `/credits`, `/credits/ledger`)
- `rewardRoutes` (`/rewards/config`, `/rewards/sessions`, `/rewards/sessions/:id`, `/rewards/sessions/:id/refresh`, `/rewards/provider-callback`)
- `batchRoutes` (`/batches`, `/batches/:id`, `/batches/:id/jobs`, `/batches/:id/cancel`)
- `mediaRoutes` (`/media/inspect`, `/media/upload`, `/media/upload/init`, `/media/upload/:uploadId/part/:partNumber`, `/media/upload/:uploadId/complete`, `/media/upload/:uploadId`, `/media/:id`)
- `jobRoutes` (`/jobs`, `/jobs/:id`, `/jobs/:id/events`, `/jobs/:id/cancel`, `/jobs/:id/retry`, `/jobs/:id/download`)
- `toolsRoutes` (`/tools/merge`)
- `playlistRoutes` (`/playlists/inspect`, `/playlists/process`, `/playlists/:id`)
- `accountRoutes` (`/account/credits`, `/account/history`)
- `adminRoutes` (`/admin/metrics` public redacted; `/admin/search`, `/admin/users`, `/admin/users/:publicUserId/suspend|restore|revoke-sessions`, `/admin/settings`, `/admin/rewards`, `/admin/analytics`, `/admin/audit-logs`, `/admin/security-events` gated by `requireAdminMfa`)
- `downloadRoutes` (`/download/:token`)

---

## 4. Residual Risks & Operational Recommendations

1. **Horizontal Scaling (`REDIS_URL`)**: Single-instance SQLite WAL transactions enforce atomic rate-limit counters cleanly for single-node deployments. Multi-replica production deployments should attach a Redis client implementing `RedisRateLimitClient` behind `REDIS_URL`.
2. **Reverse Proxy Trust (`TRUST_PROXY`)**: Keep `TRUST_PROXY` unset in direct local/dev environments; set `TRUST_PROXY=true` only when deployed behind a trusted edge WAF/ALB that overwrites `X-Forwarded-For`.
3. **Production Secret Hygiene**: Set strong random values for `SESSION_SECRET`, `SIGNED_TOKEN_SECRET`, and `MFA_ENCRYPTION_KEY`, and configure `CORS_ORIGIN` to explicit production origins rather than wildcard reflection.
