'use strict';
/** Text size and spacing (Settings, Appearance), and the first-run step that offers the main choices once. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

test('text size grows the reading sizes only, and Standard is the old pixels exactly', () => {
  const css = read('web/assets/fonts/fonts.css');
  const was = { micro: 11, label: 12, note: 13, ui: 14, text: 15, body: 16, lead: 18 };
  for (const [name, px] of Object.entries(was)) assert.match(css, new RegExp(`--t-${name}: calc\\(${px}px \\* var\\(--ts\\)\\);`), name);
  assert.match(css, /:root \{[^}]*--ts: 1;/);
  assert.match(css, /:root\[data-text="large"\] \{ --ts: 1\.15; \}/);
  assert.match(css, /:root\[data-text="larger"\] \{ --ts: 1\.3; \}/);
  // Titles and display sizes are left alone: growing them breaks a hero.
  for (const name of ['title-s', 'title', 'title-l', 'd3', 'd2', 'd1', 'd0']) assert.doesNotMatch(css, new RegExp(`--t-${name}: [^;]*--ts`), name);
});

test('compact spacing never takes a control under 36px, and comfortable is the old height', () => {
  const css = read('web/assets/css/sentinel.css');
  assert.match(css, /:root\[data-density="compact"\] \{ --ds: \.86; \}/);
  assert.match(css, /\.btn \{[^}]*height: max\(calc\(var\(--h\) \* var\(--ds\) \* var\(--ts\)\), min\(var\(--h\), 36px\)\);/);
  const app = read('web/assets/css/app.css');
  for (const rule of ['.input', '.seg__btn', '.segmented button']) {
    const body = new RegExp(`${rule.replace(/[.]/g, '\\.')} \\{[^}]*height: max\\(calc\\((\\d+)px \\* var\\(--ds\\) \\* var\\(--ts\\)\\), (\\d+)px\\)`).exec(app);
    assert.ok(body, `${rule} does not follow spacing`);
    assert.ok(Number(body[2]) >= 34 && Number(body[2]) <= Number(body[1]), `${rule}: its floor ${body[2]}px`);
  }
});

/** boot.js's text-size block, run alone against a stand-in page. */
function bootType(stored, desktop) {
  const src = read('web/assets/js/boot.js');
  const block = /\n\(function \(\) \{\n  const KEY = 'sentinel:type';[\s\S]*?\n\}\)\(\);\n/.exec(src);
  assert.ok(block, 'the text size block is not in boot.js');
  const store = new Map(stored ? [['sentinel:type', stored]] : []);
  const root = { dataset: {} };
  const sent = [];
  const win = {
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    document: { documentElement: root }, addEventListener() {},
    sentinelDesktop: desktop ? { setType: async (t) => { sent.push(t); } } : undefined
  };
  win.window = win;
  vm.runInNewContext(block[0], win);
  return { api: win.SentinelType, root, store, sent };
}

test('text size: applied before the page draws, anything unknown is Standard, the defaults store nothing', () => {
  let b = bootType(null);
  assert.deepEqual(b.root.dataset, {});
  assert.deepEqual({ ...b.api.get() }, { text: 'standard', density: 'comfortable' });
  b = bootType(JSON.stringify({ text: 'larger', density: 'compact' }), true);
  assert.deepEqual({ ...b.root.dataset }, { text: 'larger', density: 'compact' });
  assert.deepStrictEqual({ ...b.sent[0] }, { text: 'larger', density: 'compact', simple: false }, 'the Windows app is told, for its own windows');
  b = bootType('{"text":"huge"}');
  assert.equal(b.api.get().text, 'standard');
  b = bootType('not json');
  assert.equal(b.api.get().text, 'standard');

  b = bootType(null);
  b.api.set({ text: 'large' });
  assert.equal(b.root.dataset.text, 'large');
  assert.deepEqual(JSON.parse(b.store.get('sentinel:type')), { text: 'large', density: 'comfortable' });
  b.api.set({ text: 'nonsense' });
  assert.equal(b.root.dataset.text, 'large', 'an unknown step changes nothing');
  b.api.set({ text: 'standard' });
  assert.equal(b.root.dataset.text, undefined);
  assert.equal(b.store.has('sentinel:type'), false, 'back to the defaults, nothing is kept');
});

test('the Windows app keeps only the known steps and tells its own windows', () => {
  const main = read('desktop/src/main.js');
  const fn = /function typeLevel\(t\) \{[\s\S]*?\n\}/.exec(main);
  const typeLevel = vm.runInNewContext(`(${fn[0]})`);
  assert.deepStrictEqual({ ...typeLevel({ text: 'larger', density: 'compact', simple: true }) }, { text: 'larger', density: 'compact', simple: true });
  assert.deepStrictEqual({ ...typeLevel({ text: '<b>', density: 1, simple: 'yes' }) }, { text: 'standard', density: 'comfortable', simple: false });
  assert.deepStrictEqual({ ...typeLevel(undefined) }, { text: 'standard', density: 'comfortable', simple: false });
  assert.match(main, /was\.simple === next\.simple\) return next;/, 'turning Simple view on or off is told to the windows');
  assert.match(main, /handle\('sentinel:type'/);
  for (const page of ['overlay', 'warn', 'guard', 'filescan']) assert.match(read(`desktop/src/pages/${page}.html`), /<script src="type\.js"><\/script>/, page);
  assert.match((read('desktop/src/pages/overlay.html') + read('desktop/src/pages/overlay-page.js')), /:root\[data-text\] \.panel__why \{ -webkit-line-clamp: 3; \}/, 'a reason at larger text is not cut mid-sentence');
  assert.match(read('desktop/src/preload.js'), /setType:/);
  assert.match(read('desktop/src/overlay-preload.js'), /onType:/);
});

test('Simple view reaches the Windows warning card: the answer and its main reason, bigger, and fewer words', () => {
  // boot.js: switching Simple view tells the app at once, with the text size.
  const src = read('web/assets/js/boot.js');
  assert.match(src, /apply\(on\); if \(window\.SentinelType\) window\.SentinelType\.set\(\{\}\); \}/);
  assert.match(src, /d\.setType\(\{ \.\.\.t, simple: Boolean\(window\.SentinelSimple && window\.SentinelSimple\.get\(\)\) \}\)/);
  assert.match(read('desktop/src/preload.js'), /simple: Boolean\(t && t\.simple === true\)/);
  // type.js in the card sets <html data-simple>, which warn.html's styles read.
  const root = { dataset: {} };
  let told = null;
  vm.runInNewContext(read('desktop/src/pages/type.js'), { window: { sentinelDesktop: { onType: (cb) => { told = cb; } } }, document: { documentElement: root } });
  told({ text: 'standard', density: 'comfortable', simple: true });
  assert.equal(root.dataset.simple, '');
  told({ text: 'standard', density: 'comfortable', simple: false });
  assert.equal('simple' in root.dataset, false);
  const warn = (read('desktop/src/pages/warn.html') + read('desktop/src/pages/warn-page.js'));
  assert.match(warn, /:root\[data-simple\] h1 \{ font-size: var\(--t-title\); \}/, 'a bigger answer');
  assert.match(warn, /:root\[data-simple\] :is\(#reasons, #browser\) \{ display: none; \}/, 'fewer words');
  // The heading line says why: the strongest reason is in the h1, and not repeated below it.
  assert.match(warn, /<h1 id="title"><span id="label">Sentinel warning<\/span><span class="why" id="why"><\/span><\/h1>/);
  assert.match(warn, /document\.getElementById\('why'\)\.textContent = reasons\.shift\(\) \|\| '';\n\s+const ul = document\.getElementById\('reasons'\);\n\s+for \(const r of reasons\)/);
  assert.doesNotMatch(warn, /warning signs below/, 'the first sign is above now, in the heading');
  // A clear image on <html>: without one the body's sheet is handed to the whole window (a pale square round the card).
  assert.match(read('desktop/src/pages/card.js'), /html \{ height: 100%;[^\n]*background: linear-gradient\(transparent, transparent\);/);
  assert.match(read('desktop/src/pages/card.js'), /fit\.observe\(document\.documentElement, \{ attributes: true, attributeFilter: \['data-simple', 'data-text', 'data-density'\] \}\)/, 'an open card fits its words again');
});

test('first run: one step drawn from Settings rows, and the tray notification it replaced is gone', () => {
  const app = require('./fixtures').appScript();
  const slots = JSON.parse(/const FIRST_CHOICES = (\[[^;]+\]);/.exec(app)[1].replace(/'/g, '"'));
  const ids = new Set([...app.matchAll(/\{ id: '([\w-]+)', group: /g)].map((m) => m[1]));
  // Each slot has at least one row on this branch, or names its hook in the comment above it.
  for (const slot of slots) {
    const hook = slot.find((id) => !ids.has(id));
    if (slot.some((id) => ids.has(id))) continue;
    assert.match(app, new RegExp(`'${hook}'\\s+.*work/e2e-`), `${hook}: no row and no named hook`);
  }
  assert.ok(ids.has('text-size') && ids.has('density') && ids.has('theme'));
  // It draws and saves through the rows themselves, never a copy of their controls.
  const body = /function firstChoices\(slot\) \{[\s\S]*?\n  \}\n/.exec(app)[0];
  assert.match(body, /rows\.map\(rowHTML\)/);
  assert.match(body, /paintRow\(r, row, ctx\)/);
  assert.doesNotMatch(body, /SentinelTheme|SentinelType|SentinelLook|SentinelMotionLevel/);
  // Once on this device; storage that cannot be used means never asked, not asked every time.
  assert.match(body, /try \{ if \(localStorage\.getItem\(FIRST_KEY\)\) return false; \} catch \{ return false; \}/);
  assert.match(body, /ev\.key === 'Escape'/);
  // One prompt at a time: the feature offers wait while the step shows.
  assert.match(app, /const firstShown = Boolean\(App\.pages\.firstChoices && App\.pages\.firstChoices\(\$\('\[data-first\]', el\)\)\);\n\s+if \(!firstShown && loaded\.settings\) extras\(App\.pages\);\n\s+else if \(!firstShown && desktop\)/, 'the first-run step comes before the other offers');
  // Speed: a first visit's Overview waits for the first-run rows' own small file, never for all of Settings
  // (101 KB, 29 KB on the wire, held up the phone's first paint). Settings loads it before itself and draws the same rows.
  const first = read('web/assets/js/app/first.js');
  assert.ok(Buffer.byteLength(first) < 16 * 1024, `app/first.js is ${Buffer.byteLength(first)} bytes`);
  assert.match(app, /if \(!firstDone\(\) && !App\.pages\.firstChoices\) \{\n\s+try \{ await pageFile\('first'\); \}/);
  assert.match(app, /\|\| \(desktop \? 'settings' : !firstDone\(\) && 'first'\);/, 'asked for beside the account');
  assert.doesNotMatch(/async function home\(el\) \{[\s\S]*?\n  \}\n/.exec(app)[0], /await pageFile\('settings'\)/);
  assert.match(app, /settings: \['\/assets\/js\/app\/first\.js', /);
  assert.match(app, /tag\.async = false;/, 'a page\'s own file runs after the files it needs');
  assert.doesNotMatch(read('web/assets/js/app/settings.js'), /function (firstChoices|rowHTML|paintRow)\(/, 'one copy of the rows\' frame');
  assert.doesNotMatch(read('desktop/src/main.js'), /trayHintShown/);
});

test('a first visit asks for the first-run files beside app.js, with the key and files app.js uses', () => {
  const boot = read('web/assets/js/boot.js');
  const app = read('web/assets/js/app.js');
  const key = /FIRST_KEY = '([^']+)'/.exec(app)[1];
  assert.ok(boot.includes(`localStorage.getItem('${key}')`), 'boot.js reads the key app.js writes');
  assert.ok(boot.includes("['script', '/assets/js/app/first.js'], ['style', '/assets/css/settings.css']"));
  assert.match(app, /first: \['\/assets\/css\/settings\.css'\]/, 'app.js asks for the same two files');
  assert.ok(boot.includes("!== '/app' || window.sentinelDesktop"), 'only the Overview, never the Windows app');
});
