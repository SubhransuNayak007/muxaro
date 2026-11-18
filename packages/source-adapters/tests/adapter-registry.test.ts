/**
 * Unit Tests: Source Adapter Registry and Factory
 */

import assert from 'node:assert/strict';
import {
  SourceAdapterRegistry,
  defaultAdapterRegistry,
  inspectMediaUrl,
  checkMediaRights,
} from '../src/adapter-registry.ts';
import { UnsupportedSourceError } from '../src/errors.ts';
import type {
  SourceAdapter,
  MediaManifest,
  RightsCheckResult,
  RightsDeclaration,
  AdapterCapabilities,
} from '../src/types.ts';

console.log('--- Running Adapter Registry Tests ---');

// 1. Default registry inspection
const sources = defaultAdapterRegistry.listSupportedSources();
assert.equal(sources.length, 2);
assert.ok(sources.some((s) => s.name === 'youtube-permitted-adapter'));
assert.ok(sources.some((s) => s.name === 'direct-media-adapter'));

// 2. Adapter routing resolution
const ytUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const directUrl = 'https://cdn.example.com/video.mp4';

const ytAdapter = defaultAdapterRegistry.findAdapter(ytUrl);
assert.ok(ytAdapter);
assert.equal(ytAdapter.name, 'youtube-permitted-adapter');

const directAdapter = defaultAdapterRegistry.findAdapter(directUrl);
assert.ok(directAdapter);
assert.equal(directAdapter.name, 'direct-media-adapter');

// 3. Priority and Custom Adapter Registration
const registry = new SourceAdapterRegistry();

class MockCustomAdapter implements SourceAdapter {
  public readonly name = 'mock-custom-adapter';
  public readonly supportedProtocols = ['https:'] as const;

  public canHandle(url: string): boolean {
    return url.includes('custom-source.com');
  }

  public async inspect(url: string): Promise<MediaManifest> {
    return {
      sourceUrl: url,
      canonicalUrl: url,
      sourceType: 'unsupported',
      title: 'Custom Inspected',
      container: 'mp4',
      streams: [],
      audioTracks: [],
      rights: {
        isPermitted: true,
        status: 'permitted',
        policyCode: 'LICENSED_PERMITTED',
        reason: 'Custom source',
        canExtractStreams: true,
        canPreview: true,
        attributionRequired: false,
        warnings: [],
        checkedAt: new Date().toISOString(),
      },
      canExtractStreams: true,
      extractionPolicyNotice: 'Custom notice',
      metadata: {},
      inspectedAt: new Date().toISOString(),
    };
  }

  public async checkRights(url: string): Promise<RightsCheckResult> {
    return {
      isPermitted: true,
      status: 'permitted',
      policyCode: 'LICENSED_PERMITTED',
      reason: 'Custom rights check',
      canExtractStreams: true,
      canPreview: true,
      attributionRequired: false,
      warnings: [],
      checkedAt: new Date().toISOString(),
    };
  }

  public getCapabilities(): AdapterCapabilities {
    return {
      canExtractMedia: true,
      canFetchMetadata: true,
      canGeneratePreview: true,
      requiresRightsAttestation: false,
      supportedContainers: ['mp4'],
      complianceNotes: 'Custom adapter',
    };
  }
}

registry.register(new MockCustomAdapter(), 200); // Higher priority than YouTube
const customMatch = registry.findAdapter('https://custom-source.com/media/123');
assert.ok(customMatch);
assert.equal(customMatch.name, 'mock-custom-adapter');

// 4. End-to-end inspectUrl with YouTube via convenience function
const ytManifest = await inspectMediaUrl(ytUrl);
assert.equal(ytManifest.sourceType, 'youtube_permitted');
assert.equal(ytManifest.canExtractStreams, false);

// 5. Rights checking convenience function
const ytRights = await checkMediaRights(ytUrl, {
  ownershipType: 'user_created_content',
  attestation: true,
});
assert.equal(ytRights.status, 'permitted');
assert.equal(ytRights.canExtractStreams, false);

// 6. Unsupported source URL check
assert.throws(
  () => {
    registry.getAdapter('gopher://internal/file.mp4');
  },
  UnsupportedSourceError
);

console.log('✓ Adapter Registry Tests passed successfully');
