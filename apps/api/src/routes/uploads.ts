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
import {
  uploadInitRequestSchema,
  uploadPartsRequestSchema,
  uploadCompleteRequestSchema,
  MuxaroError,
  RETENTION_SECONDS,
  type RetentionTier,
} from '@muxaro/shared';
import { getDb, uploadSessions, type UploadSession, eq, and } from '@muxaro/db';
import {
  getStorageConfig,
  initMultipartUpload,
  generatePresignedPartUrl,
  completeMultipartUpload,
  abortMultipartUpload,
  verifyMagicBytes,
} from '../lib/s3.js';

function sanitizeFilename(filename: string): string {
  return filename.replace(/[\r\n\t"]/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_');
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

    // Initialize multipart upload on S3 / R2
    const r2UploadId = await initMultipartUpload(
      storageConfig.uploadsBucket,
      storageKey,
      mimeType,
      {
        retentionTier,
        uploadSessionId,
        tool,
      }
    );

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
      partsJson: { r2UploadId, parts: [] },
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

    // Generate presigned upload URL for each requested part number
    const parts = await Promise.all(
      partNumbers.map(async (partNumber) => {
        const presignedUrl = await generatePresignedPartUrl(
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
      parts,
    };

    return reply.status(200).send({
      success: true,
      data: responseData,
      ...responseData,
    });
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

    // Finalize multipart upload on S3 / R2
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
    const magicCheck = await verifyMagicBytes(
      storageConfig.uploadsBucket,
      session.storageKey,
      session.targetFormat || undefined
    );

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
