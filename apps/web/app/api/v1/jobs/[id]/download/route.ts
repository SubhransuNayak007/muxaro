import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { jobManager, OUTPUTS_DIR } from '@/lib/job-manager';
import { formatContentDisposition, sanitizeFilename } from '@/lib/security-validator';
import { parseResolutionHeight } from '@/lib/format-normalizer';
import { streamTier0ToResponse, inferMime } from '@/lib/pipeline/tier0-passthrough';
import { createApiErrorResponse } from '@/lib/api-error';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const DOWNLOAD_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type, Authorization, If-Range, X-Requested-With',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, ETag, Content-Disposition',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: DOWNLOAD_CORS_HEADERS });
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
  const streamParam = searchParams.get('stream') || searchParams.get('url');

  const job = jobManager.getJob(id);

  // Early exit: if the job failed due to host bot detection / 403, fail immediately with 403
  if (job?.status === 'failed') {
    const isBot =
      job.error?.code === 'HOST_BLOCKED' ||
      job.error?.code === 'ERR_YOUTUBE_BOT_CHECK' ||
      job.stageMessage?.toLowerCase().includes('bot') ||
      job.stageMessage?.toLowerCase().includes('403');
    if (isBot) {
      return createApiErrorResponse(
        job.error?.message || job.stageMessage || 'Host blocked media download (HTTP 403 / bot check).',
        'HOST_BLOCKED',
        undefined,
        DOWNLOAD_CORS_HEADERS
      );
    }
  }

  const fileInfo = resolveJobFile(id, requestedFilename);
  const isInline = searchParams.get('inline') === '1' || searchParams.get('inline') === 'true';

  // 1. Fast path: Direct remote stream delivery via Tier 0 Zero-Hop Pass-Through
  const candidateStreamUrl = streamParam || job?.directStreamUrl;
  const localFileValid = fileInfo && fs.existsSync(fileInfo.filePath) && fs.statSync(fileInfo.filePath).size >= 1000;

  // 1a. Dedicated YouTube stream resolution for serverless environments
  if (!localFileValid && job?.sourceUrl && /(?:youtube\.com|youtu\.be)/i.test(job.sourceUrl)) {
    try {
      const { Ytdl, Client } = await import('@distube/ytdl-core');
      const ytCookie = process.env.YOUTUBE_COOKIE?.trim();
      const ytdl = new Ytdl({
        cookie: ytCookie || undefined,
        clients: [Client.Tv, Client.VisionOS, Client.WebEmbedded, Client.Mweb],
      });
      const info = await ytdl.getInfo(job.sourceUrl);
      const isAudio = ['mp3', 'm4a', 'flac', 'wav', 'opus'].includes((job.targetFormat || '').toLowerCase());
      const reqHeight = parseResolutionHeight(job.targetResolution);
      let selectedFormat: any;
      if (isAudio) {
        selectedFormat =
          info.formats.find((f: any) => f.hasAudio && !f.hasVideo) ||
          info.formats.find((f: any) => f.hasAudio);
      } else {
        const vFormats = info.formats.filter((f: any) => f.hasVideo);
        selectedFormat =
          vFormats.find((f: any) => f.height === reqHeight) ||
          vFormats.find((f: any) => f.height && f.height <= reqHeight) ||
          vFormats[0];
      }

      if (selectedFormat) {
        const safeFilename = sanitizeFilename(requestedFilename || job?.filename || `${info.videoDetails.title}.${job.targetFormat}`);
        const stream = ytdl.download(info, { format: selectedFormat });
        const { Readable } = await import('node:stream');
        const webStream = Readable.toWeb(stream);

        return streamTier0ToResponse({
          source: webStream as any,
          filename: safeFilename,
          contentLength: selectedFormat.contentLength ? parseInt(selectedFormat.contentLength, 10) : undefined,
          contentType: selectedFormat.mimeType?.split(';')[0] || (isAudio ? 'audio/mpeg' : 'video/mp4'),
          status: 200,
          signal: req.signal,
          disposition: isInline ? 'inline' : 'attachment',
        });
      }
    } catch (ytStreamErr: any) {
      console.warn('[Download YouTube Stream Error]', ytStreamErr);
      const errMsg = String(ytStreamErr?.message || ytStreamErr || '');
      if (
        errMsg.toLowerCase().includes('bot') ||
        errMsg.toLowerCase().includes('sign in') ||
        errMsg.includes('403') ||
        errMsg.includes('429')
      ) {
        return createApiErrorResponse(
          'YouTube host blocked automated stream download (HTTP 403 / bot check).',
          'HOST_BLOCKED',
          undefined,
          DOWNLOAD_CORS_HEADERS
        );
      }
    }
  }

  // 1b. Direct remote stream delivery (Pinterest, Twitter, TikTok, direct URLs)
  if (!localFileValid && candidateStreamUrl) {
    if (isForbiddenStreamUrl(candidateStreamUrl)) {
      return createApiErrorResponse(
        'Access to internal or restricted stream host is prohibited.',
        'INVALID_URL',
        undefined,
        DOWNLOAD_CORS_HEADERS
      );
    }

    try {
      const safeFilename = sanitizeFilename(requestedFilename || job?.filename || 'media_download.mp4');
      const rangeHeader = req.headers.get('range');
      const isGoogleVideo = candidateStreamUrl.includes('googlevideo.com');
      const userAgent = isGoogleVideo
        ? 'Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/2.4.0 TV Safari/538.1'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

      const remoteRes = await fetch(candidateStreamUrl, {
        headers: {
          'User-Agent': userAgent,
          ...(rangeHeader ? { Range: rangeHeader } : {}),
        },
        signal: req.signal,
      });

      if (remoteRes.status === 403 || remoteRes.status === 429) {
        return createApiErrorResponse(
          'Remote media host rejected stream request (HTTP 403 Forbidden / Bot Block).',
          'HOST_BLOCKED',
          undefined,
          DOWNLOAD_CORS_HEADERS
        );
      }

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
    } catch (proxyErr: any) {
      console.warn('[Download Stream Error]', proxyErr);
      if (proxyErr?.name === 'AbortError') {
        return createApiErrorResponse('Remote stream fetch timed out.', 'TIMEOUT', undefined, DOWNLOAD_CORS_HEADERS);
      }
    }
  }

  // 2. Local disk file delivery via Tier 0 Zero-Hop Pass-Through
  if (!fileInfo || !fs.existsSync(fileInfo.filePath)) {
    return createApiErrorResponse(
      `Processed media artifact for job ${id} was not found or has expired. Please initiate a new download.`,
      'INVALID_URL',
      undefined,
      DOWNLOAD_CORS_HEADERS
    );
  }

  const { filePath } = fileInfo;
  const safeFilename = sanitizeFilename(fileInfo.filename);

  // Path traversal defense: file MUST reside strictly within OUTPUTS_DIR
  const resolvedTarget = path.resolve(filePath);
  const resolvedBase = path.resolve(OUTPUTS_DIR);
  if (!resolvedTarget.startsWith(resolvedBase)) {
    return createApiErrorResponse(
      'Access to file outside authorized storage directory is prohibited.',
      'INVALID_URL',
      undefined,
      DOWNLOAD_CORS_HEADERS
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
          ...DOWNLOAD_CORS_HEADERS,
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
  const streamParam = searchParams.get('stream') || searchParams.get('url');

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
        Object.entries(DOWNLOAD_CORS_HEADERS).forEach(([k, v]) => headers.set(k, v));
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
    return new Response(null, { status: 404, headers: DOWNLOAD_CORS_HEADERS });
  }

  const stat = fs.statSync(fileInfo.filePath);
  const safeFilename = sanitizeFilename(fileInfo.filename);
  const mimeType = inferMime(safeFilename);

  return new Response(null, {
    status: 200,
    headers: {
      ...DOWNLOAD_CORS_HEADERS,
      'Content-Type': mimeType,
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': formatContentDisposition(safeFilename),
    },
  });
}
