/*
 * The opening, once per visit (boot.js decides, before the first paint, and puts html.intro on). The onyx mask
 * arrives as a field of glowing gold cells, glitching in bands of gold, orange and red, the colours of Sentinel's
 * masks; a scan line resolves it into the real render, the name rises beneath, and the curtain lifts.
 *
 * It never stands between anyone and the page: a click, a key or a scroll skips it, it gives up if the mask is slow
 * to load, and boot.js removes the cover on its own after 4 s whatever happens here.
 */
(() => {
  'use strict';

  const root = document.documentElement;
  if (!root.classList.contains('intro')) return;

  const SRC = '/assets/img/masks/onyx.webp';
  const cover = document.createElement('div');
  cover.className = 'intro-cover';
  cover.setAttribute('aria-hidden', 'true');
  cover.innerHTML = '<canvas></canvas><div class="intro-cover__name"></div>';
  document.body.appendChild(cover);
  const canvas = cover.querySelector('canvas');
  const name = cover.querySelector('.intro-cover__name');
  name.innerHTML = [...'SENTINEL'].map((c) => `<span>${c}</span>`).join('');

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    try { sessionStorage.setItem('sentinel:intro', '1'); } catch { /* private window: it may play again */ }
    cover.classList.add('is-leaving');
    root.classList.remove('intro');
    document.dispatchEvent(new Event('sentinel:intro-done'));
    setTimeout(() => cover.remove(), 900);
  };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, finish, { once: true, passive: true });

  const img = new Image();
  img.src = SRC;
  const ready = img.decode ? img.decode() : new Promise((ok, no) => { img.onload = ok; img.onerror = no; });
  // Slow network: no opening rather than a late one.
  const slow = setTimeout(finish, 1200);
  ready.then(() => { clearTimeout(slow); if (!done) play(); }, finish);

  function play() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = innerWidth;
    const H = innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // The mask, about half the screen tall, centred a little above the middle.
    const mh = Math.min(H * 0.5, W * 0.62);
    const mw = mh * (img.naturalWidth / img.naturalHeight);
    const mx = (W - mw) / 2;
    const my = H * 0.44 - mh / 2;

    // Sample the render into cells: brightness and alpha decide what each cell shows.
    const CELL = Math.max(6, Math.round(mh / 64));
    const cols = Math.ceil(mw / CELL);
    const rows = Math.ceil(mh / CELL);
    const probe = document.createElement('canvas');
    probe.width = cols;
    probe.height = rows;
    const p = probe.getContext('2d', { willReadFrequently: true });
    p.drawImage(img, 0, 0, cols, rows);
    const data = p.getImageData(0, 0, cols, rows).data;
    const GLYPHS = ' .:-+*#%';
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = (r * cols + c) * 4;
        const a = data[i + 3] / 255;
        if (a < 0.35) continue;
        const lum = (0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]) / 255;
        cells.push({ x: mx + c * CELL, y: my + r * CELL, lum, at: Math.random() * 650, glyph: GLYPHS[Math.min(GLYPHS.length - 1, 1 + Math.floor(lum * (GLYPHS.length - 1)))] });
      }
    }

    // The cells are drawn on their own layer, then laid down twice: blurred for the glow, sharp on top.
    const layer = document.createElement('canvas');
    layer.width = canvas.width;
    layer.height = canvas.height;
    const lx = layer.getContext('2d');
    lx.scale(dpr, dpr);
    lx.font = `600 ${CELL * 1.15}px 'JetBrains Mono', ui-monospace, monospace`;
    lx.textAlign = 'center';
    lx.textBaseline = 'middle';
    const T_IN = 700;      // cells arrive
    const T_SCAN = 1350;   // the scan line has crossed: the render is whole
    const T_NAME = 1100;   // the name starts to rise
    const T_END = 2150;    // the curtain lifts
    const start = performance.now();
    let bands = [];

    const frame = (now) => {
      if (done) return;
      const t = now - start;
      ctx.clearRect(0, 0, W, H);

      // Glitch bands: a few rows of the field jump sideways for a frame or two, split into gold, orange and red.
      if (t < T_SCAN && Math.random() < 0.22) {
        bands = Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => ({ y: my + Math.random() * mh, h: CELL * (1 + Math.floor(Math.random() * 4)), dx: (Math.random() - 0.5) * CELL * 6 }));
      } else if (Math.random() < 0.5) bands = [];
      const shiftAt = (y) => { for (const b of bands) if (y >= b.y && y < b.y + b.h) return b.dx; return 0; };

      // Above the scan line the real render shows through.
      const scanY = t < T_IN ? my - 1 : my + mh * Math.min(1, (t - T_IN) / (T_SCAN - T_IN));
      if (scanY > my) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W, scanY);
        ctx.clip();
        ctx.globalAlpha = Math.min(1, (t - T_IN) / 300);
        ctx.drawImage(img, mx, my, mw, mh);
        ctx.restore();
      }

      // The cells: below the scan line, and fading out just above it.
      lx.clearRect(0, 0, W, H);
      for (const c of cells) {
        if (t < c.at) continue;
        const above = scanY - c.y;
        if (above > CELL * 6) continue;
        const life = Math.min(1, (t - c.at) / 160);
        const fade = above > 0 ? 1 - above / (CELL * 6) : 1;
        const flicker = t < T_IN && Math.random() < 0.06 ? 0.25 : 1;
        const dx = shiftAt(c.y);
        const alpha = life * fade * flicker * (0.35 + c.lum * 0.75);
        if (dx) {
          lx.fillStyle = `rgba(232, 74, 72, ${alpha * 0.8})`;
          lx.fillText(c.glyph, c.x + dx - CELL * 0.6, c.y);
          lx.fillStyle = `rgba(240, 138, 36, ${alpha * 0.8})`;
          lx.fillText(c.glyph, c.x + dx + CELL * 0.6, c.y);
        }
        lx.fillStyle = `rgba(${Math.round(210 + 33 * c.lum)}, ${Math.round(172 + 48 * c.lum)}, ${Math.round(99 + 65 * c.lum)}, ${alpha})`;
        lx.fillText(c.glyph, c.x + dx, c.y);
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = `blur(${CELL * dpr}px)`;
      ctx.drawImage(layer, 0, 0);
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(layer, 0, 0);
      ctx.restore();

      // The scan line itself: a bright gold thread with a soft glow.
      if (t >= T_IN && t < T_SCAN + 120) {
        const g = ctx.createLinearGradient(mx - 60, 0, mx + mw + 60, 0);
        g.addColorStop(0, 'rgba(243, 220, 164, 0)');
        g.addColorStop(0.5, 'rgba(243, 220, 164, 0.95)');
        g.addColorStop(1, 'rgba(243, 220, 164, 0)');
        ctx.fillStyle = g;
        ctx.shadowColor = 'rgba(243, 220, 164, 0.8)';
        ctx.shadowBlur = 18;
        ctx.fillRect(mx - 60, scanY - 1, mw + 120, 2);
        ctx.shadowBlur = 0;
      }

      if (t >= T_NAME && !name.classList.contains('is-in')) name.classList.add('is-in');
      if (t >= T_END) { finish(); return; }
      requestAnimationFrame(frame);
    };
    name.style.top = `${my + mh + Math.min(40, H * 0.05)}px`;
    requestAnimationFrame(frame);
  }
})();
