import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend } from '@/lib/backend-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const upstream = await proxyToBackend(req, 'account/history');
  if (upstream) return upstream;

  return NextResponse.json({
    success: true,
    backendConnected: false,
    data: {
      history: [],
      total: 0,
    },
    requestId: `hist_${Date.now()}`,
  });
}
