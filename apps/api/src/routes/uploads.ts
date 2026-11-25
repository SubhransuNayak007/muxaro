/**
 * MUXARO Media Processing Platform - Direct-to-R2 Multipart Upload Routes
 *
 * Implements:
 * 1. POST /v1/uploads/init - Initializes multipart upload with adaptive 16MB/32MB chunking
 *    and retention tagging (60m for guests, 24h for authenticated users).
 * 2. POST /v1/uploads/:id/parts - Generates presigned UploadPartCommand URLs.
 * 3. POST /v1/uploads/:id/complete - Validates ETags, finalizes multipart upload,
 *    verifies container magic bytes, and records session completion.
 * 4. DELETE /v1/uploads/:id/abort - Aborts multipart upload and frees cloud scratch space.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import {
  uploadInitRequestSchema,
  MuxaroError,
  RETENTION_SECONDS,
  type RetentionTier,
} from '@muxaro/shared';
import { getDb, uploadSessions, type UploadSession, eq } from '@muxaro/db';
import {
  getStorageConfig,
  initMultipartUpload,
  generatePresignedPartUrl,
  completeMultipartUpload,
  abortMultipartUpload,
  verifyMagicBytes,
} from '../lib/s3.js';

const LOCAL_UPLOADS_ROOT = path.resolve(process.cwd(), '.muxaro-uploads');

function sanitizeFilename(filename: string): string {
  return filename.replace(/[\r\n\t"]/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function sanitizeSessionId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function isR2OrS3Configured(): boolean {
  if (process.env.FORCE_LOCAL_UPLOADS === 'true') return false;
  return Boolean(
    process.env.R2_ACCOUNT_ID ||
    process.env.R2_ENDPOINT ||
    process.env.S3_ENDPOINT ||
    process.env.MINIO_ENDPOINT ||
    (process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY)
  );
}

function resolveRequestOriginAndPrefix(request: FastifyRequest): { origin: string; routePrefix: string } {
  const protoHeader = request.headers['x-forwarded-proto'];
  const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader || request.protocol || 'http')
    .split(',')[0]
    .trim();
  const hostHeader = request.headers['x-forwarded-host'] || request.headers.host || '127.0.0.1:4000';
  const host = (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader).split(',')[0].trim();
  const url = request.url || '';
  const routePrefix = url.startsWith('/api/v1') ? '/api/v1' : url.startsWith('/v1') ? '/v1' : '';
  return { origin: `${proto}://${host}`, routePrefix };
}

function verifyLocalMagicBytes(
  filePath: string,
  expectedFormat?: string | null
): { valid: boolean; detectedMime?: string; reason?: string } {
  try {
    const fd = fs.openSync(filePath, 'r');
    const bytes = Buffer.alloc(128);
    const bytesRead = fs.readSync(fd, bytes, 0, 128, 0);
    fs.closeSync(fd);
    const header = bytes.subarray(0, bytesRead);

    if (header.length < 4) {
      return { valid: false, reason: 'Uploaded file is too small (< 4 bytes)' };
    }

    const ftypStr = header.subarray(4, 12).toString('ascii');
    if (ftypStr.startsWith('ftyp')) {
      return { valid: true, detectedMime: 'video/mp4' };
    }
    if (header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3) {
      return { valid: true, detectedMime: expectedFormat === 'webm' ? 'video/webm' : 'video/x-matroska' };
    }
    if (
      (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) ||
      (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)
    ) {
      return { valid: true, detectedMime: 'audio/mpeg' };
    }
    if (
      header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 &&
      header[8] === 0x57 && header[9] === 0x41 && header[10] === 0x56 && header[11] === 0x45
    ) {
      return { valid: true, detectedMime: 'audio/wav' };
    }
    if (header[0] === 0x4f && header[1] === 0x67 && header[2] === 0x67 && header[3] === 0x53) {
      return { valid: true, detectedMime: 'audio/ogg' };
    }
    if (header[0] === 0x66 && header[1] === 0x4c && header[2] === 0x61 && header[3] === 0x43) {
      return { valid: true, detectedMime: 'audio/flac' };
    }
    if (
      header.toString('utf8', 0, Math.min(header.length, 32)).toLowerCase().includes('<html') ||
      header.toString('utf8', 0, Math.min(header.length, 32)).toLowerCase().includes('<?php')
    ) {
      return { valid: false, reason: 'Suspicious non-media content signature detected' };
    }
    return { valid: true, detectedMime: 'application/octet-stream' };
  } catch (err: any) {
    return { valid: false, reason: `Unable to read local file header: ${err?.message || 'unknown error'}` };
  }
}

/**
 * Validates that the active request identity owns the upload session
 */
function assertSessionOwnership(session: UploadSession, req: FastifyRequest): void {
  if (req.user && session.userId) {
    if (session.userId !== req.user.id) {
      throw MuxaroError.forbidden('You do not have access to this upload session');
    }
    return;
  }

  if (!req.user && session.guestIpHash) {
    if (session.guestIpHash !== req.guestIpHash) {
      throw MuxaroError.forbidden('You do not have access to this upload session');
    }
    return;
  }

  // If user signed in after creating upload as guest, allow claiming if IP matches
  if (req.user && session.guestIpHash === req.guestIpHash) {
    return;
  }

  throw MuxaroError.forbidden('Unauthorized access to upload session');
}

export const uploadsRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();
  const storageConfig = getStorageConfig();

  // ===========================================================================
  // 1. POST /v1/uploads/init
  // ===========================================================================
  fastify.post('/uploads/init', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = uploadInitRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw MuxaroError.invalidPayload('Invalid upload initialization payload', {
        errors: parseResult.error.format(),
      });
    }

    const { filename, sizeBytes, mimeType, tool, targetFormat } = parseResult.data;

    // Check maximum upload size for tier
    if (sizeBytes > request.tierLimits.maxUploadSizeBytes) {
      throw MuxaroError.fileTooLarge(sizeBytes, request.tierLimits.maxUploadSizeBytes);
    }

    // Adaptive chunk size calculation:
    // Files <= 512MB use 16MB chunks; files > 512MB use 32MB chunks
    const CHUNK_16MB = 16 * 1024 * 1024;
    const CHUNK_32MB = 32 * 1024 * 1024;
    const chunkSize = sizeBytes > 512 * 1024 * 1024 ? CHUNK_32MB : CHUNK_16MB;
    const totalChunks = Math.max(1, Math.ceil(sizeBytes / chunkSize));

    // Retention tier selection: 60m for guests, 24h for authenticated users
    const retentionTier: RetentionTier = request.tier === 'guest' ? '60m' : '24h';
    const retentionSeconds = RETENTION_SECONDS[retentionTier];
    const expiresAt = new Date(Date.now() + retentionSeconds * 1000);

    const uploadSessionId = crypto.randomUUID();
    const cleanFn = sanitizeFilename(filename);
    const storageKey = `uploads/${retentionTier}/${uploadSessionId}/${cleanFn}`;

    const useCloudStorage = isR2OrS3Configured();
    const r2UploadId = useCloudStorage
      ? await initMultipartUpload(
          storageConfig.uploadsBucket,
          storageKey,
          mimeType,
          {
            retentionTier,
            uploadSessionId,
            tool,
          }
        )
      : `upload_mock_${uploadSessionId}`;

    const isLocalMode = !useCloudStorage || r2UploadId.startsWith('upload_mock_');

    // Save session in database
    await db.insert(uploadSessions).values({
      id: uploadSessionId,
      userId: request.user?.id || null,
      guestIpHash: request.user ? null : request.guestIpHash,
      storageKey,
      filename: cleanFn,
      mimeType,
      sizeBytes,
      chunkSize,
      totalChunks,
      tool,
      targetFormat: targetFormat || null,
      status: 'initiated',
      partsJson: { r2UploadId, uploadMode: isLocalMode ? 'local' : 'r2', parts: [] },
      retentionTier,
      magicBytesVerified: false,
      expiresAt,
    });

    const responseData = {
      uploadSessionId,
      storageKey,
      chunkSize,
      totalChunks,
      retentionTier,
      uploadMode: isLocalMode ? 'local' : 'r2',
      expiresAt: expiresAt.toISOString(),
    };

    return reply.status(201).send({
      success: true,
      data: responseData,
      ...responseData,
    });
  });

  // ===========================================================================
  // 2. POST /v1/uploads/:id/parts
  // ===========================================================================
  fastify.post('/uploads/:id/parts', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = (request.body as Record<string, unknown>) || {};
    const partNumbersRaw = body.partNumbers;

    if (!Array.isArray(partNumbersRaw) || partNumbersRaw.length === 0) {
      throw MuxaroError.badRequest('partNumbers array is required');
    }

    const partNumbers = partNumbersRaw
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n > 0);

    if (partNumbers.length === 0) {
      throw MuxaroError.badRequest('partNumbers must contain positive integers');
    }

    const [session] = await db
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.id, id))
      .limit(1);

    if (!session) {
      throw MuxaroError.notFound(`Upload session ${id} not found`);
    }

    assertSessionOwnership(session, request);

    if (session.status === 'aborted' || session.status === 'expired') {
      throw MuxaroError.badRequest(`Cannot generate parts for ${session.status} upload session`);
    }

    const partsData = session.partsJson as { r2UploadId?: string } | null;
    const r2UploadId = partsData?.r2UploadId;
    if (!r2UploadId) {
      throw MuxaroError.badRequest('Upload session has no active multipart upload ID');
    }

    const useLocalFallback = !isR2OrS3Configured() || r2UploadId.startsWith('upload_mock_');
    const { origin, routePrefix } = resolveRequestOriginAndPrefix(request);

    // Generate presigned R2/S3 upload URLs, or local dev HTTP part endpoints when R2 is unconfigured
    const parts = await Promise.all(
      partNumbers.map(async (partNumber) => {
        const presignedUrl = useLocalFallback
          ? `${origin}${routePrefix}/uploads/${encodeURIComponent(id)}/part/${partNumber}`
          : await generatePresignedPartUrl(
              storageConfig.uploadsBucket,
              session.storageKey,
              r2UploadId,
              partNumber,
              3600
            );
        return {
          partNumber,
          presignedUrl,
        };
      })
    );

    // Update status to uploading if still initiated
    if (session.status === 'initiated') {
      await db
        .update(uploadSessions)
        .set({ status: 'uploading', updatedAt: new Date() })
        .where(eq(uploadSessions.id, id));
    }

    const responseData = {
      uploadSessionId: session.id,
      uploadMode: useLocalFallback ? 'local' : 'r2',
      parts,
    };

    return reply.status(200).send({
      success: true,
      data: responseData,
      ...responseData,
    });
  });

  // ===========================================================================
  // 2b. PUT/POST /v1/uploads/:id/part/:partNumber (Local dev multipart sink)
  // ===========================================================================
  fastify.register(async (partScope) => {
    partScope.addContentTypeParser('*', (_req, payload, done) => {
      done(null, payload);
    });

    const handleLocalPartUpload = async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, partNumber } = request.params as { id: string; partNumber: string };
      const partNum = Number.parseInt(partNumber, 10);
      if (!Number.isInteger(partNum) || partNum < 1) {
        throw MuxaroError.badRequest('partNumber must be a positive integer');
      }

      const [session] = await db
        .select()
        .from(uploadSessions)
        .where(eq(uploadSessions.id, id))
        .limit(1);

      if (!session) {
        throw MuxaroError.notFound(`Upload session ${id} not found`);
      }

      assertSessionOwnership(session, request);

      if (session.status === 'aborted' || session.status === 'expired' || session.status === 'completed') {
        throw MuxaroError.badRequest(`Cannot upload parts for ${session.status} upload session`);
      }

      const sessionDir = path.join(LOCAL_UPLOADS_ROOT, sanitizeSessionId(session.id));
      fs.mkdirSync(sessionDir, { recursive: true });
      const partPath = path.join(sessionDir, `part_${partNum}`);

      const rawPayload = request.body as Readable | Buffer | string | undefined;
      const hash = crypto.createHash('md5');
      let writtenBytes = 0;

      if (Buffer.isBuffer(rawPayload) || typeof rawPayload === 'string') {
        const buf = Buffer.isBuffer(rawPayload) ? rawPayload : Buffer.from(rawPayload);
        if (buf.length > request.tierLimits.maxUploadSizeBytes) {
          throw MuxaroError.fileTooLarge(buf.length, request.tierLimits.maxUploadSizeBytes);
        }
        hash.update(buf);
        fs.writeFileSync(partPath, buf);
        writtenBytes = buf.length;
      } else {
        const stream = rawPayload || request.raw;
        await new Promise<void>((resolve, reject) => {
          const out = fs.createWriteStream(partPath);
          stream.on('data', (chunk: string | Buffer) => {
            const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
            writtenBytes += buf.length;
            if (writtenBytes > request.tierLimits.maxUploadSizeBytes) {
              stream.destroy();
              out.destroy();
              try { fs.unlinkSync(partPath); } catch {}
              reject(MuxaroError.fileTooLarge(writtenBytes, request.tierLimits.maxUploadSizeBytes));
              return;
            }
            hash.update(buf);
          });
          stream.on('error', reject);
          out.on('error', reject);
          out.on('finish', resolve);
          stream.pipe(out);
        });
      }

      const etag = `"${hash.digest('hex')}"`;
      reply.header('ETag', etag);

      const responseData = {
        uploadSessionId: session.id,
        partNumber: partNum,
        etag,
        sizeBytes: writtenBytes,
      };
      return reply.status(200).send({
        success: true,
        data: responseData,
        ...responseData,
      });
    };

    partScope.put('/uploads/:id/part/:partNumber', handleLocalPartUpload);
    partScope.post('/uploads/:id/part/:partNumber', handleLocalPartUpload);
    partScope.put('/uploads/:id/parts/:partNumber', handleLocalPartUpload);
    partScope.post('/uploads/:id/parts/:partNumber', handleLocalPartUpload);
  });

  // ===========================================================================
  // 3. POST /v1/uploads/:id/complete
  // ===========================================================================
  fastify.post('/uploads/:id/complete', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      parts?: Array<{ partNumber: number; etag: string }>;
    };

    if (!body || !Array.isArray(body.parts) || body.parts.length === 0) {
      throw MuxaroError.badRequest('Complete payload must contain non-empty parts array');
    }

    const [session] = await db
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.id, id))
      .limit(1);

    if (!session) {
      throw MuxaroError.notFound(`Upload session ${id} not found`);
    }

    assertSessionOwnership(session, request);

    // Idempotent completion check
    if (session.status === 'completed') {
      const responseData = {
        uploadSessionId: session.id,
        storageKey: session.storageKey,
        sizeBytes: session.sizeBytes,
        verified: session.magicBytesVerified,
        mimeType: session.mimeType,
      };
      return reply.status(200).send({
        success: true,
        data: responseData,
        ...responseData,
      });
    }

    const partsData = session.partsJson as { r2UploadId?: string } | null;
    const r2UploadId = partsData?.r2UploadId;
    if (!r2UploadId) {
      throw MuxaroError.badRequest('Upload session has no multipart upload ID');
    }

    const useLocalFallback = !isR2OrS3Configured() || r2UploadId.startsWith('upload_mock_');
    const sessionDir = path.join(LOCAL_UPLOADS_ROOT, sanitizeSessionId(session.id));
    const hasLocalParts =
      useLocalFallback &&
      fs.existsSync(sessionDir) &&
      fs.readdirSync(sessionDir).some((f) => f.startsWith('part_'));

    let magicCheck: { valid: boolean; detectedMime?: string; reason?: string };

    if (hasLocalParts) {
      const sortedParts = [...body.parts].sort((a, b) => a.partNumber - b.partNumber);
      const assembledPath = path.join(sessionDir, sanitizeFilename(session.filename));
      const out = fs.createWriteStream(assembledPath);

      try {
        for (const p of sortedParts) {
          const partPath = path.join(sessionDir, `part_${p.partNumber}`);
          if (!fs.existsSync(partPath)) {
            throw MuxaroError.badRequest(`Missing uploaded part ${p.partNumber}`);
          }
          await new Promise<void>((resolve, reject) => {
            const rs = fs.createReadStream(partPath);
            rs.on('error', reject);
            rs.on('end', resolve);
            rs.pipe(out, { end: false });
          });
        }
        await new Promise<void>((resolve, reject) => {
          out.once('error', reject);
          out.end(() => resolve());
        });
      } catch (err) {
        out.destroy();
        if (err instanceof MuxaroError) throw err;
        throw MuxaroError.internal('Failed to assemble local multipart upload', { error: String(err) });
      }

      for (const p of sortedParts) {
        try {
          fs.unlinkSync(path.join(sessionDir, `part_${p.partNumber}`));
        } catch {}
      }

      magicCheck = verifyLocalMagicBytes(assembledPath, session.targetFormat);
    } else {
      // Finalize multipart upload on S3 / R2 (or mock S3 client in tests)
      try {
        await completeMultipartUpload(
          storageConfig.uploadsBucket,
          session.storageKey,
          r2UploadId,
          body.parts
        );
      } catch (err) {
        request.log.error({ err, uploadId: id }, '[Uploads] CompleteMultipartUpload failed');
        throw MuxaroError.internal('Failed to finalize multipart upload with storage provider', {
          error: String(err),
        });
      }

      // Inspect first bytes to verify media container magic bytes
      magicCheck = await verifyMagicBytes(
        storageConfig.uploadsBucket,
        session.storageKey,
        session.targetFormat || undefined
      );
    }

    // Update database record to completed
    await db
      .update(uploadSessions)
      .set({
        status: 'completed',
        magicBytesVerified: magicCheck.valid,
        partsJson: {
          r2UploadId,
          completedParts: body.parts,
          verifiedMime: magicCheck.detectedMime,
        },
        updatedAt: new Date(),
      })
      .where(eq(uploadSessions.id, id));

    const responseData = {
      uploadSessionId: session.id,
      storageKey: session.storageKey,
      sizeBytes: session.sizeBytes,
      verified: magicCheck.valid,
      mimeType: session.mimeType,
    };

    return reply.status(200).send({
      success: true,
      data: responseData,
      ...responseData,
    });
  });

  // ===========================================================================
  // 4. DELETE /v1/uploads/:id/abort
  // ===========================================================================
  fastify.delete('/uploads/:id/abort', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const [session] = await db
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.id, id))
      .limit(1);

    if (!session) {
      throw MuxaroError.notFound(`Upload session ${id} not found`);
    }

    assertSessionOwnership(session, request);

    if (session.status !== 'completed' && session.status !== 'aborted') {
      const partsData = session.partsJson as { r2UploadId?: string } | null;
      const r2UploadId = partsData?.r2UploadId;

      if (r2UploadId) {
        try {
          await abortMultipartUpload(
            storageConfig.uploadsBucket,
            session.storageKey,
            r2UploadId
          );
        } catch (err) {
          request.log.warn({ err, id }, '[Uploads] AbortMultipartUpload failed on storage');
        }
      }

      await db
        .update(uploadSessions)
        .set({ status: 'aborted', updatedAt: new Date() })
        .where(eq(uploadSessions.id, id));
    }

    const responseData = {
      uploadSessionId: session.id,
      aborted: true,
    };

    return reply.status(200).send({
      success: true,
      data: responseData,
      ...responseData,
    });
  });

  // Alias POST /uploads/:id/abort for client environments restricting DELETE
  fastify.post('/uploads/:id/abort', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [session] = await db
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.id, id))
      .limit(1);

    if (!session) throw MuxaroError.notFound(`Upload session ${id} not found`);
    assertSessionOwnership(session, request);

    if (session.status !== 'completed' && session.status !== 'aborted') {
      const partsData = session.partsJson as { r2UploadId?: string } | null;
      const r2UploadId = partsData?.r2UploadId;
      if (r2UploadId) {
        try {
          await abortMultipartUpload(storageConfig.uploadsBucket, session.storageKey, r2UploadId);
        } catch {}
      }
      await db.update(uploadSessions).set({ status: 'aborted', updatedAt: new Date() }).where(eq(uploadSessions.id, id));
    }

    return reply.status(200).send({
      success: true,
      data: { uploadSessionId: session.id, aborted: true },
      uploadSessionId: session.id,
      aborted: true,
    });
  });
};
