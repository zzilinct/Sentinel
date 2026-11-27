'use strict';
// A bad update is returned from (desktop/src/updater.js). Electron, the installer and electron-updater are stood in for;
// the real thing is proved end to end by scripts/update-e2e.ps1 (workflow "Automatic update end to end").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const Module = require('module');

// Real file reads (the hash) take a few turns of the event loop.
async function until(f) { for (let i = 0; i < 2000 && !f(); i++) await new Promise((r) => setImmediate(r)); }

function setup(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-rb-'));
  fs.mkdirSync(path.join(dir, 'sentinel-desktop-updater'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sentinel-desktop-updater', 'installer.exe'), 'installer of 1.0.0');
  const data = {};
  const store = { get: (k, d) => (k in data ? data[k] : d), set: (k, v) => { if (v === undefined) delete data[k]; else data[k] = v; } };
  const ran = [];
  const au = Object.assign(new EventEmitter(), { downloads: 0, downloadUpdate() { this.downloads++; return Promise.resolve(); } });
  const app = Object.assign(new EventEmitter(), { getPath: () => dir, getVersion: () => version, isPackaged: true, quit() { ran.push('quit'); } });
  const load = Module._load;
  Module._load = function (req, ...rest) {
    if (req === 'electron') return { app };
    if (req === 'electron-updater') return { autoUpdater: au };
    if (req === 'child_process') return { spawn: (file, args) => { ran.push([file, args]); return { on() {}, unref() {} }; } };
    return load.call(this, req, ...rest);
  };
  const env = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = dir;
  delete require.cache[require.resolve('../desktop/src/updater')];
  const updater = require('../desktop/src/updater');
  const done = () => {
    Module._load = load;
    if (env === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = env;
    delete require.cache[require.resolve('../desktop/src/updater')];
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { updater, store, data, ran, au, dir, done };
}

test('a bad update: the good installer is kept, the second bad start returns to it once, and the bad version is skipped', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // 1.0.0 is installing 1.0.1: its own installer is set aside first.
  const a = setup('1.0.0');
  const lines = [];
  try {
    a.updater.init({ store: a.store, log: (l) => lines.push(l) });
    await a.updater._test.keepLastGood('1.0.1');
    const g = a.data.updateGuard;
    assert.equal(g.good, '1.0.0');
    assert.equal(g.bad, '1.0.1');
    assert.equal(fs.readFileSync(g.file, 'utf8'), 'installer of 1.0.0');
  } finally { a.done(); }

  // 1.0.1 starts after a run that did not quit: bad start 1, nothing yet. A second one: back to 1.0.0.
  const b = setup('1.0.1');
  try {
    const file = path.join(b.updater._test.lastGoodDir(), 'Sentinel-Setup-1.0.0.exe');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'installer of 1.0.0');
    const sha512 = require('crypto').createHash('sha512').update('installer of 1.0.0').digest('base64');
    b.data.updateGuard = { good: '1.0.0', bad: '1.0.1', file, sha512, fails: 0 };
    let fullscreen = true;
    b.updater.init({ store: b.store, log: (l) => lines.push(l), unclean: true, busy: async () => fullscreen, healthy: () => true });
    assert.equal(b.data.updateGuard.fails, 1);
    assert.equal(b.updater.rollingBack(), false);
    b.updater.unhealthy('the scanner did not start');
    assert.equal(b.updater.rollingBack(), true);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(b.ran, [], 'not while something is full screen');
    fullscreen = false;
    t.mock.timers.tick(60 * 1000);
    await until(() => b.ran.length);
    const [ranFile, args] = b.ran[0];
    assert.equal(ranFile, file);
    assert.ok(args.includes('--force-run') && args.includes('/S'));
    assert.equal(b.data.skipVersion, '1.0.1');
    assert.equal(b.data.rolledBack.to, '1.0.0');
    assert.equal(b.data.updateGuard, undefined);
    assert.ok(fs.existsSync(path.join(b.dir, 'start-hidden')), 'it comes back in the tray');
  } finally { b.done(); }

  // The returned-to version tells the person once, and does not download the skipped version.
  const c = setup('1.0.0');
  try {
    c.data.skipVersion = '1.0.1';
    c.data.rolledBack = { from: '1.0.1', to: '1.0.0', at: 1 };
    const told = [];
    c.updater.init({ store: c.store, log: () => {}, onRolledBack: (r) => told.push(r.from) });
    assert.deepEqual(told, ['1.0.1']);
    c.au.emit('update-available', { version: '1.0.1' });
    assert.equal(c.au.downloads, 0, 'the skipped version is not downloaded');
    assert.equal(c.updater.status().status, 'current');
    c.au.emit('update-available', { version: '1.0.2' });
    assert.equal(c.au.downloads, 1, 'a newer version is');
  } finally { c.done(); }
});

test('a version that has been healthy, or an update that did not take, drops the way back', () => {
  const a = setup('1.0.0');
  try {
    const dir = a.updater._test.lastGoodDir();
    fs.mkdirSync(dir, { recursive: true });
    a.data.updateGuard = { good: '1.0.0', bad: '1.0.1', file: path.join(dir, 'x.exe'), sha512: '', fails: 0 };
    a.updater.init({ store: a.store, log: () => {} });   // still 1.0.0: the update did not take
    assert.equal(a.data.updateGuard, undefined);
    assert.equal(fs.existsSync(dir), false);
  } finally { a.done(); }
});

test('the kept installer of a way back that was used is removed at the next start', () => {
  const a = setup('1.0.0');
  try {
    const dir = a.updater._test.lastGoodDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'Sentinel-Setup-1.0.0.exe'), 'x');
    a.updater.init({ store: a.store, log: () => {} });   // no updateGuard: the rollback already cleared it
    assert.equal(fs.existsSync(dir), false);
  } finally { a.done(); }
});

test('a kept installer that was swapped is never run: the bad version is skipped and the person is told', async () => {
  const b = setup('1.0.1');
  try {
    const file = path.join(b.updater._test.lastGoodDir(), 'Sentinel-Setup-1.0.0.exe');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'installer of 1.0.0');
    const sha512 = require('crypto').createHash('sha512').update('installer of 1.0.0').digest('base64');
    const st = fs.statSync(file);
    b.data.updateGuard = { good: '1.0.0', bad: '1.0.1', file, sha512, size: st.size, mtimeMs: st.mtimeMs, fails: 1 };
    // Swapped after it was kept, the same length and the same time of change: size and time alone would not see it.
    fs.writeFileSync(file, 'installer of 9.9.9');
    fs.utimesSync(file, st.atimeMs / 1000, st.mtimeMs / 1000);
    const told = [];
    b.updater.init({ store: b.store, log: () => {}, unclean: true, busy: async () => false, onRolledBack: (r) => told.push(r) });
    await until(() => told.length);
    assert.deepEqual(b.ran, [], 'the swapped file was not run');
    assert.equal(b.data.skipVersion, '1.0.1');
    assert.equal(told.length, 1);
    assert.equal(told[0].refused, true);
    assert.equal(b.updater.rollingBack(), false);
  } finally { b.done(); }
});
