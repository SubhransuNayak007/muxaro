# Contributing to MUXARO

Thank you for your interest in contributing to **MUXARO** (*Your Media. One Powerful Workspace.*)!  
This repository is licensed under the [Apache License 2.0](./LICENSE), and all contributions are expected to adhere to our [Code of Conduct](./CODE_OF_CONDUCT.md).

---

## 1. Before You Start

- **Clean-Room & Legal Boundary:** MUXARO is a clean-room TypeScript/Node.js codebase licensed under **Apache-2.0**. Do **not** submit GPL/LGPL/AGPL-licensed source code or DRM-circumvention code. External media tools (`ffmpeg`, `ffprobe`, `yt-dlp`) must remain strictly out-of-process CLI invocations (`shell: false`).
- **Truthfulness & Evidence:** Never add mock fallbacks, fabricated metrics, or placeholder telemetry that pretend a disabled feature is live.
- **Zero Secrets:** Never commit `.env` files, API keys, private certificates, OAuth credentials, or local `.muxaro-data/` / `.muxaro-artifacts/` / `.muxaro-uploads/` runtime artifacts.

---

## 2. Local Development Setup

MUXARO does **not** use a root `package.json`; install dependencies inside each app or package directory. See [Local Setup Guide](./docs/deployment/LOCAL_SETUP.md) for complete instructions.

### Prerequisites
- **Node.js 24 LTS** (required by `apps/api` for native `node:sqlite` and `crypto.argon2`)
- **npm 10+**
- **FFmpeg & FFprobe** installed on `PATH`

### Quick Start

```bash
# 1. Fork and clone the repository
git clone https://github.com/<your-username>/muxaro.git
cd muxaro

# 2. Create local environment file
cp .env.example .env

# 3. Install dependencies
(cd apps/api && npm ci)
(cd apps/web && npm ci)

# 4. Run API (port 4000) and Web (port 3000) in separate terminals
(cd apps/api && npm run dev)
(cd apps/web && npm run dev)
```

---

## 3. Coding & Design Standards

### Frontend (`apps/web`)
- Follow the [MUXARO Design System](./docs/frontend/DESIGN_SYSTEM.md): declare all colors, shadows, and fonts as CSS custom properties in `:root` inside `apps/web/app/globals.css` and consume them through Tailwind semantic utilities.
- Preserve both Light and Dark themes, keyboard `:focus-visible` outlines, `prefers-reduced-motion: reduce`, and Lightweight mode (`useDeviceMode()`).
- Verify static export compatibility (`CLOUDFLARE_PAGES=1 npm run build`) so all routes continue to build cleanly for Cloudflare Pages.

### Backend & Security (`apps/api`, `apps/media-worker`, `packages/*`, `security/`)
- Never invoke shell commands (`exec` or `spawn(..., { shell: true })`); always pass discrete argument arrays with `{ shell: false }` and `-protocol_whitelist file,crypto,data` for FFmpeg/FFprobe.
- Validate all external URLs through `security/src/ssrf-guard.ts` before network fetches.
- Enforce `requireAuth` / `requireAdminMfa` / `verifyCsrf` and `isOwnerOrAdmin()` on all tenant-owned resources.
- Route all error telemetry and security events through `redactSensitiveData()`.

### Formatting
- Follow [`.editorconfig`](./.editorconfig) and [`.gitattributes`](./.gitattributes): UTF-8, LF line endings, 2-space indentation for TypeScript/JavaScript/JSON/YAML/CSS.

---

## 4. Verification Before Opening a Pull Request

Run the relevant checks before submitting a PR:

```bash
# Frontend type-check & production build
(cd apps/web && npx tsc --noEmit && npm run build)

# Static export check
(cd apps/web && CLOUDFLARE_PAGES=1 npm run build)
node qa/harness/verify-static-export.mjs

# API integration test suite (14 tests)
npx tsx --test tests/integration/api-integration.test.ts

# Security & SSRF regression tests
npx tsx --test tests/security/ssrf-regression.test.ts

# Consolidated QA harness (requires ffmpeg & ffprobe on PATH)
npx tsx qa/harness/run-all-tests.ts
```

---

## 5. Pull Request Process

1. Create a descriptive feature branch from `main` (e.g., `feat/pg-runtime-driver`, `fix/cookie-domain-config`, `docs/update-local-setup`).
2. Keep pull requests focused on a single concern with concise, conventional commit messages (`feat:`, `fix:`, `docs:`, `security:`, `chore:`, `test:`).
3. Include clear testing evidence (commands run and observed output) in your PR description.
4. For security vulnerabilities, **do not** open a public issue or PR—follow our private disclosure process in [`SECURITY.md`](./SECURITY.md).

---

## 6. Licensing of Contributions

By submitting a pull request to `SubhransuNayak007/muxaro`, you agree that your contributions will be licensed under the [Apache License 2.0](./LICENSE) (Section 5 of the Apache License 2.0).
