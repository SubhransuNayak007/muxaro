import { NextRequest, NextResponse } from 'next/server';
import { jobManager } from '@/lib/job-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const requestId = `cancel_${Date.now()}`;
  const cancelled = jobManager.cancelJob(id);

  if (!cancelled) {
    const existing = jobManager.getJob(id);
    if (!existing) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          error: {
            code: 'JOB_NOT_FOUND',
            message: `Job ${id} was not found or has expired.`,
          },
          requestId,
        },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        success: false,
        error: {
          code: 'ERR_CANCEL_FAILED',
          message: `Cannot cancel job ${id}. Current status is '${existing.status}'.`,
        },
        requestId,
      },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      success: true,
      data: {
        id,
        status: 'CANCELLED',
        cancelled: true,
        message: 'Job cancelled by user request.',
      },
      requestId,
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
