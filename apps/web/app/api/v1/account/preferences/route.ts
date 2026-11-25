import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend } from '@/lib/backend-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

let preferencesCache = {
  ecoMode: false,
  autoDownload: true,
  defaultFormat: 'mp4',
  defaultQuality: '1080p',
};

export async function GET(req: NextRequest) {
  const upstream = await proxyToBackend(req, 'account/preferences');
  if (upstream) return upstream;

  return NextResponse.json({
    success: true,
    backendConnected: false,
    data: preferencesCache,
  });
}

export async function POST(req: NextRequest) {
  const upstream = await proxyToBackend(req, 'account/preferences');
  if (upstream) return upstream;

  try {
    const body = await req.json();
    preferencesCache = { ...preferencesCache, ...body };
    return NextResponse.json({
      success: true,
      backendConnected: false,
      data: preferencesCache,
    });
  } catch {
    return NextResponse.json({ success: true, backendConnected: false, data: preferencesCache });
  }
}
