import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const INDEXNOW_KEY = 'd3e24b7a95614917a1518f97a8929e01';
const HOST = 'muxaro.app';
const KEY_LOCATION = `https://${HOST}/${INDEXNOW_KEY}.txt`;

const CORE_URLS = [
  `https://${HOST}/`,
  `https://${HOST}/tools`,
  `https://${HOST}/tools/media-converter`,
  `https://${HOST}/tools/audio-extractor`,
  `https://${HOST}/tools/audio-video-merger`,
  `https://${HOST}/tools/video-merger`,
  `https://${HOST}/tools/batch-processing`,
  `https://${HOST}/tools/playlist-batch`,
  `https://${HOST}/tools/direct-helper`,
  `https://${HOST}/convert/youtube-to-mp3`,
  `https://${HOST}/convert/mkv-to-mp4`,
  `https://${HOST}/convert/webm-to-mp4`,
  `https://${HOST}/convert/youtube-to-flac`,
  `https://${HOST}/convert/youtube-to-wav`,
  `https://${HOST}/convert/mov-to-mp4`,
  `https://${HOST}/alternatives/savefrom-net`,
  `https://${HOST}/alternatives/y2mate`,
  `https://${HOST}/alternatives/cobalt-tools`,
  `https://${HOST}/alternatives/cloudconvert`,
  `https://${HOST}/alternatives/ytmp3`,
  `https://${HOST}/docs`,
  `https://${HOST}/docs/formats`,
  `https://${HOST}/docs/resolutions`,
  `https://${HOST}/docs/audio-quality`,
  `https://${HOST}/docs/troubleshooting`,
  `https://${HOST}/docs/faq`,
  `https://${HOST}/docs/security`,
];

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const secret = process.env.INDEXNOW_SECRET || 'muxaro-seo-ping-secret-2026';

  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let customUrls: string[] = [];
  try {
    const body = await request.json().catch(() => ({}));
    if (Array.isArray(body?.urls) && body.urls.length > 0) {
      customUrls = body.urls;
    }
  } catch {
    // fallback to CORE_URLS
  }

  const urlList = customUrls.length > 0 ? customUrls : CORE_URLS;

  const payload = {
    host: HOST,
    key: INDEXNOW_KEY,
    keyLocation: KEY_LOCATION,
    urlList,
  };

  try {
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    });

    return NextResponse.json({
      success: response.ok,
      status: response.status,
      submittedUrls: urlList.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'IndexNow dispatch failed', details: String(error) },
      { status: 500 }
    );
  }
}
