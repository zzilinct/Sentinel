'use strict';
/**
 * Packages extension/ into the .zip the website serves, writing a minimal
 * ZIP container directly (no build dependencies).
 *
 *   node scripts/build-extension.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'extension');
const OUT_DIR = path.join(ROOT, 'web', 'downloads');

const SKIP = new Set(['.DS_Store', 'Thumbs.db', '.gitignore']);

/* ------------------------------------------- sync shared sources + brand */

const brand = JSON.parse(fs.readFileSync(path.join(ROOT, 'brand.json'), 'utf8'));
const manifestPath = path.join(SRC, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// One source of truth for the mask glyphs: the web app's copy.
fs.copyFileSync(path.join(ROOT, 'web', 'assets', 'js', 'masks.js'), path.join(SRC, 'src', 'content', 'masks.js'));

fs.writeFileSync(path.join(SRC, 'src', 'lib', 'brand.js'),
  '// Generated from brand.json by scripts/build-extension.js - edit brand.json instead.\n' +
  `export const BRAND = ${JSON.stringify({ name: brand.name, origin: brand.origin, domain: brand.domain }, null, 2)};\n`);

const originPattern = `${brand.origin}/*`;
manifest.homepage_url = brand.origin;
manifest.host_permissions = [originPattern, ...manifest.host_permissions.filter((h) => !/^https:\/\/[^*]+\/\*$/.test(h))];
manifest.externally_connectable.matches = [originPattern, ...manifest.externally_connectable.matches.filter((h) => !/^https:\/\//.test(h))];
if (process.argv.includes('--production')) {
  // Store builds must not talk to a developer's localhost.
  manifest.host_permissions = manifest.host_permissions.filter((h) => !h.includes('localhost'));
  manifest.externally_connectable.matches = manifest.externally_connectable.matches.filter((h) => !h.includes('localhost'));
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`  brand origin  ${brand.origin}`);
console.log('  reminder      the extension sends browsing data to this origin - make sure you control it before publishing');

function walk(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(abs, rel));
    else out.push({ abs, rel });
  }
  return out;
}

/* ------------------------------------------------------------------- zip */

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

/** MS-DOS date/time, as required by the ZIP local header. */
function dosTime(date) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() / 2)) & 0xffff;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, day };
}

function buildZip(files) {
  const when = dosTime(new Date());
  const locals = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.rel, 'utf8');
    const data = fs.readFileSync(file.abs);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);              // version needed
    local.writeUInt16LE(0, 6);               // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(when.time, 10);
    local.writeUInt16LE(when.day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);              // extra length
    locals.push(local, nameBuf, payload);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);                // version made by
    dir.writeUInt16LE(20, 6);                // version needed
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(when.time, 12);
    dir.writeUInt16LE(when.day, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(payload.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, end]);
}

/* ----------------------------------------------------------------- build */

if (!fs.existsSync(path.join(SRC, 'icons', 'icon128.png'))) {
  console.log('  icons missing - running make-icons first');
  require('./make-icons.js');
}

const files = walk(SRC);
const zip = buildZip(files);

fs.mkdirSync(OUT_DIR, { recursive: true });
const versioned = path.join(OUT_DIR, `sentinel-companion-${manifest.version}.zip`);
const latest = path.join(OUT_DIR, 'sentinel-companion-latest.zip');
fs.writeFileSync(versioned, zip);
fs.writeFileSync(latest, zip);

fs.writeFileSync(path.join(OUT_DIR, 'latest.json'), JSON.stringify({
  name: manifest.name,
  version: manifest.version,
  size: zip.length,
  files: files.length,
  builtAt: new Date().toISOString(),
  download: '/downloads/sentinel-companion-latest.zip'
}, null, 2) + '\n');

console.log(`  packed ${files.length} files -> ${(zip.length / 1024).toFixed(1)} KB`);
console.log(`  ${path.relative(ROOT, versioned)}`);
console.log(`  ${path.relative(ROOT, latest)}`);
