'use strict';
/**
 * companion-polish  Three rough edges of the companion, in a real headless Chrome with the real server behind it.
 *   1. A page the scanner flagged, open in a private window, that moves to a send screen by pushState never gets the pay
 *      pause, and nothing about it is kept; an honest gift card page in the same private window still gets the pause.
 *   2. The block page's real-site lookup: one question to the scanner per site (a second page of it reuses the answer),
 *      and while the scanner cannot be reached the block page comes at once without the button, and is not asked again.
 *   3. The block page and the pay pause at phone width in the light theme: nothing cut, nothing outside the window.
 * The companion talks to the server through a small counting proxy here, which can also stop answering.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { ROOT, OUT, sleep, result, serveFiles, launch, evalIn, openPage, goto, pageText, shot, TYPED_PW, passBlock } = require('./_shared');

const SAYS = 'No real company, government office or bank asks to be paid in gift cards or crypto.';
// Not on the cached list: the scanner has to be the one that flags it. The first the scanner calls red or orange is used.
const FLAG_CANDIDATES = ['paypal-account-verify-login.top', 'secure-paypal-login-alert.top', 'apple-id-locked-alert.top', 'amazon-account-locked-verify.top', 'wallet-restore-connect.top'];
// Listed look-alikes of a brand (server/lib/scan/lists.js) for when the scanner cannot be reached.
const AWAY_CANDIDATES = ['apple-id-verify-support.xyz', 'netflix-billing-update.top', 'amazon-refund-center.icu', 'metamask-wallet-restore.cfd'];
const hostOfBody = (buf) => { try { return new URL(JSON.parse(buf.toString('utf8')).url).hostname; } catch { return ''; } };

/** Every node of the page, closed shadow roots included. */
async function nodes(browser, s) {
  const { root } = await browser.send('DOM.getDocument', { depth: -1, pierce: true }, s);
  const out = [];
  const walk = (n) => { out.push(n); for (const c of [...(n.shadowRoots || []), ...(n.children || [])]) walk(c); };
  walk(root);
  return out;
}
const attr = (n, name) => { const a = n.attributes || []; const i = a.indexOf(name); return i >= 0 && i % 2 === 0 ? a[i + 1] : null; };
const textOf = (n) => (n.children || []).filter((c) => c.nodeType === 3).map((c) => c.nodeValue).join('').trim();
async function box(browser, s, n) {
  const { model } = await browser.send('DOM.getBoxModel', { nodeId: n.nodeId }, s);
  const q = model.border;
  return { left: Math.round(q[0]), top: Math.round(q[1]), right: Math.round(q[4]), bottom: Math.round(q[5]) };
}

/**
 * The companion's warning on this page, measured: the panel, its title and every button and link inside the window
 * across (no horizontal cut), the panel's top on screen, and each button reachable on screen once scrolled to.
 */
async function measure(browser, s, width, height) {
  // The block page's own column, with its "why" open so every button is there; or a note's panel.
  await evalIn(browser, s, "(() => { const m = document.getElementById('more'); if (m) m.open = true; })()");
  const all = await nodes(browser, s);
  const panel = all.find((n) => n.nodeName === 'DIV' && /\b(panel|say)\b/.test(attr(n, 'class') || ''));
  if (!panel) return { ok: false, why: 'no warning on the page' };
  const inside = [];
  const walk = (n) => { inside.push(n); for (const c of n.children || []) walk(c); };
  walk(panel);
  const parts = inside.filter((n) => n.nodeName === 'BUTTON' || n.nodeName === 'H1' || (n.nodeName === 'A' && attr(n, 'href')));
  // Scrolled to the panel's top corner first: that top must be reachable, not above the window.
  await browser.send('DOM.scrollIntoViewIfNeeded', { nodeId: panel.nodeId, rect: { x: 0, y: 0, width: 1, height: 1 } }, s).catch(() => {});
  await sleep(150);
  const p = await box(browser, s, panel);
  const bad = [];
  if (p.left < 0 || p.right > width) bad.push({ panel: p });
  if (p.top < 0) bad.push({ panelTopCut: p.top });
  for (const n of parts) {
    const b = await box(browser, s, n);
    const name = textOf(n) || n.nodeName;
    if (b.left < p.left || b.right > p.right || b.left < 0 || b.right > width) bad.push({ across: name, b });
  }
  for (const n of parts.filter((x) => x.nodeName === 'BUTTON')) {
    await browser.send('DOM.scrollIntoViewIfNeeded', { nodeId: n.nodeId }, s).catch(() => {});
    await sleep(150);
    const b = await box(browser, s, n);
    if (b.top < 0 || b.bottom > height) bad.push({ unreachable: textOf(n), b });
  }
  return { ok: !bad.length, panel: p, parts: parts.length, bad };
}

async function checkCompanionPolish() {
  const net = require('net');
  const freePort = () => new Promise((resolve) => { const sv = net.createServer().listen(0, '127.0.0.1', () => { const p = sv.address().port; sv.close(() => resolve(p)); }); });
  const port = await freePort();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-polish-db-'));
  const serverLog = fs.openSync(path.join(OUT, 'companion-polish-server.log'), 'w');
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

  // The proxy the companion talks to: it counts page scans by site, and while `away` it never answers them.
  const visits = [];
  const held = [];
  let away = false;
  const proxy = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (req.url.startsWith('/api/v1/live/visit')) {
        visits.push(hostOfBody(body));
        if (away) { held.push(res); return; }
      }
      const up = http.request({ host: '127.0.0.1', port, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      up.on('error', () => { res.writeHead(502); res.end(); });
      up.end(body);
    });
  });
  const proxyPort = await freePort();
  await new Promise((resolve) => proxy.listen(proxyPort, '127.0.0.1', resolve));
  const via = `http://127.0.0.1:${proxyPort}`;
  const seen = (host) => visits.filter((h) => h === host).length;

  const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font:16px/1.6 system-ui,sans-serif;margin:24px;background:#fff;color:#111">${body}</body></html>`;
  const send = '<div role="dialog" aria-label="Send" style="border:1px solid #888;padding:20px;max-width:360px"><h2>Send</h2>'
    + '<button>Bitcoin</button><p><label>To <input placeholder="Address, email or phone"></label></p><p><label>Amount <input></label></p><button>Send</button></div>';
  const files = await serveFiles({}, {
    '/wallet/home': page('Wallet', `<main id="screen"><h1>Your balance</h1><p>0.0123</p></main><script>
      window.goSend = () => { history.pushState({}, '', '/wallet/send'); document.getElementById('screen').innerHTML = ${JSON.stringify(send)}; };
    </script>`),
    '/signin.html': page('Sign in', '<h1>Sign in to your account</h1><form onsubmit="return false"><p><label>Password <input type="password"></label></p></form>'),
    '/start': page('Start', '<p>A private window</p>'),
    '/account.html': page('Account', '<h1>Your account</h1><p>Confirm your details.</p>'),
    '/gift-cards/': page('Gift cards', '<h1>Gift cards</h1><p>Store gift card, 50.00</p>')
  });
  const filesPort = new URL(files.base).port;
  const hosts = [...FLAG_CANDIDATES, ...AWAY_CANDIDATES, TYPED_PW, 'giftshop.test'];
  // A private window tries https first and these local pages are http only.
  const { browser, close } = await launch([`--host-resolver-rules=${hosts.map((h) => `MAP ${h} 127.0.0.1:${filesPort}`).join(',')},MAP paypal.com 127.0.0.1:9`,
    '--disable-features=HttpsFirstModeIncognito,HttpsUpgrades,HttpsFirstBalancedModeAutoEnable']);
  try {
    if (!token) throw new Error(`the Sentinel server did not start on ${api} (see companion-polish-server.log)`);
    const visit = async (url) => (await (await fetch(`${api}/api/v1/live/visit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ url }) })).json()).verdict || {};

    const loaded = await browser.send('Extensions.loadUnpacked', { path: path.join(ROOT, 'extension'), enableInIncognito: true });
    const opt = await openPage(browser);
    await goto(browser, opt.sessionId, `chrome-extension://${loaded.id}/src/options.html`, "typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id");
    const paired = await evalIn(browser, opt.sessionId, `(async () => {
      await chrome.storage.local.set({ authToken: ${JSON.stringify(token)} });
      await chrome.storage.sync.set({ apiBase: ${JSON.stringify(via)} });
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

    /* 1. A flagged page in a private window moves to a send screen by pushState. */
    const badges = {};
    let FLAG = null;
    for (const h of FLAG_CANDIDATES) {
      const v = await visit(`http://${h}/wallet/home`);
      badges[h] = v.overall && v.overall.badge;
      if (!FLAG && (badges[h] === 'red' || badges[h] === 'orange')) FLAG = h;
    }
    result('companion-polish: the scanner flags a wallet look-alike that is not on the cached list', Boolean(FLAG), badges);
    if (FLAG) {
      // A real private window, opened by the companion's own page (a DevTools browser context runs no extensions).
      const allowed = await evalIn(browser, opt.sessionId, 'chrome.extension.isAllowedIncognitoAccess()');
      await evalIn(browser, opt.sessionId, "chrome.windows.create({ incognito: true, url: 'http://giftshop.test/start' }).then(() => 1)");
      let target = null;
      for (let i = 0; i < 40 && !target; i++) { await sleep(250); target = (await browser.send('Target.getTargets')).targetInfos.find((t) => t.type === 'page' && t.url === 'http://giftshop.test/start') || null; }
      // In split mode the private window has its own worker and its tabs are not listed here: its context tells.
      const own = (await browser.send('Target.getTargets')).targetInfos.find((t) => t.targetId === opt.targetId);
      const incognito = Boolean(target) && target.browserContextId !== own.browserContextId;
      result('companion-polish: the companion is allowed in a private window, and one is open', allowed === true && Boolean(target) && incognito, { allowed, target: Boolean(target), incognito });
      if (!target) throw new Error('no private window');
      const priv = { targetId: target.targetId, sessionId: (await browser.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId };
      await browser.send('Page.enable', {}, priv.sessionId);
      await goto(browser, priv.sessionId, `http://${FLAG}/wallet/home`);
      const block = await waitText(priv.sessionId, /Take me back to safety/, 80);
      await shot(browser, priv.sessionId, 'companion-polish-private-flagged');
      const href = await evalIn(browser, priv.sessionId, 'location.href').catch((e) => e.message);
      result(`companion-polish: ${FLAG} in a private window gets the block page`, /Take me back to safety/.test(block), { href, text: block.slice(0, 200) });
      // Continue anyway: the page opens and stays open, and only the page itself knows it is flagged.
      await passBlock(browser, priv.sessionId, 'typeof window.goSend === "function"');
      await sleep(1500);
      const noBlock = !/Take me back to safety/.test(await pageText(browser, priv.sessionId));
      await evalIn(browser, priv.sessionId, 'window.goSend()');
      const after = await waitText(priv.sessionId, saysRe, 24);
      const where = await evalIn(browser, priv.sessionId, 'location.pathname');
      await shot(browser, priv.sessionId, 'companion-polish-private-flagged-send');
      const store = await kept();
      result('companion-polish: the flagged page moving to its send screen by pushState gets no pay pause, and nothing about it is kept',
        /Take me back to safety/.test(block) && noBlock && where === '/wallet/send' && /Send/.test(after) && !after.includes(SAYS) && !JSON.stringify(store).includes(FLAG) && !store['paused:private'] && !Object.keys(store).some((k) => k.startsWith('typed:')),
        { noBlock, where, paused: after.includes(SAYS), kept: Object.keys(store) });
      // The pause itself still works in a private window, on an honest gift card page.
      await goto(browser, priv.sessionId, 'http://giftshop.test/gift-cards/');
      const gift = await waitText(priv.sessionId, saysRe);
      await shot(browser, priv.sessionId, 'companion-polish-private-gift');
      result('companion-polish: an honest gift card page in the same private window still gets the pause', gift.includes(SAYS));
      await browser.send('Target.closeTarget', { targetId: priv.targetId }).catch(() => {});
    }

    /* 2. The block page's real-site lookup. */
    const a = await openPage(browser);
    await goto(browser, a.sessionId, `http://${TYPED_PW}/signin.html`);
    const first = await waitText(a.sessionId, /Go to the real paypal\.com/, 80);
    result(`companion-polish: the block page on ${TYPED_PW} offers the real paypal.com, after one question to the scanner`, /Go to the real paypal\.com/.test(first) && seen(TYPED_PW) === 1, { asked: seen(TYPED_PW) });
    const b = await openPage(browser);
    await goto(browser, b.sessionId, `http://${TYPED_PW}/account.html`);
    const second = await waitText(b.sessionId, /Go to the real paypal\.com/, 40);
    await shot(browser, b.sessionId, 'companion-polish-real-cached');
    result('companion-polish: another page of that site offers it too, from the answer already cached (no second question)', /Go to the real paypal\.com/.test(second) && seen(TYPED_PW) === 1, { asked: seen(TYPED_PW) });

    const named = [];
    for (const h of AWAY_CANDIDATES) { const v = await visit(`http://${h}/signin.html`); if (v.realSite && v.realSite.host) named.push([h, v.realSite.host]); }
    result('companion-polish: the scanner names a real site for at least two other listed look-alikes', named.length >= 2, named);
    if (named.length >= 2) {
      away = true;
      const [[h1], [h2]] = named;
      const c = await openPage(browser);
      const t0 = Date.now();
      await goto(browser, c.sessionId, `http://${h1}/signin.html`);
      const drawn = await waitText(c.sessionId, /Take me back to safety/, 40);
      const ms = Date.now() - t0;
      await sleep(10000);   // past the companion's wait for the scanner
      const later = await pageText(browser, c.sessionId);
      await shot(browser, c.sessionId, 'companion-polish-real-away');
      result(`companion-polish: with the scanner unreachable, ${h1}'s block page comes at once, without the real-site button`,
        /Take me back to safety/.test(drawn) && ms < 6000 && !/Go to the real/.test(later) && seen(h1) === 1, { ms, asked: seen(h1) });
      const d = await openPage(browser);
      await goto(browser, d.sessionId, `http://${h2}/signin.html`);
      const next = await waitText(d.sessionId, /Take me back to safety/, 40);
      await sleep(2000);
      result(`companion-polish: and the next blocked site (${h2}) is not asked about while the scanner is away`, /Take me back to safety/.test(next) && !/Go to the real/.test(await pageText(browser, d.sessionId)) && seen(h2) === 0, { asked: seen(h2) });
      away = false;
      for (const r of held.splice(0)) { try { r.destroy(); } catch { /* gone */ } }
    }

    /* 3. Phone width, light theme. */
    const phone = await openPage(browser);
    const W = 360;
    const H = 640;
    await browser.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, phone.sessionId);
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, phone.sessionId);
    await goto(browser, phone.sessionId, `http://${TYPED_PW}/account.html?phone=1`);
    await waitText(phone.sessionId, /Go to the real paypal\.com/, 60);
    await sleep(600);   // the entrance settles before its picture
    await shot(browser, phone.sessionId, 'companion-polish-block-phone-light');
    const blockFit = await measure(browser, phone.sessionId, W, H);
    await shot(browser, phone.sessionId, 'companion-polish-block-phone-light-end');   // scrolled to its last button
    result('companion-polish: the block page at phone width in the light theme: nothing cut, every button on screen when scrolled to', blockFit.ok, blockFit);
    // A shorter window than the panel: it scrolls from its top instead of being cut at both ends.
    await browser.send('Emulation.setDeviceMetricsOverride', { width: W, height: 480, deviceScaleFactor: 1, mobile: false }, phone.sessionId);
    await sleep(400);
    const shortFit = await measure(browser, phone.sessionId, W, 480);
    await shot(browser, phone.sessionId, 'companion-polish-block-short-end');
    result('companion-polish: in a window shorter than the block page, its top and every button can still be reached', shortFit.ok, shortFit);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, phone.sessionId);

    // The pay pause, after that warning, on an honest gift card page at the same size.
    await goto(browser, phone.sessionId, 'http://giftshop.test/gift-cards/');
    const pause = await waitText(phone.sessionId, saysRe);
    await sleep(600);
    await shot(browser, phone.sessionId, 'companion-polish-pause-phone-light');
    const pauseFit = await measure(browser, phone.sessionId, W, H);
    result('companion-polish: the pay pause at phone width in the light theme sits inside the window, its button on screen', pause.includes(SAYS) && pauseFit.ok && pauseFit.panel.bottom <= H && pauseFit.panel.top >= 0, pauseFit);
  } finally {
    for (const r of held.splice(0)) { try { r.destroy(); } catch { /* gone */ } }
    await close();
    files.server.close();
    proxy.close();
    sentinel.kill();
    await sleep(500);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

module.exports = checkCompanionPolish;
