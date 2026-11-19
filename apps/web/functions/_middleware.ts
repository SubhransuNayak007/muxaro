/**
 * Cloudflare Pages Functions Global Middleware
 * Ensures all API responses include standard CORS headers and fast-paths OPTIONS requests.
 */

import type { PagesFunction } from './api/v1/_types';
import { corsHeaders } from './api/v1/_utils';

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
};

export const onRequest: PagesFunction = async (context) => {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  const response = await context.next();
  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, val]) => {
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
