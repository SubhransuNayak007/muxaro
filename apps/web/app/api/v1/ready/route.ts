import { NextRequest, NextResponse } from 'next/server';
import {
  isServerlessRuntime,
  probeLocalMediaBinaries,
  proxyToBackend,
  resolveBackendBaseUrl,
} from '@/lib/backend-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const upstream = await proxyToBackend(req, 'ready', { timeoutMs: 8_000 });
  if (upstream) return upstream;

  const binaries = await probeLocalMediaBinaries();
  const isServerless = isServerlessRuntime();
  const backendConfigured = Boolean(resolveBackendBaseUrl());
  const ready = binaries.ffmpeg.available && binaries.ytdlp.available && !isServerless;

  return NextResponse.json(
    {
      ready,
      status: ready ? 'READY' : 'DEGRADED',
      backendConnected: backendConfigured,
      ffmpegAvailable: binaries.ffmpeg.available,
      ytdlpAvailable: binaries.ytdlp.available,
      isServerless,
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 503 }
  );
}
