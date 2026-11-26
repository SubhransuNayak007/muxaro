/**
 * GET /api/v1/jobs/:id/download
 * Cloudflare Edge Media Download Handler
 */

import type { PagesFunction } from '../../_types';
import {
  isValidResourceId,
  jsonResponse,
  optionsResponse,
  SECURITY_API_HEADERS,
  tryProxyUpstream,
} from '../../_utils';

export const onRequestOptions: PagesFunction = async (context) => optionsResponse(context.request);

export const onRequestHead: PagesFunction = async (context) => {
  const jobId = String(context.params?.id || '');
  if (!isValidResourceId(jobId)) {
    return new Response(null, { status: 400, headers: SECURITY_API_HEADERS });
  }
  const upstream = await tryProxyUpstream(context.request, context.env, `jobs/${jobId}/download`);
  if (upstream) return upstream;
  return new Response(null, {
    status: 503,
    headers: {
      ...SECURITY_API_HEADERS,
      'Cache-Control': 'no-store',
    },
  });
};

export const onRequestGet: PagesFunction = async (context) => {
  const jobId = String(context.params?.id || '');
  if (!isValidResourceId(jobId)) {
    return jsonResponse(
      {
        success: false,
        error: {
          code: 'ERR_INVALID_JOB_ID',
          message: 'Invalid job identifier.',
        },
      },
      400,
      {},
      context.request
    );
  }

  const upstream = await tryProxyUpstream(context.request, context.env, `jobs/${jobId}/download`);
  if (upstream) return upstream;

  return jsonResponse(
    {
      success: false,
      error: {
        code: 'ERR_BACKEND_NOT_CONFIGURED',
        message:
          'Cloud media worker is offline. Configure a worker in Settings or use MUXARO browser-local tools.',
      },
    },
    503,
    {},
    context.request
  );
};
