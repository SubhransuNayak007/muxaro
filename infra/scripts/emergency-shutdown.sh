#!/usr/bin/env bash
# ==============================================================================
# MUXARO Emergency Shutdown & Traffic-Halt Script
#
# Use during active billing runaway, abuse flood, or critical security incident:
#   1. Restricts Cloud Run `muxaro-api` ingress to `internal` (halts public API traffic)
#   2. Forces Cloud Run `muxaro-api` and `muxaro-worker` minScale=0 & maxScale=1
#   3. Removes public `allUsers` invoker binding from `muxaro-api` (optional --revoke-public)
#   4. Optionally enables Cloudflare "Under Attack" security level if CF env vars are set
#
# Usage:
#   GCP_PROJECT_ID=my-project GCP_REGION=us-central1 ./infra/scripts/emergency-shutdown.sh
#   GCP_PROJECT_ID=my-project ./infra/scripts/emergency-shutdown.sh --dry-run
#   GCP_PROJECT_ID=my-project ./infra/scripts/emergency-shutdown.sh --revoke-public
#   GCP_PROJECT_ID=my-project ./infra/scripts/emergency-shutdown.sh --restore
# ==============================================================================

set -euo pipefail

DRY_RUN=false
REVOKE_PUBLIC=false
RESTORE_MODE=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --revoke-public) REVOKE_PUBLIC=true ;;
    --restore) RESTORE_MODE=true ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      echo "[ERROR] Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

GCP_PROJECT_ID="${GCP_PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-}}"
GCP_REGION="${GCP_REGION:-us-central1}"
API_SERVICE="${CLOUD_RUN_API_SERVICE:-muxaro-api}"
WORKER_SERVICE="${CLOUD_RUN_WORKER_SERVICE:-muxaro-worker}"

run_cmd() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY-RUN] $*"
  else
    echo "[EXEC] $*"
    "$@"
  fi
}

if [[ -z "$GCP_PROJECT_ID" ]]; then
  echo "[ERROR] GCP_PROJECT_ID (or GOOGLE_CLOUD_PROJECT) must be set." >&2
  exit 1
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "[ERROR] gcloud CLI is not installed or not in PATH." >&2
  exit 1
fi

if [[ "$RESTORE_MODE" == "true" ]]; then
  echo "=== MUXARO EMERGENCY RESTORE (project=$GCP_PROJECT_ID region=$GCP_REGION) ==="
  run_cmd gcloud run services update "$API_SERVICE" \
    --project="$GCP_PROJECT_ID" \
    --region="$GCP_REGION" \
    --ingress=all \
    --min-instances=0 \
    --max-instances=2

  run_cmd gcloud run services update "$WORKER_SERVICE" \
    --project="$GCP_PROJECT_ID" \
    --region="$GCP_REGION" \
    --ingress=internal \
    --min-instances=0 \
    --max-instances=2

  if [[ -n "${CLOUDFLARE_ZONE_ID:-}" && -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    echo "[INFO] Restoring Cloudflare zone security level to 'medium'..."
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "[DRY-RUN] curl PATCH https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/settings/security_level -> medium"
    else
      curl -fsS -X PATCH \
        "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/settings/security_level" \
        -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
        -H "Content-Type: application/json" \
        --data '{"value":"medium"}' >/dev/null
    fi
  fi

  echo "[OK] Services restored to normal bounded scale (min=0, max=2)."
  exit 0
fi

echo "=== MUXARO EMERGENCY SHUTDOWN / TRAFFIC HALT (project=$GCP_PROJECT_ID region=$GCP_REGION) ==="

# 1. Halt public ingress on API and force minimum scaling to 0
run_cmd gcloud run services update "$API_SERVICE" \
  --project="$GCP_PROJECT_ID" \
  --region="$GCP_REGION" \
  --ingress=internal \
  --min-instances=0 \
  --max-instances=1

# 2. Keep worker strictly internal and throttle ceiling to 1 (scale-to-zero)
run_cmd gcloud run services update "$WORKER_SERVICE" \
  --project="$GCP_PROJECT_ID" \
  --region="$GCP_REGION" \
  --ingress=internal \
  --min-instances=0 \
  --max-instances=1

# 3. Optional IAM kill-switch: remove unauthenticated public invoker from API
if [[ "$REVOKE_PUBLIC" == "true" ]]; then
  run_cmd gcloud run services remove-iam-policy-binding "$API_SERVICE" \
    --project="$GCP_PROJECT_ID" \
    --region="$GCP_REGION" \
    --member="allUsers" \
    --role="roles/run.invoker"
fi

# 4. Optional Cloudflare Under-Attack Shield (when credentials are provided in environment)
if [[ -n "${CLOUDFLARE_ZONE_ID:-}" && -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "[INFO] Enabling Cloudflare 'under_attack' mode on zone ${CLOUDFLARE_ZONE_ID}..."
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY-RUN] curl PATCH https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/settings/security_level -> under_attack"
  else
    curl -fsS -X PATCH \
      "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/settings/security_level" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data '{"value":"under_attack"}' >/dev/null
  fi
else
  echo "[INFO] CLOUDFLARE_ZONE_ID / CLOUDFLARE_API_TOKEN not set; skipped Cloudflare edge toggle."
fi

echo "[OK] Emergency halt complete. Public API traffic is blocked and Cloud Run services will scale to 0."
echo "[NEXT] To restore after incident mitigation, run: $0 --restore"
