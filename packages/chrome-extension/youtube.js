/**
 * MUXARO Direct Bridge - YouTube Integration
 * Injects a direct 1-click download button into the YouTube player action bar.
 */

(function () {
  'use strict';

  const DEFAULT_WEB_APP_URL = 'https://muxaro.vercel.app';
  const LEGACY_PREVIEW_DOMAIN = ['pages', 'dev'].join('.');
  let currentTargetAppUrl = DEFAULT_WEB_APP_URL;

  function resolveTargetAppUrl(candidate) {
    if (!candidate || typeof candidate !== 'string') return DEFAULT_WEB_APP_URL;
    const cleaned = candidate.trim().replace(/\/+$/, '');
    if (!cleaned) return DEFAULT_WEB_APP_URL;
    try {
      const parsed = new URL(cleaned);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        // Accept explicitly configured origins (production Vercel, custom domains, localhost, or legacy preview domains)
        if (parsed.hostname.endsWith('.' + LEGACY_PREVIEW_DOMAIN) && parsed.hostname.includes('muxaro')) {
          return parsed.origin;
        }
        return parsed.origin;
      }
    } catch (_) {}
    return DEFAULT_WEB_APP_URL;
  }

  // Load custom web app URL if configured in extension options
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['webAppUrl'], res => {
      if (res && res.webAppUrl) {
        currentTargetAppUrl = resolveTargetAppUrl(res.webAppUrl);
        const existingBtn = document.getElementById('muxaro-direct-yt-btn');
        if (existingBtn) {
          existingBtn.href = `${currentTargetAppUrl}/?url=${encodeURIComponent(location.href)}&direct=1`;
        }
      }
    });
  }

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
    btn.href = `${currentTargetAppUrl}/?url=${encodeURIComponent(location.href)}&direct=1`;
    btn.target = '_blank';
    btn.rel = 'noopener noreferrer';
    btn.title = 'Stream in Original Quality with MUXARO Direct';
    btn.innerHTML = `
      <span style="display: inline-flex; align-items: center; gap: 6px; padding: 0 16px; height: 36px; border-radius: 18px; background: linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%); color: #ffffff; font-size: 13px; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; cursor: pointer; text-decoration: none; box-shadow: 0 2px 8px rgba(79, 70, 229, 0.35); transition: opacity 0.15s ease, transform 0.15s ease;">
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
  setTimeout(injectYouTubeButton, 1000);
})();
