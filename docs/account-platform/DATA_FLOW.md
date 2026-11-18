# MUXARO Account Platform — End-to-End Data & Security Flows
**Product:** MUXARO — *Your Media. One Powerful Workspace.*  
**Author:** AGENT 01 — Principal Architect & System Designer  
**Date:** 18 November 2026  

---

## 1. Email Registration, Verification & Cookie Session Flow

```mermaid
sequenceDiagram
    participant Browser as Next.js Web Client
    participant API as Fastify /api/v1/auth
    participant Auth as AuthService (Argon2id/Scrypt)
    participant DB as SQLite/PostgreSQL (22 Tables)

    Browser->>API: POST /auth/register { email, password, displayName }
    API->>Auth: Validate password (>=8, mixed classes, <=128)
    Auth->>Auth: Hash password (Argon2id / scryptSync + 16B salt)
    Auth->>DB: INSERT users (UUIDv7 internal id, MXR-XXXXXXXX public id)
    Auth->>DB: INSERT email_verifications (SHA-256 hashed 6-digit code, 15m TTL, max 5 attempts)
    Auth->>DB: INSERT sessions (SHA-256 token_hash, csrf_token)
    API-->>Browser: 201 Set-Cookie: muxaro_session (HttpOnly, SameSite=Lax), muxaro_csrf
    Browser->>API: POST /auth/verify-email { code } + x-muxaro-csrf
    API->>DB: Constant-time hash compare, mark email_verified=1, consume token
    API-->>Browser: 200 { verified: true }
```

---

## 2. Google OAuth 2.0 Authorization Code + PKCE (S256) Flow

```mermaid
sequenceDiagram
    participant Browser as User Browser
    participant API as Fastify /api/v1/auth/google
    participant DB as oauth_states + users + sessions
    participant Google as Google OAuth2 / Token / JWKS

    Browser->>API: GET /auth/google/start?returnTo=/dashboard
    API->>API: Check GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI (503 if unset)
    API->>API: Validate safe relative returnTo (block open redirects)
    API->>DB: Store SHA-256(state), PKCE code_verifier, nonce, returnTo (10m TTL)
    API-->>Browser: 302 Redirect -> accounts.google.com (PKCE S256, scope="openid email profile") + HttpOnly state cookie
    Browser->>Google: Authenticate & consent
    Google-->>Browser: 302 -> /api/v1/auth/google/callback?code=...&state=...
    Browser->>API: GET /auth/google/callback?code=...&state=... (with HttpOnly state cookie)
    API->>DB: Verify state matches cookie & unconsumed oauth_states row
    API->>Google: POST oauth2.googleapis.com/token (code + code_verifier + client_secret)
    Google-->>API: { id_token, access_token }
    API->>Google: Fetch JWKS (googleapis.com/oauth2/v3/certs) & verify JWT signature, iss, aud, exp, nonce, email_verified===true
    API->>DB: Upsert user + oauth_accounts + rotate session
    API-->>Browser: 302 -> safe returnTo with Set-Cookie: muxaro_session (HttpOnly)
```

---

## 3. Three-Tier Priority Queue, Batch Execution & IDOR Isolation Flow

```mermaid
sequenceDiagram
    participant User as Authenticated / Guest Client
    participant API as Fastify (/batches, /jobs, /download)
    participant RL as Multi-Layer RateLimiter
    participant Ent as EntitlementsService
    participant Q as 6-Class Priority QueueService
    participant DB as SQLite (batches, jobs, artifacts)

    User->>API: POST /api/v1/batches or /api/v1/jobs (+ x-muxaro-csrf)
    API->>RL: Check account/IP/endpoint/concurrency limit (429 + Retry-After on breach)
    API->>Ent: Atomic quota reservation (Guest 3/24h | Free 10+rewards/24h | Premium)
    API->>Q: Enqueue with MXJ- ID, MXB- batchId, itemNumber (001..N), tier weight (6:3:1) + aging
    Q->>DB: Persist job + job_events (survives browser tab close)
    Q->>Q: TurboFlow lane execution (Instant / Smart / Power)
    Q->>DB: Persist output_artifacts (SHA-256, 60m TTL) & consume reservation
    User->>API: GET /api/v1/jobs/:id or /api/v1/download/:token
    API->>DB: Verify owner_user_id === actor.userId (or matching guest_id) -> 403/404 + security_events on IDOR
    API-->>User: 200 / 206 Partial Content (ETag, Last-Modified, If-Range)
```

---

## 4. Google Ad Manager Rewarded Ad SSV (Server-Side Verification) Flow

```mermaid
sequenceDiagram
    participant User as Authenticated Browser
    participant API as Fastify /api/v1/rewards
    participant GAM as Google Ad Manager (GPT)
    participant DB as SQLite (reward_sessions, credit_ledger)

    User->>API: GET /api/v1/rewards/config
    API-->>User: { enabled, configured, adUnitPath, rewardAmount: 2, dailyCap: 3, remainingAdsToday }
    User->>API: POST /api/v1/rewards/sessions (+ x-muxaro-csrf)
    API->>DB: Verify auth, max 1 active PENDING session, cap < 3/24h -> INSERT MXRWD-...
    API-->>User: { sessionId, adUnitPath, customData (HMAC-signed sessionId+userId) }
    User->>GAM: Display optional rewarded ad with customData
    GAM->>API: GET/POST /api/v1/rewards/provider-callback?signature=...&key_id=...&transaction_id=...&custom_data=...
    API->>API: Verify ECDSA SHA-256 signature against Google Verifier Keys + verify HMAC custom_data
    API->>DB: BEGIN TX: Insert UNIQUE provider_transaction_id (idempotent no-op if replay!)
    API->>DB: UPDATE reward_sessions='VERIFIED' + INSERT credit_ledger (REWARD_GRANTED, +2, expires_at=+24h)
    API-->>GAM: 200 OK
    User->>API: POST /api/v1/rewards/sessions/:id/refresh
    API->>DB: Verify owner & read server status (NEVER grants from client!)
    API-->>User: { status: "VERIFIED", updatedQuota }
```

---

## 5. Admin TOTP MFA & Privileged Control Centre Flow

```mermaid
sequenceDiagram
    participant Admin as Admin User
    participant API as Fastify /api/v1/auth/mfa & /admin
    participant DB as SQLite (users, sessions, audit_logs)

    Admin->>API: POST /auth/mfa/setup -> returns Base32 secret + otpauth:// URI
    Admin->>API: POST /auth/mfa/verify { code } (RFC 6238 HMAC-SHA1, 30s ±1 step)
    API->>DB: Enable mfa_enabled=1, set sessions.mfa_verified=1
    Admin->>API: PATCH /api/v1/admin/settings { rewardCreditsPerAd: 2 } (+ x-muxaro-csrf)
    API->>API: requireAdminMfa -> confirms role==='admin' && session.mfaVerified===true
    API->>DB: UPDATE system_settings + INSERT immutable audit_logs
    API-->>Admin: 200 Updated settings
```

---

## 6. Privacy-First Analytics (GA4 + Consent Mode v2 + PII Scrubber)

```mermaid
flowchart LR
    Init["Page Load"] --> Default["Consent Mode v2 Default:\nanalytics_storage: denied\nad_storage: denied\nad_user_data: denied\nad_personalization: denied"]
    Default --> Banner["ConsentBanner.tsx\n(Accept all / Essential only / Customize)"]
    Banner -->|User Accepts Analytics| Update["gtag('consent', 'update', { analytics_storage: 'granted' })"]
    Auth["AuthContext Session"] -->|Authenticated| UID["GA4 user_id = opaque internal UUIDv7\n(NEVER email/name; cleared to null on logout)"]
    Events["trackEvent(name, params)"] --> Scrub["Strict PII Scrubber\n(Strips emails, names, raw URLs,\ntokens, session IDs, filenames)"]
    Scrub --> GA4["gtag('event', name, cleanParams)"]
```
