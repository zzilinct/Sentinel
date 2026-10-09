/*
 * Scroll motion for the public pages, with GSAP, ScrollTrigger and Lenis (vendor/, loaded deferred before this file).
 *
 *   Lenis       smooths the wheel on a computer (a fine pointer). Touch keeps the phone's own scroll, and reduced
 *               motion keeps the browser's. It ticks only while it glides, then lets GSAP's clock sleep.
 *   Chapters    each chapter's head, once: the laser crosses its dot grid, then the heading rises (a timeline); the
 *               opening paragraph comes up word by word with the scroll (scrubbed).
 *   Counters    the figures count up with their gold bars, once, from the real numbers (site.js Site.live).
 *   Parallax    the hero's name rises and its mask sinks as the hero is covered; the threat plates' cartouches turn.
 *   Ported      two effects from React Bits, without React: ShinyText (a band of light across the gold wordmark) and
 *               Magnet (the large gold buttons lean toward a nearby pointer). Computers only.
 *
 * Decoration only: site.js shows everything this file would, if it never runs.
 */
(() => {
  'use strict';

  const G = window.gsap;
  const ST = window.ScrollTrigger;
  const Site = window.Site;
  if (!G || !ST || !Site) return;
  G.registerPlugin(ST);

  const { $, $$ } = Site;
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const afterIntro = (fn) => (root.classList.contains('intro') ? document.addEventListener('sentinel:intro-done', fn, { once: true }) : fn());

  // A bar under each figure: full and still under reduced motion, grown with the count otherwise.
  const groups = new Map();
  for (const el of $$('[data-count]')) {
    const stat = el.closest('.stat');
    const num = el.closest('.stat__n');
    if (!stat || !num) continue;
    if (!stat.querySelector('.stat__bar')) num.insertAdjacentHTML('afterend', '<i class="stat__bar" aria-hidden="true"></i>');
    const g = stat.parentElement;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ el, bar: stat.querySelector('.stat__bar') });
  }

  if (reduced) { window.SentinelMotion = true; return; }

  /* ------------------------------------------------------------- Lenis */

  if (fine && window.Lenis) {
    const lenis = new window.Lenis({ lerp: 0.1, smoothWheel: true, syncTouch: false, anchors: false });
    lenis.on('scroll', ST.update);
    G.ticker.lagSmoothing(0);
    // GSAP's clock drives Lenis only while it glides. Lenis keeps time on its own clock, which skips the rests, so
    // the first frame after one is a frame long, not the whole rest (which would land the glide at once).
    let ticking = false;
    let clock = 0;
    let prev = 0;
    const tick = (time) => {
      const ms = time * 1000;
      clock += prev ? ms - prev : 1000 / 60;
      prev = ms;
      lenis.raf(clock);
      if (!lenis.animate.isRunning) { G.ticker.remove(tick); ticking = false; prev = 0; }
    };
    const wake = () => { if (!ticking && lenis.animate.isRunning) { ticking = true; G.ticker.add(tick); } };
    // After Lenis's own wheel listener (added first), which starts the glide.
    addEventListener('wheel', wake, { passive: true });
    window.SentinelScroll = {
      lenis,
      // Where the page jumps (a tab's chapter, under its wipe), it lands exactly, at once; a smooth one glides there.
      to(top, smooth) {
        // From where the page really is: a native scroll earlier in this frame has not reached Lenis yet.
        lenis.reset();
        lenis.scrollTo(top, { immediate: !smooth, force: true });
        wake();
      },
      get ticking() { return ticking; }
    };
    // Links to a place on this page glide there too (the tabs and rail have their own wipe, in site.js, and say so
    // by preventing the default first). Keyboard focus follows, as a native jump would move it.
    document.addEventListener('click', (ev) => {
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      const a = ev.target.closest && ev.target.closest('a[href*="#"]');
      if (!a || (a.target && a.target !== '_self')) return;
      let url;
      try { url = new URL(a.href, location.href); } catch { return; }
      if (!url.hash || !Site.samePage(url)) return;
      const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
      if (!target) return;
      ev.preventDefault();
      // Its place measured now, honouring its scroll margin as a native jump would.
      const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
      window.SentinelScroll.to(Math.max(0, target.getBoundingClientRect().top + scrollY - margin), true);
      if (history.pushState) history.pushState(null, '', url.hash);
      if (!target.matches('a, button, input, select, textarea, [tabindex]')) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    });
  }

  // Scrubs follow the scroll directly (scrub: true): Lenis already smooths the wheel and a finger's scroll is its
  // own, so nothing ticks after the scroll stops.
  // Layout that moves without a resize (fonts, results, the game) moves the triggers' places with it; small changes
  // move nothing that shows, and a refresh measures the whole page, so only a real change asks for one.
  if ('ResizeObserver' in window) {
    let h = document.body.scrollHeight;
    let t = 0;
    new ResizeObserver(() => {
      const nh = document.body.scrollHeight;
      if (Math.abs(nh - h) < 40) return;
      h = nh;
      clearTimeout(t);
      t = setTimeout(() => ST.refresh(), 500);
    }).observe(document.body);
  }

  /* --------------------------------------------------- chapter heads */

  // Over a faint dot grid, the gold scan line comes in wavy, straightens, thickens and flares, and is gone; the
  // heading rises as it straightens (its letters are CSS transitions, lux.css). Once per chapter. A chapter arrived
  // at by a tab is sighted through the scope instead (site.js), so the laser stays out of its way.
  const WAVE = 'M0 20' + Array.from({ length: 8 }, (_, k) => ` Q${k * 125 + 62.5} ${k % 2 ? 36 : 4} ${(k + 1) * 125} 20`).join('');
  const heads = $$('.section__head').map((head) => {
    const laser = document.createElement('span');
    laser.className = 'laser';
    laser.setAttribute('aria-hidden', 'true');
    laser.innerHTML = `<b class="laser__grid"></b><svg viewBox="0 0 1000 40" preserveAspectRatio="none"><path d="${WAVE}"/><path d="${WAVE}"/></svg><i><b class="laser__flare"></b></i>`;
    head.prepend(laser);
    head.classList.add('has-laser');
    const h2 = $('h2[data-split]', head);
    const grid = $('.laser__grid', laser);
    const svg = $('svg', laser);
    const core = $('i', laser);
    const flare = $('.laser__flare', laser);
    const parts = [grid, svg, core, flare];
    const tl = G.timeline({ paused: true, defaults: { ease: 'none' } })
      // Its parts get their own layers only while it plays, so the compositor moves them, as it did the CSS keyframes.
      .set(laser, { autoAlpha: 1 }, 0)
      .call(() => parts.forEach((e) => { e.style.willChange = 'transform, opacity'; }), null, 0)
      .fromTo(grid, { opacity: 0 }, { opacity: 0.5, duration: 0.33, ease: 'power2.out' }, 0)
      .to(grid, { opacity: 0, duration: 0.39, ease: 'power2.out' }, 0.91)
      .fromTo(svg, { scaleX: 0, scaleY: 1, opacity: 1 }, { scaleX: 1, scaleY: 0.85, duration: 0.39, ease: 'power3.out' }, 0)
      .to(svg, { scaleY: 0.02, duration: 0.29, ease: 'power2.inOut' }, 0.39)
      .to(svg, { scaleY: 0, opacity: 0, duration: 0.1 }, 0.68)
      .fromTo(core, { opacity: 0, scaleX: 1, scaleY: 1 }, { opacity: 1, duration: 0.1 }, 0.6)
      .to(core, { scaleY: 3.2, duration: 0.21, ease: 'power3.out' }, 0.7)
      .to(core, { scaleY: 2, duration: 0.16, ease: 'power1.inOut' }, 0.91)
      .to(core, { opacity: 0, scaleY: 0.5, scaleX: 1.04, duration: 0.23, ease: 'power2.in' }, 1.07)
      .fromTo(flare, { opacity: 0, scaleX: 0.2, scaleY: 0.4 }, { opacity: 1, scaleX: 1, scaleY: 1, duration: 0.16, ease: 'power2.out' }, 0.8)
      .to(flare, { opacity: 0, scaleX: 1.8, scaleY: 0.6, duration: 0.34, ease: 'power1.out' }, 0.96)
      .set(laser, { autoAlpha: 0 }, 1.3)
      .call(() => parts.forEach((e) => { e.style.willChange = ''; }), null, 1.3);
    if (h2) tl.call(() => Site.reveal(h2), null, 0.62);
    return { head, tl, done: false };
  });
  const fire = (h) => {
    if (h.done) return;
    h.done = true;
    // Decided once the current task is over: a tab's jump scrolls first and marks the chapter sighted just after.
    queueMicrotask(() => {
      if (h.head.closest('.is-sighted')) { h.tl.kill(); h.head.querySelectorAll('[data-split]').forEach(Site.reveal); }
      else h.tl.play();
    });
  };

  // The paragraph under it, word by word, from faint to full as it rises up the screen (full by the lower third, where
  // it starts to be read), and back if scrolled back.
  const paragraphs = $$('.section__head > p[data-reveal="words"]');

  /* ---------------------------------------------------------- counters */

  for (const [group, items] of groups) {
    G.set(items.map((i) => i.bar), { scaleX: 0, transformOrigin: '0 50%' });
  }
  const count = (items) => Site.live.then(() => {
    const tl = G.timeline({ defaults: { duration: 1.6, ease: 'power3.out' } });
    items.forEach(({ el, bar }, i) => {
      const n = Number(el.dataset.count) || 0;
      const v = { n: 0 };
      tl.to(v, { n, onUpdate: () => { el.textContent = Math.round(v.n).toLocaleString(); } }, i * 0.08)
        .to(bar, { scaleX: 1 }, i * 0.08);
    });
  });

  afterIntro(() => {
    for (const h of heads) {
      const st = ST.create({ trigger: h.head, start: 'top 92%', once: true, onEnter: () => fire(h) });
      // A page opened (or restored) further down: the chapters above were passed before there was anything to see.
      if (st.scroll() > st.start) fire(h);
    }
    for (const p of paragraphs) {
      G.timeline({ scrollTrigger: { trigger: p, start: 'top 92%', end: 'top 64%', scrub: true } })
        .fromTo($$('.wd', p), { opacity: 0.12, yPercent: 35 }, { opacity: 1, yPercent: 0, stagger: 0.08, ease: 'power1.out' });
    }
    for (const [group, items] of groups) {
      // The stats sit at the top of a stack that holds still (CSS sticky), so the stack, which never does, triggers.
      let going = false;
      const go = () => { if (!going) { going = true; count(items); } };
      const st = ST.create({ trigger: group.closest('[data-stack]') || group, start: 'top 72%', once: true, onEnter: go });
      if (st.scroll() > st.start) go();
    }
  });
  window.SentinelMotion = true;

  /* ---------------------------------------------------------- parallax */

  // The hero's name drifts up and its mask sinks as the next chapter slides over it, following the scroll. The hero
  // holds still (CSS sticky), so its stack, which does not, sets the range.
  const word = $('[data-hero-word]');
  const mask = $('[data-hero-mask] .m3');
  const stack = word && word.closest('[data-stack]');
  if (word && stack) {
    G.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: stack, start: 'top top', end: () => `+=${word.closest('.hero').offsetHeight}`, scrub: true, invalidateOnRefresh: true } })
      .fromTo(word, { yPercent: 0 }, { yPercent: -18 }, 0)
      .fromTo(mask || {}, { y: 0 }, { y: () => innerHeight * 0.12 }, 0);
    // With a mouse, the name also drifts the other way from the pointer a little, for depth (the mask itself
    // watches the pointer, hover.js).
    if (fine) {
      const xTo = G.quickTo(word, 'x', { duration: 1.4, ease: 'power4.out' });
      addEventListener('pointermove', (e) => { if (scrollY < innerHeight) xTo((e.clientX / innerWidth - 0.5) * -18); }, { passive: true });
    }
  }
  // Each threat plate's cartouche turns a few degrees as the plate passes, the other way on alternate plates.
  for (const plate of $$('.plate')) {
    const cart = $('.cartouche', plate);
    if (!cart) continue;
    const turn = plate.classList.contains('plate--flip') ? -4 : 4;
    G.fromTo(cart, { rotation: -turn, yPercent: 3 }, { rotation: turn, yPercent: -3, ease: 'none', scrollTrigger: { trigger: plate, start: 'top bottom', end: 'bottom top', scrub: true } });
  }

  /* ----------------------------------- React Bits, ported: ShinyText and Magnet */

  if (!fine) return;

  // ShinyText: a band of light crosses the gold wordmark, letter by letter, once the entrance has settled and then
  // now and again while the hero is on screen and the tab is in front (home.css draws it).
  if (word) {
    let seen = true;
    let timer = 0;
    const shine = () => {
      clearTimeout(timer);
      timer = setTimeout(shine, 9000);
      if (!seen || document.hidden || word.classList.contains('is-shining')) return;
      const letters = [...word.children];
      if (!letters.length) return;
      letters.forEach((c, i) => c.style.setProperty('--i', i));
      word.classList.add('is-shining');
      letters[letters.length - 1].addEventListener('animationend', () => word.classList.remove('is-shining'), { once: true });
    };
    ST.create({ trigger: word.closest('.hero'), start: 'top bottom', end: 'bottom top', onToggle: (self) => { seen = self.isActive; } });
    afterIntro(() => { timer = setTimeout(shine, 2600); });
  }

  // Magnet: within reach, a large gold button leans toward the pointer (a sixth of the way, at most 10 px) and settles
  // back when it leaves. On the CSS translate, so the button's own press (a transform) still plays.
  const magnets = $$('.btn--gold.btn--lg').map((el) => {
    const at = { x: 0, y: 0 };
    const put = () => { el.style.translate = `${at.x.toFixed(2)}px ${at.y.toFixed(2)}px`; };
    return { el, at, on: false, x: G.quickTo(at, 'x', { duration: 0.5, ease: 'power3.out', onUpdate: put }), y: G.quickTo(at, 'y', { duration: 0.5, ease: 'power3.out', onUpdate: put }) };
  });
  if (magnets.length) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const m = magnets.find((k) => k.el === e.target);
        m.on = e.isIntersecting;
        if (!m.on) { m.x(0); m.y(0); }
      }
    });
    magnets.forEach((m) => io.observe(m.el));
    const REACH = 70;
    let queued = false;
    let px = 0;
    let py = 0;
    const pull = () => {
      queued = false;
      for (const m of magnets) {
        if (!m.on) continue;
        const r = m.el.getBoundingClientRect();
        const dx = px - (r.left - m.at.x + r.width / 2);
        const dy = py - (r.top - m.at.y + r.height / 2);
        const near = Math.abs(dx) < r.width / 2 + REACH && Math.abs(dy) < r.height / 2 + REACH;
        m.x(near ? G.utils.clamp(-10, 10, dx / 6) : 0);
        m.y(near ? G.utils.clamp(-10, 10, dy / 6) : 0);
      }
    };
    addEventListener('pointermove', (e) => {
      px = e.clientX;
      py = e.clientY;
      if (!queued && magnets.some((m) => m.on)) { queued = true; requestAnimationFrame(pull); }
    }, { passive: true });
  }
})();
