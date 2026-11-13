/* Sentinel web app. */
(() => {
  'use strict';

  const { api, esc, $, $$, h, ago, until, bytes, toast, stateBlock, busy, verdict, resultGlyph, wireVerdict, color } = window.UI;
  const Masks = window.SentinelMasks;
  const view = $('#view');
  const desktop = window.sentinelDesktop || null;
  // Motion Off (boot.js data-motion): nothing glides or rises. Asked each time: it can change while the app is open.
  const still = () => document.documentElement.dataset.motion === 'off';
  const glide = () => (still() ? 'auto' : 'smooth');

  const state = { me: null, config: null, plans: null, desktopInfo: null };
  const Share = window.SentinelShare;
  // What was handed to the Check page (checkView) from elsewhere: the phone's Share menu, the Overview box, the palette.
  let shared = null;
  // The share a POST to /app/share put in the box for this page (sw.js gives its time as ?box=); 0 when none.
  let shareBox = 0;
  // iPhones never list a web app in their Share menu.
  const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const IPHONE_NOTE = 'On iPhone, web apps cannot be in the Share menu. Press and hold the message or link, choose Copy, then paste it here.';

  const ICON = {
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v6c0 4.5 3 8.2 7 9 4-.8 7-4.5 7-9V6l-7-3Z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
    search: '<svg class="lead" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 20h14"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M5 20h14"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>',
    qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></svg>'
  };

  /* ================================================================ boot */

  async function boot() {
    // A share sent as /app/share?title=&text=&url= waits on this device, off the address bar, so that signing in first
    // (the address goes to the sign-in page) loses nothing and carries none of it along. Any other page empties the
    // share box: what was shared is not kept beyond the check it was for.
    if (location.pathname.replace(/\/$/, '') === '/app/share') {
      const q = new URLSearchParams(location.search);
      // Which share in the box is this page's own (sw.js): kept here, off the address bar.
      if (/^\d{1,15}$/.test(q.get('box') || '')) { shareBox = Number(q.get('box')); history.replaceState({}, '', '/app/share'); }
      if (['title', 'text', 'url'].some((k) => q.get(k))) {
        try { await Share.put({ title: q.get('title') || '', text: q.get('text') || '', url: q.get('url') || '' }); } catch { /* read below, from the address */ }
        history.replaceState({}, '', '/app/share');
        if (!q.has('missed')) shared = { query: q };
      }
    }
    try {
      const [me, config] = await Promise.all([api('/auth/me'), api('/auth/config')]);
      state.me = me;
      state.config = config;
      state.plans = config.plans;
      // Signed in: the look this account chose on its other devices (look.js), without waiting for it.
      if (window.SentinelLook && SentinelLook.sync) SentinelLook.sync();
      // Signed in on any other page: a share made signed out moments ago (in another tab, or before signing in here)
      // opens its check here; anything older is emptied out. Signed out, it is left waiting for the sign-in.
      if (location.pathname.replace(/\/$/, '') !== '/app/share' && await Share.waiting()) history.replaceState({}, '', '/app/share');
    } catch (err) {
      if (err.status === 401) {
        location.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
        return;
      }
      // Nothing else has been drawn yet, so loading again is this part's own loader.
      failed(view, err, () => location.reload(), { what: 'Sentinel' });
      return;
    }

    $$('[data-glyph]').forEach((el) => { el.innerHTML = Masks.svg(el.dataset.glyph); });
    paintAccount();
    paintModelBadge();
    // The first screen depends on what the desktop says (is live scanning on?), so ask before drawing it.
    // Pairing itself can finish afterwards.
    if (desktop) { try { state.desktopInfo = await desktop.info(); } catch { /* bridge optional */ } }
    pairDesktop();
    if (desktop && desktop.onPageThreat) desktop.onPageThreat((item) => {
      toast(`${item.label}: ${item.host}`, item.badge === 'red' ? 'error' : 'info', 8000);
    });
    if (desktop && desktop.onDefenseThreat) desktop.onDefenseThreat((item) => {
      toast(`Stopped ${item.label}: ${item.name}`, 'error', 9000);
    });

    document.addEventListener('click', (ev) => {
      const a = ev.target.closest('a[href^="/app"]');
      if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey || a.target === '_blank') return;
      ev.preventDefault();
      navigate(a.getAttribute('href'));
    });
    // Words pasted in Arabic or Hebrew run right to left in the box: set from the first letters, not by dir="auto" or
    // unicode-bidi: plaintext, which made reading a 5 MB paste take over a minute.
    const RTL = /^[^\p{L}]*[֐-ࣿיִ-﷿ﹰ-﻿]/u;
    document.addEventListener('input', (ev) => {
      const boxes = ev.target.matches('textarea') ? [ev.target] : $$('textarea', ev.target);
      for (const t of boxes) t.dir = RTL.test(t.value.slice(0, 200)) ? 'rtl' : 'ltr';
    });
    addEventListener('popstate', render);
    $('[data-signout]').addEventListener('click', signOut);
    wireShortcuts();
    render();
  }

  function navigate(href) {
    if (!href.startsWith('/app')) { location.href = href; return; }   // /call is a public page, outside the app
    // The page already open, asked for again ("Scan again" on the link just scanned): run it again, without a new
    // history entry.
    if (href === location.pathname + location.search) history.replaceState({}, '', href);
    else history.pushState({}, '', href);
    render();
    scrollTo({ top: 0, behavior: 'instant' });
  }

  function applyUsage(usage) {
    if (!usage || !state.me) return;
    state.me.usage = usage;
    paintAccount();
  }

  const plan = () => state.me.plan;
  const usage = () => state.me.usage;
  const left = (key) => Math.max(0, usage()[key].limit - usage()[key].used);
  // Ultimate has no weekly live-hours ceiling; the API sends null for that.
  const uncapped = (limit) => limit === null;
  const hours = (minutes) => (minutes / 60).toFixed(minutes < 36000 ? 1 : 0);

  function paintAccount() {
    const u = state.me.user;
    const initials = ((u.firstName || '?')[0] + (u.lastName ? u.lastName[0] : '')).toUpperCase();
    $$('[data-avatar]').forEach((el) => {
      if (u.avatarUrl) el.outerHTML = `<img class="avatar" src="${esc(u.avatarUrl)}" alt="" referrerpolicy="no-referrer" data-avatar>`;
      else el.textContent = initials;
    });
    $('[data-name]').textContent = u.name || u.email;
    $('[data-plan]').textContent = `${plan().name} plan`;

    const us = usage();
    const row = (label, used, limit, unit = '') => {
      const pct = limit ? Math.min(100, (used / limit) * 100) : 100;
      return `<div class="usage-mini__row"><span>${label}</span><b class="tabular">${limit ? `${Math.max(0, limit - used)}${unit} left` : 'Locked'}</b></div>
              <div class="meter${pct >= 100 ? ' is-full' : ''}"><i style="width:${limit ? 100 - pct : 0}%"></i></div>`;
    };
    // Both live allowances, each in the unit it is sold in: Free has 15 minutes of fast scanning, not "Locked".
    const liveRow = (label, m) => {
      if (!m) return '';
      if (uncapped(m.limit)) return `<div class="usage-mini__row"><span>${label}</span><b class="tabular">Unlimited</b></div><div class="meter is-uncapped"><i style="width:100%"></i></div>`;
      if (m.limit < 120) return row(label, Math.round(m.used), m.limit, ' min');
      const leftH = Math.max(0, m.limit - m.used) / 60;
      return row(label, m.used / 60, m.limit / 60, 'h').replace(/>[\d.]+h left</, () => `>${leftH.toFixed(leftH < 10 && leftH % 1 ? 1 : 0)}h left<`);
    };
    $('[data-usage-mini]').innerHTML =
      (uncapped(us.linkScans.limit) ? '<div class="usage-mini__row"><span>Fast scans</span><b class="tabular">Unlimited</b></div><div class="meter is-uncapped"><i style="width:100%"></i></div>' : row('Fast scans', us.linkScans.used, us.linkScans.limit)) +
      row('Delicate scans', (us.deepScans || {}).used || 0, (us.deepScans || {}).limit || 0) +
      row('Virus scans', us.fileScans.used, us.fileScans.limit) +
      liveRow('Fast live', us.fastMinutes) +
      liveRow('Delicate live', us.liveMinutes);
  }

  async function pairDesktop() {
    if (!desktop) return;
    try {
      state.desktopInfo = await desktop.info();
      // Already paired with this account: don't mint another long-lived token.
      if (state.desktopInfo.pairedUserId === state.me.user.id) return;
      const { token } = await api('/auth/client-token', { method: 'POST', body: { client: 'desktop' } });
      await desktop.setToken(token, state.me.user.id);
      state.desktopInfo = await desktop.info();
    } catch { /* desktop bridge optional */ }
  }

  // The account button asks first: one press says what a second press will do, so a stray tap never signs you out.
  let signOutArmed = 0;
  async function signOut(ev) {
    const button = ev && ev.currentTarget;
    if (button && Date.now() - signOutArmed > 4000) {
      signOutArmed = Date.now();
      const plan = $('[data-plan]', button);
      const was = plan ? plan.textContent : '';
      if (plan) plan.textContent = 'Press again to sign out';
      button.setAttribute('aria-label', 'Press again to sign out');
      setTimeout(() => {
        if (Date.now() - signOutArmed < 3900) return;
        if (plan && plan.textContent === 'Press again to sign out') plan.textContent = was;
        button.setAttribute('aria-label', 'Sign out');
      }, 4050);
      return;
    }
    // The Sentinel app first: when the parent lock refuses, nothing is signed out and the person is told why.
    if (desktop) {
      try { await desktop.clearToken(); } catch (err) { toast(`Still signed in. ${desktopError(err)}`, 'error'); return; }
    }
    try { await api('/auth/logout', { method: 'POST', body: {} }); } catch { /* ignore */ }
    location.href = '/';
  }

  /* ============================================================== router */

  const ROUTES = {
    '/app': ['home', home],
    '/app/week': ['week', weekView],
    '/app/check': ['check', checkView],
    '/app/scan': ['check', checkView],
    '/app/threats': ['check', checkView],
    '/app/email': ['check', checkView],
    '/app/text': ['check', checkView],
    '/app/history': ['history', historyView],
    '/app/protection': ['protection', protectionView],
    '/app/download': ['protection', protectionView],
    '/app/plan': ['plan', planView],
    '/app/settings': ['settings', settingsView],
    '/app/assistants': ['assistants', assistantsView],
    '/app/sites': ['sites', sitesView],
    '/app/checkup': ['checkup', checkupView],
    '/app/recover': ['recover', recoverView],
    '/app/share': ['share', shareView]
  };

  // Addresses of what moved into Settings, kept working (older apps, tray clicks, notifications and bookmarks use them):
  // Security is Settings' account group, and these parts of Live protection are rows of their own there.
  const MOVED_TO_SETTINGS = ['chat-safety', 'text-safety', 'parent-lock', 'my-sites'];

  function render() {
    let path = location.pathname.replace(/\/$/, '') || '/app';
    const hash = location.hash.slice(1);
    if (path === '/app/security' || (path === '/app/protection' && MOVED_TO_SETTINGS.includes(hash))) {
      history.replaceState(history.state, '', `/app/settings#${path === '/app/security' ? 'account' : hash}`);
      path = '/app/settings';
    }
    const [name, fn] = ROUTES[path] || ROUTES['/app'];
    $$('[data-route]').forEach((a) => {
      if (a.dataset.route === name) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    $$('[data-desktop]', view).forEach((slot) => { (slot._off || []).forEach((off) => off()); slot._off = []; });
    view.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'view';
    // Accounts that still owe the age confirmation and terms acceptance see
    // nothing else until they've given it. Google sign-ups land here.
    if (state.me.user.needsTerms) { view.appendChild(el); termsGate(el); return; }
    // The reminder lives beside the view, not inside it: every view replaces its own innerHTML.
    if (state.config.verificationAvailable && !state.me.user.emailVerified) view.appendChild(verifyBar());
    view.appendChild(el);
    fn(el, new URLSearchParams(location.search));
    // Every view draws its forms synchronously before it waits on anything, so what was typed can go back in now.
    restoreDrafts();
    document.title = `${{ home: 'Overview', week: 'Your week', check: 'Check', call: 'Is this call a scam?', history: 'History', protection: 'Live protection', plan: 'Plan & usage', settings: 'Settings', assistants: 'AI assistants', sites: 'Site rules', checkup: 'Browser checkup', recover: 'Recovery guide', share: 'Shared with Sentinel' }[name]} · Sentinel`;
  }

  /** Render a verdict with its checklist tools and follow-up actions. */
  function showVerdict(out, v, opts = {}) {
    out.innerHTML = verdict(v, opts) + actionsFor(v);
    wireVerdict(out, v);
    wireActions(out, v);
    restoreDrafts();
    riseMask(out);
    // The answer is somewhere new on the page: keyboard and screen reader users are taken to its heading.
    const heading = opts.focus && $('h2', out);
    if (heading) { heading.tabIndex = -1; heading.focus(); }
  }

  // The verdict's real 3D mask, over its still picture, which stays where there is no WebGL and with reduced motion
  // (cosmos.js fetches the models). data-rise says when the verdict landed: a mask ready soon enough rises into place.
  function riseMask(out) {
    const mask = $('[data-verdict-mask]', out);
    if (!mask || !window.SentinelLoadMask3D || still()) return;
    mask.dataset.rise = String(performance.now());
    mask.dataset.mask3d = mask.dataset.verdictMask;
    window.SentinelLoadMask3D();
  }

  // The views are drawn after the page loads, so boot.js cannot put drafts back by itself: each view asks it to.
  function restoreDrafts() {
    if (window.sentinelDrafts) window.sentinelDrafts.restore();
  }

  // The desktop app's errors arrive wrapped by Electron ("Error invoking remote method 'x': Error: ..."). People get
  // the sentence underneath, or a plain one when what is left is a system code, a file path or a stack trace.
  function desktopError(err) {
    const inner = String((err && err.message) || '').replace(/^Error invoking remote method '[^']*':\s*/, '');
    // A plain Error carries a sentence the app wrote; a TypeError or the like is a fault in the code.
    const fault = /^\w+Error:/.test(inner) && !/^Error:/.test(inner);
    const text = inner.replace(/^Error:\s*/, '').trim();
    const technical = fault || !text || /\bE[A-Z]{3,}\b|[A-Za-z]:\\|\/[\w.-]+\/|\bat\s+\S+\s*\(|\n\s*at\s/.test(text);
    return technical ? 'That did not work. Try again, or choose Open log folder from the Sentinel icon in the system tray.' : text;
  }

  /*
   * A part of a page that could not load says so in its own place, the same way everywhere (ui.js stateBlock), with
   * Try again running that part's own loader, never the whole page. When nothing answered at all, it waits for the
   * connection instead, and loads again by itself when the browser says it is back. Focus goes to the new Try again
   * only when Try again was what failed, so a person pressing it is never left on nothing.
   */
  const waitingForNet = new Map();
  let retryPressed = false;
  // `quiet`, for something optional (a card or an offer on the Overview): one grey line, `what` as its sentence.
  function failed(slot, err, retry, { small = false, quiet = false, what = 'This' } = {}) {
    if (!slot || !slot.isConnected) return;
    const off = Boolean(err && err.offline);
    const action = retry ? '<button class="btn btn--sm" type="button" data-retry>Try again</button>' : '';
    if (quiet) {
      slot.innerHTML = stateBlock(off ? 'offline' : 'unavailable', esc(what), { action, small: true }).replace('class="empty ', off ? 'class="empty empty--line ' : 'role="status" class="empty empty--line ');
    } else {
      const text = off ? 'Sentinel cannot be reached. Check your internet connection.' : esc((err && err.message) || 'Sentinel had a problem on its side. Try again in a moment.');
      slot.innerHTML = stateBlock(off ? 'offline' : 'error', text, { title: off ? `${what} will load when you are back online` : `${what} could not be loaded`, action, small });
    }
    if (!retry) return;
    const again = $('[data-retry]', slot);
    again.addEventListener('click', () => { retryPressed = true; waitingForNet.delete(slot); retry(); });
    for (const old of waitingForNet.keys()) if (!old.isConnected) waitingForNet.delete(old);
    if (off) waitingForNet.set(slot, retry);
    if (retryPressed) again.focus();
    retryPressed = false;
  }
  /*
   * A wait is as tall as what it waits for, so nothing under it jumps when the answer comes: the height that part had
   * the last time it loaded on this device at this width (kept by `keep`), or, the first time, the height of what a
   * new account sees there (app.css .h-<key>). Kept on this device only; with storage blocked, the first-time height.
   */
  const HEIGHTS = 'sentinel:heights';
  const heightKey = (key) => `${key}:${innerWidth < 700 ? 'phone' : 'wide'}`;
  const heights = () => { try { return JSON.parse(localStorage.getItem(HEIGHTS) || '{}') || {}; } catch { return {}; } };
  function skel(key) {
    const h = Number(heights()[heightKey(key)]) || 0;
    return `<div class="skeleton h-${key}" data-skel="${key}"${h > 0 && h < 4000 ? ` style="height:${h}px"` : ''}></div>`;
  }
  function keep(slot, key) {
    if (!slot || !slot.isConnected) return;
    const cs = getComputedStyle(slot);
    const all = heights();
    all[heightKey(key)] = Math.round(slot.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
    try { localStorage.setItem(HEIGHTS, JSON.stringify(all)); } catch { /* the first-time height, next time too */ }
  }

  // The one line under the top while nothing answers (ui.js decides that from fetch itself, not navigator.onLine).
  document.addEventListener('sentinel:reach', (ev) => { const bar = $('[data-netbar]'); if (bar) bar.hidden = ev.detail.ok; });
  addEventListener('online', () => {
    for (const [slot, retry] of [...waitingForNet]) { waitingForNet.delete(slot); if (slot.isConnected) retry(); }
  });

  /* ========================================================== shortcuts */

  const PAGES = [
    ['Overview', '/app', 'home'], ['Your week', '/app/week', 'week'], ['Check a link, message, email, file or picture', '/app/check', 'check'],
    ['Is this call a scam?', '/call', 'call'], ['History', '/app/history', 'history'], ['Site rules', '/app/sites', 'sites'], ['Browser checkup', '/app/checkup', 'checkup'],
    ['Live protection', '/app/protection', 'protection'], ['Settings', '/app/settings', 'settings'], ['Plan & usage', '/app/plan', 'plan'],
    ['AI assistants', '/app/assistants', 'assistants'], ['Recovery guide', '/app/recover', 'recover']
  ];
  // Simple view lists the pages most people need; the side bar hides the rest the same way (app.html data-full).
  // They are never gone: a search finds every page, and the palette ends with Show all pages.
  const FULL_ONLY = ['week', 'sites', 'checkup', 'plan', 'assistants'];
  const simpleView = () => Boolean(window.SentinelSimple && window.SentinelSimple.get());
  const looksLikeUrl = (s) => /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(s.trim()) || /^https?:\/\/\S+$/i.test(s.trim());

  let palette = null;
  let paletteFrom = null;
  function openPalette(prefill = '') {
    if (palette) { palette.remove(); palette = null; }
    // Focus goes back where it was when the palette closes.
    paletteFrom = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    // A combobox whose choice is read out as it moves (aria-activedescendant), as a screen reader expects.
    palette = h(`<div class="palette" role="dialog" aria-modal="true" aria-label="Search or scan">
      <div class="palette__box">
        <div class="palette__input">${ICON.search}<input type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" placeholder="Paste something to check, or jump to a page" aria-label="Search pages, or paste something to check" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>
        <ul class="palette__list" id="palette-list" role="listbox" aria-label="Pages and links"></ul>
        <div class="palette__foot"><span><kbd>&uarr;</kbd><kbd>&darr;</kbd> move</span><span><kbd>&crarr;</kbd> open</span><span><kbd>/</kbd> scan box &middot; <kbd>?</kbd> shortcuts</span></div>
      </div>
    </div>`);
    document.body.appendChild(palette);
    const input = $('input', palette);
    const list = $('.palette__list', palette);
    let items = [];
    let active = 0;
    let recent = [];
    let recentLost = false;
    let allPages = !simpleView();
    api('/account/history').then((d) => { recent = d.items.filter((i) => i.kind === 'url').slice(0, 30); paint(); }).catch(() => { recentLost = true; paint(); });

    const paint = () => {
      const q = input.value.trim();
      items = [];
      if (q && looksLikeUrl(q)) items.push({ label: `Check ${q}`, hint: 'Link', href: `/app/check?url=${encodeURIComponent(q)}`, icon: ICON.link });
      // Words, not a page's name: a message or a number to check (route.js says which).
      else if (q && ((/\s/.test(q) && q.length >= 20) || window.SentinelRoute.guess({ text: q }) === 'number')) {
        const kind = window.SentinelRoute.guess({ text: q });
        items.push({ label: 'Check what you pasted', hint: kind === 'number' ? 'Phone number' : 'Message', run: () => { shared = { text: q }; navigate('/app/check'); }, icon: ICON.search });
      }
      for (const [label, href, route] of PAGES) if (q ? label.toLowerCase().includes(q.toLowerCase()) : allPages || !FULL_ONLY.includes(route)) items.push({ label, hint: 'Page', href, icon: ICON.shield });
      if (!q && !allPages) items.push({ label: 'Show all pages', hint: 'Simple view', run: () => { allPages = true; paint(); }, keep: true, icon: ICON.search });
      // A single setting, by any of its words ("roblox", "pin", "dark"), straight to its row.
      if (q) for (const r of SETTINGS) if (settingMatches(r, q)) items.push({ label: r.label, hint: 'Setting', href: `/app/settings#${r.id}`, icon: ICON.shield });
      for (const r of recent) if (q && r.target.toLowerCase().includes(q.toLowerCase())) items.push({ label: r.target, hint: 'Check again', href: `/app/check?url=${encodeURIComponent(r.target)}`, icon: ICON.clock });
      if (!q || 'sign out'.includes(q.toLowerCase())) items.push({ label: 'Sign out', hint: 'Account', run: () => signOut(), icon: ICON.lock });
      // Opened empty it lists every page (on a phone it is the More menu); a search shows the best few.
      if (q) items = items.slice(0, 9);
      active = Math.min(active, Math.max(0, items.length - 1));
      list.innerHTML = items.length ? items.map((it, i) => `<li role="option" id="palette-${i}" aria-selected="${i === active}" data-i="${i}"><span class="palette__icon">${it.icon}</span><span class="palette__label">${esc(it.label)}</span><span class="palette__hint">${esc(it.hint)}</span></li>`).join('')
        : '<li class="palette__empty" role="option" aria-disabled="true">Nothing matches. Paste a link or a message to check it.</li>';
      if (q && recentLost) list.insertAdjacentHTML('beforeend', '<li class="palette__empty" role="option" aria-disabled="true">Your recent checks could not be loaded, so they are not in this search.</li>');
      if (items.length) input.setAttribute('aria-activedescendant', `palette-${active}`); else input.removeAttribute('aria-activedescendant');
      const on = $(`#palette-${active}`, list);
      if (on) on.scrollIntoView({ block: 'nearest' });
    };
    const go = () => { const it = items[active]; if (!it) return; if (it.keep) { it.run(); input.focus(); return; } paletteFrom = null; closePalette(); if (it.run) it.run(); else navigate(it.href); };
    input.addEventListener('input', () => { active = 0; paint(); });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); active = (active + 1) % Math.max(1, items.length); paint(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); active = (active - 1 + items.length) % Math.max(1, items.length); paint(); }
      else if (ev.key === 'Enter') { ev.preventDefault(); go(); }
      // The box is the palette's only stop: Tab stays in it, as in any dialog that holds the focus.
      else if (ev.key === 'Tab') ev.preventDefault();
    });
    list.addEventListener('click', (ev) => { const li = ev.target.closest('[data-i]'); if (li) { active = Number(li.dataset.i); go(); } });
    palette.addEventListener('click', (ev) => { if (ev.target === palette) closePalette(); });
    input.value = prefill;
    paint();
    input.focus();
    input.select();
  }
  function closePalette() {
    if (!palette) return;
    palette.remove();
    palette = null;
    if (paletteFrom && paletteFrom.isConnected) paletteFrom.focus();
    paletteFrom = null;
  }

  function showShortcuts() {
    toast('Shortcuts: / focuses the scan box, Ctrl+K opens search, Esc closes, ? shows this.', 'info', 6000);
  }

  function wireShortcuts() {
    $$('[data-palette]').forEach((b) => b.addEventListener('click', () => openPalette()));
    document.addEventListener('keydown', (ev) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); palette ? closePalette() : openPalette(); return; }
      if (ev.key === 'Escape' && palette) { closePalette(); return; }
      if (typing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key === '/') {
        ev.preventDefault();
        const box = $('[data-check-text]') || $('.scanbox input');
        if (box && !box.hidden) { box.focus(); box.select(); } else navigate('/app/check');
      } else if (ev.key === '?') showShortcuts();
    });
    // Pasting a link anywhere on the page (outside a field) offers to scan it:
    // one more Enter, so a stray paste never spends a weekly scan by itself.
    document.addEventListener('paste', (ev) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || palette) return;
      const text = (ev.clipboardData || {}).getData ? ev.clipboardData.getData('text').trim() : '';
      if (text && text.length < 2048 && looksLikeUrl(text)) openPalette(text);
    });
  }

  /* ======================================================= consent gate */

  function termsGate(el) {
    el.innerHTML = `<form class="panel gate" data-gate>
      <h1>Before you continue</h1>
      <p class="panel-lede">Sentinel is for adults, and using it means agreeing to how it works and what it does with your data. Both boxes are required.</p>
      <div class="consent">
        <label class="consent__row"><input type="checkbox" name="ageConfirmed"><span>I confirm that I am at least 18 years old.</span></label>
        <span class="field__error" data-error="ageConfirmed"></span>
        <label class="consent__row"><input type="checkbox" name="termsAccepted"><span>I have read and accept the <a href="/terms" target="_blank" rel="noopener">Terms and Conditions</a> and the <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</span></label>
        <span class="field__error" data-error="termsAccepted"></span>
      </div>
      <div class="btn-row">
        <button class="btn btn--gold" type="submit">Continue</button>
        <button class="btn" type="button" data-gate-out>Sign out</button>
      </div>
    </form>`;
    const form = $('[data-gate]', el);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      $$('[data-error]', form).forEach((e) => { e.textContent = ''; });
      busy($('button[type=submit]', form), 'Saving', async () => {
        try {
          const data = await api('/account/accept-terms', { method: 'POST', body: { ageConfirmed: form.ageConfirmed.checked, termsAccepted: form.termsAccepted.checked } });
          state.me.user = data.user;
          render();
        } catch (err) {
          for (const [k, msg] of Object.entries(err.errors || {})) { const slot = $(`[data-error="${k}"]`, form); if (slot) slot.textContent = msg; }
          if (!Object.keys(err.errors || {}).length) toast(err.message, 'error');
        }
      });
    });
    $('[data-gate-out]', el).addEventListener('click', signOut);
  }

  function verifyBar() {
    const bar = h(`<div class="verify-bar" role="status">
      <span><b>Confirm your email address.</b> <span class="verify-bar__more">We sent a link to ${esc(state.me.user.email)}. Confirming it shows the address is yours, so nobody else can claim this account with it.</span></span>
      <button class="btn btn--sm" type="button" data-resend>Resend email</button>
    </div>`);
    $('[data-resend]', bar).addEventListener('click', (ev) => busy(ev.currentTarget, 'Sending', async () => {
      try {
        const { verification } = await api('/auth/verify/resend', { method: 'POST', body: {} });
        toast({ sent: 'Verification email sent.', already: 'This address is already confirmed.', failed: 'The email could not be sent right now. Try again later.', unavailable: 'This Sentinel cannot send email.' }[verification] || 'Done.', verification === 'sent' ? 'success' : 'info');
      } catch (err) { toast(err.message, 'error'); }
    }));
    return bar;
  }

  /* ============================================================ helpers */

  function title(main, sub, extra = '') {
    return `<div class="page-title"><div><h1>${main}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${extra}</div>`;
  }

  function lockedCard({ tag, heading, body, actions }) {
    return `<div class="locked">
      <div><span class="locked__tag">${ICON.lock}${esc(tag)}</span><h2>${esc(heading)}</h2><p>${body}</p></div>
      <div class="locked__actions">${actions}</div>
    </div>`;
  }

  // What each scan really does, in the order it does it (server/lib/scan/engine.js, server/routes/scan.routes.js): the
  // id is the stage the server reports, the words are what the person reads while it runs.
  const linkSteps = (research) => [['knowledge', 'Looking it up in the threat lists'], ['compare', 'Comparing the address with known scams'],
    ['research', research ? 'Researching the site' : 'Research (Pro & up)', !research], ['checklist', 'Running the checklist']];
  const EMAIL_STEPS = [['message', 'Reading the email'], ['links', 'Checking its links and sender']];
  const TEXT_STEPS = [['message', 'Reading the message'], ['links', 'Checking its links by their address'], ['conversation', 'Looking for the steps of a slow scam']];
  const FILE_STEPS = [['send', 'Handing the file to Sentinel'], ['inspect', 'Checking signatures, disguises, macros and scripts']];

  /**
   * The wait for one scan: a line saying what is being checked, a progress line that only moves when the scan reports
   * a stage, and, where asked, the quiet binary behind them (binary.js). The panel fades in late (app.css .scanning),
   * so a quick scan shows next to nothing. Nothing here ever holds the answer back: done() is called after it is drawn.
   */
  function watchScan(out, steps, { dig = true, note = '' } = {}) {
    out.innerHTML = `<div class="panel scanning" data-scanning role="status">
      <p class="scanning__now" data-scan-now>${esc(steps[0][1])}</p>
      <div class="scanning__line" aria-hidden="true"><i data-scan-fill></i></div>
      <ol class="stages">${steps.map(([id, label, off]) => `<li data-stage="${id}"${off ? ' class="is-skip"' : ''}><i></i>${esc(label)}</li>`).join('')}</ol>
      ${note ? `<p class="scanning__note">${esc(note)}</p>` : ''}
    </div>`;
    const running = steps.filter(([, , off]) => !off);
    const veil = dig && window.SentinelBinary ? window.SentinelBinary.dig(out, { around: true }) : null;
    const items = Object.fromEntries($$('[data-stage]', out).map((li) => [li.dataset.stage, li]));
    let at = 0;
    const show = (i, part) => {
      running.forEach(([id], k) => {
        // A stage passed without being reported did not run (a verified site is not researched).
        const li = items[id];
        if (k < i && !li.classList.contains('is-done')) li.classList.add(li.classList.contains('is-active') ? 'is-done' : 'is-skip');
        li.classList.toggle('is-active', k === i);
      });
      const label = running[i][1];
      const now = $('[data-scan-now]', out);
      if (now) now.textContent = part && part.total > 1 ? `${label} (${part.done} of ${part.total})` : label;
      const reached = (i + (part && part.total ? part.done / part.total : 0)) / running.length;
      const fill = $('[data-scan-fill]', out);
      if (fill) fill.style.transform = `scaleX(${reached})`;
      if (veil) veil.progress(reached);
    };
    show(0);
    return {
      onStage(s) {
        const i = running.findIndex(([id]) => id === s.stage);
        if (i < at) return;
        at = i;
        show(i, s);
      },
      done() { if (veil) veil.finish(); },
      fail() { if (veil) veil.stop(); }
    };
  }

  function masksFor(item) {
    let kinds = {};
    try { kinds = item.kinds ? JSON.parse(item.kinds) : {}; } catch { kinds = {}; }
    return ['scam', 'virus', 'malware'].map((t) => {
      const level = item[t];
      const badge = { suspicious: 'yellow', likely: 'orange', confirmed: 'red' }[level];
      if (!badge) return '';
      const kind = kinds[t];
      const name = kind ? kind.replace(/_/g, ' ') : '';
      return `<span class="m m--${badge}" title="${esc(Masks.NAMES[t])}: ${esc(level)}${kind ? ` (${esc(name)})` : ''}">${Masks.svg(t)}</span>`
        + (kind ? `<span class="kind-icon" style="--c:${color(badge)}" title="${esc(name)}">${Masks.kindIcon(kind)}</span>` : '');
    }).join('');
  }

  function historyList(items, { clickable = false } = {}) {
    if (!items.length) {
      return stateBlock('waiting', 'No scans yet. Paste a link above to run your first one.', { small: true });
    }
    // On the History page a link's address is a real link (the keyboard reaches it; the whole row answers the mouse),
    // and every entry has its own Delete beside it.
    return `<ul class="list">${items.map((it) => {
      const link = clickable && it.kind === 'url';
      const target = link ? `<a class="list__target" href="/app/check?url=${encodeURIComponent(it.target)}" title="Check again">${esc(it.target)}</a>` : esc(it.target);
      return `
      <li class="${link ? 'is-link' : ''}" ${link ? `data-rescan="${esc(it.target)}"` : ''}>
        <span class="list__icon">${it.kind === 'file' ? ICON.file : it.kind === 'email' ? ICON.mail : ICON.link}</span>
        <span class="list__main"><b class="${it.kind === 'url' ? 'mono' : ''}">${target}</b><span>${esc(it.mode === 'live' ? 'Live' : 'Manual')} ${esc({ url: 'link', file: 'file', email: 'email' }[it.kind] || it.kind)} scan &middot; ${ago(it.created_at)}</span></span>
        <span class="list__masks">${masksFor(it) || '<span class="status is-on">Clear</span>'}</span>
        ${clickable ? `<button type="button" class="list__forget" data-forget="${it.id}" aria-label="Delete ${esc(it.target)} from history" title="Delete from history"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>` : ''}
        ${link ? '<span class="list__go" aria-hidden="true">&rarr;</span>' : ''}
      </li>`;
    }).join('')}</ul>`;
  }

  // The self-contained desktop build runs its server on this computer, so it
  // never opens a suspicious page (that is what research does). Say so.
  function localNote() {
    if (state.config.researchAvailable !== false) return '';
    return '<div class="banner"><div><b>Running on this computer.</b> This copy of Sentinel keeps its server and database on your machine. Suspicious pages are never opened from here, so research (domain age, certificates, redirects, page content) waits for the hosted service. Everything else works.</div></div>';
  }

  /** The live allowance that can run out: delicate where the plan has it, fast otherwise. */
  function liveCard(us, f) {
    const m = f.liveScanning ? us.liveMinutes : us.fastMinutes;
    const name = f.liveScanning ? 'Delicate live scanning left' : 'Fast live scanning left';
    if (!m || uncapped(m.limit)) return usageCard(ICON.clock, 'No limit', '', 'fast live scanning', 0, null, false, 'never resets');
    const left = Math.max(0, m.limit - m.used);
    return m.limit < 60
      ? usageCard(ICON.clock, String(left), `min / ${m.limit} min`, name, m.used, m.limit)
      : usageCard(ICON.clock, (left / 60).toFixed(left < 600 ? 1 : 0), `h / ${m.limit / 60}h`, name, m.used, m.limit);
  }

  // The two manual link scan allowances: fast (unlimited on Ultimate) and delicate (Pro and up).
  function scanCards(us) {
    const fast = us.linkScans;
    const deep = us.deepScans || { used: 0, limit: 0 };
    const fastCard = uncapped(fast.limit)
      ? usageCard(ICON.link, 'Unlimited', '', 'Fast link scans', 0, 0, false, 'no weekly limit')
      : usageCard(ICON.link, left('linkScans'), `/ ${fast.limit}`, 'Fast link scans left', fast.used, fast.limit);
    const deepCard = usageCard(ICON.search, deep.limit ? Math.max(0, deep.limit - deep.used) : 0, deep.limit ? `/ ${deep.limit}` : '', 'Delicate link scans left', deep.used, deep.limit, !deep.limit);
    return `<a class="usage-link" href="/app/check">${fastCard}</a><a class="usage-link" href="/app/check">${deepCard}</a>`;
  }

  function usageCard(icon, n, unit, label, used, limit, locked, meta) {
    const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
    return `<div class="usage-row${locked ? ' is-locked' : ''}">
      <span class="usage-row__icon">${icon}</span>
      <span class="usage-row__l">${label}<small>${meta || (locked ? 'Pro & up' : `resets ${until(state.me.week.resetsAt)}`)}</small></span>
      <b class="usage-row__n tabular">${locked ? '·' : n}<span>${locked ? '' : unit}</span></b>
      <div class="meter${pct >= 100 ? ' is-full' : ''}"><i style="width:${locked ? 0 : 100 - pct}%"></i></div>
    </div>`;
  }

  /* ------------------------------------------------------------ models */

  // Sentinel's models: every released version, by category (1.x Argus, 2.x Cerberus, ...; server/lib/models.js).
  // A bar with the current model, a picker (category first, then every version in it) and an update check. In the
  // app, choosing a model installs that release; in a browser, the list is shown and the switch happens in the app.
  const MODEL_UPDATE_TEXT = {
    checking: 'Checking for updates…',
    downloading: (u) => `Downloading ${u.version || 'an update'}${u.progress ? ` (${u.progress}%)` : ''}…`,
    switching: (u) => `Downloading ${u.version}${u.progress ? ` (${u.progress}%)` : ''}. Sentinel restarts into it.`,
    ready: (u) => `Version ${u.version} is ready. It installs when Sentinel quits.`,
    pinned: (u) => `${u.version ? `Version ${u.version} is out. ` : ''}You chose this model, so it is kept until you pick the newest.`,
    current: 'Up to date.',
    error: 'Could not check for updates. Sentinel tries again by itself later.',
    dev: 'Updates are off in a development run.',
    unavailable: 'This build cannot update itself.'
  };
  const updateText = (u) => { const t = MODEL_UPDATE_TEXT[u && u.status]; return typeof t === 'function' ? t(u) : t || 'Updates install themselves.'; };

  /** A placeholder that mountModels() fills in. `compact` is the scan tabs' one-line bar. */
  const modelSlot = (compact) => `<div class="models${compact ? ' models--bar' : ''}" data-models><div class="skeleton models__skeleton"></div></div>`;

  // The five guardians (the same medallions as the site's download page). `name` is the model running here.
  const GUARDIANS = [
    ['I', 'Argus', '1.x', 'The hundred-eyed watchman, who never closed every eye at once.'],
    ['II', 'Cerberus', '2.x', 'The three-headed hound who keeps the gate.'],
    ['III', 'Talos', '3.x', 'The bronze giant who walked the shore three times a day.'],
    ['IV', 'Heimdall', '4.x', 'The watchman of the bridge, who hears grass grow.'],
    ['V', 'Lokapalas', '5.x', 'The guardians of the four directions of the world.']
  ];
  function guardiansHTML(released = ['Argus'], name = 'Argus') {
    return `<ol class="guardians">${GUARDIANS.map(([n, g, v, myth]) => {
      const out = released.includes(g);
      return `<li class="guardian${out ? ' is-out' : ''}${g === name ? ' is-current' : ''}" tabindex="0"><span class="guardian__coin"><span class="guardian__face"><b>${n}</b><small>${v}</small></span><span class="guardian__face guardian__back"><span>${esc(myth)}</span></span></span><span class="guardian__name">${g}</span><span class="guardian__tag">${out ? 'Out now' : 'Planned'}</span></li>`;
    }).join('')}</ol>`;
  }

  // The model running here, beneath the logo: a quiet reminder, and the way to the picker.
  async function paintModelBadge() {
    const badge = $('[data-model-badge]');
    if (!badge) return;
    try {
      const cat = (state.models && state.models.cat) || await api('/models');
      state.models = state.models || { cat, at: Date.now() };
      badge.innerHTML = `<span class="model-badge__dot" aria-hidden="true"></span>${esc(cat.current.label)}`;
      badge.hidden = false;
    } catch { /* the badge is optional */ }
  }

  async function mountModels(root) {
    const slot = $('[data-models]', root);
    if (!slot) return;
    let cat;
    // Kept for a minute: the protection page redraws on every update event.
    const cached = state.models && Date.now() - state.models.at < 60000 ? state.models.cat : null;
    try { cat = cached || await api('/models'); } catch (err) {
      failed(slot, err, () => { slot.innerHTML = '<div class="skeleton models__skeleton"></div>'; mountModels(root); }, { small: true, what: 'The list of models' });
      return;
    }
    state.models = { cat, at: cached ? state.models.at : Date.now() };
    if (!slot.isConnected) return;
    let up = (state.desktopInfo && state.desktopInfo.update) || null;
    const all = cat.categories.flatMap((c) => c.versions);
    const newest = all[0];
    const render = () => {
      const canUpdate = Boolean(desktop && up && up.supported);
      slot.innerHTML = `
        <div class="models__row">
          <span class="models__seal" aria-hidden="true">${Masks.svg('scam')}</span>
          <div class="models__now"><span class="models__k">Model</span><b>${esc(cat.current.label)}</b>
            <small data-model-status>${desktop ? esc(updateText(up)) : newest && newest.version !== cat.current.version ? `${esc(newest.label)} is the newest.` : 'The newest model.'}</small></div>
          <button class="btn btn--sm models__pick" type="button" data-model-open aria-expanded="false" aria-haspopup="true">${esc(cat.current.name || 'Models')} <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg></button>
          ${up && up.status === 'ready' ? '<button class="btn btn--sm btn--gold" type="button" data-model-install-update>Restart now</button>'
            : `<button class="btn btn--sm" type="button" data-model-check ${desktop && !canUpdate ? 'disabled' : ''}>Check for updates</button>`}
        </div>
        <div class="models__menu" data-model-menu hidden></div>`;
      wire();
    };
    const menuCategories = (menu) => {
      menu.innerHTML = `<p class="models__h">Choose a model</p><ul class="models__list">${cat.categories.map((c) => `
        <li><button type="button" class="models__opt" data-model-cat="${esc(c.name)}"><b>${esc(c.name)}</b><span>${c.major}.x &middot; ${c.versions.length} version${c.versions.length === 1 ? '' : 's'}</span><i aria-hidden="true">&rsaquo;</i></button></li>`).join('')}</ul>`;
      $$('[data-model-cat]', menu).forEach((b) => b.addEventListener('click', () => menuVersions(menu, cat.categories.find((c) => c.name === b.dataset.modelCat))));
      $('button', menu)?.focus();
    };
    const menuVersions = (menu, c) => {
      menu.innerHTML = `<button type="button" class="models__back" data-model-back>&lsaquo; ${esc(c.name)}</button>
        <ul class="models__list models__list--versions">${c.versions.map((v) => {
          const tags = [v.current ? 'Running' : '', v.newest ? 'Newest three' : '', !v.available ? 'Pro &amp; up' : '', !v.installable && !v.current ? 'No installer' : ''].filter(Boolean);
          return `<li><button type="button" class="models__opt${v.current ? ' is-current' : ''}" data-model-v="${esc(v.version)}" ${v.current || !v.available || !v.installable ? 'disabled' : ''}>
            <b>${esc(v.label)}</b><span>${v.date ? new Date(v.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'This copy'}${tags.length ? ` &middot; ${tags.join(' &middot; ')}` : ''}</span></button></li>`;
        }).join('')}</ul>`;
      $('[data-model-back]', menu).addEventListener('click', () => menuCategories(menu));
      $$('[data-model-v]', menu).forEach((b) => b.addEventListener('click', () => confirmSwitch(menu, all.find((v) => v.version === b.dataset.modelV))));
      $('[data-model-v]:not([disabled])', menu)?.focus();
    };
    const confirmSwitch = (menu, v) => {
      const isNewest = v === newest;
      menu.innerHTML = `<p class="models__h">Switch to ${esc(v.label)}?</p>
        <p class="models__note">${desktop
          ? `Sentinel downloads it from GitHub, checks it against its published checksum, and restarts into it.${isNewest ? ' Updates install themselves again.'
            : v.keepsChoice ? ' It is kept until you pick the newest model again.' : ' This model was made before models could be chosen, so it updates itself back to the newest the next time Sentinel restarts.'}`
          : 'Models are switched in the Sentinel app for Windows, which runs the model you choose on your own computer.'}</p>
        <div class="btn-row">${desktop ? '<button class="btn btn--gold btn--sm" type="button" data-model-go>Switch</button>' : '<a class="btn btn--gold btn--sm" href="/download">Get the app</a>'}
          <button class="btn btn--sm" type="button" data-model-cancel>Back</button></div>`;
      $('[data-model-cancel]', menu).addEventListener('click', () => menuVersions(menu, cat.categories.find((c) => c.versions.includes(v))));
      const go = $('[data-model-go]', menu);
      if (go) go.addEventListener('click', () => busy(go, 'Downloading', async () => {
        try {
          const r = await desktop.installModel(v.version);
          if (!r || !r.ok) toast((r && r.error) || 'The model could not be installed.', 'error');
        } catch (err) { toast(desktopError(err), 'error'); }
      }));
      (go || $('a', menu)).focus();
    };
    const wire = () => {
      const open = $('[data-model-open]', slot);
      const menu = $('[data-model-menu]', slot);
      const close = () => { menu.hidden = true; open.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); };
      const outside = (e) => { if (!slot.contains(e.target)) close(); };
      open.addEventListener('click', () => {
        if (!menu.hidden) { close(); return; }
        menu.hidden = false;
        open.setAttribute('aria-expanded', 'true');
        // With one category (Argus, today), the list of its versions is one click away: the category comes first.
        menuCategories(menu);
        document.addEventListener('pointerdown', outside, true);
      });
      menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); open.focus(); } });
      const check = $('[data-model-check]', slot);
      if (check) check.addEventListener('click', () => busy(check, 'Checking', async () => {
        if (!desktop) {
          try { cat = await api('/models'); } catch { /* keep the list we have */ }
          const n = cat.categories.flatMap((c) => c.versions)[0];
          toast(n && n.version !== cat.current.version ? `${n.label} is the newest model. The Sentinel app updates itself to it.` : `${cat.current.label} is the newest model.`, 'info', 5000);
          render();
          return;
        }
        try { up = await desktop.checkUpdates(); } catch (err) { toast(desktopError(err), 'error'); return; }
        toast(up.status === 'current' ? 'Sentinel is up to date.' : up.status === 'error' ? 'Could not check for updates. Try again later.' : up.status === 'pinned' ? `${up.version} is out. You are keeping the model you chose.` : 'Checking for a newer version…', up.status === 'error' ? 'error' : 'info');
        render();
      }));
      const restart = $('[data-model-install-update]', slot);
      if (restart) restart.addEventListener('click', () => desktop.installUpdate());
    };
    render();
    if (desktop && desktop.onUpdate) {
      const off = desktop.onUpdate((u) => {
        if (!slot.isConnected) { off && off(); return; }
        up = u;
        const s = $('[data-model-status]', slot);
        if (s) s.textContent = updateText(u);
        if (u.status === 'ready' && !$('[data-model-install-update]', slot)) render();
      });
    }
  }

  function friendlyError(err) {
    // Signed out in another tab, or the session ran out: a way back here, where what was typed is kept (data-draft).
    if (err.status === 401) {
      return `<div class="banner"><div><b>You are signed out.</b> <a href="/login?next=${encodeURIComponent(location.pathname + location.search)}" class="u-gold">Sign in again</a> to scan. What you pasted stays here.</div></div>`;
    }
    if (err.code === 'model_requires_plan') {
      return `<div class="banner"><div><b>${esc(err.message)}</b> Choose a model above, or <a href="/app/plan" class="u-gold">compare plans</a>.</div></div>`;
    }
    if (err.code === 'weekly_limit_reached') {
      // Which allowance ran out (the server's sentence names it); with the delicate ones gone, fast scans still work.
      return `<div class="banner"><div><b>${esc(err.message)}</b> They come back ${until(err.extra.resetsAt)}. ${/delicate/.test(err.message) && location.pathname === '/app/check' ? 'Fast scans still work: turn off Look deeper above. ' : ''}<a href="/app/plan" class="u-gold">See plans</a></div></div>`;
    }
    if (err.code === 'plan_required') {
      return `<div class="banner"><div><b>${esc(err.message)}</b> <a href="/app/plan" class="u-gold">Compare plans</a></div></div>`;
    }
    // The form above still holds what was given, so pressing Check again is the way to try again.
    if (err.offline) return stateBlock('offline', 'Check your internet connection, then press Check again.', { title: 'Sentinel cannot be reached', small: true });
    return stateBlock('error', esc(err.message || 'Sentinel had a problem on its side. Try again in a moment.'), { title: 'The check did not finish', small: true });
  }

  /* ================================================================ home */

  async function home(el) {
    const u = state.me.user;
    const f = plan().features;
    const us = usage();
    const hour = new Date().getHours();
    const greet = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

    el.innerHTML = `
      ${title(`${greet}, ${esc(u.firstName)}`,'Paste anything you are unsure about. Sentinel will tell you exactly what it finds.')}
      <form class="scanbox" data-quick>
        ${ICON.search}
        <input name="url" type="text" autocomplete="off" spellcheck="false" placeholder="Paste a link, a message or a phone number" aria-label="What to check">
        <button class="btn btn--gold" type="submit">Check</button>
      </form>
      <div class="scan-meta"><span>Sentinel works out what it is and says which check it runs.</span><a href="/app/check">Check an email, a file or a picture &rarr;</a></div>
      <div data-first></div>

      <div class="usage-list u-mt-lg">
        ${scanCards(us)}
        <a class="usage-link" href="/app/check">${usageCard(ICON.shield, left('fileScans'), `/ ${us.fileScans.limit}`, 'Virus & malware scans left', us.fileScans.used, us.fileScans.limit)}</a>
        <a class="usage-link" href="/app/protection">${liveCard(us, f)}</a>
      </div>

      <div class="u-mt">${protectionTeaser()}</div>
      <div data-week-card></div>
      <div data-chat-ask></div>
      <div data-exposure-ask></div>

      <div class="panel u-mt">
        <div class="panel__head"><div><h2>Recent scans</h2><p>Your last 30 days</p></div><a class="btn btn--sm" href="/app/history">View all</a></div>
        <div data-recent>${skel('recent')}</div>
      </div>`;

    weekCard($('[data-week-card]', el));
    // One offer at a time: the first-run choices, then chat safety, then exposure alerts, each on a later visit.
    const chatAsk = $('[data-chat-ask]', el);
    // A failure says so quietly in the offer's place (askChatSafety), with Try again running both offers again.
    const offers = () => { chatAsk.innerHTML = ''; return askChatSafety(chatAsk, offers).then(() => { if (!chatAsk.innerHTML) askExposureAlerts($('[data-exposure-ask]', el)); }); };
    if (!firstChoices($('[data-first]', el))) offers();
    $('[data-quick]', el).addEventListener('submit', (ev) => {
      ev.preventDefault();
      const url = ev.target.url.value.trim();
      if (!url) return;
      // A link opens under its own address (Back and reload keep it); anything else is carried over in memory, never in the address.
      if (looksLikeUrl(url)) navigate(`/app/check?url=${encodeURIComponent(url)}`);
      else { shared = { text: url }; navigate('/app/check'); }
    });

    const slot = $('[data-recent]', el);
    slot.addEventListener('click', (ev) => {
      const row = ev.target.closest('[data-rescan]');
      if (row) navigate(`/app/check?url=${encodeURIComponent(row.dataset.rescan)}`);
    });
    // The rows say they are buttons, so Enter and Space must work on them too.
    slot.addEventListener('keydown', (ev) => {
      const row = ev.target.closest('[data-rescan]');
      if (row && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); row.click(); }
    });
    const recent = async () => {
      try { slot.innerHTML = historyList((await api('/account/history?limit=6')).items.slice(0, 6), { clickable: true }); keep(slot, 'recent'); }
      catch (err) { failed(slot, err, () => { slot.innerHTML = skel('recent'); recent(); }, { small: true, what: 'Your recent scans' }); }
    };
    recent();
  }

  /* ============================================================ your week */

  // What Sentinel did for you, week by week (server/lib/week.js): numbers only, and only what really happened.
  // The rows are shown when any of the four weeks has something in them; most serious first.
  const WEEK_ROWS = [
    ['wallet_swaps', 'Wallet swaps caught', 'shield'], ['files_quarantined', 'Files quarantined', 'file'], ['commands_stopped', 'Copied commands stopped', 'shield'],
    ['lookalikes', 'Look-alikes of your sites caught', 'globe'], ['exposures', 'Exposure alerts', 'clock'], ['live_flagged', 'Dangerous pages and results flagged', 'link'],
    ['manual_flagged', 'Scan results flagged', 'search'], ['chat_flagged', 'Chat messages flagged', 'mail'],
    ['live_links', 'Links checked by live scanning', 'link'], ['manual_scans', 'Scans you ran', 'search'], ['files_checked', 'Files checked', 'file'], ['chat_checked', 'Chat messages checked', 'mail']
  ];
  const weekLabel = (w, i, all) => (i === all.length - 1 ? 'This week' : new Date(w.startsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }));

  // In the Windows app, the week is asked of the app: what it counted on this computer is handed over first.
  const loadWeek = () => (desktop && desktop.week ? desktop.week() : api('/week'));

  async function weekCard(slot) {
    let data;
    // An optional card: a failure is one quiet line in its place, with Try again, never a red box.
    try { data = await loadWeek(); } catch (err) {
      failed(slot, desktop && desktop.week && !err.offline ? { message: desktopError(err) } : err, () => { slot.innerHTML = ''; weekCard(slot); }, { small: true, quiet: true, what: 'Your week could not be loaded.' });
      return;
    }
    const w = data.weeks[data.weeks.length - 1];
    if (!slot.isConnected || (!w.checked && !w.caught)) return;
    slot.innerHTML = `<div class="panel u-mt week-card"><div class="panel__head"><div><h2>${esc(w.headline)}</h2>
      <p>${esc(w.biggest || `Sentinel checked ${w.checked.toLocaleString()} links, files and messages for you, and found nothing dangerous.`)}</p></div>
      <a class="btn btn--sm" href="/app/week">See your week</a></div></div>`;
  }

  async function weekView(el) {
    el.innerHTML = `${title('Your week with Sentinel', 'What Sentinel did for you, Monday to Sunday. Only real counts, never what the links, files or messages were.')}
      <div data-week>${skel('week')}</div>`;
    const slot = $('[data-week]', el);
    let data;
    // In the Windows app the week comes from the app, whose own message is plain already (desktopError).
    try { data = await loadWeek(); } catch (err) {
      failed(slot, desktop && desktop.week && !err.offline ? { message: desktopError(err) } : err, () => weekView(el), { what: 'Your week' });
      return;
    }
    if (!slot.isConnected) return;
    const weeks = data.weeks;
    const w = weeks[weeks.length - 1];
    const before = weeks[weeks.length - 2];
    const rows = WEEK_ROWS.filter(([k]) => weeks.some((x) => x.counts[k] > 0));
    // The bars show what was caught; in weeks that were all quiet, how much was checked.
    const caughtAny = weeks.some((x) => x.caught > 0);
    const val = (x) => (caughtAny ? x.caught : x.checked);
    const top = Math.max(1, ...weeks.map(val));
    slot.innerHTML = `
      <div class="panel week-hero">
        <p class="week-hero__k">${esc(weekLabel(w, weeks.length - 1, weeks))}, so far</p>
        <h2 data-week-n>${esc(w.headline)}</h2>
        ${w.biggest ? `<p class="week-hero__catch"><b>Biggest catch</b>${esc(w.biggest)}</p>`
          : w.checked ? `<p class="week-hero__catch">Sentinel checked ${w.checked.toLocaleString()} links, files and messages, and none of them was dangerous.</p>` : ''}
      </div>
      ${rows.length ? `<div class="usage-list u-mt week-rows">${rows.map(([k, label, icon]) => `<div class="usage-row">
          <span class="usage-row__icon">${ICON[icon]}</span>
          <span class="usage-row__l">${esc(label)}<small>last week: ${before.counts[k].toLocaleString()}</small></span>
          <b class="usage-row__n tabular">${w.counts[k].toLocaleString()}</b></div>`).join('')}</div>`
        : `<div class="panel u-mt">${stateBlock('waiting', 'Nothing yet. As Sentinel checks links, files and messages for you, your week fills in here.', { action: '<a class="btn btn--sm btn--gold" href="/app/check">Check something</a>' })}</div>`}
      ${caughtAny || weeks.some((x) => x.checked) ? `<div class="panel u-mt">
        <div class="panel__head"><div><h2>${caughtAny ? 'Caught, week by week' : 'Checked, week by week'}</h2><p>The last four weeks. Each week starts on Monday.</p></div></div>
        <div class="week-bars" role="img" aria-label="${esc(weeks.map((x, i) => `${weekLabel(x, i, weeks)}: ${val(x)}`).join(', '))}">
          ${weeks.map((x, i) => `<div class="week-bars__col" style="--li:${i}"><b class="tabular">${val(x).toLocaleString()}</b><i style="height:${Math.round((val(x) / top) * 100)}%"></i><span>${esc(weekLabel(x, i, weeks))}</span></div>`).join('')}
        </div></div>` : ''}
      ${desktop && desktop.setWeekRecap ? '<p class="set-away u-mt"><a href="/app/settings#week-note">A weekly note in Windows: choose it in Settings</a></p>' : ''}
      <ul class="live__facts u-mt">
        <li>Counted as numbers for each week and kept for five weeks. Sentinel never keeps which links, files, commands or messages they were for this page.</li>
        <li>Private browser windows are not counted.${desktop ? '' : ' Files, copied commands, wallet swaps and chat messages are counted by the Sentinel app for Windows.'}</li>
      </ul>`;
    keep(slot, 'week');
  }

  function protectionTeaser() {
    const f = plan().features;
    if (!f.liveScanning) {
      return lockedCard({
        tag: 'Pro & up',
        heading: 'Research every result, and protect email and downloads',
        body: `Your plan includes ${plan().limits.fastMinutes} minutes a week of fast live scanning. Pro and up add delicate live scanning, which researches every result, and mark emails and downloads too.`,
        actions: '<a class="btn btn--gold" href="/app/plan">See plans</a>'
      });
    }
    if (!desktop) {
      return lockedCard({
        tag: 'Needs the Sentinel app',
        heading: 'Your live protection is ready to switch on',
        body: 'Live search masks, email masks and download protection run through the Sentinel app. Download it once and sign in.',
        actions: `<a class="btn btn--gold" href="/download">${ICON.download}Download Sentinel</a><a class="btn" href="/app/protection">Learn more</a>`
      });
    }
    const live = (state.desktopInfo && state.desktopInfo.live) || {};
    if (live.supported && !live.enabled) {
      return `<div class="panel live"><div class="live__main"><span class="live__mask" aria-hidden="true">${Masks.svg('scam')}</span>
        <div class="live__text"><h2>Live scanning is off</h2><p>One click. Sentinel then watches whichever browser is in front of you, and rests when none is.</p></div>
        <a class="btn btn--gold live__button" href="/app/protection">Start scanning</a></div></div>`;
    }
    // Only what the app says is running is named: never "on" for something that is off, never a count.
    const info = state.desktopInfo;
    if (!info) return `<div class="panel"><div class="panel__head"><div><h2>Live protection</h2><p>The Sentinel app did not say what it is watching. Open Live protection to see.</p></div><a class="btn btn--sm" href="/app/protection">Open</a></div></div>`;
    const watched = [info.downloads && info.downloads.active && 'new downloads', info.defense && info.defense.active && 'new programs and startup entries'].filter(Boolean);
    const also = watched.join(' and ');
    const head = live.enabled ? 'Live scanning is on' : watched.length ? `Sentinel is watching ${also}` : 'Sentinel is not watching anything right now';
    const body = live.enabled ? `Look for the mask in the corner of your browser.${also ? ` Sentinel is also watching ${also}.` : ''}`
      : watched.length ? 'Live scanning is off, so pages and search results are not checked as you browse.'
        : 'Live scanning, Download protection and Defense are all off.';
    return `<div class="panel"><div class="panel__head"><div><h2>${head}</h2><p>${body}</p></div><a class="btn btn--sm${live.enabled || watched.length ? '' : ' btn--gold'}" href="/app/settings#protection">${live.enabled || watched.length ? 'Manage' : 'Turn on'}</a></div></div>`;
  }

  /* =============================================================== check */

  // One page for whatever a person is unsure of: a link, a message, a whole email, a file, or a picture of a QR code or
  // of a text. route.js says what it is, and so which scan runs and which of the week's scans it uses; the page says
  // that in words before anything is spent, and one press changes it. The old pages' addresses (/app/scan,
  // /app/threats, /app/email, /app/text) open it, so links from the Windows app, the history and old bookmarks still work.
  const Route = window.SentinelRoute;
  // The key the old Fast and Delicate switch kept, so a choice made there carries over to Look deeper.
  const deeperKey = 'sentinel.scanMode';
  // The most of a pasted conversation sent for a check (server/routes/scan.routes.js reads the same).
  const TEXT_MAX = 40000;
  const KIND_NAME = { link: 'Link', download: 'Download', message: 'Message', email: 'Email' };
  const SCAN_NAME = { linkScans: 'fast scan', deepScans: 'delicate scan', fileScans: 'virus scan' };
  // What the empty page offers to show: a made-up example of each kind, none of them real addresses.
  const CHECK_EXAMPLES = {
    link: 'paypa1-secure-login.com/account',
    message: 'USPS: Your parcel is on hold at our depot due to an unpaid $1.99 redelivery fee. Pay within 24 hours or it will be returned: https://usps-redeliver.top/track',
    email: ['From: PayPal Service <service@paypa1-help.top>', 'Subject: Your account is limited', '',
      'We noticed unusual activity. Confirm your details within 24 hours at https://paypa1-secure-login.com/verify or your account will be closed.'].join('\n')
  };

  /** What a check costs, from the account's own numbers: "Uses 1 fast scan: 9 of 10 left this week." */
  function spends(meter) {
    const m = usage()[meter];
    const name = SCAN_NAME[meter];
    if (!m || !name) return '';
    if (uncapped(m.limit)) return `Uses 1 ${name}. There is no weekly limit.`;
    const n = Math.max(0, m.limit - m.used);
    if (!n) return `No ${name}s are left this week. They come back ${until(state.me.week.resetsAt)}.`;
    return `Uses 1 ${name}: ${n} of ${m.limit} left this week.`;
  }

  /** What Sentinel saw and what it will do with it, as [the kind, the check and its cost]. */
  function says(r, file) {
    const deep = r.mode === 'delicate' ? ', and researches the site' : '';
    switch (r.kind) {
      case 'link': return ['A link.', `Sentinel checks it against the threat lists, the checklist and known scams${deep}. ${spends(r.meter)}`];
      case 'download': return ['A download link.', r.path === '/scan/threat'
        ? `Sentinel checks it for viruses and malware. ${spends(r.meter)}`
        : `Sentinel checks it for scams, viruses and malware${deep}. ${spends(r.meter)}`];
      case 'message': return ['A message.', `Sentinel reads its words for known scams and checks its links by their address, without opening them. ${spends(r.meter)}`];
      case 'email': return ['An email.', r.limited
        ? `Sentinel checks its words and links as a message. Checking who really sent it is part of Max. ${spends(r.meter)}`
        : `Sentinel checks the sender, the words, every link and attachment name, and with its headers, who really sent it. ${spends(r.meter)}`];
      case 'number': return ['A phone number.', 'Sentinel cannot look a number up. Calling you now? Use the call check below. Sent you a message? Paste the whole message.'];
      case 'file': return [`${file.name}, ${bytes(file.size)}.`, file.size > 25 * 1024 * 1024
        ? 'Files up to 25 MB can be checked here.'
        : `Sentinel checks it for viruses, malware and files in disguise. ${spends(r.meter)}`];
      default: return ['', ''];
    }
  }

  function checkView(el, params) {
    const f = plan().features;
    const preset = params.get('url');
    // An old page's address: the Check page, under its own.
    if (location.pathname.replace(/\/$/, '') !== '/app/check') history.replaceState(history.state, '', `/app/check${preset ? `?url=${encodeURIComponent(preset)}` : ''}`);
    const camera = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    el.innerHTML = `
      ${title('Check something', 'Paste a link, a message or a whole email, or add a file or a picture of one. Sentinel works out which it is and runs the right check.')}
      <form class="ask" data-form data-draft="check" novalidate>
        <div class="ask__box" data-drop>
          <textarea class="ask__text" name="text" rows="3" spellcheck="false" autocomplete="off" placeholder="Paste it here" aria-label="What to check" aria-describedby="check-says" data-check-text></textarea>
          <div class="ask__file" data-file-chip hidden></div>
          <div class="ask__bar">
            <button class="ask__add" type="button" data-add>${ICON.upload}<span>Add a file or picture</span></button>
            <input type="file" data-file hidden aria-label="Choose a file or a picture to check">
            ${camera ? `<button class="ask__add" type="button" data-qr-cam aria-expanded="false">${ICON.qr}<span>QR code</span></button>` : ''}
            <button class="btn btn--gold ask__go" type="submit">Check</button>
          </div>
        </div>
        <div class="ask__said" id="check-says">
          <p class="ask__says" data-says aria-live="polite"></p>
          <p class="ask__try" data-try>Not sure what goes here? See how Sentinel reads
            <button type="button" data-example="link">a link</button>, <button type="button" data-example="message">a text message</button>,
            <button type="button" data-example="email">an email</button> or <button type="button" data-example="file">a file</button>.
            Nothing is checked until you press Check.</p>
          <div class="ask__as" data-as role="group" aria-label="Check it as" hidden></div>
          <button type="button" class="ask__deeper" data-deeper aria-pressed="false" hidden><i aria-hidden="true"></i>Look deeper: research the site</button>
          <div class="ask__help" data-header-help hidden>
            <p>To see who really sent it, paste the email with its headers.</p>
            <p><b>Gmail:</b> open the email, click the three dots, choose Show original, then Copy to clipboard.</p>
            <p><b>Outlook:</b> open the email, click the three dots, choose View, then View message source, and copy it all.</p>
          </div>
        </div>
        <div class="field ask__from" data-from hidden><label for="check-from">Who sent it <span class="opt">(optional)</span></label><input class="input" id="check-from" name="from" dir="auto" placeholder="The number or name the message shows" autocomplete="off" maxlength="80"></div>
        <figure class="shot" data-shot-preview hidden><img alt="The picture being read"><figcaption data-shot-status></figcaption></figure>
        <div class="qr-cam" data-qr-camview hidden><video muted playsinline aria-label="Camera view"></video><p class="muted">Hold the QR code up to the camera. It is read here, and the camera turns off as soon as a code is found.</p></div>
      </form>
      ${iphone ? `<p class="field__hint" data-iphone-note>${esc(IPHONE_NOTE)}</p>` : ''}
      <p class="ask__call">On the phone with someone right now? <a href="/call">Is this call a scam?</a></p>
      ${localNote()}
      <div data-qr-out aria-live="polite"></div>
      <div data-out aria-live="polite"></div>`;

    const form = $('[data-form]', el);
    const box = $('[data-check-text]', el);
    const drop = $('[data-drop]', el);
    const chip = $('[data-file-chip]', el);
    const fileInput = $('[data-file]', el);
    const saysEl = $('[data-says]', el);
    const asEl = $('[data-as]', el);
    const deeperBtn = $('[data-deeper]', el);
    const fromBox = $('[data-from]', el);
    const tryEl = $('[data-try]', el);
    const go = $('.ask__go', el);
    const preview = $('[data-shot-preview]', el);
    const shotStatus = $('[data-shot-status]', el);
    const qrOut = $('[data-qr-out]', el);
    const out = $('[data-out]', el);

    let file = null;
    let choice = null;
    let deeper = f.research;
    try { deeper = f.research && localStorage.getItem(deeperKey) !== 'fast'; } catch { /* the plan's best */ }
    const deepLeft = () => { const m = usage().deepScans; return Boolean(m) && (uncapped(m.limit) || m.limit - m.used > 0); };
    const pick = () => Route.pick({ text: box.value, file }, { features: f, choice, deeper: deeper && deepLeft() });

    let kindsShown = '';
    function refresh() {
      const r = pick();
      const [lead, rest] = says(r, file);
      // Only when it changes: a screen reader hears the sentence once, not at every key pressed.
      const said = `${lead ? `<b>${esc(lead)}</b> ` : ''}${esc(rest)}`;
      if (saysEl.innerHTML !== said) saysEl.innerHTML = said;
      const kinds = Route.choices({ text: box.value, file });
      // Drawn again only when the kinds on offer change, so the one just pressed keeps the focus.
      if (kinds.join() !== kindsShown) {
        kindsShown = kinds.join();
        asEl.innerHTML = kinds.length > 1 ? `<span class="ask__as-k">Check it as</span>${kinds.map((k) => `<button type="button" class="ask__kind" data-kind="${k}" aria-pressed="false">${KIND_NAME[k]}</button>`).join('')}` : '';
        asEl.hidden = kinds.length < 2;
      }
      $$('[data-kind]', asEl).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === r.kind)));
      deeperBtn.hidden = !(f.research && r.path === '/scan/link' && deepLeft());
      deeperBtn.setAttribute('aria-pressed', String(r.mode === 'delicate'));
      fromBox.hidden = r.kind !== 'message';
      tryEl.hidden = r.kind !== 'empty';
      // An email checked for who really sent it, pasted without the headers that say so: how to copy them.
      $('[data-header-help]', el).hidden = !(r.path === '/scan/email' && !pictured && !/^(Authentication-Results|Received-SPF|DKIM-Signature|Received)[ \t]*:/im.test(box.value));
      form.dataset.kind = r.kind;
      return r;
    }

    function showFile() {
      box.hidden = Boolean(file);
      chip.hidden = !file;
      chip.innerHTML = file ? `<span class="ask__file-icon">${ICON.file}</span><span class="ask__file-name">${esc(file.name)}</span><span class="ask__file-size">${bytes(file.size)}</span>
        <button class="btn btn--sm btn--ghost" type="button" data-unfile aria-label="Remove ${esc(file.name)}">Remove</button>` : '';
    }

    /** A file chosen, dropped or handed over: a picture is read here, an .eml becomes its text, anything else waits for Check. */
    async function take(picked) {
      if (!picked) return false;
      const kind = Route.guess({ file: picked });
      if (kind === 'picture') { readPicture(picked); return false; }
      if (kind === 'eml') {
        if (picked.size > 10 * 1024 * 1024) { toast('That email is too large to read here.', 'error'); return false; }
        file = null;
        showFile();
        box.value = await picked.text();
        box.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
      file = picked;
      choice = null;
      showFile();
      refresh();
      go.focus();
      return true;
    }

    let running = false;
    // The same thing checked a moment ago: a double press, or a second click after a quick answer, is not a second scan.
    let last = { key: '', at: 0 };
    async function run(r, { fromQr = false } = {}) {
      if (running) return;
      const key = [r.kind, r.path, r.url || '', r.mode || '', file ? `${file.name}:${file.size}` : box.value].join('|');
      if (r.path && key === last.key && performance.now() - last.at < 1500) return;
      if (r.kind === 'empty') { toast('Paste a link, a message or an email first, or add a file.', 'info'); box.focus(); return; }
      if (r.kind === 'number') { $('.ask__call a', el).focus(); return; }
      if (r.kind === 'file' && file.size > 25 * 1024 * 1024) { toast('Files up to 25 MB can be checked.', 'error'); return; }
      running = true;
      if (!fromQr) qrOut.innerHTML = '';
      // What the picture's reader said is done with: the answer is below.
      if (!preview.hidden && !fromQr) { preview.hidden = true; shotStatus.textContent = ''; }
      try {
        if (r.url) await runLink(r, fromQr);
        else if (r.path === '/scan/text') await runText(r);
        else if (r.path === '/scan/email') await runEmail();
        else if (r.path === '/scan/file') await runFile();
      } finally {
        running = false;
        last = { key, at: performance.now() };
        refresh();
      }
    }

    async function runLink(r, fromQr) {
      // Remembered in the history entry, so Back and reload show the address without spending another scan.
      history.replaceState({ scanned: r.url }, '', `/app/check?url=${encodeURIComponent(r.url)}`);
      const deep = r.mode === 'delicate';
      // A delicate scan digs: quiet binary behind the wait while the site is researched (binary.js).
      const watch = watchScan(out, linkSteps(deep), { dig: deep });
      try {
        const data = await busy(go, fromQr ? 'Checking the link in the code' : 'Checking', () => api(r.path, { method: 'POST', body: r.path === '/scan/link' ? { url: r.url, mode: r.mode } : { url: r.url }, onStage: watch.onStage }));
        applyUsage(data.usage);
        showVerdict(out, data.verdict, { lockedLabel: 'Pro & up', focus: !fromQr });
        watch.done();
      } catch (err) { watch.fail(); out.innerHTML = friendlyError(err); }
    }

    async function runText(r) {
      history.replaceState(null, '', '/app/check');
      // An email checked as a message: its subject and words, from its sender.
      const mail = r.kind === 'email' ? parseEmail(box.value) : null;
      const from = mail ? mail.from.slice(0, 80) : $('[name=from]', form).value.trim();
      // An email's QR code goes in with its words, so a link in the code is checked with the email's own links.
      const all = mail ? [mail.subject, mail.body, ...pictureQr.map((q) => `QR code in the email: ${q}`)].filter(Boolean).join('\n\n') : box.value;
      // A long conversation is read up to TEXT_MAX letters: its start (how it began) and its most recent part (where it is now).
      const cut = all.length > TEXT_MAX;
      const text = cut ? `${all.slice(0, 10000)}\n${all.slice(-(TEXT_MAX - 10001))}` : all;
      const watch = watchScan(out, TEXT_STEPS, { note: 'Read in memory only: never kept, and not in your history.' });
      try {
        const data = await busy(go, 'Checking', () => api('/scan/text', { method: 'POST', body: { from, text }, onStage: watch.onStage }));
        applyUsage(data.usage);
        out.innerHTML = textResult(data.text, from)
          + (cut ? `<p class="field__hint u-mt-sm">This conversation is very long, so Sentinel read its first part and its most recent ${(TEXT_MAX - 10000).toLocaleString('en')} letters.</p>` : '');
        riseMask(out);
        watch.done();
        wireWarn(out, () => window.SentinelWarnCard.fromText(data.text, from, $('[data-text-result]', out).dataset.textResult));
        const heading = $('h2', out);
        if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
        out.scrollIntoView({ behavior: glide(), block: 'start' });
      } catch (err) { watch.fail(); out.innerHTML = friendlyError(err); }
    }

    async function runEmail() {
      history.replaceState(null, '', '/app/check');
      const m = parseEmail(box.value);
      // What Sentinel reads of an email (server/routes/scan.routes.js cleanMail): a 5 MB paste is cut here, so it is
      // checked instead of being refused as too large to send.
      const body = m.body.slice(0, 20000);
      // Typed or read from a screenshot, an address may have no scheme: "www.example.com/login" is a link too.
      const found = [...(body.match(/https?:\/\/[^\s<>"')]+/g) || []), ...(body.match(/(?<![\w./@-])www\.[a-z0-9.-]+\.[a-z]{2,}[^\s<>"')]*/gi) || []).map((u) => `https://${u}`)];
      const payload = {
        from: m.from, replyTo: m.replyTo, subject: m.subject, body, links: [...new Set(found)].map((href) => ({ href, text: '' })),
        attachments: m.attachments, qr: pictureQr, headers: m.headers.slice(0, 16000)
      };
      const watch = watchScan(out, EMAIL_STEPS);
      try {
        const data = await busy(go, 'Checking', () => api('/scan/email', { method: 'POST', body: payload, onStage: watch.onStage }));
        applyUsage(data.usage);
        showVerdict(out, data.verdict, { focus: true });
        watch.done();
        showProof(out, data.verdict.sender);
        showMarks(out, payload, data.verdict.checklist.items);
      } catch (err) { watch.fail(); out.innerHTML = friendlyError(err); }
    }

    async function runFile() {
      history.replaceState(null, '', '/app/check');
      const watch = watchScan(out, FILE_STEPS, { note: `${file.name} · ${bytes(file.size)}` });
      drop.setAttribute('aria-busy', 'true');
      try {
        const data = await busy(go, 'Checking', () => api('/scan/file', { method: 'POST', raw: file, headers: { 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' }, onStage: watch.onStage }));
        applyUsage(data.usage);
        showVerdict(out, data.verdict, { focus: true });
        watch.done();
      } catch (err) { watch.fail(); out.innerHTML = friendlyError(err); }
      drop.removeAttribute('aria-busy');
    }

    /** A QR code's text: what it does, and a link in it checked with a fast scan, so test pictures never use up delicate ones. */
    async function fromCode(code) {
      const info = await explainQr(qrOut, code, { focus: true });
      if (!info || !info.url) return;
      file = null;
      showFile();
      box.value = info.url;
      choice = null;
      await run(Route.pick({ text: info.url }, { features: f }), { fromQr: true });
    }

    /**
     * A picture: a QR code in it is read on this device and checked; otherwise its words are read by the Windows app
     * (never uploaded) and put in the box to look over before Check is pressed.
     */
    let reading = false;
    // A QR code read from a screenshot of an email, sent with that email. Typing or pasting another one forgets it.
    let pictureQr = [];
    // Words read from a picture: a screenshot has no headers to paste, so the how-to for them is not shown.
    let pictured = false;
    async function readPicture(pic) {
      if (reading) return;
      if (pic.size > 20 * 1024 * 1024) { toast('That picture is too large.', 'error'); return; }
      reading = true;
      qrOut.innerHTML = '';
      const url = URL.createObjectURL(pic);
      $('img', preview).src = url;
      preview.hidden = false;
      preview.classList.add('is-reading');
      shotStatus.textContent = 'Looking for a QR code in the picture…';
      pictureQr = [];
      try {
        let code = null;
        try { code = await qrFromFile(pic); } catch { /* no reader, or not a picture this browser opens: said below */ }
        // The words are read too where the Windows app can, so a code inside a screenshot of an email is judged with
        // that email, as one answer, and not on a card of its own.
        const canRead = Boolean(desktop && desktop.readScreenshot) && /^image\/(png|jpeg)$/.test(pic.type);
        let raw = '';
        if (code != null && canRead) {
          shotStatus.textContent = 'Reading the words in the picture…';
          try { raw = joinSlices(await desktop.readScreenshot(await sliceImage(pic))); } catch { raw = ''; }
        }
        const mailed = raw.trim() && (withSender(raw) !== raw || /^(from|sender)\s*:/im.test(raw));
        if (code != null && !mailed) {
          shotStatus.textContent = 'The QR code in this picture was read and checked below.';
          await fromCode(code);
          return;
        }
        if (code != null) {
          // Only the code's text goes with the email, and never a secret in it (SentinelQR.redact).
          pictureQr = [window.SentinelQR.redact(code)];
          box.value = withSender(raw);
          choice = 'email';
          file = null;
          showFile();
          pictured = true;
        box.dispatchEvent(new Event('input', { bubbles: true }));
          shotStatus.textContent = 'Read on this computer, with the QR code in it. Look over the words, then press Check: the code is checked with the email.';
          box.focus();
          return;
        }
        if (!/^image\/(png|jpeg)$/.test(pic.type)) {
          // Said where the answer would be, and kept there: a HEIC photo shared from a phone otherwise left an empty page.
          qrOut.innerHTML = stateBlock('unavailable', 'Take a screenshot of it and share or choose that instead, or copy the message and paste it here.', { title: 'This picture is not a PNG or JPEG, so Sentinel cannot read it', small: true }).replace('<div ', '<div role="alert" data-shot-wrong ');
          shotStatus.textContent = 'No QR code was found in this picture.';
          return;
        }
        if (!desktop || !desktop.readScreenshot) {
          shotStatus.textContent = 'No QR code was found. The words in a picture are read by the Sentinel app for Windows, so they cannot be read here. Copy the message itself and paste it here.';
          return;
        }
        shotStatus.textContent = 'Reading the words in the picture…';
        raw = joinSlices(await desktop.readScreenshot(await sliceImage(pic)));
        if (!raw.trim()) { shotStatus.textContent = 'No words were found in this picture.'; return; }
        // An address near the top is an email's sender; otherwise it is a phone's messages (textshot.js).
        const mail = withSender(raw);
        if (mail !== raw || /^(from|sender)\s*:/im.test(raw)) {
          box.value = mail;
          choice = 'email';
        } else {
          const m = window.SentinelTextShot.read(raw);
          box.value = m.text || raw;
          $('[name=from]', form).value = m.from || '';
          choice = null;
        }
        file = null;
        showFile();
        pictured = true;
        box.dispatchEvent(new Event('input', { bubbles: true }));
        shotStatus.textContent = 'Read on this computer. Look over the words, then press Check.';
        box.focus();
      } catch (err) {
        shotStatus.textContent = desktopError(err);
      } finally {
        reading = false;
        preview.classList.remove('is-reading');
        URL.revokeObjectURL(url);
      }
    }

    box.addEventListener('input', (ev) => {
      // Emptied, or something else pasted in: a new thing to check, without the last picture's code. A word corrected
      // in what was read keeps it.
      if (!box.value.trim()) { choice = null; pictureQr = []; pictured = false; }
      if (ev.inputType === 'insertFromPaste' || ev.inputType === 'insertFromDrop') { pictureQr = []; pictured = false; }
      refresh();
    });
    // Enter sends a link pasted on its own; in a message it starts a new line, and Ctrl+Enter sends.
    box.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing) return;
      if (ev.ctrlKey || ev.metaKey || Route.isLink(box.value.trim())) { ev.preventDefault(); form.requestSubmit(); }
    });
    // An example of each thing the box takes, put in the box (or, for a file, a small harmless one made here) so the
    // sentence under it shows how Sentinel reads it. Nothing is sent until Check is pressed.
    tryEl.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-example]');
      if (!b || running) return;
      const kind = b.dataset.example;
      if (kind === 'file') { take(new File(['An example file made by Sentinel. It holds only these words.\n'], 'Invoice_2026.pdf.exe', { type: 'application/octet-stream' })); return; }
      box.value = CHECK_EXAMPLES[kind];
      choice = null;
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.focus();
    });
    asEl.addEventListener('click', (ev) => { const b = ev.target.closest('[data-kind]'); if (b) { choice = b.dataset.kind; refresh(); } });
    deeperBtn.addEventListener('click', () => {
      deeper = !deeper;
      try { localStorage.setItem(deeperKey, deeper ? 'delicate' : 'fast'); } catch { /* not kept */ }
      refresh();
    });
    chip.addEventListener('click', (ev) => {
      if (!ev.target.closest('[data-unfile]') || running) return;
      file = null;
      showFile();
      refresh();
      box.focus();
    });
    $('[data-add]', el).addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { take(fileInput.files[0]); fileInput.value = ''; });
    ['dragenter', 'dragover'].forEach((t) => el.addEventListener(t, (ev) => {
      if (ev.dataTransfer && [...ev.dataTransfer.types].includes('Files')) { ev.preventDefault(); drop.classList.add('is-over'); }
    }));
    el.addEventListener('dragleave', (ev) => { if (!el.contains(ev.relatedTarget)) drop.classList.remove('is-over'); });
    el.addEventListener('drop', (ev) => {
      drop.classList.remove('is-over');
      const dropped = ev.dataTransfer && ev.dataTransfer.files[0];
      if (!dropped) return;
      ev.preventDefault();
      if (running) { toast('One check at a time. This one is still running.', 'info'); return; }
      take(dropped);
    });
    // Ctrl+V with a picture on the clipboard (a Snipping Tool capture, say). Pasted text is left to the box: a copy
    // from Excel or Word carries a picture of itself too, and pasted into a text box it is the text that is meant.
    const onPaste = (ev) => {
      if (!el.isConnected) { document.removeEventListener('paste', onPaste); return; }
      const items = [...(ev.clipboardData ? ev.clipboardData.items : [])];
      const typing = ev.target && ev.target.closest && ev.target.closest('input, textarea, [contenteditable]');
      if (typing && items.some((i) => i.kind === 'string' && i.type === 'text/plain')) return;
      const item = items.find((i) => i.kind === 'file' && /^image\//.test(i.type));
      if (item) { ev.preventDefault(); readPicture(item.getAsFile()); }
    };
    document.addEventListener('paste', onPaste);
    form.addEventListener('submit', (ev) => { ev.preventDefault(); run(refresh()); });

    // The camera: on only while its view is open, looked at a few times a second, off the moment a code is found.
    const camBtn = $('[data-qr-cam]', el);
    if (camBtn) {
      const camView = $('[data-qr-camview]', el);
      const video = $('video', camView);
      let stream = null;
      let timer = null;
      const stop = () => {
        clearInterval(timer);
        timer = null;
        if (stream) stream.getTracks().forEach((t) => t.stop());
        stream = null;
        video.srcObject = null;
        camView.hidden = true;
        camBtn.setAttribute('aria-expanded', 'false');
      };
      camBtn.addEventListener('click', async () => {
        if (stream) { stop(); return; }
        try { await qrEngine(); } catch (err) { toast(err.message, 'error'); return; }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        } catch {
          stream = null;
          toast('The camera could not be started. Check that one is connected and that apps are allowed to use it.', 'error', 6000);
          return;
        }
        camView.hidden = false;
        camBtn.setAttribute('aria-expanded', 'true');
        video.srcObject = stream;
        try { await video.play(); } catch { /* it plays when it can */ }
        timer = setInterval(async () => {
          if (!el.isConnected) { stop(); return; }
          if (reading || !video.videoWidth) return;
          const text = qrFrom(video, video.videoWidth, video.videoHeight, [Math.min(640, Math.max(video.videoWidth, video.videoHeight))]);
          if (text == null) return;
          stop();
          reading = true;
          try { await fromCode(text); } finally { reading = false; }
        }, 350);
      });
    }

    // A file chosen with "Scan with Sentinel" in the Windows right-click menu, handed over once by the app: checked at once.
    if (desktop && desktop.takeMenuFile) desktop.takeMenuFile().then(async (m) => {
      if (!m || !el.isConnected) return;
      if (await take(new File([m.data], m.name))) run(refresh());
    }, () => toast('That file could not be opened. Drop it here instead.', 'error'));

    // After the drafts are put back (render), so an old draft never takes the place of what was handed over: a link in
    // the address (Back and reload show it without spending another scan), or what the Overview box, the palette or the
    // phone's Share menu sent here.
    const handed = shared;
    shared = null;
    Promise.resolve().then(() => {
      if (preset) {
        box.value = preset;
        choice = null;
        refresh();
        if (!history.state || history.state.scanned !== preset) form.requestSubmit();
      } else if (handed && handed.text) {
        box.value = handed.text;
        $('[name=from]', form).value = '';
        choice = null;
        box.dispatchEvent(new Event('input', { bubbles: true }));
        form.requestSubmit();
      } else if (handed && handed.image) {
        refresh();
        readPicture(handed.image);
        preview.scrollIntoView({ block: 'center', behavior: glide() });
      } else refresh();
    });
  }

  /* ------------------------------------------------------------ QR codes */

  // A picture of a QR code is read in this page (qr.js), never uploaded. Only the text it holds goes to the server,
  // which says what the code does: a link, or something that is not a link at all (a sign-in code, a wallet
  // connection, a crypto payment) and would never show up in a link scan.

  /**
   * The text of a QR code in an image or a video frame, or null. A picture is tried at two sizes, large first, then
   * smaller; a camera frame once, at most 640 wide, since it is looked at a few times a second on the page's own thread.
   */
  function qrFrom(src, w, h, sides) {
    if (!window.SentinelQR || !w || !h) return null;
    const big = Math.max(w, h);
    for (const side of sides || [Math.min(1600, Math.max(big, 480)), 800]) {
      const s = side / big;
      const cw = Math.max(1, Math.round(w * s));
      const ch = Math.max(1, Math.round(h * s));
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const g = canvas.getContext('2d', { willReadFrequently: true });
      // A small, sharp code is enlarged square by square, not blurred.
      g.imageSmoothingEnabled = s < 1;
      g.drawImage(src, 0, 0, cw, ch);
      const text = window.SentinelQR.decode(g.getImageData(0, 0, cw, ch));
      if (text != null) return text;
    }
    return null;
  }

  async function qrFromFile(file) {
    await qrEngine();
    const bmp = await createImageBitmap(file);
    try { return qrFrom(bmp, bmp.width, bmp.height); } finally { bmp.close(); }
  }

  // The reader (qr.js) loads the first time a picture or the camera is read, not with every page of the app.
  let qrLoad = null;
  function qrEngine() {
    if (window.SentinelQR) return Promise.resolve(window.SentinelQR);
    return qrLoad || (qrLoad = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/assets/js/qr.js';
      s.onload = () => (window.SentinelQR ? resolve(window.SentinelQR) : s.onerror());
      s.onerror = () => { qrLoad = null; s.remove(); reject(new Error('The QR code reader could not load. Try again in a moment.')); };
      document.head.appendChild(s);
    }));
  }

  /** What a QR code does, as a card in the shape of a verdict, with what to do when it is more than a link. */
  function qrCard(info) {
    const tone = info.tone || 'clear';
    const steps = info.steps || [];
    return `<article class="result result--${tone} qr-card">
        <header class="result__head">
          <div class="result__glyph" style="--c:${color(info.tone || null)}">${ICON.qr}</div>
          <div class="result__title">
            <h2>${esc(info.title)}</h2>
            <p><span class="mono">From a QR code</span></p>
            <p class="result__sub">${esc(info.detail)}</p>
          </div>
        </header>
        ${steps.length ? `<div class="next-steps next-steps--${tone === 'clear' ? 'yellow' : tone}"><h3>${tone === 'red' || tone === 'orange' ? 'What to do now' : 'Before you use it'}</h3><ol>${steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>` : ''}
      </article>`;
  }

  // Only the code's text is sent, and never a secret in it (a sign-in token, a Wi-Fi password): see SentinelQR.redact.
  async function explainQr(out, text, { focus = false } = {}) {
    try {
      const { qr } = await api('/scan/qr', { method: 'POST', body: { text: window.SentinelQR.redact(text) } });
      out.innerHTML = qrCard(qr) + (canWarn(qr.tone) ? warnRow() : '');
      wireWarn(out, () => window.SentinelWarnCard.fromQr(qr));
      // Read from a picture, the result is somewhere new on the page: keyboard and screen reader users are taken to it.
      const heading = focus && $('h2', out);
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: false }); }
      return qr;
    } catch (err) {
      out.innerHTML = friendlyError(err);
      return null;
    }
  }

  const REPORT_CATEGORIES = [
    ['phishing', 'Phishing / fake login'], ['fake_store', 'Fake shop'], ['crypto_scam', 'Crypto scam'], ['tech_support_scam', 'Tech support scam'],
    ['investment_scam', 'Investment scam'], ['romance_scam', 'Romance scam'], ['impersonation', 'Impersonates a brand or person'], ['malware', 'Spreads malware'], ['other', 'Something else']
  ];

  function actionsFor(v) {
    const copy = `<button class="btn btn--sm" data-copy-report>Copy report</button>${v.kind !== 'file' && canWarn(window.UI.headline(v).tone) ? WARN_BTN : ''}`;
    if (v.kind !== 'url') return `<div class="panel actions"><span class="muted">Share what Sentinel found.</span><span class="actions__btns">${copy}</span></div>`;
    const trusted = v.override === 'allow';
    const blocked = v.override === 'block';
    return `<div class="panel actions">
      <span class="muted">${trusted ? 'You trust this site, so its masks are hidden for you.' : blocked ? 'You blocked this site, so it always shows a red mask for you.' : 'Think Sentinel got this wrong, or want to warn others?'}</span>
      <span class="actions__btns">
        ${copy}
        <button class="btn btn--sm" data-act="report" aria-expanded="false">Report this site</button>
        <button class="btn btn--sm" data-act="${trusted ? 'clear' : 'allow'}">${trusted ? 'Stop trusting' : 'Trust this site'}</button>
        <button class="btn btn--sm" data-act="${blocked ? 'clear' : 'block'}">${blocked ? 'Unblock' : 'Block this site'}</button>
      </span>
      <form class="report" data-report-form data-draft="report:${esc(v.url)}" hidden>
        <div class="row2">
          <div class="field"><label for="rp-cat">What kind of site is it?</label><select class="input" id="rp-cat" name="category">${(canWarn(window.UI.headline(v).tone) ? [['false_alarm', 'It is safe: Sentinel got this wrong']] : []).concat(REPORT_CATEGORIES).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></div>
          <div class="field"><label for="rp-note">Anything else? <span class="opt">(optional)</span></label><input class="input" id="rp-note" name="note" maxlength="500" placeholder="How did you come across it?"></div>
        </div>
        <div class="report__foot"><span class="muted">Three reports from different accounts confirm a site for everyone.</span><button class="btn btn--gold btn--sm" type="submit">Send report</button></div>
      </form>
    </div>`;
  }

  function wireActions(root, v) {
    wireWarn(root, () => window.SentinelWarnCard.fromVerdict(v, window.UI.headline(v)));
    const report = $('[data-act="report"]', root);
    const form = $('[data-report-form]', root);
    if (report) report.addEventListener('click', () => {
      const open = form.hidden;
      form.hidden = !open;
      report.setAttribute('aria-expanded', String(open));
      if (open) $('select', form).focus();
    });
    if (form) form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      busy($('button[type=submit]', form), 'Sending', async () => {
        try {
          const r = await api('/report', { method: 'POST', body: { url: v.url, category: form.category.value, note: form.note.value } });
          toast(form.category.value === 'false_alarm' ? 'Sent, thank you. On its own a report changes no one’s result. Trust this site to stop its warning for you.'
            : r.promoted ? 'Reported. This site is now confirmed for everyone.' : `Thanks. ${r.reports} report${r.reports === 1 ? '' : 's'} so far.`, 'success');
          form.hidden = true;
          report.disabled = true;
          report.textContent = 'Reported';
        } catch (err) { toast(err.message, 'error'); }
      });
    });
    $$('[data-act="allow"], [data-act="block"], [data-act="clear"]', root).forEach((b) => b.addEventListener('click', () => busy(b, 'Saving', async () => {
      try {
        const action = b.dataset.act;
        await api('/sites/override', { method: 'POST', body: { url: v.url, action } });
        toast(action === 'allow' ? `${v.domain} is trusted. Its masks are hidden for you.` : action === 'block' ? `${v.domain} is blocked. It will always show a red mask for you.` : `Rule removed for ${v.domain}.`, 'success');
        v.override = action === 'clear' ? null : action;
        // Redraw the row so the buttons reflect the new rule.
        b.closest('.actions').outerHTML = actionsFor(v);
        wireActions(root, v);
        window.UI.wireCopy(root, v);
      } catch (err) { toast(err.message, 'error'); }
    })));
  }

  /* ======================================================= warn a friend */

  // A picture of a scam that was found, for someone who may get the same one: drawn on this device (warncard.js),
  // with the link written so it cannot be tapped, and never uploaded. Only for a likely or confirmed scam.
  const WARN_BTN = '<button class="btn btn--sm" type="button" data-warn aria-expanded="false">Warn a friend</button>';
  const warnRow = () => `<div class="panel actions"><span class="muted">Someone you know might get this one too.</span><span class="actions__btns">${WARN_BTN}</span></div>`;
  const canWarn = (tone) => tone === 'red' || tone === 'orange';

  function wireWarn(root, make) {
    const btn = $('[data-warn]', root);
    const W = window.SentinelWarnCard;
    if (!btn || !W) return;
    btn.addEventListener('click', async () => {
      const row = btn.closest('.actions');
      const open = $('[data-warn-card]', row);
      if (open) { open.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
      // A second press while the picture is still being drawn would add a second card.
      if (btn.dataset.drawing) return;
      btn.dataset.drawing = '1';
      const card = make();
      const canvas = document.createElement('canvas');
      let blob = null;
      try {
        await W.draw(canvas, card);
        blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      } catch { /* told below */ } finally { delete btn.dataset.drawing; }
      if (!blob) { toast('The picture could not be made in this browser.', 'error'); return; }
      const file = new File([blob], 'sentinel-scam-warning.png', { type: 'image/png' });
      const share = Boolean(navigator.canShare && navigator.canShare({ files: [file] }));
      const copy = Boolean(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write);
      const panel = h(`<div class="warn-card" data-warn-card>
        <div class="warn-card__pic"></div>
        <div class="warn-card__side">
          <p>Send this picture to anyone who might get the same scam. The link on it is written so it cannot be tapped. The picture was made on this device and is not uploaded.</p>
          <span class="actions__btns">
            ${share ? '<button class="btn btn--gold btn--sm" type="button" data-warn-share>Share</button>' : ''}
            ${copy ? '<button class="btn btn--sm" type="button" data-warn-copy>Copy picture</button>' : ''}
            <a class="btn btn--sm" data-warn-save download="sentinel-scam-warning.png" href="${canvas.toDataURL('image/png')}">Save picture</a>
          </span>
        </div>
      </div>`);
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', W.text(card));
      $('.warn-card__pic', panel).appendChild(canvas);
      const shareBtn = $('[data-warn-share]', panel);
      if (shareBtn) shareBtn.addEventListener('click', () => navigator.share({ files: [file], text: W.text(card) }).catch((err) => {
        if (err.name !== 'AbortError') toast('That could not be shared. Save the picture and send it instead.', 'error');
      }));
      const copyBtn = $('[data-warn-copy]', panel);
      if (copyBtn) copyBtn.addEventListener('click', () => navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        .then(() => toast('Picture copied. Paste it into a message.', 'success'), () => toast('Couldn’t access the clipboard. Save the picture instead.', 'error')));
      row.appendChild(panel);
      btn.setAttribute('aria-expanded', 'true');
      $('a, button', panel).focus({ preventScroll: true });
      panel.scrollIntoView({ behavior: glide(), block: 'nearest' });
    });
  }

  // What each finding is called on its mark, and why it matters, in plain words. Keyed by the check (server/lib/scan/email.js).
  const EMAIL_MARKS = {
    E01: ['Name is not the address', 'The name says one company, but the address it came from belongs to someone else. Anyone can type any name.'],
    E02: ['Look-alike address', 'The address is made to look like a real company\'s, with a small change that is easy to miss.'],
    E03: ['Replies go elsewhere', 'If you press Reply, your answer goes to a different address than the one this came from.'],
    E04: ['Company on a free mailbox', 'A company or office writing from a free mailbox anyone can open. Real ones write from their own address.'],
    E05: ['Rushes you', 'Words meant to hurry you, so you act before you stop to check.'],
    E06: ['Asks for your details', 'Asks you to confirm a password, an account or card details. Real companies do not ask for these by email.'],
    E07: ['Asks for gift cards or crypto', 'Asks to be paid in a way that cannot be undone, like gift cards, crypto or a wire transfer. This is how scammers get paid.'],
    E08: ['Does not use your name', 'A greeting that does not use your name. Companies you deal with usually do.'],
    E09: ['A threat', 'Threatens to close your account or take action against you, to scare you into acting.'],
    E10: ['Link goes somewhere else', 'The words show one address, but the link opens a different one.'],
    E11: ['Hidden link address', 'A shortened link hides where it really goes.'],
    E12: ['QR code lure', 'Asks you to scan a code with your phone, where it is harder to see where it leads.'],
    E13: ['A program', 'This attachment is a program. Opening it would run it on your computer.'],
    E14: ['Hides its real type', 'The name ends like a document, but the file is something else.'],
    E15: ['Macro document', 'A document that can run code when you open it.'],
    E16: ['Archive with its password', 'An archive sent with its password: a way to get past virus scanners.'],
    E17: ['Invoice lure', 'An invoice or receipt sent with a risky attachment.'],
    E18: ['Made-up address', 'The sender\'s address is several words stitched together, often a new address made for a scam.'],
    E19: ['Untraceable payment', 'Presents as a company or office and asks for gift cards, crypto or a wire transfer. No real one does.'],
    E20: ['Parcel fee', 'Asks for a fee to release a parcel. Check on the courier\'s own site instead.'],
    E21: ['Call this number', 'Asks you to phone a number about a charge or a problem. The person who answers is the scammer.'],
    E22: ['Asks for private details', 'Asks you to send an ID, bank details or a password by reply.'],
    E23: ['Urgent favour', 'An urgent, private favour with gift cards or a wire transfer. Check with the person another way first.'],
    E24: ['Money for a stranger', 'Asks for money for travel, or offers a fortune you have to pay to claim.'],
    E25: ['Toll or fine', 'Demands an unpaid toll or fine from an address that is not the agency\'s own.'],
    E27: ['Web page attached', 'A web page sent as a file, often a sign-in page made to catch your password.'],
    E28: ['Paid tasks offer', 'Promises daily pay for simple tasks. It ends with you paying to get "earnings" out.'],
    E29: ['Voicemail lure', 'A voicemail you can only hear through a link, which leads to a sign-in page.'],
    E31: ['Not really from here', 'The email\'s own headers show it was not sent by the address in From. Anyone can write any address there.'],
    'EL-scam': ['Scam link', 'Sentinel checked where this link goes, and it looks like a scam.'],
    'EL-malware': ['Malware link', 'Sentinel checked where this link goes, and it leads to malware.'],
    'EL-virus': ['Virus download', 'Sentinel checked where this link goes, and it downloads a virus.']
  };

  /**
   * The email as it was scanned, inside the result, with each finding marked where it is (the server says where, by
   * offsets into each field) and labelled. Tapping a mark says why. Shown only when something was found.
   */
  // Who really sent it, when the email was pasted with its headers (server/lib/scan/sender.js): one line, in words.
  function showProof(out, sender) {
    const more = $('.result__more', out);
    if (!sender || !sender.proof || !more) return;
    more.before(h(`<section class="sender-proof" data-sender-proof data-proof="${esc(sender.proof.status)}"><span class="sender-proof__k">Who sent it</span><b>${esc(sender.proof.text)}</b></section>`));
    // Said once: the same words under Why would repeat the line just added.
    $$('.reasons li', out).filter((li) => li.textContent === sender.proof.text).forEach((li) => li.remove());
    const why = $('.reasons', out);
    if (why && !why.querySelector('li')) why.remove();
  }

  function showMarks(out, mail, items) {
    const found = items.filter((c) => (c.status === 'fail' || c.status === 'warn') && c.marks && c.marks.length);
    const more = $('.result__more', out);
    if (!found.length || !more) return;
    const whys = [];
    const fields = [['from', 'From', mail.from], ['replyTo', 'Reply-to', mail.replyTo], ['subject', 'Subject', mail.subject], ['attachments', 'Attachments', mail.attachments.join(', ')], ['body', 'Message', mail.body]];
    const rows = fields.filter(([, , text]) => text).map(([key, label, text]) => {
      // Findings in the same words become one mark that carries each of them.
      const spans = found.flatMap((c) => c.marks.filter((m) => m.field === key && m.start >= 0 && m.end <= text.length && m.end > m.start).map((m) => ({ start: m.start, end: m.end, checks: [c] })))
        .sort((a, b) => a.start - b.start);
      const merged = [];
      for (const s of spans) {
        const last = merged[merged.length - 1];
        if (last && s.start < last.end) {
          last.end = Math.max(last.end, s.end);
          if (!last.checks.includes(s.checks[0])) last.checks.push(s.checks[0]);
        } else merged.push(s);
      }
      let html = '';
      let at = 0;
      for (const s of merged) {
        const fail = s.checks.some((c) => c.status === 'fail');
        whys.push({ fail, checks: s.checks });
        // The label stays on the line of its last word (up to 12 letters of it, so a long link can still wrap): on a
        // phone it used to drop to a line of its own, away from what it marks.
        const words = text.slice(s.start, s.end);
        const tail = words.length - words.match(/\S{0,12}$/)[0].length;
        html += `${esc(text.slice(at, s.start))}<mark class="emark${fail ? ' is-fail' : ''}" tabindex="0" role="button" aria-expanded="false" data-emark="${whys.length - 1}">${esc(words.slice(0, tail))}<span class="emark__end">${esc(words.slice(tail))}<span class="emark__tag">${esc(s.checks.map((c) => (EMAIL_MARKS[c.id] || [c.title])[0]).join(', '))}</span></span></mark>`;
        at = s.end;
      }
      return `<div class="email-marks__row" data-efield="${key}"><span class="email-marks__k">${label}</span><div dir="auto" class="email-marks__v${key === 'body' ? ' email-marks__body' : ''}">${html}${esc(text.slice(at))}</div></div>`;
    });
    const section = h(`<section class="email-marks" data-email-marks><h3>The email, marked</h3><p class="email-marks__hint">Each warning sign is marked where it is. Tap a mark to see why.</p>${rows.join('')}</section>`);
    more.before(section);
    const why = h('<div class="email-marks__why" role="status" data-emark-why></div>');
    const toggle = (mark) => {
      const open = mark.getAttribute('aria-expanded') !== 'true';
      $$('[data-emark]', section).forEach((m) => m.setAttribute('aria-expanded', 'false'));
      if (!open) { why.remove(); return; }
      const w = whys[Number(mark.dataset.emark)];
      mark.setAttribute('aria-expanded', 'true');
      why.classList.toggle('is-fail', w.fail);
      why.innerHTML = w.checks.map((c) => { const [label, text] = EMAIL_MARKS[c.id] || [c.title, '']; return `<b>${esc(label)}</b>${text ? `<p>${esc(text)}</p>` : ''}<small>${esc(c.detail)}</small>`; }).join('');
      mark.closest('[data-efield]').after(why);
    };
    section.addEventListener('click', (ev) => { const m = ev.target.closest('[data-emark]'); if (m) toggle(m); });
    section.addEventListener('keydown', (ev) => {
      const m = ev.target.closest('[data-emark]');
      if (m && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); toggle(m); }
    });
  }

  /* ======================================================= shared from a phone */

  // The phone's Share menu opens /app/share (manifest.webmanifest share_target): a link, words or a picture go to the
  // Check page, which checks them at once (share.js decides which). The share
  // box is emptied as it is read, so nothing shared stays on the device after this.
  function shareView(el, params) {
    el.innerHTML = `${title('Shared with Sentinel', 'Opening the right check for what you shared.')}<div data-out aria-live="polite"></div>`;
    const fromQuery = shared && shared.query;
    shared = null;
    const mine = shareBox;
    shareBox = 0;
    Share.take(mine).catch(() => null).then((got) => {
      if (!el.isConnected) return;
      // A second share arrived while this one's page was opening: its own page opens it, and this one says nothing.
      if (got && got.newer) return;
      const q = fromQuery;
      const share = got || (q ? { title: q.get('title') || '', text: q.get('text') || '', url: q.get('url') || '', image: null } : null);
      const r = share ? Share.route({ ...share, image: Boolean(share.image) }) : { kind: 'empty' };
      const go = (href) => { history.replaceState({}, '', href); render(); };
      if (r.kind === 'link') return go(`/app/check?url=${encodeURIComponent(r.url)}`);
      if (r.kind === 'text') { shared = { text: r.text }; return go('/app/check'); }
      if (r.kind === 'image') { shared = { image: share.image }; return go('/app/check'); }
      const sub = $('.page-title p', el);
      if (sub) sub.textContent = 'Check a message or a link straight from another app.';
      $('[data-out]', el).innerHTML = `<div class="panel" data-share-empty>
        <p>${params.get('missed') ? 'What you shared did not reach Sentinel. Please share it once more.' : 'Nothing is waiting to be checked.'}
          In Messages, WhatsApp, Gmail or your browser, press Share and choose Sentinel: the link, message or picture opens in Check.</p>
        <p class="field__hint u-mt-sm" data-iphone-note>${esc(IPHONE_NOTE)}</p>
        <p class="u-mt-sm"><a class="btn btn--sm" href="/app/check">Check something</a></p>
      </div>`;
    });
  }

  /* ============================================================ a text's result */

  /** The verdict card for a text: what it is, why, what to do, and each link's own result. */
  function textResult(r, from) {
    const f = r.flag;
    const red = r.links.some((l) => l.badge === 'red');
    const tone = !f ? 'clear' : red ? 'red' : f.level === 'danger' ? 'orange' : 'yellow';
    const who = !from ? 'No sender given' : `From ${from}${r.sender === 'number' ? ', a phone number' : r.sender === 'shortcode' ? ', a business short code' : r.sender === 'email' ? ', an email address' : ''}`;
    const linkLine = (l) => `${l.host || l.url}: ${l.badge ? `${l.label}${l.reason ? `. ${l.reason}` : ''}` : l.label === 'Not checked' ? 'could not be checked just now' : 'no threat found'}`;
    const reasons = [...(f ? [[f.detail, tone]] : []), ...r.links.map((l) => [linkLine(l), l.badge])];
    // Family on a "new number" and slow scams want money sent; the rest want a card number or a sign-in.
    const happened = f && (/family/i.test(f.title) || r.conversation) ? 'bank' : 'card,password';
    const scam = f && (f.level === 'danger' || red);
    const steps = f ? [f.advice] : [`Nothing in this text matches the scams Sentinel knows${r.links.length ? ', and its links are on no threat list' : ''}.`, 'Still unsure? Contact the company or person through their own app, website or a number you already have, not the one in the text.'];
    return `<article class="result result--${tone}" data-result data-text-result="${tone}">
      <header class="result__head">
        ${resultGlyph('scam', tone)}
        <div class="result__title">
          <h2>${esc(f ? f.title : 'No signs of a scam in this text')}</h2>
          <p class="result__sub">${esc(who)}</p>
        </div>
      </header>
      <div class="next-steps next-steps--${tone}"><h3>${f ? 'What to do now' : 'Good to know'}</h3><ol>${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        ${scam ? `<p class="next-steps__more">${r.links.length ? 'Already tapped the link, paid or replied?' : 'Already paid or replied?'} <a href="/app/recover?happened=${happened}">Open the recovery guide</a> for every step, in order.</p>` : ''}</div>
      ${r.conversation ? slowSteps(r.conversation) : ''}
      ${reasons.length ? `<div class="reasons"><h3>Why</h3><ul>${reasons.map(([t, badge]) => `<li><span class="dot" style="--c:${color(badge || null)}"></span>${esc(t)}</li>`).join('')}</ul></div>` : ''}
      <div class="notes"><p>${r.links.length ? 'Links were checked by their address only and were not opened. ' : ''}The text was checked in memory and not kept, and it is not in your history.</p></div>
    </article>${scam && canWarn(tone) ? warnRow() : ''}`;
  }

  /** Where a conversation is on the path of a slow scam (server/lib/scan/slowscam.js), and what usually comes next. */
  function slowSteps(c) {
    return `<div class="slow slow--${c.level === 'danger' ? 'orange' : 'yellow'}" data-slow="${esc(c.at)}">
      <h3>Where this conversation is</h3>
      <ol class="slow__steps">${c.stages.map((s, i) => `<li class="slow__step${s.seen ? ' is-seen' : ''}${s.id === c.at ? ' is-at' : ''}" style="--i:${i}"${s.id === c.at ? ' aria-current="step"' : ''}>
        <span class="slow__dot" aria-hidden="true"></span><span>${esc(s.label)}</span><span class="slow__sr">${s.seen ? ' (seen in this conversation)' : ''}</span></li>`).join('')}</ol>
      <p class="slow__next"><b>What usually comes next.</b> ${esc(c.next)}</p>
    </div>`;
  }

  /** PNG slices of an image, at most 2000 wide and 1600 tall, overlapping by 60 so no line is cut in half. */
  async function sliceImage(file) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / bmp.width);
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const out = [];
    for (let y = 0; y < h && out.length < 12; y += 1540) {
      const sh = Math.min(1600, h - y);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = sh;
      canvas.getContext('2d').drawImage(bmp, 0, y / scale, bmp.width, sh / scale, 0, 0, w, sh);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      out.push(new Uint8Array(await blob.arrayBuffer()));
      if (y + sh >= h) break;
    }
    bmp.close();
    return out;
  }

  /** The slices' text as one, with a line that both slices saw (the overlap) kept once. */
  function joinSlices(texts) {
    const lines = [];
    for (const t of texts) {
      const next = String(t || '').split('\n');
      while (next.length && lines.length && lines.slice(-3).includes(next[0])) next.shift();
      lines.push(...next);
    }
    return lines.join('\n').trim();
  }

  /** A screenshot has no "From:" header, but it shows the sender's address near the top: use the first one seen. */
  function withSender(text) {
    if (/^(from|sender)\s*:/im.test(text)) return text;
    const head = text.split('\n').slice(0, 12).join('\n');
    const m = head.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
    return m ? `From: ${m[0]}\n\n${text}` : text;
  }

  /** Pull the useful parts out of a pasted email: headers first, then the body. */
  function parseEmail(raw) {
    let text = raw.replace(/\r\n?/g, '\n');
    const out = { from: '', replyTo: '', subject: '', body: text, attachments: [], headers: '' };
    // Gmail's Show original page, copied whole, starts with a summary: the message itself is the block with the
    // headers a mail service writes.
    const delivered = text.search(/^(Received|Authentication-Results|Received-SPF|DKIM-Signature|Return-Path|Delivered-To)[ \t]*:/im);
    if (delivered > 0 && /\n\s*\n/.test(text.slice(0, delivered))) text = text.slice(text.lastIndexOf('\n', delivered - 1) + 1);
    const headerEnd = text.search(/\n\s*\n/);
    // Headers on their own (Outlook's Internet headers box) have no blank line and no body: every line is a header,
    // and the From line comes after a long route, far past the first 1200 letters.
    const onlyHeaders = headerEnd < 0 && text.trim().split('\n').every((l) => /^([ \t]|[\w-]+[ \t]*:)/.test(l));
    const headBlock = headerEnd > 0 ? text.slice(0, headerEnd) : onlyHeaders ? text.slice(0, 64 * 1024) : text.slice(0, 1200);
    const header = (name, block = headBlock) => {
      const m = block.match(new RegExp(`^${name}\\s*:\\s*(.+(?:\\n[ \\t]+.+)*)`, 'im'));
      return m ? words(m[1].replace(/\n[ \t]+/g, ' ').trim()) : '';
    };
    out.from = header('From') || header('Sender');
    out.replyTo = header('Reply-To');
    out.subject = header('Subject');
    // Only the headers that say who really sent it go with the scan: not the route it took, with its addresses.
    out.headers = (headBlock.match(/^(Authentication-Results|Received-SPF|DKIM-Signature|Return-Path)[ \t]*:.*(\n[ \t]+.*)*/gim) || []).join('\n');
    if (out.from || out.subject) out.body = headerEnd > 0 ? (readable(headBlock, text.slice(headerEnd).replace(/^\s*\n/, '')) ?? text.slice(headerEnd)).trim() : onlyHeaders ? '' : text;
    // Gmail / Outlook "printed" emails put attachments at the end as bare file names.
    const files = text.match(/\b[\w][\w .()-]{0,80}\.(pdf|exe|zip|rar|7z|docm?|xlsm?|xlsx|pptx?|js|vbs|scr|iso|img|html?|lnk|msi|bat|cmd|apk|dmg)\b/gi) || [];
    out.attachments = [...new Set(files.map((f) => f.trim()))].filter((f) => !/^https?:/i.test(f)).slice(0, 10);
    return out;
  }

  /** Bytes as text in the part's character set (UTF-8 when it names none this browser knows). */
  function decodeBytes(bytes, charset) {
    try { return new TextDecoder(charset || 'utf-8').decode(bytes); } catch { return new TextDecoder().decode(bytes); }
  }
  /** A header's encoded words ("=?UTF-8?B?UGF5UGFs?=") as the words they are. */
  function words(s) {
    return s.replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (all, charset, how, data) => {
      try { return decodeBytes(how.toUpperCase() === 'B' ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) : qp(data.replace(/_/g, ' ')), charset); } catch { return all; }
    });
  }
  function qp(s) {
    const bytes = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '=' && /^[0-9A-F]{2}$/i.test(s.substr(i + 1, 2))) { bytes.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; } else bytes.push(s.charCodeAt(i) & 255);
    }
    return Uint8Array.from(bytes);
  }
  /**
   * The readable text of a raw message (an .eml file, or Show original): its plain text part, else its web page part
   * as text with each link written "words <address>", decoded. Null when the message is not in parts or encoded.
   * The page part is only parsed, never shown or loaded.
   */
  function readable(head, body, depth = 0) {
    const field = (name) => { const m = head.match(new RegExp(`^${name}\\s*:\\s*(.+(?:\\n[ \\t]+.+)*)`, 'im')); return m ? m[1].replace(/\n[ \t]+/g, ' ') : ''; };
    const type = field('Content-Type');
    const enc = field('Content-Transfer-Encoding').trim().toLowerCase();
    const boundary = /boundary\s*=\s*"?([^";]+)"?/i.exec(type);
    if (/^\s*multipart\//i.test(type) && boundary && depth < 5) {
      const parts = body.split(`--${boundary[1].trim()}`).slice(1).filter((p) => !p.startsWith('--')).map((p) => {
        const s = p.replace(/^[ \t]*\n/, '');
        const end = s.search(/\n\s*\n/);
        return end < 0 ? null : { head: s.slice(0, end), body: s.slice(end).replace(/^\s*\n/, '') };
      }).filter(Boolean);
      const pick = parts.find((p) => /^content-type\s*:\s*text\/plain/im.test(p.head)) || parts.find((p) => /^content-type\s*:\s*(text\/html|multipart\/)/im.test(p.head));
      return pick ? readable(pick.head, pick.body, depth + 1) : null;
    }
    if (!type && !enc) return null;
    const charset = (/charset\s*=\s*"?([^";\s]+)/i.exec(type) || [])[1];
    let textOut = body;
    try {
      if (enc === 'base64') textOut = decodeBytes(Uint8Array.from(atob(body.replace(/[^A-Za-z0-9+/=]/g, '')), (c) => c.charCodeAt(0)), charset);
      else if (enc === 'quoted-printable') textOut = decodeBytes(qp(body.replace(/=\n/g, '')), charset);
    } catch { return null; }
    if (!/^\s*text\/html/i.test(type)) return textOut;
    const doc = new DOMParser().parseFromString(textOut, 'text/html');
    doc.querySelectorAll('script, style').forEach((n) => n.remove());
    doc.querySelectorAll('a[href]').forEach((a) => a.replaceWith(`${a.textContent.trim()} <${a.getAttribute('href')}> `));
    doc.querySelectorAll('br, p, div, tr, li, h1, h2, h3').forEach((n) => n.append('\n'));
    return doc.body ? doc.body.textContent.replace(/[ \t ]+/g, ' ').replace(/\n\s*\n\s*/g, '\n\n').trim() : null;
  }

  /* ============================================================ history */

  async function historyView(el, params) {
    el.innerHTML = `${title('History', 'Everything Sentinel checked for you in the last 30 days. Click a link to scan it again.')}
      <div class="usage-list" data-stats>${skel('stats')}</div>
      <div class="panel u-mt" data-list>${skel('history')}</div>`;
    let data;
    try { data = await api('/account/history'); }
    catch (err) { $('[data-stats]', el).innerHTML = ''; failed($('[data-list]', el), err, () => historyView(el, params), { what: 'Your history' }); return; }

    const s = data.stats;
    const stat = (glyph, n, label, color, filter) => `<button type="button" class="usage-row" data-stat="${filter}" aria-pressed="false"><span class="usage-row__icon" style="color:${color}">${Masks.svg(glyph)}</span><span class="usage-row__l">${label}</span><b class="usage-row__n tabular">${n}</b></button>`;
    $('[data-stats]', el).innerHTML = stat('scam', s.scams, 'Scams caught', 'var(--red)', 'scam') + stat('virus', s.viruses, 'Viruses caught', 'var(--orange)', 'virus') + stat('malware', s.malware, 'Malware caught', 'var(--yellow)', 'malware');

    const FILTERS = [['all', 'All'], ['flagged', 'Flagged'], ['clear', 'Clear'], ['scam', 'Scam'], ['virus', 'Virus'], ['malware', 'Malware'], ['live', 'Live'], ['manual', 'Manual']];
    const flaggedLevel = (lvl) => ['suspicious', 'likely', 'confirmed'].includes(lvl);
    const hs = { filter: params.get('filter') || 'all', q: '' };
    const list = $('[data-list]', el);
    list.innerHTML = `<div class="panel__head"><div><h2 data-total>${s.total} scan${s.total === 1 ? '' : 's'}</h2><p>${s.flagged} flagged</p></div>
        <span class="tools__end"><button type="button" class="btn btn--sm btn--ghost" data-history-clear ${data.items.length ? '' : 'hidden'}>Clear history</button>
        <label class="tools__search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" placeholder="Search history" aria-label="Search history" data-q></label></span></div>
      <div class="tools" data-filters data-full>${FILTERS.map(([id, label]) => `<button type="button" class="fchip" data-filter="${id}" aria-pressed="${id === hs.filter}">${label}</button>`).join('')}<span class="mono muted" data-count></span></div>
      <div data-rows></div>`;

    const paint = () => {
      const q = hs.q.toLowerCase();
      const items = data.items.filter((it) => {
        const flagged = flaggedLevel(it.scam) || flaggedLevel(it.virus) || flaggedLevel(it.malware);
        const f = hs.filter;
        const okFilter = f === 'all' || (f === 'flagged' && flagged) || (f === 'clear' && !flagged) || (['scam', 'virus', 'malware'].includes(f) && flaggedLevel(it[f])) || (f === 'live' && it.mode === 'live') || (f === 'manual' && it.mode !== 'live');
        return okFilter && (!q || it.target.toLowerCase().includes(q));
      });
      $('[data-count]', list).textContent = `${items.length} of ${data.items.length}`;
      $('[data-rows]', list).innerHTML = items.length ? historyList(items, { clickable: true })
        : data.items.length
          ? stateBlock('nomatch', hs.q ? `Nothing in your history matches &ldquo;${esc(hs.q)}&rdquo;${hs.filter === 'all' ? '' : ' with that filter'}.` : 'Nothing in your history matches that filter.', { action: '<button type="button" class="btn btn--sm" data-show-all>Show every scan</button>' })
          : stateBlock('waiting', 'No scans yet. What you check shows here for 30 days, so you can look again.', { action: '<a class="btn btn--sm btn--gold" href="/app/check">Check something</a>' });
      $$('[data-filter]', list).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === hs.filter)));
      $$('[data-stat]', el).forEach((b) => {
        b.classList.toggle('is-active', b.dataset.stat === hs.filter);
        b.setAttribute('aria-pressed', String(b.dataset.stat === hs.filter));
      });
    };
    $$('[data-filter]', list).forEach((b) => b.addEventListener('click', () => { hs.filter = b.dataset.filter; paint(); }));
    $$('[data-stat]', el).forEach((b) => b.addEventListener('click', () => { hs.filter = hs.filter === b.dataset.stat ? 'all' : b.dataset.stat; paint(); }));
    $('[data-q]', list).addEventListener('input', (ev) => { hs.q = ev.target.value.trim(); paint(); });
    const forget = (body) => api('/account/history/delete', { method: 'POST', body });
    // After a delete the numbers are counted again from what is left.
    const recount = () => {
      const n = (f) => data.items.filter(f).length;
      const counts = { scam: n((it) => flaggedLevel(it.scam)), virus: n((it) => flaggedLevel(it.virus)), malware: n((it) => flaggedLevel(it.malware)) };
      $$('[data-stat]', el).forEach((b) => { $('.usage-row__n', b).textContent = counts[b.dataset.stat]; });
      $('[data-total]', list).textContent = `${data.items.length} scan${data.items.length === 1 ? '' : 's'}`;
      $('[data-total] + p', list).textContent = `${n((it) => flaggedLevel(it.scam) || flaggedLevel(it.virus) || flaggedLevel(it.malware))} flagged`;
      $('[data-history-clear]', list).hidden = !data.items.length;
    };
    list.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-show-all]')) {
        hs.filter = 'all'; hs.q = '';
        $('[data-q]', list).value = '';
        paint();
        $('[data-q]', list).focus();
        return;
      }
      const del = ev.target.closest('[data-forget]');
      if (del) {
        busy(del, '', async () => {
          try {
            const id = Number(del.dataset.forget);
            const gone = data.items.find((it) => it.id === id);
            await forget({ id });
            data.items = data.items.filter((it) => it.id !== id);
            recount();
            // The focus goes on to the next entry's Delete (or the search box), not back to the top of the page.
            const next = del.closest('li').nextElementSibling || del.closest('li').previousElementSibling;
            const nextId = next && $('[data-forget]', next) ? next.querySelector('[data-forget]').dataset.forget : null;
            paint();
            const to = nextId && $(`[data-forget="${nextId}"]`, list);
            (to || $('[data-q]', list)).focus();
            toast(`Deleted ${gone ? gone.target : 'that entry'} from your history.`, 'success');
          } catch (err) { toast(err.message, 'error'); }
        });
        return;
      }
      // The address is a link of its own (the app's link handler opens it); the rest of the row does the same.
      if (ev.target.closest('a')) return;
      const row = ev.target.closest('[data-rescan]');
      if (row) navigate(`/app/check?url=${encodeURIComponent(row.dataset.rescan)}`);
    });
    // Clearing everything asks first: one press says what a second press does.
    let clearArmed = 0;
    const clear = $('[data-history-clear]', list);
    clear.addEventListener('click', () => {
      if (Date.now() - clearArmed > 4000) {
        clearArmed = Date.now();
        clear.textContent = 'Press again to delete all';
        setTimeout(() => { if (Date.now() - clearArmed >= 3900) clear.textContent = 'Clear history'; }, 4000);
        return;
      }
      busy(clear, 'Clearing', async () => {
        try {
          await forget({ all: true });
          data.items = [];
          recount();
          paint();
          $('[data-q]', list).focus();
          toast('Your history is cleared.', 'success');
        } catch (err) { toast(err.message, 'error'); }
      }).then(() => { clear.textContent = 'Clear history'; });
    });
    paint();
    keep($('[data-stats]', el), 'stats');
    keep(list, 'history');
  }

  /* ========================================================== site rules */

  async function sitesView(el) {
    el.innerHTML = `${title('Site rules', 'Sites you trust never show a mask for you. Sites you block always show a red one, in scans, search results and email.')}
      <form class="panel" data-add data-draft="site-rule">
        <div class="row2">
          <div class="field"><label for="site-host">Website</label><input class="input mono" id="site-host" name="host" placeholder="example.com" autocomplete="off" spellcheck="false" required></div>
          <div class="field"><label>Rule</label><div class="segmented" role="radiogroup" aria-label="Rule"><button type="button" role="radio" aria-checked="true" data-rule="allow">Trust</button><button type="button" role="radio" aria-checked="false" data-rule="block">Block</button></div></div>
        </div>
        <div class="report__foot"><span class="muted">Rules apply to the whole site, including its subdomains. Only your account is affected.</span><button class="btn btn--gold" type="submit">Add rule</button></div>
      </form>
      <div class="grid2 u-mt">
        <div class="panel" data-allow>${skel('allow')}</div>
        <div class="panel" data-block>${skel('block')}</div>
      </div>`;

    let rule = 'allow';
    $$('[data-rule]', el).forEach((b) => b.addEventListener('click', () => {
      rule = b.dataset.rule;
      $$('[data-rule]', el).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    }));

    const load = async () => {
      let overrides = [];
      try { ({ overrides } = await api('/sites/overrides')); }
      catch (err) {
        // One answer for both lists, in the first: they come from the same place.
        $('[data-block]', el).hidden = true;
        failed($('[data-allow]', el), err, () => { $('[data-allow]', el).innerHTML = skel('allow'); load(); }, { what: 'Your site rules' });
        return;
      }
      $('[data-block]', el).hidden = false;
      const section = (slot, action, heading, empty) => {
        const rows = overrides.filter((o) => o.action === action);
        slot.innerHTML = `<div class="panel__head"><div><h2>${heading}</h2><p>${rows.length} site${rows.length === 1 ? '' : 's'}</p></div></div>
          ${rows.length ? `<ul class="list">${rows.map((o) => `<li>
            <span class="list__icon">${action === 'allow' ? ICON.check : ICON.lock}</span>
            <span class="list__main"><b class="mono">${esc(o.host)}</b><span>Added ${ago(o.created_at)}</span></span>
            <button class="btn btn--sm" data-remove="${esc(o.host)}">Remove</button>
          </li>`).join('')}</ul>` : stateBlock('waiting', empty, { small: true })}`;
      };
      section($('[data-allow]', el), 'allow', 'Trusted', 'No trusted sites yet. Use "Trust this site" on any scan result, or add one above.');
      section($('[data-block]', el), 'block', 'Blocked', 'No blocked sites. Block a site to give it a red mask everywhere, for you.');
      keep($('[data-allow]', el), 'allow');
      keep($('[data-block]', el), 'block');
      $$('[data-remove]', el).forEach((b) => b.addEventListener('click', () => busy(b, 'Removing', async () => {
        try {
          await api('/sites/override', { method: 'POST', body: { host: b.dataset.remove, action: 'clear' } });
          toast(`Rule removed for ${b.dataset.remove}.`, 'success');
          load();
        } catch (err) { toast(err.message, 'error'); }
      })));
    };

    $('[data-add]', el).addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target;
      busy($('button[type=submit]', form), 'Adding', async () => {
        try {
          const r = await api('/sites/override', { method: 'POST', body: { host: form.host.value.trim(), action: rule } });
          toast(`${r.host} is now ${rule === 'allow' ? 'trusted' : 'blocked'}.`, 'success');
          form.reset();
          load();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
    load();
  }

  /* ====================================================== browser checkup */

  /* ====================================================== recovery guide */

  // The same guide as the website's /recover page (recover.js), inside the app, so the sidebar stays. What is ticked is
  // kept in this browser only, shared with that page.
  function recoverView(el) {
    el.innerHTML = `
      ${title('I think I&rsquo;ve been scammed', 'Take a breath. Tick what happened, and Sentinel puts what to do in order, most urgent first. Nothing you tick leaves this computer.')}
      <div class="recover" data-recover>
        <fieldset class="recover__what">
          <legend><h2>What happened?</h2><span>Tick everything that fits.</span></legend>
          <div class="recover__picks" data-recover-picks></div>
        </fieldset>
        <div class="recover__bar">
          <label class="recover__country"><span>Where you live</span><select data-recover-country></select></label>
          <div class="recover__actions">
            <button type="button" class="btn btn--gold btn--sm" data-recover-print>Print</button>
            <button type="button" class="btn btn--ghost btn--sm" data-recover-reset>Start over</button>
          </div>
        </div>
        <div class="recover__plan" data-recover-plan></div>
      </div>`;
    window.SentinelRecover.mount($('[data-recover]', el), location.search);
  }

  function checkupView(el) {
    const can = Boolean(desktop && desktop.browserCheckup);
    el.innerHTML = `${title('Browser checkup', 'The add-ons, notification permissions, search engine and startup pages of every browser on this computer, looked over for the ones scammers and unwanted software plant.')}
      ${can ? `<div class="panel">
        <div class="panel__head"><div><h2>What the checkup reads</h2><p>Sentinel reads each browser's settings on this computer and changes nothing. History, passwords and cookies are never opened, and sites are checked by their address without being opened.</p></div>
          <button class="btn btn--gold" data-run-checkup>Run checkup</button></div>
      </div>
      <div data-checkup-out aria-live="polite"></div>`
    : lockedCard({ tag: 'Unlocked by the Sentinel app', heading: 'Download Sentinel to check your browsers', body: 'The checkup reads your browsers\' settings on your computer, so it runs in the Sentinel app for Windows.', actions: `<a class="btn btn--gold" href="/download">${ICON.download}Download Sentinel</a>` })}`;
    if (!can) return;
    const out = $('[data-checkup-out]', el);
    const run = $('[data-run-checkup]', el);
    if (state.checkup) paintCheckup(out, state.checkup);
    run.addEventListener('click', () => busy(run, 'Checking', async () => {
      try {
        state.checkup = await desktop.browserCheckup();
        if (out.isConnected) paintCheckup(out, state.checkup);
      } catch (err) { toast(desktopError(err), 'error'); }
    }));
  }

  /** The checkup's findings, worst first in every list. Everything shown came from files any program can write, so all of it is escaped. */
  function paintCheckup(out, r) {
    const rank = { red: 3, orange: 2, yellow: 1 };
    const worse = (a, b) => ((rank[a] || 0) >= (rank[b] || 0) ? a : b);
    const siteBadge = (s) => (s && s.verdict ? s.verdict.badge : null);
    const copy = (addr) => `<button class="btn btn--sm" type="button" data-copy-text="${esc(addr)}">Copy ${esc(addr)}</button>`;
    const row = (icon, badge, name, detail, help = '') => `<li>
      <span class="list__icon" style="${badge ? `color:${esc(color(badge))}` : ''}">${icon}</span>
      <span class="list__main"><b>${esc(name)}</b><span>${esc(detail)}</span>${help ? `<span class="muted">${help}</span>` : ''}</span>
    </li>`;
    const siteRow = (where, s, plain) => row(siteBadge(s) ? Masks.svg('scam') : ICON.globe, siteBadge(s), where,
      !s.verdict ? (r.sitesChecked ? plain : `${plain}. Not checked: ${r.sitesWhy || 'Sentinel could not reach its scanner just now.'}`)
        : s.verdict.badge ? `${s.verdict.label}${s.verdict.reason ? `: ${s.verdict.reason}` : ''}` : `${plain}. No issues found.`);

    // How a flagged add-on is removed depends on how it got there: the Remove button alone does not undo a policy, a
    // shortcut that loads it, or a program that adds it back.
    const removal = (b, a, short) => {
      if (a.source === 'policy') {
        return `A policy on this computer installed it, so ${esc(short)} will not let you remove it. ${b.policies ? 'The policy is listed under "Policies on this computer" above.' : `${esc(short)} lists its policies at ${copy(b.places.policies)}`} Only this computer's administrator can remove a policy. If nobody set one up on purpose, ask someone you trust to help.`;
      }
      if (a.source === 'commandline') {
        return `The shortcut you open ${esc(short)} with loads it, so removing it in the browser does not last. Right-click that shortcut (on the taskbar, right-click the icon, then right-click ${esc(short)}), choose Properties, and in Target delete the part that begins with --load-extension. Do the same for each shortcut, then close ${esc(short)} and open it again.`;
      }
      if (a.source === 'unpacked') {
        return /^about:/.test(b.places.addons) ? `It is gone the next time ${esc(short)} starts.`
          : `Open ${copy(b.places.addons)} and turn on Developer mode. A Remove button then shows on it.`;
      }
      const at = `If you did not add it yourself, remove it at ${copy(b.places.addons)}`;
      return a.source === 'external' ? `${at} If it comes back, uninstall the program that added it, in Settings &gt; Apps.` : at;
    };

    let flagged = 0;
    const panels = r.browsers.map((b) => {
      const short = b.name.replace(/^(Google|Microsoft|Mozilla) /, '');
      const settings = /^about:/.test(b.places.search) ? null : b.places.search;
      const pol = b.policies;
      if (pol && pol.badge) flagged++;
      const profiles = b.profiles.map((p) => {
        const addons = [...p.addons].sort((x, y) => (rank[y.badge] || 0) - (rank[x.badge] || 0));
        // Flagged add-ons are listed; the clean ones fold away behind one line.
        const bad = addons.filter((a) => a.badge);
        const clean = addons.filter((a) => !a.badge);
        const addonRow = (a) => row(a.badge ? Masks.svg('malware') : ICON.check, a.badge, `${a.name}${a.enabled ? '' : ' (turned off)'}`,
          a.reasons.length ? a.reasons.map((x) => x.text).join(' ') : (a.notes[0] || (a.fromStore ? 'From the browser\'s add-on store.' : 'Nothing about it needs your attention.')),
          a.badge ? removal(b, a, short) : '');
        const sites = (p.notifications || []).slice().sort((x, y) => (rank[siteBadge(y)] || 0) - (rank[siteBadge(x)] || 0));
        const searchBadge = p.search ? worse(p.search.badge, siteBadge(p.search)) : null;
        flagged += bad.length + sites.filter(siteBadge).length + (searchBadge ? 1 : 0) + p.startup.filter(siteBadge).length;
        return `${b.profiles.length > 1 ? `<h3 class="u-mt">${esc(p.name)}</h3>` : ''}
          <h4 class="u-mt">Add-ons</h4>
          ${addons.length ? `${bad.length ? `<ul class="list">${bad.map(addonRow).join('')}</ul>` : ''}
            ${clean.length ? `<details class="group" data-clean-addons><summary><span>${clean.length}${bad.length ? ' more' : ''} add-on${clean.length === 1 ? '' : 's'}, nothing to look at</span><i></i></summary>
              <ul class="list">${clean.map(addonRow).join('')}</ul></details>` : ''}`
            : stateBlock('clear', 'No add-ons.', { small: true })}
          <h4 class="u-mt">Sites allowed to send notifications</h4>
          ${p.notifications === null ? stateBlock('unavailable', 'These could not be read.', { small: true })
            : sites.length ? `<ul class="list">${sites.map((s) => siteRow(s.origin.replace(/^https?:\/\//, ''), s, 'Can send you notifications')).join('')}</ul>
              <p class="muted u-mt-xs">Fake virus alerts and prize pop-ups arrive this way. To stop a site, remove it at ${copy(b.places.notifications)}</p>`
              : stateBlock('clear', 'No site may send notifications.', { small: true })}
          ${p.search ? `<h4 class="u-mt">Search engine</h4><ul class="list">${row(searchBadge ? Masks.svg('scam') : ICON.search, searchBadge, p.search.name || p.search.host || 'Custom',
            p.search.host && !p.search.known ? `${p.search.host} is not a search engine people know. Unwanted software changes your search to earn from what you look for.${p.search.verdict && p.search.verdict.badge ? ` ${p.search.verdict.label}.` : ''}` : `${p.search.engine || p.search.name || p.search.host || 'A search engine'} runs your searches.`,
            searchBadge ? `To choose your own, ${settings ? `open ${copy(settings)} and search its settings for "search engine"` : `go to ${copy(b.places.search)}`}` : '')}</ul>` : ''}
          ${p.startup.length ? `<h4 class="u-mt">Pages it opens on start</h4><ul class="list">${p.startup.map((s) => siteRow(s.url, s, 'Opens when the browser starts')).join('')}</ul>
            ${p.startup.some(siteBadge) ? `<p class="muted u-mt-xs">To change them, ${settings ? `open ${copy(settings)} and search its settings for "on startup"` : `go to ${copy(b.places.startup)}`}</p>` : ''}` : ''}`;
      }).join('');
      return `<div class="panel u-mt">
        <div class="panel__head"><div><h2>${esc(b.name)}</h2><p>${b.profiles.length} profile${b.profiles.length === 1 ? '' : 's'}</p></div>
          <button class="btn btn--sm" type="button" data-open-browser="${esc(b.open || b.id)}">Open ${esc(short)}</button></div>
        ${pol ? `<ul class="list">${row(pol.badge ? ICON.lock : ICON.shield, pol.badge, 'Policies on this computer', `${pol.text} Set: ${pol.names.slice(0, 8).join(', ')}${pol.names.length > 8 ? ', and more' : ''}.`,
          pol.badge ? `${short} lists them at ${copy(b.places.policies)} Removing them needs this computer's administrator; if nobody set them on purpose, ask someone you trust to help.` : '')}</ul>` : ''}
        ${profiles}
      </div>`;
    }).join('');

    const list = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0] || 'browser');
    const notChecked = (r.unchecked || []).length ? `<p class="muted">Not checked: ${esc(r.unchecked.join(', '))}. Sentinel cannot read ${r.unchecked.length === 1 ? 'its' : 'their'} settings yet.</p>` : '';
    out.innerHTML = r.browsers.length ? `<div class="panel u-mt">
        <h2>${flagged ? `${flagged} thing${flagged === 1 ? '' : 's'} to look at` : 'Nothing here needs your attention'}</h2>
        <p class="muted">Checked ${esc(ago(r.at))}. Sentinel changed nothing. Removing anything is your choice, in the browser, and you can add it back.${r.sitesChecked ? '' : ` Site addresses were not checked, so only add-ons, search engines and policies were judged. ${esc(r.sitesWhy || 'Sentinel could not reach its scanner just now.')}`}</p>
        ${notChecked}
      </div>${panels}`
      : `<div class="panel u-mt">${stateBlock('unavailable', `No ${esc(list(r.looked || []))} settings were found on this computer.`, { action: notChecked })}</div>`;

    $$('[data-copy-text]', out).forEach((btn) => btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(btn.dataset.copyText); toast('Copied. Paste it into the browser\'s address bar.', 'success'); }
      catch { toast('Could not copy. Type it into the browser\'s address bar instead.', 'error'); }
    }));
    $$('[data-open-browser]', out).forEach((btn) => btn.addEventListener('click', () => busy(btn, 'Opening', async () => {
      try { await desktop.openBrowser(btn.dataset.openBrowser); } catch (err) { toast(desktopError(err), 'error'); }
    })));
  }

  /* ===================================================== live protection */

  async function protectionView(el) {
    const f = plan().features;
    const us = usage();
    const planLocked = !f.liveScanning && !f.liveFast;

    const feature = (icon, name, body, status) => `<div class="feature">
      <div class="feature__top"><span class="feature__icon">${icon}</span>${status}</div>
      <h3>${name}</h3><p>${body}</p></div>`;
    const st = (on, lockedText) => (on ? '<span class="status is-on">On</span>' : `<span class="status is-locked">${lockedText}</span>`);

    const needsApp = !desktop;
    const lock = planLocked ? 'Pro & up' : needsApp ? 'Needs app' : null;
    // "On" only for what is running now: page warnings and search marks are live scanning's.
    const liveOn = Boolean(state.desktopInfo && state.desktopInfo.live && state.desktopInfo.live.enabled);

    el.innerHTML = `
      ${title('Live protection', 'Sentinel watching in real time: on search results, in your inbox and on every download.')}
      ${localNote()}
      ${planLocked ? lockedCard({ tag: 'Not in this plan', heading: 'Turn on live protection', body: 'Live scanning is not part of this plan.', actions: '<a class="btn btn--gold" href="/app/plan">See plans</a>' })
        : needsApp ? lockedCard({ tag: 'Unlocked by the Sentinel app', heading: 'Download Sentinel to switch these on', body: 'Your plan includes live protection. It runs through the Sentinel app on your computer, so it can watch downloads and draw its masks over your browser.', actions: `<a class="btn btn--gold" href="/download">${ICON.download}Download Sentinel</a>` })
        : ''}

      <div class="feature-grid">
        ${feature(Masks.svg('scam'), 'Page warnings', 'While a browser is in front, Sentinel checks the address of the page it shows and warns you before a dangerous one gets your details. No add-on.', st(!lock && liveOn, lock || 'Off'))}
        ${feature(ICON.search, 'Search result masks', `A line of light crosses the page when you search, then a mask appears beside every result. Google, Bing, DuckDuckGo, Brave, Yahoo, Ecosia and more.${f.liveResearch ? ' Every result is researched.' : ''}`, st(!lock && liveOn, lock || 'Off'))}
        ${feature(ICON.mail, 'Email masks', 'Gmail and Outlook on the web: the messages in your inbox list get a green mask or a warning mask before you open them. Sentinel reads only what the list shows (sender, subject, first line) and never opens a message.', f.emailLive && !planLocked ? '<span class="status">Optional add-on</span>' : st(false, 'Pro & up'))}
        ${feature(ICON.download, 'Download protection', 'Every new file in your Downloads folder is inspected on your computer.', st(!lock && desktop && state.desktopInfo && state.desktopInfo.downloads.active, lock || 'Off'))}
      </div>

      ${!planLocked ? `<div class="panel u-mt">
        <div class="panel__head"><div><h2>Live scanning this week</h2><p>Minutes only count when Sentinel actually checks something. Resets ${until(state.me.week.resetsAt)}.</p></div></div>
        <div class="meters">
          ${liveMeter('Fast', 'Answers in about a second. Threat lists, the checklist and comparison with known scams.', us.fastMinutes)}
          ${liveMeter('Delicate', 'Answers in about five seconds. Everything fast does, plus research on every result.', us.liveMinutes)}
        </div>
      </div>` : ''}

      <div data-desktop>${desktop && !planLocked ? '<div class="skeleton desktop-skeleton" aria-hidden="true"></div>' : ''}</div>
      <div class="panel u-mt" data-intel>
        <div class="panel__head"><div><h2>Threat intelligence</h2><p>The public feeds every scan is checked against, refreshed automatically.</p></div></div>
        <div class="skeleton u-h-sm"></div>
      </div>
      <p class="set-away u-mt"><a href="/app/settings#protection">Change what Sentinel watches in Settings</a></p>`;

    if (desktop && !planLocked) renderDesktopControls($('[data-desktop]', el));
    renderIntel($('[data-intel]', el));
  }

  /** One weekly allowance: used of limit, or "no weekly limit", or "not in this plan". */
  function liveMeter(name, what, m) {
    const none = !m || m.limit === 0;
    const free = m && uncapped(m.limit);
    const limit = none ? '' : free ? 'no weekly limit' : m.limit >= 60 ? `${m.limit / 60} h` : `${m.limit} min`;
    const used = none ? '' : m.limit !== null && m.limit < 60 ? `${m.used} min` : `${hours(m.used)} h`;
    return `<div class="meters__item${none ? ' is-off' : ''}">
      <div class="meters__head"><b>${name}</b><span class="mono tabular">${none ? 'Pro and up' : `${used} <span class="muted">/ ${limit}</span>`}</span></div>
      <div class="meter${free ? ' is-uncapped' : ''}"><i style="width:${none ? 0 : free ? 100 : Math.min(100, (m.used / m.limit) * 100)}%"></i></div>
      <p>${what}</p></div>`;
  }

  async function renderIntel(slot) {
    try {
      const s = await api('/threat-stats');
      const names = { openphish: 'OpenPhish', urlhaus: 'URLhaus', phishing_database: 'Phishing.Database' };
      $('.skeleton', slot).outerHTML = `<div class="intel">
        <div class="intel__total"><b class="tabular">${s.trackedThreats.toLocaleString()}</b><span>known threats tracked &middot; ${s.checks} checks per scan</span></div>
        <ul class="list">${s.feeds.map((f) => `<li>
          <span class="status ${f.ok ? 'is-on' : ''}"></span>
          <span class="list__main"><b>${esc(names[f.source] || f.source)}</b><span>${f.entries.toLocaleString()} entries &middot; ${f.fetchedAt ? `updated ${ago(f.fetchedAt)}` : 'not fetched yet'}</span></span>
        </li>`).join('')}</ul>
      </div>`;
    } catch (err) {
      const wait = $('.skeleton', slot);
      const box = document.createElement('div');
      wait.replaceWith(box);
      failed(box, err, () => { box.outerHTML = '<div class="skeleton u-h-sm"></div>'; renderIntel(slot); }, { small: true, what: 'The status of the threat lists' });
    }
  }

  /**
   * Parent lock: a PIN before protection can be switched off or Sentinel quit. The PIN is checked by the app on this
   * computer (desktop/src/parentlock.js); only a salted hash of it is kept. Drawn into its own slot, since it changes
   * on its own (it locks again five minutes after the PIN opens it).
   */
  async function renderParentLock(slot) {
    if (!slot || !desktop || !desktop.lockStatus) return;
    let s;
    try { s = await desktop.lockStatus(); } catch { slot.innerHTML = '<p class="set-why">The Sentinel app did not answer. Open this page again.</p>'; return; }
    if (!slot.isConnected) return;
    if (!s.supported) { slot.innerHTML = '<p class="set-why">Needs Windows.</p>'; return; }
    clearTimeout(slot._relock);
    const pinInput = (name, label, auto) => `<div class="field"><label for="pl-${name}">${label}</label><input class="input code-input" id="pl-${name}" name="${name}" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" autocomplete="${auto}" required></div>`;
    // Sentinel is installed for one Windows account, and that account can uninstall it, administrator or not.
    const adminNote = `<p class="field__hint">The lock stops protection being switched off inside Sentinel. Whoever uses this Windows account can still uninstall Sentinel from Windows Settings${s.admin ? ', and this account is an administrator, so it can change anything on the computer' : ''}. If Sentinel stops without the PIN, the record says when.</p>`;
    const newPin = (button) => `<form data-pl-set class="u-mt-sm">${pinInput('pin', 'New PIN, 4 to 8 digits', 'new-password')}${pinInput('again', 'The same PIN again', 'new-password')}<button class="btn btn--gold u-mt-sm" type="submit">${button}</button></form>`;
    const when = (at) => new Date(at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' });
    const record = s.record || [];
    const recordList = `<h3 class="u-mt">Record</h3>
        <p class="field__hint">Times and switches only. Nothing about a chat or a page is ever written here.</p>
        ${record.length ? `<ul class="list">${record.slice(0, 10).map((r) => `<li><span class="list__icon">${ICON.shield}</span><span class="list__main"><b>${esc(r.text)}${r.times > 1 ? ` (${r.times} times)` : ''}</b><span>${esc(when(r.at))}</span></span></li>`).join('')}</ul>` : stateBlock('waiting', 'Nothing yet.', { small: true })}`;
    const minutes = (n) => (n >= 60 ? `${Math.ceil(n / 60)} minute${Math.ceil(n / 60) === 1 ? '' : 's'}` : `${n} second${n === 1 ? '' : 's'}`);
    let body;
    if (!s.set) {
      // With no PIN the record stays readable: a PIN removed with an administrator's approval is written there.
      body = `<p class="muted u-mt-sm">Off.</p>${newPin('Lock with this PIN')}${adminNote}${record.length ? recordList : ''}`;
    } else if (s.locked) {
      const wait = s.waitSeconds > 0;
      body = `<p class="muted u-mt-sm">On. Switching protection off, or quitting Sentinel, needs the PIN.${wait ? ` Too many wrong PINs: try again in <span data-pl-wait>${minutes(s.waitSeconds)}</span>.` : ''}</p>
        <form data-pl-unlock class="u-mt-sm">${pinInput('pin', 'PIN', 'current-password')}<button class="btn u-mt-sm" type="submit" ${wait ? 'disabled' : ''}>Unlock for 5 minutes</button></form>
        <p class="field__hint">Forgot the PIN? <button class="btn btn--ghost btn--sm" type="button" data-pl-reset>Remove it with a Windows administrator</button></p>${adminNote}`;
      // The wait counts down, and the button comes back by itself when it ends.
      if (wait) {
        const ends = Date.now() + s.waitSeconds * 1000;
        const tick = () => {
          if (!slot.isConnected) return;
          const left = Math.ceil((ends - Date.now()) / 1000);
          if (left <= 0) { renderParentLock(slot); return; }
          const el = $('[data-pl-wait]', slot);
          if (el) el.textContent = minutes(left);
          slot._relock = setTimeout(tick, 1000);
        };
        slot._relock = setTimeout(tick, 1000);
      }
    } else {
      body = `<p class="muted u-mt-sm">Open until ${esc(new Date(s.unlockedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}, then it locks again by itself. Change what you need now, in this page or in the tray menu.</p>
        <div class="actions__btns u-mt-sm"><button class="btn btn--gold btn--sm" type="button" data-pl-relock>Lock now</button><button class="btn btn--sm" type="button" data-pl-remove>Turn off parent lock</button></div>
        ${newPin('Change the PIN')}
        ${recordList}`;
      slot._relock = setTimeout(() => { if (slot.isConnected) renderParentLock(slot); }, Math.max(1000, s.unlockedUntil - Date.now() + 1000));
    }
    slot.innerHTML = body;

    const act = (el, fn, done) => el && el.addEventListener(el.tagName === 'FORM' ? 'submit' : 'click', async (ev) => {
      ev.preventDefault();
      const btn = el.tagName === 'FORM' ? $('button[type=submit]', el) : el;
      btn.disabled = true;
      try { await fn(); if (done) toast(done, 'success'); } catch (err) { toast(desktopError(err), 'error'); }
      renderParentLock(slot);
    });
    act($('[data-pl-set]', slot), async () => {
      const f = $('[data-pl-set]', slot);
      if (f.pin.value !== f.again.value) throw new Error('The two PINs are not the same.');
      await desktop.lockSet(f.pin.value);
    }, s.set ? 'The PIN is changed.' : 'Parent lock is on. Keep the PIN somewhere a child will not find it.');
    act($('[data-pl-unlock]', slot), () => desktop.lockUnlock($('[data-pl-unlock]', slot).pin.value), 'Unlocked for 5 minutes.');
    act($('[data-pl-relock]', slot), () => desktop.lockRelock(), 'Locked.');
    act($('[data-pl-remove]', slot), () => desktop.lockRemove(), 'Parent lock is off.');
    act($('[data-pl-reset]', slot), () => desktop.lockReset(), 'The PIN was removed. Set a new one to lock again.');
    // Opened from a refused tray click: straight to the PIN (Settings scrolls the row into view).
    if (location.hash === '#parent-lock' && !slot._scrolled) { slot._scrolled = true; const pin = $('input', slot); if (pin) pin.focus({ preventScroll: true }); }
  }
  // The switch says on either way: when the reader is not running, that is the first thing said.
  function readerDown(status, what) {
    if (status.reader === 'restarting') return `Paused for a moment and starting again. For now ${what} not being watched.`;
    if (status.reader === 'stopped') return `Sentinel cannot read chat on this computer right now, so ${what} not being watched. It keeps trying by itself.`;
    return '';
  }
  // What chat safety is doing right now, in numbers only: proof that it works, without a word of anyone's chat.
  function chatSeenText(cs) {
    if (!cs.enabled) return 'Off. Turn it on, then open Roblox or the Discord app.';
    const down = readerDown(cs, 'Roblox and Discord are');
    if (down) return down;
    const s = cs.seen || {};
    const name = { discord: 'Discord', roblox: 'Roblox' }[s.app];
    const now = s.blind ? `${name} is in front, but Windows shows Sentinel only a black picture of it, so Sentinel cannot see its chat. Playing in a window may help.` : name ? (s.reading ? `Watching ${name} now.` : `${name} is in front, but its chat cannot be read yet.`) : 'On. It starts watching when Roblox or the Discord app is in front.';
    const d = (s.discord && s.discord.checked) || 0, r = (s.roblox && s.roblox.checked) || 0;
    const f = ((s.discord && s.discord.flagged) || 0) + ((s.roblox && s.roblox.flagged) || 0);
    if (!d && !r) return now;
    return `${now} Since Sentinel started: ${d} message${d === 1 ? '' : 's'} checked in Discord, ${r} in Roblox, ${f} flagged.`;
  }
  // What Check my texts is doing right now, in numbers only.
  function textSeenText(ts) {
    if (!ts.enabled) return 'Off. Turn it on, then open a conversation in Phone Link.';
    const down = readerDown(ts, 'texts in Phone Link are');
    if (down) return down;
    const s = ts.seen || {};
    const now = s.blind ? 'Phone Link is in front, but Windows shows Sentinel only a black picture of it, so Sentinel cannot see its texts.' : s.app === 'phonelink' ? (s.reading ? 'Checking Phone Link now.' : s.otherTab ? 'Phone Link is in front. Texts are checked on its Messages tab.' : 'Phone Link is in front, but its texts cannot be read yet.') : 'On. It starts checking when Phone Link is in front.';
    const n = s.checked || 0, f = s.flagged || 0;
    const u = s.unchecked || 0;
    const missed = u ? ` ${u} link${u === 1 ? '' : 's'} in texts could not be checked against the threat lists: ${String(s.why || "Sentinel's scanner could not be reached").replace(/\.$/, '')}. The words were still checked.` : '';
    if (!n) return now + missed;
    return `${now} Since Sentinel started: ${n} text${n === 1 ? '' : 's'} checked, ${f} flagged.${missed}`;
  }
  const CHAT_ON = 'Chat safety is on. Open Roblox or Discord and Sentinel watches their chat.';
  const EXPOSURE_ON = 'Exposure alerts are on. Sentinel will tell you if a site you visit is listed later.';

  /*
   * "New in Sentinel" cards: asked once, in the Windows app, before a feature ever reads anything. What it does, then
   * Turn on or Not now. The answer (or switching the feature in Settings) is kept in local storage as
   * sentinel:asked:<name>, never sent anywhere. Before 1.12.1 the keys were sentinel.chatAsked and
   * sentinel.exposureAsked; they are moved over once.
   */
  const ASKED = { chat: ['sentinel:asked:chat', 'sentinel.chatAsked'], exposure: ['sentinel:asked:exposure', 'sentinel.exposureAsked'] };
  function asked(name) {
    const [key, old] = ASKED[name];
    try {
      if (localStorage.getItem(old)) { localStorage.setItem(key, '1'); localStorage.removeItem(old); }
      return Boolean(localStorage.getItem(key));
    } catch { return true; }   // storage cannot be used: never ask, rather than ask every time
  }
  function markAsked(name) { try { localStorage.setItem(ASKED[name][0], '1'); } catch { /* not stored */ } }
  function askOnce(slot, { name, title: heading, body, yes, onYes, howHref }) {
    slot.innerHTML = `<div class="locked u-mt">
      <div><span class="locked__tag">${ICON.shield}New in Sentinel</span><h3>${heading}</h3><p>${body}</p></div>
      <div class="locked__actions"><button class="btn btn--gold" data-ask-yes>${yes}</button><button class="btn" data-ask-no>Not now</button><a class="btn btn--ghost" href="${howHref}">How it works</a></div>
    </div>`;
    const done = () => { markAsked(name); slot.innerHTML = ''; };
    $('[data-ask-no]', slot).addEventListener('click', done);
    $('[data-ask-yes]', slot).addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      try { await onYes(); done(); }
      catch (err) { ev.target.disabled = false; toast(desktopError(err), 'error'); }
    });
  }

  async function askChatSafety(slot, again) {
    if (!slot || !desktop || !desktop.setChatSafety || asked('chat')) return;
    let info = state.desktopInfo;
    try { if (!info) info = state.desktopInfo = await desktop.info(); } catch (err) {
      failed(slot, { message: desktopError(err) }, again || (() => askChatSafety(slot)), { small: true, quiet: true, what: 'The Sentinel app did not answer, so its suggestions are not shown.' });
      return;
    }
    if (!info.chatSafety || !info.chatSafety.supported || info.chatSafety.enabled || !slot.isConnected) return;
    askOnce(slot, {
      name: 'chat', title: 'Chat safety for Roblox and Discord', yes: 'Turn on chat safety', howHref: '/app/settings#chat-safety',
      body: 'Sentinel can point out scams and people who may not be safe to talk to, right beside the message, while Roblox or the Discord app is in front. It reads chat on this computer only and keeps nothing; a badge shows while it watches, and in a Roblox game only when you press Esc. Turn it on for yourself, or for a child who uses this computer.',
      onYes: async () => { await desktop.setChatSafety(true); toast(CHAT_ON, 'success'); }
    });
  }
  /* Exposure alerts: sites visited in the last 14 days that a threat list named afterwards (server/lib/scan/exposure.js). */
  const EXPOSURE_WHAT = { phishing: 'Fake sign-in page', crypto: 'Crypto scam', scam: 'Scam site', malware: 'Spreads malware' };
  // The password and scan steps are the shared ones (steps.js), the same words as the recovery guide's.
  function exposureSteps(e) {
    const S = window.SentinelSteps.text;
    if (e.kind === 'phishing') return `Signed in or typed a password there? ${esc(S.password)}${e.realSite ? ` The real site is <b>${esc(e.realSite)}</b>.` : ''} Then look for sign-ins or changes you do not recognise.`;
    if (e.kind === 'crypto') return 'If you connected a wallet or signed anything there, remove that site\'s permissions in your wallet and move what is left to a new wallet. Never type a recovery phrase into any site.';
    if (e.kind === 'malware') return `If you downloaded or opened anything from it, check that day's downloads now. Ran a program from it? ${esc(S.scan)}`;
    return 'If you paid or gave card details there, call your bank or card company on the number printed on your card and ask about a refund. Watch your statements for charges you did not make.';
  }
  // What to tick in the recovery guide for each kind of listing.
  const EXPOSURE_HAPPENED = { phishing: 'password', crypto: 'crypto', malware: 'file', scam: 'card' };
  function exposureItem(e) {
    // The day is the visit's own calendar day, where the person was, kept as midnight UTC (exposure.js remember).
    const day = new Date(e.visitedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
    const malware = e.kind === 'malware';
    return `<li class="exposure">
      <span class="list__icon" style="color:${esc(color(malware ? 'red' : 'orange'))}">${Masks.svg(malware ? 'malware' : 'scam')}</span>
      <span class="list__main"><b>${esc(e.host)}</b><span>${esc(EXPOSURE_WHAT[e.kind] || 'Listed')} &middot; you visited it on ${esc(day)}, and ${e.page ? 'a page on this site was listed' : 'a threat list named it'} ${esc(ago(e.listedAt))}.</span>
        <span>${exposureSteps(e)}</span>
        <span>Already paid or let someone in? <a href="/app/recover?happened=${EXPOSURE_HAPPENED[e.kind] || 'card'}">Open the recovery guide</a></span>
        <span class="exposure__actions">
          ${malware && desktop.checkDownloadsFrom ? `<button class="btn btn--sm btn--gold" data-exposure-downloads="${esc(String(e.visitedAt))}">Check that day&rsquo;s downloads</button>` : ''}
          ${e.realSite ? `<a class="btn btn--sm btn--gold" href="https://${esc(e.realSite)}/" target="_blank" rel="noopener noreferrer">Go to ${esc(e.realSite)}</a>` : ''}
          <button class="btn btn--sm" data-exposure-done="${esc(e.host)}">Done</button>
        </span></span>
    </li>`;
  }
  function exposurePanel(info, items) {
    if (!desktop || !desktop.setExposureAlerts) return '';
    const on = Boolean(info && info.exposureAlerts);
    const supported = Boolean(info && info.live && info.live.supported);
    // Sites are remembered only while live scanning runs: with it off, "nothing so far" would be no news at all.
    const empty = !supported ? 'Available on Windows, with live scanning.'
      : !on ? 'Off. Nothing about the sites you visit is remembered. <a href="/app/settings#exposure-alerts">Turn on exposure alerts in Settings</a>.'
        : !(info.live && info.live.enabled) ? 'On, but live scanning is off, so no sites are being remembered. Start scanning to use exposure alerts.'
          : 'Nothing so far. None of the sites you visited in the last 14 days has been put on a threat list since.';
    return `<div class="panel u-mt" id="exposures">
      <div class="panel__head"><div><h2>Exposure alerts</h2>
        <p>Sites you visited that a threat list named afterwards, with what to do.</p></div></div>
      ${items.length ? `<ul class="list">${items.map(exposureItem).join('')}</ul>`
        : `<p class="muted u-mt-sm">${empty}</p>`}
    </div>`;
  }
  function bindExposures(slot) {
    $$('[data-exposure-done]', slot).forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await desktop.dismissExposure(b.dataset.exposureDone); renderDesktopControls(slot); }
      catch (err) { b.disabled = false; toast(desktopError(err), 'error'); }
    }));
    $$('[data-exposure-downloads]', slot).forEach((b) => b.addEventListener('click', () => busy(b, 'Checking', async () => {
      try {
        const r = await desktop.checkDownloadsFrom(Number(b.dataset.exposureDownloads));
        const files = (n) => `${n} file${n === 1 ? '' : 's'}`;
        toast(!r.checked ? 'Nothing arrived in Downloads around that day.'
          : r.flagged ? `${r.flagged} of ${files(r.checked)} from that day ${r.flagged === 1 ? 'was' : 'were'} flagged. See the Defense log.`
            : `${files(r.checked)} from that day checked. None was flagged.`, r.flagged ? 'error' : 'success');
      } catch (err) { toast(desktopError(err), 'error'); }
      renderDesktopControls(slot);
    })));
    if (desktop.onExposures) slot._off.push(desktop.onExposures(() => { if (slot.isConnected) renderDesktopControls(slot); }));
  }
  // Asked once, in the Windows app, once live scanning is in use: what exposure alerts do, then Turn on or Not now.
  async function askExposureAlerts(slot) {
    if (!slot || !desktop || !desktop.setExposureAlerts || asked('exposure')) return;
    let info = state.desktopInfo;
    try { if (!info) info = state.desktopInfo = await desktop.info(); } catch { return; }
    // The card promises "on this computer only", which holds only with the app's own server.
    if (info.exposureAlerts || !info.embeddedServer || !info.live || !info.live.supported || !info.live.enabled || !slot.isConnected) return;
    askOnce(slot, {
      name: 'exposure', title: 'Hear about it if a site you visited turns out to be a scam', yes: 'Turn on exposure alerts', howHref: '/app/settings#exposure-alerts',
      body: 'Scam pages often reach the threat lists a day or two after they go up. Sentinel can remember the sites live scanning found safe for 14 days, on this computer only and as scrambled codes, and tell you if a list names one of them later, with what to change.',
      onYes: async () => { await desktop.setExposureAlerts(true); toast(EXPOSURE_ON, 'success'); }
    });
  }

  /*
   * The first-run step: once on this device, the first time home opens, a few of Settings' own rows in one calm panel,
   * so the main choices are made in the first minute. It is a view of Settings, not a copy: each row is drawn and saved
   * by its SETTINGS entry, so a choice made here works at once and is the same choice there. Each slot below takes the
   * first of its ids that has a row; a row that cannot work here (its why) is left out. Hooks for rows built elsewhere:
   *   'accent'      the accent colours (work/e2e-c-design); 'theme' (light or dark) stands in until it lands
   *   'motion'      Full, Calm or Off (work/e2e-c-motion)
   *   'warn-level'  how loud Sentinel is (work/e2e-c-quiet)
   * Done, or Escape, keeps what is chosen, and the step never comes back. Storage that cannot be used: never shown.
   */
  const FIRST_CHOICES = [['accent', 'theme'], ['motion'], ['warn-level'], ['text-size']];
  const FIRST_KEY = 'sentinel:first-choices';
  function firstChoices(slot) {
    try { if (localStorage.getItem(FIRST_KEY)) return false; } catch { return false; }
    const rows = FIRST_CHOICES.map((ids) => ids.map((id) => SETTINGS.find((r) => r.id === id)).find(Boolean)).filter(Boolean);
    if (!rows.length) return false;
    slot.innerHTML = `<section class="first" aria-labelledby="first-h"><div class="first__fold"><div class="first__in">
      <h2 id="first-h">Make Sentinel yours</h2>
      <p class="first__lead">Each choice works the moment you make it, and every one of them is in Settings too.</p>
      <div class="first__rows">${rows.map(rowHTML).join('')}</div>
      <div class="first__end">${desktop ? '<p>Closing this window leaves Sentinel running in the tray. Right-click the mask there to quit.</p>' : ''}
        <a class="btn btn--ghost" href="/app/settings#look">All settings</a><button class="btn btn--gold" type="button" data-first-done>Done</button></div>
    </div></div></section>`;
    const box = $('.first', slot);
    const ctx = { info: state.desktopInfo, ready: !desktop || Boolean(state.desktopInfo), data: { mine: [] }, offs: [], draw, refresh };
    function draw() {
      if (!box.isConnected) return;
      for (const r of rows) {
        const row = $(`[data-set-row="${r.id}"]`, box);
        if (r.app && !ctx.ready) continue;
        row.hidden = Boolean(r.why && r.why(ctx.info));
        if (!row.hidden) paintRow(r, row, ctx);
      }
    }
    async function refresh() {
      if (desktop) { try { ctx.info = state.desktopInfo = await desktop.info(); } catch { /* an app row says the app did not answer */ } ctx.ready = true; }
      draw();
    }
    if (rows.some((r) => r.app) && !ctx.ready) refresh(); else draw();

    // Done folds the panel away (a height spring, as a Settings row leaves a search); with motion off it simply goes.
    const done = () => {
      try { localStorage.setItem(FIRST_KEY, '1'); } catch { /* asked again next time: nothing lost */ }
      const back = box.contains(document.activeElement);
      const gone = () => { slot.innerHTML = ''; if (back) { const q = $('[data-quick] input'); if (q) q.focus({ preventScroll: true }); } };
      if (still()) { gone(); return; }
      box.addEventListener('transitionend', (ev) => { if (ev.target === box) gone(); });
      setTimeout(gone, 800);   // a transition that never ends (a hidden tab) still leaves
      box.classList.add('is-out');
      box.inert = true;
    };
    $('[data-first-done]', box).addEventListener('click', done);
    box.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); done(); } });
    return true;
  }

  // Most in need of the person first: flagged, then the files Sentinel could not stand behind.
  const downloadRank = (d) => (d.badge && !d.quarantined ? 3 : d.looked === 'none' ? 2 : d.looked === 'part' ? 1 : 0);

  function downloadRow(d) {
    const said = d.badge ? `${esc(d.label)}${d.reason ? ` &middot; ${esc(d.reason)}` : ''}` : esc(d.looked === 'all' ? d.label : d.reason);
    const end = d.quarantined ? '<span class="status">Quarantined</span>'
      : d.badge ? `<button class="btn btn--sm" data-quarantine="${esc(d.id)}">Quarantine</button>`
        : d.looked === 'all' ? '<span class="status is-on">Checked</span>'
          : d.looked === 'part' ? '<span class="status is-locked">Partly checked</span>' : '<span class="status">Not checked</span>';
    // The file as Sentinel read it, lit where it read, a sliver at least. Beside the words, never instead of them.
    const lit = d.looked === 'none' ? 0 : Math.max(4, d.read * 50);
    return `<li>
          <span class="list__icon">${ICON.file}</span>
          <span class="list__main"><b>${esc(d.name)}</b><span>${bytes(d.size)} &middot; ${ago(d.scannedAt)} &middot; ${said}</span></span>
          <span class="dl-end"><span class="read-strip read-strip--${d.badge ? 'flag' : esc(d.looked)}" style="--end:${lit.toFixed(1)}%" aria-hidden="true"></span>${end}</span>
        </li>`;
  }

  async function renderDesktopControls(slot) {
    let info;
    try { info = await desktop.info(); } catch { return; }
    state.desktopInfo = info;
    let recent = [];
    try { recent = await desktop.recentDownloads(); } catch { /* none */ }

    const live = info.live || { supported: false, active: false, enabled: false, reason: 'Not available' };
    let ledger = [];
    try { ledger = (await desktop.defense()).ledger || []; } catch { /* none */ }
    let exposures = [];
    try { if (desktop.exposures) exposures = await desktop.exposures(); } catch { /* none */ }
    // Left the page while waiting: subscribing now would leave listeners behind that nothing ever removes.
    if (!slot.isConnected) return;
    const browsers = (info.browsers && info.browsers.installed) || [];
    const running = new Set((info.browsers && info.browsers.running) || []);

    (slot._off || []).forEach((off) => off());
    slot._off = [];
    const active = slot.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active ? ['liveToggle', 'scanWith', 'restore', 'quarantine'].find((k) => k in active.dataset) : null;
    const focusValue = focusKey ? active.dataset[focusKey] : null;
    const fellBack = live.fellBack === 'delicate_hours_used' ? ' Delicate hours for this week are used up, so results are coming from fast scanning.' : '';
    const liveText = !live.supported ? 'Live scanning is available on Windows.'
      : live.active ? (live.window ? `Watching the browser in front. Look for the island in its bottom right corner.${live.lastResults ? ` Last search: ${live.lastResults.count} results marked.` : ''}${fellBack}` : 'Ready. It starts by itself whenever a browser is in front, and rests when none is.')
        : live.enabled ? (live.reason || 'Starting') : 'Off. One click, and every browser you use is covered.';
    slot.innerHTML = `
      <div class="panel live u-mt">
        <div class="live__main">
          <span class="live__mask${live.active ? ' is-on' : ''}" aria-hidden="true">${Masks.svg('scam')}</span>
          <div class="live__text"><h2>Live scanning</h2><p data-live-text>${esc(liveText)}</p>${live.counts && live.counts.checked ? `<p class="live__counts" data-live-counts>${live.counts.checked.toLocaleString()} checked since Sentinel started, ${live.counts.flagged.toLocaleString()} flagged. Private windows are not counted.</p>` : '<p class="live__counts" data-live-counts hidden></p>'}</div>
          <button class="btn ${live.enabled ? '' : 'btn--gold'} live__button" data-live-toggle ${live.supported ? '' : 'disabled'}>${live.enabled ? 'Stop scanning' : 'Start scanning'}</button>
        </div>
        <ul class="live__facts">
          <li><b>Fast</b> marks results about a second after you search. <b>Delicate</b> also looks up how old each site is and whether it resolves, and takes about five seconds. Neither opens a suspicious page from this computer.</li>
          <li>Only the browser in front, and only while you are using it. Minimised, in the background or closed: nothing is read and no live time is spent.</li>
          <li>Private windows are protected the same way, and nothing about them is kept: no history, no log, no entry below.</li>
          <li>Sentinel reads addresses, never what a page says or what you type.</li>
        </ul>
      </div>

        <div class="panel u-mt">
          <div class="panel__head"><div><h2>Your browsers</h2><p>Pick one. Sentinel opens it if it is closed, brings it to the front, and starts scanning.</p></div></div>
          ${browsers.length ? `<ul class="list">${browsers.map((b) => `<li>
            <span class="list__icon">${ICON.globe}</span>
            <span class="list__main"><b>${esc(b.name)}</b><span data-browser-state="${esc(b.id)}">${running.has(b.id) ? 'Open now' : 'Installed'}</span></span>
            <button class="btn btn--sm btn--gold" data-scan-with="${esc(b.id)}" ${live.supported ? '' : 'disabled'}>Scan with ${esc(b.name.replace(/^(Google|Microsoft|Mozilla) /, ''))}</button>
          </li>`).join('')}</ul>` : stateBlock('unavailable', 'No supported browser found on this computer.')}
        </div>

      ${exposurePanel(info, exposures)}

      <div class="grid2 u-mt">
        <div class="panel">
          <div class="panel__head"><div><h2>Live, right now</h2><p>${live.active ? 'Pages show up here as they are checked. Private windows never do.' : 'Start scanning to see pages as they are checked.'}</p></div><span class="live-dot${live.active ? ' is-on' : ''}" aria-hidden="true"></span></div>
          <ul class="list feed" data-feed>${live.current && live.current.url ? `<li class="feed__item"><span class="list__icon">${ICON.globe}</span><span class="list__main"><b>${esc(live.current.url)}</b><span>In front now</span></span></li>` : '<li class="feed__empty muted">Nothing checked yet. Open a page in your browser.</li>'}</ul>
        </div>
        <div class="panel" id="defense">
          <div class="panel__head"><div><h2>Defense log</h2><p>What arrived, what was scanned, what was stopped.</p></div></div>
          ${ledger.length ? `<ul class="list">${ledger.slice(0, 8).map((e) => `<li>
            <span class="list__icon" style="${e.kind === 'threat' ? 'color:var(--red)' : e.kind === 'suspect' ? 'color:var(--orange)' : e.kind === 'restored' ? 'color:var(--gold-300)' : ''}">${ICON.file}</span>
            <span class="list__main"><b>${esc(e.name || e.path || '')}</b><span>${ago(e.at)} &middot; ${esc(e.kind === 'threat' ? `${e.label}: ${(e.actions || []).map((a) => a.did).join(', ')}` : e.kind === 'suspect' ? `${e.label}: runs at startup; nothing was changed. Quarantine it if you do not recognise it.` : e.kind === 'restored' ? 'Put back' : e.kind === 'noted' ? `${e.label}: ${e.signedBy ? `signed by ${e.signedBy}, ` : ''}noted, nothing touched` : `Clean (${e.how || 'scanned'})`)}</span></span>
            ${e.kind === 'threat' && !e.restored && (e.quarantined || (e.actions || []).some((a) => a.undo)) ? `<button class="btn btn--sm" data-restore="${esc(e.id)}">Put back</button>` : ''}
            ${e.kind === 'suspect' ? `<button class="btn btn--sm" data-suspect="${esc(e.id)}">Quarantine</button>` : ''}
          </li>`).join('')}</ul>` : stateBlock('waiting', 'Nothing yet. Each file Sentinel scans, and anything it stops, is listed here.')}
        </div>
      </div>

      <div class="panel u-mt" id="downloads">
        <h2 class="u-mb">Recent downloads</h2>
        ${recent.length ? `<ul class="list">${[...recent].sort((a, b) => downloadRank(b) - downloadRank(a)).slice(0, 8).map(downloadRow).join('')}</ul>` : stateBlock('waiting', 'New downloads will appear here once they are scanned.')}
      </div>`;

    if (focusKey) {
      const again = $$(`[data-${focusKey.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`, slot).find((el2) => el2.dataset[focusKey] === focusValue);
      if (again) again.focus({ preventScroll: true });
    }
    // Opened from a notification (a dangerous download, an exposure, a swapped wallet address): straight to its part, once.
    for (const id of ['downloads', 'exposures', 'defense']) {
      if (location.hash !== `#${id}` || state[`scrolledTo${id}`]) continue;
      state[`scrolledTo${id}`] = true;
      const part = $(`#${id}`, slot);
      if (part) part.scrollIntoView({ block: 'start' });
    }
    bindExposures(slot);
    $$('[data-suspect]', slot).forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await desktop.quarantineSuspect(b.dataset.suspect); toast('Quarantined. You can put it back from here.', 'success'); renderDesktopControls(slot); }
      catch (err) { b.disabled = false; toast(desktopError(err), 'error'); }
    }));
    $$('[data-restore]', slot).forEach((b) => b.addEventListener('click', async () => {
      try { await desktop.restoreQuarantined(b.dataset.restore); toast('Put back as it was.', 'success'); renderDesktopControls(slot); }
      catch (err) { toast(desktopError(err), 'error'); }
    }));
    // The live feed fills in as the desktop checks pages.
    const feed = $('[data-feed]', slot);
    if (feed && desktop.onPageChecked) {
      slot._off.push(desktop.onPageChecked((item) => {
        if (!feed.isConnected) return;
        feed.querySelector('.feed__empty')?.remove();
        const li = h(`<li class="feed__item is-new"><span class="list__icon" style="color:${esc(color(item.badge))}">${item.badge ? Masks.svg('scam') : ICON.check}</span><span class="list__main"><b>${esc(item.host)}</b><span>${esc(item.label)} &middot; ${esc(item.browser)}</span></span></li>`);
        feed.prepend(li);
        requestAnimationFrame(() => li.classList.remove('is-new'));
        while (feed.children.length > 8) feed.lastElementChild.remove();
      }));
    }
    const toggle = $('[data-live-toggle]', slot);
    if (toggle && !toggle.disabled) toggle.addEventListener('click', () => busy(toggle, live.enabled ? 'Stopping' : 'Starting', async () => {
      try {
        const s2 = live.enabled ? await desktop.liveStop() : await desktop.liveStart();
        if (!live.enabled && !s2.active) toast(s2.reason || 'Live scanning could not start.', 'error');
      } catch (err) { toast(desktopError(err), 'error'); }
      renderDesktopControls(slot);
    }));
    $$('[data-scan-with]', slot).forEach((b) => b.addEventListener('click', () => busy(b, 'Opening', async () => {
      try {
        const r = await desktop.scanWith(b.dataset.scanWith);
        if (!r.ok) toast(r.reason || 'Live scanning could not start.', 'error');
        else toast(`${r.name} is ${r.launched ? 'opening' : 'in front'}. Sentinel is scanning it.`, 'success');
      } catch (err) { toast(desktopError(err), 'error'); }
      renderDesktopControls(slot);
    })));
    if (desktop.onLive) {
      slot._off.push(desktop.onLive((s2) => {
        if (!slot.isConnected) return;
        if (state.desktopInfo) state.desktopInfo.live = s2;
        // Only the words and the mask change while it runs; a full redraw would steal focus from the buttons.
        const text = $('[data-live-text]', slot);
        const mask = $('.live__mask', slot);
        if (mask) mask.classList.toggle('is-on', Boolean(s2.active));
        const counts = $('[data-live-counts]', slot);
        if (counts && s2.counts && s2.counts.checked) { counts.hidden = false; counts.textContent = `${s2.counts.checked.toLocaleString()} checked since Sentinel started, ${s2.counts.flagged.toLocaleString()} flagged. Private windows are not counted.`; }
        if (text && s2.active) text.textContent = s2.window ? 'Watching the browser in front. Look for the island in its bottom right corner.' : 'Ready. It starts by itself whenever a browser is in front, and rests when none is.';
        else if (text && s2.reason) text.textContent = s2.reason;
      }));
    }
    if (desktop.onBrowsers) {
      slot._off.push(desktop.onBrowsers((b2) => {
        if (!slot.isConnected) return;
        const open = new Set(b2.running || []);
        $$('[data-browser-state]', slot).forEach((el2) => { el2.textContent = open.has(el2.dataset.browserState) ? 'Open now' : 'Installed'; });
      }));
    }
    // The defense row, the update row and the downloads list redraw when the desktop says something changed.
    for (const name of ['onDefense', 'onUpdate', 'onDownloadThreat', 'onSettings']) {
      if (desktop[name]) slot._off.push(desktop[name](() => { if (slot.isConnected) renderDesktopControls(slot); }));
    }
    $$('[data-quarantine]', slot).forEach((b) => b.addEventListener('click', async () => {
      try {
        await desktop.quarantine(b.dataset.quarantine);
        toast('File moved to quarantine.', 'success');
        renderDesktopControls(slot);
      } catch (err) { toast(desktopError(err), 'error'); }
    }));
  }

  /* ================================================================ plan */

  /** The plan comparison is only on this page, so only this page loads it. */
  const planbook = () => (window.SentinelPlanbook ? Promise.resolve() : new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/assets/js/planbook.js';
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  }));

  async function planView(el) {
    const us = usage();
    const { billingMode } = state.config;
    const demo = billingMode === 'demo';
    el.innerHTML = `
      ${title('Plan &amp; usage', `You are on <b>${esc(plan().name)}</b>. Weekly allowances reset ${until(state.me.week.resetsAt)}.`)}
      ${demo ? '<div class="banner"><div><b>Demo billing.</b> Plan changes are instant and free on this server. No payment is taken.</div></div>' : ''}
      <div class="usage-list">
        ${scanCards(us)}
        ${usageCard(ICON.shield, left('fileScans'), `/ ${us.fileScans.limit}`, 'Virus & malware scans left', us.fileScans.used, us.fileScans.limit)}
        ${liveCard(us, plan().features)}
      </div>
      <div class="u-mt-lg">${modelSlot(false)}</div>
      <div class="panel u-mt"><h2>The models</h2><p class="muted u-mt-xs">Every major version of Sentinel is a model, named for a guardian from myth. Turn one over to read about it.</p><div class="u-mt">${guardiansHTML()}</div></div>
      <div class="u-mt-lg" data-ledger></div>`;

    mountModels(el);
    const slot = $('[data-ledger]', el);
    try {
      await planbook();
    } catch {
      slot.innerHTML = '<p class="muted">The plans could not load just now. <a href="/pricing">See them on the website</a>.</p>';
      return;
    }
    slot.innerHTML = window.SentinelPlanbook.ledger(state.plans, { billingMode, current: plan() });
    $$('button[data-plan]', slot).forEach((b) => b.addEventListener('click', () => busy(b, 'Updating', async () => {
      try {
        const data = await api('/billing/plan', { method: 'POST', body: { plan: b.dataset.plan } });
        state.me = { ...state.me, user: data.user, plan: data.plan, usage: data.usage, week: data.week };
        paintAccount();
        toast(`You are now on ${data.plan.name}.`, 'success');
        render();
      } catch (err) { toast(err.message, 'info', 6000); }
    })));
  }

  /* ============================================================ settings */

  /*
   * Settings: one home for every choice Sentinel offers. Each row is one object, and the same list draws the page,
   * filters it as you type and feeds the search palette, so a setting is found by its words wherever it is asked for.
   * A row that cannot work here says why in place of working: its control disabled, never hidden, never shown as on.
   * A change is saved when it is pressed; a failed save puts the control back and says why.
   * The groups are fixed. The accent and look picker adds its rows to 'look', motion and the scan effect to 'moving'.
   */
  const SETTING_GROUPS = [
    ['look', 'Appearance'], ['moving', 'Motion'], ['protection', 'Live protection'], ['guards', 'Everyday guards'],
    ['chat', 'Chat and texts'], ['alerts', 'Alerts'], ['lock', 'Parent lock'], ['account', 'Account and security'], ['data', 'Your data'], ['plan', 'Plan and app'], ['help', 'Help']
  ];
  const NEEDS_APP = 'Needs the Sentinel app for Windows.';
  /** Why a row that needs the Windows app cannot work here, or '' when it can. */
  function appWhy(info, method) {
    if (!desktop) return NEEDS_APP;
    if (!desktop[method]) return 'Needs a newer Sentinel app. It updates by itself.';
    if (!info) return 'The Sentinel app did not answer. Open this page again.';
    return '';
  }
  const liveOf = (info) => (info && info.live) || { supported: false, enabled: false };
  const onWindows = (ok) => (ok ? '' : 'Needs Windows.');
  /** A switch saved through the app: `on` reads it, `off` says why it cannot work (past needing the app), `said` is the toast. */
  const appSwitch = (o) => ({ ...o, kind: 'switch', app: true, why: (info) => appWhy(info, o.method) || (o.off ? o.off(info) : '') });
  /** One of three words saved through the app (Marks beside links, Pop-up warnings): `key` reads it, `said` and `state` per word. */
  const levelRow = (o) => ({ ...o, kind: 'custom', app: true,
    why: (i) => appWhy(i, o.method) || onWindows(liveOf(i).supported),
    state: (i) => o.state[i[o.key]] || '',
    control: (i) => seg(`set-${o.id}-l`, o.options, i[o.key]),
    bind: (row, info, ctx) => $$('[data-seg]', row).forEach((b) => b.addEventListener('click', async () => {
      if (b.getAttribute('aria-pressed') === 'true') return;
      $$('[data-seg]', row).forEach((x) => { x.disabled = true; });
      try { toast(o.said[await desktop[o.method](b.dataset.seg)], 'success'); } catch (err) { toast(desktopError(err), 'error'); }
      ctx.refresh();
    })) });
  const seg = (labelId, options, current) => `<div class="seg" role="group" aria-labelledby="${labelId}">${options.map(([v, name, off]) => `<button type="button" class="seg__btn${v === current ? ' is-on' : ''}" data-seg="${v}" aria-pressed="${v === current}" ${off ? 'disabled' : ''}>${name}</button>`).join('')}</div>`;
  const facts = (summary, items) => `<details class="set-facts"><summary>${summary}</summary><ul>${items.map(([b, t]) => `<li><b>${b}</b> ${t}</li>`).join('')}</ul></details>`;
  const linkControl = (href) => `<a class="btn btn--sm" href="${href}">Open</a>`;

  const SETTINGS = [
    // The look (look.js): its picker draws both rows, Theme as its radio well and Colour as its coins.
    { id: 'theme', group: 'look', kind: 'block', label: 'Theme', hint: 'Auto follows your computer. Light or Dark stays as you choose it.',
      words: ['dark', 'light', 'mode', 'night', 'appearance'],
      mount: (body) => { if (window.SentinelLook && SentinelLook.picker) body.appendChild(SentinelLook.picker({ only: 'mode' })); } },
    { id: 'accent', group: 'look', kind: 'block', label: 'Colour',
      hint: desktop ? 'One colour for this app, live scanning, its warnings, the mask in the corner, the tray icon and the companion in your browser.' : 'One colour for the whole app. In the Sentinel app for Windows it also colours live scanning and its warnings.',
      words: ['colour', 'color', 'accent', 'gold', 'rose', 'amethyst', 'sapphire', 'teal', 'platinum', 'appearance'],
      mount: (body) => { if (window.SentinelLook && SentinelLook.picker) body.appendChild(SentinelLook.picker({ only: 'accent' })); } },
    { id: 'simple-view', group: 'look', kind: 'switch', label: 'Simple view', hint: 'Fewer pages and fewer words. A check shows its answer and what to do, in bigger type, with the details one press away. On this device.',
      words: ['simple', 'easy', 'less', 'basic', 'bigger', 'large', 'older', 'beginner', 'clutter', 'plain'],
      on: () => simpleView(), save: (input) => window.SentinelSimple.set(input.checked),
      said: (on) => (on ? 'Simple view is on. Pages you may not need are tucked away; search still finds every one.' : 'Simple view is off. Every page and detail is back.') },
    { id: 'text-size', group: 'look', kind: 'custom', label: 'Text size', hint: 'Larger words in the app, on the website and in Sentinel\'s warnings, on this device. Headings stay as they are.',
      words: ['font', 'bigger', 'larger', 'read', 'reading', 'eyes', 'zoom', 'small', 'accessibility'],
      control: () => seg('set-text-size-l', [['standard', 'Standard'], ['large', 'Large'], ['larger', 'Larger']], window.SentinelType ? window.SentinelType.get().text : 'standard'),
      bind: (row, info, ctx) => $$('[data-seg]', row).forEach((b) => b.addEventListener('click', () => { if (window.SentinelType) window.SentinelType.set({ text: b.dataset.seg }); ctx.draw(); })) },
    { id: 'density', group: 'look', kind: 'custom', label: 'Spacing', hint: 'Compact fits more on one screen. Buttons stay easy to press.',
      words: ['compact', 'dense', 'density', 'comfortable', 'padding', 'space', 'tight'],
      control: () => seg('set-density-l', [['comfortable', 'Comfortable'], ['compact', 'Compact']], window.SentinelType ? window.SentinelType.get().density : 'comfortable'),
      bind: (row, info, ctx) => $$('[data-seg]', row).forEach((b) => b.addEventListener('click', () => { if (window.SentinelType) window.SentinelType.set({ density: b.dataset.seg }); ctx.draw(); })) },

    // Motion (boot.js SentinelMotionLevel): its own control, Animation (Full, Calm, Off) and the Scan effect switch. The
    // row's heading names it, so the control's own name is kept for screen readers only.
    { id: 'motion', group: 'moving', kind: 'block', label: 'Animation', hint: `How much Sentinel moves on this ${desktop ? 'computer, here and over your browser' : 'device'}. Off whenever your computer asks for less motion.`,
      words: ['animation', 'animations', 'motion', 'reduce', 'still', 'calm', 'effects', 'moving', 'scan effect', 'digits', 'glitch', 'binary'],
      mount: (body) => {
        if (!window.SentinelMotionLevel) return;
        const c = window.SentinelMotionLevel.control();
        const name = $('.setting b', c);
        if (name) name.classList.add('sr-only');
        body.append(c);
      } },

    { id: 'live-mode', group: 'protection', kind: 'custom', app: true, label: 'Scanning mode', hint: 'Fast marks search results about a second after you search. Delicate also looks up how old each site is and whether it resolves, and takes about five seconds.',
      words: ['fast', 'delicate', 'live', 'speed', 'research', 'search results'],
      why: (i) => appWhy(i, 'setLiveMode') || onWindows(liveOf(i).supported) || (plan().features.liveScanning || plan().features.liveFast ? '' : 'Live scanning is not in your plan. See Plan and usage below.'),
      state: () => (plan().features.liveScanning ? '' : 'Delicate comes with Pro, Max and Ultimate.'),
      control: (i) => { const can = Boolean(plan().features.liveScanning); return seg('set-live-mode-l', [['fast', 'Fast'], ['delicate', 'Delicate', !can]], i.liveMode === 'delicate' && can ? 'delicate' : 'fast'); },
      bind: (row, info, ctx) => $$('[data-seg]', row).forEach((b) => b.addEventListener('click', async () => {
        if (b.getAttribute('aria-pressed') === 'true') return;
        $$('[data-seg]', row).forEach((x) => { x.disabled = true; });
        try { await desktop.setLiveMode(b.dataset.seg); toast(b.dataset.seg === 'delicate' ? 'Live scanning is delicate now.' : 'Live scanning is fast now.', 'success'); } catch (err) { toast(desktopError(err), 'error'); }
        ctx.refresh();
      })) },
    levelRow({ id: 'marks-beside-links', group: 'protection', label: 'Marks beside links', method: 'setMarksLevel', key: 'marksLevel',
      hint: 'Sentinel checks every link either way. This only changes which ones get a mark. A warning or danger mark always shows.',
      words: ['marks', 'ticks', 'tick', 'safe', 'busy', 'clutter', 'quiet', 'search results', 'less', 'density'],
      options: [['all', 'Every link'], ['risky', 'Risky links'], ['danger', 'Serious only']],
      said: { all: 'Every link gets a mark. Safe ones get a small tick.', risky: 'Risky links get a mark. Safe ones get none.', danger: 'Only warning and danger links get a mark.' },
      state: { all: 'Safe links get a small tick, so every result shows its answer.', risky: 'Caution, warning and danger links get a mark. Safe links get none.', danger: 'Only warning and danger links get a mark. The corner island still counts every link.' } }),
    appSwitch({ id: 'auto-scan', group: 'protection', label: 'Auto scanning', hint: 'Starts fast scanning by itself whenever you open a browser, and stops when every browser is closed.',
      words: ['automatic', 'browser', 'start', 'live'], method: 'setAutoScan', hook: 'auto-scan', on: (i) => i.autoScan, off: (i) => onWindows(liveOf(i).supported),
      said: (on) => (on ? 'Auto scanning is on. Open a browser and Sentinel starts scanning it.' : 'Auto scanning is off.') }),
    appSwitch({ id: 'download-protection', group: 'protection', label: 'Download protection', hint: 'Every new file in your Downloads folder is inspected on your computer.',
      words: ['downloads', 'files', 'folder', 'virus', 'malware'], method: 'setDownloadProtection', hook: 'dl', on: (i) => i.downloads && i.downloads.active,
      state: (i) => (i.downloads && i.downloads.active ? `Watching ${i.downloads.folder || 'Downloads'}.` : (i.downloads && i.downloads.reason) || ''),
      said: (on, r) => (on ? 'Download protection is on.' : (r && r.reason) || 'Download protection is off.') }),
    appSwitch({ id: 'defense-watch', group: 'protection', label: 'Defense', hint: 'Watches new programs and startup entries. A dangerous program is stopped, quarantined and its startup entries removed.',
      words: ['startup', 'quarantine', 'malware', 'program', 'virus', 'stop'], method: 'setDefense', hook: 'defense', on: (i) => i.defense && i.defense.active, off: (i) => onWindows(i.defense && i.defense.supported),
      state: (i) => (i.defense.active ? `Watching ${(i.defense.watched || []).join(', ')} and startup entries.` : i.defense.reason || ''),
      said: (on, r) => (on ? 'Defense is on.' : (r && r.reason) || 'Defense is off.') }),
    appSwitch({ id: 'my-sites', group: 'protection', label: 'Your sites', hint: 'Sentinel knows the big brands. Here it learns yours: your bank or credit union, your school portal, your work sign-in. A link or page made to look like one of them gets a warning.',
      words: ['bank', 'look-alike', 'lookalike', 'credit union', 'school', 'fake', 'sites', 'impersonation'], method: 'setMySites', hook: 'my-sites', on: (i) => i.mySites !== false,
      off: (i) => (i.embeddedServer ? '' : 'Available when the app uses its own scanner on this computer.'),
      said: (on, r) => (on ? 'Your sites: on. Sentinel will learn the sites you use.' : r && r.erased === false ? 'Your sites: off. The sites could not be erased just now, so Sentinel will try again each time it starts.' : 'Your sites: off. Every site is forgotten.'),
      body: (i, data) => `${i.mySites !== false ? `<form class="set-sub set-add" data-my-sites-add>
          <input class="input mono" name="host" placeholder="mycu.org" aria-label="A site you use" autocomplete="off" spellcheck="false" maxlength="300" required>
          <button class="btn btn--gold btn--sm" type="submit">Add site</button></form>
        ${data.mine.length ? `<ul class="list">${data.mine.map((s) => `<li><span class="list__main"><b class="mono">${esc(s.host)}</b><span>${s.source === 'you' ? 'Added by you' : 'Learned: you use it often'}</span></span><button class="btn btn--sm" type="button" data-my-site-remove="${esc(s.host)}">Remove</button></li>`).join('')}</ul>
          <div class="set-sub"><span class="muted">${data.mine.length} site${data.mine.length === 1 ? '' : 's'}</span><button class="btn btn--sm" type="button" data-my-sites-forget>Forget all</button></div>`
          : '<p class="set-row__state">None yet. A site you visit on three different days is added by itself, or add one now.</p>'}` : ''}
        ${facts('How they are kept', [['On this computer only,', 'as plain site names you can read here. A site you passed through is never written down: until it has been seen on three days, only a scrambled code of it is kept.'], ['Learned only from safe pages,', 'never from a private window. Turning this off forgets every site.']])}`,
      bind: (row, info, ctx) => {
        const form = $('[data-my-sites-add]', row);
        if (form) form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          try { await desktop.addMySite(form.elements.host.value); toast('Added. Look-alikes of it now get a warning.', 'success'); ctx.refresh(); }
          catch (err) { form.elements.host.setAttribute('aria-invalid', 'true'); toast(desktopError(err), 'error'); }
        });
        $$('[data-my-site-remove]', row).forEach((b) => b.addEventListener('click', async () => {
          b.disabled = true;
          try { await desktop.removeMySite(b.dataset.mySiteRemove); ctx.refresh(); } catch (err) { b.disabled = false; toast(desktopError(err), 'error'); }
        }));
        const forget = $('[data-my-sites-forget]', row);
        if (forget) forget.addEventListener('click', async () => {
          try { await desktop.forgetMySites(); toast('Every site is forgotten.', 'success'); ctx.refresh(); } catch (err) { toast(desktopError(err), 'error'); }
        });
      } }),
    appSwitch({ id: 'scan-menu', group: 'protection', label: 'Scan with Sentinel in the right-click menu', hint: 'Right-click any file, choose Show more options, then Scan with Sentinel. The file is checked on this computer and the answer opens here.',
      words: ['context menu', 'explorer', 'file', 'right click'], method: 'setScanMenu', hook: 'scan-menu', on: (i) => i.scanMenu && i.scanMenu.enabled, off: (i) => onWindows(i.scanMenu && i.scanMenu.supported),
      said: (on) => (on ? 'Scan with Sentinel is in the right-click menu.' : 'Scan with Sentinel is no longer in the right-click menu.') }),
    appSwitch({ id: 'start-with-computer', group: 'protection', label: 'Start with my computer', hint: 'Keeps protection running from the moment you sign in to Windows.',
      words: ['startup', 'boot', 'login', 'sign in', 'launch'], method: 'setOpenAtLogin', hook: 'login', on: (i) => i.openAtLogin,
      said: (on) => (on ? 'Sentinel starts with your computer.' : 'Sentinel no longer starts with your computer.') }),

    appSwitch({ id: 'copied-links', group: 'guards', label: 'Check links I copy', hint: 'Copy a link from a text message, a chat or a PDF and Sentinel checks it, and warns you only if it is dangerous. Only copied web links are read; nothing else on your clipboard is sent or kept.',
      words: ['clipboard', 'copy', 'paste', 'link'], method: 'setClipboardCheck', hook: 'clip', on: (i) => i.clipboardCheck,
      said: (on) => (on ? 'Check links I copy is on. Copy a link and Sentinel checks it.' : 'Check links I copy is off.') }),
    appSwitch({ id: 'pasted-commands', group: 'guards', label: 'Stop pasted commands', hint: 'Fake "I am not a robot" pages copy a command and ask you to paste it into Windows. Copied in a browser, Sentinel takes it off your clipboard and tells you, with a way to put it back; copied in another program, it only tells you. Checked on this computer, never sent or kept.',
      words: ['clickfix', 'captcha', 'robot', 'powershell', 'command', 'clipboard', 'run'], method: 'setCommandShield', hook: 'shield', on: (i) => i.commandShield, off: (i) => onWindows(i.platform === 'win32'),
      said: (on) => (on ? 'Stop pasted commands is on.' : 'Stop pasted commands is off.'),
      // For the two minutes Sentinel holds a stopped command, the way to put it back (the notification has it too).
      body: (i) => {
        const held = i.commandHeld;
        if (!held || held.until <= Date.now() || !desktop.commandPutBack) return '';
        const at = new Date(held.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        return `<div class="set-sub"><p>Taken off your clipboard at ${esc(at)}${held.host ? `, copied from ${esc(held.host)}` : ''}. ${esc(held.reason)}. If you trust it, you can put it back for two minutes.</p><button class="btn btn--sm" type="button" data-put-back>Put it back</button></div>`;
      },
      bind: (row, info, ctx) => {
        const b = $('[data-put-back]', row);
        if (!b) return;
        const t = setTimeout(ctx.draw, Math.max(0, info.commandHeld.until - Date.now()) + 50);
        ctx.offs.push(() => clearTimeout(t));
        b.addEventListener('click', async () => {
          try { const r = await desktop.commandPutBack(); toast(r.ok ? `The command is back on your clipboard. ${r.message}` : r.message, r.ok ? 'success' : 'info'); } catch (err) { toast(desktopError(err), 'error'); }
        });
      } }),
    appSwitch({ id: 'wallet-guard', group: 'guards', label: 'Wallet guard', hint: 'Some malware waits for you to copy a crypto wallet address or an IBAN and swaps in its own. If the address you copied changes by itself a moment later, Sentinel puts yours back and tells you. Compared in memory, never sent, saved or logged.',
      words: ['crypto', 'bitcoin', 'iban', 'bank', 'address', 'clipboard', 'swap'], method: 'setWalletGuard', hook: 'wallet-guard', on: (i) => i.walletGuard, off: (i) => onWindows(i.platform === 'win32'),
      said: (on) => (on ? 'Wallet guard is on.' : 'Wallet guard is off.') }),
    appSwitch({ id: 'remote-guard', group: 'guards', label: 'Tech-support scam shield', hint: 'When a page flagged as a scam takes the whole screen, Sentinel offers to close it. When a remote-control program such as AnyDesk or TeamViewer starts soon after a flagged page, or soon after it was downloaded, Sentinel asks whether someone on the phone told you to install it. Nothing is stopped unless you say so.',
      words: ['anydesk', 'teamviewer', 'remote', 'support', 'phone', 'full screen', 'popup'], method: 'setRemoteGuard', hook: 'remote-guard', on: (i) => i.remoteGuard && i.remoteGuard.enabled, off: (i) => onWindows(i.remoteGuard && i.remoteGuard.supported),
      state: (i) => (i.remoteGuard.enabled && !liveOf(i).enabled ? 'Needs live scanning: the way out of a full-screen page and the bank warning work while live scanning is on.' : ''),
      said: (on) => (on ? 'The tech-support scam shield is on.' : 'The tech-support scam shield is off.'),
      body: (i) => { const t = i.remoteGuard.trusted || []; return t.length ? `<div class="set-sub"><p>You use ${esc(t.join(', '))} yourself, so Sentinel does not ask about ${t.length === 1 ? 'it' : 'them'}.</p><button class="btn btn--sm" type="button" data-forget-remote>Ask again</button></div>` : ''; },
      bind: (row, info, ctx) => {
        const b = $('[data-forget-remote]', row);
        if (b) b.addEventListener('click', async () => {
          try { await desktop.forgetTrustedRemote(); toast('Sentinel will ask about remote-control programs again.', 'success'); ctx.refresh(); } catch (err) { toast(desktopError(err), 'error'); }
        });
      } }),
    appSwitch({ id: 'snip', group: 'guards', label: 'Check something on screen', hint: 'Press the shortcut, or choose Check something on screen in the tray menu, then draw a box around a pop-up, an ad, a message, a QR code or a phone number. Sentinel reads it on this computer and tells you whether it looks like a scam. Only the links it finds are checked; the picture and the words are never sent or kept.',
      words: ['screenshot', 'snip', 'shortcut', 'keyboard', 'qr', 'popup', 'screen'], method: 'setSnip', hook: 'snip', on: (i) => i.snip.enabled, off: (i) => onWindows(i.snip && i.snip.supported),
      state: (i) => (i.snip.enabled && !i.snip.registered ? 'Another program already uses this shortcut. Choose another one.' : ''),
      save: (input, row) => desktop.setSnip(input.checked, $('[data-snip-key]', row).value),
      said: (on, r) => (r && r.enabled && !r.registered ? 'Another program already uses this shortcut. Choose another one.' : on ? 'Check something on screen is on.' : 'Check something on screen is off.'),
      body: (i) => `<label class="set-sub"><span>Shortcut</span><select class="input" data-snip-key ${i.snip.enabled ? '' : 'disabled'}>${i.snip.keys.map((k) => `<option value="${esc(k.id)}" ${k.id === i.snip.key ? 'selected' : ''}>${esc(k.label)}</option>`).join('')}</select></label>`,
      bind: (row, info, ctx) => {
        const key = $('[data-snip-key]', row);
        key.addEventListener('change', async () => {
          try {
            const s = await desktop.setSnip($('.switch', row).checked, key.value);
            toast(s.enabled && !s.registered ? 'Another program already uses this shortcut. Choose another one.' : 'Shortcut changed.', s.enabled && !s.registered ? 'error' : 'success');
          } catch (err) { toast(desktopError(err), 'error'); }
          ctx.refresh();
        });
      } }),

    appSwitch({ id: 'chat-safety', group: 'chat', label: 'Chat safety: Roblox and Discord', hint: 'Points out scams and people who may not be safe to talk to (someone asking a child to keep secrets, to send pictures, to move to another app, or to meet), right beside the message, while Roblox or the Discord app is in front.',
      words: ['roblox', 'discord', 'child', 'children', 'kids', 'games', 'grooming', 'messages', 'family'], method: 'setChatSafety', hook: 'chat-safety', on: (i) => i.chatSafety && i.chatSafety.enabled, off: (i) => onWindows(i.chatSafety && i.chatSafety.supported),
      seen: 'chat-seen', state: (i) => chatSeenText(i.chatSafety), down: (i) => Boolean(i.chatSafety.enabled && readerDown(i.chatSafety, '')),
      said: (on) => (on ? CHAT_ON : 'Chat safety is off.'), saved: () => markAsked('chat'),
      body: () => facts('What it reads, and what it never does', [
        ['Read on this computer only.', 'Messages are read from the screen as they appear, judged here and forgotten. No message, name or game is sent to Sentinel or anyone else, saved, or logged.'],
        ['Always plain to see.', 'A Sentinel badge shows while chat is watched. In a Roblox game it shows only when you open the Esc menu, so it never covers the game; warnings sit small, beside the chat box.'],
        ['Never in the way.', 'Nothing is read while a game\'s chat is closed. Sentinel never changes Roblox or Discord, never types or clicks in them, and only speaks up when a message is suspicious.']]) }),
    appSwitch({ id: 'text-safety', group: 'chat', label: 'Check my texts', hint: 'If your phone\'s texts show on this computer through Phone Link, Sentinel points out English scam texts (unpaid tolls, parcel fees, "Hi Mum, this is my new number", "your account is locked") right beside the message, while Phone Link is in front.',
      words: ['sms', 'phone link', 'text messages', 'phone', 'toll', 'parcel'], method: 'setTextSafety', hook: 'text-safety', on: (i) => i.textSafety && i.textSafety.enabled, off: (i) => onWindows(i.textSafety && i.textSafety.supported),
      seen: 'text-seen', state: (i) => textSeenText(i.textSafety), down: (i) => Boolean(i.textSafety.enabled && readerDown(i.textSafety, '')),
      said: (on) => (on ? 'Check my texts is on. Open a conversation in Phone Link and Sentinel checks it.' : 'Check my texts is off.'),
      body: () => facts('What it reads, and what it never does', [
        ['Read on this computer only.', 'The conversation on screen is read as it appears, judged here and forgotten. No text, name or number is sent to Sentinel or anyone else, saved, or logged.'],
        ['Links checked, never opened.', 'A link in a text is checked by its address, the way a copied link is. It is not added to your history.'],
        ['Never in the way.', 'Only texts you received are checked. Sentinel never types, clicks or replies in Phone Link.'],
        ['English texts for now.', 'Sentinel knows the wording of scam texts in English only, and Phone Link needs to show a left-to-right language.']]) }),

    levelRow({ id: 'warn-level', group: 'alerts', label: 'Pop-up warnings', method: 'setWarningsLevel', key: 'warningsLevel',
      hint: 'When a page you open looks like a warning or a danger, Sentinel tells you with a notification and a small card in the corner. Whatever you choose, the page is still marked in the corner, and Sentinel still asks before you pay with gift cards or crypto, or after you typed a password on it.',
      words: ['notifications', 'notification', 'alerts', 'loud', 'quiet', 'popup', 'pop up', 'card', 'interrupt', 'warn'],
      options: [['all', 'Always'], ['danger', 'Danger only'], ['quiet', 'Never']],
      said: { all: 'Sentinel warns you about warning and danger pages.', danger: 'Sentinel warns you only about danger pages.', quiet: 'No more pop-up warnings. Flagged pages are still marked in the corner.' },
      state: { all: 'A notification and a card for every warning or danger page.', danger: 'A warning page is marked in the corner, without a notification or a card.', quiet: 'Nothing pops up. A flagged page is marked in the corner only, so look there before you sign in or pay.' } }),
    appSwitch({ id: 'exposure-alerts', group: 'alerts', label: 'Exposure alerts', hint: 'A scam page often reaches the threat lists hours or days after it goes up. With this on, Sentinel remembers the sites live scanning found safe for 14 days, and tells you if a list names one of them afterwards, with what to do.',
      words: ['listed', 'later', 'visited', 'history', 'warning', 'notification'], method: 'setExposureAlerts', hook: 'exposure-alerts', on: (i) => i.exposureAlerts, off: (i) => (liveOf(i).supported ? '' : 'Needs Windows, with live scanning.'),
      state: (i) => (i.exposureAlerts && !liveOf(i).enabled ? 'On, but live scanning is off, so no sites are being remembered.' : ''),
      said: (on, r) => (on ? EXPOSURE_ON : r && r.erased === false ? 'Exposure alerts are off. The remembered sites could not be erased just now, so Sentinel will try again each time it starts.' : 'Exposure alerts are off. Every remembered site is erased.'),
      saved: () => markAsked('exposure'),
      body: (i) => {
        // The marks live with whichever Sentinel server the app uses: its own, on this computer, or one set up for it.
        let where = 'on this computer';
        if (!i.embeddedServer) { try { where = `on the Sentinel server this app uses (${new URL(i.origin).host})`; } catch { where = 'on the Sentinel server this app uses'; } }
        return facts('How sites are remembered', [
          [`Kept ${esc(where)}`, 'as a scrambled code of each site&rsquo;s name and the day, never the address or the time, and erased after 14 days. Turning this off erases every one, and every alert found so far. The copies Sentinel keeps to repair its accounts file can hold them for up to 7 more days.'],
          ['Private windows are never remembered.', 'Pages on shared sites (a Google Sites page, a Netlify site) are left out, since one bad page there says nothing about the one you saw.']]);
      } }),
    appSwitch({ id: 'week-note', group: 'alerts', label: 'A note about your week', hint: 'Once a week, a Windows notification with last week in one line. Never while a game or video is full screen.',
      words: ['weekly', 'notification', 'summary', 'recap'], method: 'setWeekRecap', hook: 'week-recap', on: (i) => i.weekRecap,
      said: (on) => (on ? 'Done. Your first note comes after this week is over.' : 'No more weekly notes.') }),

    { id: 'parent-lock', group: 'lock', kind: 'block', app: true, label: 'Parent lock', hint: 'With a PIN set, switching off any of Sentinel\'s protection, here or in the tray, or quitting Sentinel, needs the PIN. So do putting a quarantined file back, telling the tech-support scam shield that you use a remote-control program yourself, and switching accounts. Turning protection on never does. It does not cover the browser companion or Windows administrator accounts.',
      words: ['pin', 'child', 'children', 'kids', 'family', 'lock', 'code'], why: (i) => appWhy(i, 'lockStatus'), mount: (body) => renderParentLock(body) },

    { id: 'profile', group: 'account', kind: 'block', label: 'Profile', hint: 'Your name as Sentinel shows it. Your email is how you sign in.', words: ['name', 'email', 'first name'], mount: profileBlock },
    { id: 'two-factor', group: 'account', kind: 'block', label: 'Two-factor sign-in', hint: 'A code from an authenticator app at every sign-in, as well as your password.', words: ['2fa', 'authenticator', 'code', 'otp', 'two step', 'security'],
      mount: (body) => { body.setAttribute('data-2fa', ''); render2fa(body); } },
    { id: 'password', group: 'account', kind: 'block', label: 'Change password', hint: 'You will be signed out everywhere else.', words: ['password', 'security'],
      why: () => (state.me.user.hasPassword ? '' : 'You sign in with Google, so there is no Sentinel password to change.'), mount: passwordBlock },
    { id: 'devices', group: 'account', kind: 'block', label: 'Signed-in devices', hint: 'Every browser, Sentinel app and companion signed in to your account.', words: ['sessions', 'sign out', 'logout', 'devices', 'computers'],
      mount: (body) => { body.setAttribute('data-sessions', ''); loadSessions(body); } },

    // Your data: what the Privacy Policy says an account holds, how to take it and how to remove it.
    { id: 'download-data', group: 'data', kind: 'block', label: 'Download my data', hint: 'One file with everything your account holds, item by item as the Privacy Policy lists it. Your password, sign-in links, two-factor secret and AI keys are never in it.',
      words: ['export', 'copy', 'gdpr', 'ccpa', 'privacy', 'download', 'json'], mount: downloadBlock },
    { id: 'history-data', group: 'data', kind: 'custom', label: 'Scan history', hint: 'Kept for 90 days. Delete one entry or all of it on the History page.', words: ['history', 'erase', 'clear', 'scans'],
      control: () => linkControl('/app/history') },
    { id: 'live-memory', group: 'data', kind: 'block', label: 'What live scanning remembers', hint: 'Exposure alerts keep a scrambled code for each safe site you visited, for 14 days. Your sites keeps the sites you added and the ones it learned. Either can be erased here at once.',
      words: ['exposure', 'my sites', 'your sites', 'forget', 'erase', 'remembered'], mount: forgetBlock },
    { id: 'delete-account', group: 'data', kind: 'block', label: 'Delete account', hint: 'Permanently removes your account, history, reports and trusted sites.', words: ['remove', 'erase', 'close account', 'data'], mount: deleteBlock },

    { id: 'plan-usage', group: 'plan', kind: 'custom', label: 'Plan and usage', hint: 'What is left this week, and the plans to choose from.', words: ['billing', 'pro', 'max', 'ultimate', 'upgrade', 'subscription', 'limits'],
      state: () => `You are on ${plan().name}.`, control: () => linkControl('/app/plan') },
    { id: 'assistants', group: 'plan', kind: 'custom', label: 'AI assistants', hint: 'Optional. Ask ChatGPT, Claude, Gemini or DeepSeek about anything. Sentinel\'s scans never depend on them.', words: ['chatgpt', 'claude', 'gemini', 'deepseek', 'ai', 'connect'],
      control: () => linkControl('/app/assistants') },
    { id: 'updates', group: 'plan', kind: 'custom', app: true, label: 'Updates', hint: 'The Sentinel app installs its own updates. The website is always the newest version.', words: ['version', 'update', 'upgrade', 'new'],
      why: (i) => (desktop ? appWhy(i, 'checkUpdates') : ''),
      state: (i) => (i ? `Sentinel ${i.version}. ${updateText(i.update || { status: 'idle' })}` : 'This website is always the newest Sentinel.'),
      control: (i) => { const up = (i && i.update) || {}; return up.status === 'ready' ? '<button class="btn btn--sm btn--gold" type="button" data-install-update>Restart now</button>' : up.supported ? '<button class="btn btn--sm" type="button" data-check-update>Check now</button>' : ''; },
      bind: (row, info, ctx) => {
        const check = $('[data-check-update]', row);
        if (check) check.addEventListener('click', () => busy(check, 'Checking', async () => {
          let s;
          try { s = await desktop.checkUpdates(); } catch (err) { toast(desktopError(err), 'error'); return; }
          toast(s.status === 'current' ? 'Sentinel is up to date.' : s.status === 'error' ? 'Could not check for updates. Try again later.' : 'Checking for a newer version.', s.status === 'error' ? 'error' : 'info');
          ctx.refresh();
        }));
        const install = $('[data-install-update]', row);
        if (install) install.addEventListener('click', () => desktop.installUpdate());
      } },

    { id: 'whats-new', group: 'help', kind: 'block', label: 'What changed', hint: 'The notes for the newest version of Sentinel.', words: ['changelog', 'release notes', 'new', 'version', 'about'], mount: whatsNewBlock },
    { id: 'false-alarm', group: 'help', kind: 'block', label: 'Report a false alarm', hint: 'Sentinel warned you about a site you know is safe. Tell us which one.', words: ['wrong', 'mistake', 'safe', 'false positive', 'report', 'feedback'], mount: falseAlarmBlock },
    { id: 'support', group: 'help', kind: 'custom', label: 'Write to us', hint: 'A question, a problem, or a scam Sentinel missed.', words: ['help', 'contact', 'support', 'email', 'privacy', 'terms'],
      body: () => '<p class="set-sub">How Sentinel treats your data, and the rules for using it: <a href="/privacy">Privacy Policy</a> &middot; <a href="/terms">Terms</a></p>',
      control: () => (state.config.supportEmail ? `<a class="btn btn--sm" href="mailto:${esc(state.config.supportEmail)}">Email support</a>` : '') }
  ];
  const settingWords = (r) => `${r.label} ${r.hint} ${(r.words || []).join(' ')} ${SETTING_GROUPS.find(([g]) => g === r.group)[1]}`.toLowerCase();
  const settingMatches = (r, q) => q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => settingWords(r).includes(w));

  function profileBlock(body) {
    const u = state.me.user;
    body.innerHTML = `<form data-name-form data-draft="profile">
        <div class="row2">
          <div class="field"><label for="p-first">First name</label><input class="input" id="p-first" name="firstName" value="${esc(u.firstName)}" required maxlength="60"></div>
          <div class="field"><label for="p-last">Last name <span class="opt">(optional)</span></label><input class="input" id="p-last" name="lastName" value="${esc(u.lastName || '')}" maxlength="60"></div>
        </div>
        <div class="field"><label for="p-email">Email ${u.emailVerified ? '<span class="status is-on u-ml">Confirmed</span>' : '<span class="status is-locked u-ml">Not confirmed</span>'}</label><input class="input" id="p-email" value="${esc(u.email)}" disabled></div>
        <button class="btn u-mt" type="submit">Save profile</button>
      </form>`;
    $('form', body).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      await busy($('button', f), 'Saving', async () => {
        try {
          const data = await api('/account/name', { method: 'POST', body: { firstName: f.firstName.value, lastName: f.lastName.value } });
          state.me.user = data.user;
          paintAccount();
          toast('Profile saved.', 'success');
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  function passwordBlock(body) {
    body.innerHTML = `<form data-pw-form>
        <div class="row2">
          <div class="field"><label for="pw-cur">Current password</label><input class="input" id="pw-cur" type="password" name="currentPassword" autocomplete="current-password" required></div>
          <div class="field"><label for="pw-new">New password</label><input class="input" id="pw-new" type="password" name="newPassword" autocomplete="new-password" required minlength="10"><span class="field__hint">10+ characters with a letter and a number.</span></div>
        </div>
        <button class="btn u-mt" type="submit">Update password</button>
      </form>`;
    const pw = $('form', body);
    pw.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      await busy($('button', pw), 'Updating', async () => {
        try {
          await api('/account/password', { method: 'POST', body: { currentPassword: pw.currentPassword.value, newPassword: pw.newPassword.value } });
          pw.reset();
          toast('Password updated. Other sessions were signed out.', 'success');
          const devices = $('[data-sessions]');
          if (devices) loadSessions(devices);
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  // The file comes from the server, which lists each thing the Privacy Policy says an account holds (a test keeps
  // the two in step). It asks for the password again: a borrowed session must not be able to take it.
  function downloadBlock(body) {
    const u = state.me.user;
    body.innerHTML = `<form data-export>
        ${u.hasPassword ? '<div class="row2"><div class="field"><label for="ex-pw">Password</label><input class="input" id="ex-pw" type="password" name="password" autocomplete="current-password" required></div></div>' : ''}
        <button class="btn${u.hasPassword ? ' u-mt' : ''}" type="submit">Download my data</button>
      </form>`;
    $('form', body).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      await busy($('button', f), 'Preparing', async () => {
        try {
          const data = await api('/account/export', { method: 'POST', body: { password: f.password ? f.password.value : '' } });
          const name = `sentinel-data-${data.exportedAt.slice(0, 10)}.json`;
          const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
          const a = Object.assign(document.createElement('a'), { href: url, download: name });
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          f.reset();
          toast(`Your data is ready as ${name}.`, 'success');
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  // Erasing what live scanning keeps. A second press within a few seconds erases, so one stray click never does.
  function forgetBlock(body, ctx) {
    const WHAT = {
      exposures: ['Forget visited sites', '/live/exposures/forget', (n) => (n ? `Forgot ${n} visited site${n === 1 ? '' : 's'}, and every alert found for them.` : 'Nothing was remembered. Every alert is cleared.')],
      'my-sites': ['Forget Your sites', '/my-sites/forget', (n) => (n ? `Forgot ${n} of Your sites.` : 'Your sites held nothing to forget.')]
    };
    body.innerHTML = `<div class="set-sub set-sub--start">${Object.entries(WHAT).map(([k, [label]]) => `<button class="btn btn--sm" type="button" data-forget="${k}">${label}</button>`).join('')}</div>`;
    $$('[data-forget]', body).forEach((b) => {
      const [label, path, said] = WHAT[b.dataset.forget];
      let armed = 0;
      b.addEventListener('click', () => {
        if (!armed) {
          b.textContent = 'Press again to erase';
          armed = setTimeout(() => { armed = 0; b.textContent = label; }, 4000);
          return;
        }
        clearTimeout(armed);
        armed = 0;
        busy(b, 'Erasing', async () => {
          try {
            const r = await api(path, { method: 'POST', body: {} });
            toast(said(r.forgotten), 'success');
            ctx.refresh();
          } catch (err) { toast(err.message, 'error'); }
        }).then(() => { b.textContent = label; });
      });
    });
  }

  // The newest version's notes, from web/assets/release-note.json, which npm run build:note writes from
  // changelog/<version>.md beside the download page's note.
  async function whatsNewBlock(body) {
    body.innerHTML = '<div class="skeleton u-h-md"></div>';
    try {
      const res = await fetch('/assets/release-note.json', { credentials: 'same-origin' });
      const note = res.ok ? await res.json() : null;
      if (!note || !note.version || !Array.isArray(note.groups)) throw new Error('no note');
      body.innerHTML = `<div class="set-note"><p><b>New in Sentinel ${esc(note.version)} ${esc(note.model || '')}.</b> ${esc(note.summary)}.</p>
        <details class="set-facts"><summary>Every change in this version</summary>${note.groups.map((g) => `<h3>${esc(g.title)}</h3><ul>${g.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}</details></div>`;
    } catch {
      body.innerHTML = '<p class="set-sub">The notes could not be loaded just now. They are also on the <a href="/download">download page</a>.</p>';
    }
  }

  // A false alarm is kept with the site for Sentinel to learn from. It never counts against the site, and on its own
  // it changes nobody's result: trusting the site is what stops the warning, for this account.
  function falseAlarmBlock(body) {
    body.innerHTML = `<form data-false-alarm data-draft="false-alarm">
        <div class="row2">
          <div class="field"><label for="fa-site">The site</label><input class="input" id="fa-site" name="url" required maxlength="2048" placeholder="mybakery.com" autocomplete="off" spellcheck="false"></div>
          <div class="field"><label for="fa-note">What it is <span class="opt">(optional)</span></label><input class="input" id="fa-note" name="note" maxlength="500" placeholder="My local bakery"></div>
        </div>
        <label class="consent__row u-mt"><input type="checkbox" name="trust"><span>Also trust this site for me, so its warning stops now</span></label>
        <button class="btn u-mt" type="submit">Send</button>
      </form>`;
    $('form', body).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      await busy($('button[type=submit]', f), 'Sending', async () => {
        try {
          const r = await api('/report', { method: 'POST', body: { url: f.url.value, category: 'false_alarm', note: f.note.value } });
          if (f.trust.checked) await api('/sites/override', { method: 'POST', body: { url: f.url.value, action: 'allow' } });
          toast(f.trust.checked ? `Sent, and ${r.host} is trusted for you now.` : 'Sent, thank you. On its own a report changes no one’s result.', 'success');
          f.reset();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  function deleteBlock(body) {
    const u = state.me.user;
    body.innerHTML = `<form data-delete>
        <div class="row2">
          ${u.hasPassword ? '<div class="field"><label for="del-pw">Password</label><input class="input" id="del-pw" type="password" name="password" autocomplete="current-password"></div>' : ''}
          <div class="field"><label for="del-confirm">Type DELETE to confirm</label><input class="input" id="del-confirm" name="confirm" autocomplete="off"></div>
        </div>
        <button class="btn btn--danger u-mt" type="submit">Delete my account</button>
      </form>`;
    $('form', body).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      await busy($('button', f), 'Deleting', async () => {
        try {
          await api('/account/delete', { method: 'POST', body: { password: f.password ? f.password.value : '', confirm: f.confirm.value } });
          location.href = '/';
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  async function loadSessions(slot) {
    if (!slot.innerHTML) slot.innerHTML = skel('devices');
    try {
      const { sessions } = await api('/account/sessions');
      slot.innerHTML = `<div class="set-sub"><span class="muted">${sessions.length} active session${sessions.length === 1 ? '' : 's'}</span>${sessions.length > 1 ? '<button class="btn btn--sm" type="button" data-revoke>Sign out other devices</button>' : ''}</div>
        <ul class="list">${sessions.map((s) => `<li>
          <span class="list__icon">${s.kind === 'web' ? ICON.link : s.kind === 'desktop' ? ICON.download : ICON.shield}</span>
          <span class="list__main"><b>${esc(s.device)}${s.current ? ' <span class="status is-on u-ml">This device</span>' : ''}</b><span>${esc(s.kind === 'web' ? 'Browser' : s.kind === 'desktop' ? 'Sentinel app' : 'Browser companion')} &middot; ${s.ip ? esc(s.ip) + ' &middot; ' : ''}active ${ago(s.lastSeenAt || s.createdAt)} &middot; ${s.kind === 'web' ? (s.staySignedIn ? 'stays signed in, ends after 30 days unused' : 'ends when the browser closes') : 'ends after 90 days unused'}</span></span>
          ${s.current ? '<button class="btn btn--sm" type="button" data-signout-here>Sign out</button>' : `<button class="btn btn--sm" type="button" data-revoke-one="${esc(s.id)}">Sign out</button>`}
        </li>`).join('')}</ul>`;
      $$('[data-revoke-one]', slot).forEach((b) => b.addEventListener('click', () => busy(b, 'Signing out', async () => {
        try {
          await api('/account/sessions/revoke', { method: 'POST', body: { id: b.dataset.revokeOne } });
          toast('That device was signed out. The others were not touched.', 'success');
        } catch (err) { toast(err.message, 'error'); }
        loadSessions(slot);
      })));
      keep(slot, 'devices');
      // This device: the same as the account button, here too because a phone has no side bar.
      const here = $('[data-signout-here]', slot);
      if (here) here.addEventListener('click', () => busy(here, 'Signing out', () => signOut()));
      const revoke = $('[data-revoke]', slot);
      if (revoke) revoke.addEventListener('click', () => busy(revoke, 'Signing out', async () => {
        try {
          await api('/account/sessions/revoke-others', { method: 'POST', body: {} });
          toast('Other devices were signed out.', 'success');
          loadSessions(slot);
        } catch (err) { toast(err.message, 'error'); }
      }));
    } catch (err) { failed(slot, err, () => { slot.innerHTML = ''; loadSessions(slot); }, { small: true, what: 'Your signed-in devices' }); }
  }

  /** Saves one switch row. The app's answer (active or enabled) is believed over the switch; a failure puts it back. */
  async function saveSwitch(r, row, input, ctx) {
    const wanted = input.checked;
    input.disabled = true;
    try {
      const res = await (r.save ? r.save(input, row) : desktop[r.method](wanted));
      const now = res && typeof res.active === 'boolean' ? res.active : res && typeof res.enabled === 'boolean' ? res.enabled : wanted;
      input.checked = now;
      if (r.saved) r.saved(now, res);
      toast(r.said(now, res), now === wanted ? 'success' : 'info');
    } catch (err) { input.checked = !wanted; toast(desktopError(err), 'error'); }
    input.disabled = false;
    ctx.refresh();
  }

  /** One row's frame: its name, hint, state line, control and body. Settings draws every row; the first-run step a few. */
  function rowHTML(r) {
    const label = r.kind === 'switch' ? `<label class="set-row__label" id="set-${r.id}-l" for="set-${r.id}-c">${esc(r.label)}</label>` : `<h3 class="set-row__label" id="set-${r.id}-l">${esc(r.label)}</h3>`;
    return `<div class="set-row" id="${r.id}" data-set-row="${r.id}"><div class="set-fold">
      <div class="set-row__head"><div class="set-row__text">${label}<p class="set-row__hint" id="set-${r.id}-hint">${esc(r.hint)}</p><p class="set-row__state" data-set-state${r.seen ? ` data-${r.seen} role="status"` : ""}></p></div>
        <div class="set-row__control" data-set-control>${r.app && desktop ? '<span class="skeleton set-skel" aria-hidden="true"></span>' : ''}</div></div>
      <div class="set-row__body" data-set-body></div></div></div>`;
  }

  /* A row's control, state line and body, redrawn only when what they say changes, so focus stays put. */
  function paintRow(r, row, ctx) {
    const info = ctx.info;
    const why = r.why ? r.why(info) : '';
    const stateHTML = why ? `<span class="set-why">${esc(why)}</span>` : r.state ? esc(r.state(info) || '') : '';
    if (r.kind === 'block') {
      $('[data-set-state]', row).innerHTML = stateHTML;
      $('[data-set-control]', row).innerHTML = '';
      if (!why && !row._mounted) { row._mounted = true; r.mount($('[data-set-body]', row), ctx); }
      return;
    }
    const control = r.kind === 'switch'
      ? `<input class="switch" type="checkbox" id="set-${r.id}-c"${r.hook ? ` data-${r.hook}` : ""} aria-describedby="set-${r.id}-hint" ${!why && r.on(info) ? 'checked' : ''} ${why ? 'disabled' : ''}>`
      : why ? '' : r.control(info);
    const body = why || !r.body ? '' : r.body(info, ctx.data);
    const key = `${control}|${stateHTML}|${body}`;
    if (row._key === key) return;
    row._key = key;
    const focused = row.contains(document.activeElement) ? document.activeElement : null;
    const again = focused && (focused.id ? `#${focused.id}` : focused.dataset.seg ? `[data-seg="${focused.dataset.seg}"]` : null);
    $('[data-set-control]', row).innerHTML = control;
    const line = $('[data-set-state]', row);
    line.innerHTML = stateHTML;
    line.classList.toggle('is-down', Boolean(!why && r.down && r.down(info)));
    $('[data-set-body]', row).innerHTML = body;
    if (!why) {
      const input = r.kind === 'switch' ? $('.switch', row) : null;
      if (input) input.addEventListener('change', () => saveSwitch(r, row, input, ctx));
      if (r.bind) r.bind(row, info, ctx);
    }
    if (focused) { const back = (again && $(again, row)) || $('button, input, select, a', row); if (back) back.focus({ preventScroll: true }); }
  }

  function settingsView(el) {
    el.innerHTML = `${title('Settings', 'Every choice Sentinel offers, in one place. A change is saved the moment you make it.')}
      <div class="set" data-desktop>
        <nav class="set-rail" aria-label="Settings groups">${SETTING_GROUPS.map(([g, name], i) => `<a href="#${g}" data-set-go="${g}"${i ? '' : ' aria-current="true"'}>${name}</a>`).join('')}</nav>
        <div class="set-main">
          <div class="set-find">${ICON.search}<input class="input" type="search" placeholder="Find a setting" aria-label="Find a setting" aria-describedby="set-count" autocomplete="off" spellcheck="false" data-set-find></div>
          <p class="sr-only" id="set-count" role="status" data-set-count></p>
          ${desktop ? '' : `<div class="set-app"><p><b>Most of these work through the Sentinel app for Windows.</b> Here they say so instead of switching. Your account, plan and look work everywhere.</p><a class="btn btn--gold btn--sm" href="/download">${ICON.download}Download Sentinel</a></div>`}
          ${SETTING_GROUPS.map(([g, name]) => `<section class="set-group" id="${g}" data-set-group="${g}" aria-labelledby="set-g-${g}"><div class="set-fold">
            <h2 class="set-group__title" id="set-g-${g}">${name}</h2>${SETTINGS.filter((r) => r.group === g).map(rowHTML).join('')}</div></section>`).join('')}
          <div class="set-none" data-set-none hidden><p>Nothing matches.</p><button class="btn btn--sm" type="button" data-set-clear>Clear search</button></div>
        </div>
      </div>`;
    const box = $('[data-desktop]', el);
    box._off = [];
    const ctx = { info: null, ready: !desktop, data: { mine: [] }, offs: box._off, draw, refresh };
    const rowOf = (id) => $(`[data-set-row="${id}"]`, el);

    function draw() {
      if (!el.isConnected) return;
      for (const r of SETTINGS) if (!r.app || ctx.ready) paintRow(r, rowOf(r.id), ctx);
    }
    async function refresh() {
      if (!desktop) return draw();
      let info = null;
      try { info = await desktop.info(); state.desktopInfo = info; } catch { /* each row says the app did not answer */ }
      try { if (info && desktop.mySites) ctx.data.mine = await desktop.mySites(); } catch { /* none */ }
      ctx.info = info;
      ctx.ready = true;
      draw();
    }

    /* Search: rows that do not match fold away (a height spring, no fade) and leave the tab order. */
    const find = $('[data-set-find]', el);
    const none = $('[data-set-none]', el);
    const count = $('[data-set-count]', el);
    function filter() {
      const q = find.value.trim();
      let shown = 0;
      for (const r of SETTINGS) {
        const ok = !q || settingMatches(r, q);
        const row = rowOf(r.id);
        row.classList.toggle('is-out', !ok);
        row.inert = !ok;
        if (ok) shown += 1;
      }
      for (const [g] of SETTING_GROUPS) {
        const any = SETTINGS.some((r) => r.group === g && (!q || settingMatches(r, q)));
        const group = $(`[data-set-group="${g}"]`, el);
        group.classList.toggle('is-out', !any);
        group.inert = !any;
      }
      none.hidden = shown > 0;
      count.textContent = !q ? '' : shown ? `${shown} setting${shown === 1 ? '' : 's'} shown` : 'Nothing matches.';
    }
    function goTo(id, found) {
      const target = id && (SETTINGS.some((r) => r.id === id) || SETTING_GROUPS.some(([g]) => g === id)) ? $(`#${id}`, el) : null;
      if (!target) return;   // an unknown or old address: the page as it is
      target.scrollIntoView({ block: 'start', behavior: glide() });
      if (!found || !target.matches('.set-row')) return;
      target.classList.remove('is-found');
      void target.offsetWidth;
      target.classList.add('is-found');
      clearTimeout(target._found);
      target._found = setTimeout(() => target.classList.remove('is-found'), 2600);
    }
    find.addEventListener('input', filter);
    find.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && find.value) { ev.preventDefault(); find.value = ''; filter(); }
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      const first = SETTINGS.find((r) => settingMatches(r, find.value.trim()));
      if (first) goTo(first.id, true);
    });
    $('[data-set-clear]', el).addEventListener('click', () => { find.value = ''; filter(); find.focus(); });

    /* The group list: a link per group, the one in view marked. Jumping does not add a history entry per click. */
    const rail = $('.set-rail', el);
    rail.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-set-go]');
      if (!a) return;
      ev.preventDefault();
      history.replaceState(history.state, '', `#${a.dataset.setGo}`);
      goTo(a.dataset.setGo);
    });
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) $$('[data-set-go]', rail).forEach((a) => (a.dataset.setGo === e.target.id ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
      }, { rootMargin: '-15% 0px -75% 0px' });
      $$('[data-set-group]', el).forEach((g) => io.observe(g));
      box._off.push(() => io.disconnect());
    }

    /* The app says when something changed (the tray menu, another window, a parent lock): the rows follow. */
    if (desktop) {
      for (const [name, key] of [['onChatSafety', 'chatSafety'], ['onTextSafety', 'textSafety'], ['onLive', 'live'], ['onCommand', 'commandHeld']]) {
        if (!desktop[name]) continue;
        const off = desktop[name]((v) => { if (ctx.info && v !== undefined) { ctx.info[key] = v; draw(); } });
        if (typeof off === 'function') box._off.push(off);
      }
      for (const name of ['onSettings', 'onUpdate', 'onDefense']) {
        if (!desktop[name]) continue;
        const off = desktop[name](() => refresh());
        if (typeof off === 'function') box._off.push(off);
      }
    }
    draw();
    // After the rows have their real size, so the row asked for lands where it should.
    const arrived = location.hash.slice(1);
    const settle = () => requestAnimationFrame(() => goTo(arrived, true));
    if (desktop) refresh().then(settle); else settle();
  }


  function render2fa(slot) {
    const on = state.me.user.twoFactorEnabled;
    slot.innerHTML = `<p class="panel-lede">${on ? 'On. Signing in needs a code from your authenticator app.' : 'Add a second step to sign-in with Google Authenticator, 1Password, Authy or any authenticator app.'}</p>
      <div data-2fa-body>${on
        ? '<form data-disable><div class="field"><label for="tfa-off">Enter a current code to turn it off</label><input class="input code-input" id="tfa-off" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required></div>' + (state.me.user.hasPassword ? '<div class="field"><label for="tfa-off-pw">Your password</label><input class="input" id="tfa-off-pw" type="password" name="password" autocomplete="current-password" required></div>' : '') + '<button class="btn u-mt-sm" type="submit">Turn off two-factor</button></form>'
        : '<button class="btn btn--gold" data-setup>Set up two-factor</button>'}</div>`;

    const setup = $('[data-setup]', slot);
    if (setup) setup.addEventListener('click', () => busy(setup, 'Preparing', async () => {
      try {
        const { secret, uri } = await api('/account/2fa/setup', { method: 'POST', body: {} });
        $('[data-2fa-body]', slot).innerHTML = `
          <ol class="steps-list">
            <li>Open your authenticator app and add an account with this key${/Mobi/.test(navigator.userAgent) ? `, or <a href="${esc(uri)}" class="u-gold">tap here</a>` : ''}:</li>
          </ol>
          <div class="secret"><span>${esc(secret.match(/.{1,4}/g).join(' '))}</span><button class="btn btn--sm" type="button" data-copy>Copy</button></div>
          <form data-enable class="u-mt-sm"><div class="field"><label for="tfa-on">Then enter the 6-digit code it shows</label><input class="input code-input" id="tfa-on" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required></div>
          ${state.me.user.hasPassword ? '<div class="field"><label for="tfa-pw">Your password</label><input class="input" id="tfa-pw" type="password" name="password" autocomplete="current-password" required><span class="field__hint">Turning this on signs out your other devices, so Sentinel checks that it is you.</span></div>' : ''}
          <button class="btn btn--gold u-mt-sm" type="submit">Turn on</button></form>`;
        $('[data-copy]', slot).addEventListener('click', async () => { await navigator.clipboard.writeText(secret); toast('Key copied.', 'success'); });
        $('[data-enable]', slot).addEventListener('submit', async (ev) => {
          ev.preventDefault();
          await busy($('button[type=submit]', ev.target), 'Checking', async () => {
            try {
              const data = await api('/account/2fa/enable', { method: 'POST', body: { code: ev.target.code.value, password: ev.target.password ? ev.target.password.value : '' } });
              state.me.user = data.user;
              toast('Two-factor authentication is on.', 'success');
              render2fa(slot);
            } catch (err) { toast(err.message, 'error'); }
          });
        });
      } catch (err) { toast(err.message, 'error'); }
    }));

    const disable = $('[data-disable]', slot);
    if (disable) disable.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      await busy($('button', disable), 'Turning off', async () => {
        try {
          const data = await api('/account/2fa/disable', { method: 'POST', body: { code: disable.code.value, password: disable.password ? disable.password.value : '' } });
          state.me.user = data.user;
          toast('Two-factor authentication is off.', 'info');
          render2fa(slot);
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  /* ========================================================== assistants */

  const MARKS = { chatgpt: 'GPT', claude: 'Cl', gemini: 'Gm', deepseek: 'DS' };
  const chats = {};

  async function assistantsView(el, params) {
    el.innerHTML = `${title('AI assistants', 'Optional. Ask ChatGPT, Claude, Gemini or DeepSeek about anything. Sentinel\'s scans never depend on them.')}
      <div data-tabs><div class="skeleton skeleton--tabs"></div></div><div class="panel" data-pane id="ai-pane" role="tabpanel">${skel('assistants')}</div>`;
    let providers;
    try { ({ providers } = await api('/ai/providers')); } catch (err) { $('[data-tabs]', el).innerHTML = ''; failed($('[data-pane]', el), err, () => assistantsView(el, params), { what: 'The assistants' }); return; }
    const active = providers.find((p) => p.id === params.get('ai')) || providers[0];

    $('[data-tabs]', el).innerHTML = `<div class="ai-tabs" role="tablist">${providers.map((p) => `
      <button class="ai-tab" role="tab" id="ai-tab-${p.id}" aria-controls="ai-pane" style="--accent:${esc(p.accent)}" aria-selected="${p.id === active.id}" data-ai="${p.id}">
        <span class="ai-tab__mark">${MARKS[p.id]}</span>${esc(p.name)}<span class="ai-tab__dot${p.connected ? ' is-on' : ''}"></span>
      </button>`).join('')}</div>`;
    $$('[data-ai]', el).forEach((b) => b.addEventListener('click', () => navigate(`/app/assistants?ai=${b.dataset.ai}`)));

    const pane = $('[data-pane]', el);
    pane.setAttribute('aria-labelledby', `ai-tab-${active.id}`);
    pane.style.setProperty('--accent', active.accent);
    if (active.connected) renderChat(pane, active, el);
    else renderConnect(pane, active);
    keep(pane, 'assistants');
  }

  function renderConnect(pane, p) {
    pane.innerHTML = `
      <div class="connect-head"><span class="ai-tab__mark ai-tab__mark--lg" style="--accent:${esc(p.accent)}">${MARKS[p.id]}</span>
        <div><h2>Connect ${esc(p.name)}</h2><p class="note">Uses ${esc(p.vendor)}'s official API with a key from your own account &middot; <span class="mono">${esc(p.model)}</span></p></div></div>
      <ol class="steps-list">
        <li>Open <a href="${esc(p.keyUrl)}" target="_blank" rel="noopener noreferrer" class="u-gold">${esc(new URL(p.keyUrl).host)}</a> and sign in to ${esc(p.vendor)} there.</li>
        <li>Create an API key and copy it.</li>
        <li>Paste it below. Sentinel checks it with ${esc(p.vendor)} and stores it encrypted.</li>
      </ol>
      <form class="scanbox" data-connect data-no-draft>${ICON.lock}<input name="apiKey" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your ${esc(p.vendor)} API key" aria-label="${esc(p.vendor)} API key" data-no-draft required><button class="btn btn--gold" type="submit">Connect</button></form>
      <p class="note u-mt">Sentinel never asks for your ${esc(p.vendor)} password. A login form for another company inside our app is exactly what we warn you about.</p>`;
    $('[data-connect]', pane).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      await busy($('button', ev.target), 'Verifying', async () => {
        try {
          await api('/ai/connect', { method: 'POST', body: { provider: p.id, apiKey: ev.target.apiKey.value.trim() } });
          toast(`${p.name} connected.`, 'success');
          render();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  function renderChat(pane, p, el) {
    const log = chats[p.id] || (chats[p.id] = []);
    pane.innerHTML = `
      <div class="panel__head"><div><h2>${esc(p.name)}</h2><p>Connected &middot; key ${esc(p.label || '')} &middot; <span class="mono">${esc(p.model)}</span></p></div><button class="btn btn--sm" data-disconnect>Disconnect</button></div>
      <div class="chat"><div class="chat__log" data-log></div>
        <form class="chat__form" data-send><textarea class="textarea" name="message" rows="1" placeholder="Ask ${esc(p.name)} anything" aria-label="Message to ${esc(p.name)}" required></textarea><button class="btn btn--gold" type="submit">Send</button></form></div>`;
    const logEl = $('[data-log]', pane);
    const paint = () => {
      logEl.innerHTML = log.length ? log.map((m) => `<div class="msg msg--${m.role === 'user' ? 'user' : 'ai'}${m.error ? ' msg--error' : ''}"><span class="msg__who">${m.role === 'user' ? esc(state.me.user.firstName[0]) : MARKS[p.id]}</span><div class="msg__body">${esc(m.content)}</div></div>`).join('')
        : '<p class="muted">Nothing here yet.</p>';
      logEl.scrollTop = logEl.scrollHeight;
    };
    paint();
    const form = $('[data-send]', pane);
    form.message.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); form.requestSubmit(); } });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const content = form.message.value.trim();
      // While a reply is on its way the text stays in the box: it is sent with the next press, not lost or doubled.
      if (!content || $('button', form).dataset.busy) return;
      log.push({ role: 'user', content });
      form.message.value = '';
      paint();
      await busy($('button', form), '', async () => {
        try {
          const data = await api('/ai/chat', { method: 'POST', body: { provider: p.id, messages: log.filter((m) => !m.error).slice(-20) } });
          log.push({ role: 'assistant', content: data.reply });
        } catch (err) { log.push({ role: 'assistant', content: err.message, error: true }); }
        paint();
      });
    });
    $('[data-disconnect]', pane).addEventListener('click', async () => {
      try { await api('/ai/disconnect', { method: 'POST', body: { provider: p.id } }); }
      catch (err) { toast(err.message, 'error'); return; }
      chats[p.id] = [];
      render();
    });
    void el;
  }

  boot();
})();
