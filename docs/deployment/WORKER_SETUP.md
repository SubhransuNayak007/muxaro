# MUXARO Media Worker Setup & Isolation Guide

**Application:** `apps/media-worker` (`@muxaro/media-worker`)  
**Container Spec:** `infra/Dockerfile.worker` (Node 24 + FFmpeg/FFprobe + `yt-dlp`, non-root UID `10001`)  
**Cloud Run Manifest:** `infra/cloudrun/worker-service.yaml`  
**Network Posture:** **Internal Ingress Only** (`run.googleapis.com/ingress: internal`)

---

## 1. Service Capabilities (`apps/media-worker/src/server.ts`)

`apps/media-worker` is a stateless Fastify 5 + Zod microservice wrapping FFmpeg, FFprobe, and ZIP archiving with strict process isolation and disk scratch management.

> **Current Wiring Status:** `apps/media-worker` is implemented and unit/E2E-tested as an independent service, and `infra/cloudrun/worker-service.yaml` defines its internal Cloud Run deployment. In the current codebase, `apps/api/src/services/queue.service.ts` spawns local `ffmpeg`/`ffprobe`/`yt-dlp` directly rather than dispatching HTTP RPCs to `MEDIA_WORKER_URL`; wiring remote API-to-worker HTTP dispatch is tracked as a follow-up item in `docs/repository/124_ENGINEERING_WORK_ITEMS.md`.

| Endpoint | Method | Purpose |
| :--- | :---: | :--- |
| `/health` | `GET` | Reports worker status (`healthy` / `degraded` / `unhealthy`), FFmpeg/FFprobe availability, and scratch disk state |
| `/api/probe` | `POST` | Runs sanitized `ffprobe` inspection on a scratch media file |
| `/api/process-video` | `POST` | Stream-copy remux or FFmpeg transcode (`mp4`, `mkv`, `webm`; `360p`–`8K`; `h264`, `hevc`, `vp9`, `av1`, `copy`) |
| `/api/extract-audio` | `POST` | Audio stream extraction / transcode (`mp3`, `aac`, `m4a`, `flac`, `wav`, `opus`, `ogg`, `copy`) |
| `/api/merge` | `POST` | Audio/video stream multiplexing |
| `/api/package` | `POST` | Multi-item ZIP archive packaging via `archiver` |

---

## 2. Local Worker Startup & Tests

```bash
cd apps/media-worker
npm install

# Run unit and end-to-end media worker tests (requires ffmpeg & ffprobe on PATH)
npm test

# Start development server (defaults to PORT=3002; set PORT=5000 for docker-compose parity)
npm run dev
```

Verify worker health locally:
```bash
curl -s http://127.0.0.1:3002/health
```

---

## 3. Hardened Production Container (`infra/Dockerfile.worker`)

1. **Base Runtime:** `node:24-bookworm-slim` multi-stage build.
2. **Media Binaries:** Installs `ffmpeg`, `ffprobe`, `python3`, `tini`, `curl`, `ca-certificates`, and `yt-dlp`.
3. **Unprivileged Identity:** Dedicated system user `mediaworker` (`UID 10001`, `GID 10001`, `/usr/sbin/nologin`).
4. **Clean Process Reaping:** `ENTRYPOINT ["/usr/bin/tini", "--"]` guarantees orphaned FFmpeg child processes are reaped cleanly on timeout or container shutdown.
5. **Bounded Ephemeral Scratch:** `/tmp/muxaro-scratch` owned by `mediaworker:mediaworker` with `chmod 0700`.
6. **Zero Shell Execution:** All media binaries execute strictly with `shell: false` and `-protocol_whitelist file,crypto,data` (`apps/media-worker/src/process/sanitizer.ts` & `security/src/ffmpeg-sanitizer.ts`).

---

## 4. Production Cloud Run Deployment (`infra/cloudrun/worker-service.yaml`)

### Configured Guardrails
- `run.googleapis.com/ingress: internal` — Blocks all direct public internet traffic at Google ingress.
- `autoscaling.knative.dev/minScale: "0"` / `maxScale: "2"` — Scales to zero when idle; hard cap prevents runaway CPU billing.
- `resources.limits`: `2 vCPU` (`cpu-throttling: "false"`), `2 GiB RAM`.
- `containerConcurrency: 2`, `timeoutSeconds: 600` (`JOB_TIMEOUT_SECONDS=540`).
- **Least-Privilege Secrets:** Mounts only the 4 Cloudflare R2 secrets (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`). Never mounts auth, session, MFA, or database credentials.

### Deployment & IAM Verification Commands

```bash
export GCP_PROJECT_ID="your-gcp-project-id"
export GCP_REGION="us-central1"
export IMAGE_TAG="$(git rev-parse --short HEAD)"

docker build -f infra/Dockerfile.worker \
  -t "${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/muxaro/muxaro-worker:${IMAGE_TAG}" .
docker push "${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/muxaro/muxaro-worker:${IMAGE_TAG}"

sed -e "s|REGION|${GCP_REGION}|g" \
    -e "s|PROJECT_ID|${GCP_PROJECT_ID}|g" \
    -e "s|IMAGE_TAG|${IMAGE_TAG}|g" \
    infra/cloudrun/worker-service.yaml > /tmp/worker-service.yaml

gcloud run services replace /tmp/worker-service.yaml --region="$GCP_REGION" --project="$GCP_PROJECT_ID"

# Grant invoke permission STRICTLY to muxaro-api-sa (NEVER allUsers)
gcloud run services add-iam-policy-binding muxaro-worker \
  --region="$GCP_REGION" \
  --project="$GCP_PROJECT_ID" \
  --member="serviceAccount:muxaro-api-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/run.invoker"

# Verify IAM policy contains zero public principals
gcloud run services get-iam-policy muxaro-worker --region="$GCP_REGION" --project="$GCP_PROJECT_ID"
```
