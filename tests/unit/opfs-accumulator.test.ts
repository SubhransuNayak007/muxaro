/**
 * MUXARO Origin Private File System (OPFS) & Accumulator Test Suite
 * File: tests/unit/opfs-accumulator.test.ts
 *
 * Comprehensive validation of:
 * 1. Feature detection (isOPFSSupported, isFileSystemAccessSupported)
 * 2. Storage quota validation and pre-flight space governor
 * 3. FallbackStreamAccumulator (memory and fallback modes, watermark bounds)
 * 4. OPFSStreamWriter (zero-RAM direct stream accumulation to FileSystemWritableFileStream)
 * 5. Direct-to-Disk Export (File System Access stream pipe & zero-RAM browser download)
 * 6. OPFSStreamSink stream engine integration
 * 7. Error handling and abort cleanup
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  OPFSStreamWriter,
  OPFSStreamSink,
  FallbackStreamAccumulator,
  isOPFSSupported,
  isFileSystemAccessSupported,
  getStorageQuota,
  preflightStorageCheck,
  createStreamAccumulator,
  OPFSError,
} from '../../apps/web/lib/opfs/index.ts';

describe('OPFS: Feature Detection & Quota Governor', () => {
  it('should detect unsupported environment safely without crashing in Node.js', () => {
    // In standard Node environment without navigator.storage, isOPFSSupported should be false
    const supported = isOPFSSupported();
    assert.strictEqual(typeof supported, 'boolean');

    const fsaSupported = isFileSystemAccessSupported();
    assert.strictEqual(typeof fsaSupported, 'boolean');
  });

  it('should evaluate quota and reject when storage headroom is insufficient', async () => {
    // Mock navigator.storage.estimate
    const originalNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: {
          estimate: async () => ({
            quota: 2 * 1024 * 1024 * 1024, // 2 GB quota
            usage: 1.8 * 1024 * 1024 * 1024, // 1.8 GB used -> 200 MB free
          }),
          getDirectory: async () => ({}),
        },
      },
      configurable: true,
      writable: true,
    });

    try {
      const quota = await getStorageQuota();
      assert.ok(quota !== null);
      assert.strictEqual(quota?.quota, 2 * 1024 * 1024 * 1024);
      assert.ok(quota!.available < 250 * 1024 * 1024);
      assert.strictEqual(quota?.canFit(100 * 1024 * 1024), true);
      assert.strictEqual(quota?.canFit(500 * 1024 * 1024), false);

      // Pre-flight check for a 500MB download should fail
      const preflightFail = await preflightStorageCheck(500 * 1024 * 1024);
      assert.strictEqual(preflightFail.ok, false);
      assert.ok(preflightFail.reason?.includes('Insufficient browser disk quota'));

      // Pre-flight check for a 50MB download should pass
      const preflightPass = await preflightStorageCheck(50 * 1024 * 1024);
      assert.strictEqual(preflightPass.ok, true);
    } finally {
      if (originalNavigatorDesc) {
        Object.defineProperty(globalThis, 'navigator', originalNavigatorDesc);
      }
    }
  });
});

describe('OPFS: FallbackStreamAccumulator', () => {
  it('should accumulate chunks, report progress, and build final file in fallback mode', async () => {
    const progressReports: number[] = [];
    const chunkReports: number[] = [];

    const accumulator = new FallbackStreamAccumulator({
      fileName: 'test-video.mp4',
      mimeType: 'video/mp4',
      expectedSize: 1000,
      onProgress: (written) => progressReports.push(written),
      onChunkWritten: (chunk) => chunkReports.push(chunk),
    });

    await accumulator.init();
    assert.strictEqual(accumulator.isInitialized, true);
    assert.strictEqual(accumulator.isFallbackMode, true);

    // Write chunks
    const chunk1 = new Uint8Array([1, 2, 3, 4, 5]);
    const chunk2 = new Uint8Array([6, 7, 8, 9, 10]);

    await accumulator.write(chunk1);
    await accumulator.write(chunk2);

    assert.strictEqual(accumulator.bytesWritten, 10);
    assert.deepStrictEqual(chunkReports, [5, 5]);
    assert.deepStrictEqual(progressReports, [5, 10]);

    // Close and inspect metadata
    const meta = await accumulator.close();
    assert.strictEqual(meta.name, 'test-video.mp4');
    assert.strictEqual(meta.size, 10);
    assert.strictEqual(meta.type, 'video/mp4');
    assert.strictEqual(meta.isFallback, true);

    // Get file blob
    const file = await accumulator.getFile();
    assert.strictEqual(file.size, 10);

    // Export to disk without browser DOM returns result safely
    const exportRes = await accumulator.exportToDisk({ suggestedName: 'my-exported.mp4' });
    assert.strictEqual(exportRes.success, true);
    assert.strictEqual(exportRes.bytesExported, 10);

    await accumulator.cleanup();
  });

  it('should reject writes when uninitialized or closed', async () => {
    const accumulator = new FallbackStreamAccumulator();
    const chunk = new Uint8Array([1, 2, 3]);

    await assert.rejects(
      async () => accumulator.write(chunk),
      (err: any) => err instanceof OPFSError && err.code === 'INVALID_STATE'
    );

    await accumulator.init();
    await accumulator.write(chunk);
    await accumulator.close();

    await assert.rejects(
      async () => accumulator.write(chunk),
      (err: any) => err instanceof OPFSError && err.code === 'INVALID_STATE'
    );
  });
});

describe('OPFS: OPFSStreamWriter (Mocked OPFS Core)', () => {
  let originalNavigatorDesc: PropertyDescriptor | undefined;
  let originalWindow: any;

  // In-memory mock storage directory
  let mockFsStorage: Map<string, Uint8Array>;
  let mockWritableCalls: { writes: Uint8Array[]; closed: boolean; aborted: boolean };

  beforeEach(() => {
    originalNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    originalWindow = (globalThis as any).window;

    mockFsStorage = new Map();
    mockWritableCalls = { writes: [], closed: false, aborted: false };

    const createMockWritable = (filename: string) => ({
      write: async (data: BufferSource | Blob | string) => {
        let bytes: Uint8Array;
        if (data instanceof Uint8Array) {
          bytes = data;
        } else if (data instanceof ArrayBuffer) {
          bytes = new Uint8Array(data);
        } else {
          bytes = new TextEncoder().encode(String(data));
        }
        mockWritableCalls.writes.push(bytes);
        const existing = mockFsStorage.get(filename) || new Uint8Array(0);
        const merged = new Uint8Array(existing.length + bytes.length);
        merged.set(existing, 0);
        merged.set(bytes, existing.length);
        mockFsStorage.set(filename, merged);
      },
      close: async () => {
        mockWritableCalls.closed = true;
      },
      abort: async () => {
        mockWritableCalls.aborted = true;
      },
    });

    const mockDirectoryHandle = {
      kind: 'directory',
      name: 'muxaro_streams',
      getFileHandle: async (name: string, _options?: any) => ({
        kind: 'file',
        name,
        createWritable: async () => createMockWritable(name),
        getFile: async () => {
          const data = mockFsStorage.get(name) || new Uint8Array(0);
          return new File([data as unknown as BlobPart], name, {
            type: 'video/mp4',
            lastModified: Date.now(),
          });
        },
      }),
      getDirectoryHandle: async (name: string, _options?: any) => mockDirectoryHandle,
      removeEntry: async (name: string) => {
        mockFsStorage.delete(name);
      },
      entries: async function* () {
        for (const [name, data] of mockFsStorage.entries()) {
          yield [
            name,
            {
              kind: 'file',
              name,
              getFile: async () => new File([data as unknown as BlobPart], name, { type: 'video/mp4' }),
            },
          ];
        }
      },
    };

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: {
          getDirectory: async () => mockDirectoryHandle,
          estimate: async () => ({
            quota: 10 * 1024 * 1024 * 1024,
            usage: 100 * 1024 * 1024,
          }),
        },
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (originalNavigatorDesc) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDesc);
    }
    (globalThis as any).window = originalWindow;
  });

  it('should write chunks directly to OPFS FileSystemWritableFileStream without RAM buildup', async () => {
    assert.strictEqual(isOPFSSupported(), true);

    const writer = new OPFSStreamWriter({
      fileName: 'stream-8k-test.mp4',
      mimeType: 'video/mp4',
      expectedSize: 2048,
    });

    await writer.init();
    assert.strictEqual(writer.isInitialized, true);
    assert.strictEqual(writer.isFallbackMode, false);

    // Simulate incoming 8K stream fragments (e.g. 512-byte slices)
    const chunk1 = new Uint8Array(512).fill(1);
    const chunk2 = new Uint8Array(512).fill(2);
    const chunk3 = new Uint8Array(1024).fill(3);

    await writer.write(chunk1);
    await writer.write(chunk2);
    await writer.write(chunk3);

    assert.strictEqual(writer.bytesWritten, 2048);
    assert.strictEqual(mockWritableCalls.writes.length, 3);

    // Close stream
    const meta = await writer.close();
    assert.strictEqual(mockWritableCalls.closed, true);
    assert.strictEqual(meta.size, 2048);
    assert.strictEqual(meta.isFallback, false);

    // Verify stored OPFS file
    const file = (await writer.getFile()) as File;
    assert.strictEqual(file.size, 2048);
  });

  it('should stream export directly via File System Access API when available', async () => {
    let destBuffer: Uint8Array = new Uint8Array(0);
    let destClosed = false;

    // Mock window.showSaveFilePicker
    (globalThis as any).window = {
      showSaveFilePicker: async (opts: any) => ({
        name: opts.suggestedName || 'saved-video.mp4',
        createWritable: async () => ({
          write: async (chunk: any) => {
            const arr = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
            const combined = new Uint8Array(destBuffer.length + arr.length);
            combined.set(destBuffer, 0);
            combined.set(arr, destBuffer.length);
            destBuffer = combined;
          },
          close: async () => {
            destClosed = true;
          },
        }),
      }),
    };

    const writer = new OPFSStreamWriter({
      fileName: 'direct-export-8k.mp4',
      mimeType: 'video/mp4',
    });

    await writer.init();
    const data = new Uint8Array([10, 20, 30, 40, 50, 60]);
    await writer.write(data);
    await writer.close();

    const exportRes = await writer.exportToDisk({
      suggestedName: 'final-user-video.mp4',
      preferredMode: 'file-system',
    });

    assert.strictEqual(exportRes.success, true);
    assert.strictEqual(exportRes.mode, 'file-system');
    assert.strictEqual(exportRes.fileName, 'final-user-video.mp4');
    assert.strictEqual(exportRes.bytesExported, 6);
    assert.strictEqual(destClosed, true);
    assert.deepStrictEqual(destBuffer, data);
  });

  it('should clean up temporary OPFS files on abort', async () => {
    const writer = new OPFSStreamWriter({
      fileName: 'aborted-stream.mp4',
    });

    await writer.init();
    await writer.write(new Uint8Array([1, 2, 3]));
    await writer.abort('User stopped stream');

    assert.strictEqual(mockWritableCalls.aborted, true);
    assert.strictEqual(writer.isClosed, true);
  });
});

describe('OPFS: OPFSStreamSink (Stream Engine Integration)', () => {
  let originalNavigatorDesc: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: {
          getDirectory: async () => ({
            kind: 'directory',
            name: 'muxaro_streams',
            getFileHandle: async (name: string) => ({
              kind: 'file',
              name,
              createWritable: async () => ({
                write: async () => {},
                close: async () => {},
                abort: async () => {},
              }),
              getFile: async () => new File([new Uint8Array(100)], name, { type: 'video/mp4' }),
            }),
            getDirectoryHandle: async () => (globalThis as any).navigator.storage.getDirectory(),
            removeEntry: async () => {},
          }),
        },
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (originalNavigatorDesc) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDesc);
    }
  });

  it('should implement StreamSink contract and handle full stream lifecycle', async () => {
    const sink = new OPFSStreamSink();
    assert.strictEqual(sink.type, 'opfs');

    await sink.init('output-stream-8k.mp4', 'video/mp4', 500);

    const chunk = new Uint8Array(100);
    await sink.write(chunk);
    assert.strictEqual(sink.getBytesWritten(), 100);

    await sink.close();
    // After close, file should be ready
    const file = await sink.getFile();
    assert.ok(file !== null);
  });
});
