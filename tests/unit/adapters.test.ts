/**
 * Project VYRO - Independent QA Test Suite
 * Test File: tests/unit/adapters.test.ts
 *
 * Verifies Source Adapters, Direct Media Inspection, YouTube Permitted Policy Enforcement,
 * Rights Validation, and MIME Detection
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SourceAdapterRegistry,
  defaultAdapterRegistry,
  DirectMediaAdapter,
  YouTubePermittedAdapter,
  ExtractionDisabledError,
  UnsupportedSourceError,
  AbuseDetectedError,
  InvalidMediaError,
  AbuseDetector,
  RightsValidator,
  classifyMedia,
  extractExtension,
  parseContentDispositionFilename,
} from '../../packages/source-adapters/src/index.ts';

describe('Source Adapters - Registry and Routing', () => {
  const registry = new SourceAdapterRegistry();

  it('should register standard adapters with correct priorities', () => {
    const list = registry.listSupportedSources();
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0]?.name, 'youtube-permitted-adapter');
    assert.strictEqual(list[1]?.name, 'direct-media-adapter');
  });

  it('should route YouTube URLs to YouTubePermittedAdapter', () => {
    const urls = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
    ];

    for (const url of urls) {
      const adapter = registry.findAdapter(url);
      assert.ok(adapter, `Adapter not found for ${url}`);
      assert.strictEqual(adapter.name, 'youtube-permitted-adapter');
    }
  });

  it('should route direct media links to DirectMediaAdapter', () => {
    const urls = [
      'https://cdn.example.com/videos/sample.mp4',
      'https://cdn.example.com/trailers/teaser.webm',
      'http://archive.org/download/audio.mp3',
      'https://example.com/soundtrack.flac',
      'https://example.com/recording.wav',
      'https://example.com/music.m4a',
    ];

    for (const url of urls) {
      const adapter = registry.findAdapter(url);
      assert.ok(adapter, `Adapter not found for ${url}`);
      assert.strictEqual(adapter.name, 'direct-media-adapter');
    }
  });

  it('should throw UnsupportedSourceError for unsupported protocols', () => {
    const unsupportedUrls = [
      'ftp://ftp.funet.fi/pub/archive.tar.gz',
      'file:///var/media/test.mp4',
      'gopher://internal.lan/media.mp4',
    ];

    for (const url of unsupportedUrls) {
      assert.throws(
        () => registry.getAdapter(url),
        (err: unknown) => {
          assert.ok(err instanceof UnsupportedSourceError);
          return true;
        }
      );
    }
  });
});

describe('Source Adapters - YouTubePermittedAdapter Strict Policy Enforcement', () => {
  const ytAdapter = new YouTubePermittedAdapter();

  it('MANDATORY POLICY: Capabilities must declare canExtractMedia = false', () => {
    const caps = ytAdapter.getCapabilities();
    assert.strictEqual(caps.canExtractMedia, false, 'canExtractMedia must be strictly false');
    assert.strictEqual(caps.canFetchMetadata, true, 'canFetchMetadata must be true');
    assert.strictEqual(caps.canGeneratePreview, true, 'canGeneratePreview must be true');
    assert.ok(caps.complianceNotes.includes('disabled'), 'Must explain extraction is disabled');
  });

  it('MANDATORY POLICY: getDownloadStreams must throw ExtractionDisabledError', async () => {
    await assert.rejects(
      async () => {
        await ytAdapter.getDownloadStreams('https://www.youtube.com/watch?v=dQw4w9WgXcQ', ['stream-0']);
      },
      (err: unknown) => {
        assert.ok(err instanceof ExtractionDisabledError);
        assert.ok((err as ExtractionDisabledError).message.includes('ERR_SOURCE_PLATFORM_NOT_PERMITTED'));
        return true;
      }
    );
  });

  it('should correctly parse valid 11-character video IDs', () => {
    assert.strictEqual(
      ytAdapter.extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
      'dQw4w9WgXcQ'
    );
    assert.strictEqual(
      ytAdapter.extractVideoId('https://youtu.be/dQw4w9WgXcQ'),
      'dQw4w9WgXcQ'
    );
    assert.strictEqual(
      ytAdapter.extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ'),
      'dQw4w9WgXcQ'
    );
    assert.strictEqual(
      ytAdapter.extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'),
      'dQw4w9WgXcQ'
    );
  });

  it('should reject invalid or non-11-character video IDs', () => {
    assert.strictEqual(ytAdapter.extractVideoId('https://www.youtube.com/watch?v=short'), null);
    assert.strictEqual(ytAdapter.extractVideoId('https://www.youtube.com/watch?v=toolongvideoidentifiertest'), null);
    assert.strictEqual(ytAdapter.extractVideoId('https://www.youtube.com/watch?v=invalid$char!'), null);
  });
});

describe('Source Adapters - Abuse Detection Guard', () => {
  it('should reject URL payloads attempting command injection, proxy rotation, or evasion queries', () => {
    const maliciousUrls = [
      'https://example.com/video.mp4;rm -rf /',
      'https://example.com/video.mp4|nc 10.0.0.1 80',
      'https://example.com/video.mp4?proxy=http://127.0.0.1:8080',
      'https://example.com/video.mp4?rotate_ip=true',
      'https://example.com/video.mp4?bypass_captcha=1',
      'https://example.com/video.mp4?scrape_stream=all',
    ];

    for (const malUrl of maliciousUrls) {
      assert.throws(
        () => AbuseDetector.assertSafe(malUrl),
        (err: unknown) => {
          assert.ok(err instanceof AbuseDetectedError);
          return true;
        }
      );
    }
  });

  it('should accept clean media URLs', () => {
    assert.doesNotThrow(() => {
      AbuseDetector.assertSafe('https://cdn.example.com/media/2026/film_1080p.mp4');
      AbuseDetector.assertSafe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    });
  });
});

describe('Source Adapters - MIME Detection and Classification', () => {
  it('should correctly classify video and audio media types', () => {
    const mp4Class = classifyMedia('video/mp4', 'https://example.com/video.mp4');
    assert.ok(mp4Class);
    assert.strictEqual(mp4Class.container, 'mp4');
    assert.strictEqual(mp4Class.streamType, 'muxed');
    assert.strictEqual(mp4Class.isVideo, true);

    const mp3Class = classifyMedia('audio/mpeg', 'https://example.com/song.mp3');
    assert.ok(mp3Class);
    assert.strictEqual(mp3Class.container, 'mp3');
    assert.strictEqual(mp3Class.streamType, 'audio');
    assert.strictEqual(mp3Class.isVideo, false);

    const flacClass = classifyMedia('audio/flac', 'https://example.com/track.flac');
    assert.ok(flacClass);
    assert.strictEqual(flacClass.container, 'flac');
    assert.strictEqual(flacClass.streamType, 'audio');

    const webmClass = classifyMedia('video/webm', 'https://example.com/clip.webm');
    assert.ok(webmClass);
    assert.strictEqual(webmClass.container, 'webm');
    assert.strictEqual(webmClass.streamType, 'muxed');
  });

  it('should reject non-media Content-Types (HTML, JSON, Executable)', () => {
    assert.strictEqual(classifyMedia('text/html', 'index.html'), null);
    assert.strictEqual(classifyMedia('application/json', 'data.json'), null);
    assert.strictEqual(classifyMedia('application/octet-stream', 'program.exe'), null);
  });

  it('should parse Content-Disposition filename safely', () => {
    assert.strictEqual(
      parseContentDispositionFilename('attachment; filename="ocean_sunset.mp4"'),
      'ocean_sunset.mp4'
    );
    assert.strictEqual(
      parseContentDispositionFilename("attachment; filename*=UTF-8''mountain_view.webm"),
      'mountain_view.webm'
    );
    assert.strictEqual(parseContentDispositionFilename(null), null);
  });
});

describe('Source Adapters - Rights Declaration Verification', () => {
  it('should evaluate user-owned rights declarations', () => {
    const result = RightsValidator.evaluate(
      'https://cdn.example.com/video.mp4',
      {
        ownershipType: 'user_created_content',
        attestation: true,
        licenseType: 'Direct-Owner',
        notes: 'Self-authored video',
      },
      'direct_media'
    );

    assert.strictEqual(result.isPermitted, true);
    assert.strictEqual(result.canExtractStreams, true);
    assert.strictEqual(result.status, 'permitted');
  });

  it('should reject unconfirmed rights declarations lacking attestation', () => {
    const result = RightsValidator.evaluate(
      'https://cdn.example.com/video.mp4',
      {
        ownershipType: 'user_created_content',
        attestation: false, // User did not attest
      },
      'direct_media'
    );

    assert.strictEqual(result.isPermitted, false);
    assert.strictEqual(result.canExtractStreams, false);
    assert.strictEqual(result.policyCode, 'MISSING_ATTESTATION');
  });

  it('should restrict YouTube rights basis to preview/metadata only', () => {
    const result = RightsValidator.evaluate(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      {
        ownershipType: 'public_domain',
        attestation: true,
      },
      'youtube_permitted'
    );

    assert.strictEqual(result.canExtractStreams, false, 'YouTube can NEVER extract streams');
    assert.strictEqual(result.canPreview, true);
    assert.strictEqual(result.isPermitted, true);
  });
});
