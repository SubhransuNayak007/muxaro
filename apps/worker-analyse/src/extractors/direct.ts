/**
 * MUXARO Media Processing Platform - Direct Media URL Probe Extractor
 * 
 * Inspects remote media URLs using lightweight HTTP HEAD and Range: bytes=0-131071
 * requests to extract container headers, magic bytes, video/audio codecs,
 * duration, and bitrates without downloading the full media file.
 */

import {
  MuxaroError,
  assertSafeMediaUrl,
  type MediaAnalysisResult,
  type MediaFormatInfo,
  type MediaPlatform,
} from '@muxaro/shared';

export interface DirectProbeOptions {
  maxProbeBytes?: number;
  timeoutMs?: number;
}

export class DirectMediaExtractor {
  private readonly maxProbeBytes: number;
  private readonly timeoutMs: number;

  constructor(options?: DirectProbeOptions) {
    this.maxProbeBytes = options?.maxProbeBytes ?? 131_072; // 128 KB
    this.timeoutMs = options?.timeoutMs ?? 10_000;          // 10s timeout
  }

  /**
   * Probes a direct HTTP/HTTPS media URL and extracts metadata.
   */
  public async extract(rawUrl: string): Promise<MediaAnalysisResult> {
    // 1. SSRF and URL validation
    const canonical = await assertSafeMediaUrl(rawUrl);
    const targetUrl = canonical.canonicalUrl;

    // 2. HTTP HEAD Request to inspect headers
    let headHeaders: Headers;
    let contentLength: number | undefined;
    let contentType: string | undefined;
    let contentDisposition: string | undefined;
    let acceptRanges: boolean = false;

    try {
      const headRes = await fetch(targetUrl, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MuxaroMediaProbe/1.0',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (headRes.ok) {
        headHeaders = headRes.headers;
        contentType = headHeaders.get('content-type') || undefined;
        const cl = headHeaders.get('content-length');
        if (cl && /^\d+$/.test(cl)) {
          contentLength = Number.parseInt(cl, 10);
        }
        contentDisposition = headHeaders.get('content-disposition') || undefined;
        const ar = headHeaders.get('accept-ranges');
        acceptRanges = ar === 'bytes';
      }
    } catch {
      // Some CDN servers refuse HEAD requests; proceed to range GET probe
    }

    // 3. HTTP Range GET request for initial header bytes
    const probeEnd = this.maxProbeBytes - 1;
    let probeBuffer: Buffer | null = null;

    try {
      const getRes = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MuxaroMediaProbe/1.0',
          Range: `bytes=0-${probeEnd}`,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!getRes.ok && getRes.status !== 206) {
        throw new Error(`HTTP probe returned status ${getRes.status}`);
      }

      if (!contentType) {
        contentType = getRes.headers.get('content-type') || undefined;
      }
      if (!contentLength) {
        const cr = getRes.headers.get('content-range'); // e.g. bytes 0-131071/10485760
        if (cr) {
          const match = cr.match(/\/(\d+)$/);
          if (match) contentLength = Number.parseInt(match[1], 10);
        } else {
          const cl = getRes.headers.get('content-length');
          if (cl && /^\d+$/.test(cl)) contentLength = Number.parseInt(cl, 10);
        }
      }
      if (!contentDisposition) {
        contentDisposition = getRes.headers.get('content-disposition') || undefined;
      }

      const arrayBuf = await getRes.arrayBuffer();
      probeBuffer = Buffer.from(arrayBuf);
    } catch (err) {
      throw MuxaroError.extractionFailed(
        `Failed to probe remote media URL: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!probeBuffer || probeBuffer.length === 0) {
      throw MuxaroError.extractionFailed('Remote server returned an empty probe payload');
    }

    // 4. Extract filename from Content-Disposition or URL path
    const title = this.resolveMediaTitle(targetUrl, contentDisposition);

    // 5. Container & Codec Magic-Byte Header Inspection
    const inspection = this.inspectBuffer(probeBuffer, contentType, contentLength);

    const format: MediaFormatInfo = {
      formatId: 'direct-0',
      container: inspection.container,
      resolution: inspection.width && inspection.height ? `${inspection.width}x${inspection.height}` : undefined,
      width: inspection.width,
      height: inspection.height,
      fps: inspection.fps,
      videoCodec: inspection.videoCodec,
      audioCodec: inspection.audioCodec,
      bitrate: inspection.bitrate,
      filesize: contentLength,
      hasVideo: inspection.hasVideo,
      hasAudio: inspection.hasAudio,
      url: targetUrl,
    };

    const result: MediaAnalysisResult = {
      platform: 'direct',
      id: canonical.id || title,
      canonicalUrl: targetUrl,
      title,
      description: `Direct media stream (${inspection.container.toUpperCase()})`,
      durationSeconds: inspection.durationSeconds ?? 0,
      formats: [format],
      isPlaylist: false,
      cached: false,
      inspectedAt: new Date().toISOString(),
    };

    return result;
  }

  /**
   * Resolves media title from Content-Disposition header or URL path segment
   */
  private resolveMediaTitle(url: string, disposition?: string): string {
    if (disposition) {
      const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
      if (match && match[1]) {
        return decodeURIComponent(match[1].trim());
      }
    }

    try {
      const parsed = new URL(url);
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length > 0) {
        const last = decodeURIComponent(segments[segments.length - 1]);
        if (last.length > 0) return last;
      }
    } catch {
      // ignore
    }

    return 'Direct Media Stream';
  }

  /**
   * Inspects magic bytes and headers for MP4/MOV, WebM/MKV, FLAC, MP3, WAV, OGG
   */
  private inspectBuffer(
    buf: Buffer,
    contentType?: string,
    contentLength?: number
  ): {
    container: string;
    videoCodec?: string;
    audioCodec?: string;
    width?: number;
    height?: number;
    fps?: number;
    durationSeconds?: number;
    bitrate?: number;
    hasVideo: boolean;
    hasAudio: boolean;
  } {
    // -------------------------------------------------------------------------
    // A. MP4 / MOV / M4A (ISO Base Media File Format)
    // -------------------------------------------------------------------------
    if (buf.length >= 8) {
      const firstBoxType = buf.toString('ascii', 4, 8);
      if (firstBoxType === 'ftyp' || firstBoxType === 'moov' || firstBoxType === 'mdat') {
        const parsedIso = this.parseIsoBmff(buf);
        const isAudioOnly = parsedIso.container === 'm4a' || (Boolean(parsedIso.audioCodec) && !parsedIso.videoCodec && !parsedIso.width);
        const hasVideo = !isAudioOnly;
        const hasAudio = Boolean(parsedIso.audioCodec || isAudioOnly);

        let duration = parsedIso.durationSeconds;
        let bitrate = undefined;
        if (duration && duration > 0 && contentLength && contentLength > 0) {
          bitrate = Math.round((contentLength * 8) / duration);
        }

        return {
          container: parsedIso.container,
          videoCodec: parsedIso.videoCodec,
          audioCodec: parsedIso.audioCodec,
          width: parsedIso.width,
          height: parsedIso.height,
          durationSeconds: duration,
          bitrate,
          hasVideo,
          hasAudio,
        };
      }
    }

    // -------------------------------------------------------------------------
    // B. WebM / Matroska (EBML: 0x1A45DFA3)
    // -------------------------------------------------------------------------
    if (
      buf.length >= 4 &&
      buf[0] === 0x1a &&
      buf[1] === 0x45 &&
      buf[2] === 0xdf &&
      buf[3] === 0xa3
    ) {
      const isWebm = buf.includes(Buffer.from('webm', 'ascii'));
      const container = isWebm ? 'webm' : 'mkv';

      // Scan for common Matroska codec IDs
      let videoCodec: string | undefined;
      let audioCodec: string | undefined;

      if (buf.includes(Buffer.from('V_VP9', 'ascii'))) videoCodec = 'vp9';
      else if (buf.includes(Buffer.from('V_AV1', 'ascii'))) videoCodec = 'av01';
      else if (buf.includes(Buffer.from('V_VP8', 'ascii'))) videoCodec = 'vp8';
      else if (buf.includes(Buffer.from('V_MPEG4/ISO/AVC', 'ascii'))) videoCodec = 'h264';

      if (buf.includes(Buffer.from('A_OPUS', 'ascii'))) audioCodec = 'opus';
      else if (buf.includes(Buffer.from('A_VORBIS', 'ascii'))) audioCodec = 'vorbis';
      else if (buf.includes(Buffer.from('A_AAC', 'ascii'))) audioCodec = 'aac';

      const hasVideo = Boolean(videoCodec);
      const hasAudio = Boolean(audioCodec || !hasVideo);

      return {
        container,
        videoCodec,
        audioCodec,
        hasVideo,
        hasAudio,
      };
    }

    // -------------------------------------------------------------------------
    // C. FLAC (Magic: 'fLaC')
    // -------------------------------------------------------------------------
    if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'fLaC') {
      let durationSeconds: number | undefined;
      let sampleRate: number | undefined;
      let channels: number = 2;

      // Parse STREAMINFO block if available (starts at byte 4)
      if (buf.length >= 26) {
        // STREAMINFO offset 14..22 contains sample rate, channels, total samples
        const b18 = buf[18];
        const b19 = buf[19];
        const b20 = buf[20];
        sampleRate = (b18 << 12) | (b19 << 4) | (b20 >> 4);
        channels = ((b20 >> 1) & 0x07) + 1;

        const b21 = buf[21];
        const totalSamplesHigh = ((b20 & 0x01) << 32) + (b21 << 24);
        const totalSamplesLow = (buf[22] << 16) | (buf[23] << 8) | buf[24];
        const totalSamples = totalSamplesHigh + totalSamplesLow;

        if (sampleRate > 0 && totalSamples > 0) {
          durationSeconds = Number((totalSamples / sampleRate).toFixed(2));
        }
      }

      let bitrate = undefined;
      if (durationSeconds && durationSeconds > 0 && contentLength) {
        bitrate = Math.round((contentLength * 8) / durationSeconds);
      }

      return {
        container: 'flac',
        audioCodec: 'flac',
        durationSeconds,
        bitrate,
        hasVideo: false,
        hasAudio: true,
      };
    }

    // -------------------------------------------------------------------------
    // D. MP3 (ID3v2 header or MPEG sync frames)
    // -------------------------------------------------------------------------
    if (
      (buf.length >= 3 && buf.toString('ascii', 0, 3) === 'ID3') ||
      (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
    ) {
      let bitrate = 192_000; // Standard nominal fallback
      let durationSeconds: number | undefined;

      // Scan for first sync word 0xFFE0
      for (let i = 0; i < Math.min(buf.length - 4, 4096); i++) {
        if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
          const b2 = buf[i + 2];
          const bitrateIdx = (b2 >> 4) & 0x0f;
          const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
          if (bitrateIdx > 0 && bitrateIdx < bitrates.length) {
            bitrate = bitrates[bitrateIdx] * 1000;
          }
          break;
        }
      }

      if (contentLength && contentLength > 0 && bitrate > 0) {
        durationSeconds = Number(((contentLength * 8) / bitrate).toFixed(2));
      }

      return {
        container: 'mp3',
        audioCodec: 'mp3',
        bitrate,
        durationSeconds,
        hasVideo: false,
        hasAudio: true,
      };
    }

    // -------------------------------------------------------------------------
    // E. WAV (RIFF WAVE)
    // -------------------------------------------------------------------------
    if (
      buf.length >= 12 &&
      buf.toString('ascii', 0, 4) === 'RIFF' &&
      buf.toString('ascii', 8, 12) === 'WAVE'
    ) {
      let durationSeconds: number | undefined;
      let bitrate: number | undefined;

      const fmtIdx = buf.indexOf(Buffer.from('fmt ', 'ascii'));
      if (fmtIdx !== -1 && buf.length >= fmtIdx + 24) {
        const byteRate = buf.readUInt32LE(fmtIdx + 16);
        if (byteRate > 0) {
          bitrate = byteRate * 8;
          if (contentLength && contentLength > 0) {
            durationSeconds = Number((contentLength / byteRate).toFixed(2));
          }
        }
      }

      return {
        container: 'wav',
        audioCodec: 'pcm_s16le',
        bitrate,
        durationSeconds,
        hasVideo: false,
        hasAudio: true,
      };
    }

    // -------------------------------------------------------------------------
    // F. OGG (Magic: 'OggS')
    // -------------------------------------------------------------------------
    if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'OggS') {
      const isOpus = buf.includes(Buffer.from('OpusHead', 'ascii'));
      const isVorbis = buf.includes(Buffer.from('vorbis', 'ascii'));

      return {
        container: 'ogg',
        audioCodec: isOpus ? 'opus' : isVorbis ? 'vorbis' : 'audio',
        hasVideo: false,
        hasAudio: true,
      };
    }

    // -------------------------------------------------------------------------
    // G. MIME Type Fallback
    // -------------------------------------------------------------------------
    let container = 'mp4';
    let hasVideo = true;
    let hasAudio = true;

    if (contentType) {
      const ct = contentType.toLowerCase();
      if (ct.includes('audio/mpeg') || ct.includes('audio/mp3')) {
        container = 'mp3';
        hasVideo = false;
      } else if (ct.includes('audio/flac')) {
        container = 'flac';
        hasVideo = false;
      } else if (ct.includes('audio/wav')) {
        container = 'wav';
        hasVideo = false;
      } else if (ct.includes('video/webm')) {
        container = 'webm';
      } else if (ct.includes('video/x-matroska')) {
        container = 'mkv';
      } else if (ct.includes('video/quicktime')) {
        container = 'mov';
      }
    }

    return {
      container,
      hasVideo,
      hasAudio,
    };
  }

  /**
   * Helper to parse ISO Base Media File Format (MP4/MOV) boxes
   */
  private parseIsoBmff(buf: Buffer): {
    container: string;
    videoCodec?: string;
    audioCodec?: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
  } {
    let container = 'mp4';
    let videoCodec: string | undefined;
    let audioCodec: string | undefined;
    let width: number | undefined;
    let height: number | undefined;
    let durationSeconds: number | undefined;

    let offset = 0;
    while (offset + 8 <= buf.length) {
      const boxSize = buf.readUInt32BE(offset);
      const boxType = buf.toString('ascii', offset + 4, offset + 8);

      if (boxSize < 8) break;

      if (boxType === 'ftyp' && offset + 12 <= buf.length) {
        const majorBrand = buf.toString('ascii', offset + 8, offset + 12);
        if (majorBrand === 'qt  ') container = 'mov';
        else if (majorBrand === 'M4A ') container = 'm4a';
      }

      // Check if moov is within probe buffer
      if (boxType === 'moov' || boxType === 'mvhd' || boxType === 'trak') {
        // Search inside for mvhd to extract timescale and duration
        const mvhdIdx = buf.indexOf(Buffer.from('mvhd', 'ascii'), offset);
        if (mvhdIdx !== -1 && mvhdIdx + 24 <= buf.length) {
          const version = buf[mvhdIdx + 4];
          if (version === 0 && mvhdIdx + 28 <= buf.length) {
            const timescale = buf.readUInt32BE(mvhdIdx + 16);
            const duration = buf.readUInt32BE(mvhdIdx + 20);
            if (timescale > 0) {
              durationSeconds = Number((duration / timescale).toFixed(2));
            }
          }
        }
      }

      offset += boxSize;
    }

    // Inspect codec indicators inside the buffer
    if (buf.includes(Buffer.from('avc1', 'ascii'))) videoCodec = 'avc1';
    else if (buf.includes(Buffer.from('hvc1', 'ascii')) || buf.includes(Buffer.from('hev1', 'ascii')))
      videoCodec = 'hevc';
    else if (buf.includes(Buffer.from('vp09', 'ascii'))) videoCodec = 'vp09';
    else if (buf.includes(Buffer.from('av01', 'ascii'))) videoCodec = 'av01';

    if (buf.includes(Buffer.from('mp4a', 'ascii'))) audioCodec = 'aac';
    else if (buf.includes(Buffer.from('Opus', 'ascii'))) audioCodec = 'opus';

    // Scan for tkhd track dimensions
    const tkhdIdx = buf.indexOf(Buffer.from('tkhd', 'ascii'));
    if (tkhdIdx !== -1 && tkhdIdx + 84 <= buf.length) {
      const w = buf.readUInt32BE(tkhdIdx + 76) >> 16;
      const h = buf.readUInt32BE(tkhdIdx + 80) >> 16;
      if (w > 0 && h > 0 && w < 10000 && h < 10000) {
        width = w;
        height = h;
      }
    }

    return {
      container,
      videoCodec,
      audioCodec,
      width,
      height,
      durationSeconds,
    };
  }
}
