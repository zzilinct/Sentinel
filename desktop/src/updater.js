'use strict';
/**
 * Keeps installed copies current without anyone downloading anything again.
 *
 * New versions are published as GitHub Releases by the release workflow, with
 * the `latest.yml` manifest electron-updater reads. The app checks shortly
 * after start and every six hours, downloads a newer installer quietly, and
 * applies it the next time Sentinel quits (or right away, if the person asks).
 *
 * The installer is not code-signed yet, so electron-updater's publisher check
 * is skipped by its own rule (no publisherName configured). The download
 * itself is verified against the SHA-512 in latest.yml.
 */
const { app } = require('electron');

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

let autoUpdater = null;
let listeners = null;
let state = { supported: false, status: 'idle', version: null, error: null, checkedAt: 0 };

function status() { return { ...state, current: app.getVersion() }; }

function set(patch) {
  state = { ...state, ...patch };
  if (listeners && listeners.onChange) listeners.onChange(status());
}

function init(hooks) {
  listeners = hooks;
  if (!app.isPackaged) { set({ supported: false, status: 'dev' }); return; }
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    set({ supported: false, status: 'unavailable' });
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version }));
  autoUpdater.on('update-not-available', () => set({ status: 'current', checkedAt: Date.now() }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    set({ status: 'ready', version: info.version, progress: 100 });
    if (hooks.onReady) hooks.onReady(info.version);
  });
  autoUpdater.on('error', (err) => set({ status: 'error', error: String(err && err.message || err).slice(0, 200) }));

  set({ supported: true, status: 'idle' });
  setTimeout(() => check(), 20 * 1000).unref();
  setInterval(() => check(), CHECK_EVERY_MS).unref();
}

async function check() {
  if (!autoUpdater) return status();
  try { await autoUpdater.checkForUpdates(); } catch (err) { set({ status: 'error', error: String(err && err.message || err).slice(0, 200) }); }
  return status();
}

/** Quit and run the downloaded installer now. */
function install() {
  if (!autoUpdater || state.status !== 'ready') return { ok: false };
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return { ok: true };
}

module.exports = { init, check, install, status };
