# Changelog

All notable changes to **MUXARO** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned / In Progress
- Wire runtime PostgreSQL (`pg`) adapter inside `apps/api/src/db/database.ts` for stateless multi-replica Cloud Run scaling (PostgreSQL 16 DDL and migration runner already present under `infra/`).
- Wire remote HTTP RPC dispatch from `apps/api/src/services/queue.service.ts` to standalone `apps/media-worker` (`MEDIA_WORKER_URL`).
- Integrate outbound SMTP transport library for production email verification and password reset delivery (currently uses `dev-outbox.jsonl` in development).
- Add configurable cross-subdomain cookie `Domain` option (e.g., `Domain=.muxaro.app`) for split web/API production origins.
- Provision live `muxaro.app` domain, Cloudflare Pages, Cloudflare R2, Google Cloud Run services, and Google Secret Manager secrets.
- Harmonize sub-package `package.json` license metadata and remaining `@vyro/*` internal package scope names to `@muxaro/*` / `Apache-2.0`.

---

## [0.1.0] - 2026-11-18 (Initial Public Pre-Release Candidate)

### Added
- **Web Workspace (`apps/web`):**
  - Next.js `14.2.24` App Router frontend with 30 prerendered static/SSG routes (`CLOUDFLARE_PAGES=1` static export to `apps/web/out/`).
  - Tokenized Light/Dark consumer SaaS design system (`globals.css`, `tailwind.config.ts`), self-hosted `Inter` & `JetBrains_Mono`, and Hallmark Anti-AI-Slop compliance (`0 FAIL / 0 WARN`).
  - Dynamic code-split `MediaInspector` (Video, Audio, Merge modes with resolution/HDR/FPS deduplication) and `JobProgress` (visibility-aware polling, opt-in auto-download defaulting OFF, click-to-preview, Background Fetch progressive enhancement, retry/cancel).
  - Adaptive low-end device & network hook (`useDeviceMode`) supporting manual Lightweight mode, `prefers-reduced-motion`, `Save-Data`, 2G detection, and hidden-tab pausing.
  - Privacy-first Google Consent Mode v2 (`ConsentBanner`, `AnalyticsProvider`, PII-scrubbing `analytics.ts`) and opt-in server-verified `RewardedAdCard`.
- **REST & SSE API Gateway (`apps/api`):**
  - Fastify 5 + Node.js 24 API server with Swagger/OpenAPI UI (`/docs`), 13 route plugins (`/api/v1/*`), and persistent 22-table SQLite WAL store (`node:sqlite`).
  - Dual-ID architecture (internal RFC 9562 UUIDv7 + customer-safe Base32 `MXR-*`, `MXB-*`, `MXJ-*`, `MXRWD-*`).
  - Authentication & Account Platform: Argon2id (with Scrypt fallback) password hashing, SHA-256 hashed `HttpOnly` cookie sessions, synchronizer + double-submit CSRF (`x-muxaro-csrf`), Google OAuth 2.0 + PKCE (`S256`) + JWKS RS256 verification, and AES-256-GCM encrypted RFC 6238 TOTP Admin MFA.
  - Streaming single-file and 5 MB chunked resumable multipart uploads (up to 2 GiB, zero RAM buffering) and RFC 9110 HTTP `Range` (`206`/`416`/`ETag`/`If-Range`) signed artifact downloads.
  - Persistent TurboFlow 6-class isolated queues with 3-tier weighted fair priority scheduling (`PREMIUM: 6 > REGISTERED: 3 > GUEST: 1`) and anti-starvation aging.
  - Google Ad Manager ECDSA-SHA256 Server-Side Verification (SSV) rewarded credits with replay protection, 3-ad rolling 24h cap, and immutable credit ledger.
  - Zero-dependency pure-Node AWS SigV4 Cloudflare R2 storage client (`storage.service.ts`) with automatic local disk fallback.
- **Standalone Media Worker & Shared Packages (`apps/media-worker`, `packages/*`, `security/`):**
  - Isolated FFmpeg/FFprobe/ZIP microservice (`apps/media-worker`) with stream-copy classification, scratch disk management, and post-processing FFprobe verification.
  - Rolling 24-hour entitlements engine with atomic two-phase quota reservations (`packages/entitlements`).
  - Rights-validated source adapters (`packages/source-adapters`).
  - Defense-in-depth security package (`security/`): IPv4/IPv6/obfuscated-IP/DNS-pinning SSRF guard, `shell: false` FFmpeg sanitizer with `-protocol_whitelist file,crypto,data`, prototype pollution validation, and multi-layer rate limiting.
- **Infrastructure, QA & Open-Source Governance (`infra/`, `tests/`, `qa/`, `docs/`):**
  - Hardened non-root multi-stage Dockerfiles (`UID 10001`, `tini`), Docker Compose stack, Google Cloud Run manifests (`muxaro-api` + internal-only `muxaro-worker`), Terraform modules, PostgreSQL 16 migrations, and `emergency-shutdown.sh`.
  - Automated test & QA harnesses: 135 verified tests across 7 suites (`qa/harness/run-all-tests.ts`), Account Platform 8-gate QA harnesses, and offline R2 SigV4 verifier.
  - Apache License 2.0 (`LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md`), comprehensive architecture/frontend/backend/database/API/security/deployment documentation, 124-item engineering breakdown, and transparent AI-assisted development attribution.
