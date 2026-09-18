/**
 * Sentinel Companion - email protection (Pro and Max).
 *
 * Marks inbox rows and open messages in Gmail and Outlook on the web with the
 * scam, virus and malware masks. Only what the mail client already shows is
 * sent for checking - sender, subject, a text excerpt, links and attachment
 * names - and nothing is stored.
 */
(() => {
  'use strict';
  const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;
  if (window.__sentinelMail) return;
  window.__sentinelMail = true;

  const Masks = window.SentinelMasks;
  const THREATS = ['scam', 'virus', 'malware'];
  const RANK = { yellow: 1, orange: 2, red: 3 };
  const done = new Map();                   // key -> verdict
  const isGmail = location.hostname === 'mail.google.com';

  const text = (el) => (el ? el.textContent.trim() : '');

  /* ------------------------------------------------------------ gmail */

  function gmailRows() {
    return [...document.querySelectorAll('tr.zA')].map((row) => {
      const sender = row.querySelector('span[email]');
      const subject = text(row.querySelector('.bog'));
      const snippet = text(row.querySelector('.y2')).replace(/^\s*-\s*/, '');
      if (!sender) return null;
      const key = `row|${sender.getAttribute('email')}|${subject}`;
      return {
        key,
        mount: row.querySelector('.yW') || sender.parentElement,
        email: { key, fromName: sender.getAttribute('name') || text(sender), fromAddress: sender.getAttribute('email'), subject, body: snippet, links: [], attachments: [] }
      };
    }).filter(Boolean);
  }

  function gmailOpen() {
    const subjectEl = document.querySelector('h2.hP');
    if (!subjectEl) return [];
    return [...document.querySelectorAll('.adn.ads')].map((msg) => {
      const sender = msg.querySelector('.gD[email]');
      const body = msg.querySelector('.a3s');
      if (!sender || !body) return null;
      const links = [...body.querySelectorAll('a[href]')].slice(0, 40).map((a) => ({ href: a.href, text: text(a).slice(0, 200) }));
      const attachments = [...msg.querySelectorAll('.aV3, .aQH span[title]')].map((a) => a.getAttribute('title') || text(a)).filter(Boolean);
      const replyTo = msg.querySelector('.ajv [email]');
      const key = `open|${sender.getAttribute('email')}|${text(subjectEl)}|${text(body).length}`;
      return {
        key,
        mount: sender.parentElement,
        email: { key, fromName: sender.getAttribute('name') || text(sender), fromAddress: sender.getAttribute('email'), replyTo: replyTo ? replyTo.getAttribute('email') : '', subject: text(subjectEl), body: text(body).slice(0, 6000), links, attachments }
      };
    }).filter(Boolean);
  }

  /* ---------------------------------------------------------- outlook */

  function outlookRows() {
    return [...document.querySelectorAll('[role="option"][aria-label], div[data-convid]')].slice(0, 60).map((row) => {
      const label = row.getAttribute('aria-label') || text(row);
      const senderEl = row.querySelector('[title*="@"], span[title]');
      const address = senderEl && /@/.test(senderEl.getAttribute('title') || '') ? senderEl.getAttribute('title') : '';
      const name = senderEl ? text(senderEl) : '';
      if (!label) return null;
      const key = `orow|${label.slice(0, 160)}`;
      return { key, mount: senderEl || row.firstElementChild, email: { key, fromName: name, fromAddress: address, subject: label.slice(0, 200), body: label.slice(0, 600), links: [], attachments: [] } };
    }).filter(Boolean);
  }

  function outlookOpen() {
    const body = document.querySelector('[aria-label="Message body"], div[role="document"]');
    if (!body) return [];
    const subject = text(document.querySelector('[role="heading"][aria-level="2"], .allowTextSelection span[title]'));
    const senderEl = document.querySelector('[aria-label^="From:"], span[title*="@"]');
    const address = senderEl ? ((senderEl.getAttribute('title') || '').match(/[^\s<>]+@[^\s<>]+/) || [''])[0] : '';
    const links = [...body.querySelectorAll('a[href]')].slice(0, 40).map((a) => ({ href: a.href, text: text(a).slice(0, 200) }));
    const attachments = [...document.querySelectorAll('[role="listitem"][aria-label*="."]')].map((a) => a.getAttribute('aria-label').split(' ')[0]);
    const key = `oopen|${address}|${subject}|${text(body).length}`;
    return [{ key, mount: senderEl ? senderEl.parentElement : body, email: { key, fromName: senderEl ? text(senderEl) : '', fromAddress: address, subject, body: text(body).slice(0, 6000), links, attachments } }];
  }

  /* ---------------------------------------------------------- marking */

  function mark(item, verdict) {
    if (!item.mount || !item.mount.isConnected || !verdict) return;
    const old = item.mount.querySelector(':scope > .sentinel-masks');
    if (old) old.remove();
    const shown = THREATS.filter((t) => verdict.threats[t] && verdict.threats[t].badge && RANK[verdict.threats[t].badge] >= 1);
    if (!shown.length) return;
    const group = document.createElement('span');
    group.className = 'sentinel-masks sentinel-masks--mail';
    group.title = `Sentinel: ${shown.map((t) => verdict.threats[t].label).join(', ')}\n${(verdict.reasons || []).slice(0, 3).map((r) => '- ' + r.text).join('\n')}`;
    for (const t of shown) {
      const m = document.createElement('span');
      m.className = `sentinel-mask sentinel-mask--${verdict.threats[t].badge}`;
      m.innerHTML = Masks.svg(t);
      group.appendChild(m);
    }
    item.mount.appendChild(group);
  }

  // Live hours are only spent while this tab is the one being looked at.
  const inUse = () => document.visibilityState === 'visible' && document.hasFocus();

  function send(message) {
    if (!inUse() && message && message.type && message.type.startsWith('live-')) return Promise.resolve({ ok: false, locked: 'inactive' });
    return new Promise((resolve) => {
      try {
        Promise.resolve(ext.runtime.sendMessage(message)).then((res) => resolve(res || { ok: false }), () => resolve({ ok: false }));
      } catch { resolve({ ok: false }); }
    });
  }

  let busy = false;
  let locked = false;
  async function sweep() {
    if (busy || locked) return;
    const items = isGmail ? [...gmailRows(), ...gmailOpen()] : [...outlookRows(), ...outlookOpen()];
    for (const item of items) if (done.has(item.key)) mark(item, done.get(item.key));
    const pending = items.filter((i) => !done.has(i.key)).slice(0, 25);
    if (!pending.length) return;

    busy = true;
    try {
      const res = await send({ type: 'live-email', emails: pending.map((p) => p.email) });
      if (res.locked) { locked = res.locked !== 'hours'; return; }
      for (const r of res.results || []) {
        done.set(r.key, r.verdict);
        const item = pending.find((p) => p.key === r.key);
        if (item) mark(item, r.verdict);
      }
      if (done.size > 2000) done.clear();
    } finally {
      busy = false;
    }
  }

  let timer;
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(sweep, 900); })
    .observe(document.body, { childList: true, subtree: true });
  setTimeout(sweep, 1500);
})();
