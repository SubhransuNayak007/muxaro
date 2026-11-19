/**
 * Cloudflare Pages Functions Global Middleware
 * Ensures all API responses include standard CORS headers and fast-paths OPTIONS requests.
 */

import type { PagesFunction } from './api/v1/_types';
import { corsHeaders, getCorsHeaders } from './api/v1/_utils';

export const onRequestOptions: PagesFunction = async (context) => {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(context.request),
  });
};

export const onRequest: PagesFunction = async (context) => {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(context.request),
    });
  }

  const response = await context.next();
  const newHeaders = new Headers(response.headers);
  const dynamicCors = getCorsHeaders(context.request);
  Object.entries(dynamicCors).forEach(([key, val]) => {
    if (
      key.toLowerCase() === 'access-control-allow-origin' &&
      newHeaders.has('access-control-allow-origin') &&
      newHeaders.get('access-control-allow-origin') !== '*'
    ) {
      return;
    }
    if (!newHeaders.has(key)) {
      newHeaders.set(key, val);
    }
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
};
