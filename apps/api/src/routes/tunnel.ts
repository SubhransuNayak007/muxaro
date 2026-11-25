/**
 * Project MUXARO - Cobalt-Style Stateless Streaming Tunnel
 *
 * Implements zero-storage HTTP streaming & on-the-fly FFmpeg remuxing:
 * - POST /tunnel/sign : Mints short-lived HMAC-signed tunnel tokens
 * - GET  /tunnel      : Verifies HMAC token, enforces SSRF & pinned egress affinity,
 *                       and streams bytes directly to the client (zero temp disk / zero R2 wait)
 */

import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { assertSafeMediaUrl } from '@muxaro/shared';
import { sanitizeFilename } from '@vyro/security';
import { egressPoolManager } from '../services/egress-pool.service.js';
import { getYtDlpBaseArgs } from '../services/turboflow.service.js';
import { requireTurnstileIfConfigured } from '../plugins/turnstile.js';

export interface TunnelTokenPayload {
  mode: 'stream' | 'mux' | 'ytdlp';
  url: string;
  audioUrl?: string;
  formatId?: string;
  egressProfileId?: string;
  filename: string;
  ext: string;
  exp: number;
}

const DEFAULT_TUNNEL_TTL_SEC = 20 * 60;

function resolveTunnelSecret(): string {
  return (
    process.env.TUNNEL_SIGNING_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    'muxaro-tunnel-hmac-dev-signing-secret-32-bytes'
  );
}

export function signTunnelPayload(
  payload: Omit<TunnelTokenPayload, 'exp'>,
  ttlSeconds = DEFAULT_TUNNEL_TTL_SEC
): string {
  const full: TunnelTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const bodyB64 = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', resolveTunnelSecret())
    .update(bodyB64)
    .digest('base64url');
  return `${bodyB64}.${sig}`;
}

export function verifyTunnelToken(token: string): TunnelTokenPayload | null {
  if (!token || !token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [bodyB64, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', resolveTunnelSecret())
    .update(bodyB64)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8')) as TunnelTokenPayload;
    if (!parsed || typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (!parsed.url || typeof parsed.url !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export const tunnelRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/tunnel/sign',
    {
      preHandler: requireTurnstileIfConfigured,
      schema: {
        description: 'Sign a short-lived HMAC token for Cobalt-style zero-storage streaming tunnel',
        tags: ['Media Delivery'],
        body: {
          type: 'object',
          required: ['url'],
          properties: {
            mode: { type: 'string', enum: ['stream', 'mux', 'ytdlp'] },
            url: { type: 'string' },
            audioUrl: { type: 'string' },
            formatId: { type: 'string' },
            egressProfileId: { type: 'string' },
            filename: { type: 'string' },
            ext: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body || {}) as Partial<TunnelTokenPayload>;
      const rawUrl = String(body.url || '').trim();
      const safeMain = await assertSafeMediaUrl(rawUrl).catch(() => null);
      if (!safeMain?.canonicalUrl) {
        return reply.code(403).send({
          success: false,
          error: {
            code: 'SSRF_BLOCKED',
            message: 'Target media URL is not permitted for tunneling.',
          },
          requestId: request.id,
        });
      }

      if (body.audioUrl) {
        const safeAudio = await assertSafeMediaUrl(String(body.audioUrl)).catch(() => null);
        if (!safeAudio?.canonicalUrl) {
          return reply.code(403).send({
            success: false,
            error: {
              code: 'SSRF_BLOCKED',
              message: 'Target audio URL is not permitted for tunneling.',
            },
            requestId: request.id,
          });
        }
      }

      const ext = String(body.ext || 'mp4')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '') || 'mp4';
      const baseName = sanitizeFilename(String(body.filename || 'muxaro_stream'), 'muxaro_stream');
      const filename = baseName.endsWith(`.${ext}`) ? baseName : `${baseName}.${ext}`;

      const token = signTunnelPayload({
        mode: body.mode || (body.audioUrl ? 'mux' : 'stream'),
        url: safeMain.canonicalUrl || rawUrl,
        audioUrl: body.audioUrl?.trim() || undefined,
        formatId: body.formatId?.trim() || undefined,
        egressProfileId: body.egressProfileId?.trim() || undefined,
        filename,
        ext,
      });

      return reply.code(200).send({
        success: true,
        data: {
          token,
          tunnelPath: `/api/v1/tunnel?token=${encodeURIComponent(token)}`,
        },
        requestId: request.id,
      });
    }
  );

  fastify.get(
    '/tunnel',
    {
      schema: {
        description: 'Zero-storage stateless media stream & on-the-fly remux tunnel',
        tags: ['Media Delivery'],
        querystring: {
          type: 'object',
          required: ['token'],
          properties: {
            token: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { token } = (request.query || {}) as { token?: string };
      const payload = verifyTunnelToken(String(token || ''));

      if (!payload) {
        return reply.code(401).send({
          success: false,
          error: {
            code: 'ERR_TUNNEL_TOKEN_INVALID',
            message: 'Tunnel token is invalid or expired.',
          },
          requestId: request.id,
        });
      }

      const safeMain = await assertSafeMediaUrl(payload.url).catch(() => null);
      if (!safeMain?.canonicalUrl) {
        return reply.code(403).send({
          success: false,
          error: {
            code: 'SSRF_BLOCKED',
            message: 'Disallowed upstream stream host.',
          },
          requestId: request.id,
        });
      }

      const safeFilename = sanitizeFilename(payload.filename, `muxaro.${payload.ext}`);
      const mime =
        payload.ext === 'webm'
          ? 'video/webm'
          : payload.ext === 'mp3'
            ? 'audio/mpeg'
            : payload.ext === 'm4a'
              ? 'audio/mp4'
              : payload.ext === 'mkv'
                ? 'video/x-matroska'
                : 'video/mp4';

      // Mode 1: Zero-storage FFmpeg stream-copy mux (video + audio -> fragmented MP4/MKV pipe:1)
      if (payload.mode === 'mux' && payload.audioUrl) {
        const safeAudio = await assertSafeMediaUrl(payload.audioUrl).catch(() => null);
        if (!safeAudio?.canonicalUrl) {
          return reply.code(403).send({
            success: false,
            error: {
              code: 'SSRF_BLOCKED',
              message: 'Disallowed upstream audio host.',
            },
            requestId: request.id,
          });
        }

        const ffmpegBin = process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
        const args = [
          '-nostdin',
          '-hide_banner',
          '-loglevel', 'error',
          '-i', payload.url,
          '-i', payload.audioUrl,
          '-c', 'copy',
          ...(payload.ext === 'mp4'
            ? ['-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof']
            : payload.ext === 'webm'
              ? ['-f', 'webm']
              : ['-f', 'matroska']),
          'pipe:1',
        ];

        const child = spawn(ffmpegBin, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        request.raw.on('close', () => {
          try {
            if (!child.killed) child.kill('SIGTERM');
          } catch {}
        });

        reply.header('Content-Type', mime);
        reply.header('Content-Disposition', `attachment; filename="${safeFilename}"`);
        reply.header('Cache-Control', 'no-store');
        return reply.send(child.stdout);
      }

      // Mode 2: Pinned egress yt-dlp stdout pipe (preserves proxy + PO token + cookie tuple)
      if (payload.mode === 'ytdlp') {
        const profile = egressPoolManager.selectProfile({ preferredId: payload.egressProfileId });
        const baseArgs = getYtDlpBaseArgs({
          includeProgress: false,
          playerClient: profile.playerClients,
          proxy: profile.proxyUrl,
          poTokenBaseUrl: profile.bgutilUrl,
          poToken: profile.poToken,
          visitorData: profile.visitorData,
          cookiesPath: profile.cookiesPath,
          cookiesContent: profile.cookiesContent,
          forceIpVersion: profile.forceIpVersion,
        });

        const ytdlpBin = process.env.YTDLP_PATH?.trim() || 'yt-dlp';
        const args = [
          ...baseArgs,
          ...(payload.formatId ? ['-f', payload.formatId] : []),
          '-o', '-',
          '--',
          payload.url,
        ];

        const child = spawn(ytdlpBin, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        child.on('close', (code) => {
          if (code === 0) {
            egressPoolManager.markSuccess(profile.id);
          } else {
            egressPoolManager.releaseProfile(profile.id);
          }
        });
        request.raw.on('close', () => {
          egressPoolManager.releaseProfile(profile.id);
          try {
            if (!child.killed) child.kill('SIGTERM');
          } catch {}
        });

        reply.header('Content-Type', mime);
        reply.header('Content-Disposition', `attachment; filename="${safeFilename}"`);
        reply.header('Cache-Control', 'no-store');
        return reply.send(child.stdout);
      }

      // Mode 3: Direct zero-storage HTTP stream passthrough (with Range forwarding)
      const upstreamHeaders: Record<string, string> = {};
      if (request.headers.range) {
        upstreamHeaders.Range = String(request.headers.range);
      }
      const upstream = await fetch(payload.url, {
        headers: upstreamHeaders,
        redirect: 'follow',
      });

      if (!upstream.ok && upstream.status !== 206) {
        return reply.code(upstream.status >= 400 ? upstream.status : 502).send({
          success: false,
          error: {
            code: upstream.status === 403 ? 'HOST_BLOCKED' : 'ERR_UPSTREAM_STREAM',
            message: `Upstream stream returned HTTP ${upstream.status}`,
          },
          requestId: request.id,
        });
      }

      reply.code(upstream.status);
      reply.header('Content-Type', upstream.headers.get('content-type') || mime);
      reply.header('Content-Disposition', `attachment; filename="${safeFilename}"`);
      reply.header('Cache-Control', 'no-store');
      const contentLen = upstream.headers.get('content-length');
      const contentRange = upstream.headers.get('content-range');
      const acceptRanges = upstream.headers.get('accept-ranges');
      if (contentLen) reply.header('Content-Length', contentLen);
      if (contentRange) reply.header('Content-Range', contentRange);
      if (acceptRanges) reply.header('Accept-Ranges', acceptRanges);

      if (!upstream.body) {
        return reply.send('');
      }
      return reply.send(Readable.fromWeb(upstream.body as any));
    }
  );
};
