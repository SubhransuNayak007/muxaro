# Technology Decisions & Architecture Decision Records

**Project:** MUXARO  
**Scope:** Ground-truth technology stack audit and summary of accepted Architecture Decision Records (ADRs)

---

## 1. Technology Stack Matrix (Verified Against `package.json` & Source)

| Layer | Technology | Version / Spec | Rationale & Evidence |
| :--- | :--- | :--- | :--- |
| **Language** | TypeScript (ESM `"type": "module"`) | TS 5.6–7.0 across packages | Strict static typing across API, worker, web, security, adapters, and entitlements |
| **Server Runtime** | Node.js (LTS / Node 24 native SQLite & Argon2id) | Node 24 (`node:sqlite`, `crypto.argon2`) | Built-in `DatabaseSync` (zero native C++ SQLite build pain), built-in Argon2id + Scrypt + WebCrypto/fetch |
| **API Framework** | Fastify 5 (`@fastify/cors`, `@fastify/sensible`, `@fastify/swagger`, `@fastify/swagger-ui`) | `fastify ^5.12.8` (`apps/api`), `^5.2.1` (`apps/media-worker`) | Low-overhead HTTP/SSE streaming, schema-first OpenAPI generation, clean plugin encapsulation |
| **Frontend Framework** | Next.js 14 (App Router), React 18, Tailwind CSS | `next ^14.2.24`, `react ^18.3.1`, `tailwindcss ^3.4.14` | Hybrid SSR/static rendering, SEO metadata (`sitemap.ts`, `robots.ts`), Hallmark token-driven styling |
| **Active Runtime Database** | SQLite (`node:sqlite` `DatabaseSync`, WAL mode) | 22 relational tables in `.muxaro-data/muxaro.db` | Zero-ops persistent relational ACID storage with `BEGIN IMMEDIATE` transactions for single-node & local dev |
| **Target Distributed Database** | PostgreSQL 16 *(Provisioned DDL / Planned Runtime Cutover)* | `postgres:16-alpine` (`infra/docker-compose.yml`), `infra/migrations/002_*.sql` | Mirrors the exact 22-table relational model with `JSONB`, `TIMESTAMPTZ`, and `CHECK` constraints for multi-node scaling |
| **Object Storage** | Local Ephemeral Disk + Pure-Node Cloudflare R2 (AWS SigV4) | `apps/api/src/services/storage.service.ts` | Zero heavy AWS SDK dependency; honest `r2` vs `local` mode toggle; MinIO/S3 provisioned in `infra/` |
| **Media Processing Engines** | FFmpeg, FFprobe, yt-dlp | Invoked via `spawn(..., { shell: false })` / `execFile` | Industry-standard codec/container coverage, `-c copy` lossless remuxing, and real stream inspection |
| **Worker Validation & Archiving** | Zod (`^3.24.2`), Archiver (`^7.0.1`), Pure-Node Streaming ZIP | `apps/media-worker/` & `apps/api/src/routes/playlists.ts` | Strict schema validation in standalone worker; zero-dependency Store-method streaming ZIP in API playlist route |
| **Container & Cloud IaC** | Docker, Docker Compose, Google Cloud Run (Knative), Terraform (AWS) | `infra/` | Reproducible multi-stage images, scale-to-zero Cloud Run specs, and modular AWS ECS/RDS/SQS/S3 Terraform |

---

## 2. Key Architectural Trade-Offs (Implemented vs. Planned)

### 2.1 Zero-Dependency Cryptographic & Cloud Primitives in `apps/api`
- **Decision:** `apps/api/package.json` keeps only **5 production dependencies** (`fastify`, `@fastify/cors`, `@fastify/sensible`, `@fastify/swagger`, `@fastify/swagger-ui`).
- **Implemented with Node.js Standard Library (`node:crypto`, `node:sqlite`, `fetch`):**
  - Argon2id & Scrypt password hashing
  - RFC 6238 TOTP MFA & AES-256-GCM encryption
  - Google OIDC JWKS RS256 verification
  - Google Ad Manager ECDSA-SHA256 SSV verification
  - AWS Signature Version 4 (`AWS4-HMAC-SHA256`) for Cloudflare R2
  - Cookie parsing/serialization and Store-method streaming ZIP creation
- **Trade-off:** Dramatically smaller supply-chain attack surface, faster cold starts (critical for Cloud Run scale-to-zero), and zero native addon compilation failures—at the cost of maintaining well-tested internal protocol helpers (covered by unit/integration tests in `apps/api/tests/`, `security/tests/`, `tests/`, and `qa/harness/`).

### 2.2 SQLite WAL First, PostgreSQL 16 Ready
- **Decision:** Use Node 24's built-in `node:sqlite` (`DatabaseSync`) in WAL mode with `BEGIN IMMEDIATE` transactions as the active default store, while keeping `infra/migrations/002_account_rewards_analytics.sql` in strict 1:1 schema parity for PostgreSQL 16.
- **Trade-off:** Enables instant single-command local boot and zero-cost single-instance deployment while preserving a clean relational migration path when horizontal multi-node API scaling is needed.

### 2.3 In-Process TurboFlow Queue vs. Standalone `apps/media-worker`
- **Decision:** `apps/api` runs an in-process SQLite-backed 6-class / 3-tier priority queue (`QueueService`), while `apps/media-worker` implements a standalone Fastify FFmpeg microservice ready for remote dispatch.
- **Trade-off:** Single-node deployments avoid Redis/broker overhead and inter-service file transfers, while multi-node deployments can offload heavy transcodes to internal-only `apps/media-worker` instances over `backend-net` / Cloud Run internal ingress.

---

## 3. Architecture Decision Record (ADR) Index

All formal ADRs are preserved in `docs/architecture/adr/`:

| ADR | Title | Status | Implementation Alignment |
| :--- | :--- | :--- | :--- |
| [ADR-001](./adr/ADR-001-clean-room-gpl-isolation.md) | Clean-Room Software Architecture & GPL-3.0 Copyleft Isolation | Accepted | All MUXARO TypeScript code is clean-room; external media CLI tools (`ffmpeg`, `ffprobe`, `yt-dlp`) are invoked strictly out-of-process via `child_process` |
| [ADR-002](./adr/ADR-002-distributed-queue-architecture.md) | Distributed Queue Architecture — Redis BullMQ with PostgreSQL Transactional Outbox | Accepted *(Target Multi-Node Blueprint)* | Current runtime uses SQLite-persisted TurboFlow 6-class / 3-tier in-process queue; Redis/SQS/PostgreSQL outbox remains the provisioned multi-node target |
| [ADR-003](./adr/ADR-003-media-pipeline-ffmpeg-execution.md) | Media Pipeline Execution Strategy — Sandboxed FFmpeg, Stream-Copy Preference & Authentic Quality | Accepted | Fully implemented in `turboflow.service.ts`, `queue.service.ts`, `security/src/ffmpeg-sanitizer.ts`, and `apps/media-worker/` |
| [ADR-004](./adr/ADR-004-monorepo-tech-stack.md) | Monorepo Structure & Technology Stack Selection | Accepted | Implemented across `apps/web` (Next.js 14), `apps/api` (Fastify 5), `apps/media-worker` (Fastify 5), `packages/*`, and `security/` |
| [ADR-005](./adr/ADR-005-source-adapter-extensibility-and-rights.md) | Pluggable Source Adapter Pattern & Rights Verification Protocol | Accepted | Implemented in `packages/source-adapters/` (`SourceAdapterRegistry`, `DirectMediaAdapter`, `YouTubePermittedAdapter`, `AbuseDetector`) and integrated into `adapter.service.ts` |
| [ADR-006](./adr/ADR-006-entitlements-quota-atomic-reservation.md) | Entitlements, Quotas & Atomic Two-Phase Reservation Engine | Accepted | Fully implemented in `packages/entitlements/` and `apps/api/src/services/entitlements.service.ts` with atomic SQLite transactions, rolling 24h windows, isolated playlist bucket, and immutable `credit_ledger` |
