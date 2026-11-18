# ADR-003: Media Pipeline Execution Strategy — Sandboxed FFmpeg, Stream-Copy Preference & Authentic Quality

**Status:** Accepted  
**Deciders:** Principal Architect (AGENT 01), Media Processing Engineer (AGENT 04), Security Engineer (AGENT 08)  
**Date:** 2026-11-18  

---

## 1. Context and Problem Statement
Media processing engines face three chronic failure modes:
1. **Security Vulnerabilities (RCE / Command Injection):** Spawning FFmpeg via shell strings (`child_process.exec("ffmpeg -i " + input)`) allows malicious filenames or URL parameters to execute arbitrary shell commands. Furthermore, hostile media files can exploit known libavcodec buffer overflows.
2. **Computational Inefficiency:** Blindly re-encoding video streams (e.g., re-encoding a 4K VP9 WebM stream to 4K H.264 MP4 when the user only asked for audio extraction or container remuxing) exhausts server CPU/GPU resources and slows down delivery by 20x–50x.
3. **Deceptive Quality & Upsampling (The Legacy Converter Anti-Pattern):** Legacy converters deceive users by advertising "320 kbps MP3" or "8K Ultra HD" conversions for sources that natively only provide 128 kbps Opus audio or 1080p video. Re-encoding lossy 128 kbps Opus to 320 kbps MP3 triples file size, wastes bandwidth, and degrades audio quality through generational re-compression.

---

## 2. Decision
We mandate the **MUXARO Authentic Media Pipeline**:

### 2.1 Argument Vectorization & Sandboxing (No Shell Strings)
- All FFmpeg and FFprobe executions must be invoked via `child_process.execFile` or `spawn` using strictly typed string arrays:
  ```typescript
  // REQUIRED:
  execFile('ffmpeg', ['-y', '-i', sanitizedInputPath, '-c', 'copy', outputPath]);
  // STRICTLY FORBIDDEN:
  exec(`ffmpeg -y -i ${inputUrl} ${outputFile}`);
  ```
- FFmpeg processes run under an unprivileged user (`uid: 1001 / muxaroworker`) in containerized environments with disabled root privileges and strict resource limits (cgroups: CPU quota and memory bounds).

### 2.2 Stream-Copy Priority (`-c copy`)
- When container formats and target codecs match (e.g., MP4 container with H.264 video and AAC audio), the engine applies `-c:v copy -c:a copy -movflags +faststart`.
- Stream-copy bypasses video decoding and encoding matrices completely, operating at raw disk and network I/O speeds (typically under 2 seconds for full-length 1080p media).
- Transcoding is strictly reserved for:
  - Format conversions where target codecs differ from source codecs.
  - User-requested resolution downscaling (e.g., 4K source downscaled to 720p).
  - Explicit audio format conversions (e.g., Opus ➔ MP3 for legacy MP3 players).

### 2.3 The Authentic Fidelity Standard (Zero Deceptive Upsampling)
- The system shall never claim or advertise audio/video upsampling as a quality improvement.
- If a source stream possesses 128 kbps Opus audio, extracting it to MP3 shall report:
  `Source: 128 kbps Opus | Target: MP3 128 kbps (Transcoded)`.
- Re-encoding to a higher nominal bitrate (e.g. 320 kbps) is rejected or tagged with an explicit advisory: `"Upsampling lossy source will not improve audio fidelity."`

### 2.4 Ephemeral Scratch Disk Lifecycle
- Scratch directories are partitioned per job: `/tmp/muxaro-scratch/{jobId}/`.
- Intermediate chunks, temp remux files, and unverified outputs are isolated to this directory.
- A mandatory `finally` block or process signal trap executes `rm -rf /tmp/muxaro-scratch/{jobId}/` upon job completion, failure, cancellation, or crash.
- A host cron daemon purges any scratch directory older than 30 minutes to prevent orphan disk leakage.

---

## 3. Consequences

### Positive:
- Total immunity to shell metacharacter injection.
- Massive compute cost reduction by prioritizing stream-copy remuxing over unnecessary transcoding.
- Pristine audio fidelity with zero generational loss when native audio is selected.
- Clean disk hygiene with zero disk exhaustion risk.

### Negative:
- Transcoding when unavoidable requires CPU-bound compute nodes.
- Users accustomed to legacy spam sites claiming fake "320k" must be educated via clear UI badges and docs.
