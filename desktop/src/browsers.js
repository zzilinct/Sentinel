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

// `data`: where the browser keeps its settings on Windows, for the browser checkup (checkup.js). `local` is under
// %LOCALAPPDATA%, `roaming` under %APPDATA%. Chromium keeps profiles in "User Data\Default" and "Profile 1"; Opera
// has kept its profile in the folder itself, and Opera 137 in a Default there (`flat`: both). Gecko lists its profiles in profiles.ini there. `scheme`: the
// browser's own pages (chrome://extensions); `policy`: its key under Software\Policies.
const BROWSERS = [
  { id: 'chrome', name: 'Google Chrome', process: 'chrome', engine: 'chromium', scheme: 'chrome', policy: 'Google\\Chrome', data: [{ local: ['Google', 'Chrome', 'User Data'] }] },
  { id: 'edge', name: 'Microsoft Edge', process: 'msedge', engine: 'chromium', scheme: 'edge', policy: 'Microsoft\\Edge', data: [{ local: ['Microsoft', 'Edge', 'User Data'] }] },
  { id: 'brave', name: 'Brave', process: 'brave', engine: 'chromium', scheme: 'brave', policy: 'BraveSoftware\\Brave', data: [{ local: ['BraveSoftware', 'Brave-Browser', 'User Data'] }] },
  {
    id: 'opera', name: 'Opera', process: 'opera', engine: 'chromium', scheme: 'opera', policy: null,
    data: [{ roaming: ['Opera Software', 'Opera Stable'], flat: true }, { id: 'operagx', name: 'Opera GX', roaming: ['Opera Software', 'Opera GX Stable'], flat: true }]
  },
  { id: 'vivaldi', name: 'Vivaldi', process: 'vivaldi', engine: 'chromium', scheme: 'vivaldi', policy: null, data: [{ local: ['Vivaldi', 'User Data'] }] },
  // A Microsoft Store app on WebView2: its settings are not in a place the checkup can read yet, so it says so.
  { id: 'duckduckgo', name: 'DuckDuckGo', process: 'duckduckgo', engine: 'webview2' },
  { id: 'firefox', name: 'Firefox', process: 'firefox', engine: 'gecko', policy: 'Mozilla\\Firefox', data: [{ roaming: ['Mozilla', 'Firefox'] }] },
  { id: 'librewolf', name: 'LibreWolf', process: 'librewolf', engine: 'gecko', policy: null, data: [{ roaming: ['librewolf'] }] }
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

/**
 * Windows: one small PowerShell that stays running and looks at the process list itself every three seconds,
 * printing the browsers only when they change. Starting tasklist every four seconds cost a new process (and its
 * console host) fifteen times a minute, the one thing Sentinel's main process did while nothing else was going on.
 * It ends by itself when Sentinel does: its standard input closes.
 * It also says which program owns the window in front, when that changes ("front:msedge"), looked at twice a second:
 * "Stop pasted commands" looks at the clipboard often only while a browser is in front.
 * Asked "clip" on its input, it answers which program wrote the clipboard and how many milliseconds ago a key or the
 * mouse was last used ("clip:powershell|5230"), for wallet guard (clipwatch.js). Nothing on the clipboard is read here.
 */
const WATCH_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -Namespace SB -Name F -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr h, out int p); [DllImport("user32.dll")] public static extern System.IntPtr GetClipboardOwner(); [DllImport("user32.dll")] public static extern bool GetLastInputInfo([In, Out] int[] p);'
$names = @(__NAMES__)
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$last = $null; $front = $null; $hwnd = [IntPtr]::Zero; $n = 0
while ($true) {
  if ($n % 6 -eq 0) {
    $now = (@(Get-Process -Name $names | ForEach-Object { $_.ProcessName.ToLower() }) | Sort-Object -Unique) -join ','
    if ($now -ne $last) { $last = $now; [Console]::Out.WriteLine('running:' + $now); [Console]::Out.Flush() }
  }
  $n++
  $h = [SB.F]::GetForegroundWindow()
  if ($h -ne $hwnd) {
    $hwnd = $h; $id = 0; [void][SB.F]::GetWindowThreadProcessId($h, [ref]$id); $f = ''
    try { $f = [Diagnostics.Process]::GetProcessById($id).ProcessName.ToLower() } catch {}
    if ($f -ne $front) { $front = $f; [Console]::Out.WriteLine('front:' + $f); [Console]::Out.Flush() }
  }
  if ($pending.Wait(500)) {
    if ($null -eq $pending.Result) { exit }
    if ($pending.Result -eq 'clip') {
      $o = [SB.F]::GetClipboardOwner(); $c = ''
      if ($o -ne [IntPtr]::Zero) { $id = 0; [void][SB.F]::GetWindowThreadProcessId($o, [ref]$id); try { $c = [Diagnostics.Process]::GetProcessById($id).ProcessName.ToLower() } catch {} }
      $li = [int[]](8, 0); [void][SB.F]::GetLastInputInfo($li)
      [Console]::Out.WriteLine('clip:' + $c + '|' + (([int64][Environment]::TickCount - $li[1]) -band 4294967295)); [Console]::Out.Flush()
    }
    $pending = $stdin.ReadLineAsync()
  }
}`;
let watcherChild = null;
let watcherRunning = null;   // the helper's latest answer: process names, or null before it has one
let watcherFront = null;     // the program whose window is in front ('' for none), or null before the helper says
const clipWaiters = [];      // answers owed for "clip"

function startProcessWatcher(onNames, extra = []) {
  if (process.platform !== 'win32' || watcherChild) return;
  const { spawn } = require('child_process');
  // Browsers, and any other programs a caller asked about (the remote-control programs of remoteguard.js): one
  // helper looks at them all, so watching more costs no extra process.
  const names = [...BROWSERS.map((b) => b.process), ...extra.filter((n) => /^[a-z0-9_.]{2,40}$/.test(n))].map((n) => `'${n}'`).join(',');
  const script = WATCH_SCRIPT.replace('__NAMES__', names);
  try {
    watcherChild = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  } catch { watcherChild = null; return; }
  try { require('os').setPriority(watcherChild.pid, require('os').constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* best effort */ }
  let buf = '';
  watcherChild.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith('running:')) { watcherRunning = new Set(line.slice(8).split(',').filter(Boolean)); onNames(); }
      else if (line.startsWith('front:')) watcherFront = line.slice(6);
      else if (line.startsWith('clip:')) {
        const [owner, idle] = line.slice(5).split('|');
        const answer = { owner: owner || null, idle: Number(idle) };
        clipWaiters.splice(0).forEach((done) => done(answer));
      }
    }
  });
  const gone = () => { watcherChild = null; watcherRunning = null; watcherFront = null; clipWaiters.splice(0).forEach((done) => done(null)); };
  watcherChild.on('exit', gone);
  watcherChild.on('error', gone);
}
function stopProcessWatcher() {
  if (watcherChild) { try { watcherChild.stdin.end(); watcherChild.kill(); } catch { /* gone */ } }
  watcherChild = null; watcherRunning = null; watcherFront = null;
}

/** The id of the browser whose window is in front, null when another program's is, undefined when not known. */
function inFront() {
  if (!watcherChild || watcherFront === null) return undefined;
  const b = BROWSERS.find((x) => x.process === watcherFront);
  return b ? b.id : null;
}

/**
 * Who wrote the clipboard and how long since a key or the mouse was used: { owner, idle } (owner is a process name,
 * or null), from the running helper. null when the helper is not running or does not answer within a second.
 */
function clipOwner() {
  if (!watcherChild) return Promise.resolve(null);
  return new Promise((resolve) => {
    const done = (answer) => { clearTimeout(timer); resolve(answer); };
    const timer = setTimeout(() => { const i = clipWaiters.indexOf(done); if (i >= 0) clipWaiters.splice(i, 1); resolve(null); }, 1000);
    clipWaiters.push(done);
    try { watcherChild.stdin.write('clip\n'); } catch { done(null); }
  });
}

/** Ids of the browsers running right now. */
async function running() {
  // The helper's answer when it is running: no process started to ask.
  if (watcherRunning) return BROWSERS.filter((b) => watcherRunning.has(b.process)).map((b) => b.id);
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

// What Windows opens web links with, by the ProgId it records for https.
const PROG_IDS = [
  [/^ChromeHTML/i, 'chrome'], [/^MSEdgeHTM/i, 'edge'], [/^BraveHTML/i, 'brave'], [/^Firefox/i, 'firefox'],
  [/^Opera/i, 'opera'], [/^VivaldiHTM/i, 'vivaldi'], [/^DuckDuckGo/i, 'duckduckgo'], [/^LibreWolf/i, 'librewolf']
];

/** The browser Windows opens links with, or null. */
async function defaultBrowser() {
  if (process.platform !== 'win32') return null;
  const out = await run('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', '/v', 'ProgId']);
  const m = /ProgId\s+REG_SZ\s+(\S+)/.exec(out);
  const hit = m && PROG_IDS.find(([rx]) => rx.test(m[1]));
  return hit ? hit[1] : null;
}

/**
 * The browser "Start scanning" works with: the one chosen in Sentinel, else the computer's default browser, else
 * one that is open, else any installed. null when the computer has no browser Sentinel knows.
 */
async function preferred(chosen) {
  const have = (await installed()).map((b) => b.id);
  if (chosen && have.includes(chosen)) return chosen;
  const def = await defaultBrowser().catch(() => null);
  if (def && have.includes(def)) return def;
  const open = (await running().catch(() => [])).find((id) => have.includes(id));
  return open || have[0] || null;
}

/**
 * Polls the running browsers and reports when one appears or goes away.
 * `onChange(state)` gets { installed: [...], running: [...] }. `everyMs` may be a function, asked before each wait.
 * `others` ({ names, onChange }): more process names to look for in the same helper (Windows only); `onChange` gets
 * the ones running, each time the helper reports a change.
 */
function watch({ onChange, everyMs = 15000, others = null }) {
  let last = '';
  let timer = null;
  let stopped = false;
  const report = async () => {
    try {
      const [inst, run] = await Promise.all([installed(), running()]);
      const state = { installed: inst.map(({ exe, ...rest }) => rest), running: run };
      const key = JSON.stringify(state.running);
      if (key !== last) { last = key; onChange(state); }
    } catch { /* keep going */ }
  };
  // Windows: the helper says when something changes. Elsewhere, or while the helper is not running, poll.
  const extra = (others && others.names) || [];
  const heard = () => {
    if (stopped) return;
    report();
    if (others && watcherRunning) { try { others.onChange(extra.filter((n) => watcherRunning.has(n))); } catch { /* keep going */ } }
  };
  startProcessWatcher(heard, extra);
  const tick = async () => {
    if (stopped) return;
    if (!watcherChild) await report();
    // With the helper running this only looks after it: starts it again if it ended.
    if (process.platform === 'win32' && !watcherChild) startProcessWatcher(heard, extra);
    if (!stopped) timer = setTimeout(tick, watcherChild ? 60000 : (typeof everyMs === 'function' ? everyMs() : everyMs));
  };
  tick();
  return { stop() { stopped = true; clearTimeout(timer); stopProcessWatcher(); } };
}

module.exports = {
  defaultBrowser, preferred, BROWSERS, installed, running, inFront, clipOwner, bringForward, watch, _test: { WATCH_SCRIPT } };
