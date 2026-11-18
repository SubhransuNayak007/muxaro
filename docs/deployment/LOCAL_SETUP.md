# MUXARO Local Development Setup

This guide covers exact, verified prerequisites, installation steps, startup commands, and local verification for running MUXARO (`apps/api`, `apps/web`, and optionally `apps/media-worker`) on your workstation.

---

## 1. Prerequisites & Verified Runtime Versions

| Tool | Required Version | Verified Local Version | Why It Is Needed |
| :--- | :--- | :--- | :--- |
| **Node.js** | **24.x LTS** (required for `apps/api`) | `v24.15.0` | `apps/api/src/db/database.ts` uses Node 24's built-in `node:sqlite` (`DatabaseSync`), and `auth.service.ts` uses native `crypto.argon2` (with `scrypt` fallback). `apps/web` also builds on Node 20 or 24. |
| **npm** | `>= 10.x` | `11.12.1` | Installing dependencies in `apps/api`, `apps/web`, `packages/entitlements`, `security`, `tests` |
| **pnpm** *(optional)* | `>= 9.x` | — | Lockfiles exist for `apps/media-worker` and `packages/source-adapters` (`npm install` also works) |
| **FFmpeg & FFprobe** | `>= 6.0` on `PATH` | `8.1.2` | Required for real media probing, stream-copy remuxing, transcoding, audio extraction, and A/V merging (`GET /api/v1/ready` checks `ffmpeg -version`) |
| **Python 3** *(optional)* | `>= 3.10` | `3.12.10` | Runtime prerequisite if installing `yt-dlp` via `pip` |
| **`yt-dlp`** *(optional)* | Recent release on `PATH` | `2026.08.19` | Used for external permitted URL metadata inspection in `queue.service.ts` / `adapter.service.ts` |
| **Docker Desktop** *(optional)* | Compose v2 | — | Only needed if using the multi-container stack in `infra/docker-compose.yml` |

Verify your toolchain before installing:

```bash
node -v
npm -v
ffmpeg -version
ffprobe -version
```

---

## 2. Clone & Configure Environment

> **Repository Layout Note:** MUXARO does **not** use a root `package.json`. Dependencies are installed per application/package directory (`apps/api`, `apps/web`, `apps/media-worker`, `packages/*`).

```bash
git clone https://github.com/SubhransuNayak007/muxaro.git
cd muxaro

# Copy the sanitized environment template (never commit .env!)
cp .env.example .env
```

Minimal local `.env` defaults work out of the box with zero external cloud accounts:
- **Database:** Auto-initializes local SQLite WAL at `.muxaro-data/muxaro.db` (`22` relational tables).
- **Storage:** Automatically falls back to local disk directories (`.muxaro-uploads/`, `.muxaro-artifacts/`) when `R2_*` variables are unset.
- **Google OAuth & Rewarded Ads:** Stay cleanly disabled until `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` or `GAM_REWARDED_AD_UNIT_PATH` are configured.
- **Transactional Email:** Writes verification and password-reset links to local `dev-outbox.jsonl` when `SMTP_HOST` is unset.

---

## 3. Install Dependencies

Install dependencies for the API server and Web application:

```bash
# 1. API Gateway (Fastify 5 + tsx)
cd apps/api
npm ci
cd ../..

# 2. Web Frontend (Next.js 14.2.24)
cd apps/web
npm ci
cd ../..

# 3. Optional: Standalone Media Worker microservice
cd apps/media-worker
npm install
cd ../..

# 4. Optional: Shared packages (needed for running package unit tests directly)
cd packages/entitlements && npm ci && cd ../..
```

---

## 4. Start Local Services

Open two terminals from the repository root:

### Terminal 1 — Fastify API (`http://127.0.0.1:4000`)

```bash
cd apps/api
npm run dev
```

*(For a non-watching server run: `npm start`. Swagger UI is available at `http://localhost:4000/docs`.)*

### Terminal 2 — Next.js Web Workspace (`http://localhost:3000`)

```bash
cd apps/web
npm run dev
```

Because `CLOUDFLARE_PAGES` defaults to `0`, `apps/web/next.config.mjs` automatically proxies `/api/v1/:path*` to `API_INTERNAL_URL` (`http://127.0.0.1:4000`), keeping cookies same-origin in local development.

### Optional Terminal 3 — Standalone Media Worker (`http://127.0.0.1:3002`)

```bash
cd apps/media-worker
npm run dev
```

*(Note: `apps/media-worker/src/server.ts` defaults to `PORT=3002`; set `PORT=5000` when mirroring `infra/docker-compose.yml`.)*

---

## 5. Verify Local Installation

```bash
# 1. API liveness & readiness (checks SQLite WAL + FFmpeg availability)
curl -s http://127.0.0.1:4000/api/v1/health
curl -s http://127.0.0.1:4000/api/v1/ready

# 2. Frontend type-check & production build
cd apps/web
npx tsc --noEmit
npm run build
cd ../..

# 3. API integration test suite (14 tests)
npx tsx --test tests/integration/api-integration.test.ts

# 4. Full QA test harness (SSRF, entitlements, concurrency, adapters, media engine, API, load)
npx tsx qa/harness/run-all-tests.ts
```

---

## 6. Alternative: Docker Compose Stack (`infra/docker-compose.yml`)

To run the containerized stack (PostgreSQL 16, Redis 7, MinIO S3, API, Media Worker, Web):

```bash
cd infra
cp .env.example .env
docker compose up --build
```

Verify all containers with `sh infra/scripts/healthcheck.sh`.

---

## 7. Common Local Setup Errors & Fixes

| Symptom / Error | Root Cause | Resolution |
| :--- | :--- | :--- |
| `Error: Cannot find module 'node:sqlite'` | Node.js version is `< 22.5` (e.g. Node 18 or 20) | Switch to **Node.js 24 LTS** (`nvm use 24` or install Node 24.x). |
| `GET /api/v1/ready` returns `503` with `ffmpegAvailable: false` | `ffmpeg` binary is missing from system `PATH` | Install FFmpeg (Windows: `winget install Gyan.FFmpeg`; macOS: `brew install ffmpeg`; Ubuntu/Debian: `sudo apt install ffmpeg`), restart your shell, and re-test `ffmpeg -version`. |
| `ENOENT: no such file or directory, open '.../package.json'` | Running `npm install` in the repository root | MUXARO has no root `package.json`; `cd` into `apps/api`, `apps/web`, or `apps/media-worker` first. |
| Frontend requests to `/api/v1/*` fail with `ECONNREFUSED` | `apps/api` is not running on port `4000` or `API_INTERNAL_URL` differs | Start `apps/api` (`cd apps/api && npm run dev`) and confirm `http://127.0.0.1:4000/api/v1/health` responds `200`. |
| `403 ERR_CSRF_INVALID` when testing `POST`/`PATCH` via `curl` | Cookie session request sent without matching `x-muxaro-csrf` header | Capture the `muxaro_csrf` cookie or response `csrfToken` and pass `-H "x-muxaro-csrf: <token>"`. |
| `EADDRINUSE: address already in use :::4000` or `:::3000` | Another process is already bound to port `3000` or `4000` | Stop the existing process or start with `PORT=4001` (and update `API_INTERNAL_URL=http://127.0.0.1:4001`). |
| `503 ERR_GOOGLE_AUTH_NOT_CONFIGURED` | Clicking Google Sign-In without OAuth env vars set | Expected safe behavior; set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in `.env` to enable Google OAuth. |

For additional runtime and production diagnostics, see [Troubleshooting](./TROUBLESHOOTING.md).
