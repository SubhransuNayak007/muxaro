/**
 * MUXARO Zero-Wait Pipelined Stream Engine - Service Worker
 * apps/web/public/sw-stream.js
 *
 * Synthetic streaming download interceptor for browsers lacking the File System Access API
 * (Safari, Firefox, Mobile Browsers). Provides Zero-RAM direct-to-disk streaming via
 * streaming Response piping chunks straight to the browser download manager.
 */

const SW_VERSION = '1.0.0';
const STREAM_DOWNLOAD_PREFIX = '/sw-stream-download/';
const VIRTUAL_STREAM_PREFIX = '/muxaro-stream/';

/**
 * In-memory map of active streaming pipelines:
 * streamId -> {
 *   streamId: string,
 *   filename: string,
 *   mimeType: string,
 *   totalSize?: number,
 *   controller: ReadableStreamDefaultController | null,
 *   stream: ReadableStream | null,
 *   port: MessagePort | null,
 *   createdAt: number,
 *   timeoutId: any
 * }
 */
const activeStreams = new Map();

self.addEventListener('install', (event) => {
  // Activate immediately without waiting for existing tabs to close
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Message handler for client communication
 */
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  const { type, streamId } = data;

  switch (type) {
    case 'PING': {
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ type: 'PONG', version: SW_VERSION });
      } else if (event.source) {
        event.source.postMessage({ type: 'PONG', version: SW_VERSION });
      }
      break;
    }

    case 'INIT_STREAM': {
      const { filename, mimeType, totalSize } = data;
      const port = event.ports && event.ports[0] ? event.ports[0] : null;

      // Clean up any stale stream with the same ID
      if (activeStreams.has(streamId)) {
        const existing = activeStreams.get(streamId);
        clearTimeout(existing.timeoutId);
        try {
          existing.controller?.close();
        } catch (_) {}
        activeStreams.delete(streamId);
      }

      let streamController = null;
      const readableStream = new ReadableStream({
        start(controller) {
          streamController = controller;
        },
        cancel(reason) {
          if (port) {
            try {
              port.postMessage({ type: 'STREAM_CANCELLED', streamId, reason: String(reason) });
            } catch (_) {}
          }
          activeStreams.delete(streamId);
        },
      });

      // Automatically prune uncollected streams after 60 seconds
      const timeoutId = setTimeout(() => {
        if (activeStreams.has(streamId)) {
          const entry = activeStreams.get(streamId);
          try {
            entry.controller?.close();
          } catch (_) {}
          activeStreams.delete(streamId);
        }
      }, 60000);

      const entry = {
        streamId,
        filename: filename || 'video.mp4',
        mimeType: mimeType || 'application/octet-stream',
        totalSize: typeof totalSize === 'number' && totalSize > 0 ? totalSize : undefined,
        controller: streamController,
        stream: readableStream,
        port,
        createdAt: Date.now(),
        timeoutId,
      };

      activeStreams.set(streamId, entry);

      // Listen on dedicated MessagePort if provided
      if (port) {
        port.onmessage = (portEvent) => {
          handlePortMessage(streamId, portEvent.data);
        };
      }

      // Respond confirmation
      if (port) {
        port.postMessage({
          type: 'STREAM_READY',
          streamId,
          downloadUrl: `${STREAM_DOWNLOAD_PREFIX}${streamId}/${encodeURIComponent(entry.filename)}`,
        });
      } else if (event.source) {
        event.source.postMessage({
          type: 'STREAM_READY',
          streamId,
          downloadUrl: `${STREAM_DOWNLOAD_PREFIX}${streamId}/${encodeURIComponent(entry.filename)}`,
        });
      }
      break;
    }

    case 'PUSH_CHUNK': {
      const entry = activeStreams.get(streamId);
      if (entry && entry.controller && data.chunk) {
        try {
          entry.controller.enqueue(new Uint8Array(data.chunk));
        } catch (err) {
          console.error('[SW-Stream] Failed to enqueue chunk', err);
        }
      }
      break;
    }

    case 'FINISH_STREAM': {
      const entry = activeStreams.get(streamId);
      if (entry) {
        clearTimeout(entry.timeoutId);
        try {
          entry.controller?.close();
        } catch (_) {}
        activeStreams.delete(streamId);
      }
      break;
    }

    case 'ABORT_STREAM': {
      const entry = activeStreams.get(streamId);
      if (entry) {
        clearTimeout(entry.timeoutId);
        try {
          entry.controller?.error(new Error(data.reason || 'Stream aborted by client'));
        } catch (_) {}
        activeStreams.delete(streamId);
      }
      break;
    }
  }
});

function handlePortMessage(streamId, msg) {
  if (!msg || typeof msg !== 'object') return;
  const entry = activeStreams.get(streamId);
  if (!entry) return;

  switch (msg.type) {
    case 'CHUNK':
      if (entry.controller && msg.chunk) {
        try {
          entry.controller.enqueue(new Uint8Array(msg.chunk));
        } catch (e) {
          console.error('[SW-Stream] Port enqueue error', e);
        }
      }
      break;
    case 'END':
      clearTimeout(entry.timeoutId);
      try {
        entry.controller?.close();
      } catch (_) {}
      activeStreams.delete(streamId);
      break;
    case 'ERROR':
      clearTimeout(entry.timeoutId);
      try {
        entry.controller?.error(new Error(msg.reason || 'Stream error from port'));
      } catch (_) {}
      activeStreams.delete(streamId);
      break;
  }
}

/**
 * Fetch interceptor for synthetic download requests
 * Ensures virtual streaming endpoint (/sw-stream-download/* and /muxaro-stream/*)
 * operates strictly same-origin and cannot be leveraged as an open redirect or SSRF vector.
 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Security gate: only intercept same-origin download requests
  if (url.origin !== self.location.origin) {
    return;
  }

  const isStreamDownload =
    url.pathname.startsWith(STREAM_DOWNLOAD_PREFIX) ||
    url.pathname.startsWith(VIRTUAL_STREAM_PREFIX);

  if (isStreamDownload) {
    const prefix = url.pathname.startsWith(STREAM_DOWNLOAD_PREFIX)
      ? STREAM_DOWNLOAD_PREFIX
      : VIRTUAL_STREAM_PREFIX;
    const parts = url.pathname.slice(prefix.length).split('/');
    const streamId = parts[0];

    // Security check: validate streamId format to prevent path traversal or object injection
    if (!streamId || !/^[a-zA-Z0-9_-]+$/.test(streamId) || !activeStreams.has(streamId)) {
      event.respondWith(
        new Response('Stream not found or expired. Please initiate the download again.', {
          status: 404,
          statusText: 'Not Found',
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store',
          },
        })
      );
      return;
    }

    const entry = activeStreams.get(streamId);
    clearTimeout(entry.timeoutId); // Active fetch has begun; clear initialization timeout

    // Strict filename sanitization against CRLF header injection and directory traversal
    const cleanFilename = (entry.filename || 'download.mp4')
      .replace(/[\r\n\0]/g, '')
      .replace(/[/\\?%*:|"<>]/g, '_')
      .replace(/\.\.+/g, '.')
      .trim() || 'download.mp4';

    const headers = new Headers();
    headers.set('Content-Type', entry.mimeType || 'application/octet-stream');
    headers.set(
      'Content-Disposition',
      `attachment; filename="${cleanFilename}"; filename*=UTF-8''${encodeURIComponent(cleanFilename)}`
    );
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    headers.set('Pragma', 'no-cache');
    headers.set('Expires', '0');
    headers.set('X-Content-Type-Options', 'nosniff');

    if (typeof entry.totalSize === 'number' && entry.totalSize > 0) {
      headers.set('Content-Length', String(entry.totalSize));
    }

    // Stream the synthetic response (Status 200 stream, never redirects or fetches external network)
    event.respondWith(
      new Response(entry.stream, {
        status: 200,
        statusText: 'OK',
        headers,
      })
    );
  }
});
