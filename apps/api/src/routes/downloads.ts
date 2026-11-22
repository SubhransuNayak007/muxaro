/**
 * MUXARO Media Processing Platform - Downloads & Cloud History Routes
 *
 * Implements:
 * 1. GET /v1/downloads - Active non-expired cloud artifact history with remaining TTL
 *    and HMAC-SHA256 signed presigned URLs.
 * 2. DELETE /v1/downloads/:id - Instant R2 DeleteObjectCommand and DB mark expired.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import {
  MuxaroError,
  type DownloadItem,
  type RetentionTier,
} from '@muxaro/shared';
import { getDb, mediaJobs, type MediaJob, eq, and, gt, desc, sql, isNotNull } from '@muxaro/db';
import { getStorageConfig, deleteObject, generateSignedDownloadUrl, getS3Client } from '../lib/s3.js';
import crypto from 'node:crypto';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

function getGuestIpHash(req: FastifyRequest): string {
  if (req.guestIpHash) return req.guestIpHash;
  const clientIp = req.ip || '127.0.0.1';
  return crypto.createHash('sha256').update(clientIp).digest('hex');
}

export function buildDownloadOwnershipCondition(req: FastifyRequest) {
  const targetUserId = req.user?.id || null;
  const targetGuestHash = req.user ? null : getGuestIpHash(req);

  return sql`((${mediaJobs.userId} IS NOT NULL AND ${mediaJobs.userId} = ${targetUserId}) OR (${mediaJobs.userId} IS NULL AND (${mediaJobs.guestSessionHash} = ${targetGuestHash} OR ${mediaJobs.guestIpHash} = ${targetGuestHash})))`;
}

function assertJobOwnership(job: MediaJob, req: FastifyRequest): void {
  if (req.user && job.userId) {
    if (job.userId !== req.user.id) {
      throw MuxaroError.notFound(`Download artifact for job ${job.id} not found`);
    }
    return;
  }

  const effectiveGuestHash = getGuestIpHash(req);
  const guestHash = job.guestSessionHash || job.guestIpHash;
  if (!req.user && guestHash) {
    if (guestHash !== effectiveGuestHash) {
      throw MuxaroError.notFound(`Download artifact for job ${job.id} not found`);
    }
    return;
  }

  if (req.user && guestHash === effectiveGuestHash) {
    return;
  }

  if (!job.userId && !req.user) {
    return;
  }

  throw MuxaroError.notFound(`Download artifact for job ${job.id} not found`);
}

export const downloadsRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();
  const storageConfig = getStorageConfig();

  fastify.addHook('preHandler', async (request: FastifyRequest) => {
    if (!request.guestIpHash) {
      const clientIp = request.ip || '127.0.0.1';
      request.guestIpHash = crypto.createHash('sha256').update(clientIp).digest('hex');
    }
  });

  // ===========================================================================
  // 1. GET /v1/downloads (Active cloud history with countdown TTLs)
  // ===========================================================================
  fastify.get('/downloads', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.query as Record<string, string>) || {};
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit || '50', 10)));
    const offset = Math.max(0, Number.parseInt(query.offset || '0', 10));

    const now = new Date();

    // Tenant isolation: query by authenticated userId or guest IP hash
    const ownerCondition = buildDownloadOwnershipCondition(request);

    const activeCondition = and(
      ownerCondition,
      eq(mediaJobs.status, 'completed'),
      isNotNull(mediaJobs.outputStorageKey),
      gt(mediaJobs.expiresAt, now)
    );

    // Fetch active completed jobs
    const activeJobs = await db
      .select()
      .from(mediaJobs)
      .where(activeCondition)
      .orderBy(desc(mediaJobs.createdAt))
      .limit(limit)
      .offset(offset);

    // Total count query
    const [countRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(mediaJobs)
      .where(activeCondition);

    const total = countRow?.total ?? 0;

    const downloads: DownloadItem[] = activeJobs.map((job) => {
      const expiresAtDate = new Date(job.expiresAt);
      const remainingSeconds = Math.max(
        0,
        Math.floor((expiresAtDate.getTime() - Date.now()) / 1000)
      );

      const filename = job.outputFilename || `muxaro_${job.id.substring(0, 8)}.${job.targetFormat}`;
      const downloadUrl = job.outputStorageKey
        ? generateSignedDownloadUrl(job.outputStorageKey, filename, remainingSeconds)
        : '';

      return {
        id: job.id,
        jobId: job.id,
        filename,
        sizeBytes: job.outputSizeBytes || 0,
        mimeType: job.outputMimeType || `video/${job.targetFormat}`,
        container: job.targetFormat,
        downloadUrl,
        retentionTier: job.retentionTier as RetentionTier,
        expiresAt: expiresAtDate.toISOString(),
        remainingSeconds,
        isExpired: remainingSeconds <= 0,
        createdAt: new Date(job.createdAt).toISOString(),
      };
    });

    const responseData = {
      downloads,
      total,
    };

    return reply.status(200).send({
      success: true,
      data: responseData,
      ...responseData,
    });
  });

  // ===========================================================================
  // 2. DELETE /v1/downloads/:id (Instant R2 DeleteObject & mark expired)
  // ===========================================================================
  fastify.delete('/downloads/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const [job] = await db
      .select()
      .from(mediaJobs)
      .where(and(eq(mediaJobs.id, id), buildDownloadOwnershipCondition(request)))
      .limit(1);

    if (!job) {
      throw MuxaroError.notFound(`Download artifact for job ${id} not found`);
    }

    assertJobOwnership(job, request);

    // If storage key exists, trigger instant R2 / S3 deletion
    if (job.outputStorageKey) {
      try {
        await deleteObject(storageConfig.artifactsBucket, job.outputStorageKey);
        request.log.info(
          { key: job.outputStorageKey, jobId: id },
          '[Downloads] Object deleted from storage bucket'
        );
      } catch (err) {
        request.log.warn(
          { err, key: job.outputStorageKey },
          '[Downloads] S3/R2 delete failed or object already removed'
        );
      }
    }

    // Mark database record expired and nullify storage reference
    await db
      .update(mediaJobs)
      .set({
        outputStorageKey: null,
        stage: 'aborted',
        stageMessage: 'Artifact deleted by user',
        expiresAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(mediaJobs.id, id));

    const responseData = {
      id,
      deleted: true,
    };

    return reply.status(200).send({
      success: true,
      data: responseData,
      ...responseData,
    });
  });

  // Alias POST /v1/downloads/:id/delete for client compatibility
  fastify.post('/downloads/:id/delete', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [job] = await db
      .select()
      .from(mediaJobs)
      .where(and(eq(mediaJobs.id, id), buildDownloadOwnershipCondition(request)))
      .limit(1);
    if (!job) throw MuxaroError.notFound(`Download artifact ${id} not found`);
    assertJobOwnership(job, request);

    if (job.outputStorageKey) {
      try {
        await deleteObject(storageConfig.artifactsBucket, job.outputStorageKey);
      } catch {}
    }

    await db
      .update(mediaJobs)
      .set({
        outputStorageKey: null,
        expiresAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(mediaJobs.id, id));

    return reply.status(200).send({
      success: true,
      data: { id, deleted: true },
      id,
      deleted: true,
    });
  });

  // ===========================================================================
  // 3. GET /v1/downloads/file/* (Direct streaming download with Byte-Range support)
  // ===========================================================================
  fastify.get('/downloads/file/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const rawKey = (request.params as any)['*'] as string;
    const cleanKey = decodeURIComponent(rawKey || '').replace(/^\/+/, '');
    const query = (request.query as Record<string, string>) || {};
    const requestedFilename = query.fn || path.basename(cleanKey) || 'download.mp4';

    // Strict Path Traversal Defense: Reject directory traversal sequences, null bytes, and path escalations
    if (!cleanKey || cleanKey.includes('..') || cleanKey.includes('\0') || /^[a-zA-Z]:/.test(cleanKey) || /^[\\/]/.test(cleanKey)) {
      throw MuxaroError.badRequest('Invalid or prohibited storage path');
    }

    // Candidate base directories for storage artifacts
    const candidateDirs = [
      path.resolve(process.cwd(), 'storage/artifacts'),
      path.resolve(process.cwd(), 'storage'),
      path.resolve(process.cwd(), '../worker-media/storage/artifacts'),
      path.resolve(process.cwd(), '../worker-media/storage'),
      path.resolve(process.cwd(), '../../apps/worker-media/storage/artifacts'),
      path.resolve(process.cwd(), '../../apps/worker-media/storage'),
      path.resolve('D:/yt doenlord/apps/worker-media/storage/artifacts'),
      path.resolve('D:/yt doenlord/apps/worker-media/storage'),
      path.resolve('D:/yt doenlord/storage/artifacts'),
      path.resolve('D:/yt doenlord/storage'),
    ];

    let resolvedDiskPath: string | null = null;
    for (const baseDir of candidateDirs) {
      const resolved = path.resolve(baseDir, cleanKey);
      const relative = path.relative(baseDir, resolved);
      const isContained = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
      if (isContained && fs.existsSync(resolved)) {
        resolvedDiskPath = resolved;
        break;
      }
    }

    const ext = path.extname(cleanKey).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.mkv': 'video/x-matroska',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.flac': 'audio/flac',
      '.aac': 'audio/aac',
      '.zip': 'application/zip',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    const isInline = query.inline === '1' || query.inline === 'true';
    const dispositionType = isInline ? 'inline' : 'attachment';

    if (resolvedDiskPath) {
      const stat = fs.statSync(resolvedDiskPath);
      const totalSize = stat.size;
      const range = request.headers.range;

      reply.header('Accept-Ranges', 'bytes');
      reply.header('Content-Type', contentType);
      reply.header('Content-Disposition', `${dispositionType}; filename="${encodeURIComponent(requestedFilename)}"`);

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

        if (start >= totalSize || end >= totalSize || start > end) {
          reply.header('Content-Range', `bytes */${totalSize}`);
          return reply.status(416).send('Requested range not satisfiable');
        }

        const chunksize = end - start + 1;
        reply.status(206);
        reply.header('Content-Range', `bytes ${start}-${end}/${totalSize}`);
        reply.header('Content-Length', chunksize);

        const stream = fs.createReadStream(resolvedDiskPath, { start, end });
        return reply.send(stream);
      } else {
        reply.status(200);
        reply.header('Content-Length', totalSize);
        const stream = fs.createReadStream(resolvedDiskPath);
        return reply.send(stream);
      }
    }

    // Fallback: try S3 GetObject
    try {
      const s3 = getS3Client();
      const s3Response = await s3.send(
        new GetObjectCommand({
          Bucket: storageConfig.artifactsBucket,
          Key: cleanKey,
          Range: request.headers.range,
        })
      );

      if (s3Response.ContentRange) {
        reply.status(206);
        reply.header('Content-Range', s3Response.ContentRange);
      } else {
        reply.status(200);
      }

      reply.header('Content-Type', s3Response.ContentType || contentType);
      reply.header('Content-Disposition', `${dispositionType}; filename="${encodeURIComponent(requestedFilename)}"`);
      reply.header('Accept-Ranges', 'bytes');
      if (s3Response.ContentLength) {
        reply.header('Content-Length', s3Response.ContentLength);
      }

      return reply.send(s3Response.Body as Readable);
    } catch {
      throw MuxaroError.notFound(`Media artifact "${cleanKey}" not found`);
    }
  });
};
