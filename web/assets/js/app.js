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
      view.innerHTML = `<div class="banner banner--error"><b>Sentinel couldn’t load.</b>&nbsp;${esc(err.message)}</div>`;
      return;
    }

    $$('[data-glyph]').forEach((el) => { el.innerHTML = Masks.svg(el.dataset.glyph); });
    paintAccount();
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
      row('Link scans', us.linkScans.used, us.linkScans.limit) +
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
    try { await api('/auth/logout', { method: 'POST', body: {} }); } catch { /* ignore */ }
    if (desktop) { try { await desktop.clearToken(); } catch { /* ignore */ } }
    location.href = '/';
  }

  /* ============================================================== router */

  const ROUTES = {
    '/app': ['home', home],
    '/app/scan': ['scan', scanView],
    '/app/threats': ['threats', threatsView],
    '/app/email': ['email', emailView],
    '/app/history': ['history', historyView],
    '/app/protection': ['protection', protectionView],
    '/app/download': ['protection', protectionView],
    '/app/plan': ['plan', planView],
    '/app/security': ['security', securityView],
    '/app/assistants': ['assistants', assistantsView],
    '/app/sites': ['sites', sitesView]
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
    document.title = `${{ home: 'Overview', scan: 'Link scan', threats: 'Virus & malware', email: 'Email scan', history: 'History', protection: 'Live protection', plan: 'Plan & usage', security: 'Security', assistants: 'AI assistants', sites: 'Site rules' }[name]} · Sentinel`;
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
    ['Overview', '/app', 'home'], ['Link scan', '/app/scan', 'scan'], ['Virus & malware scan', '/app/threats', 'threats'],
    ['Email scan', '/app/email', 'email'], ['History', '/app/history', 'history'], ['Site rules', '/app/sites', 'sites'],
    ['Live protection', '/app/protection', 'protection'], ['Plan & usage', '/app/plan', 'plan'], ['Security', '/app/security', 'security'],
    ['AI assistants', '/app/assistants', 'assistants']
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
        toast({ sent: 'Verification email sent.', already: 'This address is already confirmed.', failed: 'The email could not be sent right now. Try again later.', unavailable: 'This Sentinel can’t send email.' }[verification] || 'Done.', verification === 'sent' ? 'success' : 'info');
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
        <span class="list__main"><b class="${it.kind === 'url' ? 'mono' : ''}">${esc(it.target)}</b><span>${esc(it.mode === 'live' ? 'Live' : 'Manual')} ${esc(it.kind)} scan &middot; ${ago(it.created_at)}</span></span>
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
    const name = f.liveScanning ? 'delicate scanning left' : 'fast scanning left';
    if (!m || uncapped(m.limit)) return usageCard(ICON.clock, 'No limit', '', 'fast live scanning', 0, null, false, 'never resets');
    const left = Math.max(0, m.limit - m.used);
    return m.limit < 60
      ? usageCard(ICON.clock, String(left), `min / ${m.limit} min`, name, m.used, m.limit)
      : usageCard(ICON.clock, (left / 60).toFixed(left < 600 ? 1 : 0), `h / ${m.limit / 60}h`, name, m.used, m.limit);
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
      return `<div class="banner"><div><b>You’ve used this week’s scans.</b> Your ${esc(err.extra.plan)} plan resets ${until(err.extra.resetsAt)}. <a href="/app/plan" class="u-gold">See plans</a></div></div>`;
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
      ${title(`${greet}, ${esc(u.firstName)}`,'Paste anything you’re unsure about. Sentinel will tell you exactly what it finds.')}
      <form class="scanbox" data-quick>
        ${ICON.search}
        <input name="url" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="Paste a link from a message, email or search result" aria-label="Link to scan">
        <button class="btn btn--gold" type="submit">Scan</button>
      </form>
      <div class="scan-meta"><span>${left('linkScans')} of ${us.linkScans.limit} link scans left this week</span><a href="/app/threats">Scan a file instead &rarr;</a></div>

      <div class="usage-list u-mt-lg">
        <a class="usage-link" href="/app/scan" aria-label="Link scan">${usageCard(ICON.link, left('linkScans'), `/ ${us.linkScans.limit}`, `link scans left${f.research ? ', researched' : ''}`, us.linkScans.used, us.linkScans.limit)}</a>
        <a class="usage-link" href="/app/threats" aria-label="Virus and malware scan">${usageCard(ICON.shield, left('fileScans'), `/ ${us.fileScans.limit}`, 'virus & malware scans left', us.fileScans.used, us.fileScans.limit)}</a>
        <a class="usage-link" href="/app/protection" aria-label="Live protection">${liveCard(us, f)}</a>
      </div>

      <div class="u-mt">${protectionTeaser()}</div>

      <div class="panel u-mt">
        <div class="panel__head"><div><h2>Recent scans</h2><p>Your last 30 days</p></div><a class="btn btn--sm" href="/app/history">View all</a></div>
        <div data-recent><div class="skeleton u-h-md" ></div></div>
      </div>`;

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

  function scanView(el, params) {
    const f = plan().features;
    el.innerHTML = `
      ${title('Link scan', f.research
        ? 'Known threats, the full checklist, comparison with known scams, and research, for scam, virus and malware.'
        : 'Known threats, the full checklist and comparison with known scams. Upgrade for research and virus & malware masks.')}
      ${modelSlot(true)}
      <form class="scanbox" data-form>
        ${ICON.search}
        <input name="url" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://" aria-label="Link to scan" required>
        <button class="btn btn--gold" type="submit">Scan link</button>
      </form>
      <div class="scan-meta"><span data-left>${left('linkScans')} of ${usage().linkScans.limit} scans left this week</span>
        <span class="examples">
          <button class="chip" type="button" data-example="paypa1-secure-login.com/account">paypa1-secure-login.com</button>
          <button class="chip" type="button" data-example="https://github.com">github.com</button>
        </span>
      </div>
      <div data-out></div>`;

    mountModels(el);
    const form = $('[data-form]', el);
    const out = $('[data-out]', el);
    $$('[data-example]', el).forEach((b) => b.addEventListener('click', () => { form.url.value = b.dataset.example; form.requestSubmit(); }));

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const url = form.url.value.trim();
      if (!url) return;
      // Remembered in the history entry, so Back and reload show the address without spending another scan.
      history.replaceState({ scanned: url }, '', `/app/scan?url=${encodeURIComponent(url)}`);
      const button = $('button[type=submit]', form);
      out.innerHTML = stagesView(f.research);
      const stop = runStages(out, f.research);
      try {
        const data = await busy(button, 'Scanning', () => api('/scan/link', { method: 'POST', body: { url } }));
        stop();
        applyUsage(data.usage);
        showVerdict(out, data.verdict, { lockedLabel: 'Pro & up' });
        $('[data-left]', el).textContent = `${left('linkScans')} of ${usage().linkScans.limit} scans left this week`;
      } catch (err) {
        stop();
        out.innerHTML = friendlyError(err);
      }
    });

    const preset = params.get('url');
    if (preset) {
      form.url.value = preset;
      if (!history.state || history.state.scanned !== preset) form.requestSubmit();
    }
  }

  const REPORT_CATEGORIES = [
    ['phishing', 'Phishing / fake login'], ['fake_store', 'Fake shop'], ['crypto_scam', 'Crypto scam'], ['tech_support_scam', 'Tech support scam'],
    ['investment_scam', 'Investment scam'], ['romance_scam', 'Romance scam'], ['impersonation', 'Impersonates a brand or person'], ['malware', 'Spreads malware'], ['other', 'Something else']
  ];

  function actionsFor(v) {
    const copy = '<button class="btn btn--sm" data-copy-report>Copy report</button>';
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
  }

  /* ========================================================= email scan */

  function emailView(el) {
    const f = plan().features;
    if (!f.emailManual) {
      el.innerHTML = `${title('Email scan', 'Paste a suspicious email and Sentinel checks the sender, wording, every link and every attachment.')}
        ${lockedCard({ tag: 'Max', heading: 'Scan any email you paste in', body: `Pasting emails in is part of Sentinel Max. ${f.emailLive ? 'Your Pro plan already marks emails automatically in Gmail and Outlook through the Sentinel app.' : 'Pro, Max and Ultimate also mark emails automatically in Gmail and Outlook.'}`, actions: '<a class="btn btn--gold" href="/app/plan">Upgrade to Max</a>' })}`;
      return;
    }
    el.innerHTML = `
      ${title('Email scan', 'Paste what you see in your inbox. Every link and the sender’s domain go through the full link pipeline too.',
        '<div class="segmented" role="tablist"><button role="tab" data-emode="fields" aria-selected="true">Fill in</button><button role="tab" data-emode="paste" aria-selected="false">Paste whole email</button></div>')}
      <form class="panel" data-paste data-draft="email-paste" hidden>
        <div class="field"><label for="e-raw">Paste the whole email, headers and all</label><textarea class="textarea" id="e-raw" name="raw" rows="10" placeholder="From: PayPal Security <alerts@example.com>&#10;Subject: Your account is limited&#10;&#10;Dear customer, ..."></textarea><span class="field__hint">Sentinel picks out the sender, reply-to, subject and links, then fills the form for you to check.</span></div>
        <div class="report__foot"><span></span><button class="btn btn--gold" type="button" data-parse>Read this email</button></div>
      </form>
      <form class="panel" data-form data-draft="email-scan">
        <div class="row2">
          <div class="field"><label for="e-from">From</label><input class="input" id="e-from" name="from" placeholder="PayPal Security &lt;alerts@example.com&gt;" autocomplete="off"></div>
          <div class="field"><label for="e-reply">Reply-to <span class="opt">(optional)</span></label><input class="input" id="e-reply" name="replyTo" autocomplete="off"></div>
        </div>
        <div class="field"><label for="e-subject">Subject</label><input class="input" id="e-subject" name="subject" autocomplete="off"></div>
        <div class="field"><label for="e-body">Message</label><textarea class="textarea" id="e-body" name="body" placeholder="Paste the message text, including any links"></textarea></div>
        <div class="field"><label for="e-att">Attachment names <span class="opt">(optional, comma separated)</span></label><input class="input" id="e-att" name="attachments" placeholder="Invoice_2026.pdf.exe, statement.zip" autocomplete="off"></div>
        <div class="report__foot">
          <span class="muted">Uses 1 of your ${left('linkScans')} remaining link scans. Nothing is stored.</span>
          <button class="btn btn--gold" type="submit">Scan email</button>
        </div>
      </form>
      <div data-out></div>`;

    const form = $('[data-form]', el);
    const out = $('[data-out]', el);
    const pasteBox = $('[data-paste]', el);
    $$('[data-emode]', el).forEach((b) => b.addEventListener('click', () => {
      $$('[data-emode]', el).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      pasteBox.hidden = b.dataset.emode !== 'paste';
      if (!pasteBox.hidden) $('textarea', pasteBox).focus();
    }));
    $('[data-parse]', el).addEventListener('click', () => {
      const raw = $('textarea', pasteBox).value;
      if (!raw.trim()) return;
      const m = parseEmail(raw);
      form.from.value = m.from; form.replyTo.value = m.replyTo; form.subject.value = m.subject; form.body.value = m.body; form.attachments.value = m.attachments.join(', ');
      $$('[data-emode]', el).forEach((x) => x.setAttribute('aria-selected', String(x.dataset.emode === 'fields')));
      pasteBox.hidden = true;
      // Filled in by script, which raises no input event: say so, so the draft keeps what was filled in.
      form.dispatchEvent(new Event('input', { bubbles: true }));
      toast(m.from ? `Found sender ${m.from}. Check the fields, then scan.` : 'No headers found, so the text went into the message field.', 'info', 5000);
      form.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = form.body.value;
      const links = [...new Set(body.match(/https?:\/\/[^\s<>"')]+/g) || [])].map((href) => ({ href, text: '' }));
      const payload = {
        from: form.from.value, replyTo: form.replyTo.value, subject: form.subject.value, body,
        links, attachments: form.attachments.value.split(',').map((s) => s.trim()).filter(Boolean)
      };
      out.innerHTML = stagesView(true);
      const stop = runStages(out, true);
      try {
        const data = await busy($('button[type=submit]', form), 'Scanning', () => api('/scan/email', { method: 'POST', body: payload }));
        stop();
        applyUsage(data.usage);
        showVerdict(out, data.verdict);
      } catch (err) { stop(); out.innerHTML = friendlyError(err); }
    });
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
    $('[data-stats]', el).innerHTML = stat('scam', s.scams, 'scams caught', 'var(--red)', 'scam') + stat('virus', s.viruses, 'viruses caught', 'var(--orange)', 'virus') + stat('malware', s.malware, 'malware caught', 'var(--yellow)', 'malware');

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
      section($('[data-allow]', el), 'allow', 'Trusted', 'No trusted sites yet. Use “Trust this site” on any scan result, or add one above.');
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
        ${feature(ICON.mail, 'Email masks', 'Gmail and Outlook on the web: the messages in your inbox list get a tick or a mask before you open them. Sentinel reads only what the list shows (sender, subject, first line) and never opens a message.', f.emailLive && !planLocked ? '<span class="status">Optional add-on</span>' : st(false, 'Pro & up'))}
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
      </div>`;

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
    } catch { $('.skeleton', slot).outerHTML = '<p class="muted">Feed status is unavailable right now.</p>'; }
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
    // Left the page while waiting: subscribing now would leave listeners behind that nothing ever removes.
    if (!slot.isConnected) return;
    const browsers = (info.browsers && info.browsers.installed) || [];
    const running = new Set((info.browsers && info.browsers.running) || []);
    const up = info.update || { status: 'idle' };
    const UPDATE_TEXT = {
      checking: 'Checking for updates…',
      downloading: `Downloading ${up.version || 'an update'}${up.progress ? ` (${up.progress}%)` : ''}…`,
      ready: `Version ${up.version} is ready. It installs when Sentinel quits.`,
      current: 'Sentinel is up to date.',
      // The updater's own error text is technical; the log keeps it.
      error: 'Could not check for updates. Sentinel tries again by itself later.',
      dev: 'Updates are off in a development run.',
      unavailable: 'This build cannot update itself.'
    };

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
          <label class="setting"><div><b>Start with my computer</b><span>Keep protection running from the moment you sign in.</span></div><input class="switch" type="checkbox" data-login ${info.openAtLogin ? 'checked' : ''}></label>
          <div class="setting"><div><b>Sentinel ${esc(info.version)}</b><span>${esc(updateText(up))}</span></div>
            ${up.status === 'ready' ? '<button class="btn btn--sm btn--gold" data-install-update>Restart now</button>'
              : up.supported ? '<button class="btn btn--sm" data-check-update>Check now</button>' : ''}</div>
          ${modelSlot(false)}
        </div>
      </div>

      <div class="grid2 u-mt">
        <div class="panel">
          <div class="panel__head"><div><h2>Live, right now</h2><p>${live.active ? 'Pages show up here as they are checked. Private windows never do.' : 'Start scanning to see pages as they are checked.'}</p></div><span class="live-dot${live.active ? ' is-on' : ''}" aria-hidden="true"></span></div>
          <ul class="list feed" data-feed>${live.current && live.current.url ? `<li class="feed__item"><span class="list__icon">${ICON.globe}</span><span class="list__main"><b>${esc(live.current.url)}</b><span>In front now</span></span></li>` : '<li class="feed__empty muted">Nothing checked yet. Open a page in your browser.</li>'}</ul>
        </div>
        <div class="panel">
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
        </li>`).join('')}</ul>` : '<div class="empty"><p>New downloads will appear here once they’re scanned.</p></div>'}
      </div>`;

    if (focusKey) {
      const again = $$(`[data-${focusKey.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`, slot).find((el2) => el2.dataset[focusKey] === focusValue);
      if (again) again.focus({ preventScroll: true });
    }
    // Opened from a "dangerous download" notification: straight to the file and its Quarantine button, once.
    if (location.hash === '#downloads' && !state.scrolledToDownloads) {
      state.scrolledToDownloads = true;
      const dl = $('#downloads', slot);
      if (dl) dl.scrollIntoView({ block: 'start' });
    }
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
    $('[data-login]', slot).addEventListener('change', (ev) => desktop.setOpenAtLogin(ev.target.checked));
    const clip = $('[data-clip]', slot);
    if (clip) clip.addEventListener('change', async () => {
      try {
        await desktop.setClipboardCheck(clip.checked);
        toast(clip.checked ? 'Sentinel will check links you copy.' : 'Copied links are no longer checked.', 'success');
      } catch (err) { clip.checked = !clip.checked; toast(desktopError(err), 'error'); }
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
      free: ['10 link scans a week', '5 virus & malware scans a week', 'Known threats + full checklist', 'Scam mask on link scans'],
      pro: ['24 hours of fast live scanning a week', '4 hours of delicate live scanning a week', '40 researched link scans', '40 virus & malware scans', 'All three masks', 'Email & download protection'],
      max: ['Unlimited fast live scanning', '24 hours of delicate live scanning a week', '100 researched link scans', '100 virus & malware scans', 'Paste-in email scans'],
      ultimate: ['Unlimited fast live scanning', '96 hours of delicate live scanning a week', '500 researched link scans', '500 virus & malware scans', 'Full email scans & download protection', 'Everything in Max']
    };
    el.innerHTML = `
      ${title('Plan &amp; usage', `You’re on <b>${esc(plan().name)}</b>. Weekly allowances reset ${until(state.me.week.resetsAt)}.`)}
      ${demo ? '<div class="banner"><div><b>Demo billing.</b> Plan changes are instant and free on this server. No payment is taken.</div></div>' : ''}
      <div class="usage-list">
        ${usageCard(ICON.link, left('linkScans'), `/ ${us.linkScans.limit}`, 'link scans left', us.linkScans.used, us.linkScans.limit)}
        ${usageCard(ICON.shield, left('fileScans'), `/ ${us.fileScans.limit}`, 'virus & malware scans left', us.fileScans.used, us.fileScans.limit)}
        ${liveCard(us, plan().features)}
      </div>
      <div class="plans u-mt-lg">${state.plans.map((p) => `
        <article class="plan${p.id === 'pro' ? ' plan--featured' : ''}${p.id === current ? ' is-current' : ''}">
          ${p.id === current ? '<span class="plan__badge">Current</span>' : ''}
          <div class="plan__name">${esc(p.name)}</div>
          <div class="plan__price"><b>$${p.price}</b><span>${p.price ? '/ month' : 'forever'}</span></div>
          <button class="btn btn--block ${p.id !== 'free' ? 'btn--gold' : ''}" data-plan="${p.id}" ${p.id === current ? 'disabled' : ''}>${p.id === current ? 'Your plan' : p.price < (state.plans.find((x) => x.id === current) || { price: 0 }).price ? `Switch to ${esc(p.name)}` : `Upgrade to ${esc(p.name)}`}</button>
          <ul class="plan__list">${lines[p.id].map((l) => `<li>${ICON.check}<span>${esc(l)}</span></li>`).join('')}</ul>
        </article>`).join('')}
      </div>`;

    $$('[data-plan]', el).forEach((b) => b.addEventListener('click', () => busy(b, 'Updating', async () => {
      try {
        const data = await api('/billing/plan', { method: 'POST', body: { plan: b.dataset.plan } });
        state.me = { ...state.me, user: data.user, plan: data.plan, usage: data.usage, week: data.week };
        paintAccount();
        toast(`You’re now on ${data.plan.name}.`, 'success');
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
          <div class="field"><label for="pw-new">New password</label><input class="input" id="pw-new" type="password" name="newPassword" autocomplete="new-password" required minlength="10"><span class="field__hint">10+ characters with a letter and a number. You’ll be signed out everywhere else.</span></div>
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
    el.innerHTML = `${title('AI assistants', 'Optional. Ask ChatGPT, Claude, Gemini or DeepSeek about anything. Sentinel’s scans never depend on them.')}
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
        <div><h2>Connect ${esc(p.name)}</h2><p class="note">Uses ${esc(p.vendor)}’s official API with a key from your own account &middot; <span class="mono">${esc(p.model)}</span></p></div></div>
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
