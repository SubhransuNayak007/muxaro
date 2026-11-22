import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = params?.id || 'job_ready';
  const downloadEndpoint = `/api/v1/jobs/${id}/download`;

  return NextResponse.json({
    success: true,
    data: {
      id,
      status: 'COMPLETED',
      progress: 100,
      stage: 'READY',
      downloadUrl: downloadEndpoint,
      artifact: {
        filename: 'media_download.mp4',
        downloadUrl: downloadEndpoint,
        sizeBytes: 35000000,
      },
    },
    requestId: `job_${Date.now()}`,
  });
}
