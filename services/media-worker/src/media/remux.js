'use strict';

/**
 * remux.js — Zero-Disk FFmpeg Remuxer
 *
 * Streams video + audio URLs through FFmpeg (copy codecs, no re-encoding)
 * and pipes stdout directly to a Node.js Writable or HTTP response.
 * No intermediate files are written to disk at any point.
 *
 * iOS/Android MP4 defaults:
 *   - Streaming: -movflags +faststart   (moov atom at the front)
 *   - Chunk-safe mobile: frag_keyframe+empty_moov
 */

const { spawn } = require('child_process');
const { PassThrough } = require('stream');

/**
 * Build the ffmpeg argument list.
 * @param {string} videoUrl
 * @param {string} audioUrl
 * @param {'stream'|'fragmented'} [mode='stream']  output mode
 * @returns {string[]}
 */
function buildArgs(videoUrl, audioUrl, mode = 'stream') {
  const movflags =
    mode === 'fragmented'
      ? 'frag_keyframe+empty_moov+default_base_moof'
      : '+faststart';

  return [
    // Input 1: video stream (HTTP/HTTPS, no disk write)
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-i', videoUrl,

    // Input 2: audio stream
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-i', audioUrl,

    // Copy both streams verbatim — zero re-encoding
    '-c:v', 'copy',
    '-c:a', 'copy',

    // Map first video stream from input 0 and first audio from input 1
    '-map', '0:v:0',
    '-map', '1:a:0',

    // MP4 container with mobile-friendly flags
    '-movflags', movflags,

    // Suppress stdin; write to stdout (pipe:1)
    '-nostdin',
    '-f', 'mp4',
    'pipe:1',
  ];
}

/**
 * Kill a child process gracefully (SIGKILL), swallowing errors.
 * @param {import('child_process').ChildProcess} child
 */
function killChild(child) {
  try {
    if (!child.killed) {
      child.kill('SIGKILL');
    }
  } catch (_) {
    // process may have already exited
  }
}

/**
 * remuxToStream — pipe ffmpeg output directly into writableStream.
 *
 * @param {string} videoUrl      Full URL of the video-only stream
 * @param {string} audioUrl      Full URL of the audio-only stream
 * @param {import('stream').Writable} writableStream  Destination (HTTP res, file fd, etc.)
 * @param {object}  [options]
 * @param {'stream'|'fragmented'} [options.mode='stream']  MP4 output mode
 * @param {string}  [options.ffmpegBin='ffmpeg']            ffmpeg binary name/path
 * @param {boolean} [options.verbose=false]                 Pipe ffmpeg stderr to process.stderr
 * @returns {Promise<void>}  Resolves when remux completes; rejects on ffmpeg error.
 */
function remuxToStream(videoUrl, audioUrl, writableStream, options = {}) {
  const {
    mode = 'stream',
    ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg',
    verbose = false,
  } = options;

  return new Promise((resolve, reject) => {
    const args = buildArgs(videoUrl, audioUrl, mode);

    const child = spawn(ffmpegBin, args, {
      stdio: ['ignore', 'pipe', verbose ? 'inherit' : 'pipe'],
    });

    let settled = false;

    function finish(err) {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    }

    // ── Client-disconnect guard ──────────────────────────────────────────────
    // If the consumer closes or errors (network drop, explicit close(), etc.)
    // we must kill ffmpeg immediately to avoid zombie processes and wasted CPU.
    function onOutputEnd() {
      killChild(child);
      finish(null); // treat as a normal (early) finish
    }

    writableStream.once('close', onOutputEnd);
    writableStream.once('error', (err) => {
      killChild(child);
      finish(err);
    });

    // ── Pipe ffmpeg stdout → writableStream ──────────────────────────────────
    child.stdout.pipe(writableStream, { end: true });

    child.stdout.on('error', (err) => {
      killChild(child);
      finish(err);
    });

    // ── ffmpeg process lifecycle ─────────────────────────────────────────────
    child.on('error', (err) => {
      finish(new Error(`ffmpeg spawn error: ${err.message}`));
    });

    child.on('close', (code, signal) => {
      // Remove the disconnect listeners so we don't fire them after exit
      writableStream.removeListener('close', onOutputEnd);

      if (code === 0 || signal === 'SIGKILL') {
        // SIGKILL = client disconnected; already handled
        finish(null);
      } else {
        finish(
          new Error(
            `ffmpeg exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`
          )
        );
      }
    });

    // Consume stderr to prevent buffer fill when verbose=false
    if (!verbose && child.stderr) {
      child.stderr.resume();
    }
  });
}

/**
 * remuxToBuffer — collect the ffmpeg output entirely in memory.
 * Use sparingly: prefer remuxToStream for large files.
 *
 * @param {string}  videoUrl
 * @param {string}  audioUrl
 * @param {object}  [options]  Same options as remuxToStream (mode, ffmpegBin, verbose)
 * @returns {Promise<Buffer>}
 */
function remuxToBuffer(videoUrl, audioUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const pass = new PassThrough();
    const chunks = [];

    pass.on('data', (chunk) => chunks.push(chunk));
    pass.on('end', () => resolve(Buffer.concat(chunks)));
    pass.on('error', reject);

    remuxToStream(videoUrl, audioUrl, pass, options).catch(reject);
  });
}

module.exports = { remuxToStream, remuxToBuffer };
