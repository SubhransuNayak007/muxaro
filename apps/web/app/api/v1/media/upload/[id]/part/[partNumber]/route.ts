import { NextRequest, NextResponse } from 'next/server';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getSessionMeta } from '@/lib/upload-storage';
import { isServerlessRuntime, proxyToBackend } from '@/lib/backend-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'PUT, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string; partNumber: string } }
) {
  const requestId = `upl_part_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const uploadId = params.id;
  const partNumber = parseInt(params.partNumber, 10);

  if (isNaN(partNumber) || partNumber < 1) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error: { code: 'ERR_INVALID_PART', message: 'Invalid part number' },
        requestId,
      },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const upstream = await proxyToBackend(
    req,
    `media/upload/${encodeURIComponent(uploadId)}/part/${partNumber}`,
    { streaming: true, timeoutMs: 120_000 }
  );
  if (upstream) return upstream;

  if (isServerlessRuntime()) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error: {
          code: 'ERR_BACKEND_NOT_CONFIGURED',
          message:
            'Backend media processing server is not configured for chunked server uploads. Use in-browser processing or configure API_INTERNAL_URL.',
        },
        requestId,
      },
      { status: 503, headers: CORS_HEADERS }
    );
  }

  const session = await getSessionMeta(uploadId);
  if (!session) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error: { code: 'ERR_UPLOAD_NOT_FOUND', message: `Upload session ${uploadId} not found or expired` },
        requestId,
      },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  try {
    const chunkBuffer = Buffer.from(await req.arrayBuffer());
    if (chunkBuffer.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          error: { code: 'ERR_EMPTY_PART', message: 'Part is empty' },
          requestId,
        },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const partPath = path.join(session.sessionDir, `part_${partNumber}`);
    await fsp.writeFile(partPath, chunkBuffer);

    return NextResponse.json(
      {
        ok: true,
        success: true,
        data: {
          uploadId,
          partNumber,
          sizeBytes: chunkBuffer.length,
        },
        requestId,
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error: { code: 'ERR_PART_SAVE_FAILED', message: err?.message || 'Failed to save part' },
        requestId,
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
