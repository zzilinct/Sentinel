'use strict';
/**
 * Keeps installed copies current without anyone downloading anything again.
 *
 * New versions are published as GitHub Releases by the release workflow, with
 * the `latest.yml` manifest electron-updater reads. The app checks shortly
 * after start and every six hours and downloads a newer installer quietly.
 *
 * electron-updater finds and downloads the update, and checks it against the
 * SHA-512 in latest.yml. Sentinel runs the installer itself, for two reasons
 * found on a real computer that stayed on 1.5.0 while 1.6.4 was out:
 *
 *   - electron-updater installs whatever file its cached "update-info.json"
 *     names. That record still named the 1.5.0 installer after 1.6.4 had been
 *     downloaded next to it, so every "Restart to update" reinstalled 1.5.0.
 *     Sentinel runs the exact file the download event handed over, checked
 *     again, byte for byte, just before it runs.
 *   - The installer picks its folder from what Windows remembers, which is not
 *     always where this copy runs. Sentinel tells it: `/D=` is this copy's
 *     own folder.
 *
 * On the next start Sentinel compares its version with the one it tried to
 * install. If the update did not take, the downloaded files are thrown away
 * and it is downloaded again, and the reason is written to logs/app.log.
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

let autoUpdater = null;
let hooks = {};
let state = { supported: false, status: 'idle', version: null, error: null, checkedAt: 0 };
let downloaded = null;     // { version, file, sha512 } of an installer that is ready to run
let installing = false;

const log = (text) => { if (hooks.log) hooks.log(`updater: ${text}`); };

function status() { return { ...state, current: app.getVersion() }; }

function set(patch) {
  state = { ...state, ...patch };
  if (hooks.onChange) hooks.onChange(status());
}

/** Is version a newer than version b? (1.6.10 > 1.6.9) */
function newer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

function cacheDir() {
  return path.join(process.env.LOCALAPPDATA || app.getPath('temp'), 'sentinel-desktop-updater');
}

/** Throw away every downloaded installer and electron-updater's record of them. Only our own cache folder. */
function clearCache(reason) {
  try {
    fs.rmSync(cacheDir(), { recursive: true, force: true });
    log(`cleared the downloaded updates (${reason})`);
  } catch (err) {
    log(`could not clear the downloaded updates: ${err.message}`);
  }
}

function sha512(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha512');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('base64'))).on('error', reject);
  });
}

/** What happened to the install we started last time? */
function reviewLastAttempt() {
  const attempt = hooks.store && hooks.store.get('updateAttempt', null);
  if (!attempt) return;
  hooks.store.set('updateAttempt', undefined);
  const current = app.getVersion();
  if (newer(attempt.version, current)) {
    log(`the update to ${attempt.version} did not take: this copy is still ${current}. Downloading it again.`);
    clearCache('a previous install did not take');
  } else {
    log(`updated to ${current}`);
  }
}

function init(options) {
  hooks = options || {};
  if (!app.isPackaged) { set({ supported: false, status: 'dev' }); return; }
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    set({ supported: false, status: 'unavailable' });
    return;
  }
  reviewLastAttempt();
  autoUpdater.autoDownload = true;
  // Sentinel installs on quit itself (see install()); electron-updater's own quit-install reads the stale record.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version }));
  autoUpdater.on('update-not-available', () => set({ status: 'current', checkedAt: Date.now() }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    const file = info.downloadedFile;
    const expected = (info.files && info.files[0] && info.files[0].sha512) || info.sha512 || null;
    if (!file || !fs.existsSync(file) || !expected) {
      set({ status: 'error', error: 'The update downloaded, but its file could not be found. It will be downloaded again.' });
      clearCache('the downloaded file was missing');
      return;
    }
    downloaded = { version: info.version, file, sha512: expected };
    set({ status: 'ready', version: info.version, progress: 100 });
    log(`ready ${info.version}`);
    if (hooks.onReady) hooks.onReady(info.version);
  });
  autoUpdater.on('error', (err) => set({ status: 'error', error: String(err && err.message || err).slice(0, 200) }));

  // Quitting with an update ready installs it, as before, but with the checked file and this copy's folder.
  app.on('before-quit', (event) => {
    if (!downloaded || installing) return;
    event.preventDefault();
    install({ relaunch: false }).then((r) => { if (!r.ok) { downloaded = null; app.quit(); } });
  });

  set({ supported: true, status: 'idle' });
  setTimeout(() => check(), 20 * 1000).unref();
  setInterval(() => check(), CHECK_EVERY_MS).unref();
}

async function check() {
  if (!autoUpdater) return status();
  if (state.status === 'ready') return status();   // already downloaded: nothing more to fetch
  try { await autoUpdater.checkForUpdates(); } catch (err) { set({ status: 'error', error: String(err && err.message || err).slice(0, 200) }); }
  return status();
}

/**
 * Run the downloaded installer and quit. `relaunch` starts the new version afterwards ("Restart now"); a plain
 * quit installs without starting it again.
 */
async function install({ relaunch = true } = {}) {
  if (!downloaded || installing) return { ok: false, error: 'No update is ready' };
  installing = true;
  const { version, file, sha512: expected } = downloaded;
  try {
    const actual = await sha512(file);
    if (actual !== expected) {
      installing = false;
      downloaded = null;
      set({ status: 'error', error: 'The downloaded update did not match its checksum. It will be downloaded again.' });
      log(`${path.basename(file)} did not match the published checksum; not installing it`);
      clearCache('checksum mismatch');
      return { ok: false, error: 'checksum' };
    }
  } catch (err) {
    installing = false;
    log(`could not read the downloaded update: ${err.message}`);
    return { ok: false, error: err.message };
  }
  // Silent, into this copy's own folder. /D= must be the last argument and must not be quoted.
  const args = ['--updated', '/S'];
  if (relaunch) args.push('--force-run');
  args.push(`/D=${path.dirname(process.execPath)}`);
  try {
    const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', (err) => log(`the installer could not start: ${err.message}`));
    child.unref();
  } catch (err) {
    installing = false;
    log(`the installer could not start: ${err.message}`);
    return { ok: false, error: err.message };
  }
  if (hooks.store) hooks.store.set('updateAttempt', { version, at: Date.now() });
  log(`installing ${version} into ${path.dirname(process.execPath)}${relaunch ? ' and restarting' : ''}`);
  downloaded = null;
  setImmediate(() => app.quit());
  return { ok: true };
}

module.exports = { init, check, install, status, _test: { newer } };
