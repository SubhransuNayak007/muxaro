# AI-Assisted Development & Engineering Transparency

MUXARO (`SubhransuNayak007/muxaro`) was engineered through a transparent collaboration combining **human product ownership, architectural direction, code review, and local verification** with **AI-assisted development using Google Antigravity**.

This document records how AI assistance was used, which engineering workstreams benefited from it, what remained strictly under human direction and verification, and which open-source third-party libraries power the platform.

---

## 1. Human Engineering Direction & Oversight

Human engineering direction (`SubhransuNayak007`) governed:
- Product vision, domain scope, clean-room licensing boundary (`Apache-2.0`, zero GPL-3.0 code contamination), and compliance requirements (rights attestation, no unauthorized DRM circumvention).
- Architectural selection across the monorepo (`Next.js 14`, `Fastify 5`, `Node.js 24`, `FFmpeg`/`FFprobe`, `Cloudflare Pages`, `Cloudflare R2`, `Google Cloud Run`, `PostgreSQL 16` / `SQLite WAL`).
- Security posture decisions (SSRF protection, non-root containers, RFC 6238 TOTP Admin MFA, server-side ECDSA rewarded-ad verification, zero committed secrets).
- Final review, acceptance testing, repository publication approval, and ongoing maintenance governance.

---

## 2. AI-Assisted Development with Google Antigravity

Google Antigravity was utilized as an engineering force multiplier across structured software delivery workstreams:

| Workstream | AI-Assisted Contributions | Verification & Guardrails Applied |
| :--- | :--- | :--- |
| **Architecture & Specifications** | Drafting system topology, ADRs (`docs/architecture/adr/`), OpenAPI specs, SQL DDL (`infra/migrations/`), and Mermaid diagrams | Verified against actual routes, tables, and dependencies in source code |
| **Frontend & Design System (`apps/web`)** | Next.js 14 App Router pages, tokenized light/dark CSS (`globals.css`), `MediaInspector`, `JobProgress`, `Navbar`, `ConsentBanner`, and low-end adaptive mode (`useDeviceMode`) | Type-checked (`tsc --noEmit`), compiled (`npx next build`, 30/30 routes), linted with Hallmark anti-AI-slop checks, and verified in live browser sessions |
| **Backend API & Account Platform (`apps/api`)** | Fastify 5 routes, Node 24 SQLite WAL persistence, Argon2id/Scrypt auth, Google OAuth PKCE, RFC 6238 TOTP MFA, multi-layer rate limiting, TurboFlow 6-class priority queues, and pure-Node AWS SigV4 R2 client | Verified via API integration suite (`tests/integration/api-integration.test.ts`), Account Platform QA gates (`qa/harness/verify-account-platform*.mjs|ts`), and SigV4 harness (`qa/harness/verify-r2-sigv4.ts`) |
| **Media Engine & Source Adapters (`apps/media-worker`, `packages/*`)** | FFmpeg/FFprobe wrapper, stream-copy classifier, ZIP packager, rolling 24h entitlements engine, and rights-aware source adapters | Verified via synthetic FFmpeg media fixtures (`tests/media/media-engine.test.ts`), concurrency race tests (`tests/concurrency/quota-race.test.ts`), and unit suites |
| **Security Hardening (`security/`)** | Dual-layer SSRF guard (IPv4/IPv6 CIDR, obfuscated IPs, DNS IP pinning), FFmpeg `shell: false` sanitizer, prototype pollution validation, and log redaction | Verified via 69-case SSRF regression suite (`tests/security/ssrf-regression.test.ts`), sanitizer tests, and IDOR checks |
| **Infrastructure, CI & Documentation (`infra/`, `.github/`, `docs/`)** | Multi-stage non-root Dockerfiles, Cloud Run manifests, Terraform modules, GitHub Actions CI/security workflows, and repository documentation | Static YAML/workflow validation, secret audit (`0` live secrets), and independent read-only verification pass |

---

## 3. Quality, Truthfulness & Attribution Standards

1. **No Fabricated Claims:** Every documented endpoint, table, security control, and test count is grounded in inspectable code and runnable test scripts. Unfinished production items (such as PostgreSQL runtime driver wiring, outbound SMTP client integration, API-to-worker remote RPC dispatch, and live `muxaro.app` cloud provisioning) are explicitly marked as **Partial** or **Planned** in [`124_ENGINEERING_WORK_ITEMS.md`](./124_ENGINEERING_WORK_ITEMS.md).
2. **No Invented Contributors:** MUXARO credits real human ownership (`SubhransuNayak007`) and Google Antigravity transparently in [`AUTHORS.md`](../../AUTHORS.md) without fabricating fictional team members, GitHub handles, or email addresses.
3. **Clean-Room Licensing Compliance:** All source files in this repository are original works licensed under **Apache License 2.0** (`LICENSE`). External CLI tools (`FFmpeg`, `FFprobe`, `yt-dlp`) are invoked strictly out-of-process via argument arrays (`shell: false`), never statically linked into Node.js code.

---

## 4. Open-Source Libraries & Dependencies

MUXARO builds on well-maintained open-source ecosystems including Next.js, React, Tailwind CSS, Lucide Icons, Fastify, Zod, Archiver, TypeScript, and Node.js. Complete dependency license inventories and attribution notices are maintained in:
- [`LICENSE`](../../LICENSE)
- [`NOTICE`](../../NOTICE)
- [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md)
