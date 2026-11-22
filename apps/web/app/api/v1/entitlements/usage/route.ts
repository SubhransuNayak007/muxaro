import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      plan: 'pro',
      features: {
        maxResolution: '8k',
        audioBitrateKbps: 320,
        unlimitedDownloads: true,
        highPriorityQueue: true,
      },
    },
  });
}
