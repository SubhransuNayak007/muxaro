import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const CANONICAL_HOST = 'muxaro.app';

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  const host = request.headers.get('host') || '';

  // 1. Domain Consolidation (www.muxaro.app -> muxaro.app)
  // Only redirect vercel.app if ENFORCE_CUSTOM_DOMAIN=true so vercel preview & staging remains testable
  const shouldRedirectVercel = process.env.ENFORCE_CUSTOM_DOMAIN === 'true' && host.includes('muxaro.vercel.app');
  if (
    process.env.NODE_ENV === 'production' &&
    (shouldRedirectVercel || host.startsWith('www.'))
  ) {
    url.host = CANONICAL_HOST;
    url.port = '';
    url.protocol = 'https:';
    return NextResponse.redirect(url, { status: 301 });
  }

  // 2. Trailing Slash Normalization (strip trailing slashes except for root '/')
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
    return NextResponse.redirect(url, { status: 301 });
  }

  // 3. Security & Anti-Indexation Headers for Private Routes and Traps
  const response = NextResponse.next();
  const privatePrefixes = [
    '/api',
    '/account',
    '/admin',
    '/dashboard',
    '/credits',
    '/login',
    '/register',
    '/verify-email',
    '/reset-password',
    '/jobs',
    '/download',
    '/stream',
    '/archive',
  ];

  const hasPrivatePrefix = privatePrefixes.some((prefix) => url.pathname.startsWith(prefix));
  const hasTrapParams =
    url.searchParams.has('url') ||
    url.searchParams.has('v') ||
    url.searchParams.has('id') ||
    url.searchParams.has('token') ||
    url.searchParams.has('jobId');

  if (hasPrivatePrefix || hasTrapParams) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
    response.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, brand assets, etc.
     */
    '/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
