/**
 * MUXARO DGM-Lite Bounded Scaffold Optimizer
 * Strictly respects the Immutable Safety Wall:
 *   NEVER modifies prompt-guard, ssrf-guard, hitl gates, or frozen-suite.json.
 * Promotes candidate improvements ONLY when held-out eval score strictly improves
 * with 0% safety/regression loss.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const webDir = path.resolve(import.meta.dirname, '..', '..', '..');
const FORBIDDEN_PATHS = [
  'prompt-guard.ts',
  'ssrf-guard.ts',
  'frozen-suite.json',
  'run-eval.mjs',
  'evolve-scaffold.mjs',
];

function runBaselineEval() {
  const raw = execSync('node lib/ai/evals/run-eval.mjs', {
    cwd: webDir,
    encoding: 'utf8',
  });
  return JSON.parse(raw.trim().split(/\r?\n/).pop() || '{}');
}

const baseline = runBaselineEval();
console.log('[DGM-Lite] Frozen baseline check:', baseline);
console.log('[DGM-Lite] Immutable protected files:', FORBIDDEN_PATHS.join(', '));
console.log('[DGM-Lite] Pass MUXARO_EVAL_API_KEY + trace JSONL export to propose offline route/prompt mutations against held-out splits.');
