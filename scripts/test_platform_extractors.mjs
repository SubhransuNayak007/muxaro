import fs from 'node:fs';

// 1. Pinterest Extractor
export async function extractPinterestMedia(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // 1. Check og:video
    const ogVideoMatch = html.match(/<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i) ||
                         html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::secure_url)?["']/i);
    let videoUrl = ogVideoMatch ? ogVideoMatch[1] : null;

    // 2. Check JSON-LD or PWS_DATA for v.pinimg.com video URLs (prefer 1080p, 720p, etc.)
    if (!videoUrl) {
      const pinimgMatches = html.match(/https:\/\/v\.pinimg\.com\/videos\/[^\s"'\\]+\.mp4/g);
      if (pinimgMatches && pinimgMatches.length > 0) {
        // Sort to prefer 1080p or 720p
        videoUrl = pinimgMatches.find(u => u.includes('720p') || u.includes('1080p')) || pinimgMatches[0];
      }
    }

    // 3. Extract title
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    let title = titleMatch ? titleMatch[1].replace(/\s*\|\s*Pinterest.*$/i, '').trim() : 'Pinterest Media Video';

    if (videoUrl) {
      // Decode HTML entities (e.g. &amp; -> &)
      videoUrl = videoUrl.replace(/&amp;/g, '&');
      return {
        platform: 'pinterest',
        title,
        videoUrl,
        directStreamUrl: videoUrl,
      };
    }
  } catch (e) {
    console.error('Pinterest extract error:', e.message);
  }
  return null;
}

// 2. Twitter / X Extractor
export async function extractTwitterMedia(url) {
  try {
    let cleanUrl = url.replace('twitter.com', 'api.vxtwitter.com').replace('x.com', 'api.vxtwitter.com');
    const res = await fetch(cleanUrl, {
      headers: { 'User-Agent': 'MUXARO-Media-Systems/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      const videoUrl = data.mediaURLs?.find(u => u.includes('.mp4')) || (data.media_extended?.find(m => m.type === 'video')?.url);
      if (videoUrl) {
        return {
          platform: 'x',
          title: data.text ? data.text.slice(0, 80) : 'X Media Video',
          author: data.user_name || 'X Creator',
          videoUrl,
          directStreamUrl: videoUrl,
        };
      }
    }
  } catch (e) {
    console.error('Twitter extract error:', e.message);
  }
  return null;
}

// 3. Reddit Extractor
export async function extractRedditMedia(url) {
  try {
    const jsonUrl = url.split('?')[0].replace(/\/$/, '') + '.json';
    const res = await fetch(jsonUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MUXARO/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      const post = data[0]?.data?.children[0]?.data;
      const media = post?.secure_media?.reddit_video || post?.media?.reddit_video;
      if (media?.fallback_url) {
        return {
          platform: 'reddit',
          title: post.title || 'Reddit Media Video',
          author: post.author || 'Reddit User',
          videoUrl: media.fallback_url,
          directStreamUrl: media.fallback_url,
          height: media.height,
        };
      }
    }
  } catch (e) {
    console.error('Reddit extract error:', e.message);
  }
  return null;
}

// 4. TikTok Extractor
export async function extractTikTokMedia(url) {
  try {
    const apiRes = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (apiRes.ok) {
      const json = await apiRes.json();
      if (json.data?.play) {
        const fullVideoUrl = json.data.play.startsWith('http') ? json.data.play : `https://www.tikwm.com${json.data.play}`;
        return {
          platform: 'tiktok',
          title: json.data.title || 'TikTok Media Video',
          author: json.data.author?.nickname || 'TikTok Creator',
          videoUrl: fullVideoUrl,
          directStreamUrl: fullVideoUrl,
        };
      }
    }
  } catch (e) {
    console.error('TikTok extract error:', e.message);
  }
  return null;
}

async function run() {
  console.log('Testing Twitter extractor with sample status...');
  const tw = await extractTwitterMedia('https://x.com/OpenAI/status/1841893321172828612');
  console.log('Twitter result:', tw);
}

run();
