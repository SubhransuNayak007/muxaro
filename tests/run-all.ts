/**
 * MUXARO All-Tests Master Runner
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

console.log('='.repeat(70));
console.log(' MUXARO — Running Master Test Suite');
console.log('='.repeat(70));

const result = spawnSync(
  process.execPath,
  ['--experimental-strip-types', 'tests/unit/run-unit.ts'],
  {
    stdio: 'inherit',
    cwd: path.resolve(process.cwd()),
  }
);

process.exit(result.status || 0);
