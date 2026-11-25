import { NextRequest, NextResponse } from 'next/server';
import { validateMediaUrl } from '@/lib/security-validator';
import { extractMediaMetadata } from '@/lib/extractor-ytdlp';
import { createApiErrorResponse, classifyApiError } from '@/lib/api-error';
import { isServerlessRuntime, proxyToBackend, resolveBackendBaseUrl } from '@/lib/backend-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export async function POST(req: NextRequest) {
  const requestId = `req_probe_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  let body: any = {};
  let rawUrl = '';
  try {
    body = await req.json();
    rawUrl = String(body?.url || body?.mediaUrl || '').trim();
  } catch {
    return createApiErrorResponse('Request body must be valid JSON with a "url" field.', 'INVALID_URL', requestId, CORS_HEADERS);
  }

  if (!rawUrl) {
    return createApiErrorResponse('Please provide a valid media link.', 'INVALID_URL', requestId, CORS_HEADERS);
  }

  const validation = validateMediaUrl(rawUrl);
  if (!validation.valid) {
    return createApiErrorResponse(validation.error || 'Access to internal or restricted host is prohibited.', 'INVALID_URL', requestId, CORS_HEADERS);
  }

  const proxyHeaders = new Headers(req.headers);
  proxyHeaders.set('content-type', 'application/json');
  const upstream = await proxyToBackend(
    new Request(req.url, {
      method: 'POST',
      headers: proxyHeaders,
      body: JSON.stringify({
        ...(body && typeof body === 'object' ? body : {}),
        url: validation.normalizedUrl,
        rightsDeclared: body?.rightsDeclared ?? true,
      }),
    }),
    'probe'
  );
  if (upstream) return upstream;

  if (
    isServerlessRuntime() &&
    !resolveBackendBaseUrl() &&
    /(?:youtube\.com|youtu\.be)/i.test(validation.normalizedUrl)
  ) {
    const msg =
      'Cloud media worker is not connected on this Vercel deployment (API_INTERNAL_URL unset). Use MUXARO Direct on desktop Chrome to extract locally on your connection, or connect a custom worker.';
    return NextResponse.json(
      {
        ok: false,
        success: false,
        code: 'ERR_BACKEND_NOT_CONFIGURED',
        status: 503,
        suggestedMode: 'extension-direct',
        rawMessage: msg,
        error: {
          code: 'ERR_BACKEND_NOT_CONFIGURED',
          message: msg,
        },
        requestId,
      },
      { status: 503, headers: CORS_HEADERS }
    );
  }

  try {
    const manifest = await extractMediaMetadata(validation.normalizedUrl);
    return NextResponse.json(
      {
        ok: true,
        success: true,
        data: manifest,
        requestId,
      },
      {
        status: 200,
        headers: CORS_HEADERS,
      }
    );
  } catch (err: any) {
    const classified = classifyApiError(err, 'ERR_EXTRACTION_FAILED');
    if (classified.code === 'HOST_BLOCKED') {
      return NextResponse.json(
        {
          ok: false,
          status: 'host_restricted',
          suggestedMode: 'desktop-direct',
          code: 'HOST_BLOCKED',
          rawMessage:
            classified.rawMessage ||
            'Upstream host challenged cloud worker egress. Extract via MUXARO Direct desktop extension or switch to a clean ISP/residential worker.',
          success: false,
          error: {
            code: 'HOST_BLOCKED',
            message:
              classified.rawMessage ||
              'Upstream host challenged cloud worker egress. Extract via MUXARO Direct desktop extension or switch to a clean ISP/residential worker.',
          },
          requestId,
        },
        {
          status: 200,
          headers: CORS_HEADERS,
        }
      );
    }
    return createApiErrorResponse(err, 'ERR_EXTRACTION_FAILED', requestId, CORS_HEADERS);
  }
}

export async function GET(req: NextRequest) {
  const requestId = `req_probe_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const searchParams = req.nextUrl.searchParams;
  const rawUrl = String(searchParams.get('url') || searchParams.get('mediaUrl') || '').trim();

  if (!rawUrl) {
    return createApiErrorResponse('URL query parameter is required.', 'INVALID_URL', requestId, CORS_HEADERS);
  }

  const validation = validateMediaUrl(rawUrl);
  if (!validation.valid) {
    return createApiErrorResponse(validation.error || 'Access to internal or restricted host is prohibited.', 'INVALID_URL', requestId, CORS_HEADERS);
  }

  const proxyHeaders = new Headers(req.headers);
  proxyHeaders.set('content-type', 'application/json');
  const cleanUrl = new URL(req.url);
  cleanUrl.search = '';
  const upstream = await proxyToBackend(
    new Request(cleanUrl.toString(), {
      method: 'POST',
      headers: proxyHeaders,
      body: JSON.stringify({
        url: validation.normalizedUrl,
        rightsDeclared: true,
      }),
    }),
    'probe'
  );
  if (upstream) return upstream;

  if (
    isServerlessRuntime() &&
    !resolveBackendBaseUrl() &&
    /(?:youtube\.com|youtu\.be)/i.test(validation.normalizedUrl)
  ) {
    const msg =
      'Cloud media worker is not connected on this Vercel deployment (API_INTERNAL_URL unset). Use MUXARO Direct on desktop Chrome to extract locally on your connection, or connect a custom worker.';
    return NextResponse.json(
      {
        ok: false,
        success: false,
        code: 'ERR_BACKEND_NOT_CONFIGURED',
        status: 503,
        suggestedMode: 'extension-direct',
        rawMessage: msg,
        error: {
          code: 'ERR_BACKEND_NOT_CONFIGURED',
          message: msg,
        },
        requestId,
      },
      { status: 503, headers: CORS_HEADERS }
    );
  }

  try {
    const manifest = await extractMediaMetadata(validation.normalizedUrl);
    return NextResponse.json(
      {
        ok: true,
        success: true,
        data: manifest,
        requestId,
      },
      {
        status: 200,
        headers: CORS_HEADERS,
      }
    );
  } catch (err: any) {
    const classified = classifyApiError(err, 'ERR_EXTRACTION_FAILED');
    if (classified.code === 'HOST_BLOCKED') {
      return NextResponse.json(
        {
          ok: false,
          status: 'host_restricted',
          suggestedMode: 'desktop-direct',
          code: 'HOST_BLOCKED',
          rawMessage:
            classified.rawMessage ||
            'Upstream host challenged cloud worker egress. Extract via MUXARO Direct desktop extension or switch to a clean ISP/residential worker.',
          success: false,
          error: {
            code: 'HOST_BLOCKED',
            message:
              classified.rawMessage ||
              'Upstream host challenged cloud worker egress. Extract via MUXARO Direct desktop extension or switch to a clean ISP/residential worker.',
          },
          requestId,
        },
        {
          status: 200,
          headers: CORS_HEADERS,
        }
      );
    }
    return createApiErrorResponse(err, 'ERR_EXTRACTION_FAILED', requestId, CORS_HEADERS);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
