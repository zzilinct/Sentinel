'use strict';
// The look (web/assets/js/look.js): one accent and light or dark for the site, the app, live scanning, its cards, the
// tray icon and the companion. Danger, warning and caution never change with it, gold keeps its hand-tuned values,
// every other accent reads at 4.5:1, and the companion's endpoint gives away nothing but the look.
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../web/assets/js/look.js');
const M = require('../web/assets/js/masks.js') && globalThis.SentinelMasks;

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const SCHEMES = ['dark', 'light'];
const OTHERS = L.ACCENTS.filter((a) => a.id !== 'gold');

test('danger red, warning orange and caution yellow are the same bytes in every accent and scheme', () => {
  const css = read('web', 'assets', 'css', 'sentinel.css');
  const dark = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: light)'));
  const light = css.slice(css.indexOf(':root[data-theme="light"] {'));
  for (const name of ['red', 'orange', 'yellow', 'green']) {
    assert.equal(dark.match(new RegExp(`--${name}: (#[0-9a-f]{6})`))[1], L.STATUS.dark[name], `sentinel.css dark --${name} is look.js STATUS`);
    assert.equal(light.match(new RegExp(`--${name}: (#[0-9a-f]{6})`))[1], L.STATUS.light[name], `sentinel.css light --${name} is look.js STATUS`);
  }
  // The marks' seals (masks.js) are the dark set, on their own dark tile, in every look.
  assert.deepEqual({ ...M.COLORS }, { yellow: L.STATUS.dark.yellow, orange: L.STATUS.dark.orange, red: L.STATUS.dark.red, clear: L.STATUS.dark.green });
  // No accent's ramp names a status colour, so painting one can never change them.
  const statusVar = /^--(red|orange|yellow|green|on-status|error-text)$/;
  const before = JSON.stringify(L.STATUS);
  for (const a of L.ACCENTS) for (const s of SCHEMES) {
    const keys = Object.keys(L.ramp(a.id, s));
    assert.ok(keys.length > 0 && keys.every((k) => /^--(gold|acc|live|on-acc|metal|line-gold|sketch-gold)/.test(k) && !statusVar.test(k)), `${a.id} ${s}: ${keys.join(' ')}`);
    assert.equal(JSON.stringify(L.STATUS), before);
  }
  // The island and the cards say a verdict in STATUS, never M.COLORS mixed with the accent and never a literal.
  const overlay = read('desktop', 'src', 'pages', 'overlay.html');
  assert.match(overlay, /function tone\(badge\) \{ return L\.STATUS\[L\.scheme\(look\.mode\)\]/);
  assert.match(read('desktop', 'src', 'pages', 'card.js'), /const tone = \(badge\) => window\.SentinelLook\.STATUS\[/);
  for (const page of ['warn.html', 'guard.html']) assert.doesNotMatch(read('desktop', 'src', 'pages', page), /#e5484d|#f08a24|#f5c542/, `${page} names a status colour itself`);
});

test('gold is the default and keeps its hand-tuned values', () => {
  assert.deepEqual(L.normal(null), { mode: 'auto', accent: 'gold' });
  assert.deepEqual(L.normal({ mode: 'neon', accent: 'red' }), { mode: 'auto', accent: 'gold' }, 'an unknown look is Auto and Gold, never an error');
  assert.deepEqual(L.normal({ mode: 'light', accent: 'teal' }), { mode: 'light', accent: 'teal' });
  assert.ok(!L.ACCENTS.some((a) => /red|orange|yellow|green|amber|lime/.test(a.id)), 'the warning colours are never offered');
  for (const s of SCHEMES) {
    const r = L.ramp('gold', s);
    assert.ok(!Object.keys(r).some((k) => k.startsWith('--gold')), `gold ${s}: the stylesheets keep its ramp`);
    assert.equal(r['--acc'], L.GOLD[s].app.acc);
  }
  // The table's gold is sentinel.css's gold, byte for byte.
  const css = read('web', 'assets', 'css', 'sentinel.css');
  for (const k of [50, 200, 300, 400, 500, 600]) assert.match(css, new RegExp(`--gold-${k}: ${L.GOLD.dark.web[k]};`), `dark --gold-${k}`);
  for (const k of [50, 200, 300, 400, 500, 600]) assert.match(css, new RegExp(`--gold-${k}: ${L.GOLD.light.web[k]};`), `light --gold-${k}`);
  assert.deepEqual(L.metal('gold'), { shadow: '#5a4216', light: '#fff0c4', face: '#d9b65f' });
  assert.match(read('web', 'assets', 'js', 'masks.js'), /var METAL = \{ shadow: '#5a4216', light: '#fff0c4', face: '#d9b65f' \}/, 'the marks start in the same gold');
});

test('every other accent reads at 4.5:1 where its words sit, and stays clear of the warning hues', () => {
  const grounds = { dark: ['#111215', '#15120e', '#1e1a14', '#0c0d10'], light: ['#efece6', '#efe8da', '#e4dbca', '#f6f1e7'] };
  const hue = (hex) => L.toOklch(hex)[2];
  const statusHues = Object.values(L.STATUS.dark).map(hue);
  for (const a of OTHERS) {
    for (const s of SCHEMES) {
      const r = L.ramp(a.id, s);
      for (const k of ['--gold-200', '--gold-300', '--gold-400']) for (const g of grounds[s]) {
        assert.ok(L.contrast(r[k], g) >= 4.5, `${a.id} ${s} ${k} ${r[k]} on ${g}: ${L.contrast(r[k], g).toFixed(2)}`);
      }
      assert.ok(L.contrast(r['--acc-hi'], L.SHEET[s]) >= 4.5, `${a.id} ${s} island words`);
      const mid = (g) => g.match(/#[0-9a-f]{6}/g)[1];
      const onGold = s === 'light' ? '#ffffff' : '#16130b';
      assert.ok(L.contrast(onGold, mid(r['--gold-grad'])) >= 4.5, `${a.id} ${s}: a button's words on its fill`);
      assert.ok(L.contrast(r['--on-acc'], mid(r['--acc-grad'])) >= 4.5, `${a.id} ${s}: a card button's words on its fill`);
      assert.ok(L.contrast(r['--live-hi'], '#0c0d10') >= 4.5, `${a.id}: the scanning words`);
    }
    const [, c] = L.toOklch(L.ramp(a.id, 'dark')['--gold-400']);
    if (c < 0.03) continue;   // platinum: no hue to mistake
    for (const h of statusHues) {
      const d = Math.min(Math.abs(hue(L.ramp(a.id, 'dark')['--gold-400']) - h), 360 - Math.abs(hue(L.ramp(a.id, 'dark')['--gold-400']) - h));
      assert.ok(d >= 25, `${a.id} is ${d.toFixed(0)} degrees from a warning colour`);
    }
  }
});

test('the live surfaces have no gold of their own left: they draw the look', () => {
  const gold = /#d6b25a|#e2c47f|#fff4d2|214, ?178, ?90|212, ?174, ?99|\bGOLD\b/;
  for (const page of ['overlay.html', 'card.js', 'warn.html', 'guard.html', 'filescan.html', 'error.html', 'loading.html', 'snip.html', 'chat.html']) {
    assert.doesNotMatch(read('desktop', 'src', 'pages', page), gold, page);
  }
  for (const page of ['overlay.html', 'warn.html', 'guard.html', 'filescan.html', 'error.html', 'loading.html', 'snip.html', 'chat.html']) {
    assert.match(read('desktop', 'src', 'pages', page), /<script src="\.\.\/\.\.\/shared\/look\.js"><\/script>/, `${page} loads the look before it paints`);
  }
  assert.doesNotMatch(read('desktop', 'src', 'main.js'), /appTheme|executeJavaScript\("localStorage/, 'the app no longer peeks into the page for its theme');
  assert.match(read('web', 'partials', 'head.html'), /boot\.js"><\/script>\r?\n<script src="\/assets\/js\/look\.js"><\/script>/, 'the site draws the look before its first paint');
  assert.doesNotMatch(read('web', 'assets', 'js', 'boot.js'), /sentinel:theme/, 'one theme switch: look.js');
  // One table: the companion and the Windows app read copies of the site's.
  assert.equal(read('extension', 'src', 'lib', 'look.js'), read('web', 'assets', 'js', 'look.js'), 'run node scripts/build-extension.js');
  assert.equal(read('extension', 'src', 'content', 'masks.js'), read('web', 'assets', 'js', 'masks.js'));
  assert.match(read('desktop', 'scripts', 'sync-shared.js'), /'look\.js'\), path\.join\(SHARED, 'look\.js'\)/);
});

test('the tray mask is gold untouched, and cast in another accent keeps its shape and light', () => {
  // A 3-pixel BGRA picture: gold face, a dark edge, a transparent corner (premultiplied, as toBitmap gives it).
  const px = Buffer.from([0x5a, 0xb2, 0xd6, 255, 0x16, 0x42, 0x5a, 255, 0, 0, 0, 0]);
  assert.ok(L.tintBitmap(px, 'gold').equals(px));
  const blue = L.tintBitmap(px, 'sapphire');
  assert.ok(!blue.equals(px));
  assert.ok(blue[0] > blue[2], 'the face turns blue');
  assert.deepEqual([blue[3], blue[7], blue[11]], [255, 255, 0], 'alpha is kept');
  assert.ok(Math.abs(L.toOklch('#' + [blue[2], blue[1], blue[0]].map((v) => v.toString(16).padStart(2, '0')).join(''))[0] - L.toOklch('#d6b25a')[0]) < 0.03, 'the same lightness');
  assert.match(read('desktop', 'src', 'main.js'), /tray = new Tray\(trayImage\(look\(\)\.accent\)\)/);
  assert.match(read('desktop', 'src', 'main.js'), /if \(tray\) tray\.setImage\(trayImage\(l\.accent\)\)/);
});

test('GET /api/v1/look: only the app\'s server, only this computer, only the look', async () => {
  const { startApp, client } = require('./fixtures');
  const config = require('../server/config');
  const app = await startApp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'look-'));
  const file = path.join(dir, 'look.json');
  try {
    const c = client(app.base);
    assert.equal((await c.get('/api/v1/look')).status, 404, 'a hosted server does not offer it');
    config.deviceAccounts = true;
    assert.equal((await c.get('/api/v1/look')).status, 404, 'nor a server that was not given the file');
    process.env.SENTINEL_LOOK_FILE = file;
    let r = await c.get('/api/v1/look');
    assert.deepEqual([r.status, r.data], [200, { mode: 'auto', accent: 'gold' }], 'nothing chosen yet');
    fs.writeFileSync(file, JSON.stringify({ mode: 'light', accent: 'sapphire', token: 'secret' }));
    r = await c.get('/api/v1/look');
    assert.deepEqual(r.data, { mode: 'light', accent: 'sapphire' }, 'the two words and nothing else');
    // An extension may read it, without credentials (the 1.19.2 rule), and a website may not read it at all.
    const ext = await fetch(`${app.base}/api/v1/look`, { headers: { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' } });
    assert.equal(ext.headers.get('access-control-allow-origin'), 'chrome-extension://abcdefghijklmnopabcdefghijklmnop');
    assert.equal(ext.headers.get('access-control-allow-credentials'), null);
    const site = await fetch(`${app.base}/api/v1/look`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(site.headers.get('access-control-allow-origin'), null);
    fs.writeFileSync(file, '{ half a file');
    assert.deepEqual((await c.get('/api/v1/look')).data, { mode: 'auto', accent: 'gold' }, 'a broken file is Auto and Gold');
  } finally {
    config.deviceAccounts = false;
    delete process.env.SENTINEL_LOOK_FILE;
    app.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
