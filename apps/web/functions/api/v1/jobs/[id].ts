/**
 * GET /api/v1/jobs/:id
 * Cloudflare Edge Job Status Polling Handler
 * 
 * Strictly proxies to a real MUXARO backend worker.
 * NEVER returns fabricated job completion payloads.
 */

import type { PagesFunction } from '../_types';
import { generateRequestId, jsonResponse, optionsResponse, tryProxyUpstream } from '../_utils';

export const onRequestOptions: PagesFunction = async () => optionsResponse();

export const onRequestGet: PagesFunction = async (context) => {
  const jobId = String(context.params?.id || '');
  const upstream = await tryProxyUpstream(context.request, context.env, `jobs/${jobId}`);
  if (upstream) return upstream;

  const reqId = generateRequestId('edge_job_');

  return jsonResponse(
    {
      success: false,
      error: {
        code: 'ERR_JOB_NOT_FOUND',
        message: `Job ${jobId} not found. No active processing worker is connected to track jobs on this edge node.`,
        userMessage: 'Job not found or the media processing backend is disconnected.',
        details: {
          jobId,
          edgeRuntime: 'cloudflare-pages-functions',
          backendConnected: false,
        },
      },
      requestId: reqId,
    },
    404
  );
};
