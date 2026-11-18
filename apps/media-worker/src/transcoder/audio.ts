/**
 * MUXARO Media Processing Engine - Audio Extractor & Converter
 * Audio pipeline with native stream-copy, high quality transcoding, and the strict honesty principle.
 */

import { FFmpegExecutor } from '../process/executor.js';
import { ProcessSanitizer } from '../process/sanitizer.js';
import { FFprobeRunner } from '../prober/ffprobe.js';
import { MediaClassifier } from '../prober/classifier.js';
import { AudioExtractionOptions, ProcessingResult, AudioQualityHonestyReport } from '../types/transcode.js';
import { OutputVerifier } from '../verification/verifier.js';

export class AudioExtractor {
  private ffmpegBinary: string;
  private prober: FFprobeRunner;

  constructor(ffmpegBinary = 'ffmpeg', ffprobeBinary = 'ffprobe') {
    this.ffmpegBinary = ffmpegBinary;
    this.prober = new FFprobeRunner(ffprobeBinary);
  }

  /**
   * Extracts and converts audio from a media file.
   */
  public async extract(options: AudioExtractionOptions): Promise<ProcessingResult> {
    const startTime = Date.now();
    const validatedInput = ProcessSanitizer.validatePath(options.inputPath);
    const validatedOutput = ProcessSanitizer.validatePath(options.outputPath);

    // 1. Probe input
    options.onProgress?.({
      stage: 'probing',
      percentage: 5,
      currentTimeSeconds: 0,
      totalDurationSeconds: 0,
      message: 'Analyzing source audio stream...'
    });

    const metadata = await this.prober.probe(validatedInput);
    const primaryAudio = metadata.primaryAudioStream;
    if (!primaryAudio) {
      throw new Error(`Cannot extract audio: No audio stream found in "${options.inputPath}"`);
    }

    const totalDuration = metadata.container.durationSeconds || primaryAudio.durationSeconds;

    // 2. Compute honesty report
    const honesty = MediaClassifier.evaluateAudioHonesty(
      primaryAudio,
      options.targetFormat,
      options.bitrateKbps
    );

    const honestyReport: AudioQualityHonestyReport = {
      sourceCodec: primaryAudio.codec,
      sourceBitrateKbps: primaryAudio.bitrateKbps,
      sourceSampleRate: primaryAudio.sampleRate,
      sourceIsLossless: primaryAudio.isLossless,
      targetCodec: options.targetCodec ?? options.targetFormat,
      targetFormat: options.targetFormat,
      targetBitrateKbps: options.bitrateKbps,
      targetIsLossless: honesty.isLosslessTarget,
      isStreamCopy: honesty.isStreamCopy,
      isUpsampling: honesty.isUpsampling,
      honestyVerdict: honesty.verdict,
      honestyExplanation: honesty.explanation
    };

    // 3. Build FFmpeg command arguments
    const args: string[] = ['-y', '-v', 'error', '-i', validatedInput, '-vn']; // -vn: no video

    let actionTaken: ProcessingResult['actionTaken'];

    if (honesty.isStreamCopy || options.targetFormat === 'copy') {
      // PURE STREAM COPY
      actionTaken = 'AUDIO_STREAM_COPY';
      args.push('-c:a', 'copy');
    } else {
      // TRANSCODE AUDIO
      actionTaken = 'AUDIO_TRANSCODE';

      switch (options.targetFormat) {
        case 'mp3':
          args.push('-c:a', 'libmp3lame', '-b:a', `${options.bitrateKbps ?? 320}k`);
          break;
        case 'aac':
        case 'm4a':
          args.push('-c:a', 'aac', '-b:a', `${options.bitrateKbps ?? 256}k`);
          break;
        case 'flac':
          args.push('-c:a', 'flac', '-compression_level', '8');
          break;
        case 'wav':
          args.push('-c:a', 'pcm_s16le');
          break;
        case 'opus':
          args.push('-c:a', 'libopus', '-b:a', `${options.bitrateKbps ?? 160}k`);
          break;
        case 'ogg':
          args.push('-c:a', 'libvorbis', '-q:a', '6');
          break;
        default:
          args.push('-c:a', 'aac', '-b:a', '256k');
      }

      if (options.sampleRate) {
        args.push('-ar', options.sampleRate.toString());
      }
      if (options.channels) {
        args.push('-ac', options.channels.toString());
      }
    }

    args.push('-progress', 'pipe:1', validatedOutput);

    // 4. Execute
    options.onProgress?.({
      stage: 'extracting',
      percentage: 15,
      currentTimeSeconds: 0,
      totalDurationSeconds: totalDuration,
      message: actionTaken === 'AUDIO_STREAM_COPY' ? 'Copying native audio stream...' : 'Transcoding audio...'
    });

    const execution = await FFmpegExecutor.execute(this.ffmpegBinary, args, {
      totalDurationSeconds: totalDuration,
      stage: 'extracting',
      timeoutMs: options.timeoutMs,
      onProgress: options.onProgress
    });

    if (execution.exitCode !== 0) {
      throw new Error(`FFmpeg audio extraction failed (code ${execution.exitCode}): ${execution.stderr || execution.stdout}`);
    }

    // 5. Verification
    options.onProgress?.({
      stage: 'verifying',
      percentage: 95,
      currentTimeSeconds: totalDuration,
      totalDurationSeconds: totalDuration,
      message: 'Verifying extracted audio integrity...'
    });

    const verifier = new OutputVerifier(this.prober);
    const verification = await verifier.verify(validatedOutput, {
      expectedDurationSeconds: totalDuration,
      requireVideo: false,
      requireAudio: true,
      maxDurationDeviationSeconds: 2.0
    });

    if (!verification.valid) {
      throw new Error(`Audio verification failed: ${verification.errors.join('; ')}`);
    }

    options.onProgress?.({
      stage: 'completed',
      percentage: 100,
      currentTimeSeconds: totalDuration,
      totalDurationSeconds: totalDuration,
      message: 'Audio extraction complete.'
    });

    return {
      success: true,
      outputPath: validatedOutput,
      actionTaken,
      durationSeconds: verification.durationSeconds,
      fileSizeBytes: verification.fileSizeBytes,
      metadata,
      verification,
      audioHonestyReport: honestyReport,
      processingTimeMs: Date.now() - startTime
    };
  }
}
