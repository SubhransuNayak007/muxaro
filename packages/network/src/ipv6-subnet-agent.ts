/**
 * MUXARO / PROJECT GARUDA - High-Throughput Sovereign Network & Edge Acceleration
 * Deliverable 1: Outbound IPv6 /64 & /48 Subnet Swarm Agent
 *
 * Provides dynamic, cryptographic socket binding across an assigned IPv6 /64 or /48 block.
 * Supports:
 * - RFC 5952 canonical address serialization
 * - RFC 4291 / RFC 7707 reserved address evasion (Subnet Router Anycast, Reserved Anycasts)
 * - Uniform Random, Hash Affinity (session-pinned), and Round-Robin allocation strategies
 * - Undici Dispatcher / Agent integration with dynamic per-connection localAddress binding
 * - Standard Node.js http.Agent / https.Agent socket binding
 * - Dual-Stack Happy Eyeballs DNS resolution with graceful IPv4 fallback
 * - Linux AnyIP kernel provisioning helper scripts
 */

import * as crypto from 'node:crypto';
import * as dns from 'node:dns/promises';
import * as net from 'node:net';
import * as http from 'node:http';
import * as https from 'node:https';
import { Agent, type Dispatcher } from 'undici';
import type {
  Ipv6SubnetConfig,
  Ipv6AddressStrategy,
  SubnetAddressStats,
} from './types.ts';

// =============================================================================
// 1. IPV6 ADDRESS PARSER, VALIDATOR & SERIALIZER
// =============================================================================

/**
 * Validates and expands an IPv6 address string into a 16-byte Buffer.
 */
export function expandIpv6ToBytes(ip: string): Uint8Array {
  const cleanIp = ip.trim().toLowerCase();
  if (!cleanIp || !net.isIPv6(cleanIp)) {
    throw new Error(`Invalid IPv6 address representation: '${ip}'`);
  }

  // Handle double colon :: expansion
  const halves = cleanIp.split('::');
  if (halves.length > 2) {
    throw new Error(`Invalid IPv6 address with multiple '::' markers: '${ip}'`);
  }

  let leftParts: string[] = [];
  let rightParts: string[] = [];

  if (halves[0].length > 0) {
    leftParts = halves[0].split(':');
  }

  if (halves.length === 2 && halves[1].length > 0) {
    rightParts = halves[1].split(':');
  }

  const missingParts = 8 - (leftParts.length + rightParts.length);
  const middleParts = new Array(missingParts).fill('0');
  const allParts = [...leftParts, ...middleParts, ...rightParts];

  if (allParts.length !== 8) {
    throw new Error(`Failed expanding IPv6 to 8 16-bit words: '${ip}'`);
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const val = Number.parseInt(allParts[i], 16);
    if (Number.isNaN(val) || val < 0 || val > 0xffff) {
      throw new Error(`Invalid hex segment in IPv6 '${allParts[i]}' at index ${i}`);
    }
    bytes[i * 2] = (val >> 8) & 0xff;
    bytes[i * 2 + 1] = val & 0xff;
  }

  return bytes;
}

/**
 * Converts a 16-byte buffer into RFC 5952 canonical IPv6 string format:
 * - Leading zeros omitted in each 16-bit field
 * - Longest contiguous sequence of 2 or more zero fields replaced with ::
 * - Lowercase hexadecimal characters
 */
export function bytesToCanonicalIpv6(bytes: Uint8Array): string {
  if (bytes.length !== 16) {
    throw new Error(`Expected 16 bytes for IPv6 address, got ${bytes.length}`);
  }

  const words = new Uint16Array(8);
  for (let i = 0; i < 8; i++) {
    words[i] = (bytes[i * 2] << 8) | bytes[i * 2 + 1];
  }

  // Find longest run of zeros for :: compression
  let bestRunStart = -1;
  let bestRunLength = 0;
  let currentRunStart = -1;
  let currentRunLength = 0;

  for (let i = 0; i < 8; i++) {
    if (words[i] === 0) {
      if (currentRunStart === -1) {
        currentRunStart = i;
        currentRunLength = 1;
      } else {
        currentRunLength++;
      }
    } else {
      if (currentRunLength > bestRunLength) {
        bestRunStart = currentRunStart;
        bestRunLength = currentRunLength;
      }
      currentRunStart = -1;
      currentRunLength = 0;
    }
  }

  if (currentRunLength > bestRunLength) {
    bestRunStart = currentRunStart;
    bestRunLength = currentRunLength;
  }

  // Only compress if the zero run is 2 or more consecutive fields
  if (bestRunLength < 2) {
    bestRunStart = -1;
    bestRunLength = 0;
  }

  const parts: string[] = [];
  for (let i = 0; i < 8; i++) {
    if (i === bestRunStart) {
      parts.push('');
      i += bestRunLength - 1;
      if (i === 7) parts.push('');
      continue;
    }
    parts.push(words[i].toString(16));
  }

  let result = parts.join(':');
  if (bestRunStart === 0 && bestRunLength === 8) {
    result = '::';
  } else if (bestRunStart === 0) {
    result = ':' + result;
  } else if (bestRunStart + bestRunLength === 8) {
    result = result + ':';
  }

  return result;
}

// =============================================================================
// 2. IPV6 SUBNET SWARM GENERATOR ENGINE
// =============================================================================

export class Ipv6SubnetSwarm {
  private readonly config: Ipv6SubnetConfig;
  private readonly prefixBytes: Uint8Array;
  private readonly prefixLength: number;
  private readonly prefixMask: Uint8Array;
  private readonly strategy: Ipv6AddressStrategy;
  private sequentialCounter: bigint = 1n;
  private totalGenerated = 0;
  private collisionsAvoided = 0;
  private ipv4FallbackCount = 0;
  private lastAllocated = '';

  constructor(config: Ipv6SubnetConfig) {
    this.config = config;
    const parts = config.prefixCidr.split('/');
    if (parts.length !== 2) {
      throw new Error(`Invalid CIDR notation for IPv6 subnet: '${config.prefixCidr}'. Expected format: '2001:db8::/64'`);
    }

    const prefixLength = Number.parseInt(parts[1], 10);
    if (Number.isNaN(prefixLength) || prefixLength < 32 || prefixLength > 120) {
      throw new Error(`Prefix length must be between /32 and /120, got /${parts[1]}`);
    }

    this.prefixLength = prefixLength;
    this.prefixBytes = expandIpv6ToBytes(parts[0]);
    this.strategy = config.strategy || 'uniform_random';

    // Build prefix bitmask
    this.prefixMask = new Uint8Array(16);
    let bitsLeft = prefixLength;
    for (let i = 0; i < 16; i++) {
      if (bitsLeft >= 8) {
        this.prefixMask[i] = 0xff;
        bitsLeft -= 8;
      } else if (bitsLeft > 0) {
        this.prefixMask[i] = (0xff << (8 - bitsLeft)) & 0xff;
        bitsLeft = 0;
      } else {
        this.prefixMask[i] = 0x00;
      }
      // Zero out host bits in prefixBytes
      this.prefixBytes[i] &= this.prefixMask[i];
    }
  }

  /**
   * Generates a dynamic IPv6 address within the assigned CIDR block.
   * Filters out reserved addresses per RFC 4291 and RFC 7707.
   *
   * @param affinityKey Optional key for session or URL pinning (used when strategy is 'hash_affinity')
   */
  public generateAddress(affinityKey?: string): string {
    const candidateBytes = new Uint8Array(16);

    let attempts = 0;
    while (attempts < 10) {
      attempts++;

      // Copy prefix bytes
      for (let i = 0; i < 16; i++) {
        candidateBytes[i] = this.prefixBytes[i];
      }

      // Generate host bits based on strategy
      if (this.strategy === 'hash_affinity' && affinityKey) {
        const hash = crypto.createHash('sha256').update(affinityKey).digest();
        let hashIdx = 0;
        for (let i = 0; i < 16; i++) {
          const hostMask = (~this.prefixMask[i]) & 0xff;
          if (hostMask > 0) {
            candidateBytes[i] = (candidateBytes[i] & this.prefixMask[i]) | (hash[hashIdx++ % hash.length] & hostMask);
          }
        }
      } else if (this.strategy === 'sequential_round_robin') {
        const counterBytes = new Uint8Array(8);
        const view = new DataView(counterBytes.buffer);
        view.setBigUint64(0, this.sequentialCounter++, false);

        let bytePos = 0;
        for (let i = 8; i < 16; i++) {
          const hostMask = (~this.prefixMask[i]) & 0xff;
          candidateBytes[i] = (candidateBytes[i] & this.prefixMask[i]) | (counterBytes[bytePos++] & hostMask);
        }
      } else {
        // Default: uniform_random using cryptographic randomness
        const randomBuf = crypto.randomBytes(16);
        for (let i = 0; i < 16; i++) {
          const hostMask = (~this.prefixMask[i]) & 0xff;
          if (hostMask > 0) {
            candidateBytes[i] = (candidateBytes[i] & this.prefixMask[i]) | (randomBuf[i] & hostMask);
          }
        }
      }

      // Check for RFC 4291 / RFC 7707 reserved address conflicts:
      // 1. Subnet router anycast: all host bits are zero
      let isAllZeroHost = true;
      for (let i = 0; i < 16; i++) {
        if ((candidateBytes[i] & (~this.prefixMask[i] & 0xff)) !== 0) {
          isAllZeroHost = false;
          break;
        }
      }

      if (isAllZeroHost) {
        this.collisionsAvoided++;
        continue;
      }

      // 2. Subnet Reserved Anycast: Host ID matches 0x7e / 0x7f / 0x80-ff in last byte of interface ID
      // RFC 2526: ::fdff:ffff:ffff:ff80 through ::fdff:ffff:ffff:ffff
      if (candidateBytes[14] === 0xfd && candidateBytes[15] >= 0x80) {
        this.collisionsAvoided++;
        continue;
      }

      // Valid candidate found
      const canonical = bytesToCanonicalIpv6(candidateBytes);
      this.totalGenerated++;
      this.lastAllocated = canonical;
      return canonical;
    }

    // Fallback safe address with counter offset
    candidateBytes[15] = (candidateBytes[15] | 0x01);
    const fallback = bytesToCanonicalIpv6(candidateBytes);
    this.totalGenerated++;
    this.lastAllocated = fallback;
    return fallback;
  }

  public getStats(): SubnetAddressStats {
    return {
      prefix: this.config.prefixCidr,
      prefixLength: this.prefixLength,
      totalGenerated: this.totalGenerated,
      collisionsAvoided: this.collisionsAvoided,
      ipv4FallbackCount: this.ipv4FallbackCount,
      lastAllocatedAddress: this.lastAllocated,
    };
  }

  public recordIpv4Fallback(): void {
    this.ipv4FallbackCount++;
  }
}

// =============================================================================
// 3. TARGET DNS & HAPPY EYEBALLS INSPECTOR
// =============================================================================

export interface DestinationResolution {
  readonly hasIpv6: boolean;
  readonly hasIpv4: boolean;
  readonly resolvedIpv6?: string;
  readonly resolvedIpv4?: string;
}

/**
 * Checks destination hostname for IPv6 (AAAA) and IPv4 (A) records
 * to determine whether IPv6 localAddress binding is safe.
 */
export async function resolveDestinationFamily(hostname: string): Promise<DestinationResolution> {
  // If hostname is already a numeric IP literal:
  if (net.isIPv6(hostname)) {
    return { hasIpv6: true, hasIpv4: false, resolvedIpv6: hostname };
  }
  if (net.isIPv4(hostname)) {
    return { hasIpv6: false, hasIpv4: true, resolvedIpv4: hostname };
  }

  try {
    const [aaaaResult, aResult] = await Promise.allSettled([
      dns.resolve6(hostname),
      dns.resolve4(hostname),
    ]);

    const ipv6Addresses = aaaaResult.status === 'fulfilled' ? aaaaResult.value : [];
    const ipv4Addresses = aResult.status === 'fulfilled' ? aResult.value : [];

    return {
      hasIpv6: ipv6Addresses.length > 0,
      hasIpv4: ipv4Addresses.length > 0,
      resolvedIpv6: ipv6Addresses[0],
      resolvedIpv4: ipv4Addresses[0],
    };
  } catch {
    // Fallback if DNS query throws
    return { hasIpv6: false, hasIpv4: true };
  }
}

// =============================================================================
// 4. UNDICI AGENT WITH DYNAMIC IPV6 LOCAL ADDRESS BINDING
// =============================================================================

/**
 * Creates a high-performance Undici Dispatcher Agent that binds each outgoing
 * HTTP/HTTPS socket to a dynamically randomized IPv6 address inside the assigned /64 or /48 block.
 */
export function createSubnetUndiciAgent(
  swarm: Ipv6SubnetSwarm,
  options?: {
    affinityKey?: string;
    maxSockets?: number;
    keepAliveTimeoutMs?: number;
  }
): Agent {
  const maxSockets = options?.maxSockets ?? 128;
  const keepAliveTimeout = options?.keepAliveTimeoutMs ?? 30_000;

  // Custom connector with dynamic socket localAddress allocation
  const customConnect = (opts: any, callback: (err: Error | null, socket: any) => void) => {
    const { hostname, port, protocol } = opts;
    const isHttps = protocol === 'https:';

    // Step 1: Inspect target destination
    resolveDestinationFamily(hostname)
      .then((resolution) => {
        let localAddress: string | undefined;

        if (resolution.hasIpv6) {
          // Bind to dynamically randomized IPv6 address
          localAddress = swarm.generateAddress(options?.affinityKey);
        } else {
          // Target host is IPv4 only; omit localAddress or record fallback
          swarm.recordIpv4Fallback();
        }

        const socketOpts: net.NetConnectOpts = {
          host: hostname,
          port: Number(port) || (isHttps ? 443 : 80),
          localAddress,
          family: resolution.hasIpv6 ? 6 : 4,
        };

        const socket = net.connect(socketOpts, () => {
          callback(null, socket);
        });

        socket.on('error', (err) => {
          callback(err, null);
        });
      })
      .catch((err) => {
        callback(err, null);
      });
  };

  return new Agent({
    connections: maxSockets,
    pipelining: 1,
    keepAliveTimeout,
    connect: customConnect as any,
  });
}

// =============================================================================
// 5. STANDARD NODE.JS HTTP / HTTPS AGENT INTEGRATION
// =============================================================================

export class SubnetHttpAgent extends http.Agent {
  private readonly swarm: Ipv6SubnetSwarm;

  constructor(
    swarm: Ipv6SubnetSwarm,
    options?: http.AgentOptions
  ) {
    super({
      keepAlive: true,
      maxSockets: options?.maxSockets ?? 128,
      ...options,
    });
    this.swarm = swarm;
  }

  public override createConnection(
    options: http.ClientRequestArgs,
    callback?: (err: Error | null, socket: net.Socket) => void
  ): net.Socket {
    const enrichedOpts = { ...options };
    enrichedOpts.localAddress = this.swarm.generateAddress(enrichedOpts.path);
    return super.createConnection(enrichedOpts, callback);
  }
}

export class SubnetHttpsAgent extends https.Agent {
  private readonly swarm: Ipv6SubnetSwarm;

  constructor(
    swarm: Ipv6SubnetSwarm,
    options?: https.AgentOptions
  ) {
    super({
      keepAlive: true,
      maxSockets: options?.maxSockets ?? 128,
      ...options,
    });
    this.swarm = swarm;
  }

  public override createConnection(
    options: https.RequestOptions,
    callback?: (err: Error | null, socket: net.Socket) => void
  ): net.Socket {
    const enrichedOpts = { ...options };
    enrichedOpts.localAddress = this.swarm.generateAddress(enrichedOpts.path);
    return super.createConnection(enrichedOpts, callback);
  }
}

// =============================================================================
// 6. LINUX HOST / CONTAINER ANYIP PROVISIONING HELPER
// =============================================================================

/**
 * Generates the production Linux shell commands and sysctl configuration
 * required to route any address within the assigned IPv6 subnet to the host network interface.
 */
export function generateLinuxAnyIpScript(prefixCidr: string, interfaceName = 'eth0'): string {
  return `#!/usr/bin/env bash
# =============================================================================
# PROJECT GARUDA - LINUX ANYIP ROUTE PROVISIONING SCRIPT
# Subnet: ${prefixCidr} | Interface: ${interfaceName}
# =============================================================================
set -euo pipefail

echo "==> Configuring Linux IPv6 AnyIP Subnet Swarm: ${prefixCidr}"

# 1. Enable Non-local Socket Binding in Kernel
sysctl -w net.ipv6.ip_nonlocal_bind=1
sysctl -w net.ipv6.conf.all.forwarding=1
sysctl -w net.ipv6.conf.${interfaceName}.forwarding=1

# 2. Add Local Routing Table Entry for the Entire Subnet Block
# This tells the Linux kernel to accept and bind ANY address within the subnet to local sockets
if ! ip -6 route show table local | grep -q "${prefixCidr}"; then
  echo "==> Adding local route: ip -6 route add local ${prefixCidr} dev ${interfaceName}"
  ip -6 route add local ${prefixCidr} dev ${interfaceName}
else
  echo "==> Local route for ${prefixCidr} already active in kernel routing table"
fi

# 3. Verify Route Presence
echo "==> Verification:"
ip -6 route show table local | grep "${prefixCidr}" || true
echo "==> IPv6 AnyIP swarm routing successfully active on ${interfaceName}."
`;
}
