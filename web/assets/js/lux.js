/*
 * Motion for the luxury edition, with anime.js. Decoration only: nothing here hides content. Every element is
 * already visible in the markup and the CSS reveals (site.js) fail open on their own; this file adds the hero's
 * entrance, pencil lines that draw themselves, masks that lean toward the pointer, motes of light, and frames and
 * cartouches that draw as they arrive. Without anime.js, or with reduced motion, it does nothing.
 */
(() => {
  'use strict';

  const A = window.anime;
  if (!A || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const { animate, stagger, createTimeline, createDrawable, utils } = A;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // Run a function the first time an element comes on screen.
  const whenSeen = (el, fn, margin = '0px 0px -12% 0px') => {
    if (!el) return;
    if (!('IntersectionObserver' in window)) { fn(); return; }
    const io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      fn();
    }, { rootMargin: margin });
    io.observe(el);
  };
  const draw = (targets, opts = {}) => {
    const els = typeof targets === 'string' ? $$(targets) : [...targets];
    if (!els.length) return;
    animate(createDrawable(els), { draw: ['0 0', '0 1'], duration: 1700, delay: stagger(60), ease: 'inOutQuad', ...opts });
  };

  /* ---------------------------------------------------- motes of light */

  const motes = document.createElement('div');
  motes.className = 'motes';
  motes.setAttribute('aria-hidden', 'true');
  document.body.appendChild(motes);
  // Each mote rises on a CSS animation (lux.css), which the browser runs off the main thread: placed here, never
  // touched again.
  for (let i = 0; i < (innerWidth < 760 ? 12 : 24); i++) {
    const m = document.createElement('span');
    m.style.cssText = `left:${utils.random(0, 100)}%;top:${utils.random(25, 100)}%;--o:${utils.random(3, 8) / 10};--rise:${-utils.random(120, 360)}px;--dx:${utils.random(-40, 40)}px;animation-duration:${utils.random(6000, 13000)}ms;animation-delay:${utils.random(0, 6000)}ms`;
    motes.appendChild(m);
  }

  /* -------------------------------------------------------------- hero */

  const word = $('[data-hero-word]');
  if (word) {
    // Letter by letter, so the name can rise one character at a time, each from behind its own baseline (no fade).
    word.setAttribute('aria-hidden', 'true');
    word.innerHTML = [...word.textContent].map((c) => `<span>${c}</span>`).join('');
    const hero = word.closest('.hero');
    // After the opening (intro.js) when it plays, so the entrance is seen rather than spent under the cover.
    const entrance = () => {
      createTimeline({ defaults: { ease: 'outExpo' } })
        // Stretched and blurred upward as it rises, as if caught moving fast, settling sharp.
        .add(word.children, { translateY: ['100%', '0%'], scaleY: [1.6, 1], filter: ['blur(10px)', 'blur(0px)'], clipPath: ['inset(0% 0% 100% 0%)', 'inset(0% 0% 0% 0%)'], duration: 1400, delay: stagger(60) }, 0)
        .add($('[data-hero-mask]'), { translateY: [-150, 0], rotate: [-28, 0], scale: [.82, 1], duration: 1900, ease: 'outElastic(1, .78)' }, 380)
        // The mask is lit up out of the dark rather than faded in (on the inner wrapper: the holder keeps its shadow).
        .add($('[data-hero-mask] .m3'), { filter: ['brightness(0)', 'brightness(1)'], duration: 1500, ease: 'outQuad' }, 380)
        // Nothing left on the letters once settled (a filter, even at nothing, keeps each one on its own layer).
        .call(() => { for (const c of word.children) { c.style.filter = ''; c.style.transform = ''; } });
      draw($$('[data-sketch] :not(text)'), { duration: 2000, delay: stagger(70, { start: 300 }) });
      animate($$('[data-sketch] text'), { clipPath: ['inset(0% 100% 0% 0%)', 'inset(0% 0% 0% 0%)'], duration: 1100, ease: 'inOutQuad', delay: stagger(140, { start: 1500 }) });
      draw($$('.vframe path, .vframe circle', hero), { duration: 1500, delay: stagger(25) });
    };
    if (document.documentElement.classList.contains('intro')) document.addEventListener('sentinel:intro-done', entrance, { once: true });
    else entrance();

    const mask = $('[data-hero-mask] img');
    if (mask) animate(mask, { translateY: [-8, 8], rotate: [-1.2, 1.2], duration: 3800, alternate: true, loop: true, ease: 'inOutSine' });
    // The name's drift with the pointer and with the scroll, and the mask's sink, are motion.js's (GSAP).
  }

  /* ------------------------------------------------- mask plates */

  for (const plate of $$('.plate')) {
    const art = $('.plate__art', plate);
    whenSeen(art, () => draw($$('.cartouche :not(text)', art), { duration: 1600 }));
    // The cartouche's turn as the plate passes is motion.js's (ScrollTrigger).
    // A change of severity flares the light behind the mask.
    $$('[data-sev]', plate).forEach((b) => b.addEventListener('click', () => {
      animate($('.plate__glow', plate), { opacity: [0.95, 0.5], scale: [1.25, 1], duration: 1100, ease: 'outExpo' });
    }));
  }

  /* --------------------------------------- frames and ornaments elsewhere */

  for (const frame of $$('.cta .vframe, .page-head .vframe')) whenSeen(frame.parentElement, () => draw($$('path, circle', frame), { duration: 1500, delay: stagger(25) }));
  for (const rule of $$('.orn-rule')) whenSeen(rule, () => draw($$('path, circle', rule), { duration: 1400 }));

  /* ------------------------------------------ 404: petals of red fall */

  const petals = $('[data-petals]');
  if (petals) {
    for (let i = 0; i < 26; i++) {
      const p = document.createElement('i');
      p.style.left = `${utils.random(0, 100)}%`;
      petals.appendChild(p);
      animate(p, {
        translateY: [0, innerHeight + 60],
        translateX: [0, utils.random(-120, 120)],
        rotate: [utils.random(0, 90), utils.random(180, 540)],
        opacity: [0, 0.8, 0.8, 0],
        duration: utils.random(7000, 13000),
        delay: utils.random(0, 8000),
        loop: true,
        ease: 'linear'
      });
    }
  }
})();
