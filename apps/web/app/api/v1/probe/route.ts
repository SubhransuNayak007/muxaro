import { NextRequest, NextResponse } from 'next/server';
import { validateMediaUrl } from '@/lib/security-validator';
import { extractMediaMetadata } from '@/lib/extractor-ytdlp';
import { createApiErrorResponse, classifyApiError } from '@/lib/api-error';

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

  let rawUrl = '';
  try {
    const body = await req.json();
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
    const classified = classifyApiError(err, 'HOST_BLOCKED');
    if (classified.code === 'HOST_BLOCKED') {
      return NextResponse.json(
        {
          ok: false,
          status: 'host_restricted',
          suggestedMode: 'desktop-direct',
          code: 'HOST_BLOCKED',
          rawMessage: 'This host blocks free cloud servers. Use Desktop Direct or connect a custom worker.',
          success: false,
          error: {
            code: 'HOST_BLOCKED',
            message: 'This host blocks free cloud servers. Use Desktop Direct or connect a custom worker.',
          },
          requestId,
        },
        {
          status: 200,
          headers: CORS_HEADERS,
        }
      );
    }
    return createApiErrorResponse(err, 'HOST_BLOCKED', requestId, CORS_HEADERS);
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
    const classified = classifyApiError(err, 'HOST_BLOCKED');
    if (classified.code === 'HOST_BLOCKED') {
      return NextResponse.json(
        {
          ok: false,
          status: 'host_restricted',
          suggestedMode: 'desktop-direct',
          code: 'HOST_BLOCKED',
          rawMessage: 'This host blocks free cloud servers. Use Desktop Direct or connect a custom worker.',
          success: false,
          error: {
            code: 'HOST_BLOCKED',
            message: 'This host blocks free cloud servers. Use Desktop Direct or connect a custom worker.',
          },
          requestId,
        },
        {
          status: 200,
          headers: CORS_HEADERS,
        }
      );
    }
    return createApiErrorResponse(err, 'HOST_BLOCKED', requestId, CORS_HEADERS);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
