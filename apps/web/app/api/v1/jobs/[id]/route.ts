import { NextRequest, NextResponse } from 'next/server';
import { jobManager } from '@/lib/job-manager';
import { createApiErrorResponse } from '@/lib/api-error';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const requestId = `job_${Date.now()}`;

  const job = jobManager.getJob(id);
  if (!job) {
    return createApiErrorResponse(
      `Job ${id} was not found or has expired.`,
      'INVALID_URL',
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
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const requestId = `cancel_${Date.now()}`;
  const cancelled = jobManager.cancelJob(id);

  if (!cancelled) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error: {
          code: 'ERR_CANCEL_FAILED',
          message: `Cannot cancel job ${id}. It may have completed, failed, or already been cancelled.`,
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
      data: { id, cancelled: true },
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
