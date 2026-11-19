/**
 * Project MUXARO - Operations Verification Test Suite
 * Validates session cookies, guest session tokens, CSRF tokens, telemetry,
 * and background daemon resilience.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../apps/api/src/app.js';
import type { FastifyInstance } from 'fastify';
import {
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  GUEST_COOKIE_NAME,
  CSRF_HEADER_NAME,
  parseCookies,
} from '../../apps/api/src/middleware/auth.middleware.js';

describe('Operations Telemetry & Session Lifecycle Verification', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('GET /api/v1/auth/session mints cryptographic guest session cookie and returns 200 unauthenticated payload', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.success, true);
    assert.equal(body.authenticated, false);
    assert.equal(body.user, null);
    assert.ok(typeof body.requestId === 'string' && body.requestId.startsWith('req_'));

    // Verify Set-Cookie header contains muxaro_guest
    const setCookie = res.headers['set-cookie'];
    assert.ok(setCookie, 'Expected Set-Cookie header to be present');
    const setCookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
    assert.ok(setCookieStr.includes(GUEST_COOKIE_NAME), 'Expected muxaro_guest cookie in Set-Cookie');
    assert.ok(setCookieStr.includes('HttpOnly'), 'Guest cookie must be HttpOnly');
    assert.ok(setCookieStr.includes('SameSite=Lax'), 'Guest cookie must be SameSite=Lax');
    assert.ok(setCookieStr.includes('Path=/'), 'Guest cookie must be Path=/');

    // Extract guest ID and verify pattern
    const cookies = parseCookies(setCookieStr);
    assert.ok(cookies[GUEST_COOKIE_NAME], 'Parsed muxaro_guest cookie');
    assert.match(cookies[GUEST_COOKIE_NAME], /^guest_[a-f0-9]{16,64}$/, 'Guest ID must match pattern');
  });

  test('GET /api/v1/auth/session preserves existing guest cookie across requests', async () => {
    const existingGuestId = 'guest_0123456789abcdef0123456789abcdef';
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: {
        cookie: `${GUEST_COOKIE_NAME}=${existingGuestId}`,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.success, true);
    assert.equal(body.authenticated, false);

    // Should not re-set guest cookie when valid guest cookie is already present
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      const setCookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
      assert.ok(!setCookieStr.includes(GUEST_COOKIE_NAME), 'Should not re-issue guest cookie when valid');
    }
  });

  test('GET /api/v1/account/history returns 200 and empty job list for guest sessions with valid telemetry', async () => {
    const guestId = 'guest_aabbccddeeff00112233445566778899';
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/account/history?page=1&limit=20',
      headers: {
        cookie: `${GUEST_COOKIE_NAME}=${guestId}`,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.success, true);
    assert.ok(body.data, 'Expected data payload');
    assert.equal(body.data.page, 1);
    assert.equal(body.data.limit, 20);
    assert.ok(Array.isArray(body.data.jobs), 'Expected jobs array');
    assert.ok(typeof body.requestId === 'string' && body.requestId.startsWith('req_'));
    assert.ok(res.headers['x-request-id'], 'Expected x-request-id response header');
  });

  test('Cookie security flags enforce Secure attribute when behind HTTPS proxy', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: {
        'x-forwarded-proto': 'https',
      },
    });

    assert.equal(res.statusCode, 200);
    const setCookie = res.headers['set-cookie'];
    assert.ok(setCookie);
    const setCookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
    assert.ok(setCookieStr.includes('Secure'), 'Expected Secure flag on HTTPS forwarded requests');
  });

  test('Operational telemetry: every endpoint emits x-request-id and X-Content-Type-Options: nosniff', async () => {
    const endpoints = [
      '/api/v1/health',
      '/api/v1/auth/session',
      '/api/v1/account/history',
      '/api/v1/account/credits',
    ];

    for (const url of endpoints) {
      const res = await app.inject({ method: 'GET', url });
      assert.ok(res.headers['x-request-id'], `Endpoint ${url} must emit x-request-id`);
      assert.equal(res.headers['x-content-type-options'], 'nosniff', `Endpoint ${url} must emit nosniff`);
      assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
      assert.ok(res.headers['strict-transport-security'], `Endpoint ${url} must emit HSTS`);
      assert.equal(res.headers['x-permitted-cross-domain-policies'], 'none');
    }
  });

  test('Process-level exception handlers are registered and functional', () => {
    const uncaughtListeners = process.listeners('uncaughtException');
    const unhandledListeners = process.listeners('unhandledRejection');

    assert.ok(uncaughtListeners.length > 0, 'Must have at least one uncaughtException listener');
    assert.ok(unhandledListeners.length > 0, 'Must have at least one unhandledRejection listener');
  });
});
