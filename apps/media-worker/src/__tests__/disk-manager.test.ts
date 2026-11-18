import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ScratchDiskManager } from '../scratch/disk-manager.js';

describe('ScratchDiskManager', () => {
  const testBaseDir = path.join(os.tmpdir(), `muxaro_test_scratch_${Date.now()}`);

  afterEach(() => {
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true, force: true });
    }
  });

  test('creates isolated job workspaces and reports stats', () => {
    const manager = new ScratchDiskManager({
      baseDirectory: testBaseDir,
      maxSizeBytes: 10 * 1024 * 1024 // 10 MB
    });

    const ws = manager.createJobWorkspace('job_alpha');
    assert.equal(fs.existsSync(ws), true);

    // Write a dummy 1KB file in workspace
    fs.writeFileSync(path.join(ws, 'sample.bin'), Buffer.alloc(1024));

    const stats = manager.getUsageStats();
    assert.equal(stats.activeWorkspacesCount, 1);
    assert.ok(stats.usedBytes >= 1024);
  });

  test('cleans up job workspaces completely', async () => {
    const manager = new ScratchDiskManager({ baseDirectory: testBaseDir });
    const ws = manager.createJobWorkspace('job_beta');
    fs.writeFileSync(path.join(ws, 'temp.mp4'), Buffer.alloc(2048));

    await manager.cleanupJobWorkspace('job_beta');
    assert.equal(fs.existsSync(ws), false);
    const stats = manager.getUsageStats();
    assert.equal(stats.activeWorkspacesCount, 0);
  });

  test('enforces quota bounds and throws when exceeded', () => {
    const manager = new ScratchDiskManager({
      baseDirectory: testBaseDir,
      maxSizeBytes: 2000 // 2 KB quota
    });

    const ws = manager.createJobWorkspace('job_gamma');
    fs.writeFileSync(path.join(ws, 'large.bin'), Buffer.alloc(3000));

    assert.throws(() => {
      manager.enforceQuota();
    }, /Scratch disk quota exceeded/);
  });
});
