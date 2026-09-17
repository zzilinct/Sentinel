/* Shared helpers for the Sentinel web app and auth pages. */
window.UI = (() => {
  'use strict';

  const Masks = window.SentinelMasks;
  const THREATS = ['scam', 'virus', 'malware'];
  const SEV = { safe: 0, caution: 1, suspicious: 2, likely: 3, confirmed: 4 };

  /* ------------------------------------------------------------- api */

  class ApiError extends Error {
    constructor(message, status, body) {
      super(message);
      this.status = status;
      this.code = body && body.code;
      this.extra = body || {};
      this.errors = (body && body.errors) || {};
    }
  }

  async function api(path, { method = 'GET', body, raw, headers = {}, signal } = {}) {
    const init = { method, credentials: 'same-origin', headers: { ...headers }, signal };
    if (raw !== undefined) init.body = raw;
    else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
    let res;
    try {
      res = await fetch(`/api/v1${path}`, init);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new ApiError('Could not reach Sentinel. Check your connection and try again.', 0);
    }
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
      const e = (data && data.error) || {};
      throw new ApiError(e.message || `Something went wrong (${res.status})`, res.status, e);
    }
    return data;
  }

  /* ----------------------------------------------------------- utils */

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function ago(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const hr = Math.round(m / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.round(hr / 24);
    return d < 7 ? `${d}d ago` : new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function until(ts) {
    const hrs = Math.max(0, Math.round((ts - Date.now()) / 3600e3));
    if (hrs < 24) return `in ${hrs} hour${hrs === 1 ? '' : 's'}`;
    const d = Math.round(hrs / 24);
    return `in ${d} day${d === 1 ? '' : 's'}`;
  }

  function bytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  /* ---------------------------------------------------------- toasts */

  let toastHost = null;
  function toast(message, kind = 'info', ms = 3800) {
    if (!toastHost) {
      toastHost = h('<div class="toasts" role="status" aria-live="polite"></div>');
      document.body.appendChild(toastHost);
    }
    const el = h(`<div class="toast toast--${kind}"><span>${esc(message)}</span></div>`);
    toastHost.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-on'));
    setTimeout(() => { el.classList.remove('is-on'); setTimeout(() => el.remove(), 300); }, ms);
  }

  /* ----------------------------------------------------------- busy */

  async function busy(button, label, fn) {
    const original = button.innerHTML;
    button.classList.add('is-busy');
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = `<span class="spinner"></span>${esc(label)}`;
    try {
      return await fn();
    } finally {
      button.classList.remove('is-busy');
      button.removeAttribute('aria-busy');
      button.innerHTML = original;
    }
  }

  /* -------------------------------------------------------- verdicts */

  const color = (badge) => (badge ? Masks.COLORS[badge] : Masks.COLORS.clear);

  function worst(threats) {
    return THREATS.filter((t) => threats[t]).sort((a, b) => SEV[threats[b].level] - SEV[threats[a].level])[0];
  }

  function headline(v) {
    const t = worst(v.threats);
    const th = t && v.threats[t];
    if (!th || !th.badge) return { title: 'No threats found', sub: 'Nothing on the checklist raised a concern.', tone: 'clear', threat: t || 'scam' };
    const titles = {
      scam: { yellow: 'This looks suspicious', orange: 'This is likely a scam', red: 'This is a confirmed scam' },
      virus: { yellow: 'This may carry a virus', orange: 'This likely carries a virus', red: 'Virus detected' },
      malware: { yellow: 'This may contain malware', orange: 'This likely contains malware', red: 'Malware detected' }
    };
    const sub = th.evidence ? th.evidence : th.badge === 'orange' ? 'Many strong warning signs at once. Don’t enter any details.' : 'Some warning signs. Take a careful second look before continuing.';
    return { title: titles[t][th.badge], sub, tone: th.badge, threat: t, kind: th.kind || null, kindLabel: th.kindLabel || null };
  }

  function threatTiles(v, { lockedLabel = 'Pro & up' } = {}) {
    return `<div class="tiles3">${THREATS.map((t) => {
      const th = v.threats[t];
      if (!th) {
        return `<div class="threat is-locked"><div class="threat__glyph">${Masks.svg(t)}</div><div class="threat__name">${Masks.NAMES[t]}</div><div class="threat__level"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>${esc(lockedLabel)}</div></div>`;
      }
      return `<div class="threat" style="--c:${color(th.badge)}">
        <div class="threat__glyph">${Masks.svg(t)}</div>
        <div class="threat__name">${Masks.NAMES[t]}</div>
        <div class="threat__level">${esc(th.badge ? th.label : 'Clear')}</div>
        ${th.kind ? `<div class="threat__kind">${Masks.kindIcon(th.kind)}<span>${esc(th.kindLabel)}</span></div>` : ''}
        <div class="threat__meter"><i style="width:${Math.max(3, th.score)}%"></i></div>
        <div class="threat__score mono">${th.score}<span>/100</span></div>
      </div>`;
    }).join('')}</div>`;
  }

  const STATUS_ICON = {
    fail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/></svg>',
    pass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 12 4 4 8-9"/></svg>',
    skip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 12h10"/></svg>'
  };

  function checklist(items) {
    const groups = new Map();
    for (const c of items) {
      if (!groups.has(c.group)) groups.set(c.group, []);
      groups.get(c.group).push(c);
    }
    return [...groups].map(([group, list]) => {
      const bad = list.filter((c) => c.status === 'fail' || c.status === 'warn').length;
      const passed = list.filter((c) => c.status === 'pass').length;
      const open = bad > 0 ? ' open' : '';
      const label = bad ? `${bad} concern${bad === 1 ? '' : 's'}` : passed ? `${passed} passed${passed < list.length ? `, ${list.length - passed} skipped` : ''}` : 'not run';
      return `<details class="group"${open}>
        <summary><span>${esc(group)}</span><span class="group__count ${bad ? 'is-bad' : ''}">${label}</span><i></i></summary>
        <ul class="checks">${list.map((c) => `
          <li class="check check--${c.status}" data-status="${c.status}" data-threat="${c.threat}">
            <span class="check__icon">${STATUS_ICON[c.status]}</span>
            <span class="check__body"><b>${esc(c.title)}</b>${c.detail ? `<span>${esc(c.detail)}</span>` : ''}</span>
            <span class="check__tag">${esc(Masks.NAMES[c.threat])}</span>
          </li>`).join('')}
        </ul>
      </details>`;
    }).join('');
  }

  /** Filter chips, search and expand/collapse for a rendered checklist. */
  function wireChecklist(root) {
    const bar = $('[data-check-tools]', root);
    if (!bar) return;
    const checks = $$('.check', root);
    const groups = $$('details.group', root);
    const search = $('[data-check-search]', bar);
    const count = $('[data-check-count]', bar);
    let status = 'all';
    const threats = new Set(THREATS);

    const apply = () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      for (const li of checks) {
        const s = li.dataset.status;
        const okStatus = status === 'all' || (status === 'concerns' ? s === 'fail' || s === 'warn' : s === status);
        const ok = okStatus && threats.has(li.dataset.threat) && (!q || li.textContent.toLowerCase().includes(q));
        li.hidden = !ok;
        if (ok) shown++;
      }
      for (const g of groups) {
        const visible = $$('.check', g).filter((li) => !li.hidden).length;
        g.hidden = visible === 0;
        if (q && visible) g.open = true;
        const c = $('.group__count', g);
        if (status !== 'all' || q || threats.size < THREATS.length) c.textContent = `${visible} shown`;
        else c.textContent = c.dataset.label;
      }
      count.textContent = `${shown} of ${checks.length}`;
    };
    $$('.group__count', root).forEach((c) => { c.dataset.label = c.textContent; });

    $$('[data-status-filter]', bar).forEach((b) => b.addEventListener('click', () => {
      status = b.dataset.statusFilter;
      $$('[data-status-filter]', bar).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      apply();
    }));
    $$('[data-threat-filter]', bar).forEach((b) => b.addEventListener('click', () => {
      const t = b.dataset.threatFilter;
      if (threats.has(t) && threats.size > 1) threats.delete(t); else threats.add(t);
      b.setAttribute('aria-pressed', String(threats.has(t)));
      apply();
    }));
    search.addEventListener('input', apply);
    const expand = $('[data-expand]', bar);
    expand.addEventListener('click', () => {
      const anyClosed = groups.some((g) => !g.hidden && !g.open);
      groups.forEach((g) => { g.open = anyClosed; });
      expand.textContent = anyClosed ? 'Collapse all' : 'Expand all';
    });
  }

  /** Plain-text summary of a verdict, for pasting into a message or a report. */
  function reportText(v) {
    const subject = v.kind === 'file' ? v.file.name : v.kind === 'email' ? (v.sender.address || 'Email') : v.url;
    const lines = [`Sentinel scan - ${headline(v).title}`, subject, ''];
    for (const t of THREATS) if (v.threats[t]) lines.push(`${Masks.NAMES[t]}: ${v.threats[t].label} (${v.threats[t].score}/100)`);
    if (v.reasons && v.reasons.length) { lines.push('', 'Why:'); v.reasons.forEach((r) => lines.push(`- ${r.text}`)); }
    const concerns = v.checklist.items.filter((c) => c.status === 'fail' || c.status === 'warn');
    if (concerns.length) { lines.push('', `Checklist (${concerns.length} of ${v.checklist.total} raised a concern):`); concerns.forEach((c) => lines.push(`- ${c.title}${c.detail ? ` - ${c.detail}` : ''}`)); }
    lines.push('', `Scanned ${new Date().toLocaleString()} with Sentinel`);
    return lines.join('\n');
  }

  function wireCopy(root, v) {
    const copy = $('[data-copy-report]', root);
    if (copy) copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(reportText(v)); toast('Report copied - paste it anywhere.', 'success'); }
      catch { toast('Couldn’t access the clipboard.', 'error'); }
    });
  }

  function wireVerdict(root, v) {
    wireChecklist(root);
    wireCopy(root, v);
  }

  /** The full result view used by link, threat, file and email scans. */
  function verdict(v, { lockedLabel } = {}) {
    const head = headline(v);
    const subject = v.kind === 'file' ? v.file.name : v.kind === 'email' ? (v.sender.address || 'Email') : v.host;
    const facts = [];
    if (v.knowledge) {
      facts.push(['Threat sources', `${v.knowledge.sources.length} checked`]);
      facts.push(['Known record', v.knowledge.known ? 'Yes' : v.knowledge.trusted ? 'Verified site' : 'None found']);
    }
    if (v.research) {
      const r = v.research;
      if (r.domainAgeDays != null) facts.push(['Domain age', r.domainAgeDays < 60 ? `${r.domainAgeDays} days` : r.domainAgeDays < 730 ? `${Math.round(r.domainAgeDays / 30)} months` : `${Math.round(r.domainAgeDays / 365)} years`]);
      if (r.registrar) facts.push(['Registrar', r.registrar]);
      if (r.certificateIssuer) facts.push(['Certificate', r.certificateIssuer]);
      facts.push(['Redirects', String(r.redirects)]);
      if (r.pageTitle) facts.push(['Page title', r.pageTitle]);
    }
    if (v.file) {
      facts.push(['Type', v.file.type.toUpperCase()]);
      facts.push(['Size', bytes(v.file.size)]);
      facts.push(['SHA-256', `${v.file.sha256.slice(0, 16)}…`]);
    }

    const notes = [];
    if (v.knowledge && v.knowledge.discountApplied) notes.push('No threat source has a record of this site, so Sentinel lowered its risk by 20%.');
    if (v.kind === 'url' && !v.researched) notes.push(v.researchSkipReason || 'Research wasn’t part of this scan. Pro, Max and Ultimate also check registration, certificates, redirects and page content.');
    if (v.comparison && v.comparison.kits.length) notes.push(`Page matches known scam pattern: ${v.comparison.kits.map((k) => k.label).join(', ')}.`);
    if (v.comparison && v.comparison.similarDomains.length) notes.push(`Built like known scam domains: ${v.comparison.similarDomains.slice(0, 3).join(', ')}.`);

    return `<article class="result result--${head.tone}" data-result>
      <header class="result__head">
        <div class="result__glyph" style="--c:${color(head.tone === 'clear' ? null : head.tone)}">${Masks.svg(head.threat)}</div>
        <div class="result__title">
          <h2>${esc(head.title)}</h2>
          <p><span class="mono">${esc(subject)}</span></p>
          ${head.kind ? `<p class="result__kind">${Masks.kindIcon(head.kind)}<span>${esc(head.kindLabel)}</span></p>` : ''}
          <p class="result__sub">${esc(head.sub)}</p>
        </div>
      </header>
      ${threatTiles(v, { lockedLabel })}
      ${v.reasons && v.reasons.length ? `<div class="reasons"><h3>Why</h3><ul>${v.reasons.map((r) => `<li><span class="dot" style="--c:${color(v.threats[r.threat] && v.threats[r.threat].badge)}"></span>${esc(r.text)}</li>`).join('')}</ul></div>` : ''}
      ${facts.length ? `<dl class="facts">${facts.map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${esc(val)}</dd></div>`).join('')}</dl>` : ''}
      ${notes.length ? `<div class="notes">${notes.map((n) => `<p>${esc(n)}</p>`).join('')}</div>` : ''}
      <div class="result__checklist">
        <div class="result__checklist-head"><h3>Checklist</h3><span class="mono muted">${v.checklist.total} checks &middot; ${v.checklist.failed} failed &middot; ${v.checklist.warned} warnings &middot; ${v.checklist.skipped} skipped</span></div>
        <div class="tools" data-check-tools>
          <div class="tools__group" role="group" aria-label="Show">
            <button type="button" class="fchip" data-status-filter="all" aria-pressed="true">All</button>
            <button type="button" class="fchip" data-status-filter="concerns" aria-pressed="false">Concerns</button>
            <button type="button" class="fchip" data-status-filter="pass" aria-pressed="false">Passed</button>
            <button type="button" class="fchip" data-status-filter="skip" aria-pressed="false">Skipped</button>
          </div>
          <div class="tools__group" role="group" aria-label="Threat">
            ${THREATS.map((t) => `<button type="button" class="fchip fchip--${t}" data-threat-filter="${t}" aria-pressed="true">${Masks.svg(t)}${Masks.NAMES[t]}</button>`).join('')}
          </div>
          <label class="tools__search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" placeholder="Find a check" aria-label="Find a check" data-check-search></label>
          <span class="mono muted" data-check-count>${v.checklist.total} of ${v.checklist.total}</span>
          <button type="button" class="btn btn--sm" data-expand>Expand all</button>
        </div>
        ${checklist(v.checklist.items)}
      </div>
    </article>`;
  }

  return { api, ApiError, esc, $, $$, h, ago, until, bytes, toast, busy, verdict, wireVerdict, wireCopy, reportText, headline, threatTiles, color, THREATS, SEV };
})();
