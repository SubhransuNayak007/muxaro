# MUXARO Upload, Storage & Media Execution Security

**Primary Implementations:**
- `apps/api/src/routes/media.ts` (Single-stream & resumable multipart uploads)
- `apps/api/src/services/storage.service.ts` (Object key sanitization, MIME/size checks, AWS SigV4)
- `security/src/ffmpeg-sanitizer.ts` & `apps/media-worker/src/process/sanitizer.ts` (FFmpeg hardening)
- `apps/api/src/routes/download.ts` (Jailed binary streaming & HTTP Range validation)

---

## 1. Upload Ingestion Guardrails (`apps/api/src/routes/media.ts`)

MUXARO supports both single-stream uploads (`POST /api/v1/media/upload`) and resumable 5 MB chunked multipart uploads (`POST /api/v1/media/upload/init`, `PUT /api/v1/media/upload/:uploadId/part/:partNumber`, `POST /api/v1/media/upload/:uploadId/complete`, `DELETE /api/v1/media/upload/:uploadId`).

### 1.1 Streaming Size Enforcement (Zero RAM Buffering)
- **Hard Maximum File Size:** `MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024` (**2 GiB**).
- **Content-Type Parsers:** Fastify registers pass-through stream parsers strictly for `application/octet-stream`, `^video/`, and `^audio/` with `bodyLimit: MAX_UPLOAD_BYTES` (while standard JSON API routes remain capped at `MAX_PAYLOAD_BYTES = 10 MiB`).
- **Incremental Byte Guard (`streamBodyToFile`):** A Node.js `Transform` stream counts bytes in real time as chunks hit disk. Exceeding 2 GiB aborts the pipeline immediately with HTTP `413 ERR_FILE_TOO_LARGE` without buffering the file in RAM.
- **Multipart Assembly (`assemblePartsStream`):** Caps chunk counts at `MAX_MULTIPART_PARTS = 1000`, concatenates parts sequentially via streaming backpressure (`readStream.pause()` / `writeStream.once('drain')`), computes SHA-256 on the fly, and enforces a 60-minute TTL (`MULTIPART_TTL_MS`) with automatic disk cleanup on expiry or abort (`DELETE /api/v1/media/upload/:uploadId`).

### 1.2 Content-Type & Extension Controls
- `StorageService.validateUploadMetadata()` accepts only `video/*`, `audio/*`, `application/octet-stream`, and `application/zip`, rejecting zero-byte or oversized payloads.
- `inferExtensionFromContentType()` maps approved media MIME types to canonical extensions (`.mp4`, `.mov`, `.mkv`, `.webm`, `.avi`, `.mp3`, `.m4a`, `.aac`, `.flac`, `.wav`, `.opus`, `.ogg`).
- All uploaded media is subsequently probed by `ffprobe` before job execution; corrupt, non-media, or malformed container payloads fail validation before transcoding.

---

## 2. Filename Sanitization, Directory Jails & Object Key Security

### 2.1 Filename Sanitization (`security/src/ffmpeg-sanitizer.ts`)
`sanitizeFilename(filename, fallback)`:
1. Normalizes Windows backslashes (`\`) to POSIX forward slashes (`/`) and extracts only the basename (`path.posix.basename`).
2. Replaces any character outside `[a-zA-Z0-9_.-]` with `_`.
3. Strips leading dots (`^\.+`) to prevent hidden dotfiles or relative `.` / `..` references.
4. Enforces a maximum length of `200` characters (preserving extension).

### 2.2 Sandbox Directory Jailing (`validateSafePath`)
Before reading, writing, probing, transcoding, or downloading any local file:
1. Rejects null bytes (`\0`), `SHELL_METACHARS_REGEX`, and `..` traversal sequences.
2. Canonicalizes paths via `path.resolve()` and verifies `path.relative(baseDir, resolved)` does not escape allowed roots (`.muxaro-uploads/`, `.muxaro-artifacts/`, or `/tmp/muxaro-scratch/`).
3. When `mustExist: true`, calls `fs.realpathSync()` to defeat symlink-escape attacks pointing outside the sandbox root.

### 2.3 Cloud Storage Key Isolation (`storage.service.ts`)
When Cloudflare R2 is configured, `generateObjectKey(prefix, ownerId, filename)` generates strictly non-guessable keys:
```text
<prefix>/<YYYYMMDD>/<sha256(ownerId)[0..12]>/<24-hex-random-nonce>_<sanitizedFilename>
```
- Allowed prefixes are restricted to `uploads/`, `processed/`, `playlists/`, `temporary/`.
- Raw emails and user IDs never appear in storage keys.
- `assertSafeObjectKey()` rejects traversal (`..`), null bytes, backslashes, leading slashes, and unapproved prefixes.

---

## 3. FFmpeg & FFprobe Process Hardening

Executing native media binaries on untrusted files is one of the highest-risk surfaces in any media platform. MUXARO enforces defense-in-depth across `security/src/ffmpeg-sanitizer.ts` and `apps/media-worker/`:

1. **Zero Shell Execution:** All `ffmpeg` and `ffprobe` invocations use `child_process.spawn` or `execFile` with explicit argument arrays and **`{ shell: false }`**.
2. **Protocol Whitelisting:** Both `buildSafeProbeArgs()` and `buildSafeTranscodeArgs()` pass:
   ```text
   -protocol_whitelist file,crypto,data
   ```
   This prevents malicious HLS/M3U8/playlist/container inputs from tricking FFmpeg into making outbound network requests (FFmpeg-level SSRF) or reading arbitrary OS devices.
3. **Non-Interactive & Bounded Execution:**
   - `-nostdin` prevents process hangs waiting on stdin.
   - Explicit allowlists for video codecs (`copy`, `libx264`, `libx265`, `libvpx-vp9`, `libsvtav1`), audio codecs (`copy`, `aac`, `libmp3lame`, `libopus`, `flac`), encoder presets, bitrates (`64k`–`320k`), sample rates, channels (`1` or `2`), and resolutions (`360p`–`8k`).
   - Hard process timeout (`300s` default in `executeSafeFfmpeg`, `540s`–`600s` in worker/queue) with `SIGKILL` termination and bounded stdout/stderr buffers (`10 MiB`).
4. **Output Verification Gate:** Processed outputs are re-probed with `ffprobe` to verify non-zero file size and valid streams before transitioning a job to `READY`.
5. **Container Isolation (`infra/Dockerfile.worker`):** Runs as unprivileged user `mediaworker` (`UID 10001:10001`, `/usr/sbin/nologin`) with `/usr/bin/tini` reaping zombie child processes and `chmod 0700 /tmp/muxaro-scratch`.

---

## 4. Artifact Retention & Download Security

- **Ephemeral Lifecycle:** Local processed artifacts expire and are purged after `60` minutes (`DEFAULT_RETENTION_MINUTES`), and Cloudflare R2 buckets enforce 24-hour lifecycle auto-purge rules on `uploads/`, `processed/`, `playlists/`, `temporary/`, plus 1-day abort of incomplete multipart uploads.
- **Safe Download Headers (`routes/download.ts`):**
  - `Content-Disposition: attachment; filename="<sanitized>"` by default (`inline` only when `?inline=1` is explicitly requested for preview).
  - `X-Content-Type-Options: nosniff` prevents MIME-sniffing XSS.
  - Strict RFC 9110 `Range` / `If-Range` parsing prevents malformed range header crashes and returns standards-compliant `206` or `416` responses.
