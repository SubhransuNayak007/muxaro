/**
 * Project MUXARO - Media Source Adapter Service
 * Coordinates SSRF defense, real yt-dlp/ffprobe inspection, source adapters, and manifest generation
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  defaultAdapterRegistry,
  classifyMedia,
  deriveTitleFromUrl,
  type MediaManifest,
  type RightsDeclaration,
} from '@vyro/source-adapters';
import { validateUrlForSsrf, validateSafePath } from '@vyro/security';
import type { MediaAssetInfo, MediaStreamItem } from '../types/index.js';

const execFileAsync = promisify(execFile);

/**
 * Isolated root directory for local computer uploads.
 * Every upload writes into <UPLOADS_ROOT>/<assetId>/<safeFilename> and expires after 60 minutes.
 */
export const UPLOADS_ROOT = path.resolve(process.cwd(), '.muxaro-uploads');
const UPLOAD_TTL_MS = 60 * 60 * 1000; // 60 minutes

export function toPublicMediaAssetInfo(asset: MediaAssetInfo): MediaAssetInfo {
  const { localFilePath: _internalPath, ...publicAsset } = asset;
  return publicAsset;
}

interface YtDlpFormat {
  format_id?: string;
  ext?: string;
  vcodec?: string;
  acodec?: string;
  width?: number;
  height?: number;
  fps?: number;
  dynamic_range?: string;
  tbr?: number;
  vbr?: number;
  abr?: number;
  asr?: number;
  audio_channels?: number;
  filesize?: number;
  filesize_approx?: number;
  format_note?: string;
  resolution?: string;
}

interface YtDlpInfoJson {
  id?: string;
  title?: string;
  fulltitle?: string;
  uploader?: string;
  channel?: string;
  creator?: string;
  artist?: string;
  thumbnail?: string;
  thumbnails?: Array<{ url?: string; width?: number; height?: number }>;
  duration?: number;
  filesize?: number;
  filesize_approx?: number;
  ext?: string;
  vcodec?: string;
  acodec?: string;
  width?: number;
  height?: number;
  fps?: number;
  tbr?: number;
  abr?: number;
  asr?: number;
  audio_channels?: number;
  formats?: YtDlpFormat[];
  webpage_url?: string;
}

interface FfprobeOutput {
  format?: {
    filename?: string;
    format_name?: string;
    duration?: string;
    size?: string;
    bit_rate?: string;
    tags?: Record<string, string>;
  };
  streams?: Array<{
    index?: number;
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    avg_frame_rate?: string;
    color_transfer?: string;
    bit_rate?: string;
    sample_rate?: string;
    channels?: number;
  }>;
}

function isHdrDynamicRange(dynamicRange?: string, colorTransfer?: string): boolean {
  const dr = (dynamicRange || '').toUpperCase();
  if (dr && dr !== 'SDR' && (dr.includes('HDR') || dr.includes('HLG') || dr.includes('DV') || dr.includes('DOLBY'))) {
    return true;
  }
  const ct = (colorTransfer || '').toLowerCase();
  return ct === 'smpte2084' || ct === 'arib-std-b67';
}

function getFpsBucket(fps?: number): number {
  return fps && fps >= 50 ? 60 : 30;
}

/**
 * Marks exactly ONE genuinely recommended video stream (prefers 1080p SDR compatible;
 * falls back to highest <=1080p, or highest available if all are >1080p).
 */
function markRecommendedVideoStream(streams: MediaStreamItem[]): MediaStreamItem[] {
  const videoIndices = streams
    .map((s, i) => ({ s, i }))
    .filter((x) => x.s.type === 'VIDEO');
  if (videoIndices.length === 0) return streams;

  const exact1080Sdr = videoIndices.find(
    ({ s }) => (s.height ?? 0) >= 1000 && (s.height ?? 0) <= 1200 && !s.hdr
  );
  const bestAtMost1080 = videoIndices.find(({ s }) => (s.height ?? 0) <= 1200);
  const chosen = exact1080Sdr ?? bestAtMost1080 ?? videoIndices[0];

  return streams.map((s, i) =>
    s.type === 'VIDEO' ? { ...s, recommended: i === chosen.i } : s
  );
}

function normalizeResolutionLabel(height: number): string {
  if (height >= 4320) return '8K (4320p)';
  if (height >= 2160) return '4K (2160p)';
  if (height >= 1440) return '1440p';
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  if (height >= 480) return '480p';
  if (height >= 360) return '360p';
  return `${height}p`;
}

function normalizeHeightBucket(height: number): number {
  if (height >= 4000) return 4320;
  if (height >= 2000) return 2160;
  if (height >= 1350) return 1440;
  if (height >= 1000) return 1080;
  if (height >= 680) return 720;
  if (height >= 450) return 480;
  if (height >= 330) return 360;
  return height;
}

function normalizeContainer(ext?: string): string {
  if (!ext) return 'mp4';
  const cleaned = ext.toLowerCase().trim().replace(/^\./, '');
  const map: Record<string, string> = {
    mp4: 'mp4',
    m4v: 'mp4',
    mov: 'mp4',
    webm: 'webm',
    mkv: 'mkv',
    matroska: 'mkv',
    mp3: 'mp3',
    m4a: 'm4a',
    aac: 'aac',
    flac: 'flac',
    wav: 'wav',
    opus: 'opus',
    ogg: 'opus',
  };
  if (map[cleaned]) return map[cleaned];
  if (cleaned.includes('mp4')) return 'mp4';
  if (cleaned.includes('webm')) return 'webm';
  if (cleaned.includes('matroska') || cleaned.includes('mkv')) return 'mkv';
  return 'mp4';
}

function parseFrameRate(rate?: string): number | undefined {
  if (!rate) return undefined;
  const parts = rate.split('/');
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
      return Math.round((num / den) * 100) / 100;
    }
  }
  const val = Number(rate);
  return Number.isFinite(val) && val > 0 ? Math.round(val * 100) / 100 : undefined;
}

function guessMimeForStream(type: 'VIDEO' | 'AUDIO', codec: string, ext?: string): string {
  const c = codec.toLowerCase();
  const e = (ext || '').toLowerCase();
  if (type === 'AUDIO') {
    if (c.includes('opus') || e === 'opus') return 'audio/opus';
    if (c.includes('flac') || e === 'flac') return 'audio/flac';
    if (c.includes('mp3') || e === 'mp3') return 'audio/mpeg';
    if (c.includes('pcm') || e === 'wav') return 'audio/wav';
    if (c.includes('aac') || c.includes('mp4a') || e === 'm4a') return 'audio/mp4';
    return 'audio/mp4';
  }
  if (e === 'webm' || c.includes('vp9') || c.includes('vp09')) return 'video/webm';
  if (e === 'mkv') return 'video/x-matroska';
  return 'video/mp4';
}

interface RealInspectionResult {
  title: string;
  author?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  fileSizeBytes?: number;
  container: string;
  streams: MediaStreamItem[];
}

export class AdapterService {
  // In-memory cache for inspected assets (assetId -> MediaAssetInfo)
  private readonly assetCache = new Map<string, MediaAssetInfo>();

  /**
   * Inspects a validated URL using yt-dlp --dump-single-json (safe execFile, no shell)
   */
  private async inspectWithYtDlp(rawUrl: string): Promise<RealInspectionResult> {
    const { stdout } = await execFileAsync(
      'yt-dlp',
      [
        '--dump-single-json',
        '--no-warnings',
        '--no-playlist',
        '--no-write-subs',
        '--no-write-auto-subs',
        '--no-cache-dir',
        '--skip-download',
        rawUrl,
      ],
      {
        timeout: 60000,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      }
    );

    const trimmed = stdout.trim();
    if (!trimmed) {
      throw new Error('yt-dlp returned empty inspection output');
    }

    const info = JSON.parse(trimmed) as YtDlpInfoJson;
    const title = info.title || info.fulltitle || deriveTitleFromUrl(rawUrl) || 'Media Stream';
    const author = info.uploader || info.channel || info.artist || info.creator || undefined;
    const thumbnailUrl =
      info.thumbnail ||
      (Array.isArray(info.thumbnails) && info.thumbnails.length > 0
        ? info.thumbnails[info.thumbnails.length - 1]?.url
        : undefined);
    const durationSeconds =
      typeof info.duration === 'number' && Number.isFinite(info.duration) && info.duration > 0
        ? Math.round(info.duration * 10) / 10
        : undefined;

    const formats = Array.isArray(info.formats) ? info.formats : [];

    // Deduplicate video streams strictly by (heightBucket, fpsBucket, hdr)
    // Prefer best-supported compatible variant (MP4/H.264/highest bitrate); NEVER emit duplicate 1080p options.
    const videoByVariant = new Map<string, { bucket: number; fpsBucket: number; hdr: boolean; fmt: YtDlpFormat }>();
    const audioByKey = new Map<string, YtDlpFormat>();

    for (const fmt of formats) {
      const hasVideo = Boolean(fmt.vcodec && fmt.vcodec !== 'none' && fmt.height && fmt.height > 0);
      const hasAudio = Boolean(fmt.acodec && fmt.acodec !== 'none');

      if (hasVideo && fmt.height) {
        const bucket = normalizeHeightBucket(fmt.height);
        const fpsBucket = getFpsBucket(fmt.fps);
        const hdr = isHdrDynamicRange(fmt.dynamic_range);
        const variantKey = `${bucket}:${fpsBucket}:${hdr ? 'hdr' : 'sdr'}`;

        const existing = videoByVariant.get(variantKey);
        const isCompatibleMp4 = fmt.ext === 'mp4' || (fmt.vcodec || '').toLowerCase().startsWith('avc');
        const fmtScore = (fmt.vbr ?? fmt.tbr ?? 0) + (isCompatibleMp4 ? 600 : 0);
        const existingIsMp4 = existing
          ? existing.fmt.ext === 'mp4' || (existing.fmt.vcodec || '').toLowerCase().startsWith('avc')
          : false;
        const existingScore = existing
          ? (existing.fmt.vbr ?? existing.fmt.tbr ?? 0) + (existingIsMp4 ? 600 : 0)
          : -1;
        if (!existing || fmtScore > existingScore) {
          videoByVariant.set(variantKey, { bucket, fpsBucket, hdr, fmt });
        }
      }

      if (hasAudio && !hasVideo) {
        const codecFamily = (fmt.acodec || 'aac').split('.')[0].toLowerCase();
        const existing = audioByKey.get(codecFamily);
        const fmtBr = fmt.abr ?? fmt.tbr ?? 0;
        const existingBr = existing ? (existing.abr ?? existing.tbr ?? 0) : -1;
        if (!existing || fmtBr > existingBr) {
          audioByKey.set(codecFamily, fmt);
        }
      }
    }

    // If no audio-only formats existed (e.g., direct single-file MP4), capture embedded audio from best muxed format
    if (audioByKey.size === 0) {
      const muxedWithAudio = formats.find(
        (f) => f.acodec && f.acodec !== 'none'
      );
      if (muxedWithAudio) {
        const codecFamily = (muxedWithAudio.acodec || 'aac').split('.')[0].toLowerCase();
        audioByKey.set(codecFamily, muxedWithAudio);
      } else if (info.acodec && info.acodec !== 'none') {
        audioByKey.set(info.acodec.split('.')[0].toLowerCase(), {
          format_id: 'audio-default',
          acodec: info.acodec,
          abr: info.abr ?? 128,
          asr: info.asr ?? 48000,
          audio_channels: info.audio_channels ?? 2,
          ext: info.ext,
        });
      }
    }

    // Fallback single video entry from top-level info when formats[] is empty or lacks height
    if (videoByVariant.size === 0 && info.height && info.height > 0) {
      const bucket = normalizeHeightBucket(info.height);
      const fpsBucket = getFpsBucket(info.fps);
      videoByVariant.set(`${bucket}:${fpsBucket}:sdr`, {
        bucket,
        fpsBucket,
        hdr: false,
        fmt: {
          format_id: 'best',
          ext: info.ext,
          vcodec: info.vcodec || 'h264',
          acodec: info.acodec,
          width: info.width,
          height: info.height,
          fps: info.fps,
          tbr: info.tbr,
          filesize: info.filesize ?? info.filesize_approx,
        },
      });
    }

    // Sort audio tracks descending by bitrate so we can estimate combined audio overhead
    const sortedAudios = Array.from(audioByKey.values()).sort(
      (a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0)
    );
    const bestAudioFmt = sortedAudios[0];
    const bestAudioSize =
      bestAudioFmt?.filesize ??
      bestAudioFmt?.filesize_approx ??
      (durationSeconds && (bestAudioFmt?.abr || bestAudioFmt?.tbr)
        ? Math.round(((bestAudioFmt.abr ?? bestAudioFmt.tbr ?? 128) * 1000 * durationSeconds) / 8)
        : 0);

    const streams: MediaStreamItem[] = [];
    let streamIdx = 0;

    // Sort video variants descending by height, then fpsBucket desc, then HDR desc
    const sortedVideos = Array.from(videoByVariant.values()).sort((a, b) => {
      if (b.bucket !== a.bucket) return b.bucket - a.bucket;
      if (b.fpsBucket !== a.fpsBucket) return b.fpsBucket - a.fpsBucket;
      return Number(b.hdr) - Number(a.hdr);
    });

    for (const { bucket, hdr, fmt } of sortedVideos) {
      const height = fmt.height || bucket;
      const width = fmt.width || Math.round((height * 16) / 9);
      const kbps = fmt.vbr ?? fmt.tbr ?? (height >= 2160 ? 18000 : height >= 1080 ? 5000 : 2500);
      const codec = fmt.vcodec && fmt.vcodec !== 'none' ? fmt.vcodec : 'h264';
      const hasExactVideoSize = typeof fmt.filesize === 'number' && fmt.filesize > 0;
      const hasAudioTrackIncluded = Boolean(fmt.acodec && fmt.acodec !== 'none');
      let estimatedSizeBytes: number | undefined;
      let sizeIsEstimate = true;
      if (hasExactVideoSize) {
        estimatedSizeBytes = fmt.filesize! + (hasAudioTrackIncluded ? 0 : bestAudioSize);
        sizeIsEstimate = !hasAudioTrackIncluded && !(bestAudioFmt?.filesize && bestAudioFmt.filesize > 0);
      } else if (typeof fmt.filesize_approx === 'number' && fmt.filesize_approx > 0) {
        estimatedSizeBytes = fmt.filesize_approx + (hasAudioTrackIncluded ? 0 : bestAudioSize);
        sizeIsEstimate = true;
      } else if (durationSeconds && (fmt.vbr || fmt.tbr)) {
        estimatedSizeBytes = Math.round(((fmt.vbr ?? fmt.tbr ?? 0) * 1000 * durationSeconds) / 8) + (hasAudioTrackIncluded ? 0 : bestAudioSize);
        sizeIsEstimate = true;
      }

      streams.push({
        index: streamIdx++,
        formatId: fmt.format_id,
        type: 'VIDEO',
        codec,
        width,
        height,
        resolution: normalizeResolutionLabel(height),
        bitrate: Math.round(kbps * 1000),
        fps: fmt.fps ? Math.round(fmt.fps) : undefined,
        hdr,
        estimatedSizeBytes,
        sizeIsEstimate,
        recommended: false,
        isNativeLossless: false,
        mimeType: guessMimeForStream('VIDEO', codec, fmt.ext),
        isExtractable: true,
      });
    }

    for (const fmt of sortedAudios) {
      const codec = fmt.acodec && fmt.acodec !== 'none' ? fmt.acodec : 'aac';
      const kbps = fmt.abr ?? fmt.tbr ?? 128;
      const hasExactSize = typeof fmt.filesize === 'number' && fmt.filesize > 0;
      const estimatedSizeBytes =
        hasExactSize
          ? fmt.filesize
          : fmt.filesize_approx ??
            (durationSeconds ? Math.round((kbps * 1000 * durationSeconds) / 8) : undefined);
      streams.push({
        index: streamIdx++,
        formatId: fmt.format_id,
        type: 'AUDIO',
        codec,
        bitrate: Math.round(kbps * 1000),
        estimatedSizeBytes,
        sizeIsEstimate: !hasExactSize,
        sampleRate: fmt.asr || 48000,
        channels: fmt.audio_channels || 2,
        isNativeLossless: ['flac', 'wav', 'alac', 'pcm'].some((l) => codec.toLowerCase().includes(l)),
        mimeType: guessMimeForStream('AUDIO', codec, fmt.ext),
        isExtractable: true,
      });
    }

    const normalizedStreams = markRecommendedVideoStream(streams);

    // Compute realistic best fileSizeBytes estimate
    const bestVideoFmt = sortedVideos[0]?.fmt;
    let fileSizeBytes = info.filesize || info.filesize_approx;
    if (!fileSizeBytes && bestVideoFmt) {
      const vSize = bestVideoFmt.filesize || bestVideoFmt.filesize_approx || 0;
      const aSize = bestAudioFmt?.filesize || bestAudioFmt?.filesize_approx || 0;
      if (vSize + aSize > 0) {
        fileSizeBytes = vSize + aSize;
      } else if (durationSeconds && (bestVideoFmt.tbr || bestVideoFmt.vbr)) {
        const totalKbps = (bestVideoFmt.vbr ?? bestVideoFmt.tbr ?? 2500) + (bestAudioFmt?.abr ?? 128);
        fileSizeBytes = Math.round((totalKbps * 1000 * durationSeconds) / 8);
      }
    }

    return {
      title,
      author,
      thumbnailUrl,
      durationSeconds,
      fileSizeBytes,
      container: normalizeContainer(info.ext || bestVideoFmt?.ext),
      streams: normalizedStreams,
    };
  }

  /**
   * Fallback inspection for direct media file URLs using ffprobe (safe execFile, no shell)
   */
  private async inspectWithFfprobe(rawUrl: string): Promise<RealInspectionResult> {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        rawUrl,
      ],
      {
        timeout: 15000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      }
    );

    const probe = JSON.parse(stdout) as FfprobeOutput;
    if (!probe.streams || probe.streams.length === 0) {
      throw new Error('ffprobe detected no playable streams');
    }

    const streams: MediaStreamItem[] = [];
    let idx = 0;
    for (const s of probe.streams) {
      if (s.codec_type === 'video') {
        const height = s.height || 1080;
        const width = s.width || Math.round((height * 16) / 9);
        const bitrate = s.bit_rate ? Number(s.bit_rate) : probe.format?.bit_rate ? Number(probe.format.bit_rate) : undefined;
        streams.push({
          index: idx++,
          type: 'VIDEO',
          codec: s.codec_name || 'h264',
          width,
          height,
          resolution: normalizeResolutionLabel(height),
          bitrate: bitrate && Number.isFinite(bitrate) ? bitrate : undefined,
          fps: parseFrameRate(s.avg_frame_rate || s.r_frame_rate),
          hdr: isHdrDynamicRange(undefined, s.color_transfer),
          isNativeLossless: false,
          mimeType: guessMimeForStream('VIDEO', s.codec_name || 'h264', probe.format?.format_name),
          isExtractable: true,
        });
      } else if (s.codec_type === 'audio') {
        const bitrate = s.bit_rate ? Number(s.bit_rate) : 128000;
        const codec = s.codec_name || 'aac';
        streams.push({
          index: idx++,
          type: 'AUDIO',
          codec,
          bitrate: Number.isFinite(bitrate) ? bitrate : 128000,
          sampleRate: s.sample_rate ? Number(s.sample_rate) : 48000,
          channels: s.channels || 2,
          isNativeLossless: ['flac', 'pcm_s16le', 'pcm_s24le', 'wav'].includes(codec.toLowerCase()),
          mimeType: guessMimeForStream('AUDIO', codec),
          isExtractable: true,
        });
      }
    }

    const durationVal = probe.format?.duration ? Number(probe.format.duration) : undefined;
    const sizeVal = probe.format?.size ? Number(probe.format.size) : undefined;
    const formatName = probe.format?.format_name?.split(',')[0];

    const enrichedStreams = markRecommendedVideoStream(
      streams.map((s) =>
        s.type === 'VIDEO'
          ? {
              ...s,
              estimatedSizeBytes: sizeVal && Number.isFinite(sizeVal) ? sizeVal : undefined,
              sizeIsEstimate: !(sizeVal && Number.isFinite(sizeVal)),
            }
          : s
      )
    );

    return {
      title: probe.format?.tags?.title || deriveTitleFromUrl(rawUrl) || 'Direct Media Asset',
      author: probe.format?.tags?.artist || probe.format?.tags?.author || undefined,
      durationSeconds: durationVal && Number.isFinite(durationVal) ? Math.round(durationVal * 10) / 10 : undefined,
      fileSizeBytes: sizeVal && Number.isFinite(sizeVal) ? sizeVal : undefined,
      container: normalizeContainer(formatName),
      streams: enrichedStreams,
    };
  }

  /**
   * Performs SSRF check and real media inspection via yt-dlp -> ffprobe -> source-adapters fallback
   */
  public async inspect(
    rawUrl: string,
    rightsDeclared: boolean = true,
    userDeclaration?: RightsDeclaration
  ): Promise<MediaAssetInfo> {
    // 1. Strict SSRF Defense
    const ssrfResult = await validateUrlForSsrf(rawUrl);
    if (!ssrfResult.isSafe) {
      const err = new Error(ssrfResult.error || 'Target URL blocked by security policy');
      (err as any).statusCode = 403;
      (err as any).code = 'SSRF_BLOCKED';
      (err as any).details = {
        hostname: ssrfResult.hostname,
        resolvedIps: ssrfResult.resolvedIps,
        reason: ssrfResult.reason,
      };
      throw err;
    }

    // 2. Real URL inspection: yt-dlp -> ffprobe -> defaultAdapterRegistry fallback
    let realInfo: RealInspectionResult | null = null;
    let lastInspectError: unknown = null;

    try {
      realInfo = await this.inspectWithYtDlp(rawUrl);
      // For direct media URLs, yt-dlp's generic extractor often omits stream/duration metadata; enrich via ffprobe
      if (realInfo.streams.length === 0 || !realInfo.durationSeconds) {
        try {
          const probed = await this.inspectWithFfprobe(rawUrl);
          realInfo = {
            ...realInfo,
            durationSeconds: realInfo.durationSeconds ?? probed.durationSeconds,
            fileSizeBytes: realInfo.fileSizeBytes ?? probed.fileSizeBytes,
            container: realInfo.container || probed.container,
            streams: realInfo.streams.length > 0 ? realInfo.streams : probed.streams,
          };
        } catch {
          // Keep yt-dlp result if ffprobe cannot directly probe webpage/HLS URL
        }
      }
    } catch (ytErr) {
      lastInspectError = ytErr;
      try {
        realInfo = await this.inspectWithFfprobe(rawUrl);
      } catch (probeErr) {
        lastInspectError = probeErr;
      }
    }

    // Fallback to source-adapters registry if both yt-dlp and ffprobe failed
    if (!realInfo) {
      let manifest: MediaManifest | null = null;
      try {
        manifest = await defaultAdapterRegistry.inspectUrl(rawUrl);
      } catch (adapterErr: any) {
        const classification = classifyMedia(undefined, rawUrl);
        if (classification) {
          const fallbackStreams: MediaStreamItem[] = [
            {
              index: 0,
              type: classification.isVideo ? 'VIDEO' : 'AUDIO',
              codec: classification.defaultVideoCodec || classification.defaultAudioCodec || 'h264',
              resolution: classification.isVideo ? '1080p' : undefined,
              width: classification.isVideo ? 1920 : undefined,
              height: classification.isVideo ? 1080 : undefined,
              mimeType: classification.canonicalMime,
              isExtractable: true,
            },
          ];
          if (classification.isVideo) {
            fallbackStreams.push({
              index: 1,
              type: 'AUDIO',
              codec: classification.defaultAudioCodec || 'aac',
              sampleRate: 48000,
              channels: 2,
              mimeType: 'audio/mp4',
              isExtractable: true,
            });
          }
          realInfo = {
            title: deriveTitleFromUrl(rawUrl) || 'Media Asset',
            container: classification.container,
            streams: fallbackStreams,
          };
        } else {
          const message =
            (lastInspectError instanceof Error ? lastInspectError.message : undefined) ||
            adapterErr?.message ||
            'Failed to inspect media URL';
          const wrapped = new Error(message);
          (wrapped as any).statusCode = 422;
          (wrapped as any).code = 'ERR_INSPECTION_FAILED';
          throw wrapped;
        }
      }

      if (!realInfo && manifest) {
        realInfo = {
          title: manifest.title || deriveTitleFromUrl(rawUrl) || 'Media Stream',
          thumbnailUrl: manifest.thumbnailUrl,
          durationSeconds: manifest.durationSeconds,
          container: manifest.container || 'mp4',
          streams: manifest.streams.map((stream, idx) => ({
            index: idx,
            type: stream.streamType === 'audio' ? 'AUDIO' : 'VIDEO',
            codec: stream.codec || (stream.streamType === 'audio' ? 'aac' : 'h264'),
            width: stream.width,
            height: stream.height,
            resolution: stream.resolution || (stream.height ? normalizeResolutionLabel(stream.height) : undefined),
            bitrate: stream.bitrateBps,
            fps: stream.fps,
            isNativeLossless: stream.streamType === 'audio' ? ['flac', 'wav'].includes(stream.codec || '') : false,
            mimeType: stream.mimeType,
            isExtractable: true,
          })),
        };
      }
    }

    if (!realInfo) {
      throw new Error('Failed to inspect media URL');
    }

    // 3. Evaluate Rights: when rightsDeclared is true and SSRF passed, permit extraction
    const baseRights = await defaultAdapterRegistry.checkRights(rawUrl, userDeclaration);
    const canExtractStreams = rightsDeclared ? true : baseRights.canExtractStreams;
    const isPermitted = rightsDeclared ? true : baseRights.isPermitted;
    const canPreview = rightsDeclared ? true : baseRights.canPreview;

    const streamItems: MediaStreamItem[] = markRecommendedVideoStream(
      realInfo.streams.map((s) => ({
        ...s,
        isExtractable: canExtractStreams,
      }))
    );

    const videoResolutions = Array.from(
      new Set(
        streamItems
          .filter((s) => s.type === 'VIDEO' && s.resolution)
          .map((s) => s.resolution as string)
      )
    );

    const audioFormats = ['mp3', 'm4a', 'aac', 'opus', 'wav', 'flac'];

    const assetId = crypto.randomUUID();
    const assetInfo: MediaAssetInfo = {
      assetId,
      url: rawUrl,
      title: realInfo.title,
      author: realInfo.author,
      thumbnailUrl: realInfo.thumbnailUrl,
      durationSeconds: realInfo.durationSeconds,
      fileSizeBytes: realInfo.fileSizeBytes,
      container: realInfo.container,
      streams: streamItems,
      availableFormats: {
        videoResolutions,
        audioFormats,
      },
      rightsCheck: {
        isPermitted,
        policyCode: canExtractStreams && !baseRights.canExtractStreams
          ? 'USER_RIGHTS_DECLARED'
          : baseRights.policyCode,
        canExtractStreams,
        canPreview,
        reason: canExtractStreams && !baseRights.canExtractStreams
          ? 'User declared processing rights; media pipeline enabled.'
          : baseRights.reason,
        warnings: baseRights.warnings || [],
      },
      inspectedAt: new Date().toISOString(),
    };

    // Cache the inspected asset
    this.assetCache.set(assetId, assetInfo);

    return assetInfo;
  }

  /**
   * Probing helper for local files using ffprobe with strict local file protocol whitelist
   */
  private async probeLocalFile(localFilePath: string, originalName: string): Promise<RealInspectionResult> {
    const stat = await fsp.stat(localFilePath);
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        '-protocol_whitelist',
        'file,crypto,data',
        localFilePath,
      ],
      {
        timeout: 20000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      }
    );

    const probe = JSON.parse(stdout) as FfprobeOutput;
    const rawStreams = Array.isArray(probe.streams) ? probe.streams : [];
    const streams: MediaStreamItem[] = [];
    let idx = 0;

    for (const s of rawStreams) {
      if (s.codec_type === 'video') {
        const height = s.height || 1080;
        const width = s.width || Math.round((height * 16) / 9);
        const bitrate = s.bit_rate
          ? Number(s.bit_rate)
          : probe.format?.bit_rate
          ? Number(probe.format.bit_rate)
          : undefined;
        streams.push({
          index: idx++,
          type: 'VIDEO',
          codec: s.codec_name || 'h264',
          width,
          height,
          resolution: normalizeResolutionLabel(height),
          bitrate: bitrate && Number.isFinite(bitrate) ? bitrate : undefined,
          fps: parseFrameRate(s.avg_frame_rate || s.r_frame_rate),
          hdr: isHdrDynamicRange(undefined, s.color_transfer),
          estimatedSizeBytes: stat.size,
          sizeIsEstimate: false,
          isNativeLossless: false,
          mimeType: guessMimeForStream('VIDEO', s.codec_name || 'h264', probe.format?.format_name),
          isExtractable: true,
        });
      } else if (s.codec_type === 'audio') {
        const bitrate = s.bit_rate ? Number(s.bit_rate) : 128000;
        const codec = s.codec_name || 'aac';
        streams.push({
          index: idx++,
          type: 'AUDIO',
          codec,
          bitrate: Number.isFinite(bitrate) ? bitrate : 128000,
          sampleRate: s.sample_rate ? Number(s.sample_rate) : 48000,
          channels: s.channels || 2,
          isNativeLossless: ['flac', 'pcm_s16le', 'pcm_s24le', 'wav'].includes(codec.toLowerCase()),
          mimeType: guessMimeForStream('AUDIO', codec),
          isExtractable: true,
        });
      }
    }

    if (streams.length === 0) {
      const err = new Error('Uploaded file contains no playable video or audio streams');
      (err as any).statusCode = 422;
      (err as any).code = 'ERR_INVALID_MEDIA_FILE';
      throw err;
    }

    const durationVal = probe.format?.duration ? Number(probe.format.duration) : undefined;
    const extFromName = path.extname(originalName).replace(/^\./, '');
    const formatName = extFromName || probe.format?.format_name?.split(',')[0];
    const cleanTitle =
      probe.format?.tags?.title?.trim() ||
      path.basename(originalName, path.extname(originalName)).trim() ||
      'Uploaded Media';

    return {
      title: cleanTitle,
      author: probe.format?.tags?.artist || probe.format?.tags?.author || 'Uploaded from computer',
      durationSeconds:
        durationVal !== undefined && Number.isFinite(durationVal) && durationVal > 0
          ? Math.round(durationVal * 10) / 10
          : undefined,
      fileSizeBytes: stat.size,
      container: normalizeContainer(formatName),
      streams: markRecommendedVideoStream(streams),
    };
  }

  /**
   * Registers a locally uploaded media file, probes it via ffprobe, caches it, and schedules 60-min cleanup.
   */
  public async registerLocalUpload(params: {
    assetId: string;
    localFilePath: string;
    originalName: string;
  }): Promise<MediaAssetInfo> {
    fs.mkdirSync(UPLOADS_ROOT, { recursive: true });
    const pathCheck = validateSafePath(params.localFilePath, [UPLOADS_ROOT], { mustExist: true });
    if (!pathCheck.isSafe || !pathCheck.resolvedPath) {
      const err = new Error('Invalid local upload path');
      (err as any).statusCode = 400;
      (err as any).code = 'ERR_INVALID_UPLOAD_PATH';
      throw err;
    }

    const probed = await this.probeLocalFile(pathCheck.resolvedPath, params.originalName);

    const videoResolutions = Array.from(
      new Set(
        probed.streams
          .filter((s) => s.type === 'VIDEO' && s.resolution)
          .map((s) => s.resolution as string)
      )
    );
    const audioFormats = ['mp3', 'm4a', 'aac', 'opus', 'wav', 'flac'];

    const assetInfo: MediaAssetInfo = {
      assetId: params.assetId,
      url: `upload://${params.assetId}`,
      title: probed.title,
      author: probed.author,
      durationSeconds: probed.durationSeconds,
      fileSizeBytes: probed.fileSizeBytes,
      container: probed.container,
      isLocalUpload: true,
      localFilePath: pathCheck.resolvedPath,
      streams: probed.streams,
      availableFormats: {
        videoResolutions,
        audioFormats,
      },
      rightsCheck: {
        isPermitted: true,
        policyCode: 'LOCAL_USER_UPLOAD',
        canExtractStreams: true,
        canPreview: true,
        reason: 'Local file uploaded by user.',
        warnings: [],
      },
      inspectedAt: new Date().toISOString(),
    };

    this.assetCache.set(params.assetId, assetInfo);

    // Schedule automatic cleanup after 60 minutes
    const uploadDir = path.join(UPLOADS_ROOT, params.assetId);
    setTimeout(() => {
      this.assetCache.delete(params.assetId);
      fsp.rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    }, UPLOAD_TTL_MS).unref();

    return assetInfo;
  }

  /**
   * Retrieves previously inspected media asset by assetId
   */
  public getAsset(assetId: string): MediaAssetInfo | undefined {
    return this.assetCache.get(assetId);
  }
}

export const adapterService = new AdapterService();
