'use strict';
/**
 * Renders the Sentinel mask icons as PNGs, with no image dependencies.
 * Shapes are evaluated analytically and supersampled 4x for clean edges.
 *
 *   node scripts/make-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [16, 32, 48, 128, 256, 512];
const OUT_DIR = path.join(__dirname, '..', 'extension', 'icons');

const BG = [23, 25, 29, 255];        // charcoal
const GOLD = [214, 178, 90, 255];    // sentinel gold
const GOLD_DIM = [176, 142, 62, 255];

/* ------------------------------------------------------------ shape maths */

const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
  255
];

const inEllipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

/**
 * The mask silhouette in a unit square: a rounded top that tapers to a chin,
 * with two eye holes and a smile cut out of it.
 */
function maskAlpha(u, v) {
  // u,v in [0,1]; centre the face horizontally.
  const x = u - 0.5;
  const y = v - 0.5;

  // Body: a broad brow that tapers to a chin.
  let halfWidth;
  if (y < 0) {
    halfWidth = 0.45 * Math.sqrt(Math.max(0, 1 - (y / 0.47) ** 2));
  } else {
    halfWidth = 0.45 * Math.sqrt(Math.max(0, 1 - (y / 0.56) ** 2)) * (1 - 0.30 * (y / 0.56));
  }
  if (Math.abs(x) > halfWidth) return 0;

  // Eyes.
  if (inEllipse(x, y, -0.165, -0.10, 0.098, 0.082)) return 0;
  if (inEllipse(x, y, 0.165, -0.10, 0.098, 0.082)) return 0;

  // Smile: a band following an upward-opening parabola, clipped to the mouth.
  if (Math.abs(x) < 0.21) {
    const curve = 0.21 - 1.4 * x * x;
    if (Math.abs(y - curve) < 0.042) return 0;
  }

  return 1;
}

function roundedSquare(u, v, radius) {
  const x = Math.min(u, 1 - u);
  const y = Math.min(v, 1 - v);
  if (x > radius || y > radius) return 1;
  const dx = radius - x;
  const dy = radius - y;
  return Math.hypot(dx, dy) <= radius ? 1 : 0;
}

/* -------------------------------------------------------------- png output */

function crc32(buf) {
  let c;
  if (!crc32.table) {
    crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32.table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = crc32.table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ----------------------------------------------------------------- render */

function render(size) {
  const ss = 4;                       // supersampling factor
  const pixels = Buffer.alloc(size * size * 4);
  const pad = size >= 48 ? 0.11 : 0.06;
  const radius = 0.23;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;

      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (px + (sx + 0.5) / ss) / size;
          const v = (py + (sy + 0.5) / ss) / size;

          let color = [0, 0, 0, 0];
          if (roundedSquare(u, v, radius)) {
            color = BG;
            // Map the plate area onto the mask's unit square.
            const mu = (u - pad) / (1 - 2 * pad);
            const mv = (v - pad) / (1 - 2 * pad);
            if (mu >= 0 && mu <= 1 && mv >= 0 && mv <= 1 && maskAlpha(mu, mv)) {
              const t = Math.max(0, Math.min(1, (mv - 0.35) / 0.6));
              color = mix(GOLD, GOLD_DIM, t);   // gentle shading toward the chin
            }
          }
          r += color[0] * color[3]; g += color[1] * color[3]; b += color[2] * color[3]; a += color[3];
        }
      }

      const n = ss * ss;
      const alpha = a / n;
      const i = (py * size + px) * 4;
      pixels[i] = alpha ? Math.round(r / a) : 0;
      pixels[i + 1] = alpha ? Math.round(g / a) : 0;
      pixels[i + 2] = alpha ? Math.round(b / a) : 0;
      pixels[i + 3] = Math.round(alpha);
    }
  }
  return encodePng(size, size, pixels);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUT_DIR, `icon${size}.png`);
  fs.writeFileSync(file, render(size));
  console.log(`  icon${size}.png  ${fs.statSync(file).size} bytes`);
}
console.log('Icons written to extension/icons/');

// App icons for the installable web app.
const WEB_DIR = path.join(__dirname, '..', 'web', 'assets', 'img');
fs.mkdirSync(WEB_DIR, { recursive: true });
for (const size of [192, 512]) fs.writeFileSync(path.join(WEB_DIR, `icon-${size}.png`), render(size));
console.log('Web app icons written to web/assets/img/');
