/**
 * Test Suite: Outbound IPv6 /64 & /48 Subnet Swarm Agent
 */

import assert from 'node:assert/strict';
import * as net from 'node:net';
import {
  expandIpv6ToBytes,
  bytesToCanonicalIpv6,
  Ipv6SubnetSwarm,
  generateLinuxAnyIpScript,
} from '../src/ipv6-subnet-agent.ts';

console.log('--- Running IPv6 Subnet Swarm Agent Tests ---');

// Test 1: IPv6 byte expansion and canonical serialization
{
  const input = '2001:db8::1';
  const bytes = expandIpv6ToBytes(input);
  assert.equal(bytes.length, 16, 'Expanded IPv6 must be 16 bytes');
  const canonical = bytesToCanonicalIpv6(bytes);
  assert.equal(canonical, '2001:db8::1', 'Canonical format must match RFC 5952');

  const zeroRun = '2a01:4f8:1c1c:4500:0:0:0:1';
  const canonRun = bytesToCanonicalIpv6(expandIpv6ToBytes(zeroRun));
  assert.equal(canonRun, '2a01:4f8:1c1c:4500::1', 'Must compress longest run of zeros with ::');
  console.log('✓ IPv6 expansion and canonical RFC 5952 formatting passed');
}

// Test 2: /64 Subnet Swarm Uniform Random Allocation
{
  const swarm64 = new Ipv6SubnetSwarm({
    prefixCidr: '2001:db8:cafe:beef::/64',
    strategy: 'uniform_random',
  });

  const generatedIps = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const ip = swarm64.generateAddress();
    assert(net.isIPv6(ip), `Generated address '${ip}' must be valid IPv6`);
    assert(ip.startsWith('2001:db8:cafe:beef:'), `Address '${ip}' must start with /64 prefix`);
    assert(!ip.endsWith('::0') && ip !== '2001:db8:cafe:beef::', 'Must not generate subnet router anycast ::0');
    generatedIps.add(ip);
  }

  // Cryptographic randomness should yield 100 unique addresses out of 100 in /64
  assert.equal(generatedIps.size, 100, 'All 100 random addresses in /64 must be unique');
  console.log('✓ /64 Subnet Swarm uniform random allocation passed (100/100 unique)');
}

// Test 3: /48 Subnet Swarm Allocation
{
  const swarm48 = new Ipv6SubnetSwarm({
    prefixCidr: '2a01:4f8:1c1c::/48',
    strategy: 'uniform_random',
  });

  for (let i = 0; i < 50; i++) {
    const ip = swarm48.generateAddress();
    assert(net.isIPv6(ip), `Generated address '${ip}' must be valid IPv6`);
    assert(ip.startsWith('2a01:4f8:1c1c:'), `Address '${ip}' must preserve /48 prefix`);
  }
  console.log('✓ /48 Subnet Swarm allocation passed');
}

// Test 4: Hash Affinity (Deterministic session pinning)
{
  const swarmAffinity = new Ipv6SubnetSwarm({
    prefixCidr: '2001:db8:9999:aaaa::/64',
    strategy: 'hash_affinity',
  });

  const session1 = 'session_user_42_stream_1080p';
  const session2 = 'session_user_88_stream_720p';

  const ip1a = swarmAffinity.generateAddress(session1);
  const ip1b = swarmAffinity.generateAddress(session1);
  const ip2 = swarmAffinity.generateAddress(session2);

  assert.equal(ip1a, ip1b, 'Hash affinity must yield identical address for identical session key');
  assert.notEqual(ip1a, ip2, 'Hash affinity must yield different addresses for different session keys');
  console.log('✓ Hash Affinity session-pinning passed');
}

// Test 5: Sequential Round-Robin Allocation
{
  const swarmSeq = new Ipv6SubnetSwarm({
    prefixCidr: '2001:db8:0001:0002::/64',
    strategy: 'sequential_round_robin',
  });

  const seq1 = swarmSeq.generateAddress();
  const seq2 = swarmSeq.generateAddress();
  const seq3 = swarmSeq.generateAddress();

  assert.notEqual(seq1, seq2, 'Sequential allocations must advance');
  assert.notEqual(seq2, seq3, 'Sequential allocations must advance');
  console.log('✓ Sequential round-robin allocation passed');
}

// Test 6: Linux AnyIP Provisioning Script
{
  const script = generateLinuxAnyIpScript('2001:db8:cafe:beef::/64', 'eth0');
  assert(script.includes('sysctl -w net.ipv6.ip_nonlocal_bind=1'), 'Script must enable nonlocal bind');
  assert(script.includes('ip -6 route add local 2001:db8:cafe:beef::/64 dev eth0'), 'Script must add local route');
  console.log('✓ Linux AnyIP provisioning script generation passed');
}

console.log('All IPv6 Subnet Swarm tests passed successfully!\n');
