/**
 * Project MUXARO - Source Adapters Master Test Runner
 * 
 * Executes all unit test suites in packages/source-adapters/tests/
 */

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testFiles = [
  'types.test.ts',
  'ssrf-filter.test.ts',
  'rights-validator.test.ts',
  'direct-adapter.test.ts',
  'youtube-permitted-adapter.test.ts',
  'adapter-registry.test.ts',
];

console.log('=====================================================');
console.log('MUXARO SOURCE ADAPTERS - MASTER TEST SUITE');
console.log('=====================================================\n');

let failedCount = 0;
let passedCount = 0;
const startTime = Date.now();

for (const file of testFiles) {
  const filePath = path.join(__dirname, file);
  console.log(`[TEST SUITE] Running ${file}...`);

  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', filePath],
    {
      stdio: 'inherit',
      cwd: path.resolve(__dirname, '..'),
    }
  );

  if (result.status === 0) {
    passedCount++;
  } else {
    failedCount++;
    console.error(`❌ Suite ${file} failed with exit code ${result.status}`);
  }
  console.log('');
}

const elapsedMs = Date.now() - startTime;

console.log('=====================================================');
console.log(`TEST SUMMARY: ${passedCount} passed, ${failedCount} failed (${elapsedMs}ms)`);
console.log('=====================================================');

if (failedCount > 0) {
  process.exit(1);
} else {
  console.log('🎉 ALL SOURCE ADAPTER TESTS PASSED PERFECTLY!\n');
  process.exit(0);
}
