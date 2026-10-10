'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, OUT, sleep, result, serveFiles, launch, evalIn, openPage, goto, pageText, shot, clickButton } = require('./_shared');

/* ------------------------------------------- 11. warnings that lead to the real site */

// A look-alike of a brand, or of one of the person's own sites, gets one button to the real one: the address the
// scanner named (brands.js, mysites.js), never one made from the page. In the companion's block page (pressed, the tab
// goes there) and on the app's link scan. A listed scam that imitates nobody gets no such button. The real sites are
// mapped to a closed local port, so nothing reaches them.
const REAL_PHISH = 'paypa1-secure-login.com';
const REAL_GENERIC = 'crypto-doubler-elon.live';

async function checkRealSite() {
  const net = require('net');
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-real-db-'));
  const serverLog = fs.openSync(path.join(OUT, 'real-server.log'), 'w');
  const sentinel = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    stdio: ['ignore', serverLog, serverLog],
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(data, 'sentinel.db'), SENTINEL_DEVICE_ACCOUNTS: '1', FEED_REFRESH_HOURS: '0', RESEARCH_ENABLED: '0', BILLING_MODE: 'demo' }
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
  const files = await serveFiles({}, {
    '/signin.html': '<!doctype html><html><head><meta charset="utf-8"><title>Sign in</title></head><body style="font:16px/1.6 system-ui,sans-serif;margin:60px"><h1>Sign in to your account</h1><form onsubmit="return false"><p><label>Password <input type="password"></label></p></form></body></html>'
  });
  const filesPort = new URL(files.base).port;
  const rules = [...[REAL_PHISH, REAL_GENERIC].map((h) => `MAP ${h} 127.0.0.1:${filesPort}`), 'MAP paypal.com 127.0.0.1:9', 'MAP harbourcu.org 127.0.0.1:9'].join(',');
  const { browser, close } = await launch([`--host-resolver-rules=${rules}`]);
  try {
    if (!token) throw new Error(`the Sentinel server did not start on ${api} (see real-server.log)`);
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
    const blockText = async (s, re) => {
      let text = '';
      for (let i = 0; i < 80 && !re.test(text); i++) { await sleep(250); text = await pageText(browser, s); }
      return text;
    };
    const urlOf = async (targetId) => ((await browser.send('Target.getTargets')).targetInfos.find((t) => t.targetId === targetId) || {}).url || '';

    // (a) The companion: a look-alike of PayPal. The block page offers the real paypal.com; pressed, the tab goes there.
    const phish = await openPage(browser);
    const navigations = [];
    browser.on('Network.requestWillBeSent', (p) => { if (p.type === 'Document') navigations.push(p.request.url); });
    await browser.send('Network.enable', {}, phish.sessionId);
    await goto(browser, phish.sessionId, `http://${REAL_PHISH}/signin.html`);
    const block = await blockText(phish.sessionId, /Go to the real/);
    await shot(browser, phish.sessionId, 'real-site-companion');
    result(`real-site: the companion's block page on ${REAL_PHISH} offers "Go to the real paypal.com"`, /Go to the real paypal\.com/.test(block), block.slice(0, 400));
    const pressed = await clickButton(browser, phish.sessionId, 'Go to the real paypal.com');
    let went = '';
    for (let i = 0; i < 40 && !went; i++) {
      await sleep(250);
      const at = await urlOf(phish.targetId);
      went = navigations.find((u) => /^https:\/\/paypal\.com\//.test(u)) || (/^https:\/\/paypal\.com\//.test(at) ? at : '');
    }
    result('real-site: pressing it takes the tab to https://paypal.com/, an address not made from the page', pressed && went === 'https://paypal.com/', { pressed, went, navigations });

    // (b) A listed scam that imitates no brand: the block page, with no such button.
    const generic = await openPage(browser);
    await goto(browser, generic.sessionId, `http://${REAL_GENERIC}/signin.html`);
    const plain = await blockText(generic.sessionId, /Take me back to safety/);
    await shot(browser, generic.sessionId, 'real-site-companion-generic');
    result(`real-site: the block page on ${REAL_GENERIC} (no brand) has no "Go to the real" button`, /Take me back to safety/.test(plain) && !/Go to the real/.test(plain), plain.slice(0, 300));

    // (c) The app's link scan, signed in as a throwaway account with one site of its own.
    const app = await openPage(browser);
    await goto(browser, app.sessionId, `${api}/login`);
    const signed = await evalIn(browser, app.sessionId, `(async () => {
      const post = (p, body) => fetch(p, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const email = 'real-' + Date.now() + '@example.com', password = 'Real-Site-2026!';
      const a = await post('/api/v1/auth/signup', { email, password, firstName: 'Kim', ageConfirmed: true, termsAccepted: true });
      const b = await post('/api/v1/auth/login', { email, password });
      const c = await post('/api/v1/my-sites/add', { host: 'harbourcu.org' });
      const d = await post('/api/v1/billing/plan', { plan: 'max' });   // the newest model is on the paid plans (demo billing)
      return a.ok && b.ok && c.ok && d.ok;
    })()`);
    if (!signed) throw new Error('the test account could not sign in and add its site');
    const scan = async (link, name) => {
      await goto(browser, app.sessionId, `${api}/app/scan?url=${encodeURIComponent(link)}`, "document.querySelector('#view [data-form]')");
      let got = null;
      for (let i = 0; i < 120 && !got; i++) {
        await sleep(250);
        got = await evalIn(browser, app.sessionId, `(() => { if (!document.querySelector('[data-result]')) return null; const a = document.querySelector('[data-real-site]');
          return { title: document.querySelector('[data-result] h2').textContent, text: a ? a.textContent.trim() : null, href: a ? a.getAttribute('href') : null, target: a ? a.target : null }; })()`);
      }
      await evalIn(browser, app.sessionId, "(document.querySelector('[data-result]') || document.body).scrollIntoView({ block: 'start' }), 1");
      await sleep(700);   // the result settles in (app-lux.css) before its picture
      await shot(browser, app.sessionId, `real-site-app-${name}`);
      return got || {};
    };
    const brand = await scan(`https://${REAL_PHISH}/account/verify?next=https://elsewhere.example/`, 'brand');
    result('real-site: the app\'s link scan of a PayPal look-alike offers the real paypal.com', brand.text === 'Go to the real paypal.com' && brand.href === 'https://paypal.com/' && brand.target === '_blank', brand);
    const mine = await scan('https://harbourcu-secure-login.com/', 'mine');
    result('real-site: a look-alike of the person\'s own site offers that site', mine.text === 'Go to the real harbourcu.org' && mine.href === 'https://harbourcu.org/', mine);
    const none = await scan(`https://${REAL_GENERIC}/`, 'generic');
    result('real-site: a listed scam that imitates nobody gets no such button in the app', Boolean(none.title) && none.text === null, none);
    // Pressed, the real site opens in a new tab: exactly the address shown.
    const before = (await browser.send('Target.getTargets')).targetInfos.map((t) => t.targetId);
    await goto(browser, app.sessionId, `${api}/app/scan?url=${encodeURIComponent(`https://${REAL_PHISH}/`)}`, "document.querySelector('[data-real-site]')");
    const [x, y] = await evalIn(browser, app.sessionId, "(() => { const a = document.querySelector('[data-real-site]'); a.scrollIntoView({ block: 'center' }); const r = a.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()");
    for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, app.sessionId);
    let opened = null;
    for (let i = 0; i < 40 && !opened; i++) { await sleep(250); opened = (await browser.send('Target.getTargets')).targetInfos.find((t) => t.type === 'page' && !before.includes(t.targetId) && t.url) || null; }
    result('real-site: pressing it in the app opens https://paypal.com/ in a new tab', Boolean(opened) && opened.url === 'https://paypal.com/', opened ? opened.url : 'no new tab');
  } finally {
    await close();
    files.server.close();
    sentinel.kill();
    await sleep(500);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

module.exports = checkRealSite;
