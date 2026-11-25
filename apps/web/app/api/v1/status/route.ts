import { NextRequest, NextResponse } from 'next/server';
import { jobManager } from '@/lib/job-manager';
import type { SystemHealthStatus } from '@/lib/contracts';
import {
  isServerlessRuntime,
  probeLocalMediaBinaries,
  proxyToBackend,
} from '@/lib/backend-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const upstream = await proxyToBackend(req, 'health', { timeoutMs: 8_000 });
  if (upstream) return upstream;

  const binaries = await probeLocalMediaBinaries();
  const isServerless = isServerlessRuntime();
  const allJobs = jobManager.listJobs();
  const activeJobs = allJobs.filter(
    (j) => j.status !== 'ready' && j.status !== 'failed' && j.status !== 'cancelled'
  ).length;

  const isHealthy = binaries.ytdlp.available && binaries.ffmpeg.available && !isServerless;

  const healthData: SystemHealthStatus & { version: string; runtime: string } = {
    status: isHealthy ? 'healthy' : 'degraded',
    version: '2.0.0',
    runtime: isServerless ? 'vercel-serverless' : 'node-media-systems',
    ytdlp: binaries.ytdlp,
    ffmpeg: binaries.ffmpeg,
    ffprobe: binaries.ffprobe,
    activeJobs,
    maxConcurrentJobs: isHealthy ? 10 : 0,
    checkedAt: new Date().toISOString(),
  };

  return NextResponse.json(
    {
      success: isHealthy,
      data: healthData,
      requestId: `status_${Date.now()}`,
    },
    { status: isHealthy ? 200 : 503 }
  );
}
