/**
 * GET & OPTIONS /api/v1/jobs/:id/events
 * Cloudflare Edge SSE Real-Time Job Progress Handler
 */

import type { PagesFunction } from '../../_types';
import {
  generateRequestId,
  isValidResourceId,
  jsonResponse,
  optionsResponse,
  tryProxyUpstream,
} from '../../_utils';

export const onRequestOptions: PagesFunction = async (context) => optionsResponse(context.request);

export const onRequestGet: PagesFunction = async (context) => {
  const jobId = String(context.params?.id || '');
  if (!isValidResourceId(jobId)) {
    return jsonResponse(
      {
        success: false,
        error: { code: 'ERR_INVALID_JOB_ID', message: 'Invalid job identifier.' },
        requestId: generateRequestId('edge_sse_'),
      },
      400,
      {},
      context.request
    );
  }

  const upstream = await tryProxyUpstream(context.request, context.env, `jobs/${jobId}/events`);
  if (upstream) return upstream;

  return jsonResponse(
    {
      success: false,
      error: {
        code: 'ERR_BACKEND_NOT_CONFIGURED',
        message: 'Cloud media worker is offline; live job events are unavailable.',
      },
      requestId: generateRequestId('edge_sse_'),
    },
    503,
    {},
    context.request
  );
};
