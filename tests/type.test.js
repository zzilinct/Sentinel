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

test('nothing shifts when a font arrives: swap, with stand-ins drawn to the same metrics', () => {
  assert.equal((fontsCss.match(/font-display: swap/g) || []).length, faces.length);
  for (const family of ['Newsreader Stand-in', 'Geist Stand-in', 'Geist Mono Stand-in']) {
    assert.match(fontsCss, new RegExp(`font-family: '${family}'; src: local\\('[^']+'\\); size-adjust: [\\d.]+%; ascent-override: [\\d.]+%; descent-override: [\\d.]+%`), family);
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
