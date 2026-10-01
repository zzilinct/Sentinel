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

  window.Site = { $, $$, reduced, Observer };

  /* ------------------------------------------------------------- glyphs */

  $$('[data-glyph]').forEach((el) => { if (Masks && !el.firstElementChild) el.innerHTML = Masks.svg(el.dataset.glyph); });
  $$('[data-kind]').forEach((el) => { if (Masks && !el.firstElementChild) el.innerHTML = Masks.kindIcon(el.dataset.kind); });

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
  const labelOf = (a, target) => (target && target.dataset.chapter) || a.dataset.label || a.textContent.trim();

  function jump(target, hash) {
    // Everything in the chapter is shown at once, so the page never lands on held-back content.
    [target, ...$$('[data-reveal], [data-split], [data-stagger], [data-pipeline]', target)].forEach((el) => el.classList.add('is-in'));
    $$('.gold-text', target).forEach((g) => g.classList.add('is-live'));
    const top = target.getBoundingClientRect().top + scrollY - (nav ? nav.offsetHeight : 0) - 8;
    scrollTo({ top: Math.max(0, top), behavior: 'instant' });
    if (history.pushState) history.pushState(null, '', hash); else location.hash = hash;
    // Keyboard focus follows, as a native jump to a fragment would move it.
    if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
    target.focus({ preventScroll: true });
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

  // Back-to-top button, shown once the reader is well down the page.
  const toTop = document.createElement('button');
  toTop.className = 'to-top';
  toTop.type = 'button';
  toTop.setAttribute('aria-label', 'Back to top');
  toTop.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5m0 0-6 6m6-6 6 6"/></svg>';
  toTop.addEventListener('click', () => scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }));
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

  for (const el of $$('[data-split]')) {
    let i = 0;
    const walk = (node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) {
          const frag = document.createDocumentFragment();
          for (const part of child.textContent.split(/(\s+)/)) {
            if (!part) continue;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); continue; }
            const span = document.createElement('span');
            span.className = 'word';
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

  /* ------------------------------------------------------------ reveals */

  const io = new Observer((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('is-in');
      if (e.target.matches('[data-split]')) $$('.gold-text', e.target).forEach((g) => g.classList.add('is-live'));
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });
  // Groups reveal their children one after another.
  $$('[data-stagger]').forEach((g) => [...g.children].forEach((c, i) => c.style.setProperty('--i', i)));
  $$('[data-reveal], [data-split], [data-pipeline], [data-stagger]').forEach((el) => io.observe(el));
  // boot.js stops its fail-open timer once this is set.
  window.Site.ready = true;

  /* ----------------------------------------------------------- counters */

  function countUp(el, target) {
    if (reduced) { el.textContent = target.toLocaleString(); return; }
    el.textContent = '0';
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / 1600);
      el.textContent = Math.round(target * (1 - Math.pow(1 - t, 4))).toLocaleString();
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  const counters = $$('[data-count]');
  if (counters.length) {
    const live = window.SENTINEL_STATIC
      ? Promise.resolve(window.SENTINEL_DEMO && window.SENTINEL_DEMO.stats)
      : fetch('/api/v1/threat-stats').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const cio = new Observer(async (entries) => {
      const stats = await live;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        cio.unobserve(e.target);
        let n = Number(e.target.dataset.count);
        if (stats && e.target.dataset.live === 'threats' && stats.trackedThreats > 1000) n = stats.trackedThreats;
        if (stats && e.target.dataset.live === 'checks' && stats.checks) n = stats.checks;
        if (stats && e.target.dataset.live === 'kinds' && stats.kinds) n = stats.kinds;
        countUp(e.target, n);
      }
    }, { threshold: 0.6 });
    counters.forEach((c) => cio.observe(c));
  }

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
