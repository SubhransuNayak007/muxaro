# MUXARO Infrastructure & Production Cloud Systems Guide

This directory houses containerization manifests, multi-service local/staging orchestration, Kubernetes autoscaling (KEDA) policies, Cloudflare edge streaming workers, Cloudflare R2 bucket lifecycle configurations, Prometheus metrics scrapers, and k6 load-testing suites for Project MUXARO.

---

## 1. Directory Structure

```
infra/
├── .env.example                     # Environment variables template for containers
├── docker-compose.yml               # Complete multi-service orchestration (Part 8.1)
├── Dockerfile.api                   # Multi-stage Fastify 5 REST & SSE API Gateway container
├── Dockerfile.worker-analyse        # Multi-stage lightweight metadata extraction worker
├── Dockerfile.worker-media          # Multi-stage FFmpeg transcoder & packager (Node 22, Tini, muxaro UID 10001)
├── Dockerfile.web                   # Multi-stage Next.js frontend container
├── scripts/
│   ├── init-db.sql                  # PostgreSQL 16 relational schema (pgcrypto, users, jobs, ledgers)
│   ├── init-minio.sh                # MinIO S3 bucket provisioning & prefix lifecycle initialization
│   ├── run-migrations.sh            # Automated database migration runner script
│   └── healthcheck.sh               # Multi-service HTTP & endpoint health validator
├── k8s/
│   ├── keda-transcode.yaml          # KEDA ScaledObject for lane:transcode (Depth: 2, Min: 1, Max: 40)
│   └── keda-fast-io.yaml            # KEDA ScaledObject for lane:fast-io (Depth: 10, Min: 1, Max: 20)
├── r2/
│   └── lifecycle.json               # Cloudflare R2 prefix retention rules (60m, 24h, multipart abort)
├── cloudflare/
│   ├── download-worker.ts           # Edge worker verifying HMAC-SHA256 tokens & streaming R2 with Range support
│   ├── worker-env.d.ts              # Ambient TypeScript definitions for Cloudflare Workers & R2
│   ├── tsconfig.json                # Strict TypeScript configuration for edge workers
│   └── wrangler.toml                # Cloudflare Worker deployment manifest
├── k6/
│   └── load-test.js                 # k6 load testing suite for /v1/analyse, SSE stability, and downloads
├── prometheus/
│   └── prometheus.yml               # Prometheus scrape configurations for API, workers & datastores
└── terraform/                       # Terraform Infrastructure-as-Code (AWS + Cloudflare)
```

---

## 2. Local & Staging Orchestration (Docker Compose)

### Services Orchestrated:
1. **`muxaro-postgres`** (PostgreSQL 16): Database with `pgcrypto` extension for atomic credit reservation, user accounts, and ledger tracking.
2. **`muxaro-redis`** (Redis 7): In-memory store for sliding-window rate limiting, token buckets, and BullMQ queues (`lane:fast-io`, `lane:transcode`, `lane:batch`, `lane:analyse`).
3. **`muxaro-minio`** (MinIO S3): High-performance S3/R2 emulation store.
4. **`muxaro-minio-init`**: Automated provisioning creating buckets (`muxaro-uploads`, `muxaro-artifacts`, `muxaro-scratch`) and applying lifecycle rules.
5. **`muxaro-api`**: Fastify 5 REST & SSE API Gateway (port `4000`).
6. **`muxaro-worker-analyse`**: Lightweight metadata & stream analysis worker (port `5001`).
7. **`muxaro-worker-media`**: FFmpeg transcoding & packaging worker (port `5000`).
8. **`muxaro-prometheus`**: Metrics collector and telemetry scraper (port `9090`).

### Running the Stack:
```bash
# Copy environment variables
cp infra/.env.example infra/.env

# Launch all infrastructure services
docker compose -f infra/docker-compose.yml up -d --build

# Inspect logs
docker compose -f infra/docker-compose.yml logs -f
```

---

## 3. Kubernetes Autoscaling via KEDA (Part 8.2)

### `lane:transcode` (Heavy CPU Video Transcoding)
- **Target Queue Depth:** 2 pending jobs per pod
- **Min Replicas:** 1
- **Max Replicas:** 40
- **Scale-Up Policy:** 100% capacity boost within 15 seconds
- **Scale-Down Stabilization:** 300 seconds to protect active video encodings
- **Manifest:** `infra/k8s/keda-transcode.yaml`

### `lane:fast-io` (Lossless Remuxing & Audio Extraction)
- **Target Queue Depth:** 10 pending jobs per pod
- **Min Replicas:** 1
- **Max Replicas:** 20
- **Scale-Down Stabilization:** 120 seconds
- **Manifest:** `infra/k8s/keda-fast-io.yaml`

---

## 4. Cloudflare R2 Storage Lifecycle Configuration (Part 8.3)

`infra/r2/lifecycle.json` defines lifecycle policies:
- `outputs/60m/`: Guest media outputs expire after 60 minutes (3600 seconds)
- `uploads/60m/`: Guest raw upload chunks expire after 60 minutes
- `outputs/24h/`: Authenticated user processed downloads expire after 24 hours (86400 seconds)
- `AbortMultipartUpload`: Aborts incomplete multipart uploads abandoned for >24 hours

---

## 5. Cloudflare Download Worker (Part 6.3)

`infra/cloudflare/download-worker.ts` deploys to Cloudflare Workers to serve processed files directly from Cloudflare R2 with:
- **HMAC-SHA256 Token Verification:** Validates `?exp=...&sig=...&fn=...` in constant time.
- **HTTP Range Requests (RFC 7233):** Supports `Range: bytes=` with `206 Partial Content` responses for streaming players and resumable downloads.
- **Zero Egress Fees:** Direct native integration between Cloudflare Workers and R2.

Deploy with Wrangler:
```bash
cd infra/cloudflare
npx wrangler deploy
```

---

## 6. Performance Benchmarks with k6 (Part 8.4)

Run the automated performance test against local or staging endpoints:
```bash
k6 run --env API_BASE_URL=http://localhost:4000 --env DOWNLOAD_BASE_URL=http://localhost:8787 infra/k6/load-test.js
```

### Benchmark SLAs Validated:
- `/v1/analyse` P95 latency < 500ms (cached) and < 2500ms (uncached)
- Failure rate < 1.00%
- SSE stream stability with 99.9% event delivery
- Download TTFB P95 < 200ms
