'use strict';
/**
 * The desktop app's own rules, checked without Electron: what live scanning is
 * allowed to read and when, which links on a results page get a mark, and that
 * defense never acts on a guess against a program Windows can vouch for.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The app carries a copy of the scanner in desktop/shared. Copy just that if it is not there yet: the full
// sync also rebuilds the companion folders, which tests/extension.test.js does at the same moment in another process.
{
  const shared = path.join(__dirname, '..', 'desktop', 'shared');
  fs.mkdirSync(shared, { recursive: true });
  for (const file of ['filescan.js', 'lists.js', 'brands.js']) fs.copyFileSync(path.join(__dirname, '..', 'server', 'lib', 'scan', file), path.join(shared, file));
}
const watch = require('../desktop/src/watch.js');
const defense = require('../desktop/src/defense.js');
const { fakeStealerExe } = require('./fixtures');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('the reader only works on a browser that is in front and in use, and reads addresses, not pages', () => {
  const s = watch._test.SCRIPT;
  // Not in front, minimised, or nobody at the keyboard: the loop goes round without reading anything.
  // (includes, not match: a failure should not print the whole script)
  assert.ok(s.includes("($browsers -notcontains $fname)) { Off 'not in front'; continue }"), 'behind another program: nothing is read');
  assert.ok(s.includes("IsIconic($h)) { Off 'minimised'; continue }"), 'minimised: nothing is read');
  assert.ok(s.includes('IdleMs() -gt 120000'), 'nobody at the keyboard: nothing is read');
  const gates = s.indexOf("Off 'idle'");
  assert.ok(gates > 0 && gates < s.indexOf('FromHandle'), 'every gate comes before the first look inside the window');
  // What it asks Windows for: the address (Value), rectangles, and whether a link is on screen. Never text.
  assert.ok(!/TextPattern|NameProperty|HelpText|LegacyIAccessible|Clipboard|CopyFromScreen|Screenshot/i.test(s), 'no page text, no clipboard, no screenshots');
  assert.ok(s.includes('InPrivate|Incognito|Private Browsing'), 'private windows are recognised by their title');
  for (const b of ['chrome', 'msedge', 'brave', 'opera', 'vivaldi', 'duckduckgo', 'firefox', 'librewolf']) assert.ok(s.includes(`'${b}'`), b);
});

test('a results page gets one mark per outside result; the search engine\'s own links get none', () => {
  const at = (u, y) => ({ u, x: 180, y, w: 420, h: 24 });
  const links = [
    at('https://www.google.com/preferences', 10),
    at('https://accounts.google.com/ServiceLogin', 20),
    at('https://example-recipes.com/best-bread', 200),
    at('https://example-recipes.com/best-bread', 230),            // the same result's second link
    at('https://EXAMPLE-recipes.com/best-bread#reviews', 240),    // and a fragment of it
    at('https://www.youtube.com/watch?v=abc', 300),               // the engine's own property
    at('https://paypa1-secure-login.com/account', 360),
    at('javascript:void(0)', 400)
  ];
  const out = watch._test.resultLinks(links, 'https://www.google.com/search?q=bread');
  assert.deepEqual(out.map((l) => l.u), ['https://example-recipes.com/best-bread', 'https://paypa1-secure-login.com/account']);
  assert.equal(out[0].y, 200, 'the mark goes beside the first link to that address');
  const many = Array.from({ length: 80 }, (_, i) => at(`https://site${i}.example/`, 100 + i * 30));
  assert.equal(watch._test.resultLinks(many, 'https://duckduckgo.com/?q=x').length, 40, 'capped');
});

test('a verdict wears the mask of its worst threat', () => {
  assert.equal(watch._test.worstKind({ threats: { scam: { badge: 'yellow' }, malware: { badge: 'red' }, virus: { badge: null } } }), 'malware');
  assert.equal(watch._test.worstKind({ threats: { scam: { badge: null } } }), 'scam');
  assert.equal(watch._test.worstKind(null), 'scam');
});

test('private windows leave nothing behind: not in history, not in the log, not in the live list', () => {
  const w = read('desktop/src/watch.js');
  assert.match(w, /if \(opts\.onChecked && !page\.private\) opts\.onChecked/, 'the log and the live list are fed only by ordinary windows');
  assert.match(w, /state\.current = page\.private \? \{ browser: page\.browser, url: null, private: true/, 'the address is not kept where the app window can read it');
  assert.match(w, /live\/batch', \{ urls: missing, private: page\.private \}/);
  assert.match(read('server/routes/scan.routes.js'), /recordFlagged: body\.private !== true/, 'flagged private results are not written to history');
});

test('the overlay can never take a click, a key or the focus, and is told nothing but marks', () => {
  const o = read('desktop/src/overlay.js');
  assert.match(o, /focusable: false/);
  assert.match(o, /setIgnoreMouseEvents\(true, \{ forward: true \}\)/);
  assert.match(o, /showInactive\(\)/);
  assert.doesNotMatch(o, /\.show\(\)|\.focus\(\)/, 'it is only ever shown without activation');
  // Positions and verdicts go to the overlay page. Addresses do not.
  const marks = o.slice(o.indexOf('function setMarks'), o.indexOf('function destroy'));
  assert.doesNotMatch(marks, /\bu:|url/);
  assert.doesNotMatch(read('desktop/src/overlay-preload.js'), /invoke|send\(/, 'the overlay page can ask the app for nothing');
});

test('an open browser is never a notification; only a dangerous page or a stopped program is', () => {
  const m = read('desktop/src/main.js');
  assert.doesNotMatch(m, /is open`|browserHint/);
  assert.match(m, /enabled: \(\) => store\.get\('liveScanning', false\)/, 'live scanning is off until Start scanning is pressed');
});

/* ------------------------------------------------------------------ defense */

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-defense-'));
  const threats = [];
  defense._test.configure({
    dataDir: path.join(dir, 'data'), quarantineDir: path.join(dir, 'data', 'quarantine'), downloads: path.join(dir, 'dl'),
    enabled: () => true, api: async () => ({ known: false }), onThreat: (t) => threats.push(t)
  });
  fs.mkdirSync(path.join(dir, 'dl'), { recursive: true });
  return { dir, threats, file: (name, body) => { const p = path.join(dir, 'dl', name); fs.writeFileSync(p, body); return p; } };
}

test('defense: a guess never outranks a valid publisher signature (Discord\'s updater is not malware)', async () => {
  const box = sandbox();
  try {
    const full = box.file('Update.exe', fakeStealerExe());
    defense._test.setSigner(async () => 'Discord Inc.');
    const item = await defense.inspect(full, 'startup entry HKCU Run\\Discord');
    assert.equal(item.badge, null);
    assert.equal(item.trusted, true);
    assert.match(item.label, /Signed by Discord Inc\./);
    assert.ok(fs.existsSync(full), 'the file is where it was');
    assert.equal(box.threats.length, 0, 'and nobody was notified');
    assert.equal(defense.ledger().filter((e) => e.kind === 'threat').length, 0);
  } finally {
    defense._test.setSigner(null);
    fs.rmSync(box.dir, { recursive: true, force: true });
  }
});

test('defense: an unsigned program with strong evidence is still stopped, and "possible" is only noted', async () => {
  const box = sandbox();
  try {
    defense._test.setSigner(async () => null);
    const bad = box.file('FreeRobuxGenerator.exe', fakeStealerExe());
    const item = await defense.inspect(bad, 'arrived');
    assert.ok(item.badge === 'red' || item.badge === 'orange', `flagged: ${item.badge}`);
    assert.ok(!fs.existsSync(bad), 'moved out of the way');
    assert.ok(item.quarantined && fs.existsSync(item.quarantined), 'into quarantine, not deleted');
    assert.equal(box.threats.length, 1);

    // The same response code must never run for a yellow verdict.
    const src = read('desktop/src/defense.js');
    const yellow = src.indexOf("if (worst.badge === 'yellow')");
    assert.ok(yellow > 0 && yellow < src.indexOf('const entryId = record({ kind: \'threat\''), 'yellow returns before any response');
    assert.match(src.slice(yellow, yellow + 260), /kind: 'noted'[\s\S]*return item;/);
  } finally {
    defense._test.setSigner(null);
    fs.rmSync(box.dir, { recursive: true, force: true });
  }
});

test('defense: whatever it removes can be put back', async () => {
  const box = sandbox();
  try {
    defense._test.setSigner(async () => null);
    const bad = box.file('setup-helper.exe', fakeStealerExe());
    const item = await defense.inspect(bad, 'arrived');
    assert.ok(!fs.existsSync(bad));
    const entry = defense.ledger().find((e) => e.kind === 'threat' && e.name === 'setup-helper.exe');
    await defense.restore(entry.id);
    assert.ok(fs.existsSync(bad), 'the file is back where it was');
    assert.equal(await defense.inspect(bad, 'arrived'), null, 'and it is not judged again once the person has vouched for it');
    assert.ok(item.sha256);
    // A removed startup entry carries everything needed to restore it exactly.
    assert.match(read('desktop/src/defense.js'), /action\.undo = \{ hive, key, name: m\[1\], data: m\[2\]\.trim\(\), type:/);
  } finally {
    defense._test.setSigner(null);
    fs.rmSync(box.dir, { recursive: true, force: true });
  }
});
