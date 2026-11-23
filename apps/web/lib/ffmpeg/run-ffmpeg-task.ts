/**
 * MUXARO runFFmpegTask
 * Standalone programmatic helper to run client-side media tasks via the shared ffmpeg worker.
 * Works outside React components, in scripts, background download workers, or utilities.
 */

import { FFmpegWorkerClient } from './ffmpeg-client';
import {
  FFmpegTaskConfig,
  FFmpegTaskResult,
  ConvertTaskOptions,
  ExtractAudioTaskOptions,
  MergeTaskOptions,
  CustomExecTaskOptions,
  FFmpegProgress,
} from './types';

/**
 * Executes a media task using the client-side shared ffmpeg worker.
 * Defaults to stream-copy (-c copy) for instantaneous 2–5s completion.
 *
 * @example
 * ```ts
 * const result = await runFFmpegTask({
 *   action: 'convert',
 *   file: videoBlob,
 *   targetContainer: 'mp4',
 *   onProgress: (p) => console.log(`${p.percent}%`),
 * });
 * console.log('Download URL:', result.url);
 * ```
 */
export async function runFFmpegTask(
  config: FFmpegTaskConfig,
  onProgress?: (progress: FFmpegProgress) => void
): Promise<FFmpegTaskResult> {
  const client = FFmpegWorkerClient.getInstance();
  if (onProgress && !config.onProgress) {
    config.onProgress = onProgress;
  }
  return client.runTask(config);
}

/**
 * Convenience helper to convert video container format.
 */
export async function runConvertTask(
  options: ConvertTaskOptions,
  onProgress?: (progress: FFmpegProgress) => void
): Promise<FFmpegTaskResult> {
  return runFFmpegTask(
    {
      action: 'convert',
      ...options,
    },
    onProgress
  );
}

/**
 * Convenience helper to extract audio track.
 */
export async function runExtractAudioTask(
  options: ExtractAudioTaskOptions,
  onProgress?: (progress: FFmpegProgress) => void
): Promise<FFmpegTaskResult> {
  return runFFmpegTask(
    {
      action: 'extract-audio',
      ...options,
    },
    onProgress
  );
}

/**
 * Convenience helper to merge separate video and audio tracks.
 */
export async function runMergeTask(
  options: MergeTaskOptions,
  onProgress?: (progress: FFmpegProgress) => void
): Promise<FFmpegTaskResult> {
  return runFFmpegTask(
    {
      action: 'merge',
      ...options,
    },
    onProgress
  );
}
