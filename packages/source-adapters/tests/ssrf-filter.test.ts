/**
 * Unit Tests: SSRF Defense and Host Validation Filter
 */

import assert from 'node:assert/strict';
import {
  validateSsrfSafety,
  assertSsrfSafe,
  ipv4ToNumber,
  isForbiddenIpv4,
  isForbiddenIpv6,
} from '../src/ssrf-filter.ts';
import { SSRFBlockedError } from '../src/errors.ts';

console.log('--- Running SSRF Filter Tests ---');

// 1. IPv4 to Number conversion
assert.equal(ipv4ToNumber('127.0.0.1'), 0x7f000001);
assert.equal(ipv4ToNumber('10.0.0.1'), 0x0a000001);
assert.equal(ipv4ToNumber('192.168.1.1'), 0xc0a80101);
assert.equal(ipv4ToNumber('2130706433'), 0x7f000001); // Decimal integer representation
assert.equal(ipv4ToNumber('0x7f000001'), 0x7f000001); // Hex representation
assert.equal(ipv4ToNumber('invalid.ip'), null);

// 2. Forbidden IPv4 ranges
const loopbackNum = ipv4ToNumber('127.0.0.1')!;
assert.equal(isForbiddenIpv4(loopbackNum).isBlocked, true);

const private10Num = ipv4ToNumber('10.100.5.2')!;
assert.equal(isForbiddenIpv4(private10Num).isBlocked, true);

const private172Num = ipv4ToNumber('172.20.1.5')!;
assert.equal(isForbiddenIpv4(private172Num).isBlocked, true);

const private192Num = ipv4ToNumber('192.168.0.254')!;
assert.equal(isForbiddenIpv4(private192Num).isBlocked, true);

const cloudMetadataNum = ipv4ToNumber('169.254.169.254')!;
assert.equal(isForbiddenIpv4(cloudMetadataNum).isBlocked, true);

const publicIpv4 = ipv4ToNumber('8.8.8.8')!;
assert.equal(isForbiddenIpv4(publicIpv4).isBlocked, false);

// 3. Forbidden IPv6 ranges
assert.equal(isForbiddenIpv6('::1').isBlocked, true);
assert.equal(isForbiddenIpv6('[::1]').isBlocked, true);
assert.equal(isForbiddenIpv6('::ffff:127.0.0.1').isBlocked, true);
assert.equal(isForbiddenIpv6('fe80::1ff:fe23:4567:890a').isBlocked, true); // Link-local
assert.equal(isForbiddenIpv6('fc00::1').isBlocked, true); // Unique local
assert.equal(isForbiddenIpv6('2607:f8b0:4005:805::200e').isBlocked, false); // Public Google IPv6

// 4. URL SSRF Safety Tests (without DNS resolution)
const blockedUrls = [
  'http://127.0.0.1/video.mp4',
  'http://localhost/video.mp4',
  'http://10.0.0.5/stream.mp3',
  'http://172.16.5.9/video.mkv',
  'http://192.168.1.100/track.flac',
  'http://169.254.169.254/latest/meta-data/',
  'http://metadata.google.internal/computeMetadata/v1/',
  'http://service.local/media.mp4',
  'http://app.internal/audio.wav',
  'http://server.lan/media.webm',
  'file:///etc/passwd',
  'gopher://127.0.0.1:6379/_flushall',
  'ftp://ftp.example.com/file.mp4',
  'http://admin:secret@cdn.example.com/video.mp4', // credentials in URL
  'http://2130706433/video.mp4', // decimal loopback
  'http://0x7f000001/video.mp4', // hex loopback
];

for (const url of blockedUrls) {
  const result = await validateSsrfSafety(url, { resolveDns: false });
  assert.equal(result.isSafe, false, `Expected URL to be blocked: ${url}`);

  await assert.rejects(
    async () => {
      await assertSsrfSafe(url, { resolveDns: false });
    },
    SSRFBlockedError,
    `Expected assertSsrfSafe to throw SSRFBlockedError for ${url}`
  );
}

// 5. Safe Public URLs
const safeUrls = [
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  'https://cdn.example.com/podcasts/episode-101.mp3',
  'https://archive.org/download/test-stream/sample.flac',
];

for (const url of safeUrls) {
  const result = await validateSsrfSafety(url, { resolveDns: false });
  assert.equal(result.isSafe, true, `Expected URL to be safe: ${url}`);
  const normalized = await assertSsrfSafe(url, { resolveDns: false });
  assert.ok(normalized.startsWith('https://'));
}

console.log('✓ SSRF Filter Tests passed successfully');
