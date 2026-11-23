/**
 * Project MUXARO - TurboFlow Strategy Engine & Human-Friendly Error Mapper
 *
 * Selects the least expensive valid execution lane for every media job:
 * - Instant Lane (`instant-processing`): Zero re-encode stream copy (-c copy, +faststart)
 * - Smart Lane (`audio-processing` / `merge-processing`): Remux & compatible audio extraction
 * - Power Lane (`video-transcoding` / `high-resolution-processing` / `playlist-packaging`):
 *   Bounded FFmpeg transcoding/compression ONLY when genuinely required.
 */

import fs from 'node:fs';
import type {
  JobOperation,
  MediaAssetInfo,
  ProcessingLane,
  QueueClass,
} from '../types/index.js';
import {
  resolveCookiesArg,
  materializeCookieContent,
  formatPoToken,
  buildYouTubeExtractorArg,
  resolveBgUtilBaseUrl,
  buildResilientYtDlpArgs,
  poTokenCookieService,
  type CookieResolutionResult,
  type PoTokenResolutionResult,
  type YtDlpResilientOptions,
  DEFAULT_PLAYER_CLIENTS,
} from './po-token-cookie.service.js';

export {
  resolveCookiesArg,
  materializeCookieContent,
  formatPoToken,
  buildYouTubeExtractorArg,
  resolveBgUtilBaseUrl,
  buildResilientYtDlpArgs,
  poTokenCookieService,
  type CookieResolutionResult,
  type PoTokenResolutionResult,
  type YtDlpResilientOptions,
};

export const DEFAULT_RETENTION_MINUTES = 60;

/**
 * Standard YouTube player client chains for yt-dlp to bypass datacenter IP bot gates.
 *
 * Primary: 'ios,android,tv,mweb,web' - iOS and Android clients bypass Web BotGuard challenges
 * and do not require Web Proof-of-Origin (PO) tokens on datacenter IPs.
 * Fallback 1: 'tv,mweb' - TV / living room client skips WebVM browser solver.
 * Fallback 2: 'android' - Pure mobile Android client.
 * Fallback 3: 'ios' - Native iOS client for standard H.264/AAC.
 */
export const YTDLP_DEFAULT_PLAYER_CLIENTS = DEFAULT_PLAYER_CLIENTS;

export const YTDLP_FALLBACK_CLIENT_CHAINS = [
  'ios,android,tv,mweb,web',
  'android,web',
  'tv,mweb',
  'mweb,ios',
  'android',
  'ios',
] as const;

export interface YtDlpBaseArgsOptions {
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

/**
 * Builds hardened, resilient base arguments for yt-dlp execution.
 * - Enforces JavaScript runtimes (deno, node) for signature deciphering.
 * - Injects player_client extractor arguments (ios, android, tv, mweb) to evade cloud server datacenter IP blocks.
 * - Formats and injects Proof of Origin (PO Token) and visitorData when provided via options or env.
 * - Materializes cookies from file or raw environment variable (YTDLP_COOKIES_CONTENT / BASE64) with 0o600 permissions.
 * - Only mounts bgutil PO provider if explicitly configured via environment variable (never hardcoded dead IPs).
 * - Avoids static desktop User-Agent mismatch when emulating mobile/TV clients.
 */
export function getYtDlpBaseArgs(options: YtDlpBaseArgsOptions = {}): string[] {
  return buildResilientYtDlpArgs(options);
}

/**
 * Determines whether an error, stderr output, or message corresponds to YouTube bot / IP verification blocks.
 */
export function isBotVerificationError(errOrMessage: unknown): boolean {
  if (!errOrMessage) return false;
  const code = ((errOrMessage as any)?.code || '').toString().toUpperCase();
  if (
    code === 'ERR_BOT_VERIFICATION_REQUIRED' ||
    code === 'BOT_DETECTED' ||
    code === 'YOUTUBE_BOT_BLOCK' ||
    code === 'LOGIN_REQUIRED'
  ) {
    return true;
  }

  const msg = (
    typeof errOrMessage === 'string'
      ? errOrMessage
      : `${(errOrMessage as any)?.message || ''} ${(errOrMessage as any)?.stderr || ''}`
  ).toLowerCase();

  return (
    msg.includes('confirm you’re not a bot') ||
    msg.includes("confirm you're not a bot") ||
    msg.includes('sign in to confirm') ||
    msg.includes('login_required') ||
    msg.includes('bot verification') ||
    msg.includes('automated queries') ||
    msg.includes('botguard') ||
    msg.includes('po_token') ||
    msg.includes('requires verification for this stream on cloud servers') ||
    msg.includes('use muxaro direct') ||
    msg.includes('unplayable') ||
    msg.includes('http error 429') ||
    msg.includes('too many requests')
  );
}

export class BotVerificationError extends Error {
  public readonly code = 'ERR_BOT_VERIFICATION_REQUIRED';
  public readonly userMessage: string;
  public readonly botBlocked = true;
  public readonly muxaroDirectUrl = '/tools/direct-helper';

  constructor(originalMessage?: string) {
    super(
      originalMessage ||
        'YouTube requires verification for this stream on cloud servers. Use MUXARO Direct to download seamlessly from your browser.'
    );
    this.name = 'BotVerificationError';
    this.userMessage =
      'YouTube requires verification for this stream on cloud servers. Use MUXARO Direct to download seamlessly from your browser.';
  }
}

export interface ClientChainRunOptions {
  clientChains?: readonly string[];
  onFallback?: (fromClient: string, toClient: string, error: Error) => void;
}

/**
 * Executes a yt-dlp task through a fallback chain of player_clients.
 * If the primary client hits bot verification or datacenter challenge,
 * it retries automatically with subsequent clients (e.g. 'tv,mweb', 'android')
 * before failing cleanly with a BotVerificationError.
 */
export async function runWithYtDlpClientChain<T>(
  runFn: (clientChain: string, baseArgs: string[]) => Promise<T>,
  options: ClientChainRunOptions = {}
): Promise<T> {
  const chains =
    options.clientChains && options.clientChains.length > 0
      ? options.clientChains
      : ['ios,android,tv,mweb,web', 'tv,mweb', 'android'];

  let lastError: Error | null = null;

  for (let i = 0; i < chains.length; i++) {
    const currentChain = chains[i];
    const baseArgs = getYtDlpBaseArgs({ playerClient: currentChain });

    try {
      return await runFn(currentChain, baseArgs);
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isBot = isBotVerificationError(err);

      if (i < chains.length - 1 && isBot) {
        const nextChain = chains[i + 1];
        if (options.onFallback) {
          options.onFallback(currentChain, nextChain, lastError);
        }
        continue;
      }

      if (isBot) {
        throw new BotVerificationError(lastError.message);
      }
      throw lastError;
    }
  }

  if (lastError && isBotVerificationError(lastError)) {
    throw new BotVerificationError(lastError.message);
  }
  throw lastError || new Error('yt-dlp execution failed across all client chains');
}

export interface TurboFlowDecision {
  processingLane: ProcessingLane;
  queueClass: QueueClass;
  strategyLabel: string;
  losslessPreserved: boolean;
  retentionMinutes: number;
  canDirectAudioCopy: boolean;
  requiresVideoTranscode: boolean;
}

export interface TurboFlowInput {
  operation: JobOperation;
  targetFormat?: string;
  targetResolution?: string;
  targetAudioCodec?: string;
  streamCopy?: boolean;
  isLocalUpload?: boolean;
  sourceAsset?: MediaAssetInfo;
}

const MP4_COMPATIBLE_VIDEO_CODECS = new Set([
  'h264',
  'avc',
  'avc1',
  'hevc',
  'h265',
  'hev1',
  'hvc1',
  'av1',
  'av01',
  'vp9',
  'vp09',
  'mpeg4',
]);

const MP4_COMPATIBLE_AUDIO_CODECS = new Set([
  'aac',
  'mp4a',
  'mp3',
  'opus',
  'ac3',
  'eac3',
]);

const WEBM_COMPATIBLE_VIDEO_CODECS = new Set(['vp8', 'vp9', 'vp09', 'av1', 'av01']);
const WEBM_COMPATIBLE_AUDIO_CODECS = new Set(['opus', 'vorbis']);

export function parseResolutionHeight(targetResolution?: string): number | null {
  if (!targetResolution) return null;
  const lower = targetResolution.toLowerCase().trim();
  if (lower.includes('8k') || lower.includes('4320')) return 4320;
  if (lower.includes('4k') || lower.includes('2160')) return 2160;
  if (lower.includes('1440')) return 1440;
  if (lower.includes('1080')) return 1080;
  if (lower.includes('720')) return 720;
  if (lower.includes('480')) return 480;
  if (lower.includes('360')) return 360;
  if (lower.includes('240')) return 240;
  const match = lower.match(/(\d{3,4})p?/);
  if (match) {
    const val = Number.parseInt(match[1], 10);
    if (val >= 144 && val <= 4320) return val;
  }
  return null;
}

/**
 * Detects whether a resolution string or dimension corresponds to 8K Ultra HD.
 */
export function is8KResolution(
  resolution?: string | null,
  height?: number | null,
  width?: number | null
): boolean {
  if (height && height >= 4320) return true;
  if (width && width >= 7680) return true;
  if (!resolution) return false;
  const lower = resolution.toLowerCase().trim();
  return lower.includes('8k') || lower.includes('4320');
}

/**
 * Constructs an optimized yt-dlp format selector for 8K video + audio stream pairing.
 */
export function get8KYtDlpFormatSelector(targetFormat: string = 'mp4'): string {
  const ext = targetFormat.toLowerCase().replace(/^\./, '');
  if (ext === 'mp4') {
    return 'bestvideo[height>=4320][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height>=4320]+bestaudio/bestvideo[height<=4320][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=4320]+bestaudio/bestvideo+bestaudio/best';
  }
  return 'bestvideo[height>=4320]+bestaudio/bestvideo[height<=4320]+bestaudio/bestvideo+bestaudio/best';
}

function codecBase(codec?: string): string {
  return (codec || '').toLowerCase().split('.')[0].trim();
}

function isAudioDirectCopyCompatible(sourceAudioCodec: string | undefined, targetExt: string): boolean {
  const base = codecBase(sourceAudioCodec);
  if (!base) return false;
  switch (targetExt) {
    case 'mp3':
      return base === 'mp3';
    case 'flac':
      return base === 'flac';
    case 'opus':
      return base === 'opus';
    case 'm4a':
    case 'aac':
      return base === 'aac' || base === 'mp4a';
    case 'wav':
      return base.startsWith('pcm');
    default:
      return false;
  }
}

function isVideoStreamCopyCompatible(
  sourceVideoCodec: string | undefined,
  sourceAudioCodec: string | undefined,
  targetExt: string
): boolean {
  if (targetExt === 'mkv') return true; // MKV supports virtually all codecs via stream copy
  const vBase = codecBase(sourceVideoCodec);
  const aBase = codecBase(sourceAudioCodec);

  if (targetExt === 'mp4') {
    const vOk = !vBase || MP4_COMPATIBLE_VIDEO_CODECS.has(vBase);
    const aOk = !aBase || MP4_COMPATIBLE_AUDIO_CODECS.has(aBase);
    return vOk && aOk;
  }

  if (targetExt === 'webm') {
    const vOk = !vBase || WEBM_COMPATIBLE_VIDEO_CODECS.has(vBase);
    const aOk = !aBase || WEBM_COMPATIBLE_AUDIO_CODECS.has(aBase);
    return vOk && aOk;
  }

  return false;
}

/**
 * Selects the optimal MUXARO TurboFlow lane and queue class.
 * Never claims losslessPreserved=true when transcoding/compression is required.
 */
export function selectTurboFlowStrategy(input: TurboFlowInput): TurboFlowDecision {
  const targetExt = (input.targetFormat || 'mp4').toLowerCase().trim().replace(/^\./, '');
  const targetHeight = parseResolutionHeight(input.targetResolution);
  const primaryVideo = input.sourceAsset?.streams.find((s) => s.type === 'VIDEO');
  const primaryAudio = input.sourceAsset?.streams.find((s) => s.type === 'AUDIO');
  const sourceHeight = primaryVideo?.height ?? null;

  // 1. Playlist batch packaging
  if (input.operation === 'PLAYLIST_BATCH') {
    return {
      processingLane: 'power',
      queueClass: 'playlist-packaging',
      strategyLabel: 'Playlist Batch Packaging',
      losslessPreserved: false,
      retentionMinutes: DEFAULT_RETENTION_MINUTES,
      canDirectAudioCopy: false,
      requiresVideoTranscode: false,
    };
  }

  // 2. Smart Lane — Audio extraction
  if (input.operation === 'EXTRACT_AUDIO') {
    const audioExt = (input.targetFormat || input.targetAudioCodec || 'mp3')
      .toLowerCase()
      .trim()
      .replace(/^\./, '');
    const directCopy = isAudioDirectCopyCompatible(primaryAudio?.codec, audioExt);
    return {
      processingLane: 'smart',
      queueClass: 'audio-processing',
      strategyLabel: directCopy
        ? 'Smart Audio Extract (Original Stream)'
        : `Smart Audio Extract (${audioExt.toUpperCase()})`,
      losslessPreserved: directCopy,
      retentionMinutes: DEFAULT_RETENTION_MINUTES,
      canDirectAudioCopy: directCopy,
      requiresVideoTranscode: false,
    };
  }

  const is8K =
    (targetHeight !== null && targetHeight >= 4320) ||
    (sourceHeight !== null && sourceHeight >= 4320) ||
    Boolean(input.targetResolution && /^(?:8k|4320p?)/i.test(input.targetResolution));

  // 3. Smart / Instant Lane — Audio/Video Merge
  if (input.operation === 'MERGE_AUDIO_VIDEO') {
    const compatibleCopy = isVideoStreamCopyCompatible(
      primaryVideo?.codec,
      primaryAudio?.codec,
      targetExt
    );
    if (is8K && compatibleCopy && input.streamCopy !== false) {
      return {
        processingLane: 'instant',
        queueClass: 'instant-processing',
        strategyLabel: '8K Lossless Stream Remux',
        losslessPreserved: true,
        retentionMinutes: DEFAULT_RETENTION_MINUTES,
        canDirectAudioCopy: true,
        requiresVideoTranscode: false,
      };
    }
    return {
      processingLane: 'smart',
      queueClass: 'merge-processing',
      strategyLabel: is8K ? '8K Lossless Stream Remux' : (compatibleCopy ? 'Smart A/V Remux' : 'Smart A/V Merge'),
      losslessPreserved: compatibleCopy && input.streamCopy !== false,
      retentionMinutes: DEFAULT_RETENTION_MINUTES,
      canDirectAudioCopy: false,
      requiresVideoTranscode: !compatibleCopy,
    };
  }

  // 8K Lossless Remuxing Rule: When 8K media natively matches target container and streamCopy is not false,
  // execute in Instant Lane without transcoding
  const compatibleCopy = isVideoStreamCopyCompatible(
    primaryVideo?.codec,
    primaryAudio?.codec,
    targetExt
  );

  if (is8K && compatibleCopy && input.streamCopy !== false) {
    return {
      processingLane: 'instant',
      queueClass: 'instant-processing',
      strategyLabel: '8K Lossless Stream Remux',
      losslessPreserved: true,
      retentionMinutes: DEFAULT_RETENTION_MINUTES,
      canDirectAudioCopy: true,
      requiresVideoTranscode: false,
    };
  }

  // 4. Power Lane — Explicit compression / transcode / local downscale
  const isLocalDownscale =
    Boolean(input.isLocalUpload) &&
    targetHeight !== null &&
    (sourceHeight === null || targetHeight < sourceHeight);

  const wantsCompression =
    input.operation === 'CONVERT_FORMAT' ||
    input.operation === 'TRANSCODE_VIDEO' ||
    input.streamCopy === false ||
    isLocalDownscale;

  if (wantsCompression) {
    const isHighRes =
      (targetHeight !== null && targetHeight >= 2160) ||
      (targetHeight === null && sourceHeight !== null && sourceHeight >= 2160);
    return {
      processingLane: 'power',
      queueClass: isHighRes ? 'high-resolution-processing' : 'video-transcoding',
      strategyLabel: isHighRes
        ? 'Power High-Resolution Processing'
        : input.operation === 'CONVERT_FORMAT'
        ? 'Power Video Compression'
        : 'Power Video Transcode',
      losslessPreserved: false,
      retentionMinutes: DEFAULT_RETENTION_MINUTES,
      canDirectAudioCopy: false,
      requiresVideoTranscode: true,
    };
  }

  // 5. Instant Lane — Direct stream copy / remux (zero decode/re-encode)
  if (compatibleCopy) {
    return {
      processingLane: 'instant',
      queueClass: 'instant-processing',
      strategyLabel: 'Instant Stream Copy',
      losslessPreserved: true,
      retentionMinutes: DEFAULT_RETENTION_MINUTES,
      canDirectAudioCopy: true,
      requiresVideoTranscode: false,
    };
  }

  // Fallback to Power Lane if source codec & target container are incompatible
  const isHighRes = (sourceHeight ?? 0) >= 2160 || (targetHeight ?? 0) >= 2160;
  return {
    processingLane: 'power',
    queueClass: isHighRes ? 'high-resolution-processing' : 'video-transcoding',
    strategyLabel: 'Power Format Conversion',
    losslessPreserved: false,
    retentionMinutes: DEFAULT_RETENTION_MINUTES,
    canDirectAudioCopy: false,
    requiresVideoTranscode: true,
  };
}

/**
 * Translates internal technical error codes & raw stderr into clear everyday customer copy.
 */
export function mapHumanFriendlyError(code?: string, rawMessage?: string): string {
  const c = (code || '').toUpperCase();
  const msg = (rawMessage || '').toLowerCase();

  switch (c) {
    case 'ERR_BOT_VERIFICATION_REQUIRED':
    case 'BOT_DETECTED':
    case 'YOUTUBE_BOT_BLOCK':
    case 'LOGIN_REQUIRED':
      return 'YouTube requires verification for this stream on cloud servers. Use MUXARO Direct to download seamlessly from your browser.';
    case 'SSRF_BLOCKED':
      return 'That link points to a private or restricted network address and cannot be accessed.';
    case 'ERR_QUOTA_EXCEEDED':
      return 'You have reached your daily usage limit. Your allowance will refresh automatically.';
    case 'ERR_INVALID_DOWNLOAD_TOKEN':
      return 'This download link has expired or is no longer valid. Please process the file again.';
    case 'ERR_ARTIFACT_NOT_FOUND':
    case 'ERR_ARTIFACT_NOT_READY':
      return 'This file is no longer available or has expired after 60 minutes. Please start a new job.';
    case 'ERR_RANGE_NOT_SATISFIABLE':
      return 'This download could not be resumed. Start a new download.';
    case 'ERR_UPLOAD_NOT_FOUND':
      return 'Your uploaded file expired before processing started. Please upload it again.';
    case 'ERR_FILE_TOO_LARGE':
      return 'This file is larger than the 2 GB upload limit. Try a smaller file.';
    case 'ERR_INVALID_MEDIA_FILE':
      return 'We could not read video or audio tracks from that file. Please choose a valid media file.';
    case 'ERR_CHECKSUM_MISMATCH':
      return 'The uploaded file did not match its integrity check. Please try uploading again.';
    case 'ERR_JOB_NOT_FOUND':
    case 'ERR_PLAYLIST_JOB_NOT_FOUND':
      return 'We could not find that job. It may have expired or been cleared.';
    case 'ERR_RETRY_FAILED':
      return 'This job cannot be retried right now. Please submit it again from the home page.';
    case 'ERR_BACKPRESSURE':
      return 'Our servers are currently busy. Please wait a moment and try again.';
    case 'ERR_DOWNLOAD_DISABLED_BY_POLICY':
      return 'Downloading from this source is restricted by platform policy.';
    case 'ERR_INSPECTION_FAILED':
      return 'We could not inspect that link. Please check that the link is public and try again.';
    case 'ERR_INVALID_REQUEST':
    case 'ERR_EMPTY_UPLOAD':
      return 'Some required information was missing from your request. Please check your input and try again.';
    default:
      break;
  }

  if (msg.includes('http error 404') || msg.includes('not found') || msg.includes('unavailable')) {
    return 'That media link could not be found or is no longer publicly available.';
  }
  if (
    msg.includes('confirm you’re not a bot') ||
    msg.includes('confirm you\'re not a bot') ||
    msg.includes('sign in to confirm') ||
    msg.includes('login_required') ||
    msg.includes('bot verification') ||
    msg.includes('botguard') ||
    msg.includes('po_token') ||
    msg.includes('automated queries') ||
    msg.includes('youtube requires verification') ||
    msg.includes('cloud servers') ||
    msg.includes('muxaro direct') ||
    msg.includes('bot') ||
    msg.includes('sign in')
  ) {
    return 'YouTube requires verification for this stream on cloud servers. Use MUXARO Direct to download seamlessly from your browser.';
  }
  if (msg.includes('confirm your age') || msg.includes('age-restricted') || msg.includes('age restricted')) {
    return 'This video is age-restricted on YouTube and requires signed-in verification.';
  }
  if (msg.includes('private') || msg.includes('this video is private')) {
    return 'This video or audio is marked private by the creator and cannot be accessed.';
  }
  if (msg.includes('http error 403')) {
    return 'Stream access was rejected by the content host (HTTP 403 Forbidden).';
  }
  if (msg.includes('timed out') || msg.includes('timeout')) {
    return 'Processing took too long and timed out. Try a lower resolution or try again shortly.';
  }
  if (msg.includes('cancelled') || msg.includes('canceled')) {
    return 'This job was cancelled.';
  }

  return 'We could not finish processing this media. Please try again or choose a different format.';
}
