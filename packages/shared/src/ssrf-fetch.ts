/**
 * MUXARO Media Processing Platform - SSRF & DNS-Rebinding-Safe HTTP Fetcher
 *
 * Implements a bulletproof, production-grade SSRF defense layer:
 * 1. Comprehensive CIDR & IP representation validation (IPv4 dotted, decimal, octal, hex,
 *    multi-part, IPv6 loopback, IPv4-mapped, ULA, link-local, cloud metadata, multicast).
 * 2. Socket-connect-time DNS resolution inspection using an Undici Agent connect.lookup hook
 *    to eliminate Time-of-Check to Time-of-Use (TOCTOU) DNS rebinding exploits with TTL=0.
 * 3. Enforced manual redirect validation (maxRedirects default: 3) rejecting non-standard ports
 *    (allowing strictly 80 and 443) and embedded credentials (user:pass@host).
 */

import * as dns from 'node:dns';
import { Agent, fetch, Response, type RequestInit, type Dispatcher, type BodyInit, type HeadersInit } from 'undici';
import { MuxaroError } from './errors.js';

// =============================================================================
// 1. IPV4 & IPV6 PARSING & FORBIDDEN CIDR EVALUATION
// =============================================================================

/**
 * Parses an IPv4 address from any standard notation into a 32-bit unsigned integer:
 * - Dotted-quad (a.b.c.d) where parts can be decimal, octal (0177), or hex (0x7f)
 * - 3-part dotted (a.b.c -> a.b in 0..255, c in 0..65535)
 * - 2-part dotted (a.b -> a in 0..255, b in 0..16777215)
 * - Single integer (decimal, hex 0x..., octal 0...)
 * Returns null if the string is not a valid IPv4 address.
 */
export function parseIpv4ToNumber(ip: string): number | null {
  const trimmed = ip.trim();
  if (!trimmed) return null;

  function parsePart(part: string): number | null {
    if (/^0x[0-9a-f]+$/i.test(part)) {
      const v = Number.parseInt(part, 16);
      return Number.isNaN(v) ? null : v;
    }
    if (/^0[0-7]+$/.test(part) && part.length > 1) {
      const v = Number.parseInt(part, 8);
      return Number.isNaN(v) ? null : v;
    }
    if (/^\d+$/.test(part)) {
      const v = Number.parseInt(part, 10);
      return Number.isNaN(v) ? null : v;
    }
    return null;
  }

  const parts = trimmed.split('.');

  // 4 parts: a.b.c.d (each 0..255)
  if (parts.length === 4) {
    let num = 0;
    for (const p of parts) {
      const val = parsePart(p);
      if (val === null || val < 0 || val > 255) return null;
      num = (num << 8) + val;
    }
    return num >>> 0;
  }

  // 3 parts: a.b.c (a, b 0..255, c 0..65535)
  if (parts.length === 3) {
    const a = parsePart(parts[0]);
    const b = parsePart(parts[1]);
    const c = parsePart(parts[2]);
    if (a === null || a < 0 || a > 255) return null;
    if (b === null || b < 0 || b > 255) return null;
    if (c === null || c < 0 || c > 65535) return null;
    return (((a << 8) + b << 16) + c) >>> 0;
  }

  // 2 parts: a.b (a 0..255, b 0..16777215)
  if (parts.length === 2) {
    const a = parsePart(parts[0]);
    const b = parsePart(parts[1]);
    if (a === null || a < 0 || a > 255) return null;
    if (b === null || b < 0 || b > 16777215) return null;
    return ((a << 24) + b) >>> 0;
  }

  // 1 part: single integer (0..4294967295)
  if (parts.length === 1) {
    const val = parsePart(parts[0]);
    if (val !== null && val >= 0 && val <= 0xffffffff) {
      return val >>> 0;
    }
  }

  return null;
}

/**
 * Checks if a 32-bit unsigned IPv4 number falls into any private, loopback,
 * link-local, carrier-grade NAT, or reserved CIDR range.
 */
export function isForbiddenIpv4Number(num: number): { isForbidden: boolean; reason?: string } {
  // 0.0.0.0/8 - "This host on this network"
  if ((num & 0xff000000) === 0x00000000) {
    return { isForbidden: true, reason: 'Current network (0.0.0.0/8) is forbidden' };
  }
  // 10.0.0.0/8 - RFC 1918 Private
  if ((num & 0xff000000) === 0x0a000000) {
    return { isForbidden: true, reason: 'Private network (10.0.0.0/8) is forbidden' };
  }
  // 100.64.0.0/10 - Carrier Grade NAT (RFC 6598, includes Alibaba metadata 100.100.100.200)
  if (((num & 0xffc00000) >>> 0) === 0x64400000) {
    return { isForbidden: true, reason: 'Shared address space CGNAT (100.64.0.0/10) is forbidden' };
  }
  // 127.0.0.0/8 - Loopback (RFC 1122)
  if ((num & 0xff000000) === 0x7f000000) {
    return { isForbidden: true, reason: 'Loopback address (127.0.0.0/8) is forbidden' };
  }
  // 169.254.0.0/16 - Link-local & Cloud Metadata (AWS/GCP/Azure IMDS 169.254.169.254, ECS 169.254.170.2)
  if (((num & 0xffff0000) >>> 0) === 0xa9fe0000) {
    return { isForbidden: true, reason: 'Link-local/Cloud Metadata (169.254.0.0/16) is forbidden' };
  }
  // 172.16.0.0/12 - RFC 1918 Private (172.16.0.0 - 172.31.255.255)
  if (((num & 0xfff00000) >>> 0) === 0xac100000) {
    return { isForbidden: true, reason: 'Private network (172.16.0.0/12) is forbidden' };
  }
  // 192.0.0.0/24 - IETF Protocol Assignments
  if (((num & 0xffffff00) >>> 0) === 0xc0000000) {
    return { isForbidden: true, reason: 'IETF assignment (192.0.0.0/24) is forbidden' };
  }
  // 192.0.2.0/24 - Documentation (TEST-NET-1)
  if (((num & 0xffffff00) >>> 0) === 0xc0000200) {
    return { isForbidden: true, reason: 'Documentation network (192.0.2.0/24) is forbidden' };
  }
  // 192.88.99.0/24 - 6to4 Relay Anycast
  if (((num & 0xffffff00) >>> 0) === 0xc0586300) {
    return { isForbidden: true, reason: '6to4 relay anycast (192.88.99.0/24) is forbidden' };
  }
  // 192.168.0.0/16 - RFC 1918 Private
  if (((num & 0xffff0000) >>> 0) === 0xc0a80000) {
    return { isForbidden: true, reason: 'Private network (192.168.0.0/16) is forbidden' };
  }
  // 198.18.0.0/15 - Network benchmark tests
  if (((num & 0xfffe0000) >>> 0) === 0xc6120000) {
    return { isForbidden: true, reason: 'Benchmark testing network (198.18.0.0/15) is forbidden' };
  }
  // 198.51.100.0/24 - Documentation (TEST-NET-2)
  if (((num & 0xffffff00) >>> 0) === 0xc6336400) {
    return { isForbidden: true, reason: 'Documentation network (198.51.100.0/24) is forbidden' };
  }
  // 203.0.113.0/24 - Documentation (TEST-NET-3)
  if (((num & 0xffffff00) >>> 0) === 0xcb007100) {
    return { isForbidden: true, reason: 'Documentation network (203.0.113.0/24) is forbidden' };
  }
  // 224.0.0.0/4 - Multicast
  if (((num & 0xf0000000) >>> 0) === 0xe0000000) {
    return { isForbidden: true, reason: 'Multicast address space (224.0.0.0/4) is forbidden' };
  }
  // 240.0.0.0/4 - Reserved (including 255.255.255.255 broadcast)
  if (((num & 0xf0000000) >>> 0) === 0xf0000000) {
    return { isForbidden: true, reason: 'Reserved/Broadcast address space (240.0.0.0/4) is forbidden' };
  }

  return { isForbidden: false };
}

export interface ParsedIpv6 {
  readonly big: bigint;
  readonly embeddedIpv4: number | null;
}

/**
 * Parses an IPv6 string into a 128-bit BigInt representation, supporting
 * standard groups, compressed notation (::), and embedded IPv4 (::ffff:192.0.2.1).
 */
export function parseIpv6Address(ip: string): ParsedIpv6 | null {
  let clean = ip.toLowerCase().trim().replace(/^\[|\]$/g, '');
  if (!clean) return null;

  // Strip zone index (e.g. fe80::1%eth0)
  const zoneIndex = clean.indexOf('%');
  if (zoneIndex !== -1) {
    clean = clean.slice(0, zoneIndex);
  }

  // Check for embedded IPv4 at the end (e.g. ::ffff:192.168.1.1)
  let embeddedIpv4: number | null = null;
  const lastColon = clean.lastIndexOf(':');
  if (lastColon !== -1 && clean.slice(lastColon + 1).includes('.')) {
    const ipv4Str = clean.slice(lastColon + 1);
    const parsedIpv4 = parseIpv4ToNumber(ipv4Str);
    if (parsedIpv4 === null) return null;
    embeddedIpv4 = parsedIpv4;

    const highHex = (parsedIpv4 >>> 16).toString(16);
    const lowHex = (parsedIpv4 & 0xffff).toString(16);
    clean = `${clean.slice(0, lastColon)}:${highHex}:${lowHex}`;
  }

  const parts = clean.split('::');
  if (parts.length > 2) return null;

  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(':') : [];

  if (parts.length === 1 && left.length !== 8) return null;
  if (parts.length === 2 && left.length + right.length > 7) return null;

  const midCount = 8 - (left.length + right.length);
  const mid = new Array(midCount).fill('0');
  const full = parts.length === 2 ? [...left, ...mid, ...right] : left;
  if (full.length !== 8) return null;

  let big = 0n;
  for (const part of full) {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
    const val = BigInt(Number.parseInt(part, 16));
    big = (big << 16n) | val;
  }

  return { big, embeddedIpv4 };
}

/**
 * Checks if an IPv6 address falls into loopback, unique local (ULA), link-local,
 * multicast, IPv4-mapped, or reserved/special CIDR ranges.
 */
export function isForbiddenIpv6Address(ip: string): { isForbidden: boolean; reason?: string } {
  const parsed = parseIpv6Address(ip);
  if (!parsed) {
    return { isForbidden: true, reason: 'Invalid or malformed IPv6 address' };
  }

  const { big, embeddedIpv4 } = parsed;

  // IPv6 Unspecified (::)
  if (big === 0n) {
    return { isForbidden: true, reason: 'IPv6 unspecified address (::) is forbidden' };
  }

  // IPv6 Loopback (::1)
  if (big === 1n) {
    return { isForbidden: true, reason: 'IPv6 loopback address (::1) is forbidden' };
  }

  // IPv4-mapped IPv6 (::ffff:0:0/96)
  if (big >> 32n === 0xffffn) {
    const ipv4Val = embeddedIpv4 ?? Number(big & 0xffffffffn);
    const check = isForbiddenIpv4Number(ipv4Val);
    if (check.isForbidden) {
      return { isForbidden: true, reason: `IPv4-mapped IPv6 addresses forbidden internal IPv4: ${check.reason}` };
    }
    return { isForbidden: false };
  }

  // IPv4-translated (::ffff:0:0:0/96)
  if (big >> 48n === 0xffffn && ((big >> 32n) & 0xffffn) === 0n) {
    const ipv4Val = embeddedIpv4 ?? Number(big & 0xffffffffn);
    const check = isForbiddenIpv4Number(ipv4Val);
    if (check.isForbidden) {
      return { isForbidden: true, reason: `IPv4-translated IPv6 addresses forbidden internal IPv4: ${check.reason}` };
    }
  }

  // IPv4-compatible (::/96)
  if (big >> 32n === 0n && big > 1n) {
    const ipv4Val = embeddedIpv4 ?? Number(big & 0xffffffffn);
    const check = isForbiddenIpv4Number(ipv4Val);
    if (check.isForbidden) {
      return { isForbidden: true, reason: `IPv4-compatible IPv6 addresses forbidden internal IPv4: ${check.reason}` };
    }
  }

  // 6to4 (2002::/16) - embeds IPv4 in bits 16..47
  if (big >> 112n === 0x2002n) {
    const ipv4Val = Number((big >> 80n) & 0xffffffffn);
    const check = isForbiddenIpv4Number(ipv4Val);
    if (check.isForbidden) {
      return { isForbidden: true, reason: `6to4 IPv6 prefix embeds forbidden IPv4: ${check.reason}` };
    }
  }

  // Unique Local Addresses ULA fc00::/7 (covers fc00:: through fdff:ffff:..., including AWS IMDSv2 fd00:ec2::254)
  if (big >> 121n === 0x7en) {
    return { isForbidden: true, reason: 'IPv6 Unique Local Address (fc00::/7 ULA) is forbidden' };
  }

  // Link-local unicast fe80::/10 (fe80:: through febf:ffff:...)
  if (big >> 118n === 0x3fan) {
    return { isForbidden: true, reason: 'IPv6 link-local unicast (fe80::/10) is forbidden' };
  }

  // Multicast ff00::/8
  if (big >> 120n === 0xffn) {
    return { isForbidden: true, reason: 'IPv6 multicast (ff00::/8) is forbidden' };
  }

  // Discard prefix 100::/64
  if (big >> 64n === 0x0100000000000000n) {
    return { isForbidden: true, reason: 'IPv6 discard prefix (100::/64) is forbidden' };
  }

  // Documentation 2001:db8::/32
  if (big >> 96n === 0x20010db8n) {
    return { isForbidden: true, reason: 'IPv6 documentation network (2001:db8::/32) is forbidden' };
  }

  return { isForbidden: false };
}

// =============================================================================
// 2. FORBIDDEN HOSTNAMES & TLD SUFFIXES
// =============================================================================

export const FORBIDDEN_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata',
  'instance-data',
  'internal',
]);

export const FORBIDDEN_HOST_SUFFIXES = [
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.corp',
  '.intranet',
  '.onion',
  '.arpa',
  '.localhost',
];

/**
 * Validates a hostname string against forbidden internal names, private suffixes,
 * and embedded literal IP representations.
 */
export function isForbiddenHostnameString(hostname: string): { isForbidden: boolean; reason?: string } {
  let host = hostname.toLowerCase().trim();
  // Strip trailing dot if present (FQDN root)
  if (host.endsWith('.')) {
    host = host.slice(0, -1);
  }

  if (!host) {
    return { isForbidden: true, reason: 'Empty hostname is invalid' };
  }

  if (FORBIDDEN_HOSTNAMES.has(host)) {
    return { isForbidden: true, reason: `Hostname "${host}" is an internal forbidden name` };
  }

  for (const suffix of FORBIDDEN_HOST_SUFFIXES) {
    if (host.endsWith(suffix)) {
      return { isForbidden: true, reason: `Domain suffix "${suffix}" indicates an internal private network` };
    }
  }

  // Check if hostname is an IPv4 representation
  const ipv4Num = parseIpv4ToNumber(host);
  if (ipv4Num !== null) {
    const res = isForbiddenIpv4Number(ipv4Num);
    if (res.isForbidden) return res;
  }

  // Check if hostname is an IPv6 representation
  if (host.includes(':') || host.startsWith('[') || host.endsWith(']')) {
    const res = isForbiddenIpv6Address(host);
    if (res.isForbidden) return res;
  }

  return { isForbidden: false };
}

// =============================================================================
// 3. PUBLIC IP ASSERTIONS
// =============================================================================

/**
 * Asserts that the given IP string is a valid, publicly routable IP address.
 * Throws a typed MuxaroError (SSRF_BLOCKED) if the IP falls into any forbidden
 * CIDR range (loopback, RFC1918, CGNAT, link-local/cloud metadata, ULA, multicast,
 * broadcast, or IPv4-mapped private IP) or is malformed.
 */
export function assertPublicIp(ip: string): void {
  const trimmed = ip.trim();
  if (!trimmed) {
    throw MuxaroError.ssrfBlocked('IP address cannot be empty');
  }

  // Attempt IPv4 evaluation
  const ipv4Num = parseIpv4ToNumber(trimmed);
  if (ipv4Num !== null) {
    const check = isForbiddenIpv4Number(ipv4Num);
    if (check.isForbidden) {
      throw MuxaroError.ssrfBlocked(check.reason ?? `IPv4 address ${trimmed} is in a forbidden range`);
    }
    return;
  }

  // Attempt IPv6 evaluation
  if (trimmed.includes(':') || trimmed.startsWith('[') || trimmed.endsWith(']')) {
    const check = isForbiddenIpv6Address(trimmed);
    if (check.isForbidden) {
      throw MuxaroError.ssrfBlocked(check.reason ?? `IPv6 address ${trimmed} is in a forbidden range`);
    }
    return;
  }

  // If it's a hostname or unparseable string passed as an IP
  const hostCheck = isForbiddenHostnameString(trimmed);
  if (hostCheck.isForbidden) {
    throw MuxaroError.ssrfBlocked(hostCheck.reason ?? `Target "${trimmed}" is forbidden`);
  }

  throw MuxaroError.ssrfBlocked(`Invalid or non-public IP address: "${trimmed}"`);
}

/**
 * Helper to check whether an IP string is a safe public IP without throwing.
 */
export function isPublicIp(ip: string): boolean {
  try {
    assertPublicIp(ip);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// 4. URL PRE-FLIGHT VALIDATOR
// =============================================================================

export interface ValidatedFetchUrl {
  readonly url: URL;
  readonly href: string;
  readonly hostname: string;
  readonly protocol: 'http:' | 'https:';
  readonly port: number;
}

/**
 * Validates a target URL before fetching:
 * - Ensures scheme is strictly http: or https:
 * - Rejects URLs with embedded user credentials (user:pass@host)
 * - Enforces allowed ports strictly: only standard ports 80 and 443 are allowed
 * - Rejects forbidden internal hostnames, cloud metadata names, and literal private IPs
 */
export function validateFetchUrl(input: string | URL): ValidatedFetchUrl {
  let parsed: URL;
  if (typeof input === 'string') {
    const raw = input.trim();
    if (!raw) {
      throw MuxaroError.invalidUrl('Fetch URL cannot be empty');
    }
    try {
      parsed = new URL(raw);
    } catch {
      throw MuxaroError.invalidUrl(`Malformed URL: "${raw}"`);
    }
  } else {
    parsed = input;
  }

  // 1. Strict Protocol Enforcement
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw MuxaroError.invalidUrl(
      `Protocol "${parsed.protocol}" is not supported. Only http: and https: are allowed.`
    );
  }

  // 2. Reject Embedded Credentials
  if (parsed.username !== '' || parsed.password !== '') {
    throw MuxaroError.ssrfBlocked('URLs with embedded credentials (user:pass@host) are forbidden');
  }

  // 3. Strict Port Enforcement (Allow only 80 and 443)
  let effectivePort: number;
  if (parsed.port === '') {
    effectivePort = parsed.protocol === 'https:' ? 443 : 80;
  } else {
    const portNum = Number.parseInt(parsed.port, 10);
    if (Number.isNaN(portNum) || portNum <= 0 || portNum > 65535) {
      throw MuxaroError.invalidUrl(`Invalid port number: "${parsed.port}"`);
    }
    if (portNum !== 80 && portNum !== 443) {
      throw MuxaroError.ssrfBlocked(
        `Non-standard port ${portNum} is blocked. Only ports 80 and 443 are permitted.`
      );
    }
    if (parsed.protocol === 'http:' && portNum !== 80) {
      throw MuxaroError.ssrfBlocked(`HTTP requests are only permitted on port 80 (received ${portNum})`);
    }
    if (parsed.protocol === 'https:' && portNum !== 443) {
      throw MuxaroError.ssrfBlocked(`HTTPS requests are only permitted on port 443 (received ${portNum})`);
    }
    effectivePort = portNum;
  }

  // 4. Hostname & IP Validation
  const hostname = parsed.hostname;
  const hostCheck = isForbiddenHostnameString(hostname);
  if (hostCheck.isForbidden) {
    throw MuxaroError.ssrfBlocked(hostCheck.reason ?? `Hostname "${hostname}" is forbidden`);
  }

  return {
    url: parsed,
    href: parsed.href,
    hostname,
    protocol: parsed.protocol as 'http:' | 'https:',
    port: effectivePort,
  };
}

// =============================================================================
// 5. UNDICI AGENT WITH CONNECT.LOOKUP HOOK (DNS REBINDING DEFENSE)
// =============================================================================

export interface SsrfAgentOptions {
  readonly connectTimeoutMs?: number;
  readonly keepAliveTimeoutMs?: number;
}

/**
 * Creates an Undici Agent that intercepts DNS resolution at socket-connect time.
 * Every resolved IP address (A or AAAA) is verified against all forbidden CIDR ranges,
 * completely neutralizing Time-of-Check to Time-of-Use (TOCTOU) DNS rebinding attacks.
 */
export function createSsrfSafeAgent(options?: SsrfAgentOptions): Agent {
  const connectTimeoutMs = options?.connectTimeoutMs ?? 10_000;
  const keepAliveTimeoutMs = options?.keepAliveTimeoutMs ?? 4_000;

  return new Agent({
    connect: {
      timeout: connectTimeoutMs,
      lookup: (
        hostname: string,
        lookupOptions: dns.LookupOptions | ((err: NodeJS.ErrnoException | null, address: any, family?: number) => void),
        callback?: (err: NodeJS.ErrnoException | null, address: any, family?: number) => void
      ) => {
        let actualCallback = callback;
        let actualOptions: dns.LookupOptions = {};

        if (typeof lookupOptions === 'function') {
          actualCallback = lookupOptions;
          actualOptions = {};
        } else if (lookupOptions) {
          actualOptions = lookupOptions;
        }

        if (!actualCallback) {
          return;
        }

        // 1. Static check on hostname
        const hostCheck = isForbiddenHostnameString(hostname);
        if (hostCheck.isForbidden) {
          return actualCallback(
            MuxaroError.ssrfBlocked(hostCheck.reason ?? `Forbidden hostname: ${hostname}`) as unknown as NodeJS.ErrnoException,
            null
          );
        }

        // 2. Resolve DNS and inspect resolved socket IP(s)
        dns.lookup(hostname, actualOptions, (err, address, family) => {
          if (err) {
            return actualCallback!(err, null);
          }

          // Case A: Options.all === true returns array of { address, family }
          if (Array.isArray(address)) {
            if (address.length === 0) {
              return actualCallback!(
                new Error(`DNS resolution returned zero addresses for ${hostname}`) as NodeJS.ErrnoException,
                null
              );
            }

            for (const item of address) {
              try {
                assertPublicIp(item.address);
              } catch (validationErr: any) {
                return actualCallback!(
                  MuxaroError.ssrfBlocked(
                    `DNS resolution for "${hostname}" returned forbidden IP "${item.address}": ${validationErr.message}`
                  ) as unknown as NodeJS.ErrnoException,
                  null
                );
              }
            }
            return actualCallback!(null, address);
          }

          // Case B: Single IP address string
          if (typeof address === 'string') {
            try {
              assertPublicIp(address);
            } catch (validationErr: any) {
              return actualCallback!(
                MuxaroError.ssrfBlocked(
                  `DNS resolution for "${hostname}" returned forbidden IP "${address}": ${validationErr.message}`
                ) as unknown as NodeJS.ErrnoException,
                null
              );
            }
            return actualCallback!(null, address, family);
          }

          return actualCallback!(null, address, family);
        });
      },
    },
    pipelining: 0,
    keepAliveTimeout: keepAliveTimeoutMs,
  });
}

/**
 * Global default SSRF-safe Undici Agent instance.
 */
export const defaultSsrfSafeAgent: Agent = createSsrfSafeAgent();

// =============================================================================
// 6. PRODUCTION-GRADE SSRF-SAFE FETCH IMPLEMENTATION
// =============================================================================

export interface SsrfFetchOptions extends Omit<RequestInit, 'redirect'> {
  readonly maxRedirects?: number;
  readonly timeoutMs?: number;
  readonly dispatcher?: Dispatcher;
}

/**
 * Bulletproof, SSRF-safe and DNS-rebinding-safe HTTP fetcher:
 * - Validates input URL syntax, protocols (http/https only), ports (80/443 only), and credentials.
 * - Enforces socket-connect-time IP validation via custom Undici Agent lookup hook.
 * - Handles redirects manually (up to maxRedirects, default: 3), validating each hop's
 *   Location URL and socket destination IP before proceeding.
 */
export async function ssrfSafeFetch(
  url: string | URL,
  options?: SsrfFetchOptions
): Promise<Response> {
  const maxRedirects = options?.maxRedirects ?? 3;
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const dispatcher = options?.dispatcher ?? defaultSsrfSafeAgent;

  let currentUrl = typeof url === 'string' ? url : url.href;
  let currentMethod = (options?.method ?? 'GET').toUpperCase();
  let currentBody: BodyInit | null | undefined = options?.body;
  let redirectCount = 0;

  while (true) {
    // 1. Validate URL syntax, protocol, ports (80/443), credentials, host
    const validated = validateFetchUrl(currentUrl);

    // 2. Setup timeout & abort signal
    let signal = options?.signal;
    let timer: NodeJS.Timeout | undefined;
    if (timeoutMs > 0) {
      const timeoutController = new AbortController();
      timer = setTimeout(() => {
        timeoutController.abort(new Error(`SSRF safe fetch timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      if (signal) {
        signal = AbortSignal.any([signal, timeoutController.signal]);
      } else {
        signal = timeoutController.signal;
      }
    }

    let response: Response;
    try {
      response = await fetch(validated.href, {
        ...options,
        method: currentMethod,
        body: currentBody,
        redirect: 'manual',
        dispatcher,
        signal,
      });
    } catch (err: any) {
      // Unwrap SSRF-blocked errors emitted by the socket connect lookup hook
      const cause = err?.cause ?? err;
      if (MuxaroError.isMuxaroError(cause)) {
        throw cause;
      }
      if (cause?.message && (cause.message.includes('SSRF_BLOCKED') || cause.message.includes('is forbidden'))) {
        throw MuxaroError.ssrfBlocked(cause.message);
      }
      throw err;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }

    // 3. Check for HTTP redirect response codes
    const status = response.status;
    const isRedirect = [301, 302, 303, 307, 308].includes(status);
    if (!isRedirect) {
      return response;
    }

    // 4. Enforce max redirects
    if (redirectCount >= maxRedirects) {
      throw MuxaroError.badRequest(
        `Exceeded maximum redirect limit of ${maxRedirects} redirects`
      );
    }

    const locationHeader = response.headers.get('location');
    if (!locationHeader) {
      throw MuxaroError.invalidUrl(
        `Redirect response with status ${status} is missing Location header`
      );
    }

    // 5. Parse and validate the redirected Location URL relative to currentUrl
    let nextUrl: URL;
    try {
      nextUrl = new URL(locationHeader, currentUrl);
    } catch {
      throw MuxaroError.invalidUrl(`Malformed redirect Location header: "${locationHeader}"`);
    }

    // Pre-flight validate the redirected target URL before issuing next request
    validateFetchUrl(nextUrl);

    // 6. Handle HTTP redirect method and body transitions
    // - 303: always switch to GET and drop request body
    // - 301/302: switch POST to GET and drop request body
    // - 307/308: preserve method and body
    if (status === 303 || ((status === 301 || status === 302) && currentMethod === 'POST')) {
      currentMethod = 'GET';
      currentBody = null;
    }

    redirectCount++;
    currentUrl = nextUrl.href;
  }
}
