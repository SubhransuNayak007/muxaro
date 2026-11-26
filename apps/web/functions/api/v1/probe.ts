/**
 * POST & OPTIONS /api/v1/probe
 * Cloudflare Edge Media Probe Handler
 */

import type { PagesFunction } from './_types';
import {
  generateRequestId,
  isSafePublicHttpUrl,
  jsonResponse,
  optionsResponse,
  tryProxyUpstream,
} from './_utils';

export const onRequestOptions: PagesFunction = async (context) => optionsResponse(context.request);

export const onRequestPost: PagesFunction = async (context) => {
  const upstream = await tryProxyUpstream(context.request, context.env, 'probe');
  if (upstream) return upstream;

  const reqId = generateRequestId('edge_probe_');

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse(
      {
        ok: false,
        code: 'INVALID_URL',
        status: 400,
        success: false,
        error: { code: 'INVALID_URL', message: 'Malformed JSON payload.' },
        requestId: reqId,
      },
      400,
      {},
      context.request
    );
  }

  let rawUrl = String(body?.url || '').trim();
  if (!rawUrl) {
    return jsonResponse(
      {
        ok: false,
        code: 'INVALID_URL',
        status: 400,
        success: false,
        error: { code: 'INVALID_URL', message: 'Please provide a valid media link.' },
        requestId: reqId,
      },
      400,
      {},
      context.request
    );
  }

  if (!/^https?:\/\//i.test(rawUrl)) {
    rawUrl = `https://${rawUrl}`;
  }

  if (!isSafePublicHttpUrl(rawUrl)) {
    return jsonResponse(
      {
        ok: false,
        code: 'ERR_FORBIDDEN_URL',
        status: 400,
        success: false,
        error: { code: 'ERR_FORBIDDEN_URL', message: 'Private, local, or unsupported URL schemes are not allowed.' },
        requestId: reqId,
      },
      400,
      {},
      context.request
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return jsonResponse(
      {
        ok: false,
        code: 'INVALID_URL',
        status: 400,
        success: false,
        error: { code: 'INVALID_URL', message: 'Invalid URL format.' },
        requestId: reqId,
      },
      400,
      {},
      context.request
    );
  }

  // Verified direct media file URL (safe HEAD probe without following unsafe redirects)
  const isDirectMedia = /\.(mp4|mkv|webm|mov|mp3|m4a|wav|flac|opus|aac)($|\?)/i.test(parsed.pathname);
  if (isDirectMedia) {
    try {
      const headRes = await fetch(rawUrl, { method: 'HEAD', redirect: 'manual' });
      const contentType = headRes.headers.get('content-type') || '';
      const contentLength = parseInt(headRes.headers.get('content-length') || '0', 10);
      if (headRes.ok && !contentType.includes('text/html')) {
        const filename = decodeURIComponent(parsed.pathname.split('/').pop()?.split('?')[0] || 'media');
        const ext = (filename.split('.').pop() || 'mp4').toLowerCase();
        const isAudio = contentType.startsWith('audio/') || /^(mp3|m4a|wav|flac|opus|aac)$/.test(ext);
        return jsonResponse(
          {
            success: true,
            data: {
              platform: 'direct',
              id: `direct_${Date.now()}`,
              url: rawUrl,
              sourceUrl: rawUrl,
              title: filename,
              author: parsed.hostname,
              durationSec: 0,
              durationSeconds: 0,
              isCarousel: false,
              items: [],
              formats: isAudio
                ? []
                : [
                    {
                      formatId: 'direct_original',
                      height: 0,
                      width: 0,
                      fps: 0,
                      hdr: false,
                      vcodec: 'direct',
                      ext,
                      estBytes: contentLength > 0 ? contentLength : 0,
                      requiresMux: false,
                      resolution: 'Original',
                      url: rawUrl,
                    },
                  ],
              audioFormats: isAudio
                ? [
                    {
                      formatId: 'direct_audio',
                      ext,
                      abr: 0,
                      acodec: ext,
                      estBytes: contentLength > 0 ? contentLength : 0,
                      url: rawUrl,
                    },
                  ]
                : [],
              subtitles: [],
              videoStreams: [],
              audioStreams: [],
            },
            requestId: reqId,
          },
          200,
          {},
          context.request
        );
      }
    } catch {
      // Fall through to honest worker-offline response
    }
  }

  return jsonResponse(
    {
      ok: false,
      code: 'ERR_BACKEND_NOT_CONFIGURED',
      status: 503,
      success: false,
      error: {
        code: 'ERR_BACKEND_NOT_CONFIGURED',
        message:
          'Media worker is offline. Configure a custom worker in Settings or use browser-local Studio tools.',
      },
      requestId: reqId,
    },
    503,
    {},
    context.request
  );
};
