import { NextRequest, NextResponse } from 'next/server';
import { validateMediaUrl } from '@/lib/security-validator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/svg+xml',
]);

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB limit

const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" fill="#0d1117">
  <rect width="640" height="360" fill="#161b22"/>
  <path d="M280 140 L380 180 L280 220 Z" fill="#30363d"/>
  <text x="320" y="270" font-family="system-ui, sans-serif" font-size="14" fill="#8b949e" text-anchor="middle">Preview Unavailable</text>
</svg>`;

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const rawUrl = searchParams.get('url') || searchParams.get('src') || '';

  if (!rawUrl.trim()) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'ERR_EMPTY_URL',
          message: 'Thumbnail URL parameter "url" is required.',
        },
      },
      { status: 400 }
    );
  }

  // 1. SSRF Guard
  const validation = validateMediaUrl(rawUrl);
  if (!validation.valid) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'SSRF_BLOCKED',
          message: validation.error || 'Access to restricted host is prohibited.',
        },
      },
      { status: 403 }
    );
  }

  // 2. Fetch upstream thumbnail safely with timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const upstream = await fetch(validation.normalizedUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 MUXARO/2.0',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });

    clearTimeout(timeout);

    if (!upstream.ok) {
      return new Response(FALLBACK_SVG, {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    const contentType = (upstream.headers.get('content-type') || 'image/jpeg')
      .split(';')[0]
      .trim()
      .toLowerCase();

    // Verify content-type is genuinely an image
    if (!ALLOWED_IMAGE_TYPES.has(contentType) && !contentType.startsWith('image/')) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'ERR_INVALID_CONTENT_TYPE',
            message: `Target URL returned non-image content type: ${contentType}`,
          },
        },
        { status: 415 }
      );
    }

    const contentLength = upstream.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'ERR_FILE_TOO_LARGE',
            message: 'Thumbnail image exceeds 10MB size limit.',
          },
        },
        { status: 413 }
      );
    }

    const imageBuffer = await upstream.arrayBuffer();
    if (imageBuffer.byteLength > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'ERR_FILE_TOO_LARGE',
            message: 'Thumbnail image exceeds 10MB size limit.',
          },
        },
        { status: 413 }
      );
    }

    return new Response(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(imageBuffer.byteLength),
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err: any) {
    clearTimeout(timeout);
    return new Response(FALLBACK_SVG, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }
}
