/**
 * MUXARO Direct Bridge - Content Script (MV3)
 * Bridges MUXARO Web Application with the Chrome Extension Service Worker.
 * 
 * Features:
 * - Robust bidirectional postMessage handshake with Next.js web application.
 * - Solves Isolated World boundary and hydration race conditions.
 * - Routes stream downloads and residential chunk requests directly to service worker.
 * - Relays download progress, completion, and stream chunk data in real time.
 */

(function () {
  'use strict';

  const MUXARO_VERSION = '1.1.0';
  const BRIDGE_SOURCE = 'MUXARO_BRIDGE';
  const APP_SOURCE = 'MUXARO_APP';

  function getTargetOrigin() {
    try {
      if (typeof window !== 'undefined' && window.location.origin && window.location.origin !== 'null') {
        return window.location.origin;
      }
    } catch (_) {}
    return '*';
  }

  function injectMainWorldFlags() {
    try {
      if (!document.documentElement) return;
      const script = document.createElement('script');
      script.textContent = `
        window.__MUXARO_DIRECT_ACTIVE__ = true;
        window.__MUXARO_EXTENSION_ACTIVE__ = true;
        window.__MUXARO_DIRECT_VERSION__ = '${MUXARO_VERSION}';
        window.__MUXARO_BRIDGE_KIND__ = 'chrome-extension';
      `;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (_) {
      // Safe fallback if CSP prevents inline scripts
    }
  }

  function announce(nonce) {
    try {
      const targetOrigin = getTargetOrigin();

      // 1. Triple-format postMessage for modern useDirectBridge, useMuxaroBridge, and legacy compatibility
      window.postMessage(
        {
          type: 'MUXARO_DIRECT_PONG',
          source: BRIDGE_SOURCE,
          version: MUXARO_VERSION,
          active: true,
          isExtension: true,
          nonce: nonce || undefined,
          capabilities: ['residential-fetch', 'native-download', 'stream-chunks', 'cors-bypass'],
          timestamp: Date.now(),
        },
        targetOrigin
      );

      window.postMessage(
        {
          source: BRIDGE_SOURCE,
          type: 'PONG',
          version: MUXARO_VERSION,
          active: true,
          isExtension: true,
          nonce: nonce || undefined,
          capabilities: ['residential-fetch', 'native-download', 'stream-chunks', 'cors-bypass'],
          timestamp: Date.now(),
        },
        targetOrigin
      );

      window.postMessage(
        {
          type: 'MUXARO_DIRECT_READY',
          version: MUXARO_VERSION,
          active: true,
          isExtension: true,
          timestamp: Date.now(),
        },
        targetOrigin
      );

      // 2. DOM attributes (accessible by host page and all sandboxes)
      if (document.documentElement) {
        document.documentElement.setAttribute('data-muxaro-direct', 'active');
        document.documentElement.setAttribute('data-muxaro-extension', 'active');
        document.documentElement.setAttribute('data-muxaro-version', MUXARO_VERSION);
      }

      // 3. Main world global injection
      injectMainWorldFlags();

      // 4. CustomEvents for event-driven UI listeners
      const detail = {
        version: MUXARO_VERSION,
        active: true,
        isExtension: true,
        capabilities: ['residential-fetch', 'native-download', 'stream-chunks', 'cors-bypass'],
      };
      window.dispatchEvent(new CustomEvent('muxaro:direct-ready', { detail }));
      if (document.documentElement) {
        document.documentElement.dispatchEvent(new CustomEvent('muxaro:direct-ready', { detail }));
      }
    } catch (err) {
      console.warn('[MUXARO Extension Bridge] Failed to announce readiness:', err);
    }
  }

  // Announce immediately at document-start
  announce();

  // Retry timings to beat React/Next.js hydration delays
  [100, 300, 600, 1200, 2000].forEach(delay => setTimeout(announce, delay));

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', announce);
  }
  window.addEventListener('load', announce);

  // Heartbeat to sustain connection across SPA navigations
  setInterval(announce, 2500);

  // Listen for messages from background service worker
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;

    const targetOrigin = getTargetOrigin();

    if (message.type === 'DOWNLOAD_PROGRESS') {
      const detail = {
        loaded: message.loaded,
        total: message.total,
        percent: message.percent,
        filename: message.filename,
        downloadId: message.downloadId,
      };
      window.dispatchEvent(new CustomEvent('muxaro:direct-progress', { detail }));
      window.postMessage({ type: 'MUXARO_DIRECT_PROGRESS', ...detail }, targetOrigin);
      sendResponse({ received: true });
      return true;
    }

    if (message.type === 'DOWNLOAD_COMPLETE') {
      const detail = {
        success: true,
        filename: message.filename,
        downloadId: message.downloadId,
      };
      window.dispatchEvent(new CustomEvent('muxaro:direct-complete', { detail }));
      window.postMessage({ type: 'MUXARO_DIRECT_COMPLETE', ...detail }, targetOrigin);
      sendResponse({ received: true });
      return true;
    }

    if (message.type === 'DOWNLOAD_ERROR') {
      const detail = {
        success: false,
        error: message.error,
        filename: message.filename,
      };
      window.dispatchEvent(new CustomEvent('muxaro:direct-error', { detail }));
      window.postMessage({ type: 'MUXARO_DIRECT_ERROR', ...detail }, targetOrigin);
      sendResponse({ received: true });
      return true;
    }

    return false;
  });

  // Listen for messages dispatched by the web application
  window.addEventListener('message', function (event) {
    if (event.source !== window || !event.data || typeof event.data !== 'object') return;
    if (event.origin && event.origin !== 'null' && event.origin !== window.location.origin) return;

    const data = event.data;

    // 1. Handshake PING
    if (
      data.type === 'MUXARO_DIRECT_PING' ||
      (data.source === APP_SOURCE && data.type === 'PING') ||
      data.type === 'PING'
    ) {
      announce(data.nonce);
      return;
    }

    // 2. Direct Stream Download
    if (data.type === 'MUXARO_DIRECT_DOWNLOAD' || (data.source === APP_SOURCE && data.type === 'DOWNLOAD_STREAM')) {
      handleDirectDownload(data);
      return;
    }

    // 3. Residential Chunk Fetch (for OPFS streaming / ffmpeg.wasm in browser)
    if (data.type === 'MUXARO_FETCH_CHUNK' || (data.source === APP_SOURCE && data.type === 'FETCH_STREAM_CHUNK')) {
      handleFetchChunk(data);
      return;
    }

    // 4. Status Query
    if (data.type === 'MUXARO_GET_STATUS' || (data.source === APP_SOURCE && data.type === 'GET_STATUS')) {
      handleGetStatus(data);
      return;
    }
  });

  // Also support CustomEvents from web page
  window.addEventListener('muxaro:direct-download', function (event) {
    if (event.detail) handleDirectDownload(event.detail);
  });

  function validateUrl(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return null;
    const trimmed = urlStr.trim();
    if (!/^https?:\/\//i.test(trimmed)) return null;

    try {
      const parsed = new URL(trimmed);
      const host = parsed.hostname.toLowerCase();
      // Block SSRF / metadata endpoints
      if (
        host === '169.254.169.254' ||
        host === '0.0.0.0' ||
        host === 'metadata.google.internal' ||
        (host === 'localhost' && location.hostname !== 'localhost') ||
        (host === '127.0.0.1' && location.hostname !== '127.0.0.1')
      ) {
        return null;
      }
      return trimmed;
    } catch {
      return null;
    }
  }

  function sanitizeFilename(name) {
    return (
      String(name || 'muxaro_media.mp4')
        .replace(/[\r\n\0]/g, '')
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\.\.+/g, '.')
        .trim() || 'muxaro_media.mp4'
    );
  }

  function handleDirectDownload(data) {
    const validUrl = validateUrl(data.streamUrl || data.url);
    if (!validUrl) {
      const err = 'Invalid or disallowed stream URL';
      console.error('[MUXARO Extension Bridge]', err, data);
      notifyError(err, data.filename);
      return;
    }

    const filename = sanitizeFilename(data.filename);

    console.log('[MUXARO Extension Bridge] Forwarding download request to background service worker:', filename);

    chrome.runtime.sendMessage(
      {
        action: 'DOWNLOAD_STREAM',
        payload: {
          url: validUrl,
          filename: filename,
          headers: data.headers || {},
        },
      },
      response => {
        if (chrome.runtime.lastError) {
          console.error('[MUXARO Extension Bridge] Runtime error:', chrome.runtime.lastError.message);
          notifyError(chrome.runtime.lastError.message, filename);
          return;
        }

        if (!response || !response.success) {
          const err = response ? response.error : 'Unknown download error';
          console.error('[MUXARO Extension Bridge] Download error:', err);
          notifyError(err, filename);
        }
      }
    );
  }

  function handleFetchChunk(data) {
    const validUrl = validateUrl(data.url);
    const requestId = data.requestId || String(Date.now());
    const targetOrigin = getTargetOrigin();

    if (!validUrl) {
      window.postMessage(
        {
          source: BRIDGE_SOURCE,
          type: 'CHUNK_RESPONSE',
          requestId: requestId,
          success: false,
          error: 'Invalid or disallowed stream URL',
        },
        targetOrigin
      );
      return;
    }

    chrome.runtime.sendMessage(
      {
        action: 'FETCH_CHUNK',
        payload: {
          url: validUrl,
          range: data.range,
          headers: data.headers || {},
          requestId: requestId,
        },
      },
      response => {
        if (chrome.runtime.lastError) {
          window.postMessage(
            {
              source: BRIDGE_SOURCE,
              type: 'CHUNK_RESPONSE',
              requestId: requestId,
              success: false,
              error: chrome.runtime.lastError.message,
            },
            targetOrigin
          );
          return;
        }

        window.postMessage(
          {
            source: BRIDGE_SOURCE,
            type: 'CHUNK_RESPONSE',
            requestId: requestId,
            ...response,
          },
          targetOrigin
        );
      }
    );
  }

  function handleGetStatus(data) {
    const requestId = data.requestId || String(Date.now());
    const targetOrigin = getTargetOrigin();

    chrome.runtime.sendMessage(
      {
        action: 'GET_STATUS',
      },
      response => {
        const payload = {
          source: BRIDGE_SOURCE,
          type: 'STATUS_RESPONSE',
          requestId: requestId,
          version: MUXARO_VERSION,
          active: true,
          isExtension: true,
          ...(response || {}),
        };
        window.postMessage(payload, targetOrigin);
      }
    );
  }

  function notifyError(err, filename) {
    const targetOrigin = getTargetOrigin();
    const detail = { success: false, filename: filename || 'unknown', error: String(err) };
    window.dispatchEvent(new CustomEvent('muxaro:direct-error', { detail }));
    window.postMessage({ type: 'MUXARO_DIRECT_ERROR', ...detail }, targetOrigin);
  }

  console.log(`[MUXARO Extension Bridge] Content script initialized (v${MUXARO_VERSION}).`);
})();
