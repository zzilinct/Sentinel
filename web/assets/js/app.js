/* Sentinel web app. */
(() => {
  'use strict';

  const { api, esc, $, $$, h, ago, until, bytes, toast, stateBlock, busy, verdict, resultGlyph, wireVerdict, status } = window.UI;
  const Masks = window.SentinelMasks;
  const view = $('#view');
  // The stylesheets, preloaded while the side bar painted from the first view's own styles (server/lib/critical.js):
  // put in, in the page's order, before anything is drawn into the page.
  const styled = Promise.all($$('link[data-late]').map((pre) => new Promise((done) => {
    const sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = pre.getAttribute('href');
    sheet.onload = sheet.onerror = done;
    pre.after(sheet);
  })));
  const desktop = window.sentinelDesktop || null;
  // Motion Off (boot.js data-motion): nothing glides or rises. Asked each time: it can change while the app is open.
  const still = () => document.documentElement.dataset.motion === 'off';
  const glide = () => (still() ? 'auto' : 'smooth');

  // shared: what was handed to the Check page (checkView) from elsewhere: the phone's Share menu, the Overview box, the
  // palette. shareBox: the share a POST to /app/share put in the box for this page (sw.js gives its time as ?box=); 0 when none.
  const state = { me: null, config: null, plans: null, desktopInfo: null, shared: null, shareBox: 0 };
  const Share = window.SentinelShare;
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
      if (/^\d{1,15}$/.test(q.get('box') || '')) { state.shareBox = Number(q.get('box')); history.replaceState({}, '', '/app/share'); }
      if (['title', 'text', 'url'].some((k) => q.get(k))) {
        try { await Share.put({ title: q.get('title') || '', text: q.get('text') || '', url: q.get('url') || '' }); } catch { /* read below, from the address */ }
        history.replaceState({}, '', '/app/share');
        if (!q.has('missed')) state.shared = { query: q };
      }
    }
    // Whether a share waits (below) is asked beside the account, not after it: opening the share box can take a
    // tenth of a second, and the first screen waited for it. Only a share older than FRESH_MS is ever emptied by it.
    const waitingShare = location.pathname.replace(/\/$/, '') !== '/app/share' ? Share.waiting().catch(() => false) : Promise.resolve(false);
    // The open page's file comes beside the account too; on the Overview, the first-run choices' small file the first
    // time, and in the Windows app Settings' file for its offers (which brings the first-run file before it).
    const first = fileFor(location.pathname) || (desktop ? 'settings' : !firstDone() && 'first');
    if (first) pageFile(first).catch(() => { /* the page says so when it opens */ });
    await styled;
    try {
      const [me, config] = await Promise.all([api('/auth/me'), api('/auth/config')]);
      state.me = me;
      state.config = config;
      state.plans = config.plans;
      // Signed in: the look this account chose on its other devices (look.js), without waiting for it.
      if (window.SentinelLook && SentinelLook.sync) SentinelLook.sync();
      // Signed in on any other page: a share made signed out moments ago (in another tab, or before signing in here)
      // opens its check here; anything older is emptied out. Signed out, it is left waiting for the sign-in.
      if (await waitingShare) history.replaceState({}, '', '/app/share');
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
    document.addEventListener('pointerover', prefetch, { passive: true });
    document.addEventListener('focusin', prefetch);
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

  /*
   * Every page but the Overview and Your week is a file of its own (assets/js/app/), fetched the first time it opens,
   * with the scripts and styles only it uses, so the first screen waits for none of them. The open page's file is
   * asked for at once, beside the account; a link pointed at or focused starts its page's file, so it is usually here
   * before the press. 'first' is the first-run choices and the row frame (a few KB): all a first visit's Overview
   * waits for. Settings draws its rows with them, so its file comes after them.
   */
  const FILES = {
    check: ['/assets/js/binary.js', '/assets/js/textshot.js', '/assets/js/warncard.js'],
    history: [], sites: [], checkup: ['/assets/js/recover.js'], plan: [], assistants: [],
    first: ['/assets/css/settings.css'],
    settings: ['/assets/js/app/first.js', '/assets/css/settings.css']
  };
  const fetched = {};
  function fetchOnce(src) {
    if (!fetched[src]) {
      fetched[src] = new Promise((resolve, reject) => {
        const css = src.endsWith('.css');
        const tag = document.createElement(css ? 'link' : 'script');
        // Scripts run in the order they are asked for (async off), however they arrive: a page's file after its own.
        if (css) { tag.rel = 'stylesheet'; tag.href = src; } else { tag.async = false; tag.src = src; }
        tag.onload = resolve;
        // Asked for again next time, not remembered as failed. Whether the connection is down, fetch itself says.
        tag.onerror = () => {
          delete fetched[src];
          tag.remove();
          fetch(src, { method: 'HEAD', cache: 'no-store' }).then(() => false, () => true)
            .then((offline) => reject(Object.assign(new Error('This page could not be loaded. Try again in a moment.'), { offline })));
        };
        document.head.append(tag);
      });
    }
    return fetched[src];
  }
  const loaded = {};
  const pageFile = (file) => Promise.all([...FILES[file], `/assets/js/app/${file}.js`].map(fetchOnce)).then(() => { loaded[file] = true; return App.pages; });
  // A page in a file of its own: drawn at once when its file is here, else as soon as it arrives.
  const page = (file, fn) => Object.assign((el, params) => {
    if (loaded[file]) { App.pages[fn](el, params); return; }
    pageFile(file).then(() => { if (!el.isConnected) return; App.pages[fn](el, params); restoreDrafts(); },
      (err) => failed(el, err, render, { what: 'This page' }));
  }, { file });

  const ROUTES = {
    '/app': ['home', home],
    '/app/week': ['week', weekView],
    '/app/check': ['check', page('check', 'checkView')],
    '/app/scan': ['check', page('check', 'checkView')],
    '/app/threats': ['check', page('check', 'checkView')],
    '/app/email': ['check', page('check', 'checkView')],
    '/app/text': ['check', page('check', 'checkView')],
    '/app/history': ['history', page('history', 'historyView')],
    '/app/protection': ['protection', page('settings', 'protectionView')],
    '/app/download': ['protection', page('settings', 'protectionView')],
    '/app/plan': ['plan', page('plan', 'planView')],
    '/app/settings': ['settings', page('settings', 'settingsView')],
    '/app/assistants': ['assistants', page('assistants', 'assistantsView')],
    '/app/sites': ['sites', page('sites', 'sitesView')],
    '/app/checkup': ['checkup', page('checkup', 'checkupView')],
    '/app/recover': ['recover', page('checkup', 'recoverView')],
    '/app/share': ['share', page('check', 'shareView')]
  };
  const fileFor = (href) => { const r = ROUTES[href.split(/[?#]/)[0].replace(/\/$/, '')]; return r && r[1].file; };
  const prefetch = (ev) => {
    const a = ev.target.closest && ev.target.closest('a[href^="/app"]');
    const file = a && fileFor(a.getAttribute('href'));
    if (file) pageFile(file).catch(() => { /* asked again when the page opens */ });
  };
  // Whether the first-run choices were made on this device (Settings' firstChoices keeps it under this key). Storage
  // that cannot be used never shows them.
  const FIRST_KEY = 'sentinel:first-choices';
  const firstDone = () => { try { return Boolean(localStorage.getItem(FIRST_KEY)); } catch { return true; } };

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
    // The Overview's first view, if the server drew it into the page (server/lib/appshell.js), stays as it is: it is
    // what the person has been looking at, and home() carries on below it. Any other page clears it.
    const drawn = name === 'home' && !state.me.user.needsTerms ? $('.view[data-shell=""]', view) : null;
    if (!drawn) view.innerHTML = '';
    const el = drawn || document.createElement('div');
    el.className = 'view';
    // Accounts that still owe the age confirmation and terms acceptance see
    // nothing else until they've given it. Google sign-ups land here.
    if (state.me.user.needsTerms) { view.appendChild(el); termsGate(el); return; }
    // The reminder lives beside the view, not inside it: every view replaces its own innerHTML.
    const bar = state.config.verificationAvailable && !state.me.user.emailVerified ? verifyBar() : null;
    if (drawn) {
      $$('.verify-bar[data-shell]', view).forEach((b) => { if (b !== bar) b.remove(); });
      if (bar && !bar.isConnected) view.insertBefore(bar, el);
      // app-lux.js: what is on screen is not staged to arrive again; the page's entrance starts from here.
      document.dispatchEvent(new Event('sentinel:shell'));
      el.dataset.shell = 'kept';   // still the server's (its entrance is CSS on this mark), no longer waiting to be taken
    } else {
      if (bar) view.appendChild(bar);
      view.appendChild(el);
    }
    fn(el, new URLSearchParams(location.search));
    // Every view draws its forms synchronously before it waits on anything, so what was typed can go back in now.
    restoreDrafts();
    document.title = `${{ home: 'Overview', week: 'Your week', check: 'Check', call: 'Is this call a scam?', history: 'History', protection: 'Live protection', plan: 'Plan & usage', settings: 'Settings', assistants: 'AI assistants', sites: 'Site rules', checkup: 'Browser checkup', recover: 'Recovery guide', share: 'Shared with Sentinel' }[name]} · Sentinel`;
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
   * the last time it loaded on this device at this width (kept by `keep`), or, the first time, what a new account
   * sees there (`ghost`), drawn unseen inside the wait, so its height comes from the layout itself at any width, text
   * size or spacing. Its data-* marks are taken off: nothing that looks for the real part finds the ghost.
   * Kept on this device only; with storage blocked, the first-time height.
   */
  const HEIGHTS = 'sentinel:heights';
  const heightKey = (key) => `${key}:${innerWidth < 700 ? 'phone' : 'wide'}`;
  const heights = () => { try { return JSON.parse(localStorage.getItem(HEIGHTS) || '{}') || {}; } catch { return {}; } };
  // Past 8 seconds a wait says so, with Try again, which draws the page again (app.css shows it late; no timer).
  const LATE = '<p class="skeleton__late">This is taking longer than usual. <button class="btn btn--sm" type="button" data-skel-again>Try again</button></p>';
  function skel(key, ghost) {
    const h = Number(heights()[heightKey(key)]) || 0;
    const kept = h > 0 && h < 4000;
    const unseen = kept ? '' : `<div class="skeleton__ghost" aria-hidden="true" inert>${ghost.replace(/ data-[\w-]+(="[^"]*")?/g, '')}</div>`;
    return `<div class="skeleton" data-skel="${key}"${kept ? ` style="height:${h}px"` : ''}>${unseen}${LATE}</div>`;
  }
  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('[data-skel-again]')) return;
    render();
    const heading = $('#view h1');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  });
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
    // The settings it finds are Settings' own rows, from Settings' file.
    if (!loaded.settings) pageFile('settings').then(() => { if (palette && palette.contains(input)) paint(); }, () => { /* pages and links are still found */ });

    const paint = () => {
      const q = input.value.trim();
      const { SETTINGS = [], settingMatches } = App.pages;
      items = [];
      if (q && looksLikeUrl(q)) items.push({ label: `Check ${q}`, hint: 'Link', href: `/app/check?url=${encodeURIComponent(q)}`, icon: ICON.link });
      // Words, not a page's name: a message or a number to check (route.js says which).
      else if (q && ((/\s/.test(q) && q.length >= 20) || window.SentinelRoute.guess({ text: q }) === 'number')) {
        const kind = window.SentinelRoute.guess({ text: q });
        items.push({ label: 'Check what you pasted', hint: kind === 'number' ? 'Phone number' : 'Message', run: () => { state.shared = { text: q }; navigate('/app/check'); }, icon: ICON.search });
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
    toast('Shortcuts: / goes to the scan box (on Settings, its search), Ctrl+K opens search, Esc closes, ? shows this.', 'info', 6000);
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
        // On Settings it finds a setting; everywhere else it is the scan box.
        const box = $('[data-set-find]') || $('[data-check-text]') || $('.scanbox input');
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
    // The server's own, when it drew one (appshell.js); else the page's template (app.html), which it is drawn from.
    const bar = $('.verify-bar[data-shell=""]', view) || h($('#verify-bar').innerHTML);
    if (bar.hasAttribute('data-shell')) bar.dataset.shell = 'kept';
    $('[data-email]', bar).textContent = state.me.user.email;
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
        + (kind ? `<span class="kind-icon" ${status(badge)} title="${esc(name)}">${Masks.kindIcon(kind)}</span>` : '');
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

  // The model running here, beneath the logo: a quiet reminder, and the way to the picker. A phone's bar hides it
  // (app.css, 900px), so there it is asked for only once the window is wide enough to show it.
  const wide = matchMedia('(min-width: 901px)');
  async function paintModelBadge() {
    const badge = $('[data-model-badge]');
    if (!badge) return;
    if (!wide.matches) { wide.addEventListener('change', paintModelBadge, { once: true }); return; }
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
    // The first-run choices are Settings' own rows, in a small file of their own (app/first.js): that one first time,
    // the page waits for it (asked for beside the account), so they are there from the first frame and nothing below
    // them moves. Never for all of Settings.
    if (!firstDone() && !App.pages.firstChoices) {
      try { await pageFile('first'); } catch { /* the choices wait for the next visit */ }
      if (!el.isConnected) return;
    }
    const u = state.me.user;
    const f = plan().features;
    const us = usage();
    const hour = new Date().getHours();
    const part = hour < 5 ? 'late' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    const greet = { late: 'Up late', morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' }[part];

    // Its top is the server's, already drawn into the page; opened from another page it is drawn here from the same
    // template, without the rule that the page's own copy carries (app-lux.js dresses a heading with it as it arrives).
    if (!$('.page-title', el)) {
      el.innerHTML = $('#home-top').innerHTML;
      $('h1', el).removeAttribute('data-lux');
      $('.lux-rule', el).remove();
    }
    $('h1', el).textContent = `${greet}, ${u.firstName}`;
    document.documentElement.dataset.part = part;
    el.insertAdjacentHTML('beforeend', `
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
        <div data-recent>${skel('recent', historyList([]))}</div>
      </div>`);

    weekCard($('[data-week-card]', el));
    // One offer at a time: the first-run choices, then chat safety, then exposure alerts, each on a later visit.
    const chatAsk = $('[data-chat-ask]', el);
    // The offers are drawn by Settings' file: in a browser, once the choices are made, the Overview never needs it.
    const extras = ({ askChatSafety, askExposureAlerts }) => {
      // A failure says so quietly in the offer's place (askChatSafety), with Try again running both offers again.
      const offers = () => { chatAsk.innerHTML = ''; return askChatSafety(chatAsk, offers).then(() => { if (!chatAsk.innerHTML) askExposureAlerts($('[data-exposure-ask]', el)); }); };
      offers();
    };
    // One prompt at a time: while the first-run step shows, the offers wait for a later visit.
    const firstShown = Boolean(App.pages.firstChoices && App.pages.firstChoices($('[data-first]', el)));
    if (!firstShown && loaded.settings) extras(App.pages);
    else if (!firstShown && desktop) pageFile('settings').then((pages) => { if (el.isConnected) extras(pages); }, () => { /* offered on a later visit */ });
    $('[data-quick]', el).addEventListener('submit', (ev) => {
      ev.preventDefault();
      const url = ev.target.url.value.trim();
      if (!url) return;
      // A link opens under its own address (Back and reload keep it); anything else is carried over in memory, never in the address.
      if (looksLikeUrl(url)) navigate(`/app/check?url=${encodeURIComponent(url)}`);
      else { state.shared = { text: url }; navigate('/app/check'); }
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
      catch (err) { failed(slot, err, () => { slot.innerHTML = skel('recent', historyList([])); recent(); }, { small: true, what: 'Your recent scans' }); }
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

  // A new account's week, as the server words it: what the first wait on Your week is drawn from.
  const NEW_WEEK = Array.from({ length: 4 }, () => ({ headline: 'Nothing to report yet this week', checked: 0, caught: 0, counts: {}, startsAt: 0 }));

  async function weekView(el) {
    el.innerHTML = `${title('Your week with Sentinel', 'What Sentinel did for you, Monday to Sunday. Only real counts, never what the links, files or messages were.')}
      <div data-week>${skel('week', weekHTML(NEW_WEEK))}</div>`;
    const slot = $('[data-week]', el);
    let data;
    // In the Windows app the week comes from the app, whose own message is plain already (desktopError).
    try { data = await loadWeek(); } catch (err) {
      failed(slot, desktop && desktop.week && !err.offline ? { message: desktopError(err) } : err, () => weekView(el), { what: 'Your week' });
      return;
    }
    if (!slot.isConnected) return;
    slot.innerHTML = weekHTML(data.weeks);
    keep(slot, 'week');
  }

  function weekHTML(weeks) {
    const w = weeks[weeks.length - 1];
    const before = weeks[weeks.length - 2];
    const rows = WEEK_ROWS.filter(([k]) => weeks.some((x) => x.counts[k] > 0));
    // The bars show what was caught; in weeks that were all quiet, how much was checked.
    const caughtAny = weeks.some((x) => x.caught > 0);
    const val = (x) => (caughtAny ? x.caught : x.checked);
    const top = Math.max(1, ...weeks.map(val));
    return `
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

  // What the page files (assets/js/app/) take from here, and where they leave their pages.
  const App = window.SentinelApp = {
    FIRST_KEY, state, Masks, desktop, glide, still, Share, plan, iphone, IPHONE_NOTE, ICON, title, left, failed,
    paintAccount, navigate, render, signOut, applyUsage, usage, uncapped, hours, restoreDrafts, desktopError, LATE,
    skel, keep, simpleView, lockedCard, linkSteps, EMAIL_STEPS, TEXT_STEPS, FILE_STEPS, watchScan, historyList,
    localNote, liveCard, usageCard, scanCards, updateText, mountModels, modelSlot, guardiansHTML, friendlyError,
    fetchOnce, pages: {}
  };

  boot();
})();
