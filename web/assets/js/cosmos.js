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
  const lenses = new Set();   // black holes bending the light right now: { x, y, r, s } in viewport pixels

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
  // Where a star appears: pushed outward and swung round near a black hole, hidden behind its horizon.
  function bend(s) {
    let x = s.x;
    let y = s.y;
    for (const L of lenses) {
      const dx = x - L.x;
      const dy = y - L.y;
      const d = Math.hypot(dx, dy) || 0.001;
      if (d > L.r) continue;
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
      const p = lenses.size ? bend(s) : s;
      if (!p) continue;
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

  // The four diamonds of the scope (top, right, bottom, left) and the beams they send to the centre.
  const DIAMONDS = [[300, 18], [582, 300], [300, 582], [18, 300]];
  function scope(art) {
    let svg = art.querySelector('.bh-scope');
    if (svg) return svg;
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'bh-scope');
    svg.setAttribute('viewBox', '0 0 600 600');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = DIAMONDS.map(([x, y]) => `<line class="bh-beam" x1="${x}" y1="${y}" x2="300" y2="300" pathLength="1"/>`).join('')
      + DIAMONDS.map(([x, y]) => `<path class="bh-gem" d="M${x} ${y - 10}l10 10-10 10-10-10z"/>`).join('')
      + '<circle class="bh-flash" cx="300" cy="300" r="40"/>';
    art.appendChild(svg);
    return svg;
  }
  // Two canvases round the mask: behind it the bent starlight and the far side of the disc; in front of it the
  // horizon, the photon ring and the near side of the disc.
  function hole(art) {
    let back = art.querySelector('.bh-back');
    let front = art.querySelector('.bh-front');
    if (!back) {
      back = document.createElement('canvas'); back.className = 'bh-back'; back.setAttribute('aria-hidden', 'true');
      front = document.createElement('canvas'); front.className = 'bh-front'; front.setAttribute('aria-hidden', 'true');
      art.append(back, front);
    }
    const r = art.getBoundingClientRect();
    const size = Math.round(r.width * 1.3);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    for (const c of [back, front]) { c.width = size * dpr; c.height = size * dpr; c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0); }
    return { back, front, size };
  }

  function drawHole(h, art, color, g, spin) {
    // g: 0..1, how open the hole is.
    const { back, front, size } = h;
    const c = size / 2;
    const R = size * 0.42;          // how far its pull reaches
    const core = size * 0.085 * g;  // the shadow of the horizon
    const bx = back.getContext('2d');
    const fx = front.getContext('2d');
    bx.clearRect(0, 0, size, size);
    fx.clearRect(0, 0, size, size);
    if (g <= 0.001) return;
    const rect = back.getBoundingClientRect();
    const scale = size / rect.width;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // The sky here, bent: a disc of darkness that replaces the page's own sky, with the stars drawn where the hole
    // has thrown their light. Outside R nothing changes.
    if (dark()) {
      const grad = bx.createRadialGradient(c, c, 0, c, c, R);
      grad.addColorStop(0, 'rgba(8,6,4,.96)');
      grad.addColorStop(0.75, 'rgba(8,6,4,.6)');
      grad.addColorStop(1, 'rgba(8,6,4,0)');
      bx.globalAlpha = g;
      bx.fillStyle = grad;
      bx.beginPath(); bx.arc(c, c, R, 0, Math.PI * 2); bx.fill();
      const L = { x: cx, y: cy, r: R / scale, s: g };
      lenses.clear(); lenses.add(L);
      for (const s of stars) {
        if (Math.hypot(s.x - cx, s.y - cy) > L.r * 1.05) continue;
        const p = bend(s);
        if (!p) continue;
        const lx = (p.x - cx) * scale + c;
        const ly = (p.y - cy) * scale + c;
        const fade = 1 - clamp01((Math.hypot(lx - c, ly - c) - R * 0.8) / (R * 0.2));
        bx.globalAlpha = s.a * fade * g;
        bx.fillStyle = s.warm > 0.7 ? '#ffe2b0' : '#f4efe6';
        bx.beginPath(); bx.arc(lx, ly, s.r * scale * 1.1, 0, Math.PI * 2); bx.fill();
      }
      bx.globalAlpha = 1;
    }
    // Drawn as the real thing is seen. The accretion disc is tilted toward us and spins: the side coming toward us
    // is brighter (Doppler beaming), streaked with hot gas. Its near half passes in front of the shadow; its far
    // half is behind, but the hole's gravity bends that light up over the top and under the bottom, so a ring of it
    // wraps the shadow. At the edge of the shadow, a thin photon ring.
    const rgb = hexRgb(color);
    const hot = (k) => `rgb(${Math.round(rgb[0] + (255 - rgb[0]) * k)},${Math.round(rgb[1] + (255 - rgb[1]) * k)},${Math.round(rgb[2] + (255 - rgb[2]) * k)})`;
    const TILT = 0.26;      // how flat the disc looks from here
    const ROLL = -0.22;     // and how it leans
    const band = (ctx, from, to) => {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(ROLL);
      ctx.globalCompositeOperation = 'lighter';
      const rings = 16;
      for (let i = 0; i < rings; i++) {
        const k = i / (rings - 1);
        const rr = core * (1.55 + k * 2.3);
        const profile = Math.pow(1 - k, 1.6) * (0.35 + 0.65 * Math.min(1, k * 6));
        const segs = 56;
        ctx.lineWidth = core * 0.17;
        for (let j = 0; j < segs; j++) {
          const a0 = from + (to - from) * (j / segs);
          const a1 = from + (to - from) * ((j + 1) / segs);
          const mid = (a0 + a1) / 2;
          // Coming toward us on the left; gas streams faster near the middle.
          const doppler = 0.45 + 0.55 * (0.5 - 0.5 * Math.cos(mid));
          const streak = 0.6 + 0.4 * Math.sin(mid * 7 + i * 1.7 - spin * (6 - k * 4)) * Math.sin(mid * 3 - spin * 2.3 + i);
          const alpha = profile * doppler * streak * g;
          if (alpha < 0.01) continue;
          ctx.globalAlpha = Math.min(1, alpha);
          ctx.strokeStyle = hot(0.55 * (1 - k) * doppler);
          ctx.beginPath();
          ctx.ellipse(0, 0, rr, rr * TILT, 0, a0, a1);
          ctx.stroke();
        }
      }
      ctx.restore();
    };
    // Behind the mask: the far half of the disc (the top half, as we see it).
    band(bx, Math.PI, Math.PI * 2);
    // In front, from the back: the bent light of the far side, wrapped round the shadow; the shadow; the photon
    // ring; and the near half of the disc crossing in front of it all.
    fx.save();
    fx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 10; i++) {
      const k = i / 9;
      const rr = core * (1.12 + k * 0.75);
      fx.lineWidth = core * 0.12;
      for (let j = 0; j < 48; j++) {
        const a0 = (j / 48) * Math.PI * 2;
        const a1 = ((j + 1) / 48) * Math.PI * 2;
        const mid = (a0 + a1) / 2;
        // Brightest over the top and under the bottom, where the lensed disc is seen.
        const wrap = Math.pow(Math.abs(Math.sin(mid)), 1.5);
        const doppler = 0.5 + 0.5 * (0.5 - 0.5 * Math.cos(mid + ROLL));
        fx.globalAlpha = Math.min(1, (1 - k) * wrap * doppler * 0.55 * g);
        fx.strokeStyle = hot(0.35 * (1 - k));
        fx.beginPath();
        fx.ellipse(c, c, rr, rr * 0.92, ROLL, a0, a1);
        fx.stroke();
      }
    }
    fx.restore();
    fx.save();
    const shadow = fx.createRadialGradient(c, c, 0, c, c, core * 1.18);
    shadow.addColorStop(0, 'rgba(0,0,0,1)');
    shadow.addColorStop(0.82, 'rgba(0,0,0,1)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    fx.globalAlpha = Math.min(1, g * 1.4);
    fx.fillStyle = shadow;
    fx.beginPath(); fx.arc(c, c, core * 1.18, 0, Math.PI * 2); fx.fill();
    fx.globalCompositeOperation = 'lighter';
    fx.shadowColor = color;
    fx.shadowBlur = core * 0.6;
    fx.strokeStyle = hot(0.7);
    fx.globalAlpha = 0.85 * g;
    fx.lineWidth = Math.max(1, core * 0.05);
    fx.beginPath(); fx.arc(c, c, core * 1.0, 0, Math.PI * 2); fx.stroke();
    fx.restore();
    band(fx, 0, Math.PI);
  }
  function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
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
    const beams = [...svg.querySelectorAll('.bh-beam')];
    const flash = svg.querySelector('.bh-flash');
    const h = hole(art);
    // The timeline, in milliseconds.
    const CHARGE = 700;
    const BEAM = 320;
    const OPEN = 320;
    const SWALLOW = 1100;
    const CLOSE = 260;
    const GROW = 1100;
    const tBeam = CHARGE;
    const tOpen = tBeam + BEAM;
    const tSwallow = tOpen + OPEN;
    const tClose = tSwallow + SWALLOW;
    const tEnd = tClose + CLOSE + GROW;
    const start = performance.now();
    let swallowing = null;
    await new Promise((resolve) => {
      const tick = (now) => {
        const t = now - start;
        // 1. The diamonds charge, brighter and brighter, with a quickening pulse.
        const charge = clamp01(t / CHARGE);
        const pulse = 0.75 + 0.25 * Math.sin(t * 0.018 * (1 + charge * 2));
        const lit = t < tSwallow ? charge * pulse : clamp01(1 - (t - tSwallow) / 400);
        gems.forEach((gm, i) => {
          gm.style.opacity = String(Math.min(1, lit * (0.35 + 0.65 * clamp01((t - i * 90) / CHARGE))));
          gm.style.transform = `scale(${1 + 0.45 * lit})`;
        });
        // 2. They fire: four beams meet in the middle, and a flash where they meet.
        const beam = clamp01((t - tBeam) / BEAM);
        beams.forEach((b) => {
          b.style.strokeDashoffset = String(1 - out(beam));
          b.style.opacity = String(t < tBeam ? 0 : t < tOpen + 200 ? 1 : clamp01(1 - (t - tOpen - 200) / 300));
        });
        const fl = t < tOpen - 80 ? 0 : clamp01(1 - (t - tOpen + 80) / 420);
        flash.style.opacity = String(fl);
        flash.style.transform = `scale(${0.4 + (1 - fl) * 1.6})`;
        // 3. The hole opens, takes the mask, and closes from the outside in.
        let g = 0;
        if (t >= tOpen && t < tClose) g = out(clamp01((t - tOpen) / OPEN)) * (1 + 0.15 * clamp01((t - tSwallow) / SWALLOW));
        else if (t >= tClose) g = 1.15 * (1 - ease(clamp01((t - tClose) / (CLOSE + 260))));
        drawHole(h, art, color, Math.min(1.15, g), t / 1000);
        if (dark() && g > 0.001) paint();
        if (t >= tSwallow && !swallowing) swallowing = m3.swallow(sev, { out: SWALLOW, gap: CLOSE, grow: GROW });
        if (t < tEnd) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    await swallowing;
    lenses.clear();
    paint();
    drawHole(h, art, color, 0, 0);
    gems.forEach((gm) => { gm.style.opacity = '0'; });
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
