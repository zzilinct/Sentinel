'use strict';
// Motion: Full, Calm or Off (boot.js), and the scan effect. One place decides; everything else reads <html data-motion>.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

// The motion block of boot.js, run on its own against a pretend page.
function boot({ stored = {}, reduce = false, desktop = null } = {}) {
  const src = read('web/assets/js/boot.js');
  const start = src.indexOf('(function () {\n  var LEVELS');
  const block = src.slice(start, src.indexOf('})();', start) + 5);
  assert.ok(start > 0, 'boot.js has the motion block');
  const store = { ...stored };
  const events = [];
  const root = { dataset: {} };
  const ctx = {
    window: { sentinelDesktop: desktop },
    document: { documentElement: root, dispatchEvent: (e) => events.push(e.detail), addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    matchMedia: () => ({ matches: reduce, addEventListener() {} }),
    addEventListener() {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o.detail; } }
  };
  ctx.window.matchMedia = ctx.matchMedia;
  vm.runInNewContext(block, ctx);
  return { root, store, events, api: ctx.window.SentinelMotionLevel };
}

test('motion: nothing stored is Full with the scan effect on, set before the first paint', () => {
  const { root, api } = boot();
  assert.equal(root.dataset.motion, 'full');
  assert.equal(root.dataset.scanEffect, 'on');
  assert.equal(api.get(), 'full');
});

test('motion: a choice is kept, junk falls back to Full, and Full stores nothing', () => {
  assert.equal(boot({ stored: { 'sentinel:motion': 'calm' } }).root.dataset.motion, 'calm');
  assert.equal(boot({ stored: { 'sentinel:motion': 'off' } }).root.dataset.motion, 'off');
  assert.equal(boot({ stored: { 'sentinel:motion': 'wild' } }).root.dataset.motion, 'full');
  const b = boot({ stored: { 'sentinel:motion': 'off' } });
  b.api.set('full');
  assert.equal(b.root.dataset.motion, 'full');
  assert.deepEqual(b.store, {});
  assert.deepEqual(b.events, ['full']);
  b.api.set('sideways');
  assert.equal(b.root.dataset.motion, 'full');
});

test('motion: when the computer asks for less motion it is Off, whatever was chosen, and says so', () => {
  const b = boot({ stored: { 'sentinel:motion': 'calm' }, reduce: true });
  assert.equal(b.root.dataset.motion, 'off');
  assert.equal(b.api.system(), true);
  assert.match(read('web/assets/js/boot.js'), /Your computer asks for less motion, so Sentinel follows\./);
});

test('motion: the scan effect switches off on its own, and the Windows app is told the choice', () => {
  const told = [];
  const b = boot({ desktop: { setMotion: (m) => { told.push(m); return Promise.resolve(); } } });
  b.api.setScanEffect(false);
  assert.equal(b.root.dataset.scanEffect, 'off');
  assert.equal(b.store['sentinel:scan-effect'], 'off');
  assert.deepEqual({ ...told.at(-1) }, { motion: 'full', scanEffect: false });
  b.api.set('calm');
  assert.deepEqual({ ...told.at(-1) }, { motion: 'calm', scanEffect: false });
});

// binary.js, the delicate-scan dig, in a pretend page: Off and the scan effect off never start drawing.
function dig(dataset) {
  const timers = [];
  const ctx = {
    window: {},
    document: { documentElement: { dataset }, createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }) }) },
    setTimeout: (fn, ms) => { timers.push(ms); return 1; },
    clearTimeout() {}
  };
  ctx.window.document = ctx.document;
  vm.runInNewContext(read('web/assets/js/binary.js'), ctx);
  const d = ctx.window.SentinelBinary.dig(null, { links: () => [] });
  return { timers, d };
}

test('scan effect: Off, or the scan effect off, draws nothing and still resolves', async () => {
  for (const ds of [{ motion: 'off', scanEffect: 'on' }, { motion: 'full', scanEffect: 'off' }, { motion: 'calm', scanEffect: 'off' }]) {
    const { timers, d } = dig(ds);
    assert.deepEqual(timers, [], JSON.stringify(ds));
    await d.finish();
  }
  assert.equal(dig({ motion: 'full', scanEffect: 'on' }).timers.length, 1);
  assert.equal(dig({ motion: 'calm', scanEffect: 'on' }).timers.length, 1);
});

// Nothing asks the system on its own any more: one more matchMedia or @media for it would be a second rule.
test('motion: only the places that decide read the system setting', () => {
  const allowed = new Set(['web/assets/js/boot.js', 'web/assets/js/vendor/lenis.min.js']);
  const found = [];
  for (const dir of ['web/assets/js', 'web/assets/css']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir), { recursive: true })) {
      const rel = `${dir}/${f}`.split(path.sep).join('/');
      if (!/\.(js|css)$/.test(rel) || allowed.has(rel)) continue;
      // The page-to-page wipe's opt-in cannot sit under a selector: that one rule is allowed, nothing else.
      if (read(rel).replace('@media (prefers-reduced-motion: no-preference) { @view-transition { navigation: auto; } }', '').includes('prefers-reduced-motion')) found.push(rel);
    }
  }
  assert.deepEqual(found, []);
  // Sentinel's own windows resolve it in one file (pages/motion.js); the companion once per script or page.
  const pages = path.join(ROOT, 'desktop/src/pages');
  for (const f of fs.readdirSync(pages)) {
    const s = read(`desktop/src/pages/${f}`);
    if (f !== 'motion.js') assert.doesNotMatch(s, /prefers-reduced-motion/, f);
    if (f.endsWith('.html') && /animation:|transition:|card\.js/.test(s)) assert.match(s, /<script src="motion\.js"><\/script>/, `${f} loads pages/motion.js`);
  }
  for (const f of ['serp.js', 'hover.js', 'webchat.js', 'alarm.js', 'mail.js']) {
    const s = read(`extension/src/content/${f}`);
    assert.equal(s.split('prefers-reduced-motion').length - 1, 1, `${f} resolves it once`);
  }
  for (const f of ['popup.css', 'options.css', 'block.css', 'content/sentinel.css']) assert.doesNotMatch(read(`extension/src/${f}`), /prefers-reduced-motion/, f);
  for (const f of ['popup.html', 'options.html', 'block.html']) assert.match(read(`extension/src/${f}`), /<script src="lib\/motion\.js"><\/script>/, f);
  assert.equal(read('extension/src/content/alarm.page.js'), read('extension/src/content/alarm.js'));
});

// A window's page, live: told the setting by main.js through its preload, and by the system.
function windowPage(bridgeName) {
  let told = null;
  let sysChange = null;
  const sys = { matches: false, addEventListener: (_t, f) => { sysChange = f; } };
  const root = { dataset: {} };
  const ctx = { document: { documentElement: root }, matchMedia: () => sys };
  ctx.window = { matchMedia: ctx.matchMedia, [bridgeName]: { onMotion: (f) => { told = f; } } };
  vm.runInNewContext(read('desktop/src/pages/motion.js'), ctx);
  return { root, tell: (m) => told(m), system: (on) => { sys.matches = on; sysChange(); } };
}

test('motion: every Sentinel window follows a change at once, and the system asking for less is Off', () => {
  for (const bridge of ['sentinelOverlay', 'sentinelDesktop', 'sentinelChat', 'sentinelSnip']) {
    const w = windowPage(bridge);
    assert.equal(w.root.dataset.motion, 'full', bridge);
    w.tell({ motion: 'calm', scanEffect: false });
    assert.equal(w.root.dataset.motion, 'calm', bridge);
    assert.equal(w.root.dataset.scanEffect, 'off', bridge);
    w.system(true);
    assert.equal(w.root.dataset.motion, 'off', bridge);
    w.system(false);
    w.tell({ motion: 'sideways' });
    assert.equal(w.root.dataset.motion, 'full', bridge);
  }
});

test('motion: the companion\'s own pages follow the settings page at once', async () => {
  let changed = null;
  const root = { dataset: {} };
  const storage = { sync: { get: async () => ({ motion: 'off' }) }, onChanged: { addListener: (f) => { changed = f; } } };
  const ctx = { document: { documentElement: root }, matchMedia: () => ({ matches: false, addEventListener() {} }), globalThis: null, Promise };
  ctx.globalThis = { chrome: { runtime: {}, storage } };
  ctx.chrome = ctx.globalThis.chrome;
  vm.runInNewContext(read('extension/src/lib/motion.js'), ctx);
  await new Promise((r) => setImmediate(r));
  assert.equal(root.dataset.motion, 'off');
  changed({ motion: { newValue: 'calm' } }, 'sync');
  assert.equal(root.dataset.motion, 'calm');
});

test('motion: the Windows app keeps the choice and tells every window, as it loads and when it changes', () => {
  const main = read('desktop/src/main.js');
  assert.match(main, /handle\('sentinel:motion'/);
  assert.match(main, /for \(const w of BrowserWindow\.getAllWindows\(\)\) if \(!w\.isDestroyed\(\)\) w\.webContents\.send\('sentinel:motion-level', next\);/);
  assert.match(main, /contents\.on\('did-finish-load', \(\) => \{ if \(!contents\.isDestroyed\(\)\) contents\.send\('sentinel:motion-level', motionLevel\(\)\); \}\);/);
  assert.match(read('desktop/src/preload.js'), /setMotion: \(m\) => ipcRenderer\.invoke\('sentinel:motion'/);
  for (const f of ['preload.js', 'overlay-preload.js', 'chat-preload.js', 'snip-preload.js']) assert.match(read(`desktop/src/${f}`), /onMotion: \(callback\) => ipcRenderer\.on\('sentinel:motion-level'/, f);
  // The companion's settings page offers the same three, defaulting to Full everywhere a default is read.
  assert.match(read('extension/src/options.html'), /<select id="motion"><option value="full">Full<\/option><option value="calm">Calm<\/option><option value="off">Off<\/option><\/select>/);
  for (const f of ['lib/api.js', 'options.js', 'content/serp.js', 'content/hover.js', 'content/webchat.js']) {
    assert.match(read(`extension/src/${f}`), /motion: 'full'/, f);
  }
});
