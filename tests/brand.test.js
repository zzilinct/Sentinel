'use strict';
// One mark everywhere: every picture of it is made from the logo in masks.js and the colours in brand.json, and
// those colours are the site's own gold.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const brand = require('../brand.json');

test('every icon, the tab icon, the link preview and the installer panel match the mark they are drawn from', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'make-icons.js'), '--check'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
});

test('the tab icon holds the hand-drawn 16 px mark and a 32 px drawing for screens at 200%, not the 16 doubled', () => {
  const ico = fs.readFileSync(path.join(ROOT, 'web/assets/img/favicon.ico'));
  const frames = [];
  for (let k = 0; k < ico.readUInt16LE(4); k++) {
    const e = 6 + 16 * k;
    frames.push({ size: ico[e], data: ico.subarray(ico.readUInt32LE(e + 12), ico.readUInt32LE(e + 12) + ico.readUInt32LE(e + 8)) });
  }
  assert.deepStrictEqual(frames.map((f) => f.size), [16, 32]);
  assert.ok(frames[0].data.equals(fs.readFileSync(path.join(ROOT, 'extension/icons/icon16.png'))), 'the 16 px frame is the hand-drawn mark');
  assert.ok(frames[1].data.equals(fs.readFileSync(path.join(ROOT, 'extension/icons/icon32.png'))), 'the 32 px frame is the 32 px drawing');
  assert.match(read('web/partials/head.html'), /<link rel="icon" href="\/assets\/img\/favicon\.ico" sizes="16x16 32x32">/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'web/assets/img/favicon.svg')), 'no 16 px SVG left for a 200% screen to double');
});

test('the installer side panel carries SENTINEL in gold under the mark', () => {
  const bmp = fs.readFileSync(path.join(ROOT, 'desktop/build/installerSidebar.bmp'));
  const w = bmp.readInt32LE(18), h = bmp.readInt32LE(22), stride = Math.ceil((w * 3) / 4) * 4;
  // Gold pixels (red well above blue) in each row band, rows counted from the top.
  const goldIn = (top, bottom) => {
    let n = 0;
    for (let y = top; y < bottom; y++) for (let x = 0; x < w; x++) {
      const p = 54 + (h - 1 - y) * stride + x * 3;
      if (bmp[p + 2] > 120 && bmp[p + 2] - bmp[p] > 50) n++;
    }
    return n;
  };
  assert.ok(goldIn(209, 228) > 250, `the name under the mark: ${goldIn(209, 228)} gold pixels`);
  assert.strictEqual(goldIn(228, 314), 0, 'and nothing below it');
});

test("the mark's gold is the site's gold", () => {
  const css = read('web/assets/css/sentinel.css');
  const token = (name) => (css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i')) || [])[1];
  assert.strictEqual(brand.mark.goldLight, token('gold-300'));
  assert.strictEqual(brand.mark.gold, token('gold-400'));
  assert.strictEqual(brand.mark.goldDeep, token('gold-500'));
  assert.strictEqual(require('../server/lib/mailer').GOLD, brand.mark.gold);
  assert.match(read('extension/src/popup.css'), new RegExp(`--gold-400:\\s*${brand.mark.gold}`, 'i'));
});

test('every drawn copy of the logo is the shield in masks.js', () => {
  const shield = read('web/assets/js/masks.js').match(/var SHIELD = '([^']+)'/)[1];
  for (const rel of ['web/partials/nav.html', 'web/partials/footer.html', 'desktop/src/pages/error.html', 'desktop/src/pages/loading.html']) {
    assert.ok(read(rel).includes(shield), `${rel} draws a logo that is not the one in masks.js`);
  }
});

test('the installed web app has a separate maskable icon, so Android never crops the rounded plate twice', () => {
  const icons = JSON.parse(read('web/manifest.webmanifest')).icons;
  assert.ok(icons.every((i) => i.purpose === 'any' || i.purpose === 'maskable'), 'one icon serves as both any and maskable');
  const maskable = icons.find((i) => i.purpose === 'maskable');
  assert.ok(maskable && fs.existsSync(path.join(ROOT, 'web', maskable.src)));
});

test('account emails carry the app icon and the same gold', () => {
  const html = require('../server/lib/mailer').layout('Title', '<p>Body</p>');
  assert.match(html, /\/assets\/img\/icon-192\.png/);
  assert.ok(html.includes(brand.mark.gold));
});
