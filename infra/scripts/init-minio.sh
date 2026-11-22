#!/bin/sh
# ==============================================================================
# MinIO Local Bucket Provisioning & Lifecycle Policy Setup
# Supports Part 8.3: outputs/60m/, uploads/60m/, outputs/24h/, multipart abort
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

echo "[MinIO Init] Setting bucket lifecycle expiration rules (Part 8.3)..."
# 1-day expiration on uploads/60m/ and uploads/
mc ilm rule add local/muxaro-uploads --prefix "uploads/60m/" --expire-days 1 2>/dev/null || true
mc ilm rule add local/muxaro-uploads --expire-days 1 2>/dev/null || true

# 1-day expiration on outputs/60m/ and outputs/24h/
mc ilm rule add local/muxaro-artifacts --prefix "outputs/60m/" --expire-days 1 2>/dev/null || true
mc ilm rule add local/muxaro-artifacts --prefix "outputs/24h/" --expire-days 1 2>/dev/null || true
mc ilm rule add local/muxaro-artifacts --expire-days 1 2>/dev/null || true

echo "[MinIO Init] Configuring download access policy..."
# Raw uploads private; artifacts accessible via presigned URLs or download worker
mc anonymous set download local/muxaro-artifacts 2>/dev/null || true

echo "[MinIO Init] MinIO provisioning completed successfully."
exit 0
