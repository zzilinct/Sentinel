/* Sentinel marketing site: navigation, reveals, the hero scan, counters. */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const Masks = window.SentinelMasks;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------- glyphs */

  function paintGlyphs(root = document) {
    for (const el of $$('[data-glyph]', root)) {
      if (!el.firstElementChild) el.innerHTML = Masks.svg(el.dataset.glyph);
    }
  }
  paintGlyphs();

  /* ---------------------------------------------------------------- nav */

  const nav = $('[data-nav]');
  if (nav) {
    const onScroll = () => nav.classList.toggle('is-scrolled', scrollY > 12);
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    const toggle = $('[data-nav-toggle]');
    toggle && toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    $$('.nav__links a', nav).forEach((a) => a.addEventListener('click', () => nav.classList.remove('is-open')));
  }

  $$('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });

  // Signed-in visitors get a direct way back into the app.
  fetch('/api/v1/auth/me', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      const slot = $('[data-auth-actions]');
      if (!me || !slot) return;
      slot.innerHTML = '<a class="btn btn--gold btn--sm" href="/app">Open Sentinel</a>';
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
          // Gradient text can't be split into separate boxes without losing the
          // gradient, so it animates in as one unit.
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

  const io = new IntersectionObserver((entries) => {
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
    const dur = 1600;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 4);
      el.textContent = Math.round(target * eased).toLocaleString();
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  const counters = $$('[data-count]');
  if (counters.length) {
    const live = fetch('/api/v1/threat-stats').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const cio = new IntersectionObserver(async (entries) => {
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

  /* ---------------------------------------------------------- hero scan */

  const stage = $('[data-stage]');
  if (stage) {
    const rows = $$('.res', stage);
    const scan = $('[data-scanline]', stage);
    const floats = $$('[data-float]', stage);
    const serp = $('[data-serp]', stage);

    const build = (row) => {
      const slot = $('.masks', row);
      slot.innerHTML = '';
      const spec = row.dataset.masks;
      if (!spec) return [];
      return spec.split(',').map((pair) => {
        const [threat, color] = pair.split(':');
        const m = document.createElement('span');
        m.className = `m m--${color}`;
        m.innerHTML = Masks.svg(threat);
        slot.appendChild(m);
        return m;
      });
    };

    const run = () => {
      floats.forEach((f) => f.classList.remove('is-on'));
      $$('.bar__fill', stage).forEach((b) => { b.style.width = '0'; });
      rows.forEach((r) => r.classList.remove('is-danger'));
      const built = rows.map(build);
      serp.style.setProperty('--scan-end', `${serp.offsetHeight + 20}px`);
      scan.classList.remove('is-running');
      void scan.offsetWidth;

      if (reduced) {
        built.flat().forEach((m) => m.classList.add('is-on'));
        floats.forEach((f) => f.classList.add('is-on'));
        $$('.bar__fill', stage).forEach((b) => { b.style.width = `${b.dataset.w}%`; });
        return;
      }

      scan.classList.add('is-running');
      rows.forEach((row, i) => {
        const at = 280 + (row.offsetTop / serp.offsetHeight) * 2300;
        setTimeout(() => {
          built[i].forEach((m, k) => setTimeout(() => m.classList.add('is-on'), k * 110));
          if ('danger' in row.dataset) row.classList.add('is-danger');
        }, at);
      });
      setTimeout(() => {
        floats[0] && floats[0].classList.add('is-on');
        $$('.bar__fill', stage).forEach((b, i) => setTimeout(() => { b.style.width = `${b.dataset.w}%`; }, 250 + i * 120));
      }, 2700);
      setTimeout(() => floats[1] && floats[1].classList.add('is-on'), 3300);
    };

    let timer = null;
    const sio = new IntersectionObserver((entries) => {
      const visible = entries[0].isIntersecting;
      if (visible) {
        stage.classList.add('is-in');
        if (!timer) { run(); timer = setInterval(run, 9000); }
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }, { threshold: 0.25 });
    sio.observe(stage);
  }

  /* ------------------------------------------------------ mask severity */

  for (const card of $$('[data-trio]')) {
    const colors = { yellow: 'var(--yellow)', orange: 'var(--orange)', red: 'var(--red)' };
    const buttons = $$('[data-sev]', card);
    buttons.forEach((b) => b.addEventListener('click', () => {
      buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      card.style.setProperty('--c', colors[b.dataset.sev]);
    }));
  }

  /* ---------------------------------------------------- download picker */

  const os = /Mac/i.test(navigator.platform) ? 'mac' : /Linux/i.test(navigator.platform) && !/Android/i.test(navigator.userAgent) ? 'linux' : 'windows';
  $$('[data-os-label]').forEach((el) => { el.textContent = { windows: 'Windows', mac: 'macOS', linux: 'Linux' }[os]; });
  $$('[data-os]').forEach((el) => { if (el.dataset.os === os) el.classList.add('is-current'); });
})();
