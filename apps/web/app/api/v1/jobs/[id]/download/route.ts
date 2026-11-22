import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { jobManager, OUTPUTS_DIR } from '@/lib/job-manager';
import { formatContentDisposition, sanitizeFilename } from '@/lib/security-validator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MIME_MAP: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  opus: 'audio/opus',
  flac: 'audio/flac',
  wav: 'audio/wav',
};

function getMimeType(filename: string): string {
  const ext = path.extname(filename).replace('.', '').toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

function resolveJobFile(id: string, requestedFilename?: string | null): { filePath: string; filename: string } | null {
  const job = jobManager.getJob(id);
  if (job?.filePath && fs.existsSync(job.filePath)) {
    return { filePath: job.filePath, filename: job.filename };
  }

  // Fallback: search OUTPUTS_DIR for files starting with `${id}_`
  try {
    if (fs.existsSync(OUTPUTS_DIR)) {
      const match = fs.readdirSync(OUTPUTS_DIR).find((f) => f.startsWith(`${id}_`));
      if (match) {
        const fullPath = path.join(OUTPUTS_DIR, match);
        const originalName = match.replace(`${id}_`, '');
        return { filePath: fullPath, filename: originalName };
      }
    }
  } catch {}

  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const searchParams = req.nextUrl.searchParams;
  const requestedFilename = searchParams.get('filename') || searchParams.get('title');

  const fileInfo = resolveJobFile(id, requestedFilename);

  if (!fileInfo) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'ERR_ARTIFACT_NOT_FOUND',
          message: `Processed media artifact for job ${id} was not found or has expired. Please initiate a new download.`,
        },
      },
      { status: 404 }
    );
  }

  const { filePath } = fileInfo;
  const safeFilename = sanitizeFilename(fileInfo.filename);

  // Path traversal defense: file MUST reside strictly within OUTPUTS_DIR
  const resolvedTarget = path.resolve(filePath);
  const resolvedBase = path.resolve(OUTPUTS_DIR);
  if (!resolvedTarget.startsWith(resolvedBase)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'ERR_ACCESS_DENIED',
          message: 'Access to file outside the authorized storage directory is prohibited.',
        },
      },
      { status: 403 }
    );
  }

  const stat = fs.statSync(filePath);
  const totalSize = stat.size;
  const mimeType = getMimeType(safeFilename);
  const isInline = searchParams.get('inline') === '1' || searchParams.get('inline') === 'true';

  const dispositionHeader = isInline
    ? `inline; filename="${safeFilename}"`
    : formatContentDisposition(safeFilename);

  // HTTP RFC 9110 Range Header handling
  const rangeHeader = req.headers.get('range');

  if (rangeHeader && /^bytes=\d*-\d*$/.test(rangeHeader)) {
    const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
    let start = startStr ? parseInt(startStr, 10) : 0;
    let end = endStr ? parseInt(endStr, 10) : totalSize - 1;

    if (isNaN(start) || start < 0) start = 0;
    if (isNaN(end) || end >= totalSize) end = totalSize - 1;

    if (start > end || start >= totalSize) {
      return new Response(null, {
        status: 416,
        headers: {
          'Content-Range': `bytes */${totalSize}`,
        },
      });
    }

    const chunkSize = end - start + 1;
    const nodeStream = fs.createReadStream(filePath, { start, end });
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    return new Response(webStream, {
      status: 206,
      headers: {
        'Content-Type': mimeType,
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Content-Length': String(chunkSize),
        'Accept-Ranges': 'bytes',
        'Content-Disposition': dispositionHeader,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  // Full file streaming via fs.createReadStream
  const nodeStream = fs.createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(totalSize),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': dispositionHeader,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

export async function HEAD(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const fileInfo = resolveJobFile(id);

  if (!fileInfo) {
    return new Response(null, { status: 404 });
  }

  const stat = fs.statSync(fileInfo.filePath);
  const safeFilename = sanitizeFilename(fileInfo.filename);
  const mimeType = getMimeType(safeFilename);

  return new Response(null, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': formatContentDisposition(safeFilename),
    },
  });
}
