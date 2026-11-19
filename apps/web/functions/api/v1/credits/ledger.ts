/**
 * GET /api/v1/credits/ledger
 * Cloudflare Edge Credit Activity Ledger
 */

import type { PagesFunction } from '../_types';
import { generateRequestId, jsonResponse, optionsResponse, tryProxyUpstream } from '../_utils';

export const onRequestOptions: PagesFunction = async () => optionsResponse();

export const onRequestGet: PagesFunction = async (context) => {
  const upstream = await tryProxyUpstream(context.request, context.env, 'credits/ledger');
  if (upstream) return upstream;

  const reqId = generateRequestId('edge_ledg_');
  return jsonResponse({
    success: true,
    data: {
      items: [],
      total: 0,
      edgeRuntime: 'cloudflare-pages-functions',
    },
    requestId: reqId,
  });
};
