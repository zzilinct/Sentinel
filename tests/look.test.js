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
    assert.ok(keys.length > 0 && keys.every((k) => /^--(gold|acc|live|on-acc|metal|line|sketch|btn-grad|gilt|text|muted|faint|bg|surface|field-bg|sheet|panel|glass|haze|glow|star|words|night|rim|relief|neu-lo|hi$|lo$)/.test(k) && !statusVar.test(k)), `${a.id} ${s}: ${keys.join(' ')}`);
    assert.equal(JSON.stringify(L.STATUS), before);
  }
  // The island and the cards say a verdict in STATUS, never M.COLORS mixed with the accent and never a literal.
  const overlay = (read('desktop', 'src', 'pages', 'overlay.html') + read('desktop', 'src', 'pages', 'overlay-page.js'));
  assert.match(overlay, /function tone\(badge\) \{ return L\.STATUS\[L\.scheme\(look\.mode\)\]/);
  assert.match(read('desktop', 'src', 'pages', 'card.js'), /const tone = \(badge\) => window\.SentinelLook\.STATUS\[/);
  for (const page of ['warn.html', 'guard.html', 'filescan.html']) assert.doesNotMatch(read('desktop', 'src', 'pages', page), /#e5484d|#f08a24|#f5c542/, `${page} names a status colour itself`);
  // The right-click file result takes light and dark and the accent from card.js alone: its own cream and gold kept
  // it gold in every colour until 1.21.1.
  assert.doesNotMatch(read('desktop', 'src', 'pages', 'filescan.html'), /#[0-9a-f]{3,8}\b|<style/i, 'filescan.html paints no colours of its own');
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
  assert.match(card, /\['--c-ink', CI\], \['--c-glyph', tone\(badge\)\], \['--c-edge', CI\], \['--c-stroke', '\.025em'\]/, 'a light caution card says its title in caution\'s ink and edges its yellow mask in it');
  // The graphite has no hue to carry it: in the display serif's hairlines it read fainter than the sans line under it
  // (run 44430566186, look-card-caution-light), so its title's strokes are drawn fuller there, and only there.
  assert.match(card, /h1 \{[^}]*-webkit-text-stroke: var\(--c-stroke, 0px\) currentColor;/, 'the card title takes the fuller stroke');
  const pop = read('extension', 'src', 'popup.css');
  assert.equal([...pop.matchAll(/--yellow-ink: #645e53; --yellow-stroke: \.025em;/g)].length, 2, 'popup.css light blocks give caution its stroke');
  assert.match(pop, /\.answer\[data-tone="caution"\] h1 \{ color: var\(--yellow-ink\); -webkit-text-stroke: var\(--yellow-stroke, 0px\) currentColor; \}/);
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
  // The companion's result card (serp.js) draws its brand, bullets and button from the look, gold only as the default.
  const serp = read('extension', 'src', 'content', 'serp.js');
  const card = serp.slice(serp.indexOf('function ensurePopover()'), serp.indexOf('function showPopover'));
  assert.doesNotMatch(card.replace(/:host\{[^}]*\}/, ''), /#c9a64e|#d6b25a|#e2c47f/, 'the result card has no gold of its own');
  assert.match(card, /host\.style\.setProperty\(k, v\)/, 'the result card takes the accent');
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
  // The look reaches the tray through refreshTray, which also says at a glance whether live scanning watches: the
  // tooltip names its state and the mask is dimmed while it does not (only "Sentinel <version>" until 1.21.1).
  const main = read('desktop', 'src', 'main.js');
  assert.match(main, /if \(tray\) refreshTray\(\);/);
  assert.match(main, /showTrayGlance\(pw, up\);\r?\n\s*tray\.setContextMenu/);
  assert.match(main, /on \? 'live scanning on' : wanted \? 'live scanning stopped, starting again' : 'live scanning off'/);
  assert.match(main, /tray\.setToolTip\(g\.tip\);\r?\n\s*tray\.setImage\(trayImage\(look\(\)\.accent, !g\.on\)\);/);
  assert.doesNotMatch(main, /tray\.setToolTip\(`Sentinel \$\{app\.getVersion\(\)\}`\)/);
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
  assert.match(read('web', 'assets', 'js', 'look-site.js'), /text\|muted\|faint\|bg\|surface/);
  for (const f of ['look-app.js', 'accent.js']) assert.match(read('web', 'assets', 'js', f), /L\.(webVars|WEB)\b/, f);
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

test('1.21.1: every surface takes the colour, and a device that kept an older set is not left half in the old look', () => {
  const apart = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
  const rgbHex = (s) => '#' + s.match(/\d+/g).slice(0, 3).map((x) => (256 | Number(x)).toString(16).slice(1)).join('');
  for (const a of OTHERS) {
    const kept = L.webVars(a.id);
    assert.equal(kept.v, L.WEB_V);
    for (const s of SCHEMES) {
      const r = L.ramp(a.id, s);
      // Relief, the dark surfaces and the rim are worked out, and kept for the marketing pages.
      for (const k of ['--hi', '--lo', '--neu-lo', '--relief', '--night-rgb', '--night-hi', '--live-200', '--rim']) {
        assert.ok(r[k], `${a.id} ${s} ${k}`);
        assert.equal(kept[s][k], r[k], `${a.id} ${s} ${k} kept`);
      }
      for (const k in kept[s]) assert.match(k, L.WEB);
      const night = L.toOklch(rgbHex(r['--night-rgb']));
      assert.ok(night[0] < 0.2, `${a.id} night is dark in every theme`);
      if (a.id === 'platinum') continue;
      assert.ok(apart(night[2], a.ground.h) <= 25, `${a.id} night ${r['--night-rgb']} is the colour's`);
      // Light: the shadow under a raised card is the colour's, not gold's brown.
      if (s === 'light') assert.ok(apart(L.toOklch(rgbHex(r['--lo']))[2], a.ground.h) <= 25, `${a.id} --lo ${r['--lo']}`);
      assert.ok(apart(L.toOklch(r['--live-200'])[2], a.h) <= 25, `${a.id} --live-200 ${r['--live-200']}`);
    }
  }
  // Gold keeps its stylesheets' own: none of these are drawn over it.
  for (const s of SCHEMES) for (const k of ['--hi', '--lo', '--night-rgb', '--live-200', '--rim']) assert.ok(!(k in L.ramp('gold', s)), `gold ${s} ${k}`);
  // look-site.js (no look.js on the marketing pages) knows the same names and the same version, and works an older
  // set out again; look-app.js keeps the set from look.js.
  const site = read('web', 'assets', 'js', 'look-site.js');
  assert.equal(site.match(/var OURS = (\/.+\/);/)[1], String(L.WEB));
  assert.equal(Number(site.match(/var V = (\d+);/)[1]), L.WEB_V);
  assert.match(site, /v\.v === V\)\) return;/);
  assert.match(site, /s\.src = '\/assets\/js\/look\.js'/);
  assert.match(site, /localStorage\.setItem\(KEY\.vars, JSON\.stringify\(L\.webVars\(a\)\)\)/);
  assert.match(read('web', 'assets', 'js', 'look-app.js'), /v\.v !== L\.WEB_V\) localStorage\.setItem\(KEY\.vars, JSON\.stringify\(L\.webVars\(r\.accent\)\)\)/);
  assert.ok(!L.WEB.test('--look-x') && L.WEB.test('--lo') && L.WEB.test('--hi') && !L.WEB.test('--hint'), '--lo alone, never --look-x');

  // The literals that kept gold on every colour are gone; gold's own stay only as the fallback of a colour's variable.
  const fallbackless = (css) => css.replace(/var\(--[a-z0-9-]+,\s*[^()]*?\)/g, 'var()');
  const GOLDS = /#f3dca4|#d6b25a|#e2c27f|#d2ac63|#231c12|#0b0906|#fff6dc|226 194 127|243 220 164|210 172 99|11 9 6\b/i;
  const rule = (css, sel) => { const i = css.indexOf(sel); assert.ok(i >= 0, sel); return css.slice(i, css.indexOf('}', i)); };
  const call = read('web', 'assets', 'css', 'call.css');
  for (const sel of ['.call__plate {', '.call__verdict {', '.call__more a {']) assert.doesNotMatch(fallbackless(rule(call, sel)), GOLDS, sel);
  assert.match(call, /:where\(:root\[data-accent\]:not\(\[data-accent="gold"\]\)\) \.call__answer \{ color: rgb\(var\(--haze-rgb\)\); \}/);
  assert.doesNotMatch(fallbackless(rule(read('web', 'assets', 'css', 'download.css'), '.ss__ring {')), GOLDS);
  const lux = read('web', 'assets', 'css', 'lux.css');
  for (const sel of ['.motes span {', '.laser i {']) assert.doesNotMatch(fallbackless(rule(lux, sel)), GOLDS, sel);
  assert.match(rule(lux, '.nav__inner {'), /background: var\(--glass\);/, 'the top bar is the look\'s glass');
  assert.doesNotMatch(lux, /\.nav__inner \{ background: rgb\(241 234 221/);
  const sentinel = read('web', 'assets', 'css', 'sentinel.css');
  assert.doesNotMatch(rule(sentinel, '.progress {'), /--orange|--red/, 'the reading line is the colour, never the warning colours');
  assert.match(rule(sentinel, '.ledger {'), /--rim-own: var\(--rim, linear-gradient/);
  assert.doesNotMatch(fallbackless(rule(read('web', 'assets', 'css', 'app-lux.css'), '.lux-island {')), GOLDS, 'the island');
  const home = read('web', 'assets', 'js', 'home.js');
  for (const lit of ["'rgba(226,194,127,.26)'", "'rgba(9,7,5,.92)'", "'rgba(11,9,6,.85)'", "'226,194,127' :", "? '138,100,32'"]) assert.ok(!home.includes(lit), `home.js: ${lit}`);
  assert.match(home, /tone = inks\(\);/);
  assert.match(home, /attributeFilter: \['data-theme', 'data-accent'\]/, 'the hero is drawn again in a new colour');
  const alarm = read('extension', 'src', 'content', 'alarm.js');
  assert.match(alarm, /\.go\{background:\$\{t\.acc\};color:#131519\}\.go:hover\{background:\$\{t\.hi\}\}/);
  assert.match(alarm, /\.brand \.go\{background:linear-gradient\(180deg,\$\{goGrad\}\)/);
  assert.doesNotMatch(alarm.replace(/const t = tone \|\| \{[^}]+\};|: '#efd79c[^']+'|: 'rgba\(212,174,99,\.8\)'|let calm = '#d6b25a';|l\.acc !== '#d6b25a'/g, ''), /#d6b25a|#e2c47f|#c9a64e|#efd79c|212,174,99/, 'gold only as the fallback');
  const boot = read('web', 'assets', 'js', 'boot.js');
  assert.doesNotMatch(boot, /gold line|gold digits/i, 'the scan effect is described in the colour, not gold');
  assert.match(boot, /querySelectorAll\('meta\[name="theme-color"\]'\)/, 'the browser\'s bar follows the look');
});

test('1.21.1: the overview, Settings, the side bar and the camera, as a person meets them', () => {
  const lux = read('web', 'assets', 'css', 'app-lux.css'), luxJs = read('web', 'assets', 'js', 'app-lux.js');
  // The mask's room is held from the first paint, in the picture's own proportions.
  assert.match(lux, /\[data-tab="home"\] > \.view > \.page-title \{ min-height: calc\(clamp\(84px, 10vw, 128px\) \* 896 \/ 788\); \}/);
  assert.match(lux, /\.lux-mask \{ width: clamp\(84px, 10vw, 128px\);/);
  assert.match(luxJs, /onyx\.webp" width="788" height="896"/);
  // A pointer within one half-degree step restyles nothing.
  assert.match(luxJs, /if \(ry === lean\.ry && rx === lean\.rx\) return;/);
  // Without the Windows app, its rows are a name and one line.
  assert.match(read('web', 'assets', 'js', 'app', 'first.js'), /set-row\$\{r\.app && !desktop \? ' set-row--app' : ''\}/);
  assert.match(read('web', 'assets', 'css', 'settings.css'), /\.set-row--app \.set-row__hint, \.set-row--app \.set-row__control, \.set-row--app \.set-row__body \{ display: none; \}/);
  // A laptop's height fits the side bar; a phone's result stops above its bar.
  const app = read('web', 'assets', 'css', 'app.css');
  assert.match(app, /@media \(min-width: 901px\) and \(max-height: 900px\) \{[\s\S]*?\.usage-mini \.meter \{ display: none; \}/);
  assert.match(app, /html \{ scroll-padding-bottom: calc\(76px \+ env\(safe-area-inset-bottom\)\); \}/);
  // The camera lets go when the page is hidden.
  assert.match(read('web', 'assets', 'js', 'app', 'check.js'), /if \(!el\.isConnected \|\| document\.hidden\) \{ stop\(\); return; \}/);
});

test('1.21.1: the pasted-command alarm in the page\'s own world asks for the colour on its own box, and nothing stays on the page', async () => {
  const vm = require('vm');
  const src = read('extension', 'src', 'content', 'alarm.js');
  // One page, two worlds: the DOM (elements, their styles, events) is shared, each world's globals are its own.
  const listeners = [];
  let acting = true;
  class CSSStyleDeclaration {
    constructor() { this.props = {}; }
    getPropertyValue(k) { return this.props[k] || ''; }
    setProperty(k, v) { this.props[k] = String(v); }
    removeProperty(k) { delete this.props[k]; }
    set cssText(v) { this.props = {}; }
  }
  class EventTarget { dispatchEvent(ev) { ev.target = this; for (const fn of listeners.slice()) fn(ev); return true; } }
  class Element extends EventTarget {
    constructor() { super(); this.style = new CSSStyleDeclaration(); this.dataset = {}; this.attrs = {}; this.kids = []; }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    removeAttribute(k) { delete this.attrs[k]; }
    appendChild(n) { if (!this.kids.includes(n)) this.kids.push(n); n.parent = this; return n; }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); }
    attachShadow() { const root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [], addEventListener() {} }; this.root = root; return root; }
  }
  class Document { createElement() { return new Element(); } }
  class CustomEvent { constructor(type, o) { this.type = type; this.bubbles = Boolean(o && o.bubbles); } }
  const html = new Element();
  const document = Object.assign(new Document(), { documentElement: html, body: null, activeElement: null });
  const world = (extra) => {
    const g = vm.createContext({ Element, Document, EventTarget, CSSStyleDeclaration, CustomEvent, document, navigator: { userActivation: { get isActive() { return acting; } } },
      matchMedia: () => ({ matches: false }), history: {}, location: {}, addEventListener: (type, fn) => { listeners.push((ev) => { if (ev.type === type) fn(ev); }); }, ...extra });
    g.globalThis = g;
    vm.runInContext(src, g);
    return g;
  };
  const sapphire = L.ramp('sapphire', 'dark');
  const live = { acc: sapphire['--live'], hi: sapphire['--live-hi'], rgb: sapphire['--live-rgb'] };
  const left = () => JSON.stringify([html.attrs, html.style.props, html.dataset]);
  const draw = (page) => { const ctl = page.SentinelAlarm.show({ accent: 'calm', title: 'Stopped', buttons: [{ text: 'Go back', kind: 'go' }] }); const box = html.kids[html.kids.length - 1]; const css = box.root.innerHTML; ctl.close(); return { css, box }; };
  const companion = async (guard, l = live) => { world({ chrome: { storage: { local: { get: async () => ({ look: { live: l } }) } } }, SentinelStore: { get: async () => ({ commandGuard: guard }) } }); await new Promise((r) => setTimeout(r, 10)); };

  await companion(true);
  // The companion's world writes nothing on the page by itself.
  assert.equal(left(), JSON.stringify([{}, {}, {}]), 'nothing on <html> before a warning');
  const page = world({});
  const { css, box } = draw(page);
  assert.match(css, new RegExp(`\\.go\\{background:${live.acc};`), 'the page world\'s alarm is in the colour');
  assert.equal(box.style.getPropertyValue('--sentinel-tone'), '', 'taken off its own box again');
  assert.equal(left(), JSON.stringify([{}, {}, {}]), 'and nothing on <html> after');
  // A page asking for itself while nobody is acting on it learns nothing.
  acting = false;
  const probe = new Element();
  probe.dispatchEvent(new CustomEvent('sentinel:tone', { bubbles: true }));
  assert.equal(probe.style.getPropertyValue('--sentinel-tone'), '');
  html.dispatchEvent(new CustomEvent('sentinel:tone', { bubbles: true }));
  assert.equal(left(), JSON.stringify([{}, {}, {}]), 'never on <html>, even asked for');
  acting = true;
  // The guard off, or gold: no answer, and the alarm is gold.
  listeners.length = 0;
  await companion(false);
  assert.match(draw(world({})).css, /\.go\{background:#d6b25a;/);
  listeners.length = 0;
  await companion(true, { acc: '#d6b25a', hi: '#e2c47f', rgb: '214 178 90' });
  assert.match(draw(world({})).css, /\.go\{background:#d6b25a;/);
  assert.equal(left(), JSON.stringify([{}, {}, {}]));
  // Only a colour is ever taken from the answer.
  const toneOf = new Function(`return ${src.match(/const toneOf = (\(v\) => \{[^\n]+\});/)[1]}`)();
  assert.deepEqual(toneOf('#112233 #445566 1 2 3'), { acc: '#112233', hi: '#445566', rgb: '1 2 3' });
  for (const bad of ['red blue 1 2 3', '#112233 #445566 1 2 3;}*{x:y', '#112233 url(x) 1 2 3', '']) assert.equal(toneOf(bad), null, bad);
  assert.doesNotMatch(src, /data-sentinel-tone/, 'no attribute on every page');
  assert.equal(read('extension', 'src', 'content', 'alarm.page.js'), src);
});

test('1.21.1: the taskbar, Start menu and desktop Sentinel in the colour, through Sentinel\'s own shortcuts only', () => {
  const { ico } = require('../desktop/src/ico');
  const a = Buffer.from('png-one'), b = Buffer.from('png-number-two');
  const f = ico([{ size: 32, png: a }, { size: 256, png: b }]);
  assert.deepEqual([f.readUInt16LE(0), f.readUInt16LE(2), f.readUInt16LE(4)], [0, 1, 2]);
  assert.deepEqual([f[6], f[7], f.readUInt16LE(10), f.readUInt16LE(12), f.readUInt32LE(14), f.readUInt32LE(18)], [32, 32, 1, 32, a.length, 38]);
  assert.deepEqual([f[22], f[23], f.readUInt32LE(30), f.readUInt32LE(34)], [0, 0, b.length, 38 + a.length], '256 is written as 0');
  assert.equal(f.subarray(38).toString(), 'png-onepng-number-two');
  const main = read('desktop', 'src', 'main.js');
  const fn = main.slice(main.indexOf('function shortcutIcons('), main.indexOf('function applyLook('));
  // Only when the accent changed; only a shortcut whose target is this program; only its icon.
  assert.match(fn, /store\.get\('shortcutAccent', 'gold'\) === accent\) return;/);
  assert.match(fn, /if \(shell\.readShortcutLink\(lnk\)\.target\.toLowerCase\(\) !== exe\) continue;\s+shell\.writeShortcutLink\(lnk, 'update', \{ icon, iconIndex: 0 \}\);/);
  assert.equal((fn.match(/writeShortcutLink/g) || []).length, 1, 'no other write');
  assert.match(fn, /let icon = process\.execPath;/, 'gold: the program\'s own icon back');
  assert.match(fn, /`shortcut-\$\{accent\}\.ico`/, 'a new file name per accent');
  assert.match(fn, /catch \{ \/\* missing, someone else's or read-only: left as it is \*\/ \}/);
  assert.doesNotMatch(fn, /setInterval|setTimeout|watch\(/, 'no polling');
  assert.match(main, /function applyLook\(l\) \{\s+shortcutIcons\(l\.accent\);/);
  // 1.21.2: nothing inside the app makes Windows redraw an open window's taskbar button (CI tried a user task list, app details,
  // the taskbar tab, hiding, minimising and the system icon refresh, reading the button through Windows' accessibility tree:
  // none moved it), and the system-wide refresh is not Sentinel's to run. The button takes the colour when Sentinel next starts.
  assert.doesNotMatch(main, /setSkipTaskbar|ie4uinit|setAppDetails|setUserTasks|SHChangeNotify/);
  const sc = main.slice(main.indexOf('function shortcutPaths('), main.indexOf('function shortcutIcons('));
  assert.equal((sc.match(/'Sentinel\.lnk'/g) || []).length, 1);
  assert.match(read('scripts', 'desktop-qa.ps1'), /Check "\$name-shortcuts"/, 'proved on a real Windows in CI');
});

test('1.21.2: boot.js never paints a set kept by an older Sentinel, and still names the colour', () => {
  const vm = require('vm');
  const boot = read('web', 'assets', 'js', 'boot.js');
  const first = boot.slice(boot.indexOf('(function () {\n  try {'.replace(/\n/g, boot.includes('\r\n') ? '\r\n' : '\n')), boot.indexOf('})();') + 5);
  const run = (kept) => {
    const attrs = {}, style = {};
    vm.runInNewContext(first, {
      document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, style: { setProperty: (k, v) => { style[k] = v; } } } },
      localStorage: { getItem: (k) => (k in kept ? kept[k] : null) },
      matchMedia: () => ({ matches: false })
    });
    return { attrs, style };
  };
  const whole = L.webVars('sapphire');
  // The current set: drawn whole, before the first paint.
  const now = run({ 'sentinel:theme': 'dark', 'sentinel:accent': 'sapphire', 'sentinel:look-vars': JSON.stringify(whole) });
  assert.equal(now.attrs['data-accent'], 'sapphire');
  assert.deepEqual(now.style, whole.dark);
  // A set from before the newer names: nothing of it is drawn (it would be half the old look), the colour is still named.
  const { v, ...older } = whole;
  for (const set of [older, { ...older, v: L.WEB_V - 1 }]) {
    const was = run({ 'sentinel:theme': 'dark', 'sentinel:accent': 'sapphire', 'sentinel:look-vars': JSON.stringify(set) });
    assert.deepEqual(was.style, {}, 'no stale colour drawn');
    assert.equal(was.attrs['data-accent'], 'sapphire', 'the page still knows its colour');
  }
  // Nothing kept at all for a named colour: named, nothing drawn. No colour kept: untouched.
  assert.deepEqual(run({ 'sentinel:accent': 'rose' }).style, {});
  assert.equal(run({ 'sentinel:accent': 'rose' }).attrs['data-accent'], 'rose');
  assert.deepEqual(run({}).attrs, {});
  assert.equal(Number(boot.match(/v\.v !== (\d+)/)[1]), L.WEB_V, 'boot.js holds look.js\'s WEB_V');
});
