/**
 * GET /api/v1/jobs/:id
 * Cloudflare Edge Job Status Polling Handler
 */

import type { PagesFunction } from '../_types';
import {
  generateRequestId,
  isValidResourceId,
  jsonResponse,
  optionsResponse,
  tryProxyUpstream,
} from '../_utils';

export const onRequestOptions: PagesFunction = async (context) => optionsResponse(context.request);

export const onRequestGet: PagesFunction = async (context) => {
  const jobId = String(context.params?.id || '');
  const reqId = generateRequestId('edge_job_');

  if (!isValidResourceId(jobId)) {
    return jsonResponse(
      {
        success: false,
        error: { code: 'ERR_INVALID_JOB_ID', message: 'Invalid job identifier.' },
        requestId: reqId,
      },
      400,
      {},
      context.request
    );
  }

  const upstream = await tryProxyUpstream(context.request, context.env, `jobs/${jobId}`);
  if (upstream) return upstream;

  return jsonResponse(
    {
      success: false,
      error: {
        code: 'ERR_BACKEND_NOT_CONFIGURED',
        message: 'Cloud media worker is offline. Job status is unavailable without a connected worker.',
      },
      requestId: reqId,
    },
    503,
    {},
    context.request
  );
};
