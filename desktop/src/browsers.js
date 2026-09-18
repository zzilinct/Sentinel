'use strict';
/**
 * Which browsers this computer has, and which are running right now.
 *
 * Sentinel does not need a browser add-on to know a browser is open: it looks
 * at the installed applications and the running processes. The companion
 * add-on is still what draws masks inside pages; this module is what lets the
 * app say "Chrome just opened" and offer the companion for exactly that browser.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const BROWSERS = [
  { id: 'chrome', name: 'Google Chrome', process: 'chrome', engine: 'chromium', extensionsPage: 'chrome://extensions/' },
  { id: 'edge', name: 'Microsoft Edge', process: 'msedge', engine: 'chromium', extensionsPage: 'edge://extensions/' },
  { id: 'brave', name: 'Brave', process: 'brave', engine: 'chromium', extensionsPage: 'brave://extensions/' },
  { id: 'firefox', name: 'Firefox', process: 'firefox', engine: 'gecko', extensionsPage: 'about:debugging#/runtime/this-firefox' }
];

// Where each browser's executable usually is. The Windows registry is checked
// first; these are fallbacks and the only option on the other platforms.
const CANDIDATES = {
  win32: {
    chrome: ['%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe', '%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe', '%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe'],
    edge: ['%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe', '%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe'],
    brave: ['%ProgramFiles%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', '%LocalAppData%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
    firefox: ['%ProgramFiles%\\Mozilla Firefox\\firefox.exe', '%ProgramFiles(x86)%\\Mozilla Firefox\\firefox.exe', '%LocalAppData%\\Mozilla Firefox\\firefox.exe']
  },
  darwin: {
    chrome: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    edge: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    brave: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
    firefox: ['/Applications/Firefox.app/Contents/MacOS/firefox']
  },
  linux: {
    chrome: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
    edge: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'],
    brave: ['/usr/bin/brave-browser', '/snap/bin/brave'],
    firefox: ['/usr/bin/firefox', '/snap/bin/firefox']
  }
};

const expand = (p) => p.replace(/%([^%]+)%/g, (m, name) => process.env[name] || process.env[name.toUpperCase()] || m);

function run(cmd, args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

/** Windows: the registered path of a browser, from the App Paths key. */
async function registeredPath(exe) {
  for (const hive of ['HKCU', 'HKLM']) {
    const out = await run('reg', ['query', `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`, '/ve']);
    const m = /REG_SZ\s+(.+\.exe)/i.exec(out);
    if (m && fs.existsSync(m[1].trim())) return m[1].trim();
  }
  return null;
}

let installedCache = null;
/** Installed browsers with their executable paths. Cached: installs rarely change while running. */
async function installed() {
  if (installedCache) return installedCache;
  const out = [];
  const table = CANDIDATES[process.platform] || {};
  for (const b of BROWSERS) {
    let exe = null;
    if (process.platform === 'win32') exe = await registeredPath(`${b.process}.exe`);
    if (!exe) exe = (table[b.id] || []).map(expand).find((p) => fs.existsSync(p)) || null;
    if (exe) out.push({ ...b, exe });
  }
  installedCache = out;
  return out;
}

/** Ids of the browsers running right now. */
async function running() {
  let names = new Set();
  if (process.platform === 'win32') {
    const out = await run('tasklist', ['/FO', 'CSV', '/NH']);
    for (const line of out.split(/\r?\n/)) {
      const m = /^"([^"]+)\.exe"/i.exec(line);
      if (m) names.add(m[1].toLowerCase());
    }
  } else {
    const out = await run('ps', ['-axo', 'comm=']);
    for (const line of out.split('\n')) {
      const base = path.basename(line.trim()).toLowerCase();
      if (base) names.add(base.replace(/^google chrome$/, 'chrome').replace(/^microsoft edge$/, 'msedge').replace(/^brave browser$/, 'brave'));
    }
  }
  return BROWSERS.filter((b) => names.has(b.process)).map((b) => b.id);
}

/**
 * Open a browser's own extensions page (browsers refuse those addresses from
 * other programs, so the browser is started with the address as an argument).
 */
async function openExtensionsPage(id) {
  const b = (await installed()).find((x) => x.id === id);
  if (!b) throw new Error('That browser is not installed');
  return new Promise((resolve, reject) => {
    execFile(b.exe, [b.extensionsPage], { windowsHide: false, detached: true, stdio: 'ignore' }, () => {}).on('error', reject).on('spawn', () => resolve({ ok: true }));
  });
}

/**
 * Polls the running browsers and reports when one appears or goes away.
 * `onChange(state)` gets { installed: [...], running: [...] }.
 */
function watch({ onChange, everyMs = 5000 }) {
  let last = '';
  let timer = null;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const [inst, run] = await Promise.all([installed(), running()]);
      const state = { installed: inst.map(({ exe, ...rest }) => rest), running: run };
      const key = JSON.stringify(state.running);
      if (key !== last) { last = key; onChange(state); }
    } catch { /* keep polling */ }
    if (!stopped) timer = setTimeout(tick, everyMs);
  };
  tick();
  return { stop() { stopped = true; clearTimeout(timer); } };
}

module.exports = { BROWSERS, installed, running, openExtensionsPage, watch };
