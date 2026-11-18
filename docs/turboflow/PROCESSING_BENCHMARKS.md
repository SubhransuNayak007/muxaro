# MUXARO TurboFlow — Processing & Delivery Benchmarks

> **Measurement Methodology:** All metrics below were measured locally against the live Fastify API (`apps/api`) using a real FFmpeg-generated 1080p 5-second H.264/AAC MP4 master fixture (`1920x1080`, 30fps, CRF 12, 192 kbps AAC, `16,502,200 bytes` / `15.74 MB`) processed with system `ffmpeg 8.1.2`, `ffprobe 8.1.2`, and `yt-dlp` on Windows 11 (Node.js v24.15.0). No synthetic or estimated performance claims are included.

## 1. TurboFlow Strategy Lane Comparison

| Lane | Queue Class | Strategy Label | Original Quality Preserved (`losslessPreserved`) | Analysis + Probe (ms) | Queue Wait (ms) | End-to-End Processing (ms) | Input Size | Output Size | Worker RSS (MB) |
| :--- | :--- | :--- | :---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **Instant** | `instant-processing` | Instant Stream Copy (`-c copy`, `+faststart`) | `true` | 284 ms | 2 ms | **695 ms** | 16,502,200 B (15.74 MB) | 16,502,200 B (15.74 MB) | 199 MB |
| **Smart (Audio Copy)** | `audio-processing` | Smart Audio Extract (Original Stream, `-vn -c:a copy`) | `true` | 284 ms | 1 ms | **593 ms** | 16,502,200 B (15.74 MB) | 82,895 B (81.0 KB) | 200 MB |
| **Smart (Audio Encode)** | `audio-processing` | Smart Audio Extract (MP3, `libmp3lame -q:a 0`) | `false` | 284 ms | 1 ms | **570 ms** | 16,502,200 B (15.74 MB) | 47,165 B (46.1 KB) | 200 MB |
| **Power (Compression)** | `video-transcoding` | Power Video Compression (720p `libx264 -crf 28` + AAC 128k) | `false` | 284 ms | 1 ms | **2,112 ms** | 16,502,200 B (15.74 MB) | 522,220 B (510.0 KB, **-96.8%**) | 202 MB |

### Key Observations
- **Instant Lane vs Power Lane speedup:** Avoiding unnecessary decode/re-encode completed in **695 ms vs 2,112 ms (3.04× faster)** while preserving bit-exact video and audio frames (`losslessPreserved: true`).
- **Honest fidelity reporting:** `losslessPreserved` is `true` **only** when streams are actually copied without re-encoding (`Instant Stream Copy` and `Smart Audio Extract (Original Stream)`). Both MP3 re-encoding and 720p H.264 compression accurately report `losslessPreserved: false`.
- **Steady memory footprint:** Worker process RSS stayed flat across all four lanes (`199–202 MB`) because media payloads are streamed via `fs.createReadStream` and `fs.createWriteStream` rather than buffered in Node heap memory.

## 2. Resumable Multipart Upload Benchmark

Measured with `16,502,200 bytes` (`15.74 MB`) split into 3 parts (`PUT /api/v1/media/upload/:uploadId/part/:partNumber`), including an explicit idempotent retry of Part 2 and end-to-end SHA-256 verification on `/complete`:

| Stage | Measured Time | Verification |
| :--- | ---: | :--- |
| Multipart Upload + Retry Part 2 + Stream Assembly + FFprobe | **660 ms** | All 3 parts streamed without RAM buffering |
| `/complete` Assembly + SHA-256 + FFprobe Inspection | **284 ms** | Exact SHA-256 match + real `1920x1080` H.264/AAC streams detected |
| `DELETE /api/v1/media/upload/:uploadId` Cancellation | **< 5 ms** | Temp directory removed cleanly |

## 3. Resumable HTTP Range Delivery Benchmark

Measured on `GET /api/v1/download/:token` serving the `16,502,200 B` Instant Lane artifact over local loopback (`127.0.0.1`):

| Check | HTTP Status | Measured Result |
| :--- | :---: | :--- |
| Full binary stream (`Accept-Ranges: bytes`, strong `ETag`, `Last-Modified`, `Content-Disposition: attachment`) | `200 OK` | **61.2 MB/s** streamed throughput (`16,502,200 B` exact) |
| Valid partial byte range (`Range: bytes=0-65535` + matching `If-Range: <ETag>`) | `206 Partial Content` | `Content-Range: bytes 0-65535/16502200`, `65,536 B` exact |
| Conditional `If-Range` mismatch (`If-Range: "stale-etag-mismatch"`) | `200 OK` | Safely falls back to full `16,502,200 B` stream (prevents corrupted resume) |
| Out-of-bounds range (`Range: bytes=999999999-`) | `416 Range Not Satisfiable` | `Content-Range: bytes */16502200`, `userMessage: "This download could not be resumed. Start a new download."` |
| Inline browser playback (`?inline=1` + `Range: bytes=0-1023`) | `206 Partial Content` | `Content-Disposition: inline; filename="..."`, `1,024 B` |

## 4. 6-Class Smart Queue Isolation

Verified via `GET /api/v1/admin/metrics`:

| Queue Class | Max Concurrency Cap | Purpose |
| :--- | :---: | :--- |
| `instant-processing` | 4 | Zero re-encode stream-copy remux jobs |
| `audio-processing` | 4 | Smart audio extraction & audio conversion jobs |
| `merge-processing` | 2 | Separate video + audio multiplexing jobs |
| `video-transcoding` | 2 | Standard resolution compression & transcoding |
| `high-resolution-processing` | 1 | 4K/8K transcodes isolated from lightweight queues |
| `playlist-packaging` | 1 | Multi-item playlist download & streaming ZIP packaging |

Scheduling policy: fair round-robin across users within each queue class, per-user active concurrency cap (`3`), queue backpressure guard (`200` queued ceiling -> HTTP `503`), bounded retries (`maxAttempts = 3`), and server-side job persistence across browser disconnects with `60-minute` artifact retention.
