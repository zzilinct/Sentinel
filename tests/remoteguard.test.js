'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

require('../desktop/scripts/sync-shared.js');
const rg = require('../desktop/src/remoteguard.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const MIN = 60 * 1000;
const watchSrc = () => require('../desktop/src/watch.js')._test.SCRIPT;

test('remote-control programs are recognised by their process names', () => {
  assert.deepEqual([...rg.toolsRunning(['chrome', 'anydesk', 'screenconnect.windowsclient'])].sort(), ['anydesk', 'screenconnect']);
  assert.equal(rg.toolsRunning(['chrome', 'discord']).size, 0);
  for (const n of rg.PROCESS_NAMES) assert.match(n, /^[a-z0-9_.]{2,40}$/, `${n} is a name the helper accepts`);
});

test('a program already running when Sentinel starts is someone\'s own setup, not a new connection', () => {
  const g = rg.create();
  g.flaggedPage(Date.now());
  assert.deepEqual(g.update(['anydesk']), [], 'the first report is only a starting point');
  assert.deepEqual(g.update(['anydesk']), [], 'still running is not starting');
});

test('a program that starts soon after a flagged page gets a question; long after, it does not', () => {
  const now = Date.now();
  const g = rg.create();
  g.update([]);
  g.flaggedPage(now - 5 * MIN);
  const a = g.update(['teamviewer'], { now });
  assert.equal(a.length, 1);
  assert.equal(a[0].tool.name, 'TeamViewer');
  assert.equal(a[0].reason, 'page');

  const late = rg.create();
  late.update([]);
  late.flaggedPage(now - 31 * MIN);
  assert.deepEqual(late.update(['teamviewer'], { now }), [], 'half an hour later, the page is not the reason');
});

test('a program that starts soon after it was downloaded gets a question, and a trusted one never does', () => {
  const now = Date.now();
  const downloads = [{ name: 'AnyDesk.exe', scannedAt: now - 10 * MIN }, { name: 'holiday.jpg', scannedAt: now - MIN }];
  const g = rg.create();
  g.update([]);
  const a = g.update(['anydesk'], { downloads, now });
  assert.equal(a.length, 1);
  assert.equal(a[0].reason, 'download');

  const old = rg.create();
  old.update([]);
  assert.deepEqual(old.update(['anydesk'], { downloads: [{ name: 'AnyDesk.exe', scannedAt: now - 2 * 60 * MIN }], now }), [], 'downloaded hours ago');

  const mine = rg.create();
  mine.update([]);
  assert.deepEqual(mine.update(['anydesk'], { downloads, trusted: ['anydesk'], now }), [], 'the person said they use it');
  assert.deepEqual(mine.running(['anydesk']), [], 'and it is not counted as running for the bank warning');
  assert.deepEqual(mine.running([]).map((t) => t.id), ['anydesk']);
});

test('banks and payment services are recognised by their own domains', () => {
  for (const u of ['https://www.paypal.com/signin', 'https://secure.chase.com/web/auth', 'https://www.onlinebanking.usbank.com/', 'https://www.monzo.com/']) {
    assert.equal(rg.moneySite(u), true, u);
  }
  for (const u of ['https://www.wikipedia.org/', 'https://www.youtube.com/', 'not a url']) assert.equal(rg.moneySite(u), false, u);
  // Banks with no list entry: "bank" or "cu" as a word of the site's own name, or the .bank ending.
  for (const u of ['https://online.river-cu.org/', 'https://www.first-bank.co.uk/', 'https://www.ncb.bank/']) assert.equal(rg.moneySite(u), true, u);
  // "bank" inside another word is news, data or crypto media, not a bank: no warning for someone at work using TeamViewer.
  for (const u of ['https://www.bankrate.com/', 'https://databank.com/', 'https://www.bankless.com/', 'https://www.bank-holidays.example.com/x']) {
    assert.equal(rg.moneySite(u), false, u);
  }
});

test('the shield closes a window only by asking it to close, and only when the person presses the button', () => {
  const watch = require('../desktop/src/watch.js');
  const s = watch._test.SCRIPT;
  assert.ok(s.includes("if ($cmd -eq 'close')"), 'the reader closes on command only');
  assert.ok(s.includes('PostMessage(h, 0x10, IntPtr.Zero, IntPtr.Zero)'), 'WM_CLOSE, as the close button sends');
  assert.ok(!/SendInput|mouse_event/.test(s), 'nothing typed or clicked in the browser');
  const main = read('desktop/src/main.js');
  assert.match(main, /if \(action === 'close-page'\) \{[\s\S]{0,120}watch\.closeBrowser\(\)/);
  assert.match(main, /handle\('sentinel:guard-action', [^\n]*trustedLocal\);/, 'only Sentinel\'s own page can ask');
  assert.equal((main.match(/watch\.closeBrowser\(/g) || []).length, 1, 'closed from one place only');
  assert.equal((main.match(/endTask\(\[/g) || []).length, 2, 'programs are ended in two places, both behind buttons');
  assert.match(main, /if \(!watch\.status\(\)\.window && await fullscreenInFront\(\)\)/, 'never over a game');
  // The helper that lists browsers looks for these programs too: no new process or timer.
  assert.match(main, /others: \{ names: remoteguard\.PROCESS_NAMES/);
  assert.match(read('desktop/src/browsers.js'), /startProcessWatcher\(heard, extra\)/);
});

test('the shield\'s words are plain, with no em dashes', () => {
  const html = read('desktop/src/pages/guard.html');
  assert.ok(!html.includes('—'), 'no em dash');
  assert.match(html, /Get me out of this page/);
  assert.match(html, /Did someone on the phone ask you to install this\?/);
  assert.match(html, /End the connection/);
  assert.ok(!read('desktop/src/remoteguard.js').includes('—'));
});

test('an installed copy is ended as administrator only through Windows\' own prompt, and only by name', () => {
  const s = rg.adminStopScript(rg.byId.anydesk);
  assert.match(s, /Start-Process powershell\.exe -Verb RunAs /, 'Windows asks the person first');
  assert.match(s, /catch \{ 'cancelled' \}/, 'a refused prompt is told apart');
  const inner = Buffer.from(s.match(/'-EncodedCommand','([A-Za-z0-9+/=]+)'/)[1], 'base64').toString('utf16le');
  assert.equal(inner, "Get-Service -Name 'AnyDesk*' -ErrorAction SilentlyContinue | Stop-Service -Force -ErrorAction SilentlyContinue; taskkill.exe /IM 'anydesk.exe' /T /F");
  const qa = Buffer.from(rg.adminStopScript(rg.byId.quickassist).match(/'-EncodedCommand','([A-Za-z0-9+/=]+)'/)[1], 'base64').toString('utf16le');
  assert.equal(qa, "taskkill.exe /IM 'quickassist.exe' /T /F", 'no service, no Stop-Service');
  for (const t of rg.TOOLS) assert.ok(!t.service || /^[A-Za-z]+\*$/.test(t.service), `${t.id}: a plain service pattern`);
});

test('what tasklist lists is read back into tool ids, so "End the connection" is checked, not assumed', () => {
  const out = '"System Idle Process","0","Services","0","8 K"\r\n"AnyDesk.exe","4120","Services","0","20,000 K"\r\n"chrome.exe","77","Console","1","90,000 K"\r\n';
  assert.deepEqual(rg.namesFromTasklist(out), ['system idle process', 'anydesk', 'chrome']);
  assert.deepEqual([...rg.toolsRunning(rg.namesFromTasklist(out))], ['anydesk']);
  assert.deepEqual(rg.namesFromTasklist(''), []);
});

test('the shield\'s window: a neutral way out first, trusting behind a second step, Escape changes nothing', () => {
  const html = read('desktop/src/pages/guard.html');
  assert.match(html, /<body role="alertdialog" aria-labelledby="title" aria-describedby="[^"]*lead[^"]*">/);
  assert.match(html, /buttons: \[trust\(remote\), \{ label: 'Not now', cancel: true, run: \(\) => act\('dismiss'\) \}, end\]/);
  assert.match(html, /Only if nobody asked you to install it\.<\/b> Sentinel will stop asking about it\./);
  assert.match(html, /e\.key === 'Escape' && cancel && !cancel\.disabled/);
  assert.match(html, /q\.get\('support'\) === '1'/, 'the scare-page words only for a page judged to be one');
  assert.ok(!/Restart the computer to end the connection/.test(html), 'a service starts again with Windows');
  assert.match(html, /Turn off Wi-Fi or unplug the network cable now\./);
  assert.match(html, /act\('end-tool-admin', tool\)/);
  assert.match(html, /act\('recover', 'remote'\)/, 'the done screen links to the recovery guide');
  assert.match(read('desktop/src/pages/warn.html'), /warnAction\('recover', 'password'\)/);
});

test('main: trusting a program needs the PIN under a parent lock, and the way out takes the keyboard', () => {
  const main = read('desktop/src/main.js');
  assert.match(main, /if \(action === 'trust-tool'\) \{[\s\S]{0,300}lock\.guard\(`asking about \$\{tool\.name\} off`, true\)/);
  assert.match(main, /if \(guardMode === 'escape'\) takeKeyboard\(\); else guardWin\.showInactive\(\);/);
  assert.match(main, /function takeKeyboard\(\) \{[\s\S]{0,200}watch\.front\(/);
  assert.ok(watchSrc().includes("if ($cmd -match '^front (\\d{1,20})$') { [SW]::Front("), 'the reader brings a window to the front by its handle only');
  assert.match(main, /badPage = \{ key: escapeKey\(v\.page\), browser: v\.page\.browser, support: Boolean\(v\.support\) \}/, 'keyed on the site');
  assert.match(main, /if \(action === 'recover'\) \{\n\s+\/\/[^\n]*\n\s+closeGuard\(\);\n\s+showWindow\(recoverRoute\(arg, 'remote'\)\);/);
  assert.match(main, /`\$\{inApp \? '\/app\/recover' : '\/recover'\}\?happened=\$\{RECOVER_HAPPENED\.has\(happened\) \? happened : fallback\}`/, 'signed out, the website\'s guide, not a sign-in page');
});

test('a new connection in a program that was already running gets a question too: by its session process, or by its log\'s time', () => {
  const now = Date.now();
  const g = rg.create();
  g.update(['teamviewer', 'anydesk'], { traces: { anydesk: 0 } });
  g.flaggedPage(now - 5 * MIN);
  assert.deepEqual(g.update(['teamviewer', 'anydesk'], { traces: { anydesk: 0 }, now }), [], 'still running, nobody connected');
  const tv = g.update(['teamviewer', 'teamviewer_desktop', 'anydesk'], { traces: { anydesk: 0 }, now });
  assert.deepEqual(tv.map((a) => [a.tool.id, a.session, a.reason]), [['teamviewer', true, 'page']]);
  assert.deepEqual(g.update(['teamviewer', 'teamviewer_desktop', 'anydesk'], { traces: { anydesk: 0 }, now }), [], 'the same connection is asked about once');
  const ad = g.update(['teamviewer', 'anydesk'], { traces: { anydesk: now - 1000 }, now });
  assert.deepEqual(ad.map((a) => [a.tool.id, a.session]), [['anydesk', true]], 'AnyDesk wrote its connection log');
  assert.deepEqual(g.update(['teamviewer', 'anydesk'], { traces: { anydesk: now - 1000 }, now }), []);
  assert.deepEqual(g.update(['teamviewer', 'anydesk'], { traces: { anydesk: now }, now, trusted: ['anydesk'] }), [], 'never for a trusted program');

  // Without a flagged page or a fresh download, a connection is someone's own business, as a start is.
  const calm = rg.create();
  calm.update(['teamviewer']);
  assert.deepEqual(calm.update(['teamviewer', 'teamviewer_desktop'], { now }), []);
  // The first report is a starting point for connections too.
  const first = rg.create();
  first.flaggedPage(now);
  assert.deepEqual(first.update(['teamviewer', 'teamviewer_desktop'], { traces: { anydesk: now }, now }), []);

  const main = read('desktop/src/main.js');
  assert.match(main, /traces: remoteTraces\(\)/);
  assert.match(main, /statSync\(path\.join\(dir, t\.trace\)\)\.mtimeMs/, 'only the log\'s time is read, never what it says');
  assert.match(read('desktop/src/pages/guard.html'), /Someone connected to this computer through \$\{toolName\}/);
});
