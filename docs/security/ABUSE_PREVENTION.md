# MUXARO Abuse Prevention, Rate Limiting & Security Telemetry

**Primary Implementations:**
- `apps/api/src/services/ratelimit.service.ts` (Multi-layer sliding-window + token-bucket engine, duplicate flood detector, log redaction, `security_events` persistence)
- `apps/api/src/app.ts` (Pre-handler policy routing & duplicate mutation guard)
- `apps/api/src/services/rewards.service.ts` (GAM SSV anti-fraud & replay protection)
- `apps/api/src/services/admin.service.ts` & `apps/api/src/routes/admin.ts` (Triage, suspension, dynamic settings, immutable audit logs)
- `security/src/rate-limiter.ts` (Reusable route-level sliding-window rate limiter)

---

## 1. Separation of Rate Limits vs. Daily Quotas

MUXARO strictly separates **short-term abuse rate limits** (`ratelimit.service.ts`) from **rolling 24-hour user allowances** (`entitlements.service.ts`):
- Exceeding a burst rate limit returns HTTP `429 ERR_RATE_LIMIT_EXCEEDED` with `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` headers—**without** burning the user's daily job quota.
- Legitimate job status polling (`GET /api/v1/jobs/:id`, `GET /api/v1/batches/:id`), SSE progress streams, health probes, and downloads are **explicitly exempted** (`isExemptPollingRoute()`) from tight mutation throttling so active downloads and dashboards stay responsive.

---

## 2. Active Rate-Limiting Policies (`RATE_LIMIT_POLICIES`)

Evaluated atomically via `SqliteHybridRateLimitBackend` (backed by SQLite `rate_limit_counters` table with pluggable `RedisRateLimitClient` interface when `REDIS_URL` is configured):

| Policy | Endpoint(s) | Limit / Window | Dimension | Behaviour |
| :--- | :--- | :--- | :--- | :--- |
| **`login_account`** | `POST /api/v1/auth/login` | `5` failures / `15 min` | Account (HMAC-hashed) | Progressive temporary delay `[0, 1, 2, 4, 8, 15]s` + temporary cooldown; **never permanent DoS lockout** |
| **`login_ip`** | `POST /api/v1/auth/login` | `20` / `15 min` | Client IP (HMAC-hashed) | Logs `BRUTE_FORCE` (`HIGH`) on trigger |
| **`register_ip`** | `POST /api/v1/auth/register` | `10` / `15 min` | Client IP | Blocks automated account creation floods |
| **`auth_recovery`** | `forgot-password`, `reset-password`, `verify-email`, `resend-verification` | `10` / `15 min` | Client IP | Prevents token guessing & email bombing |
| **`media_inspect`** | `POST /api/v1/media/inspect` | `10` / `1 min` | Account / Actor | Protects outbound inspection & `ffprobe`/`yt-dlp` resources |
| **`job_create`** | `POST /jobs`, `/batches`, `/tools/merge`, `/playlists/process` | `5` / `1 min` | Account / Actor | Throttles rapid job/batch enqueue bursts |
| **`upload_init`** | `POST /media/upload`, `/media/upload/init` | `5` / `1 min` | Account / Actor | Protects upload storage I/O |
| **`job_cancel`** | `POST /jobs/:id/cancel`, `/batches/:id/cancel` | `10` / `1 min` | Account / Actor | Prevents cancel-spam amplification |
| **`reward_claim`** | `POST /api/v1/rewards/sessions` | `1` active / `5 min` | Active claim per user | Prevents parallel reward farming |
| **`admin_api`** | `/api/v1/admin/*` (protected) | `60` / `1 min` | Admin user ID | Protects admin control plane |

---

## 3. Defense-in-Depth Abuse Controls

| Abuse Vector | Implemented Control | Logged `security_events` Type |
| :--- | :--- | :--- |
| **Credential Stuffing & Brute Force** | Dual `login_ip` (`20/15m`) + `login_account` (`5 failures/15m`, progressive delay `[0,1,2,4,8,15]s`); generic login error prevents account enumeration | `BRUTE_FORCE` (`HIGH`) |
| **Duplicate Mutation Flooding** | `checkDuplicateFlood()` hashes request bodies (`POST`/`PATCH`/`DELETE`, excluding binary uploads, login, and GAM callbacks) and blocks identical burst floods with `429` + `Retry-After` | `DUPLICATE_FLOOD` (`WARN`) |
| **Burst / Scraper Flooding** | Sliding-window + token-bucket policies (`RATE_LIMIT_POLICIES`) + repeated spike detector (`trackRateLimitSpike`) | `RATE_LIMIT_SPIKE` (`WARN`/`HIGH`) |
| **Cross-Account IDOR** | `isOwnerOrAdmin()` ownership verification on every job, batch, download, reward session, and device session | `IDOR_ATTEMPT` (`WARN`) |
| **Rewarded Ad Fraud & Replay** | ECDSA-SHA256 verification against Google verifier keys (`gstatic.com/admob/reward/verifier-keys.json`), HMAC-SHA256 bound `custom_data`, `UNIQUE(provider_transaction_id)` in `reward_provider_events`, max 1 active claim, daily cap `3 / 24h` | `REWARD_REPLAY` (`HIGH`) |
| **CSRF Violations** | `verifyCsrf()` synchronizer + double-submit validation (`x-muxaro-csrf` vs session token & `muxaro_csrf` cookie) | `CSRF_REJECTED` / `CSRF_VIOLATION` |
| **Unauthorized Admin / MFA Bypass** | `requireAdminMfa` enforcing `role === 'admin'` AND verified RFC 6238 TOTP MFA | `ADMIN_ACCESS_DENIED`, `ADMIN_MFA_REQUIRED`, `MFA_FAILURE` |
| **SSRF / Internal Network Probing** | Dual-layer CIDR, IPv6, obfuscated IP, metadata host, port, and DNS rebinding validation | `SSRF_BLOCKED` (`HIGH`) |

---

## 4. Telemetry Redaction & Privacy Policy

All structured logs, error responses, and `security_events` rows pass through `redactSensitiveData()` (`apps/api/src/services/ratelimit.service.ts`):
- **Sensitive Key Masking:** Keys matching `password`, `token`, `secret`, `authorization`, `cookie`, `csrf`, `api_key`, `signature`, `jwt`, `session_id`, `code_verifier`, `backup_codes`, `private`, `credential`, `raw_url`, `media_url`, `source_url`, `audio_url`, `video_url` are replaced with `"[REDACTED]"`.
- **Value Scrubbing:** `Bearer <token>` → `"Bearer [REDACTED]"`; email strings → masked (`ab***@domain.com`); arbitrary HTTP(S) URLs → `scheme://host/[REDACTED_PATH]`; long strings capped at 512 chars.
- **IP Truncation:** Client IPs stored in `security_events.ip_prefix` and `user_sessions.ip_prefix` are truncated via `truncateIpPrefix()` to `/24` (IPv4) or `/48` (IPv6). Raw emails and IPs in `rate_limit_counters` are stored strictly as keyed HMAC-SHA256 digests (`hashBucketDimension()`).

---

## 5. Incident Response & Operational Controls

MFA-authenticated administrators can contain active abuse directly via `/admin` (backed by `/api/v1/admin/*`):
1. **Correlated Triage:** `GET /api/v1/admin/search?q=<MXR-|MXB-|MXJ-|req_>` correlates account state, batches, jobs, and security events.
2. **Immediate Containment:** `POST /api/v1/admin/users/:publicUserId/revoke-sessions` or `/suspend` revokes all active sessions atomically inside a database transaction and writes an immutable `admin_audit_logs` record.
3. **Real-Time Guardrail Tuning:** `PATCH /api/v1/admin/settings` dynamically updates concurrency caps, upload/playlist limits, daily quotas, or disables rewarded ads globally (`rewarded_ads_enabled: false`).
4. **Infrastructure Traffic Halt:** For severe DDoS or billing spikes, operators can execute `./infra/scripts/emergency-shutdown.sh` (see [Rollback Runbook](../deployment/ROLLBACK.md)).
