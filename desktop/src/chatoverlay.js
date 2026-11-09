'use strict';
/**
 * What chat safety looks like: a transparent window over Roblox, the Discord app or Phone Link while it is in front, with the
 * Sentinel badge (so it is plain that chat is being watched) and a warning beside a suspicious message.
 *
 * It is never in the way: it cannot take focus, every key and every click outside a warning card goes through it, and
 * it hides the moment the app is not in front. In a Roblox game the badge shows only with the Esc menu open; warnings
 * sit small, by the chat box.
 *
 * A warning card can be answered (its close, "This is wrong"): while one shows, the window's shape is only its cards
 * (setShape, the window region Windows hit-tests by), so a click on a card reaches it and a click anywhere else still
 * lands in the app below. No mouse hook and no polling: nothing runs while the pointer moves.
 */
const path = require('path');
const { BrowserWindow, screen, ipcMain } = require('electron');

let win = null;
let ready = false;
let last = null;
let scale = 1;
let dryRun = null;
let answered = null;   // main.js: what to do with a card's answer
let shaped = '';       // the cards' boxes the window's shape was last set to, as text; '' when it takes no click

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
  // Left out of screen copies, so its own cards never end up in what the text recogniser reads (Phone Link, Roblox).
  win.setContentProtection(true);
  win.setMenu(null);
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.once('did-finish-load', () => { ready = true; if (last) win.webContents.send('chat:state', last); });
  win.on('closed', () => { win = null; ready = false; shaped = ''; });
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
    if (win && !win.isDestroyed() && win.isVisible()) { shape([]); win.hide(); }
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
    canMute: state.canMute !== false,
    flags: (state.flags || []).slice(0, 6).map((f) => ({ n: f.n, level: f.level, family: f.family, title: f.title, detail: f.detail, advice: f.advice, rect: local(f.rect) }))
  };
  if (dryRun) { dryRun(`${last.app}: badge ${last.indicator ? 'on' : 'off'}, ${last.flags.length} warning(s)`); return; }
  const wnd = ensure();
  wnd.setBounds({ x: Math.round(dip.x), y: Math.round(dip.y), width: Math.max(1, Math.round(dip.width)), height: Math.max(1, Math.round(dip.height)) });
  if (!wnd.isVisible()) wnd.showInactive();
  if (ready) wnd.webContents.send('chat:state', last);
}

/**
 * The cards' boxes, from the page once they are laid out (page pixels, the window's own): the only part of the window
 * that takes the pointer. None: the whole window lets every click through again, as it does when nothing is flagged.
 */
function shape(rects) {
  if (!win || win.isDestroyed()) return;
  const b = win.getContentBounds();
  const r = (Array.isArray(rects) ? rects : []).slice(0, 6).map((q) => {
    const x = Math.max(0, Math.round(Number(q && q.x) || 0)), y = Math.max(0, Math.round(Number(q && q.y) || 0));
    return { x, y, width: Math.max(0, Math.min(b.width - x, Math.round(Number(q && q.w) || 0))), height: Math.max(0, Math.min(b.height - y, Math.round(Number(q && q.h) || 0))) };
  }).filter((q) => q.width > 0 && q.height > 0);
  const key = JSON.stringify(r);
  if (key === (shaped || '[]')) return;
  if (!r.length) {
    // First the pointer, then the shape: the whole window is never a wall, not even for a moment.
    shaped = '';
    win.setIgnoreMouseEvents(true);
    win.setShape([]);
    return;
  }
  // First the shape, then the pointer, for the same reason.
  win.setShape(r);
  if (!shaped) win.setIgnoreMouseEvents(false);
  shaped = key;
}

ipcMain.on('chat:shape', (event, rects) => { if (win && !win.isDestroyed() && event.sender === win.webContents) shape(rects); });
ipcMain.handle('chat:answer', async (event, n, action) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents || !answered) return { ok: false };
  if (!Number.isInteger(n) || (action !== 'hide' && action !== 'wrong')) return { ok: false };
  return answered(n, action);
});

function destroy() { if (win && !win.isDestroyed()) win.destroy(); win = null; last = null; shaped = ''; }

module.exports = { show, destroy, onAnswer: (fn) => { answered = fn; }, setDryRun: (logger) => { dryRun = logger || null; } };
