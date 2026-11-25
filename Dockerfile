# ==============================================================================
# MUXARO API Service — Production Node 24 Multi-Stage Non-Root Container
# Runtime: Node 24 + Fastify 5 + FFmpeg/FFprobe + yt-dlp nightly + Deno + bgutil
# ==============================================================================

FROM node:24-bookworm-slim AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json* .npmrc* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/entitlements/package.json ./packages/entitlements/
COPY packages/source-adapters/package.json ./packages/source-adapters/
COPY security/package.json ./security/
COPY apps/api/package.json ./apps/api/

RUN for dir in packages/shared packages/db packages/entitlements packages/source-adapters security apps/api; do \
      if [ -f "/app/${dir}/package.json" ]; then \
        echo ">>> Installing ${dir}"; \
        (cd "/app/${dir}" && pnpm install --no-frozen-lockfile --shamefully-hoist); \
      fi; \
    done

COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY packages/entitlements ./packages/entitlements
COPY packages/source-adapters ./packages/source-adapters
COPY security ./security
COPY apps/api ./apps/api

RUN for dir in packages/shared packages/db; do \
      if [ -f "/app/${dir}/tsconfig.json" ]; then \
        (cd "/app/${dir}" && pnpm run build 2>/dev/null || true); \
      fi; \
    done

FROM node:24-bookworm-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    curl \
    ca-certificates \
    ffmpeg \
    unzip \
    python3 \
    python3-pip \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod 0755 /usr/local/bin/yt-dlp \
    && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh \
    && chmod 0755 /usr/local/bin/deno \
    && python3 -m pip install --no-cache-dir --break-system-packages -U bgutil-ytdlp-pot-provider gallery-dl \
    && ffmpeg -version && ffprobe -version && yt-dlp --version && deno --version \
    && apt-get purge -y --auto-remove \
    && rm -rf /var/lib/apt/lists/* /root/.cache

RUN groupadd --system --gid 10001 muxaro && \
    useradd --system --uid 10001 --gid muxaro --no-create-home --shell /usr/sbin/nologin muxaro

COPY --from=deps --chown=muxaro:muxaro /app /app

RUN mkdir -p /tmp/muxaro-data /tmp/muxaro-artifacts /tmp/muxaro-uploads /tmp/muxaro-scratch && \
    chown -R muxaro:muxaro /tmp/muxaro-data /tmp/muxaro-artifacts /tmp/muxaro-uploads /tmp/muxaro-scratch && \
    chmod 700 /tmp/muxaro-data /tmp/muxaro-artifacts /tmp/muxaro-uploads /tmp/muxaro-scratch

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4000
ENV TRUST_PROXY=true
ENV RATE_LIMIT_ENABLED=true
ENV LOG_LEVEL=info
ENV MUXARO_DB_PATH=/tmp/muxaro-data/muxaro.db
ENV STORAGE_DIR=/tmp/muxaro-scratch
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV DENO_PATH=/usr/local/bin/deno
ENV YTDLP_JS_RUNTIMES=deno,node

WORKDIR /app/apps/api

USER 10001:10001

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-4000}/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start"]
