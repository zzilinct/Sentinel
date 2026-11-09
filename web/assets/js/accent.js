/* The colour preview on the home page (#colour): a rainbow of accents a visitor can try on the whole page.
 *
 * Gold keeps its hand-tuned values. Every other colour is derived from them: each gold tone is turned to the new hue
 * and its lightness is solved so its luminance is gold's, so every text and button pair has the contrast gold has,
 * in light and in dark (tests/accent.test.js proves it). Warnings never take the accent: yellow, orange, red and
 * green have their own tokens.
 *
 * A pick opens the new colour as a circle from the swatch. Gold comes back with a different motion, a band of gold
 * light sweeping down, when the section is scrolled away from (once the scrolling stops), instantly under the tab
 * panels when a tab is clicked, and instantly when the browser tab is hidden. Nothing is saved. Nothing runs at
 * rest: one IntersectionObserver, and a scroll listener only while a return to gold is waiting.
 */
(function (root) {
  'use strict';

  // The accents, in rainbow order, gold as its yellow. One place, so the product's own table can replace it.
  // h: OKLCH hue, k: chroma against gold's (jewel tones carry a little more colour than gold).
  const ACCENTS = [
    { id: 'ruby', name: 'Ruby', h: 12, k: 1.35 },
    { id: 'amber', name: 'Amber', h: 52, k: 1.25 },
    { id: 'gold', name: 'Gold' },
    { id: 'emerald', name: 'Emerald', h: 158, k: 1.2 },
    { id: 'sapphire', name: 'Sapphire', h: 245, k: 1.3 },
    { id: 'indigo', name: 'Indigo', h: 275, k: 1.4 },
    { id: 'amethyst', name: 'Amethyst', h: 312, k: 1.35 }
  ];

  // Gold as the marketing pages draw it (sentinel.css under lux.css and hover.css): dark, then light.
  const GOLD = {
    dark: {
      50: '#f7eed6', 200: '#f3dca4', 300: '#e2c27f', 400: '#d2ac63', 500: '#b8913f', 600: '#8a6424',
      grad: ['#efd79c', '#d6b066', '#b88e3d'], hover: ['#f4e0ad', '#dcb870', '#bf9544'],
      btn: ['#f6e1ab', '#d2ac63', '#a97f35'], btnHover: ['#fbe9bd', '#ddb873', '#b48a3e'],
      metal: ['#f3dca4', '#d2ac63', '#8a6424', '#e9c983', '#7a561c'], at: [0, 30, 56, 72, 100], line: 0.3, sketch: 0.55,
      glow: '0 14px 34px -14px', glowA: 0.75
    },
    light: {
      50: '#3d2c0c', 200: '#6f5217', 300: '#7d5c1c', 400: '#8a6420', 500: '#9c7229', 600: '#b08433',
      grad: ['#98712a', '#8a6420', '#6f4f16'], hover: ['#96701f', '#7a5818', '#624512'],
      btn: ['#f6e1ab', '#d2ac63', '#a97f35'], btnHover: ['#fbe9bd', '#ddb873', '#b48a3e'],
      metal: ['#c79a45', '#9a7029', '#5e4210', '#a8803a', '#4c3409'], at: [0, 34, 58, 74, 100], line: 0.35, sketch: 0.6,
      glow: '0 14px 30px -14px', glowA: 0.6
    }
  };
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
  const Y = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const hexOf = (c) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, gam(v))) * 255).toString(16).padStart(2, '0')).join('');

  const GOLD_H = oklch(GOLD.dark[400]).h;
  // The brightest a light-page text tone may be: 4.6:1 against the darkest paper it sits on (lux.css --bg).
  const LIGHT_CAP = (luminance(rgbOf('#efe8da')) + 0.05) / 4.6 - 0.05;
  // One gold tone in another hue: the same luminance (or less, up to cap), the hue turned, as much colour as fits.
  function tone(hex, accent, cap = 1) {
    const g = oklch(hex);
    const target = Math.min(cap, luminance(rgbOf(hex)));
    const h = (accent.h + g.h - GOLD_H + 360) % 360;
    const C = g.C * accent.k;
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (Y(fit(mid, C, h)) < target) lo = mid; else hi = mid; }
    return hexOf(fit((lo + hi) / 2, C, h));
  }

  // Every token the page draws gold with, for one accent and one scheme.
  function ramp(id, scheme) {
    const a = ACCENTS.find((x) => x.id === id);
    const g = GOLD[scheme];
    if (!a || a.h === undefined) return null;
    // On paper, gold's text tones and white-on-gold fills sit just under 4.5:1 (4.39 and 4.44); the derived ones are
    // held a little darker so they pass.
    const cap = scheme === 'light' ? LIGHT_CAP : 1;
    const t = (hex) => tone(hex, a, cap);
    const out = {};
    STEPS.forEach((s) => { out[`--gold-${s}`] = s === 600 ? tone(g[s], a) : t(g[s]); });
    const rgb = rgbOf(out['--gold-400']).join(' ');
    const lg = (list, stops) => list.map(t).map((c, i) => `${c} ${stops[i]}%`).join(', ');
    out['--gold-rgb'] = rgb;
    out['--gold-grad'] = `linear-gradient(180deg, ${lg(g.grad, [0, scheme === 'dark' ? 48 : 50, 100])})`;
    out['--gold-hover'] = `linear-gradient(180deg, ${lg(g.hover, [0, scheme === 'dark' ? 48 : 50, 100])})`;
    const free = (list, stops) => list.map((hex) => tone(hex, a)).map((c, i) => `${c} ${stops[i]}%`).join(', ');
    out['--btn-grad'] = `linear-gradient(176deg, ${free(g.btn, [0, 48, 100])})`;
    out['--btn-grad-hover'] = `linear-gradient(176deg, ${free(g.btnHover, [0, 48, 100])})`;
    out['--metal-stops'] = free(g.metal, g.at);
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

  const api = { ACCENTS, GOLD, STEPS, ramp, css, tone, contrast, luminance, oklch };
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
      + ` style="--sw-hi:${c(50)};--sw:${c(300)};--sw-lo:${c(600)}"><span class="swatch__gem" aria-hidden="true"></span><span class="swatch__name">${a.name}</span></button>`;
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
    if (vt) vt.skipTransition();
    if (how === 'instant' || still() || !doc.startViewTransition) { apply(id); return; }
    html.classList.remove('vt-pick', 'vt-gold');
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

  group.addEventListener('click', (e) => {
    const b = e.target.closest('.swatch');
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
