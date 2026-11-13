/**
 * The look: light, dark or Auto, and one accent colour. One table and one pure function, read by the website and the
 * web app (here), the Windows app's own pages (desktop/shared/look.js, copied by desktop/scripts/sync-shared.js) and
 * the companion (extension/src/lib/look.js, copied by scripts/build-extension.js).
 *
 * Gold is the default and keeps its hand-tuned values: sentinel.css and lux.css hold them for the site and the app,
 * GOLD below for the surfaces that have no stylesheet of their own. Every other accent is gold's own lightness and
 * depth turned to another hue (OKLCH), with each colour that carries words lifted (dark) or deepened (light) until it
 * reads at 4.5:1. Red, orange, yellow and green are never offered: they say danger, warning, caution and safe, and
 * STATUS keeps them the same in every accent (tests/look.test.js).
 *
 * Loaded in <head> before the page is painted, so the stored choice is drawn first and never flashes gold.
 */
(function (root) {
  'use strict';

  // h: OKLCH hue; c: depth against gold's. dark: on dark grounds gold's own depth reads as pastel in a cool hue, so
  // each takes more (c) and sits a little lower (l); words are then lifted back only as far as 4.5:1 needs. The
  // website's colour preview (accent.js on work/e2e-c-rainbow) uses these same rows.
  var ACCENTS = [
    { id: 'gold', name: 'Gold' },
    { id: 'rose', name: 'Rose', h: 354, c: 0.95, dark: { c: 1.55, l: -0.05 } },
    { id: 'amethyst', name: 'Amethyst', h: 308, c: 1, dark: { c: 1.7, l: -0.06 } },
    { id: 'sapphire', name: 'Sapphire', h: 262, c: 1.05, dark: { c: 1.75, l: -0.07 } },
    { id: 'teal', name: 'Teal', h: 200, c: 0.85, dark: { c: 1.65, l: -0.06 } },
    { id: 'platinum', name: 'Platinum', h: 255, c: 0.12, dark: { c: 0.2, l: 0 } }
  ];
  var BY_ID = {};
  for (var i = 0; i < ACCENTS.length; i++) BY_ID[ACCENTS[i].id] = ACCENTS[i];

  // Danger, warning, caution and safe, as sentinel.css has them for each scheme. Never derived from the accent.
  var STATUS = {
    dark: { red: '#e5484d', orange: '#f08a24', yellow: '#f5c542', green: '#4cb782' },
    light: { red: '#b3261e', orange: '#b04a00', yellow: '#8a6100', green: '#1a6e35' }
  };

  // Gold as it is drawn today. web: sentinel.css's ramp (the others are made from it); app: the surfaces without a
  // stylesheet (the live-scanning island, the warning cards, the companion); metal: the three casts of a mark
  // (masks.js mark()).
  var GOLD = {
    dark: {
      web: { 50: '#f7eed6', 200: '#ecd499', 300: '#e2c47f', 400: '#d4ae63', 500: '#c09647', 600: '#9a7633',
        grad: ['#efd79c', '#d6b066', '#b88e3d'], hover: ['#f4e0ad', '#dcb870', '#bf9544'], metal: ['#f3dca4', '#d2ac63', '#8a6424', '#e9c983', '#7a561c'] },
      app: { acc: '#d6b25a', hi: '#e2c47f', lite: '#fff4d2' }
    },
    light: {
      web: { 50: '#3d2c0c', 200: '#6f5217', 300: '#7d5c1c', 400: '#8a6420', 500: '#9c7229', 600: '#b08433',
        grad: ['#98712a', '#8a6420', '#6f4f16'], hover: ['#96701f', '#7a5818', '#624512'], metal: ['#c79a45', '#9a7029', '#5e4210', '#a8803a', '#4c3409'] },
      app: { acc: '#8a6420', hi: '#7d5c1c', lite: '#6f5217' }
    },
    metal: { shadow: '#5a4216', light: '#fff0c4', face: '#d9b65f' }
  };

  // What words in the accent sit on: the pages' darkest and lightest grounds, and the island's and cards' own fills.
  var GROUND = { dark: ['#111215', '#15120e', '#1e1a14', '#0c0d10'], light: ['#efece6', '#efe8da', '#e4dbca', '#f6f1e7'] };
  var SHEET = { dark: '#0c0d10', light: '#f6f1e7' };

  /* ------------------------------------------------------------- colour */

  function hexRgb(hex) { var n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgbHex(c) { return '#' + c.map(function (v) { return (256 | Math.round(Math.max(0, Math.min(255, v)))).toString(16).slice(1); }).join(''); }
  function lin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function gam(v) { return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); }

  function toOklch(hex) {
    var c = hexRgb(hex).map(lin);
    var l = Math.cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2]);
    var m = Math.cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2]);
    var s = Math.cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2]);
    var L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    var a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    var b = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    return [L, Math.sqrt(a * a + b * b), (Math.atan2(b, a) * 180 / Math.PI + 360) % 360];
  }
  // Linear sRGB for an OKLCH colour; null when it falls outside the screen's colours.
  function fromOklch(L, C, H) {
    var a = C * Math.cos(H * Math.PI / 180), b = C * Math.sin(H * Math.PI / 180);
    var l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    var m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    var s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
    var c = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
    for (var i = 0; i < 3; i++) if (c[i] < -0.0005 || c[i] > 1.0005) return null;
    return c;
  }
  // Less colourful until it fits the screen, never a clipped channel that shifts the hue.
  function oklchHex(L, C, H) {
    var c = null;
    for (; C >= 0 && !(c = fromOklch(L, C, H)); C -= 0.004) { /* narrower */ }
    return rgbHex((c || fromOklch(L, 0, H)).map(gam));
  }

  function luminance(hex) { var c = hexRgb(hex).map(lin); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function contrast(a, b) { var x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

  /** Gold's colour `hex` turned to the accent's hue; `words` lifts (dark) or deepens (light) it to 4.5:1 on its grounds. */
  function turn(hex, accent, scheme, words) {
    var tune = accent[scheme] || {};
    var o = toOklch(hex), L = o[0] + (tune.l || 0), C = o[1] * (isFinite(tune.c) ? tune.c : accent.c);
    var out = oklchHex(L, C, accent.h);
    if (!words) return out;
    var grounds = GROUND[scheme];
    var worst = function (c) { var w = 99; for (var i = 0; i < grounds.length; i++) w = Math.min(w, contrast(c, grounds[i])); return w; };
    for (var n = 0; n < 60 && worst(out) < 4.5; n++) {
      L += scheme === 'dark' ? 0.01 : -0.01;
      out = oklchHex(L, C, accent.h);
    }
    return out;
  }

  function rgbOf(hex) { return hexRgb(hex).join(' '); }
  function grad(s) { return 'linear-gradient(180deg, ' + s[0] + ' 0%, ' + s[1] + ' 48%, ' + s[2] + ' 100%)'; }

  /** The accent for the pages without sentinel.css: base, words, highlight, and the gradient of a primary button. */
  function appSet(accent, scheme) {
    var g = GOLD[scheme];
    if (accent.id === 'gold') return { acc: g.app.acc, hi: g.app.hi, lite: g.app.lite, grad: grad(g.web.grad) };
    var t = function (hex, words) { return turn(hex, accent, scheme, words); };
    return { acc: t(g.app.acc, scheme === 'light'), hi: t(g.app.hi, true), lite: t(g.app.lite, scheme === 'light'), grad: grad(g.web.grad.map(function (c) { return t(c); })) };
  }

  /**
   * Custom properties for an accent in a scheme ('dark' or 'light'). The --gold-* names are the stylesheets' own, so
   * nothing else is renamed; --acc-* are for the pages without sentinel.css; --live-* is the accent as light (the
   * dark scheme's), for the scanning line and the marks drawn over any page. Gold leaves --gold-* out: the
   * stylesheets already hold its hand-tuned ramp.
   *
   * `id` may also be { id, h, c, dark, light } (a hue in OKLCH degrees and a depth, 1 being gold's): the website's colour preview
   * turns gold to hues the product never offers, through this same function, and only there.
   */
  function ramp(id, scheme) {
    scheme = scheme === 'light' ? 'light' : 'dark';
    var accent = id && typeof id === 'object' && isFinite(id.h) ? { id: String(id.id || 'preview'), h: Number(id.h), c: isFinite(id.c) ? Number(id.c) : 1, dark: id.dark, light: id.light } : BY_ID[id] || BY_ID.gold;
    var out = {};
    if (accent.id !== 'gold') {
      var w = GOLD[scheme].web, t = function (hex, words) { return turn(hex, accent, scheme, words); };
      var stop = { 50: t(w[50], scheme === 'light'), 200: t(w[200], true), 300: t(w[300], true), 400: t(w[400], true), 500: t(w[500]), 600: t(w[600]) };
      for (var k in stop) out['--gold-' + k] = stop[k];
      out['--gold-grad'] = grad(w.grad.map(function (c) { return t(c); }));
      out['--gold-hover'] = grad(w.hover.map(function (c) { return t(c); }));
      var m = w.metal.map(function (c) { return t(c); });
      out['--metal'] = 'linear-gradient(176deg, ' + m[0] + ' 0%, ' + m[1] + ' 30%, ' + m[2] + ' 56%, ' + m[3] + ' 72%, ' + m[4] + ' 100%)';
      var rgb = rgbOf(stop[400]);
      out['--gold-rgb'] = rgb;
      out['--line-gold'] = 'rgb(' + rgb + ' / ' + (scheme === 'light' ? '.35' : '.28') + ')';
      out['--sketch-gold'] = 'rgb(' + rgb + ' / ' + (scheme === 'light' ? '.6' : '.55') + ')';
      out['--gold-glow'] = '0 14px ' + (scheme === 'light' ? '30px' : '34px') + ' -14px rgb(' + rgb + ' / ' + (scheme === 'light' ? '.6' : '.75') + ')';
    }
    var app = appSet(accent, scheme), live = appSet(accent, 'dark');
    out['--acc'] = app.acc;
    out['--acc-hi'] = app.hi;
    out['--acc-lite'] = app.lite;
    out['--acc-rgb'] = rgbOf(app.acc);
    out['--acc-grad'] = app.grad;
    // Words on the accent's own fill: gold's dark ink, or white on a deepened light-scheme accent.
    out['--on-acc'] = scheme === 'light' ? '#ffffff' : '#16130b';
    out['--live'] = live.acc;
    out['--live-hi'] = live.hi;
    out['--live-lite'] = live.lite;
    out['--live-rgb'] = rgbOf(live.acc);
    return out;
  }

  /** The three casts of a live mark in the accent (masks.js mark()). The mark's tile is dark in every scheme. */
  function metal(id) {
    var accent = BY_ID[id];
    if (!accent || accent.id === 'gold') return GOLD.metal;
    return { shadow: turn(GOLD.metal.shadow, accent, 'dark'), light: turn(GOLD.metal.light, accent, 'dark'), face: turn(GOLD.metal.face, accent, 'dark') };
  }

  /**
   * A picture in gold (BGRA, premultiplied, as Electron's toBitmap gives it) cast in the accent: every pixel turned
   * the way the ramp turns gold, so the light and the bevel stay. A new buffer; the alpha is kept.
   */
  function tintBitmap(buf, id) {
    var accent = BY_ID[id];
    var out = typeof Buffer !== 'undefined' ? Buffer.from(buf) : new Uint8Array(buf);
    if (!accent || accent.id === 'gold') return out;
    var seen = {};
    for (var p = 0; p < out.length; p += 4) {
      var a = out[p + 3];
      if (!a) continue;
      var up = function (v) { return Math.min(255, Math.round(v * 255 / a)); };
      var hex = rgbHex([up(out[p + 2]), up(out[p + 1]), up(out[p])]);
      var c = hexRgb(seen[hex] || (seen[hex] = turn(hex, accent, 'dark')));
      out[p + 2] = Math.round(c[0] * a / 255); out[p + 1] = Math.round(c[1] * a / 255); out[p] = Math.round(c[2] * a / 255);
    }
    return out;
  }

  /* --------------------------------------------------------------- the choice */

  /** Anything stored, sent or typed becomes a known look: unknown words mean Auto and Gold, never an error. */
  function normal(look) {
    look = look && typeof look === 'object' ? look : {};
    return { mode: look.mode === 'light' || look.mode === 'dark' ? look.mode : 'auto', accent: BY_ID[look.accent] ? look.accent : 'gold' };
  }
  /**
   * The look as it travels between the site, the app, the Windows app and the companion: each setting with the time
   * it was chosen (`at`, ms). Anything else in it is dropped.
   */
  function record(r) {
    r = r && typeof r === 'object' ? r : {};
    var look = normal(r), at = r.at && typeof r.at === 'object' ? r.at : {};
    var when = function (k) { var t = Number(at[k]); return isFinite(t) && t > 0 ? Math.floor(t) : 0; };
    return { mode: look.mode, accent: look.accent, at: { mode: when('mode'), accent: when('accent') } };
  }
  /** Two records made one: each setting from whichever chose it last. A tie keeps `a`. */
  function merge(a, b) {
    a = record(a); b = record(b);
    var out = { at: {} };
    ['mode', 'accent'].forEach(function (k) { var w = b.at[k] > a.at[k] ? b : a; out[k] = w[k]; out.at[k] = w.at[k]; });
    return out;
  }
  /** When a record last changed: the companion compares it with what it holds and asks again only when it moved. */
  function rev(r) { r = record(r); return Math.max(r.at.mode, r.at.accent); }

  var mq = root.matchMedia ? root.matchMedia('(prefers-color-scheme: light)') : null;
  function scheme(mode) { return mode === 'light' || mode === 'dark' ? mode : mq && mq.matches ? 'light' : 'dark'; }

  /** Draws a look on an element (normally <html>): data-theme as the stylesheets read it, data-accent, and the ramp. */
  function paint(el, look) {
    look = normal(look);
    if (look.mode === 'auto') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', look.mode);
    el.setAttribute('data-accent', look.accent);
    var vars = ramp(look.accent, scheme(look.mode));
    var old = (el.getAttribute('data-look-vars') || '').split(' ');
    for (var i = 0; i < old.length; i++) if (old[i] && !(old[i] in vars)) el.style.removeProperty(old[i]);
    for (var k in vars) el.style.setProperty(k, vars[k]);
    el.setAttribute('data-look-vars', Object.keys(vars).join(' '));
    return look;
  }

  /** The look on a surface that stays dark in every theme (the corner island): its accent, in the dark scheme. */
  function dark(look) { return { mode: 'dark', accent: normal(look).accent }; }

  /** ?theme=light&accent=sapphire, as main.js loads its pages. */
  function fromQuery(search) {
    var q = new URLSearchParams(search || '');
    return normal({ mode: q.get('theme'), accent: q.get('accent') });
  }

  var api = { ACCENTS: ACCENTS, STATUS: STATUS, GOLD: GOLD, SHEET: SHEET, ramp: ramp, metal: metal, tintBitmap: tintBitmap, normal: normal, record: record, merge: merge, rev: rev, scheme: scheme, paint: paint, dark: dark, fromQuery: fromQuery, contrast: contrast, toOklch: toOklch };
  root.SentinelLook = api;
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  // The companion's own pages (popup, block page, settings): the look the Windows app gave it (popup.js asks the app
  // and keeps it here), drawn before the first paint. Without the app: Auto and Gold.
  if (typeof document !== 'undefined' && /^(chrome|moz)-extension:$/.test(location.protocol)) {
    try { paint(document.documentElement, JSON.parse(localStorage.getItem('sentinel:look'))); } catch (e) { /* storage blocked: Auto and Gold */ }
    return;
  }
  // The site and the web app only: the Windows app's pages paint what they are given.
  if (typeof document === 'undefined' || !/^https?:$/.test(location.protocol)) return;

  /* ------------------------------------------------- the site and the web app */

  // Remembered on this device first, so nothing waits on the network: the theme under the key it always had, the
  // accent, when each was chosen, and the accent's colours for both schemes, which boot.js draws before the first
  // paint (this file loads after it). Inside the Windows app, the app's own setting is the one choice; signed in, the
  // account carries it to the person's other devices (sync()).
  var KEY = { mode: 'sentinel:theme', accent: 'sentinel:accent', at: 'sentinel:look-at', vars: 'sentinel:look-vars' };
  var desktop = root.sentinelDesktop && root.sentinelDesktop.look ? root.sentinelDesktop : null;
  var listeners = [];
  var html = document.documentElement;
  function stored() {
    try {
      return record({ mode: localStorage.getItem(KEY.mode), accent: localStorage.getItem(KEY.accent), at: JSON.parse(localStorage.getItem(KEY.at) || '{}') });
    } catch (e) { return record(); }
  }
  function keep(r) {
    try {
      if (r.mode === 'auto') localStorage.removeItem(KEY.mode); else localStorage.setItem(KEY.mode, r.mode);
      if (r.accent === 'gold') { localStorage.removeItem(KEY.accent); localStorage.removeItem(KEY.vars); } else {
        localStorage.setItem(KEY.accent, r.accent);
        var v = JSON.parse(localStorage.getItem(KEY.vars) || '{}');
        if (v.accent !== r.accent) localStorage.setItem(KEY.vars, JSON.stringify({ accent: r.accent, dark: webVars(r.accent, 'dark'), light: webVars(r.accent, 'light') }));
      }
      localStorage.setItem(KEY.at, JSON.stringify(r.at));
    } catch (e) { /* this page only */ }
  }
  // What boot.js needs before the first paint: the stylesheets' own names only.
  function webVars(id, s) { var all = ramp(id, s), out = {}; for (var k in all) if (/^--(gold|metal|line-gold|sketch-gold)/.test(k)) out[k] = all[k]; return out; }
  var current = stored();
  paint(html, current);
  keep(current);   // a device that had the accent before boot.js drew it gets its colours kept now
  function show(look, from) {
    var was = current;
    current = look;
    var draw = function () { paint(html, look); listeners.slice().forEach(function (fn) { fn(look, was); }); };
    // A press is answered with the new look opening out from where it was pressed (sentinel.css .look-vt). A change
    // from elsewhere, or with reduced motion, is simply drawn.
    var still = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!from || still || !document.startViewTransition || document.visibilityState !== 'visible') { draw(); return; }
    html.style.setProperty('--look-x', from.x + 'px');
    html.style.setProperty('--look-y', from.y + 'px');
    html.classList.add('look-vt');
    // A second press before the first has opened takes over: only the last one clears the class.
    var mine = ++show.n;
    var done = function () { if (mine === show.n) html.classList.remove('look-vt'); };
    document.startViewTransition(draw).finished.then(done, done);
  }
  show.n = 0;
  /** A record from elsewhere (the Windows app, the account, another tab): kept, and drawn if it changes anything. */
  function take(r) {
    var m = merge(current, r);
    var changed = m.mode !== current.mode || m.accent !== current.accent;
    keep(m);
    if (changed) show(m); else current = m;
    return m;
  }
  /** Changes the look (any of mode, accent). `from` is the point it was chosen at, for the reveal. */
  function set(change, from) {
    var r = record(current), now = Date.now();
    ['mode', 'accent'].forEach(function (k) { if (change && k in change && normal(Object.assign({}, r, change))[k] !== r[k]) { r[k] = normal(Object.assign({}, r, change))[k]; r.at[k] = now; } });
    if (r.mode === current.mode && r.accent === current.accent) return Promise.resolve(current);
    keep(r);
    show(r, from);
    if (syncing) sync(true);
    return desktop ? desktop.setLook(r).then(function () { return r; }, function () { return r; }) : Promise.resolve(r);
  }
  if (desktop) {
    desktop.look().then(take, function () {});
    if (desktop.onLook) desktop.onLook(take);
  }
  // Auto follows the system: its ramp changes with it. The same choice made in another tab is drawn here too.
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (current.mode === 'auto') paint(html, current); });
  root.addEventListener('storage', function (ev) { if (ev.key === KEY.at) take(stored()); });

  /*
   * Signed in, the look follows the person to their other devices: the account keeps one record, and each setting
   * comes from whichever device chose it last (GET and POST /api/v1/account/look). The app asks when it starts
   * (SentinelLook.sync()) and when it comes back into view after a minute or more; a change is sent at once. Nothing
   * polls. Signed out, or the account unreachable, the look stays on this device and says so.
   */
  var syncing = false, asked = 0;
  var state = 'local';   // local: this device only; synced: with the account; computer: the Windows app's own account; failed
  function sync(push) {
    syncing = true;
    asked = Date.now();
    var opts = push ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record(current)) } : { credentials: 'same-origin' };
    return fetch('/api/v1/account/look', opts).then(function (res) {
      if (res.status === 401) { syncing = false; return { state: 'local' }; }
      if (!res.ok) throw new Error(String(res.status));
      return res.json().then(function (d) { var m = take(d); if (!push && rev(m) > rev(d)) sync(true); return { state: d.computer ? 'computer' : 'synced' }; });
    }).catch(function () { return { state: 'failed' }; }).then(function (r) {
      state = r.state;
      listeners.slice().forEach(function (fn) { fn(current, current); });
      return state;
    });
  }
  document.addEventListener('visibilitychange', function () { if (syncing && document.visibilityState === 'visible' && Date.now() - asked > 60000) sync(false); });

  /* The theme button (any [data-theme-toggle]): Auto, Light, Dark in turn, and it says which is on. */
  var WORD = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  function label() {
    var b = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < b.length; i++) {
      // The spoken name holds the word on the button, so saying what you see works.
      b[i].setAttribute('aria-label', 'Theme: ' + WORD[current.mode] + '. Change theme');
      b[i].title = 'Theme: ' + WORD[current.mode];
      b[i].dataset.mode = current.mode;
      var t = b[i].querySelector('[data-theme-label]');
      if (t) t.textContent = WORD[current.mode];
    }
  }
  listeners.push(label);
  document.addEventListener('DOMContentLoaded', label);
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-theme-toggle]');
    if (!b) return;
    var order = ['auto', 'light', 'dark'];
    var r = b.getBoundingClientRect();
    set({ mode: order[(order.indexOf(current.mode) + 1) % 3] }, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  });

  /**
   * The picker: Theme (Auto, Light, Dark) and Colour (a coin for each accent), as two groups of radio buttons, so the
   * arrow keys move the choice and a screen reader says the group, the name and which is on. Changing it changes
   * everything at once. Any page can place it: SentinelLook.picker() returns the element.
   */
  function picker(opts) {
    // only: 'mode' or 'accent' draws that group alone (the Settings home gives each its own row, whose heading says the
    // group's name, so the legend is kept for screen readers only).
    var only = opts && opts.only;
    var box = document.createElement('div');
    box.className = 'look';
    var n = ++picker.n;
    var coins = ACCENTS.map(function (a) {
      var r = a.id === 'gold' ? GOLD.dark.web : null;
      var v = r ? [r[200], r[400], r[600]] : (function (x) { return [x['--gold-200'], x['--gold-400'], x['--gold-600']]; })(ramp(a.id, 'dark'));
      return '<label class="look__coin" style="--c1:' + v[0] + ';--c2:' + v[1] + ';--c3:' + v[2] + '"><input type="radio" name="look-accent-' + n + '" value="' + a.id + '"><i aria-hidden="true"></i><span>' + a.name + '</span></label>';
    }).join('');
    var modes = ['auto', 'light', 'dark'].map(function (m) {
      return '<label class="look__mode"><input type="radio" name="look-mode-' + n + '" value="' + m + '"><span>' + WORD[m] + '</span></label>';
    }).join('');
    // The first picker on a page carries the Settings rows' ids (theme, accent), which the first-run step looks for.
    var rowId = function (row) { return 'data-row="' + row + '"' + (n === 1 && !document.getElementById(row) ? ' id="' + row + '"' : ''); };
    var legend = only ? '<legend class="sr-only">' : '<legend>';
    box.innerHTML = (only === 'accent' ? '' : '<fieldset class="look__group" ' + rowId('theme') + '>' + legend + 'Theme</legend><div class="look__modes">' + modes + '</div></fieldset>') +
      (only === 'mode' ? '' : '<fieldset class="look__group" ' + rowId('accent') + '>' + legend + 'Colour</legend><div class="look__coins">' + coins + '</div>' +
      '<p class="look__note">Red, orange, yellow and green are kept for warnings, so they are never a colour here.</p></fieldset>') +
      '<p class="look__sync" role="status"' + (only === 'mode' ? ' hidden' : '') + '></p>';
    var said = box.querySelector('.look__sync');
    var placed = false;
    var sync = function () {
      // A view drawn again leaves its old picker behind: it stops listening.
      if (box.isConnected) placed = true;
      else if (placed) { listeners.splice(listeners.indexOf(sync), 1); return; }
      var inputs = box.querySelectorAll('input');
      for (var i = 0; i < inputs.length; i++) inputs[i].checked = inputs[i].value === (inputs[i].name.indexOf('mode') > 0 ? current.mode : current.accent);
      said.textContent = SAID[state];
      said.dataset.state = state;
    };
    box.addEventListener('change', function (ev) {
      var t = ev.target, r = t.parentNode.getBoundingClientRect();
      var from = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      set(t.name.indexOf('mode') > 0 ? { mode: t.value } : { accent: t.value }, from);
    });
    listeners.push(sync);
    sync();
    return box;
  }
  picker.n = 0;
  var SAID = {
    local: 'Saved on this device.',
    synced: 'Saved with your account, so your other devices use it too.',
    computer: 'Saved on this computer, for the app, live scanning, its warnings and the companion.',
    failed: 'Your account could not be reached. Your choice is saved on this device.'
  };

  api.get = function () { return current; };
  api.set = set;
  api.on = function (fn) { listeners.push(fn); return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; };
  api.picker = picker;
  api.sync = function () { return sync(false); };
  api.state = function () { return state; };
})(typeof globalThis !== 'undefined' ? globalThis : this);
