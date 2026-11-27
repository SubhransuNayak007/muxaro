import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const desktopDir = path.resolve(import.meta.dirname, '..');
const webOutDir = path.resolve(desktopDir, '..', 'web', 'out');
const targetDir = path.join(desktopDir, 'web-dist');
const assetsDir = path.join(desktopDir, 'assets');
const binDir = path.join(desktopDir, 'bin');
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

// Ensure real native ffmpeg.exe sits in bin/ outside app.asar so yt-dlp.exe & spawn() can execute it
fs.mkdirSync(binDir, { recursive: true });
try {
  const ffmpegStaticPath = require('ffmpeg-static');
  if (typeof ffmpegStaticPath === 'string' && fs.existsSync(ffmpegStaticPath)) {
    const destFfmpeg = path.join(binDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    const srcStat = fs.statSync(ffmpegStaticPath);
    const needsCopy = !fs.existsSync(destFfmpeg) || fs.statSync(destFfmpeg).size !== srcStat.size;
    if (needsCopy) {
      fs.copyFileSync(ffmpegStaticPath, destFfmpeg);
    }
    console.log(`[desktop] Verified native FFmpeg binary at ${destFfmpeg}`);
  }
} catch (err) {
  console.warn('[desktop] Could not copy ffmpeg-static into bin/:', err instanceof Error ? err.message : err);
}

console.log('[desktop] Copied web static bundle, native binaries, and icon cleanly.');
