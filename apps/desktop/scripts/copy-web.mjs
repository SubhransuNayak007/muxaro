import fs from 'node:fs';
import path from 'node:path';

const desktopDir = path.resolve(import.meta.dirname, '..');
const webOutDir = path.resolve(desktopDir, '..', 'web', 'out');
const targetDir = path.join(desktopDir, 'web-dist');
const assetsDir = path.join(desktopDir, 'assets');
const iconSrc = path.resolve(desktopDir, '..', 'web', 'public', 'brand', 'muxaro-brand-master.png');

if (!fs.existsSync(webOutDir)) {
  throw new Error(`Missing web static export at ${webOutDir}`);
}

if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, force: true });
}
fs.cpSync(webOutDir, targetDir, { recursive: true });

fs.mkdirSync(assetsDir, { recursive: true });
if (fs.existsSync(iconSrc)) {
  fs.copyFileSync(iconSrc, path.join(assetsDir, 'icon.png'));
}

console.log('[desktop] Copied web static bundle and icon cleanly.');
