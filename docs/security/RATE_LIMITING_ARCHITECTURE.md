# MUXARO Multi-Layer Rate-Limiting Architecture

**Version:** 2.0 (Account Platform)  
**Owner:** Workstream 4 (`secops`)  
**Implementation:** `apps/api/src/services/ratelimit.service.ts`, `apps/api/src/app.ts`  
**Status:** Production Baseline

---

## 1. Architectural Separation: Rate Limits vs. Daily Quotas

MUXARO enforces a strict architectural separation between **anti-abuse rate limiting** and **user entitlement quotas**:

| Concern | Owner Module | Backing Store | Purpose | HTTP Status |
|---|---|---|---|---|
| **Multi-Layer Rate Limiting** | `apps/api/src/services/ratelimit.service.ts` | Hybrid SQLite (`rate_limit_counters`) + Sliding-Window/Token-Bucket (Redis-ready via `REDIS_URL`) | Prevent brute force, request floods, scraping bursts, and concurrency abuse | `429 Too Many Requests` + `Retry-After` |
| **Daily Rolling User Quotas** | `apps/api/src/services/entitlements.service.ts` | `entitlements`, `quota_reservations`, `credit_ledger` | Enforce product allowances (10 base individual jobs/24h, 1 playlist/24h, +2 per verified rewarded ad up to 3/24h) | `409 Conflict` (`ERR_QUOTA_EXCEEDED`) |

Rate-limiting decisions **never** modify `entitlements`, `quota_reservations`, or `credit_ledger`, and hitting a temporary `429` never burns a user's daily job quota.

---

## 2. Hybrid Algorithm: Sliding Window + Token Bucket

Fixed-window counters suffer from boundary-burst doubling (sending 2x the limit across a window rollover). MUXARO pairs two complementary checks inside an atomic transaction (`SqliteHybridRateLimitBackend.consume`):

1. **Sliding-Window Timestamp Log**: Tracks exact event timestamps within `[now - windowMs, now]`. Any request that would push the active window count past `limit` is rejected immediately with `Retry-After` derived from the oldest active timestamp in the window.
2. **Continuous Token Bucket**: Refills continuously at `limit / windowSeconds` tokens per second up to `burstCapacity = limit`, smoothing sustained traffic spikes while tolerating normal interactive bursts.
3. **Atomic Persistence (`rate_limit_counters`)**: Every evaluation synchronizes inside `runInTransaction()` (`BEGIN IMMEDIATE`) so counter state and temporary cooldown blocks (`blocked_until_ms`) survive API process restarts.
4. **Redis Horizontal Scaling Contract (`REDIS_URL`)**: `RateLimitService` exposes `RateLimitBackend` and `RedisRateLimitClient` interfaces. When `REDIS_URL` is configured in multi-replica deployments, a Redis Lua atomic sliding-window + token-bucket backend drops in without changing any route handler or policy definition.

---

## 3. Policy Matrix by Dimension & Endpoint

| Policy Name | Endpoint(s) | Limit | Window | Dimension | Special Behavior |
|---|---|---|---|---|---|
| `login_account` | `POST /api/v1/auth/login` (failed attempts) | **5 failures** | 15 min (`900s`) | Hashed account identifier | Progressive delay `[0, 1, 2, 4, 8, 15]s` + temporary cooldown; **never permanent DoS lock**; cleared on successful login |
| `login_ip` | `POST /api/v1/auth/login` | **20 requests** | 15 min (`900s`) | Client IP | Blocks credential stuffing across multiple accounts from one IP |
| `register_ip` | `POST /api/v1/auth/register` | **10 requests** | 15 min (`900s`) | Client IP | Prevents automated mass account creation |
| `auth_recovery` | `POST /api/v1/auth/forgot-password`, `verify-email`, `resend-verification`, `reset-password` | **10 requests** | 15 min (`900s`) | Client IP | Prevents token guessing and email-sending floods |
| `media_inspect` | `POST /api/v1/media/inspect` | **10 requests** | 1 min (`60s`) | Authenticated account ID (or session/IP for guests) | Protects external inspection & `ffprobe`/adapter I/O |
| `job_create` | `POST /api/v1/jobs`, `POST /api/v1/batches`, `POST /api/v1/tools/merge`, `POST /api/v1/playlists/process` | **5 requests** | 1 min (`60s`) | Authenticated account ID (or session/IP for guests) | Prevents rapid queue-flooding bursts |
| `upload_init` | `POST /api/v1/media/upload`, `POST /api/v1/media/upload/init` | **5 requests** | 1 min (`60s`) | Authenticated account ID (or session/IP for guests) | Prevents ephemeral disk exhaustion |
| `job_cancel` | `POST /api/v1/jobs/:id/cancel`, `POST /api/v1/batches/:id/cancel` | **10 requests** | 1 min (`60s`) | Authenticated account ID (or session/IP for guests) | Prevents cancel/re-enqueue churn |
| `reward_claim` | `POST /api/v1/rewards/sessions` | **1 active claim** | Active TTL (`<= 5 min`) | Authenticated account ID (`reward_sessions`) | Enforces max 1 active `PENDING` reward session per user at a time |
| `admin_api` | `/api/v1/admin/*` (excluding public `/metrics`) | **60 requests** | 1 min (`60s`) | Authenticated admin account ID | Bounds operational console traffic |

### Explicitly Exempted Polling & Delivery Routes (NEVER Tightly Throttled)

Long-running 4K/8K transcoding, audio extraction, and playlist packaging jobs require uninterrupted client polling and SSE connections. The following routes are explicitly bypassed by `rateLimitService.isExemptPollingRoute()`:

- `GET /api/v1/jobs/:id`
- `GET /api/v1/jobs/:id/events` (SSE stream)
- `GET /api/v1/jobs/:id/download`
- `GET /api/v1/batches/:id`
- `GET /api/v1/batches/:id/jobs`
- `GET /api/v1/playlists/:id`
- `GET /api/v1/download/:token` (supports multi-chunk HTTP Range `206` resumes)
- `GET /api/v1/health`, `GET /api/v1/auth/session`, `GET /api/v1/admin/metrics`, `GET /api/v1/rewards/config`

---

## 4. Client Response Contract & Anti-Leakage Guarantees

Every rejected request receives HTTP `429 Too Many Requests` with RFC-standard headers:

- `Retry-After`: integer seconds until the next allowed attempt (`>= 1`)
- `RateLimit-Limit`: configured ceiling for the policy
- `RateLimit-Remaining`: `0`
- `RateLimit-Reset`: seconds until window reset

Response body:

```json
{
  "success": false,
  "error": {
    "code": "ERR_RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please wait a moment and try again.",
    "userMessage": "Too many requests right now. Please wait a moment and try again.",
    "details": {
      "retryAfterSeconds": 42
    }
  },
  "requestId": "req_a1b2c3d4e5f67890"
}
```

**Zero Internal Risk-Score Leakage**: Responses never expose internal risk scores, bucket keys, user existence, IP-reputation heuristics, or security-event counters.

---

## 5. Privacy-Preserving Bucket Keys & Telemetry

- **Keyed Hashing**: All bucket identifiers (emails, IPs, bearer/session headers) are transformed via HMAC-SHA256 (`hashBucketDimension()`) before writing to `rate_limit_counters`, ensuring raw emails and raw IP addresses are never persisted in rate-limit tables.
- **IP Truncation**: `security_events.ip_prefix` stores `/24` prefixes for IPv4 (`x.y.z.0/24`) and `/48` prefixes for IPv6 (`a:b:c::/48`).
- **Reverse-Proxy Safety**: `X-Forwarded-For` is ignored unless `TRUST_PROXY=true` is explicitly configured for a trusted ingress proxy, preventing trivial client header spoofing.
