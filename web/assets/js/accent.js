/* The colour preview on the home page (#colour): the accents a visitor can try on the whole page.
 *
 * Gold keeps its hand-tuned values. Every other accent takes each gold tone's own OKLCH lightness and depth, turned
 * to its hue, so a blue is as deep a blue as gold is a gold rather than a pastel matched to gold's brightness. Each
 * tone that carries words is then lifted (dark pages) or deepened (light pages) only as far as 4.6:1 needs
 * (tests/accent.test.js). No accent sits near red, orange, yellow or green: those say danger, warning, caution and
 * safe, keep their own tokens, and never change.
 *
 * A pick opens the new colour as a circle from the gem. Gold comes back with a different motion, a band of gold
 * light sweeping down, when the section is scrolled away from (once the scrolling stops), instantly under the tab
 * panels when a tab is clicked, and instantly when the browser tab is hidden. Nothing is saved. Nothing runs at
 * rest: one IntersectionObserver, and a scroll listener only while a return to gold is waiting.
 */
(function (root) {
  'use strict';

  // The accents, the product's own (web/assets/js/look.js on work/e2e-c-design: same ids, hues and depth, so that
  // table replaces this one at merge), in rainbow order with gold as the yellow. h: OKLCH hue; c: depth against gold's.
  // dark: each one's own tuning on dark pages, where gold's depth alone reads as pastel in a cool hue: c, more depth,
  // and l, a lower lightness (words are then lifted back only as far as 4.6:1 needs).
  const ACCENTS = [
    { id: 'rose', name: 'Rose', h: 354, c: 0.95, dark: { c: 1.55, l: -0.05 } },
    { id: 'gold', name: 'Gold' },
    { id: 'teal', name: 'Teal', h: 200, c: 0.85, dark: { c: 1.65, l: -0.06 } },
    { id: 'sapphire', name: 'Sapphire', h: 262, c: 1.05, dark: { c: 1.75, l: -0.07 } },
    { id: 'amethyst', name: 'Amethyst', h: 308, c: 1, dark: { c: 1.7, l: -0.06 } },
    { id: 'platinum', name: 'Platinum', h: 255, c: 0.12, dark: { c: 0.2, l: 0 } }
  ];

  // Gold as the marketing pages draw it (sentinel.css under lux.css and hover.css): dark, then light.
  const GOLD = {
    dark: {
      50: '#f7eed6', 200: '#f3dca4', 300: '#e2c27f', 400: '#d2ac63', 500: '#b8913f', 600: '#8a6424',
      grad: ['#efd79c', '#d6b066', '#b88e3d'], hover: ['#f4e0ad', '#dcb870', '#bf9544'],
      btn: ['#f6e1ab', '#d2ac63', '#a97f35'], btnHover: ['#fbe9bd', '#ddb873', '#b48a3e'], gilt: ['#f0d28c', '#c99a45', '#8e6626'],
      metal: ['#f3dca4', '#d2ac63', '#8a6424', '#e9c983', '#7a561c'], at: [0, 30, 56, 72, 100], line: 0.3, sketch: 0.55,
      glow: '0 14px 34px -14px', glowA: 0.75
    },
    light: {
      50: '#3d2c0c', 200: '#6f5217', 300: '#7d5c1c', 400: '#8a6420', 500: '#9c7229', 600: '#b08433',
      grad: ['#98712a', '#8a6420', '#6f4f16'], hover: ['#96701f', '#7a5818', '#624512'],
      btn: ['#f6e1ab', '#d2ac63', '#a97f35'], btnHover: ['#fbe9bd', '#ddb873', '#b48a3e'], gilt: ['#f0d28c', '#c99a45', '#8e6626'],
      metal: ['#c79a45', '#9a7029', '#5e4210', '#a8803a', '#4c3409'], at: [0, 34, 58, 74, 100], line: 0.35, sketch: 0.6,
      glow: '0 14px 30px -14px', glowA: 0.6
    }
  };
  // What words in the accent sit on (the pages' grounds), and the words that sit on the accent's fills.
  const GROUND = { dark: ['#111215', '#15120e', '#1e1a14', '#262019'], light: ['#efece6', '#efe8da', '#f4eee3', '#f5f2ec'] };
  const INK = { dark: '#16130b', light: '#ffffff', button: '#1a1206' };
  // The hues that carry meaning (sentinel.css, dark): no accent may sit within 25 degrees of one.
  const STATUS = { red: '#e5484d', orange: '#f08a24', yellow: '#f5c542', green: '#4cb782' };
  const STEPS = [50, 200, 300, 400, 500, 600];

  /* ------------------------------------------------------------- colour */

  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const luminance = (rgb) => { const [r, g, b] = rgb.map((c) => lin(c / 255)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const [x, y] = [luminance(rgbOf(a)), luminance(rgbOf(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  function oklch(hex) {
    const [r, g, b] = rgbOf(hex).map((c) => lin(c / 255));
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return { L, C: Math.hypot(A, B), h: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360 };
  }
  // Linear sRGB of an OKLCH colour (may lie outside 0..1).
  function linear(L, C, h) {
    const A = C * Math.cos(h * Math.PI / 180), B = C * Math.sin(h * Math.PI / 180);
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  }
  const inGamut = (c) => c.every((v) => v >= -1e-6 && v <= 1 + 1e-6);
  // The most colour that fits sRGB at this lightness and hue, up to C.
  function fit(L, C, h) {
    if (inGamut(linear(L, C, h))) return linear(L, C, h);
    let lo = 0, hi = C;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (inGamut(linear(L, mid, h))) lo = mid; else hi = mid; }
    return linear(L, lo, h);
  }
    const hexOf = (c) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, gam(v))) * 255).toString(16).padStart(2, '0')).join('');

  // One gold tone at the accent's hue: gold's lightness, its depth times c, as much as fits the screen. `need` lists
  // what it must read against at 4.6:1; dir is the way lightness moves until it does (+1 lighter, -1 deeper).
  function tone(hex, a, need = [], dir = 1, t = { c: a.c, l: 0 }) {
    const g = oklch(hex);
    const h = a.h;
    const C = g.C * t.c;
    let L = g.L + t.l;
    let out = hexOf(fit(L, C, h));
    for (let n = 0; n < 120 && need.some((x) => contrast(out, x) < 4.6); n++) {
      L = Math.min(1, Math.max(0, L + dir * 0.005));
      out = hexOf(fit(L, C, h));
    }
    return out;
  }

  // Every token the page draws gold with, for one accent and one scheme.
  function ramp(id, scheme) {
    const a = ACCENTS.find((x) => x.id === id);
    const g = GOLD[scheme];
    if (!a || a.h === undefined) return null;
    const dark = scheme === 'dark';
    const tune = dark ? a.dark : { c: a.c, l: 0 };
    const words = (hex) => tone(hex, a, GROUND[scheme], dark ? 1 : -1, tune);
    const out = {};
    STEPS.forEach((s) => { out[`--gold-${s}`] = s === 600 ? tone(g[s], a, [], 1, tune) : words(g[s]); });
    const rgb = rgbOf(out['--gold-400']).join(' ');
    const list = (hexes, stops, f) => hexes.map(f).map((c, i) => `${c} ${stops[i]}%`).join(', ');
    // The gold fills carry dark words on dark pages and white words on paper; the lux button carries dark words on both.
    const fill = (hex) => tone(hex, a, [INK[scheme]], dark ? 1 : -1, tune);
    const button = (hex) => tone(hex, a, [INK.button], 1, tune);
    const free = (hex) => tone(hex, a, [], 1, tune);
    out['--gold-rgb'] = rgb;
    out['--gold-grad'] = `linear-gradient(180deg, ${list(g.grad, [0, dark ? 48 : 50, 100], fill)})`;
    out['--gold-hover'] = `linear-gradient(180deg, ${list(g.hover, [0, dark ? 48 : 50, 100], fill)})`;
    out['--btn-grad'] = `linear-gradient(176deg, ${list(g.btn, [0, 48, 100], button)})`;
    out['--btn-grad-hover'] = `linear-gradient(176deg, ${list(g.btnHover, [0, 48, 100], button)})`;
    out['--gilt'] = `linear-gradient(176deg, ${list(g.gilt, [0, 50, 100], free)})`;
    out['--metal-stops'] = list(g.metal, g.at, free);
    out['--metal'] = `linear-gradient(176deg, ${out['--metal-stops']})`;
    out['--line-gold'] = `rgb(${rgb} / ${g.line})`;
    out['--sketch-gold'] = `rgb(${rgb} / ${g.sketch})`;
    out['--gold-glow'] = `${g.glow} rgb(${rgb} / ${g.glowA})`;
    return out;
  }

  // The stylesheet for one accent: dark everywhere, light where the page is light. More specific than the theme
  // rules in sentinel.css, lux.css and hover.css, so it wins in every combination of system and chosen theme.
  function css(id) {
    const decl = (s) => Object.entries(ramp(id, s)).map(([k, v]) => `${k}:${v}`).join(';');
    const light = decl('light');
    return `:root[data-accent]{${decl('dark')}}`
      + `@media (prefers-color-scheme: light){:root[data-accent]:not([data-theme="dark"]){${light}}}`
      + `:root[data-accent][data-theme="light"]{${light}}`;
  }

  const api = { ACCENTS, GOLD, GROUND, STATUS, STEPS, ramp, css, tone, contrast, luminance, oklch, fit, hexOf };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.SentinelAccent = api;

  /* ------------------------------------------------------------- the page */

  const doc = root.document;
  const html = doc.documentElement;
  const section = doc.getElementById('colour');
  const group = section && section.querySelector('.colour__pick');
  if (!group) return;
  const name = section.querySelector('[data-accent-name]');
  const sheet = doc.createElement('style');
  doc.head.appendChild(sheet);
  const still = () => root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  group.innerHTML = ACCENTS.map((a) => {
    const gem = a.h === undefined ? GOLD.dark : null;
    const r = gem ? null : ramp(a.id, 'dark');
    const c = (s) => (gem ? gem[s] : r[`--gold-${s}`]);
    return `<button type="button" class="swatch" role="radio" aria-checked="${a.id === 'gold'}" tabindex="${a.id === 'gold' ? 0 : -1}" data-accent="${a.id}"`
      + ` style="--sw-hi:${c(200)};--sw:${c(400)};--sw-lo:${c(600)}"><span class="swatch__gem" aria-hidden="true"></span><span class="swatch__name">${a.name}</span></button>`;
  }).join('');
  const swatches = [...group.querySelectorAll('.swatch')];

  let current = 'gold';
  let vt = null;
  function apply(id) {
    current = id;
    if (id === 'gold') { delete html.dataset.accent; sheet.textContent = ''; } else { sheet.textContent = css(id); html.dataset.accent = id; }
    swatches.forEach((b) => { const on = b.dataset.accent === id; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
    if (name) name.textContent = ACCENTS.find((a) => a.id === id).name;
  }

  // how: 'pick' (a circle from the swatch), 'gold' (the band sweeping down) or 'instant'.
  function go(id, how, from) {
    if (id === current) return;
    // A second click finishes the first change at once, so two never fight.
    if (vt) { vt.skipTransition(); vt = null; }
    html.classList.remove('vt-pick', 'vt-gold');
    if (how === 'instant' || still() || !doc.startViewTransition) { apply(id); return; }
    if (from) {
      const b = from.getBoundingClientRect();
      const x = b.left + b.width / 2, y = b.top + b.height / 2;
      html.style.setProperty('--vt-x', `${x}px`);
      html.style.setProperty('--vt-y', `${y}px`);
      html.style.setProperty('--vt-r', `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`);
    }
    html.classList.add(how === 'gold' ? 'vt-gold' : 'vt-pick');
    let band = null;
    const t = doc.startViewTransition(() => {
      apply(id);
      if (how === 'gold') { band = doc.createElement('div'); band.className = 'gold-band'; band.setAttribute('aria-hidden', 'true'); doc.body.appendChild(band); }
    });
    vt = t;
    t.finished.finally(() => {
      if (band) band.remove();
      if (vt === t) { vt = null; html.classList.remove('vt-pick', 'vt-gold'); }
    });
  }

  // While a change runs, the browser shows pictures over the page and a click lands on <html>, not on the gem under
  // it, so the gem is found by where the click fell. The second click then finishes the first and wins.
  doc.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.swatch')
      || (vt && swatches.find((s) => { const r = s.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; }));
    if (b) go(b.dataset.accent, 'pick', b);
  });
  group.addEventListener('keydown', (e) => {
    const i = swatches.findIndex((b) => b.dataset.accent === current);
    const n = swatches.length;
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: n - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const b = swatches[(to + n) % n];
    b.focus();
    go(b.dataset.accent, 'pick', b);
  });

  // Back to gold. Under the tab panels (site.js's wipe) the change is hidden, so it is instant; otherwise the band
  // sweeps once the page has stopped moving, so the picture it animates is never a moving one.
  const covered = () => Boolean(doc.querySelector('.wipe.is-cover'));
  let wait = 0;
  const settle = () => { clearTimeout(wait); wait = setTimeout(home, 180); };
  function stopWaiting() { clearTimeout(wait); root.removeEventListener('scroll', settle); }
  function home() {
    stopWaiting();
    if (current !== 'gold') go('gold', covered() ? 'instant' : 'gold');
  }
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting || current === 'gold') { stopWaiting(); return; }
    if (covered()) { home(); return; }
    root.addEventListener('scroll', settle, { passive: true });
    settle();
  }).observe(section);
  doc.addEventListener('visibilitychange', () => { if (doc.hidden && current !== 'gold') { stopWaiting(); go('gold', 'instant'); } });
  root.addEventListener('pageshow', (e) => { if (e.persisted && current !== 'gold') go('gold', 'instant'); });
})(typeof window !== 'undefined' ? window : globalThis);
