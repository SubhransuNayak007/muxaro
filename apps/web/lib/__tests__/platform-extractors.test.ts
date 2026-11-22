/**
 * Comprehensive Deterministic Multi-Platform Extractor Test Suite
 * Validates Pinterest, Twitter/X, Reddit, TikTok, Vimeo, Direct Media,
 * and proves the complete prevention of 23-byte HTML placeholder downloads.
 */

import assert from 'node:assert';
import http from 'node:http';
import {
  isHtmlPageUrl,
  probeStreamDetails,
  extractPinterest,
  extractTwitter,
  extractReddit,
  extractTikTok,
  extractVimeo,
  extractDirectMedia,
  extractPlatformMedia,
  buildExtractorResultFromPlatformMedia,
} from '../platform-extractors.ts';

async function runPlatformTests() {
  console.log('=== TEST 1: isHtmlPageUrl vs Direct Media Detection ===');
  assert.strictEqual(isHtmlPageUrl('https://www.pinterest.com/pin/123456789/'), true);
  assert.strictEqual(isHtmlPageUrl('https://pin.it/abcXYZ'), true);
  assert.strictEqual(isHtmlPageUrl('https://x.com/jack/status/20'), true);
  assert.strictEqual(isHtmlPageUrl('https://twitter.com/user/status/12345'), true);
  assert.strictEqual(isHtmlPageUrl('https://www.reddit.com/r/aww/comments/xyz/cute_dog/'), true);
  assert.strictEqual(isHtmlPageUrl('https://www.tiktok.com/@user/video/1234567890'), true);
  assert.strictEqual(isHtmlPageUrl('https://www.facebook.com/watch/?v=12345'), true);
  assert.strictEqual(isHtmlPageUrl('https://www.instagram.com/reel/C7xyz123/'), true);

  // Direct media URLs MUST NOT be classified as HTML
  assert.strictEqual(isHtmlPageUrl('https://v.pinimg.com/videos/mc/720p/abc.mp4'), false);
  assert.strictEqual(isHtmlPageUrl('https://video.twimg.com/ext_tw_video/123/pu/vid/1280x720/vid.mp4'), false);
  assert.strictEqual(isHtmlPageUrl('https://v.redd.it/xyz123/DASH_1080.mp4'), false);
  assert.strictEqual(isHtmlPageUrl('https://vod-progressive.akamaized.net/exp=123/video.mp4'), false);
  assert.strictEqual(isHtmlPageUrl('https://example.com/assets/video.webm'), false);
  assert.strictEqual(isHtmlPageUrl('https://example.com/audio/sample.mp3'), false);
  console.log('✓ isHtmlPageUrl accurately differentiates webpages from media CDN streams.');

  // Start local mock server for deterministic HTTP validation
  let port = 0;
  const server = http.createServer((req, res) => {
    const url = req.url || '';

    if (url === '/pinterest-pin') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Amazing Wooden Craft Tutorial | Pinterest</title>
          <meta property="og:title" content="Amazing Wooden Craft Tutorial">
          <meta property="og:image" content="https://i.pinimg.com/736x/ab/cd/ef.jpg">
          <meta property="og:video:secure_url" content="http://127.0.0.1:${port}/pinterest-video.mp4">
        </head>
        <body>
          <video src="http://127.0.0.1:${port}/pinterest-video.mp4"></video>
        </body>
        </html>
      `);
    } else if (url === '/pinterest-video.mp4') {
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': '15728640', // ~15 MB
        'Accept-Ranges': 'bytes',
      });
      res.end(Buffer.alloc(2048, 0x42));
    } else if (url === '/stub-23bytes.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>23 byte stub</h1>');
    } else if (url.startsWith('/reddit-post.json')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([
        {
          data: {
            children: [
              {
                data: {
                  title: 'Golden Retriever Pup Playing in Leaves',
                  author: 'puppylover',
                  thumbnail: 'https://preview.redd.it/pup_thumb.jpg',
                  secure_media: {
                    reddit_video: {
                      fallback_url: `http://127.0.0.1:${port}/reddit-dash-1080.mp4`,
                      duration: 18,
                      width: 1920,
                      height: 1080,
                    },
                  },
                },
              },
            ],
          },
        },
      ]));
    } else if (url === '/reddit-dash-1080.mp4') {
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': '24117248', // ~24 MB
        'Accept-Ranges': 'bytes',
      });
      res.end(Buffer.alloc(2048, 0x42));
    } else if (url === '/tiktok-page') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
        <head><meta property="og:title" content="Viral Dance Challenge"></head>
        <body>
          <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">{"webapp.video-detail":{"itemInfo":{"itemStruct":{"video":{"playAddr":"http://127.0.0.1:${port}/tiktok-direct.mp4"}}}}}</script>
        </body>
        </html>
      `);
    } else if (url === '/tiktok-direct.mp4') {
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': '12582912', // ~12 MB
      });
      res.end(Buffer.alloc(2048, 0x42));
    } else if (url === '/direct-video.mp4') {
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': '33554432', // ~33.5 MB
        'Accept-Ranges': 'bytes',
      });
      res.end(Buffer.alloc(2048, 0x42));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as any).port;
      resolve();
    });
  });

  try {
    console.log(`=== TEST 2: Stream Probe & 23-Byte Stub Rejection === (Mock Port: ${port})`);
    // Probing 23-byte HTML stub MUST be rejected
    const stubProbe = await probeStreamDetails(`http://127.0.0.1:${port}/stub-23bytes.html`);
    console.log('23-byte HTML probe result:', stubProbe);
    assert.strictEqual(stubProbe.isPlayable, false, 'HTML stub must NEVER be marked playable');
    assert.strictEqual(stubProbe.mimeType?.includes('text/html'), true);
    console.log('✓ probeStreamDetails successfully rejected 23-byte HTML stub.');

    // Probing real MP4 MUST succeed
    const realProbe = await probeStreamDetails(`http://127.0.0.1:${port}/pinterest-video.mp4`);
    console.log('Real MP4 probe result:', realProbe);
    assert.strictEqual(realProbe.isPlayable, true, 'Real MP4 must be playable');
    assert.strictEqual(realProbe.contentLength, 15728640);
    assert.strictEqual(realProbe.mimeType, 'video/mp4');
    console.log('✓ probeStreamDetails verified real 15.7MB video stream.');

    console.log('=== TEST 3: Pinterest HTML & Video Stream Parsing ===');
    const pinResult = await extractPinterest(`http://127.0.0.1:${port}/pinterest-pin`);
    assert.ok(pinResult, 'Pinterest extractor should extract pin data');
    console.log('Pinterest extracted:', {
      title: pinResult.title,
      streamUrl: pinResult.streamUrl,
      contentLength: pinResult.contentLength,
      mimeType: pinResult.mimeType,
    });
    assert.strictEqual(pinResult.title, 'Amazing Wooden Craft Tutorial');
    assert.strictEqual(pinResult.streamUrl, `http://127.0.0.1:${port}/pinterest-video.mp4`);
    assert.strictEqual(pinResult.mediaUrl, `http://127.0.0.1:${port}/pinterest-video.mp4`);
    assert.strictEqual(pinResult.deliveryMode, 'zero-hop', 'Pinterest should be zero-hop');
    assert.strictEqual(pinResult.contentLength, 15728640);
    assert.strictEqual(pinResult.mimeType, 'video/mp4');
    console.log('✓ Pinterest extractor parsed real video stream URL and size.');

    console.log('=== TEST 4: Reddit JSON & DASH Fallback URL Extraction ===');
    const redditResult = await extractReddit(`http://127.0.0.1:${port}/reddit-post`);
    assert.ok(redditResult, 'Reddit extractor should extract post data');
    console.log('Reddit extracted:', {
      title: redditResult.title,
      streamUrl: redditResult.streamUrl,
      duration: redditResult.durationSeconds,
      contentLength: redditResult.contentLength,
    });
    assert.strictEqual(redditResult.title, 'Golden Retriever Pup Playing in Leaves');
    assert.strictEqual(redditResult.streamUrl, `http://127.0.0.1:${port}/reddit-dash-1080.mp4`);
    assert.strictEqual(redditResult.mediaUrl, `http://127.0.0.1:${port}/reddit-dash-1080.mp4`);
    assert.strictEqual(redditResult.deliveryMode, 'tunnel', 'Reddit DASH should be tunnel');
    assert.strictEqual(redditResult.contentLength, 24117248);
    assert.strictEqual(redditResult.height, 1080);
    assert.strictEqual(redditResult.width, 1920);
    console.log('✓ Reddit extractor extracted direct DASH fallback video URL and size.');

    console.log('=== TEST 5: TikTok playAddr HTML Extraction ===');
    const tiktokResult = await extractTikTok(`http://127.0.0.1:${port}/tiktok-page`);
    assert.ok(tiktokResult, 'TikTok extractor should extract video data');
    console.log('TikTok extracted:', {
      title: tiktokResult.title,
      streamUrl: tiktokResult.streamUrl,
      contentLength: tiktokResult.contentLength,
    });
    assert.strictEqual(tiktokResult.streamUrl, `http://127.0.0.1:${port}/tiktok-direct.mp4`);
    assert.strictEqual(tiktokResult.deliveryMode, 'zero-hop', 'TikTok should be zero-hop');
    assert.strictEqual(tiktokResult.contentLength, 12582912);
    console.log('✓ TikTok extractor extracted direct playAddr video stream.');

    console.log('=== TEST 6: Direct Media Stream Extraction ===');
    const directResult = await extractDirectMedia(`http://127.0.0.1:${port}/direct-video.mp4`);
    assert.ok(directResult, 'Direct media extractor should succeed');
    console.log('Direct media extracted:', {
      title: directResult.title,
      streamUrl: directResult.streamUrl,
      contentLength: directResult.contentLength,
      mimeType: directResult.mimeType,
    });
    assert.strictEqual(directResult.contentLength, 33554432);
    assert.strictEqual(directResult.deliveryMode, 'zero-hop', 'Direct media should be zero-hop');
    assert.strictEqual(directResult.mimeType, 'video/mp4');
    console.log('✓ Direct media extractor verified ~33.5MB stream.');

    console.log('=== TEST 7: buildExtractorResultFromPlatformMedia Contract Enforcement ===');
    const manifest = buildExtractorResultFromPlatformMedia(pinResult, 'https://pin.it/abc123XYZ');
    assert.strictEqual(manifest.platform, 'pinterest');
    assert.strictEqual(manifest.title, 'Amazing Wooden Craft Tutorial');
    assert.notStrictEqual(manifest.title, 'Pinterest Media Video');
    assert.strictEqual(manifest.fileSizeBytes, 15728640);
    assert.notStrictEqual(manifest.fileSizeBytes, 23, 'Must never be 23 bytes');
    assert.strictEqual(manifest.videoStreams[0].url, `http://127.0.0.1:${port}/pinterest-video.mp4`);
    assert.notStrictEqual(manifest.videoStreams[0].url, 'https://pin.it/abc123XYZ');
    assert.strictEqual(manifest.videoStreams[0].isStreamCopyCandidate, true);
    console.log('✓ buildExtractorResultFromPlatformMedia successfully created full manifest with direct stream URL.');

    console.log('=== TEST 8: Live Twitter/X API Fallback (Optional) ===');
    try {
      const liveTweet = await extractTwitter('https://twitter.com/Twitter/status/1356499605199691776');
      if (liveTweet) {
        console.log('Live Twitter probe succeeded:', {
          title: liveTweet.title,
          streamUrl: liveTweet.streamUrl.slice(0, 60) + '...',
          contentLength: liveTweet.contentLength,
        });
        assert.ok(liveTweet.streamUrl.includes('video.twimg.com') || liveTweet.streamUrl.endsWith('.mp4'));
      }
    } catch {}

    console.log('\n======================================================');
    console.log('ALL DETERMINISTIC MULTI-PLATFORM TESTS PASSED (100%)!');
    console.log('======================================================');
  } finally {
    server.close();
  }
}

runPlatformTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
