/*
 * Hover, as one idea: the pointer is a lamp, and the masks are watching it.
 *
 *   (The masks watch the pointer in 3D: mask3d.js.)
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

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // A touch screen has no lamp to follow, but gold still answers a finger: the lettering nearest a tap catches the
  // light for a moment (hover.css, html.tv).
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.documentElement.classList.add('tv');
    addEventListener('pointerdown', (e) => {
      for (const el of document.querySelectorAll('.gold-text, .metal, .unmasked')) {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) continue;
        const d = Math.hypot(Math.max(r.left - e.clientX, 0, e.clientX - r.right), Math.max(r.top - e.clientY, 0, e.clientY - r.bottom));
        if (d > 160) continue;
        el.style.setProperty('--gx', `${(e.clientX - r.left).toFixed(0)}px`);
        el.style.setProperty('--gy', `${(e.clientY - r.top).toFixed(0)}px`);
        el.style.setProperty('--gr', `${Math.max(70, Math.min(200, r.height * 1.6)).toFixed(0)}px`);
        clearTimeout(el._glint);
        el._glint = setTimeout(() => el.style.setProperty('--gr', '0px'), 450);
      }
    }, { passive: true });
    return;
  }
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
  let target = null;     // what the pointer is over: the event's own target, refreshed after a scroll
  let frame = 0;
  const wake = () => { if (!frame) frame = requestAnimationFrame(tick); };

  addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; target = e.target; present = true; wake(); }, { passive: true });
  document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) { present = false; wake(); } });
  addEventListener('blur', () => { present = false; wake(); });
  addEventListener('scroll', () => { target = null; wake(); }, { passive: true });

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

  /* ------------------------------------------------------- gold lettering */

  // Every gold line of type catches the lamp: the letters nearest the pointer take a warm highlight that grows as it
  // comes closer and fades as it leaves (hover.css). Only lines on screen are looked at.
  const TORCH = '.gold-text, .metal, .unmasked';
  const golds = new Set();
  const goldWatch = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) golds.add(e.target);
      else { golds.delete(e.target); e.target.style.setProperty('--gr', '0px'); }
    }
  });
  const watchGold = () => $$(TORCH).forEach((el) => { if (!el.dataset.torch) { el.dataset.torch = '1'; goldWatch.observe(el); } });
  watchGold();
  // Pages that write their headings later (the app's views) bring new gold in: picked up as it appears.
  new MutationObserver(() => { clearTimeout(watchGold.t); watchGold.t = setTimeout(watchGold, 200); }).observe(document.body, { childList: true, subtree: true });
  function torch() {
    for (const el of golds) {
      const r = el.getBoundingClientRect();
      const dx = Math.max(r.left - px, 0, px - r.right);
      const dy = Math.max(r.top - py, 0, py - r.bottom);
      const near = present ? Math.max(0, 1 - Math.hypot(dx, dy) / 240) : 0;
      el.style.setProperty('--gx', `${(px - r.left).toFixed(0)}px`);
      el.style.setProperty('--gy', `${(py - r.top).toFixed(0)}px`);
      el.style.setProperty('--gr', `${(near * near * Math.max(80, Math.min(260, r.height * 1.8))).toFixed(0)}px`);
    }
  }

  /* ---------------------------------------------------------------- tick */

  let last = 0;
  function tick(t) {
    frame = 0;

    if (present && !target) target = document.elementFromPoint(px, py);
    const under = present && target && target.closest ? target : null;
    lit = swap(lit, under && under.closest(LAMP), 'is-lit');
    if (lit) light(lit, 'is-lit');
    gilt = swap(gilt, under && under.closest(GOLD), 'is-gilt');
    if (gilt) light(gilt, 'is-gilt');
    sheened = swap(sheened, under && under.closest(SHEEN), 'is-sheen');
    if (sheened) {
      const { x, y } = light(sheened, 'is-sheen');
      sheened.style.setProperty('--sheen', `${(Math.atan2(y, x) * 180 / Math.PI + 90).toFixed(1)}deg`);
    }
    if (t - last > 30) { wordLight(); torch(); last = t; }

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

})();
