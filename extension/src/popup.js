/* Sentinel Companion popup. */
(() => {
  'use strict';
  const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;

  const Masks = window.SentinelMasks;
  const view = document.getElementById('view');
  const planEl = document.getElementById('plan');
  const THREATS = ['scam', 'virus', 'malware'];
  const LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const send = (message) => new Promise((resolve) => { try { Promise.resolve(ext.runtime.sendMessage(message)).then((res) => resolve(res || { ok: false }), () => resolve({ ok: false, error: 'Sentinel is starting up' })); } catch { resolve({ ok: false, error: 'Sentinel is starting up' }); } });

  document.getElementById('settings').onclick = () => ext.runtime.openOptionsPage();

  let state;

  async function main() {
    state = await send({ type: 'state' });
    const site = (state.settings && state.settings.apiBase) || '';
    document.getElementById('openApp').href = `${site}/app`;

    if (!state.ok || !state.account || !state.account.signedIn) {
      const connected = await send({ type: 'connect' });
      if (connected.ok && connected.account && connected.account.signedIn) return main();
      return signedOut(site);
    }

    const plan = state.account.plan;
    planEl.hidden = false;
    planEl.textContent = plan.name;

    if (state.siteAccess === false) {
      view.innerHTML = `
        <div class="card">
          <div class="label">One more step</div>
          <p style="margin:0 0 12px;color:#c4c8ce">Firefox asks before an add-on can see the pages you visit. Sentinel needs that to add masks to search results and warn you before a dangerous page loads.</p>
          <button class="btn gold block" id="grant">Allow Sentinel on all websites</button>
        </div>`;
      document.getElementById('grant').onclick = async () => {
        let ok = false;
        try { ok = await ext.permissions.request({ origins: ['<all_urls>'] }); } catch { ok = false; }
        if (ok) main();
      };
      return;
    }

    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    const url = tab && tab.url && /^https?:/i.test(tab.url) ? tab.url : null;

    view.innerHTML = `${pageCard(url)}${liveCard(site)}`;
    wire(url);
  }

  function signedOut(site) {
    view.innerHTML = `
      <div class="card">
        <div class="label">Welcome</div>
        <p style="margin:0 0 12px;color:#c4c8ce">Sign in to Sentinel to turn on live scam, virus and malware protection in this browser.</p>
        <div class="actions">
          <a class="btn gold" href="${esc(site)}/connect" target="_blank" rel="noopener">Sign in</a>
          <a class="btn" href="${esc(site)}/signup?next=/connect" target="_blank" rel="noopener">Create account</a>
        </div>
      </div>
      <p class="small" style="text-align:center;margin:4px 0 0">Signed in on the website? <a href="#" id="recheck" style="color:var(--gold)">Check again</a></p>`;
    document.getElementById('recheck').onclick = async (ev) => { ev.preventDefault(); await send({ type: 'connect' }); main(); };
  }

  function pageCard(url) {
    if (!url) {
      return `<div class="card"><div class="label">This page</div><p class="small" style="margin:0">Open a website to scan it.</p></div>`;
    }
    const left = state.account.usage.linkScans.limit - state.account.usage.linkScans.used;
    return `
      <div class="card" id="pageCard">
        <div class="label">This page</div>
        <div class="host">${esc(new URL(url).hostname)}</div>
        <div id="result"></div>
        <button class="btn gold block" id="scan" ${left <= 0 ? 'disabled' : ''}>
          ${left <= 0 ? 'No scans left this week' : `Scan this page &middot; ${left} left this week`}
        </button>
      </div>`;
  }

  function renderResult(v) {
    const researched = v.researched ? 'Researched' : 'Checklist scan';
    return `
      <div class="threats">${THREATS.map((t) => {
        const th = v.threats[t];
        if (!th) return `<div class="threat locked">${Masks.svg(t, 'style="color:#555"')}<b>${Masks.NAMES[t]}</b><span>Pro &amp; up</span></div>`;
        const color = th.badge ? Masks.COLORS[th.badge] : Masks.COLORS.clear;
        return `<div class="threat" style="color:${color}">${Masks.svg(t)}<b>${esc(th.badge ? th.label : 'Clear')}</b><span>${th.kindShort ? `${esc(th.kindShort)} · ` : ''}${th.score}/100</span></div>`;
      }).join('')}</div>
      <ul class="reasons">${(v.reasons || []).slice(0, 3).map((r) => `<li>${esc(r.text)}</li>`).join('') || '<li>No warning signs found</li>'}</ul>
      <p class="small" style="margin:10px 0 12px">${researched} &middot; ${v.checklist.total} checks</p>`;
  }

  /** "1.5 of 4 hours" or "12 of 15 minutes": short allowances read better in minutes. */
  function timeLeftText(used, limit) {
    if (limit === null) return 'No weekly limit';
    if (limit < 60) return `${Math.max(0, limit - used)} of ${limit} minutes left`;
    const hoursLeft = Math.max(0, (limit - used) / 60);
    return `${hoursLeft.toFixed(hoursLeft < 10 ? 1 : 0)} of ${limit / 60} hours left`;
  }

  function liveCard(site) {
    const f = state.account.plan.features;
    if (!f.liveScanning && !f.liveFast) {
      return `
        <div class="card">
          <div class="label">Live protection</div>
          <div class="lock">${LOCK}<div>
            <p>Live masks on search results come with every plan: <b>15 minutes</b> a week on Free, <b>24 hours</b> on Pro and no limit from Max. Delicate scanning, which researches each result, starts at Pro.</p>
            <a class="btn gold" href="${esc(site)}/pricing" target="_blank" rel="noopener">See plans</a>
          </div></div>
        </div>`;
    }
    // Plans with delicate scanning show its allowance; Free shows its fast minutes.
    const limits = state.account.plan.limits;
    const used = (f.liveScanning ? state.live.usedMinutes : state.live.fastUsedMinutes) || 0;
    const known = f.liveScanning ? state.live.limitMinutes : state.live.fastLimitMinutes;
    const limit = known !== undefined && known !== 0 ? known : (f.liveScanning ? limits.liveMinutes : limits.fastMinutes);
    const paused = state.locked === 'hours';
    const reset = new Date(state.live.resetsAt || state.account.week.resetsAt);
    return `
      <div class="card">
        <div class="row"><div class="label" style="margin:0">Live protection</div>
          <span class="small" style="color:${paused ? 'var(--orange)' : 'var(--green)'}">${paused ? 'Paused' : state.settings.enabled ? 'On' : 'Off'}</span></div>
        <div class="meter"><i style="--p:${limit ? Math.min(100, (used / limit) * 100) : 0}"></i></div>
        <div class="row small">
          <span>${f.liveScanning ? 'Delicate: ' : ''}${timeLeftText(used, limit)}</span>
          <span>Resets ${reset.toLocaleDateString(undefined, { weekday: 'short' })}</span>
        </div>
        <p class="small" style="margin:8px 0 0">${f.liveResearch ? 'Delicate scanning researches every result.' : 'Results are checked instantly. Delicate scanning, which researches each result, comes with Pro.'}${f.emailLive && state.settings.emailProtection ? ' Email protection is on.' : ''}</p>
      </div>`;
  }

  function wire(url) {
    const btn = document.getElementById('scan');
    if (!btn) return;
    btn.onclick = async () => {
      btn.disabled = true;
      btn.innerHTML = '<span class="spin" style="width:14px;height:14px"></span> Scanning';
      const res = await send({ type: 'deep-scan', url });
      if (!res.ok) {
        btn.textContent = res.error || 'Scan failed';
        return;
      }
      document.getElementById('result').innerHTML = renderResult(res.verdict);
      const left = res.usage.linkScans.limit - res.usage.linkScans.used;
      btn.textContent = `${left} scan${left === 1 ? '' : 's'} left this week`;
    };
  }

  main();
})();
