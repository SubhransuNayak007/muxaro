/**
 * Tests for TikTok Source Adapter
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TikTokAdapter } from '../src/tiktok-adapter.ts';

describe('TikTok Adapter Tests', () => {
  const adapter = new TikTokAdapter();

  it('should identify valid TikTok URLs', () => {
    assert(adapter.canHandle('https://www.tiktok.com/@creator/video/7123456789012345678'));
    assert(adapter.canHandle('https://vm.tiktok.com/ZM1234567/'));
    assert(adapter.canHandle('https://vt.tiktok.com/ZS1234567/'));
    assert(adapter.canHandle('https://www.tiktok.com/t/ZT1234567/'));
    assert(!adapter.canHandle('https://www.youtube.com/watch?v=123'));
    assert(!adapter.canHandle('https://instagram.com/reel/123'));
  });

  it('should extract video ID correctly', () => {
    const id = adapter.extractVideoIdOrPath(
      'https://www.tiktok.com/@creator/video/7123456789012345678'
    );
    assert.strictEqual(id, '7123456789012345678');
  });

  it('should strip watermarking from CDN URLs', () => {
    const watermarked =
      'https://v16-webapp-prime.tiktok.com/video/tos/useast2a/tos-useast2a-ve-0068c001/playwm/?a=123';
    const clean = TikTokAdapter.removeWatermarkFromCdnUrl(watermarked);
    assert(clean.includes('/play/'));
    assert(!clean.includes('/playwm/'));
  });

  it('should inspect and resolve manifest from SSR HTML with play_addr', async () => {
    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">
            {
              "__DEFAULT_SCOPE__": {
                "webapp.videoDetail": {
                  "itemInfo": {
                    "itemStruct": {
                      "id": "7123456789012345678",
                      "desc": "Viral Dance Trend #dance",
                      "author": { "nickname": "SuperStar", "uniqueId": "superstar" },
                      "video": {
                        "duration": 18,
                        "cover": "https://p16-sign.tiktokcdn.com/tos-useast2a-pve/cover.jpg",
                        "playAddr": "https://v16-webapp-prime.tiktok.com/video/tos/playwm/stream.mp4"
                      }
                    }
                  }
                }
              }
            }
          </script>
        </head>
        <body></body>
      </html>
    `;

    const customAdapter = new TikTokAdapter({
      customFetch: async () => new Response(mockHtml, { status: 200 }),
    });

    const manifest = await customAdapter.inspect(
      'https://www.tiktok.com/@superstar/video/7123456789012345678'
    );

    assert.strictEqual(manifest.sourceType, 'tiktok');
    assert.strictEqual(manifest.title, 'Viral Dance Trend #dance');
    assert.strictEqual(manifest.author, 'SuperStar');
    assert.strictEqual(manifest.durationSeconds, 18);
    assert(manifest.streams.length > 0);
    // Watermark removed
    assert(!manifest.streams[0].directUrl?.includes('/playwm/'));
    assert(manifest.streams[0].directUrl?.includes('/play/'));
    assert.strictEqual(manifest.streams[0].headers?.Referer, 'https://www.tiktok.com/');
  });

  it('should enforce user rights attestation', async () => {
    const resultNoAttestation = await adapter.checkRights(
      'https://www.tiktok.com/@user/video/7123456789012345678'
    );
    assert.strictEqual(resultNoAttestation.status, 'requires_authorization');
    assert.strictEqual(resultNoAttestation.policyCode, 'MISSING_ATTESTATION');

    const resultWithAttestation = await adapter.checkRights(
      'https://www.tiktok.com/@user/video/7123456789012345678',
      {
        ownershipType: 'user_created_content',
        attestation: true,
      }
    );
    assert.strictEqual(resultWithAttestation.status, 'permitted');
    assert.strictEqual(resultWithAttestation.isPermitted, true);
  });
});
