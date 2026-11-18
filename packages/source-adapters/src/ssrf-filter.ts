/**
 * Project MUXARO - Source Adapter SSRF & Host Validation Filter
 * 
 * Provides self-contained SSRF defenses for HTTP inspection:
 * - Protocol validation (strictly http: and https:)
 * - Detection and rejection of IPv4 loopback (127.0.0.0/8), private (10/8, 172.16/12, 192.168/16),
 *   link-local (169.254/16), cloud metadata (169.254.169.254), CGNAT (100.64/10), multicast (224/4).
 * - IPv6 loopback (::1), IPv4-mapped IPv6 (::ffff:127.0.0.1), link-local (fe80::/10), unique local (fc00::/7).
 * - Obfuscated IP parsing (decimal integer 2130706433, hex 0x7f000001, octal 0177.0.0.1).
 * - Hostname validation (rejection of localhost, internal/local domains, cloud metadata names).
 * - Supports plugging in an external SSRF validator hook.
 */

import * as dns from 'node:dns/promises';
import { SSRFBlockedError } from './errors.ts';

export interface SsrfCheckResult {
  isSafe: boolean;
  reason?: string;
  normalizedUrl?: string;
  hostname?: string;
  resolvedIps?: string[];
}

/**
 * Convert dotted IPv4 string or integer to 32-bit unsigned number
 */
export function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length === 4) {
    let num = 0;
    for (const part of parts) {
      if (!/^\d+$/.test(part)) return null;
      const n = Number.parseInt(part, 10);
      if (n < 0 || n > 255) return null;
      num = (num << 8) + n;
    }
    return num >>> 0;
  }
  // Single decimal integer (e.g. 2130706433)
  if (/^\d+$/.test(ip)) {
    const val = Number(ip);
    if (val >= 0 && val <= 0xffffffff) return val >>> 0;
  }
  // Hex notation (e.g. 0x7f000001)
  if (/^0x[0-9a-f]+$/i.test(ip)) {
    const val = Number.parseInt(ip, 16);
    if (val >= 0 && val <= 0xffffffff) return val >>> 0;
  }
  return null;
}

/**
 * Check if a 32-bit IPv4 address falls into forbidden/private/internal ranges
 */
export function isForbiddenIpv4(num: number): { isBlocked: boolean; reason?: string } {
  // 0.0.0.0/8 - Current network
  if ((num & 0xff000000) === 0x00000000) {
    return { isBlocked: true, reason: 'Current network (0.0.0.0/8) is forbidden' };
  }
  // 127.0.0.0/8 - Loopback
  if ((num & 0xff000000) === 0x7f000000) {
    return { isBlocked: true, reason: 'Loopback address (127.0.0.0/8) is forbidden' };
  }
  // 10.0.0.0/8 - RFC1918 Private
  if ((num & 0xff000000) === 0x0a000000) {
    return { isBlocked: true, reason: 'RFC1918 private address (10.0.0.0/8) is forbidden' };
  }
  // 172.16.0.0/12 - RFC1918 Private (172.16.0.0 - 172.31.255.255)
  if (((num & 0xfff00000) >>> 0) === 0xac100000) {
    return { isBlocked: true, reason: 'RFC1918 private address (172.16.0.0/12) is forbidden' };
  }
  // 192.168.0.0/16 - RFC1918 Private
  if (((num & 0xffff0000) >>> 0) === 0xc0a80000) {
    return { isBlocked: true, reason: 'RFC1918 private address (192.168.0.0/16) is forbidden' };
  }
  // 169.254.0.0/16 - Link-local / Cloud metadata (AWS/GCP/Azure 169.254.169.254)
  if (((num & 0xffff0000) >>> 0) === 0xa9fe0000) {
    return { isBlocked: true, reason: 'Link-local and cloud metadata (169.254.0.0/16) is forbidden' };
  }
  // 100.64.0.0/10 - Shared address space (CGNAT)
  if (((num & 0xffc00000) >>> 0) === 0x64400000) {
    return { isBlocked: true, reason: 'Shared address space (100.64.0.0/10) is forbidden' };
  }
  // 192.0.0.0/24 - IETF Protocol Assignments
  if (((num & 0xffffff00) >>> 0) === 0xc0000000) {
    return { isBlocked: true, reason: 'IETF protocol assignment (192.0.0.0/24) is forbidden' };
  }
  // 198.18.0.0/15 - Network benchmark tests
  if (((num & 0xfffe0000) >>> 0) === 0xc6120000) {
    return { isBlocked: true, reason: 'Benchmark test address (198.18.0.0/15) is forbidden' };
  }
  // 224.0.0.0/4 - Multicast
  if (((num & 0xf0000000) >>> 0) === 0xe0000000) {
    return { isBlocked: true, reason: 'Multicast address (224.0.0.0/4) is forbidden' };
  }
  // 240.0.0.0/4 - Reserved (including 255.255.255.255 broadcast)
  if (((num & 0xf0000000) >>> 0) === 0xf0000000) {
    return { isBlocked: true, reason: 'Reserved/Broadcast address (240.0.0.0/4) is forbidden' };
  }
  return { isBlocked: false };
}

/**
 * Check if an IPv6 address is internal/loopback/cloud metadata
 */
export function isForbiddenIpv6(ip: string): { isBlocked: boolean; reason?: string } {
  const clean = ip.toLowerCase().replace(/^\[|\]$/g, '');

  // Loopback ::1
  if (clean === '::1' || clean === '0000:0000:0000:0000:0000:0000:0000:0001') {
    return { isBlocked: true, reason: 'IPv6 loopback (::1) is forbidden' };
  }
  // Unspecified ::
  if (clean === '::' || clean === '0000:0000:0000:0000:0000:0000:0000:0000') {
    return { isBlocked: true, reason: 'IPv6 unspecified (::) is forbidden' };
  }
  // IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (clean.startsWith('::ffff:') || clean.startsWith('0:0:0:0:0:ffff:')) {
    const ipv4Part = clean.replace(/^(?:0:0:0:0:0:ffff:|::ffff:)/, '');
    const num = ipv4ToNumber(ipv4Part);
    if (num !== null) {
      return isForbiddenIpv4(num);
    }
    return { isBlocked: true, reason: 'IPv4-mapped IPv6 internal address is forbidden' };
  }
  // Link-local fe80::/10
  if (/^fe[89ab][0-9a-f]:/i.test(clean)) {
    return { isBlocked: true, reason: 'IPv6 link-local (fe80::/10) is forbidden' };
  }
  // Unique local fc00::/7 (fc00:: - fdff::)
  if (/^f[cd][0-9a-f]{2}:/i.test(clean)) {
    return { isBlocked: true, reason: 'IPv6 unique local (fc00::/7) is forbidden' };
  }

  return { isBlocked: false };
}

/**
 * Blocked hostname patterns (internal, cloud metadata, dev)
 */
const FORBIDDEN_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata',
  'instance-data',
  '169.254.169.254',
  '127.0.0.1',
  '0.0.0.0',
]);

const FORBIDDEN_HOST_SUFFIXES = [
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.corp',
  '.intranet',
  '.onion',
];

export interface SsrfValidationOptions {
  resolveDns?: boolean;
  allowLoopback?: boolean;
  customValidator?: (url: string) => Promise<{ isSafe: boolean; override?: boolean; reason?: string }>;
}

/**
 * Validate a target URL against SSRF hazards
 */
export async function validateSsrfSafety(
  rawUrl: string,
  options?: SsrfValidationOptions
): Promise<SsrfCheckResult> {
  // 1. Run custom validator if provided
  if (options?.customValidator) {
    const res = await options.customValidator(rawUrl);
    if (!res.isSafe) {
      return { isSafe: false, reason: res.reason || 'Blocked by custom SSRF validator' };
    }
    if (res.override) {
      return { isSafe: true, normalizedUrl: rawUrl };
    }
  }

  // 2. Syntax and protocol check
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { isSafe: false, reason: 'Invalid or malformed URL syntax' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { isSafe: false, reason: `Protocol ${parsed.protocol} is forbidden (only http: and https: permitted)` };
  }

  // Reject credentials in URL (e.g. http://user:pass@example.com)
  if (parsed.username || parsed.password) {
    return { isSafe: false, reason: 'Credentials embedded in URL are forbidden' };
  }

  const hostname = parsed.hostname.toLowerCase().trim();

  // Reject empty hostname
  if (!hostname) {
    return { isSafe: false, reason: 'Missing hostname in URL' };
  }

  if (options?.allowLoopback && (hostname === '127.0.0.1' || hostname === 'localhost')) {
    return { isSafe: true, hostname, normalizedUrl: parsed.toString() };
  }

  // 3. Known forbidden hostnames
  if (FORBIDDEN_HOSTNAMES.has(hostname)) {
    return { isSafe: false, hostname, reason: `Hostname '${hostname}' is a reserved internal or metadata name` };
  }

  // 4. Forbidden domain suffixes
  for (const suffix of FORBIDDEN_HOST_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return { isSafe: false, hostname, reason: `Internal domain suffix '${suffix}' is forbidden` };
    }
  }

  // 5. Direct IP literal checks
  const ipv4Num = ipv4ToNumber(hostname);
  if (ipv4Num !== null) {
    const check = isForbiddenIpv4(ipv4Num);
    if (check.isBlocked) {
      return { isSafe: false, hostname, reason: check.reason };
    }
  }

  if (hostname.startsWith('[') || hostname.includes(':')) {
    const check = isForbiddenIpv6(hostname);
    if (check.isBlocked) {
      return { isSafe: false, hostname, reason: check.reason };
    }
  }

  // 6. Optional DNS resolution check (default true for network safety)
  if (options?.resolveDns !== false) {
    try {
      const records = await dns.lookup(hostname, { all: true });
      const resolvedIps: string[] = [];

      for (const record of records) {
        resolvedIps.push(record.address);
        if (record.family === 4) {
          const num = ipv4ToNumber(record.address);
          if (num !== null) {
            const check = isForbiddenIpv4(num);
            if (check.isBlocked) {
              return {
                isSafe: false,
                hostname,
                resolvedIps,
                reason: `Hostname '${hostname}' resolved to blocked IP ${record.address}: ${check.reason}`,
              };
            }
          }
        } else if (record.family === 6) {
          const check = isForbiddenIpv6(record.address);
          if (check.isBlocked) {
            return {
              isSafe: false,
              hostname,
              resolvedIps,
              reason: `Hostname '${hostname}' resolved to blocked IPv6 ${record.address}: ${check.reason}`,
            };
          }
        }
      }

      return {
        isSafe: true,
        hostname,
        resolvedIps,
        normalizedUrl: parsed.toString(),
      };
    } catch (err: unknown) {
      // If DNS lookup fails due to non-existent host or network error
      const message = err instanceof Error ? err.message : String(err);
      return {
        isSafe: false,
        hostname,
        reason: `DNS resolution failed for '${hostname}': ${message}`,
      };
    }
  }

  return {
    isSafe: true,
    hostname,
    normalizedUrl: parsed.toString(),
  };
}

/**
 * Assert that a URL is SSRF safe, throwing SSRFBlockedError if unsafe
 */
export async function assertSsrfSafe(
  url: string,
  options?: SsrfValidationOptions
): Promise<string> {
  const result = await validateSsrfSafety(url, options);
  if (!result.isSafe) {
    throw new SSRFBlockedError(result.reason || 'Target URL is blocked by SSRF defense', {
      url,
      hostname: result.hostname,
      resolvedIps: result.resolvedIps,
    });
  }
  return result.normalizedUrl || url;
}
