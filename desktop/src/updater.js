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
 *     byte for byte when it arrives, and run only if it has not changed since.
 *   - The installer picks its folder from what Windows remembers, which is not
 *     always where this copy runs. Sentinel tells it: `/D=` is this copy's
 *     own folder.
 *
 * On the next start Sentinel compares its version with the one it tried to
 * install. If the update did not take, the downloaded files are thrown away
 * and it is downloaded again, and the reason is written to logs/app.log.
 *
 * Only what changed is downloaded: each release publishes the installer's
 * block map, and electron-updater fetches just the blocks that differ from the
 * installer this copy came from, which the installer keeps as installer.exe in
 * the cache folder. So that one file stays; the downloaded installer goes once
 * it has done its job.
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const CHECK_EVERY_MS = 2 * 60 * 60 * 1000;   // an update is downloaded within two hours of its release

let autoUpdater = null;
let hooks = {};
let state = { supported: false, status: 'idle', version: null, error: null, checkedAt: 0 };
let downloaded = null;     // { version, file, size, mtimeMs } of an installer that was checked and is ready to run
let installing = false;
let sessionEnding = false; // Windows is signing out or shutting down: no install now, it is left for the next start

const log = (text) => { if (hooks.log) hooks.log(`updater: ${text}`); };

function status() { return { ...state, current: app.getVersion(), skipped: skip() }; }

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

/**
 * Throw away every downloaded installer and electron-updater's record of them. Only our own cache folder.
 * An install that did not take can have its installer still running from this folder (EPERM, seen on CI), so a
 * failure is tried once more half a minute later, as tidy() does.
 */
function clearCache(reason, again = true) {
  try {
    fs.rmSync(cacheDir(), { recursive: true, force: true });
    log(`cleared the downloaded updates (${reason})`);
  } catch (err) {
    log(`could not clear the downloaded updates yet: ${err.message}`);
    if (again) setTimeout(() => clearCache(reason, false), 30 * 1000).unref();
  }
}

function sha512(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha512');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('base64'))).on('error', reject);
  });
}

/**
 * The downloaded installers that are no longer needed: electron-updater's "pending" folder, unless it holds a newer
 * version still waiting to be installed. installer.exe beside it stays (the base of the next differential download).
 * The installer that just ran can still hold its own file for a few seconds after the new copy starts (EPERM), so a
 * failure is tried once more half a minute later; anything still left is tried again at the next start.
 */
function tidy(reason, again = true) {
  const dir = path.join(cacheDir(), 'pending');
  let names;
  try { names = fs.readdirSync(dir); } catch { return; }   // nothing downloaded
  const waiting = names.some((n) => { const m = /^Sentinel-Setup-(\d+\.\d+\.\d+)\.exe$/.exec(n); return m && newer(m[1], app.getVersion()); });
  if (waiting) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    log(`removed the downloaded installer (${reason})`);
  } catch (err) {
    log(`could not remove the downloaded installer yet: ${err.message}`);
    if (again) setTimeout(() => tidy(reason, false), 30 * 1000).unref();
  }
}

/**
 * The way back from a bad update. Just before an update's installer runs, the installer of the version that is
 * running (the installer keeps it as installer.exe, see the top of this file) is copied to LOCALAPPDATA\sentinel-lastgood
 * and recorded as `updateGuard`. If the new version then ends without quitting (or its scanner does not start) on two
 * starts, the copy is run again, the bad version is remembered as `skipVersion` (never downloaded again; a newer one
 * is) and one notice is shown at the next start. Once per version, nothing is downloaded, and the copy is deleted when
 * the new version has been up and healthy for 10 minutes.
 * Sentinel will run that copy, so its SHA-512 is taken as it is copied and kept in Sentinel's own settings: a copy that
 * does not match is never run. The bad version is then only skipped, and the person is told it could not be returned from.
 */
const HEALTHY_AFTER_MS = 10 * 60 * 1000;
let rolling = false;

function lastGoodDir() { return path.join(process.env.LOCALAPPDATA || app.getPath('temp'), 'sentinel-lastgood'); }
function skip() { return (hooks.store && hooks.store.get('skipVersion', null)) || null; }
/** The installer that just ran can still hold its file for a few seconds (EPERM, as tidy() meets): tried again half a minute later. */
function dropLastGood(again = true) {
  try { fs.rmSync(lastGoodDir(), { recursive: true, force: true }); } catch { if (again) setTimeout(() => dropLastGood(false), 30 * 1000).unref(); }
}
function dropGuard() {
  if (hooks.store) hooks.store.set('updateGuard', undefined);
  dropLastGood();
}

async function keepLastGood(bad) {
  const good = app.getVersion();
  const file = path.join(lastGoodDir(), `Sentinel-Setup-${good}.exe`);
  try {
    fs.rmSync(lastGoodDir(), { recursive: true, force: true });
    fs.mkdirSync(lastGoodDir(), { recursive: true });
    await fs.promises.copyFile(path.join(cacheDir(), 'installer.exe'), file);
    hooks.store.set('updateGuard', { good, bad, file, sha512: await sha512(file), fails: 0 });
  } catch (err) {
    log(`no way back from ${bad} was kept (${err.message}); the update goes on`);
  }
}

function reviewGuard() {
  const store = hooks.store;
  const rb = store.get('rolledBack', null);
  if (rb && !rb.told && rb.to === app.getVersion()) {
    store.set('rolledBack', { ...rb, told: true });
    if (hooks.onRolledBack) hooks.onRolledBack(rb);
  }
  const g = store.get('updateGuard', null);
  if (!g) { dropLastGood(); return; }   // nothing to watch: a way back that was used leaves its copy to be removed
  if (g.bad !== app.getVersion()) { dropGuard(); return; }   // the update did not take, or another version is running
  if (hooks.unclean) unhealthy('the last run of this version did not quit');
  if (rolling) return;
  setTimeout(() => {
    if (hooks.healthy && hooks.healthy()) { log(`${g.bad} has been healthy for 10 minutes; the way back is no longer kept`); dropGuard(); } else unhealthy('not healthy after 10 minutes');
  }, HEALTHY_AFTER_MS).unref();
}

/** One bad start of the version that was just installed. The second one returns to the last good version. */
function unhealthy(why) {
  const g = hooks.store && hooks.store.get('updateGuard', null);
  if (!g || g.bad !== app.getVersion() || rolling) return;
  g.fails += 1;
  hooks.store.set('updateGuard', g);
  log(`${g.bad} is not running well (${why}): bad start ${g.fails} of 2`);
  if (g.fails >= 2) rollBack(g);
}

function rollBack(g) {
  const store = hooks.store;
  const done = (why) => { rolling = false; log(`not going back to ${g.good}: ${why}`); dropGuard(); };
  const prior = store.get('rolledBack', null);
  if (prior && prior.from === g.bad) return done('that version was already returned from once');
  rolling = true;
  const go = async () => {
    // Not while a game, video or presentation is full screen: the installer restarts Sentinel. Asked again in a minute (the helper that knows may not be up yet).
    if (hooks.busy && await hooks.busy()) { setTimeout(go, 60 * 1000).unref(); return; }
    const same = (await sha512(g.file).catch(() => null)) === g.sha512;
    store.set('skipVersion', g.bad);
    if (!same) {
      // Not run, whatever it is: the bad version is only skipped, and the person is told.
      store.set('updateGuard', undefined);
      store.set('rolledBack', { from: g.bad, to: g.good, at: Date.now(), told: true, refused: true });
      log(`not going back to ${g.good}: the kept installer is missing or changed. ${g.bad} will not be installed again`);
      dropLastGood();
      rolling = false;
      if (hooks.onRolledBack) hooks.onRolledBack({ from: g.bad, to: g.good, refused: true });
      return;
    }
    store.set('rolledBack', { from: g.bad, to: g.good, at: Date.now() });
    if (pinned() === g.bad) store.set('modelPin', undefined);
    store.set('updateGuard', undefined);
    log(`returning to ${g.good}: ${g.bad} did not run well on this computer`);
    const r = await installFile({ version: g.good, file: g.file, hidden: true, rollback: true });
    if (!r.ok) done(r.error);
  };
  go().catch((err) => done(err.message));
}

/** What happened to the install we started last time? */
function reviewLastAttempt() {
  const attempt = hooks.store && hooks.store.get('updateAttempt', null);
  if (attempt) hooks.store.set('updateAttempt', undefined);
  const current = app.getVersion();
  if (attempt && newer(attempt.version, current)) {
    log(`the update to ${attempt.version} did not take: this copy is still ${current}. Downloading it again.`);
    clearCache('a previous install did not take');
    return;
  }
  if (attempt) log(`updated to ${current}`);
  // The installer that did it is no longer needed: over 200 MB once stayed on disk for good.
  tidy(attempt ? 'the update is installed' : 'left from an earlier update');
}

function init(options) {
  hooks = options || {};
  if (!app.isPackaged) { set({ supported: false, status: 'dev' }); return; }
  // CI only (desktop-e2e.yml, live-e2e.yml): the build under test stays the build under test. Without this, every
  // release published while a branch's run was going updated that run's app to the release in the middle of it.
  // Nothing is asked of the feed; core-update and update-e2e.yml leave it unset and test real updating.
  if (process.env.SENTINEL_NO_UPDATE === '1') { set({ supported: true, status: 'current', checkedAt: Date.now() }); return; }
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    set({ supported: false, status: 'unavailable' });
    return;
  }
  reviewLastAttempt();
  reviewGuard();
  // Downloads start below, so a version that is pinned (models.js) or skipped (it did not run well here) is not fetched.
  autoUpdater.autoDownload = false;
  // Sentinel installs on quit itself (see install()); electron-updater's own quit-install reads the stale record.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  // Only whether the download was differential, and how much of it: the rest is said by the events below.
  const said = (m) => { m = String(m); if (/^Full: |differentially/.test(m)) log(m.split('\n')[0].slice(0, 300)); };
  autoUpdater.logger = { info: said, warn: () => {}, error: said, debug: () => {} };

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => {
    // A chosen model (models.js) is kept: newer versions are still looked for and shown, but not downloaded.
    if (pinned()) { set({ status: 'pinned', version: info.version, pinned: pinned() }); return; }
    if (info.version === skip()) { log(`not downloading ${info.version}: it did not run well on this computer`); set({ status: 'current', checkedAt: Date.now() }); return; }
    set({ status: 'downloading', version: info.version });
    autoUpdater.downloadUpdate().catch(() => {});   // a failure arrives as the 'error' event below
  });
  autoUpdater.on('update-not-available', () => set({ status: 'current', checkedAt: Date.now() }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', async (info) => {
    const file = info.downloadedFile;
    const expected = (info.files && info.files[0] && info.files[0].sha512) || info.sha512 || null;
    if (!file || !fs.existsSync(file) || !expected) {
      set({ status: 'error', error: 'The update downloaded, but its file could not be found. It will be downloaded again.' });
      clearCache('the downloaded file was missing');
      return;
    }
    // Checked once, now, while nothing waits on it: quitting or shutting down then only has to start it.
    const checked = await sha512(file).catch(() => null);
    if (checked !== expected) {
      set({ status: 'error', error: 'The downloaded update did not match its checksum. It will be downloaded again.' });
      log(`${path.basename(file)} did not match the published checksum; not installing it`);
      clearCache('checksum mismatch');
      return;
    }
    downloaded = { version: info.version, file, ...stamp(file) };
    set({ status: 'ready', version: info.version, progress: 100 });
    log(`ready ${info.version}`);
    if (hooks.onReady) hooks.onReady(info.version);
  });
  autoUpdater.on('error', (err) => set({ status: 'error', error: String(err && err.message || err).slice(0, 200) }));

  // Windows is signing out or shutting down: it gives programs only moments, so nothing is started now. The update
  // stays downloaded and installs at a calm moment after the next start.
  app.on('session-end', () => { sessionEnding = true; });
  // Quitting with an update ready installs it, as before, but with the checked file and this copy's folder.
  app.on('before-quit', (event) => {
    if (!downloaded || installing || sessionEnding) return;
    event.preventDefault();
    install({ relaunch: false }).then((r) => { if (!r.ok) { downloaded = null; app.quit(); } });
  });

  set({ supported: true, status: 'idle' });
  setTimeout(() => check(), 20 * 1000).unref();
  setInterval(() => check(), CHECK_EVERY_MS).unref();
}

async function check() {
  // SENTINEL_NO_UPDATE: a check asked for still answers (and the tray is told), as a real one would.
  if (!autoUpdater) { if (state.supported) set({ status: 'current', checkedAt: Date.now() }); return status(); }
  if (state.status === 'ready') return status();   // already downloaded: nothing more to fetch
  try { await autoUpdater.checkForUpdates(); } catch (err) { set({ status: 'error', error: String(err && err.message || err).slice(0, 200) }); }
  return status();
}

/**
 * Run the downloaded installer and quit. `relaunch` starts the new version afterwards ("Restart now"); a plain
 * quit installs without starting it again.
 */
/**
 * The installer's own restart (--force-run) starts Sentinel without arguments, so it would open its window. An
 * update installed while the person was away must bring Sentinel back where it was: in the tray. This file says so
 * to the next start (see startHidden in main.js), and is removed there.
 */
function hiddenMarker() { return path.join(app.getPath('userData'), 'start-hidden'); }

/** The model this copy was asked to stay on, if any (it is the running version once the switch has taken). */
function pinned() { return (hooks.store && hooks.store.get('modelPin', null)) || null; }

/** Size and time of last change: a checked file that still has both is the file that was checked. */
function stamp(file) {
  try { const st = fs.statSync(file); return { size: st.size, mtimeMs: st.mtimeMs }; } catch { return { size: -1, mtimeMs: -1 }; }
}

/** Run a model's installer that models.js downloaded and checked, the same way as an update. */
function installFile({ version, file, hidden = false, rollback = false }) {
  if (installing) return Promise.resolve({ ok: false, error: 'An install is already running' });
  downloaded = { version, file, ...stamp(file) };
  return install({ relaunch: true, hidden, rollback });
}

async function install({ relaunch = true, hidden = false, rollback = false } = {}) {
  if (!downloaded || installing) return { ok: false, error: 'No update is ready' };
  const { version, file, size, mtimeMs } = downloaded;
  const now = stamp(file);
  if (now.size !== size || now.mtimeMs !== mtimeMs) {
    downloaded = null;
    set({ status: 'error', error: 'The downloaded update changed after it was checked. It will be downloaded again.' });
    log(`${path.basename(file)} changed after it was checked; not installing it`);
    clearCache('changed after the check');
    return { ok: false, error: 'changed' };
  }
  installing = true;
  if (!rollback && hooks.store) await keepLastGood(version);
  // Silent, into this copy's own folder. /D= must be the last argument and must not be quoted.
  const args = ['--updated', '/S'];
  if (relaunch) args.push('--force-run');
  if (relaunch && hidden) { try { fs.writeFileSync(hiddenMarker(), String(Date.now())); } catch { /* shown instead: harmless */ } }
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

module.exports = { init, check, install, installFile, status, pinned, cacheDir, hiddenMarker, unhealthy, rollingBack: () => rolling, _test: { newer, tidy, clearCache, keepLastGood, reviewGuard, unhealthy, lastGoodDir } };
