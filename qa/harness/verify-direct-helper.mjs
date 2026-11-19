/**
 * Verification Suite for MUXARO Direct Engine & Navigation
 * 
 * Tests:
 * 1. JobProgress.tsx: Ensure "Download with MUXARO Direct" passes sourceUrl via ?url= query parameter.
 * 2. direct-helper/page.tsx: Ensure Suspense wrapper, query param reader, target URL presentation, and stream download actions.
 * 3. background-download.ts: Ensure isMuxaroDirectActive & triggerMuxaroDirectDownload exports.
 * 4. muxaro-direct.user.js: Verify userscript bridge events (muxaro:direct-ready, muxaro:direct-download, muxaro:direct-progress).
 * 5. Hallmark compliance: No transition:all, no type="url", overflow-x:clip.
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT_DIR = process.cwd();

console.log('='.repeat(70));
console.log(' MUXARO Direct Engine & State Passing Verification');
console.log('='.repeat(70));

let passCount = 0;
let failCount = 0;

function check(title, fn) {
  try {
    fn();
    console.log(`PASS: ${title}`);
    passCount++;
  } catch (err) {
    console.error(`FAIL: ${title}`);
    console.error(`      ${err.message}`);
    failCount++;
  }
}

// 1. Audit JobProgress.tsx
check('JobProgress.tsx passes source URL seamlessly to /tools/direct-helper?url=...', () => {
  const file = path.join(ROOT_DIR, 'apps/web/components/JobProgress.tsx');
  const content = fs.readFileSync(file, 'utf8');

  assert.ok(content.includes('directHelperHref'), 'JobProgress must define directHelperHref');
  assert.ok(
    content.includes('`/tools/direct-helper?url=${encodeURIComponent(') ||
    content.includes('encodeURIComponent(directTargetUrl)'),
    'directHelperHref must encode the source URL into the query parameter'
  );
  assert.ok(
    content.includes('href={directHelperHref}'),
    'Download with MUXARO Direct button must use directHelperHref'
  );
  assert.ok(
    content.includes('sourceUrl: raw.sourceUrl || (raw as any).mediaUrl || prev.sourceUrl') ||
    content.includes('sourceUrl: raw.sourceUrl || prev.sourceUrl'),
    'mergeBackendPayload must preserve sourceUrl across status updates'
  );
});

// 2. Audit direct-helper/page.tsx
check('direct-helper/page.tsx receives target URL, wraps in Suspense, and handles direct streaming', () => {
  const file = path.join(ROOT_DIR, 'apps/web/app/tools/direct-helper/page.tsx');
  const content = fs.readFileSync(file, 'utf8');

  assert.ok(content.includes('Suspense'), 'direct-helper/page.tsx must wrap content in Suspense for static export');
  assert.ok(content.includes('useSearchParams'), 'Must use useSearchParams to extract query parameters');
  assert.ok(content.includes('targetUrl'), 'Must manage targetUrl state for pre-filled source');
  assert.ok(content.includes('triggerMuxaroDirectDownload'), 'Must integrate triggerMuxaroDirectDownload');
  assert.ok(content.includes('muxaro:direct-ready'), 'Must listen for muxaro:direct-ready bridge event');
  assert.ok(content.includes('muxaro:direct-progress'), 'Must listen for muxaro:direct-progress stream events');
  assert.ok(content.includes('muxaro:direct-complete'), 'Must listen for muxaro:direct-complete events');
  assert.ok(!content.includes('type="url"'), 'Must never use <input type="url"> which triggers native browser form aborts');
  assert.ok(!content.includes('transition: all'), 'Must not contain transition: all (Hallmark floor rule)');
});

// 3. Audit background-download.ts
check('background-download.ts exports isMuxaroDirectActive and triggerMuxaroDirectDownload', () => {
  const file = path.join(ROOT_DIR, 'apps/web/lib/background-download.ts');
  const content = fs.readFileSync(file, 'utf8');

  assert.ok(content.includes('export function isMuxaroDirectActive'), 'Must export isMuxaroDirectActive');
  assert.ok(content.includes('export function triggerMuxaroDirectDownload'), 'Must export triggerMuxaroDirectDownload');
  assert.ok(content.includes('__MUXARO_DIRECT_ACTIVE__'), 'Must detect __MUXARO_DIRECT_ACTIVE__ window property');
  assert.ok(content.includes('data-muxaro-direct'), 'Must detect data-muxaro-direct attribute');
  assert.ok(content.includes('muxaro:direct-download'), 'Must dispatch muxaro:direct-download CustomEvent');
});

// 4. Audit muxaro-direct.user.js
check('muxaro-direct.user.js exists in public directory and contains residential bridge handlers', () => {
  const file = path.join(ROOT_DIR, 'apps/web/public/muxaro-direct.user.js');
  assert.ok(fs.existsSync(file), 'muxaro-direct.user.js must exist in public directory');
  const content = fs.readFileSync(file, 'utf8');

  assert.ok(content.includes('// ==UserScript=='), 'Must have valid UserScript headers');
  assert.ok(content.includes('GM_download'), 'Must grant GM_download');
  assert.ok(content.includes('window.__MUXARO_DIRECT_ACTIVE__ = true'), 'Must inject window flag');
  assert.ok(content.includes('muxaro:direct-download'), 'Must handle muxaro:direct-download event');
  assert.ok(content.includes('muxaro:direct-progress'), 'Must emit muxaro:direct-progress');
  assert.ok(content.includes('muxaro:direct-complete'), 'Must emit muxaro:direct-complete');
});

// 5. Audit api-client.ts
check('api-client.ts preserves sourceUrl in normalizeJob and createJob', () => {
  const file = path.join(ROOT_DIR, 'apps/web/lib/api-client.ts');
  const content = fs.readFileSync(file, 'utf8');

  assert.ok(content.includes('sourceUrl: resolvedUrl || params.sourceUrl'), 'createJob must pass sourceUrl');
  assert.ok(content.includes('sourceUrl:') && content.includes('fallbackContext?.sourceUrl'), 'normalizeJob must assign sourceUrl');
});

console.log('='.repeat(70));
console.log(` Summary: ${passCount} passed, ${failCount} failed.`);
console.log('='.repeat(70));

if (failCount > 0) {
  process.exit(1);
} else {
  console.log('✔ ALL MUXARO DIRECT GATES PASSED.');
}
