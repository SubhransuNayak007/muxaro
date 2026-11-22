/**
 * Unit Tests: Stream Pipeline, Zero-Copy Piping, Age Restriction & Resilient Storage Sink
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable, PassThrough } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { MuxaroError } from '@muxaro/shared';
import {
  StreamPipeline,
  getStorageArtifactPath,
} from '../src/stream-pipeline.js';
import type { MediaJobPayload } from '../src/types.js';

describe('StreamPipeline - Stderr Progress Parsing', () => {
  it('parses out_time_us and speed from FFmpeg stderr progress', () => {
    const stderrSample = [
      'frame=  420',
      'fps= 60.2',
      'out_time_us=60000000', // 60 seconds
      'total_size=15482910',
      'speed= 3.42x',
      'progress=continue',
    ].join('\n');

    const totalDurationSeconds = 120; // 2 minutes
    const parsed = StreamPipeline.parseStderrProgress(stderrSample, totalDurationSeconds);

    assert.ok(parsed !== null);
    assert.equal(parsed.progressPercent, 50.0);
    assert.equal(parsed.speed, '3.42x');
    assert.equal(parsed.processedBytes, 15482910);
    assert.ok(parsed.etaSeconds !== undefined && parsed.etaSeconds > 0);
  });

  it('parses out_time=HH:MM:SS.ms fallback format', () => {
    const stderrSample = 'frame=120 fps=30 out_time=00:01:30.000000 speed= 2.0x';
    const totalDurationSeconds = 180; // 3 minutes

    const parsed = StreamPipeline.parseStderrProgress(stderrSample, totalDurationSeconds);

    assert.ok(parsed !== null);
    assert.equal(parsed.progressPercent, 50.0);
    assert.equal(parsed.speed, '2.0x');
    assert.equal(parsed.etaSeconds, 45); // (180 - 90) / 2.0 = 45s
  });

  it('clamps progress to 99% max while processing is active', () => {
    const stderrSample = 'out_time_us=125000000 speed= 1.0x'; // 125s
    const totalDurationSeconds = 120; // 120s

    const parsed = StreamPipeline.parseStderrProgress(stderrSample, totalDurationSeconds);

    assert.ok(parsed !== null);
    assert.equal(parsed.progressPercent, 99.0);
  });
});

describe('StreamPipeline - Age-Restriction Handling', () => {
  it('identifies "Sign in to confirm your age" in yt-dlp stderr', () => {
    const sample = 'ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm your age. This video may be inappropriate for some users.';
    assert.equal(StreamPipeline.isAgeRestricted(sample), true);
  });

  it('identifies "inappropriate" keyword in yt-dlp stderr', () => {
    const sample = 'ERROR: Content flagged as inappropriate for general audiences.';
    assert.equal(StreamPipeline.isAgeRestricted(sample), true);
  });

  it('identifies "age-restricted" keyword in yt-dlp stderr', () => {
    const sample = 'WARNING: Video is age-restricted and requires authorization.';
    assert.equal(StreamPipeline.isAgeRestricted(sample), true);
  });

  it('returns false for non-age-restricted errors or normal logs', () => {
    const sample = '[download] 100% of 15.42MiB at 4.20MiB/s ETA 00:00';
    assert.equal(StreamPipeline.isAgeRestricted(sample), false);
    assert.equal(StreamPipeline.isAgeRestricted(''), false);
  });

  it('extracts clean error line from yt-dlp stderr', () => {
    const sample = [
      '[youtube] Extracting URL: https://youtube.com/watch?v=123',
      '[youtube] 123: Downloading webpage',
      'ERROR: [youtube] 123: Video unavailable. This video has been removed by the uploader',
    ].join('\n');

    const extracted = StreamPipeline.extractYtDlpErrorMessage(sample);
    assert.ok(extracted.includes('Video unavailable'));
  });
});

describe('StreamPipeline - Resilient Storage Sink & Offline Probing', () => {
  it('resolves correct artifact and direct storage paths with storageKey', () => {
    const { artifactPath, directPath } = getStorageArtifactPath('outputs/guest/test-123.mp4');
    assert.ok(artifactPath.includes(path.normalize('storage/artifacts/outputs/guest/test-123.mp4')));
    assert.ok(directPath.includes(path.normalize('storage/outputs/guest/test-123.mp4')));
  });

  it('detects S3 offline when connection fails with ECONNREFUSED', async () => {
    const mockClient = {
      send: async () => {
        const err: any = new Error('connect ECONNREFUSED 127.0.0.1:9000');
        err.code = 'ECONNREFUSED';
        throw err;
      },
    } as unknown as S3Client;

    const isOffline = await StreamPipeline.checkIfS3Offline(mockClient, 'muxaro-media');
    assert.equal(isOffline, true);
  });

  it('detects S3 offline when connection times out', async () => {
    const mockClient = {
      send: async () => {
        const err: any = new Error('Connection timed out');
        err.code = 'ETIMEDOUT';
        throw err;
      },
    } as unknown as S3Client;

    const isOffline = await StreamPipeline.checkIfS3Offline(mockClient, 'muxaro-media');
    assert.equal(isOffline, true);
  });

  it('detects S3 online when HeadBucket responds with 200 OK', async () => {
    const mockClient = {
      send: async () => {
        return { $metadata: { httpStatusCode: 200 } };
      },
    } as unknown as S3Client;

    const isOffline = await StreamPipeline.checkIfS3Offline(mockClient, 'muxaro-media');
    assert.equal(isOffline, false);
  });

  it('detects S3 online even when bucket returns 403 or 404 (server is reachable)', async () => {
    const mockClient = {
      send: async () => {
        const err: any = new Error('Forbidden');
        err.$metadata = { httpStatusCode: 403 };
        throw err;
      },
    } as unknown as S3Client;

    const isOffline = await StreamPipeline.checkIfS3Offline(mockClient, 'muxaro-media');
    assert.equal(isOffline, false);
  });

  it('writes output stream directly to local disk at storage/artifacts when S3 is offline', async () => {
    const testJobId = `offline-test-${Date.now()}`;
    const retentionTier = '60m';
    const storageKey = `outputs/${retentionTier}/${testJobId}.mp4`;
    const { artifactPath, directPath } = getStorageArtifactPath(storageKey);

    // Mock offline S3 client
    const mockS3Client = {
      send: async () => {
        const err: any = new Error('connect ECONNREFUSED 127.0.0.1:9000');
        err.code = 'ECONNREFUSED';
        throw err;
      },
    } as unknown as S3Client;

    // Generate a valid 1-second synthetic MP4 media file fixture
    const tmpInput = path.join(process.cwd(), `tmp_input_${Date.now()}.mp4`);
    await new Promise<void>((resolve, reject) => {
      const p = spawn(
        'ffmpeg',
        [
          '-y',
          '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=30',
          '-f', 'lavfi', '-i', 'sine=duration=1:frequency=440',
          '-c:v', 'libx264', '-preset', 'ultrafast',
          '-c:a', 'aac',
          tmpInput,
        ],
        { shell: false }
      );
      p.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Failed creating test fixture: ${code}`));
      });
      p.on('error', reject);
    });

    const fileStream = fs.createReadStream(tmpInput);

    // Prepare job payload
    const job: MediaJobPayload = {
      jobId: testJobId,
      tool: 'convert_video',
      lane: 'fast_io',
      targetFormat: 'mp4',
      retentionTier: '60m',
      totalDurationSeconds: 1,
    };

    // Mock redis client
    const mockRedis = {
      publishJobEvent: async () => {},
      updateJobState: async () => {},
    } as any;

    try {
      // Execute stream pipeline with real valid input stream
      const result = await StreamPipeline.execute({
        job,
        inputStream: fileStream,
        s3Client: mockS3Client,
        redisClient: mockRedis,
      });

      assert.equal(result.success, true);
      assert.equal(result.jobId, testJobId);
      assert.equal(result.storageKey, storageKey);
      assert.ok(result.publicUrl?.includes(`/v1/downloads/file/${storageKey}`));

      // Verify artifact exists on local disk at storage/artifacts/${storageKey} with mkdirp
      assert.ok(fs.existsSync(artifactPath), `Artifact must exist at ${artifactPath}`);
      assert.ok(fs.existsSync(directPath), `Direct path must exist at ${directPath}`);
      assert.ok(result.sizeBytes > 0);
    } finally {
      // Clean up test files
      try {
        if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput);
        if (fs.existsSync(artifactPath)) fs.unlinkSync(artifactPath);
        if (fs.existsSync(directPath)) fs.unlinkSync(directPath);
      } catch {}
    }
  });
});

describe('StreamPipeline - SSRF Defense & Routing', () => {
  it('blocks SSRF attempts to private IP ranges before spawning yt-dlp', async () => {
    const job: MediaJobPayload = {
      jobId: 'ssrf-test',
      tool: 'convert_video',
      lane: 'fast_io',
      sourceUrl: 'http://169.254.169.254/latest/meta-data/',
      targetFormat: 'mp4',
      retentionTier: '60m',
    };

    await assert.rejects(
      () => StreamPipeline.execute({ job }),
      (err: any) => {
        assert.ok(err instanceof MuxaroError);
        assert.equal(err.code, 'SSRF_BLOCKED');
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  });

  it('blocks localhost / loopback SSRF attempts', async () => {
    const job: MediaJobPayload = {
      jobId: 'loopback-test',
      tool: 'convert_video',
      lane: 'fast_io',
      sourceUrl: 'http://127.0.0.1:8080/internal.mp4',
      targetFormat: 'mp4',
      retentionTier: '60m',
    };

    await assert.rejects(
      () => StreamPipeline.execute({ job }),
      (err: any) => {
        assert.ok(err instanceof MuxaroError);
        assert.equal(err.code, 'SSRF_BLOCKED');
        return true;
      }
    );
  });

  it('rejects local file path traversal attempts via validateSandboxPath', async () => {
    const job: MediaJobPayload = {
      jobId: 'traversal-test',
      tool: 'convert_video',
      lane: 'fast_io',
      inputStorageKey: '../../etc/passwd',
      targetFormat: 'mp4',
      retentionTier: '60m',
    };

    await assert.rejects(
      () => StreamPipeline.execute({ job }),
      (err: any) => {
        assert.ok(err instanceof MuxaroError);
        assert.equal(err.code, 'FORBIDDEN');
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  });
});
