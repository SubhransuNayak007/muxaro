import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const searchParams = req.nextUrl.searchParams;
  const rawUrl = searchParams.get('url');
  const filename = searchParams.get('filename') || searchParams.get('title') || `media_${id}.mp4`;
  const cleanFilename = filename.replace(/[^\w\s.-]/gi, '_');

  if (!rawUrl) {
    // If no direct URL provided, return placeholder or error
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'ERR_ARTIFACT_NOT_FOUND',
          message: `Processed media artifact for job ${id} not found. Please initiate a new download.`,
        },
      },
      { status: 404 }
    );
  }

  let decodedUrl = '';
  try {
    decodedUrl = decodeURIComponent(rawUrl);
  } catch {
    decodedUrl = rawUrl;
  }

  if (!/^https?:\/\//i.test(decodedUrl)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'ERR_INVALID_STREAM_URL',
          message: 'The requested stream URL is invalid.',
        },
      },
      { status: 400 }
    );
  }

  // If redirect query or inline preview requested
  const isDirectRedirect = searchParams.get('redirect') === 'true';
  if (isDirectRedirect) {
    return NextResponse.redirect(decodedUrl, 302);
  }

  try {
    // Stream through serverless function with proper attachment header
    const upstreamHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: '*/*',
    };

    const rangeHeader = req.headers.get('range');
    if (rangeHeader) {
      upstreamHeaders['Range'] = rangeHeader;
    }

    const upstream = await fetch(decodedUrl, {
      headers: upstreamHeaders,
    });

    if (!upstream.ok && upstream.status !== 206) {
      // If upstream rejects (e.g. 403 due to IP binding), fallback to direct 302 redirect
      return NextResponse.redirect(decodedUrl, 302);
    }

    const contentType = upstream.headers.get('content-type') || 'video/mp4';
    const contentLength = upstream.headers.get('content-length');

    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', contentType);
    responseHeaders.set(
      'Content-Disposition',
      `attachment; filename="${cleanFilename}"`
    );
    responseHeaders.set('Cache-Control', 'public, max-age=3600');
    responseHeaders.set('Accept-Ranges', 'bytes');
    if (contentLength) {
      responseHeaders.set('Content-Length', contentLength);
    }
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) {
      responseHeaders.set('Content-Range', contentRange);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (err) {
    // If serverless streaming encounters network issues, redirect client directly
    return NextResponse.redirect(decodedUrl, 302);
  }
}

export async function HEAD(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  return new Response(null, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
    },
  });
}
