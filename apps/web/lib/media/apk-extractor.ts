'use client';

import type { MediaManifest, MediaStream } from '@/lib/types';
import { isCapacitorApp } from '@/lib/native-bridge';
import { classifyMediaSourceUrl } from './source-resolver';
import { normalizeManifest } from '@/lib/api-client';

interface MuxaroMediaPluginNative {
  fetchUrlText(opts: {
    url: string;
    userAgent?: string;
    accept?: string;
    referer?: string;
  }): Promise<{ status: number; ok: boolean; url: string; contentType: string; body: string }>;
  probeHead(opts: {
    url: string;
    userAgent?: string;
  }): Promise<{ ok: boolean; status: number; contentType: string; contentLength: number; finalUrl: string }>;
  probeYouTube(opts: { url: string }): Promise<any>;
  downloadMedia(opts: {
    jobId: string;
    videoUrl: string;
    audioUrl?: string;
    filename: string;
    mimeType: string;
  }): Promise<{
    ok: boolean;
    jobId: string;
    filename: string;
    sizeBytes: number;
    mimeType: string;
    savedUri: string;
    savedPath: string;
  }>;
  openSavedMedia(opts: { uri: string; mimeType?: string }): Promise<void>;
  addListener?(
    event: 'muxaroMediaProgress',
    cb: (ev: { jobId: string; percent: number; status: string; message: string }) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

function getApkMediaPlugin(): MuxaroMediaPluginNative | null {
  if (typeof window === 'undefined' || !isCapacitorApp()) return null;
  return (window.Capacitor?.Plugins?.MuxaroMedia as MuxaroMediaPluginNative | undefined) || null;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\u0026/g, '&')
    .replace(/\\u002F/g, '/')
    .replace(/\\\//g, '/');
}

function extractMeta(html: string, names: string[]): string | undefined {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const r1 = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i');
    const r2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i');
    const m = r1.exec(html) || r2.exec(html);
    if (m?.[1]) return decodeHtmlEntities(m[1].trim());
  }
  return undefined;
}

function buildSingleStreamManifest(params: {
  idPrefix: string;
  platform: string;
  sourceUrl: string;
  streamUrl: string;
  title: string;
  author?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  contentLength?: number;
  container?: string;
  mimeType?: string;
}): MediaManifest {
  const height = params.height || 1080;
  const width = params.width || 1920;
  const duration = params.durationSeconds || 0;
  const size = params.contentLength || 0;
  const container = params.container || (params.mimeType?.includes('audio/') ? 'mp3' : 'mp4');
  const isAudio = params.mimeType?.startsWith('audio/') || ['mp3', 'm4a', 'wav', 'flac', 'aac', 'opus'].includes(container);

  const videoStreams: MediaStream[] = isAudio
    ? []
    : [
        {
          streamIndex: 0,
          streamType: 'video',
          codec: 'h264',
          bitrateKbps: 3000,
          formatId: `${height}p`,
          width,
          height,
          resolutionLabel: `${height}p`,
          fps: 30,
          hdr: false,
          estimatedSizeBytes: size,
          sizeIsEstimate: size <= 0,
          recommended: true,
          isNativeLossless: true,
          isStreamCopyCandidate: true,
          transcodeRequired: false,
          notes: 'muxed',
          url: params.streamUrl,
        },
      ];

  const audioStreams: MediaStream[] = [
    {
      streamIndex: isAudio ? 0 : 1,
      streamType: 'audio',
      codec: container === 'mp3' ? 'mp3' : 'aac',
      bitrateKbps: 192,
      formatId: 'audio_orig',
      sampleRateHz: 44100,
      channels: 2,
      channelLayout: 'stereo',
      estimatedSizeBytes: isAudio ? size : 0,
      sizeIsEstimate: size <= 0,
      recommended: true,
      isNativeLossless: false,
      isStreamCopyCandidate: true,
      transcodeRequired: false,
      notes: 'direct',
      url: params.streamUrl,
    },
  ];

  return normalizeManifest(
    {
      id: `${params.idPrefix}_${Date.now()}`,
      platform: params.platform,
      title: params.title,
      author: params.author || params.platform,
      durationSeconds: duration,
      thumbnailUrl: params.thumbnailUrl || '',
      sourceUrl: params.sourceUrl,
      container,
      fileSizeBytes: size,
      directStreamUrl: params.streamUrl,
      videoStreams,
      audioStreams,
    },
    { sourceUrl: params.sourceUrl, isLocalUpload: false }
  );
}

/**
 * Resolves any supported platform or direct video/audio URL natively on Android APK
 * via MuxaroMedia Java plugin (zero browser CORS limits).
 */
export async function probeApkMediaUrl(rawUrl: string): Promise<MediaManifest> {
  const plugin = getApkMediaPlugin();
  if (!plugin) {
    throw new Error('Native Android media plugin is unavailable.');
  }

  const classified = classifyMediaSourceUrl(rawUrl);
  if (classified.kind === 'invalid_or_restricted') {
    throw new Error(classified.blockedReason || 'Invalid or restricted URL.');
  }

  const normalizedUrl = classified.normalizedUrl;

  // 1. YouTube (youtube.com / youtu.be / shorts)
  if (classified.kind === 'youtube') {
    const raw = await plugin.probeYouTube({ url: normalizedUrl });
    return normalizeManifest(raw, { sourceUrl: normalizedUrl, isLocalUpload: false });
  }

  // 2. Direct Media (.mp4 / .webm / .mkv / .mp3 / CDN links)
  if (classified.kind === 'direct_media') {
    const head = await plugin.probeHead({ url: normalizedUrl });
    if (!head.ok && !head.contentType) {
      throw new Error(`Media link returned HTTP ${head.status || 'error'}.`);
    }
    const ext = normalizedUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'mp4';
    const rawTitle = decodeURIComponent(normalizedUrl.split('?')[0].split('/').pop() || 'MUXARO Media').replace(/\.[^.]+$/, '');
    return buildSingleStreamManifest({
      idPrefix: 'direct',
      platform: 'direct',
      sourceUrl: normalizedUrl,
      streamUrl: head.finalUrl || normalizedUrl,
      title: rawTitle || 'Direct Media',
      contentLength: head.contentLength,
      container: ext,
      mimeType: head.contentType || 'video/mp4',
    });
  }

  const host = classified.host;

  // 3. TikTok via TikWM public JSON + webpage HTML fallback
  if (host.includes('tiktok.com')) {
    try {
      const apiRes = await plugin.fetchUrlText({
        url: `https://www.tikwm.com/api/?url=${encodeURIComponent(normalizedUrl)}&hd=1`,
        accept: 'application/json',
      });
      const data = JSON.parse(apiRes.body || '{}')?.data;
      const playUrl = data?.hdplay || data?.play || data?.wmplay;
      if (playUrl && /^https?:\/\//i.test(playUrl)) {
        return buildSingleStreamManifest({
          idPrefix: 'tiktok',
          platform: 'tiktok',
          sourceUrl: normalizedUrl,
          streamUrl: playUrl,
          title: data.title || 'TikTok Video',
          author: data.author?.nickname || data.author?.unique_id || 'TikTok Creator',
          thumbnailUrl: data.cover || data.origin_cover,
          durationSeconds: Number(data.duration || 0),
          contentLength: Number(data.hd_size || data.size || 0),
          container: 'mp4',
        });
      }
    } catch {}
  }

  // 4. Twitter / X via fxtwitter JSON + vxtwitter fallback
  if (host.includes('x.com') || host.includes('twitter.com')) {
    const m = normalizedUrl.match(/\/(?:i\/)?status\/(\d+)/i);
    if (m?.[1]) {
      try {
        const fx = await plugin.fetchUrlText({
          url: `https://api.fxtwitter.com/status/${m[1]}`,
          accept: 'application/json',
        });
        const tw = JSON.parse(fx.body || '{}')?.tweet;
        const vid = tw?.media?.videos?.[0];
        if (vid?.url) {
          return buildSingleStreamManifest({
            idPrefix: 'twitter',
            platform: 'twitter',
            sourceUrl: normalizedUrl,
            streamUrl: vid.url,
            title: tw.text?.slice(0, 80) || 'X / Twitter Video',
            author: tw.author?.name || tw.author?.screen_name || 'X User',
            thumbnailUrl: vid.thumbnail_url,
            durationSeconds: Number(vid.duration || 0),
            width: Number(vid.width || 1280),
            height: Number(vid.height || 720),
            container: 'mp4',
          });
        }
      } catch {}
    }
  }

  // 5. Reddit via post .json
  if (host.includes('reddit.com') || host.includes('redd.it')) {
    try {
      const cleanPath = normalizedUrl.split('?')[0].replace(/\/$/, '');
      const jRes = await plugin.fetchUrlText({
        url: `${cleanPath}.json`,
        accept: 'application/json',
      });
      const parsed = JSON.parse(jRes.body || '[]');
      const post = parsed?.[0]?.data?.children?.[0]?.data;
      const rv = post?.secure_media?.reddit_video || post?.media?.reddit_video;
      const fallbackUrl = rv?.fallback_url ? String(rv.fallback_url).replace(/&amp;/g, '&') : '';
      if (fallbackUrl) {
        return buildSingleStreamManifest({
          idPrefix: 'reddit',
          platform: 'reddit',
          sourceUrl: normalizedUrl,
          streamUrl: fallbackUrl,
          title: post?.title || 'Reddit Video',
          author: post?.author || 'Reddit',
          thumbnailUrl: post?.thumbnail?.startsWith('http') ? post.thumbnail : undefined,
          durationSeconds: Number(rv.duration || 0),
          width: Number(rv.width || 1280),
          height: Number(rv.height || 720),
          container: 'mp4',
        });
      }
    } catch {}
  }

  // 6. Vimeo via player config JSON
  if (host.includes('vimeo.com')) {
    const vm = normalizedUrl.match(/vimeo\.com\/(?:.*\/)?(\d+)/);
    if (vm?.[1]) {
      try {
        const cfg = await plugin.fetchUrlText({
          url: `https://player.vimeo.com/video/${vm[1]}/config`,
          referer: 'https://vimeo.com/',
        });
        const j = JSON.parse(cfg.body || '{}');
        const files = (j?.request?.files?.progressive || []).sort(
          (a: any, b: any) => Number(b.height || 0) - Number(a.height || 0)
        );
        if (files[0]?.url) {
          return buildSingleStreamManifest({
            idPrefix: 'vimeo',
            platform: 'vimeo',
            sourceUrl: normalizedUrl,
            streamUrl: files[0].url,
            title: j?.video?.title || 'Vimeo Video',
            author: j?.video?.owner?.name || 'Vimeo',
            thumbnailUrl: j?.video?.thumbs?.['1280'] || j?.video?.thumbs?.base,
            durationSeconds: Number(j?.video?.duration || 0),
            width: Number(files[0].width || 1920),
            height: Number(files[0].height || 1080),
            container: 'mp4',
          });
        }
      } catch {}
    }
  }

  // 7. Generic Social HTML fallback (Instagram, Facebook, Pinterest, etc.)
  const pageRes = await plugin.fetchUrlText({
    url: normalizedUrl,
    userAgent: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    accept: 'text/html,application/xhtml+xml,*/*',
  });
  const html = pageRes.body || '';
  const videoCandidates = [
    extractMeta(html, ['og:video:secure_url', 'og:video:url', 'og:video', 'twitter:player:stream']),
    ...Array.from(html.matchAll(/(https:\/\/[^"'\s<>\\]+\.mp4[^"'\s<>\\]*)/gi)).map((m) =>
      decodeHtmlEntities(m[1])
    ),
  ].filter((u): u is string => Boolean(u && /^https?:\/\//i.test(u) && !u.includes('.js') && !u.includes('.css')));

  if (videoCandidates.length > 0) {
    const bestUrl = videoCandidates[0];
    const head = await plugin.probeHead({ url: bestUrl }).catch(() => ({ contentLength: 0, contentType: 'video/mp4', finalUrl: bestUrl }));
    const ogTitle = extractMeta(html, ['og:title', 'twitter:title']) || `${classified.platformLabel} Video`;
    const ogThumb = extractMeta(html, ['og:image:secure_url', 'og:image']);
    return buildSingleStreamManifest({
      idPrefix: classified.platformLabel.toLowerCase().replace(/[^a-z]/g, ''),
      platform: classified.platformLabel.toLowerCase(),
      sourceUrl: normalizedUrl,
      streamUrl: head.finalUrl || bestUrl,
      title: ogTitle,
      author: classified.platformLabel,
      thumbnailUrl: ogThumb,
      contentLength: head.contentLength,
      container: 'mp4',
      mimeType: head.contentType || 'video/mp4',
    });
  }

  throw new Error(
    `Could not find a downloadable public video stream on ${classified.platformLabel}. The post may be private, login-protected, or region-locked.`
  );
}

/**
 * Downloads resolved video/audio (auto-muxing paired tracks natively on Android) into Downloads/MUXARO.
 */
export async function downloadApkMediaToDevice(params: {
  videoUrl: string;
  audioUrl?: string;
  filename: string;
  mimeType: string;
  onProgress?: (pct: number, status: string, message: string) => void;
}): Promise<{ savedPath: string; savedUri: string; filename: string; sizeBytes: number; mimeType: string }> {
  const plugin = getApkMediaPlugin();
  if (!plugin) {
    throw new Error('Native Android download engine is unavailable.');
  }

  const jobId = `apk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  let listenerHandle: { remove: () => Promise<void> } | null = null;
  if (plugin.addListener && params.onProgress) {
    listenerHandle = await plugin.addListener('muxaroMediaProgress', (ev) => {
      if (ev.jobId === jobId) {
        params.onProgress?.(ev.percent, ev.status, ev.message);
      }
    });
  }

  try {
    const res = await plugin.downloadMedia({
      jobId,
      videoUrl: params.videoUrl,
      audioUrl: params.audioUrl,
      filename: params.filename,
      mimeType: params.mimeType,
    });
    return {
      savedPath: res.savedPath,
      savedUri: res.savedUri,
      filename: res.filename,
      sizeBytes: res.sizeBytes,
      mimeType: res.mimeType,
    };
  } finally {
    if (listenerHandle) {
      await listenerHandle.remove().catch(() => {});
    }
  }
}

export async function openApkSavedMedia(uri: string, mimeType = 'video/mp4'): Promise<void> {
  const plugin = getApkMediaPlugin();
  if (!plugin) return;
  await plugin.openSavedMedia({ uri, mimeType });
}
