# MUXARO Production & Pre-Launch Smoke Test Report
**Product:** MUXARO — *Your Media. One Powerful Workspace.*  
**Scope:** Cloudflare Pages Static Export (`apps/web/out/`), Standard Production Server (`localhost:3000`), Fastify API (`127.0.0.1:4000`), R2 AWS SigV4 Client, and End-to-End Integration Suite  
**Date:** 18 November 2026  
**Auditor:** AGENT 10 (Independent QA, Performance & Release Engineer)  

---

## 1. Environment Transparency Notice

> **Important Distinction:** All checks in Section 2 were executed empirically against the local production builds (`apps/web/out/`, `apps/web/.next`) and live local daemons (`http://localhost:3000` and `http://127.0.0.1:4000`).
>
> **No public staging or production URL (`https://muxaro.app` / `https://api.muxaro.app`) is live yet**, because external cloud authentication (`wrangler`, `gcloud`, `supabase`) and explicit financial approval for purchasing the `muxaro.app` domain have not yet been executed by the project owner. Section 4 provides the exact post-deployment smoke test commands to execute immediately once cloud credentials are connected.

---

## 2. Executed Pre-Launch Smoke Test Matrix (Verified Local & Artifact Checks)

| # | Smoke Test Gate | Command / Harness | Result | Measured Empirical Evidence |
| :---: | :--- | :--- | :---: | :--- |
| 1 | **TypeScript Strict Check (Web)** | `cd apps/web && npx tsc --noEmit` | **PASS** | Exit code `0` — `0` errors across all 41 source files. |
| 2 | **Hallmark Anti-AI-Slop Floor** | `sloplint.mjs apps/web/app apps/web/components` | **PASS** | **`0 FAIL, 0 WARN, 8 WAIVED`** across **41 files** (exit `0`). |
| 3 | **Cloudflare Pages Static Export** | `CLOUDFLARE_PAGES=1 NEXT_PUBLIC_SITE_URL=https://muxaro.app NEXT_PUBLIC_API_URL=https://api.muxaro.app npx next build` | **PASS** | Exit code `0` — **32 / 32 static & SSG pages exported** to `apps/web/out/` (including `/robots.txt` & `/sitemap.xml`). |
| 4 | **Export Artifact & Leak Audit** | `node qa/harness/verify-static-export.mjs` | **PASS** | • `5 / 5` files present (`index.html`, `robots.txt`, `sitemap.xml`, `_headers`, `_redirects`).<br>• **`0` `localhost:3000` / `localhost:4000` / `127.0.0.1:4000` leaks** across `28` HTML & `58` JS files.<br>• **`8 / 8` private routes** (`/account`, `/admin`, `/dashboard`, `/credits`, `/login`, `/register`, `/verify-email`, `/reset-password`) contain `<meta name="robots" content="noindex, nofollow">`.<br>• Canonical `https://muxaro.app` verified in `index.html`, `robots.txt`, and `sitemap.xml` (private routes excluded). |
| 5 | **Standard Production Build** | `cd apps/web && npx next build` | **PASS** | Exit code `0` — **32 / 32 pages** built for `next start -p 3000` (Shared First Load JS: `87.4 kB`). |
| 6 | **Live API Health & Readiness** | `GET /api/v1/health` & `GET /api/v1/ready` (direct `:4000` + proxied `:3000`) | **PASS** | • `/api/v1/health`: HTTP `200` (`status: HEALTHY`, `database: sqlite-wal`, `storageMode: local`, `r2Configured: false`).<br>• `/api/v1/ready`: HTTP `200` (`status: READY`, `ffmpegAvailable: true`, `r2Configured: false`, `googleAuthConfigured: false`, `rewardedAdsConfigured: false`, zero secrets leaked). |
| 7 | **Live Web Route Smoke Check** | `fetch('http://localhost:3000' + route)` | **PASS** | **19 / 19 live routes** returned HTTP `200` (including `/robots.txt`, `/sitemap.xml`, all auth, account, admin, dashboard, credits, tools, docs, and legal routes). |
| 8 | **Cloudflare R2 Pure-Node SigV4** | `npx tsx qa/harness/verify-r2-sigv4.ts` | **PASS** | Honest `mode=local` when unconfigured; `4 / 4` path-traversal keys rejected; `>2 GB` upload rejected; valid `AWS4-HMAC-SHA256` presigned GET URLs generated for both `attachment` and `inline`. |
| 9 | **API Integration Regression** | `npx tsx tests/integration/api-integration.test.ts` | **PASS** | **14 / 14 PASS** (`0` failures, `14.11s`) covering health, Swagger docs, SSRF loopback & metadata `403`, YouTube inspect, job creation/idempotency/cancel, merge, credits (`10/10`), metrics, invalid token `403`, and non-existent artifact `404`. |

---

## 3. Infrastructure & Config Validation Summary

- `infra/cloudrun/api-service.yaml`, `infra/cloudrun/worker-service.yaml`, `.github/workflows/ci-deploy.yml`: **3 / 3 YAML syntax valid**, zero literal secrets (Google Secret Manager `secretKeyRef` only), Cloud Run `minScale: "0"` & `maxScale: "2"` cost caps verified.
- `infra/scripts/emergency-shutdown.sh`: **`bash -n` exit 0** (valid POSIX/Bash syntax).
- `infra/Dockerfile.api` & `infra/Dockerfile.worker`: multi-stage non-root (`UID 10001:10001`), `tini`, `ffmpeg`/`ffprobe`/`yt-dlp`, bounded `0700` scratch directories, healthchecks verified.

---

## 4. Post-Deployment Live Cloud Smoke Test Checklist (Run After Cloud Publish)

Once `muxaro.app` is registered and Cloudflare Pages + Cloud Run are deployed, run:

```bash
curl -sf https://api.muxaro.app/api/v1/health
curl -sf https://api.muxaro.app/api/v1/ready
curl -sfI https://www.muxaro.app | grep -i "301"
curl -sfI https://muxaro.app/account | grep -i "noindex"
curl -sf https://muxaro.app/robots.txt
curl -sf https://muxaro.app/sitemap.xml
```

*Signed by AGENT 10 (Independent QA, Performance & Release Engineer)*
