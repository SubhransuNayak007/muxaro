import { NextRequest, NextResponse } from 'next/server';
import { jobManager } from '@/lib/job-manager';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const requestId = `job_${Date.now()}`;

  const job = jobManager.getJob(id);
  if (!job) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'ERR_JOB_NOT_FOUND',
          message: `Job ${id} was not found or has expired.`,
        },
        requestId,
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    data: job,
    requestId,
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const cancelled = jobManager.cancelJob(id);

  if (!cancelled) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'ERR_CANCEL_FAILED',
          message: `Cannot cancel job ${id}. It may have completed, failed, or already been cancelled.`,
        },
      },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    data: { id, cancelled: true },
  });
}
