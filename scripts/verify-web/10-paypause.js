'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, OUT, sleep, result, serveFiles, launch, evalIn, openPage, goto, pageText, shot, TYPED_PW, clickButton } = require('./_shared');

/* ------------------------------------------------ 9. pay pause (companion) */

// A page that sells gift cards, then one that sends crypto (harmless local pages), with the real server behind the
// companion: nothing before the companion warned about a page; after a listed scam was flagged, a calm corner note
// says the one thing, once per site, and "I am buying this for myself" closes it.
const PAUSE_SAYS = 'No real company, government office or bank asks to be paid in gift cards or crypto.';
async function checkPayPause() {
  const net = require('net');
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-pause-db-'));
  const serverLog = fs.openSync(path.join(OUT, 'paypause-server.log'), 'w');
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
  const files = await serveFiles({}, {
    '/gift-cards/': page('Gift cards', '<h1>Gift cards</h1><p>Store gift card, 50.00</p>'),
    '/bitcoin-atm/': page('Bitcoin ATMs near you', '<h1>Bitcoin ATMs near you</h1><p>Main Street, open until 10 pm</p>'),
    '/signin.html': page('Sign in', '<h1>Sign in to your account</h1>')
  });
  const filesPort = new URL(files.base).port;
  const rules = ['giftshop.test', 'coinshop.test', TYPED_PW].map((h) => `MAP ${h} 127.0.0.1:${filesPort}`).join(',');
  const { browser, close } = await launch([`--host-resolver-rules=${rules}`]);
  try {
    if (!token) throw new Error(`the Sentinel server did not start on ${api} (see paypause-server.log)`);
    const visit = async (url) => (await (await fetch(`${api}/api/v1/live/visit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ url }) })).json()).paypage || null;
    const kinds = { gift: await visit('http://giftshop.test/gift-cards/'), crypto: await visit('http://coinshop.test/bitcoin-atm/'), plain: await visit('http://giftshop.test/about') };
    result('paypause: the scanner calls a gift card page and a crypto ATM locator what they are, and an ordinary page nothing', kinds.gift === 'gift' && kinds.crypto === 'crypto' && kinds.plain === null, kinds);

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
    const shows = async (s, tries = 40) => {
      let text = '';
      for (let i = 0; i < tries && !text.includes(PAUSE_SAYS); i++) { await sleep(250); text = await pageText(browser, s); }
      return text;
    };

    const gift = await openPage(browser);
    await goto(browser, gift.sessionId, 'http://giftshop.test/gift-cards/');
    const before = await shows(gift.sessionId, 16);
    result('paypause: a gift card page with no warning before it gets nothing', !before.includes(PAUSE_SAYS) && !Object.keys(await kept()).some((k) => k.startsWith('paused:')));

    const phish = await openPage(browser);
    await goto(browser, phish.sessionId, `http://${TYPED_PW}/signin.html`);
    let sign = false;
    for (let i = 0; i < 80 && !sign; i++) { await sleep(250); sign = Boolean((await kept()).paySign); }
    result(`paypause: ${TYPED_PW} is flagged, and the companion notes when (nothing else)`, sign);

    const again = await openPage(browser);
    await goto(browser, again.sessionId, 'http://giftshop.test/gift-cards/');
    const said = await shows(again.sessionId);
    await shot(browser, again.sessionId, 'companion-paypause-gift');
    result('paypause: the same gift card page after the warning says the one thing, with the number to call and one way to close it',
      said.includes(PAUSE_SAYS) && /call your bank on the number on the back of your card/.test(said) && /I am buying this for myself/.test(said) && !/—/.test(said),
      said.slice(said.indexOf('A moment before you pay'), said.indexOf('A moment before you pay') + 400));
    const pressed = await clickButton(browser, again.sessionId, 'I am buying this for myself');
    await sleep(800);
    result('paypause: "I am buying this for myself" closes it, and the page stays', pressed && !(await pageText(browser, again.sessionId)).includes(PAUSE_SAYS) && /Store gift card/.test(await pageText(browser, again.sessionId)), { pressed });

    await goto(browser, again.sessionId, 'http://giftshop.test/gift-cards/');
    const twice = await shows(again.sessionId, 16);
    const store = await kept();
    result('paypause: the same site is not paused twice, and only the site is kept', !twice.includes(PAUSE_SAYS) && store['paused:giftshop.test'] === 1 && !/gift-cards|https?:/.test(JSON.stringify(store)), Object.keys(store));

    const coin = await openPage(browser);
    await goto(browser, coin.sessionId, 'http://coinshop.test/bitcoin-atm/');
    const crypto = await shows(coin.sessionId);
    await shot(browser, coin.sessionId, 'companion-paypause-crypto');
    result('paypause: a crypto ATM locator on another site gets it too', crypto.includes(PAUSE_SAYS));
  } finally {
    await close();
    files.server.close();
    sentinel.kill();
    await sleep(500);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

module.exports = checkPayPause;
