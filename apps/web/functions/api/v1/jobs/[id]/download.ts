/**
 * GET /api/v1/jobs/:id/download
 * Cloudflare Edge Media Download Handler
 * 
 * Strictly proxies to a real MUXARO storage / download service.
 * NEVER returns empty fake 32-byte binary stubs.
 */

import type { PagesFunction } from '../../_types';
import { jsonResponse, optionsResponse, tryProxyUpstream } from '../../_utils';

export const onRequestOptions: PagesFunction = async () => optionsResponse();

export const onRequestHead: PagesFunction = async (context) => {
  const jobId = String(context.params?.id || '');
  const upstream = await tryProxyUpstream(context.request, context.env, `jobs/${jobId}/download`);
  if (upstream) return upstream;
  return new Response(null, { status: 404, headers: { 'Content-Type': 'application/json' } });
};

export const onRequestGet: PagesFunction = async (context) => {
  const jobId = String(context.params?.id || '');
  const upstream = await tryProxyUpstream(context.request, context.env, `jobs/${jobId}/download`);
  if (upstream) return upstream;

  return jsonResponse(
    {
      success: false,
      error: {
        code: 'ERR_ARTIFACT_NOT_FOUND',
        message: `Processed media artifact for job ${jobId} not found. Real binary output requires an active processing backend with storage.`,
        userMessage:
          'Media file not found. Processing was not completed on a verified FFmpeg worker node.',
        details: {
          jobId,
          edgeRuntime: 'cloudflare-pages-functions',
          backendConnected: false,
        },
      },
    },
    404
  );
};
