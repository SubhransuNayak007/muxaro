import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    authenticated: false,
    user: null,
    guestId: `guest_${Date.now()}`,
  });
}
