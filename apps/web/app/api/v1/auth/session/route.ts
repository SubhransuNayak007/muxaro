import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend } from '@/lib/backend-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const upstream = await proxyToBackend(req, 'auth/session');
  if (upstream) return upstream;

  const googleClientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const googleAuthConfigured = Boolean(googleClientId.length > 0);

  return NextResponse.json({
    authenticated: false,
    user: null,
    guestId: `guest_${Date.now()}`,
    googleAuthConfigured,
    backendConnected: false,
  });
}
