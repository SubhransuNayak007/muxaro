/**
 * Unit Tests: YouTube Source Adapter (Innertube Multi-Client Fallback & Extraction)
 */

import assert from 'node:assert/strict';
import { YouTubeAdapter } from '../src/youtube-adapter.ts';
import { YouTubePermittedAdapter } from '../src/youtube-permitted-adapter.ts';
import { InvalidMediaError, RightsViolationError } from '../src/errors.ts';

console.log('--- Running YouTube Source Adapter Tests ---');

// 1. Adapter Capabilities & Contract
const adapter = new YouTubeAdapter();
assert.equal(adapter.name, 'youtube-adapter');
assert.equal(adapter.id, 'youtube-source-adapter');

const caps = adapter.getCapabilities();
assert.equal(caps.canExtractMedia, true, 'Extraction capability MUST be active');
assert.equal(caps.canFetchMetadata, true);
assert.equal(caps.canGeneratePreview, true);
assert.ok(caps.supportedContainers.includes('mp4'));
assert.ok(caps.supportedContainers.includes('webm'));
assert.ok(caps.supportedContainers.includes('m4a'));

// 2. URL Identification and Video ID Extraction
const validUrls = [
  { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
  { url: 'https://youtube.com/watch?v=dQw4w9WgXcQ&t=120s', expected: 'dQw4w9WgXcQ' },
  { url: 'https://m.youtube.com/watch?v=dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
  { url: 'https://music.youtube.com/watch?v=dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
  { url: 'https://youtu.be/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
  { url: 'https://youtu.be/dQw4w9WgXcQ?si=test123456', expected: 'dQw4w9WgXcQ' },
  { url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
  { url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
  { url: 'https://www.youtube.com/v/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
];

for (const { url, expected } of validUrls) {
  assert.equal(adapter.canHandle(url), true, `Expected canHandle to be true for ${url}`);
  assert.equal(adapter.extractVideoId(url), expected, `extractVideoId failed for ${url}`);
}

const invalidUrls = [
  'https://vimeo.com/12345678',
  'https://tiktok.com/@user/video/123',
  'https://www.youtube.com/watch?v=short',
  'https://www.youtube.com/channel/UC12345678',
  'not-a-url',
];

for (const url of invalidUrls) {
  assert.equal(adapter.canHandle(url), false);
  assert.equal(adapter.extractVideoId(url), null);
}

// 3. Mock Innertube Multi-Client Fallback
const mockStreamingData = {
  expiresInSeconds: '21600',
  formats: [
    {
      itag: 22,
      url: 'https://rr1---sn-test.googlevideo.com/videoplayback?itag=22&id=sample',
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
      url: 'https://rr1---sn-test.googlevideo.com/videoplayback?itag=18&id=sample',
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
      url: 'https://rr1---sn-test.googlevideo.com/videoplayback?itag=137&id=sample',
      mimeType: 'video/mp4; codecs="avc1.640028"',
      width: 1920,
      height: 1080,
      fps: 60,
      bitrate: 4500000,
      qualityLabel: '1080p60',
      contentLength: '95000000',
    },
    {
      itag: 140,
      url: 'https://rr1---sn-test.googlevideo.com/videoplayback?itag=140&id=sample',
      mimeType: 'audio/mp4; codecs="mp4a.40.2"',
      bitrate: 128000,
      audioChannels: 2,
      audioSampleRate: '44100',
      contentLength: '4200000',
    },
  ],
};

const mockVideoDetails = {
  title: 'Test Garuda Video',
  author: 'Garuda Creator',
  channelId: 'UCgaruda123',
  lengthSeconds: '210',
  shortDescription: 'High performance extraction test',
  thumbnail: {
    thumbnails: [
      { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg', width: 120, height: 90 },
      { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg', width: 1920, height: 1080 },
    ],
  },
};

// Scenario A: TVHTML5_SIMPLY_EMBEDDED succeeds on first attempt
const mockFetchTVSucceeds = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const body = JSON.stringify({
    playabilityStatus: { status: 'OK' },
    videoDetails: mockVideoDetails,
    streamingData: mockStreamingData,
  });

  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const tvAdapter = new YouTubeAdapter({ customFetch: mockFetchTVSucceeds as any });
const manifestTV = await tvAdapter.inspect('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

assert.equal(manifestTV.title, 'Test Garuda Video');
assert.equal(manifestTV.author, 'Garuda Creator');
assert.equal(manifestTV.durationSeconds, 210);
assert.equal(manifestTV.canExtractStreams, true, 'canExtractStreams must be true');
assert.equal(manifestTV.streams.length, 3); // itag 137 (1080p), itag 22 (720p), itag 18 (360p)
assert.equal(manifestTV.audioTracks.length, 3); // itag 140 + muxed audio tracks
assert.ok(manifestTV.metadata.activeClientUsed === 'TVHTML5_SIMPLY_EMBEDDED');

// Direct CDN URLs verification
for (const stream of manifestTV.streams) {
  assert.ok(stream.directUrl);
  assert.ok(stream.directUrl.includes('googlevideo.com'));
  assert.equal(stream.isStreamExtractable, true);
}

// Scenario B: TV profile fails (bot block), falling back to IOS
let callCount = 0;
const mockFetchFallbackToIOS = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  callCount++;
  const headers = (init?.headers || {}) as Record<string, string>;

  // If TVHTML5 client
  if (headers['X-YouTube-Client-Name'] === '85') {
    // Fail with simulated bot check
    return new Response(
      JSON.stringify({
        playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you are not a bot' },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // If IOS client
  if (headers['X-YouTube-Client-Name'] === '5') {
    return new Response(
      JSON.stringify({
        playabilityStatus: { status: 'OK' },
        videoDetails: mockVideoDetails,
        streamingData: mockStreamingData,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(JSON.stringify({ playabilityStatus: { status: 'ERROR' } }), { status: 400 });
};

const iosAdapter = new YouTubeAdapter({ customFetch: mockFetchFallbackToIOS as any });
const manifestIOS = await iosAdapter.inspect('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
assert.equal(manifestIOS.canExtractStreams, true);
assert.equal(manifestIOS.metadata.activeClientUsed, 'IOS', 'Should fall back to IOS client');
assert.equal(manifestIOS.streams.length, 3);

// 4. getDownloadStreams verification
const downloadStreams = await tvAdapter.getDownloadStreams(
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  ['itag-137']
);
assert.equal(downloadStreams.length, 1);
assert.equal(downloadStreams[0]?.id, 'itag-137');
assert.equal(downloadStreams[0]?.resolution, '1920x1080');
assert.ok(downloadStreams[0]?.directUrl?.includes('googlevideo.com'));

// 5. DRM Rejection Tripwire Verification
const mockFetchDRM = async (): Promise<Response> => {
  return new Response(
    JSON.stringify({
      playabilityStatus: {
        status: 'UNPLAYABLE',
        reason: 'This video requires payment and DRM license verification',
        drmFamilies: { widevine: true },
      },
      videoDetails: mockVideoDetails,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};

const drmAdapter = new YouTubeAdapter({ customFetch: mockFetchDRM as any });
await assert.rejects(
  async () => {
    await drmAdapter.inspect('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  },
  RightsViolationError,
  'DRM encrypted streams must be strictly rejected under non-circumvention rules'
);

// 6. YouTubePermittedAdapter with active extraction mode
const permittedExtractionAdapter = new YouTubePermittedAdapter({
  allowExtraction: true,
  customFetch: mockFetchTVSucceeds as any,
});
assert.equal(permittedExtractionAdapter.getCapabilities().canExtractMedia, true);

const permittedManifest = await permittedExtractionAdapter.inspect(
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
);
assert.equal(permittedManifest.canExtractStreams, true);
assert.ok(permittedManifest.streams.length > 0);

const resolvedDownloadStreams = await permittedExtractionAdapter.getDownloadStreams(
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  ['itag-22']
);
assert.equal(resolvedDownloadStreams.length, 1);
assert.equal(resolvedDownloadStreams[0]?.id, 'itag-22');

console.log('✓ YouTube Source Adapter Tests passed successfully');
