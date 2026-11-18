import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ProcessSanitizer } from '../process/sanitizer.js';

describe('ProcessSanitizer', () => {
  test('permits valid arguments without special characters', () => {
    assert.equal(ProcessSanitizer.validateArgument('-c:v'), '-c:v');
    assert.equal(ProcessSanitizer.validateArgument('libx264'), 'libx264');
    assert.equal(ProcessSanitizer.validateArgument('scale=1920:1080'), 'scale=1920:1080');
  });

  test('rejects shell injection characters in arguments', () => {
    assert.throws(() => ProcessSanitizer.validateArgument('test; rm -rf /'), /Security Exception/);
    assert.throws(() => ProcessSanitizer.validateArgument('test | cat /etc/passwd'), /Security Exception/);
    assert.throws(() => ProcessSanitizer.validateArgument('test && evil'), /Security Exception/);
    assert.throws(() => ProcessSanitizer.validateArgument('`whoami`'), /Security Exception/);
    assert.throws(() => ProcessSanitizer.validateArgument('$(whoami)'), /Security Exception/);
  });

  test('enforces root confinement and prevents path traversal', () => {
    const rootDir = path.resolve('temp_allowed');
    const safeSub = path.join(rootDir, 'job_123', 'output.mp4');
    assert.equal(ProcessSanitizer.validatePath(safeSub, rootDir), path.resolve(safeSub));

    assert.throws(() => {
      ProcessSanitizer.validatePath(path.join(rootDir, '..', 'secret.txt'), rootDir);
    }, /Path traversal attempt/);
  });

  test('sanitizes user filenames cleanly', () => {
    assert.equal(ProcessSanitizer.sanitizeFilename('my video.mp4'), 'my video.mp4');
    assert.equal(ProcessSanitizer.sanitizeFilename('../../etc/passwd.mp4'), 'passwd.mp4');
    assert.equal(ProcessSanitizer.sanitizeFilename('cool:movie*name?.mkv'), 'cool_movie_name_.mkv');
    assert.equal(ProcessSanitizer.sanitizeFilename('', 'fallback.mp4'), 'fallback.mp4');
  });
});
