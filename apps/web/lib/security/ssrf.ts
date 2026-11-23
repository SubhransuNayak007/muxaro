/**
 * MUXARO SSRF Protection & URL Validator
 * Strictly validates URLs and resolves DNS to protect against Server-Side Request Forgery (SSRF),
 * DNS rebinding, private network access, cloud metadata theft, and loopback exploitation.
 */

import { URL } from 'node:url';
import dns from 'node:dns/promises';
import net from 'node:net';

export interface SsrfValidationResult {
  valid: boolean;
  normalizedUrl: string;
  error?: string;
  resolvedIps?: string[];
}

// Blocked hostnames (exact or suffix)
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'local',
  'broadcasthost',
  'metadata.google.internal',
  'metadata',
  'instance-data',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

const BLOCKED_DOMAIN_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.corp',
  '.lan',
  '.home',
  '.home.arpa',
];

/**
 * Converts a standard dotted-quad IPv4 string into a 32-bit unsigned integer.
 * Strictly rejects non-canonical notations (octal with leading zero, hex, out-of-range).
 */
export function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let intVal = 0;
  for (let i = 0; i < 4; i++) {
    const raw = parts[i];
    // Reject empty, leading zeros (octal ambiguity), non-numeric characters
    if (!/^\d+$/.test(raw)) return null;
    if (raw.length > 1 && raw.startsWith('0')) return null;

    const num = Number(raw);
    if (!Number.isInteger(num) || num < 0 || num > 255) return null;

    intVal = ((intVal << 8) | num) >>> 0;
  }
  return intVal;
}

/**
 * Checks if a 32-bit unsigned IPv4 integer falls into any private, loopback,
 * link-local, cloud metadata, or non-routable CIDR range.
 */
export function isIpv4Blocked(ipInt: number): { blocked: boolean; reason?: string } {
  // 0.0.0.0/8 (Current network / "this" host)
  if ((ipInt >>> 24) === 0) {
    return { blocked: true, reason: 'Current network (0.0.0.0/8) is non-routable.' };
  }

  // 127.0.0.0/8 (Loopback)
  if ((ipInt >>> 24) === 127) {
    return { blocked: true, reason: 'Loopback address (127.0.0.0/8) is strictly prohibited.' };
  }

  // 10.0.0.0/8 (RFC1918 Private)
  if ((ipInt >>> 24) === 10) {
    return { blocked: true, reason: 'RFC1918 private address (10.0.0.0/8) is prohibited.' };
  }

  // 100.64.0.0/10 (Shared Address Space / Carrier-Grade NAT RFC6598)
  if ((ipInt & 0xffc00000) === 0x64400000) {
    return { blocked: true, reason: 'Shared carrier-grade NAT space (100.64.0.0/10) is prohibited.' };
  }

  // 169.254.0.0/16 (Link-Local & Cloud Metadata, e.g. 169.254.169.254)
  if ((ipInt >>> 16) === 0xa9fe) {
    return { blocked: true, reason: 'Link-local / cloud metadata (169.254.0.0/16) is prohibited.' };
  }

  // 172.16.0.0/12 (RFC1918 Private: 172.16.0.0 - 172.31.255.255)
  if ((ipInt >>> 20) === 0xac1) {
    return { blocked: true, reason: 'RFC1918 private address (172.16.0.0/12) is prohibited.' };
  }

  // 192.0.0.0/24 (IETF Protocol Assignments)
  if ((ipInt >>> 8) === 0xc00000) {
    return { blocked: true, reason: 'IETF protocol assignment space (192.0.0.0/24) is non-routable.' };
  }

  // 192.0.2.0/24 (TEST-NET-1 Documentation)
  if ((ipInt >>> 8) === 0xc00002) {
    return { blocked: true, reason: 'Documentation address (192.0.2.0/24) is non-routable.' };
  }

  // 192.168.0.0/16 (RFC1918 Private)
  if ((ipInt >>> 16) === 0xc0a8) {
    return { blocked: true, reason: 'RFC1918 private address (192.168.0.0/16) is prohibited.' };
  }

  // 198.18.0.0/15 (Benchmarking)
  if ((ipInt & 0xfffe0000) === 0xc6120000) {
    return { blocked: true, reason: 'Benchmark testing range (198.18.0.0/15) is non-routable.' };
  }

  // 198.51.100.0/24 (TEST-NET-2 Documentation)
  if ((ipInt >>> 8) === 0xc63364) {
    return { blocked: true, reason: 'Documentation address (198.51.100.0/24) is non-routable.' };
  }

  // 203.0.113.0/24 (TEST-NET-3 Documentation)
  if ((ipInt >>> 8) === 0xcb0071) {
    return { blocked: true, reason: 'Documentation address (203.0.113.0/24) is non-routable.' };
  }

  // 224.0.0.0/4 (Multicast: 224.0.0.0 - 239.255.255.255)
  if ((ipInt >>> 28) === 14) {
    return { blocked: true, reason: 'Multicast address range (224.0.0.0/4) is non-routable.' };
  }

  // 240.0.0.0/4 (Reserved / Future Use & Broadcast 255.255.255.255)
  if ((ipInt >>> 28) === 15) {
    return { blocked: true, reason: 'Reserved / broadcast address (240.0.0.0/4) is non-routable.' };
  }

  return { blocked: false };
}

/**
 * Checks if an IPv6 address string is private, loopback, link-local, unique local,
 * or non-routable. Also handles IPv4-mapped IPv6 (::ffff:x.x.x.x).
 */
export function isIpv6Blocked(ip: string): { blocked: boolean; reason?: string } {
  const normalized = ip.toLowerCase().trim();

  // IPv4-mapped IPv6 check (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  const mappedMatch = normalized.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedMatch) {
    const ipv4Int = ipv4ToInt(mappedMatch[1]);
    if (ipv4Int !== null) {
      return isIpv4Blocked(ipv4Int);
    }
    return { blocked: true, reason: 'Invalid IPv4-mapped address.' };
  }

  // Unspecified address (::)
  if (normalized === '::' || /^0(:0){1,7}$/.test(normalized)) {
    return { blocked: true, reason: 'Unspecified IPv6 address (::) is prohibited.' };
  }

  // Loopback (::1)
  if (normalized === '::1' || /^0(:0){6}:1$/.test(normalized)) {
    return { blocked: true, reason: 'IPv6 loopback (::1) is prohibited.' };
  }

  // Unique Local Address (fc00::/7 -> fc00:: through fdff::)
  if (/^f[cd][0-9a-f]{2}:/i.test(normalized) || /^f[cd]::/i.test(normalized)) {
    return { blocked: true, reason: 'IPv6 Unique Local Address (fc00::/7) is prohibited.' };
  }

  // Link-Local (fe80::/10 -> fe80:: through febf::)
  if (/^fe[89ab][0-9a-f]:/i.test(normalized) || /^fe[89ab]::/i.test(normalized)) {
    return { blocked: true, reason: 'IPv6 Link-Local address (fe80::/10) is prohibited.' };
  }

  // Multicast (ff00::/8)
  if (/^ff[0-9a-f]{2}:/i.test(normalized) || /^ff::/i.test(normalized)) {
    return { blocked: true, reason: 'IPv6 Multicast (ff00::/8) is non-routable.' };
  }

  // Documentation (2001:db8::/32)
  if (/^2001:0?db8:/i.test(normalized) || /^2001:db8::/i.test(normalized)) {
    return { blocked: true, reason: 'IPv6 Documentation prefix (2001:db8::/32) is non-routable.' };
  }

  // Discard prefix (100::/64)
  if (/^0?100::/i.test(normalized)) {
    return { blocked: true, reason: 'IPv6 Discard-only prefix (100::/64) is non-routable.' };
  }

  return { blocked: false };
}

/**
 * Validates any IP address (IPv4 or IPv6) against all SSRF blocklists.
 */
export function isIpBlocked(ip: string): { blocked: boolean; reason?: string } {
  const trimmed = ip.trim();
  const family = net.isIP(trimmed);

  if (family === 4) {
    const intVal = ipv4ToInt(trimmed);
    if (intVal === null) {
      return { blocked: true, reason: 'Malformed IPv4 address format.' };
    }
    return isIpv4Blocked(intVal);
  }

  if (family === 6) {
    return isIpv6Blocked(trimmed);
  }

  return { blocked: true, reason: 'Unrecognized IP address format.' };
}

/**
 * Checks whether a hostname is inherently private or blocked (e.g., localhost, metadata).
 */
export function isPrivateOrBlockedHost(rawHostname: string): boolean {
  let hostname = rawHostname.toLowerCase().trim();

  // Strip trailing dot
  if (hostname.endsWith('.')) {
    hostname = hostname.slice(0, -1);
  }

  // Strip IPv6 brackets [::1] -> ::1
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return true;
  }

  for (const suffix of BLOCKED_DOMAIN_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return true;
    }
  }

  // If the hostname is an IP literal, check it directly
  if (net.isIP(hostname)) {
    return isIpBlocked(hostname).blocked;
  }

  return false;
}

/**
 * Strictly validates a URL against SSRF threats:
 * 1. Requires HTTP or HTTPS protocols only.
 * 2. Blocks invalid characters, shell escapes, and control codes.
 * 3. Rejects known private hostnames, local domain suffixes, and cloud metadata.
 * 4. Resolves DNS to all IP addresses (A and AAAA records) and checks every resolved IP.
 * 5. Strictly blocks loopback (127.0.0.0/8, ::1), RFC1918 private ranges, link-local,
 *    cloud metadata (169.254.169.254), multicast, and non-routable addresses.
 */
export async function validateSsrfUrl(rawUrl: string): Promise<SsrfValidationResult> {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    return { valid: false, normalizedUrl: '', error: 'URL cannot be empty.' };
  }

  // Prevent control characters, newlines, null bytes, shell interpolation
  if (/[\r\n\0`$<>"\\]/.test(trimmed)) {
    return { valid: false, normalizedUrl: '', error: 'URL contains illegal or unescaped characters.' };
  }

  // Reject unsupported schemes before URL parsing (e.g. file:, ftp:, gopher:, javascript:, data:)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return { valid: false, normalizedUrl: '', error: 'Only HTTP and HTTPS protocols are permitted.' };
  }

  let parsed: URL;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    parsed = new URL(withProtocol);
  } catch {
    return { valid: false, normalizedUrl: '', error: 'Malformed URL format.' };
  }

  // Only allow http and https schemes
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, normalizedUrl: '', error: 'Only HTTP and HTTPS protocols are permitted.' };
  }

  let hostname = parsed.hostname.toLowerCase();
  if (hostname.endsWith('.')) {
    hostname = hostname.slice(0, -1);
  }
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }

  if (!hostname) {
    return { valid: false, normalizedUrl: '', error: 'URL hostname is missing.' };
  }

  // Check static hostname and IP blocklist
  if (isPrivateOrBlockedHost(hostname)) {
    return {
      valid: false,
      normalizedUrl: '',
      error: `Access to internal, private, or metadata host "${hostname}" is prohibited.`,
    };
  }

  // Resolve DNS to IP addresses to prevent DNS rebinding and internal network scanning
  const resolvedIps: string[] = [];

  if (net.isIP(hostname)) {
    const check = isIpBlocked(hostname);
    if (check.blocked) {
      return {
        valid: false,
        normalizedUrl: '',
        error: `Access to prohibited IP "${hostname}" is blocked: ${check.reason || 'Restricted range.'}`,
      };
    }
    resolvedIps.push(hostname);
  } else {
    try {
      // Lookup all IPv4 and IPv6 records for the host
      const records = await dns.lookup(hostname, { all: true });
      if (!records || records.length === 0) {
        return {
          valid: false,
          normalizedUrl: '',
          error: `Could not resolve hostname "${hostname}".`,
        };
      }

      for (const record of records) {
        resolvedIps.push(record.address);
        const check = isIpBlocked(record.address);
        if (check.blocked) {
          return {
            valid: false,
            normalizedUrl: '',
            resolvedIps,
            error: `SSRF validation failed: Hostname "${hostname}" resolved to prohibited IP "${record.address}" (${check.reason || 'Restricted range'}).`,
          };
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'DNS lookup error';
      return {
        valid: false,
        normalizedUrl: '',
        error: `DNS resolution failed for "${hostname}": ${msg}`,
      };
    }
  }

  return {
    valid: true,
    normalizedUrl: parsed.toString(),
    resolvedIps,
  };
}

/**
 * Asserts that a URL is safe from SSRF threats; throws an Error if invalid.
 */
export async function assertSafeUrl(rawUrl: string): Promise<string> {
  const result = await validateSsrfUrl(rawUrl);
  if (!result.valid) {
    throw new Error(result.error || 'SSRF URL validation failed.');
  }
  return result.normalizedUrl;
}
