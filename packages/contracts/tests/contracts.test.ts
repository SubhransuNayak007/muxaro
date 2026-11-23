import assert from 'node:assert';
import {
  validateInspectRequest,
  validateInspectResponse,
  validateDownloadRequest,
  validateDownloadResponse,
  validateJobEvent,
  validateQuotaSummary,
  formatApiError,
  formatApiSuccess,
  formatSseEvent,
  parseSseEvent,
  sanitizeErrorMessage,
  classifyErrorToStatus,
  DETERMINISTIC_STATUS_CODES,
  STATUS_HTTP_MAP,
  STATUS_MESSAGE_MAP,
} from '../dist/index.js';

console.log('--- Testing @muxaro/contracts ---');

// 1. Status Codes
assert.strictEqual(DETERMINISTIC_STATUS_CODES.length, 6);
assert.strictEqual(STATUS_HTTP_MAP.ready, 200);
assert.strictEqual(STATUS_HTTP_MAP.unavailable, 503);
assert.strictEqual(STATUS_HTTP_MAP.rate_limited, 429);
assert.strictEqual(STATUS_HTTP_MAP.invalid_source, 400);
assert.strictEqual(STATUS_HTTP_MAP.format_unsupported, 422);

// 2. Error Sanitization
const sanitizedBot = sanitizeErrorMessage('Error 403: Forbidden - Sign in to confirm you are not a bot');
assert.ok(!sanitizedBot.includes('403'));
assert.ok(sanitizedBot.includes('cloud streaming'));

const classified = classifyErrorToStatus('Failed: 403 Forbidden upstream');
assert.strictEqual(classified, 'unavailable');

// 3. Inspect Contract
const inspectReqValid = validateInspectRequest({ url: 'https://youtube.com/watch?v=dQw4w9WgXcQ' });
assert.strictEqual(inspectReqValid.success, true);

const inspectReqInvalid = validateInspectRequest({ url: '' });
assert.strictEqual(inspectReqInvalid.success, false);

const inspectResValid = validateInspectResponse({
  id: 'dQw4w9WgXcQ',
  url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
  title: 'Never Gonna Give You Up',
  thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
  durationSeconds: 213,
  durationFormatted: '03:33',
  uploader: 'Rick Astley',
  platform: 'youtube',
  status: 'ready',
  availableResolutions: [
    {
      id: 'res_1080p',
      formatId: '137',
      label: '1080p Full HD',
      resolution: '1080p',
      height: 1080,
      width: 1920,
      fps: 60,
      vcodec: 'avc1',
      container: 'mp4',
      targetContainer: 'mp4',
      isHdr: false,
      requiresMerge: true,
      badge: '60fps',
    },
  ],
  availableAudioFormats: [
    {
      id: 'audio_mp3_320',
      formatId: '140',
      label: 'MP3 320kbps',
      format: 'mp3',
      bitrateKbps: 320,
      bitrateLabel: '320 kbps',
    },
  ],
  isPlaylist: false,
  inspectedAt: new Date().toISOString(),
});
assert.strictEqual(inspectResValid.success, true);

// 4. Download Contract
const downloadReq = validateDownloadRequest({
  url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
  targetFormat: 'mp4',
  targetResolution: '1080p',
});
assert.strictEqual(downloadReq.success, true);

const downloadRes = validateDownloadResponse({
  jobId: 'cjob_test_123',
  status: 'ready',
  jobStatus: 'ready',
  stage: 'READY',
  progressPercent: 100,
  deliveryMode: 'zero-hop',
  downloadUrl: 'https://direct.cdn/video.mp4',
  filename: 'Rick Astley - Never Gonna Give You Up.mp4',
  createdAt: new Date().toISOString(),
});
assert.strictEqual(downloadRes.success, true);

// 5. SSE Job Events
const eventPayload = {
  jobId: 'job_456',
  status: 'DOWNLOADING' as const,
  stage: 'DOWNLOADING_VIDEO',
  stageMessage: 'Downloading 1080p video stream...',
  progress: 45.5,
  speed: '16.4 MB/s',
  etaSeconds: 12,
  timestamp: new Date().toISOString(),
};
const eventValidation = validateJobEvent(eventPayload);
assert.strictEqual(eventValidation.success, true);

const sseFormatted = formatSseEvent(eventPayload);
assert.ok(sseFormatted.startsWith('event: progress\ndata: {'));
const sseParsed = parseSseEvent(sseFormatted);
assert.strictEqual(sseParsed?.jobId, 'job_456');
assert.strictEqual(sseParsed?.progress, 45.5);

// 6. Quota Summary
const quotaValid = validateQuotaSummary({
  userId: 'usr_abc',
  tier: 'free',
  role: 'user',
  evaluatedAt: new Date().toISOString(),
  dailyJobs: {
    limit: 25,
    used: 5,
    remaining: 20,
    resetTime: new Date(Date.now() + 86400000).toISOString(),
    resetInSeconds: 86400,
  },
  playlistJobs: {
    limit: 5,
    used: 1,
    remaining: 4,
    resetTime: new Date(Date.now() + 86400000).toISOString(),
    resetInSeconds: 86400,
    maxItemsPerJob: 25,
  },
  concurrency: {
    active: 0,
    limit: 3,
  },
  credits: {
    balance: 50,
    currency: 'credits',
  },
  canExecute: true,
});
assert.strictEqual(quotaValid.success, true);

console.log('✅ ALL CONTRACT TESTS PASSED WITH ZERO ERRORS.');
