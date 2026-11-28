import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { resolveRouteGroup } from '../src/plugins/rate-limiter.js';

let server: FastifyInstance;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.RATE_LIMIT_ENABLED = 'false';
  server = await buildServer({ logLevel: 'silent' });
});

after(async () => {
  await server.close();
});

test('Rate limiter classifies part uploads separately from upload init', () => {
  assert.equal(resolveRouteGroup('/api/v1/uploads/init', 'POST'), 'uploads_init');
  assert.equal(resolveRouteGroup('/api/v1/media/upload/init', 'POST'), 'uploads_init');
  assert.equal(resolveRouteGroup('/api/v1/uploads/abc/part/1', 'PUT'), 'uploads_part');
  assert.equal(resolveRouteGroup('/api/v1/uploads/abc/parts', 'POST'), 'uploads_part');
  assert.equal(resolveRouteGroup('/api/v1/media/upload/abc/part/4', 'PUT'), 'uploads_part');
});

test('Production server.ts mounts /api/v1/ai routes and blocks SSRF', async () => {
  const jobsRes = await server.inject({ method: 'GET', url: '/api/v1/ai/research-jobs' });
  assert.equal(jobsRes.statusCode, 200);
  const fetchRes = await server.inject({
    method: 'POST',
    url: '/api/v1/ai/fetch',
    payload: { url: 'http://127.0.0.1:4000/secret' },
  });
  assert.equal(fetchRes.statusCode, 400);
});

test('Upload session honors x-muxaro-public-origin and signed part capability across IP changes', async () => {
  const guestCookie = 'muxaro_guest=guest_0123456789abcdef0123456789abcdef';
  const initRes = await server.inject({
    method: 'POST',
    url: '/api/v1/uploads/init',
    headers: {
      cookie: guestCookie,
      'x-forwarded-for': '203.0.113.10',
      'x-muxaro-public-origin': 'https://muxaro.vercel.app',
    },
    payload: {
      filename: 'clip.mp4',
      sizeBytes: 12,
      mimeType: 'video/mp4',
      tool: 'convert_video',
    },
  });
  assert.equal(initRes.statusCode, 201);
  const { uploadSessionId } = initRes.json();

  // Simulated IPv6 reconnect with matching muxaro_guest cookie
  const partsRes = await server.inject({
    method: 'POST',
    url: `/api/v1/uploads/${uploadSessionId}/parts`,
    headers: {
      cookie: guestCookie,
      'x-forwarded-for': '2001:db8::1',
      'x-muxaro-public-origin': 'https://muxaro.vercel.app',
    },
    payload: { partNumbers: [1] },
  });
  assert.equal(partsRes.statusCode, 200);
  const presignedUrl: string = partsRes.json().data.parts[0].presignedUrl;
  assert.ok(presignedUrl.startsWith('https://muxaro.vercel.app/api/v1/uploads/'));
  assert.ok(presignedUrl.includes('token='));

  // Simulated direct chunk PUT from different IP with signed token and without cookie
  const parsed = new URL(presignedUrl);
  const putRes = await server.inject({
    method: 'PUT',
    url: `${parsed.pathname}${parsed.search}`,
    headers: {
      'x-forwarded-for': '198.51.100.77',
      'content-type': 'application/octet-stream',
    },
    payload: Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]),
  });
  assert.equal(putRes.statusCode, 200);
  assert.ok(putRes.headers.etag);

  const abortRes = await server.inject({
    method: 'DELETE',
    url: `/api/v1/uploads/${uploadSessionId}/abort`,
    headers: { cookie: guestCookie },
  });
  assert.equal(abortRes.statusCode, 200);
});
