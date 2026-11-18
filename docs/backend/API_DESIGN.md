# API Design Standards

**Project:** MUXARO  
**Base Path:** `/api/v1`  
**Interactive Docs:** `/docs` (`@fastify/swagger` + `@fastify/swagger-ui`, OpenAPI 3.x spec version `2.0.0`)

---

## 1. Response Envelope Contract

Every JSON endpoint (except binary downloads, SSE streams, and 302 redirects) uses a strict, predictable envelope defined in `apps/api/src/types/index.ts` and enforced in `apps/api/src/app.ts`.

### Success Envelope
```json
{
  "success": true,
  "data": {},
  "requestId": "req_9f8e7d6c5b4a3210"
}
```
- Paginated ledger endpoint (`GET /api/v1/credits/ledger`) additionally includes a top-level `meta` object: `{ "total": 42, "limit": 50, "offset": 0 }`.
- `GET /api/v1/auth/session` includes flattened compatibility fields alongside `data` for smooth frontend hydration.

### Error Envelope
```json
{
  "success": false,
  "error": {
    "code": "ERR_QUOTA_EXCEEDED",
    "message": "Individual video job quota exceeded for this 24-hour rolling window.",
    "userMessage": "You have reached your daily usage limit. Your allowance will refresh automatically.",
    "details": null
  },
  "requestId": "req_9f8e7d6c5b4a3210"
}
```
- `error.code`: Stable machine-readable code (`ERR_*` or `SSRF_BLOCKED`).
- `error.message`: Technical diagnostic message (masked for `>= 500` errors to prevent internal leakage).
- `error.userMessage`: Customer-friendly copy produced by `mapHumanFriendlyError()` in `apps/api/src/services/turboflow.service.ts` on media/job/download/rate-limit routes.
- `error.details`: Optional structured metadata (scrubbed via `redactSensitiveData()`, always `null` for `5xx`).

---

## 2. HTTP Status Code Semantics

| Status Code | Usage in MUXARO |
| :--- | :--- |
| `200 OK` | Synchronous reads, updates, cancellations, retries, full binary download, idempotent duplicate SSV callback |
| `201 Created` | Account registration (`POST /auth/register`), reward session creation (`POST /rewards/sessions`) |
| `202 Accepted` | Asynchronous job/batch/playlist/merge submissions (`POST /jobs`, `POST /batches`, `POST /playlists/jobs`, `POST /tools/merge`) |
| `206 Partial Content` | Resumable byte-range binary download (`GET /download/:token` with valid `Range` header) |
| `302 Found` | OAuth redirect to Google / frontend return URL, `GET /` → `/docs`, `GET /jobs/:id/download` → `/download/:token` |
| `400 Bad Request` | Schema validation failures, malformed IDs/emails/passwords, missing upload parts, prototype pollution, checksum mismatch |
| `401 Unauthorized` | Missing/expired/revoked session on protected routes, invalid login credentials |
| `403 Forbidden` | CSRF token invalid, IDOR cross-user access, admin role or MFA missing, SSRF blocked, invalid download/SSV signature, forged client reward grant |
| `404 Not Found` | Unknown job, batch, playlist job, media asset, artifact, upload session, user, or session |
| `409 Conflict` | Rolling quota exceeded (`ERR_QUOTA_EXCEEDED`), active pending reward session (`ERR_REWARD_SESSION_ACTIVE`), daily reward cap reached |
| `413 Payload Too Large` | Single-stream or cumulative multipart upload exceeding 2 GB (`ERR_FILE_TOO_LARGE`) |
| `416 Range Not Satisfiable` | Invalid or out-of-bounds `Range` header on download (`ERR_RANGE_NOT_SATISFIABLE` + `Content-Range: bytes */total`) |
| `422 Unprocessable Entity` | Playlist inspection found no playable items or upstream inspection failed |
| `429 Too Many Requests` | Rate limit or duplicate flood exceeded (`ERR_RATE_LIMIT_EXCEEDED` + `Retry-After` + `RateLimit-*` headers) |
| `503 Service Unavailable` | Readiness check degraded (`/ready`), queue backpressure (`>200` waiting jobs), Google OAuth or GAM rewarded ads not configured |

---

## 3. Authentication, CSRF & Guest Isolation

- **Cookie Auth (Browser Default):** `muxaro_session` (`HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS/prod) + `muxaro_csrf` (readable by JS). All mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) MUST echo `muxaro_csrf` in the `x-muxaro-csrf` header.
- **Bearer Auth (API/CLI):** `Authorization: Bearer <rawSessionToken>` validates against `user_sessions` SHA-256 hashes and is exempt from cookie CSRF checks.
- **Guest Isolation:** Unauthenticated visitors automatically receive an `HttpOnly` `muxaro_guest` cookie (`guest_<32-hex>`), isolating guest jobs, batches, and rolling 24h allowances (`3` individual jobs/24h, `1` concurrent).
- **Admin Endpoints:** Require `role = 'ADMIN'`, `mfa_enabled = 1`, and `user_sessions.mfa_verified = 1`.

---

## 4. Idempotency Design

Mutating compute submissions (`POST /api/v1/jobs`, `POST /api/v1/tools/merge`, `POST /api/v1/playlists/jobs`, `POST /api/v1/batches`) accept an idempotency key via either:
1. Header: `Idempotency-Key: <unique-client-key>` (takes precedence)
2. Body field: `idempotencyKey`

`entitlementsService.executeIdempotent(key, userId, payload, fn)` deduplicates retries scoped to `(userId, idempotencyKey)` so transient network retries return the original `202 Accepted` payload without double-reserving quota or spawning duplicate jobs. Multipart part uploads (`PUT /api/v1/media/upload/:uploadId/part/:partNumber`) achieve idempotency via write-to-temp + atomic `fs.rename()`.

---

## 5. Pagination Standards

MUXARO uses two consistent pagination patterns depending on endpoint domain:

| Pattern | Query Parameters | Bounds | Used By |
| :--- | :--- | :--- | :--- |
| **Page / Limit** | `page` (default `1`), `limit` (default `20` or `25` or `50`) | `page >= 1`, `1 <= limit <= 100` | `GET /account/history`, `GET /batches`, `GET /admin/users`, `GET /admin/audit-logs`, `GET /admin/security-events` |
| **Offset / Limit** | `offset` (default `0`), `limit` (default `50`) | `offset >= 0`, `limit` bounded | `GET /credits/ledger` (also supports `type` filter) |

---

## 6. Versioning & Compatibility Strategy

- All REST & SSE routes are prefixed under `/api/v1`.
- Additive evolution preserves legacy response aliases (e.g., `/account/credits` and `/entitlements` share `serializeUnifiedQuotaPayload()`, returning both flat unified fields and nested `individualVideos`/`playlists`/`credits` objects so older and newer UI components stay compatible).
- Full endpoint-by-endpoint contracts are documented in [API Reference](../api/API_REFERENCE.md), [OpenAPI Guide](../api/OPENAPI.md), and [Error Codes](../api/ERROR_CODES.md).
