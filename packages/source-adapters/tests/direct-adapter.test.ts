/**
 * Unit Tests: Direct Media Source Adapter
 */

import assert from 'node:assert/strict';
import * as http from 'node:http';
import { DirectMediaAdapter } from '../src/direct-adapter.ts';
import { InvalidMediaError } from '../src/errors.ts';
import {
  classifyMedia,
  extractExtension,
  parseContentDispositionFilename,
} from '../src/utils/mime-detector.ts';

console.log('--- Running Direct Media Adapter Tests ---');

const adapter = new DirectMediaAdapter();

// 1. canHandle URL routing checks
assert.equal(adapter.canHandle('https://cdn.example.com/assets/video.mp4'), true);
assert.equal(adapter.canHandle('https://cdn.example.com/assets/video.webm'), true);
assert.equal(adapter.canHandle('https://cdn.example.com/assets/movie.mkv'), true);
assert.equal(adapter.canHandle('https://cdn.example.com/audio/song.mp3'), true);
assert.equal(adapter.canHandle('https://cdn.example.com/audio/track.wav'), true);
assert.equal(adapter.canHandle('https://cdn.example.com/audio/album.flac'), true);
assert.equal(adapter.canHandle('https://cdn.example.com/audio/recording.m4a'), true);
assert.equal(adapter.canHandle('https://cdn.example.com/audio/stream.aac'), true);
assert.equal(adapter.canHandle('https://cdn.example.com/audio/sound.ogg'), true);

// YouTube links must NOT be handled by DirectMediaAdapter
assert.equal(adapter.canHandle('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), false);
assert.equal(adapter.canHandle('https://youtu.be/dQw4w9WgXcQ'), false);

// 2. MIME & Container Classification Tests
const mp4Class = classifyMedia('video/mp4', 'test.mp4');
assert.ok(mp4Class);
assert.equal(mp4Class.container, 'mp4');
assert.equal(mp4Class.isVideo, true);
assert.equal(mp4Class.defaultVideoCodec, 'h264');

const webmClass = classifyMedia('video/webm', 'video.webm');
assert.ok(webmClass);
assert.equal(webmClass.container, 'webm');
assert.equal(webmClass.defaultVideoCodec, 'vp9');

const mkvClass = classifyMedia('video/x-matroska', 'video.mkv');
assert.ok(mkvClass);
assert.equal(mkvClass.container, 'mkv');

const mp3Class = classifyMedia('audio/mpeg', 'song.mp3');
assert.ok(mp3Class);
assert.equal(mp3Class.container, 'mp3');
assert.equal(mp3Class.isAudioOnly, true);
assert.equal(mp3Class.defaultAudioCodec, 'mp3');

const flacClass = classifyMedia('audio/flac', 'track.flac');
assert.ok(flacClass);
assert.equal(flacClass.container, 'flac');
assert.equal(flacClass.defaultAudioCodec, 'flac');

const wavClass = classifyMedia('audio/wav', 'audio.wav');
assert.ok(wavClass);
assert.equal(wavClass.container, 'wav');
assert.equal(wavClass.defaultAudioCodec, 'pcm');

const m4aClass = classifyMedia('audio/mp4', 'track.m4a');
assert.ok(m4aClass);
assert.equal(m4aClass.container, 'm4a');

// 3. Content-Disposition Parsing Tests
assert.equal(
  parseContentDispositionFilename('attachment; filename="presentation.mp4"'),
  'presentation.mp4'
);
assert.equal(
  parseContentDispositionFilename("attachment; filename*=UTF-8''summer%20holiday%20video.mp4"),
  'summer holiday video.mp4'
);
assert.equal(
  parseContentDispositionFilename('inline; filename=song_audio.mp3'),
  'song_audio.mp3'
);
assert.equal(parseContentDispositionFilename(null), null);

// 4. End-to-End Inspection with Local Test HTTP Server
// Set up a mock media server simulating HEAD and Range requests
const server = http.createServer((req, res) => {
  const urlPath = req.url || '/';

  // Scenario 1: Standard MP4 video with full HEAD support
  if (urlPath === '/media/sample.mp4') {
    if (req.method === 'HEAD' || req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': '10485760',
        'Accept-Ranges': 'bytes',
        'Content-Disposition': 'inline; filename="sample.mp4"',
        ETag: '"3a4f-5b12345"',
      });
      res.end();
      return;
    }
  }

  // Scenario 2: FLAC audio with 405 Method Not Allowed on HEAD, requires Range GET fallback
  if (urlPath === '/media/music.flac') {
    if (req.method === 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }
    if (req.method === 'GET') {
      // Range: bytes=0-0
      res.writeHead(206, {
        'Content-Type': 'audio/flac',
        'Content-Range': 'bytes 0-0/4567890',
        'Content-Length': '1',
        'Accept-Ranges': 'bytes',
        'Content-Disposition': "attachment; filename*=UTF-8''highres_audio.flac",
      });
      res.end('f'); // 1 byte
      return;
    }
  }

  // Scenario 3: Non-media webpage (e.g. text/html)
  if (urlPath === '/media/page.html') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': '500',
    });
    res.end('<html><body>Not Media</body></html>');
    return;
  }

  // Default 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

await new Promise<void>((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve());
});

const port = (server.address() as { port: number }).port;
const baseUrl = `http://127.0.0.1:${port}`;

try {
  // Test 4A: Inspect standard MP4 (bypassing SSRF for local test harness)
  const mp4Url = `${baseUrl}/media/sample.mp4`;
  const mp4Manifest = await adapter.inspect(mp4Url, {
    ssrfValidator: async () => ({ isSafe: true, override: true }),
  });

  assert.equal(mp4Manifest.sourceType, 'direct_media');
  assert.equal(mp4Manifest.container, 'mp4');
  assert.equal(mp4Manifest.mimeType, 'video/mp4');
  assert.equal(mp4Manifest.filesizeBytes, 10485760);
  assert.equal(mp4Manifest.title, 'sample');
  assert.equal(mp4Manifest.canExtractStreams, true);
  assert.ok(mp4Manifest.streams.length > 0);
  assert.equal(mp4Manifest.streams[0].streamType, 'muxed');
  assert.equal(mp4Manifest.streams[0].isStreamExtractable, true);
  assert.ok(mp4Manifest.audioTracks.length > 0);
  assert.equal(mp4Manifest.audioTracks[0].isExtractable, true);

  // Test 4B: Inspect FLAC with 405 HEAD and Range GET fallback
  const flacUrl = `${baseUrl}/media/music.flac`;
  const flacManifest = await adapter.inspect(flacUrl, {
    ssrfValidator: async () => ({ isSafe: true, override: true }),
  });

  assert.equal(flacManifest.sourceType, 'direct_media');
  assert.equal(flacManifest.container, 'flac');
  assert.equal(flacManifest.mimeType, 'audio/flac');
  assert.equal(flacManifest.filesizeBytes, 4567890);
  assert.equal(flacManifest.title, 'highres_audio');
  assert.equal(flacManifest.canExtractStreams, true);
  assert.equal(flacManifest.streams[0].streamType, 'audio');
  assert.equal(flacManifest.audioTracks[0].codec, 'flac');

  // Test 4C: Inspect non-media HTML page -> should throw InvalidMediaError
  const htmlUrl = `${baseUrl}/media/page.html`;
  await assert.rejects(
    async () => {
      await adapter.inspect(htmlUrl, {
        ssrfValidator: async () => ({ isSafe: true, override: true }),
      });
    },
    InvalidMediaError,
    'Expected non-media page to throw InvalidMediaError'
  );

  // Test 4D: 404 response -> should throw InvalidMediaError
  const notFoundUrl = `${baseUrl}/media/missing.mp4`;
  await assert.rejects(
    async () => {
      await adapter.inspect(notFoundUrl, {
        ssrfValidator: async () => ({ isSafe: true, override: true }),
      });
    },
    InvalidMediaError,
    'Expected 404 to throw InvalidMediaError'
  );
} finally {
  server.close();
}

console.log('✓ Direct Media Adapter Tests passed successfully');
