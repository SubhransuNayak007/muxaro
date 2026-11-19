/**
 * GET /api/v1/health
 * Cloudflare Edge Liveness & Health Probe
 * 
 * Proxies to real backend worker when reachable.
 * Honestly reports degraded state when worker pool is disconnected.
 */

import type { PagesFunction } from './_types';
import { generateRequestId, jsonResponse, optionsResponse, tryProxyUpstream } from './_utils';

export const onRequestOptions: PagesFunction = async () => optionsResponse();

export const onRequestGet: PagesFunction = async (context) => {
  const upstream = await tryProxyUpstream(context.request, context.env, 'health');
  if (upstream) return upstream;

  const reqId = generateRequestId('edge_hlth_');
  return jsonResponse({
    success: true,
    data: {
      status: 'DEGRADED',
      postgres: 'DISCONNECTED',
      redis: 'DISCONNECTED',
      database: 'unavailable',
      environment: 'production',
      storageMode: 'edge-static',
      r2Configured: false,
      edgeRuntime: 'cloudflare-pages-functions',
      backendConnected: false,
      workerPool: {
        activeWorkers: 0,
        totalSlots: 0,
      },
      version: '1.0.0',
      uptimeSeconds: 0,
      notice: 'Cloudflare Pages edge is active. Media processing requires an active backend worker with FFmpeg & yt-dlp.',
    },
    requestId: reqId,
  });
};
