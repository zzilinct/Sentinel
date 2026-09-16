/* Sentinel dashboard: stats, activity, link checking and the AI workspace. */
(() => {
  'use strict';

  const { api, esc, mask, verdictCard, COLORS } = window.Sentinel;

  const MARKS = { chatgpt: 'GPT', claude: 'Cl', gemini: 'Gm', deepseek: 'DS' };
  const state = { user: null, providers: [], active: null, chats: {} };

  /* ---------------------------------------------------------------- boot */

  async function boot() {
    try {
      const { user } = await api('/auth/me');
      state.user = user;
    } catch {
      location.href = '/login?next=' + encodeURIComponent('/app');
      return;
    }
    paintUser();
    detectExtension();
    loadStats();
    loadOverrides();
    loadProviders();
    wire();
  }

  function paintUser() {
    const u = state.user;
    const initials = ((u.firstName || '?')[0] + (u.lastName ? u.lastName[0] : '')).toUpperCase();
    const avatar = document.getElementById('avatarBtn');
    if (u.avatarUrl) {
      avatar.innerHTML = `<img class="avatar" src="${esc(u.avatarUrl)}" alt="" referrerpolicy="no-referrer">`;
      avatar.style.background = 'none';
    } else {
      avatar.textContent = initials;
    }
    document.getElementById('greeting').textContent = `Welcome back, ${u.firstName}`;
    document.getElementById('menuName').textContent = u.name || u.firstName;
    document.getElementById('menuEmail').textContent = u.email;
    document.getElementById('accountNote').textContent =
      `Signed in as ${u.email}${u.googleLinked ? ' (Google)' : ''}.`;
  }

  /* --------------------------------------------------------------- stats */

  async function loadStats() {
    let data;
    try { data = await api('/stats'); } catch { return; }
    const c = data.counts;
    document.getElementById('tFlagged').textContent = data.flagged;
    document.getElementById('tYellow').textContent = c.suspicious;
    document.getElementById('tOrange').textContent = c.likely_scam;
    document.getElementById('tRed').textContent = c.confirmed_scam;

    const list = document.getElementById('recent');
    if (!data.recent.length) return;
    const tones = { suspicious: 'yellow', likely_scam: 'orange', confirmed_scam: 'red' };
    list.innerHTML = data.recent.map((row) => {
      const tone = tones[row.level] || 'green';
      return `<li>
        <span class="list__mask" style="color:${COLORS[tone]}">${mask()}</span>
        <span class="list__host">${esc(row.host)}</span>
        <span class="list__time">${when(row.created_at)}</span>
      </li>`;
    }).join('');
  }

  function when(ts) {
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

  async function loadOverrides() {
    let data;
    try { data = await api('/sites/overrides'); } catch { return; }
    const list = document.getElementById('overrides');
    if (!data.overrides.length) return;
    list.innerHTML = data.overrides.map((row) => `<li>
      <span class="list__host">${esc(row.host)}</span>
      <span class="list__time">${row.action === 'allow' ? 'trusted' : 'blocked'}</span>
      <button class="btn btn--sm" data-clear="${esc(row.host)}">Remove</button>
    </li>`).join('');

    list.querySelectorAll('[data-clear]').forEach((button) => {
      button.onclick = async () => {
        button.disabled = true;
        await api('/sites/override', { method: 'POST', body: { host: button.dataset.clear, action: 'clear' } });
        loadOverrides();
      };
    });
  }

  /** The extension answers a ping if it is installed and paired. */
  function detectExtension() {
    const dot = document.getElementById('extDot');
    const title = document.getElementById('extTitle');
    const note = document.getElementById('extNote');

    const ids = (window.SENTINEL_EXTENSION_IDS || []).filter(Boolean);
    const fail = () => {
      dot.style.background = 'var(--yellow)';
      title.textContent = 'Extension not detected';
      note.innerHTML = 'Sentinel protects your browsing once the extension is installed. <a href="/download">Install it now</a>.';
    };

    if (!ids.length || !window.chrome || !chrome.runtime || !chrome.runtime.sendMessage) { fail(); return; }

    let answered = false;
    for (const id of ids) {
      try {
        chrome.runtime.sendMessage(id, { type: 'sentinel:ping' }, (res) => {
          void chrome.runtime.lastError;
          if (answered || !res) return;
          answered = true;
          dot.style.background = 'var(--green)';
          title.textContent = 'Protection active';
          note.textContent = 'Sentinel is checking search results and pages in this browser.';
        });
      } catch { /* ignore */ }
    }
    setTimeout(() => { if (!answered) fail(); }, 900);
  }

  /* ------------------------------------------------------- link checking */

  function wire() {
    const form = document.getElementById('checkForm');
    const input = document.getElementById('checkUrl');
    const button = document.getElementById('checkBtn');
    const out = document.getElementById('checkResult');

    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const url = input.value.trim();
      if (!url) return;
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span>';
      out.innerHTML = '';
      try {
        const { verdict } = await api('/scan', { method: 'POST', body: { url, fresh: true } });
        out.innerHTML = verdictCard(verdict) + reportRow(verdict);
        const report = out.querySelector('[data-report]');
        if (report) report.onclick = async () => {
          report.disabled = true;
          try {
            await api('/report', { method: 'POST', body: { url: verdict.url, category: 'phishing' } });
            report.textContent = 'Reported ✓';
            loadStats();
          } catch (err) { report.textContent = err.message; }
        };
      } catch (err) {
        out.innerHTML = `<div class="form-note form-note--error" style="margin-top:18px">${esc(err.message)}</div>`;
      } finally {
        button.disabled = false;
        button.textContent = 'Check';
      }
    };

    const avatarBtn = document.getElementById('avatarBtn');
    const menuPanel = document.getElementById('menuPanel');
    avatarBtn.onclick = () => {
      const open = menuPanel.hidden;
      menuPanel.hidden = !open;
      avatarBtn.setAttribute('aria-expanded', String(open));
    };
    document.addEventListener('click', (ev) => {
      if (!menuPanel.hidden && !ev.target.closest('.menu')) {
        menuPanel.hidden = true;
        avatarBtn.setAttribute('aria-expanded', 'false');
      }
    });

    document.getElementById('signOut').onclick = async () => {
      await api('/auth/logout', { method: 'POST' }).catch(() => {});
      location.href = '/';
    };

    document.getElementById('openWorkspace').onclick = openWorkspace;
    document.getElementById('openWorkspace2').onclick = openWorkspace;
    document.getElementById('wsClose').onclick = closeWorkspace;
    document.getElementById('overlay').addEventListener('click', (ev) => {
      if (ev.target.id === 'overlay') closeWorkspace();
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !document.getElementById('overlay').hidden) closeWorkspace();
    });
  }

  function reportRow(verdict) {
    if (!verdict.badge) return '';
    return `<div style="margin-top:14px"><button class="btn btn--sm" data-report>Report this as a scam</button></div>`;
  }

  /* ------------------------------------------------------- AI workspace */

  async function loadProviders() {
    try {
      const data = await api('/ai/providers');
      state.providers = data.providers;
      renderTabs();
    } catch { /* shown when the overlay opens */ }
  }

  function openWorkspace() {
    document.getElementById('overlay').hidden = false;
    document.body.style.overflow = 'hidden';
    if (!state.providers.length) loadProviders();
    else if (!state.active) selectTab(state.providers[0].id);
  }

  function closeWorkspace() {
    document.getElementById('overlay').hidden = true;
    document.body.style.overflow = '';
  }

  function renderTabs() {
    const tabs = document.getElementById('tabs');
    const panes = document.getElementById('panes');

    tabs.innerHTML = state.providers.map((p) => `
      <button class="tab" role="tab" id="tab-${p.id}" data-tab="${p.id}"
              aria-selected="false" aria-controls="pane-${p.id}" style="--accent:${p.accent}">
        <span class="tab__mark">${MARKS[p.id] || p.name[0]}</span>
        ${esc(p.name)}
        <span class="tab__status${p.connected ? ' tab__status--on' : ''}" title="${p.connected ? 'Connected' : 'Not connected'}"></span>
      </button>`).join('');

    panes.innerHTML = state.providers.map((p) => `
      <div class="pane" id="pane-${p.id}" role="tabpanel" aria-labelledby="tab-${p.id}" style="--accent:${p.accent}"></div>`).join('');

    tabs.querySelectorAll('[data-tab]').forEach((button) => {
      button.onclick = () => selectTab(button.dataset.tab);
    });

    selectTab(state.active || state.providers[0].id);
  }

  function selectTab(id) {
    state.active = id;
    document.querySelectorAll('[data-tab]').forEach((t) => {
      t.setAttribute('aria-selected', String(t.dataset.tab === id));
    });
    document.querySelectorAll('.pane').forEach((p) => {
      p.dataset.active = String(p.id === `pane-${id}`);
    });
    renderPane(id);
  }

  function provider(id) {
    return state.providers.find((p) => p.id === id);
  }

  function renderPane(id) {
    const p = provider(id);
    const pane = document.getElementById(`pane-${id}`);
    if (!p || !pane) return;
    if (p.connected) renderChat(p, pane);
    else renderConnect(p, pane);
  }

  /** The per-provider sign-in view. */
  function renderConnect(p, pane) {
    pane.innerHTML = `
      <div class="connect">
        <div class="connect__brand">
          <span class="connect__mark">${MARKS[p.id] || p.name[0]}</span>
          <div>
            <h3>Sign in to ${esc(p.name)}</h3>
            <span>Connect your own ${esc(p.vendor)} account &middot; model <code>${esc(p.model)}</code></span>
          </div>
        </div>

        <p class="muted" style="max-width:62ch">
          Sentinel talks to ${esc(p.name)} through ${esc(p.vendor)}'s official API using a key
          from your own account, so your conversations stay on your ${esc(p.vendor)} plan.
        </p>

        <div class="connect__steps">
          <div class="connect__step"><span>Open <a href="${esc(p.keyUrl)}" target="_blank" rel="noopener noreferrer">${esc(new URL(p.keyUrl).host)}</a> and sign in to ${esc(p.vendor)} there.</span></div>
          <div class="connect__step"><span>Create an API key and copy it.</span></div>
          <div class="connect__step"><span>Paste it below. Sentinel verifies it with ${esc(p.vendor)} and stores it encrypted.</span></div>
        </div>

        <form class="connect__row" data-connect="${p.id}">
          <input type="password" name="apiKey" placeholder="Paste your ${esc(p.vendor)} API key" autocomplete="off" spellcheck="false" required>
          <button class="btn btn--gold" type="submit">Connect</button>
          <a class="btn btn--ghost" href="${esc(p.consoleUrl)}" target="_blank" rel="noopener noreferrer">Open ${esc(p.name)}</a>
        </form>
        <div data-connect-error style="margin-top:14px"></div>

        <div class="safety">
          <b>Sentinel never asks for your ${esc(p.vendor)} password.</b>
          A product that renders another company's login form is exactly the pattern
          Sentinel warns you about, so we use API keys instead. Revoke the key from
          your ${esc(p.vendor)} account at any time and this tab stops working
          immediately.
        </div>
      </div>`;

    const form = pane.querySelector('[data-connect]');
    const errorSlot = pane.querySelector('[data-connect-error]');
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const button = form.querySelector('button[type=submit]');
      const apiKey = form.apiKey.value.trim();
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span>Verifying';
      errorSlot.innerHTML = '';
      try {
        const data = await api('/ai/connect', { method: 'POST', body: { provider: p.id, apiKey } });
        Object.assign(p, data.provider);
        renderTabs();
      } catch (err) {
        errorSlot.innerHTML = `<div class="form-note form-note--error">${esc(err.message)}</div>`;
        button.disabled = false;
        button.textContent = 'Connect';
      }
    };
  }

  function renderChat(p, pane) {
    const history = state.chats[p.id] || (state.chats[p.id] = []);
    pane.innerHTML = `
      <div class="chat">
        <div class="chat__meta">
          <span>Connected to ${esc(p.vendor)} &middot; <code>${esc(p.model)}</code> &middot; key ${esc(p.label || '')}</span>
          <button data-disconnect>Disconnect</button>
        </div>
        <div class="chat__log" data-log></div>
        <form class="chat__composer" data-send>
          <textarea name="message" rows="1" placeholder="Ask ${esc(p.name)} anything - try pasting a link you are unsure about" required></textarea>
          <button class="btn btn--gold" type="submit">Send</button>
        </form>
      </div>`;

    const log = pane.querySelector('[data-log]');
    const form = pane.querySelector('[data-send]');
    const textarea = form.querySelector('textarea');

    const paint = () => {
      log.innerHTML = history.length
        ? history.map((m) => bubble(p, m)).join('')
        : `<p class="muted small" style="margin:0">Nothing here yet. Ask ${esc(p.name)} a question to start.</p>`;
      log.scrollTop = log.scrollHeight;
    };
    paint();

    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(160, textarea.scrollHeight) + 'px';
    });
    textarea.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); form.requestSubmit(); }
    });

    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const content = textarea.value.trim();
      if (!content) return;

      history.push({ role: 'user', content });
      textarea.value = '';
      textarea.style.height = 'auto';
      paint();

      log.insertAdjacentHTML('beforeend', `<div class="msg msg--ai" data-pending>
        <span class="msg__who">${MARKS[p.id] || p.name[0]}</span>
        <span class="msg__body"><span class="typing"><i></i><i></i><i></i></span></span></div>`);
      log.scrollTop = log.scrollHeight;

      try {
        const data = await api('/ai/chat', {
          method: 'POST',
          body: { provider: p.id, messages: history.slice(-20) }
        });
        history.push({ role: 'assistant', content: data.reply });
      } catch (err) {
        history.push({ role: 'assistant', content: err.message, error: true });
        if (err.code === 'provider_unauthorized') {
          p.connected = false;
          renderTabs();
          return;
        }
      }
      paint();
    };

    pane.querySelector('[data-disconnect]').onclick = async () => {
      await api('/ai/disconnect', { method: 'POST', body: { provider: p.id } }).catch(() => {});
      p.connected = false;
      state.chats[p.id] = [];
      renderTabs();
    };
  }

  function bubble(p, m) {
    const isUser = m.role === 'user';
    const who = isUser ? (state.user.firstName || 'You')[0].toUpperCase() : (MARKS[p.id] || p.name[0]);
    return `<div class="msg msg--${isUser ? 'user' : 'ai'}${m.error ? ' msg--error' : ''}">
      <span class="msg__who">${esc(who)}</span>
      <span class="msg__body">${esc(m.content)}</span>
    </div>`;
  }

  boot();
})();
