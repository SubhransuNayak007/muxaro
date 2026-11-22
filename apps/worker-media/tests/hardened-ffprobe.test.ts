/**
 * Unit & Security Regression Tests: Hardened FFprobe & Stream Pipeline Security
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import {
  safeProbeMedia,
  validateSandboxPath,
  parseFps,
  SAFE_FORMAT_NAMES,
  BLOCKED_DEMUXERS,
  MAX_MEDIA_DURATION_SECONDS,
  MAX_MEDIA_WIDTH,
  MAX_MEDIA_HEIGHT,
  MAX_MEDIA_TOTAL_PIXELS,
  MAX_MEDIA_FPS,
} from '../src/security/hardened-ffprobe.js';
import { StreamPipeline } from '../src/stream-pipeline.js';
import { EcoModeEngine } from '../src/eco-mode.js';
import { MuxaroError } from '@muxaro/shared';

describe('Hardened FFprobe - Sandbox Path Validation', () => {
  it('permits valid paths under /sandbox/in/ prefix', () => {
    const safePath = '/sandbox/in/upload-12345.mp4';
    const validated = validateSandboxPath(safePath);
    assert.ok(validated);
  });

  it('permits valid paths under OS temp directory', () => {
    const tmpPath = path.join(os.tmpdir(), 'muxaro-test.mp4');
    const validated = validateSandboxPath(tmpPath);
    assert.equal(path.resolve(validated), path.resolve(tmpPath));
  });

  it('permits explicitly configured allowed base dirs', () => {
    const customDir = path.resolve('tests/custom-sandbox');
    const customPath = path.join(customDir, 'sample.mp4');
    const validated = validateSandboxPath(customPath, {
      allowedBaseDirs: [customDir],
    });
    assert.equal(validated, path.resolve(customPath));
  });

  it('rejects path traversal (..) attempts', () => {
    assert.throws(
      () => validateSandboxPath('/sandbox/in/../../etc/passwd'),
      (err: any) => err instanceof MuxaroError && err.code === 'FORBIDDEN' && err.statusCode === 403
    );
  });

  it('rejects null bytes and control characters', () => {
    assert.throws(
      () => validateSandboxPath('/sandbox/in/video\0.mp4'),
      (err: any) => err instanceof MuxaroError && err.code === 'BAD_REQUEST' && err.statusCode === 400
    );
    assert.throws(
      () => validateSandboxPath('/sandbox/in/video\n.mp4'),
      (err: any) => err instanceof MuxaroError && err.code === 'BAD_REQUEST' && err.statusCode === 400
    );
  });

  it('rejects HTTP/HTTPS/FTP/file URI schemes (SSRF prevention)', () => {
    const ssrfUrls = [
      'http://169.254.169.254/latest/meta-data',
      'https://attacker.com/evil.m3u8',
      'ftp://internal.server/data',
      'file:///etc/passwd',
      'gopher://127.0.0.1:6379/_INFO',
    ];

    for (const url of ssrfUrls) {
      assert.throws(
        () => validateSandboxPath(url),
        (err: any) => err instanceof MuxaroError && (err.code === 'SSRF_BLOCKED' || err.code === 'FORBIDDEN'),
        `Expected ${url} to be rejected`
      );
    }
  });

  it('rejects paths outside allowed sandbox roots', () => {
    const unauthorizedPaths = [
      '/etc/passwd',
      '/var/run/secrets/kubernetes.io',
      path.resolve(process.env.USERPROFILE || 'C:\\Users', 'secret.txt'),
    ];

    for (const p of unauthorizedPaths) {
      assert.throws(
        () => validateSandboxPath(p),
        (err: any) => err instanceof MuxaroError && err.code === 'FORBIDDEN'
      );
    }
  });
});

describe('Hardened FFprobe - Format Whitelist & Demuxer Hardening', () => {
  it('enforces that all SAFE_FORMAT_NAMES are in the safe list', () => {
    const expected = [
      'mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2',
      'matroska', 'webm', 'mp3', 'flac', 'wav',
      'aac', 'ogg', 'avi', 'mpegts'
    ];
    for (const fmt of expected) {
      assert.ok(SAFE_FORMAT_NAMES.has(fmt), `Expected format ${fmt} to be safe`);
    }
  });

  it('blocks dangerous demuxers: hls, applehttp, concat, image2, tty', () => {
    const blocked = ['hls', 'applehttp', 'concat', 'image2', 'image2pipe', 'tty', 'data', 'pipe', 'subfile'];
    for (const demuxer of blocked) {
      assert.ok(BLOCKED_DEMUXERS.has(demuxer), `Expected demuxer ${demuxer} to be blocked`);
    }
  });

  it('rejects HLS playlist files and blocks remote segment SSRF', async () => {
    const testDir = os.tmpdir();
    const hlsFile = path.join(testDir, `test_hls_${Date.now()}.m3u8`);
    const hlsContent = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10.0,',
      'http://169.254.169.254/latest/meta-data/credentials',
    ].join('\n');

    await fs.writeFile(hlsFile, hlsContent, 'utf-8');

    try {
      await assert.rejects(
        () => safeProbeMedia(hlsFile),
        (err: any) => {
          assert.ok(err instanceof MuxaroError);
          assert.equal(err.code, 'UNSUPPORTED_MEDIA');
          assert.equal(err.statusCode, 415);
          return true;
        }
      );
    } finally {
      await fs.unlink(hlsFile).catch(() => {});
    }
  });

  it('rejects concat demuxer script files', async () => {
    const testDir = os.tmpdir();
    const concatFile = path.join(testDir, `test_concat_${Date.now()}.txt`);
    const concatContent = [
      'ffconcat version 1.0',
      'file /sandbox/in/part1.mp4',
      'file /sandbox/in/part2.mp4',
    ].join('\n');

    await fs.writeFile(concatFile, concatContent, 'utf-8');

    try {
      await assert.rejects(
        () => safeProbeMedia(concatFile),
        (err: any) => {
          assert.ok(err instanceof MuxaroError);
          assert.equal(err.statusCode, 415);
          return true;
        }
      );
    } finally {
      await fs.unlink(concatFile).catch(() => {});
    }
  });
});

describe('Hardened FFprobe - Resource Limits & Ceilings', () => {
  it('parses valid fps values and ratios safely', () => {
    assert.equal(parseFps('30/1'), 30);
    assert.equal(parseFps('60/1'), 60);
    assert.equal(parseFps('24000/1001'), 23.98);
    assert.equal(parseFps('29.97'), 29.97);
    assert.equal(parseFps('0/0'), undefined);
    assert.equal(parseFps('invalid'), undefined);
    assert.equal(parseFps(undefined), undefined);
  });

  it('successfully probes a synthetically created legitimate MP4 media file', async () => {
    const testDir = os.tmpdir();
    const testMp4 = path.join(testDir, `valid_test_${Date.now()}.mp4`);

    // Generate a 1-second synthetic 320x240 MP4 with test video/audio using local ffmpeg
    await new Promise<void>((resolve, reject) => {
      const p = spawn('ffmpeg', [
        '-y',
        '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=30',
        '-f', 'lavfi', '-i', 'sine=duration=1:frequency=440',
        '-c:v', 'libx264', '-preset', 'ultrafast',
        '-c:a', 'aac',
        testMp4,
      ], { shell: false });
      p.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg fixture generation failed with exit code ${code}`));
      });
      p.on('error', reject);
    });

    try {
      const probe = await safeProbeMedia(testMp4);
      assert.ok(probe.formatName.includes('mp4') || probe.formatName.includes('mov'));
      assert.ok(probe.durationSeconds >= 0.9 && probe.durationSeconds <= 1.5);
      assert.equal(probe.video?.width, 320);
      assert.equal(probe.video?.height, 240);
      assert.equal(probe.video?.codec, 'h264');
      assert.equal(probe.audio?.codec, 'aac');
    } finally {
      await fs.unlink(testMp4).catch(() => {});
    }
  });

  it('rejects media exceeding 4-hour duration ceiling (14,400s)', () => {
    assert.equal(MAX_MEDIA_DURATION_SECONDS, 14400);
    assert.equal(MAX_MEDIA_WIDTH, 7680);
    assert.equal(MAX_MEDIA_HEIGHT, 4320);
    assert.equal(MAX_MEDIA_TOTAL_PIXELS, 33177600);
    assert.equal(MAX_MEDIA_FPS, 125);
  });
});

describe('StreamPipeline - Hardened FFmpeg Arguments & Limits', () => {
  it('generates -protocol_whitelist pipe for piped inputs', () => {
    const plan = EcoModeEngine.planExecution(
      {
        jobId: 'pipe-test',
        tool: 'convert_video',
        lane: 'fast_io',
        targetFormat: 'mp4',
        ecoMode: true,
        retentionTier: '60m',
      },
      { durationSeconds: 60 }
    );

    const args = StreamPipeline.buildFFmpegArgs('ignored', plan, 'mp4', true);

    const protoIdx = args.indexOf('-protocol_whitelist');
    assert.ok(protoIdx !== -1);
    assert.equal(args[protoIdx + 1], 'pipe');

    const inputIdx = args.indexOf('-i');
    assert.ok(inputIdx !== -1);
    assert.equal(args[inputIdx + 1], 'pipe:0');

    // nostdin should NOT be present for piped input
    assert.equal(args.includes('-nostdin'), false);
  });

  it('generates -protocol_whitelist file,pipe and -nostdin for file inputs', () => {
    const plan = EcoModeEngine.planExecution(
      {
        jobId: 'file-test',
        tool: 'convert_video',
        lane: 'fast_io',
        targetFormat: 'mp4',
        ecoMode: true,
        retentionTier: '60m',
      },
      { durationSeconds: 60 }
    );

    const filePath = '/sandbox/in/movie.mov';
    const args = StreamPipeline.buildFFmpegArgs(filePath, plan, 'mp4', false);

    const protoIdx = args.indexOf('-protocol_whitelist');
    assert.ok(protoIdx !== -1);
    assert.equal(args[protoIdx + 1], 'file,pipe');

    const inputIdx = args.indexOf('-i');
    assert.ok(inputIdx !== -1);
    assert.equal(args[inputIdx + 1], filePath);

    assert.ok(args.includes('-nostdin'));
  });

  it('strictly prohibits network protocols (http, https, tcp, tls, crypto, data) in FFmpeg args', () => {
    const plan = EcoModeEngine.planExecution(
      {
        jobId: 'security-test',
        tool: 'convert_video',
        lane: 'fast_io',
        targetFormat: 'mp4',
        ecoMode: true,
        retentionTier: '60m',
      },
      { durationSeconds: 120 }
    );

    const argsFile = StreamPipeline.buildFFmpegArgs('/sandbox/in/video.mp4', plan, 'mp4', false);
    const argsPipe = StreamPipeline.buildFFmpegArgs('pipe:0', plan, 'mp4', true);

    for (const args of [argsFile, argsPipe]) {
      const protoWhitelist = args[args.indexOf('-protocol_whitelist') + 1];
      assert.ok(!protoWhitelist.includes('http'));
      assert.ok(!protoWhitelist.includes('https'));
      assert.ok(!protoWhitelist.includes('tcp'));
      assert.ok(!protoWhitelist.includes('tls'));
      assert.ok(!protoWhitelist.includes('crypto'));
      assert.ok(!protoWhitelist.includes('data'));
    }
  });

  it('enforces hard limits: -threads 4, -t 14400, and -fs 4294967296', () => {
    const plan = EcoModeEngine.planExecution(
      {
        jobId: 'limits-test',
        tool: 'convert_video',
        lane: 'transcode',
        targetFormat: 'mp4',
        ecoMode: true,
        retentionTier: '24h',
      },
      { durationSeconds: 300 }
    );

    const args = StreamPipeline.buildFFmpegArgs('/sandbox/in/sample.mp4', plan, 'mp4', false);

    // Threads cap
    const threadsIdx = args.indexOf('-threads');
    assert.ok(threadsIdx !== -1);
    assert.equal(args[threadsIdx + 1], '4');

    // 14400s (4h) time ceiling
    const tIdx = args.indexOf('-t');
    assert.ok(tIdx !== -1);
    assert.equal(args[tIdx + 1], '14400');

    // 4 GB file size limit
    const fsIdx = args.indexOf('-fs');
    assert.ok(fsIdx !== -1);
    assert.equal(args[fsIdx + 1], '4294967296');

    // Pipe 1 stdout destination
    assert.equal(args[args.length - 1], 'pipe:1');
  });
});
