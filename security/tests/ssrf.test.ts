/**
 * Automated SSRF Protection Regression Test Suite
 * 
 * Tests:
 * 1. Loopback IPv4 addresses (all octets, decimal, hex, octal, shorthand)
 * 2. Private IPv4 addresses (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 * 3. Link-local and cloud metadata addresses (169.254.0.0/16, AWS/GCP endpoints)
 * 4. IPv6 loopback (::1), unspecified (::), ULA (fc00::/7), link-local (fe80::/10)
 * 5. IPv4-mapped IPv6 bypassing attempts (::ffff:127.0.0.1, ::ffff:169.254.169.254)
 * 6. Non-HTTP protocols (file, gopher, ftp, data)
 * 7. Blocked internal service ports (22, 6379, 5432, 2375, etc.)
 * 8. DNS rebinding prevention via multi-record IP inspection and pinning
 * 9. Valid public URLs pass verification
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateUrlForSsrf,
  isBlockedIpv4,
  isBlockedIpv6,
  parseObfuscatedIpv4,
  normalizeHostname,
  ipv4ToNumber
} from '../src/ssrf-guard.ts';

test('SSRF Guard - IPv4 numeric conversion and range calculations', () => {
  assert.equal(ipv4ToNumber('0.0.0.0'), 0);
  assert.equal(ipv4ToNumber('127.0.0.1'), 2130706433);
  assert.equal(ipv4ToNumber('255.255.255.255'), 4294967295);

  assert.throws(() => ipv4ToNumber('256.0.0.1'));
  assert.throws(() => ipv4ToNumber('127.0.1'));
  assert.throws(() => ipv4ToNumber('invalid'));
});

test('SSRF Guard - Obfuscated IPv4 parsing', () => {
  // Decimal integer
  assert.equal(parseObfuscatedIpv4('2130706433'), '127.0.0.1');
  // Hex DWORD
  assert.equal(parseObfuscatedIpv4('0x7f000001'), '127.0.0.1');
  // Dotted hex
  assert.equal(parseObfuscatedIpv4('0x7f.0.0.1'), '127.0.0.1');
  // Octal
  assert.equal(parseObfuscatedIpv4('017700000001'), '127.0.0.1');
  assert.equal(parseObfuscatedIpv4('0177.0.0.1'), '127.0.0.1');
  // Abbreviated 2-part dotted (127.1 => 127.0.0.1)
  assert.equal(parseObfuscatedIpv4('127.1'), '127.0.0.1');
  // Abbreviated 3-part dotted (127.0.1 => 127.0.0.1)
  assert.equal(parseObfuscatedIpv4('127.0.1'), '127.0.0.1');
  // Regular public domain should return null
  assert.equal(parseObfuscatedIpv4('example.com'), null);
});

test('SSRF Guard - Direct IPv4 Blocklist Verification', () => {
  // Loopback (127.0.0.0/8)
  assert.equal(isBlockedIpv4('127.0.0.1').blocked, true);
  assert.equal(isBlockedIpv4('127.0.0.2').blocked, true);
  assert.equal(isBlockedIpv4('127.255.255.254').blocked, true);

  // Private 10.0.0.0/8
  assert.equal(isBlockedIpv4('10.0.0.1').blocked, true);
  assert.equal(isBlockedIpv4('10.254.12.34').blocked, true);

  // Private 172.16.0.0/12
  assert.equal(isBlockedIpv4('172.16.0.1').blocked, true);
  assert.equal(isBlockedIpv4('172.24.50.1').blocked, true);
  assert.equal(isBlockedIpv4('172.31.255.254').blocked, true);
  assert.equal(isBlockedIpv4('172.32.0.1').blocked, false); // Public IP

  // Private 192.168.0.0/16
  assert.equal(isBlockedIpv4('192.168.0.1').blocked, true);
  assert.equal(isBlockedIpv4('192.168.1.254').blocked, true);

  // Cloud Metadata & Link-Local 169.254.0.0/16
  assert.equal(isBlockedIpv4('169.254.169.254').blocked, true);
  assert.equal(isBlockedIpv4('169.254.1.1').blocked, true);

  // Carrier-grade NAT 100.64.0.0/10
  assert.equal(isBlockedIpv4('100.64.0.1').blocked, true);
  assert.equal(isBlockedIpv4('100.127.255.254').blocked, true);

  // Current network & Broadcast
  assert.equal(isBlockedIpv4('0.0.0.0').blocked, true);
  assert.equal(isBlockedIpv4('255.255.255.255').blocked, true);

  // Public IP should not be blocked
  assert.equal(isBlockedIpv4('93.184.216.34').blocked, false); // example.com
  assert.equal(isBlockedIpv4('8.8.8.8').blocked, false);       // Google DNS
  assert.equal(isBlockedIpv4('1.1.1.1').blocked, false);       // Cloudflare DNS
});

test('SSRF Guard - IPv6 Blocklist Verification', () => {
  // Loopback (::1)
  assert.equal(isBlockedIpv6('::1').blocked, true);
  assert.equal(isBlockedIpv6('0:0:0:0:0:0:0:1').blocked, true);

  // Unspecified (::)
  assert.equal(isBlockedIpv6('::').blocked, true);

  // Unique Local Address (ULA fc00::/7)
  assert.equal(isBlockedIpv6('fc00::1').blocked, true);
  assert.equal(isBlockedIpv6('fd12:3456:789a::1').blocked, true);

  // Link-Local (fe80::/10)
  assert.equal(isBlockedIpv6('fe80::1').blocked, true);
  assert.equal(isBlockedIpv6('fe80::200:5aee:feaa:20a2').blocked, true);

  // IPv4-mapped IPv6
  assert.equal(isBlockedIpv6('::ffff:127.0.0.1').blocked, true);
  assert.equal(isBlockedIpv6('::ffff:169.254.169.254').blocked, true);
  assert.equal(isBlockedIpv6('::ffff:192.168.1.1').blocked, true);
  assert.equal(isBlockedIpv6('::ffff:10.0.0.1').blocked, true);
  assert.equal(isBlockedIpv6('::ffff:93.184.216.34').blocked, false); // Public v4 mapped

  // Public IPv6
  assert.equal(isBlockedIpv6('2606:4700:4700::1111').blocked, false); // Cloudflare public IPv6
});

test('SSRF Guard - URL Validation with Obfuscated Formats', async () => {
  // Decimal integer IP
  const decRes = await validateUrlForSsrf('http://2130706433/');
  assert.equal(decRes.isSafe, false);
  assert.equal(decRes.reason, 'BLOCKED_IP');

  // Hexadecimal IP
  const hexRes = await validateUrlForSsrf('http://0x7f000001/');
  assert.equal(hexRes.isSafe, false);
  assert.equal(hexRes.reason, 'BLOCKED_IP');

  // Dotted Hex IP
  const dottedHex = await validateUrlForSsrf('http://0x7f.0.0.1/');
  assert.equal(dottedHex.isSafe, false);
  assert.equal(dottedHex.reason, 'BLOCKED_IP');

  // Abbreviated Dotted IP
  const abbrRes = await validateUrlForSsrf('http://127.1/');
  assert.equal(abbrRes.isSafe, false);
  assert.equal(abbrRes.reason, 'BLOCKED_IP');

  // Direct AWS metadata IP
  const metaRes = await validateUrlForSsrf('http://169.254.169.254/latest/meta-data/');
  assert.equal(metaRes.isSafe, false);
  assert.equal(metaRes.reason, 'FORBIDDEN_HOSTNAME');

  // Cloud metadata hostname
  const gcpMeta = await validateUrlForSsrf('http://metadata.google.internal/computeMetadata/v1/');
  assert.equal(gcpMeta.isSafe, false);
  assert.equal(gcpMeta.reason, 'FORBIDDEN_HOSTNAME');
});

test('SSRF Guard - Protocol and Port Filtering', async () => {
  // Protocol tests
  const fileRes = await validateUrlForSsrf('file:///etc/passwd');
  assert.equal(fileRes.isSafe, false);
  assert.equal(fileRes.reason, 'FORBIDDEN_PROTOCOL');

  const gopherRes = await validateUrlForSsrf('gopher://127.0.0.1:6379/_flushall');
  assert.equal(gopherRes.isSafe, false);
  assert.equal(gopherRes.reason, 'FORBIDDEN_PROTOCOL');

  const ftpRes = await validateUrlForSsrf('ftp://example.com/file.mp4');
  assert.equal(ftpRes.isSafe, false);
  assert.equal(ftpRes.reason, 'FORBIDDEN_PROTOCOL');

  // Sensitive internal port test
  const sshPort = await validateUrlForSsrf('http://example.com:22/test.mp4', {
    dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }]
  });
  assert.equal(sshPort.isSafe, false);
  assert.equal(sshPort.reason, 'BLOCKED_PORT');

  const redisPort = await validateUrlForSsrf('http://example.com:6379/test.mp4', {
    dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }]
  });
  assert.equal(redisPort.isSafe, false);
  assert.equal(redisPort.reason, 'BLOCKED_PORT');

  // Userinfo / credential rejection
  const userinfoRes = await validateUrlForSsrf('http://admin:secret@example.com/video.mp4');
  assert.equal(userinfoRes.isSafe, false);
  assert.equal(userinfoRes.reason, 'USERINFO_REJECTED');
});

test('SSRF Guard - DNS Rebinding & Multiple A-Record Mitigation', async () => {
  // Simulation 1: DNS resolves to loopback IP
  const rebindingToLoopback = await validateUrlForSsrf('http://rebind-test.attacker.com/video.mp4', {
    dnsLookup: async () => [{ address: '127.0.0.1', family: 4 }]
  });
  assert.equal(rebindingToLoopback.isSafe, false);
  assert.equal(rebindingToLoopback.reason, 'DNS_RESOLVED_BLOCKED_IP');

  // Simulation 2: DNS resolves to AWS Metadata
  const rebindingToAws = await validateUrlForSsrf('http://rebind-aws.attacker.com/video.mp4', {
    dnsLookup: async () => [{ address: '169.254.169.254', family: 4 }]
  });
  assert.equal(rebindingToAws.isSafe, false);
  assert.equal(rebindingToAws.reason, 'DNS_RESOLVED_BLOCKED_IP');

  // Simulation 3: DNS returns dual A-records (one public, one private)
  const dualRecord = await validateUrlForSsrf('http://dual-rebind.attacker.com/video.mp4', {
    dnsLookup: async () => [
      { address: '93.184.216.34', family: 4 }, // public
      { address: '10.0.0.5', family: 4 }       // private (attacker hopes connection hits this)
    ]
  });
  // Must reject because at least one record resolves to a blocked IP!
  assert.equal(dualRecord.isSafe, false);
  assert.equal(dualRecord.reason, 'DNS_RESOLVED_BLOCKED_IP');

  // Simulation 4: Pure public IP passes and returns pinned IP
  const validPublic = await validateUrlForSsrf('https://legit-media.cdn.com/asset.mp4', {
    dnsLookup: async () => [
      { address: '93.184.216.34', family: 4 }
    ]
  });
  assert.equal(validPublic.isSafe, true);
  assert.equal(validPublic.pinnedIp, '93.184.216.34');
  assert.equal(validPublic.family, 4);
});
