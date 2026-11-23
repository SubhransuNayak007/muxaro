'use strict';

/**
 * validate.js — Media response & buffer validator
 *
 * All functions return { valid: boolean, reason?: string }.
 * They NEVER throw.
 */

// ── Magic-byte signatures ────────────────────────────────────────────────────

/**
 * Check if a buffer starts with the given sequence of byte values.
 * @param {Buffer} buf
 * @param {number[]} bytes
 * @param {number} [offset=0]
 */
function startsWith(buf, bytes, offset = 0) {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
}

/**
 * Read 4 ASCII bytes from buf at offset as a string.
 */
function readAscii4(buf, offset) {
  if (buf.length < offset + 4) return '';
  return buf.slice(offset, offset + 4).toString('ascii');
}

/**
 * validateFileBuffer — inspect magic bytes to confirm a known media format.
 *
 * Supported containers:
 *   MP4 / MOV / M4A / M4V  — bytes 4-7 === 'ftyp' (ISO Base Media)
 *   MKV / WebM             — 0x1A 0x45 0xDF 0xA3  (EBML header)
 *   AVI                    — 'RIFF' at 0, 'AVI ' at 8
 *   MP3                    — 'ID3' tag OR sync word 0xFF 0xFB / 0xFF 0xFA / 0xFF 0xF3
 *
 * @param {Buffer} buffer
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateFileBuffer(buffer) {
  try {
    if (!Buffer.isBuffer(buffer)) {
      return { valid: false, reason: 'Input is not a Buffer' };
    }

    if (buffer.length <= 1024) {
      return {
        valid: false,
        reason: `Buffer too small (${buffer.length} bytes, minimum 1025)`,
      };
    }

    // MP4 / ISO Base Media File Format — 'ftyp' at bytes 4-7
    if (readAscii4(buffer, 4) === 'ftyp') {
      return { valid: true };
    }

    // MKV / WebM — EBML magic: 1A 45 DF A3
    if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) {
      return { valid: true };
    }

    // AVI — 'RIFF' at 0, 'AVI ' at 8
    if (
      readAscii4(buffer, 0) === 'RIFF' &&
      readAscii4(buffer, 8) === 'AVI '
    ) {
      return { valid: true };
    }

    // MP3 — ID3v2 tag header
    if (
      buffer.length >= 3 &&
      buffer[0] === 0x49 && // 'I'
      buffer[1] === 0x44 && // 'D'
      buffer[2] === 0x33    // '3'
    ) {
      return { valid: true };
    }

    // MP3 — raw sync word (0xFF followed by 0xFB, 0xFA, or 0xF3)
    if (
      buffer.length >= 2 &&
      buffer[0] === 0xff &&
      (buffer[1] === 0xfb || buffer[1] === 0xfa || buffer[1] === 0xf3)
    ) {
      return { valid: true };
    }

    return {
      valid: false,
      reason: 'Unrecognised magic bytes — not a supported media format',
    };
  } catch (err) {
    return { valid: false, reason: `Validation error: ${err.message}` };
  }
}

/**
 * validateMediaResponse — validate an HTTP response object before consuming the body.
 *
 * @param {string} url         Original request URL (for error messages only)
 * @param {object} response    Fetch-API or node-fetch Response (or any object with
 *                             .headers.get() and optional .headers['content-length'])
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateMediaResponse(url, response) {
  try {
    if (!response) {
      return { valid: false, reason: 'Response object is null or undefined' };
    }

    // ── Content-Type ─────────────────────────────────────────────────────────
    let contentType = '';
    if (typeof response.headers?.get === 'function') {
      // Fetch-API Headers
      contentType = response.headers.get('content-type') || '';
    } else if (response.headers && typeof response.headers === 'object') {
      // Node.js http.IncomingMessage style
      contentType =
        response.headers['content-type'] ||
        response.headers['Content-Type'] ||
        '';
    }

    // Strip parameters like "; charset=utf-8"
    const mimeBase = contentType.split(';')[0].trim().toLowerCase();

    if (!mimeBase.startsWith('video/') && !mimeBase.startsWith('audio/')) {
      return {
        valid: false,
        reason: `Content-Type '${mimeBase}' is not video/* or audio/*`,
      };
    }

    // ── Content-Length ───────────────────────────────────────────────────────
    let contentLength = -1;
    if (typeof response.headers?.get === 'function') {
      const raw = response.headers.get('content-length');
      if (raw !== null) contentLength = parseInt(raw, 10);
    } else if (response.headers && typeof response.headers === 'object') {
      const raw =
        response.headers['content-length'] ||
        response.headers['Content-Length'];
      if (raw !== undefined) contentLength = parseInt(raw, 10);
    }

    // Only reject if a Content-Length header is present and clearly too small.
    // If absent (chunked transfer), we allow it through — the buffer validator
    // will catch invalid content later.
    if (contentLength !== -1 && contentLength <= 4096) {
      return {
        valid: false,
        reason: `Content-Length ${contentLength} bytes is too small (minimum 4097)`,
      };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, reason: `Validation error: ${err.message}` };
  }
}

module.exports = { validateMediaResponse, validateFileBuffer };
