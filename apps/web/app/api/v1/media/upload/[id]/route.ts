import { NextRequest, NextResponse } from 'next/server';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getUploadsDir, getSessionMeta, deleteUploadSession } from '@/lib/upload-storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const uploadId = params.id;
  const session = await getSessionMeta(uploadId);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: { code: 'ERR_NOT_FOUND', message: 'Upload session not found' } },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json(
    { ok: true, data: session },
    { status: 200, headers: CORS_HEADERS }
  );
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const uploadId = params.id;
  await deleteUploadSession(uploadId);
  const uploadsRoot = getUploadsDir();
  await fsp.rm(path.join(uploadsRoot, uploadId), { recursive: true, force: true }).catch(() => {});

  return NextResponse.json(
    { ok: true, success: true, message: 'Upload session cancelled and cleaned up.' },
    { status: 200, headers: CORS_HEADERS }
  );
}
