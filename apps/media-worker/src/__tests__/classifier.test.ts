import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MediaClassifier } from '../prober/classifier.js';
import { VideoStreamInfo, AudioStreamInfo } from '../types/media.js';

describe('MediaClassifier - Resolution Classification', () => {
  test('correctly identifies 8K UHD resolutions', () => {
    assert.equal(MediaClassifier.classifyResolution(7680, 4320), '8K');
    assert.equal(MediaClassifier.classifyResolution(8192, 4320), '8K'); // DCI 8K
  });

  test('correctly identifies 4K UHD resolutions', () => {
    assert.equal(MediaClassifier.classifyResolution(3840, 2160), '4K');
    assert.equal(MediaClassifier.classifyResolution(4096, 2160), '4K'); // DCI 4K
  });

  test('correctly identifies 1440p (QHD/2K) resolutions', () => {
    assert.equal(MediaClassifier.classifyResolution(2560, 1440), '1440p');
    assert.equal(MediaClassifier.classifyResolution(3440, 1440), '1440p'); // Ultrawide 1440p
  });

  test('correctly identifies 1080p (FHD) resolutions', () => {
    assert.equal(MediaClassifier.classifyResolution(1920, 1080), '1080p');
    assert.equal(MediaClassifier.classifyResolution(1080, 1920), '1080p'); // Vertical Shorts / Reels
  });

  test('correctly identifies 720p (HD) resolutions', () => {
    assert.equal(MediaClassifier.classifyResolution(1280, 720), '720p');
    assert.equal(MediaClassifier.classifyResolution(720, 1280), '720p');
  });

  test('correctly identifies 480p (SD) and 360p resolutions', () => {
    assert.equal(MediaClassifier.classifyResolution(854, 480), '480p');
    assert.equal(MediaClassifier.classifyResolution(640, 360), '360p');
  });

  test('computes target dimensions with strict downscaling rule', () => {
    // 4K input downscaled to 1080p -> target is 1920x1080
    const downscale = MediaClassifier.computeTargetDimensions(3840, 2160, '1080p');
    assert.equal(downscale.needsScaling, true);
    assert.equal(downscale.targetWidth, 1920);
    assert.equal(downscale.targetHeight, 1080);

    // 720p input requesting 4K -> must NOT upscale; keep at native 720p!
    const noUpscale = MediaClassifier.computeTargetDimensions(1280, 720, '4K');
    assert.equal(noUpscale.needsScaling, false);
    assert.equal(noUpscale.targetWidth, 1280);
    assert.equal(noUpscale.targetHeight, 720);
  });
});

describe('MediaClassifier - Stream-Copy Compatibility', () => {
  const dummyVideo: VideoStreamInfo = {
    index: 0,
    codec: 'h264',
    codecLongName: 'H.264 / AVC',
    width: 1920,
    height: 1080,
    resolutionTier: '1080p',
    aspectRatio: '16:9',
    frameRate: '30/1',
    fps: 30,
    durationSeconds: 60,
    isHdr: false
  };

  const dummyAudio: AudioStreamInfo = {
    index: 1,
    codec: 'aac',
    codecLongName: 'AAC',
    channels: 2,
    channelLayout: 'stereo',
    sampleRate: 48000,
    durationSeconds: 60,
    isLossless: false,
    bitrateKbps: 128
  };

  test('allows full stream copy when codecs and container align without downscaling', () => {
    const evalResult = MediaClassifier.canStreamCopyVideo(dummyVideo, dummyAudio, 'mp4', '1080p');
    assert.equal(evalResult.canCopyVideo, true);
    assert.equal(evalResult.canCopyAudio, true);
  });

  test('rejects stream copy when downscaling is requested', () => {
    const evalResult = MediaClassifier.canStreamCopyVideo(dummyVideo, dummyAudio, 'mp4', '720p');
    assert.equal(evalResult.canCopyVideo, false);
  });

  test('allows video stream copy but requires audio transcode when audio codec is incompatible', () => {
    const opusAudio: AudioStreamInfo = { ...dummyAudio, codec: 'opus' };
    const evalResult = MediaClassifier.canStreamCopyVideo(dummyVideo, opusAudio, 'mp4');
    // In standard MP4, video H.264 copies, but opus may transcode
    assert.equal(evalResult.canCopyVideo, true);
  });
});

describe('MediaClassifier - Audio Honesty Engine', () => {
  const lossyAudio: AudioStreamInfo = {
    index: 0,
    codec: 'aac',
    codecLongName: 'Advanced Audio Coding',
    channels: 2,
    channelLayout: 'stereo',
    sampleRate: 44100,
    bitrateKbps: 128,
    durationSeconds: 60,
    isLossless: false
  };

  test('verifies pure stream copy honesty', () => {
    const report = MediaClassifier.evaluateAudioHonesty(lossyAudio, 'aac');
    assert.equal(report.isStreamCopy, true);
    assert.equal(report.verdict, 'NATIVE_COPY');
  });

  test('exposes FALSE_FIDELITY_UPSAMPLING when extracting lossy AAC to FLAC', () => {
    const report = MediaClassifier.evaluateAudioHonesty(lossyAudio, 'flac');
    assert.equal(report.isStreamCopy, false);
    assert.equal(report.isUpsampling, true);
    assert.equal(report.verdict, 'FALSE_FIDELITY_UPSAMPLING');
    assert.match(report.explanation, /CANNOT restore high frequencies/i);
  });

  test('exposes LOSSY_TO_LOSSY_DEGRADATION when converting 128k to 320k MP3', () => {
    const report = MediaClassifier.evaluateAudioHonesty(lossyAudio, 'mp3', 320);
    assert.equal(report.isUpsampling, true);
    assert.equal(report.verdict, 'LOSSY_TO_LOSSY_DEGRADATION');
    assert.match(report.explanation, /generational compression artifacts/i);
  });
});
