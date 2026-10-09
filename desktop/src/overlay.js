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
    // A tool window: never a taskbar button, never in Alt+Tab. Without this the overlay showed up in the taskbar
    // as a second, icon-less program whenever scanning was on.
    type: 'toolbar',
    icon: path.join(__dirname, '..', 'assets', 'icon256.png'),
    title: 'Sentinel',
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
    // Not always on top: the reader keeps this window directly above the browser (watch.keepAbove), so the
    // browser's menus and anything opened over the browser cover the marks, the way they cover the page.
    alwaysOnTop: false,
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  // Every click and key goes through to the browser. Moves are forwarded so a mark can explain itself on hover.
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setSkipTaskbar(true);
  win.setMenu(null);
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.once('did-finish-load', () => {
    ready = true;
    for (const [channel, payload] of queue) win.webContents.send(channel, payload);
    queue = [];
  });
  win.on('closed', () => { win = null; ready = false; queue = []; });
  // The end-to-end run on a GitHub desktop (scripts/live-e2e.ps1) asks for a frame-by-frame trace of how the marks
  // moved, to measure smoothness; nobody else sets this.
  const trace = process.env.SENTINEL_OVERLAY_TRACE;
  if (trace) {
    win.webContents.on('console-message', (...args) => {
      const message = typeof args[0] === 'object' && args[0] && 'message' in args[0] ? args[0].message : args[2];
      if (/^[FRM] /.test(String(message))) { try { require('fs').appendFileSync(trace, `${message}\n`); } catch { /* best effort */ } }
    });
  }
  win.loadFile(path.join(__dirname, 'pages', 'overlay.html'), trace ? { query: { trace: '1' } } : undefined);
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
let pageFullscreen = false;
/** Does the page in front fill its whole display (a video, or a page that has taken the screen)? */
function isFullscreen() { return Boolean(area) && pageFullscreen; }

function setWindow(rect) {
  if (!rect) {
    area = null;
    pageFullscreen = false;
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
  pageFullscreen = fullscreen;
  send('overlay:watching', { private: Boolean(rect.private), browser: rect.browser, appeared, fullscreen });
}

/** The gold line and tint over the page in front. */
function sweep(kind, opts = {}) {
  if (!area) return;
  // binary: delicate scanning digs in (binary.js) after the gold line, on the results until they are checked.
  send('overlay:sweep', { kind: kind || 'search', binary: Boolean(opts.binary) });
}

/** The verdict on the page in front, shown by the corner mask. */
function setVerdict(v) { send('overlay:verdict', v || { badge: null }); }

/** Before you pay: the card's words for the checkout in front, or null to take it away. */
function setPay(text) { send('overlay:pay', text ? { text: String(text) } : null); }

/** Marks beside results. Positions arrive in screen pixels and leave relative to the overlay. */
function setMarks({ marks, checking, epoch, clip, ends }) {
  if (!area) return;
  const local = marks.map((m) => ({
    x: (m.x - area.x) / scale,
    y: (m.y - area.y) / scale,
    w: m.w / scale,
    h: m.h / scale,
    badge: m.badge || null,
    kind: m.kind || 'scam',
    label: m.label || '',
    reason: m.reason || '',
    pending: Boolean(m.pending),
    row: Boolean(m.row),
    k: String(m.k || '').slice(0, 24)
  }));
  if (dryRun && local.length) {
    const inside = local.filter((m) => m.x >= 0 && m.y >= 0 && m.x <= area.w / scale && m.y <= area.h / scale).length;
    dryRun(`marks: ${local.length} (${local.filter((m) => m.badge).length} flagged, ${local.filter((m) => m.pending).length} waiting), ${inside} inside the page area; first at ${Math.round(local[0].x)},${Math.round(local[0].y)}`);
  }
  const band = clip ? { top: (clip.top - area.y) / scale, bottom: (clip.bottom - area.y) / scale } : null;
  send('overlay:marks', { marks: local, checking: checking || 0, epoch: epoch || 0, clip: band, ends: /^[01]{2}$/.test(ends) ? ends : '' });
}

/** The page moved by (dx, dy) screen pixels since the marks of `epoch` were placed. Sent straight through, every frame. */
function shift({ epoch, dx, dy, t }) {
  if (!area || dryRun) return;
  if (process.env.SENTINEL_OVERLAY_TRACE) { try { require('fs').appendFileSync(process.env.SENTINEL_OVERLAY_TRACE, `S ${Date.now()} ${t} ${dy}\n`); } catch { /* best effort */ } }
  if (win && !win.isDestroyed() && ready) win.webContents.send('overlay:shift',{ epoch, dx: dx / scale, dy: dy / scale, t: typeof t === 'number' ? t : null });
}

/** The page's pixels moved by dy screen pixels in the last frame (watch.js Glide): the marks move by as much. */
function pixels({ epoch, dy, t }) {
  if (!area || dryRun) return;
  if (process.env.SENTINEL_OVERLAY_TRACE) { try { require('fs').appendFileSync(process.env.SENTINEL_OVERLAY_TRACE, `P ${Date.now()} ${t} ${dy}\n`); } catch { /* best effort */ } }
  if (win && !win.isDestroyed() && ready) win.webContents.send('overlay:px', { epoch, dy: dy / scale, t: typeof t === 'number' ? t : null });
}

/** The overlay window's handle, as a decimal string, or '' when there is none. */
function handle() {
  if (!win || win.isDestroyed()) return '';
  const b = win.getNativeWindowHandle();
  return b.length >= 8 ? b.readBigUInt64LE(0).toString() : String(b.readUInt32LE(0));
}

/** The wheel turned (delta: +120 per notch up), while marks are on screen: they move with the page at once. */
function wheel({ epoch, delta, t }) {
  if (!area || dryRun) return;
  if (process.env.SENTINEL_OVERLAY_TRACE) { try { require('fs').appendFileSync(process.env.SENTINEL_OVERLAY_TRACE, `W ${Date.now()} ${t} ${delta}\n`); } catch { /* best effort */ } }
  if (win && !win.isDestroyed() && ready) win.webContents.send('overlay:wheel', { epoch, delta, t: typeof t === 'number' ? t : null });
}

function destroy() {
  area = null;
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

module.exports = { handle, setWindow, isFullscreen, sweep, setVerdict, setPay, setMarks, shift, wheel, pixels, destroy, setDryRun: (logger) => { dryRun = logger || null; } };
