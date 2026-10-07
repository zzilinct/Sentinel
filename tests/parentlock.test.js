'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const parentlock = require('../desktop/src/parentlock.js');

// The settings store, in memory: get and set, as desktop/src/store.js has them.
function memoryStore() {
  const data = {};
  return {
    data,
    get: (k, fallback) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : fallback),
    set: (k, v) => { if (v === undefined) delete data[k]; else data[k] = v; }
  };
}

test('only a salted hash of the PIN is kept, and the same PIN hashes differently each time', () => {
  const a = memoryStore(), b = memoryStore();
  parentlock.create(a).set('4821');
  parentlock.create(b).set('4821');
  assert.ok(!JSON.stringify(a.data).includes('4821'));
  assert.match(a.data.parentLock.hash, /^[0-9a-f]{64}$/);
  assert.notEqual(a.data.parentLock.salt, b.data.parentLock.salt);
  assert.notEqual(a.data.parentLock.hash, b.data.parentLock.hash);
});

test('a PIN is 4 to 8 digits', () => {
  const lock = parentlock.create(memoryStore());
  for (const bad of ['123', '123456789', 'abcd', '12 34', '']) assert.throws(() => lock.set(bad), /4 to 8 digits/);
  assert.equal(lock.set('12345678').set, true);
});

test('without a PIN nothing is guarded; with one, switching protection off is refused and written down', () => {
  const store = memoryStore();
  const lock = parentlock.create(store);
  assert.doesNotThrow(() => lock.guard('chat safety off', true));
  lock.set('2580');
  assert.equal(lock.locked(), true);
  assert.throws(() => lock.guard('chat safety off', true), /Locked by a parent/);
  // Turning protection on never needs the PIN.
  assert.doesNotThrow(() => lock.guard('chat safety off', false));
  assert.equal(store.data.parentLockRecord[0].text, 'Tried to switch chat safety off without the PIN');
});

test('the PIN opens the lock for five minutes, then it locks again by itself', () => {
  let t = 1_000_000;
  const store = memoryStore();
  const lock = parentlock.create(store, () => t);
  lock.set('2580');
  assert.throws(() => lock.unlock('0000'), /Wrong PIN/);
  lock.unlock('2580');
  assert.doesNotThrow(() => lock.guard('live scanning off', true));
  assert.equal(store.data.parentLockRecord[0].text, 'Switched live scanning off with the PIN');
  t += parentlock.UNLOCK_MS + 1;
  assert.equal(lock.locked(), true);
  assert.throws(() => lock.guard('live scanning off', true), /Locked by a parent/);
});

test('the record is the parent\'s: shown only while the lock is open', () => {
  const lock = parentlock.create(memoryStore());
  lock.set('2580');
  assert.equal(lock.status().record, null);
  lock.unlock('2580');
  assert.ok(Array.isArray(lock.status().record));
});

test('five wrong PINs in a row mean a minute\'s wait, even for the right one', () => {
  let t = 5_000_000;
  const store = memoryStore();
  const lock = parentlock.create(store, () => t);
  lock.set('2580');
  for (let i = 0; i < 4; i++) assert.throws(() => lock.unlock('1111'), /^Error: Wrong PIN\.$/);
  assert.throws(() => lock.unlock('1111'), /in a minute/);
  assert.throws(() => lock.unlock('2580'), /Too many wrong PINs/);
  t += 61 * 1000;
  assert.equal(lock.unlock('2580').locked, false);
  // A right PIN clears the count: the next wrong one is the first again.
  lock.relock();
  assert.throws(() => lock.unlock('1111'), /^Error: Wrong PIN\.$/);
});

test('each wait after five wrong PINs is twice the last, an hour at most, and a right PIN starts it again', () => {
  let t = 7_000_000;
  const store = memoryStore();
  const lock = parentlock.create(store, () => t);
  lock.set('2580');
  const seen = [];
  for (let round = 0; round < 8; round++) {
    for (let i = 0; i < 4; i++) assert.throws(() => lock.unlock('1111'), /^Error: Wrong PIN\.$/);
    assert.throws(() => lock.unlock('1111'), /Try again in/);
    seen.push(lock.status().waitSeconds);
    t += lock.status().waitSeconds * 1000 + 1;
  }
  assert.deepEqual(seen, [60, 120, 240, 480, 960, 1920, 3600, 3600]);
  assert.ok(store.data.parentLockRecord.some((e) => e.text === 'Wrong PIN entered 5 times'));
  assert.equal(lock.unlock('2580').locked, false);
  lock.relock();
  for (let i = 0; i < 4; i++) assert.throws(() => lock.unlock('1111'));
  assert.throws(() => lock.unlock('1111'), /in a minute/);
});

test('the record counts repeats instead of filling up, and never loses "stopped without the PIN"', () => {
  let t = 9_000_000;
  const store = memoryStore();
  const lock = parentlock.create(store, () => t);
  lock.set('2580');
  lock.note('Sentinel stopped without the PIN (ended from Task Manager, or it crashed)', t - 5000);
  for (let i = 0; i < 200; i++) { t += 1000; assert.throws(() => lock.guard(i % 2 ? 'chat safety off' : 'defense off', true)); }
  const rec = store.data.parentLockRecord;
  assert.equal(rec.find((e) => e.text === 'Tried to switch chat safety off without the PIN').times, 100);
  assert.ok(rec.some((e) => /^Sentinel stopped without the PIN/.test(e.text)));
  // Different lines, many of them: still at most 30, the stop line kept.
  for (let i = 0; i < 60; i++) { t += 1000; lock.note(`line ${i}`); }
  assert.equal(store.data.parentLockRecord.length, 30);
  assert.ok(store.data.parentLockRecord.some((e) => /^Sentinel stopped without the PIN/.test(e.text)));
  // An hour later the same line is a new one.
  t += 2 * 60 * 60 * 1000;
  assert.throws(() => lock.guard('chat safety off', true));
  assert.equal(store.data.parentLockRecord[0].times, undefined);
});

test('a quarantined file, the shield\'s "I use it myself" and the account need the PIN too', () => {
  const store = memoryStore();
  const lock = parentlock.create(store);
  lock.set('2580');
  assert.throws(() => lock.guard('a quarantined file back', true, ['put', 'Put']), /Locked by a parent/);
  assert.equal(store.data.parentLockRecord[0].text, 'Tried to put a quarantined file back without the PIN');
  lock.unlock('2580');
  lock.guard('a quarantined file back', true, ['put', 'Put']);
  assert.equal(store.data.parentLockRecord[0].text, 'Put a quarantined file back with the PIN');
  const main = require('fs').readFileSync(require('path').join(__dirname, '..', 'desktop', 'src', 'main.js'), 'utf8');
  assert.match(main, /handle\('sentinel:defense-restore', \(id\) => \{ lock\.guard\('a quarantined file back', true, \['put', 'Put'\]\);/);
  assert.match(main, /action === 'trust-tool'[\s\S]{0,300}lock\.guard\(`asking about \$\{tool\.name\} off`, true\)/);
  assert.match(main, /handle\('sentinel:set-token'[\s\S]{0,400}lock\.guard\('to another account'/);
  assert.match(main, /handle\('sentinel:clear-token', \(\) => \{\s*lock\.guard\('to this computer\\'s own account'/);
  // Signing out in the web app asks the Sentinel app first, and a refusal stops the sign-out and is shown.
  const app = require('fs').readFileSync(require('path').join(__dirname, '..', 'web', 'assets', 'js', 'app.js'), 'utf8');
  assert.match(app, /await desktop\.clearToken\(\); \} catch \(err\) \{ toast\(`Still signed in\. \$\{desktopError\(err\)\}`, 'error'\); return; \}[\s\S]{0,40}\s*try \{ await api\('\/auth\/logout'/);
});

test('after an administrator removes a forgotten PIN, the record is still there for the parent to read', () => {
  const lock = parentlock.create(memoryStore());
  lock.set('2580');
  lock.reset();
  assert.equal(lock.status().record[0].text, 'The PIN was removed with a Windows administrator\'s approval');
});

test('the PIN is changed or removed only while the lock is open; a Windows administrator can remove a forgotten one', () => {
  const store = memoryStore();
  const lock = parentlock.create(store);
  lock.set('2580');
  assert.throws(() => lock.set('9999'), /current PIN/);
  assert.throws(() => lock.remove(), /PIN first/);
  lock.unlock('2580');
  lock.set('9999');
  assert.equal(lock.locked(), true);
  assert.throws(() => lock.unlock('2580'), /Wrong PIN/);
  lock.reset();
  assert.equal(lock.isSet(), false);
  assert.equal(store.data.parentLock, undefined);
});

test('Sentinel ended without the PIN is told apart from Windows shutting down', async () => {
  const boot = 1000;
  const never = async () => false;
  // Quit properly, or never ran with the lock: nothing to record.
  assert.equal(await parentlock.stoppedWithoutPin({ at: 5000, clean: true }, boot, never), null);
  assert.equal(await parentlock.stoppedWithoutPin(null, boot, never), null);
  // Windows started again since: a shutdown or restart ended it.
  assert.equal(await parentlock.stoppedWithoutPin({ at: 500, clean: false }, boot, never), null);
  // Same Windows session, but Windows logged a shutdown after it (fast startup keeps the uptime running).
  assert.equal(await parentlock.stoppedWithoutPin({ at: 5000, clean: false }, boot, async () => true), null);
  // Same session, no shutdown: ended from Task Manager (or a crash). The log cannot be read: still recorded.
  assert.equal(await parentlock.stoppedWithoutPin({ at: 5000, clean: false }, boot, never), 5000);
  assert.equal(await parentlock.stoppedWithoutPin({ at: 5000, clean: false }, boot, async () => { throw new Error('no log'); }), 5000);
});

test('every way to switch protection off or quit goes through the lock: the app, the tray and the error page', () => {
  const main = require('fs').readFileSync(require('path').join(__dirname, '..', 'desktop', 'src', 'main.js'), 'utf8');
  // The app's switches.
  for (const [channel, what] of [['chat-safety', 'chat safety off'], ['auto-scan', 'auto scanning off'], ['set-clipboard-check', 'checking copied links off'],
    ['set-defense', 'defense off'], ['set-open-at-login', 'starting with the computer off']]) {
    assert.ok(main.includes(`handle('sentinel:${channel}', (enabled) => { lock.guard('${what}', !enabled);`), channel);
  }
  assert.match(main, /handle\('sentinel:live-stop', \(\) => \{ lock\.guard\('live scanning off', true\);/);
  assert.match(main, /lock\.guard\('download protection off', !enabled\);/);
  assert.match(main, /lock\.guard\('to another Sentinel version', true\);/);
  assert.match(main, /handle\('sentinel:quit', \(\) => \{ lock\.guard\('Sentinel off', true\);/);
  // The tray: chat safety's own switch (since 1.11.1), auto scanning, Stop scanning, starting with the computer, Quit.
  assert.match(main, /if \(trayGuard\('chat safety off', !item\.checked\)\) \{ setChatSafety\(item\.checked\);/);
  assert.match(main, /if \(trayGuard\('auto scanning off', !item\.checked\)\) setAutoScan/);
  assert.match(main, /trayGuard\('live scanning off', true\) && setLiveScanning\(false/);
  assert.match(main, /if \(trayGuard\('starting with the computer off', !item\.checked\)\) setOpenAtLogin/);
  assert.match(main, /label: 'Quit Sentinel', click: \(\) => \{ if \(trayGuard\('Sentinel off', true\)\)/);
  // No other tray or IPC path calls these setters with the switch off.
  assert.equal((main.match(/setChatSafety\(/g) || []).length, 3, 'chat safety: defined, the tray, the app, and nothing else');
  // A quit written down as clean, so the next start can tell it from Task Manager.
  assert.match(main, /app\.on\('before-quit', \(\) => \{ quitting = true; heartbeat\(true\);/);
});
