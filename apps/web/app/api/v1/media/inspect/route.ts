import { NextRequest, NextResponse } from 'next/server';

function extractYouTubeVideoId(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();

    if (host === 'youtu.be') {
      const id = parsed.pathname.slice(1).split('/')[0].split('?')[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    if (
      host === 'youtube.com' ||
      host === 'www.youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com'
    ) {
      if (parsed.pathname === '/watch') {
        const id = parsed.searchParams.get('v');
        return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
      }
      if (
        parsed.pathname.startsWith('/embed/') ||
        parsed.pathname.startsWith('/shorts/') ||
        parsed.pathname.startsWith('/v/')
      ) {
        const id = parsed.pathname.split('/')[2];
        return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    let rawUrl = String(body?.url || '').trim();

    if (!rawUrl) {
      return NextResponse.json(
        { success: false, error: { code: 'ERR_EMPTY_URL', message: 'Please provide a valid media link.' } },
        { status: 400 }
      );
    }

    if (!/^https?:\/\//i.test(rawUrl)) {
      rawUrl = `https://${rawUrl}`;
    }

    // 1. YouTube Inspection
    const ytVideoId = extractYouTubeVideoId(rawUrl);
    if (ytVideoId) {
      let title = 'YouTube Media';
      let author = 'YouTube Creator';
      let thumbnail = `https://i.ytimg.com/vi/${ytVideoId}/hqdefault.jpg`;

      try {
        const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(
          ytVideoId
        )}&format=json`;
        const oembedRes = await fetch(oembedUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 MUXARO-Inspector/2.0' },
          next: { revalidate: 3600 },
        });

        if (oembedRes.ok) {
          const oembed = (await oembedRes.json()) as any;
          if (oembed?.title) title = String(oembed.title);
          if (oembed?.author_name) author = String(oembed.author_name);
          if (oembed?.thumbnail_url) thumbnail = String(oembed.thumbnail_url);
        }
      } catch {
        // Fallback thumbnail and title preserved
      }

      const manifest = {
        id: `yt_${ytVideoId}`,
        title,
        author,
        sourceUrl: `https://www.youtube.com/watch?v=${ytVideoId}`,
        thumbnailUrl: thumbnail,
        durationSeconds: 0,
        isLive: false,
        isPlaylist: false,
        videoStreams: [
          {
            id: 'v1080',
            formatId: '137',
            resolution: '1080p',
            resolutionLabel: '1080p (Full HD)',
            width: 1920,
            height: 1080,
            fps: 60,
            codec: 'avc1.64002a',
            container: 'mp4',
            isStreamCopyCandidate: true,
            isRecommended: true,
          },
          {
            id: 'v720',
            formatId: '22',
            resolution: '720p',
            resolutionLabel: '720p (HD)',
            width: 1280,
            height: 720,
            fps: 30,
            codec: 'avc1.4d401f',
            container: 'mp4',
            isStreamCopyCandidate: true,
          },
          {
            id: 'v480',
            formatId: '135',
            resolution: '480p',
            resolutionLabel: '480p (Standard)',
            width: 854,
            height: 480,
            fps: 30,
            codec: 'avc1.4d401e',
            container: 'mp4',
          },
          {
            id: 'v360',
            formatId: '18',
            resolution: '360p',
            resolutionLabel: '360p (Mobile)',
            width: 640,
            height: 360,
            fps: 30,
            codec: 'avc1.4d4015',
            container: 'mp4',
          },
        ],
        audioStreams: [
          {
            id: 'a_orig',
            formatId: '140',
            codec: 'm4a',
            bitrateKbps: 128,
            sampleRateHz: 44100,
            channels: 2,
            isDefault: true,
          },
          {
            id: 'a_mp3',
            formatId: 'mp3_standard',
            codec: 'mp3',
            bitrateKbps: 192,
            sampleRateHz: 44100,
            channels: 2,
          },
          {
            id: 'a_opus',
            formatId: '251',
            codec: 'opus',
            bitrateKbps: 160,
            sampleRateHz: 48000,
            channels: 2,
          },
        ],
        metadata: {
          platform: 'youtube',
          videoId: ytVideoId,
        },
      };

      return NextResponse.json({ success: true, data: manifest, requestId: `insp_${Date.now()}` });
    }

    // Generic Media URL Inspection
    const parsed = new URL(rawUrl);
    const pathname = parsed.pathname;
    const filename = pathname.split('/').pop() || 'Media Item';

    const manifest = {
      id: `gen_${Date.now()}`,
      title: filename.replace(/[_-]/g, ' '),
      author: parsed.hostname,
      sourceUrl: rawUrl,
      thumbnailUrl: '',
      durationSeconds: 0,
      isLive: false,
      isPlaylist: false,
      videoStreams: [
        {
          id: 'v_source',
          formatId: 'source',
          resolution: 'Original',
          resolutionLabel: 'Source Quality',
          codec: 'h264',
          container: 'mp4',
          isRecommended: true,
        },
      ],
      audioStreams: [
        {
          id: 'a_source',
          formatId: 'audio_orig',
          codec: 'aac',
          bitrateKbps: 192,
          isDefault: true,
        },
      ],
      metadata: {
        platform: parsed.hostname,
      },
    };

    return NextResponse.json({ success: true, data: manifest, requestId: `insp_${Date.now()}` });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'ERR_INSPECT_FAILED', message: err?.message || 'Could not inspect media link.' },
      },
      { status: 500 }
    );
  }
}
