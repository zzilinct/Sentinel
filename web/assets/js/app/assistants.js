/* Sentinel web app: AI assistants (/app/assistants). app.js fetches this file the first time the page opens. */
(() => {
  'use strict';

  const { api, esc, $, $$, toast, busy } = window.UI;
  const {
    state, ICON, navigate, render, failed, skel, keep, title
  } = window.SentinelApp;

  /* ========================================================== assistants */

  const MARKS = { chatgpt: 'GPT', claude: 'Cl', gemini: 'Gm', deepseek: 'DS' };
  const chats = {};

  // The first tab, unconnected, as a new account first sees it (server/routes/ai.routes.js): the first wait's shape.
  const FIRST_ASSISTANT = { id: 'chatgpt', name: 'ChatGPT', vendor: 'OpenAI', model: 'gpt-4o-mini', keyUrl: 'https://platform.openai.com/api-keys', accent: '' };

  async function assistantsView(el, params) {
    el.innerHTML = `${title('AI assistants', 'Optional. Ask ChatGPT, Claude, Gemini or DeepSeek about anything. Sentinel\'s scans never depend on them.')}
      <div data-tabs><div class="skeleton skeleton--tabs"></div></div><div class="panel" data-pane id="ai-pane" role="tabpanel">${skel('assistants', connectHTML(FIRST_ASSISTANT))}</div>`;
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
    pane.innerHTML = connectHTML(p);
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

  function connectHTML(p) {
    return `
      <div class="connect-head"><span class="ai-tab__mark ai-tab__mark--lg" style="--accent:${esc(p.accent)}">${MARKS[p.id]}</span>
        <div><h2>Connect ${esc(p.name)}</h2><p class="note">Uses ${esc(p.vendor)}'s official API with a key from your own account &middot; <span class="mono">${esc(p.model)}</span></p></div></div>
      <ol class="steps-list">
        <li>Open <a href="${esc(p.keyUrl)}" target="_blank" rel="noopener noreferrer" class="u-gold">${esc(new URL(p.keyUrl).host)}</a> and sign in to ${esc(p.vendor)} there.</li>
        <li>Create an API key and copy it.</li>
        <li>Paste it below. Sentinel checks it with ${esc(p.vendor)} and stores it encrypted.</li>
      </ol>
      <form class="scanbox" data-connect data-no-draft>${ICON.lock}<input name="apiKey" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your ${esc(p.vendor)} API key" aria-label="${esc(p.vendor)} API key" data-no-draft required><button class="btn btn--gold" type="submit">Connect</button></form>
      <p class="note u-mt">Sentinel never asks for your ${esc(p.vendor)} password. A login form for another company inside our app is exactly what we warn you about.</p>`;
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

  Object.assign(window.SentinelApp.pages, { assistantsView });
})();
