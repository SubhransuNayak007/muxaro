# MUXARO Production Deployment & Readiness Audit
**Product:** MUXARO — *Your Media. One Powerful Workspace.*  
**Author:** AGENT 01 — Principal Architect & System Designer  
**Date:** 18 November 2026  
**Audit Method:** Direct repository inspection (`apps/api`, `apps/web`, `packages`, `infra`, `.env.example`) and local CLI/environment verification.

---

## 1. Executive Summary & Honest Readiness State

MUXARO's application codebase is verified locally (`30/30` Next.js 14.2.24 static/SSG routes, `0` TypeScript errors, `0 FAIL / 0 WARN` Hallmark `sloplint`, `14/14` API integration tests, full Auth/MFA/IDOR/GAM SSV/Priority QA sign-off). However, **no external cloud deployment or domain registration has been executed yet** — external cloud authentication, secrets provisioning, and paid `.app` domain registration require explicit owner credentials and approval.

---

## 2. Stack & Cloud Platform Compatibility Audit

| Layer | Actual Codebase Stack | Target Production Platform | Compatibility Verdict | Notes |
| :--- | :--- | :--- | :---: | :--- |
| **Web Frontend (`apps/web`)** | Next.js `14.2.24` App Router, React 18, Tailwind CSS, `30/30` prerendered static/SSG routes (`generateStaticParams` on `/docs/[slug]`) | **Cloudflare Pages Free (Option A — Static Export `out/`)** | **CONFIRMED COMPATIBLE** | Zero SSR-only API routes in `apps/web`; client pages call `NEXT_PUBLIC_API_URL` (`https://api.muxaro.app/api/v1`) directly with `credentials: 'include'`. Avoids Cloudflare Workers' 10 ms Free CPU limit completely. |
| **API Gateway (`apps/api`)** | Fastify 5 + Node.js 24 LTS, Argon2id/Scrypt auth, RFC 6238 TOTP MFA, 13 route plugins, streaming HTTP Range delivery | **Google Cloud Run (API Service)** | **COMPATIBLE** | Stateless container (`infra/Dockerfile.api`), bounded `minScale: 0`, `maxScale: 2`, `/api/v1/health` & `/api/v1/ready` probes. |
| **Media Worker (`apps/api` / `apps/media-worker`)** | Node.js 24 + `yt-dlp` + `ffmpeg` / `ffprobe`, bounded `/tmp` scratch, 6-class TurboFlow queues | **Google Cloud Run (Internal Worker Service)** | **COMPATIBLE** | Isolated non-root container (`infra/Dockerfile.worker`), ingress `internal`, 600s request timeout, `maxScale: 2`, `2 vCPU / 2 GiB`. |
| **Relational Database** | Node 24 `node:sqlite` WAL (`.muxaro-data/muxaro.db`, 22 tables) + PostgreSQL DDL (`infra/migrations/002_account_rewards_analytics.sql`) | **Supabase Free (PostgreSQL 16) or Cloud SQL** | **READY FOR MIGRATION** | Local dev/test runs SQLite WAL; production PostgreSQL schema & migration runner (`infra/scripts/run-migrations.sh`) ready. Note: Supabase Free pauses after 7 days of inactivity. |
| **Object Storage** | Local disk (`.muxaro-artifacts`, `.muxaro-uploads`, 60m TTL) + pure-Node SigV4 `StorageService` | **Cloudflare R2 (S3-Compatible)** | **READY** | Zero egress fees; 10 GB free storage tier; presigned GET URLs with 24h lifecycle auto-purge. |

---

## 3. Exact Local CLI & Cloud Authentication Inventory

Audited on the active workstation (strictly honest — zero fabricated cloud connections):

| Tool / Credential | Detected Status | Action Required Before Live Deploy |
| :--- | :--- | :--- |
| **GitHub CLI (`gh`)** | **Authenticated** as `SubhransuNayak007` | Ready for GitHub Actions secrets & protected `production` environment setup. |
| **Cloudflare (`wrangler`)** | Not installed / not authenticated | Install `wrangler` or configure `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in GitHub Actions. |
| **Google Cloud (`gcloud`)** | Not installed / not authenticated | Authenticate `gcloud` + create GCP project + enable Cloud Run, Artifact Registry, and Secret Manager. |
| **Supabase CLI (`supabase`)** | Not installed / not authenticated | Create Supabase project (or Cloud SQL PostgreSQL) and export `DATABASE_URL`. |
| **Docker / Terraform** | Not installed / not authenticated locally | Builds run cleanly inside GitHub Actions (`ubuntu-latest`) or after local Docker installation. |
| **Cloud Env Vars (`CLOUDFLARE_API_TOKEN`, `GOOGLE_CLOUD_PROJECT`, `DATABASE_URL`, `R2_*`)** | **Unset** | Must be provisioned via Cloudflare Dashboard, GCP Secret Manager, and GitHub Environment Secrets — never committed to git. |
