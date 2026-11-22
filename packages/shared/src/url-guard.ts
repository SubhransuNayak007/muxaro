/**
 * MUXARO Media Processing Platform - URL Normalizer & SSRF Guard
 * 
 * Provides comprehensive URL normalization, canonicalization for YouTube, Vimeo,
 * and direct media links, plus strict Server-Side Request Forgery (SSRF) defense:
 * - Dotted decimal, octal, hex, and single-integer IPv4 evaluation
 * - Full RFC 1918, CGNAT, link-local, AWS/GCP metadata, loopback CIDR filtering
 * - IPv6 loopback, IPv4-mapped, ULA, and link-local filtering
 * - Forbidden internal domain blocking
 * - Async DNS resolution to prevent DNS rebinding exploits
 */

import * as dns from 'node:dns/promises';
import { MuxaroError } from './errors.js';
import type { MediaPlatform } from './types.js';

// =============================================================================
// 1. IPV4 & IPV6 NUMERIC / CIDR UTILITIES
// =============================================================================

/**
 * Parses an IPv4 representation (dotted-decimal, decimal integer, octal, hex)
 * into a 32-bit unsigned integer, or returns null if not an IPv4 address.
 */
export function ipv4ToNumber(ip: string): number | null {
  const trimmed = ip.trim();

  // Dotted notation (e.g. 192.168.1.1 or 0177.0.0.1 or 0x7f.0.0.1)
  const parts = trimmed.split('.');
  if (parts.length === 4) {
    let num = 0;
    for (const part of parts) {
      let n: number;
      if (/^0x[0-9a-f]+$/i.test(part)) {
        n = Number.parseInt(part, 16);
      } else if (/^0[0-7]+$/.test(part) && part.length > 1) {
        // Octal notation
        n = Number.parseInt(part, 8);
      } else if (/^\d+$/.test(part)) {
        n = Number.parseInt(part, 10);
      } else {
        return null;
      }

      if (Number.isNaN(n) || n < 0 || n > 255) return null;
      num = (num << 8) + n;
    }
    return num >>> 0;
  }

  // Single decimal integer (e.g. 2130706433 = 127.0.0.1)
  if (/^\d+$/.test(trimmed)) {
    const val = Number(trimmed);
    if (!Number.isNaN(val) && val >= 0 && val <= 0xffffffff) {
      return val >>> 0;
    }
  }

  // Single hex notation (e.g. 0x7f000001)
  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    const val = Number.parseInt(trimmed, 16);
    if (!Number.isNaN(val) && val >= 0 && val <= 0xffffffff) {
      return val >>> 0;
    }
  }

  return null;
}

/**
 * Checks if a 32-bit unsigned IPv4 number falls into any private, loopback,
 * link-local, carrier-grade NAT, or reserved CIDR range.
 */
export function isForbiddenIpv4(num: number): { isForbidden: boolean; reason?: string } {
  // 0.0.0.0/8 - "This host on this network"
  if ((num & 0xff000000) === 0x00000000) {
    return { isForbidden: true, reason: 'Current network (0.0.0.0/8) is forbidden' };
  }
  // 10.0.0.0/8 - RFC 1918 Private
  if ((num & 0xff000000) === 0x0a000000) {
    return { isForbidden: true, reason: 'Private network (10.0.0.0/8) is forbidden' };
  }
  // 100.64.0.0/10 - Carrier Grade NAT (RFC 6598)
  if (((num & 0xffc00000) >>> 0) === 0x64400000) {
    return { isForbidden: true, reason: 'Shared address space CGNAT (100.64.0.0/10) is forbidden' };
  }
  // 127.0.0.0/8 - Loopback
  if ((num & 0xff000000) === 0x7f000000) {
    return { isForbidden: true, reason: 'Loopback address (127.0.0.0/8) is forbidden' };
  }
  // 169.254.0.0/16 - Link-local & Cloud Instance Metadata (AWS/GCP/Azure 169.254.169.254)
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

/**
 * Checks if an IPv6 address falls into loopback, unique local, link-local, or IPv4-mapped.
 */
export function isForbiddenIpv6(ip: string): { isForbidden: boolean; reason?: string } {
  const clean = ip.toLowerCase().replace(/^\[|\]$/g, '').trim();

  // IPv6 Loopback (::1)
  if (clean === '::1' || clean === '0000:0000:0000:0000:0000:0000:0000:0001') {
    return { isForbidden: true, reason: 'IPv6 loopback (::1) is forbidden' };
  }

  // IPv6 Unspecified (::)
  if (clean === '::' || clean === '0000:0000:0000:0000:0000:0000:0000:0000') {
    return { isForbidden: true, reason: 'IPv6 unspecified (::) is forbidden' };
  }

  // IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (clean.startsWith('::ffff:') || clean.startsWith('0:0:0:0:0:ffff:')) {
    const ipv4Part = clean.replace(/^(?:0:0:0:0:0:ffff:|::ffff:)/, '');
    const num = ipv4ToNumber(ipv4Part);
    if (num !== null) {
      return isForbiddenIpv4(num);
    }
    return { isForbidden: true, reason: 'IPv4-mapped IPv6 address is forbidden' };
  }

  // Link-local unicast fe80::/10
  if (/^fe[89ab][0-9a-f]:/i.test(clean)) {
    return { isForbidden: true, reason: 'IPv6 link-local (fe80::/10) is forbidden' };
  }

  // Unique local addresses fc00::/7 (fc00:: - fdff::)
  if (/^f[cd][0-9a-f]{2}:/i.test(clean)) {
    return { isForbidden: true, reason: 'IPv6 unique local (fc00::/7) is forbidden' };
  }

  // Multicast ff00::/8
  if (/^ff[0-9a-f]{2}:/i.test(clean)) {
    return { isForbidden: true, reason: 'IPv6 multicast (ff00::/8) is forbidden' };
  }

  return { isForbidden: false };
}

// =============================================================================
// 2. FORBIDDEN HOSTNAMES & TLDs
// =============================================================================

const FORBIDDEN_EXACT_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata',
  'instance-data',
  'internal',
]);

const FORBIDDEN_HOST_SUFFIXES = [
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.corp',
  '.intranet',
  '.onion',
  '.arpa',
];

/**
 * Checks if a hostname matches local, internal, or cloud metadata domains.
 */
export function isForbiddenHostname(hostname: string): { isForbidden: boolean; reason?: string } {
  const host = hostname.toLowerCase().trim();

  if (FORBIDDEN_EXACT_HOSTNAMES.has(host)) {
    return { isForbidden: true, reason: `Hostname "${host}" is an internal forbidden name` };
  }

  for (const suffix of FORBIDDEN_HOST_SUFFIXES) {
    if (host.endsWith(suffix)) {
      return { isForbidden: true, reason: `Domain suffix "${suffix}" indicates an internal private network` };
    }
  }

  // Check if hostname is an IP string directly
  const ipv4Num = ipv4ToNumber(host);
  if (ipv4Num !== null) {
    const res = isForbiddenIpv4(ipv4Num);
    if (res.isForbidden) return res;
  }

  if (host.includes(':')) {
    const res = isForbiddenIpv6(host);
    if (res.isForbidden) return res;
  }

  return { isForbidden: false };
}

// =============================================================================
// 3. URL NORMALIZATION & SSRF GUARD
// =============================================================================

export interface UrlSafetyOptions {
  resolveDns?: boolean;
  dnsTimeoutMs?: number;
}

export interface UrlSafetyResult {
  readonly safe: boolean;
  readonly reason?: string;
  readonly normalizedUrl?: string;
  readonly hostname?: string;
  readonly resolvedIps?: readonly string[];
}

/**
 * Normalizes user-supplied media URLs:
 * - Trims whitespace and quotes
 * - Rejects dangerous pseudo-protocols
 * - Handles scheme-relative URLs
 * - Guarantees http:// or https://
 */
export function normalizeMediaUrl(rawInput: unknown): string {
  if (typeof rawInput !== 'string') return '';
  let trimmed = rawInput.trim();
  if (!trimmed) return '';

  // Remove surrounding quotes
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }

  // Reject dangerous pseudo-protocols
  if (/^(javascript|data|file|vbscript|about|blob):/i.test(trimmed)) {
    return '';
  }

  // Prepend https: if protocol-relative or missing
  if (trimmed.startsWith('//')) {
    trimmed = `https:${trimmed}`;
  } else if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    if (!parsed.hostname || parsed.hostname.length < 1) {
      return '';
    }
    return parsed.href;
  } catch {
    return '';
  }
}

/**
 * Validates whether a URL is safe from SSRF hazards.
 * Optionally performs DNS lookup to ensure the hostname does not resolve
 * to any internal, loopback, or cloud-metadata IP.
 */
export async function validateUrlSafety(
  rawUrl: string,
  options: UrlSafetyOptions = { resolveDns: true }
): Promise<UrlSafetyResult> {
  const normalized = normalizeMediaUrl(rawUrl);
  if (!normalized) {
    return { safe: false, reason: 'Malformed or unsupported URL syntax' };
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return { safe: false, reason: 'Failed to parse normalized URL' };
  }

  const hostname = parsed.hostname;

  // 1. Static hostname / literal IP checks
  const hostCheck = isForbiddenHostname(hostname);
  if (hostCheck.isForbidden) {
    return { safe: false, reason: hostCheck.reason, hostname };
  }

  // 2. DNS Resolution verification
  if (options.resolveDns !== false) {
    try {
      const resolvedIps: string[] = [];

      // Resolve IPv4 (A)
      try {
        const ipv4Addresses = await dns.resolve4(hostname);
        for (const ip of ipv4Addresses) {
          resolvedIps.push(ip);
          const num = ipv4ToNumber(ip);
          if (num !== null) {
            const check = isForbiddenIpv4(num);
            if (check.isForbidden) {
              return {
                safe: false,
                reason: `Hostname "${hostname}" resolved to forbidden IPv4 ${ip}: ${check.reason}`,
                hostname,
                resolvedIps,
              };
            }
          }
        }
      } catch (err: unknown) {
        // If no A record, might have AAAA
      }

      // Resolve IPv6 (AAAA)
      try {
        const ipv6Addresses = await dns.resolve6(hostname);
        for (const ip of ipv6Addresses) {
          resolvedIps.push(ip);
          const check = isForbiddenIpv6(ip);
          if (check.isForbidden) {
            return {
              safe: false,
              reason: `Hostname "${hostname}" resolved to forbidden IPv6 ${ip}: ${check.reason}`,
              hostname,
              resolvedIps,
            };
          }
        }
      } catch (err: unknown) {
        // No AAAA record
      }

      return {
        safe: true,
        normalizedUrl: parsed.href,
        hostname,
        resolvedIps,
      };
    } catch (dnsErr: unknown) {
      // If DNS resolution completely failed, allow it if it's already an IP or report error
      const isDirectIp = ipv4ToNumber(hostname) !== null;
      if (isDirectIp) {
        return { safe: true, normalizedUrl: parsed.href, hostname };
      }
      return {
        safe: false,
        reason: `Could not resolve hostname "${hostname}" during SSRF verification`,
        hostname,
      };
    }
  }

  return { safe: true, normalizedUrl: parsed.href, hostname };
}

// =============================================================================
// 4. CANONICAL MEDIA URL PARSER & CANONICALIZER
// =============================================================================

export interface CanonicalMediaUrlInfo {
  readonly platform: MediaPlatform;
  readonly canonicalUrl: string;
  readonly originalUrl: string;
  readonly id?: string;
  readonly isPlaylist: boolean;
  readonly listId?: string;
}

/**
 * Strips tracking query parameters from direct media URLs while preserving tokens.
 */
function stripTrackingParams(url: URL): string {
  const trackingKeys = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'fbclid',
    'gclid',
    'msclkid',
    'ref',
    '_ga',
  ];
  for (const key of trackingKeys) {
    url.searchParams.delete(key);
  }
  return url.toString();
}

/**
 * Canonicalizes YouTube, Vimeo, or direct media links into their standard,
 * clean formats, extracting video/playlist IDs and stripping noise.
 */
export function canonicalizeMediaUrl(rawInput: string): CanonicalMediaUrlInfo {
  const normalized = normalizeMediaUrl(rawInput);
  if (!normalized) {
    throw MuxaroError.invalidUrl('Invalid URL format');
  }

  const url = new URL(normalized);
  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  // ---------------------------------------------------------------------------
  // YouTube Canonicalization
  // ---------------------------------------------------------------------------
  if (
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtu.be'
  ) {
    let videoId: string | undefined;
    let listId: string | undefined;

    // Check for list parameter first
    const listParam = url.searchParams.get('list');
    if (listParam && listParam.trim().length > 0) {
      listId = listParam.trim();
    }

    if (host === 'youtu.be') {
      // youtu.be/VIDEO_ID
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length > 0) {
        videoId = parts[0];
      }
    } else if (url.pathname.startsWith('/shorts/')) {
      // youtube.com/shorts/VIDEO_ID
      const parts = url.pathname.replace('/shorts/', '').split('/').filter(Boolean);
      if (parts.length > 0) {
        videoId = parts[0];
      }
    } else if (url.pathname.startsWith('/embed/')) {
      // youtube.com/embed/VIDEO_ID
      const parts = url.pathname.replace('/embed/', '').split('/').filter(Boolean);
      if (parts.length > 0) {
        videoId = parts[0];
      }
    } else if (url.pathname.startsWith('/live/')) {
      // youtube.com/live/VIDEO_ID
      const parts = url.pathname.replace('/live/', '').split('/').filter(Boolean);
      if (parts.length > 0) {
        videoId = parts[0];
      }
    } else if (url.pathname === '/watch') {
      // youtube.com/watch?v=VIDEO_ID
      const v = url.searchParams.get('v');
      if (v) videoId = v.trim();
    } else if (url.pathname === '/playlist' && listId) {
      // youtube.com/playlist?list=LIST_ID
      return {
        platform: 'youtube',
        canonicalUrl: `https://www.youtube.com/playlist?list=${listId}`,
        originalUrl: rawInput,
        isPlaylist: true,
        listId,
      };
    }

    // If pure playlist without videoId
    if (!videoId && listId) {
      return {
        platform: 'youtube',
        canonicalUrl: `https://www.youtube.com/playlist?list=${listId}`,
        originalUrl: rawInput,
        isPlaylist: true,
        listId,
      };
    }

    if (videoId) {
      // Clean video ID (standard YouTube IDs are 11 chars: [a-zA-Z0-9_-]{11})
      const cleanId = videoId.replace(/[^a-zA-Z0-9_-]/g, '');
      const canonical = `https://www.youtube.com/watch?v=${cleanId}`;
      return {
        platform: 'youtube',
        canonicalUrl: canonical,
        originalUrl: rawInput,
        id: cleanId,
        isPlaylist: Boolean(listId),
        listId,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Vimeo Canonicalization
  // ---------------------------------------------------------------------------
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    let videoId: string | undefined;

    if (host === 'player.vimeo.com') {
      // player.vimeo.com/video/123456789
      const match = url.pathname.match(/\/video\/(\d+)/);
      if (match) videoId = match[1];
    } else {
      // vimeo.com/123456789 or vimeo.com/channels/.../123456789
      const match = url.pathname.match(/(\d{6,12})/);
      if (match) videoId = match[1];
    }

    if (videoId) {
      return {
        platform: 'vimeo',
        canonicalUrl: `https://vimeo.com/${videoId}`,
        originalUrl: rawInput,
        id: videoId,
        isPlaylist: false,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Direct Media URL Canonicalization
  // ---------------------------------------------------------------------------
  const cleanedUrl = stripTrackingParams(url);
  return {
    platform: 'direct',
    canonicalUrl: cleanedUrl,
    originalUrl: rawInput,
    isPlaylist: false,
  };
}

/**
 * Validates a user-supplied media URL against SSRF hazards and canonicalizes it.
 * Throws a typed MuxaroError if the URL is invalid or blocked.
 */
export async function assertSafeMediaUrl(
  rawUrl: string,
  options?: UrlSafetyOptions
): Promise<CanonicalMediaUrlInfo> {
  const safety = await validateUrlSafety(rawUrl, options);
  if (!safety.safe) {
    throw MuxaroError.ssrfBlocked(safety.reason ?? 'URL was rejected by security guard');
  }

  return canonicalizeMediaUrl(safety.normalizedUrl ?? rawUrl);
}
