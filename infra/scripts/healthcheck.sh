#!/bin/sh
# ==============================================================================
# Multi-Service Infrastructure Healthcheck Utility
# ==============================================================================

set -e

FAILED=0

check_endpoint() {
    NAME=$1
    URL=$2
    echo -n "Checking $NAME ($URL)... "
    if curl -sf -o /dev/null -m 5 "$URL"; then
        echo "OK"
    else
        echo "FAILED"
        FAILED=1
    fi
}

echo "=========================================="
echo " MUXARO Infrastructure Health Verification  "
echo "=========================================="

# Check MinIO
check_endpoint "MinIO Object Storage" "http://${MINIO_HOST:-127.0.0.1}:9000/minio/health/live"

# Check API Health
check_endpoint "Fastify API Service" "http://${API_HOST:-127.0.0.1}:4000/health"

# Check Media Worker Health
check_endpoint "FFmpeg Media Worker" "http://${MEDIA_HOST:-127.0.0.1}:5000/health"

# Check Next.js Frontend
check_endpoint "Next.js Web Service" "http://${WEB_HOST:-127.0.0.1}:3000/"

if [ "$FAILED" -eq 0 ]; then
    echo "=========================================="
    echo " ALL SERVICES HEALTHY [PASS]              "
    echo "=========================================="
    exit 0
else
    echo "=========================================="
    echo " ONE OR MORE HEALTHCHECKS FAILED [FAIL]   "
    echo "=========================================="
    exit 1
fi
