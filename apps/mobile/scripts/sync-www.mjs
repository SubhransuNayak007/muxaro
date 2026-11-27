import fs from 'node:fs';
import path from 'node:path';

const mobileDir = path.resolve(import.meta.dirname, '..');
const webOutDir = path.resolve(mobileDir, '..', 'web', 'out');
const wwwDir = path.join(mobileDir, 'www');

if (!fs.existsSync(webOutDir)) {
  throw new Error(`Missing web static export at ${webOutDir}. Run apps/web export-static.mjs first.`);
}

if (fs.existsSync(wwwDir)) {
  fs.rmSync(wwwDir, { recursive: true, force: true });
}

fs.cpSync(webOutDir, wwwDir, { recursive: true });

// Keep root /desktop-home.html backup and make root index.html boot directly into the pre-rendered /m/ Mobile Studio
// IMPORTANT: Capacitor WebViewLocalServer (html5mode: true) maps extensionless routes like /m/ back to /index.html.
// Serving a redirect to /m/ in /index.html caused an infinite redirect loop and black screen on Android!
const rootIndex = path.join(wwwDir, 'index.html');
const mobileIndex = path.join(wwwDir, 'm', 'index.html');
if (!fs.existsSync(mobileIndex)) {
  throw new Error(`Missing exported mobile entry at ${mobileIndex}. Check apps/web/app/m/page.tsx build.`);
}
if (fs.existsSync(rootIndex)) {
  fs.copyFileSync(rootIndex, path.join(wwwDir, 'desktop-home.html'));
}
let mobileHtml = fs.readFileSync(mobileIndex, 'utf8');
const bootScript = `<script>(function(){try{if(window.location.pathname==='/'||window.location.pathname==='/index.html'){window.history.replaceState(null,'','/m/');}}catch(e){}})();</script>`;
if (mobileHtml.includes('<head>')) {
  mobileHtml = mobileHtml.replace('<head>', `<head>${bootScript}`);
} else {
  mobileHtml = `${bootScript}${mobileHtml}`;
}
fs.writeFileSync(rootIndex, mobileHtml, 'utf8');

console.log('[sync-www] Synced offline static bundle to apps/mobile/www cleanly.');
