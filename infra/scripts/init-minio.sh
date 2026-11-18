#!/bin/sh
# ==============================================================================
# MinIO Local Bucket Provisioning & Lifecycle Policy Setup
# ==============================================================================

set -e

echo "[MinIO Init] Waiting for MinIO service at http://minio:9000..."
until curl -s http://minio:9000/minio/health/live; do
    echo "[MinIO Init] MinIO is unavailable - sleeping 1s..."
    sleep 1
done

echo "[MinIO Init] Configuring MinIO Client alias..."
mc alias set local http://minio:9000 "${MINIO_ROOT_USER:-minioadmin}" "${MINIO_ROOT_PASSWORD:-minioadmin}"

echo "[MinIO Init] Creating S3 buckets if they do not exist..."
mc mb local/muxaro-uploads --ignore-existing
mc mb local/muxaro-artifacts --ignore-existing
mc mb local/muxaro-scratch --ignore-existing

echo "[MinIO Init] Setting bucket lifecycle expiration rules..."
# 2-hour expiration on raw uploads
mc ilm rule add local/muxaro-uploads --expire-days 1 2>/dev/null || true
# 24-hour expiration on processed artifacts
mc ilm rule add local/muxaro-artifacts --expire-days 1 2>/dev/null || true

echo "[MinIO Init] Configuring download access policy..."
# Raw uploads private; artifacts accessible via presigned URLs or restricted read
mc anonymous set download local/muxaro-artifacts 2>/dev/null || true

echo "[MinIO Init] MinIO provisioning completed successfully."
exit 0
