'use client';

/**
 * MUXARO useFFmpegWorker Hook
 * React hook for orchestrating browser-side media processing via ffmpeg.wasm & Web Workers.
 * Features live progress tracking, cancellation support, and stream-copy defaults.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { FFmpegWorkerClient } from './ffmpeg-client.ts';
import type {
  ConvertTaskOptions,
  ExtractAudioTaskOptions,
  MergeTaskOptions,
  CustomExecTaskOptions,
  FFmpegTaskConfig,
  FFmpegTaskResult,
  FFmpegProgress,
  FFmpegWorkerState,
} from './types.ts';

const INITIAL_PROGRESS: FFmpegProgress = {
  ratio: 0,
  percent: 0,
};

export interface UseFFmpegWorkerReturn {
  isReady: boolean;
  isLoading: boolean;
  isProcessing: boolean;
  progress: FFmpegProgress;
  error: string | null;
  result: FFmpegTaskResult | null;
  convert: (options: Omit<ConvertTaskOptions, 'signal' | 'onProgress'>) => Promise<FFmpegTaskResult>;
  extractAudio: (options: Omit<ExtractAudioTaskOptions, 'signal' | 'onProgress'>) => Promise<FFmpegTaskResult>;
  merge: (options: Omit<MergeTaskOptions, 'signal' | 'onProgress'>) => Promise<FFmpegTaskResult>;
  runTask: (config: FFmpegTaskConfig) => Promise<FFmpegTaskResult>;
  cancel: () => void;
  reset: () => void;
}

export function useFFmpegWorker(): UseFFmpegWorkerReturn {
  const [isReady, setIsReady] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progress, setProgress] = useState<FFmpegProgress>(INITIAL_PROGRESS);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FFmpegTaskResult | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const clientRef = useRef<FFmpegWorkerClient | null>(null);
  const resultUrlRef = useRef<string | null>(null);

  useEffect(() => {
    resultUrlRef.current = result?.url || null;
  }, [result]);

  useEffect(() => {
    clientRef.current = FFmpegWorkerClient.getInstance();
    setIsLoading(true);
    clientRef.current
      .init()
      .then(() => {
        setIsReady(true);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setIsLoading(false);
      });

    return () => {
      // Abort any active task and revoke active result URL when component unmounts
      abortControllerRef.current?.abort();
      if (resultUrlRef.current) {
        URL.revokeObjectURL(resultUrlRef.current);
        resultUrlRef.current = null;
      }
    };
  }, []);

  const reset = useCallback(() => {
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current);
      resultUrlRef.current = null;
    }
    setIsProcessing(false);
    setProgress(INITIAL_PROGRESS);
    setError(null);
    setResult(null);
  }, []);

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsProcessing(false);
    setProgress(INITIAL_PROGRESS);
  }, []);

  const runTask = useCallback(
    async (config: FFmpegTaskConfig): Promise<FFmpegTaskResult> => {
      if (!clientRef.current) {
        clientRef.current = FFmpegWorkerClient.getInstance();
      }

      setIsProcessing(true);
      setError(null);
      setResult(null);
      setProgress({ ratio: 0, percent: 0, message: 'Starting process…' });

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const res = await clientRef.current.runTask({
          ...config,
          signal: controller.signal,
          onProgress: (p) => {
            setProgress(p);
            config.onProgress?.(p);
          },
        });
        setResult(res);
        setProgress({ ratio: 1, percent: 100, message: 'Completed' });
        return res;
      } catch (err: unknown) {
        if (controller.signal.aborted) {
          setError('Task cancelled.');
          throw new DOMException('Task cancelled.', 'AbortError');
        }
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      } finally {
        setIsProcessing(false);
        abortControllerRef.current = null;
      }
    },
    []
  );

  const convert = useCallback(
    async (options: Omit<ConvertTaskOptions, 'signal' | 'onProgress'>): Promise<FFmpegTaskResult> => {
      return runTask({
        action: 'convert',
        ...options,
      });
    },
    [runTask]
  );

  const extractAudio = useCallback(
    async (options: Omit<ExtractAudioTaskOptions, 'signal' | 'onProgress'>): Promise<FFmpegTaskResult> => {
      return runTask({
        action: 'extract-audio',
        ...options,
      });
    },
    [runTask]
  );

  const merge = useCallback(
    async (options: Omit<MergeTaskOptions, 'signal' | 'onProgress'>): Promise<FFmpegTaskResult> => {
      return runTask({
        action: 'merge',
        ...options,
      });
    },
    [runTask]
  );

  return {
    isReady,
    isLoading,
    isProcessing,
    progress,
    error,
    result,
    convert,
    extractAudio,
    merge,
    runTask,
    cancel,
    reset,
  };
}
