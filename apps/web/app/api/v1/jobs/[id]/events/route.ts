import { NextRequest } from 'next/server';
import { jobManager, JobRecord } from '@/lib/job-manager';
import { proxyToBackend } from '@/lib/backend-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SSE_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type, Authorization, X-Requested-With',
  'Access-Control-Expose-Headers': 'Content-Disposition',
};

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const upstream = await proxyToBackend(req, `jobs/${encodeURIComponent(id)}/events`, { streaming: true, timeoutMs: 0 });
  if (upstream) return upstream;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let isClosed = false;

      const safeClose = () => {
        if (!isClosed) {
          isClosed = true;
          try {
            controller.close();
          } catch {}
        }
      };

      const sendEvent = (eventData: any) => {
        if (isClosed) return;
        try {
          const json = JSON.stringify(eventData);
          // Broadcast to progress listener and standard onmessage listener
          controller.enqueue(encoder.encode(`event: progress\ndata: ${json}\n\n`));
          controller.enqueue(encoder.encode(`data: ${json}\n\n`));

          if (eventData.status === 'READY' || eventData.status === 'COMPLETED') {
            controller.enqueue(encoder.encode(`event: complete\ndata: ${json}\n\nevent: done\ndata: ${json}\n\n`));
          } else if (eventData.status === 'FAILED' || eventData.status === 'CANCELLED') {
            controller.enqueue(encoder.encode(`event: error\ndata: ${json}\n\n`));
          }
        } catch {
          safeClose();
        }
      };

      const formatPayload = (job: JobRecord) => ({
        jobId: job.id,
        status: job.status.toUpperCase(),
        stage: job.stage,
        stageMessage: job.stageMessage,
        progress: job.progress,
        speed: job.speed || (job.status === 'ready' ? 'Complete' : undefined),
        etaSeconds: job.etaSeconds,
        downloadUrl: job.downloadUrl,
        artifact: job.artifact,
        error: job.error,
      });

      const initialJob = jobManager.getJob(id);
      if (!initialJob) {
        sendEvent({
          jobId: id,
          status: 'FAILED',
          stage: 'FAILED',
          stageMessage: 'Job was not found or expired.',
          error: { code: 'ERR_JOB_NOT_FOUND', message: 'Job not found' },
        });
        safeClose();
        return;
      }

      // 1. Immediately emit current progress snapshot
      sendEvent(formatPayload(initialJob));

      // If job is already terminal, close stream
      if (initialJob.status === 'ready' || initialJob.status === 'failed' || initialJob.status === 'cancelled') {
        safeClose();
        return;
      }

      // 2. Subscribe to live pipeline updates
      const unsubscribe = jobManager.subscribe(id, (updatedJob) => {
        sendEvent(formatPayload(updatedJob));

        if (
          updatedJob.status === 'ready' ||
          updatedJob.status === 'failed' ||
          updatedJob.status === 'cancelled'
        ) {
          unsubscribe();
          safeClose();
        }
      });

      // 3. Clean up subscription if client disconnects
      req.signal.addEventListener(
        'abort',
        () => {
          unsubscribe();
          safeClose();
        },
        { once: true }
      );
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...SSE_CORS_HEADERS,
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: SSE_CORS_HEADERS,
  });
}
