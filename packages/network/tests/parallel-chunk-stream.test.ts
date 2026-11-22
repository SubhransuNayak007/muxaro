/**
 * Test Suite: Multi-Range Parallel Chunk Streaming Engine
 */

import assert from 'node:assert/strict';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { createParallelChunkStream } from '../src/parallel-chunk-stream.ts';

console.log('--- Running Multi-Range Parallel Chunk Streaming Tests ---');

async function runParallelStreamTests() {
  // Generate 6MB of deterministic pseudo-random binary test data
  const TOTAL_SIZE = 6 * 1024 * 1024; // 6MB
  const sourceBuffer = Buffer.alloc(TOTAL_SIZE);
  for (let i = 0; i < TOTAL_SIZE; i += 4) {
    sourceBuffer.writeUInt32BE(i, i);
  }
  const sourceHash = crypto.createHash('sha256').update(sourceBuffer).digest('hex');

  let failedAttemptsChunk1 = 0;

  // Spin up in-memory mock media server supporting HTTP Range requests
  const server = http.createServer((req, res) => {
    const rangeHeader = req.headers['range'];

    if (!rangeHeader) {
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': TOTAL_SIZE.toString(),
        'Accept-Ranges': 'bytes',
      });
      res.end(sourceBuffer);
      return;
    }

    // Parse Range: bytes=start-end
    const match = rangeHeader.match(/bytes=(\d+)-(\d+)?/);
    if (!match) {
      res.writeHead(416, { 'Content-Range': `bytes */${TOTAL_SIZE}` });
      res.end();
      return;
    }

    const start = Number.parseInt(match[1], 10);
    const end = match[2] ? Number.parseInt(match[2], 10) : TOTAL_SIZE - 1;

    // Simulate a transient error on chunk 1 for retry validation
    if (start === 2 * 1024 * 1024 && failedAttemptsChunk1 < 1) {
      failedAttemptsChunk1++;
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('Transient Google Video CDN Busy');
      return;
    }

    const chunkSlice = sourceBuffer.subarray(start, end + 1);
    res.writeHead(206, {
      'Content-Type': 'video/mp4',
      'Content-Range': `bytes ${start}-${end}/${TOTAL_SIZE}`,
      'Content-Length': chunkSlice.length.toString(),
      'Accept-Ranges': 'bytes',
    });
    res.end(chunkSlice);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as any;
  const mockUrl = `http://127.0.0.1:${address.port}/mock-stream.mp4`;

  try {
    // Test: Parallel chunk streaming with 2MB chunk size across 4 workers
    let progressReports = 0;
    const { stream, metadata } = await createParallelChunkStream({
      url: mockUrl,
      chunkSize: 2 * 1024 * 1024, // 2MB chunks -> 3 total chunks
      concurrency: 4,
      maxChunkRetries: 3,
      onProgress: (p) => {
        progressReports++;
      },
    });

    assert.equal(metadata.contentLength, TOTAL_SIZE, 'Probed content length must match source');
    assert.equal(metadata.acceptRanges, true, 'Accept-Ranges must be true');

    // Collect stream chunks
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }

    const reassembledBuffer = Buffer.concat(chunks);
    assert.equal(reassembledBuffer.length, TOTAL_SIZE, 'Reassembled buffer length must equal original size');

    const reassembledHash = crypto.createHash('sha256').update(reassembledBuffer).digest('hex');
    assert.equal(reassembledHash, sourceHash, 'Reassembled binary SHA-256 hash must be identical to source');

    assert(failedAttemptsChunk1 > 0, 'Transient error simulation must have occurred and retried');
    assert(progressReports > 0, 'Progress callback must have reported telemetry');

    console.log(`✓ Parallel chunk stream reassembled 6MB across workers with SHA256 match (${reassembledHash.substring(0, 16)}...)`);
    console.log('✓ Transient chunk failure retry succeeded transparently');
    console.log('All Multi-Range Parallel Chunk Streaming tests passed successfully!\n');
  } finally {
    server.close();
  }
}

runParallelStreamTests().catch((err) => {
  console.error('Parallel chunk stream test failure:', err);
  process.exit(1);
});
