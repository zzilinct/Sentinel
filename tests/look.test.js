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
    assert.ok(keys.length > 0 && keys.every((k) => /^--(gold|acc|live|on-acc|metal|line-gold|sketch-gold|btn-grad|gilt)/.test(k) && !statusVar.test(k)), `${a.id} ${s}: ${keys.join(' ')}`);
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

test('light pages: gold\'s words read at 4.5:1 too, and the colours are told apart by more than their hue', () => {
  const grounds = ['#efece6', '#efe8da', '#e4dbca', '#f6f1e7'];
  for (const k of [200, 300, 400]) for (const g of grounds) {
    const c = L.GOLD.light.web[k];
    assert.ok(L.contrast(c, g) >= 4.5, `light gold --gold-${k} ${c} on ${g}: ${L.contrast(c, g).toFixed(2)}`);
  }
  for (const k of ['acc', 'hi']) for (const g of grounds) assert.ok(L.contrast(L.GOLD.light.app[k], g) >= 4.5, `light gold app ${k} on ${g}`);
  // Still gold: its hue and depth as the dark scheme's gold, not a brown.
  const [, c, h] = L.toOklch(L.GOLD.light.web[400]);
  assert.ok(h > 75 && h < 88 && c >= 0.09, `light gold ${L.GOLD.light.web[400]}: hue ${h.toFixed(1)}, depth ${c.toFixed(3)}`);
  // Each light accent's word tone: no two closer than 0.1 in OKLab, and their lightness spread across 0.08.
  const tone = L.ACCENTS.map((a) => [a.id, L.ramp(a.id, 'light')['--gold-400'] || L.GOLD.light.web[400]]);
  const lab = (hex) => { const [l, ch, hu] = L.toOklch(hex); return [l, ch * Math.cos(hu * Math.PI / 180), ch * Math.sin(hu * Math.PI / 180)]; };
  for (let i = 0; i < tone.length; i++) for (let j = i + 1; j < tone.length; j++) {
    const d = Math.hypot(...lab(tone[i][1]).map((v, n) => v - lab(tone[j][1])[n]));
    assert.ok(d >= 0.1, `${tone[i][0]} ${tone[i][1]} and ${tone[j][0]} ${tone[j][1]} are ${d.toFixed(3)} apart`);
  }
  const ls = tone.map(([, hex]) => L.toOklch(hex)[0]);
  assert.ok(Math.max(...ls) - Math.min(...ls) >= 0.08, `lightness spread ${(Math.max(...ls) - Math.min(...ls)).toFixed(3)}`);
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
  // Before the first paint only boot.js runs: it reads what look.js kept and computes nothing. look.js loads after.
  const head = read('web', 'partials', 'head.html');
  assert.match(head, /boot\.js"><\/script>\r?\n<script src="\/assets\/js\/look-site\.js" defer><\/script>/, 'look-site.js waits for the page');
  // The marketing pages carry no table and no colour maths: the theme button and the kept colours only. The app
  // carries the table and the choice (look.js, then look-app.js, before app.js); the home page the table, for its preview.
  assert.doesNotMatch(read('web', 'assets', 'js', 'look-site.js'), /oklch|ramp\(|Math\.cbrt|ACCENTS/);
  assert.match(read('web', 'app.html'), /<script src="\/assets\/js\/look\.js"><\/script>\r?\n<script src="\/assets\/js\/look-app\.js"><\/script>\r?\n<script src="\/assets\/js\/app\.js">/);
  assert.match(read('web', 'index.html'), /<script src="\/assets\/js\/look\.js" defer><\/script>\r?\n<script src="\/assets\/js\/accent\.js" defer>/);
  for (const page of ['pricing.html', 'download.html', 'privacy.html', 'login.html']) assert.doesNotMatch(read('web', page), /look\.js|look-app\.js/, `${page} loads only look-site.js`);
  assert.doesNotMatch(read('web', 'assets', 'js', 'look.js'), /localStorage\.setItem|fetch\(|picker/, 'the table keeps no choice and asks nothing');
  const boot = read('web', 'assets', 'js', 'boot.js');
  assert.match(boot, /localStorage\.getItem\('sentinel:look-vars'\)/, 'boot.js draws the kept colours');
  assert.doesNotMatch(boot, /oklch|ramp\(|Math\.cbrt|data-theme-toggle/, 'and does no colour work or theme switching itself');
  for (const file of ['look-app.js', 'look-site.js']) assert.match(read('web', 'assets', 'js', file), /KEY = \{ mode: 'sentinel:theme', accent: 'sentinel:accent', at: 'sentinel:look-at', vars: 'sentinel:look-vars' \}/);
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
  assert.ok(Math.abs(L.toOklch('#' + [blue[2], blue[1], blue[0]].map((v) => v.toString(16).padStart(2, '0')).join(''))[0] - L.toOklch('#d6b25a')[0]) < 0.08, 'about the same lightness (the dark tuning sits a little lower)');
  assert.match(read('desktop', 'src', 'main.js'), /tray = new Tray\(trayImage\(look\(\)\.accent\)\)/);
  assert.match(read('desktop', 'src', 'main.js'), /if \(tray\) tray\.setImage\(trayImage\(l\.accent\)\)/);
  // The 16 px mark at 100% and the 32 px one at 200%, both cast in the accent.
  assert.match(read('desktop', 'src', 'main.js'), /\[\['icon16\.png', 1\], \['icon32\.png', 2\]\]/);
  assert.match(read('desktop', 'src', 'main.js'), /Look\.tintBitmap\(base\.toBitmap\(\), accent\)/);
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
    assert.deepEqual([r.status, r.data], [200, { mode: 'auto', accent: 'gold', at: { mode: 0, accent: 0 } }], 'nothing chosen yet');
    fs.writeFileSync(file, JSON.stringify({ mode: 'light', accent: 'sapphire', at: { mode: 5, accent: 6 }, token: 'secret' }));
    r = await c.get('/api/v1/look');
    assert.deepEqual(r.data, { mode: 'light', accent: 'sapphire', at: { mode: 5, accent: 6 } }, 'the two settings, when each was chosen, and nothing else');
    // An extension may read it, without credentials (the 1.19.2 rule), and a website may not read it at all.
    const ext = await fetch(`${app.base}/api/v1/look`, { headers: { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' } });
    assert.equal(ext.headers.get('access-control-allow-origin'), 'chrome-extension://abcdefghijklmnopabcdefghijklmnop');
    assert.equal(ext.headers.get('access-control-allow-credentials'), null);
    const site = await fetch(`${app.base}/api/v1/look`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(site.headers.get('access-control-allow-origin'), null);
    fs.writeFileSync(file, '{ half a file');
    assert.deepEqual((await c.get('/api/v1/look')).data, { mode: 'auto', accent: 'gold', at: { mode: 0, accent: 0 } }, 'a broken file is Auto and Gold');
  } finally {
    config.deviceAccounts = false;
    delete process.env.SENTINEL_LOOK_FILE;
    app.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('one look across devices: each setting from whichever chose it last, kept by the account, followed by the companion', async () => {
  // merge: newest per setting, a tie keeps what is held, junk is dropped.
  const a = { mode: 'dark', accent: 'teal', at: { mode: 10, accent: 30 } };
  const b = { mode: 'light', accent: 'rose', at: { mode: 20, accent: 5 }, token: 'x' };
  assert.deepEqual(L.merge(a, b), { mode: 'light', accent: 'teal', at: { mode: 20, accent: 30 } });
  assert.deepEqual(L.merge(a, { ...a, mode: 'light' }), a, 'a tie keeps what is held');
  assert.deepEqual(L.record({ mode: 'neon', accent: 'teal', at: { mode: 'soon', accent: -4 } }), { mode: 'auto', accent: 'teal', at: { mode: 0, accent: 0 } });
  assert.equal(L.rev(a), 30);
  // The website's preview may turn gold to any hue, through the same ramp.
  assert.ok(L.contrast(L.ramp({ h: 25, c: 1 }, 'dark')['--gold-300'], '#111215') >= 4.5);

  const { startApp, client } = require('./fixtures');
  const app = await startApp();
  try {
    const c = client(app.base);
    assert.equal((await c.get('/api/v1/account/look')).status, 401, 'signed out: nothing is kept for anyone');
    const email = `look${Date.now()}@example.com`;
    assert.equal((await c.post('/api/v1/auth/signup', { email, password: 'Correct-Horse-42', firstName: 'Lu', lastName: '', ageConfirmed: true, termsAccepted: true })).status, 201);
    assert.equal((await c.post('/api/v1/auth/login', { email, password: 'Correct-Horse-42' })).status, 200);
    let r = await c.get('/api/v1/account/look');
    assert.deepEqual(r.data, { mode: 'auto', accent: 'gold', at: { mode: 0, accent: 0 }, computer: false });
    r = await c.post('/api/v1/account/look', { mode: 'dark', accent: 'sapphire', at: { mode: 100, accent: 100 }, red: '#000000' });
    assert.deepEqual(r.data, { mode: 'dark', accent: 'sapphire', at: { mode: 100, accent: 100 }, computer: false }, 'kept, and only the look');
    // Another device chose the theme later and the colour earlier: each setting from the newer choice.
    r = await c.post('/api/v1/account/look', { mode: 'light', accent: 'rose', at: { mode: 200, accent: 50 } });
    assert.deepEqual([r.data.mode, r.data.accent], ['light', 'sapphire']);
    // A clock set years ahead cannot pin a choice for ever: it counts as now.
    const far = Date.now() + 10 * 365 * 864e5;
    r = await c.post('/api/v1/account/look', { accent: 'teal', at: { accent: far } });
    assert.ok(r.data.accent === 'teal' && r.data.at.accent <= Date.now());
    assert.equal((await c.post('/api/v1/account/look', { accent: 'x'.repeat(600) })).status, 413, 'a body past 512 bytes is refused');
    // Scan answers say when it changed, so the companion asks again only then.
    const scan = await c.post('/api/v1/live/visit', { url: 'https://example.com/' });
    assert.equal(scan.status, 200, JSON.stringify(scan.data));
    assert.equal(scan.data.lookRev, r.data.at.accent);
  } finally { app.server.close(); }
  const api = read('extension', 'src', 'lib', 'api.js');
  assert.match(api, /if \(data && typeof data\.lookRev === 'number'\) followLook\(data\.lookRev\);/);
  assert.match(api, /if \(look && look\.rev === revision\) return;/, 'the companion asks only when the account\'s look moved');
  assert.match(read('scripts', 'build-extension.js'), /strip\('lib\/look\.js'\)/, 'Firefox gets the table too');
  assert.match(read('web', 'assets', 'js', 'app.js'), /SentinelLook\.sync\(\)/);
  // The Settings home's first-run step finds the picker's rows by these ids.
  assert.match(read('web', 'assets', 'js', 'look-app.js'), /rowId\('theme'\)[^]*rowId\('accent'\)/);
  // The Windows app on this computer wins a tie over what the popup kept (which may be only the default).
  assert.match(read('extension', 'src', 'background.js'), /rec = L\.merge\(await res\.json\(\), rec\)/);
});
