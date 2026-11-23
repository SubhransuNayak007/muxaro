/**
 * MUXARO Media Processing Platform - Jobs Execution & SSE Streaming Routes
 *
 * Implements:
 * 1. POST /v1/jobs - Multi-lane job dispatcher:
 *    - Quota checks (daily allowance & active concurrency limits)
 *    - Idempotency & distributed Redis deduplication (muxaro:dedup:{jobHash})
 *    - 4-lane intelligent routing (lane:fast-io, lane:transcode, lane:batch)
 *    - Automatic Eco Mode lossless remux detection (canZeroCopyRemux)
 * 2. GET /v1/jobs/:id - Single job status inspection with signed download URLs
 * 3. GET /v1/jobs/:id/events - Server-Sent Events (SSE) streaming real-time progress
 *    from Redis Pub/Sub muxaro:events:job:{jobId}
 * 4. POST /v1/jobs/:id/cancel - Gracefully cancels active or queued jobs
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import {
  createJobRequestSchema,
  canZeroCopyRemux,
  MuxaroError,
  RETENTION_SECONDS,
  TIER_CONFIGS,
  type LaneType,
  type RetentionTier,
  type JobProgressEvent,
} from '@muxaro/shared';
import {
  getDb,
  getMuxaroRedis,
  mediaJobs,
  dailyUsageLedger,
  type MediaJob,
  eq,
  and,
  sql,
} from '@muxaro/db';
import { getFastIoQueue, getTranscodeQueue, getBatchQueue } from '../lib/queues.js';
import { getS3Client, getStorageConfig, generateSignedDownloadUrl } from '../lib/s3.js';
import { queueService } from '../services/queue.service.js';
import {
  mintScopedWorkerTicket,
  verifyProgressToken,
  type ScopedWorkerTicket,
} from '../security/scoped-job-urls.js';

function computeJobDedupHash(params: {
  tool: string;
  sourceUrl?: string;
  uploadSessionId?: string;
  targetFormat: string;
  targetResolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioBitrate?: string;
}): string {
  const source = params.sourceUrl || params.uploadSessionId || '';
  const raw = [
    params.tool,
    source,
    params.targetFormat,
    params.targetResolution || '',
    params.videoCodec || '',
    params.audioCodec || '',
    params.audioBitrate || '',
  ].join(':');

  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
}

function getGuestIpHash(req: FastifyRequest): string {
  if (req.guestIpHash) return req.guestIpHash;
  const clientIp = req.ip || '127.0.0.1';
  return crypto.createHash('sha256').update(clientIp).digest('hex');
}

export function buildJobOwnershipCondition(req: FastifyRequest) {
  const targetUserId = req.user?.id || null;
  const targetGuestHash = req.user ? null : getGuestIpHash(req);

  return sql`((${mediaJobs.userId} IS NOT NULL AND ${mediaJobs.userId} = ${targetUserId}) OR (${mediaJobs.userId} IS NULL AND (${mediaJobs.guestSessionHash} = ${targetGuestHash} OR ${mediaJobs.guestIpHash} = ${targetGuestHash})))`;
}

function assertJobOwnership(job: MediaJob, req: FastifyRequest): void {
  if (req.user && job.userId) {
    if (job.userId !== req.user.id) {
      throw MuxaroError.notFound(`Job ${job.id} not found`);
    }
    return;
  }

  const effectiveGuestHash = getGuestIpHash(req);
  const guestHash = job.guestSessionHash || job.guestIpHash;
  if (!req.user && guestHash) {
    if (guestHash !== effectiveGuestHash) {
      throw MuxaroError.notFound(`Job ${job.id} not found`);
    }
    return;
  }

  if (req.user && guestHash === effectiveGuestHash) {
    return;
  }

  if (!job.userId && !req.user) {
    return;
  }

  throw MuxaroError.notFound(`Job ${job.id} not found`);
}

function formatJobResponse(job: MediaJob) {
  let downloadUrl: string | undefined;
  const isCompleted =
    job.status === 'completed' ||
    String(job.status).toUpperCase() === 'READY' ||
    String(job.status).toUpperCase() === 'COMPLETED';

  if (isCompleted && job.outputStorageKey && job.outputFilename) {
    const remainingSeconds = Math.max(
      0,
      Math.floor((new Date(job.expiresAt).getTime() - Date.now()) / 1000)
    );
    if (remainingSeconds > 0) {
      const cleanKey = job.outputStorageKey.replace(/^\/+/, '');
      const encodedFn = encodeURIComponent(job.outputFilename);
      if (
        process.env.DOWNLOAD_DIRECT === 'true' ||
        process.env.NODE_ENV === 'development' ||
        !process.env.DOWNLOAD_WORKER_URL
      ) {
        downloadUrl = `/v1/downloads/file/${cleanKey}?fn=${encodedFn}`;
      } else {
        downloadUrl = generateSignedDownloadUrl(
          job.outputStorageKey,
          job.outputFilename,
          remainingSeconds
        );
      }
    }
  }

  let checksumSha256: string | undefined = (job as any).checksumSha256;
  if (!checksumSha256 && isCompleted && job.outputStorageKey) {
    try {
      const cleanKey = job.outputStorageKey.replace(/^\/+/, '');
      const candidates = [
        path.resolve(process.cwd(), 'storage/artifacts', cleanKey),
        path.resolve(process.cwd(), 'storage', cleanKey),
        path.resolve(process.cwd(), 'apps/worker-media/storage/artifacts', cleanKey),
        path.resolve(process.cwd(), 'apps/worker-media/storage', cleanKey),
        path.resolve(process.cwd(), '../worker-media/storage/artifacts', cleanKey),
        path.resolve(process.cwd(), '../worker-media/storage', cleanKey),
        path.resolve(process.cwd(), 'apps/api/storage/artifacts', cleanKey),
        path.resolve(process.cwd(), 'apps/api/storage', cleanKey),
        path.resolve('D:/yt doenlord/apps/worker-media/storage/artifacts', cleanKey),
        path.resolve('D:/yt doenlord/apps/worker-media/storage', cleanKey),
        path.resolve('D:/yt doenlord/storage/artifacts', cleanKey),
        path.resolve('D:/yt doenlord/storage', cleanKey),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          checksumSha256 = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
          break;
        }
      }
    } catch {}
  }

  const upperStatus = String(job.status || 'QUEUED').toUpperCase();
  const normalizedStatus = upperStatus === 'COMPLETED' ? 'READY' : upperStatus;

  const operation =
    job.tool === 'extract_audio'
      ? 'EXTRACT_AUDIO'
      : job.tool === 'merge_av'
      ? 'MERGE_AUDIO_VIDEO'
      : 'TRANSCODE_VIDEO';

  return {
    id: job.id,
    jobId: job.id,
    tool: job.tool,
    operation,
    status: normalizedStatus,
    rawStatus: job.status,
    lane: job.lane,
    priority: job.priority,
    targetFormat: job.targetFormat || undefined,
    targetResolution: job.targetResolution || undefined,
    progressPercent: Number.parseFloat(String(job.progressPercent || '0')),
    stage: job.stage,
    stageMessage: job.stageMessage || undefined,
    downloadUrl,
    filename: job.outputFilename || undefined,
    outputFilename: job.outputFilename || undefined,
    sizeBytes: job.outputSizeBytes || undefined,
    outputSizeBytes: job.outputSizeBytes || undefined,
    checksumSha256: checksumSha256 || undefined,
    durationSeconds: job.durationSeconds
      ? Number.parseFloat(String(job.durationSeconds))
      : undefined,
    retentionTier: job.retentionTier,
    expiresAt: new Date(job.expiresAt).toISOString(),
    errorCode: job.errorCode || undefined,
    errorMessage: job.errorMessage || undefined,
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
    completedAt: job.completedAt ? new Date(job.completedAt).toISOString() : undefined,
  };
}

export async function resolveCobaltStream(
  url: string,
  options: { quality?: string; format?: string } = {}
): Promise<{ streamUrl: string; filename?: string } | null> {
  const instances = [
    'https://api.cobalt.tools/api/json',
    'https://cobalt-api.kwiatekm.tokyo/api/json',
    'https://co.wuk.sh/api/json',
  ];

  for (const instance of instances) {
    try {
      const res = await fetch(instance, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        body: JSON.stringify({
          url,
          videoQuality: options.quality || 'max',
          youtubeVideoCodec: 'h264',
          audioFormat: options.format === 'mp3' ? 'mp3' : 'best',
          downloadMode: options.format === 'mp3' ? 'audio' : 'auto',
        }),
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        const json = (await res.json()) as any;
        if (json.url && (json.status === 'tunnel' || json.status === 'redirect' || json.status === 'stream' || json.status === 'success')) {
          return {
            streamUrl: json.url,
            filename: json.filename,
          };
        }
      }
    } catch {
      // try next instance
    }
  }
  return null;
}

function isForbiddenStreamUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
      /^169\.254\./.test(host)
    ) {
      return true;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

export async function pipeRemoteStreamToReply(
  remoteUrl: string,
  reply: FastifyReply,
  filename: string,
  contentType = 'video/mp4'
): Promise<void> {
  if (isForbiddenStreamUrl(remoteUrl)) {
    throw new Error('Access to restricted or private destination is blocked for security reasons');
  }

  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const cleanEncoded = encodeURIComponent(safeFilename);

  const upstreamRes = await fetch(remoteUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(60000),
  });

  if (!upstreamRes.ok || !upstreamRes.body) {
    throw new Error(`Upstream stream returned HTTP ${upstreamRes.status}`);
  }

  const upstreamLength = upstreamRes.headers.get('content-length');
  const upstreamType = upstreamRes.headers.get('content-type') || contentType;

  const headers: Record<string, string> = {
    'Content-Type': upstreamType,
    'Content-Disposition': `attachment; filename="${safeFilename}"; filename*=UTF-8''${cleanEncoded}`,
    'Connection': 'keep-alive',
  };

  if (upstreamLength) {
    headers['Content-Length'] = upstreamLength;
  } else {
    headers['Transfer-Encoding'] = 'chunked';
  }

  reply.raw.writeHead(200, headers);

  const reader = upstreamRes.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!reply.raw.writableEnded) {
        reply.raw.write(value);
      }
    }
    if (!reply.raw.writableEnded) {
      reply.raw.end();
    }
  } catch {
    reader.cancel().catch(() => {});
    if (!reply.raw.writableEnded) {
      reply.raw.end();
    }
  }
}

export const jobsRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();
  const redis = getMuxaroRedis();

  fastify.addHook('preHandler', async (request: FastifyRequest) => {
    if (!request.guestIpHash) {
      const clientIp = request.ip || '127.0.0.1';
      request.guestIpHash = crypto.createHash('sha256').update(clientIp).digest('hex');
    }
    if (!request.tier) {
      request.tier = request.user ? 'free_account' : 'guest';
    }
    if (!request.tierLimits) {
      request.tierLimits = TIER_CONFIGS[request.tier] || TIER_CONFIGS.guest;
    }
    if (!request.subjectKey) {
      request.subjectKey = request.user?.id
        ? `user:${request.user.id}`
        : `guest:${request.guestIpHash}`;
    }
  });

  // ===========================================================================
  // 1. POST /v1/jobs
  // ===========================================================================
  fastify.post('/jobs', async (request: FastifyRequest, reply: FastifyReply) => {
    // 0. Pre-normalize client payloads for resilient cross-client compatibility
    const rawBody = (request.body && typeof request.body === 'object')
      ? { ...(request.body as Record<string, any>) }
      : {};

    if (!rawBody.tool) {
      const op = String(rawBody.operation || rawBody.jobType || '').toUpperCase();
      if (op.includes('AUDIO') || op === 'EXTRACT_AUDIO') {
        rawBody.tool = 'extract_audio';
      } else if (op.includes('MERGE') || op === 'MERGE_AUDIO_VIDEO' || op === 'MERGE_AV') {
        rawBody.tool = 'merge_av';
      } else if (op.includes('BATCH') || op.includes('PLAYLIST')) {
        rawBody.tool = 'batch_playlist';
      } else {
        rawBody.tool = 'convert_video';
      }
    }

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!rawBody.sourceUrl && rawBody.mediaUrl) {
      rawBody.sourceUrl = rawBody.mediaUrl;
    }

    // Only assign uploadSessionId from mediaAssetId if it is a valid UUID
    if (!rawBody.uploadSessionId && (rawBody.mediaAssetId || rawBody.assetId)) {
      const candidateId = String(rawBody.mediaAssetId || rawBody.assetId).trim();
      if (UUID_REGEX.test(candidateId)) {
        rawBody.uploadSessionId = candidateId;
      }
    }

    // If sourceUrl is provided or uploadSessionId is not a valid UUID, remove uploadSessionId
    if (typeof rawBody.uploadSessionId === 'string') {
      const trimmed = rawBody.uploadSessionId.trim();
      if (!UUID_REGEX.test(trimmed) || (rawBody.sourceUrl && /^https?:\/\//i.test(String(rawBody.sourceUrl).trim()))) {
        delete rawBody.uploadSessionId;
      } else {
        rawBody.uploadSessionId = trimmed;
      }
    } else {
      delete rawBody.uploadSessionId;
    }

    if (typeof rawBody.secondaryAudioSessionId === 'string') {
      const trimmed = rawBody.secondaryAudioSessionId.trim();
      if (!UUID_REGEX.test(trimmed)) {
        delete rawBody.secondaryAudioSessionId;
      } else {
        rawBody.secondaryAudioSessionId = trimmed;
      }
    } else {
      delete rawBody.secondaryAudioSessionId;
    }

    if (!rawBody.idempotencyKey) {
      rawBody.idempotencyKey = (request.headers['idempotency-key'] as string) || crypto.randomUUID();
    }

    if (typeof rawBody.targetFormat === 'string') {
      rawBody.targetFormat = rawBody.targetFormat.trim().toLowerCase();
    }

    // Fast-path & Cobalt stream tunnel handling
    const targetExt = (rawBody.targetFormat || 'mp4').toLowerCase().replace(/^\./, '');
    const defaultFilename = `media_${Date.now()}.${targetExt}`;
    const candidateName = String(rawBody.outputFilename || rawBody.filename || defaultFilename);
    const safeFilename = candidateName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const cleanEncoded = encodeURIComponent(safeFilename);
    const streamContentType = targetExt === 'mp3' ? 'audio/mpeg' : targetExt === 'webm' ? 'video/webm' : `video/${targetExt}`;

    const isDirectStreamPipe = Boolean(
      rawBody.stream === true ||
      rawBody.tunnel === true ||
      (request.query as any)?.stream === 'true' ||
      (request.query as any)?.tunnel === 'true' ||
      (request.headers.accept && (
        request.headers.accept.includes('video/') ||
        request.headers.accept.includes('audio/') ||
        request.headers.accept.includes('application/octet-stream')
      ))
    );

    // Direct stream piping mode with Content-Disposition: attachment
    if (isDirectStreamPipe) {
      const directUrl = rawBody.cobaltUrl || rawBody.directStreamUrl || rawBody.streamUrl;
      if (directUrl && typeof directUrl === 'string' && /^https?:\/\//i.test(directUrl)) {
        try {
          await pipeRemoteStreamToReply(directUrl, reply, safeFilename, streamContentType);
          return;
        } catch (err: any) {
          request.log.warn({ err }, '[Jobs] Failed to pipe direct stream URL, falling back');
        }
      }

      if (rawBody.sourceUrl) {
        const sourceUrl = String(rawBody.sourceUrl).trim();
        // Try Cobalt resolver first if useCobalt was set
        if (rawBody.useCobalt) {
          const cobalt = await resolveCobaltStream(sourceUrl, {
            quality: rawBody.targetResolution,
            format: targetExt,
          });
          if (cobalt?.streamUrl) {
            try {
              await pipeRemoteStreamToReply(cobalt.streamUrl, reply, cobalt.filename || safeFilename, streamContentType);
              return;
            } catch (err: any) {
              request.log.warn({ err }, '[Jobs] Failed to pipe Cobalt stream, falling back to yt-dlp');
            }
          }
        }

        // yt-dlp direct progressive stream pipe
        reply.raw.writeHead(200, {
          'Content-Type': streamContentType,
          'Content-Disposition': `attachment; filename="${safeFilename}"; filename*=UTF-8''${cleanEncoded}`,
          'Transfer-Encoding': 'chunked',
          'Connection': 'keep-alive',
        });

        const isYouTube = /youtu\.?be/i.test(sourceUrl);
        const ytdlpArgs = [
          '--no-warnings',
          '--no-playlist',
          '--js-runtimes', 'deno,node',
          ...(isYouTube ? ['--extractor-args', 'youtube:player_client=ios,android,tv,mweb,web', '--force-ipv4'] : []),
          '-f', rawBody.formatId || (targetExt === 'mp3' ? 'bestaudio/best' : 'best[ext=mp4]/bestvideo+bestaudio/best'),
          '-o', '-',
          '--',
          sourceUrl,
        ];

        const env = { ...process.env };
        const customPaths = [
          'C:\\Users\\sbhrn\\.deno\\bin',
          'C:\\Users\\sbhrn\\AppData\\Local\\Programs\\Python\\Python312\\Scripts',
          'C:\\Users\\sbhrn\\AppData\\Local\\Programs\\Python\\Python312',
          path.join(os.homedir(), '.deno', 'bin'),
        ];
        env.PATH = `${customPaths.join(';')};${env.PATH || ''}`;
        env.Path = env.PATH;

        const child = spawn('yt-dlp', ytdlpArgs, {
          shell: false,
          windowsHide: true,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        child.stdout.pipe(reply.raw);

        request.raw.on('close', () => {
          try {
            if (child.pid) {
              spawn('taskkill', ['/pid', child.pid.toString(), '/T', '/F'], { shell: false, windowsHide: true });
            }
          } catch {}
        });

        return;
      }
    }

    // JSON Fast-Path / Cobalt Dispatch (Immediate READY response)
    if (rawBody.useCobalt || rawBody.cobaltUrl || rawBody.directStreamUrl || rawBody.streamUrl) {
      let resolvedStreamUrl: string | undefined = rawBody.cobaltUrl || rawBody.directStreamUrl || rawBody.streamUrl;
      let resolvedFilename = safeFilename;

      if (!resolvedStreamUrl && rawBody.sourceUrl) {
        const cobalt = await resolveCobaltStream(String(rawBody.sourceUrl).trim(), {
          quality: rawBody.targetResolution,
          format: targetExt,
        });
        if (cobalt?.streamUrl) {
          resolvedStreamUrl = cobalt.streamUrl;
          if (cobalt.filename) resolvedFilename = cobalt.filename;
        }
      }

      if (resolvedStreamUrl) {
        const instantJobId = crypto.randomUUID();
        const instantJob = {
          id: instantJobId,
          jobId: instantJobId,
          tool: rawBody.tool || 'convert_video',
          status: 'READY',
          state: 'READY',
          lane: 'fast_io' as LaneType,
          progress: 100,
          progressPercent: '100.00',
          stage: 'ready',
          stageMessage: 'Media stream ready for instant download',
          downloadUrl: resolvedStreamUrl,
          outputFilename: resolvedFilename,
          outputSizeBytes: rawBody.outputSizeBytes || 0,
          strategyLabel: 'Cobalt Stream Fast-Path',
          losslessPreserved: true,
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        };

        await redis.setJobState(instantJobId, instantJob, 3600);

        return reply.status(200).send({
          success: true,
          data: instantJob,
          ...instantJob,
        });
      }
    }

    // 1. Validate incoming payload against strict Zod schema
    const parseResult = createJobRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      throw MuxaroError.invalidPayload('Invalid job creation payload', {
        errors: parseResult.error.format(),
      });
    }

    const body = parseResult.data;

    // Resolve user tier and entitlements with resilient fallback
    const userTier = request.tier || (request.user ? 'free_account' : 'guest');
    const limits = request.tierLimits || TIER_CONFIGS[userTier] || TIER_CONFIGS.guest;
    const clientIp = request.ip || '127.0.0.1';
    const guestHash = request.guestIpHash || crypto.createHash('sha256').update(clientIp).digest('hex');
    const subjectKey = request.subjectKey || (request.user?.id ? `user:${request.user.id}` : `guest:${guestHash}`);

    // 2. Validate tool permissions for user tier
    if (!limits.allowedTools.includes(body.tool)) {
      throw MuxaroError.forbidden(
        `Tool "${body.tool}" is not permitted for the ${userTier} tier. Please sign up or upgrade.`
      );
    }

    // 3. Atomically acquire quota & concurrency slot via Redis Lua script
    const maxConcurrent = limits.maxConcurrentJobs;
    const maxDaily = limits.dailyJobLimit;
    const candidateJobId = crypto.randomUUID();

    const quotaResult = await redis.acquireJobQuota(
      subjectKey,
      candidateJobId,
      maxConcurrent,
      maxDaily
    );

    if (!quotaResult.success) {
      if (quotaResult.code === 'CONCURRENT_LIMIT_REACHED') {
        throw MuxaroError.quotaExceeded(
          `Maximum concurrent active jobs limit (${maxConcurrent}) reached for ${userTier} tier. Please wait for running jobs to finish.`
        );
      }
      if (quotaResult.code === 'DAILY_QUOTA_REACHED') {
        throw MuxaroError.quotaExceeded(
          `Daily job limit (${maxDaily}) reached for ${userTier} tier. Allowance refreshes daily.`
        );
      }
      throw MuxaroError.quotaExceeded(`Quota limit reached for ${userTier} tier.`);
    }

    // 4. Idempotency Key check: if client sent an idempotency key and job exists, return it
    if (body.idempotencyKey) {
      const [existingJob] = await db
        .select()
        .from(mediaJobs)
        .where(eq(mediaJobs.idempotencyKey, body.idempotencyKey))
        .limit(1);

      if (existingJob) {
        // Release the newly acquired active quota slot for the duplicate replay
        await redis.releaseActiveJob(subjectKey, candidateJobId);

        request.log.info(
          { jobId: existingJob.id, idempotencyKey: body.idempotencyKey },
          '[Jobs] Returning existing job for idempotent replay'
        );
        const resp = formatJobResponse(existingJob);
        return reply.status(200).send({
          success: true,
          data: resp,
          ...resp,
        });
      }
    }

    // 5. Distributed Deduplication check via Redis
    const dedupHash = computeJobDedupHash({
      tool: body.tool,
      sourceUrl: body.sourceUrl,
      uploadSessionId: body.uploadSessionId,
      targetFormat: body.targetFormat,
      targetResolution: body.targetResolution,
      videoCodec: body.videoCodec,
      audioCodec: body.audioCodec,
      audioBitrate: body.audioBitrate,
    });

    const isLockAcquired = await redis.tryAcquireDedupLock(dedupHash, 600);
    if (!isLockAcquired) {
      // Another worker/request is actively running this exact conversion
      request.log.info(
        { dedupHash },
        '[Jobs] Concurrent duplicate media job detected via Redis dedup lock'
      );
    }

    // 6. Intelligent 4-Lane Routing:
    // - lane:batch for playlists & batch jobs
    // - lane:fast-io for zero-copy stream copy or Eco Mode remux
    // - lane:transcode for heavy video encoding
    let selectedLane: LaneType = 'transcode';

    if (body.lane) {
      selectedLane = body.lane;
    } else if (body.tool === 'batch_playlist') {
      selectedLane = 'batch';
    } else if (body.targetResolution && /^(?:4k|8k|2160p?|4320p?)/i.test(body.targetResolution)) {
      // 8K / 4K Rule: Always fast-io lossless zero-copy remux
      selectedLane = 'fast_io';
    } else if (body.ecoMode !== false) {
      // Check if input codecs natively fit target container for lossless remuxing (-c copy)
      const canRemux = canZeroCopyRemux(
        body.videoCodec,
        body.audioCodec,
        body.targetFormat
      );
      if (canRemux) {
        selectedLane = 'fast_io';
      } else if (
        body.tool === 'extract_audio' &&
        canZeroCopyRemux(undefined, body.audioCodec, body.targetFormat)
      ) {
        selectedLane = 'fast_io';
      } else {
        selectedLane = 'transcode';
      }
    } else if (
      body.tool === 'extract_audio' &&
      canZeroCopyRemux(undefined, body.audioCodec, body.targetFormat)
    ) {
      selectedLane = 'fast_io';
    } else {
      selectedLane = 'transcode';
    }

    // 7. Retention tier & Expiry calculation
    const retentionTier: RetentionTier = userTier === 'guest' ? '60m' : '24h';
    const retentionSeconds = RETENTION_SECONDS[retentionTier];
    const expiresAt = new Date(Date.now() + retentionSeconds * 1000);
    const priority = limits.priorityWeight;
    const jobId = candidateJobId;

    // 8. Mint Scoped Worker Ticket (Zero-Credential Pattern)
    const s3 = getS3Client();
    const storageConfig = getStorageConfig();
    const outputKey = `artifacts/${jobId}/output.${body.targetFormat}`;
    const contentType = body.targetFormat === 'mp3' ? 'audio/mpeg' : `video/${body.targetFormat}`;

    let scopedWorkerTicket: ScopedWorkerTicket | undefined;
    try {
      scopedWorkerTicket = await mintScopedWorkerTicket(s3, storageConfig.artifactsBucket, {
        jobId,
        inputKey: body.uploadSessionId ? `uploads/${body.uploadSessionId}/input` : undefined,
        outputKey,
        contentType,
        retention: retentionTier,
      });
    } catch (mintErr) {
      request.log.warn({ err: mintErr, jobId }, '[Jobs] Failed to mint scoped worker ticket');
    }

    // 9. Record Job in PostgreSQL Database
    const [insertedJob] = await db
      .insert(mediaJobs)
      .values({
        id: jobId,
        userId: request.user?.id || null,
        guestIpHash: request.user ? null : guestHash,
        guestSessionHash: request.user ? null : guestHash,
        tool: body.tool,
        status: 'queued',
        lane: selectedLane,
        priority,
        sourceUrl: body.sourceUrl || null,
        uploadSessionId: body.uploadSessionId || null,
        targetFormat: body.targetFormat,
        targetResolution: body.targetResolution || null,
        optionsJson: body,
        progressPercent: '0.00',
        stage: 'queued',
        stageMessage: 'Queued for processing',
        idempotencyKey: body.idempotencyKey,
        retentionTier,
        expiresAt,
      })
      .returning();

    // 10. Increment Daily Ledger Count
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      await db
        .insert(dailyUsageLedger)
        .values({
          subjectKey,
          userId: request.user?.id || null,
          usageDate: sql`${todayStr}::date`,
          tier: userTier,
          jobsCount: 1,
          bandwidthBytes: 0,
        })
        .onConflictDoUpdate({
          target: [dailyUsageLedger.subjectKey, dailyUsageLedger.usageDate],
          set: {
            jobsCount: sql`${dailyUsageLedger.jobsCount} + 1`,
            updatedAt: new Date(),
          },
        });
    } catch (ledgerErr) {
      request.log.warn({ err: ledgerErr }, '[Jobs] Failed to update daily usage ledger');
    }

    // 11. Dispatch Job to Designated BullMQ Queue with Scoped Worker Ticket
    let resolvedInputStorageKey: string | undefined;
    try {
      if (body.uploadSessionId) {
        const uploadCandidates = [
          path.resolve(process.cwd(), '.muxaro-uploads', body.uploadSessionId),
          path.resolve(process.cwd(), 'storage/uploads', body.uploadSessionId),
          path.resolve(os.tmpdir(), body.uploadSessionId),
        ];
        for (const dir of uploadCandidates) {
          if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);
            if (files.length > 0) {
              resolvedInputStorageKey = path.join(dir, files[0]);
              break;
            }
          }
        }
      }

      const bullmqJobData = {
        jobId,
        userId: request.user?.id || null,
        guestIpHash: request.user ? null : guestHash,
        guestSessionHash: request.user ? null : guestHash,
        subjectKey,
        tier: userTier,
        tool: body.tool,
        lane: selectedLane,
        sourceUrl: body.sourceUrl,
        uploadSessionId: body.uploadSessionId,
        inputStorageKey: resolvedInputStorageKey,
        targetFormat: body.targetFormat,
        targetResolution: body.targetResolution,
        videoCodec: body.videoCodec,
        audioCodec: body.audioCodec,
        audioBitrate: body.audioBitrate,
        audioOffsetMs: body.audioOffsetMs,
        secondaryAudioUrl: body.secondaryAudioUrl,
        secondaryAudioSessionId: body.secondaryAudioSessionId,
        normalizeAudio: body.normalizeAudio,
        ecoMode: body.ecoMode,
        retentionTier,
        expiresAt: expiresAt.toISOString(),
        outputStorageKey: outputKey,
        scopedTicket: scopedWorkerTicket,
        scopedJobUrls: scopedWorkerTicket,
      };

      // BullMQ priority: lower integer = higher priority
      // Pro: 1, Free: 5, Guest: 10
      const bullmqPriority = userTier === 'pro' ? 1 : userTier === 'free_account' ? 5 : 10;

      const queueTimeout = (qPromise: Promise<unknown>) =>
        Promise.race([
          qPromise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Queue add timeout')), 1000)
          ),
        ]);

      if (selectedLane === 'fast_io') {
        const q = getFastIoQueue();
        await queueTimeout(
          q.add('process_fast_io', bullmqJobData, {
            jobId,
            priority: bullmqPriority,
            removeOnComplete: 200,
          })
        );
      } else if (selectedLane === 'batch') {
        const q = getBatchQueue();
        await queueTimeout(
          q.add('process_batch', bullmqJobData, {
            jobId,
            priority: bullmqPriority,
            removeOnComplete: 100,
          })
        );
      } else {
        const q = getTranscodeQueue();
        await queueTimeout(
          q.add('process_transcode', bullmqJobData, {
            jobId,
            priority: bullmqPriority,
            removeOnComplete: 200,
          })
        );
      }
    } catch (queueErr) {
      request.log.warn({ err: queueErr, jobId }, '[Jobs] Failed to push job to BullMQ lane queue, activating in-process QueueService fallback');
      try {
        await queueService.enqueueJob(
          {
            jobId,
            operation:
              body.tool === 'extract_audio'
                ? 'EXTRACT_AUDIO'
                : body.tool === 'merge_av'
                ? 'MERGE_AUDIO_VIDEO'
                : 'TRANSCODE_VIDEO',
            sourceUrl: body.sourceUrl,
            mediaUrl: body.sourceUrl,
            localFilePath: resolvedInputStorageKey,
            targetFormat: body.targetFormat,
            targetResolution: body.targetResolution,
            formatId: (body as { formatId?: string }).formatId,
            idempotencyKey: body.idempotencyKey,
            ownerTier: userTier === 'pro' ? 'PREMIUM' : userTier === 'free_account' ? 'REGISTERED' : 'GUEST',
          },
          request.user?.id || `guest:${guestHash}`
        );
      } catch (fallbackErr) {
        request.log.error({ err: fallbackErr, jobId }, '[Jobs] In-process fallback execution failed');
      }
    }

    const responseData = formatJobResponse(insertedJob);

    // Persist unified live state into Redis so all processes and clients share immediate updates
    await redis.setJobState(
      jobId,
      {
        ...insertedJob,
        ...responseData,
        subjectKey,
        guestIpHash: guestHash,
        userId: request.user?.id || null,
      },
      retentionSeconds
    );

    return reply.status(202).send({
      success: true,
      data: responseData,
      ...responseData,
    });
  });

  // ===========================================================================
  // 1b. ALL /jobs/tunnel - Dedicated stream tunnel with Content-Disposition headers
  // ===========================================================================
  fastify.all('/jobs/tunnel', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.query || {}) as Record<string, any>;
    const body = (request.body && typeof request.body === 'object') ? (request.body as Record<string, any>) : {};
    const targetUrl = String(query.url || body.url || '').trim();
    const candidateName = String(query.fn || query.filename || body.filename || `media_${Date.now()}.mp4`).trim();
    const targetFormat = String(query.format || body.format || 'mp4').toLowerCase().replace(/^\./, '');

    if (!targetUrl) {
      return reply.code(400).send({
        success: false,
        error: {
          code: 'ERR_MISSING_URL',
          message: 'The "url" query parameter or body field is required',
        },
      });
    }

    const safeFilename = candidateName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const contentType = targetFormat === 'mp3' ? 'audio/mpeg' : targetFormat === 'webm' ? 'video/webm' : `video/${targetFormat}`;

    // Direct CDN / Tunnel stream URL
    if (/\.(mp4|webm|mkv|mp3|m4a|wav)(\?|$)/i.test(targetUrl) || targetUrl.includes('stream') || targetUrl.includes('tunnel')) {
      try {
        await pipeRemoteStreamToReply(targetUrl, reply, safeFilename, contentType);
        return;
      } catch (err: any) {
        request.log.warn({ err }, '[Jobs Tunnel] Direct pipe failed, trying extraction');
      }
    }

    // Try Cobalt resolver first
    const cobalt = await resolveCobaltStream(targetUrl, { format: targetFormat });
    if (cobalt?.streamUrl) {
      try {
        await pipeRemoteStreamToReply(cobalt.streamUrl, reply, cobalt.filename || safeFilename, contentType);
        return;
      } catch (err: any) {
        request.log.warn({ err }, '[Jobs Tunnel] Cobalt pipe failed, falling back to yt-dlp');
      }
    }

    // Fallback to yt-dlp stdout pipe
    const cleanEncoded = encodeURIComponent(safeFilename);
    reply.raw.writeHead(200, {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${safeFilename}"; filename*=UTF-8''${cleanEncoded}`,
      'Transfer-Encoding': 'chunked',
      'Connection': 'keep-alive',
    });

    const isYouTube = /youtu\.?be/i.test(targetUrl);
    const ytdlpArgs = [
      '--no-warnings',
      '--no-playlist',
      '--js-runtimes', 'deno,node',
      ...(isYouTube ? ['--extractor-args', 'youtube:player_client=ios,android,tv,mweb,web', '--force-ipv4'] : []),
      '-f', targetFormat === 'mp3' ? 'bestaudio/best' : 'best[ext=mp4]/bestvideo+bestaudio/best',
      '-o', '-',
      '--',
      targetUrl,
    ];

    const env = { ...process.env };
    const customPaths = [
      'C:\\Users\\sbhrn\\.deno\\bin',
      'C:\\Users\\sbhrn\\AppData\\Local\\Programs\\Python\\Python312\\Scripts',
      'C:\\Users\\sbhrn\\AppData\\Local\\Programs\\Python\\Python312',
      path.join(os.homedir(), '.deno', 'bin'),
    ];
    env.PATH = `${customPaths.join(';')};${env.PATH || ''}`;
    env.Path = env.PATH;

    const child = spawn('yt-dlp', ytdlpArgs, {
      shell: false,
      windowsHide: true,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.pipe(reply.raw);

    request.raw.on('close', () => {
      try {
        if (child.pid) {
          spawn('taskkill', ['/pid', child.pid.toString(), '/T', '/F'], { shell: false, windowsHide: true });
        }
      } catch {}
    });
  });

  // ===========================================================================
  // 2. GET /v1/jobs/:id (Enforces strict tenant isolation via SQL WHERE condition)
  // ===========================================================================
  fastify.get('/jobs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    // 1. Read Redis live state first (synchronizes across worker-media & API processes)
    const redisState = await redis.getJobState(id);

    // 2. Query database for persistent record
    const [dbJob] = await db
      .select()
      .from(mediaJobs)
      .where(eq(mediaJobs.id, id))
      .limit(1);

    const inProcessJob = !dbJob && !redisState ? queueService.getJob(id) : undefined;

    if (!dbJob && !redisState && !inProcessJob) {
      throw MuxaroError.notFound(`Job ${id} not found`);
    }

    let job: any;
    if (inProcessJob) {
      job = {
        id: inProcessJob.jobId,
        tool: inProcessJob.operation === 'EXTRACT_AUDIO' ? 'extract_audio' : 'convert_video',
        status: inProcessJob.status.toLowerCase(),
        lane: inProcessJob.processingLane || 'fast_io',
        priority: inProcessJob.priorityWeight,
        targetFormat: inProcessJob.targetFormat,
        targetResolution: inProcessJob.targetResolution,
        progressPercent: String(inProcessJob.progress || 0),
        stage: inProcessJob.stage,
        stageMessage: inProcessJob.stageMessage,
        downloadUrl: inProcessJob.downloadUrl,
        expiresAt: inProcessJob.expiresAt || new Date(Date.now() + 3600 * 1000).toISOString(),
        createdAt: inProcessJob.createdAt,
        updatedAt: inProcessJob.updatedAt,
      };
    } else {
      job = { ...(dbJob || {}), ...(redisState || {}) };
      assertJobOwnership(job as any, request);
    }

    const responseData = formatJobResponse(job as any);
    return reply.status(200).send({
      success: true,
      data: responseData,
      ...responseData,
    });
  });

  // ===========================================================================
  // 2b. GET /v1/jobs/:id/download (Direct redirect or stream to download artifact)
  // ===========================================================================
  fastify.get('/jobs/:id/download', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const redisState = await redis.getJobState(id);
    const [dbJob] = await db
      .select()
      .from(mediaJobs)
      .where(eq(mediaJobs.id, id))
      .limit(1);

    if (!dbJob && !redisState) {
      throw MuxaroError.notFound(`Job ${id} not found`);
    }

    const job = { ...(dbJob || {}), ...(redisState || {}) } as any;
    assertJobOwnership(job, request);

    if (job.downloadUrl) {
      return reply.status(302).redirect(job.downloadUrl);
    }

    if ((job.status !== 'completed' && String(job.status).toLowerCase() !== 'ready') || !job.outputStorageKey) {
      throw MuxaroError.notFound(`Download artifact for job ${id} is not ready or has expired`);
    }

    const cleanKey = job.outputStorageKey.replace(/^\/+/, '');
    const filename = job.outputFilename || 'media_artifact.mp4';
    const redirectUrl = request.url.startsWith('/api/v1')
      ? `/api/v1/downloads/file/${cleanKey}?fn=${encodeURIComponent(filename)}`
      : `/v1/downloads/file/${cleanKey}?fn=${encodeURIComponent(filename)}`;
    return reply.status(302).redirect(redirectUrl);
  });

  // ===========================================================================
  // 3. GET /v1/jobs/:id/events (Server-Sent Events streaming real-time progress)
  // ===========================================================================
  fastify.get('/jobs/:id/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const jobId = (request.params as any).id || (request.params as any).jobId;

    const redisState = await redis.getJobState(jobId);
    const [dbJob] = await db
      .select()
      .from(mediaJobs)
      .where(eq(mediaJobs.id, jobId))
      .limit(1);

    if (!dbJob && !redisState) {
      throw MuxaroError.notFound(`Job ${jobId} not found`);
    }

    const job = { ...(dbJob || {}), ...(redisState || {}) };
    assertJobOwnership(job as any, request);

    // Initialize Server-Sent Events headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': request.headers.origin || '*',
      'Access-Control-Allow-Credentials': 'true',
    });
    reply.raw.flushHeaders?.();

    const formattedJob = formatJobResponse(job as any);
    const initialProgress = Number.parseFloat(String(job.progressPercent || '0'));
    const initialRawStatus = String(job.status || 'queued').toLowerCase();
    const initialStatus = initialRawStatus === 'completed' ? 'ready' : initialRawStatus;

    // 1. Send initial state event from database/redis
    const initialEvent = {
      jobId: (job as any).id || jobId,
      status: initialStatus,
      stage: (job.stage as any) || (initialStatus === 'ready' ? 'ready' : 'queued'),
      percent: initialProgress,
      progress: initialProgress,
      progressPercent: initialProgress,
      speedMbps: (job as any).speedMbps || 0,
      etaSec: (job as any).etaSec || 0,
      downloadUrl: formattedJob.downloadUrl,
      fileName: formattedJob.filename || formattedJob.outputFilename,
      filename: formattedJob.filename || formattedJob.outputFilename,
      message: job.stageMessage || undefined,
      timestamp: new Date().toISOString(),
    };

    reply.raw.write(`event: progress\ndata: ${JSON.stringify(initialEvent)}\n\n`);

    // If job is already in a terminal state, close stream immediately with done event
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      reply.raw.write(`event: done\ndata: ${JSON.stringify(initialEvent)}\n\n`);
      reply.raw.end();
      return;
    }

    // 2. Subscribe to Redis Pub/Sub channel muxaro:events:job:{jobId}
    let unsubscribe: (() => Promise<void>) | null = null;
    let heartbeatTimer: NodeJS.Timeout | null = null;

    const cleanup = async () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (unsubscribe) {
        await unsubscribe();
        unsubscribe = null;
      }
    };

    request.raw.on('close', () => {
      cleanup().catch(() => {});
    });

    try {
      unsubscribe = await redis.subscribeJobEvents(job.id, (event: JobProgressEvent) => {
        if (!reply.raw.writableEnded) {
          const currentProgress = typeof event.progressPercent === 'number'
            ? event.progressPercent
            : typeof (event as any).progress === 'number'
            ? (event as any).progress
            : typeof (event as any).percent === 'number'
            ? (event as any).percent
            : 0;

          const rawStatus = String(event.status || 'processing').toLowerCase();
          const normalizedStatus = rawStatus === 'completed' ? 'ready' : rawStatus === 'failed' ? 'error' : rawStatus;

          const payload = {
            jobId: event.jobId || job.id,
            status: normalizedStatus,
            stage: (event.stage as any) || (normalizedStatus === 'ready' ? 'ready' : 'downloading'),
            percent: currentProgress,
            progress: currentProgress,
            progressPercent: currentProgress,
            speedMbps: (event as any).speedMbps ?? (typeof event.speed === 'string' ? parseFloat(event.speed) || 0 : 0),
            speed: event.speed,
            etaSec: (event as any).etaSec ?? event.etaSeconds ?? 0,
            etaSeconds: (event as any).etaSec ?? event.etaSeconds ?? 0,
            downloadUrl: (event as any).downloadUrl || (normalizedStatus === 'ready' ? `/v1/downloads/file/${job.outputStorageKey || `outputs/${job.id}.mp4`}` : undefined),
            fileName: (event as any).fileName || (event as any).filename || job.outputFilename,
            filename: (event as any).fileName || (event as any).filename || job.outputFilename,
            message: event.message,
            timestamp: event.timestamp || new Date().toISOString(),
          };

          reply.raw.write(`event: progress\ndata: ${JSON.stringify(payload)}\n\n`);

          if (
            normalizedStatus === 'ready' ||
            normalizedStatus === 'error' ||
            event.status === 'completed' ||
            event.status === 'failed' ||
            event.status === 'cancelled'
          ) {
            reply.raw.write(`event: done\ndata: ${JSON.stringify(payload)}\n\n`);
            reply.raw.end();
            cleanup().catch(() => {});
          }
        }
      });

      // Keep-alive heartbeat comment every 15 seconds
      heartbeatTimer = setInterval(() => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(': ping\n\n');
        }
      }, 15000);
    } catch (subErr) {
      request.log.error({ err: subErr, jobId: job.id }, '[Jobs] SSE Redis subscription failed');
      cleanup().catch(() => {});
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    }
  });

  // ===========================================================================
  // 4. POST /v1/jobs/:id/cancel
  // ===========================================================================
  fastify.post('/jobs/:id/cancel', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const [job] = await db
      .select()
      .from(mediaJobs)
      .where(eq(mediaJobs.id, id))
      .limit(1);

    if (!job) {
      throw MuxaroError.notFound(`Job ${id} not found`);
    }

    assertJobOwnership(job, request);

    if (job.status !== 'completed' && job.status !== 'failed' && job.status !== 'cancelled') {
      await db
        .update(mediaJobs)
        .set({
          status: 'cancelled',
          stage: 'aborted',
          stageMessage: 'Job cancelled by user',
          updatedAt: new Date(),
        })
        .where(eq(mediaJobs.id, id));

      // Release active quota slot in Redis
      try {
        const subject = job.userId ? `user:${job.userId}` : `guest:${job.guestSessionHash || job.guestIpHash}`;
        await redis.releaseActiveJob(subject, id);

        // Publish cancellation event to Redis channel
        await redis.publishJobEvent(id, {
          jobId: id,
          status: 'cancelled',
          stage: 'aborted',
          progressPercent: Number.parseFloat(String(job.progressPercent || '0')),
          message: 'Job cancelled by user',
          timestamp: new Date().toISOString(),
        });
      } catch (redisErr) {
        request.log.warn({ err: redisErr, jobId: id }, '[Jobs] Failed to release active quota or publish cancel event to Redis');
      }
    }

    const [updatedJob] = await db
      .select()
      .from(mediaJobs)
      .where(eq(mediaJobs.id, id))
      .limit(1);

    const responseData = formatJobResponse(updatedJob);
    const cancelPayload = {
      ...responseData,
      message: 'Job cancelled by user and active quota slot released',
    };
    return reply.status(200).send({
      success: true,
      data: cancelPayload,
      ...cancelPayload,
    });
  });

  // ===========================================================================
  // 5. POST /v1/jobs/:id/progress (Zero-Credential Worker HMAC Progress Webhook)
  // ===========================================================================
  fastify.post('/jobs/:id/progress', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const query = (request.query || {}) as { token?: string };
    const authHeader = request.headers.authorization;
    const bearerToken =
      typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')
        ? authHeader.slice(7).trim()
        : undefined;
    const progressToken =
      query.token ||
      (request.headers['x-progress-token'] as string) ||
      bearerToken;

    if (!verifyProgressToken(id, progressToken || '')) {
      throw MuxaroError.forbidden('Invalid or missing progress webhook token');
    }

    const body = (request.body || {}) as {
      progressPercent?: number | string;
      stage?: string;
      stageMessage?: string;
      status?: 'pending' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
      outputSizeBytes?: number;
      durationSeconds?: number;
      errorCode?: string;
      errorMessage?: string;
    };

    const [job] = await db
      .select()
      .from(mediaJobs)
      .where(eq(mediaJobs.id, id))
      .limit(1);

    if (!job) {
      throw MuxaroError.notFound(`Job ${id} not found`);
    }

    const updates: Partial<typeof mediaJobs.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (body.progressPercent !== undefined) {
      updates.progressPercent = String(body.progressPercent);
    }
    if (body.stage) {
      updates.stage = body.stage;
    }
    if (body.stageMessage) {
      updates.stageMessage = body.stageMessage;
    }
    if (body.status) {
      updates.status = body.status;
      if (body.status === 'completed' || body.status === 'failed' || body.status === 'cancelled') {
        updates.completedAt = new Date();
        const subject = job.userId ? `user:${job.userId}` : `guest:${job.guestSessionHash || job.guestIpHash}`;
        await redis.releaseActiveJob(subject, id);
      }
    }
    if (body.outputSizeBytes !== undefined) {
      updates.outputSizeBytes = body.outputSizeBytes;
    }
    if (body.durationSeconds !== undefined) {
      updates.durationSeconds = String(body.durationSeconds);
    }
    if (body.errorCode) {
      updates.errorCode = body.errorCode;
    }
    if (body.errorMessage) {
      updates.errorMessage = body.errorMessage;
    }

    await db.update(mediaJobs).set(updates).where(eq(mediaJobs.id, id));

    // Publish SSE progress to Redis channel
    await redis.publishJobEvent(id, {
      jobId: id,
      status: (body.status || job.status) as any,
      stage: (body.stage || job.stage) as any,
      progressPercent: Number.parseFloat(String(body.progressPercent ?? job.progressPercent ?? '0')),
      message: body.stageMessage || job.stageMessage || undefined,
      timestamp: new Date().toISOString(),
    });

    return reply.status(200).send({
      success: true,
      jobId: id,
      stage: body.stage || job.stage,
      status: body.status || job.status,
    });
  });
};

export const jobRoutes = jobsRoutes;

