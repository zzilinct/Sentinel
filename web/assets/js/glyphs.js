/*
 * The glyph field: Sentinel reading a page's code. Behind "How it works", a dense field of letters, digits and a
 * little punctuation in the mono face, faint, with slow diagonal bands of brightness drifting through it. The
 * pointer brightens the glyphs near it a little, and scrolling moves the bands on a little.
 *
 * Cheap by design: the glyphs are drawn once, into a sheet the size of the section (from a sheet of single glyphs,
 * as binary.js does), and a frame is six whole-canvas copies: the bands as one gradient, the pointer's glow as
 * another, the fade at the top and bottom, the glyph sheet cut through them, and the colour laid on. A few glyphs
 * change each frame. It draws at most 30 times a second, only while the section is on screen and the tab is showing.
 *
 * Reduced motion: one still field, drawn again only when the size or the theme changes.
 *
 *   <section data-glyph-field>          the field goes behind the section's own content
 *   SentinelGlyphs.state()              { running, frames, phase, scroll, glow, dpr, max, theme } (for the website's checks)
 *
 * The glyphs never pass MAX (the alpha of the brightest stroke, band and pointer together), so the section's text
 * keeps its contrast in front of them (scripts/verify-web/19-glyphs.js measures it on the real colours).
 */
(() => {
  'use strict';

  const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const CODE = '<>/{}=;:.()"';
  const CW = 11;           // a cell, in CSS pixels
  const CH = 18;
  const PERIOD = 560;      // one band and its gap, in CSS pixels along the diagonal
  const DRIFT = 26000;     // ms for the bands to move on by one period
  const SCROLL = 2400;     // px of scroll that move the bands on by one period
  const RADIUS = 200;      // the pointer's glow, in CSS pixels
  // Alpha of the bands at their faintest and brightest, and what the pointer adds, per theme.
  const LEVELS = { dark: { floor: 0.035, peak: 0.16, glow: 0.06 }, light: { floor: 0.03, peak: 0.14, glow: 0.06 } };
  const MAX = { dark: 0.22, light: 0.2 };
  // ponytail: the canvas pixels are capped at this budget (a tall phone section at 3x is about 10 million); past it
  // the glyphs are drawn at a lower ratio. Draw only the visible part if a phone ever needs full 3x.
  const BUDGET = 4.5e6;

  /**
   * The band gradient's stops along the diagonal: [position 0..1, alpha]. `len` is the diagonal's length in CSS
   * pixels, `phase` how far the bands have moved on (in periods). Two slow sines, one longer, so the bands are soft
   * and uneven, never a ruler.
   */
  function bands(len, phase, level) {
    const n = Math.min(160, Math.ceil((len / PERIOD) * 10) + 1);
    const out = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const p = (u * len) / PERIOD - phase;
      const a = 0.5 + 0.5 * Math.sin(p * Math.PI * 2);
      const b = 0.5 + 0.5 * Math.sin((p / 2.3 + 0.17) * Math.PI * 2);
      const s = Math.pow(Math.min(1, 0.62 * a + 0.38 * b), 1.6);
      out.push([u, level.floor + (level.peak - level.floor) * s]);
    }
    return out;
  }

  const RAMP = 140;        // px over which the field comes in under the chapter's kicker
  const FOOT = 0.86;       // and where it starts to fade out at the bottom

  /**
   * How much of the field shows at `y` CSS pixels down a section `h` tall, 0..1: none behind the kicker (gold on
   * paper is already right at 4.5:1 with nothing behind it), coming in below it, and fading out at the bottom.
   * Straight lines between these points, as the canvas gradient draws it.
   */
  function veilStops(h, clear) {
    const at = (y) => Math.min(1, Math.max(0, y / h));
    const top = at(clear), full = Math.max(top, Math.min(at(clear + RAMP), FOOT));
    return [[0, 0], [top, 0], [full, 1], [Math.max(full, FOOT), 1], [1, 0]];
  }
  function veil(y, h, clear) {
    const st = veilStops(h, clear), u = y / h;
    if (u <= 0 || u >= 1) return 0;
    for (let i = 1; i < st.length; i++) {
      const [u0, a0] = st[i - 1], [u1, a1] = st[i];
      if (u <= u1) return u1 > u0 ? a0 + ((a1 - a0) * (u - u0)) / (u1 - u0) : a1;
    }
    return 0;
  }

  const api = { bands, veil, veilStops, LEVELS, MAX, PERIOD };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pointerFine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const root = document.documentElement;
  const state = { running: false, frames: 0, phase: 0, scroll: 0, glow: 0, dpr: 1, max: 0, theme: 'dark', h: 0, clear: 0 };
  api.state = () => ({ ...state });
  window.SentinelGlyphs = api;

  function field(section) {
    const canvas = document.createElement('canvas');
    canvas.className = 'glyph-field';
    canvas.setAttribute('aria-hidden', 'true');
    section.prepend(canvas);
    const ctx = canvas.getContext('2d');
    const sheet = document.createElement('canvas');
    const sg = sheet.getContext('2d');
    let atlas = null;
    let W = 0, H = 0, dpr = 1, cw = 0, ch = 0, cols = 0, rows = 0, clear = 0;
    let colors = ['#ecd499', '#c09647'];
    let level = LEVELS.dark;
    let visible = false, raf = 0, last = 0, t0 = performance.now();
    let scrollY0 = window.scrollY;
    const ptr = { x: 0, y: 0, tx: 0, ty: 0, on: 0 };

    const font = () => getComputedStyle(root).getPropertyValue('--mono').trim() || 'ui-monospace, monospace';

    // Every glyph once, in white, at the canvas's own pixel size: a field is then copies, never text.
    function makeAtlas() {
      const all = CHARS + CODE;
      const c = document.createElement('canvas');
      c.width = cw * all.length; c.height = ch;
      const g = c.getContext('2d');
      g.font = `400 ${Math.round(12 * dpr)}px ${font()}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      for (let i = 0; i < all.length; i++) g.fillText(all[i], i * cw + cw / 2, Math.round(ch / 2));
      return { canvas: c, n: all.length };
    }

    // One cell of the sheet: a random glyph (now and then a bit of punctuation), or a gap, at a random strength.
    function cell(k) {
      const x = (k % cols) * cw, y = ((k / cols) | 0) * ch;
      sg.clearRect(x, y, cw, ch);
      if (Math.random() < 0.1) return;
      const i = Math.random() < 0.06 ? CHARS.length + ((Math.random() * CODE.length) | 0) : (Math.random() * CHARS.length) | 0;
      sg.globalAlpha = 0.35 + Math.random() * 0.65;
      sg.drawImage(atlas.canvas, i * cw, 0, cw, ch, x, y, cw, ch);
      sg.globalAlpha = 1;
    }

    function theme() {
      const cs = getComputedStyle(root);
      state.theme = cs.colorScheme === 'light' ? 'light' : 'dark';
      level = LEVELS[state.theme];
      state.max = MAX[state.theme];
      const v = (name) => cs.getPropertyValue(name).trim();
      // Gold on the dark theme; ink turning to gold on the light one.
      colors = state.theme === 'light' ? [v('--text-2'), v('--gold-400')] : [v('--gold-200'), v('--gold-500')];
    }

    function size() {
      const r = section.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
      dpr = Math.min(window.devicePixelRatio || 1, Math.sqrt(BUDGET / (W * H)));
      state.dpr = dpr;
      // The kicker's bottom, by layout offsets (an entrance's transform must not move it).
      const k = section.querySelector('.kicker');
      clear = 0;
      if (k) { for (let e = k; e && e !== section; e = e.offsetParent) clear += e.offsetTop; clear += k.offsetHeight + 12; }
      state.h = H; state.clear = clear;
      cw = Math.round(CW * dpr); ch = Math.round(CH * dpr);
      canvas.width = sheet.width = Math.round(W * dpr);
      canvas.height = sheet.height = Math.round(H * dpr);
      cols = Math.ceil(sheet.width / cw); rows = Math.ceil(sheet.height / ch);
      atlas = makeAtlas();
      for (let k = 0; k < cols * rows; k++) cell(k);
      draw(performance.now());
    }

    function draw(now) {
      const cwid = canvas.width, chei = canvas.height;
      const time = reduced ? 0 : (now - t0) / DRIFT;
      const scroll = reduced ? 0 : (window.scrollY - scrollY0) / SCROLL;
      state.scroll = scroll;
      state.phase = time + scroll;
      // The bands run from the top left to the bottom right, a little flatter than 45 degrees.
      const dx = 0.8, dy = 0.6;
      const len = W * dx + H * dy;
      const g = ctx.createLinearGradient(0, 0, len * dx * dpr, len * dy * dpr);
      for (const [u, a] of bands(len, state.phase, level)) g.addColorStop(u, `rgba(0,0,0,${a.toFixed(4)})`);
      ctx.globalCompositeOperation = 'copy';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cwid, chei);
      ctx.globalCompositeOperation = 'source-over';
      if (ptr.on > 0.01) {
        const x = ptr.x * dpr, y = ptr.y * dpr, R = RADIUS * dpr;
        const rg = ctx.createRadialGradient(x, y, 0, x, y, R);
        rg.addColorStop(0, `rgba(0,0,0,${(level.glow * ptr.on).toFixed(4)})`);
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rg;
        ctx.fillRect(x - R, y - R, R * 2, R * 2);
      }
      ctx.globalCompositeOperation = 'destination-in';
      const vg = ctx.createLinearGradient(0, 0, 0, chei);
      for (const [u, a] of veilStops(H, clear)) vg.addColorStop(u, `rgba(0,0,0,${a})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, cwid, chei);
      // The glyphs, cut through the light; then their colour, a gentle gradient across the section.
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(sheet, 0, 0);
      ctx.globalCompositeOperation = 'source-in';
      const cg = ctx.createLinearGradient(0, 0, cwid, chei);
      cg.addColorStop(0, colors[0]); cg.addColorStop(1, colors[1]);
      ctx.fillStyle = cg;
      ctx.fillRect(0, 0, cwid, chei);
      ctx.globalCompositeOperation = 'source-over';
      state.frames++;
    }

    function frame(now) {
      raf = 0;
      if (!visible || document.hidden) { state.running = false; return; }
      raf = requestAnimationFrame(frame);
      if (now - last < 32) return;
      last = now;
      ptr.x += (ptr.tx - ptr.x) * 0.18; ptr.y += (ptr.ty - ptr.y) * 0.18;
      state.glow = ptr.on += ((ptr.target || 0) - ptr.on) * 0.1;
      // A few glyphs change each frame: the code being read.
      for (let i = Math.max(2, (cols * rows) >> 9); i > 0; i--) cell((Math.random() * cols * rows) | 0);
      draw(now);
    }
    function run() {
      if (reduced || raf || !visible || document.hidden) return;
      state.running = true;
      raf = requestAnimationFrame(frame);
    }

    theme();
    size();
    new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; run(); }, { rootMargin: '80px 0px' }).observe(section);
    document.addEventListener('visibilitychange', run);
    let pending = 0;
    new ResizeObserver(() => {
      if (pending) return;
      pending = requestAnimationFrame(() => { pending = 0; const r = section.getBoundingClientRect(); if (Math.round(r.width) !== W || Math.round(r.height) !== H) size(); });
    }).observe(section);
    const retheme = () => { theme(); draw(performance.now()); };
    new MutationObserver(retheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', retheme);
    if (!reduced && pointerFine) {
      section.addEventListener('pointermove', (e) => {
        const r = section.getBoundingClientRect();
        ptr.tx = e.clientX - r.left; ptr.ty = e.clientY - r.top;
        if (!ptr.target) { ptr.x = ptr.tx; ptr.y = ptr.ty; }
        ptr.target = 1;
      }, { passive: true });
      section.addEventListener('pointerleave', () => { ptr.target = 0; });
    }
  }

  function start() {
    const el = document.querySelector('[data-glyph-field]');
    if (el) field(el);
  }
  // The mono face first, so the glyphs are the site's own; never waits more than a second and a half for it.
  const ready = document.fonts && document.fonts.load ? Promise.race([document.fonts.load('400 12px "Geist Mono"'), new Promise((r) => setTimeout(r, 1500))]) : Promise.resolve();
  ready.catch(() => {}).then(start);
})();
