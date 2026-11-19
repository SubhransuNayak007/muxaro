/**
 * GET /api/v1/account/history
 * Cloudflare Edge User Job History
 */

import type { PagesFunction } from '../_types';
import { generateRequestId, jsonResponse, optionsResponse, tryProxyUpstream } from '../_utils';

export const onRequestOptions: PagesFunction = async () => optionsResponse();

export const onRequestGet: PagesFunction = async (context) => {
  const upstream = await tryProxyUpstream(context.request, context.env, 'account/history');
  if (upstream) return upstream;

  const reqId = generateRequestId('edge_hist_');
  const url = new URL(context.request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10) || 20));

  return jsonResponse({
    success: true,
    data: {
      total: 0,
      page,
      limit,
      jobs: [],
      edgeRuntime: 'cloudflare-pages-functions',
    },
    requestId: reqId,
  });
};
