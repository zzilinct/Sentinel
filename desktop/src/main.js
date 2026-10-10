'use strict';
/**
 * Sentinel for desktop.
 *
 * - Ships the whole Sentinel server and runs it privately on this computer,
 *   so accounts, scanning and threat feeds work with nothing hosted anywhere.
 *   Point SENTINEL_ORIGIN at a hosted Sentinel instead and the app uses that.
 * - Runs the Sentinel web app in its own window, and keeps protecting from the
 *   system tray after the window is closed.
 * - Starts with the computer (user can turn this off).
 * - Download protection: scans every new file in the Downloads folder with
 *   Sentinel's on-device virus & malware scanner.
 * - Live scanning with no add-on: one button, then the browser in front is
 *   watched (page warnings, a mask beside every search result, the gold line),
 *   only while it is really in use. See watch.js and overlay.js.
 * - Updates itself from GitHub Releases, so nobody downloads Sentinel twice.
 * - Unlocks the app-only features in the web app through a narrow, validated bridge.
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, Notification, safeStorage, session, powerMonitor, screen, globalShortcut } = require('electron');
// The app's own log (logs/app.log), set up in boot.js before anything here loads.
const { appLog } = require('./boot');
const downloads = require('./downloads');
const browsers = require('./browsers');
const watch = require('./watch');
const overlay = require('./overlay');
const chatwatch = require('./chatwatch');
const chatoverlay = require('./chatoverlay');
const updater = require('./updater');
const models = require('./models');
const clipwatch = require('./clipwatch');
const remoteguard = require('./remoteguard');
const typedcheck = require('./typedcheck');
const defense = require('./defense');
const checkup = require('./checkup');
const snip = require('./snip');
const scanmenu = require('./scanmenu');
const store = require('./store');
const parentlock = require('./parentlock');
const server = require('./server');

const DEV = process.argv.includes('--dev');
// Windows gets the .ico (every size, so the taskbar and Alt+Tab never show a blank page); elsewhere the PNG.
const ICON = path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon256.png');
const PAGES = pathToFileURL(path.join(__dirname, 'pages') + path.sep).href;

/** Where the Sentinel web app is served from. Set once the server is up. */
let ORIGIN = null;
let win = null;
let tray = null;
let quitting = false;
let warnWin = null;
let guardWin = null;
let booting = false;
let retryTimer = null;
let retryCount = 0;
let lastUpdateStatus = null;
let browserState = { installed: [], running: [] };
// The page live scanning last judged in front ({ host, badge, at }), for the command shield. A private window's host is not kept.
let pageInFront = null;
let browserWatcher = null;
let lock = null;   // the parent lock (parentlock.js), made once the settings are read
// A file chosen with "Scan with Sentinel" in the right-click menu ({ file, at }), until the app's file scan takes it.
let menuFile = null;

/** Started without a window: from the startup entry, or brought back in the tray after an automatic update. */
const startHidden = (() => {
  if (process.argv.includes('--hidden')) return true;
  try {
    const fsx = require('fs');
    const marker = updater.hiddenMarker();
    const at = Number(fsx.readFileSync(marker, 'utf8'));
    fsx.unlinkSync(marker);
    return Date.now() - at < 10 * 60 * 1000;
  } catch { return false; }
})();

/** Append one line to a file in logs/. `capBytes` empties a file that has grown past it. Logging never throws. */
function appendLog(name, line, capBytes) {
  try {
    const fs = require('fs');
    const file = path.join(app.getPath('userData'), 'logs', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${line}\n`);
    if (capBytes && fs.statSync(file).size > capBytes) fs.writeFileSync(file, '');
  } catch { /* logging is optional */ }
}

/** "msedge" is a process name; people know it as Microsoft Edge. */
function browserName(processName) {
  const b = browsers.BROWSERS.find((x) => x.process === processName);
  return b ? b.name : processName;
}

/** Run one startup step; a failure is logged and never stops the steps after it. */
function step(name, fn) {
  try { return fn(); } catch (err) { appLog(`startup step "${name}" failed: ${err && err.stack || err}`); return undefined; }
}

/** Tell the web app (if it is open) that something on this computer changed. */
function push(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/* Chat safety: Roblox and the Discord app, read on this computer only (chatwatch.js). */
function chatSafetyStatus() {
  const enabled = store.get('chatSafety', false);
  return { enabled, running: enabled && chatwatch.running(), supported: process.platform === 'win32', seen: chatwatch.stats() };
}
/* Text messages in Phone Link: the same reader, its own switch; links in texts are checked by address only. */
function textSafetyStatus() {
  const enabled = store.get('textSafety', false);
  const s = chatwatch.stats();
  return { enabled, running: enabled && chatwatch.running(), supported: process.platform === 'win32', seen: { ...s.phonelink, app: s.app === 'phonelink' ? 'phonelink' : null, reading: s.reading } };
}
// Roblox, Discord or Phone Link came to the front while its switch is off: say once, for each, that Sentinel can watch it.
const CHAT_APPS = { RobloxPlayerBeta: 'Roblox', Discord: 'Discord' };
const TEXT_APPS = { PhoneExperienceHost: 'Phone Link', YourPhone: 'Phone Link' };
function offerChatSafety(processName) {
  if (process.platform !== 'win32') return;
  const texts = TEXT_APPS[processName];
  if (texts) {
    if (store.get('textSafety', false) || store.get('textsOffered', false)) return;
    store.set('textsOffered', true);
    notify('Phone Link is open. Sentinel can check your texts', 'It points out scam texts beside the message, on this computer only. Click to turn it on.', () => showWindow('/app/protection#text-safety'));
    return;
  }
  const name = CHAT_APPS[processName];
  if (!name || store.get('chatSafety', false) || store.get(`chatOffered:${name}`, false)) return;
  store.set(`chatOffered:${name}`, true);
  notify(`${name} is open. Sentinel can watch its chat`, 'Chat safety points out scams and people who may not be safe to talk to, on this computer only. Click to turn it on.', () => showWindow('/app/protection#chat-safety'));
}
/** One reader for both switches: it reads only the apps whose switch is on, and stops when both are off. */
function chatApps() {
  return [...(store.get('chatSafety', false) ? ['discord', 'roblox'] : []), ...(store.get('textSafety', false) ? ['phonelink'] : [])];
}
function startChatSafety() {
  const apps = chatApps();
  if (!apps.length) { chatwatch.stop(); chatoverlay.show(null); return; }
  if (chatwatch.running()) { chatwatch.setApps(apps); return; }
  chatwatch.start({
    apps,
    // Only that it started or failed: never a message, a name, a game or a link.
    log: (text) => appLog(text),
    onState: (s) => chatoverlay.show(s),
    onSeen: () => { push('sentinel:chat-safety', chatSafetyStatus()); push('sentinel:text-safety', textSafetyStatus()); },
    onCounted: (c) => { tally('chat_checked', c.checked); tally('chat_flagged', c.flagged); },
    // Links in texts, by address only. The scanner may still be starting: the words still count without it.
    api: (pathname, body) => (ORIGIN ? apiCall(pathname, body) : Promise.reject(new Error('scanner not ready')))
  });
}
function setChatSafety(enabled) {
  store.set('chatSafety', Boolean(enabled));
  startChatSafety();
  const s = chatSafetyStatus();
  push('sentinel:chat-safety', s);
  return s;
}
function setTextSafety(enabled) {
  store.set('textSafety', Boolean(enabled));
  startChatSafety();
  const s = textSafetyStatus();
  push('sentinel:text-safety', s);
  return s;
}

/*
 * Parent lock (parentlock.js): with a PIN set, switching protection off or quitting needs the PIN. The tray cannot
 * ask for one, so a locked tray click is refused, the menu goes back to how things really are, and the app opens
 * on Parent lock.
 */
function trayGuard(what, weakens) {
  try { lock.guard(what, weakens); return true; } catch {
    refreshTray();
    showWindow('/app/protection#parent-lock');
    return false;
  }
}

function runPowerShell(script, timeout = 15000) {
  return new Promise((resolve) => {
    require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout }, (err, out) => resolve({ ok: !err, out: String(out || '').trim() }));
  });
}

// While the lock is set, a small file says once a minute that Sentinel is running, and on quitting that it quit.
// Found unfinished at the next start, with no Windows restart or shutdown since, Sentinel was ended without
// the PIN (from Task Manager, or a crash), and the parent's record says when. Only times are written.
const heartbeatFile = () => path.join(app.getPath('userData'), 'parent-lock-heartbeat.json');
function heartbeat(clean = false) {
  if (!lock || !lock.isSet()) return;
  try { require('fs').writeFileSync(heartbeatFile(), JSON.stringify({ at: Date.now(), clean })); } catch { /* next minute */ }
}
async function checkHeartbeat() {
  let last = null;
  try { last = JSON.parse(require('fs').readFileSync(heartbeatFile(), 'utf8')); } catch { /* none */ }
  if (lock.isSet() && process.platform === 'win32') {
    const bootAt = Date.now() - require('os').uptime() * 1000;
    // A shutdown or restart (1074, 6006; with fast startup the uptime does not reset) or a power loss (6008) since then: Windows ended Sentinel.
    const systemStopAfter = async (at) => {
      const r = await runPowerShell(`try { @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 1074, 6006, 6008; StartTime = ([DateTimeOffset]::FromUnixTimeMilliseconds(${Number(at)})).LocalDateTime } -MaxEvents 1 -ErrorAction Stop).Count } catch { if ($_.FullyQualifiedErrorId -match 'NoMatchingEventsFound') { 0 } else { -1 } }`);
      if (!r.ok || r.out === '-1') throw new Error('event log not read');
      return Number(r.out) > 0;
    };
    const at = await parentlock.stoppedWithoutPin(last, bootAt, systemStopAfter);
    if (at) lock.note('Sentinel stopped without the PIN (ended from Task Manager, or it crashed)', at);
  }
  heartbeat();
}

// Is this Windows account an administrator? (Then the lock only slows a child down: the app says so.)
let adminAccount = null;
async function isAdminAccount() {
  if (adminAccount === null && process.platform === 'win32') {
    const r = await runPowerShell('whoami /groups');
    adminAccount = r.ok && /S-1-5-32-544/.test(r.out);
  }
  return Boolean(adminAccount);
}

async function lockStatus() {
  return { ...lock.status(), admin: await isAdminAccount(), supported: process.platform === 'win32' };
}

function lockChanged() {
  if (lock.isSet()) heartbeat(); else { try { require('fs').unlinkSync(heartbeatFile()); } catch { /* none */ } }
  refreshTray();
}

/** The signed-in person's pairing if there is one, otherwise this computer's own account. */
function activeToken() {
  return store.getSecret('token') || store.getSecret('deviceToken') || null;
}

/** This computer's own account on the embedded server. Only the embedded server issues one. */
let embedded = false;
async function requestDeviceToken() {
  if (!embedded || !ORIGIN) return null;
  try {
    const res = await fetch(`${ORIGIN}/api/v1/auth/device`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: '{}', signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    if (res.ok && data.token) { store.setSecret('deviceToken', data.token); appLog('device account ready (background protection only)'); return data.token; }
  } catch { /* protection starts once someone signs in */ }
  return null;
}

async function apiOnce(token, pathname, body) {
  const res = await fetch(`${ORIGIN}${pathname}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Sentinel-Client': 'desktop' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data.error && data.error.message) || `HTTP ${res.status}`), { status: res.status, code: data.error && data.error.code });
  return data;
}

/**
 * Calls the Sentinel API for the background services.
 *
 * A token the server refuses must not switch protection off. A person's pairing
 * can lapse (90 idle days) or their account can be gone; the computer's own token
 * can be lost with a rebuilt database. Either way protection carries on: under the
 * computer's own account, with a fresh token if the old one is refused too.
 */
async function apiCall(pathname, body) {
  const personal = store.getSecret('token');
  if (personal) {
    try { return await apiOnce(personal, pathname, body); } catch (err) {
      if (err.status !== 401 || !embedded) throw err;
      appLog("the paired account was refused by the server; protection continues under this computer's own account");
      store.setSecret('token', null);
      store.set('pairedUserId', null);
    }
  }
  let device = store.getSecret('deviceToken') || await requestDeviceToken();
  if (!device) throw Object.assign(new Error('Signed out'), { status: 401 });
  try { return await apiOnce(device, pathname, body); } catch (err) {
    if (err.status !== 401 || !embedded) throw err;
    store.setSecret('deviceToken', null);
    device = await requestDeviceToken();
    if (!device) throw err;
    return apiOnce(device, pathname, body);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => { showWindow(askedToScan(argv)); if (!ORIGIN && !booting) boot(); });
}

app.setAppUserModelId('com.usesentinel.desktop');

/* ------------------------------------------------------------- window */

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0c0d10',
    title: 'Sentinel',
    icon: ICON,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  });

  win.loadFile(path.join(__dirname, 'pages', 'loading.html'));
  win.once('ready-to-show', () => { if (!startHidden) win.show(); });

  // Only Sentinel itself may load inside the app window.
  win.webContents.on('will-navigate', (event, url) => {
    if (!ORIGIN || new URL(url).origin !== ORIGIN) {
      event.preventDefault();
      if (/^https:\/\//.test(url)) shell.openExternal(url);
      return;
    }
    // The app window is the app. The website's front page ("Download Sentinel") has no place in it: any link
    // there (a logo on the sign-in page, a "home" link) lands on the app instead.
    const { pathname } = new URL(url);
    if (pathname === '/' || /^\/index(\.html)?$/.test(pathname)) {
      event.preventDefault();
      win.loadURL(`${ORIGIN}/app`);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url) || (ORIGIN && url.startsWith(ORIGIN))) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
    if (!store.get('trayHintShown')) {
      store.set('trayHintShown', true);
      notify('Sentinel is still protecting you', 'Sentinel keeps running in the tray. Right-click the mask icon to quit.');
    }
  });
}

function openApp(route = '/app') {
  if (!win) createWindow();
  if (ORIGIN) win.loadURL(`${ORIGIN}${route}`);
}

function showWindow(route) {
  // Started in the tray, the window is only made the first time it is opened: then it needs its page.
  const fresh = !win;
  if (fresh) createWindow();
  if (ORIGIN && (route || fresh)) win.loadURL(`${ORIGIN}${route || '/app'}`);
  win.show();
  win.focus();
}

function showError(message) {
  appLog(`scanner did not start: ${message}`);
  ORIGIN = null;
  // Try again without being asked: 15 s, 30 s, 60 s, then every two minutes.
  const wait = [15, 30, 60][retryCount] || 120;
  const first = retryCount === 0;
  retryCount++;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => boot(), wait * 1000);
  if (!win) createWindow();
  win.loadFile(path.join(__dirname, 'pages', 'error.html'), { query: { message, log: server.logPath(), retryIn: String(wait) } });
  // A start that fails while Sentinel is tucked away in the tray should not jump in front of the person, and neither
  // should each retry: the window is shown once, for the first failure of a start the person asked for.
  if (first && !win.isVisible() && !startHidden) win.show();
}

/** A small always-on-top warning for a dangerous page open in a browser. */
function showWarning(item) {
  const v = item.verdict;
  const query = {
    host: item.host,
    url: item.url,
    browser: { chrome: 'Chrome', msedge: 'Microsoft Edge', brave: 'Brave', firefox: 'Firefox' }[item.browser] || item.browser,
    badge: v.overall.badge,
    label: v.overall.label,
    reasons: (v.reasons || []).slice(0, 4).map((r) => r.text).join('\n')
  };
  if (!warnWin || warnWin.isDestroyed()) {
    warnWin = new BrowserWindow({
      width: 480, height: 380, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      alwaysOnTop: true, skipTaskbar: false, show: false, backgroundColor: '#0c0d10', title: 'Sentinel', icon: ICON, autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false }
    });
    warnWin.on('closed', () => { warnWin = null; });
    // On top, but without taking the keyboard: whatever the person is typing does not land in the warning.
    warnWin.once('ready-to-show', () => { if (warnWin) warnWin.showInactive(); });
    warnWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    warnWin.webContents.on('will-navigate', (e) => e.preventDefault());
  }
  warnWin.loadFile(path.join(__dirname, 'pages', 'warn.html'), { query });
  if (warnWin.isVisible()) warnWin.moveTop();
}

/* --------------------------------------------- tech-support scam shield */

// A fake virus alert that takes the whole screen gets a way out, and a remote-control program that starts soon after
// a flagged page (or soon after it was downloaded) gets a plain question. See remoteguard.js for what is looked at.
const remote = remoteguard.create();
let guardMode = null;          // what the shield's window shows: 'escape', 'remote', 'bank', or 'done' once acted on
let guardPid = 0;              // the browser "Get me out" could not close, for "Close <browser>"
let badPage = null;            // the page in front, while it is a fake virus alert or flagged orange or red
let escapeOfferedFor = null;
const bankWarned = new Map();

function remoteGuardOn() { return process.platform === 'win32' && store.get('remoteGuard', true); }
function trustedRemote() {
  const t = store.get('remoteTrusted', []);
  return Array.isArray(t) ? t.filter((id) => remoteguard.byId[id]) : [];
}
function remoteGuardStatus() {
  return { supported: process.platform === 'win32', enabled: store.get('remoteGuard', true), trusted: trustedRemote().map((id) => remoteguard.byId[id].name) };
}

/** The shield's own small window. Above everything, a page that has taken the whole screen included. */
function showGuard(mode, data = {}) {
  if (!guardWin || guardWin.isDestroyed()) {
    guardWin = new BrowserWindow({
      width: 480, height: 420, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      alwaysOnTop: true, skipTaskbar: false, show: false, backgroundColor: '#111215', title: 'Sentinel', icon: ICON, autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false }
    });
    // An ordinary always-on-top window sits under a browser in full screen.
    guardWin.setAlwaysOnTop(true, 'screen-saver');
    guardWin.on('closed', () => { guardWin = null; guardMode = null; guardPid = 0; });
    // On top, but without taking the keyboard: nothing being typed lands in it by accident. The way out of a
    // full-screen page is the exception: that page holds the keyboard and nobody is typing into it, so the shield
    // takes the keyboard there, and Tab and Escape reach it.
    guardWin.once('ready-to-show', () => {
      if (!guardWin) return;
      if (guardMode === 'escape') takeKeyboard(); else guardWin.showInactive();
    });
    guardWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    guardWin.webContents.on('will-navigate', (e) => e.preventDefault());
  }
  guardMode = mode;
  if (mode === 'escape') placeOnPage();
  guardWin.loadFile(path.join(__dirname, 'pages', 'guard.html'), { query: { mode, ...data } });
  if (guardWin.isVisible()) { guardWin.moveTop(); if (mode === 'escape') takeKeyboard(); }
}
/** The shield's window in front with the keyboard. focus() alone loses to a full-screen browser: the reader asks. */
function takeKeyboard() {
  guardWin.show();
  guardWin.focus();
  const b = guardWin.getNativeWindowHandle();
  watch.front(b.length >= 8 ? b.readBigUInt64LE(0).toString() : String(b.readUInt32LE(0)));
}
/** The shield's window in the middle of the display the browser in front is on, where the full-screen page is. */
function placeOnPage() {
  const w = watch.status().window;
  if (!w || !guardWin) return;
  const area = screen.getDisplayMatching(screen.screenToDipRect(null, { x: w.x, y: w.y, width: w.w, height: w.h })).workArea;
  const [gw, gh] = guardWin.getSize();
  guardWin.setPosition(Math.round(area.x + (area.width - gw) / 2), Math.round(area.y + (area.height - gh) / 2));
}
function closeGuard() { if (guardWin && !guardWin.isDestroyed()) guardWin.close(); }

/** A flagged page in front that fills the screen: offer the way out, once for that page. */
function offerEscape() {
  if (!remoteGuardOn() || !badPage || !overlay.isFullscreen() || escapeOfferedFor === badPage.key) return;
  escapeOfferedFor = badPage.key;
  appLog('tech-support scam shield: a flagged page took the whole screen; offered a way out');
  // The scare-page words only for a page that is one; anything else flagged (a video in full screen) gets plain ones.
  showGuard('escape', { browser: browserName(badPage.browser), ...(badPage.support ? { support: '1' } : {}) });
}
/** Which page an offer is for: its site, so a page that keeps rewriting its address stays the same page. */
function escapeKey(page) {
  if (!page) return null;
  if (page.private) return 'private';
  try { return new URL(page.url).hostname; } catch { return String(page.url || ''); }
}

/** When each tool's connection log last changed (0: none), from the file's time alone. See remoteguard.js. */
function remoteTraces() {
  const out = {};
  for (const t of remoteguard.TOOLS) {
    if (!t.trace) continue;
    out[t.id] = Math.max(0, ...[process.env.ProgramData, process.env.APPDATA].filter(Boolean).map((dir) => {
      try { return require('fs').statSync(path.join(dir, t.trace)).mtimeMs; } catch { return 0; }
    }));
  }
  return out;
}
/** The remote-control programs running changed (the running-browsers helper's report), or it is time to look at a log. */
let remoteNames = [];
let traceTimer = null;
function remoteSeen(names) {
  remoteNames = names;
  const alarms = remote.update(names, { downloads: downloads.recent(), trusted: trustedRemote(), traces: remoteTraces() });
  // A connection in an always-running AnyDesk starts no new process: while it runs, its log's time is looked at
  // every 15 seconds.
  const tracing = remoteGuardOn() && remote.running(trustedRemote()).some((t) => t.trace);
  if (tracing && !traceTimer) traceTimer = setInterval(() => remoteSeen(remoteNames), 15000);
  if (!tracing && traceTimer) { clearInterval(traceTimer); traceTimer = null; }
  if (!remoteGuardOn() || !alarms.length) return;
  const a = alarms[0];
  // The program's name and why, never a page or a file name.
  appLog(`tech-support scam shield: ${a.session ? `someone connected to ${a.tool.name}` : `${a.tool.name} started`} ${a.reason === 'page' ? 'soon after a flagged page' : 'soon after it was downloaded'}`);
  askAboutRemote(a, Date.now());
}
async function askAboutRemote(a, since) {
  // Never over a game: while something other than a browser is full screen, the question waits (half an hour at most).
  if (!watch.status().window && await fullscreenInFront()) {
    if (Date.now() - since < 30 * 60 * 1000) setTimeout(() => askAboutRemote(a, since), 20000);
    return;
  }
  if (!remote.running(trustedRemote()).some((t) => t.id === a.tool.id)) return;   // closed in the meantime
  showGuard('remote', { tool: a.tool.id, toolName: a.tool.name, reason: a.reason, ...(a.session ? { session: '1' } : {}) });
}

/** A bank or payment site in front while a remote-control program runs: say so, once per site in half an hour. */
function checkMoneyPage(page) {
  if (!page || page.search || !remoteGuardOn() || !remoteguard.moneySite(page.url)) return;
  const tool = remote.running(trustedRemote())[0];
  if (!tool) return;
  // A private window's site is not kept, even here.
  let key = 'private';
  if (!page.private) { try { key = new URL(page.url).hostname; } catch { return; } }
  const at = bankWarned.get(key);
  if (at && Date.now() - at < 30 * 60 * 1000) return;
  if (bankWarned.size > 100) bankWarned.clear();
  bankWarned.set(key, Date.now());
  showGuard('bank', { tool: tool.id, toolName: tool.name });
}

/** End a process and its children, as Task Manager's End task does. Resolves true when Windows did it. */
function endTask(args) {
  return new Promise((resolve) => {
    require('child_process').execFile('taskkill', [...args, '/T', '/F'], { windowsHide: true, timeout: 15000 }, (err) => resolve(!err));
  });
}

/** Is any of this program's processes still running, another account's included? */
function toolStillRunning(tool) {
  return new Promise((resolve) => {
    require('child_process').execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 15000 },
      (err, out) => resolve(!err && remoteguard.toolsRunning(remoteguard.namesFromTasklist(out)).has(tool.id)));
  });
}
/**
 * "Did you type anything?": a flagged page with a password or card box was closed or left (watch.js onTyped). Asked
 * once per site, in the shield's window, never over a game or over a question the shield is asking. The log says
 * that it was asked, never where.
 */
const typed = typedcheck.create();
function askTyped(t) {
  const happened = typed.ask(t.host, t);
  if (!happened) return;
  appLog(`typed check: a flagged page with a ${happened.replace(',', ' and ')} box was ${t.how === 'closed' ? 'closed' : 'left'}; asking once`);
  showTyped({ happened, ...(t.private ? {} : { site: t.host }) }, Date.now());
}
async function showTyped(data, since) {
  // A way out of the page (escape) is moot once the page is gone; a question about a remote-control program is not.
  const busy = guardWin && !guardWin.isDestroyed() && (guardMode === 'remote' || guardMode === 'bank');
  if (busy || (!watch.status().window && await fullscreenInFront())) {
    if (Date.now() - since < 30 * 60 * 1000) setTimeout(() => showTyped(data, since), 20000);
    return;
  }
  showGuard('typed', data);
}

// What a warning may tick in the recovery guide (web/assets/js/recover.js reads ?happened=).
const RECOVER_HAPPENED = new Set(['remote', 'password', 'card', 'password,card']);
/** The recovery guide inside the app when the app is signed in; otherwise the website's, which needs no account. */
function recoverRoute(happened, fallback) {
  let inApp = false;
  try { inApp = Boolean(win && ORIGIN && new URL(win.webContents.getURL()).pathname.startsWith('/app')); } catch { /* no page yet */ }
  return `${inApp ? '/app/recover' : '/recover'}?happened=${RECOVER_HAPPENED.has(happened) ? happened : fallback}`;
}

/** What the shield's window asks for. Every action follows a button the person pressed there. */
async function guardAction(action, arg) {
  if (action === 'close-page') {
    guardMode = 'done';
    const r = await watch.closeBrowser();
    guardPid = r && !r.closed ? r.pid : 0;
    appLog(`tech-support scam shield: asking the browser window to close ${r && r.closed ? 'worked' : 'did not work'}`);
    return { closed: Boolean(r && r.closed) };
  }
  if (action === 'end-browser') {
    const pid = guardPid;
    guardPid = 0;
    if (!Number.isInteger(pid) || pid <= 4) return { ok: false };
    const ok = await endTask(['/PID', String(pid)]);
    appLog(`tech-support scam shield: closing the browser ${ok ? 'worked' : 'did not work'}`);
    return { ok };
  }
  if (action === 'end-tool') {
    const tool = remoteguard.byId[arg];
    if (!tool) return { ok: false };
    guardMode = 'done';
    for (const p of tool.processes) await endTask(['/IM', `${p}.exe`]);
    // An installed copy runs as a Windows service, which the person's own account cannot end: check, do not assume.
    const ok = !(await toolStillRunning(tool));
    appLog(`tech-support scam shield: ending ${tool.name} at the person's request ${ok ? 'worked' : 'did not work'}`);
    return { ok };
  }
  if (action === 'end-tool-admin') {
    // Only offered after "End the connection" did not work, and it needs the person's yes in Windows' own prompt.
    const tool = remoteguard.byId[arg];
    if (!tool) return { ok: false };
    const r = await runPowerShell(remoteguard.adminStopScript(tool), 3 * 60 * 1000);
    const cancelled = r.out === 'cancelled';
    const ok = !cancelled && !(await toolStillRunning(tool));
    appLog(`tech-support scam shield: ending ${tool.name} as administrator ${cancelled ? 'was refused' : ok ? 'worked' : 'did not work'}`);
    return { ok, cancelled };
  }
  if (action === 'trust-tool') {
    const tool = remoteguard.byId[arg];
    if (!tool) return { ok: false };
    // Never asking about a program again weakens the shield: with a parent lock on, that needs the PIN.
    try { lock.guard(`asking about ${tool.name} off`, true); } catch { return { ok: false, locked: true }; }
    store.set('remoteTrusted', [...new Set([...trustedRemote(), arg])]);
    return { ok: true };
  }
  if (action === 'recover') {
    // The recovery guide in the app, with what happened already ticked.
    closeGuard();
    showWindow(recoverRoute(arg, 'remote'));
    return { ok: true };
  }
  if (action === 'typed-yes') {
    // "Did you type anything?" answered yes: the recovery guide, with the password or the card ticked.
    closeGuard();
    showWindow(recoverRoute(arg, 'password'));
    return { ok: true };
  }
  if (action === 'dismiss') closeGuard();
  return { ok: true };
}

/* --------------------------------------------------------------- tray */

function buildTray() {
  const image = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', process.platform === 'darwin' ? 'icon16.png' : 'icon32.png'));
  tray = new Tray(image);
  tray.setToolTip(`Sentinel ${app.getVersion()}`);
  tray.on('click', () => showWindow());
  refreshTray();
}

/** The tray's update line: what is happening, not just a button that goes grey. */
function updateItem(up) {
  const v = app.getVersion();
  if (!up.supported) return { label: `Sentinel ${v}`, enabled: false };
  if (up.status === 'ready') return { label: `Restart to update to ${up.version}`, click: () => updater.install() };
  if (up.status === 'downloading') return { label: `Downloading update${up.version ? ` ${up.version}` : ''}${Number.isFinite(up.progress) ? ` (${up.progress}%)` : ''}...`, enabled: false };
  if (up.status === 'checking') return { label: 'Checking for updates...', enabled: false };
  if (up.status === 'current') return { label: `Sentinel ${v} is up to date (check again)`, click: () => updater.check() };
  if (up.status === 'error') return { label: `Check for updates (the last check did not finish)`, click: () => updater.check() };
  return { label: `Check for updates (Sentinel ${v})`, click: () => updater.check() };
}

function refreshTray() {
  if (!tray) return;
  const status = downloads.status();
  const pw = watch.status();
  const up = updater.status();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Sentinel', click: () => showWindow() },
    { type: 'separator' },
    { label: status.active ? 'Download protection: on' : status.reason || 'Download protection: off', enabled: false },
    { label: pw.active ? (pw.window ? 'Live scanning: watching the browser in front' : 'Live scanning: ready') : pw.reason || 'Live scanning is off', enabled: false },
    { label: 'Scan a file...', click: () => showWindow('/app/threats') },
    { label: 'Is this call a scam?', click: () => showWindow('/app/call') },
    { type: 'separator' },
    { label: store.get('liveScanning', false) ? 'Stop scanning' : 'Start scanning', enabled: pw.supported, click: () => (store.get('liveScanning', false) ? trayGuard('live scanning off', true) && setLiveScanning(false, { byPerson: true }) : (setAutoSession(false), startScanning())) },
    ...(pw.supported && browserState.installed.length ? [{ label: 'Scan with', submenu: browserState.installed.map((b) => ({ label: b.name, click: () => scanWith(b.id).catch((err) => appLog(`scan with ${b.id} failed: ${err.message}`)) })) }] : []),
    ...(pw.supported ? [{ label: 'Auto scanning (when a browser opens)', type: 'checkbox', checked: store.get('autoScan', false), click: (item) => { if (trayGuard('auto scanning off', !item.checked)) setAutoScan(item.checked).catch(() => {}); } }] : []),
    ...(process.platform === 'win32' ? [{ label: 'Chat safety (Roblox and Discord)', type: 'checkbox', checked: store.get('chatSafety', false), click: (item) => { if (trayGuard('chat safety off', !item.checked)) { setChatSafety(item.checked); refreshTray(); } } }] : []),
    { label: 'Start with my computer', type: 'checkbox', checked: store.get('openAtLogin', true), click: (item) => { if (trayGuard('starting with the computer off', !item.checked)) setOpenAtLogin(item.checked); } },
    ...(snipOn() ? [{ label: 'Check something on screen', click: () => snip.open(300) }] : []),
    ...(process.platform === 'win32' ? [{ label: 'Check my texts', type: 'checkbox', checked: store.get('textSafety', false), click: (item) => { if (trayGuard('Check my texts off', !item.checked)) { setTextSafety(item.checked); refreshTray(); } } }] : []),
    { type: 'separator' },
    updateItem(up),
    { label: 'Open log folder', click: () => shell.showItemInFolder(server.logPath()) },
    { type: 'separator' },
    ...(lock && lock.isSet() ? [{ label: lock.locked() ? 'Parent lock: on' : 'Parent lock: open for a few minutes', enabled: false }] : []),
    { label: 'Quit Sentinel', click: () => { if (trayGuard('Sentinel off', true)) { quitting = true; app.quit(); } } }
  ]));
}

/**
 * Live scanning is one switch. On: whenever a browser is the window in front and
 * in use, Sentinel watches it. It stays on across restarts until it is stopped.
 * `sweep` plays the gold line down the screen: "scanning is ready".
 */
let sweepOnNextWindow = false;
let sweepExpiry = null;
let watchingWindow = false;
async function setLiveScanning(enabled, { byPerson = false } = {}) {
  if (byPerson) setAutoSession(false);
  store.set('liveScanning', Boolean(enabled));
  if (enabled) {
    await watch.restart();
  } else {
    watch.stop();
    overlay.setWindow(null);
  }
  refreshTray();
  return { ...watch.status(), enabled: store.get('liveScanning', false) };
}

/**
 * "Start scanning": the browser the person uses is brought to the front and maximised (opened if it is closed), and
 * the gold line crosses it once it is there. It used to sweep the whole screen at once, over the desktop or a game,
 * whether or not a browser was open.
 */
async function startScanning() {
  const id = await browsers.preferred(store.get('liveBrowser', null)).catch(() => null);
  if (id) return scanWith(id);
  // No browser on this computer: scanning is on, and waits quietly for one.
  return setLiveScanning(true);
}

/**
 * Install a downloaded update without being asked, when it cannot interrupt anything: no browser open at all, or
 * none in front and nobody at the keyboard or mouse for five minutes (and Sentinel's own window not in use). A
 * browser coming to the front first simply means "not now": it is tried again a minute later. Sentinel comes back
 * in the tray afterwards, with live scanning as it was.
 */
let autoInstalling = false;

/**
 * Auto scanning (a switch in Live protection): fast live scanning starts by itself when a browser is opened, and
 * switches off when the last browser is closed. A minimised browser is not being used: the reader rests, nothing is
 * checked and no time is counted, as always. `autoSession` marks scanning that auto scanning started, so closing
 * the browsers never switches off scanning the person started themselves.
 */
// Kept across restarts: an automatic update restarts Sentinel in the middle of an auto session.
let autoSession = false;
function setAutoSession(v) {
  autoSession = Boolean(v);
  if (store.get('autoSession', false) !== autoSession) store.set('autoSession', autoSession);
}
async function autoScanFollow(running) {
  if (!store.get('autoScan', false)) return;
  const on = store.get('liveScanning', false);
  if (running.length && !on) {
    setAutoSession(true);
    await setLiveScanning(true);
    // The gold line crosses the browser as soon as it is in front.
    sweepOnNextWindow = true;
    clearTimeout(sweepExpiry);
    sweepExpiry = setTimeout(() => { sweepOnNextWindow = false; }, 60000);
    appLog('auto scanning: a browser opened, fast scanning on');
  } else if (!running.length && on && autoSession) {
    setAutoSession(false);
    await setLiveScanning(false);
    appLog('auto scanning: every browser closed, scanning off');
  }
}

async function setAutoScan(enabled) {
  store.set('autoScan', Boolean(enabled));
  if (enabled) await autoScanFollow(browserState.running || []);
  else if (autoSession) { setAutoSession(false); await setLiveScanning(false); }
  refreshTray();
  return { autoScan: Boolean(enabled), live: { ...watch.status(), enabled: store.get('liveScanning', false) } };
}
/** Is a fullscreen game, video or presentation in front? (SHQueryUserNotificationState: busy, Direct3D fullscreen, presentation.) */
function fullscreenInFront() {
  const script = `Add-Type -Namespace S -Name Q -MemberDefinition '[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int s);'
$s = 0; [void][S.Q]::SHQueryUserNotificationState([ref]$s); $s`;
  return new Promise((resolve) => {
    require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 15000 }, (err, out) => resolve(!err && [2, 3, 4].includes(Number(String(out).trim()))));
  });
}

async function autoInstallSoon() {
  if (autoInstalling || updater.status().status !== 'ready') return;
  const idleSeconds = powerMonitor.getSystemIdleTime();
  const browserInFront = Boolean(watch.status().window);
  const usingSentinel = Boolean(win && !win.isDestroyed() && win.isVisible() && win.isFocused());
  const open = await browsers.running().catch(() => ['unknown']);
  const away = !browserInFront && idleSeconds >= 5 * 60 && !usingSentinel;
  if (open.length && !away) return;
  if (usingSentinel && idleSeconds < 5 * 60) return;
  // Never in the middle of something: someone typing or moving the mouse, or a game or video fullscreen (a game
  // played with a controller leaves the keyboard and mouse idle, so fullscreen is asked of Windows itself).
  if (idleSeconds < 2 * 60 || await fullscreenInFront()) return;
  const version = updater.status().version;
  // An update that failed to install twice is left for the person to install: trying again and again would
  // restart Sentinel over and over.
  const tries = store.get('autoInstallTries', {});
  if ((tries[version] || 0) >= 2) return;
  store.set('autoInstallTries', { [version]: (tries[version] || 0) + 1 });
  autoInstalling = true;
  appLog(`updating to ${version} by itself (${open.length ? `idle ${Math.round(idleSeconds / 60)} min` : 'no browser open'})`);
  const r = await updater.install({ relaunch: true, hidden: !(win && !win.isDestroyed() && win.isVisible()) }).catch((err) => ({ ok: false, error: err.message }));
  if (!r.ok) { autoInstalling = false; appLog(`automatic update did not start: ${r.error || 'unknown'}`); }
}

/** "Scan with <browser>": scanning on, that browser open, in front and maximised, the gold line over it. */
async function scanWith(id) {
  // Already scanning: nothing to restart. Restarting would stop the reader that is about to raise the browser.
  const status = watch.status().active && store.get('liveScanning', false)
    ? { ...watch.status(), enabled: true }
    : await setLiveScanning(true);
  if (!status.active) return { ok: false, reason: status.reason || 'Live scanning could not start', ...status };
  sweepOnNextWindow = true;
  clearTimeout(sweepExpiry);   // an earlier click's timer must not cancel this one's sweep
  sweepExpiry = setTimeout(() => { sweepOnNextWindow = false; }, 20000);
  const raised = await browsers.bringForward(id, { raise: watch.raise });
  // Already in front and watched: no new window will arrive to trigger the line, so it crosses the browser now.
  if (!raised.launched && watch.status().window) {
    setTimeout(() => { if (sweepOnNextWindow && watch.status().window) { sweepOnNextWindow = false; overlay.sweep('start'); } }, 400);
  }
  return { ok: true, ...raised, ...status };
}

/**
 * Where the installer put Sentinel, as Windows has it on record. A second copy somewhere else (an old one, or one
 * started from a download) must not take over the startup entry: two copies used to rewrite it in turn, and the
 * older one then started with the computer.
 */
function installedDir() {
  if (process.platform !== 'win32') return null;
  try {
    const out = require('child_process').execFileSync('reg', ['query', 'HKCU\\Software\\6c1efe81-ac4e-5850-af10-e878d40485b6', '/v', 'InstallLocation'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    const m = /InstallLocation\s+REG_\w+\s+(.+)/.exec(out);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

/** True for a packaged copy that is the installed one (or when no install is recorded). */
function installedCopy(what) {
  if (!app.isPackaged) return false;
  const installed = installedDir();
  const here = path.dirname(process.execPath);
  if (installed && path.resolve(installed).toLowerCase() !== path.resolve(here).toLowerCase()) {
    appLog(`not the installed copy (installed in ${installed}); leaving ${what} alone`);
    return false;
  }
  return true;
}

function setOpenAtLogin(enabled) {
  store.set('openAtLogin', enabled);
  if (installedCopy('the startup entry')) app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
  refreshTray();
}

/* "Scan with Sentinel" in the right-click menu for files (scanmenu.js). */
function scanMenuStatus() { return { supported: process.platform === 'win32', enabled: store.get('scanMenu', true) }; }
async function setScanMenu(enabled) {
  store.set('scanMenu', enabled);
  if (process.platform === 'win32' && installedCopy('the right-click menu')) {
    const ok = await (enabled ? scanmenu.register(process.execPath) : scanmenu.unregister());
    appLog(`right-click menu: ${enabled ? (ok ? 'registered' : 'could not be registered') : 'removed'}`);
  }
  return scanMenuStatus();
}
/** A command line from the right-click menu: keeps its file for the app's file scan and says where to open. */
function askedToScan(argv) {
  const file = scanmenu.fileFrom(argv);
  if (!file) return undefined;
  menuFile = { file, at: Date.now() };
  appLog('right-click menu: a file was handed over for a scan');
  return '/app/threats';
}
/** The file from the right-click menu, once, for the file scan page: { name, size, data }, data only up to 25 MB. */
async function takeMenuFile() {
  const m = menuFile;
  menuFile = null;
  if (!m || Date.now() - m.at > 10 * 60 * 1000) return null;
  const fs = require('fs');
  const stat = await fs.promises.stat(m.file);
  if (!stat.isFile()) return null;
  const name = path.basename(m.file);
  if (stat.size > require('../shared/filescan').MAX_FILE_BYTES) return { name, size: stat.size, data: null };
  return { name, size: stat.size, data: await fs.promises.readFile(m.file) };
}

/**
 * Sentinel works in the background and must never compete with what the person is doing (a game, above all):
 * every one of its processes runs below normal priority. Chromium starts its helpers at normal (the graphics
 * process even above), so they are lowered as they appear.
 */
function stayInBackground() {
  const os = require('os');
  const low = os.constants.priority.PRIORITY_BELOW_NORMAL;
  const pids = new Set([process.pid]);
  try { for (const m of app.getAppMetrics()) pids.add(m.pid); } catch { /* not ready */ }
  for (const pid of pids) { try { if (os.getPriority(pid) < low) os.setPriority(pid, low); } catch { /* gone */ } }
}

/**
 * The end-to-end run on a GitHub desktop (scripts/live-e2e.ps1) measures what Sentinel costs at rest. When it sets
 * SENTINEL_CPU_PROFILE to a file and later creates that file, the main process records sixty seconds of where its
 * processor time goes, next to it (<file>.cpuprofile). Nobody else sets this; nothing runs without it.
 */
function cpuProfileOnRequest() {
  const trigger = process.env.SENTINEL_CPU_PROFILE;
  if (!trigger) return;
  const fsx = require('fs');
  let started = false;
  const begin = () => {
    if (started || !fsx.existsSync(trigger)) return;
    started = true;
    const inspector = require('inspector');
    const s = new inspector.Session();
    s.connect();
    s.post('Profiler.enable', () => s.post('Profiler.start', () => {
      appLog('cpu profile: recording 60 s');
      setTimeout(() => s.post('Profiler.stop', (err, res) => {
        try { fsx.writeFileSync(`${trigger}.cpuprofile`, JSON.stringify(res.profile)); appLog('cpu profile: written'); } catch (e) { appLog(`cpu profile: ${e.message}`); }
        s.disconnect();
      }), 60000);
    }));
  };
  try { fsx.watch(require('path').dirname(trigger), () => begin()); } catch { /* no folder */ }
}

/**
 * "Check links I copy" and "Stop pasted commands" share one look at the clipboard (clipwatch.js), running while
 * either switch is on. Links are off until the person turns them on; the command shield is on unless they turn it
 * off, because the people a fake "I am not a robot" page catches are not the ones who go looking for a switch.
 */
function syncClipboard() {
  const links = () => store.get('clipboardCheck', false);
  const commands = () => process.platform === 'win32' && store.get('commandShield', true);
  const wallets = () => process.platform === 'win32' && store.get('walletGuard', true);
  if (!ORIGIN || (!links() && !commands() && !wallets())) { clipwatch.stop(); return; }
  clipwatch.start({
    api: apiCall,
    log: appLog,
    links,
    commands,
    wallets,
    clipOwner: () => browsers.clipOwner(),
    listen: (handler) => browsers.clipListen(handler),
    listening: () => browsers.clipListening(),
    browserOpen: () => (browserState.running || []).length > 0,
    browserInFront: () => browsers.inFront(),
    // The page is named only when live scanning is watching the browser in front now: then it is where the copy came from.
    page: () => (watch.status().window && pageInFront && Date.now() - pageInFront.at < 10 * 60 * 1000 ? pageInFront : undefined),
    onDanger: (d) => notify(`Careful: the link you copied is a ${d.label.toLowerCase()}`, `${d.host}${d.reason ? ` - ${d.reason}` : ''}. Click to see why.`, () => showWindow(`/app/scan?url=${encodeURIComponent(d.url)}`)),
    onCommand: (c) => {
      const from = c.host ? `From ${c.host}. ` : c.from === 'program' ? 'Copied in a program, not a web page. ' : '';
      if (c.action === 'stop') tally('commands_stopped');
      if (c.action === 'stop') notify('Sentinel stopped a copied command', `${from}${c.reason}. Never paste a command a website gives you into Windows. Click to put it back if you trust it.`, () => putBackCommand().then((r) => notify(r.ok ? 'The command is back on your clipboard' : 'The command was not put back', r.message)));
      else notify('Careful with the command you copied', `${from}${c.reason}. Only run it if you know exactly what it does and who it came from.`);
      push('sentinel:command', clipwatch.heldCommand());
    },
    // Wallet guard: an address swapped on the clipboard. The addresses themselves never leave clipwatch.
    onWallet: (w) => {
      tally('wallet_swaps');
      notify(
      w.putBack ? 'Sentinel put back the wallet address you copied' : 'The wallet address you copied was replaced',
      `${w.putBack ? 'Something on this PC replaced the wallet address you copied. Sentinel put yours back. Check every character before you send.' : 'Something on this PC replaced the wallet address you copied, and Windows did not let Sentinel put it back. Copy it again and check every character before you send.'}${w.program ? ` It looks like ${w.program} did it.` : ''} Click to check this PC with Defense.`,
      () => showWindow('/app/protection#defense'));
    }
  });
}

/** "Put it back", from the notification or the app. Answers { ok, message }; the parent lock covers it. */
async function putBackCommand() {
  try { if (lock) lock.guard('a stopped command back on the clipboard', true); } catch (err) { return { ok: false, message: err.message }; }
  const r = await clipwatch.putBack();
  push('sentinel:command', clipwatch.heldCommand());
  return {
    ok: r.ok,
    message: r.ok ? 'Only run it if you know exactly what it does.'
      : r.why === 'newer' ? 'You copied something else since, so Sentinel left your clipboard alone. Copy the command again and Sentinel will not stop it.'
        : r.why === 'failed' ? 'Windows did not let Sentinel change the clipboard. Copy the command again and Sentinel will not stop it.'
          : 'Sentinel holds a stopped command for two minutes only, and that time is up. Copy it again and choose Put it back straight away.'
  };
}

/** "Check links I copy": its switch. */
function setClipboardCheck(enabled) {
  store.set('clipboardCheck', Boolean(enabled));
  syncClipboard();
  return { clipboardCheck: Boolean(enabled) };
}

/** Wallet guard: its switch. */
function setWalletGuard(enabled) {
  store.set('walletGuard', Boolean(enabled));
  syncClipboard();
  return { walletGuard: Boolean(enabled) };
}

/**
 * "Check something on screen" (snip.js): a shortcut, and a line in the tray. On unless turned off; the parent lock does
 * not cover it, because it only adds a check the person asks for. The shortcut is registered while it is on, so it
 * takes no key from other programs once it is off.
 */
function snipOn() { return process.platform === 'win32' && store.get('snipCheck', true); }
function snipKey() { const k = store.get('snipKey', snip.DEFAULT_KEY); return snip.KEYS[k] ? k : snip.DEFAULT_KEY; }
let snipRegistered = null;   // the shortcut Windows gave Sentinel, or null
function syncSnip() {
  if (snipRegistered) { globalShortcut.unregister(snipRegistered); snipRegistered = null; }
  if (snipOn()) {
    let ok = false;
    try { ok = globalShortcut.register(snipKey(), () => snip.open()); } catch { /* refused */ }
    if (ok) snipRegistered = snipKey();
    else appLog(`check on screen: the shortcut ${snipKey()} is taken by another program`);
  }
  refreshTray();
  return snipStatus();
}
function snipStatus() {
  return { supported: process.platform === 'win32', enabled: snipOn(), key: snipKey(), registered: snipRegistered === snipKey(), keys: Object.entries(snip.KEYS).map(([id, label]) => ({ id, label })) };
}

/** "Stop pasted commands": its switch. */
function setCommandShield(enabled) {
  store.set('commandShield', Boolean(enabled));
  syncClipboard();
  return { commandShield: Boolean(enabled) };
}

/*
 * Exposure alerts: a site visited in the last 14 days that a threat list names afterwards. The embedded server keeps
 * the keyed marks and does the matching when its lists refresh (server/lib/scan/exposure.js); here the app asks for
 * new matches once an hour, and says so at most once a day.
 */
const EXPOSURE_EVERY_MS = 60 * 60 * 1000;
const EXPOSURE_FIRST_MS = 2 * 60 * 1000;
const EXPOSURE_NOTIFY_GAP_MS = 20 * 60 * 60 * 1000;
let exposureTimer = null;
let exposureFirst = null;

/** Plain words for what a list says a site is. */
function exposureWhat(e) {
  return e.kind === 'malware' ? 'spreading malware' : e.kind === 'phishing' ? 'a fake sign-in page' : e.kind === 'crypto' ? 'a crypto scam' : 'a scam';
}

async function checkExposures() {
  if (!store.get('exposureAlerts', false) || !ORIGIN) return;
  let items;
  try { items = (await apiCall('/api/v1/live/exposures')).items || []; } catch { return; }
  const fresh = items.filter((e) => !e.notified);
  if (!fresh.length) return;
  push('sentinel:exposures', items);
  if (Date.now() - store.get('exposureNotifiedAt', 0) < EXPOSURE_NOTIFY_GAP_MS) return;
  store.set('exposureNotifiedAt', Date.now());
  const one = fresh.length === 1;
  notify(one ? `${fresh[0].page ? 'A page on a site you visited' : 'A site you visited'} is now listed as ${exposureWhat(fresh[0])}` : `${fresh.length} sites you visited are now on threat lists`,
    one ? `${fresh[0].host}. Click to see what to do.` : 'Click to see which ones, and what to do about each.',
    () => showWindow('/app/protection#exposures'));
  // Only the hosts it named: anything a list adds after this is told about tomorrow.
  try { await apiCall('/api/v1/live/exposures/notified', { hosts: fresh.map((e) => e.host) }); } catch { /* told again next time */ }
}

function setExposureAlerts(enabled) {
  store.set('exposureAlerts', Boolean(enabled));
  clearInterval(exposureTimer);
  clearTimeout(exposureFirst);
  exposureTimer = exposureFirst = null;
  if (enabled) {
    // Marks an earlier "off" could not erase go now, before new ones are made.
    forgetExposures().catch(() => {});
    exposureTimer = setInterval(() => checkExposures().catch(() => {}), EXPOSURE_EVERY_MS);
    exposureFirst = setTimeout(() => checkExposures().catch(() => {}), EXPOSURE_FIRST_MS);
    exposureTimer.unref();
    exposureFirst.unref();
  } else {
    // Off means forgotten: every remembered visit is removed from the server at once. If the server cannot be reached
    // yet, the erasing waits in the store and is tried again at every start until it goes through.
    store.set('exposureForgetPending', true);
    return forgetExposures().then((erased) => ({ exposureAlerts: false, erased }));
  }
  return { exposureAlerts: Boolean(enabled) };
}

/*
 * Your week with Sentinel (server/lib/week.js). What the app sees on this computer is counted here as numbers (files
 * checked, a command stopped, a wallet swap caught, chat messages checked) and handed to the app's own server every
 * few minutes: never a file name, a command, an address or a message. Counts not yet handed over when the app is
 * ended are lost, never guessed at.
 */
const weekPending = {};
const WEEK_FLUSH_MS = 5 * 60 * 1000;
const WEEK_RECAP_EVERY_MS = 60 * 60 * 1000;
let weekTimers = null;
function tally(metric, n = 1) {
  if (n > 0) weekPending[metric] = (weekPending[metric] || 0) + n;
}
// A file in Downloads is checked by download protection and by Defense: counted once.
const checkedFiles = new Map();
function fileChecked(file) {
  const key = String(file || '').toLowerCase();
  const t = Date.now();
  for (const [k, at] of checkedFiles) if (t - at > 10 * 60 * 1000) checkedFiles.delete(k);
  if (checkedFiles.has(key)) return;
  checkedFiles.set(key, t);
  tally('files_checked');
}
async function flushWeek() {
  if (!ORIGIN || !Object.keys(weekPending).length) return;
  const counts = { ...weekPending };
  for (const k of Object.keys(counts)) delete weekPending[k];
  try { await apiCall('/api/v1/week/count', { counts }); } catch (err) {
    // A server that will never take them (one this computer does not run) is not asked again with the same numbers.
    if (err.status !== 403) for (const [k, n] of Object.entries(counts)) tally(k, n);
  }
}

/** The weekly note, when the person turned it on: last week in one line, once, and never over a game. */
async function weekRecap() {
  if (!store.get('weekRecap', false) || !ORIGIN) return;
  let s;
  try { s = await apiCall('/api/v1/week'); } catch { return; }
  const w = s.weeks[s.weeks.length - 2];
  if (!w || w.startsAt <= store.get('weekRecapFor', 0)) return;
  // A week with nothing in it is not news.
  if (!w.checked && !w.caught) { store.set('weekRecapFor', w.startsAt); return; }
  if (await fullscreenInFront()) return;   // asked again in an hour
  store.set('weekRecapFor', w.startsAt);
  notify(`Your week with Sentinel: ${w.headline}`,
    `${w.biggest || `Sentinel checked ${w.checked.toLocaleString()} links, files and messages, and found nothing dangerous.`} Click to see your week.`,
    () => showWindow('/app/week'));
}

function startWeek() {
  if (weekTimers) return;
  weekTimers = [setInterval(() => flushWeek().catch(() => {}), WEEK_FLUSH_MS), setInterval(() => weekRecap().catch(() => {}), WEEK_RECAP_EVERY_MS)];
  weekTimers.forEach((t) => t.unref());
}

function setWeekRecap(enabled) {
  // Turned on: the first note is about the week now running, once it is over. Never one straight away.
  if (enabled && !store.get('weekRecap', false)) store.set('weekRecapFor', Date.now() - 7 * 24 * 60 * 60 * 1000);
  store.set('weekRecap', Boolean(enabled));
  return { weekRecap: Boolean(enabled) };
}

/**
 * Your sites: look-alikes of the sites the person uses (server/lib/scan/mysites.js). On unless switched off; off means
 * forgotten, as with exposure alerts, and an erase the server could not take yet is tried again at every start.
 */
async function forgetMySites() {
  if (!store.get('mySitesForgetPending', false)) return true;
  if (!ORIGIN) return false;
  try {
    await apiCall('/api/v1/my-sites/forget', {});
    store.set('mySitesForgetPending', false);
    return true;
  } catch { return false; }
}

async function setMySites(enabled) {
  if (enabled) {
    await forgetMySites();
    store.set('mySites', true);
    return { mySites: true };
  }
  store.set('mySites', false);
  store.set('mySitesForgetPending', true);
  return { mySites: false, erased: await forgetMySites() };
}

async function forgetExposures() {
  if (!store.get('exposureForgetPending', false)) return true;
  if (!ORIGIN) return false;
  try {
    await apiCall('/api/v1/live/exposures/forget', {});
    store.set('exposureForgetPending', false);
    return true;
  } catch { return false; }
}

/**
 * "Check that day's downloads", for a site a list says spreads malware: the files that arrived in Downloads around the
 * day of the visit go through Defense, exactly as a new download would.
 */
async function checkDownloadsFrom(day) {
  const DAY = 24 * 60 * 60 * 1000;
  const at = Number(day);
  if (!Number.isFinite(at) || at <= 0) throw new Error('Unknown day');
  const fsx = require('fs');
  const folder = app.getPath('downloads');
  // Half a day either side: the day is counted in UTC, and the person's evening may be the next day there.
  const from = at - DAY / 2;
  const to = at + DAY + DAY / 2;
  let names = [];
  try { names = fsx.readdirSync(folder); } catch { return { checked: 0, flagged: 0 }; }
  const files = [];
  for (const name of names) {
    const full = path.join(folder, name);
    try { const st = fsx.statSync(full); if (st.isFile() && st.mtimeMs >= from && st.mtimeMs < to) files.push(full); } catch { /* gone */ }
    if (files.length >= 200) break;
  }
  let flagged = 0;
  for (const full of files) {
    try { const item = await defense.inspect(full, 'exposure check'); if (item && item.badge) flagged++; } catch { /* unreadable: skipped */ }
  }
  return { checked: files.length, flagged };
}

/**
 * Browser checkup: every browser's add-ons, notification permissions, search engine and startup pages, read from its
 * settings files on this computer (checkup.js, read only) and judged there. The site addresses it finds get the fast
 * scan by address, as a private window's would (nothing goes into history); no site is opened. Nothing in a browser
 * is changed: the person removes what they choose, in the browser.
 */
async function runCheckup() {
  const result = await checkup.collectAside();
  const urls = checkup.addressesOf(result);
  const byUrl = {};
  let sitesWhy = null;
  for (let i = 0; i < urls.length; i += 60) {
    try {
      // `purpose`: a checkup is not browsing, so it spends no live-scanning minutes.
      Object.assign(byUrl, (await apiCall('/api/v1/live/batch', { urls: urls.slice(i, i + 60), private: true, mode: 'fast', purpose: 'checkup' })).byUrl || {});
    } catch (err) {
      // Said in the app as it is: signed out, the server's own words (a limit), or no connection.
      sitesWhy = err.status === 401 ? 'Sentinel is not signed in.' : err.status ? String(err.message) : 'Sentinel could not reach its scanner just now.';
      appLog(`checkup: site addresses could not be checked: ${err.status || ''} ${err.code || err.message}`);
      break;
    }
  }
  const addons = result.browsers.reduce((n, b) => n + b.profiles.reduce((m, p) => m + p.addons.length, 0), 0);
  // Counts only: no add-on, site or address is written to the log.
  appLog(`checkup: ${result.browsers.length} browser(s), ${addons} add-on(s), ${urls.length} site address(es) read`);
  return { ...checkup.attach(result, byUrl), sitesChecked: !sitesWhy, sitesWhy, at: Date.now() };
}

// A file in Downloads is checked by download protection and by Defense: one notification about it, not two.
const notifiedFiles = new Map();
function notifyAboutFile(file, title, body, onClick) {
  const key = String(file || '').toLowerCase();
  const now = Date.now();
  for (const [k, at] of notifiedFiles) if (now - at > 60000) notifiedFiles.delete(k);
  if (key && notifiedFiles.has(key)) return;
  if (key) notifiedFiles.set(key, now);
  notify(title, body, onClick);
}

// A notification nothing refers to can be garbage-collected while it is still on screen, and its click then does
// nothing ("Put it back" among them). Each is kept until it is clicked or closed, ten minutes at most.
const shownNotes = new Set();
function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON });
  shownNotes.add(n);
  const release = () => shownNotes.delete(n);
  setTimeout(release, 10 * 60 * 1000).unref();
  n.on('close', release);
  n.on('failed', release);
  n.on('click', () => { release(); if (onClick) onClick(); });
  n.show();
}

/* ---------------------------------------------------------------- bridge */

/** Every IPC call must come from Sentinel's own page in our own window. */
function trusted(event) {
  try {
    return Boolean(ORIGIN) && event.senderFrame && new URL(event.senderFrame.url).origin === ORIGIN
      && BrowserWindow.fromWebContents(event.sender) === win;
  } catch {
    return false;
  }
}

/** The app's own loading and error pages, served from disk. */
function trustedLocal(event) {
  try {
    const from = BrowserWindow.fromWebContents(event.sender);
    return event.senderFrame && event.senderFrame.url.startsWith(PAGES) && (from === win || (warnWin && from === warnWin) || (guardWin && from === guardWin));
  } catch {
    return false;
  }
}

function handle(channel, fn, check = trusted) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!check(event)) throw new Error('Not allowed');
    return fn(...args);
  });
}

function registerBridge() {
  handle('sentinel:info', () => ({
    version: app.getVersion(),
    origin: ORIGIN,
    embeddedServer: Boolean(server.port),
    openAtLogin: store.get('openAtLogin', true),
    clipboardCheck: store.get('clipboardCheck', false),
    commandShield: process.platform === 'win32' && store.get('commandShield', true),
    commandHeld: clipwatch.heldCommand(),
    walletGuard: process.platform === 'win32' && store.get('walletGuard', true),
    snip: snipStatus(),
    scanMenu: scanMenuStatus(),
    exposureAlerts: store.get('exposureAlerts', false),
    mySites: store.get('mySites', true),
    weekRecap: store.get('weekRecap', false),
    pairedUserId: store.getSecret('token') ? store.get('pairedUserId', null) : null,
    downloads: downloads.status(),
    live: { ...watch.status(), enabled: store.get('liveScanning', false) },
    chatSafety: chatSafetyStatus(),
    parentLock: lock.status(),
    remoteGuard: remoteGuardStatus(),
    textSafety: textSafetyStatus(),
    liveMode: store.get('liveMode', 'fast'),
    autoScan: store.get('autoScan', false),
    defense: { ...defense.status(), enabled: store.get('defense', true) },
    deviceProtection: Boolean(store.getSecret('deviceToken')) && !store.getSecret('token'),
    browsers: browserState,
    update: updater.status(),
    platform: process.platform
  }));


  handle('sentinel:chat-safety', (enabled) => { lock.guard('chat safety off', !enabled); return setChatSafety(Boolean(enabled)); });
  handle('sentinel:set-remote-guard', (enabled) => { lock.guard('the tech-support scam shield off', !enabled); store.set('remoteGuard', Boolean(enabled)); if (!enabled) closeGuard(); return remoteGuardStatus(); });
  handle('sentinel:forget-trusted-remote', () => { store.set('remoteTrusted', []); return remoteGuardStatus(); });
  handle('sentinel:text-safety', (enabled) => { lock.guard('Check my texts off', !enabled); return setTextSafety(Boolean(enabled)); });
  handle('sentinel:live-start', () => { setAutoSession(false); return startScanning(); });
  handle('sentinel:live-stop', () => { lock.guard('live scanning off', true); return setLiveScanning(false, { byPerson: true }); });
  handle('sentinel:auto-scan', (enabled) => { lock.guard('auto scanning off', !enabled); return setAutoScan(Boolean(enabled)); });

  // Parent lock. Setting, changing or removing the PIN needs the lock open (or no PIN yet); a forgotten PIN is
  // removed only with a Windows administrator's approval, asked for by Windows itself.
  let relockTimer = null;
  handle('sentinel:lock-status', () => lockStatus());
  handle('sentinel:lock-set', (pin) => { lock.set(String(pin)); lockChanged(); return lockStatus(); });
  handle('sentinel:lock-unlock', (pin) => {
    lock.unlock(String(pin));
    refreshTray();
    clearTimeout(relockTimer);
    relockTimer = setTimeout(refreshTray, parentlock.UNLOCK_MS + 500);
    return lockStatus();
  });
  handle('sentinel:lock-relock', () => { lock.relock(); refreshTray(); return lockStatus(); });
  handle('sentinel:lock-remove', () => { lock.remove(); lockChanged(); return lockStatus(); });
  handle('sentinel:lock-reset', async () => {
    if (process.platform !== 'win32' || !lock.isSet()) return lockStatus();
    // Windows shows its own administrator prompt; cancelled or refused, nothing changes.
    const r = await runPowerShell("try { Start-Process -FilePath cmd.exe -ArgumentList '/c','exit' -Verb RunAs -WindowStyle Hidden -Wait -ErrorAction Stop; 'yes' } catch { 'no' }", 5 * 60 * 1000);
    if (!r.ok || r.out !== 'yes') throw new Error('Windows did not approve it, so the PIN was kept.');
    lock.reset();
    lockChanged();
    return lockStatus();
  });
  handle('sentinel:live-mode', (mode) => {
    store.set('liveMode', mode === 'delicate' ? 'delicate' : 'fast');
    refreshTray();
    return { ...watch.status(), enabled: store.get('liveScanning', false) };
  });
  handle('sentinel:scan-with', (id) => {
    if (typeof id !== 'string' || !browsers.BROWSERS.some((b) => b.id === id)) throw new Error('Unknown browser');
    return scanWith(id);
  });

  handle('sentinel:checkup', () => runCheckup());
  // "Open <browser>" beside a finding: brings it to the front, where the person removes what they choose.
  handle('sentinel:checkup-open', (id) => {
    if (typeof id !== 'string' || !browsers.BROWSERS.some((b) => b.id === id)) throw new Error('Unknown browser');
    return browsers.bringForward(id, { raise: watch.raise });
  });
  handle('sentinel:check-updates', () => updater.check());
  handle('sentinel:defense', () => ({ ...defense.status(), enabled: store.get('defense', true), ledger: defense.ledger() }));
  handle('sentinel:set-clipboard-check', (enabled) => { lock.guard('checking copied links off', !enabled); return setClipboardCheck(Boolean(enabled)); });
  handle('sentinel:set-wallet-guard', (enabled) => { lock.guard('wallet guard off', !enabled); return setWalletGuard(Boolean(enabled)); });
  // Not behind the parent lock: turning it off takes no protection away that was not asked for each time.
  handle('sentinel:set-snip', (enabled, key) => {
    store.set('snipCheck', Boolean(enabled));
    if (snip.KEYS[key]) store.set('snipKey', key);
    return syncSnip();
  });
  // Not behind the parent lock either: like the screen check, it only scans what the person picks, when they pick it.
  handle('sentinel:set-scan-menu', (enabled) => setScanMenu(Boolean(enabled)));
  handle('sentinel:take-menu-file', () => takeMenuFile());
  handle('sentinel:set-command-shield', (enabled) => { lock.guard('Stop pasted commands off', !enabled); return setCommandShield(Boolean(enabled)); });
  handle('sentinel:command-put-back', () => putBackCommand());
  handle('sentinel:set-defense', (enabled) => { lock.guard('defense off', !enabled); store.set('defense', Boolean(enabled)); if (enabled) defense.restart(); else defense.stop('Turned off'); return { ...defense.status(), enabled: Boolean(enabled) }; });
  handle('sentinel:set-exposure-alerts', (enabled) => { lock.guard('exposure alerts off', !enabled); return setExposureAlerts(Boolean(enabled)); });
  handle('sentinel:set-my-sites', (enabled) => { lock.guard('Your sites off', !enabled); return setMySites(Boolean(enabled)); });
  handle('sentinel:my-sites', async () => (ORIGIN && store.get('mySites', true) ? (await apiCall('/api/v1/my-sites')).items || [] : []));
  handle('sentinel:my-sites-add', async (host) => (await apiCall('/api/v1/my-sites/add', { host: String(host).slice(0, 300) })).items);
  handle('sentinel:my-sites-remove', async (host) => {
    lock.guard(`${String(host).slice(0, 253)} off Your sites`, true, ['take', 'Took']);
    return (await apiCall('/api/v1/my-sites/remove', { host: String(host).slice(0, 300) })).items;
  });
  handle('sentinel:my-sites-forget', async () => {
    lock.guard('every site off Your sites', true, ['take', 'Took']);
    store.set('mySitesForgetPending', true);
    return { erased: await forgetMySites() };
  });
  handle('sentinel:exposures', async () => (ORIGIN ? (await apiCall('/api/v1/live/exposures')).items || [] : []));
  handle('sentinel:exposure-dismiss', async (host) => (await apiCall('/api/v1/live/exposures/dismiss', { host: String(host).slice(0, 253) })).ok);
  handle('sentinel:exposure-downloads', (day) => checkDownloadsFrom(day));
  handle('sentinel:defense-restore', (id) => { lock.guard('a quarantined file back', true, ['put', 'Put']); return defense.restore(String(id)); });
  handle('sentinel:defense-act', async (id) => { const r = await defense.act(String(id)); if (r.quarantined) tally('files_quarantined'); return r; });
  handle('sentinel:set-week-recap', (enabled) => setWeekRecap(Boolean(enabled)));
  // The week as the app's own account has it, with what the app counted since the last hand-over handed over first.
  handle('sentinel:week', async () => { await flushWeek(); return apiCall('/api/v1/week'); });
  handle('sentinel:install-update', () => updater.install());
  // The text of an email screenshot, read on this computer by Windows (ocr.js); the images are not kept.
  handle('sentinel:read-screenshot', (images) => require('./ocr').read(Array.isArray(images) ? images : []));
  // Switch to a chosen model (a released version): downloaded from GitHub and checked there, never from the page.
  // An older model may not have chat safety at all: choosing one is switching protection off, as far as the lock goes.
  handle('sentinel:install-model', (version) => {
    lock.guard('to another Sentinel version', true);
    return models.install({
      version: String(version), dir: path.join(updater.cacheDir(), 'models'), updater, store, log: appLog,
      onProgress: (progress) => push('sentinel:update', { ...updater.status(), status: 'switching', version: String(version), progress })
    });
  });

  handle('sentinel:set-token', (token, userId) => {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw new Error('Invalid token');
    if (typeof userId !== 'string' || !/^usr_[a-f0-9]{24}$/.test(userId)) throw new Error('Invalid account');
    // Another account may have a smaller plan (no Pro download protection, fewer live minutes).
    lock.guard('to another account', Boolean(store.getSecret('token')) && store.get('pairedUserId', null) !== userId);
    store.setSecret('token', token);
    store.set('pairedUserId', userId);
    downloads.restart();
    watch.restart();
    refreshTray();
    return { ok: true };
  });

  handle('sentinel:clear-token', () => {
    lock.guard('to this computer\'s own account', Boolean(store.getSecret('token')));
    store.setSecret('token', null);
    store.set('pairedUserId', null);
    // Protection carries on under this computer's own account.
    downloads.restart();
    watch.restart();
    refreshTray();
    return { ok: true };
  });

  handle('sentinel:set-download-protection', (enabled) => {
    lock.guard('download protection off', !enabled);
    store.set('downloadProtection', Boolean(enabled));
    if (enabled) downloads.restart(); else downloads.stop('Turned off');
    refreshTray();
    return downloads.status();
  });

  handle('sentinel:set-open-at-login', (enabled) => { lock.guard('starting with the computer off', !enabled); setOpenAtLogin(Boolean(enabled)); return { ok: true }; });

  handle('sentinel:recent-downloads', () => downloads.recent());

  handle('sentinel:quarantine', async (id) => { const r = await downloads.quarantine(String(id)); tally('files_quarantined'); return r; });

  handle('sentinel:retry-server', () => { retryCount = 0; boot(); return { ok: true }; }, trustedLocal);
  handle('sentinel:open-logs', () => { shell.showItemInFolder(server.logPath()); return { ok: true }; }, trustedLocal);
  handle('sentinel:quit', () => { lock.guard('Sentinel off', true); quitting = true; app.quit(); return { ok: true }; }, trustedLocal);
  handle('sentinel:warn-action', (action, url) => {
    if (warnWin && !warnWin.isDestroyed()) warnWin.close();
    if (action === 'open' && typeof url === 'string' && /^https?:\/\//.test(url) && url.length < 2000) showWindow(`/app/scan?url=${encodeURIComponent(url)}`);
    if (action === 'recover') showWindow(recoverRoute(url, 'password'));
    return { ok: true };
  }, trustedLocal);
  handle('sentinel:guard-action', (action, arg) => guardAction(String(action), String(arg || '')), trustedLocal);
}

/* --------------------------------------------------------------- startup */

/**
 * Decide where the web app comes from, bring it up, then load it. A hosted
 * Sentinel (SENTINEL_ORIGIN, the dev server, or a saved server address) is
 * used as-is; otherwise the bundled server is started on this computer.
 */
async function boot() {
  if (booting) return;
  booting = true;
  clearTimeout(retryTimer);
  // Not "remote": that name is the tech-support scam shield (remoteguard.create()), which onVerdict below calls.
  const serverOrigin = process.env.SENTINEL_ORIGIN || (DEV ? 'http://localhost:8787' : store.get('serverOrigin', null));
  if (win) win.loadFile(path.join(__dirname, 'pages', 'loading.html'));
  appLog(`boot: ${serverOrigin ? `using ${serverOrigin}` : 'starting the embedded scanner'} (app ${app.getVersion()})`);

  try {
    ORIGIN = serverOrigin
      ? serverOrigin.replace(/\/$/, '')
      : await server.start(store, {
        onDown: (reason) => showError(reason),
        onRestart: (origin) => { ORIGIN = origin; if (win && win.isVisible()) openApp(); }
      });
  } catch (err) {
    booting = false;
    showError(err.message);
    return;
  }
  booting = false;
  retryCount = 0;
  appLog(`boot: scanner ready at ${ORIGIN}`);

  // Background protection needs an identity even before anyone has an account, so
  // the embedded server issues this computer its own. That token is ONLY for the
  // background services. It never signs the app window in and never replaces a
  // person's session: whoever signs in here stays signed in as themselves.
  embedded = !serverOrigin;
  if (!serverOrigin) {
    // Older builds kept the device token where the person's pairing belongs.
    if (store.get('deviceAccount')) {
      try {
        const me = await apiCall('/api/v1/auth/me');
        if (me.user && me.user.email === 'this-computer@sentinel.local') {
          store.setSecret('deviceToken', store.getSecret('token'));
          store.setSecret('token', null);
          store.set('pairedUserId', null);
        }
      } catch { /* that token is dead; a fresh device token is issued below */ }
      store.set('deviceAccount', undefined);
    }
    if (!store.getSecret('deviceToken')) await requestDeviceToken();
    // An older build also put the device token in the window's cookie jar. Take it out.
    try {
      const jar = session.defaultSession.cookies;
      for (const c of await jar.get({ url: ORIGIN, name: 'sentinel_session' })) {
        if (c.value === store.getSecret('deviceToken')) await jar.remove(ORIGIN, 'sentinel_session');
      }
    } catch { /* nothing to clean */ }
  }

  defense.init({
    api: apiCall,
    downloads: app.getPath('downloads'),
    desktop: app.getPath('desktop'),
    quarantineDir: path.join(app.getPath('userData'), 'quarantine'),
    dataDir: app.getPath('userData'),
    selfDir: path.dirname(process.execPath),
    enabled: () => store.get('defense', true),
    onChange: () => { refreshTray(); push('sentinel:defense', defense.status()); },
    onChecked: (item) => fileChecked(item.path),
    onThreat: (item) => {
      if (item.quarantined) tally('files_quarantined');
      const did = item.actions.map((a) => a.did).filter((d, i, arr) => arr.indexOf(d) === i).join(', ');
      if (item.suspect) notify('Sentinel: a startup program looks suspicious', `${item.name}\nNothing was changed. Open Sentinel to quarantine it if you do not recognise it.`, () => showWindow('/app/protection'));
      else notifyAboutFile(item.path, `Sentinel stopped ${item.label}`, `${item.name}\n${did || 'Flagged'}`, () => showWindow('/app/protection'));
      push('sentinel:defense-threat', item);
    }
  });

  downloads.init({
    origin: ORIGIN,
    api: apiCall,
    folder: app.getPath('downloads'),
    quarantineDir: path.join(app.getPath('userData'), 'quarantine'),
    getToken: () => activeToken(),
    enabled: () => store.get('downloadProtection', true),
    // A program named for a product but from another site: its maker's signature still vouches for it.
    signedBy: (file) => defense.signedBy(file),
    log: appLog,
    onChange: refreshTray,
    onChecked: (item) => fileChecked(item.path),
    onThreat: (item) => {
      // To the list of recent downloads, where the file's Quarantine button is (not the file scanner's drop zone).
      notifyAboutFile(item.path, `Sentinel: ${item.label}`, `${item.name}\n${item.reason}`, () => showWindow('/app/protection#downloads'));
      push('sentinel:download-threat', item);
    }
  });

  if (!app.isPackaged && process.env.SENTINEL_OVERLAY_DRYRUN) overlay.setDryRun((text) => appLog(`overlay (dry run): ${text}`));

  // Chat safety (Roblox and the Discord app) and texts in Phone Link: each off until turned on in Live protection;
  // nothing about a chat or a text is logged.
  if (!app.isPackaged && process.env.SENTINEL_OVERLAY_DRYRUN) chatoverlay.setDryRun((text) => appLog(`chat overlay (dry run): ${text}`));
  if (store.get('chatSafety', false) || store.get('textSafety', false)) startChatSafety();

  watch.init({
    origin: ORIGIN,
    api: apiCall,
    getToken: () => activeToken(),
    enabled: () => store.get('liveScanning', false),
    // Exposure alerts: clean pages are remembered (as keyed hashes, 14 days) only while this is switched on.
    remember: () => store.get('exposureAlerts', false),
    // Your sites: clean pages count towards learning the sites the person uses, unless switched off.
    learn: () => store.get('mySites', true),
    // Auto scanning starts fast scanning; scanning the person started uses the mode they chose.
    mode: () => (autoSession ? 'fast' : store.get('liveMode', 'fast')),
    // The reader's helper types are compiled once into here and loaded from then on.
    helperDll: path.join(app.getPath('userData'), 'reader-helper-2.dll'),
    // Development runs only: never honoured by an installed build.
    testProcess: app.isPackaged ? null : process.env.SENTINEL_TEST_PROCESS,
    onFront: (name) => offerChatSafety(name),
    onChange: (s) => { refreshTray(); push('sentinel:live', { ...s, enabled: store.get('liveScanning', false) }); },
    // The browser in front (or none): the overlay follows it, and leaves with it.
    onWindow: (rect) => {
      overlay.setWindow(rect);
      if (rect) watch.keepAbove(overlay.handle());
      if (rect) offerEscape();
      // A warning about a dangerous page stays on top only while a browser is in front: switch to a game or any other
      // program and it waits behind it like an ordinary window, instead of floating over everything.
      if (warnWin && !warnWin.isDestroyed()) warnWin.setAlwaysOnTop(Boolean(rect));
      if (rect && sweepOnNextWindow) { sweepOnNextWindow = false; overlay.sweep('start'); }
      // Tell the tray and the app only when a browser arrives or leaves, not every time its window moves.
      if (Boolean(rect) !== watchingWindow) {
        watchingWindow = Boolean(rect);
        refreshTray();
        push('sentinel:live', { ...watch.status(), enabled: store.get('liveScanning', false) });
      }
    },
    // A new page: last page's verdict and marks are gone; a search gets the gold line.
    onPage: (page) => {
      pageInFront = null;
      overlay.setVerdict(null);
      overlay.setPay(null);
      overlay.setMarks({ marks: [] });
      // A new page: an escape still on offer was for the page before. If that page comes back, it is offered again.
      badPage = null;
      if (guardMode === 'escape' && escapeKey(page) !== escapeOfferedFor) { closeGuard(); escapeOfferedFor = null; }
      checkMoneyPage(page);
      // Delicate scanning (the person's choice, not auto scanning's fast) digs into the results in binary.
      if (page && page.search) overlay.sweep('search', { binary: !autoSession && store.get('liveMode', 'fast') === 'delicate' });
    },
    onVerdict: (v) => {
      let host = null;
      try { host = v.page.private ? null : new URL(v.page.url).hostname; } catch { /* no address */ }
      if (!v.page.search) pageInFront = { host, badge: v.badge || null, at: Date.now() };
      overlay.setVerdict({ badge: v.badge, label: v.label, kind: v.kind });
      // A fake virus alert, or any page flagged orange or red: both moments of the shield start from here.
      if (v.support || v.badge === 'orange' || v.badge === 'red') {
        badPage = { key: escapeKey(v.page), browser: v.page.browser, support: Boolean(v.support) };
        remote.flaggedPage();
        offerEscape();
      }
    },
    // Before you pay: a shop's checkout whose address is young or unknown (server/lib/scan/paycheck.js).
    onPay: (pay) => overlay.setPay(pay ? pay.text : null),
    onTyped: (t) => askTyped(t),
    onMarks: (m) => overlay.setMarks(m),
    onShift: (s) => overlay.shift(s),
    onWheel: (w) => overlay.wheel(w),
    onPixels: (p) => overlay.pixels(p),
    onLog: (text) => appendLog('watch.log', `${new Date().toISOString()} # ${text}`),
    // A short on-disk trail of what live scanning checked, for the person to read. Private windows never reach here.
    onChecked: (item) => {
      push('sentinel:page-checked', { ...item, browser: browserName(item.browser) });
      appendLog('watch.log', `${new Date(item.at).toISOString()} ${item.browser} ${item.badge || 'clean'} ${item.label} ${item.url}`, 512 * 1024);
    },
    onThreat: (item) => {
      const first = item.verdict.reasons && item.verdict.reasons[0];
      // A private window is warned like any other, and nothing about it is kept: the notification (which
      // Windows stores in its notification centre) names no site, and the app's lists are not told.
      notify(`Sentinel: ${item.verdict.overall.label}`, `${item.private ? 'The page in your private window' : item.host}\n${first ? first.text : 'Leave this site.'}`, () => showWarning(item));
      showWarning(item);
      if (!item.private) push('sentinel:page-threat', { browser: browserName(item.browser), host: item.host, url: item.url, label: item.verdict.overall.label, badge: item.verdict.overall.badge, at: Date.now() });
    }
  });

  if (!browserWatcher) {
    browserWatcher = browsers.watch({
      // Which browsers are open is shown in the app. It is never a notification:
      // a browser running somewhere in the background is not an event.
      onChange: (s) => { browserState = s; refreshTray(); push('sentinel:browsers', s); autoScanFollow(s.running).catch(() => {}); },
      // The same helper looks for remote-control programs (the tech-support scam shield): no extra process.
      others: { names: remoteguard.PROCESS_NAMES, onChange: (names) => remoteSeen(names) },
      // With auto scanning on, a browser that opens is noticed within a few seconds.
      everyMs: () => (store.get('autoScan', false) ? 4000 : 15000)
    });
  }

  step('copied links and commands', () => syncClipboard());
  step('check on screen', () => { snip.init({ api: (pathname, body) => (ORIGIN ? apiCall(pathname, body) : Promise.reject(new Error('scanner not ready'))), log: appLog }); syncSnip(); });
  step('exposure alerts', () => { if (store.get('exposureAlerts', false)) setExposureAlerts(true); else forgetExposures().catch(() => {}); });
  step('your sites', () => { forgetMySites().catch(() => {}); });
  step('your week', () => startWeek());
  step('tray refresh', () => refreshTray());
  // In the tray (started with Windows, or after an update) there is no window until someone opens one.
  if (win) openApp(menuFile ? '/app/threats' : undefined);
}

app.whenReady().then(() => {
  // Deny every browser permission request (microphone, notifications, etc.) from web content. The one exception is
  // the camera alone, for Sentinel's own page in Sentinel's own window: holding a QR code up to it on the link scan.
  // The picture is read in that page and never leaves it.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    try {
      const types = (details && details.mediaTypes) || [];
      const own = Boolean(ORIGIN) && win && wc === win.webContents && new URL((details && details.requestingUrl) || wc.getURL()).origin === ORIGIN;
      callback(permission === 'media' && own && types.length > 0 && types.every((t) => t === 'video'));
    } catch {
      callback(false);
    }
  });

  appLog(`starting Sentinel ${app.getVersion()}${startHidden ? ' (hidden)' : ''}`);
  cpuProfileOnRequest();
  store.init(app.getPath('userData'), safeStorage);
  lock = parentlock.create(store);
  step('parent lock', () => { checkHeartbeat().catch(() => {}); setInterval(() => heartbeat(), 60 * 1000).unref(); });
  // Scanning that auto scanning had started before a restart is still its to switch off.
  autoSession = Boolean(store.get('autoScan', false) && store.get('autoSession', false));
  step('bridge', () => registerBridge());
  step('right-click file', () => askedToScan(process.argv));
  // Started in the tray, no window is made: a hidden window still loaded the whole app and kept a process for it
  // all day, for someone who may never open it.
  step('window', () => { if (!startHidden) createWindow(); });
  // The scanner starts before anything decorative, and nothing below can stop it.
  boot().catch((err) => { booting = false; showError(String(err && err.message || err)); });

  step('tray', () => buildTray());
  step('updater', () => updater.init({
    store,
    log: appLog,
    onChange: (s) => {
      // One line per change of state, so an update that never arrives can be explained.
      if (s.status !== lastUpdateStatus) { lastUpdateStatus = s.status; appLog(`updater: ${s.status}${s.version ? ` ${s.version}` : ''}${s.error ? ` (${s.error})` : ''}`); }
      refreshTray(); push('sentinel:update', s);
    },
    onReady: (version) => {
      notify(`Sentinel ${version} is ready`, 'It installs by itself while you are not browsing. Click to update now.', () => { updater.install().catch(() => {}); });
      autoInstallSoon();
    }
  }));
  // Updates install themselves (see autoInstallSoon): checked every minute while one is waiting.
  setInterval(() => autoInstallSoon(), 60 * 1000).unref();

  // Installed builds start with the computer by default; development runs never
  // touch the system's startup items.
  // Re-registered on every start, so the entry always points at the copy that is
  // actually installed (an update or a move must not leave it aimed at an old one).
  step('login item', () => { if (app.isPackaged) setOpenAtLogin(store.get('openAtLogin', true)); });
  step('right-click menu', () => { if (app.isPackaged) setScanMenu(store.get('scanMenu', true)); });
  step('background priority', () => {
    stayInBackground();
    // Helpers (the scanner, a window's renderer) start later and restart: lower them too.
    setInterval(stayInBackground, 30000).unref();
    app.on('child-process-gone', () => setTimeout(stayInBackground, 2000));
  });
});

app.on('before-quit', () => { quitting = true; heartbeat(true); snip.close(); globalShortcut.unregisterAll(); clipwatch.stop(); defense.stop(null, true); watch.stop(null, true); overlay.destroy(); if (browserWatcher) browserWatcher.stop(); server.stop(); });
app.on('window-all-closed', (event) => event.preventDefault());
app.on('activate', () => showWindow());

// Refuse to attach webviews or navigate any other contents to foreign origins.
app.on('web-contents-created', (event, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
});
