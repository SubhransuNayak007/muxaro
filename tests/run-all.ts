/**
 * MUXARO All-Tests Master Runner
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

console.log('='.repeat(70));
console.log(' MUXARO — Running Master Test Suite');
console.log('='.repeat(70));

const suites = [
  { name: 'Unit & Link Normalization Suites', script: 'tests/unit/run-unit.ts' },
  { name: 'SSRF Security & Defense Regression', script: 'tests/security/ssrf-regression.test.ts' },
  { name: 'Media Engine & FFmpeg Transcoding', script: 'tests/media/media-engine.test.ts' },
];

let totalPassed = 0;
let totalFailed = 0;

for (const suite of suites) {
  console.log(`\n======================================================================`);
  console.log(`▶ Executing Master Stage: ${suite.name}`);
  console.log(`======================================================================`);
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', suite.script],
    {
      stdio: 'inherit',
      cwd: path.resolve(process.cwd()),
    }
  );

  if (result.status === 0) {
    totalPassed++;
  } else {
    totalFailed++;
    console.error(`✖ Master stage failed: ${suite.name} (exit code ${result.status})`);
  }
}

console.log('\n' + '='.repeat(70));
console.log(` MASTER TEST SUITE COMPLETE: ${totalPassed} passed, ${totalFailed} failed.`);
console.log('='.repeat(70));

process.exit(totalFailed > 0 ? 1 : 0);
