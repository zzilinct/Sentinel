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
      return { x: rand() * W, y: rand() * H, r: b > 0.985 ? 1.5 : b > 0.9 ? 1.05 : 0.6, a: 0.25 + rand() * 0.6, warm: rand() };
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
    const core = size * 0.11 * g;   // the horizon
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
    // The accretion disc, tilted: its far half behind the mask, its near half in front.
    const disc = (ctx, from, to) => {
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate(-0.32);
        ctx.scale(1, 0.32);
        const rr = core * (2.1 + i * 0.55);
        ctx.strokeStyle = color;
        ctx.globalAlpha = (0.55 - i * 0.15) * g;
        ctx.lineWidth = core * (0.55 - i * 0.12);
        ctx.shadowColor = color;
        ctx.shadowBlur = 24;
        ctx.setLineDash([core * (1.6 + i), core * 0.5]);
        ctx.lineDashOffset = -spin * (60 + i * 25);
        ctx.beginPath(); ctx.arc(0, 0, rr, from, to); ctx.stroke();
        ctx.restore();
      }
    };
    disc(bx, Math.PI, Math.PI * 2);
    disc(fx, 0, Math.PI);
    // The horizon, and the photon ring of light that circles just outside it.
    fx.save();
    fx.shadowColor = color;
    fx.shadowBlur = core * 1.4;
    fx.globalAlpha = g;
    fx.strokeStyle = color;
    fx.lineWidth = Math.max(1.5, core * 0.14);
    fx.beginPath(); fx.arc(c, c, core * 1.08, 0, Math.PI * 2); fx.stroke();
    fx.shadowBlur = 0;
    fx.fillStyle = '#000';
    fx.beginPath(); fx.arc(c, c, core, 0, Math.PI * 2); fx.fill();
    fx.restore();
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
