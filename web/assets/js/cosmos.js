/*
 * The night behind the site, and what happens in it.
 *
 *   Stars        a field of distant stars behind every page in the dark theme (a still canvas: drawn once, and
 *                again only when the window changes size or something bends their light).
 *   Black hole   on the threat plates, when the severity changes: the scope's four diamonds charge with the new
 *                colour and beam it to the centre, a black hole of that colour opens, bends the starlight around it,
 *                and swallows the mask from the outside in; the hole closes from the outside in, and the new mask
 *                grows back from the inside out.          window.SentinelBlackHole.play(card, severity)
 *   3D masks     mask3d.js (three.js and the Blender models, about 160 KB compressed) is fetched only on a page that
 *                has a mask, and for a mask the app adds later.   window.SentinelLoadMask3D()
 *
 * Reduced motion: no black hole (the mask simply changes colour), and the stars stay still as they always are.
 */
(() => {
  'use strict';

  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const script = document.currentScript;
  const here = script ? new URL('.', script.src).href : '/assets/js/';

  /* ------------------------------------------------------- 3D masks, on demand */

  let loading = null;
  function loadMask3D() {
    if (window.SentinelMask3D) { window.SentinelMask3D.scan(); return Promise.resolve(window.SentinelMask3D); }
    if (!loading) {
      loading = new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = `${here}mask3d.js`;
        s.onload = () => resolve(window.SentinelMask3D || null);
        s.onerror = () => resolve(null);
        document.head.appendChild(s);
      });
    }
    return loading.then((m) => { if (m) m.scan(); return m; });
  }
  window.SentinelLoadMask3D = loadMask3D;
  const whenReady = (fn) => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn());
  whenReady(() => { if (document.querySelector('[data-mask3d]')) loadMask3D(); });

  /* ------------------------------------------------------------------- stars */

  const dark = () => root.dataset.theme === 'dark' || (!root.dataset.theme && !matchMedia('(prefers-color-scheme: light)').matches);
  let sky = null;
  let stars = [];

  function makeSky() {
    sky = document.createElement('canvas');
    sky.className = 'cosmos';
    sky.setAttribute('aria-hidden', 'true');
    document.body.prepend(sky);
    addEventListener('resize', () => { seed(); paint(); }, { passive: true });
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', paint);
    new MutationObserver(paint).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    seed();
    paint();
  }
  function seed() {
    const W = innerWidth;
    const H = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    sky.width = W * dpr;
    sky.height = H * dpr;
    sky.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    // A seeded scatter, so the sky is the same on every page and every visit.
    let x = 1234567;
    const rand = () => ((x = (x * 16807) % 2147483647) / 2147483647);
    stars = Array.from({ length: Math.round((W * H) / 5200) }, () => {
      const b = rand();
      return { x: rand() * W, y: rand() * H, r: b > 0.985 ? 1.7 : b > 0.9 ? 1.2 : 0.75, a: 0.35 + rand() * 0.6, warm: rand() };
    });
  }
  // Where a star appears near a black hole L ({ x, y, r, s } in viewport pixels): pushed outward and swung round,
  // or hidden behind its horizon.
  function bend(s, L) {
    let x = s.x;
    let y = s.y;
    {
      const dx = x - L.x;
      const dy = y - L.y;
      const d = Math.hypot(dx, dy) || 0.001;
      if (d > L.r) return { x, y };
      const fall = (1 - d / L.r) ** 2;
      const horizon = L.r * 0.16 * L.s;
      if (d < horizon) return null;
      // Light passing close is bent around the hole: an Einstein ring forms just outside the horizon.
      const push = (L.r * 0.22 * L.s) ** 2 / d * fall;
      const turn = 1.4 * L.s * fall;
      const nd = d + push;
      const c = Math.cos(turn);
      const sn = Math.sin(turn);
      const ux = dx / d;
      const uy = dy / d;
      x = L.x + (ux * c - uy * sn) * nd;
      y = L.y + (ux * sn + uy * c) * nd;
    }
    return { x, y };
  }
  function paint() {
    if (!sky) return;
    const ctx = sky.getContext('2d');
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (!dark()) return;
    for (const s of stars) {
      const p = s;
      ctx.globalAlpha = s.a;
      ctx.fillStyle = s.warm > 0.7 ? '#ffe2b0' : s.warm > 0.2 ? '#f4efe6' : '#cfdcff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  whenReady(() => { if (document.querySelector('link[href*="lux.css"]') || document.body.classList.contains('app')) makeSky(); });

  /* -------------------------------------------------------------- black hole */

  const COLORS = { yellow: '#f5c542', orange: '#f08a24', red: '#e5484d' };
  const NS = 'http://www.w3.org/2000/svg';
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const out = (u) => 1 - Math.pow(1 - u, 3);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const tint = (rgb, k, a = 1) => `rgba(${Math.round(rgb[0] + (255 - rgb[0]) * k)},${Math.round(rgb[1] + (255 - rgb[1]) * k)},${Math.round(rgb[2] + (255 - rgb[2]) * k)},${a})`;

  // The scope's four diamonds (top, right, bottom, left), the arcs of its circle that join them, and the beams they
  // send to the centre.
  const DIAMONDS = [[300, 18], [582, 300], [300, 582], [18, 300]];
  const ARCS = ['M300 10A290 290 0 0 1 590 300', 'M590 300A290 290 0 0 1 300 590', 'M300 590A290 290 0 0 1 10 300', 'M10 300A290 290 0 0 1 300 10'];
  function scope(art) {
    let svg = art.querySelector('.bh-scope');
    if (svg) return svg;
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'bh-scope');
    svg.setAttribute('viewBox', '0 0 600 600');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ARCS.map((d) => `<path class="bh-arc" d="${d}" pathLength="1"/>`).join('')
      + DIAMONDS.map(([x, y]) => `<line class="bh-beam" x1="${x}" y1="${y}" x2="300" y2="300" pathLength="1"/>`).join('')
      + DIAMONDS.map(([x, y]) => `<path class="bh-gem" d="M${x} ${y - 10}l10 10-10 10-10-10z"/>`).join('')
      + '<circle class="bh-flash" cx="300" cy="300" r="40"/>';
    art.appendChild(svg);
    return svg;
  }

  /*
   * The hole's pieces are drawn once per colour into small sprites and only placed, turned and scaled each frame:
   * the accretion disc seen face-on (it is tilted and spun as it is drawn), and the halo of light the hole bends
   * round its shadow. No blur is computed while it plays.
   */
  const sprites = new Map();
  function spritesFor(color) {
    if (sprites.has(color)) return sprites.get(color);
    const rgb = hexRgb(color);
    const S = 512;
    const c = S / 2;
    // The disc: hot and bright near the inner edge, fading out, streaked with gas in rings.
    const disc = document.createElement('canvas');
    disc.width = disc.height = S;
    const d = disc.getContext('2d');
    d.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 70; i++) {
      const k = i / 69;
      const r = c * (0.36 + k * 0.62);
      const a = Math.pow(1 - k, 1.5) * (0.4 + 0.6 * Math.min(1, k * 7));
      for (let j = 0; j < 9; j++) {
        const from = Math.random() * Math.PI * 2;
        d.strokeStyle = tint(rgb, 0.6 * (1 - k), a * (0.25 + Math.random() * 0.5));
        d.lineWidth = 1.5 + Math.random() * 3;
        d.beginPath();
        d.arc(c, c, r, from, from + 0.4 + Math.random() * 1.6);
        d.stroke();
      }
    }
    const soft = document.createElement('canvas');
    soft.width = soft.height = S;
    const sd = soft.getContext('2d');
    sd.filter = 'blur(6px)';
    sd.drawImage(disc, 0, 0);
    sd.filter = 'none';
    sd.globalCompositeOperation = 'lighter';
    sd.drawImage(disc, 0, 0);
    // The halo: the far side's light bent over the top and under the bottom of the shadow.
    const halo = document.createElement('canvas');
    halo.width = halo.height = S;
    const h = halo.getContext('2d');
    h.filter = 'blur(5px)';
    for (let i = 0; i < 14; i++) {
      const k = i / 13;
      h.strokeStyle = tint(rgb, 0.45 * (1 - k), 0.5 * (1 - k));
      h.lineWidth = 6;
      h.beginPath();
      h.ellipse(c, c, c * (0.44 + k * 0.3), c * (0.44 + k * 0.3) * 0.94, 0, 0, Math.PI * 2);
      h.stroke();
    }
    h.filter = 'none';
    h.globalCompositeOperation = 'destination-in';
    // Brightest top and bottom, where the lensed disc is seen.
    const band = h.createLinearGradient(0, 0, S, 0);
    band.addColorStop(0, 'rgba(0,0,0,.25)');
    band.addColorStop(0.35, 'rgba(0,0,0,1)');
    band.addColorStop(0.65, 'rgba(0,0,0,1)');
    band.addColorStop(1, 'rgba(0,0,0,.25)');
    h.fillStyle = band;
    h.fillRect(0, 0, S, S);
    const set = { disc: soft, halo, rgb };
    sprites.set(color, set);
    return set;
  }

  // Two canvases round the mask: behind it the bent starlight and the far side of the disc; in front of it the
  // halo, the shadow and photon ring, and the near side of the disc. Twice the plate's size, so the pull on the
  // stars can reach well beyond the mask as the hole grows; drawn at screen resolution at most (a glow needs no more).
  function hole(art) {
    let back = art.querySelector('.bh-back');
    let front = art.querySelector('.bh-front');
    if (!back) {
      back = document.createElement('canvas'); back.className = 'bh-back'; back.setAttribute('aria-hidden', 'true');
      front = document.createElement('canvas'); front.className = 'bh-front'; front.setAttribute('aria-hidden', 'true');
      art.append(back, front);
    }
    const r = art.getBoundingClientRect();
    const size = Math.round(r.width * 2);
    const dpr = Math.min(devicePixelRatio || 1, 1);
    for (const c of [back, front]) { c.width = size * dpr; c.height = size * dpr; c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0); }
    return { back, front, size };
  }

  const TILT = 0.27;     // how flat the disc looks from here
  const ROLL = -0.22;    // and how it leans
  // g: how open the hole is (0..1); eat: how far it has grown over the mask (0..1); spin in radians.
  function drawHole(h, color, g, eat, spin) {
    const { back, front, size } = h;
    const c = size / 2;
    const bx = back.getContext('2d');
    const fx = front.getContext('2d');
    bx.clearRect(0, 0, size, size);
    fx.clearRect(0, 0, size, size);
    if (g <= 0.001) return;
    const sp = spritesFor(color);
    // The shadow grows from a point to the size of the mask as it feeds (mask3d.js grows its horizon in step).
    const core = size * (0.055 + 0.15 * eat) * g;
    // Its pull on the starlight reaches further as it grows.
    const R = Math.min(c * 0.98, core * 3.4 + size * 0.1);
    const discR = core * (3.9 - 1.9 * eat);
    const rect = back.getBoundingClientRect();
    const scale = size / Math.max(1, rect.width);
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // The sky here, bent: a disc of darkness over the page's own sky, with the stars drawn where the hole has
    // thrown their light. Outside R nothing changes.
    if (dark()) {
      const grad = bx.createRadialGradient(c, c, 0, c, c, R);
      grad.addColorStop(0, 'rgba(8,6,4,.97)');
      grad.addColorStop(0.7, 'rgba(8,6,4,.7)');
      grad.addColorStop(1, 'rgba(8,6,4,0)');
      bx.globalAlpha = g;
      bx.fillStyle = grad;
      bx.beginPath(); bx.arc(c, c, R, 0, Math.PI * 2); bx.fill();
      const L = { x: cx, y: cy, r: R / scale, s: Math.min(1.4, g * (1 + eat)) };
      for (const s of stars) {
        if (Math.abs(s.x - cx) > L.r || Math.abs(s.y - cy) > L.r) continue;
        const p = bend(s, L);
        if (!p) continue;
        const lx = (p.x - cx) * scale + c;
        const ly = (p.y - cy) * scale + c;
        const fade = 1 - clamp01((Math.hypot(lx - c, ly - c) - R * 0.8) / (R * 0.2));
        bx.globalAlpha = s.a * fade * g;
        bx.fillStyle = s.warm > 0.7 ? '#ffe2b0' : '#f4efe6';
        const z = s.r * scale * 1.6;
        bx.fillRect(lx - z / 2, ly - z / 2, z, z);
      }
      bx.globalAlpha = 1;
    }
    // The disc: face-on sprite, spun, tilted and leaned; the far half under the shadow, the near half over it, and
    // the side coming toward us drawn a second time, brighter.
    const disc = (ctx, near) => {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(ROLL);
      ctx.scale(1, TILT);
      ctx.beginPath();
      ctx.rect(-discR, near ? 0 : -discR, discR * 2, discR);
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.85 * g;
      ctx.rotate(spin);
      ctx.drawImage(sp.disc, -discR, -discR, discR * 2, discR * 2);
      ctx.rotate(-spin);
      ctx.beginPath();
      ctx.rect(-discR, -discR, discR, discR * 2);
      ctx.clip();
      ctx.globalAlpha = 0.55 * g;
      ctx.rotate(spin);
      ctx.drawImage(sp.disc, -discR, -discR, discR * 2, discR * 2);
      ctx.restore();
    };
    // Both halves on the one canvas, so they meet without a seam: the far half first, under the halo and shadow.
    disc(fx, false);
    fx.save();
    fx.globalCompositeOperation = 'lighter';
    fx.globalAlpha = 0.9 * g;
    const hr = core * 2.3;
    fx.translate(c, c);
    fx.rotate(ROLL);
    fx.drawImage(sp.halo, -hr, -hr, hr * 2, hr * 2);
    fx.restore();
    // The shadow, soft at its edge, and the thin photon ring that circles it.
    fx.save();
    const shadow = fx.createRadialGradient(c, c, 0, c, c, core * 1.18);
    shadow.addColorStop(0, 'rgba(0,0,0,1)');
    shadow.addColorStop(0.83, 'rgba(0,0,0,1)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    fx.globalAlpha = Math.min(1, g * 1.4);
    fx.fillStyle = shadow;
    fx.beginPath(); fx.arc(c, c, core * 1.18, 0, Math.PI * 2); fx.fill();
    fx.globalCompositeOperation = 'lighter';
    fx.strokeStyle = tint(sp.rgb, 0.7, 0.9 * g);
    fx.lineWidth = Math.max(1, core * 0.045);
    fx.beginPath(); fx.arc(c, c, core, 0, Math.PI * 2); fx.stroke();
    fx.restore();
    disc(fx, true);
  }

  const busy = new WeakSet();
  async function play(card, sev) {
    const art = card.querySelector('.plate__art');
    const color = COLORS[sev] || COLORS.red;
    const m3 = window.SentinelMask3D && art && window.SentinelMask3D.get(art);
    if (!art || reduced || !m3) { if (m3) m3.blend(sev, 500); return; }
    if (busy.has(card)) { card.dataset.queued = sev; return; }
    busy.add(card);
    card.classList.add('is-singular');
    const svg = scope(art);
    svg.style.setProperty('--bh', color);
    const gems = [...svg.querySelectorAll('.bh-gem')];
    const arcs = [...svg.querySelectorAll('.bh-arc')];
    const beams = [...svg.querySelectorAll('.bh-beam')];
    const flash = svg.querySelector('.bh-flash');
    const h = hole(art);
    spritesFor(color);
    // The timeline, in milliseconds: the diamonds charge, the ring joining them lights from each diamond to the
    // next, they fire to the centre, the hole opens and feeds until the mask is gone, closes, and the new mask
    // comes out of it.
    const CHARGE = 650;
    const RING = 420;
    const BEAM = 300;
    const OPEN = 320;
    const FEED = 1400;
    const CLOSE = 300;
    const GROW = 1100;
    const tRing = CHARGE;
    const tBeam = tRing + RING;
    const tOpen = tBeam + BEAM;
    const tFeed = tOpen + OPEN;
    const tClose = tFeed + FEED;
    const tEnd = tClose + CLOSE + GROW;
    const start = performance.now();
    let feeding = null;
    await new Promise((resolve) => {
      const tick = (now) => {
        const t = now - start;
        // 1. The diamonds charge, brighter and brighter, with a quickening pulse.
        const charge = clamp01(t / CHARGE);
        const pulse = 0.75 + 0.25 * Math.sin(t * 0.018 * (1 + charge * 2));
        const lit = t < tFeed ? charge * pulse : clamp01(1 - (t - tFeed) / 400);
        gems.forEach((gm, i) => {
          gm.style.opacity = String(Math.min(1, lit * (0.35 + 0.65 * clamp01((t - i * 90) / CHARGE))));
          gm.style.transform = `scale(${1 + 0.45 * lit})`;
        });
        // 2. The ring lights: each arc runs from its diamond to the next.
        const ring = out(clamp01((t - tRing) / RING));
        const ringOn = t < tRing ? 0 : t < tClose ? 1 : clamp01(1 - (t - tClose) / 500);
        arcs.forEach((a) => { a.style.strokeDashoffset = String(1 - ring); a.style.opacity = String(ringOn); });
        // 3. They fire: four beams meet in the middle, with a flash where they meet.
        const beam = clamp01((t - tBeam) / BEAM);
        beams.forEach((b) => {
          b.style.strokeDashoffset = String(1 - out(beam));
          b.style.opacity = String(t < tBeam ? 0 : t < tOpen + 200 ? 1 : clamp01(1 - (t - tOpen - 200) / 300));
        });
        const fl = t < tOpen - 80 ? 0 : clamp01(1 - (t - tOpen + 80) / 420);
        flash.style.opacity = String(fl);
        flash.style.transform = `scale(${0.4 + (1 - fl) * 1.6})`;
        // 4. The hole opens, feeds on the mask as it grows, and closes from the outside in.
        let g = 0;
        let eat = 0;
        if (t >= tOpen && t < tClose) {
          g = out(clamp01((t - tOpen) / OPEN));
          eat = ease(clamp01((t - tFeed) / FEED));
        } else if (t >= tClose) {
          g = 1 - ease(clamp01((t - tClose) / (CLOSE + 200)));
          eat = 1;
        }
        drawHole(h, color, g, eat, t / 380);
        if (t >= tFeed && !feeding) feeding = m3.swallow(sev, { out: FEED, gap: CLOSE, grow: GROW });
        if (t < tEnd) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    await feeding;
    drawHole(h, color, 0, 0, 0);
    gems.forEach((gm) => { gm.style.opacity = '0'; });
    arcs.forEach((a) => { a.style.opacity = '0'; });
    card.classList.remove('is-singular');
    busy.delete(card);
    // A choice made while the hole was busy: follow it now, quietly.
    if (card.dataset.queued) { const q = card.dataset.queued; delete card.dataset.queued; if (q !== sev) m3.blend(q, 600); }
  }

  // The quieter change, for the plates' automatic steps up in severity: the diamonds glow once in the new colour
  // and the metal shifts to it.
  function pulse(card, sev) {
    const art = card.querySelector('.plate__art');
    const m3 = window.SentinelMask3D && art && window.SentinelMask3D.get(art);
    if (!m3) return;
    m3.blend(sev, 900);
    if (reduced || busy.has(card)) return;
    const svg = scope(art);
    svg.style.setProperty('--bh', COLORS[sev] || COLORS.red);
    const gems = [...svg.querySelectorAll('.bh-gem')];
    const start = performance.now();
    const tick = (now) => {
      const u = clamp01((now - start) / 900);
      const v = Math.sin(u * Math.PI);
      gems.forEach((gm, i) => { gm.style.opacity = String(v * clamp01(u * 4 - i * 0.25)); gm.style.transform = `scale(${1 + 0.3 * v})`; });
      if (u < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  window.SentinelBlackHole = { play, pulse, COLORS };
})();
