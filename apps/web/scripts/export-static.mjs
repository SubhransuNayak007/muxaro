import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const webDir = path.resolve(import.meta.dirname, '..');
const routeFile = path.join(webDir, 'app', 'api', 'v1', '[...path]', 'route.ts');
const nextDir = path.join(webDir, '.next');

let savedRouteContent = null;
if (fs.existsSync(routeFile)) {
  savedRouteContent = fs.readFileSync(routeFile, 'utf8');
  fs.rmSync(routeFile, { force: true });
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
  if (savedRouteContent !== null) {
    fs.mkdirSync(path.dirname(routeFile), { recursive: true });
    fs.writeFileSync(routeFile, savedRouteContent, 'utf8');
  }
}
