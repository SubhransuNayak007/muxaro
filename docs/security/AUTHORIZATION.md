# MUXARO Authorization, RBAC & IDOR Defense

**Primary Implementations:**
- `apps/api/src/middleware/auth.middleware.ts` (`requireAuth`, `requireAdminMfa`)
- `apps/api/src/services/request-identity.ts` (`resolveCallerIdentity`, `isOwnerOrAdmin`)
- `apps/api/src/services/entitlements.service.ts` (tier policies & rolling quotas)
- `apps/api/src/services/admin.service.ts` (`syncBootstrapAdminFromEnv`, audit logging)
- `packages/entitlements/src/auth/rbac.ts`

---

## 1. Role & Tier Model

MUXARO enforces orthogonal **Role** (what administrative capabilities an actor has) and **Account Tier** (what processing limits and queue priority an actor receives):

### 1.1 Roles

| Role | Access Scope | Elevation Mechanism |
| :--- | :--- | :--- |
| **`GUEST`** | Unauthenticated visitor identified by `HttpOnly` `muxaro_guest` cookie; can inspect URLs, upload files, run individual jobs within guest quotas, and download own artifacts | Automatic on first unauthenticated request |
| **`USER`** | Authenticated account (`muxaro_session` cookie or Bearer token); owns profile, sessions, job/batch history, rolling daily credits, and optional rewarded ad sessions | Email registration or Google OAuth sign-in |
| **`ADMIN`** | All `USER` permissions plus Admin Control Centre (`/api/v1/admin/*`) **only when TOTP MFA is enabled and verified on the active session** | Strictly controlled via `MUXARO_ADMIN_EMAIL` environment allowlist (`adminService.syncBootstrapAdminFromEnv()`); zero hardcoded backdoor credentials |

### 1.2 Account Tiers & Entitlement Limits (`database.ts` `DEFAULT_SYSTEM_SETTINGS`)

| Tier | Individual Jobs / 24h | Playlist Jobs / 24h | Max Concurrent Jobs | Queue Priority Weight | Rewarded Ad Extra Credits |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`GUEST`** | `3` | `0` | `1` | `1` (`GUEST`) | Not eligible |
| **`FREE`** (Registered) | `10` (up to `16` with verified rewarded ads) | `1` (max `50` items) | `2` | `3` (`REGISTERED`) | `+2` per verified ad, cap `3` ads / 24h (expires in 24h) |
| **`PREMIUM`** | `100` | `10` (max `50` items) | `5` | `6` (`PREMIUM`) | Admin-adjustable via `system_settings` |

> **Anti-Starvation Fairness:** Priority weights (`PREMIUM: 6 > REGISTERED: 3 > GUEST: 1`) are bounded by an aging boost (`+1` weight every `5s` waited, capped at `+12` in `queue.service.ts`) so guest jobs are never starved under sustained load.

---

## 2. Route Authorization Matrix

| Route Group | Auth Guard | CSRF Required | Additional Checks |
| :--- | :--- | :---: | :--- |
| `GET /api/v1/health`, `/ready`, `/admin/metrics` | Public | No | Read-only; zero secrets or PII returned |
| `POST /api/v1/auth/register`, `/login`, `/forgot-password`, `/reset-password`, `/verify-email` | Public | No | Multi-layer IP/account rate limits + anti-enumeration |
| `GET /api/v1/auth/session` | Optional (`resolveRequestAuth`) | No | Returns `authenticated: false` for guests |
| `POST /api/v1/auth/logout`, `/logout-all`, `/mfa/*` | `requireAuth` | Yes (cookie) | Active non-revoked session required |
| `GET / PATCH /api/v1/me`, `GET / DELETE /api/v1/me/sessions/*` | `requireAuth` | Yes (mutating) | Strict session ownership check |
| `GET /api/v1/entitlements/*`, `/account/*` | `resolveCallerIdentity` | N/A | Scoped strictly to caller's `userId` (authenticated or guest) |
| `POST /api/v1/rewards/sessions`, `GET /api/v1/rewards/sessions/:id` | `requireAuth` | Yes (`POST`) | Authenticated user only; max 1 active pending session; owner-checked |
| `GET / POST /api/v1/rewards/provider-callback` | Provider SSV Signature | No | Cryptographic ECDSA-SHA256 verification against Google verifier keys + HMAC `custom_data` |
| `POST / GET /api/v1/jobs/*`, `/batches/*`, `/tools/*`, `/playlists/*` | `resolveCallerIdentity` | Yes (cookie) | Atomic quota reservation + `isOwnerOrAdmin()` on all read/cancel/retry/download operations |
| `GET /api/v1/download/:token` | Signed HMAC Token + Caller Identity Check | No | Verifies HMAC-SHA256 signature, expiration, `artifact.ownerUserId === payload.userId`, AND blocks any authenticated caller who is neither owner nor MFA-verified admin |
| `/api/v1/admin/search`, `/users*`, `/settings`, `/rewards`, `/analytics`, `/audit-logs`, `/security-events` | `requireAdminMfa` | Yes (mutating) | `role === 'admin'` + `mfaEnabled === true` + `session.mfaVerified === true` + `admin_api` rate limit (`60/min`) |

---

## 3. Strict IDOR (Insecure Direct Object Reference) Defense

Every tenant-owned resource (`processing_jobs`, `batches`, `output_artifacts`, `reward_sessions`, `user_sessions`) enforces ownership via `isOwnerOrAdmin()` in `apps/api/src/services/request-identity.ts`:

```ts
if (!resourceOwnerUserId) return false;
if (caller.userId === resourceOwnerUserId) return true;
if (caller.role === 'ADMIN' && caller.mfaVerified) return true;
// Otherwise records IDOR_ATTEMPT in security_events and returns false
```

### Defense Layers
1. **Non-Predictable Resource IDs:** Job IDs (`MXJ-XXXXXXXXXX`), Batch IDs (`MXB-YYYYMMDD-XXXXXX`), and Reward Session IDs (`MXRWD-XXXXXXXXXXXX`) use CSPRNG Base32 suffixes—never auto-incrementing integers.
2. **Dual Verification on Signed Downloads (`routes/download.ts`):**
   - Verifies the HMAC-SHA256 token signature (`tokenService.verifyDownloadToken`) and expiration.
   - Confirms `artifact.ownerUserId === payload.userId`.
   - If the HTTP request carries an authenticated session cookie or `Authorization` header belonging to a *different* user, rejects with HTTP `403 ERR_FORBIDDEN` and logs an `IDOR_ATTEMPT` security event.
3. **Verified Coverage:** Gate `G3-IDOR` in `qa/harness/verify-account-platform.mjs` empirically tests 9 cross-account IDOR vectors (batch read/jobs/cancel, job read/cancel/retry/download, signed download, session deletion) and confirms 9/9 are blocked with `403` / `404`.

---

## 4. Admin Audit Accountability

Every administrative mutation executed through `/api/v1/admin/*` atomically records an immutable row in `admin_audit_logs`:
- `USER_SUSPEND` (previous status, reason, revoked session count)
- `USER_RESTORE`
- `USER_REVOKE_SESSIONS`
- `SETTINGS_UPDATE` (exact `before` and `after` values for modified `system_settings`)
- `ADMIN_BOOTSTRAP_PROMOTE`

No API endpoint permits modifying or deleting rows in `admin_audit_logs` or `security_events`.
