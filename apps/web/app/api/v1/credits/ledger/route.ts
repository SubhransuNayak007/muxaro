import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend } from '@/lib/backend-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const upstream = await proxyToBackend(req, 'credits/ledger');
  if (upstream) return upstream;

  return NextResponse.json({
    success: true,
    backendConnected: false,
    data: {
      transactions: [],
      total: 0,
    },
  });
}
