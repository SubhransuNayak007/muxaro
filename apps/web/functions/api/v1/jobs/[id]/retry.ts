/**
 * POST /api/v1/jobs/:id/retry
 * Cloudflare Edge Job Retry Handler
 */

import type { PagesFunction } from '../../_types';
import { generateRequestId, jsonResponse, optionsResponse, tryProxyUpstream } from '../../_utils';

export const onRequestOptions: PagesFunction = async () => optionsResponse();

export const onRequestPost: PagesFunction = async (context) => {
  const jobId = String(context.params?.id || '');
  const upstream = await tryProxyUpstream(context.request, context.env, `jobs/${jobId}/retry`);
  if (upstream) return upstream;

  const reqId = generateRequestId('edge_rtry_');
  return jsonResponse(
    {
      success: false,
      error: {
        code: 'ERR_JOB_NOT_FOUND',
        message: `Job ${jobId} not found on backend.`,
        userMessage: 'Job not found or processing node is disconnected.',
      },
      requestId: reqId,
    },
    404
  );
};
