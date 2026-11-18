# ==============================================================================
# MUXARO API Service — Production Node 24 Multi-Stage Non-Root Container
# Runtime: Node 24 (native node:sqlite WAL + native Argon2id) + Fastify 5
# Target:  Google Cloud Run (stateless, scale-to-zero, bounded concurrency)
# ==============================================================================

# Stage 1: Install dependencies & verify workspace modules
FROM node:24-bookworm-slim AS deps
WORKDIR /app

COPY apps/api/package.json apps/api/package-lock.json* ./apps/api/
COPY packages/entitlements/package.json packages/entitlements/package-lock.json* ./packages/entitlements/
COPY packages/source-adapters/package.json ./packages/source-adapters/
COPY security/package.json security/package-lock.json* ./security/

WORKDIR /app/apps/api
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

# ------------------------------------------------------------------------------
# Stage 2: Minimal Hardened Non-Root Production Runtime
FROM node:24-bookworm-slim AS runner
WORKDIR /app

# Install tini (clean PID 1 signal handling), curl (healthcheck), ca-certificates,
# ffmpeg/ffprobe & yt-dlp (lightweight stream inspection & fast remux fallback when worker URL unset)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    curl \
    ca-certificates \
    ffmpeg \
    python3 \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod 0755 /usr/local/bin/yt-dlp \
    && apt-get purge -y --auto-remove \
    && rm -rf /var/lib/apt/lists/* /root/.cache

# Dedicated unprivileged user (UID 10001)
RUN groupadd --system --gid 10001 muxaro && \
    useradd --system --uid 10001 --gid muxaro --no-create-home --shell /usr/sbin/nologin muxaro

# Copy workspace dependencies & API source
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY apps/api ./apps/api
COPY packages/entitlements ./packages/entitlements
COPY packages/source-adapters ./packages/source-adapters
COPY security ./security

# Ephemeral runtime scratch directories (Cloud Run writable /tmp memory-backed filesystem)
RUN mkdir -p /tmp/muxaro-data /tmp/muxaro-artifacts /tmp/muxaro-uploads /tmp/muxaro-scratch && \
    chown -R muxaro:muxaro /app /tmp/muxaro-data /tmp/muxaro-artifacts /tmp/muxaro-uploads /tmp/muxaro-scratch && \
    chmod 700 /tmp/muxaro-data /tmp/muxaro-artifacts /tmp/muxaro-uploads /tmp/muxaro-scratch

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV TRUST_PROXY=true
ENV RATE_LIMIT_ENABLED=true
ENV MUXARO_DB_PATH=/tmp/muxaro-data/muxaro.db
ENV STORAGE_DIR=/tmp/muxaro-scratch

WORKDIR /app/apps/api

USER 10001:10001

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-8080}/api/v1/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start"]
