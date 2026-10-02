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
  const { animate, stagger, createTimeline, createDrawable, onScroll, utils } = A;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

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
  for (let i = 0; i < (innerWidth < 760 ? 12 : 24); i++) {
    const m = document.createElement('span');
    m.style.left = `${utils.random(0, 100)}%`;
    m.style.top = `${utils.random(25, 100)}%`;
    motes.appendChild(m);
    animate(m, {
      opacity: [0, utils.random(3, 8) / 10, 0],
      translateY: [0, -utils.random(120, 360)],
      translateX: [0, utils.random(-40, 40)],
      duration: utils.random(6000, 13000),
      delay: utils.random(0, 6000),
      loop: true,
      ease: 'inOutSine'
    });
  }

  /* -------------------------------------------------------------- hero */

  const word = $('[data-hero-word]');
  if (word) {
    // Letter by letter, so the name can rise one character at a time.
    word.setAttribute('aria-hidden', 'true');
    word.innerHTML = [...word.textContent].map((c) => `<span>${c}</span>`).join('');
    const hero = word.closest('.hero');
    // After the opening (intro.js) when it plays, so the entrance is seen rather than spent under the cover.
    const entrance = () => {
      createTimeline({ defaults: { ease: 'outExpo' } })
        .add(word.children, { translateY: ['55%', '0%'], opacity: [0, 1], duration: 1400, delay: stagger(60) }, 0)
        .add($('[data-hero-mask]'), { opacity: [0, 1], translateY: [-150, 0], rotate: [-28, 0], scale: [.82, 1], duration: 1900, ease: 'outElastic(1, .78)' }, 380);
      draw($$('[data-sketch] :not(text)'), { duration: 2000, delay: stagger(70, { start: 300 }) });
      animate($$('[data-sketch] text'), { opacity: [0, .8], duration: 900, delay: stagger(140, { start: 1500 }) });
      draw($$('.vframe path, .vframe circle', hero), { duration: 1500, delay: stagger(25) });
    };
    if (document.documentElement.classList.contains('intro')) document.addEventListener('sentinel:intro-done', entrance, { once: true });
    else entrance();

    const mask = $('[data-hero-mask] img');
    if (mask) animate(mask, { translateY: [-8, 8], rotate: [-1.2, 1.2], duration: 3800, alternate: true, loop: true, ease: 'inOutSine' });
    // The mask itself watches the pointer (hover.js); the name drifts the other way a little, for depth.
    if (finePointer) {
      let pending = false;
      addEventListener('pointermove', (e) => {
        if (pending || scrollY > innerHeight) return;
        pending = true;
        requestAnimationFrame(() => {
          pending = false;
          animate(word, { x: (e.clientX / innerWidth - 0.5) * -18, duration: 1400, ease: 'outQuart' });
        });
      }, { passive: true });
    }
    // The name drifts up and the mask sinks a little as the hero scrolls away.
    animate(word, { translateY: ['0%', '-18%'], ease: 'linear', autoplay: onScroll({ target: hero, sync: 0.35, enter: 'top top', leave: 'top bottom' }) });
  }

  /* ------------------------------------------------- mask plates */

  for (const plate of $$('.plate')) {
    const art = $('.plate__art', plate);
    whenSeen(art, () => draw($$('.cartouche :not(text)', art), { duration: 1600 }));
    // The cartouche turns a few degrees as the plate passes, the opposite way on alternate plates.
    const turn = plate.classList.contains('plate--flip') ? -4 : 4;
    const cart = $('.cartouche', art);
    if (cart) animate(cart, { rotate: [-turn, turn], ease: 'linear', autoplay: onScroll({ target: plate, sync: 0.5, enter: 'bottom top', leave: 'top bottom' }) });
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
