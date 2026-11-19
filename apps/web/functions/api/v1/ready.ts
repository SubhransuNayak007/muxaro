/**
 * GET /api/v1/ready
 * Cloudflare Edge Readiness Probe
 * 
 * Proxies to real backend worker when reachable.
 * Honestly reports 503 DEGRADED when FFmpeg backend is disconnected.
 */

import type { PagesFunction } from './_types';
import { generateRequestId, jsonResponse, optionsResponse, tryProxyUpstream } from './_utils';

export const onRequestOptions: PagesFunction = async () => optionsResponse();

export const onRequestGet: PagesFunction = async (context) => {
  const upstream = await tryProxyUpstream(context.request, context.env, 'ready');
  if (upstream) return upstream;

  const reqId = generateRequestId('edge_rdy_');
  return jsonResponse(
    {
      success: false,
      data: {
        status: 'DEGRADED',
        uptimeSeconds: 0,
        environment: 'production',
        database: 'unavailable',
        storageMode: 'edge-static',
        r2Configured: false,
        googleAuthConfigured: false,
        rewardedAdsConfigured: false,
        ffmpegAvailable: false,
        edgeRuntime: 'cloudflare-pages-functions',
        backendConnected: false,
        notice: 'Edge static assets ready. FFmpeg processing worker is offline.',
      },
      requestId: reqId,
    },
    503
  );
};
