// ==UserScript==
// @name         MUXARO Direct - High-Speed Stream Downloader
// @namespace    https://muxaro.pages.dev/
// @version      1.2.0
// @description  Client-side high-speed stream downloader for MUXARO. Enables direct browser streaming with zero limits.
// @author       MUXARO Engineering
// @match        https://muxaro.vercel.app/*
// @match        https://*.vercel.app/*
// @match        https://muxaro.app/*
// @match        https://*.muxaro.app/*
// @match        https://muxaro.pages.dev/*
// @match        *://muxaro.pages.dev/*
// @match        *://*.muxaro.pages.dev/*
// @match        *://*-muxaro.pages.dev/*
// @match        http://localhost:*/*
// @match        http://127.0.0.1:*/*
// @match        https://www.youtube.com/*
// @connect      googlevideo.com
// @connect      youtube.com
// @connect      muxaro.pages.dev
// @connect      vercel.app
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const MUXARO_VERSION = '1.2.0';

  // Origin verification helper
  function isAllowedOrigin(origin) {
    if (!origin || origin === 'null') {
      try {
        origin = window.location.origin;
      } catch (_) {
        return false;
      }
    }
    if (!origin || origin === 'null') return false;

    try {
      const u = new URL(origin);
      const host = u.hostname.toLowerCase();
      return (
        host === 'muxaro.pages.dev' ||
        host.endsWith('.muxaro.pages.dev') ||
        host.endsWith('-muxaro.pages.dev') ||
        host === 'muxaro.app' ||
        host.endsWith('.muxaro.app') ||
        host === 'muxaro.vercel.app' ||
        host.endsWith('.vercel.app') ||
        host === 'localhost' ||
        host === '127.0.0.1'
      );
    } catch (_) {
      return false;
    }
  }

  // 1. Integration on MUXARO Web Application
  const isMuxaroHost = isAllowedOrigin(window.location.origin);

  if (isMuxaroHost) {
    function getSafeTargetOrigin() {
      try {
        if (typeof window !== 'undefined' && window.location.origin && window.location.origin !== 'null') {
          return window.location.origin;
        }
      } catch (_) {}
      return '*';
    }

    function setBridgeActiveState() {
      try {
        if (document.documentElement) {
          document.documentElement.setAttribute('data-muxaro-direct', 'active');
          document.documentElement.setAttribute('data-muxaro-version', MUXARO_VERSION);
        }
      } catch (_) {}
    }

    function sendPong(nonce, clientTimestamp) {
      try {
        const targetOrigin = getSafeTargetOrigin();

        // 1. Primary secure postMessage handshake
        window.postMessage(
          {
            type: 'MUXARO_DIRECT_PONG',
            source: 'MUXARO_BRIDGE',
            version: MUXARO_VERSION,
            active: true,
            nonce: nonce || null,
            clientTimestamp: clientTimestamp || null,
            timestamp: Date.now(),
          },
          targetOrigin
        );

        // 2. Legacy event compatibility
        window.postMessage(
          {
            source: 'MUXARO_BRIDGE',
            type: 'PONG',
            version: MUXARO_VERSION,
            active: true,
          },
          targetOrigin
        );

        window.postMessage(
          {
            type: 'MUXARO_DIRECT_READY',
            version: MUXARO_VERSION,
            active: true,
          },
          targetOrigin
        );

        // 3. Mark DOM attributes
        setBridgeActiveState();

        // 4. Dispatch CustomEvents across window and document
        const detail = { version: MUXARO_VERSION, active: true, nonce: nonce || null };
        window.dispatchEvent(new CustomEvent('muxaro:direct-ready', { detail }));
        if (document.documentElement) {
          document.documentElement.dispatchEvent(new CustomEvent('muxaro:direct-ready', { detail }));
        }
      } catch (err) {
        console.warn('[MUXARO Direct] Failed to reply with pong:', err);
      }
    }

    function announce() {
      sendPong(null, null);
    }

    // Call announce immediately at document-start
    announce();

    // Call on DOMContentLoaded and window load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', announce);
    } else {
      announce();
    }
    window.addEventListener('load', announce);

    // Periodic heartbeat to ensure state persists across client-side navigations
    setInterval(announce, 2000);

    // Listen for ping requests and download commands with strict origin verification
    window.addEventListener('message', function (event) {
      if (event.source !== window || !event.data || typeof event.data !== 'object') return;

      const eventOrigin = event.origin || window.location.origin;
      if (!isAllowedOrigin(eventOrigin)) return;

      // Secure Ping Handshake
      if (
        event.data.type === 'MUXARO_DIRECT_PING' ||
        (event.data.source === 'MUXARO_APP' && event.data.type === 'PING') ||
        event.data.type === 'PING'
      ) {
        sendPong(event.data.nonce, event.data.timestamp);
        return;
      }

      if (event.data.type === 'MUXARO_DIRECT_DOWNLOAD') {
        handleDirectDownload(event.data);
        return;
      }
    });

    // Also listen for direct download CustomEvent from MUXARO UI
    window.addEventListener('muxaro:direct-download', function (event) {
      handleDirectDownload(event.detail);
    });

    function handleDirectDownload(data) {
      if (!data || !data.streamUrl) {
        console.warn('[MUXARO Direct] Missing streamUrl in download request:', data);
        return;
      }

      const rawUrl = String(data.streamUrl).trim();
      const isHttp = /^https?:\/\//i.test(rawUrl);
      const isSameOriginBlob =
        rawUrl.startsWith('blob:') &&
        typeof window !== 'undefined' &&
        rawUrl.startsWith(`blob:${window.location.origin}/`);

      // Security check: only allow safe http/https or same-origin blob URLs
      if (!isHttp && !isSameOriginBlob) {
        console.error('[MUXARO Direct] Refusing download with invalid or untrusted protocol:', rawUrl);
        return;
      }

      // Security check: reject private / cloud metadata SSRF targets
      if (isHttp) {
        try {
          const parsed = new URL(rawUrl);
          const host = parsed.hostname.toLowerCase();
          if (
            host === '169.254.169.254' ||
            host === '0.0.0.0' ||
            host === 'metadata.google.internal' ||
            (host === 'localhost' && location.hostname !== 'localhost') ||
            (host === '127.0.0.1' && location.hostname !== '127.0.0.1')
          ) {
            console.error('[MUXARO Direct] Refusing download to restricted or internal host:', host);
            return;
          }
        } catch {
          return;
        }
      }

      // Sanitize filename to prevent path traversal or shell metacharacters
      const filename = String(data.filename || 'media_download.mp4')
        .replace(/[\r\n\0]/g, '')
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\.\.+/g, '.')
        .trim() || 'media_download.mp4';

      console.log('[MUXARO Direct] Initiating direct stream download for:', filename);

      const targetOrigin = getSafeTargetOrigin();

      function notifyProgress(loaded, total) {
        const percent = total ? Math.round((loaded / total) * 100) : 0;
        const detail = { loaded, total, percent, filename };
        window.dispatchEvent(new CustomEvent('muxaro:direct-progress', { detail }));
        window.postMessage({ type: 'MUXARO_DIRECT_PROGRESS', ...detail }, targetOrigin);
      }

      function notifyComplete() {
        const detail = { success: true, filename };
        window.dispatchEvent(new CustomEvent('muxaro:direct-complete', { detail }));
        window.postMessage({ type: 'MUXARO_DIRECT_COMPLETE', ...detail }, targetOrigin);
      }

      function notifyError(err) {
        const detail = { success: false, filename, error: String(err) };
        window.dispatchEvent(new CustomEvent('muxaro:direct-error', { detail }));
        window.postMessage({ type: 'MUXARO_DIRECT_ERROR', ...detail }, targetOrigin);
      }

      if (typeof GM_download === 'function') {
        try {
          GM_download({
            url: rawUrl,
            name: filename,
            onload: function () {
              notifyComplete();
            },
            onerror: function (err) {
              console.error('[MUXARO Direct] GM_download failed, falling back:', err);
              notifyError(err);
              triggerBrowserDownload(rawUrl, filename);
            },
            onprogress: function (progress) {
              notifyProgress(progress.loaded, progress.total);
            },
          });
        } catch (err) {
          console.error('[MUXARO Direct] GM_download threw exception:', err);
          notifyError(err);
          triggerBrowserDownload(rawUrl, filename);
        }
      } else {
        triggerBrowserDownload(rawUrl, filename);
        notifyComplete();
      }
    }

    function triggerBrowserDownload(url, filename) {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 2000);
    }
  }

  // 2. Integration on YouTube (youtube.com/watch?v=...)
  if (location.hostname.includes('youtube.com')) {
    function injectYouTubeButton() {
      if (!location.pathname.startsWith('/watch')) return;
      if (document.getElementById('muxaro-direct-yt-btn')) return;

      const actionsBar =
        document.querySelector('#actions #top-level-buttons-computed') ||
        document.querySelector('#top-row #actions') ||
        document.querySelector('#actions-inner') ||
        document.querySelector('#owner');

      if (!actionsBar) return;

      const btn = document.createElement('a');
      btn.id = 'muxaro-direct-yt-btn';
      btn.href = 'https://muxaro.pages.dev/?url=' + encodeURIComponent(location.href) + '&direct=1';
      btn.target = '_blank';
      btn.rel = 'noopener noreferrer';
      btn.title = 'Stream in Original Quality with MUXARO Direct';
      btn.innerHTML = `
        <span style="display: inline-flex; align-items: center; gap: 6px; padding: 0 16px; height: 36px; border-radius: 18px; background: linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%); color: #ffffff; font-size: 13px; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; cursor: pointer; text-decoration: none; box-shadow: 0 2px 8px rgba(79, 70, 229, 0.35); transition: transform 0.15s ease, opacity 0.15s ease;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
          </svg>
          MUXARO Direct
        </span>
      `;
      btn.onmouseenter = function () {
        btn.style.opacity = '0.92';
        btn.style.transform = 'translateY(-1px)';
      };
      btn.onmouseleave = function () {
        btn.style.opacity = '1';
        btn.style.transform = 'translateY(0)';
      };

      actionsBar.insertBefore(btn, actionsBar.firstChild);
    }

    const observer = new MutationObserver(injectYouTubeButton);
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    window.addEventListener('yt-navigate-finish', injectYouTubeButton);
    window.addEventListener('load', injectYouTubeButton);
  }
})();
