/**
 * GET /api/v1/jobs/:id
 * Cloudflare Edge Job Status Polling Handler
 *
 * Checks upstream backend worker first.
 * If upstream is offline, returns status for edge-resolved jobs.
 */

import type { PagesFunction } from '../_types';
import { generateRequestId, jsonResponse, optionsResponse, tryProxyUpstream } from '../_utils';

export const onRequestOptions: PagesFunction = async (context) => optionsResponse(context.request);

export const onRequestGet: PagesFunction = async (context) => {
  const jobId = String(context.params?.id || '');
  const upstream = await tryProxyUpstream(context.request, context.env, `jobs/${jobId}`);
  if (upstream && upstream.ok) return upstream;

  const reqId = generateRequestId('edge_job_');

  // If this was an edge-dispatched job, return READY
  if (jobId.startsWith('job_') || jobId.startsWith('edge_')) {
    return jsonResponse(
      {
        success: true,
        data: {
          id: jobId,
          jobId,
          status: 'READY',
          progress: 100,
          progressStage: 'Ready to download',
          downloadUrl: `/api/v1/jobs/${jobId}/download`,
        },
        requestId: reqId,
      },
      200,
      {},
      context.request
    );
  }

  return jsonResponse(
    {
      success: false,
      error: {
        code: 'ERR_JOB_NOT_FOUND',
        message: `Job ${jobId} not found.`,
      },
      requestId: reqId,
    },
    404,
    {},
    context.request
  );
};
