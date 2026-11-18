# MUXARO — Fastify Media Processing API Service

> **"Your Media. One Powerful Workspace."**
> A powerful platform for authorised media downloading, processing, and conversion.

Production REST and Server-Sent Events (SSE) API for media inspection, transcoding, audio extraction, audio/video multiplexing, and batch processing.

## Architecture & Principles

- **Zero-Fake Upsampling Floor**: Adheres strictly to genuine fidelity standards. Prohibits dishonest 320k upsampling claims from compressed streams.
- **SSRF Defense Gate**: Fully shielded external request dispatcher utilizing `@muxaro/security` with loopback, link-local, cloud metadata, and DNS rebinding mitigation.
- **Rolling Quota Governance**: Seamlessly backed by `@muxaro/entitlements` providing dynamic 24-hour rolling windows (10 individual video jobs, 1 playlist job per 24 hours), atomic reservation, commit, and instant rollback upon cancellation or failure.
- **Idempotency Guard**: Idempotent job admission via `Idempotency-Key` headers preventing double charges or duplicate worker allocations on network retries.
- **Secure Download Tokens**: Ephemeral HMAC-SHA256 signed download tokens ensuring time-limited, tamper-evident file delivery with enforced `nosniff` security headers.

## Endpoints Summary

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/health` | System readiness, Postgres, Redis, and Worker pool status |
| `POST` | `/api/v1/media/inspect` | SSRF-safe URL inspection with codec, resolution, and rights breakdown |
| `GET` | `/api/v1/media/:id` | Retrieve cached media manifest by ID |
| `POST` | `/api/v1/jobs` | Submit asynchronous job with atomic quota reservation |
| `GET` | `/api/v1/jobs/:id` | Poll job execution status, progress percentage, and artifacts |
| `GET` | `/api/v1/jobs/:id/events` | Real-time Server-Sent Events (SSE) progress stream |
| `POST` | `/api/v1/jobs/:id/cancel` | Cancel job and immediately refund reserved quota |
| `POST` | `/api/v1/jobs/:id/retry` | Re-enqueue failed job within retry limits |
| `GET` | `/api/v1/jobs/:id/download` | Redirect to verified output artifact |
| `POST` | `/api/v1/tools/merge` | Audio/video multiplexing with millisecond offset sync |
| `POST` | `/api/v1/playlists/inspect`| Discover and inspect items in a playlist (max 50) |
| `POST` | `/api/v1/playlists/jobs` | Batch playlist processing with ZIP packaging |
| `GET` | `/api/v1/playlists/jobs/:id`| Check batch playlist status and item breakdown |
| `GET` | `/api/v1/account/credits` | Transparent rolling 24-hour quota allowances and live reset timers |
| `GET` | `/api/v1/account/history` | Paginated submission history for user or guest session |
| `GET` | `/api/v1/admin/metrics` | System telemetry, queue depth, worker nodes, and error rates |
| `GET` | `/api/v1/download/:token` | Secure file delivery using HMAC-signed token |
| `GET` | `/docs` | Interactive Swagger / OpenAPI 3.1 documentation UI |

## Scripts

```bash
# Run unit & integration test suite
npm test

# Start API server in development mode
npm run dev

# Start API server
npm start
```
