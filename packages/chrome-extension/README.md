# MUXARO Direct Bridge (Chrome Extension - Manifest V3)

> **Official browser companion for MUXARO Media Processing Platform.**  
> Provides high-speed residential IP streaming, seamless CORS bypass, and 1-click desktop direct integration for 4K and 8K media downloads.

---

## 🚀 Why MUXARO Direct Bridge?

Modern streaming CDNs (such as YouTube GoogleVideo, Instagram CDN, and TikTok) aggressively throttle or completely block datacenter cloud IPs with `403 Forbidden` errors. 

**MUXARO Direct Bridge** solves this fundamentally by adopting a **zero-cloud-cost residential streaming architecture**:
1. **Residential IP Direct Line**: Video and audio streams are fetched directly through the user's home broadband connection, completely avoiding datacenter IP blocks.
2. **CORS & Preflight Elimination**: Declarative Net Request (DNR) and extension background workers bypass strict browser CORS restrictions (`Access-Control-Allow-Origin` & `Cross-Origin-Resource-Policy`).
3. **OPFS & WASM Acceleration**: Chunks flow directly from the background service worker to the web app's Origin Private File System (OPFS) and local `ffmpeg.wasm` engine for instant remuxing with zero server roundtrips ($0 compute cost).
4. **Native Unthrottled Downloads**: Direct integration with the Chrome Downloads API ensures maximum multi-gigabit throughput.

---

## 🛠️ 1-Click Developer Installation ("Load Unpacked")

Follow these quick steps to load the extension in Google Chrome, Brave, Microsoft Edge, or any Chromium-based browser:

### Step 1: Open Extension Management
Open a new browser tab and navigate to:
```text
chrome://extensions/
```
*(In Brave, use `brave://extensions/`; in Microsoft Edge, use `edge://extensions/`)*

### Step 2: Enable Developer Mode
In the top-right corner of the Extensions page, toggle the **Developer mode** switch to **ON**.

```
[ Developer mode ]  🔘 ON
```

### Step 3: Click "Load Unpacked"
In the top-left toolbar, click the **Load unpacked** button.

### Step 4: Select Directory
In the file picker dialog, browse to your repository and select the extension directory:
```text
<project-root>/packages/chrome-extension
```

### Step 5: Pin & Verify
1. You will see **MUXARO Direct Bridge** (v1.1.0) appear in your extension list with an active status badge.
2. Click the puzzle icon in Chrome's toolbar and **pin** MUXARO Direct Bridge for easy access.
3. Open the extension popup to view connection metrics and diagnostic controls.

---

## 🏗️ Architecture & Component Overview

```
┌────────────────────────────────────────────────────────────────┐
│                       MUXARO Web App                           │
│           (muxaro.pages.dev / localhost / vercel.app)          │
│                                                                │
│   useMuxaroBridge.ts ◄───► OPFS Writer ◄───► ffmpeg.wasm      │
└──────────────────────────────┬─────────────────────────────────┘
                               │
               window.postMessage Handshake
              (PONG / CHUNK_RESPONSE / PROGRESS)
                               │
┌──────────────────────────────▼─────────────────────────────────┐
│                    content.js (Isolated World)                 │
│   - Detects MUXARO origin & sets data-muxaro-direct DOM flags │
│   - Bidirectional message router                              │
└──────────────────────────────┬─────────────────────────────────┘
                               │
                  chrome.runtime.sendMessage
                               │
┌──────────────────────────────▼─────────────────────────────────┐
│             background.js (MV3 Service Worker)                 │
│   - Residential IP Fetch (Bypasses Datacenter 403s)            │
│   - chrome.downloads API (Line-rate file writes)               │
│   - rules.json (DeclarativeNetRequest CORS header rewrite)    │
└────────────────────────────────────────────────────────────────┘
```

### Package Manifest
| File | Role |
| :--- | :--- |
| `manifest.json` | Manifest V3 specification, host permissions, and service worker registration. |
| `background.js` | Service worker managing residential IP chunk fetching and unthrottled downloads. |
| `content.js` | Bridge script communicating with the MUXARO web app via `window.postMessage`. |
| `youtube.js` | Injects 1-click "MUXARO Direct" button into YouTube watch pages. |
| `rules.json` | Declarative Net Request rules rewriting CORS and CORP headers on streaming domains. |
| `popup.html` / `popup.js` / `popup.css` | Hallmark-compliant management popup with live stats, diagnostics, and config. |
| `icons/` | Crisp vector and PNG icons in 16x16, 48x48, and 128x128 sizes. |
| `test-manifest.js` | Automated specification and integrity validation suite. |

---

## 🔌 Web App Protocol & Integration

The web app integrates with the extension via `useMuxaroBridge.ts` using a zero-race-condition handshake:

### 1. Handshake (Ping/Pong)
- **Web App**: Dispatches `{ source: 'MUXARO_APP', type: 'PING' }` and `{ type: 'MUXARO_DIRECT_PING' }`.
- **Extension (`content.js`)**: Responds with:
  ```json
  {
    "source": "MUXARO_BRIDGE",
    "type": "PONG",
    "version": "1.1.0",
    "active": true,
    "isExtension": true,
    "capabilities": ["residential-fetch", "native-download", "stream-chunks", "cors-bypass"]
  }
  ```
- **DOM Reflection**: Sets `document.documentElement.setAttribute('data-muxaro-direct', 'active')`.

### 2. Residential Stream Chunk Fetch
- **Web App**: Sends `{ source: 'MUXARO_APP', type: 'FETCH_STREAM_CHUNK', requestId: '123', url: 'https://rr1---sn.googlevideo.com/...', range: 'bytes=0-1048575' }`.
- **Extension (`background.js`)**: Fetches chunk over residential IP and returns Base64 data with HTTP 206 Partial Content headers.

### 3. Native Download Trigger
- **Web App**: Sends `{ source: 'MUXARO_APP', type: 'DOWNLOAD_STREAM', streamUrl: '...', filename: 'video.mp4' }`.
- **Extension**: Executes download through Chrome's native download manager and emits real-time progress events (`loaded`, `total`, `percent`).

---

## 🧪 Testing & Verification

Run the automated extension integrity test suite:

```bash
cd packages/chrome-extension
npm test
# or
node test-manifest.js
```

### Expected Output
```text
Running MUXARO Chrome Extension verification suite...
✓ All 8 MUXARO Chrome Extension integrity and specification checks passed!
```

---

## 🔒 Security & Privacy

- **No Remote Code Execution**: 100% compliant with Manifest V3; no `eval()`, inline event handlers, or external script loading.
- **SSRF Protection**: Content script and service worker strictly validate stream URLs, blocking link-local and cloud metadata addresses (`169.254.169.254`, `0.0.0.0`, `metadata.google.internal`).
- **Origin Isolation**: Only responds to explicit origin matches (`muxaro.pages.dev`, `vercel.app`, and `localhost`).
- **Privacy First**: Zero telemetry or personal tracking; all statistics are stored strictly in local browser storage (`chrome.storage.local`).
