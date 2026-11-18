# MUXARO Complete Project & Module Inventory

**Repository:** `SubhransuNayak007/muxaro`  
**Inventory Baseline:** 2026-11-18  
**Monorepo Runtime Baseline:** Node.js 24 (API / built-in `node:sqlite`), Next.js 14 / React 18 (Web), Fastify 5 (API & Media Worker), TypeScript  

---

## 1. Top-Level Directory Map

| Path | Classification | Tracked in Git? | Purpose |
| :--- | :--- | :---: | :--- |
| `.env.example` | Root Config | Yes | Canonical environment variable template (Web, API, SQLite/Postgres, Redis, Cloudflare R2, Google OAuth PKCE, GAM SSV, SMTP, Worker) |
| `.gitignore` | Root Config | Yes | Excludes secrets, `.muxaro-*` runtime dirs, build outputs, `node_modules/`, Terraform state, OS artifacts *(must also exclude `.hallmark/`)* |
| `tsconfig.json` | Root Config | Yes | Monorepo TypeScript path aliases (`@muxaro/*` & legacy `@vyro/*`) |
| `LICENSE` | Legal | Yes | Apache License, Version 2.0 |
| `NOTICE` | Legal | Yes | Apache-2.0 Section 4(d) attribution, external CLI binary notice, trademark reservation |
| `THIRD_PARTY_NOTICES.md` | Legal | Yes | Audited third-party package, font, icon, and out-of-process binary license registry |
| `.github/` | CI/CD & Governance | Yes | GitHub Actions workflows, templates, and repository automation |
| `apps/api/` | Application (Backend) | Yes | Fastify 5 REST & SSE API server, SQLite WAL DB, auth/OAuth/MFA, quotas, GAM SSV, TurboFlow queue, R2 SigV4 |
| `apps/media-worker/` | Application (Worker) | Yes | Standalone Fastify 5 + FFmpeg/FFprobe + Archiver media processing microservice |
| `apps/web/` | Application (Frontend) | Yes | Next.js 14 App Router + Tailwind CSS web workspace & Cloudflare Pages static export |
| `packages/config/` | Shared Package | Yes | Legacy/unreferenced brand metadata constant (`brand.ts`) |
| `packages/entitlements/` | Shared Package | Yes | Session auth, RBAC, sliding-window rolling quotas, atomic two-phase reservations, idempotency, credit ledger |
| `packages/source-adapters/` | Shared Package | Yes | Source adapter registry, direct-media & YouTube-permitted adapters, rights validator, MIME detector, SSRF filter |
| `security/` | Shared Security Package | Yes | SSRF guard, FFmpeg argument sanitizer & safe spawner, rate limiter, Zod-like request validators |
| `infra/` | Infrastructure / IaC | Yes | Dockerfiles, `docker-compose.yml`, GCP Cloud Run YAML manifests, AWS Terraform modules, DB init/migrations, ops scripts |
| `qa/` | QA Harness & Load Tests | Yes | Master test runner, E2E account/download/TurboFlow/R2/static-export verification harnesses, load simulator |
| `tests/` | Automated Test Suite | Yes | Unit, concurrency, security SSRF regression, synthetic media engine, and API integration tests |
| `production/` | Operational QA Records | Yes | Sprint 1 bug triage & penetration test report (`production/qa/bug-triage-2026-11-18.md`) |
| `docs/` | Documentation | Yes | Architecture, ADRs, API, backend, database, frontend, security, deployment, account platform, design, SEO, repository audits |
| `.muxaro-data/`, `.muxaro-artifacts/`, `.muxaro-uploads/` | Local Runtime Data | **NO (Ignored)** | Local dev SQLite DBs, `dev-outbox.jsonl`, ephemeral media outputs & uploads |
| `apps/api/.muxaro-*` | Local Runtime Data | **NO (Ignored)** | API-scoped local SQLite DB/WAL, outbox, uploads, and media artifacts |
| `.hallmark/` | Local Tool State | **NO (Must Ignore)** | Local Hallmark salt state (`.hallmark/salt`) |

---

## 2. Backend API (`apps/api` — `@muxaro/api`)

**Framework:** Fastify `5.12.8`, `@fastify/cors`, `@fastify/sensible`, `@fastify/swagger`, `@fastify/swagger-ui`, Node 24 `node:sqlite`.

### 2.1 Core Entrypoints & Configuration
| File | Purpose |
| :--- | :--- |
| `apps/api/package.json` | Package manifest (`start`, `dev`, `test` scripts; Fastify dependencies) |
| `apps/api/tsconfig.json` | API-scoped TypeScript compiler config & `@muxaro/*`/`@vyro/*` path mappings |
| `apps/api/README.md` | Service-level API README |
| `apps/api/src/index.ts` | Server bootstrap, port/host binding, graceful shutdown |
| `apps/api/src/app.ts` | Fastify factory: CORS, Swagger UI (`/docs`), multi-layer rate-limiting `preHandler`, error handler, 13 route plugins |
| `apps/api/src/config.ts` | Environment configuration loader, R2 config detection, `validateProductionConfig()` fail-safe validator |
| `apps/api/src/db/database.ts` | Node 24 `node:sqlite` WAL store initializing 22 relational tables, indexes, seeded `system_settings`, and atomic transaction helper |
| `apps/api/src/middleware/auth.middleware.ts` | Cookie/Bearer session resolution, CSRF validation (`x-muxaro-csrf`), role/MFA guards |
| `apps/api/src/types/index.ts` | Shared API TypeScript domain types (jobs, streams, operations, tokens, priority tiers) |

### 2.2 Route Modules (`apps/api/src/routes/`)
| File | Responsibility |
| :--- | :--- |
| `health.ts` | Liveness (`/api/v1/health`) and readiness (`/api/v1/ready`) probes checking DB, FFmpeg availability, storage mode, OAuth/rewards status |
| `auth.ts` | Email registration/login/logout, email verification, password reset, Google OAuth 2.0 + PKCE start/callback, TOTP MFA enrollment & challenge |
| `me.ts` | Authenticated user profile, preferences, active session listing, and session revocation |
| `account.ts` | Account quota summary and job history views |
| `entitlements.ts` | Rolling 24-hour allowance queries and credit ledger inspection |
| `rewards.ts` | Rewarded ad configuration, reward session creation, status polling, and Google Ad Manager SSV callback endpoint |
| `media.ts` | URL inspection (`POST /api/v1/media/inspect`), single-shot & chunked local uploads (`/media/upload`, `/media/upload/init`, part upload, complete) |
| `jobs.ts` | Job creation, status retrieval, cancellation, retry, and real-time Server-Sent Events (SSE) progress streaming |
| `batches.ts` | Multi-item batch creation, item status tracking, and cancellation |
| `playlists.ts` | Playlist inspection via `yt-dlp` and batch playlist job processing |
| `tools.ts` | Dedicated audio/video merging and media conversion endpoints |
| `download.ts` | HMAC-SHA256 signed download token validation and HTTP Range media delivery |
| `admin.ts` | MFA-gated administrative routes (user lookup/management, settings, audit logs, queue/SRE metrics) |

### 2.3 Service Modules (`apps/api/src/services/`)
| File | Responsibility |
| :--- | :--- |
| `auth.service.ts` | Argon2id/Scrypt password hashing, sessions, OAuth 2.0 PKCE + JWKS RS256 verification, verification/reset tokens, `dev-outbox.jsonl` sink |
| `mfa.service.ts` | Pure-Node RFC 6238 TOTP generator/verifier & AES-256-GCM at-rest secret encryption |
| `entitlements.service.ts` | SQLite-backed unified quota enforcement, atomic reservations, immutable credit ledger |
| `rewards.service.ts` | Google Ad Manager SSV ECDSA-SHA256 verification, replay protection, daily cap & credit grant logic |
| `adapter.service.ts` | SSRF validation, `yt-dlp` JSON inspection, `ffprobe` inspection, source-adapter fallback, local upload registry & 60-min TTL cleanup |
| `queue.service.ts` | SQLite-backed TurboFlow 6-class / 3-tier priority queue with anti-starvation aging, SSE events, `ffmpeg`/`ffprobe`/`yt-dlp` execution, artifact TTL |
| `turboflow.service.ts` | Processing lane selection (`instant`/`smart`/`power`), stream-copy vs transcode strategy, human-friendly error mapping |
| `storage.service.ts` | Pure-Node AWS SigV4 (`AWS4-HMAC-SHA256`) Cloudflare R2 client + local disk fallback, key sanitization, presigned URLs |
| `token.service.ts` | Tamper-proof HMAC-SHA256 signed download token creation and timing-safe verification |
| `ratelimit.service.ts` | Multi-layer SQLite rate limiting, duplicate flood guard, polling-route exemptions, sensitive log redaction |
| `request-identity.ts` | Client IP extraction, guest/user actor identification, proxy header handling |
| `admin.service.ts` | Bootstrap admin sync from `MUXARO_ADMIN_EMAIL`, user/quota overrides, audit log persistence, telemetry aggregation |
| `id.service.ts` | Prefixed ID generation (`MXR-*`, `MXJ-*`, `MXB-*`, UUIDv7 internal IDs) |

### 2.4 Tests (`apps/api/tests/`)
| File | Purpose |
| :--- | :--- |
| `apps/api/tests/api.test.ts` | Core Fastify API route and behavior tests |

---

## 3. Media Worker (`apps/media-worker` — `@muxaro/media-worker`)

**Framework:** Fastify `5.2.1`, Zod `3.24.2`, Archiver `7.0.1`, FFmpeg/FFprobe child processes.

| File | Purpose |
| :--- | :--- |
| `apps/media-worker/package.json`, `tsconfig.json`, `README.md`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | Standalone microservice manifest, lockfile, and docs |
| `apps/media-worker/src/index.ts` | Library barrel exports |
| `apps/media-worker/src/server.ts` | Fastify HTTP server (`/health`, `/api/probe`, `/api/process-video`, audio extraction, merge, package) |
| `apps/media-worker/src/service.ts` | `MediaWorkerService` orchestration façade |
| `apps/media-worker/src/prober/{ffprobe,classifier,index}.ts` | FFprobe JSON metadata extraction and media stream classification |
| `apps/media-worker/src/transcoder/{video,audio,index}.ts` | Stream-copy-first video remux/transcode and honest-fidelity audio extraction |
| `apps/media-worker/src/merger/{merger,index}.ts` | Audio + video stream multiplexing |
| `apps/media-worker/src/packager/{zipper,index}.ts` | Streaming ZIP archive packager using `archiver` |
| `apps/media-worker/src/process/{executor,sanitizer,index}.ts` | Safe `execFile`/`spawn` process execution with timeout & argument sanitization |
| `apps/media-worker/src/scratch/{disk-manager,index}.ts` | Per-job ephemeral scratch directory allocation & cleanup |
| `apps/media-worker/src/verification/{verifier,index}.ts` | Post-encode FFprobe output integrity verification |
| `apps/media-worker/src/types/{media,transcode,index}.ts` | Media & transcode TypeScript contracts |
| `apps/media-worker/src/__tests__/*.test.ts` | 5 test suites (`classifier`, `disk-manager`, `end-to-end`, `sanitizer`, `server`) |

---

## 4. Web Frontend (`apps/web` — `@muxaro/web`)

**Framework:** Next.js `14.2.24` (App Router), React `18.3.1`, Tailwind CSS `3.4.14`, `lucide-react` `0.453.0`, Google Fonts (`Inter`, `JetBrains Mono`).

### 4.1 Configuration & Static Public Assets
| File | Purpose |
| :--- | :--- |
| `apps/web/package.json`, `package-lock.json`, `tsconfig.json`, `next-env.d.ts` | Web app manifest & TypeScript config |
| `apps/web/next.config.mjs` | Dual-mode config (server `/api/v1` rewrites vs `CLOUDFLARE_PAGES=1` static export) |
| `apps/web/tailwind.config.ts`, `postcss.config.mjs`, `app/globals.css` | Design token system, Hallmark CSS tokens, Tailwind theme |
| `apps/web/wrangler.toml` | Cloudflare Pages project configuration |
| `apps/web/public/_headers`, `apps/web/public/_redirects` | Cloudflare Pages security headers and redirect rules |
| `apps/web/public/favicon.svg`, `apps/web/public/brand/*` | Brand SVG marks (`favicon.svg`, `muxaro-logo.svg`, `muxaro-mark.svg`, `muxaro-wordmark.svg`) and raster previews (`muxaro-brand-master.png`, `og-image.png`, `social-preview.png` — currently 3 identical 1 MB copies) |

### 4.2 App Router Pages (`apps/web/app/`)
| Route / Directory | Purpose |
| :--- | :--- |
| `layout.tsx`, `page.tsx` | Root HTML shell, typography, theme/lightweight bootstrap, main workspace landing page |
| `tools/page.tsx` + 7 sub-routes | Tools index, `audio-extractor`, `audio-video-merger`, `media-converter`, `video-merger`, `batch-processing`, `playlist-processing`, `playlist-batch` |
| `dashboard/{layout,page}.tsx` | User workspace dashboard (active jobs, history, quota overview) |
| `account/{layout,page}.tsx` | Account settings, security, active sessions, TOTP MFA management |
| `credits/{layout,page}.tsx` | Allowance breakdown, credit ledger, rewarded ad credit interface |
| `admin/{layout,page}.tsx` | MFA-protected admin operations console |
| `login/`, `register/`, `verify-email/`, `reset-password/` | Authentication & account recovery flows (`noindex` layouts) |
| `docs/page.tsx`, `docs/[slug]/page.tsx` | In-app user documentation viewer |
| `status/page.tsx` | Live API & pipeline health status page |
| `privacy/`, `terms/`, `dmca/` | Legal & compliance policy pages |
| `robots.ts`, `sitemap.ts` | Programmatic `robots.txt` and `sitemap.xml` generation |

### 4.3 Components, Libraries & In-App Content
| Directory / File | Purpose |
| :--- | :--- |
| `apps/web/components/` | `Navbar.tsx`, `Footer.tsx`, `MediaInspector.tsx`, `JobProgress.tsx`, `RewardedAdCard.tsx`, `ConsentBanner.tsx`, `AnalyticsProvider.tsx`, `DimensionTick.tsx` |
| `apps/web/lib/` | `api-client.ts` (typed REST/SSE client), `auth-context.tsx`, `analytics.ts` (GA4 + PII scrubber), `background-download.ts`, `brand.ts`, `device-mode.ts` (low-end device adaptation), `format-normalizer.ts`, `formatters.ts`, `types.ts` |
| `apps/web/content/` | `index.ts` loader + Markdown docs (`audio-quality.md`, `faq.md`, `formats.md`, `resolutions.md`, `troubleshooting.md`) & legal texts (`dmca.md`, `privacy.md`, `terms.md`) |

---

## 5. Shared Packages & Security Module (`packages/`, `security/`)

| Package / Path | Key Files | Purpose |
| :--- | :--- | :--- |
| `packages/config/` | `brand.ts` | Legacy/unreferenced brand config constant (`muxaro.com`) |
| `packages/entitlements/` | `src/{engine,errors,index,types}.ts`, `src/auth/{crypto,rbac,session}.ts`, `src/idempotency/idempotency-manager.ts`, `src/ledger/ledger.ts`, `src/quota/{reservation,rules,sliding-window}.ts`, `src/storage/{in-memory-store,interfaces,sql-schema}.ts`, `tests/*.test.ts` (8 test files) | Reusable entitlements, rolling quota, atomic two-phase reservation, RBAC, and idempotency engine |
| `packages/source-adapters/` | `src/{adapter-registry,direct-adapter,youtube-permitted-adapter,rights-validator,ssrf-filter,errors,types,index}.ts`, `src/utils/{http-inspector,mime-detector}.ts`, `tests/*.test.ts` (7 test files) | Source URL adapters, rights declaration validation, oEmbed/permitted inspection, MIME & SSRF helpers |
| `security/` | `src/{ssrf-guard,ffmpeg-sanitizer,rate-limiter,validation,index}.ts`, `tests/{ssrf,ffmpeg-sanitizer,rate-limiter,validation}.test.ts` | Core security primitives: DNS/IP SSRF defense, FFmpeg argument sanitization, token-bucket rate limiter, payload validation |

---

## 6. Infrastructure, CI/CD & Database Migrations (`infra/`, `.github/`)

| Path | Purpose |
| :--- | :--- |
| `.github/workflows/ci-deploy.yml` | Existing 6-stage CI/CD pipeline (lint/typecheck, tests/security scan, static export & Docker build check, Cloudflare Pages staging, smoke tests, gated prod deploy to Cloudflare Pages + GCP Cloud Run) |
| `infra/Dockerfile.api` | Production Node 24 Bookworm non-root API image (`ffmpeg`, `yt-dlp`, `tini`, port 8080) |
| `infra/Dockerfile.worker` | Production Node 24 Bookworm internal Cloud Run worker image (`ffmpeg`, `yt-dlp`, `tini`, port 8080) |
| `infra/Dockerfile.media` | Legacy Node 20 Bookworm worker image (`pnpm`, port 5000, used by `docker-compose.yml`) |
| `infra/Dockerfile.web` | Production Node 20 Alpine Next.js SSR container image (port 3000) |
| `infra/docker-compose.yml` | Local 6-service orchestration (PostgreSQL 16, Redis 7, MinIO + bucket init, API, Media Worker, Web) |
| `infra/.env.example` | Docker Compose & AWS SQS environment template |
| `infra/cloudrun/{api-service,worker-service}.yaml` | Google Cloud Run Knative service specs (scale-to-zero, Secret Manager refs, internal-only worker ingress) |
| `infra/migrations/002_account_rewards_analytics.sql` | PostgreSQL DDL for 22 account, OAuth, MFA, rewards, jobs, and analytics tables |
| `infra/scripts/` | `init-db.sql`, `init-minio.sh`, `run-migrations.sh`, `healthcheck.sh`, `emergency-shutdown.sh` |
| `infra/terraform/` | AWS Terraform blueprint (`main.tf`, `variables.tf`, `outputs.tf`, `versions.tf`, `terraform.tfvars.example`, and 8 modules: `alb`, `cloudflare`, `database`, `ecs`, `networking`, `redis`, `s3`, `sqs`, `workers`) |

---

## 7. QA, Testing & Existing Documentation (`qa/`, `tests/`, `production/`, `docs/`)

| Directory | Contents & Purpose |
| :--- | :--- |
| `qa/harness/` | 8 verification scripts: `run-all-tests.ts`, `verify-account-platform.mjs`, `verify-account-platform-gates4to8.ts`, `verify-r2-sigv4.ts`, `verify-real-download-e2e.mjs`, `verify-static-export.mjs`, `verify-turboflow-e2e.mjs`, `verify-web-live.mjs` |
| `qa/load/` | `load-simulation.ts` concurrency/load simulator |
| `tests/` | `unit/{adapters,entitlements}.test.ts`, `concurrency/quota-race.test.ts`, `security/ssrf-regression.test.ts`, `integration/api-integration.test.ts`, `media/{media-engine.test.ts,synthetic-generator.ts}` + 12 synthetic FFmpeg fixtures (~685 KB) |
| `production/qa/` | `bug-triage-2026-11-18.md` (Sprint 1 bug register & localhost penetration test record) |
| `docs/architecture/` | 6 ADRs (`ADR-001`..`ADR-006`), `system-overview.md`, `database-schema.md`, `schema.sql`, `openapi.yaml`, `queue-state-machine.md` (plus publication-grade architecture docs) |
| `docs/account-platform/` | 10 engineering reports covering auth, analytics, rewards, user IDs, data flow, QA, priority benchmarks, security tests |
| `docs/deployment/` | 15 operational runbooks (API, Worker, DB, Storage, DNS, Domain, HTTPS, Rollback, Cost, Env Inventory, Security Verification) |
| `docs/design/` & `docs/branding/` | Design system, UI redesign/before-after/frontend QA reports, brand guidelines, migration, and asset inventory |
| `docs/security/` & root `docs/*.md` | `THREAT_MODEL.md`, `SECURITY_CHECKLIST.md`, `ABUSE_PREVENTION.md`, `RATE_LIMITING_ARCHITECTURE.md`, `MASTER_PRD.md`, `REFERENCE_AUDIT.md`, `CAPACITY_PLAN.md`, `QA_REPORT.md`, `LOAD_TEST_RESULTS.md`, `BUG_REGISTER.md`, `RELEASE_CHECKLIST.md`, `BRAND_RESEARCH.md` |
| `docs/seo/`, `docs/performance/`, `docs/improvements/`, `docs/turboflow/` | SEO strategy/schemas/audit reports, low-end device & priority benchmarks, UX/mock-data audits, TurboFlow benchmarks |
| `docs/repository/` | Publication audit suite: `REPOSITORY_AUDIT.md`, `PROJECT_INVENTORY.md`, `PUBLICATION_CHECKLIST.md`, plus `124_ENGINEERING_WORK_ITEMS.md` and `AI_ASSISTED_DEVELOPMENT.md` |
