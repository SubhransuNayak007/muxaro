import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { MediaWorkerService } from '../service.js';

describe('MediaWorkerService - End-to-End Real Pipeline Test', () => {
  const testDir = path.join(os.tmpdir(), `muxaro_e2e_${Date.now()}`);
  const service = new MediaWorkerService({ scratchDirectory: testDir });

  const inputVideo1080p = path.join(testDir, 'source_1080p.mp4');
  const inputAudioWav = path.join(testDir, 'source_audio.wav');

  before(() => {
    fs.mkdirSync(testDir, { recursive: true });

    // 1. Generate 2-second synthetic 1080p test video with test tones
    // ffmpeg -f lavfi -i testsrc=duration=2:size=1920x1080:rate=30 -f lavfi -i sine=frequency=440:duration=2 -c:v libx264 -c:a aac -pix_fmt yuv420p source_1080p.mp4
    const genVideo = spawnSync('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'testsrc=duration=2:size=1920x1080:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-c:a', 'aac',
      '-pix_fmt', 'yuv420p',
      inputVideo1080p
    ]);

    if (genVideo.status !== 0) {
      throw new Error(`Failed to generate synthetic test video: ${genVideo.stderr?.toString()}`);
    }

    // 2. Generate 2-second synthetic WAV audio
    const genAudio = spawnSync('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2',
      '-c:a', 'pcm_s16le',
      inputAudioWav
    ]);

    if (genAudio.status !== 0) {
      throw new Error(`Failed to generate synthetic test audio: ${genAudio.stderr?.toString()}`);
    }
  });

  after(() => {
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  test('Worker Health reports healthy status and binary versions', async () => {
    const health = await service.getHealth();
    assert.equal(health.status, 'healthy');
    assert.match(health.ffmpegVersion, /ffmpeg version/i);
    assert.match(health.ffprobeVersion, /ffprobe version/i);
    assert.ok(health.system.cpus > 0);
  });

  test('FFprobe accurately probes true 1080p resolution and codecs', async () => {
    const metadata = await service.probe(inputVideo1080p);
    assert.equal(metadata.hasVideo, true);
    assert.equal(metadata.hasAudio, true);
    assert.equal(metadata.trueResolutionTier, '1080p');
    assert.equal(metadata.primaryVideoStream?.width, 1920);
    assert.equal(metadata.primaryVideoStream?.height, 1080);
    assert.equal(metadata.primaryVideoStream?.codec, 'h264');
    assert.equal(metadata.primaryAudioStream?.codec, 'aac');
    assert.ok(metadata.container.durationSeconds >= 1.9);
  });

  test('Video pipeline executes zero-loss STREAM_COPY when resolution and codecs match', async () => {
    const copyOutput = path.join(testDir, 'output_copied.mp4');
    let progressFired = false;

    const result = await service.processVideo({
      inputPath: inputVideo1080p,
      outputPath: copyOutput,
      targetContainer: 'mp4',
      targetResolution: '1080p',
      targetCodec: 'copy',
      onProgress: () => {
        progressFired = true;
      }
    });

    assert.equal(result.success, true);
    assert.equal(result.actionTaken, 'STREAM_COPY');
    assert.ok(fs.existsSync(copyOutput));
    assert.ok(result.fileSizeBytes > 0);
    assert.equal(result.verification.valid, true);
    assert.equal(progressFired, true);
  });

  test('Video pipeline transcodes and downscales to 720p', async () => {
    const transcodeOutput = path.join(testDir, 'output_720p.mp4');

    const result = await service.processVideo({
      inputPath: inputVideo1080p,
      outputPath: transcodeOutput,
      targetContainer: 'mp4',
      targetResolution: '720p',
      targetCodec: 'h264',
      preset: 'ultrafast'
    });

    assert.equal(result.success, true);
    assert.equal(result.actionTaken, 'TRANSCODE');
    assert.ok(fs.existsSync(transcodeOutput));
    assert.equal(result.verification.resolutionTier, '720p');
    assert.equal(result.verification.width, 1280);
    assert.equal(result.verification.height, 720);
  });

  test('Audio extraction performs native copy and transcode with honesty reporting', async () => {
    // 1. Native stream-copy (source is AAC, requested is M4A)
    const copyAudioOutput = path.join(testDir, 'output_audio_copy.m4a');
    const copyResult = await service.extractAudio({
      inputPath: inputVideo1080p,
      outputPath: copyAudioOutput,
      targetFormat: 'm4a'
    });

    assert.equal(copyResult.success, true);
    assert.equal(copyResult.actionTaken, 'AUDIO_STREAM_COPY');
    assert.equal(copyResult.audioHonestyReport?.isStreamCopy, true);
    assert.equal(copyResult.audioHonestyReport?.honestyVerdict, 'NATIVE_COPY');

    // 2. Transcode to MP3 with honesty report
    const mp3AudioOutput = path.join(testDir, 'output_audio.mp3');
    const mp3Result = await service.extractAudio({
      inputPath: inputVideo1080p,
      outputPath: mp3AudioOutput,
      targetFormat: 'mp3',
      bitrateKbps: 320
    });

    assert.equal(mp3Result.success, true);
    assert.equal(mp3Result.actionTaken, 'AUDIO_TRANSCODE');
    assert.ok(mp3Result.audioHonestyReport);
    assert.ok(fs.existsSync(mp3AudioOutput));
    assert.equal(mp3Result.verification.hasAudio, true);
  });

  test('A/V Merger combines separate video and audio with sync validation and remuxing', async () => {
    const mergedOutput = path.join(testDir, 'output_merged.mp4');

    const result = await service.mergeMedia({
      videoInputPath: inputVideo1080p,
      audioInputPath: inputAudioWav,
      outputPath: mergedOutput,
      targetContainer: 'mp4',
      preferStreamCopy: true
    });

    assert.equal(result.success, true);
    assert.ok(fs.existsSync(mergedOutput));
    assert.equal(result.verification.valid, true);
    assert.equal(result.verification.hasVideo, true);
    assert.equal(result.verification.hasAudio, true);
  });

  test('BatchPackager produces streaming ZIP with manifest.json and README', async () => {
    const zipOutput = path.join(testDir, 'output_batch.zip');
    let progressCount = 0;

    const result = await service.packageBatch({
      items: [
        { filePath: inputVideo1080p, entryName: 'video_clip.mp4' },
        { filePath: inputAudioWav, entryName: 'soundtrack.wav' }
      ],
      outputPath: zipOutput,
      archiveTitle: 'Test Playlist Batch',
      playlistMetadata: {
        id: 'pl_test_001',
        title: 'High Resolution Archive',
        itemCount: 2
      },
      onProgress: () => {
        progressCount++;
      }
    });

    assert.equal(result.success, true);
    assert.equal(result.actionTaken, 'ZIP_PACKAGE');
    assert.ok(fs.existsSync(zipOutput));
    assert.ok(result.fileSizeBytes > 1000);
    assert.ok(progressCount > 0);
  });
});
