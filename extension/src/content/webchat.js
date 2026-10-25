/**
 * Sentinel Companion - web chats.
 *
 * In Discord in the browser, WhatsApp Web, Messenger (messenger.com and facebook.com/messages), Telegram Web and X
 * direct messages, a link in a message gets the same small mask Sentinel puts beside search results, judged by the
 * same fast check, and is never opened. A message that asks for a code, gift cards, crypto or a "verify your account"
 * step gets a quiet hint under it, from chat safety's own rules (chat.js, loaded just before this: the Windows app's
 * copy). Messages are read in this page only: their words never leave it and are not kept or logged. Only the links'
 * addresses go to the fast check, as a search result's do, and only while this tab is the one being looked at.
 */
(() => {
  'use strict';
  const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;
  if (window.__sentinelWebChat) return;
  window.__sentinelWebChat = true;

  const Masks = (globalThis.SentinelMasks || window.SentinelMasks);
  const Chat = globalThis.SentinelChat;
  const RANK = { yellow: 1, orange: 2, red: 3 };
  const THREATS = ['scam', 'virus', 'malware'];
  const DEFAULTS = { enabled: true, minimumBadge: 'yellow' };

  // Each chat site: which pages are chats, what one message is, its words, who sent it, the person's own messages
  // (never judged: they are not the ones asking), and the site's own links (never checked).
  const META = { message: '[role="row"]', text: '[dir="auto"]', own: /(^|\.)(messenger|facebook|fbcdn|fb)\.(com|net|me)$/ };
  const SITES = [
    { host: /^(ptb\.|canary\.)?discord\.com$/, path: /^\/channels\//, message: 'li[id^="chat-messages-"]', text: '[id^="message-content-"]', who: '[id^="message-username-"]', own: /(^|\.)discord(app)?\.(com|gg)$/ },
    { host: /^web\.whatsapp\.com$/, message: '.message-in, .message-out', out: '.message-out', text: '.selectable-text', whoAttr: 'data-pre-plain-text', own: /(^|\.)whatsapp\.(com|net)$/ },
    { host: /^www\.messenger\.com$/, path: /^\/(e2ee\/)?t\//, ...META },
    { host: /^www\.facebook\.com$/, path: /^\/messages\//, ...META },
    { host: /^web\.telegram\.org$/, message: '.bubble, .Message', out: '.is-out, .own', text: '.message, .text-content', own: /(^|\.)(telegram\.org|t\.me)$/ },
    { host: /^(x|twitter)\.com$/, path: /^\/(messages|i\/chat)\b/, message: '[data-testid="messageEntry"]', text: '[data-testid="tweetText"], [dir="auto"]', own: /(^|\.)(x|twitter)\.com$/ }
  ];
  const site = SITES.find((s) => s.host.test(location.hostname));
  if (!site || !Masks || !Chat) return;

  /* ------------------------------------------------------------- urls */

  // Where a link in a message leads: Messenger wraps links in l.facebook.com/l.php, X shortens them to t.co and
  // shows the real address as the link's words.
  function realUrl(href, words, base) {
    let u;
    try { u = new URL(href, base); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    let inner = null;
    if (/^l\.(facebook|messenger)\.com$/.test(u.hostname) && u.pathname === '/l.php') inner = u.searchParams.get('u');
    else if (u.hostname === 't.co') {
      const t = String(words || '').trim().replace(/(…|\.\.\.)$/, '');
      if (/^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,63}(\/\S*)?$/i.test(t)) inner = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    }
    if (inner) {
      try { const t = new URL(inner); if (/^https?:$/.test(t.protocol)) return t.href; } catch { /* keep the wrapper */ }
    }
    return u.href;
  }

  /* ------------------------------------------------------------ masks */

  let settings = DEFAULTS;
  const byUrl = new Map();                  // url -> [anchor]
  const verdicts = new Map();               // url -> verdict, so a message drawn again gets its mask again
  const requested = new Set();
  let queue = [];

  function mark(a, verdict) {
    if (!a.isConnected || !verdict || !verdict.ok) return;
    const next = a.nextElementSibling;
    if (next && next.classList.contains('sentinel-masks')) return;
    const shown = THREATS.filter((t) => verdict.threats[t] && verdict.threats[t].badge && RANK[verdict.threats[t].badge] >= RANK[settings.minimumBadge || 'yellow']);
    if (!shown.length) return;
    const group = document.createElement('span');
    group.className = 'sentinel-masks sentinel-masks--chat';
    group.setAttribute('role', 'img');
    const label = `Sentinel: ${shown.map((t) => verdict.threats[t].label).join(', ')}`;
    group.setAttribute('aria-label', label);
    group.title = `${label}\n${(verdict.reasons || []).slice(0, 3).map((r) => '- ' + r.text).join('\n')}`;
    for (const t of shown) {
      const m = document.createElement('span');
      m.className = `sentinel-mask sentinel-mask--${verdict.threats[t].badge}`;
      m.innerHTML = Masks.svg(t);
      group.appendChild(m);
    }
    a.after(group);
  }

  // Live hours are only spent while this tab is the one being looked at.
  const inUse = () => document.visibilityState === 'visible' && document.hasFocus();

  function send(message) {
    return new Promise((resolve) => {
      try {
        Promise.resolve(ext.runtime.sendMessage(message)).then((res) => resolve(res || { ok: false }), () => resolve({ ok: false }));
      } catch { resolve({ ok: false }); }
    });
  }

  let busy = false;
  let linksOff = false;
  async function flush() {
    if (busy || linksOff || !queue.length || !inUse() || !settings.enabled) return;
    busy = true;
    const urls = queue.splice(0, 30);
    try {
      const res = await send({ type: 'live-batch', urls, phase: 'quick' });
      if (res.locked) { linksOff = res.locked !== 'hours'; queue = []; return; }
      for (const [url, verdict] of Object.entries(res.verdicts || {})) {
        verdicts.set(url, verdict);
        for (const a of byUrl.get(url) || []) mark(a, verdict);
      }
      if (verdicts.size > 2000) verdicts.clear();
    } finally {
      busy = false;
      if (queue.length) setTimeout(flush, 50);
    }
  }

  /* ------------------------------------------------------------ hints */

  const ADVICE = {
    scam: 'Real companies, banks and friends never need a code, gift cards or crypto sent in a chat. Check with them another way before you send anything.',
    sextortion: 'This is a threat, and it is not your fault. Do not pay or send anything. Keep the messages, block the person and report them.'
  };
  const COLOR = { warn: '#f08a24', danger: '#e5484d' };

  // Drawn in a closed shadow root: the page cannot restyle or read it, and it adds nothing to the message's words.
  function hint(after, r) {
    const host = document.createElement('span');
    host.setAttribute('data-sentinel-chat', r.level);
    host.style.cssText = 'display:block;margin:4px 0 2px;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      :host{color:inherit}
      .h{display:flex;gap:8px;align-items:flex-start;max-width:440px;padding:6px 10px 6px 8px;border-radius:8px;
        font:400 12.5px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:inherit;
        background:color-mix(in srgb, ${COLOR[r.level]} 10%, transparent);box-shadow:inset 3px 0 0 ${COLOR[r.level]};
        animation:in .36s cubic-bezier(.2,.8,.2,1) both}
      .h svg{width:16px;height:16px;flex:none;margin-top:1px;color:${COLOR[r.level]}}
      .h b{font-weight:650}
      .h p{margin:0}
      @keyframes in{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}
      @media (prefers-reduced-motion: reduce){.h{animation:none}}
    </style><div class="h" role="note">${Masks.svg('scam')}<p><b></b> <span class="d"></span> <span class="a"></span></p></div>`;
    root.querySelector('b').textContent = `Sentinel: ${r.title}.`;
    root.querySelector('.d').textContent = r.detail;
    root.querySelector('.a').textContent = ADVICE[r.family];
    after.after(host);
  }

  /* ------------------------------------------------------------ sweep */

  const talks = new Map();                  // conversation (the page's path) -> chat safety's reader for it
  const judged = new WeakSet();
  const flagged = new WeakMap();            // message -> what chat safety said, drawn again if the app redraws it

  function talk() {
    const key = location.pathname;
    if (!talks.has(key)) {
      if (talks.size > 50) talks.clear();
      talks.set(key, Chat.conversation({}));
    }
    return talks.get(key);
  }

  function whoSent(msg, last) {
    if (site.whoAttr) {
      const el = msg.querySelector(`[${site.whoAttr}]`);
      const m = el && /\]\s*([^:]{1,64}):\s*$/.exec(el.getAttribute(site.whoAttr));
      return m ? m[1].trim() : last;
    }
    const el = site.who && msg.querySelector(site.who);
    return el ? el.textContent.trim() : last;   // Discord names a sender once for a run of their messages
  }

  function sweep() {
    if (!settings.enabled || (site.path && !site.path.test(location.pathname))) return;
    let who = '';
    let added = false;
    for (const msg of document.querySelectorAll(site.message)) {
      who = whoSent(msg, who);
      const textEl = msg.querySelector(site.text) || msg;
      if (!judged.has(msg)) {
        judged.add(msg);
        const own = site.out && (msg.matches(site.out) || msg.closest(site.out));
        const r = own ? null : talk().add({ who: who || undefined, text: textEl.textContent || '' });
        if (r && ADVICE[r.family]) flagged.set(msg, r);
      }
      const r = flagged.get(msg);
      if (r && !msg.querySelector('[data-sentinel-chat]')) hint(textEl === msg ? msg.lastElementChild || msg : textEl, r);

      for (const a of msg.querySelectorAll('a[href]')) {
        const url = realUrl(a.getAttribute('href'), a.textContent, location.href);
        if (!url) continue;
        const host = new URL(url).hostname;
        if (host === location.hostname || site.own.test(host)) continue;
        const list = byUrl.get(url) || [];
        if (!list.includes(a)) { byUrl.set(url, [...list.filter((x) => x.isConnected), a]); }
        if (verdicts.has(url)) mark(a, verdicts.get(url));
        else if (!requested.has(url)) { requested.add(url); queue.push(url); added = true; }
      }
    }
    if (added || queue.length) flush();
  }

  let timer;
  function schedule(delay = 400) {
    clearTimeout(timer);
    timer = setTimeout(sweep, delay);
  }
  // Links are checked as soon as the tab is looked at again.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(50); });
  window.addEventListener('focus', () => schedule(50));

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
