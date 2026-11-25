import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { jobManager } from '@/lib/job-manager';
import { validateMediaUrl } from '@/lib/security-validator';
import { createApiErrorResponse } from '@/lib/api-error';
import { getUploadsDir } from '@/lib/upload-storage';
import { proxyToBackend } from '@/lib/backend-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export async function POST(req: NextRequest) {
  const requestId = `cjob_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const reqForProxy = req.clone();

  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return createApiErrorResponse('Request body must be valid JSON.', 'INVALID_URL', requestId, CORS_HEADERS);
    }

    let sourceMedia = String(body?.sourceUrl || body?.mediaUrl || body?.url || '').trim();
    const candidateSessionId = String(body?.uploadSessionId || body?.mediaAssetId || body?.assetId || '').trim();
    const clipUrls = Array.isArray(body?.clipUrls) ? body.clipUrls : [];

    if (!sourceMedia && clipUrls.length > 0) {
      sourceMedia = String(clipUrls[0] || '').trim();
    }

    if (!sourceMedia && candidateSessionId) {
      const uploadsRoot = getUploadsDir();
      const candidateDir = path.join(uploadsRoot, candidateSessionId);
      if (fs.existsSync(candidateDir)) {
        const files = fs.readdirSync(candidateDir).filter((f) => !f.endsWith('.json'));
        if (files.length > 0) {
          sourceMedia = path.join(candidateDir, files[0]);
        }
      }
    }

    if (!sourceMedia && !candidateSessionId) {
      return createApiErrorResponse('Source media URL or uploadSessionId is required.', 'INVALID_URL', requestId, CORS_HEADERS);
    }

    // SSRF & URL validation (only for external HTTP/HTTPS URLs)
    let normalizedUrl = sourceMedia;
    const isLocalFile = Boolean(sourceMedia && fs.existsSync(sourceMedia));
    if (sourceMedia && !isLocalFile) {
      const validation = validateMediaUrl(sourceMedia);
      if (!validation.valid) {
        return createApiErrorResponse(
          validation.error || 'Access to internal or restricted host is prohibited.',
          'INVALID_URL',
          requestId,
          CORS_HEADERS
        );
      }
      normalizedUrl = validation.normalizedUrl;
    }

    const upstream = await proxyToBackend(reqForProxy, 'jobs');
    if (upstream) return upstream;

    if (!sourceMedia) {
      return createApiErrorResponse('Source media URL or uploadSessionId could not be resolved.', 'INVALID_URL', requestId, CORS_HEADERS);
    }

    const job = await jobManager.createJob({
      sourceUrl: normalizedUrl,
      targetFormat: body?.targetFormat,
      targetResolution: body?.targetResolution,
      formatId: body?.formatId,
      videoFormatId: body?.videoFormatId,
      audioFormatId: body?.audioFormatId,
      title: body?.title,
      operation: body?.operation,
      executionMode: body?.executionMode,
      allowCloudFallback: body?.allowCloudFallback ?? body?.fallbackToCloud,
      directStreamUrl: body?.directStreamUrl || body?.streamUrl,
      directMimeType: body?.directMimeType || body?.mimeType,
      fileSizeBytes: body?.fileSizeBytes,
    });

    if (job.status === 'failed' && job.error?.code === 'RESOLUTION_REQUIRES_LOCAL_WORKER') {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          code: 'RESOLUTION_REQUIRES_LOCAL_WORKER',
          error: {
            code: 'RESOLUTION_REQUIRES_LOCAL_WORKER',
            message: job.error.message,
          },
          notice: job.stageMessage,
          requiresLocalWorker: true,
          requestedResolution: job.requestedResolution || '8K',
          suggestedResolution: job.suggestedResolution || '1440p',
          cloudReadyAlternatives: job.cloudReadyAlternatives || [
            { resolution: '1440p', label: '2K Quad HD (Cloud-Ready Instant Stream)', instantStream: true },
            { resolution: '1080p', label: '1080p Full HD (Cloud-Ready Instant Stream)', instantStream: true },
            { resolution: '720p', label: '720p HD (Cloud-Ready Instant Stream)', instantStream: true },
          ],
          data: job,
          requestId,
        },
        {
          status: 422,
          headers: CORS_HEADERS,
        }
      );
    }

    if (
      job.status === 'failed' &&
      (job.error?.code === 'HOST_BLOCKED' ||
        job.error?.code === 'ERR_YOUTUBE_BOT_CHECK' ||
        job.stageMessage?.toLowerCase().includes('bot') ||
        job.stageMessage?.toLowerCase().includes('403'))
    ) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          status: 'failed',
          data: job,
          code: 'HOST_BLOCKED',
          suggestedMode: 'desktop-direct',
          error: {
            code: 'HOST_BLOCKED',
            message: job.error?.message || 'This host blocks free cloud servers. Use Desktop Direct or connect a custom worker.',
          },
          requestId,
        },
        {
          status: 200,
          headers: CORS_HEADERS,
        }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        success: true,
        data: job,
        requestId,
      },
      {
        status: 200,
        headers: CORS_HEADERS,
      }
    );
  } catch (err: any) {
    const rawMsg = String(err?.message || err || '');
    const isBotOrHostBlocked =
      err?.code === 'HOST_BLOCKED' ||
      err?.code === 'ERR_YOUTUBE_BOT_CHECK' ||
      /bot|confirm you're not a bot|login_required|checkpoint_required|blocked free cloud|403|forbidden/i.test(rawMsg);

    if (isBotOrHostBlocked) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          status: 'failed',
          code: 'HOST_BLOCKED',
          suggestedMode: 'desktop-direct',
          error: {
            code: 'HOST_BLOCKED',
            message: 'This host blocks free cloud servers. Use Desktop Direct or connect a custom worker.',
          },
          requestId,
        },
        {
          status: 200,
          headers: CORS_HEADERS,
        }
      );
    }
    return createApiErrorResponse(err, 'HOST_BLOCKED', requestId, CORS_HEADERS);
  }
}

export async function GET(req: NextRequest) {
  const upstream = await proxyToBackend(req, 'jobs');
  if (upstream) return upstream;

  const jobs = jobManager.listJobs();
  return NextResponse.json(
    {
      ok: true,
      success: true,
      data: {
        jobs,
        total: jobs.length,
        edgeRuntime: 'node-media-systems',
      },
      requestId: `list_${Date.now()}`,
    },
    {
      status: 200,
      headers: CORS_HEADERS,
    }
  );
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
