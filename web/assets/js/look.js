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
  // The marketing pages' gold button and its polished hover (lux.css, hover.css): a bright fill with dark words
  // (LUX.ink) in both schemes, so each tone is lifted until those words read at 4.5:1.
  var LUX = { btn: ['#f6e1ab', '#d2ac63', '#a97f35'], btnHover: ['#fbe9bd', '#ddb873', '#b48a3e'], gilt: ['#f0d28c', '#c99a45', '#8e6626'], ink: '#1a1206' };
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

  /**
   * Gold's colour `hex` turned to the accent's hue; `words` lifts (dark) or deepens (light) it to 4.5:1 on its grounds.
   * `words` may instead be the colour of the words drawn on it (dark ink): the tone is lifted until they read.
   */
  function turn(hex, accent, scheme, words) {
    var tune = accent[scheme] || {};
    var o = toOklch(hex), L = o[0] + (tune.l || 0), C = o[1] * (isFinite(tune.c) ? tune.c : accent.c);
    var out = oklchHex(L, C, accent.h);
    if (!words) return out;
    var grounds = typeof words === 'string' ? [words] : GROUND[scheme], up = typeof words === 'string' || scheme === 'dark';
    var worst = function (c) { var w = 99; for (var i = 0; i < grounds.length; i++) w = Math.min(w, contrast(c, grounds[i])); return w; };
    for (var n = 0; n < 60 && worst(out) < 4.5; n++) {
      L += up ? 0.01 : -0.01;
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
      var at = scheme === 'light' ? [0, 34, 58, 74, 100] : [0, 30, 56, 72, 100];
      out['--metal-stops'] = m.map(function (c, i) { return c + ' ' + at[i] + '%'; }).join(', ');
      var lux = function (hexes, mid) { return 'linear-gradient(176deg, ' + hexes.map(function (c, i) { return t(c, LUX.ink) + ' ' + [0, mid, 100][i] + '%'; }).join(', ') + ')'; };
      out['--btn-grad'] = lux(LUX.btn, 48);
      out['--btn-grad-hover'] = lux(LUX.btnHover, 48);
      out['--gilt'] = lux(LUX.gilt, 50);
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

  var api = { ACCENTS: ACCENTS, STATUS: STATUS, GOLD: GOLD, SHEET: SHEET, LUX: LUX, ramp: ramp, metal: metal, tintBitmap: tintBitmap, normal: normal, record: record, merge: merge, rev: rev, scheme: scheme, paint: paint, dark: dark, fromQuery: fromQuery, contrast: contrast, toOklch: toOklch };
  root.SentinelLook = api;
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  // The companion's own pages (popup, block page, settings): the look the Windows app gave it (popup.js asks the app
  // and keeps it here), drawn before the first paint. Without the app: Auto and Gold.
  if (typeof document !== 'undefined' && /^(chrome|moz)-extension:$/.test(location.protocol)) {
    try { paint(document.documentElement, JSON.parse(localStorage.getItem('sentinel:look'))); } catch (e) { /* storage blocked: Auto and Gold */ }
    return;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
