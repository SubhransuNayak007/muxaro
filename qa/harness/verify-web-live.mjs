#!/usr/bin/env node
/**
 * MUXARO Wave 2 Live Server, Static Asset, & Route Integrity Verifier
 * Owned by AGENT 10 (Independent QA, Performance & Release Engineer)
 */

const WEB_BASE = process.env.WEB_BASE || 'http://localhost:3000';
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:4000';

const WEB_ROUTES = [
  '/',
  '/dashboard',
  '/credits',
  '/tools',
  '/tools/audio-extractor',
  '/tools/media-converter',
  '/tools/audio-video-merger',
  '/tools/video-merger',
  '/tools/batch-processing',
  '/tools/playlist-processing',
  '/tools/playlist-batch',
  '/docs',
  '/docs/formats',
  '/docs/resolutions',
  '/docs/audio-quality',
  '/status',
  '/privacy',
  '/terms',
  '/dmca',
];

const API_ENDPOINTS = [
  '/api/v1/health',
  '/api/v1/account/credits',
  '/api/v1/admin/metrics',
];

async function main() {
  let failures = 0;
  console.log('=== API ENDPOINT VERIFICATION ===');
  for (const ep of API_ENDPOINTS) {
    try {
      const res = await fetch(`${API_BASE}${ep}`);
      const text = await res.text();
      const ok = res.status === 200;
      if (!ok) failures++;
      console.log(`${ok ? 'PASS' : 'FAIL'} [${res.status}] ${ep} (${text.length} bytes)`);
    } catch (err) {
      failures++;
      console.log(`FAIL [ERR] ${ep}: ${err.message}`);
    }
  }

  console.log('\n=== WEB ROUTE & HTML VERIFICATION ===');
  const assetSet = new Set();
  for (const route of WEB_ROUTES) {
    try {
      const res = await fetch(`${WEB_BASE}${route}`);
      const html = await res.text();
      const statusOk = res.status === 200;
      const hasRenderBlockingFont = /<link[^>]+fonts\.googleapis\.com/i.test(html);
      const hasUndefinedBug = /undefined\/undefined|\bNaN\b/.test(html);
      const hasNextError = html.includes('__next_error__') || html.includes('NEXT_HTTP_ERROR_FALLBACK');
      const hasLegacyClass = /\b(keyline-box|sheet-grid)\b/.test(html);

      const assets = [...html.matchAll(/\/_next\/static\/[^"'\s<>\\]+/g)].map((m) => m[0]);
      for (const a of assets) assetSet.add(a);

      const ok = statusOk && !hasRenderBlockingFont && !hasUndefinedBug && !hasNextError && !hasLegacyClass;
      if (!ok) failures++;
      console.log(
        `${ok ? 'PASS' : 'FAIL'} [${res.status}] ${route} (len=${html.length}, assets=${assets.length}` +
          (hasRenderBlockingFont ? ', RENDER_BLOCKING_FONT' : '') +
          (hasUndefinedBug ? ', UNDEFINED_OR_NAN' : '') +
          (hasNextError ? ', NEXT_ERROR' : '') +
          (hasLegacyClass ? ', LEGACY_CLASS' : '') +
          ')'
      );
    } catch (err) {
      failures++;
      console.log(`FAIL [ERR] ${route}: ${err.message}`);
    }
  }

  console.log(`\n=== STATIC ASSET INTEGRITY (${assetSet.size} unique assets) ===`);
  let brokenAssets = 0;
  for (const asset of assetSet) {
    try {
      const res = await fetch(`${WEB_BASE}${asset}`);
      if (res.status !== 200) {
        brokenAssets++;
        failures++;
        console.log(`FAIL [${res.status}] ${asset}`);
      }
    } catch (err) {
      brokenAssets++;
      failures++;
      console.log(`FAIL [ERR] ${asset}: ${err.message}`);
    }
  }
  if (brokenAssets === 0) {
    console.log(`PASS All ${assetSet.size} static JS/CSS/font assets returned HTTP 200.`);
  } else {
    console.log(`FAIL ${brokenAssets} / ${assetSet.size} static assets failed (stale Next.js server?).`);
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Total Failures: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
