/*
 * The opening, once per visit (boot.js puts html.intro on before the first paint): a loading screen that is a
 * pencil sketch of the page itself. A blank sheet of warm paper; construction lines; the outlines of the header,
 * the panels and the buttons; headings traced in their own type; text as scribbled lines; the masks shaded with
 * hatching taken from the renders. The sketch is measured from the real page underneath, so when it is complete the
 * paper dissolves, the pencil fades onto the page and the page washes from grey into its colours: the sketch
 * becomes the site.
 *
 * It is as long as loading is. A page that is ready draws in under a second; a slow one keeps drawing, slower and
 * slower, and finishes as soon as everything has arrived (8 s at most). A click, a key or a scroll skips to the end.
 */
(() => {
  'use strict';

  const root = document.documentElement;
  if (!root.classList.contains('intro')) return;

  const MIN_MS = 900;        // the quickest the sketch is ever drawn: a fast computer still sees it happen
  const BLANK_MS = 140;      // the empty sheet, before the first line
  const MAX_MS = 8000;       // never longer than this, loaded or not
  const MORPH_MS = 950;

  const cover = document.createElement('div');
  cover.className = 'intro-cover';
  cover.setAttribute('aria-hidden', 'true');
  cover.innerHTML = '<canvas></canvas>';
  // Over a dark page the pencil turns to gold as it fades (sentinel.css).
  const theme = root.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  if (theme === 'dark') cover.classList.add('is-dark');
  document.body.appendChild(cover);
  const canvas = cover.querySelector('canvas');

  const W = innerWidth;
  const H = innerHeight;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Graphite: a grainy pattern, so every stroke has the tooth of a pencil on paper.
  const grain = document.createElement('canvas');
  grain.width = grain.height = 96;
  const g = grain.getContext('2d');
  const px = g.createImageData(96, 96);
  for (let i = 0; i < px.data.length; i += 4) {
    px.data[i] = 46; px.data[i + 1] = 41; px.data[i + 2] = 34;
    px.data[i + 3] = 90 + Math.random() * 165;
  }
  g.putImageData(px, 0, 0);
  const graphite = ctx.createPattern(grain, 'repeat');

  const rnd = (a, b) => a + Math.random() * (b - a);
  const isApp = Boolean(document.getElementById('view'));

  /* ------------------------------------------------- the strokes */

  // Every stroke is a polyline (drawn point by point) or a word (drawn whole), with a cost in "units" of drawing
  // time. The queue is drawn in order; progress decides how far along it the pencil is.
  const queue = [];
  let total = 0;
  const push = (s) => { s.units = s.units || Math.max(8, s.len || 0); total += s.units; queue.push(s); };

  // A hand-drawn line: slightly bowed, overshooting its ends, wobbling along the way.
  function line(x1, y1, x2, y2, { w = 1.1, a = 0.85, over = 3 } = {}) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 2) return;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const sx = x1 - ux * rnd(0, over);
    const sy = y1 - uy * rnd(0, over);
    const ex = x2 + ux * rnd(0, over);
    const ey = y2 + uy * rnd(0, over);
    const bow = rnd(-1, 1) * Math.min(4, len * 0.012);
    const n = Math.max(2, Math.round(len / 9));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const b = Math.sin(t * Math.PI) * bow;
      pts.push([sx + (ex - sx) * t - uy * b + rnd(-0.45, 0.45), sy + (ey - sy) * t + ux * b + rnd(-0.45, 0.45)]);
    }
    push({ pts, w, a, len });
  }
  // A box, drawn as four separate strokes (and a second, lighter pass for some), the way a sketch is.
  function box(r, { w = 1.1, a = 0.85, twice = false } = {}) {
    const j = () => rnd(-1.5, 1.5);
    line(r.left + j(), r.top + j(), r.right + j(), r.top + j(), { w, a });
    line(r.right + j(), r.top + j(), r.right + j(), r.bottom + j(), { w, a });
    line(r.right + j(), r.bottom + j(), r.left + j(), r.bottom + j(), { w, a });
    line(r.left + j(), r.bottom + j(), r.left + j(), r.top + j(), { w, a });
    if (twice) box({ left: r.left + 2, top: r.top + 1, right: r.right - 1, bottom: r.bottom - 2 }, { w: w * 0.7, a: a * 0.45 });
  }
  function ellipse(cx, cy, rx, ry, { w = 1, a = 0.8 } = {}) {
    const n = 44;
    const start = rnd(0, Math.PI * 2);
    const pts = [];
    for (let i = 0; i <= n + 4; i++) {
      const t = start + (i / n) * Math.PI * 2;
      const k = 1 + rnd(-0.03, 0.03);
      pts.push([cx + Math.cos(t) * rx * k, cy + Math.sin(t) * ry * k]);
    }
    push({ pts, w, a, len: Math.PI * (rx + ry) });
  }
  // Text as a reader's eye sees it in a sketch: a loose scribble along each line.
  function scribble(r) {
    const y = r.top + r.height * 0.58;
    const pts = [];
    for (let x = r.left; x <= r.right; x += 5) pts.push([x, y + Math.sin(x * 0.55) * Math.min(2.2, r.height * 0.12) + rnd(-0.5, 0.5)]);
    if (pts.length > 1) push({ pts, w: 0.9, a: 0.5, len: r.width });
  }
  // Hatching where an image is dark: the masks come out shaded in pencil, from their own renders.
  function hatch(img, r) {
    let data = null;
    const cols = 90;
    const rows = Math.max(1, Math.round(cols * (r.height / r.width)));
    try {
      const c = document.createElement('canvas');
      c.width = cols; c.height = rows;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0, cols, rows);
      data = cx.getImageData(0, 0, cols, rows).data;
    } catch { data = null; }
    if (!data) { box(r, { a: 0.6 }); line(r.left, r.top, r.right, r.bottom, { a: 0.35 }); line(r.right, r.top, r.left, r.bottom, { a: 0.35 }); return; }
    const tone = (x, y) => {
      const c = Math.floor(((x - r.left) / r.width) * cols);
      const rr = Math.floor(((y - r.top) / r.height) * rows);
      if (c < 0 || rr < 0 || c >= cols || rr >= rows) return -1;
      const i = (rr * cols + c) * 4;
      if (data[i + 3] < 110) return -1;
      return (0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]) / 255;
    };
    // Two directions: one for every shaded area, the cross hatch only where it is darkest.
    for (const [dir, limit, alpha] of [[1, 0.78, 0.55], [-1, 0.35, 0.45]]) {
      const step = Math.max(4, r.width / 70);
      for (let k = -r.height; k < r.width; k += step) {
        let run = null;
        const flush = () => { if (run && run.length > 1) push({ pts: run, w: 0.8, a: alpha, len: run.length * 3 }); run = null; };
        for (let s = 0; s <= r.height; s += 3) {
          const x = dir > 0 ? r.left + k + s : r.right - k - s;
          const y = r.top + s;
          const v = tone(x, y);
          if (v >= 0 && v < limit) { (run = run || []).push([x + rnd(-0.4, 0.4), y]); } else flush();
        }
        flush();
      }
    }
  }
  function word(text, rect, style) {
    push({ text, x: rect.left, y: rect.bottom - rect.height * 0.22, font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, units: rect.width * 1.4, a: 0.9 });
  }

  /* ------------------------------------------------- reading the page */

  const done = new WeakSet();
  const onScreen = (r) => r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W;
  // Opacity does not count: parts that fade in after the opening (the site's hero mask) belong in the sketch.
  const visible = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; };

  // Faint construction lines first: the grid the page is laid out on.
  function construction() {
    const guides = [...document.querySelectorAll('header, .nav, .side, main, .main, section, .hero, .wrap, .view')].map((e) => e.getBoundingClientRect()).filter(onScreen).slice(0, 8);
    for (const r of guides) {
      if (r.top > 4) line(0, r.top, W, r.top, { w: 0.6, a: 0.18, over: 0 });
      if (r.left > 4) line(r.left, 0, r.left, H, { w: 0.6, a: 0.16, over: 0 });
    }
  }

  const BLOCKS = 'header, .nav, .side, .panel, .tile, .card, .plan, .plate, .usage-list, .usage-mini, .scanbox, .locked, .feature, .result, .verify-bar, .banner, .footer, .vframe, .demo, .specimen, .tiles3 > *, .stat, .medallion, table';
  const CONTROLS = '.btn, button, input, textarea, select, .chip, .fchip, .side__link, .side__search, .theme-toggle, .seg__btn';
  const TYPE = 'h1, h2, h3, h4, .logo, .kicker, [data-hero-word], .page-title h1, .usage-row__n, .plan__price b';

  function collect() {
    // Containers and frames.
    for (const el of document.querySelectorAll(BLOCKS)) {
      if (done.has(el) || el.closest('.intro-cover')) continue;
      const r = el.getBoundingClientRect();
      if (!onScreen(r) || r.width < 30 || !visible(el)) continue;
      done.add(el);
      box(r, { twice: r.width > 300, a: 0.75 });
    }
    // Buttons, fields and links in the sidebar.
    for (const el of document.querySelectorAll(CONTROLS)) {
      if (done.has(el) || el.closest('.intro-cover')) continue;
      const r = el.getBoundingClientRect();
      if (!onScreen(r) || r.width < 14 || !visible(el)) continue;
      done.add(el);
      box(r, { w: 0.9, a: 0.7 });
    }
    // Headings and names, traced word by word in their own type.
    for (const el of document.querySelectorAll(TYPE)) {
      if (done.has(el) || el.closest('.intro-cover')) continue;
      const er = el.getBoundingClientRect();
      if (!onScreen(er) || !visible(el)) continue;
      done.add(el);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n = 0;
      for (let t = walker.nextNode(); t && n < 60; t = walker.nextNode()) {
        const style = getComputedStyle(t.parentElement);
        const re = /\S+/g;
        let m;
        while ((m = re.exec(t.textContent)) && n < 60) {
          const range = document.createRange();
          range.setStart(t, m.index);
          range.setEnd(t, m.index + m[0].length);
          const r = range.getBoundingClientRect();
          if (onScreen(r)) { word(m[0], r, style); n++; }
        }
      }
    }
    // Everything else that is text: one scribble per line.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (t) => (t.textContent.trim() && t.parentElement && !t.parentElement.closest(`${TYPE}, script, style, .intro-cover, button, .btn`) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)
    });
    let lines = 0;
    for (let t = walker.nextNode(); t && lines < 260; t = walker.nextNode()) {
      if (done.has(t)) continue;
      const pr = t.parentElement.getBoundingClientRect();
      if (!onScreen(pr) || !visible(t.parentElement)) continue;
      done.add(t);
      const range = document.createRange();
      range.selectNodeContents(t);
      for (const r of range.getClientRects()) if (onScreen(r) && r.width > 8) { scribble(r); lines++; }
    }
    // Last, the shading: pictures, the masks shaded from their renders, anything else a crossed frame.
    for (const el of document.querySelectorAll('img, canvas:not(.intro-cover canvas), video')) {
      if (done.has(el)) continue;
      const r = el.getBoundingClientRect();
      if (!onScreen(r) || r.width < 40 || !visible(el)) continue;
      // A picture still loading is shaded on a later pass, from the picture itself.
      if (el.tagName === 'IMG' && !(el.complete && el.naturalWidth)) continue;
      done.add(el);
      if (el.tagName === 'IMG' && el.complete && el.naturalWidth) {
        ellipse(r.left + r.width / 2, r.top + r.height / 2, r.width * 0.42, r.height * 0.46, { a: 0.45, w: 0.8 });
        hatch(el, r);
      } else {
        box(r, { a: 0.6 });
        line(r.left, r.top, r.right, r.bottom, { a: 0.3 });
      }
    }
  }

  /* ------------------------------------------------- drawing */

  let cursor = 0;       // the stroke being drawn
  let inStroke = 0;     // how many of its points are down
  let drawnUnits = 0;

  function drawTo(units) {
    while (cursor < queue.length && drawnUnits < units) {
      const s = queue[cursor];
      if (s.text) {
        ctx.save();
        ctx.font = s.font;
        ctx.globalAlpha = s.a;
        ctx.strokeStyle = graphite;
        ctx.lineWidth = 0.9;
        ctx.strokeText(s.text, s.x + rnd(-0.4, 0.4), s.y + rnd(-0.4, 0.4));
        ctx.globalAlpha = s.a * 0.35;
        ctx.strokeText(s.text, s.x + 0.8, s.y - 0.5);
        ctx.restore();
        drawnUnits += s.units;
        cursor++;
        continue;
      }
      const want = Math.min(s.pts.length, Math.ceil(((units - drawnUnits) / s.units) * s.pts.length) + inStroke);
      if (want > inStroke) {
        ctx.save();
        ctx.globalAlpha = s.a;
        ctx.strokeStyle = graphite;
        ctx.lineWidth = s.w;
        ctx.beginPath();
        const from = Math.max(0, inStroke - 1);
        ctx.moveTo(s.pts[from][0], s.pts[from][1]);
        for (let i = from + 1; i < want; i++) ctx.lineTo(s.pts[i][0], s.pts[i][1]);
        ctx.stroke();
        ctx.restore();
      }
      if (want >= s.pts.length) { drawnUnits += s.units * (1 - inStroke / s.pts.length); inStroke = 0; cursor++; }
      else { drawnUnits += s.units * ((want - inStroke) / s.pts.length); inStroke = want; break; }
    }
  }

  /* ------------------------------------------------- how loaded is it */

  // The site is ready when it has loaded with its fonts; the app when it has also drawn a page that is not still
  // waiting on its skeletons (or has been waiting a while).
  let viewSince = 0;
  function loaded(t) {
    if (document.readyState !== 'complete') return false;
    if (document.fonts && document.fonts.status !== 'loaded') return false;
    if (!isApp) return true;
    const v = document.querySelector('#view .view');
    if (!v) return false;
    if (!viewSince) viewSince = t;
    return !v.querySelector('.skeleton') || t - viewSince > 1500;
  }

  /* ------------------------------------------------- the timeline */

  const start = performance.now();
  let finishing = false;
  let endAt = 0;
  let fromP = 0;
  let fromT = 0;
  let p = 0;
  let lastCollect = -1e9;
  let guided = false;
  let textReady = false;
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { textReady = true; });

  const frame = (now) => {
    if (finishing) return;
    const t = now - start;
    // Read the page again now and then: the app draws itself while the sketch is being made.
    if (t - lastCollect > 220 && (textReady || t > 600)) { lastCollect = t; if (!guided) { guided = true; construction(); } collect(); }
    if (!endAt && (loaded(t) || t > MAX_MS - 600)) {
      // From here the remaining sketch is finished at a steady pace: at least MIN_MS overall, and a little more.
      fromP = p; fromT = t;
      endAt = Math.max(MIN_MS, t + 420);
    }
    if (t < BLANK_MS) p = 0;
    else if (endAt) p = Math.min(1, fromP + (1 - fromP) * Math.min(1, (t - fromT) / Math.max(1, endAt - fromT)));
    else p = 0.9 * (1 - Math.exp(-(t - BLANK_MS) / 1800));   // still loading: slower and slower, never finished
    drawTo(p * total);
    if (p >= 1 && t >= endAt) { setTimeout(morph, 120); return; }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  /* ------------------------------------------------- the morph */

  function morph() {
    if (finishing) return;
    finishing = true;
    drawTo(total);
    try { sessionStorage.setItem('sentinel:intro', '1'); } catch { /* private window: it may play again */ }
    // The page shows through, grey at first, and washes into its colours as the paper and the pencil fade.
    root.classList.add('intro-ink');
    root.classList.remove('intro');
    cover.classList.add('is-morphing');
    document.dispatchEvent(new Event('sentinel:intro-done'));
    requestAnimationFrame(() => root.classList.add('intro-ink-go'));
    setTimeout(() => { root.classList.remove('intro-ink', 'intro-ink-go'); cover.remove(); }, MORPH_MS + 150);
  }
  // Skipping goes straight to the morph, with whatever is drawn so far.
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, () => { if (!finishing) morph(); }, { once: true, passive: true });
})();
