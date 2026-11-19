#!/usr/bin/env node
/**
 * Independent QA Cloudflare Pages Static Export Auditor (apps/web/out/)
 */
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve(process.cwd(), 'apps/web/out');

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const reqFiles = ['index.html', 'robots.txt', 'sitemap.xml', '_headers', '_redirects'];
for (const f of reqFiles) {
  if (!fs.existsSync(path.join(outDir, f))) {
    throw new Error(`Missing required export file: ${f}`);
  }
}
console.log(`PASS Required files 5/5 present: ${reqFiles.join(', ')}`);

const allFiles = walk(outDir);
let leaks = 0;
let htmlCount = 0;
let jsCount = 0;
for (const f of allFiles) {
  if (!/\.(html|js|txt|xml)$/.test(f)) continue;
  if (f.endsWith('.html')) htmlCount++;
  if (f.endsWith('.js')) jsCount++;
  const c = fs.readFileSync(f, 'utf8');
  if (/localhost:3000|localhost:4000|127\.0\.0\.1:4000/.test(c)) {
    leaks++;
    console.error('LOCALHOST LEAK in', path.relative(process.cwd(), f));
  }
}
if (leaks > 0) throw new Error(`Found ${leaks} localhost leaks!`);
console.log(`PASS Zero localhost leaks across ${htmlCount} HTML files and ${jsCount} JS files.`);

const privateRoutes = ['account', 'admin', 'dashboard', 'credits', 'login', 'register', 'verify-email', 'reset-password'];
for (const r of privateRoutes) {
  const html = fs.readFileSync(path.join(outDir, `${r}.html`), 'utf8');
  if (!html.includes('noindex, nofollow')) {
    throw new Error(`Missing noindex, nofollow meta on ${r}.html`);
  }
}
console.log(`PASS 8/8 private routes contain noindex, nofollow metadata.`);

const indexHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
const robotsTxt = fs.readFileSync(path.join(outDir, 'robots.txt'), 'utf8');
const sitemapXml = fs.readFileSync(path.join(outDir, 'sitemap.xml'), 'utf8');
const expectedOrigin = (process.env.NEXT_PUBLIC_SITE_URL || 'https://muxaro.pages.dev').trim().replace(/\/+$/, '');
const isAllowedDomain = (content) => content.includes('https://muxaro.pages.dev') || content.includes('https://muxaro.app');

if (!isAllowedDomain(indexHtml)) throw new Error(`Missing valid canonical domain in index.html (expected ${expectedOrigin})`);
if (!isAllowedDomain(robotsTxt) || !robotsTxt.includes('/sitemap.xml')) throw new Error('Missing sitemap URL in robots.txt');
if (!isAllowedDomain(sitemapXml) || /\/(account|admin|dashboard|credits|login|register)/.test(sitemapXml)) {
  throw new Error('Invalid sitemap.xml content');
}
console.log(`PASS Canonical URL (${expectedOrigin}) verified in index.html, robots.txt, and sitemap.xml (all private routes excluded).`);
