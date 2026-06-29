const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const outDir = path.join(__dirname, "..", "icons");
const sourceSize = 512;
const viewBox = 128;
const scale = sourceSize / viewBox;
const image = new Uint8ClampedArray(sourceSize * sourceSize * 4);

function rgba(hex, alpha = 255) {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
    alpha
  ];
}

function blendPixel(x, y, color, coverage = 1) {
  if (x < 0 || y < 0 || x >= sourceSize || y >= sourceSize) return;
  const index = (Math.floor(y) * sourceSize + Math.floor(x)) * 4;
  const alpha = (color[3] / 255) * coverage;
  const inv = 1 - alpha;
  image[index] = Math.round(color[0] * alpha + image[index] * inv);
  image[index + 1] = Math.round(color[1] * alpha + image[index + 1] * inv);
  image[index + 2] = Math.round(color[2] * alpha + image[index + 2] * inv);
  image[index + 3] = Math.round(255 * alpha + image[index + 3] * inv);
}

function pointInRoundedRect(px, py, x, y, w, h, r) {
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) <= r;
}

function fillRoundedRect(x, y, w, h, r, color) {
  const sx = Math.floor(x * scale);
  const sy = Math.floor(y * scale);
  const ex = Math.ceil((x + w) * scale);
  const ey = Math.ceil((y + h) * scale);
  for (let py = sy; py < ey; py++) {
    for (let px = sx; px < ex; px++) {
      const vx = (px + 0.5) / scale;
      const vy = (py + 0.5) / scale;
      if (pointInRoundedRect(vx, vy, x, y, w, h, r)) blendPixel(px, py, color);
    }
  }
}

function strokeRoundedRect(x, y, w, h, r, width, color) {
  fillRoundedRect(x, y, w, h, r, color);
  fillRoundedRect(x + width, y + width, w - width * 2, h - width * 2, Math.max(0, r - width), rgba("#111820"));
}

function fillCircle(cx, cy, radius, color) {
  const sx = Math.floor((cx - radius) * scale);
  const sy = Math.floor((cy - radius) * scale);
  const ex = Math.ceil((cx + radius) * scale);
  const ey = Math.ceil((cy + radius) * scale);
  for (let y = sy; y < ey; y++) {
    for (let x = sx; x < ex; x++) {
      const dx = (x + 0.5) / scale - cx;
      const dy = (y + 0.5) / scale - cy;
      if (Math.hypot(dx, dy) <= radius) blendPixel(x, y, color);
    }
  }
}

function strokeCircle(cx, cy, radius, width, stroke, fill) {
  fillCircle(cx, cy, radius, stroke);
  fillCircle(cx, cy, radius - width, fill);
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function strokeLine(ax, ay, bx, by, width, color) {
  const pad = width / 2 + 1;
  const sx = Math.floor((Math.min(ax, bx) - pad) * scale);
  const sy = Math.floor((Math.min(ay, by) - pad) * scale);
  const ex = Math.ceil((Math.max(ax, bx) + pad) * scale);
  const ey = Math.ceil((Math.max(ay, by) + pad) * scale);
  for (let y = sy; y < ey; y++) {
    for (let x = sx; x < ex; x++) {
      const vx = (x + 0.5) / scale;
      const vy = (y + 0.5) / scale;
      if (distanceToSegment(vx, vy, ax, ay, bx, by) <= width / 2) blendPixel(x, y, color);
    }
  }
}

function pointInPolygon(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function fillPolygon(points, color) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const sx = Math.floor(minX * scale);
  const sy = Math.floor(minY * scale);
  const ex = Math.ceil(maxX * scale);
  const ey = Math.ceil(maxY * scale);
  for (let y = sy; y < ey; y++) {
    for (let x = sx; x < ex; x++) {
      const vx = (x + 0.5) / scale;
      const vy = (y + 0.5) / scale;
      if (pointInPolygon(vx, vy, points)) blendPixel(x, y, color);
    }
  }
}

// Four-point sparkle (AI "spark") centered at (cx, cy).
function sparklePoints(cx, cy, outer, inner) {
  const d = inner * Math.SQRT1_2;
  return [
    [cx, cy - outer],
    [cx + d, cy - d],
    [cx + outer, cy],
    [cx + d, cy + d],
    [cx, cy + outer],
    [cx - d, cy + d],
    [cx - outer, cy],
    [cx - d, cy - d]
  ];
}

function renderSource() {
  // Dark rounded tile with a subtly lighter inner face for depth.
  fillRoundedRect(0, 0, 128, 128, 28, rgba("#0d1620"));
  fillRoundedRect(6, 6, 116, 116, 23, rgba("#152433"));
  // Orange side panel docked on the right (the product metaphor + brand color).
  fillRoundedRect(82, 22, 24, 84, 11, rgba("#f48120"));
  // Big teal AI sparkle in the main area.
  fillPolygon(sparklePoints(48, 64, 30, 11), rgba("#4fd1d9"));
}

function downsample(size) {
  const output = Buffer.alloc(size * size * 4);
  const ratio = sourceSize / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const totals = [0, 0, 0, 0];
      let count = 0;
      for (let sy = Math.floor(y * ratio); sy < Math.floor((y + 1) * ratio); sy++) {
        for (let sx = Math.floor(x * ratio); sx < Math.floor((x + 1) * ratio); sx++) {
          const index = (sy * sourceSize + sx) * 4;
          totals[0] += image[index];
          totals[1] += image[index + 1];
          totals[2] += image[index + 2];
          totals[3] += image[index + 3];
          count++;
        }
      }
      const out = (y * size + x) * 4;
      output[out] = Math.round(totals[0] / count);
      output[out + 1] = Math.round(totals[1] / count);
      output[out + 2] = Math.round(totals[2] / count);
      output[out + 3] = Math.round(totals[3] / count);
    }
  }
  return output;
}

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function png(size, rgbaBuffer) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const scanlines = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const scanline = y * (size * 4 + 1);
    scanlines[scanline] = 0;
    rgbaBuffer.copy(scanlines, scanline + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

fs.mkdirSync(outDir, { recursive: true });
renderSource();
for (const size of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), png(size, downsample(size)));
}
