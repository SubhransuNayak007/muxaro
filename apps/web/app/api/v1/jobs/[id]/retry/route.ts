import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  return NextResponse.json({
    success: true,
    data: {
      id,
      status: 'QUEUED',
      progress: 0,
      stage: 'QUEUED',
      message: 'Job restarted successfully.',
    },
    requestId: `retry_${Date.now()}`,
  });
}
