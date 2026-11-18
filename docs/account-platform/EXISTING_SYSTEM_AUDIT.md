# MUXARO Existing System Audit — Account Platform Readiness
**Product:** MUXARO — *Your Media. One Powerful Workspace.*  
**Author:** AGENT 01 — Principal Architect & System Designer  
**Date:** 18 November 2026  
**Scope:** Empirical audit of `apps/api/`, `apps/web/`, `packages/entitlements/`, and `infra/` prior to Account Platform, Auth, Priority Scheduling, Rewarded Quotas, Admin MFA, and GA4 Consent Mode v2 rollout.

---

## 1. Executive Summary

MUXARO's core media processing engine (TurboFlow 3-lane execution, 6-class smart queues, `(height, fpsBucket, hdr)` deduplicated manifests, resumable multipart uploads, and `ETag`/`If-Range`/`206`/`416` streaming delivery) is verified and production-clean (`141` QA sign-off: GO). However, auditing the repository reveals that **multi-user account infrastructure, durable relational persistence, strict tenant/owner isolation, server-verified rewarded quotas, admin MFA governance, and consent-first analytics are not yet implemented**.

---

## 2. Subsystem-by-Subsystem Gap Analysis

### 2.1 API Gateway & Routing (`apps/api/src/app.ts`)
- **Current State (`apps/api/src/app.ts:15–22, 35–40, 117–128`):**
  - Registers 8 route groups under `/api/v1`: `health`, `media`, `jobs`, `tools`, `playlists`, `account`, `admin`, `download`.
  - CORS allows `['Content-Type', 'Authorization', 'Idempotency-Key', 'x-request-id', 'x-file-name']` with `origin: config.corsOrigin` and `credentials: true`.
- **Gaps Identified:**
  1. No `auth`, `me`, `entitlements`, `rewards`, or `batches` route groups registered.
  2. Missing `x-muxaro-csrf` in CORS `allowedHeaders`, and `origin: '*'` breaks browser `credentials: 'include'` cookie delivery unless exact request origin is reflected.
  3. No cookie-based session resolution middleware (`muxaro_session` HttpOnly cookie + `muxaro_csrf` double-submit token).

### 2.2 Persistence Layer (`apps/api/src/services/`)
- **Current State:**
  - `queue.service.ts`, `adapter.service.ts`, and `entitlements.service.ts` store job state, media manifests, and quota ledgers exclusively in Node.js in-memory `Map` structures.
  - PostgreSQL DDL exists in `docs/architecture/schema.sql` and `infra/scripts/init-db.sql`, but local/single-node runtime loses all user accounts, sessions, batches, jobs, credit ledgers, and audit history on restart.
- **Required Upgrade:** Introduce a durable relational database layer (`apps/api/src/db/database.ts`) using Node 24 native `node:sqlite` (`DatabaseSync` at `.muxaro-data/muxaro.db`, WAL mode, `PRAGMA foreign_keys = ON`) implementing all 22 Account Platform tables mirroring the PostgreSQL production schema.

### 2.3 Identity, Authentication & Access Control (`packages/entitlements/src/auth/`, `apps/api/`)
- **Current State:**
  - `packages/entitlements/src/auth/` contains helper primitives (`crypto.ts`, `rbac.ts`, `session.ts`), but no live API endpoints exist for registration, login, email verification, password reset, Google OAuth 2.0 + PKCE (S256), session listing/revocation, or Admin TOTP MFA.
  - Jobs and downloads rely on guest/default identities without strict owner-to-resource IDOR enforcement.
- **Required Upgrade:**
  - Full Argon2id (Node 24 `crypto.argon2`) / hardened `scryptSync` password hashing, HttpOnly rotating sessions, CSRF protection, Google OAuth 2.0 + PKCE + state/nonce + Google JWKS verification, RFC 6238 TOTP MFA for Admin accounts, and strict ownership verification on every job, batch, download, reward session, and session deletion endpoint.

### 2.4 Queue Scheduling & Batch Tracking (`apps/api/src/services/queue.service.ts`)
- **Current State:**
  - Supports 6-class TurboFlow lane separation (`instant-processing`, `audio-processing`, `merge-processing`, `video-transcoding`, `high-resolution-processing`, `playlist-packaging`).
  - Lacks 3-tier account priority scheduling (`PREMIUM > REGISTERED > GUEST`), anti-starvation aging, structured `MXB-YYYYMMDD-XXXXXX` batch records with `001`/`002`/`003` item numbering, and `MXJ-XXXXXXXXXX` job identifiers.
- **Required Upgrade:** Persist jobs, job events, batches, and artifacts in SQLite; enforce weighted 3-tier priority (`6:3:1`) with anti-starvation aging and per-tier wait/duration telemetry.

### 2.5 Quotas, Immutable Credit Ledger & Rewarded Ads (`packages/entitlements/`, `apps/api/src/services/entitlements.service.ts`)
- **Current State:**
  - Tracks rolling 24h allowance (10 individual video jobs, 1 playlist job) via `entitlements.service.ts`.
  - Lacks tier-aware policy (`GUEST` restricted default 3/24h & 0 playlists vs. `REGISTERED` 10/24h & 1 playlist vs. `PREMIUM`), dynamic `system_settings` configuration, +2 extra credits per verified rewarded ad (cap 3/24h -> max 16 individual jobs, 24h rolling expiry, playlist unchanged), and Google Ad Manager Server-Side Verification (SSV ECDSA SHA-256 + unique `provider_transaction_id` replay prevention).
- **Required Upgrade:** Implement transactional SQLite-backed `credit_ledger` + `rewards.service.ts` where credits are granted **exclusively** by cryptographically verified server callbacks — never by client flags.

### 2.6 Multi-Layer Rate Limiting, Abuse Prevention & Admin Control (`security/`, `apps/api/src/routes/admin.ts`)
- **Current State:**
  - `security/` provides SSRF protection, FFmpeg argument sanitization, and a single-dimension `RateLimiter`.
  - `apps/api/src/routes/admin.ts` exposes only basic queue metrics (`/api/v1/admin/metrics`) with no admin authentication, no support search (`MXR-`/`MXB-`/`MXJ-`/`req_`), no user suspension/session revocation, no live `system_settings` tuning, no reward fraud telemetry, and no immutable `audit_logs` / `security_events`.
- **Required Upgrade:** Separate multi-dimensional rate limiting (account, IP, session, endpoint, concurrency) from daily quotas, keep polling unthrottled, and gate all privileged `/admin/*` endpoints behind `requireAdminMfa`.

### 2.7 Frontend Auth, Analytics & Consent (`apps/web/`)
- **Current State:**
  - Zero auth UI (no Sign In / Register / Forgot Password / Google OAuth / Account & Sessions / Admin Console views), zero `AuthProvider` cookie-session context, zero pending-task preservation across login redirects, zero GA4 + Google Consent Mode v2 integration, and zero rewarded-credit UI.
- **Required Upgrade:**
  - Cookie-only `AuthContext` (`credentials: 'include'`, zero tokens in `localStorage`), GA4 + Consent Mode v2 (denied by default) + strict PII scrubber, accessible Consent Banner, Login/Register/Account/Admin pages, and honest gated Rewarded Credits flow.

---
*Grounded in direct workspace inspection of `apps/api/src/app.ts`, `apps/api/src/services/*`, `packages/entitlements/src/*`, `apps/web/*`, and `infra/*`.*
