'use strict';
/** The type system (web/assets/fonts/fonts.css): one scale, self-hosted faces under an open licence, one voice everywhere. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const FONTS = 'web/assets/fonts';
const fontsCss = read(`${FONTS}/fonts.css`);
const faces = [...fontsCss.matchAll(/url\('\.\/([^']+\.woff2)'\)/g)].map((m) => m[1]);

const css = (dir) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.css')).map((f) => `${dir}/${f}`);
const STYLED = [...css('web/assets/css'), 'extension/src/popup.css', 'extension/src/options.css',
  ...fs.readdirSync(path.join(ROOT, 'desktop/src/pages')).map((f) => `desktop/src/pages/${f}`)];
const PAGES = fs.readdirSync(path.join(ROOT, 'desktop/src/pages')).filter((f) => f.endsWith('.html'));

test('every face is ours to ship: self-hosted, with its open licence beside it, and small', () => {
  assert.deepEqual(faces.sort(), ['geist-mono-normal-400-600.woff2', 'geist-normal-300-700.woff2', 'newsreader-opsz-16-72.woff2']);
  let bytes = 0;
  for (const face of faces) bytes += fs.statSync(path.join(ROOT, FONTS, face)).size;
  assert.ok(bytes <= 90 * 1024, `the faces weigh ${bytes} bytes`);
  for (const licence of ['newsreader-OFL.txt', 'geist-OFL.txt', 'geist-mono-OFL.txt']) {
    assert.match(read(`${FONTS}/${licence}`), /SIL OPEN FONT LICENSE/i, licence);
  }
  // A reserved font name would forbid keeping the name on a cut of our own.
  assert.doesNotMatch(read(`${FONTS}/newsreader-OFL.txt`).split('\n')[0], /Reserved Font Name/i);
  assert.ok(!fontsCss.includes('http'), 'no third-party font');
});

/** The characters a woff2 file draws: its cmap table, read from the brotli stream (cmap is never transformed). */
function woff2Chars(file) {
  const buf = fs.readFileSync(file);
  const n = buf.readUInt16BE(12);
  const base128 = () => { let v = 0; for (;;) { const b = buf[at++]; v = v * 128 + (b & 127); if (!(b & 128)) return v; } };
  let at = 48;
  let offset = 0;
  let cmap = null;
  for (let i = 0; i < n; i++) {
    const flags = buf[at++];
    const tag = (flags & 63) === 63 ? buf.toString('latin1', at, (at += 4)) : null;
    const known = flags & 63;
    const version = flags >> 6;
    const length = base128();
    // glyf and loca are transformed at version 0, hmtx at version 1; every other table is stored as it is.
    const transformed = ((known === 10 || known === 11) && version === 0) || (known === 3 && version === 1);
    const stored = transformed ? base128() : length;
    if (known === 0 && !tag) cmap = { offset, length };
    offset += stored;
  }
  const table = require('zlib').brotliDecompressSync(buf.subarray(at, at + buf.readUInt32BE(20))).subarray(cmap.offset, cmap.offset + cmap.length);
  const chars = new Set();
  for (let i = 0; i < table.readUInt16BE(2); i++) {
    const sub = table.readUInt32BE(4 + i * 8 + 4);
    const format = table.readUInt16BE(sub);
    if (format === 4) {
      const segs = table.readUInt16BE(sub + 6) / 2;
      for (let s = 0; s < segs; s++) {
        const end = table.readUInt16BE(sub + 14 + s * 2);
        const start = table.readUInt16BE(sub + 16 + segs * 2 + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) chars.add(c);
      }
    } else if (format === 12) {
      for (let g = 0; g < table.readUInt32BE(sub + 12); g++) {
        for (let c = table.readUInt32BE(sub + 16 + g * 12); c <= table.readUInt32BE(sub + 20 + g * 12); c++) chars.add(c);
      }
    }
  }
  return chars;
}

test('Geist and Geist Mono are cut to the letters Sentinel shows, and never lose one a page uses (scripts/subset-fonts.py)', () => {
  // What Google's latin files drew beyond Latin-1, before the cut: a page that starts using one of these needs the cut run again.
  const LATIN_EXTRA = [0x102, 0x131, 0x152, 0x153, 0x2bc, 0x2c6, 0x2da, 0x2dc, 0x2013, 0x2014, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e,
    0x2022, 0x2026, 0x2032, 0x2033, 0x2039, 0x203a, 0x2044, 0x20ac, 0x2122, 0x2191, 0x2193, 0x2212];
  const entities = { rsquo: 0x2019, lsquo: 0x2018, ldquo: 0x201c, rdquo: 0x201d, hellip: 0x2026, ndash: 0x2013, mdash: 0x2014, trade: 0x2122, euro: 0x20ac, bull: 0x2022, lsaquo: 0x2039, rsaquo: 0x203a, uarr: 0x2191, darr: 0x2193, minus: 0x2212 };
  const used = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (!/node_modules|vendor|models|img|downloads|fonts/.test(e.name)) walk(rel); continue; }
      if (!/\.(html|js|css|json|txt)$/.test(e.name) || /\.min\.js$|^mask3d\.js$/.test(e.name)) continue;
      const text = read(rel);
      for (const ch of text) used.add(ch.codePointAt(0));
      for (const m of text.matchAll(/&([a-z]+);/g)) if (entities[m[1]]) used.add(entities[m[1]]);
    }
  };
  ['web', 'extension/src', 'desktop/src/pages'].forEach(walk);
  for (const face of ['geist-normal-300-700.woff2', 'geist-mono-normal-400-600.woff2']) {
    const has = woff2Chars(path.join(ROOT, FONTS, face));
    for (let c = 0x20; c < 0x100; c++) if (c < 0x7f || (c >= 0xa0 && c !== 0xad)) assert.ok(has.has(c), `${face} lost U+${c.toString(16)}: names and addresses are typed in Latin-1`);
    const lost = LATIN_EXTRA.filter((c) => used.has(c) && !has.has(c)).map((c) => `U+${c.toString(16)} ${String.fromCodePoint(c)}`);
    assert.deepEqual(lost, [], `${face} does not draw what a page uses: run scripts/subset-fonts.py after scripts/fetch-fonts.js`);
    // The cut itself: no combining accents or fractions nobody shows.
    assert.ok(!has.has(0x102) && !has.has(0x2044), `${face} is not the cut file`);
    // The companion carries the same file.
    assert.ok(fs.readFileSync(path.join(ROOT, FONTS, face)).equals(fs.readFileSync(path.join(ROOT, 'extension/src/fonts', face))), `the companion's ${face} is not the cut one`);
  }
});

test('nothing shifts when a font arrives: swap, with stand-ins drawn to the same metrics', () => {
  assert.equal((fontsCss.match(/font-display: swap/g) || []).length, faces.length);
  for (const family of ['Newsreader Stand-in', 'Geist Stand-in', 'Geist Mono Stand-in']) {
    assert.match(fontsCss, new RegExp(`font-family: '${family}'; (font-weight: [\\d ]+; )?src: (local\\('[^']+'\\)(, )?)+; size-adjust: [\\d.]+%; ascent-override: [\\d.]+%; descent-override: [\\d.]+%`), family);
    assert.match(fontsCss, new RegExp(`--(display|sans|mono): [^;]*'${family}'`), `${family} is not in a stack`);
  }
});

test('the faces every page needs are preloaded and precached, under a new cache name', () => {
  const head = read('web/partials/head.html');
  const sw = read('web/sw.js');
  for (const face of ['newsreader-opsz-16-72.woff2', 'geist-normal-300-700.woff2']) {
    assert.ok(head.includes(`href="/assets/fonts/${face}" as="font" type="font/woff2" crossorigin`), `${face} is not preloaded`);
  }
  for (const face of faces) assert.ok(sw.includes(`/assets/fonts/${face}`), `${face} is not precached`);
  assert.ok(!/instrument-serif|anton/.test(head + sw), 'an old face is still loaded');
  assert.ok(Number(/sentinel-v(\d+)/.exec(sw)[1]) >= 7, 'the cache name was not bumped');
});

test('every size comes from the scale', () => {
  // Deliberate exceptions: the wordmarks are sized to the window, and the tab wipe's title is left as it is.
  const allowed = /\.hero__word|\.auth__word|\.wipe__label/;
  for (const file of STYLED) {
    const text = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of text.matchAll(/([^{}\n]*)\{[^{}]*?\bfont(?:-size)?:\s*(?:\d{3}\s+)?(?:clamp\()?\d[\d.]*(?:px|rem)[^;}]*/g)) {
      assert.ok(allowed.test(m[1]), `${file}: a size outside the scale in "${m[0].slice(0, 120)}"`);
    }
  }
});

test('no small capitals by CSS, no mixed faces in a heading', () => {
  for (const file of STYLED) assert.doesNotMatch(read(file), /text-transform:\s*uppercase/, `${file}: small tracked capitals`);
  const rule = /h1 em, h2 em \{([^}]*)\}/.exec(read('web/assets/css/sentinel.css'));
  assert.ok(rule, 'the heading emphasis rule is gone');
  assert.doesNotMatch(rule[1], /font-family|font-weight|italic/, 'emphasis in a heading must not change the shape of the letters');
  assert.match(rule[1], /font-style: normal/);
});

test('the desktop pages and the companion speak with the same voice', () => {
  for (const page of PAGES) {
    const html = read(`desktop/src/pages/${page}`);
    assert.ok(html.includes('href="../../shared/fonts/fonts.css"'), `${page}: no type system`);
    const policy = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
    assert.match(policy, /font-src file:/, `${page}: the policy blocks the fonts`);
    assert.match(policy, /style-src 'unsafe-inline' file:/, `${page}: the policy blocks fonts.css`);
    assert.doesNotMatch(html, /system-ui|Segoe UI/, `${page}: a system font`);
  }
  assert.doesNotMatch(read('desktop/src/pages/card.js'), /system-ui|Segoe UI/);
  assert.match(read('desktop/scripts/sync-shared.js'), /'assets', 'fonts'/);
  assert.match(read('extension/src/popup.css'), /^[^]{0,200}@import url\('fonts\/fonts\.css'\)/);
  assert.doesNotMatch(read('extension/src/popup.css'), /@font-face/);
  for (const file of ['fonts.css', ...faces]) {
    assert.ok(fs.readFileSync(path.join(ROOT, 'extension/src/fonts', file)).equals(fs.readFileSync(path.join(ROOT, FONTS, file))), `the companion's ${file} is stale`);
  }
});
