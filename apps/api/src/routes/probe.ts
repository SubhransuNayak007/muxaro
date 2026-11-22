/**
 * MUXARO Media Processing Platform - URL Probe Route
 * 
 * Implements:
 * POST /probe (mounted under /api/v1 and /v1)
 * 
 * Features:
 * - Anti-SSRF guard checking target URL before execution
 * - 8K format matrix extraction (height, fps, hdr, vcodec, ext, estBytes, requiresMux)
 * - Platform detection across YouTube, Instagram, X/Twitter, Facebook, Pinterest, TikTok, Reddit, Vimeo
 * - Deno-accelerated yt-dlp with gallery-dl fallback for carousels and images
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { ProbeService, detectPlatform } from '../services/probe.service.js';

function isSsrfTarget(targetUrl: string): boolean {
  try {
    const parsed = new URL(targetUrl);
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

export const probeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/probe', {
    schema: {
      description: 'Probe URL with yt-dlp & Deno (with gallery-dl fallback) for 8K multi-platform extraction',
      tags: ['Media Inspection'],
      body: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string' },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body || {}) as { url?: string };
    const rawUrl = body.url?.trim();

    if (!rawUrl) {
      return reply.code(400).send({
        success: false,
        error: {
          code: 'ERR_INVALID_URL',
          message: 'The "url" field is required and must not be empty',
        },
        requestId: request.id,
      });
    }

    if (isSsrfTarget(rawUrl)) {
      return reply.code(403).send({
        success: false,
        error: {
          code: 'SSRF_BLOCKED',
          message: 'The provided URL resolves to a protected or private IP address',
        },
        requestId: request.id,
      });
    }

    try {
      const probeData = await ProbeService.probeUrl(rawUrl);

      return reply.code(200).send({
        success: true,
        data: probeData,
        ...probeData,
        requestId: request.id,
      });
    } catch (err: any) {
      request.log.warn({ err, url: rawUrl }, '[Probe] URL extraction failed');

      const isBot = /confirm you’re not a bot|bot verification|sign in/i.test(err.message || '');
      const statusCode = isBot ? 422 : 502;
      const code = isBot ? 'ERR_BOT_VERIFICATION_REQUIRED' : 'ERR_EXTRACTION_FAILED';

      return reply.code(statusCode).send({
        success: false,
        error: {
          code,
          message: err.message || 'Failed to extract media information from URL',
        },
        requestId: request.id,
      });
    }
  });
};
