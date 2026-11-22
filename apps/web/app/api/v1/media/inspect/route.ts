import { NextRequest, NextResponse } from 'next/server';
import { validateMediaUrl } from '@/lib/security-validator';
import { extractMediaMetadata } from '@/lib/extractor-ytdlp';

export async function POST(req: NextRequest) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'ERR_INVALID_BODY',
            message: 'Request body must be valid JSON with a "url" field.',
          },
          requestId,
        },
        { status: 400 }
      );
    }

    const rawUrl = String(body?.url || body?.mediaUrl || '').trim();
    if (!rawUrl) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'ERR_EMPTY_URL',
            message: 'Please provide a valid media link.',
          },
          requestId,
        },
        { status: 400 }
      );
    }

    // SSRF & Security Validation
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

    // Extract media information using yt-dlp & resilient FFprobe
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
          message: err?.message || 'Could not inspect media link.',
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
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}
