/* Sentinel web app. */
(() => {
  'use strict';

  const { api, esc, $, $$, h, ago, until, bytes, toast, busy, verdict, wireVerdict, color } = window.UI;
  const Masks = window.SentinelMasks;
  const view = $('#view');
  const desktop = window.sentinelDesktop || null;

  const state = { me: null, config: null, plans: null, desktopInfo: null };

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
    try {
      const [me, config] = await Promise.all([api('/auth/me'), api('/auth/config')]);
      state.me = me;
      state.config = config;
      state.plans = config.plans;
    } catch (err) {
      if (err.status === 401) {
        location.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
        return;
      }
      view.innerHTML = `<div class="banner banner--error"><b>Sentinel could not load.</b>&nbsp;${esc(err.message)}</div>`;
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
    addEventListener('popstate', render);
    $('[data-signout]').addEventListener('click', signOut);
    wireShortcuts();
    render();
  }

  function navigate(href) {
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
    $('[data-max-pill]').hidden = plan().features.emailManual;

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
    '/app/scan': ['scan', scanView],
    '/app/threats': ['threats', threatsView],
    '/app/email': ['email', emailView],
    '/app/text': ['text', textView],
    '/app/call': ['call', callView],
    '/app/history': ['history', historyView],
    '/app/protection': ['protection', protectionView],
    '/app/download': ['protection', protectionView],
    '/app/plan': ['plan', planView],
    '/app/security': ['security', securityView],
    '/app/assistants': ['assistants', assistantsView],
    '/app/sites': ['sites', sitesView],
    '/app/checkup': ['checkup', checkupView],
    '/app/recover': ['recover', recoverView]
  };

  function render() {
    const path = location.pathname.replace(/\/$/, '') || '/app';
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
    document.title = `${{ home: 'Overview', week: 'Your week', scan: 'Link scan', threats: 'Virus & malware', email: 'Email scan', text: 'Text scan', call: 'Is this call a scam?', history: 'History', protection: 'Live protection', plan: 'Plan & usage', security: 'Security', assistants: 'AI assistants', sites: 'Site rules', checkup: 'Browser checkup', recover: 'Recovery guide' }[name]} · Sentinel`;
  }

  /** Render a verdict with its checklist tools and follow-up actions. */
  function showVerdict(out, v, opts = {}) {
    out.innerHTML = verdict(v, opts) + actionsFor(v);
    wireVerdict(out, v);
    wireActions(out, v);
    restoreDrafts();
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

  /* ========================================================== shortcuts */

  const PAGES = [
    ['Overview', '/app', 'home'], ['Your week', '/app/week', 'week'], ['Link scan', '/app/scan', 'scan'], ['Virus & malware scan', '/app/threats', 'threats'],
    ['Email scan', '/app/email', 'email'], ['Text scan', '/app/text', 'text'], ['Is this call a scam?', '/app/call', 'call'], ['History', '/app/history', 'history'], ['Site rules', '/app/sites', 'sites'], ['Browser checkup', '/app/checkup', 'checkup'],
    ['Live protection', '/app/protection', 'protection'], ['Plan & usage', '/app/plan', 'plan'], ['Security', '/app/security', 'security'],
    ['AI assistants', '/app/assistants', 'assistants'], ['Recovery guide', '/app/recover', 'recover']
  ];
  const looksLikeUrl = (s) => /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(s.trim()) || /^https?:\/\/\S+$/i.test(s.trim());

  let palette = null;
  function openPalette(prefill = '') {
    if (palette) { palette.remove(); palette = null; }
    palette = h(`<div class="palette" role="dialog" aria-modal="true" aria-label="Search or scan">
      <div class="palette__box">
        <div class="palette__input">${ICON.search}<input type="text" placeholder="Paste a link to scan, or jump to a page" aria-label="Search" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>
        <ul class="palette__list" role="listbox"></ul>
        <div class="palette__foot"><span><kbd>&uarr;</kbd><kbd>&darr;</kbd> move</span><span><kbd>&crarr;</kbd> open</span><span><kbd>/</kbd> scan box &middot; <kbd>?</kbd> shortcuts</span></div>
      </div>
    </div>`);
    document.body.appendChild(palette);
    const input = $('input', palette);
    const list = $('.palette__list', palette);
    let items = [];
    let active = 0;
    let recent = [];
    api('/account/history').then((d) => { recent = d.items.filter((i) => i.kind === 'url').slice(0, 30); paint(); }).catch(() => {});

    const paint = () => {
      const q = input.value.trim();
      items = [];
      if (q && looksLikeUrl(q)) items.push({ label: `Scan ${q}`, hint: 'Link scan', href: `/app/scan?url=${encodeURIComponent(q)}`, icon: ICON.link });
      for (const [label, href] of PAGES) if (!q || label.toLowerCase().includes(q.toLowerCase())) items.push({ label, hint: 'Page', href, icon: ICON.shield });
      for (const r of recent) if (q && r.target.toLowerCase().includes(q.toLowerCase())) items.push({ label: r.target, hint: 'Scan again', href: `/app/scan?url=${encodeURIComponent(r.target)}`, icon: ICON.clock });
      items = items.slice(0, 9);
      active = Math.min(active, Math.max(0, items.length - 1));
      list.innerHTML = items.length ? items.map((it, i) => `<li role="option" aria-selected="${i === active}" data-i="${i}"><span class="palette__icon">${it.icon}</span><span class="palette__label">${esc(it.label)}</span><span class="palette__hint">${esc(it.hint)}</span></li>`).join('')
        : '<li class="palette__empty">Nothing matches. Paste a link to scan it.</li>';
    };
    const go = () => { const it = items[active]; if (!it) return; closePalette(); navigate(it.href); };
    input.addEventListener('input', () => { active = 0; paint(); });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); active = (active + 1) % Math.max(1, items.length); paint(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); active = (active - 1 + items.length) % Math.max(1, items.length); paint(); }
      else if (ev.key === 'Enter') { ev.preventDefault(); go(); }
    });
    list.addEventListener('click', (ev) => { const li = ev.target.closest('[data-i]'); if (li) { active = Number(li.dataset.i); go(); } });
    palette.addEventListener('click', (ev) => { if (ev.target === palette) closePalette(); });
    input.value = prefill;
    paint();
    input.focus();
    input.select();
  }
  function closePalette() { if (palette) { palette.remove(); palette = null; } }

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
        const box = $('.scanbox input');
        if (box) { box.focus(); box.select(); } else navigate('/app/scan');
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
      <span><b>Confirm your email address.</b> We sent a link to ${esc(state.me.user.email)}. Until it's confirmed you can't recover this account if you forget your password.</span>
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
      <div><span class="locked__tag">${ICON.lock}${esc(tag)}</span><h3>${esc(heading)}</h3><p>${body}</p></div>
      <div class="locked__actions">${actions}</div>
    </div>`;
  }

  function stagesView(research) {
    const steps = [['knowledge', 'Checking known threat sources'], ['checklist', 'Running the checklist'], ['compare', 'Comparing with known scams'], ['research', research ? 'Researching the site' : 'Research (Pro & up)']];
    return `<div class="panel scanning" data-scanning>
      <div class="scanning__rings">${Masks.svg('scam')}</div>
      <h3>Scanning</h3>
      <ol class="stages">${steps.map(([k, label]) => `<li data-stage="${k}" class="${!research && k === 'research' ? 'is-skip' : ''}"><i></i>${label}</li>`).join('')}</ol>
    </div>`;
  }

  /** Animate the stage list while a scan is in flight. */
  function runStages(root, research) {
    const order = ['knowledge', 'checklist', 'compare', ...(research ? ['research'] : [])];
    let i = 0;
    const step = () => {
      $$('[data-stage]', root).forEach((li) => {
        const idx = order.indexOf(li.dataset.stage);
        if (idx < 0) return;
        li.classList.toggle('is-done', idx < i);
        li.classList.toggle('is-active', idx === i);
      });
      if (i < order.length - 1) i++;
    };
    step();
    const timer = setInterval(step, research ? 900 : 380);
    return () => clearInterval(timer);
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
      return `<div class="empty">${Masks.svg('scam')}<p>No scans yet. Paste a link above to run your first one.</p></div>`;
    }
    return `<ul class="list">${items.map((it) => {
      const link = clickable && it.kind === 'url';
      return `
      <li class="${link ? 'is-link' : ''}" ${link ? `data-rescan="${esc(it.target)}" tabindex="0" role="button" title="Scan again"` : ''}>
        <span class="list__icon">${it.kind === 'file' ? ICON.file : it.kind === 'email' ? ICON.mail : ICON.link}</span>
        <span class="list__main"><b class="${it.kind === 'url' ? 'mono' : ''}">${esc(it.target)}</b><span>${esc(it.mode === 'live' ? 'Live' : 'Manual')} ${esc({ url: 'link', file: 'file', email: 'email' }[it.kind] || it.kind)} scan &middot; ${ago(it.created_at)}</span></span>
        <span class="list__masks">${masksFor(it) || '<span class="status is-on">Clear</span>'}</span>
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
    return `<a class="usage-link" href="/app/scan" aria-label="Link scan">${fastCard}</a><a class="usage-link" href="/app/scan" aria-label="Delicate link scan">${deepCard}</a>`;
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
    try { cat = cached || await api('/models'); } catch { slot.innerHTML = '<p class="muted">The list of models is unavailable right now.</p>'; return; }
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
    if (err.code === 'model_requires_plan') {
      return `<div class="banner"><div><b>${esc(err.message)}</b> Choose a model above, or <a href="/app/plan" class="u-gold">compare plans</a>.</div></div>`;
    }
    if (err.code === 'weekly_limit_reached') {
      return `<div class="banner"><div><b>You have used this week's scans.</b> Your ${esc(err.extra.plan)} plan resets ${until(err.extra.resetsAt)}. <a href="/app/plan" class="u-gold">See plans</a></div></div>`;
    }
    if (err.code === 'plan_required') {
      return `<div class="banner"><div><b>${esc(err.message)}</b> <a href="/app/plan" class="u-gold">Compare plans</a></div></div>`;
    }
    return `<div class="banner banner--error"><div><b>Scan failed.</b> ${esc(err.message)}</div></div>`;
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
        <input name="url" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="Paste a link from a message, email or search result" aria-label="Link to scan">
        <button class="btn btn--gold" type="submit">Scan</button>
      </form>
      <div class="scan-meta"><span>${scanLeftText(plan().features.research ? 'delicate' : 'fast')}</span><a href="/app/threats">Scan a file instead &rarr;</a></div>

      <div class="usage-list u-mt-lg">
        ${scanCards(us)}
        <a class="usage-link" href="/app/threats" aria-label="Virus and malware scan">${usageCard(ICON.shield, left('fileScans'), `/ ${us.fileScans.limit}`, 'Virus & malware scans left', us.fileScans.used, us.fileScans.limit)}</a>
        <a class="usage-link" href="/app/protection" aria-label="Live protection">${liveCard(us, f)}</a>
      </div>

      <div class="u-mt">${protectionTeaser()}</div>
      <div data-week-card></div>
      <div data-chat-ask></div>
      <div data-exposure-ask></div>

      <div class="panel u-mt">
        <div class="panel__head"><div><h2>Recent scans</h2><p>Your last 30 days</p></div><a class="btn btn--sm" href="/app/history">View all</a></div>
        <div data-recent><div class="skeleton u-h-md" ></div></div>
      </div>`;

    weekCard($('[data-week-card]', el));
    // One offer at a time: exposure alerts are offered only while chat safety's question is not showing.
    const chatAsk = $('[data-chat-ask]', el);
    askChatSafety(chatAsk).then(() => { if (!chatAsk.innerHTML) askExposureAlerts($('[data-exposure-ask]', el)); }).catch(() => {});
    $('[data-quick]', el).addEventListener('submit', (ev) => {
      ev.preventDefault();
      const url = ev.target.url.value.trim();
      if (url) navigate(`/app/scan?url=${encodeURIComponent(url)}`);
    });

    try {
      const data = await api('/account/history?limit=6');
      const slot = $('[data-recent]', el);
      if (!slot) return;
      slot.innerHTML = historyList(data.items.slice(0, 6), { clickable: true });
      slot.addEventListener('click', (ev) => {
        const row = ev.target.closest('[data-rescan]');
        if (row) navigate(`/app/scan?url=${encodeURIComponent(row.dataset.rescan)}`);
      });
      // The rows say they are buttons, so Enter and Space must work on them too.
      slot.addEventListener('keydown', (ev) => {
        const row = ev.target.closest('[data-rescan]');
        if (row && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); row.click(); }
      });
    } catch {
      // Never a skeleton that loads forever: say so, plainly.
      const slot = $('[data-recent]', el);
      if (slot) slot.innerHTML = '<p class="muted">Recent scans could not be loaded. They will be back next time you open this page.</p>';
    }
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
    try { data = await loadWeek(); } catch { return; }
    const w = data.weeks[data.weeks.length - 1];
    if (!slot.isConnected || (!w.checked && !w.caught)) return;
    slot.innerHTML = `<div class="panel u-mt week-card"><div class="panel__head"><div><h2>${esc(w.headline)}</h2>
      <p>${esc(w.biggest || `Sentinel checked ${w.checked.toLocaleString()} links, files and messages for you, and found nothing dangerous.`)}</p></div>
      <a class="btn btn--sm" href="/app/week">See your week</a></div></div>`;
  }

  async function weekView(el) {
    el.innerHTML = `${title('Your week with Sentinel', 'What Sentinel did for you, Monday to Sunday. Only real counts, never what the links, files or messages were.')}
      <div data-week><div class="skeleton u-h-md"></div></div>`;
    const slot = $('[data-week]', el);
    let data;
    try { data = await loadWeek(); } catch {
      slot.innerHTML = '<p class="muted">Your week could not be loaded. It will be back next time you open this page.</p>';
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
    const info = state.desktopInfo;
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
        : `<div class="empty u-mt">${Masks.svg('scam')}<p>Nothing yet. As Sentinel checks links, files and messages for you, your week fills in here.</p></div>`}
      ${caughtAny || weeks.some((x) => x.checked) ? `<div class="panel u-mt">
        <div class="panel__head"><div><h2>${caughtAny ? 'Caught, week by week' : 'Checked, week by week'}</h2><p>The last four weeks. Each week starts on Monday.</p></div></div>
        <div class="week-bars" role="img" aria-label="${esc(weeks.map((x, i) => `${weekLabel(x, i, weeks)}: ${val(x)}`).join(', '))}">
          ${weeks.map((x, i) => `<div class="week-bars__col" style="--li:${i}"><b class="tabular">${val(x).toLocaleString()}</b><i style="height:${Math.round((val(x) / top) * 100)}%"></i><span>${esc(weekLabel(x, i, weeks))}</span></div>`).join('')}
        </div></div>` : ''}
      ${desktop && desktop.setWeekRecap ? `<div class="panel u-mt"><label class="setting"><div><b>A note about your week</b>
          <span>Once a week, a Windows notification with last week in one line. Never while a game or video is full screen.</span></div>
          <input class="switch" type="checkbox" data-week-recap aria-label="A note about your week" ${info && info.weekRecap ? 'checked' : ''}></label></div>` : ''}
      <ul class="live__facts u-mt">
        <li>Counted as numbers for each week and kept for five weeks. Sentinel never keeps which links, files, commands or messages they were for this page.</li>
        <li>Private browser windows are not counted.${desktop ? '' : ' Files, copied commands, wallet swaps and chat messages are counted by the Sentinel app for Windows.'}</li>
      </ul>`;
    const sw = $('[data-week-recap]', slot);
    if (sw) sw.addEventListener('change', async () => {
      try {
        await desktop.setWeekRecap(sw.checked);
        if (state.desktopInfo) state.desktopInfo.weekRecap = sw.checked;
        toast(sw.checked ? 'Done. Your first note comes after this week is over.' : 'No more weekly notes.', 'success');
      } catch (err) { sw.checked = !sw.checked; toast(desktopError(err), 'error'); }
    });
  }

  function protectionTeaser() {
    const f = plan().features;
    if (!f.liveScanning) {
      return lockedCard({
        tag: 'Pro & up',
        heading: 'Research every result, and protect email and downloads',
        body: 'Your plan includes 15 minutes a week of fast live scanning. Pro and up add delicate live scanning, which researches every result (4 hours a week on Pro, 24 on Max, 96 on Ultimate), and mark emails and downloads too.',
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
    return `<div class="panel"><div class="panel__head"><div><h2>${live.enabled ? 'Live scanning is on' : 'Protection is on'}</h2><p>${live.enabled ? 'Look for the gold mask in the corner of your browser. Downloads and new programs are watched too.' : 'Downloads and new programs on this computer are being watched.'}</p></div><a class="btn btn--sm" href="/app/protection">Manage</a></div></div>`;
  }

  /* ============================================================ link scan */

  // Fast: threat lists, the checklist and comparison. Delicate: the site researched as well (Pro and up).
  const scanModeKey = 'sentinel.scanMode';
  function scanLeftText(mode) {
    const u = usage();
    const m = mode === 'delicate' ? u.deepScans : u.linkScans;
    if (!m) return '';
    const name = mode === 'delicate' ? 'delicate scans' : 'fast scans';
    return uncapped(m.limit) ? `Unlimited ${name}` : `${Math.max(0, m.limit - m.used)} of ${m.limit} ${name} left this week`;
  }

  function scanView(el, params) {
    const f = plan().features;
    let mode = 'fast';
    try { mode = localStorage.getItem(scanModeKey) || (f.research ? 'delicate' : 'fast'); } catch { mode = f.research ? 'delicate' : 'fast'; }
    if (!f.research) mode = 'fast';
    el.innerHTML = `
      ${title('Link scan', f.research
        ? 'Fast checks known threats, the full checklist and known scams in about a second. Delicate also researches the site, for scam, virus and malware.'
        : 'Known threats, the full checklist and comparison with known scams. Pro adds delicate scans, which research the site too.')}
      ${modelSlot(true)}
      <div class="scan-mode">
        <div class="seg" role="group" aria-label="Scan mode">
          <button type="button" class="seg__btn${mode === 'fast' ? ' is-on' : ''}" data-scan-mode="fast" aria-pressed="${mode === 'fast'}">Fast</button>
          <button type="button" class="seg__btn${mode === 'delicate' ? ' is-on' : ''}" data-scan-mode="delicate" aria-pressed="${mode === 'delicate'}" ${f.research ? '' : 'disabled title="Delicate scans come with Pro, Max and Ultimate"'}>Delicate</button>
        </div>
        <span class="muted" data-mode-note>${mode === 'delicate' ? 'Researches the site: its age, certificate, redirects and page content.' : 'Threat lists, the full checklist and known scams, in about a second.'}</span>
      </div>
      <form class="scanbox" data-form>
        ${ICON.search}
        <input name="url" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://" aria-label="Link to scan" required>
        <button class="btn btn--gold" type="submit">Scan link</button>
      </form>
      <div class="scan-meta"><span data-left>${scanLeftText(mode)}</span>
        <span class="examples">
          <button class="chip" type="button" data-example="paypa1-secure-login.com/account">paypa1-secure-login.com</button>
          <button class="chip" type="button" data-example="https://github.com">github.com</button>
        </span>
      </div>
      ${qrPicker()}
      <div data-qr-out aria-live="polite"></div>
      <div data-out></div>`;

    mountModels(el);
    const form = $('[data-form]', el);
    const out = $('[data-out]', el);
    $$('[data-example]', el).forEach((b) => b.addEventListener('click', () => { form.url.value = b.dataset.example; form.requestSubmit(); }));
    $$('[data-scan-mode]', el).forEach((b) => b.addEventListener('click', () => {
      if (b.disabled) return;
      mode = b.dataset.scanMode;
      try { localStorage.setItem(scanModeKey, mode); } catch { /* not stored */ }
      $$('[data-scan-mode]', el).forEach((x) => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      $('[data-mode-note]', el).textContent = mode === 'delicate' ? 'Researches the site: its age, certificate, redirects and page content.' : 'Threat lists, the full checklist and known scams, in about a second.';
      $('[data-left]', el).textContent = scanLeftText(mode);
    }));

    // A QR code: read here, explained, and a link in it checked with a fast scan, whatever mode is chosen: a few test
    // pictures must not quietly use up delicate scans. A delicate look is one press of Scan link away.
    const qrOut = $('[data-qr-out]', el);
    wireQr(el, async (text) => {
      const info = await explainQr(qrOut, text, { focus: true });
      if (!info || !info.url) return;
      form.url.value = info.url;
      await scanLink(info.url, true);
    });

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const url = form.url.value.trim();
      if (url) scanLink(url, false);
    });

    async function scanLink(url, fromQr) {
      // A link typed after a QR code is a scan of its own: the code's card goes.
      if (!fromQr) qrOut.innerHTML = '';
      // Remembered in the history entry, so Back and reload show the address without spending another scan.
      history.replaceState({ scanned: url }, '', `/app/scan?url=${encodeURIComponent(url)}`);
      const button = $('button[type=submit]', form);
      const runMode = fromQr ? 'fast' : mode;
      const deep = runMode === 'delicate';
      out.innerHTML = stagesView(deep);
      const stop = runStages(out, deep);
      // A delicate scan digs: the result area runs with binary while the site is researched (binary.js).
      const dig = deep && window.SentinelBinary ? window.SentinelBinary.dig(out, { colors: ['gold'] }) : null;
      try {
        const data = await busy(button, fromQr ? 'Checking the link in the code' : 'Scanning', () => api('/scan/link', { method: 'POST', body: { url, mode: runMode } }));
        stop();
        applyUsage(data.usage);
        if (dig) await dig.finish(data.verdict);
        showVerdict(out, data.verdict, { lockedLabel: 'Pro & up' });
        $('[data-left]', el).textContent = scanLeftText(mode);
      } catch (err) {
        stop();
        if (dig) dig.stop();
        out.innerHTML = friendlyError(err);
      }
    }

    const preset = params.get('url');
    if (preset) {
      form.url.value = preset;
      if (!history.state || history.state.scanned !== preset) form.requestSubmit();
    }
  }

  /* ------------------------------------------------------------ QR codes */

  // A picture of a QR code is read in this page (qr.js), never uploaded. Only the text it holds goes to the server,
  // which says what the code does: a link, or something that is not a link at all (a sign-in code, a wallet
  // connection, a crypto payment) and would never show up in a link scan.

  function qrPicker() {
    const camera = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    return `<div class="qr-in" data-qr>
        <span class="qr-in__icon">${ICON.qr}</span>
        <div class="qr-in__text"><b>Got a QR code?</b><span>Choose, drop or paste (Ctrl+V) a picture of it${camera ? ', or hold it up to the camera' : ''}. It is read on this device and not uploaded.</span></div>
        <span class="qr-in__btns">
          <button class="btn btn--sm" type="button" data-qr-pick>Choose a picture</button><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" data-qr-file hidden>
          ${camera ? '<button class="btn btn--sm" type="button" data-qr-cam>Use the camera</button>' : ''}
        </span>
        <div class="qr-cam" data-qr-camview hidden><video muted playsinline aria-label="Camera view"></video><p class="muted">Hold the QR code up to the camera. It is read here, and the camera turns off as soon as a code is found.</p></div>
      </div>`;
  }

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

  /** A picture chosen, dropped or pasted, or the camera, each ending in onText(the code's text). */
  function wireQr(el, onText) {
    const box = $('[data-qr]', el);
    let reading = false;
    const fromFile = async (file) => {
      if (!file || reading) return;
      if (!/^image\//.test(file.type)) { toast('Choose a picture of the QR code: PNG, JPEG, WebP, GIF or BMP.', 'error'); return; }
      if (file.size > 20 * 1024 * 1024) { toast('That picture is too large.', 'error'); return; }
      reading = true;
      try {
        const text = await qrFromFile(file);
        if (text == null) toast('No QR code was found in that picture. Try a closer, sharper picture with the whole code in it.', 'info', 6000);
        else await onText(text);
      } catch (err) {
        toast(qrLoad === null && !window.SentinelQR ? 'The QR code reader could not load. Try again in a moment.' : 'That picture could not be read.', 'error');
      } finally { reading = false; }
    };
    const input = $('[data-qr-file]', box);
    // A real button, so the keyboard reaches it; the file input itself stays out of the way.
    $('[data-qr-pick]', box).addEventListener('click', () => input.click());
    input.addEventListener('change', () => { fromFile(input.files[0]); input.value = ''; });
    ['dragenter', 'dragover'].forEach((t) => el.addEventListener(t, (ev) => {
      if (ev.dataTransfer && [...ev.dataTransfer.types].includes('Files')) { ev.preventDefault(); box.classList.add('is-over'); }
    }));
    el.addEventListener('dragleave', (ev) => { if (!el.contains(ev.relatedTarget)) box.classList.remove('is-over'); });
    el.addEventListener('drop', (ev) => {
      const file = ev.dataTransfer && ev.dataTransfer.files[0];
      box.classList.remove('is-over');
      if (!file) return;
      ev.preventDefault();
      fromFile(file);
    });
    // Ctrl+V with a picture on the clipboard (a Snipping Tool capture, say). Pasted text is left to the page: a copy
    // from Excel or Word carries a picture of itself too, and pasted into a text box it is the text that is meant.
    const onPaste = (ev) => {
      if (!el.isConnected) { document.removeEventListener('paste', onPaste); return; }
      const items = [...(ev.clipboardData ? ev.clipboardData.items : [])];
      const typing = ev.target && ev.target.closest && ev.target.closest('input, textarea, [contenteditable]');
      if (typing && items.some((i) => i.kind === 'string' && i.type === 'text/plain')) return;
      const item = items.find((i) => i.kind === 'file' && /^image\//.test(i.type));
      if (item) { ev.preventDefault(); fromFile(item.getAsFile()); }
    };
    document.addEventListener('paste', onPaste);

    // The camera: on only while its view is open, looked at a few times a second, off the moment a code is found.
    const camBtn = $('[data-qr-cam]', box);
    if (!camBtn) return;
    const camView = $('[data-qr-camview]', box);
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
      camBtn.textContent = 'Use the camera';
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
      camBtn.textContent = 'Stop the camera';
      video.srcObject = stream;
      try { await video.play(); } catch { /* it plays when it can */ }
      timer = setInterval(async () => {
        if (!el.isConnected) { stop(); return; }
        if (reading || !video.videoWidth) return;
        const text = qrFrom(video, video.videoWidth, video.videoHeight, [Math.min(640, Math.max(video.videoWidth, video.videoHeight))]);
        if (text == null) return;
        stop();
        reading = true;
        try { await onText(text); } finally { reading = false; }
      }, 350);
    });
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
          <div class="field"><label for="rp-cat">What kind of site is it?</label><select class="input" id="rp-cat" name="category">${REPORT_CATEGORIES.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></div>
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
          toast(r.promoted ? 'Reported. This site is now confirmed for everyone.' : `Thanks. ${r.reports} report${r.reports === 1 ? '' : 's'} so far.`, 'success');
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
      const card = make();
      const canvas = document.createElement('canvas');
      let blob = null;
      try {
        await W.draw(canvas, card);
        blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      } catch { /* told below */ }
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
      panel.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
    });
  }

  /* ====================================================== virus & malware */

  function threatsView(el, params) {
    const f = plan().features;
    const mode = params.get('mode') === 'url' ? 'url' : 'file';
    el.innerHTML = `
      ${localNote()}
      ${title('Virus &amp; malware scan', `Check a file or download link for viruses and malware. ${f.research ? 'Links are researched and downloaded files are inspected.' : 'Files are fully inspected; links get the checklist without research.'}`,
        `<div class="segmented" role="tablist"><button role="tab" data-mode="file" aria-selected="${mode === 'file'}">File</button><button role="tab" data-mode="url" aria-selected="${mode === 'url'}">Link</button></div>`)}
      ${modelSlot(true)}
      <div data-input></div>
      <div class="scan-meta"><span data-left>${left('fileScans')} of ${usage().fileScans.limit} scans left this week</span><span>Files up to 25 MB &middot; nothing is stored</span></div>
      <div data-out></div>`;

    $$('[data-mode]', el).forEach((b) => b.addEventListener('click', () => navigate(`/app/threats?mode=${b.dataset.mode}`)));
    mountModels(el);
    const input = $('[data-input]', el);
    const out = $('[data-out]', el);
    const updateLeft = () => { $('[data-left]', el).textContent = `${left('fileScans')} of ${usage().fileScans.limit} scans left this week`; };

    if (mode === 'url') {
      input.innerHTML = `<form class="scanbox" data-form>${ICON.search}<input name="url" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="Paste a download link or web address" aria-label="Link to scan" required><button class="btn btn--gold" type="submit">Scan</button></form>`;
      const form = $('[data-form]', input);
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        out.innerHTML = stagesView(f.research);
        const stop = runStages(out, f.research);
        try {
          const data = await busy($('button', form), 'Scanning', () => api('/scan/threat', { method: 'POST', body: { url: form.url.value.trim() } }));
          stop();
          applyUsage(data.usage);
          updateLeft();
          showVerdict(out, data.verdict);
        } catch (err) { stop(); out.innerHTML = friendlyError(err); }
      });
      return;
    }

    input.innerHTML = `<label class="drop" data-drop>
      <input type="file" data-file aria-label="Choose a file to scan">
      <div><div class="drop__icon">${ICON.upload}</div><h3>Drop a file here, or click to choose</h3><p>Programs, documents, archives, scripts, installers</p></div>
    </label>`;
    const drop = $('[data-drop]', input);
    const fileInput = $('[data-file]', input);
    // One file at a time: a second drop while one is being checked would start a second scan and use a second
    // scan from the allowance.
    let scanning = false;
    const scanFile = async (file) => {
      if (!file) return;
      if (scanning) { toast('One file at a time. This one is still being checked.', 'info'); return; }
      if (file.size > 25 * 1024 * 1024) { toast('Files up to 25 MB can be scanned.', 'error'); return; }
      scanning = true;
      drop.setAttribute('aria-busy', 'true');
      out.innerHTML = `<div class="panel scanning"><div class="scanning__rings">${Masks.svg('virus')}</div><h3>Inspecting ${esc(file.name)}</h3><p class="muted u-mt-xs">${bytes(file.size)} &middot; checking signatures, disguises, macros and scripts</p></div>`;
      try {
        const data = await api('/scan/file', { method: 'POST', raw: file, headers: { 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' } });
        applyUsage(data.usage);
        updateLeft();
        showVerdict(out, data.verdict);
      } catch (err) { out.innerHTML = friendlyError(err); }
      fileInput.value = '';
      scanning = false;
      drop.removeAttribute('aria-busy');
    };
    fileInput.addEventListener('change', () => scanFile(fileInput.files[0]));
    ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (ev) => { ev.preventDefault(); drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (ev) => { ev.preventDefault(); drop.classList.remove('is-over'); }));
    drop.addEventListener('drop', (ev) => scanFile(ev.dataTransfer.files[0]));
    // A file chosen with "Scan with Sentinel" in the Windows right-click menu, handed over once by the app.
    if (desktop && desktop.takeMenuFile) desktop.takeMenuFile().then((m) => {
      if (!m || !el.isConnected) return;
      if (!m.data) { toast(`${m.name} is too big. Files up to 25 MB can be scanned.`, 'error'); return; }
      scanFile(new File([m.data], m.name));
      // The answer is what the person came for: below the drop zone it was out of sight.
      out.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    },() => toast('That file could not be opened. Drop it here instead.', 'error'));
  }

  /* ========================================================= email scan */

  function emailView(el) {
    const f = plan().features;
    if (!f.emailManual) {
      el.innerHTML = `${title('Email scan', 'Paste a suspicious email and Sentinel checks the sender, wording, every link and every attachment.')}
        ${lockedCard({ tag: 'Max', heading: 'Scan any email you paste in, or a screenshot of one', body: `Pasting emails and screenshots in is part of Sentinel Max. ${f.emailLive ? 'Your Pro plan already marks emails automatically in Gmail and Outlook through the Sentinel app.' : 'Pro, Max and Ultimate also mark emails automatically in Gmail and Outlook.'}`, actions: '<a class="btn btn--gold" href="/app/plan">Upgrade to Max</a>' })}`;
      return;
    }
    el.innerHTML = `
      ${title('Email scan', 'Paste what you see in your inbox. Every link and the sender\'s domain go through the full link pipeline too.',
        '<div class="segmented" role="tablist"><button role="tab" data-emode="fields" aria-selected="true">Fill in</button><button role="tab" data-emode="paste" aria-selected="false">Paste whole email</button><button role="tab" data-emode="shot" aria-selected="false">Screenshot</button></div>')}
      ${modelSlot(true)}
      <div class="panel" data-shot hidden>
        <label class="drop" data-shot-drop>
          <input type="file" accept="image/png,image/jpeg" data-shot-file aria-label="Choose a screenshot of the email">
          <div><div class="drop__icon">${ICON.upload}</div><h3>Drop a screenshot of the email, or click to choose</h3><p>Or press Ctrl+V to paste one. PNG or JPEG. A QR code in it is read too.</p></div>
        </label>
        <figure class="shot" data-shot-preview hidden><img alt="The screenshot to read"><figcaption data-shot-status></figcaption></figure>
        <p class="field__hint u-mt-sm">${desktop && desktop.readScreenshot
          ? 'Read on this computer by Windows. The image is not uploaded or kept. Links are read as they appear on screen, so a link whose words differ from where it really goes is best pasted as text.'
          : 'Screenshots are read on your own computer by the Sentinel app for Windows, so they never have to be uploaded. <a class="u-gold" href="/download">Get the app</a>'}</p>
      </div>
      <form class="panel" data-paste data-draft="email-paste" hidden>
        <div class="field"><label for="e-raw">Paste the whole email, headers and all</label><textarea class="textarea" id="e-raw" name="raw" rows="10" placeholder="From: PayPal Security <alerts@example.com>&#10;Subject: Your account is limited&#10;&#10;Dear customer, ..."></textarea><span class="field__hint">Sentinel picks out the sender, reply-to, subject and links, then fills the form for you to check.</span></div>
        <div class="report__foot"><span></span><button class="btn btn--gold" type="button" data-parse>Read this email</button></div>
      </form>
      <form class="panel" data-form data-draft="email-scan">
        <div data-email-qr></div>
        <div class="row2">
          <div class="field"><label for="e-from">From</label><input class="input" id="e-from" name="from" placeholder="PayPal Security &lt;alerts@example.com&gt;" autocomplete="off"></div>
          <div class="field"><label for="e-reply">Reply-to <span class="opt">(optional)</span></label><input class="input" id="e-reply" name="replyTo" autocomplete="off"></div>
        </div>
        <div class="field"><label for="e-subject">Subject</label><input class="input" id="e-subject" name="subject" autocomplete="off"></div>
        <div class="field"><label for="e-body">Message</label><textarea class="textarea" id="e-body" name="body" placeholder="Paste the message text, including any links"></textarea></div>
        <div class="field"><label for="e-att">Attachment names <span class="opt">(optional, comma separated)</span></label><input class="input" id="e-att" name="attachments" placeholder="Invoice_2026.pdf.exe, statement.zip" autocomplete="off"></div>
        <div class="report__foot">
          <span class="muted">Uses 1 of your ${left('deepScans')} remaining delicate scans. Nothing is stored.</span>
          <button class="btn btn--gold" type="submit">Scan email</button>
        </div>
      </form>
      <div data-out></div>`;

    mountModels(el);
    const form = $('[data-form]', el);
    const out = $('[data-out]', el);
    const pasteBox = $('[data-paste]', el);
    const shotBox = $('[data-shot]', el);
    $$('[data-emode]', el).forEach((b) => b.addEventListener('click', () => {
      $$('[data-emode]', el).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      pasteBox.hidden = b.dataset.emode !== 'paste';
      shotBox.hidden = b.dataset.emode !== 'shot';
      // Pasting a whole email starts another one: a code from an earlier screenshot does not go with it.
      if (!pasteBox.hidden) { forgetShotQr(); $('textarea', pasteBox).focus(); }
    }));
    const fill = (raw) => {
      const m = parseEmail(raw);
      form.from.value = m.from; form.replyTo.value = m.replyTo; form.subject.value = m.subject; form.body.value = m.body; form.attachments.value = m.attachments.join(', ');
      $$('[data-emode]', el).forEach((x) => x.setAttribute('aria-selected', String(x.dataset.emode === 'fields')));
      pasteBox.hidden = true;
      shotBox.hidden = true;
      // Filled in by script, which raises no input event: say so, so the draft keeps what was filled in.
      form.dispatchEvent(new Event('input', { bubbles: true }));
      toast(m.from ? `Found sender ${m.from}. Check the fields, then scan.` : 'No headers found, so the text went into the message field.', 'info', 5000);
      form.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    };
    $('[data-parse]', el).addEventListener('click', () => {
      const raw = $('textarea', pasteBox).value;
      if (raw.trim()) fill(raw);
    });

    // A screenshot: cut into slices the recogniser can take (it has a maximum size), read on this computer, and
    // put through the same reading as a pasted email.
    const preview = $('[data-shot-preview]', el);
    const shotStatus = $('[data-shot-status]', el);
    // A QR code in the screenshot, read in this page whatever the computer: its text goes with the scan, so a link
    // hidden in the code is checked with the email's other links, and a sign-in code is called what it is.
    const qrSlot = $('[data-email-qr]', el);
    let shotQr = [];
    function forgetShotQr() { shotQr = []; qrSlot.innerHTML = ''; }
    let reading = false;
    const readShot = async (file) => {
      if (!file || reading) return;
      if (!/^image\/(png|jpeg)$/.test(file.type)) { toast('Screenshots must be PNG or JPEG images.', 'error'); return; }
      if (file.size > 20 * 1024 * 1024) { toast('That screenshot is too large.', 'error'); return; }
      const url = URL.createObjectURL(file);
      $('img', preview).src = url;
      preview.hidden = false;
      forgetShotQr();
      try {
        const code = await qrFromFile(file);
        if (code != null && await explainQr(qrSlot, code)) shotQr = [window.SentinelQR.redact(code)];
      } catch { /* no code read: the text is still read below */ }
      if (!desktop || !desktop.readScreenshot) { shotStatus.textContent = 'Reading screenshots needs the Sentinel app for Windows.'; return; }
      reading = true;
      preview.classList.add('is-reading');
      shotStatus.textContent = 'Reading the screenshot…';
      try {
        const slices = await sliceImage(file);
        const texts = await desktop.readScreenshot(slices);
        const text = joinSlices(texts);
        if (!text.trim()) { shotStatus.textContent = 'No text was found in that image.'; return; }
        shotStatus.textContent = `Read ${text.split('\n').length} lines.`;
        fill(withSender(text));
      } catch (err) {
        shotStatus.textContent = desktopError(err);
      } finally {
        reading = false;
        preview.classList.remove('is-reading');
        URL.revokeObjectURL(url);
      }
    };
    const shotInput = $('[data-shot-file]', el);
    shotInput.addEventListener('change', () => { readShot(shotInput.files[0]); shotInput.value = ''; });
    const shotDrop = $('[data-shot-drop]', el);
    ['dragenter', 'dragover'].forEach((t) => shotDrop.addEventListener(t, (ev) => { ev.preventDefault(); shotDrop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((t) => shotDrop.addEventListener(t, (ev) => { ev.preventDefault(); shotDrop.classList.remove('is-over'); }));
    shotDrop.addEventListener('drop', (ev) => readShot(ev.dataTransfer.files[0]));
    // Ctrl+V with an image on the clipboard (a Snipping Tool capture, say), while the screenshot tab is open.
    const onPaste = (ev) => {
      if (!el.isConnected) { document.removeEventListener('paste', onPaste); return; }
      if (shotBox.hidden) return;
      const item = [...(ev.clipboardData ? ev.clipboardData.items : [])].find((i) => i.kind === 'file' && /^image\/(png|jpeg)$/.test(i.type));
      if (item) { ev.preventDefault(); readShot(item.getAsFile()); }
    };
    document.addEventListener('paste', onPaste);

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = form.body.value;
      // Typed or read from a screenshot, an address may have no scheme: "www.example.com/login" is a link too.
      const found = [...(body.match(/https?:\/\/[^\s<>"')]+/g) || []), ...(body.match(/(?<![\w./@-])www\.[a-z0-9.-]+\.[a-z]{2,}[^\s<>"')]*/gi) || []).map((u) => `https://${u}`)];
      const links = [...new Set(found)].map((href) => ({ href, text: '' }));
      const payload = {
        from: form.from.value, replyTo: form.replyTo.value, subject: form.subject.value, body,
        links, attachments: form.attachments.value.split(',').map((s) => s.trim()).filter(Boolean), qr: shotQr
      };
      out.innerHTML = stagesView(true);
      const stop = runStages(out, true);
      try {
        const data = await busy($('button[type=submit]', form), 'Scanning', () => api('/scan/email', { method: 'POST', body: payload }));
        stop();
        applyUsage(data.usage);
        showVerdict(out, data.verdict);
        showMarks(out, payload, data.verdict.checklist.items);
        // Scanned with this email. The next email typed in here is another one, without this screenshot's code.
        forgetShotQr();
      } catch (err) { stop(); out.innerHTML = friendlyError(err); }
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
    'EL-scam': ['Scam link', 'Sentinel checked where this link goes, and it looks like a scam.'],
    'EL-malware': ['Malware link', 'Sentinel checked where this link goes, and it leads to malware.'],
    'EL-virus': ['Virus download', 'Sentinel checked where this link goes, and it downloads a virus.']
  };

  /**
   * The email as it was scanned, inside the result, with each finding marked where it is (the server says where, by
   * offsets into each field) and labelled. Tapping a mark says why. Shown only when something was found.
   */
  function showMarks(out, mail, items) {
    const found = items.filter((c) => (c.status === 'fail' || c.status === 'warn') && c.marks && c.marks.length);
    const checklist = $('.result__checklist', out);
    if (!found.length || !checklist) return;
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
        html += `${esc(text.slice(at, s.start))}<mark class="emark${fail ? ' is-fail' : ''}" tabindex="0" role="button" aria-expanded="false" data-emark="${whys.length - 1}">${esc(text.slice(s.start, s.end))}<span class="emark__tag">${esc(s.checks.map((c) => (EMAIL_MARKS[c.id] || [c.title])[0]).join(', '))}</span></mark>`;
        at = s.end;
      }
      return `<div class="email-marks__row" data-efield="${key}"><span class="email-marks__k">${label}</span><div class="email-marks__v${key === 'body' ? ' email-marks__body' : ''}">${html}${esc(text.slice(at))}</div></div>`;
    });
    const section = h(`<section class="email-marks" data-email-marks><h3>The email, marked</h3><p class="email-marks__hint">Each warning sign is marked where it is. Tap a mark to see why.</p>${rows.join('')}</section>`);
    checklist.before(section);
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

  /* ===================================================== text message scan */

  // A text, WhatsApp message or DM, pasted in or read from a phone screenshot on this computer (the way the email scan
  // reads one, then textshot.js picks out the sender and the messages). Judged on the server by the rules Phone Link
  // checking uses (server/lib/scan/texts.js); links are checked by their address only. Nothing is kept.
  function textView(el) {
    const canRead = Boolean(desktop && desktop.readScreenshot);
    const allowance = () => `${scanLeftText('fast')}. A text counts as one fast link scan, on every plan: its links are checked by their address only, not researched like a pasted email. Nothing is stored.`;
    el.innerHTML = `
      ${title('Text scan', 'Got a text, a WhatsApp message or a DM you are not sure about? Paste it in, or a screenshot of it, and Sentinel says if it looks like a scam and what to do.',
        '<div class="segmented" role="tablist"><button role="tab" data-tmode="paste" aria-selected="true">Paste the text</button><button role="tab" data-tmode="shot" aria-selected="false">Screenshot</button></div>')}
      <div class="panel" data-shot hidden>
        <label class="drop" data-shot-drop>
          <input type="file" accept="image/png,image/jpeg" data-shot-file aria-label="Choose a screenshot of the message">
          <div><div class="drop__icon">${ICON.upload}</div><h3>Drop a screenshot from your phone, or click to choose</h3><p>Or press Ctrl+V to paste one. PNG or JPEG.</p></div>
        </label>
        <figure class="shot" data-shot-preview hidden><img alt="The screenshot to read"><figcaption data-shot-status></figcaption></figure>
        <p class="field__hint u-mt-sm">${canRead
          ? 'Read on this computer by Windows. The image is not uploaded or kept. If you replied in the conversation, crop the screenshot to the message you were sent.'
          : 'Screenshots are read on your own computer by the Sentinel app for Windows, so they never have to be uploaded. <a class="u-gold" href="/download">Get the app</a>, or paste the text instead.'}</p>
      </div>
      <form class="panel" data-form>
        <div class="field"><label for="t-from">From <span class="opt">(optional: the number, short code or name the message shows)</span></label><input class="input" id="t-from" name="from" placeholder="+1 415 555 0199" autocomplete="off" maxlength="80"></div>
        <div class="field"><label for="t-text">Message</label><textarea class="textarea" id="t-text" name="text" rows="6" maxlength="2000" placeholder="Paste the message, including any links"></textarea></div>
        <div class="report__foot">
          <span class="muted" data-left>${esc(allowance())}</span>
          <button class="btn btn--gold" type="submit">Check this text</button>
        </div>
      </form>
      <div data-out aria-live="polite"></div>`;

    const form = $('[data-form]', el);
    const out = $('[data-out]', el);
    const shotBox = $('[data-shot]', el);
    const setMode = (mode) => {
      $$('[data-tmode]', el).forEach((x) => x.setAttribute('aria-selected', String(x.dataset.tmode === mode)));
      shotBox.hidden = mode !== 'shot';
      form.hidden = mode === 'shot';
    };
    $$('[data-tmode]', el).forEach((b) => b.addEventListener('click', () => setMode(b.dataset.tmode)));

    const preview = $('[data-shot-preview]', el);
    const shotStatus = $('[data-shot-status]', el);
    let reading = false;
    const readShot = async (file) => {
      if (!file || reading) return;
      if (!/^image\/(png|jpeg)$/.test(file.type)) { toast('Screenshots must be PNG or JPEG images.', 'error'); return; }
      if (file.size > 20 * 1024 * 1024) { toast('That screenshot is too large.', 'error'); return; }
      const url = URL.createObjectURL(file);
      $('img', preview).src = url;
      preview.hidden = false;
      if (!canRead) { shotStatus.textContent = 'Reading screenshots needs the Sentinel app for Windows.'; return; }
      reading = true;
      preview.classList.add('is-reading');
      shotStatus.textContent = 'Reading the screenshot…';
      try {
        const m = window.SentinelTextShot.read(joinSlices(await desktop.readScreenshot(await sliceImage(file))));
        if (!m.text) { shotStatus.textContent = 'No message was found in that image.'; return; }
        shotStatus.textContent = m.from ? `Read a message from ${m.from}.` : 'Read the message.';
        form.from.value = m.from;
        form.text.value = m.text;
        setMode('paste');
        toast('Check what was read, then press Check this text.', 'info', 5000);
        form.text.focus();
      } catch (err) {
        shotStatus.textContent = desktopError(err);
      } finally {
        reading = false;
        preview.classList.remove('is-reading');
        URL.revokeObjectURL(url);
      }
    };
    const shotInput = $('[data-shot-file]', el);
    shotInput.addEventListener('change', () => { readShot(shotInput.files[0]); shotInput.value = ''; });
    const shotDrop = $('[data-shot-drop]', el);
    ['dragenter', 'dragover'].forEach((t) => shotDrop.addEventListener(t, (ev) => { ev.preventDefault(); shotDrop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((t) => shotDrop.addEventListener(t, (ev) => { ev.preventDefault(); shotDrop.classList.remove('is-over'); }));
    shotDrop.addEventListener('drop', (ev) => readShot(ev.dataTransfer.files[0]));
    // Ctrl+V with an image on the clipboard, on either tab: pasted words still go into the message box.
    const onPaste = (ev) => {
      if (!el.isConnected) { document.removeEventListener('paste', onPaste); return; }
      const item = [...(ev.clipboardData ? ev.clipboardData.items : [])].find((i) => i.kind === 'file' && /^image\/(png|jpeg)$/.test(i.type));
      if (item) { ev.preventDefault(); setMode('shot'); readShot(item.getAsFile()); }
    };
    document.addEventListener('paste', onPaste);

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!form.text.value.trim()) { toast('Paste the message you want checked.', 'error'); form.text.focus(); return; }
      try {
        const data = await busy($('button[type=submit]', form), 'Checking', () => api('/scan/text', { method: 'POST', body: { from: form.from.value, text: form.text.value } }));
        applyUsage(data.usage);
        $('[data-left]', el).textContent = allowance();
        out.innerHTML = textResult(data.text, form.from.value.trim());
        const from = form.from.value.trim();
        wireWarn(out, () => window.SentinelWarnCard.fromText(data.text, from, $('[data-text-result]', out).dataset.textResult));
        out.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      } catch (err) { out.innerHTML = friendlyError(err); }
    });
  }

  /** The verdict card for a text: what it is, why, what to do, and each link's own result. */
  function textResult(r, from) {
    const f = r.flag;
    const red = r.links.some((l) => l.badge === 'red');
    const tone = !f ? 'clear' : red ? 'red' : f.level === 'danger' ? 'orange' : 'yellow';
    const who = !from ? 'No sender given' : `From ${from}${r.sender === 'number' ? ', a phone number' : r.sender === 'shortcode' ? ', a business short code' : r.sender === 'email' ? ', an email address' : ''}`;
    const linkLine = (l) => `${l.host || l.url}: ${l.badge ? `${l.label}${l.reason ? `. ${l.reason}` : ''}` : l.label === 'Not checked' ? 'could not be checked just now' : 'no threat found'}`;
    const reasons = [...(f ? [[f.detail, tone]] : []), ...r.links.map((l) => [linkLine(l), l.badge])];
    // Family on a "new number" wants money sent; the rest want a card number or a sign-in.
    const happened = f && /family/i.test(f.title) ? 'bank' : 'card,password';
    const scam = f && (f.level === 'danger' || red);
    const steps = f ? [f.advice] : [`Nothing in this text matches the scams Sentinel knows${r.links.length ? ', and its links are on no threat list' : ''}.`, 'Still unsure? Contact the company or person through their own app, website or a number you already have, not the one in the text.'];
    return `<article class="result result--${tone}" data-result data-text-result="${tone}">
      <header class="result__head">
        <div class="result__glyph" style="--c:${color(tone === 'clear' ? null : tone)}">${Masks.svg('scam')}</div>
        <div class="result__title">
          <h2>${esc(f ? f.title : 'No signs of a scam in this text')}</h2>
          <p class="result__sub">${esc(who)}</p>
        </div>
      </header>
      <div class="next-steps next-steps--${tone}"><h3>${f ? 'What to do now' : 'Good to know'}</h3><ol>${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        ${scam ? `<p class="next-steps__more">Already tapped the link, paid or replied? <a href="/app/recover?happened=${happened}">Open the recovery guide</a> for every step, in order.</p>` : ''}</div>
      ${reasons.length ? `<div class="reasons"><h3>Why</h3><ul>${reasons.map(([t, badge]) => `<li><span class="dot" style="--c:${color(badge || null)}"></span>${esc(t)}</li>`).join('')}</ul></div>` : ''}
      <div class="notes"><p>${r.links.length ? 'Links were checked by their address only and were not opened. ' : ''}The text was checked in memory and not kept, and it is not in your history.</p></div>
    </article>${scam && canWarn(tone) ? warnRow() : ''}`;
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
    const text = raw.replace(/\r\n?/g, '\n');
    const out = { from: '', replyTo: '', subject: '', body: text, attachments: [] };
    const headerEnd = text.search(/\n\s*\n/);
    const headBlock = headerEnd > 0 ? text.slice(0, headerEnd) : text.slice(0, 1200);
    const header = (name) => {
      const m = headBlock.match(new RegExp(`^${name}\\s*:\\s*(.+(?:\\n[ \\t]+.+)*)`, 'im'));
      return m ? m[1].replace(/\n[ \t]+/g, ' ').trim() : '';
    };
    out.from = header('From') || header('Sender');
    out.replyTo = header('Reply-To');
    out.subject = header('Subject');
    if (out.from || out.subject) out.body = headerEnd > 0 ? text.slice(headerEnd).trim() : text;
    // Gmail / Outlook "printed" emails put attachments at the end as bare file names.
    const files = text.match(/\b[\w][\w .()-]{0,80}\.(pdf|exe|zip|rar|7z|docm?|xlsm?|xlsx|pptx?|js|vbs|scr|iso|img|html?|lnk|msi|bat|cmd|apk|dmg)\b/gi) || [];
    out.attachments = [...new Set(files.map((f) => f.trim()))].filter((f) => !/^https?:/i.test(f)).slice(0, 10);
    return out;
  }

  /* ============================================================ history */

  async function historyView(el, params) {
    el.innerHTML = `${title('History', 'Everything Sentinel checked for you in the last 30 days. Click a link to scan it again.')}
      <div class="usage-list" data-stats><div class="skeleton u-h-sm"></div></div>
      <div class="panel u-mt" data-list><div class="skeleton u-h-lg"></div></div>`;
    let data;
    try { data = await api('/account/history'); }
    catch (err) { $('[data-list]', el).innerHTML = `<div class="banner banner--error">${esc(err.message)}</div>`; return; }

    const s = data.stats;
    const stat = (glyph, n, label, color, filter) => `<button type="button" class="usage-row" data-stat="${filter}" aria-pressed="false"><span class="usage-row__icon" style="color:${color}">${Masks.svg(glyph)}</span><span class="usage-row__l">${label}</span><b class="usage-row__n tabular">${n}</b></button>`;
    $('[data-stats]', el).innerHTML = stat('scam', s.scams, 'Scams caught', 'var(--red)', 'scam') + stat('virus', s.viruses, 'Viruses caught', 'var(--orange)', 'virus') + stat('malware', s.malware, 'Malware caught', 'var(--yellow)', 'malware');

    const FILTERS = [['all', 'All'], ['flagged', 'Flagged'], ['clear', 'Clear'], ['scam', 'Scam'], ['virus', 'Virus'], ['malware', 'Malware'], ['live', 'Live'], ['manual', 'Manual']];
    const flaggedLevel = (lvl) => ['suspicious', 'likely', 'confirmed'].includes(lvl);
    const hs = { filter: params.get('filter') || 'all', q: '' };
    const list = $('[data-list]', el);
    list.innerHTML = `<div class="panel__head"><div><h2>${s.total} scan${s.total === 1 ? '' : 's'}</h2><p>${s.flagged} flagged</p></div>
        <label class="tools__search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" placeholder="Search history" aria-label="Search history" data-q></label></div>
      <div class="tools" data-filters>${FILTERS.map(([id, label]) => `<button type="button" class="fchip" data-filter="${id}" aria-pressed="${id === hs.filter}">${label}</button>`).join('')}<span class="mono muted" data-count></span></div>
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
        : `<div class="empty">${Masks.svg('scam')}<p>${data.items.length ? 'Nothing matches that filter.' : 'No scans yet. Paste a link on the Overview page to run your first one.'}</p></div>`;
      $$('[data-filter]', list).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === hs.filter)));
      $$('[data-stat]', el).forEach((b) => {
        b.classList.toggle('is-active', b.dataset.stat === hs.filter);
        b.setAttribute('aria-pressed', String(b.dataset.stat === hs.filter));
      });
    };
    $$('[data-filter]', list).forEach((b) => b.addEventListener('click', () => { hs.filter = b.dataset.filter; paint(); }));
    $$('[data-stat]', el).forEach((b) => b.addEventListener('click', () => { hs.filter = hs.filter === b.dataset.stat ? 'all' : b.dataset.stat; paint(); }));
    $('[data-q]', list).addEventListener('input', (ev) => { hs.q = ev.target.value.trim(); paint(); });
    list.addEventListener('click', (ev) => {
      const row = ev.target.closest('[data-rescan]');
      if (row) navigate(`/app/scan?url=${encodeURIComponent(row.dataset.rescan)}`);
    });
    list.addEventListener('keydown', (ev) => {
      const row = ev.target.closest('[data-rescan]');
      if (row && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); row.click(); }
    });
    paint();
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
        <div class="panel" data-allow><div class="skeleton u-h-md" ></div></div>
        <div class="panel" data-block><div class="skeleton u-h-md" ></div></div>
      </div>`;

    let rule = 'allow';
    $$('[data-rule]', el).forEach((b) => b.addEventListener('click', () => {
      rule = b.dataset.rule;
      $$('[data-rule]', el).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    }));

    const load = async () => {
      let overrides = [];
      try { ({ overrides } = await api('/sites/overrides')); }
      catch (err) { $('[data-allow]', el).innerHTML = `<div class="banner banner--error">${esc(err.message)}</div>`; return; }
      const section = (slot, action, heading, empty) => {
        const rows = overrides.filter((o) => o.action === action);
        slot.innerHTML = `<div class="panel__head"><div><h2>${heading}</h2><p>${rows.length} site${rows.length === 1 ? '' : 's'}</p></div></div>
          ${rows.length ? `<ul class="list">${rows.map((o) => `<li>
            <span class="list__icon">${action === 'allow' ? ICON.check : ICON.lock}</span>
            <span class="list__main"><b class="mono">${esc(o.host)}</b><span>Added ${ago(o.created_at)}</span></span>
            <button class="btn btn--sm" data-remove="${esc(o.host)}">Remove</button>
          </li>`).join('')}</ul>` : `<div class="empty"><p>${empty}</p></div>`}`;
      };
      section($('[data-allow]', el), 'allow', 'Trusted', 'No trusted sites yet. Use "Trust this site" on any scan result, or add one above.');
      section($('[data-block]', el), 'block', 'Blocked', 'No blocked sites. Block a site to give it a red mask everywhere, for you.');
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

  /* ========================================================== call check */

  // "Is this call a scam?" for while someone is on the phone. The answer is worked out here, by callcheck.js, from what
  // is ticked; nothing is sent or kept, so leaving the page forgets the call.
  function callView(el) {
    const C = window.SentinelCallCheck;
    const picks = (list, name) => list.map((x) => `<label class="call__pick"><input type="checkbox" name="${name}" value="${x.id}"><span>${esc(x.label)}</span></label>`).join('');
    el.innerHTML = `
      ${title('Is this call a scam?', 'On the phone right now? Tick what the caller is saying. Sentinel answers at once, on this device. Nothing you tick is sent anywhere or kept.')}
      <form class="call" data-call>
        <fieldset class="panel call__group">
          <legend><h2>What are they asking for or saying?</h2><span>Tick everything that fits.</span></legend>
          <div class="call__picks">${picks(C.ASKS, 'ask')}</div>
        </fieldset>
        <fieldset class="panel call__group">
          <legend><h2>Who do they say they are?</h2></legend>
          <div class="call__picks">${picks(C.WHO, 'who')}</div>
        </fieldset>
        <div class="call__answer" data-call-answer aria-live="polite"></div>
        <button type="reset" class="btn btn--ghost btn--sm">Start over</button>
      </form>`;
    const form = $('[data-call]', el);
    const out = $('[data-call-answer]', el);
    const draw = () => {
      const ticked = (name) => $$(`input[name="${name}"]:checked`, form).map((i) => i.value);
      const r = C.judge(ticked('ask'), ticked('who'));
      out.dataset.verdict = r ? r.verdict : '';
      // In the Windows app, only that the answer was "Hang up" goes to the app (an hour's pay pause sign, paypause.js).
      if (r && r.verdict === 'hangup' && window.sentinelDesktop && window.sentinelDesktop.callHangUp) window.sentinelDesktop.callHangUp().catch(() => {});
      out.innerHTML = !r ? '<p class="call__empty">Tick what the caller says, and the answer appears here.</p>'
        : `<p class="call__verdict">${r.verdict === 'hangup' ? 'Hang up now.' : 'This is probably fine.'}</p>
          <p class="call__reason">${esc(r.reason)}</p>
          <p class="call__next"><b>What to do next:</b> ${esc(r.next)}</p>
          ${r.happened.length ? `<p class="call__more">Already did what they asked? <a href="/app/recover?happened=${r.happened.join(',')}">Open the recovery guide</a> for every step, in order.</p>` : ''}`;
    };
    form.addEventListener('change', draw);
    form.addEventListener('reset', () => setTimeout(draw));
    form.addEventListener('submit', (ev) => ev.preventDefault());
    draw();
  }

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
            : '<div class="empty"><p>No add-ons.</p></div>'}
          <h4 class="u-mt">Sites allowed to send notifications</h4>
          ${p.notifications === null ? '<div class="empty"><p>These could not be read.</p></div>'
            : sites.length ? `<ul class="list">${sites.map((s) => siteRow(s.origin.replace(/^https?:\/\//, ''), s, 'Can send you notifications')).join('')}</ul>
              <p class="muted u-mt-xs">Fake virus alerts and prize pop-ups arrive this way. To stop a site, remove it at ${copy(b.places.notifications)}</p>`
              : '<div class="empty"><p>No site may send notifications.</p></div>'}
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
      : `<div class="panel u-mt"><div class="empty"><p>No ${esc(list(r.looked || []))} settings were found on this computer.</p>${notChecked}</div></div>`;

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
      <h4>${name}</h4><p>${body}</p></div>`;
    const st = (on, lockedText) => (on ? '<span class="status is-on">On</span>' : `<span class="status is-locked">${lockedText}</span>`);

    const needsApp = !desktop;
    const lock = planLocked ? 'Pro & up' : needsApp ? 'Needs app' : null;

    el.innerHTML = `
      ${title('Live protection', 'Sentinel watching in real time: on search results, in your inbox and on every download.')}
      ${localNote()}
      ${planLocked ? lockedCard({ tag: 'Not in this plan', heading: 'Turn on live protection', body: 'Live scanning is not part of this plan.', actions: '<a class="btn btn--gold" href="/app/plan">See plans</a>' })
        : needsApp ? lockedCard({ tag: 'Unlocked by the Sentinel app', heading: 'Download Sentinel to switch these on', body: 'Your plan includes live protection. It runs through the Sentinel app on your computer, so it can watch downloads and draw its masks over your browser.', actions: `<a class="btn btn--gold" href="/download">${ICON.download}Download Sentinel</a>` })
        : ''}

      <div class="feature-grid">
        ${feature(Masks.svg('scam'), 'Page warnings', 'While a browser is in front, Sentinel checks the address of the page it shows and warns you before a dangerous one gets your details. No add-on.', st(!lock && desktop, lock || 'Needs app'))}
        ${feature(ICON.search, 'Search result masks', `A gold line crosses the page when you search, then a mask appears beside every result. Google, Bing, DuckDuckGo, Brave, Yahoo, Ecosia and more.${f.liveResearch ? ' Every result is researched.' : ''}`, st(!lock && desktop, lock || 'Needs app'))}
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
      <div id="parent-lock" data-parent-lock></div>
      <div class="panel u-mt" data-intel>
        <div class="panel__head"><div><h2>Threat intelligence</h2><p>The public feeds every scan is checked against, refreshed automatically.</p></div></div>
        <div class="skeleton u-h-sm"></div>
      </div>`;

    if (desktop && !planLocked) renderDesktopControls($('[data-desktop]', el));
    if (desktop) renderParentLock($('[data-parent-lock]', el));
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
    } catch { $('.skeleton', slot).outerHTML = '<p class="muted">Feed status is unavailable right now.</p>'; }
  }

  /**
   * Chat safety (Roblox and the Discord app): what it reads and what it never does, said before it is switched on.
   * Off until the person (or a parent) turns it on.
   */
  function chatSafetyPanel(info) {
    const cs = (info && info.chatSafety) || { enabled: false, supported: false };
    if (!desktop || !desktop.setChatSafety) return '';
    return `<div class="panel u-mt" id="chat-safety">
      <div class="panel__head"><div><h2>Chat safety: Roblox and Discord</h2>
        <p>Points out scams and people who may not be safe to talk to (someone asking a child to keep secrets, to send pictures, to move to another app, or to meet), right beside the message, while Roblox or the Discord app is in front.</p></div>
        <input class="switch" type="checkbox" data-chat-safety aria-label="Chat safety" ${cs.enabled ? 'checked' : ''} ${cs.supported ? '' : 'disabled'}></div>
      <p class="muted u-mt-sm" data-chat-seen>${chatSeenText(cs)}</p>
      <ul class="list">
        <li><span class="list__icon">${ICON.shield}</span><span class="list__main"><b>Read on this computer only</b><span>Messages are read from the screen as they appear, judged here and forgotten. No message, name or game is sent to Sentinel or anyone else, saved, or logged.</span></span></li>
        <li><span class="list__icon">${Masks.svg('logo')}</span><span class="list__main"><b>Always plain to see</b><span>A Sentinel badge shows while chat is watched. In a Roblox game it shows only when you open the Esc menu, so it never covers the game; warnings sit small, beside the chat box.</span></span></li>
        <li><span class="list__icon">${ICON.check}</span><span class="list__main"><b>Never in the way</b><span>Nothing is read while a game's chat is closed. Sentinel never changes Roblox or Discord, never types or clicks in them, and only speaks up when a message is suspicious, using the game or server it is in to tell play from danger.</span></span></li>
      </ul>
    </div>`;
  }
  /**
   * Parent lock: a PIN before protection can be switched off or Sentinel quit. The PIN is checked by the app on this
   * computer (desktop/src/parentlock.js); only a salted hash of it is kept. Drawn into its own slot, since it changes
   * on its own (it locks again five minutes after the PIN opens it).
   */
  async function renderParentLock(slot) {
    if (!slot || !desktop || !desktop.lockStatus) return;
    let s;
    try { s = await desktop.lockStatus(); } catch { return; }
    if (!slot.isConnected || !s.supported) { slot.innerHTML = ''; return; }
    clearTimeout(slot._relock);
    const pinInput = (name, label, auto) => `<div class="field"><label for="pl-${name}">${label}</label><input class="input code-input" id="pl-${name}" name="${name}" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" autocomplete="${auto}" required></div>`;
    // Sentinel is installed for one Windows account, and that account can uninstall it, administrator or not.
    const adminNote = `<p class="field__hint">The lock stops protection being switched off inside Sentinel. Whoever uses this Windows account can still uninstall Sentinel from Windows Settings${s.admin ? ', and this account is an administrator, so it can change anything on the computer' : ''}. If Sentinel stops without the PIN, the record says when.</p>`;
    const newPin = (button) => `<form data-pl-set class="u-mt-sm">${pinInput('pin', 'New PIN, 4 to 8 digits', 'new-password')}${pinInput('again', 'The same PIN again', 'new-password')}<button class="btn btn--gold u-mt-sm" type="submit">${button}</button></form>`;
    const when = (at) => new Date(at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' });
    const record = s.record || [];
    const recordList = `<h3 class="u-mt">Record</h3>
        <p class="field__hint">Times and switches only. Nothing about a chat or a page is ever written here.</p>
        ${record.length ? `<ul class="list">${record.slice(0, 10).map((r) => `<li><span class="list__icon">${ICON.shield}</span><span class="list__main"><b>${esc(r.text)}${r.times > 1 ? ` (${r.times} times)` : ''}</b><span>${esc(when(r.at))}</span></span></li>`).join('')}</ul>` : '<div class="empty"><p>Nothing yet.</p></div>'}`;
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
    slot.innerHTML = `<div class="panel u-mt">
      <div class="panel__head"><div><h2>Parent lock</h2>
        <p>With a PIN set, switching off any of Sentinel's protection on this page or in the tray, or quitting Sentinel, needs the PIN. So do putting a quarantined file back, telling the tech-support scam shield that you use a remote-control program yourself, and switching accounts. Turning protection on never does. On a computer a child uses, a stranger cannot talk them into switching Sentinel off.</p>
        <p>It does not cover the browser companion or Windows administrator accounts.</p></div></div>
      ${body}
    </div>`;

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
    // Opened from a refused tray click: straight to the PIN.
    if (location.hash === '#parent-lock' && !slot._scrolled) { slot._scrolled = true; slot.scrollIntoView({ block: 'start' }); const pin = $('input', slot); if (pin) pin.focus({ preventScroll: true }); }
  }
  // What chat safety is doing right now, in numbers only: proof that it works, without a word of anyone's chat.
  function chatSeenText(cs) {
    if (!cs.enabled) return 'Off. Turn it on, then open Roblox or the Discord app.';
    const s = cs.seen || {};
    const name = { discord: 'Discord', roblox: 'Roblox' }[s.app];
    const now = name ? (s.reading ? `Watching ${name} now.` : `${name} is in front, but its chat cannot be read yet.`) : 'On. It starts watching when Roblox or the Discord app is in front.';
    const d = (s.discord && s.discord.checked) || 0, r = (s.roblox && s.roblox.checked) || 0;
    const f = ((s.discord && s.discord.flagged) || 0) + ((s.roblox && s.roblox.flagged) || 0);
    if (!d && !r) return now;
    return `${now} Since Sentinel started: ${d} message${d === 1 ? '' : 's'} checked in Discord, ${r} in Roblox, ${f} flagged.`;
  }
  /** Check my texts (Phone Link): what it reads and what it never does, said before it is switched on. Off until turned on. */
  function textSafetyPanel(info) {
    const ts = (info && info.textSafety) || { enabled: false, supported: false };
    if (!desktop || !desktop.setTextSafety) return '';
    return `<div class="panel u-mt" id="text-safety">
      <div class="panel__head"><div><h2>Check my texts</h2>
        <p>If your phone's texts show on this computer through Phone Link, Sentinel points out English scam texts (unpaid tolls, parcel fees, "Hi Mum, this is my new number", task jobs, "your account is locked") right beside the message, while Phone Link is in front.</p></div>
        <input class="switch" type="checkbox" data-text-safety aria-label="Check my texts" ${ts.enabled ? 'checked' : ''} ${ts.supported ? '' : 'disabled'}></div>
      <p class="muted u-mt-sm" data-text-seen>${textSeenText(ts)}</p>
      <ul class="list">
        <li><span class="list__icon">${ICON.shield}</span><span class="list__main"><b>Read on this computer only</b><span>The conversation on screen is read as it appears, judged here and forgotten. No text, name or number is sent to Sentinel or anyone else, saved, or logged.</span></span></li>
        <li><span class="list__icon">${ICON.globe}</span><span class="list__main"><b>Links checked, never opened</b><span>A link in a text is checked by its address, the way a copied link is. Sentinel never opens it, and it is not added to your history.</span></span></li>
        <li><span class="list__icon">${ICON.check}</span><span class="list__main"><b>Never in the way</b><span>Only texts you received are checked. Sentinel never changes Phone Link, never types, clicks or replies in it, and only speaks up when a text looks like a scam.</span></span></li>
        <li><span class="list__icon">${ICON.globe}</span><span class="list__main"><b>English texts for now</b><span>Sentinel knows the wording of scam texts in English only. It tells the texts you received from the ones you sent by which side they are on, so Phone Link needs to show a left-to-right language, such as English.</span></span></li>
      </ul>
    </div>`;
  }
  // What Check my texts is doing right now, in numbers only.
  function textSeenText(ts) {
    if (!ts.enabled) return 'Off. Turn it on, then open a conversation in Phone Link.';
    const s = ts.seen || {};
    const now = s.app === 'phonelink' ? (s.reading ? 'Checking Phone Link now.' : s.otherTab ? 'Phone Link is in front. Texts are checked on its Messages tab.' : 'Phone Link is in front, but its texts cannot be read yet.') : 'On. It starts checking when Phone Link is in front.';
    const n = s.checked || 0, f = s.flagged || 0;
    const u = s.unchecked || 0;
    const missed = u ? ` ${u} link${u === 1 ? '' : 's'} in texts could not be checked against the threat lists: ${String(s.why || "Sentinel's scanner could not be reached").replace(/\.$/, '')}. The words were still checked.` : '';
    if (!n) return now + missed;
    return `${now} Since Sentinel started: ${n} text${n === 1 ? '' : 's'} checked, ${f} flagged.${missed}`;
  }
  function bindTextSafety(slot) {
    const sw = $('[data-text-safety]', slot);
    if (!sw || sw.disabled) return;
    const line = $('[data-text-seen]', slot);
    if (line && desktop.onTextSafety) {
      const off = desktop.onTextSafety((ts) => { if (ts) { line.textContent = textSeenText(ts); sw.checked = Boolean(ts.enabled); } });
      if (slot._off && typeof off === 'function') slot._off.push(off);
    }
    sw.addEventListener('change', async () => {
      try {
        const s = await desktop.setTextSafety(sw.checked);
        toast(s.enabled ? 'Check my texts is on. Open a conversation in Phone Link and Sentinel checks it.' : 'Check my texts is off.', 'success');
      } catch (err) { sw.checked = !sw.checked; toast(desktopError(err), 'error'); }
    });
  }
  const CHAT_ON = 'Chat safety is on. Open Roblox or Discord and Sentinel watches their chat.';
  const EXPOSURE_ON = 'Exposure alerts are on. Sentinel will tell you if a site you visit is listed later.';

  /*
   * "New in Sentinel" cards: asked once, in the Windows app, before a feature ever reads anything. What it does, then
   * Turn on or Not now. The answer (or switching the feature in Live protection) is kept in local storage as
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

  async function askChatSafety(slot) {
    if (!slot || !desktop || !desktop.setChatSafety || asked('chat')) return;
    let info = state.desktopInfo;
    try { if (!info) info = state.desktopInfo = await desktop.info(); } catch { return; }
    if (!info.chatSafety || !info.chatSafety.supported || info.chatSafety.enabled || !slot.isConnected) return;
    askOnce(slot, {
      name: 'chat', title: 'Chat safety for Roblox and Discord', yes: 'Turn on chat safety', howHref: '/app/protection#chat-safety',
      body: 'Sentinel can point out scams and people who may not be safe to talk to, right beside the message, while Roblox or the Discord app is in front. It reads chat on this computer only and keeps nothing; a badge shows while it watches, and in a Roblox game only when you press Esc. Turn it on for yourself, or for a child who uses this computer.',
      onYes: async () => { await desktop.setChatSafety(true); toast(CHAT_ON, 'success'); }
    });
  }
  function bindChatSafety(slot) {
    const sw = $('[data-chat-safety]', slot);
    if (!sw || sw.disabled) return;
    const line = $('[data-chat-seen]', slot);
    if (line && desktop.onChatSafety) {
      const off = desktop.onChatSafety((cs) => { if (cs) { line.textContent = chatSeenText(cs); sw.checked = Boolean(cs.enabled); } });
      if (slot._off && typeof off === 'function') slot._off.push(off);
    }
    sw.addEventListener('change', async () => {
      try {
        const s = await desktop.setChatSafety(sw.checked);
        markAsked('chat');
        toast(s.enabled ? CHAT_ON : 'Chat safety is off.', 'success');
      } catch (err) { sw.checked = !sw.checked; toast(desktopError(err), 'error'); }
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
      : !on ? 'Off. Nothing about the sites you visit is remembered.'
        : !(info.live && info.live.enabled) ? 'On, but live scanning is off, so no sites are being remembered. Start scanning to use exposure alerts.'
          : 'Nothing so far. None of the sites you visited in the last 14 days has been put on a threat list since.';
    // The marks live with whichever Sentinel server the app uses: its own, on this computer, or one set up for it.
    let where = 'on this computer';
    if (info && !info.embeddedServer) { try { where = `on the Sentinel server this app uses (${new URL(info.origin).host})`; } catch { where = 'on the Sentinel server this app uses'; } }
    return `<div class="panel u-mt" id="exposures">
      <div class="panel__head"><div><h2>Exposure alerts</h2>
        <p>A scam page often reaches the threat lists hours or days after it goes up. With this on, Sentinel remembers the sites live scanning found safe for 14 days, and tells you if a list names one of them afterwards, with what to do.</p></div>
        <input class="switch" type="checkbox" data-exposure-alerts aria-label="Exposure alerts" ${on ? 'checked' : ''} ${supported ? '' : 'disabled'}></div>
      ${items.length ? `<ul class="list">${items.map(exposureItem).join('')}</ul>`
        : `<p class="muted u-mt-sm">${empty}</p>`}
      <ul class="live__facts">
        <li>Kept ${esc(where)} as a scrambled code of each site&rsquo;s name and the day, never the address or the time, and erased after 14 days. Turning this off erases every one, and every alert found so far. The copies Sentinel keeps to repair its accounts file can hold them for up to 7 more days.</li>
        <li>Private windows are never remembered. Pages on shared sites (a Google Sites page, a Netlify site) are left out, since one bad page there says nothing about the one you saw.</li>
      </ul>
    </div>`;
  }
  function bindExposures(slot) {
    const sw = $('[data-exposure-alerts]', slot);
    if (sw && !sw.disabled) sw.addEventListener('change', async () => {
      try {
        const r = await desktop.setExposureAlerts(sw.checked);
        markAsked('exposure');
        if (!sw.checked && r && r.erased === false) toast('Exposure alerts are off. The remembered sites could not be erased just now, so Sentinel will try again each time it starts.', 'success');
        else toast(sw.checked ? EXPOSURE_ON : 'Exposure alerts are off. Every remembered site is erased.', 'success');
      } catch (err) { sw.checked = !sw.checked; toast(desktopError(err), 'error'); }
      renderDesktopControls(slot);
    });
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
  /* Your sites: look-alikes of the sites this person uses, not only of the big brands (server/lib/scan/mysites.js). */
  function mySitesPanel(info, sites) {
    if (!desktop || !desktop.setMySites) return '';
    const on = Boolean(info && info.mySites !== false);
    // Kept only by the app's own server on this computer: with another server there is nothing to keep them in.
    const local = Boolean(info && info.embeddedServer);
    const row = (s) => `<li>
      <span class="list__icon">${ICON.globe}</span>
      <span class="list__main"><b class="mono">${esc(s.host)}</b><span>${s.source === 'you' ? 'Added by you' : 'Learned: you use it often'}</span></span>
      <button class="btn btn--sm" data-my-site-remove="${esc(s.host)}">Remove</button>
    </li>`;
    const body = !local ? '<p class="muted u-mt-sm">Available when the app uses its own scanner on this computer.</p>'
      : !on ? '<p class="muted u-mt-sm">Off. No sites are learned or kept.</p>'
        : `<form class="my-sites__add" data-my-sites-add>
            <input class="input mono" name="host" placeholder="mycu.org" aria-label="A site you use" autocomplete="off" spellcheck="false" maxlength="300" required>
            <button class="btn btn--gold" type="submit">Add site</button>
          </form>
          ${sites.length ? `<ul class="list u-mt-sm">${sites.map(row).join('')}</ul>
            <div class="report__foot"><span class="muted">${sites.length} site${sites.length === 1 ? '' : 's'}</span><button class="btn btn--sm" data-my-sites-forget>Forget all</button></div>`
            : '<p class="muted u-mt-sm">None yet. A site you visit on three different days is added by itself, or add one now.</p>'}`;
    return `<div class="panel u-mt" id="my-sites">
      <div class="panel__head"><div><h2>Your sites</h2>
        <p>Sentinel knows the big brands. Here it learns yours: your bank or credit union, your school portal, your work sign-in. A link or page made to look like one of them gets a warning, in live scanning, copied links, email and link scans.</p></div>
        <input class="switch" type="checkbox" data-my-sites aria-label="Your sites" ${on ? 'checked' : ''} ${local ? '' : 'disabled'}></div>
      ${body}
      <ul class="live__facts">
        <li>Kept on this computer only, as plain site names you can read here. A site you passed through is never written down: until a site has been seen on three days, only a scrambled code of it is kept.</li>
        <li>Learned only from pages live scanning found safe, never from a private window. Turning this off forgets every site.</li>
      </ul>
    </div>`;
  }
  function bindMySites(slot) {
    const sw = $('[data-my-sites]', slot);
    if (sw && !sw.disabled) sw.addEventListener('change', async () => {
      try {
        const r = await desktop.setMySites(sw.checked);
        toast(sw.checked ? 'Your sites: on. Sentinel will learn the sites you use.' : r && r.erased === false ? 'Your sites: off. The sites could not be erased just now, so Sentinel will try again each time it starts.' : 'Your sites: off. Every site is forgotten.', 'success');
      } catch (err) { sw.checked = !sw.checked; toast(desktopError(err), 'error'); }
      renderDesktopControls(slot);
    });
    const form = $('[data-my-sites-add]', slot);
    if (form) form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const input = form.elements.host;
      try {
        await desktop.addMySite(input.value);
        toast('Added. Look-alikes of it now get a warning.', 'success');
        renderDesktopControls(slot);
      } catch (err) { input.setAttribute('aria-invalid', 'true'); toast(desktopError(err), 'error'); }
    });
    $$('[data-my-site-remove]', slot).forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await desktop.removeMySite(b.dataset.mySiteRemove); renderDesktopControls(slot); }
      catch (err) { b.disabled = false; toast(desktopError(err), 'error'); }
    }));
    const forget = $('[data-my-sites-forget]', slot);
    if (forget) forget.addEventListener('click', async () => {
      try { await desktop.forgetMySites(); toast('Every site is forgotten.', 'success'); renderDesktopControls(slot); }
      catch (err) { toast(desktopError(err), 'error'); }
    });
  }

  // Asked once, in the Windows app, once live scanning is in use: what exposure alerts do, then Turn on or Not now.
  async function askExposureAlerts(slot) {
    if (!slot || !desktop || !desktop.setExposureAlerts || asked('exposure')) return;
    let info = state.desktopInfo;
    try { if (!info) info = state.desktopInfo = await desktop.info(); } catch { return; }
    // The card promises "on this computer only", which holds only with the app's own server.
    if (info.exposureAlerts || !info.embeddedServer || !info.live || !info.live.supported || !info.live.enabled || !slot.isConnected) return;
    askOnce(slot, {
      name: 'exposure', title: 'Hear about it if a site you visited turns out to be a scam', yes: 'Turn on exposure alerts', howHref: '/app/protection#exposures',
      body: 'Scam pages often reach the threat lists a day or two after they go up. Sentinel can remember the sites live scanning found safe for 14 days, on this computer only and as scrambled codes, and tell you if a list names one of them later, with what to change.',
      onYes: async () => { await desktop.setExposureAlerts(true); toast(EXPOSURE_ON, 'success'); }
    });
  }

  async function renderDesktopControls(slot) {
    let info;
    try { info = await desktop.info(); } catch { return; }
    state.desktopInfo = info;
    let recent = [];
    try { recent = await desktop.recentDownloads(); } catch { /* none */ }

    const live = info.live || { supported: false, active: false, enabled: false, reason: 'Not available' };
    const df = info.defense || { supported: false, active: false, reason: 'Not available' };
    let ledger = [];
    try { ledger = (await desktop.defense()).ledger || []; } catch { /* none */ }
    let exposures = [];
    try { if (desktop.exposures) exposures = await desktop.exposures(); } catch { /* none */ }
    let mine = [];
    try { if (desktop.mySites) mine = await desktop.mySites(); } catch { /* none */ }
    // Left the page while waiting: subscribing now would leave listeners behind that nothing ever removes.
    if (!slot.isConnected) return;
    const browsers = (info.browsers && info.browsers.installed) || [];
    const running = new Set((info.browsers && info.browsers.running) || []);
    const up = info.update || { status: 'idle' };

    (slot._off || []).forEach((off) => off());
    slot._off = [];
    const active = slot.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active ? ['liveToggle', 'liveMode', 'autoScan', 'scanWith', 'defense', 'dl', 'login', 'watch', 'checkUpdate', 'restore', 'quarantine'].find((k) => k in active.dataset) : null;
    const focusValue = focusKey ? active.dataset[focusKey] : null;
    const canDelicate = Boolean(plan().features.liveScanning);
    const mode = info.liveMode === 'delicate' && canDelicate ? 'delicate' : 'fast';
    const fellBack = live.fellBack === 'delicate_hours_used' ? ' Delicate hours for this week are used up, so results are coming from fast scanning.' : '';
    const liveText = !live.supported ? 'Live scanning is available on Windows.'
      : live.active ? (live.window ? `Watching the browser in front. Look for the gold mask in its bottom right corner.${live.lastResults ? ` Last search: ${live.lastResults.count} results marked.` : ''}${fellBack}` : 'Ready. It starts by itself whenever a browser is in front, and rests when none is.')
        : live.enabled ? (live.reason || 'Starting') : 'Off. One click, and every browser you use is covered.';
    slot.innerHTML = `
      <div class="panel live u-mt">
        <div class="live__main">
          <span class="live__mask${live.active ? ' is-on' : ''}" aria-hidden="true">${Masks.svg('scam')}</span>
          <div class="live__text"><h2>Live scanning</h2><p data-live-text>${esc(liveText)}</p>${live.counts && live.counts.checked ? `<p class="live__counts" data-live-counts>${live.counts.checked.toLocaleString()} checked since Sentinel started, ${live.counts.flagged.toLocaleString()} flagged. Private windows are not counted.</p>` : '<p class="live__counts" data-live-counts hidden></p>'}</div>
          <div class="seg" role="group" aria-label="Scanning mode">
            <button type="button" class="seg__btn${mode === 'fast' ? ' is-on' : ''}" data-live-mode="fast" aria-pressed="${mode === 'fast'}">Fast</button>
            <button type="button" class="seg__btn${mode === 'delicate' ? ' is-on' : ''}" data-live-mode="delicate" aria-pressed="${mode === 'delicate'}" ${canDelicate ? '' : 'disabled title="Delicate scanning comes with Pro, Max and Ultimate"'}>Delicate</button>
          </div>
          <button class="btn ${live.enabled ? '' : 'btn--gold'} live__button" data-live-toggle ${live.supported ? '' : 'disabled'}>${live.enabled ? 'Stop scanning' : 'Start scanning'}</button>
        </div>
        ${live.supported && desktop.setAutoScan ? `<label class="setting live__auto"><div><b>Auto scanning</b><span>Starts fast scanning by itself whenever you open a browser, and switches off when every browser is closed.</span></div><input class="switch" type="checkbox" data-auto-scan ${info.autoScan ? 'checked' : ''}></label>` : ''}
        <ul class="live__facts">
          <li><b>Fast</b> marks results about a second after you search. <b>Delicate</b> also looks up how old each site is and whether it resolves, and takes about five seconds. Neither opens a suspicious page from this computer.</li>
          <li>Only the browser in front, and only while you are using it. Minimised, in the background or closed: nothing is read and no live time is spent.</li>
          <li>Private windows are protected the same way, and nothing about them is kept: no history, no log, no entry below.</li>
          <li>Sentinel reads addresses, never what a page says or what you type.</li>
        </ul>
      </div>

      <div class="grid2 u-mt">
        <div class="panel">
          <div class="panel__head"><div><h2>Your browsers</h2><p>Pick one. Sentinel opens it if it is closed, brings it to the front, and starts scanning.</p></div></div>
          ${browsers.length ? `<ul class="list">${browsers.map((b) => `<li>
            <span class="list__icon">${ICON.globe}</span>
            <span class="list__main"><b>${esc(b.name)}</b><span data-browser-state="${esc(b.id)}">${running.has(b.id) ? 'Open now' : 'Installed'}</span></span>
            <button class="btn btn--sm btn--gold" data-scan-with="${esc(b.id)}" ${live.supported ? '' : 'disabled'}>Scan with ${esc(b.name.replace(/^(Google|Microsoft|Mozilla) /, ''))}</button>
          </li>`).join('')}</ul>` : '<div class="empty"><p>No supported browser found on this computer.</p></div>'}
        </div>
        <div class="panel">
          <h2 class="u-mb">This computer</h2>
          <label class="setting"><div><b>Defense</b><span>${esc(df.supported
            ? (df.active ? `Watching ${(df.watched || []).join(', ')} and startup entries. A dangerous program is stopped, quarantined and its startup entries removed.` : df.reason || 'Off')
            : 'Available on Windows.')}</span></div>
            <input class="switch" type="checkbox" data-defense ${df.active ? 'checked' : ''} ${df.supported ? '' : 'disabled'}></label>
          <label class="setting"><div><b>Download protection</b><span>${esc(info.downloads.active ? `Watching ${info.downloads.folder || 'Downloads'}` : info.downloads.reason || 'Off')}</span></div><input class="switch" type="checkbox" data-dl ${info.downloads.active ? 'checked' : ''}></label>
          ${desktop.setClipboardCheck ? `<label class="setting"><div><b>Check links I copy</b><span>Copy a link from a text message, a chat or a PDF and Sentinel checks it, and warns you only if it is dangerous. Only copied web links are read; nothing else on your clipboard is sent or kept.</span></div><input class="switch" type="checkbox" data-clip ${info.clipboardCheck ? 'checked' : ''}></label>` : ''}
          ${desktop.setCommandShield && info.platform === 'win32' ? `<label class="setting"><div><b>Stop pasted commands</b><span>Fake "I am not a robot" pages copy a command and ask you to paste it into Windows. When you copy such a command in a browser, Sentinel takes it off your clipboard and tells you, with a way to put it back. Copied in another program, it only tells you. Copied text is checked on this computer and never sent or kept.</span></div><input class="switch" type="checkbox" data-shield ${info.commandShield ? 'checked' : ''}></label>
          ${desktop.commandPutBack ? '<div class="setting" data-held hidden><div><b>Stopped command</b><span data-held-text></span></div><button class="btn btn--sm" data-put-back>Put it back</button></div>' : ''}` : ''}
          ${desktop.setWalletGuard && info.platform === 'win32' ? `<label class="setting"><div><b>Wallet guard</b><span>Some malware waits for you to copy a crypto wallet address or an IBAN and swaps in its own. If the address you copied changes by itself a moment later, Sentinel puts yours back and tells you. Addresses are compared on this computer, in memory, and never sent, saved or logged.</span></div><input class="switch" type="checkbox" data-wallet-guard ${info.walletGuard ? 'checked' : ''}></label>` : ''}
          ${desktop.setSnip && info.snip && info.snip.supported ? `<div class="setting"><div><b>Check something on screen</b><span>Press the shortcut, or choose Check something on screen in the tray menu, then draw a box around a pop-up, an ad, a message, a QR code or a phone number. Sentinel reads it on this computer and tells you whether it looks like a scam. Only the links it finds are checked; the picture and the words are never sent, kept or logged.${info.snip.enabled && !info.snip.registered ? ' <strong>Another program already uses this shortcut. Choose another one.</strong>' : ''}</span>
            <select class="input u-mt-sm" data-snip-key aria-label="Shortcut" ${info.snip.enabled ? '' : 'disabled'}>${info.snip.keys.map((k) => `<option value="${esc(k.id)}" ${k.id === info.snip.key ? 'selected' : ''}>${esc(k.label)}</option>`).join('')}</select></div>
            <input class="switch" type="checkbox" data-snip aria-label="Check something on screen" ${info.snip.enabled ? 'checked' : ''}></div>` : ''}
          ${desktop.setRemoteGuard && info.remoteGuard && info.remoteGuard.supported ? `<label class="setting"><div><b>Tech-support scam shield</b>${info.remoteGuard.enabled && !live.enabled ? '<span class="status is-locked">Needs live scanning</span>' : ''}<span>When a page flagged as a scam takes the whole screen, Sentinel offers to close it. When a remote-control program such as AnyDesk or TeamViewer starts soon after a flagged page, or soon after it was downloaded, Sentinel asks whether someone on the phone told you to install it. Nothing is stopped unless you say so. The way out of a full-screen page and the bank warning work while live scanning is on.${info.remoteGuard.trusted.length ? ` You use ${esc(info.remoteGuard.trusted.join(', '))} yourself.` : ''}</span></div><input class="switch" type="checkbox" data-remote-guard ${info.remoteGuard.enabled ? 'checked' : ''}></label>
          ${info.remoteGuard.trusted.length ? '<div class="setting"><div><b>Programs you use yourself</b><span>Sentinel does not ask about these.</span></div><button class="btn btn--sm" data-forget-remote>Ask again</button></div>' : ''}` : ''}
          ${desktop.setScanMenu && info.scanMenu && info.scanMenu.supported ? `<label class="setting"><div><b>Scan with Sentinel in the right-click menu</b><span>Right-click any file, choose Show more options, then Scan with Sentinel. The file is checked on this computer and the answer opens here.</span></div><input class="switch" type="checkbox" data-scan-menu ${info.scanMenu.enabled ? 'checked' : ''}></label>` : ''}
          <label class="setting"><div><b>Start with my computer</b><span>Keep protection running from the moment you sign in.</span></div><input class="switch" type="checkbox" data-login ${info.openAtLogin ? 'checked' : ''}></label>
          <div class="setting"><div><b>Sentinel ${esc(info.version)}</b><span>${esc(updateText(up))}</span></div>
            ${up.status === 'ready' ? '<button class="btn btn--sm btn--gold" data-install-update>Restart now</button>'
              : up.supported ? '<button class="btn btn--sm" data-check-update>Check now</button>' : ''}</div>
          ${modelSlot(false)}
        </div>
      </div>

      ${exposurePanel(info, exposures)}
      ${mySitesPanel(info, mine)}

      ${chatSafetyPanel(info)}
      ${textSafetyPanel(info)}

      <div class="grid2 u-mt">
        <div class="panel">
          <div class="panel__head"><div><h2>Live, right now</h2><p>${live.active ? 'Pages show up here as they are checked. Private windows never do.' : 'Start scanning to see pages as they are checked.'}</p></div><span class="live-dot${live.active ? ' is-on' : ''}" aria-hidden="true"></span></div>
          <ul class="list feed" data-feed>${live.current && live.current.url ? `<li class="feed__item"><span class="list__icon">${ICON.globe}</span><span class="list__main"><b>${esc(live.current.url)}</b><span>In front now</span></span></li>` : '<li class="feed__empty muted">Nothing checked yet. Open a page in your browser.</li>'}</ul>
        </div>
        <div class="panel" id="defense">
          <div class="panel__head"><div><h2>Defense log</h2><p>What arrived, what was scanned, what was stopped.</p></div></div>
          ${ledger.length ? `<ul class="list">${ledger.slice(0, 8).map((e) => `<li>
            <span class="list__icon" style="${e.kind === 'threat' ? 'color:var(--red)' : e.kind === 'suspect' ? 'color:var(--orange)' : e.kind === 'restored' ? 'color:var(--gold-300)' : ''}">${ICON.file}</span>
            <span class="list__main"><b>${esc(e.name || e.path || '')}</b><span>${ago(e.at)} &middot; ${esc(e.kind === 'threat' ? `${e.label}: ${(e.actions || []).map((a) => a.did).join(', ')}` : e.kind === 'suspect' ? `${e.label}: runs at startup; nothing was changed. Quarantine it if you do not recognise it.` : e.kind === 'restored' ? 'Put back' : e.kind === 'noted' ? `${e.label}: noted, nothing touched` : `Clean (${e.how || 'scanned'})`)}</span></span>
            ${e.kind === 'threat' && !e.restored && (e.quarantined || (e.actions || []).some((a) => a.undo)) ? `<button class="btn btn--sm" data-restore="${esc(e.id)}">Put back</button>` : ''}
            ${e.kind === 'suspect' ? `<button class="btn btn--sm" data-suspect="${esc(e.id)}">Quarantine</button>` : ''}
          </li>`).join('')}</ul>` : '<div class="empty"><p>Nothing has needed stopping.</p></div>'}
        </div>
      </div>

      <div class="panel u-mt" id="downloads">
        <h2 class="u-mb">Recent downloads</h2>
        ${recent.length ? `<ul class="list">${[...recent].sort((a, b) => Number(Boolean(b.badge && !b.quarantined)) - Number(Boolean(a.badge && !a.quarantined))).slice(0, 8).map((d) => `<li>
          <span class="list__icon">${ICON.file}</span>
          <span class="list__main"><b>${esc(d.name)}</b><span>${bytes(d.size)} &middot; ${ago(d.scannedAt)} &middot; ${esc(d.label)}${d.badge && d.reason ? ` &middot; ${esc(d.reason)}` : ''}</span></span>
          ${d.badge && !d.quarantined ? `<button class="btn btn--sm" data-quarantine="${esc(d.id)}">Quarantine</button>` : d.quarantined ? '<span class="status">Quarantined</span>' : '<span class="status is-on">Clear</span>'}
        </li>`).join('')}</ul>` : '<div class="empty"><p>New downloads will appear here once they are scanned.</p></div>'}
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
    bindChatSafety(slot);
    bindExposures(slot);
    bindMySites(slot);
    bindTextSafety(slot);
    const defEl = $('[data-defense]', slot);
    if (defEl && !defEl.disabled) defEl.addEventListener('change', async (ev) => {
      try {
        const s = await desktop.setDefense(ev.target.checked);
        toast(s.active ? 'Defense is on.' : (s.reason || 'Defense is off.'), s.active ? 'success' : 'info');
      } catch (err) { ev.target.checked = !ev.target.checked; toast(desktopError(err), 'error'); }
      renderDesktopControls(slot);
    });
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
    $$('[data-live-mode]', slot).forEach((b) => b.addEventListener('click', async () => {
      if (b.disabled || b.classList.contains('is-on')) return;
      try { await desktop.setLiveMode(b.dataset.liveMode); } catch (err) { toast(desktopError(err), 'error'); }
      renderDesktopControls(slot);
    }));
    const auto = $('[data-auto-scan]', slot);
    if (auto) auto.addEventListener('change', async () => {
      try {
        await desktop.setAutoScan(auto.checked);
        toast(auto.checked ? 'Auto scanning is on. Open a browser and Sentinel starts scanning it.' : 'Auto scanning is off.', 'success');
      } catch (err) { auto.checked = !auto.checked; toast(desktopError(err), 'error'); }
      renderDesktopControls(slot);
    });
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
        if (text && s2.active) text.textContent = s2.window ? 'Watching the browser in front. Look for the gold mask in its bottom right corner.' : 'Ready. It starts by itself whenever a browser is in front, and rests when none is.';
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
    for (const name of ['onDefense', 'onUpdate', 'onDownloadThreat']) {
      if (desktop[name]) slot._off.push(desktop[name](() => { if (slot.isConnected) renderDesktopControls(slot); }));
    }
    $('[data-dl]', slot).addEventListener('change', async (ev) => {
      try {
        const s = await desktop.setDownloadProtection(ev.target.checked);
        toast(s.active ? 'Download protection is on.' : (s.reason || 'Download protection is off.'), s.active ? 'success' : 'info');
      } catch (err) { ev.target.checked = !ev.target.checked; toast(desktopError(err), 'error'); }
    });
    $('[data-login]', slot).addEventListener('change', async (ev) => {
      try { await desktop.setOpenAtLogin(ev.target.checked); } catch (err) { ev.target.checked = !ev.target.checked; toast(desktopError(err), 'error'); }
    });
    const scanMenu = $('[data-scan-menu]', slot);
    if (scanMenu) scanMenu.addEventListener('change', async () => {
      try {
        await desktop.setScanMenu(scanMenu.checked);
        toast(scanMenu.checked ? 'Scan with Sentinel is in the right-click menu.' : 'Scan with Sentinel is out of the right-click menu.', 'success');
      } catch (err) { scanMenu.checked = !scanMenu.checked; toast(desktopError(err), 'error'); }
    });
    const clip = $('[data-clip]', slot);
    if (clip) clip.addEventListener('change', async () => {
      try {
        await desktop.setClipboardCheck(clip.checked);
        toast(clip.checked ? 'Check links I copy is on. Copy a link and Sentinel checks it.' : 'Check links I copy is off.', 'success');
      } catch (err) { clip.checked = !clip.checked; toast(desktopError(err), 'error'); }
    });
    const walletSwitch = $('[data-wallet-guard]', slot);
    if (walletSwitch) walletSwitch.addEventListener('change', async () => {
      try {
        await desktop.setWalletGuard(walletSwitch.checked);
        toast(walletSwitch.checked ? 'Wallet guard is on.' : 'Wallet guard is off.', 'success');
      } catch (err) { walletSwitch.checked = !walletSwitch.checked; toast(desktopError(err), 'error'); }
    });
    const snipSwitch = $('[data-snip]', slot);
    const snipKey = $('[data-snip-key]', slot);
    const setSnip = async (said) => {
      try {
        const s = await desktop.setSnip(snipSwitch.checked, snipKey.value);
        snipKey.disabled = !s.enabled;
        if (s.enabled && !s.registered) toast('Another program already uses this shortcut. Choose another one.', 'error');
        else toast(said(s), 'success');
      } catch (err) { toast(desktopError(err), 'error'); }
    };
    if (snipSwitch) snipSwitch.addEventListener('change', () => setSnip((s) => (s.enabled ? 'Check something on screen is on.' : 'Check something on screen is off.')));
    if (snipKey) snipKey.addEventListener('change', () => setSnip(() => 'Shortcut changed.'));
    const shieldSwitch = $('[data-shield]', slot);
    if (shieldSwitch) shieldSwitch.addEventListener('change', async () => {
      try {
        await desktop.setCommandShield(shieldSwitch.checked);
        toast(shieldSwitch.checked ? 'Stop pasted commands is on.' : 'Stop pasted commands is off.', 'success');
      } catch (err) { shieldSwitch.checked = !shieldSwitch.checked; toast(desktopError(err), 'error'); }
    });
    // "Put it back" under the switch, for the two minutes Sentinel holds a stopped command (the notification has it too).
    const heldRow = $('[data-held]', slot);
    if (heldRow) {
      let hideTimer = null;
      const showHeld = (h) => {
        clearTimeout(hideTimer);
        heldRow.hidden = !h || h.until <= Date.now();
        if (heldRow.hidden) return;
        const at = new Date(h.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        $('[data-held-text]', heldRow).textContent = `Taken off your clipboard at ${at}${h.host ? `, copied from ${h.host}` : ''}. ${h.reason}. If you trust it, you can put it back for two minutes.`;
        hideTimer = setTimeout(() => { heldRow.hidden = true; }, h.until - Date.now());
      };
      showHeld(info.commandHeld);
      if (desktop.onCommand) slot._off.push(desktop.onCommand((h) => { if (slot.isConnected) showHeld(h); }));
      $('[data-put-back]', heldRow).addEventListener('click', async () => {
        try {
          const r = await desktop.commandPutBack();
          toast(r.ok ? `The command is back on your clipboard. ${r.message}` : r.message, r.ok ? 'success' : 'info');
        } catch (err) { toast(desktopError(err), 'error'); }
      });
    }
    const shield = $('[data-remote-guard]', slot);
    if (shield) shield.addEventListener('change', async () => {
      try {
        await desktop.setRemoteGuard(shield.checked);
        toast(shield.checked ? 'The tech-support scam shield is on.' : 'The tech-support scam shield is off.', 'success');
      } catch (err) { shield.checked = !shield.checked; toast(desktopError(err), 'error'); }
    });
    const forget = $('[data-forget-remote]', slot);
    if (forget) forget.addEventListener('click', async () => {
      try { await desktop.forgetTrustedRemote(); toast('Sentinel will ask about remote-control programs again.', 'success'); renderDesktopControls(slot); }
      catch (err) { toast(desktopError(err), 'error'); }
    });

    const check = $('[data-check-update]', slot);
    if (check) check.addEventListener('click', () => busy(check, 'Checking', async () => {
      let s;
      try { s = await desktop.checkUpdates(); } catch (err) { toast(desktopError(err), 'error'); return; }
      toast(s.status === 'current' ? 'Sentinel is up to date.' : s.status === 'error' ? 'Could not check for updates. Try again later.' : 'Checking for a newer version…', s.status === 'error' ? 'error' : 'info');
      renderDesktopControls(slot);
    }));
    const install = $('[data-install-update]', slot);
    if (install) install.addEventListener('click', () => desktop.installUpdate());
    mountModels(slot);

    $$('[data-quarantine]', slot).forEach((b) => b.addEventListener('click', async () => {
      try {
        await desktop.quarantine(b.dataset.quarantine);
        toast('File moved to quarantine.', 'success');
        renderDesktopControls(slot);
      } catch (err) { toast(desktopError(err), 'error'); }
    }));
  }

  /* ================================================================ plan */

  function planView(el) {
    const current = plan().id;
    const us = usage();
    const demo = state.config.billingMode === 'demo';
    const lines = {
      free: ['10 fast link scans a week', '5 virus & malware scans a week', '15 minutes of fast live scanning a week', 'Known threats + full checklist', 'Scam mask on link scans', 'Models older than the newest five'],
      pro: ['24 hours of fast live scanning a week', '4 hours of delicate live scanning a week', '200 fast and 40 delicate link scans', '40 virus & malware scans', 'All three masks', 'Email & download protection',
        'Newest three models: 18 h fast, 3 h delicate live; 150 fast, 30 delicate and 30 virus & malware scans'],
      max: ['Unlimited fast live scanning', '24 hours of delicate live scanning a week', '1,000 fast and 100 delicate link scans', '100 virus & malware scans', 'Paste-in email scans',
        'Every model, in full'],
      ultimate: ['Unlimited fast live scanning', '96 hours of delicate live scanning a week', 'Unlimited fast and 500 delicate link scans', '500 virus & malware scans', 'Full email scans & download protection', 'Everything in Max', 'Every model, in full']
    };
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
      <div class="plans u-mt-lg">${state.plans.map((p) => `
        <article class="plan${p.id === 'pro' ? ' plan--featured' : ''}${p.id === current ? ' is-current' : ''}">
          ${p.id === current ? '<span class="plan__badge">Current</span>' : ''}
          <div class="plan__name">${esc(p.name)}</div>
          <div class="plan__price"><b>$${p.price}</b><span>${p.price ? '/ month' : 'forever'}</span></div>
          <button class="btn btn--block ${p.id !== 'free' ? 'btn--gold' : ''}" data-plan="${p.id}" ${p.id === current ? 'disabled' : ''}>${p.id === current ? 'Your plan' : p.price < (state.plans.find((x) => x.id === current) || { price: 0 }).price ? `Switch to ${esc(p.name)}` : `Upgrade to ${esc(p.name)}`}</button>
          <ul class="plan__list">${lines[p.id].map((l) => `<li>${ICON.check}<span>${esc(l)}</span></li>`).join('')}</ul>
        </article>`).join('')}
      </div>`;

    mountModels(el);
    $$('[data-plan]', el).forEach((b) => b.addEventListener('click', () => busy(b, 'Updating', async () => {
      try {
        const data = await api('/billing/plan', { method: 'POST', body: { plan: b.dataset.plan } });
        state.me = { ...state.me, user: data.user, plan: data.plan, usage: data.usage, week: data.week };
        paintAccount();
        toast(`You are now on ${data.plan.name}.`, 'success');
        render();
      } catch (err) { toast(err.message, 'info', 6000); }
    })));
  }

  /* ============================================================ security */

  async function securityView(el) {
    const u = state.me.user;
    el.innerHTML = `
      ${title('Security', 'Protect your Sentinel account the way Sentinel protects you.')}
      <div class="grid2">
        <form class="panel" data-name-form data-draft="profile">
          <h2 class="u-mb">Profile</h2>
          <div class="row2">
            <div class="field"><label for="p-first">First name</label><input class="input" id="p-first" name="firstName" value="${esc(u.firstName)}" required maxlength="60"></div>
            <div class="field"><label for="p-last">Last name <span class="opt">(optional)</span></label><input class="input" id="p-last" name="lastName" value="${esc(u.lastName || '')}" maxlength="60"></div>
          </div>
          <div class="field"><label for="p-email">Email ${u.emailVerified ? '<span class="status is-on u-ml">Confirmed</span>' : '<span class="status is-locked u-ml">Not confirmed</span>'}</label><input class="input" id="p-email" value="${esc(u.email)}" disabled></div>
          <button class="btn u-mt" type="submit">Save profile</button>
        </form>

        <div class="panel" data-2fa></div>
      </div>

      ${u.hasPassword ? `<form class="panel" data-pw-form>
        <h2 class="u-mb">Change password</h2>
        <div class="row2">
          <div class="field"><label for="pw-cur">Current password</label><input class="input" id="pw-cur" type="password" name="currentPassword" autocomplete="current-password" required></div>
          <div class="field"><label for="pw-new">New password</label><input class="input" id="pw-new" type="password" name="newPassword" autocomplete="new-password" required minlength="10"><span class="field__hint">10+ characters with a letter and a number. You will be signed out everywhere else.</span></div>
        </div>
        <button class="btn u-mt" type="submit">Update password</button>
      </form>` : ''}

      <div class="panel" data-sessions><div class="skeleton u-h-md" ></div></div>

      <form class="panel panel--danger" data-delete>
        <h2>Delete account</h2>
        <p class="panel-lede">Permanently removes your account, history, reports and trusted sites.</p>
        <div class="row2">
          ${u.hasPassword ? '<div class="field"><label for="del-pw">Password</label><input class="input" id="del-pw" type="password" name="password" autocomplete="current-password"></div>' : ''}
          <div class="field"><label for="del-confirm">Type DELETE to confirm</label><input class="input" id="del-confirm" name="confirm" autocomplete="off"></div>
        </div>
        <button class="btn btn--danger u-mt" type="submit">Delete my account</button>
      </form>`;

    $('[data-name-form]', el).addEventListener('submit', async (ev) => {
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

    const pw = $('[data-pw-form]', el);
    if (pw) pw.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      await busy($('button', pw), 'Updating', async () => {
        try {
          await api('/account/password', { method: 'POST', body: { currentPassword: pw.currentPassword.value, newPassword: pw.newPassword.value } });
          pw.reset();
          toast('Password updated. Other sessions were signed out.', 'success');
          loadSessions();
        } catch (err) { toast(err.message, 'error'); }
      });
    });

    $('[data-delete]', el).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      await busy($('button', f), 'Deleting', async () => {
        try {
          await api('/account/delete', { method: 'POST', body: { password: f.password ? f.password.value : '', confirm: f.confirm.value } });
          location.href = '/';
        } catch (err) { toast(err.message, 'error'); }
      });
    });

    render2fa($('[data-2fa]', el));

    async function loadSessions() {
      const slot = $('[data-sessions]', el);
      try {
        const { sessions } = await api('/account/sessions');
        slot.innerHTML = `<div class="panel__head"><div><h2>Signed-in devices</h2><p>${sessions.length} active session${sessions.length === 1 ? '' : 's'}</p></div>${sessions.length > 1 ? '<button class="btn btn--sm" data-revoke>Sign out other devices</button>' : ''}</div>
          <ul class="list">${sessions.map((s) => `<li>
            <span class="list__icon">${s.kind === 'web' ? ICON.link : s.kind === 'desktop' ? ICON.download : ICON.shield}</span>
            <span class="list__main"><b>${esc(s.device)}${s.current ? ' <span class="status is-on u-ml">This device</span>' : ''}</b><span>${esc(s.kind === 'web' ? 'Browser' : s.kind === 'desktop' ? 'Sentinel app' : 'Browser companion')} &middot; ${s.ip ? esc(s.ip) + ' &middot; ' : ''}active ${ago(s.lastSeenAt || s.createdAt)} &middot; ${s.kind === 'web' ? (s.staySignedIn ? 'stays signed in, ends after 30 days unused' : 'ends when the browser closes') : 'ends after 90 days unused'}</span></span>
            ${s.current ? '' : `<button class="btn btn--sm" data-revoke-one="${esc(s.id)}">Sign out</button>`}
          </li>`).join('')}</ul>`;
        $$('[data-revoke-one]', slot).forEach((b) => b.addEventListener('click', () => busy(b, 'Signing out', async () => {
          try {
            await api('/account/sessions/revoke', { method: 'POST', body: { id: b.dataset.revokeOne } });
            toast('That device was signed out. The others were not touched.', 'success');
          } catch (err) { toast(err.message, 'error'); }
          loadSessions();
        })));
        const revoke = $('[data-revoke]', slot);
        if (revoke) revoke.addEventListener('click', () => busy(revoke, 'Signing out', async () => {
          try {
            await api('/account/sessions/revoke-others', { method: 'POST', body: {} });
            toast('Other devices were signed out.', 'success');
            loadSessions();
          } catch (err) { toast(err.message, 'error'); }
        }));
      } catch (err) { slot.innerHTML = `<div class="banner banner--error">${esc(err.message)}</div>`; }
    }
    loadSessions();
  }

  function render2fa(slot) {
    const on = state.me.user.twoFactorEnabled;
    slot.innerHTML = `<h2>Two-factor authentication</h2>
      <p class="panel-lede">${on ? 'On. Signing in needs a code from your authenticator app.' : 'Add a second step to sign-in with Google Authenticator, 1Password, Authy or any authenticator app.'}</p>
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
      <div data-tabs><div class="skeleton skeleton--tabs"></div></div><div class="panel" data-pane><div class="skeleton u-h-lg"></div></div>`;
    let providers;
    try { ({ providers } = await api('/ai/providers')); } catch (err) { $('[data-pane]', el).innerHTML = `<div class="banner banner--error">${esc(err.message)}</div>`; return; }
    const active = providers.find((p) => p.id === params.get('ai')) || providers[0];

    $('[data-tabs]', el).innerHTML = `<div class="ai-tabs" role="tablist">${providers.map((p) => `
      <button class="ai-tab" role="tab" style="--accent:${esc(p.accent)}" aria-selected="${p.id === active.id}" data-ai="${p.id}">
        <span class="ai-tab__mark">${MARKS[p.id]}</span>${esc(p.name)}<span class="ai-tab__dot${p.connected ? ' is-on' : ''}"></span>
      </button>`).join('')}</div>`;
    $$('[data-ai]', el).forEach((b) => b.addEventListener('click', () => navigate(`/app/assistants?ai=${b.dataset.ai}`)));

    const pane = $('[data-pane]', el);
    pane.style.setProperty('--accent', active.accent);
    if (active.connected) renderChat(pane, active, el);
    else renderConnect(pane, active);
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
