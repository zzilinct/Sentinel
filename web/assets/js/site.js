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

  $$('[data-glyph]').forEach((el) => { if (!el.firstElementChild) el.innerHTML = Masks.svg(el.dataset.glyph); });
  $$('[data-kind]').forEach((el) => { if (!el.firstElementChild) el.innerHTML = Masks.kindIcon(el.dataset.kind); });

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
      if (ev.key === 'Escape' && nav.classList.contains('is-open')) { nav.classList.remove('is-open'); toggle && toggle.focus(); }
    });
    document.addEventListener('click', (ev) => {
      if (!nav.contains(ev.target) && nav.classList.contains('is-open')) {
        nav.classList.remove('is-open');
        toggle && toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Back-to-top button, shown once the reader is well down the page.
  const toTop = document.createElement('button');
  toTop.className = 'to-top';
  toTop.type = 'button';
  toTop.setAttribute('aria-label', 'Back to top');
  toTop.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5m0 0-6 6m6-6 6 6"/></svg>';
  toTop.addEventListener('click', () => scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }));
  document.body.appendChild(toTop);

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      if (nav) nav.classList.toggle('is-scrolled', scrollY > 12);
      toTop.classList.toggle('is-on', scrollY > innerHeight * 1.5);
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
      }
    }, { rootMargin: '-45% 0px -50% 0px' });
    spyTargets.forEach((t) => spy.observe(t));
  } else if (location.pathname === '/pricing') {
    spyLinks.forEach((a) => a.classList.toggle('is-active', a.dataset.spy === 'pricing'));
  }

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
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  $$('[data-reveal], [data-split], [data-pipeline]').forEach((el) => io.observe(el));

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
      } else if (state.hours > 96) {
        pick = 'ultimate';
        why = `at around ${state.hours} hours a week you&rsquo;d run past Max&rsquo;s 96, and Ultimate lifts the weekly cap entirely.`;
      } else if (state.email || state.hours > 24) {
        pick = 'max';
        why = state.email
          ? 'pasting emails in for a full scan is part of Max, and it researches every live result too.'
          : `at around ${state.hours} hours a week you&rsquo;d outgrow Pro&rsquo;s 24; Max gives you 96, with research on every result.`;
      } else {
        pick = 'pro';
        why = `its 24 live hours a week cover your ${state.hours}, and minutes only count while Sentinel is actually checking something.`;
      }
      answer.innerHTML = `<b>${{ free: 'Free', pro: 'Pro', max: 'Max', ultimate: 'Ultimate' }[pick]}</b> fits best &mdash; ${why}`;

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

  /* ---------------------------------------------------- download picker */

  const os = /Mac/i.test(navigator.platform) ? 'mac' : /Linux/i.test(navigator.platform) && !/Android/i.test(navigator.userAgent) ? 'linux' : 'windows';
  $$('[data-os-label]').forEach((el) => { el.textContent = { windows: 'Windows', mac: 'macOS', linux: 'Linux' }[os]; });
})();
