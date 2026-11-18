# @muxaro/media-worker (Muxaro Media Processing Engine)

Production-grade FFmpeg and FFprobe media worker service for Muxaro ("Your Media. One Powerful Workspace."). Built in Node.js and TypeScript with clean-room GPL isolation, out-of-process subprocess execution over standard OS pipes, bounded scratch disk management, and strict honesty in media encoding.

## Core Capabilities

1. **Metadata Probing via FFprobe (`src/prober/`)**:
   - Deep codec detection: H.264, HEVC (H.265), VP9, AV1, ProRes, AAC, Opus, MP3, FLAC, PCM.
   - True resolution classification up to genuine 8K (`8K`, `4K`, `1440p`, `1080p`, `720p`, `480p`, `360p`).
   - Bitrates, color spaces, HDR detection (BT.2020, SMPTE 2084 / PQ, HLG), channels, sample rates.
   - Stream integrity and duration validation.

2. **Video Processing & Remuxing (`src/transcoder/video.ts`)**:
   - **Automatic Stream-Copy**: When codecs and target container are compatible and no downscale is requested, performs zero-loss `-c:v copy` near-instant remuxing.
   - **Resolution Transcoding**: Strict downscale-only rule (never upscales lower resolution sources). Even-dimension rounding and high-efficiency CRF presets (`libx264`, `libx265`, `libvpx-vp9`, `libsvtav1`).
   - Web streaming optimization via `-movflags +faststart`.
   - Real-time progress reporting parsed from FFmpeg.

3. **Audio Extraction & Conversion (`src/transcoder/audio.ts`)**:
   - Native stream-copy (`-c:a copy`) when extracting in source codec (e.g. AAC -> M4A, Opus -> WebM).
   - High-fidelity conversion: MP3 (`libmp3lame`), AAC (`aac`), FLAC (`flac`), WAV (`pcm_s16le`), Opus (`libopus`).
   - **Strict Honesty Principle**: Injects `AudioQualityHonestyReport` explaining that upsampling a lossy source (e.g., 128kbps AAC to FLAC or 320kbps MP3) does not restore discarded frequencies.

4. **Audio/Video Merging (`src/merger/merger.ts`)**:
   - Sync validation: Probes duration of both streams and calculates drift.
   - Millisecond offset calibration (`audioOffsetMs` with `-itsoffset`).
   - Stream-copy remuxing when codecs are compatible; targeted transcoding when incompatible.

5. **Batch & Playlist Packaging (`src/packager/zipper.ts`)**:
   - Streaming ZIP generation using `archiver` with low memory overhead.
   - Generates `playlist_manifest.json` and human-readable `README.txt` inside the archive.
   - Sanitizes filenames and reports percentage progress.

6. **Bounded Scratch Disk Management (`src/scratch/disk-manager.ts`)**:
   - Isolated workspace per job (`createJobWorkspace` / `cleanupJobWorkspace`).
   - Bounded scratch capacity enforcement (default 50 GB) preventing disk exhaustion.
   - Automated TTL reaper for orphaned workspaces older than 60 minutes.

7. **Output Verification (`src/verification/verifier.ts`)**:
   - Validates existence, non-zero file size, readable stream headers, and duration deviation tolerance.

## Installation & Building

```bash
# Install dependencies
pnpm install

# Compile TypeScript
pnpm run build

# Run comprehensive test suite
pnpm run test

# Start standalone microservice
pnpm run start
```

## Programmatic Usage

```typescript
import { MediaWorkerService } from '@muxaro/media-worker';

const worker = new MediaWorkerService({
  scratchDirectory: '/tmp/muxaro-scratch',
  maxScratchSizeBytes: 50 * 1024 * 1024 * 1024 // 50 GB
});

// 1. Probe media
const metadata = await worker.probe('/path/to/source.mp4');
console.log('Resolution Tier:', metadata.trueResolutionTier); // '1080p', '4K', '8K'

// 2. Video transcode or stream-copy
const videoResult = await worker.processVideo({
  inputPath: '/path/to/source.mp4',
  outputPath: '/path/to/output_720p.mp4',
  targetContainer: 'mp4',
  targetResolution: '720p',
  onProgress: (p) => console.log(`Progress: ${p.percentage}%`)
});

// 3. Audio extraction with honesty report
const audioResult = await worker.extractAudio({
  inputPath: '/path/to/source.mp4',
  outputPath: '/path/to/output.mp3',
  targetFormat: 'mp3',
  bitrateKbps: 320
});
console.log(audioResult.audioHonestyReport);

// 4. A/V Merging
const mergedResult = await worker.mergeMedia({
  videoInputPath: '/path/to/video_only.mp4',
  audioInputPath: '/path/to/audio_only.m4a',
  outputPath: '/path/to/merged.mp4',
  preferStreamCopy: true
});
```

## REST API Endpoints

- `GET /health`: Binary version check, scratch disk usage, active workspaces, system CPU and RAM.
- `POST /api/probe`: `{ inputPath: string }` -> Media metadata and stream analysis.
- `POST /api/process-video`: `{ inputPath, outputPath, targetContainer, targetResolution, ... }`
- `POST /api/extract-audio`: `{ inputPath, outputPath, targetFormat, bitrateKbps, ... }`
- `POST /api/merge`: `{ videoInputPath, audioInputPath, outputPath, targetContainer, ... }`
- `POST /api/package`: `{ items: [{ filePath, entryName }], outputPath, ... }`
- `POST /api/verify`: `{ filePath, requireVideo, requireAudio }`
- `GET /api/scratch/stats`: Scratch disk capacity and usage metrics.
