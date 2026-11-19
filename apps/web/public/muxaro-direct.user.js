// ==UserScript==
// @name         MUXARO Direct - High-Speed Stream Downloader & Bot Bypass
// @namespace    https://muxaro.pages.dev/
// @version      1.0.0
// @description  Bypasses datacenter bot challenges and AWS bandwidth limits by streaming directly via your residential browser connection. 100% Free, Private, and Zero-Cost.
// @author       MUXARO Engineering
// @match        https://muxaro.pages.dev/*
// @match        http://localhost:*/*
// @match        http://127.0.0.1:*/*
// @match        https://www.youtube.com/*
// @connect      googlevideo.com
// @connect      youtube.com
// @connect      muxaro.pages.dev
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const MUXARO_VERSION = '1.0.0';

  // 1. Integration on MUXARO Web Application (muxaro.pages.dev / localhost)
  if (
    location.hostname === 'muxaro.pages.dev' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1'
  ) {
    function injectMuxaroBridge() {
      try {
        window.__MUXARO_DIRECT_ACTIVE__ = true;
        window.__MUXARO_DIRECT_VERSION__ = MUXARO_VERSION;
        document.documentElement.setAttribute('data-muxaro-direct', 'active');
        document.documentElement.setAttribute('data-muxaro-version', MUXARO_VERSION);

        // Notify client app
        window.dispatchEvent(
          new CustomEvent('muxaro:direct-ready', {
            detail: { version: MUXARO_VERSION, active: true },
          })
        );
      } catch (err) {
        console.warn('[MUXARO Direct] Failed to inject bridge:', err);
      }
    }

    injectMuxaroBridge();
    document.addEventListener('DOMContentLoaded', injectMuxaroBridge);
    window.addEventListener('load', injectMuxaroBridge);

    // Periodic heartbeat to ensure state persists across Next.js client-side navigations
    setInterval(injectMuxaroBridge, 1000);

    // Listen for direct download triggers from MUXARO UI
    window.addEventListener('muxaro:direct-download', function (event) {
      const data = event.detail;
      if (!data || !data.streamUrl) {
        console.warn('[MUXARO Direct] Missing streamUrl in direct-download event:', data);
        return;
      }

      const filename = data.filename || 'media_download.mp4';
      console.log('[MUXARO Direct] Initiating direct residential stream download for:', filename);

      if (typeof GM_download === 'function') {
        GM_download({
          url: data.streamUrl,
          name: filename,
          onload: function () {
            window.dispatchEvent(
              new CustomEvent('muxaro:direct-complete', {
                detail: { success: true, filename: filename },
              })
            );
          },
          onerror: function (err) {
            console.error('[MUXARO Direct] GM_download failed, falling back:', err);
            triggerBrowserDownload(data.streamUrl, filename);
          },
          onprogress: function (progress) {
            window.dispatchEvent(
              new CustomEvent('muxaro:direct-progress', {
                detail: {
                  loaded: progress.loaded,
                  total: progress.total,
                  percent: progress.total ? Math.round((progress.loaded / progress.total) * 100) : 0,
                },
              })
            );
          },
        });
      } else {
        triggerBrowserDownload(data.streamUrl, filename);
      }
    });

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
      btn.title = 'Download in Original Quality with MUXARO (Zero Limits)';
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

    // Run on navigation and DOM mutations in YouTube SPA
    const observer = new MutationObserver(injectYouTubeButton);
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    window.addEventListener('yt-navigate-finish', injectYouTubeButton);
    window.addEventListener('load', injectYouTubeButton);
  }
})();
