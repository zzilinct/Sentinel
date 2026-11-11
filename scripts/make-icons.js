'use strict';
/**
 * Every picture of the Sentinel mark, drawn from one source: the logo paths in web/assets/js/masks.js (the same
 * shield and helmet the site's header, the app and the companion draw as vectors) and the mark colours in brand.json.
 * No image dependencies: the paths are flattened and filled with even-odd scanlines, 4x4 supersampled.
 *
 *   node scripts/make-icons.js           write every file
 *   node scripts/make-icons.js --check   write nothing; fail if a committed file differs (npm test runs this)
 *
 * At 16 to 32 pixels the full mark (a thin shield ring around a small helmet) turns to mud, so those sizes use the
 * small mark: a solid gold shield with the helmet cut out of it, eyes in gold. 16 px (tray, tab) is drawn by hand.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const BRAND = require('../brand.json').mark;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const PLATE = hex(BRAND.plate);
const GOLD = hex(BRAND.gold);
const GOLD_LIGHT = hex(BRAND.goldLight);
const GOLD_DEEP = hex(BRAND.goldDeep);

/* ---------------------------------------------------------- the paths */

const MASKS_SRC = fs.readFileSync(path.join(ROOT, 'web', 'assets', 'js', 'masks.js'), 'utf8');
const pathOf = (name) => {
  const m = MASKS_SRC.match(new RegExp(`var ${name} = '([^']+)'`));
  if (!m) throw new Error(`masks.js has no ${name} path`);
  return m[1];
};
const SHIELD = pathOf('SHIELD');
const HELMET = pathOf('HELMET');
const EYES = pathOf('EYES');
const CHEEKS = pathOf('CHEEKS');
const RIVET = pathOf('RIVET');
// The shield's outer edge alone: its first subpath (the second is the hole that makes it a ring).
const SHIELD_SOLID = SHIELD.slice(0, SHIELD.slice(1).search(/[Mm]/) + 1);

/** Flattens an SVG path into closed polygons of [x, y] points. Handles the commands the mark uses: M L H V C A Z. */
function flatten(d) {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g);
  const polys = [];
  let poly = null, x = 0, y = 0, sx = 0, sy = 0, cmd = '', i = 0;
  const num = () => Number(tokens[i++]);
  const to = (nx, ny) => { x = nx; y = ny; poly.push([x, y]); };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        x = ox + num(); y = oy + num(); sx = x; sy = y;
        poly = [[x, y]]; polys.push(poly);
        cmd = rel ? 'l' : 'L';   // further pairs are line-tos
        break;
      }
      case 'L': to(ox + num(), oy + num()); break;
      case 'H': to(ox + num(), y); break;
      case 'V': to(x, oy + num()); break;
      case 'C': {
        const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num(), x3 = ox + num(), y3 = oy + num();
        const x0 = x, y0 = y;
        for (let k = 1; k <= 16; k++) {
          const t = k / 16, u = 1 - t;
          to(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
            u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
        }
        break;
      }
      case 'A': {
        let rx = Math.abs(num()), ry = Math.abs(num());
        const phi = (num() * Math.PI) / 180, large = num(), sweep = num();
        const x2 = ox + num(), y2 = oy + num();
        // Endpoint to centre form (SVG 1.1, appendix F.6.5).
        const cos = Math.cos(phi), sin = Math.sin(phi);
        const dx = (x - x2) / 2, dy = (y - y2) / 2;
        const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
        const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
        if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
        const sign = large === sweep ? -1 : 1;
        const co = sign * Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p) / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
        const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
        const cx = cos * cxp - sin * cyp + (x + x2) / 2, cy = sin * cxp + cos * cyp + (y + y2) / 2;
        const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
        const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
        let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
        if (!sweep && dt > 0) dt -= 2 * Math.PI;
        if (sweep && dt < 0) dt += 2 * Math.PI;
        for (let k = 1; k <= 24; k++) {
          const t = t1 + (dt * k) / 24;
          to(cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos);
        }
        x = x2; y = y2;
        break;
      }
      case 'Z': x = sx; y = sy; break;
      default: throw new Error(`make-icons: path command ${cmd} is not supported`);
    }
  }
  return polys;
}

/** A shape: polygons in the mark's 64-unit space, moved by scale s about (cx, cy), as `transform` does in masks.js. */
const shape = (d, s = 1, cx = 32, cy = 32) => flatten(d).map((p) => p.map(([px, py]) => [cx + (px - cx) * s, cy + (py - cy) * s]));

// The full mark, exactly as masks.js draws GLYPHS.logo: the shield ring, and the helmet at .70 about (32, 30.5).
const FULL = [shape(SHIELD), shape(HELMET + EYES + CHEEKS, 0.7, 32, 30.5), shape(RIVET, 0.7, 32, 30.5)];
// The small mark: a solid shield; the helmet, larger, cut out of it in the plate colour, its eyes left in gold.
const SMALL = { inset: 0.86, helmet: 0.8, cy: 31 };
const SMALL_GOLD = [shape(SHIELD_SOLID)];
const SMALL_CUT = shape(HELMET + EYES, SMALL.helmet, 32, SMALL.cy);

/* ------------------------------------------------------------ the fill */

/** Coverage (0..1 per pixel) of the even-odd union of `shapes`, placed by map(x, y) -> pixel. */
function coverage(width, height, shapes, map) {
  const ss = 4;
  const W = width * ss, H = height * ss;
  const hits = new Uint8Array(W * H);
  for (const polys of shapes) {
    const edges = [];
    for (const p of polys) {
      for (let k = 0; k < p.length; k++) {
        const a = map(p[k]), b = map(p[(k + 1) % p.length]);
        if (a[1] !== b[1]) edges.push([a[0] * ss, a[1] * ss, b[0] * ss, b[1] * ss]);
      }
    }
    const inside = new Uint8Array(W * H);
    for (let row = 0; row < H; row++) {
      const yy = row + 0.5;
      const xs = [];
      for (const [x0, y0, x1, y1] of edges) {
        if ((yy >= y0 && yy < y1) || (yy >= y1 && yy < y0)) xs.push(x0 + ((yy - y0) / (y1 - y0)) * (x1 - x0));
      }
      xs.sort((m, n) => m - n);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(0, Math.ceil(xs[k] - 0.5)), until = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
        for (let col = from; col <= until; col++) inside[row * W + col] = 1;
      }
    }
    for (let k = 0; k < hits.length; k++) hits[k] |= inside[k];
  }
  const out = new Float32Array(width * height);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let n = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) n += hits[(py * ss + sy) * W + px * ss + sx];
      out[py * width + px] = n / (ss * ss);
    }
  }
  return out;
}

/** The plate: a rounded square of radius r (in pixels), or the whole square when r is 0. */
function plateCoverage(size, r) {
  const ss = 4;
  const out = new Float32Array(size * size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let n = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = px + (sx + 0.5) / ss, v = py + (sy + 0.5) / ss;
          const dx = Math.max(0, r - u, u - (size - r)), dy = Math.max(0, r - v, v - (size - r));
          n += dx * dx + dy * dy <= r * r ? 1 : 0;
        }
      }
      out[py * size + px] = n / (ss * ss);
    }
  }
  return out;
}

const mix = (a, b, t) => [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t);

/**
 * One icon, RGBA. `small` picks the small mark. `inset` is the mark's size as a share of the plate, `radius` the
 * plate's corner as a share of its side (0: full bleed, for the maskable icon Android crops itself).
 */
/**
 * 16 px, drawn by hand on the pixel grid: the tray and the browser tab, where any smoothed shape goes soft. The shield
 * with a straight brow and a two-pixel point, the helmet cut out of it, and its eyes in gold, two pixels
 * deep and slanting in toward the nose as the masks' do.
 */
const PIXEL16 = [
  '................',
  '....GGGGGGGG....',
  '..GGGGGGGGGGGG..',
  '..GGGG....GGGG..',
  '..GGG......GGG..',
  '..GG........GG..',
  '..GG.GG..GG.GG..',
  '..GG..G..G..GG..',
  '..GG........GG..',
  '..GGG......GGG..',
  '...GGG....GGG...',
  '...GGGG..GGGG...',
  '....GGGGGGGG....',
  '.....GGGGGG.....',
  '......GGGG......',
  '................'
];

function icon16() {
  const plate = plateCoverage(16, 3.75);
  const px = Buffer.alloc(16 * 16 * 4);
  for (let k = 0; k < 256; k++) {
    const c = PIXEL16[k >> 4][k & 15] === 'G' ? GOLD : PLATE;
    px[k * 4] = c[0]; px[k * 4 + 1] = c[1]; px[k * 4 + 2] = c[2]; px[k * 4 + 3] = Math.round(plate[k] * 255);
  }
  return { width: 16, height: 16, px };
}

function icon(size, { small = size <= 32, inset = small ? SMALL.inset : 0.78, radius = 15 / 64 } = {}) {
  if (size === 16 && small) return icon16();
  const s = (size / 64) * inset;
  const map = ([x, y]) => [size / 2 + (x - 32) * s, size / 2 + (y - 32) * s];
  const plate = plateCoverage(size, radius * size);
  const gold = coverage(size, size, small ? SMALL_GOLD : FULL, map);
  const cut = small ? coverage(size, size, [SMALL_CUT], map) : null;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    // Big sizes carry the light on the brow, deeper toward the chin; small ones stay one flat gold to stay crisp.
    const tone = small ? GOLD : mix(GOLD_LIGHT, GOLD_DEEP, Math.min(1, Math.max(0, (y / size - 0.2) / 0.6)));
    for (let x = 0; x < size; x++) {
      const k = y * size + x;
      const g = gold[k] * (cut ? 1 - cut[k] : 1);
      const c = mix(PLATE, tone, g);
      px[k * 4] = Math.round(c[0]); px[k * 4 + 1] = Math.round(c[1]); px[k * 4 + 2] = Math.round(c[2]);
      px[k * 4 + 3] = Math.round(plate[k] * 255);
    }
  }
  return { width: size, height: size, px };
}

/** A banner (link preview, installer side panel): the full mark on the plate colour, with a soft gold glow behind. */
function banner(width, height, markSize, markY = height / 2) {
  const s = markSize / 64;
  const map = ([x, y]) => [width / 2 + (x - 32) * s, markY + (y - 32) * s];
  const gold = coverage(width, height, FULL, map);
  const glow = [40, 36, 26];
  const px = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const tone = mix(GOLD_LIGHT, GOLD_DEEP, Math.min(1, Math.max(0, ((y - (markY - markSize / 2)) / markSize - 0.2) / 0.6)));
    for (let x = 0; x < width; x++) {
      const k = y * width + x;
      const d = Math.hypot(x - width / 2, y - markY) / (markSize * 0.9);
      const c = mix(mix(PLATE, glow, Math.max(0, 1 - d) ** 2), tone, gold[k]);
      px[k * 4] = Math.round(c[0]); px[k * 4 + 1] = Math.round(c[1]); px[k * 4 + 2] = Math.round(c[2]); px[k * 4 + 3] = 255;
    }
  }
  return { width, height, px };
}

/* ------------------------------------------------------------ encoders */

function crc32(buf) {
  if (!crc32.table) {
    crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
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

function png({ width, height, px }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;   // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

/** Windows icon: one PNG per size, so the taskbar, title bar, Alt+Tab and Start each get a drawn size, not a scaled one. */
function ico(sizes) {
  const images = sizes.map((size) => ({ size, data: png(icon(size)) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

/** 24-bit BMP, the only kind the Windows installer shows in its side panel. */
function bmp({ width, height, px }) {
  const stride = Math.ceil((width * 3) / 4) * 4;
  const out = Buffer.alloc(54 + stride * height);
  out.write('BM', 0); out.writeUInt32LE(out.length, 2); out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14); out.writeInt32LE(width, 18); out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26); out.writeUInt16LE(24, 28); out.writeUInt32LE(stride * height, 34);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * stride;   // rows run bottom to top
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4;
      out[row + x * 3] = px[k + 2]; out[row + x * 3 + 1] = px[k + 1]; out[row + x * 3 + 2] = px[k];
    }
  }
  return out;
}

/** The tab icon: the 16 px drawing as squares on a 16-unit grid, so a tab shows it pixel for pixel. */
function faviconSvg() {
  const runs = [];
  PIXEL16.forEach((row, y) => row.replace(/G+/g, (m, x) => { runs.push(`M${x} ${y}h${m.length}v1h-${m.length}Z`); return m; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">
  <!-- Generated by scripts/make-icons.js (PIXEL16), from the logo in web/assets/js/masks.js. Do not edit. -->
  <rect width="16" height="16" rx="3.75" fill="${BRAND.plate}" shape-rendering="geometricPrecision"/>
  <path fill="${BRAND.gold}" d="${runs.join('')}"/>
</svg>
`;
}

/* ------------------------------------------------------------- outputs */

const files = {};
for (const size of [16, 32, 48, 128, 256, 512]) files[`extension/icons/icon${size}.png`] = () => png(icon(size));
files['web/assets/img/icon-192.png'] = () => png(icon(192));
files['web/assets/img/icon-512.png'] = () => png(icon(512));
// Android cuts its own shape out of a maskable icon: a full-bleed plate, the mark inside the middle 60%.
files['web/assets/img/icon-maskable-512.png'] = () => png(icon(512, { inset: 0.6, radius: 0 }));
files['web/assets/img/favicon.svg'] = () => Buffer.from(faviconSvg());
files['web/assets/img/og.png'] = () => png(banner(1200, 630, 390));
files['desktop/build/icon.ico'] = () => ico([16, 24, 32, 48, 64, 128, 256]);
// The installer's side panel: the mark at the panel's middle, where the eye lands beside the welcome text.
files['desktop/build/installerSidebar.bmp'] = () => bmp(banner(164, 314, 120, 157));

const check = process.argv.includes('--check');
const stale = [];
for (const [rel, make] of Object.entries(files)) {
  const file = path.join(ROOT, rel);
  const want = make();
  if (check) {
    // A Windows checkout may turn the SVG's line ends into CRLF; only the drawing counts.
    const have = fs.existsSync(file) && fs.readFileSync(file);
    const same = have && (rel.endsWith('.svg') ? have.toString().replace(/\r/g, '') === want.toString() : have.equals(want));
    if (!same) stale.push(rel);
    continue;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, want);
  console.log(`  ${rel}  ${want.length} bytes`);
}
if (check) {
  if (stale.length) {
    console.error(`Out of step with the mark in masks.js and brand.json: ${stale.join(', ')}. Run npm run build:icons.`);
    process.exit(1);
  }
  console.log(`All ${Object.keys(files).length} pictures of the mark match their source.`);
}

module.exports = { icon, banner, png, files };
