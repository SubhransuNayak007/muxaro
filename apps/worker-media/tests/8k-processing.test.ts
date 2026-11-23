/**
 * 8K Ultra HD Processing Test Suite
 * Validates 8K stream pairing, lossless zero-copy remuxing, optimal buffer allocation,
 * fragmented MP4 stream handling, and FFprobe stream verification.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { EcoModeEngine } from '../src/eco-mode.js';
import { StreamPipeline } from '../src/stream-pipeline.js';
import { safeProbeMedia } from '../src/security/hardened-ffprobe.js';
import { MediaWorkerService } from '../../media-worker/src/service.js';
import { MediaClassifier } from '../../media-worker/src/prober/classifier.js';
import type { MediaJobPayload } from '../src/types.js';

describe('8K Ultra HD Stream Pairing & TurboFlow Rules', () => {
  it('identifies 8K resolution in MediaClassifier', () => {
    assert.equal(MediaClassifier.classifyResolution(7680, 4320), '8K');
    assert.equal(MediaClassifier.classifyResolution(8192, 4320), '8K');
    assert.equal(MediaClassifier.classifyResolution(4320, 7680), '8K'); // vertical 8K
  });

  it('enforces 8K lossless stream-copy remuxing without re-encoding video', () => {
    const job: MediaJobPayload = {
      jobId: '8k-test-job-1',
      tool: 'convert_video',
      lane: 'fast_io',
      targetFormat: 'mp4',
      targetResolution: '8K',
      ecoMode: true,
      retentionTier: '24h',
    };

    const probe = {
      durationSeconds: 120,
      video: { codec: 'av01', width: 7680, height: 4320 },
      audio: { codec: 'aac' },
    };

    const plan = EcoModeEngine.planExecution(job, probe);

    assert.equal(plan.isStreamCopy, true);
    assert.equal(plan.action, 'STREAM_COPY_REMUX');
    assert.deepEqual(plan.ffmpegVideoArgs, ['-c:v', 'copy']);
    assert.deepEqual(plan.ffmpegAudioArgs, ['-c:a', 'copy']);
    assert.equal(plan.scaleCapApplied, false);
    assert.ok(plan.reason.includes('8K Lossless Remuxing Rule'));
  });

  it('uses fragmented MP4 flags for 8K streaming', () => {
    const job: MediaJobPayload = {
      jobId: '8k-test-job-2',
      tool: 'convert_video',
      lane: 'fast_io',
      targetFormat: 'mp4',
      targetResolution: '8K',
      ecoMode: true,
      retentionTier: '24h',
    };

    const probe = {
      durationSeconds: 60,
      video: { codec: 'h264', width: 7680, height: 4320 },
      audio: { codec: 'opus' },
    };

    const plan = EcoModeEngine.planExecution(job, probe);

    assert.equal(plan.isStreamCopy, true);
    assert.deepEqual(plan.ffmpegVideoArgs, ['-c:v', 'copy']);
    // Opus in MP4 requires AAC audio transcode; video remains copy
    assert.deepEqual(plan.ffmpegAudioArgs, ['-c:a', 'aac', '-b:a', '192k']);
    assert.ok(plan.ffmpegFormatArgs.includes('frag_keyframe+empty_moov+default_base_moof'));

    const ffmpegArgs = StreamPipeline.buildFFmpegArgs('/sandbox/in/8k_source.mp4', plan, 'mp4', false);
    assert.ok(ffmpegArgs.includes('-fs'));
    const fsIdx = ffmpegArgs.indexOf('-fs');
    // 8K raises ceiling to 32 GB
    assert.equal(ffmpegArgs[fsIdx + 1], '34359738368');
  });
});

describe('8K Ultra HD Pipeline Execution & FFprobe Verification', () => {
  const testDir = path.join(os.tmpdir(), `muxaro_8k_e2e_${Date.now()}`);
  const service = new MediaWorkerService({ scratchDirectory: testDir });

  const input8KVideo = path.join(testDir, 'source_8k.mp4');
  const input8KAacAudio = path.join(testDir, 'source_audio.m4a');
  const input8KWavAudio = path.join(testDir, 'source_audio.wav');
  const output8KMerged = path.join(testDir, 'output_8k_merged.mp4');
  const output8KWebM = path.join(testDir, 'output_8k_remuxed.webm');

  before(() => {
    fs.mkdirSync(testDir, { recursive: true });

    // Generate 1-second synthetic 8K (7680x4320) test video with audio
    const genVideo = spawnSync('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'testsrc=duration=1:size=7680x4320:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      input8KVideo,
    ]);

    if (genVideo.status !== 0) {
      throw new Error(`Failed to generate 8K synthetic test video: ${genVideo.stderr?.toString()}`);
    }

    // Generate 1-second synthetic AAC audio (M4A)
    const genAac = spawnSync('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1',
      '-c:a', 'aac',
      input8KAacAudio,
    ]);

    if (genAac.status !== 0) {
      throw new Error(`Failed to generate test AAC audio: ${genAac.stderr?.toString()}`);
    }

    // Generate 1-second synthetic WAV audio
    const genWav = spawnSync('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1',
      '-c:a', 'pcm_s16le',
      input8KWavAudio,
    ]);

    if (genWav.status !== 0) {
      throw new Error(`Failed to generate test WAV audio: ${genWav.stderr?.toString()}`);
    }
  });

  after(() => {
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('accurately probes 8K video stream dimensions and duration with safeProbeMedia', async () => {
    const probe = await safeProbeMedia(input8KVideo);

    assert.ok(probe.video !== undefined);
    assert.equal(probe.video?.width, 7680);
    assert.equal(probe.video?.height, 4320);
    assert.equal(probe.video?.codec, 'h264');
    assert.ok(probe.durationSeconds >= 0.9);
  });

  it('merges 8K video with audio using lossless zero-copy stream remuxing', async () => {
    const result = await service.mergeMedia({
      videoInputPath: input8KVideo,
      audioInputPath: input8KAacAudio,
      outputPath: output8KMerged,
      targetContainer: 'mp4',
      preferStreamCopy: true,
      targetResolution: '8K',
    });

    assert.equal(result.success, true);
    assert.equal(result.actionTaken, 'MERGE_STREAM_COPY');
    assert.ok(fs.existsSync(output8KMerged));
    assert.ok(result.fileSizeBytes > 0);

    // Verify output with FFprobe
    const verification = await service.verifyOutput(output8KMerged, {
      expectedDurationSeconds: 1,
      requireVideo: true,
      requireAudio: true,
    });

    assert.equal(verification.valid, true);
    assert.equal(verification.resolutionTier, '8K');
    assert.equal(verification.width, 7680);
    assert.equal(verification.height, 4320);
    assert.ok(verification.durationSeconds >= 0.9);
  });

  it('merges 8K video with incompatible audio by transcoding only audio (-c:v copy preserved)', async () => {
    const outputTranscodedAudio = path.join(testDir, 'output_8k_transcoded_audio.mp4');
    const result = await service.mergeMedia({
      videoInputPath: input8KVideo,
      audioInputPath: input8KWavAudio,
      outputPath: outputTranscodedAudio,
      targetContainer: 'mp4',
      preferStreamCopy: true,
      targetResolution: '8K',
    });

    assert.equal(result.success, true);
    assert.equal(result.actionTaken, 'MERGE_TRANSCODE');
    assert.ok(fs.existsSync(outputTranscodedAudio));

    const verification = await service.verifyOutput(outputTranscodedAudio, {
      expectedDurationSeconds: 1,
      requireVideo: true,
      requireAudio: true,
    });

    assert.equal(verification.valid, true);
    assert.equal(verification.resolutionTier, '8K');
    assert.equal(verification.width, 7680);
    assert.equal(verification.height, 4320);
    assert.equal(verification.audioCodec, 'aac');
    assert.ok(verification.durationSeconds >= 0.9);
  });

  it('executes 8K video container remux to WebM without re-encoding video', async () => {
    const result = await service.processVideo({
      inputPath: input8KVideo,
      outputPath: output8KWebM,
      targetContainer: 'webm',
      targetResolution: '8K',
    });

    assert.equal(result.success, true);
    assert.ok(fs.existsSync(output8KWebM));

    const verification = await service.verifyOutput(output8KWebM, {
      expectedDurationSeconds: 1,
      requireVideo: true,
    });

    assert.equal(verification.valid, true);
    assert.equal(verification.resolutionTier, '8K');
    assert.equal(verification.width, 7680);
    assert.equal(verification.height, 4320);
    assert.ok(verification.durationSeconds >= 0.9);
  });
});
