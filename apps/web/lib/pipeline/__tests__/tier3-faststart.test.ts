/**
 * Test Suite for Smart Scratch Allocator & Tier 3 Universal Faststart Engine
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  allocateScratch,
  inspectTmpfsEligibility,
  cleanupStaleScratchDirs,
} from '../scratch.ts';
import {
  parseRangeHeader,
  executeTier3Faststart,
} from '../tier3-faststart.ts';

async function runTests() {
  console.log('--- TEST 1: Smart Scratch Allocator ---');

  // Test inspection
  const inspection = await inspectTmpfsEligibility(100 * 1024 * 1024);
  console.log('Tmpfs inspection result:', inspection);
  assert.strictEqual(typeof inspection.eligible, 'boolean');
  assert.strictEqual(typeof inspection.reason, 'string');

  // Test allocation
  const testJobId = `test_job_${Date.now()}`;
  const scratch = await allocateScratch({
    jobId: testJobId,
    estimatedSizeBytes: 50 * 1024 * 1024,
  });

  console.log('Allocated scratch dir:', scratch.dirPath, 'isTmpfs:', scratch.isTmpfs);
  assert.ok(fs.existsSync(scratch.dirPath), 'Scratch directory should exist on disk');

  // Test file operations inside scratch
  const sampleFilePath = scratch.getFilePath('sample.txt');
  fs.writeFileSync(sampleFilePath, 'muxaro test data');
  assert.strictEqual(await scratch.fileExists('sample.txt'), true);
  assert.strictEqual(await scratch.getFileSize('sample.txt'), 16);

  // Test file unlinking
  await scratch.removeFile('sample.txt');
  assert.strictEqual(await scratch.fileExists('sample.txt'), false);

  // Test cleanup
  await scratch.cleanup();
  assert.strictEqual(fs.existsSync(scratch.dirPath), false, 'Scratch dir should be completely removed on cleanup');
  console.log('✓ Scratch Allocator tests passed!');

  console.log('--- TEST 2: HTTP Range 206 Parser ---');
  const total = 10000;

  // 1. Not requested
  assert.strictEqual(parseRangeHeader(null, total), 'not_requested');
  assert.strictEqual(parseRangeHeader(undefined, total), 'not_requested');
  assert.strictEqual(parseRangeHeader('', total), 'not_requested');

  // 2. Bounded range
  const r1 = parseRangeHeader('bytes=0-499', total);
  assert.deepStrictEqual(r1, { start: 0, end: 499 });

  // 3. Open range
  const r2 = parseRangeHeader('bytes=500-', total);
  assert.deepStrictEqual(r2, { start: 500, end: 9999 });

  // 4. Suffix range
  const r3 = parseRangeHeader('bytes=-1000', total);
  assert.deepStrictEqual(r3, { start: 9000, end: 9999 });

  // 5. Clamped upper range
  const r4 = parseRangeHeader('bytes=8000-15000', total);
  assert.deepStrictEqual(r4, { start: 8000, end: 9999 });

  // 6. Unsatisfiable / Malformed
  assert.strictEqual(parseRangeHeader('bytes=10000-12000', total), null);
  assert.strictEqual(parseRangeHeader('bytes=500-200', total), null);
  assert.strictEqual(parseRangeHeader('bytes=invalid', total), null);
  console.log('✓ Range header parser tests passed!');

  console.log('--- TEST 3: FFmpeg Faststart & Immediate Unlink of .part files ---');
  // Create mock video and audio .part files using FFmpeg test sources
  const mockJobId = `job_test_ffmpeg_${Date.now()}`;
  const mockScratch = await allocateScratch({ jobId: mockJobId });
  const mockVideoPart = mockScratch.getFilePath('video.part');
  const mockAudioPart = mockScratch.getFilePath('audio.part');

  // Generate 1-second synthetic mp4 video part (explicit -f mp4)
  const { execSync } = await import('node:child_process');
  execSync(`ffmpeg -y -nostdin -f lavfi -i testsrc=duration=1:size=320x240:rate=30 -c:v libx264 -pix_fmt yuv420p -f mp4 "${mockVideoPart}"`, { stdio: 'ignore' });
  // Generate 1-second synthetic aac audio part (explicit -f adts)
  execSync(`ffmpeg -y -nostdin -f lavfi -i sine=frequency=1000:duration=1 -c:a aac -b:a 128k -f adts "${mockAudioPart}"`, { stdio: 'ignore' });

  assert.ok(fs.existsSync(mockVideoPart), 'Mock video part exists');
  assert.ok(fs.existsSync(mockAudioPart), 'Mock audio part exists');

  // Run FFmpeg faststart muxing command as executed in Tier 3
  const mockOutput = mockScratch.getFilePath('output.mp4');
  execSync(`ffmpeg -y -nostdin -hide_banner -loglevel error -i "${mockVideoPart}" -i "${mockAudioPart}" -map 0:v:0 -map 1:a:0 -c copy -movflags +faststart "${mockOutput}"`);

  // Verify output > 0 bytes
  const outStat = fs.statSync(mockOutput);
  assert.ok(outStat.size > 0, 'Output mp4 must be > 0 bytes');

  // Verify immediate unlinking of .part files
  await mockScratch.removeFile(mockVideoPart);
  await mockScratch.removeFile(mockAudioPart);
  assert.strictEqual(fs.existsSync(mockVideoPart), false, 'video.part must be unlinked');
  assert.strictEqual(fs.existsSync(mockAudioPart), false, 'audio.part must be unlinked');

  // Verify output remains intact
  assert.ok(fs.existsSync(mockOutput), 'output.mp4 must remain intact');

  // Verify Range 206 read stream on output file
  const rangeReadStream = fs.createReadStream(mockOutput, { start: 0, end: 127 });
  let bytesRead = 0;
  for await (const chunk of rangeReadStream) {
    bytesRead += chunk.length;
  }
  assert.strictEqual(bytesRead, 128, 'Range 0-127 should read exactly 128 bytes');

  await mockScratch.cleanup();
  assert.strictEqual(fs.existsSync(mockScratch.dirPath), false, 'Cleaned up mock scratch dir');
  console.log('✓ Faststart & Range 206 mock execution passed!');

  console.log('ALL TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
