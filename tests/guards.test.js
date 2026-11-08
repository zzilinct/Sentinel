'use strict';
/**
 * The Live protection board (web/assets/js/guards.js): no row says On for a guard that is not running, a guard that
 * needs live scanning says so, and the headline is the Windows tray's (desktop/src/protection.js)
 * for every combination of the five main protections.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { board, outline } = require('../web/assets/js/guards.js');

const rows = (b) => Object.fromEntries(b.groups.flatMap((g) => g.rows).map((r) => [r.id, r]));

// What desktop.info() answers on Windows, everything on and running.
const running = () => ({
  platform: 'win32', embeddedServer: true, openAtLogin: true, clipboardCheck: true, commandShield: true, walletGuard: true, exposureAlerts: true, mySites: true,
  live: { supported: true, enabled: true, active: true, window: { x: 0 }, reason: null },
  downloads: { enabled: true, active: true, reason: null },
  defense: { supported: true, enabled: true, active: true, reason: null },
  chatSafety: { supported: true, enabled: true, running: true },
  textSafety: { supported: true, enabled: true, running: true },
  remoteGuard: { supported: true, enabled: true, trusted: [] },
  scanMenu: { supported: true, enabled: true },
  snip: { supported: true, enabled: true, registered: true, key: 'k', keys: [{ id: 'k', label: 'Ctrl+Shift+S' }] }
});

test('everything running: every main protection is On and the headline says all five', () => {
  const b = board(running());
  assert.equal(b.level, 'on');
  assert.equal(b.headline, 'Protection is on');
  assert.equal(b.sub, 'All 5 protections are running.');
  assert.equal(b.all, true);
  assert.ok(Object.values(rows(b)).every((r) => r.state === 'on' && r.word === 'On'));
});

test('live scanning stopped, auto scanning off, downloads off: no row says On that is not running', () => {
  const info = running();
  info.live = { supported: true, enabled: false, active: false, reason: 'Off' };
  info.autoScan = false;
  info.downloads = { active: false, reason: 'Download protection: turned off' };   // an app before 1.19.2: no enabled
  const r = rows(board(info));
  assert.equal(r.live.state, 'off');
  assert.equal(r.downloads.state, 'off');
  // The shield and exposure alerts are switched on but only work with live scanning: waiting, and saying so.
  for (const id of ['remote', 'exposure']) {
    assert.equal(r[id].state, 'waiting', id);
    assert.equal(r[id].word, 'Waiting');
    assert.equal(r[id].line, 'Works while live scanning is on');
  }
  assert.ok(!['live', 'downloads', 'remote', 'exposure'].some((id) => r[id].word === 'On'));
  assert.equal(board(info).all, false, 'not cast in full gold while a main protection is off');
});

test('switched on but not running is trouble, with the reason the app gives, and the headline names it', () => {
  const info = running();
  info.downloads = { enabled: true, active: false, reason: 'Cannot watch the Downloads folder' };
  const b = board(info);
  assert.equal(rows(b).downloads.state, 'trouble');
  assert.equal(rows(b).downloads.line, 'Cannot watch the Downloads folder');
  assert.equal(b.level, 'partly');
  assert.equal(b.sub, 'Downloads is not working right now.');
});

test('not in this plan is not a fault: no switch, and the fix is the plans page', () => {
  const info = running();
  info.downloads = { enabled: true, active: false, reason: 'Download protection is part of Pro, Max and Ultimate' };
  const r = rows(board(info)).downloads;
  assert.equal(r.state, 'unavailable');
  assert.equal(r.switchable, false);
  assert.deepEqual(r.fix, { label: 'See plans', href: '/app/plan' });
});

test('a shortcut another program took is trouble, not On', () => {
  const info = running();
  info.snip.registered = false;
  assert.equal(rows(board(info)).snip.state, 'trouble');
});

test('outside the app the outline has every guard and no state at all', () => {
  const o = outline();
  assert.deepEqual(o.map((g) => g.id), ['web', 'files', 'copy', 'chats', 'pc']);
  for (const r of o.flatMap((g) => g.rows)) {
    assert.ok(r.line && !('state' in r) && !('word' in r), r.id);
    assert.doesNotMatch(r.line, /\bOn\b|\bOff\b|Needs app/);
  }
});

// The tray's own rules, where that file is in this checkout (it arrives with branch work/e2e-bar-3).
const TRAY = path.join(__dirname, '..', 'desktop', 'src', 'protection.js');
test('the headline is the tray\'s, for every combination of the main five', { skip: !fs.existsSync(TRAY) && 'desktop/src/protection.js is not in this checkout' }, () => {
  const { protectionState } = require(TRAY);
  const kinds = [
    { enabled: false, active: false, reason: 'Off' },
    { enabled: true, active: true, reason: null },
    { enabled: true, active: false, reason: 'Starting' },
    { enabled: true, active: false, reason: 'Sentinel is offline. Trying again shortly.' },
    { enabled: true, active: false, reason: 'Sign in to turn on download protection' }
  ];
  let n = 0;
  for (const d of kinds) for (const f of kinds) for (const l of kinds) for (const c of kinds.slice(0, 3)) for (const t of kinds.slice(0, 3)) {
    const info = { ...running(), downloads: d, defense: { supported: true, ...f }, live: { supported: true, ...l, window: null },
      chatSafety: { supported: true, enabled: c.enabled, running: c.active && c.enabled }, textSafety: { supported: true, enabled: t.enabled, running: t.active && t.enabled } };
    const tray = protectionState({ booting: false, down: false, windows: true, downloads: d, defense: f, live: { ...l, window: false },
      chat: { enabled: c.enabled, running: c.active && c.enabled }, texts: { enabled: t.enabled, running: t.active && t.enabled } });
    const b = board(info);
    assert.deepEqual([b.level, b.headline, b.sub], [tray.level, tray.headline, tray.sub]);
    const r = rows(b);
    for (const i of tray.items) assert.equal(r[i.id].state, i.state, `${i.id} ${JSON.stringify(i)}`);
    n += 1;
  }
  assert.equal(n, 5 * 5 * 5 * 3 * 3);
});
