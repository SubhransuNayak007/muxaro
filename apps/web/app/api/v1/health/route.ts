import { NextRequest, NextResponse } from 'next/server';
import {
  isServerlessRuntime,
  probeLocalMediaBinaries,
  proxyToBackend,
  resolveBackendBaseUrl,
} from '@/lib/backend-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export async function GET(req: NextRequest) {
  const upstream = await proxyToBackend(req, 'health', { timeoutMs: 10_000 });
  if (upstream) return upstream;

  const binaries = await probeLocalMediaBinaries();
  const isServerless = isServerlessRuntime();
  const backendConfigured = Boolean(resolveBackendBaseUrl());
  const localMediaOperational = binaries.ffmpeg.available && binaries.ytdlp.available && !isServerless;

  const statusCode = localMediaOperational ? 200 : 503;

  return NextResponse.json(
    {
      success: localMediaOperational,
      data: {
        status: localMediaOperational ? 'OPERATIONAL' : 'DEGRADED',
        version: '2.0.0',
        ffmpegAvailable: binaries.ffmpeg.available,
        ffmpegVersion: binaries.ffmpeg.version || null,
        ytdlpAvailable: binaries.ytdlp.available,
        ytdlpVersion: binaries.ytdlp.version || null,
        denoAvailable: binaries.deno.available,
        queueDepth: 0,
        environment: process.env.NODE_ENV || 'production',
        edgeRuntime: isServerless ? 'vercel-serverless' : 'node-local',
        storageMode: isServerless ? 'unbacked-serverless' : 'local',
        backendConnected: backendConfigured,
        workerPool: {
          activeWorkers: 0,
          totalSlots: localMediaOperational ? 4 : 0,
        },
        uptimeSeconds: Math.round(process.uptime()),
        smokeTestStatus: localMediaOperational ? 'PASS' : 'FAIL',
        notice: localMediaOperational
          ? 'Local Node media worker with native FFmpeg and yt-dlp is active.'
          : 'No media backend worker is connected (API_INTERNAL_URL unset) and local serverless runtime lacks native FFmpeg/yt-dlp. Configure the backend API or use in-browser local tools.',
      },
      requestId: `hlth_${Date.now()}`,
    },
    { status: statusCode, headers: CORS_HEADERS }
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
