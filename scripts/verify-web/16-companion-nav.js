'use strict';
/**
 * companion-nav   Pages that change without loading, and boxes inside frames. A wallet tab opened before any warning
 *                 that later moves to its send screen by history.pushState gets the pay pause; a flagged checkout whose
 *                 card box is inside a payment provider's frame gets "Did you type a card number?" once it is left.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, OUT, sleep, result, serveFiles, launch, evalIn, openPage, goto, pageText, shot, TYPED_PW } = require('./_shared');

const SAYS = 'No real company, government office or bank asks to be paid in gift cards or crypto.';
const CARD_HOST = 'netflix-billing-update.top';   // a listed scam (server/lib/scan/lists.js), a harmless local page here

async function checkCompanionNav() {
  const net = require('net');
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-nav-db-'));
  const serverLog = fs.openSync(path.join(OUT, 'companion-nav-server.log'), 'w');
  const sentinel = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    stdio: ['ignore', serverLog, serverLog],
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(data, 'sentinel.db'), SENTINEL_DEVICE_ACCOUNTS: '1', FEED_REFRESH_HOURS: '0', RESEARCH_ENABLED: '0' }
  });
  const api = `http://127.0.0.1:${port}`;
  let token = null;
  for (let i = 0; i < 120 && !token; i++) {
    await sleep(500);
    try {
      const r = await fetch(`${api}/api/v1/auth/device`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: api }, body: '{}' });
      if (r.ok) token = (await r.json()).token;
    } catch { /* still starting */ }
  }
  const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font:16px/1.6 system-ui,sans-serif;margin:60px">${body}</body></html>`;
  // A wallet that draws its screens itself: the send screen comes by pushState, never by a page load.
  const send = '<div role="dialog" aria-label="Send" style="border:1px solid #888;padding:20px;max-width:360px"><h2>Send</h2>'
    + '<button>Bitcoin</button><p><label>To <input placeholder="Address, email or phone"></label></p><p><label>Amount <input></label></p><button>Send</button></div>';
  const wallet = page('Wallet', `<main id="screen"><h1>Your balance</h1><p>0.0123</p></main><script>
    window.goSend = () => { history.pushState({}, '', '/wallet/send'); document.getElementById('screen').innerHTML = ${JSON.stringify(send)}; };
  </script>`);
  const files = await serveFiles({}, {
    '/wallet/home': wallet,
    '/signin.html': page('Sign in', '<h1>Sign in to your account</h1><form onsubmit="return false"><p><label>Password <input type="password"></label></p></form>'),
    // The flagged checkout has no card box of its own: it is inside the payment provider's frame.
    '/checkout.html': page('Checkout', '<h1>Complete your order</h1><p>Total 14.99</p><iframe src="http://payframe.test/card.html" title="Secure payment" style="border:1px solid #ccc;width:420px;height:180px"></iframe>'),
    '/card.html': page('Card', '<form onsubmit="return false"><p><label>Card number <input name="cardnumber" autocomplete="cc-number" inputmode="numeric"></label></p><p><label>Expiry <input autocomplete="cc-exp"></label></p></form>'),
    '/recipes.html': page('Recipes', '<h1>Banana bread</h1><p>Three ripe bananas, flour, sugar, an egg and butter.</p>')
  });
  const filesPort = new URL(files.base).port;
  const hosts = ['walletspa.test', 'payframe.test', TYPED_PW, CARD_HOST];
  const { browser, close } = await launch([`--host-resolver-rules=${hosts.map((h) => `MAP ${h} 127.0.0.1:${filesPort}`).join(',')}`]);
  try {
    if (!token) throw new Error(`the Sentinel server did not start on ${api} (see companion-nav-server.log)`);
    const loaded = await browser.send('Extensions.loadUnpacked', { path: path.join(ROOT, 'extension') });
    const opt = await openPage(browser);
    await goto(browser, opt.sessionId, `chrome-extension://${loaded.id}/src/options.html`, "typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id");
    const paired = await evalIn(browser, opt.sessionId, `(async () => {
      await chrome.storage.local.set({ authToken: ${JSON.stringify(token)} });
      await chrome.storage.sync.set({ apiBase: ${JSON.stringify(api)} });
      const r = await chrome.runtime.sendMessage({ type: 'refresh' });
      return Boolean(r && r.account && r.account.signedIn);
    })()`);
    if (!paired) throw new Error('the companion could not sign in to the test server');
    const kept = () => evalIn(browser, opt.sessionId, 'chrome.storage.session.get(null)');
    const waitText = async (s, re, tries = 40) => {
      let text = '';
      for (let i = 0; i < tries && !re.test(text); i++) { await sleep(250); text = await pageText(browser, s); }
      return text;
    };
    const saysRe = new RegExp(SAYS.replace(/\./g, '\\.'));

    /* 1. The wallet tab is open before any warning. */
    const walletTab = await openPage(browser);
    await goto(browser, walletTab.sessionId, 'http://walletspa.test/wallet/home');
    await sleep(2000);
    const quietFirst = await pageText(browser, walletTab.sessionId);
    result('companion-nav: a wallet opened before any warning gets nothing', !quietFirst.includes(SAYS) && /Your balance/.test(quietFirst));

    // A warning in another tab.
    const sign = await openPage(browser);
    await goto(browser, sign.sessionId, `http://${TYPED_PW}/signin.html`);
    let warned = false;
    for (let i = 0; i < 80 && !warned; i++) { await sleep(250); warned = Boolean((await kept()).paySign); }
    result(`companion-nav: ${TYPED_PW} is flagged, and the companion notes when`, warned);

    // Back to the wallet, which moves to its send screen without loading: the pause.
    await browser.send('Target.activateTarget', { targetId: walletTab.targetId });
    await evalIn(browser, walletTab.sessionId, 'window.goSend()');
    const said = await waitText(walletTab.sessionId, saysRe, 60);
    const where = await evalIn(browser, walletTab.sessionId, 'location.pathname + "|" + performance.getEntriesByType("navigation").length');
    await shot(browser, walletTab.sessionId, 'companion-nav-pushstate-pause');
    result('companion-nav: the open wallet moving to its send screen by pushState gets the pause, with no page load', said.includes(SAYS) && where === '/wallet/send|1' && (await kept())['paused:walletspa.test'] === 1,
      { where, shown: said.includes(SAYS) });

    /* 2. A flagged checkout whose card box is in a payment provider's frame. */
    const pay = await openPage(browser);
    await goto(browser, pay.sessionId, `http://${CARD_HOST}/checkout.html`);
    let card = null;
    for (let i = 0; i < 80 && !card; i++) {
      await sleep(250);
      card = Object.entries(await kept()).find(([k, v]) => k.startsWith('typed:') && v && v.card) || null;
    }
    const topHasBox = await evalIn(browser, pay.sessionId, "Boolean(document.querySelector('input'))");
    await shot(browser, pay.sessionId, 'companion-nav-frame-checkout');
    result(`companion-nav: ${CARD_HOST} is flagged, and the card box inside its payment frame is noticed (the page itself has none)`, Boolean(card) && !topHasBox && !/payframe/.test(JSON.stringify(await kept())),
      { card, topHasBox });
    await goto(browser, pay.sessionId, `${files.base}/recipes.html`);
    const asked = await waitText(pay.sessionId, /Did you type a card number on that page\?/);
    await shot(browser, pay.sessionId, 'companion-nav-frame-question');
    result('companion-nav: leaving the checkout asks "Did you type a card number on that page?" on the next page',
      /Did you type a card number on that page\?/.test(asked) && asked.includes(CARD_HOST) && /Banana bread/.test(asked),
      asked.slice(asked.indexOf('Did you type'), asked.indexOf('Did you type') + 200));
  } finally {
    await close();
    files.server.close();
    sentinel.kill();
    await sleep(500);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

module.exports = checkCompanionNav;
