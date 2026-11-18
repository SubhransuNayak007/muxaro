#!/usr/bin/env node
/**
 * MUXARO Live End-to-End Media Pipeline Verifier (v2.1 — Consumer Upload, Compression, Inline Preview & Rate-Limit Resilience)
 * Owned by AGENT 10 (Independent QA, Performance & Release Engineer)
 *
 * Tests ALL flows through the live Next.js proxy (http://localhost:3000/api/v1/*) -> Fastify (:4000):
 *  0. Live health & SSRF 403 block
 *  1. Local computer MP4 upload (POST /api/v1/media/upload) -> Compress (CONVERT_FORMAT 480p MP4) -> smaller playable MP4 verified by ffprobe
 *  2. YouTube URL (Me at the zoo) -> MP4 video download with rapid polling (0 HTTP 429 errors!) -> playable MP4 verified by ffprobe
 *  3. Content-Disposition check: default = `attachment`, `?inline=1` = `inline` + HTTP 206 Range streaming
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const WEB_BASE = process.env.WEB_BASE || 'http://localhost:3000';
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:4000';
const AUTH_HEADER = 'Bearer usr_qa_e2e_v21';

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function ffprobeJson(filePath) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath],
    { encoding: 'utf8', timeout: 15000 }
  );
  return JSON.parse(out);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollUntilTerminal(baseUrl, jobId, { pollIntervalMs = 500, timeoutMs = 150000 } = {}) {
  const start = Date.now();
  let lastStatus = '';
  let lastProgress = -1;
  let pollCount = 0;
  let rateLimitHits = 0;

  while (Date.now() - start < timeoutMs) {
    pollCount++;
    const res = await fetch(`${baseUrl}/api/v1/jobs/${encodeURIComponent(jobId)}`, {
      headers: { authorization: AUTH_HEADER },
    });
    if (res.status === 429) {
      rateLimitHits++;
      throw new Error(`HTTP 429 Rate Limit hit on GET /api/v1/jobs/${jobId} at poll #${pollCount}!`);
    }
    if (res.status !== 200) {
      throw new Error(`Poll failed: HTTP ${res.status} on job ${jobId}`);
    }
    const body = await res.json();
    const job = body.data || body;
    if (job.status !== lastStatus || job.progress !== lastProgress) {
      console.log(`   [poll #${pollCount}] job=${jobId} status=${job.status} progress=${job.progress}% stage=${job.stageMessage || job.stage || ''}`);
      lastStatus = job.status;
      lastProgress = job.progress;
    }
    if (job.status === 'READY' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      return { job, pollCount, rateLimitHits };
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for job ${jobId} to reach terminal state`);
}

async function verifyDownloadAndInline(downloadUrl, jobId, expectedSha, expectedSize, tmpDir, fallbackExt) {
  // 1. Default download -> Content-Disposition: attachment
  const dlUrlFull = `${WEB_BASE}${downloadUrl.startsWith('/') ? downloadUrl : '/' + downloadUrl}`;
  const res = await fetch(dlUrlFull, { headers: { authorization: AUTH_HEADER } });
  if (res.status !== 200) {
    throw new Error(`Download failed: HTTP ${res.status} for ${dlUrlFull}`);
  }
  const ct = res.headers.get('content-type') || '';
  const cd = res.headers.get('content-disposition') || '';
  if (!cd.toLowerCase().startsWith('attachment')) {
    throw new Error(`Expected Content-Disposition: attachment on default download, got "${cd}"`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const headAscii = buf.subarray(0, 128).toString('utf8');
  if (headAscii.includes('MUXARO VERIFIED MEDIA ARTIFACT') || headAscii.includes('MUXARO Media Delivery Artifact') || ct.startsWith('text/')) {
    throw new Error(`Fake text receipt returned instead of binary! ct=${ct}`);
  }
  const actualSha = sha256Buffer(buf);
  if (expectedSha && actualSha !== expectedSha) {
    throw new Error(`SHA-256 mismatch: expected=${expectedSha} actual=${actualSha}`);
  }
  if (expectedSize && buf.length !== expectedSize) {
    throw new Error(`Size mismatch: expected=${expectedSize} actual=${buf.length}`);
  }
  console.log(`PASS Default Download [200]: ${buf.length} bytes, Content-Type="${ct}", Content-Disposition="${cd}", SHA-256 MATCH`);

  // 2. Inline preview (?inline=1) -> Content-Disposition: inline + HTTP 206 Range
  const inlineSep = dlUrlFull.includes('?') ? '&' : '?';
  const inlineUrl = `${dlUrlFull}${inlineSep}inline=1`;
  const inlineRes = await fetch(inlineUrl, {
    headers: { Range: 'bytes=0-1023' },
  });
  const inlineCd = inlineRes.headers.get('content-disposition') || '';
  const inlineBuf = Buffer.from(await inlineRes.arrayBuffer());
  if (inlineRes.status !== 206 || inlineBuf.length !== 1024) {
    throw new Error(`Inline Range request failed: status=${inlineRes.status}, len=${inlineBuf.length}`);
  }
  if (!inlineCd.toLowerCase().startsWith('inline')) {
    throw new Error(`Expected Content-Disposition: inline for ?inline=1, got "${inlineCd}"`);
  }
  console.log(`PASS Inline Preview (?inline=1) [206 Partial Content]: 1024 bytes, Content-Disposition="${inlineCd}"`);

  // Save for ffprobe
  const outPath = path.join(tmpDir, `verified_${jobId}.${fallbackExt}`);
  fs.writeFileSync(outPath, buf);
  return { outPath, sizeBytes: buf.length, contentType: ct, sha256: actualSha, attachmentCd: cd, inlineCd };
}

async function testLocalUploadAndCompress() {
  console.log('\n=== TEST 1: LOCAL COMPUTER MP4 UPLOAD -> COMPRESS -> SMALLER PLAYABLE MP4 ===');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muxaro-qa-upload-'));
  try {
    // Generate a high-bitrate synthetic 1080p MP4 (4 seconds) with FFmpeg so compression clearly shrinks it
    const sourceMp4 = path.join(tmpDir, 'My_Holiday_Clip_1080p.mp4');
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=4',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '6000k',
        '-c:a', 'aac', '-b:a', '192k',
        '-pix_fmt', 'yuv420p',
        sourceMp4,
      ],
      { stdio: 'pipe', timeout: 30000 }
    );
    const sourceBuf = fs.readFileSync(sourceMp4);
    console.log(`Generated synthetic local 1080p MP4: ${sourceBuf.length} bytes (${(sourceBuf.length / 1024 / 1024).toFixed(2)} MB)`);

    // 1. Upload via Next.js proxy POST /api/v1/media/upload
    const uploadRes = await fetch(`${WEB_BASE}/api/v1/media/upload`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-file-name': encodeURIComponent('My_Holiday_Clip_1080p.mp4'),
        authorization: AUTH_HEADER,
      },
      body: sourceBuf,
    });
    const uploadJson = await uploadRes.json();
    if (uploadRes.status !== 200 || !uploadJson.success) {
      throw new Error(`Upload failed: status=${uploadRes.status} body=${JSON.stringify(uploadJson)}`);
    }
    const asset = uploadJson.data;
    const assetId = asset.assetId || asset.id;
    console.log(`PASS Local Upload [200]: assetId=${assetId}, title="${asset.title}", duration=${asset.durationSeconds}s, size=${asset.fileSizeBytes} bytes`);

    // 2. Submit compression job (CONVERT_FORMAT, 480p, mp4, NO mediaUrl — only mediaAssetId!)
    const idemKey = `qa_compress_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const createRes = await fetch(`${WEB_BASE}/api/v1/jobs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: AUTH_HEADER,
        'idempotency-key': idemKey,
      },
      body: JSON.stringify({
        mediaAssetId: assetId,
        operation: 'CONVERT_FORMAT',
        targetFormat: 'mp4',
        targetResolution: '480p',
        streamCopy: false,
        title: asset.title || 'My Holiday Clip 1080p',
        idempotencyKey: idemKey,
      }),
    });
    const createJson = await createRes.json();
    if (createRes.status !== 202 || !createJson.success) {
      throw new Error(`Compression job creation failed: status=${createRes.status} body=${JSON.stringify(createJson)}`);
    }
    const jobId = createJson.data.jobId || createJson.data.id;
    console.log(`PASS Compress Job Submitted [202]: jobId=${jobId}`);

    // 3. Poll rapidly (500ms) until READY — also confirms 0 HTTP 429 rate-limit errors!
    const { job, pollCount, rateLimitHits } = await pollUntilTerminal(WEB_BASE, jobId, { pollIntervalMs: 500 });
    if (job.status !== 'READY') {
      throw new Error(`Compress job ended in ${job.status}: ${JSON.stringify(job.error || job)}`);
    }
    const downloadUrl = job.downloadUrl || `/api/v1/jobs/${encodeURIComponent(jobId)}/download`;
    const dl = await verifyDownloadAndInline(
      downloadUrl,
      jobId,
      job.checksumSha256 || job.artifact?.checksumSha256,
      job.outputSizeBytes || job.artifact?.sizeBytes,
      tmpDir,
      'mp4'
    );

    if (dl.sizeBytes >= sourceBuf.length) {
      throw new Error(`Compression did not reduce file size! input=${sourceBuf.length} output=${dl.sizeBytes}`);
    }
    const reductionPct = (((sourceBuf.length - dl.sizeBytes) / sourceBuf.length) * 100).toFixed(1);

    const probe = ffprobeJson(dl.outPath);
    const vStream = (probe.streams || []).find((s) => s.codec_type === 'video');
    const aStream = (probe.streams || []).find((s) => s.codec_type === 'audio');
    const duration = Number(probe.format?.duration || 0);
    if (!vStream || !Number.isFinite(duration) || duration <= 0) {
      throw new Error(`Compressed MP4 failed ffprobe: ${JSON.stringify(probe)}`);
    }
    console.log(
      `PASS Compressed MP4 Verified by ffprobe: ${sourceBuf.length} B -> ${dl.sizeBytes} B (-${reductionPct}%), ` +
        `${vStream.width}x${vStream.height} ${vStream.codec_name}/${aStream?.codec_name || 'none'}, duration=${duration.toFixed(2)}s, polls=${pollCount}, 429s=${rateLimitHits}`
    );

    return {
      test: 'Local MP4 Upload -> 480p Compress',
      inputBytes: sourceBuf.length,
      outputBytes: dl.sizeBytes,
      reduction: `-${reductionPct}%`,
      filename: job.outputFilename,
      resolution: `${vStream.width}x${vStream.height}`,
      durationSeconds: Number(duration.toFixed(2)),
      polls: pollCount,
      rateLimit429s: rateLimitHits,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testYoutubeVideoAndPolling() {
  console.log('\n=== TEST 2: YOUTUBE URL -> MP4 VIDEO DOWNLOAD + RAPID POLLING (0 HTTP 429) ===');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muxaro-qa-yt-'));
  try {
    const mediaUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
    const inspectRes = await fetch(`${WEB_BASE}/api/v1/media/inspect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: AUTH_HEADER },
      body: JSON.stringify({ url: mediaUrl, rightsDeclared: true }),
    });
    const inspectJson = await inspectRes.json();
    if (inspectRes.status !== 200 || !inspectJson.success) {
      throw new Error(`YouTube inspect failed: ${inspectRes.status} ${JSON.stringify(inspectJson)}`);
    }
    console.log(`PASS YouTube Inspect [200]: title="${inspectJson.data.title}", duration=${inspectJson.data.durationSeconds}s`);

    const idemKey = `qa_yt_mp4_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const createRes = await fetch(`${WEB_BASE}/api/v1/jobs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: AUTH_HEADER,
        'idempotency-key': idemKey,
      },
      body: JSON.stringify({
        mediaUrl,
        operation: 'REMUX_STREAM_COPY',
        targetFormat: 'mp4',
        title: inspectJson.data.title,
        streamCopy: true,
        idempotencyKey: idemKey,
      }),
    });
    const createJson = await createRes.json();
    if (createRes.status !== 202 || !createJson.success) {
      throw new Error(`YouTube job submit failed: ${createRes.status} ${JSON.stringify(createJson)}`);
    }
    const jobId = createJson.data.jobId || createJson.data.id;
    console.log(`PASS YouTube MP4 Job Submitted [202]: jobId=${jobId}`);

    // Rapid 300ms polling + burst of 25 consecutive status polls to prove GET /jobs/:id NEVER returns 429!
    const { job, pollCount, rateLimitHits } = await pollUntilTerminal(WEB_BASE, jobId, { pollIntervalMs: 300 });
    if (job.status !== 'READY') {
      throw new Error(`YouTube MP4 job ended in ${job.status}: ${JSON.stringify(job.error || job)}`);
    }
    for (let i = 0; i < 25; i++) {
      const burstRes = await fetch(`${WEB_BASE}/api/v1/jobs/${encodeURIComponent(jobId)}`, {
        headers: { authorization: AUTH_HEADER },
      });
      if (burstRes.status !== 200) {
        throw new Error(`Burst poll #${i + 1} failed with HTTP ${burstRes.status} (expected 200, no 429!)`);
      }
    }
    console.log(`PASS Polling Rate-Limit Stress Check: ${pollCount} live polls + 25 burst polls -> ZERO HTTP 429 errors!`);

    const downloadUrl = job.downloadUrl || `/api/v1/jobs/${encodeURIComponent(jobId)}/download`;
    const dl = await verifyDownloadAndInline(
      downloadUrl,
      jobId,
      job.checksumSha256 || job.artifact?.checksumSha256,
      job.outputSizeBytes || job.artifact?.sizeBytes,
      tmpDir,
      'mp4'
    );

    const probe = ffprobeJson(dl.outPath);
    const vStream = (probe.streams || []).find((s) => s.codec_type === 'video');
    const aStream = (probe.streams || []).find((s) => s.codec_type === 'audio');
    const duration = Number(probe.format?.duration || 0);
    if (!vStream || !Number.isFinite(duration) || duration <= 0) {
      throw new Error(`YouTube MP4 failed ffprobe: ${JSON.stringify(probe)}`);
    }
    console.log(
      `PASS YouTube MP4 Verified by ffprobe: filename="${job.outputFilename}", ${dl.sizeBytes} B, ` +
        `${vStream.width}x${vStream.height} ${vStream.codec_name}/${aStream?.codec_name || 'none'}, duration=${duration.toFixed(2)}s`
    );

    return {
      test: 'YouTube URL -> MP4 Video + Burst Poll',
      inputBytes: null,
      outputBytes: dl.sizeBytes,
      reduction: 'N/A',
      filename: job.outputFilename,
      resolution: `${vStream.width}x${vStream.height}`,
      durationSeconds: Number(duration.toFixed(2)),
      polls: pollCount + 25,
      rateLimit429s: rateLimitHits,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  console.log('========================================================================');
  console.log('MUXARO LIVE E2E VERIFICATION (UPLOAD, COMPRESSION, INLINE PREVIEW, 0 429)');
  console.log(`Web Proxy: ${WEB_BASE}  |  API: ${API_BASE}`);
  console.log('========================================================================');

  const healthRes = await fetch(`${WEB_BASE}/api/v1/health`);
  if (healthRes.status !== 200) throw new Error(`Health failed: ${healthRes.status}`);
  console.log('PASS Live Proxy Health [200]');

  const ssrfRes = await fetch(`${WEB_BASE}/api/v1/media/inspect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: AUTH_HEADER },
    body: JSON.stringify({ url: 'http://127.0.0.1/secret.mp4', rightsDeclared: true }),
  });
  if (ssrfRes.status !== 403) throw new Error(`SSRF failed: expected 403, got ${ssrfRes.status}`);
  console.log('PASS SSRF Protection [403]');

  const results = [];
  results.push(await testLocalUploadAndCompress());
  results.push(await testYoutubeVideoAndPolling());

  console.log('\n========================================================================');
  console.log('ALL LIVE E2E VERIFICATION TESTS PASSED!');
  console.table(results);
  console.log('========================================================================');
}

main().catch((err) => {
  console.error('\nFAIL:', err.message);
  process.exit(1);
});
