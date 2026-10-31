/* Sentinel Companion popup: the answer about this page first, in the words the block page uses (lib/say.js). */
(() => {
  'use strict';
  const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;

  const Say = globalThis.SentinelSay;
  const view = document.getElementById('view');
  const planEl = document.getElementById('plan');

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const send = (message) => new Promise((resolve) => { try { Promise.resolve(ext.runtime.sendMessage(message)).then((res) => resolve(res || { ok: false }), () => resolve({ ok: false, error: 'Sentinel is starting up' })); } catch { resolve({ ok: false, error: 'Sentinel is starting up' }); } });

  document.getElementById('settings').onclick = () => ext.runtime.openOptionsPage();

  /** One line on the password alarm, with a link to its setting: what it protects, or that nothing is chosen yet. */
  async function pwLine() {
    const el = document.getElementById('pwLine');
    let accounts = [];
    try { const { pwalarm } = await ext.storage.local.get('pwalarm'); accounts = Object.values((pwalarm && pwalarm.accounts) || {}).filter((a) => a.on); } catch { /* storage unreadable */ }
    const learned = (a) => (Array.isArray(a.hashes) ? a.hashes.length > 0 : Boolean(a.hash));
    const names = (list) => list.map((a) => esc(a.name)).join(', ');
    const done = accounts.filter(learned);
    const waiting = accounts.filter((a) => !learned(a));
    el.innerHTML = !accounts.length ? 'Password alarm is off. <a href="#" class="link" id="pwLink">Choose accounts to protect</a>'
      : `${done.length ? `Password alarm protects your ${names(done)} password${done.length > 1 ? 's' : ''}.` : 'Password alarm:'}${waiting.length ? ` ${done.length ? 'Sign' : 'sign'} in to ${names(waiting)} once to protect ${waiting.length > 1 ? 'them' : 'it'}.` : ''} <a href="#" class="link" id="pwLink">Password alarm settings</a>`;
    el.hidden = false;
    document.getElementById('pwLink').onclick = (ev) => { ev.preventDefault(); ext.tabs.create({ url: ext.runtime.getURL('src/options.html#pw') }); window.close(); };
  }
  pwLine();

  let state;
  let tab;
  let url;      // the address this popup is about; on the block page, the address it stopped
  let site;

  /** "1.5 of 4 hours" or "12 of 15 minutes": short allowances read better in minutes. */
  function timeLeftText(used, limit) {
    if (limit === null) return 'No weekly limit';
    if (limit < 60) return `${Math.max(0, limit - used)} of ${limit} minutes left`;
    const hoursLeft = Math.max(0, (limit - used) / 60);
    return `${hoursLeft.toFixed(hoursLeft < 10 ? 1 : 0)} of ${limit / 60} hours left`;
  }

  /** One quiet line under the answer: is live protection on, how much time is left, and why not when it is not. */
  function statusLine() {
    const f = state.account.plan.features;
    if (!f.liveScanning && !f.liveFast) {
      return `<p class="status small" data-live="Off">Live scanning is not in this plan. <a class="link" href="${esc(site)}/pricing" target="_blank" rel="noopener">See plans</a></p>`;
    }
    const said = Say.protection(state);
    // Plans with delicate scanning show its allowance; Free shows its fast minutes.
    const limits = state.account.plan.limits;
    const used = (f.liveScanning ? state.live.usedMinutes : state.live.fastUsedMinutes) || 0;
    const known = f.liveScanning ? state.live.limitMinutes : state.live.fastLimitMinutes;
    const limit = known !== undefined && known !== 0 ? known : (f.liveScanning ? limits.liveMinutes : limits.fastMinutes);
    const time = said.word === 'On' ? `<span>${timeLeftText(used, limit)}</span>` : '';
    return `<p class="status small" data-live="${said.word}"><b data-tone="${said.tone}">Live protection ${said.word.toLowerCase()}</b>${time}</p>${said.word === 'On' ? '' : `<p class="status-why small">${esc(said.line)}</p>`}`;
  }

  /** The one answer, in the shape every state shares. */
  function hero(said, host) {
    return `
      <section class="answer" data-tone="${said.tone}">
        <img class="answer-mask" src="masks/${said.mask}.webp" alt="" width="68" height="100">
        <div class="answer-words">
          <h1 id="title">${esc(said.title)}</h1>
          ${host ? `<div class="host">${esc(host)}</div>` : ''}
          <p class="answer-line" data-page-state>${esc(said.line)}</p>
          ${said.reason ? `<p class="answer-reason">${esc(said.reason)}</p>` : ''}
        </div>
      </section>`;
  }

  /** What live scanning already said about this page: the worker's answer, or, if it has been stopped since, the title it left on the tab. Nothing is scanned for this. */
  async function lastVerdict() {
    const res = await send({ type: 'page-verdict', url });
    if (res.ok && res.verdict) return res.verdict;
    try {
      const title = String(await ext.action.getTitle({ tabId: tab.id }));
      const text = await ext.action.getBadgeText({ tabId: tab.id });
      if (text) return { overall: { badge: text === '!' ? 'red' : 'orange', label: title.replace(/^Sentinel:\s*/, '') } };
      if (/^Sentinel: /.test(title)) return { overall: { badge: null } };
    } catch { /* the tab is gone */ }
    return null;
  }

  function render(verdict, note = '') {
    const blocked = tab.url !== url;
    const said = Say.page(verdict, { stopped: blocked, off: !state.settings.enabled, paused: state.locked === 'hours' || Boolean(state.account.plan.modelLocked) });
    const left = state.account.usage.linkScans.limit - state.account.usage.linkScans.used;
    const checkButton = said.action.kind === 'check';
    const main = checkButton ? '' : `<button class="btn gold block" id="act" type="button">${esc(said.action.text)}</button>`;
    const check = left <= 0
      ? '<p class="small note">No page checks left this week.</p>'
      : `<button class="btn ${checkButton ? 'block' : 'block quiet'}" id="check" type="button">${esc(checkButton ? said.action.text : 'Check again')}</button>`;
    view.innerHTML = `${hero(said, new URL(url).hostname)}<div class="do">${main}${blocked ? '' : check}</div><div id="note">${note}</div>${statusLine()}`;
    wire(said);
  }

  function wire(said) {
    const act = document.getElementById('act');
    if (act) act.onclick = async () => {
      act.disabled = true;
      if (said.action.kind === 'real') await send({ type: 'real-site', url, tabId: tab.id });
      else await Promise.resolve(ext.tabs.goBack(tab.id)).catch(() => {});
      window.close();
    };
    const btn = document.getElementById('check');
    if (!btn) return;
    btn.onclick = async () => {
      btn.disabled = true;
      btn.innerHTML = '<span class="spin" style="width:14px;height:14px"></span> Checking';
      const res = await send({ type: 'deep-scan', url });
      if (!res.ok) {
        // Said beside the button, which goes back to how it was: a sentence crammed into a dead button could not be read or retried.
        render(shown, `<p class="small note scan-error" role="alert">${esc(res.error || 'Sentinel could not check this page. Try again in a moment.')}</p>`);
        return;
      }
      state.account.usage = res.usage;
      shown = res.verdict;
      const left = res.usage.linkScans.limit - res.usage.linkScans.used;
      render(shown, `<p class="small note">${(res.verdict.checklist || {}).total || 'All the'} checks done. ${left} page check${left === 1 ? '' : 's'} left this week.</p>`);
    };
  }
  let shown = null;

  async function main() {
    state = await send({ type: 'state' });
    site = (state.settings && state.settings.apiBase) || '';
    document.getElementById('openApp').href = `${site}/app`;

    if (!state.ok || !state.account || !state.account.signedIn) {
      const connected = await send({ type: 'connect' });
      if (connected.ok && connected.account && connected.account.signedIn) return main();
      return signedOut();
    }

    planEl.hidden = false;
    planEl.textContent = state.account.plan.name;

    if (state.siteAccess === false) {
      view.innerHTML = `
        ${hero({ tone: 'none', mask: 'onyx', title: 'One more step', line: 'Firefox asks before an add-on can see the pages you visit. Sentinel needs that to add masks to search results and stop dangerous pages.', reason: '' })}
        <div class="do"><button class="btn gold block" id="grant" type="button">Allow Sentinel on all websites</button></div>`;
      document.getElementById('grant').onclick = async () => {
        let ok = false;
        try { ok = await ext.permissions.request({ origins: ['<all_urls>'] }); } catch { ok = false; }
        if (ok) main();
      };
      return;
    }

    [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    const at = tab && tab.url ? tab.url : '';
    const stoppedHere = at.startsWith(ext.runtime.getURL('src/block.html')) ? at.slice(at.indexOf('#') + 1) : '';
    url = /^https?:/i.test(stoppedHere || at) ? (stoppedHere || at) : null;
    if (!url) {
      view.innerHTML = `${hero({ tone: 'none', mask: 'onyx', title: 'Nothing to check here', line: 'Open a website and Sentinel will say what it found.', reason: '' })}${statusLine()}`;
      return;
    }
    shown = await lastVerdict();
    render(shown);
  }

  function signedOut() {
    view.innerHTML = `
      ${hero({ tone: 'none', mask: 'onyx', title: 'Welcome', line: 'Sign in to Sentinel to check pages in this browser and stop dangerous ones before they load.', reason: '' })}
      <div class="do do-row">
        <a class="btn gold" href="${esc(site)}/connect" target="_blank" rel="noopener">Sign in</a>
        <a class="btn" href="${esc(site)}/signup?next=/connect" target="_blank" rel="noopener">Create account</a>
      </div>
      <p class="small note">Signed in on the website? <a href="#" class="link" id="recheck">Check again</a></p>`;
    document.getElementById('recheck').onclick = async (ev) => { ev.preventDefault(); await send({ type: 'connect' }); main(); };
  }

  main();
})();
