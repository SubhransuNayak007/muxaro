/**
 * Unit Tests: Eco Mode Enforcement Engine
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EcoModeEngine } from '../src/eco-mode.js';
import type { MediaJobPayload } from '../src/types.js';

describe('EcoModeEngine', () => {
  it('forces zero-copy stream copy (-c copy) when input codecs natively fit MP4', () => {
    const job: MediaJobPayload = {
      jobId: 'job-eco-1',
      tool: 'convert_video',
      lane: 'fast_io',
      targetFormat: 'mp4',
      ecoMode: true,
      retentionTier: '60m',
    };

    const probe = {
      durationSeconds: 120,
      video: { codec: 'h264', width: 1920, height: 1080 },
      audio: { codec: 'aac' },
    };

    const plan = EcoModeEngine.planExecution(job, probe);

    assert.equal(plan.isStreamCopy, true);
    assert.equal(plan.action, 'STREAM_COPY_REMUX');
    assert.deepEqual(plan.ffmpegVideoArgs, ['-c:v', 'copy']);
    assert.deepEqual(plan.ffmpegAudioArgs, ['-c:a', 'copy']);
    assert.equal(plan.scaleCapApplied, false);
    assert.ok(plan.ffmpegFormatArgs.includes('frag_keyframe+empty_moov+default_base_moof'));
  });

  it('caps 4K video to 1080p with veryfast preset in Eco Mode', () => {
    const job: MediaJobPayload = {
      jobId: 'job-eco-2',
      tool: 'convert_video',
      lane: 'transcode',
      targetFormat: 'mp4',
      ecoMode: true,
      retentionTier: '24h',
    };

    const probe = {
      durationSeconds: 300,
      video: { codec: 'hevc', width: 3840, height: 2160 },
      audio: { codec: 'opus' },
    };

    const plan = EcoModeEngine.planExecution(job, probe);

    assert.equal(plan.isStreamCopy, false);
    assert.equal(plan.action, 'OPTIMIZED_TRANSCODE');
    assert.equal(plan.scaleCapApplied, true);
    assert.equal(plan.targetResolution, '1080p');
    assert.equal(plan.targetHeight, 1080);
    assert.ok(plan.ffmpegVideoArgs.includes('veryfast'));
    assert.ok(plan.ffmpegFilterArgs[1].includes('min(1920,iw)'));
  });

  it('never upscales a 720p video even if 1080p is requested', () => {
    const job: MediaJobPayload = {
      jobId: 'job-eco-3',
      tool: 'convert_video',
      lane: 'fast_io',
      targetFormat: 'mp4',
      targetResolution: '1080p',
      ecoMode: true,
      retentionTier: '60m',
    };

    const probe = {
      durationSeconds: 60,
      video: { codec: 'h264', width: 1280, height: 720 },
      audio: { codec: 'aac' },
    };

    const plan = EcoModeEngine.planExecution(job, probe);

    // Should never upscale: target height must be <= 720
    assert.ok((plan.targetHeight || 720) <= 720);
    assert.equal(plan.scaleCapApplied, false);
  });

  it('applies high-efficiency VP9 parameters for WebM targets', () => {
    const job: MediaJobPayload = {
      jobId: 'job-eco-4',
      tool: 'convert_video',
      lane: 'transcode',
      targetFormat: 'webm',
      ecoMode: true,
      retentionTier: '60m',
    };

    const probe = {
      durationSeconds: 180,
      video: { codec: 'h264', width: 1920, height: 1080 },
      audio: { codec: 'aac' },
    };

    const plan = EcoModeEngine.planExecution(job, probe);

    assert.equal(plan.isStreamCopy, false);
    assert.ok(plan.ffmpegVideoArgs.includes('libvpx-vp9'));
    assert.ok(plan.ffmpegVideoArgs.includes('32')); // CRF 32
    assert.ok(plan.ffmpegVideoArgs.includes('-cpu-used'));
    assert.ok(plan.ffmpegVideoArgs.includes('4'));
    assert.ok(plan.ffmpegVideoArgs.includes('-row-mt'));
  });

  it('calculates compute Wh and CO2 savings accurately', () => {
    const plan = {
      isStreamCopy: true,
      action: 'STREAM_COPY_REMUX' as const,
      ffmpegVideoArgs: ['-c:v', 'copy'],
      ffmpegAudioArgs: ['-c:a', 'copy'],
      ffmpegFilterArgs: [],
      ffmpegFormatArgs: ['-f', 'mp4'],
      scaleCapApplied: false,
      reason: 'Stream copy',
    };

    const savings = EcoModeEngine.estimateSavings(plan, 600); // 10 minute video

    assert.ok(savings.computeSavedWh > 10);
    assert.ok(savings.co2SavedGrams > 2);
    assert.ok(savings.cpuReductionPercent >= 90);
    assert.equal(savings.generationLossPrevented, true);
    assert.ok(savings.summary.includes('zero-copy'));
  });
});
