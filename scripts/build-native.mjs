#!/usr/bin/env zx
import path from 'node:path';
import fs from 'node:fs';

if (process.platform === 'win32' && typeof usePowerShell === 'function') {
  usePowerShell();
}

const rootDir = path.resolve(import.meta.dirname, '..');
const webDir = path.join(rootDir, 'apps', 'web');
const desktopDir = path.join(rootDir, 'apps', 'desktop');
const mobileDir = path.join(rootDir, 'apps', 'mobile');
const androidDir = path.join(mobileDir, 'android');
const distDir = path.join(rootDir, 'dist');
fs.mkdirSync(distDir, { recursive: true });

const exeOnly = Boolean(argv['exe-only']);
const apkOnly = Boolean(argv['apk-only']);
const skipWeb = Boolean(argv['skip-web']);

const buildExe = !apkOnly;
const buildApk = !exeOnly;

echo(chalk.cyan('=== MUXARO APK & EXE Department Build Pipeline (zx) ==='));

if (!skipWeb) {
  echo(chalk.yellow('[1/4] Typechecking & linting React UI bundle...'));
  cd(webDir);
  await $`npm run lint`;

  echo(chalk.yellow('[2/4] Preparing offline PDF/WASM assets & static export...'));
  await $`node scripts/prepare-pdf-assets.mjs`;
  await $`node scripts/export-static.mjs`;
}

if (buildExe) {
  echo(chalk.yellow('[3/4] Building Windows Desktop Studio (.exe)...'));
  cd(desktopDir);
  await $`npm run build`;
  const exePath = path.join(desktopDir, 'release', 'MUXARO-Studio-Windows-x64.exe');
  if (!fs.existsSync(exePath)) {
    throw new Error(`Expected EXE missing at ${exePath}`);
  }
  const distExe = path.join(distDir, 'MUXARO-Studio-Windows-x64.exe');
  fs.copyFileSync(exePath, distExe);
  const exeMb = (fs.statSync(distExe).size / (1024 * 1024)).toFixed(1);
  echo(chalk.green(`✔ Windows EXE built & synced: ${distExe} (${exeMb} MB)`));
}

if (buildApk) {
  echo(chalk.yellow('[4/4] Syncing Capacitor & building Android APK via Gradle...'));
  cd(mobileDir);
  await $`npm run prepare:www`;
  await $`npx cap sync android`;
  cd(androidDir);
  const jbrPath = 'C:\\Program Files\\Android\\Android Studio\\jbr';
  if (process.platform === 'win32' && fs.existsSync(jbrPath)) {
    process.env.JAVA_HOME = jbrPath;
    process.env.PATH = `${path.join(jbrPath, 'bin')};${process.env.PATH || ''}`;
  }
  if (process.platform === 'win32') {
    await $`cmd /c gradlew.bat assembleDebug --no-daemon`;
  } else {
    await $`./gradlew assembleDebug --no-daemon`;
  }
  const apkPath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  if (!fs.existsSync(apkPath)) {
    throw new Error(`Expected APK missing at ${apkPath}`);
  }
  const distApk = path.join(distDir, 'MUXARO-Studio.apk');
  fs.copyFileSync(apkPath, distApk);
  const apkMb = (fs.statSync(distApk).size / (1024 * 1024)).toFixed(1);
  echo(chalk.green(`✔ Android APK built & synced: ${distApk} (${apkMb} MB)`));
}

echo(chalk.cyan('=== MUXARO Native Build Complete ==='));
