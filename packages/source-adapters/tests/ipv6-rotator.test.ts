/**
 * Unit Tests: Outbound IPv6 /64 Subnet Rotator
 */

import assert from 'node:assert/strict';
import * as net from 'node:net';
import {
  IPv6Rotator,
  expandIPv6,
  parseIPv6Subnet,
  isValidIPv6Subnet,
  generateRandomIPv6,
  getRandomIpv6Address,
  defaultIPv6Rotator,
} from '../src/utils/ipv6-rotator.ts';

console.log('--- Running IPv6 Subnet Rotator Tests ---');

// 1. IPv6 Address Expansion
const testCases = [
  {
    input: '2001:db8:abcd:0012::',
    expected: ['2001', '0db8', 'abcd', '0012', '0000', '0000', '0000', '0000'],
  },
  {
    input: '::1',
    expected: ['0000', '0000', '0000', '0000', '0000', '0000', '0000', '0001'],
  },
  {
    input: '2001:db8:85a3::8a2e:370:7334',
    expected: ['2001', '0db8', '85a3', '0000', '0000', '8a2e', '0370', '7334'],
  },
  {
    input: 'fd00:dead:beef:1:2:3:4:5',
    expected: ['fd00', 'dead', 'beef', '0001', '0002', '0003', '0004', '0005'],
  },
];

for (const tc of testCases) {
  const result = expandIPv6(tc.input);
  assert.deepEqual(result, tc.expected, `expandIPv6 failed for ${tc.input}`);
  assert.equal(result.length, 8);
}

// 2. Subnet CIDR Parsing and Validation
const validSubnets = [
  '2001:db8:abcd:1234::/64',
  'fd00:dead:beef:1::/64',
  '2001:db8:1234::/48',
  '2001:0db8:0001:0002:0000:0000:0000:0000/64',
];

for (const cidr of validSubnets) {
  assert.equal(isValidIPv6Subnet(cidr), true, `Expected valid: ${cidr}`);
  const parsed = parseIPv6Subnet(cidr);
  assert.equal(parsed.cidr, cidr);
  assert.ok(parsed.prefixLength >= 16 && parsed.prefixLength <= 64);
  assert.ok(parsed.fixedHextets.length >= 3);
}

const invalidSubnets = [
  '',
  'invalid-ip',
  '192.168.1.0/24', // IPv4, not IPv6
  '2001:db8::/128', // /128 has no variable host bits for pool rotation
  '2001:db8::/8',   // Prefix too short (< 16)
  '2001:db8::',     // Missing prefix length
  '2001:db8:::1/64',// Malformed syntax
];

for (const bad of invalidSubnets) {
  assert.equal(isValidIPv6Subnet(bad), false, `Expected invalid: ${bad}`);
  assert.throws(() => parseIPv6Subnet(bad));
}

// 3. Dynamic /64 Random Address Generation
const testSubnet = '2001:db8:cafe:0042::/64';
const generatedAddresses = new Set<string>();

for (let i = 0; i < 50; i++) {
  const addr = generateRandomIPv6(testSubnet);

  // Must be valid IPv6
  assert.equal(net.isIPv6(addr), true, `Invalid IPv6 address generated: ${addr}`);

  // Must match the /64 prefix (first 4 hextets)
  const hextets = expandIPv6(addr);
  assert.equal(hextets[0], '2001');
  assert.equal(hextets[1], '0db8');
  assert.equal(hextets[2], 'cafe');
  assert.equal(hextets[3], '0042');

  generatedAddresses.add(addr);
}

// Ensure random entropy across 50 generations (zero collisions in 2^64 space)
assert.equal(generatedAddresses.size, 50, 'Detected duplicate generated IPv6 address in 50 trials');

// 4. Dynamic /48 Random Address Generation
const testSubnet48 = '2001:db8:9999::/48';
for (let i = 0; i < 10; i++) {
  const addr = generateRandomIPv6(testSubnet48);
  assert.equal(net.isIPv6(addr), true);
  const hextets = expandIPv6(addr);
  assert.equal(hextets[0], '2001');
  assert.equal(hextets[1], '0db8');
  assert.equal(hextets[2], '9999');
}

// 5. IPv6Rotator Instance Lifecycle & Fallback
const rotator = new IPv6Rotator({
  subnet: '2001:db8:1111:2222::/64',
  fallbackOnFailure: true,
  timeoutMs: 8000,
});

assert.equal(rotator.getSubnet(), '2001:db8:1111:2222::/64');
assert.equal(rotator.isFallbackEnabled(), true);

const agent = rotator.getHttpsAgent();
assert.ok(agent, 'Failed to create rotating HTTPS agent');

// Subnet update
rotator.setSubnet('fd00:cafe:babe:0005::/64');
assert.equal(rotator.getSubnet(), 'fd00:cafe:babe:0005::/64');
const updatedAddr = rotator.getRandomAddress();
assert.ok(updatedAddr.startsWith('fd00:cafe:babe:0005:'));

// 6. Default singleton rotator
const defaultAddr = defaultIPv6Rotator.getRandomAddress();
assert.equal(net.isIPv6(defaultAddr), true);

const convAddr = getRandomIpv6Address('2001:db8:8888:7777::/64');
assert.ok(convAddr.startsWith('2001:0db8:8888:7777:'));

console.log('✓ IPv6 Subnet Rotator Tests passed successfully');
