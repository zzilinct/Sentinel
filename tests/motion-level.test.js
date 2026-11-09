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
      if (read(rel).includes('prefers-reduced-motion')) found.push(rel);
    }
  }
  assert.deepEqual(found, []);
  // The overlay and the companion each resolve it once, and style only through data-motion.
  const overlay = read('desktop/src/pages/overlay.html');
  assert.equal(overlay.split('prefers-reduced-motion').length - 1, 1);
  assert.match(overlay, /:root\[data-motion="off"\] \{/);
  assert.match(overlay, /api\.on\('overlay:motion'/);
  for (const f of ['serp.js', 'hover.js', 'webchat.js', 'alarm.js']) {
    const s = read(`extension/src/content/${f}`);
    assert.doesNotMatch(s, /@media \(prefers-reduced-motion/, f);
    assert.match(s, /:host\(\[data-motion=off\]\)/, f);
  }
  assert.equal(read('extension/src/content/alarm.page.js'), read('extension/src/content/alarm.js'));
});

test('motion: the Windows app keeps the choice and hands it to the overlay', () => {
  const main = read('desktop/src/main.js');
  assert.match(main, /handle\('sentinel:motion'/);
  assert.match(main, /overlay\.setMotion\(\{ motion: store\.get\('motion', 'full'\)/);
  assert.match(read('desktop/src/preload.js'), /setMotion: \(m\) => ipcRenderer\.invoke\('sentinel:motion'/);
  assert.match(read('desktop/src/overlay-preload.js'), /'overlay:motion'/);
  // The companion's settings page offers the same three, defaulting to Full everywhere a default is read.
  assert.match(read('extension/src/options.html'), /<select id="motion"><option value="full">Full<\/option><option value="calm">Calm<\/option><option value="off">Off<\/option><\/select>/);
  for (const f of ['lib/api.js', 'options.js', 'content/serp.js', 'content/hover.js', 'content/webchat.js']) {
    assert.match(read(`extension/src/${f}`), /motion: 'full'/, f);
  }
});
