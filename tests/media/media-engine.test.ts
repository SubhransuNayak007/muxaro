/**
 * Project VYRO - Independent QA & Media Engine Test Suite
 * Test File: tests/media/media-engine.test.ts
 *
 * Verifies FFprobe metadata extraction, true resolution detection,
 * stream copy vs transcoding, audio extraction, A/V merging,
 * corrupt media resilience, and FFmpeg command sanitization.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import {
  generateSyntheticMediaFixtures,
  SyntheticMediaManifest,
} from './synthetic-generator.ts';
import { FFprobeRunner } from '../../apps/media-worker/src/prober/ffprobe.ts';
import { AudioExtractor } from '../../apps/media-worker/src/transcoder/audio.ts';
import { VideoTranscoder } from '../../apps/media-worker/src/transcoder/video.ts';
import { MediaMerger } from '../../apps/media-worker/src/merger/merger.ts';
import { OutputVerifier } from '../../apps/media-worker/src/verification/verifier.ts';
import {
  validateSafePath,
  sanitizeFilename,
} from '../../security/src/ffmpeg-sanitizer.ts';

describe('Media Engine - Synthetic Media Probe and Classification', () => {
  let fixtures: SyntheticMediaManifest;
  const prober = new FFprobeRunner();
  const fixturesDir = path.resolve('tests/media/fixtures');

  before(async () => {
    fixtures = await generateSyntheticMediaFixtures(fixturesDir);
  });

  it('should accurately probe and classify 1080p H.264 + AAC MP4', async () => {
    const meta = await prober.probe(fixtures.video1080p);
    assert.strictEqual(meta.container.formatName.includes('mp4'), true);
    assert.strictEqual(meta.primaryVideoStream?.codec, 'h264');
    assert.strictEqual(meta.primaryVideoStream?.width, 1920);
    assert.strictEqual(meta.primaryVideoStream?.height, 1080);
    assert.strictEqual(meta.primaryVideoStream?.resolutionTier, '1080p');
    assert.strictEqual(meta.primaryAudioStream?.codec, 'aac');
  });

  it('should accurately probe and classify 720p H.264 MP4', async () => {
    const meta = await prober.probe(fixtures.video720p);
    assert.strictEqual(meta.primaryVideoStream?.width, 1280);
    assert.strictEqual(meta.primaryVideoStream?.height, 720);
    assert.strictEqual(meta.primaryVideoStream?.resolutionTier, '720p');
  });

  it('should accurately probe and classify 4K VP9 WebM', async () => {
    const meta = await prober.probe(fixtures.video4k);
    assert.strictEqual(
      meta.container.formatName.includes('webm') || meta.container.formatName.includes('matroska'),
      true
    );
    assert.strictEqual(meta.primaryVideoStream?.codec, 'vp9');
    assert.strictEqual(meta.primaryVideoStream?.width, 3840);
    assert.strictEqual(meta.primaryVideoStream?.height, 2160);
    assert.strictEqual(meta.primaryVideoStream?.resolutionTier, '4K');
    assert.strictEqual(meta.primaryAudioStream?.codec, 'opus');
  });

  it('should probe standalone audio files accurately', async () => {
    const mp3Meta = await prober.probe(fixtures.audioMp3);
    assert.strictEqual(mp3Meta.primaryAudioStream?.codec, 'mp3');
    assert.strictEqual(mp3Meta.videoStreams.length, 0);

    const wavMeta = await prober.probe(fixtures.audioWav);
    assert.strictEqual(wavMeta.primaryAudioStream?.codec.includes('pcm'), true);

    const flacMeta = await prober.probe(fixtures.audioFlac);
    assert.strictEqual(flacMeta.primaryAudioStream?.codec, 'flac');
  });

  it('should detect video-only media without audio tracks', async () => {
    const silentMeta = await prober.probe(fixtures.videoSilent);
    assert.strictEqual(silentMeta.videoStreams.length, 1);
    assert.strictEqual(silentMeta.audioStreams.length, 0);
    assert.strictEqual(silentMeta.primaryAudioStream, undefined);
  });
});

describe('Media Engine - Transcoding, Stream Copy, and Audio Extraction', () => {
  let fixtures: SyntheticMediaManifest;
  const audioExtractor = new AudioExtractor();
  const videoTranscoder = new VideoTranscoder();
  const merger = new MediaMerger();
  const prober = new FFprobeRunner();
  const verifier = new OutputVerifier();
  const outDir = path.resolve('tests/media/fixtures/output');

  before(async () => {
    fixtures = await generateSyntheticMediaFixtures(path.resolve('tests/media/fixtures'));
    await fs.mkdir(outDir, { recursive: true });
  });

  it('should extract audio to M4A with native stream copy', async () => {
    const outputPath = path.join(outDir, 'extracted_copy.m4a');
    const result = await audioExtractor.extract({
      inputPath: fixtures.video1080p,
      outputPath,
      targetFormat: 'm4a',
    });

    assert.ok(result.outputPath);
    assert.ok(result.durationSeconds > 0);

    // Verify output file integrity
    const verifyResult = await verifier.verify(outputPath, {
      expectedFormat: 'm4a',
      allowDurationDeviationSeconds: 0.5,
    });
    assert.strictEqual(verifyResult.valid, true);
  });

  it('should extract audio to MP3 and produce honesty report', async () => {
    const outputPath = path.join(outDir, 'extracted_transcode.mp3');
    const result = await audioExtractor.extract({
      inputPath: fixtures.video1080p,
      outputPath,
      targetFormat: 'mp3',
      bitrateKbps: 320,
    });

    assert.ok(result.outputPath);
    assert.ok(result.audioHonestyReport);
    // Source was 128k AAC; transcoding to 320k MP3 cannot add discarded high-frequency data
    assert.strictEqual(result.audioHonestyReport.sourceCodec, 'aac');
    assert.strictEqual(result.audioHonestyReport.targetFormat, 'mp3');

    const meta = await prober.probe(outputPath);
    assert.strictEqual(meta.primaryAudioStream?.codec, 'mp3');
  });

  it('should transcode and downscale 1080p video to 720p without distortion', async () => {
    const outputPath = path.join(outDir, 'downscaled_720p.mp4');
    const result = await videoTranscoder.process({
      inputPath: fixtures.video1080p,
      outputPath,
      targetResolution: '720p',
      targetContainer: 'mp4',
      targetCodec: 'h264',
    });

    assert.ok(result.outputPath);
    assert.strictEqual(result.actionTaken, 'TRANSCODE');

    const meta = await prober.probe(outputPath);
    assert.strictEqual(meta.primaryVideoStream?.width, 1280);
    assert.strictEqual(meta.primaryVideoStream?.height, 720);
    assert.strictEqual(meta.primaryVideoStream?.resolutionTier, '720p');
  });

  it('should multiplex silent video and standalone audio into synchronized container', async () => {
    const mergedOutput = path.join(outDir, 'merged_av.mp4');
    const result = await merger.merge({
      videoInputPath: fixtures.videoSilent,
      audioInputPath: fixtures.audioWav,
      outputPath: mergedOutput,
      targetContainer: 'mp4',
    });

    assert.ok(result.outputPath);

    // Probe merged file
    const meta = await prober.probe(mergedOutput);
    assert.strictEqual(meta.videoStreams.length, 1);
    assert.strictEqual(meta.audioStreams.length, 1);
    assert.strictEqual(meta.primaryVideoStream?.codec, 'h264');
    assert.strictEqual(meta.primaryAudioStream?.codec, 'aac');
  });
});

describe('Media Engine - Security & Failure Resilience', () => {
  let fixtures: SyntheticMediaManifest;
  const prober = new FFprobeRunner();

  before(async () => {
    fixtures = await generateSyntheticMediaFixtures(path.resolve('tests/media/fixtures'));
  });

  it('should gracefully reject corrupted media file without crashing', async () => {
    await assert.rejects(
      async () => {
        await prober.probe(fixtures.corruptMedia);
      },
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return true;
      }
    );
  });

  it('should reject paths with directory traversal or shell injection in sanitizer', () => {
    const maliciousPaths = [
      '../../../etc/passwd',
      'video.mp4;rm -rf /',
      'video.mp4|nc 127.0.0.1 80',
      'video.mp4$(reboot)',
      'video.mp4`id`',
    ];

    for (const p of maliciousPaths) {
      const res = validateSafePath(p, [path.resolve('tests/media/fixtures')]);
      assert.strictEqual(res.isSafe, false, `Expected path ${p} to be rejected as unsafe`);
      assert.ok(res.error, 'Must provide rejection error');
    }
  });

  it('should sanitize dangerous filenames safely', () => {
    assert.strictEqual(
      sanitizeFilename('../../../malicious;payload.mp4'),
      'malicious_payload.mp4'
    );
    assert.strictEqual(
      sanitizeFilename('sample file (1) [1080p].mp4'),
      'sample_file__1___1080p_.mp4'
    );
  });
});
