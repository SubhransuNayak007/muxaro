# Rate Limiting & Abuse Prevention Architecture

**Project:** MUXARO  
**Implementations:** `apps/api/src/services/ratelimit.service.ts`, `apps/api/src/app.ts`, `security/src/rate-limiter.ts`

---

## 1. Separation of Concerns: Rate Limiting vs. Daily Quotas

MUXARO intentionally separates **anti-abuse rate limiting** from **account usage quotas**:

| Dimension | Rate Limiting (`ratelimit.service.ts`) | Usage Quotas (`entitlements.service.ts`) |
| :--- | :--- | :--- |
| **Purpose** | Prevent brute force, endpoint flooding, and infrastructure DoS | Fair multi-tenant compute allowance (Free/Guest/Premium) |
| **Time Horizon** | Short bursts (10 seconds to 15 minutes) | Rolling 24-hour sliding window |
| **HTTP Status** | `429 Too Many Requests` (`ERR_RATE_LIMIT_EXCEEDED`) | `409 Conflict` (`ERR_QUOTA_EXCEEDED`) |
| **Backing Store** | `rate_limit_counters` table + in-memory token buckets | `quota_reservations`, `entitlements`, `credit_ledger` |
| **Refundable?** | No (time-window recovery) | Yes — cancelled or failed jobs immediately release quota |

---

## 2. Multi-Layer Rate Limit Policies (`RATE_LIMIT_POLICIES`)

Defined in `apps/api/src/services/ratelimit.service.ts` and enforced globally in `apps/api/src/app.ts` (`preHandler`), `auth.service.ts`, and `admin.ts`:

| Policy Name | Endpoint(s) Covered | Limit | Window | Dimension | Special Behavior |
| :--- | :--- | :---: | :---: | :--- | :--- |
| `login_account` | `POST /api/v1/auth/login` (failures) | **5** | 15 min (900s) | Account (email hash) | Progressive backoff delays `[0, 1, 2, 4, 8, 15]`s; **never permanent DoS lockout** |
| `login_ip` | `POST /api/v1/auth/login` | **20** | 15 min (900s) | Client IP | Pre-verification brute-force gate |
| `register_ip` | `POST /api/v1/auth/register` | **10** | 15 min (900s) | Client IP | Account creation flood defense |
| `auth_recovery` | `POST /auth/forgot-password`, `/reset-password`, `/verify-email`, `/resend-verification` | **10** | 15 min (900s) | Client IP | Prevents code/email flooding |
| `media_inspect` | `POST /api/v1/media/inspect` | **10** | 1 min (60s) | Account / Guest / IP | Protects outbound inspection egress |
| `job_create` | `POST /jobs`, `/batches`, `/tools/merge`, `/playlists/process` | **5** | 1 min (60s) | Account / Guest / IP | Protects queue ingress |
| `upload_init` | `POST /media/upload`, `/media/upload/init` | **5** | 1 min (60s) | Account / Guest / IP | Protects disk I/O ingress |
| `job_cancel` | `POST /jobs/:id/cancel`, `/batches/:id/cancel` | **10** | 1 min (60s) | Account / Guest / IP | Prevents cancel spam |
| `reward_claim` | `POST /api/v1/rewards/sessions` | **1 active** | 5 min (300s) | Active DB `PENDING` row | Queries `reward_sessions` directly; blocks parallel claims |
| `admin_api` | Protected `/api/v1/admin/*` routes | **60** | 1 min (60s) | Admin User ID | Applied in `adminGuard` after MFA verification |

### Route-Level `@muxaro/security` `RateLimiter` Hooks
In addition to the global `RateLimitService` policies above, route handlers in `media.ts`, `jobs.ts`, `batches.ts`, `playlists.ts`, `tools.ts`, and `download.ts` attach secondary in-memory sliding-window hooks from `security/src/rate-limiter.ts`:
- `inspect`: 15 req / 60s
- `createJob`: 10 req / 60s
- `download`: 20 req / 60s

---

## 3. Hybrid Sliding-Window + Token-Bucket Algorithm

`SqliteHybridRateLimitBackend` combines exact sliding-window timestamp logs with a continuous-refill token bucket persisted atomically in SQLite (`rate_limit_counters`):

1. **Key Hashing (Privacy):** Bucket keys are formatted as `<policyName>:<HMAC-SHA256(sessionSecret, dimensionKey).slice(0, 24)>` so raw IPs and emails are never written to `rate_limit_counters`.
2. **Atomic Transaction (`BEGIN IMMEDIATE`):** Reads `hits`, `window_start_ms`, `window_ms`, and `blocked_until_ms` from `rate_limit_counters`.
3. **Restart Survival:** If an in-memory sliding log is empty after a process restart, it seeds timestamps from the persisted SQLite `rate_limit_counters` row so rate limits survive restarts.
4. **Dual Check:** A request is allowed only if `activeTimestamps.length < limit` **AND** `tokenBucket.tokens >= 1`.
5. **Garbage Collection:** A 60-second `.unref()` timer prunes expired entries older than 1 hour from both RAM maps and `rate_limit_counters`.
6. **Distributed Interface *(Planned)*:** `RedisRateLimitClient` is defined in `ratelimit.service.ts` for swapping to atomic Redis Lua execution when `REDIS_URL` is wired in multi-node deployments.

---

## 4. Duplicate Mutation Flood Protection

In `apps/api/src/app.ts` (`preHandler`), JSON mutation requests (`POST`, `PATCH`, `DELETE`)—excluding `/auth/login`, `/rewards/provider-callback`, and `/media/upload*`—are fingerprinted by `HMAC-SHA256(JSON.stringify(body))`:
- More than **8 identical requests within 10 seconds** from the same actor to the same endpoint triggers:
  - HTTP `429 ERR_RATE_LIMIT_EXCEEDED` with `Retry-After: 10`.
  - A redacted `DUPLICATE_FLOOD` row in `security_events`.

---

## 5. Polling & Health Route Exemptions

To ensure long-running 4K/8K transcode status monitors and SSE streams never trigger false-positive `429` errors, `isExemptPollingRoute()` explicitly bypasses global rate limiting for `GET`, `HEAD`, and `OPTIONS` requests on:
- `/api/v1/health`, `/api/v1/ready`
- `/api/v1/auth/session`
- `/api/v1/admin/metrics`
- `/api/v1/rewards/config`
- `/api/v1/jobs/:id` and `/api/v1/jobs/:id/events`
- `/api/v1/batches/:id` and `/api/v1/batches/:id/jobs`
- `/api/v1/playlists/jobs/:id`
- `/api/v1/download/:token`
- `/docs*`

---

## 6. Standard Response Headers & Security Telemetry

Every policy evaluation injects RFC-aligned headers:
- `RateLimit-Limit: <max>`
- `RateLimit-Remaining: <remaining>`
- `RateLimit-Reset: <seconds>`
- `Retry-After: <seconds>` (attached whenever HTTP `429` is returned)

When rate-limit denials spike, `RateLimitService` records `RATE_LIMIT_SPIKE` or `BRUTE_FORCE` events in `security_events` with `/24` IPv4 (or `/48` IPv6) network prefixes and zero leaked tokens or internal risk scores.
