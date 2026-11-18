/**
 * MUXARO Media Processing Engine - Output Artifact Verifier
 * Rigorously verifies that generated media files exist, have non-zero size, readable stream headers,
 * and valid duration without truncation or corruption.
 */

import fs from 'node:fs';
import { FFprobeRunner } from '../prober/ffprobe.js';
import { ProcessSanitizer } from '../process/sanitizer.js';
import { OutputVerificationResult } from '../types/transcode.js';

export interface VerificationOptions {
  expectedDurationSeconds?: number;
  maxDurationDeviationSeconds?: number;
  requireVideo?: boolean;
  requireAudio?: boolean;
  expectedContainer?: string;
}

export class OutputVerifier {
  private prober: FFprobeRunner;

  constructor(prober?: FFprobeRunner) {
    this.prober = prober || new FFprobeRunner();
  }

  /**
   * Performs end-to-end verification of an output media file.
   */
  public async verify(
    filePath: string,
    options: VerificationOptions = {}
  ): Promise<OutputVerificationResult> {
    const validatedPath = ProcessSanitizer.validatePath(filePath);
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Filesystem check
    if (!fs.existsSync(validatedPath)) {
      return {
        valid: false,
        outputPath: validatedPath,
        fileSizeBytes: 0,
        durationSeconds: 0,
        durationDeviationSeconds: 0,
        hasVideo: false,
        hasAudio: false,
        errors: [`Output file does not exist on disk: "${validatedPath}"`],
        warnings: []
      };
    }

    const stat = fs.statSync(validatedPath);
    if (stat.size === 0) {
      return {
        valid: false,
        outputPath: validatedPath,
        fileSizeBytes: 0,
        durationSeconds: 0,
        durationDeviationSeconds: 0,
        hasVideo: false,
        hasAudio: false,
        errors: [`Output file size is 0 bytes (corrupt or empty output).`],
        warnings: []
      };
    }

    // If it's a zip archive, we don't probe audio/video streams with ffprobe
    if (validatedPath.endsWith('.zip')) {
      return {
        valid: true,
        outputPath: validatedPath,
        fileSizeBytes: stat.size,
        durationSeconds: 0,
        durationDeviationSeconds: 0,
        hasVideo: false,
        hasAudio: false,
        errors: [],
        warnings: []
      };
    }

    // 2. FFprobe header inspection
    try {
      const metadata = await this.prober.probe(validatedPath);

      const actualDuration =
        metadata.container.durationSeconds ||
        metadata.primaryVideoStream?.durationSeconds ||
        metadata.primaryAudioStream?.durationSeconds ||
        0;

      // Video requirement check
      if (options.requireVideo && !metadata.hasVideo) {
        errors.push('Output verification failed: Expected video stream, but none was found.');
      }

      // Audio requirement check
      if (options.requireAudio && !metadata.hasAudio) {
        errors.push('Output verification failed: Expected audio stream, but none was found.');
      }

      // Duration deviation check
      let durationDeviationSeconds = 0;
      if (options.expectedDurationSeconds && options.expectedDurationSeconds > 0 && actualDuration > 0) {
        durationDeviationSeconds = Math.abs(actualDuration - options.expectedDurationSeconds);
        const maxDeviation = options.maxDurationDeviationSeconds ?? 2.0;

        if (durationDeviationSeconds > maxDeviation) {
          errors.push(
            `Output duration (${actualDuration.toFixed(2)}s) deviates from expected duration (${options.expectedDurationSeconds.toFixed(2)}s) by ${durationDeviationSeconds.toFixed(2)}s, exceeding tolerance of ${maxDeviation}s.`
          );
        }
      }

      // Container format check
      if (options.expectedContainer) {
        const expected = options.expectedContainer.toLowerCase();
        const actualFormat = metadata.container.formatName.toLowerCase();
        if (!actualFormat.includes(expected)) {
          warnings.push(`Container format "${actualFormat}" does not explicitly match expected "${expected}".`);
        }
      }

      const valid = errors.length === 0;

      return {
        valid,
        outputPath: validatedPath,
        fileSizeBytes: stat.size,
        durationSeconds: actualDuration,
        expectedDurationSeconds: options.expectedDurationSeconds,
        durationDeviationSeconds,
        hasVideo: metadata.hasVideo,
        hasAudio: metadata.hasAudio,
        videoCodec: metadata.primaryVideoStream?.codec,
        audioCodec: metadata.primaryAudioStream?.codec,
        resolutionTier: metadata.trueResolutionTier,
        width: metadata.primaryVideoStream?.width,
        height: metadata.primaryVideoStream?.height,
        errors,
        warnings
      };
    } catch (err) {
      return {
        valid: false,
        outputPath: validatedPath,
        fileSizeBytes: stat.size,
        durationSeconds: 0,
        durationDeviationSeconds: 0,
        hasVideo: false,
        hasAudio: false,
        errors: [`FFprobe failed to inspect output file: ${(err as Error).message}`],
        warnings: []
      };
    }
  }
}
