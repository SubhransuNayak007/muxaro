import { NextRequest, NextResponse } from 'next/server';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getUploadsDir, sanitizeUploadFilename } from '@/lib/upload-storage';
import { isServerlessRuntime, proxyToBackend } from '@/lib/backend-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const requestId = `upl_dir_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const upstream = await proxyToBackend(req, 'media/upload', {
    streaming: true,
    timeoutMs: 120_000,
  });
  if (upstream) return upstream;

  if (isServerlessRuntime()) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error: {
          code: 'ERR_BACKEND_NOT_CONFIGURED',
          message:
            'Backend media processing server is not configured. Use in-browser processing or configure API_INTERNAL_URL.',
        },
        requestId,
      },
      { status: 503, headers: CORS_HEADERS }
    );
  }

  try {
    const rawHeaderName = req.headers.get('x-file-name') || '';
    let originalName = 'uploaded_media.mp4';
    if (rawHeaderName) {
      try {
        originalName = decodeURIComponent(rawHeaderName);
      } catch {
        originalName = rawHeaderName;
      }
    }

    const safeFilename = sanitizeUploadFilename(originalName);
    const assetId = crypto.randomUUID();
    const uploadsRoot = getUploadsDir();
    const uploadDir = path.join(uploadsRoot, assetId);
    const destPath = path.join(uploadDir, safeFilename);

    await fsp.mkdir(uploadDir, { recursive: true });

    const buffer = Buffer.from(await req.arrayBuffer());
    if (buffer.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          error: { code: 'ERR_EMPTY_UPLOAD', message: 'Uploaded file is empty (0 bytes)' },
          requestId,
        },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    if (buffer.length > 4.5 * 1024 * 1024) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          error: {
            code: 'ERR_PAYLOAD_TOO_LARGE',
            message: 'Direct server upload is limited to 4.5 MB on cloud functions. Use in-browser local processing for larger files.',
          },
          requestId,
        },
        { status: 413, headers: CORS_HEADERS }
      );
    }

    await fsp.writeFile(destPath, buffer);

    const ext = path.extname(safeFilename).replace(/^\./, '').toLowerCase() || 'mp4';
    const assetMeta = {
      assetId,
      uploadId: assetId,
      filename: safeFilename,
      filePath: destPath,
      sizeBytes: buffer.length,
      format: ext,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };

    await fsp.writeFile(path.join(uploadDir, 'asset_meta.json'), JSON.stringify(assetMeta, null, 2), 'utf8');

    const assetData = {
      uploadId: assetId,
      assetId,
      filename: safeFilename,
      sizeBytes: buffer.length,
      format: ext,
      status: 'ready',
      isLocalUpload: true,
    };

    return NextResponse.json(
      {
        ok: true,
        success: true,
        data: assetData,
        ...assetData,
        requestId,
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error: { code: 'ERR_UPLOAD_FAILED', message: err?.message || 'Direct upload failed' },
        requestId,
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
