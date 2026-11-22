/**
 * Project Garuda - Sovereign Network & Edge Acceleration Master Test Runner
 */

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const suites = [
  'ipv6-subnet-agent.test.ts',
  'direct-302-tunnel.test.ts',
  'parallel-chunk-stream.test.ts',
];

console.log('================================================================');
console.log('⚡ PROJECT GARUDA - SOVEREIGN NETWORK & EDGE ACCELERATION TESTS');
console.log('================================================================\n');

let passed = 0;
let failed = 0;

for (const suite of suites) {
  const suitePath = path.join(__dirname, suite);
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', suitePath],
    {
      stdio: 'inherit',
      cwd: path.resolve(__dirname, '..'),
    }
  );

  if (result.status === 0) {
    passed++;
  } else {
    failed++;
    console.error(`❌ Suite ${suite} failed with code ${result.status}`);
  }
}

console.log('================================================================');
console.log(`Summary: ${passed} passed, ${failed} failed (${suites.length} total suites)`);
console.log('================================================================');

if (failed > 0) {
  process.exit(1);
}
