/**
 * MUXARO Media Processing Engine - Video Transcoder & Remuxer
 * High performance video engine supporting automatic stream-copy (zero loss) and resolution transcoding up to 8K.
 */

import { FFmpegExecutor } from '../process/executor.js';
import { ProcessSanitizer } from '../process/sanitizer.js';
import { FFprobeRunner } from '../prober/ffprobe.js';
import { MediaClassifier } from '../prober/classifier.js';
import { VideoProcessingOptions, ProcessingResult } from '../types/transcode.js';
import { OutputVerifier } from '../verification/verifier.js';

export class VideoTranscoder {
  private ffmpegBinary: string;
  private prober: FFprobeRunner;

  constructor(ffmpegBinary = 'ffmpeg', ffprobeBinary = 'ffprobe') {
    this.ffmpegBinary = ffmpegBinary;
    this.prober = new FFprobeRunner(ffprobeBinary);
  }

  /**
   * Processes a video file: either stream-copies (if codecs and resolution match) or transcodes.
   */
  public async process(options: VideoProcessingOptions): Promise<ProcessingResult> {
    const startTime = Date.now();
    const validatedInput = ProcessSanitizer.validatePath(options.inputPath);
    const validatedOutput = ProcessSanitizer.validatePath(options.outputPath);

    // 1. Probe input metadata
    options.onProgress?.({
      stage: 'probing',
      percentage: 5,
      currentTimeSeconds: 0,
      totalDurationSeconds: 0,
      message: 'Inspecting media streams and codecs...'
    });

    const metadata = await this.prober.probe(validatedInput);
    const primaryVideo = metadata.primaryVideoStream;
    if (!primaryVideo) {
      throw new Error(`Cannot process video: No video stream found in input "${options.inputPath}"`);
    }

    const primaryAudio = metadata.primaryAudioStream;
    const totalDuration = metadata.container.durationSeconds || primaryVideo.durationSeconds;

    // 2. Evaluate if stream-copy is possible
    const copyEvaluation = MediaClassifier.canStreamCopyVideo(
      primaryVideo,
      primaryAudio,
      options.targetContainer,
      options.targetResolution,
      options.targetCodec
    );

    const args: string[] = ['-y', '-v', 'error', '-i', validatedInput];

    let actionTaken: ProcessingResult['actionTaken'];

    if (copyEvaluation.canCopyVideo) {
      // STREAM-COPY PIPELINE (Near-zero CPU, loss-free)
      actionTaken = 'STREAM_COPY';
      args.push('-c:v', 'copy');

      if (copyEvaluation.canCopyAudio) {
        args.push('-c:a', 'copy');
      } else if (primaryAudio) {
        // Transcode only audio to match target container
        if (options.targetContainer === 'webm') {
          args.push('-c:a', 'libopus', '-b:a', '160k');
        } else {
          args.push('-c:a', 'aac', '-b:a', '256k');
        }
      }

      // Faststart for MP4 streaming
      if (options.targetContainer === 'mp4') {
        args.push('-movflags', '+faststart');
      }
    } else {
      // TRANSCODE PIPELINE
      actionTaken = 'TRANSCODE';

      // Scaling filter (scale maintaining aspect ratio, capping at source resolution, even dimensions)
      const targetDims = MediaClassifier.computeTargetDimensions(
        primaryVideo.width,
        primaryVideo.height,
        options.targetResolution
      );

      if (targetDims.needsScaling) {
        args.push('-vf', `scale=${targetDims.targetWidth}:${targetDims.targetHeight}`);
      }

      // Video encoder selection
      const targetCodec = options.targetCodec ?? (options.targetContainer === 'webm' ? 'vp9' : 'h264');
      const preset = options.preset ?? 'medium';

      if (targetCodec === 'vp9' || options.targetContainer === 'webm') {
        args.push(
          '-c:v', 'libvpx-vp9',
          '-crf', (options.crf ?? 30).toString(),
          '-b:v', '0',
          '-row-mt', '1'
        );
      } else if (targetCodec === 'hevc') {
        args.push(
          '-c:v', 'libx265',
          '-preset', preset,
          '-crf', (options.crf ?? 23).toString(),
          '-pix_fmt', primaryVideo.isHdr ? 'yuv420p10le' : 'yuv420p'
        );
      } else if (targetCodec === 'av1') {
        args.push(
          '-c:v', 'libsvtav1',
          '-crf', (options.crf ?? 26).toString(),
          '-preset', '6'
        );
      } else {
        // Default H.264
        args.push(
          '-c:v', 'libx264',
          '-preset', preset,
          '-crf', (options.crf ?? 20).toString(),
          '-pix_fmt', 'yuv420p'
        );
      }

      // Audio stream handling
      if (primaryAudio) {
        if (options.targetContainer === 'webm') {
          args.push('-c:a', 'libopus', '-b:a', `${options.audioBitrateKbps ?? 160}k`);
        } else if (options.audioCodec === 'copy' && copyEvaluation.canCopyAudio) {
          args.push('-c:a', 'copy');
        } else {
          args.push('-c:a', 'aac', '-b:a', `${options.audioBitrateKbps ?? 256}k`);
        }
      }

      if (options.targetContainer === 'mp4') {
        args.push('-movflags', '+faststart');
      }
    }

    // Add progress reporting pipe
    args.push('-progress', 'pipe:1', validatedOutput);

    // 3. Execute FFmpeg
    options.onProgress?.({
      stage: actionTaken === 'STREAM_COPY' ? 'remuxing' : 'transcoding',
      percentage: 10,
      currentTimeSeconds: 0,
      totalDurationSeconds: totalDuration,
      message: actionTaken === 'STREAM_COPY' ? 'Stream-copying without re-encoding...' : 'Transcoding video...'
    });

    const execution = await FFmpegExecutor.execute(this.ffmpegBinary, args, {
      totalDurationSeconds: totalDuration,
      stage: actionTaken === 'STREAM_COPY' ? 'remuxing' : 'transcoding',
      timeoutMs: options.timeoutMs,
      onProgress: options.onProgress
    });

    if (execution.exitCode !== 0) {
      throw new Error(`FFmpeg video processing failed (exit code ${execution.exitCode}): ${execution.stderr || execution.stdout}`);
    }

    // 4. Output Verification
    options.onProgress?.({
      stage: 'verifying',
      percentage: 95,
      currentTimeSeconds: totalDuration,
      totalDurationSeconds: totalDuration,
      message: 'Verifying output stream integrity...'
    });

    const verifier = new OutputVerifier(this.prober);
    const verification = await verifier.verify(validatedOutput, {
      expectedDurationSeconds: totalDuration,
      requireVideo: true,
      requireAudio: primaryAudio !== undefined,
      maxDurationDeviationSeconds: 1.5
    });

    if (!verification.valid) {
      throw new Error(`Output verification failed: ${verification.errors.join('; ')}`);
    }

    options.onProgress?.({
      stage: 'completed',
      percentage: 100,
      currentTimeSeconds: totalDuration,
      totalDurationSeconds: totalDuration,
      message: 'Video processing complete.'
    });

    return {
      success: true,
      outputPath: validatedOutput,
      actionTaken,
      durationSeconds: verification.durationSeconds,
      fileSizeBytes: verification.fileSizeBytes,
      metadata,
      verification,
      processingTimeMs: Date.now() - startTime
    };
  }
}
