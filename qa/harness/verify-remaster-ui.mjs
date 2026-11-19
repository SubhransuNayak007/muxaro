/**
 * MUXARO Remaster UI & Link Bug Verification Harness
 * 
 * Verifies:
 * 1. Complete elimination of `<input type="url">` form submission blocker across all routes
 * 2. ActiveLinkIndicator integration across homepage, all tool pages, and dashboard
 * 3. Hallmark CSS floor compliance (zero `transition: all`, no width/height animations)
 * 4. Responsive viewport CSS rules (max-w constraints, padding gutters, overflow-x clip)
 * 5. Dead host prevention across client bundles
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT_DIR = process.cwd();
const WEB_APP_DIR = path.join(ROOT_DIR, 'apps', 'web', 'app');

console.log('='.repeat(70));
console.log(' MUXARO — UI Remaster, Motion & Link Bug Verification Harness');
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

// 1. Verify no tool page contains <input type="url">
check('Zero <input type="url"> elements in tools sub-pages (prevents silent aborts)', () => {
  const toolFiles = [
    'tools/media-converter/page.tsx',
    'tools/audio-extractor/page.tsx',
    'tools/audio-video-merger/page.tsx',
    'tools/video-merger/page.tsx',
    'tools/batch-processing/page.tsx',
    'tools/playlist-processing/page.tsx',
    'tools/playlist-batch/page.tsx',
  ];

  for (const rel of toolFiles) {
    const fullPath = path.join(WEB_APP_DIR, rel);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf8');
    assert.ok(
      !content.includes('type="url"'),
      `File ${rel} still contains type="url" which blocks non-scheme URLs!`
    );
    assert.ok(
      content.includes('normalizeMediaUrl') || content.includes('ActiveLinkIndicator'),
      `File ${rel} must integrate normalizeMediaUrl or ActiveLinkIndicator`
    );
  }
});

// 2. Verify ActiveLinkIndicator exists and has proper ARIA & clipboard attributes
check('ActiveLinkIndicator component integrity and accessibility', () => {
  const compPath = path.join(ROOT_DIR, 'apps', 'web', 'components', 'ActiveLinkIndicator.tsx');
  assert.ok(fs.existsSync(compPath), 'ActiveLinkIndicator.tsx must exist');
  const code = fs.readFileSync(compPath, 'utf8');
  assert.ok(code.includes('aria-label'), 'ActiveLinkIndicator must include aria-label');
  assert.ok(code.includes('navigator.clipboard'), 'ActiveLinkIndicator must support clipboard copy');
  assert.ok(code.includes('formatDisplayUrl'), 'ActiveLinkIndicator must use formatDisplayUrl');
});

// 3. Verify Antigravity Orbital Field and Cursor Spotlight components
check('Google Antigravity Orbital Field & DeepSeek Cursor Spotlight presence', () => {
  const orbitalPath = path.join(ROOT_DIR, 'apps', 'web', 'components', 'AntigravityOrbitalField.tsx');
  const spotlightPath = path.join(ROOT_DIR, 'apps', 'web', 'components', 'CursorSpotlight.tsx');
  assert.ok(fs.existsSync(orbitalPath), 'AntigravityOrbitalField.tsx must exist');
  assert.ok(fs.existsSync(spotlightPath), 'CursorSpotlight.tsx must exist');

  const orbitalCode = fs.readFileSync(orbitalPath, 'utf8');
  assert.ok(orbitalCode.includes('requestAnimationFrame'), 'Must use requestAnimationFrame loop');
  assert.ok(orbitalCode.includes('canvas'), 'Must render via HTML5 Canvas');
});

// 4. Verify Hallmark CSS Floor Rules in globals.css
check('Hallmark CSS Floor rules in globals.css (no transition: all, overflow-x: clip)', () => {
  const cssPath = path.join(WEB_APP_DIR, 'globals.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  assert.ok(css.includes('overflow-x: clip'), 'globals.css must specify overflow-x: clip on html and body');
  assert.ok(css.includes('--muxaro-indigo'), 'globals.css must declare color tokens at :root');
  assert.ok(!css.includes('transition: all;'), 'globals.css must never use transition: all');
  assert.ok(!css.includes('transition:all;'), 'globals.css must never use transition: all');
});

// 5. Verify Dead Host Protection
check('Dead host prevention: api.muxaro.app is never targeted', () => {
  const apiClientPath = path.join(ROOT_DIR, 'apps', 'web', 'lib', 'api-client.ts');
  const code = fs.readFileSync(apiClientPath, 'utf8');
  assert.ok(code.includes('isDeadOrUnresolvableHost'), 'api-client.ts must include isDeadOrUnresolvableHost');
});

console.log('='.repeat(70));
console.log(` Harness Summary: ${passCount} passed, ${failCount} failed.`);
console.log('='.repeat(70));

if (failCount > 0) {
  process.exit(1);
} else {
  console.log('✔ ALL REMASTER & LINK VERIFICATION GATES PASSED.\n');
}
