/**
 * Tests for n-sig Throttling Parameter AST Solver
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  NSigInterpreter,
  NSigExtractor,
  NSigSolver,
  type NSigDecipherPlan,
} from '../src/n-sig-solver.ts';

describe('n-sig Solver & AST Interpreter Tests', () => {
  it('should execute reverse operation correctly', () => {
    const plan: NSigDecipherPlan = {
      playerHash: 'test_hash_1',
      operations: [{ op: 'reverse' }],
      createdAt: Date.now(),
    };
    const out = NSigInterpreter.execute('abcdef', plan);
    assert.strictEqual(out, 'fedcba');
  });

  it('should execute swap operation correctly', () => {
    const plan: NSigDecipherPlan = {
      playerHash: 'test_hash_2',
      operations: [{ op: 'swap', index: 2 }],
      createdAt: Date.now(),
    };
    // 'a' at idx 0 swaps with 'c' at idx 2
    const out = NSigInterpreter.execute('abcdef', plan);
    assert.strictEqual(out, 'cbadef');
  });

  it('should execute splice operation correctly', () => {
    const plan: NSigDecipherPlan = {
      playerHash: 'test_hash_3',
      operations: [{ op: 'splice', count: 2 }],
      createdAt: Date.now(),
    };
    const out = NSigInterpreter.execute('abcdef', plan);
    assert.strictEqual(out, 'cdef');
  });

  it('should execute rotate operation correctly', () => {
    const plan: NSigDecipherPlan = {
      playerHash: 'test_hash_4',
      operations: [{ op: 'rotate', shift: 2 }],
      createdAt: Date.now(),
    };
    const out = NSigInterpreter.execute('abcdef', plan);
    assert.strictEqual(out, 'cdefab');
  });

  it('should extract decipher plan from synthetic base.js script content', () => {
    const scriptContent = `
      var someVar = 123;
      function Dza(a) {
        var b = a.split("");
        b.reverse();
        b.splice(0, 1);
        b[0] = b[3 % b.length];
        return b.join("");
      }
    `;
    const plan = NSigExtractor.extractPlan('sample_player_hash', scriptContent);
    assert.strictEqual(plan.playerHash, 'sample_player_hash');
    assert(plan.operations.length >= 2);
    assert.strictEqual(plan.operations[0].op, 'reverse');
  });

  it('should cache decipher plans in NSigSolver and update URL searchParams', async () => {
    const solver = new NSigSolver();
    const testPlan: NSigDecipherPlan = {
      playerHash: 'player_v1',
      operations: [
        { op: 'reverse' },
        { op: 'swap', index: 1 },
      ],
      createdAt: Date.now(),
    };
    solver.storePlan(testPlan);

    const cached = solver.getPlan('player_v1');
    assert(cached);
    assert.strictEqual(cached.playerHash, 'player_v1');

    const rawUrl = 'https://rr1---sn-test.googlevideo.com/videoplayback?id=123&n=abcdef';
    const updatedUrl = await solver.updateUrlNParameter(rawUrl, 'player_v1');
    const parsed = new URL(updatedUrl);
    const updatedN = parsed.searchParams.get('n');
    assert(updatedN);
    assert.notStrictEqual(updatedN, 'abcdef');
    // reverse('abcdef') = 'fedcba', swap(0, 1) = 'efdcba'
    assert.strictEqual(updatedN, 'efdcba');
  });
});
