/**
 * POST & GET /api/v1/jobs
 * Cloudflare Edge Job Creation & Dispatch Handler
 * 
 * Strictly proxies to a real MUXARO backend worker with FFmpeg.
 * NEVER fabricates fake completed jobs or artificial processing states.
 */

import type { PagesFunction } from '../_types';
import {
  generateRequestId,
  jsonResponse,
  optionsResponse,
  tryProxyUpstream,
} from '../_utils';

export const onRequestOptions: PagesFunction = async () => optionsResponse();

export const onRequestGet: PagesFunction = async (context) => {
  const upstream = await tryProxyUpstream(context.request, context.env, 'jobs');
  if (upstream) return upstream;

  const reqId = generateRequestId('edge_jobs_');
  return jsonResponse({
    success: true,
    data: {
      jobs: [],
      total: 0,
      edgeRuntime: 'cloudflare-pages-functions',
      backendConnected: false,
    },
    requestId: reqId,
  });
};

export const onRequestPost: PagesFunction = async (context) => {
  const upstream = await tryProxyUpstream(context.request, context.env, 'jobs');
  if (upstream) return upstream;

  const reqId = generateRequestId('edge_cjob_');

  // Honest report: Edge runtime cannot execute FFmpeg jobs without a real backend worker node.
  return jsonResponse(
    {
      success: false,
      error: {
        code: 'ERR_BACKEND_UNAVAILABLE',
        message:
          'Media transcoding and remuxing requires an active MUXARO processing node with FFmpeg. No worker pool is currently connected to this edge instance.',
        userMessage:
          'Real media processing requires the MUXARO Fastify backend with FFmpeg. Cloudflare Pages edge cannot perform native video transcoding without a connected worker node.',
        details: {
          edgeRuntime: 'cloudflare-pages-functions',
          backendConnected: false,
          requiresFfmpeg: true,
        },
      },
      requestId: reqId,
    },
    503
  );
};
