# Consolidated System & Architecture Mermaid Diagrams

**Project:** MUXARO  
**Purpose:** Single visual reference consolidating verified Mermaid diagrams grounded strictly in the implemented codebase (`apps/api`, `apps/media-worker`, `apps/web`, `packages/*`, `security/`, `infra/`).

---

## 1. Global System Architecture (Implemented Runtime)

```mermaid
flowchart TD
    subgraph Client ["Client Layer"]
        Web["Next.js 14 Web App (apps/web :3000)"]
        CLI["REST / SSE / Range Clients"]
    end

    subgraph API ["Fastify 5 API Server (apps/api :4000)"]
        Hooks["CORS + Rate Limit + Duplicate Flood + Security Headers"]
        Auth["Auth Middleware (Cookie / Bearer / Guest / CSRF / Admin MFA)"]
        Routes["69 REST & SSE Endpoints (/api/v1/*) + /docs"]
        Core["Domain Services (Auth, Entitlements, Rewards SSV, Admin, Token, Storage)"]
        Queue["TurboFlow 6-Class / 3-Tier Priority Queue"]
    end

    subgraph Packages ["Shared Packages"]
        Sec["security/ (SSRF Guard, FFmpeg Sanitizer, Validation)"]
        Adp["packages/source-adapters (DirectMedia, YouTubePermitted)"]
        Ent["packages/entitlements (Quota Engine & Types)"]
    end

    subgraph Compute ["Media Execution"]
        Subproc["Child Processes (yt-dlp, ffmpeg, ffprobe - shell:false)"]
        Worker["Standalone Media Worker (apps/media-worker :3002)"]
    end

    subgraph Data ["Persistence & Storage"]
        SQLite[("SQLite WAL (.muxaro-data/muxaro.db - 22 Tables)")]
        Disk["Local Ephemeral Disk (.muxaro-artifacts & .muxaro-uploads)"]
        R2["Cloudflare R2 (Pure-Node AWS SigV4 - Env-Gated)"]
    end

    Web & CLI --> Hooks --> Auth --> Routes
    Routes --> Core & Queue
    Core & Queue --> Sec & Adp & Ent
    Core & Queue -->|"BEGIN IMMEDIATE"| SQLite
    Queue --> Subproc --> Disk
    Core -->|"When R2_* Set"| R2
    Worker -.->|"Independent FFmpeg REST Service"| Disk
```

---

## 2. Database Entity-Relationship Diagram (All 22 Implemented Tables)

```mermaid
erDiagram
    users ||--o{ oauth_accounts : "CASCADE"
    users ||--o{ user_sessions : "CASCADE"
    users ||--o{ email_verifications : "CASCADE"
    users ||--o{ password_resets : "CASCADE"
    users ||--o| user_mfa : "CASCADE"

    users ||--o| entitlements : "logical user_id"
    users ||--o{ quota_reservations : "logical user_id"
    users ||--o{ credit_ledger : "logical user_id"
    users ||--o{ reward_sessions : "logical user_id"
    users ||--o{ media_assets : "logical owner_user_id"
    users ||--o{ batches : "logical owner_user_id"
    users ||--o{ processing_jobs : "logical owner_user_id"
    users ||--o{ output_artifacts : "logical owner_user_id"
    users ||--o{ security_events : "logical user_id"
    users ||--o{ admin_audit_logs : "logical admin_user_id"
    users ||--o{ analytics_events : "logical user_id"

    reward_sessions ||--o{ reward_provider_events : "logical session_id"
    batches ||--o{ processing_jobs : "SET NULL"
    processing_jobs ||--o{ job_events : "CASCADE"
    processing_jobs ||--o{ output_artifacts : "logical job_id"
    processing_jobs }o--o| quota_reservations : "logical reservation_id"

    oauth_states {
        text state PK
        text nonce
        text code_verifier
        text expires_at
    }
    rate_limit_counters {
        text bucket_key PK
        int hits
        int window_start_ms
        int blocked_until_ms
    }
    system_settings {
        text key PK
        text value
        text updated_by
    }
```

---

## 3. TurboFlow Queue Architecture & 3-Tier Fair Priority Scheduler

```mermaid
flowchart LR
    Sub["Job Admission (Backpressure <= 200 waiting)"]
    Strat["selectTurboFlowStrategy()"]

    subgraph Lanes ["6 Isolated Queue Classes"]
        C1["instant-processing (cap: 4)"]
        C2["audio-processing (cap: 4)"]
        C3["merge-processing (cap: 2)"]
        C4["video-transcoding (cap: 2)"]
        C5["high-resolution-processing (cap: 1)"]
        C6["playlist-packaging (cap: 1)"]
    end

    subgraph Priority ["3-Tier Fair Priority Scoring"]
        P1["PREMIUM: base 6 (max 5/user)"]
        P2["REGISTERED: base 3 (max 2/user)"]
        P3["GUEST: base 1 (max 1/user)"]
        Aging["Anti-Starvation Aging (+1 per 5s waited, cap +12) + Round-Robin User Penalty"]
    end

    Exec["Safe Subprocess Execution (yt-dlp / ffmpeg / ffprobe)"]

    Sub --> Strat
    Strat --> C1 & C2 & C3 & C4 & C5 & C6
    C1 & C2 & C3 & C4 & C5 & C6 --> P1 & P2 & P3
    P1 & P2 & P3 --> Aging --> Exec
```

---

## 4. Job Lifecycle State Machine

```mermaid
stateDiagram-v2
    [*] --> QUEUED: POST /api/v1/jobs (Quota RESERVED)
    QUEUED --> PROCESSING: Fair Priority Scheduler Dispatches
    QUEUED --> CANCELLED: POST /jobs/:id/cancel (Quota RELEASED)

    PROCESSING --> VERIFYING: yt-dlp / ffmpeg Exit 0
    PROCESSING --> CANCELLED: Kill ChildProcess + Cleanup (Quota RELEASED)
    PROCESSING --> FAILED: Subprocess Error / 10m Timeout (Quota RELEASED)

    VERIFYING --> READY: ffprobe Valid + SHA-256 + HMAC Token (Quota COMMITTED)
    VERIFYING --> FAILED: Corrupt / 0-Byte Output (Quota RELEASED)

    FAILED --> QUEUED: POST /jobs/:id/retry (attempts < 3)
    READY --> EXPIRED: 60-Min Retention TTL Cleanup

    CANCELLED --> [*]
    EXPIRED --> [*]
```

---

## 5. Atomic Quota Reservation & Immutable Ledger Flow

```mermaid
sequenceDiagram
    participant API as Fastify Route (/jobs, /batches, /playlists/jobs)
    participant Ent as EntitlementsService
    participant DB as SQLite WAL (BEGIN IMMEDIATE)
    participant Q as QueueService

    API->>Ent: reserveQuota(userId, jobType, idempotencyKey)
    Ent->>DB: BEGIN IMMEDIATE
    Ent->>DB: Expire stale RESERVED rows (TTL > 30m)
    Ent->>DB: Sweep expired extra reward lots -> append CREDIT_EXPIRED
    Ent->>DB: Count rolling 24h base usage in quota_reservations
    alt Individual Bucket & Base Remaining > 0
        Ent->>DB: INSERT quota_reservations (source='base', status='RESERVED')
    else Individual Bucket & Extra Reward Credits > 0
        Ent->>DB: INSERT quota_reservations (source='extra', status='RESERVED')
        Ent->>DB: INSERT credit_ledger (entry_type='CREDIT_RESERVED', delta=-1)
    else Playlist Bucket & Base Remaining > 0
        Note over Ent,DB: Extra reward credits NEVER apply to playlist bucket
        Ent->>DB: INSERT quota_reservations (bucket='playlist', source='base', status='RESERVED')
    else Quota Exhausted
        Ent->>DB: ROLLBACK
        Ent-->>API: 409 ERR_QUOTA_EXCEEDED
    end
    Ent->>DB: Upsert entitlements snapshot -> COMMIT
    Ent-->>API: reservationId
    API->>Q: Enqueue Job (MXJ-...)
    alt Job Completes & Passes FFprobe Verification
        Q->>Ent: commitQuota(reservationId)
        Ent->>DB: BEGIN IMMEDIATE -> status='COMMITTED' + append CREDIT_CONSUMED -> COMMIT
    else Job Fails or Cancelled
        Q->>Ent: rollbackQuota(reservationId)
        Ent->>DB: BEGIN IMMEDIATE -> status='RELEASED' + append CREDIT_RELEASED -> COMMIT
    end
```

---

## 6. Rewarded Ads Server-Side Verification (GAM SSV) Flow

```mermaid
sequenceDiagram
    actor User as Authenticated User
    participant API as Fastify API (/api/v1/rewards/*)
    participant Rwd as RewardsService
    participant DB as SQLite WAL (muxaro.db)
    participant GAM as Google Ad Manager SSV

    User->>API: POST /api/v1/rewards/sessions
    API->>Rwd: createRewardSession(userId)
    Rwd->>DB: BEGIN IMMEDIATE -> check active PENDING (max 1) & 24h cap (max 3)
    Rwd->>Rwd: HMAC-SHA256 sign customData { s, u, exp }
    Rwd->>DB: INSERT reward_sessions (MXRWD-..., PENDING, 10m TTL) -> COMMIT
    API-->>User: 201 Created { sessionId, adUnitPath, customData }

    User->>GAM: Watch Rewarded Ad (passes customData)
    GAM->>API: GET/POST /api/v1/rewards/provider-callback?signature=...&key_id=...&transaction_id=...&custom_data=...
    API->>Rwd: verifyAndProcessProviderCallback()
    Rwd->>GAM: Resolve ECDSA public key for key_id (12h cache)
    Rwd->>Rwd: Verify ECDSA-SHA256 (DER / IEEE P1363) + HMAC custom_data
    Rwd->>DB: BEGIN IMMEDIATE
    alt Duplicate provider_transaction_id
        Rwd->>DB: INSERT security_events (REWARD_REPLAY_DETECTED) -> COMMIT
        API-->>GAM: 200 OK { duplicate: true, creditsGranted: 0 }
    else Valid First-Time Settlement
        Rwd->>DB: INSERT reward_provider_events (UNIQUE provider_transaction_id)
        Rwd->>DB: UPDATE reward_sessions SET status='VERIFIED'
        Rwd->>DB: INSERT credit_ledger (REWARD_GRANTED, +2, expires +24h)
        Rwd->>DB: UPDATE entitlements.extra_credits_balance -> COMMIT
        API-->>GAM: 200 OK { processed: true, creditsGranted: 2 }
    end
    User->>API: POST /api/v1/rewards/sessions/:id/refresh
    API-->>User: 200 OK { status: "VERIFIED", creditsGranted: 2, quota }
```

---

## 7. Authentication & Admin MFA Sequence

```mermaid
sequenceDiagram
    actor Client as Browser / Client
    participant API as Fastify API (/api/v1/auth/* & /admin/*)
    participant Auth as AuthService + MfaService
    participant DB as SQLite WAL
    participant Google as Google OIDC & JWKS

    alt Email & Password + Optional MFA
        Client->>API: POST /api/v1/auth/login { email, password, mfaCode? }
        API->>Auth: Check IP (20/15m) & Account failure backoff (5/15m)
        Auth->>DB: Fetch user + Argon2id/Scrypt constant-time verify
        Auth->>DB: INSERT user_sessions (SHA-256 token_hash, csrf_token, mfa_verified)
        API-->>Client: 200 OK + Set-Cookie: muxaro_session (HttpOnly) + muxaro_csrf
    else Google OAuth 2.0 PKCE (S256)
        Client->>API: GET /api/v1/auth/google/start
        API->>DB: INSERT oauth_states (state, nonce, code_verifier, 10m TTL)
        API-->>Client: 302 Google Auth + Set-Cookie: muxaro_oauth_state
        Client->>Google: Consent
        Google-->>Client: 302 /api/v1/auth/google/callback?code=...&state=...
        Client->>API: GET /api/v1/auth/google/callback
        API->>Google: Exchange code + code_verifier -> Verify RS256 id_token via JWKS
        API->>DB: Upsert users + oauth_accounts + INSERT user_sessions
        API-->>Client: 302 Frontend + Set-Cookie: muxaro_session + muxaro_csrf
    end

    Client->>API: GET /api/v1/admin/analytics (Cookie + x-muxaro-csrf)
    API->>Auth: requireAdminMfa (role=admin AND mfaEnabled AND session.mfaVerified)
    API-->>Client: 200 OK (DB-derived Analytics) or 403 ERR_ADMIN_MFA_REQUIRED
```

---

## 8. Deployment Topology & Network Security Boundaries

```mermaid
flowchart TB
    subgraph Internet ["Zone 0: Public Internet (Untrusted)"]
        Users["Users (Web / Mobile / CLI)"]
        External["Google OAuth / GAM SSV / Public Media Hosts"]
    end

    subgraph Edge ["Zone 1: Edge & Ingress"]
        CF["Cloudflare Edge (DNS, TLS, WAF)"]
        Ingress["Cloud Run Public Ingress / AWS ALB"]
    end

    subgraph AppTier ["Zone 2: Application Tier (frontend-net / app subnets)"]
        WebSvc["apps/web (Next.js 14 :3000)"]
        ApiSvc["apps/api (Fastify 5 :4000 / :8080, minScale=0 maxScale=2)"]
        SSRF["SSRF Guard Egress Filter"]
    end

    subgraph InternalTier ["Zone 3: Internal Compute & Data (backend-net / data-net / internal ingress)"]
        WorkerSvc["apps/media-worker (Internal-Only Ingress, :3002 / :5000 / :8080)"]
        DBTier[("Active: SQLite WAL | Provisioned: PostgreSQL 16 (RDS / Docker)")]
        Broker["Provisioned: Redis 7 / AWS SQS"]
        ObjStore["Active: Local Disk or Cloudflare R2 (SigV4) | Provisioned: MinIO / S3"]
    end

    Users -->|"HTTPS 443"| CF --> Ingress
    Ingress --> WebSvc & ApiSvc
    WebSvc --> ApiSvc
    ApiSvc --> DBTier & ObjStore
    ApiSvc --> SSRF -->|"Public HTTP/HTTPS Only"| External
    ApiSvc -.->|"Internal Network Only"| WorkerSvc
    ApiSvc -.->|"Provisioned IaC"| Broker -.-> WorkerSvc
    WorkerSvc --> ObjStore
```
