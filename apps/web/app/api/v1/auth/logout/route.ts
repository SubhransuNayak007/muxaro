import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend } from '@/lib/backend-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const upstream = await proxyToBackend(req, 'auth/logout');
  if (upstream) return upstream;

  return NextResponse.json({
    success: true,
    message: 'Logged out locally (no backend session active).',
  });
}
