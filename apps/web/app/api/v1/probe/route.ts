import { NextRequest, NextResponse } from 'next/server';
import { POST as handleInspectPost } from '../media/inspect/route';
import { validateMediaUrl } from '@/lib/security-validator';
import { extractMediaMetadata } from '@/lib/extractor-ytdlp';

export { handleInspectPost as POST };

export async function GET(req: NextRequest) {
  const requestId = `req_probe_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const searchParams = req.nextUrl.searchParams;
  const rawUrl = searchParams.get('url') || '';

  if (!rawUrl) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'ERR_EMPTY_URL',
          message: 'URL query parameter is required.',
        },
        requestId,
      },
      { status: 400 }
    );
  }

  const validation = validateMediaUrl(rawUrl);
  if (!validation.valid) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'SSRF_BLOCKED',
          message: validation.error || 'Access to internal or restricted host is prohibited.',
        },
        requestId,
      },
      { status: 403 }
    );
  }

  try {
    const manifest = await extractMediaMetadata(validation.normalizedUrl);
    return NextResponse.json({
      success: true,
      data: manifest,
      requestId,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'ERR_INSPECT_FAILED',
          message: err?.message || 'Could not probe media link.',
        },
        requestId,
      },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}
