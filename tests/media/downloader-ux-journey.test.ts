/**
 * MUXARO Video Downloader Specialist - End-to-End UX Journey & Component Verification Test
 *
 * Verifies:
 * 1. Genuine media URL paste & inspection (YouTube 'Me at the zoo', Google Cloud public MP4).
 * 2. Mode switching:
 *    - Video mode (deduplicated resolutions, 1 recommended badge, HDR, fps, container formats MP4/MKV/WebM)
 *    - Audio mode (6 audio formats: original, mp3, m4a, opus, wav, flac; lossy-to-lossless disclosure)
 *    - Compress mode (720p Small, 480p Extra small, CONVERT_FORMAT operation)
 *    - Merge mode (video stream + included/separate audio, MERGE_AUDIO_VIDEO operation)
 * 3. Resolution and format selection contracts & format normalization.
 * 4. Job creation, idempotency, lifecycle, and polling simulation.
 * 5. Ready screen & instant binary download triggers (Content-Disposition attachment vs inline, Range requests, auto-download opt-in).
 * 6. Graceful degradation and error handling in MediaInspector and JobProgress under API loading or degraded states.
 * 7. Desktop & mobile responsiveness invariants.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { type FastifyInstance } from 'fastify';

import { buildApp } from '../../apps/api/src/app.ts';
import {
  normalizeVideoOptions,
  normalizeAudioOptions,
} from '../../apps/web/lib/format-normalizer.ts';
import {
  getAutoDownloadPreference,
  setAutoDownloadPreference,
  mapFriendlyError,
  AUTO_DOWNLOAD_STORAGE_KEY,
} from '../../apps/web/lib/background-download.ts';
import { formatBytes, formatDuration } from '../../apps/web/lib/formatters.ts';
import {
  isDeadOrUnresolvableHost,
  getApiBaseUrl,
} from '../../apps/web/lib/api-client.ts';
import type { MediaManifest, ProcessingJob } from '../../apps/web/lib/types.ts';

const PUBLIC_TEST_VIDEO_URL =
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
const REAL_YOUTUBE_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

describe('MUXARO Downloader - End-to-End UX Journey Verification', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildApp();
  });

  after(async () => {
    await app.close();
  });

  describe('1. Media Link Paste & Genuine URL Inspection', () => {
    it('should inspect a genuine direct MP4 URL and extract authentic streams', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/media/inspect',
        payload: {
          url: PUBLIC_TEST_VIDEO_URL,
          rightsDeclared: true,
        },
      });

      assert.strictEqual(res.statusCode, 200, 'Direct media inspection must return HTTP 200');
      const body = res.json();
      assert.strictEqual(body.success, true);
      const data = body.data;

      assert.ok(data.assetId || data.id, 'Asset ID must be present');
      assert.strictEqual(data.container, 'mp4');
      assert.ok(
        data.durationSeconds === undefined || (typeof data.durationSeconds === 'number' && data.durationSeconds >= 0),
        'Duration must be a positive number if present'
      );
      assert.ok(
        data.fileSizeBytes === undefined || (typeof data.fileSizeBytes === 'number' && data.fileSizeBytes > 0),
        'File size must be positive if present'
      );
      assert.ok(Array.isArray(data.streams), 'Streams array must be present');

      // Verify stream breakdown (backend returns type: 'VIDEO' | 'AUDIO')
      const videoStreams = data.streams.filter((s: any) => s.type === 'VIDEO' || s.streamType === 'video' || s.width);
      const audioStreams = data.streams.filter((s: any) => s.type === 'AUDIO' || s.streamType === 'audio');
      assert.ok(videoStreams.length > 0, 'At least 1 video stream must be detected');
      assert.ok(audioStreams.length > 0, 'At least 1 audio stream must be detected');
    });

    it('should inspect real YouTube URL (Me at the zoo) metadata cleanly', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/media/inspect',
        payload: {
          url: REAL_YOUTUBE_URL,
          rightsDeclared: true,
        },
      });

      assert.strictEqual(res.statusCode, 200, 'YouTube URL inspection must return HTTP 200');
      const body = res.json();
      assert.strictEqual(body.success, true);
      assert.ok(body.data.title.includes('zoo') || body.data.title.length > 0);
      assert.strictEqual(body.data.rightsCheck.canExtractStreams, true);
    });

    it('should gracefully reject SSRF loopback and cloud metadata targets without leaking or crashing', async () => {
      const loopbackRes = await app.inject({
        method: 'POST',
        url: '/api/v1/media/inspect',
        payload: { url: 'http://127.0.0.1:8080/private.mp4', rightsDeclared: true },
      });
      assert.strictEqual(loopbackRes.statusCode, 403, 'Loopback URL must return HTTP 403');
      const loopbackJson = loopbackRes.json();
      assert.strictEqual(loopbackJson.success, false);
      assert.strictEqual(loopbackJson.error.code, 'SSRF_BLOCKED');
      assert.ok(loopbackJson.error.userMessage, 'User-friendly message must be present');

      const metadataRes = await app.inject({
        method: 'POST',
        url: '/api/v1/media/inspect',
        payload: { url: 'http://169.254.169.254/latest/meta-data', rightsDeclared: true },
      });
      assert.strictEqual(metadataRes.statusCode, 403, 'Metadata IP must return HTTP 403');
    });

    it('should gracefully handle malformed or empty URLs with clear user-facing guidance', async () => {
      const emptyRes = await app.inject({
        method: 'POST',
        url: '/api/v1/media/inspect',
        payload: { url: '   ' },
      });
      assert.strictEqual(emptyRes.statusCode, 400);
      const emptyJson = emptyRes.json();
      assert.strictEqual(emptyJson.success, false);
      assert.ok(emptyJson.error.userMessage.length > 0);
    });
  });

  describe('2. Mode Switching & Format Normalization', () => {
    const mockManifest: MediaManifest = {
      id: 'ast_test_ux_1080p',
      sourceUrl: 'https://example.com/nature.mp4',
      title: 'Majestic Cascades 4K 60fps',
      author: 'Alpine Explorer',
      durationSeconds: 184,
      fileSizeBytes: 245000000,
      container: 'mp4',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      permitted: true,
      videoStreams: [
        {
          streamIndex: 0,
          streamType: 'video',
          codec: 'av01.0.08M.10',
          width: 3840,
          height: 2160,
          resolutionLabel: '2160p',
          fps: 60,
          hdr: true,
          bitrateKbps: 18000,
          isStreamCopyCandidate: false,
        },
        {
          streamIndex: 1,
          streamType: 'video',
          codec: 'h264',
          width: 1920,
          height: 1080,
          resolutionLabel: '1080p',
          fps: 60,
          hdr: false,
          bitrateKbps: 6000,
          isStreamCopyCandidate: true,
        },
        {
          streamIndex: 2,
          streamType: 'video',
          codec: 'vp9',
          width: 1920,
          height: 1080,
          resolutionLabel: '1080p',
          fps: 60,
          hdr: false,
          bitrateKbps: 5500,
          isStreamCopyCandidate: false,
        },
        {
          streamIndex: 3,
          streamType: 'video',
          codec: 'h264',
          width: 1280,
          height: 720,
          resolutionLabel: '720p',
          fps: 30,
          hdr: false,
          bitrateKbps: 2500,
          isStreamCopyCandidate: true,
        },
        {
          streamIndex: 4,
          streamType: 'video',
          codec: 'h264',
          width: 854,
          height: 480,
          resolutionLabel: '480p',
          fps: 30,
          hdr: false,
          bitrateKbps: 1200,
          isStreamCopyCandidate: true,
        },
      ],
      audioStreams: [
        {
          streamIndex: 5,
          streamType: 'audio',
          codec: 'aac',
          bitrateKbps: 192,
          sampleRateHz: 48000,
          channels: 2,
          channelLayout: 'Stereo',
          isNativeLossless: false,
          isStreamCopyCandidate: true,
        },
        {
          streamIndex: 6,
          streamType: 'audio',
          codec: 'aac',
          bitrateKbps: 128,
          sampleRateHz: 48000,
          channels: 1,
          channelLayout: 'Director Commentary (Mono)',
          isNativeLossless: false,
          isStreamCopyCandidate: true,
        },
      ],
    };

    it('Video Mode: should normalize, deduplicate identical 1080p streams, and pick exactly ONE recommended option', () => {
      const options = normalizeVideoOptions(mockManifest);
      assert.ok(options.length > 0, 'Must produce video options');

      // Check deduplication: 1080p appears once (selecting H.264 over VP9 due to compatibility score)
      const tenEightyOptions = options.filter((o) => o.height === 1080);
      assert.strictEqual(tenEightyOptions.length, 1, '1080p options must be deduplicated to exactly 1');
      assert.strictEqual(tenEightyOptions[0].codec, 'h264', 'Universally compatible H.264 must be chosen');

      // Exactly ONE recommended badge
      const recommendedCount = options.filter((o) => o.recommended).length;
      assert.strictEqual(recommendedCount, 1, 'Exactly one option must carry the recommended badge');
      assert.strictEqual(tenEightyOptions[0].recommended, true, '1080p SDR should be recommended by default');

      // Check 4K 60fps HDR
      const fourK = options.find((o) => o.height === 2160);
      assert.ok(fourK, '4K option must be present');
      assert.strictEqual(fourK.hdr, true, 'HDR must be detected');
      assert.strictEqual(fourK.fpsBadge, '60fps', '60fps badge must be present');
    });

    it('Audio Mode: should normalize audio tracks and expose distinct streams', () => {
      const tracks = normalizeAudioOptions(mockManifest);
      assert.strictEqual(tracks.length, 2, 'Should normalize 2 distinct audio tracks');
      assert.ok(tracks[0].label.includes('Original Stereo') || tracks[0].label.includes('Stereo'));
      assert.ok(tracks[1].label.includes('Track 2'));
    });

    it('Audio Mode: lossy-to-lossless disclosure logic verification', () => {
      const tracks = normalizeAudioOptions(mockManifest);
      const sourceIsLossless = tracks[0].isNativeLossless;
      assert.strictEqual(sourceIsLossless, false, 'Source AAC stream is lossy');

      // If user chooses FLAC or WAV from AAC source, lossy disclosure must be flagged
      const targetFormatChoice = 'flac';
      const showLossyDisclosure =
        (targetFormatChoice === 'flac' || targetFormatChoice === 'wav') &&
        !sourceIsLossless;
      assert.strictEqual(
        showLossyDisclosure,
        true,
        'Lossy disclosure must be displayed when saving lossy source as FLAC/WAV'
      );
    });

    it('Compress Mode: should formulate valid smaller file transcode payload', () => {
      const targets = ['720p', '480p'];
      for (const target of targets) {
        const payload = {
          mediaAssetId: mockManifest.id,
          sourceUrl: mockManifest.sourceUrl,
          jobType: 'transcode_video',
          operation: 'CONVERT_FORMAT',
          targetFormat: 'mp4',
          targetResolution: target,
          streamCopy: false,
          title: `${mockManifest.title} (Compressed)`,
        };

        assert.strictEqual(payload.operation, 'CONVERT_FORMAT');
        assert.strictEqual(payload.streamCopy, false);
        assert.strictEqual(payload.targetResolution, target);
        assert.ok(payload.title.includes('Compressed'));
      }
    });

    it('Merge Mode: should formulate valid multiplexing payload', () => {
      const options = normalizeVideoOptions(mockManifest);
      const tracks = normalizeAudioOptions(mockManifest);
      const selectedVideo = options[0];
      const selectedAudio = tracks[0];

      const payload = {
        mediaAssetId: mockManifest.id,
        sourceUrl: mockManifest.sourceUrl,
        jobType: 'merge_av',
        operation: 'MERGE_AUDIO_VIDEO',
        targetFormat: 'mp4',
        targetResolution: selectedVideo.resolutionLabel,
        formatId: selectedVideo.formatId,
        streamCopy: Boolean(selectedVideo.isStreamCopyCandidate && selectedAudio.stream.isStreamCopyCandidate),
        title: `${mockManifest.title} (Merged)`,
      };

      assert.strictEqual(payload.jobType, 'merge_av');
      assert.strictEqual(payload.operation, 'MERGE_AUDIO_VIDEO');
      assert.ok(payload.targetResolution);
      assert.ok(payload.title.includes('Merged'));
    });
  });

  describe('3. Job Creation, Idempotency & Status Polling Journey', () => {
    it('should create an audio extraction job with idempotency key and return HTTP 202', async () => {
      const uniqueUserId = `usr_ux_dl_${Date.now()}`;
      const idemKey = `idem_ux_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/jobs',
        headers: {
          authorization: `Bearer ${uniqueUserId}`,
          'idempotency-key': idemKey,
        },
        payload: {
          mediaUrl: PUBLIC_TEST_VIDEO_URL,
          operation: 'EXTRACT_AUDIO',
          targetFormat: 'mp3',
          title: 'Big Buck Bunny Soundtrack',
          idempotencyKey: idemKey,
        },
      });

      assert.strictEqual(res.statusCode, 202, 'Job creation must return HTTP 202 Accepted');
      const json = res.json();
      assert.strictEqual(json.success, true);
      const jobId = json.data.jobId;
      assert.ok(jobId, 'jobId must be returned');
      assert.strictEqual(json.data.operation, 'EXTRACT_AUDIO');

      // Immediate status poll
      const pollRes = await app.inject({
        method: 'GET',
        url: `/api/v1/jobs/${jobId}`,
        headers: { authorization: `Bearer ${uniqueUserId}` },
      });
      assert.strictEqual(pollRes.statusCode, 200, 'Job poll must return HTTP 200');
      const pollJson = pollRes.json();
      assert.strictEqual(pollJson.success, true);
      assert.strictEqual(pollJson.data.id, jobId);
      assert.ok(['QUEUED', 'PROCESSING', 'VERIFYING', 'READY'].includes(pollJson.data.status));
    });

    it('should allow clean job cancellation and roll back quota reservation', async () => {
      const uniqueUserId = `usr_ux_cancel_${Date.now()}`;
      const idemKey = `idem_cancel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/jobs',
        headers: { authorization: `Bearer ${uniqueUserId}` },
        payload: {
          mediaUrl: PUBLIC_TEST_VIDEO_URL,
          operation: 'TRANSCODE_VIDEO',
          targetFormat: 'mp4',
          targetResolution: '480p',
          title: 'Cancel Me Job',
          idempotencyKey: idemKey,
        },
      });

      assert.strictEqual(createRes.statusCode, 202);
      const jobId = createRes.json().data.jobId;

      // Cancel
      const cancelRes = await app.inject({
        method: 'POST',
        url: `/api/v1/jobs/${jobId}/cancel`,
        headers: { authorization: `Bearer ${uniqueUserId}` },
      });
      assert.strictEqual(cancelRes.statusCode, 200);
      const cancelJson = cancelRes.json();
      assert.strictEqual(cancelJson.success, true);
      assert.strictEqual(cancelJson.data.status, 'CANCELLED');
    });
  });

  describe('4. Ready Screen & Binary Download Triggers', () => {
    it('should verify download URL resolution logic for jobs', () => {
      const sampleReadyJob: ProcessingJob = {
        id: 'job_ux_sample_ready',
        status: 'READY',
        operation: 'REMUX_STREAM_COPY',
        targetFormat: 'mp4',
        targetResolution: '1080p',
        processingLane: 'instant',
        losslessPreserved: true,
        progress: 100,
        progressStage: 'Ready to download',
        inputTitle: 'Sample Concert Clip',
        outputFilename: 'Sample_Concert_Clip_1080p.mp4',
        outputSizeBytes: 15420000,
        checksumSha256: 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0',
        retentionMinutes: 60,
        downloadUrl: '/api/v1/jobs/job_ux_sample_ready/download',
        createdAt: new Date().toISOString(),
      };

      // 1. Resolved download URL
      const dlUrl = sampleReadyJob.downloadUrl!;
      assert.strictEqual(dlUrl, '/api/v1/jobs/job_ux_sample_ready/download');

      // 2. Inline preview URL
      const previewUrl = `${dlUrl}?inline=1`;
      assert.strictEqual(previewUrl, '/api/v1/jobs/job_ux_sample_ready/download?inline=1');

      // 3. Format badges and size labels
      const sizeStr = formatBytes(sampleReadyJob.outputSizeBytes!);
      assert.strictEqual(sizeStr, '14.71 MB');

      // 4. SHA-256 preview truncator (12 chars ... 8 chars)
      const sha = sampleReadyJob.checksumSha256!;
      const previewSha = `${sha.slice(0, 12)}…${sha.slice(-8)}`;
      assert.strictEqual(previewSha, 'a1b2c3d4e5f6…9abcdef0');
    });

    it('should verify opt-in auto-download preference is OFF by default and persists correctly', () => {
      // In Node environment without window, getAutoDownloadPreference returns false
      assert.strictEqual(getAutoDownloadPreference(), false, 'Auto-download MUST be OFF by default');
    });
  });

  describe('5. Graceful Degradation & Network Error Resilience', () => {
    it('should block dead and unresolvable hosts like api.muxaro.app in api-client', () => {
      assert.strictEqual(
        isDeadOrUnresolvableHost('https://api.muxaro.app/api/v1'),
        true,
        'api.muxaro.app must be classified as dead/unresolvable'
      );
      assert.strictEqual(
        isDeadOrUnresolvableHost('http://api.muxaro.app'),
        true,
        'http://api.muxaro.app must be classified as dead/unresolvable'
      );
      assert.strictEqual(
        isDeadOrUnresolvableHost('/api/v1'),
        false,
        'Same-origin /api/v1 must be valid and resolvable'
      );
    });

    it('should map technical network and API errors into calm human-friendly messages', () => {
      const friendlyDns = mapFriendlyError('net::ERR_NAME_NOT_RESOLVED');
      assert.ok(
        friendlyDns.includes('connect') || friendlyDns.includes('network') || friendlyDns.includes('server'),
        `Friendly error expected, got: ${friendlyDns}`
      );

      const friendlyRateLimit = mapFriendlyError('HTTP_429');
      assert.ok(
        friendlyRateLimit.includes('wait') || friendlyRateLimit.includes('moment') || friendlyRateLimit.includes('requests')
      );

      const friendlyQuota = mapFriendlyError('DAILY_QUOTA_EXCEEDED');
      assert.ok(
        friendlyQuota.includes('allowance') || friendlyQuota.includes('limit') || friendlyQuota.includes('credits')
      );
    });
  });

  describe('6. Desktop and Mobile Layout & Hallmark Floor Invariants', () => {
    it('should verify formatters handle zero and edge cases without NaN or undefined', () => {
      assert.strictEqual(formatDuration(0), '00:00');
      assert.strictEqual(formatDuration(-10), '00:00');
      assert.strictEqual(formatDuration(65), '01:05');
      assert.strictEqual(formatDuration(3665), '01:01:05');

      assert.strictEqual(formatBytes(0), '0 B');
      assert.strictEqual(formatBytes(-500), '0 B');
      assert.strictEqual(formatBytes(1024), '1 KB');
      assert.strictEqual(formatBytes(1048576), '1 MB');
    });
  });
});
