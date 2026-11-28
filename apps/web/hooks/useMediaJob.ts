'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getApiBaseUrl, readCsrfTokenFromCookie } from '@/lib/api-client';

export type JobStatus =
  | 'IDLE'
  | 'QUEUED'
  | 'PROBING'
  | 'EXTRACTING'
  | 'TRANSCODING'
  | 'REMUXING'
  | 'PACKAGING'
  | 'READY'
  | 'FAILED'
  | 'CANCELLED';

export interface MediaJobError {
  code: string;
  message: string;
  userMessage?: string;
}

export interface MediaJobState {
  jobId: string | null;
  status: JobStatus;
  stage: string;
  stageMessage: string;
  progress: number;
  speed: string;
  etaSeconds: number;
  downloadUrl: string | null;
  error: MediaJobError | null;
  isConnected: boolean;
  isTerminal: boolean;
}

export interface MediaJobOptions {
  url: string;
  format?: 'mp4' | 'mp3' | 'webm' | 'mkv' | 'aac' | 'flac';
  quality?: 'best' | '1080p' | '720p' | '480p' | 'audio-only';
}

export interface UseMediaJobReturn extends MediaJobState {
  submitJob: (opts: MediaJobOptions) => Promise<string | null>;
  cancelJob: () => Promise<boolean>;
  retryJob: () => Promise<boolean>;
  reset: () => void;
}

const TERMINAL_STATUSES = new Set<JobStatus>(['READY', 'FAILED', 'CANCELLED']);

/**
 * Mobile-first async media job hook connecting to the dedicated worker backend.
 * Streams real-time progress over SSE without blocking serverless execution limits.
 */
export function useMediaJob(initialJobId?: string | null): UseMediaJobReturn {
  const [jobId, setJobId] = useState<string | null>(initialJobId || null);
  const [status, setStatus] = useState<JobStatus>(initialJobId ? 'QUEUED' : 'IDLE');
  const [stage, setStage] = useState<string>(initialJobId ? 'QUEUED' : 'IDLE');
  const [stageMessage, setStageMessage] = useState<string>(
    initialJobId ? 'Job queued in media worker fleet…' : ''
  );
  const [progress, setProgress] = useState<number>(0);
  const [speed, setSpeed] = useState<string>('1.0x');
  const [etaSeconds, setEtaSeconds] = useState<number>(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<MediaJobError | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const lastOptionsRef = useRef<MediaJobOptions | null>(null);

  const reset = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setJobId(null);
    setStatus('IDLE');
    setStage('IDLE');
    setStageMessage('');
    setProgress(0);
    setSpeed('1.0x');
    setEtaSeconds(0);
    setDownloadUrl(null);
    setError(null);
    setIsConnected(false);
  }, []);

  const connectSSE = useCallback((id: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const apiBase = getApiBaseUrl();
    const eventsUrl = `${apiBase}/jobs/${encodeURIComponent(id)}/events`;

    try {
      const es = new EventSource(eventsUrl, { withCredentials: true });
      eventSourceRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
      };

      es.onmessage = (event) => {
        if (!event.data) return;
        try {
          const payload = JSON.parse(event.data);
          const nextStatus = (payload.status || 'PROCESSING').toUpperCase() as JobStatus;
          setStatus(nextStatus);
          setStage(payload.stage || nextStatus);
          setStageMessage(payload.message || payload.stageMessage || '');

          const rawProgress = Number(payload.progressPercent ?? payload.progress);
          if (Number.isFinite(rawProgress)) {
            setProgress(Math.max(0, Math.min(100, Math.round(rawProgress))));
          } else if (nextStatus === 'READY') {
            setProgress(100);
          }

          if (payload.speed) setSpeed(payload.speed);
          if (typeof payload.etaSeconds === 'number') setEtaSeconds(payload.etaSeconds);
          if (payload.downloadUrl) setDownloadUrl(payload.downloadUrl);

          if (payload.error) {
            setError(
              typeof payload.error === 'string'
                ? { code: 'PROCESSING_ERROR', message: payload.error }
                : payload.error
            );
          }

          if (TERMINAL_STATUSES.has(nextStatus)) {
            es.close();
            eventSourceRef.current = null;
            setIsConnected(false);
          }
        } catch {
          // Ignore parse errors on ping/keep-alive frames
        }
      };

      es.onerror = () => {
        setIsConnected(false);
        // Do not force terminal failure immediately; EventSource auto-reconnects
      };
    } catch (err: any) {
      setIsConnected(false);
      setError({
        code: 'SSE_CONNECTION_FAILED',
        message: err?.message || 'Could not connect to job progress stream',
      });
    }
  }, []);

  useEffect(() => {
    if (jobId) {
      connectSSE(jobId);
    }
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [jobId, connectSSE]);

  const submitJob = useCallback(
    async (opts: MediaJobOptions): Promise<string | null> => {
      reset();
      lastOptionsRef.current = opts;
      setStatus('QUEUED');
      setStageMessage('Submitting to media worker pool…');

      try {
        const apiBase = getApiBaseUrl().replace(/\/+$/, '');
        const csrf = readCsrfTokenFromCookie();
        const res = await fetch(`${apiBase}/jobs`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(csrf ? { 'x-muxaro-csrf': csrf, 'X-CSRF-Token': csrf } : {}),
          },
          body: JSON.stringify({
            sourceUrl: opts.url,
            url: opts.url,
            targetFormat: opts.format || 'mp4',
            targetResolution: opts.quality || undefined,
          }),
        });

        if (!res.ok) {
          const errPayload = await res.json().catch(() => ({}));
          throw new Error(
            errPayload.message ||
              errPayload.userMessage ||
              `Server returned status ${res.status}`
          );
        }

        const data = await res.json();
        const newJobId = data.jobId || data.id;
        if (!newJobId) throw new Error('Missing jobId in server response');

        setJobId(newJobId);
        return newJobId;
      } catch (err: any) {
        setStatus('FAILED');
        setError({
          code: 'JOB_SUBMISSION_FAILED',
          message: err?.message || 'Failed to submit media processing job',
        });
        return null;
      }
    },
    [reset]
  );

  const cancelJob = useCallback(async (): Promise<boolean> => {
    if (!jobId) return false;
    try {
      const apiBase = getApiBaseUrl().replace(/\/+$/, '');
      const csrf = readCsrfTokenFromCookie();
      const res = await fetch(`${apiBase}/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'x-muxaro-csrf': csrf, 'X-CSRF-Token': csrf } : {}),
        },
      });
      if (res.ok) {
        setStatus('CANCELLED');
        setStageMessage('Job was cancelled.');
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [jobId]);

  const retryJob = useCallback(async (): Promise<boolean> => {
    if (lastOptionsRef.current) {
      const newId = await submitJob(lastOptionsRef.current);
      return Boolean(newId);
    }
    return false;
  }, [submitJob]);

  return {
    jobId,
    status,
    stage,
    stageMessage,
    progress,
    speed,
    etaSeconds,
    downloadUrl,
    error,
    isConnected,
    isTerminal: TERMINAL_STATUSES.has(status),
    submitJob,
    cancelJob,
    retryJob,
    reset,
  };
}
