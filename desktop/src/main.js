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
const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, Notification, safeStorage, session } = require('electron');
const downloads = require('./downloads');
const browsers = require('./browsers');
const watch = require('./watch');
const overlay = require('./overlay');
const updater = require('./updater');
const defense = require('./defense');
const store = require('./store');
const server = require('./server');

const DEV = process.argv.includes('--dev');
const ICON = path.join(__dirname, '..', 'assets', 'icon256.png');
const PAGES = pathToFileURL(path.join(__dirname, 'pages') + path.sep).href;

/** Where the Sentinel web app is served from. Set once the server is up. */
let ORIGIN = null;
let win = null;
let tray = null;
let quitting = false;
let warnWin = null;
let booting = false;
let retryTimer = null;
let retryCount = 0;
let lastUpdateStatus = null;
let browserState = { installed: [], running: [] };
let browserWatcher = null;

/**
 * The app's own log (logs/app.log, beside the server's). Every startup stage
 * and every error lands here, so a start that goes wrong always leaves a trace.
 */
function appLog(text) {
  try {
    const fs = require('fs');
    const file = path.join(app.getPath('userData'), 'logs', 'app.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { if (fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, file.replace(/\.log$/, '.previous.log')); } catch { /* no log yet */ }
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${text}\n`);
  } catch { /* logging must never break the app */ }
}
process.on('uncaughtException', (err) => appLog(`uncaught exception: ${err && err.stack || err}`));
process.on('unhandledRejection', (err) => appLog(`unhandled rejection: ${err && err.stack || err}`));

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
  app.on('second-instance', () => { showWindow(); if (!ORIGIN && !booting) boot(); });
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
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });

  // Only Sentinel itself may load inside the app window.
  win.webContents.on('will-navigate', (event, url) => {
    if (!ORIGIN || new URL(url).origin !== ORIGIN) {
      event.preventDefault();
      if (/^https:\/\//.test(url)) shell.openExternal(url);
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
  if (!win) createWindow();
  if (route && ORIGIN) win.loadURL(`${ORIGIN}${route}`);
  win.show();
  win.focus();
}

function showError(message) {
  appLog(`scanner did not start: ${message}`);
  ORIGIN = null;
  // Try again without being asked: 15 s, 30 s, 60 s, then every two minutes.
  const wait = [15, 30, 60][retryCount] || 120;
  retryCount++;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => boot(), wait * 1000);
  if (!win) createWindow();
  win.loadFile(path.join(__dirname, 'pages', 'error.html'), { query: { message, log: server.logPath(), retryIn: String(wait) } });
  // A start that fails while Sentinel is tucked away in the tray should not jump in front of the person.
  if (!process.argv.includes('--hidden') || win.isVisible()) win.show();
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
    warnWin.once('ready-to-show', () => { if (warnWin) { warnWin.show(); warnWin.focus(); } });
    warnWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    warnWin.webContents.on('will-navigate', (e) => e.preventDefault());
  }
  warnWin.loadFile(path.join(__dirname, 'pages', 'warn.html'), { query });
  if (warnWin.isVisible()) warnWin.focus();
}

/* --------------------------------------------------------------- tray */

function buildTray() {
  const image = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', process.platform === 'darwin' ? 'icon16.png' : 'icon32.png'));
  tray = new Tray(image);
  tray.setToolTip(`Sentinel ${app.getVersion()}`);
  tray.on('click', () => showWindow());
  refreshTray();
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
    { type: 'separator' },
    { label: store.get('liveScanning', false) ? 'Stop scanning' : 'Start scanning', enabled: pw.supported, click: () => setLiveScanning(!store.get('liveScanning', false), { sweep: true }) },
    ...(pw.supported && browserState.installed.length ? [{ label: 'Scan with', submenu: browserState.installed.map((b) => ({ label: b.name, click: () => scanWith(b.id).catch((err) => appLog(`scan with ${b.id} failed: ${err.message}`)) })) }] : []),
    { label: 'Start with my computer', type: 'checkbox', checked: store.get('openAtLogin', true), click: (item) => setOpenAtLogin(item.checked) },
    { type: 'separator' },
    up.status === 'ready'
      ? { label: `Restart to update to ${up.version}`, click: () => updater.install() }
      : { label: up.supported ? 'Check for updates' : `Sentinel ${app.getVersion()}`, enabled: up.supported && up.status !== 'checking' && up.status !== 'downloading', click: () => updater.check() },
    { label: 'Open log folder', click: () => shell.showItemInFolder(server.logPath()) },
    { type: 'separator' },
    { label: 'Quit Sentinel', click: () => { quitting = true; app.quit(); } }
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
async function setLiveScanning(enabled, { sweep = false } = {}) {
  store.set('liveScanning', Boolean(enabled));
  if (enabled) {
    await watch.restart();
    if (sweep && watch.status().active) overlay.readySweep(win);
  } else {
    watch.stop();
    overlay.setWindow(null);
  }
  refreshTray();
  return { ...watch.status(), enabled: store.get('liveScanning', false) };
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
  return { ok: true, ...raised, ...status };
}

function setOpenAtLogin(enabled) {
  store.set('openAtLogin', enabled);
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
  refreshTray();
}

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON });
  if (onClick) n.on('click', onClick);
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
    return event.senderFrame && event.senderFrame.url.startsWith(PAGES) && (from === win || (warnWin && from === warnWin));
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
    pairedUserId: store.getSecret('token') ? store.get('pairedUserId', null) : null,
    downloads: downloads.status(),
    live: { ...watch.status(), enabled: store.get('liveScanning', false) },
    liveMode: store.get('liveMode', 'fast'),
    defense: { ...defense.status(), enabled: store.get('defense', true) },
    deviceProtection: Boolean(store.getSecret('deviceToken')) && !store.getSecret('token'),
    browsers: browserState,
    update: updater.status(),
    platform: process.platform
  }));


  handle('sentinel:live-start', () => setLiveScanning(true, { sweep: true }));
  handle('sentinel:live-stop', () => setLiveScanning(false));
  handle('sentinel:live-mode', (mode) => {
    store.set('liveMode', mode === 'delicate' ? 'delicate' : 'fast');
    refreshTray();
    return { ...watch.status(), enabled: store.get('liveScanning', false) };
  });
  handle('sentinel:scan-with', (id) => {
    if (typeof id !== 'string' || !browsers.BROWSERS.some((b) => b.id === id)) throw new Error('Unknown browser');
    return scanWith(id);
  });

  handle('sentinel:check-updates', () => updater.check());
  handle('sentinel:defense', () => ({ ...defense.status(), enabled: store.get('defense', true), ledger: defense.ledger() }));
  handle('sentinel:set-defense', (enabled) => { store.set('defense', Boolean(enabled)); if (enabled) defense.restart(); else defense.stop('Turned off'); return { ...defense.status(), enabled: Boolean(enabled) }; });
  handle('sentinel:defense-restore', (id) => defense.restore(String(id)));
  handle('sentinel:install-update', () => updater.install());

  handle('sentinel:set-token', (token, userId) => {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw new Error('Invalid token');
    if (typeof userId !== 'string' || !/^usr_[a-f0-9]{24}$/.test(userId)) throw new Error('Invalid account');
    store.setSecret('token', token);
    store.set('pairedUserId', userId);
    downloads.restart();
    watch.restart();
    refreshTray();
    return { ok: true };
  });

  handle('sentinel:clear-token', () => {
    store.setSecret('token', null);
    store.set('pairedUserId', null);
    // Protection carries on under this computer's own account.
    downloads.restart();
    watch.restart();
    refreshTray();
    return { ok: true };
  });

  handle('sentinel:set-download-protection', (enabled) => {
    store.set('downloadProtection', Boolean(enabled));
    if (enabled) downloads.restart(); else downloads.stop('Turned off');
    refreshTray();
    return downloads.status();
  });

  handle('sentinel:set-open-at-login', (enabled) => { setOpenAtLogin(Boolean(enabled)); return { ok: true }; });

  handle('sentinel:recent-downloads', () => downloads.recent());

  handle('sentinel:quarantine', (id) => downloads.quarantine(String(id)));

  handle('sentinel:retry-server', () => { retryCount = 0; boot(); return { ok: true }; }, trustedLocal);
  handle('sentinel:open-logs', () => { shell.showItemInFolder(server.logPath()); return { ok: true }; }, trustedLocal);
  handle('sentinel:quit', () => { quitting = true; app.quit(); return { ok: true }; }, trustedLocal);
  handle('sentinel:warn-action', (action, url) => {
    if (warnWin && !warnWin.isDestroyed()) warnWin.close();
    if (action === 'open' && typeof url === 'string' && /^https?:\/\//.test(url) && url.length < 2000) showWindow(`/app/scan?url=${encodeURIComponent(url)}`);
    return { ok: true };
  }, trustedLocal);
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
  const remote = process.env.SENTINEL_ORIGIN || (DEV ? 'http://localhost:8787' : store.get('serverOrigin', null));
  if (win) win.loadFile(path.join(__dirname, 'pages', 'loading.html'));
  appLog(`boot: ${remote ? `using ${remote}` : 'starting the embedded scanner'} (app ${app.getVersion()})`);

  try {
    ORIGIN = remote
      ? remote.replace(/\/$/, '')
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
  embedded = !remote;
  if (!remote) {
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
    quarantineDir: path.join(app.getPath('userData'), 'quarantine'),
    dataDir: app.getPath('userData'),
    selfDir: path.dirname(process.execPath),
    enabled: () => store.get('defense', true),
    onChange: () => { refreshTray(); push('sentinel:defense', defense.status()); },
    onThreat: (item) => {
      const did = item.actions.map((a) => a.did).filter((d, i, arr) => arr.indexOf(d) === i).join(', ');
      notify(`Sentinel stopped ${item.label}`, `${item.name}\n${did || 'Flagged'}`, () => showWindow('/app/protection'));
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
    onChange: refreshTray,
    onThreat: (item) => {
      notify(`Sentinel: ${item.label}`, `${item.name}\n${item.reason}`, () => showWindow('/app/threats'));
      push('sentinel:download-threat', item);
    }
  });

  if (!app.isPackaged && process.env.SENTINEL_OVERLAY_DRYRUN) overlay.setDryRun((text) => appLog(`overlay (dry run): ${text}`));

  watch.init({
    origin: ORIGIN,
    api: apiCall,
    getToken: () => activeToken(),
    enabled: () => store.get('liveScanning', false),
    mode: () => store.get('liveMode', 'fast'),
    // The reader's helper types are compiled once into here and loaded from then on.
    helperDll: path.join(app.getPath('userData'), 'reader-helper-2.dll'),
    // Development runs only: never honoured by an installed build.
    testProcess: app.isPackaged ? null : process.env.SENTINEL_TEST_PROCESS,
    onChange: (s) => { refreshTray(); push('sentinel:live', { ...s, enabled: store.get('liveScanning', false) }); },
    // The browser in front (or none): the overlay follows it, and leaves with it.
    onWindow: (rect) => {
      overlay.setWindow(rect);
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
      overlay.setVerdict(null);
      overlay.setMarks({ marks: [] });
      if (page && page.search) overlay.sweep('search');
    },
    onVerdict: (v) => overlay.setVerdict({ badge: v.badge, label: v.label, kind: v.kind }),
    onMarks: (m) => overlay.setMarks(m),
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
      onChange: (s) => { browserState = s; refreshTray(); push('sentinel:browsers', s); }
    });
  }

  step('tray refresh', () => refreshTray());
  openApp();
}

app.whenReady().then(() => {
  // Deny every browser permission request (camera, notifications, etc.) from web content.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(false));

  appLog(`starting Sentinel ${app.getVersion()}${process.argv.includes('--hidden') ? ' (hidden)' : ''}`);
  store.init(app.getPath('userData'), safeStorage);
  step('bridge', () => registerBridge());
  step('window', () => createWindow());
  // The scanner starts before anything decorative, and nothing below can stop it.
  boot().catch((err) => { booting = false; showError(String(err && err.message || err)); });

  step('tray', () => buildTray());
  step('updater', () => updater.init({
    onChange: (s) => {
      // One line per change of state, so an update that never arrives can be explained.
      if (s.status !== lastUpdateStatus) { lastUpdateStatus = s.status; appLog(`updater: ${s.status}${s.version ? ` ${s.version}` : ''}${s.error ? ` (${s.error})` : ''}`); }
      refreshTray(); push('sentinel:update', s);
    },
    onReady: (version) => notify(`Sentinel ${version} is ready`, 'It installs the next time Sentinel quits. Click to restart and update now.', () => updater.install())
  }));

  // Installed builds start with the computer by default; development runs never
  // touch the system's startup items.
  // Re-registered on every start, so the entry always points at the copy that is
  // actually installed (an update or a move must not leave it aimed at an old one).
  step('login item', () => { if (app.isPackaged) setOpenAtLogin(store.get('openAtLogin', true)); });
});

app.on('before-quit', () => { quitting = true; defense.stop(null, true); watch.stop(null, true); overlay.destroy(); if (browserWatcher) browserWatcher.stop(); server.stop(); });
app.on('window-all-closed', (event) => event.preventDefault());
app.on('activate', () => showWindow());

// Refuse to attach webviews or navigate any other contents to foreign origins.
app.on('web-contents-created', (event, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
});
