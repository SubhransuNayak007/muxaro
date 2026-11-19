/**
 * MUXARO Web Client Resilience & Edge/Guest Mode Test Suite
 * Test File: tests/unit/api-client-edge-mode.test.ts
 *
 * Verifies:
 * 1. getApiBaseUrl() NEVER returns unresolvable or dead hosts like api.muxaro.app
 * 2. In browser environments, same-origin '/api/v1' is always returned by default
 * 3. Graceful degradation: getSession, getHistory, getQuota, getEntitlementsUsage,
 *    getCreditLedger, getMySessions, and getSystemMetrics never crash in Edge/guest mode
 * 4. Circuit breaker error classification and DNS failure tripping
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  getApiBaseUrl,
  isDeadOrUnresolvableHost,
  api,
  circuitBreaker,
} from '../../apps/web/lib/api-client.ts';

describe('MUXARO API Client — getApiBaseUrl & Dead Host Elimination', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    circuitBreaker.reset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    delete (globalThis as any).window;
  });

  it('correctly identifies dead or unresolvable hosts', () => {
    assert.strictEqual(isDeadOrUnresolvableHost('https://api.muxaro.app'), true);
    assert.strictEqual(isDeadOrUnresolvableHost('http://api.muxaro.app/api/v1'), true);
    assert.strictEqual(isDeadOrUnresolvableHost('https://muxaro-api.internal'), true);
    assert.strictEqual(isDeadOrUnresolvableHost(''), true);
    assert.strictEqual(isDeadOrUnresolvableHost(null as any), true);

    // Valid hosts are permitted
    assert.strictEqual(isDeadOrUnresolvableHost('http://localhost:4000'), false);
    assert.strictEqual(isDeadOrUnresolvableHost('http://127.0.0.1:4000'), false);
    assert.strictEqual(isDeadOrUnresolvableHost('/api/v1'), false);
  });

  it('never returns api.muxaro.app even when NEXT_PUBLIC_API_URL is set to it', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.muxaro.app';
    delete process.env.API_INTERNAL_URL;
    delete (globalThis as any).window;

    const base = getApiBaseUrl();
    assert.notStrictEqual(base, 'https://api.muxaro.app');
    assert.notStrictEqual(base, 'https://api.muxaro.app/api/v1');
    assert.strictEqual(base, '/api/v1');
  });

  it('in browser environment, always defaults to same-origin /api/v1', () => {
    // Simulate browser window
    (globalThis as any).window = {};
    process.env.NEXT_PUBLIC_API_URL = 'https://api.muxaro.app';

    const base = getApiBaseUrl();
    assert.strictEqual(base, '/api/v1');
  });

  it('in browser environment, verified custom URL is used only if not a dead host', () => {
    (globalThis as any).window = {
      __MUXARO_VERIFIED_API_URL__: 'https://api.muxaro.app', // dead host
    };
    assert.strictEqual(getApiBaseUrl(), '/api/v1', 'Should reject dead host in window config');

    (globalThis as any).window = {
      __MUXARO_VERIFIED_API_URL__: 'https://custom-gateway.internal.net', // valid custom
    };
    assert.strictEqual(getApiBaseUrl(), 'https://custom-gateway.internal.net/api/v1');
  });

  it('in server environment, resolves valid internal API URL', () => {
    delete (globalThis as any).window;
    process.env.API_INTERNAL_URL = 'http://127.0.0.1:4000';
    process.env.NEXT_PUBLIC_API_URL = 'https://api.muxaro.app';

    const base = getApiBaseUrl();
    assert.strictEqual(base, 'http://127.0.0.1:4000/api/v1');
  });
});

describe('MUXARO API Client — Graceful Degradation in Edge/Guest/Offline Mode', () => {
  beforeEach(() => {
    circuitBreaker.reset();
  });

  it('getSession() returns honest unauthenticated guest session on failure without throwing', async () => {
    circuitBreaker.trip('Simulated unresolvable endpoint');

    const session = await api.getSession();
    assert.ok(session);
    assert.strictEqual(session.authenticated, false);
    assert.strictEqual(session.user, null);
    assert.strictEqual(session.googleAuthConfigured, false);
    assert.strictEqual(session.mfaRequired, false);
  });

  it('getHistory() and listJobs() return empty list without throwing when offline or degraded', async () => {
    circuitBreaker.trip('Simulated offline mode');

    const history = await api.getHistory();
    assert.ok(Array.isArray(history));
    assert.strictEqual(history.length, 0);

    const jobs = await api.listJobs();
    assert.ok(Array.isArray(jobs));
    assert.strictEqual(jobs.length, 0);
  });

  it('getQuota() returns standard 10-video guest allowance without throwing', async () => {
    circuitBreaker.trip('Simulated DNS failure');

    const quota = await api.getQuota();
    assert.ok(quota);
    assert.strictEqual(quota.individualVideosLimit, 10);
    assert.strictEqual(quota.individualVideosRemaining, 10);
    assert.strictEqual(quota.baseLimit, 10);
    assert.strictEqual(quota.baseRemaining, 10);
    assert.strictEqual(quota.tier, 'guest');
  });

  it('getEntitlementsUsage() returns standard guest entitlements without throwing', async () => {
    circuitBreaker.trip('Simulated Edge guest mode');

    const usage = await api.getEntitlementsUsage();
    assert.ok(usage);
    assert.strictEqual(usage.tier, 'guest');
    assert.strictEqual(usage.individualVideosLimit, 10);
    assert.strictEqual(usage.individualVideosRemaining, 10);
    assert.strictEqual(usage.playlistJobsLimit, 0);
  });

  it('getCreditLedger() and getMySessions() return safe empty arrays without throwing', async () => {
    circuitBreaker.trip('Simulated network disconnect');

    const ledger = await api.getCreditLedger();
    assert.ok(Array.isArray(ledger));
    assert.strictEqual(ledger.length, 0);

    const sessions = await api.getMySessions();
    assert.ok(Array.isArray(sessions));
    assert.strictEqual(sessions.length, 0);
  });

  it('getRewardConfig() returns disabled safe state without throwing', async () => {
    circuitBreaker.trip('Simulated offline');

    const rewards = await api.getRewardConfig();
    assert.ok(rewards);
    assert.strictEqual(rewards.enabled, false);
    assert.strictEqual(rewards.configured, false);
  });

  it('getSystemMetrics() returns realistic baseline queue info without throwing in degraded mode', async () => {
    circuitBreaker.trip('Simulated Edge mode');

    const metrics = await api.getSystemMetrics();
    assert.ok(metrics);
    assert.strictEqual(metrics.status, 'DEGRADED');
    assert.ok(metrics.queueClasses, 'Queue classes should be populated');
    assert.ok((metrics.queueClasses as any).instant, 'Instant queue should be visible');
  });
});

describe('Circuit Breaker — Error Classification & Immediate DNS Trip', () => {
  beforeEach(() => {
    circuitBreaker.reset();
  });

  it('classifies net::ERR_NAME_NOT_RESOLVED as a DNS failure and trips immediately', () => {
    const error = new Error('net::ERR_NAME_NOT_RESOLVED at api.muxaro.app/api/v1/auth/session');
    const classified = circuitBreaker.classifyError(error);

    assert.strictEqual(classified.isDnsFailure, true);
    assert.strictEqual(classified.isNetworkError, true);
    assert.ok(classified.actionableFeedback.includes('DNS'));
    assert.ok(classified.userAdvice.includes('Edge/fallback mode'));

    // Record failure - should trip immediately on DNS failure
    circuitBreaker.recordFailure(error, classified.isDnsFailure);
    assert.strictEqual(circuitBreaker.getStatus().state, 'OPEN');
    assert.strictEqual(circuitBreaker.canAttemptRequest(), false);
  });

  it('classifies timeouts and provides calm actionable feedback with retry advice', () => {
    const error = new Error('The operation timed out');
    const classified = circuitBreaker.classifyError(error);

    assert.strictEqual(classified.isTimeout, true);
    assert.strictEqual(classified.canRetry, true);
    assert.ok(classified.actionableFeedback.includes('timed out'));
    assert.ok(classified.userAdvice.includes('Retry'));
  });
});
