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
  for (const file of ['filescan.js', 'lists.js', 'brands.js']) {
    const from = path.join(__dirname, '..', 'server', 'lib', 'scan', file);
    const to = path.join(shared, file);
    let same = false;
    try { same = fs.readFileSync(from).equals(fs.readFileSync(to)); } catch { /* not there yet */ }
    if (!same) fs.copyFileSync(from, to);
  }
}
const watch = require('../desktop/src/watch.js');
const defense = require('../desktop/src/defense.js');
const { fakeStealerExe } = require('./fixtures');

const ROOT = path.join(__dirname, '..');
// Line endings differ between checkouts (a Windows runner gets CRLF); the rules checked here do not.
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

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
  assert.ok(!/TextPattern|HelpText|LegacyIAccessible|Clipboard|CopyFromScreen|Screenshot/i.test(s), 'no page text, no clipboard, no screenshots');
  // Names are read in one place only: the message rows of a webmail inbox, which the inbox itself displays.
  const mailBlock = s.indexOf('if ($url -match $mail)');
  const names = [...s.matchAll(/NameProperty/g)].map((m) => m.index);
  assert.ok(names.length >= 1 && mailBlock > 0);
  assert.ok(names.every((i) => i > mailBlock || s.slice(Math.max(0, i - 60), i).includes('rowCache')), 'row names are read only for a webmail inbox');
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
  assert.ok(w.includes("live/batch', { urls: missing, private: page.private, mode }"), 'the server is told the window is private');
  assert.ok(w.includes("if (mode === 'delicate' && !page.private) {"), 'a private window gets no quick-then-research pass');
  assert.match(read('server/routes/scan.routes.js'), /const isPrivate = body\.private === true;[\s\S]*recordFlagged: !isPrivate/, 'flagged private results are not written to history');
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

test('a dangerous page in a private window is warned about without naming it anywhere that is kept', () => {
  const m = read('desktop/src/main.js');
  assert.match(m, /item\.private \? 'The page in your private window' : item\.host/, 'the Windows notification (which the notification centre keeps) names no site');
  assert.match(m, /if \(!item\.private\) push\('sentinel:page-threat'/, 'and the app\'s own lists are not told');
});

test('overlapping restarts cannot leave a second reader running, and a refusal stops the reader', () => {
  const w = read('desktop/src/watch.js');
  assert.match(w, /const mine = \+\+generation;[\s\S]*if \(mine !== generation\) return;\n  start\(\);/);
  assert.match(w, /if \(err\.status === 401\) stop\('Sign in to start live scanning'\)/);
  assert.match(w, /live_hours_exhausted'\) stop\('Live hours for this week are used up'\)/);
  // The test hook that reads a named browser instead of the window in front is for development runs only.
  assert.match(read('desktop/src/main.js'), /testProcess: app\.isPackaged \? null : process\.env\.SENTINEL_TEST_PROCESS/);
});

test('an inbox row is split into sender, subject and preview; its state words are dropped', () => {
  const m = watch._test.mailFromRow('unread, PayPal Service, Your account has been limited, 3:45 PM, Verify within 24 hours');
  assert.equal(m.from, 'PayPal Service');
  assert.equal(m.subject, 'Your account has been limited');
  assert.match(m.body, /Verify within 24 hours/);
});

test('the reader follows the tab in front and moves marks with the page between reads', () => {
  const s = watch._test.SCRIPT;
  assert.ok(s.includes('$docs = $root.FindAll('), 'every document is considered, not just the first');
  assert.ok(s.includes('if ($d.GetCachedPropertyValue($A::IsOffscreenProperty)) { continue }'), 'background tabs are skipped');
  assert.ok(s.includes("Write-Output ('{\"shift\":{\"dx\":'"), 'page movement is reported between full reads');
  assert.ok(s.includes('$pendingLine.Wait(15)'), 'about 60 looks a second while waiting');
});

test('the updater installs the file it downloaded, into its own folder, and notices an update that did not take', () => {
  const src = read('desktop/src/updater.js');
  assert.match(src, /autoInstallOnAppQuit = false/);
  assert.match(src, /const file = info\.downloadedFile;/);
  assert.match(src, /args\.push\(`\/D=\$\{path\.dirname\(process\.execPath\)\}`\)/);
  assert.match(src, /if \(actual !== expected\)/, 'the checksum is checked again just before running it');
  assert.match(src, /did not take/);
  assert.match(read('desktop/build/installer.nsh'), /!macro customRemoveFiles/, 'uninstall removes only Sentinel\'s own files');
  assert.doesNotMatch(read('desktop/build/installer.nsh'), /RMDir \/r "\$INSTDIR"(\s|$)/, 'never the whole install folder');
});
