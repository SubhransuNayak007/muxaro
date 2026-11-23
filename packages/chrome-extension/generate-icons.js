const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ -1) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type);
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([lenBuf, body, crcBuf]);
}

function createPng(width, height, drawPixel) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // no interlace

  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = drawPixel(x, y, width, height);
      const pxOffset = rowOffset + 1 + x * 4;
      raw[pxOffset] = r;
      raw[pxOffset + 1] = g;
      raw[pxOffset + 2] = b;
      raw[pxOffset + 3] = a;
    }
  }

  const idatData = zlib.deflateSync(raw);
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', idatData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

function renderMuxaroIcon(x, y, size) {
  // Normalize coordinates to 0..1
  const nx = x / size;
  const ny = y / size;

  // Rounded squircle container
  const cornerRadius = 0.22;
  const dx = Math.max(0, Math.abs(nx - 0.5) - (0.5 - cornerRadius));
  const dy = Math.max(0, Math.abs(ny - 0.5) - (0.5 - cornerRadius));
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > cornerRadius) {
    return [0, 0, 0, 0]; // Transparent background
  }

  // Smooth antialias on squircle edge
  let alpha = 255;
  if (dist > cornerRadius - 0.02) {
    alpha = Math.round(255 * (1 - (dist - (cornerRadius - 0.02)) / 0.02));
  }

  // Background deep dark slate base: #090d16
  let bgR = 10;
  let bgG = 14;
  let bgB = 24;

  // Subtle diagonal dark gradient
  const diag = (nx + ny) * 0.5;
  bgR = Math.round(bgR + diag * 8);
  bgG = Math.round(bgG + diag * 10);
  bgB = Math.round(bgB + diag * 20);

  // Border ring: subtle indigo/cyan stroke
  const isBorder = (dist > cornerRadius - 0.05 && dist <= cornerRadius) ||
                   (nx < 0.04 || nx > 0.96 || ny < 0.04 || ny > 0.96);
  if (isBorder) {
    const strokeR = Math.round(79 + nx * 50);
    const strokeG = Math.round(70 + ny * 60);
    const strokeB = Math.round(229 + (1 - nx) * 20);
    return [strokeR, strokeG, strokeB, alpha];
  }

  // Stylized "M" / Bridge glyph in center
  // Two pillars and chevron center
  // Left leg: x ~ 0.22 to 0.35, y ~ 0.25 to 0.75
  // Right leg: x ~ 0.65 to 0.78, y ~ 0.25 to 0.75
  // Center V: from (0.35, 0.3) -> (0.5, 0.6) -> (0.65, 0.3)
  const isLeftLeg = nx >= 0.22 && nx <= 0.34 && ny >= 0.25 && ny <= 0.75;
  const isRightLeg = nx >= 0.66 && nx <= 0.78 && ny >= 0.25 && ny <= 0.75;

  // Left diagonal to center: slope from (0.28, 0.32) down to (0.5, 0.62)
  const leftDiagCenter = 0.32 + (nx - 0.28) * ((0.62 - 0.32) / (0.5 - 0.28));
  const isLeftDiag = nx >= 0.28 && nx <= 0.51 && Math.abs(ny - leftDiagCenter) < 0.07;

  // Right diagonal from center: slope from (0.5, 0.62) up to (0.72, 0.32)
  const rightDiagCenter = 0.62 - (nx - 0.5) * ((0.62 - 0.32) / (0.72 - 0.5));
  const isRightDiag = nx >= 0.49 && nx <= 0.72 && Math.abs(ny - rightDiagCenter) < 0.07;

  // Direct fast-speed chevron indicator dot (representing direct connection / stream bridge)
  const dCenterDot = Math.hypot(nx - 0.5, ny - 0.35);
  const isDot = dCenterDot < 0.065;

  if (isLeftLeg || isLeftDiag || isRightLeg || isRightDiag || isDot) {
    // Electric Indigo to Cyan gradient:
    // Left: #6366f1 (99, 102, 241) -> Right: #06b6d4 (6, 182, 212)
    const t = nx;
    const glyphR = Math.round(99 * (1 - t) + 6 * t);
    const glyphG = Math.round(102 * (1 - t) + 182 * t);
    const glyphB = Math.round(241 * (1 - t) + 212 * t);
    return [glyphR, glyphG, glyphB, alpha];
  }

  return [bgR, bgG, bgB, alpha];
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

[16, 48, 128].forEach(size => {
  const pngData = createPng(size, size, (x, y) => renderMuxaroIcon(x, y, size));
  const targetPath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(targetPath, pngData);
  console.log(`Generated ${targetPath} (${pngData.length} bytes)`);
});
