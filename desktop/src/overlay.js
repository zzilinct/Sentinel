'use strict';
/**
 * What live scanning looks like on screen, with no add-on in the browser.
 *
 * One transparent window that sits exactly over the page area of the browser in
 * front. It draws the gold line and tint when scanning starts and when a search
 * comes back, the gold Sentinel mask in the bottom right corner for as long as
 * Sentinel is watching that browser, and a mask beside every search result.
 *
 * It is never in the way: it cannot take focus, every click and key goes straight
 * through it to the browser, and it is hidden the moment the browser is not the
 * window in front.
 */
const path = require('path');
const { BrowserWindow, screen } = require('electron');

let win = null;
let ready = false;
let queue = [];
let area = null;         // the browser's page area, in physical screen pixels
let scale = 1;           // physical pixels per overlay pixel
let readyTimer = null;
let showingReady = false;
let dryRun = null;       // development only: compute everything, show nothing, and say what would have been drawn

function send(channel, payload) {
  if (dryRun && channel !== 'overlay:marks') dryRun(`${channel} ${JSON.stringify(payload || {})}`);
  if (!win || win.isDestroyed()) return;
  if (!ready) { queue.push([channel, payload]); return; }
  win.webContents.send(channel, payload);
}

function ensure() {
  if (win && !win.isDestroyed()) return win;
  ready = false;
  win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    roundedCorners: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  // Every click and key goes through to the browser. Moves are forwarded so a mark can explain itself on hover.
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setMenu(null);
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.once('did-finish-load', () => {
    ready = true;
    for (const [channel, payload] of queue) win.webContents.send(channel, payload);
    queue = [];
  });
  win.on('closed', () => { win = null; ready = false; queue = []; });
  win.loadFile(path.join(__dirname, 'pages', 'overlay.html'));
  return win;
}

function placeOver(rect) {
  const w = ensure();
  const dip = screen.screenToDipRect(null, { x: rect.x, y: rect.y, width: rect.w, height: rect.h });
  scale = dip.width > 0 ? rect.w / dip.width : 1;
  w.setBounds({ x: Math.round(dip.x), y: Math.round(dip.y), width: Math.max(1, Math.round(dip.width)), height: Math.max(1, Math.round(dip.height)) });
  if (dryRun) { dryRun(`placed over ${rect.browser}: ${Math.round(dip.width)}x${Math.round(dip.height)} at ${Math.round(dip.x)},${Math.round(dip.y)} (scale ${scale.toFixed(2)})`); return; }
  if (!w.isVisible()) w.showInactive();
}

/** The browser in front, or null when there is none: `{ x, y, w, h, private, browser }` in screen pixels. */
function setWindow(rect) {
  if (showingReady) { area = rect; return; }   // the "ready" sweep owns the screen for a few seconds
  if (!rect) {
    area = null;
    if (win && !win.isDestroyed() && win.isVisible()) win.hide();
    send('overlay:clear');
    return;
  }
  const appeared = !area;
  const moved = area && (area.x !== rect.x || area.y !== rect.y || area.w !== rect.w || area.h !== rect.h);
  area = rect;
  placeOver(rect);
  if (moved) send('overlay:marks', { marks: [] });   // the page moved: old positions are wrong until the next read
  // A page area that fills its whole display is a video or a presentation in fullscreen.
  const display = screen.getDisplayMatching(win.getBounds());
  const b = win.getBounds();
  const fullscreen = b.width >= display.bounds.width && b.height >= display.bounds.height;
  send('overlay:watching', { private: Boolean(rect.private), browser: rect.browser, appeared, fullscreen });
}

/** The gold line and tint over the page in front. */
function sweep(kind) {
  if (!area || showingReady) return;
  send('overlay:sweep', { kind: kind || 'search' });
}

/** "Scanning is ready": the gold line down the whole screen, the tint fading after it. */
function readySweep(nearWindow) {
  const display = nearWindow && !nearWindow.isDestroyed() ? screen.getDisplayMatching(nearWindow.getBounds()) : screen.getPrimaryDisplay();
  const w = ensure();
  showingReady = true;
  w.setBounds(display.bounds);
  if (!dryRun && !w.isVisible()) w.showInactive();
  send('overlay:clear');
  send('overlay:sweep', { kind: 'ready' });
  clearTimeout(readyTimer);
  readyTimer = setTimeout(() => {
    showingReady = false;
    const rect = area;
    area = null;
    if (rect) setWindow(rect); else if (win && !win.isDestroyed()) win.hide();
  }, 3800);
}

/** The verdict on the page in front, shown by the corner mask. */
function setVerdict(v) { send('overlay:verdict', v || { badge: null }); }

/** Marks beside results. Positions arrive in screen pixels and leave relative to the overlay. */
function setMarks({ marks, checking }) {
  if (!area || showingReady) return;
  const local = marks.map((m) => ({
    x: (m.x - area.x) / scale,
    y: (m.y - area.y) / scale,
    w: m.w / scale,
    h: m.h / scale,
    badge: m.badge || null,
    kind: m.kind || 'scam',
    label: m.label || '',
    reason: m.reason || '',
    pending: Boolean(m.pending)
  }));
  if (dryRun && local.length) {
    const inside = local.filter((m) => m.x >= 0 && m.y >= 0 && m.x <= area.w / scale && m.y <= area.h / scale).length;
    dryRun(`marks: ${local.length} (${local.filter((m) => m.badge).length} flagged, ${local.filter((m) => m.pending).length} waiting), ${inside} inside the page area; first at ${Math.round(local[0].x)},${Math.round(local[0].y)}`);
  }
  send('overlay:marks', { marks: local, checking: checking || 0 });
}

function destroy() {
  clearTimeout(readyTimer);
  showingReady = false;
  area = null;
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

module.exports = { setWindow, sweep, readySweep, setVerdict, setMarks, destroy, setDryRun: (logger) => { dryRun = logger || null; } };
