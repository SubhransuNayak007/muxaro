import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * ==============================================================================
 * MUXARO Web Application Security Middleware (Next.js 14)
 *
 * Implements:
 * 1. Per-request cryptographic nonce generation (128-bit entropy).
 * 2. Strict Content-Security-Policy (CSP) with nonce-based script-src/style-src.
 *    - Cloudflare Turnstile integration (https://challenges.cloudflare.com).
 *    - Media CDNs (YouTube / Vimeo preview & thumbnail sources).
 * 3. Comprehensive HTTP defense headers (HSTS, X-Frame-Options, nosniff, COOP, Permissions-Policy).
 * 4. Injected 'x-nonce' request header for downstream Server Components / RootLayout.
 * ==============================================================================
 */

/**
 * Generate a cryptographically secure 16-byte random nonce encoded as base64.
 * Works seamlessly across Edge Runtime and Node.js environments.
 */
function generateCryptographicNonce(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Build a hardened, production-grade Content-Security-Policy directive set.
 */
function buildContentSecurityPolicy(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development';

  const scriptSrcDirectives = [
    `'self'`,
    `'nonce-${nonce}'`,
    `'strict-dynamic'`,
    'https://challenges.cloudflare.com',
    'https://*.ytimg.com',
    'https://i.ytimg.com',
    'https://*.vimeocdn.com',
    'https://i.vimeocdn.com',
    isDev ? `'unsafe-eval'` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const styleSrcDirectives = [
    `'self'`,
    `'nonce-${nonce}'`,
    `'unsafe-inline'`, // fallback for frameworks with dynamic inline styling
    'https://challenges.cloudflare.com',
  ].join(' ');

  const directives = [
    `default-src 'self'`,
    `script-src ${scriptSrcDirectives}`,
    `style-src ${styleSrcDirectives}`,
    `img-src 'self' blob: data: https://*.ytimg.com https://i.ytimg.com https://*.vimeocdn.com https://i.vimeocdn.com https://challenges.cloudflare.com`,
    `font-src 'self' data:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `frame-src 'self' https://challenges.cloudflare.com`,
    `connect-src 'self' https://challenges.cloudflare.com https://*.ytimg.com https://*.vimeocdn.com blob: data:`,
    `media-src 'self' blob: data: https://*.ytimg.com https://*.vimeocdn.com`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
    !isDev ? `upgrade-insecure-requests` : '',
  ];

  return directives.filter(Boolean).join('; ');
}

export function middleware(request: NextRequest): NextResponse {
  // 1. Generate unique per-request cryptographic nonce
  const nonce = generateCryptographicNonce();
  const cspHeader = buildContentSecurityPolicy(nonce);

  // 2. Clone request headers and inject nonce & CSP for layout/Server Component consumption
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', cspHeader);

  // 3. Construct NextResponse with modified request headers
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // 4. Attach hardened HTTP security headers to outgoing response
  response.headers.set('Content-Security-Policy', cspHeader);
  response.headers.set('x-nonce', nonce);

  // HTTP Strict Transport Security (HSTS): 2 years + subdomains + preload list submission
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload'
  );

  // Anti-Clickjacking: Disallow any iframe framing of MUXARO web pages
  response.headers.set('X-Frame-Options', 'DENY');

  // Prevent MIME-sniffing away from declared Content-Type
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // Strict origin referrer policy when crossing origin boundaries
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Cross-Origin-Opener-Policy (COOP): Isolate top-level browsing context
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');

  // Restrict sensitive browser hardware APIs
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=(), usb=()'
  );

  return response;
}

export const config = {
  matcher: [
    /*
     * Apply middleware to all request paths except:
     * - Next.js internal static assets (_next/static)
     * - Image optimization cache (_next/image)
     * - Favicon and static brand imagery files (.svg, .png, .jpg, .ico, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)',
  ],
};
