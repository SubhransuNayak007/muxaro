import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { jobManager, OUTPUTS_DIR } from '@/lib/job-manager';
import { formatContentDisposition, sanitizeFilename } from '@/lib/security-validator';
import { streamTier0ToResponse, inferMime } from '@/lib/pipeline/tier0-passthrough';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

function isForbiddenStreamUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
      /^169\.254\./.test(host)
    ) {
      return true;
    }
    return parsed.protocol !== 'http:' && parsed.protocol !== 'https:';
  } catch {
    return true;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const searchParams = req.nextUrl.searchParams;
  const requestedFilename = searchParams.get('filename') || searchParams.get('title');
  const streamParam = searchParams.get('stream');

  const job = jobManager.getJob(id);
  const fileInfo = resolveJobFile(id, requestedFilename);
  const isInline = searchParams.get('inline') === '1' || searchParams.get('inline') === 'true';

  // 1. Fast path: Direct remote stream delivery via Tier 0 Zero-Hop Pass-Through
  const candidateStreamUrl = streamParam || job?.directStreamUrl;
  const localFileValid = fileInfo && fs.existsSync(fileInfo.filePath) && fs.statSync(fileInfo.filePath).size >= 1000;

  if (!localFileValid && candidateStreamUrl && !isForbiddenStreamUrl(candidateStreamUrl)) {
    try {
      const safeFilename = sanitizeFilename(requestedFilename || job?.filename || 'media_download.mp4');
      const rangeHeader = req.headers.get('range');

      const remoteRes = await fetch(candidateStreamUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          ...(rangeHeader ? { Range: rangeHeader } : {}),
        },
        signal: req.signal,
      });

      if ((remoteRes.ok || remoteRes.status === 206) && remoteRes.body) {
        const contentLength = remoteRes.headers.get('content-length')
          ? parseInt(remoteRes.headers.get('content-length')!, 10)
          : undefined;
        const contentRange = remoteRes.headers.get('content-range') || undefined;
        const contentType = remoteRes.headers.get('content-type') || job?.directMimeType || undefined;

        return streamTier0ToResponse({
          source: remoteRes.body,
          filename: safeFilename,
          contentLength,
          contentRange,
          contentType,
          status: remoteRes.status,
          signal: req.signal,
          disposition: isInline ? 'inline' : 'attachment',
        });
      }
    } catch (proxyErr) {
      console.warn('[Download Proxy Error]', proxyErr);
    }
  }

  // 2. Local disk file delivery via Tier 0 Zero-Hop Pass-Through
  if (!fileInfo || !fs.existsSync(fileInfo.filePath)) {
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
    return streamTier0ToResponse({
      source: filePath,
      filename: safeFilename,
      contentLength: chunkSize,
      range: { start, end },
      contentRange: `bytes ${start}-${end}/${totalSize}`,
      status: 206,
      signal: req.signal,
      disposition: isInline ? 'inline' : 'attachment',
    });
  }

  // Full file streaming via streamTier0ToResponse
  return streamTier0ToResponse({
    source: filePath,
    filename: safeFilename,
    contentLength: totalSize,
    signal: req.signal,
    disposition: isInline ? 'inline' : 'attachment',
  });
}

export async function HEAD(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const searchParams = req.nextUrl.searchParams;
  const requestedFilename = searchParams.get('filename') || searchParams.get('title');
  const streamParam = searchParams.get('stream');

  const job = jobManager.getJob(id);
  const candidateStreamUrl = streamParam || job?.directStreamUrl;
  const fileInfo = resolveJobFile(id, requestedFilename);

  if (candidateStreamUrl && !isForbiddenStreamUrl(candidateStreamUrl)) {
    try {
      const remoteRes = await fetch(candidateStreamUrl, {
        method: 'HEAD',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        signal: req.signal,
      });

      if (remoteRes.ok) {
        const safeFilename = sanitizeFilename(requestedFilename || job?.filename || 'media_download.mp4');
        const headers = new Headers();
        headers.set('Content-Type', remoteRes.headers.get('content-type') || inferMime(safeFilename));
        headers.set('Content-Disposition', formatContentDisposition(safeFilename));
        headers.set('Accept-Ranges', 'bytes');
        if (remoteRes.headers.get('content-length')) {
          headers.set('Content-Length', remoteRes.headers.get('content-length')!);
        }
        return new Response(null, { status: 200, headers });
      }
    } catch {}
  }

  if (!fileInfo) {
    return new Response(null, { status: 404 });
  }

  const stat = fs.statSync(fileInfo.filePath);
  const safeFilename = sanitizeFilename(fileInfo.filename);
  const mimeType = inferMime(safeFilename);

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
