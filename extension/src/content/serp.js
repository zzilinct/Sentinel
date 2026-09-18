/**
 * Sentinel Companion - search results.
 *
 * Adds up to three masks after each risky result title: scam, virus, malware,
 * each coloured by severity. Safe results are left untouched. On Max, masks
 * appear from the checklist first and are upgraded when research completes.
 */
(() => {
  'use strict';
  const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;
  if (window.__sentinelSerp) return;
  window.__sentinelSerp = true;

  const Masks = window.SentinelMasks;
  const RANK = { yellow: 1, orange: 2, red: 3 };
  const THREATS = ['scam', 'virus', 'malware'];
  const DEFAULTS = { enabled: true, badgeStyle: 'mask', minimumBadge: 'yellow' };

  let settings = DEFAULTS;
  const seen = new WeakSet();
  const byUrl = new Map();                 // url -> [anchor]
  let popover = null;

  const ENGINES = [
    { test: /(^|\.)google\./, titles: '#search h3, #rso h3, #botstuff h3' },
    { test: /(^|\.)bing\./, titles: '#b_results li.b_algo h2' },
    { test: /duckduckgo\./, titles: '[data-testid="result-title-a"], a.result__a, .result-link' },
    { test: /search\.yahoo\./, titles: '#web h3' },
    { test: /search\.brave\./, titles: '#results .snippet .title, #results a .title' },
    { test: /ecosia\./, titles: '[data-test-id="mainline-result-web"] .result-title, .result__title' },
    { test: /startpage\./, titles: '.w-gl__result-title, .result-title' },
    { test: /mojeek\./, titles: '.results-standard li h2' },
    { test: /yandex\./, titles: '.OrganicTitle, .organic__title' }
  ];
  const engine = ENGINES.find((e) => e.test.test(location.hostname)) || { titles: '' };

  const SEARCH_HOSTS = /(^|\.)(google|bing|duckduckgo|yahoo|brave|ecosia|startpage|mojeek|yandex|googleusercontent|gstatic)\.[a-z.]+$/;

  /* ------------------------------------------------------------- urls */

  function realUrl(href) {
    let u;
    try { u = new URL(href, location.href); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const wrapped = u.searchParams.get('uddg') || u.searchParams.get('q') || u.searchParams.get('url') || u.searchParams.get('u');
    if (wrapped && /^https?:\/\//i.test(wrapped) && (SEARCH_HOSTS.test(u.hostname) || /\/(url|l)\/?$/.test(u.pathname))) {
      try { return new URL(wrapped).href; } catch { /* fall through */ }
    }
    return u.href;
  }

  function isResult(anchor, url) {
    if (!url) return false;
    let host;
    try { host = new URL(url).hostname; } catch { return false; }
    if (host === location.hostname || SEARCH_HOSTS.test(host)) return false;
    return !anchor.closest('nav, header, footer, [role="navigation"]');
  }

  /* ----------------------------------------------------------- badges */

  function badgeFor(threat, info) {
    const el = document.createElement('span');
    el.className = `sentinel-mask sentinel-mask--${info.badge}`;
    el.dataset.threat = threat;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', `Sentinel: ${info.label}`);
    el.title = `Sentinel: ${info.label}`;
    if (settings.badgeStyle === 'emoji') {
      el.classList.add('sentinel-mask--emoji');
      el.textContent = '🎭';
    } else {
      el.innerHTML = Masks.svg(threat);
    }
    return el;
  }

  function attach(anchor, verdict) {
    if (!verdict || !verdict.ok) return;
    const heading = anchor.closest('h1, h2, h3') || anchor.querySelector('h1, h2, h3') || anchor;
    const old = heading.querySelector(':scope > .sentinel-masks');
    if (old) old.remove();

    const shown = THREATS.filter((t) => verdict.threats[t] && verdict.threats[t].badge && RANK[verdict.threats[t].badge] >= RANK[settings.minimumBadge]);
    if (!shown.length) return;

    const group = document.createElement('span');
    group.className = 'sentinel-masks';
    group.dataset.researched = verdict.researched ? '1' : '0';
    for (const t of shown) group.appendChild(badgeFor(t, verdict.threats[t]));
    const open = (ev) => { ev.preventDefault(); ev.stopPropagation(); showPopover(group, verdict); };
    group.addEventListener('click', open);
    group.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') open(ev); });
    heading.appendChild(group);

    const row = anchor.closest('[data-hveid], li, .result, article') || anchor.parentElement;
    if (row) row.classList.toggle('sentinel-row--danger', verdict.overall.badge === 'red');
  }

  /* ---------------------------------------------------------- popover */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function ensurePopover() {
    if (popover) return popover;
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      :host{all:initial}
      .card{position:fixed;width:340px;max-width:calc(100vw - 24px);background:#15171b;color:#ecebe7;border:1px solid #2e3239;border-radius:16px;
        box-shadow:0 24px 60px rgba(0,0,0,.45);padding:18px 18px 16px;font:13px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
        opacity:0;transform:translateY(6px) scale(.98);transition:opacity .16s ease,transform .16s ease}
      .card.on{opacity:1;transform:none}
      .brand{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;color:#c9a64e;font-size:10.5px;letter-spacing:.2em;font-weight:700}
      .x{all:unset;cursor:pointer;color:#80868f;font-size:18px;line-height:1;padding:2px 6px;border-radius:6px}.x:hover{color:#fff;background:#23262c}
      .host{font:600 12px/1.4 ui-monospace,Menlo,Consolas,monospace;color:#9aa0a8;margin-bottom:12px;word-break:break-all}
      .threats{display:grid;gap:8px;margin-bottom:12px}
      .t{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;background:#1c1f24;border:1px solid #272a30}
      .t svg{width:22px;height:22px;flex:none}.t b{font-weight:650;font-size:13px}.t span{margin-left:auto;color:#80868f;font-size:11px}
      ul{list-style:none;margin:0 0 12px;padding:0;display:grid;gap:6px}li{display:flex;gap:8px;color:#c7cad0}li:before{content:"";flex:none;width:5px;height:5px;margin-top:7px;border-radius:50%;background:#c9a64e}
      .meta{color:#80868f;font-size:11px;margin-bottom:12px}
      .row{display:flex;gap:8px}button.a{all:unset;cursor:pointer;font-weight:600;font-size:12px;padding:8px 12px;border-radius:9px;background:#23262c;color:#ecebe7}
      button.a:hover{background:#2c3037}button.p{background:linear-gradient(180deg,#e0c070,#c49b3c);color:#15171b}
    </style><div class="card" role="dialog" hidden></div>`;
    document.documentElement.appendChild(host);
    popover = { host, card: root.querySelector('.card') };
    document.addEventListener('click', (ev) => { if (!popover.card.hidden && !ev.composedPath().includes(popover.card)) hide(); }, true);
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hide(); });
    window.addEventListener('scroll', hide, { passive: true });
    return popover;
  }

  function hide() {
    if (!popover || popover.card.hidden) return;
    popover.card.classList.remove('on');
    setTimeout(() => { popover.card.hidden = true; }, 160);
  }

  function showPopover(anchorEl, v) {
    const { card } = ensurePopover();
    const rows = THREATS.filter((t) => v.threats[t]).map((t) => {
      const th = v.threats[t];
      const color = th.badge ? Masks.COLORS[th.badge] : Masks.COLORS.clear;
      return `<div class="t" style="color:${color}">${Masks.svg(t)}<b>${esc(th.label)}</b><span>${th.score}/100</span></div>`;
    }).join('');
    card.innerHTML = `
      <div class="brand">SENTINEL<button class="x" aria-label="Close">&times;</button></div>
      <div class="host">${esc(v.host)}</div>
      <div class="threats">${rows}</div>
      <ul>${(v.reasons || []).slice(0, 4).map((r) => `<li>${esc(r.text)}</li>`).join('') || '<li>No specific warning signs</li>'}</ul>
      <div class="meta">${v.researched ? 'Researched' : 'Checklist'} &middot; ${v.checklist ? `${v.checklist.failed + v.checklist.warned} of ${v.checklist.total} checks raised concerns` : 'confirmed threat list'}</div>
      <div class="row"><button class="a p" data-act="report">Report</button><button class="a" data-act="trust">Trust this site</button></div>`;
    card.hidden = false;
    const r = anchorEl.getBoundingClientRect();
    card.style.left = `${Math.max(12, Math.min(r.left, innerWidth - 352))}px`;
    card.style.top = `${r.bottom + 330 > innerHeight ? Math.max(12, r.top - 340) : r.bottom + 8}px`;
    requestAnimationFrame(() => card.classList.add('on'));

    card.querySelector('.x').onclick = hide;
    card.querySelector('[data-act="report"]').onclick = async (ev) => {
      ev.target.textContent = 'Reporting...';
      const res = await send({ type: 'report', url: v.url, category: 'phishing' });
      ev.target.textContent = res.ok ? 'Reported' : (res.error || 'Could not report');
    };
    card.querySelector('[data-act="trust"]').onclick = async (ev) => {
      const res = await send({ type: 'override', url: v.url, action: 'allow' });
      if (!res.ok) { ev.target.textContent = res.error || 'Sign in first'; return; }
      for (const a of byUrl.get(v.requested || v.url) || []) {
        const heading = a.closest('h1, h2, h3') || a.querySelector('h1, h2, h3') || a;
        const group = heading.querySelector(':scope > .sentinel-masks');
        if (group) group.remove();
      }
      hide();
    };
  }

  /* ------------------------------------------------------- collection */

  function collect() {
    const anchors = new Set();
    if (engine.titles) {
      for (const node of document.querySelectorAll(engine.titles)) {
        const a = node.tagName === 'A' ? node : (node.closest('a[href]') || node.querySelector('a[href]'));
        if (a) anchors.add(a);
      }
    }
    if (!anchors.size) {
      for (const h of document.querySelectorAll('h2 a[href], h3 a[href], a[href] h2, a[href] h3')) {
        anchors.add(h.tagName === 'A' ? h : h.closest('a[href]'));
      }
    }
    for (const a of anchors) {
      if (!a || seen.has(a)) continue;
      seen.add(a);
      const url = realUrl(a.getAttribute('href'));
      if (!isResult(a, url)) continue;
      if (!byUrl.has(url)) byUrl.set(url, []);
      byUrl.get(url).push(a);
      anchorUrl.set(a, url);
      nearView.observe(a);
    }
  }

  // Only check results that are on screen or about to be: long result pages and
  // infinite scroll don't spend live-scanning time on links nobody looks at.
  const anchorUrl = new WeakMap();
  const requested = new Set();
  const nearView = new IntersectionObserver((entries) => {
    let added = false;
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      nearView.unobserve(e.target);
      const url = anchorUrl.get(e.target);
      if (url && !requested.has(url)) { requested.add(url); queue.push(url); added = true; }
    }
    if (added) {
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, 60);   // batch results that appear together
    }
  }, { rootMargin: '900px 0px' });
  let flushTimer;

  function send(message) {
    return new Promise((resolve) => {
      try {
        Promise.resolve(ext.runtime.sendMessage(message)).then((res) => resolve(res || { ok: false }), () => resolve({ ok: false, error: 'Sentinel is restarting' }));
      } catch { resolve({ ok: false }); }
    });
  }

  function apply(verdicts) {
    for (const [url, verdict] of Object.entries(verdicts || {})) {
      for (const a of byUrl.get(url) || []) if (a.isConnected) attach(a, verdict);
    }
  }

  let queue = [];
  let busy = false;
  async function flush() {
    if (busy || !queue.length || !settings.enabled) return;
    busy = true;
    const urls = queue.splice(0, 30);
    try {
      const quick = await send({ type: 'live-batch', urls, phase: 'quick' });
      if (quick.locked) { queue = []; return; }
      apply(quick.verdicts);
      // Max: follow up with researched verdicts, which may raise or clear masks.
      send({ type: 'live-batch', urls, phase: 'research' }).then((r) => { if (r.ok && !r.locked) apply(r.verdicts); });
    } finally {
      busy = false;
      if (queue.length) setTimeout(flush, 50);
    }
  }

  let timer;
  function schedule(delay = 300) {
    clearTimeout(timer);
    timer = setTimeout(collect, delay);
  }

  Promise.resolve(ext.storage.sync.get(DEFAULTS)).then((stored) => {
    settings = { ...DEFAULTS, ...(stored || {}) };
    if (!settings.enabled) return;
    schedule(0);
    new MutationObserver(() => schedule()).observe(document.body, { childList: true, subtree: true });
  });
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
  });
})();
