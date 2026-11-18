/**
 * Project VYRO - Independent QA & Security Test Suite
 * Test File: tests/security/ssrf-regression.test.ts
 *
 * Verifies SSRF defenses against comprehensive attack vectors:
 * - IPv4/IPv6 loopback & private subnets (RFC 1918, RFC 1122, RFC 3927)
 * - Cloud metadata endpoints (AWS, GCP, Azure, DigitalOcean)
 * - Obfuscated IP representations (integer, hex, octal, abbreviated)
 * - Non-HTTP schemes (file, ftp, gopher, dict)
 * - Blocked sensitive internal ports
 * - Fullwidth / Unicode homograph dot normalization
 * - Safe legitimate public URL allowance
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateUrlForSsrf,
  isBlockedIpv4,
  isBlockedIpv6,
  parseObfuscatedIpv4,
  normalizeHostname,
  validateIpAddress,
} from '../../security/src/ssrf-guard.ts';
import {
  isForbiddenIpv4,
  isForbiddenIpv6,
  ipv4ToNumber as sourceIpv4ToNumber,
} from '../../packages/source-adapters/src/ssrf-filter.ts';

describe('SSRF Guard - IPv4 Range Filtering', () => {
  const blockedIpv4Addresses = [
    { ip: '127.0.0.1', desc: 'Loopback standard' },
    { ip: '127.0.0.2', desc: 'Loopback non-standard host' },
    { ip: '127.255.255.255', desc: 'Loopback broadcast' },
    { ip: '0.0.0.0', desc: 'Current network' },
    { ip: '10.0.0.1', desc: 'RFC 1918 10/8 start' },
    { ip: '10.254.12.34', desc: 'RFC 1918 10/8 middle' },
    { ip: '172.16.0.1', desc: 'RFC 1918 172.16/12 lower bound' },
    { ip: '172.31.255.254', desc: 'RFC 1918 172.16/12 upper bound' },
    { ip: '192.168.0.1', desc: 'RFC 1918 192.168/16 router' },
    { ip: '192.168.254.254', desc: 'RFC 1918 192.168/16 subnet' },
    { ip: '169.254.169.254', desc: 'AWS/GCP/Azure link-local metadata' },
    { ip: '169.254.1.1', desc: 'Link-local IPv4 range' },
    { ip: '100.64.0.1', desc: 'Carrier-Grade NAT (RFC 6598)' },
    { ip: '224.0.0.1', desc: 'Multicast IPv4' },
    { ip: '240.0.0.1', desc: 'Reserved for future use (RFC 1112)' },
    { ip: '255.255.255.255', desc: 'Limited broadcast' },
  ];

  for (const { ip, desc } of blockedIpv4Addresses) {
    it(`should block ${desc} (${ip})`, () => {
      const res = isBlockedIpv4(ip);
      assert.strictEqual(res.blocked, true, `Expected ${ip} (${desc}) to be blocked`);
      assert.ok(res.reason, 'Must return a descriptive rejection reason');
    });
  }

  const safeIpv4Addresses = [
    { ip: '8.8.8.8', desc: 'Google Public DNS' },
    { ip: '1.1.1.1', desc: 'Cloudflare Public DNS' },
    { ip: '142.250.190.46', desc: 'Google Edge CDN' },
    { ip: '151.101.1.140', desc: 'Fastly Edge CDN' },
    { ip: '104.16.124.96', desc: 'Cloudflare Edge CDN' },
  ];

  for (const { ip, desc } of safeIpv4Addresses) {
    it(`should allow public routable IP ${desc} (${ip})`, () => {
      const res = isBlockedIpv4(ip);
      assert.strictEqual(res.blocked, false, `Expected ${ip} (${desc}) to be allowed`);
    });
  }
});

describe('SSRF Guard - IPv6 Range Filtering', () => {
  const blockedIpv6Addresses = [
    { ip: '::1', desc: 'IPv6 Loopback' },
    { ip: '0:0:0:0:0:0:0:1', desc: 'IPv6 Uncompressed Loopback' },
    { ip: '::', desc: 'IPv6 Unspecified address' },
    { ip: 'fc00::1', desc: 'Unique Local Address (fc00::/7)' },
    { ip: 'fd00:ec2::254', desc: 'AWS IPv6 Metadata endpoint' },
    { ip: 'fe80::1', desc: 'Link-Local IPv6 (fe80::/10)' },
    { ip: 'ff02::1', desc: 'Multicast IPv6 (ff00::/8)' },
    { ip: '::ffff:127.0.0.1', desc: 'IPv4-mapped loopback' },
    { ip: '::ffff:10.0.0.1', desc: 'IPv4-mapped RFC 1918 private' },
    { ip: '::ffff:169.254.169.254', desc: 'IPv4-mapped cloud metadata' },
    { ip: '2001:db8::1', desc: 'Documentation IPv6 prefix (2001:db8::/32)' },
  ];

  for (const { ip, desc } of blockedIpv6Addresses) {
    it(`should block ${desc} (${ip})`, () => {
      const res = isBlockedIpv6(ip);
      assert.strictEqual(res.blocked, true, `Expected ${ip} (${desc}) to be blocked`);
    });
  }

  const safeIpv6Addresses = [
    { ip: '2606:4700:4700::1111', desc: 'Cloudflare Public DNS IPv6' },
    { ip: '2001:4860:4860::8888', desc: 'Google Public DNS IPv6' },
  ];

  for (const { ip, desc } of safeIpv6Addresses) {
    it(`should allow public IPv6 ${desc} (${ip})`, () => {
      const res = isBlockedIpv6(ip);
      assert.strictEqual(res.blocked, false, `Expected ${ip} (${desc}) to be allowed`);
    });
  }
});

describe('SSRF Guard - Obfuscated IP Representations', () => {
  const obfuscationTestCases = [
    { input: '2130706433', expected: '127.0.0.1', desc: 'Decimal integer for 127.0.0.1' },
    { input: '0x7f000001', expected: '127.0.0.1', desc: 'Hex representation for 127.0.0.1' },
    { input: '017700000001', expected: '127.0.0.1', desc: 'Octal representation for 127.0.0.1' },
    { input: '127.1', expected: '127.0.0.1', desc: 'Abbreviated 2-part dotted IPv4 (127.0.0.1)' },
    { input: '0x7f.1', expected: '127.0.0.1', desc: 'Mixed hex and integer 2-part dotted IPv4' },
    { input: '16843008', expected: '1.1.1.0', desc: 'Integer representation for 1.1.1.0' },
  ];

  for (const { input, expected, desc } of obfuscationTestCases) {
    it(`should correctly unmask ${desc} (${input}) to ${expected}`, () => {
      const unmasked = parseObfuscatedIpv4(input);
      assert.strictEqual(unmasked, expected);
      if (expected.startsWith('127.')) {
        assert.strictEqual(isBlockedIpv4(unmasked!).blocked, true);
      }
    });
  }
});

describe('SSRF Guard - Unicode Homograph & Fullwidth Normalization', () => {
  it('should normalize fullwidth dots and detect loopback IP', () => {
    const raw = '127\u30020\u30020\u30021'; // Ideographic full stop
    const normalized = normalizeHostname(raw);
    assert.strictEqual(normalized, '127.0.0.1');
    assert.strictEqual(isBlockedIpv4(normalized).blocked, true);
  });

  it('should normalize uppercase and strip brackets from IPv6 hostnames', () => {
    const raw = '[::FFFF:127.0.0.1]';
    const normalized = normalizeHostname(raw);
    assert.strictEqual(normalized, '::ffff:127.0.0.1');
    assert.strictEqual(isBlockedIpv6(normalized).blocked, true);
  });
});

describe('SSRF Guard - Full URL Validation (Comprehensive Attack Vectors)', () => {
  const maliciousUrls = [
    { url: 'http://127.0.0.1/admin', desc: 'Direct IPv4 loopback' },
    { url: 'http://127.0.0.1:8080/internal', desc: 'Loopback with custom port' },
    { url: 'http://localhost:3000/api', desc: 'Localhost by name' },
    { url: 'http://169.254.169.254/latest/meta-data/', desc: 'AWS metadata service' },
    { url: 'http://instance-data/latest/meta-data/', desc: 'AWS instance-data alias' },
    { url: 'http://metadata.google.internal/computeMetadata/v1/', desc: 'GCP metadata internal name' },
    { url: 'http://[::1]/secret', desc: 'IPv6 loopback literal' },
    { url: 'http://[fd00:ec2::254]/latest/meta-data/', desc: 'AWS IPv6 metadata' },
    { url: 'http://2130706433/path', desc: 'Integer obfuscated loopback' },
    { url: 'http://0x7f000001/path', desc: 'Hex obfuscated loopback' },
    { url: 'http://10.0.0.5/backup.tar.gz', desc: 'Private 10/8 address' },
    { url: 'http://192.168.1.1/router-config', desc: 'Private 192.168/16 address' },
    { url: 'file:///etc/passwd', desc: 'Local file scheme' },
    { url: 'file:///C:/Windows/System32/drivers/etc/hosts', desc: 'Windows local file scheme' },
    { url: 'ftp://ftp.internal.corp/data', desc: 'FTP scheme' },
    { url: 'gopher://127.0.0.1:6379/_flushall', desc: 'Gopher protocol exploitation' },
    { url: 'http://admin:secret@127.0.0.1/', desc: 'Embedded credentials on loopback' },
    { url: 'http://safe-domain.com:22/video.mp4', desc: 'Sensitive SSH port 22' },
    { url: 'http://safe-domain.com:6379/video.mp4', desc: 'Sensitive Redis port 6379' },
    { url: 'http://safe-domain.com:5432/video.mp4', desc: 'Sensitive PostgreSQL port 5432' },
    { url: 'http://safe-domain.com:9000/video.mp4', desc: 'Sensitive MinIO/PHP-FPM port 9000' },
  ];

  for (const { url, desc } of maliciousUrls) {
    it(`should REJECT ${desc} (${url})`, async () => {
      const res = await validateUrlForSsrf(url, { resolveDns: false });
      assert.strictEqual(res.isSafe, false, `Expected URL '${url}' (${desc}) to be blocked`);
      assert.ok(res.error || res.reason, 'Must return error or reason for rejection');
    });
  }

  const legitimateUrls = [
    { url: 'https://example.com/media/sample.mp4', desc: 'Standard HTTPS media link' },
    { url: 'http://cdn.pixabay.com/video/forest-walk.mp4', desc: 'Standard HTTP CDN media link' },
    { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', desc: 'Public storage bucket' },
  ];

  for (const { url, desc } of legitimateUrls) {
    it(`should ACCEPT legitimate public URL ${desc} (${url})`, async () => {
      // Mock DNS lookup to return public routable IP
      const mockDnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];
      const res = await validateUrlForSsrf(url, {
        resolveDns: true,
        dnsLookup: mockDnsLookup,
      });
      assert.strictEqual(res.isSafe, true, `Expected URL '${url}' to be accepted. Error: ${res.error}`);
    });
  }

  it('should prevent DNS rebinding by checking all resolved IPs', async () => {
    // Hostname that resolves to both a public IP and a private loopback IP (DNS rebinding signature)
    const rebindingLookup = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ];
    const res = await validateUrlForSsrf('https://rebinding-attack.attacker.com/video.mp4', {
      resolveDns: true,
      dnsLookup: rebindingLookup,
    });
    assert.strictEqual(res.isSafe, false, 'DNS rebinding attempt with internal IP must be rejected');
    assert.ok(res.error?.includes('127.0.0.1') || res.reason === 'BLOCKED_IP');
  });
});

describe('Source Adapters - ssrf-filter.ts Defense-In-Depth Verification', () => {
  it('should detect forbidden IPv4 addresses in source-adapters filter', () => {
    const loopbackNum = sourceIpv4ToNumber('127.0.0.1');
    assert.notStrictEqual(loopbackNum, null);
    const check1 = isForbiddenIpv4(loopbackNum!);
    assert.strictEqual(check1.isBlocked, true);

    const private10Num = sourceIpv4ToNumber('10.1.2.3');
    assert.notStrictEqual(private10Num, null);
    const check2 = isForbiddenIpv4(private10Num!);
    assert.strictEqual(check2.isBlocked, true);

    const publicNum = sourceIpv4ToNumber('8.8.8.8');
    assert.notStrictEqual(publicNum, null);
    const check3 = isForbiddenIpv4(publicNum!);
    assert.strictEqual(check3.isBlocked, false);
  });

  it('should detect forbidden IPv6 addresses in source-adapters filter', () => {
    const checkLoopback = isForbiddenIpv6('::1');
    assert.strictEqual(checkLoopback.isBlocked, true);

    const checkUla = isForbiddenIpv6('fc00::1');
    assert.strictEqual(checkUla.isBlocked, true);

    const checkLinkLocal = isForbiddenIpv6('fe80::1');
    assert.strictEqual(checkLinkLocal.isBlocked, true);
  });
});
