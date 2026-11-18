# Complete API Reference

**Project:** MUXARO  
**Base URL:** `http://localhost:4000/api/v1` (local) / `https://api.muxaro.app/api/v1` (production)  
**Source of Truth:** Extracted directly from all 13 route plugins in `apps/api/src/routes/` and `apps/media-worker/src/server.ts`.

---

## Conventions

- **Auth Legend:** `Public` (no auth), `Guest/User` (authenticated session or auto-assigned `muxaro_guest`), `Auth` (`requireAuth` + CSRF on cookie mutations), `Admin+MFA` (`requireAdminMfa` + CSRF + `admin_api` rate limit), `Token` (HMAC signed token), `SSV` (ECDSA-SHA256 provider callback).
- **Idempotency:** Supported via `Idempotency-Key` header or `idempotencyKey` body field on job/batch/playlist/merge creation.
- **Rate Limits:** Enforced via `RateLimitService` (returns `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and `Retry-After` on `429`).

---

## 1. System Health & Readiness (`routes/health.ts`)

| Method | Path | Auth | Rate Limit | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/health` | Public | Exempt | Liveness check returning DB status (`sqlite-wal`), `storageMode` (`local\|r2`), `r2Configured`, worker slot count, version, and uptime. |
| `GET` | `/api/v1/ready` | Public | Exempt | Production readiness probe (`200` if SQLite + FFmpeg available, else `503`). Honestly reports `googleAuthConfigured`, `rewardedAdsConfigured`, `ffmpegAvailable` with zero leaked secrets. |

```bash
curl -s http://localhost:4000/api/v1/ready
```
```json
{
  "success": true,
  "data": {
    "status": "READY",
    "uptimeSeconds": 142,
    "environment": "development",
    "database": "sqlite-wal",
    "storageMode": "local",
    "r2Configured": false,
    "googleAuthConfigured": false,
    "rewardedAdsConfigured": false,
    "ffmpegAvailable": true
  },
  "requestId": "req_1a2b3c4d5e6f7890"
}
```

---

## 2. Authentication, OAuth 2.0 PKCE & MFA (`routes/auth.ts`)

| Method | Path | Auth | Rate Limit | Request Body / Query | Response / Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/register` | Public | `register_ip` (10/15m) | `{ email, password, displayName? }` | `201 Created`; sets `muxaro_session` & `muxaro_csrf`; returns `user`, `csrfToken`, `verificationRequired: true` |
| `POST` | `/api/v1/auth/login` | Public | `login_ip` (20/15m) + `login_account` (5 fails/15m) | `{ email, password, mfaCode? }` | `200 OK`; sets auth cookies; returns `user`, `csrfToken`, `mfaRequired` |
| `POST` | `/api/v1/auth/verify-email` | Public / Auth | `auth_recovery` (10/15m) | `{ code? \| token? }` | `200 OK`; marks email verified (single-use, max 5 attempts, 15m TTL) |
| `POST` | `/api/v1/auth/resend-verification` | Public / Auth | `auth_recovery` (10/15m) | `{ email? }` | `200 OK` anti-enumeration response |
| `POST` | `/api/v1/auth/forgot-password` | Public | `auth_recovery` (10/15m) | `{ email }` | `200 OK` generic anti-enumeration response |
| `POST` | `/api/v1/auth/reset-password` | Public | `auth_recovery` (10/15m) | `{ token, newPassword \| password }` | `200 OK`; updates password, revokes all sessions, clears auth cookies |
| `GET` | `/api/v1/auth/session` | Public | Exempt | — | `200 OK`; returns `{ authenticated, user, csrfToken, googleAuthConfigured }` and syncs `muxaro_csrf` cookie |
| `POST` | `/api/v1/auth/logout` | Cookie / Bearer | — | CSRF required if cookie | `200 OK`; revokes current session and clears cookies |
| `POST` | `/api/v1/auth/logout-all` | Auth | — | — | `200 OK`; revokes all active sessions for user, returns `sessionsRevoked` |
| `GET` | `/api/v1/auth/google/start` | Public | — | `?returnTo=/path` | `302` redirect to Google OAuth + sets `muxaro_oauth_state` cookie (`503` if unconfigured) |
| `GET` | `/api/v1/auth/google/callback` | Public | — | `?code=...&state=...` | Verifies PKCE + cookie state + JWKS RS256 ID token; sets auth cookies and `302` redirects to `FRONTEND_URL + returnTo` |
| `POST` | `/api/v1/auth/mfa/setup` | Auth | — | — | `200 OK`; generates encrypted RFC 6238 TOTP secret and `otpauth://` URI |
| `POST` | `/api/v1/auth/mfa/verify` | Auth | — | `{ code }` (6 digits) | `200 OK`; enables MFA and sets `mfa_verified = 1` on current session |
| `POST` | `/api/v1/auth/mfa/disable` | Auth | — | `{ code }` (6 digits) | `200 OK`; disables TOTP MFA after verifying current code |

```bash
curl -i -c cookies.txt -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"StrongPassword!1"}'
```

---

## 3. User Profile, Identity & Sessions (`routes/me.ts`)

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/me` | Auth | Full profile, preferences, and live job/session summary |
| `PATCH` | `/api/v1/me` | Auth | Update `{ displayName?, preferences? }` |
| `DELETE` | `/api/v1/me` | Auth | Soft-delete account (`account_status = 'DELETED'`), revoke all sessions, clear cookies |
| `GET` | `/api/v1/me/identity` | Auth | Customer-safe identity summary (`id`, `publicUserId` [`MXR-...`], `memberSince`, `tier`, `role`, `mfaEnabled`, `mfaVerified`) |
| `GET` | `/api/v1/me/sessions` | Auth | List all active sessions/devices for the current user |
| `DELETE` | `/api/v1/me/sessions/:sessionId` | Auth | Revoke a specific owned session (IDOR protected; clears cookies if revoking current session) |

---

## 4. Entitlements, Quotas & Immutable Credit Ledger (`routes/entitlements.ts`, `routes/account.ts`)

| Method | Path | Auth | Query Params | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/entitlements` | Guest/User | — | Live tier, priority, concurrency cap, rolling 24h individual & playlist limits, extra reward credits, and reset countdowns |
| `GET` | `/api/v1/entitlements/usage` | Guest/User | — | Alias returning unified rolling 24h usage breakdown |
| `GET` | `/api/v1/credits` | Guest/User | — | Alias returning unified credit & allowance balances |
| `GET` | `/api/v1/account/credits` | Guest/User | — | Backwards-compatible alias returning both unified flat fields and legacy nested `individualVideos`/`playlists`/`credits` |
| `GET` | `/api/v1/credits/ledger` | Guest/User | `limit` (def 50), `offset` (def 0), `type` (`REWARD_GRANTED\|CREDIT_RESERVED\|CREDIT_CONSUMED\|CREDIT_RELEASED\|ADMIN_ADJUSTMENT\|CREDIT_EXPIRED`) | Paginated immutable credit ledger (`data[]` + `meta: { total, limit, offset }`) |
| `GET` | `/api/v1/account/history` | Guest/User | `page` (def 1), `limit` (def 20, max 100) | Paginated job history owned by caller |

---

## 5. Rewarded Ads & Server-Side Verification (`routes/rewards.ts`)

| Method | Path | Auth | Rate Limit | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/rewards/config` | Guest/User | Exempt | Honest GAM configuration status (`enabled`, `configured`, `adUnitPath`, `rewardAmount`, `dailyCap`, `remainingAdsToday`) |
| `POST` | `/api/v1/rewards/sessions` | Auth | `reward_claim` (1 active pending) | Creates `MXRWD-...` session (10m TTL) with HMAC-signed `customData`; returns `503` if GAM unconfigured, `409` if active session or daily cap reached |
| `GET` | `/api/v1/rewards/sessions/:id` | Auth (Owner) | — | Returns authoritative server-side session status (`PENDING\|VERIFIED\|EXPIRED\|REJECTED`) + current quota |
| `POST` | `/api/v1/rewards/sessions/:id/refresh` | Auth (Owner) | — | Refreshes status; **rejects** client grant payloads (`rewarded: true`, `grant: true`, etc.) with `403 ERR_CLIENT_REWARD_FORBIDDEN` |
| `GET` | `/api/v1/rewards/provider-callback` | SSV | — | Google Ad Manager SSV GET callback verified via ECDSA-SHA256 + `UNIQUE provider_transaction_id` replay protection |
| `POST` | `/api/v1/rewards/provider-callback` | SSV | — | Signed JSON SSV callback equivalent |

---

## 6. Media Inspection & Uploads (`routes/media.ts`)

| Method | Path | Auth | Rate Limit | Request / Headers | Response |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/media/inspect` | Guest/User | `media_inspect` (10/m) + `inspect` (15/m) | `{ url, rightsDeclared?, ownershipType?, attestation?, licenseType? }` | `200 OK` `{ assetId, title, streams[], availableFormats, rightsCheck }` |
| `POST` | `/api/v1/media/upload` | Guest/User | `upload_init` (5/m) | Binary stream (`application/octet-stream`, `video/*`, `audio/*`, <= 2 GB) + `x-file-name` header | `200 OK` ffprobe-inspected `MediaAssetInfo` (`assetId`) |
| `POST` | `/api/v1/media/upload/init` | Guest/User | `upload_init` (5/m) | `{ filename, totalSize, totalParts (1..1000), sha256? }` | `200 OK` `{ uploadId, filename, totalSize, totalParts, chunkSizeHint: 5242880, expiresAt }` |
| `PUT` | `/api/v1/media/upload/:uploadId/part/:partNumber` | Guest/User | — | Binary stream (<= 100 MB/part, idempotent atomic rename) | `200 OK` `{ uploadId, partNumber, sizeBytes, receivedParts, totalParts }` |
| `POST` | `/api/v1/media/upload/:uploadId/complete` | Guest/User | — | — | `200 OK` assembled + SHA-256 verified + ffprobe-inspected `MediaAssetInfo` |
| `DELETE` | `/api/v1/media/upload/:uploadId` | Guest/User | — | — | `200 OK` `{ uploadId, cancelled: true }` |
| `GET` | `/api/v1/media/:id` | Guest/User | — | — | `200 OK` cached `MediaAssetInfo` (`404 ERR_ASSET_NOT_FOUND` if expired) |

```bash
curl -s -X POST http://localhost:4000/api/v1/media/inspect \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/sample.mp4","rightsDeclared":true}'
```

---

## 7. Asynchronous Job Execution (`routes/jobs.ts`)

| Method | Path | Auth | Rate Limit | Description |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/jobs` | Guest/User | `job_create` (5/m) + `createJob` (10/m) | Submit job (`EXTRACT_AUDIO`, `REMUX_STREAM_COPY`, `TRANSCODE_VIDEO`, `CONVERT_FORMAT`, `MERGE_AUDIO_VIDEO`); requires `operation`, `targetFormat`, `idempotencyKey`, and `mediaAssetId` or `mediaUrl`; returns `202 Accepted` with `MXJ-...` job |
| `GET` | `/api/v1/jobs/:id` | Owner/Admin | **Exempt** | Live job status, TurboFlow lane, progress (0–100), artifact metadata, and `downloadUrl` |
| `GET` | `/api/v1/jobs/:id/events` | Owner/Admin | **Exempt** | Server-Sent Events (`text/event-stream`) emitting `event: progress`, `: heartbeat` (15s), and terminal `event: complete` |
| `POST` | `/api/v1/jobs/:id/cancel` | Owner/Admin | `job_cancel` (10/m) | Kills subprocess / removes from queue and refunds quota reservation |
| `POST` | `/api/v1/jobs/:id/retry` | Owner/Admin | — | Re-queues a `FAILED` job if `attempts < maxAttempts` (3) |
| `GET` | `/api/v1/jobs/:id/download` | Owner/Admin | — | `302 Redirect` to signed `/api/v1/download/:token` (supports `?inline=1`) |

```bash
curl -s -X POST http://localhost:4000/api/v1/jobs \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: job-2026-001" \
  -d '{
    "mediaAssetId": "asset-uuid-here",
    "operation": "EXTRACT_AUDIO",
    "targetFormat": "mp3",
    "idempotencyKey": "job-2026-001"
  }'
```

---

## 8. Batch Processing (`routes/batches.ts`)

| Method | Path | Auth | Rate Limit | Description |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/batches` | Guest/User | `job_create` (5/m) + `createJob` (10/m) | Create tracked batch (`MXB-YYYYMMDD-XXXXXX`) with 1..50 `items[]` numbered `001`, `002`, ...; returns `202 Accepted` |
| `GET` | `/api/v1/batches` | Guest/User | — | Paginated (`page`, `limit`) list of caller's batches |
| `GET` | `/api/v1/batches/:id` | Owner/Admin | **Exempt** | Batch progress summary & rollup counters |
| `GET` | `/api/v1/batches/:id/jobs` | Owner/Admin | **Exempt** | Ordered `001/002/003` child jobs for a batch |
| `POST` | `/api/v1/batches/:id/cancel` | Owner/Admin | `job_cancel` (10/m) | Cancels all non-terminal child jobs in the batch |

---

## 9. Playlist Processing (`routes/playlists.ts`)

| Method | Path | Auth | Rate Limit | Description |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/playlists/inspect` | Guest/User | `inspect` (15/m) | Discover up to 50 real items in a playlist (`{ url, maxItems? }`) |
| `POST` | `/api/v1/playlists/jobs` | Guest/User | `createJob` (10/m) | Submit playlist batch job (`{ playlistUrl, targetFormat, targetResolution?, packageAsZip?, maxItems?, idempotencyKey }`), returns `202 Accepted` |
| `GET` | `/api/v1/playlists/jobs/:id` | Owner/Admin | **Exempt** | Poll playlist progress, per-item status & individual links, plus verified `zipDownloadUrl` |

---

## 10. Standalone Media Tools (`routes/tools.ts`)

| Method | Path | Auth | Rate Limit | Description |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/tools/merge` | Guest/User | `job_create` (5/m) + `createJob` (10/m) | Submit A/V merge job (`{ videoAssetId?, videoUrl?, audioAssetId?, audioUrl?, targetFormat, audioOffsetMs?, idempotencyKey }`); returns `202 Accepted` |

---

## 11. Signed Resumable Download Delivery (`routes/download.ts`)

| Method | Path | Auth | Rate Limit | Query / Headers | Response |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/download/:token` | Signed Token + IDOR Check | `download` (20/m); global exempt | `?inline=1`, `Range: bytes=...`, `If-Range: <ETag\|HTTP-date>` | `200 OK` (full stream), `206 Partial Content` (byte slice), or `416 Range Not Satisfiable` |

---

## 12. Administration & SRE Control Centre (`routes/admin.ts`)

| Method | Path | Auth | Rate Limit | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/admin/metrics` | **Public (Redacted)** | Exempt | Redacted operational health summary for `/status`: 6-lane queue depth, per-tier p50/p95 latencies, memory RSS/heap, 5-min error rate |
| `GET` | `/api/v1/admin/search?q=` | Admin+MFA | `admin_api` (60/m) | Unified lookup by `MXR-...`, `MXB-...`, `MXJ-...`, `req_...`, or email |
| `GET` | `/api/v1/admin/users` | Admin+MFA | `admin_api` (60/m) | Paginated user listing (`page`, `limit`, `status`, `tier`, `search`/`q`) with usage, sessions, credits, and abuse flags |
| `POST` | `/api/v1/admin/users/:publicUserId/suspend` | Admin+MFA | `admin_api` (60/m) | Suspend account (`{ reason? }`), revoke all sessions, record immutable audit log |
| `POST` | `/api/v1/admin/users/:publicUserId/restore` | Admin+MFA | `admin_api` (60/m) | Restore suspended account (`{ reason? }`), record immutable audit log |
| `POST` | `/api/v1/admin/users/:publicUserId/revoke-sessions` | Admin+MFA | `admin_api` (60/m) | Force sign-out all active sessions for a user |
| `GET` | `/api/v1/admin/settings` | Admin+MFA | `admin_api` (60/m) | Read all 16 live `system_settings` values and bounds |
| `PATCH` | `/api/v1/admin/settings` | Admin+MFA | `admin_api` (60/m) | Update settings with strict min/max validation and immutable audit diff |
| `GET` | `/api/v1/admin/rewards` | Admin+MFA | `admin_api` (60/m) | Rewarded ads SSV status, verified/rejected counts, and replay fraud flags |
| `GET` | `/api/v1/admin/analytics` | Admin+MFA | `admin_api` (60/m) | Real SQLite-derived DAU/MAU, registrations, jobs, downloads, rewards, retention, funnel, tier queue latency |
| `GET` | `/api/v1/admin/audit-logs` | Admin+MFA | `admin_api` (60/m) | Paginated immutable `admin_audit_logs` (`page`, `limit`, `action`) |
| `GET` | `/api/v1/admin/security-events` | Admin+MFA | `admin_api` (60/m) | Paginated redacted `security_events` (`page`, `limit`, `eventType`, `severity`) |

---

## 13. Internal Media Worker Microservice (`apps/media-worker/src/server.ts`)

Exposed on internal network only (default `:3002` local / `:5000` Docker / internal-only Cloud Run):
- `GET /health` — FFmpeg/FFprobe versions, scratch disk stats, host CPU/RAM
- `POST /api/probe` — `{ inputPath }`
- `POST /api/process-video` — `{ inputPath, outputPath, targetContainer, targetResolution?, targetCodec?, crf?, preset?, maxBitrateKbps?, audioCodec?, audioBitrateKbps?, timeoutMs? }`
- `POST /api/extract-audio` — `{ inputPath, outputPath, targetFormat, targetCodec?, bitrateKbps?, sampleRate?, channels?, timeoutMs? }`
- `POST /api/merge` — `{ videoInputPath, audioInputPath, outputPath, targetContainer, audioOffsetMs?, preferStreamCopy?, timeoutMs? }`
- `POST /api/package` — `{ items[], outputPath, archiveTitle?, playlistMetadata? }`
- `POST /api/verify` — `{ filePath, expectedDurationSeconds?, requireVideo?, requireAudio? }`
- `GET /api/scratch/stats` — Current scratch disk utilization metrics
