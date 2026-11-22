'use client';

/**
 * Project MUXARO - Server-Sent Events (SSE) Real-Time Job Stream Hook
 * Connects to /api/v1/jobs/:id/events with:
 * - Resilient automatic reconnection with exponential backoff
 * - Accurate multi-stage tracking (Queued, Extracting, Transcoding, Remuxing, Packaging, Ready)
 * - Live progress percentage, ETA in seconds, and processing speed factor
 * - Full error payload propagation and action controls (cancel, retry, reconnect)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { JobProgressEvent, ProcessingJob } from '@/lib/types';
import { getApiBaseUrl } from '@/lib/api-client';

export interface JobStreamError {
  code: string;
  message: string;
  userMessage?: string;
}

export interface UseJobStreamState {
  jobId: string | null;
  status: string;
  stage: string;
  stageMessage: string;
  progress: number;
  speed: string; // e.g. "3.2x" or "14.2 MB/s"
  etaSeconds: number;
  downloadUrl: string | null;
  artifact: any | null;
  error: JobStreamError | null;
  isConnected: boolean;
  isTerminal: boolean;
  reconnectAttempts: number;
}

export interface UseJobStreamActions {
  cancel: () => Promise<boolean>;
  retry: () => Promise<boolean>;
  reconnect: () => void;
  reset: () => void;
}

const TERMINAL_STATUSES = new Set(['READY', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED']);
const MAX_RECONNECT_ATTEMPTS = 8;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 12000;

export function useJobStream(initialJobId?: string | null): UseJobStreamState & UseJobStreamActions {
  const [jobId, setJobId] = useState<string | null>(initialJobId || null);
  const [status, setStatus] = useState<string>('QUEUED');
  const [stage, setStage] = useState<string>('QUEUED');
  const [stageMessage, setStageMessage] = useState<string>('Job queued for processing…');
  const [progress, setProgress] = useState<number>(0);
  const [speed, setSpeed] = useState<string>('1.0x');
  const [etaSeconds, setEtaSeconds] = useState<number>(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<any | null>(null);
  const [error, setError] = useState<JobStreamError | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isTerminal, setIsTerminal] = useState<boolean>(false);
  const [reconnectAttempts, setReconnectAttempts] = useState<number>(0);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const lastProgressRef = useRef<{ time: number; pct: number }>({ time: Date.now(), pct: 0 });

  // Update internal jobId when external prop changes
  useEffect(() => {
    if (initialJobId && initialJobId !== jobId) {
      setJobId(initialJobId);
      setStatus('QUEUED');
      setStage('QUEUED');
      setProgress(0);
      setIsTerminal(false);
      setError(null);
      setDownloadUrl(null);
      startTimeRef.current = Date.now();
      lastProgressRef.current = { time: Date.now(), pct: 0 };
    }
  }, [initialJobId, jobId]);

  const cleanupStream = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const calculateEtaAndSpeed = useCallback((newPct: number) => {
    const now = Date.now();
    const elapsedTotalSec = (now - startTimeRef.current) / 1000;

    if (newPct > 0 && newPct < 100) {
      // Calculate overall speed and ETA based on overall progress
      const remainingPct = 100 - newPct;
      const ratePerSec = newPct / Math.max(1, elapsedTotalSec);
      const estimatedSec = Math.max(1, Math.round(remainingPct / Math.max(0.01, ratePerSec)));
      setEtaSeconds(estimatedSec);

      // Speed indicator: progress multiplier compared to 1%/s baseline
      const speedMultiplier = (ratePerSec / 1.0).toFixed(1);
      setSpeed(`${Math.max(0.5, parseFloat(speedMultiplier))}x`);
    } else if (newPct >= 100) {
      setEtaSeconds(0);
      setSpeed('Complete');
    }

    lastProgressRef.current = { time: now, pct: newPct };
  }, []);

  const handleProgressEvent = useCallback(
    (data: any) => {
      if (!data) return;

      const newStatus = String(data.status || status).toUpperCase();
      const newStage = String(data.stage || data.status || stage).toUpperCase();
      const newPct = typeof data.progress === 'number' ? Math.min(100, Math.max(0, data.progress)) : progress;
      const newMsg = data.message || data.stageMessage || `${newStage.toLowerCase()} in progress…`;

      setStatus(newStatus);
      setStage(newStage);
      setStageMessage(newMsg);
      setProgress(newPct);

      calculateEtaAndSpeed(newPct);

      if (data.downloadUrl) {
        setDownloadUrl(data.downloadUrl);
      }
      if (data.artifact) {
        setArtifact(data.artifact);
      }
      if (data.error) {
        setError(data.error);
      }

      if (TERMINAL_STATUSES.has(newStatus)) {
        setIsTerminal(true);
        cleanupStream();
      }
    },
    [status, stage, progress, calculateEtaAndSpeed, cleanupStream]
  );

  // Polling fallback helper
  const pollJobStatus = useCallback(
    async (targetJobId: string): Promise<boolean> => {
      try {
        const apiBase = getApiBaseUrl().replace(/\/+$/, '');
        const res = await fetch(`${apiBase}/jobs/${encodeURIComponent(targetJobId)}`);
        if (res.ok) {
          const body = await res.json();
          const job = body?.data || body;
          if (job) {
            const s = String(job.status || '').toUpperCase();
            if (s) setStatus(s);
            if (job.progress !== undefined) {
              setProgress(Math.min(100, Math.max(0, Number(job.progress))));
            }
            if (job.stage || job.progressStage) {
              setStage(String(job.stage || job.progressStage).toUpperCase());
            }
            if (job.stageMessage) {
              setStageMessage(String(job.stageMessage));
            }
            if (job.downloadUrl || job.artifact?.downloadUrl) {
              setDownloadUrl(job.downloadUrl || job.artifact?.downloadUrl);
            }
            if (s === 'READY' || s === 'COMPLETED') {
              setStatus('READY');
              setProgress(100);
              setIsTerminal(true);
              cleanupStream();
              return true;
            }
          }
        }
      } catch {}
      return false;
    },
    [cleanupStream]
  );

  const connect = useCallback(() => {
    if (!jobId || typeof window === 'undefined') return;

    cleanupStream();

    const apiBase = getApiBaseUrl().replace(/\/+$/, '');
    const url = `${apiBase}/jobs/${encodeURIComponent(jobId)}/events`;

    try {
      const es = new EventSource(url, { withCredentials: true });
      eventSourceRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
        setReconnectAttempts(0);
      };

      es.onmessage = (e: MessageEvent) => {
        try {
          const parsed = JSON.parse(e.data);
          handleProgressEvent(parsed);
        } catch (parseErr) {
          console.warn('[useJobStream] Failed to parse message event data:', parseErr);
        }
      };

      es.addEventListener('progress', (e: MessageEvent) => {
        try {
          const parsed = JSON.parse(e.data);
          handleProgressEvent(parsed);
        } catch (parseErr) {
          console.warn('[useJobStream] Failed to parse progress event data:', parseErr);
        }
      });

      es.addEventListener('complete', (e: MessageEvent) => {
        try {
          const parsed = JSON.parse(e.data);
          handleProgressEvent(parsed);
        } catch {
          setStatus('READY');
          setProgress(100);
        }
        setIsTerminal(true);
        cleanupStream();
      });

      es.addEventListener('error', (e: any) => {
        setIsConnected(false);

        // If job already terminal, close and don't reconnect
        if (isTerminal) {
          cleanupStream();
          return;
        }

        // Check if event carries custom error data
        if (e && e.data) {
          try {
            const errData = JSON.parse(e.data);
            setError(errData);
            setStatus('FAILED');
            setIsTerminal(true);
            cleanupStream();
            return;
          } catch {}
        }

        // Automatic reconnection with exponential backoff & polling fallback
        es.close();
        eventSourceRef.current = null;
        if (jobId) {
          pollJobStatus(jobId);
        }

        setReconnectAttempts((prev) => {
          const nextAttempt = prev + 1;
          if (nextAttempt <= MAX_RECONNECT_ATTEMPTS) {
            const backoff = Math.min(
              MAX_BACKOFF_MS,
              INITIAL_BACKOFF_MS * Math.pow(1.5, nextAttempt - 1) + Math.random() * 500
            );
            reconnectTimerRef.current = setTimeout(() => {
              connect();
            }, backoff);
          } else {
            setError({
              code: 'ERR_SSE_CONNECTION_LOST',
              message: 'Lost live connection to media processor. Check status or refresh.',
              userMessage: 'Live updates interrupted. Your job is still processing in background.',
            });
          }
          return nextAttempt;
        });
      });
    } catch (err: any) {
      console.error('[useJobStream] Connection failed:', err);
      setIsConnected(false);
      if (jobId) {
        pollJobStatus(jobId);
      }
    }
  }, [jobId, isTerminal, cleanupStream, handleProgressEvent, pollJobStatus]);

  // Lifecycle subscription with SSE + Polling fallback
  useEffect(() => {
    if (jobId && !isTerminal) {
      connect();

      // Polling fallback interval every 1.5s
      const pollTimer = setInterval(() => {
        pollJobStatus(jobId);
      }, 1500);

      return () => {
        clearInterval(pollTimer);
        cleanupStream();
      };
    }
    return () => {
      cleanupStream();
    };
  }, [jobId, connect, cleanupStream, isTerminal, pollJobStatus]);

  const cancel = useCallback(async (): Promise<boolean> => {
    if (!jobId) return false;
    try {
      const apiBase = (process.env.NEXT_PUBLIC_API_URL || '/api/v1').replace(/\/+$/, '');
      const res = await fetch(`${apiBase}/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        setStatus('CANCELLED');
        setIsTerminal(true);
        cleanupStream();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [jobId, cleanupStream]);

  const retry = useCallback(async (): Promise<boolean> => {
    if (!jobId) return false;
    try {
      const apiBase = (process.env.NEXT_PUBLIC_API_URL || '/api/v1').replace(/\/+$/, '');
      const res = await fetch(`${apiBase}/jobs/${encodeURIComponent(jobId)}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const body = await res.json();
        const newJobId = body.data?.jobId || jobId;
        setJobId(newJobId);
        setStatus('QUEUED');
        setStage('QUEUED');
        setProgress(0);
        setError(null);
        setIsTerminal(false);
        startTimeRef.current = Date.now();
        connect();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [jobId, connect]);

  const reconnect = useCallback(() => {
    setReconnectAttempts(0);
    connect();
  }, [connect]);

  const reset = useCallback(() => {
    cleanupStream();
    setJobId(null);
    setStatus('QUEUED');
    setStage('QUEUED');
    setProgress(0);
    setError(null);
    setDownloadUrl(null);
    setIsTerminal(false);
    setReconnectAttempts(0);
  }, [cleanupStream]);

  return {
    jobId,
    status,
    stage,
    stageMessage,
    progress,
    speed,
    etaSeconds,
    downloadUrl,
    artifact,
    error,
    isConnected,
    isTerminal,
    reconnectAttempts,
    cancel,
    retry,
    reconnect,
    reset,
  };
}
