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
      status: 'CANCELLED',
      message: 'Job cancelled by user.',
    },
    requestId: `cancel_${Date.now()}`,
  });
}
