import { NextRequest } from 'next/server';
import { jobManager, JobRecord } from '@/lib/job-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (eventData: any) => {
        try {
          const payload = `event: progress\ndata: ${JSON.stringify(eventData)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Stream might be closed
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
        controller.close();
        return;
      }

      // 1. Immediately emit current progress snapshot
      sendEvent(formatPayload(initialJob));

      // If job is already terminal, close stream
      if (initialJob.status === 'ready' || initialJob.status === 'failed' || initialJob.status === 'cancelled') {
        controller.close();
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
          try {
            controller.close();
          } catch {}
        }
      });

      // 3. Clean up subscription if client disconnects
      req.signal.addEventListener(
        'abort',
        () => {
          unsubscribe();
          try {
            controller.close();
          } catch {}
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
    },
  });
}
