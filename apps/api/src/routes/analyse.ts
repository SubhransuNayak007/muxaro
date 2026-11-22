/**
 * MUXARO Media Processing Platform - Media Inspection Route
 *
 * Implements POST /v1/analyse:
 * 1. Validates request body with analyseRequestSchema
 * 2. Enforces SSRF and anti-DNS rebinding defenses via assertSafeMediaUrl
 * 3. Consults distributed Redis cache (muxaro:analyse:{platform}:{hash})
 * 4. Queues metadata extraction to BullMQ lane:analyse on cache miss
 * 5. Resilient fallback to fast oEmbed/HEAD inspection if worker queue is cold
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import {
  analyseRequestSchema,
  assertSafeMediaUrl,
  MuxaroError,
  type MediaAnalysisResult,
  type MediaFormatInfo,
  type MediaPlatform,
} from '@muxaro/shared';
import { getMuxaroRedis } from '@muxaro/db';
import { getAnalyseQueue, getAnalyseQueueEvents } from '../lib/queues.js';

function computeAnalysisHash(canonicalUrl: string, id?: string): string {
  if (id && id.length > 0) {
    return id.replace(/[^a-zA-Z0-9_-]/g, '');
  }
  return crypto.createHash('sha256').update(canonicalUrl).digest('hex').substring(0, 32);
}

/**
 * Resilient fast fallback inspection for YouTube / Vimeo / Direct URLs
 * in case BullMQ workers are under high load or warming up.
 */
async function fallbackInspect(
  platform: MediaPlatform,
  canonicalUrl: string,
  id?: string,
  isPlaylist?: boolean
): Promise<MediaAnalysisResult> {
  const inspectedAt = new Date().toISOString();

  if (platform === 'youtube') {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;
    try {
      const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = (await res.json()) as any;
        const videoId = id || 'video';
        const defaultFormats: MediaFormatInfo[] = [
          {
            formatId: '1080p_mp4',
            container: 'mp4',
            resolution: '1080p',
            width: 1920,
            height: 1080,
            videoCodec: 'h264',
            audioCodec: 'aac',
            hasVideo: true,
            hasAudio: true,
          },
          {
            formatId: '720p_mp4',
            container: 'mp4',
            resolution: '720p',
            width: 1280,
            height: 720,
            videoCodec: 'h264',
            audioCodec: 'aac',
            hasVideo: true,
            hasAudio: true,
          },
          {
            formatId: 'audio_mp3',
            container: 'mp3',
            audioCodec: 'mp3',
            hasVideo: false,
            hasAudio: true,
          },
        ];

        return {
          platform: 'youtube',
          id: videoId,
          canonicalUrl,
          title: data.title || 'YouTube Media',
          author: data.author_name || 'YouTube Creator',
          durationSeconds: 0,
          thumbnail: data.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          formats: defaultFormats,
          isPlaylist: Boolean(isPlaylist),
          cached: false,
          inspectedAt,
        };
      }
    } catch {
      // Proceed to generic fallback
    }

    return {
      platform: 'youtube',
      id: id || 'youtube_media',
      canonicalUrl,
      title: 'YouTube Media',
      durationSeconds: 0,
      thumbnail: id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : undefined,
      formats: [
        {
          formatId: 'mp4_muxed',
          container: 'mp4',
          resolution: '1080p',
          hasVideo: true,
          hasAudio: true,
        },
      ],
      isPlaylist: Boolean(isPlaylist),
      cached: false,
      inspectedAt,
    };
  }

  if (platform === 'vimeo') {
    const oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(canonicalUrl)}`;
    try {
      const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = (await res.json()) as any;
        return {
          platform: 'vimeo',
          id: String(data.video_id || id || 'vimeo_media'),
          canonicalUrl,
          title: data.title || 'Vimeo Video',
          author: data.author_name || 'Vimeo Author',
          durationSeconds: data.duration || 0,
          thumbnail: data.thumbnail_url,
          formats: [
            {
              formatId: '1080p_mp4',
              container: 'mp4',
              resolution: '1080p',
              hasVideo: true,
              hasAudio: true,
            },
          ],
          isPlaylist: false,
          cached: false,
          inspectedAt,
        };
      }
    } catch {
      // Proceed
    }

    return {
      platform: 'vimeo',
      id: id || 'vimeo_media',
      canonicalUrl,
      title: 'Vimeo Video',
      durationSeconds: 0,
      formats: [
        {
          formatId: '1080p_mp4',
          container: 'mp4',
          resolution: '1080p',
          hasVideo: true,
          hasAudio: true,
        },
      ],
      isPlaylist: false,
      cached: false,
      inspectedAt,
    };
  }

  // Direct media inspection via HEAD
  let title = 'Direct Media Asset';
  let mimeType = 'video/mp4';
  let sizeBytes = 0;

  try {
    const headRes = await fetch(canonicalUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(4000),
    });
    if (headRes.ok) {
      mimeType = headRes.headers.get('content-type') || 'video/mp4';
      sizeBytes = Number.parseInt(headRes.headers.get('content-length') || '0', 10);
      const urlPath = new URL(canonicalUrl).pathname;
      const fileName = urlPath.split('/').pop();
      if (fileName) title = decodeURIComponent(fileName);
    }
  } catch {
    // Keep defaults
  }

  const container = mimeType.includes('audio') ? 'mp3' : 'mp4';
  return {
    platform: 'direct',
    id: computeAnalysisHash(canonicalUrl),
    canonicalUrl,
    title,
    durationSeconds: 0,
    formats: [
      {
        formatId: 'source_file',
        container,
        filesize: sizeBytes > 0 ? sizeBytes : undefined,
        hasVideo: !mimeType.includes('audio'),
        hasAudio: true,
      },
    ],
    isPlaylist: false,
    cached: false,
    inspectedAt,
  };
}

function buildFullAnalysisPayload(result: any, cached: boolean) {
  const formats: MediaFormatInfo[] = Array.isArray(result.formats) ? result.formats : [];

  const videoStreams = formats
    .filter((f) => f.hasVideo ?? Boolean(f.width || f.height || f.resolution || f.videoCodec))
    .map((f, idx) => ({
      streamIndex: idx,
      streamType: 'video' as const,
      formatId: f.formatId,
      codec: f.videoCodec || 'h264',
      width: f.width,
      height: f.height,
      resolutionLabel: f.resolution || (f.height ? `${f.height}p` : undefined),
      fps: f.fps || 30,
      bitrateKbps: f.bitrate ? Math.round(f.bitrate / 1000) : undefined,
      estimatedSizeBytes: f.filesize,
      isStreamCopyCandidate: true,
      recommended: idx === 0 || f.resolution === '1080p' || f.height === 1080,
    }));

  const audioStreams = formats
    .filter((f) => f.hasAudio ?? Boolean(f.audioCodec))
    .map((f, idx) => ({
      streamIndex: videoStreams.length + idx,
      streamType: 'audio' as const,
      formatId: f.formatId,
      codec: f.audioCodec || 'aac',
      bitrateKbps: f.bitrate ? Math.round(f.bitrate / 1000) : 192,
      channels: 2,
      channelLayout: 'stereo',
      sampleRateHz: 48000,
      estimatedSizeBytes: f.filesize,
      isStreamCopyCandidate: true,
    }));

  if (audioStreams.length === 0) {
    audioStreams.push(
      {
        streamIndex: videoStreams.length,
        streamType: 'audio' as const,
        formatId: 'audio_aac',
        codec: 'aac',
        bitrateKbps: 192,
        channels: 2,
        channelLayout: 'stereo',
        sampleRateHz: 48000,
        estimatedSizeBytes: undefined,
        isStreamCopyCandidate: true,
      },
      {
        streamIndex: videoStreams.length + 1,
        streamType: 'audio' as const,
        formatId: 'audio_mp3',
        codec: 'mp3',
        bitrateKbps: 320,
        channels: 2,
        channelLayout: 'stereo',
        sampleRateHz: 48000,
        estimatedSizeBytes: undefined,
        isStreamCopyCandidate: false,
      }
    );
  }

  // Fallback defaults if empty for video platform
  if (videoStreams.length === 0 && (result.platform === 'youtube' || result.platform === 'vimeo')) {
    const defaults = [
      { height: 1080, width: 1920, resolutionLabel: '1080p', formatId: '1080p_mp4', recommended: true },
      { height: 720, width: 1280, resolutionLabel: '720p', formatId: '720p_mp4', recommended: false },
      { height: 480, width: 854, resolutionLabel: '480p', formatId: '480p_mp4', recommended: false },
    ];
    defaults.forEach((d, idx) => {
      videoStreams.push({
        streamIndex: idx,
        streamType: 'video',
        formatId: d.formatId,
        codec: 'h264',
        width: d.width,
        height: d.height,
        resolutionLabel: d.resolutionLabel,
        fps: 30,
        bitrateKbps: undefined,
        estimatedSizeBytes: undefined,
        isStreamCopyCandidate: true,
        recommended: d.recommended,
      });
    });
  }

  const thumbnail =
    result.thumbnail ||
    result.thumbnailUrl ||
    (result.id ? `https://i.ytimg.com/vi/${result.id}/hqdefault.jpg` : undefined);

  return {
    ...result,
    thumbnail,
    thumbnailUrl: thumbnail,
    formats,
    videoStreams,
    audioStreams,
    cached,
  };
}

export const analyseRoutes: FastifyPluginAsync = async (fastify) => {
  const redis = getMuxaroRedis();

  const handleAnalyse = async (request: FastifyRequest, reply: FastifyReply) => {
    // 1. Validate request body
    const parseResult = analyseRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw MuxaroError.invalidPayload('Invalid analysis request payload', {
        errors: parseResult.error.format(),
      });
    }

    const { url: rawUrl, forceRefresh, poToken } = parseResult.data;

    // 2. Validate URL safety (SSRF guard + anti-DNS rebinding) and canonicalize
    const canonicalInfo = await assertSafeMediaUrl(rawUrl, {
      resolveDns: true,
    });

    const { platform, canonicalUrl, id, isPlaylist, listId } = canonicalInfo;
    const hash = computeAnalysisHash(canonicalUrl, id);

    // 3. Cache lookup
    if (!forceRefresh) {
      const cached = await redis.getAnalyseCache(platform, hash);
      if (cached) {
        request.log.info(
          { platform, hash, title: cached.title },
          '[Analyse] Serving analysis from Redis cache'
        );
        const payload = buildFullAnalysisPayload(cached, true);
        return reply.status(200).send({
          success: true,
          data: payload,
          ...payload,
        });
      }
    }

    // 4. Cache miss: Enqueue BullMQ analysis job
    let analysisResult: MediaAnalysisResult | null = null;
    const analyseQueue = getAnalyseQueue();

    try {
      const jobPromise = analyseQueue.add(
        'analyse_metadata',
        {
          platform,
          url: canonicalUrl,
          rawUrl,
          id,
          isPlaylist,
          listId,
          poToken,
          subjectKey: request.subjectKey,
          tier: request.tier,
        },
        {
          priority: request.tier === 'pro' ? 1 : request.tier === 'free_account' ? 5 : 10,
          removeOnComplete: 100,
        }
      );

      const job = await Promise.race([
        jobPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Queue add timeout')), 1000)
        ),
      ]);

      // Await worker completion with 5-second window
      const events = getAnalyseQueueEvents();
      analysisResult = (await Promise.race([
        job.waitUntilFinished(events, 5000),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Worker execution timeout')), 5000)
        ),
      ])) as MediaAnalysisResult;
    } catch (queueErr) {
      request.log.warn(
        { err: queueErr, platform, canonicalUrl },
        '[Analyse] Queue wait timed out or failed. Running resilient oEmbed fallback.'
      );
    }

    // 5. Fallback inspection if queue timed out or worker is inactive
    if (!analysisResult) {
      analysisResult = await fallbackInspect(platform, canonicalUrl, id, isPlaylist);
    }

    // 6. Write back to Redis cache (24-hour TTL)
    try {
      await redis.setAnalyseCache(platform, hash, analysisResult, 86400);
    } catch (cacheErr) {
      request.log.warn({ err: cacheErr }, '[Analyse] Failed to save analysis to Redis cache');
    }

    const payload = buildFullAnalysisPayload(analysisResult, false);
    return reply.status(200).send({
      success: true,
      data: payload,
      ...payload,
    });
  };

  fastify.post('/analyse', handleAnalyse);
  fastify.post('/media/inspect', handleAnalyse);
};
