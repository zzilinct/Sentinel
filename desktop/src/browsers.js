'use strict';
/**
 * Which browsers this computer has, and which are running right now.
 *
 * Sentinel does not need a browser add-on to know a browser is open: it looks
 * at the installed applications and the running processes. This module is what
 * lets the app list "Your browsers" and open or raise one for "Scan with ...".
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const BROWSERS = [
  { id: 'chrome', name: 'Google Chrome', process: 'chrome', engine: 'chromium' },
  { id: 'edge', name: 'Microsoft Edge', process: 'msedge', engine: 'chromium' },
  { id: 'brave', name: 'Brave', process: 'brave', engine: 'chromium' },
  { id: 'opera', name: 'Opera', process: 'opera', engine: 'chromium' },
  { id: 'vivaldi', name: 'Vivaldi', process: 'vivaldi', engine: 'chromium' },
  { id: 'duckduckgo', name: 'DuckDuckGo', process: 'duckduckgo', engine: 'webview2' },
  { id: 'firefox', name: 'Firefox', process: 'firefox', engine: 'gecko' },
  { id: 'librewolf', name: 'LibreWolf', process: 'librewolf', engine: 'gecko' }
];

// Where each browser's executable usually is. The Windows registry is checked
// first; these are fallbacks and the only option on the other platforms.
const CANDIDATES = {
  win32: {
    chrome: ['%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe', '%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe', '%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe'],
    edge: ['%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe', '%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe'],
    brave: ['%ProgramFiles%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', '%LocalAppData%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
    firefox: ['%ProgramFiles%\\Mozilla Firefox\\firefox.exe', '%ProgramFiles(x86)%\\Mozilla Firefox\\firefox.exe', '%LocalAppData%\\Mozilla Firefox\\firefox.exe'],
    opera: ['%LocalAppData%\\Programs\\Opera\\opera.exe', '%LocalAppData%\\Programs\\Opera GX\\opera.exe', '%ProgramFiles%\\Opera\\opera.exe'],
    vivaldi: ['%LocalAppData%\\Vivaldi\\Application\\vivaldi.exe'],
    duckduckgo: ['%LocalAppData%\\Microsoft\\WindowsApps\\DuckDuckGo.exe', '%ProgramFiles%\\WindowsApps\\DuckDuckGo.exe'],
    librewolf: ['%ProgramFiles%\\LibreWolf\\librewolf.exe', '%LocalAppData%\\LibreWolf\\librewolf.exe']
  },
  darwin: {
    chrome: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    edge: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    brave: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
    firefox: ['/Applications/Firefox.app/Contents/MacOS/firefox'],
    opera: ['/Applications/Opera.app/Contents/MacOS/Opera'],
    vivaldi: ['/Applications/Vivaldi.app/Contents/MacOS/Vivaldi'],
    duckduckgo: ['/Applications/DuckDuckGo.app/Contents/MacOS/DuckDuckGo'],
    librewolf: ['/Applications/LibreWolf.app/Contents/MacOS/librewolf']
  },
  linux: {
    chrome: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
    edge: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'],
    brave: ['/usr/bin/brave-browser', '/snap/bin/brave'],
    firefox: ['/usr/bin/firefox', '/snap/bin/firefox'],
    opera: ['/usr/bin/opera'],
    vivaldi: ['/usr/bin/vivaldi', '/usr/bin/vivaldi-stable'],
    duckduckgo: [],
    librewolf: ['/usr/bin/librewolf']
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

// Put a browser's window in front and maximised: restore it if it is minimised,
// raise it if it is behind something. Windows only lets the program in front hand
// the foreground to another, so a tap of Alt is sent first (the documented way to
// be allowed). Prints FRONT when a window was raised, NONE when there is none.
const RAISE = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class FW {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@
$p = Get-Process -Name '__NAME__' | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
if (-not $p) { 'NONE'; exit }
[FW]::ShowWindow($p.MainWindowHandle, 3) | Out-Null
[FW]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [FW]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
[FW]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
'FRONT'
`;

/**
 * "Scan with <browser>": open it if it is closed, and bring it to the front,
 * maximised, if it is minimised or behind something.
 */
async function bringForward(id, { raise } = {}) {
  const b = (await installed()).find((x) => x.id === id);
  if (!b) throw new Error('That browser is not installed');
  // The live-scanning reader is already running and already has the Windows calls loaded: ask it. That is instant,
  // where starting a PowerShell of our own takes a second or more (several, on a busy computer).
  if (raise) {
    const raised = await raise(b.process);
    if (raised === true) return { ok: true, launched: false, name: b.name };
    if (raised === false) return launch(b);   // no window: the browser is closed (or only in the background)
  }
  if (process.platform === 'win32') {
    const encoded = Buffer.from(RAISE.replace('__NAME__', b.process), 'utf16le').toString('base64');
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], 15000);
    if (/FRONT/.test(out)) return { ok: true, launched: false, name: b.name };
  }
  return launch(b);
}

async function launch(b) {
  await new Promise((resolve, reject) => {
    const args = b.engine === 'chromium' ? ['--start-maximized'] : [];
    const child = execFile(b.exe, args, { windowsHide: false }, () => {});
    child.on('error', reject);
    child.on('spawn', () => { child.unref(); resolve(); });
  });
  return { ok: true, launched: true, name: b.name };
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

module.exports = { BROWSERS, installed, running, bringForward, watch };
