/**
 * Project MUXARO - Secure Signed Resumable Binary Media Download Route
 * GET /api/v1/download/:token
 *
 * Full RFC 9110 HTTP Range delivery without RAM buffering:
 * - Accept-Ranges: bytes, Content-Length, strong ETag, Last-Modified, Cache-Control
 * - If-Range conditional validation (falls back to 200 full stream if validator changed)
 * - 206 Partial Content + Content-Range for valid byte ranges
 * - 416 Range Not Satisfiable + Content-Range: bytes *\/total for invalid/out-of-bounds ranges
 * - Content-Disposition: attachment (default) or inline (?inline=1)
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { tokenService } from '../services/token.service.js';
import { queueService, ARTIFACTS_ROOT, getMimeTypeForExtension } from '../services/queue.service.js';
import { resolveCallerIdentity, isOwnerOrAdmin } from '../services/request-identity.js';
import { recordAnalyticsEvent } from '../db/database.js';
import { mapHumanFriendlyError } from '../services/turboflow.service.js';
import { sanitizeFilename, validateSafePath, RateLimiter } from '@vyro/security';

const rateLimiter = new RateLimiter();

function matchesIfRange(ifRangeHeader: string, strongEtag: string, lastModifiedDate: Date): boolean {
  const trimmed = ifRangeHeader.trim();
  if (!trimmed) return true;

  // Entity-tag comparison (RFC 9110 §13.1.5 requires strong comparison; weak W/ never matches)
  if (trimmed.startsWith('"') || trimmed.startsWith('W/')) {
    return trimmed === strongEtag;
  }

  // HTTP-date comparison (second-level granularity per HTTP-date format)
  const parsedMs = Date.parse(trimmed);
  if (Number.isNaN(parsedMs)) {
    return false;
  }
  const mtimeSec = Math.floor(lastModifiedDate.getTime() / 1000);
  const headerSec = Math.floor(parsedMs / 1000);
  return mtimeSec === headerSec;
}

export const downloadRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/download/:token', {
    preHandler: rateLimiter.createFastifyHook('download'),
    schema: {
      description: 'Stream verified output media artifact from disk with full resumable HTTP Range support',
      tags: ['Download Delivery'],
      params: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          inline: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const { token } = request.params as { token: string };
    const query = (request.query || {}) as { inline?: string };
    const isInline = query.inline === '1' || query.inline === 'true';

    let payload;
    try {
      payload = tokenService.verifyDownloadToken(token);
    } catch (err: any) {
      const code = 'ERR_INVALID_DOWNLOAD_TOKEN';
      return reply.code(403).send({
        success: false,
        error: {
          code,
          message: err.message || 'Download token is invalid, expired, or has been tampered with',
          userMessage: mapHumanFriendlyError(code, err.message),
        },
        requestId,
      });
    }

    const artifact = queueService.resolveDownloadArtifact(payload.jobId, payload.artifactId);
    if (!artifact || !artifact.filePath) {
      const code = 'ERR_ARTIFACT_NOT_FOUND';
      return reply.code(404).send({
        success: false,
        error: {
          code,
          message: 'Media artifact is not available or has expired',
          userMessage: mapHumanFriendlyError(code),
        },
        requestId,
      });
    }

    // Strict IDOR Defense on signed download delivery:
    // 1. Artifact owner must match token payload userId
    if (artifact.ownerUserId && artifact.ownerUserId !== payload.userId) {
      return reply.code(404).send({
        success: false,
        error: {
          code: 'ERR_NOT_FOUND',
          message: 'Media artifact is not available or has expired',
          userMessage: mapHumanFriendlyError('ERR_ARTIFACT_NOT_FOUND'),
        },
        requestId,
      });
    }

    // 2. If caller presents an authenticated session or explicit auth header belonging to a DIFFERENT user, block IDOR!
    const caller = await resolveCallerIdentity(request);
    const hasExplicitAuth = Boolean(
      caller.authenticated ||
      request.headers.authorization ||
      (typeof request.headers.cookie === 'string' && request.headers.cookie.includes('muxaro_session='))
    );
    if (
      hasExplicitAuth &&
      !isOwnerOrAdmin(caller, payload.userId, {
        endpoint: '/api/v1/download/:token',
        resourceType: 'artifact',
        resourceId: payload.artifactId,
        requestId,
      })
    ) {
      return reply.code(404).send({
        success: false,
        error: {
          code: 'ERR_NOT_FOUND',
          message: 'Media artifact is not available or has expired',
          userMessage: mapHumanFriendlyError('ERR_ARTIFACT_NOT_FOUND'),
        },
        requestId,
      });
    }

    // Enforce strict directory jail inside .muxaro-artifacts and verify existence on disk
    const pathCheck = validateSafePath(artifact.filePath, [ARTIFACTS_ROOT], { mustExist: true });
    if (!pathCheck.isSafe || !pathCheck.resolvedPath) {
      const code = 'ERR_ARTIFACT_NOT_FOUND';
      return reply.code(404).send({
        success: false,
        error: {
          code,
          message: 'Media artifact file is no longer available on disk',
          userMessage: mapHumanFriendlyError(code),
        },
        requestId,
      });
    }

    const resolvedPath = pathCheck.resolvedPath;
    const stat = await fsp.stat(resolvedPath).catch(() => null);
    if (!stat || !stat.isFile() || stat.size <= 0) {
      const code = 'ERR_ARTIFACT_NOT_FOUND';
      return reply.code(404).send({
        success: false,
        error: {
          code,
          message: 'Media artifact file is missing or empty',
          userMessage: mapHumanFriendlyError(code),
        },
        requestId,
      });
    }

    const fileSize = stat.size;
    const safeFilename = sanitizeFilename(
      artifact.filename || payload.filename || path.basename(resolvedPath)
    );
    const contentType =
      artifact.mimeType || getMimeTypeForExtension(path.extname(safeFilename));
    const strongEtag = artifact.checksumSha256
      ? `"${artifact.checksumSha256}"`
      : `"${stat.size}-${Math.trunc(stat.mtimeMs)}"`;
    const lastModified = stat.mtime.toUTCString();

    const rangeHeader = request.headers.range;
    const ifRangeHeader = request.headers['if-range'];

    // Conditional If-Range: only honor Range if If-Range matches current ETag or Last-Modified
    const shouldHonorRange =
      typeof rangeHeader === 'string' &&
      rangeHeader.trim().length > 0 &&
      (typeof ifRangeHeader !== 'string' ||
        matchesIfRange(ifRangeHeader, strongEtag, stat.mtime));

    const sendRangeError = (detailMessage: string) => {
      reply.header('Content-Range', `bytes */${fileSize}`);
      reply.header('Accept-Ranges', 'bytes');
      return reply.code(416).send({
        success: false,
        error: {
          code: 'ERR_RANGE_NOT_SATISFIABLE',
          message: detailMessage,
          userMessage: 'This download could not be resumed. Start a new download.',
        },
        requestId,
      });
    };

    let rangeSlice: { start: number; end: number } | null = null;
    if (shouldHonorRange && typeof rangeHeader === 'string') {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (!match) {
        return sendRangeError('Invalid byte range requested');
      }

      const startStr = match[1];
      const endStr = match[2];
      let start: number;
      let end: number;

      if (startStr === '' && endStr === '') {
        return sendRangeError('Empty byte range requested');
      } else if (startStr === '' && endStr !== '') {
        // Suffix range: bytes=-N
        const suffixLength = Number.parseInt(endStr, 10);
        if (Number.isNaN(suffixLength) || suffixLength <= 0) {
          return sendRangeError('Invalid suffix byte range');
        }
        start = Math.max(0, fileSize - suffixLength);
        end = fileSize - 1;
      } else {
        start = Number.parseInt(startStr, 10);
        end = endStr === '' ? fileSize - 1 : Math.min(Number.parseInt(endStr, 10), fileSize - 1);
      }

      if (
        Number.isNaN(start) ||
        Number.isNaN(end) ||
        start < 0 ||
        start >= fileSize ||
        start > end
      ) {
        return sendRangeError('Requested byte range is out of bounds');
      }

      rangeSlice = { start, end };
    }

    // Set secure resumable binary delivery headers after range validation succeeds
    const disposition = isInline ? 'inline' : 'attachment';
    reply.header('Content-Disposition', `${disposition}; filename="${safeFilename}"`);
    reply.header('Content-Type', contentType);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Accept-Ranges', 'bytes');
    reply.header('ETag', strongEtag);
    reply.header('Last-Modified', lastModified);
    reply.header('Cache-Control', 'private, no-cache, must-revalidate');

    if (rangeSlice) {
      const { start, end } = rangeSlice;
      const chunkSize = end - start + 1;
      reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      reply.header('Content-Length', chunkSize);
      return reply.code(206).send(fs.createReadStream(resolvedPath, { start, end }));
    }

    reply.header('Content-Length', fileSize);
    recordAnalyticsEvent('download_started', payload.userId, caller.priorityTier, {
      container: artifact.container,
      sizeBytes: fileSize,
      inline: isInline,
    });
    return reply.code(200).send(fs.createReadStream(resolvedPath));
  });
};
