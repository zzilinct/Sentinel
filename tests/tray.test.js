'use strict';
/**
 * The Windows app's one protection state (desktop/src/protection.js), the tray icon, tooltip, menu and card that read
 * it, the start window, and the notification queue that keeps every note off a full-screen game (desktop/src/notes.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { protectionState, trayIcon, trayTooltip } = require('../desktop/src/protection');
const { createNotes, RETRY_MS, KEEP_MS } = require('../desktop/src/notes');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const base = () => ({
  booting: false, down: false, windows: true,
  downloads: { enabled: true, active: true, reason: null },
  defense: { enabled: true, active: true, reason: null },
  live: { enabled: false, active: false, reason: 'Live scanning is off', window: false },
  chat: { enabled: false, running: false },
  texts: { enabled: false, running: false }
});

test('the protection state never says on while something switched on is not running', () => {
  const ok = protectionState(base());
  assert.equal(ok.level, 'on');
  assert.equal(ok.headline, 'Protection is on');
  assert.equal(ok.sub, '2 of 5 protections are on.', 'a real count: downloads and Defense of the five');

  // Every protection the person switched on, one at a time, in trouble: never "on", and the reason is said.
  for (const [key, broken] of [['downloads', { active: false, reason: 'Cannot watch the Downloads folder' }], ['defense', { active: false, reason: 'Defense: could not start' }],
    ['live', { enabled: true, active: false, reason: 'Sentinel is offline. Trying again shortly.' }], ['chat', { enabled: true, running: false }], ['texts', { enabled: true, running: false }]]) {
    const s = base();
    s[key] = { ...s[key], ...broken };
    const p = protectionState(s);
    assert.equal(p.level, 'partly', key);
    assert.notEqual(p.headline, 'Protection is on', key);
    assert.match(p.sub, /: \S/, `${key} says why: ${p.sub}`);
    assert.equal(trayIcon(p.level), 'tray-partly');
  }

  // Not part of the plan, or signed out: not a fault, not counted, and not "on" either.
  const free = base();
  free.downloads = { enabled: true, active: false, reason: 'Download protection is part of Pro, Max and Ultimate' };
  const f = protectionState(free);
  assert.equal(f.level, 'on');
  assert.equal(f.items.find((i) => i.id === 'downloads').state, 'unavailable');
  assert.equal(f.sub, '1 of 4 protections are on.');

  // Nothing running at all, the scanner down, and starting.
  const none = base();
  none.downloads.enabled = false; none.defense.enabled = false;
  assert.equal(protectionState(none).level, 'off');
  assert.equal(trayIcon('off'), 'tray-off');
  assert.equal(protectionState({ ...base(), down: true }).level, 'off');
  assert.equal(protectionState({ ...base(), booting: true }).level, 'starting');
  assert.equal(trayIcon('starting'), 'tray-off', 'starting is not protected yet');
  const coming = base();
  coming.defense = { enabled: true, active: false, reason: 'Starting' };
  assert.equal(protectionState(coming).level, 'starting');

  // The live note follows the browser in front; outside Windows there is no Defense, chat or texts line.
  const live = base();
  live.live = { enabled: true, active: true, window: true };
  assert.equal(protectionState(live).items.find((i) => i.id === 'live').note, 'Watching the browser in front');
  assert.deepEqual(protectionState({ ...base(), windows: false }).items.map((i) => i.id), ['downloads', 'live']);
});

test('the tooltip fits Windows and says the same as the headline', () => {
  const s = base();
  s.live = { enabled: true, active: false, reason: `Live scanning could not start (${'x'.repeat(200)})` };
  const p = protectionState(s);
  const tip = trayTooltip(p);
  assert.ok(tip.length <= 127, `${tip.length} characters`);
  assert.ok(tip.startsWith(`Sentinel: ${p.headline}.`));
  for (const level of ['on', 'partly', 'off', 'starting']) assert.doesNotMatch(trayTooltip({ headline: level, sub: 'x' }), /—/);
});

/** A PNG as make-icons.js writes it (8-bit RGBA, filter 0 on every row). */
function decode(file) {
  const b = fs.readFileSync(file);
  let o = 8, w = 0, h = 0;
  const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), type = b.toString('ascii', o + 4, o + 8), data = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    assert.equal(raw[y * (w * 4 + 1)], 0, 'filter 0');
    raw.copy(px, y * w * 4, y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1));
  }
  return { w, h, px };
}

test('the three tray icons differ in shape, not only in colour, at 16, 24 and 32 px', () => {
  const dir = path.join(ROOT, 'desktop', 'build');
  for (const [suffix, size] of [['', 16], ['@1.5x', 24], ['@2x', 32]]) {
    const icon = Object.fromEntries(['on', 'partly', 'off'].map((l) => [l, decode(path.join(dir, `tray-${l}${suffix}.png`))]));
    for (const l of Object.keys(icon)) assert.equal(icon[l].w, size, `${l}${suffix}`);
    // Shape: where the icon is see-through and where it is not. A person who sees no colour at all still sees this.
    const shape = (a, b) => { let n = 0; for (let i = 3; i < a.px.length; i += 4) if (Math.abs(a.px[i] - b.px[i]) > 100) n++; return n / (size * size); };
    // Greyscale: what the icon looks like with every colour taken away.
    const grey = (a, b) => { let n = 0; for (let i = 0; i < a.px.length; i += 4) { const g = (p) => (0.3 * p.px[i] + 0.59 * p.px[i + 1] + 0.11 * p.px[i + 2]) * p.px[i + 3] / 255; if (Math.abs(g(a) - g(b)) > 40) n++; } return n / (size * size); };
    for (const [a, b] of [['on', 'partly'], ['on', 'off'], ['partly', 'off']]) {
      assert.ok(shape(icon[a], icon[b]) >= 0.04, `${a} and ${b} at ${size} px differ in shape: ${(shape(icon[a], icon[b]) * 100).toFixed(1)}% of pixels`);
      assert.ok(grey(icon[a], icon[b]) >= 0.08, `${a} and ${b} at ${size} px differ in greyscale: ${(grey(icon[a], icon[b]) * 100).toFixed(1)}% of pixels`);
    }
  }
  assert.match(read('desktop/scripts/sync-shared.js'), /tray-\[a-z\]\+/, 'the build copies them into the app');
});

test('notes wait while Windows says the person is busy, and for their own moment', async () => {
  let busy = true;
  let clock = 0;
  const shown = [];
  const timers = [];
  const notes = createNotes({ show: (n) => shown.push(n.title), busy: async () => busy, now: () => clock, later: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; }, cancel: (t) => { t.dead = true; } });
  const fire = async () => { const t = timers.shift(); if (t && !t.dead) await t.fn(); };

  // Busy (a full-screen game): nothing is shown, the note waits, one timer, a minute first.
  await notes.push({ title: 'Sentinel stopped a copied command', body: '' });
  assert.deepEqual(shown, []);
  assert.equal(notes.waiting(), 1);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, RETRY_MS[0]);
  // Still busy: asked less and less often.
  await fire();
  assert.deepEqual(shown, []);
  assert.equal(timers[0].ms, RETRY_MS[1]);
  // The game is closed: the note is shown at the next look.
  busy = false;
  await fire();
  assert.deepEqual(shown, ['Sentinel stopped a copied command']);
  assert.equal(notes.waiting(), 0);
  assert.equal(timers.filter((t) => !t.dead).length, 0, 'an empty queue keeps no timer');

  // An offer waits for its own moment (Roblox not in front), and counts as made only once it is shown.
  let inFront = 'RobloxPlayerBeta';
  let offered = false;
  await notes.push({ title: 'Sentinel can watch your Roblox chats', body: '', ready: () => inFront !== 'RobloxPlayerBeta', onShown: () => { offered = true; } });
  assert.equal(shown.length, 1);
  assert.equal(offered, false);
  inFront = null;
  await notes.flush();
  assert.equal(shown.at(-1), 'Sentinel can watch your Roblox chats');
  assert.equal(offered, true);

  // A note that waited past its time is dropped, not shown late; the same title again replaces the one waiting.
  busy = true;
  await notes.push({ title: 'old', body: '' });
  await notes.push({ title: 'old', body: 'newer' });
  assert.equal(notes.waiting(), 1);
  clock += KEEP_MS + 1;
  busy = false;
  await notes.flush();
  assert.ok(!shown.includes('old'));
});

test('notes: a busy check that fails does not hold notes for ever', async () => {
  const shown = [];
  const notes = createNotes({ show: (n) => shown.push(n.title), busy: async () => { throw new Error('no PowerShell'); }, later: () => ({}), cancel: () => {} });
  await notes.push({ title: 'a', body: '' });
  assert.deepEqual(shown, ['a']);
});

test('main.js: every notification goes through the queue, and the tray reads the one state', () => {
  const main = read('desktop/src/main.js');
  // One place makes a Windows notification, and only the queue calls it.
  assert.equal((main.match(/new Notification\(/g) || []).length, 1);
  assert.match(main, /function showNote\(\{ title, body, onClick \}\) \{\r?\n {2}const n = new Notification/);
  assert.match(main, /const notes = createNotes\(\{ show: showNote, busy: \(\) => fullscreenInFront\(\)/);
  assert.match(main, /function notify\(title, body, onClick, \{ ready, onShown, keepMs \} = \{\}\) \{\r?\n {2}if \(!Notification\.isSupported\(\)\) return;\r?\n {2}notes\.push\(/);
  assert.equal((main.match(/showNote\(/g) || []).length, 1, 'showNote is only handed to the queue');
  // No caller checks for a game by hand before a note any more: the gate is inside notify.
  assert.doesNotMatch(main, /fullscreenInFront\(\)\)? return;\s*\/\/ asked again/);
  // Offers count once shown, and never while the app they are about is in front.
  assert.match(main, /onShown: \(\) => store\.set\(`chatOffered:\$\{name\}`, true\)/);
  assert.doesNotMatch(main, /store\.set\(`chatOffered:\$\{name\}`, true\);\r?\n/);
  // The tray: icon and tooltip from the one state, only when they change; a short menu with no switches in it.
  const tray = main.slice(main.indexOf('function refreshTray()'), main.indexOf('/** Where the tray card springs from'));
  assert.match(tray, /const icon = trayIcon\(state\.level\);\r?\n {2}if \(icon !== trayShows\.icon\) \{ tray\.setImage/);
  assert.match(tray, /if \(tip !== trayShows\.tip\) \{ tray\.setToolTip\(tip\)/);
  assert.doesNotMatch(tray, /type: 'checkbox'|enabled: false|submenu/);
  assert.ok((tray.match(/\{ label: /g) || []).length <= 10, 'ten lines at most');
  assert.match(tray, /\{ label: state\.headline, /, 'the first line is the headline');
  assert.match(main, /tray\.on\('click', \(\) => toggleTrayCard\(\)\)/);
  // The card goes when it loses the keyboard, and its window with it.
  assert.match(main, /trayWin\.on\('blur', \(\) => \{ if \(trayWin && !trayWin\.isDestroyed\(\)\) trayWin\.close\(\); \}\)/);
  // Its switches go through the parent lock when they switch something off.
  assert.match(main, /if \(!on && !trayGuard\(what, true\)\) return trayState\(\);/);
});

test('one start window: real steps, a calm failure, and the first start asks once', () => {
  const pages = path.join(ROOT, 'desktop', 'src', 'pages');
  assert.ok(!fs.existsSync(path.join(pages, 'loading.html')), 'loading.html is replaced');
  assert.ok(!fs.existsSync(path.join(pages, 'error.html')), 'error.html is replaced');
  const main = read('desktop/src/main.js');
  assert.doesNotMatch(main, /loading\.html|error\.html/);
  // The steps are main.js's own: scanner, protections, the app. A retry moves the page on, it never reloads it.
  const boot = main.slice(main.indexOf('async function boot()'), main.indexOf('app.whenReady()'));
  const order = ["setStart({ stage: 'scanner' })", "setStart({ stage: 'protections' })", "setStart({ stage: 'app' })"].map((x) => boot.indexOf(x));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], `steps in order: ${order}`);
  assert.match(main, /setStart\(\{ view: 'error', message, retryIn: wait \}\)/);
  // The first start: only a computer with no settings yet, never a start in the tray, and its answer switches on
  // only what was ticked.
  assert.match(main, /firstRun = !startHidden && !require\('fs'\)\.existsSync\(path\.join\(app\.getPath\('userData'\), 'settings\.json'\)\);\r?\n {2}store\.init/);
  const answer = main.slice(main.indexOf("handle('sentinel:start-answer'"), main.indexOf("handle('sentinel:tray-state'"));
  assert.match(answer, /if \(a\.live\) await setLiveScanning\(true/);
  assert.match(answer, /if \(a\.chat && process\.platform === 'win32'\) setChatSafety\(true\)/);
  assert.match(answer, /, trustedLocal\);/);
  const page = read('desktop/src/pages/start.html');
  // Sensitive extras are asked, never ticked for the person; the page has no em dash.
  for (const id of ['chat', 'texts', 'links']) assert.match(page, new RegExp(`<input type="checkbox" id="${id}">`));
  assert.match(page, /<input type="checkbox" id="live" checked>/);
  assert.doesNotMatch(page + read('desktop/src/pages/tray.html'), /—/);
  // The preload passes only the four answers, as booleans.
  assert.match(read('desktop/src/preload.js'), /startAnswer: \(answer\) => ipcRenderer\.invoke\('sentinel:start-answer', answer && typeof answer === 'object' \? \{ live: answer\.live === true/);
});
