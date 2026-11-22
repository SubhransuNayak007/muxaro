/**
 * Tests for Instagram Source Adapter
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { InstagramAdapter } from '../src/instagram-adapter.ts';

describe('Instagram Adapter Tests', () => {
  const adapter = new InstagramAdapter();

  it('should identify valid Instagram URLs', () => {
    assert(adapter.canHandle('https://www.instagram.com/p/Cx12345Abc/'));
    assert(adapter.canHandle('https://www.instagram.com/reel/Cx12345Abc/'));
    assert(adapter.canHandle('https://www.instagram.com/reels/Cx12345Abc/'));
    assert(adapter.canHandle('https://instagram.com/tv/Cx12345Abc/'));
    assert(!adapter.canHandle('https://www.tiktok.com/@user/video/123'));
    assert(!adapter.canHandle('https://youtube.com/watch?v=123'));
  });

  it('should extract shortcode correctly', () => {
    const code = adapter.extractShortcode('https://www.instagram.com/reel/Cx12345Abc/?utm_source=ig_web_copy_link');
    assert.strictEqual(code, 'Cx12345Abc');
  });

  it('should inspect and resolve manifest from GraphQL Doc ID response', async () => {
    const mockGraphqlResponse = {
      data: {
        xdt_shortcode_media: {
          id: '1234567890',
          caption: 'Beautiful sunset in California',
          owner: { username: 'cali_photographer' },
          video_duration: 25.5,
          display_url: 'https://scontent.cdninstagram.com/thumb.jpg',
          video_versions: [
            { width: 720, height: 1280, url: 'https://scontent.cdninstagram.com/720p.mp4' },
            { width: 1080, height: 1920, url: 'https://scontent.cdninstagram.com/1080p.mp4' },
            { width: 480, height: 854, url: 'https://scontent.cdninstagram.com/480p.mp4' },
          ],
        },
      },
    };

    const customAdapter = new InstagramAdapter({
      customFetch: async () => new Response(JSON.stringify(mockGraphqlResponse), { status: 200 }),
    });

    const manifest = await customAdapter.inspect('https://www.instagram.com/reel/Cx12345Abc/');
    assert.strictEqual(manifest.sourceType, 'instagram');
    assert.strictEqual(manifest.title, 'Beautiful sunset in California');
    assert.strictEqual(manifest.author, '@cali_photographer');
    assert.strictEqual(manifest.durationSeconds, 25.5);
    assert.strictEqual(manifest.thumbnailUrl, 'https://scontent.cdninstagram.com/thumb.jpg');
    assert.strictEqual(manifest.streams.length, 1);
    // Highest resolution selected (1080p)
    assert.strictEqual(manifest.streams[0].directUrl, 'https://scontent.cdninstagram.com/1080p.mp4');
    assert.strictEqual(manifest.streams[0].height, 1920);
  });

  it('should enforce user rights attestation', async () => {
    const resultNoAttestation = await adapter.checkRights('https://www.instagram.com/reel/Cx12345Abc/');
    assert.strictEqual(resultNoAttestation.status, 'requires_authorization');
    assert.strictEqual(resultNoAttestation.policyCode, 'MISSING_ATTESTATION');

    const resultWithAttestation = await adapter.checkRights(
      'https://www.instagram.com/reel/Cx12345Abc/',
      {
        ownershipType: 'licensed_permission',
        attestation: true,
      }
    );
    assert.strictEqual(resultWithAttestation.status, 'permitted');
    assert.strictEqual(resultWithAttestation.isPermitted, true);
  });
});
