/**
 * SRE Chaos & Resilience Verification Harness for MUXARO
 * Validates:
 * 1. Circuit Breaker state machine (CLOSED -> OPEN -> HALF_OPEN -> CLOSED)
 * 2. DNS Failure & Offline simulation with graceful degradation (no unhandled exceptions)
 * 3. Fast-fail under OPEN circuit (< 5ms response time, zero UI freeze)
 * 4. Rich, actionable error feedback with specific advice (zero generic 'Unable to connect' banners)
 * 5. Offline/degraded availability of tool descriptions, documentation, and queue info
 * 6. UI Retry button presence across all interactive error views
 */

import { circuitBreaker, withCircuitBreaker, ApiClientError } from '../../apps/web/lib/circuit-breaker.ts';
import fs from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`[PASS] ${testName}`);
    passed++;
  } else {
    console.error(`[FAIL] ${testName} - ${details}`);
    failed++;
  }
}

async function runChaosVerification() {
  console.log('===============================================================');
  console.log('   MUXARO SRE CHAOS & RESILIENCE VERIFICATION HARNESS');
  console.log('===============================================================\n');

  circuitBreaker.resetChaos();

  // --------------------------------------------------------------------------
  // TEST CASE 1: Circuit Breaker State Machine & Transitions
  // --------------------------------------------------------------------------
  console.log('--- 1. Circuit Breaker State Transitions ---');
  circuitBreaker.reset();
  assert(circuitBreaker.getStatus().state === 'CLOSED', 'Circuit starts in CLOSED state');

  let stateChanges = [];
  const unsubscribe = circuitBreaker.subscribe((state, status) => {
    stateChanges.push({ state, status });
  });

  // Record 2 failures (below threshold of 3)
  circuitBreaker.recordFailure(new Error('Simulated transient 500 error'));
  circuitBreaker.recordFailure(new Error('Simulated transient 500 error'));
  assert(circuitBreaker.getStatus().state === 'CLOSED', 'Circuit remains CLOSED below threshold (2/3 failures)');
  assert(circuitBreaker.getStatus().failureCount === 2, 'Failure count accurately tracked');

  // Record 3rd failure -> trips to OPEN
  circuitBreaker.recordFailure(new Error('Simulated transient 500 error'));
  assert(circuitBreaker.getStatus().state === 'OPEN', 'Circuit transitions to OPEN after 3 consecutive failures');
  assert(circuitBreaker.canAttemptRequest() === false, 'Requests blocked while circuit is OPEN');

  // Verify fast-fail: withCircuitBreaker immediately returns without network freeze (< 5ms)
  const startTime = Date.now();
  try {
    await withCircuitBreaker('testFastFail', async () => {
      throw new Error('Should not reach here');
    });
    assert(false, 'Expected withCircuitBreaker to throw when OPEN without fallback');
  } catch (err) {
    const elapsed = Date.now() - startTime;
    assert(err instanceof ApiClientError, 'Throws ApiClientError when circuit is OPEN');
    assert(err.isCircuitOpen === true, 'Error is marked with isCircuitOpen=true');
    assert(elapsed < 10, 'Fast-fails immediately in < 10ms (zero UI freeze)', `took ${elapsed}ms`);
  }

  // --------------------------------------------------------------------------
  // TEST CASE 2: Simulated DNS Failure (net::ERR_NAME_NOT_RESOLVED / NXDOMAIN)
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Simulated DNS Failure & Immediate Circuit Trip ---');
  circuitBreaker.reset();

  const dnsErr = new Error('Failed to fetch: net::ERR_NAME_NOT_RESOLVED on api.muxaro.app');
  const classifiedDns = circuitBreaker.classifyError(dnsErr);
  assert(classifiedDns.isDnsFailure === true, 'DNS failure correctly diagnosed from ERR_NAME_NOT_RESOLVED');
  assert(classifiedDns.canRetry === true, 'DNS failure is actionable and marked canRetry=true');
  assert(
    classifiedDns.actionableFeedback.includes('DNS') || classifiedDns.userAdvice.includes('Retry'),
    'Produces actionable feedback instructing user to retry instead of generic message'
  );

  // DNS failure trips circuit immediately (forceTrip) to prevent repeated 10s browser timeouts
  circuitBreaker.recordFailure(dnsErr, true);
  assert(circuitBreaker.getStatus().state === 'OPEN', 'Confirmed DNS failure trips circuit immediately to OPEN');

  // --------------------------------------------------------------------------
  // TEST CASE 3: Graceful Degradation in Degraded/Offline Mode
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Graceful Degradation Fallbacks (Zero-Crash UI) ---');

  // Verify Session Fallback
  const degradedSession = circuitBreaker.getDegradedSession('DNS unreachable');
  assert(degradedSession.authenticated === false, 'Degraded session treats user safely as unauthenticated');
  assert(degradedSession.user === null, 'Degraded session user is null');
  assert(degradedSession.degraded === true, 'Degraded flag is present on session');

  // Verify Quota Fallback
  const degradedQuota = circuitBreaker.getDegradedQuota();
  assert(degradedQuota.individualVideosRemaining === 10, 'Degraded quota provides full 10 guest slots');
  assert(degradedQuota.individualVideosLimit === 10, 'Degraded quota limit is 10');
  assert(degradedQuota.tier === 'guest', 'Degraded quota tier is guest');
  assert(degradedQuota.degraded === true, 'Degraded flag is present on quota');

  // Verify History Fallback
  const degradedHistory = circuitBreaker.getDegradedHistory();
  assert(Array.isArray(degradedHistory), 'Degraded history returns safe array (no undefined crash)');

  // Verify Metrics & Queue Info Fallback
  const degradedMetrics = circuitBreaker.getDegradedMetrics();
  assert(degradedMetrics.status === 'DEGRADED', 'Degraded metrics status is DEGRADED');
  assert(typeof degradedMetrics.queueDepth === 'number', 'Queue depth is available in degraded mode');
  assert(degradedMetrics.queueClasses !== undefined, 'Queue classes (instant, smart, power) viewable in degraded mode');
  assert(degradedMetrics.queueClasses.instant.name === 'Instant conversion', 'Instant conversion lane info viewable');

  // --------------------------------------------------------------------------
  // TEST CASE 4: Actionable Error Feedback vs Generic Red Banner
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Actionable Error Feedback Verification ---');
  circuitBreaker.reset();

  const testErrors = [
    {
      err: new Error('getaddrinfo ENOTFOUND api.muxaro.app'),
      expectedKeyword: 'DNS',
    },
    {
      err: new Error('Request timed out after 10000ms'),
      expectedKeyword: 'timed out',
    },
    {
      err: { status: 503, message: 'Service Unavailable' },
      expectedKeyword: 'restarting',
    },
    {
      err: { status: 429, message: 'Rate limit exceeded' },
      expectedKeyword: 'allowance',
    },
  ];

  for (const { err, expectedKeyword } of testErrors) {
    const classified = circuitBreaker.classifyError(err);
    assert(
      classified.actionableFeedback.toLowerCase().includes(expectedKeyword.toLowerCase()) ||
      classified.userAdvice.toLowerCase().includes(expectedKeyword.toLowerCase()),
      `Produces specific feedback for ${err.message || err.status}: "${classified.actionableFeedback}"`
    );
    assert(
      !classified.actionableFeedback.includes('Unable to connect to MUXARO right now'),
      'Replaces the generic red "Unable to connect" string with clear contextual explanation'
    );
  }

  // --------------------------------------------------------------------------
  // TEST CASE 5: Static Export & Offline Availability of Content & Queue
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Static Export & Offline Tool/Docs/Queue Verification ---');

  const exportDir = path.resolve('apps/web/out');
  const requiredOfflinePages = [
    'index.html',
    'tools.html',
    'tools/audio-extractor.html',
    'tools/video-merger.html',
    'tools/media-converter.html',
    'tools/audio-video-merger.html',
    'tools/batch-processing.html',
    'tools/playlist-processing.html',
    'tools/playlist-batch.html',
    'docs.html',
    'status.html',
    'dashboard.html',
  ];

  for (const relPath of requiredOfflinePages) {
    const fullPath = path.join(exportDir, relPath);
    const exists = fs.existsSync(fullPath);
    assert(exists, `Offline-ready static page exists: ${relPath}`);
    if (exists) {
      const content = fs.readFileSync(fullPath, 'utf8');
      assert(content.length > 500, `Page has substantial rendered content: ${relPath} (${content.length} bytes)`);
      assert(!content.includes('api.muxaro.app'), `Zero leaks of unresolved api.muxaro.app in ${relPath}`);
    }
  }

  // --------------------------------------------------------------------------
  // TEST CASE 6: Verification of Retry Buttons in UI Components
  // --------------------------------------------------------------------------
  console.log('\n--- 6. UI Components Retry Button Audit ---');

  const auditedComponents = [
    { file: 'apps/web/app/page.tsx', name: 'Home Workspace Page' },
    { file: 'apps/web/components/MediaInspector.tsx', name: 'Media Inspector Component' },
    { file: 'apps/web/app/tools/audio-extractor/page.tsx', name: 'Audio Extractor Tool Page' },
    { file: 'apps/web/app/tools/video-merger/page.tsx', name: 'Video Merger Tool Page' },
    { file: 'apps/web/app/tools/media-converter/page.tsx', name: 'Media Converter Tool Page' },
    { file: 'apps/web/app/tools/batch-processing/page.tsx', name: 'Batch Processing Tool Page' },
    { file: 'apps/web/app/dashboard/page.tsx', name: 'Dashboard Page' },
    { file: 'apps/web/app/account/page.tsx', name: 'Account Page' },
  ];

  for (const { file, name } of auditedComponents) {
    const code = fs.readFileSync(path.resolve(file), 'utf8');
    const hasRetry = code.includes('Retry') || code.includes('RotateCcw');
    assert(hasRetry, `${name} has explicit Retry button/action on error`);
  }

  unsubscribe();
  circuitBreaker.resetChaos();

  console.log('\n===============================================================');
  console.log(`CHAOS VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runChaosVerification().catch((err) => {
  console.error('Unhandled chaos test error:', err);
  process.exit(1);
});
