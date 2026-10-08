/* Sentinel marketing pages: navigation, reveals, counters, plan finder. */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const Masks = window.SentinelMasks;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Browsers without IntersectionObserver still get everything, revealed at once.
  const Observer = window.IntersectionObserver || class {
    constructor(callback) { this.callback = callback; }
    observe(target) { setTimeout(() => this.callback([{ target, isIntersecting: true }], this), 0); }
    unobserve() {}
    disconnect() {}
  };

  // The scroll motion (motion.js, with GSAP and ScrollTrigger) is on this page when its scripts are: then a chapter's
  // head is revealed by its laser timeline there, not by the reveals here. A page without them keeps the reveals.
  const gs = !reduced && Boolean(document.querySelector('script[src*="vendor/gsap"]'));

  window.Site = { $, $$, reduced, Observer };

  // Shown: its entrance plays (CSS), and a split heading's gold comes alive.
  function reveal(el) {
    el.classList.add('is-in');
    if (el.matches('[data-split]')) $$('.gold-text', el).forEach((g) => g.classList.add('is-live'));
  }
  Site.reveal = reveal;
  // Every scroll the page makes goes through here: through Lenis when it is smoothing the wheel (motion.js), so its
  // idea of where the page is never drifts from where the page is; natively otherwise. Lands exactly unless smooth.
  Site.scrollTo = (top, smooth) => {
    if (window.SentinelScroll) window.SentinelScroll.to(top, smooth);
    else scrollTo({ top, behavior: smooth && !reduced ? 'smooth' : 'instant' });
  };

  /* ------------------------------------------------------------- glyphs */

  $$('[data-glyph]').forEach((el) => { if (Masks && !el.firstElementChild) el.innerHTML = Masks.svg(el.dataset.glyph); });
  $$('[data-kind]').forEach((el) => { if (Masks && !el.firstElementChild) el.innerHTML = Masks.kindIcon(el.dataset.kind); });

  // The big headings that rise letter by letter (split below); the rest keep their words and their binary decode.
  if (!reduced) $$('.section__head h2[data-split], .page-head h1[data-split], .section h2[data-split], .cta h2[data-split]').forEach((h) => h.classList.add('rise'));

  /* ---------------------------------------------------------------- nav */

  const nav = $('[data-nav]');
  if (nav) {
    const toggle = $('[data-nav-toggle]');
    toggle && toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    $$('.nav__links a', nav).forEach((a) => a.addEventListener('click', () => {
      nav.classList.remove('is-open');
      toggle && toggle.setAttribute('aria-expanded', 'false');
    }));
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && nav.classList.contains('is-open')) {
        nav.classList.remove('is-open');
        if (toggle) { toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); }
      }
    });
    document.addEventListener('click', (ev) => {
      if (!nav.contains(ev.target) && nav.classList.contains('is-open')) {
        nav.classList.remove('is-open');
        toggle && toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ------------------------------------------------------- tabs: the glider */

  // A pill glides to the tab under the pointer and settles on the active one.
  const links = $('.nav__links');
  const glider = links && document.createElement('span');
  function glide(to) {
    if (!glider) return;
    const a = to || $('.nav__links a.is-active');
    if (!a || !a.offsetWidth) { glider.classList.remove('is-on'); return; }
    glider.style.width = `${a.offsetWidth}px`;
    glider.style.transform = `translateX(${a.offsetLeft}px)`;
    glider.classList.add('is-on');
  }
  if (glider) {
    glider.className = 'nav__glider';
    glider.setAttribute('aria-hidden', 'true');
    links.prepend(glider);
    nav.classList.add('has-glider');
    $$('a', links).forEach((a) => {
      a.addEventListener('pointerenter', () => glide(a));
      a.addEventListener('focus', () => glide(a));
    });
    links.addEventListener('pointerleave', () => glide());
    addEventListener('resize', () => glide());
    if (document.fonts) document.fonts.ready.then(() => glide());
  }

  /* --------------------------------------------- tabs: the page transition */

  // Clicking a tab sweeps three panels in the masks' colours over the page, names the chapter, moves the page
  // underneath and sweeps on. Every path ends with the panels gone: a timer clears them whatever happens, and with
  // reduced motion (or any error) the link simply does what a link does.
  let wipe = null;
  let wipeTimer = 0;
  let pending = 0;
  const clearWipe = () => { if (wipe) wipe.className = 'wipe'; };
  function cover(label, then) {
    if (!wipe) {
      wipe = document.createElement('div');
      wipe.className = 'wipe';
      wipe.setAttribute('aria-hidden', 'true');
      wipe.innerHTML = `<i></i><i></i><i></i><div class="wipe__label">${Masks ? Masks.svg('logo') : ''}<b></b></div>`;
      document.body.appendChild(wipe);
      void wipe.offsetWidth;
    }
    $('b', wipe).textContent = label;
    clearTimeout(wipeTimer);
    wipe.className = 'wipe is-cover';
    wipeTimer = setTimeout(clearWipe, 2600);
    // A second click replaces the first, so the page never jumps twice.
    clearTimeout(pending);
    pending = setTimeout(then, 640);
  }
  const uncover = () => {
    if (!wipe) return;
    wipe.className = 'wipe is-cover is-leave';
    setTimeout(() => { if (wipe.classList.contains('is-leave')) clearWipe(); }, 900);
  };
  // Coming back with the back button restores the page as it was left: never covered.
  addEventListener('pageshow', clearWipe);

  // "/", "/index.html" and a static copy's "/sentinel/" are all the home page.
  const pageOf = (p) => p.replace(/\/index\.html$/, '/').replace(/\/$/, '');
  const samePage = (url) => url.origin === location.origin && pageOf(url.pathname) === pageOf(location.pathname);
  Site.samePage = samePage;
  const labelOf = (a, target) => (target && target.dataset.chapter) || a.dataset.label || a.textContent.trim();

  function jump(target, hash) {
    // Everything in the chapter is shown at once, so the page never lands on held-back content.
    [target, ...$$('[data-reveal], [data-split], [data-stagger], [data-pipeline]', target)].forEach(reveal);
    const top = target.getBoundingClientRect().top + scrollY - (nav ? nav.offsetHeight : 0) - 8;
    Site.scrollTo(Math.max(0, top));
    if (history.pushState) history.pushState(null, '', hash); else location.hash = hash;
    // Keyboard focus follows, as a native jump to a fragment would move it.
    if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
    target.focus({ preventScroll: true });
    arrive(target);
  }

  // Arriving by a tab is not arriving by scrolling: the chapter is sighted. As the panels sweep off, a scope opens
  // from the middle of the screen (its ring, its crosshairs drawing out to four diamonds, like the threat plates'
  // sights) and the chapter is seen through it; its heading lands with a flash, like struck metal. Then it all goes.
  let sight = null;
  function arrive(target) {
    if (!sight) {
      sight = document.createElement('div');
      sight.className = 'sight';
      sight.setAttribute('aria-hidden', 'true');
      sight.innerHTML = '<svg viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid slice"><circle class="sight__ring" r="60" pathLength="1"/><circle class="sight__ring sight__ring--in" r="44" pathLength="1"/>'
        + '<path class="sight__hair" d="M-96 0H-8M8 0H96M0 -96V-8M0 8V96" pathLength="1"/>'
        + [[0, -60], [60, 0], [0, 60], [-60, 0]].map(([x, y]) => `<path class="sight__gem" d="M${x} ${y - 2.2}l2.2 2.2-2.2 2.2-2.2-2.2z"/>`).join('') + '</svg>';
      document.body.appendChild(sight);
    }
    target.classList.remove('is-sighted');
    sight.classList.remove('is-on');
    void target.offsetWidth;
    target.classList.add('is-sighted');
    sight.classList.add('is-on');
    // And the chapter is dug into: a moment of binary across the screen, its links' digits in the masks' colours.
    if (window.SentinelBinary) {
      window.SentinelBinary.burst(null, 650, {
        links: () => [...target.querySelectorAll('a, button, .chip-q, .res__title')].map((a) => a.getBoundingClientRect())
          .filter((r) => r.width > 20 && r.bottom > 0 && r.top < innerHeight).slice(0, 24)
          .map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height }))
      });
    }
    clearTimeout(arrive.t);
    arrive.t = setTimeout(() => { target.classList.remove('is-sighted'); sight.classList.remove('is-on'); }, 1700);
  }

  function onTab(ev) {
    const a = ev.currentTarget;
    if (reduced || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    if (a.target && a.target !== '_self') return;
    if (a.getAttribute('aria-disabled') === 'true' || !a.getAttribute('href') || a.getAttribute('href') === '#') return;
    let url;
    try { url = new URL(a.href, location.href); } catch { return; }
    if (url.origin !== location.origin) return;
    if (glider && links.contains(a)) { glide(a); glider.classList.remove('is-pressed'); void glider.offsetWidth; glider.classList.add('is-pressed'); }
    if (samePage(url) && url.hash) {
      const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
      if (!target) return;
      ev.preventDefault();
      cover(labelOf(a, target), () => {
        try { jump(target, url.hash); } finally { requestAnimationFrame(uncover); }
      });
    } else if (!samePage(url)) {
      ev.preventDefault();
      cover(labelOf(a), () => { location.href = url.href; });
    }
  }
  $$('.nav__links a').forEach((a) => a.addEventListener('click', onTab));

  // Binary (binary.js): each chapter's heading arrives out of binary the first time it scrolls in, and cards show a
  // lens of binary around the pointer.
  if (window.SentinelBinary && !reduced && 'IntersectionObserver' in window) {
    const heads = $$('.section h2:not(.rise), .page-head h1:not(.rise), .kicker__n');
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        window.SentinelBinary.decode(e.target);
      }
    }, { rootMargin: '0px 0px -12% 0px' });
    heads.forEach((h) => io.observe(h));
    window.SentinelBinary.lens('.tile, .plan, .stat, .feature, .kind, .card, .faq details, .demo-row');
  }

  // Back-to-top button, shown once the reader is well down the page.
  const toTop = document.createElement('button');
  toTop.className = 'to-top';
  toTop.type = 'button';
  toTop.setAttribute('aria-label', 'Back to top');
  toTop.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5m0 0-6 6m6-6 6 6"/></svg>';
  toTop.addEventListener('click', () => Site.scrollTo(0, true));
  document.body.appendChild(toTop);

  // How far down the page the reader is.
  const progress = document.createElement('div');
  progress.className = 'progress';
  progress.setAttribute('aria-hidden', 'true');
  document.body.appendChild(progress);

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      if (nav) nav.classList.toggle('is-scrolled', scrollY > 12);
      toTop.classList.toggle('is-on', scrollY > innerHeight * 1.5);
      const room = document.documentElement.scrollHeight - innerHeight;
      progress.style.setProperty('--p', room > 0 ? Math.min(1, scrollY / room).toFixed(4) : 0);
      ticking = false;
    });
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Highlight the nav link for the section being read (home page only).
  const spyLinks = $$('[data-spy]');
  const spyTargets = spyLinks.map((a) => document.getElementById(a.dataset.spy)).filter(Boolean);
  if (spyTargets.length) {
    const spy = new Observer((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        spyLinks.forEach((a) => a.classList.toggle('is-active', a.dataset.spy === e.target.id));
        glide();
      }
    }, { rootMargin: '-45% 0px -50% 0px' });
    spyTargets.forEach((t) => spy.observe(t));
  } else if (location.pathname === '/pricing') {
    spyLinks.forEach((a) => a.classList.toggle('is-active', a.dataset.spy === 'pricing'));
  }
  glide();

  $$('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });

  // Signed-in visitors get a direct way back into the app. A static export has
  // no API to ask, so the signed-out header stands.
  if (!window.SENTINEL_STATIC) fetch('/api/v1/auth/me', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      const slot = $('[data-auth-actions]');
      if (me && slot) slot.innerHTML = '<a class="btn btn--gold btn--sm" href="/app">Open Sentinel</a>';
    })
    .catch(() => {});

  /* ------------------------------------------------------ split headings */

  // Chapter titles rise letter by letter instead (each clipped, blurred upward, settling); the binary decode above
  // stays on the headings that are not split this way, so no heading gets both.
  for (const el of $$('[data-split]')) {
    let i = 0;
    const rise = !reduced && el.classList.contains('rise');
    if (rise) el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
    const walk = (node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) {
          const frag = document.createDocumentFragment();
          for (const part of child.textContent.split(/(\s+)/)) {
            if (!part) continue;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); continue; }
            const span = document.createElement('span');
            span.className = 'word';
            if (rise) {
              span.setAttribute('aria-hidden', 'true');
              for (const ch of part) {
                const c = document.createElement('span');
                c.className = 'ch';
                c.style.setProperty('--d', `${Math.min(0.75, 0.04 + i++ * 0.024).toFixed(3)}s`);
                c.textContent = ch;
                span.appendChild(c);
              }
              frag.appendChild(span);
              continue;
            }
            span.style.setProperty('--d', `${0.05 + i++ * 0.055}s`);
            span.textContent = part;
            frag.appendChild(span);
          }
          child.replaceWith(frag);
        } else if (child.nodeType === 1 && child.classList.contains('gold-text')) {
          // Gradient text can't be split without losing the gradient, so it animates as one unit.
          child.classList.add('word');
          child.style.setProperty('--d', `${0.05 + i++ * 0.055}s`);
        } else if (child.nodeType === 1 && child.tagName !== 'BR') {
          walk(child);
        }
      }
    };
    walk(el);
  }

  /* ------------------------------------------- long paragraphs, word by word */

  // A chapter's opening paragraph is split into words here; motion.js brings them from faint to full with the scroll.
  if (gs) for (const p of $$('.section__head > p[data-reveal]')) {
    if (p.textContent.trim().length < 100) continue;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const frag = document.createDocumentFragment();
      for (const part of node.nodeValue.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); continue; }
        const w = document.createElement('span');
        w.className = 'wd';
        w.textContent = part;
        frag.appendChild(w);
      }
      node.replaceWith(frag);
    }
    p.dataset.reveal = 'words';
  }

  /* ------------------------------------------------- stacked chapters */

  // A chosen chapter slides up over the one before, which holds still (CSS sticky) once its foot reaches the bottom
  // of the screen. Here only: its height for that, and a mark that says when it is fully covered, so it can rest.
  if (!reduced && 'ResizeObserver' in window && 'IntersectionObserver' in window) {
    for (const s of $$('[data-stack]')) {
      const [under, over] = s.children;
      if (!under || !over) continue;
      new ResizeObserver(() => s.style.setProperty('--h', `${under.offsetHeight}px`)).observe(under);
      const mark = document.createElement('i');
      mark.className = 'stack__mark';
      mark.setAttribute('aria-hidden', 'true');
      over.prepend(mark);
      new IntersectionObserver(([e]) => s.classList.toggle('is-over', !e.isIntersecting && e.boundingClientRect.top < 0)).observe(mark);
      s.classList.add('is-stacked');
    }
  }

  /* ------------------------------------------------------------ reveals */

  // A chapter's heading and opening paragraph are motion.js's to reveal (after its laser), so they are held here.
  const held = gs ? $$('.section__head h2[data-split], .section__head > p[data-reveal="words"]') : [];
  const io = new Observer((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      reveal(e.target);
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });
  // Groups reveal their children one after another.
  $$('[data-stagger]').forEach((g) => [...g.children].forEach((c, i) => c.style.setProperty('--i', i)));
  // Under the opening (intro.js) the page is covered: what is on screen reveals as the curtain lifts, not unseen.
  const observeAll = () => $$('[data-reveal], [data-split], [data-pipeline], [data-stagger]').forEach((el) => { if (!held.includes(el)) io.observe(el); });
  if (document.documentElement.classList.contains('intro')) document.addEventListener('sentinel:intro-done', observeAll, { once: true });
  else observeAll();
  // Fail open: if the motion never started (its script failed or was blocked), what it held is shown.
  if (held.length) addEventListener('load', () => { if (!window.SentinelMotion) held.forEach(reveal); });
  // boot.js stops its fail-open timer once this is set.
  window.Site.ready = true;

  /* ----------------------------------------------------------- counters */

  // The figures in the markup are true; live ones replace them when the server (or the static demo) has them. The
  // count up from nothing as they arrive is motion.js's, which waits for Site.live first.
  const counters = $$('[data-count]');
  Site.live = !counters.length ? Promise.resolve() : (window.SENTINEL_STATIC
    ? Promise.resolve(window.SENTINEL_DEMO && window.SENTINEL_DEMO.stats)
    : fetch('/api/v1/threat-stats').then((r) => (r.ok ? r.json() : null)).catch(() => null)
  ).then((stats) => {
    for (const el of counters) {
      let n = Number(el.dataset.count);
      if (stats && el.dataset.live === 'threats' && stats.trackedThreats > 1000) n = stats.trackedThreats;
      if (stats && el.dataset.live === 'checks' && stats.checks) n = stats.checks;
      if (stats && el.dataset.live === 'kinds' && stats.kinds) n = stats.kinds;
      el.dataset.count = n;
      el.textContent = n.toLocaleString();
    }
  });

  /* -------------------------------------------------------- plan finder */

  const finder = $('[data-finder]');
  if (finder) {
    const pricing = $('[data-pricing]');
    const state = { live: true, hours: 20, email: false };
    const hours = $('[data-f-hours]', finder);
    const hoursOut = $('[data-f-hours-out]', finder);
    const hoursRow = $('[data-f-hours-row]', finder);
    const answer = $('[data-f-answer]', finder);

    const radio = (attr, key, parse) => {
      const buttons = $$(`[${attr}]`, finder);
      const choose = (b) => {
        buttons.forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        state[key] = parse(b.getAttribute(attr));
        update();
      };
      buttons.forEach((b, i) => {
        b.addEventListener('click', () => choose(b));
        b.addEventListener('keydown', (ev) => {
          if (!['ArrowLeft', 'ArrowRight'].includes(ev.key)) return;
          ev.preventDefault();
          const next = buttons[(i + (ev.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
          next.focus();
          choose(next);
        });
      });
    };
    radio('data-f-live', 'live', (v) => v === 'yes');
    radio('data-f-email', 'email', (v) => v === 'yes');
    hours.addEventListener('input', () => { state.hours = Number(hours.value); update(); });

    function update() {
      hoursOut.textContent = `${state.hours} h`;
      hours.style.setProperty('--p', `${(state.hours / Number(hours.max || 100)) * 100}%`);
      hours.disabled = !state.live;
      hoursRow.classList.toggle('is-muted', !state.live);

      let pick;
      let why;
      if (!state.live && !state.email) {
        pick = 'free';
        why = '10 link scans and 5 virus &amp; malware scans a week cover the odd link you&rsquo;re unsure about.';
      } else if (state.email || state.hours > 24) {
        // Fast live scanning has no weekly limit from Max up; Pro's is 24 hours.
        pick = 'max';
        why = state.email
          ? 'pasting emails in for a full scan is part of Max, fast live scanning has no weekly limit, and 24 hours a week of delicate scanning research every result.'
          : `at around ${state.hours} hours a week you&rsquo;d outgrow Pro&rsquo;s 24 hours of fast scanning. Max has no weekly limit on it, and 24 hours of delicate scanning. Ultimate raises delicate to 96.`;
      } else {
        pick = 'pro';
        why = `its 24 hours a week of fast live scanning cover your ${state.hours}, with 4 hours of delicate scanning for the searches that matter. Minutes only count while Sentinel is actually checking something.`;
      }
      answer.innerHTML = `<b>${{ free: 'Free', pro: 'Pro', max: 'Max', ultimate: 'Ultimate' }[pick]}</b> fits best. ${why.charAt(0).toUpperCase()}${why.slice(1)}`;

      $$('[data-plan-card]', pricing).forEach((card) => {
        const on = card.dataset.planCard === pick;
        card.classList.toggle('is-recommended', on);
        const badge = $('.plan__pick', card);
        if (on && !badge) card.insertAdjacentHTML('afterbegin', '<span class="plan__pick">Best for you</span>');
        if (!on && badge) badge.remove();
      });
      pricing.classList.add('has-pick');
    }
    update();
  }

  /* ------------------------------------------------------- chapter rail */

  // One mark per chapter down the left edge on wide screens; each one is a tab like those in the header.
  const chapters = $$('[data-chapter]').filter((s) => s.id);
  if (chapters.length > 2) {
    const rail = document.createElement('ul');
    rail.className = 'rail';
    rail.setAttribute('aria-label', 'Chapters');
    rail.innerHTML = chapters.map((s) => `<li><a href="#${s.id}" data-label="${s.dataset.chapter}"><span>${s.dataset.chapter}</span></a></li>`).join('');
    document.body.appendChild(rail);
    const marks = $$('a', rail);
    marks.forEach((a) => a.addEventListener('click', onTab));
    const railSpy = new Observer((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const i = chapters.indexOf(e.target);
        marks.forEach((m, k) => m.classList.toggle('is-active', k === i));
      }
    }, { rootMargin: '-45% 0px -50% 0px' });
    chapters.forEach((c) => railSpy.observe(c));
  }

  /* --------------------------------------------------------------- tilt */

  // Panels lean toward the pointer. Mouse only: touch scrolling never tilts anything.
  if (!reduced && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    $$('[data-tilt]').forEach((el) => {
      const max = Number(el.dataset.tilt) || 6;
      el.addEventListener('pointermove', (ev) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--ry', `${((ev.clientX - r.left) / r.width - 0.5) * max}deg`);
        el.style.setProperty('--rx', `${(0.5 - (ev.clientY - r.top) / r.height) * max}deg`);
        el.classList.add('tilt-on');
      });
      el.addEventListener('pointerleave', () => {
        el.classList.remove('tilt-on');
        el.style.removeProperty('--rx');
        el.style.removeProperty('--ry');
      });
    });
  }

  /* ------------------------------------------------------------- ripples */

  if (!reduced) document.addEventListener('pointerdown', (ev) => {
    const b = ev.target.closest && ev.target.closest('.chip-q, .severity button, .seg-toggle button');
    if (!b) return;
    const r = b.getBoundingClientRect();
    const dot = document.createElement('span');
    dot.className = 'ripple';
    dot.style.left = `${ev.clientX - r.left}px`;
    dot.style.top = `${ev.clientY - r.top}px`;
    b.appendChild(dot);
    setTimeout(() => dot.remove(), 750);
  });

  /* ------------------------------------------------------------ marquee */

  // The words lean with the speed of the scroll.
  const marquee = $('[data-marquee]');
  if (marquee && !reduced) {
    let lastY = scrollY;
    let skew = 0;
    let running = false;
    let visible = false;
    // Runs only while the marquee is on screen, and settles back to upright before stopping.
    const lean = () => {
      const v = scrollY - lastY;
      lastY = scrollY;
      skew += (Math.max(-12, Math.min(12, v * 0.35)) - skew) * 0.12;
      marquee.style.setProperty('--skew', `${skew.toFixed(2)}deg`);
      running = visible || Math.abs(skew) > 0.05;
      if (running) requestAnimationFrame(lean);
    };
    new Observer((entries) => {
      visible = entries[0].isIntersecting;
      lastY = scrollY;
      if (visible && !running) { running = true; requestAnimationFrame(lean); }
    }).observe(marquee);
  }

  /* ---------------------------------------------------- download picker */

  // Only Windows has a download today, so only a Windows visitor gets a personal heading;
  // everyone else keeps the neutral one rather than "Sentinel for macOS" over a Windows button.
  const windows = /Win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent);
  if (windows) $$('[data-os-label]').forEach((el) => { el.textContent = 'Windows'; });
})();
