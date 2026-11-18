# MUXARO — 124 Engineering Work Items Breakdown

**Repository:** `SubhransuNayak007/muxaro`  
**Audit Basis:** Direct inspection of source files (`apps/`, `packages/`, `security/`, `infra/`, `tests/`, `qa/`, `docs/`), automated test suites, and local build verification.  
**Status Legend:**
- **Implemented** — Verified in live source code (not merely documented) with matching implementation artifacts.
- **Partial** — Core code, schemas, or interfaces exist, but production wiring or runtime integration remains incomplete.
- **Planned** — Documented/designed or pending external cloud provisioning; not yet executed in live code or cloud infrastructure.

> **Workstream Count Summary (Exact Total = 124 Items):**
> Workstreams 1–9 preserve exact engineering slices (`12, 14, 14, 14, 10, 12, 12, 10, 10 = 108`), and Workstream 10 covers `16` items (`6` QA/Testing/Verification + `10` Documentation, Diagrams & Open-Source Publication) for an exact total of **124** tracked work items (`WI-001`–`WI-124`).

| # | Workstream | Items | Implemented | Partial | Planned |
| :---: | :--- | :---: | :---: | :---: | :---: |
| 1 | Foundation & Monorepo Architecture | 12 | 10 | 2 | 0 |
| 2 | Frontend Web Application & Design System | 14 | 14 | 0 | 0 |
| 3 | Backend REST & SSE API | 14 | 13 | 1 | 0 |
| 4 | Media Engine, Worker & Source Adapters | 14 | 13 | 1 | 0 |
| 5 | Authentication, Sessions, OAuth & MFA | 10 | 8 | 2 | 0 |
| 6 | Queue Scheduling, Entitlements & Performance | 12 | 11 | 1 | 0 |
| 7 | Security Hardening & Abuse Prevention | 12 | 12 | 0 | 0 |
| 8 | Database, Migrations & Object Storage | 10 | 8 | 2 | 0 |
| 9 | Deployment, Cloud Infrastructure & CI/CD | 10 | 6 | 0 | 4 |
| 10 | QA, Verification, Documentation & Publication | 16 | 16 | 0 | 0 |
| | **Total** | **124** | **111** | **9** | **4** |

---

## Workstream 1: Foundation & Monorepo Architecture (12 Items)

| ID | Description | Scope | Actual Status | Files Affected | Tests Required | Evidence | Related Issue/PR | Completion Date |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| WI-001 | Clean-room monorepo directory structure (`apps/`, `packages/`, `security/`, `infra/`, `tests/`, `qa/`, `docs/`) | Foundation | Implemented | `apps/*`, `packages/*`, `security/`, `infra/` | Structure audit | All directories present and populated | N/A (pre-publication) | 2026-11-18 |
| WI-002 | Root TypeScript base configuration and per-package `tsconfig.json` files | Foundation | Implemented | `tsconfig.json`, `apps/*/tsconfig.json`, `packages/*/tsconfig.json`, `security/tsconfig.json` | `tsc --noEmit` | Clean TypeScript builds verified in `apps/web` | N/A (pre-publication) | 2026-11-18 |
| WI-003 | Global MUXARO brand identity & configuration module | Foundation | Implemented | `packages/config/brand.ts`, `apps/web/lib/brand.ts` | Brand asset check | Canonical MUXARO brand exports active | N/A (pre-publication) | 2026-11-18 |
| WI-004 | Sanitized environment configuration template (`.env.example`) | Foundation | Implemented | `.env.example`, `infra/.env.example` | Secret scan | Zero live secrets; all 9 config sections documented | N/A (pre-publication) | 2026-11-18 |
| WI-005 | Comprehensive `.gitignore` excluding secrets, runtime DB/uploads/artifacts, build outputs | Foundation | Implemented | `.gitignore` | Secret & artifact scan | Excludes `.env*`, `.muxaro-*`, `.next/`, `apps/web/out/`, `node_modules/` | N/A (pre-publication) | 2026-11-18 |
| WI-006 | Cross-platform editor & Git line-ending normalization | Foundation | Implemented | `.editorconfig`, `.gitattributes` | LF/CRLF check | LF enforced for TS/JS/MD/SH/YML; binary flags set | N/A (pre-publication) | 2026-11-18 |
| WI-007 | API production configuration validator (`validateProductionConfig`) | Foundation | Implemented | `apps/api/src/config.ts` | Unit validation | Rejects dev secrets & `localhost` when `NODE_ENV=production` | N/A (pre-publication) | 2026-11-18 |
| WI-008 | Architectural Decision Records (ADR-001 through ADR-006) | Foundation | Implemented | `docs/architecture/adr/ADR-001..006*.md` | Architecture review | 6 ADRs covering GPL isolation, queues, FFmpeg, stack, adapters, quotas | N/A (pre-publication) | 2026-11-18 |
| WI-009 | Dual-ID generation standard (UUIDv7, `MXR-*`, `MXB-*`, `MXJ-*`, `MXRWD-*`) | Foundation | Implemented | `apps/api/src/services/id.service.ts` | Auth & batch QA gates | Verified RFC 9562 UUIDv7 & Crockford-style Base32 IDs | N/A (pre-publication) | 2026-11-18 |
| WI-010 | Repository-wide Apache-2.0 licensing, NOTICE & third-party attribution | Foundation | Implemented | `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md` | License audit | 0 copyleft npm/pnpm deps across 274 resolved packages | N/A (pre-publication) | 2026-11-18 |
| WI-011 | Harmonize sub-package `package.json` license & legacy `@vyro/*` naming fields | Foundation | Partial | `apps/*/package.json`, `packages/*/package.json`, `tests/package.json` | Package manifest audit | Root `LICENSE` is Apache-2.0; sub-package manifests still mix ISC/MIT/UNLICENSED & `@vyro` scope | N/A (pre-publication) | In Progress |
| WI-012 | Root workspace manager / unified lockfile consolidation | Foundation | Partial | Root directory, `apps/*/package-lock.json`, `apps/media-worker/pnpm-lock.yaml` | Clean install check | Per-app lockfiles work independently; no root workspace `package.json` yet | N/A (pre-publication) | In Progress |

---

## Workstream 2: Frontend Web Application & Design System (14 Items)

| ID | Description | Scope | Actual Status | Files Affected | Tests Required | Evidence | Related Issue/PR | Completion Date |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| WI-013 | Next.js 14 App Router root layout with self-hosted `Inter` & `JetBrains_Mono`, pre-paint theme script & skip link | Frontend | Implemented | `apps/web/app/layout.tsx` | `next build`, `G1-WEB` | `preload: false` on mono font; zero external font `<link>` | N/A (pre-publication) | 2026-11-18 |
| WI-014 | Hallmark-compliant Light/Dark tokenized CSS design system & Aurora Flow atmosphere | Frontend | Implemented | `apps/web/app/globals.css`, `apps/web/tailwind.config.ts` | `sloplint.mjs` | `0 FAIL, 0 REFLEX, 0 WARN` across 33 files | N/A (pre-publication) | 2026-11-18 |
| WI-015 | Responsive sticky `Navbar` with live quota pill, account dropdown, theme & lightweight toggles, mobile drawer | Frontend | Implemented | `apps/web/components/Navbar.tsx` | Live UI & keyboard QA | Escape focus return, ARIA attributes, zero fake quota fallbacks | N/A (pre-publication) | 2026-11-18 |
| WI-016 | 4-column semantic `Footer` with service status link and 60-minute auto-delete notice | Frontend | Implemented | `apps/web/components/Footer.tsx` | `next build`, route link audit | All product, docs, legal, and status links verified | N/A (pre-publication) | 2026-11-18 |
| WI-017 | Dual-mode home workspace (Paste URL / Local File drag-and-drop) with dynamic code-split islands | Frontend | Implemented | `apps/web/app/page.tsx` | `next build`, `verify-web-live.mjs` | `MediaInspector` & `JobProgress` lazy-loaded via `next/dynamic` | N/A (pre-publication) | 2026-11-18 |
| WI-018 | `MediaInspector` island with Video, Audio, and Merge modes & format normalization | Frontend | Implemented | `apps/web/components/MediaInspector.tsx`, `apps/web/lib/format-normalizer.ts` | Live E2E media workflow | Deduplicates resolutions/HDR/FPS; persists `muxaro-preferred-height` | N/A (pre-publication) | 2026-11-18 |
| WI-019 | `JobProgress` island with visibility-aware polling, opt-in auto-download, on-demand preview, Background Fetch, retry/cancel | Frontend | Implemented | `apps/web/components/JobProgress.tsx`, `apps/web/lib/background-download.ts` | `verify-turboflow-e2e.mjs` | Auto-download defaults OFF; friendly error mapper active | N/A (pre-publication) | 2026-11-18 |
| WI-020 | Adaptive low-end device & network hook (`useDeviceMode`) supporting Save-Data, 2G, reduced motion & tab visibility | Frontend | Implemented | `apps/web/lib/device-mode.ts` | Low-end trace verification | Syncs `data-lightweight="true"` across tabs via storage & custom events | N/A (pre-publication) | 2026-11-18 |
| WI-021 | Typed browser API client with CSRF double-submit & 5 MB streaming resumable multipart uploads | Frontend | Implemented | `apps/web/lib/api-client.ts`, `apps/web/lib/types.ts` | `verify-account-platform.mjs` | Uses `file.slice()` (never full RAM buffer) + 3 retries/part + `AbortController` | N/A (pre-publication) | 2026-11-18 |
| WI-022 | Dedicated media tools directory & 7 tool workflow pages | Frontend | Implemented | `apps/web/app/tools/**/page.tsx` | `next build` (30/30 routes) | Converter, Audio Extractor, A/V Merger, Video Merger, Batch, Playlist pages built | N/A (pre-publication) | 2026-11-18 |
| WI-023 | Account, Auth, My Downloads (`/dashboard`), Usage (`/credits`) & Admin (`/admin`) pages | Frontend | Implemented | `apps/web/app/{account,admin,credits,dashboard,login,register,reset-password,verify-email}/*` | `G1-WEB` (`23/23` routes `200`) | All account platform routes prerender & hydrate cleanly | N/A (pre-publication) | 2026-11-18 |
| WI-024 | Opt-in `RewardedAdCard` with lazy GPT script loading & server verification polling | Frontend | Implemented | `apps/web/components/RewardedAdCard.tsx` | `G4-SSV` verification | Hidden when unconfigured; never grants credits client-side | N/A (pre-publication) | 2026-11-18 |
| WI-025 | Consent Mode v2 `ConsentBanner`, `AnalyticsProvider` & PII-scrubbing analytics library | Frontend | Implemented | `apps/web/components/ConsentBanner.tsx`, `apps/web/components/AnalyticsProvider.tsx`, `apps/web/lib/analytics.ts` | `G6-ANALYTICS` verification | Defaults all 4 consent signals to `'denied'`; strips 6 PII vectors | N/A (pre-publication) | 2026-11-18 |
| WI-026 | Static SSG user documentation (`/docs/[slug]`), legal pages, `robots.ts`, `sitemap.ts` & Cloudflare export config | Frontend | Implemented | `apps/web/app/docs/*`, `apps/web/app/{privacy,terms,dmca,status}/*`, `apps/web/next.config.mjs`, `apps/web/public/_{headers,redirects}` | `verify-static-export.mjs` | `30/30` routes export cleanly to `apps/web/out/` when `CLOUDFLARE_PAGES=1` | N/A (pre-publication) | 2026-11-18 |

---

## Workstream 3: Backend REST & SSE API (14 Items)

| ID | Description | Scope | Actual Status | Files Affected | Tests Required | Evidence | Related Issue/PR | Completion Date |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| WI-027 | Fastify 5 application factory with CORS (`credentials: true`), Sensible, Swagger/OpenAPI UI, request IDs & error envelope | Backend | Implemented | `apps/api/src/app.ts`, `apps/api/src/index.ts` | `tests/integration/api-integration.test.ts` | `14/14` API integration tests pass; Swagger mounted at `/docs` | N/A (pre-publication) | 2026-11-18 |
| WI-028 | Liveness (`GET /api/v1/health`) and honest readiness (`GET /api/v1/ready`) probes checking DB, storage mode, FFmpeg, OAuth & ads | Backend | Implemented | `apps/api/src/routes/health.ts` | Integration & live probe test | Returns `200`/`503` accurately without leaking secrets | N/A (pre-publication) | 2026-11-18 |
| WI-029 | Media URL inspection endpoint (`POST /api/v1/media/inspect`) with rights declaration validation | Backend | Implemented | `apps/api/src/routes/media.ts`, `apps/api/src/services/adapter.service.ts` | `api-integration.test.ts` | Validates payload, enforces SSRF & rights checks | N/A (pre-publication) | 2026-11-18 |
| WI-030 | Streaming single-file & resumable multipart upload endpoints (up to 2 GiB, zero RAM buffering) | Backend | Implemented | `apps/api/src/routes/media.ts` | `verify-real-download-e2e.mjs` | `upload/init`, `part/:partNumber`, `complete`, `DELETE` with SHA-256 assembly | N/A (pre-publication) | 2026-11-18 |
| WI-031 | Processing job creation, status lookup, cancellation, retry & SSE progress streaming routes | Backend | Implemented | `apps/api/src/routes/jobs.ts` | `api-integration.test.ts`, `G3-IDOR` | Supports `POST/GET /jobs`, `/cancel`, `/retry`, `/download`, SSE events | N/A (pre-publication) | 2026-11-18 |
| WI-032 | Multi-item batch creation (`MXB-*`), item tracking (`001`/`002`), listing & cancellation routes | Backend | Implemented | `apps/api/src/routes/batches.ts` | `G3-IDOR` gate | Verified 3-item batch creation & cross-account IDOR blocking | N/A (pre-publication) | 2026-11-18 |
| WI-033 | Standalone media tools route (`POST /api/v1/tools/merge`) | Backend | Implemented | `apps/api/src/routes/tools.ts` | `api-integration.test.ts` | Schema-validated `MERGE_AUDIO_VIDEO` execution | N/A (pre-publication) | 2026-11-18 |
| WI-034 | Playlist inspection & bounded batch processing routes (max 50 items) | Backend | Implemented | `apps/api/src/routes/playlists.ts` | `api-integration.test.ts` | Enforces 50-item cap and playlist quota bucket | N/A (pre-publication) | 2026-11-18 |
| WI-035 | Secure signed binary download delivery with full RFC 9110 HTTP Range (`206`, `416`, `ETag`, `If-Range`, `?inline=1`) | Backend | Implemented | `apps/api/src/routes/download.ts`, `apps/api/src/services/token.service.ts` | `G8-MEDIA-REG` | Verified Range, conditional `If-Range`, `416`, inline preview, and IDOR checks | N/A (pre-publication) | 2026-11-18 |
| WI-036 | User profile & device session management endpoints (`/api/v1/me`, `/api/v1/me/sessions/:id`) | Backend | Implemented | `apps/api/src/routes/me.ts` | `G2-AUTH`, `G3-IDOR` | Authenticated profile update & multi-device session listing/revocation | N/A (pre-publication) | 2026-11-18 |
| WI-037 | Account quota summary, job history & unified entitlements/credit-ledger endpoints | Backend | Implemented | `apps/api/src/routes/account.ts`, `apps/api/src/routes/entitlements.ts` | `G4-SSV`, `api-integration.test.ts` | Returns live rolling 24h allowances and immutable ledger records | N/A (pre-publication) | 2026-11-18 |
| WI-038 | Google Ad Manager rewarded ads config, session creation, refresh & ECDSA-SHA256 SSV callback routes | Backend | Implemented | `apps/api/src/routes/rewards.ts`, `apps/api/src/services/rewards.service.ts` | `G4-SSV` gate | Verified `prime256v1` SSV signing, replay protection & 3-ad daily cap | N/A (pre-publication) | 2026-11-18 |
| WI-039 | Admin Control Centre routes (`/admin/metrics`, `/search`, `/users`, `/suspend`, `/restore`, `/settings`, `/audit-logs`, `/security-events`) | Backend | Implemented | `apps/api/src/routes/admin.ts`, `apps/api/src/services/admin.service.ts` | `G7-ADMIN-MFA` gate | Enforces `requireAdminMfa` + immutable `admin_audit_logs` | N/A (pre-publication) | 2026-11-18 |
| WI-040 | Remote HTTP RPC dispatch from `apps/api` to standalone `apps/media-worker` (`MEDIA_WORKER_URL`) | Backend | Partial | `apps/api/src/services/queue.service.ts`, `apps/media-worker/src/server.ts` | Distributed worker integration test | Both services work independently; `queue.service.ts` still invokes local CLI binaries instead of calling `MEDIA_WORKER_URL` | N/A (pre-publication) | In Progress |

---

## Workstream 4: Media Engine, Worker & Source Adapters (14 Items)

| ID | Description | Scope | Actual Status | Files Affected | Tests Required | Evidence | Related Issue/PR | Completion Date |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| WI-041 | Standalone `@muxaro/media-worker` Fastify microservice with Zod-validated REST endpoints | Media | Implemented | `apps/media-worker/src/server.ts`, `apps/media-worker/src/service.ts` | `apps/media-worker/src/__tests__/server.test.ts` | Exposes `/health`, `/api/probe`, `/api/process-video`, `/api/extract-audio`, `/api/merge`, `/api/package` | N/A (pre-publication) | 2026-11-18 |
| WI-042 | FFprobe media inspector & stream metadata extraction | Media | Implemented | `apps/media-worker/src/prober/ffprobe.ts` | `tests/media/media-engine.test.ts` | Extracts containers, video/audio codecs, dimensions, FPS, bitrates | N/A (pre-publication) | 2026-11-18 |
| WI-043 | Stream-copy vs. transcode strategy classifier | Media | Implemented | `apps/media-worker/src/prober/classifier.ts` | `apps/media-worker/src/__tests__/classifier.test.ts` | Selects lossless `-c copy` when container/codec are compatible | N/A (pre-publication) | 2026-11-18 |
| WI-044 | Video remuxer & transcoder (`mp4`, `mkv`, `webm`; `360p`–`8K`; H.264/HEVC/VP9/AV1) | Media | Implemented | `apps/media-worker/src/transcoder/video.ts` | `tests/media/media-engine.test.ts` | Verified 1080p→720p transcode & stream-copy with synthetic fixtures | N/A (pre-publication) | 2026-11-18 |
| WI-045 | Audio stream extractor & encoder (`mp3`, `aac`, `m4a`, `flac`, `wav`, `opus`, `copy`) | Media | Implemented | `apps/media-worker/src/transcoder/audio.ts` | `tests/media/media-engine.test.ts` | Verified lossless copy extraction (`.m4a`) & transcode (`.mp3`) | N/A (pre-publication) | 2026-11-18 |
| WI-046 | Audio/video stream multiplexer (`merger.ts`) | Media | Implemented | `apps/media-worker/src/merger/merger.ts` | `tests/media/media-engine.test.ts` | Verified A/V merge output (`merged_av.mp4`) | N/A (pre-publication) | 2026-11-18 |
| WI-047 | Multi-item playlist ZIP archive packager (`archiver`) | Media | Implemented | `apps/media-worker/src/packager/zipper.ts` | `apps/media-worker/src/__tests__/end-to-end.test.ts` | Streams multi-item batches into verified ZIP artifacts | N/A (pre-publication) | 2026-11-18 |
| WI-048 | Isolated scratch disk manager with automatic cleanup | Media | Implemented | `apps/media-worker/src/scratch/disk-manager.ts` | `apps/media-worker/src/__tests__/disk-manager.test.ts` | Enforces bounded scratch directories and cleanup on finish/error | N/A (pre-publication) | 2026-11-18 |
| WI-049 | Post-processing output artifact verifier (FFprobe audit before `READY`) | Media | Implemented | `apps/media-worker/src/verification/verifier.ts` | `apps/media-worker/src/__tests__/end-to-end.test.ts` | Confirms non-zero size & valid streams before marking `READY` | N/A (pre-publication) | 2026-11-18 |
| WI-050 | Hardened child process executor & argument sanitizer in worker | Media | Implemented | `apps/media-worker/src/process/executor.ts`, `apps/media-worker/src/process/sanitizer.ts` | `apps/media-worker/src/__tests__/sanitizer.test.ts` | Strict `shell: false`, timeouts, metacharacter rejection | N/A (pre-publication) | 2026-11-18 |
| WI-051 | Source adapter registry & direct HTTP/S media adapter with MIME & header inspection | Media | Implemented | `packages/source-adapters/src/{adapter-registry,direct-adapter,utils/http-inspector,utils/mime-detector}.ts` | `packages/source-adapters/tests/*.test.ts` | `16/16` adapter unit tests pass | N/A (pre-publication) | 2026-11-18 |
| WI-052 | Permitted YouTube metadata adapter & rights declaration validator | Media | Implemented | `packages/source-adapters/src/{youtube-permitted-adapter,rights-validator}.ts` | `tests/unit/adapters.test.ts` | Enforces permitted metadata inspection & rights attestation | N/A (pre-publication) | 2026-11-18 |
| WI-053 | TurboFlow strategy selector & human-friendly error mapper | Media | Implemented | `apps/api/src/services/turboflow.service.ts` | `verify-turboflow-e2e.mjs` | Selects `instant` / `smart` / `power` lanes & maps internal errors | N/A (pre-publication) | 2026-11-18 |
| WI-054 | Synthetic media fixture generator & hardware acceleration profiles | Media | Partial | `tests/media/synthetic-generator.ts`, `apps/media-worker/src/transcoder/video.ts` | `tests/media/media-engine.test.ts` | Software FFmpeg fixtures & CPU transcoding complete; GPU/NVENC profiles not yet implemented | N/A (pre-publication) | In Progress |

---

## Workstream 5: Authentication, Sessions, OAuth & MFA (10 Items)

| ID | Description | Scope | Actual Status | Files Affected | Tests Required | Evidence | Related Issue/PR | Completion Date |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| WI-055 | Email registration & login with native Node 24 Argon2id (OWASP m=19456, t=2, p=1) + Scrypt fallback | Auth | Implemented | `apps/api/src/services/auth.service.ts`, `apps/api/src/routes/auth.ts` | `G2-AUTH` gate | Verified non-plaintext Argon2id/Scrypt hashes in SQLite | N/A (pre-publication) | 2026-11-18 |
| WI-056 | Anti-enumeration login/register/recovery responses & constant-time dummy hash check | Auth | Implemented | `apps/api/src/services/auth.service.ts` | `G2-AUTH` gate | Verified identical generic responses on duplicate register & forgot-password | N/A (pre-publication) | 2026-11-18 |
| WI-057 | SHA-256 hashed server-side cookie sessions (`muxaro_session`) & guest session isolation (`muxaro_guest`) | Auth | Implemented | `apps/api/src/middleware/auth.middleware.ts` | `G2-AUTH` gate | `HttpOnly; SameSite=Lax`, `Secure` in prod/HTTPS, 30-day TTL | N/A (pre-publication) | 2026-11-18 |
| WI-058 | Synchronizer + double-submit CSRF protection (`muxaro_csrf` + `x-muxaro-csrf`) | Auth | Implemented | `apps/api/src/middleware/auth.middleware.ts`, `apps/web/lib/api-client.ts` | `G2-AUTH` gate | Verified `403 ERR_CSRF_INVALID` without header, `200` with matching header | N/A (pre-publication) | 2026-11-18 |
| WI-059 | Multi-device session listing, single-session revocation & `logout-all` | Auth | Implemented | `apps/api/src/routes/me.ts`, `apps/api/src/routes/auth.ts` | `G2-AUTH`, `G8-MEDIA-REG` | Verified `GET /me/sessions`, `DELETE /me/sessions/:id`, `POST /auth/logout-all` | N/A (pre-publication) | 2026-11-18 |
| WI-060 | Google OAuth 2.0 Authorization Code + PKCE (S256) + Nonce + RS256 JWKS verification | Auth | Implemented | `apps/api/src/services/auth.service.ts`, `apps/api/src/routes/auth.ts` | `G2-AUTH` gate | Cleanly returns `503 ERR_GOOGLE_AUTH_NOT_CONFIGURED` when unset; full PKCE/JWKS wired | N/A (pre-publication) | 2026-11-18 |
| WI-061 | RFC 6238 TOTP MFA service with AES-256-GCM secret encryption at rest & mandatory admin gate | Auth | Implemented | `apps/api/src/services/mfa.service.ts`, `apps/api/src/middleware/auth.middleware.ts` | `G7-ADMIN-MFA` gate | Verified TOTP setup/verify, replay counter check & `requireAdminMfa` enforcement | N/A (pre-publication) | 2026-11-18 |
| WI-062 | Frontend `AuthProvider` context with `sessionStorage` pending task restoration across login/OAuth | Auth | Implemented | `apps/web/lib/auth-context.tsx` | `G1-WEB`, `G2-AUTH` | Restores workspace task (30m TTL) and clears analytics ID on logout | N/A (pre-publication) | 2026-11-18 |
| WI-063 | Single-use email verification & password reset token lifecycle + production SMTP transport | Auth | Partial | `apps/api/src/services/auth.service.ts`, `apps/api/package.json` | `G2-AUTH` + SMTP integration test | Token hashing, TTL, single-use replay rejection, session revocation & `dev-outbox.jsonl` verified; outbound SMTP network client not yet installed | N/A (pre-publication) | In Progress |
| WI-064 | Configurable cross-subdomain cookie `Domain` support (`Domain=.muxaro.app`) for split web/API hosts | Auth | Partial | `apps/api/src/middleware/auth.middleware.ts` | Cross-origin HTTPS cookie test | `serializeCookie()` supports `HttpOnly`/`Secure`/`SameSite`/`Path`/`Max-Age`; `Domain` attribute not yet added (same-origin proxy works today) | N/A (pre-publication) | In Progress |

---

## Workstream 6: Queue Scheduling, Entitlements & Performance (12 Items)

| ID | Description | Scope | Actual Status | Files Affected | Tests Required | Evidence | Related Issue/PR | Completion Date |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| WI-065 | Persistent SQLite-backed TurboFlow 6-class isolated job queue (`instant`, `audio`, `merge`, `video`, `high-res`, `playlist`) | Queue/Perf | Implemented | `apps/api/src/services/queue.service.ts` | `verify-turboflow-e2e.mjs` | Independent concurrency caps (`4, 4, 2, 2, 1, 1`) and `MAX_TOTAL_QUEUED = 200` | N/A (pre-publication) | 2026-11-18 |
| WI-066 | 3-Tier weighted fair priority scheduler (`PREMIUM: 6 > REGISTERED: 3 > GUEST: 1`) with anti-starvation aging | Queue/Perf | Implemented | `apps/api/src/services/queue.service.ts` | `G5-PRIORITY` benchmark | Verified `+1` weight / `5s` aging (cap `+12`); `0` guest starvation in 12-job contention test | N/A (pre-publication) | 2026-11-18 |
| WI-067 | Rolling 24-hour quota engine (`@vyro/entitlements`) with isolated individual & playlist buckets | Queue/Perf | Implemented | `packages/entitlements/src/quota/{rules,sliding-window}.ts` | `packages/entitlements/tests/*.test.ts` | `14/14` unit tests pass (`tests/unit/entitlements.test.ts`) | N/A (pre-publication) | 2026-11-18 |
| WI-068 | Atomic two-phase quota reservation (`reserve` / `commit` / `rollback`) with concurrency lock | Queue/Perf | Implemented | `packages/entitlements/src/quota/reservation.ts`, `apps/api/src/services/entitlements.service.ts` | `tests/concurrency/quota-race.test.ts`, `G4-SSV` | `5/5` race tests pass (50-thread & 20-thread races: zero double-spend) | N/A (pre-publication) | 2026-11-18 |
| WI-069 | Request idempotency manager preventing duplicate job/quota billing on retries | Queue/Perf | Implemented | `packages/entitlements/src/idempotency/idempotency-manager.ts` | `packages/entitlements/tests/idempotency.test.ts` | User-scoped idempotency deduplication verified | N/A (pre-publication) | 2026-11-18 |
| WI-070 | Immutable credit ledger (`credit_ledger`) with automatic 24-hour reward credit expiry sweep | Queue/Perf | Implemented | `apps/api/src/services/entitlements.service.ts`, `packages/entitlements/src/ledger/ledger.ts` | `G4-SSV` expiry test | Appends `REWARD_GRANTED`, `CREDIT_CONSUMED`, `CREDIT_EXPIRED` immutably | N/A (pre-publication) | 2026-11-18 |
| WI-071 | 60-minute ephemeral artifact TTL cleanup & retention reporting | Queue/Perf | Implemented | `apps/api/src/services/queue.service.ts` | `verify-real-download-e2e.mjs` | Purges expired local artifacts after `DEFAULT_RETENTION_MINUTES` (60m) | N/A (pre-publication) | 2026-11-18 |
| WI-072 | Queue & worker telemetry metrics (`GET /api/v1/admin/metrics`) including per-tier wait p50/p95 | Queue/Perf | Implemented | `apps/api/src/routes/admin.ts`, `apps/api/src/services/queue.service.ts` | `G5-PRIORITY` | Live metrics endpoint verified on `http://127.0.0.1:4000/api/v1/admin/metrics` | N/A (pre-publication) | 2026-11-18 |
| WI-073 | Frontend bundle optimization (dynamic islands, `JetBrains_Mono` `preload: false`, lightweight mode) | Queue/Perf | Implemented | `apps/web/app/{layout,page,globals.css}`, `apps/web/lib/device-mode.ts` | `next build` + DevTools trace | Shared JS `87.4 kB`, CLS `0.0003`, LCP `-60.5%` under 20× CPU lab trace | N/A (pre-publication) | 2026-11-18 |
| WI-074 | Visibility-aware polling backoff in `JobProgress` & `My Downloads` | Queue/Perf | Implemented | `apps/web/components/JobProgress.tsx`, `apps/web/app/dashboard/page.tsx` | Live browser verification | Pauses polling when tab is hidden; exponential backoff `2s -> 10s` | N/A (pre-publication) | 2026-11-18 |
| WI-075 | Monte Carlo 100,000 CCU / 20.5k RPS queueing-theory capacity simulation | Queue/Perf | Implemented | `qa/load/load-simulation.ts` | `PERF-LOAD` harness | `5/5` simulation assertions pass (analytic model; not live cloud load test) | N/A (pre-publication) | 2026-11-18 |
| WI-076 | Distributed Redis / BullMQ job queue & distributed rate-limiter backend implementation | Queue/Perf | Partial | `apps/api/src/services/ratelimit.service.ts`, `infra/docker-compose.yml` | Multi-replica Redis test | `RedisRateLimitClient` interface & Docker Redis exist; no `redis`/`bullmq` npm client wired yet | N/A (pre-publication) | In Progress |

---

## Workstream 7: Security Hardening & Abuse Prevention (12 Items)

| ID | Description | Scope | Actual Status | Files Affected | Tests Required | Evidence | Related Issue/PR | Completion Date |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| WI-077 | Comprehensive SSRF Guard (IPv4/IPv6 CIDR blocklists, obfuscated IP decoder, port/userinfo/metadata blocking) | Security | Implemented | `security/src/ssrf-guard.ts` | `tests/security/ssrf-regression.test.ts` | `69/69` SSRF regression tests pass | N/A (pre-publication) | 2026-11-18 |
| WI-078 | DNS rebinding TOCTOU defense via socket IP pinning + TLS SNI + redirect re-validation (`safeFetch`) | Security | Implemented | `security/src/ssrf-guard.ts` | `security/tests/ssrf.test.ts` | Pins pre-validated IP & re-checks every redirect hop (max 5) | N/A (pre-publication) | 2026-11-18 |
| WI-079 | Independent adapter-layer SSRF filter | Security | Implemented | `packages/source-adapters/src/ssrf-filter.ts` | `packages/source-adapters/tests/ssrf-filter.test.ts` | Defense-in-depth URL check inside `@muxaro/source-adapters` | N/A (pre-publication) | 2026-11-18 |
| WI-080 | FFmpeg command sanitizer (`shell: false`, `-protocol_whitelist file,crypto,data`, codec/preset allowlists, symlink jail) | Security | Implemented | `security/src/ffmpeg-sanitizer.ts` | `security/tests/ffmpeg-sanitizer.test.ts` | Blocks metacharacters, traversal (`..`), and symlink escapes | N/A (pre-publication) | 2026-11-18 |
| WI-081 | Request schema validation & prototype pollution defense (`__proto__`, `constructor`, `prototype`, bounds) | Security | Implemented | `security/src/validation.ts` | `security/tests/validation.test.ts` | Enforces max URL 2048 chars, max 50 playlist items, max 4h duration | N/A (pre-publication) | 2026-11-18 |
| WI-082 | Multi-layer hybrid sliding-window + token-bucket rate limiter (10 policies, progressive login backoff, polling exempt) | Security | Implemented | `apps/api/src/services/ratelimit.service.ts`, `security/src/rate-limiter.ts` | `security/tests/rate-limiter.test.ts`, `G2-AUTH` | Verified `429` + `Retry-After` on brute-force & burst floods | N/A (pre-publication) | 2026-11-18 |
| WI-083 | Duplicate mutation payload flood detector (`checkDuplicateFlood`) | Security | Implemented | `apps/api/src/services/ratelimit.service.ts`, `apps/api/src/app.ts` | `G2-AUTH` / integration test | Fingerprints mutating payloads & throttles burst floods with `429` | N/A (pre-publication) | 2026-11-18 |
| WI-084 | Strict IDOR ownership guard (`isOwnerOrAdmin`) across jobs, batches, sessions, rewards & signed downloads | Security | Implemented | `apps/api/src/services/request-identity.ts`, `apps/api/src/routes/download.ts` | `G3-IDOR` gate | `9/9` cross-account IDOR vectors blocked (`403`/`404`) & logged | N/A (pre-publication) | 2026-11-18 |
| WI-085 | HMAC-SHA256 signed download tokens with `crypto.timingSafeEqual` verification & expiration | Security | Implemented | `apps/api/src/services/token.service.ts` | `api-integration.test.ts` | Tampered/expired tokens return `403 ERR_INVALID_DOWNLOAD_TOKEN` | N/A (pre-publication) | 2026-11-18 |
| WI-086 | Recursive log & telemetry redaction (`redactSensitiveData`, IP `/24` & `/48` truncation) | Security | Implemented | `apps/api/src/services/ratelimit.service.ts`, `apps/api/src/app.ts` | `G6-ANALYTICS` & error audit | Scrubs secrets, emails, tokens, and raw URLs; masks 5xx stack traces | N/A (pre-publication) | 2026-11-18 |
| WI-087 | Immutable `admin_audit_logs` & redacted `security_events` tables with read-only API exposure | Security | Implemented | `apps/api/src/db/database.ts`, `apps/api/src/routes/admin.ts` | `G7-ADMIN-MFA` gate | Zero mutation endpoints on audit/security tables | N/A (pre-publication) | 2026-11-18 |
| WI-088 | Defensive HTTP security headers on both Fastify API (`onSend`) and Cloudflare Pages (`public/_headers`) | Security | Implemented | `apps/api/src/app.ts`, `apps/web/public/_headers` | `verify-static-export.mjs` | Sets `nosniff`, `DENY`, `Referrer-Policy`, `Permissions-Policy`, `noindex` on private routes | N/A (pre-publication) | 2026-11-18 |

---

## Workstream 8: Database, Migrations & Object Storage (10 Items)

| ID | Description | Scope | Actual Status | Files Affected | Tests Required | Evidence | Related Issue/PR | Completion Date |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| WI-089 | Persistent Node 24 SQLite WAL database engine with all 22 relational tables, FK constraints & seeded `system_settings` | DB/Storage | Implemented | `apps/api/src/db/database.ts` | `verify-account-platform.mjs` | Initializes `.muxaro-data/muxaro.db` atomically with `BEGIN IMMEDIATE` | N/A (pre-publication) | 2026-11-18 |
| WI-090 | PostgreSQL 16 base DDL (`init-db.sql`) and Account/Rewards/Analytics migration (`002_account_rewards_analytics.sql`) | DB/Storage | Implemented | `infra/scripts/init-db.sql`, `infra/migrations/002_account_rewards_analytics.sql` | SQL syntax & schema review | Full 22-table PostgreSQL DDL with indexes & constraints authored | N/A (pre-publication) | 2026-11-18 |
| WI-091 | Idempotent PostgreSQL migration runner with `schema_migrations` tracking | DB/Storage | Implemented | `infra/scripts/run-migrations.sh` | Migration script audit | Applies `init-db.sql` + ordered `infra/migrations/*.sql` once each | N/A (pre-publication) | 2026-11-18 |
| WI-092 | Zero-dependency pure-Node AWS SigV4 Cloudflare R2 client (`StorageService`) | DB/Storage | Implemented | `apps/api/src/services/storage.service.ts` | `qa/harness/verify-r2-sigv4.ts` | Real `AWS4-HMAC-SHA256` request signing & presigned GET URLs verified | N/A (pre-publication) | 2026-11-18 |
| WI-093 | Non-guessable, path-traversal-proof object key generator (`uploads/`, `processed/`, `playlists/`, `temporary/`) | DB/Storage | Implemented | `apps/api/src/services/storage.service.ts` | `qa/harness/verify-r2-sigv4.ts` | Hashes `ownerId`, adds 24-hex CSPRNG nonce, rejects `..` and null bytes | N/A (pre-publication) | 2026-11-18 |
| WI-094 | Upload MIME allowlist, 2 GiB cap & SHA-256 checksum tagging (`x-amz-meta-sha256`) | DB/Storage | Implemented | `apps/api/src/services/storage.service.ts`, `apps/api/src/routes/media.ts` | `qa/harness/verify-r2-sigv4.ts` | Enforces content-type & size bounds before persistence | N/A (pre-publication) | 2026-11-18 |
| WI-095 | Honest automatic `r2` vs. `local` storage mode fallback | DB/Storage | Implemented | `apps/api/src/services/storage.service.ts`, `apps/api/src/routes/health.ts` | `verify-r2-sigv4.ts` | Never reports `r2Configured: true` unless all 4 `R2_*` vars are present | N/A (pre-publication) | 2026-11-18 |
| WI-096 | Local MinIO bucket initializer script for Docker Compose staging | DB/Storage | Implemented | `infra/scripts/init-minio.sh`, `infra/docker-compose.yml` | Docker Compose check | Provisions `muxaro-uploads` and `muxaro-artifacts` buckets automatically | N/A (pre-publication) | 2026-11-18 |
| WI-097 | Runtime PostgreSQL (`pg`) adapter inside `apps/api/src/db/database.ts` for multi-replica Cloud Run | DB/Storage | Partial | `apps/api/src/db/database.ts`, `apps/api/package.json` | PostgreSQL integration test | PostgreSQL DDL & runner exist; `apps/api` runtime currently executes `node:sqlite` only | N/A (pre-publication) | In Progress |
| WI-098 | End-to-end live Cloudflare R2 upload/presign/lifecycle verification against provisioned production bucket | DB/Storage | Partial | `apps/api/src/services/storage.service.ts` | Live R2 smoke test | Offline SigV4 tests pass; live cloud bucket test awaits Cloudflare R2 credentials | N/A (pre-publication) | In Progress |

---

## Workstream 9: Deployment, Cloud Infrastructure & CI/CD (10 Items)

| ID | Description | Scope | Actual Status | Files Affected | Tests Required | Evidence | Related Issue/PR | Completion Date |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| WI-099 | Hardened multi-stage non-root Dockerfiles for API, Media Worker & Web (`UID 10001`, `tini`, healthchecks) | Deployment/CI | Implemented | `infra/Dockerfile.api`, `infra/Dockerfile.worker`, `infra/Dockerfile.web`, `infra/Dockerfile.media` | Docker build validation | All 4 Dockerfiles authored with non-root users & health probes | N/A (pre-publication) | 2026-11-18 |
| WI-100 | Local multi-service Docker Compose stack (PostgreSQL 16, Redis 7, MinIO, API, Worker, Web) | Deployment/CI | Implemented | `infra/docker-compose.yml`, `infra/scripts/healthcheck.sh` | `docker compose config` | Complete 3-network local orchestration manifest | N/A (pre-publication) | 2026-11-18 |
| WI-101 | Google Cloud Run manifests for `muxaro-api` (public) & `muxaro-worker` (internal-only) with Secret Manager refs & cost caps | Deployment/CI | Implemented | `infra/cloudrun/api-service.yaml`, `infra/cloudrun/worker-service.yaml` | YAML & guardrail audit | Enforces `minScale: 0`, `maxScale: 2`, `ingress: internal` on worker, zero literal secrets | N/A (pre-publication) | 2026-11-18 |
| WI-102 | Modular Terraform IaC templates (networking, database, redis, s3, sqs, ecs, alb, workers, cloudflare) | Deployment/CI | Implemented | `infra/terraform/**/*.tf` | `terraform validate` | 9 reusable Terraform modules + `terraform.tfvars.example` | N/A (pre-publication) | 2026-11-18 |
| WI-103 | Emergency traffic-halt & rollback script (`--dry-run`, `--revoke-public`, `--restore`) | Deployment/CI | Implemented | `infra/scripts/emergency-shutdown.sh` | Shell syntax & dry-run check | Restricts API ingress to internal & toggles Cloudflare Under Attack mode | N/A (pre-publication) | 2026-11-18 |
| WI-104 | GitHub Actions CI, security scanning, CodeQL, Dependabot & deployment workflows | Deployment/CI | Implemented | `.github/workflows/*.yml`, `.github/dependabot.yml` | YAML lint & CI run on push | CI, security, CodeQL, and deploy workflows configured with least-privilege permissions | N/A (pre-publication) | 2026-11-18 |
| WI-105 | Live `muxaro.app` domain registration & Cloudflare DNS zone activation | Deployment/CI | Planned | External Cloudflare Dashboard | `dig` & HTTPS curl check | Pending owner domain registration & Cloudflare authentication | N/A (pre-publication) | Planned |
| WI-106 | Live Cloudflare Pages production deployment for `muxaro.app` & `www.muxaro.app` | Deployment/CI | Planned | External Cloudflare Pages | Live HTTP/2 `200`/`301` check | Static bundle verified locally (`apps/web/out/`); live push pending CF credentials | N/A (pre-publication) | Planned |
| WI-107 | Live Google Cloud Run provisioning, Secret Manager secret creation & `api.muxaro.app` TLS certificate issuance | Deployment/CI | Planned | External GCP Project | `openssl s_client` + `/ready` | Manifests ready; live GCP project & `gcloud` auth pending owner setup | N/A (pre-publication) | Planned |
| WI-108 | Live production PostgreSQL (Supabase / Cloud SQL) & Cloudflare R2 bucket provisioning | Deployment/CI | Planned | External Supabase / GCP / Cloudflare R2 | Migration & SigV4 smoke test | Pending cloud account provisioning & secret injection | N/A (pre-publication) | Planned |

---

## Workstream 10: QA, Verification, Documentation & Open-Source Publication (16 Items)

*(Items WI-109–WI-114 cover Automated QA & Verification; Items WI-115–WI-124 cover Engineering Documentation, Architecture Diagrams, Licensing & Community Governance.)*

| ID | Description | Scope | Actual Status | Files Affected | Tests Required | Evidence | Related Issue/PR | Completion Date |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| WI-109 | Master QA test harness executing 7 suites (135 tests: SSRF, entitlements, concurrency, adapters, media, API, load) | QA | Implemented | `qa/harness/run-all-tests.ts`, `tests/**/*` | `npx tsx qa/harness/run-all-tests.ts` | `7/7` suites, `135/135` tests passed (`docs/QA_REPORT.md`) | N/A (pre-publication) | 2026-11-18 |
| WI-110 | Account Platform 8-gate verification harnesses (Web, Auth, IDOR, GAM SSV, Priority, Analytics, Admin MFA, Media Reg) | QA | Implemented | `qa/harness/verify-account-platform.mjs`, `qa/harness/verify-account-platform-gates4to8.ts` | Live local verification | `8/8` gates passed (`docs/account-platform/FINAL_QA_REPORT.md`) | N/A (pre-publication) | 2026-11-18 |
| WI-111 | End-to-end download, TurboFlow, static export & live web verification harnesses | QA | Implemented | `qa/harness/verify-{real-download-e2e,turboflow-e2e,static-export,web-live}.mjs` | Harness runs | Verified streaming downloads, Range resume, and static `out/` export | N/A (pre-publication) | 2026-11-18 |
| WI-112 | Offline Cloudflare R2 AWS SigV4 verification harness | QA | Implemented | `qa/harness/verify-r2-sigv4.ts` | `npx tsx qa/harness/verify-r2-sigv4.ts` | Verified RFC 3986 encoding, SigV4 headers & presigned URLs | N/A (pre-publication) | 2026-11-18 |
| WI-113 | Independent bug triage & security remediation register (BUG-001 to BUG-008 closed) | QA | Implemented | `production/qa/bug-triage-2026-11-18.md`, `docs/BUG_REGISTER.md` | Regression suite | `8/8` defects closed with verified regression tests | N/A (pre-publication) | 2026-11-18 |
| WI-114 | Low-end mobile device & Core Web Vitals lab performance audit | QA | Implemented | `docs/performance/LOW_END_DEVICE_REPORT.md`, `docs/performance/ACCOUNT_PRIORITY_BENCHMARK.md` | DevTools 20× CPU trace | Documented honest lab vs. CrUX field distinction | N/A (pre-publication) | 2026-11-18 |
| WI-115 | Repository, secret & third-party licensing audit documentation | Docs/Pub | Implemented | `docs/repository/{REPOSITORY_AUDIT,PROJECT_INVENTORY,PUBLICATION_CHECKLIST}.md` | Secret & license scan | `0` live secrets, `274` deps audited, `Apache-2.0` confirmed | N/A (pre-publication) | 2026-11-18 |
| WI-116 | Core system architecture, component, data flow, scalability, networking & technology decision docs | Docs/Pub | Implemented | `docs/architecture/*.md` | Code-doc alignment | Grounded in actual monorepo services | N/A (pre-publication) | 2026-11-18 |
| WI-117 | Backend, queue, media pipeline, upload delivery & rate-limiting documentation | Docs/Pub | Implemented | `docs/backend/*.md` | Code-doc alignment | Mirrors `apps/api` and `apps/media-worker` implementations | N/A (pre-publication) | 2026-11-18 |
| WI-118 | Database schema, relationships, migrations & indexing documentation | Docs/Pub | Implemented | `docs/database/*.md` | Schema parity check | Matches 22-table SQLite/PostgreSQL schemas | N/A (pre-publication) | 2026-11-18 |
| WI-119 | OpenAPI reference, endpoint catalog & error code documentation | Docs/Pub | Implemented | `docs/api/{OPENAPI,API_REFERENCE,ERROR_CODES}.md` | Route audit | Extracted from live Fastify route plugins | N/A (pre-publication) | 2026-11-18 |
| WI-120 | Consolidated Mermaid architectural diagrams (system, media pipeline, auth, ERD, queue, deployment, security) | Docs/Pub | Implemented | `docs/diagrams/MERMAID_DIAGRAMS.md` | Mermaid syntax check | Clean valid Mermaid diagrams matching real code | N/A (pre-publication) | 2026-11-18 |
| WI-121 | Complete Frontend documentation suite (Architecture, Design System, Components, State, Responsive, Performance) | Docs/Pub | Implemented | `docs/frontend/*.md` (6 files) | File & token verification | Aligned with `apps/web` tokens, components & hooks | N/A (pre-publication) | 2026-11-18 |
| WI-122 | Complete Security documentation suite (Threat Model, Auth, Authz, Upload, SSRF, Secrets, Abuse Prevention) | Docs/Pub | Implemented | `docs/security/*.md` (7 files) | Security code audit | Grounded in `security/` and `apps/api/src/` controls | N/A (pre-publication) | 2026-11-18 |
| WI-123 | Complete Deployment & Operations documentation suite (Local, Prod, Cloudflare, Domain, SSL/TLS, DB, Storage, Worker, Rollback, Troubleshooting) | Docs/Pub | Implemented | `docs/deployment/*.md` (10 files) | Command & manifest check | Truthful setup commands and unprovisioned cloud caveats | N/A (pre-publication) | 2026-11-18 |
| WI-124 | Root open-source community, governance, transparency & README presentation suite | Docs/Pub | Implemented | `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`, `AUTHORS.md`, `CHANGELOG.md`, `CITATION.cff`, `docs/repository/AI_ASSISTED_DEVELOPMENT.md`, `assets/*` | Link, badge & visual check | Transparent Antigravity attribution, honest `v0.1.0` changelog, real screenshots | N/A (pre-publication) | 2026-11-18 |
