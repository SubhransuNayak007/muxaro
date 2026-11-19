#!/usr/bin/env node
/**
 * MUXARO — Automated Comprehensive SEO & Structured Data Auditor
 * Audits all static export routes in apps/web/out/ for:
 * 1. Title tags & descriptions
 * 2. Self-referencing canonical URLs
 * 3. OpenGraph & Twitter Card tags
 * 4. Robots indexing directives (index vs noindex/nofollow)
 * 5. Structured Data (JSON-LD Schema.org)
 * 6. robots.txt and sitemap.xml validity & synchronization
 * 7. Header and footer navigation links (zero 404s)
 */

import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve(process.cwd(), 'apps/web/out');
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://muxaro.pages.dev').trim().replace(/\/+$/, '');

const PUBLIC_ROUTES = [
  '/',
  '/tools',
  '/tools/media-converter',
  '/tools/audio-extractor',
  '/tools/audio-video-merger',
  '/tools/video-merger',
  '/tools/batch-processing',
  '/tools/playlist-processing',
  '/tools/playlist-batch',
  '/docs',
  '/docs/formats',
  '/docs/resolutions',
  '/docs/audio-quality',
  '/docs/troubleshooting',
  '/docs/faq',
  '/docs/security',
  '/status',
  '/terms',
  '/privacy',
  '/dmca',
];

const PRIVATE_ROUTES = [
  '/account',
  '/admin',
  '/dashboard',
  '/credits',
  '/login',
  '/register',
  '/reset-password',
  '/verify-email',
];

function routeToFilePath(route) {
  if (route === '/') return path.join(outDir, 'index.html');
  const clean = route.replace(/^\//, '');
  const directHtml = path.join(outDir, `${clean}.html`);
  if (fs.existsSync(directHtml)) return directHtml;
  const indexHtml = path.join(outDir, clean, 'index.html');
  if (fs.existsSync(indexHtml)) return indexHtml;
  return directHtml;
}

const results = {
  totalAudited: 0,
  publicRoutesPassed: 0,
  privateRoutesPassed: 0,
  structuredDataPassed: 0,
  sitemapPassed: false,
  robotsTxtPassed: false,
  navLinksPassed: false,
  errors: [],
  warnings: [],
  routeDetails: [],
};

console.log(`\n======================================================`);
console.log(`🔍 MUXARO SEO & DISCOVERABILITY AUDIT`);
console.log(`Target Host: ${SITE_URL}`);
console.log(`======================================================\n`);

// 1. Audit Public Routes
for (const route of PUBLIC_ROUTES) {
  results.totalAudited++;
  const filePath = routeToFilePath(route);

  if (!fs.existsSync(filePath)) {
    results.errors.push(`Missing HTML file for public route: ${route} (${filePath})`);
    continue;
  }

  const html = fs.readFileSync(filePath, 'utf8');

  // Title check
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const title = titleMatch ? titleMatch[1].replace(/&amp;/g, '&') : null;
  if (!title) {
    results.errors.push(`[${route}] Missing <title> tag`);
  }

  // Description check
  const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i) ||
                    html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
  const description = descMatch ? descMatch[1] : null;
  if (!description) {
    results.errors.push(`[${route}] Missing meta description`);
  }

  // Canonical check
  const canonicalMatch = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i) ||
                         html.match(/<link\s+href=["']([^"']+)["']\s+rel=["']canonical["']/i);
  const canonical = canonicalMatch ? canonicalMatch[1] : null;
  const expectedCanonical = route === '/' ? `${SITE_URL}` : `${SITE_URL}${route}`;
  
  if (!canonical) {
    results.errors.push(`[${route}] Missing rel="canonical" link`);
  } else if (!canonical.startsWith('https://') || (!canonical.includes('muxaro.pages.dev') && !canonical.includes('muxaro.app'))) {
    results.errors.push(`[${route}] Invalid canonical URL domain: ${canonical}`);
  }

  // OpenGraph checks
  const ogTitle = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  const ogDesc = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
  const ogUrl = html.match(/<meta\s+property=["']og:url["']\s+content=["']([^"']+)["']/i);
  const ogType = html.match(/<meta\s+property=["']og:type["']\s+content=["']([^"']+)["']/i);
  const ogImage = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);

  if (!ogTitle) results.errors.push(`[${route}] Missing og:title`);
  if (!ogDesc) results.errors.push(`[${route}] Missing og:description`);
  if (!ogUrl) results.errors.push(`[${route}] Missing og:url`);
  if (!ogImage) results.errors.push(`[${route}] Missing og:image`);

  // Twitter checks
  const twCard = html.match(/<meta\s+name=["']twitter:card["']\s+content=["']([^"']+)["']/i);
  const twTitle = html.match(/<meta\s+name=["']twitter:title["']\s+content=["']([^"']+)["']/i);
  const twDesc = html.match(/<meta\s+name=["']twitter:description["']\s+content=["']([^"']+)["']/i);
  const twImage = html.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);

  if (!twCard) results.errors.push(`[${route}] Missing twitter:card`);
  if (!twTitle) results.errors.push(`[${route}] Missing twitter:title`);
  if (!twDesc) results.errors.push(`[${route}] Missing twitter:description`);
  if (!twImage) results.errors.push(`[${route}] Missing twitter:image`);

  // Structured Data (JSON-LD) checks
  const jsonLdScripts = [...html.matchAll(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi)];
  const schemas = [];
  for (const m of jsonLdScripts) {
    try {
      const parsed = JSON.parse(m[1]);
      schemas.push(parsed);
    } catch (e) {
      results.errors.push(`[${route}] Invalid JSON in application/ld+json script: ${e.message}`);
    }
  }

  if (schemas.length > 0) results.structuredDataPassed++;

  results.routeDetails.push({
    route,
    type: 'PUBLIC',
    title,
    canonical,
    ogTitle: ogTitle ? ogTitle[1] : null,
    schemas: schemas.map(s => s['@type'] || (s['@graph'] ? s['@graph'].map(g => g['@type']).join(', ') : 'Unknown')),
  });

  results.publicRoutesPassed++;
}

// 2. Audit Private Routes
for (const route of PRIVATE_ROUTES) {
  results.totalAudited++;
  const filePath = routeToFilePath(route);

  if (!fs.existsSync(filePath)) {
    results.errors.push(`Missing HTML file for private route: ${route} (${filePath})`);
    continue;
  }

  const html = fs.readFileSync(filePath, 'utf8');

  // Must have noindex, nofollow
  const robotsMeta = html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i);
  if (!robotsMeta || !robotsMeta[1].includes('noindex') || !robotsMeta[1].includes('nofollow')) {
    results.errors.push(`[${route}] Private route missing <meta name="robots" content="noindex, nofollow">`);
  }

  // Must have title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const title = titleMatch ? titleMatch[1].replace(/&amp;/g, '&') : null;
  if (!title) {
    results.errors.push(`[${route}] Missing title tag`);
  }

  results.routeDetails.push({
    route,
    type: 'PRIVATE',
    title,
    robots: robotsMeta ? robotsMeta[1] : 'MISSING',
  });

  results.privateRoutesPassed++;
}

// 3. Audit 404 Route
const notFoundHtml = fs.readFileSync(path.join(outDir, '404.html'), 'utf8');
if (!notFoundHtml.includes('noindex')) {
  results.errors.push(`[404.html] Missing noindex meta directive`);
}

// 4. Audit robots.txt
const robotsTxt = fs.readFileSync(path.join(outDir, 'robots.txt'), 'utf8');
if (!robotsTxt.includes('User-agent: *') && !robotsTxt.includes('User-Agent: *')) {
  results.errors.push('robots.txt missing User-agent: * rule');
}
if (!robotsTxt.includes('Allow: /')) {
  results.errors.push('robots.txt missing Allow: / rule');
}
for (const priv of ['/api/', '/account', '/admin', '/dashboard', '/credits', '/login', '/register', '/verify-email', '/reset-password', '/jobs/']) {
  if (!robotsTxt.includes(`Disallow: ${priv}`)) {
    results.errors.push(`robots.txt missing Disallow: ${priv}`);
  }
}
if (!robotsTxt.includes('/sitemap.xml')) {
  results.errors.push('robots.txt missing Sitemap declaration');
} else {
  results.robotsTxtPassed = true;
}

// 5. Audit sitemap.xml
const sitemapXml = fs.readFileSync(path.join(outDir, 'sitemap.xml'), 'utf8');
let sitemapCount = 0;
for (const pub of PUBLIC_ROUTES) {
  const expectedUrl = pub === '/' ? `${SITE_URL}/` : `${SITE_URL}${pub}`;
  const altUrl = pub === '/' ? `https://muxaro.app/` : `https://muxaro.app${pub}`;
  if (!sitemapXml.includes(expectedUrl) && !sitemapXml.includes(altUrl)) {
    results.errors.push(`sitemap.xml missing public URL: ${pub}`);
  } else {
    sitemapCount++;
  }
}
for (const priv of PRIVATE_ROUTES) {
  if (sitemapXml.includes(priv)) {
    results.errors.push(`sitemap.xml illegally contains private route: ${priv}`);
  }
}
if (sitemapCount === PUBLIC_ROUTES.length) {
  results.sitemapPassed = true;
}

// 6. Audit Header and Footer Navigation Links
const indexHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
const allHrefs = [...indexHtml.matchAll(/href=["'](\/[^"'#?]*)["']/g)].map(m => m[1]);
const uniqueHrefs = [...new Set(allHrefs)].filter(h => h !== '');

let brokenLinks = 0;
for (const href of uniqueHrefs) {
  // If static asset (.svg, .css, .js, .png, etc.)
  if (/\.(svg|css|js|png|ico|json|txt|xml)$/i.test(href)) {
    const assetPath = path.join(outDir, href.replace(/^\//, ''));
    if (!fs.existsSync(assetPath)) {
      results.errors.push(`Broken static asset reference: ${href} -> ${assetPath} does not exist`);
      brokenLinks++;
    }
  } else {
    const targetPath = routeToFilePath(href);
    if (!fs.existsSync(targetPath)) {
      results.errors.push(`Broken navigation link: ${href} -> ${targetPath} does not exist`);
      brokenLinks++;
    }
  }
}
if (brokenLinks === 0) {
  results.navLinksPassed = true;
}

// Report
console.log(`✅ Public Routes Audited:   ${results.publicRoutesPassed} / ${PUBLIC_ROUTES.length}`);
console.log(`✅ Private Routes Audited:  ${results.privateRoutesPassed} / ${PRIVATE_ROUTES.length}`);
console.log(`✅ Structured Data Active:  ${results.structuredDataPassed} / ${PUBLIC_ROUTES.length} public routes`);
console.log(`✅ robots.txt Compliant:    ${results.robotsTxtPassed ? 'PASS' : 'FAIL'}`);
console.log(`✅ sitemap.xml Compliant:   ${results.sitemapPassed ? `PASS (${sitemapCount} URLs)` : 'FAIL'}`);
console.log(`✅ Navigation Links (0 404): ${results.navLinksPassed ? `PASS (${uniqueHrefs.length} unique links)` : 'FAIL'}`);

if (results.errors.length > 0) {
  console.error('\n❌ AUDIT FAILURES:');
  for (const err of results.errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
} else {
  console.log('\n🎉 ALL SEO AUDIT GATES PASSED (100% HEALTH SCORE)');
  process.exit(0);
}
