'use strict';
// The companion's settings: storage.sync, or storage.local when sync throws (Firefox with sync switched off), through
// one helper (extension/src/lib/store.js) that every reader and writer uses. And the look record, which now carries
// text size and spacing, so the popup follows the app's Settings.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const L = require('../web/assets/js/look.js');

const SRC = path.join(__dirname, '..', 'extension', 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

function store(sync) {
  const local = {};
  const changes = [];
  const area = (box, name) => ({
    get: async (d) => { const out = {}; for (const k of Array.isArray(d) ? d : Object.keys(d)) out[k] = k in box ? box[k] : (Array.isArray(d) ? undefined : d[k]); return out; },
    set: async (o) => { Object.assign(box, o); changes.push(name); },
    remove: async (k) => { for (const x of [].concat(k)) delete box[x]; }
  });
  const ctx = { chrome: { runtime: {}, storage: { local: area(local, 'local'), ...(sync ? { sync } : {}) } } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('lib/store.js'), ctx);
  return { S: ctx.SentinelStore, local, changes };
}

test('companion settings: when storage.sync throws, they are read from and saved to storage.local', async () => {
  const refuse = () => Promise.reject(new Error('Please set webextensions.storage.sync.enabled to true in about:config'));
  const cases = {
    'sync rejects': { get: refuse, set: refuse, remove: refuse },
    'sync throws at once': { get() { throw new Error('sync off'); }, set() { throw new Error('sync off'); }, remove() { throw new Error('sync off'); } },
    'no sync at all': null
  };
  for (const [name, sync] of Object.entries(cases)) {
    const { S, local, changes } = store(sync);
    assert.deepEqual({ ...(await S.get({ motion: 'full', enabled: true })) }, { motion: 'full', enabled: true }, `${name}: the defaults, not an error`);
    await S.set({ motion: 'calm' });
    assert.equal(local.motion, 'calm', `${name}: kept in local`);
    assert.deepEqual(changes, ['local']);
    assert.equal((await S.get({ motion: 'full' })).motion, 'calm', `${name}: read back`);
    await S.remove(['motion']);
    assert.equal(local.motion, undefined);
  }
  // Sync working: sync is used, local is left alone.
  const kept = {};
  const { S, local } = store({ get: async (d) => ({ ...d, ...kept }), set: async (o) => { Object.assign(kept, o); }, remove: async () => {} });
  await S.set({ motion: 'off' });
  assert.deepEqual([kept.motion, local.motion], ['off', undefined]);
  // A change heard from either place, settings keys only (local also holds the look, the account and the token).
  const D = { motion: 'full', enabled: true };
  assert.deepEqual({ ...S.changed({ motion: { newValue: 'calm' }, look: { newValue: {} } }, 'local', D) }, { motion: 'calm' });
  assert.deepEqual({ ...S.changed({ enabled: { newValue: false } }, 'sync', D) }, { enabled: false });
  assert.equal(S.changed({ account: { newValue: {} } }, 'local', D), null);
  assert.equal(S.changed({ motion: { newValue: 'off' } }, 'session', D), null);
});

test('companion settings: every reader and writer goes through lib/store.js, which is loaded before it', () => {
  const files = [];
  const walk = (dir) => { for (const e of fs.readdirSync(path.join(SRC, dir), { withFileTypes: true })) { const f = dir ? `${dir}/${e.name}` : e.name; if (e.isDirectory()) walk(f); else if (f.endsWith('.js')) files.push(f); } };
  walk('');
  // background.firefox.js is built from lib/store.js and the rest (scripts/build-extension.js).
  for (const f of files.filter((x) => x !== 'lib/store.js' && x !== 'background.firefox.js')) {
    assert.doesNotMatch(read(f), /storage\.sync\b/, `${f} reads or writes storage.sync itself: use SentinelStore (lib/store.js)`);
    assert.doesNotMatch(read(f), /area\s*[!=]==?\s*'sync'/, `${f} hears only sync: use SentinelStore.changed`);
  }
  const users = files.filter((f) => /SentinelStore\b/.test(read(f)) && f !== 'lib/store.js');
  for (const f of ['options.js', 'lib/motion.js', 'lib/api.js', 'background.js', 'content/hover.js', 'content/serp.js', 'content/webchat.js', 'content/mail.js', 'content/alarm.js']) assert.ok(users.includes(f), `${f} uses SentinelStore`);
  const m = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'manifest.json'), 'utf8'));
  for (const c of m.content_scripts) {
    const at = c.js.indexOf('src/lib/store.js');
    c.js.forEach((j, i) => { if (users.includes(j.replace(/^src\//, ''))) assert.ok(at >= 0 && at < i, `${j}: lib/store.js loads before it in its manifest group`); });
  }
  for (const page of ['popup.html', 'options.html', 'block.html']) {
    const html = read(page);
    assert.ok(html.indexOf('<script src="lib/store.js">') > 0 && html.indexOf('<script src="lib/store.js">') < html.indexOf('<script src="lib/motion.js">'), `${page}: store.js before motion.js`);
  }
  assert.match(read('lib/api.js'), /^import '\.\/store\.js';$/m);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-extension.js'), 'utf8'), /strip\('lib\/store\.js'\), strip\('lib\/say\.js'\)/, 'Firefox gets it before the worker');
});

test('the look carries text size and spacing, so the companion follows the app\'s Settings', () => {
  const a = { mode: 'dark', accent: 'gold', text: 'standard', density: 'compact', at: { mode: 5, accent: 5, text: 10, density: 40 } };
  const b = { mode: 'dark', accent: 'gold', text: 'larger', density: 'comfortable', at: { text: 30, density: 20 } };
  const m = L.merge(a, b);
  assert.deepEqual([m.text, m.density, m.at.text, m.at.density], ['larger', 'compact', 30, 40], 'each from whichever chose it last');
  assert.equal(L.rev(m), 40, 'lookRev moves when the text size or spacing changes, so the companion asks again');
  assert.deepEqual([L.record({ text: 'tiny', density: 'airy' }).text, L.record({ text: 'tiny', density: 'airy' }).density], ['standard', 'comfortable']);
  // Drawn as boot.js draws it: data-text and data-density on <html>, none for the defaults.
  const attrs = {};
  const el = { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } };
  L.type(el, { text: 'larger', density: 'compact' });
  assert.deepEqual(attrs, { 'data-text': 'larger', 'data-density': 'compact' });
  L.type(el, {});
  assert.deepEqual(attrs, {});
  // The companion's pages draw it before the first paint and whenever the kept look changes; the popup's words and rows use it.
  assert.match(read('lib/look.js'), /paint\(document\.documentElement, kept\); type\(document\.documentElement, kept\);/);
  assert.match(read('lib/lookhere.js'), /L\.KEYS\.every\(\(k\) => r\[k\] === shown\[k\]\)/);
  assert.match(read('lib/lookhere.js'), /L\.paint\(html, r\); L\.type\(html, r\);/);
  assert.match(read('popup.css'), /:root\[data-density="compact"\] \{ --ds: \.86; \}/);
  assert.match(read('popup.css'), /\.btn \{[^}]*padding: calc\(10px \* var\(--ds\)\) 14px/);
  // The app's Settings choose through the look, which keeps when, so it travels; boot.js still draws it first.
  const app = fs.readFileSync(path.join(__dirname, '..', 'web', 'assets', 'js', 'app.js'), 'utf8');
  assert.match(app, /SentinelLook\.set\(\{ text: b\.dataset\.seg \}\)/);
  assert.match(app, /SentinelLook\.set\(\{ density: b\.dataset\.seg \}\)/);
  const lookApp = fs.readFileSync(path.join(__dirname, '..', 'web', 'assets', 'js', 'look-app.js'), 'utf8');
  assert.match(lookApp, /Type\.set\(\{ text: r\.text, density: r\.density \}\)/, 'a newer choice from elsewhere is drawn through SentinelType');
});
