'use strict';
/**
 * webchats  Links in web chats get the companion's mask, and messages that ask for a code, gift cards, crypto or a
 *           "verify your account" step get chat safety's hint: in Discord, WhatsApp Web, Messenger (messenger.com and
 *           facebook.com/messages), Telegram Web and X messages. Each chat is a local stand-in at its real address
 *           (--host-resolver-rules, a throwaway certificate) shaped like the real app's messages, with the real Sentinel
 *           server behind the companion. The person's own messages, ordinary messages, honest links and a Facebook page
 *           that is not a chat get nothing, and no link in a message is ever opened.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');
const { ROOT, sleep, result, launch, evalIn, openPage, goto, pageText, shot, startServer, until } = require('./_shared');

const SCAM = 'https://paypa1-secure-login.com/account';   // a listed scam (server/lib/scan/lists.js)
const SAFE = 'https://www.wikipedia.org/';
// Hosts a link in a message points at: mapped here too, so a request to any of them would be seen.
const LINK_HOSTS = ['paypa1-secure-login.com', 'www.wikipedia.org', 'l.facebook.com', 't.co'];
const CHAT_HOSTS = ['discord.com', 'web.whatsapp.com', 'www.messenger.com', 'www.facebook.com', 'web.telegram.org', 'x.com'];
const ADVICE = 'Real companies, banks and friends never need a code, gift cards or crypto sent in a chat.';

function openssl() {
  for (const exe of ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe']) {
    if (spawnSync(exe, ['version']).status === 0) return exe;
  }
  throw new Error('openssl was not found (Git for Windows ships one)');
}

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:32px 48px;background:#fff;color:#1d1f23}
  .row,li,.bubble,.message-in,.message-out,[data-testid=messageEntry]{list-style:none;margin:10px 0;padding:8px 12px;border-radius:10px;background:#f0f1f3;max-width:560px}
  .message-out,.is-out{margin-left:auto;background:#d9fdd3}</style></head><body>${body}</body></html>`;

// What each chat's messages look like, as far as the companion reads them. #scam and #safe are links; #ask is the
// message that should get the hint; #own is the person's own message, with the same kind of words, that must not.
const PAGES = {
  'discord.com/channels/@me/42': page('Discord', `<main><ol data-list-id="chat-messages" id="list">
    <li id="chat-messages-42-1"><div><h3><span id="message-username-1">Jordan</span></h3>
      <div id="message-content-1">Hey, is this your account? <a id="scam" href="${SCAM}">${SCAM}</a></div></div></li>
    <li id="chat-messages-42-2"><div><div id="message-content-2">Notes from class: <a id="safe" href="${SAFE}">${SAFE}</a></div></div></li>
    <li id="chat-messages-42-3"><div><div id="message-content-3">See you at 5</div></div></li></ol></main>
    <script>setTimeout(() => { document.getElementById('list').insertAdjacentHTML('beforeend',
      '<li id="chat-messages-42-4"><div id="ask"><div id="message-content-4">Hi, I sent you a 6 digit code by mistake, can you send it to me?</div></div></li>'); }, 1500);</script>`),
  'web.whatsapp.com/': page('WhatsApp', `<div id="main">
    <div class="message-in"><div class="copyable-text" data-pre-plain-text="[10:30, 24/10/2026] Mum: "><span class="selectable-text">Hi love, this is my new number</span></div></div>
    <div class="message-in" id="ask"><div class="copyable-text" data-pre-plain-text="[10:31, 24/10/2026] Mum: "><span class="selectable-text">Can you buy me a $200 Apple gift card and send me the numbers on the back of the card?</span></div></div>
    <div class="message-in"><div class="copyable-text" data-pre-plain-text="[10:32, 24/10/2026] Mum: "><span class="selectable-text">Your parcel: <a id="scam" href="${SCAM}">${SCAM}</a></span></div></div>
    <div class="message-in"><div class="copyable-text" data-pre-plain-text="[10:33, 24/10/2026] Sam: "><span class="selectable-text"><a id="safe" href="${SAFE}">${SAFE}</a></span></div></div>
    <div class="message-out" id="own"><div class="copyable-text" data-pre-plain-text="[10:34, 24/10/2026] Me: "><span class="selectable-text">Mum, never send me the code you got, ok?</span></div></div></div>`),
  'www.messenger.com/t/123': page('Messenger', `<div role="grid">
    <div role="row" class="row"><div dir="auto">Hello from the security team</div></div>
    <div role="row" class="row" id="ask"><div dir="auto">Please verify your account here or it will be closed</div></div>
    <div role="row" class="row"><div dir="auto"><a id="scam" href="https://l.facebook.com/l.php?u=${encodeURIComponent(SCAM)}&amp;h=AT0">paypa1-secure-login.com</a></div></div>
    <div role="row" class="row"><div dir="auto"><a id="safe" href="https://l.facebook.com/l.php?u=${encodeURIComponent(SAFE)}&amp;h=AT1">wikipedia.org</a></div></div>
    <div role="row" class="row"><div dir="auto">Thanks, talk later</div></div></div>`),
  'www.facebook.com/messages/t/123': page('Messenger | Facebook', `<div role="grid">
    <div role="row" class="row" id="ask"><div dir="auto">Pay the release fee in Bitcoin today and the parcel is yours</div></div>
    <div role="row" class="row"><div dir="auto"><a id="scam" href="https://l.facebook.com/l.php?u=${encodeURIComponent(SCAM)}">paypa1-secure-login.com</a></div></div>
    <div role="row" class="row"><div dir="auto"><a id="safe" href="${SAFE}">${SAFE}</a></div></div></div>`),
  // Not a chat: the feed. Nothing is read here.
  'www.facebook.com/': page('Facebook', `<div role="feed">
    <div role="row" class="row" id="ask"><div dir="auto">Pay the release fee in Bitcoin today and the parcel is yours</div></div>
    <div role="row" class="row"><div dir="auto"><a id="scam" href="${SCAM}">${SCAM}</a></div></div>
    <div role="row" class="row"><div dir="auto"><a id="safe" href="${SAFE}">${SAFE}</a></div></div></div>`),
  'web.telegram.org/k/': page('Telegram Web', `<div class="bubbles">
    <div class="bubble" id="ask"><div class="message">Pay the release fee in Bitcoin today and the parcel is yours</div></div>
    <div class="bubble"><div class="message">Track it: <a id="scam" href="${SCAM}">${SCAM}</a></div></div>
    <div class="bubble"><div class="message"><a id="safe" href="${SAFE}">${SAFE}</a></div></div>
    <div class="bubble is-out" id="own"><div class="message">Why would I pay the fee in bitcoin?</div></div></div>`),
  'x.com/messages/123': page('Messages / X', `<div aria-label="Conversation">
    <div data-testid="messageEntry" id="ask"><div data-testid="tweetText">To keep your blue check, send me the code you got</div></div>
    <div data-testid="messageEntry"><div data-testid="tweetText"><a id="scam" href="https://t.co/AbC123">paypa1-secure-login.com/account…</a></div></div>
    <div data-testid="messageEntry"><div data-testid="tweetText"><a id="safe" href="${SAFE}">${SAFE}</a></div></div></div>`)
};

async function checkWebChats() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-tls-'));
  const hosts = [...CHAT_HOSTS, ...LINK_HOSTS];
  const r = spawnSync(openssl(), ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'),
    '-days', '1', '-subj', '/CN=sentinel-verify', '-addext', `subjectAltName=${hosts.map((h) => `DNS:${h}`).join(',')}`], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`openssl could not make a certificate: ${r.stderr}`);
  const seen = [];
  const chats = https.createServer({ key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) }, (req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    seen.push(`${host}${req.url}`);
    const html = PAGES[`${host}${req.url.split('?')[0]}`];
    res.writeHead(html ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html || 'not found');
  });
  await new Promise((resolve) => chats.listen(0, '127.0.0.1', resolve));
  const rules = hosts.map((h) => `MAP ${h} 127.0.0.1:${chats.address().port}`).join(',');

  const sentinel = await startServer('webchats', { SENTINEL_DEVICE_ACCOUNTS: '1' });
  const { browser, close } = await launch([`--host-resolver-rules=${rules}`, '--ignore-certificate-errors']);
  try {
    const t = await fetch(`${sentinel.base}/api/v1/auth/device`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: sentinel.base }, body: '{}' });
    const token = t.ok ? (await t.json()).token : null;
    if (!token) throw new Error('the test server gave no device account');
    const loaded = await browser.send('Extensions.loadUnpacked', { path: path.join(ROOT, 'extension') });
    const opt = await openPage(browser);
    await goto(browser, opt.sessionId, `chrome-extension://${loaded.id}/src/options.html`, "typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id");
    const paired = await evalIn(browser, opt.sessionId, `(async () => {
      await chrome.storage.local.set({ authToken: ${JSON.stringify(token)} });
      await chrome.storage.sync.set({ apiBase: ${JSON.stringify(sentinel.base)} });
      const r = await chrome.runtime.sendMessage({ type: 'refresh' });
      return Boolean(r && r.account && r.account.signedIn);
    })()`);
    if (!paired) throw new Error('the companion could not sign in to the test server');

    const tab = await openPage(browser);
    const s = tab.sessionId;
    const state = () => evalIn(browser, s, `(() => {
      const next = (id) => { const a = document.getElementById(id); const n = a && a.nextElementSibling; return n && n.classList.contains('sentinel-masks') ? n.getAttribute('aria-label') : null; };
      const ask = document.getElementById('ask');
      const own = document.getElementById('own');
      return { scam: next('scam'), safe: next('safe'), hints: document.querySelectorAll('[data-sentinel-chat]').length,
        ask: Boolean(ask && ask.querySelector('[data-sentinel-chat]')), own: own ? Boolean(own.querySelector('[data-sentinel-chat]')) : null };
    })()`);

    for (const [where, name, asks] of [['discord.com/channels/@me/42', 'Discord', 'a code (a message that arrives after the page loaded)'],
      ['web.whatsapp.com/', 'WhatsApp Web', 'gift cards'], ['www.messenger.com/t/123', 'Messenger', 'a "verify your account" step'],
      ['www.facebook.com/messages/t/123', 'Messenger on facebook.com', 'crypto'], ['web.telegram.org/k/', 'Telegram Web', 'crypto'], ['x.com/messages/123', 'X messages', 'a code']]) {
      await goto(browser, s, `https://${where}`);
      await until(browser, s, `(() => { const a = document.getElementById('scam'); return a && a.nextElementSibling && a.nextElementSibling.classList.contains('sentinel-masks') && document.querySelector('#ask [data-sentinel-chat]'); })()`, 25000);
      await sleep(1200);   // the honest link's answer, and anything else, has time to arrive
      const got = await state();
      const text = await pageText(browser, s);
      await shot(browser, s, `webchats-${name.toLowerCase().replace(/\W+/g, '-')}`);
      result(`webchats: ${name}: a link to a listed scam in a message gets the scam mask beside it, an honest link gets nothing`,
        /scam/i.test(got.scam || '') && !got.safe, got);
      result(`webchats: ${name}: the message that asks for ${asks} gets one quiet hint, and only that one${got.own === null ? '' : ' (the person\'s own message with the same words gets none)'}`,
        got.ask && got.hints === 1 && got.own !== true && text.includes('Sentinel: This looks like a scam.') && text.includes(ADVICE), { ...got, hint: /Sentinel: This looks like a scam\.[^]{0,240}/.exec(text)?.[0] || null });
    }

    // A Facebook page that is not a chat: nothing is read or checked there.
    await goto(browser, s, 'https://www.facebook.com/');
    await sleep(4000);
    const feed = await state();
    await shot(browser, s, 'webchats-facebook-feed');
    result('webchats: a Facebook page that is not Messenger gets no hint and no marks', !feed.scam && !feed.hints, feed);

    const opened = seen.filter((u) => LINK_HOSTS.some((h) => u.startsWith(`${h}/`)));
    result('webchats: no link in any message was opened or fetched by the browser', !opened.length, { opened, pages: seen.length });

    // The companion turned off: a fresh chat gets nothing.
    await evalIn(browser, opt.sessionId, 'chrome.storage.sync.set({ enabled: false }).then(() => true)');
    await goto(browser, s, 'https://discord.com/channels/@me/42');
    await sleep(5000);
    const off = await state();
    result('webchats: with the companion turned off, the same Discord chat gets no marks and no hints', !off.scam && !off.hints, off);
  } finally {
    await close();
    chats.close();
    await sentinel.stop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

module.exports = checkWebChats;
