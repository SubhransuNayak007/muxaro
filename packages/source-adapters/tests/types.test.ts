/**
 * Unit Tests: Core Types and Interface Contracts
 */

import assert from 'node:assert/strict';
import type {
  MediaManifest,
  MediaStream,
  AudioTrack,
  RightsCheckResult,
  RightsDeclaration,
  AdapterCapabilities,
  SourceAdapter,
} from '../src/types.ts';
import { DirectMediaAdapter } from '../src/direct-adapter.ts';
import { YouTubePermittedAdapter } from '../src/youtube-permitted-adapter.ts';

console.log('--- Running Types & Contract Tests ---');

// 1. Verify DirectMediaAdapter satisfies SourceAdapter interface
const directAdapter: SourceAdapter = new DirectMediaAdapter();
assert.equal(directAdapter.name, 'direct-media-adapter');
assert.ok(Array.isArray(directAdapter.supportedProtocols));
assert.ok(directAdapter.supportedProtocols.includes('https:'));

// 2. Verify YouTubePermittedAdapter satisfies SourceAdapter interface
const ytAdapter: SourceAdapter = new YouTubePermittedAdapter();
assert.equal(ytAdapter.name, 'youtube-permitted-adapter');
assert.ok(ytAdapter.supportedProtocols.includes('https:'));

// 3. Verify AdapterCapabilities structure
const directCaps: AdapterCapabilities = directAdapter.getCapabilities();
assert.equal(directCaps.canExtractMedia, true);
assert.equal(directCaps.canFetchMetadata, true);
assert.ok(directCaps.supportedContainers.includes('mp4'));

const ytCaps: AdapterCapabilities = ytAdapter.getCapabilities();
assert.equal(ytCaps.canExtractMedia, false, 'YouTube extraction capability must be false');
assert.equal(ytCaps.canFetchMetadata, true);
assert.equal(ytCaps.canGeneratePreview, true);

// 4. Verify MediaManifest and sub-types instantiate cleanly
const testStream: MediaStream = {
  id: 'stream-test',
  streamType: 'video',
  container: 'mp4',
  codec: 'h264',
  resolution: '1920x1080',
  width: 1920,
  height: 1080,
  fps: 60,
  bitrateBps: 5000000,
  contentLengthBytes: 104857600,
  directUrl: 'https://example.com/video.mp4',
  mimeType: 'video/mp4',
  isStreamExtractable: true,
  requiresRemux: false,
  requiresTranscode: false,
};

const testAudio: AudioTrack = {
  id: 'audio-test',
  codec: 'aac',
  channels: 2,
  sampleRateHz: 48000,
  bitrateBps: 256000,
  language: 'en',
  isDefault: true,
  contentLengthBytes: 5242880,
  directUrl: 'https://example.com/audio.m4a',
  mimeType: 'audio/mp4',
  isExtractable: true,
};

const testDeclaration: RightsDeclaration = {
  ownershipType: 'user_created_content',
  attestation: true,
  licenseType: 'Direct-Owner',
  notes: 'Original creator video',
  declaredByUserId: 'user-123',
};

const testRights: RightsCheckResult = {
  isPermitted: true,
  status: 'permitted',
  policyCode: 'USER_OWNED_VERIFIED',
  reason: 'Owner affirmed',
  canExtractStreams: true,
  canPreview: true,
  attributionRequired: false,
  rightsDeclaration: testDeclaration,
  warnings: [],
  checkedAt: new Date().toISOString(),
};

const testManifest: MediaManifest = {
  sourceUrl: 'https://example.com/video.mp4',
  canonicalUrl: 'https://example.com/video.mp4',
  sourceType: 'direct_media',
  title: 'Test Video',
  durationSeconds: 120.5,
  filesizeBytes: 104857600,
  container: 'mp4',
  mimeType: 'video/mp4',
  streams: [testStream],
  audioTracks: [testAudio],
  rights: testRights,
  canExtractStreams: true,
  extractionPolicyNotice: 'Direct extraction allowed',
  previewUrl: 'https://example.com/video.mp4',
  metadata: { customField: 'valid' },
  inspectedAt: new Date().toISOString(),
};

assert.equal(testManifest.container, 'mp4');
assert.equal(testManifest.streams.length, 1);
assert.equal(testManifest.audioTracks.length, 1);
assert.equal(testManifest.rights.policyCode, 'USER_OWNED_VERIFIED');

console.log('✓ Types & Contract Tests passed successfully');
