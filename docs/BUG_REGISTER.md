# MUXARO — Production Bug Register & Remediation Log
**System**: MUXARO Workspace Platform  
**Document**: `docs/BUG_REGISTER.md`  
**Execution Timestamp**: 2026-11-18T12:00:00Z  
**Lead Auditor**: AGENT 10 (Independent QA, Performance & Release Engineer)  
**Total Bugs Identified**: 9  
**Total Bugs Remediated**: 9  
**Remaining Open Blockers**: **0 (Zero Open Defects)**  
**Release Readiness**: **VERIFIED**

---

## Bug Severity & Classification Matrix

| Bug ID | Component | Summary | Severity | Remediation | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **BUG-001** | `tests/security` | Integer representation miscalculation in SSRF test case | Low | Replaced `16820416` with correct network-byte order uint32 `16843008` for `1.1.1.0`. | **CLOSED** |
| **BUG-002** | `tests/unit` | Entitlements method name divergence in unit test suite | Medium | Aligned test method calls to `reserveJobQuota`, `commitJobQuota`, `rollbackJobQuota`. | **CLOSED** |
| **BUG-003** | `tests/concurrency` | Missing store method for historical timestamp injection | Medium | Updated test harness to persist committed reservations via `store.saveReservation()` with historical timestamps. | **CLOSED** |
| **BUG-004** | `tests/unit` | Adapter rights evaluation property divergence | Low | Updated test assertions to check `isPermitted` and `canExtractStreams`. | **CLOSED** |
| **BUG-005** | `qa/harness` | Windows shell path splitting on whitespace directory | High | Refactored child process execution to pass normalized relative paths (`tests/...`) with project root `cwd`. | **CLOSED** |
| **BUG-006** | `tests/integration` | Guest session rotation bypassing user-scoped idempotency | Medium | Added explicit test user authentication (`Bearer usr_qa_tester`) to ensure idempotency evaluation scopes to identical user session. | **CLOSED** |
| **BUG-007** | `tests/integration` | Lingering pre-rebrand string expectation in download test | Low | Updated assertion to expect canonical `MUXARO Media Delivery Artifact` banner. | **CLOSED** |
| **BUG-008** | `tests/integration` | Operation enum divergence on `/tools/merge` route | Low | Aligned assertion from `MEDIA_MERGE` to canonical Fastify schema enum `MERGE_AUDIO_VIDEO`. | **CLOSED** |
| **BUG-009** | `apps/api` + `apps/web` | Simulated worker pipeline, mock `download.ts` text buffer, silent `api-client.ts` mock job fallback, and `.receipt.txt` Blob generator in `JobProgress.tsx` | **Critical** | Replaced with real `yt-dlp`/`ffmpeg`/`ffprobe` backend pipeline (`#87`), strict Fastify payload mapping (`#85`), real backend polling & native binary download (`#84`). Verified via live `ffprobe` E2E harness (`MDN_Flower_CC0_Video.mp4` `1.12 MB` & `Me_at_the_zoo.mp3` `331 KB`). | **CLOSED** |

---

## Detailed Bug Reports & Remediation Evidence

### BUG-001: SSRF Obfuscated Integer Arithmetic
- **Subsystem**: Security (`tests/security/ssrf-regression.test.ts`)
- **Severity**: Low (Test logic defect)
- **Description**: The regression test case verifying that public IP `1.1.1.0` passes SSRF validation mistakenly used integer `16820416`. In network-byte order, `16820416` evaluates to `1.0.168.192` (Class A public IP, but mismatched test expectation).
- **Root Cause**: Manual endianness conversion mistake.
- **Remediation**: Corrected to $(1 \times 2^{24}) + (1 \times 2^{16}) + (1 \times 2^8) + 0 = 16843008$.
- **Verification**: `npx tsx tests/security/ssrf-regression.test.ts` passed 69/69 tests.

---

### BUG-002: Entitlements Engine Two-Phase Reservation Signatures
- **Subsystem**: Entitlements (`packages/entitlements`)
- **Severity**: Medium
- **Description**: The unit test called legacy method stubs `reserveJob`, `confirmReservation`, and `rollbackReservation`.
- **Root Cause**: Package API refinement by Agent 04 during implementation of strict two-phase commit protocol.
- **Remediation**: Test suite updated to invoke `reserveJobQuota`, `commitJobQuota`, and `rollbackJobQuota`. Verified reservation payload return structure `{ reservationId, status: 'RESERVED' }`.
- **Verification**: `tests/unit/entitlements.test.ts` passed 14/14 tests.

---

### BUG-003: Quota Race Historical Timestamp Injection
- **Subsystem**: Concurrency & Race Conditions (`tests/concurrency/quota-race.test.ts`)
- **Severity**: Medium
- **Description**: The race test attempted to invoke `store.saveActiveUsageTimestamp`, which was not present on `InMemoryEntitlementStore`.
- **Root Cause**: Store implementation stores reservations rather than raw timestamp primitives.
- **Remediation**: Implemented boundary window simulation by calling `store.saveReservation({ reservationId, userId, jobType, status: 'COMMITTED', createdAt: Date.now() - 86399000 })`.
- **Verification**: Successfully validated that a reservation at $T = 23\text{h } 59\text{m } 59\text{s}$ is rejected, while a reservation at $T = 24\text{h } 00\text{m } 01\text{s}$ is accepted.

---

### BUG-004: Source Adapter Rights Schema Alignment
- **Subsystem**: Source Adapters (`packages/source-adapters`)
- **Severity**: Low
- **Description**: Test asserted `rights.isAuthorized`, whereas the adapter engine exports `rights.isPermitted` and `rights.canExtractStreams`.
- **Root Cause**: Minor naming difference between RFC specification and production TypeScript interfaces.
- **Remediation**: Aligned test expectations with production interface `RightsEvaluationResult`.
- **Verification**: `tests/unit/adapters.test.ts` passed 16/16 tests.

---

### BUG-005: Shell Command Path Escaping with Directory Whitespace
- **Subsystem**: QA Test Harness (`qa/harness/run-all-tests.ts`)
- **Severity**: High (Harness failure)
- **Description**: Under Windows Node.js `child_process.spawn('npx', ['tsx', fullPath], { shell: true })`, an absolute repository path containing spaces (e.g., `<workspace path>/...`) was tokenized at the space boundary into an unescaped second argument, causing `ERR_MODULE_NOT_FOUND`.
- **Root Cause**: Windows command shell tokenization on unquoted spaces.
- **Remediation**: Refactored the test harness to pass normalized relative paths (`tests/...`) with explicit working directory `cwd: projectRoot`.
- **Verification**: Test harness cleanly spawns and collects results across all 7 suites without shell escaping issues.

---

### BUG-006: Guest Session Rotation Bypassing User-Scoped Idempotency
- **Subsystem**: API Integration (`tests/integration/api-integration.test.ts`)
- **Severity**: Medium (Test isolation)
- **Description**: Fastify injected requests without an `Authorization` header were treated as separate guest users (`anon_<uuid>`). Consequently, two consecutive requests with identical `idempotencyKey` values were evaluated against different user scopes and thus generated separate jobs.
- **Root Cause**: Correct security isolation in `entitlementsService.resolveSession` (guest users do not share idempotency namespaces), but unauthenticated test calls.
- **Remediation**: Added `authorization: 'Bearer usr_qa_tester'` header to both requests, proving that identical user sessions correctly return the cached job ID without double-charging quota.
- **Verification**: Verified identical `jobId` returned with HTTP 202 status.

---

### BUG-007: Lingering Pre-Rebrand String Expectation
- **Subsystem**: API Integration (`tests/integration/api-integration.test.ts`)
- **Severity**: Low
- **Description**: Download route test asserted that the streamed artifact payload contained the pre-rebrand string `PureMux Media Delivery Artifact`.
- **Root Cause**: Rebranding directive #23 migrated all route artifacts to `MUXARO Media Delivery Artifact`.
- **Remediation**: Updated test assertion to expect `MUXARO Media Delivery Artifact`.
- **Verification**: `GET /api/v1/download/:token` test passed cleanly with 200 OK.

---

### BUG-008: Standalone Merge Route Operation Enum Alignment
- **Subsystem**: API Integration (`tests/integration/api-integration.test.ts`)
- **Severity**: Low
- **Description**: Test asserted that `res.body.data.operation` was `'MEDIA_MERGE'`, whereas the queue service and Fastify schema export `'MERGE_AUDIO_VIDEO'`.
- **Root Cause**: Schema consistency requirement.
- **Remediation**: Updated test assertion to `'MERGE_AUDIO_VIDEO'`.
- **Verification**: `POST /api/v1/tools/merge` integration test passed with HTTP 202 Accepted.

---

### BUG-009: Simulated Download Pipeline & `.receipt.txt` Fake File Delivery
- **Subsystem**: Full-Stack Download Pipeline (`apps/api/src/services/queue.service.ts`, `apps/api/src/routes/download.ts`, `apps/web/lib/api-client.ts`, `apps/web/components/JobProgress.tsx`)
- **Severity**: Critical (Severity 1 — Core Product Functionality)
- **Description**: Submitting a video or audio URL caused the UI to fall back to a simulated local job and download a tiny `.receipt.txt` text file instead of a real playable binary video/audio artifact.
- **Root Cause**: Four compounding defects: (1) `queue.service.ts` simulated progress with `delay()` instead of executing `yt-dlp`/`ffmpeg`; (2) `download.ts` served a static `mockMediaBuffer` string instead of streaming real files from disk; (3) `api-client.ts` sent mismatched schema fields and caught HTTP 400 errors into a fake local job generator; (4) `JobProgress.tsx` simulated client progress and generated a `.receipt.txt` Blob on download click.
- **Remediation**:
  - `@pipeline` (`#87`): Implemented real `yt-dlp` + `ffmpeg` + `ffprobe` inspection and processing pipeline into jailed `.muxaro-artifacts/<jobId>/`, streaming real binary files with accurate `Content-Type`, `Content-Disposition`, SHA-256 checksums, and HTTP `206` Range support.
  - `@uiinspect` (`#85`): Removed silent mock fallbacks on `/media/inspect` and `/jobs`, aligned `createJob()` payload strictly to Fastify's schema, and verified Next.js `/api/v1/:path*` proxy rewrite.
  - `@uimotion` (`#84`): Removed `.receipt.txt` Blob generation and client-side fake progress, wired real 1000ms backend polling and native `<a href="/api/v1/download/..." download>` binary delivery.
- **Verification**: Verified live end-to-end through `http://localhost:3000/api/v1/*` via `qa/harness/verify-real-download-e2e.mjs` (both `MDN_Flower_CC0_Video.mp4` `1,128,375 B` `video:h264, audio:aac` `5.055s` and `Me_at_the_zoo.mp3` `331,053 B` `audio:mp3` `19.006s` passed exact SHA-256 match, HTTP `206` Range streaming, and `ffprobe` playability verification). `tests/integration/api-integration.test.ts` updated and verified **14 / 14 PASS**.

---

## 3. Residual Defect Summary
- **Open Severity 1 (Critical)**: **0**
- **Open Severity 2 (Major)**: **0**
- **Open Severity 3 (Medium)**: **0**
- **Open Severity 4 (Minor / Cosmetic)**: **0**

**All discovered defects have been permanently remediated, regression tested, and signed off.**
