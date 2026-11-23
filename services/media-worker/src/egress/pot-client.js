'use strict';

/**
 * pot-client.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PO-Token Client for MUXARO Media Worker
 *
 * Communicates with the bgutil-sidecar running on 127.0.0.1:4416.
 * The sidecar generates YouTube Proof-of-Origin tokens required by yt-dlp
 * when bot-detection is active.
 *
 * Contract:
 *   getPOToken(videoId: string): Promise<string|null>
 *     • Returns the PO token string on success.
 *     • Returns null on any failure (sidecar unreachable, bad response, timeout).
 *     • NEVER throws — sidecar failure must not crash the main service.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SIDECAR_BASE_URL =
  (process.env.BGUTIL_SIDECAR_URL || 'http://127.0.0.1:4416').replace(/\/$/, '');

const TOKEN_ENDPOINT  = `${SIDECAR_BASE_URL}/token`;
const REQUEST_TIMEOUT = 8_000; // 8-second hard cap — sidecar must be local/fast

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Perform a POST request to the sidecar token endpoint.
 *
 * @param {string} videoId
 * @returns {Promise<{ token: string }|null>}
 */
async function requestToken(videoId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      console.warn(
        `[pot-client] Sidecar returned HTTP ${res.status} for videoId=${videoId}`,
      );
      return null;
    }

    const json = await res.json();
    return json ?? null;
  } catch (err) {
    clearTimeout(timer);

    if (err.name === 'AbortError') {
      console.warn(`[pot-client] Sidecar request timed out for videoId=${videoId}`);
    } else {
      // ECONNREFUSED, ENOTFOUND, etc. — sidecar is simply not up yet
      console.warn(`[pot-client] Sidecar unreachable: ${err.message}`);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieve a PO token for the given YouTube video ID from the bgutil sidecar.
 *
 * @param {string} videoId  YouTube video ID (e.g. "jNQXAC9IVRw")
 * @returns {Promise<string|null>}  PO token string, or null if unavailable
 */
async function getPOToken(videoId) {
  if (!videoId || typeof videoId !== 'string') {
    console.warn('[pot-client] getPOToken called with invalid videoId:', videoId);
    return null;
  }

  try {
    const result = await requestToken(videoId.trim());

    if (!result) return null;

    // The sidecar may return { token: "..." } or { poToken: "..." } or a plain string
    const token =
      typeof result === 'string'
        ? result
        : result.token ?? result.poToken ?? result.po_token ?? null;

    if (typeof token !== 'string' || token.length === 0) {
      console.warn('[pot-client] Sidecar returned unexpected token shape:', JSON.stringify(result));
      return null;
    }

    return token;
  } catch (err) {
    // Belt-and-suspenders: outer try/catch ensures we never propagate
    console.error('[pot-client] Unexpected error (swallowed):', err.message);
    return null;
  }
}

/**
 * Quick reachability check — resolves true if the sidecar responds to a
 * lightweight GET /health or / endpoint.  Used by the healthcheck route.
 *
 * @returns {Promise<boolean>}
 */
async function isSidecarReachable() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);

  try {
    const res = await fetch(`${SIDECAR_BASE_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
    }).catch(() =>
      fetch(SIDECAR_BASE_URL, { method: 'GET', signal: controller.signal }),
    );
    clearTimeout(timer);
    return res.ok || res.status < 500;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

module.exports = {
  getPOToken,
  isSidecarReachable,
};
