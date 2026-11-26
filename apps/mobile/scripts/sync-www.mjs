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

// Keep root /studio-web backup and make default mobile entry redirect instantaneously into /m/
const rootIndex = path.join(wwwDir, 'index.html');
if (fs.existsSync(rootIndex)) {
  fs.copyFileSync(rootIndex, path.join(wwwDir, 'desktop-home.html'));
  fs.writeFileSync(
    rootIndex,
    `<!DOCTYPE html><html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="refresh" content="0;url=/m/"><title>MUXARO</title><style>body{margin:0;background:#0B0C0F;color:#F0F2F5;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}</style><script>window.location.replace('/m/');</script></head><body>MUXARO Studio…</body></html>`,
    'utf8'
  );
}

console.log('[sync-www] Synced offline static bundle to apps/mobile/www cleanly.');
