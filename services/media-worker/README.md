# MUXARO Dedicated Media Worker

The dedicated media worker microservice for **MUXARO**. Designed for zero-transcode, zero-cost, high-throughput stream copying using native static FFmpeg and yt-dlp pipelines.

## Features

- **Direct Stream Copy**: Uses `-c:v copy -c:a copy -f mp4 -movflags frag_keyframe+empty_moov` to stream media directly to HTTP responses without re-encoding.
- **Zero Disk Writes**: Streams are piped on-the-fly from FFmpeg's `stdout` directly to the client connection.
- **Immediate Disconnect Cleanup**: Kills child processes instantly (`req.raw.on('close')`) if a client disconnects.
- **Non-Root & Hardened**: Runs as unprivileged user `muxaro` (UID 10001) with Tini as PID 1 zombie reaper.
- **Ultra Low Overhead**: <60 MB idle RAM, <150 MB peak RAM, <15% CPU. Suitable for Oracle Cloud Always Free (2 OCPU / 12 GB RAM) and Render Free tiers (512 MB RAM).
- **No Mandatory Queue**: Stripped of Redis/BullMQ/S3 requirements for the standard no-proxy workflow.

## Directory Structure

```
services/media-worker/
├── .env.example          # Environment variables template
├── docker-compose.yml    # Docker Compose manifest (standalone or --profile queue)
├── Dockerfile            # Debian-slim + static FFmpeg multi-stage Dockerfile
├── Dockerfile.alpine     # Ultra-lightweight Alpine Linux variant
├── package.json          # Node.js service dependencies
├── DEPLOYMENT.md         # Oracle Cloud & Render deployment guides + curl tests
└── src/
    └── index.js          # Fastify streaming service implementation
```

## Quick Start (Docker Compose)

```bash
# 1. Copy environment template
cp .env.example .env

# 2. Build and launch container
docker compose up -d --build

# 3. Check health status
curl -i http://localhost:5001/health
```

## Quick Start (Local Node.js)

Requirements: Node.js 20+, `ffmpeg` and `yt-dlp` installed in PATH.

```bash
npm install
npm run dev
```

## Endpoints

- `GET /health` — Service healthcheck (`{"status":"ok"}`)
- `POST /probe` — Direct media probe with strict 8s timeout
- `GET /stream?url=<encoded_url>&format=mp4&quality=1080p` — Direct stream copy download

For complete deployment guides (Oracle Cloud Always Free, Render Free tier) and full curl testing recipes, refer to [DEPLOYMENT.md](file:///D:/yt%20doenlord/services/media-worker/DEPLOYMENT.md).
