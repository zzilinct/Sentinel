/*
 * The companion's own pages (the popup, the settings and the block page) in the look chosen last. lib/look.js has
 * already drawn the one kept here before the first paint; the worker then asks the Windows app (background.js look)
 * and its answer is drawn and kept for the next page. A change made while a page is open, in the app, on another
 * device or in these settings, is drawn at once. One storage listener and the system's light or dark; nothing polls.
 */
(() => {
  'use strict';
  const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;
  const L = globalThis.SentinelLook;
  if (!L || !ext) return;
  const html = document.documentElement;
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let shown;
  try { shown = L.record(JSON.parse(localStorage.getItem('sentinel:look'))); } catch { shown = L.record(); }
  const listeners = [];

  /**
   * Draws a look and keeps it. `from` ({ x, y }) is where it was chosen: the new look opens out from there over the
   * old one, as in the app. Any other change crossfades. Reduced motion, or a browser without view transitions: drawn.
   */
  function draw(look, from) {
    const r = L.record(look);
    try { localStorage.setItem('sentinel:look', JSON.stringify(r)); } catch { /* this page only */ }
    const same = r.mode === shown.mode && r.accent === shown.accent;
    shown = r;
    if (same) return;
    const paint = () => { L.paint(html, r); listeners.forEach((fn) => fn(r)); };
    if (still.matches || !document.startViewTransition || document.visibilityState !== 'visible') { paint(); return; }
    if (from) { html.style.setProperty('--look-x', `${from.x}px`); html.style.setProperty('--look-y', `${from.y}px`); }
    html.classList.toggle('look-vt', Boolean(from));
    const mine = ++draw.n;
    const done = () => { if (mine === draw.n) html.classList.remove('look-vt'); };
    document.startViewTransition(paint).finished.then(done, done);
  }
  draw.n = 0;

  const ask = (change) => Promise.resolve(ext.runtime.sendMessage({ type: 'look', change }))
    .then((res) => { if (res && res.ok && res.look) draw(res.look); return shown; }, () => shown);
  ask();
  ext.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.look && changes.look.newValue) draw(changes.look.newValue); });
  // Auto follows the system, and an accent's colours differ between light and dark.
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (shown.mode === 'auto') L.paint(html, shown); });

  globalThis.SentinelLookHere = {
    get: () => shown,
    /** Chooses here: { mode } or { accent }, drawn at once from `from`, then kept by the worker as the newest choice. */
    set: (change, from) => {
      const k = 'mode' in change ? 'mode' : 'accent';
      draw(L.merge(shown, { [k]: change[k], at: { [k]: Date.now() } }), from);
      return ask(change);
    },
    on: (fn) => { listeners.push(fn); }
  };
})();
