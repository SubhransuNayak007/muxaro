/**
 * Tests for Innertube Multi-Client Fallback Matrix
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  InnertubeClientMatrix,
  INNERTUBE_CLIENT_PROFILES,
  computeSapisidHash,
  buildPlayerRequestBody,
  buildPlayerRequestHeaders,
} from '../src/innertube-client-matrix.ts';

describe('Innertube Client Matrix Tests', () => {
  it('should declare all five required client profiles', () => {
    const profileNames = INNERTUBE_CLIENT_PROFILES.map((p) => p.name);
    assert(profileNames.includes('TVHTML5_SIMPLY_EMBEDDED'));
    assert(profileNames.includes('IOS'));
    assert(profileNames.includes('ANDROID'));
    assert(profileNames.includes('WEB'));
    assert(profileNames.includes('WEB_EMBEDDED'));
  });

  it('should verify TVHTML5_SIMPLY_EMBEDDED has SABR disabled and no PoToken required', () => {
    const tv = INNERTUBE_CLIENT_PROFILES.find((p) => p.name === 'TVHTML5_SIMPLY_EMBEDDED');
    assert(tv);
    assert.strictEqual(tv.clientNameId, '85');
    assert.strictEqual(tv.supportsSabr, false);
    assert.strictEqual(tv.requiresPoToken, false);
  });

  it('should compute valid SAPISIDHASH', () => {
    const sapisid = 'test_sapisid_secret_123';
    const origin = 'https://www.youtube.com';
    const ts = 1732089600;
    const hash = computeSapisidHash(sapisid, origin, ts);
    assert(hash.startsWith('SAPISIDHASH 1732089600_'));
    const parts = hash.split('_');
    assert.strictEqual(parts[1].length, 40); // 40-char SHA1 hex
  });

  it('should build complete player request body with visitorData and poToken', () => {
    const web = INNERTUBE_CLIENT_PROFILES.find((p) => p.name === 'WEB')!;
    const body = buildPlayerRequestBody(web, {
      videoId: 'dQw4w9WgXcQ',
      visitorData: 'Cgt2S1V6b3...',
      poToken: 'MnBsMDk4ZGFz...',
    });

    assert.strictEqual(body.videoId, 'dQw4w9WgXcQ');
    const ctx = body.context as Record<string, unknown>;
    const client = ctx.client as Record<string, unknown>;
    assert.strictEqual(client.visitorData, 'Cgt2S1V6b3...');
    const playback = body.playbackContext as Record<string, unknown>;
    const serviceIntegrity = playback.serviceIntegrityDimensions as Record<string, unknown>;
    assert.strictEqual(serviceIntegrity.poToken, 'MnBsMDk4ZGFz...');
  });

  it('should execute multi-client fallback successfully', async () => {
    // Mock fetch that fails TV client with LOGIN_REQUIRED but succeeds on IOS
    const mockFetch: typeof fetch = async (input, init) => {
      const body = JSON.parse((init?.body as string) || '{}');
      const clientName = body?.context?.client?.clientName;

      if (clientName === 'TVHTML5_SIMPLY_EMBEDDED') {
        return new Response(
          JSON.stringify({
            playabilityStatus: {
              status: 'LOGIN_REQUIRED',
              reason: 'This video is private or restricted.',
            },
          }),
          { status: 200 }
        );
      }

      if (clientName === 'IOS') {
        return new Response(
          JSON.stringify({
            playabilityStatus: { status: 'OK' },
            streamingData: {
              adaptiveFormats: [
                {
                  itag: 18,
                  url: 'https://rr1---sn-test.googlevideo.com/videoplayback?id=123',
                },
              ],
            },
            videoDetails: {
              videoId: 'dQw4w9WgXcQ',
              title: 'Mock Video Title',
              author: 'Mock Author',
              lengthSeconds: '212',
            },
          }),
          { status: 200 }
        );
      }

      return new Response('{}', { status: 500 });
    };

    const matrix = new InnertubeClientMatrix(INNERTUBE_CLIENT_PROFILES, mockFetch);
    const result = await matrix.executeWithFallback({
      videoId: 'dQw4w9WgXcQ',
    });

    assert.strictEqual(result.profile.name, 'IOS');
    assert.strictEqual(result.playabilityStatus?.status, 'OK');
    assert(result.streamingData?.adaptiveFormats?.length === 1);
  });
});
