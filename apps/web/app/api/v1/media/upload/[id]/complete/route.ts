import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getUploadsDir, getSessionMeta } from '@/lib/upload-storage';
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

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const requestId = `upl_comp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const uploadId = params.id;

  const upstream = await proxyToBackend(
    req,
    `media/upload/${encodeURIComponent(uploadId)}/complete`,
    { timeoutMs: 120_000 }
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

  const uploadsRoot = getUploadsDir();
  const finalDir = path.join(uploadsRoot, uploadId);
  const finalFilePath = path.join(finalDir, session.safeFilename);

  try {
    await fsp.mkdir(finalDir, { recursive: true });

    // Concatenate parts sequentially
    const writeStream = fs.createWriteStream(finalFilePath);
    let totalBytes = 0;

    for (let i = 1; i <= session.totalParts; i++) {
      const partPath = path.join(session.sessionDir, `part_${i}`);
      if (!fs.existsSync(partPath)) {
        writeStream.destroy();
        return NextResponse.json(
          {
            ok: false,
            success: false,
            error: { code: 'ERR_MISSING_PART', message: `Part ${i} of ${session.totalParts} is missing` },
            requestId,
          },
          { status: 400, headers: CORS_HEADERS }
        );
      }

      const partBuffer = await fsp.readFile(partPath);
      totalBytes += partBuffer.length;
      await new Promise<void>((resolve, reject) => {
        if (!writeStream.write(partBuffer)) {
          writeStream.once('drain', resolve);
        } else {
          resolve();
        }
      });
    }

    await new Promise<void>((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on('error', reject);
    });

    // Write asset sidecar metadata
    const ext = path.extname(session.safeFilename).replace(/^\./, '').toLowerCase() || 'mp4';
    const assetMeta = {
      assetId: uploadId,
      uploadId,
      filename: session.safeFilename,
      filePath: finalFilePath,
      sizeBytes: totalBytes,
      format: ext,
      createdAt: new Date().toISOString(),
      expiresAt: session.expiresAt,
    };

    await fsp.writeFile(path.join(finalDir, 'asset_meta.json'), JSON.stringify(assetMeta, null, 2), 'utf8');

    // Clean up temporary multipart directory
    await fsp.rm(session.sessionDir, { recursive: true, force: true }).catch(() => {});

    const assetData = {
      uploadId,
      assetId: uploadId,
      filename: session.safeFilename,
      sizeBytes: totalBytes,
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
        error: { code: 'ERR_ASSEMBLY_FAILED', message: err?.message || 'Failed to assemble multipart file' },
        requestId,
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
