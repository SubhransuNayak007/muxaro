import { NextResponse } from 'next/server';

export async function GET() {
  const googleClientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const googleAuthConfigured = Boolean(googleClientId.length > 0);

  return NextResponse.json({
    authenticated: false,
    user: null,
    guestId: `guest_${Date.now()}`,
    googleAuthConfigured,
  });
}
