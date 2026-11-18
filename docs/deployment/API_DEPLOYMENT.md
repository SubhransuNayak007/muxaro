# MUXARO API Service Deployment Guide (Google Cloud Run)

**Service:** `muxaro-api` (`apps/api`)  
**Container Spec:** `infra/Dockerfile.api` (Node 24 multi-stage non-root build)  
**Cloud Run Manifest:** `infra/cloudrun/api-service.yaml`  
**Target Endpoint:** `https://api.muxaro.app` (mapped via Cloudflare DNS + Cloud Run Domain Mapping / LB)  
**Status:** Deployment artifacts ready & validated locally; live GCP provisioning pending `gcloud` login & `GCP_PROJECT_ID`.

---

## 1. Container Architecture (`infra/Dockerfile.api`)

- **Base Image:** `node:24-bookworm-slim` (required for native Node 24 `node:sqlite` WAL and native `crypto.argon2` Argon2id).
- **Multi-Stage Build:** Stage 1 (`deps`) installs dependencies for `apps/api`; Stage 2 (`runner`) copies `node_modules`, `apps/api`, `packages/entitlements`, `packages/source-adapters`, and `security`.
- **Non-Root Security:** Runs strictly as UID/GID `10001:10001` (`muxaro`, `/usr/sbin/nologin`) with PID 1 signal reaping via `/usr/bin/tini`.
- **Ephemeral Scratch:** Creates mode `0700` writable directories under `/tmp/muxaro-*` for Cloud Run Gen2 memory-backed scratch.
- **Health Probe:** Docker `HEALTHCHECK` and Cloud Run `startupProbe`/`livenessProbe` target `GET /api/v1/health` on port `8080`.

---

## 2. Cloud Run Resource & Cost Guardrails (`infra/cloudrun/api-service.yaml`)

| Parameter | Configured Value | Rationale |
|---|---|---|
| `autoscaling.knative.dev/minScale` | `"0"` | Scale-to-zero when idle (zero idle compute charges) |
| `autoscaling.knative.dev/maxScale` | `"2"` | Hard concurrency ceiling to prevent runaway bills |
| `resources.limits.cpu` | `"1"` (`cpu-throttling: "true"`) | Request-scoped CPU billing |
| `resources.limits.memory` | `"1Gi"` | Sufficient for Fastify 5, SSE streams, and multipart streaming |
| `containerConcurrency` | `40` | Handles concurrent REST + SSE clients per instance |
| `timeoutSeconds` | `300` | Supports long SSE progress streams and streaming uploads |
| `run.googleapis.com/ingress` | `all` | Public API ingress (protected by CORS, CSRF, rate limiting, and MFA) |
| Secrets Injection | Google Secret Manager (`secretKeyRef`) | Zero plaintext secrets in YAML or container image |

---

## 3. One-Time GCP Prerequisites

```bash
# 1. Authenticate and select project
gcloud auth login
gcloud config set project "$GCP_PROJECT_ID"

# 2. Enable required APIs
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

# 3. Create Artifact Registry repository
gcloud artifacts repositories create muxaro \
  --repository-format=docker \
  --location=us-central1 \
  --description="MUXARO API & Worker container images"

# 4. Create dedicated least-privilege service account
gcloud iam service-accounts create muxaro-api-sa \
  --display-name="MUXARO Cloud Run API Runtime"

# Grant Secret Manager access ONLY (never Owner/Editor)
gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
  --member="serviceAccount:muxaro-api-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

---

## 4. Build, Push & Deploy Commands

```bash
export GCP_PROJECT_ID="your-gcp-project-id"
export GCP_REGION="us-central1"
export IMAGE_TAG="$(git rev-parse --short HEAD)"

# Build & push from monorepo root
docker build -f infra/Dockerfile.api \
  -t "${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/muxaro/muxaro-api:${IMAGE_TAG}" .

docker push "${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/muxaro/muxaro-api:${IMAGE_TAG}"

# Render & deploy Cloud Run service manifest
sed -e "s|REGION|${GCP_REGION}|g" \
    -e "s|PROJECT_ID|${GCP_PROJECT_ID}|g" \
    -e "s|IMAGE_TAG|${IMAGE_TAG}|g" \
    infra/cloudrun/api-service.yaml > /tmp/api-service.yaml

gcloud run services replace /tmp/api-service.yaml --region="${GCP_REGION}"

# Allow public unauthenticated HTTPS access to the API gateway (app enforces Auth/CSRF/MFA)
gcloud run services add-iam-policy-binding muxaro-api \
  --region="${GCP_REGION}" \
  --member="allUsers" \
  --role="roles/run.invoker"
```

---

## 5. Post-Deploy Verification

```bash
curl -fsS https://api.muxaro.app/api/v1/health
curl -fsS https://api.muxaro.app/api/v1/ready
curl -fsS https://api.muxaro.app/api/v1/admin/metrics
```

Verify that:
- `GET /api/v1/health` returns `200` with `status: "HEALTHY"`.
- `GET /api/v1/ready` confirms `storageMode: "r2"` (once R2 secrets are attached) and `ffmpegAvailable: true`.
- `GET /api/v1/admin/users` returns `401 ERR_UNAUTHORIZED` without a session.
