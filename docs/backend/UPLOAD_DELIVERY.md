# Upload & Download Delivery Architecture

**Project:** MUXARO  
**Implementations:** `apps/api/src/routes/media.ts`, `apps/api/src/routes/download.ts`, `apps/api/src/services/token.service.ts`, `apps/api/src/services/storage.service.ts`

---

## 1. Local Media Upload Architecture (Up to 2 GB)

MUXARO implements two streaming upload protocols under `/api/v1/media/upload*` designed to accept media files up to **2 GB (`2,147,483,648` bytes)** with constant memory usage.

### 1.1 Supported Content Types
Custom Fastify pass-through stream parsers (`apps/api/src/routes/media.ts`) disable JSON/buffer parsing and expose the raw `Readable` stream for:
- `application/octet-stream`
- `video/*` (`.mp4`, `.mov`, `.mkv`, `.webm`, `.avi`)
- `audio/*` (`.mp3`, `.m4a`, `.aac`, `.flac`, `.wav`, `.opus`, `.ogg`)

### 1.2 Single-Stream Upload (`POST /api/v1/media/upload`)
1. Reads filename from `x-file-name` header (URI-decoded and sanitized via `sanitizeFilename`).
2. Allocates isolated directory `.muxaro-uploads/<uuid>/<safeFilename>` and enforces `validateSafePath(destPath, [UPLOADS_ROOT])`.
3. Pipes incoming request stream through a byte-counting `Transform` guard into `fs.createWriteStream(destPath)` via `stream/promises.pipeline`.
   - Aborts immediately with `413 ERR_FILE_TOO_LARGE` if cumulative bytes exceed 2 GB.
   - Rejects 0-byte uploads with `400 ERR_EMPTY_UPLOAD`.
4. Runs `ffprobe` via `adapterService.registerLocalUpload()` to extract genuine stream metadata and schedules 60-minute TTL auto-deletion.

### 1.3 Resumable Multipart Upload (`POST /upload/init` → `PUT /part/:n` → `POST /complete`)
Designed for unstable connections and large 4K/8K files:
- **`POST /api/v1/media/upload/init`:** Accepts `{ filename, totalSize, totalParts (1..1000), sha256? }`. Returns `{ uploadId, chunkSizeHint: 5242880 (5 MB), expiresAt (+60 min) }`.
- **`PUT /api/v1/media/upload/:uploadId/part/:partNumber`:** Accepts up to **100 MB per part**; streams to `part_<n>.<ts>.tmp` and atomically `fs.rename()`s to `part_<n>` so retrying failed parts is 100% idempotent. Enforces 2 GB cumulative size across all parts.
- **`POST /api/v1/media/upload/:uploadId/complete`:** Verifies all parts `1..totalParts` exist, concatenates sequentially via `assemblePartsStream()` (with stream drain backpressure and streaming SHA-256), validates optional `sha256` (`400 ERR_CHECKSUM_MISMATCH` on mismatch), deletes temporary part files, and inspects the assembled file via `ffprobe`.
- **`DELETE /api/v1/media/upload/:uploadId`:** Cancels session and immediately deletes temporary parts.

---

## 2. Signed Resumable Download Delivery (`GET /api/v1/download/:token`)

### 2.1 Tamper-Proof Download Tokens (`apps/api/src/services/token.service.ts`)
- Payload: `{ jobId, artifactId, filename, userId, expiresAt }`.
- Encoding: `base64url(JSON.stringify(payload)) + "." + base64url(HMAC-SHA256(secret, payloadB64))`.
- Verification: Timing-safe HMAC verification (`crypto.timingSafeEqual`) + expiration check (default TTL: 3600s / 60 minutes). Invalid or expired tokens return `403 ERR_INVALID_DOWNLOAD_TOKEN`.

### 2.2 Multi-Layer Download Access Control
1. Cryptographic token signature & expiry check.
2. Artifact lookup via `queueService.resolveDownloadArtifact(jobId, artifactId)` (memory + SQLite `output_artifacts` fallback).
3. `artifact.ownerUserId === payload.userId` check.
4. Cross-account IDOR defense: if the caller carries an authenticated `muxaro_session` cookie or `Authorization` header belonging to a *different* account (and is not an MFA-verified admin), access is blocked (`403 ERR_FORBIDDEN`) and logged as `IDOR_ATTEMPT`.
5. Directory jail check: `validateSafePath(artifact.filePath, [ARTIFACTS_ROOT], { mustExist: true })`.

### 2.3 Full RFC 9110 HTTP Range & Resumable Streaming
| Request Condition | HTTP Status | Response Headers | Behavior |
| :--- | :---: | :--- | :--- |
| Standard request (no `Range`) | `200 OK` | `Content-Length`, `Accept-Ranges: bytes`, `ETag`, `Last-Modified`, `Content-Disposition` | Full file streamed via `fs.createReadStream` |
| Valid `Range: bytes=start-end` (or `bytes=start-` or `bytes=-suffix`) | `206 Partial Content` | `Content-Range: bytes start-end/total`, `Content-Length: chunkSize` | Sliced stream via `fs.createReadStream(path, { start, end })` |
| `If-Range` matches strong `ETag` or `Last-Modified` | `206 Partial Content` | Same as above | Resumes safely only if file validator unchanged |
| `If-Range` does **not** match (or weak `W/` ETag) | `200 OK` | Full file headers | RFC 9110 §13.1.5 fallback to full stream |
| Malformed or out-of-bounds `Range` | `416 Range Not Satisfiable` | `Content-Range: bytes */total`, `Accept-Ranges: bytes` | Returns `ERR_RANGE_NOT_SATISFIABLE` JSON error |
| Query `?inline=1` or `?inline=true` | `200` / `206` | `Content-Disposition: inline; filename="..."` | Supports in-browser video/audio preview |

---

## 3. Cloudflare R2 Object Storage Integration (`apps/api/src/services/storage.service.ts`)

`StorageService` implements a zero-dependency **AWS Signature Version 4 (`AWS4-HMAC-SHA256`)** S3-compatible client using `node:crypto` and native `fetch`:

- **Honest Mode Detection:**
  - `mode: 'r2'` ONLY when all four environment variables (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`) are non-empty.
  - Otherwise `mode: 'local'` (falling back to `.muxaro-artifacts` and `.muxaro-uploads`), with a startup warning if only partial `R2_*` variables are set.
- **Logical Prefixes (Allowlisted):** `uploads/`, `processed/`, `playlists/`, `temporary/`.
- **Non-Guessable Key Format:** `<prefix>/<YYYYMMDD>/<ownerHash12>/<nonce24>_<safeFilename>` with strict traversal rejection (`assertSafeObjectKey`).
- **Implemented S3 REST Operations:**
  - `signRequest()` — Canonical AWS SigV4 header signing.
  - `getPresignedDownloadUrl(key, { expiresInSeconds, filename, inline })` — Query-string SigV4 presigned GET URLs (`60s`–`86400s` TTL) with `response-content-disposition`.
  - `putObject()` — Content-type & size validation (`video/*`, `audio/*`, `application/octet-stream`, `application/zip`; <= 2 GB) + `x-amz-meta-sha256` checksum tagging.
  - `headObject()`, `deleteObject()`, `createMultipartUpload()`, `uploadPart()`, `completeMultipartUpload()`, `abortMultipartUpload()`.

### Retention Lifecycle
- **Local uploads:** 60 minutes (`UPLOAD_TTL_MS`).
- **Local completed artifacts & playlist ZIPs:** 60 minutes (`DEFAULT_RETENTION_MINUTES`, configurable in `system_settings` under `artifact_retention_minutes` between 5 and 1440 minutes).
- **Multipart temporary sessions:** 60 minutes (`MULTIPART_TTL_MS`), cleaned immediately upon completion or cancellation.
