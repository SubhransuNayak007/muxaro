# Data Flow Architecture

**Project:** MUXARO  
**Scope:** End-to-end synchronous and asynchronous data flows across authentication, media inspection, local uploads, job execution, batches/playlists, rewarded ads SSV, and signed downloads.

---

## 1. Media Inspection & Local Upload Flow

MUXARO supports two ingestion paths: **external URL inspection** and **local file upload** (single-stream or resumable multipart up to 2 GB).

```mermaid
sequenceDiagram
    actor User as Client Browser
    participant API as Fastify API (/api/v1/media/*)
    participant SSRF as SSRF Guard (@muxaro/security)
    participant Adapter as AdapterService
    participant Tools as yt-dlp / ffprobe
    participant Disk as Local Disk (.muxaro-uploads)

    alt External URL Inspection
        User->>API: POST /api/v1/media/inspect { url, rightsDeclared }
        API->>API: Validate schema + rate limit (10/min/account)
        API->>SSRF: validateUrlForSsrf(url)
        SSRF-->>API: Safe public IP / Hostname
        API->>Adapter: inspect(url)
        Adapter->>Tools: execFile("yt-dlp", ["--dump-single-json", "--no-playlist", "--skip-download", url])
        Tools-->>Adapter: Stream metadata JSON (resolutions, codecs, fps, HDR, sizes)
        Adapter->>Adapter: Deduplicate variants + mark 1 recommended stream + cache assetId
        API-->>User: 200 OK { assetId, title, streams[], availableFormats, rightsCheck }
    else Resumable Multipart Upload (<= 2 GB)
        User->>API: POST /api/v1/media/upload/init { filename, totalSize, totalParts, sha256? }
        API-->>User: 200 OK { uploadId, chunkSizeHint: 5MB, expiresAt }
        loop For part 1..totalParts (idempotent retries)
            User->>API: PUT /api/v1/media/upload/:uploadId/part/:partNumber (binary stream)
            API->>Disk: Stream to tmp file -> atomic rename part_N
            API-->>User: 200 OK { receivedParts, totalParts }
        end
        User->>API: POST /api/v1/media/upload/:uploadId/complete
        API->>Disk: Stream-concatenate parts + compute SHA-256 (constant RAM)
        API->>Tools: execFile("ffprobe", ["-print_format", "json", ...])
        Tools-->>API: Authentic streams & duration
        API->>Disk: Delete temporary multipart folder, schedule 60-min TTL cleanup
        API-->>User: 200 OK { assetId, isLocalUpload: true, streams[] }
    end
```

---

## 2. Asynchronous Job Execution & Quota Settlement Flow

Every job creation (`POST /api/v1/jobs`) passes through prototype pollution checks, SSRF validation, idempotency deduplication, atomic SQLite quota reservation, TurboFlow lane classification, priority scheduling, FFprobe verification, and quota settlement.

```mermaid
sequenceDiagram
    actor User as Client Browser
    participant API as Fastify API (/api/v1/jobs)
    participant Auth as RequestIdentity
    participant Ent as EntitlementsService
    participant DB as SQLite WAL (muxaro.db)
    participant Q as QueueService (TurboFlow)
    participant Exec as yt-dlp / ffmpeg / ffprobe
    participant Disk as .muxaro-artifacts

    User->>API: POST /api/v1/jobs { mediaAssetId|mediaUrl, operation, targetFormat, idempotencyKey }
    API->>Auth: resolveCallerIdentity(request)
    API->>Ent: executeIdempotent(idempotencyKey, userId, body)
    API->>Ent: reserveQuota(userId, bucket="video", units=1)
    Ent->>DB: BEGIN IMMEDIATE -> check rolling 24h base + FIFO extra credits -> INSERT quota_reservations (RESERVED) + credit_ledger (CREDIT_RESERVED) -> COMMIT
    Ent-->>API: reservationId
    API->>Q: enqueueJob(input, ownerUserId, reservationId)
    Q->>Q: selectTurboFlowStrategy() -> assign lane & queueClass
    Q->>DB: UPSERT processing_jobs (QUEUED) + INSERT job_events
    API-->>User: 202 Accepted { jobId: "MXJ-...", status: "QUEUED", processingLane, queueClass }

    User->>API: GET /api/v1/jobs/:id/events (SSE)
    Note over Q,Exec: 3-Tier Fair Priority Scheduler dispatches when class & user concurrency caps allow
    Q->>DB: UPDATE processing_jobs (status=PROCESSING, queue_wait_ms)
    Q-->>User: SSE event: progress (PROCESSING)
    Q->>Exec: spawn("yt-dlp" / "ffmpeg", safeArgs, { shell: false })
    Exec->>Disk: Write output to .muxaro-artifacts/<jobId>/
    Q->>DB: UPDATE processing_jobs (status=VERIFYING)
    Q->>Exec: execFile("ffprobe", [outputFile]) + compute SHA-256
    alt Verification Succeeds
        Q->>Q: tokenService.generateDownloadToken(jobId, artifactId, userId, 3600s)
        Q->>DB: INSERT output_artifacts + UPDATE processing_jobs (status=READY, download_url, expires_at)
        Q->>Ent: commitQuota(reservationId)
        Ent->>DB: BEGIN IMMEDIATE -> UPDATE quota_reservations (COMMITTED) + INSERT credit_ledger (CREDIT_CONSUMED) -> COMMIT
        Q-->>User: SSE event: progress + event: complete (READY, downloadUrl)
    else Failure or User Cancellation
        Q->>Disk: Remove scratch/output directory
        Q->>DB: UPDATE processing_jobs (status=FAILED|CANCELLED)
        Q->>Ent: rollbackQuota(reservationId)
        Ent->>DB: BEGIN IMMEDIATE -> UPDATE quota_reservations (RELEASED) + INSERT credit_ledger (CREDIT_RELEASED) -> COMMIT
        Q-->>User: SSE event: complete (FAILED|CANCELLED)
    end
```

---

## 3. Authentication & Session Flow (Email + Google OAuth 2.0 PKCE + Admin MFA)

```mermaid
sequenceDiagram
    actor User as Client Browser
    participant API as Fastify API (/api/v1/auth/*)
    participant AuthSvc as AuthService & MfaService
    participant DB as SQLite WAL (muxaro.db)
    participant Google as Google OAuth / OIDC JWKS

    alt Email Login
        User->>API: POST /api/v1/auth/login { email, password, mfaCode? }
        API->>AuthSvc: checkLoginAllowed (IP: 20/15m, Account: 5 fails/15m progressive delay)
        AuthSvc->>DB: SELECT user by email
        AuthSvc->>AuthSvc: verifyPassword (Argon2id/Scrypt + dummy hash timing guard)
        AuthSvc->>DB: INSERT user_sessions (SHA-256 token_hash, csrf_token, mfa_verified)
        API-->>User: 200 OK + Set-Cookie: muxaro_session (HttpOnly) + muxaro_csrf
    else Google OAuth 2.0 + PKCE (S256)
        User->>API: GET /api/v1/auth/google/start?returnTo=/dashboard
        API->>AuthSvc: Generate state, nonce, PKCE code_verifier & S256 challenge
        AuthSvc->>DB: INSERT oauth_states (10 min TTL)
        API-->>User: 302 Redirect to accounts.google.com + Set-Cookie: muxaro_oauth_state (HttpOnly)
        User->>Google: Authenticate & consent
        Google-->>User: 302 Redirect /api/v1/auth/google/callback?code=...&state=...
        User->>API: GET /api/v1/auth/google/callback
        API->>AuthSvc: Verify state + cookie binding + consume oauth_states atomically
        AuthSvc->>Google: POST oauth2.googleapis.com/token (code + code_verifier)
        Google-->>AuthSvc: id_token (RS256 JWT)
        AuthSvc->>Google: Fetch JWKS (googleapis.com/oauth2/v3/certs, cached)
        AuthSvc->>AuthSvc: Verify RS256 signature, iss, aud, exp, nonce, email_verified
        AuthSvc->>DB: Upsert users + oauth_accounts + INSERT user_sessions
        API-->>User: 302 Redirect to FRONTEND_URL + Set-Cookie: muxaro_session + muxaro_csrf
    end
```

---

## 4. Batch & Playlist Packaging Data Flow

MUXARO implements two distinct multi-item workflows:

1. **Tracked Batches (`POST /api/v1/batches`):**
   - Validates up to `max_playlist_items` (default 50) items upfront (SSRF + upload path checks).
   - Reserves 1 `PLAYLIST_DOWNLOAD` quota slot (for `>1` items) or 1 `VIDEO_DOWNLOAD` slot (for 1 item).
   - Inserts a parent row in `batches` (`MXB-YYYYMMDD-XXXXXX`) and enqueues individual `processing_jobs` (`MXJ-XXXXXXXXXX`) numbered `"001"`, `"002"`, `"003"`, each processed independently through TurboFlow lanes.
   - `QueueService` updates parent batch rollup counts (`completed_items`, `failed_items`, `cancelled_items`, `progress`, `status`) on every child state change.

2. **Playlist Discovery & ZIP Packaging (`POST /api/v1/playlists/inspect`, `POST /api/v1/playlists/jobs`):**
   - Inspects up to 50 playlist entries via `yt-dlp --flat-playlist --dump-single-json`.
   - Reserves 1 `PLAYLIST_DOWNLOAD` quota slot (strictly isolated from individual video credits; rewarded credits never apply to playlists).
   - Executes inside the bounded `playlist-packaging` lane (concurrency cap: 1) sequentially fetching each entry, signing per-item download tokens, and streaming all completed items into a zero-dependency Store-method ZIP archive (`createStreamingZipArchive`) with CRC-32 and SHA-256 verification.
   - Commits quota if at least 1 item succeeded (`COMPLETED` or `PARTIAL_FAILURE`); rolls back quota if all items fail (`FAILED`).

---

## 5. Rewarded Ads Server-Side Verification (SSV) Flow

Credits are **never** awarded from client requests (`POST /api/v1/rewards/sessions/:id/refresh` actively rejects `rewarded: true` / `grant: true` payloads with `403 ERR_CLIENT_REWARD_FORBIDDEN`).

1. Authenticated user calls `POST /api/v1/rewards/sessions` → server verifies GAM config, enforces max 1 active `PENDING` session and daily cap (default 3 verified ads / rolling 24h), signs `custom_data` via HMAC-SHA256 binding `{ s: sessionId, u: userId, exp }`, stores `custom_data_hash` in `reward_sessions` (`MXRWD-...`, 10-min TTL).
2. Browser renders Google Ad Manager rewarded slot with server-issued `customData`.
3. Upon ad completion, Google's backend invokes `GET` or `POST /api/v1/rewards/provider-callback`.
4. `RewardsService.verifyAndProcessProviderCallback()` resolves the public ECDSA key for `key_id` (cached 12h from `GAM_SSV_KEY_URL` or pinned `GAM_SSV_PUBLIC_KEY_PEM`), verifies the ECDSA-SHA256 signature (DER or IEEE P1363), validates the HMAC-signed `custom_data`, and inside a `BEGIN IMMEDIATE` transaction:
   - Checks `reward_provider_events.provider_transaction_id` (`UNIQUE` replay guard; duplicates return `200` idempotently with `creditsGranted: 0`).
   - Transitions `reward_sessions.status` from `PENDING` → `VERIFIED`.
   - Appends an immutable `REWARD_GRANTED` entry (`+2` credits, rolling 24h expiry) to `credit_ledger` and updates `entitlements.extra_credits_balance`.
5. Client polls `GET /api/v1/rewards/sessions/:id` or `POST .../refresh` to display updated quota balance.

---

## 6. Signed Resumable Download Delivery Flow

1. Client hits `GET /api/v1/jobs/:id/download` (with owner/admin check) → `302 Redirect` to `/api/v1/download/:token` (propagating `?inline=1` when requested).
2. `GET /api/v1/download/:token` verifies the HMAC-SHA256 token (`tokenService.verifyDownloadToken`), validates `artifact.ownerUserId === payload.userId`, enforces cross-account IDOR protection if a different authenticated session cookie/header is present, and verifies `validateSafePath(filePath, [ARTIFACTS_ROOT], { mustExist: true })`.
3. Computes strong `ETag` (`"<sha256>"` or `"<size>-<mtimeMs>"`), validates `If-Range` and `Range: bytes=...` per RFC 9110, and streams directly from disk via `fs.createReadStream(resolvedPath, { start, end })` with zero RAM buffering (`206 Partial Content`, `200 OK`, or `416 Range Not Satisfiable`).
4. Logs a privacy-safe `download_started` event into `analytics_events` for full downloads.
