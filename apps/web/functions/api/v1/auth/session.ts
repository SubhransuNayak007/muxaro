/**
 * GET /api/v1/auth/session
 * Cloudflare Edge Session Verification
 */

import type { PagesFunction } from '../_types';
import {
  generateRequestId,
  jsonResponse,
  optionsResponse,
  parseCookies,
  tryProxyUpstream,
} from '../_utils';

export const onRequestOptions: PagesFunction = async () => optionsResponse();

export const onRequestGet: PagesFunction = async (context) => {
  const upstream = await tryProxyUpstream(context.request, context.env, 'auth/session');
  if (upstream) return upstream;

  const reqId = generateRequestId('edge_sess_');
  const cookies = parseCookies(context.request.headers.get('Cookie'));
  const csrfToken = cookies['muxaro_csrf'] || crypto.randomUUID().replace(/-/g, '');

  const authPayload = {
    authenticated: false,
    user: null,
    csrfToken,
    googleAuthConfigured: false,
    edgeRuntime: 'cloudflare-pages-functions',
  };

  return jsonResponse(
    {
      success: true,
      ...authPayload,
      data: authPayload,
      requestId: reqId,
    },
    200,
    {
      'Set-Cookie': `muxaro_csrf=${csrfToken}; Path=/; SameSite=Lax; Max-Age=2592000`,
    }
  );
};
