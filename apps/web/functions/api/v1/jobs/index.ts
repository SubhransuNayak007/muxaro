/**
 * POST & GET /api/v1/jobs
 * Cloudflare Edge Job Creation & Dispatch Handler
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

export const onRequestGet: PagesFunction = async (context) => {
  const upstream = await tryProxyUpstream(context.request, context.env, 'jobs');
  if (upstream && upstream.ok) return upstream;

  const reqId = generateRequestId('edge_jobs_');
  return jsonResponse(
    {
      success: true,
      data: {
        jobs: [],
        total: 0,
        edgeRuntime: 'cloudflare-pages-functions',
        backendConnected: false,
      },
      requestId: reqId,
    },
    200,
    {},
    context.request
  );
};

export const onRequestPost: PagesFunction = async (context) => {
  const upstream = await tryProxyUpstream(context.request, context.env, 'jobs');
  if (upstream) return upstream;

  const reqId = generateRequestId('edge_cjob_');

  let body: any = {};
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse(
      {
        success: false,
        error: { code: 'ERR_INVALID_PAYLOAD', message: 'Malformed JSON payload.' },
        requestId: reqId,
      },
      400,
      {},
      context.request
    );
  }

  const sourceUrl = String(body?.mediaUrl || body?.sourceUrl || '').trim();
  if (sourceUrl && !isSafePublicHttpUrl(sourceUrl)) {
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

  return jsonResponse(
    {
      success: false,
      error: {
        code: 'ERR_BACKEND_NOT_CONFIGURED',
        message:
          'Cloud FFmpeg worker is not configured on this edge deployment. Run local browser Studio tools directly or connect a worker in Settings.',
      },
      requestId: reqId,
    },
    503,
    {},
    context.request
  );
};
