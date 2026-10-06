'use strict';
/**
 * What chat safety looks like: a transparent window over Roblox, the Discord app or Phone Link while it is in front, with the
 * Sentinel badge (so it is plain that chat is being watched) and a warning beside a suspicious message.
 *
 * It is never in the way: it cannot take focus, every click and key goes through it, and it hides the moment the app
 * is not in front. In a Roblox game the badge shows only with the Esc menu open; warnings sit small, by the chat box.
 */
const path = require('path');
const { BrowserWindow, screen } = require('electron');

let win = null;
let ready = false;
let last = null;
let scale = 1;
let dryRun = null;

function ensure() {
  if (win && !win.isDestroyed()) return win;
  ready = false;
  win = new BrowserWindow({
    show: false, type: 'toolbar', title: 'Sentinel', frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, focusable: false,
    skipTaskbar: true, hasShadow: false, roundedCorners: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'chat-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false }
  });
  win.setIgnoreMouseEvents(true);
  win.setMenu(null);
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.once('did-finish-load', () => { ready = true; if (last) win.webContents.send('chat:state', last); });
  win.on('closed', () => { win = null; ready = false; });
  win.loadFile(path.join(__dirname, 'pages', 'chat.html'));
  return win;
}

/**
 * The state from chatwatch: { app: null } when neither app is in front; otherwise the app's client area (`win`, screen
 * pixels [x, y, w, h]), whether the badge shows, the chat box (Roblox), and the flagged messages with where they are.
 */
function show(state) {
  if (!state || !state.app || !state.win) {
    last = null;
    if (win && !win.isDestroyed() && win.isVisible()) win.hide();
    return;
  }
  const [x, y, w, h] = state.win;
  const dip = screen.screenToDipRect(null, { x, y, width: w, height: h });
  scale = dip.width > 0 ? w / dip.width : 1;
  // Positions sent to the page are in its own pixels, relative to the app's window.
  const local = (r) => r && ({ x: (r.x - x) / scale, y: (r.y - y) / scale, w: r.w / scale, h: r.h / scale });
  last = {
    app: state.app,
    indicator: Boolean(state.indicator),
    reading: state.reading !== false,
    inGame: Boolean(state.inGame),
    area: state.area ? local({ x: state.area[0], y: state.area[1], w: state.area[2], h: state.area[3] }) : null,
    flags: (state.flags || []).slice(0, 6).map((f) => ({ level: f.level, family: f.family, title: f.title, detail: f.detail, advice: f.advice, rect: local(f.rect) }))
  };
  if (dryRun) { dryRun(`${last.app}: badge ${last.indicator ? 'on' : 'off'}, ${last.flags.length} warning(s)`); return; }
  const wnd = ensure();
  wnd.setBounds({ x: Math.round(dip.x), y: Math.round(dip.y), width: Math.max(1, Math.round(dip.width)), height: Math.max(1, Math.round(dip.height)) });
  if (!wnd.isVisible()) wnd.showInactive();
  if (ready) wnd.webContents.send('chat:state', last);
}

function destroy() { if (win && !win.isDestroyed()) win.destroy(); win = null; last = null; }

module.exports = { show, destroy, setDryRun: (logger) => { dryRun = logger || null; } };
