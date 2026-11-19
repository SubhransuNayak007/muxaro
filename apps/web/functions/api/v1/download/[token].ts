/**
 * GET /api/v1/download/:token
 * Cloudflare Edge Signed Resumable Media Download Handler
 * 
 * Strictly proxies to real MUXARO storage / signed token download service.
 * NEVER returns empty fake 32-byte binary stubs.
 */

import type { PagesFunction } from '../_types';
import { jsonResponse, optionsResponse, tryProxyUpstream } from '../_utils';

export const onRequestOptions: PagesFunction = async () => optionsResponse();

export const onRequestGet: PagesFunction = async (context) => {
  const token = String(context.params?.token || '');
  const upstream = await tryProxyUpstream(context.request, context.env, `download/${token}`);
  if (upstream) return upstream;

  return jsonResponse(
    {
      success: false,
      error: {
        code: 'ERR_ARTIFACT_NOT_FOUND',
        message:
          'Media artifact not found on edge storage. Downloads are served directly by the MUXARO storage service.',
        userMessage:
          'This download link is not available on storage or the processing worker is disconnected.',
        details: {
          edgeRuntime: 'cloudflare-pages-functions',
          backendConnected: false,
        },
      },
    },
    404
  );
};
