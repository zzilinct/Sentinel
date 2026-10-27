'use strict';
/**
 * webchats-odd  Web chats the way people really have them (41-webchats.js proves the plain ones), with the companion
 *               loaded and the real Sentinel server behind it, each chat a stand-in at its real address:
 *   - a long Discord channel (1500 messages) scrolled far back: older messages arrive above, and are read
 *   - a message edited after it arrived: into a scam ask (it gets the hint), and back (the hint goes)
 *   - a link in an embed and in a preview card
 *   - messages in other languages and right to left: links marked, no false hints
 *   - a very busy channel (a message every 100 ms): hints and masks still come within a moment, and the added main
 *     thread time against the same channel with the companion off is measured
 *   - the chat hints switch and the companion itself turned off and on in the real settings page while a chat is open
 *   - Telegram Web (both versions) and X messages with a link in a forwarded message or a shared post's card
 * No link in any message is ever opened.
 */
const { sleep, result, launch, evalIn, openPage, goto, shot, startServer, until, clickSel } = require('./_shared');
const { tlsServer, loadCompanion, pairedOptions } = require('./_companion');

const SCAM = 'https://paypa1-secure-login.com/account';   // a listed scam (server/lib/scan/lists.js)
const LINK_HOSTS = ['paypa1-secure-login.com', 'www.wikipedia.org', 't.co'];
const CHAT_HOSTS = ['discord.com', 'web.telegram.org', 'x.com'];
const ASK = 'Hi, I sent you a 6 digit code by mistake, can you send it to me?';

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
  <style>body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px 40px;background:#fff;color:#1d1f23}
  li,.bubble,.Message,[data-testid=messageEntry]{list-style:none;margin:6px 0;padding:6px 10px;border-radius:8px;background:#f0f1f3;max-width:620px}</style></head><body>${body}</body></html>`;

// Discord: the channel's last 1500 messages, every tenth with an ordinary link, and what the check does to it.
const discordRow = (n, html, who) => `<li id="chat-messages-2-${n}"><div>${who ? `<h3><span id="message-username-${n}">${who}</span></h3>` : ''}<div id="message-content-${n}">${html}</div></div></li>`;
const DISCORD = page('Discord', `<main><ol data-list-id="chat-messages" id="list">${Array.from({ length: 1500 }, (_, i) => discordRow(10000 + i,
  i % 10 ? `Message ${i}: did anyone finish the homework for tomorrow?` : `Notes ${i}: https://www.wikipedia.org/wiki/Page_${i}`.replace(/(https:\S+)/, '<a href="$1">$1</a>'), i % 5 ? '' : `Friend${i % 7}`)).join('')}</ol></main>
  <script>
    let n = 20000;
    window.row = (html, who, id) => { const k = n++; const li = document.createElement('li'); li.id = 'chat-messages-2-' + k; if (id) li.dataset.t = id;
      li.innerHTML = '<div>' + (who ? '<h3><span id="message-username-' + k + '">' + who + '</span></h3>' : '') + '<div id="message-content-' + k + '">' + html + '</div></div>'; return li; };
    window.add = (html, who, id) => { const li = row(html, who, id); li.dataset.at = performance.now(); document.getElementById('list').appendChild(li); return li.id; };
    // How long after it arrived each tagged message got a hint or a mask, timed here as it happens.
    window.took = {};
    new MutationObserver(() => { for (const li of document.querySelectorAll('li[data-at]')) { const t = li.dataset.t;
      if (li.querySelector('[data-sentinel-chat]') && !took[t + ':hint']) took[t + ':hint'] = Math.round(performance.now() - li.dataset.at);
      if (li.querySelector('.sentinel-masks') && !took[t + ':mask']) took[t + ':mask'] = Math.round(performance.now() - li.dataset.at); } })
      .observe(document.getElementById('list'), { childList: true, subtree: true });
    window.older = (rows) => { const list = document.getElementById('list'); const f = document.createDocumentFragment(); for (const [html, who, id] of rows) f.appendChild(row(html, who, id)); list.prepend(f); return true; };
    window.edit = (id, html) => { const c = document.querySelector('[data-t="' + id + '"] [id^="message-content-"]'); c.innerHTML = html + ' <span class="edited">(edited)</span>'; return true; };
  </script>`);
const PAGES = {
  'discord.com/channels/1/2': DISCORD,
  'web.telegram.org/k/': page('Telegram Web', `<div class="bubbles">
    <div class="bubble is-in" ><div class="message">Morning! Here is that thing I mentioned</div></div>
    <div class="bubble is-in is-forwarded" id="fwd"><div class="bubble-content"><div class="name">Forwarded from Crypto Support</div>
      <div class="message">Your wallet is paused. Restore it here <a href="${SCAM}" target="_blank">${SCAM}</a></div></div></div></div>`),
  'web.telegram.org/a/': page('Telegram Web A', `<div class="messages-container">
    <div class="Message" id="fwd"><div class="message-content is-forwarded"><div class="message-title">Forwarded from <span>Crypto Support</span></div>
      <div class="text-content">Your wallet is paused. Restore it here <a class="text-entity-link" href="${SCAM}">${SCAM}</a></div></div></div></div>`),
  'x.com/messages/7': page('Messages / X', `<div aria-label="Conversation">
    <div data-testid="messageEntry" id="fwd"><div data-testid="tweet" role="link"><div data-testid="User-Name">Giveaways</div>
      <div data-testid="tweetText">Claim your prize now <a href="https://t.co/Zz9xQ" rel="noopener noreferrer nofollow" target="_blank">paypa1-secure-login.com/account…</a></div></div></div>
    <div data-testid="messageEntry"><div data-testid="card.wrapper"><a id="card" href="https://t.co/Yy8wP" rel="noopener noreferrer nofollow" target="_blank" role="link" aria-label="paypa1-secure-login.com Account review needed">
      <div><img alt="" width="1" height="1"></div><div><span>paypa1-secure-login.com</span><span>Account review needed</span></div></a></div></div></div>`)
};

async function checkWebChatsOdd() {
  const seen = [];
  const chats = await tlsServer([...CHAT_HOSTS, ...LINK_HOSTS], (req, res, host) => {
    seen.push(`${host}${req.url}`);
    const html = PAGES[`${host}${req.url.split('?')[0]}`];
    res.writeHead(html ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html || 'not found');
  });
  const sentinel = await startServer('webchats-odd', { SENTINEL_DEVICE_ACCOUNTS: '1' });
  const { browser, close } = await launch([`--host-resolver-rules=${chats.rules}`, '--ignore-certificate-errors']);
  try {
    const t = await fetch(`${sentinel.base}/api/v1/auth/device`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: sentinel.base }, body: '{}' });
    const token = t.ok ? (await t.json()).token : null;
    if (!token) throw new Error('the test server gave no device account');
    const id = await loadCompanion(browser);
    const opt = await pairedOptions(browser, id, sentinel.base, token);
    const o = opt.sessionId;

    const tab = await openPage(browser);
    const s = tab.sessionId;
    await browser.send('Performance.enable', {}, s);
    const busy = async () => (await browser.send('Performance.getMetrics', {}, s)).metrics.find((m) => m.name === 'TaskDuration').value;
    // What the companion drew on the message tagged data-t=id: its masks' label and whether it has a hint.
    const on = (tag) => evalIn(browser, s, `(() => { const li = document.querySelector('[data-t="${tag}"]') || document.getElementById('${tag}'); if (!li) return null;
      return { masks: [...li.querySelectorAll('.sentinel-masks')].map((m) => m.getAttribute('aria-label')), hint: Boolean(li.querySelector('[data-sentinel-chat]')) }; })()`);
    const waitFor = async (tag, test, ms) => { const t0 = Date.now(); for (; Date.now() - t0 < ms;) { const v = await on(tag); if (v && test(v)) return Date.now() - t0; await sleep(50); } return null; };
    const scamMask = (v) => v.masks.some((m) => /scam/i.test(m));
    const channel = async () => {
      await goto(browser, s, 'https://discord.com/channels/1/2', "document.querySelectorAll('#list li').length === 1500");
      await sleep(4000);   // the first look over the channel, and its links' answers
    };

    /* ------------------------------------------------ a very busy channel, against the same with the companion off */

    // 60 messages, one every 100 ms, while the channel's 1500 are on the page. Message 20 asks for a code, 40 has a scam link.
    const stream = async () => {
      const b0 = await busy();
      const t0 = Date.now();
      const at = {};
      for (let i = 0; i < 60; i++) {
        const html = i === 20 ? ASK : i === 40 ? `Free nitro here ${SCAM}`.replace(SCAM, `<a href="${SCAM}">${SCAM}</a>`) : `Busy ${i}: lol that round was wild`;
        await evalIn(browser, s, `add(${JSON.stringify(html)}, ${JSON.stringify(i % 3 ? '' : `Player${i % 9}`)}, 'busy${i}')`);
        if (i === 20 || i === 40) at[i] = Date.now();
        await sleep(Math.max(0, t0 + (i + 1) * 100 - Date.now()));
      }
      return { ms: Date.now() - t0, busy: (await busy()) - b0, at };
    };
    await channel();
    const live = await stream();
    // Each one's wait, counted from when it arrived: a sweep that only ran once the channel went quiet would come seconds late.
    // Timed in the page as they happen (window.took).
    await waitFor('busy20', (v) => v.hint, 5000);
    await waitFor('busy40', scamMask, 5000);
    const took = await evalIn(browser, s, 'window.took');
    const askMs = took['busy20:hint'] == null ? null : took['busy20:hint'];
    const scamMs = took['busy40:mask'] == null ? null : took['busy40:mask'];
    await shot(browser, s, 'webchats-odd-busy');

    /* ------------------------------------------------ edited messages */

    await evalIn(browser, s, "add('See you at 5', 'Jordan', 'edit')");
    await sleep(2000);
    const plainFirst = await on('edit');
    await evalIn(browser, s, `edit('edit', ${JSON.stringify(ASK)})`);
    const editedIn = await waitFor('edit', (v) => v.hint, 5000);
    await evalIn(browser, s, "edit('edit', 'Never mind, wrong chat')");
    const editedBack = await waitFor('edit', (v) => !v.hint, 5000);
    result('webchats-odd: a message edited into asking for a code gets the hint, and loses it when edited back',
      plainFirst && !plainFirst.hint && editedIn !== null && editedBack !== null, { before: plainFirst, hintAfterEditMs: editedIn, goneAfterEditBackMs: editedBack });

    /* ------------------------------------------------ embeds and preview cards */

    await evalIn(browser, s, `add(${JSON.stringify(`check this out <article class="embedWrapper"><div class="embedProvider">PayPal</div><div class="embedTitle"><a class="embedTitleLink" href="${SCAM}">PayPal: Log in</a></div><div class="embedDescription">Review your account</div></article>`)}, 'Sam', 'embed')`);
    await evalIn(browser, s, `add(${JSON.stringify(`<a class="card" href="${SCAM}"><div><div class="cardTitle">Your account is limited</div><div class="cardHost">paypa1-secure-login.com</div></div></a>`)}, '', 'card')`);
    const embedIn = await waitFor('embed', scamMask, 6000);
    const cardIn = await waitFor('card', scamMask, 6000);
    await shot(browser, s, 'webchats-odd-embed');
    result('webchats-odd: a scam link in an embed and in a preview card (a link round a whole card) each get the scam mask',
      embedIn !== null && cardIn !== null, { embed: await on('embed'), card: await on('card') });

    /* ------------------------------------------------ other languages */

    await evalIn(browser, s, `add('Nos vemos a las 5, ¿vale?', 'Lucía', 'es')`);
    await evalIn(browser, s, `add(${JSON.stringify(`<div dir="rtl">انظر هذا الرابط <a href="${SCAM}">${SCAM}</a></div>`)}, 'أحمد', 'ar')`);
    await evalIn(browser, s, `add('明日の会議は10時からです', '太郎', 'ja')`);
    await evalIn(browser, s, `add('Te envié un código de 6 dígitos por error, ¿me lo puedes reenviar?', 'Desconocido', 'es-ask')`);
    const rtlIn = await waitFor('ar', scamMask, 6000);
    await sleep(800);
    const langs = { es: await on('es'), ar: await on('ar'), ja: await on('ja'), esAsk: await on('es-ask') };
    await shot(browser, s, 'webchats-odd-languages');
    result('webchats-odd: in other languages, and right to left, a scam link is still marked and ordinary messages get no hint',
      rtlIn !== null && !langs.es.hint && !langs.ja.hint && !langs.ar.hint, langs);

    /* ------------------------------------------------ scrolled far back */

    const olderRows = [...Array.from({ length: 120 }, (_, i) => [`Older ${i}: gg everyone`, i % 6 ? '' : `Old${i % 4}`, `old${i}`]),
      [`Old giveaway <a href="${SCAM}">${SCAM}</a>`, 'Stranger', 'oldscam'], [ASK, 'Stranger2', 'oldask']];
    await evalIn(browser, s, `older(${JSON.stringify(olderRows)})`);
    const oldScam = await waitFor('oldscam', scamMask, 6000);
    const oldAsk = await waitFor('oldask', (v) => v.hint, 6000);
    result('webchats-odd: scrolled far back in a long channel, older messages loaded above are read too: a scam link marked, a code ask hinted',
      oldScam !== null && oldAsk !== null, { messages: await evalIn(browser, s, "document.querySelectorAll('#list li').length"), maskMs: oldScam, hintMs: oldAsk });

    /* ------------------------------------------------ the switches, in the real settings page, while the chat is open */

    const hintsNow = () => evalIn(browser, s, "document.querySelectorAll('[data-sentinel-chat]').length");
    const before = await hintsNow();
    await clickSel(browser, o, '#chatHints');
    await sleep(1500);
    const offHints = await hintsNow();
    const offStored = await evalIn(browser, o, "chrome.storage.sync.get('chatHints').then((r) => r.chatHints)");
    await clickSel(browser, o, '#chatHints');
    let backHints = 0;
    for (let i = 0; i < 30 && backHints < before; i++) { await sleep(200); backHints = await hintsNow(); }
    result('webchats-odd: the hints switch turned off in settings removes the hints from the open chat, and turned on brings them back, with no new message',
      before >= 2 && offHints === 0 && offStored === false && backHints === before, { before, off: offHints, stored: offStored, backOn: backHints });

    await clickSel(browser, o, '#enabled');
    await sleep(800);
    await goto(browser, s, 'https://discord.com/channels/1/2', "document.querySelectorAll('#list li').length === 1500");
    await evalIn(browser, s, `add(${JSON.stringify(`look <a href="${SCAM}">${SCAM}</a>`)}, 'Jordan', 'later')`);
    await sleep(3000);
    const whileOff = await on('later');
    await clickSel(browser, o, '#enabled');
    const turnedOn = await waitFor('later', scamMask, 8000);
    result('webchats-odd: the companion turned off, an open chat gets nothing; turned back on in settings, the open chat is marked without a reload',
      whileOff && !whileOff.masks.length && turnedOn !== null, { whileOff, markedAfterMs: turnedOn });

    /* ------------------------------------------------ the busy channel with the companion off, for the added time */

    await clickSel(browser, o, '#enabled');
    await sleep(800);
    await channel();
    const bare = await stream();
    await clickSel(browser, o, '#enabled');
    await sleep(500);
    const addedMs = Math.round((live.busy - bare.busy) * 1000);
    result(`webchats-odd: a very busy channel (60 messages in ${(live.ms / 1000).toFixed(1)} s over 1500 on the page): the code ask is hinted and the scam link marked within a moment, while it is still busy, for ${addedMs} ms of added main thread time`,
      askMs !== null && askMs < 2000 && scamMs !== null && scamMs < 2000 && addedMs < 1500,
      { hintMsAfterArriving: askMs, maskMsAfterArriving: scamMs, mainThreadOn: Math.round(live.busy * 1000), mainThreadOff: Math.round(bare.busy * 1000), addedMs });

    /* ------------------------------------------------ forwarded messages: Telegram and X */

    for (const [where, name] of [['web.telegram.org/k/', 'Telegram Web K'], ['web.telegram.org/a/', 'Telegram Web A'], ['x.com/messages/7', 'X messages']]) {
      await goto(browser, s, `https://${where}`);
      const fwd = await waitFor('fwd', scamMask, 15000);
      const card = where.startsWith('x.com') ? await evalIn(browser, s, "(() => { const a = document.getElementById('card'); const n = a && a.nextElementSibling; return n && n.classList.contains('sentinel-masks') ? n.getAttribute('aria-label') : null; })()") : undefined;
      await sleep(500);
      await shot(browser, s, `webchats-odd-${name.toLowerCase().replace(/\W+/g, '-')}`);
      result(`webchats-odd: ${name}: a scam link in a forwarded message${card === undefined ? '' : ', and in a shared post\'s link card (a t.co link named by its card),'} gets the scam mask`,
        fwd !== null && (card === undefined || /scam/i.test(card || '')), { fwd: await on('fwd'), card });
    }

    const opened = seen.filter((u) => LINK_HOSTS.some((h) => u.startsWith(`${h}/`)));
    result('webchats-odd: no link in any message was opened or fetched by the browser', !opened.length, { opened, pages: seen.length });
  } finally {
    await close();
    chats.close();
    await sentinel.stop();
  }
}

module.exports = checkWebChatsOdd;
