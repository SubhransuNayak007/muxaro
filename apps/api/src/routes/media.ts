/**
 * Project MUXARO - Media Inspection, Single-Stream Upload & Resumable Multipart Upload Routes
 * POST   /api/v1/media/inspect
 * POST   /api/v1/media/upload
 * POST   /api/v1/media/upload/init
 * PUT    /api/v1/media/upload/:uploadId/part/:partNumber
 * POST   /api/v1/media/upload/:uploadId/complete
 * DELETE /api/v1/media/upload/:uploadId
 * GET    /api/v1/media/:id
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyPluginAsync } from 'fastify';
import {
  adapterService,
  UPLOADS_ROOT,
  toPublicMediaAssetInfo,
} from '../services/adapter.service.js';
import { mapHumanFriendlyError } from '../services/turboflow.service.js';
import {
  validateInspectMediaRequest,
  sanitizeFilename,
  validateSafePath,
  RateLimiter,
} from '@vyro/security';

const rateLimiter = new RateLimiter();
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const MAX_MULTIPART_PARTS = 1000;
const MULTIPART_TTL_MS = 60 * 60 * 1000; // 60 minutes
const MULTIPART_ROOT = path.join(UPLOADS_ROOT, 'multipart');

interface MultipartSession {
  uploadId: string;
  originalFilename: string;
  safeFilename: string;
  totalSize: number;
  totalParts: number;
  expectedSha256?: string;
  sessionDir: string;
  parts: Map<number, { sizeBytes: number; filePath: string }>;
  createdAt: string;
  expiresAt: string;
  cleanupTimer: NodeJS.Timeout;
}

const multipartSessions = new Map<string, MultipartSession>();

function cleanupMultipartSession(uploadId: string): void {
  const session = multipartSessions.get(uploadId);
  if (!session) return;
  clearTimeout(session.cleanupTimer);
  multipartSessions.delete(uploadId);
  fsp.rm(session.sessionDir, { recursive: true, force: true }).catch(() => {});
}

function inferExtensionFromContentType(contentType?: string): string {
  const ct = (contentType || '').toLowerCase().split(';')[0].trim();
  const map: Record<string, string> = {
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/x-matroska': '.mkv',
    'video/webm': '.webm',
    'video/x-msvideo': '.avi',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/aac': '.aac',
    'audio/flac': '.flac',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/opus': '.opus',
    'audio/ogg': '.ogg',
  };
  return map[ct] || '.mp4';
}

async function streamBodyToFile(
  body: unknown,
  destPath: string,
  maxBytes: number
): Promise<number> {
  let totalBytes = 0;

  if (body && typeof (body as Readable).pipe === 'function') {
    const sizeGuard = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          const limitErr = new Error('File exceeds maximum 2 GB upload limit');
          (limitErr as any).statusCode = 413;
          (limitErr as any).code = 'ERR_FILE_TOO_LARGE';
          callback(limitErr);
          return;
        }
        callback(null, chunk);
      },
    });
    await pipeline(body as Readable, sizeGuard, fs.createWriteStream(destPath));
    return totalBytes;
  }

  if (Buffer.isBuffer(body)) {
    if (body.length > maxBytes) {
      const limitErr = new Error('File exceeds maximum 2 GB upload limit');
      (limitErr as any).statusCode = 413;
      (limitErr as any).code = 'ERR_FILE_TOO_LARGE';
      throw limitErr;
    }
    await fsp.writeFile(destPath, body);
    return body.length;
  }

  const err = new Error('Upload request body must be a binary stream');
  (err as any).statusCode = 400;
  (err as any).code = 'ERR_EMPTY_UPLOAD';
  throw err;
}

/**
 * Concatenates uploaded parts 1..totalParts sequentially into destPath using pure streams
 * (never loads the entire file into RAM) and computes SHA-256 on the fly.
 */
async function assemblePartsStream(
  partPaths: string[],
  destPath: string
): Promise<{ totalBytes: number; sha256: string }> {
  const hash = crypto.createHash('sha256');
  const writeStream = fs.createWriteStream(destPath);
  let totalBytes = 0;

  try {
    for (const partPath of partPaths) {
      await new Promise<void>((resolve, reject) => {
        const readStream = fs.createReadStream(partPath);
        readStream.on('data', (chunk: string | Buffer) => {
          const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
          totalBytes += buf.length;
          hash.update(buf);
          if (!writeStream.write(buf)) {
            readStream.pause();
            writeStream.once('drain', () => readStream.resume());
          }
        });
        readStream.on('error', reject);
        readStream.on('end', resolve);
      });
    }

    await new Promise<void>((resolve, reject) => {
      writeStream.once('error', reject);
      writeStream.end(() => resolve());
    });

    return { totalBytes, sha256: hash.digest('hex') };
  } catch (err) {
    writeStream.destroy();
    throw err;
  }
}

export const mediaRoutes: FastifyPluginAsync = async (fastify) => {
  const passThroughStreamParser = (
    _request: unknown,
    payload: Readable,
    done: (err: Error | null, body?: Readable) => void
  ) => {
    done(null, payload);
  };

  fastify.addContentTypeParser('application/octet-stream', { bodyLimit: MAX_UPLOAD_BYTES }, passThroughStreamParser);
  fastify.addContentTypeParser(/^video\//, { bodyLimit: MAX_UPLOAD_BYTES }, passThroughStreamParser);
  fastify.addContentTypeParser(/^audio\//, { bodyLimit: MAX_UPLOAD_BYTES }, passThroughStreamParser);

  // POST /api/v1/media/inspect
  fastify.post('/media/inspect', {
    preHandler: rateLimiter.createFastifyHook('inspect'),
    schema: {
      description: 'Inspect external media URL for genuine resolutions, codecs, and rights compliance',
      tags: ['Media Inspection'],
      body: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string' },
          rightsDeclared: { type: 'boolean', default: true },
          ownershipType: { type: 'string' },
          attestation: { type: 'boolean' },
          licenseType: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const body = request.body as any;

    try {
      const validation = validateInspectMediaRequest(body);
      if (!validation.success) {
        const msg = validation.errors?.[0]?.message || 'Malformed inspect request payload';
        return reply.code(400).send({
          success: false,
          error: {
            code: 'ERR_INVALID_REQUEST',
            message: msg,
            userMessage: mapHumanFriendlyError('ERR_INVALID_REQUEST', msg),
            details: null,
          },
          requestId,
        });
      }
    } catch (valErr: any) {
      return reply.code(400).send({
        success: false,
        error: {
          code: 'ERR_INVALID_REQUEST',
          message: valErr.message || 'Malformed inspect request payload',
          userMessage: mapHumanFriendlyError('ERR_INVALID_REQUEST', valErr.message),
          details: null,
        },
        requestId,
      });
    }

    try {
      const userDeclaration = body.ownershipType
        ? {
            ownershipType: body.ownershipType,
            attestation: Boolean(body.attestation),
            licenseType: body.licenseType,
          }
        : undefined;

      const assetInfo = await adapterService.inspect(
        body.url,
        body.rightsDeclared ?? true,
        userDeclaration
      );

      return reply.code(200).send({
        success: true,
        data: toPublicMediaAssetInfo(assetInfo),
        requestId,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 400;
      const code = err.code || 'ERR_INSPECTION_FAILED';

      return reply.code(statusCode).send({
        success: false,
        error: {
          code,
          message: err.message || 'Failed to inspect media URL',
          userMessage: mapHumanFriendlyError(code, err.message),
          details: err.details || null,
        },
        requestId,
      });
    }
  });

  // POST /api/v1/media/upload (single-request streaming upload up to 2 GB)
  fastify.post('/media/upload', {
    bodyLimit: MAX_UPLOAD_BYTES,
    schema: {
      description: 'Upload a local video or audio file from computer (streaming up to 2 GB) and inspect with ffprobe',
      tags: ['Media Inspection'],
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const rawHeaderName = request.headers['x-file-name'];
    let originalName = 'uploaded_media';
    if (typeof rawHeaderName === 'string' && rawHeaderName.trim().length > 0) {
      try {
        originalName = decodeURIComponent(rawHeaderName.trim());
      } catch {
        originalName = rawHeaderName.trim();
      }
    }

    const fallbackExt = inferExtensionFromContentType(request.headers['content-type']);
    let safeFilename = sanitizeFilename(originalName, `uploaded_media${fallbackExt}`);
    if (!path.extname(safeFilename)) {
      safeFilename = `${safeFilename}${fallbackExt}`;
    }

    const assetId = crypto.randomUUID();
    const uploadDir = path.join(UPLOADS_ROOT, assetId);
    const destPath = path.join(uploadDir, safeFilename);

    const pathCheck = validateSafePath(destPath, [UPLOADS_ROOT], { mustExist: false });
    if (!pathCheck.isSafe || !pathCheck.resolvedPath) {
      const code = 'ERR_INVALID_REQUEST';
      return reply.code(400).send({
        success: false,
        error: {
          code,
          message: 'Invalid upload filename',
          userMessage: mapHumanFriendlyError(code),
          details: null,
        },
        requestId,
      });
    }

    try {
      await fsp.mkdir(uploadDir, { recursive: true });
      const totalBytes = await streamBodyToFile(request.body, pathCheck.resolvedPath, MAX_UPLOAD_BYTES);
      if (totalBytes <= 0) {
        const err = new Error('Uploaded file is empty (0 bytes)');
        (err as any).statusCode = 400;
        (err as any).code = 'ERR_EMPTY_UPLOAD';
        throw err;
      }

      const assetInfo = await adapterService.registerLocalUpload({
        assetId,
        localFilePath: pathCheck.resolvedPath,
        originalName,
      });

      return reply.code(200).send({
        success: true,
        data: toPublicMediaAssetInfo(assetInfo),
        requestId,
      });
    } catch (err: any) {
      await fsp.rm(uploadDir, { recursive: true, force: true }).catch(() => {});
      const statusCode = err.statusCode || 400;
      const code = err.code || 'ERR_UPLOAD_FAILED';
      return reply.code(statusCode).send({
        success: false,
        error: {
          code,
          message: err.message || 'Failed to upload and inspect media file',
          userMessage: mapHumanFriendlyError(code, err.message),
          details: err.details || null,
        },
        requestId,
      });
    }
  });

  // POST /api/v1/media/upload/init (start resumable multipart upload session)
  fastify.post('/media/upload/init', {
    schema: {
      description: 'Initialize a resumable multipart upload session for large local files',
      tags: ['Media Inspection'],
      body: {
        type: 'object',
        required: ['filename', 'totalSize', 'totalParts'],
        properties: {
          filename: { type: 'string', minLength: 1, maxLength: 255 },
          totalSize: { type: 'integer', minimum: 1 },
          totalParts: { type: 'integer', minimum: 1, maximum: MAX_MULTIPART_PARTS },
          sha256: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const body = request.body as {
      filename: string;
      totalSize: number;
      totalParts: number;
      sha256?: string;
    };

    if (body.totalSize > MAX_UPLOAD_BYTES) {
      const code = 'ERR_FILE_TOO_LARGE';
      return reply.code(413).send({
        success: false,
        error: {
          code,
          message: 'File exceeds maximum 2 GB upload limit',
          userMessage: mapHumanFriendlyError(code),
        },
        requestId,
      });
    }

    const uploadId = crypto.randomUUID();
    const originalFilename = body.filename.trim();
    let safeFilename = sanitizeFilename(originalFilename, 'uploaded_media.mp4');
    if (!path.extname(safeFilename)) {
      safeFilename = `${safeFilename}.mp4`;
    }

    const sessionDir = path.join(MULTIPART_ROOT, uploadId);
    const dirCheck = validateSafePath(sessionDir, [UPLOADS_ROOT], { mustExist: false });
    if (!dirCheck.isSafe || !dirCheck.resolvedPath) {
      return reply.code(400).send({
        success: false,
        error: {
          code: 'ERR_INVALID_REQUEST',
          message: 'Invalid multipart session path',
          userMessage: mapHumanFriendlyError('ERR_INVALID_REQUEST'),
        },
        requestId,
      });
    }

    await fsp.mkdir(dirCheck.resolvedPath, { recursive: true });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + MULTIPART_TTL_MS).toISOString();
    const cleanupTimer = setTimeout(() => cleanupMultipartSession(uploadId), MULTIPART_TTL_MS);
    cleanupTimer.unref();

    const session: MultipartSession = {
      uploadId,
      originalFilename,
      safeFilename,
      totalSize: body.totalSize,
      totalParts: body.totalParts,
      expectedSha256: body.sha256 ? body.sha256.trim().toLowerCase() : undefined,
      sessionDir: dirCheck.resolvedPath,
      parts: new Map(),
      createdAt: now.toISOString(),
      expiresAt,
      cleanupTimer,
    };

    multipartSessions.set(uploadId, session);

    return reply.code(200).send({
      success: true,
      data: {
        uploadId,
        filename: safeFilename,
        totalSize: session.totalSize,
        totalParts: session.totalParts,
        chunkSizeHint: 5 * 1024 * 1024,
        expiresAt,
      },
      requestId,
    });
  });

  // PUT /api/v1/media/upload/:uploadId/part/:partNumber (idempotent resumable part stream)
  fastify.put('/media/upload/:uploadId/part/:partNumber', {
    bodyLimit: 100 * 1024 * 1024, // up to 100 MB per individual part
    schema: {
      description: 'Stream a single binary part into an active multipart upload session (idempotent for retries)',
      tags: ['Media Inspection'],
      params: {
        type: 'object',
        required: ['uploadId', 'partNumber'],
        properties: {
          uploadId: { type: 'string' },
          partNumber: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const { uploadId, partNumber: partStr } = request.params as { uploadId: string; partNumber: string };
    const partNumber = Number.parseInt(partStr, 10);

    const session = multipartSessions.get(uploadId);
    if (!session) {
      const code = 'ERR_UPLOAD_NOT_FOUND';
      return reply.code(404).send({
        success: false,
        error: {
          code,
          message: `Upload session ${uploadId} not found or expired`,
          userMessage: mapHumanFriendlyError(code),
        },
        requestId,
      });
    }

    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > session.totalParts) {
      const code = 'ERR_INVALID_REQUEST';
      return reply.code(400).send({
        success: false,
        error: {
          code,
          message: `Invalid partNumber ${partStr}. Must be between 1 and ${session.totalParts}`,
          userMessage: mapHumanFriendlyError(code),
        },
        requestId,
      });
    }

    const partPath = path.join(session.sessionDir, `part_${partNumber}`);
    const tmpPartPath = path.join(session.sessionDir, `part_${partNumber}.${Date.now()}.tmp`);

    try {
      const sizeBytes = await streamBodyToFile(request.body, tmpPartPath, 100 * 1024 * 1024);
      if (sizeBytes <= 0) {
        await fsp.rm(tmpPartPath, { force: true }).catch(() => {});
        const err = new Error('Uploaded part is empty (0 bytes)');
        (err as any).statusCode = 400;
        (err as any).code = 'ERR_EMPTY_UPLOAD';
        throw err;
      }

      // Check cumulative upload cap across parts
      let accumulated = sizeBytes;
      for (const [pNum, meta] of session.parts.entries()) {
        if (pNum !== partNumber) accumulated += meta.sizeBytes;
      }
      if (accumulated > MAX_UPLOAD_BYTES) {
        await fsp.rm(tmpPartPath, { force: true }).catch(() => {});
        const err = new Error('Cumulative multipart upload exceeds 2 GB limit');
        (err as any).statusCode = 413;
        (err as any).code = 'ERR_FILE_TOO_LARGE';
        throw err;
      }

      // Atomic replace so retrying a failed part is 100% idempotent
      await fsp.rename(tmpPartPath, partPath);
      session.parts.set(partNumber, { sizeBytes, filePath: partPath });

      return reply.code(200).send({
        success: true,
        data: {
          uploadId,
          partNumber,
          sizeBytes,
          receivedParts: session.parts.size,
          totalParts: session.totalParts,
        },
        requestId,
      });
    } catch (err: any) {
      await fsp.rm(tmpPartPath, { force: true }).catch(() => {});
      const statusCode = err.statusCode || 400;
      const code = err.code || 'ERR_UPLOAD_FAILED';
      return reply.code(statusCode).send({
        success: false,
        error: {
          code,
          message: err.message || 'Failed to save upload part',
          userMessage: mapHumanFriendlyError(code, err.message),
        },
        requestId,
      });
    }
  });

  // POST /api/v1/media/upload/:uploadId/complete (stream-concatenate parts -> verify -> ffprobe)
  fastify.post('/media/upload/:uploadId/complete', {
    schema: {
      description: 'Assemble all uploaded parts via streams, verify optional SHA-256, and inspect with ffprobe',
      tags: ['Media Inspection'],
      params: {
        type: 'object',
        required: ['uploadId'],
        properties: {
          uploadId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const { uploadId } = request.params as { uploadId: string };

    const session = multipartSessions.get(uploadId);
    if (!session) {
      const code = 'ERR_UPLOAD_NOT_FOUND';
      return reply.code(404).send({
        success: false,
        error: {
          code,
          message: `Upload session ${uploadId} not found or expired`,
          userMessage: mapHumanFriendlyError(code),
        },
        requestId,
      });
    }

    const missingParts: number[] = [];
    const orderedPartPaths: string[] = [];
    for (let p = 1; p <= session.totalParts; p++) {
      const part = session.parts.get(p);
      if (!part) {
        missingParts.push(p);
      } else {
        orderedPartPaths.push(part.filePath);
      }
    }

    if (missingParts.length > 0) {
      const code = 'ERR_INVALID_REQUEST';
      return reply.code(400).send({
        success: false,
        error: {
          code,
          message: `Missing upload parts: ${missingParts.slice(0, 10).join(', ')}`,
          userMessage: 'Some parts of your upload did not finish. Please try uploading again.',
          details: { missingParts },
        },
        requestId,
      });
    }

    const assetId = crypto.randomUUID();
    const uploadDir = path.join(UPLOADS_ROOT, assetId);
    const destPath = path.join(uploadDir, session.safeFilename);

    try {
      await fsp.mkdir(uploadDir, { recursive: true });
      const { totalBytes, sha256 } = await assemblePartsStream(orderedPartPaths, destPath);

      if (totalBytes <= 0) {
        const err = new Error('Assembled upload is empty');
        (err as any).statusCode = 400;
        (err as any).code = 'ERR_EMPTY_UPLOAD';
        throw err;
      }

      if (session.expectedSha256 && sha256 !== session.expectedSha256) {
        const err = new Error(`Uploaded file SHA-256 mismatch (expected ${session.expectedSha256}, got ${sha256})`);
        (err as any).statusCode = 400;
        (err as any).code = 'ERR_CHECKSUM_MISMATCH';
        throw err;
      }

      // Clean up temporary parts immediately after assembly
      cleanupMultipartSession(uploadId);

      const assetInfo = await adapterService.registerLocalUpload({
        assetId,
        localFilePath: destPath,
        originalName: session.originalFilename,
      });

      return reply.code(200).send({
        success: true,
        data: toPublicMediaAssetInfo(assetInfo),
        requestId,
      });
    } catch (err: any) {
      await fsp.rm(uploadDir, { recursive: true, force: true }).catch(() => {});
      const statusCode = err.statusCode || 400;
      const code = err.code || 'ERR_UPLOAD_FAILED';
      return reply.code(statusCode).send({
        success: false,
        error: {
          code,
          message: err.message || 'Failed to complete multipart upload',
          userMessage: mapHumanFriendlyError(code, err.message),
        },
        requestId,
      });
    }
  });

  // DELETE /api/v1/media/upload/:uploadId (cancel and clean temp files)
  fastify.delete('/media/upload/:uploadId', {
    schema: {
      description: 'Cancel an active multipart upload session and remove all temporary parts',
      tags: ['Media Inspection'],
      params: {
        type: 'object',
        required: ['uploadId'],
        properties: {
          uploadId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const { uploadId } = request.params as { uploadId: string };

    cleanupMultipartSession(uploadId);

    return reply.code(200).send({
      success: true,
      data: {
        uploadId,
        cancelled: true,
      },
      requestId,
    });
  });

  // GET /api/v1/media/:id
  fastify.get('/media/:id', {
    schema: {
      description: 'Retrieve previously inspected media manifest by asset ID',
      tags: ['Media Inspection'],
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

    const asset = adapterService.getAsset(id);
    if (!asset) {
      const code = 'ERR_ASSET_NOT_FOUND';
      return reply.code(404).send({
        success: false,
        error: {
          code,
          message: `Inspected asset ${id} not found or expired from cache`,
          userMessage: mapHumanFriendlyError(code),
        },
        requestId,
      });
    }

    return reply.code(200).send({
      success: true,
      data: toPublicMediaAssetInfo(asset),
      requestId,
    });
  });
};
