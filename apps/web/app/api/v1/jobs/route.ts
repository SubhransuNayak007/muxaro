import { NextRequest, NextResponse } from 'next/server';
import { jobManager } from '@/lib/job-manager';
import { validateMediaUrl } from '@/lib/security-validator';
import { createApiErrorResponse } from '@/lib/api-error';

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

  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return createApiErrorResponse('Request body must be valid JSON.', 'INVALID_URL', requestId, CORS_HEADERS);
    }

    const rawUrl = String(body?.sourceUrl || body?.mediaUrl || body?.url || '').trim();
    if (!rawUrl) {
      return createApiErrorResponse('Source media URL is required.', 'INVALID_URL', requestId, CORS_HEADERS);
    }

    // SSRF & URL validation
    const validation = validateMediaUrl(rawUrl);
    if (!validation.valid) {
      return createApiErrorResponse(
        validation.error || 'Access to internal or restricted host is prohibited.',
        'INVALID_URL',
        requestId,
        CORS_HEADERS
      );
    }

    const job = await jobManager.createJob({
      sourceUrl: validation.normalizedUrl,
      targetFormat: body?.targetFormat,
      targetResolution: body?.targetResolution,
      formatId: body?.formatId,
      videoFormatId: body?.videoFormatId,
      audioFormatId: body?.audioFormatId,
      title: body?.title,
      operation: body?.operation,
    });

    if (
      job.status === 'failed' &&
      (job.error?.code === 'HOST_BLOCKED' ||
        job.error?.code === 'ERR_YOUTUBE_BOT_CHECK' ||
        job.stageMessage?.toLowerCase().includes('bot') ||
        job.stageMessage?.toLowerCase().includes('403'))
    ) {
      return createApiErrorResponse(
        job.error?.message || job.stageMessage || 'Host blocked automated download.',
        'HOST_BLOCKED',
        requestId,
        CORS_HEADERS
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
    return createApiErrorResponse(err, 'HOST_BLOCKED', requestId, CORS_HEADERS);
  }
}

export async function GET() {
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
