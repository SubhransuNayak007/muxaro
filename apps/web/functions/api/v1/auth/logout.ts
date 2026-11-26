/**
 * POST /api/v1/auth/logout
 * Cloudflare Edge Session Sign Out
 */

import type { PagesFunction } from '../_types';
import { generateRequestId, jsonResponse, optionsResponse, tryProxyUpstream } from '../_utils';

export const onRequestOptions: PagesFunction = async (context) => optionsResponse(context.request);

export const onRequestPost: PagesFunction = async (context) => {
  const upstream = await tryProxyUpstream(context.request, context.env, 'auth/logout');
  const isHttps = context.request.url.startsWith('https://');
  const secureAttr = isHttps ? '; Secure' : '';

  if (upstream) {
    const headers = new Headers(upstream.headers);
    headers.append(
      'Set-Cookie',
      `muxaro_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secureAttr}`
    );
    headers.append(
      'Set-Cookie',
      `muxaro_csrf=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax${secureAttr}`
    );
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  }

  const reqId = generateRequestId('edge_lgt_');
  const headers = new Headers();
  headers.append(
    'Set-Cookie',
    `muxaro_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secureAttr}`
  );
  headers.append(
    'Set-Cookie',
    `muxaro_csrf=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax${secureAttr}`
  );

  const resp = jsonResponse(
    {
      success: true,
      data: {
        message: 'Signed out successfully',
        sessionsRevoked: 1,
      },
      requestId: reqId,
    },
    200,
    {},
    context.request
  );
  headers.forEach((v, k) => resp.headers.append(k, v));
  return resp;
};
