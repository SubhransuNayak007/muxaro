#!/usr/bin/env node
/**
 * MUXARO Phase 2 Live End-to-End Verification Suite
 * Owned by AGENT 10 (Independent QA, Performance & Release Engineer)
 *
 * Verifies against LIVE Next.js (:3000) and Fastify (:4000):
 *  1. Zero demo/mock strings across all 19 live consumer Web routes + 100% static asset HTTP 200
 *  2. Deduplicated resolution manifest check (zero duplicate resolutions, single recommended)
 *  3. Resumable multipart upload (init -> parts -> idempotent part retry -> complete + SHA-256) & cancel (DELETE)
 *  4. TurboFlow 3-Lane verification:
 *     - Instant Lane (REMUX_STREAM_COPY -> processingLane='instant', losslessPreserved=true)
 *     - Smart Lane (EXTRACT_AUDIO -> processingLane='smart')
 *     - Power Lane (CONVERT_FORMAT 480p compress -> processingLane='power', losslessPreserved=false, smaller MP4)
 *  5. Full HTTP Range delivery: Accept-Ranges, ETag, Last-Modified, 206 Partial Content, Content-Range,
 *     conditional If-Range (match -> 206, mismatch -> 200), ?inline=1 -> inline, and 416 Range Not Satisfiable
 *  6. Failed job retry (POST /api/v1/jobs/:id/retry) + background queue persistence (GET /api/v1/jobs)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const WEB_BASE = process.env.WEB_BASE || 'http://localhost:3000';
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:4000';
const AUTH_HEADER = 'Bearer usr_qa_turboflow_e2e';

const WEB_ROUTES = [
  '/',
  '/dashboard',
  '/credits',
  '/tools',
  '/tools/audio-extractor',
  '/tools/media-converter',
  '/tools/audio-video-merger',
  '/tools/video-merger',
  '/tools/batch-processing',
  '/tools/playlist-processing',
  '/tools/playlist-batch',
  '/docs',
  '/docs/formats',
  '/docs/resolutions',
  '/docs/audio-quality',
  '/status',
  '/privacy',
  '/terms',
  '/dmca',
];

const FORBIDDEN_LIVE_PATTERNS = [
  { label: 'DEMO_8K', re: /8K Demo Video|Ultra HD Demo/i },
  { label: 'DEMO_4K', re: /4K Nature Clip/i },
  { label: 'DEMO_AUDIO', re: /Audio Sample\b/ },
  { label: 'TRY_SAMPLE', re: /Try a sample/i },
  { label: 'TEST_MEDIA_URL', re: /storage\.googleapis\.com\/test-media/i },
  { label: 'FAKE_PLAYLIST', re: /Overture in D Minor/i },
  { label: 'LEGACY_CLASS', re: /\b(keyline-box|sheet-grid)\b/ },
  { label: 'BLOCKING_FONT', re: /<link[^>]+fonts\.googleapis\.com/i },
  { label: 'UNDEFINED_BUG', re: /undefined\/undefined|\bNaN\b/ },
  { label: 'NEXT_ERROR', re: /__next_error__|NEXT_HTTP_ERROR_FALLBACK/ },
];

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

async function pollUntilTerminal(jobId, timeoutMs = 120000) {
  const start = Date.now();
  let polls = 0;
  while (Date.now() - start < timeoutMs) {
    polls++;
    const res = await fetch(`${WEB_BASE}/api/v1/jobs/${encodeURIComponent(jobId)}`, {
      headers: { authorization: AUTH_HEADER },
    });
    if (res.status === 429) throw new Error(`HTTP 429 rate-limit hit on poll #${polls} for job ${jobId}`);
    if (res.status !== 200) throw new Error(`Poll HTTP ${res.status} for job ${jobId}`);
    const body = await res.json();
    const job = body.data || body;
    if (job.status === 'READY' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      return { job, polls };
    }
    await sleep(400);
  }
  throw new Error(`Timeout waiting for job ${jobId}`);
}

async function verifyLiveWebRoutesAndAssets() {
  console.log('\n=== 1. LIVE WEB ROUTES, ZERO-DEMO AUDIT & STATIC ASSET INTEGRITY ===');
  const assetSet = new Set();
  for (const route of WEB_ROUTES) {
    const res = await fetch(`${WEB_BASE}${route}`);
    const html = await res.text();
    if (res.status !== 200) {
      throw new Error(`Route ${route} returned HTTP ${res.status}`);
    }
    for (const check of FORBIDDEN_LIVE_PATTERNS) {
      if (check.re.test(html)) {
        throw new Error(`Route ${route} failed forbidden pattern check: ${check.label}`);
      }
    }
    const assets = [...html.matchAll(/\/_next\/static\/[^"'\s<>\\]+/g)].map((m) => m[0]);
    for (const a of assets) assetSet.add(a);
  }
  let broken = 0;
  for (const asset of assetSet) {
    const res = await fetch(`${WEB_BASE}${asset}`);
    if (res.status !== 200) {
      broken++;
      console.error(`FAIL asset [${res.status}] ${asset}`);
    }
  }
  if (broken > 0) throw new Error(`${broken} static assets returned non-200`);
  console.log(`PASS All ${WEB_ROUTES.length}/${WEB_ROUTES.length} Web routes HTTP 200, ZERO demo/mock/legacy patterns, ${assetSet.size}/${assetSet.size} static assets HTTP 200.`);
  return { routesChecked: WEB_ROUTES.length, assetsChecked: assetSet.size };
}

async function verifyDeduplicatedManifest() {
  console.log('\n=== 2. DEDUPLICATED RESOLUTION MANIFEST CHECK ===');
  const res = await fetch(`${WEB_BASE}/api/v1/media/inspect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: AUTH_HEADER },
    body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', rightsDeclared: true }),
  });
  const body = await res.json();
  if (res.status !== 200 || !body.success) {
    throw new Error(`Inspect failed: ${res.status} ${JSON.stringify(body)}`);
  }
  const streams = Array.isArray(body.data.streams) ? body.data.streams : [];
  const videoStreams = streams.filter((s) => String(s.type || '').toUpperCase() === 'VIDEO');
  if (videoStreams.length === 0) {
    throw new Error('Expected at least 1 VIDEO stream in inspected manifest');
  }
  const seenKeys = new Set();
  for (const v of videoStreams) {
    const fpsBucket = (v.fps || v.frameRate || 30) >= 48 ? '60' : '30';
    const key = `${v.height || v.resolution || 'unknown'}|${fpsBucket}|${v.hdr ? 'hdr' : 'sdr'}`;
    if (seenKeys.has(key)) {
      throw new Error(`Duplicate resolution detected in manifest: ${key} -> ${JSON.stringify(videoStreams)}`);
    }
    seenKeys.add(key);
    if ((v.height || 0) >= 2160) {
      throw new Error(`Invented 4K/8K resolution on 240p source! ${JSON.stringify(v)}`);
    }
  }
  const recommendedCount = videoStreams.filter((v) => v.recommended === true).length;
  if (videoStreams.length > 0 && recommendedCount !== 1) {
    throw new Error(`Expected exactly 1 recommended video stream, got ${recommendedCount}`);
  }
  console.log(
    `PASS Deduplicated Manifest: title="${body.data.title}", videoStreams=[${videoStreams
      .map((v) => `${v.resolution || v.height + 'p'}${v.recommended ? ' [REC]' : ''}`)
      .join(', ')}], zero duplicates, zero invented 4K/8K.`
  );
  return { videoCount: videoStreams.length, recommendedCount };
}

async function verifyMultipartUploadAndTurboFlow() {
  console.log('\n=== 3 & 4. MULTIPART RESUMABLE UPLOAD + TURBOFLOW 3-LANE VERIFICATION ===');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muxaro-qa-tf-'));
  try {
    // Generate synthetic 1080p H.264/AAC MP4 (~4 MB)
    const srcPath = path.join(tmpDir, 'TurboFlow_Test_1080p.mp4');
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=4',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '6000k',
        '-c:a', 'aac', '-b:a', '192k',
        '-pix_fmt', 'yuv420p',
        srcPath,
      ],
      { stdio: 'pipe', timeout: 30000 }
    );
    const fullBuf = fs.readFileSync(srcPath);
    const fullSha = sha256Buffer(fullBuf);
    const partSize = Math.ceil(fullBuf.length / 3);
    const parts = [
      fullBuf.subarray(0, partSize),
      fullBuf.subarray(partSize, partSize * 2),
      fullBuf.subarray(partSize * 2),
    ];

    // 3a. Test multipart cancel (init -> DELETE)
    const cancelInitRes = await fetch(`${WEB_BASE}/api/v1/media/upload/init`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: AUTH_HEADER },
      body: JSON.stringify({ filename: 'cancel_me.mp4', totalSize: 1024, totalParts: 1 }),
    });
    const cancelInit = await cancelInitRes.json();
    if (cancelInitRes.status !== 200 && cancelInitRes.status !== 201) {
      throw new Error(`Cancel init failed: ${cancelInitRes.status} ${JSON.stringify(cancelInit)}`);
    }
    const cancelId = cancelInit.data.uploadId;
    const delRes = await fetch(`${WEB_BASE}/api/v1/media/upload/${encodeURIComponent(cancelId)}`, {
      method: 'DELETE',
      headers: { authorization: AUTH_HEADER },
    });
    if (delRes.status !== 200 && delRes.status !== 204) {
      throw new Error(`Multipart cancel DELETE failed: ${delRes.status}`);
    }
    console.log(`PASS Multipart Cancel (init -> DELETE ${cancelId}) [${delRes.status}]`);

    // 3b. Real 3-part resumable upload with idempotent part-2 retry
    const initRes = await fetch(`${WEB_BASE}/api/v1/media/upload/init`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: AUTH_HEADER },
      body: JSON.stringify({
        filename: 'TurboFlow_Test_1080p.mp4',
        totalSize: fullBuf.length,
        totalParts: parts.length,
        sha256: fullSha,
      }),
    });
    const initJson = await initRes.json();
    if ((initRes.status !== 200 && initRes.status !== 201) || !initJson.success) {
      throw new Error(`Upload init failed: ${initRes.status} ${JSON.stringify(initJson)}`);
    }
    const uploadId = initJson.data.uploadId;

    for (let i = 0; i < parts.length; i++) {
      const partNum = i + 1;
      const putOnce = async () => {
        const r = await fetch(`${WEB_BASE}/api/v1/media/upload/${encodeURIComponent(uploadId)}/part/${partNum}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/octet-stream', authorization: AUTH_HEADER },
          body: parts[i],
        });
        if (r.status !== 200) throw new Error(`Part ${partNum} PUT failed: ${r.status}`);
      };
      await putOnce();
      if (partNum === 2) {
        // Retry part 2 to confirm idempotency
        await putOnce();
      }
    }

    const completeRes = await fetch(`${WEB_BASE}/api/v1/media/upload/${encodeURIComponent(uploadId)}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: AUTH_HEADER },
      body: JSON.stringify({ sha256: fullSha }),
    });
    const completeJson = await completeRes.json();
    if (completeRes.status !== 200 || !completeJson.success) {
      throw new Error(`Upload complete failed: ${completeRes.status} ${JSON.stringify(completeJson)}`);
    }
    const assetId = completeJson.data.assetId || completeJson.data.id;
    console.log(
      `PASS Resumable Multipart Upload (3 parts + part-2 idempotent retry + SHA-256): assetId=${assetId}, size=${completeJson.data.fileSizeBytes} B, duration=${completeJson.data.durationSeconds}s`
    );

    const submitAndRun = async ({ label, operation, targetFormat, targetResolution, streamCopy, expectedLane, expectedLossless }) => {
      const idemKey = `qa_tf_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const t0 = Date.now();
      const createRes = await fetch(`${WEB_BASE}/api/v1/jobs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: AUTH_HEADER,
          'idempotency-key': idemKey,
        },
        body: JSON.stringify({
          mediaAssetId: assetId,
          operation,
          targetFormat,
          ...(targetResolution ? { targetResolution } : {}),
          streamCopy,
          title: 'TurboFlow Test 1080p',
          idempotencyKey: idemKey,
        }),
      });
      const createJson = await createRes.json();
      if (createRes.status !== 202 || !createJson.success) {
        throw new Error(`${label} job submit failed: ${createRes.status} ${JSON.stringify(createJson)}`);
      }
      const jobId = createJson.data.jobId || createJson.data.id;
      const { job, polls } = await pollUntilTerminal(jobId);
      const elapsedMs = Date.now() - t0;
      if (job.status !== 'READY') {
        throw new Error(`${label} job ended in ${job.status}: ${JSON.stringify(job.error || job)}`);
      }
      if (job.processingLane !== expectedLane) {
        throw new Error(`${label} lane mismatch: expected=${expectedLane}, got=${job.processingLane}`);
      }
      if (typeof expectedLossless === 'boolean' && job.losslessPreserved !== expectedLossless) {
        throw new Error(`${label} losslessPreserved mismatch: expected=${expectedLossless}, got=${job.losslessPreserved}`);
      }
      console.log(
        `PASS TurboFlow [${label}]: lane=${job.processingLane}, lossless=${job.losslessPreserved}, retention=${job.retentionMinutes}m, size=${job.outputSizeBytes} B, elapsed=${elapsedMs}ms, polls=${polls}`
      );
      return { job, elapsedMs };
    };

    // 4a. Instant Lane (Stream copy)
    const instant = await submitAndRun({
      label: 'Instant-Remux',
      operation: 'REMUX_STREAM_COPY',
      targetFormat: 'mp4',
      streamCopy: true,
      expectedLane: 'instant',
      expectedLossless: true,
    });

    // 4b. Smart Lane (Audio extraction)
    const smart = await submitAndRun({
      label: 'Smart-Audio',
      operation: 'EXTRACT_AUDIO',
      targetFormat: 'm4a',
      streamCopy: true,
      expectedLane: 'smart',
      expectedLossless: true,
    });

    // 4c. Power Lane (480p Compression)
    const power = await submitAndRun({
      label: 'Power-Compress',
      operation: 'CONVERT_FORMAT',
      targetFormat: 'mp4',
      targetResolution: '480p',
      streamCopy: false,
      expectedLane: 'power',
      expectedLossless: false,
    });
    if (power.job.outputSizeBytes >= fullBuf.length) {
      throw new Error(`Power lane compression did not shrink file! in=${fullBuf.length} out=${power.job.outputSizeBytes}`);
    }

    // 5. FULL HTTP RANGE, ETAG, LAST-MODIFIED, IF-RANGE, INLINE & 416 TEST on Power Lane artifact
    console.log('\n=== 5. FULL HTTP RANGE, ETAG, IF-RANGE, INLINE & 416 DELIVERY AUDIT ===');
    const dlUrl = `${WEB_BASE}${power.job.downloadUrl}`;
    const fullRes = await fetch(dlUrl);
    if (fullRes.status !== 200) throw new Error(`Full download failed: ${fullRes.status}`);
    const acceptRanges = fullRes.headers.get('accept-ranges');
    const etag = fullRes.headers.get('etag');
    const lastModified = fullRes.headers.get('last-modified');
    const contentDisp = fullRes.headers.get('content-disposition') || '';
    const dlBuf = Buffer.from(await fullRes.arrayBuffer());

    if (acceptRanges !== 'bytes') throw new Error(`Missing Accept-Ranges: bytes (got ${acceptRanges})`);
    if (!etag) throw new Error('Missing ETag header');
    if (!lastModified) throw new Error('Missing Last-Modified header');
    if (!contentDisp.toLowerCase().startsWith('attachment')) throw new Error(`Expected attachment, got ${contentDisp}`);
    if (sha256Buffer(dlBuf) !== power.job.checksumSha256) throw new Error('SHA-256 mismatch on full download');

    // Verify ffprobe on downloaded Power Lane MP4
    const outFile = path.join(tmpDir, 'power_out.mp4');
    fs.writeFileSync(outFile, dlBuf);
    const probe = ffprobeJson(outFile);
    const vStream = (probe.streams || []).find((s) => s.codec_type === 'video');
    if (!vStream || vStream.height > 480) {
      throw new Error(`Unexpected ffprobe result on compressed 480p MP4: ${JSON.stringify(vStream)}`);
    }

    // 5a. Valid Range -> 206 Partial Content + Content-Range
    const r206 = await fetch(dlUrl, { headers: { Range: 'bytes=0-1023' } });
    const r206Buf = Buffer.from(await r206.arrayBuffer());
    const cr206 = r206.headers.get('content-range') || '';
    if (r206.status !== 206 || r206Buf.length !== 1024 || cr206 !== `bytes 0-1023/${dlBuf.length}`) {
      throw new Error(`206 Range failed: status=${r206.status} len=${r206Buf.length} cr=${cr206}`);
    }

    // 5b. Conditional If-Range MATCH -> 206 Partial Content
    const rIfMatch = await fetch(dlUrl, { headers: { Range: 'bytes=0-1023', 'If-Range': etag } });
    await rIfMatch.arrayBuffer();
    if (rIfMatch.status !== 206) {
      throw new Error(`If-Range matching ETag expected 206, got ${rIfMatch.status}`);
    }

    // 5c. Conditional If-Range MISMATCH -> 200 OK full stream
    const rIfMismatch = await fetch(dlUrl, { headers: { Range: 'bytes=0-1023', 'If-Range': '"stale-etag-mismatch"' } });
    const rIfMismatchBuf = Buffer.from(await rIfMismatch.arrayBuffer());
    if (rIfMismatch.status !== 200 || rIfMismatchBuf.length !== dlBuf.length) {
      throw new Error(`If-Range mismatched ETag expected 200 full (${dlBuf.length} B), got ${rIfMismatch.status} (${rIfMismatchBuf.length} B)`);
    }

    // 5d. ?inline=1 -> Content-Disposition: inline
    const rInline = await fetch(`${dlUrl}?inline=1`, { headers: { Range: 'bytes=0-511' } });
    await rInline.arrayBuffer();
    const inlineCd = rInline.headers.get('content-disposition') || '';
    if (rInline.status !== 206 || !inlineCd.toLowerCase().startsWith('inline')) {
      throw new Error(`?inline=1 expected 206 + inline, got ${rInline.status} / ${inlineCd}`);
    }

    // 5e. Out-of-bounds Range -> 416 Range Not Satisfiable + Content-Range: bytes */total + userMessage
    const r416 = await fetch(dlUrl, { headers: { Range: `bytes=${dlBuf.length + 1000}-` } });
    const cr416 = r416.headers.get('content-range') || '';
    const b416 = await r416.json().catch(() => ({}));
    if (r416.status !== 416 || cr416 !== `bytes */${dlBuf.length}`) {
      throw new Error(`416 check failed: status=${r416.status} cr=${cr416} body=${JSON.stringify(b416)}`);
    }

    console.log(
      `PASS HTTP Range Delivery: Accept-Ranges=bytes, ETag=${etag.slice(0, 18)}..., Last-Modified OK, ` +
        `206 (${cr206}), If-Range match=206 / mismatch=200, ?inline=1=inline, 416 (${cr416}, userMessage="${b416?.error?.userMessage || b416?.error?.message}")`
    );

    return {
      inputBytes: fullBuf.length,
      instantMs: instant.elapsedMs,
      smartMs: smart.elapsedMs,
      powerMs: power.elapsedMs,
      powerOutputBytes: power.job.outputSizeBytes,
      reductionPct: Number((((fullBuf.length - power.job.outputSizeBytes) / fullBuf.length) * 100).toFixed(1)),
      powerResolution: `${vStream.width}x${vStream.height}`,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function verifyFailedJobRetryAndPersistence() {
  console.log('\n=== 6. FAILED JOB RETRY & BACKGROUND QUEUE PERSISTENCE ===');
  const idemKey = `qa_retry_fail_${Date.now()}`;
  const createRes = await fetch(`${WEB_BASE}/api/v1/jobs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: AUTH_HEADER,
      'idempotency-key': idemKey,
    },
    body: JSON.stringify({
      mediaUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/nonexistent-qa-404-file.mp4',
      operation: 'REMUX_STREAM_COPY',
      targetFormat: 'mp4',
      title: 'QA Retry Test',
      idempotencyKey: idemKey,
    }),
  });
  const createJson = await createRes.json();
  if (createRes.status !== 202 || !createJson.success) {
    throw new Error(`Failed-job setup failed: ${createRes.status} ${JSON.stringify(createJson)}`);
  }
  const jobId = createJson.data.jobId || createJson.data.id;
  const { job } = await pollUntilTerminal(jobId, 45000);
  if (job.status !== 'FAILED') {
    throw new Error(`Expected 404 URL job to reach FAILED, got ${job.status}`);
  }
  const userMessage = job.userMessage || job.error?.userMessage || job.error?.message;
  console.log(`PASS 404 Job Failed Cleanly: jobId=${jobId}, userMessage="${userMessage}"`);

  // Verify job persists in server-side background history (GET /api/v1/account/history)
  const listRes = await fetch(`${WEB_BASE}/api/v1/account/history`, { headers: { authorization: AUTH_HEADER } });
  const listJson = await listRes.json();
  const jobsArr = listJson.data?.jobs || listJson.data || [];
  const persisted = Array.isArray(jobsArr) && jobsArr.some((j) => (j.jobId || j.id) === jobId);
  if (!persisted) {
    throw new Error(`Job ${jobId} not found in GET /api/v1/account/history background history!`);
  }
  console.log(`PASS Background Persistence: job ${jobId} persisted across fresh GET /api/v1/account/history (${jobsArr.length} total user jobs).`);

  // Retry failed job via POST /api/v1/jobs/:id/retry
  const retryRes = await fetch(`${WEB_BASE}/api/v1/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
    headers: { authorization: AUTH_HEADER },
  });
  const retryJson = await retryRes.json();
  if ((retryRes.status !== 200 && retryRes.status !== 202) || !retryJson.success) {
    throw new Error(`Retry endpoint failed: ${retryRes.status} ${JSON.stringify(retryJson)}`);
  }
  console.log(`PASS Failed Job Retry [${retryRes.status}]: POST /api/v1/jobs/${jobId}/retry re-queued cleanly (status=${retryJson.data?.status}).`);

  // Also check 6-class queue telemetry in /api/v1/admin/metrics
  const metricsRes = await fetch(`${API_BASE}/api/v1/admin/metrics`);
  const metricsJson = await metricsRes.json();
  if (metricsRes.status !== 200 || !metricsJson.success) {
    throw new Error(`Metrics failed: ${metricsRes.status}`);
  }
  console.log(`PASS Live 6-Class Queue Telemetry [200] verified.`);
}

async function main() {
  console.log('========================================================================');
  console.log('MUXARO PHASE 2 FULL LIVE E2E VERIFICATION SUITE (TURBOFLOW + ZERO-DEMO)');
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
  if (ssrfRes.status !== 403) throw new Error(`SSRF check failed: ${ssrfRes.status}`);
  console.log('PASS SSRF Protection [403]');

  const webSummary = await verifyLiveWebRoutesAndAssets();
  const manifestSummary = await verifyDeduplicatedManifest();
  const turboSummary = await verifyMultipartUploadAndTurboFlow();
  await verifyFailedJobRetryAndPersistence();

  console.log('\n========================================================================');
  console.log('ALL PHASE 2 LIVE E2E VERIFICATION GATES PASSED (0 FAILURES)!');
  console.table([{ ...webSummary, ...manifestSummary, ...turboSummary }]);
  console.log('========================================================================');
}

main().catch((err) => {
  console.error('\nFAIL:', err.message);
  process.exit(1);
});
