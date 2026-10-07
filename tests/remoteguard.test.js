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
