# MUXARO Media Worker Deployment Guide (Internal Cloud Run)

**Service:** `muxaro-worker` (`apps/media-worker`)  
**Container Spec:** `infra/Dockerfile.worker` (Node 24 + FFmpeg/FFprobe + `yt-dlp`, non-root)  
**Cloud Run Manifest:** `infra/cloudrun/worker-service.yaml`  
**Network Exposure:** **INTERNAL ONLY** (`run.googleapis.com/ingress: internal` — NEVER publicly exposed!)  
**Status:** Deployment artifacts ready & validated locally; live GCP provisioning pending `gcloud` login & `GCP_PROJECT_ID`.

---

## 1. Isolation & Security Design (`infra/Dockerfile.worker`)

Heavy media transcoding (`ffmpeg`), stream probing (`ffprobe`), and media fetching (`yt-dlp`) execute inside a dedicated stateless worker container separated from the public API:

1. **Zero Public Internet Exposure**: `infra/cloudrun/worker-service.yaml` enforces `run.googleapis.com/ingress: internal`, and IAM `roles/run.invoker` is granted **exclusively** to `muxaro-api-sa@PROJECT_ID.iam.gserviceaccount.com` (never `allUsers`).
2. **Non-Root Execution**: Runs as UID/GID `10001:10001` (`mediaworker`, `/usr/sbin/nologin`) with `/usr/bin/tini` as PID 1 so orphaned FFmpeg child processes are always reaped cleanly.
3. **Bounded Ephemeral Scratch**: All temporary files reside exclusively inside `/tmp/muxaro-scratch` (`chmod 0700`), cleaned immediately on job completion, cancellation, or container eviction.
4. **No Shell Execution**: FFmpeg/FFprobe/yt-dlp invocations strictly use `execFile`/`spawn` with argument arrays and `shell: false`.

---

## 2. Cloud Run Resource & Cost Guardrails (`infra/cloudrun/worker-service.yaml`)

| Parameter | Configured Value | Rationale |
|---|---|---|
| `run.googleapis.com/ingress` | `internal` | Blocks direct public internet access completely |
| `autoscaling.knative.dev/minScale` | `"0"` | Zero idle compute cost when no heavy transcodes are active |
| `autoscaling.knative.dev/maxScale` | `"2"` | Hard cap preventing runaway CPU/RAM billing |
| `resources.limits.cpu` | `"2"` (`cpu-throttling: "false"`) | Dedicated 2 vCPU during active transcoding |
| `resources.limits.memory` | `"2Gi"` | Headroom for 4K/8K remuxing & `/tmp` ephemeral scratch |
| `containerConcurrency` | `2` | Prevents CPU/RAM thrashing across concurrent FFmpeg jobs |
| `timeoutSeconds` | `600` | 10-minute upper ceiling (`JOB_TIMEOUT_SECONDS=540`) |

---

## 3. Service Account & Internal IAM Binding

```bash
export GCP_PROJECT_ID="your-gcp-project-id"
export GCP_REGION="us-central1"

# 1. Create worker runtime service account
gcloud iam service-accounts create muxaro-worker-sa \
  --display-name="MUXARO Internal Media Worker"

# 2. Grant Secret Manager read access for R2 credentials ONLY
gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
  --member="serviceAccount:muxaro-worker-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# 3. Build, push & deploy internal worker
export IMAGE_TAG="$(git rev-parse --short HEAD)"
docker build -f infra/Dockerfile.worker \
  -t "${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/muxaro/muxaro-worker:${IMAGE_TAG}" .

docker push "${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/muxaro/muxaro-worker:${IMAGE_TAG}"

sed -e "s|REGION|${GCP_REGION}|g" \
    -e "s|PROJECT_ID|${GCP_PROJECT_ID}|g" \
    -e "s|IMAGE_TAG|${IMAGE_TAG}|g" \
    infra/cloudrun/worker-service.yaml > /tmp/worker-service.yaml

gcloud run services replace /tmp/worker-service.yaml --region="${GCP_REGION}"

# 4. Allow ONLY muxaro-api-sa to invoke muxaro-worker (NEVER allUsers!)
gcloud run services add-iam-policy-binding muxaro-worker \
  --region="${GCP_REGION}" \
  --member="serviceAccount:muxaro-api-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

---

## 4. Verification Checklist

1. Confirm `gcloud run services describe muxaro-worker --region=us-central1 --format="value(metadata.annotations['run.googleapis.com/ingress'])"` returns `internal`.
2. Confirm `gcloud run services get-iam-policy muxaro-worker --region=us-central1` does **not** include `allUsers` or `allAuthenticatedUsers`.
3. Confirm an external `curl` to the worker `.run.app` URL returns HTTP `403` / `404` (blocked at Google ingress).
4. Confirm internal health check from authorized VPC/API caller returns `200` on `GET /health` with `ffmpeg` and `ffprobe` detected.
