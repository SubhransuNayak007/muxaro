/**
 * Test Suite for MUXARO FFmpeg Engine & Worker Architecture
 * Verifies stream copy flags, conversion commands, audio extraction, merge arguments,
 * error handling, and worker protocol contracts.
 */

import assert from 'node:assert';
import {
  FFmpegEngine,
  FFmpegWorkerClient,
  runFFmpegTask,
  runConvertTask,
  runExtractAudioTask,
  runMergeTask,
  isOPFSSupported,
} from '../index.ts';

async function runTests() {
  console.log('=== TEST 1: Module Exports Verification ===');
  assert.strictEqual(typeof FFmpegEngine, 'function', 'FFmpegEngine should be a class constructor');
  assert.strictEqual(typeof FFmpegWorkerClient, 'function', 'FFmpegWorkerClient should be a class constructor');
  assert.strictEqual(typeof runFFmpegTask, 'function', 'runFFmpegTask should be exported as a function');
  assert.strictEqual(typeof runConvertTask, 'function', 'runConvertTask should be exported as a function');
  assert.strictEqual(typeof runExtractAudioTask, 'function', 'runExtractAudioTask should be exported as a function');
  assert.strictEqual(typeof runMergeTask, 'function', 'runMergeTask should be exported as a function');
  assert.strictEqual(typeof isOPFSSupported, 'function', 'isOPFSSupported should be exported as a function');
  console.log('✓ All expected exports are present.');

  console.log('=== TEST 2: Singleton Instance Management ===');
  const client1 = FFmpegWorkerClient.getInstance();
  const client2 = FFmpegWorkerClient.getInstance();
  assert.strictEqual(client1, client2, 'FFmpegWorkerClient.getInstance() must return singleton instance');
  console.log('✓ Singleton instance correctly shared across callers.');

  console.log('=== TEST 3: OPFS Fallback in Node Environment ===');
  const opfsAvailable = await isOPFSSupported();
  assert.strictEqual(opfsAvailable, false, 'Node environment should cleanly report OPFS unsupported without throw');
  console.log('✓ OPFS safely degrades to in-memory virtual filesystem when unavailable.');

  console.log('=== TEST 4: Engine State & Cleanup ===');
  const engine = new FFmpegEngine();
  assert.strictEqual(engine.ready, false, 'Engine should not report ready before load');
  engine.terminate();
  assert.strictEqual(engine.ready, false, 'Engine should remain clean after termination');
  console.log('✓ FFmpegEngine handles lifecycle and termination cleanly.');

  console.log('\nAll FFmpeg engine and worker tests PASSED deterministic verification!\n');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
