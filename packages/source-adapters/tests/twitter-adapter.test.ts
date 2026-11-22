/**
 * Tests for Twitter / X Source Adapter
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TwitterAdapter } from '../src/twitter-adapter.ts';

describe('Twitter / X Adapter Tests', () => {
  const adapter = new TwitterAdapter();

  it('should identify valid Twitter and X URLs', () => {
    assert(adapter.canHandle('https://twitter.com/jack/status/20'));
    assert(adapter.canHandle('https://x.com/OpenAI/status/1859000000000000000'));
    assert(!adapter.canHandle('https://www.tiktok.com/@user/video/123'));
    assert(!adapter.canHandle('https://youtube.com/watch?v=123'));
  });

  it('should extract Tweet ID correctly', () => {
    const id = adapter.extractTweetId('https://x.com/OpenAI/status/1859000000000000000?s=20');
    assert.strictEqual(id, '1859000000000000000');
  });

  it('should inspect and resolve manifest from Tweet GraphQL response with bitrate sorting', async () => {
    const mockGraphQLResponse = {
      data: {
        tweetResult: {
          result: {
            legacy: {
              full_text: 'Introducing our new breakthrough AI model!',
              extended_entities: {
                media: [
                  {
                    media_url_https: 'https://pbs.twimg.com/media/preview.jpg',
                    video_info: {
                      duration_millis: 60000,
                      variants: [
                        { content_type: 'application/x-mpegURL', url: 'https://twimg.com/playlist.m3u8' },
                        { bitrate: 832000, content_type: 'video/mp4', url: 'https://twimg.com/720p.mp4' },
                        { bitrate: 2176000, content_type: 'video/mp4', url: 'https://twimg.com/1080p.mp4' },
                        { bitrate: 256000, content_type: 'video/mp4', url: 'https://twimg.com/360p.mp4' },
                      ],
                    },
                  },
                ],
              },
            },
            core: {
              user_results: {
                result: {
                  legacy: {
                    screen_name: 'OpenAI',
                  },
                },
              },
            },
          },
        },
      },
    };

    const customAdapter = new TwitterAdapter({
      customFetch: async (url) => {
        if (typeof url === 'string' && url.includes('guest/activate.json')) {
          return new Response(JSON.stringify({ guest_token: '1234567890' }), { status: 200 });
        }
        return new Response(JSON.stringify(mockGraphQLResponse), { status: 200 });
      },
    });

    const manifest = await customAdapter.inspect('https://x.com/OpenAI/status/1859000000000000000');
    assert.strictEqual(manifest.sourceType, 'twitter');
    assert.strictEqual(manifest.title, 'Introducing our new breakthrough AI model!');
    assert.strictEqual(manifest.author, '@OpenAI');
    assert.strictEqual(manifest.durationSeconds, 60);
    assert.strictEqual(manifest.thumbnailUrl, 'https://pbs.twimg.com/media/preview.jpg');
    assert.strictEqual(manifest.streams.length, 3);
    // Highest bitrate first
    assert.strictEqual(manifest.streams[0].directUrl, 'https://twimg.com/1080p.mp4');
    assert.strictEqual(manifest.streams[0].bitrateBps, 2176000);
    assert.strictEqual(manifest.streams[0].resolutionLabel, '1080p');
  });

  it('should enforce user rights attestation', async () => {
    const resultNoAttestation = await adapter.checkRights('https://x.com/OpenAI/status/1859000000000000000');
    assert.strictEqual(resultNoAttestation.status, 'requires_authorization');
    assert.strictEqual(resultNoAttestation.policyCode, 'MISSING_ATTESTATION');

    const resultWithAttestation = await adapter.checkRights(
      'https://x.com/OpenAI/status/1859000000000000000',
      {
        ownershipType: 'public_domain',
        attestation: true,
      }
    );
    assert.strictEqual(resultWithAttestation.status, 'permitted');
    assert.strictEqual(resultWithAttestation.isPermitted, true);
  });
});
