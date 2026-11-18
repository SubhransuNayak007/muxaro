# MUXARO Authentication, Sessions & Admin MFA Report

**Product:** MUXARO — *Your Media. One Powerful Workspace.*  
**Workstream:** Workstream 2 (`@auth` — Authentication, Sessions & Admin MFA Engineer)  
**Date:** 18 November 2026  
**Runtime:** Node.js `v24.15.0`, Fastify `5.12.8`, Node 24 native `node:crypto` & `node:sqlite` (`DatabaseSync` WAL + `PRAGMA foreign_keys = ON`)

---

## 1. Implemented Module Inventory

| File | Responsibility | Key Exports |
| :--- | :--- | :--- |
| `apps/api/src/services/auth.service.ts` | Password hashing (Argon2id + Scrypt fallback), email registration/login/verification/recovery, session lifecycle, Google OAuth 2.0 + PKCE + JWKS RS256 verification, MFA orchestration, profile/soft-delete, login brute-force protection | `authService`, `hashPassword`, `verifyPassword`, `verifyGoogleIdToken`, `sanitizeReturnTo`, `hashToken`, `timingSafeStringEqual`, `extractIpPrefix`, `recordSecurityEvent`, `isGoogleAuthConfigured` |
| `apps/api/src/services/mfa.service.ts` | Pure-Node RFC 6238 TOTP (HMAC-SHA1, 30s step, 6 digits, ±1 skew), RFC 4648 Base32, `otpauth://` URI generation, AES-256-GCM at-rest secret encryption | `mfaService`, `generateTotpSecret`, `generateTotpUri`, `verifyTotpCode`, `generateCurrentTotp`, `encryptMfaSecret`, `decryptMfaSecret` |
| `apps/api/src/middleware/auth.middleware.ts` | Zero-dependency RFC 6265 cookie parsing/serialization, session & guest identity resolution, double-submit + synchronizer CSRF verification, `requireAuth` & `requireAdminMfa` Fastify guards | `resolveRequestAuth`, `verifyCsrf`, `requireAuth`, `requireAdminMfa`, `setAuthCookies`, `clearAuthCookies`, `parseCookies`, `serializeCookie`, `SESSION_COOKIE_NAME`, `CSRF_COOKIE_NAME`, `GUEST_COOKIE_NAME`, `CSRF_HEADER_NAME` |
| `apps/api/src/routes/auth.ts` | 14 REST endpoints for registration, login, email verification, password recovery, session inspection, logout/logout-all, Google OAuth start/callback, and TOTP MFA setup/verify/disable | `authRoutes` |
| `apps/api/src/routes/me.ts` | 6 authenticated user profile, identity, soft-delete, and IDOR-protected session management endpoints | `meRoutes` |

---

## 2. Password Storage & Anti-Enumeration Controls

### 2.1 Cryptographic Hashing
- **Primary algorithm (Node 24 native `crypto.argon2`):** Argon2id (`$argon2id$v=19$m=19456,t=2,p=1$<salt_b64url>$<hash_b64url>`) with 16-byte CSPRNG salt and 32-byte derived tag — meeting OWASP Argon2id baseline parameters without native C++ addon drift.
- **Automatic fallback (`crypto.scryptSync`):** If a runtime lacks `crypto.argon2`, hashing transparently falls back to hardened Scrypt (`N=16384, r=8, p=1`, 16-byte random salt, 64-byte key). `verifyPassword()` verifies both `$argon2id$` and `$scrypt$` hashes using `crypto.timingSafeEqual`.
- **Zero plaintext storage:** Neither passwords, session tokens, email verification codes, nor password reset tokens are ever persisted in plaintext. All opaque tokens and 6-digit verification codes are stored strictly as SHA-256 hex digests.

### 2.2 Password Policy & Timing Defense
- Enforces **8–128 characters** and at least **3 of 4 character classes** (lowercase, uppercase, digit, symbol).
- **Dummy-hash timing mitigation:** Login attempts for non-existent emails execute a full Argon2id/Scrypt verification against a cached dummy hash before returning `401 ERR_INVALID_CREDENTIALS`, preventing account-existence timing side channels.
- **Anti-enumeration responses:**
  - `POST /api/v1/auth/register`: Duplicate emails return generic `409 ERR_REGISTRATION_FAILED` without confirming whether the email is registered.
  - `POST /api/v1/auth/login`: Unknown emails, wrong passwords, OAuth-only accounts, and deleted accounts all return identical `401 ERR_INVALID_CREDENTIALS` (`"Invalid email or password."`).
  - `POST /api/v1/auth/forgot-password` and unauthenticated `POST /api/v1/auth/resend-verification`: Always return identical generic `200` responses regardless of whether the email exists.

### 2.3 Built-In Login Brute-Force Protection
Backed atomically by SQLite `rate_limit_counters` (`BEGIN IMMEDIATE` transaction):
- **Per-account failed login limit:** `5 failed attempts / 15 minutes` (reset on successful password authentication; progressive window expiry, never a permanent DoS lockout).
- **Per-IP login attempt limit:** `20 attempts / 15 minutes`.
- Exceeding either limit returns `429 ERR_RATE_LIMIT_EXCEEDED` with a valid `Retry-After` header and logs `LOGIN_BRUTE_FORCE_BLOCKED` / `LOGIN_RATE_LIMITED_IP` to `security_events`.

---

## 3. Session, Cookie & CSRF Architecture

| Cookie | Attributes | Purpose |
| :--- | :--- | :--- |
| `muxaro_session` | `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` (`; Secure` in production / HTTPS) | Holds 32-byte base64url session token; only its SHA-256 digest is stored in `user_sessions.token_hash`. Never exposed to JavaScript or `localStorage`. |
| `muxaro_csrf` | `SameSite=Lax; Path=/; Max-Age=2592000` (`; Secure` in prod; readable by JS) | Synchronized with `user_sessions.csrf_token` for double-submit header attachment (`x-muxaro-csrf`). |
| `muxaro_guest` | `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` (`; Secure` in prod) | Cryptographic `guest_<32 hex>` identity isolating guest jobs/batches from other guests. |
| `muxaro_oauth_state` | `HttpOnly; SameSite=Lax; Path=/api/v1/auth/google; Max-Age=600` (`; Secure` in prod) | Stores `SHA-256(state)` binding the browser initiating Google OAuth to the callback (prevents login CSRF). Cleared immediately on callback. |

### 3.1 CSRF Verification (`verifyCsrf`)
- Safe methods (`GET`, `HEAD`, `OPTIONS`) and explicit `Authorization: Bearer` API clients bypass cookie CSRF checks.
- All state-mutating (`POST`, `PATCH`, `PUT`, `DELETE`) cookie-authenticated requests MUST include `x-muxaro-csrf` matching **both** the server-side `user_sessions.csrf_token` (synchronizer token) and the `muxaro_csrf` cookie (double-submit) via constant-time `timingSafeStringEqual`. Missing or mismatched tokens return `403 ERR_CSRF_INVALID` and record a `HIGH` severity `CSRF_REJECTED` event in `security_events`.

### 3.2 Session Rotation & Revocation
- **Session fixation defense:** Both email login and Google OAuth callback revoke any prior `muxaro_session` cookie token and issue a fresh session ID, token, and CSRF token.
- **Global invalidation:** `POST /api/v1/auth/reset-password`, `POST /api/v1/auth/logout-all`, and `DELETE /api/v1/me` atomically revoke **all** active sessions for the user in `user_sessions`.

---

## 4. Email Verification & Password Recovery

- **Email Verification (`email_verifications`):** Single-use 6-digit code (`code_hash`) + 32-byte URL token (`token_hash`), **15-minute expiry**, **maximum 5 failed attempts** before automatic invalidation, and single-use `consumed_at` enforcement rejecting replays with `400 ERR_VERIFICATION_INVALID_OR_EXPIRED`.
- **Password Reset (`password_resets`):** Single-use 32-byte URL token (`token_hash`), **30-minute expiry**, atomic `consumed_at` + password hash update + full revocation of all active user sessions in one `BEGIN IMMEDIATE` transaction.
- **Development/Test Mail Sink:** In non-production environments (`NODE_ENV !== 'production'`) when `SMTP_HOST` is unset, verification codes and reset tokens are written with mode `0600` to `<db_dir>/dev-outbox.jsonl` (typically `.muxaro-data/dev-outbox.jsonl`) rather than logged to stdout or leaked in HTTP responses, preserving strict anti-enumeration while enabling full automated E2E testing.

---

## 5. Google OAuth 2.0 (Authorization Code + PKCE S256 + JWKS RS256)

- **Zero Invented Credentials:** Reads `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` exclusively from `process.env`.
- **Honest Unconfigured Behavior:** When any required environment variable is absent, `GET /api/v1/auth/session` reports `googleAuthConfigured: false`, and both `GET /api/v1/auth/google/start` and `GET /api/v1/auth/google/callback` return `503 ERR_GOOGLE_AUTH_NOT_CONFIGURED`.
- **Authorization Request (`GET /api/v1/auth/google/start?returnTo=...`):**
  - Strictly minimal scope: `openid email profile` (never Drive, Gmail, or third-party data scopes).
  - Generates 256-bit `code_verifier`, `code_challenge = base64url(SHA-256(code_verifier))` (`code_challenge_method=S256`), 256-bit `state`, and 256-bit `nonce` persisted in `oauth_states` (10-minute TTL).
  - Open-redirect protection (`sanitizeReturnTo`): accepts only single-slash relative paths (`/path`); rejects `//evil.com`, `/\evil.com`, scheme prefixes (`https://`, `javascript:`), CR/LF, and values > 256 chars, falling back to `/`.
- **Callback & Cryptographic Verification (`GET /api/v1/auth/google/callback`):**
  - Constant-time validates `SHA-256(query.state)` against `muxaro_oauth_state` cookie and atomically consumes the single-use `oauth_states` row.
  - Exchanges authorization `code` with `https://oauth2.googleapis.com/token` using `code_verifier` and exact configured `redirect_uri`.
  - Verifies the returned `id_token` JWT cryptographically:
    1. Rejects any `alg !== 'RS256'` or missing `kid` (blocks `alg=none` and HS256 key confusion).
    2. Fetches Google JWKS from `https://www.googleapis.com/oauth2/v3/certs` (cached per `Cache-Control: max-age` with automatic refresh on unknown `kid`).
    3. Verifies RSA-SHA256 signature via `crypto.createPublicKey({ key: jwk, format: 'jwk' })` + `crypto.verify`.
    4. Enforces `iss ∈ {https://accounts.google.com, accounts.google.com}`, exact `aud === GOOGLE_CLIENT_ID`, unexpired `exp` (≤ 60s skew), constant-time `nonce` match, and strict `email_verified === true`.

---

## 6. Admin TOTP MFA & Authorization Gate

- **RFC 6238 TOTP (`mfa.service.ts`):** Pure Node.js HMAC-SHA1, 160-bit Base32 secret, 30-second period, 6 digits, ±1 step clock-skew tolerance, constant-time `crypto.timingSafeEqual`.
- **At-Rest Secret Encryption:** TOTP secrets are encrypted with **AES-256-GCM** (`v1:<iv>:<authTag>:<ciphertext>`) using a key derived from `MFA_ENCRYPTION_KEY || SESSION_SECRET` before storage in `user_mfa.secret`.
- **Enrollment & Lifecycle:**
  - `POST /api/v1/auth/mfa/setup`: Generates encrypted secret (`enabled = 0` until verified) and returns `secret` + `otpauth://totp/MUXARO:...` URI once.
  - `POST /api/v1/auth/mfa/verify`: Validates 6-digit TOTP, enables MFA on `user_mfa` & `users`, and upgrades current `user_sessions.mfa_verified = 1`.
  - `POST /api/v1/auth/mfa/disable`: Requires a valid current TOTP code before disabling MFA and resetting `mfa_verified = 0` on sessions.
- **Admin Bootstrap & Gate (`requireAdminMfa`):**
  - No hardcoded admin passwords or backdoors exist. Initial admin accounts are designated solely via the `MUXARO_ADMIN_EMAIL` environment variable (supports comma-separated addresses) upon standard email registration or verified Google sign-in.
  - `requireAdminMfa` enforces: (1) valid authenticated session + CSRF, (2) `user.role === 'admin'` (`403 ERR_ADMIN_REQUIRED`), and (3) `user.mfaEnabled && session.mfaVerified` (`403 ERR_ADMIN_MFA_REQUIRED`).

---

## 7. Complete Endpoint Matrix

| Method & Path | Auth / Guard | Description |
| :--- | :--- | :--- |
| `POST /api/v1/auth/register` | Public | Creates `UUIDv7` + `MXR-XXXXXXXX` user, Argon2id hash, single-use email verification, rotated session + CSRF cookies |
| `POST /api/v1/auth/login` | Public + Brute-Force Guard | Constant-time credential verification, optional TOTP `mfaCode`, rotates session, sets cookies |
| `POST /api/v1/auth/verify-email` | Optional Auth (+ CSRF if cookie) | Verifies single-use 6-digit code or URL token (max 5 attempts, replay-protected) |
| `POST /api/v1/auth/resend-verification` | Optional Auth (+ CSRF if cookie) | Re-issues verification code with strict anti-enumeration when unauthenticated |
| `POST /api/v1/auth/forgot-password` | Public | Always returns generic `200`; generates single-use hashed 30m reset token if active account exists |
| `POST /api/v1/auth/reset-password` | Public | Validates single-use token, hashes new password, revokes **all** active sessions |
| `GET /api/v1/auth/session` | Public | Returns authenticated user summary + `csrfToken` + `googleAuthConfigured`, or `{ authenticated: false, googleAuthConfigured }` |
| `POST /api/v1/auth/logout` | Optional Auth + CSRF | Revokes current session and clears auth cookies |
| `POST /api/v1/auth/logout-all` | `requireAuth` + CSRF | Revokes all active sessions for user and clears auth cookies |
| `GET /api/v1/auth/google/start` | Public | Returns `503 ERR_GOOGLE_AUTH_NOT_CONFIGURED` if env absent; else redirects to Google with PKCE S256, `state`, `nonce`, `openid email profile` |
| `GET /api/v1/auth/google/callback` | OAuth State Cookie | Validates state + cookie binding, exchanges code with PKCE, verifies RS256 ID token via Google JWKS, creates/links account |
| `POST /api/v1/auth/mfa/setup` | `requireAuth` + CSRF | Generates encrypted TOTP secret and `otpauth://` URI |
| `POST /api/v1/auth/mfa/verify` | `requireAuth` + CSRF | Verifies TOTP code, enables MFA, elevates current session to `mfaVerified: true` |
| `POST /api/v1/auth/mfa/disable` | `requireAuth` + CSRF | Requires valid TOTP code; disables MFA and clears session `mfaVerified` |
| `GET /api/v1/me` | `requireAuth` | Full user profile, preferences, active session count, live job stats, linked OAuth providers |
| `PATCH /api/v1/me` | `requireAuth` + CSRF | Updates sanitized `displayName` and bounded `preferences` JSON |
| `DELETE /api/v1/me` | `requireAuth` + CSRF | Soft-deletes account, anonymizes email, revokes all active sessions, clears cookies |
| `GET /api/v1/me/identity` | `requireAuth` | Customer-safe identity card (`id`, `publicUserId`, `memberSince`, `emailVerified`, `tier`, `role`, `mfaEnabled`, `mfaVerified`) |
| `GET /api/v1/me/sessions` | `requireAuth` | Lists active sessions with `current` marker, `userAgent`, masked `ipPrefix`, `createdAt`, `lastSeenAt` (never exposes hashes/CSRF) |
| `DELETE /api/v1/me/sessions/:sessionId` | `requireAuth` + CSRF | Strict ownership enforcement — cross-user attempts return `403 ERR_FORBIDDEN` and log `IDOR_ATTEMPT` in `security_events` |

---

## 8. Verification Evidence

1. **TypeScript Strict Compilation (`tsc --noEmit`):** **0 errors (exit 0)** across all 5 modules (`mfa.service.ts`, `auth.service.ts`, `auth.middleware.ts`, `routes/auth.ts`, `routes/me.ts`).
2. **Automated End-to-End Verification (12/12 PASS against isolated SQLite DB & Fastify server):**
   - Native Node 24 Argon2id hashing + Scrypt fallback verification (`crypto.timingSafeEqual`).
   - Weak password rejection (`400 ERR_WEAK_PASSWORD`).
   - Registration (`UUIDv7` + `MXR-XXXXXXXX`, `HttpOnly; SameSite=Lax` session cookie, readable CSRF cookie, zero plaintext in DB, duplicate anti-enumeration `409`).
   - `GET /api/v1/auth/session` authenticated summary + `googleAuthConfigured: false`.
   - CSRF rejection (`403 ERR_CSRF_INVALID`) when `x-muxaro-csrf` is omitted on cookie `PATCH /api/v1/me`; `200` when valid.
   - Single-use email verification + replay rejection (`400`).
   - Cross-account session IDOR block (`DELETE /api/v1/me/sessions/:id` by User B -> `403 ERR_FORBIDDEN` + `security_events` audit entry).
   - Forgot-password identical anti-enumeration `200`, password reset revoking all active sessions (`401` on old session), and token replay rejection (`400`).
   - Login brute-force protection (`429 ERR_RATE_LIMIT_EXCEEDED` + `Retry-After` after 5 failed attempts).
   - Admin TOTP MFA enrollment/verification + `requireAdminMfa` rejecting non-admins (`403 ERR_ADMIN_REQUIRED`), rejecting admins without MFA (`403 ERR_ADMIN_MFA_REQUIRED`), and allowing MFA-verified admins (`200`).
   - Google OAuth unconfigured `503`, PKCE S256 redirect with `scope=openid email profile`, open-redirect neutralization (`https://evil.example/phish` -> `/`), forged state rejection (`400`), and real RSA-2048 RS256 JWT JWKS signature/nonce/`email_verified` verification.
   - Soft account deletion (`DELETE /api/v1/me`) revoking all sessions immediately.
