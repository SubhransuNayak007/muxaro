/**
 * MUXARO Media Processing Engine - Audio / Video Merger
 * Synchronizes and multiplexes separate video and audio tracks with sync validation,
 * millisecond offset calibration, and smart stream-copy remuxing.
 */

import { FFmpegExecutor } from '../process/executor.js';
import { ProcessSanitizer } from '../process/sanitizer.js';
import { FFprobeRunner } from '../prober/ffprobe.js';
import { MediaClassifier } from '../prober/classifier.js';
import { MergeOptions, ProcessingResult } from '../types/transcode.js';
import { OutputVerifier } from '../verification/verifier.js';

export class MediaMerger {
  private ffmpegBinary: string;
  private prober: FFprobeRunner;

  constructor(ffmpegBinary = 'ffmpeg', ffprobeBinary = 'ffprobe') {
    this.ffmpegBinary = ffmpegBinary;
    this.prober = new FFprobeRunner(ffprobeBinary);
  }

  /**
   * Merges a separate video file and audio file into a single synchronized container.
   */
  public async merge(options: MergeOptions): Promise<ProcessingResult> {
    const startTime = Date.now();
    const validatedVideoInput = ProcessSanitizer.validatePath(options.videoInputPath);
    const validatedAudioInput = ProcessSanitizer.validatePath(options.audioInputPath);
    const validatedOutput = ProcessSanitizer.validatePath(options.outputPath);
    const targetContainer = options.targetContainer ?? 'mp4';

    // 1. Probe both inputs for sync validation
    options.onProgress?.({
      stage: 'probing',
      percentage: 5,
      currentTimeSeconds: 0,
      totalDurationSeconds: 0,
      message: 'Probing video and audio inputs for sync alignment...'
    });

    const [videoMeta, audioMeta] = await Promise.all([
      this.prober.probe(validatedVideoInput),
      this.prober.probe(validatedAudioInput)
    ]);

    const videoStream = videoMeta.primaryVideoStream;
    if (!videoStream) {
      throw new Error(`Video input "${options.videoInputPath}" contains no video stream.`);
    }

    const audioStream = audioMeta.primaryAudioStream;
    if (!audioStream) {
      throw new Error(`Audio input "${options.audioInputPath}" contains no audio stream.`);
    }

    const videoDuration = videoMeta.container.durationSeconds || videoStream.durationSeconds;
    const audioDuration = audioMeta.container.durationSeconds || audioStream.durationSeconds;

    // Sync drift calculation
    const durationDriftSeconds = Math.abs(videoDuration - audioDuration);
    const totalDuration = Math.min(videoDuration, audioDuration) || Math.max(videoDuration, audioDuration);

    // 2. Evaluate codec compatibility with target container
    const canCopyVideo = MediaClassifier.isVideoCodecCompatibleWithContainer(videoStream.codec, targetContainer);
    const canCopyAudio = MediaClassifier.isAudioCodecCompatibleWithContainer(audioStream.codec, targetContainer);

    const args: string[] = ['-y', '-v', 'error'];

    // Handle audio offset correction if specified
    const offsetMs = options.audioOffsetMs ?? 0;
    if (offsetMs > 0) {
      // Delay audio by N seconds
      const offsetSeconds = (offsetMs / 1000).toFixed(3);
      args.push('-i', validatedVideoInput);
      args.push('-itsoffset', offsetSeconds, '-i', validatedAudioInput);
    } else if (offsetMs < 0) {
      // Advance audio (delay video by abs(N) seconds)
      const offsetSeconds = (Math.abs(offsetMs) / 1000).toFixed(3);
      args.push('-itsoffset', offsetSeconds, '-i', validatedVideoInput);
      args.push('-i', validatedAudioInput);
    } else {
      args.push('-i', validatedVideoInput);
      args.push('-i', validatedAudioInput);
    }

    // Map input streams: video from first input, audio from second
    args.push('-map', '0:v:0', '-map', '1:a:0');

    let actionTaken: ProcessingResult['actionTaken'];

    if (canCopyVideo && canCopyAudio && options.preferStreamCopy !== false) {
      actionTaken = 'MERGE_STREAM_COPY';
      args.push('-c:v', 'copy', '-c:a', 'copy');
    } else {
      actionTaken = 'MERGE_TRANSCODE';
      if (canCopyVideo) {
        args.push('-c:v', 'copy');
      } else {
        args.push('-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p');
      }

      if (canCopyAudio) {
        args.push('-c:a', 'copy');
      } else {
        if (targetContainer === 'webm') {
          args.push('-c:a', 'libopus', '-b:a', '160k');
        } else {
          args.push('-c:a', 'aac', '-b:a', '256k');
        }
      }
    }

    // Use shortest stream to avoid trailing frozen video or silence
    args.push('-shortest');

    if (targetContainer === 'mp4') {
      args.push('-movflags', '+faststart');
    }

    args.push('-progress', 'pipe:1', validatedOutput);

    // 3. Execute Merge
    options.onProgress?.({
      stage: 'merging',
      percentage: 15,
      currentTimeSeconds: 0,
      totalDurationSeconds: totalDuration,
      message: actionTaken === 'MERGE_STREAM_COPY' ? 'Remuxing video and audio streams (zero loss)...' : 'Multiplexing with transcoding...'
    });

    const execution = await FFmpegExecutor.execute(this.ffmpegBinary, args, {
      totalDurationSeconds: totalDuration,
      stage: 'merging',
      timeoutMs: options.timeoutMs,
      onProgress: options.onProgress
    });

    if (execution.exitCode !== 0) {
      throw new Error(`FFmpeg merge failed (exit code ${execution.exitCode}): ${execution.stderr || execution.stdout}`);
    }

    // 4. Output Verification
    options.onProgress?.({
      stage: 'verifying',
      percentage: 95,
      currentTimeSeconds: totalDuration,
      totalDurationSeconds: totalDuration,
      message: 'Verifying merged container integrity...'
    });

    const verifier = new OutputVerifier(this.prober);
    const verification = await verifier.verify(validatedOutput, {
      expectedDurationSeconds: totalDuration,
      requireVideo: true,
      requireAudio: true,
      maxDurationDeviationSeconds: 2.0
    });

    if (durationDriftSeconds > 1.0) {
      verification.warnings.push(
        `Source video (${videoDuration.toFixed(1)}s) and audio (${audioDuration.toFixed(1)}s) duration drift of ${durationDriftSeconds.toFixed(1)}s was detected and trimmed with -shortest.`
      );
    }

    if (!verification.valid) {
      throw new Error(`Merged output verification failed: ${verification.errors.join('; ')}`);
    }

    options.onProgress?.({
      stage: 'completed',
      percentage: 100,
      currentTimeSeconds: totalDuration,
      totalDurationSeconds: totalDuration,
      message: 'Merge operation complete.'
    });

    return {
      success: true,
      outputPath: validatedOutput,
      actionTaken,
      durationSeconds: verification.durationSeconds,
      fileSizeBytes: verification.fileSizeBytes,
      metadata: videoMeta,
      verification,
      processingTimeMs: Date.now() - startTime
    };
  }
}
