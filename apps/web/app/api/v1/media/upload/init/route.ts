import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import crypto from 'node:crypto';
import { getUploadsDir, saveSessionMeta, sanitizeUploadFilename } from '@/lib/upload-storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const requestId = `upl_init_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  try {
    const body = await req.json().catch(() => ({}));
    const filename = String(body?.filename || 'uploaded_media.mp4').trim();
    const totalSize = Number(body?.totalSize || 0);
    const totalParts = Number(body?.totalParts || 1);
    const sha256 = body?.sha256 ? String(body.sha256).trim() : undefined;

    const uploadId = crypto.randomUUID();
    const safeFilename = sanitizeUploadFilename(filename);
    const uploadsRoot = getUploadsDir();
    const sessionDir = path.join(uploadsRoot, 'multipart', uploadId);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

    await saveSessionMeta({
      uploadId,
      originalFilename: filename,
      safeFilename,
      totalSize,
      totalParts,
      expectedSha256: sha256,
      sessionDir,
      createdAt: now.toISOString(),
      expiresAt,
    });

    const responsePayload = {
      uploadId,
      assetId: uploadId,
      partSize: Math.ceil(totalSize / Math.max(1, totalParts)),
      totalParts,
      expiresAt,
    };

    return NextResponse.json(
      {
        ok: true,
        success: true,
        data: responsePayload,
        ...responsePayload,
        requestId,
      },
      {
        status: 200,
        headers: CORS_HEADERS,
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error: {
          code: 'ERR_UPLOAD_INIT_FAILED',
          message: err?.message || 'Failed to initialize upload session',
        },
        requestId,
      },
      {
        status: 500,
        headers: CORS_HEADERS,
      }
    );
  }
}
