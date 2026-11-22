import type { MediaManifest, MediaStream } from './types';

const PREF_STORAGE_KEY = 'muxaro-preferred-height';

export interface NormalizedVideoOption {
  id: string;
  height: number;
  width?: number;
  resolutionLabel: string;
  qualityName: string;
  fps?: number;
  fpsBadge?: string;
  hdr: boolean;
  codec: string;
  formatId?: string;
  estimatedSizeBytes?: number;
  sizeIsEstimate: boolean;
  recommended: boolean;
  isStreamCopyCandidate: boolean;
  stream: MediaStream;
}

export interface NormalizedAudioTrack {
  id: string;
  streamIndex: number;
  label: string;
  codec: string;
  bitrateKbps: number;
  sampleRateHz?: number;
  channels?: number;
  channelLayout?: string;
  isNativeLossless: boolean;
  estimatedSizeBytes?: number;
  sizeIsEstimate: boolean;
  stream: MediaStream;
}

function parseHeight(stream: MediaStream): number {
  if (typeof stream?.height === 'number' && Number.isFinite(stream.height) && stream.height > 0) {
    return Math.round(stream.height);
  }
  const label = String(stream?.resolutionLabel || '').toLowerCase();
  if (label.includes('8k') || label.includes('4320')) return 4320;
  if (label.includes('4k') || label.includes('2160')) return 2160;
  if (label.includes('1440')) return 1440;
  if (label.includes('1080')) return 1080;
  if (label.includes('720')) return 720;
  if (label.includes('480')) return 480;
  if (label.includes('360')) return 360;
  if (label.includes('240')) return 240;
  const match = label.match(/(\d{3,4})p/);
  if (match) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function getQualityName(height: number): string {
  if (height >= 4320) return '8K Ultra HD';
  if (height >= 2160) return 'Ultra HD';
  if (height >= 1440) return 'Quad HD';
  if (height >= 1080) return 'Full HD';
  if (height >= 720) return 'HD';
  if (height >= 480) return 'Standard';
  if (height > 0) return 'Compact';
  return 'Original';
}

function detectHdr(stream: MediaStream): boolean {
  if (typeof stream?.hdr === 'boolean') return stream.hdr;
  const text = `${stream?.codec || ''} ${stream?.resolutionLabel || ''} ${stream?.notes || ''}`.toLowerCase();
  if (text.includes('hdr') || text.includes('hlg') || text.includes('bt2020')) return true;
  // AV1 / VP9 10-bit HDR profiles when explicitly encoded in codec tag
  if (/vp09\.02\./i.test(text) || /av01\.0\.\d+m\.10\./i.test(text)) return true;
  return false;
}

function getFpsValue(stream: MediaStream): number | undefined {
  const raw =
    typeof stream?.fps === 'number' && Number.isFinite(stream.fps)
      ? stream.fps
      : typeof stream?.frameRate === 'number' && Number.isFinite(stream.frameRate)
      ? stream.frameRate
      : undefined;
  return raw && raw > 0 ? Math.round(raw) : undefined;
}

function getFpsBucket(fps: number | undefined): number {
  if (!fps || fps <= 35) return 30;
  if (fps <= 55) return 50;
  if (fps <= 65) return 60;
  return Math.round(fps / 10) * 10;
}

function scoreCompatibility(stream: MediaStream): number {
  let score = 0;
  const codec = String(stream?.codec || '').toLowerCase();
  if (stream?.recommended) score += 25;
  if (stream?.isStreamCopyCandidate) score += 15;
  // Prefer universally playable H.264/AVC1 when deduplicating identical (height, fps, hdr)
  if (codec.includes('avc') || codec.includes('h264')) score += 12;
  else if (codec.includes('hevc') || codec.includes('hvc1') || codec.includes('h265')) score += 8;
  else if (codec.includes('vp9') || codec.includes('vp09')) score += 6;
  else if (codec.includes('av01') || codec.includes('av1')) score += 5;
  if (typeof stream?.bitrateKbps === 'number' && stream.bitrateKbps > 0) {
    score += Math.min(5, stream.bitrateKbps / 5000);
  }
  return score;
}

function computeStreamSize(
  stream: MediaStream,
  manifest: MediaManifest,
  totalVideoCount: number
): { bytes?: number; isEstimate: boolean } {
  if (
    typeof stream?.estimatedSizeBytes === 'number' &&
    Number.isFinite(stream.estimatedSizeBytes) &&
    stream.estimatedSizeBytes > 0
  ) {
    return {
      bytes: Math.round(stream.estimatedSizeBytes),
      isEstimate: Boolean(stream.sizeIsEstimate ?? true),
    };
  }

  const duration =
    typeof manifest?.durationSeconds === 'number' && Number.isFinite(manifest.durationSeconds)
      ? manifest.durationSeconds
      : 0;
  const bitrateKbps =
    typeof stream?.bitrateKbps === 'number' && Number.isFinite(stream.bitrateKbps)
      ? stream.bitrateKbps
      : 0;

  // If this is a single-stream file (e.g. local computer upload or direct MP4), real container size is exact
  if (
    totalVideoCount === 1 &&
    typeof manifest?.fileSizeBytes === 'number' &&
    Number.isFinite(manifest.fileSizeBytes) &&
    manifest.fileSizeBytes > 0
  ) {
    return { bytes: Math.round(manifest.fileSizeBytes), isEstimate: false };
  }

  if (bitrateKbps > 0 && duration > 0) {
    // Include modest ~128 kbps audio allowance for combined video estimate
    const totalKbps = bitrateKbps + 128;
    const estBytes = Math.round(((totalKbps * 1000) / 8) * duration);
    if (estBytes > 0) {
      return { bytes: estBytes, isEstimate: true };
    }
  }

  return { bytes: undefined, isEstimate: true };
}

export function getSavedQualityPreference(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PREF_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 144 && parsed <= 4320 ? parsed : null;
  } catch {
    return null;
  }
}

export function saveQualityPreference(height: number): void {
  if (typeof window === 'undefined') return;
  if (!Number.isFinite(height) || height < 144) return;
  try {
    window.localStorage.setItem(PREF_STORAGE_KEY, String(Math.round(height)));
  } catch {
    // Ignore storage quota or private mode errors
  }
}

/**
 * Pure, deterministic video stream normalizer.
 * - Deduplicates by (height, fpsBucket, hdr) so duplicate 1080p entries never appear.
 * - Only exposes resolutions actually supported by the inspected source.
 * - Exposes fpsBadge ONLY when >30fps and genuinely distinct/high-framerate.
 * - Exposes hdr ONLY when actually supported.
 * - Picks EXACTLY ONE recommended option.
 */
export function normalizeVideoOptions(
  manifest: MediaManifest | null | undefined,
  preferredHeight?: number | null
): NormalizedVideoOption[] {
  const rawStreams = Array.isArray(manifest?.videoStreams) ? manifest.videoStreams : [];
  if (!manifest || rawStreams.length === 0) return [];

  // Step 1: Group by (height, fpsBucket, hdr) and pick best-compatible variant per bucket
  const buckets = new Map<string, { stream: MediaStream; height: number; fps?: number; fpsBucket: number; hdr: boolean }>();

  for (const stream of rawStreams) {
    if (!stream || typeof stream !== 'object') continue;
    const height = parseHeight(stream);
    const fps = getFpsValue(stream);
    const fpsBucket = getFpsBucket(fps);
    const hdr = detectHdr(stream);
    const key = `${height}-${fpsBucket}-${hdr ? 'hdr' : 'sdr'}`;

    const existing = buckets.get(key);
    if (!existing || scoreCompatibility(stream) > scoreCompatibility(existing.stream)) {
      buckets.set(key, { stream, height, fps, fpsBucket, hdr });
    }
  }

  const deduped = Array.from(buckets.values());
  if (deduped.length === 0) return [];

  // Track which heights have multiple distinct fps buckets so we know when fps is distinct
  const fpsBucketsByHeight = new Map<number, Set<number>>();
  for (const item of deduped) {
    const set = fpsBucketsByHeight.get(item.height) || new Set<number>();
    set.add(item.fpsBucket);
    fpsBucketsByHeight.set(item.height, set);
  }

  // Step 2: Sort highest resolution first, then HDR, then higher fps
  deduped.sort((a, b) => {
    if (b.height !== a.height) return b.height - a.height;
    if (a.hdr !== b.hdr) return a.hdr ? -1 : 1;
    return b.fpsBucket - a.fpsBucket;
  });

  // Step 3: Build normalized option objects
  const options: NormalizedVideoOption[] = deduped.map((item, idx) => {
    const { stream, height, fps, fpsBucket, hdr } = item;
    const resolutionLabel =
      height >= 4320
        ? '8K'
        : height >= 2160
        ? '4K'
        : height >= 1440
        ? '1440p'
        : height > 0
        ? `${height}p`
        : String(stream.resolutionLabel || 'Original');
    const distinctFpsCount = (fpsBucketsByHeight.get(height) || new Set()).size;
    const showHighFps = Boolean(fps && fps > 35 && (distinctFpsCount > 1 || fps >= 50));
    const sizeInfo = computeStreamSize(stream, manifest, deduped.length);

    return {
      id: `v-${height}-${fpsBucket}-${hdr ? 'hdr' : 'sdr'}-${idx}`,
      height,
      width: typeof stream.width === 'number' && stream.width > 0 ? stream.width : undefined,
      resolutionLabel,
      qualityName: getQualityName(height),
      fps: showHighFps ? fps : undefined,
      fpsBadge: showHighFps ? `${fpsBucket}fps` : undefined,
      hdr,
      codec: String(stream.codec || 'h264'),
      formatId: stream.formatId,
      estimatedSizeBytes: sizeInfo.bytes,
      sizeIsEstimate: sizeInfo.isEstimate,
      recommended: false,
      isStreamCopyCandidate: Boolean(stream.isStreamCopyCandidate),
      stream,
    };
  });

  // Step 4: Calculate EXACTLY ONE genuine recommended choice
  let recommendedIdx = -1;

  // 1) Match saved user preference if available in source
  if (typeof preferredHeight === 'number' && preferredHeight > 0) {
    recommendedIdx = options.findIndex((o) => o.height === preferredHeight && !o.hdr);
    if (recommendedIdx === -1) {
      recommendedIdx = options.findIndex((o) => o.height === preferredHeight);
    }
  }

  // 2) Respect explicit backend recommendation if present
  if (recommendedIdx === -1) {
    recommendedIdx = options.findIndex((o) => Boolean(o.stream.recommended));
  }

  // 3) Prefer 1080p SDR for ideal balance of quality, size, and universal compatibility
  if (recommendedIdx === -1) {
    recommendedIdx = options.findIndex((o) => o.height === 1080 && !o.hdr);
  }
  if (recommendedIdx === -1) {
    recommendedIdx = options.findIndex((o) => o.height === 1080);
  }

  // 4) Otherwise highest resolution <= 1080p, or first available option
  if (recommendedIdx === -1) {
    recommendedIdx = options.findIndex((o) => o.height > 0 && o.height <= 1080);
  }
  if (recommendedIdx === -1) {
    recommendedIdx = 0;
  }

  if (options[recommendedIdx]) {
    options[recommendedIdx].recommended = true;
  }

  return options;
}

function isLosslessAudioCodec(codec: string): boolean {
  const lower = codec.toLowerCase();
  return (
    lower.includes('flac') ||
    lower.includes('alac') ||
    lower.includes('pcm') ||
    lower.includes('wav')
  );
}

/**
 * Pure audio track normalizer.
 * Only exposes multiple tracks when genuinely distinct tracks exist in the source.
 */
export function normalizeAudioOptions(
  manifest: MediaManifest | null | undefined
): NormalizedAudioTrack[] {
  const rawAudio = Array.isArray(manifest?.audioStreams) ? manifest.audioStreams : [];
  if (!manifest || rawAudio.length === 0) return [];

  const seen = new Set<string>();
  const tracks: NormalizedAudioTrack[] = [];

  rawAudio.forEach((stream, idx) => {
    if (!stream || typeof stream !== 'object') return;
    const codec = String(stream.codec || 'aac');
    const layout =
      stream.channelLayout ||
      (stream.channels === 6 ? '5.1 surround' : stream.channels === 1 ? 'Mono' : 'Stereo');
    const bitrateKbps =
      typeof stream.bitrateKbps === 'number' && Number.isFinite(stream.bitrateKbps)
        ? Math.round(stream.bitrateKbps)
        : 0;

    const key = `${codec.toLowerCase()}-${layout.toLowerCase()}-${bitrateKbps}`;
    if (seen.has(key)) return;
    seen.add(key);

    const isNativeLossless =
      typeof stream.isNativeLossless === 'boolean'
        ? stream.isNativeLossless
        : isLosslessAudioCodec(codec);

    const duration =
      typeof manifest.durationSeconds === 'number' && Number.isFinite(manifest.durationSeconds)
        ? manifest.durationSeconds
        : 0;

    let estimatedSizeBytes: number | undefined;
    let sizeIsEstimate = true;
    if (
      typeof stream.estimatedSizeBytes === 'number' &&
      Number.isFinite(stream.estimatedSizeBytes) &&
      stream.estimatedSizeBytes > 0
    ) {
      estimatedSizeBytes = Math.round(stream.estimatedSizeBytes);
      sizeIsEstimate = Boolean(stream.sizeIsEstimate ?? true);
    } else if (bitrateKbps > 0 && duration > 0) {
      estimatedSizeBytes = Math.round(((bitrateKbps * 1000) / 8) * duration);
      sizeIsEstimate = true;
    }

    const prettyLayout = layout.charAt(0).toUpperCase() + layout.slice(1);
    const label =
      tracks.length === 0
        ? `Original ${prettyLayout}`
        : `Track ${tracks.length + 1} (${prettyLayout})`;

    tracks.push({
      id: `a-${stream.streamIndex ?? idx}-${tracks.length}`,
      streamIndex: typeof stream.streamIndex === 'number' ? stream.streamIndex : idx,
      label,
      codec,
      bitrateKbps,
      sampleRateHz: stream.sampleRateHz,
      channels: stream.channels,
      channelLayout: prettyLayout,
      isNativeLossless,
      estimatedSizeBytes,
      sizeIsEstimate,
      stream,
    });
  });

  return tracks;
}
