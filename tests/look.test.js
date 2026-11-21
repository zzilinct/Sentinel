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
    assert.ok(keys.length > 0 && keys.every((k) => /^--(gold|acc|live|on-acc|metal|line|sketch|btn-grad|gilt|text|muted|faint|bg|surface|field-bg|sheet|panel|glass|haze|glow|star|words)/.test(k) && !statusVar.test(k)), `${a.id} ${s}: ${keys.join(' ')}`);
    assert.equal(JSON.stringify(L.STATUS), before);
  }
  // The island and the cards say a verdict in STATUS, never M.COLORS mixed with the accent and never a literal.
  const overlay = (read('desktop', 'src', 'pages', 'overlay.html') + read('desktop', 'src', 'pages', 'overlay-page.js'));
  assert.match(overlay, /function tone\(badge\) \{ return L\.STATUS\[L\.scheme\(look\.mode\)\]/);
  assert.match(read('desktop', 'src', 'pages', 'card.js'), /const tone = \(badge\) => window\.SentinelLook\.STATUS\[/);
  for (const page of ['warn.html', 'guard.html', 'filescan.html']) assert.doesNotMatch(read('desktop', 'src', 'pages', page), /#e5484d|#f08a24|#f5c542/, `${page} names a status colour itself`);
});

test('gold is the default and keeps its hand-tuned values', () => {
  assert.deepEqual(L.normal(null), { mode: 'auto', accent: 'gold', text: 'standard', density: 'comfortable' });
  assert.deepEqual(L.normal({ mode: 'neon', accent: 'red', text: 'huge' }), { mode: 'auto', accent: 'gold', text: 'standard', density: 'comfortable' }, 'an unknown look is Auto and Gold, never an error');
  assert.deepEqual(L.normal({ mode: 'light', accent: 'teal', text: 'larger', density: 'compact' }), { mode: 'light', accent: 'teal', text: 'larger', density: 'compact' });
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

test('caution is one real yellow, in ink on a pale yellow on light paper, never louder than danger, never mistaken for gold, safe or warning', () => {
  const lab = (hex) => { const [l, ch, hu] = L.toOklch(hex); return [l, ch * Math.cos(hu * Math.PI / 180), ch * Math.sin(hu * Math.PI / 180)]; };
  const apart = (a, b) => Math.hypot(...lab(a).map((v, n) => v - lab(b)[n]));
  const y = L.STATUS.light.yellow;
  assert.equal(y, L.STATUS.dark.yellow, 'one caution yellow in both schemes');
  // Every gold (and every accent) a light page draws: 1.20.1's #8a6100 was 0.015 from the nearest, the same colour.
  const w = L.GOLD.light.web;
  const golds = [50, 200, 300, 400, 500, 600].map((k) => w[k]).concat(w.grad, w.hover, L.GOLD.light.app.acc,
    L.ACCENTS.map((a) => L.ramp(a.id, 'light')['--gold-400']).filter(Boolean));
  for (const g of golds) assert.ok(apart(y, g) >= 0.15, `caution ${y} is ${apart(y, g).toFixed(3)} from ${g}`);
  // As seen without red or without green cones (Machado 2009, full strength): still far from safe green and warning
  // orange (the nearest is 0.111, dark orange to the deutan eye). 1.20.2's first try, olive #646400, was 0.047 and
  // 0.024 from them.
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const gam = (v) => { v = Math.max(0, Math.min(1, v)); return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055); };
  const sim = (hex, m) => { const c = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16))); return '#' + m.map((r) => (256 | Math.round(gam(r[0] * c[0] + r[1] * c[1] + r[2] * c[2]))).toString(16).slice(1)).join(''); };
  const CVD = { deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]] };
  for (const [kind, m] of Object.entries(CVD)) for (const s of SCHEMES) for (const other of ['green', 'orange']) {
    const d = apart(sim(y, m), sim(L.STATUS[s][other], m));
    assert.ok(d >= 0.1, `${kind} ${s}: caution is ${d.toFixed(3)} from ${other}`);
  }
  // On light paper caution's words and marks are ink, at 4.5:1 or more, on the page, on its tile and on the yellow.
  // Its tile is the same pale share of yellow as on dark, as warning's and danger's tiles take of theirs (13 to 15%),
  // so caution is never louder than danger.
  const css = read('web', 'assets', 'css', 'sentinel.css');
  const light = css.slice(css.indexOf(':root[data-theme="light"] {'));
  const token = (block, name) => block.match(new RegExp(`--${name}: ([^;]+);`))[1];
  assert.equal(token(light, 'yellow-wash'), token(css, 'yellow-wash'), 'the same caution tile in both schemes');
  assert.match(token(light, 'yellow-wash'), /^rgb\(245 197 66 \/ \.1[3-5]\)$/, 'a pale wash, never a solid tile');
  for (const g of ['#efece6', '#f5f2ec', '#f2efe9', '#e6e2da', '#efe8da', '#e4dbca', '#f6f1e7', '#f6f4ef', '#ebe7de', y]) {
    // On the yellow itself the ink is only the hairline round a mask (words there are --on-yellow): 3:1, as a graphic.
    assert.ok(L.contrast(token(light, 'yellow-ink'), g) >= (g === y ? 3 : 4.5), `caution's ink on ${g}`);
    for (const k of ['red', 'orange', 'green']) assert.ok(L.contrast(L.STATUS.light[k], g) >= 4.5 || g === y, `light ${k} ${L.STATUS.light[k]} on ${g}: ${L.contrast(L.STATUS.light[k], g).toFixed(2)}`);
  }
  assert.ok(L.contrast(token(css, 'on-yellow'), y) >= 4.5, 'words on the yellow');
  // No page says caution in yellow words: each goes through --yellow-ink, --c-ink or --on-yellow.
  for (const f of fs.readdirSync(path.join(ROOT, 'web', 'assets', 'css'))) {
    assert.doesNotMatch(read('web', 'assets', 'css', f), /(^|[^-])color: var\(--(yellow|c)\)/m, `${f} colours words in the yellow itself`);
  }
  // A status is named (data-status), never painted inline: no rule reads the style attribute, and no page or script
  // sets --c to a status, so caution's ink can never depend on how a browser writes that attribute out.
  for (const f of fs.readdirSync(path.join(ROOT, 'web', 'assets', 'css'))) assert.doesNotMatch(read('web', 'assets', 'css', f), /\[style[*^$~|]?=/, `${f} reads the style attribute`);
  const pages = fs.readdirSync(path.join(ROOT, 'web')).filter((f) => f.endsWith('.html')).map((f) => ['web', f])
    .concat(fs.readdirSync(path.join(ROOT, 'web', 'assets', 'js')).filter((f) => f.endsWith('.js')).map((f) => ['web', 'assets', 'js', f]));
  for (const p of pages) assert.doesNotMatch(read(...p), /--c:\s*\$\{|--c:\s*var\(--(red|orange|yellow|green|muted)\)|setProperty\('--c',/, `${p.join('/')} paints a status inline`);
  assert.match(css, /\[data-status="yellow"\], \.m--yellow/, 'a named caution takes the ink');
  // Glyph weight, danger > warning > caution: on light paper a caution mask is yellow edged in ink, never a solid ink
  // mask (the heaviest thing on the page) nor a solid yellow disc.
  assert.equal(token(light, 'yellow-glyph'), 'var(--yellow)');
  assert.equal(token(light, 'yellow-edge'), 'var(--yellow-ink)');
  assert.equal(token(css, 'yellow-glyph'), 'currentColor', 'on dark the mask is the yellow itself');
  const card = read('desktop', 'src', 'pages', 'card.js');
  assert.match(card, /\['--c-ink', CI\], \['--c-glyph', tone\(badge\)\], \['--c-edge', CI\]/, 'a light caution card says its title in caution\'s ink and edges its yellow mask in it');
  assert.match(card, /const CI = window\.SentinelLook\.CAUTION_INK;/);
  assert.doesNotMatch(card, /--c-wash/, 'no solid yellow disc behind the mask');
  // Heading weight, danger > warning > caution in words too: caution's ink is one warm graphite, no darker than
  // danger's red (near-black #15130d and the card's #2b2720 outweighed it), the same bytes on every light surface.
  const lum = (hex) => { const c = [1, 3, 5].map((i) => { const v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const CI = L.CAUTION_INK;
  assert.ok(lum(CI) >= lum(L.STATUS.light.red), `caution's ink ${CI} is no heavier than danger's ${L.STATUS.light.red}`);
  assert.equal(token(light, 'yellow-ink'), CI, 'sentinel.css light --yellow-ink');
  const popup = read('extension', 'src', 'popup.css');
  assert.deepEqual([...popup.matchAll(/--yellow-ink: (#[0-9a-f]{6})/g)].map((m) => m[1]).slice(1), [CI, CI], 'popup.css light --yellow-ink');
  // The companion's hover tip on a light page names its status as the app does: caution's words in the ink, its mask
  // yellow edged in the ink, never plain yellow.
  const hover = read('extension', 'src', 'content', 'hover.js');
  const lightTip = hover.slice(hover.indexOf('@media (prefers-color-scheme: light)'));
  assert.ok(lightTip.includes(`.tip[data-status=yellow] b{color:${CI}}`), 'the tip\'s caution heading is in the ink');
  assert.ok(lightTip.includes(`.tip[data-status=yellow] path{stroke:${CI};`), 'the tip\'s caution mask is edged in the ink');
  assert.match(hover, /el\.dataset\.status = line\.status/);
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
  assert.match(read('web', 'app.html'), /<script src="\/assets\/js\/look\.js" defer><\/script>\r?\n<script src="\/assets\/js\/look-app\.js" defer><\/script>\r?\n<script src="\/assets\/js\/app\.js" defer>/);
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
    assert.deepEqual([r.status, r.data], [200, { mode: 'auto', accent: 'gold', text: 'standard', density: 'comfortable', at: { mode: 0, accent: 0, text: 0, density: 0 } }], 'nothing chosen yet');
    fs.writeFileSync(file, JSON.stringify({ mode: 'light', accent: 'sapphire', at: { mode: 5, accent: 6 }, token: 'secret' }));
    r = await c.get('/api/v1/look');
    assert.deepEqual(r.data, { mode: 'light', accent: 'sapphire', text: 'standard', density: 'comfortable', at: { mode: 5, accent: 6, text: 0, density: 0 } }, 'the look, when each was chosen, and nothing else');
    // An extension may read it, without credentials (the 1.19.2 rule), and a website may not read it at all.
    const ext = await fetch(`${app.base}/api/v1/look`, { headers: { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' } });
    assert.equal(ext.headers.get('access-control-allow-origin'), 'chrome-extension://abcdefghijklmnopabcdefghijklmnop');
    assert.equal(ext.headers.get('access-control-allow-credentials'), null);
    const site = await fetch(`${app.base}/api/v1/look`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(site.headers.get('access-control-allow-origin'), null);
    fs.writeFileSync(file, '{ half a file');
    assert.deepEqual((await c.get('/api/v1/look')).data, { mode: 'auto', accent: 'gold', text: 'standard', density: 'comfortable', at: { mode: 0, accent: 0, text: 0, density: 0 } }, 'a broken file is Auto and Gold');
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
  assert.deepEqual(L.merge(a, b), { mode: 'light', accent: 'teal', text: 'standard', density: 'comfortable', at: { mode: 20, accent: 30, text: 0, density: 0 } });
  assert.deepEqual(L.merge(a, { ...a, mode: 'light' }), L.record(a), 'a tie keeps what is held');
  assert.deepEqual(L.record({ mode: 'neon', accent: 'teal', at: { mode: 'soon', accent: -4 } }), { mode: 'auto', accent: 'teal', text: 'standard', density: 'comfortable', at: { mode: 0, accent: 0, text: 0, density: 0 } });
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
    assert.deepEqual(r.data, { mode: 'auto', accent: 'gold', text: 'standard', density: 'comfortable', at: { mode: 0, accent: 0, text: 0, density: 0 }, computer: false });
    r = await c.post('/api/v1/account/look', { mode: 'dark', accent: 'sapphire', at: { mode: 100, accent: 100 }, red: '#000000' });
    assert.deepEqual(r.data, { mode: 'dark', accent: 'sapphire', text: 'standard', density: 'comfortable', at: { mode: 100, accent: 100, text: 0, density: 0 }, computer: false }, 'kept, and only the look');
    // Another device chose the theme later and the colour earlier: each setting from the newer choice.
    r = await c.post('/api/v1/account/look', { mode: 'light', accent: 'rose', at: { mode: 200, accent: 50 } });
    assert.deepEqual([r.data.mode, r.data.accent], ['light', 'sapphire']);
    // A clock set years ahead cannot pin a choice for ever: it counts as now.
    const far = Date.now() + 10 * 365 * 864e5;
    r = await c.post('/api/v1/account/look', { accent: 'teal', at: { accent: far } });
    assert.ok(r.data.accent === 'teal' && r.data.at.accent <= Date.now());
    // Text size and spacing travel the same way, so the companion's popup follows the app's Settings.
    r = await c.post('/api/v1/account/look', { text: 'larger', density: 'compact', at: { text: far, density: 300 } });
    assert.deepEqual([r.data.mode, r.data.accent, r.data.text, r.data.density], ['light', 'teal', 'larger', 'compact']);
    assert.ok(r.data.at.text <= Date.now(), 'a clock set ahead counts as now for text size too');
    assert.equal((await c.post('/api/v1/account/look', { accent: 'x'.repeat(600) })).status, 413, 'a body past 512 bytes is refused');
    // Scan answers say when it changed, so the companion asks again only then.
    const scan = await c.post('/api/v1/live/visit', { url: 'https://example.com/' });
    assert.equal(scan.status, 200, JSON.stringify(scan.data));
    assert.equal(scan.data.lookRev, L.rev(r.data));
    assert.equal(scan.data.lookRev, r.data.at.text, 'a text size chosen last moves lookRev');
  } finally { app.server.close(); }
  const api = read('extension', 'src', 'lib', 'api.js');
  assert.match(api, /if \(data && typeof data\.lookRev === 'number'\) followLook\(data\.lookRev\);/);
  assert.match(api, /if \(look && look\.rev === revision\) return;/, 'the companion asks only when the account\'s look moved');
  assert.match(read('scripts', 'build-extension.js'), /strip\('lib\/look\.js'\)/, 'Firefox gets the table too');
  assert.match(require('./fixtures').appScript(), /SentinelLook\.sync\(\)/);
  // The Settings home's first-run step finds the picker's rows by these ids.
  assert.match(read('web', 'assets', 'js', 'look-app.js'), /rowId\('theme'\)[^]*rowId\('accent'\)/);
  // The Windows app on this computer wins a tie over what the popup kept (which may be only the default).
  assert.match(read('extension', 'src', 'background.js'), /rec = L\.merge\(await res\.json\(\), rec\)/);
});

test('two devices offline: the later choice wins, and the device whose choice was replaced is told, once', () => {
  const sent = { accent: 'amethyst', at: { accent: 100 } };          // what the account last said to this device
  const here = { accent: 'teal', at: { accent: 200 } };              // chosen here while offline
  const other = { accent: 'rose', at: { accent: 300 } };             // chosen later on the other device
  assert.equal(L.merge(here, other).accent, 'rose', 'last writer wins, as before');
  assert.deepEqual(L.overruled(here, sent, other), ['accent']);
  assert.deepEqual(L.overruled(other, sent, L.merge(here, other)), [], 'the device whose choice won is not told');
  assert.deepEqual(L.overruled(here, sent, { accent: 'amethyst', at: { accent: 100 } }), [], 'an account that has not heard yet: this choice is sent, not lost');
  assert.deepEqual(L.overruled({ accent: 'rose', at: { accent: 100 } }, sent, other), [], 'nothing chosen here since: an ordinary change from elsewhere');
  assert.deepEqual(L.overruled(here, sent, { accent: 'teal', at: { accent: 300 } }), [], 'the same choice made on both');
  const app = read('web', 'assets', 'js', 'look-app.js');
  assert.match(app, /lost = sent \? L\.overruled\(current, sent, d\) : \[\];\s+var m = take\(d\);/, 'checked before the account\'s record is taken');
  assert.match(app, /localStorage\.setItem\(KEY\.sent, JSON\.stringify\(L\.record\(d\)\.at\)\)/, 'and what the account said is kept for next time');
  assert.match(app, /pending = null;\s+return n;/, 'shown by one picker, then gone');
});

test('a colour changes the whole look: its own pastel words, tinted grounds and stars, every weight as readable as gold\'s', () => {
  const hue = (hex) => L.toOklch(hex)[2];
  const apart = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
  for (const a of OTHERS) {
    for (const s of SCHEMES) {
      const r = L.ramp(a.id, s), page = L.PAGE[s];
      for (const k of ['text', 'text-2', 'muted', 'faint']) {
        // Never harder to read than gold's own words of that weight, on every ground of its own.
        // Body words on dark: 13:1 at least (gold's cream is 16:1); the room goes to the colour.
        const want = Math.min(L.contrast(page[k], page.bg), k === 'text' && s === 'dark' ? 13 : 99) - 0.05;
        for (const g of ['--bg', '--bg-2', '--surface']) assert.ok(L.contrast(r['--' + k], r[g]) >= Math.min(want, 4.5) && L.contrast(r['--' + k], r['--bg']) >= want, `${a.id} ${s} --${k} ${r['--' + k]} on ${g} ${r[g]}`);
      }
      // Grounds keep gold's lightness, so the page is as dark or as light as before, only tinted.
      for (const k of ['bg', 'surface', 'surface-3']) assert.ok(Math.abs(L.toOklch(r['--' + k])[0] - L.toOklch(page[k])[0]) < 0.012, `${a.id} ${s} --${k}`);
    }
    if (a.id === 'platinum') continue;
    const r = L.ramp(a.id, 'dark');
    const [l, c, h] = L.toOklch(r['--text']);
    // Words are a light pastel of the colour, not gold's cream: light, clearly tinted, the colour's own hue.
    assert.ok(l > 0.88 && c >= 0.035 && apart(h, a.h) <= 20, `${a.id} words ${r['--text']}: l ${l.toFixed(2)} c ${c.toFixed(3)} h ${h.toFixed(0)}`);
    assert.ok(L.toOklch(r['--bg'])[1] >= 0.01 && apart(hue(r['--bg']), a.h) <= 20, `${a.id} ground ${r['--bg']} is tinted`);
    assert.ok(apart(hue(r['--star-1']), a.h) <= 15 && L.toOklch(r['--star-1'])[1] >= 0.04, `${a.id} brightest stars ${r['--star-1']} are the colour`);
    assert.ok(apart(hue(r['--text']), hue(L.PAGE.dark.text)) > 40, `${a.id} words are not the cream`);
  }
  // Gold keeps its cream, warm stars and amber bloom, and they are where the other colours' replace them.
  const css = read('web', 'assets', 'css', 'sentinel.css');
  assert.match(css, /--star-1: #ffe2b0; --star-2: #f4efe6; --star-3: #cfdcff;/);
  assert.match(css, /--haze-rgb: 239 230 212;\s+--glow-rgb: 160 110 50;/);
  for (const k of [/rgb\(239 230 212 \/ \.06\)/, /rgb\(160 110 50 \/ \.1[04]\)/]) {
    assert.doesNotMatch(read('web', 'assets', 'css', 'lux.css'), k, 'lux.css bloom is the look\'s');
    assert.doesNotMatch(read('web', 'assets', 'css', 'app-lux.css'), k, 'app-lux.css bloom is the look\'s');
  }
  const cosmos = read('web', 'assets', 'js', 'cosmos.js');
  assert.doesNotMatch(cosmos, /fillStyle = s\.warm > 0\.7 \? '#ffe2b0'/, 'the stars are not locked to gold');
  assert.match(cosmos, /getPropertyValue\(`--star-\$\{n\}`\)/);
  assert.match(cosmos, /attributeFilter: \['data-theme', 'data-accent'\]/, 'the sky is drawn again when the colour changes');
  assert.match(read('web', 'assets', 'js', 'galaxy.js'), /attributeFilter: \['data-theme', 'data-accent'\]/);
  assert.match(read('web', 'assets', 'js', 'binary.js'), /getPropertyValue\('--live'\)/, 'the scanning digits are the colour');
  // The marketing pages and boot.js keep and draw every one of these names, not only the gold ramp.
  for (const f of ['look-app.js', 'look-site.js', 'accent.js']) assert.match(read('web', 'assets', 'js', f), /text\|muted\|faint\|bg\|surface/, f);
  // The Windows app's own pages draw the look's words and grounds where it has them.
  assert.match(read('desktop', 'src', 'pages', 'overlay.html'), /--ink: var\(--text, #e9e6df\)/);
  assert.match(read('desktop', 'src', 'pages', 'card.js'), /--ink: var\(--text, #e9e6df\)/);
});

test('a press paints from what was worked out: the same colours, no maths the second time', () => {
  for (const a of L.ACCENTS) for (const s of SCHEMES) {
    const one = L.ramp(a.id, s), two = L.ramp(a.id, s);
    assert.deepEqual(one, two);
    one['--acc'] = 'changed';
    assert.notEqual(L.ramp(a.id, s)['--acc'], 'changed', 'a caller cannot change the kept ramp');
  }
  const t = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) for (const a of L.ACCENTS) L.ramp(a.id, 'dark');
  assert.ok(Number(process.hrtime.bigint() - t) / 1e6 / 1200 < 0.2, 'a kept ramp is a copy, well under a fifth of a millisecond');
  // The reveal starts at once (an ease-out), and the pictures never take the pointer, so a coin keeps its hover.
  const css = read('web', 'assets', 'css', 'sentinel.css');
  assert.match(css, /html\.look-vt::view-transition \{ pointer-events: none; \}/);
  assert.match(css, /html\.look-vt::view-transition-new\(root\) \{ animation: look-in \.6s cubic-bezier\(\.22, 1, \.36, 1\) both; \}/);
  assert.doesNotMatch(css, /\.look__coin:hover i \{ transform/, 'hover and chosen are separate properties, never one transform swapped for another');
});

test('the Windows app window: its own title bar in the look, the real mark, the icon in the colour', () => {
  const main = read('desktop', 'src', 'main.js');
  assert.match(main, /titleBarStyle: process\.platform === 'darwin' \? 'hiddenInset' : process\.platform === 'win32' \? 'hidden' : 'default'/);
  assert.match(main, /titleBarOverlay: frameButtons\(look\(\)\)/);
  assert.match(main, /win\.setTitleBarOverlay\(frameButtons\(l\)\)/, 'a new look repaints Windows\' buttons');
  assert.match(main, /win\.setIcon\(windowIcon\(l\.accent\)\)/, 'and the window\'s icon');
  assert.match(main, /additionalArguments: process\.platform === 'win32' \? \['--sentinel-framed'\]/);
  assert.match(read('desktop', 'src', 'preload.js'), /framed: process\.argv\.includes\('--sentinel-framed'\)/);
  const boot = read('web', 'assets', 'js', 'boot.js');
  assert.match(boot, /if \(!d \|\| !d\.framed\) return;/, 'only the app window draws the bar');
  // "Overview · Sentinel" is shown as the page's name alone (the bar already says Sentinel).
  const strip = new Function('t', `return t${boot.match(/document\.title(\.replace\([^;]+?\))\.trim\(\)/)[1]}.trim();`);
  assert.equal(strip('Overview · Sentinel'), 'Overview');
  assert.equal(strip('Sign in - Sentinel'), 'Sign in');
  assert.match(boot, /M\.svg\('logo'\)/, 'the mark is the site\'s vector mark, not the 16 px picture');
  const css = read('web', 'assets', 'css', 'sentinel.css');
  assert.match(css, /\.frame \{ display: none; \}/, 'never on the website');
  assert.match(css, /html\.framed \.frame \{[^}]*background: var\(--bg\);[^}]*-webkit-app-region: drag;/);
  // Light or dark, the buttons are drawn in the look's ink over the page's ground.
  for (const s of SCHEMES) assert.ok(L.contrast(L.PAGE[s].text, L.PAGE[s].bg) > 12);
});
