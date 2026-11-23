/**
 * MUXARO Direct Bridge - Background Service Worker (Manifest V3)
 * Handles residential IP stream requests, native unthrottled downloads,
 * and CORS bypass on the user's home network.
 */

const EXTENSION_VERSION = '1.1.0';

// Active download tracking: downloadId -> { tabId, filename, startTime, totalBytes }
const activeDownloads = new Map();

// Initialize extension defaults on install
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[MUXARO Service Worker] Installed reason: ${details.reason}, version: ${EXTENSION_VERSION}`);

  const existing = await chrome.storage.local.get(['residentialModeEnabled', 'webAppUrl', 'stats']);
  await chrome.storage.local.set({
    residentialModeEnabled: existing.residentialModeEnabled ?? true,
    webAppUrl: existing.webAppUrl || 'https://muxaro.pages.dev',
    stats: existing.stats || {
      totalStreams: 0,
      totalBytes: 0,
      completedDownloads: 0,
      lastActive: Date.now(),
    },
    version: EXTENSION_VERSION,
  });

  // Verify Declarative Net Request rules
  if (chrome.declarativeNetRequest) {
    try {
      const enabledRules = await chrome.declarativeNetRequest.getEnabledRulesets();
      console.log('[MUXARO Service Worker] Active DNR rulesets:', enabledRules);
    } catch (e) {
      console.warn('[MUXARO Service Worker] Failed to query DNR rulesets:', e);
    }
  }
});

// Update badge status based on connection state
function updateBadge(status) {
  if (!chrome.action) return;
  if (status === 'active') {
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' }); // Emerald 500
  } else if (status === 'busy') {
    chrome.action.setBadgeText({ text: 'DL' });
    chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' }); // Blue 500
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Ensure active badge on startup
updateBadge('active');

// Monitor downloads for progress and completion
if (chrome.downloads && chrome.downloads.onChanged) {
  chrome.downloads.onChanged.addListener(async (delta) => {
    const tracked = activeDownloads.get(delta.id);
    if (!tracked) return;

    if (delta.state) {
      if (delta.state.current === 'complete') {
        console.log(`[MUXARO Service Worker] Download complete: ${tracked.filename} (#${delta.id})`);

        // Record stats
        try {
          const stored = await chrome.storage.local.get(['stats']);
          const stats = stored.stats || { totalStreams: 0, totalBytes: 0, completedDownloads: 0 };
          stats.completedDownloads = (stats.completedDownloads || 0) + 1;
          stats.lastActive = Date.now();
          await chrome.storage.local.set({ stats });
        } catch (_) {}

        if (tracked.tabId) {
          chrome.tabs.sendMessage(tracked.tabId, {
            type: 'DOWNLOAD_COMPLETE',
            downloadId: delta.id,
            filename: tracked.filename,
          }).catch(() => {});
        }

        activeDownloads.delete(delta.id);
        if (activeDownloads.size === 0) updateBadge('active');
      } else if (delta.state.current === 'interrupted') {
        const errorMsg = delta.error ? delta.error.current : 'Download interrupted';
        console.warn(`[MUXARO Service Worker] Download interrupted: ${tracked.filename} - ${errorMsg}`);

        if (tracked.tabId) {
          chrome.tabs.sendMessage(tracked.tabId, {
            type: 'DOWNLOAD_ERROR',
            downloadId: delta.id,
            filename: tracked.filename,
            error: errorMsg,
          }).catch(() => {});
        }

        activeDownloads.delete(delta.id);
        if (activeDownloads.size === 0) updateBadge('active');
      }
    }

    // Report progress if totalBytes is known
    if (delta.totalBytes && delta.totalBytes.current > 0) {
      tracked.totalBytes = delta.totalBytes.current;
    }
  });
}

// Periodic progress polling for active Chrome downloads
setInterval(async () => {
  if (activeDownloads.size === 0) return;

  for (const [downloadId, meta] of activeDownloads.entries()) {
    try {
      const items = await chrome.downloads.search({ id: downloadId });
      if (items && items.length > 0) {
        const item = items[0];
        const loaded = item.bytesReceived || 0;
        const total = item.totalBytes > 0 ? item.totalBytes : meta.totalBytes || 0;
        const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;

        if (meta.tabId) {
          chrome.tabs.sendMessage(meta.tabId, {
            type: 'DOWNLOAD_PROGRESS',
            downloadId: downloadId,
            filename: meta.filename,
            loaded: loaded,
            total: total,
            percent: percent,
          }).catch(() => {});
        }
      }
    } catch (_) {}
  }
}, 500);

// Helper: Convert ArrayBuffer to Base64
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// SSRF validation for incoming URLs
function isSafeUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    if (
      host === '169.254.169.254' ||
      host === '0.0.0.0' ||
      host === 'metadata.google.internal'
    ) {
      return false;
    }
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Primary Message Handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || !request.action) return false;

  const tabId = sender.tab ? sender.tab.id : null;

  // 1. Native Download Trigger via Chrome Downloads API
  if (request.action === 'DOWNLOAD_STREAM') {
    const { url, filename, headers } = request.payload || {};

    if (!url || !isSafeUrl(url)) {
      sendResponse({ success: false, error: 'Disallowed or invalid stream URL' });
      return false;
    }

    const safeFilename = filename || 'muxaro_media.mp4';

    chrome.downloads.download(
      {
        url: url,
        filename: safeFilename,
        conflictAction: 'uniquify',
        saveAs: false,
      },
      (downloadId) => {
        if (chrome.runtime.lastError || !downloadId) {
          const err = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Failed to start download';
          console.error('[MUXARO Service Worker] chrome.downloads error:', err);
          sendResponse({ success: false, error: err });
          return;
        }

        activeDownloads.set(downloadId, {
          tabId: tabId,
          filename: safeFilename,
          startTime: Date.now(),
          totalBytes: 0,
        });

        updateBadge('busy');
        sendResponse({ success: true, downloadId: downloadId, filename: safeFilename });
      }
    );

    return true; // Asynchronous sendResponse
  }

  // 2. Residential Stream Chunk Fetch (CORS Bypass for OPFS & WASM workers)
  if (request.action === 'FETCH_CHUNK') {
    const { url, range, headers = {} } = request.payload || {};

    if (!url || !isSafeUrl(url)) {
      sendResponse({ success: false, error: 'Disallowed or invalid stream URL' });
      return false;
    }

    const fetchHeaders = new Headers(headers);
    if (range) {
      fetchHeaders.set('Range', range);
    }

    // Fetch chunk on user's residential IP network
    fetch(url, {
      method: 'GET',
      headers: fetchHeaders,
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
    })
      .then(async (response) => {
        const status = response.status;
        const ok = response.ok || status === 206;

        if (!ok) {
          sendResponse({
            success: false,
            status: status,
            statusText: response.statusText,
            error: `Upstream HTTP ${status}: ${response.statusText}`,
          });
          return;
        }

        const arrayBuffer = await response.arrayBuffer();
        const base64Data = arrayBufferToBase64(arrayBuffer);

        const responseHeaders = {};
        for (const [k, v] of response.headers.entries()) {
          responseHeaders[k] = v;
        }

        // Increment stats
        try {
          const stored = await chrome.storage.local.get(['stats']);
          const stats = stored.stats || { totalStreams: 0, totalBytes: 0, completedDownloads: 0 };
          stats.totalBytes = (stats.totalBytes || 0) + arrayBuffer.byteLength;
          stats.totalStreams = (stats.totalStreams || 0) + 1;
          stats.lastActive = Date.now();
          await chrome.storage.local.set({ stats });
        } catch (_) {}

        sendResponse({
          success: true,
          status: status,
          statusText: response.statusText,
          headers: responseHeaders,
          byteLength: arrayBuffer.byteLength,
          data: base64Data,
        });
      })
      .catch((err) => {
        console.error('[MUXARO Service Worker] Residential chunk fetch error:', err);
        sendResponse({
          success: false,
          error: String(err.message || err),
        });
      });

    return true; // Asynchronous sendResponse
  }

  // 3. Status Query
  if (request.action === 'GET_STATUS') {
    chrome.storage.local.get(['residentialModeEnabled', 'webAppUrl', 'stats'], (stored) => {
      sendResponse({
        success: true,
        version: EXTENSION_VERSION,
        residentialMode: stored.residentialModeEnabled ?? true,
        webAppUrl: stored.webAppUrl || 'https://muxaro.pages.dev',
        activeDownloadsCount: activeDownloads.size,
        stats: stored.stats || {},
      });
    });
    return true;
  }

  // 4. Update Settings
  if (request.action === 'UPDATE_SETTINGS') {
    const { webAppUrl, residentialModeEnabled } = request.payload || {};
    const updates = {};
    if (webAppUrl !== undefined) updates.webAppUrl = webAppUrl;
    if (residentialModeEnabled !== undefined) updates.residentialModeEnabled = residentialModeEnabled;

    chrome.storage.local.set(updates, () => {
      sendResponse({ success: true, updated: updates });
    });
    return true;
  }

  return false;
});
