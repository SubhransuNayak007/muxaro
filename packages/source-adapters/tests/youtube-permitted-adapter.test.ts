/**
 * Unit Tests: YouTube Permitted Adapter
 */

import assert from 'node:assert/strict';
import { YouTubePermittedAdapter } from '../src/youtube-permitted-adapter.ts';
import { ExtractionDisabledError, InvalidMediaError } from '../src/errors.ts';

console.log('--- Running YouTube Permitted Adapter Tests ---');

const adapter = new YouTubePermittedAdapter();

// 1. Identity & capabilities check
assert.equal(adapter.name, 'youtube-permitted-adapter');
const caps = adapter.getCapabilities();
assert.equal(caps.canExtractMedia, false, 'Audiovisual stream extraction MUST be disabled');
assert.equal(caps.canFetchMetadata, true);
assert.equal(caps.canGeneratePreview, true);
assert.ok(caps.complianceNotes.includes('disabled pending written platform agreement'));

// 2. Video ID Parsing across URL variants
const validUrls = [
  { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', expectedId: 'dQw4w9WgXcQ' },
  { url: 'https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s', expectedId: 'dQw4w9WgXcQ' },
  { url: 'https://m.youtube.com/watch?v=dQw4w9WgXcQ', expectedId: 'dQw4w9WgXcQ' },
  { url: 'https://music.youtube.com/watch?v=dQw4w9WgXcQ', expectedId: 'dQw4w9WgXcQ' },
  { url: 'https://youtu.be/dQw4w9WgXcQ', expectedId: 'dQw4w9WgXcQ' },
  { url: 'https://youtu.be/dQw4w9WgXcQ?si=abcdef123456', expectedId: 'dQw4w9WgXcQ' },
  { url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', expectedId: 'dQw4w9WgXcQ' },
  { url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ', expectedId: 'dQw4w9WgXcQ' },
];

for (const { url, expectedId } of validUrls) {
  assert.equal(adapter.canHandle(url), true, `canHandle failed for: ${url}`);
  assert.equal(adapter.extractVideoId(url), expectedId, `extractVideoId failed for: ${url}`);
}

// 3. Rejection of invalid URLs
const invalidUrls = [
  'https://www.vimeo.com/12345678',
  'https://example.com/video.mp4',
  'https://www.youtube.com/watch?v=short', // ID too short (< 11 chars)
  'https://www.youtube.com/feed/subscriptions',
  'https://www.youtube.com/channel/UC12345678',
];

for (const url of invalidUrls) {
  assert.equal(adapter.canHandle(url), false, `Expected canHandle to be false for: ${url}`);
  assert.equal(adapter.extractVideoId(url), null);
}

// 4. Inspection of permitted URL
const testUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const manifest = await adapter.inspect(testUrl);

assert.equal(manifest.sourceType, 'youtube_permitted');
assert.equal(manifest.canonicalUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
assert.equal(manifest.canExtractStreams, false, 'canExtractStreams in manifest must be strictly false');
assert.ok(manifest.extractionPolicyNotice.includes('Audiovisual stream extraction from YouTube is disabled'));
assert.ok(manifest.previewUrl?.includes('youtube-nocookie.com/embed/dQw4w9WgXcQ'));
assert.ok(manifest.embedHtml?.includes('<iframe'));
assert.ok(manifest.embedHtml?.includes('dQw4w9WgXcQ'));
assert.ok(manifest.thumbnailUrl?.includes('dQw4w9WgXcQ'));

// Verify streams inside manifest are flagged as non-extractable
assert.ok(manifest.streams.length > 0);
for (const stream of manifest.streams) {
  assert.equal(stream.isStreamExtractable, false);
  assert.equal(stream.directUrl, undefined);
}

for (const audio of manifest.audioTracks) {
  assert.equal(audio.isExtractable, false);
  assert.equal(audio.directUrl, undefined);
}

// 5. Direct Stream Extraction Prohibition
await assert.rejects(
  async () => {
    await adapter.getDownloadStreams(testUrl, ['preview-stream']);
  },
  ExtractionDisabledError,
  'getDownloadStreams must throw ExtractionDisabledError'
);

console.log('✓ YouTube Permitted Adapter Tests passed successfully');
