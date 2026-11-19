/**
 * Project MUXARO - YouTube Proof of Origin (PO Token) & Cookie Provider Service
 *
 * Provides resilient, anti-bot hardened yt-dlp arguments for cloud server environments:
 * - Cookie Resolution: Supports file paths, raw environment variables (YTDLP_COOKIES_CONTENT),
 *   base64 environment variables (YTDLP_COOKIES_BASE64), browser cookies, and fallback disk paths.
 * - Managed Cookie Materialization: Safely persists in-memory/env cookies to disk with restricted
 *   permissions (0o600) so yt-dlp can securely read them.
 * - Proof of Origin (PO Token): Formats WebPO tokens and visitorData according to Innertube BotGuard specs.
 * - Player Client Emulation: Emulates mobile & TV Innertube clients (ios, android, tv, mweb)
 *   to bypass BotGuard VM challenges without requiring full headless browser solver farms.
 * - Sidecar Integration: Dynamically connects to bgutil-ytdlp-pot-provider sidecars only when
 *   explicitly configured via environment variables (never hardcoded to dead Docker IPs).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export interface CookieResolutionResult {
  args: string[];
  resolvedPath?: string;
  source?: 'direct_path' | 'env_content' | 'env_base64' | 'default_disk_file' | 'browser';
  hasCookies: boolean;
}

export interface PoTokenResolutionResult {
  extractorArg: string;
  playerClients: string;
  poToken?: string;
  visitorData?: string;
  hasPoToken: boolean;
}

export interface YtDlpResilientOptions {
  playerClient?: string;
  cookiesPath?: string;
  cookiesContent?: string;
  poToken?: string;
  visitorData?: string;
  poTokenBaseUrl?: string;
  additionalArgs?: string[];
  includeProgress?: boolean;
  isPlaylist?: boolean;
  userAgent?: string;
  proxy?: string;
}

export const DEFAULT_PLAYER_CLIENTS = 'ios,android,tv,mweb,web';

// Cache for materialized cookie file path & content hash to prevent redundant disk I/O
let cachedManagedCookiePath: string | null = null;
let cachedManagedCookieHash: string | null = null;

/**
 * Returns a writable directory for persisting managed cookie files.
 * Prefers .muxaro-data in the current working directory, falling back to os.tmpdir().
 */
export function getManagedCookieDir(): string {
  const customDataDir = process.env.MUXARO_DATA_DIR;
  if (customDataDir) {
    try {
      if (!fs.existsSync(customDataDir)) {
        fs.mkdirSync(customDataDir, { recursive: true });
      }
      return customDataDir;
    } catch {
      // Fall through to standard candidates
    }
  }

  const projectDataDir = path.resolve(process.cwd(), '.muxaro-data');
  try {
    if (!fs.existsSync(projectDataDir)) {
      fs.mkdirSync(projectDataDir, { recursive: true });
    }
    return projectDataDir;
  } catch {
    // If not writable, use OS temporary directory
    const tmpDir = path.join(os.tmpdir(), 'muxaro-data');
    if (!fs.existsSync(tmpDir)) {
      try {
        fs.mkdirSync(tmpDir, { recursive: true });
      } catch {
        return os.tmpdir();
      }
    }
    return tmpDir;
  }
}

/**
 * Materializes raw cookie text (e.g. Netscape format from an env var) to a secure file.
 * Sets file mode to 0o600 (read/write for owner only) for credential hygiene.
 */
export function materializeCookieContent(rawContent: string): string {
  const trimmed = rawContent.trim();
  if (!trimmed) {
    throw new Error('Provided cookie content is empty');
  }

  const contentHash = crypto.createHash('sha256').update(trimmed).digest('hex');

  // If already materialized and content has not changed, reuse existing file
  if (
    cachedManagedCookiePath &&
    cachedManagedCookieHash === contentHash &&
    fs.existsSync(cachedManagedCookiePath)
  ) {
    return cachedManagedCookiePath;
  }

  const targetDir = getManagedCookieDir();
  const filePath = path.join(targetDir, 'managed-cookies.env.txt');

  try {
    fs.writeFileSync(filePath, trimmed + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });

    cachedManagedCookiePath = filePath;
    cachedManagedCookieHash = contentHash;
    return filePath;
  } catch (err) {
    // If writing to targetDir failed, try os.tmpdir() fallback
    const fallbackPath = path.join(os.tmpdir(), `muxaro-cookies-${contentHash.slice(0, 8)}.txt`);
    fs.writeFileSync(fallbackPath, trimmed + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
    cachedManagedCookiePath = fallbackPath;
    cachedManagedCookieHash = contentHash;
    return fallbackPath;
  }
}

/**
 * Resolves yt-dlp cookie arguments from options, environment variables, or disk defaults.
 *
 * Priority order:
 * 1. Explicit options.cookiesContent (materialized to file)
 * 2. Explicit options.cookiesPath (if file exists and non-empty)
 * 3. Environment variable YTDLP_COOKIES_CONTENT or YTDLP_COOKIES (materialized to file)
 * 4. Environment variable YTDLP_COOKIES_BASE64 (decoded and materialized to file)
 * 5. Environment variable YTDLP_COOKIES_PATH (if file exists and non-empty)
 * 6. Standard file paths: .muxaro-data/cookies.txt, /tmp/muxaro-data/cookies.txt, storage/cookies.txt
 * 7. Environment variable YTDLP_COOKIES_FROM_BROWSER (e.g. 'chrome', 'firefox')
 */
export function resolveCookiesArg(options?: {
  cookiesPath?: string;
  cookiesContent?: string;
}): CookieResolutionResult {
  // 1. Explicit in-memory content
  if (options?.cookiesContent && options.cookiesContent.trim().length > 0) {
    try {
      const filePath = materializeCookieContent(options.cookiesContent);
      return {
        args: ['--cookies', filePath],
        resolvedPath: filePath,
        source: 'env_content',
        hasCookies: true,
      };
    } catch {
      // Continue to next check if materialization failed
    }
  }

  // 2. Explicit path option
  if (options?.cookiesPath && fs.existsSync(options.cookiesPath)) {
    try {
      const stat = fs.statSync(options.cookiesPath);
      if (stat.size > 0) {
        return {
          args: ['--cookies', options.cookiesPath],
          resolvedPath: options.cookiesPath,
          source: 'direct_path',
          hasCookies: true,
        };
      }
    } catch {
      // ignore
    }
  }

  // 3. Raw cookies content in environment variable
  const envContent = process.env.YTDLP_COOKIES_CONTENT || process.env.YTDLP_COOKIES;
  if (envContent && envContent.trim().length > 0) {
    try {
      const filePath = materializeCookieContent(envContent);
      return {
        args: ['--cookies', filePath],
        resolvedPath: filePath,
        source: 'env_content',
        hasCookies: true,
      };
    } catch {
      // Continue to next check
    }
  }

  // 4. Base64-encoded cookies content in environment variable
  const envBase64 = process.env.YTDLP_COOKIES_BASE64;
  if (envBase64 && envBase64.trim().length > 0) {
    try {
      const decoded = Buffer.from(envBase64.trim(), 'base64').toString('utf8');
      if (decoded.trim().length > 0) {
        const filePath = materializeCookieContent(decoded);
        return {
          args: ['--cookies', filePath],
          resolvedPath: filePath,
          source: 'env_base64',
          hasCookies: true,
        };
      }
    } catch {
      // ignore base64 decode failure
    }
  }

  // 5. Explicit path from environment variable
  const envPath = process.env.YTDLP_COOKIES_PATH;
  if (envPath && fs.existsSync(envPath)) {
    try {
      const stat = fs.statSync(envPath);
      if (stat.size > 0) {
        return {
          args: ['--cookies', envPath],
          resolvedPath: envPath,
          source: 'direct_path',
          hasCookies: true,
        };
      }
    } catch {
      // ignore
    }
  }

  // 6. Default well-known disk paths
  const standardPaths = [
    path.resolve(process.cwd(), '.muxaro-data', 'cookies.txt'),
    '/tmp/muxaro-data/cookies.txt',
    path.resolve(process.cwd(), 'storage', 'cookies.txt'),
    path.join(os.tmpdir(), 'muxaro-data', 'cookies.txt'),
  ];

  for (const candidate of standardPaths) {
    if (fs.existsSync(candidate)) {
      try {
        const stat = fs.statSync(candidate);
        if (stat.size > 0) {
          return {
            args: ['--cookies', candidate],
            resolvedPath: candidate,
            source: 'default_disk_file',
            hasCookies: true,
          };
        }
      } catch {
        // continue
      }
    }
  }

  // 7. Local developer browser cookie extraction (e.g. chrome, firefox)
  const browser = process.env.YTDLP_COOKIES_FROM_BROWSER;
  if (browser && browser.trim().length > 0) {
    return {
      args: ['--cookies-from-browser', browser.trim()],
      source: 'browser',
      hasCookies: true,
    };
  }

  return {
    args: [],
    hasCookies: false,
  };
}

/**
 * Formats a Proof of Origin (PO Token) for yt-dlp extractor-args.
 * Standard format:
 *   web+<po_token>
 * or with visitor_data:
 *   web+<po_token>+<visitor_data>
 */
export function formatPoToken(token: string, visitorData?: string): string {
  const trimmedToken = token.trim();
  if (!trimmedToken) return '';

  let formatted = trimmedToken;
  // If the token doesn't already contain a client prefix (e.g. "web+", "ios+"), default to "web+"
  if (!/^[a-zA-Z0-9_]+[+]/.test(formatted)) {
    formatted = `web+${formatted}`;
  }

  if (visitorData && visitorData.trim().length > 0) {
    const trimmedVisitor = visitorData.trim();
    // Only append visitorData if not already in the token string
    if (!formatted.includes(trimmedVisitor)) {
      formatted = `${formatted}+${trimmedVisitor}`;
    }
  }

  return formatted;
}

/**
 * Constructs the YouTube extractor argument containing player client chain and optional PO Token.
 * Example outputs:
 *   "youtube:player_client=ios,android,tv,mweb,web"
 *   "youtube:player_client=ios,android,tv,mweb,web;po_token=web+sample_token"
 */
export function buildYouTubeExtractorArg(options?: {
  playerClient?: string;
  poToken?: string;
  visitorData?: string;
}): PoTokenResolutionResult {
  const playerClients = (
    options?.playerClient ||
    process.env.YTDLP_PLAYER_CLIENTS ||
    DEFAULT_PLAYER_CLIENTS
  ).trim();

  const rawPoToken = options?.poToken || process.env.YTDLP_PO_TOKEN;
  const rawVisitorData = options?.visitorData || process.env.YTDLP_VISITOR_DATA;

  if (rawPoToken && rawPoToken.trim().length > 0) {
    const formattedToken = formatPoToken(rawPoToken, rawVisitorData);
    return {
      extractorArg: `youtube:player_client=${playerClients};po_token=${formattedToken}`,
      playerClients,
      poToken: formattedToken,
      visitorData: rawVisitorData?.trim() || undefined,
      hasPoToken: true,
    };
  }

  return {
    extractorArg: `youtube:player_client=${playerClients}`,
    playerClients,
    visitorData: rawVisitorData?.trim() || undefined,
    hasPoToken: false,
  };
}

/**
 * Resolves optional external bgutil-ytdlp-pot-provider sidecar base URL.
 * Only returns a URL when explicitly set via environment or parameter.
 * Never hardcodes dead or unrouted Docker IPs.
 */
export function resolveBgUtilBaseUrl(overrideUrl?: string): string | null {
  const candidate =
    overrideUrl ||
    process.env.BGUTIL_BASE_URL ||
    process.env.YTDLP_BGUTIL_URL ||
    process.env.POT_PROVIDER_URL;

  if (candidate && candidate.trim().length > 0) {
    return candidate.trim();
  }
  return null;
}

/**
 * Builds the complete, hardened array of arguments for yt-dlp execution.
 */
export function buildResilientYtDlpArgs(options: YtDlpResilientOptions = {}): string[] {
  const args: string[] = [];

  if (options.isPlaylist !== true) {
    args.push('--no-playlist');
  }

  args.push(
    '--no-cache-dir',
    '--no-warnings',
    '--js-runtimes',
    'deno,node',
    '--socket-timeout',
    '30'
  );

  if (options.includeProgress !== false) {
    args.push('--progress', '--newline');
  }

  // 1. YouTube extractor args: player_client & PO Token
  const poResolution = buildYouTubeExtractorArg({
    playerClient: options.playerClient,
    poToken: options.poToken,
    visitorData: options.visitorData,
  });
  args.push('--extractor-args', poResolution.extractorArg);

  // 2. Bgutil HTTP provider (only when explicitly configured)
  const bgutilUrl = resolveBgUtilBaseUrl(options.poTokenBaseUrl);
  if (bgutilUrl) {
    args.push('--extractor-args', `youtubepot-bgutilhttp:base_url=${bgutilUrl}`);
  }

  // 3. Cookies resolution
  const cookieResolution = resolveCookiesArg({
    cookiesPath: options.cookiesPath,
    cookiesContent: options.cookiesContent,
  });
  if (cookieResolution.args.length > 0) {
    args.push(...cookieResolution.args);
  }

  // 4. User-Agent
  // If an explicit user-agent is supplied or set in env, use it.
  // Otherwise, only apply desktop Chrome user-agent when playerClient is strictly 'web'.
  // For mobile clients ('ios', 'android'), omitting desktop user-agent lets yt-dlp use authentic mobile headers.
  if (options.userAgent || process.env.YTDLP_USER_AGENT) {
    args.push('--user-agent', options.userAgent || (process.env.YTDLP_USER_AGENT as string));
  } else if (poResolution.playerClients === 'web') {
    args.push(
      '--user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
    );
  }

  // 5. Proxy configuration
  const proxy = options.proxy || process.env.YTDLP_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (proxy && proxy.trim().length > 0) {
    args.push('--proxy', proxy.trim());
  }

  // 6. Additional custom arguments
  if (options.additionalArgs && options.additionalArgs.length > 0) {
    args.push(...options.additionalArgs);
  }

  return args;
}

export class PoTokenCookieService {
  public resolveCookies(options?: {
    cookiesPath?: string;
    cookiesContent?: string;
  }): CookieResolutionResult {
    return resolveCookiesArg(options);
  }

  public materializeCookies(rawContent: string): string {
    return materializeCookieContent(rawContent);
  }

  public buildPoTokenExtractorArg(options?: {
    playerClient?: string;
    poToken?: string;
    visitorData?: string;
  }): PoTokenResolutionResult {
    return buildYouTubeExtractorArg(options);
  }

  public buildYtDlpArgs(options?: YtDlpResilientOptions): string[] {
    return buildResilientYtDlpArgs(options);
  }
}

export const poTokenCookieService = new PoTokenCookieService();
