/**
 * Project MUXARO - Real Playlist Inspection & Packaging Routes
 * POST /api/v1/playlists/inspect
 * POST /api/v1/playlists/jobs
 * GET  /api/v1/playlists/jobs/:id
 */

import type { FastifyPluginAsync } from 'fastify';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { entitlementsService } from '../services/entitlements.service.js';
import {
  queueService,
  ARTIFACTS_ROOT,
  getMimeTypeForExtension,
} from '../services/queue.service.js';
import { tokenService } from '../services/token.service.js';
import { generateBatchId } from '../services/id.service.js';
import { resolveCallerIdentity, isOwnerOrAdmin } from '../services/request-identity.js';
import {
  DEFAULT_RETENTION_MINUTES,
  mapHumanFriendlyError,
  parseResolutionHeight,
} from '../services/turboflow.service.js';
import {
  validateUrlForSsrf,
  sanitizeFilename,
  RateLimiter,
} from '@vyro/security';
import type { PlaylistInspectItem, PlaylistJobItemStatus, PlaylistJobRecord } from '../types/index.js';

const execFileAsync = promisify(execFile);
const rateLimiter = new RateLimiter();
const playlistJobs = new Map<string, PlaylistJobRecord>();
const playlistWaitingQueue: Array<() => Promise<void>> = [];

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function computeFileCrc32(filePath: string): Promise<{ crc: number; size: number }> {
  return new Promise((resolve, reject) => {
    let crc = 0xffffffff;
    let size = 0;
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk: string | Buffer) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += buf.length;
      for (let i = 0; i < buf.length; i++) {
        crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
      }
    });
    stream.on('error', reject);
    stream.on('end', () => resolve({ crc: (crc ^ 0xffffffff) >>> 0, size }));
  });
}

/**
 * Pure-Node streaming ZIP (Store method, zero-shell, zero-dependency, low RAM).
 * Ideal for already-compressed media files (MP4/MP3/M4A/Opus).
 */
async function createStreamingZipArchive(
  files: Array<{ filePath: string; entryName: string }>,
  zipOutputPath: string
): Promise<{ sizeBytes: number; sha256: string }> {
  const out = fs.createWriteStream(zipOutputPath);
  const sha = crypto.createHash('sha256');
  let offset = 0;

  const writeBuf = async (buf: Buffer): Promise<void> => {
    sha.update(buf);
    offset += buf.length;
    if (!out.write(buf)) {
      await new Promise<void>((resolve) => out.once('drain', resolve));
    }
  };

  const centralEntries: Buffer[] = [];

  for (const item of files) {
    const { crc, size } = await computeFileCrc32(item.filePath);
    const nameBuf = Buffer.from(item.entryName, 'utf8');
    const localHeaderOffset = offset;

    // Local File Header (30 bytes + name)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
    localHeader.writeUInt16LE(0, 8); // method: 0 (STORE)
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(size, 18);
    localHeader.writeUInt32LE(size, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra len
    await writeBuf(localHeader);
    await writeBuf(nameBuf);

    // Stream file payload without loading into RAM
    await new Promise<void>((resolve, reject) => {
      const rs = fs.createReadStream(item.filePath);
      rs.on('data', (chunk: string | Buffer) => {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        sha.update(buf);
        offset += buf.length;
        if (!out.write(buf)) {
          rs.pause();
          out.once('drain', () => rs.resume());
        }
      });
      rs.on('error', reject);
      rs.on('end', resolve);
    });

    // Central Directory Entry (46 bytes + name)
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0); // signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8); // UTF-8 flag
    central.writeUInt16LE(0, 10); // STORE
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localHeaderOffset, 42);
    nameBuf.copy(central, 46);
    centralEntries.push(central);
  }

  const centralDirOffset = offset;
  for (const entry of centralEntries) {
    await writeBuf(entry);
  }
  const centralDirSize = offset - centralDirOffset;

  // End of Central Directory Record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centralEntries.length, 8);
  eocd.writeUInt16LE(centralEntries.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);
  await writeBuf(eocd);

  await new Promise<void>((resolve, reject) => {
    out.once('error', reject);
    out.end(() => resolve());
  });

  return { sizeBytes: offset, sha256: sha.digest('hex') };
}

async function inspectPlaylistWithYtDlp(
  url: string,
  maxItems: number
): Promise<{ title: string; items: PlaylistInspectItem[] }> {
  const capped = Math.max(1, Math.min(50, maxItems));
  const { stdout } = await execFileAsync(
    'yt-dlp',
    [
      '--flat-playlist',
      '--dump-single-json',
      '--no-warnings',
      '--playlist-end',
      String(capped),
      url,
    ],
    {
      timeout: 25000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    }
  );

  const info = JSON.parse(stdout.trim()) as {
    title?: string;
    webpage_url?: string;
    duration?: number;
    entries?: Array<{
      id?: string;
      title?: string;
      url?: string;
      webpage_url?: string;
      duration?: number;
    }>;
  };

  const title = info.title || 'Media Playlist';
  const rawEntries = Array.isArray(info.entries) ? info.entries.filter(Boolean) : [];

  const items: PlaylistInspectItem[] = [];
  if (rawEntries.length > 0) {
    for (let i = 0; i < Math.min(rawEntries.length, capped); i++) {
      const entry = rawEntries[i];
      let itemUrl = entry.webpage_url || entry.url || '';
      if (itemUrl && !itemUrl.startsWith('http://') && !itemUrl.startsWith('https://')) {
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
          itemUrl = `https://www.youtube.com/watch?v=${itemUrl}`;
        }
      }
      if (!itemUrl) continue;
      items.push({
        position: items.length + 1,
        title: entry.title || `Item ${items.length + 1}`,
        url: itemUrl,
        durationSeconds:
          typeof entry.duration === 'number' && Number.isFinite(entry.duration) && entry.duration > 0
            ? Math.round(entry.duration)
            : undefined,
      });
    }
  } else if (info.title) {
    items.push({
      position: 1,
      title: info.title,
      url: info.webpage_url || url,
      durationSeconds:
        typeof info.duration === 'number' && Number.isFinite(info.duration) && info.duration > 0
          ? Math.round(info.duration)
          : undefined,
    });
  }

  return { title, items };
}

function runYtDlpSingleItem(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, 3 * 60 * 1000);

    proc.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 32 * 1024) stderr += chunk.toString('utf8');
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim().split(/\r?\n/).slice(-2).join(' | ') || `yt-dlp exit ${code}`));
        return;
      }
      resolve();
    });
  });
}

function pumpPlaylistQueue(): void {
  while (playlistWaitingQueue.length > 0 && queueService.canAcquirePlaylistSlot()) {
    const runner = playlistWaitingQueue.shift();
    if (!runner) break;
    queueService.setPlaylistSlotActive(1);
    runner().finally(() => {
      queueService.setPlaylistSlotActive(-1);
      setImmediate(() => pumpPlaylistQueue());
    });
  }
}

function toPublicPlaylistJob(job: PlaylistJobRecord) {
  const { zipFilePath: _internalPath, ...pub } = job;
  return pub;
}

export const playlistRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/v1/playlists/inspect
  fastify.post('/playlists/inspect', {
    preHandler: rateLimiter.createFastifyHook('inspect'),
    schema: {
      description: 'Discover and inspect real child items in a media playlist (capped at 50 items)',
      tags: ['Playlist Processing'],
      body: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string' },
          maxItems: { type: 'integer', default: 50, minimum: 1, maximum: 50 },
        },
      },
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const { url, maxItems = 50 } = request.body as { url: string; maxItems?: number };

    const ssrf = await validateUrlForSsrf(url);
    if (!ssrf.isSafe) {
      const code = 'SSRF_BLOCKED';
      return reply.code(403).send({
        success: false,
        error: {
          code,
          message: ssrf.error || 'Target URL blocked by security policy',
          userMessage: mapHumanFriendlyError(code),
        },
        requestId,
      });
    }

    try {
      const { title, items } = await inspectPlaylistWithYtDlp(url, maxItems);
      if (items.length === 0) {
        const code = 'ERR_INSPECTION_FAILED';
        return reply.code(422).send({
          success: false,
          error: {
            code,
            message: 'No playable playlist items found at this URL',
            userMessage: 'We could not find any public items in that playlist link.',
          },
          requestId,
        });
      }

      return reply.code(200).send({
        success: true,
        data: {
          title,
          sourceUrl: url,
          totalItems: items.length,
          items,
        },
        requestId,
      });
    } catch (err: any) {
      const code = 'ERR_INSPECTION_FAILED';
      return reply.code(422).send({
        success: false,
        error: {
          code,
          message: err.message || 'Failed to inspect playlist URL',
          userMessage: mapHumanFriendlyError(code, err.message),
        },
        requestId,
      });
    }
  });

  // POST /api/v1/playlists/jobs
  fastify.post('/playlists/jobs', {
    preHandler: rateLimiter.createFastifyHook('createJob'),
    schema: {
      description: 'Submit a real playlist batch processing job (packaged into a single verified ZIP)',
      tags: ['Playlist Processing'],
      body: {
        type: 'object',
        required: ['playlistUrl', 'targetFormat', 'idempotencyKey'],
        properties: {
          playlistUrl: { type: 'string' },
          targetFormat: { type: 'string', default: 'mp4' },
          targetResolution: { type: 'string', default: '1080p' },
          packageAsZip: { type: 'boolean', default: true },
          maxItems: { type: 'integer', default: 25, minimum: 1, maximum: 50 },
          idempotencyKey: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const body = request.body as {
      playlistUrl: string;
      targetFormat: string;
      targetResolution?: string;
      packageAsZip?: boolean;
      maxItems?: number;
      idempotencyKey: string;
    };

    const ssrf = await validateUrlForSsrf(body.playlistUrl);
    if (!ssrf.isSafe) {
      const code = 'SSRF_BLOCKED';
      return reply.code(403).send({
        success: false,
        error: {
          code,
          message: ssrf.error || 'Target URL blocked by security policy',
          userMessage: mapHumanFriendlyError(code),
        },
        requestId,
      });
    }

    const caller = await resolveCallerIdentity(request);

    const idempotencyKey =
      (request.headers['idempotency-key'] as string) || body.idempotencyKey || `idem_pl_${Date.now()}`;

    try {
      const result = await entitlementsService.executeIdempotent(
        idempotencyKey,
        caller.userId,
        body,
        async () => {
          const maxItems = Math.max(1, Math.min(50, body.maxItems ?? 25));

          let reservation;
          try {
            reservation = await entitlementsService.reserveQuota({
              userId: caller.userId,
              role: caller.entitlementRole,
              tier: caller.entitlementTier,
              jobType: 'PLAYLIST_DOWNLOAD',
              itemCount: maxItems,
              idempotencyKey,
            });
          } catch (quotaErr: any) {
            const err = new Error(
              quotaErr.message || 'Playlist job quota exceeded. Free allowance is 1 playlist job per rolling 24 hours.'
            );
            (err as any).statusCode = 409;
            (err as any).code = 'ERR_QUOTA_EXCEEDED';
            (err as any).details = quotaErr.details || null;
            throw err;
          }

          const playlistJobId = generateBatchId();
          const now = new Date().toISOString();

          const plJob: PlaylistJobRecord = {
            playlistJobId,
            ownerUserId: caller.userId,
            title: 'Playlist Processing',
            sourceUrl: body.playlistUrl,
            status: 'QUEUED',
            processingLane: 'power',
            queueClass: 'playlist-packaging',
            retentionMinutes: DEFAULT_RETENTION_MINUTES,
            totalItems: 0,
            completedItems: 0,
            failedItems: 0,
            cancelledItems: 0,
            progress: 0,
            items: [],
            zipDownloadUrl: null,
            error: null,
            reservationId: reservation.reservationId,
            idempotencyKey,
            createdAt: now,
            updatedAt: now,
          };

          playlistJobs.set(playlistJobId, plJob);

          // Schedule real execution inside playlist-packaging lane
          playlistWaitingQueue.push(async () => {
            const jobDir = path.join(ARTIFACTS_ROOT, `playlist_${playlistJobId}`);
            try {
              plJob.status = 'PROCESSING';
              plJob.updatedAt = new Date().toISOString();

              const inspected = await inspectPlaylistWithYtDlp(body.playlistUrl, maxItems);
              if (inspected.items.length === 0) {
                throw new Error('No playable items found in playlist');
              }

              plJob.title = inspected.title;
              plJob.totalItems = inspected.items.length;
              plJob.items = inspected.items.map<PlaylistJobItemStatus>((it) => ({
                position: it.position,
                title: it.title,
                url: it.url,
                status: 'QUEUED',
                downloadUrl: null,
                filename: null,
                sizeBytes: null,
                error: null,
              }));
              plJob.updatedAt = new Date().toISOString();

              await fsp.mkdir(jobDir, { recursive: true });
              const targetExt = (body.targetFormat || 'mp4').toLowerCase().trim().replace(/^\./, '');
              const isAudio = ['mp3', 'm4a', 'aac', 'flac', 'wav', 'opus'].includes(targetExt);
              const targetHeight = parseResolutionHeight(body.targetResolution);
              const zipEntries: Array<{ filePath: string; entryName: string }> = [];

              for (let i = 0; i < plJob.items.length; i++) {
                const item = plJob.items[i];
                item.status = 'PROCESSING';
                plJob.updatedAt = new Date().toISOString();

                try {
                  const itemSsrf = await validateUrlForSsrf(item.url);
                  if (!itemSsrf.isSafe) {
                    throw new Error('Item URL blocked by security policy');
                  }

                  const itemPrefix = `item_${String(item.position).padStart(2, '0')}`;
                  const outTpl = path.join(jobDir, `${itemPrefix}.%(ext)s`);
                  const args = isAudio
                    ? [
                        '--no-playlist',
                        '--no-warnings',
                        '-x',
                        '--audio-format',
                        targetExt,
                        '--audio-quality',
                        '0',
                        '-o',
                        outTpl,
                        item.url,
                      ]
                    : [
                        '--no-playlist',
                        '--no-warnings',
                        '-f',
                        targetHeight
                          ? `bestvideo[height<=${targetHeight}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${targetHeight}]+bestaudio/best[height<=${targetHeight}]/best`
                          : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best',
                        '--merge-output-format',
                        targetExt,
                        '-o',
                        outTpl,
                        item.url,
                      ];

                  await runYtDlpSingleItem(args);

                  const files = await fsp.readdir(jobDir);
                  const found = files.find(
                    (f) => f.startsWith(`${itemPrefix}.`) && !f.endsWith('.part') && !f.endsWith('.ytdl')
                  );
                  if (!found) {
                    throw new Error('Download produced no output file');
                  }

                  const fullPath = path.join(jobDir, found);
                  const stat = await fsp.stat(fullPath);
                  const actualExt = path.extname(found).toLowerCase().replace(/^\./, '') || targetExt;
                  const safeName = sanitizeFilename(
                    `${String(item.position).padStart(2, '0')}_${item.title}.${actualExt}`,
                    `${itemPrefix}.${actualExt}`
                  );

                  const itemArtifactId = crypto.randomUUID();
                  const expiresAt = new Date(Date.now() + DEFAULT_RETENTION_MINUTES * 60 * 1000).toISOString();
                  const itemToken = tokenService.generateDownloadToken({
                    jobId: playlistJobId,
                    artifactId: itemArtifactId,
                    filename: safeName,
                    userId: caller.userId,
                    ttlSeconds: DEFAULT_RETENTION_MINUTES * 60,
                  });
                  const itemDlUrl = `/api/v1/download/${itemToken}`;

                  queueService.registerStandaloneArtifact(playlistJobId, {
                    artifactId: itemArtifactId,
                    ownerUserId: caller.userId,
                    filePath: fullPath,
                    filename: safeName,
                    mimeType: getMimeTypeForExtension(actualExt),
                    sizeBytes: stat.size,
                    container: actualExt,
                    downloadUrl: itemDlUrl,
                    expiresAt,
                  });

                  zipEntries.push({ filePath: fullPath, entryName: safeName });
                  item.status = 'READY';
                  item.filename = safeName;
                  item.sizeBytes = stat.size;
                  item.downloadUrl = itemDlUrl;
                  plJob.completedItems++;
                } catch (itemErr: any) {
                  item.status = 'FAILED';
                  item.error = mapHumanFriendlyError('ERR_PROCESSING_FAILED', itemErr?.message);
                  plJob.failedItems++;
                }

                plJob.progress = Math.round(
                  ((plJob.completedItems + plJob.failedItems) / Math.max(1, plJob.totalItems)) * 90
                );
                plJob.updatedAt = new Date().toISOString();
              }

              if (plJob.completedItems === 0) {
                throw new Error('All items in this playlist failed to process');
              }

              // Package completed items into a single verified ZIP archive
              if (body.packageAsZip !== false && zipEntries.length > 0) {
                plJob.status = 'PACKAGING';
                plJob.progress = 95;
                plJob.updatedAt = new Date().toISOString();

                const zipName = sanitizeFilename(`${plJob.title}_playlist.zip`, `muxaro_playlist_${playlistJobId.slice(0, 8)}.zip`);
                const zipPath = path.join(jobDir, 'playlist.zip');
                const { sizeBytes, sha256 } = await createStreamingZipArchive(zipEntries, zipPath);

                const zipArtifactId = crypto.randomUUID();
                const expiresAt = new Date(Date.now() + DEFAULT_RETENTION_MINUTES * 60 * 1000).toISOString();
                const zipToken = tokenService.generateDownloadToken({
                  jobId: playlistJobId,
                  artifactId: zipArtifactId,
                  filename: zipName,
                  userId: caller.userId,
                  ttlSeconds: DEFAULT_RETENTION_MINUTES * 60,
                });
                const zipDownloadUrl = `/api/v1/download/${zipToken}`;

                queueService.registerStandaloneArtifact(
                  playlistJobId,
                  {
                    artifactId: zipArtifactId,
                    ownerUserId: caller.userId,
                    filePath: zipPath,
                    filename: zipName,
                    mimeType: 'application/zip',
                    sizeBytes,
                    container: 'zip',
                    checksumSha256: sha256,
                    downloadUrl: zipDownloadUrl,
                    expiresAt,
                  },
                  jobDir
                );

                plJob.zipFilePath = zipPath;
                plJob.zipFilename = zipName;
                plJob.zipSizeBytes = sizeBytes;
                plJob.zipDownloadUrl = zipDownloadUrl;
                plJob.expiresAt = expiresAt;
              }

              plJob.status = plJob.failedItems > 0 ? 'PARTIAL_FAILURE' : 'COMPLETED';
              plJob.progress = 100;
              plJob.updatedAt = new Date().toISOString();

              if (reservation.reservationId) {
                await entitlementsService.commitQuota(reservation.reservationId).catch(() => {});
              }
            } catch (err: any) {
              await fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
              plJob.status = 'FAILED';
              plJob.error = mapHumanFriendlyError('ERR_PROCESSING_FAILED', err?.message);
              plJob.updatedAt = new Date().toISOString();
              if (reservation.reservationId) {
                await entitlementsService.rollbackQuota(reservation.reservationId, 'Playlist job failed').catch(() => {});
              }
            }
          });

          setImmediate(() => pumpPlaylistQueue());

          return toPublicPlaylistJob(plJob);
        }
      );

      return reply.code(202).send({
        success: true,
        data: result,
        requestId,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 400;
      const code = err.code || 'ERR_PLAYLIST_JOB_FAILED';
      return reply.code(statusCode).send({
        success: false,
        error: {
          code,
          message: err.message || 'Failed to submit playlist job',
          userMessage: mapHumanFriendlyError(code, err.message),
          details: err.details || null,
        },
        requestId,
      });
    }
  });

  // GET /api/v1/playlists/jobs/:id
  fastify.get('/playlists/jobs/:id', {
    schema: {
      description: 'Get live status, item breakdown, and verified ZIP link for a playlist job',
      tags: ['Playlist Processing'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const { id } = request.params as { id: string };

    const job = playlistJobs.get(id);
    if (!job) {
      const code = 'ERR_PLAYLIST_JOB_NOT_FOUND';
      return reply.code(404).send({
        success: false,
        error: {
          code,
          message: `Playlist job ${id} not found`,
          userMessage: mapHumanFriendlyError(code),
        },
        requestId,
      });
    }

    const caller = await resolveCallerIdentity(request);
    if (
      !isOwnerOrAdmin(caller, job.ownerUserId, {
        endpoint: `/api/v1/playlists/jobs/${id}`,
        resourceType: 'playlist_job',
        resourceId: id,
        requestId,
      })
    ) {
      return reply.code(403).send({
        success: false,
        error: {
          code: 'ERR_FORBIDDEN',
          message: 'Access denied to this playlist job',
          userMessage: 'You do not have permission to view this playlist job.',
        },
        requestId,
      });
    }

    return reply.code(200).send({
      success: true,
      data: toPublicPlaylistJob(job),
      requestId,
    });
  });
};
