/* eslint-disable no-restricted-globals */
/**
 * MUXARO Shared FFmpeg Web Worker (ffmpeg-worker.js)
 * Standalone background worker running ffmpeg.wasm with OPFS / virtual memory FS.
 * 
 * Commands supported:
 * 1. 'convert'       - Fast container remuxing (MP4, MKV, WebM, MOV) via stream copy (-c copy) in 2–5s.
 * 2. 'extract-audio' - High-fidelity audio extraction (-vn -c:a copy or mp3/aac/wav).
 * 3. 'merge'         - Lossless video + audio muxing (-c:v copy -c:a copy) with stream sync.
 * 4. 'exec'          - Custom FFmpeg command execution.
 */

const MIME_MAP = {
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  flac: 'audio/flac',
  opus: 'audio/opus',
  ogg: 'audio/ogg',
};

function getMime(ext) {
  const clean = (ext || '').toLowerCase().replace(/^\./, '');
  return MIME_MAP[clean] || 'application/octet-stream';
}

function parseTimeToSec(timeStr) {
  if (!timeStr) return undefined;
  const parts = timeStr.trim().split(':');
  if (parts.length === 3) {
    const h = parseFloat(parts[0]);
    const m = parseFloat(parts[1]);
    const s = parseFloat(parts[2]);
    if (!isNaN(h) && !isNaN(m) && !isNaN(s)) {
      return h * 3600 + m * 60 + s;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// FFmpeg Lifecycle & Script Loading
// ---------------------------------------------------------------------------

if (typeof self.document === 'undefined') {
  self.document = { baseURI: self.location.href };
}

let ffmpeg = null;
let isLoaded = false;
let loadedFrom = null;

function loadScripts() {
  if (self.FFmpegWASM) return;
  const origin = self.location.origin;
  try {
    importScripts(origin + '/ffmpeg/ffmpeg.js');
  } catch (err1) {
    try {
      importScripts('/ffmpeg/ffmpeg.js');
    } catch (err2) {
      console.error('[FFmpegWorker] Failed to load local /ffmpeg/ffmpeg.js:', err1, err2);
      throw new Error('Failed to load local /ffmpeg/ffmpeg.js: ' + (err1 && err1.message));
    }
  }
}

async function initFFmpeg(config) {
  if (isLoaded && ffmpeg) {
    return { loadedFrom };
  }

  loadScripts();
  const { FFmpeg } = self.FFmpegWASM || {};
  if (!FFmpeg) {
    throw new Error('FFmpegWASM library failed to load in worker scope.');
  }

  ffmpeg = new FFmpeg();

  const origin = self.location.origin;
  const coreURL = config?.coreURL || `${origin}/ffmpeg/ffmpeg-core.js`;
  const wasmURL = config?.wasmURL || `${origin}/ffmpeg/ffmpeg-core.wasm`;

  try {
    let finalCore = coreURL;
    let finalWasm = wasmURL;
    try {
      const [cRes, wRes] = await Promise.all([fetch(coreURL), fetch(wasmURL)]);
      if (cRes.ok && wRes.ok) {
        finalCore = URL.createObjectURL(await cRes.blob());
        finalWasm = URL.createObjectURL(await wRes.blob());
      }
    } catch {}

    await ffmpeg.load({ coreURL: finalCore, wasmURL: finalWasm });
    isLoaded = true;
    loadedFrom = 'local';
    return { loadedFrom: 'local' };
  } catch (localErr) {
    console.warn('[ffmpeg-worker] Local core failed, falling back to CDN...', localErr);
    try {
      await ffmpeg.load({
        coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js',
        wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm',
      });
      isLoaded = true;
      loadedFrom = 'cdn';
      return { loadedFrom: 'cdn' };
    } catch (cdnErr) {
      isLoaded = false;
      throw new Error(`Failed to initialize ffmpeg core: ${cdnErr.message || cdnErr}`);
    }
  }
}

// ---------------------------------------------------------------------------
// OPFS Helpers
// ---------------------------------------------------------------------------

async function getOPFSRoot() {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory) {
    try {
      return await navigator.storage.getDirectory();
    } catch {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Virtual FS Helpers
// ---------------------------------------------------------------------------

async function writeVirtualFile(name, source) {
  if (!ffmpeg) throw new Error('FFmpeg is not initialized.');
  let bytes;
  if (source instanceof Uint8Array) {
    bytes = source;
  } else if (source instanceof ArrayBuffer) {
    bytes = new Uint8Array(source);
  } else if (source && typeof source.arrayBuffer === 'function') {
    const buf = await source.arrayBuffer();
    bytes = new Uint8Array(buf);
  } else {
    throw new Error('Invalid file data format passed to worker.');
  }
  await ffmpeg.writeFile(name, bytes);
}

async function readVirtualFile(name) {
  if (!ffmpeg) throw new Error('FFmpeg is not initialized.');
  const data = await ffmpeg.readFile(name);
  if (typeof data === 'string') {
    return new TextEncoder().encode(data);
  }
  return data;
}

async function deleteVirtualFile(name) {
  if (!ffmpeg) return;
  try {
    await ffmpeg.deleteFile(name);
  } catch {
    // Ignore cleanup errors
  }
}

// ---------------------------------------------------------------------------
// Command Execution with Event Dispatch
// ---------------------------------------------------------------------------

async function runFFmpegArgs(msgId, args) {
  const onProgress = ({ progress, time }) => {
    const ratio = Math.max(0, Math.min(1, progress > 1 ? progress / 100 : progress));
    self.postMessage({
      id: msgId,
      type: 'progress',
      progress: {
        ratio,
        percent: Math.round(ratio * 100),
        timeSeconds: time ? time / 1000000 : undefined,
      },
    });
  };

  const onLog = ({ message }) => {
    self.postMessage({
      id: msgId,
      type: 'log',
      message,
    });

    const speedMatch = message.match(/speed=\s*([\d.]+x)/i);
    const timeMatch = message.match(/time=\s*(\d{2}:\d{2}:\d{2}\.?\d*)/i);
    const fpsMatch = message.match(/fps=\s*([\d.]+)/i);

    if (timeMatch || speedMatch || fpsMatch) {
      const timeFormatted = timeMatch ? timeMatch[1] : undefined;
      const timeSeconds = timeFormatted ? parseTimeToSec(timeFormatted) : undefined;
      const speed = speedMatch ? speedMatch[1] : undefined;
      const fps = fpsMatch ? parseFloat(fpsMatch[1]) : undefined;

      self.postMessage({
        id: msgId,
        type: 'progress',
        progress: {
          ratio: 0.5,
          percent: 50,
          timeFormatted,
          timeSeconds,
          speed,
          fps,
          message,
        },
      });
    }
  };

  ffmpeg.on('progress', onProgress);
  ffmpeg.on('log', onLog);

  try {
    const ret = await ffmpeg.exec(args);
    if (ret !== 0) {
      throw new Error(`FFmpeg exited with non-zero exit code: ${ret}`);
    }
  } finally {
    ffmpeg.off('progress', onProgress);
    ffmpeg.off('log', onLog);
  }
}

// ---------------------------------------------------------------------------
// Worker Message Router
// ---------------------------------------------------------------------------

self.onmessage = async (e) => {
  const msg = e.data;
  if (!msg || !msg.id) return;

  const { id, type, payload, config } = msg;

  if (type === 'init') {
    try {
      const res = await initFFmpeg(config);
      self.postMessage({ id, type: 'init-ok', loadedFrom: res.loadedFrom });
    } catch (err) {
      self.postMessage({ id, type: 'error', error: err.message || String(err) });
    }
    return;
  }

  if (type === 'cancel') {
    if (ffmpeg) {
      try {
        ffmpeg.terminate();
      } catch {
        // ignore
      }
      ffmpeg = null;
      isLoaded = false;
      loadedFrom = null;
    }
    self.postMessage({ id, type: 'error', error: 'Operation cancelled by user.' });
    return;
  }

  // Ensure FFmpeg is loaded before processing tasks
  try {
    await initFFmpeg(config);
  } catch (loadErr) {
    self.postMessage({ id, type: 'error', error: loadErr.message || String(loadErr) });
    return;
  }

  const startTime = performance.now();

  // 1. CONVERT (Remux container formats with stream copy)
  if (type === 'convert') {
    const { file, fileName, targetContainer, streamCopy, videoCodec, audioCodec } = payload;
    const isStreamCopy = streamCopy !== false;
    const baseName = (fileName || 'media').replace(/\.[^/.]+$/, '');
    const inExt = (fileName || '').split('.').pop() || 'mp4';
    const outExt = (targetContainer || 'mp4').toLowerCase();

    const inName = `in_${Date.now()}.${inExt}`;
    const outName = `out_${Date.now()}.${outExt}`;

    try {
      await writeVirtualFile(inName, file);

      let args = [];
      if (isStreamCopy) {
        if (outExt === 'mp4') {
          args = ['-i', inName, '-c', 'copy', '-movflags', '+faststart', outName];
        } else {
          args = ['-i', inName, '-c', 'copy', outName];
        }
      } else {
        const vc = videoCodec || 'copy';
        const ac = audioCodec || 'copy';
        args = ['-i', inName, '-c:v', vc, '-c:a', ac];
        if (outExt === 'mp4') args.push('-movflags', '+faststart');
        args.push(outName);
      }

      try {
        await runFFmpegArgs(id, args);
      } catch (err) {
        // Fallback for MP4 container when audio cannot stream copy (e.g. Opus -> MP4)
        if (isStreamCopy && outExt === 'mp4') {
          console.warn('[ffmpeg-worker] Stream copy failed for MP4. Retrying with video copy + AAC audio...');
          args = [
            '-i',
            inName,
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-movflags',
            '+faststart',
            outName,
          ];
          await runFFmpegArgs(id, args);
        } else {
          throw err;
        }
      }

      const outBytes = await readVirtualFile(outName);
      const mime = getMime(outExt);
      const elapsedMs = Math.round(performance.now() - startTime);

      self.postMessage(
        {
          id,
          type: 'success',
          result: {
            buffer: outBytes.buffer,
            fileName: `${baseName}.${outExt}`,
            mimeType: mime,
            sizeBytes: outBytes.byteLength,
            elapsedMs,
            isStreamCopy,
          },
        },
        [outBytes.buffer]
      );
    } catch (err) {
      self.postMessage({ id, type: 'error', error: err.message || String(err) });
    } finally {
      await deleteVirtualFile(inName);
      await deleteVirtualFile(outName);
    }
    return;
  }

  // 2. EXTRACT AUDIO (-vn -c:a copy or mp3/aac/wav)
  if (type === 'extract-audio') {
    const { file, fileName, targetFormat, streamCopy, bitrateKbps } = payload;
    const tf = (targetFormat || 'copy').toLowerCase();
    const isStreamCopy = streamCopy !== false && (tf === 'copy' || tf === 'native');
    const baseName = (fileName || 'audio').replace(/\.[^/.]+$/, '');
    const inExt = (fileName || '').split('.').pop() || 'mp4';

    let outExt = 'm4a';
    if (tf === 'mp3') outExt = 'mp3';
    else if (tf === 'wav') outExt = 'wav';
    else if (tf === 'flac') outExt = 'flac';
    else if (tf === 'opus' || tf === 'ogg') outExt = 'opus';
    else if (tf === 'aac') outExt = 'aac';
    else if (tf === 'copy' || tf === 'native') {
      outExt = inExt === 'webm' ? 'opus' : inExt === 'mkv' ? 'mka' : 'm4a';
    }

    const inName = `in_${Date.now()}.${inExt}`;
    const outName = `out_${Date.now()}.${outExt}`;

    try {
      await writeVirtualFile(inName, file);

      let args = [];
      if (isStreamCopy) {
        args = ['-i', inName, '-vn', '-c:a', 'copy', outName];
      } else {
        const br = `${bitrateKbps || 192}k`;
        if (outExt === 'mp3') {
          args = ['-i', inName, '-vn', '-c:a', 'libmp3lame', '-b:a', br, outName];
        } else if (outExt === 'wav') {
          args = ['-i', inName, '-vn', '-c:a', 'pcm_s16le', outName];
        } else if (outExt === 'flac') {
          args = ['-i', inName, '-vn', '-c:a', 'flac', outName];
        } else if (outExt === 'aac' || outExt === 'm4a') {
          args = ['-i', inName, '-vn', '-c:a', 'aac', '-b:a', br, outName];
        } else if (outExt === 'opus') {
          args = ['-i', inName, '-vn', '-c:a', 'libopus', '-b:a', br, outName];
        } else {
          args = ['-i', inName, '-vn', outName];
        }
      }

      try {
        await runFFmpegArgs(id, args);
      } catch (err) {
        if (isStreamCopy) {
          console.warn('[ffmpeg-worker] Audio copy failed. Retrying with AAC transcode...');
          outExt = 'm4a';
          const fallbackOut = `out_${Date.now()}.${outExt}`;
          args = ['-i', inName, '-vn', '-c:a', 'aac', '-b:a', '192k', fallbackOut];
          await runFFmpegArgs(id, args);
        } else {
          throw err;
        }
      }

      const outBytes = await readVirtualFile(outName);
      const mime = getMime(outExt);
      const elapsedMs = Math.round(performance.now() - startTime);

      self.postMessage(
        {
          id,
          type: 'success',
          result: {
            buffer: outBytes.buffer,
            fileName: `${baseName}.${outExt}`,
            mimeType: mime,
            sizeBytes: outBytes.byteLength,
            elapsedMs,
            isStreamCopy,
          },
        },
        [outBytes.buffer]
      );
    } catch (err) {
      self.postMessage({ id, type: 'error', error: err.message || String(err) });
    } finally {
      await deleteVirtualFile(inName);
      await deleteVirtualFile(outName);
    }
    return;
  }

  // 3. MERGE (Combine separate video and audio tracks)
  if (type === 'merge') {
    const { videoFile, videoFileName, audioFile, audioFileName, targetContainer, streamCopy, audioDelayMs } = payload;
    const isStreamCopy = streamCopy !== false;
    const baseName = (videoFileName || 'merged').replace(/\.[^/.]+$/, '');
    const vExt = (videoFileName || '').split('.').pop() || 'mp4';
    const aExt = (audioFileName || '').split('.').pop() || 'm4a';
    const outExt = (targetContainer || 'mp4').toLowerCase();

    const vName = `v_${Date.now()}.${vExt}`;
    const aName = `a_${Date.now()}.${aExt}`;
    const outName = `out_${Date.now()}.${outExt}`;

    try {
      await writeVirtualFile(vName, videoFile);
      await writeVirtualFile(aName, audioFile);

      let args = ['-i', vName];
      if (audioDelayMs && audioDelayMs !== 0) {
        args.push('-itsoffset', (audioDelayMs / 1000).toFixed(3));
      }
      args.push('-i', aName, '-map', '0:v:0', '-map', '1:a:0');

      if (isStreamCopy) {
        args.push('-c:v', 'copy', '-c:a', 'copy', '-shortest');
      } else {
        args.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest');
      }

      if (outExt === 'mp4') {
        args.push('-movflags', '+faststart');
      }
      args.push(outName);

      try {
        await runFFmpegArgs(id, args);
      } catch (err) {
        if (isStreamCopy && outExt === 'mp4') {
          console.warn('[ffmpeg-worker] Direct merge copy failed. Retrying with video copy + AAC audio...');
          args = ['-i', vName];
          if (audioDelayMs && audioDelayMs !== 0) {
            args.push('-itsoffset', (audioDelayMs / 1000).toFixed(3));
          }
          args.push(
            '-i',
            aName,
            '-map',
            '0:v:0',
            '-map',
            '1:a:0',
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-shortest',
            '-movflags',
            '+faststart',
            outName
          );
          await runFFmpegArgs(id, args);
        } else {
          throw err;
        }
      }

      const outBytes = await readVirtualFile(outName);
      const mime = getMime(outExt);
      const elapsedMs = Math.round(performance.now() - startTime);

      self.postMessage(
        {
          id,
          type: 'success',
          result: {
            buffer: outBytes.buffer,
            fileName: `${baseName}.${outExt}`,
            mimeType: mime,
            sizeBytes: outBytes.byteLength,
            elapsedMs,
            isStreamCopy,
          },
        },
        [outBytes.buffer]
      );
    } catch (err) {
      self.postMessage({ id, type: 'error', error: err.message || String(err) });
    } finally {
      await deleteVirtualFile(vName);
      await deleteVirtualFile(aName);
      await deleteVirtualFile(outName);
    }
    return;
  }

  // 4. EXEC (Arbitrary command line arguments)
  if (type === 'exec') {
    const { args, inputFiles, outputFileName, outputMimeType } = payload;
    try {
      for (const input of inputFiles) {
        await writeVirtualFile(input.name, input.buffer);
      }

      await runFFmpegArgs(id, args);

      const outBytes = await readVirtualFile(outputFileName);
      const ext = outputFileName.split('.').pop() || '';
      const mime = outputMimeType || getMime(ext);
      const elapsedMs = Math.round(performance.now() - startTime);

      self.postMessage(
        {
          id,
          type: 'success',
          result: {
            buffer: outBytes.buffer,
            fileName: outputFileName,
            mimeType: mime,
            sizeBytes: outBytes.byteLength,
            elapsedMs,
            isStreamCopy: args.includes('copy'),
          },
        },
        [outBytes.buffer]
      );
    } catch (err) {
      self.postMessage({ id, type: 'error', error: err.message || String(err) });
    } finally {
      for (const input of inputFiles) {
        await deleteVirtualFile(input.name);
      }
      await deleteVirtualFile(outputFileName);
    }
    return;
  }
};
