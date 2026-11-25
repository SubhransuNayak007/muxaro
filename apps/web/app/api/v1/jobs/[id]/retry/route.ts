import { NextRequest } from 'next/server';
import { jobManager } from '@/lib/job-manager';
import { createApiErrorResponse } from '@/lib/api-error';
import { proxyToBackend } from '@/lib/backend-proxy';

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
  const requestId = `retry_${Date.now()}`;

  const localJob = jobManager.getJob(id);
  if (!localJob) {
    const upstream = await proxyToBackend(req, `jobs/${encodeURIComponent(id)}/retry`);
    if (upstream) return upstream;
  }

  const job = localJob;
  if (!job) {
    return createApiErrorResponse(
      `Job ${id} not found or has expired.`,
      'INVALID_URL',
      requestId,
      CORS_HEADERS
    );
  }

  // If the job was blocked by host bot detection or 403:
  if (
    job.error?.code === 'HOST_BLOCKED' ||
    job.error?.code === 'ERR_YOUTUBE_BOT_CHECK' ||
    job.stageMessage?.toLowerCase().includes('bot') ||
    job.stageMessage?.toLowerCase().includes('403')
  ) {
    return createApiErrorResponse(
      job.error?.message || 'Host blocked request (bot check / HTTP 403). Proxy retries are disabled.',
      'HOST_BLOCKED',
      requestId,
      CORS_HEADERS
    );
  }

  // No fake proxy rotation or fake retries
  return createApiErrorResponse(
    'Server proxy retries have been removed. Please use direct client browser stream or companion.',
    'HOST_BLOCKED',
    requestId,
    CORS_HEADERS
  );
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
