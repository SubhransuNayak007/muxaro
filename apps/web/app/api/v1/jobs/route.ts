import { NextRequest, NextResponse } from 'next/server';
import { jobManager } from '@/lib/job-manager';
import { validateMediaUrl } from '@/lib/security-validator';

export async function POST(req: NextRequest) {
  const requestId = `cjob_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'ERR_INVALID_BODY',
            message: 'Request body must be valid JSON.',
          },
          requestId,
        },
        { status: 400 }
      );
    }

    const rawUrl = String(body?.sourceUrl || body?.mediaUrl || body?.url || '').trim();
    if (!rawUrl) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'ERR_EMPTY_URL',
            message: 'Source media URL is required.',
          },
          requestId,
        },
        { status: 400 }
      );
    }

    // SSRF & URL validation
    const validation = validateMediaUrl(rawUrl);
    if (!validation.valid) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'SSRF_BLOCKED',
            message: validation.error || 'Access to internal or restricted host is prohibited.',
          },
          requestId,
        },
        { status: 403 }
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

    return NextResponse.json({
      success: true,
      data: job,
      requestId,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'ERR_JOB_CREATION_FAILED',
          message: err?.message || 'Could not create download job.',
        },
        requestId,
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  const jobs = jobManager.listJobs();
  return NextResponse.json({
    success: true,
    data: {
      jobs,
      total: jobs.length,
      edgeRuntime: 'node-media-systems',
    },
    requestId: `list_${Date.now()}`,
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}
