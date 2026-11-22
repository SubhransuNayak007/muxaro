import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      status: 'OPERATIONAL',
      version: '2.0.0',
      runtime: 'vercel-serverless',
      region: process.env.VERCEL_REGION || 'global',
      timestamp: new Date().toISOString(),
    },
  });
}
