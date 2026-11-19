/**
 * MUXARO URL Utility & Normalization Library
 * 
 * Provides bulletproof URL sanitization, protocol normalization, validation,
 * and display formatting for media inspection and conversion pipelines.
 * 
 * Solves the "link-not-showing" bug where inputs without 'https://' fail HTML5 validation
 * or fail URL constructor parsing, causing silent aborts.
 */

/**
 * Normalizes user-provided media URLs by:
 * - Trimming leading/trailing whitespace and quotes
 * - Converting scheme-relative '//domain.com/...' to 'https://domain.com/...'
 * - Prepending 'https://' if no valid protocol ('http://' or 'https://') is present
 * - Validating host format and stripping dangerous schemes (javascript:, data:, file:)
 */
export function normalizeMediaUrl(rawInput: unknown): string {
  if (typeof rawInput !== 'string') return '';
  
  let trimmed = rawInput.trim();
  if (!trimmed) return '';

  // Remove surrounding quotes if user copied with quotes
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    trimmed = trimmed.slice(1, -1).trim();
  }

  // Reject dangerous pseudo-protocols immediately
  if (/^(javascript|data|file|vbscript|about):/i.test(trimmed)) {
    return '';
  }

  // Handle protocol-relative URLs
  if (trimmed.startsWith('//')) {
    trimmed = 'https:' + trimmed;
  } else if (!/^https?:\/\//i.test(trimmed)) {
    // If user enters "youtube.com/watch?v=..." or "www.vimeo.com/...", prepend https://
    trimmed = 'https://' + trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    // Ensure protocol is strictly http or https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    // Ensure hostname is non-empty and has at least a domain name or localhost
    if (!parsed.hostname || parsed.hostname.length < 1) {
      return '';
    }
    return parsed.href;
  } catch {
    return '';
  }
}

/**
 * Checks if a string represents a potentially valid media URL
 */
export function isValidMediaUrl(rawInput: unknown): boolean {
  const normalized = normalizeMediaUrl(rawInput);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    // Must have a valid host (either localhost or contains a dot like domain.tld)
    return parsed.hostname === 'localhost' || parsed.hostname.includes('.');
  } catch {
    return false;
  }
}

/**
 * Extracts a clean, human-readable display string for badges and pills
 * e.g. "youtube.com/watch?v=dQw...9WgXcQ"
 */
export function formatDisplayUrl(rawUrl: string, maxLength: number = 42): string {
  if (!rawUrl) return '';
  try {
    const parsed = new URL(normalizeMediaUrl(rawUrl) || rawUrl);
    const domain = parsed.hostname.replace(/^www\./i, '');
    const pathAndQuery = parsed.pathname + parsed.search;
    const full = `${domain}${pathAndQuery === '/' ? '' : pathAndQuery}`;
    if (full.length <= maxLength) return full;
    const keepStart = Math.floor((maxLength - 3) * 0.65);
    const keepEnd = Math.max(4, maxLength - 3 - keepStart);
    return `${full.slice(0, keepStart)}…${full.slice(-keepEnd)}`;
  } catch {
    if (rawUrl.length <= maxLength) return rawUrl;
    return `${rawUrl.slice(0, maxLength - 3)}…`;
  }
}

/**
 * Detects known platform source from URL for appropriate badge styling
 */
export function detectPlatform(rawUrl: string): { name: string; icon: 'youtube' | 'vimeo' | 'generic' } {
  try {
    const parsed = new URL(normalizeMediaUrl(rawUrl) || rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      return { name: 'YouTube', icon: 'youtube' };
    }
    if (host.includes('vimeo.com')) {
      return { name: 'Vimeo', icon: 'vimeo' };
    }
    return { name: parsed.hostname.replace(/^www\./i, ''), icon: 'generic' };
  } catch {
    return { name: 'Media Source', icon: 'generic' };
  }
}
