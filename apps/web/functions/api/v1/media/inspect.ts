/**
 * POST /api/v1/media/inspect
 * Cloudflare Edge Media Inspection Handler
 */

import type { PagesFunction } from '../_types';
import {
  generateRequestId,
  isSafePublicHttpUrl,
  jsonResponse,
  optionsResponse,
  tryProxyUpstream,
} from '../_utils';

export const onRequestOptions: PagesFunction = async (context) => optionsResponse(context.request);

export const onRequestPost: PagesFunction = async (context) => {
  const upstream = await tryProxyUpstream(context.request, context.env, 'media/inspect');
  if (upstream) return upstream;

  const reqId = generateRequestId('edge_insp_');

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse(
      {
        success: false,
        error: { code: 'ERR_INVALID_PAYLOAD', message: 'Malformed JSON payload in inspect request.' },
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
        success: false,
        error: { code: 'ERR_EMPTY_URL', message: 'Please provide a valid media link.' },
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
        success: false,
        error: {
          code: 'ERR_FORBIDDEN_URL',
          message: 'Private, local, or unsupported URL schemes are not allowed.',
        },
        requestId: reqId,
      },
      400,
      {},
      context.request
    );
  }

  try {
    const parsed = new URL(rawUrl);
    const isDirectMedia = /\.(mp4|mkv|webm|mov|mp3|m4a|wav|flac|opus|aac)($|\?)/i.test(parsed.pathname);
    if (isDirectMedia) {
      const headRes = await fetch(rawUrl, { method: 'HEAD', redirect: 'manual' });
      const contentType = headRes.headers.get('content-type') || '';
      const contentLength = parseInt(headRes.headers.get('content-length') || '0', 10);
      const filename = parsed.pathname.split('/').pop()?.split('?')[0] || 'Media file';
      const isAudio = contentType.startsWith('audio/') || /\.(mp3|m4a|wav|flac|opus|aac)$/i.test(filename);

      if (headRes.ok && !contentType.includes('text/html')) {
        return jsonResponse(
          {
            success: true,
            data: {
              id: `direct_${Date.now()}`,
              title: decodeURIComponent(filename),
              author: parsed.hostname,
              sourceUrl: rawUrl,
              fileSizeBytes: contentLength > 0 ? contentLength : undefined,
              durationSeconds: 0,
              isLive: false,
              isPlaylist: false,
              videoStreams: isAudio
                ? []
                : [
                    {
                      id: 'v_orig',
                      resolution: 'Original',
                      resolutionLabel: 'Original Quality',
                      container: 'mp4',
                      isStreamCopyCandidate: true,
                      isRecommended: true,
                    },
                  ],
              audioStreams: [
                {
                  id: 'a_orig',
                  codec: isAudio ? filename.split('.').pop()?.toLowerCase() || 'audio' : 'aac',
                  isStreamCopyCandidate: true,
                },
              ],
              adapterId: 'direct-adapter',
              extractedAt: new Date().toISOString(),
            },
            requestId: reqId,
          },
          200,
          {},
          context.request
        );
      }
    }
  } catch {
    // Fall through to honest 503
  }

  return jsonResponse(
    {
      success: false,
      error: {
        code: 'ERR_BACKEND_NOT_CONFIGURED',
        message: 'Cloud media worker is offline. Configure a custom worker in Settings to inspect remote links.',
      },
      requestId: reqId,
    },
    503,
    {},
    context.request
  );
};
