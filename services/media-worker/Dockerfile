# ==============================================================================
# MUXARO Dedicated Media Worker Fleet Dockerfile
# Production-ready Linux container with native FFmpeg & yt-dlp pipelines
# ==============================================================================

FROM node:20-bookworm-slim AS base

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production

# Install native multimedia binaries & streaming dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install latest yt-dlp binary with anti-bot support
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Install dependencies layer
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts

# Copy application source
COPY . .

# Run as non-privileged service user
RUN groupadd -r muxaro && useradd -r -g muxaro -d /app muxaro \
    && mkdir -p /app/scratch /app/temp \
    && chown -R muxaro:muxaro /app

USER muxaro

EXPOSE 5001

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://127.0.0.1:5001/health || exit 1

CMD ["node", "src/index.js"]
