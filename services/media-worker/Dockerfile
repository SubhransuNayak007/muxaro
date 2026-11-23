# ==============================================================================
# MUXARO Dedicated Media Worker Fleet Dockerfile
# Production-ready, ultra-lightweight Linux container with native FFmpeg & yt-dlp
# Optimized for Oracle Cloud Always Free (ARM64/AMD64) & Render Free tiers
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Multi-arch static FFmpeg & FFprobe provider
# ------------------------------------------------------------------------------
FROM mwader/static-ffmpeg:6.1.1 AS ffmpeg-source

# ------------------------------------------------------------------------------
# Stage 2: Hardened Debian-slim production runtime
# ------------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runner

LABEL maintainer="MUXARO Core Engineering <engineering@muxaro.com>"
LABEL org.opencontainers.image.title="muxaro-media-worker"
LABEL org.opencontainers.image.description="Lightweight stream-copy media worker for MUXARO"

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5001
ENV MAX_FILE_SIZE_MB=500

# Install runtime utilities: python3 (required by yt-dlp), ca-certificates, curl (healthchecks), tini (PID 1 reaper)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    ca-certificates \
    curl \
    tini \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/*

# Copy static FFmpeg & FFprobe binaries (true static multi-arch binaries with full codec support)
COPY --from=ffmpeg-source /ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg-source /ffprobe /usr/local/bin/ffprobe

# Install latest yt-dlp standalone binary with anti-bot support
RUN curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Create dedicated unprivileged non-root system user (UID/GID 10001)
RUN groupadd --system --gid 10001 muxaro && \
    useradd --system --uid 10001 --gid muxaro --no-create-home --shell /usr/sbin/nologin muxaro

WORKDIR /app

# Install application dependencies layer
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund

# Copy application source code
COPY . .

# Set up ephemeral temp / scratch directories with strict unprivileged ownership
RUN mkdir -p /app/temp /app/scratch \
    && chown -R 10001:10001 /app

# Switch to non-privileged user (non-root enforcement)
USER 10001:10001

# Expose service ports (Render/Fly/Oracle default 5001 or 8080)
EXPOSE 5001
EXPOSE 8080

# Healthcheck targeting dynamic PORT with 5001 fallback
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f "http://127.0.0.1:${PORT:-5001}/health" || exit 1

# Tini acts as PID 1 to gracefully reap zombie FFmpeg/yt-dlp child processes on disconnect
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/index.js"]
