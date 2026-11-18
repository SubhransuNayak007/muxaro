# API Error Codes Catalog

**Project:** MUXARO  
**Source of Truth:** Extracted directly from `apps/api/src/` (`app.ts`, `middleware/`, `routes/`, `services/`)

Every error response follows the standard envelope:
```json
{
  "success": false,
  "error": {
    "code": "ERR_CODE_HERE",
    "message": "Diagnostic message (masked on 5xx)",
    "userMessage": "Optional customer-safe guidance",
    "details": null
  },
  "requestId": "req_a1b2c3d4e5f67890"
}
```

---

## 1. General HTTP, Security & Rate Limiting

| Error Code | HTTP Status | Trigger / Meaning |
| :--- | :---: | :--- |
| `ERR_BAD_REQUEST` | `400` | Generic malformed HTTP request fallback |
| `ERR_INVALID_REQUEST` | `400` | Validation failure, missing required fields, prototype pollution detected, invalid part number, or missing multipart chunks |
| `ERR_UNAUTHORIZED` | `401` | Missing, expired, or revoked session on a protected endpoint |
| `ERR_FORBIDDEN` | `403` | Cross-account IDOR attempt (`isOwnerOrAdmin` denied), download owner mismatch, or forbidden operation |
| `ERR_CSRF_INVALID` | `403` | Missing or mismatched `x-muxaro-csrf` header on cookie-authenticated mutation |
| `SSRF_BLOCKED` | `403` | Target URL blocked by `security/src/ssrf-guard.ts` (private IP, metadata host, disallowed scheme/port, DNS rebinding) |
| `ERR_DOWNLOAD_DISABLED_BY_POLICY` | `403` | Source adapter rights policy disallows stream extraction |
| `ERR_NOT_FOUND` | `404` | Generic resource not found fallback |
| `ERR_CONFLICT` | `409` | Generic resource conflict fallback |
| `ERR_RATE_LIMIT_EXCEEDED` | `429` | Rate-limit policy or 10-second duplicate mutation flood exceeded (includes `Retry-After` & `RateLimit-*` headers) |
| `ERR_INTERNAL_SERVER` | `500` | Unexpected server error (internal details always masked and logged redacted) |
| `ERR_BACKPRESSURE` | `503` | Global waiting queue depth (`MAX_TOTAL_QUEUED = 200`) reached |

---

## 2. Authentication, OAuth 2.0 PKCE & MFA

| Error Code | HTTP Status | Trigger / Meaning |
| :--- | :---: | :--- |
| `ERR_INVALID_EMAIL` | `400` | Malformed email address |
| `ERR_WEAK_PASSWORD` | `400` | Password outside 8–128 chars or fewer than 3 character classes |
| `ERR_INVALID_DISPLAY_NAME` | `400` | Non-string or > 80-character display name |
| `ERR_INVALID_PREFERENCES` | `400` | Malformed user preferences payload on `PATCH /api/v1/me` |
| `ERR_INVALID_SESSION_ID` | `400` | Missing or empty `sessionId` parameter on `DELETE /api/v1/me/sessions/:sessionId` |
| `ERR_REGISTRATION_FAILED` | `400`/`409` | Account registration failed |
| `ERR_ID_GENERATION` | `500` | Public user ID collision retry exhausted |
| `ERR_INVALID_CREDENTIALS` | `401` | Invalid email/password (constant-time + dummy hash anti-enumeration) |
| `ERR_ACCOUNT_SUSPENDED` | `403` | Account suspended by administrator |
| `ERR_ACCOUNT_DELETED` | `403` | Account soft-deleted |
| `ERR_VERIFICATION_REQUIRED` | `403` | Email verification required |
| `ERR_VERIFICATION_INVALID_OR_EXPIRED` | `400` | Email verification code/token invalid, expired (15m), or already used |
| `ERR_VERIFICATION_ATTEMPTS_EXCEEDED` | `429` | Exceeded 5 attempts on email verification code |
| `ERR_RESET_TOKEN_INVALID` | `400` | Password reset token invalid, expired (30m), or already consumed |
| `ERR_SESSION_NOT_FOUND` | `404` | Target session ID not found or not owned by user |
| `ERR_MFA_NOT_CONFIGURED` | `400` | MFA verify called before `POST /auth/mfa/setup` |
| `ERR_MFA_NOT_ENABLED` | `400` | MFA disable called when MFA is not enabled |
| `ERR_INVALID_MFA_CODE` | `400`/`401` | Invalid or replayed 6-digit RFC 6238 TOTP code |
| `ERR_GOOGLE_AUTH_NOT_CONFIGURED` | `503` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, or `GOOGLE_REDIRECT_URI` missing |
| `ERR_OAUTH_STATE_INVALID` | `400`/`403` | Missing, expired, already consumed, or cookie-mismatched OAuth state |
| `ERR_OAUTH_TOKEN_EXCHANGE` | `502` | Google token exchange endpoint failed |
| `ERR_OAUTH_MISSING_ID_TOKEN` | `502` | Google token response lacked `id_token` |
| `ERR_OAUTH_INVALID_ID_TOKEN` | `401` | Malformed JWT structure in Google `id_token` |
| `ERR_OAUTH_INVALID_ALG` | `401` | ID token algorithm is not `RS256` |
| `ERR_OAUTH_JWKS_FETCH` | `502` | Failed to fetch Google JWKS certificates |
| `ERR_OAUTH_JWKS_INVALID` | `502` | Malformed JWKS response from Google |
| `ERR_OAUTH_UNKNOWN_KEY` | `401` | ID token `kid` not present in Google JWKS |
| `ERR_OAUTH_BAD_SIGNATURE` | `401` | RS256 signature verification failed on Google ID token |
| `ERR_OAUTH_BAD_ISSUER` | `401` | ID token `iss` is not Google |
| `ERR_OAUTH_BAD_AUDIENCE` | `401` | ID token `aud` does not match `GOOGLE_CLIENT_ID` |
| `ERR_OAUTH_TOKEN_EXPIRED` | `401` | Google ID token `exp` is in the past |
| `ERR_OAUTH_NONCE_MISMATCH` | `401` | ID token `nonce` does not match stored `oauth_states.nonce` |
| `ERR_OAUTH_MISSING_SUBJECT` | `401` | ID token missing `sub` claim |
| `ERR_OAUTH_EMAIL_UNVERIFIED` | `403` | Google account email is not verified |

---

## 3. Media, Uploads, Jobs, Batches, Playlists & Downloads

| Error Code | HTTP Status | Trigger / Meaning |
| :--- | :---: | :--- |
| `ERR_INSPECTION_FAILED` | `400`/`422` | `yt-dlp` / adapter could not inspect link or playlist returned zero playable items |
| `ERR_ASSET_NOT_FOUND` | `404` | Inspected `assetId` missing or expired from cache |
| `ERR_EMPTY_UPLOAD` | `400` | Single upload, multipart chunk, or assembled upload is 0 bytes |
| `ERR_FILE_TOO_LARGE` | `413` | Single upload or cumulative multipart upload exceeds 2 GB |
| `ERR_INVALID_MEDIA_FILE` | `400` | Uploaded file contains no valid video/audio streams per `ffprobe` |
| `ERR_INVALID_UPLOAD_PATH` | `400` | Upload path failed directory-jail check |
| `ERR_UPLOAD_NOT_FOUND` | `404` | Multipart upload session or uploaded source file expired/missing |
| `ERR_CHECKSUM_MISMATCH` | `400` | Assembled multipart file SHA-256 did not match client-supplied `sha256` |
| `ERR_UPLOAD_FAILED` | `400`/`500` | General local upload or multipart assembly failure |
| `ERR_QUOTA_EXCEEDED` | `409` | Rolling 24-hour individual or playlist quota exhausted |
| `ERR_PLAYLIST_ITEM_LIMIT_EXCEEDED` | `400` | Requested playlist exceeds `max_playlist_items` (default 50) |
| `ERR_JOB_CREATION_FAILED` | `400` | Fallback error when `POST /api/v1/jobs` fails |
| `ERR_MERGE_JOB_FAILED` | `400` | Fallback error when `POST /api/v1/tools/merge` fails |
| `ERR_PLAYLIST_JOB_FAILED` | `400` | Fallback error when `POST /api/v1/playlists/jobs` fails |
| `ERR_JOB_NOT_FOUND` | `404` | Unknown `MXJ-...` job ID |
| `ERR_BATCH_NOT_FOUND` | `404` | Unknown `MXB-...` batch ID |
| `ERR_PLAYLIST_JOB_NOT_FOUND` | `404` | Unknown playlist job ID |
| `ERR_JOB_CANCEL_FAILED` | `404` | Cancellation failed for target job |
| `ERR_RETRY_FAILED` | `400` | Job is not in `FAILED` state or `attempts >= maxAttempts` (3) |
| `ERR_PROCESSING_FAILED` | *(Job State)* | Subprocess (`yt-dlp`/`ffmpeg`/`ffprobe`) failed or timed out during async execution |
| `ERR_INVALID_DOWNLOAD_TOKEN` | `403` | HMAC download token tampered, malformed, or expired |
| `ERR_ARTIFACT_NOT_READY` | `404` | Job is not `READY` or artifact expired (`GET /jobs/:id/download`) |
| `ERR_ARTIFACT_NOT_FOUND` | `404` | Artifact record or file missing on disk / expired (`GET /download/:token`) |
| `ERR_RANGE_NOT_SATISFIABLE` | `416` | Invalid or out-of-bounds `Range` byte request |

---

## 4. Rewarded Ads & SSV (`routes/rewards.ts`, `services/rewards.service.ts`)

| Error Code | HTTP Status | Trigger / Meaning |
| :--- | :---: | :--- |
| `ERR_REWARDED_ADS_NOT_CONFIGURED` | `503` | `GAM_REWARDED_AD_UNIT_PATH` unset or `rewarded_ads_enabled` is false |
| `ERR_REWARD_SESSION_ACTIVE` | `409` | User already has an active `PENDING` reward session |
| `ERR_REWARD_DAILY_CAP_REACHED` | `409` | User reached rolling 24h cap (default 3 verified ads) |
| `ERR_REWARD_SESSION_NOT_FOUND` | `404` | Reward session ID (`MXRWD-...`) not found |
| `ERR_REWARD_SESSION_EXPIRED` | `409` | Reward session TTL elapsed before provider callback |
| `ERR_REWARD_SESSION_MISMATCH` | `403` | `custom_data` hash does not match stored `reward_sessions.custom_data_hash` |
| `ERR_REWARD_USER_MISMATCH` | `403` | Provider `user_id` or `custom_data.u` does not match session owner |
| `ERR_REWARD_CONCURRENT_CONFLICT` | `409` | Atomic state transition conflict on concurrent callback settlement |
| `ERR_CLIENT_REWARD_FORBIDDEN` | `403` | Client sent forged grant fields (`rewarded: true`, `grant: true`, `forceVerify: true`) to `/refresh` |
| `ERR_INVALID_SSV_CALLBACK` | `400` | Missing `signature`, `key_id`, `transaction_id`, or `custom_data` |
| `ERR_UNKNOWN_SSV_KEY_ID` | `403` | `key_id` not found in Google verifier keys (or test key mismatch) |
| `ERR_INVALID_SSV_SIGNATURE` | `403` | ECDSA-SHA256 verification failed |
| `ERR_INVALID_CUSTOM_DATA` | `403` | HMAC-SHA256 verification failed on `custom_data` |
| `ERR_REWARD_CALLBACK_REJECTED` | `403` | Fallback SSV callback rejection |
| `ERR_REWARD_SESSION_CREATE_FAILED` / `FETCH_FAILED` / `REFRESH_FAILED` | `400` | Fallback reward route errors |

---

## 5. Administration & Control Centre (`routes/admin.ts`, `services/admin.service.ts`)

| Error Code | HTTP Status | Trigger / Meaning |
| :--- | :---: | :--- |
| `ERR_ADMIN_REQUIRED` | `403` | Authenticated user does not hold `admin` role |
| `ERR_ADMIN_MFA_REQUIRED` | `403` | Admin user has not enrolled or verified TOTP MFA in current session |
| `ERR_USER_NOT_FOUND` | `404` | Target `publicUserId` (`MXR-...`) not found |
| `ERR_INVALID_ACTION` | `400` | Disallowed admin action (e.g., invalid state transition) |
| `ERR_EMPTY_SETTINGS_PATCH` | `400` | `PATCH /api/v1/admin/settings` body has no recognized keys |
| `ERR_INVALID_SETTINGS` / `ERR_INVALID_SETTING_KEY` / `ERR_INVALID_SETTING_VALUE` / `ERR_INVALID_SETTING_RANGE` | `400` | Unknown setting key, wrong type, or value outside safe min/max bounds |
