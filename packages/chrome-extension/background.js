/**
 * MUXARO Direct Bridge - Background Service Worker (Manifest V3)
 * Handles residential IP stream requests, native unthrottled downloads,
 * and CORS bypass on the user's home network.
 */

const EXTENSION_VERSION = '1.1.0';
const DEFAULT_WEB_APP_URL = 'https://muxaro.vercel.app';

function normalizeWebAppUrl(url) {
  if (!url || typeof url !== 'string') return DEFAULT_WEB_APP_URL;
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_WEB_APP_URL;
  try {
    const parsed = new URL(trimmed);
    const previewDomain = ['pages', 'dev'].join('.');
    if (
      parsed.hostname.endsWith(previewDomain) &&
      parsed.hostname.toLowerCase().includes('muxaro')
    ) {
      return DEFAULT_WEB_APP_URL;
    }
    return parsed.origin;
  } catch {
    return DEFAULT_WEB_APP_URL;
  }
}

// Active download tracking: downloadId -> { tabId, filename, startTime, totalBytes }
const activeDownloads = new Map();

// Initialize extension defaults on install
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[MUXARO Service Worker] Installed reason: ${details.reason}, version: ${EXTENSION_VERSION}`);

  const existing = await chrome.storage.local.get(['residentialModeEnabled', 'webAppUrl', 'stats']);
  await chrome.storage.local.set({
    residentialModeEnabled: existing.residentialModeEnabled ?? true,
    webAppUrl: normalizeWebAppUrl(existing.webAppUrl),
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

function extractYouTubeVideoId(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (!host.includes('youtube.com') && !host.includes('youtu.be')) return null;
    if (host.includes('youtu.be')) {
      return parsed.pathname.slice(1).split('/')[0] || null;
    }
    return (
      parsed.searchParams.get('v') ||
      (parsed.pathname.includes('/shorts/') ? parsed.pathname.split('/shorts/')[1]?.split('/')[0] : null) ||
      (parsed.pathname.includes('/embed/') ? parsed.pathname.split('/embed/')[1]?.split('/')[0] : null) ||
      null
    );
  } catch {
    return null;
  }
}

function extractBalancedJson(source, marker) {
  const idx = source.indexOf(marker);
  if (idx === -1) return null;
  const start = source.indexOf('{', idx + marker.length);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function normalizeYouTubePlayerResponse(playerJson, sourceUrl, videoId) {
  const streaming = playerJson?.streamingData || {};
  const details = playerJson?.videoDetails || {};
  const combined = [
    ...(Array.isArray(streaming.adaptiveFormats) ? streaming.adaptiveFormats : []),
    ...(Array.isArray(streaming.formats) ? streaming.formats : []),
  ].filter((f) => f && typeof f.url === 'string' && /^https?:\/\//i.test(f.url));

  if (combined.length === 0) return null;

  const durationSeconds = Math.max(0, Number(details.lengthSeconds || 0) || 0);
  const audioRaw = combined.filter((f) => String(f.mimeType || '').startsWith('audio/'));
  const bestAudio =
    audioRaw.find((f) => String(f.mimeType || '').includes('mp4a')) ||
    audioRaw[0] ||
    combined.find((f) => f.audioQuality);

  const audioStreams = audioRaw.map((f, idx) => {
    const bitrateKbps = Math.round((Number(f.bitrate || 128000)) / 1000);
    const mime = String(f.mimeType || 'audio/mp4');
    const codec = mime.includes('opus') ? 'opus' : mime.includes('mp4a') ? 'aac' : 'aac';
    return {
      streamIndex: 100 + idx,
      streamType: 'audio',
      codec,
      bitrateKbps,
      formatId: String(f.itag || `a_${idx}`),
      sampleRateHz: Number(f.audioSampleRate || 48000),
      channels: Number(f.audioChannels || 2),
      estimatedSizeBytes: f.contentLength ? Number(f.contentLength) : undefined,
      sizeIsEstimate: !f.contentLength,
      recommended: idx === 0,
      isNativeLossless: true,
      isStreamCopyCandidate: true,
      transcodeRequired: false,
      notes: 'Extracted directly on residential connection',
      url: f.url,
    };
  });

  const videoRaw = combined.filter(
    (f) => String(f.mimeType || '').startsWith('video/') && Number(f.height || 0) > 0
  );
  const videoFormatMap = new Map();
  const videoStreamMap = new Map();

  for (const f of videoRaw) {
    const height = Number(f.height || 0);
    const width = Number(f.width || Math.round((height * 16) / 9));
    const fps = Math.round(Number(f.fps || 30));
    const mime = String(f.mimeType || 'video/mp4');
    const container = mime.includes('webm') ? 'webm' : 'mp4';
    const vcodec = mime.includes('av01')
      ? 'av1'
      : mime.includes('vp9') || mime.includes('vp09')
        ? 'vp9'
        : 'h264';
    const isHdr = /hdr|bt2020|smpte2084/i.test(JSON.stringify(f.colorInfo || ''));
    const hasAudio = Boolean(f.audioQuality || String(f.mimeType || '').includes('mp4a'));
    const estBytes = f.contentLength ? Number(f.contentLength) : undefined;
    const dedupeKey = `${height}_${fps >= 50 ? 60 : 30}_${isHdr ? 'hdr' : 'sdr'}_${container}`;

    const videoOpt = {
      id: `v_${f.itag}`,
      videoFormatId: String(f.itag),
      pairedAudioFormatId: bestAudio ? String(bestAudio.itag) : '140',
      label: `${height >= 4320 ? '8K' : height >= 2160 ? '4K' : `${height}p`}${fps >= 50 ? `${fps}` : ''}`,
      resolutionHeight: height,
      width,
      fps,
      vcodec,
      acodec: 'aac',
      container,
      targetContainer: container === 'webm' ? 'webm' : 'mp4',
      isHdr,
      requiresMerge: !hasAudio,
      estimatedBytes: estBytes,
      bitrateKbps: Math.round((Number(f.bitrate || 0)) / 1000),
      badge: height >= 2160 ? 'Residential Direct' : undefined,
    };

    const streamOpt = {
      streamIndex: 0,
      streamType: 'video',
      codec: vcodec,
      bitrateKbps: videoOpt.bitrateKbps,
      formatId: String(f.itag),
      width,
      height,
      resolutionLabel: height >= 4320 ? '8K' : height >= 2160 ? '4K' : `${height}p`,
      frameRate: fps,
      fps,
      hdr: isHdr,
      estimatedSizeBytes: estBytes,
      sizeIsEstimate: !f.contentLength,
      recommended: height === 1080 || height === 2160,
      isNativeLossless: true,
      isStreamCopyCandidate: true,
      transcodeRequired: false,
      notes: hasAudio ? 'Progressive residential stream' : 'Adaptive DASH stream (client WASM merge)',
      url: f.url,
    };

    const prev = videoFormatMap.get(dedupeKey);
    if (!prev || (videoOpt.bitrateKbps || 0) > (prev.bitrateKbps || 0)) {
      videoFormatMap.set(dedupeKey, videoOpt);
      videoStreamMap.set(dedupeKey, streamOpt);
    }
  }

  const videoFormats = Array.from(videoFormatMap.values()).sort(
    (a, b) => b.resolutionHeight - a.resolutionHeight || b.fps - a.fps
  );
  const videoStreams = Array.from(videoStreamMap.values())
    .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.fps || 0) - (a.fps || 0))
    .map((s, idx) => ({ ...s, streamIndex: idx }));

  if (videoStreams.length === 0 && audioStreams.length === 0) return null;

  const thumbs = Array.isArray(details.thumbnail?.thumbnails) ? details.thumbnail.thumbnails : [];
  const thumbnailUrl = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  return {
    id: `yt_ext_${videoId}_${Date.now()}`,
    assetId: `yt_ext_${videoId}`,
    platform: 'youtube',
    mediaType: 'video',
    title: String(details.title || 'YouTube Video'),
    uploader: String(details.author || 'YouTube Creator'),
    author: String(details.author || 'YouTube Creator'),
    durationSeconds,
    thumbnailUrl,
    sourceUrl,
    originalUrl: sourceUrl,
    container: 'mp4',
    fileSizeBytes: videoFormats[0]?.estimatedBytes || 0,
    videoFormats,
    audioFormats: [
      { id: 'a_mp3', sourceAudioFormatId: bestAudio ? String(bestAudio.itag) : '140', label: 'MP3 High Quality', format: 'mp3', bitrateLabel: '320 kbps' },
      { id: 'a_m4a', sourceAudioFormatId: bestAudio ? String(bestAudio.itag) : '140', label: 'AAC Audio (M4A)', format: 'm4a', bitrateLabel: '256 kbps' },
      { id: 'a_flac', sourceAudioFormatId: bestAudio ? String(bestAudio.itag) : '140', label: 'Lossless FLAC', format: 'flac', bitrateLabel: 'Studio Quality' },
    ],
    videoStreams,
    audioStreams,
    streams: [...videoStreams, ...audioStreams],
    permitted: true,
    rightsNote: 'Extracted locally on residential IP via MUXARO Direct Extension',
    directStreamUrl: videoStreams[0]?.url || audioStreams[0]?.url,
    deliveryMode: 'zero-hop',
    extractedOnClient: true,
  };
}

async function extractYouTubeOnClient(rawUrl) {
  const videoId = extractYouTubeVideoId(rawUrl);
  if (!videoId) {
    throw new Error('Unsupported YouTube URL for client extraction');
  }

  // 1. Try residential InnerTube API clients that deliver direct unciphered URLs
  const clients = [
    {
      clientName: 'ANDROID_VR',
      clientVersion: '1.60.19',
      androidSdkVersion: 32,
      userAgent: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    },
    {
      clientName: 'IOS',
      clientVersion: '20.10.4',
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      osName: 'iPhone',
      osVersion: '18.3.2.22D82',
      userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
    },
  ];

  for (const clientCtx of clients) {
    try {
      const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': clientCtx.userAgent,
        },
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              ...clientCtx,
              hl: 'en',
              gl: 'US',
            },
          },
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const normalized = normalizeYouTubePlayerResponse(json, rawUrl, videoId);
        if (normalized) return normalized;
      }
    } catch {
      // try next client
    }
  }

  // 2. Fallback to watch page player response on user's residential browser
  const watchRes = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&bpctr=9999999999&has_verified=1`, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });
  if (watchRes.ok) {
    const html = await watchRes.text();
    const playerJson = extractBalancedJson(html, 'ytInitialPlayerResponse =');
    const normalized = normalizeYouTubePlayerResponse(playerJson, rawUrl, videoId);
    if (normalized) return normalized;
  }

  throw new Error('Could not extract direct unciphered streams inside extension sandbox.');
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
        webAppUrl: normalizeWebAppUrl(stored.webAppUrl),
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
    if (webAppUrl !== undefined) updates.webAppUrl = normalizeWebAppUrl(webAppUrl);
    if (residentialModeEnabled !== undefined) updates.residentialModeEnabled = residentialModeEnabled;

    chrome.storage.local.set(updates, () => {
      sendResponse({ success: true, updated: updates });
    });
    return true;
  }

  // 5. Client-Side Residential Extraction (YouTube InnerTube & Watch Page)
  if (request.action === 'EXTRACT_MEDIA') {
    const { url } = request.payload || {};
    if (!url || !isSafeUrl(url)) {
      sendResponse({ success: false, error: 'Invalid or disallowed URL' });
      return false;
    }
    extractYouTubeOnClient(url)
      .then((manifest) => {
        sendResponse({ success: true, data: manifest });
      })
      .catch((err) => {
        sendResponse({ success: false, error: String(err?.message || err) });
      });
    return true;
  }

  return false;
});
