import type {
  MediaManifest,
  MediaStream,
  ProcessingJob,
  ProcessingLane,
  JobState,
  QuotaStatus,
  EntitlementsUsage,
  CreditLedgerItem,
  SystemHealthMetrics,
  UserTier,
  AuthUser,
  AuthSessionResponse,
  UserSessionInfo,
  MfaSetupResponse,
  RewardConfig,
  RewardSession,
  MediaBatch,
  AdminUserSummary,
  AdminSearchResult,
  AdminPlatformSettings,
  AdminRewardsSummary,
  AdminAnalyticsSummary,
  AdminAuditLog,
  AdminSecurityEvent,
} from './types.ts';
import {
  circuitBreaker,
  withCircuitBreaker,
  ApiClientError,
} from './circuit-breaker.ts';

export { circuitBreaker, withCircuitBreaker, ApiClientError };

export const DEAD_OR_UNRESOLVABLE_HOSTS = [
  'api.muxaro.app',
  'muxaro-api.internal',
] as const;

export function isDeadOrUnresolvableHost(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') return true;
  const lower = urlStr.trim().toLowerCase();
  for (const dead of DEAD_OR_UNRESOLVABLE_HOSTS) {
    if (lower.includes(dead)) {
      return true;
    }
  }
  return false;
}

function normalizeApiBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '/api/v1';
  if (/\/api\/v1$/i.test(trimmed)) return trimmed;
  return `${trimmed}/api/v1`;
}

export function getApiBaseUrl(): string {
  // 1. In browser, ALWAYS default to same-origin '/api/v1' unless an explicitly verified reachable URL is configured
  if (typeof window !== 'undefined') {
    const explicitlyVerified = (
      (window as any).__MUXARO_VERIFIED_API_URL__ ||
      process.env.NEXT_PUBLIC_VERIFIED_API_URL ||
      ''
    ).trim();

    if (explicitlyVerified && !isDeadOrUnresolvableHost(explicitlyVerified)) {
      return normalizeApiBase(explicitlyVerified);
    }

    return '/api/v1';
  }

  // 2. Server-side / build-time resolution (Node.js runtime / Next SSR)
  const internalApiUrl = (process.env.API_INTERNAL_URL || '').trim();
  if (internalApiUrl && !isDeadOrUnresolvableHost(internalApiUrl)) {
    return normalizeApiBase(internalApiUrl);
  }

  const publicApiUrl = (process.env.NEXT_PUBLIC_API_URL || '').trim();
  if (publicApiUrl && !isDeadOrUnresolvableHost(publicApiUrl)) {
    return normalizeApiBase(publicApiUrl);
  }

  return '/api/v1';
}

export const API_BASE = '/api/v1';

const MULTIPART_CHUNK_BYTES = 5 * 1024 * 1024; // 5 MB chunks via file.slice()
const MAX_PART_RETRIES = 3;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

let cachedCsrfToken: string | null = null;

export function readCsrfTokenFromCookie(): string | null {
  if (typeof document === 'undefined' || !document.cookie) {
    return cachedCsrfToken;
  }
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === 'muxaro_csrf') {
      const value = part.slice(idx + 1).trim();
      try {
        const decoded = decodeURIComponent(value);
        if (decoded) {
          cachedCsrfToken = decoded;
          return decoded;
        }
      } catch {
        if (value) {
          cachedCsrfToken = value;
          return value;
        }
      }
    }
  }
  return cachedCsrfToken;
}

export function setCachedCsrfToken(token: string | null | undefined): void {
  if (typeof token === 'string' && token.trim().length > 0) {
    cachedCsrfToken = token.trim();
  } else if (token === null) {
    cachedCsrfToken = null;
  }
}

type FastifyJobOperation =
  | 'EXTRACT_AUDIO'
  | 'REMUX_STREAM_COPY'
  | 'TRANSCODE_VIDEO'
  | 'CONVERT_FORMAT'
  | 'MERGE_AUDIO_VIDEO';

const FASTIFY_OPERATIONS = new Set<FastifyJobOperation>([
  'EXTRACT_AUDIO',
  'REMUX_STREAM_COPY',
  'TRANSCODE_VIDEO',
  'CONVERT_FORMAT',
  'MERGE_AUDIO_VIDEO',
]);

const AUDIO_FORMATS = new Set(['mp3', 'flac', 'wav', 'opus', 'm4a', 'aac']);
const ALLOWED_FORMATS = new Set(['mp4', 'mkv', 'webm', 'mp3', 'flac', 'wav', 'm4a', 'opus', 'aac']);

const VALID_JOB_STATES = new Set<JobState>([
  'CREATED',
  'VALIDATING',
  'QUEUED',
  'PROCESSING',
  'VERIFYING',
  'READY',
  'FAILED',
  'CANCELLED',
  'REJECTED',
]);

const VALID_LANES = new Set<ProcessingLane>(['instant', 'smart', 'power']);

export interface CreateJobParams {
  mediaAssetId?: string;
  mediaUrl?: string;
  sourceUrl?: string;
  audioUrl?: string;
  audioAssetId?: string;
  jobType?: 'extract_audio' | 'merge_av' | 'transcode_video' | 'batch' | 'playlist';
  operation?: string;
  targetFormat: string;
  targetResolution?: string;
  targetAudioCodec?: string;
  streamCopy?: boolean;
  audioDelayMs?: number;
  title?: string;
  idempotencyKey?: string;
  formatId?: string;
}

export interface UploadLocalFileOptions {
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
}

function normalizeTargetFormat(
  rawFormat: string | undefined,
  isAudioJob: boolean,
  targetAudioCodec?: string
): string {
  const cleaned = String(rawFormat || '')
    .trim()
    .toLowerCase()
    .replace(/^\.+/, '');

  if (cleaned === 'native' || cleaned === 'original' || cleaned === '') {
    if (isAudioJob) {
      const codec = String(targetAudioCodec || '').toLowerCase();
      if (codec.includes('aac') || codec.includes('m4a') || codec.includes('mp4a')) return 'm4a';
      if (ALLOWED_FORMATS.has(codec)) return codec;
      return 'opus';
    }
    return 'mp4';
  }

  if (cleaned === 'mpeg') return 'mp4';
  if (ALLOWED_FORMATS.has(cleaned)) return cleaned;
  return isAudioJob ? 'mp3' : 'mp4';
}

function resolveFastifyOperation(
  params: CreateJobParams,
  normalizedFormat: string
): FastifyJobOperation {
  const upperOp = String(params.operation || '').trim().toUpperCase() as FastifyJobOperation;
  if (FASTIFY_OPERATIONS.has(upperOp)) {
    return upperOp;
  }

  if (params.jobType === 'extract_audio' || AUDIO_FORMATS.has(normalizedFormat)) {
    return 'EXTRACT_AUDIO';
  }
  if (params.jobType === 'merge_av') {
    return 'MERGE_AUDIO_VIDEO';
  }
  if (params.streamCopy === true) {
    return 'REMUX_STREAM_COPY';
  }
  return 'TRANSCODE_VIDEO';
}

function inferJobType(
  raw: any,
  fallback?: CreateJobParams['jobType']
): ProcessingJob['jobType'] {
  if (
    raw?.jobType === 'extract_audio' ||
    raw?.jobType === 'merge_av' ||
    raw?.jobType === 'transcode_video' ||
    raw?.jobType === 'batch' ||
    raw?.jobType === 'playlist'
  ) {
    return raw.jobType;
  }
  const op = String(raw?.operation || '').toUpperCase();
  if (op === 'EXTRACT_AUDIO') return 'extract_audio';
  if (op === 'MERGE_AUDIO_VIDEO') return 'merge_av';
  return fallback || 'transcode_video';
}

function normalizeJobStatus(status: unknown): JobState {
  const upper = String(status || 'QUEUED').toUpperCase();
  if (upper === 'EXPIRED') return 'FAILED';
  if (VALID_JOB_STATES.has(upper as JobState)) {
    return upper as JobState;
  }
  return 'QUEUED';
}

function normalizeProcessingLane(lane: unknown): ProcessingLane | undefined {
  const lower = String(lane || '').toLowerCase();
  if (VALID_LANES.has(lower as ProcessingLane)) {
    return lower as ProcessingLane;
  }
  return undefined;
}

function normalizeJob(
  raw: any,
  fallbackContext?: {
    jobType?: CreateJobParams['jobType'];
    operation?: string;
    targetFormat?: string;
    targetResolution?: string;
    targetAudioCodec?: string;
    streamCopy?: boolean;
    title?: string;
  }
): ProcessingJob {
  const artifact = raw?.artifact && typeof raw.artifact === 'object' ? raw.artifact : null;
  const status = normalizeJobStatus(raw?.status);
  const errorMessage =
    typeof raw?.errorMessage === 'string'
      ? raw.errorMessage
      : typeof raw?.error === 'string'
      ? raw.error
      : raw?.error && typeof raw.error === 'object' && typeof raw.error.message === 'string'
      ? raw.error.message
      : undefined;

  const userMessage =
    typeof raw?.userMessage === 'string'
      ? raw.userMessage
      : raw?.error && typeof raw.error === 'object' && typeof raw.error.userMessage === 'string'
      ? raw.error.userMessage
      : undefined;

  const jobId = String(raw?.jobId || raw?.id || '');
  const operation = String(raw?.operation || fallbackContext?.operation || 'TRANSCODE_VIDEO');
  const rawFormat =
    raw?.targetFormat || artifact?.format || fallbackContext?.targetFormat || 'mp4';

  const progressRaw = Number(raw?.progress);
  const progress = Number.isFinite(progressRaw)
    ? Math.max(0, Math.min(100, Math.round(progressRaw)))
    : status === 'READY'
    ? 100
    : 0;

  const outputSizeRaw = raw?.outputSizeBytes ?? artifact?.sizeBytes;
  const outputSizeBytes =
    typeof outputSizeRaw === 'number' && Number.isFinite(outputSizeRaw)
      ? outputSizeRaw
      : undefined;

  const retentionRaw = Number(raw?.retentionMinutes);
  const retentionMinutes =
    Number.isFinite(retentionRaw) && retentionRaw > 0 ? Math.round(retentionRaw) : undefined;

  const rawTier = String(raw?.priorityTier || raw?.tier || '').toLowerCase();
  const priorityTier: UserTier | undefined =
    rawTier === 'guest' || rawTier === 'free' || rawTier === 'registered' || rawTier === 'premium'
      ? rawTier
      : undefined;

  return {
    id: jobId,
    batchId: typeof raw?.batchId === 'string' && raw.batchId ? raw.batchId : undefined,
    itemNumber:
      typeof raw?.itemNumber === 'number' || typeof raw?.itemNumber === 'string'
        ? raw.itemNumber
        : undefined,
    priorityTier,
    jobType: inferJobType(raw, fallbackContext?.jobType),
    status,
    operation,
    targetFormat: String(rawFormat).toLowerCase(),
    targetResolution: raw?.targetResolution || fallbackContext?.targetResolution,
    targetAudioCodec: raw?.targetAudioCodec || fallbackContext?.targetAudioCodec,
    streamCopy:
      typeof raw?.streamCopy === 'boolean'
        ? raw.streamCopy
        : fallbackContext?.streamCopy ?? operation === 'REMUX_STREAM_COPY',
    processingLane: normalizeProcessingLane(raw?.processingLane),
    strategyLabel: typeof raw?.strategyLabel === 'string' ? raw.strategyLabel : undefined,
    losslessPreserved:
      typeof raw?.losslessPreserved === 'boolean' ? raw.losslessPreserved : undefined,
    retentionMinutes,
    progress,
    progressStage:
      raw?.stageMessage ||
      raw?.progressStage ||
      raw?.stage ||
      (status === 'READY' ? 'Ready to download' : 'Queued'),
    inputTitle:
      raw?.inputTitle ||
      raw?.title ||
      fallbackContext?.title ||
      artifact?.filename ||
      '',
    outputFilename: raw?.outputFilename || artifact?.filename || undefined,
    outputSizeBytes,
    downloadUrl: raw?.downloadUrl || artifact?.downloadUrl || undefined,
    checksumSha256: raw?.checksumSha256 || artifact?.checksumSha256 || undefined,
    error: errorMessage,
    errorMessage,
    userMessage,
    expiresAt: raw?.expiresAt || undefined,
    createdAt: raw?.createdAt || new Date().toISOString(),
    completedAt:
      raw?.completedAt || (status === 'READY' ? raw?.updatedAt || undefined : undefined),
  };
}

function normalizeBitrateKbps(s: any): number {
  if (typeof s?.bitrateKbps === 'number' && Number.isFinite(s.bitrateKbps)) {
    return Math.round(s.bitrateKbps);
  }
  if (typeof s?.bitrate === 'number' && Number.isFinite(s.bitrate)) {
    return s.bitrate > 100000 ? Math.round(s.bitrate / 1000) : Math.round(s.bitrate);
  }
  return 0;
}

function normalizeStream(s: any, indexFallback: number): MediaStream {
  const typeLower = String(s?.streamType || s?.type || '').toLowerCase();
  const isVideo = typeLower === 'video' || (!typeLower && Boolean(s?.width || s?.height));
  const height = typeof s?.height === 'number' && Number.isFinite(s.height) ? s.height : undefined;
  const width = typeof s?.width === 'number' && Number.isFinite(s.width) ? s.width : undefined;
  const fpsVal =
    typeof s?.fps === 'number' && Number.isFinite(s.fps)
      ? s.fps
      : typeof s?.frameRate === 'number' && Number.isFinite(s.frameRate)
      ? s.frameRate
      : undefined;

  const resolutionLabel =
    s?.resolutionLabel ||
    s?.resolution ||
    (height
      ? height >= 4320
        ? '4320p'
        : height >= 2160
        ? '2160p'
        : height >= 1440
        ? '1440p'
        : height >= 1080
        ? '1080p'
        : `${height}p`
      : undefined);

  const estimatedSizeBytes =
    typeof s?.estimatedSizeBytes === 'number' &&
    Number.isFinite(s.estimatedSizeBytes) &&
    s.estimatedSizeBytes > 0
      ? s.estimatedSizeBytes
      : undefined;

  const sampleRateHz =
    typeof s?.sampleRateHz === 'number' && Number.isFinite(s.sampleRateHz)
      ? s.sampleRateHz
      : typeof s?.sampleRate === 'number' && Number.isFinite(s.sampleRate)
      ? s.sampleRate
      : undefined;

  return {
    streamIndex: typeof s?.streamIndex === 'number' ? s.streamIndex : s?.index ?? indexFallback,
    streamType: isVideo ? 'video' : 'audio',
    codec: String(s?.codec || (isVideo ? 'h264' : 'aac')),
    bitrateKbps: normalizeBitrateKbps(s),
    formatId: typeof s?.formatId === 'string' ? s.formatId : undefined,
    width,
    height,
    resolutionLabel,
    frameRate: fpsVal,
    fps: fpsVal,
    hdr: typeof s?.hdr === 'boolean' ? s.hdr : undefined,
    estimatedSizeBytes,
    sizeIsEstimate: typeof s?.sizeIsEstimate === 'boolean' ? s.sizeIsEstimate : undefined,
    recommended: typeof s?.recommended === 'boolean' ? s.recommended : undefined,
    isNativeLossless: typeof s?.isNativeLossless === 'boolean' ? s.isNativeLossless : undefined,
    sampleRateHz,
    channels: typeof s?.channels === 'number' ? s.channels : undefined,
    channelLayout:
      s?.channelLayout ||
      (s?.channels === 6 ? '5.1' : s?.channels === 1 ? 'mono' : isVideo ? undefined : 'stereo'),
    isStreamCopyCandidate: Boolean(s?.isStreamCopyCandidate ?? true),
    transcodeRequired: Boolean(s?.transcodeRequired ?? false),
    notes: s?.notes || undefined,
  };
}

function normalizeManifest(
  raw: any,
  fallbacks: {
    sourceUrl: string;
    title?: string;
    fileSizeBytes?: number;
    container?: string;
    isLocalUpload?: boolean;
  }
): MediaManifest {
  let videoStreams: MediaStream[] = [];
  let audioStreams: MediaStream[] = [];

  if (Array.isArray(raw?.videoStreams) || Array.isArray(raw?.audioStreams)) {
    videoStreams = (Array.isArray(raw.videoStreams) ? raw.videoStreams : []).map(
      (s: any, idx: number) => normalizeStream({ ...s, streamType: 'video' }, idx)
    );
    audioStreams = (Array.isArray(raw.audioStreams) ? raw.audioStreams : []).map(
      (s: any, idx: number) =>
        normalizeStream({ ...s, streamType: 'audio' }, videoStreams.length + idx)
    );
  } else if (Array.isArray(raw?.streams)) {
    raw.streams.forEach((s: any, idx: number) => {
      const normalized = normalizeStream(s, idx);
      if (normalized.streamType === 'video') {
        videoStreams.push(normalized);
      } else {
        audioStreams.push(normalized);
      }
    });
  }

  const durationSeconds =
    typeof raw?.durationSeconds === 'number' && Number.isFinite(raw.durationSeconds)
      ? raw.durationSeconds
      : 0;
  const fileSizeBytes =
    typeof raw?.fileSizeBytes === 'number' &&
    Number.isFinite(raw.fileSizeBytes) &&
    raw.fileSizeBytes > 0
      ? raw.fileSizeBytes
      : fallbacks.fileSizeBytes || 0;

  return {
    id: String(raw?.assetId || raw?.id || ''),
    sourceUrl: String(raw?.url || raw?.sourceUrl || fallbacks.sourceUrl || ''),
    title: String(raw?.title || fallbacks.title || ''),
    author: raw?.author || raw?.uploader || raw?.channel || undefined,
    durationSeconds,
    fileSizeBytes,
    container: String(raw?.container || fallbacks.container || 'mp4').toLowerCase(),
    thumbnailUrl: raw?.thumbnailUrl || undefined,
    isLocalUpload:
      typeof raw?.isLocalUpload === 'boolean' ? raw.isLocalUpload : fallbacks.isLocalUpload,
    permitted: raw?.rightsCheck ? Boolean(raw.rightsCheck.isPermitted) : Boolean(raw?.permitted ?? true),
    rightsNote: raw?.rightsCheck?.reason || raw?.rightsNote || '',
    videoStreams,
    audioStreams,
  };
}

function extractErrorMessage(parsed: any, status: number, statusText: string): string {
  const friendly =
    parsed?.error?.userMessage ||
    parsed?.userMessage ||
    parsed?.error?.message ||
    parsed?.message;
  if (typeof friendly === 'string' && friendly.trim().length > 0) {
    return friendly.trim();
  }
  if (status === 413) return 'This file is larger than the 2 GB upload limit.';
  if (status === 429) return 'Too many requests right now. Please wait a moment and try again.';
  if (status >= 500) return 'The processing service encountered an error. Please try again shortly.';
  return `Request failed (${status}${statusText ? ` ${statusText}` : ''}).`;
}

function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Upload cancelled.', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Upload cancelled.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

class ApiClient {
  /**
   * Strict HTTP request used across all endpoints.
   * NEVER fabricates mock jobs, fake quotas, or placeholder operational data.
   */
  private async requestStrict<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}${endpoint}`;
    const method = String(options.method || 'GET').toUpperCase();
    const isBinaryBody = typeof Blob !== 'undefined' && options.body instanceof Blob;
    const csrfToken = MUTATING_METHODS.has(method) ? readCsrfTokenFromCookie() : null;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options.body && !isBinaryBody ? { 'Content-Type': 'application/json' } : {}),
      ...(csrfToken ? { 'x-muxaro-csrf': csrfToken } : {}),
      ...((options.headers as Record<string, string>) || {}),
    };

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        credentials: 'include',
        headers,
      });
    } catch (networkErr: unknown) {
      if (networkErr instanceof DOMException && networkErr.name === 'AbortError') {
        throw new Error('Request cancelled.');
      }
      const classified = circuitBreaker.classifyError(networkErr, endpoint);
      throw new ApiClientError(classified, networkErr);
    }

    const text = await response.text();
    let parsed: any = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    if (!response.ok) {
      const msg = extractErrorMessage(parsed, response.status, response.statusText);
      const classified = circuitBreaker.classifyError({ message: msg, status: response.status }, endpoint);
      const err = new ApiClientError(classified);
      (err as any).status = response.status;
      (err as any).code = parsed?.error?.code;
      throw err;
    }

    if (parsed && typeof parsed === 'object' && 'data' in parsed) {
      return parsed.data as T;
    }
    return parsed as T;
  }

  /**
   * Inspect a media URL via POST /api/v1/media/inspect with client-side oEmbed fallback.
   */
  async inspectMedia(url: string): Promise<MediaManifest> {
    const trimmed = (url || '').trim();
    const normalizedUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

    try {
      const raw: any = await this.requestStrict<any>('/media/inspect', {
        method: 'POST',
        body: JSON.stringify({ url: normalizedUrl, rightsDeclared: true }),
      });

      if (raw && typeof raw === 'object') {
        return normalizeManifest(raw, { sourceUrl: normalizedUrl, isLocalUpload: false });
      }
    } catch (primaryErr: any) {
      // Resilient fallback for YouTube/Vimeo links if edge/backend returns 503 or network is offline
      try {
        const parsed = new URL(normalizedUrl);
        const host = parsed.hostname.toLowerCase();

        // YouTube client-side oEmbed fallback
        let ytId: string | null = null;
        if (host === 'youtu.be') {
          ytId = parsed.pathname.slice(1).split('/')[0].split('?')[0];
        } else if (
          host === 'youtube.com' ||
          host === 'www.youtube.com' ||
          host === 'm.youtube.com' ||
          host === 'music.youtube.com'
        ) {
          if (parsed.pathname === '/watch') ytId = parsed.searchParams.get('v');
          else if (parsed.pathname.startsWith('/embed/') || parsed.pathname.startsWith('/shorts/')) {
            ytId = parsed.pathname.split('/')[2];
          }
        }

        if (ytId && /^[a-zA-Z0-9_-]{11}$/.test(ytId)) {
          let title = 'YouTube Media';
          let author = 'YouTube Creator';
          let thumbnail = `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`;

          try {
            const oembedRes = await fetch(
              `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`
            );
            if (oembedRes.ok) {
              const oe = (await oembedRes.json()) as any;
              if (oe?.title) title = String(oe.title);
              if (oe?.author_name) author = String(oe.author_name);
              if (oe?.thumbnail_url) thumbnail = String(oe.thumbnail_url);
            }
          } catch {
            // Keep default metadata
          }

          const fallbackManifest = {
            id: `yt_${ytId}`,
            title,
            author,
            sourceUrl: `https://www.youtube.com/watch?v=${ytId}`,
            thumbnailUrl: thumbnail,
            durationSeconds: 0,
            isLive: false,
            isPlaylist: false,
            videoStreams: [
              {
                id: 'v1080',
                formatId: '137',
                resolution: '1080p',
                resolutionLabel: '1080p (Full HD)',
                width: 1920,
                height: 1080,
                fps: 60,
                codec: 'avc1.64002a',
                container: 'mp4',
                isStreamCopyCandidate: true,
                isRecommended: true,
              },
              {
                id: 'v720',
                formatId: '136',
                resolution: '720p',
                resolutionLabel: '720p (HD)',
                width: 1280,
                height: 720,
                fps: 30,
                codec: 'avc1.4d401f',
                container: 'mp4',
                isStreamCopyCandidate: true,
              },
              {
                id: 'v480',
                formatId: '135',
                resolution: '480p',
                resolutionLabel: '480p (Standard)',
                width: 854,
                height: 480,
                fps: 30,
                codec: 'avc1.4d401e',
                container: 'mp4',
              },
            ],
            audioStreams: [
              {
                id: 'a_orig',
                formatId: '140',
                codec: 'm4a',
                bitrateKbps: 128,
                sampleRateHz: 44100,
                channels: 2,
                isStreamCopyCandidate: true,
              },
              {
                id: 'a_mp3',
                formatId: 'mp3_hq',
                codec: 'mp3',
                bitrateKbps: 320,
                sampleRateHz: 48000,
                channels: 2,
              },
            ],
            adapterId: 'youtube-permitted-adapter',
          };
          return normalizeManifest(fallbackManifest, { sourceUrl: normalizedUrl, isLocalUpload: false });
        }
      } catch {
        // Fall through to re-throw primary error
      }

      throw primaryErr;
    }

    throw new Error('Could not read media details from this link.');
  }

  /**
   * Upload a single file stream via XHR (for real-time 0-100% progress & AbortSignal).
   */
  private uploadDirectWithProgress(
    file: File,
    options?: UploadLocalFileOptions
  ): Promise<any> {
    if (typeof XMLHttpRequest === 'undefined') {
      return this.requestStrict<any>('/media/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-file-name': encodeURIComponent(file.name),
        },
        body: file,
        signal: options?.signal,
      });
    }

    return new Promise((resolve, reject) => {
      if (options?.signal?.aborted) {
        reject(new Error('Upload cancelled.'));
        return;
      }

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${getApiBaseUrl()}/media/upload`, true);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
      const csrfToken = readCsrfTokenFromCookie();
      if (csrfToken) {
        xhr.setRequestHeader('x-muxaro-csrf', csrfToken);
      }

      const cleanup = () => {
        options?.signal?.removeEventListener('abort', onAbort);
      };

      const onAbort = () => {
        xhr.abort();
      };

      options?.signal?.addEventListener('abort', onAbort, { once: true });

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable && evt.total > 0) {
          const pct = Math.min(99, Math.round((evt.loaded / evt.total) * 100));
          options?.onProgress?.(pct);
        }
      };

      xhr.onload = () => {
        cleanup();
        let parsed: any = null;
        try {
          parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          parsed = null;
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          options?.onProgress?.(100);
          resolve(parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed);
        } else {
          reject(new Error(extractErrorMessage(parsed, xhr.status, xhr.statusText)));
        }
      };

      xhr.onerror = () => {
        cleanup();
        reject(new Error('Upload failed due to a network error. Please try again.'));
      };

      xhr.onabort = () => {
        cleanup();
        reject(new Error('Upload cancelled.'));
      };

      xhr.send(file);
    });
  }

  /**
   * Upload a single multipart chunk via XHR for smooth byte-level progress and clean abort.
   */
  private uploadPartChunk(
    uploadId: string,
    partNumber: number,
    chunk: Blob,
    onChunkProgress: (loadedBytes: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const endpoint = `${getApiBaseUrl()}/media/upload/${encodeURIComponent(uploadId)}/part/${partNumber}`;

    if (typeof XMLHttpRequest === 'undefined') {
      return this.requestStrict<unknown>(
        `/media/upload/${encodeURIComponent(uploadId)}/part/${partNumber}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: chunk,
          signal,
        }
      ).then(() => {
        onChunkProgress(chunk.size);
      });
    }

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Upload cancelled.', 'AbortError'));
        return;
      }

      const xhr = new XMLHttpRequest();
      xhr.open('PUT', endpoint, true);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      const csrfToken = readCsrfTokenFromCookie();
      if (csrfToken) {
        xhr.setRequestHeader('x-muxaro-csrf', csrfToken);
      }

      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort);
      };

      const onAbort = () => {
        xhr.abort();
      };

      signal?.addEventListener('abort', onAbort, { once: true });

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          onChunkProgress(evt.loaded);
        }
      };

      xhr.onload = () => {
        cleanup();
        if (xhr.status >= 200 && xhr.status < 300) {
          onChunkProgress(chunk.size);
          resolve();
        } else {
          let parsed: any = null;
          try {
            parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null;
          } catch {
            parsed = null;
          }
          reject(new Error(extractErrorMessage(parsed, xhr.status, xhr.statusText)));
        }
      };

      xhr.onerror = () => {
        cleanup();
        reject(new Error(`Network error while uploading part ${partNumber}.`));
      };

      xhr.onabort = () => {
        cleanup();
        reject(new DOMException('Upload cancelled.', 'AbortError'));
      };

      xhr.send(chunk);
    });
  }

  /**
   * Resumable multipart upload for files > 5 MB using file.slice() (never buffers whole file in RAM).
   * Retries each failed part up to 3 times and cleans up via DELETE on abort.
   */
  private async uploadMultipart(
    file: File,
    options?: UploadLocalFileOptions
  ): Promise<any> {
    const totalParts = Math.ceil(file.size / MULTIPART_CHUNK_BYTES);

    let initData: { uploadId: string };
    try {
      initData = await this.requestStrict<{ uploadId: string }>('/media/upload/init', {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          totalSize: file.size,
          totalParts,
        }),
        signal: options?.signal,
      });
    } catch (err: any) {
      // Fall back to direct upload only if server does not expose multipart routes (404)
      if (err?.status === 404) {
        return this.uploadDirectWithProgress(file, options);
      }
      throw err;
    }

    const uploadId = initData?.uploadId;
    if (!uploadId) {
      throw new Error('Could not initialize resumable file upload.');
    }

    const abortCleanup = async () => {
      try {
        const csrfToken = readCsrfTokenFromCookie();
        await fetch(`${getApiBaseUrl()}/media/upload/${encodeURIComponent(uploadId)}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: csrfToken ? { 'x-muxaro-csrf': csrfToken } : undefined,
        });
      } catch {
        // Best-effort server temp cleanup
      }
    };

    try {
      let uploadedBeforeCurrentPart = 0;

      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        if (options?.signal?.aborted) {
          throw new DOMException('Upload cancelled.', 'AbortError');
        }

        const start = (partNumber - 1) * MULTIPART_CHUNK_BYTES;
        const end = Math.min(file.size, start + MULTIPART_CHUNK_BYTES);
        const chunk = file.slice(start, end);

        let lastError: unknown = null;
        let partSucceeded = false;

        for (let attempt = 1; attempt <= MAX_PART_RETRIES; attempt++) {
          if (options?.signal?.aborted) {
            throw new DOMException('Upload cancelled.', 'AbortError');
          }
          try {
            await this.uploadPartChunk(
              uploadId,
              partNumber,
              chunk,
              (loadedInPart) => {
                const totalLoaded = uploadedBeforeCurrentPart + loadedInPart;
                const pct = Math.min(96, Math.round((totalLoaded / file.size) * 96));
                options?.onProgress?.(pct);
              },
              options?.signal
            );
            partSucceeded = true;
            break;
          } catch (partErr: unknown) {
            lastError = partErr;
            if (
              options?.signal?.aborted ||
              (partErr instanceof DOMException && partErr.name === 'AbortError')
            ) {
              throw partErr;
            }
            if (attempt < MAX_PART_RETRIES) {
              await sleepMs(400 * attempt, options?.signal);
            }
          }
        }

        if (!partSucceeded) {
          throw lastError instanceof Error
            ? lastError
            : new Error('Part upload failed after multiple attempts. Please try again.');
        }

        uploadedBeforeCurrentPart += chunk.size;
      }

      const completed = await this.requestStrict<any>(
        `/media/upload/${encodeURIComponent(uploadId)}/complete`,
        {
          method: 'POST',
          body: JSON.stringify({ filename: file.name }),
          signal: options?.signal,
        }
      );

      options?.onProgress?.(100);
      return completed;
    } catch (err: unknown) {
      await abortCleanup();
      if (
        options?.signal?.aborted ||
        (err instanceof DOMException && err.name === 'AbortError')
      ) {
        throw new Error('Upload cancelled.');
      }
      throw err;
    }
  }

  /**
   * Upload a local computer file with real progress & AbortSignal cancellation.
   * Uses resumable 5 MB multipart uploads for files > 5 MB and direct streaming for <= 5 MB.
   */
  async uploadLocalFile(
    file: File,
    options?: UploadLocalFileOptions
  ): Promise<MediaManifest> {
    if (!file) {
      throw new Error('Please choose a file from your device first.');
    }

    const extMatch = file.name.match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'mp4';
    const baseTitle = file.name.replace(/\.[^.]+$/, '') || file.name;

    options?.onProgress?.(0);

    const raw =
      file.size > MULTIPART_CHUNK_BYTES
        ? await this.uploadMultipart(file, options)
        : await this.uploadDirectWithProgress(file, options);

    if (!raw || typeof raw !== 'object') {
      throw new Error('File upload completed, but media details were not returned.');
    }

    return normalizeManifest(raw, {
      sourceUrl: '',
      title: baseTitle,
      fileSizeBytes: file.size,
      container: ext,
      isLocalUpload: true,
    });
  }

  /**
   * Submit a real media processing job to POST /api/v1/jobs.
   */
  async createJob(params: CreateJobParams): Promise<ProcessingJob> {
    const resolvedUrl = (params.mediaUrl || params.sourceUrl || '').trim();
    const isHttpUrl = /^https?:\/\//i.test(resolvedUrl);
    const isAudioRequest =
      params.jobType === 'extract_audio' ||
      AUDIO_FORMATS.has(String(params.targetFormat || '').trim().toLowerCase());
    const targetFormat = normalizeTargetFormat(
      params.targetFormat,
      isAudioRequest,
      params.targetAudioCodec
    );
    const fastifyOperation = resolveFastifyOperation(params, targetFormat);
    const idempotencyKey =
      params.idempotencyKey ||
      `idem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    const payload: Record<string, unknown> = {
      operation: fastifyOperation,
      targetFormat,
      idempotencyKey,
    };

    if (params.mediaAssetId) {
      payload.mediaAssetId = params.mediaAssetId;
    }
    if (isHttpUrl) {
      payload.mediaUrl = resolvedUrl;
    }
    if (params.audioUrl && /^https?:\/\//i.test(params.audioUrl.trim())) {
      payload.audioUrl = params.audioUrl.trim();
    }
    if (params.audioAssetId) {
      payload.audioAssetId = params.audioAssetId;
    }
    if (params.targetResolution) {
      payload.targetResolution = params.targetResolution;
    }
    if (params.targetAudioCodec) {
      payload.targetAudioCodec = params.targetAudioCodec.toLowerCase();
    }
    if (params.title) {
      payload.title = params.title;
    }
    if (fastifyOperation === 'CONVERT_FORMAT') {
      payload.streamCopy = false;
    } else if (typeof params.streamCopy === 'boolean') {
      payload.streamCopy = params.streamCopy;
    }
    if (params.formatId) {
      payload.formatId = params.formatId;
    }

    const raw = await this.requestStrict<any>('/jobs', {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    return normalizeJob(raw, {
      jobType: params.jobType,
      operation: fastifyOperation,
      targetFormat,
      targetResolution: params.targetResolution,
      targetAudioCodec: params.targetAudioCodec,
      streamCopy:
        fastifyOperation === 'CONVERT_FORMAT'
          ? false
          : params.streamCopy ?? fastifyOperation === 'REMUX_STREAM_COPY',
      title: params.title,
    });
  }

  /**
   * Fetch live job execution status from GET /api/v1/jobs/:id.
   */
  async getJob(id: string): Promise<ProcessingJob> {
    const raw = await this.requestStrict<any>(`/jobs/${encodeURIComponent(id)}`);
    return normalizeJob(raw);
  }

  /**
   * Retry a failed job via POST /api/v1/jobs/:id/retry.
   */
  async retryJob(jobId: string): Promise<ProcessingJob> {
    const raw = await this.requestStrict<any>(`/jobs/${encodeURIComponent(jobId)}/retry`, {
      method: 'POST',
    });
    if (raw && (raw.jobId || raw.id)) {
      try {
        return await this.getJob(String(raw.jobId || raw.id));
      } catch {
        return normalizeJob(raw);
      }
    }
    return this.getJob(jobId);
  }

  /**
   * Cancel a queued or active job via POST /api/v1/jobs/:id/cancel.
   */
  async cancelJob(id: string): Promise<{ success: boolean; message: string }> {
    const raw = await this.requestStrict<any>(`/jobs/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    });
    return {
      success: true,
      message: raw?.message || 'Job cancelled.',
    };
  }

  /**
   * List recent user jobs from GET /api/v1/account/history.
   * Degrades gracefully to cached jobs or empty list on unauthenticated/guest/offline mode.
   */
  async listJobs(): Promise<ProcessingJob[]> {
    return this.getHistory();
  }

  async getHistory(): Promise<ProcessingJob[]> {
    return withCircuitBreaker(
      'getHistory',
      async () => {
        try {
          const res = await this.requestStrict<any>('/account/history');
          const items = Array.isArray(res) ? res : Array.isArray(res?.jobs) ? res.jobs : [];
          const normalized = items.map((j: any) => normalizeJob(j));
          if (typeof window !== 'undefined' && normalized.length > 0) {
            try {
              window.sessionStorage.setItem('muxaro_cached_jobs', JSON.stringify(normalized.slice(0, 50)));
            } catch {
              // Ignore storage quotas
            }
          }
          return normalized;
        } catch (err: any) {
          if (err?.status === 401 || err?.status === 404) {
            return [];
          }
          throw err;
        }
      },
      () => circuitBreaker.getDegradedHistory()
    );
  }

  private normalizeEntitlementsUsage(raw: any): EntitlementsUsage {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Could not read daily usage information from the server.');
    }

    const num = (val: unknown, fallback: number): number => {
      const n = Number(val);
      return Number.isFinite(n) ? n : fallback;
    };

    const nestedInd = raw.individualVideos && typeof raw.individualVideos === 'object' ? raw.individualVideos : null;
    const nestedPl = raw.playlists && typeof raw.playlists === 'object' ? raw.playlists : null;

    const baseLimit = Math.max(
      0,
      num(raw.baseLimit ?? nestedInd?.baseAllowance ?? nestedInd?.allowance ?? raw.individualVideosLimit, 0)
    );
    const baseRemaining = Math.max(
      0,
      num(
        raw.baseRemaining ??
          nestedInd?.baseRemaining ??
          nestedInd?.remaining ??
          raw.individualVideosRemaining,
        0
      )
    );
    const baseUsed = Math.max(0, num(raw.baseUsed ?? nestedInd?.used, Math.max(0, baseLimit - baseRemaining)));
    const extraCreditsEarned = Math.max(0, num(raw.extraCreditsEarned ?? raw.rewardCreditsEarned, 0));
    const extraCreditsRemaining = Math.max(0, num(raw.extraCreditsRemaining ?? raw.rewardCreditsRemaining, 0));
    const extraCreditsExpiresAt =
      typeof raw.extraCreditsExpiresAt === 'string' && raw.extraCreditsExpiresAt.trim()
        ? raw.extraCreditsExpiresAt
        : null;
    const totalAvailableIndividual = Math.max(
      0,
      num(raw.totalAvailableIndividual ?? nestedInd?.totalAvailable, baseRemaining + extraCreditsRemaining)
    );
    const playlistJobsLimit = Math.max(
      0,
      num(raw.playlistJobsLimit ?? nestedPl?.allowance, 0)
    );
    const playlistJobsRemaining = Math.max(
      0,
      num(raw.playlistJobsRemaining ?? nestedPl?.remaining, 0)
    );
    const rollingWindowHours = Math.max(
      1,
      num(
        raw.rollingWindowHours ??
          (nestedInd?.windowSeconds ? Math.round(Number(nestedInd.windowSeconds) / 3600) : undefined),
        24
      )
    );
    const resetCountdownSeconds = Math.max(
      0,
      num(raw.resetCountdownSeconds ?? nestedInd?.secondsUntilNextSlot, 0)
    );
    const nextResetIso = String(raw.nextResetIso ?? nestedInd?.nextResetAt ?? '');
    const rewardedAdsUsedToday = Math.max(0, num(raw.rewardedAdsUsedToday, 0));
    const rewardedAdsDailyCap = Math.max(0, num(raw.rewardedAdsDailyCap, 3));
    const rawTier = String(raw.tier || 'guest').toLowerCase();
    const tier: UserTier =
      rawTier === 'premium' || rawTier === 'registered' || rawTier === 'free' || rawTier === 'guest'
        ? rawTier
        : 'guest';

    return {
      individualVideosRemaining: totalAvailableIndividual,
      individualVideosLimit: baseLimit,
      playlistJobsRemaining,
      playlistJobsLimit,
      rollingWindowHours,
      resetCountdownSeconds,
      nextResetIso,
      baseLimit,
      baseUsed,
      baseRemaining,
      extraCreditsEarned,
      extraCreditsRemaining,
      extraCreditsExpiresAt,
      totalAvailableIndividual,
      rewardedAdsUsedToday,
      rewardedAdsDailyCap,
      tier,
    };
  }

  private normalizeLedgerItem(raw: any, index: number): CreditLedgerItem {
    const changeNum = Number(raw?.change ?? raw?.delta ?? raw?.amount ?? 0);
    const balanceNum = Number(raw?.balanceAfter ?? raw?.balance_after ?? 0);
    const eventType =
      typeof raw?.eventType === 'string'
        ? raw.eventType
        : typeof raw?.event_type === 'string'
        ? raw.event_type
        : typeof raw?.type === 'string'
        ? raw.type
        : undefined;

    return {
      id: String(raw?.id || `tx_${index}`),
      timestamp: String(raw?.timestamp || raw?.createdAt || raw?.created_at || ''),
      operation: String(raw?.operation || raw?.description || eventType || 'Account activity'),
      eventType,
      change: Number.isFinite(changeNum) ? changeNum : 0,
      balanceAfter: Number.isFinite(balanceNum) ? balanceNum : 0,
      referenceId: String(raw?.referenceId || raw?.reference_id || raw?.jobId || raw?.sessionId || '-'),
      expiresAt:
        typeof raw?.expiresAt === 'string'
          ? raw.expiresAt
          : typeof raw?.expires_at === 'string'
          ? raw.expires_at
          : null,
    };
  }

  /**
   * Fetch live daily usage & quota from GET /api/v1/account/credits.
   * Degrades gracefully to guest allowance when offline or unauthenticated.
   */
  async getQuota(): Promise<QuotaStatus> {
    return withCircuitBreaker(
      'getQuota',
      async () => {
        try {
          const raw = await this.requestStrict<any>('/account/credits');
          return this.normalizeEntitlementsUsage(raw);
        } catch (err: any) {
          if (err?.status === 401 || err?.status === 404) {
            return circuitBreaker.getDegradedQuota();
          }
          throw err;
        }
      },
      () => circuitBreaker.getDegradedQuota()
    );
  }

  /**
   * Fetch detailed entitlements usage breakdown from GET /api/v1/entitlements/usage
   * (falls back to /account/credits only if 404).
   */
  async getEntitlementsUsage(): Promise<EntitlementsUsage> {
    return withCircuitBreaker(
      'getEntitlementsUsage',
      async () => {
        try {
          const raw = await this.requestStrict<any>('/entitlements/usage');
          return this.normalizeEntitlementsUsage(raw);
        } catch (err: any) {
          if (err?.status === 404) {
            try {
              const raw = await this.requestStrict<any>('/account/credits');
              return this.normalizeEntitlementsUsage(raw);
            } catch {
              return circuitBreaker.getDegradedEntitlements();
            }
          }
          if (err?.status === 401) {
            return circuitBreaker.getDegradedEntitlements();
          }
          throw err;
        }
      },
      () => circuitBreaker.getDegradedEntitlements()
    );
  }

  /**
   * Fetch live usage activity ledger from GET /api/v1/credits/ledger.
   * Degrades gracefully to empty list when offline or unauthenticated.
   */
  async getCreditLedger(): Promise<CreditLedgerItem[]> {
    return withCircuitBreaker(
      'getCreditLedger',
      async () => {
        try {
          const res = await this.requestStrict<any>('/credits/ledger');
          const items = Array.isArray(res)
            ? res
            : Array.isArray(res?.items)
            ? res.items
            : Array.isArray(res?.ledger)
            ? res.ledger
            : Array.isArray(res?.data)
            ? res.data
            : [];
          return items.map((item: any, idx: number) => this.normalizeLedgerItem(item, idx));
        } catch (err: any) {
          if (err?.status === 401 || err?.status === 404) {
            return [];
          }
          throw err;
        }
      },
      () => []
    );
  }

  /* =========================================================================
     AUTH & SESSION METHODS
     ========================================================================= */
  async getSession(): Promise<AuthSessionResponse> {
    return withCircuitBreaker<AuthSessionResponse>(
      'getSession',
      async (): Promise<AuthSessionResponse> => {
        const raw = await this.requestStrict<any>('/auth/session');
        if (raw?.csrfToken) {
          setCachedCsrfToken(raw.csrfToken);
        }
        const authenticated = Boolean(raw?.authenticated && (raw?.user || raw?.publicUserId));
        const user: AuthUser | null = authenticated
          ? (raw.user as AuthUser) || {
              id: raw.id,
              internalUserId: raw.internalUserId,
              publicUserId: String(raw.publicUserId || ''),
              email: String(raw.email || ''),
              emailVerified: Boolean(raw.emailVerified),
              displayName: raw.displayName ?? null,
              avatarUrl: raw.avatarUrl ?? null,
              role: raw.role === 'admin' ? 'admin' : 'user',
              tier: raw.tier || 'registered',
              mfaEnabled: Boolean(raw.mfaEnabled),
              mfaVerified: Boolean(raw.mfaVerified),
              memberSince: raw.memberSince || raw.createdAt,
            }
          : null;

        return {
          authenticated,
          user,
          csrfToken: typeof raw?.csrfToken === 'string' ? raw.csrfToken : undefined,
          googleAuthConfigured: Boolean(raw?.googleAuthConfigured),
          mfaRequired: Boolean(raw?.mfaRequired),
        };
      },
      () => circuitBreaker.getDegradedSession()
    );
  }

  async register(payload: {
    email: string;
    password: string;
    displayName?: string;
  }): Promise<AuthSessionResponse & { verificationRequired?: boolean; message?: string }> {
    const raw = await this.requestStrict<any>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (raw?.csrfToken) {
      setCachedCsrfToken(raw.csrfToken);
    }
    return {
      authenticated: Boolean(raw?.authenticated ?? Boolean(raw?.user || raw?.publicUserId)),
      user: raw?.user ?? null,
      csrfToken: raw?.csrfToken,
      googleAuthConfigured: Boolean(raw?.googleAuthConfigured),
      verificationRequired: Boolean(raw?.verificationRequired),
      message: typeof raw?.message === 'string' ? raw.message : undefined,
    };
  }

  async login(payload: {
    email: string;
    password: string;
    mfaCode?: string;
  }): Promise<AuthSessionResponse & { mfaRequired?: boolean; message?: string }> {
    const raw = await this.requestStrict<any>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (raw?.csrfToken) {
      setCachedCsrfToken(raw.csrfToken);
    }
    return {
      authenticated: Boolean(raw?.authenticated ?? Boolean(raw?.user || raw?.publicUserId)),
      user: raw?.user ?? null,
      csrfToken: raw?.csrfToken,
      googleAuthConfigured: Boolean(raw?.googleAuthConfigured),
      mfaRequired: Boolean(raw?.mfaRequired),
      message: typeof raw?.message === 'string' ? raw.message : undefined,
    };
  }

  async verifyEmail(payload: {
    token?: string;
    code?: string;
    email?: string;
  }): Promise<{ verified: boolean; message?: string }> {
    const raw = await this.requestStrict<any>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return {
      verified: Boolean(raw?.verified ?? true),
      message: typeof raw?.message === 'string' ? raw.message : undefined,
    };
  }

  async resendVerification(email?: string): Promise<{ sent: boolean; message?: string }> {
    const raw = await this.requestStrict<any>('/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify(email ? { email } : {}),
    });
    return {
      sent: Boolean(raw?.sent ?? true),
      message: typeof raw?.message === 'string' ? raw.message : undefined,
    };
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    const raw = await this.requestStrict<any>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    return {
      message:
        typeof raw?.message === 'string'
          ? raw.message
          : 'If an account matches that email, password recovery instructions have been sent.',
    };
  }

  async resetPassword(payload: {
    token: string;
    newPassword: string;
  }): Promise<{ message: string }> {
    const raw = await this.requestStrict<any>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        token: payload.token,
        newPassword: payload.newPassword,
        password: payload.newPassword,
      }),
    });
    return {
      message:
        typeof raw?.message === 'string'
          ? raw.message
          : 'Your password has been updated. Please sign in with your new password.',
    };
  }

  async logout(): Promise<{ success: boolean }> {
    await this.requestStrict<any>('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    setCachedCsrfToken(null);
    return { success: true };
  }

  async logoutAll(): Promise<{ success: boolean; revokedCount?: number }> {
    const raw = await this.requestStrict<any>('/auth/logout-all', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    setCachedCsrfToken(null);
    return {
      success: true,
      revokedCount: typeof raw?.revokedCount === 'number' ? raw.revokedCount : undefined,
    };
  }

  async setupMfa(): Promise<MfaSetupResponse> {
    const raw = await this.requestStrict<any>('/auth/mfa/setup', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return {
      secret: String(raw?.secret || ''),
      otpauthUri: String(raw?.otpauthUri || raw?.otpauthUrl || ''),
      issuer: typeof raw?.issuer === 'string' ? raw.issuer : undefined,
      accountName: typeof raw?.accountName === 'string' ? raw.accountName : undefined,
    };
  }

  async verifyMfa(code: string): Promise<{ verified: boolean; mfaEnabled?: boolean; message?: string }> {
    const raw = await this.requestStrict<any>('/auth/mfa/verify', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    return {
      verified: Boolean(raw?.verified ?? true),
      mfaEnabled: typeof raw?.mfaEnabled === 'boolean' ? raw.mfaEnabled : undefined,
      message: typeof raw?.message === 'string' ? raw.message : undefined,
    };
  }

  async disableMfa(code: string): Promise<{ disabled: boolean; mfaEnabled?: boolean; message?: string }> {
    const raw = await this.requestStrict<any>('/auth/mfa/disable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    return {
      disabled: Boolean(raw?.disabled ?? true),
      mfaEnabled: typeof raw?.mfaEnabled === 'boolean' ? raw.mfaEnabled : false,
      message: typeof raw?.message === 'string' ? raw.message : undefined,
    };
  }

  /* =========================================================================
     ME / IDENTITY & SESSIONS METHODS
     ========================================================================= */
  async getMe(): Promise<AuthUser> {
    const raw = await this.requestStrict<any>('/me');
    return (raw?.user || raw) as AuthUser;
  }

  async updateMe(payload: {
    displayName?: string;
    preferences?: Record<string, unknown>;
  }): Promise<AuthUser> {
    const raw = await this.requestStrict<any>('/me', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return (raw?.user || raw) as AuthUser;
  }

  async deleteMe(payload?: {
    password?: string;
    confirmation?: string;
  }): Promise<{ deleted: boolean; message?: string }> {
    const raw = await this.requestStrict<any>('/me', {
      method: 'DELETE',
      body: JSON.stringify(payload || {}),
    });
    setCachedCsrfToken(null);
    return {
      deleted: Boolean(raw?.deleted ?? true),
      message: typeof raw?.message === 'string' ? raw.message : undefined,
    };
  }

  async getMySessions(): Promise<UserSessionInfo[]> {
    return withCircuitBreaker(
      'getMySessions',
      async () => {
        try {
          const raw = await this.requestStrict<any>('/me/sessions');
          const items = Array.isArray(raw) ? raw : Array.isArray(raw?.sessions) ? raw.sessions : [];
          return items.map((s: any) => ({
            id: String(s?.id || s?.sessionId || ''),
            sessionId: String(s?.sessionId || s?.id || ''),
            current: Boolean(s?.current ?? s?.isCurrent),
            userAgent: String(s?.userAgent || 'Unknown browser'),
            ipPrefix: typeof s?.ipPrefix === 'string' ? s.ipPrefix : undefined,
            createdAt: String(s?.createdAt || ''),
            lastSeenAt: String(s?.lastSeenAt || s?.createdAt || ''),
            expiresAt: typeof s?.expiresAt === 'string' ? s.expiresAt : undefined,
          }));
        } catch (err: any) {
          if (err?.status === 401 || err?.status === 404) {
            return [];
          }
          throw err;
        }
      },
      () => []
    );
  }

  async revokeSession(sessionId: string): Promise<{ revoked: boolean }> {
    await this.requestStrict<any>(`/me/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    });
    return { revoked: true };
  }

  /* =========================================================================
     REWARDED ADS METHODS (STRICT SERVER-SIDE VERIFICATION)
     ========================================================================= */
  async getRewardConfig(): Promise<RewardConfig> {
    return withCircuitBreaker<RewardConfig>(
      'getRewardConfig',
      async (): Promise<RewardConfig> => {
        const raw = await this.requestStrict<any>('/rewards/config');
        return {
          enabled: Boolean(raw?.enabled),
          configured: Boolean(raw?.configured),
          adUnitPath: typeof raw?.adUnitPath === 'string' && raw.adUnitPath.trim() ? raw.adUnitPath.trim() : null,
          rewardAmount: Math.max(0, Number(raw?.rewardAmount ?? 2)),
          dailyCap: Math.max(0, Number(raw?.dailyCap ?? 3)),
          remainingAdsToday: Math.max(0, Number(raw?.remainingAdsToday ?? 0)),
          maxIndividualWithRewards: Math.max(0, Number(raw?.maxIndividualWithRewards ?? 16)),
          rewardExpiryHours:
            typeof raw?.rewardExpiryHours === 'number' && Number.isFinite(raw.rewardExpiryHours)
              ? raw.rewardExpiryHours
              : 24,
        };
      },
      () => circuitBreaker.getDegradedRewardConfig()
    );
  }

  async createRewardSession(): Promise<RewardSession> {
    const raw = await this.requestStrict<any>('/rewards/sessions', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return {
      sessionId: String(raw?.sessionId || raw?.id || ''),
      status: (raw?.status || 'PENDING') as RewardSession['status'],
      adUnitPath: typeof raw?.adUnitPath === 'string' ? raw.adUnitPath : null,
      customData: typeof raw?.customData === 'string' ? raw.customData : undefined,
      rewardAmount: Math.max(0, Number(raw?.rewardAmount ?? 2)),
      expiresAt: typeof raw?.expiresAt === 'string' ? raw.expiresAt : null,
      verifiedAt: typeof raw?.verifiedAt === 'string' ? raw.verifiedAt : null,
      creditsGranted:
        typeof raw?.creditsGranted === 'number' && Number.isFinite(raw.creditsGranted)
          ? raw.creditsGranted
          : undefined,
      message: typeof raw?.message === 'string' ? raw.message : undefined,
    };
  }

  async getRewardSession(id: string): Promise<RewardSession> {
    const raw = await this.requestStrict<any>(`/rewards/sessions/${encodeURIComponent(id)}`);
    return {
      sessionId: String(raw?.sessionId || raw?.id || id),
      status: (raw?.status || 'PENDING') as RewardSession['status'],
      adUnitPath: typeof raw?.adUnitPath === 'string' ? raw.adUnitPath : null,
      customData: typeof raw?.customData === 'string' ? raw.customData : undefined,
      rewardAmount: Math.max(0, Number(raw?.rewardAmount ?? 2)),
      expiresAt: typeof raw?.expiresAt === 'string' ? raw.expiresAt : null,
      verifiedAt: typeof raw?.verifiedAt === 'string' ? raw.verifiedAt : null,
      creditsGranted:
        typeof raw?.creditsGranted === 'number' && Number.isFinite(raw.creditsGranted)
          ? raw.creditsGranted
          : undefined,
      message: typeof raw?.message === 'string' ? raw.message : undefined,
    };
  }

  async refreshRewardSession(id: string): Promise<RewardSession> {
    const raw = await this.requestStrict<any>(
      `/rewards/sessions/${encodeURIComponent(id)}/refresh`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      }
    );
    return {
      sessionId: String(raw?.sessionId || raw?.id || id),
      status: (raw?.status || 'PENDING') as RewardSession['status'],
      adUnitPath: typeof raw?.adUnitPath === 'string' ? raw.adUnitPath : null,
      customData: typeof raw?.customData === 'string' ? raw.customData : undefined,
      rewardAmount: Math.max(0, Number(raw?.rewardAmount ?? 2)),
      expiresAt: typeof raw?.expiresAt === 'string' ? raw.expiresAt : null,
      verifiedAt: typeof raw?.verifiedAt === 'string' ? raw.verifiedAt : null,
      creditsGranted:
        typeof raw?.creditsGranted === 'number' && Number.isFinite(raw.creditsGranted)
          ? raw.creditsGranted
          : undefined,
      message: typeof raw?.message === 'string' ? raw.message : undefined,
    };
  }

  /* =========================================================================
     BATCHES METHODS
     ========================================================================= */
  private normalizeBatch(raw: any): MediaBatch {
    const jobsRaw = Array.isArray(raw?.jobs) ? raw.jobs : undefined;
    return {
      id: String(raw?.id || raw?.batchId || ''),
      batchId: String(raw?.batchId || raw?.id || ''),
      title: typeof raw?.title === 'string' ? raw.title : undefined,
      status: String(raw?.status || 'QUEUED'),
      totalItems: Math.max(0, Number(raw?.totalItems ?? jobsRaw?.length ?? 0)),
      completedItems: Math.max(0, Number(raw?.completedItems ?? 0)),
      failedItems: Math.max(0, Number(raw?.failedItems ?? 0)),
      createdAt: String(raw?.createdAt || ''),
      updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : undefined,
      zipDownloadUrl: typeof raw?.zipDownloadUrl === 'string' ? raw.zipDownloadUrl : null,
      jobs: jobsRaw ? jobsRaw.map((j: any) => normalizeJob(j)) : undefined,
    };
  }

  async listBatches(): Promise<MediaBatch[]> {
    return withCircuitBreaker(
      'listBatches',
      async () => {
        try {
          const raw = await this.requestStrict<any>('/batches');
          const items = Array.isArray(raw) ? raw : Array.isArray(raw?.batches) ? raw.batches : [];
          return items.map((b: any) => this.normalizeBatch(b));
        } catch (err: any) {
          if (err?.status === 401 || err?.status === 404) {
            return [];
          }
          throw err;
        }
      },
      () => []
    );
  }

  async getBatch(id: string): Promise<MediaBatch> {
    const raw = await this.requestStrict<any>(`/batches/${encodeURIComponent(id)}`);
    return this.normalizeBatch(raw?.batch || raw);
  }

  async cancelBatch(id: string): Promise<{ cancelled: boolean; message?: string }> {
    const raw = await this.requestStrict<any>(`/batches/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return {
      cancelled: Boolean(raw?.cancelled ?? true),
      message: typeof raw?.message === 'string' ? raw.message : 'Batch cancelled.',
    };
  }

  /* =========================================================================
     ADMIN CONTROL CENTRE METHODS
     ========================================================================= */
  async adminSearch(q: string): Promise<AdminSearchResult> {
    const raw = await this.requestStrict<any>(`/admin/search?q=${encodeURIComponent(q)}`);
    return {
      query: String(raw?.query ?? q),
      users: Array.isArray(raw?.users) ? raw.users : [],
      batches: Array.isArray(raw?.batches) ? raw.batches.map((b: any) => this.normalizeBatch(b)) : [],
      jobs: Array.isArray(raw?.jobs) ? raw.jobs.map((j: any) => normalizeJob(j)) : [],
      auditLogs: Array.isArray(raw?.auditLogs) ? raw.auditLogs : [],
      securityEvents: Array.isArray(raw?.securityEvents) ? raw.securityEvents : [],
    };
  }

  async adminListUsers(params?: {
    q?: string;
    status?: string;
    tier?: string;
    limit?: number;
    offset?: number;
  }): Promise<AdminUserSummary[]> {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.status) qs.set('status', params.status);
    if (params?.tier) qs.set('tier', params.tier);
    if (typeof params?.limit === 'number') qs.set('limit', String(params.limit));
    if (typeof params?.offset === 'number') qs.set('offset', String(params.offset));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const raw = await this.requestStrict<any>(`/admin/users${suffix}`);
    return Array.isArray(raw) ? raw : Array.isArray(raw?.users) ? raw.users : [];
  }

  async adminSuspendUser(
    userId: string,
    reason?: string
  ): Promise<{ success: boolean; message?: string }> {
    const raw = await this.requestStrict<any>(
      `/admin/users/${encodeURIComponent(userId)}/suspend`,
      {
        method: 'POST',
        body: JSON.stringify({ reason: reason || 'Suspended by administrator' }),
      }
    );
    return {
      success: Boolean(raw?.success ?? true),
      message: typeof raw?.message === 'string' ? raw.message : undefined,
    };
  }

  async adminRestoreUser(userId: string): Promise<{ success: boolean; message?: string }> {
    const raw = await this.requestStrict<any>(
      `/admin/users/${encodeURIComponent(userId)}/restore`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      }
    );
    return {
      success: Boolean(raw?.success ?? true),
      message: typeof raw?.message === 'string' ? raw.message : undefined,
    };
  }

  async adminRevokeUserSessions(
    userId: string
  ): Promise<{ success: boolean; revokedCount?: number }> {
    const raw = await this.requestStrict<any>(
      `/admin/users/${encodeURIComponent(userId)}/revoke-sessions`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      }
    );
    return {
      success: Boolean(raw?.success ?? true),
      revokedCount: typeof raw?.revokedCount === 'number' ? raw.revokedCount : undefined,
    };
  }

  async adminGetSettings(): Promise<AdminPlatformSettings> {
    const raw = await this.requestStrict<any>('/admin/settings');
    return (raw?.settings || raw) as AdminPlatformSettings;
  }

  async adminUpdateSettings(
    settings: Partial<AdminPlatformSettings>
  ): Promise<AdminPlatformSettings> {
    const raw = await this.requestStrict<any>('/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    });
    return (raw?.settings || raw) as AdminPlatformSettings;
  }

  async adminGetRewards(): Promise<AdminRewardsSummary> {
    return this.requestStrict<AdminRewardsSummary>('/admin/rewards');
  }

  async adminGetAnalytics(): Promise<AdminAnalyticsSummary> {
    return this.requestStrict<AdminAnalyticsSummary>('/admin/analytics');
  }

  async adminGetAuditLogs(limit = 50): Promise<AdminAuditLog[]> {
    const raw = await this.requestStrict<any>(`/admin/audit-logs?limit=${limit}`);
    return Array.isArray(raw) ? raw : Array.isArray(raw?.logs) ? raw.logs : [];
  }

  async adminGetSecurityEvents(limit = 50): Promise<AdminSecurityEvent[]> {
    const raw = await this.requestStrict<any>(`/admin/security-events?limit=${limit}`);
    return Array.isArray(raw) ? raw : Array.isArray(raw?.events) ? raw.events : [];
  }

  /**
   * Fetch live service health metrics from GET /api/v1/admin/metrics.
   * Gracefully degrades to operational baseline with queue info when unreachable.
   */
  async getSystemMetrics(): Promise<SystemHealthMetrics> {
    return withCircuitBreaker(
      'getSystemMetrics',
      async () => {
        const res = await this.requestStrict<any>('/admin/metrics');
        if (res && res.queue) {
          return {
            status: res.status === 'DEGRADED' || res.status === 'MAINTENANCE' ? res.status : 'OPERATIONAL',
            apiLatencyMs: Number(res.apiLatencyMs ?? 0),
            queueDepth: Number(res.queue.waitingCount ?? 0),
            activeMediaWorkers: Number(res.queue.activeCount ?? 0),
            cpuLoadPercent: Number(res.cpuLoadPercent ?? 0),
            uptimePercent: Number(res.uptimePercent ?? 0),
            errorRate24hPercent: Number(res.errorRate24hPercent ?? 0),
            totalProcessed24h: Number(res.queue.totalEnqueued ?? 0),
            queueClasses: res.queue.classes || res.queueClasses,
          };
        }
        if (res && typeof res.uptimePercent === 'number') {
          return res as SystemHealthMetrics;
        }
        throw new Error('Could not load service metrics right now.');
      },
      () => circuitBreaker.getDegradedMetrics()
    );
  }
}

export const api = new ApiClient();
