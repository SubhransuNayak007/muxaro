/**
 * MUXARO Direct Bridge - Extension Popup Controller
 */

const DEFAULT_WEB_APP_URL = 'https://muxaro.vercel.app';

document.addEventListener('DOMContentLoaded', async () => {
  const extVersionEl = document.getElementById('ext-version');
  const statStreamsEl = document.getElementById('stat-streams');
  const statBytesEl = document.getElementById('stat-bytes');
  const tabStatusPillEl = document.getElementById('tab-status-pill');
  const tabUrlEl = document.getElementById('tab-url');
  const webAppUrlInput = document.getElementById('web-app-url');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const btnOpenApp = document.getElementById('btn-open-app');
  const btnTestPing = document.getElementById('btn-test-ping');
  const toastEl = document.getElementById('toast');

  function showToast(message, durationMs = 2500) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');
    setTimeout(() => {
      toastEl.classList.add('hidden');
    }, durationMs);
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
  }

  // 1. Fetch Status from Service Worker
  chrome.runtime.sendMessage({ action: 'GET_STATUS' }, response => {
    if (chrome.runtime.lastError || !response) {
      console.warn('Could not contact background service worker:', chrome.runtime.lastError);
      return;
    }

    if (response.version && extVersionEl) {
      extVersionEl.textContent = `v${response.version}`;
    }

    if (webAppUrlInput && response.webAppUrl) {
      webAppUrlInput.value = response.webAppUrl;
    }

    const stats = response.stats || {};
    if (statStreamsEl) {
      statStreamsEl.textContent = String(stats.totalStreams || stats.completedDownloads || 0);
    }
    if (statBytesEl) {
      statBytesEl.textContent = formatBytes(stats.totalBytes || 0);
    }
  });

  // 2. Query Current Active Tab
  let activeTabUrl = '';
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0 && tabs[0].url) {
      activeTabUrl = tabs[0].url;
      const urlObj = new URL(activeTabUrl);
      tabUrlEl.textContent = urlObj.hostname + (urlObj.pathname.length > 20 ? urlObj.pathname.slice(0, 20) + '...' : urlObj.pathname);

      if (urlObj.hostname.includes('muxaro') || urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1') {
        tabStatusPillEl.textContent = 'CONNECTED';
        tabStatusPillEl.style.color = '#10b981';
      } else if (urlObj.hostname.includes('youtube.com')) {
        tabStatusPillEl.textContent = 'YOUTUBE DETECTED';
        tabStatusPillEl.style.color = '#38bdf8';
      } else {
        tabStatusPillEl.textContent = 'IDLE';
        tabStatusPillEl.style.color = '#94a3b8';
      }
    } else {
      tabUrlEl.textContent = 'System / New Tab';
      tabStatusPillEl.textContent = 'STANDBY';
      tabStatusPillEl.style.color = '#94a3b8';
    }
  } catch (_) {
    tabUrlEl.textContent = 'Active tab unavailable';
  }

  // 3. Save Settings
  btnSaveSettings.addEventListener('click', () => {
    const targetUrl = (webAppUrlInput.value || DEFAULT_WEB_APP_URL).trim();
    chrome.runtime.sendMessage(
      {
        action: 'UPDATE_SETTINGS',
        payload: { webAppUrl: targetUrl },
      },
      () => {
        showToast('Configuration saved.');
      }
    );
  });

  // 4. Open MUXARO Web App
  btnOpenApp.addEventListener('click', () => {
    const targetUrl = (webAppUrlInput.value || DEFAULT_WEB_APP_URL).trim();
    chrome.tabs.create({ url: targetUrl });
  });

  // 5. Test Ping Diagnostics
  btnTestPing.addEventListener('click', async () => {
    const start = performance.now();
    chrome.runtime.sendMessage({ action: 'GET_STATUS' }, res => {
      const latency = Math.round(performance.now() - start);
      if (res && res.success) {
        showToast(`Bridge OK: ${latency}ms latency • Residential Direct Active`);
      } else {
        showToast(`Bridge Ping Error: ${chrome.runtime.lastError?.message || 'No response'}`);
      }
    });
  });
});
