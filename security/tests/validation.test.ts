/**
 * Input Validation & Request Schema Test Suite
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateInspectMediaRequest,
  validateCreateJobRequest,
  validateMergeJobRequest,
  validatePlaylistJobRequest,
  validateUuid,
  validatePaginationQuery,
  hasPrototypePollution,
  sanitizeObject
} from '../src/validation.ts';

test('Validation - UUIDv4 validator', () => {
  const validUuid = 'c3b9b4f2-9f37-4d43-9828-5674a2cb4860';
  const res = validateUuid(validUuid);
  assert.equal(res.success, true);
  assert.equal(res.data, validUuid);

  const invalidRes = validateUuid('not-a-uuid');
  assert.equal(invalidRes.success, false);
  assert.equal(invalidRes.errors?.[0]?.code, 'INVALID_UUID');
});

test('Validation - Prototype Pollution Defense', () => {
  assert.equal(hasPrototypePollution({ safe: 'value' }), false);
  assert.equal(hasPrototypePollution(JSON.parse('{"__proto__": {"admin": true}}')), true);
  assert.equal(hasPrototypePollution(JSON.parse('{"constructor": {"prototype": {"admin": true}}}')), true);

  const polluted = JSON.parse('{"__proto__": {"admin": true}, "title": "safe title"}');
  const cleaned = sanitizeObject(polluted);
  assert.equal(cleaned.title, 'safe title');
  assert.equal(Object.prototype.hasOwnProperty.call(cleaned, '__proto__'), false);
});

test('Validation - InspectMediaRequest', () => {
  // Valid
  const valid = validateInspectMediaRequest({ url: 'https://example.com/video.mp4' });
  assert.equal(valid.success, true);
  assert.equal(valid.data?.url, 'https://example.com/video.mp4');

  // Missing URL
  const missing = validateInspectMediaRequest({});
  assert.equal(missing.success, false);
  assert.equal(missing.errors?.[0]?.code, 'REQUIRED_FIELD');

  // URL exceeding max length
  const longUrl = 'https://example.com/' + 'a'.repeat(2100);
  const tooLong = validateInspectMediaRequest({ url: longUrl });
  assert.equal(tooLong.success, false);
  assert.equal(tooLong.errors?.[0]?.code, 'MAX_LENGTH_EXCEEDED');

  // Prototype pollution attempt
  const attack = validateInspectMediaRequest(JSON.parse('{"__proto__": {"evil": true}, "url": "https://example.com"}'));
  assert.equal(attack.success, false);
  assert.equal(attack.errors?.[0]?.code, 'PROTOTYPE_POLLUTION');
});

test('Validation - CreateJobRequest', () => {
  // Valid default job
  const valid = validateCreateJobRequest({
    url: 'https://example.com/source.mp4',
    format: 'mp4',
    quality: '1080p'
  });
  assert.equal(valid.success, true);
  assert.equal(valid.data?.format, 'mp4');
  assert.equal(valid.data?.quality, '1080p');

  // Unsupported format
  const badFormat = validateCreateJobRequest({
    url: 'https://example.com/source.mp4',
    format: 'exe'
  });
  assert.equal(badFormat.success, false);
  assert.equal(badFormat.errors?.[0]?.code, 'INVALID_FORMAT');

  // Conflicting flags
  const conflicting = validateCreateJobRequest({
    url: 'https://example.com/source.mp4',
    audioOnly: true,
    videoOnly: true
  });
  assert.equal(conflicting.success, false);
  assert.equal(conflicting.errors?.[0]?.code, 'CONFLICTING_FLAGS');

  // Inverted range
  const invertedRange = validateCreateJobRequest({
    url: 'https://example.com/source.mp4',
    startSeconds: 60,
    endSeconds: 10
  });
  assert.equal(invertedRange.success, false);
  assert.equal(invertedRange.errors?.[0]?.code, 'INVALID_RANGE');

  // Excessive range (>4 hours)
  const excessiveRange = validateCreateJobRequest({
    url: 'https://example.com/source.mp4',
    startSeconds: 0,
    endSeconds: 20000
  });
  assert.equal(excessiveRange.success, false);
  assert.equal(excessiveRange.errors?.[0]?.code, 'RANGE_TOO_LARGE');
});

test('Validation - MergeJobRequest', () => {
  const valid = validateMergeJobRequest({
    videoUrlOrId: 'https://example.com/v.mp4',
    audioUrlOrId: 'https://example.com/a.m4a',
    outputFormat: 'mp4',
    offsetMs: 250
  });
  assert.equal(valid.success, true);
  assert.equal(valid.data?.offsetMs, 250);

  const missingAudio = validateMergeJobRequest({
    videoUrlOrId: 'https://example.com/v.mp4'
  });
  assert.equal(missingAudio.success, false);
  assert.equal(missingAudio.errors?.[0]?.code, 'REQUIRED_FIELD');
});

test('Validation - PlaylistJobRequest and PRD 50-item cap', () => {
  const valid = validatePlaylistJobRequest({
    url: 'https://example.com/playlist.m3u',
    maxItems: 45
  });
  assert.equal(valid.success, true);
  assert.equal(valid.data?.maxItems, 45);

  // Exceeding PRD cap of 50
  const overCap = validatePlaylistJobRequest({
    url: 'https://example.com/playlist.m3u',
    maxItems: 51
  });
  assert.equal(overCap.success, false);
  assert.equal(overCap.errors?.[0]?.code, 'PLAYLIST_CAP_EXCEEDED');

  // Selection exceeding 50 items
  const indices51 = Array.from({ length: 51 }, (_, i) => i);
  const overCapIndices = validatePlaylistJobRequest({
    url: 'https://example.com/playlist.m3u',
    itemIndices: indices51
  });
  assert.equal(overCapIndices.success, false);
  assert.equal(overCapIndices.errors?.[0]?.code, 'PLAYLIST_CAP_EXCEEDED');
});

test('Validation - Pagination Query', () => {
  const valid = validatePaginationQuery({ limit: '50', offset: '10' });
  assert.equal(valid.success, true);
  assert.equal(valid.data?.limit, 50);
  assert.equal(valid.data?.offset, 10);

  const invalidLimit = validatePaginationQuery({ limit: '500', offset: '0' });
  assert.equal(invalidLimit.success, false);
  assert.equal(invalidLimit.errors?.[0]?.code, 'INVALID_PAGINATION');
});
