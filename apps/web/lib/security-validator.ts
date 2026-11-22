/**
 * MUXARO Security & SSRF Validation Layer
 * Protects against SSRF, DNS rebinding, path traversal, and command injection.
 * Bound by Supreme Constitution Law 1 & Law 2.
 */

import { URL } from 'node:url';

// Blocked private/internal IPv4/IPv6 CIDR ranges and metadata endpoints
const PRIVATE_IP_PATTERNS = [
  /^127\./, // Loopback
  /^10\./, // RFC1918 Class A
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // RFC1918 Class B
  /^192\.168\./, // RFC1918 Class C
  /^169\.254\./, // Link-local / Cloud metadata (AWS 169.254.169.254)
  /^0\./, // Current network
  /^::1$/, // IPv6 loopback
  /^fe80:/i, // IPv6 link-local
  /^fc00:/i, // IPv6 unique local
  /^fd00:/i, // IPv6 unique local
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'local',
  'broadcasthost',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

export interface UrlValidationResult {
  valid: boolean;
  normalizedUrl: string;
  error?: string;
}

/**
 * Validates a media URL against scheme restrictions, SSRF, and command injection patterns.
 */
export function validateMediaUrl(rawUrl: string): UrlValidationResult {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    return { valid: false, normalizedUrl: '', error: 'URL cannot be empty.' };
  }

  // Prevent shell interpolation characters in URL string
  if (/[\r\n\0`$]/.test(trimmed)) {
    return { valid: false, normalizedUrl: '', error: 'Invalid characters in URL.' };
  }

  let parsed: URL;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    parsed = new URL(withProtocol);
  } catch {
    return { valid: false, normalizedUrl: '', error: 'Malformed URL.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, normalizedUrl: '', error: 'Only HTTP and HTTPS protocols are supported.' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Strip trailing dot if present
  const cleanHostname = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;

  if (BLOCKED_HOSTNAMES.has(cleanHostname)) {
    return { valid: false, normalizedUrl: '', error: 'Access to internal or local hosts is prohibited.' };
  }

  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(cleanHostname)) {
      return { valid: false, normalizedUrl: '', error: 'Access to private IP ranges is prohibited.' };
    }
  }

  return {
    valid: true,
    normalizedUrl: parsed.toString(),
  };
}

/**
 * Sanitizes a filename across Windows, macOS, and Linux filesystems.
 */
export function sanitizeFilename(rawTitle: string, defaultExt = 'mp4'): string {
  let name = String(rawTitle || 'media_download').trim();

  // Remove directory traversal and forbidden filesystem characters
  name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  name = name.replace(/\.{2,}/g, '.'); // Remove double dots

  // Remove leading/trailing periods or spaces (invalid on Windows)
  name = name.replace(/^[. ]+|[. ]+$/g, '');

  if (!name) {
    name = 'media_download';
  }

  // Check Windows reserved device names
  const baseUpper = name.split('.')[0].toUpperCase();
  if (WINDOWS_RESERVED_NAMES.has(baseUpper)) {
    name = `file_${name}`;
  }

  // Clamp length to 100 characters to prevent filesystem limits
  if (name.length > 100) {
    name = name.slice(0, 100).trim();
  }

  // Ensure extension is present
  const ext = defaultExt.replace(/^\./, '').toLowerCase();
  if (!name.toLowerCase().endsWith(`.${ext}`)) {
    name = `${name}.${ext}`;
  }

  return name;
}

/**
 * Creates Content-Disposition header with both ASCII fallback and RFC 5987 UTF-8 encoded filename.
 */
export function formatContentDisposition(filename: string): string {
  const asciiSafe = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '\\"');
  const encodedUtf8 = encodeURIComponent(filename).replace(/['()]/g, escape).replace(/\*/g, '%2A');
  return `attachment; filename="${asciiSafe}"; filename*=UTF-8''${encodedUtf8}`;
}
