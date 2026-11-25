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

const workerOrigin = self.location?.origin || '';
if (typeof self.document === 'undefined') {
  self.document = {
    baseURI: workerOrigin ? `${workerOrigin}/ffmpeg/` : self.location.href,
    currentScript: workerOrigin ? { src: `${workerOrigin}/ffmpeg/ffmpeg.js` } : undefined,
  };
}

let ffmpeg = null;
let coreInstance = null;
let isLoaded = false;
let loadedFrom = null;
let cachedCoreBlobUrl = null;
let cachedWasmBlobUrl = null;
let cachedCoreSource = null;

async function toTypedBlobUrl(url, mimeType) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  const buf = await res.arrayBuffer();
  return URL.createObjectURL(new Blob([buf], { type: mimeType }));
}

function createCoreWrapper(core) {
  const progressListeners = new Set();
  const logListeners = new Set();

  core.setLogger((data) => {
    for (const fn of logListeners) {
      try {
        fn(data);
      } catch {
        // Ignore listener errors
      }
    }
  });

  core.setProgress((data) => {
    for (const fn of progressListeners) {
      try {
        fn(data);
      } catch {
        // Ignore listener errors
      }
    }
  });

  return {
    exec(args, timeout = -1) {
      core.setTimeout(timeout);
      core.exec(...args);
      const ret = core.ret;
      core.reset();
      return ret;
    },
    writeFile(path, data) {
      core.FS.writeFile(path, data);
      return true;
    },
    readFile(path, encoding) {
      return core.FS.readFile(path, encoding ? { encoding } : undefined);
    },
    deleteFile(path) {
      core.FS.unlink(path);
      return true;
    },
    createDir(path) {
      core.FS.mkdir(path);
      return true;
    },
    deleteDir(path) {
      core.FS.rmdir(path);
      return true;
    },
    mount(fsType, options, mountPoint) {
      const fs = core.FS.filesystems && core.FS.filesystems[fsType];
      if (!fs) return false;
      core.FS.mount(fs, options, mountPoint);
      return true;
    },
    unmount(mountPoint) {
      core.FS.unmount(mountPoint);
      return true;
    },
    on(event, fn) {
      if (event === 'progress') progressListeners.add(fn);
      else if (event === 'log') logListeners.add(fn);
    },
    off(event, fn) {
      if (event === 'progress') progressListeners.delete(fn);
      else if (event === 'log') logListeners.delete(fn);
    },
    terminate() {
      progressListeners.clear();
      logListeners.clear();
      coreInstance = null;
    },
  };
}

async function instantiateCoreFromUrls(coreSourceUrl, wasmSourceUrl, sourceLabel) {
  let coreBlobUrl = cachedCoreBlobUrl;
  let wasmBlobUrl = cachedWasmBlobUrl;

  if (!coreBlobUrl || !wasmBlobUrl || cachedCoreSource !== sourceLabel) {
    const [nextCoreBlob, nextWasmBlob] = await Promise.all([
      toTypedBlobUrl(coreSourceUrl, 'text/javascript'),
      toTypedBlobUrl(wasmSourceUrl, 'application/wasm'),
    ]);
    coreBlobUrl = nextCoreBlob;
    wasmBlobUrl = nextWasmBlob;
    cachedCoreBlobUrl = coreBlobUrl;
    cachedWasmBlobUrl = wasmBlobUrl;
    cachedCoreSource = sourceLabel;
  }

  if (typeof self.createFFmpegCore !== 'function') {
    importScripts(coreBlobUrl);
  }
  if (typeof self.createFFmpegCore !== 'function') {
    throw new Error('createFFmpegCore did not initialize from UMD core script.');
  }

  const mainScriptUrlOrBlob = `${coreBlobUrl}#${btoa(
    JSON.stringify({ wasmURL: wasmBlobUrl, workerURL: coreBlobUrl })
  )}`;
  const core = await self.createFFmpegCore({ mainScriptUrlOrBlob });
  coreInstance = core;
  ffmpeg = createCoreWrapper(core);
  isLoaded = true;
  loadedFrom = sourceLabel;
  return { loadedFrom: sourceLabel };
}

async function initFFmpeg(config) {
  if (isLoaded && ffmpeg && coreInstance) {
    return { loadedFrom };
  }

  const origin = self.location?.origin || '';
  const coreURL = config?.coreURL || `${origin}/ffmpeg/ffmpeg-core.js`;
  const wasmURL = config?.wasmURL || `${origin}/ffmpeg/ffmpeg-core.wasm`;

  try {
    return await instantiateCoreFromUrls(coreURL, wasmURL, 'local');
  } catch (localErr) {
    console.warn('[ffmpeg-worker] Local UMD core failed, falling back to CDN...', localErr);
    cachedCoreBlobUrl = null;
    cachedWasmBlobUrl = null;
    cachedCoreSource = null;
    try {
      return await instantiateCoreFromUrls(
        'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js',
        'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm',
        'cdn'
      );
    } catch (cdnErr) {
      isLoaded = false;
      ffmpeg = null;
      coreInstance = null;
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

/**
 * Mounts a File/Blob zero-copy via Emscripten WORKERFS when available,
 * falling back to writeVirtualFile for ArrayBuffer/Uint8Array or if mount fails.
 */
async function prepareInputFile(name, source) {
  if (!ffmpeg) throw new Error('FFmpeg is not initialized.');

  if (
    typeof Blob !== 'undefined' &&
    source instanceof Blob &&
    typeof ffmpeg.createDir === 'function' &&
    typeof ffmpeg.mount === 'function'
  ) {
    const safeName = String(name || 'input.bin').replace(/[^a-zA-Z0-9._-]/g, '_') || 'input.bin';
    const mountDir = `/mnt_wfs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      await ffmpeg.createDir(mountDir);
      const mounted = await ffmpeg.mount(
        'WORKERFS',
        { blobs: [{ name: safeName, data: source }] },
        mountDir
      );
      if (mounted === false) {
        throw new Error('WORKERFS filesystem unavailable in worker');
      }
      return {
        inputPath: `${mountDir}/${safeName}`,
        cleanup: async () => {
          if (!ffmpeg) return;
          if (typeof ffmpeg.unmount === 'function') {
            try {
              await ffmpeg.unmount(mountDir);
            } catch {
              // Ignore cleanup errors (e.g., worker terminated on cancel)
            }
          }
          if (typeof ffmpeg.deleteDir === 'function') {
            try {
              await ffmpeg.deleteDir(mountDir);
            } catch {
              // Ignore cleanup errors
            }
          }
        },
      };
    } catch (err) {
      if (typeof ffmpeg.deleteDir === 'function') {
        try {
          await ffmpeg.deleteDir(mountDir);
        } catch {
          // Ignore
        }
      }
      console.warn('[ffmpeg-worker] WORKERFS mount unavailable, falling back to MEMFS write:', err);
    }
  }

  await writeVirtualFile(name, source);
  return {
    inputPath: name,
    cleanup: () => deleteVirtualFile(name),
  };
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
    let preparedInput = null;

    try {
      preparedInput = await prepareInputFile(inName, file);

      let args = [];
      if (isStreamCopy) {
        if (outExt === 'mp4') {
          args = ['-i', preparedInput.inputPath, '-c', 'copy', '-movflags', '+faststart', outName];
        } else {
          args = ['-i', preparedInput.inputPath, '-c', 'copy', outName];
        }
      } else {
        const vc = videoCodec || 'copy';
        const ac = audioCodec || 'copy';
        args = ['-i', preparedInput.inputPath, '-c:v', vc, '-c:a', ac];
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
            preparedInput.inputPath,
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
      if (preparedInput) await preparedInput.cleanup();
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
    let actualOutName = outName;
    let fallbackOut = null;
    let usedStreamCopy = isStreamCopy;
    let preparedInput = null;

    try {
      preparedInput = await prepareInputFile(inName, file);

      let args = [];
      if (isStreamCopy) {
        args = ['-i', preparedInput.inputPath, '-vn', '-c:a', 'copy', outName];
      } else {
        const br = `${bitrateKbps || 192}k`;
        if (outExt === 'mp3') {
          args = ['-i', preparedInput.inputPath, '-vn', '-c:a', 'libmp3lame', '-b:a', br, outName];
        } else if (outExt === 'wav') {
          args = ['-i', preparedInput.inputPath, '-vn', '-c:a', 'pcm_s16le', outName];
        } else if (outExt === 'flac') {
          args = ['-i', preparedInput.inputPath, '-vn', '-c:a', 'flac', outName];
        } else if (outExt === 'aac' || outExt === 'm4a') {
          args = ['-i', preparedInput.inputPath, '-vn', '-c:a', 'aac', '-b:a', br, outName];
        } else if (outExt === 'opus') {
          args = ['-i', preparedInput.inputPath, '-vn', '-c:a', 'libopus', '-b:a', br, outName];
        } else {
          args = ['-i', preparedInput.inputPath, '-vn', outName];
        }
      }

      try {
        await runFFmpegArgs(id, args);
      } catch (err) {
        if (isStreamCopy) {
          console.warn('[ffmpeg-worker] Audio copy failed. Retrying with AAC transcode...');
          outExt = 'm4a';
          fallbackOut = `out_${Date.now()}_fallback.${outExt}`;
          actualOutName = fallbackOut;
          usedStreamCopy = false;
          args = ['-i', preparedInput.inputPath, '-vn', '-c:a', 'aac', '-b:a', '192k', fallbackOut];
          await runFFmpegArgs(id, args);
        } else {
          throw err;
        }
      }

      const outBytes = await readVirtualFile(actualOutName);
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
            isStreamCopy: usedStreamCopy,
          },
        },
        [outBytes.buffer]
      );
    } catch (err) {
      self.postMessage({ id, type: 'error', error: err.message || String(err) });
    } finally {
      if (preparedInput) await preparedInput.cleanup();
      await deleteVirtualFile(outName);
      if (fallbackOut) await deleteVirtualFile(fallbackOut);
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
    let preparedVideo = null;
    let preparedAudio = null;

    try {
      preparedVideo = await prepareInputFile(vName, videoFile);
      preparedAudio = await prepareInputFile(aName, audioFile);

      let args = ['-i', preparedVideo.inputPath];
      if (audioDelayMs && audioDelayMs !== 0) {
        args.push('-itsoffset', (audioDelayMs / 1000).toFixed(3));
      }
      args.push('-i', preparedAudio.inputPath, '-map', '0:v:0', '-map', '1:a:0');

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
          args = ['-i', preparedVideo.inputPath];
          if (audioDelayMs && audioDelayMs !== 0) {
            args.push('-itsoffset', (audioDelayMs / 1000).toFixed(3));
          }
          args.push(
            '-i',
            preparedAudio.inputPath,
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
      if (preparedVideo) await preparedVideo.cleanup();
      if (preparedAudio) await preparedAudio.cleanup();
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
