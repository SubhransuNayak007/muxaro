import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendorRoot = resolve(webRoot, 'public/vendor');

async function copyDirIfExists(srcDir, dstDir) {
  if (!existsSync(srcDir)) return 0;
  await mkdir(dstDir, { recursive: true });
  let count = 0;
  for (const entry of await readdir(srcDir, { withFileTypes: true })) {
    const srcPath = resolve(srcDir, entry.name);
    const dstPath = resolve(dstDir, entry.name);
    if (entry.isDirectory()) {
      count += await copyDirIfExists(srcPath, dstPath);
    } else if (entry.isFile()) {
      await copyFile(srcPath, dstPath);
      count += 1;
    }
  }
  return count;
}

async function copyFileSafe(srcPath, dstPath) {
  if (!existsSync(srcPath)) return false;
  await mkdir(dirname(dstPath), { recursive: true });
  await copyFile(srcPath, dstPath);
  return true;
}

async function preparePdfjs() {
  const pdfjsDir = resolve(webRoot, 'node_modules/pdfjs-dist');
  const target = resolve(vendorRoot, 'pdfjs');
  let count = 0;

  for (const workerCandidate of [
    resolve(pdfjsDir, 'legacy/build/pdf.worker.min.mjs'),
    resolve(pdfjsDir, 'build/pdf.worker.min.mjs'),
  ]) {
    if (await copyFileSafe(workerCandidate, resolve(target, 'pdf.worker.min.mjs'))) {
      count += 1;
      break;
    }
  }

  for (const sub of ['wasm', 'cmaps', 'standard_fonts']) {
    count += await copyDirIfExists(resolve(pdfjsDir, sub), resolve(target, sub));
  }
  return count;
}

async function prepareQpdf() {
  const qpdfRoot = resolve(webRoot, 'node_modules/qpdf-run');
  const target = resolve(vendorRoot, 'qpdf');
  let count = 0;

  const pairs = [
    ['src/worker.js', 'worker.js'],
    ['vendor/qpdf/lib/qpdf.js', 'qpdf.js'],
    ['vendor/qpdf/lib/qpdf.wasm', 'qpdf.wasm'],
  ];

  for (const [relSrc, relDst] of pairs) {
    if (await copyFileSafe(resolve(qpdfRoot, relSrc), resolve(target, relDst))) {
      count += 1;
    }
  }
  return count;
}

async function prepareTesseract() {
  const target = resolve(vendorRoot, 'tesseract');
  let count = 0;

  const pairs = [
    ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
    ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js'],
    ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm', 'core/tesseract-core-lstm.wasm'],
    ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js'],
    ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', 'core/tesseract-core-simd-lstm.wasm'],
  ];

  for (const [relSrc, relDst] of pairs) {
    if (await copyFileSafe(resolve(webRoot, relSrc), resolve(target, relDst))) {
      count += 1;
    }
  }

  const engGz = resolve(
    webRoot,
    'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'
  );
  if (existsSync(engGz)) {
    const model = gunzipSync(await readFile(engGz));
    await mkdir(resolve(target, 'lang'), { recursive: true });
    await writeFile(resolve(target, 'lang/eng.traineddata'), model);
    await rm(resolve(target, 'lang/eng.traineddata.gz'), { force: true });
    count += 1;
  }

  return count;
}

async function prepareFonts() {
  const target = resolve(vendorRoot, 'fonts');
  const families = ['inter', 'plus-jakarta-sans', 'jetbrains-mono', 'merriweather'];
  const weights = ['400', '600', '700'];
  const styles = ['normal', 'italic'];
  let count = 0;

  for (const family of families) {
    for (const weight of weights) {
      for (const style of styles) {
        const fileName = `${family}-latin-${weight}-${style}.woff`;
        const srcPath = resolve(webRoot, 'node_modules/@fontsource', family, 'files', fileName);
        if (await copyFileSafe(srcPath, resolve(target, family, fileName))) {
          count += 1;
        }
      }
    }
  }
  return count;
}

const pdfjsCount = await preparePdfjs();
const qpdfCount = await prepareQpdf();
const ocrCount = await prepareTesseract();
const fontCount = await prepareFonts();
console.log(
  `Prepared PDF assets: pdfjs=${pdfjsCount}, qpdf=${qpdfCount}, tesseract=${ocrCount}, fonts=${fontCount}`
);
