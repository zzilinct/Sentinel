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
  assert.ok(s.includes("($browsers -notcontains $fname)) { Off 'not in front'; $pause = 1000; continue }"), 'behind another program: nothing is read');
  assert.ok(s.includes("IsIconic($h)) { Off 'minimised'; continue }"), 'minimised: nothing is read');
  assert.ok(s.includes('IdleMs() -gt 120000'), 'nobody at the keyboard: nothing is read');
  const gates = s.indexOf("Off 'idle'");
  assert.ok(gates > 0 && gates < s.indexOf('FromHandle'), 'every gate comes before the first look inside the window');
  // What it asks Windows for: the address (Value), rectangles, and whether a link is on screen. Never text.
  assert.ok(!/TextPattern|HelpText|LegacyIAccessible|Clipboard|CopyFromScreen|Screenshot/i.test(s), 'no page text, no clipboard, no screenshots');
  // Names are read in two places only: the message rows of a webmail inbox, which the inbox itself displays, and
  // Google's own /goto links, whose name carries the address Google shows under the result.
  const mailBlock = s.indexOf('if ($needRead -and $url -match $mail)');
  const googleLine = s.indexOf("if ($u -match '^https://www\\.google\\.[a-z.]{2,6}/goto\\?') { $n = [string]$l.GetCachedPropertyValue($A::NameProperty)");
  const names = [...s.matchAll(/NameProperty/g)].map((m) => m.index);
  assert.ok(names.length >= 1 && mailBlock > 0 && googleLine > 0);
  const allowed = (i) => i > mailBlock || s.slice(Math.max(0, i - 60), i).includes('rowCache') || s.slice(Math.max(0, i - 80), i).includes('$cache.Add($VP::ValueProperty);')
    || (i > googleLine && i < googleLine + 200);
  assert.ok(names.every(allowed), 'names are read only for a webmail inbox and Google\'s /goto links');
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

test('DuckDuckGo: site-name link, title and a grid of sitelinks are one result; the next result from that site is its own', () => {
  // Link boxes as the reader saw them on a real DuckDuckGo page (live e2e run).
  const r = (u, x, y, w, h) => ({ u: `https://${u}`, x, y, w, h });
  const links = [
    r('www.shop.example/help/contact', 85, 253, 298, 19), r('www.shop.example/help/contact', 45, 283, 628, 27),
    r('secure.shop.example/help/article', 60, 362, 255, 63), r('www.shop.example/signin', 360, 362, 255, 63),
    r('www.shop.example/help/personal', 60, 432, 255, 64), r('www.shop.example/help/technical', 360, 432, 255, 64),
    r('www.shop.example/verify', 85, 612, 192, 19), r('www.shop.example/verify', 45, 642, 628, 27)
  ];
  const seen = new Map();
  const out = watch._test.resultLinks(links, 'https://duckduckgo.com/?q=x', seen);
  assert.deepEqual(out.map((l) => [l.u, l.x, l.y]), [['https://www.shop.example/help/contact', 45, 283], ['https://www.shop.example/verify', 45, 642]], 'marks beside the titles');
  // Scrolled: the first title is gone, its sitelinks are still on screen. They went with it; no marks of their own.
  const later = links.slice(4).map((l) => ({ ...l, y: l.y - 420 }));
  assert.deepEqual(watch._test.resultLinks(later, 'https://duckduckgo.com/?q=x', seen).map((l) => l.u), ['https://www.shop.example/verify']);
  // A page never seen with its title still gets its mark.
  assert.equal(watch._test.resultLinks(later, 'https://duckduckgo.com/?q=x').length, 2);
});

test('Google results behind its opaque /goto redirect are checked by the address Google shows under the title', () => {
  const { unwrapResult, resultLinks } = watch._test;
  const g = (n) => unwrapResult(new URL('https://www.google.com/goto?url=CAESYwHrOzAV'), n);
  assert.equal(g('Contact Us PayPal https://www.paypal.com › cshelp › contact-us').href, 'https://www.paypal.com/cshelp/contact-us');
  assert.equal(g('Login & Security PayPal https://www.paypal.com › cshelp › topic › help_login_...').href, 'https://www.paypal.com/cshelp/topic', 'shortened parts are left out');
  // The title is the website's own words: an address written in it never wins over the one Google shows.
  assert.equal(g('https://www.paypal.com › signin Deals https://cheap-pods.example › offers').href, 'https://cheap-pods.example/offers');
  assert.equal(g('Read more'), null, 'no address shown: nothing is guessed');
  const out = resultLinks([{ u: 'https://www.google.com/goto?url=X', n: 'Contact Us PayPal https://www.paypal.com › cshelp › contact-us', x: 66, y: 248, w: 282, h: 71 }], 'https://www.google.com/search?q=x');
  assert.deepEqual(out.map((l) => l.u), ['https://www.paypal.com/cshelp/contact-us']);
  assert.equal(out[0].n, undefined, 'the name is not passed on');
  // Three results from one site, as Google lays them out (the reader may deliver ">" for "›"): three marks.
  const three = [248, 396, 544].map((y, i) => ({ u: `https://www.google.com/goto?url=X${i}`, n: `Title ${i} PayPal https://www.paypal.com > cshelp > page${i}`, x: 66, y, w: 300, h: 71 }));
  assert.deepEqual(resultLinks(three, 'https://www.google.com/search?q=x').map((l) => l.u), [0, 1, 2].map((i) => `https://www.paypal.com/cshelp/page${i}`));
  const same = three.map((l) => ({ ...l, n: 'PayPal https://www.paypal.com' }));
  assert.equal(resultLinks(same, 'https://www.google.com/search?q=x').length, 3, 'results far apart stay apart even when they lead to the same page');
  assert.ok(watch._test.SCRIPT.includes("if ($u -match '^https://www\\.google\\.[a-z.]{2,6}/goto\\?')"), 'the reader sends the name for those links only');
});

test('the search engine\'s own menu (its app, its AI chat) gets no marks; other apps in a store still do', () => {
  const links = [
    { u: 'https://apps.apple.com/app/duckduckgo-private-browser/id663592361', x: 767, y: 352, w: 80, h: 20 },
    { u: 'https://duck.ai/', x: 767, y: 700, w: 60, h: 20 },
    { u: 'https://apps.apple.com/us/app/totally-real-wallet/id1', x: 45, y: 300, w: 500, h: 26 }
  ];
  assert.deepEqual(watch._test.resultLinks(links, 'https://duckduckgo.com/?q=x').map((l) => l.u), ['https://apps.apple.com/us/app/totally-real-wallet/id1']);
});

test('ads are checked too: Bing and Google ad links lead to the advertiser', () => {
  const dest = 'https://cheap-pods.example/products/pro?currency=USD';
  const bing = `https://www.bing.com/aclk?ld=e8abc&u=${Buffer.from(encodeURIComponent(dest)).toString('base64url')}&rlid=1`;
  assert.equal(watch._test.unwrapResult(new URL(bing)).href, dest);
  assert.equal(watch._test.unwrapResult(new URL(`https://www.google.com/aclk?sa=l&adurl=${encodeURIComponent(dest)}`)).href, dest);
  const out = watch._test.resultLinks([{ u: bing, x: 22, y: 300, w: 529, h: 29 }], 'https://www.bing.com/search?q=pods');
  assert.deepEqual(out.map((l) => l.u), [dest]);
  // Through an ad-click tracker to the shop: the shop is what gets checked.
  const tracker = 'https://clickserve.dartsearch.net/link/click?&&ds_e_adid=1&ds_url_v=2&ds_dest_url=https://shop.example/ip/pods?a=1&wl0=e&wl1=o';
  const viaTracker = `https://www.bing.com/aclk?ld=e8x&u=${Buffer.from(encodeURIComponent(tracker)).toString('base64url')}`;
  assert.deepEqual(watch._test.resultLinks([{ u: viaTracker, x: 22, y: 300, w: 529, h: 29 }], 'https://www.bing.com/search?q=pods').map((l) => new URL(l.u).hostname), ['shop.example']);
  // DuckDuckGo's ads wrap Bing's; with nothing to unwrap, the advertiser's site is still checked.
  const ddg = (u3, extra = '') => `https://duckduckgo.com/y.js?ad_domain=cheap-pods.example&ad_provider=bingv7aa${extra}&u3=${encodeURIComponent(u3)}`;
  assert.equal(watch._test.unwrapResult(new URL(ddg(bing.replace('/aclk', '/aclick')))).href, dest);
  assert.equal(watch._test.unwrapResult(new URL(ddg('https://www.bing.com/aclick?ld=x'))).href, 'https://cheap-pods.example/');
  // An ad's sitelinks line up with its title but are much narrower: still one ad, one mark.
  const ad = [
    { u: ddg(bing), x: 45, y: 239, w: 375, h: 33 }, { u: ddg(bing), x: 45, y: 285, w: 471, h: 26 }, { u: ddg(bing), x: 45, y: 321, w: 614, h: 38 },
    { u: ddg('https://www.bing.com/aclick?ld=y', '&x=1'), x: 45, y: 392, w: 153, h: 17 },
    { u: ddg('https://www.bing.com/aclick?ld=z', '&x=2'), x: 215, y: 392, w: 153, h: 17 }
  ];
  assert.equal(watch._test.resultLinks(ad, 'https://duckduckgo.com/?q=pods').length, 1);
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

test('defense: a startup program with warning signs but no proof is left running, and the person decides', async () => {
  const box = sandbox();
  try {
    defense._test.setSigner(async () => null);
    const exe = box.file('MyMacros.exe', fakeStealerExe());
    const item = await defense.inspect(exe, 'startup entry HKCU Run\\MyMacros');
    assert.equal(item.badge, 'orange', 'signs, not proof');
    assert.ok(fs.existsSync(exe), 'not moved');
    const entry = defense.ledger().find((e) => e.name === 'MyMacros.exe');
    assert.equal(entry.kind, 'suspect');
    assert.equal(box.threats.length, 1);
    assert.equal(box.threats[0].suspect, true, 'told, as a suspicion');
    assert.ok(!entry.actions.some((a) => /ended|removed|quarantined/.test(a.did)), 'nothing ended, removed or moved');
    // Then the person chooses to quarantine it.
    await defense.act(entry.id);
    assert.ok(!fs.existsSync(exe), 'quarantined at their request');
    const after = defense.ledger().find((e) => e.id === entry.id);
    assert.equal(after.kind, 'threat');
    assert.ok(after.quarantined);
    // Without proof, a response to a new file never ends a program or removes a startup entry.
    assert.match(read('desktop/src/defense.js'), /if \(item\.gentle\) \{[\s\S]{0,200}return actions;/);
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
  assert.ok(s.includes('$wait = if ([Environment]::TickCount -lt $stillAt) { 8 } elseif ($sinceMove -lt 1500) { 15 } elseif ($sinceMove -lt 10000) { 40 } else { 90 }'), 'every 8 ms while it moves, then less and less often while the page is being read');
  assert.ok(s.includes('$stillAt = [Environment]::TickCount + 350'), 'the full read waits until the page has been still for 350 ms');
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

test('the reader starts from a file: its command line stays far under the Windows limit, and a changed file is refused', () => {
  const { readerLaunch, SCRIPT } = watch._test;
  const body = SCRIPT.replace('__TEST_PROCESS__', () => '').replace('__HELPER_DLL__', () => "C:\\Users\\o'brien\\AppData\\Roaming\\Sentinel\\helper.dll");
  const { file, args } = readerLaunch(body, "C:\\Users\\o'brien\\AppData\\Roaming\\Sentinel");
  // A 1.6.5 build (caught before release) passed the whole script as -EncodedCommand: 35,716 characters, and spawn failed with ENAMETOOLONG.
  assert.ok(args.join(' ').length < 4000, `command line is ${args.join(' ').length} characters`);
  const loader = Buffer.from(args[args.length - 1], 'base64').toString('utf16le');
  const hash = require('crypto').createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex').toUpperCase();
  assert.ok(loader.includes(`-ne '${hash}'`), 'the loader checks the file against its own hash');
  assert.ok(loader.includes("o''brien"), 'quotes in the path are escaped');
  assert.ok(file.endsWith('.ps1'));
});

test('the reader reads commands without blocking its own loop', () => {
  const { SCRIPT } = watch._test;
  // [Console]::In is synchronized in Windows PowerShell: its ReadLineAsync blocks, and the reader froze until a command came.
  assert.doesNotMatch(SCRIPT, /\[Console\]::In\b/);
  assert.match(SCRIPT, /New-Object System\.IO\.StreamReader\(\[Console\]::OpenStandardInput\(\)\)/);
});

test('the overlay sits just above the browser, never above everything: menus and other windows cover it', () => {
  const o = read('desktop/src/overlay.js');
  assert.doesNotMatch(o, /setAlwaysOnTop\(true/);
  assert.match(o, /alwaysOnTop: false/);
  assert.match(read('desktop/src/main.js'), /if \(rect\) watch\.keepAbove\(overlay\.handle\(\)\)/);
  const { SCRIPT } = watch._test;
  assert.ok(SCRIPT.includes('public static bool Above(IntPtr overlay, IntPtr browser)'));
  assert.ok(SCRIPT.includes('[void][SW]::Above($overlayH, $h)'), 'kept above the browser on every look');
  assert.ok(SCRIPT.includes('$h = [SW]::Owner([SW]::GetForegroundWindow())'), 'a browser menu in front still means the browser');
});

test('results covered by something the page drew over them (Google\'s apps grid, a sticky bar) get no mark', () => {
  const { SCRIPT } = watch._test;
  assert.ok(SCRIPT.includes('(Covered $l $b)'));
  assert.ok(SCRIPT.includes('$hit.Current.ProcessId -ne $fp'), 'the overlay itself never counts as covering');
  assert.ok(SCRIPT.includes('$recheckAt = $tick + 450'), 'looked at again when focus moves and once its panel has opened');
  assert.ok(SCRIPT.includes('if ([Math]::Abs($lb.Y - $b.Y) -gt 3'), 'a page still moving is never judged');
  assert.ok(SCRIPT.includes('if ($px -lt $hr.Left - 2 -or $px -gt $hr.Right + 2'), 'an answer that is not at the point is not believed');
  assert.ok(SCRIPT.includes("if ($hit.Current.ClassName -cmatch '^(Label|[A-Z][A-Za-z]*Views?|MenuSeparator|Chrome_WidgetWin_\\d+)$') { return $false }"),'the browser\'s own menus and link preview are left to the window order');
});

test('marks ease along with the page every frame instead of jumping at each report', () => {
  const html = read('desktop/src/pages/overlay.html');
  assert.match(html, /raf = requestAnimationFrame\(frame\)/);
  const handler = /api\.on\('overlay:shift', function \(p\) \{([\s\S]*?)\n\s*\}\);/.exec(html)[1];
  assert.match(handler, /follow\(p\)/);
  assert.doesNotMatch(handler, /setShift\(p\.dx/, 'never a jump straight to a report, not even with Windows animations off');
  assert.ok(watch._test.SCRIPT.includes(`',"t":' + [Environment]::TickCount`), 'each report says when it was measured');
});

test('download analysis runs on a worker thread and reports what an in-place scan would', async () => {
  const { Worker } = require('worker_threads');
  const { scanFile } = require('../desktop/shared/filescan');
  const file = path.join(os.tmpdir(), `sentinel-worker-check-${process.pid}.txt`);
  fs.writeFileSync(file, 'Grocery list: eggs, milk, bread.\n');
  try {
    const got = await new Promise((resolve, reject) => {
      const w = new Worker(path.join(__dirname, '..', 'desktop', 'src', 'filescan-worker.js'), { workerData: { file, name: 'list.txt', known: null } });
      w.once('message', (m) => { w.terminate(); resolve(m); });
      w.once('error', reject);
    });
    assert.equal(got.error, undefined, got.error);
    const direct = scanFile(fs.readFileSync(file), 'list.txt', { lookupHash: () => null });
    assert.equal(got.report.sha256, direct.sha256);
    assert.deepEqual(got.report.checks.map((c) => [c.id, c.status]), direct.checks.map((c) => [c.id, c.status]));
  } finally { fs.rmSync(file, { force: true }); }
  const d = read('desktop/src/downloads.js');
  assert.match(d, /queue = queue\.then\(\(\) => scan\(full, stat\)\)/, 'one download at a time');
  assert.doesNotMatch(d, /buf = fs\.readFileSync\(full\)/, 'the main thread never reads a whole download');
});

test('while the page really moves the marks step aside, and come back in place when it stops (never stuck hidden)', () => {
  const html = read('desktop/src/pages/overlay.html');
  assert.match(html, /#marks\.is-moving \{ opacity: 0;/);
  assert.match(html, /if \(moving \|\| Math\.abs\(p\.dx\) \+ Math\.abs\(p\.dy\) > MOVING_PX\) setMoving\(true\)/);
  assert.match(html, /backTimer = setTimeout\(function \(\) \{ setMoving\(false\); \}, BACK_MS\)/, 'back even if no new positions ever come');
  assert.match(html, /place\(\(p && p\.marks\) \|\| \[\], null, true\);\s+setMoving\(false\);/, 'fresh positions: straight there, then shown');
});

test('the reader\'s C# helper compiles (a compile error would stop live scanning entirely)', { skip: process.platform !== 'win32' }, () => {
  const src = /\$src = @"([\s\S]*?)"@/.exec(watch._test.SCRIPT)[1];
  const file = path.join(os.tmpdir(), `sentinel-helper-check-${process.pid}.cs`);
  fs.writeFileSync(file, src, 'utf8');
  try {
    const r = require('child_process').spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Add-Type -TypeDefinition ([IO.File]::ReadAllText('${file.replace(/'/g, "''")}')); [SW]::Above([IntPtr]::Zero, [IntPtr]::Zero)`], { encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /False/);
  } finally { fs.rmSync(file, { force: true }); }
});

test('the running-browsers helper answers without starting a process each time, and ends when Sentinel does', { skip: process.platform !== 'win32' }, async () => {
  const browsers = require('../desktop/src/browsers.js');
  const script = browsers._test.WATCH_SCRIPT.replace('__NAMES__', "'notepad','chrome'");
  const child = require('child_process').spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  const first = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no answer in 30 s')), 30000);
    child.stdout.once('data', (d) => { clearTimeout(timer); resolve(String(d)); });
  });
  assert.match(first, /^running:/);
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.stdin.end();   // Sentinel is gone
  const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('still running'), 10000))]);
  if (code === 'still running') child.kill();
  assert.notEqual(code, 'still running', 'it ends by itself when its input closes');
  assert.doesNotMatch(read('desktop/src/browsers.js').split('function watch(')[1], /run\('tasklist'/, 'the watcher does not start tasklist on a timer');
});

test('the reader\'s compiled helper is named after its source, so a new version never loads an old one', () => {
  const w = read('desktop/src/watch.js');
  assert.match(w, /reader-helper-\$\{crypto\.createHash\('sha256'\)\.update\(src\)/);
});

test('scrolling keeps each mark on its own element: marks are keyed by result, never by position', () => {
  const html = read('desktop/src/pages/overlay.html');
  assert.match(html, /var nodes = new Map\(\)/);
  assert.match(html, /nodes\.get\(key\)/);
  const w = read('desktop/src/watch.js');
  // The key is a hash: no address reaches the overlay window.
  assert.match(w, /k: markKey\(l\.u\)/);
  assert.match(w, /const markKey = \(u\) => crypto\.createHash\('sha1'\)/);
});

test('search engines\' redirect links are unwrapped to the result they lead to (Bing wraps every result)', () => {
  const { resultLinks } = watch._test;
  const b64 = (s) => Buffer.from(s).toString('base64url');
  const links = [
    { u: `https://www.bing.com/ck/a?!&&p=85641a7c&ptn=3&ver=2&hsh=4&fclid=1f&u=a1${b64('https://www.backmarket.com/en-us/l/airpods/1')}&ntb=1`, x: 22, y: 324, w: 636, h: 29 },
    { u: 'https://www.bing.com/aclk?ld=e8grfr3bFWCl', x: 22, y: 481, w: 465, h: 24 },                       // an ad: cannot be unwrapped
    { u: 'https://www.bing.com/fd/auth/signin/v2?action=interactive', x: 868, y: 319, w: 260, h: 38 },       // the engine's own page
    { u: `https://www.google.com/url?q=${encodeURIComponent('https://example.org/deal')}&sa=U`, x: 20, y: 600, w: 300, h: 20 },
    { u: `https://duckduckgo.com/l/?uddg=${encodeURIComponent('https://shop.example.net/x')}&rut=abc`, x: 20, y: 640, w: 300, h: 20 },
    { u: `https://r.search.yahoo.com/_ylt=A/RV=2/RE=1/RO=10/RU=${encodeURIComponent('https://news.example.com/a')}/RK=2/RS=x-`, x: 20, y: 680, w: 300, h: 20 },
    { u: `https://www.bing.com/ck/a?u=a1${b64('javascript:alert(1)')}`, x: 20, y: 720, w: 300, h: 20 }     // never anything but http(s)
  ];
  const out = resultLinks(links, 'https://www.bing.com/search?q=cheap+airpods+pro+outlet').map((l) => l.u);
  assert.deepEqual(out, ['https://www.backmarket.com/en-us/l/airpods/1', 'https://example.org/deal', 'https://shop.example.net/x', 'https://news.example.com/a']);
});

test('the reader script is valid PowerShell (a syntax slip there silently ends live scanning)', { skip: process.platform !== 'win32' }, () => {
  const { spawnSync } = require('child_process');
  const { SCRIPT } = watch._test;
  const file = path.join(os.tmpdir(), `sentinel-reader-parse-${process.pid}.ps1`);
  fs.writeFileSync(file, SCRIPT.replace('__TEST_PROCESS__', () => '').replace('__HELPER_DLL__', () => ''), 'utf8');
  try {
    // Parsed, never run.
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$e = $null; $t = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${file.replace(/'/g, "''")}', [ref]$t, [ref]$e); $e | ForEach-Object { $_.Message + ' @ line ' + $_.Extent.StartLineNumber }`],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), '', `parse errors:\n${r.stdout}`);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('the reader reads links only when something can have changed, and reuses the page between passes', () => {
  const { SCRIPT } = watch._test;
  assert.match(SCRIPT, /\$needRead = \$forceRead -or \$moved -or -not \$anchor -or \$lastCount -eq 0 -or \(\$tick - \$readAt\) -gt 2500/);
  assert.match(SCRIPT, /if \(\$needRead -and \$url -match \$search\)/);
  assert.match(SCRIPT, /\$reuse = \$cachedDoc -and \$h -eq \$cachedFor -and \$title -eq \$cachedTitle/);
  // A lost anchor is let go, never followed to an empty rectangle.
  assert.match(SCRIPT, /\$ar\.Width -lt 1 -or \$ar\.Height -lt 1\) \{ \$anchor = \$null \}/);
});

test('Sentinel stays out of the way: below-normal priority, no Temp folder scanning, one startup entry owner', () => {
  const main = read('desktop/src/main.js');
  assert.match(main, /function stayInBackground\(\)/);
  assert.match(main, /PRIORITY_BELOW_NORMAL/);
  assert.match(main, /setInterval\(stayInBackground, 30000\)/);
  // Only the copy Windows has on record as installed may point the startup entry at itself.
  assert.match(main, /not the installed copy/);
  assert.match(main, /InstallLocation/);
  // Defense does not watch or sweep the Temp folder (thousands of launcher and browser files, read every 20 s).
  const defense = read('desktop/src/defense.js');
  const folders = defense.slice(defense.indexOf('function folders()'), defense.indexOf('function init('));
  assert.doesNotMatch(folders, /tmpdir|'Temp'/);
  // The reader waits quietly when nothing is followed, and looks only once a second when no browser is in front.
  const { SCRIPT } = watch._test;
  assert.match(SCRIPT, /if \(-not \$anchor\) \{ if \(\$pendingLine\.Wait/);
  assert.match(SCRIPT, /Off 'not in front'; \$pause = 1000; continue/);
});

test('one mark per website, on its main link: sitelinks and AI-answer citations do not each get a mark', () => {
  const { resultLinks } = watch._test;
  const links = [
    { u: 'https://www.paypal.com/us/home', x: 20, y: 100, w: 420, h: 58 },            // the result: site name + title
    { u: 'https://www.paypal.com/signin', x: 40, y: 170, w: 60, h: 18 },              // sitelinks
    { u: 'https://www.paypal.com/us/webapps/mpp/account-selection', x: 40, y: 200, w: 110, h: 18 },
    { u: 'https://en.wikipedia.org/wiki/PayPal', x: 480, y: 60, w: 70, h: 20 },         // a citation chip in an AI answer
    { u: 'https://en.wikipedia.org/wiki/PayPal', x: 20, y: 700, w: 300, h: 58 },       // and the Wikipedia result itself
    { u: 'https://sites.google.com/view/one', x: 20, y: 800, w: 300, h: 40 },           // shared host: one per page
    { u: 'https://sites.google.com/view/two', x: 20, y: 860, w: 300, h: 40 }
  ];
  const out = resultLinks(links, 'https://www.google.com/search?q=paypal');
  assert.deepEqual(out.map((l) => [l.u, l.y]), [
    ['https://www.paypal.com/us/home', 100],
    ['https://en.wikipedia.org/wiki/PayPal', 700],
    ['https://sites.google.com/view/one', 800],
    ['https://sites.google.com/view/two', 860]
  ]);
});

test('an inbox message exposed twice (row and list item) gets one mark', () => {
  const { distinctRows } = watch._test;
  const rows = [{ u: 'mail:a', x: 0, y: 100, w: 900, h: 40 }, { u: 'mail:a2', x: 220, y: 104, w: 520, h: 30 }, { u: 'mail:b', x: 0, y: 140, w: 900, h: 40 }];
  assert.deepEqual(distinctRows(rows).map((r) => r.u), ['mail:a', 'mail:b']);
});

test('Start scanning brings the person\'s browser forward first; the gold line never crosses the desktop or a game', () => {
  const main = read('desktop/src/main.js');
  assert.match(main, /async function startScanning\(\)/);
  assert.match(main, /browsers\.preferred\(store\.get\('liveBrowser', null\)\)/);
  assert.match(main, /handle\('sentinel:live-start', \(\) => \{ setAutoSession\(false\); return startScanning\(\); \}\)/);
  assert.doesNotMatch(main + read('desktop/src/overlay.js'), /readySweep/);
  const browsers = read('desktop/src/browsers.js');
  assert.match(browsers, /UrlAssociations\\\\https\\\\UserChoice/);
});

test('updates install themselves only when nobody is browsing, and Sentinel comes back in the tray', () => {
  const main = read('desktop/src/main.js');
  assert.match(main, /async function autoInstallSoon\(\)/);
  assert.match(main, /idleSeconds >= 5 \* 60/);
  assert.match(main, /hidden: !\(win && !win\.isDestroyed\(\) && win\.isVisible\(\)\)/);
  assert.match(read('desktop/src/updater.js'), /function hiddenMarker\(\)/);
  assert.match(main, /const startHidden = /);
});

test('auto scanning follows the browsers: on when one opens, off when the last one closes (only if it started it)', () => {
  const main = read('desktop/src/main.js');
  assert.match(main, /async function autoScanFollow\(running\)/);
  assert.match(main, /else if \(!running\.length && on && autoSession\)/);
  assert.match(main, /mode: \(\) => \(autoSession \? 'fast' : store\.get\('liveMode', 'fast'\)\)/);
  assert.match(read('desktop/src/preload.js'), /setAutoScan:/);
});

test('the Windows icon is a real multi-size .ico', () => {
  const ico = fs.readFileSync(path.join(ROOT, 'desktop', 'build', 'icon.ico'));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1, 'icon type');
  assert.ok(ico.readUInt16LE(4) >= 5, 'several sizes');
  assert.match(read('desktop/package.json'), /"icon": "build\/icon\.ico"/);
});

test('"Check links I copy" acts on a single web link only: other clipboard text and file names are left alone', () => {
  const { linkIn } = require('../desktop/src/clipwatch.js')._test;
  assert.equal(linkIn('https://bit.ly/3xYz'), 'https://bit.ly/3xYz');
  assert.equal(linkIn('paypa1-login.com/verify'), 'https://paypa1-login.com/verify');
  assert.equal(linkIn('  https://example.com/a?b=c  '), 'https://example.com/a?b=c');
  for (const t of ['hello world', 'Hi, check https://x.com', 'report.pdf', 'notes.txt', 'invoice.pdf.exe', '192.168.1.1', 'javascript:alert(1)', 'call 555 0100', '']) {
    assert.equal(linkIn(t), null, t);
  }
  const main = read('desktop/src/main.js');
  assert.match(main, /store\.get\('clipboardCheck', false\)/, 'off until the person turns it on');
  assert.doesNotMatch(read('desktop/src/clipwatch.js'), /log\(`[^`]*\$\{url\}/, 'the log never holds the copied link');
});

test('a dangerous result says what to do now, in plain steps for its kind of threat', () => {
  const ui = read('web/assets/js/ui.js');
  assert.match(ui, /function nextSteps\(head\)/);
  assert.match(ui, /\$\{nextSteps\(head\)\}/);
  for (const kind of ['phishing', 'crypto', 'delivery', 'support', 'paste_command', 'fake_update']) assert.match(ui, new RegExp(`\\b${kind}:`), kind);
});

test('two separate results from one site each keep their mark; only a result\'s own sitelinks share it', () => {
  const { resultLinks } = watch._test;
  const links = [
    { u: 'https://www.paypal.com/us/cshelp/contact-us', x: 22, y: 130, w: 420, h: 58 },
    { u: 'https://www.paypal.com/tc', x: 30, y: 200, w: 90, h: 18 },
    { u: 'https://www.paypal.com/help', x: 30, y: 240, w: 160, h: 18 },
    { u: 'https://www.paypal.com/', x: 22, y: 560, w: 640, h: 58 },
    { u: 'https://www.paypal.com/us/cshelp/article/x', x: 22, y: 720, w: 600, h: 58 }
  ];
  assert.deepEqual(resultLinks(links, 'https://duckduckgo.com/?q=paypal').map((l) => l.y), [130, 560, 720]);
});
