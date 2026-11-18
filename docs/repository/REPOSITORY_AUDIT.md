# MUXARO Repository, Security & Licensing Audit

**Target Repository:** `SubhransuNayak007/muxaro` (default branch: `main`)  
**Audited Workspace:** Local MUXARO monorepo (`apps/`, `packages/`, `security/`, `infra/`, `qa/`, `tests/`, `docs/`, `production/`)  
**Audit Date:** 2026-11-18  
**Auditor Role:** Repository, Security & Licensing Auditor  
**Selected Repository License:** `Apache-2.0` (Apache License, Version 2.0)

---

## 1. Executive Summary & Overall Verdict

| Audit Domain | Status | Key Verdict |
| :--- | :---: | :--- |
| **Live Secrets & Credentials** | **PASS (with hygiene items)** | Zero live API keys, OAuth secrets, R2 credentials, private keys, or real user PII found in source/config files. Two tracked documentation files contain a local Windows workspace path; local runtime directories contain dev SQLite DBs & mail outbox tokens (all ignored except `.hallmark/`). |
| **`.gitignore` & Runtime Hygiene** | **ACTION REQUIRED** | `.muxaro-data/`, `.muxaro-artifacts/`, `.muxaro-uploads/`, `apps/api/.muxaro-*`, `.next/`, `apps/web/out/`, `*.db*`, `dev-outbox.jsonl` are ignored, **but `.hallmark/` (containing `.hallmark/salt`) is NOT in `.gitignore`** and must be added before `git add`. |
| **Licensing & Clean-Room Compliance** | **PASS** | All **274** resolved npm/pnpm packages are 100% permissive (`MIT`, `ISC`, `Apache-2.0`, `BlueOak-1.0.0`, `BSD-3-Clause`, `CC-BY-4.0`, `0BSD`). Zero GPL/LGPL/AGPL JS/TS dependencies. FFmpeg/FFprobe & `yt-dlp` are strictly out-of-process CLI binaries. Sub-package `package.json` `"license"` fields are inconsistent and should be normalized to `Apache-2.0`. |
| **Implementation Truthfulness** | **CONDITIONAL** | Core full-stack workspace (Next.js 14 web app, Fastify 5 API, Node 24 SQLite 22-table DB, Auth/OAuth PKCE/TOTP MFA, TurboFlow queue, FFmpeg/yt-dlp execution, R2 SigV4, GAM SSV, SSRF guard, standalone `apps/media-worker`) is genuinely implemented, **but several architectural items documented in ADRs/infra (PostgreSQL runtime driver, Redis/BullMQ queue, HTTP dispatch from API to `media-worker`, outbound SMTP transport) are NOT wired into `apps/api` yet**. |
| **Git & GitHub Readiness** | **NOT INITIALIZED** | Workspace is not yet a Git repository; global `user.name`/`user.email` unset; `init.defaultbranch=master` (must use `main`); no GPG or SSH signing keys configured (`ssh-keygen.exe` is available); `gh` is authenticated as `SubhransuNayak007`; `SubhransuNayak007/muxaro` does not yet exist on GitHub. |

---

## 2. Implemented vs. Incomplete / Drifted Functionality

This section contrasts what is **actually implemented and running in code** against what is **planned, stubbed, or documented in older specs**.

### 2.1 Verified Working & Implemented Subsystems

1. **API Server (`apps/api` — Fastify 5 + Node 24)**:
   - Persistent **22-table SQLite WAL database** via Node 24's built-in `node:sqlite` (`DatabaseSync`) in `apps/api/src/db/database.ts`.
   - **Authentication & Identity** (`apps/api/src/services/auth.service.ts`, `mfa.service.ts`, `routes/auth.ts`, `routes/me.ts`): Argon2id password hashing (with Scrypt fallback), HttpOnly session cookies (SHA-256 hashed tokens in `user_sessions`), CSRF header (`x-muxaro-csrf`), Google OAuth 2.0 Authorization Code + PKCE (S256) + JWKS RS256 ID token verification, RFC 6238 TOTP Admin MFA encrypted at rest with AES-256-GCM, and `MXR-XXXXXXXX` public IDs.
   - **Entitlements & Rolling Quotas** (`apps/api/src/services/entitlements.service.ts`, `packages/entitlements/`): Atomic SQLite `BEGIN IMMEDIATE` quota reservations, immutable credit ledger, rolling 24h windows for Guest/Free/Premium tiers.
   - **Google Ad Manager Rewarded Ads SSV** (`apps/api/src/services/rewards.service.ts`, `routes/rewards.ts`): Server-side ECDSA-SHA256 callback signature verification, HMAC-bound `custom_data`, replay protection via `UNIQUE provider_transaction_id`, daily cap enforcement, and honest disabled state when `GAM_REWARDED_AD_UNIT_PATH` is unset.
   - **TurboFlow Queue & Media Execution** (`apps/api/src/services/queue.service.ts`, `turboflow.service.ts`, `adapter.service.ts`): 6-class isolated queue (`instant-processing`, `audio-processing`, `merge-processing`, `video-transcoding`, `high-resolution-processing`, `playlist-packaging`), 3-tier weighted priority (`PREMIUM=6`, `REGISTERED=3`, `GUEST=1`) with anti-starvation aging, SSE progress streaming, real `yt-dlp` / `ffmpeg` / `ffprobe` execution via `child_process.execFile`/`spawn` (`shell: false`), local chunked/streaming upload up to 2 GB, and 60-minute artifact TTL cleanup.
   - **Signed Download Delivery & R2 Storage** (`apps/api/src/services/token.service.ts`, `storage.service.ts`, `routes/download.ts`): HMAC-SHA256 signed download tokens with timing-safe verification, HTTP Range streaming, and pure-Node AWS SigV4 (`AWS4-HMAC-SHA256`) Cloudflare R2 client with automatic fallback to local ephemeral storage.
   - **Security & Admin** (`security/src/`, `apps/api/src/services/ratelimit.service.ts`, `admin.service.ts`, `routes/admin.ts`): Multi-layer SQLite rate limiting, SSRF guard blocking private/loopback/link-local/cloud metadata IPs and numeric IP encodings, FFmpeg argument sanitizer, and MFA-protected admin control routes.
2. **Web Frontend (`apps/web` — Next.js 14 App Router + Tailwind CSS)**:
   - Full application pages: landing workspace (`/`), `/tools/*` (audio extractor, audio-video merger, media converter, video merger, batch processing, playlist processing, playlist batch), `/dashboard`, `/account`, `/credits`, `/admin`, `/login`, `/register`, `/verify-email`, `/reset-password`, `/status`, `/docs` + dynamic `/docs/[slug]`, `/privacy`, `/terms`, `/dmca`, `robots.ts`, `sitemap.ts`.
   - Dual build modes in `apps/web/next.config.mjs`: local/server rewrite proxy (`CLOUDFLARE_PAGES=0`) and static export (`CLOUDFLARE_PAGES=1` -> `apps/web/out/`).
   - Privacy-first Google Analytics 4 / Consent Mode v2 integration with automated PII parameter scrubbing (`apps/web/lib/analytics.ts`, `ConsentBanner.tsx`).
3. **Standalone Media Worker (`apps/media-worker` — Fastify 5 + Zod + Archiver)**:
   - Complete standalone microservice implementing `GET /health`, `POST /api/probe`, `POST /api/process-video`, audio extraction, merging, ZIP packaging (`archiver`), FFmpeg sanitizer, output verification, and scratch disk manager, with unit/E2E tests.
4. **Shared Security, Source Adapters & Entitlements Libraries (`security/`, `packages/source-adapters/`, `packages/entitlements/`)**:
   - Clean, self-contained TypeScript modules with automated test suites (`tests/`, `qa/harness/`).

### 2.2 Partial, Unwired, or Drifted Functionality (Truthfulness Disclosures)

| Area | What Docs / Infra Claim | Actual Implemented State in Code |
| :--- | :--- | :--- |
| **PostgreSQL Runtime** | `infra/scripts/init-db.sql`, `infra/migrations/002_account_rewards_analytics.sql`, `infra/docker-compose.yml`, `infra/cloudrun/api-service.yaml`, and `.env.example` reference `DATABASE_URL` / PostgreSQL. | `apps/api/src/config.ts` parses `DATABASE_URL`, **but no `pg` driver is installed** (`apps/api/package.json`). `apps/api/src/db/database.ts` runs exclusively on Node 24's built-in `node:sqlite`. |
| **Redis & BullMQ Queue** | `ADR-002`, `docs/REFERENCE_AUDIT.md`, `infra/docker-compose.yml`, and `infra/terraform/modules/redis` describe Redis + BullMQ distributed queuing. | `apps/api/src/config.ts` parses `REDIS_URL` and `ratelimit.service.ts` defines a pluggable interface, **but neither `redis`, `ioredis`, nor `bullmq` is installed**. Queuing and rate-limit counters persist in local SQLite (`node:sqlite`). |
| **API → Media Worker Dispatch** | `infra/docker-compose.yml`, `infra/cloudrun/worker-service.yaml`, and `.env.example` define `MEDIA_WORKER_URL`. | `apps/api` **never reads `MEDIA_WORKER_URL`** or sends HTTP calls to `apps/media-worker`. Instead, `apps/api` spawns `ffmpeg`, `ffprobe`, and `yt-dlp` directly in-container (hence `infra/Dockerfile.api` installs `ffmpeg` and `yt-dlp`). `apps/media-worker` is built and tested independently. |
| **Outbound SMTP Email** | `.env.example` exposes `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. | `apps/api/src/services/auth.service.ts` (lines 503–516, 734–746) writes verification/reset payloads to `dev-outbox.jsonl` when `SMTP_HOST` is unset and `NODE_ENV !== 'production'`. **No SMTP transport library (e.g., `nodemailer`) or raw SMTP socket client is implemented yet**; setting `SMTP_HOST` suppresses the dev outbox and reports `deliveryMode: 'smtp'` without sending email over the network. |
| **Dual Cloud IaC Targets** | `infra/cloudrun/*.yaml` targets Google Cloud Run + Cloudflare Pages + R2; `infra/terraform/` targets AWS ECS/RDS/ElastiCache/SQS/ALB + Cloudflare. | `.github/workflows/ci-deploy.yml` deploys strictly to Cloudflare Pages + GCP Cloud Run. `infra/terraform/` is an earlier AWS blueprint not wired into CI. |

---

## 3. Secret & Sensitive Data Audit

An exhaustive automated and manual scan was conducted across all source files, configs, scripts, infrastructure manifests, tests, and documentation (excluding `node_modules/` and build caches). **No raw secret values are reproduced in this report.**

### 3.1 Secret Scan Result: **ZERO LIVE SECRETS IN TRACKABLE CODE**

- **Live API keys / cloud credentials / OAuth secrets / private keys (`-----BEGIN ... PRIVATE KEY-----`, `AKIA*`, `AIza*`, `ghp_`/`gho_`, `sk_live_`, JWTs, service-account JSONs):** **0 real secrets found.**
- **`.env` / `.pem` / `.key` / `service-account*.json` files on disk:** **None exist** in the workspace (only `.env.example` and `infra/.env.example` templates exist).

### 3.2 Audited Pattern Hits & Classifications

| Finding Category | File(s) & Line(s) | Assessment | Action Required |
| :--- | :--- | :--- | :--- |
| **AWS Official Test Vector Key** | `qa/harness/verify-r2-sigv4.ts:42, 43, 55` | Uses AWS's official public documentation SigV4 example credentials (`AKIAIOSFODNN7EXAMPLE` / `wJalrXUtn...EXAMPLEKEY`) for unit testing. **Not a live credential.** | None required for security; note that GitHub Push Protection may flag `AKIA*` patterns if unannotated (consider verifying during push or using a clearly synthetic non-`AKIA` test fixture if push protection triggers). |
| **Hardcoded Dev Fallback Secrets** | `apps/api/src/config.ts:37-40`, `packages/entitlements/src/auth/session.ts:32` | Non-production default fallback strings (`DEFAULT_DEV_SESSION_SECRET`, `DEFAULT_DEV_TOKEN_SECRET`). `validateProductionConfig()` in `config.ts:118-124` explicitly rejects these defaults when `NODE_ENV === 'production'`. | Safe for local dev; ensure `validateProductionConfig()` is enforced on production startup (`apps/api/src/index.ts`). |
| **Docker Local Dev Passwords** | `infra/.env.example:18-19, 27-28, 35-36, 42-43`, `infra/docker-compose.yml:38, 63, 88-89, 140-141, 187-188`, `infra/scripts/run-migrations.sh:16` | Default local Docker Compose credentials (`muxaro_secure_password`, `muxaro_redis_secret`, `minioadmin`). Clearly local-only templates. | Acceptable for local Docker Compose; never reuse in staging/production. |
| **Local Windows Workspace Path Leak** | `docs/BUG_REGISTER.md:74`, `docs/architecture/system-overview.md:234` | Literal local Windows path `d:\yt doenlord` / `d:/yt doenlord/` appears in developer documentation. | **RECOMMENDED REDACTION** (minor privacy/professionalism hygiene): replace with `<repo-root>/` in a doc cleanup pass. |
| **Email Addresses (24 unique)** | Across `apps/web/`, `docs/`, `qa/`, `security/`, `packages/`, `infra/` | All 24 addresses are fictional/placeholder (`you@example.com`, `alice@example.com`, `admin.secops@muxaro.test`, `admin@muxaro.internal`) or role-based project addresses (`support@muxaro.com`, `no-reply@muxaro.app`, `security@muxaro.app`, `dmca@muxaro.media`, `privacy@muxaro.media`, `legal@muxaro.media`). **Zero personal emails found.** | Pass (note domain inconsistency: `.app` vs `.com` vs `.media`). |
| **Private / Metadata IP Addresses (19 files)** | `security/src/ssrf-guard.ts`, `packages/source-adapters/src/ssrf-filter.ts`, tests, Terraform VPC CIDR (`10.0.0.0`), threat model & QA docs | All occurrences are RFC 1918 blocklists, AWS/GCP metadata SSRF test vectors (`169.254.169.254`), or example Terraform VPC CIDRs. **Zero real internal production server IPs.** | Pass. |

### 3.3 Local Runtime Data & Sensitive Uncommitted Files on Disk

The following local runtime artifacts exist on disk from local testing and **MUST NEVER BE COMMITTED**:

| Path on Disk | Contents / Risk | Size | Covered by Current `.gitignore`? |
| :--- | :--- | :---: | :---: |
| `.hallmark/salt` | Local tool state/salt file (9 bytes) | 9 B | **NO — MUST ADD `.hallmark/` TO `.gitignore`!** |
| `.muxaro-data/muxaro.db` | Local SQLite DB (test user accounts, hashed sessions, jobs) | 548 KB | Yes (`.muxaro-data/`, `*.db`) |
| `.muxaro-data/dev-outbox.jsonl` | Local dev email sink containing test verification/reset tokens & emails | 207 B | Yes (`.muxaro-data/`, `dev-outbox.jsonl`) |
| `apps/api/.muxaro-data/muxaro.db` (+ `-shm`, `-wal`) | Local API SQLite DB & 2.77 MB WAL file with local test records | 3.35 MB | Yes (`apps/api/.muxaro-data/`, `*.db*`) |
| `apps/api/.muxaro-data/dev-outbox.jsonl` | Local API dev email sink (8 lines with test tokens & emails) | 1.77 KB | Yes (`apps/api/.muxaro-data/`, `dev-outbox.jsonl`) |
| `apps/api/.muxaro-artifacts/6de98845-.../output.f571.mp4.part` | **354.7 MB** partial video download artifact (exceeds GitHub's 100 MB file limit!) | 354.7 MB | Yes (`apps/api/.muxaro-artifacts/`) |
| `apps/api/.muxaro-artifacts/MXJ-*` | Local processed test MP3/MP4 artifacts | ~895 KB | Yes (`apps/api/.muxaro-artifacts/`) |
| `apps/api/.muxaro-uploads/a363ff76-.../idor_clip.mp4` | Local upload test artifact | 438 KB | Yes (`apps/api/.muxaro-uploads/`) |
| `.muxaro-uploads/multipart/*` | Empty local multipart upload directories | 0 B | Yes (`.muxaro-uploads/`) |
| `apps/web/out/`, `apps/web/.next/`, `apps/web/tsconfig.tsbuildinfo` | Generated Next.js static export, dev cache, and TS build info | Multi-MB | Yes (`apps/web/out/`, `apps/web/.next/`, `*.tsbuildinfo`) |

---

## 4. Dead Code, Duplicates, Legacy Naming & Tooling Drift

### 4.1 Duplicate & Redundant Files
1. **Identical 1 MB Brand PNGs (3x duplication)**:
   - `apps/web/public/brand/muxaro-brand-master.png` (1,045,669 bytes)
   - `apps/web/public/brand/og-image.png` (1,045,669 bytes)
   - `apps/web/public/brand/social-preview.png` (1,045,669 bytes)
   - All three share the exact same SHA-256 hash (`A3B8FC2006F2F25F1C1F499571E7EC0CE81BB935908BC31C1A0DD5AF8504ECF1`). Combined size is ~3.14 MB (and duplicated again in ignored `apps/web/out/brand/`).
2. **Duplicate Worker Dockerfiles**:
   - `infra/Dockerfile.media` (older: `node:20-bookworm-slim`, `pnpm`, port `5000`, no `yt-dlp`; referenced by `infra/docker-compose.yml`).
   - `infra/Dockerfile.worker` (newer: `node:24-bookworm-slim`, `npm`, port `8080`, `yt-dlp`, UID `10001`; referenced by `.github/workflows/ci-deploy.yml`).
3. **Duplicate Environment Templates**:
   - Root `.env.example` (current Cloud Run / Cloudflare Pages / R2 / OAuth / GAM SSV template) vs `infra/.env.example` (older Docker Compose / AWS SQS / MinIO template).
4. **Overlapping Frontend Tool Routes**:
   - `apps/web/app/tools/playlist-batch/page.tsx` (38 KB), `apps/web/app/tools/playlist-processing/page.tsx` (27.5 KB), and `apps/web/app/tools/batch-processing/page.tsx` (14.5 KB) — functional overlap should be documented or consolidated post-release.
5. **Orphaned / Stale Brand Config**:
   - `packages/config/brand.ts` is **not imported anywhere** in `apps/web` or `apps/api`; it still references `domain: 'muxaro.com'` and legacy fonts (`Chakra Petch`, `IBM Plex Sans`, `IBM Plex Mono`), while `apps/web/app/layout.tsx` uses `https://muxaro.app`, `Inter`, and `JetBrains Mono`. `apps/web/lib/brand.ts` also retains `domain: 'muxaro.com'`.

### 4.2 Broken / Misaligned Scripts & Workspace Packaging Issues
1. **No Root `package.json`**: Sub-projects are installed and tested independently.
2. **Mixed Package Managers & Lockfiles**:
   - `npm` (`package-lock.json`): `apps/api`, `apps/web`, `packages/entitlements`.
   - `pnpm` (`pnpm-lock.yaml`): `apps/media-worker` (also has `pnpm-workspace.yaml`), `packages/source-adapters`.
   - No lockfile: `security/`, `tests/`.
3. **Divergent TypeScript Versions**:
   - `apps/api`, `packages/entitlements`, `packages/source-adapters`: `typescript@^7.0.2` (plus `@types/node@^26.6.6`).
   - `apps/media-worker`: `typescript@^5.7.3` (resolved `5.9.3`).
   - `apps/web`: `typescript@^5.6.3` (resolved `5.9.3`).
4. **Broken Test Scripts in Sub-Package Manifests**:
   - `tests/package.json`: `"test"` points to `tests/run-all.ts` and `"test:unit"` points to `tests/unit/run-unit.ts` — **neither file exists** (actual master runner is `qa/harness/run-all-tests.ts`).
   - `security/package.json`: `"test"` runs `node --experimental-strip-types security/tests/...`, which only works when invoked from the repo root rather than inside `security/`.
   - `.github/workflows/ci-deploy.yml`: Line 79 appends `|| true` to API TypeCheck, and line 130–131 appends `|| true` to `npm audit`, allowing type errors or audit failures to pass silently unless tightened.
5. **Legacy Pre-Rebrand Naming (`VYRO` / `PureMux`)**:
   - `VYRO` / `@vyro/*` appears in **39 files**, including active imports (`@vyro/security`, `@vyro/source-adapters`, `@vyro/entitlements`) in `apps/api/src/`, `tsconfig.json`, `apps/api/tsconfig.json`, and `tests/package.json` (`"name": "@vyro/tests"`).
   - `PureMux` appears in **6 files** (historical research/audit/QA docs and 1 comment/test reference).
6. **Generated Binary Test Fixtures**:
   - `tests/media/fixtures/` and `tests/media/fixtures/output/` contain 12 small synthetic FFmpeg-generated binary files (~685 KB total). They are small and clean, though `tests/media/fixtures/output/` contains generated test outputs from prior runs.

---

## 5. Licensing & Third-Party Dependency Audit

Full attribution is recorded in [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md), [`LICENSE`](../../LICENSE), and [`NOTICE`](../../NOTICE).

### 5.1 Findings
- **Dependency Scan:** 274 unique `package@version` packages across all installed `node_modules` trees (`apps/api`: 92, `apps/media-worker`: 318, `apps/web`: 102, `packages/entitlements`: 4, `packages/source-adapters`: 8).
- **Copyleft Check:** **0** GPL, LGPL, AGPL, MPL, EPL, SSPL, or unknown-license packages in JS/TS dependencies.
- **License Selection (`Apache-2.0`):** Selected as the canonical repository license because it provides an explicit patent grant, trademark reservation (Section 6), formal `NOTICE` support (Section 4(d)), full compatibility with all 274 dependencies, and alignment with `ADR-001` and `packages/entitlements`.
- **Sub-Package `"license"` Field Inconsistency (Non-blocking cleanup item):**
  - `packages/entitlements/package.json`: `"Apache-2.0"`
  - `apps/media-worker/package.json`, `packages/source-adapters/package.json`, `security/package.json`: `"MIT"`
  - `apps/api/package.json`: `"ISC"`
  - `apps/web/package.json`: omitted (`"private": true`)
  - `tests/package.json`: `"UNLICENSED"` (`"private": true`)
  - *Recommendation:* Align all sub-package `"license"` fields to `"Apache-2.0"` (matching root `LICENSE`) in a dedicated maintenance PR.
- **Out-of-Process CLI & Container Compliance:**
  - `ffmpeg`, `ffprobe`, and `yt-dlp` are executed exclusively as external child processes (`execFile`/`spawn`, `shell: false`).
  - `yt-dlp` is licensed under **The Unlicense**.
  - Debian Bookworm's `ffmpeg` package (installed inside `infra/Dockerfile.api`, `Dockerfile.worker`, `Dockerfile.media`) is compiled under **GPL-3.0**, and `minio/minio` in local `infra/docker-compose.yml` is **AGPL-3.0**. Neither binary is committed to Git, and container redistribution obligations are explicitly documented in `NOTICE` and `THIRD_PARTY_NOTICES.md`.

---

## 6. Documentation Gaps & Drift

1. **Missing Root Community & Repository Docs (prior to publication swarm):** `README.md`, `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`, `AUTHORS.md`, `CHANGELOG.md`, `CITATION.cff` were absent at audit start (`LICENSE`, `NOTICE`, and `THIRD_PARTY_NOTICES.md` have now been created by `@auditor`).
2. **Asset Inventory Drift:** `docs/branding/MUXARO_ASSET_INVENTORY.md` lists assets (`muxaro-logo-white.svg`, `muxaro-logo-black.svg`, `favicon.ico`, `apple-touch-icon.png`, `og-image-muxaro.png`, `twitter-card-muxaro.png`) that do not exist in `apps/web/public/`.
3. **Domain Naming Drift:** Docs and configs alternate between `muxaro.app` (primary in `.env.example`, `apps/web/app/layout.tsx`, `ci-deploy.yml`, `cloudrun/*.yaml`), `muxaro.com` (`packages/config/brand.ts`, `apps/web/lib/brand.ts`, `SEO_RISK_REGISTER.md`), and `muxaro.media` (`apps/web/content/legal/*.md`).
4. **Executable TS Files Inside `docs/`:** `docs/seo/open-graph.ts` and `docs/seo/schemas/index.ts` reside under `docs/` and are not imported by `apps/web`.

---

## 7. Git Configuration, Commit Signing & GitHub Repository Status

Direct verification results from the local environment:

| Check | Observed Value | Publication Implication |
| :--- | :--- | :--- |
| **Local Git Repo** | **Not initialized** (`fatal: not a git repository`) | Must run `git init -b main` (do **not** rely on system default `master`). |
| **System `init.defaultbranch`** | `master` (`C:/Program Files/Git/etc/gitconfig`) | Explicitly pass `-b main` on `git init` or configure `init.defaultBranch = main`. |
| **Git `user.name` / `user.email`** | **Not set** in system or user `.gitconfig` | Must be configured locally (preferably with GitHub noreply email if privacy is desired) before creating commits. |
| **Git `core.longpaths`** | `true` (`~/.gitconfig`) | Good for Windows long paths. |
| **GPG Signing** | **Unavailable** (`gpg` binary not installed) | Cannot GPG-sign commits without installing GnuPG. |
| **SSH Signing** | **Not configured** (`~/.ssh` directory does not exist; zero SSH keys present), though `C:\Windows\System32\OpenSSH\ssh-keygen.exe` is installed. | Unsigned commits will be created unless an Ed25519 SSH signing key is generated and registered on GitHub (`git config gpg.format ssh`). |
| **GitHub CLI (`gh`) Auth** | Authenticated as **`SubhransuNayak007`** via keyring (`https` protocol, scopes: `gist`, `read:org`, `repo`, `workflow`). | Ready to create and push repository via `gh repo create`. |
| **Remote Repo `SubhransuNayak007/muxaro`** | **Does NOT exist yet** (`GraphQL: Could not resolve to a Repository`). | Safe to create fresh as `SubhransuNayak007/muxaro` with default branch `main`. |
