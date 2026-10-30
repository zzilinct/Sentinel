'use strict';
/**
 * The corner island (desktop/src/pages/overlay.html): its page script run against a small stand-in page. What is on
 * real screens (the spring, the pointer through a real window, Win+Alt+I, idle CPU) is proved on a GitHub Windows
 * runner (scripts/desktop-e2e.ps1, scripts/review-shots.js); this checks what it says and when it opens.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const html = read('desktop/src/pages/overlay.html');
const main = read('desktop/src/main.js');
const overlay = read('desktop/src/overlay.js');
const watchSrc = read('desktop/src/watch.js');
const COLORS = { red: '#e5484d', orange: '#f08a24', yellow: '#f5c542', clear: '#4cb782' };
const SEVERITY = { red: 'Danger', orange: 'Warning', yellow: 'Caution' };

function island() {
  const code = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const el = (id) => {
    const classes = new Set();
    const e = {
      id, kids: [], hidden: false, text: '', get textContent() { return e.text; }, set textContent(t) { e.text = t; e.kids = []; },
      innerHTML: '', offsetWidth: 100, offsetHeight: 180, dataset: {},
      vars: {}, style: { setProperty(k, v) { e.vars[k] = v; }, transform: '' },
      classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
      appendChild(k) { e.kids.push(k); e.lastChild = k; },
      remove() {}, querySelector: () => el(), getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0 }),
      getAnimations: () => [], focus() { focused.el = id; }, removeAttribute() {}, setAttribute() {},
      querySelectorAll: () => e.kids.filter((k) => !k.classList.contains('is-out'))
    };
    return e;
  };
  const focused = {};
  const els = {};
  const handlers = {};
  const listeners = {};
  const timers = new Map();
  let nextTimer = 1;
  let clock = 0;
  const calls = [];
  const ctx = {
    performance: { now: () => clock },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setTimeout: (f, ms) => { timers.set(nextTimer, { f, at: clock + (ms || 0) }); return nextTimer++; },
    clearTimeout: (t) => timers.delete(t),
    localStorage: { getItem: () => null, setItem() {} },
    location: { search: '' },
    Map, Set, Math, Number, String, Boolean, console, Promise,
    document: { getElementById: (id) => (els[id] = els[id] || el(id)), createElement: () => el(), createTextNode: (t) => ({ text: t }), body: el() }
  };
  ctx.window = Object.assign(ctx, {
    innerWidth: 1000, innerHeight: 700,
    addEventListener: (n, f) => { listeners[n] = f; },
    SentinelMasks: { COLORS, SEVERITY, svg: () => '', mark: () => '', tick: () => '' },
    sentinelOverlay: { on: (n, f) => { handlers[n] = f; }, interact: (on) => calls.push(['interact', on]), act: (a) => calls.push(['act', a]) }
  });
  vm.runInNewContext(code, ctx);
  const tick = (ms) => {
    clock += ms;
    for (const [id, t] of [...timers]) if (t.at <= clock && timers.delete(id)) t.f();
  };
  const send = (name, p) => handlers[name](p);
  const label = els.cornerLabel;
  return {
    els, calls, focused, send, tick,
    words: () => { const k = label.kids.filter((x) => !x.classList.contains('is-out')); return k.length ? k[k.length - 1].innerHTML.replace(/<\/?b>/g, '') : ''; },
    pointer: (x, y) => listeners.mousemove({ clientX: x, clientY: y }),
    key: (key) => listeners.keydown({ key, preventDefault() {} }),
    tab: (ev) => listeners.keydown(ev),
    setActive: (id) => { ctx.document.activeElement = els[id]; },
    blur: () => listeners.blur(),
    isOpen: () => els.corner.classList.contains('is-open'),
    links: () => els.panelLinks.kids.map((li) => `${li.kids[0].textContent}${li.kids[1].text}`)
  };
}

const on = (o, p) => { o.send('overlay:watching', { private: false, fullscreen: false, key: 'Win+Alt+I' }); o.send('overlay:page', p); };
const marks = (...tiers) => ({ epoch: 1, marks: tiers.map((t, i) => ({ x: 0, y: i * 40, w: 100, h: 20, k: `k${i}`, ...(t === 'pending' ? { pending: true } : t === 'clear' ? {} : { badge: t, kind: 'scam', label: 'Phishing' }) })) });

test('at rest it says what is known in a few words, and nothing it does not know', () => {
  const o = island();
  on(o, { host: 'example.com' });
  assert.equal(o.words(), 'Checking');
  o.send('overlay:verdict', { badge: null });     // a new page has begun: not a verdict
  assert.equal(o.words(), 'Checking');
  o.send('overlay:verdict', { badge: null, label: 'No issues found', why: '' });
  assert.equal(o.words(), 'No issues found', 'the scanner\'s own words');
  on(o, { host: 'example.com' });
  o.send('overlay:verdict', { badge: null, unchecked: true });
  assert.equal(o.words(), 'Not checked', 'a failed check never stays "Checking"');
  o.send('overlay:page', null);
  assert.equal(o.words(), 'Watching', 'no page, no claim about one');
});

test('a results page shows its links: seen on this page, each once, worst first', () => {
  const o = island();
  on(o, { host: 'www.bing.com', search: true });
  o.send('overlay:verdict', { badge: null, label: 'Search results' });
  assert.equal(o.words(), 'Watching');
  o.send('overlay:marks', marks('pending', 'pending'));
  assert.equal(o.words(), 'Checking links');
  o.send('overlay:marks', marks('clear', 'clear'));
  assert.equal(o.words(), '2 links checked');
  // Scrolled: the first two left the screen, they still count, and a verdict replaces "pending" instead of adding.
  o.send('overlay:marks', { epoch: 2, marks: [{ x: 0, y: 0, w: 1, h: 1, k: 'k9', badge: 'orange', kind: 'scam', label: 'Phishing' }] });
  assert.equal(o.words(), '1 flagged');
  o.send('overlay:open');
  assert.deepEqual(o.links(), ['1 Warning', '2 Nothing found']);
  // A new page starts from nothing.
  o.key('Escape');
  on(o, { host: 'example.com' });
  o.send('overlay:open');
  assert.deepEqual(o.links(), []);
  assert.equal(o.els.panelLinks.hidden, true, 'no links seen: no row, not a zero');
});

test('a hovered link does not unsay the page\'s verdict', () => {
  const o = island();
  on(o, { host: 'example.com' });
  o.send('overlay:verdict', { badge: null, label: 'No issues found' });
  o.send('overlay:marks', marks('clear'));
  assert.equal(o.words(), 'No issues found');
});

test('the pointer: it stays out of the way, and only a resting pointer opens it', () => {
  const o = island();
  on(o, { host: 'example.com' });
  const overIsland = [950, 665];   // 1000x700 page: the pill ends 18 px in
  o.pointer(500, 300);
  assert.equal(o.els.corner.classList.contains('is-shy'), false);
  o.pointer(...overIsland);
  assert.equal(o.els.corner.classList.contains('is-shy'), true, 'fades so the page under it can be seen');
  o.tick(200);
  assert.equal(o.isOpen(), false);
  assert.deepEqual(o.calls, [], 'clicks still go to the page while the pointer is only passing');
  o.pointer(300, 300);   // moved on: no opening
  o.tick(600);
  assert.equal(o.isOpen(), false);
  o.pointer(...overIsland);
  o.pointer(overIsland[0] + 3, overIsland[1]);   // a tremor does not restart the wait
  o.tick(401);
  assert.equal(o.isOpen(), true);
  assert.deepEqual(o.calls, []);
  // Only now, and only while the pointer is on it, does the window take the pointer.
  o.pointer(...overIsland);
  assert.deepEqual(o.calls, [['interact', true]]);
  o.pointer(100, 100);
  assert.deepEqual(o.calls, [['interact', true], ['interact', false]], 'off the panel, clicks go to the page at once');
  assert.equal(o.isOpen(), true, 'a slip off it does not close it at once');
  o.pointer(...overIsland);
  o.tick(800);
  assert.equal(o.isOpen(), true);
  o.pointer(100, 100);
  o.tick(601);
  assert.equal(o.isOpen(), false, 'collapses by itself');
});

test('hidden for full-screen video, unless the page is dangerous', () => {
  assert.match(html, /\.corner\.is-on\.is-quiet:not\(\.is-flagged\) \{ opacity: 0; \}/);
  const o = island();
  on(o, { host: 'video.example' });
  o.send('overlay:watching', { fullscreen: true });
  o.pointer(950, 665);
  o.tick(500);
  assert.equal(o.isOpen(), false, 'a hidden island does not open under a game or a film');
  o.send('overlay:verdict', { badge: 'red', kind: 'scam', label: 'Phishing' });
  o.pointer(951, 665);
  o.tick(500);
  assert.equal(o.isOpen(), true);
});

test('the panel: verdict and reason, and the pause only for a site checked and found clean', () => {
  const o = island();
  on(o, { host: 'shop.example' });
  o.send('overlay:open');
  assert.equal(o.els.panelVerdict.textContent, 'Checking this site');
  assert.equal(o.els.panelPause.hidden, true, 'not before a verdict');
  assert.equal(o.els.panelWhy.hidden, true);
  o.send('overlay:verdict', { badge: null, label: 'No issues found', why: 'Listed by no threat feed.' });
  assert.equal(o.els.panelSite.textContent, 'shop.example');
  assert.equal(o.els.panelVerdict.textContent, 'No issues found');
  assert.equal(o.els.panelWhy.textContent, 'Listed by no threat feed.');
  assert.equal(o.els.panelPause.hidden, false);
  o.send('overlay:verdict', { badge: 'orange', kind: 'scam', label: 'Likely phishing', why: 'Pretends to be PayPal' });
  assert.equal(o.els.panelVerdict.textContent, 'Warning: Likely phishing');
  assert.equal(o.els.panelPause.hidden, true, 'a flagged page can never be paused from here');
  o.key('Escape');
  // A results page, a private window, a page the scanner could not check: nothing to pause.
  for (const p of [{ host: 'www.bing.com', search: true }, { host: null, private: true }]) {
    const q = island();
    on(q, p);
    q.send('overlay:verdict', { badge: null, label: 'No issues found', why: 'the reason' });
    q.send('overlay:open');
    assert.equal(q.els.panelPause.hidden, true, JSON.stringify(p));
    if (p.private) { assert.equal(q.els.panelSite.textContent, 'Private window'); assert.equal(q.els.panelWhy.hidden, true); }
  }
});

test('pause and resume go through the app, which decides; the page only reports', () => {
  const o = island();
  on(o, { host: 'shop.example' });
  o.send('overlay:verdict', { badge: null, label: 'No issues found' });
  o.send('overlay:open');
  o.els.panelPause.onclick();
  assert.deepEqual(o.calls.filter((c) => c[0] === 'act'), [['act', 'pause']]);
  assert.equal(o.els.panelVerdict.textContent, 'No issues found', 'not paused until the app says so');
  o.send('overlay:paused', { locked: true });
  assert.match(o.els.panelWhy.textContent, /Locked by a parent/);
  assert.equal(o.words(), 'No issues found');
  o.send('overlay:paused', { paused: true });
  assert.equal(o.words(), 'Paused here');
  assert.equal(o.els.panelPause.textContent, 'Check this site again');
  o.els.panelPause.onclick();
  assert.deepEqual(o.calls.filter((c) => c[0] === 'act').pop(), ['act', 'resume']);
  o.send('overlay:paused', { paused: false });
  assert.equal(o.words(), 'Checking');
});

test('the app keeps the rule: one clean site, an hour, memory only, under the parent lock', () => {
  const body = main.slice(main.indexOf('function islandAction('), main.indexOf('const ISLAND_KEY'));
  assert.match(body, /!page\.host \|\| page\.host !== islandHost \|\| page\.badge\) return;/, 'never a flagged page, whatever the panel says');
  assert.match(body, /lock\.guard\(`live checks on \$\{page\.host\} off`, true\)/);
  assert.match(main, /const SITE_PAUSE_MS = 60 \* 60 \* 1000;/);
  assert.doesNotMatch(body, /store\.set/, 'a site\'s name is not written to disk');
  assert.match(main, /islandHost = page && !page\.private \? escapeKey\(page\) : null;/, 'never a private window\'s site');
  assert.match(main, /paused: \(host\) => sitePaused\(host\)/);
  for (const fn of ['async function onLinks(msg) {', 'async function onHover(h) {', 'async function onMail(msg) {']) {
    assert.match(watchSrc.slice(watchSrc.indexOf(fn)), /^[^\n]*\n\s*if \(sitePaused\(\)\) return;/, fn);
  }
  assert.match(watchSrc, /if \(sitePaused\(\)\) return;\r?\n\s*settleTimer = setTimeout/);
});

test('keyboard: its shortcut brings the keyboard in, Escape or leaving gives it back, and it never closes by a timer', () => {
  const o = island();
  on(o, { host: 'shop.example' });
  o.send('overlay:open');
  assert.equal(o.focused.el, 'panelOpen', 'no pause on offer yet: the first button there is');
  o.tick(60000);
  assert.equal(o.isOpen(), true, 'someone reading with a screen reader gets all the time they need');
  o.key('Escape');
  assert.equal(o.isOpen(), false);
  assert.deepEqual(o.calls.pop(), ['act', 'released']);
  o.send('overlay:verdict', { badge: null, label: 'No issues found' });
  o.send('overlay:open');
  assert.equal(o.focused.el, 'panelPause');
  o.blur();
  assert.equal(o.isOpen(), false);
  assert.deepEqual(o.calls.pop(), ['act', 'released']);
  // The shortcut is held only while a browser is in front.
  assert.match(main, /syncIslandKey\(Boolean\(rect\)\);\r?\n\s*overlay\.setWindow\(rect\);/);
  assert.match(main, /globalShortcut\.register\(ISLAND_KEY, \(\) => overlay\.keyboard\(watch\)\)/);
  // The reader goes on watching the browser while the panel has the keyboard, and the keyboard goes back to it.
  assert.match(watchSrc, /if \(\$overlayH -ne \[IntPtr\]::Zero -and \$h -eq \$overlayH\) \{ continue \}/);
  assert.match(overlay, /if \(giveBack\) giveBack\(\);/);
  assert.doesNotMatch(overlay, /win\.blur\(\)/, 'blur() handed the keyboard to Sentinel\'s own window on a real desktop');
  assert.ok(watchSrc.includes("if ($cmd -eq 'back' -and $overlayH -ne [IntPtr]::Zero -and $browserH -ne [IntPtr]::Zero -and [SW]::GetForegroundWindow() -eq $overlayH) { [SW]::Front($browserH) }"), 'never taken from wherever the person has gone');
});

test('Tab stays in the panel: one button or two, it never leaves the window', () => {
  const o = island();
  on(o, { host: 'shop.example' });
  o.send('overlay:verdict', { badge: null, label: 'No issues found' });
  o.send('overlay:open');
  const seen = [];
  const press = (shiftKey) => { let prevented = false; o.tab({ key: 'Tab', shiftKey, preventDefault() { prevented = true; } }); assert.ok(prevented); seen.push(o.focused.el); };
  o.setActive('panelPause'); press(false);
  o.setActive('panelOpen'); press(false);
  o.setActive('panelPause'); press(true);
  assert.deepEqual(seen, ['panelOpen', 'panelPause', 'panelOpen']);
  o.send('overlay:verdict', { badge: 'yellow', kind: 'scam', label: 'Suspicious' });
  o.setActive('panelOpen'); press(false);
  assert.equal(o.focused.el, 'panelOpen', 'the one button keeps the focus');
});

test('it is labelled, keeps out of the tab order closed, respects reduced motion, and rests without a frame', () => {
  assert.match(html, /id="corner" role="region" aria-label="Sentinel, this page"/);
  assert.match(html, /id="panel" tabindex="-1" aria-labelledby="panelSite panelVerdict" aria-describedby="panelWhy"/);
  assert.match(html, /\.panel \{[^}]*visibility: hidden;/);
  assert.match(html, /<button type="button" id="panelPause">/);
  assert.match(html, /\.isl__rim, \.isl__sheet, \.corner\.is-folding \.isl__rim, \.corner\.is-folding \.isl__sheet \{ transition: none; \}/);
  assert.match(html, /@media \(forced-colors: active\) \{ \.corner \{ forced-color-adjust: none; \} \}/);
  // Solid fill, so it reads the same on light and dark pages. Nothing scaled, nothing looping.
  assert.match(html, /\.isl__sheet \{[^}]*background: #0c0d10;/);
  const islandCss = html.slice(html.indexOf('.corner {'), html.indexOf('.mark {'));
  assert.doesNotMatch(islandCss, /infinite|scale\((?!\.97)/);
  assert.ok(!html.includes('—'), 'no em dash');
  assert.doesNotMatch(html, /will-change:[^;]*clip-path/);
});

test('the corner pill in the companion is the same shape, and no longer pulses for ever', () => {
  const serp = read('extension/src/content/serp.js');
  const chip = serp.slice(serp.indexOf('.chip{'), serp.indexOf('</style>', serp.indexOf('.chip{')));
  assert.match(chip, /right:18px;bottom:18px/);
  assert.match(chip, /clip-path:inset\(0 0 0 calc\(100% - 34px\) round 17px\)/);
  assert.doesNotMatch(chip, /infinite|pulse/);
  assert.equal(chip.match(/linear\([^)]*\)/)[0], html.match(/--spring: (linear\([^)]*\))/)[1]);
  assert.equal(read('extension/src/content/alarm.js'), read('extension/src/content/alarm.page.js'), 'the page world\'s copy');
  assert.match(read('extension/src/content/alarm.js'), /@keyframes isl\{from\{clip-path:inset\(calc\(100% - 34px\) 0 0 calc\(100% - 34px\) round 17px\)\}/);
});
