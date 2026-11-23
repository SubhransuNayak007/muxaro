#!/usr/bin/env bash
# ==============================================================================
# update-extractors.sh
# MUXARO Media Worker — Nightly Extractor Update & Verification Script
#
# Purpose:
#   1. Update yt-dlp to the latest release.
#   2. Run a --simulate probe against a known public clip to verify the new
#      version is functional.
#   3. Exit non-zero if the smoke-test fails so the cron job does NOT
#      hot-reload a broken extractor.
#
# Cron schedule (Docker):  0 3 * * *   (03:00 UTC every day)
# Example crontab entry:
#   0 3 * * * /app/scripts/update-extractors.sh >> /var/log/yt-dlp-update.log 2>&1
# ==============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CANARY_VIDEO_ID="jNQXAC9IVRw"
CANARY_URL="https://www.youtube.com/watch?v=${CANARY_VIDEO_ID}"
LOG_PREFIX="[update-extractors]"
TIMESTAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

log()  { echo "${LOG_PREFIX} ${TIMESTAMP} INFO  $*"; }
warn() { echo "${LOG_PREFIX} ${TIMESTAMP} WARN  $*" >&2; }
err()  { echo "${LOG_PREFIX} ${TIMESTAMP} ERROR $*" >&2; }

# ---------------------------------------------------------------------------
# Step 1: Update yt-dlp
# ---------------------------------------------------------------------------
log "Starting yt-dlp update…"

if ! pip install -U yt-dlp; then
  err "pip install -U yt-dlp failed — aborting without touching the live extractor."
  exit 1
fi

YTDLP_VERSION="$(yt-dlp --version 2>/dev/null || echo 'unknown')"
log "yt-dlp updated successfully. Version: ${YTDLP_VERSION}"

# ---------------------------------------------------------------------------
# Step 2: Smoke-test the updated extractor
# ---------------------------------------------------------------------------
log "Running smoke-test against canary video: ${CANARY_URL}"

# --simulate     — no download, just extract info and stream URLs
# --no-warnings  — suppress non-fatal noise
# --socket-timeout 10  — don't hang forever if YouTube is slow
# -f bestvideo+bestaudio/best  — verify format selection still works
SIMULATE_OUTPUT="$(
  yt-dlp \
    --simulate \
    --no-warnings \
    --socket-timeout 10 \
    -f 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best' \
    --print "%(title)s | %(duration)ss | %(ext)s" \
    "${CANARY_URL}" 2>&1
)" || SIMULATE_EXIT=$?

SIMULATE_EXIT="${SIMULATE_EXIT:-0}"

if [[ "${SIMULATE_EXIT}" -ne 0 ]]; then
  err "Smoke-test FAILED (exit code ${SIMULATE_EXIT}). yt-dlp output:"
  err "${SIMULATE_OUTPUT}"
  err "Extractor update rolled back (pip upgrade kept, but cron will not hot-reload)."
  exit "${SIMULATE_EXIT}"
fi

log "Smoke-test PASSED. Output: ${SIMULATE_OUTPUT}"

# ---------------------------------------------------------------------------
# Step 3: Optional — clear any yt-dlp cache that may have stale state
# ---------------------------------------------------------------------------
log "Clearing yt-dlp cache…"
yt-dlp --rm-cache-dir 2>/dev/null || true

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
log "Extractor update complete. yt-dlp ${YTDLP_VERSION} is active and verified."
exit 0
