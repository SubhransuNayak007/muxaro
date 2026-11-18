# MUXARO Production Service Inventory
**Product:** MUXARO — *Your Media. One Powerful Workspace.*  
**Author:** AGENT 01 — Principal Architect & System Designer  
**Date:** 18 November 2026  

---

## Authoritative Service Topology

| Service ID | Workspace Path | Runtime / Build Artifact | Hosting Platform | Public Endpoint / Ingress | Scaling Bounds | Health / Readiness Probe |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`muxaro-web`** | `apps/web/` | Next.js `14.2.24` static export (`CLOUDFLARE_PAGES=1` → `apps/web/out/`) | **Cloudflare Pages Free** | `https://muxaro.app` (`www.muxaro.app` → 301 canonical) | Global CDN Edge (unlimited static requests) | HTTP 200 on `/`, `/robots.txt`, `/sitemap.xml` |
| **`muxaro-api`** | `apps/api/` (`infra/Dockerfile.api`) | Node.js 24 LTS + Fastify 5 (`13` `/api/v1` route plugins) | **Google Cloud Run** | `https://api.muxaro.app` (Cloudflare Proxy → Cloud Run) | `minScale: 0`, `maxScale: 2`, `1 vCPU / 1 GiB`, concurrency `40` | `GET /api/v1/health`, `GET /api/v1/ready` |
| **`muxaro-worker`** | `apps/media-worker/` / `infra/Dockerfile.worker` | Node.js 24 + `ffmpeg` + `ffprobe` + `yt-dlp` (non-root) | **Google Cloud Run (Internal)** | **Internal VPC / Cloud Run Ingress Only** (zero public exposure) | `minScale: 0`, `maxScale: 2`, `2 vCPU / 2 GiB`, concurrency `2`, timeout `600s` | Internal worker probe + `/tmp` disk guard |
| **`muxaro-db`** | `infra/migrations/002_account_rewards_analytics.sql` | PostgreSQL 16 (22 tables) — local dev uses `node:sqlite` WAL | **Supabase Free / Cloud SQL** | Private TLS (`sslmode=require`) | Managed connection pooler | SQL `SELECT 1` via `/api/v1/ready` |
| **`muxaro-storage`** | `apps/api/src/services/storage.service.ts` | S3-compatible object store (`uploads/`, `processed/`, `playlists/`, `temporary/`) | **Cloudflare R2** | Private bucket; time-limited AWS SigV4 presigned GET URLs | Serverless object storage (24h lifecycle auto-purge) | `storageMode` & `r2Configured` in `/api/v1/ready` |
| **`muxaro-redis`** *(Optional Scale)* | `apps/api/src/services/ratelimit.service.ts` | Redis 7 (rate-limit & distributed queue backend) | **Upstash Free / Memorystore** | Private TLS (`rediss://`) | Serverless / single-node | Optional; falls back cleanly to DB/memory when `REDIS_URL` unset |
| **`muxaro-edge`** | `apps/web/public/_headers`, `_redirects` | Cloudflare DNS, WAF, TLS Full (Strict), DDoS Shield | **Cloudflare Free** | Authoritative DNS for `muxaro.app` | Global Anycast | Edge TLS & DNSSEC status |
