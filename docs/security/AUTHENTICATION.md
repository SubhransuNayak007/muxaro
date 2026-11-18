# MUXARO Authentication Architecture

**Primary Implementations:**
- `apps/api/src/services/auth.service.ts`
- `apps/api/src/services/mfa.service.ts`
- `apps/api/src/services/id.service.ts`
- `apps/api/src/middleware/auth.middleware.ts`
- `apps/api/src/routes/auth.ts`
- `apps/web/lib/auth-context.tsx`

---

## 1. Dual-Identity User Model (`id.service.ts`)

MUXARO separates internal relational keys from customer-visible support identifiers:

| Identifier | Format | Generation | Visibility |
| :--- | :--- | :--- | :--- |
| **Internal User ID (`users.id`)** | RFC 9562 **UUIDv7** | 48-bit Unix ms timestamp + 74 CSPRNG bits | Internal DB foreign keys & opaque session references |
| **Public User ID (`users.public_user_id`)** | `MXR-XXXXXXXX` | 8 chars from non-ambiguous Crockford-like Base32 (`23456789ABCDEFGHJKMNPQRSTUVWXYZ`, excluding `0, O, 1, I, L`) | Customer UI, Navbar, Account page, Admin support search |
| **Guest Session ID (`muxaro_guest`)** | `guest_<32 hex chars>` | 16 random bytes (`crypto.randomBytes(16)`) | Scoped unauthenticated job ownership and guest quota isolation |

---

## 2. Password Policy & Hashing (`auth.service.ts`)

- **Strength Enforcement (`validatePasswordStrength`):** 8–128 characters requiring at least **3 of 4** character classes (lowercase, uppercase, digits, symbols).
- **Primary Hashing Algorithm:** Native Node.js 24 **`Argon2id`** (`crypto.argon2('argon2id', ...)`) with OWASP baseline parameters:
  - Memory: `19456` KiB (`19 MiB`)
  - Passes (`t`): `2`
  - Parallelism (`p`): `1`
  - Salt: `16` random bytes; derived tag length: `32` bytes
- **Automatic Fallback:** If running on a Node build lacking `crypto.argon2`, automatically falls back to **`Scrypt`** (`N=16384, r=8, p=1`).
- **Timing & Enumeration Defense:**
  - Verification uses `crypto.timingSafeEqual` over fixed-length digests.
  - Missing accounts still run a dummy hash comparison to prevent timing-based user enumeration.
  - Login, registration conflict, resend verification, and forgot-password return generic non-enumerating responses.

---

## 3. Session Lifecycle & Cookies (`auth.middleware.ts`)

### 3.1 Session Storage
- Raw session tokens are cryptographically random and **never stored in plaintext**.
- Only the **SHA-256 hex digest** (`token_hash`) is persisted in `user_sessions`, alongside per-session `csrf_token`, `mfa_verified`, `user_agent`, truncated `ip_prefix` (`/24` IPv4 or `/48` IPv6), `created_at`, `last_seen_at` (throttled updates every 60s), `expires_at` (30-day TTL: `SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000`), and `revoked_at`.
- `resolveRequestAuth()` checks the `muxaro_session` cookie first, then an optional `Authorization: Bearer <token>` header, validating `revoked_at IS NULL`, `expires_at > now`, `u.deleted_at IS NULL`, and `u.account_status = 'ACTIVE'`.

### 3.2 Issued Cookies

| Cookie Name | `HttpOnly` | `Secure` | `SameSite` | `Path` | Purpose |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `muxaro_session` | `true` | `true` when `NODE_ENV=production` or HTTPS / `x-forwarded-proto: https` | `Lax` | `/` | Opaque server-verified session token |
| `muxaro_csrf` | `false` | Same as above | `Lax` | `/` | Client-readable double-submit CSRF token echoed in `x-muxaro-csrf` |
| `muxaro_guest` | `true` | Same as above | `Lax` | `/` | Scoped guest identity for unauthenticated visitors |
| `muxaro_oauth_state` | `true` | Same as above | `Lax` | `/` | Short-lived OAuth state binding cookie (10-minute TTL) |

> **Deployment Note on Cookie Scope:** `serializeCookie()` in `apps/api/src/middleware/auth.middleware.ts` currently emits host-only cookies (no `Domain` attribute). In local development, `apps/web/next.config.mjs` proxies `/api/v1/*` on the same origin (`localhost:3000`). For split-subdomain production hosting (`muxaro.app` + `api.muxaro.app`), either route `/api/v1/*` through a same-origin Cloudflare proxy on `muxaro.app` or configure explicit cookie `Domain=.muxaro.app` before go-live.

### 3.3 Session Revocation
- `POST /api/v1/auth/logout` revokes the current session and clears `muxaro_session` + `muxaro_csrf`.
- `POST /api/v1/auth/logout-all` revokes all active sessions for the authenticated user.
- `DELETE /api/v1/me/sessions/:id` revokes a specific device session (owner-checked).
- Password reset (`POST /api/v1/auth/reset-password`) and admin suspension (`POST /api/v1/admin/users/:publicUserId/suspend`) automatically revoke **all** active sessions for the account.

---

## 4. Email Verification & Password Reset

- **Email Verification (`email_verifications`):** Single-use tokens/codes stored exclusively as SHA-256 hashes (`token_hash`, `code_hash`), 15-minute TTL (`EMAIL_VERIFY_TTL_MS`), max `5` attempts (`EMAIL_VERIFY_MAX_ATTEMPTS`), and `consumed_at` replay protection.
- **Password Reset (`password_resets`):** Single-use hashed reset tokens (`token_hash`), 30-minute TTL (`PASSWORD_RESET_TTL_MS`), single-use consumption (`consumed_at`), and full session revocation on completion.
- **Delivery Mode:** In local development without `SMTP_HOST`, verification and password-reset tokens are written to a local JSONL sink (`dev-outbox.jsonl` inside the data directory). Setting `SMTP_HOST` switches `deliveryMode` to `'smtp'` and suppresses `dev-outbox.jsonl` writes, though an outbound SMTP network transport client (e.g., Nodemailer / transactional mail API adapter) is not yet wired in `apps/api/package.json` and must be integrated before production email delivery.

---

## 5. Google OAuth 2.0 + PKCE (`auth.service.ts` & `routes/auth.ts`)

Google Sign-In is **strictly opt-in** via environment configuration (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`). When unset:
- `GET /api/v1/auth/session` returns `googleAuthConfigured: false` (frontend hides Google Sign-In buttons).
- `GET /api/v1/auth/google/start` returns HTTP `503 ERR_GOOGLE_AUTH_NOT_CONFIGURED`.

When configured, the OAuth flow enforces:
1. **Authorization Code + PKCE (`S256`):** Server generates cryptographic `state`, `nonce`, and `code_verifier` stored in `oauth_states` (10-minute TTL, single-use `consumed_at`).
2. **State Cookie Binding:** `muxaro_oauth_state` binds the browser initiating `/auth/google/start` to the callback.
3. **ID Token Cryptographic Verification:** Fetches Google JWKS (`https://www.googleapis.com/oauth2/v3/certs`), verifies RS256 signature, validates `iss` (`https://accounts.google.com` or `accounts.google.com`), `aud` (`GOOGLE_CLIENT_ID`), `nonce`, and `exp`.
4. **Open-Redirect Defense (`sanitizeReturnTo`):** Rejects protocol-relative (`//`), backslash, CRLF, and scheme-prefixed redirect paths; strictly permits single-slash relative paths (`<= 256` chars).

---

## 6. RFC 6238 TOTP Multi-Factor Authentication (`mfa.service.ts`)

- **Standard:** Pure-Node RFC 6238 TOTP (`HMAC-SHA1`, 30-second period, 6 digits, `±1` step clock-skew tolerance, replay counter check `lastAcceptedCounter`).
- **Secret Generation:** 160-bit CSPRNG secret (`20` bytes Base32-encoded) exposed as an `otpauth://totp/MUXARO:<email>` URI during `/api/v1/auth/mfa/setup`.
- **Encryption at Rest:** TOTP secrets are encrypted using **AES-256-GCM** (`encryptMfaSecret()`) with a 12-byte random IV and 16-byte authentication tag, keyed by `SHA-256("muxaro:mfa:v1:" + (MFA_ENCRYPTION_KEY || SESSION_SECRET))`, stored as `v1:<iv>:<tag>:<ciphertext>` in `user_mfa.secret`.
- **Mandatory for Admins:** All `/api/v1/admin/*` management routes reject any admin session where `mfaEnabled === false` or `session.mfaVerified === false` (`403 ERR_ADMIN_MFA_REQUIRED`).

---

## 7. CSRF Protection (`verifyCsrf`)

All state-mutating (`POST`, `PUT`, `PATCH`, `DELETE`) cookie-authenticated requests must pass `verifyCsrf()`:
1. `x-muxaro-csrf` request header must be present and match `auth.session.csrfToken` (synchronizer token check using `timingSafeStringEqual`).
2. If the `muxaro_csrf` cookie is present, `x-muxaro-csrf` must also match it (double-submit check).
3. Failures emit a `HIGH`-severity `CSRF_REJECTED` security event and return HTTP `403 ERR_CSRF_INVALID`.
4. Bearer-authenticated API calls (without session cookies) and safe read-only methods (`GET`, `HEAD`, `OPTIONS`) are exempt.
