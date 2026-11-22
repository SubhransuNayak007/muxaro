import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    ready: true,
    status: 'READY',
    timestamp: new Date().toISOString(),
  });
}
