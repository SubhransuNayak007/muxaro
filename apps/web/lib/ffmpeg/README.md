# MUXARO Shared FFmpeg.wasm Web Worker & Engine

High-performance, 100% client-side media processing engine powered by `@ffmpeg/ffmpeg` running in a dedicated background Web Worker with OPFS (Origin Private File System) and in-memory virtual filesystem.

---

## 🚀 Key Highlights

1. **Zero CPU Melting (Stream Copy by Default)**:
   - Always defaults to `-c copy` / `-c:v copy -c:a copy`.
   - Remuxing takes **2–5 seconds** on mobile and desktop because no video re-encoding occurs.
2. **100% Client-Side ($0 Server Cost)**:
   - Zero server round-trips or API calls.
   - Fully offline capable: core WebAssembly (`ffmpeg-core.js`, `ffmpeg-core.wasm`) is hosted locally in `/public/ffmpeg/` with automatic unpkg CDN fallback.
3. **No Main Thread Blocking**:
   - Runs inside a dedicated Web Worker (`/workers/ffmpeg-worker.js`).
   - UI stays at 60 FPS during file I/O and muxing.
4. **Intelligent Fallback**:
   - If stream copy to MP4 fails due to audio codec mismatch (e.g., Opus in MP4), automatically retries with video stream copy (`-c:v copy`) and audio transcode (`-c:a aac`), completing in under 2 seconds while preserving pristine video quality.

---

## 📦 Directory Structure

```
apps/web/
├── public/
│   ├── ffmpeg/
│   │   ├── ffmpeg-core.js        # Emscripten core loader
│   │   ├── ffmpeg-core.wasm      # 32MB WebAssembly binary
│   │   ├── ffmpeg.js             # Standalone UMD FFmpeg library
│   │   ├── 814.ffmpeg.js         # FFmpeg worker chunk
│   │   └── index.js              # FFmpeg util UMD
│   └── workers/
│       └── ffmpeg-worker.js      # Shared Web Worker script
└── lib/
    └── ffmpeg/
        ├── types.ts              # Full TypeScript contracts
        ├── ffmpeg-engine.ts      # Core processing engine
        ├── ffmpeg-client.ts      # Singleton worker RPC client
        ├── ffmpeg-worker.ts      # TypeScript worker source
        ├── use-ffmpeg-worker.ts  # React hook for tool pages
        ├── run-ffmpeg-task.ts    # Standalone async helper
        ├── opfs.ts               # OPFS file utilities
        └── index.ts              # Unified module exports
```

---

## 🛠️ API Usage Examples

### 1. In React Tool Pages (`useFFmpegWorker`)

```tsx
'use client';

import React, { useState } from 'react';
import { useFFmpegWorker } from '@/lib/ffmpeg';

export default function ConvertToolPage() {
  const { convert, isProcessing, progress, error, result } = useFFmpegWorker();
  const [file, setFile] = useState<File | null>(null);

  const handleConvert = async () => {
    if (!file) return;

    // Fast stream-copy remuxing (2-5s)
    const output = await convert({
      file,
      targetContainer: 'mp4', // 'mp4' | 'mkv' | 'webm' | 'mov'
      streamCopy: true,        // Defaults to true (-c copy)
    });

    console.log('Finished in', output.elapsedMs, 'ms');
    console.log('Download URL:', output.url);
  };

  return (
    <div>
      <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      <button onClick={handleConvert} disabled={!file || isProcessing}>
        {isProcessing ? `Remuxing... ${progress.percent}%` : 'Convert to MP4'}
      </button>

      {result && (
        <a href={result.url} download={result.fileName}>
          Download {result.fileName} ({(result.sizeBytes / 1024 / 1024).toFixed(1)} MB)
        </a>
      )}

      {error && <p className="text-red-500">{error}</p>}
    </div>
  );
}
```

### 2. Extract Audio (`extractAudio`)

```tsx
const { extractAudio } = useFFmpegWorker();

// Lossless stream-copy audio extraction (1-2s):
const result = await extractAudio({
  file: videoFile,
  targetFormat: 'copy', // Or 'mp3', 'aac', 'wav', 'flac', 'opus'
  streamCopy: true,
});
```

### 3. Merge Video & Audio Tracks (`merge`)

```tsx
const { merge } = useFFmpegWorker();

// Lossless video + audio muxing via -c:v copy -c:a copy:
const result = await merge({
  videoFile,
  audioFile,
  targetContainer: 'mp4',
  streamCopy: true,
});
```

### 4. Outside React (`runFFmpegTask`)

```ts
import { runFFmpegTask } from '@/lib/ffmpeg';

const result = await runFFmpegTask({
  action: 'convert',
  file: myBlob,
  targetContainer: 'mp4',
  onProgress: (p) => console.log(`Progress: ${p.percent}%`),
});
```
