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
 * - Unlocks the app-only features in the web app through a narrow, validated bridge.
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, Notification, safeStorage, session } = require('electron');
const downloads = require('./downloads');
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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
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
  if (!win) createWindow();
  win.loadFile(path.join(__dirname, 'pages', 'error.html'), { query: { message, log: server.logPath() } });
  win.show();
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
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Sentinel', click: () => showWindow() },
    { type: 'separator' },
    { label: status.active ? 'Download protection: on' : status.reason || 'Download protection: off', enabled: false },
    { label: 'Scan a file...', click: () => showWindow('/app/threats') },
    { type: 'separator' },
    { label: 'Start with my computer', type: 'checkbox', checked: store.get('openAtLogin', true), click: (item) => setOpenAtLogin(item.checked) },
    { label: 'Open log folder', click: () => shell.showItemInFolder(server.logPath()) },
    { type: 'separator' },
    { label: 'Quit Sentinel', click: () => { quitting = true; app.quit(); } }
  ]));
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
    return event.senderFrame && event.senderFrame.url.startsWith(PAGES) && BrowserWindow.fromWebContents(event.sender) === win;
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
    platform: process.platform,
    origin: ORIGIN,
    embeddedServer: Boolean(server.port),
    openAtLogin: store.get('openAtLogin', true),
    pairedUserId: store.getSecret('token') ? store.get('pairedUserId', null) : null,
    downloads: downloads.status(),
    companionPath: path.join(process.resourcesPath || '', 'companion')
  }));

  handle('sentinel:set-token', (token, userId) => {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw new Error('Invalid token');
    if (typeof userId !== 'string' || !/^usr_[a-f0-9]{24}$/.test(userId)) throw new Error('Invalid account');
    store.setSecret('token', token);
    store.set('pairedUserId', userId);
    downloads.restart();
    refreshTray();
    return { ok: true };
  });

  handle('sentinel:clear-token', () => {
    store.setSecret('token', null);
    store.set('pairedUserId', null);
    downloads.stop('Signed out');
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

  handle('sentinel:open-companion-folder', () => {
    const folder = app.isPackaged ? path.join(process.resourcesPath, 'companion') : path.join(__dirname, '..', '..', 'extension');
    shell.openPath(folder);
    return { ok: true, folder };
  });

  // Only the app's own error page may ask for these.
  handle('sentinel:retry-server', () => { boot(); return { ok: true }; }, trustedLocal);
  handle('sentinel:open-logs', () => { shell.showItemInFolder(server.logPath()); return { ok: true }; }, trustedLocal);
  handle('sentinel:quit', () => { quitting = true; app.quit(); return { ok: true }; }, trustedLocal);
}

/* --------------------------------------------------------------- startup */

/**
 * Decide where the web app comes from, bring it up, then load it. A hosted
 * Sentinel (SENTINEL_ORIGIN, the dev server, or a saved server address) is
 * used as-is; otherwise the bundled server is started on this computer.
 */
async function boot() {
  const remote = process.env.SENTINEL_ORIGIN || (DEV ? 'http://localhost:8787' : store.get('serverOrigin', null));
  if (win) win.loadFile(path.join(__dirname, 'pages', 'loading.html'));

  try {
    ORIGIN = remote
      ? remote.replace(/\/$/, '')
      : await server.start(store, {
        onDown: (reason) => showError(reason),
        onRestart: (origin) => { ORIGIN = origin; if (win && win.isVisible()) openApp(); }
      });
  } catch (err) {
    showError(err.message);
    return;
  }

  downloads.init({
    origin: ORIGIN,
    folder: app.getPath('downloads'),
    quarantineDir: path.join(app.getPath('userData'), 'quarantine'),
    getToken: () => store.getSecret('token'),
    enabled: () => store.get('downloadProtection', true),
    onChange: refreshTray,
    onThreat: (item) => {
      notify(`Sentinel: ${item.label}`, `${item.name}\n${item.reason}`, () => showWindow('/app/threats'));
      if (win) win.webContents.send('sentinel:download-threat', item);
    }
  });
  refreshTray();
  openApp();
}

app.whenReady().then(() => {
  // Deny every browser permission request (camera, notifications, etc.) from web content.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(false));

  store.init(app.getPath('userData'), safeStorage);
  registerBridge();
  createWindow();
  buildTray();

  // Installed builds start with the computer by default; development runs never
  // touch the system's startup items.
  if (app.isPackaged && store.get('openAtLogin') === undefined) setOpenAtLogin(true);

  boot();
});

app.on('before-quit', () => { quitting = true; server.stop(); });
app.on('window-all-closed', (event) => event.preventDefault());
app.on('activate', () => showWindow());

// Refuse to attach webviews or navigate any other contents to foreign origins.
app.on('web-contents-created', (event, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
});
