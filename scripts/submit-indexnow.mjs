#!/usr/bin/env node
/**
 * MUXARO — IndexNow Instant Search Ingestion Automation Script
 * Dispatches real-time URL updates directly to IndexNow participating engines
 * (Microsoft Bing, Yandex, Seznam.cz, Naver, ChatGPT Search).
 *
 * Usage:
 *   node scripts/submit-indexnow.mjs
 *   node scripts/submit-indexnow.mjs --host=muxaro.app
 *   node scripts/submit-indexnow.mjs https://muxaro.app/tools/media-converter
 */

const INDEXNOW_KEY = process.env.INDEXNOW_KEY || 'd3e24b7a95614917a1518f97a8929e01';
const HOST = process.env.INDEXNOW_HOST || 'muxaro.app';
const KEY_LOCATION = `https://${HOST}/${INDEXNOW_KEY}.txt`;

// Parse CLI arguments
const args = process.argv.slice(2);
const customUrls = args.filter((arg) => arg.startsWith('http://') || arg.startsWith('https://'));

const DEFAULT_URL_LIST = [
  `https://${HOST}/`,
  `https://${HOST}/tools`,
  `https://${HOST}/tools/media-converter`,
  `https://${HOST}/tools/audio-extractor`,
  `https://${HOST}/tools/audio-video-merger`,
  `https://${HOST}/tools/video-merger`,
  `https://${HOST}/tools/batch-processing`,
  `https://${HOST}/tools/playlist-batch`,
  `https://${HOST}/tools/playlist-processing`,
  `https://${HOST}/tools/direct-helper`,
  `https://${HOST}/convert/youtube-to-mp3`,
  `https://${HOST}/convert/mkv-to-mp4`,
  `https://${HOST}/convert/webm-to-mp4`,
  `https://${HOST}/convert/youtube-to-flac`,
  `https://${HOST}/convert/youtube-to-wav`,
  `https://${HOST}/convert/mov-to-mp4`,
  `https://${HOST}/convert/vp9-to-h264`,
  `https://${HOST}/convert/av1-to-mp4`,
  `https://${HOST}/convert/ts-to-mp4`,
  `https://${HOST}/convert/m4a-to-mp3`,
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
  `https://${HOST}/status`,
  `https://${HOST}/terms`,
  `https://${HOST}/privacy`,
  `https://${HOST}/dmca`,
  `https://${HOST}/llms.txt`,
];

async function run() {
  const urlList = customUrls.length > 0 ? customUrls : DEFAULT_URL_LIST;

  console.log('='.repeat(65));
  console.log('🚀 MUXARO IndexNow Instant Search Ingestion Trigger');
  console.log('='.repeat(65));
  console.log(`Host:         ${HOST}`);
  console.log(`Key:          ${INDEXNOW_KEY}`);
  console.log(`Key Location: ${KEY_LOCATION}`);
  console.log(`URLs to Ping: ${urlList.length}`);
  console.log('='.repeat(65));

  const payload = {
    host: HOST,
    key: INDEXNOW_KEY,
    keyLocation: KEY_LOCATION,
    urlList: urlList,
  };

  const endpoints = [
    { name: 'IndexNow Central', url: 'https://api.indexnow.org/indexnow' },
    { name: 'Microsoft Bing', url: 'https://www.bing.com/indexnow' },
  ];

  let successCount = 0;

  for (const endpoint of endpoints) {
    try {
      console.log(`Submitting to ${endpoint.name} (${endpoint.url})...`);
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'User-Agent': 'Muxaro-IndexNow-Agent/1.0',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok || response.status === 200 || response.status === 202) {
        console.log(`✅ [${endpoint.name}] Accepted! HTTP Status: ${response.status} (${response.statusText || 'OK/Accepted'})`);
        successCount++;
      } else {
        const errorText = await response.text().catch(() => '');
        console.warn(`⚠️ [${endpoint.name}] Response: HTTP ${response.status} ${response.statusText} - ${errorText}`);
      }
    } catch (err) {
      console.error(`❌ [${endpoint.name}] Network error:`, err.message);
    }
  }

  console.log('='.repeat(65));
  if (successCount > 0) {
    console.log(`🎉 IndexNow submission completed successfully (${successCount}/${endpoints.length} endpoints reached).`);
    console.log(`   ${urlList.length} URLs submitted to search engine index queues.`);
  } else {
    console.warn('⚠️ Warning: No endpoints returned 200/202. Check DNS / network connectivity.');
  }
  console.log('='.repeat(65));
}

run().catch((err) => {
  console.error('Fatal error during IndexNow execution:', err);
  process.exit(1);
});
