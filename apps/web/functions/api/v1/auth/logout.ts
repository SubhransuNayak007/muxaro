/**
 * POST /api/v1/auth/logout
 * Cloudflare Edge Session Sign Out
 */

import type { PagesFunction } from '../_types';
import { generateRequestId, jsonResponse, optionsResponse } from '../_utils';

export const onRequestOptions: PagesFunction = async () => optionsResponse();

export const onRequestPost: PagesFunction = async () => {
  const reqId = generateRequestId('edge_lgt_');
  return jsonResponse(
    {
      success: true,
      data: {
        message: 'Signed out successfully from Edge session',
        sessionsRevoked: 1,
      },
      requestId: reqId,
    },
    200,
    {
      'Set-Cookie': 'muxaro_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax',
    }
  );
};
