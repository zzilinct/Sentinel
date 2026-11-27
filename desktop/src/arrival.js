'use strict';
/**
 * Where files arrive, watched once for everyone who wants to know (Download protection, downloads.js, and Defense,
 * defense.js).
 *
 * Two things were missing. A file unpacked from an archive lands in a subfolder, and a watch on one folder does not
 * report subfolders: the classic route (download a zip, extract it, run what is inside) was never looked at. And a
 * browser can be set to save somewhere other than Windows' Downloads folder, which nobody looked at either.
 *
 * One watch per folder, shared: Downloads is wanted by both modules and is opened once. A folder is watched with its
 * subfolders on Windows, and everything is decided from the name Windows reports, with no look-up on the disk (one
 * look-up once held the main thread for 4.8 seconds, see defense.js folders()). A file inside a subfolder is passed on
 * only when it can run or start something (PROGRAM, the list Defense uses at the top level: programs, installers,
 * scripts, shortcuts), at most 4 folders deep, not in a hidden folder or a node_modules, and at most
 * NESTED_PER_MINUTE a minute: unpacking a large project into Downloads must not start thousands of scans. A project
 * unpacks thousands of libraries and scripts (NOISY), so those share a smaller allowance and can never use up the
 * one the programs, installers and shortcuts have.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_DEPTH = 4;
const NESTED_PER_MINUTE = 60;
const NOISY_PER_MINUTE = 20;
const PROGRAM = /\.(exe|msi|msix|scr|com|pif|bat|cmd|ps1|vbs|vbe|js|jse|wsf|hta|jar|dll|cpl|lnk|reg)$/i;
const NOISY = /\.(dll|js)$/i;
const SKIPPED = /(^|[\\/])(\.[^\\/]+|node_modules|\$RECYCLE\.BIN)([\\/]|$)/i;

const watches = new Map();   // folder -> { watcher, subs: Set of { onFile, onError } }
const nestedSeen = new Map();   // relative path -> when it was first counted this minute

/** True when a file inside a subfolder is worth looking at, and the minute's allowance is not used up. */
function nestedAccepted(relative, now = Date.now()) {
  if (!PROGRAM.test(relative) || SKIPPED.test(relative) || relative.split(/[\\/]/).length - 1 > MAX_DEPTH) return false;
  for (const [k, t] of nestedSeen) if (now - t >= 60 * 1000) nestedSeen.delete(k);
  // A file being written reports many changes: it counts once.
  if (nestedSeen.has(relative)) return true;
  const noisy = NOISY.test(relative);
  let count = 0;
  for (const k of nestedSeen.keys()) if (NOISY.test(k) === noisy) count++;
  if (count >= (noisy ? NOISY_PER_MINUTE : NESTED_PER_MINUTE)) return false;
  nestedSeen.set(relative, now);
  return true;
}

/**
 * Tell onFile(fullPath) about each change under `dir` (subfolders too when `recursive`). Returns the function that
 * stops listening; the folder's watch is closed when nobody is left. onError() is told when Windows ends the watch.
 */
function watch(dir, recursive, onFile, onError = () => {}) {
  const sub = { onFile, onError };
  let entry = watches.get(dir);
  if (!entry) {
    const handler = (event, filename) => {
      if (!filename) return;
      const name = String(filename);
      const nested = /[\\/]/.test(name);
      if (nested && !nestedAccepted(name)) return;
      const full = path.join(dir, name);
      for (const s of entry.subs) s.onFile(full);
    };
    let watcher;
    try { watcher = fs.watch(dir, { persistent: true, recursive }, handler); } catch (err) {
      if (!recursive) throw err;
      watcher = fs.watch(dir, { persistent: true }, handler);   // a platform that cannot watch subfolders: this folder only
    }
    watcher.on('error', () => { const e = watches.get(dir); close(dir); if (e) for (const s of e.subs) s.onError(); });
    entry = { watcher, subs: new Set() };
    watches.set(dir, entry);
  }
  entry.subs.add(sub);
  return () => { entry.subs.delete(sub); if (!entry.subs.size && watches.get(dir) === entry) close(dir); };
}

function close(dir) {
  const e = watches.get(dir);
  watches.delete(dir);
  if (e) try { e.watcher.close(); } catch { /* closed */ }
}

/* ------------------------------------------------------------ where browsers save */

// Too wide or not ours to watch: a drive, the home folder itself, Windows and program folders, application data, and
// cloud-synced folders (their placeholder files are not there until someone opens them, and a watch only adds noise).
const TOO_WIDE = /(^|\\)(AppData|Windows|Program Files( \(x86\))?|ProgramData|Temp|Documents|OneDrive[^\\]*)(\\|$)/i;

function usable(dir, exclude) {
  if (!dir || !path.isAbsolute(dir)) return false;
  const norm = path.normalize(dir).replace(/[\\/]+$/, '');
  if (path.parse(norm).root.replace(/[\\/]+$/, '') === norm || norm.toLowerCase() === os.homedir().toLowerCase()) return false;
  if (TOO_WIDE.test(norm)) return false;
  return !exclude.some((e) => e && path.normalize(e).replace(/[\\/]+$/, '').toLowerCase() === norm.toLowerCase());
}

/** The folder a browser is set to save into, from its own settings file: Chromium's Preferences, Firefox's prefs.js. */
function savedBy(engine, file, text) {
  if (engine === 'gecko') {
    const dir = /user_pref\("browser\.download\.dir",\s*"((?:[^"\\]|\\.)*)"\)/.exec(text);
    const custom = /user_pref\("browser\.download\.folderList",\s*2\)/.test(text);
    if (!dir || !custom) return null;
    try { return JSON.parse(`"${dir[1]}"`); } catch { return null; }
  }
  try { return JSON.parse(text).download.default_directory || null; } catch { return null; }
}

/**
 * The folders the browsers on this computer save into, other than `exclude` (Downloads and Desktop are watched
 * anyway), read once and only from each browser's own settings. At most three, each one that exists. Nothing is kept
 * but the folder value; no browser file is changed. Never rejects.
 */
async function saveFolders({ exclude = [], local = process.env.LOCALAPPDATA, roaming = process.env.APPDATA } = {}) {
  const { BROWSERS } = require('./browsers');
  const { chromiumProfiles, geckoProfiles } = require('./checkup');
  const found = [];
  for (const b of BROWSERS) {
    for (const d of b.data || []) {
      const base = d.local ? local : roaming;
      if (!base) continue;
      const root = path.join(base, ...(d.local || d.roaming));
      let files = [];
      try {
        files = b.engine === 'gecko'
          ? geckoProfiles(root).map((p) => path.join(p.dir, 'prefs.js'))
          : chromiumProfiles(root, d.flat).map((p) => path.join(p, 'Preferences'));
      } catch { /* not installed */ }
      for (const file of files) {
        try {
          const dir = savedBy(b.engine, file, await fs.promises.readFile(file, 'utf8'));
          if (usable(dir, [...exclude, ...found]) && (await fs.promises.stat(dir)).isDirectory()) found.push(path.normalize(dir));
        } catch { /* unreadable or gone */ }
      }
    }
  }
  return found.slice(0, 3);
}

module.exports = { watch, saveFolders, PROGRAM, _test: { nestedAccepted, savedBy, usable, reset: () => nestedSeen.clear() } };
