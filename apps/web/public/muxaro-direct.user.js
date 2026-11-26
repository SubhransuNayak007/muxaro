// ==UserScript==
// @name         MUXARO Direct - High-Speed Stream Downloader
// @namespace    https://muxaro.vercel.app/
// @version      1.2.0
// @description  Client-side high-speed stream downloader for MUXARO. Enables direct browser streaming with zero limits.
// @author       MUXARO Engineering
// @match        https://muxaro.vercel.app/*
// @match        *://*.vercel.app/*
// @match        https://muxaro.app/*
// @match        *://*.muxaro.app/*
// @match        http://localhost:*/*
// @match        https://localhost:*/*
// @match        http://127.0.0.1:*/*
// @match        https://127.0.0.1:*/*
// @match        https://www.youtube.com/*
// @connect      googlevideo.com
// @connect      youtube.com
// @connect      muxaro.vercel.app
// @connect      muxaro.app
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
  const DEFAULT_MUXARO_ORIGIN = 'https://muxaro.vercel.app';

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

  function getConfiguredAppOrigin() {
    try {
      if (typeof GM_getValue === 'function') {
        const saved = GM_getValue('muxaro_last_origin', DEFAULT_MUXARO_ORIGIN);
        if (saved && isAllowedOrigin(saved)) {
          return String(saved).replace(/\/+$/, '');
        }
      }
    } catch (_) {}
    return DEFAULT_MUXARO_ORIGIN;
  }

  // 1. Integration on MUXARO Web Application
  const isMuxaroHost = isAllowedOrigin(window.location.origin);

  if (isMuxaroHost) {
    try {
      if (typeof GM_setValue === 'function' && window.location.origin && window.location.origin !== 'null') {
        GM_setValue('muxaro_last_origin', window.location.origin);
      }
    } catch (_) {}

    function getSafeTargetOrigin() {
      try {
        if (typeof window !== 'undefined' && window.location.origin && window.location.origin !== 'null') {
          return window.location.origin;
        }
      } catch (_) {}
      return DEFAULT_MUXARO_ORIGIN;
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

      if (event.data.type === 'MUXARO_EXTRACT_MEDIA') {
        handleClientExtractMedia(event.data);
        return;
      }
    });

    function gmFetchJsonOrText(url, opts) {
      return new Promise(function (resolve, reject) {
        if (typeof GM_xmlhttpRequest === 'function') {
          GM_xmlhttpRequest({
            method: (opts && opts.method) || 'GET',
            url: url,
            headers: (opts && opts.headers) || {},
            data: opts && opts.body ? opts.body : undefined,
            onload: function (res) {
              if (res.status >= 200 && res.status < 300) {
                resolve(res.responseText || '');
              } else {
                reject(new Error('HTTP ' + res.status));
              }
            },
            onerror: function () {
              reject(new Error('GM_xmlhttpRequest network failure'));
            },
          });
        } else {
          fetch(url, opts)
            .then(function (r) {
              if (!r.ok) throw new Error('HTTP ' + r.status);
              return r.text();
            })
            .then(resolve)
            .catch(reject);
        }
      });
    }

    function extractBalancedJson(source, marker) {
      const idx = source.indexOf(marker);
      if (idx === -1) return null;
      const start = source.indexOf('{', idx + marker.length);
      if (start === -1) return null;
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = start; i < source.length; i++) {
        const ch = source[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(source.slice(start, i + 1)); } catch (_) { return null; }
          }
        }
      }
      return null;
    }

    function parseYouTubeVideoId(rawUrl) {
      try {
        const u = new URL(rawUrl);
        const host = u.hostname.toLowerCase();
        const isYouTubeHost = host === 'youtube.com' || host.endsWith('.youtube.com');
        const isYoutuBeHost = host === 'youtu.be' || host.endsWith('.youtu.be');
        if (!isYouTubeHost && !isYoutuBeHost) return null;
        if (isYoutuBeHost) return u.pathname.slice(1).split('/')[0] || null;
        return u.searchParams.get('v') || (u.pathname.includes('/shorts/') ? u.pathname.split('/shorts/')[1].split('/')[0] : null);
      } catch (_) {
        return null;
      }
    }

    async function handleClientExtractMedia(data) {
      const requestId = (data && data.requestId) || String(Date.now());
      const targetOrigin = getSafeTargetOrigin();
      const targetUrl = String((data && data.url) || '').trim();
      const videoId = parseYouTubeVideoId(targetUrl);

      if (!videoId) {
        window.postMessage({ source: 'MUXARO_BRIDGE', type: 'EXTRACT_RESPONSE', requestId: requestId, success: false, error: 'Unsupported URL for userscript extraction' }, targetOrigin);
        return;
      }

      try {
        let playerJson = null;
        const clientConfigs = [
          { clientName: 'ANDROID_VR', clientVersion: '1.60.19', androidSdkVersion: 32, userAgent: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L) gzip' },
          { clientName: 'IOS', clientVersion: '20.10.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82', userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)' },
        ];
        for (const cfg of clientConfigs) {
          try {
            const rawText = await gmFetchJsonOrText('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'User-Agent': cfg.userAgent },
              body: JSON.stringify({ videoId: videoId, context: { client: Object.assign({}, cfg, { hl: 'en', gl: 'US' }) }, contentCheckOk: true, racyCheckOk: true }),
            });
            const parsed = JSON.parse(rawText);
            if (parsed && parsed.streamingData && (parsed.streamingData.adaptiveFormats || parsed.streamingData.formats)) {
              playerJson = parsed;
              break;
            }
          } catch (_) {}
        }

        if (!playerJson) {
          const watchHtml = await gmFetchJsonOrText('https://www.youtube.com/watch?v=' + encodeURIComponent(videoId) + '&bpctr=9999999999&has_verified=1');
          playerJson = extractBalancedJson(watchHtml, 'ytInitialPlayerResponse =');
        }

        const streaming = (playerJson && playerJson.streamingData) || {};
        const details = (playerJson && playerJson.videoDetails) || {};
        const combined = []
          .concat(Array.isArray(streaming.adaptiveFormats) ? streaming.adaptiveFormats : [])
          .concat(Array.isArray(streaming.formats) ? streaming.formats : [])
          .filter(function (f) { return f && typeof f.url === 'string' && /^https?:\/\//i.test(f.url); });

        if (!combined.length) {
          throw new Error('No unciphered client streams found');
        }

        const audioRaw = combined.filter(function (f) { return String(f.mimeType || '').startsWith('audio/'); });
        const bestAudio = audioRaw.find(function (f) { return String(f.mimeType || '').includes('mp4a'); }) || audioRaw[0];
        const audioStreams = audioRaw.map(function (f, idx) {
          const mime = String(f.mimeType || 'audio/mp4');
          return {
            streamIndex: 100 + idx,
            streamType: 'audio',
            codec: mime.includes('opus') ? 'opus' : 'aac',
            bitrateKbps: Math.round((Number(f.bitrate || 128000)) / 1000),
            formatId: String(f.itag || ('a_' + idx)),
            estimatedSizeBytes: f.contentLength ? Number(f.contentLength) : undefined,
            recommended: idx === 0,
            isNativeLossless: true,
            isStreamCopyCandidate: true,
            transcodeRequired: false,
            url: f.url,
          };
        });
        const videoStreams = combined
          .filter(function (f) { return String(f.mimeType || '').startsWith('video/') && Number(f.height || 0) > 0; })
          .map(function (f, idx) {
            const mime = String(f.mimeType || 'video/mp4');
            const h = Number(f.height || 0);
            return {
              streamIndex: idx,
              streamType: 'video',
              codec: mime.includes('av01') ? 'av1' : mime.includes('vp9') ? 'vp9' : 'h264',
              bitrateKbps: Math.round((Number(f.bitrate || 0)) / 1000),
              formatId: String(f.itag),
              width: Number(f.width || Math.round((h * 16) / 9)),
              height: h,
              resolutionLabel: h >= 4320 ? '8K' : h >= 2160 ? '4K' : h + 'p',
              fps: Math.round(Number(f.fps || 30)),
              estimatedSizeBytes: f.contentLength ? Number(f.contentLength) : undefined,
              recommended: h === 1080 || h === 2160,
              isNativeLossless: true,
              isStreamCopyCandidate: true,
              transcodeRequired: false,
              url: f.url,
            };
          })
          .sort(function (a, b) { return (b.height || 0) - (a.height || 0); });

        const manifest = {
          id: 'yt_usr_' + videoId + '_' + Date.now(),
          assetId: 'yt_usr_' + videoId,
          platform: 'youtube',
          mediaType: 'video',
          title: String(details.title || 'YouTube Video'),
          uploader: String(details.author || 'YouTube Creator'),
          durationSeconds: Number(details.lengthSeconds || 0) || 0,
          thumbnailUrl: 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg',
          sourceUrl: targetUrl,
          originalUrl: targetUrl,
          container: 'mp4',
          audioFormats: [
            { id: 'a_mp3', sourceAudioFormatId: bestAudio ? String(bestAudio.itag) : '140', label: 'MP3 High Quality', format: 'mp3', bitrateLabel: '320 kbps' },
            { id: 'a_m4a', sourceAudioFormatId: bestAudio ? String(bestAudio.itag) : '140', label: 'AAC Audio (M4A)', format: 'm4a', bitrateLabel: '256 kbps' },
          ],
          videoStreams: videoStreams,
          audioStreams: audioStreams,
          streams: videoStreams.concat(audioStreams),
          permitted: true,
          rightsNote: 'Extracted locally via MUXARO Direct Userscript',
          directStreamUrl: (videoStreams[0] && videoStreams[0].url) || (audioStreams[0] && audioStreams[0].url),
          deliveryMode: 'zero-hop',
          extractedOnClient: true,
        };

        window.postMessage({ source: 'MUXARO_BRIDGE', type: 'EXTRACT_RESPONSE', requestId: requestId, success: true, data: manifest }, targetOrigin);
      } catch (err) {
        window.postMessage({ source: 'MUXARO_BRIDGE', type: 'EXTRACT_RESPONSE', requestId: requestId, success: false, error: String((err && err.message) || err) }, targetOrigin);
      }
    }

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
  if (location.hostname === 'youtube.com' || location.hostname.endsWith('.youtube.com')) {
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
      btn.href = getConfiguredAppOrigin() + '/?url=' + encodeURIComponent(location.href) + '&direct=1';
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
