/**
 * GET /api/v1/jobs/:id/download
 * Cloudflare Edge Media Download Handler
 *
 * Checks upstream backend worker first.
 * If upstream is offline, handles direct download or redirects to media stream.
 */

import type { PagesFunction } from '../../_types';
import { jsonResponse, optionsResponse, tryProxyUpstream } from '../../_utils';

export const onRequestOptions: PagesFunction = async (context) => optionsResponse(context.request);

export const onRequestHead: PagesFunction = async (context) => {
  const jobId = String(context.params?.id || '');
  const upstream = await tryProxyUpstream(context.request, context.env, `jobs/${jobId}/download`);
  if (upstream && upstream.ok) return upstream;
  return new Response(null, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
};

export const onRequestGet: PagesFunction = async (context) => {
  const jobId = String(context.params?.id || '');
  const upstream = await tryProxyUpstream(context.request, context.env, `jobs/${jobId}/download`);
  if (upstream && upstream.ok) return upstream;

  const reqUrl = new URL(context.request.url);
  const targetUrl = reqUrl.searchParams.get('url');
  if (targetUrl) {
    try {
      const decoded = decodeURIComponent(targetUrl);
      if (/^https?:\/\//i.test(decoded)) {
        return Response.redirect(decoded, 302);
      }
    } catch {}
  }

  return jsonResponse(
    {
      success: false,
      error: {
        code: 'ERR_ARTIFACT_NOT_FOUND',
        message: `Processed media artifact for job ${jobId} not found.`,
      },
    },
    404,
    {},
    context.request
  );
};
