/* Sentinel Companion popup. */
(() => {
  'use strict';

  const Masks = window.SentinelMasks;
  const view = document.getElementById('view');
  const planEl = document.getElementById('plan');
  const THREATS = ['scam', 'virus', 'malware'];
  const LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const send = (message) => new Promise((resolve) => chrome.runtime.sendMessage(message, (res) => resolve(chrome.runtime.lastError ? { ok: false, error: 'Sentinel is starting up' } : (res || { ok: false }))));

  document.getElementById('settings').onclick = () => chrome.runtime.openOptionsPage();

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

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
        if (!th) return `<div class="threat locked">${Masks.svg(t, 'style="color:#555"')}<b>${Masks.NAMES[t]}</b><span>Pro &amp; Max</span></div>`;
        const color = th.badge ? Masks.COLORS[th.badge] : Masks.COLORS.clear;
        return `<div class="threat" style="color:${color}">${Masks.svg(t)}<b>${esc(th.badge ? th.label : 'Clear')}</b><span>${th.score}/100</span></div>`;
      }).join('')}</div>
      <ul class="reasons">${(v.reasons || []).slice(0, 3).map((r) => `<li>${esc(r.text)}</li>`).join('') || '<li>No warning signs found</li>'}</ul>
      <p class="small" style="margin:10px 0 12px">${researched} &middot; ${v.checklist.total} checks</p>`;
  }

  function liveCard(site) {
    const f = state.account.plan.features;
    if (!f.liveScanning) {
      return `
        <div class="card">
          <div class="label">Live protection</div>
          <div class="lock">${LOCK}<div>
            <p>Masks on every search result and email come with <b>Pro</b> (24 hours a week) and <b>Max</b> (96 hours, with research).</p>
            <a class="btn gold" href="${esc(site)}/pricing" target="_blank" rel="noopener">See plans</a>
          </div></div>
        </div>`;
    }
    const used = state.live.usedMinutes || 0;
    const limit = state.live.limitMinutes || state.account.plan.limits.liveMinutes;
    const hoursLeft = Math.max(0, (limit - used) / 60);
    const paused = state.locked === 'hours';
    const reset = new Date(state.live.resetsAt || state.account.week.resetsAt);
    return `
      <div class="card">
        <div class="row"><div class="label" style="margin:0">Live protection</div>
          <span class="small" style="color:${paused ? 'var(--orange)' : 'var(--green)'}">${paused ? 'Paused' : state.settings.enabled ? 'On' : 'Off'}</span></div>
        <div class="meter"><i style="width:${Math.min(100, (used / limit) * 100)}%"></i></div>
        <div class="row small">
          <span>${hoursLeft.toFixed(hoursLeft < 10 ? 1 : 0)} of ${limit / 60} hours left</span>
          <span>Resets ${reset.toLocaleDateString(undefined, { weekday: 'short' })}</span>
        </div>
        <p class="small" style="margin:8px 0 0">${f.liveResearch ? 'Every result is researched.' : 'Results are checked instantly; research is included with Max.'}${f.emailLive && state.settings.emailProtection ? ' Email protection is on.' : ''}</p>
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
