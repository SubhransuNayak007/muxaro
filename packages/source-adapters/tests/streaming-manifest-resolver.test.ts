/**
 * Unit Tests: Streaming Manifest Resolver
 */

import assert from 'node:assert/strict';
import {
  StreamingManifestResolver,
  type RawInnertubeStreamingData,
  type RawInnertubeFormat,
} from '../src/utils/streaming-manifest-resolver.ts';
import { RightsViolationError } from '../src/errors.ts';

console.log('--- Running Streaming Manifest Resolver Tests ---');

// 1. MIME parsing
const mimeTestCases = [
  {
    raw: 'video/mp4; codecs="avc1.640028, mp4a.40.2"',
    expectedContainer: 'mp4',
    expectedVideo: 'h264',
    expectedAudio: 'aac',
    isMuxed: true,
  },
  {
    raw: 'video/webm; codecs="vp9"',
    expectedContainer: 'webm',
    expectedVideo: 'vp9',
    expectedAudio: undefined,
    isMuxed: false,
  },
  {
    raw: 'video/mp4; codecs="av01.0.08M.08"',
    expectedContainer: 'mp4',
    expectedVideo: 'av1',
    expectedAudio: undefined,
    isMuxed: false,
  },
  {
    raw: 'audio/webm; codecs="opus"',
    expectedContainer: 'webm',
    expectedVideo: undefined,
    expectedAudio: 'opus',
    isMuxed: false,
  },
  {
    raw: 'audio/mp4; codecs="mp4a.40.2"',
    expectedContainer: 'm4a',
    expectedVideo: undefined,
    expectedAudio: 'aac',
    isMuxed: false,
  },
];

for (const tc of mimeTestCases) {
  const parsed = StreamingManifestResolver.parseMimeType(tc.raw);
  assert.equal(parsed.container, tc.expectedContainer);
  assert.equal(parsed.videoCodec, tc.expectedVideo);
  assert.equal(parsed.audioCodec, tc.expectedAudio);
  assert.equal(parsed.isMuxed, tc.isMuxed);
}

// 2. Direct URL vs Cipher Extraction
const directFormat: RawInnertubeFormat = {
  itag: 22,
  url: 'https://rr1---sn-example.googlevideo.com/videoplayback?id=123&itag=22',
  mimeType: 'video/mp4; codecs="avc1.64001F, mp4a.40.2"',
};
assert.equal(
  StreamingManifestResolver.extractDirectUrl(directFormat),
  'https://rr1---sn-example.googlevideo.com/videoplayback?id=123&itag=22'
);

const cipherFormat: RawInnertubeFormat = {
  itag: 137,
  signatureCipher:
    's=mockSignature12345&sp=sig&url=https%3A%2F%2Frr2---sn-example.googlevideo.com%2Fvideoplayback%3Fid%3D456',
  mimeType: 'video/mp4; codecs="avc1.640028"',
};
const extractedCipherUrl = StreamingManifestResolver.extractDirectUrl(cipherFormat);
assert.ok(extractedCipherUrl);
assert.ok(extractedCipherUrl.includes('rr2---sn-example.googlevideo.com'));
assert.ok(extractedCipherUrl.includes('sig=mockSignature12345'));

// 3. Resolution Label Formatting
assert.equal(StreamingManifestResolver.buildResolutionLabel(2160, '2160p60', 60), '2160p60 (4K Ultra HD)');
assert.equal(StreamingManifestResolver.buildResolutionLabel(1440, '1440p', 30), '1440p (2K Quad HD)');
assert.equal(StreamingManifestResolver.buildResolutionLabel(1080, '1080p', 30), '1080p (Full HD)');
assert.equal(StreamingManifestResolver.buildResolutionLabel(720, '720p', 30), '720p (HD)');
assert.equal(StreamingManifestResolver.buildResolutionLabel(480, '480p', 30), '480p (Standard)');
assert.equal(StreamingManifestResolver.buildResolutionLabel(360, '360p', 30), '360p (Basic)');

// 4. DRM Rejection Enforcement
const drmFormat: RawInnertubeFormat = {
  itag: 137,
  mimeType: 'video/mp4',
  drmFamilies: { widevine: true },
};
assert.throws(
  () => StreamingManifestResolver.assertNoDrmProtection(drmFormat),
  RightsViolationError,
  'Must reject DRM format'
);

// 5. Full Streaming Manifest Resolution
const mockStreamingData: RawInnertubeStreamingData = {
  expiresInSeconds: '21600',
  formats: [
    {
      itag: 22,
      url: 'https://rr1---sn-test.googlevideo.com/videoplayback?itag=22',
      mimeType: 'video/mp4; codecs="avc1.64001F, mp4a.40.2"',
      width: 1280,
      height: 720,
      fps: 30,
      bitrate: 2200000,
      qualityLabel: '720p',
      contentLength: '45000000',
    },
    {
      itag: 18,
      url: 'https://rr1---sn-test.googlevideo.com/videoplayback?itag=18',
      mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
      width: 640,
      height: 360,
      fps: 30,
      bitrate: 800000,
      qualityLabel: '360p',
      contentLength: '18000000',
    },
  ],
  adaptiveFormats: [
    {
      itag: 137,
      url: 'https://rr1---sn-test.googlevideo.com/videoplayback?itag=137',
      mimeType: 'video/mp4; codecs="avc1.640028"',
      width: 1920,
      height: 1080,
      fps: 60,
      bitrate: 4500000,
      qualityLabel: '1080p60',
      contentLength: '95000000',
    },
    {
      itag: 313,
      url: 'https://rr1---sn-test.googlevideo.com/videoplayback?itag=313',
      mimeType: 'video/webm; codecs="vp9"',
      width: 3840,
      height: 2160,
      fps: 60,
      bitrate: 18000000,
      qualityLabel: '2160p60',
      contentLength: '320000000',
    },
    {
      itag: 140,
      url: 'https://rr1---sn-test.googlevideo.com/videoplayback?itag=140',
      mimeType: 'audio/mp4; codecs="mp4a.40.2"',
      bitrate: 128000,
      audioChannels: 2,
      audioSampleRate: '44100',
      contentLength: '4200000',
    },
    {
      itag: 251,
      url: 'https://rr1---sn-test.googlevideo.com/videoplayback?itag=251',
      mimeType: 'audio/webm; codecs="opus"',
      bitrate: 160000,
      audioChannels: 2,
      audioSampleRate: '48000',
      contentLength: '5100000',
    },
  ],
};

const resolution = StreamingManifestResolver.resolve(mockStreamingData);

assert.equal(resolution.isExtractable, true);
assert.equal(resolution.hasDirectCdnUrls, true);
assert.equal(resolution.totalFormatsCount, 6);
assert.equal(resolution.streams.length, 4); // itag 22, 18, 137, 313
assert.equal(resolution.audioTracks.length, 4); // itag 22, 18 (muxed audio), 140, 251

// Sorting check: highest resolution stream first (2160p -> 1080p -> 720p -> 360p)
assert.equal(resolution.streams[0]?.height, 2160);
assert.equal(resolution.streams[1]?.height, 1080);
assert.equal(resolution.streams[2]?.height, 720);
assert.equal(resolution.streams[3]?.height, 360);

// Primary muxed stream check (itag 22 preferred for single-file playback without remux)
assert.ok(resolution.primaryStream);
assert.equal(resolution.primaryStream?.streamType, 'muxed');
assert.equal(resolution.primaryStream?.height, 720);

// Direct URLs check
for (const stream of resolution.streams) {
  assert.ok(stream.directUrl);
  assert.equal(stream.isStreamExtractable, true);
}

// Audio tracks check
assert.ok(resolution.bestAudioTrack);
assert.equal(resolution.bestAudioTrack?.isExtractable, true);
assert.ok(resolution.bestAudioTrack?.directUrl);

console.log('✓ Streaming Manifest Resolver Tests passed successfully');
