import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      history: [],
      total: 0,
    },
    requestId: `hist_${Date.now()}`,
  });
}
