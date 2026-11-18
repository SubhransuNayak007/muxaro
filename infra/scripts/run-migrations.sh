#!/bin/sh
# ==============================================================================
# Project MUXARO - Automated PostgreSQL Migration Runner
# Applies base init-db.sql and all ordered SQL files in infra/migrations/*.sql
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS_DIR="$(cd "${SCRIPT_DIR}/../migrations" && pwd)"

PG_HOST="${POSTGRES_HOST:-postgres}"
PG_PORT="${POSTGRES_PORT:-5432}"
PG_USER="${POSTGRES_USER:-muxaro_user}"
PG_DB="${POSTGRES_DB:-muxaro_db}"
PG_PASSWORD="${POSTGRES_PASSWORD:-muxaro_secure_password}"

echo "[Migration Runner] Connecting to PostgreSQL at ${PG_HOST}:${PG_PORT}/${PG_DB}..."

export PGPASSWORD="$PG_PASSWORD"

until pg_isready -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB"; do
  echo "[Migration Runner] Waiting for database to be ready..."
  sleep 2
done

echo "[Migration Runner] Ensuring schema_migrations tracking table exists..."
psql -v ON_ERROR_STOP=1 -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -c "
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"

echo "[Migration Runner] Applying base schema (init-db.sql)..."
psql -v ON_ERROR_STOP=1 -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -f "${SCRIPT_DIR}/init-db.sql"

if [ -d "$MIGRATIONS_DIR" ]; then
  for migration in "${MIGRATIONS_DIR}"/*.sql; do
    [ -e "$migration" ] || continue
    base_name="$(basename "$migration")"
    already_applied="$(psql -tA -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -c "SELECT 1 FROM schema_migrations WHERE filename = '${base_name}' LIMIT 1;")"
    if [ "$already_applied" = "1" ]; then
      echo "[Migration Runner] Skipping already applied migration: ${base_name}"
      continue
    fi
    echo "[Migration Runner] Applying migration: ${base_name}..."
    psql -v ON_ERROR_STOP=1 -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -f "$migration"
    psql -v ON_ERROR_STOP=1 -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -c "INSERT INTO schema_migrations (filename) VALUES ('${base_name}') ON CONFLICT DO NOTHING;"
  done
fi

echo "[Migration Runner] All migrations completed successfully."
exit 0
