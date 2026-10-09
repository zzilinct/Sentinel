/*
 * The app's motion layer (see app-lux.css). It only adds: app.js draws every page exactly as before, and this
 * watches #view to give each new page its entrance. Parts already on screen enter at once, the rest as they are
 * scrolled to; each page has its own way of entering (data-tab picks it in the CSS).
 *
 * Nothing is left hidden: only parts that arrive in the first moments of a page wait to enter, and every one of
 * them is revealed by the observer (or at once if there is none). Tiles pop in on a spring, figures count up, a
 * dark circle wipes from the pressed link to the new page, page titles wear a small label, and toasts are shown as
 * one dark island. With reduced motion every one of these is instant and calm: labels and the island stay (the
 * island only fades), a new page fades in, and nothing counts, wipes or pops.
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

  // Tiles, cards and icon grids pop in on a short spring instead of their page's entrance.
  const TILES = '.usage-list > *, .feature-grid > .feature, .plans > .plan, [data-checkup-out] .list > li';
  const PARTS = `.page-title, .verify-bar, .banner, .scanbox, .drop, .panel, .usage-mini, .locked, .grid2 > *, .list > li, .result, .ai-tab, .empty, .live, ${TILES}`;
  const STAGE_MS = 1800;   // parts arriving later than this after a page change simply appear
  const MAX_ROWS = 40;     // a longer list enters as one piece
  let tab = '';
  let pageAt = 0;
  let latePop = false;     // the checkup's findings arrive after a click: they pop in once per page view
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
    // Only the part's own animation ends it: its icons' pops bubble up here too.
    const done = (e) => { if (e.target !== el) return; el.classList.remove('lux-in'); el.removeEventListener('animationend', done); };
    el.addEventListener('animationend', done);
    if (el.classList.contains('page-title')) dressTitle(el);
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
    if (el.matches(TILES)) el.classList.add('lux-tile');
    if (!io) { enter(el); return; }
    el.classList.add('lux-wait');
    io.observe(el);
  }

  function scan() {
    addLabel();
    // With reduced motion nothing waits or moves, but the page still wears its rule beneath the title.
    if (reduced) { view.querySelectorAll('.page-title').forEach(dressTitle); return; }
    // Under the opening's sketch (intro.js) nothing enters yet: the page must be laid out as it will be, for the
    // sketch to be drawn from it. Entrances start as the sketch becomes the page.
    if (root.classList.contains('intro')) return;
    findCounts();
    if (performance.now() - pageAt > STAGE_MS) {
      if (latePop || tab !== 'checkup') return;
      const rows = view.querySelectorAll('[data-checkup-out] .list > li');
      if (!rows.length) return;
      latePop = true;
      rows.forEach(stage);
      return;
    }
    view.querySelectorAll(PARTS).forEach(stage);
  }

  // A new page: app.js replaced #view's contents. Say which page, sweep, and stage what is there.
  function newPage(old) {
    const current = document.querySelector('.side__link[aria-current="page"]');
    const next = (current && current.dataset.route) || 'home';
    const changed = tab && next !== tab;
    const was = tab;
    tab = next;
    view.dataset.tab = tab;
    pageAt = performance.now();
    latePop = false;
    if (changed) {
      if (reduced) { const v = view.querySelector('.view'); if (v) v.classList.add('lux-calm'); }
      else { wipe(current); ghostTitle(old, was); }
    }
    if (tab === 'home') addMask();
    scan();
  }

  let queued = false;
  new MutationObserver((records) => {
    const isView = (n) => n.nodeType === 1 && n.classList.contains('view');
    const fresh = records.some((r) => r.target === view && [...r.addedNodes].some(isView));
    let old = null;
    for (const r of records) if (r.target === view) old = [...r.removedNodes].find(isView) || old;
    if (fresh) newPage(old);
    else if (!queued) {
      queued = true;
      requestAnimationFrame(() => { queued = false; scan(); });
    }
  }).observe(view, { childList: true, subtree: true });
  if (view.querySelector('.view')) newPage();
  document.addEventListener('sentinel:intro-done', () => { if (view.querySelector('.view')) newPage(); }, { once: true });

  /* -------------------------------------------- the wipe, between pages */

  // A soft dark circle, rimmed in faint gold like the black hole, grows from the sidebar link that was pressed and
  // passes over the new page, which is already drawn and answering beneath it: the wipe never takes the pointer.
  let pressed = null;
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('.side__link');
    if (a) pressed = { a, x: e.clientX, y: e.clientY, t: performance.now() };
  }, true);

  const WIPE_MS = 420;
  const WIPE_PX = 200;     // the circle's drawn size; it is scaled up from there, which also softens its edge
  function wipe(link) {
    const main = view.closest('.main') || view.parentElement;
    const left = Math.max(0, main.getBoundingClientRect().left);
    // From where the link was pressed; a keyboard press (or a page opened another way) starts at the link's middle.
    let x, y;
    if (pressed && performance.now() - pressed.t < 800 && (pressed.x || pressed.y)) ({ x, y } = pressed);
    else {
      const r = ((pressed && pressed.a) || link || main).getBoundingClientRect();
      x = r.left + r.width / 2; y = r.top + r.height / 2;
    }
    pressed = null;
    const w = innerWidth - left;
    const h = innerHeight;
    const lx = x - left;
    const far = Math.max(Math.hypot(lx, y), Math.hypot(lx - w, y), Math.hypot(lx, y - h), Math.hypot(lx - w, y - h));
    const old = document.querySelector('body > .lux-wipe');
    if (old) old.remove();
    const s = document.createElement('div');
    s.className = 'lux-wipe';
    s.setAttribute('aria-hidden', 'true');
    // At full size the circle's clear middle (the inner 54% of its radius) holds the farthest corner.
    s.style.cssText = `left:${left}px;--x:${(lx - WIPE_PX / 2).toFixed(1)}px;--y:${(y - WIPE_PX / 2).toFixed(1)}px;--s:${(far / (WIPE_PX * 0.27)).toFixed(2)}`;
    s.innerHTML = '<i></i>';
    document.body.appendChild(s);
    setTimeout(() => s.remove(), WIPE_MS + 80);
  }

  /* ------------------------------------------------- page headings */

  const RULE = '<svg class="lux-rule" viewBox="0 0 260 26" aria-hidden="true" focusable="false"><path pathLength="1" d="M130 13H0M130 13h130"/><path class="lux-rule__c" pathLength="1" d="M130 3l10 10-10 10-10-10z"/><path pathLength="1" d="M120 13c-6-9-16-9-20 0 4 9 14 9 20 0M140 13c6-9 16-9 20 0-4 9-14 9-20 0"/></svg>';

  // The small tracked label over each page's headline, as the reel's "AGENTS" sits over "9 new agents".
  const LABELS = { home: 'Overview', week: 'Your week', protection: 'Always on', scan: 'Check a link', threats: 'Check a file', email: 'Check an email', history: 'Your record', sites: 'Your rules', recover: 'Recovery', checkup: 'Your browsers', plan: 'Account', security: 'Account', assistants: 'Account' };

  // Put on as soon as the page is drawn, before anything is laid out around it, so nothing shifts when it appears.
  function addLabel() {
    const h1 = view.querySelector('.page-title h1');
    if (!h1 || !LABELS[tab] || (h1.previousElementSibling && h1.previousElementSibling.classList.contains('lux-label'))) return;
    h1.insertAdjacentHTML('beforebegin', `<span class="lux-label" aria-hidden="true">${LABELS[tab]}</span>`);
  }

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

  // The page that was open leaves its label and headline where they stood, fading up and out while the new pair
  // rises into the same place: the two cross-fade together.
  function ghostTitle(old, was) {
    const before = old && old.querySelector('.page-title h1');
    const head = view.querySelector('.page-title > div');
    const h1 = head && head.querySelector('h1');
    if (!before || !h1) return;
    const main = view.closest('.main') || view.parentElement;
    const mr = main.getBoundingClientRect();
    const hr = head.getBoundingClientRect();
    const cs = getComputedStyle(h1);
    const g = document.createElement('div');
    g.className = 'lux-ghost';
    g.setAttribute('aria-hidden', 'true');
    g.style.cssText = `left:${hr.left - mr.left}px;top:${hr.top - mr.top}px;width:${hr.width}px`;
    const label = document.createElement('span');
    label.className = 'lux-label';
    label.textContent = LABELS[was] || '';
    const words = document.createElement('div');
    // Property by property: the computed `font` shorthand is empty when the heading sets a longhand it cannot express.
    for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'lineHeight', 'letterSpacing', 'color']) words.style[p] = cs[p];
    words.textContent = before.getAttribute('aria-label') || before.textContent;
    g.append(label, words);
    main.appendChild(g);
    setTimeout(() => g.remove(), 600);
  }

  /* --------------------------------------------- the overview's mask */

  function addMask() {
    const head = view.querySelector('.page-title');
    if (!head || head.querySelector('.lux-mask')) return;
    // In 3D when it can be (cosmos.js fetches the models): it turns to watch the pointer as it comes near.
    head.insertAdjacentHTML('beforeend', '<div class="lux-mask" aria-hidden="true"><span class="m3" data-mask3d="onyx" data-pose="lay" data-look="380"><img src="/assets/img/masks/onyx.webp" width="788" height="896" alt=""></span></div>');
    if (window.SentinelLoadMask3D) window.SentinelLoadMask3D();
  }

  /* ---------------------------------------------- numbers that count */

  // Usage figures, live minutes and the counts of what was checked run up from 0 to the real figure as they come on
  // screen, while the meter beside them fills over the same time. Only the text app.js wrote is used: if it writes
  // a newer figure mid-count (a live count refreshing), the count stops and its figure stands.
  const COUNTS = '.usage-row__n, .meters__head .mono, .intel__total b, [data-live-counts], [data-chat-seen], [data-text-seen], [data-week-n]';
  const COUNT_MS = 1200;   // the meters' fill (app-lux.css, lux-fill) takes as long, after the same delay
  const COUNT_DELAY = 250;
  const countIo = !reduced && 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      countIo.unobserve(e.target);
      countUp(e.target);
    }
  }) : null;

  function findCounts() {
    if (!countIo) return;
    view.querySelectorAll(COUNTS).forEach((el) => {
      if (el.dataset.counted) return;
      el.dataset.counted = '1';
      countIo.observe(el);
    });
  }

  function countUp(el) {
    const node = [...el.childNodes].find((n) => n.nodeType === 3 && /\d/.test(n.textContent));
    if (!node) return;
    const text = node.textContent;
    const nums = [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => {
      const raw = m[0].replace(/,/g, '');
      return { at: m.index, len: m[0].length, n: Number(raw), dp: (raw.split('.')[1] || '').length, sep: m[0].includes(',') };
    }).filter((x) => Number.isFinite(x.n) && x.n > 0);
    if (!nums.length) return;
    el.classList.add('lux-count');
    const row = el.closest('.usage-row, .meters__item');
    if (row) row.classList.add('lux-grow');
    const frame = (u) => {
      let out = '';
      let i = 0;
      for (const x of nums) {
        const v = x.n * u;
        out += text.slice(i, x.at) + (x.dp ? v.toFixed(x.dp) : x.sep ? Math.round(v).toLocaleString() : String(Math.round(v)));
        i = x.at + x.len;
      }
      return out + text.slice(i);
    };
    let wrote = frame(0);
    node.textContent = wrote;
    const t0 = performance.now() + COUNT_DELAY;
    const tick = (now) => {
      if (node.textContent !== wrote) return;
      const u = Math.max(0, Math.min(1, (now - t0) / COUNT_MS));
      wrote = u < 1 ? frame(1 - Math.pow(1 - u, 4)) : text;
      node.textContent = wrote;
      if (u < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
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

  /* ------------------------------------------------------ the island */

  // ui.js still makes its toasts, and their box stays the live region a screen reader hears. On screen they are one
  // dark island at the top: a pill that springs open into a card holding the message, morphs straight into the next
  // message when one follows, and folds back into the pill and leaves when the last is gone.
  const PILL_W = 120;
  const PILL_H = 34;
  let island = null;
  let shown = null;
  let closing = 0;

  function islandFor(host) {
    if (island) return;
    island = document.createElement('div');
    island.className = 'lux-island';
    island.setAttribute('aria-hidden', 'true');
    document.body.appendChild(island);
    host.classList.add('lux-island-host');
    const sync = () => {
      const all = host.querySelectorAll(':scope > .toast');
      const t = all[all.length - 1] || null;
      if (t === shown) return;
      shown = t;
      if (t) islandShow(t); else islandClose();
    };
    new MutationObserver(sync).observe(host, { childList: true });
    sync();
  }

  function size(w, h) { island.style.width = `${w}px`; island.style.height = `${h}px`; }

  function islandShow(t) {
    clearTimeout(closing);
    const kind = (t.className.match(/toast--(\w+)/) || [])[1] || 'info';
    const msg = document.createElement('div');
    msg.className = `lux-island__msg is-${kind}`;
    msg.innerHTML = '<i></i><span></span>';
    msg.lastChild.textContent = t.textContent;
    for (const m of island.querySelectorAll('.lux-island__msg')) { m.classList.add('is-out'); setTimeout(() => m.remove(), 260); }
    island.appendChild(msg);
    // The message is placed on its own, so it is measured at the size it wants, whatever the island is now.
    const w = Math.ceil(msg.offsetWidth);
    const h = Math.ceil(msg.offsetHeight);
    if (!island.classList.contains('is-open')) {
      size(PILL_W, PILL_H);
      island.getBoundingClientRect();
      island.classList.add('is-open');
      // The pill lands first, then opens into the card.
      if (!reduced) { closing = setTimeout(() => size(w, h), 110); return; }
    }
    size(w, h);
  }

  function islandClose() {
    clearTimeout(closing);
    for (const m of island.querySelectorAll('.lux-island__msg')) { m.classList.add('is-out'); setTimeout(() => m.remove(), 260); }
    if (reduced) { island.classList.remove('is-open'); return; }
    size(PILL_W, PILL_H);
    closing = setTimeout(() => island.classList.remove('is-open'), 300);
  }

  const hostNow = document.querySelector('body > .toasts');
  if (hostNow) islandFor(hostNow);
  else {
    const watch = new MutationObserver(() => {
      const host = document.querySelector('body > .toasts');
      if (!host) return;
      watch.disconnect();
      islandFor(host);
    });
    watch.observe(document.body, { childList: true });
  }
})();
