'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, OUT, sleep, result, serveFiles, launch, evalIn, openPage, goto, pageText, shot } = require('./_shared');

/* ------------------------------------- pay pause by wording (companion) */

// Pages whose addresses say nothing (harmless local pages behind made-up names): a store's gift card page known by its
// heading and form, a wallet whose send dialog opens a moment after the page (its address never changes), a page known
// by its title alone, and a kitchen shop that only mentions gift cards in its footer. With the real server behind the
// companion: nothing is read before a warning; after one, the first three get the pause and the kitchen shop nothing.
async function checkPayWords() {
  const SAYS = 'No real company, government office or bank asks to be paid in gift cards or crypto.';
  const SIGN_HOST = 'paypa1-secure-login.com';   // a listed scam (server/lib/scan/lists.js)
  const net = require('net');
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-paywords-db-'));
  const serverLog = fs.openSync(path.join(OUT, 'paywords-server.log'), 'w');
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
  const dialog = '<div role="dialog" aria-label="Send" style="border:1px solid #888;padding:20px;max-width:360px"><h2>Send</h2>'
    + '<button>Bitcoin</button><p><label>To <input placeholder="Address, email or phone"></label></p><p><label>Amount <input></label></p><button>Send</button></div>';
  const files = await serveFiles({}, {
    '/p/7': page('Store', '<h1>Buy gift cards</h1><form><label>Gift card amount <select><option>50</option></select></label> <button type="button">Add to cart</button></form>'),
    '/app': page('Wallet', `<h1>Your balance</h1><p>0.0123</p><div id="d"></div><script>setTimeout(() => { document.getElementById('d').innerHTML = ${JSON.stringify(dialog)}; }, 6000);</script>`),
    '/p/42': page('Buy Gift Cards Online', '<h1>Welcome</h1><p>Our range.</p>'),
    '/home': page('Kitchen goods', '<main><h1>Kitchen goods</h1><button>Add to cart</button></main><footer><h3>Gift cards</h3><a href="/g">Buy gift cards</a> <a href="/b">Gift card balance</a></footer>'),
    '/signin.html': page('Sign in', '<h1>Sign in to your account</h1>')
  });
  const filesPort = new URL(files.base).port;
  const hosts = ['giftstore.test', 'walletapp.test', 'titleshop.test', 'kitchen.test', SIGN_HOST];
  const { browser, close } = await launch([`--host-resolver-rules=${hosts.map((h) => `MAP ${h} 127.0.0.1:${filesPort}`).join(',')}`]);
  try {
    if (!token) throw new Error(`the Sentinel server did not start on ${api} (see paywords-server.log)`);
    const visit = async (body) => (await (await fetch(`${api}/api/v1/live/visit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })).json()).paypage || null;
    const kinds = { plain: await visit({ url: 'http://giftstore.test/p/7' }), seen: await visit({ url: 'http://giftstore.test/p/7', paykind: 'gift' }), odd: await visit({ url: 'http://giftstore.test/p/7', paykind: 'title text' }) };
    result('paywords: the scanner takes the kind the client saw for an address that says nothing, and nothing else', kinds.plain === null && kinds.seen === 'gift' && kinds.odd === null, kinds);

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
      for (let i = 0; i < tries && !text.includes(SAYS); i++) { await sleep(250); text = await pageText(browser, s); }
      return text;
    };
    const open = async (url) => { const t = await openPage(browser); await goto(browser, t.sessionId, url); return t.sessionId; };

    const early = await open('http://giftstore.test/p/7');
    result('paywords: before any warning a gift card page by its wording gets nothing', !(await shows(early, 16)).includes(SAYS) && !Object.keys(await kept()).some((k) => k.startsWith('paused:')));

    await open(`http://${SIGN_HOST}/signin.html`);
    let sign = false;
    for (let i = 0; i < 80 && !sign; i++) { await sleep(250); sign = Boolean((await kept()).paySign); }
    result(`paywords: ${SIGN_HOST} is flagged, and the companion notes when`, sign);

    const kitchen = await open('http://kitchen.test/home');
    const quiet = await shows(kitchen, 24);
    result('paywords: a shop that mentions gift cards only in its footer gets nothing', !quiet.includes(SAYS) && !('paused:kitchen.test' in await kept()) && /Kitchen goods/.test(quiet));

    const store = await open('http://giftstore.test/p/7');
    const said = await shows(store);
    await shot(browser, store, 'companion-paywords-gift');
    result('paywords: a gift card page at an address that says nothing is known by its heading and form, and gets the pause', said.includes(SAYS) && (await kept())['paused:giftstore.test'] === 1,
      said.slice(said.indexOf('A moment before you pay'), said.indexOf('A moment before you pay') + 200));

    const wallet = await open('http://walletapp.test/app');
    const before = await shows(wallet, 12);
    const after = await shows(wallet, 60);
    await shot(browser, wallet, 'companion-paywords-send-dialog');
    result("paywords: a wallet's send dialog that opens later on the same address gets the pause as it opens, not before", !before.includes(SAYS) && after.includes(SAYS) && /Your balance/.test(after),
      { before: before.includes(SAYS), after: after.includes(SAYS) });

    const titled = await open('http://titleshop.test/p/42');
    result('paywords: a page known by its title alone gets the pause too', (await shows(titled)).includes(SAYS));

    const store2 = await kept();
    result('paywords: only the sites are kept, never the words or addresses', !/gift card|Bitcoin|Kitchen|\/p\/|\/app|https?:/i.test(JSON.stringify(store2)), Object.keys(store2));
  } finally {
    await close();
    files.server.close();
    sentinel.kill();
    await sleep(500);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

module.exports = checkPayWords;
