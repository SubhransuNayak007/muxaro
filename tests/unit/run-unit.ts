/**
 * MUXARO Unit Test Runner
 * Executes all unit test suites in sequence:
 * 1. Link handling & URL normalization regression tests
 * 2. API client edge/guest mode tests
 * 3. Source adapters registry and abuse prevention tests
 * 4. Entitlements, quota, and RBAC tests
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const suites = [
  'tests/unit/link-handling-regression.test.ts',
  'tests/unit/api-client-edge-mode.test.ts',
  'tests/unit/adapters.test.ts',
  'tests/unit/entitlements.test.ts',
  'tests/unit/stream-engine.test.ts',
  'tests/unit/opfs-accumulator.test.ts',
];

console.log('='.repeat(70));
console.log(' MUXARO — Running Comprehensive Unit & Regression Test Suite');
console.log('='.repeat(70));

let totalPassed = 0;
let totalFailed = 0;

for (const suite of suites) {
  console.log(`\n▶ Running: ${suite}`);
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', suite],
    {
      stdio: 'inherit',
      cwd: path.resolve(process.cwd()),
    }
  );

  if (result.status === 0) {
    totalPassed++;
  } else {
    totalFailed++;
    console.error(`✖ Suite failed: ${suite} (exit code ${result.status})`);
  }
}

console.log('\n' + '='.repeat(70));
console.log(` Unit Test Results: ${totalPassed} passed, ${totalFailed} failed of ${suites.length} suites.`);
console.log('='.repeat(70));

if (totalFailed > 0) {
  process.exit(1);
} else {
  console.log('✔ ALL UNIT & LINK REGRESSION SUITES PASSED CLEANLY.\n');
}
