/*
 * Hover, as one idea: the pointer is a lamp, and the masks are watching it.
 *
 *   Gaze     every mask turns to look at the pointer while it is near, looks away when it leaves, and after a while
 *            faces forward again. The hero mask's eyes light up while it watches.        [data-gaze="range in px"]
 *   Lamp     raised surfaces are lit by the pointer: their shadow falls away from it and the edge facing it catches
 *            the light, so a card is never lifted or enlarged, only lit differently.
 *   Gold     gold buttons carry a specular highlight under the pointer, like polished metal.
 *   Sheen    cast-gold letters (the wordmark, prices, medallion numbers) turn their light toward the pointer.
 *   Ink      links fill with gold from the side the pointer came in, and drain out of the side it leaves.
 *   Trace    rows and options have an engraved border that draws itself from where the pointer entered.
 *
 * Mouse only, and nothing at all with reduced motion; the CSS that goes with it (hover.css) only applies under
 * html.hv, which this file sets. Nothing here hides content or changes layout.
 */
(() => {
  'use strict';

  if (!matchMedia('(hover: hover) and (pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const root = document.documentElement;
  root.classList.add('hv');
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a = -1, b = 1) => Math.max(a, Math.min(b, v));

  const LAMP = '.btn:not(.btn--gold):not(.btn--ghost), .chip-q:not([aria-selected="true"]), .chip, .fchip, .card, .tile, .plan, .stat, .answer, .plate__info, .finder__q, .finder__answer, .hero__card, .game, .try, .kinds, .faq details, .window, .float, .compare-wrap, .panel, .feature, .usage-list, .models--bar';
  const GOLD = '.btn--gold, .chip-q[aria-selected="true"], .seg__btn.is-on';
  const SHEEN = '.stat, .plan';
  const INK = '.footer ul a, .legal-links a, .prose a, .nav__links a, .auth__switch a, .pricing__note a, .scan-meta a, .side__foot a';
  const TRACE = '.answer, .kind, .faq details, .vault__item, .finder__q, .step, .rail a, .models__opt, .list li.is-link, .usage-link, .severity button, .stage__chips .chip-q';

  let px = -1e5;
  let py = -1e5;
  let present = false;
  let frame = 0;
  const wake = () => { if (!frame) frame = requestAnimationFrame(tick); };

  addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; present = true; wake(); }, { passive: true });
  // The pointer left the window: every mask is free to look away.
  document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) { present = false; wake(); } });
  addEventListener('blur', () => { present = false; wake(); });
  addEventListener('scroll', wake, { passive: true });

  /* --------------------------------------------------------------- gaze */

  const gazers = [];
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) { const g = gazers.find((x) => x.el === e.target); if (g) g.visible = e.isIntersecting; }
    wake();
  });
  function watch(el) {
    if (gazers.some((g) => g.el === el)) return;
    const g = { el, range: Number(el.dataset.gaze) || 420, max: Number(el.dataset.gazeMax) || 1, cur: { x: 0, y: 0, g: 0 }, tgt: { x: 0, y: 0, g: 0 }, mode: 'rest', until: 0, visible: true };
    gazers.push(g);
    seen.observe(el);
  }
  $$('[data-gaze]').forEach(watch);

  function gaze(g, t) {
    const r = g.el.getBoundingClientRect();
    const dx = px - (r.left + r.width / 2);
    const dy = py - (r.top + r.height / 2);
    const near = present && Math.hypot(dx, dy) < g.range;
    if (near) {
      // Watching: turned toward the pointer, the eyes lit, brightest when it first notices.
      if (g.mode !== 'watch') g.cur.g = Math.max(g.cur.g, 0.6);
      g.mode = 'watch';
      g.tgt = { x: clamp(dx / (g.range * 0.62)), y: clamp(dy / (g.range * 0.62)), g: 1 };
    } else if (g.mode === 'watch') {
      // Out of range: it looks away, to the other side and a little down, then faces forward again.
      g.mode = 'away';
      g.until = t + 1800;
      g.tgt = { x: -(Math.sign(dx) || 1) * 0.85, y: 0.32, g: 0 };
    } else if (g.mode === 'away' && t > g.until) {
      g.mode = 'rest';
      g.tgt = { x: 0, y: 0, g: 0 };
    }
    const k = g.mode === 'watch' ? 0.085 : g.mode === 'away' ? 0.045 : 0.028;
    let moving = g.mode === 'away';
    for (const key of ['x', 'y', 'g']) {
      const d = g.tgt[key] - g.cur[key];
      if (Math.abs(d) > 0.0015) { g.cur[key] += d * k; moving = true; } else g.cur[key] = g.tgt[key];
    }
    const ry = g.cur.x * 26 * g.max;
    const rx = -g.cur.y * 18 * g.max;
    g.el.style.transform = `perspective(1100px) translate3d(${(g.cur.x * 12 * g.max).toFixed(2)}px, ${(g.cur.y * 8 * g.max).toFixed(2)}px, 0) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    g.el.style.setProperty('--gaze', g.cur.g.toFixed(3));
    g.el.style.setProperty('--gx', g.cur.x.toFixed(3));
    g.el.style.setProperty('--gy', g.cur.y.toFixed(3));
    return moving;
  }

  /* ------------------------------------------------------ lamp and gold */

  let lit = null;
  let gilt = null;
  let sheened = null;
  function light(el, cls) {
    const r = el.getBoundingClientRect();
    const x = clamp((px - r.left) / r.width * 2 - 1);
    const y = clamp((py - r.top) / r.height * 2 - 1);
    el.style.setProperty('--lx', x.toFixed(3));
    el.style.setProperty('--ly', y.toFixed(3));
    el.style.setProperty('--mx', `${(px - r.left).toFixed(1)}px`);
    el.style.setProperty('--my', `${(py - r.top).toFixed(1)}px`);
    el.classList.add(cls);
    return { x, y };
  }
  const swap = (prev, next, cls) => { if (prev && prev !== next) prev.classList.remove(cls); return next; };

  /* -------------------------------------------------------- the wordmark */

  const word = document.querySelector('[data-hero-word]');
  function wordLight() {
    if (!word || !word.children.length) return;
    const wr = word.getBoundingClientRect();
    if (wr.bottom < 0 || wr.top > innerHeight) return;
    // Each letter brightens as the lamp passes over it, and the light across the metal turns toward the pointer.
    for (const s of word.children) {
      const r = s.getBoundingClientRect();
      const d = Math.hypot(px - (r.left + r.width / 2), py - (r.top + r.height / 2));
      s.style.setProperty('--near', present ? Math.max(0, 1 - d / 420).toFixed(3) : '0');
    }
    word.style.setProperty('--sheen', `${(176 + clamp((px - (wr.left + wr.width / 2)) / wr.width) * 50).toFixed(1)}deg`);
  }

  /* ---------------------------------------------------------------- tick */

  let last = 0;
  function tick(t) {
    frame = 0;
    let again = false;
    for (const g of gazers) if (g.visible && gaze(g, t)) again = true;

    const under = present ? document.elementFromPoint(px, py) : null;
    lit = swap(lit, under && under.closest(LAMP), 'is-lit');
    if (lit) light(lit, 'is-lit');
    gilt = swap(gilt, under && under.closest(GOLD), 'is-gilt');
    if (gilt) light(gilt, 'is-gilt');
    sheened = swap(sheened, under && under.closest(SHEEN), 'is-sheen');
    if (sheened) {
      const { x, y } = light(sheened, 'is-sheen');
      sheened.style.setProperty('--sheen', `${(Math.atan2(y, x) * 180 / Math.PI + 90).toFixed(1)}deg`);
    }
    if (t - last > 30) { wordLight(); last = t; }
    if (again) wake();
  }

  /* ----------------------------------------------------------------- ink */

  // A link fills with gold from the side the pointer came in, and drains out of the side it leaves.
  document.addEventListener('pointerover', (e) => {
    const a = e.target.closest && e.target.closest(INK);
    if (!a || a.contains(e.relatedTarget)) return;
    const r = a.getBoundingClientRect();
    const fromLeft = e.clientX < r.left + r.width / 2;
    if (!a.classList.contains('ink')) { a.style.setProperty('--ink-c', getComputedStyle(a).color); a.classList.add('ink'); }
    a.classList.add('ink--still');
    a.style.backgroundPositionX = fromLeft ? '100%' : '0%';
    void a.offsetWidth;
    a.classList.remove('ink--still');
    a.style.backgroundPositionX = '50%';
  });
  document.addEventListener('pointerout', (e) => {
    const a = e.target.closest && e.target.closest(INK);
    if (!a || a.contains(e.relatedTarget)) return;
    const r = a.getBoundingClientRect();
    a.style.backgroundPositionX = e.clientX > r.left + r.width / 2 ? '0%' : '100%';
  });

  /* --------------------------------------------------------------- trace */

  // The engraved border starts where the pointer came in and runs round once; leaving winds it back.
  document.addEventListener('pointerover', (e) => {
    const host = e.target.closest && e.target.closest(TRACE);
    if (!host || host.contains(e.relatedTarget)) return;
    let line = host.querySelector(':scope > .trace');
    if (!line) {
      line = document.createElement('i');
      line.className = 'trace';
      line.setAttribute('aria-hidden', 'true');
      host.appendChild(line);
    }
    const r = host.getBoundingClientRect();
    line.style.setProperty('--t0', `${(Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI + 90).toFixed(0)}deg`);
    host.classList.add('is-traced');
  });
  document.addEventListener('pointerout', (e) => {
    const host = e.target.closest && e.target.closest(TRACE);
    if (host && !host.contains(e.relatedTarget)) host.classList.remove('is-traced');
  });

  /* ----------------------------------------------- masks added later on */

  // The app draws its pages as you move between them; masks that arrive later are watched too.
  new MutationObserver(() => $$('[data-gaze]').forEach(watch)).observe(document.body, { childList: true, subtree: true });
})();
