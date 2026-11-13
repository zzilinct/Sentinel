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
