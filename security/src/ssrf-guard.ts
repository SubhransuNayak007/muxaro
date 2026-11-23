/**
 * Project MUXARO - SSRF Guard Module
 * 
 * Comprehensive Server-Side Request Forgery (SSRF) defense with:
 * - Full IPv4 and IPv6 private/reserved/link-local/multicast CIDR filtering
 * - Strict protocol whitelisting (http/https only)
 * - Obfuscated IP parsing (decimal integer, hex, octal, abbreviated IPv4, fullwidth dots)
 * - IPv4-mapped IPv6 de-encapsulation (e.g. ::ffff:127.0.0.1)
 * - Cloud metadata endpoint blocking (AWS, GCP, Azure, DigitalOcean)
 * - Port restrictions against dangerous internal services
 * - DNS rebinding mitigation (two-phase resolution check + safe HTTP agent with IP pinning)
 * - Safe redirect following with target re-validation
 */

import * as dns from 'node:dns/promises';
import * as net from 'node:net';
import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';

/**
 * Standard SSRF validation options
 */
export interface SsrfGuardOptions {
  /** Allowed protocols (default: ['http:', 'https:']) */
  allowedProtocols?: string[];
  /** Allowed destination ports (default: [80, 443]) */
  allowedPorts?: number[];
  /** Whether to allow DNS resolution during validation (default: true) */
  resolveDns?: boolean;
  /** Custom DNS resolver function if needed for mocking/testing */
  dnsLookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  /** Maximum number of redirects to follow safely (default: 5) */
  maxRedirects?: number;
  /** Request timeout in milliseconds (default: 10000) */
  timeoutMs?: number;
  /** Additional blocked hostnames */
  blockedHostnames?: string[];
}

/**
 * Result of SSRF validation
 */
export interface SsrfValidationResult {
  isSafe: boolean;
  url: string;
  normalizedUrl?: string;
  hostname?: string;
  resolvedIps?: string[];
  pinnedIp?: string;
  family?: number;
  error?: string;
  reason?: string;
}

/**
 * IPv4 Range representation
 */
interface Ipv4Range {
  name: string;
  start: number;
  end: number;
}

/**
 * Convert dotted IPv4 string to 32-bit unsigned integer
 */
export function ipv4ToNumber(ip: string): number {
  const parts = ip.split('.').map(p => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) {
    throw new Error(`Invalid IPv4 address format: ${ip}`);
  }
  return ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + (parts[3] >>> 0);
}

/**
 * Parse CIDR string (e.g. '192.168.0.0/16') into numeric range
 */
function parseIpv4Cidr(name: string, cidr: string): Ipv4Range {
  const [ipStr, prefixStr] = cidr.split('/');
  const prefix = Number.parseInt(prefixStr, 10);
  const ipNum = ipv4ToNumber(ipStr);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const start = (ipNum & mask) >>> 0;
  const end = (start | (~mask >>> 0)) >>> 0;
  return { name, start, end };
}

/**
 * Blocked IPv4 CIDR Ranges
 * Covers RFC 1918, RFC 1122, RFC 3927, RFC 6598, RFC 5737, RFC 5771, RFC 1112, etc.
 */
export const BLOCKED_IPV4_RANGES: Ipv4Range[] = [
  parseIpv4Cidr('Current Network (RFC 1122)', '0.0.0.0/8'),
  parseIpv4Cidr('Private 10/8 (RFC 1918)', '10.0.0.0/8'),
  parseIpv4Cidr('Shared CGNAT (RFC 6598)', '100.64.0.0/10'),
  parseIpv4Cidr('Loopback (RFC 1122)', '127.0.0.0/8'),
  parseIpv4Cidr('Link-Local / Cloud Metadata (RFC 3927)', '169.254.0.0/16'),
  parseIpv4Cidr('Private 172.16/12 (RFC 1918)', '172.16.0.0/12'),
  parseIpv4Cidr('IETF Protocol Assignments (RFC 6890)', '192.0.0.0/24'),
  parseIpv4Cidr('Documentation TEST-NET-1 (RFC 5737)', '192.0.2.0/24'),
  parseIpv4Cidr('6to4 Relay Anycast (RFC 3068)', '192.88.99.0/24'),
  parseIpv4Cidr('Private 192.168/16 (RFC 1918)', '192.168.0.0/16'),
  parseIpv4Cidr('Benchmarking (RFC 2544)', '198.18.0.0/15'),
  parseIpv4Cidr('Documentation TEST-NET-2 (RFC 5737)', '198.51.100.0/24'),
  parseIpv4Cidr('Documentation TEST-NET-3 (RFC 5737)', '203.0.113.0/24'),
  parseIpv4Cidr('Multicast (RFC 5771)', '224.0.0.0/4'),
  parseIpv4Cidr('Reserved / Future Use (RFC 1112)', '240.0.0.0/4'),
  parseIpv4Cidr('Limited Broadcast (RFC 919)', '255.255.255.255/32')
];

/**
 * Expand and parse IPv6 address into full 8 16-bit hex integers
 */
export function parseIpv6(ip: string): number[] | null {
  let clean = ip.trim().toLowerCase();

  // Strip zone index if present (e.g. fe80::1%eth0)
  const zoneIndex = clean.indexOf('%');
  if (zoneIndex !== -1) {
    clean = clean.substring(0, zoneIndex);
  }

  // Handle IPv4-mapped IPv6 suffix (e.g. ::ffff:192.168.1.1)
  const lastColon = clean.lastIndexOf(':');
  if (lastColon !== -1) {
    const potentialIpv4 = clean.substring(lastColon + 1);
    if (potentialIpv4.includes('.')) {
      try {
        const num = ipv4ToNumber(potentialIpv4);
        const highPart = ((num >>> 16) & 0xffff).toString(16);
        const lowPart = (num & 0xffff).toString(16);
        clean = clean.substring(0, lastColon + 1) + `${highPart}:${lowPart}`;
      } catch {
        return null;
      }
    }
  }

  // Handle double colon expansion
  const doubleColon = clean.indexOf('::');
  let parts: string[];
  if (doubleColon !== -1) {
    const left = clean.substring(0, doubleColon).split(':').filter(Boolean);
    const right = clean.substring(doubleColon + 2).split(':').filter(Boolean);
    const missing = 8 - (left.length + right.length);
    if (missing < 0) return null;
    const middle = Array(missing).fill('0');
    parts = [...left, ...middle, ...right];
  } else {
    parts = clean.split(':');
  }

  if (parts.length !== 8) return null;

  const integers: number[] = [];
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    integers.push(Number.parseInt(part, 16));
  }
  return integers;
}

/**
 * Check if an IPv6 address matches blocked ranges
 */
export function isBlockedIpv6(ip: string): { blocked: boolean; reason?: string } {
  const parts = parseIpv6(ip);
  if (!parts) {
    return { blocked: true, reason: 'Malformed IPv6 address' };
  }

  // 1. Unspecified :: (all zeros)
  if (parts.every(p => p === 0)) {
    return { blocked: true, reason: 'Unspecified IPv6 address (::)' };
  }

  // 2. Loopback ::1 (7 zeros, last is 1)
  if (parts.slice(0, 7).every(p => p === 0) && parts[7] === 1) {
    return { blocked: true, reason: 'Loopback IPv6 address (::1)' };
  }

  // 3. IPv4-mapped IPv6 (::ffff:0:0/96 or ::ffff:127.0.0.1)
  if (parts.slice(0, 5).every(p => p === 0) && parts[5] === 0xffff) {
    const ipv4Num = ((parts[6] << 16) >>> 0) + parts[7];
    const ipv4Str = `${(ipv4Num >>> 24) & 255}.${(ipv4Num >>> 16) & 255}.${(ipv4Num >>> 8) & 255}.${ipv4Num & 255}`;
    const v4Check = isBlockedIpv4(ipv4Str);
    return {
      blocked: v4Check.blocked,
      reason: `IPv4-mapped IPv6 address (${ipv4Str}): ${v4Check.reason}`
    };
  }

  // 4. IPv4-compatible IPv6 (deprecated, ::/96)
  if (parts.slice(0, 6).every(p => p === 0) && parts[7] > 1) {
    const ipv4Num = ((parts[6] << 16) >>> 0) + parts[7];
    const ipv4Str = `${(ipv4Num >>> 24) & 255}.${(ipv4Num >>> 16) & 255}.${(ipv4Num >>> 8) & 255}.${ipv4Num & 255}`;
    const v4Check = isBlockedIpv4(ipv4Str);
    return {
      blocked: v4Check.blocked,
      reason: `IPv4-compatible IPv6 address (${ipv4Str}): ${v4Check.reason}`
    };
  }

  // 5. Unique Local Address (ULA) fc00::/7 (first byte fc or fd)
  // First 16-bit block high 7 bits are 1111110 (0xfc00 - 0xfdff)
  if ((parts[0] & 0xfe00) === 0xfc00) {
    return { blocked: true, reason: 'Unique Local Address (ULA fc00::/7 / fd00::/8)' };
  }

  // 6. Link-Local Unicast fe80::/10 (first 10 bits are 1111111010 => 0xfe80 - 0xfebf)
  if ((parts[0] & 0xffc0) === 0xfe80) {
    return { blocked: true, reason: 'Link-Local IPv6 address (fe80::/10)' };
  }

  // 7. Multicast ff00::/8 (first 8 bits are 0xff)
  if ((parts[0] & 0xff00) === 0xff00) {
    return { blocked: true, reason: 'Multicast IPv6 address (ff00::/8)' };
  }

  // 8. Documentation 2001:db8::/32
  if (parts[0] === 0x2001 && parts[1] === 0x0db8) {
    return { blocked: true, reason: 'Documentation IPv6 prefix (2001:db8::/32)' };
  }

  // 9. Discard-Only 100::/64
  if (parts[0] === 0x0100 && parts[1] === 0 && parts[2] === 0 && parts[3] === 0) {
    return { blocked: true, reason: 'Discard-Only IPv6 prefix (100::/64)' };
  }

  // 10. 6to4 prefix 2002::/16 (encapsulated IPv4 check)
  if (parts[0] === 0x2002) {
    const ipv4Num = ((parts[1] << 16) >>> 0) + parts[2];
    const ipv4Str = `${(ipv4Num >>> 24) & 255}.${(ipv4Num >>> 16) & 255}.${(ipv4Num >>> 8) & 255}.${ipv4Num & 255}`;
    const v4Check = isBlockedIpv4(ipv4Str);
    if (v4Check.blocked) {
      return { blocked: true, reason: `6to4 encapsulated IPv4 address (${ipv4Str}): ${v4Check.reason}` };
    }
  }

  return { blocked: false };
}

/**
 * Check if an IPv4 address string is blocked
 */
export function isBlockedIpv4(ip: string): { blocked: boolean; reason?: string } {
  try {
    const ipNum = ipv4ToNumber(ip);
    for (const range of BLOCKED_IPV4_RANGES) {
      if (ipNum >= range.start && ipNum <= range.end) {
        return { blocked: true, reason: `Blocked by range: ${range.name}` };
      }
    }
    return { blocked: false };
  } catch (err) {
    return { blocked: true, reason: `Invalid IPv4 format: ${(err as Error).message}` };
  }
}

/**
 * Parse potential obfuscated IPv4 representations (integer, octal, hex, abbreviated dotted)
 * Examples:
 * - 2130706433 -> 127.0.0.1
 * - 0x7f000001 -> 127.0.0.1
 * - 017700000001 -> 127.0.0.1
 * - 127.1 -> 127.0.0.1
 * - 0x7f.1 -> 127.0.0.1
 */
export function parseObfuscatedIpv4(hostname: string): string | null {
  const clean = hostname.trim();

  // Full 32-bit single integer or hex/octal string
  // e.g. 2130706433 or 0x7f000001 or 017700000001
  if (/^0x[0-9a-f]+$/i.test(clean)) {
    const val = Number.parseInt(clean, 16);
    if (!Number.isNaN(val) && val >= 0 && val <= 0xffffffff) {
      return `${(val >>> 24) & 255}.${(val >>> 16) & 255}.${(val >>> 8) & 255}.${val & 255}`;
    }
  }

  if (/^\d+$/.test(clean)) {
    // Check if it starts with 0 (octal candidate in POSIX socket parsers)
    let val: number;
    if (clean.length > 1 && clean.startsWith('0') && !clean.includes('8') && !clean.includes('9')) {
      val = Number.parseInt(clean, 8);
    } else {
      val = Number.parseInt(clean, 10);
    }
    if (!Number.isNaN(val) && val >= 0 && val <= 0xffffffff) {
      return `${(val >>> 24) & 255}.${(val >>> 16) & 255}.${(val >>> 8) & 255}.${val & 255}`;
    }
  }

  // Dotted notation with 1 to 4 parts (supports mixed hex/octal/decimal parts)
  // e.g. 127.1, 10.0.1, 0x7f.0.0.1, 0177.0.0.1
  const parts = clean.split('.');
  if (parts.length >= 1 && parts.length <= 4) {
    const parsedParts: number[] = [];
    for (const part of parts) {
      let num: number;
      if (/^0x[0-9a-f]+$/i.test(part)) {
        num = Number.parseInt(part, 16);
      } else if (/^0[0-7]+$/.test(part) && part.length > 1) {
        num = Number.parseInt(part, 8);
      } else if (/^\d+$/.test(part)) {
        num = Number.parseInt(part, 10);
      } else {
        return null;
      }
      if (Number.isNaN(num) || num < 0) return null;
      parsedParts.push(num);
    }

    if (parsedParts.length === 4) {
      if (parsedParts.every(p => p <= 255)) {
        return parsedParts.join('.');
      }
    } else if (parsedParts.length === 3) {
      // a.b.c -> a.b.0.c (where c is 16-bit)
      if (parsedParts[0] <= 255 && parsedParts[1] <= 255 && parsedParts[2] <= 0xffff) {
        const c = parsedParts[2];
        return `${parsedParts[0]}.${parsedParts[1]}.${(c >>> 8) & 255}.${c & 255}`;
      }
    } else if (parsedParts.length === 2) {
      // a.b -> a.0.0.b (where b is 24-bit)
      if (parsedParts[0] <= 255 && parsedParts[1] <= 0xffffff) {
        const b = parsedParts[1];
        return `${parsedParts[0]}.${(b >>> 16) & 255}.${(b >>> 8) & 255}.${b & 255}`;
      }
    } else if (parsedParts.length === 1) {
      if (parsedParts[0] <= 0xffffffff) {
        const a = parsedParts[0];
        return `${(a >>> 24) & 255}.${(a >>> 16) & 255}.${(a >>> 8) & 255}.${a & 255}`;
      }
    }
  }

  return null;
}

/**
 * Well-known cloud metadata endpoints and hostnames to explicitly block
 */
export const BLOCKED_HOSTNAMES = new Set([
  'instance-data',
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  '169.254.169.254',
  '169.254.170.2',
  '100.100.100.200',
  'fd00:ec2::254',
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'ip6-localnet',
  'ip6-mcastprefix',
  'ip6-allnodes',
  'ip6-allrouters',
  'ip6-allhosts'
]);

/**
 * Forbidden domain suffixes indicating internal or non-routable local networks
 */
export const FORBIDDEN_HOST_SUFFIXES = [
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.corp',
  '.intranet',
  '.onion',
  '.arpa'
];

/**
 * Dangerous internal ports to strictly reject unless explicitly allowed
 */
export const BLOCKED_PORTS = new Set([
  20, 21,    // FTP
  22,        // SSH
  23,        // Telnet
  25, 465, 587, // SMTP
  53,        // DNS
  69,        // TFTP
  110, 995,  // POP3
  111,       // RPC
  135, 137, 138, 139, // NetBIOS
  143, 993,  // IMAP
  389, 636,  // LDAP/LDAPS
  445,       // SMB
  1433,      // MSSQL
  1521,      // Oracle DB
  2049,      // NFS
  2375, 2376,// Docker Daemon API
  3306,      // MySQL
  3389,      // RDP
  5432,      // PostgreSQL
  5984,      // CouchDB
  6379,      // Redis
  8500,      // Consul
  9000,      // MinIO / PHP-FPM
  9090,      // Prometheus
  9200, 9300,// Elasticsearch
  11211,     // Memcached
  27017, 27018 // MongoDB
]);

/**
 * Normalize and un-obfuscate fullwidth dots, URL encodings, brackets
 */
export function normalizeHostname(host: string): string {
  let normalized = host.trim();
  // Decode percent encoding
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // If invalid percent encoding, keep as-is
  }
  // Replace fullwidth full stops (common IDN/homograph attack on dots)
  normalized = normalized.replace(/[\u3002\uFF0E\uFF61]/g, '.');
  // Strip enclosing square brackets for IPv6
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }
  // Strip trailing dot if present
  if (normalized.endsWith('.') && normalized.length > 1) {
    normalized = normalized.slice(0, -1);
  }
  return normalized.toLowerCase();
}

/**
 * Validate an IP string (either IPv4 or IPv6) against all blocked ranges
 */
export function validateIpAddress(ip: string): { isSafe: boolean; reason?: string } {
  const ipType = net.isIP(ip);
  if (ipType === 4) {
    const v4 = isBlockedIpv4(ip);
    if (v4.blocked) {
      return { isSafe: false, reason: v4.reason };
    }
    return { isSafe: true };
  }
  if (ipType === 6) {
    const v6 = isBlockedIpv6(ip);
    if (v6.blocked) {
      return { isSafe: false, reason: v6.reason };
    }
    return { isSafe: true };
  }
  return { isSafe: false, reason: `Unrecognized IP address format: ${ip}` };
}

/**
 * Core SSRF Validation Function
 * Validates a target URL against all SSRF threat vectors
 */
export async function validateUrlForSsrf(
  rawUrl: string,
  options: SsrfGuardOptions = {}
): Promise<SsrfValidationResult> {
  const allowedProtocols = options.allowedProtocols ?? ['http:', 'https:'];
  const allowedPorts = options.allowedPorts ?? [80, 443];
  const shouldResolveDns = options.resolveDns ?? true;
  const lookupFn = options.dnsLookup ?? (async (host: string) => {
    return await dns.lookup(host, { all: true });
  });

  if (!rawUrl || typeof rawUrl !== 'string') {
    return { isSafe: false, url: String(rawUrl), error: 'URL must be a non-empty string' };
  }

  // Parse URL
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    return { isSafe: false, url: rawUrl, error: `Invalid URL format: ${(err as Error).message}` };
  }

  // 1. Protocol Validation
  if (!allowedProtocols.includes(parsed.protocol)) {
    return {
      isSafe: false,
      url: rawUrl,
      error: `Protocol '${parsed.protocol}' is not allowed. Allowed: ${allowedProtocols.join(', ')}`,
      reason: 'FORBIDDEN_PROTOCOL'
    };
  }

  // 2. Port Validation
  const effectivePort = parsed.port
    ? Number.parseInt(parsed.port, 10)
    : (parsed.protocol === 'https:' ? 443 : 80);

  if (Number.isNaN(effectivePort) || effectivePort < 1 || effectivePort > 65535) {
    return { isSafe: false, url: rawUrl, error: 'Invalid port specification', reason: 'INVALID_PORT' };
  }

  if (BLOCKED_PORTS.has(effectivePort) && !allowedPorts.includes(effectivePort)) {
    return {
      isSafe: false,
      url: rawUrl,
      error: `Port ${effectivePort} is blocked for security reasons`,
      reason: 'BLOCKED_PORT'
    };
  }

  if (allowedPorts.length > 0 && !allowedPorts.includes(effectivePort)) {
    return {
      isSafe: false,
      url: rawUrl,
      error: `Port ${effectivePort} is not in allowed list (${allowedPorts.join(', ')})`,
      reason: 'PORT_NOT_ALLOWED'
    };
  }

  // 3. Userinfo / Credential trickery check
  if (parsed.username || parsed.password) {
    return {
      isSafe: false,
      url: rawUrl,
      error: 'URLs containing embedded credentials (user:pass@host) are rejected',
      reason: 'USERINFO_REJECTED'
    };
  }

  // 4. Hostname Normalization & Direct Hostname Check
  const normalizedHost = normalizeHostname(parsed.hostname);

  if (!normalizedHost) {
    return { isSafe: false, url: rawUrl, error: 'Empty or invalid hostname', reason: 'EMPTY_HOST' };
  }

  // Block known metadata / loopback hostnames
  if (BLOCKED_HOSTNAMES.has(normalizedHost)) {
    return {
      isSafe: false,
      url: rawUrl,
      hostname: normalizedHost,
      error: `Hostname '${normalizedHost}' is explicitly forbidden`,
      reason: 'FORBIDDEN_HOSTNAME'
    };
  }

  // Block internal / local domain suffixes
  for (const suffix of FORBIDDEN_HOST_SUFFIXES) {
    if (normalizedHost.endsWith(suffix)) {
      return {
        isSafe: false,
        url: rawUrl,
        hostname: normalizedHost,
        error: `Domain suffix '${suffix}' indicates an internal private network`,
        reason: 'FORBIDDEN_DOMAIN_SUFFIX'
      };
    }
  }

  if (options.blockedHostnames && options.blockedHostnames.includes(normalizedHost)) {
    return {
      isSafe: false,
      url: rawUrl,
      hostname: normalizedHost,
      error: `Hostname '${normalizedHost}' is in custom blocklist`,
      reason: 'CUSTOM_BLOCKLIST'
    };
  }

  // 5. Check if host is direct or obfuscated IP
  const obfuscatedV4 = parseObfuscatedIpv4(normalizedHost);
  if (obfuscatedV4) {
    const v4Check = isBlockedIpv4(obfuscatedV4);
    if (v4Check.blocked) {
      return {
        isSafe: false,
        url: rawUrl,
        hostname: normalizedHost,
        resolvedIps: [obfuscatedV4],
        error: `Host represents restricted IP address ${obfuscatedV4}: ${v4Check.reason}`,
        reason: 'BLOCKED_IP'
      };
    }
    // If it's a valid public IP literal
    return {
      isSafe: true,
      url: rawUrl,
      normalizedUrl: parsed.toString(),
      hostname: normalizedHost,
      resolvedIps: [obfuscatedV4],
      pinnedIp: obfuscatedV4,
      family: 4
    };
  }

  // Check direct IPv6 literal
  if (net.isIPv6(normalizedHost) || parseIpv6(normalizedHost) !== null) {
    const v6Check = isBlockedIpv6(normalizedHost);
    if (v6Check.blocked) {
      return {
        isSafe: false,
        url: rawUrl,
        hostname: normalizedHost,
        resolvedIps: [normalizedHost],
        error: `Host represents restricted IPv6 address: ${v6Check.reason}`,
        reason: 'BLOCKED_IP'
      };
    }
    return {
      isSafe: true,
      url: rawUrl,
      normalizedUrl: parsed.toString(),
      hostname: normalizedHost,
      resolvedIps: [normalizedHost],
      pinnedIp: normalizedHost,
      family: 6
    };
  }

  // 6. DNS Resolution and Rebinding Defense
  if (!shouldResolveDns) {
    return {
      isSafe: true,
      url: rawUrl,
      normalizedUrl: parsed.toString(),
      hostname: normalizedHost
    };
  }

  let addresses: Array<{ address: string; family: number }> = [];
  try {
    addresses = await lookupFn(normalizedHost);
  } catch (err) {
    return {
      isSafe: false,
      url: rawUrl,
      hostname: normalizedHost,
      error: `DNS resolution failed for '${normalizedHost}': ${(err as Error).message}`,
      reason: 'DNS_RESOLUTION_FAILED'
    };
  }

  if (!addresses || addresses.length === 0) {
    return {
      isSafe: false,
      url: rawUrl,
      hostname: normalizedHost,
      error: `DNS lookup returned no records for '${normalizedHost}'`,
      reason: 'NO_DNS_RECORDS'
    };
  }

  const resolvedIps = addresses.map(a => a.address);

  // Validate EVERY resolved address against IP blocklists!
  for (const record of addresses) {
    const ipCheck = validateIpAddress(record.address);
    if (!ipCheck.isSafe) {
      return {
        isSafe: false,
        url: rawUrl,
        hostname: normalizedHost,
        resolvedIps,
        error: `Host '${normalizedHost}' resolved to restricted address ${record.address}: ${ipCheck.reason}`,
        reason: 'DNS_RESOLVED_BLOCKED_IP'
      };
    }
  }

  // Choose the first safe resolved IP as pinned IP to defeat DNS rebinding TOCTOU
  const pinnedRecord = addresses[0];

  return {
    isSafe: true,
    url: rawUrl,
    normalizedUrl: parsed.toString(),
    hostname: normalizedHost,
    resolvedIps,
    pinnedIp: pinnedRecord.address,
    family: pinnedRecord.family
  };
}

/**
 * Safe HTTP fetch / request client that mitigates DNS rebinding and redirect SSRF
 * Pins the socket connection to the pre-validated IP address and validates all redirects.
 */
export async function safeFetch(
  targetUrl: string,
  fetchOptions: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
    timeoutMs?: number;
    maxRedirects?: number;
    guardOptions?: SsrfGuardOptions;
  } = {}
): Promise<{
  status: number;
  statusText: string;
  headers: http.IncomingHttpHeaders;
  buffer: () => Promise<Buffer>;
  text: () => Promise<string>;
  finalUrl: string;
}> {
  const maxRedirects = fetchOptions.maxRedirects ?? 5;
  const timeoutMs = fetchOptions.timeoutMs ?? 10000;
  let currentUrl = targetUrl;
  let redirectCount = 0;

  while (redirectCount <= maxRedirects) {
    // 1. SSRF Guard Check on current URL
    const check = await validateUrlForSsrf(currentUrl, fetchOptions.guardOptions);
    if (!check.isSafe || !check.pinnedIp) {
      throw new Error(`SSRF Guard blocked request to ${currentUrl}: ${check.error}`);
    }

    const parsed = new URL(currentUrl);
    const isHttps = parsed.protocol === 'https:';
    const effectivePort = parsed.port
      ? Number.parseInt(parsed.port, 10)
      : (isHttps ? 443 : 80);

    // 2. Perform request with IP pinning
    const response = await new Promise<{
      statusCode: number;
      statusMessage: string;
      headers: http.IncomingHttpHeaders;
      data: Buffer;
    }>((resolve, reject) => {
      const requestLib = isHttps ? https : http;

      const reqOptions: https.RequestOptions = {
        method: fetchOptions.method ?? 'GET',
        // Connect directly to pinned IP to eliminate DNS rebinding TOCTOU window
        host: check.pinnedIp,
        port: effectivePort,
        path: parsed.pathname + parsed.search,
        headers: {
          ...fetchOptions.headers,
          // Explicit Host header for virtual hosts & HTTP/1.1
          Host: parsed.host,
          'User-Agent': 'MuxaroMediaWorker/1.0 (+https://muxaro.app/security)'
        },
        timeout: timeoutMs,
        // For HTTPS: pass original hostname for TLS SNI and certificate validation
        ...(isHttps ? { servername: parsed.hostname } : {})
      };

      const req = requestLib.request(reqOptions, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 200,
            statusMessage: res.statusMessage ?? 'OK',
            headers: res.headers,
            data: Buffer.concat(chunks)
          });
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
      });

      req.on('error', err => {
        reject(err);
      });

      if (fetchOptions.body) {
        req.write(fetchOptions.body);
      }
      req.end();
    });

    // 3. Handle redirects safely
    if (
      response.statusCode >= 300 &&
      response.statusCode < 400 &&
      response.headers.location
    ) {
      redirectCount++;
      if (redirectCount > maxRedirects) {
        throw new Error(`Exceeded maximum redirect limit of ${maxRedirects}`);
      }
      // Resolve relative redirect against base URL
      const redirectTarget = new URL(response.headers.location, currentUrl).toString();
      currentUrl = redirectTarget;
      continue;
    }

    return {
      status: response.statusCode,
      statusText: response.statusMessage,
      headers: response.headers,
      buffer: async () => response.data,
      text: async () => response.data.toString('utf-8'),
      finalUrl: currentUrl
    };
  }

  throw new Error(`Too many redirects (max: ${maxRedirects})`);
}
