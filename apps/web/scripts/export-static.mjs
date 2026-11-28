import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const webDir = path.resolve(import.meta.dirname, '..');
const apiDir = path.join(webDir, 'app', 'api');
const backupDir = path.join(webDir, '.static-export-api-backup');
const nextDir = path.join(webDir, '.next');

// Recover from an interrupted prior run if needed
if (!fs.existsSync(apiDir) && fs.existsSync(backupDir)) {
  fs.renameSync(backupDir, apiDir);
}

let movedApiDir = false;
if (fs.existsSync(apiDir)) {
  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
  fs.renameSync(apiDir, backupDir);
  movedApiDir = true;
}

try {
  if (fs.existsSync(nextDir)) {
    fs.rmSync(nextDir, { recursive: true, force: true });
  }
  console.log('[export-static] Running Next.js static export build (STATIC_EXPORT=1)...');
  execSync('npx next build --webpack', {
    cwd: webDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      STATIC_EXPORT: '1',
      CLOUDFLARE_PAGES: '1',
    },
  });
  console.log('[export-static] Export complete at apps/web/out');
} finally {
  if (movedApiDir && fs.existsSync(backupDir)) {
    if (fs.existsSync(apiDir)) {
      fs.rmSync(apiDir, { recursive: true, force: true });
    }
    fs.renameSync(backupDir, apiDir);
  }
}
