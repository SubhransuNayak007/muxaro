/**
 * GET /api/v1/media/:id
 * Cloudflare Edge Inspected Media Asset Retrieval
 * 
 * Strictly proxies to a real MUXARO backend worker.
 * NEVER returns fabricated asset manifests.
 */

import type { PagesFunction } from '../_types';
import { generateRequestId, jsonResponse, optionsResponse, tryProxyUpstream } from '../_utils';

export const onRequestOptions: PagesFunction = async () => optionsResponse();

export const onRequestGet: PagesFunction = async (context) => {
  const assetId = String(context.params?.id || '');
  const upstream = await tryProxyUpstream(context.request, context.env, `media/${assetId}`);
  if (upstream) return upstream;

  const reqId = generateRequestId('edge_med_');
  return jsonResponse(
    {
      success: false,
      error: {
        code: 'ERR_ASSET_NOT_FOUND',
        message: `Inspected asset ${assetId} not found. No active processing worker is connected to cache assets on this edge node.`,
        userMessage: 'Media asset not found or expired from cache.',
        details: {
          assetId,
          edgeRuntime: 'cloudflare-pages-functions',
          backendConnected: false,
        },
      },
      requestId: reqId,
    },
    404
  );
};
