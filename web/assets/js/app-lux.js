/*
 * The app's motion layer (see app-lux.css). It only adds: app.js draws every page exactly as before, and this
 * watches #view to give each new page its entrance. Parts already on screen enter at once, the rest as they are
 * scrolled to; each page has its own way of entering (data-tab picks it in the CSS).
 *
 * Nothing is left hidden: only parts that arrive in the first moments of a page wait to enter, and every one of
 * them is revealed by the observer (or at once if there is none). With reduced motion it adds nothing but the
 * pointer-light, which does not move anything.
 */
(() => {
  'use strict';

  const view = document.getElementById('view');
  if (!view) return;
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  root.classList.add('lux-app');

  /* ---------------------------------------------------- atmosphere */

  if (!reduced) {
    const atmos = document.createElement('div');
    atmos.className = 'lux-atmos';
    atmos.setAttribute('aria-hidden', 'true');
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < (innerWidth < 760 ? 8 : 16); i++) {
      const m = document.createElement('i');
      m.style.cssText = `--x:${rnd(0, 100)}%;--y:${rnd(30, 100)}%;--dur:${rnd(7, 14)}s;--delay:${rnd(0, 7)}s;--rise:${-rnd(120, 360)}px;--dx:${rnd(-40, 40)}px;--o:${rnd(0.3, 0.75)}`;
      atmos.appendChild(m);
    }
    document.body.prepend(atmos);
  }

  /* ------------------------------------------------------ entrances */

  const PARTS = '.page-title, .verify-bar, .banner, .scanbox, .drop, .panel, .usage-list, .usage-mini, .locked, .feature, .grid2 > *, .plans > *, .list > li, .result, .ai-tab, .empty, .live';
  const STAGE_MS = 1800;   // parts arriving later than this after a page change simply appear
  const MAX_ROWS = 40;     // a longer list enters as one piece
  let tab = '';
  let pageAt = 0;
  const seen = new WeakSet();

  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      enter(e.target);
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -6% 0px' }) : null;

  function enter(el) {
    el.classList.remove('lux-wait');
    el.classList.add('lux-in');
    el.addEventListener('animationend', () => el.classList.remove('lux-in'), { once: true });
    if (el.classList.contains('page-title')) dressTitle(el);
    countUp(el);
  }

  function stage(el) {
    if (seen.has(el)) return;
    seen.add(el);
    // Inside a part that is itself entering, only list rows move on their own.
    const outer = el.parentElement && el.parentElement.closest('.lux-wait, .lux-in');
    if (outer && !el.matches('.list > li')) return;
    if (el.matches('.list > li') && el.parentElement.children.length > MAX_ROWS) return;
    const siblings = el.parentElement ? [...el.parentElement.children] : [];
    el.style.setProperty('--li', Math.min(siblings.indexOf(el), 10));
    if (el.classList.contains('page-title')) el.classList.add('lux-title');
    if (!io) { enter(el); return; }
    el.classList.add('lux-wait');
    io.observe(el);
  }

  function scan() {
    // With reduced motion nothing waits or moves, but the page still wears its rule beneath the title.
    if (reduced) { view.querySelectorAll('.page-title').forEach(dressTitle); return; }
    // Under the opening's sketch (intro.js) nothing enters yet: the page must be laid out as it will be, for the
    // sketch to be drawn from it. Entrances start as the sketch becomes the page.
    if (root.classList.contains('intro')) return;
    if (performance.now() - pageAt > STAGE_MS) return;
    view.querySelectorAll(PARTS).forEach(stage);
  }

  // A new page: app.js replaced #view's contents. Say which page, sweep, and stage what is there.
  function newPage() {
    const current = document.querySelector('.side__link[aria-current="page"]');
    const next = (current && current.dataset.route) || 'home';
    const changed = tab && next !== tab;
    tab = next;
    view.dataset.tab = tab;
    pageAt = performance.now();
    if (changed && !reduced) sweep();
    if (tab === 'home') addMask();
    scan();
  }

  let queued = false;
  new MutationObserver((records) => {
    const fresh = records.some((r) => r.target === view && [...r.addedNodes].some((n) => n.nodeType === 1 && n.classList.contains('view')));
    if (fresh) newPage();
    else if (!queued) {
      queued = true;
      requestAnimationFrame(() => { queued = false; scan(); });
    }
  }).observe(view, { childList: true, subtree: true });
  if (view.querySelector('.view')) newPage();
  document.addEventListener('sentinel:intro-done', () => { if (view.querySelector('.view')) newPage(); }, { once: true });

  /* ------------------------------------------- the sweep, between pages */

  function sweep() {
    const main = view.closest('.main') || view.parentElement;
    const old = main.querySelector(':scope > .lux-sweep');
    if (old) old.remove();
    const s = document.createElement('div');
    s.className = 'lux-sweep';
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<i></i><i></i><i></i>';
    main.prepend(s);
    setTimeout(() => s.remove(), 1200);
  }

  /* ------------------------------------------------- page headings */

  const RULE = '<svg class="lux-rule" viewBox="0 0 260 26" aria-hidden="true" focusable="false"><path pathLength="1" d="M130 13H0M130 13h130"/><path class="lux-rule__c" pathLength="1" d="M130 3l10 10-10 10-10-10z"/><path pathLength="1" d="M120 13c-6-9-16-9-20 0 4 9 14 9 20 0M140 13c6-9 16-9 20 0-4 9-14 9-20 0"/></svg>';

  function dressTitle(el) {
    const h1 = el.querySelector('h1');
    if (!h1 || h1.dataset.lux) return;
    h1.dataset.lux = '1';
    // Word by word, keeping any markup inside the heading (a gold name, say) as it was.
    let w = 0;
    const walk = (node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) {
          const parts = child.textContent.split(/(\s+)/);
          const frag = document.createDocumentFragment();
          for (const p of parts) {
            if (!p) continue;
            if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); continue; }
            const span = document.createElement('span');
            span.className = 'lux-word';
            span.style.setProperty('--w', w++);
            span.textContent = p;
            frag.appendChild(span);
          }
          child.replaceWith(frag);
        } else if (child.nodeType === 1) walk(child);
      }
    };
    walk(h1);
    h1.setAttribute('aria-label', h1.textContent);
    h1.insertAdjacentHTML('afterend', RULE);
  }

  /* --------------------------------------------- the overview's mask */

  function addMask() {
    const head = view.querySelector('.page-title');
    if (!head || head.querySelector('.lux-mask')) return;
    head.insertAdjacentHTML('beforeend', '<div class="lux-mask" aria-hidden="true"><img src="/assets/img/masks/onyx.webp" width="788" height="896" alt=""></div>');
  }

  /* ---------------------------------------------- numbers that count */

  function countUp(el) {
    if (reduced) return;
    el.querySelectorAll('.usage-row__n').forEach((b) => {
      const text = b.firstChild;
      if (!text || text.nodeType !== 3) return;
      const target = Number(text.textContent.replace(/,/g, ''));
      if (!Number.isFinite(target) || target <= 0 || b.dataset.counted) return;
      b.dataset.counted = '1';
      b.classList.add('lux-count');
      const t0 = performance.now();
      const dur = 900;
      const tick = (now) => {
        const u = Math.min(1, (now - t0) / dur);
        text.textContent = Math.round(target * (1 - Math.pow(1 - u, 3))).toLocaleString();
        if (u < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  /* ------------------------------------------------- pointer light */

  if (fine) {
    const LIT = '.panel, .usage-list, .locked, .feature, .plans .plan';
    let pending = null;
    addEventListener('pointermove', (e) => {
      if (pending) { pending.e = e; return; }
      pending = { e };
      requestAnimationFrame(() => {
        const { e: ev } = pending;
        pending = null;
        const lit = ev.target.closest && ev.target.closest(LIT);
        if (lit) {
          const r = lit.getBoundingClientRect();
          lit.style.setProperty('--mx', `${ev.clientX - r.left}px`);
          lit.style.setProperty('--my', `${ev.clientY - r.top}px`);
        }
        if (reduced) return;
        // The logo and the overview's mask lean toward the pointer.
        const x = ev.clientX / innerWidth - 0.5;
        const y = ev.clientY / innerHeight - 0.5;
        for (const el of document.querySelectorAll('.side .logo__mark, .lux-mask img')) {
          el.style.setProperty('--ry', `${x * 22}deg`);
          el.style.setProperty('--rx', `${-y * 14}deg`);
        }
      });
    }, { passive: true });
  }
})();
