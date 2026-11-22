import { NextRequest } from 'next/server';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const searchParams = req.nextUrl.searchParams;
  const rawUrl = searchParams.get('url') || '';
  const format = searchParams.get('format') || 'mp4';
  const filename = searchParams.get('filename') || `media_${id}.${format}`;

  const downloadUrl = `/api/v1/jobs/${id}/download?url=${encodeURIComponent(
    rawUrl
  )}&filename=${encodeURIComponent(filename)}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 1. Initial processing event
        const initialPayload = JSON.stringify({
          jobId: id,
          status: 'PROCESSING',
          stage: 'REMUXING',
          stageMessage: 'Demuxing audio/video streams…',
          progress: 80,
          speed: '14.2x',
          etaSeconds: 1,
        });
        controller.enqueue(
          encoder.encode(`event: progress\ndata: ${initialPayload}\n\n`)
        );

        // Small delay to allow UI animation
        await new Promise((resolve) => setTimeout(resolve, 400));

        // 2. Ready completion event
        const readyPayload = JSON.stringify({
          jobId: id,
          status: 'READY',
          stage: 'READY',
          stageMessage: 'Media ready for instant download',
          progress: 100,
          speed: 'Complete',
          etaSeconds: 0,
          downloadUrl,
          artifact: {
            filename,
            downloadUrl,
            format,
            sizeBytes: 35000000,
          },
        });
        controller.enqueue(
          encoder.encode(`event: progress\ndata: ${readyPayload}\n\n`)
        );

        // 3. Close the stream cleanly
        controller.close();
      } catch {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
